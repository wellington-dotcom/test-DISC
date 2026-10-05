-- =============================================================================
-- Teste DISC — rodada "formulário por processo + pessoas". Roda DEPOIS de 20261005120000_disc.sql.
-- Idempotente e seguro sobre dados reais: só cria o que falta, recria funções/gatilhos/políticas e
-- preenche public.pessoas a partir das respostas que já existem (nada é apagado).
-- É aplicada sozinha pela integração do GitHub do Supabase no push; à mão: colar no SQL Editor e "Run".
--
--   * public.pessoas: uma ficha por WhatsApp normalizado (ex.: 5511999998888). Só admin lê (RLS).
--   * respostas.pessoa_id (liga a resposta à pessoa), respostas.email, respostas.cidade, respostas.extras.
--   * processos.config.formulario: o que perguntar na identificação (campos obrigatório/opcional/oculto e
--     até 5 perguntas extras). avaliacao_publica devolve o formulário normalizado.
--   * enviar_resposta: valida pelo formulário do processo, acha/cria a pessoa pelo telefone e ATUALIZA a
--     ficha (campo vazio no envio não apaga o que já havia). Limites, antiflood e idempotência pelo id iguais.
--   * Excluir resposta: a pessoa que ficar sem respostas é excluída junto (LGPD).
--   * Pergunta extra com termo sensível (sexo, estado civil, filhos, religião, saúde...) é recusada.
-- ATENÇÃO: não rode de novo a migração 20261005120000_disc.sql depois desta sem rodar esta em seguida
-- (aquela recria enviar_resposta/avaliacao_publica/processos_antes_gravar na versão antiga).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Tabela pessoas e colunas novas em respostas
-- -----------------------------------------------------------------------------

