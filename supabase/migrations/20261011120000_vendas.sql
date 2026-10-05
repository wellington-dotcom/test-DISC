-- =============================================================================
-- Teste DISC — rodada 5: venda direta ao público (B2C) — "Mapa de Perfil" com pagamento (Asaas).
-- Roda DEPOIS de 20261005120000_disc.sql … 20261010120000_mover_versao.sql (7ª migração).
-- Idempotente e seguro sobre dados reais: só ACRESCENTA (tabelas novas, colunas com valor padrão, sementes
-- "on conflict do nothing") e recria funções; nada é apagado. Respostas que já existem viram origem 'processo'.
-- É aplicada sozinha pela integração do GitHub do Supabase no push; à mão: colar no SQL Editor e "Run".
--
--   * respostas.origem ('processo' | 'pessoal') e respostas.token_resumo (64 hex, só nas pessoais).
--     As respostas pessoais NÃO têm processo, protocolo, idade nem empresa; o WhatsApp é opcional (com ele, a
--     ficha da pessoa é criada/ligada pelo gatilho de sempre). Não contam nos limites do recrutamento
--     (2000 respostas / 40 por 10 minutos): enviar_resposta é recriada igual à 20261009 com esses limites só
--     sobre origem 'processo'.
--   * public.pacotes (gratis, completo, completo_plus — preços em centavos, preço de lançamento com data),
--     public.cupons ('percentual' 1–100 ou 'valor' em centavos; usos contam quando o pedido é pago/cortesia),
--     public.pedidos (token_acesso = link do relatório pago) e public.limites_vendas (anti-abuso).
--   * Tokens (token_resumo, token_acesso): 64 caracteres hexadecimais de gen_random_uuid() ×2 (gerador
--     criptográfico do Postgres, o mesmo de gen_random_bytes; 244 bits aleatórios) — nunca adivinháveis.
--   * Funções públicas (anon): enviar_resposta_pessoal, resumo_pessoal, pacotes_publicos, criar_pedido,
--     status_pedido, relatorio_pessoal (SÓ pedido 'pago'/'cortesia'), salvar_parte2_pessoal. Nenhuma devolve
--     e-mail, telefone ou ids internos além do próprio pedido.
--   * Painel (admin, RLS): lê pedidos; cupons (tudo); pacotes (lê e altera preço/nome/ativo/ordem/descrição);
--     atualizar_pedido (estornar, liberar cortesia, cancelar, marcar pago) e resumo_vendas.
--   * Edge Functions "pagamento" e "asaas-webhook" (service_role) marcam pago/estornado direto na tabela; o
--     gatilho pedidos_antes_gravar carimba as datas e conta o uso do cupom (uma vez por pedido).
--   * versao_banco() passa a conhecer esta migração (versão 20261011120000).
-- ATENÇÃO: não rode de novo as migrações anteriores depois desta sem rodar esta em seguida (elas recriam
-- enviar_resposta e versao_banco nas versões antigas).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- respostas: origem e token do resumo grátis
-- -----------------------------------------------------------------------------

