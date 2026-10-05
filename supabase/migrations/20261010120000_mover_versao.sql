-- =============================================================================
-- Teste DISC — rodada 4: mover resposta de processo, contratar candidato, topo do organograma e
-- "versão do banco".
-- Roda DEPOIS de 20261005120000_disc.sql, 20261006120000_pessoas_formulario.sql,
-- 20261007120000_empresas_equipes.sql, 20261008120000_parte2.sql e 20261009120000_fotos.sql.
-- Idempotente e seguro sobre dados reais: só ACRESCENTA (2 colunas com valor padrão) e recria funções;
-- nada é apagado e as linhas que já existem continuam válidas (histórico vazio, organograma {}).
-- É aplicada sozinha pela integração do GitHub do Supabase no push; à mão: colar no SQL Editor e "Run".
--
--   * respostas.historico_processos (jsonb, lista de {de, para, deCodigo, paraCodigo, em}): cada vez que a
--     resposta muda de processo seletivo. de/para = id do processo ('' = sem processo).
--   * empresas.organograma (jsonb, objeto): {topoIds: [ids das pessoas que ficam no TOPO do organograma
--     mesmo sem liderados]}.
--   * mover_resposta(id da resposta, id do processo | '') — só admin: troca processo_id e o código
--     (avaliacao) e registra no histórico. '' = sem processo.
--   * contratar_pessoa({respostaId | pessoaId, empresaId, cargo, area}) — só admin: a pessoa vira
--     colaboradora ATIVA da empresa; ativa em OUTRA empresa = move (lá fica desligada com fim = hoje e as
--     relações dela somem); já ativa nesta = atualiza cargo/área. Com respostaId a resposta vira 'aprovado'
--     (e o cargo vazio usa a vaga da resposta).
--   * salvar_relacoes(empresa, relacoes, opcoes) — ganha o 3º parâmetro opcional {topoIds: [...]} (só
--     ficam ids de colaboradores ATIVOS da empresa; sem o 3º parâmetro o topo salvo não muda) e devolve
--     também topoIds. A versão de 2 parâmetros é substituída por esta (chamar com 2 continua valendo).
--   * versao_banco() — pública, só leitura: {ok, versao: 20261010120000, migracoes: [aplicadas],
--     faltando: [migrações cujo efeito não existe no banco]} (confere tabelas/colunas de cada uma).
-- ATENÇÃO: não rode de novo a 20261007 depois desta sem rodar esta em seguida (ela recria salvar_relacoes
-- com 2 parâmetros).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Colunas novas
-- -----------------------------------------------------------------------------

alter table public.respostas add column if not exists historico_processos jsonb not null default '[]'::jsonb;
alter table public.empresas add column if not exists organograma jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'respostas_historico_processos_lista'
                 and conrelid = 'public.respostas'::regclass) then
    alter table public.respostas add constraint respostas_historico_processos_lista
      check (jsonb_typeof(historico_processos) = 'array' and char_length(historico_processos::text) <= 20000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'empresas_organograma_objeto'
                 and conrelid = 'public.empresas'::regclass) then
    alter table public.empresas add constraint empresas_organograma_objeto
      check (jsonb_typeof(organograma) = 'object' and char_length(organograma::text) <= 100000);
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Auxiliar: topo do organograma só com colaboradores ATIVOS da empresa (sem repetir, na ordem dada).
-- -----------------------------------------------------------------------------

create or replace function disc_interno.topo_ativos(p_empresa uuid, p_ids jsonb)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(x.id::text) order by x.ordem), '[]'::jsonb)
  from (
    select u.id, min(u.i) as ordem
    from (
      select disc_interno.uuid_ou_nulo(t.e) as id, t.i
      from jsonb_array_elements(case when jsonb_typeof(p_ids) = 'array' then p_ids else '[]'::jsonb end)
        with ordinality t(e, i)
    ) u
    where u.id is not null
      and exists (select 1 from public.vinculos v
                  where v.pessoa_id = u.id and v.empresa_id = p_empresa and v.status = 'ativo')
    group by u.id
  ) x;
$$;

-- -----------------------------------------------------------------------------
-- mover_resposta: troca a resposta de processo seletivo (só admin)
-- -----------------------------------------------------------------------------

create or replace function public.mover_resposta(p_resposta text, p_processo text)
returns json
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id text := left(btrim(coalesce(p_resposta, '')), 80);
  v_texto text := btrim(coalesce(p_processo, ''));
  v_para uuid;
  v_codigo text := '';
  r public.respostas%rowtype;
  v_de_codigo text;
  v_hist jsonb;
