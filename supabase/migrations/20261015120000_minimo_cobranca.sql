-- =============================================================================
-- Teste DISC — preço mínimo de cobrança (R$ 0,50, o mínimo do Stripe) conferido também no banco.
-- Roda DEPOIS de 20261005120000_disc.sql … 20261014120000_stripe.sql (11ª migração).
-- Idempotente e seguro sobre dados reais: só cria gatilhos e recria funções; nada é apagado nem alterado nos dados.
-- (Cupons e pacotes que já estão gravados não são reconferidos; a regra vale a partir da próxima gravação.)
-- É aplicada sozinha pela integração do GitHub do Supabase no push; à mão: SQL Editor → colar → Run.
--
--   * cupons: um cupom ATIVO não pode deixar nenhum pacote pago em que vale (todos, se a lista estiver vazia)
--     entre R$ 0,01 e R$ 0,49 — mesma regra do painel ("Novo cupom" e "Criar link com desconto").
--   * pacotes: preço e preço de lançamento são 0 (grátis) ou R$ 0,50 ou mais; e o preço novo não pode deixar um
--     cupom ativo abaixo do mínimo.
--   * criar_pedido: rede de segurança — recusa pedido que ficaria entre R$ 0,01 e R$ 0,49.
--   * resumo_vendas: a conversão "resumo grátis → compra" conta só pedidos pagos (cortesia não é compra).
--   * versao_banco() passa a conhecer esta migração (versão 20261015120000).
-- =============================================================================

-- Preço com cupom (mesma conta do criar_pedido).
create or replace function disc_interno.preco_com_cupom(p_base int, p_tipo text, p_valor int)
returns int language sql immutable set search_path = '' as $$
  select case when p_tipo = 'percentual' then round(p_base * (100 - p_valor) / 100.0)::int
              else greatest(0, p_base - p_valor) end;
$$;

-- Primeiro pacote pago (ativo ou não) em que o cupom deixaria o preço de hoje entre R$ 0,01 e R$ 0,49:
-- 'Nome do pacote|centavos' ou null.
create or replace function disc_interno.cupom_abaixo_do_minimo(p_tipo text, p_valor int, p_pacotes text[])
returns text language sql stable set search_path = '' as $$
  select x.nome || '|' || x.final
    from (select pa.nome, disc_interno.preco_com_cupom(disc_interno.preco_atual(pa), p_tipo, p_valor) as final, pa.ordem
            from public.pacotes pa
           where pa.chave <> 'gratis' and disc_interno.preco_atual(pa) > 0
             and (coalesce(cardinality(p_pacotes), 0) = 0 or pa.chave = any (p_pacotes))) x
   where x.final between 1 and 49
   order by x.ordem
   limit 1;
$$;

create or replace function disc_interno.reais(p_centavos int)
returns text language sql immutable set search_path = '' as $$
  select 'R$ ' || (p_centavos / 100)::text || ',' || lpad((p_centavos % 100)::text, 2, '0');
$$;

create or replace function disc_interno.cupons_minimo_cobranca()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_ruim text;
begin
  if not new.ativo then return new; end if;
  v_ruim := disc_interno.cupom_abaixo_do_minimo(new.tipo, new.valor, new.pacotes);
  if v_ruim is not null then
    raise exception using
      message = 'O Stripe só cobra a partir de R$ 0,50: com este cupom o ' || split_part(v_ruim, '|', 1) || ' sairia por ' ||
                disc_interno.reais(split_part(v_ruim, '|', 2)::int) || '. Use um desconto menor ou 100% (grátis).';
  end if;
  return new;
end;
$$;

drop trigger if exists cupons_minimo_cobranca on public.cupons;
create trigger cupons_minimo_cobranca before insert or update on public.cupons
  for each row execute function disc_interno.cupons_minimo_cobranca();

create or replace function disc_interno.pacotes_minimo_cobranca()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  cu record;
  v_final int;
