-- =============================================================================
-- Teste DISC — rodada "empresas, colaboradores, organograma e modelos de relatório".
-- Roda DEPOIS de 20261005120000_disc.sql e 20261006120000_pessoas_formulario.sql.
-- Idempotente e seguro sobre dados reais: só cria o que falta, recria funções/gatilhos/políticas;
-- nada é apagado e as linhas que já existem continuam válidas (relatórios antigos viram modelo 'processo').
-- É aplicada sozinha pela integração do GitHub do Supabase no push; à mão: colar no SQL Editor e "Run".
--
--   * public.empresas: cadastro das empresas atendidas (só admin; anon nada).
--   * public.vinculos: pessoa x empresa (cargo, área, ativo/desligado, início/fim). No máximo 1 vínculo
--     ATIVO por pessoa. Desligar = status 'desligado' (fim = hoje) e as relações dela nessa empresa somem.
--   * public.relacoes: organograma da empresa (de lidera para; 'direto'/'indireto' = convivência).
--   * processos.empresa_id (opcional): liga o processo à empresa (o texto processos.empresa continua).
--   * relatorios: modelos novos ('equipe', 'lideranca', 'pessoa') além de 'processo'; processo_id passa a
--     aceitar null; colunas id, modelo, empresa_id, pessoa_id. relatorio_publico devolve também o modelo.
--   * enviar_resposta: link de processo tipo 'equipe' ligado a uma empresa cria o vínculo ativo da pessoa
--     (cargo = função informada) se ela ainda não tiver vínculo ativo em nenhuma empresa.
--   * Funções do painel (só admin): salvar_colaborador, mover_colaborador, salvar_relacoes.
--   * Excluir respostas: a pessoa sem respostas continua sendo excluída (LGPD), MENOS a que é colaboradora
--     ativa de alguma empresa (ela continua no time, só sem resultado).
-- ATENÇÃO: não rode de novo as migrações anteriores depois desta sem rodar esta em seguida (elas recriam
-- enviar_resposta, relatorio_publico e respostas_apagar_pessoa_orfa nas versões antigas).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Tabelas
-- -----------------------------------------------------------------------------

