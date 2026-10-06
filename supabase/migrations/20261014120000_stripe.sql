-- =============================================================================
-- Teste DISC — Stripe como meio de pagamento da venda direta (B2C): pagamento DENTRO do site (Payment Element:
-- cartão, Apple Pay, Google Pay e Pix), ao lado da InfinitePay e do Asaas.
-- Roda DEPOIS de 20261005120000_disc.sql … 20261013120000_conexoes.sql (10ª migração).
-- Idempotente e seguro sobre dados reais: só troca uma regra (check) por outra mais larga e recria versao_banco;
-- nada é apagado. É aplicada sozinha pela integração do GitHub do Supabase no push; à mão: SQL Editor → colar → Run.
--
--   * pedidos.provedor       passa a aceitar 'stripe' ('asaas' | 'infinitepay' | 'stripe'; null = sem pagamento iniciado).
--   * pedidos.provedor_ref   no Stripe guarda o id do PaymentIntent (pi_…; já cabe no formato da 20261012120000).
--   * pedidos.provedor_dados no Stripe: {intent:{id, valor, tentativa, livemode, criadoEm}, conferencia:{…}} (depuração).
--   As Edge Functions "pagamento" e "stripe-webhook" (service_role) gravam essas colunas direto na tabela.
--   * versao_banco() passa a conhecer esta migração (versão 20261014120000).
-- ATENÇÃO: não rode de novo as migrações anteriores depois desta sem rodar esta em seguida (a 20261012120000 recria
-- a regra antiga só se ela não existir; versao_banco volta à versão antiga).
-- =============================================================================

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'pedidos_provedor_valido'
             and conrelid = 'public.pedidos'::regclass
             and pg_get_constraintdef(oid) not like '%stripe%') then
    alter table public.pedidos drop constraint pedidos_provedor_valido;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pedidos_provedor_valido'
                 and conrelid = 'public.pedidos'::regclass) then
    alter table public.pedidos add constraint pedidos_provedor_valido
      check (provedor is null or provedor in ('asaas', 'infinitepay', 'stripe'));
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- versao_banco: + 20261014120000_stripe
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
                                                and a.attname = 'teste' and not a.attisdropped)),
      (9, '20261014120000_stripe', exists (select 1 from pg_catalog.pg_constraint c
                                            where c.conrelid = to_regclass('public.pedidos')
                                              and c.conname = 'pedidos_provedor_valido'
                                              and pg_catalog.pg_get_constraintdef(c.oid) like '%stripe%'))
    ) as t(ordem, nome, ok)
    order by ordem
  loop
    if m.ok then aplicadas := aplicadas || m.nome; else faltando := faltando || m.nome; end if;
  end loop;
  return json_build_object('ok', true, 'versao', 20261014120000, 'migracoes', to_jsonb(aplicadas),
    'faltando', to_jsonb(faltando));
end;
$$;

-- -----------------------------------------------------------------------------
-- Permissões (create or replace mantém as concedidas; reforça aqui por segurança)
-- -----------------------------------------------------------------------------

revoke all on function public.versao_banco() from public;

do $$
declare
  papel text;
begin
  foreach papel in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = papel) then
      execute format('grant execute on function public.versao_banco() to %I', papel);
    end if;
  end loop;
end $$;

-- O PostgREST relê o esquema.
notify pgrst, 'reload schema';
