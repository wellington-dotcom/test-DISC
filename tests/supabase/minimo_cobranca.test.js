'use strict';
// Testes da migração 20261015120000_minimo_cobranca.sql (preço mínimo de R$ 0,50 em cupons, pacotes e pedidos;
// conversão só com pedidos pagos; versao_banco) num Postgres 17 EMBUTIDO, com as 11 migrações aplicadas EM SEQUÊNCIA
// sobre dados "de produção" das anteriores.
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
  '20261012120000_infinitepay', '20261013120000_conexoes', '20261014120000_stripe', '20261015120000_minimo_cobranca'];
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
    const dir = path.join(os.tmpdir(), 'disc-pg-minimo-' + crypto.randomBytes(6).toString('hex'));
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





const pacote = async (chave) => (await db.query(`select * from public.pacotes where chave = $1`, [chave])).rows[0];

test('as 11 migrações em sequência sobre dados antigos: idempotente; dados gravados intactos; versão nova', async () => {
  exigirBanco();
  for (let i = 0; i < 10; i++) await db.query(SQL[i]);
  await db.query(`insert into auth.users (id, email) values ($1, 'admin@x.com'), ($2, 'outro@x.com')`, [ADMIN, OUTRO]);
  await db.query(`insert into public.admins (user_id, nome) values ($1, 'Admin')`, [ADMIN]);
  // Antes desta migração, um cupom que deixa o Completo (R$ 29,00 de lançamento) por R$ 0,29 era aceito.
  await cupom('ANTIGO99', { valor: 99 });
  assert.equal((await rpcAnon('versao_banco')).versao, 20261014120000);

  await db.query(SQL[10]);
  await db.query(SQL[10]);
  const v = await rpcAnon('versao_banco');
  assert.deepEqual(v, { ok: true, versao: 20261015120000, migracoes: MIGRACOES, faltando: [] });
  // O cupom antigo continua gravado (nada é apagado), mas não gera pedido abaixo do mínimo.
  assert.equal((await db.query(`select count(*)::int as n from public.cupons where codigo = 'ANTIGO99'`)).rows[0].n, 1);
  const r = await enviarPessoal();
  const p = await rpcAnon('criar_pedido', r.tokenResumo, 'completo', 'ANTIGO99');
  assert.equal(p.ok, false);
  assert.match(p.erro, /abaixo de R\$ 0,50/);
  // Rodar a versão anterior de novo e esta em seguida volta tudo.
  await db.query(SQL[9]);
  await db.query(SQL[10]);
  assert.equal((await rpcAnon('versao_banco')).versao, 20261015120000);
});

test('cupom: recusa preço final entre R$ 0,01 e R$ 0,49 em qualquer pacote em que vale; 100% e R$ 0,50 passam', async () => {
  exigirBanco();
  // Completo: R$ 29,00 (lançamento); Completo + Parte 2: R$ 49,00.
  await rejeita(cupom('PCT99', { valor: 99 }), /só cobra a partir de R\$ 0,50: com este cupom o Relatório completo sairia por R\$ 0,29/);
  await rejeita(cupom('VAL2880', { tipo: 'valor', valor: 2880, pacotes: ['completo'] }), /sairia por R\$ 0,20/);
  // Só no Completo + Parte 2 (R$ 49,00): 99% = R$ 0,49 também é recusado.
  await rejeita(cupom('PRO99', { valor: 99, pacotes: ['completo_plus'] }), /Completo \+ Parte 2 sairia por R\$ 0,49/);
  await cupom('GRATIS100', { valor: 100 });
  await cupom('TESTE050', { tipo: 'valor', valor: 2850, pacotes: ['completo'] });
  await cupom('VAL100', { tipo: 'valor', valor: 10000 }); // zera os dois (o painel pede confirmação): permitido
  // Desativado não é conferido; reativar é.
  await cupom('PCT99OFF', { valor: 99, ativo: false });
  await rejeita(admin(`update public.cupons set ativo = true where codigo = 'PCT99OFF'`), /só cobra a partir de R\$ 0,50/);
  const r = await enviarPessoal();
  const p = await rpcAnon('criar_pedido', r.tokenResumo, 'completo', 'TESTE050');
  assert.deepEqual([p.ok, p.valor, p.status], [true, 50, 'aguardando']);
  const g = await rpcAnon('criar_pedido', (await enviarPessoal()).tokenResumo, 'completo', 'GRATIS100');
  assert.deepEqual([g.ok, g.valor, g.status], [true, 0, 'cortesia']);
});

