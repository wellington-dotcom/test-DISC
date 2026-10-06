'use strict';
// Testes da migração 20261013120000_conexoes.sql (aba Conexões: pedidos.teste; resumo_vendas sem os testes;
// pedido_json e versao_banco) num Postgres 17 EMBUTIDO, com as 9 migrações aplicadas EM SEQUÊNCIA sobre dados
// "de produção" das anteriores. Mesmo preparo "tipo Supabase" de tests/supabase/infinitepay.test.js.
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
  '20261012120000_infinitepay', '20261013120000_conexoes'];
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
    const dir = path.join(os.tmpdir(), 'disc-pg-conexoes-' + crypto.randomBytes(6).toString('hex'));
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



test('as 9 migrações em sequência sobre dados antigos: idempotente; pedidos antigos ficam teste = false', async () => {
  exigirBanco();
  for (let i = 0; i < 8; i++) await db.query(SQL[i]);
  await db.query(`insert into auth.users (id, email) values ($1, 'admin@x.com'), ($2, 'outro@x.com')`, [ADMIN, OUTRO]);
  await db.query(`insert into public.admins (user_id, nome) values ($1, 'Admin')`, [ADMIN]);
  const r = await enviarPessoal();
  const a = await rpcAnon('criar_pedido', r.tokenResumo, 'completo', null);
  assert.equal((await rpcAnon('versao_banco')).versao, 20261012120000);
  assert.deepEqual((await db.query(`select public.versao_banco() as r`)).rows[0].r.faltando, []);

  await db.query(SQL[8]);
  await db.query(SQL[8]);
  assert.equal((await pedido(a.pedidoId)).teste, false);
  const v = await rpcAnon('versao_banco');
  assert.deepEqual(v, { ok: true, versao: 20261013120000, migracoes: MIGRACOES, faltando: [] });
  assert.deepEqual(await rpcAdmin('versao_banco'), v);
});

test('pedido de teste (service_role) fica fora do resumo_vendas; pedido_json devolve teste', async () => {
  exigirBanco();
  const r = await enviarPessoal();
  const real = await rpcAnon('criar_pedido', r.tokenResumo, 'completo', null);
  assert.equal((await rpcAdmin('atualizar_pedido', real.pedidoId, 'pago')).ok, true);
  const antes = await rpcAdmin('resumo_vendas', 'tudo');

  // Como a Edge Function "admin" faz: insert com teste = true, depois link e pagamento confirmado.
  const ins = (await marcarComoServico(`insert into public.pedidos (pacote, valor_centavos, valor_original_centavos, email, nome, teste, provedor, provedor_dados)
    values ('completo', 100, 100, 'admin@x.com', 'Teste de conexão (painel)', true, 'infinitepay', '{"teste":true}') returning id`)).rows[0];
  await marcarComoServico(`update public.pedidos set checkout_url = 'https://checkout.infinitepay.io/x/teste' where id = $1 and teste`, [ins.id]);
  await marcarComoServico(`update public.pedidos set status = 'pago', metodo = 'pix' where id = $1 and teste`, [ins.id]);
  const t = await pedido(ins.id);
  assert.equal(t.teste, true);
  assert.equal(t.status, 'pago');
  assert.ok(t.pago_em);

  const depois = await rpcAdmin('resumo_vendas', 'tudo');
  for (const k of ['vendas', 'receitaCentavos', 'compras', 'cortesias', 'aguardando', 'conversao']) assert.deepEqual(depois[k], antes[k], k);
  assert.deepEqual(depois.hoje, antes.hoje);
  assert.deepEqual(depois.mes, antes.mes);
  assert.deepEqual(depois.porPacote, antes.porPacote);

  // Teste aguardando também não conta.
  await marcarComoServico(`insert into public.pedidos (pacote, valor_centavos, email, teste) values ('completo', 100, 'admin@x.com', true)`);
  assert.equal((await rpcAdmin('resumo_vendas', 'tudo')).aguardando, antes.aguardando);

  // O painel lê a coluna (para esconder os testes) e pedido_json a devolve.
  const lidas = (await admin(`select id, teste from public.pedidos where id = $1`, [ins.id])).rows;
  assert.deepEqual(lidas, [{ id: ins.id, teste: true }]);
  const x = await rpcAdmin('atualizar_pedido', ins.id, 'estornado');
  assert.equal(x.ok, true, x.erro);
  assert.equal(x.pedido.teste, true);
  assert.equal((await rpcAdmin('atualizar_pedido', real.pedidoId, 'pago')).pedido.teste, false);
  assert.equal((await rpcAdmin('resumo_vendas', 'tudo')).estornos, antes.estornos, 'estorno de teste não conta');
  await rejeita(anon(`select teste from public.pedidos`), /permission denied/);
  assert.deepEqual((await outro(`select id from public.pedidos where id = $1`, [ins.id])).rows, [], 'quem não é admin não vê');
});
