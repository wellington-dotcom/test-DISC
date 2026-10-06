'use strict';
// Testes da migração 20261014120000_stripe.sql (pedidos.provedor aceita 'stripe'; versao_banco) num Postgres 17
// EMBUTIDO, com as 10 migrações aplicadas EM SEQUÊNCIA sobre dados "de produção" das anteriores.
// Mesmo preparo "tipo Supabase" de tests/supabase/conexoes.test.js.
//
// Rodar: npm run test:supabase
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { payloadValido } = require('../helpers/fixtures.js');

const RAIZ = path.join(__dirname, '..', '..');
const ler = (n) => fs.readFileSync(path.join(RAIZ, 'supabase', 'migrations', n), 'utf8');
const MIGRACOES = ['20261005120000_disc', '20261006120000_pessoas_formulario', '20261007120000_empresas_equipes',
  '20261008120000_parte2', '20261009120000_fotos', '20261010120000_mover_versao', '20261011120000_vendas',
  '20261012120000_infinitepay', '20261013120000_conexoes', '20261014120000_stripe'];
const SQL = MIGRACOES.map((n) => ler(n + '.sql'));

const PREPARO_SUPABASE = `
  create role anon nologin noinherit;
  create role authenticated nologin noinherit;
  create role service_role nologin noinherit bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb not null default '{}'::jsonb);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ), '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
`;

const ADMIN = 'aaaaaaaa-1111-4111-8111-111111111111';
const OUTRO = 'bbbbbbbb-2222-4222-8222-222222222222';
const EXIGIDO = '1234'.repeat(10);

let pg = null;
let db = null;
let falhaInicio = null;

test.before(async () => {
  try {
    const EmbeddedPostgres = (await import('embedded-postgres')).default;
    const dir = path.join(os.tmpdir(), 'disc-pg-stripe-' + crypto.randomBytes(6).toString('hex'));
    pg = new EmbeddedPostgres({
      databaseDir: dir, user: 'postgres', password: 'postgres', port: 61000 + Math.floor(Math.random() * 800),
      persistent: false, createPostgresUser: true, initdbFlags: ['--encoding=UTF8', '--locale=C'],
      onLog: () => {}, onError: () => {}
    });
    await pg.initialise();
    await pg.start();
    db = pg.getPgClient();
    await db.connect();
    await db.query(PREPARO_SUPABASE);
  } catch (err) {
    falhaInicio = err;
  }
});

test.after(async () => {
  try { if (db) await db.end(); } catch (e) { /* ignora */ }
  try { if (pg) await pg.stop(); } catch (e) { /* ignora */ }
});

function exigirBanco() {
  if (falhaInicio) throw new Error('Postgres embutido não iniciou: ' + falhaInicio.message);
}

async function como(papel, uid, sql, params) {
  await db.query('begin');
  try {
    await db.query(`set local role ${papel}`);
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [uid || '']);
    const r = await db.query(sql, params);
    await db.query('commit');
    return r;
  } catch (err) {
    await db.query('rollback');
    throw err;
  }
}
const anon = (sql, params) => como('anon', null, sql, params);
const admin = (sql, params) => como('authenticated', ADMIN, sql, params);
const outro = (sql, params) => como('authenticated', OUTRO, sql, params);
async function rpc(papel, uid, fn, args) {
  const marcas = (args || []).map((_, i) => '$' + (i + 1)).join(', ');
  return (await como(papel, uid, `select public.${fn}(${marcas}) as r`, args || [])).rows[0].r;
}
const json = (a) => (a && typeof a === 'object' ? JSON.stringify(a) : a);
const rpcAnon = (fn, ...args) => rpc('anon', null, fn, args.map(json));
const rpcAdmin = (fn, ...args) => rpc('authenticated', ADMIN, fn, args.map(json));

async function rejeita(promessa, padrao) {
  await assert.rejects(promessa, (err) => { assert.match(String(err.message), padrao); return true; });
}

let seq = 0;
function pessoal(extra) {
  seq += 1;
  const p = payloadValido(Object.assign({ id: 'pv-' + Date.now().toString(36) + '-' + seq, nome: 'Bia Pessoal Souza',
    email: 'bia' + seq + '@exemplo.com', telefone: '' }, extra || {}));
  return p;
}
const enviarPessoal = (extra) => rpcAnon('enviar_resposta_pessoal', pessoal(extra));
const linha = async (id) => (await db.query(`select * from public.respostas where id = $1`, [id])).rows[0];
const pedido = async (id) => (await db.query(`select * from public.pedidos where id = $1`, [id])).rows[0];
async function cupom(codigo, extra) {
  const x = Object.assign({ tipo: 'percentual', valor: 10, usos_max: null, valido_ate: null, ativo: true, pacotes: [] }, extra || {});
  await admin(`insert into public.cupons (codigo, tipo, valor, usos_max, valido_ate, ativo, pacotes) values ($1, $2, $3, $4, $5, $6, $7)`,
    [codigo, x.tipo, x.valor, x.usos_max, x.valido_ate, x.ativo, x.pacotes]);
}
const marcarComoServico = (sql, params) => como('service_role', null, sql, params);