create table if not exists public.pessoas (
  id            uuid primary key default gen_random_uuid(),
  telefone      text not null unique check (telefone ~ '^[0-9]{12,13}$'),
  nome          text not null default '' check (char_length(nome) <= 120),
  idade         int check (idade is null or idade between 14 and 99),
  funcao        text not null default '' check (char_length(funcao) <= 120),
  empresa       text not null default '' check (char_length(empresa) <= 120),
  email         text not null default '' check (char_length(email) <= 120),
  cidade        text not null default '' check (char_length(cidade) <= 120),
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

alter table public.respostas add column if not exists pessoa_id uuid references public.pessoas (id) on delete set null;
alter table public.respostas add column if not exists email text not null default '' check (char_length(email) <= 120);
alter table public.respostas add column if not exists cidade text not null default '' check (char_length(cidade) <= 120);
alter table public.respostas add column if not exists extras jsonb not null default '[]'::jsonb check (jsonb_typeof(extras) = 'array');
create index if not exists respostas_pessoa_idx on public.respostas (pessoa_id);

-- -----------------------------------------------------------------------------
-- Formulário do processo
-- -----------------------------------------------------------------------------

-- normalizarFormulario (mesma regra de js/api-supabase.js e js/api-simulada.js). Ausente/inválido = padrão:
-- idade obrigatória, função e empresa opcionais, e-mail e cidade ocultos, sem perguntas extras.
create or replace function disc_interno.normalizar_formulario(f jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  padrao constant jsonb := '{"idade":"obrigatorio","funcao":"opcional","empresa":"opcional","email":"oculto","cidade":"oculto"}';
  origem jsonb;
  campos jsonb := '{}'::jsonb;
  perguntas jsonb := '[]'::jsonb;
  usados text[] := '{}';
  k text;
  m text;
  x jsonb;
  v_texto text;
  v_id text;
  n int;
begin
  if f is null or jsonb_typeof(f) <> 'object' then f := '{}'::jsonb; end if;
  origem := case when jsonb_typeof(f -> 'campos') = 'object' then f -> 'campos' else '{}'::jsonb end;
  foreach k in array array['idade', 'funcao', 'empresa', 'email', 'cidade'] loop
    m := case when jsonb_typeof(origem -> k) = 'string' then origem ->> k else '' end;
    if m not in ('obrigatorio', 'opcional', 'oculto') then m := padrao ->> k; end if;
    campos := campos || jsonb_build_object(k, m);
  end loop;
  if jsonb_typeof(f -> 'perguntas') = 'array' then
    for x in select t.e from jsonb_array_elements(f -> 'perguntas') with ordinality t(e, i) order by t.i loop
      exit when jsonb_array_length(perguntas) >= 5;
      if jsonb_typeof(x) <> 'object' then continue; end if;
      v_texto := disc_interno.limpar_texto(disc_interno.texto(x -> 'texto'), 200);
      if char_length(v_texto) < 3 then continue; end if;
      v_id := case when jsonb_typeof(x -> 'id') = 'string' then x ->> 'id' else '' end;
      if v_id !~ '^[a-z0-9_]{1,20}$' or v_id = any (usados) then
        n := 1;
        while ('p' || n) = any (usados) loop n := n + 1; end loop;
        v_id := 'p' || n;
      end if;
      usados := usados || v_id;
      perguntas := perguntas || jsonb_build_array(jsonb_build_object(
        'id', v_id, 'texto', v_texto, 'obrigatoria', coalesce(x -> 'obrigatoria' = 'true'::jsonb, false)));
    end loop;
  end if;
  return jsonb_build_object('campos', campos, 'perguntas', perguntas);
end;
$$;

-- -----------------------------------------------------------------------------
-- Validação do envio pelo formulário do processo
-- -----------------------------------------------------------------------------

-- validarPayload do Code.gs + formulário. Com p_formulario nulo (link geral) vale o padrão, que dá o mesmo
-- resultado do Code.gs (o payload ganha só email:'', cidade:'' e extras:[]).
-- Retorna {ok:true, payload, disc} ou {ok:false, erro}.
create or replace function disc_interno.validar_envio(p jsonb, p_formulario jsonb)
returns jsonb language plpgsql stable set search_path = '' set timezone = 'UTC' as $$
declare
  form jsonb := disc_interno.normalizar_formulario(p_formulario);
  v_id text; v_nome text; v_tel text; v_idade int; v_idade_txt text;
  v_funcao text; v_empresa text; v_email text; v_cidade text;
  v_extras jsonb := '[]'::jsonb; x jsonb; v_resp_extra text;
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

  -- idade (validarIdadeServidor): obrigatória só se o formulário disser; se vier, 14–99.
  if form #>> '{campos,idade}' = 'oculto' then
    v_idade := null;
  elsif p -> 'idade' is null or jsonb_typeof(p -> 'idade') = 'null'
     or (jsonb_typeof(p -> 'idade') = 'string' and btrim(p ->> 'idade') = '') then
    if form #>> '{campos,idade}' = 'obrigatorio' then
      return jsonb_build_object('ok', false, 'erro', 'Idade não informada: a idade é obrigatória (só números, de 14 a 99 anos).');
    end if;
    v_idade := null;
  else
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
  end if;

  -- função, empresa, e-mail e cidade ('' quando ocultos)
  v_funcao := case when form #>> '{campos,funcao}' = 'oculto' then ''
    else disc_interno.limpar_texto(disc_interno.texto(p -> 'funcao'), 80) end;
  if v_funcao = '' and form #>> '{campos,funcao}' = 'obrigatorio' then
    return jsonb_build_object('ok', false, 'erro', 'Informe a função atual ou última.');
  end if;
  v_empresa := case when form #>> '{campos,empresa}' = 'oculto' then ''
    else disc_interno.limpar_texto(disc_interno.texto(p -> 'empresa'), 80) end;
  if v_empresa = '' and form #>> '{campos,empresa}' = 'obrigatorio' then
    return jsonb_build_object('ok', false, 'erro', 'Informe a empresa atual ou última.');
  end if;
  v_email := case when form #>> '{campos,email}' = 'oculto' then ''
    else lower(disc_interno.limpar_texto(disc_interno.texto(p -> 'email'), 120)) end;
  if v_email = '' and form #>> '{campos,email}' = 'obrigatorio' then
    return jsonb_build_object('ok', false, 'erro', 'Informe o e-mail.');
  end if;
  if v_email <> '' and v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    return jsonb_build_object('ok', false, 'erro', 'E-mail inválido.');
  end if;
  v_cidade := case when form #>> '{campos,cidade}' = 'oculto' then ''
    else disc_interno.limpar_texto(disc_interno.texto(p -> 'cidade'), 80) end;
  if v_cidade = '' and form #>> '{campos,cidade}' = 'obrigatorio' then
    return jsonb_build_object('ok', false, 'erro', 'Informe a cidade onde mora.');
  end if;

  -- perguntas extras: só as do formulário (outros ids são ignorados); a pergunta gravada é a do processo.
  for x in select t.e from jsonb_array_elements(form -> 'perguntas') with ordinality t(e, i) order by t.i loop
    v_resp_extra := null;
    if jsonb_typeof(p -> 'extras') = 'array' then
      select disc_interno.limpar_texto(disc_interno.texto(t2.e -> 'resposta'), 500) into v_resp_extra
        from jsonb_array_elements(p -> 'extras') with ordinality t2(e, i)
        where jsonb_typeof(t2.e) = 'object' and jsonb_typeof(t2.e -> 'id') = 'string' and t2.e ->> 'id' = x ->> 'id'
        order by t2.i limit 1;
    end if;
    v_resp_extra := coalesce(v_resp_extra, '');
    if v_resp_extra = '' then
      if x -> 'obrigatoria' = 'true'::jsonb then
        return jsonb_build_object('ok', false, 'erro', 'Responda a pergunta "' || (x ->> 'texto') || '".');
      end if;
      continue;
    end if;
    v_extras := v_extras || jsonb_build_array(jsonb_build_object('id', x -> 'id', 'pergunta', x -> 'texto', 'resposta', v_resp_extra));
  end loop;

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
    'funcao', v_funcao,
    'empresa', v_empresa,
    'email', v_email,
    'cidade', v_cidade,
    'extras', v_extras,
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

-- Nome antigo (mesma assinatura da migração anterior): validação com o formulário padrão.
create or replace function disc_interno.validar_payload(p jsonb)
returns jsonb language sql stable set search_path = '' set timezone = 'UTC' as $$
  select disc_interno.validar_envio(p, null);
$$;

-- -----------------------------------------------------------------------------
-- Pessoas: ligação automática, ficha e exclusão da órfã
-- -----------------------------------------------------------------------------

-- Resposta gravada SEM pessoa (importação da planilha, dados de exemplo, versão antiga de enviar_resposta):
-- liga à pessoa do mesmo WhatsApp (cria se faltar). Aqui a ficha só ganha o que estiver vazio nela.
create or replace function disc_interno.respostas_ligar_pessoa()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_tel text := disc_interno.normalizar_telefone(to_jsonb(new.telefone));
  v_pessoa uuid;
begin
  if v_tel = '' then return null; end if;
  insert into public.pessoas as pe (telefone, nome, idade, funcao, empresa, email, cidade, criado_em, atualizado_em)
  values (v_tel, left(coalesce(new.nome, ''), 120), new.idade, left(coalesce(new.funcao, ''), 120),
    left(coalesce(new.empresa, ''), 120), left(coalesce(new.email, ''), 120), left(coalesce(new.cidade, ''), 120),
    new.recebido_em, new.recebido_em)
  on conflict (telefone) do update set
    nome = case when pe.nome = '' then excluded.nome else pe.nome end,
    idade = coalesce(pe.idade, excluded.idade),
    funcao = case when pe.funcao = '' then excluded.funcao else pe.funcao end,
    empresa = case when pe.empresa = '' then excluded.empresa else pe.empresa end,
    email = case when pe.email = '' then excluded.email else pe.email end,
    cidade = case when pe.cidade = '' then excluded.cidade else pe.cidade end
  returning id into v_pessoa;
  update public.respostas set pessoa_id = v_pessoa where id = new.id and pessoa_id is null;
  return null;
end;
$$;

drop trigger if exists respostas_ligar_pessoa on public.respostas;
create trigger respostas_ligar_pessoa after insert on public.respostas
  for each row when (new.pessoa_id is null and new.telefone <> '')
  execute function disc_interno.respostas_ligar_pessoa();

-- Excluir resposta(s): a pessoa que ficou sem nenhuma resposta é excluída junto (LGPD).
create or replace function disc_interno.respostas_apagar_pessoa_orfa()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.pessoas pe
  where pe.id in (select distinct a.pessoa_id from antigas a where a.pessoa_id is not null)
    and not exists (select 1 from public.respostas r where r.pessoa_id = pe.id);
  return null;
end;
$$;

drop trigger if exists respostas_apagar_pessoa_orfa on public.respostas;
create trigger respostas_apagar_pessoa_orfa after delete on public.respostas
  referencing old table as antigas
  for each statement execute function disc_interno.respostas_apagar_pessoa_orfa();

-- pessoas: carimba atualizado_em em toda alteração.
create or replace function disc_interno.pessoas_antes_gravar()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then new.atualizado_em := now(); end if;
  return new;
end;
$$;

drop trigger if exists pessoas_antes_gravar on public.pessoas;
create trigger pessoas_antes_gravar before update on public.pessoas
  for each row execute function disc_interno.pessoas_antes_gravar();

-- -----------------------------------------------------------------------------
-- Preenche as pessoas a partir das respostas que já existem (só as ainda sem pessoa_id).
-- Agrupa pelo WhatsApp normalizado; cada campo da ficha vem da resposta mais recente que o tenha.
-- Telefone vazio/inválido: a resposta fica sem pessoa (o painel agrupa pelo telefone).
-- -----------------------------------------------------------------------------

with base as (
  select r.recebido_em, r.nome, r.idade, r.funcao, r.empresa, r.email, r.cidade,
         disc_interno.normalizar_telefone(to_jsonb(r.telefone)) as tel
  from public.respostas r
  where r.pessoa_id is null
)
insert into public.pessoas (telefone, nome, idade, funcao, empresa, email, cidade, criado_em, atualizado_em)
select b.tel,
  left(coalesce((array_agg(b.nome order by b.recebido_em desc) filter (where coalesce(btrim(b.nome), '') <> ''))[1], ''), 120),
  (array_agg(b.idade order by b.recebido_em desc) filter (where b.idade is not null))[1],
  left(coalesce((array_agg(b.funcao order by b.recebido_em desc) filter (where coalesce(b.funcao, '') <> ''))[1], ''), 120),
  left(coalesce((array_agg(b.empresa order by b.recebido_em desc) filter (where coalesce(b.empresa, '') <> ''))[1], ''), 120),
  left(coalesce((array_agg(b.email order by b.recebido_em desc) filter (where coalesce(b.email, '') <> ''))[1], ''), 120),
  left(coalesce((array_agg(b.cidade order by b.recebido_em desc) filter (where coalesce(b.cidade, '') <> ''))[1], ''), 120),
  min(b.recebido_em), max(b.recebido_em)
from base b
where b.tel <> ''
group by b.tel
on conflict (telefone) do nothing;

update public.respostas r
set pessoa_id = pe.id
from public.pessoas pe
where r.pessoa_id is null
  and r.telefone <> ''
  and pe.telefone = disc_interno.normalizar_telefone(to_jsonb(r.telefone));

-- -----------------------------------------------------------------------------
-- processos: mesma regra de antes + formulário (pergunta sensível recusada; formulário normalizado)
-- -----------------------------------------------------------------------------

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

  if new.config ? 'formulario' then
    for x in
      select e from jsonb_array_elements(case when jsonb_typeof(new.config #> '{formulario,perguntas}') = 'array'
        then new.config #> '{formulario,perguntas}' else '[]'::jsonb end) e
    loop
      if jsonb_typeof(x) = 'object' then
        nome := disc_interno.limpar_texto(disc_interno.texto(x -> 'texto'), 200);
        -- Nas perguntas ao candidato não há exceção (nem saúde nem antecedentes).
        if nome <> '' and disc_interno.classificar_campo(nome, '{}'::jsonb) <> '' then
          raise exception 'A pergunta "%" pede um dado sensível e não pode ser usada.', nome;
        end if;
      end if;
    end loop;
    new.config := jsonb_set(new.config, '{formulario}', disc_interno.normalizar_formulario(new.config -> 'formulario'));
  end if;
  return new;
end;
$$;

drop trigger if exists processos_antes_gravar on public.processos;
create trigger processos_antes_gravar before insert or update on public.processos
  for each row execute function disc_interno.processos_antes_gravar();

-- -----------------------------------------------------------------------------
-- Funções públicas (RPC) — anon
-- -----------------------------------------------------------------------------

-- Dados do link: agora também o formulário normalizado ({campos, perguntas}).
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
    'empresaNome', pr.empresa, 'mostrarResultado', pr.mostrar_resultado,
    'formulario', disc_interno.normalizar_formulario(pr.config -> 'formulario'));
  return (jsonb_build_object('ok', true, 'avaliacao', a) || a)::json;
end;
$$;

-- Envio do candidato: valida pelo formulário do processo, recalcula D/I/S/C e perfil, gera o protocolo,
-- acha/cria a pessoa pelo WhatsApp (atualizando a ficha) e grava. Idempotente pelo id do payload.
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
begin
  if p_payload is null then return disc_interno.erro('Dados do teste ausentes.'); end if;
  if char_length(p_payload::text) > 20000 then return disc_interno.erro('Requisição grande demais.'); end if;

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

  -- Ficha da pessoa: nome do envio e campos NÃO vazios do envio (vazio não apaga o que já havia).
  insert into public.pessoas as pe (telefone, nome, idade, funcao, empresa, email, cidade)
  values (pl ->> 'telefone', pl ->> 'nome', (pl ->> 'idade')::int, pl ->> 'funcao', pl ->> 'empresa',
    pl ->> 'email', pl ->> 'cidade')
  on conflict (telefone) do update set
    nome = excluded.nome,
    idade = coalesce(excluded.idade, pe.idade),
    funcao = coalesce(nullif(excluded.funcao, ''), pe.funcao),
    empresa = coalesce(nullif(excluded.empresa, ''), pe.empresa),
    email = coalesce(nullif(excluded.email, ''), pe.email),
    cidade = coalesce(nullif(excluded.cidade, ''), pe.cidade)
  returning id into v_pessoa;

  insert into public.respostas (id, processo_id, avaliacao, protocolo, recebido_em, nome, telefone, idade, vaga,
    funcao, empresa, email, cidade, extras, pessoa_id, inicio, fim, duracao_seg, respostas, d, i, s, c, perfil,
    validacao, status, observacoes, payload)
  values (pl ->> 'id', pr.id, pl ->> 'avaliacao', v_protocolo, now(), pl ->> 'nome', pl ->> 'telefone',
    (pl ->> 'idade')::int, pl ->> 'vaga', pl ->> 'funcao', pl ->> 'empresa', pl ->> 'email', pl ->> 'cidade',
    pl -> 'extras', v_pessoa,
    nullif(pl ->> 'inicio', '')::timestamptz, nullif(pl ->> 'fim', '')::timestamptz,
    (pl ->> 'duracaoSeg')::int, pl ->> 'respostas',
    (d #>> '{percentuais,D}')::numeric, (d #>> '{percentuais,I}')::numeric,
    (d #>> '{percentuais,S}')::numeric, (d #>> '{percentuais,C}')::numeric,
    d ->> 'codigo', pl -> 'validacao', 'em_analise', '', pl);

  return json_build_object('ok', true, 'id', pl ->> 'id', 'protocolo', v_protocolo);
end;
$$;

-- -----------------------------------------------------------------------------
-- RLS, políticas e permissões (pessoas: só admin; anon nada)
-- -----------------------------------------------------------------------------

alter table public.pessoas enable row level security;

drop policy if exists pessoas_admin on public.pessoas;
create policy pessoas_admin on public.pessoas for all to authenticated
  using (public.e_admin()) with check (public.e_admin());

revoke all on public.pessoas from public;
revoke all on all functions in schema disc_interno from public;

do $$
declare
  papel text;
begin
  foreach papel in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = papel) then
      execute format('revoke all on public.pessoas from %I', papel);
      execute format('revoke all on all functions in schema disc_interno from %I', papel);
    end if;
  end loop;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    -- A ficha é mantida pelo servidor (enviar_resposta); o painel só lê (e exclui, se precisar).
    grant select, delete on public.pessoas to authenticated;
  end if;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on public.pessoas to service_role;
    grant execute on all functions in schema disc_interno to service_role;
  end if;
end $$;

revoke all on function public.avaliacao_publica(text) from public;
revoke all on function public.enviar_resposta(jsonb) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    grant execute on function public.avaliacao_publica(text) to anon;
    grant execute on function public.enviar_resposta(jsonb) to anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.avaliacao_publica(text) to authenticated;
    grant execute on function public.enviar_resposta(jsonb) to authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.avaliacao_publica(text), public.enviar_resposta(jsonb) to service_role;
  end if;
end $$;