create table if not exists public.empresas (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null check (char_length(btrim(nome)) between 1 and 120 and char_length(nome) <= 120),
  cidade        text not null default '' check (char_length(cidade) <= 120),
  observacoes   text not null default '' check (char_length(observacoes) <= 2000),
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table if not exists public.vinculos (
  id         uuid primary key default gen_random_uuid(),
  pessoa_id  uuid not null references public.pessoas (id) on delete cascade,
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  cargo      text not null default '' check (char_length(cargo) <= 120),
  area       text not null default '' check (char_length(area) <= 120),
  status     text not null default 'ativo' check (status in ('ativo', 'desligado')),
  inicio     date not null default current_date,
  fim        date,
  criado_em  timestamptz not null default now(),
  check (status = 'desligado' or fim is null)
);
-- No máximo 1 vínculo ATIVO por pessoa (mover = desligar o atual + criar o novo).
create unique index if not exists vinculos_um_ativo_por_pessoa on public.vinculos (pessoa_id) where status = 'ativo';
create index if not exists vinculos_empresa_idx on public.vinculos (empresa_id);

create table if not exists public.relacoes (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  de_pessoa  uuid not null references public.pessoas (id) on delete cascade,
  para_pessoa uuid not null references public.pessoas (id) on delete cascade,
  tipo       text not null check (tipo in ('lidera', 'direto', 'indireto')),
  criado_em  timestamptz not null default now(),
  unique (empresa_id, de_pessoa, para_pessoa),
  check (de_pessoa <> para_pessoa)
);
create index if not exists relacoes_de_idx on public.relacoes (de_pessoa);
create index if not exists relacoes_para_idx on public.relacoes (para_pessoa);

-- processos: empresa cadastrada (opcional). O texto processos.empresa continua (link público e legado).
alter table public.processos add column if not exists empresa_id uuid references public.empresas (id) on delete set null;
create index if not exists processos_empresa_idx on public.processos (empresa_id);

-- relatorios: modelos novos. As linhas antigas ficam com modelo 'processo' (todas têm processo_id).
alter table public.relatorios alter column processo_id drop not null;
alter table public.relatorios add column if not exists id uuid not null default gen_random_uuid();
alter table public.relatorios add column if not exists modelo text not null default 'processo'
  check (modelo in ('processo', 'equipe', 'lideranca', 'pessoa'));
alter table public.relatorios add column if not exists empresa_id uuid references public.empresas (id) on delete cascade;
alter table public.relatorios add column if not exists pessoa_id uuid references public.pessoas (id) on delete cascade;
create unique index if not exists relatorios_id_idx on public.relatorios (id);
create index if not exists relatorios_empresa_idx on public.relatorios (empresa_id);
create index if not exists relatorios_pessoa_idx on public.relatorios (pessoa_id);
alter table public.relatorios drop constraint if exists relatorios_modelo_dono;
alter table public.relatorios add constraint relatorios_modelo_dono check (
  (modelo = 'processo' and processo_id is not null)
  or (modelo = 'equipe' and empresa_id is not null)
  or (modelo in ('lideranca', 'pessoa') and pessoa_id is not null));

-- -----------------------------------------------------------------------------
-- Auxiliares
-- -----------------------------------------------------------------------------

-- uuid de um valor JSON (string no formato certo) ou null.
create or replace function disc_interno.uuid_ou_nulo(v jsonb)
returns uuid language sql immutable set search_path = '' as $$
  select case when disc_interno.texto(v) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then disc_interno.texto(v)::uuid else null end;
$$;

-- Colaborador (vínculo + pessoa) no formato do painel.
create or replace function disc_interno.colaborador_json(p_vinculo uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('vinculoId', v.id, 'pessoaId', v.pessoa_id, 'empresaId', v.empresa_id,
    'nome', p.nome, 'telefone', p.telefone, 'cargo', v.cargo, 'area', v.area, 'status', v.status,
    'inicio', coalesce(to_char(v.inicio, 'YYYY-MM-DD'), ''), 'fim', coalesce(to_char(v.fim, 'YYYY-MM-DD'), ''))
  from public.vinculos v join public.pessoas p on p.id = v.pessoa_id
  where v.id = p_vinculo;
$$;

-- -----------------------------------------------------------------------------
-- Gatilhos
-- -----------------------------------------------------------------------------

-- empresas: nome aparado; carimba atualizado_em.
create or replace function disc_interno.empresas_antes_gravar()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.nome := btrim(coalesce(new.nome, ''));
  if new.nome = '' then raise exception 'Informe o nome da empresa.'; end if;
  if tg_op = 'UPDATE' then new.atualizado_em := now(); end if;
  return new;
end;
$$;

drop trigger if exists empresas_antes_gravar on public.empresas;
create trigger empresas_antes_gravar before insert or update on public.empresas
  for each row execute function disc_interno.empresas_antes_gravar();

-- empresas: não exclui com colaborador ativo.
create or replace function disc_interno.empresas_antes_excluir()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.vinculos v where v.empresa_id = old.id and v.status = 'ativo') then
    raise exception 'Desligue ou mova os colaboradores antes.';
  end if;
  return old;
end;
$$;

drop trigger if exists empresas_antes_excluir on public.empresas;
create trigger empresas_antes_excluir before delete on public.empresas
  for each row execute function disc_interno.empresas_antes_excluir();

-- vinculos: desligado ganha fim (hoje, se vazio); ativo nunca tem fim.
create or replace function disc_interno.vinculos_antes_gravar()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.cargo := btrim(coalesce(new.cargo, ''));
  new.area := btrim(coalesce(new.area, ''));
  if new.status = 'desligado' then
    new.fim := coalesce(new.fim, current_date);
  else
    new.fim := null;
  end if;
  return new;
end;
$$;

drop trigger if exists vinculos_antes_gravar on public.vinculos;
create trigger vinculos_antes_gravar before insert or update on public.vinculos
  for each row execute function disc_interno.vinculos_antes_gravar();

-- vinculos: ao desligar (ou excluir/trocar de empresa) um vínculo ativo, as relações da pessoa
-- naquela empresa somem (o organograma só tem colaboradores ativos).
create or replace function disc_interno.vinculos_limpar_relacoes()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.status = 'ativo' and (tg_op = 'DELETE' or new.status <> 'ativo' or new.empresa_id <> old.empresa_id
                                or new.pessoa_id <> old.pessoa_id) then
    delete from public.relacoes r
    where r.empresa_id = old.empresa_id and (r.de_pessoa = old.pessoa_id or r.para_pessoa = old.pessoa_id);
  end if;
  return null;
end;
$$;

drop trigger if exists vinculos_limpar_relacoes on public.vinculos;
create trigger vinculos_limpar_relacoes after update or delete on public.vinculos
  for each row execute function disc_interno.vinculos_limpar_relacoes();

-- relacoes: as duas pessoas precisam ser colaboradoras ATIVAS da empresa da relação.
create or replace function disc_interno.relacoes_antes_gravar()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.vinculos v where v.pessoa_id = new.de_pessoa and v.empresa_id = new.empresa_id and v.status = 'ativo')
     or not exists (select 1 from public.vinculos v where v.pessoa_id = new.para_pessoa and v.empresa_id = new.empresa_id and v.status = 'ativo') then
    raise exception 'As duas pessoas da relação precisam ser colaboradoras ativas desta empresa.';
  end if;
  return new;