test('as 10 migrações em sequência sobre dados antigos: idempotente; regra do provedor aceita stripe', async () => {
  exigirBanco();
  for (let i = 0; i < 9; i++) await db.query(SQL[i]);
  await db.query(`insert into auth.users (id, email) values ($1, 'admin@x.com'), ($2, 'outro@x.com')`, [ADMIN, OUTRO]);
  await db.query(`insert into public.admins (user_id, nome) values ($1, 'Admin')`, [ADMIN]);
  const r = await enviarPessoal();
  const a = await rpcAnon('criar_pedido', r.tokenResumo, 'completo', null);
  await marcarComoServico(`update public.pedidos set provedor = 'infinitepay', provedor_ref = 'TX1' where id = $1`, [a.pedidoId]);
  assert.equal((await rpcAnon('versao_banco')).versao, 20261013120000);
  // Antes da migração o banco recusa 'stripe'.
  await rejeita(marcarComoServico(`update public.pedidos set provedor = 'stripe' where id = $1`, [a.pedidoId]), /pedidos_provedor_valido/);

  await db.query(SQL[9]);
  await db.query(SQL[9]);
  const v = await rpcAnon('versao_banco');
  assert.deepEqual(v, { ok: true, versao: 20261014120000, migracoes: MIGRACOES, faltando: [] });
  assert.deepEqual(await rpcAdmin('versao_banco'), v);
  const ped = await pedido(a.pedidoId);
  assert.deepEqual([ped.provedor, ped.provedor_ref], ['infinitepay', 'TX1'], 'dados antigos intactos');
  const regras = (await db.query(`select count(*)::int as n from pg_constraint where conname = 'pedidos_provedor_valido'`)).rows[0].n;
  assert.equal(regras, 1);
  // Rodar a 20261012 de novo não volta a regra antiga.
  await db.query(SQL[7]);
  await db.query(SQL[9]);
  assert.equal((await rpcAnon('versao_banco')).versao, 20261014120000);
});

test('pedido com Stripe: provedor stripe e provedor_ref = PaymentIntent; outro provedor continua recusado', async () => {
  exigirBanco();
  const r = await enviarPessoal();
  const a = await rpcAnon('criar_pedido', r.tokenResumo, 'completo', null);
  // Como a Edge Function "pagamento" faz (service_role).
  await marcarComoServico(`update public.pedidos set provedor = 'stripe', provedor_ref = 'pi_3Abc123XYZ', provedor_dados = '{"intent":{"id":"pi_3Abc123XYZ"}}'
    where id = $1 and status = 'aguardando'`, [a.pedidoId]);
  await marcarComoServico(`update public.pedidos set status = 'pago', metodo = 'cartao' where id = $1`, [a.pedidoId]);
  const p = await pedido(a.pedidoId);
  assert.deepEqual([p.provedor, p.provedor_ref, p.status, p.metodo], ['stripe', 'pi_3Abc123XYZ', 'pago', 'cartao']);
  assert.ok(p.pago_em);
  // O painel vê o provedor no pedido_json (atualizar_pedido) e o relatório libera.
  const x = await rpcAdmin('atualizar_pedido', a.pedidoId, 'estornado');
  assert.equal(x.ok, true, x.erro);
  assert.deepEqual([x.pedido.provedor, x.pedido.provedorRef], ['stripe', 'pi_3Abc123XYZ']);
  await rejeita(marcarComoServico(`update public.pedidos set provedor = 'paypal' where id = $1`, [a.pedidoId]), /pedidos_provedor_valido/);
  // Pedido de teste do Stripe (aba Conexões) fica fora das vendas.
  const antes = await rpcAdmin('resumo_vendas', 'tudo');
  const t = (await marcarComoServico(`insert into public.pedidos (pacote, valor_centavos, valor_original_centavos, email, nome, teste, provedor, provedor_dados)
    values ('completo', 100, 100, 'admin@x.com', 'Teste de conexão (painel)', true, 'stripe', '{"teste":true}') returning id`)).rows[0];
  await marcarComoServico(`update public.pedidos set status = 'pago', metodo = 'cartao', provedor_ref = 'pi_teste123456' where id = $1 and teste`, [t.id]);
  const depois = await rpcAdmin('resumo_vendas', 'tudo');
  assert.deepEqual([depois.vendas, depois.receitaCentavos], [antes.vendas, antes.receitaCentavos]);
});