begin
  if not public.e_admin() then return disc_interno.erro('Sem permissão.'); end if;
  if v_id = '' then return disc_interno.erro('Candidato não informado.'); end if;
  if v_texto <> '' then
    v_para := disc_interno.uuid_ou_nulo(to_jsonb(v_texto));
    if v_para is null then return disc_interno.erro('Processo não encontrado.'); end if;
    select coalesce(p.codigo, '') into v_codigo from public.processos p where p.id = v_para;
    if not found then return disc_interno.erro('Processo não encontrado.'); end if;
  end if;

  select * into r from public.respostas x where x.id = v_id for update;
  if not found then return disc_interno.erro('Candidato não encontrado.'); end if;

  if r.processo_id is not distinct from v_para then
    return json_build_object('ok', true, 'id', v_id, 'processoId', coalesce(v_para::text, ''),
      'avaliacao', r.avaliacao, 'historicoProcessos', r.historico_processos, 'mudou', false);
  end if;

  select coalesce(p.codigo, '') into v_de_codigo from public.processos p where p.id = r.processo_id;
  v_hist := coalesce(r.historico_processos, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
    'de', coalesce(r.processo_id::text, ''), 'para', coalesce(v_para::text, ''),
    'deCodigo', coalesce(v_de_codigo, r.avaliacao, ''), 'paraCodigo', v_codigo,
    'em', disc_interno.iso(now())));
  -- Guarda só as 50 mudanças mais recentes.
  if jsonb_array_length(v_hist) > 50 then
    select jsonb_agg(e order by i) into v_hist
    from jsonb_array_elements(v_hist) with ordinality t(e, i)
    where i > jsonb_array_length(v_hist) - 50;
  end if;

  update public.respostas
  set processo_id = v_para, avaliacao = v_codigo, historico_processos = v_hist
  where id = v_id;

  return json_build_object('ok', true, 'id', v_id, 'processoId', coalesce(v_para::text, ''),
    'avaliacao', v_codigo, 'historicoProcessos', v_hist, 'mudou', true);
end;
$$;

-- -----------------------------------------------------------------------------
-- contratar_pessoa: candidato aprovado vira colaborador ativo da empresa (só admin)
-- -----------------------------------------------------------------------------

create or replace function public.contratar_pessoa(p_dados jsonb)
returns json
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_resp text := '';
  v_pes uuid;
  v_emp uuid;
  v_cargo text;
  v_area text;
  v_vaga text := '';
  v_de uuid;
  atual public.vinculos%rowtype;
  v_id uuid;
begin
  if not public.e_admin() then return disc_interno.erro('Sem permissão.'); end if;
  if p_dados is null or jsonb_typeof(p_dados) <> 'object' then return disc_interno.erro('Dados da contratação ausentes.'); end if;

  v_emp := disc_interno.uuid_ou_nulo(p_dados -> 'empresaId');
  if v_emp is null or not exists (select 1 from public.empresas e where e.id = v_emp) then
    return disc_interno.erro('Empresa não encontrada.');
  end if;
  v_cargo := disc_interno.limpar_texto(disc_interno.texto(p_dados -> 'cargo'), 120);
  v_area := disc_interno.limpar_texto(disc_interno.texto(p_dados -> 'area'), 120);

  v_resp := left(btrim(disc_interno.texto(p_dados -> 'respostaId')), 80);
  if v_resp <> '' then
    select r.pessoa_id, coalesce(r.vaga, '') into v_pes, v_vaga from public.respostas r where r.id = v_resp;
    if not found then return disc_interno.erro('Candidato não encontrado.'); end if;
    if v_pes is null then
      return disc_interno.erro('Esta resposta não tem um WhatsApp válido. Cadastre a pessoa pela empresa (Colaboradores).');
    end if;
  elsif disc_interno.texto(p_dados -> 'pessoaId') <> '' then
    v_pes := disc_interno.uuid_ou_nulo(p_dados -> 'pessoaId');
    if v_pes is null or not exists (select 1 from public.pessoas p where p.id = v_pes) then
      return disc_interno.erro('Pessoa não encontrada.');
    end if;
  else
    return disc_interno.erro('Informe a pessoa.');
  end if;
  if v_cargo = '' then v_cargo := disc_interno.limpar_texto(v_vaga, 120); end if;

  select * into atual from public.vinculos v where v.pessoa_id = v_pes and v.status = 'ativo' for update;
  if found and atual.empresa_id = v_emp then
    update public.vinculos set cargo = v_cargo, area = v_area where id = atual.id;
    v_id := atual.id;
  else
    if found then
      v_de := atual.empresa_id;
      update public.vinculos set status = 'desligado', fim = current_date where id = atual.id;
    end if;
    insert into public.vinculos (pessoa_id, empresa_id, cargo, area, status)
    values (v_pes, v_emp, v_cargo, v_area, 'ativo') returning id into v_id;
  end if;

  if v_resp <> '' then
    update public.respostas set status = 'aprovado' where id = v_resp;
  end if;

  return json_build_object('ok', true, 'colaborador', disc_interno.colaborador_json(v_id),
    'movido', v_de is not null, 'deEmpresaId', coalesce(v_de::text, ''));