end;
$$;

drop trigger if exists relacoes_antes_gravar on public.relacoes;
create trigger relacoes_antes_gravar before insert or update on public.relacoes
  for each row execute function disc_interno.relacoes_antes_gravar();

-- processos: ao ligar a uma empresa, o texto "empresa" vazio (ou não mexido) vira o nome da empresa.
create or replace function disc_interno.processos_empresa_texto()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_nome text;
begin
  if new.empresa_id is not null
     and (tg_op = 'INSERT' or new.empresa_id is distinct from old.empresa_id)
     and (coalesce(new.empresa, '') = '' or (tg_op = 'UPDATE' and new.empresa is not distinct from old.empresa)) then
    select left(e.nome, 120) into v_nome from public.empresas e where e.id = new.empresa_id;
    if v_nome is not null then new.empresa := v_nome; end if;
  end if;
  return new;
end;
$$;

drop trigger if exists processos_empresa_texto on public.processos;
create trigger processos_empresa_texto before insert or update on public.processos
  for each row execute function disc_interno.processos_empresa_texto();

-- relatorios (modelos novos): dados é um objeto e no máximo ~300 KB (o painel manda o snapshot pronto).
create or replace function disc_interno.relatorios_validar_modelo()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.modelo <> 'processo' then
    if new.dados is null or jsonb_typeof(new.dados) <> 'object' then
      raise exception 'Dados do relatório inválidos.';
    end if;
    if char_length(new.dados::text) > 350000 then
      raise exception 'Relatório grande demais (máximo 300 KB).';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists relatorios_validar_modelo on public.relatorios;
create trigger relatorios_validar_modelo before insert or update on public.relatorios
  for each row execute function disc_interno.relatorios_validar_modelo();

-- Excluir resposta(s): a pessoa que ficou sem nenhuma resposta é excluída junto (LGPD), menos a que é
-- colaboradora ATIVA de alguma empresa (ela continua no time, sem resultado).
create or replace function disc_interno.respostas_apagar_pessoa_orfa()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.pessoas pe
  where pe.id in (select distinct a.pessoa_id from antigas a where a.pessoa_id is not null)
    and not exists (select 1 from public.respostas r where r.pessoa_id = pe.id)
    and not exists (select 1 from public.vinculos v where v.pessoa_id = pe.id and v.status = 'ativo');
  return null;
end;
$$;

