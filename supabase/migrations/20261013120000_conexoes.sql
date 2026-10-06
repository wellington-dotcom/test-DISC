-- =============================================================================
-- Teste DISC — aba "Conexões" do painel: pedido de TESTE da InfinitePay (link real de R$ 1,00).
-- Roda DEPOIS de 20261005120000_disc.sql … 20261012120000_infinitepay.sql (9ª migração).
-- Idempotente e seguro sobre dados reais: só ACRESCENTA uma coluna (padrão false) e recria funções; nada é apagado.
-- É aplicada sozinha pela integração do GitHub do Supabase no push; à mão: colar no SQL Editor e "Run".
--
--   * pedidos.teste   true = pedido criado pelo botão "Gerar link de teste (R$ 1,00)" da aba Conexões (Edge Function
--                     "admin", service_role). Não entra nas vendas: resumo_vendas ignora; o painel não lista.
--   * resumo_vendas   passa a ignorar pedidos de teste (receita, vendas, cortesias, estornos, aguardando, conversão).
--   * pedido_json     passa a devolver "teste".
--   * versao_banco()  passa a conhecer esta migração (versão 20261013120000).
-- ATENÇÃO: não rode de novo as migrações anteriores depois desta sem rodar esta em seguida (elas recriam
-- versao_banco, pedido_json e resumo_vendas nas versões antigas).
-- =============================================================================

alter table public.pedidos add column if not exists teste boolean not null default false;

create index if not exists pedidos_teste_idx on public.pedidos (criado_em) where teste;

-- -----------------------------------------------------------------------------
-- pedido_json: + teste
-- -----------------------------------------------------------------------------

create or replace function disc_interno.pedido_json(p public.pedidos)
returns json language sql stable set search_path = '' as $$
  select json_build_object('id', p.id, 'respostaId', coalesce(p.resposta_id, ''), 'pacote', p.pacote,
    'valorCentavos', p.valor_centavos, 'valorOriginalCentavos', p.valor_original_centavos, 'cupom', coalesce(p.cupom, ''),
    'status', p.status, 'metodo', p.metodo, 'asaasCobrancaId', coalesce(p.asaas_cobranca_id, ''),
    'provedor', coalesce(p.provedor, ''), 'provedorRef', coalesce(p.provedor_ref, ''), 'checkoutUrl', coalesce(p.checkout_url, ''),
    'teste', p.teste,
    'email', p.email, 'nome', p.nome, 'criadoEm', disc_interno.iso(p.criado_em), 'pagoEm', disc_interno.iso(p.pago_em),
    'reembolsadoEm', disc_interno.iso(p.reembolsado_em));
$$;

-- -----------------------------------------------------------------------------
-- resumo_vendas: sem os pedidos de teste
-- -----------------------------------------------------------------------------

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
    where not p.teste and p.status in ('pago', 'cortesia') and p.pago_em >= v_ini;
  return json_build_object('ok', true, 'periodo', v_per,
    'hoje', (select json_build_object('vendas', count(*), 'receitaCentavos', coalesce(sum(p.valor_centavos), 0))
             from public.pedidos p where not p.teste and p.status = 'pago' and p.pago_em >= v_hoje),
    'mes', (select json_build_object('vendas', count(*), 'receitaCentavos', coalesce(sum(p.valor_centavos), 0))
            from public.pedidos p where not p.teste and p.status = 'pago' and p.pago_em >= v_mes),
    'vendas', (select count(*) from public.pedidos p where not p.teste and p.status = 'pago' and p.pago_em >= v_ini),
    'receitaCentavos', (select coalesce(sum(p.valor_centavos), 0) from public.pedidos p
                        where not p.teste and p.status = 'pago' and p.pago_em >= v_ini),
    'cortesias', (select count(*) from public.pedidos p where not p.teste and p.status = 'cortesia' and p.pago_em >= v_ini),
    'estornos', (select count(*) from public.pedidos p where not p.teste and p.status = 'estornado' and p.reembolsado_em >= v_ini),
    'aguardando', (select count(*) from public.pedidos p where not p.teste and p.status = 'aguardando' and p.criado_em >= v_ini),
    'resumos', v_resumos,
    'compras', v_compras,
    'conversao', case when v_resumos > 0 then round(v_compras::numeric / v_resumos, 4) else 0 end,
    'porPacote', (select coalesce(json_agg(json_build_object('pacote', x.pacote, 'vendas', x.n, 'receitaCentavos', x.soma)
                   order by x.pacote), '[]'::json)
                  from (select p.pacote, count(*) as n, sum(p.valor_centavos) as soma from public.pedidos p
                        where not p.teste and p.status = 'pago' and p.pago_em >= v_ini group by p.pacote) x));
end;
$$;

-- -----------------------------------------------------------------------------
-- versao_banco: + 20261013120000_conexoes
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
                                                  and a.attname = 'origem' and not a.attisdropped)),
      (7, '20261012120000_infinitepay', exists (select 1 from pg_catalog.pg_attribute a
                                                 where a.attrelid = to_regclass('public.pedidos')
                                                   and a.attname = 'provedor_dados' and not a.attisdropped)),
      (8, '20261013120000_conexoes', exists (select 1 from pg_catalog.pg_attribute a
                                              where a.attrelid = to_regclass('public.pedidos')
                                                and a.attname = 'teste' and not a.attisdropped))
    ) as t(ordem, nome, ok)
    order by ordem
  loop
    if m.ok then aplicadas := aplicadas || m.nome; else faltando := faltando || m.nome; end if;
  end loop;
  return json_build_object('ok', true, 'versao', 20261013120000, 'migracoes', to_jsonb(aplicadas),
    'faltando', to_jsonb(faltando));
end;
$$;

-- -----------------------------------------------------------------------------
-- Permissões (create or replace mantém as concedidas; reforça aqui por segurança)
-- -----------------------------------------------------------------------------

revoke all on function disc_interno.pedido_json(public.pedidos) from public;
revoke all on function public.resumo_vendas(text), public.versao_banco() from public;

do $$
declare
  papel text;
begin
  foreach papel in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = papel) then
      execute format('revoke all on function disc_interno.pedido_json(public.pedidos) from %I', papel);
      execute format('grant execute on function public.versao_banco() to %I', papel);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.resumo_vendas(text) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.resumo_vendas(text) to authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function disc_interno.pedido_json(public.pedidos), public.resumo_vendas(text), public.versao_banco() to service_role;
  end if;
end $$;

-- O PostgREST relê o esquema (a coluna nova aparece na API sem esperar).
notify pgrst, 'reload schema';