alter table public.respostas add column if not exists origem text not null default 'processo';
alter table public.respostas add column if not exists token_resumo text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'respostas_origem_valida'
                 and conrelid = 'public.respostas'::regclass) then
    alter table public.respostas add constraint respostas_origem_valida check (origem in ('processo', 'pessoal'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'respostas_token_resumo_formato'
                 and conrelid = 'public.respostas'::regclass) then
    alter table public.respostas add constraint respostas_token_resumo_formato
      check (token_resumo is null or token_resumo ~ '^[0-9a-f]{64}$');
  end if;
end $$;

create unique index if not exists respostas_token_resumo_idx on public.respostas (token_resumo) where token_resumo is not null;
create index if not exists respostas_pessoal_email_idx on public.respostas (email, recebido_em) where origem = 'pessoal';
create index if not exists respostas_origem_idx on public.respostas (origem, recebido_em);

-- -----------------------------------------------------------------------------
-- Tabelas de venda
-- -----------------------------------------------------------------------------

create table if not exists public.pacotes (
  chave                     text primary key check (chave ~ '^[a-z0-9_]{2,30}$'),
  nome                      text not null check (char_length(btrim(nome)) between 1 and 80),
  preco_centavos            int not null default 0 check (preco_centavos between 0 and 10000000),
  preco_lancamento_centavos int check (preco_lancamento_centavos is null or preco_lancamento_centavos between 0 and 10000000),
  lancamento_ate            date,
  ativo                     boolean not null default true,
  ordem                     int not null default 0 check (ordem between -1000 and 1000),
  descricao                 jsonb not null default '{}'::jsonb
                            check (jsonb_typeof(descricao) = 'object' and char_length(descricao::text) <= 20000),
  atualizado_em             timestamptz not null default now()
);

insert into public.pacotes (chave, nome, preco_centavos, preco_lancamento_centavos, lancamento_ate, ativo, ordem, descricao) values
  ('gratis', 'Resumo grátis', 0, null, null, true, 1,
   '{"subtitulo":"Seu perfil em uma frase","itens":["Seu perfil em uma frase","O nome da sua combinação","Os 4 fatores com barras","3 forças"]}'),
  ('completo', 'Relatório completo', 3900, 2900, null, true, 2,
   '{"subtitulo":"Entenda o que está te travando e como destravar","itens":["Relatório completo do seu perfil","Régua de intensidade dos 4 fatores","O que está te travando — com 1 ação para cada ponto","Plano prático de 30, 60 e 90 dias","Versão para imprimir ou salvar em PDF","Acesso pelo link para sempre"]}'),
  ('completo_plus', 'Completo + Parte 2', 6900, 4900, null, true, 3,
   '{"subtitulo":"Tudo do completo + como o seu trabalho exige que você seja","itens":["Tudo do Relatório completo","Parte 2: como o seu trabalho/rotina exige que você seja","Onde você está se esticando","Mapa ritmo × foco","Plano de 90 dias estendido"]}')
on conflict (chave) do nothing;

create table if not exists public.cupons (
  codigo     text primary key check (codigo ~ '^[A-Z0-9_-]{3,30}$'),
  tipo       text not null check (tipo in ('percentual', 'valor')),
  valor      int not null check (valor > 0 and (tipo <> 'percentual' or valor <= 100) and valor <= 10000000),
  usos_max   int check (usos_max is null or usos_max between 1 and 1000000),
  usos       int not null default 0 check (usos >= 0),
  valido_ate date,
  ativo      boolean not null default true,
  pacotes    text[] not null default '{}'::text[] check (cardinality(pacotes) <= 20),
  descricao  text not null default '' check (char_length(descricao) <= 200),
  criado_em  timestamptz not null default now()
);

create table if not exists public.pedidos (
  id                      uuid primary key default gen_random_uuid(),
  resposta_id             text references public.respostas (id) on delete set null,
  pacote                  text not null references public.pacotes (chave) on update cascade,
  valor_centavos          int not null check (valor_centavos between 0 and 10000000),
  valor_original_centavos int not null default 0 check (valor_original_centavos between 0 and 10000000),
  cupom                   text check (cupom is null or cupom ~ '^[A-Z0-9_-]{3,30}$'),
  status                  text not null default 'aguardando'
                          check (status in ('aguardando', 'pago', 'cortesia', 'estornado', 'cancelado')),
  metodo                  text not null default '' check (metodo in ('', 'pix', 'cartao', 'boleto', 'cupom', 'manual')),
  asaas_cobranca_id       text check (asaas_cobranca_id is null or asaas_cobranca_id ~ '^[A-Za-z0-9_-]{1,80}$'),
  pagamento               jsonb check (pagamento is null or (jsonb_typeof(pagamento) = 'object' and char_length(pagamento::text) <= 60000)),
  email                   text not null default '' check (char_length(email) <= 120),
  nome                    text not null default '' check (char_length(nome) <= 120),
  token_acesso            text not null unique
                          default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
                          check (token_acesso ~ '^[0-9a-f]{64}$'),
  criado_em               timestamptz not null default now(),
  atualizado_em           timestamptz not null default now(),
  pago_em                 timestamptz,
  reembolsado_em          timestamptz,
  verificado_em           timestamptz
);
create index if not exists pedidos_resposta_idx on public.pedidos (resposta_id);
create index if not exists pedidos_criado_idx on public.pedidos (criado_em);
create index if not exists pedidos_email_idx on public.pedidos (email);
create unique index if not exists pedidos_cobranca_idx on public.pedidos (asaas_cobranca_id) where asaas_cobranca_id is not null;

-- Contador simples para limites anti-abuso (tentativas de cupom, pedidos de "recuperar acesso").
create table if not exists public.limites_vendas (
  id    bigint generated always as identity primary key,
  tipo  text not null check (tipo ~ '^[a-z_]{1,30}$'),
  chave text not null check (char_length(chave) <= 200),
  em    timestamptz not null default now()
);
create index if not exists limites_vendas_idx on public.limites_vendas (tipo, chave, em);
create index if not exists limites_vendas_em_idx on public.limites_vendas (em);

-- -----------------------------------------------------------------------------
-- Auxiliares
-- -----------------------------------------------------------------------------

-- Token aleatório de 64 hex (gen_random_uuid usa o gerador criptográfico do Postgres).
create or replace function disc_interno.token_aleatorio()
returns text language sql volatile set search_path = '' as $$
  select replace(pg_catalog.gen_random_uuid()::text, '-', '') || replace(pg_catalog.gen_random_uuid()::text, '-', '');
$$;

-- Hoje no horário de Brasília (datas de lançamento/validade de cupom).
create or replace function disc_interno.hoje_brasil()
returns date language sql stable set search_path = '' as $$
  select (now() at time zone 'America/Sao_Paulo')::date;
$$;

-- Preço que vale hoje (centavos): lançamento se houver e ainda estiver no prazo (sem data = sem fim).
create or replace function disc_interno.preco_atual(p public.pacotes)
returns int language sql stable set search_path = '' as $$
  select case when p.preco_lancamento_centavos is not null
               and (p.lancamento_ate is null or p.lancamento_ate >= disc_interno.hoje_brasil())
              then p.preco_lancamento_centavos else p.preco_centavos end;
$$;

-- Primeiro nome (o que as funções públicas mostram).
create or replace function disc_interno.primeiro_nome(p text)
returns text language sql immutable set search_path = '' as $$
  select coalesce(nullif(split_part(btrim(coalesce(p, '')), ' ', 1), ''), '');
$$;

create or replace function disc_interno.token_valido(p text)
returns boolean language sql immutable set search_path = '' as $$
  select p is not null and p ~ '^[0-9a-f]{64}$';
$$;

-- Resultado (percentuais e código) a partir da linha da resposta.
create or replace function disc_interno.resultado_resposta(r public.respostas)
returns json language sql stable set search_path = '' as $$
  select json_build_object('percentuais', json_build_object('D', r.d, 'I', r.i, 'S', r.s, 'C', r.c), 'codigo', r.perfil);
$$;

-- Registra uma tentativa e diz quantas houve na janela (inclui a atual). Limpa o que tem mais de 2 dias.
create or replace function disc_interno.contar_tentativa(p_tipo text, p_chave text, p_janela interval)
returns int language plpgsql volatile security definer set search_path = '' as $$
declare
  n int;
begin
  delete from public.limites_vendas where em < now() - interval '2 days';
  insert into public.limites_vendas (tipo, chave) values (p_tipo, left(coalesce(p_chave, ''), 200));
  select count(*) into n from public.limites_vendas where tipo = p_tipo and chave = left(coalesce(p_chave, ''), 200)
    and em > now() - p_janela;
  return n;
end;
$$;

-- Pedido -> JSON do painel.
create or replace function disc_interno.pedido_json(p public.pedidos)
returns json language sql stable set search_path = '' as $$
  select json_build_object('id', p.id, 'respostaId', coalesce(p.resposta_id, ''), 'pacote', p.pacote,
    'valorCentavos', p.valor_centavos, 'valorOriginalCentavos', p.valor_original_centavos, 'cupom', coalesce(p.cupom, ''),
    'status', p.status, 'metodo', p.metodo, 'asaasCobrancaId', coalesce(p.asaas_cobranca_id, ''),
    'email', p.email, 'nome', p.nome, 'criadoEm', disc_interno.iso(p.criado_em), 'pagoEm', disc_interno.iso(p.pago_em),
    'reembolsadoEm', disc_interno.iso(p.reembolsado_em));
$$;

-- -----------------------------------------------------------------------------
-- Gatilhos
-- -----------------------------------------------------------------------------

-- pedidos: id/token/resposta não mudam; carimba datas; o cupom conta 1 uso quando o pedido vira pago/cortesia
-- (uma vez só: voltar de estornado para pago não conta de novo).
create or replace function disc_interno.pedidos_antes_gravar()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  liberado boolean := new.status in ('pago', 'cortesia');
begin
  if tg_op = 'UPDATE' then
    if new.id <> old.id or new.token_acesso <> old.token_acesso
       or new.resposta_id is distinct from old.resposta_id and new.resposta_id is not null then
      raise exception 'Pedido: identificação não pode mudar.';
    end if;
    new.atualizado_em := now();
  end if;
  if liberado and (tg_op = 'INSERT' or old.status not in ('pago', 'cortesia')) then
    new.pago_em := coalesce(new.pago_em, now());
    if new.cupom is not null and (tg_op = 'INSERT' or old.pago_em is null) then
      update public.cupons set usos = usos + 1 where codigo = new.cupom;
    end if;
  end if;
  if new.status = 'estornado' and (tg_op = 'INSERT' or old.status <> 'estornado') then
    new.reembolsado_em := coalesce(new.reembolsado_em, now());
  end if;
  return new;
end;
$$;

drop trigger if exists pedidos_antes_gravar on public.pedidos;
create trigger pedidos_antes_gravar before insert or update on public.pedidos
  for each row execute function disc_interno.pedidos_antes_gravar();

create or replace function disc_interno.pacotes_antes_gravar()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;

drop trigger if exists pacotes_antes_gravar on public.pacotes;
create trigger pacotes_antes_gravar before update on public.pacotes
  for each row execute function disc_interno.pacotes_antes_gravar();

-- -----------------------------------------------------------------------------
-- Envio do processo seletivo: igual à 20261009, mas os limites (2000 respostas e 40 envios por 10 minutos)
-- contam só as respostas de processo (as pessoais têm limites próprios em enviar_resposta_pessoal).
-- -----------------------------------------------------------------------------

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
  v_form jsonb := null;
  v_cod text;
  v_pessoa uuid;
  v_exigido text := null;
  v_modo_foto text;
  v_foto text := null;
begin
  if p_payload is null then return disc_interno.erro('Dados do teste ausentes.'); end if;
  if char_length(p_payload::text) > 80000 then return disc_interno.erro('Requisição grande demais.'); end if;

  -- Formulário do processo do link (link inexistente/desativado: padrão; a recusa vem logo abaixo).
  if jsonb_typeof(p_payload) = 'object' then
    v_cod := disc_interno.normalizar_codigo(disc_interno.texto(p_payload -> 'avaliacao'));
    if v_cod <> '' then
      select pp.config -> 'formulario' into v_form from public.processos pp where pp.codigo = v_cod and pp.ativo;
    end if;
  end if;

  v := disc_interno.validar_envio(p_payload, v_form);
  if not (v ->> 'ok')::boolean then return v::json; end if;
  pl := v -> 'payload';
  d := v -> 'disc';

  -- Parte 2: obrigatória e validada só com o formulário 'ligada'; senão o que vier é descartado.
  if disc_interno.normalizar_formulario(v_form) ->> 'parte2' = 'ligada' then
    v_exigido := case when jsonb_typeof(p_payload -> 'exigido') = 'string' then btrim(p_payload ->> 'exigido') else '' end;
    if not disc_interno.exigido_valido(v_exigido) then
      return disc_interno.erro('Responda também a segunda parte do teste.');
    end if;
    pl := pl || jsonb_build_object('exigido', v_exigido);
  end if;

  -- Foto (formulario.campos.foto): 'oculto' descarta; 'obrigatorio' exige; vazia = sem foto.
  v_modo_foto := disc_interno.normalizar_formulario(v_form) #>> '{campos,foto}';
  if v_modo_foto <> 'oculto' then
    v_foto := case when jsonb_typeof(p_payload -> 'foto') = 'string' then btrim(p_payload ->> 'foto') else '' end;
    if v_foto = '' then
      if v_modo_foto = 'obrigatorio' then return disc_interno.erro('Envie uma foto.'); end if;
      v_foto := null;
    elsif not disc_interno.foto_valida(v_foto) then
      return disc_interno.erro('Foto inválida ou grande demais. Escolha outra imagem.');
    end if;
  end if;

  -- Uma gravação por vez (protocolo único e limites sem corrida).
  perform pg_advisory_xact_lock(hashtext('disc_enviar_resposta'));

  select * into existente from public.respostas where id = pl ->> 'id';
  if found then
    if existente.origem = 'pessoal' then return disc_interno.erro('Identificador do envio inválido.'); end if;
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

  if (select count(*) from public.respostas r where r.origem = 'processo') >= 2000 then
    return disc_interno.erro('Limite de respostas atingido. Avise o recrutador.');
  end if;

  begin
    v_protocolo := disc_interno.gerar_protocolo();
  exception when others then
    return disc_interno.erro(sqlerrm);
  end;

  if (select count(*) from public.respostas r where r.origem = 'processo'
        and r.recebido_em > now() - interval '10 minutes') >= 40 then
    return disc_interno.erro('Muitos envios em pouco tempo. Aguarde alguns minutos e tente novamente.');
  end if;

  -- Ficha da pessoa: nome do envio e campos NÃO vazios do envio (vazio não apaga o que já havia; a foto
  -- nova substitui a antiga, sem foto mantém a que havia).
  insert into public.pessoas as pe (telefone, nome, idade, funcao, empresa, email, cidade, foto)
  values (pl ->> 'telefone', pl ->> 'nome', (pl ->> 'idade')::int, pl ->> 'funcao', pl ->> 'empresa',
    pl ->> 'email', pl ->> 'cidade', v_foto)
  on conflict (telefone) do update set
    nome = excluded.nome,
    idade = coalesce(excluded.idade, pe.idade),
    funcao = coalesce(nullif(excluded.funcao, ''), pe.funcao),
    empresa = coalesce(nullif(excluded.empresa, ''), pe.empresa),
    email = coalesce(nullif(excluded.email, ''), pe.email),
    cidade = coalesce(nullif(excluded.cidade, ''), pe.cidade),
    foto = coalesce(excluded.foto, pe.foto)
  returning id into v_pessoa;

  insert into public.respostas (id, processo_id, avaliacao, protocolo, recebido_em, nome, telefone, idade, vaga,
    funcao, empresa, email, cidade, extras, pessoa_id, inicio, fim, duracao_seg, respostas, exigido, foto, d, i, s, c, perfil,
    validacao, status, observacoes, payload)
  values (pl ->> 'id', pr.id, pl ->> 'avaliacao', v_protocolo, now(), pl ->> 'nome', pl ->> 'telefone',
    (pl ->> 'idade')::int, pl ->> 'vaga', pl ->> 'funcao', pl ->> 'empresa', pl ->> 'email', pl ->> 'cidade',
    pl -> 'extras', v_pessoa,
    nullif(pl ->> 'inicio', '')::timestamptz, nullif(pl ->> 'fim', '')::timestamptz,
    (pl ->> 'duracaoSeg')::int, pl ->> 'respostas', v_exigido, v_foto,
    (d #>> '{percentuais,D}')::numeric, (d #>> '{percentuais,I}')::numeric,
    (d #>> '{percentuais,S}')::numeric, (d #>> '{percentuais,C}')::numeric,
    d ->> 'codigo', pl -> 'validacao', 'em_analise', '', pl);

  -- Teste de equipe: quem responde pelo link de um processo 'equipe' ligado a uma empresa vira colaborador
  -- ativo dela (cargo = função informada), se ainda não tiver vínculo ativo em NENHUMA empresa.
  if pr.id is not null and pr.tipo = 'equipe' and pr.empresa_id is not null
     and not exists (select 1 from public.vinculos vi where vi.pessoa_id = v_pessoa and vi.status = 'ativo') then
    insert into public.vinculos (pessoa_id, empresa_id, cargo, status)
    values (v_pessoa, pr.empresa_id, left(coalesce(pl ->> 'funcao', ''), 120), 'ativo')
    on conflict do nothing;
  end if;

  return json_build_object('ok', true, 'id', pl ->> 'id', 'protocolo', v_protocolo);
end;
$$;

-- -----------------------------------------------------------------------------
-- Funções públicas (anon) da venda direta
-- -----------------------------------------------------------------------------

-- Envio do teste "pessoal" (sem processo): nome, e-mail (obrigatório — é a "conta"), WhatsApp opcional,
-- consentimento, respostas (e, opcional, a Parte 2 em "exigido"). Idade, função, empresa, cidade e foto são
-- ignoradas. Limites: 2 envios por minuto e 20 por dia por e-mail; 120 envios pessoais por 10 minutos no total.
-- Reenvio do mesmo id (mesmo e-mail): devolve o mesmo tokenResumo (duplicado: true).
-- {ok, id, protocolo: '', tokenResumo} | {ok:false, erro}
create or replace function public.enviar_resposta_pessoal(p_payload jsonb)
returns json
language plpgsql
volatile
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  form constant jsonb := '{"campos":{"idade":"oculto","funcao":"oculto","empresa":"oculto","email":"obrigatorio","cidade":"oculto","foto":"oculto"}}';
  v jsonb;
  pl jsonb;
  d jsonb;
  p jsonb;
  v_email text;
  v_tel text := '';
  v_exigido text := null;
  v_token text;
  existente public.respostas%rowtype;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then return disc_interno.erro('Dados do teste ausentes.'); end if;
  if char_length(p_payload::text) > 20000 then return disc_interno.erro('Requisição grande demais.'); end if;

  v_email := lower(disc_interno.limpar_texto(disc_interno.texto(p_payload -> 'email'), 120));
  if v_email = '' then return disc_interno.erro('Informe o seu e-mail.'); end if;
  if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then return disc_interno.erro('E-mail inválido.'); end if;

  -- WhatsApp opcional (validar_envio exige telefone: com ele vazio, valida com um número neutro e grava '').
  if btrim(disc_interno.texto(p_payload -> 'telefone')) <> '' then
    v_tel := disc_interno.normalizar_telefone(p_payload -> 'telefone');
    if v_tel = '' then return disc_interno.erro('WhatsApp inválido. Informe DDD + número.'); end if;
  end if;
  p := (p_payload - 'avaliacao' - 'idade' - 'foto' - 'extras')
    || jsonb_build_object('telefone', case when v_tel = '' then '11900000000' else v_tel end, 'email', v_email);

  v := disc_interno.validar_envio(p, form);
  if not (v ->> 'ok')::boolean then return v::json; end if;
  pl := v -> 'payload';
  d := v -> 'disc';
  pl := pl || jsonb_build_object('telefone', v_tel, 'origem', 'pessoal');

  if jsonb_typeof(p_payload -> 'exigido') = 'string' and btrim(p_payload ->> 'exigido') <> '' then
    v_exigido := btrim(p_payload ->> 'exigido');
    if not disc_interno.exigido_valido(v_exigido) then return disc_interno.erro('Respostas da segunda parte inválidas.'); end if;
    pl := pl || jsonb_build_object('exigido', v_exigido);
  end if;

  perform pg_advisory_xact_lock(hashtext('disc_enviar_resposta'));

  select * into existente from public.respostas where id = pl ->> 'id';
  if found then
    if existente.origem <> 'pessoal' or existente.email <> v_email or existente.token_resumo is null then
      return disc_interno.erro('Identificador do envio inválido.');
    end if;
    return json_build_object('ok', true, 'duplicado', true, 'id', existente.id, 'protocolo', '', 'tokenResumo', existente.token_resumo);
  end if;

  if (select count(*) from public.respostas r where r.origem = 'pessoal' and r.email = v_email
      and r.recebido_em > now() - interval '1 minute') >= 2 then
    return disc_interno.erro('Muitos envios em pouco tempo. Aguarde um minuto e tente de novo.');
  end if;
  if (select count(*) from public.respostas r where r.origem = 'pessoal' and r.email = v_email
      and r.recebido_em > now() - interval '1 day') >= 20 then
    return disc_interno.erro('Limite de testes por dia para este e-mail atingido. Tente de novo amanhã.');
  end if;
  if (select count(*) from public.respostas r where r.origem = 'pessoal'
      and r.recebido_em > now() - interval '10 minutes') >= 120 then
    return disc_interno.erro('Muitos envios em pouco tempo. Aguarde alguns minutos e tente novamente.');
  end if;

  v_token := disc_interno.token_aleatorio();
  -- pessoa_id nulo: com WhatsApp, o gatilho respostas_ligar_pessoa liga/cria a ficha (só preenche o que falta).
  insert into public.respostas (id, processo_id, avaliacao, protocolo, recebido_em, nome, telefone, idade, vaga,
    funcao, empresa, email, cidade, extras, inicio, fim, duracao_seg, respostas, exigido, d, i, s, c, perfil,
    validacao, status, observacoes, payload, origem, token_resumo)
  values (pl ->> 'id', null, '', null, now(), pl ->> 'nome', v_tel, null, '', '', '', v_email, '', '[]'::jsonb,
    nullif(pl ->> 'inicio', '')::timestamptz, nullif(pl ->> 'fim', '')::timestamptz,
    (pl ->> 'duracaoSeg')::int, pl ->> 'respostas', v_exigido,
    (d #>> '{percentuais,D}')::numeric, (d #>> '{percentuais,I}')::numeric,
    (d #>> '{percentuais,S}')::numeric, (d #>> '{percentuais,C}')::numeric,
    d ->> 'codigo', pl -> 'validacao', 'em_analise', '', pl, 'pessoal', v_token);

  return json_build_object('ok', true, 'id', pl ->> 'id', 'protocolo', '', 'tokenResumo', v_token);
end;
$$;

-- Resumo grátis: só primeiro nome, percentuais e código. {ok, nome, resultado:{percentuais, codigo}, recebidoEm, temParte2}
create or replace function public.resumo_pessoal(p_token text)
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r public.respostas%rowtype;
begin
  if not disc_interno.token_valido(p_token) then return disc_interno.erro('Resultado não encontrado. Faça o teste de novo.'); end if;
  select * into r from public.respostas x where x.token_resumo = p_token and x.origem = 'pessoal';
  if not found then return disc_interno.erro('Resultado não encontrado. Faça o teste de novo.'); end if;
  return json_build_object('ok', true, 'nome', disc_interno.primeiro_nome(r.nome),
    'resultado', disc_interno.resultado_resposta(r), 'recebidoEm', disc_interno.iso(r.recebido_em),
    'temParte2', r.exigido is not null);
end;
$$;

-- Pacotes à venda (ativos, na ordem). Preços em centavos; valorCentavos = o que vale hoje.
create or replace function public.pacotes_publicos()
returns json
language sql
stable
security definer
set search_path = ''
as $$
  select json_build_object('ok', true, 'pacotes', coalesce(json_agg(json_build_object(
    'chave', p.chave, 'nome', p.nome, 'precoCentavos', p.preco_centavos,
    'precoLancamentoCentavos', p.preco_lancamento_centavos,
    'lancamentoAte', coalesce(to_char(p.lancamento_ate, 'YYYY-MM-DD'), ''),
    'valorCentavos', disc_interno.preco_atual(p), 'emLancamento', disc_interno.preco_atual(p) <> p.preco_centavos,
    'descricao', p.descricao, 'ordem', p.ordem) order by p.ordem, p.chave), '[]'::json))
  from public.pacotes p where p.ativo;
$$;

-- Cria o pedido de um pacote pago para a resposta do token do resumo.
--  * cupom (opcional): 'percentual' ou 'valor'; inválido/expirado/esgotado/de outro pacote -> "Cupom inválido ou
--    expirado." (10 tentativas erradas por 10 minutos por resposta, depois bloqueia).
--  * valor final 0 (cupom 100%) -> status 'cortesia' já liberado (gratuito: true).
--  * Já pago/cortesia o mesmo pacote para esta resposta -> devolve aquele pedido (jaPago: true).
--  * Pedido 'aguardando' igual (pacote, cupom, valor) das últimas 24 h -> devolve o mesmo (sem duplicar).
--  * No máximo 10 pedidos novos por resposta por hora.
-- {ok, pedidoId, tokenAcesso, valor (centavos), valorOriginal, gratuito, status, jaPago?}
create or replace function public.criar_pedido(p_token_resumo text, p_pacote text, p_cupom text default null)
returns json
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r public.respostas%rowtype;
  pa public.pacotes%rowtype;
  cu public.cupons%rowtype;
  pe public.pedidos%rowtype;
  v_cupom text := upper(regexp_replace(coalesce(p_cupom, ''), '\s+', '', 'g'));
  v_base int;
  v_valor int;
begin
  if not disc_interno.token_valido(p_token_resumo) then return disc_interno.erro('Resultado não encontrado. Faça o teste de novo.'); end if;
  select * into r from public.respostas x where x.token_resumo = p_token_resumo and x.origem = 'pessoal';
  if not found then return disc_interno.erro('Resultado não encontrado. Faça o teste de novo.'); end if;

  select * into pa from public.pacotes x where x.chave = left(coalesce(p_pacote, ''), 40) and x.ativo;
  if not found then return disc_interno.erro('Pacote indisponível. Escolha outro.'); end if;
  v_base := disc_interno.preco_atual(pa);
  if v_base <= 0 then return disc_interno.erro('Este pacote é gratuito: o seu resumo já está liberado.'); end if;

  perform pg_advisory_xact_lock(hashtext('disc_pedido:' || r.id));

  select * into pe from public.pedidos x where x.resposta_id = r.id and x.pacote = pa.chave and x.status in ('pago', 'cortesia')
    order by x.criado_em desc limit 1;
  if found then
    return json_build_object('ok', true, 'pedidoId', pe.id, 'tokenAcesso', pe.token_acesso, 'valor', pe.valor_centavos,
      'valorOriginal', pe.valor_original_centavos, 'gratuito', pe.status = 'cortesia', 'status', pe.status, 'jaPago', true);
  end if;

  v_valor := v_base;
  if v_cupom <> '' then
    select * into cu from public.cupons x where x.codigo = v_cupom for update;
    if not found or not cu.ativo or v_cupom !~ '^[A-Z0-9_-]{3,30}$'
       or (cu.valido_ate is not null and cu.valido_ate < disc_interno.hoje_brasil())
       or (cu.usos_max is not null and cu.usos >= cu.usos_max)
       or (cardinality(cu.pacotes) > 0 and not (pa.chave = any (cu.pacotes))) then
      if disc_interno.contar_tentativa('cupom', r.id, interval '10 minutes') > 10 then
        return disc_interno.erro('Muitas tentativas de cupom. Aguarde alguns minutos.');
      end if;
      return disc_interno.erro('Cupom inválido ou expirado.');
    end if;
    v_valor := case when cu.tipo = 'percentual' then round(v_base * (100 - cu.valor) / 100.0)::int
                    else greatest(0, v_base - cu.valor) end;
  else
    v_cupom := null;
  end if;

  select * into pe from public.pedidos x where x.resposta_id = r.id and x.pacote = pa.chave and x.status = 'aguardando'
    and x.cupom is not distinct from v_cupom and x.valor_centavos = v_valor and x.criado_em > now() - interval '24 hours'
    order by x.criado_em desc limit 1;
  if found and v_valor > 0 then
    return json_build_object('ok', true, 'pedidoId', pe.id, 'tokenAcesso', pe.token_acesso, 'valor', pe.valor_centavos,
      'valorOriginal', pe.valor_original_centavos, 'gratuito', false, 'status', pe.status);
  end if;

  if (select count(*) from public.pedidos x where x.resposta_id = r.id and x.criado_em > now() - interval '1 hour') >= 10 then
    return disc_interno.erro('Muitos pedidos em pouco tempo. Aguarde alguns minutos.');
  end if;

  insert into public.pedidos (resposta_id, pacote, valor_centavos, valor_original_centavos, cupom, status, metodo, email, nome, token_acesso)
  values (r.id, pa.chave, v_valor, v_base, v_cupom, case when v_valor = 0 then 'cortesia' else 'aguardando' end,
    case when v_valor = 0 then 'cupom' else '' end, r.email, left(r.nome, 120), disc_interno.token_aleatorio())
  returning * into pe;

  return json_build_object('ok', true, 'pedidoId', pe.id, 'tokenAcesso', pe.token_acesso, 'valor', pe.valor_centavos,
    'valorOriginal', pe.valor_original_centavos, 'gratuito', v_valor = 0, 'status', pe.status);
end;
$$;

-- Situação do pedido (o site consulta enquanto espera o Pix). Precisa do id E do token. {ok, status, pacote}
create or replace function public.status_pedido(p_pedido text, p_token text)
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  pe public.pedidos%rowtype;
begin
  if not disc_interno.token_valido(p_token) or disc_interno.uuid_ou_nulo(to_jsonb(coalesce(p_pedido, ''))) is null then
    return disc_interno.erro('Pedido não encontrado.');
  end if;
  select * into pe from public.pedidos x where x.id = p_pedido::uuid and x.token_acesso = p_token;
  if not found then return disc_interno.erro('Pedido não encontrado.'); end if;
  return json_build_object('ok', true, 'status', pe.status, 'pacote', pe.pacote);
end;
$$;

-- Dados do relatório pago (o site monta o texto). SÓ com pedido 'pago' ou 'cortesia'.
-- {ok, nome (primeiro), resultado:{percentuais, codigo}, exigido: '40 dígitos' | null, pacote, pacoteNome,
--  precisaParte2, status} | {ok:false, erro, status?}
create or replace function public.relatorio_pessoal(p_token text)
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  pe public.pedidos%rowtype;
  r public.respostas%rowtype;
  v_nome text;
begin
  if not disc_interno.token_valido(p_token) then
    return disc_interno.erro('Link inválido. Confira o endereço ou use "Recuperar meu relatório".');
  end if;
  select * into pe from public.pedidos x where x.token_acesso = p_token;
  if not found then return disc_interno.erro('Link inválido. Confira o endereço ou use "Recuperar meu relatório".'); end if;
  if pe.status = 'aguardando' then
    return json_build_object('ok', false, 'erro', 'Pagamento ainda não confirmado.', 'status', pe.status);
  elsif pe.status = 'estornado' then
    return json_build_object('ok', false, 'erro', 'Esta compra foi estornada. O relatório não está mais disponível.', 'status', pe.status);
  elsif pe.status not in ('pago', 'cortesia') then
    return json_build_object('ok', false, 'erro', 'Pedido cancelado.', 'status', pe.status);
  end if;
  select * into r from public.respostas x where x.id = pe.resposta_id;
  if not found then return disc_interno.erro('As respostas deste relatório foram excluídas. Fale com o suporte.'); end if;
  select p.nome into v_nome from public.pacotes p where p.chave = pe.pacote;
  return json_build_object('ok', true, 'nome', disc_interno.primeiro_nome(r.nome), 'resultado', disc_interno.resultado_resposta(r),
    'exigido', r.exigido, 'pacote', pe.pacote, 'pacoteNome', coalesce(v_nome, ''), 'status', pe.status,
    'precisaParte2', pe.pacote = 'completo_plus' and r.exigido is null);
end;
$$;

-- Parte 2 depois da compra do completo_plus. Já respondida com outro conteúdo -> recusa (mesmo conteúdo = ok).
create or replace function public.salvar_parte2_pessoal(p_token text, p_exigido text)
returns json
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  pe public.pedidos%rowtype;
  r public.respostas%rowtype;
  v_ex text := btrim(coalesce(p_exigido, ''));
begin
  if not disc_interno.token_valido(p_token) then return disc_interno.erro('Link inválido.'); end if;
  select * into pe from public.pedidos x where x.token_acesso = p_token;
  if not found then return disc_interno.erro('Link inválido.'); end if;
  if pe.status not in ('pago', 'cortesia') then return disc_interno.erro('Pagamento ainda não confirmado.'); end if;
  if pe.pacote <> 'completo_plus' then return disc_interno.erro('A Parte 2 faz parte do pacote Completo + Parte 2.'); end if;
  if not disc_interno.exigido_valido(v_ex) then return disc_interno.erro('Responda todos os grupos da segunda parte.'); end if;
  select * into r from public.respostas x where x.id = pe.resposta_id for update;
  if not found then return disc_interno.erro('As respostas deste relatório foram excluídas. Fale com o suporte.'); end if;
  if r.exigido is not null and r.exigido <> v_ex then return disc_interno.erro('A segunda parte já foi respondida.'); end if;
  update public.respostas set exigido = v_ex,
    payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object('exigido', v_ex) where id = r.id;
  return json_build_object('ok', true, 'exigido', v_ex);
end;
$$;

-- -----------------------------------------------------------------------------
-- Painel (só admin)
-- -----------------------------------------------------------------------------

-- Muda a situação do pedido. Permitido:
--   'estornado' (de pago/cortesia) — o estorno do dinheiro é feito no Asaas; aqui só bloqueia o relatório;
--   'cortesia'  (de aguardando/cancelado/estornado) — "Liberar como cortesia";
--   'pago'      (de aguardando/cancelado) — confirmação manual;
--   'cancelado' (de aguardando).
create or replace function public.atualizar_pedido(p_id text, p_status text)
returns json
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  pe public.pedidos%rowtype;
  v_status text := btrim(coalesce(p_status, ''));
  v_id uuid := disc_interno.uuid_ou_nulo(to_jsonb(coalesce(p_id, '')));
begin
  if not public.e_admin() then return disc_interno.erro('Sem permissão.'); end if;
  if v_id is null then return disc_interno.erro('Pedido não encontrado.'); end if;
  select * into pe from public.pedidos x where x.id = v_id for update;
  if not found then return disc_interno.erro('Pedido não encontrado.'); end if;
  if v_status = pe.status then return json_build_object('ok', true, 'pedido', disc_interno.pedido_json(pe)); end if;
  if not ((v_status = 'estornado' and pe.status in ('pago', 'cortesia'))
       or (v_status = 'cortesia' and pe.status in ('aguardando', 'cancelado', 'estornado'))
       or (v_status = 'pago' and pe.status in ('aguardando', 'cancelado'))
       or (v_status = 'cancelado' and pe.status = 'aguardando')) then
    return disc_interno.erro('Não dá para mudar este pedido de "' || pe.status || '" para "' || v_status || '".');
  end if;
  update public.pedidos set status = v_status,
    metodo = case when v_status in ('pago', 'cortesia') then 'manual' else metodo end
  where id = v_id returning * into pe;
  return json_build_object('ok', true, 'pedido', disc_interno.pedido_json(pe));
end;
$$;

-- Números das vendas. p_periodo: 'hoje' | '7d' | '30d' (padrão) | 'mes' | 'tudo'. Valores em centavos; receita só
-- de pedidos 'pago' (cortesia não soma). conversao = compras / resumos (respostas pessoais) no período, 0–1.
create or replace function public.resumo_vendas(p_periodo text default '30d')
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  hoje date := disc_interno.hoje_brasil();
  v_ini timestamptz;
  v_hoje timestamptz := (hoje::timestamp at time zone 'America/Sao_Paulo');
  v_mes timestamptz := (date_trunc('month', hoje)::timestamp at time zone 'America/Sao_Paulo');
  v_per text := coalesce(nullif(btrim(p_periodo), ''), '30d');
  v_resumos int;
  v_compras int;
begin
  if not public.e_admin() then return disc_interno.erro('Sem permissão.'); end if;
  v_ini := case v_per
    when 'hoje' then v_hoje
    when '7d' then v_hoje - interval '6 days'
    when '30d' then v_hoje - interval '29 days'
    when 'mes' then v_mes
    when 'tudo' then '-infinity'::timestamptz
    else null end;
  if v_ini is null then return disc_interno.erro('Período inválido.'); end if;
  select count(*) into v_resumos from public.respostas r where r.origem = 'pessoal' and r.recebido_em >= v_ini;
  select count(distinct coalesce(p.resposta_id, p.id::text)) into v_compras from public.pedidos p
    where p.status in ('pago', 'cortesia') and p.pago_em >= v_ini;
  return json_build_object('ok', true, 'periodo', v_per,
    'hoje', (select json_build_object('vendas', count(*), 'receitaCentavos', coalesce(sum(p.valor_centavos), 0))
             from public.pedidos p where p.status = 'pago' and p.pago_em >= v_hoje),
    'mes', (select json_build_object('vendas', count(*), 'receitaCentavos', coalesce(sum(p.valor_centavos), 0))
            from public.pedidos p where p.status = 'pago' and p.pago_em >= v_mes),
    'vendas', (select count(*) from public.pedidos p where p.status = 'pago' and p.pago_em >= v_ini),
    'receitaCentavos', (select coalesce(sum(p.valor_centavos), 0) from public.pedidos p where p.status = 'pago' and p.pago_em >= v_ini),
    'cortesias', (select count(*) from public.pedidos p where p.status = 'cortesia' and p.pago_em >= v_ini),
    'estornos', (select count(*) from public.pedidos p where p.status = 'estornado' and p.reembolsado_em >= v_ini),
    'aguardando', (select count(*) from public.pedidos p where p.status = 'aguardando' and p.criado_em >= v_ini),
    'resumos', v_resumos,
    'compras', v_compras,
    'conversao', case when v_resumos > 0 then round(v_compras::numeric / v_resumos, 4) else 0 end,
    'porPacote', (select coalesce(json_agg(json_build_object('pacote', x.pacote, 'vendas', x.n, 'receitaCentavos', x.soma)
                   order by x.pacote), '[]'::json)
                  from (select p.pacote, count(*) as n, sum(p.valor_centavos) as soma from public.pedidos p
                        where p.status = 'pago' and p.pago_em >= v_ini group by p.pacote) x));
end;
$$;

-- -----------------------------------------------------------------------------
-- versao_banco: + 20261011120000_vendas
-- -----------------------------------------------------------------------------

create or replace function public.versao_banco()
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  aplicadas text[] := array['20261005120000_disc'];
  faltando text[] := array[]::text[];
  m record;
begin
  for m in
    select * from (values
      (1, '20261006120000_pessoas_formulario', to_regclass('public.pessoas') is not null),
      (2, '20261007120000_empresas_equipes', to_regclass('public.empresas') is not null
                                              and to_regclass('public.vinculos') is not null
                                              and to_regclass('public.relacoes') is not null),
      (3, '20261008120000_parte2', exists (select 1 from pg_catalog.pg_attribute a
                                            where a.attrelid = to_regclass('public.respostas') and a.attname = 'exigido'
                                              and not a.attisdropped)),
      (4, '20261009120000_fotos', exists (select 1 from pg_catalog.pg_attribute a
                                           where a.attrelid = to_regclass('public.respostas') and a.attname = 'foto'
                                             and not a.attisdropped)),
      (5, '20261010120000_mover_versao', exists (select 1 from pg_catalog.pg_attribute a
                                                  where a.attrelid = to_regclass('public.respostas')
                                                    and a.attname = 'historico_processos' and not a.attisdropped)
                                         and exists (select 1 from pg_catalog.pg_attribute a
                                                  where a.attrelid = to_regclass('public.empresas')
                                                    and a.attname = 'organograma' and not a.attisdropped)),
      (6, '20261011120000_vendas', to_regclass('public.pedidos') is not null
                                   and to_regclass('public.cupons') is not null
                                   and to_regclass('public.pacotes') is not null
                                   and exists (select 1 from pg_catalog.pg_attribute a
                                                where a.attrelid = to_regclass('public.respostas')
                                                  and a.attname = 'origem' and not a.attisdropped))
    ) as t(ordem, nome, ok)
    order by ordem
  loop
    if m.ok then aplicadas := aplicadas || m.nome; else faltando := faltando || m.nome; end if;
  end loop;
  return json_build_object('ok', true, 'versao', 20261011120000, 'migracoes', to_jsonb(aplicadas),
    'faltando', to_jsonb(faltando));
end;
$$;

-- -----------------------------------------------------------------------------
-- RLS e permissões
-- -----------------------------------------------------------------------------

alter table public.pacotes enable row level security;
alter table public.cupons enable row level security;
alter table public.pedidos enable row level security;
alter table public.limites_vendas enable row level security;

drop policy if exists pacotes_admin on public.pacotes;
create policy pacotes_admin on public.pacotes for all to authenticated
  using (public.e_admin()) with check (public.e_admin());
drop policy if exists cupons_admin on public.cupons;
create policy cupons_admin on public.cupons for all to authenticated
  using (public.e_admin()) with check (public.e_admin());
drop policy if exists pedidos_admin on public.pedidos;
create policy pedidos_admin on public.pedidos for all to authenticated
  using (public.e_admin()) with check (public.e_admin());
-- limites_vendas: nenhuma política (só as funções do banco e a service_role usam).

revoke all on public.pacotes, public.cupons, public.pedidos, public.limites_vendas from public;
revoke all on function disc_interno.token_aleatorio(), disc_interno.hoje_brasil(), disc_interno.preco_atual(public.pacotes),
  disc_interno.primeiro_nome(text), disc_interno.token_valido(text), disc_interno.resultado_resposta(public.respostas),
  disc_interno.contar_tentativa(text, text, interval), disc_interno.pedido_json(public.pedidos),
  disc_interno.pedidos_antes_gravar(), disc_interno.pacotes_antes_gravar() from public;
revoke all on function public.enviar_resposta(jsonb), public.enviar_resposta_pessoal(jsonb), public.resumo_pessoal(text),
  public.pacotes_publicos(), public.criar_pedido(text, text, text), public.status_pedido(text, text),
  public.relatorio_pessoal(text), public.salvar_parte2_pessoal(text, text), public.atualizar_pedido(text, text),
  public.resumo_vendas(text), public.versao_banco() from public;

do $$
declare
  papel text;
begin
  foreach papel in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = papel) then
      execute format('revoke all on public.pacotes, public.cupons, public.pedidos, public.limites_vendas from %I', papel);
      -- só as auxiliares NOVAS (exigido_valido continua executável por todos: restrição de respostas.exigido).
      execute format('revoke all on function disc_interno.token_aleatorio(), disc_interno.hoje_brasil(), '
        || 'disc_interno.preco_atual(public.pacotes), disc_interno.primeiro_nome(text), disc_interno.token_valido(text), '
        || 'disc_interno.resultado_resposta(public.respostas), disc_interno.contar_tentativa(text, text, interval), '
        || 'disc_interno.pedido_json(public.pedidos), disc_interno.pedidos_antes_gravar(), '
        || 'disc_interno.pacotes_antes_gravar() from %I', papel);
      execute format('grant execute on function public.enviar_resposta(jsonb), public.enviar_resposta_pessoal(jsonb), '
        || 'public.resumo_pessoal(text), public.pacotes_publicos(), public.criar_pedido(text, text, text), '
        || 'public.status_pedido(text, text), public.relatorio_pessoal(text), public.salvar_parte2_pessoal(text, text), '
        || 'public.versao_banco() to %I', papel);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.atualizar_pedido(text, text), public.resumo_vendas(text) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    -- painel: lê pedidos (muda só por atualizar_pedido), cupons à vontade, pacotes lê e altera (sem criar/apagar).
    grant select on public.pedidos to authenticated;
    grant select, insert, update, delete on public.cupons to authenticated;
    grant select on public.pacotes to authenticated;
    grant update (nome, preco_centavos, preco_lancamento_centavos, lancamento_ate, ativo, ordem, descricao)
      on public.pacotes to authenticated;
    grant execute on function public.atualizar_pedido(text, text), public.resumo_vendas(text) to authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on public.pacotes, public.cupons, public.pedidos, public.limites_vendas to service_role;
    grant usage on schema disc_interno to service_role;
    grant execute on all functions in schema disc_interno to service_role;
    grant execute on function public.enviar_resposta(jsonb), public.enviar_resposta_pessoal(jsonb), public.resumo_pessoal(text),
      public.pacotes_publicos(), public.criar_pedido(text, text, text), public.status_pedido(text, text),
      public.relatorio_pessoal(text), public.salvar_parte2_pessoal(text, text), public.atualizar_pedido(text, text),
      public.resumo_vendas(text), public.versao_banco() to service_role;
  end if;
end $$;

-- O PostgREST relê o esquema (funções novas/trocadas aparecem na API sem esperar).
notify pgrst, 'reload schema';
