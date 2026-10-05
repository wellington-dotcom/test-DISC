'use strict';
// Testes da migração 20261012120000_infinitepay.sql (InfinitePay ao lado do Asaas: pedidos.provedor, provedor_ref,
// checkout_url, provedor_dados; pedido_json e versao_banco) num Postgres 17 EMBUTIDO, com as 8 migrações aplicadas
// EM SEQUÊNCIA sobre dados "de produção" das anteriores. Mesmo preparo "tipo Supabase" de tests/supabase/vendas.test.js.
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
  '20261012120000_infinitepay'];
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
    const dir = path.join(os.tmpdir(), 'disc-pg-infinitepay-' + crypto.randomBytes(6).toString('hex'));
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


test('as 8 migrações em sequência sobre dados antigos: idempotente; pedido com cobrança do Asaas vira provedor asaas', async () => {
  exigirBanco();
  for (let i = 0; i < 7; i++) await db.query(SQL[i]);
  await db.query(`insert into auth.users (id, email) values ($1, 'admin@x.com'), ($2, 'outro@x.com')`, [ADMIN, OUTRO]);
  await db.query(`insert into public.admins (user_id, nome) values ($1, 'Admin')`, [ADMIN]);
  // Pedidos "de produção" da 20261011: um com cobrança no Asaas, outro ainda sem pagamento.
  const r = await enviarPessoal();
  const a = await rpcAnon('criar_pedido', r.tokenResumo, 'completo', null);
  const b = await rpcAnon('criar_pedido', r.tokenResumo, 'completo_plus', null);
  await db.query(`update public.pedidos set asaas_cobranca_id = 'pay_123' where id = $1`, [a.pedidoId]);
  const semFuncao = (await db.query(`select public.versao_banco() as r`)).rows[0].r;
  assert.equal(semFuncao.versao, 20261011120000);

  await db.query(SQL[7]);
  await db.query(SQL[7]);
  assert.equal((await pedido(a.pedidoId)).provedor, 'asaas');
  assert.equal((await pedido(b.pedidoId)).provedor, null);
  for (const c of ['provedor_ref', 'checkout_url', 'provedor_dados']) assert.equal((await pedido(a.pedidoId))[c], null, c);
  // Rodar de novo não muda o que as funções gravaram.
  await db.query(`update public.pedidos set provedor = 'infinitepay', checkout_url = 'https://checkout.infinitepay.io/x' where id = $1`, [b.pedidoId]);
  await db.query(SQL[7]);
  assert.equal((await pedido(b.pedidoId)).provedor, 'infinitepay');

  const v = await rpcAnon('versao_banco');
  assert.deepEqual(v, { ok: true, versao: 20261012120000, migracoes: MIGRACOES, faltando: [] });
  assert.deepEqual(await rpcAdmin('versao_banco'), v);
});

test('colunas novas: formatos conferidos pelo banco; service_role grava; anon não lê pedidos', async () => {
  exigirBanco();
  const r = await enviarPessoal();
  const p = await rpcAnon('criar_pedido', r.tokenResumo, 'completo', null);
  const dados = { link: { url: 'https://checkout.infinitepay.io/notus/abc', resposta: { url: 'x' } }, webhook: { corpo: { order_nsu: p.pedidoId } } };
  await marcarComoServico(`update public.pedidos set provedor = 'infinitepay', provedor_ref = 'TX-123_a.b:c',
    checkout_url = 'https://checkout.infinitepay.io/notus/abc', provedor_dados = $2 where id = $1`, [p.pedidoId, JSON.stringify(dados)]);
  const l = await pedido(p.pedidoId);
  assert.deepEqual([l.provedor, l.provedor_ref, l.checkout_url], ['infinitepay', 'TX-123_a.b:c', 'https://checkout.infinitepay.io/notus/abc']);
  assert.deepEqual(l.provedor_dados, dados);
  await rejeita(db.query(`update public.pedidos set provedor = 'paypal' where id = $1`, [p.pedidoId]), /pedidos_provedor_valido/);
  await rejeita(db.query(`update public.pedidos set provedor_ref = 'a b' where id = $1`, [p.pedidoId]), /pedidos_provedor_ref_formato/);
  await rejeita(db.query(`update public.pedidos set checkout_url = 'http://x' where id = $1`, [p.pedidoId]), /pedidos_checkout_url_formato/);
  await rejeita(db.query(`update public.pedidos set provedor_dados = '[1]' where id = $1`, [p.pedidoId]), /pedidos_provedor_dados_formato/);
  await rejeita(db.query(`update public.pedidos set provedor_dados = $2 where id = $1`,
    [p.pedidoId, JSON.stringify({ x: 'a'.repeat(61000) })]), /pedidos_provedor_dados_formato/);
  await rejeita(anon(`select provedor_dados from public.pedidos`), /permission denied/);
  // O pagamento pela função (service_role) marca pago; status_pedido/relatorio_pessoal seguem iguais.
  await marcarComoServico(`update public.pedidos set status = 'pago', metodo = 'pix' where id = $1 and status = 'aguardando'`, [p.pedidoId]);
  assert.deepEqual(await rpcAnon('status_pedido', p.pedidoId, p.tokenAcesso), { ok: true, status: 'pago', pacote: 'completo' });
  assert.equal((await rpcAnon('relatorio_pessoal', p.tokenAcesso)).ok, true);
  assert.ok((await pedido(p.pedidoId)).pago_em);
});

test('painel: pedido_json (atualizar_pedido) devolve provedor, provedorRef e checkoutUrl; select lê as colunas', async () => {
  exigirBanco();
  const r = await enviarPessoal();
  const p = await rpcAnon('criar_pedido', r.tokenResumo, 'completo', null);
  await marcarComoServico(`update public.pedidos set provedor = 'infinitepay', provedor_ref = 'TX9',
    checkout_url = 'https://checkout.infinitepay.io/n/z' where id = $1`, [p.pedidoId]);
  const x = await rpcAdmin('atualizar_pedido', p.pedidoId, 'pago');
  assert.equal(x.ok, true, x.erro);
  assert.deepEqual([x.pedido.provedor, x.pedido.provedorRef, x.pedido.checkoutUrl, x.pedido.status],
    ['infinitepay', 'TX9', 'https://checkout.infinitepay.io/n/z', 'pago']);
  const linhas = (await admin(`select provedor, checkout_url from public.pedidos where id = $1`, [p.pedidoId])).rows;
  assert.deepEqual(linhas, [{ provedor: 'infinitepay', checkout_url: 'https://checkout.infinitepay.io/n/z' }]);
  assert.deepEqual((await outro(`select id from public.pedidos where id = $1`, [p.pedidoId])).rows, [], 'quem não é admin não vê');
  const semProv = await rpcAnon('criar_pedido', r.tokenResumo, 'completo_plus', null);
  assert.equal((await rpcAdmin('atualizar_pedido', semProv.pedidoId, 'cortesia')).pedido.provedor, '');
});