-- -----------------------------------------------------------------------------
-- Funções públicas (RPC) — anon
-- -----------------------------------------------------------------------------

-- Envio do candidato: igual à migração anterior + vínculo automático no link de equipe.
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

-- Relatório público: só se publicado; devolve também o modelo. Nunca devolve o id da lista do ClickUp.
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
    'modelo', coalesce(r.modelo, 'processo'),
    'relatorio', r.dados #- '{processo,clickupListId}' #- '{processo,clickup_list_id}',
    'publicadoEm', disc_interno.iso(r.publicado_em));
end;
$$;

-- -----------------------------------------------------------------------------
-- Funções do painel (authenticated; só admin) — operações que precisam ser atômicas
-- -----------------------------------------------------------------------------

-- Colaborador: {empresaId, pessoaId?, nome?, telefone?, cargo, area}. Sem pessoaId, acha/cria a pessoa pelo
-- WhatsApp normalizado (colaborador sem teste). Já ativo nesta empresa: atualiza cargo/área.
-- Ativo em OUTRA empresa: recusa (use mover_colaborador).
create or replace function public.salvar_colaborador(p_dados jsonb)
returns json
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_emp uuid;
  v_pes uuid;
  v_nome text;
  v_tel text;
  v_cargo text;
  v_area text;
  v_outra text;
  atual public.vinculos%rowtype;
  v_id uuid;
begin
  if not public.e_admin() then return disc_interno.erro('Sem permissão.'); end if;
  if p_dados is null or jsonb_typeof(p_dados) <> 'object' then return disc_interno.erro('Dados do colaborador ausentes.'); end if;
  v_emp := disc_interno.uuid_ou_nulo(p_dados -> 'empresaId');
  if v_emp is null or not exists (select 1 from public.empresas e where e.id = v_emp) then
    return disc_interno.erro('Empresa não encontrada.');
  end if;
  v_cargo := disc_interno.limpar_texto(disc_interno.texto(p_dados -> 'cargo'), 120);
  v_area := disc_interno.limpar_texto(disc_interno.texto(p_dados -> 'area'), 120);

  if disc_interno.texto(p_dados -> 'pessoaId') <> '' then
    v_pes := disc_interno.uuid_ou_nulo(p_dados -> 'pessoaId');
    if v_pes is null or not exists (select 1 from public.pessoas p where p.id = v_pes) then
      return disc_interno.erro('Pessoa não encontrada.');
    end if;
  else
    v_nome := disc_interno.limpar_texto(disc_interno.texto(p_dados -> 'nome'), 120);
    if not disc_interno.nome_valido(v_nome) then
      return disc_interno.erro('Informe o nome completo (nome e sobrenome).');
    end if;
    v_tel := disc_interno.normalizar_telefone(p_dados -> 'telefone');
    if v_tel = '' then return disc_interno.erro('Telefone inválido. Informe DDD + número.'); end if;
    insert into public.pessoas as pe (telefone, nome, funcao)
    values (v_tel, v_nome, v_cargo)
    on conflict (telefone) do update set
      nome = case when pe.nome = '' then excluded.nome else pe.nome end,
      funcao = case when pe.funcao = '' then excluded.funcao else pe.funcao end
    returning id into v_pes;
  end if;

  select * into atual from public.vinculos v where v.pessoa_id = v_pes and v.status = 'ativo' for update;
  if found then
    if atual.empresa_id <> v_emp then
      select e.nome into v_outra from public.empresas e where e.id = atual.empresa_id;
      return disc_interno.erro('Esta pessoa já é colaboradora ativa de outra empresa (' || coalesce(v_outra, '?') ||
        '). Use "Mover" para trocar de empresa.');
    end if;
    update public.vinculos set cargo = v_cargo, area = v_area where id = atual.id;
    v_id := atual.id;
  else
    insert into public.vinculos (pessoa_id, empresa_id, cargo, area, status)
    values (v_pes, v_emp, v_cargo, v_area, 'ativo') returning id into v_id;
  end if;
  return json_build_object('ok', true, 'colaborador', disc_interno.colaborador_json(v_id));
