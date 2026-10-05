-- =============================================================================
-- Teste DISC — banco no Supabase (Postgres + Auth). Arquivo ÚNICO e idempotente:
-- pode ser colado no SQL Editor e executado ("Run") quantas vezes for preciso, sem erro
-- e sem apagar dados (só cria o que falta e recria funções, gatilhos, políticas e permissões).
--
-- Regras de segurança (contrato em docs/SUPABASE.md / docs/SPEC.md):
--   * RLS ligado em TODAS as tabelas. O papel "anon" (site público) não lê nem grava tabela nenhuma:
--     só chama as 3 funções públicas avaliacao_publica, enviar_resposta e relatorio_publico.
--   * "authenticated" (usuário logado) só enxerga algo se public.e_admin() = true.
--   * Funções auxiliares ficam no schema "disc_interno" (fora da API) e sem permissão para anon/authenticated.
--   * Mensagens de erro iguais às do apps-script/Code.gs (pt-BR). As funções públicas devolvem JSON
--     {ok:true, ...} ou {ok:false, erro:"..."} (nunca lançam erro para o candidato).
--   * Segredos (tokens do ClickUp, Anthropic etc.) NUNCA ficam no banco: só nos Secrets das Edge Functions.
-- =============================================================================

create schema if not exists disc_interno;
revoke all on schema disc_interno from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on schema disc_interno from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on schema disc_interno from authenticated'; end if;
end $$;

-- -----------------------------------------------------------------------------
-- Tabelas
-- -----------------------------------------------------------------------------

create table if not exists public.admins (
  user_id   uuid primary key references auth.users (id) on delete cascade,
  nome      text not null default '' check (char_length(nome) <= 120),
  criado_em timestamptz not null default now()
);

create table if not exists public.processos (
  id                uuid primary key default gen_random_uuid(),
  codigo            text unique check (codigo ~ '^[A-Z0-9]{4}$'),
  nome              text not null default '' check (char_length(nome) <= 120),
  tipo              text not null default 'selecao' check (tipo in ('selecao', 'equipe')),
  empresa           text not null default '' check (char_length(empresa) <= 120),
  vaga              text not null default '' check (char_length(vaga) <= 120),
  cidade            text not null default '' check (char_length(cidade) <= 120),
  consultor         text not null default '' check (char_length(consultor) <= 120),
  contratante       text not null default '' check (char_length(contratante) <= 120),
  periodo_inicio    date,
  periodo_fim       date,
  clickup_list_id   text check (clickup_list_id is null or clickup_list_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  config            jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  mostrar_resultado boolean not null default false,
  ativo             boolean not null default true,
  criado_em         timestamptz not null default now()
);

create table if not exists public.respostas (
  id           text primary key check (id ~ '^[A-Za-z0-9_-]{6,64}$'),
  processo_id  uuid references public.processos (id) on delete set null,
  avaliacao    text not null default '',
  protocolo    text unique check (protocolo is null or protocolo ~ '^[0-9]{2}[A-HJ-NP-Z]$'),
  recebido_em  timestamptz not null default now(),
  nome         text not null,
  telefone     text not null default '',
  idade        int check (idade is null or idade between 14 and 99),
  vaga         text not null default '',
  funcao       text not null default '',
  empresa      text not null default '',
  inicio       timestamptz,
  fim          timestamptz,
  duracao_seg  int not null default 0,
  respostas    text not null check (respostas ~ '^[1-4]{100}$'),
  d            numeric,
  i            numeric,
  s            numeric,
  c            numeric,
  perfil       text,
  validacao    jsonb,
  status       text not null default 'em_analise' check (status in ('em_analise', 'aprovado', 'reprovado')),
  observacoes  text not null default '' check (char_length(observacoes) <= 5000),
  payload      jsonb,
  clickup_sync jsonb
);
create index if not exists respostas_recebido_em_idx on public.respostas (recebido_em);
create index if not exists respostas_processo_idx on public.respostas (processo_id);

create table if not exists public.relatorios (
  token         text primary key
                default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
                check (token ~ '^[A-Za-z0-9_-]{32,128}$'),
  processo_id   uuid not null references public.processos (id) on delete cascade,
  status        text not null default 'rascunho' check (status in ('rascunho', 'publicado')),
  dados         jsonb not null default '{}'::jsonb,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  publicado_em  timestamptz
);
create index if not exists relatorios_processo_idx on public.relatorios (processo_id);

-- Só configurações NÃO secretas (ex.: nomes de status do ClickUp). Segredos ficam nos Secrets das funções.
create table if not exists public.configuracoes (
  chave text primary key check (chave ~ '^[A-Za-z0-9_.-]{1,80}$'),
  valor text not null default ''
);

-- -----------------------------------------------------------------------------
-- Quem é admin
-- -----------------------------------------------------------------------------

create or replace function public.e_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admins a where a.user_id = auth.uid());
$$;

