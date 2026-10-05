'use strict';
// Testes da migração 20261010120000_mover_versao.sql (mover resposta de processo, contratar candidato, topo do
// organograma e versao_banco) num Postgres 17 EMBUTIDO, com as 6 migrações aplicadas EM SEQUÊNCIA sobre dados
// "de produção" das versões anteriores.
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
const M6 = ler('20261010120000_mover_versao.sql');

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
    const dir = path.join(os.tmpdir(), 'disc-pg-mover-' + crypto.randomBytes(6).toString('hex'));
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
function payload(extra) { seq += 1; return payloadValido(Object.assign({ id: 'mv-' + Date.now().toString(36) + '-' + seq }, extra || {})); }
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



async function processo(codigo, extra) {
  const x = Object.assign({ tipo: 'selecao', vaga: '' }, extra || {});
  return (await db.query(`insert into public.processos (codigo, nome, tipo, vaga) values ($1, $2, $3, $4) returning id`,
    [codigo, 'Processo ' + codigo, x.tipo, x.vaga])).rows[0].id;
}
const linha = async (id) => (await db.query(`select * from public.respostas where id = $1`, [id])).rows[0];
const intruso = 'dddddddd-4444-4444-8444-444444444444';
const NOMES = ['20261005120000_disc', '20261006120000_pessoas_formulario', '20261007120000_empresas_equipes',
  '20261008120000_parte2', '20261009120000_fotos', '20261010120000_mover_versao'];
let P_SEL = null;
let P_OUT = null;

test('as 6 migrações em sequência sobre dados antigos: idempotente; histórico vazio, organograma {}; nada se perde', async () => {
  exigirBanco();
  await db.query(M1);
  await db.query(M2);
  await db.query(`insert into public.processos (codigo, nome) values ('VELH', 'Velho')`);
  await db.query(`insert into public.respostas (id, avaliacao, processo_id, nome, telefone, idade, respostas)
    select 'antigo-mv', 'VELH', p.id, 'Clara Antiga Reis', '11955554444', 30, repeat('1234', 25) from public.processos p where p.codigo = 'VELH'`);
  await db.query(M3);
  await db.query(`insert into auth.users (id, email) values ($1, 'admin@x.com'), ($2, 'outro@x.com')`, [ADMIN, OUTRO]);
  await db.query(`insert into public.admins (user_id, nome) values ($1, 'Admin'), ($2, 'Outro')`, [ADMIN, OUTRO]);
  const emp = await novaEmpresa('Empresa Antiga');
  const pes = (await pessoaPorTel('5511955554444')).id;
  await db.query(`insert into public.vinculos (pessoa_id, empresa_id, cargo) values ($1, $2, 'Gerente')`, [pes, emp]);
  await db.query(M4);
  await db.query(M5);
  assert.equal((await db.query(`select to_regprocedure('public.versao_banco()') f`)).rows[0].f, null, 'sem a 20261010 a função não existe');
  await db.query(M6);
  await db.query(M6);
  await db.query(M6);

  const r = await linha('antigo-mv');
  assert.deepEqual(r.historico_processos, []);
  assert.equal(r.nome, 'Clara Antiga Reis');
  assert.deepEqual((await db.query(`select organograma from public.empresas where id = $1`, [emp])).rows[0].organograma, {});
  assert.equal((await db.query(`select count(*)::int n from public.vinculos where empresa_id = $1 and status = 'ativo'`, [emp])).rows[0].n, 1);
  // Só existe a versão de 3 parâmetros de salvar_relacoes (chamar com 2 continua valendo).
  const sr = await db.query(`select pg_get_function_identity_arguments(p.oid) a from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'salvar_relacoes'`);
  assert.deepEqual(sr.rows.map((x) => x.a), ['p_empresa text, p_relacoes jsonb, p_opcoes jsonb']);
  const dois = await rpcAdmin('salvar_relacoes', emp, []);
  assert.deepEqual(dois, { ok: true, relacoes: [], topoIds: [] });
  // O envio do candidato continua funcionando.
  P_SEL = await processo('SEL1', { vaga: 'Recepcionista' });
  P_OUT = await processo('OUT1');
  const e = await enviar({ avaliacao: 'SEL1', telefone: '11966661111' });
  assert.equal(e.ok, true, e.erro);
  assert.deepEqual((await linha(e.id)).historico_processos, []);
});