end;
$$;

-- -----------------------------------------------------------------------------
-- salvar_relacoes: + 3º parâmetro opcional {topoIds} (substitui a versão de 2 parâmetros)
-- -----------------------------------------------------------------------------

drop function if exists public.salvar_relacoes(text, jsonb);

create or replace function public.salvar_relacoes(p_empresa text, p_relacoes jsonb, p_opcoes jsonb default null)
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
  v_topo jsonb;
begin
  if not public.e_admin() then return disc_interno.erro('Sem permissão.'); end if;
  if v_emp is null or not exists (select 1 from public.empresas e where e.id = v_emp) then
    return disc_interno.erro('Empresa não encontrada.');
  end if;
  if p_relacoes is null or jsonb_typeof(p_relacoes) <> 'array' then return disc_interno.erro('Relações inválidas.'); end if;
  if jsonb_array_length(p_relacoes) > 2000 then return disc_interno.erro('Relações demais.'); end if;
  if p_opcoes is not null and jsonb_typeof(p_opcoes) <> 'object' then return disc_interno.erro('Relações inválidas.'); end if;
  if p_opcoes is not null and p_opcoes ? 'topoIds' then
    if jsonb_typeof(p_opcoes -> 'topoIds') <> 'array' then return disc_interno.erro('Relações inválidas.'); end if;
    if jsonb_array_length(p_opcoes -> 'topoIds') > 2000 then return disc_interno.erro('Relações demais.'); end if;
  end if;

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

  if p_opcoes is not null and p_opcoes ? 'topoIds' then
    v_topo := disc_interno.topo_ativos(v_emp, p_opcoes -> 'topoIds');
    update public.empresas
    set organograma = coalesce(organograma, '{}'::jsonb) || jsonb_build_object('topoIds', v_topo)
    where id = v_emp;
  else
    select disc_interno.topo_ativos(v_emp, e.organograma -> 'topoIds') into v_topo from public.empresas e where e.id = v_emp;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('de', r.de_pessoa, 'para', r.para_pessoa, 'tipo', r.tipo)
    order by r.criado_em, r.de_pessoa, r.para_pessoa), '[]'::jsonb)
    into saida from public.relacoes r where r.empresa_id = v_emp;
  return json_build_object('ok', true, 'relacoes', saida, 'topoIds', coalesce(v_topo, '[]'::jsonb));
end;
$$;

-- -----------------------------------------------------------------------------
-- versao_banco: o painel confere se o banco está atualizado (pública, só leitura)
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
                                                    and a.attname = 'organograma' and not a.attisdropped))
    ) as t(ordem, nome, ok)
    order by ordem
  loop
    if m.ok then aplicadas := aplicadas || m.nome; else faltando := faltando || m.nome; end if;
  end loop;
  return json_build_object('ok', true, 'versao', 20261010120000, 'migracoes', to_jsonb(aplicadas),
    'faltando', to_jsonb(faltando));
end;
$$;

-- -----------------------------------------------------------------------------
-- Permissões
-- -----------------------------------------------------------------------------
-- respostas.historico_processos e empresas.organograma: o painel LÊ (select já dado); mudança só pelas
-- funções acima (respostas não tem update dessa coluna; empresas segue com a RLS de admin).

revoke all on function disc_interno.topo_ativos(uuid, jsonb) from public;
revoke all on function public.mover_resposta(text, text) from public;
revoke all on function public.contratar_pessoa(jsonb) from public;
revoke all on function public.salvar_relacoes(text, jsonb, jsonb) from public;
revoke all on function public.versao_banco() from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function disc_interno.topo_ativos(uuid, jsonb) from anon;
    revoke all on function public.mover_resposta(text, text), public.contratar_pessoa(jsonb),
      public.salvar_relacoes(text, jsonb, jsonb) from anon;
    grant execute on function public.versao_banco() to anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function disc_interno.topo_ativos(uuid, jsonb) from authenticated;
    grant execute on function public.mover_resposta(text, text), public.contratar_pessoa(jsonb),
      public.salvar_relacoes(text, jsonb, jsonb), public.versao_banco() to authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function disc_interno.topo_ativos(uuid, jsonb) to service_role;
    grant execute on function public.mover_resposta(text, text), public.contratar_pessoa(jsonb),
      public.salvar_relacoes(text, jsonb, jsonb), public.versao_banco() to service_role;
  end if;
end $$;

-- O PostgREST relê o esquema (funções novas/trocadas aparecem na API sem esperar).
notify pgrst, 'reload schema';
