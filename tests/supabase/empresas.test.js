'use strict';
// Testes da migração 20261007120000_empresas_equipes.sql (empresas, vínculos, organograma e modelos de
// relatório) num Postgres 17 EMBUTIDO, com as 3 migrações aplicadas EM SEQUÊNCIA sobre dados "de produção"
// gravados pelas versões anteriores. Mesmo preparo "tipo Supabase" de tests/supabase/banco.test.js.
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
const NOVAS = ['empresas', 'relacoes', 'vinculos'];

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
    const dir = path.join(os.tmpdir(), 'disc-pg-emp-' + crypto.randomBytes(6).toString('hex'));
    pg = new EmbeddedPostgres({
      databaseDir: dir, user: 'postgres', password: 'postgres', port: 59100 + Math.floor(Math.random() * 800),
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
function payload(extra) { seq += 1; return payloadValido(Object.assign({ id: 'emp-' + Date.now().toString(36) + '-' + seq }, extra || {})); }
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

// ---------------------------------------------------------------------------
// Migrações em sequência sobre dados antigos
// ---------------------------------------------------------------------------

test('as 3 migrações em sequência sobre dados antigos: idempotente e sem perder nada', async () => {
  exigirBanco();
  await db.query(M1);
  // Dados gravados pela 1ª versão: processo, resposta e relatório (processo_id obrigatório).
  await db.query(`insert into public.processos (codigo, nome, tipo, empresa) values ('ANT1', 'Antigo', 'equipe', 'Loja Antiga')`);
  const pid = (await db.query(`select id from public.processos where codigo = 'ANT1'`)).rows[0].id;
  await db.query(`insert into public.respostas (id, processo_id, avaliacao, nome, telefone, idade, funcao, respostas)
    values ('antigo-01', $1, 'ANT1', 'Clara Antiga Reis', '11955554444', 30, 'Caixa', repeat('1234', 25))`, [pid]);
  await db.query(`insert into public.relatorios (processo_id, dados, status) values ($1, '{"processo":{"nome":"Antigo"}}', 'publicado')`, [pid]);
  await db.query(M2);
  await db.query(`insert into public.relatorios (processo_id, dados) values ($1, '{"x":2}')`, [pid]);
  await db.query(M3);
  await db.query(M3);
  await db.query(M3);

  const t = await db.query(`select tablename, rowsecurity from pg_tables where schemaname = 'public' order by 1`);
  assert.deepEqual(t.rows.map((r) => r.tablename),
    ['admins', 'configuracoes', 'empresas', 'pessoas', 'processos', 'relacoes', 'relatorios', 'respostas', 'vinculos']);
  assert.ok(t.rows.every((r) => r.rowsecurity), 'RLS ligado em todas as tabelas');

  const rels = (await db.query(`select id, modelo, processo_id, empresa_id, pessoa_id, token from public.relatorios order by criado_em`)).rows;
  assert.equal(rels.length, 2);
  rels.forEach((r) => {
    assert.equal(r.modelo, 'processo');
    assert.equal(r.processo_id, pid);
    assert.match(r.id, /^[0-9a-f-]{36}$/);
    assert.equal(r.empresa_id, null);
    assert.equal(r.pessoa_id, null);
  });
  assert.notEqual(rels[0].id, rels[1].id, 'cada relatório antigo ganha um id próprio');
  // O relatório publicado antigo continua no ar, agora com o modelo.
  const pub = await rpc('anon', null, 'relatorio_publico', [rels[0].token]);
  assert.deepEqual([pub.ok, pub.modelo, pub.relatorio], [true, 'processo', { processo: { nome: 'Antigo' } }]);
  // Processo antigo: empresa em texto continua; empresa_id nulo. Pessoa antiga continua ligada.
  const proc = (await db.query(`select empresa, empresa_id from public.processos where codigo = 'ANT1'`)).rows[0];
  assert.deepEqual(proc, { empresa: 'Loja Antiga', empresa_id: null });
  assert.equal((await pessoaPorTel('5511955554444')).nome, 'Clara Antiga Reis');
  // Envio pelo link antigo (equipe sem empresa) continua funcionando e não cria vínculo.
  const e = await enviar({ avaliacao: 'ANT1', telefone: '11955554444', nome: 'Clara Antiga Reis' });
  assert.equal(e.ok, true, e.erro);
  assert.equal((await db.query(`select count(*)::int n from public.vinculos`)).rows[0].n, 0);

  await db.query(`delete from public.relatorios`);
  await db.query(`delete from public.respostas`);
  await db.query(`delete from public.processos where codigo = 'ANT1'`);
  assert.equal((await db.query(`select count(*)::int n from public.pessoas`)).rows[0].n, 0);

  // Admin para os próximos testes.
  await db.query(`insert into auth.users (id, email) values ($1, 'admin@x.com'), ($2, 'outro@x.com')`, [ADMIN, OUTRO]);
  await db.query(`insert into public.admins (user_id, nome) values ($1, 'Admin')`, [ADMIN]);
});

// ---------------------------------------------------------------------------
// RLS e permissões
// ---------------------------------------------------------------------------

test('RLS: anon não lê nem grava empresas/vínculos/relações; não-admin não vê nada; admin administra', async () => {
  exigirBanco();
  const emp = await novaEmpresa('Empresa RLS');
  const c1 = await colaborador(emp, 'Ana Rls Souza', '11911110001');
  const c2 = await colaborador(emp, 'Beto Rls Lima', '11911110002');
  assert.equal((await rpcAdmin('salvar_relacoes', emp, [{ de: c1.pessoaId, para: c2.pessoaId, tipo: 'lidera' }])).ok, true);

  for (const t of NOVAS) {
    await rejeita(anon(`select * from public.${t}`), /permission denied/);
    await rejeita(anon(`delete from public.${t}`), /permission denied/);
    assert.equal((await outro(`select * from public.${t}`)).rowCount, 0, `não-admin não vê ${t}`);
    assert.equal((await outro(`delete from public.${t}`)).rowCount, 0, `não-admin não apaga ${t}`);
    assert.ok((await admin(`select * from public.${t}`)).rowCount > 0, `admin vê ${t}`);
    for (const pr of ['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) {
      assert.equal((await db.query(`select has_table_privilege('anon', 'public.${t}', $1) v`, [pr])).rows[0].v, false, `anon tem ${pr} em ${t}`);
    }
  }
  await rejeita(anon(`insert into public.empresas (nome) values ('x')`), /permission denied/);
  await rejeita(outro(`insert into public.empresas (nome) values ('x')`), /row-level security/);
  // Funções do painel: anon não executa; não-admin recebe "Sem permissão."
  for (const [fn, args] of [['salvar_colaborador', ['{}']], ['mover_colaborador', ['{}']], ['salvar_relacoes', [emp, '[]']]]) {
    await rejeita(rpc('anon', null, fn, args), /permission denied/);
    assert.deepEqual(await rpc('authenticated', OUTRO, fn, args), { ok: false, erro: 'Sem permissão.' });
  }
  const f = await db.query(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute') order by 1`);
  assert.deepEqual(f.rows.map((x) => x.proname), ['avaliacao_publica', 'enviar_resposta', 'relatorio_publico']);
  const semPath = await db.query(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'disc_interno') and p.prosecdef
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`);
  assert.deepEqual(semPath.rows, []);
  // empresa inválida
  await rejeita(admin(`insert into public.empresas (nome) values ('   ')`), /Informe o nome da empresa/);
  await rejeita(admin(`insert into public.empresas (nome) values ($1)`, ['x'.repeat(121)]), /check constraint/);

  await admin(`update public.vinculos set status = 'desligado' where empresa_id = $1`, [emp]);
  await admin(`delete from public.empresas where id = $1`, [emp]);
  await db.query(`delete from public.pessoas`);
});

// ---------------------------------------------------------------------------
// Vínculos: unicidade, colaborador sem teste, mover, desligar
// ---------------------------------------------------------------------------

test('vínculo: no máximo 1 ativo por pessoa; desligado ganha fim; colaborador sem teste pelo WhatsApp', async () => {
  exigirBanco();
  const a = await novaEmpresa('Clínica A');
  const b = await novaEmpresa('Clínica B');
  const c = await colaborador(a, '  Diego   Teste Souza ', '(11) 97777-1234', ' Supervisor ', 'Comercial');
  assert.deepEqual(Object.keys(c).sort(), ['area', 'cargo', 'empresaId', 'fim', 'inicio', 'nome', 'pessoaId', 'status', 'telefone', 'vinculoId']);
  assert.deepEqual([c.nome, c.telefone, c.cargo, c.area, c.status, c.fim], ['Diego Teste Souza', '5511977771234', 'Supervisor', 'Comercial', 'ativo', '']);
  assert.match(c.inicio, /^\d{4}-\d{2}-\d{2}$/);
  // mesmo WhatsApp em outro formato: mesma pessoa; mesmo vínculo (atualiza cargo/área)
  const c2 = await colaborador(a, 'Outro Nome Qualquer', '5511977771234', 'Gerente', 'Vendas');
  assert.equal(c2.pessoaId, c.pessoaId);
  assert.equal(c2.vinculoId, c.vinculoId);
  assert.deepEqual([c2.nome, c2.cargo, c2.area], ['Diego Teste Souza', 'Gerente', 'Vendas'], 'nome da ficha não é sobrescrito');
  // por pessoaId
  const c3 = await rpcAdmin('salvar_colaborador', { empresaId: a, pessoaId: c.pessoaId, cargo: 'Gerente geral', area: '' });
  assert.equal(c3.colaborador.cargo, 'Gerente geral');
  // ativo em outra empresa: recusa e sugere mover
  const r = await rpcAdmin('salvar_colaborador', { empresaId: b, pessoaId: c.pessoaId, cargo: 'X' });
  assert.equal(r.ok, false);
  assert.match(r.erro, /já é colaboradora ativa de outra empresa \(Clínica A\)\. Use "Mover"/);
  // validações
  assert.deepEqual(await rpcAdmin('salvar_colaborador', { empresaId: a, nome: 'Só', telefone: '11977770000' }),
    { ok: false, erro: 'Informe o nome completo (nome e sobrenome).' });
  assert.deepEqual(await rpcAdmin('salvar_colaborador', { empresaId: a, nome: 'Nome Completo', telefone: '123' }),
    { ok: false, erro: 'Telefone inválido. Informe DDD + número.' });
  assert.deepEqual(await rpcAdmin('salvar_colaborador', { empresaId: 'nada', nome: 'Nome Completo', telefone: '11977770000' }),
    { ok: false, erro: 'Empresa não encontrada.' });
  assert.deepEqual(await rpcAdmin('salvar_colaborador', { empresaId: a, pessoaId: '00000000-0000-4000-8000-000000000000' }),
    { ok: false, erro: 'Pessoa não encontrada.' });

  // índice único parcial: 2º vínculo ativo direto na tabela é recusado
  await rejeita(admin(`insert into public.vinculos (pessoa_id, empresa_id) values ($1, $2)`, [c.pessoaId, b]), /duplicate key|vinculos_um_ativo_por_pessoa/);
  // desligado: vários no histórico e com fim
  await admin(`insert into public.vinculos (pessoa_id, empresa_id, status, inicio) values ($1, $2, 'desligado', '2020-01-01'), ($1, $2, 'desligado', '2021-01-01')`, [c.pessoaId, b]);
  const hist = (await db.query(`select fim from public.vinculos where pessoa_id = $1 and status = 'desligado'`, [c.pessoaId])).rows;
  assert.equal(hist.length, 2);
  assert.ok(hist.every((h) => h.fim !== null));
  await rejeita(db.query(`insert into public.vinculos (pessoa_id, empresa_id, status) values ($1, $2, 'talvez')`, [c.pessoaId, b]), /check constraint/);

  await admin(`update public.vinculos set status = 'desligado' where pessoa_id = $1`, [c.pessoaId]);
  await admin(`delete from public.empresas where id in ($1, $2)`, [a, b]);
  assert.equal((await db.query(`select count(*)::int n from public.vinculos`)).rows[0].n, 0, 'vínculos saem com a empresa');
  await db.query(`delete from public.pessoas`);
});

test('mover e desligar: relações da pessoa na empresa antiga somem; histórico fica', async () => {
  exigirBanco();
  const a = await novaEmpresa('Empresa Origem');
  const b = await novaEmpresa('Empresa Destino');
  const lider = await colaborador(a, 'Lia Lider Souza', '11922220001', 'Diretora');
  const p1 = await colaborador(a, 'Pedro Liderado Um', '11922220002', 'Vendedor');
  const p2 = await colaborador(a, 'Paula Liderada Dois', '11922220003', 'Vendedora');
  const r = await rpcAdmin('salvar_relacoes', a, [
    { de: lider.pessoaId, para: p1.pessoaId, tipo: 'lidera' },
    { de: lider.pessoaId, para: p2.pessoaId, tipo: 'lidera' },
    { de: p1.pessoaId, para: p2.pessoaId, tipo: 'direto' }
  ]);
  assert.equal(r.ok, true, r.erro);
  assert.equal(r.relacoes.length, 3);

  // mover Pedro para B
  const m = await rpcAdmin('mover_colaborador', { pessoaId: p1.pessoaId, empresaId: b, cargo: 'Gerente', area: 'Loja' });
  assert.equal(m.ok, true, m.erro);
  assert.deepEqual([m.colaborador.empresaId, m.colaborador.status, m.colaborador.cargo], [b, 'ativo', 'Gerente']);
  const vinc = (await db.query(`select empresa_id, status, fim from public.vinculos where pessoa_id = $1 order by criado_em, status`, [p1.pessoaId])).rows;
  assert.equal(vinc.length, 2);
  const antigo = vinc.find((v) => v.empresa_id === a);
  assert.equal(antigo.status, 'desligado');
  assert.ok(antigo.fim, 'fim = hoje');
  const rels = (await db.query(`select de_pessoa, para_pessoa from public.relacoes where empresa_id = $1`, [a])).rows;
  assert.deepEqual(rels, [{ de_pessoa: lider.pessoaId, para_pessoa: p2.pessoaId }], 'só sobra a relação sem o Pedro');
  // mover para a empresa onde já está: só atualiza cargo/área
  const m2 = await rpcAdmin('mover_colaborador', { pessoaId: p1.pessoaId, empresaId: b, cargo: 'Gerente regional' });
  assert.equal(m2.colaborador.vinculoId, m.colaborador.vinculoId);
  assert.equal((await db.query(`select count(*)::int n from public.vinculos where pessoa_id = $1`, [p1.pessoaId])).rows[0].n, 2);
  assert.deepEqual(await rpcAdmin('mover_colaborador', { pessoaId: p1.pessoaId, empresaId: 'x' }), { ok: false, erro: 'Empresa não encontrada.' });

  // desligar Paula: relação com a líder some
  await admin(`update public.vinculos set status = 'desligado' where id = $1 and status = 'ativo'`, [p2.vinculoId]);
  assert.equal((await db.query(`select count(*)::int n from public.relacoes where empresa_id = $1`, [a])).rows[0].n, 0);
  assert.ok((await db.query(`select fim from public.vinculos where id = $1`, [p2.vinculoId])).rows[0].fim);

  // empresa com colaborador ativo não é excluída
  await rejeita(admin(`delete from public.empresas where id = $1`, [a]), /Desligue ou mova os colaboradores antes\./);
  await admin(`update public.vinculos set status = 'desligado' where empresa_id in ($1, $2)`, [a, b]);
  await admin(`delete from public.empresas where id in ($1, $2)`, [a, b]);
  await db.query(`delete from public.pessoas`);
});

test('salvar_relacoes: substitui o conjunto; só colaboradores ativos; nada muda se algo estiver errado', async () => {
  exigirBanco();
  const a = await novaEmpresa('Empresa Org');
  const b = await novaEmpresa('Empresa Fora');
  const x = await colaborador(a, 'Xavier Org Souza', '11933330001');
  const y = await colaborador(a, 'Yara Org Lima', '11933330002');
  const z = await colaborador(b, 'Zeca Fora Reis', '11933330003');
  assert.equal((await rpcAdmin('salvar_relacoes', a, [{ de: x.pessoaId, para: y.pessoaId, tipo: 'lidera' }])).ok, true);
  const erros = [
    [[{ de: x.pessoaId, para: z.pessoaId, tipo: 'lidera' }], 'As duas pessoas da relação precisam ser colaboradoras ativas desta empresa.'],
    [[{ de: x.pessoaId, para: x.pessoaId, tipo: 'direto' }], 'Uma pessoa não pode ter relação com ela mesma.'],
    [[{ de: x.pessoaId, para: y.pessoaId, tipo: 'chefe' }], 'Tipo de relação inválido. Use: lidera, direto ou indireto.'],
    [[{ de: 'nada', para: y.pessoaId, tipo: 'direto' }], 'Relações inválidas.'],
    [{ a: 1 }, 'Relações inválidas.']
  ];
  for (const [lista, msg] of erros) {
    assert.deepEqual(await rpcAdmin('salvar_relacoes', a, lista), { ok: false, erro: msg });
  }
  assert.equal((await db.query(`select count(*)::int n from public.relacoes where empresa_id = $1`, [a])).rows[0].n, 1, 'conjunto anterior intacto');
  // troca o conjunto (repetida: vale a última)
  const r = await rpcAdmin('salvar_relacoes', a, [
    { de: y.pessoaId, para: x.pessoaId, tipo: 'direto' }, { de: y.pessoaId, para: x.pessoaId, tipo: 'indireto' }]);
  assert.deepEqual(r, { ok: true, relacoes: [{ de: y.pessoaId, para: x.pessoaId, tipo: 'indireto' }] });
  assert.deepEqual(await rpcAdmin('salvar_relacoes', a, []), { ok: true, relacoes: [] });
  // gatilho também protege a gravação direta na tabela
  await rejeita(admin(`insert into public.relacoes (empresa_id, de_pessoa, para_pessoa, tipo) values ($1, $2, $3, 'lidera')`, [a, x.pessoaId, z.pessoaId]),
    /colaboradoras ativas desta empresa/);
  await rejeita(admin(`insert into public.relacoes (empresa_id, de_pessoa, para_pessoa, tipo) values ($1, $2, $2, 'lidera')`, [a, x.pessoaId]),
    /check constraint/);
  await admin(`update public.vinculos set status = 'desligado'`);
  await admin(`delete from public.empresas`);
  await db.query(`delete from public.pessoas`);
});

// ---------------------------------------------------------------------------
// Envio pelo link de equipe
// ---------------------------------------------------------------------------

test('enviar_resposta: link de equipe ligado à empresa cria o vínculo ativo (cargo = função), sem mexer em quem já é de outra', async () => {
  exigirBanco();
  const emp = await novaEmpresa('Clínica Equipe');
  const outra = await novaEmpresa('Outra Clínica');
  await admin(`insert into public.processos (codigo, nome, tipo, empresa_id) values ('EQX1', 'Equipe X', 'equipe', $1),
    ('SLX1', 'Seleção X', 'selecao', $1), ('EQX2', 'Equipe sem empresa', 'equipe', null)`, [emp]);
  // texto da empresa preenchido pelo cadastro
  assert.equal((await db.query(`select empresa from public.processos where codigo = 'EQX1'`)).rows[0].empresa, 'Clínica Equipe');
  const pub = await rpc('anon', null, 'avaliacao_publica', ['EQX1']);
  assert.equal(pub.empresaNome, 'Clínica Equipe');

  const e1 = await enviar({ avaliacao: 'EQX1', telefone: '11944440001', nome: 'Rita Equipe Souza', funcao: 'Recepcionista' });
  assert.equal(e1.ok, true, e1.erro);
  const rita = await pessoaPorTel('5511944440001');
  let v = (await db.query(`select empresa_id, cargo, status from public.vinculos where pessoa_id = $1`, [rita.id])).rows;
  assert.deepEqual(v, [{ empresa_id: emp, cargo: 'Recepcionista', status: 'ativo' }]);
  // responder de novo (outro envio) não duplica nem muda o cargo
  assert.equal((await enviar({ avaliacao: 'EQX1', telefone: '11944440001', nome: 'Rita Equipe Souza', funcao: 'Gerente' })).ok, true);
  v = (await db.query(`select cargo from public.vinculos where pessoa_id = $1`, [rita.id])).rows;
  assert.deepEqual(v, [{ cargo: 'Recepcionista' }]);

  // ativa em OUTRA empresa: não mexe
  const caio = await colaborador(outra, 'Caio Outra Lima', '11944440002', 'Motorista');
  assert.equal((await enviar({ avaliacao: 'EQX1', telefone: '11944440002', nome: 'Caio Outra Lima' })).ok, true);
  v = (await db.query(`select empresa_id, status from public.vinculos where pessoa_id = $1`, [caio.pessoaId])).rows;
  assert.deepEqual(v, [{ empresa_id: outra, status: 'ativo' }]);

  // seleção, equipe sem empresa e link geral: nenhum vínculo
  for (const [cod, tel] of [['SLX1', '11944440003'], ['EQX2', '11944440004'], ['', '11944440005']]) {
    const e = await enviar({ avaliacao: cod, telefone: tel, nome: 'Sem Vinculo Teste' });
    assert.equal(e.ok, true, e.erro);
    const p = await pessoaPorTel('55' + tel);
    assert.equal((await db.query(`select count(*)::int n from public.vinculos where pessoa_id = $1`, [p.id])).rows[0].n, 0, cod);
  }
  // desligada volta a responder pelo link de equipe: ganha vínculo ativo novo (histórico fica)
  await admin(`update public.vinculos set status = 'desligado' where pessoa_id = $1`, [rita.id]);
  assert.equal((await enviar({ avaliacao: 'EQX1', telefone: '11944440001', nome: 'Rita Equipe Souza', funcao: 'Supervisora' })).ok, true);
  v = (await db.query(`select cargo, status from public.vinculos where pessoa_id = $1 order by status`, [rita.id])).rows;
  assert.deepEqual(v, [{ cargo: 'Supervisora', status: 'ativo' }, { cargo: 'Recepcionista', status: 'desligado' }]);

  // excluir as respostas: colaboradora ATIVA continua (sem resultado); quem não é colaborador sai (LGPD)
  await db.query(`delete from public.respostas`);
  assert.ok(await pessoaPorTel('5511944440001'), 'Rita (ativa) continua');
  assert.equal(await pessoaPorTel('5511944440003'), undefined);
  // empresa ligada a processo: excluir a empresa deixa o processo sem empresa_id (texto fica)
  await admin(`update public.vinculos set status = 'desligado'`);
  await admin(`delete from public.empresas where id = $1`, [emp]);
  assert.deepEqual((await db.query(`select empresa, empresa_id from public.processos where codigo = 'EQX1'`)).rows[0],
    { empresa: 'Clínica Equipe', empresa_id: null });
  await db.query(`delete from public.processos`);
  await admin(`delete from public.empresas`);
  await db.query(`delete from public.pessoas`);
});

// ---------------------------------------------------------------------------
// Relatórios por modelo
// ---------------------------------------------------------------------------

test('relatórios: modelo com dono obrigatório, limite de tamanho e relatorio_publico com o modelo', async () => {
  exigirBanco();
  const emp = await novaEmpresa('Empresa Relatório');
  const c = await colaborador(emp, 'Rui Relatorio Melo', '11955550001');
  await admin(`insert into public.processos (codigo, nome) values ('RLM1', 'Proc')`);
  const pid = (await db.query(`select id from public.processos where codigo = 'RLM1'`)).rows[0].id;

  await rejeita(admin(`insert into public.relatorios (modelo, dados) values ('equipe', '{}')`), /relatorios_modelo_dono/);
  await rejeita(admin(`insert into public.relatorios (modelo, empresa_id, dados) values ('lideranca', $1, '{}')`, [emp]), /relatorios_modelo_dono/);
  await rejeita(admin(`insert into public.relatorios (modelo, pessoa_id, dados) values ('pessoa', null, '{}')`), /relatorios_modelo_dono/);
  await rejeita(admin(`insert into public.relatorios (dados) values ('{}')`), /relatorios_modelo_dono/);
  await rejeita(admin(`insert into public.relatorios (modelo, empresa_id, dados) values ('outro', $1, '{}')`, [emp]), /check constraint/);
  await rejeita(admin(`insert into public.relatorios (modelo, empresa_id, dados) values ('equipe', $1, '[]')`, [emp]), /Dados do relatório inválidos/);
  const grande = JSON.stringify({ modelo: 'equipe', texto: 'x'.repeat(360000) });
  await rejeita(admin(`insert into public.relatorios (modelo, empresa_id, dados) values ('equipe', $1, $2)`, [emp, grande]), /grande demais/);

  const eq = (await admin(`insert into public.relatorios (modelo, empresa_id, dados) values ('equipe', $1, $2) returning id, token, status`,
    [emp, JSON.stringify({ modelo: 'equipe', versao: 1, titulo: 'Equipe' })])).rows[0];
  const li = (await admin(`insert into public.relatorios (modelo, empresa_id, pessoa_id, dados) values ('lideranca', $1, $2, '{"modelo":"lideranca"}') returning token`,
    [emp, c.pessoaId])).rows[0];
  const pe = (await admin(`insert into public.relatorios (modelo, pessoa_id, dados) values ('pessoa', $1, '{"modelo":"pessoa"}') returning token`, [c.pessoaId])).rows[0];
  const pr = (await admin(`insert into public.relatorios (processo_id, dados) values ($1, '{"processo":{"clickupListId":"9"}}') returning token`, [pid])).rows[0];
  assert.equal(eq.status, 'rascunho');
  const naoAchou = { ok: false, erro: 'Relatório não encontrado ou fora do ar.' };
  assert.deepEqual(await rpc('anon', null, 'relatorio_publico', [eq.token]), naoAchou, 'rascunho não aparece');
  await admin(`update public.relatorios set status = 'publicado'`);
  const r = await rpc('anon', null, 'relatorio_publico', [eq.token]);
  assert.deepEqual([r.ok, r.modelo, r.relatorio], [true, 'equipe', { modelo: 'equipe', versao: 1, titulo: 'Equipe' }]);
  assert.match(r.publicadoEm, /Z$/);
  assert.equal((await rpc('anon', null, 'relatorio_publico', [li.token])).modelo, 'lideranca');
  assert.equal((await rpc('anon', null, 'relatorio_publico', [pe.token])).modelo, 'pessoa');
  const rp = await rpc('anon', null, 'relatorio_publico', [pr.token]);
  assert.deepEqual([rp.modelo, rp.relatorio], ['processo', { processo: {} }]);
  // anon não lê a tabela; não-admin não vê
  await rejeita(anon(`select * from public.relatorios`), /permission denied/);
  assert.equal((await outro(`select * from public.relatorios`)).rowCount, 0);

  // pessoa excluída leva os relatórios dela; empresa excluída leva o de equipe
  await admin(`update public.vinculos set status = 'desligado'`);
  await db.query(`delete from public.pessoas where id = $1`, [c.pessoaId]);
  assert.equal((await db.query(`select count(*)::int n from public.relatorios where pessoa_id is not null`)).rows[0].n, 0);
  await admin(`delete from public.empresas where id = $1`, [emp]);
  assert.deepEqual((await db.query(`select modelo from public.relatorios`)).rows, [{ modelo: 'processo' }]);
  await db.query(`delete from public.relatorios`);
  await db.query(`delete from public.processos`);
});