begin
  -- Só confere quando o preço muda (editar o nome ou a ordem não esbarra em cupom antigo).
  if tg_op = 'UPDATE' and new.preco_centavos is not distinct from old.preco_centavos
     and new.preco_lancamento_centavos is not distinct from old.preco_lancamento_centavos
     and new.lancamento_ate is not distinct from old.lancamento_ate then
    return new;
  end if;
  if new.preco_centavos between 1 and 49 then
    raise exception using
      message = 'O Stripe só cobra a partir de R$ 0,50: use R$ 0,50 ou mais (ou 0 para grátis).';
  end if;
  if new.preco_lancamento_centavos is not null and new.preco_lancamento_centavos between 1 and 49 then
    raise exception using
      message = 'O preço de lançamento precisa ser de pelo menos R$ 0,50 (o mínimo que o Stripe cobra).';
  end if;
  if new.chave <> 'gratis' and disc_interno.preco_atual(new) > 0 then
    for cu in select c.codigo, c.tipo, c.valor from public.cupons c
               where c.ativo and (cardinality(c.pacotes) = 0 or new.chave = any (c.pacotes)) loop
      v_final := disc_interno.preco_com_cupom(disc_interno.preco_atual(new), cu.tipo, cu.valor);
      if v_final between 1 and 49 then
        raise exception using
          message = 'Com esse preço, o cupom ' || cu.codigo || ' deixaria o ' || new.nome || ' por ' || disc_interno.reais(v_final) ||
                    ' (o Stripe só cobra a partir de R$ 0,50). Ajuste ou desative o cupom antes.';
      end if;
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists pacotes_minimo_cobranca on public.pacotes;
create trigger pacotes_minimo_cobranca before insert or update on public.pacotes
  for each row execute function disc_interno.pacotes_minimo_cobranca();

-- -----------------------------------------------------------------------------
-- criar_pedido: igual à 20261011120000, mais a rede de segurança do mínimo
-- -----------------------------------------------------------------------------

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
    -- Rede de segurança (o preço do pacote mudou depois do cupom): o Stripe não cobra menos de R$ 0,50.
    if v_valor between 1 and 49 then
      return disc_interno.erro('Com este cupom o valor ficaria abaixo de R$ 0,50, o mínimo para pagar. Fale com quem enviou o cupom.');
    end if;
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

-- -----------------------------------------------------------------------------
-- resumo_vendas: igual à 20261013120000, mas a conversão conta só pedidos pagos
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
    where not p.teste and p.status = 'pago' and p.pago_em >= v_ini; -- cortesia não é compra
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
-- versao_banco: + 20261015120000_minimo_cobranca
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
                                              and pg_catalog.pg_get_constraintdef(c.oid) like '%stripe%')),
      (10, '20261015120000_minimo_cobranca', to_regprocedure('disc_interno.cupons_minimo_cobranca()') is not null)
    ) as t(ordem, nome, ok)
    order by ordem
  loop
    if m.ok then aplicadas := aplicadas || m.nome; else faltando := faltando || m.nome; end if;
  end loop;
  return json_build_object('ok', true, 'versao', 20261015120000, 'migracoes', to_jsonb(aplicadas),
    'faltando', to_jsonb(faltando));
end;
$$;

-- -----------------------------------------------------------------------------
-- Permissões (create or replace mantém as concedidas; reforça aqui por segurança)
-- -----------------------------------------------------------------------------

revoke all on function disc_interno.preco_com_cupom(int, text, int), disc_interno.cupom_abaixo_do_minimo(text, int, text[]),
  disc_interno.reais(int), disc_interno.cupons_minimo_cobranca(), disc_interno.pacotes_minimo_cobranca() from public;
revoke all on function public.criar_pedido(text, text, text), public.resumo_vendas(text), public.versao_banco() from public;

do $$
declare
  papel text;
begin
  foreach papel in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = papel) then
      execute format('grant execute on function public.criar_pedido(text, text, text), public.versao_banco() to %I', papel);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.resumo_vendas(text) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.resumo_vendas(text) to authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.criar_pedido(text, text, text), public.resumo_vendas(text), public.versao_banco() to service_role;
    grant execute on all functions in schema disc_interno to service_role;
  end if;
end $$;

-- O PostgREST relê o esquema.
notify pgrst, 'reload schema';