test('pacote: preço e lançamento 0 ou R$ 0,50+; preço novo que deixaria um cupom ativo abaixo do mínimo é recusado', async () => {
  exigirBanco();
  // O cupom antigo (gravado antes da migração) bloqueia mudar o PREÇO do Completo até ser desativado (o erro diz qual);
  // mudar só o nome passa.
  await admin(`update public.pacotes set nome = 'Relatório completo' where chave = 'completo'`);
  await rejeita(admin(`update public.pacotes set preco_centavos = 3990 where chave = 'completo'`), /cupom ANTIGO99 deixaria o Relatório completo por R\$ 0,29/);
  await admin(`update public.cupons set ativo = false where codigo = 'ANTIGO99'`);
  await rejeita(admin(`update public.pacotes set preco_centavos = 30, preco_lancamento_centavos = null where chave = 'completo'`), /use R\$ 0,50 ou mais/);
  await rejeita(admin(`update public.pacotes set preco_lancamento_centavos = 49 where chave = 'completo'`), /lançamento precisa ser de pelo menos R\$ 0,50/);
  // TESTE050 (R$ 28,50 de desconto no Completo): baixar o lançamento para R$ 28,90 deixaria R$ 0,40.
  await rejeita(admin(`update public.pacotes set preco_lancamento_centavos = 2890 where chave = 'completo'`), /cupom TESTE050 deixaria o Relatório completo por R\$ 0,40/);
  const antes = await pacote('completo');
  assert.equal(antes.preco_lancamento_centavos, 2900, 'nada mudou');
  // Desativando o cupom, o preço passa.
  await admin(`update public.cupons set ativo = false where codigo = 'TESTE050'`);
  await admin(`update public.pacotes set preco_lancamento_centavos = 2890 where chave = 'completo'`);
  assert.equal((await pacote('completo')).preco_lancamento_centavos, 2890);
  await admin(`update public.pacotes set preco_lancamento_centavos = 2900 where chave = 'completo'`);
  // Grátis (0) continua possível.
  await admin(`update public.pacotes set preco_centavos = 0, preco_lancamento_centavos = null where chave = 'completo_plus'`);
  await admin(`update public.pacotes set preco_centavos = 6900, preco_lancamento_centavos = 4900 where chave = 'completo_plus'`);
});

test('resumo_vendas: a conversão conta só pedidos pagos (cortesia não é compra)', async () => {
  exigirBanco();
  const antes = await rpcAdmin('resumo_vendas', 'tudo');
  const r = await enviarPessoal();
  const c = await rpcAnon('criar_pedido', r.tokenResumo, 'completo', 'GRATIS100');
  assert.equal(c.status, 'cortesia');
  const meio = await rpcAdmin('resumo_vendas', 'tudo');
  assert.equal(meio.compras, antes.compras, 'cortesia não conta');
  assert.equal(meio.cortesias, antes.cortesias + 1);
  const r2 = await enviarPessoal();
  const p = await rpcAnon('criar_pedido', r2.tokenResumo, 'completo', null);
  await marcarComoServico(`update public.pedidos set status = 'pago', metodo = 'pix' where id = $1`, [p.pedidoId]);
  const depois = await rpcAdmin('resumo_vendas', 'tudo');
  assert.equal(depois.compras, antes.compras + 1);
});
