'use strict';
// Testes da migração 20261009120000_fotos.sql (fotos do candidato, da pessoa e do usuário do painel) num
// Postgres 17 EMBUTIDO, com as 5 migrações aplicadas EM SEQUÊNCIA sobre dados "de produção" das versões anteriores.
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
const M5 = ler('20261009120000_fotos.sql');

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
    const dir = path.join(os.tmpdir(), 'disc-pg-fotos-' + crypto.randomBytes(6).toString('hex'));
    pg = new EmbeddedPostgres({
      databaseDir: dir, user: 'postgres', password: 'postgres', port: 60100 + Math.floor(Math.random() * 800),
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
function payload(extra) { seq += 1; return payloadValido(Object.assign({ id: 'ft-' + Date.now().toString(36) + '-' + seq }, extra || {})); }
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


// Fotos de teste: data URL JPEG válida no formato (o banco confere prefixo, alfabeto e tamanho).
const foto = (marca, tam) => 'data:image/jpeg;base64,/9j/' + (marca || 'A') + 'B'.repeat(Math.max(0, (tam || 200) - 28));
const F1 = foto('Um');
const F2 = foto('Dois');
const MSG_INVALIDA = 'Foto inválida ou grande demais. Escolha outra imagem.';

async function processo(codigo, config, tipo) {
  await db.query(`insert into public.processos (codigo, nome, tipo, config) values ($1, $2, $3, $4)`,
    [codigo, 'Processo ' + codigo, tipo || 'selecao', JSON.stringify(config || {})]);
}
const linha = async (id) => (await db.query(`select * from public.respostas where id = $1`, [id])).rows[0];

test('as 5 migrações em sequência sobre dados antigos: idempotente; formulário antigo = foto opcional', async () => {
  exigirBanco();
  await db.query(M1);
  await db.query(M2);
  await db.query(`insert into public.processos (codigo, nome, config) values ('VELH', 'Velho', '{"formulario":{"campos":{"idade":"opcional"}}}')`);
  await db.query(`insert into public.respostas (id, avaliacao, nome, telefone, idade, respostas)
    values ('antigo-ft', 'VELH', 'Clara Antiga Reis', '11955554444', 30, repeat('1234', 25))`);
  await db.query(M3);
  await db.query(M4);
  await db.query(`insert into auth.users (id, email) values ($1, 'admin@x.com'), ($2, 'outro@x.com')`, [ADMIN, OUTRO]);
  await db.query(`insert into public.admins (user_id, nome) values ($1, 'Admin'), ($2, 'Outro')`, [ADMIN, OUTRO]);
  await db.query(M5);
  await db.query(M5);
  await db.query(M5);

  const r = await linha('antigo-ft');
  assert.equal(r.foto, null);
  assert.equal(r.nome, 'Clara Antiga Reis');
  assert.equal((await pessoaPorTel('5511955554444')).foto, null);
  assert.equal((await db.query(`select foto from public.admins where user_id = $1`, [ADMIN])).rows[0].foto, null);
  const a = await rpc('anon', null, 'avaliacao_publica', ['VELH']);
  assert.equal(a.ok, true);
  assert.equal(a.formulario.campos.foto, 'opcional');
  assert.equal(a.formulario.campos.idade, 'opcional');
  assert.equal(a.formulario.parte2, 'desligada');
});

test('formulario.campos.foto normalizado no gatilho de processos', async () => {
  exigirBanco();
  await processo('FOB1', { formulario: { campos: { foto: 'obrigatorio' } } });
  await processo('FOC1', { formulario: { campos: { foto: 'oculto' } } });
  await processo('FXX1', { formulario: { campos: { foto: 'talvez' } } });
  const cfg = async (c) => (await db.query(`select config from public.processos where codigo = $1`, [c])).rows[0].config;
  assert.equal((await cfg('FOB1')).formulario.campos.foto, 'obrigatorio');
  assert.equal((await cfg('FOC1')).formulario.campos.foto, 'oculto');
  assert.equal((await cfg('FXX1')).formulario.campos.foto, 'opcional');
  assert.deepEqual((await rpc('anon', null, 'avaliacao_publica', ['FOB1'])).formulario.campos,
    { idade: 'obrigatorio', funcao: 'opcional', empresa: 'opcional', email: 'oculto', cidade: 'oculto', foto: 'obrigatorio' });
});

test('envio com foto: grava na resposta e na ficha (fora do payload); sem foto não apaga; nova substitui', async () => {
  exigirBanco();
  const tel = '11977771111';
  const e1 = await enviar({ telefone: tel, foto: F1 });
  assert.equal(e1.ok, true, e1.erro);
  assert.equal(JSON.stringify(e1).includes('base64'), false, 'a resposta do envio não devolve a foto');
  const l1 = await linha(e1.id);
  assert.equal(l1.foto, F1);
  assert.equal(l1.payload.foto, undefined);
  assert.equal((await pessoaPorTel('55' + tel)).foto, F1);

  const e2 = await enviar({ telefone: tel, foto: '' });
  assert.equal(e2.ok, true, e2.erro);
  assert.equal((await linha(e2.id)).foto, null);
  assert.equal((await pessoaPorTel('55' + tel)).foto, F1, 'envio sem foto mantém a da ficha');

  const e3 = await enviar({ telefone: tel, foto: '  ' + F2 + '  ' });
  assert.equal(e3.ok, true, e3.erro);
  assert.equal((await linha(e3.id)).foto, F2);
  assert.equal((await pessoaPorTel('55' + tel)).foto, F2);
});

test('obrigatória, oculta e inválida', async () => {
  exigirBanco();
  for (const ruim of [undefined, '', null, 123, '   ']) {
    assert.deepEqual(await enviar({ avaliacao: 'FOB1', foto: ruim }), { ok: false, erro: 'Envie uma foto.' });
  }
  const ok = await enviar({ avaliacao: 'FOB1', foto: F1, telefone: '11977772222' });
  assert.equal(ok.ok, true, ok.erro);
  assert.equal((await linha(ok.id)).foto, F1);

  const oc = await enviar({ avaliacao: 'FOC1', foto: 'lixo', telefone: '11977773333' });
  assert.equal(oc.ok, true, oc.erro);
  assert.equal((await linha(oc.id)).foto, null);
  assert.equal((await pessoaPorTel('5511977773333')).foto, null);

  for (const ruim of ['data:image/png;base64,iVBORw0KGgo=', 'data:image/jpeg;base64,AAAA', 'https://x.com/a.jpg',
    'data:image/jpeg;base64,/9j/<script>', foto('X', 40001), 'data:image/jpeg;base64,/9j/AA\nAA']) {
    assert.deepEqual(await enviar({ foto: ruim }), { ok: false, erro: MSG_INVALIDA }, ruim.slice(0, 40));
  }
  // No limite: 40 000 caracteres passa.
  const limite = await enviar({ foto: foto('L', 40000), telefone: '11977774444' });
  assert.equal(limite.ok, true, limite.erro);
});

test('limite do envio: 80 000 caracteres', async () => {
  exigirBanco();
  const r = await enviar({ foto: foto('G', 39000), vaga: 'x'.repeat(30000), telefone: '11977775555' });
  assert.equal(r.ok, true, r.erro);
  assert.deepEqual(await enviar({ foto: F1, vaga: 'x'.repeat(81000) }), { ok: false, erro: 'Requisição grande demais.' });
});

test('restrições das colunas; anon não lê nada; o painel não grava foto direto', async () => {
  exigirBanco();
  for (const t of ['pessoas', 'respostas', 'admins']) {
    await rejeita(db.query(`update public.${t} set foto = 'data:image/png;base64,AAAA'`), new RegExp(t + '_foto_valida'));
    await rejeita(db.query(`update public.${t} set foto = $1`, [foto('Z', 40001)]), new RegExp(t + '_foto_valida'));
  }
  for (const t of ['pessoas', 'respostas', 'admins']) {
    await rejeita(anon(`select foto from public.${t}`), /permission denied/);
  }
  const r = await enviar({ foto: F1, telefone: '11977776666' });
  await rejeita(admin(`update public.respostas set foto = null where id = $1`, [r.id]), /permission denied/);
  await rejeita(admin(`update public.pessoas set foto = null`), /permission denied/);
  // avaliacao_publica não traz foto nenhuma
  assert.equal(JSON.stringify(await rpc('anon', null, 'avaliacao_publica', ['FOB1'])).includes('base64'), false);
  await rejeita(rpc('anon', null, 'salvar_minha_foto', [F1]), /permission denied/);
  await rejeita(rpc('anon', null, 'remover_foto', [r.id]), /permission denied/);
  await rejeita(anon(`select disc_interno.foto_valida($1)`, [F1]), /permission denied/);
});

test('admins.foto: só o próprio usuário troca (salvar_minha_foto); o nome continua editável pelo painel', async () => {
  exigirBanco();
  const fotoDe = async (uid) => (await db.query(`select foto from public.admins where user_id = $1`, [uid])).rows[0].foto;
  assert.deepEqual(await rpcAdmin('salvar_minha_foto', F1), { ok: true, foto: F1 });
  assert.equal(await fotoDe(ADMIN), F1);
  assert.equal(await fotoDe(OUTRO), null);
  assert.deepEqual(await rpcAdmin('salvar_minha_foto', 'data:image/png;base64,AAAA'), { ok: false, erro: MSG_INVALIDA });
  assert.equal(await fotoDe(ADMIN), F1);

  // Direto na tabela: nem a própria nem a de outro (privilégio por coluna).
  await rejeita(admin(`update public.admins set foto = $1 where user_id = $2`, [F2, OUTRO]), /permission denied/);
  await rejeita(admin(`update public.admins set foto = null where user_id = $1`, [ADMIN]), /permission denied/);
  const terceiro = 'cccccccc-3333-4333-8333-333333333333';
  await db.query(`insert into auth.users (id, email) values ($1, 'c@x.com')`, [terceiro]);
  await rejeita(admin(`insert into public.admins (user_id, nome, foto) values ($1, 'C', $2)`, [terceiro, F2]), /permission denied/);
  // Nome e cadastro sem foto seguem funcionando.
  await admin(`update public.admins set nome = 'Outro Nome' where user_id = $1`, [OUTRO]);
  await admin(`insert into public.admins (user_id, nome) values ($1, 'Terceiro')`, [terceiro]);
  await admin(`delete from public.admins where user_id = $1`, [terceiro]);
  assert.equal((await db.query(`select nome from public.admins where user_id = $1`, [OUTRO])).rows[0].nome, 'Outro Nome');

  // Gatilho (defesa extra, mesmo se o privilégio voltar): com usuário logado, só a própria linha.
  await rejeita(como('service_role', ADMIN, `update public.admins set foto = $1 where user_id = $2`, [F2, OUTRO]),
    /Só o próprio usuário troca a foto dele/);
  await como('service_role', null, `update public.admins set foto = $1 where user_id = $2`, [F2, OUTRO]);
  assert.equal(await fotoDe(OUTRO), F2);

  // O outro admin troca/remove a dele; quem não é admin não consegue.
  assert.deepEqual(await rpc('authenticated', OUTRO, 'salvar_minha_foto', ['']), { ok: true, foto: '' });
  assert.equal(await fotoDe(OUTRO), null);
  assert.deepEqual(await rpc('authenticated', OUTRO, 'salvar_minha_foto', [null]), { ok: true, foto: '' });
  const intruso = 'dddddddd-4444-4444-8444-444444444444';
  assert.deepEqual(await rpc('authenticated', intruso, 'salvar_minha_foto', [F1]), { ok: false, erro: 'Sem permissão.' });
  assert.equal(await fotoDe(ADMIN), F1);
});

test('remover_foto (LGPD): apaga da resposta, da ficha e das outras respostas da pessoa; só admin', async () => {
  exigirBanco();
  const tel = '11977778888';
  const a = await enviar({ telefone: tel, foto: F1 });
  const b = await enviar({ telefone: tel, foto: F2 });
  const c = await enviar({ telefone: '11977779999', foto: F1 });
  const intruso = 'dddddddd-4444-4444-8444-444444444444';
  assert.deepEqual(await rpc('authenticated', intruso, 'remover_foto', [a.id]), { ok: false, erro: 'Sem permissão.' });
  assert.deepEqual(await rpcAdmin('remover_foto', 'nao-existe-1'), { ok: false, erro: 'Candidato não encontrado.' });
  const r = await rpcAdmin('remover_foto', a.id);
  assert.deepEqual(r, { ok: true, id: a.id, removidas: 3 });
  assert.equal((await linha(a.id)).foto, null);
  assert.equal((await linha(b.id)).foto, null);
  assert.equal((await pessoaPorTel('55' + tel)).foto, null);
  assert.equal((await linha(c.id)).foto, F1, 'outra pessoa não é afetada');
  assert.deepEqual(await rpcAdmin('remover_foto', a.id), { ok: true, id: a.id, removidas: 0 });
});

test('relatórios por modelo: snapshot até 1 MB', async () => {
  exigirBanco();
  const emp = await novaEmpresa('Empresa Fotos');
  const ok = JSON.stringify({ modelo: 'equipe', titulo: 'Equipe', texto: 'x'.repeat(900000) });
  const r = await admin(`insert into public.relatorios (modelo, empresa_id, dados) values ('equipe', $1, $2) returning id`, [emp, ok]);
  assert.equal(r.rowCount, 1);
  const grande = JSON.stringify({ modelo: 'equipe', texto: 'x'.repeat(1100001) });
  await rejeita(admin(`insert into public.relatorios (modelo, empresa_id, dados) values ('equipe', $1, $2)`, [emp, grande]),
    /Relatório grande demais \(máximo 1 MB\)/);
});