end;
$$;

-- Mover: {pessoaId, empresaId (destino), cargo, area}. O vínculo ativo atual vira desligado (fim = hoje; as
-- relações dela na empresa antiga somem) e nasce o vínculo ativo no destino. Tudo numa transação.
create or replace function public.mover_colaborador(p_dados jsonb)
returns json
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_emp uuid;
  v_pes uuid;
  v_cargo text;
  v_area text;
  atual public.vinculos%rowtype;
  v_id uuid;
begin
  if not public.e_admin() then return disc_interno.erro('Sem permissão.'); end if;
  if p_dados is null or jsonb_typeof(p_dados) <> 'object' then return disc_interno.erro('Dados do colaborador ausentes.'); end if;
  v_pes := disc_interno.uuid_ou_nulo(p_dados -> 'pessoaId');
  if v_pes is null or not exists (select 1 from public.pessoas p where p.id = v_pes) then
    return disc_interno.erro('Pessoa não encontrada.');
  end if;
  v_emp := disc_interno.uuid_ou_nulo(p_dados -> 'empresaId');
  if v_emp is null or not exists (select 1 from public.empresas e where e.id = v_emp) then
    return disc_interno.erro('Empresa não encontrada.');
  end if;
  v_cargo := disc_interno.limpar_texto(disc_interno.texto(p_dados -> 'cargo'), 120);
  v_area := disc_interno.limpar_texto(disc_interno.texto(p_dados -> 'area'), 120);

  select * into atual from public.vinculos v where v.pessoa_id = v_pes and v.status = 'ativo' for update;
  if found and atual.empresa_id = v_emp then
    update public.vinculos set cargo = v_cargo, area = v_area where id = atual.id;
    v_id := atual.id;
  else
    if found then
      update public.vinculos set status = 'desligado', fim = current_date where id = atual.id;
    end if;
    insert into public.vinculos (pessoa_id, empresa_id, cargo, area, status)
    values (v_pes, v_emp, v_cargo, v_area, 'ativo') returning id into v_id;
  end if;
  return json_build_object('ok', true, 'colaborador', disc_interno.colaborador_json(v_id));
end;
$$;

-- Organograma: substitui TODAS as relações da empresa por p_relacoes ([{de, para, tipo}]). As pessoas
-- precisam ser colaboradoras ativas da empresa. Repetida (mesmo de/para): vale a última.
create or replace function public.salvar_relacoes(p_empresa text, p_relacoes jsonb)
returns json
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_emp uuid := disc_interno.uuid_ou_nulo(to_jsonb(p_empresa));
  x jsonb;
  v_de uuid;
  v_para uuid;
  v_tipo text;
  saida jsonb;
