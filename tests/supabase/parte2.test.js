'use strict';
// Testes da migração 20261008120000_parte2.sql (Parte 2: perfil exigido pelo trabalho) num Postgres 17
// EMBUTIDO, com as 4 migrações aplicadas EM SEQUÊNCIA sobre dados "de produção" das versões anteriores.
// Mesmo preparo "tipo Supabase" de tests/supabase/banco.test.js.
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
const M1 = ler('20261005120000_disc.sql');
const M2 = ler('20261006120000_pessoas_formulario.sql');
const M3 = ler('20261007120000_empresas_equipes.sql');
const M4 = ler('20261008120000_parte2.sql');

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

let pg = null;
let db = null;
let falhaInicio = null;

test.before(async () => {
  try {
    const EmbeddedPostgres = (await import('embedded-postgres')).default;
    const dir = path.join(os.tmpdir(), 'disc-pg-p2-' + crypto.randomBytes(6).toString('hex'));
    pg = new EmbeddedPostgres({
      databaseDir: dir, user: 'postgres', password: 'postgres', port: 58200 + Math.floor(Math.random() * 800),
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
const rpcAdmin = (fn, ...args) => rpc('authenticated', ADMIN, fn, args.map((a) => (a && typeof a === 'object' ? JSON.stringify(a) : a)));

async function rejeita(promessa, padrao) {
  await assert.rejects(promessa, (err) => { assert.match(String(err.message), padrao); return true; });
}

let seq = 0;
function payload(extra) { seq += 1; return payloadValido(Object.assign({ id: 'p2-' + Date.now().toString(36) + '-' + seq }, extra || {})); }
const enviar = (extra) => rpc('anon', null, 'enviar_resposta', [JSON.stringify(payload(extra))]);

async function novaEmpresa(nome) {
  return (await admin(`insert into public.empresas (nome, cidade) values ($1, 'Boa Vista') returning id`, [nome])).rows[0].id;
}
async function pessoaPorTel(tel) {
  return (await db.query(`select * from public.pessoas where telefone = $1`, [tel])).rows[0];
}
async function colaborador(empresaId, nome, telefone, cargo, area) {
  const r = await rpcAdmin('salvar_colaborador', { empresaId, nome, telefone, cargo: cargo || '', area: area || '' });
  assert.equal(r.ok, true, r.erro);
  return r.colaborador;
}


const EXIGIDO = '4321'.repeat(5) + '1234'.repeat(5);

async function processo(codigo, config, tipo) {
  await db.query(`insert into public.processos (codigo, nome, tipo, config) values ($1, $2, $3, $4)`,
    [codigo, 'Processo ' + codigo, tipo || 'selecao', JSON.stringify(config || {})]);
}
const linha = async (id) => (await db.query(`select * from public.respostas where id = $1`, [id])).rows[0];

test('as 4 migrações em sequência sobre dados antigos: idempotente; formulário antigo = parte2 desligada', async () => {
  exigirBanco();
  await db.query(M1);
  await db.query(M2);
  await db.query(`insert into public.processos (codigo, nome, config) values ('VELH', 'Velho', '{"formulario":{"campos":{"idade":"opcional"}}}')`);
  await db.query(`insert into public.respostas (id, avaliacao, nome, telefone, idade, respostas)
    values ('antigo-p2', 'VELH', 'Clara Antiga Reis', '11955554444', 30, repeat('1234', 25))`);
  await db.query(M3);
  await db.query(M4);
  await db.query(M4);
  await db.query(M4);

  const r = await linha('antigo-p2');
  assert.equal(r.exigido, null);
  assert.equal(r.nome, 'Clara Antiga Reis');
  const a = await rpc('anon', null, 'avaliacao_publica', ['VELH']);
  assert.equal(a.ok, true);
  assert.equal(a.avaliacao.formulario.parte2, 'desligada');
  assert.equal(a.formulario.campos.idade, 'opcional');
  // Envio pelo formulário antigo: o exigido que vier é descartado.
  const e = await enviar({ avaliacao: 'VELH', exigido: EXIGIDO });
  assert.equal(e.ok, true, e.erro);
  assert.equal((await linha(e.id)).exigido, null);
  assert.equal((await linha(e.id)).payload.exigido, undefined);

  await db.query(`delete from public.respostas`);
  await db.query(`insert into auth.users (id, email) values ($1, 'admin@x.com')`, [ADMIN]);
  await db.query(`insert into public.admins (user_id, nome) values ($1, 'Admin')`, [ADMIN]);
});

test('normalização de formulario.parte2 no gatilho e em avaliacao_publica', async () => {
  exigirBanco();
  await processo('LIG1', { formulario: { parte2: 'ligada' } });
  await processo('DES1', { formulario: { parte2: 'qualquer' } });
  await processo('SEM1', {});
  const cfg = async (c) => (await db.query(`select config from public.processos where codigo = $1`, [c])).rows[0].config;
  assert.equal((await cfg('LIG1')).formulario.parte2, 'ligada');
  assert.equal((await cfg('DES1')).formulario.parte2, 'desligada');
  assert.equal((await rpc('anon', null, 'avaliacao_publica', ['LIG1'])).avaliacao.formulario.parte2, 'ligada');
  assert.equal((await rpc('anon', null, 'avaliacao_publica', ['DES1'])).formulario.parte2, 'desligada');
  assert.equal((await rpc('anon', null, 'avaliacao_publica', ['SEM1'])).formulario.parte2, 'desligada');
});

test('parte2 ligada: exigido obrigatório e válido; grava na coluna e no payload; reenvio idempotente', async () => {
  exigirBanco();
  await processo('LIG2', { formulario: { parte2: 'ligada' } }, 'equipe');
  const msg = 'Responda também a segunda parte do teste.';
  for (const ruim of [undefined, '', null, 123, '1234'.repeat(9), '1234'.repeat(11), '1123' + '1234'.repeat(9),
    '1234'.repeat(9) + '5123', '1234'.repeat(9) + '4441']) {
    const r = await enviar({ avaliacao: 'LIG2', exigido: ruim });
    assert.equal(r.ok, false, String(ruim));
    assert.equal(r.erro, msg);
  }
  assert.equal((await db.query(`select count(*)::int n from public.respostas where avaliacao = 'LIG2'`)).rows[0].n, 0);

  const p = payload({ avaliacao: 'LIG2', exigido: EXIGIDO, telefone: '11966665555' });
  const r1 = await rpc('anon', null, 'enviar_resposta', [JSON.stringify(p)]);
  assert.equal(r1.ok, true, r1.erro);
  const l = await linha(p.id);
  assert.equal(l.exigido, EXIGIDO);
  assert.equal(l.payload.exigido, EXIGIDO);
  const r2 = await rpc('anon', null, 'enviar_resposta', [JSON.stringify(p)]);
  assert.deepEqual([r2.ok, r2.duplicado, r2.protocolo], [true, true, r1.protocolo]);
  assert.equal((await db.query(`select count(*)::int n from public.respostas where id = $1`, [p.id])).rows[0].n, 1);
  // A validação vem antes da idempotência (mesma regra dos outros campos): reenvio sem exigido é recusado.
  const r3 = await rpc('anon', null, 'enviar_resposta', [JSON.stringify(Object.assign({}, p, { exigido: undefined }))]);
  assert.equal(r3.ok, false);
});

test('parte2 desligada ou link geral: exigido descartado', async () => {
  exigirBanco();
  await processo('DES2', { formulario: { parte2: 'desligada' } });
  for (const [aval, ex] of [['DES2', EXIGIDO], ['DES2', 'lixo'], ['', EXIGIDO]]) {
    const r = await enviar({ avaliacao: aval, exigido: ex });
    assert.equal(r.ok, true, r.erro);
    const l = await linha(r.id);
    assert.equal(l.exigido, null);
    assert.equal(l.payload.exigido, undefined);
  }
});

test('restrição da coluna exigido; admin continua atualizando respostas (RLS)', async () => {
  exigirBanco();
  const r = await enviar({ avaliacao: 'LIG2', exigido: EXIGIDO, telefone: '11966660000' });
  assert.equal(r.ok, true, r.erro);
  await rejeita(db.query(`update public.respostas set exigido = '1234' where id = $1`, [r.id]), /respostas_exigido_valido/);
  await rejeita(db.query(`update public.respostas set exigido = repeat('1124', 10) where id = $1`, [r.id]), /respostas_exigido_valido/);
  // A restrição roda também quando o painel (authenticated) muda o status; o exigido em si só o servidor grava.
  const u = await admin(`update public.respostas set status = 'aprovado' where id = $1 returning exigido`, [r.id]);
  await rejeita(admin(`update public.respostas set exigido = null where id = $1`, [r.id]), /permission denied/);
  assert.equal(u.rows[0].exigido, EXIGIDO);
  assert.equal((await admin(`select exigido from public.respostas where id = $1`, [r.id])).rows[0].exigido, EXIGIDO);
  assert.equal((await db.query(`select disc_interno.exigido_valido(repeat('2143', 10)) v`)).rows[0].v, true);
  assert.equal((await db.query(`select disc_interno.exigido_valido(null) v`)).rows[0].v, false);
});