-- -----------------------------------------------------------------------------
-- Auxiliares (schema disc_interno — fora da API, sem acesso de anon/authenticated)
-- -----------------------------------------------------------------------------

-- Erro no formato do Code.gs.
create or replace function disc_interno.erro(p_msg text)
returns json language sql immutable set search_path = '' as $$
  select json_build_object('ok', false, 'erro', p_msg);
$$;

-- Data ISO-8601 em UTC com milissegundos (igual ao Date.toISOString do JavaScript).
create or replace function disc_interno.iso(p timestamptz)
returns text language sql immutable set search_path = '' as $$
  select case when p is null then '' else to_char(p at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end;
$$;

-- String(v) do JavaScript para um valor JSON (ausente/null -> '').
create or replace function disc_interno.texto(v jsonb)
returns text language sql immutable set search_path = '' as $$
  select case
    when v is null or jsonb_typeof(v) = 'null' then ''
    when jsonb_typeof(v) = 'string' then v #>> '{}'
    when jsonb_typeof(v) = 'number' then
      case when (v::text)::numeric = trunc((v::text)::numeric) then trunc((v::text)::numeric)::text else v::text end
    when jsonb_typeof(v) = 'boolean' then v::text
    when jsonb_typeof(v) = 'object' then '[object Object]'
    else v::text
  end;
$$;

-- limparTexto do Code.gs: troca controles por espaço, junta espaços, apara e corta no limite.
create or replace function disc_interno.limpar_texto(p text, p_max int)
returns text language plpgsql immutable set search_path = '' as $$
declare
  s text := coalesce(p, '');
  esp constant text := '[\s   -     　﻿]+';
begin
  s := regexp_replace(s, '[\x01-\x1F\x7F]', ' ', 'g');
  s := btrim(regexp_replace(s, esp, ' ', 'g'), ' ');
  if p_max is not null and p_max > 0 and char_length(s) > p_max then
    s := btrim(substr(s, 1, p_max), ' ');
  end if;
  return s;
end;
$$;

-- Quantidade de letras (qualquer alfabeto latino/grego/cirílico, com acento), como /\p{L}/u no app.
create or replace function disc_interno.letras(p text)
returns int language sql immutable set search_path = '' as $$
  select char_length(regexp_replace(coalesce(p, ''),
    '[^[:alpha:]ªµºÀ-ÖØ-öø-ʯͰ-ϿЀ-ԯḀ-῿]', '', 'g'));
$$;

-- nomeValido do Code.gs: pelo menos 2 palavras com letra e no mínimo 5 letras.
create or replace function disc_interno.nome_valido(p text)
returns boolean language sql immutable set search_path = '' as $$
  select (select count(*) from regexp_split_to_table(coalesce(p, ''), ' ') w where disc_interno.letras(w) > 0) >= 2
     and disc_interno.letras(p) >= 5;
$$;

-- normalizarTelefone: só dígitos; 10/11 -> prefixa 55; 12/13 começando com 55 é aceito; senão ''.
create or replace function disc_interno.normalizar_telefone(v jsonb)
returns text language sql immutable set search_path = '' as $$
  select case
    when char_length(d) in (10, 11) then '55' || d
    when char_length(d) in (12, 13) and left(d, 2) = '55' then d
    else '' end
  from (select regexp_replace(disc_interno.texto(v), '\D', '', 'g') as d) x;
$$;

-- normalizarCodigoAvaliacao: 4 letras/algarismos (aceita minúsculas, espaços e apóstrofo inicial). '' se inválido.
create or replace function disc_interno.normalizar_codigo(p text)
returns text language sql immutable set search_path = '' as $$
  select case when s ~ '^[A-Z0-9]{4}$' then s else '' end
  from (select upper(regexp_replace(regexp_replace(coalesce(p, ''), '^''', ''), '\s+', '', 'g')) as s) x;
$$;

-- validarRespostasCompactas: 100 dígitos 1..4 e cada bloco de 4 é permutação de 1..4.
create or replace function disc_interno.respostas_validas(p text)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  b text;
begin
  if p is null or p !~ '^[1-4]{100}$' then return false; end if;
  for g in 0..24 loop
    b := substr(p, g * 4 + 1, 4);
    if strpos(b, '1') = 0 or strpos(b, '2') = 0 or strpos(b, '3') = 0 or strpos(b, '4') = 0 then return false; end if;
  end loop;
  return true;
end;
$$;

-- calcularDisc: totais, percentuais (total / 2.5, 1 casa) e perfil (maior + segundo; empate na ordem D, I, S, C).
create or replace function disc_interno.calcular_disc(p text)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  letras constant text[] := array['D', 'I', 'S', 'C'];
  tot int[] := array[0, 0, 0, 0];
  codigo text;
begin
  for g in 0..24 loop
    for j in 1..4 loop
      tot[j] := tot[j] + substr(p, g * 4 + j, 1)::int;
    end loop;
  end loop;
  select string_agg(l, '' order by t desc, k) into codigo
    from (select letras[k] l, tot[k] t, k from generate_series(1, 4) k order by tot[k] desc, k limit 2) x;
  return jsonb_build_object(
    'totais', jsonb_build_object('D', tot[1], 'I', tot[2], 'S', tot[3], 'C', tot[4]),
    'percentuais', jsonb_build_object(
      'D', round(tot[1] / 2.5, 1)::float8, 'I', round(tot[2] / 2.5, 1)::float8,
      'S', round(tot[3] / 2.5, 1)::float8, 'C', round(tot[4] / 2.5, 1)::float8),
    'codigo', codigo);
end;
$$;

-- Number(v) do JavaScript (aproximado): número, texto numérico, null -> 0; o resto -> null (NaN).
create or replace function disc_interno.numero_js(v jsonb)
returns numeric language plpgsql immutable set search_path = '' as $$
declare
  s text;
begin
  if v is null then return null; end if;
  if jsonb_typeof(v) = 'number' then return (v::text)::numeric; end if;
  if jsonb_typeof(v) = 'null' then return 0; end if;
  if jsonb_typeof(v) = 'boolean' then return case when v = 'true'::jsonb then 1 else 0 end; end if;
  if jsonb_typeof(v) = 'string' then
    s := btrim(v #>> '{}');
    if s = '' then return 0; end if;
    if s ~ '^[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][+-]?[0-9]+)?$' then return s::numeric; end if;
  end if;
  return null;
exception when others then
  return null;
end;
$$;

-- dataIsoOuVazio: data válida -> ISO em UTC; senão ''.
create or replace function disc_interno.data_iso(v jsonb)
returns text language plpgsql stable set search_path = '' set timezone = 'UTC' as $$
declare
  s text := disc_interno.limpar_texto(disc_interno.texto(v), 40);
begin
  if s = '' or s !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' then return ''; end if;
  return disc_interno.iso(s::timestamptz);
exception when others then
  return '';
end;
$$;

-- inteiro(x, min, max) do Code.gs: número JSON inteiro dentro da faixa.
create or replace function disc_interno.inteiro_entre(x jsonb, p_min numeric, p_max numeric)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  n numeric;
begin
  if x is null or jsonb_typeof(x) <> 'number' then return false; end if;
  n := (x::text)::numeric;
  return n = trunc(n) and n >= p_min and n <= p_max;
end;
$$;

-- validarValidacao do Code.gs: confere o formato da etapa de confirmação e devolve uma cópia limpa.
-- Retorna {ok:true, validacao: obj|null} ou {ok:false, erro}.
create or replace function disc_interno.validar_validacao(v jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  falha constant jsonb := jsonb_build_object('ok', false, 'erro', 'Dados da etapa de validação inválidos.');
  letras constant text[] := array['D', 'I', 'S', 'C'];
  x jsonb;
  itens jsonb := '[]'::jsonb;
  segs jsonb := '[]'::jsonb;
  pares jsonb := '[]'::jsonb;
begin
  if v is null or jsonb_typeof(v) = 'null' then return jsonb_build_object('ok', true, 'validacao', null); end if;
  if jsonb_typeof(v) <> 'object' then return falha; end if;
  -- Tamanho como no JSON.stringify (sem os espaços que o jsonb acrescenta depois de "," e ":").
  if char_length(replace(replace(v::text, ', ', ','), ': ', ':')) > 4000 then return falha; end if;

  -- versao: inteiro 1..99
  if not disc_interno.inteiro_entre(v -> 'versao', 1, 99) then return falha; end if;
  -- listas com tamanho máximo
  if jsonb_typeof(v -> 'pares') is distinct from 'array' or jsonb_typeof(v -> 'escolhas') is distinct from 'array'
     or jsonb_typeof(v -> 'itens') is distinct from 'array' or jsonb_typeof(v -> 'gruposSeg') is distinct from 'array' then
    return falha;
  end if;
  if jsonb_array_length(v -> 'pares') > 3 or jsonb_array_length(v -> 'escolhas') > 3
     or jsonb_array_length(v -> 'itens') > 8 or jsonb_array_length(v -> 'gruposSeg') > 25 then
    return falha;
  end if;
  for x in select e from jsonb_array_elements(v -> 'pares') e loop
    if jsonb_typeof(x) <> 'array' then return falha; end if;
    if jsonb_array_length(x) <> 2 or jsonb_typeof(x -> 0) <> 'string' or jsonb_typeof(x -> 1) <> 'string' then return falha; end if;
    if not ((x ->> 0) = any (letras)) or not ((x ->> 1) = any (letras)) then return falha; end if;
    pares := pares || jsonb_build_array(jsonb_build_array(x -> 0, x -> 1));
  end loop;
  for x in select e from jsonb_array_elements(v -> 'escolhas') e loop
    if jsonb_typeof(x) <> 'string' or not ((x #>> '{}') = any (letras)) then return falha; end if;
  end loop;
  for x in select e from jsonb_array_elements(v -> 'itens') e loop
    if jsonb_typeof(x) <> 'object' then return falha; end if;
    if jsonb_typeof(x -> 'id') is distinct from 'string' or (x ->> 'id') !~ '^[A-Za-z0-9_-]{1,40}$' then return falha; end if;
    if jsonb_typeof(x -> 'letra') is distinct from 'string' or not ((x ->> 'letra') = any (letras)) then return falha; end if;
    if jsonb_typeof(x -> 'tipo') is distinct from 'string' or (x ->> 'tipo') not in ('forca', 'sombra', 'contraste') then return falha; end if;
    if not disc_interno.inteiro_entre(x -> 'nota', 1, 5) then return falha; end if;
    itens := itens || jsonb_build_array(jsonb_build_object(
      'id', x -> 'id', 'letra', x -> 'letra', 'tipo', x -> 'tipo', 'nota', trunc((x ->> 'nota')::numeric)::int));
  end loop;
  for x in select e from jsonb_array_elements(v -> 'gruposSeg') e loop
    if jsonb_typeof(x) <> 'number' then return falha; end if;
    if (x::text)::numeric < 0 or (x::text)::numeric > 86400 then return falha; end if;
    segs := segs || to_jsonb((floor((x::text)::numeric * 10 + 0.5) / 10)::float8);
  end loop;
  if not disc_interno.inteiro_entre(v -> 'semMexer', 0, 25) then return falha; end if;
  if v ? 'demonstracao' and jsonb_typeof(v -> 'demonstracao') <> 'boolean' then return falha; end if;

  return jsonb_build_object('ok', true, 'validacao', jsonb_build_object(
    'versao', trunc((v ->> 'versao')::numeric)::int,
    'pares', pares,
    'escolhas', v -> 'escolhas',
    'itens', itens,
    'gruposSeg', segs,
    'semMexer', trunc((v ->> 'semMexer')::numeric)::int,
    'demonstracao', coalesce(v -> 'demonstracao' = 'true'::jsonb, false)));
end;
$$;

-- validarPayload do Code.gs. Retorna {ok:true, payload, disc} ou {ok:false, erro}.
create or replace function disc_interno.validar_payload(p jsonb)
returns jsonb language plpgsql stable set search_path = '' set timezone = 'UTC' as $$
declare
  v_id text; v_nome text; v_tel text; v_idade int; v_idade_txt text;
  v_resp text; v_aval text := ''; v_val jsonb; v_disc jsonb;
  v_inicio text; v_fim text; v_dur numeric;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    return jsonb_build_object('ok', false, 'erro', 'Dados do teste ausentes.');
  end if;

  v_id := disc_interno.limpar_texto(disc_interno.texto(p -> 'id'), 80);
  if v_id !~ '^[A-Za-z0-9_-]{6,64}$' then
    return jsonb_build_object('ok', false, 'erro', 'Identificador do envio inválido.');
  end if;

  v_nome := disc_interno.limpar_texto(disc_interno.texto(p -> 'nome'), 120);
  if not disc_interno.nome_valido(v_nome) then
    return jsonb_build_object('ok', false, 'erro', 'Informe o nome completo (nome e sobrenome).');
  end if;

  v_tel := disc_interno.normalizar_telefone(p -> 'telefone');
  if v_tel = '' then
    return jsonb_build_object('ok', false, 'erro', 'Telefone inválido. Informe DDD + número.');
  end if;

  -- validarIdadeServidor
  if p -> 'idade' is null or jsonb_typeof(p -> 'idade') = 'null'
     or (jsonb_typeof(p -> 'idade') = 'string' and btrim(p ->> 'idade') = '') then
    return jsonb_build_object('ok', false, 'erro', 'Idade não informada: a idade é obrigatória (só números, de 14 a 99 anos).');
  end if;
  v_idade_txt := case
    when jsonb_typeof(p -> 'idade') = 'number' then disc_interno.texto(p -> 'idade')
    when jsonb_typeof(p -> 'idade') = 'string' then btrim(p ->> 'idade')
    else '' end;
  if v_idade_txt !~ '^[0-9]{1,3}$' then
    return jsonb_build_object('ok', false, 'erro', 'Idade inválida: use só números (entre 14 e 99 anos).');
  end if;
  v_idade := v_idade_txt::int;
  if v_idade < 14 or v_idade > 99 then
    return jsonb_build_object('ok', false, 'erro', 'Idade inválida: precisa ser entre 14 e 99 anos.');
  end if;

  if p -> 'consentimento' is distinct from 'true'::jsonb then
    return jsonb_build_object('ok', false, 'erro', 'É necessário aceitar o uso dos dados para participar.');
  end if;

  v_resp := case when jsonb_typeof(p -> 'respostas') = 'string' then btrim(p ->> 'respostas') else '' end;
  if not disc_interno.respostas_validas(v_resp) then
    return jsonb_build_object('ok', false, 'erro', 'Respostas do teste inválidas ou incompletas.');
  end if;

  if p -> 'avaliacao' is not null and jsonb_typeof(p -> 'avaliacao') <> 'null'
     and btrim(disc_interno.texto(p -> 'avaliacao')) <> '' then
    v_aval := disc_interno.normalizar_codigo(disc_interno.texto(p -> 'avaliacao'));
    if v_aval = '' then
      return jsonb_build_object('ok', false, 'erro', 'Este link de avaliação não está mais ativo.');
    end if;
  end if;

  v_val := disc_interno.validar_validacao(p -> 'validacao');
  if not (v_val ->> 'ok')::boolean then return v_val; end if;

  v_disc := disc_interno.calcular_disc(v_resp);
  v_inicio := disc_interno.data_iso(p -> 'inicio');
  v_fim := disc_interno.data_iso(p -> 'fim');
  v_dur := disc_interno.numero_js(p -> 'duracaoSeg');
  if v_dur is null or v_dur < 0 or v_dur > 7 * 86400 then
    v_dur := case when v_inicio <> '' and v_fim <> ''
      then greatest(0, round(extract(epoch from (v_fim::timestamptz - v_inicio::timestamptz))))
      else 0 end;
  end if;

  return jsonb_build_object('ok', true, 'disc', v_disc, 'payload', jsonb_build_object(
    'v', 1,
    'id', v_id,
    'nome', v_nome,
    'telefone', v_tel,
    'idade', v_idade,
    'funcao', disc_interno.limpar_texto(disc_interno.texto(p -> 'funcao'), 80),
    'empresa', disc_interno.limpar_texto(disc_interno.texto(p -> 'empresa'), 80),
    'vaga', disc_interno.limpar_texto(disc_interno.texto(p -> 'vaga'), 120),
    'consentimento', true,
    'inicio', v_inicio,
    'fim', v_fim,
    'duracaoSeg', floor(v_dur + 0.5)::int,
    'respostas', v_resp,
    'resultado', jsonb_build_object('percentuais', v_disc -> 'percentuais', 'codigo', v_disc -> 'codigo'),
    'avaliacao', v_aval,
    'validacao', v_val -> 'validacao'));
end;
$$;

-- gerarProtocolo: sorteia "2 algarismos + 1 letra (sem I e O)" livre; perto de lotar, sorteia entre os livres.
create or replace function disc_interno.gerar_protocolo()
returns text language plpgsql volatile set search_path = '' as $$
declare
  letras constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  total constant int := 100 * 24;
  n int;
  cand text;
begin
  for t in 1..40 loop
    n := floor(random() * total)::int;
    cand := lpad((n / 24)::text, 2, '0') || substr(letras, n % 24 + 1, 1);
    if not exists (select 1 from public.respostas r where r.protocolo = cand) then return cand; end if;
  end loop;
  select c into cand from (
    select lpad((k / 24)::text, 2, '0') || substr(letras, k % 24 + 1, 1) as c
    from generate_series(0, total - 1) k
  ) todos
  where not exists (select 1 from public.respostas r where r.protocolo = todos.c)
  order by random() limit 1;
  if cand is null then
    raise exception 'Limite de códigos atingido: todos os 2400 códigos estão em uso. Exclua candidatos antigos ou de teste no painel e tente de novo.';
  end if;
  return cand;
end;
$$;

-- Nome de campo normalizado (normalizarNomeCampo do Code.gs): minúsculas, sem acento, só a-z 0-9 %.
create or replace function disc_interno.normalizar_nome_campo(p text)
returns text language sql immutable set search_path = '' as $$
  select btrim(regexp_replace(
    translate(lower(coalesce(p, '')),
      'áàâãäåāçćčéèêëēęíìîïīñńóòôõöøōúùûüūýÿž',
      'aaaaaaaccceeeeeeiiiiinnooooooouuuuuyyz'),
    '[^a-z0-9%]+', ' ', 'g'), ' ');
$$;

-- classificarCampo: '' (pode ler), 'sensivel' ou 'antecedente'. p_cfg traz permitirSaude/permitirAntecedentes.
create or replace function disc_interno.classificar_campo(p_nome text, p_cfg jsonb)
returns text language plpgsql immutable set search_path = '' as $$
declare
  n text := ' ' || disc_interno.normalizar_nome_campo(p_nome);
  termo text;
begin
  foreach termo in array array['sexo', 'genero', 'estado civil', 'filho', 'religi', 'gravid', 'etnia', 'raca',
    'cor da pele', 'orientacao', 'deficien', 'doenca', 'saude', 'antecedente', 'processo em seu nome', 'criminal'] loop
    if strpos(n, ' ' || termo) = 0 then continue; end if;
    if termo = 'saude' and coalesce(p_cfg -> 'permitirSaude' = 'true'::jsonb, false) then continue; end if;
    if termo in ('antecedente', 'processo em seu nome', 'criminal') then
      return case when coalesce(p_cfg -> 'permitirAntecedentes' = 'true'::jsonb, false) then 'antecedente' else 'sensivel' end;
    end if;
    return 'sensivel';
  end loop;
  return '';
end;
$$;

-- -----------------------------------------------------------------------------
-- Gatilhos
-- -----------------------------------------------------------------------------

-- processos: gera o código do link (4 caracteres de ABCDEFGHJKLMNPQRSTUVWXYZ23456789), normaliza e
-- recusa campo sensível do ClickUp em etapas/bônus (mesma regra e mensagem do Code.gs).
create or replace function disc_interno.processos_antes_gravar()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  alfabeto constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  cand text;
  x jsonb;
  nome text;
begin
  if tg_op = 'UPDATE' and new.codigo is distinct from old.codigo and coalesce(new.codigo, '') = '' then
    new.codigo := old.codigo; -- o código do link nunca some
  end if;
  if coalesce(new.codigo, '') = '' then
    for t in 1..200 loop
      cand := '';
      for k in 1..4 loop cand := cand || substr(alfabeto, floor(random() * 32)::int + 1, 1); end loop;
      if not exists (select 1 from public.processos pr where pr.codigo = cand) then new.codigo := cand; exit; end if;
    end loop;
    if coalesce(new.codigo, '') = '' then raise exception 'Não foi possível gerar um código novo. Tente de novo.'; end if;
  else
    new.codigo := disc_interno.normalizar_codigo(new.codigo);
    if new.codigo = '' then raise exception 'Código do link inválido: use 4 letras ou números.'; end if;
  end if;

  new.config := coalesce(new.config, '{}'::jsonb);
  if jsonb_typeof(new.config) <> 'object' then raise exception 'Configuração do processo inválida.'; end if;
  if char_length(new.config::text) > 40000 then raise exception 'Configuração do processo grande demais.'; end if;
  for x in
    select e from jsonb_array_elements(case when jsonb_typeof(new.config -> 'etapas') = 'array' then new.config -> 'etapas' else '[]'::jsonb end) e
    union all
    select e from jsonb_array_elements(case when jsonb_typeof(new.config -> 'bonus') = 'array' then new.config -> 'bonus' else '[]'::jsonb end) e
  loop
    if jsonb_typeof(x) = 'object' then
      nome := disc_interno.limpar_texto(disc_interno.texto(x -> 'campo'), 120);
      if nome <> '' and disc_interno.classificar_campo(nome, new.config) = 'sensivel' then
        raise exception 'O campo "%" é um dado sensível e não pode ser usado.', nome;
      end if;
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists processos_antes_gravar on public.processos;
create trigger processos_antes_gravar before insert or update on public.processos
  for each row execute function disc_interno.processos_antes_gravar();

-- processos: não exclui processo com respostas (sugere desativar), como o Code.gs.
create or replace function disc_interno.processos_antes_excluir()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.respostas r where r.processo_id = old.id) then
    raise exception 'Esta avaliação já tem respostas. Desative a avaliação em vez de excluir (ou exclua as respostas dela antes).';
  end if;
  return old;
end;
$$;

drop trigger if exists processos_antes_excluir on public.processos;
create trigger processos_antes_excluir before delete on public.processos
  for each row execute function disc_interno.processos_antes_excluir();

-- admins: ninguém remove o próprio acesso e sempre sobra pelo menos 1 admin.
create or replace function disc_interno.admins_antes_excluir()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and old.user_id = auth.uid() then
    raise exception 'Você não pode excluir o seu próprio acesso.';
  end if;
  if not exists (select 1 from public.admins a where a.user_id <> old.user_id) then
    raise exception 'Precisa existir pelo menos um administrador ativo.';
  end if;
  return old;
end;
$$;

drop trigger if exists admins_antes_excluir on public.admins;
create trigger admins_antes_excluir before delete on public.admins
  for each row execute function disc_interno.admins_antes_excluir();

-- relatorios: carimba atualizado_em e publicado_em.
create or replace function disc_interno.relatorios_antes_gravar()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.atualizado_em := now();
  if new.status = 'publicado' and (tg_op = 'INSERT' or old.status is distinct from 'publicado') then
    new.publicado_em := now();
  end if;
  return new;
end;
$$;

drop trigger if exists relatorios_antes_gravar on public.relatorios;
create trigger relatorios_antes_gravar before insert or update on public.relatorios
  for each row execute function disc_interno.relatorios_antes_gravar();

-- -----------------------------------------------------------------------------
-- Funções públicas (RPC) — anon
-- -----------------------------------------------------------------------------

-- Dados do link da avaliação (só processos ativos). Devolve {ok:true, avaliacao:{...}} e também os mesmos
-- campos no primeiro nível ({codigo, nome, tipo, empresaNome, mostrarResultado}); ou {ok:false, erro}.
create or replace function public.avaliacao_publica(p_codigo text)
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_codigo text := disc_interno.normalizar_codigo(p_codigo);
  pr public.processos%rowtype;
  a jsonb;
begin
  if v_codigo = '' then return disc_interno.erro('Link inválido ou avaliação encerrada. Fale com quem enviou o link.'); end if;
  select * into pr from public.processos where codigo = v_codigo;
  if not found or not pr.ativo then
    return disc_interno.erro('Link inválido ou avaliação encerrada. Fale com quem enviou o link.');
  end if;
  a := jsonb_build_object('codigo', pr.codigo, 'nome', pr.nome, 'tipo', pr.tipo,
    'empresaNome', pr.empresa, 'mostrarResultado', pr.mostrar_resultado);
  return (jsonb_build_object('ok', true, 'avaliacao', a) || a)::json;
end;
$$;

-- Envio do candidato: valida tudo como o Code.gs, recalcula D/I/S/C e perfil, gera o protocolo
-- e grava. Idempotente pelo id do payload (reenvio devolve o mesmo protocolo com duplicado:true).
create or replace function public.enviar_resposta(p_payload jsonb)
returns json
language plpgsql
volatile
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  v jsonb;
  pl jsonb;
  d jsonb;
  existente public.respostas%rowtype;
  pr public.processos%rowtype;
  v_protocolo text;
begin
  if p_payload is null then return disc_interno.erro('Dados do teste ausentes.'); end if;
  if char_length(p_payload::text) > 20000 then return disc_interno.erro('Requisição grande demais.'); end if;
  v := disc_interno.validar_payload(p_payload);
  if not (v ->> 'ok')::boolean then return v::json; end if;
  pl := v -> 'payload';
  d := v -> 'disc';

  -- Uma gravação por vez (protocolo único e limites sem corrida).
  perform pg_advisory_xact_lock(hashtext('disc_enviar_resposta'));

  select * into existente from public.respostas where id = pl ->> 'id';
  if found then
    v_protocolo := existente.protocolo;
    if v_protocolo is null then
      begin
        v_protocolo := disc_interno.gerar_protocolo();
      exception when others then
        return disc_interno.erro(sqlerrm);
      end;
      update public.respostas set protocolo = v_protocolo where id = existente.id;
    end if;
    return json_build_object('ok', true, 'duplicado', true, 'id', existente.id, 'protocolo', v_protocolo);
  end if;

  if pl ->> 'avaliacao' <> '' then
    select * into pr from public.processos where codigo = pl ->> 'avaliacao';
    if not found or not pr.ativo then return disc_interno.erro('Este link de avaliação não está mais ativo.'); end if;
  end if;

  if (select count(*) from public.respostas) >= 2000 then
    return disc_interno.erro('Limite de respostas atingido. Avise o recrutador.');
  end if;

  begin
    v_protocolo := disc_interno.gerar_protocolo();
  exception when others then
    return disc_interno.erro(sqlerrm);
  end;

  if (select count(*) from public.respostas r where r.recebido_em > now() - interval '10 minutes') >= 40 then
    return disc_interno.erro('Muitos envios em pouco tempo. Aguarde alguns minutos e tente novamente.');
  end if;

  insert into public.respostas (id, processo_id, avaliacao, protocolo, recebido_em, nome, telefone, idade, vaga,
    funcao, empresa, inicio, fim, duracao_seg, respostas, d, i, s, c, perfil, validacao, status, observacoes, payload)
  values (pl ->> 'id', pr.id, pl ->> 'avaliacao', v_protocolo, now(), pl ->> 'nome', pl ->> 'telefone',
    (pl ->> 'idade')::int, pl ->> 'vaga', pl ->> 'funcao', pl ->> 'empresa',
    nullif(pl ->> 'inicio', '')::timestamptz, nullif(pl ->> 'fim', '')::timestamptz,
    (pl ->> 'duracaoSeg')::int, pl ->> 'respostas',
    (d #>> '{percentuais,D}')::numeric, (d #>> '{percentuais,I}')::numeric,
    (d #>> '{percentuais,S}')::numeric, (d #>> '{percentuais,C}')::numeric,
    d ->> 'codigo', pl -> 'validacao', 'em_analise', '', pl);

  return json_build_object('ok', true, 'id', pl ->> 'id', 'protocolo', v_protocolo);
end;
$$;

-- Relatório público: só se publicado. Nunca devolve o id da lista do ClickUp.
create or replace function public.relatorio_publico(p_token text)
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r public.relatorios%rowtype;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{32,128}$' then
    return disc_interno.erro('Relatório não encontrado ou fora do ar.');
  end if;
  select * into r from public.relatorios where token = p_token;
  if not found or r.status <> 'publicado' then
    return disc_interno.erro('Relatório não encontrado ou fora do ar.');
  end if;
  return json_build_object('ok', true,
    'relatorio', r.dados #- '{processo,clickupListId}' #- '{processo,clickup_list_id}',
    'publicadoEm', disc_interno.iso(r.publicado_em));
end;
$$;

-- -----------------------------------------------------------------------------
-- Funções para o usuário logado (authenticated)
-- -----------------------------------------------------------------------------

-- Primeiro acesso: se ainda não existe nenhum admin, quem está logado vira admin.
-- Devolve {ok:true, admin:bool, primeiro?:true}. Depois do primeiro, só admin adiciona admin.
create or replace function public.garantir_primeiro_admin()
returns json
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_nome text;
begin
  if v_uid is null then
    return json_build_object('ok', false, 'erro', 'Sessão expirada. Entre de novo.', 'sessaoExpirada', true);
  end if;
  if exists (select 1 from public.admins where user_id = v_uid) then
    return json_build_object('ok', true, 'admin', true);
  end if;
  lock table public.admins in share row exclusive mode;
  if exists (select 1 from public.admins) then
    return json_build_object('ok', true, 'admin', false);
  end if;
  select coalesce(nullif(disc_interno.limpar_texto(u.raw_user_meta_data ->> 'nome', 120), ''),
                  nullif(disc_interno.limpar_texto(u.raw_user_meta_data ->> 'name', 120), ''),
                  coalesce(u.email, ''))
    into v_nome from auth.users u where u.id = v_uid;
  if not found then
    return json_build_object('ok', false, 'erro', 'Sessão expirada. Entre de novo.', 'sessaoExpirada', true);
  end if;
  insert into public.admins (user_id, nome) values (v_uid, left(coalesce(v_nome, ''), 120));
  return json_build_object('ok', true, 'admin', true, 'primeiro', true);
end;
$$;

-- -----------------------------------------------------------------------------
-- RLS e políticas: anon nada; authenticated só se e_admin()
-- -----------------------------------------------------------------------------

alter table public.admins        enable row level security;
alter table public.processos     enable row level security;
alter table public.respostas     enable row level security;
alter table public.relatorios    enable row level security;
alter table public.configuracoes enable row level security;

drop policy if exists admins_admin on public.admins;
create policy admins_admin on public.admins for all to authenticated
  using (public.e_admin()) with check (public.e_admin());

drop policy if exists processos_admin on public.processos;
create policy processos_admin on public.processos for all to authenticated
  using (public.e_admin()) with check (public.e_admin());

drop policy if exists respostas_admin on public.respostas;
create policy respostas_admin on public.respostas for all to authenticated
  using (public.e_admin()) with check (public.e_admin());

drop policy if exists relatorios_admin on public.relatorios;
create policy relatorios_admin on public.relatorios for all to authenticated
  using (public.e_admin()) with check (public.e_admin());

drop policy if exists configuracoes_admin on public.configuracoes;
create policy configuracoes_admin on public.configuracoes for all to authenticated
  using (public.e_admin()) with check (public.e_admin());

-- -----------------------------------------------------------------------------
-- Permissões explícitas (o Supabase dá "all" a anon/authenticated por padrão: aqui fechamos)
-- -----------------------------------------------------------------------------

revoke all on public.admins, public.processos, public.respostas, public.relatorios, public.configuracoes from public;

do $$
declare
  papel text;
begin
  foreach papel in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = papel) then
      execute format('revoke all on public.admins, public.processos, public.respostas, public.relatorios, public.configuracoes from %I', papel);
      execute format('revoke all on all functions in schema disc_interno from %I', papel);
    end if;
  end loop;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant select, insert, update, delete on public.admins to authenticated;
    grant select, insert, update, delete on public.processos to authenticated;
    grant select, delete on public.respostas to authenticated;
    grant update (status, observacoes) on public.respostas to authenticated; -- o resto só pelo servidor
    grant select, insert, update, delete on public.relatorios to authenticated;
    grant select, insert, update, delete on public.configuracoes to authenticated;
  end if;

  -- Edge Functions (service role) acessam tudo.
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant usage on schema disc_interno to service_role;
    grant all on public.admins, public.processos, public.respostas, public.relatorios, public.configuracoes to service_role;
  end if;
end $$;

revoke all on all functions in schema disc_interno from public;

revoke all on function public.e_admin() from public;
revoke all on function public.avaliacao_publica(text) from public;
revoke all on function public.enviar_resposta(jsonb) from public;
revoke all on function public.relatorio_publico(text) from public;
revoke all on function public.garantir_primeiro_admin() from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.e_admin() from anon;
    revoke all on function public.garantir_primeiro_admin() from anon;
    grant execute on function public.avaliacao_publica(text) to anon;
    grant execute on function public.enviar_resposta(jsonb) to anon;
    grant execute on function public.relatorio_publico(text) to anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.e_admin() to authenticated;
    grant execute on function public.garantir_primeiro_admin() to authenticated;
    grant execute on function public.avaliacao_publica(text) to authenticated;
    grant execute on function public.enviar_resposta(jsonb) to authenticated;
    grant execute on function public.relatorio_publico(text) to authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.e_admin(), public.garantir_primeiro_admin(), public.avaliacao_publica(text),
      public.enviar_resposta(jsonb), public.relatorio_publico(text) to service_role;
    grant execute on all functions in schema disc_interno to service_role;
  end if;
end $$;