begin
  if not public.e_admin() then return disc_interno.erro('Sem permissão.'); end if;
  if v_emp is null or not exists (select 1 from public.empresas e where e.id = v_emp) then
    return disc_interno.erro('Empresa não encontrada.');
  end if;
  if p_relacoes is null or jsonb_typeof(p_relacoes) <> 'array' then return disc_interno.erro('Relações inválidas.'); end if;
  if jsonb_array_length(p_relacoes) > 2000 then return disc_interno.erro('Relações demais.'); end if;

  -- 1º valida tudo (nada muda se algo estiver errado); depois troca o conjunto.
  for x in select t.e from jsonb_array_elements(p_relacoes) t(e) loop
    if jsonb_typeof(x) <> 'object' then return disc_interno.erro('Relações inválidas.'); end if;
    v_de := disc_interno.uuid_ou_nulo(x -> 'de');
    v_para := disc_interno.uuid_ou_nulo(x -> 'para');
    v_tipo := disc_interno.texto(x -> 'tipo');
    if v_de is null or v_para is null then return disc_interno.erro('Relações inválidas.'); end if;
    if v_tipo not in ('lidera', 'direto', 'indireto') then
      return disc_interno.erro('Tipo de relação inválido. Use: lidera, direto ou indireto.');
    end if;
    if v_de = v_para then return disc_interno.erro('Uma pessoa não pode ter relação com ela mesma.'); end if;
    if not exists (select 1 from public.vinculos v where v.pessoa_id = v_de and v.empresa_id = v_emp and v.status = 'ativo')
       or not exists (select 1 from public.vinculos v where v.pessoa_id = v_para and v.empresa_id = v_emp and v.status = 'ativo') then
      return disc_interno.erro('As duas pessoas da relação precisam ser colaboradoras ativas desta empresa.');
    end if;
  end loop;

  delete from public.relacoes where empresa_id = v_emp;
  for x in select t.e from jsonb_array_elements(p_relacoes) with ordinality t(e, i) order by t.i loop
    insert into public.relacoes (empresa_id, de_pessoa, para_pessoa, tipo)
    values (v_emp, disc_interno.uuid_ou_nulo(x -> 'de'), disc_interno.uuid_ou_nulo(x -> 'para'), x ->> 'tipo')
    on conflict (empresa_id, de_pessoa, para_pessoa) do update set tipo = excluded.tipo;
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object('de', r.de_pessoa, 'para', r.para_pessoa, 'tipo', r.tipo)
    order by r.criado_em, r.de_pessoa, r.para_pessoa), '[]'::jsonb)
    into saida from public.relacoes r where r.empresa_id = v_emp;
  return json_build_object('ok', true, 'relacoes', saida);
end;
$$;

-- -----------------------------------------------------------------------------
-- RLS, políticas e permissões (empresas, vinculos, relacoes: só admin; anon nada)
-- -----------------------------------------------------------------------------

alter table public.empresas enable row level security;
alter table public.vinculos enable row level security;
alter table public.relacoes enable row level security;

drop policy if exists empresas_admin on public.empresas;
create policy empresas_admin on public.empresas for all to authenticated
  using (public.e_admin()) with check (public.e_admin());
drop policy if exists vinculos_admin on public.vinculos;
create policy vinculos_admin on public.vinculos for all to authenticated
  using (public.e_admin()) with check (public.e_admin());
drop policy if exists relacoes_admin on public.relacoes;
create policy relacoes_admin on public.relacoes for all to authenticated
  using (public.e_admin()) with check (public.e_admin());

revoke all on public.empresas, public.vinculos, public.relacoes from public;
revoke all on all functions in schema disc_interno from public;
revoke all on function public.salvar_colaborador(jsonb) from public;
revoke all on function public.mover_colaborador(jsonb) from public;
revoke all on function public.salvar_relacoes(text, jsonb) from public;
revoke all on function public.enviar_resposta(jsonb) from public;
revoke all on function public.relatorio_publico(text) from public;

do $$
declare
  papel text;
begin
  foreach papel in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = papel) then
      execute format('revoke all on public.empresas, public.vinculos, public.relacoes from %I', papel);
      execute format('revoke all on all functions in schema disc_interno from %I', papel);
      execute format('revoke all on function public.salvar_colaborador(jsonb), public.mover_colaborador(jsonb), '
        || 'public.salvar_relacoes(text, jsonb) from %I', papel);
    end if;
  end loop;

  if exists (select 1 from pg_roles where rolname = 'anon') then
    grant execute on function public.enviar_resposta(jsonb), public.relatorio_publico(text) to anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant select, insert, update, delete on public.empresas, public.vinculos, public.relacoes to authenticated;
    grant execute on function public.enviar_resposta(jsonb), public.relatorio_publico(text),
      public.salvar_colaborador(jsonb), public.mover_colaborador(jsonb), public.salvar_relacoes(text, jsonb) to authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on public.empresas, public.vinculos, public.relacoes to service_role;
    grant execute on all functions in schema disc_interno to service_role;
    grant execute on function public.enviar_resposta(jsonb), public.relatorio_publico(text),
      public.salvar_colaborador(jsonb), public.mover_colaborador(jsonb), public.salvar_relacoes(text, jsonb) to service_role;
  end if;
end $$;
