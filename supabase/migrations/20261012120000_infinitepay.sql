-- =============================================================================
-- Teste DISC — InfinitePay como meio de pagamento da venda direta (B2C), ao lado do Asaas.
-- Roda DEPOIS de 20261005120000_disc.sql … 20261011120000_vendas.sql (8ª migração).
-- Idempotente e seguro sobre dados reais: só ACRESCENTA colunas (nulas) e recria funções; nada é apagado.
-- É aplicada sozinha pela integração do GitHub do Supabase no push; à mão: colar no SQL Editor e "Run".
--
--   * pedidos.provedor       'asaas' | 'infinitepay' (null = ainda sem pagamento iniciado, ou cupom/cortesia).
--                            Pedidos antigos com cobrança no Asaas viram 'asaas'.
--   * pedidos.provedor_ref   referência do pagamento no provedor (InfinitePay: transaction_nsu, ou o slug da fatura).
--   * pedidos.checkout_url   link da página de pagamento (InfinitePay: o checkout hospedado; Asaas: a fatura).
--   * pedidos.provedor_dados jsonb com o que o provedor mandou (link criado, retorno do cliente, corpo bruto do webhook,
--                            resposta do payment_check) — só para depuração; nada disso é mostrado ao cliente.
--   As Edge Functions "pagamento" e "infinitepay-webhook" (service_role) gravam essas colunas direto na tabela.
--   O painel continua lendo pedidos por RLS (select) e muda status só por atualizar_pedido.
--   * pedido_json (usada por atualizar_pedido) passa a devolver provedor, provedorRef e checkoutUrl.
--   * versao_banco() passa a conhecer esta migração (versão 20261012120000).
-- ATENÇÃO: não rode de novo as migrações anteriores depois desta sem rodar esta em seguida (elas recriam
-- versao_banco e pedido_json nas versões antigas).
-- =============================================================================

alter table public.pedidos add column if not exists provedor text;
alter table public.pedidos add column if not exists provedor_ref text;
alter table public.pedidos add column if not exists checkout_url text;
alter table public.pedidos add column if not exists provedor_dados jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pedidos_provedor_valido'
                 and conrelid = 'public.pedidos'::regclass) then
    alter table public.pedidos add constraint pedidos_provedor_valido
      check (provedor is null or provedor in ('asaas', 'infinitepay'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pedidos_provedor_ref_formato'
                 and conrelid = 'public.pedidos'::regclass) then
    alter table public.pedidos add constraint pedidos_provedor_ref_formato
      check (provedor_ref is null or provedor_ref ~ '^[A-Za-z0-9._:-]{1,120}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pedidos_checkout_url_formato'
                 and conrelid = 'public.pedidos'::regclass) then
    alter table public.pedidos add constraint pedidos_checkout_url_formato
      check (checkout_url is null or (checkout_url ~ '^https://' and char_length(checkout_url) <= 500));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pedidos_provedor_dados_formato'
                 and conrelid = 'public.pedidos'::regclass) then
    alter table public.pedidos add constraint pedidos_provedor_dados_formato
      check (provedor_dados is null or (jsonb_typeof(provedor_dados) = 'object' and char_length(provedor_dados::text) <= 60000));
  end if;
end $$;

-- Pedidos que já têm cobrança no Asaas.
update public.pedidos set provedor = 'asaas' where provedor is null and asaas_cobranca_id is not null;

create index if not exists pedidos_provedor_ref_idx on public.pedidos (provedor, provedor_ref) where provedor_ref is not null;

-- -----------------------------------------------------------------------------
-- pedido_json: + provedor, provedorRef, checkoutUrl
-- -----------------------------------------------------------------------------

create or replace function disc_interno.pedido_json(p public.pedidos)
returns json language sql stable set search_path = '' as $$
  select json_build_object('id', p.id, 'respostaId', coalesce(p.resposta_id, ''), 'pacote', p.pacote,
    'valorCentavos', p.valor_centavos, 'valorOriginalCentavos', p.valor_original_centavos, 'cupom', coalesce(p.cupom, ''),
    'status', p.status, 'metodo', p.metodo, 'asaasCobrancaId', coalesce(p.asaas_cobranca_id, ''),
    'provedor', coalesce(p.provedor, ''), 'provedorRef', coalesce(p.provedor_ref, ''), 'checkoutUrl', coalesce(p.checkout_url, ''),
    'email', p.email, 'nome', p.nome, 'criadoEm', disc_interno.iso(p.criado_em), 'pagoEm', disc_interno.iso(p.pago_em),
    'reembolsadoEm', disc_interno.iso(p.reembolsado_em));
$$;

-- -----------------------------------------------------------------------------
-- versao_banco: + 20261012120000_infinitepay
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
                                                   and a.attname = 'provedor_dados' and not a.attisdropped))
    ) as t(ordem, nome, ok)
    order by ordem
  loop
    if m.ok then aplicadas := aplicadas || m.nome; else faltando := faltando || m.nome; end if;
  end loop;
  return json_build_object('ok', true, 'versao', 20261012120000, 'migracoes', to_jsonb(aplicadas),
    'faltando', to_jsonb(faltando));
end;
$$;

-- -----------------------------------------------------------------------------
-- Permissões (create or replace mantém as concedidas; reforça aqui por segurança)
-- -----------------------------------------------------------------------------

revoke all on function disc_interno.pedido_json(public.pedidos) from public;
revoke all on function public.versao_banco() from public;

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
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function disc_interno.pedido_json(public.pedidos), public.versao_banco() to service_role;
  end if;
end $$;

-- O PostgREST relê o esquema (colunas novas aparecem na API sem esperar).
notify pgrst, 'reload schema';