test('versao_banco: pública (anon também), só leitura; detecta migração faltando pelas tabelas/colunas', async () => {
  exigirBanco();
  const v = await rpc('anon', null, 'versao_banco', []);
  assert.deepEqual(v, { ok: true, versao: 20261010120000, migracoes: NOMES, faltando: [] });
  assert.deepEqual(await rpcAdmin('versao_banco'), v);
  assert.equal((await db.query(`select provolatile from pg_proc where oid = 'public.versao_banco()'::regprocedure`)).rows[0].provolatile, 's');
  // Banco "sem" a 20261009 e a 20261008 (simulado numa transação desfeita no fim).
  await db.query('begin');
  try {
    await db.query(`alter table public.respostas drop column foto cascade`);
    await db.query(`alter table public.respostas drop column exigido cascade`);
    const x = (await db.query(`select public.versao_banco() as r`)).rows[0].r;
    assert.deepEqual(x.faltando, ['20261008120000_parte2', '20261009120000_fotos']);
    assert.deepEqual(x.migracoes, [NOMES[0], NOMES[1], NOMES[2], NOMES[5]]);
  } finally {
    await db.query('rollback');
  }
  assert.deepEqual((await rpc('anon', null, 'versao_banco', [])).faltando, []);
});

test('mover_resposta: só admin; troca processo e código; histórico; "" = sem processo', async () => {
  exigirBanco();
  const e = await enviar({ avaliacao: 'SEL1', telefone: '11966662222' });
  assert.equal(e.ok, true, e.erro);
  await rejeita(rpc('anon', null, 'mover_resposta', [e.id, P_OUT]), /permission denied/);
  assert.deepEqual(await rpc('authenticated', intruso, 'mover_resposta', [e.id, P_OUT]), { ok: false, erro: 'Sem permissão.' });
  assert.equal((await linha(e.id)).avaliacao, 'SEL1');

  const r = await rpcAdmin('mover_resposta', e.id, P_OUT);
  assert.equal(r.ok, true, r.erro);
  assert.deepEqual([r.id, r.processoId, r.avaliacao, r.mudou], [e.id, P_OUT, 'OUT1', true]);
  assert.equal(r.historicoProcessos.length, 1);
  const h = r.historicoProcessos[0];
  assert.deepEqual([h.de, h.para, h.deCodigo, h.paraCodigo], [P_SEL, P_OUT, 'SEL1', 'OUT1']);
  assert.match(h.em, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  let l = await linha(e.id);
  assert.deepEqual([l.processo_id, l.avaliacao, l.historico_processos.length], [P_OUT, 'OUT1', 1]);

  // Mesmo processo: nada muda.
  const igual = await rpcAdmin('mover_resposta', e.id, P_OUT);
  assert.deepEqual([igual.ok, igual.mudou, igual.historicoProcessos.length], [true, false, 1]);
  // Sem processo.
  const sem = await rpcAdmin('mover_resposta', e.id, '');
  assert.deepEqual([sem.processoId, sem.avaliacao, sem.historicoProcessos.length], ['', '', 2]);
  l = await linha(e.id);
  assert.deepEqual([l.processo_id, l.avaliacao], [null, '']);
  assert.deepEqual([l.historico_processos[1].de, l.historico_processos[1].para, l.historico_processos[1].deCodigo], [P_OUT, '', 'OUT1']);
  // E de volta (de "sem processo").
  const volta = await rpcAdmin('mover_resposta', e.id, P_SEL);
  assert.deepEqual([volta.avaliacao, volta.historicoProcessos[2].de, volta.historicoProcessos[2].para], ['SEL1', '', P_SEL]);

  assert.deepEqual(await rpcAdmin('mover_resposta', e.id, 'nao-e-uuid'), { ok: false, erro: 'Processo não encontrado.' });
  assert.deepEqual(await rpcAdmin('mover_resposta', e.id, '99999999-9999-4999-8999-999999999999'), { ok: false, erro: 'Processo não encontrado.' });
  assert.deepEqual(await rpcAdmin('mover_resposta', 'nao-existe-1', P_SEL), { ok: false, erro: 'Candidato não encontrado.' });
  assert.deepEqual(await rpcAdmin('mover_resposta', '', P_SEL), { ok: false, erro: 'Candidato não informado.' });

  // O painel lê o histórico, mas não grava direto (nem o processo).
  assert.equal((await admin(`select historico_processos from public.respostas where id = $1`, [e.id])).rows[0].historico_processos.length, 3);
  await rejeita(admin(`update public.respostas set historico_processos = '[]' where id = $1`, [e.id]), /permission denied/);
  await rejeita(admin(`update public.respostas set processo_id = null where id = $1`, [e.id]), /permission denied/);
  await rejeita(anon(`select historico_processos from public.respostas`), /permission denied/);
  await rejeita(db.query(`update public.respostas set historico_processos = '{}' where id = $1`, [e.id]), /respostas_historico_processos_lista/);
});

test('contratar_pessoa: candidato vira colaborador ativo (resposta aprovada); ativo em outra empresa = move', async () => {
  exigirBanco();
  const A = await novaEmpresa('Empresa A');
  const B = await novaEmpresa('Empresa B');
  const e = await enviar({ avaliacao: 'SEL1', telefone: '11966663333', nome: 'Rita Candidata Souza' });
  assert.equal(e.ok, true, e.erro);
  await rejeita(rpc('anon', null, 'contratar_pessoa', [JSON.stringify({ respostaId: e.id, empresaId: A })]), /permission denied/);
  assert.deepEqual(await rpc('authenticated', intruso, 'contratar_pessoa', [JSON.stringify({ respostaId: e.id, empresaId: A })]),
    { ok: false, erro: 'Sem permissão.' });

  // Pessoa nova na empresa (cargo vazio = vaga da resposta).
  const r = await rpcAdmin('contratar_pessoa', { respostaId: e.id, empresaId: A, area: 'Atendimento' });
  assert.equal(r.ok, true, r.erro);
  assert.deepEqual([r.colaborador.empresaId, r.colaborador.cargo, r.colaborador.area, r.colaborador.status, r.movido, r.deEmpresaId],
    [A, 'Vendedor', 'Atendimento', 'ativo', false, '']); // vaga do envio
  assert.equal((await linha(e.id)).status, 'aprovado');
  const pes = (await pessoaPorTel('5511966663333')).id;
  assert.equal(r.colaborador.pessoaId, pes);

  // De novo na mesma empresa: atualiza cargo/área, sem vínculo novo.
  const r2 = await rpcAdmin('contratar_pessoa', { pessoaId: pes, empresaId: A, cargo: 'Recepcionista líder', area: 'Atendimento' });
  assert.deepEqual([r2.colaborador.vinculoId, r2.colaborador.cargo, r2.movido], [r.colaborador.vinculoId, 'Recepcionista líder', false]);

  // Já ativa em A, com relação no organograma de A: contratar em B move (A fica desligada com fim = hoje).
  const lider = await colaborador(A, 'Lia Líder Prado', '11966664444', 'Gerente');
  await rpcAdmin('salvar_relacoes', A, [{ de: lider.pessoaId, para: pes, tipo: 'lidera' }], { topoIds: [pes] });
  const r3 = await rpcAdmin('contratar_pessoa', { respostaId: e.id, empresaId: B, cargo: 'Caixa' });
  assert.deepEqual([r3.ok, r3.movido, r3.deEmpresaId, r3.colaborador.empresaId, r3.colaborador.cargo], [true, true, A, B, 'Caixa']);
  const vs = (await db.query(`select empresa_id, status, fim from public.vinculos where pessoa_id = $1 order by criado_em`, [pes])).rows;
  assert.deepEqual(vs.map((v) => [v.empresa_id, v.status]), [[A, 'desligado'], [B, 'ativo']]);
  assert.equal(vs[0].fim.toISOString().slice(0, 10), (await db.query(`select current_date::text d`)).rows[0].d);
  assert.equal((await db.query(`select count(*)::int n from public.relacoes where empresa_id = $1`, [A])).rows[0].n, 0, 'as relações dela em A somem');
  assert.deepEqual((await rpcAdmin('salvar_relacoes', A, [])).topoIds, [], 'quem saiu não fica no topo');

  // Erros.
  assert.deepEqual(await rpcAdmin('contratar_pessoa', { respostaId: e.id, empresaId: 'x' }), { ok: false, erro: 'Empresa não encontrada.' });
  assert.deepEqual(await rpcAdmin('contratar_pessoa', { respostaId: 'nao-existe-1', empresaId: A }), { ok: false, erro: 'Candidato não encontrado.' });
  assert.deepEqual(await rpcAdmin('contratar_pessoa', { pessoaId: '99999999-9999-4999-8999-999999999999', empresaId: A }), { ok: false, erro: 'Pessoa não encontrada.' });
  assert.deepEqual(await rpcAdmin('contratar_pessoa', { empresaId: A }), { ok: false, erro: 'Informe a pessoa.' });
  await db.query(`insert into public.respostas (id, avaliacao, nome, telefone, respostas) values ('sem-tel-01', '', 'Sem Telefone Algum', '', repeat('1234', 25))`);
  const st = await rpcAdmin('contratar_pessoa', { respostaId: 'sem-tel-01', empresaId: A });
  assert.equal(st.ok, false);
  assert.match(st.erro, /não tem um WhatsApp válido/);
  assert.equal((await linha('sem-tel-01')).status, 'em_analise', 'erro não aprova');
});

test('topoIds: salvar_relacoes guarda em empresas.organograma (só ativos, sem repetir); sem o 3º parâmetro não muda', async () => {
  exigirBanco();
  const E = await novaEmpresa('Empresa Topo');
  const a = await colaborador(E, 'Ana Topo Lima', '11966665555');
  const b = await colaborador(E, 'Beto Topo Reis', '11966666666');
  const c = await colaborador(E, 'Caio Topo Dias', '11966667777');
  await db.query(`update public.vinculos set status = 'desligado' where id = $1`, [c.vinculoId]);

  const r = await rpcAdmin('salvar_relacoes', E, [{ de: a.pessoaId, para: b.pessoaId, tipo: 'lidera' }],
    { topoIds: [b.pessoaId, c.pessoaId, 'lixo', b.pessoaId, a.pessoaId, 7] });
  assert.equal(r.ok, true, r.erro);
  assert.deepEqual(r.topoIds, [b.pessoaId, a.pessoaId]);
  assert.deepEqual((await db.query(`select organograma from public.empresas where id = $1`, [E])).rows[0].organograma,
    { topoIds: [b.pessoaId, a.pessoaId] });
  // Sem opções: o topo salvo continua.
  const r2 = await rpcAdmin('salvar_relacoes', E, []);
  assert.deepEqual([r2.relacoes, r2.topoIds], [[], [b.pessoaId, a.pessoaId]]);
  // Outra chave no organograma é preservada.
  await db.query(`update public.empresas set organograma = organograma || '{"outra": 1}' where id = $1`, [E]);
  await rpcAdmin('salvar_relacoes', E, [], { topoIds: [] });
  assert.deepEqual((await db.query(`select organograma from public.empresas where id = $1`, [E])).rows[0].organograma, { outra: 1, topoIds: [] });

  assert.deepEqual(await rpcAdmin('salvar_relacoes', E, [], { topoIds: 'x' }), { ok: false, erro: 'Relações inválidas.' });
  assert.deepEqual(await rpcAdmin('salvar_relacoes', E, [], []), { ok: false, erro: 'Relações inválidas.' });
  assert.deepEqual(await rpc('authenticated', intruso, 'salvar_relacoes', [E, '[]', '{"topoIds":[]}']), { ok: false, erro: 'Sem permissão.' });
  await rejeita(rpc('anon', null, 'salvar_relacoes', [E, '[]', '{"topoIds":[]}']), /permission denied/);
  await rejeita(db.query(`update public.empresas set organograma = '[]' where id = $1`, [E]), /empresas_organograma_objeto/);
  await rejeita(anon(`select disc_interno.topo_ativos($1, '[]')`, [E]), /permission denied/);
});
