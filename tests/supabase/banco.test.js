'use strict';
// Testes do banco do Supabase (supabase/migrations/*.sql, aplicadas em sequência) num Postgres 17 EMBUTIDO
// (npm: embedded-postgres — binários baixados pelo registry do npm; nada acessa *.supabase.co).
//
// Para ficar parecido com o Supabase, antes da migração o teste cria:
//   * os papéis anon, authenticated (NOLOGIN) e service_role (BYPASSRLS);
//   * as permissões padrão do Supabase (GRANT ALL em tabelas/funções do schema public para anon e
//     authenticated) — a migração precisa FECHAR isso;
//   * um schema "auth" mínimo: auth.users e auth.uid() lendo request.jwt.claim.sub / request.jwt.claims.
// Cada chamada "como" um papel roda numa transação com SET LOCAL ROLE + o "sub" do JWT.
//
// Rodar: npm run test:supabase
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { carregarGas } = require('../helpers/gas.js');
const S = require('../../js/scoring.js');
const { payloadValido, respostasAleatorias, prng } = require('../helpers/fixtures.js');

const RAIZ = path.join(__dirname, '..', '..');
const MIGRACAO = fs.readFileSync(path.join(RAIZ, 'supabase', 'migrations', '20261005120000_disc.sql'), 'utf8');
const MIGRACAO_PESSOAS = fs.readFileSync(path.join(RAIZ, 'supabase', 'migrations', '20261006120000_pessoas_formulario.sql'), 'utf8');
// A 3ª migração (empresas/equipes) tem testes próprios em tests/supabase/empresas.test.js; aqui ela é
// aplicada logo depois da 2ª para os testes de segurança e do seed valerem sobre o banco completo.
const MIGRACAO_EQUIPES = fs.readFileSync(path.join(RAIZ, 'supabase', 'migrations', '20261007120000_empresas_equipes.sql'), 'utf8');
const TABELAS = ['admins', 'configuracoes', 'empresas', 'pessoas', 'processos', 'relacoes', 'relatorios', 'respostas', 'vinculos'];
// Campos que a migração nova acrescenta ao payload (o Code.gs, legado, não tem): com o formulário padrão
// eles vêm vazios e o resto do payload continua igual ao do Code.gs.
const NOVOS_NO_PAYLOAD = { email: '', cidade: '', extras: [] };
const CAMINHO_SEED = path.join(RAIZ, 'supabase', 'seed_previa.sql');

const PREPARO_SUPABASE = `
  create role anon nologin noinherit;
  create role authenticated nologin noinherit;
  create role service_role nologin noinherit bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

  create schema auth;
  create table auth.users (
    id uuid primary key,
    email text,
    raw_user_meta_data jsonb not null default '{}'::jsonb
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ), '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
`;

let pg = null;      // instância do Postgres embutido
let db = null;      // cliente (superusuário postgres)
let gas = null;     // Code.gs carregado (paridade das validações)
let falhaInicio = null;

const U = {
  dono: '11111111-1111-4111-8111-111111111111',
  outro: '22222222-2222-4222-8222-222222222222',
  terceiro: '33333333-3333-4333-8333-333333333333'
};

test.before(async () => {
  try {
    const EmbeddedPostgres = (await import('embedded-postgres')).default;
    // Diretório que ainda não existe (o initdb cria; como root o embedded-postgres roda como usuário "postgres").
    const dir = path.join(os.tmpdir(), 'disc-pg-' + crypto.randomBytes(6).toString('hex'));
    const porta = 55000 + Math.floor(Math.random() * 4000);
    pg = new EmbeddedPostgres({
      databaseDir: dir, user: 'postgres', password: 'postgres', port: porta,
      persistent: false, createPostgresUser: true,
      // UTF-8 como no Supabase; locale C = pior caso para [[:alpha:]] (letras acentuadas pelas faixas explícitas).
      initdbFlags: ['--encoding=UTF8', '--locale=C'],
      onLog: () => {}, onError: () => {}
    });
    await pg.initialise();
    await pg.start();
    db = pg.getPgClient();
    await db.connect();
    await db.query(PREPARO_SUPABASE);
    gas = carregarGas({});
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

/** Roda SQL como um papel do Supabase (anon/authenticated/service_role), com o "sub" do JWT. */
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
const logado = (uid, sql, params) => como('authenticated', uid, sql, params);

async function rpc(papel, uid, fn, args) {
  const marcas = (args || []).map((_, i) => '$' + (i + 1)).join(', ');
  const r = await como(papel, uid, `select public.${fn}(${marcas}) as r`, args || []);
  return r.rows[0].r;
}

async function criarUsuario(id, email, nome) {
  await db.query('insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3) on conflict do nothing',
    [id, email, JSON.stringify(nome ? { nome } : {})]);
}

async function rejeita(promessa, padrao) {
  await assert.rejects(promessa, (err) => {
    assert.match(String(err.message), padrao);
    return true;
  });
}

let seq = 0;
function novoId() { seq += 1; return 'teste-' + Date.now().toString(36) + '-' + seq; }

function payload(extra) {
  return payloadValido(Object.assign({ id: novoId() }, extra || {}));
}

function validacaoValida() {
  return {
    versao: 1,
    pares: [['D', 'C'], ['I', 'S'], ['D', 'S']],
    escolhas: ['D', 'I', 'D'],
    itens: [
      { id: 'D-f1', letra: 'D', tipo: 'forca', nota: 5 },
      { id: 'D-s1', letra: 'D', tipo: 'sombra', nota: 2 },
      { id: 'I-f2', letra: 'I', tipo: 'forca', nota: 4 },
      { id: 'C-f1', letra: 'C', tipo: 'contraste', nota: 1 }
    ],
    gruposSeg: Array.from({ length: 25 }, (_, i) => 3.04 + i * 1.25),
    semMexer: 2,
    demonstracao: false
  };
}

async function limparRespostas() {
  await db.query('delete from public.respostas');
}

// ---------------------------------------------------------------------------
// Instalação
// ---------------------------------------------------------------------------

test('migração antiga roda e pode rodar de novo sem erro (idempotente)', async () => {
  exigirBanco();
  await db.query(MIGRACAO);
  await db.query(MIGRACAO);
  const t = await db.query(`select tablename from pg_tables where schemaname = 'public' order by 1`);
  assert.deepEqual(t.rows.map((r) => r.tablename), ['admins', 'configuracoes', 'processos', 'relatorios', 'respostas']);
});

test('migração nova sobre dados antigos: idempotente, cria pessoas agrupando pelo WhatsApp (backfill)', async () => {
  exigirBanco();
  // Dados "de produção" gravados pela versão antiga: o mesmo WhatsApp em formatos diferentes, telefone vazio etc.
  await db.query(`insert into public.processos (codigo, nome) values ('LEG1', 'Legado')`);
  await db.query(`
    insert into public.respostas (id, processo_id, avaliacao, nome, telefone, idade, funcao, empresa, respostas, recebido_em)
    select x.id, (select id from public.processos where codigo = 'LEG1'), 'LEG1', x.nome, x.tel, x.idade, x.funcao, x.empresa,
           repeat('1234', 25), x.quando::timestamptz
    from (values
      ('legado-01', 'Maria Antiga Souza', '(11) 98888-7777', 25, 'Caixa', 'Mercado A', '2026-09-01T10:00:00Z'),
      ('legado-02', 'Maria Souza', '11988887777', null, '', 'Mercado B', '2026-09-10T10:00:00Z'),
      ('legado-03', 'Maria S. Souza', '5511988887777', 26, 'Gerente', '', '2026-09-05T10:00:00Z'),
      ('legado-04', 'Pedro Outro Lima', '5521977776666', 40, 'Motorista', '', '2026-09-02T10:00:00Z'),
      ('legado-05', 'Sem Telefone Algum', '', 33, '', '', '2026-09-03T10:00:00Z'),
      ('legado-06', 'Telefone Ruim Aqui', '123', 33, '', '', '2026-09-04T10:00:00Z')
    ) as x(id, nome, tel, idade, funcao, empresa, quando)`);

  await db.query(MIGRACAO_PESSOAS);
  await db.query(MIGRACAO_PESSOAS);
  await db.query(MIGRACAO_PESSOAS);
  await db.query(MIGRACAO_EQUIPES);
  await db.query(MIGRACAO_EQUIPES);
  const t = await db.query(`select tablename, rowsecurity from pg_tables where schemaname = 'public' order by 1`);
  assert.deepEqual(t.rows.map((r) => r.tablename), TABELAS);
  assert.ok(t.rows.every((r) => r.rowsecurity), 'RLS ligado em todas as tabelas');

  const pessoas = (await db.query(`select * from public.pessoas order by telefone`)).rows;
  assert.equal(pessoas.length, 2, 'uma ficha por WhatsApp (rodar de novo não duplica)');
  const maria = pessoas.find((p) => p.telefone === '5511988887777');
  assert.equal(maria.nome, 'Maria Souza', 'nome da resposta mais recente');
  assert.equal(maria.idade, 26, 'idade mais recente informada');
  assert.equal(maria.funcao, 'Gerente');
  assert.equal(maria.empresa, 'Mercado B');
  assert.equal(maria.criado_em.toISOString(), '2026-09-01T10:00:00.000Z');
  assert.equal(maria.atualizado_em.toISOString(), '2026-09-10T10:00:00.000Z');
  const ligadas = (await db.query(`select id, pessoa_id, email, cidade, extras from public.respostas where id like 'legado-%' order by id`)).rows;
  assert.deepEqual(ligadas.slice(0, 3).map((r) => r.pessoa_id), [maria.id, maria.id, maria.id]);
  assert.equal(ligadas[3].pessoa_id, pessoas.find((p) => p.telefone === '5521977776666').id);
  assert.equal(ligadas[4].pessoa_id, null, 'telefone vazio fica sem pessoa');
  assert.equal(ligadas[5].pessoa_id, null, 'telefone inválido fica sem pessoa');
  assert.deepEqual(ligadas[0], { id: 'legado-01', pessoa_id: maria.id, email: '', cidade: '', extras: [] });

  // Excluir respostas: a pessoa só some quando fica sem nenhuma.
  await db.query(`delete from public.respostas where id in ('legado-01', 'legado-04')`);
  assert.deepEqual((await db.query(`select telefone from public.pessoas`)).rows, [{ telefone: '5511988887777' }]);
  await db.query(`delete from public.respostas where id like 'legado-%'`);
  assert.equal((await db.query(`select count(*)::int n from public.pessoas`)).rows[0].n, 0);
  await db.query(`delete from public.processos where codigo = 'LEG1'`);
});

test('seed da prévia (opcional) roda duas vezes e cria SEL1/EQP1/ATD1, a mesma pessoa em 2 respostas e a equipe da Clínica Exemplo', async () => {
  exigirBanco();
  if (!fs.existsSync(CAMINHO_SEED)) return;
  const seed = fs.readFileSync(CAMINHO_SEED, 'utf8');
  await db.query(seed);
  await db.query(seed);
  const r = await db.query(`select codigo, tipo, mostrar_resultado from public.processos where codigo in ('SEL1', 'EQP1', 'ATD1') order by codigo`);
  assert.deepEqual(r.rows, [
    { codigo: 'ATD1', tipo: 'selecao', mostrar_resultado: true },
    { codigo: 'EQP1', tipo: 'equipe', mostrar_resultado: true },
    { codigo: 'SEL1', tipo: 'selecao', mostrar_resultado: false }
  ]);
  const n = await db.query(`select count(*)::int n, count(distinct pessoa_id)::int p from public.respostas where id like 'previa-%'`);
  assert.deepEqual(n.rows[0], { n: 9, p: 8 });
  const ana = (await db.query(`select p.* from public.pessoas p join public.respostas r on r.pessoa_id = p.id where r.id = 'previa-exemplo-05'`)).rows[0];
  assert.equal(ana.email, 'ana.exemplo@exemplo.com');
  assert.equal((await db.query(`select pessoa_id from public.respostas where id = 'previa-exemplo-01'`)).rows[0].pessoa_id, ana.id);
  const atd = await rpc('anon', null, 'avaliacao_publica', ['ATD1']);
  assert.equal(atd.formulario.campos.email, 'obrigatorio');
  assert.equal(atd.formulario.perguntas.length, 1);
  // Equipe: 7 ativos (1 sem teste), 1 desligado, organograma de 3 níveis; SEL1 e EQP1 ligados à empresa.
  const EMP = '5eed0000-0000-4000-8000-000000000001';
  const vin = (await db.query(`select v.status, p.nome, v.fim is not null as tem_fim,
      exists (select 1 from public.respostas r where r.pessoa_id = p.id) as testou
    from public.vinculos v join public.pessoas p on p.id = v.pessoa_id where v.empresa_id = $1 order by p.nome`, [EMP])).rows;
  assert.equal(vin.filter((v) => v.status === 'ativo').length, 7);
  assert.deepEqual(vin.filter((v) => v.status === 'desligado').map((v) => [v.nome, v.tem_fim]), [['Bruno Teste Fictício', true]]);
  assert.deepEqual(vin.filter((v) => !v.testou).map((v) => v.nome), ['Tiago Modelo Sem Teste']);
  const lidera = (await db.query(`select a.nome de, b.nome para from public.relacoes r join public.pessoas a on a.id = r.de_pessoa
    join public.pessoas b on b.id = r.para_pessoa where r.empresa_id = $1 and r.tipo = 'lidera' order by 1, 2`, [EMP])).rows;
  assert.equal(lidera.length, 6);
  assert.equal(lidera.filter((x) => x.de === 'Marta Exemplo Diretora').length, 2, 'diretora lidera os 2 líderes de área');
  assert.equal((await db.query(`select count(*)::int n from public.relacoes where empresa_id = $1`, [EMP])).rows[0].n, 9);
  const ligados = (await db.query(`select codigo, empresa from public.processos where empresa_id = $1 order by codigo`, [EMP])).rows;
  assert.deepEqual(ligados, [{ codigo: 'EQP1', empresa: 'Clínica Exemplo' }, { codigo: 'SEL1', empresa: 'Clínica Exemplo' }]);
  // Sai do caminho dos outros testes (que esperam banco limpo) — mesma limpeza do cabeçalho do seed.
  await db.query(`delete from public.vinculos where empresa_id = $1`, [EMP]);
  await db.query(`delete from public.empresas where id = $1`, [EMP]);
  await db.query(`delete from public.respostas where id like 'previa-%'`);
  await db.query(`delete from public.processos where codigo in ('SEL1', 'EQP1', 'ATD1')`);
  await db.query(`delete from public.pessoas where telefone like '55119000000%'`);
  assert.equal((await db.query(`select count(*)::int n from public.pessoas`)).rows[0].n, 0);
});

// ---------------------------------------------------------------------------
// anon (site público)
// ---------------------------------------------------------------------------

test('anon não lê nem grava nenhuma tabela', async () => {
  exigirBanco();
  for (const t of TABELAS) {
    await rejeita(anon(`select * from public.${t}`), /permission denied/);
    await rejeita(anon(`delete from public.${t}`), /permission denied/);
  }
  await rejeita(anon(`insert into public.processos (nome) values ('x')`), /permission denied/);
  await rejeita(anon(`insert into public.configuracoes (chave, valor) values ('a', 'b')`), /permission denied/);
  await rejeita(anon(`update public.respostas set status = 'aprovado'`), /permission denied/);
});

test('anon só executa as 3 funções públicas', async () => {
  exigirBanco();
  const r = await rpc('anon', null, 'avaliacao_publica', ['ZZZZ']);
  assert.equal(r.ok, false);
  await rpc('anon', null, 'relatorio_publico', ['x'.repeat(40)]);
  await rpc('anon', null, 'enviar_resposta', [JSON.stringify({})]);
  await rejeita(rpc('anon', null, 'e_admin'), /permission denied/);
  await rejeita(rpc('anon', null, 'garantir_primeiro_admin'), /permission denied/);
  await rejeita(anon(`select disc_interno.gerar_protocolo()`), /permission denied/);
  await rejeita(anon(`select disc_interno.calcular_disc(repeat('1234', 25))`), /permission denied/);
  // Nenhuma outra função do schema public fica liberada para anon.
  const f = await db.query(`
    select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute') order by 1`);
  assert.deepEqual(f.rows.map((x) => x.proname), ['avaliacao_publica', 'enviar_resposta', 'relatorio_publico']);
  const g = await db.query(`
    select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute') order by 1`);
  assert.deepEqual(g.rows.map((x) => x.proname),
    ['avaliacao_publica', 'e_admin', 'enviar_resposta', 'garantir_primeiro_admin', 'mover_colaborador', 'relatorio_publico',
      'salvar_colaborador', 'salvar_relacoes']);
  assert.equal((await db.query(`select has_schema_privilege('anon', 'disc_interno', 'usage') v`)).rows[0].v, false);
  assert.equal((await db.query(`select has_schema_privilege('authenticated', 'disc_interno', 'usage') v`)).rows[0].v, false);
});

// ---------------------------------------------------------------------------
// Primeiro admin e RLS do usuário logado
// ---------------------------------------------------------------------------

test('garantir_primeiro_admin: só funciona com a tabela admins vazia', async () => {
  exigirBanco();
  await criarUsuario(U.dono, 'dona@empresa.com', 'Dona do Sistema');
  await criarUsuario(U.outro, 'outro@empresa.com');
  await criarUsuario(U.terceiro, 'terceiro@empresa.com');

  assert.equal(await rpc('authenticated', U.outro, 'e_admin'), false);
  const semLogin = await rpc('authenticated', null, 'garantir_primeiro_admin');
  assert.equal(semLogin.ok, false);
  assert.equal(semLogin.sessaoExpirada, true);

  const r1 = await rpc('authenticated', U.dono, 'garantir_primeiro_admin');
  assert.deepEqual(r1, { ok: true, admin: true, primeiro: true });
  assert.equal(await rpc('authenticated', U.dono, 'e_admin'), true);
  const nome = await db.query('select nome from public.admins where user_id = $1', [U.dono]);
  assert.equal(nome.rows[0].nome, 'Dona do Sistema');

  const r2 = await rpc('authenticated', U.outro, 'garantir_primeiro_admin');
  assert.deepEqual(r2, { ok: true, admin: false });
  assert.equal(await rpc('authenticated', U.outro, 'e_admin'), false);

  const r3 = await rpc('authenticated', U.dono, 'garantir_primeiro_admin');
  assert.deepEqual(r3, { ok: true, admin: true });
  const n = await db.query('select count(*)::int n from public.admins');
  assert.equal(n.rows[0].n, 1);
});

test('authenticated que não é admin não vê nem grava nada', async () => {
  exigirBanco();
  await db.query(`insert into public.processos (nome, codigo) values ('Processo RLS', 'RLS1') on conflict (codigo) do nothing`);
  await db.query(`insert into public.configuracoes (chave, valor) values ('status.relatorio', 'gerar relatório') on conflict do nothing`);
  const pid = (await db.query(`select id from public.processos where codigo = 'RLS1'`)).rows[0].id;
  await db.query(`insert into public.relatorios (processo_id, dados) values ($1, '{}') `, [pid]);
  const env = await rpc('anon', null, 'enviar_resposta', [JSON.stringify(payload())]);
  assert.equal(env.ok, true, env.erro);

  // (empresas/vinculos/relacoes: RLS conferido com dados em tests/supabase/empresas.test.js)
  for (const t of TABELAS.filter((x) => !['empresas', 'vinculos', 'relacoes'].includes(x))) {
    const r = await logado(U.outro, `select * from public.${t}`);
    assert.equal(r.rowCount, 0, `não-admin não vê ${t}`);
    const tudo = await db.query(`select count(*)::int n from public.${t}`);
    assert.ok(tudo.rows[0].n > 0, `há dados em ${t}`);
  }
  await rejeita(logado(U.outro, `insert into public.processos (nome) values ('x')`), /row-level security/);
  await rejeita(logado(U.outro, `insert into public.admins (user_id) values ($1)`, [U.outro]), /row-level security/);
  await rejeita(logado(U.outro, `insert into public.configuracoes (chave) values ('x')`), /row-level security/);
  const upd = await logado(U.outro, `update public.respostas set status = 'aprovado'`);
  assert.equal(upd.rowCount, 0);
  const del = await logado(U.outro, `delete from public.processos`);
  assert.equal(del.rowCount, 0);
  // Sem login (sub vazio) também nada.
  assert.equal((await logado(null, `select * from public.respostas`)).rowCount, 0);
  await db.query(`delete from public.relatorios where processo_id = $1`, [pid]);
  await limparRespostas();
});

test('admin vê e administra tudo (processos, respostas, relatórios, admins, configurações)', async () => {
  exigirBanco();
  const env = await rpc('anon', null, 'enviar_resposta', [JSON.stringify(payload({ avaliacao: 'rls1' }))]);
  assert.equal(env.ok, true, env.erro);

  for (const t of ['admins', 'processos', 'respostas', 'configuracoes', 'pessoas']) {
    const r = await logado(U.dono, `select * from public.${t}`);
    assert.ok(r.rowCount > 0, `admin vê ${t}`);
  }
  // processo novo: código gerado com o alfabeto do link
  const novo = await logado(U.dono,
    `insert into public.processos (nome, tipo, empresa, config) values ('Seleção Teste', 'equipe', 'Clínica', '{"perfilIdeal":"C"}') returning codigo, ativo, mostrar_resultado`);
  assert.match(novo.rows[0].codigo, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/);
  assert.equal(novo.rows[0].ativo, true);
  assert.equal(novo.rows[0].mostrar_resultado, false);
  // código informado em minúsculas é normalizado
  const manual = await logado(U.dono, `insert into public.processos (nome, codigo) values ('Manual', ' ab 2c') returning codigo`);
  assert.equal(manual.rows[0].codigo, 'AB2C');

  // status/observações sim; outras colunas e inserção direta de respostas não
  const st = await logado(U.dono, `update public.respostas set status = 'aprovado', observacoes = 'ok' where id = $1`, [env.id]);
  assert.equal(st.rowCount, 1);
  await rejeita(logado(U.dono, `update public.respostas set status = 'talvez' where id = $1`, [env.id]), /check constraint/);
  await rejeita(logado(U.dono, `update public.respostas set nome = 'Outro Nome' where id = $1`, [env.id]), /permission denied/);
  await rejeita(logado(U.dono, `insert into public.respostas (id, nome, respostas) values ('abcdef1', 'A B', repeat('1234', 25))`), /permission denied/);

  // relatórios
  const pid = (await db.query(`select id from public.processos where codigo = 'RLS1'`)).rows[0].id;
  const rel = await logado(U.dono, `insert into public.relatorios (processo_id, dados) values ($1, '{"a":1}') returning token, status`, [pid]);
  assert.match(rel.rows[0].token, /^[0-9a-f]{64}$/);
  assert.equal(rel.rows[0].status, 'rascunho');
  assert.equal((await logado(U.dono, `select * from public.relatorios`)).rowCount, 1);

  // configurações e admins
  await logado(U.dono, `insert into public.configuracoes (chave, valor) values ('ui.tema', 'claro')`);
  await logado(U.dono, `insert into public.admins (user_id, nome) values ($1, 'Terceiro')`, [U.terceiro]);
  assert.equal(await rpc('authenticated', U.terceiro, 'e_admin'), true);
  await logado(U.dono, `delete from public.admins where user_id = $1`, [U.terceiro]);
  assert.equal(await rpc('authenticated', U.terceiro, 'e_admin'), false);

  // excluir respostas (uma) e tudo de um processo
  const del = await logado(U.dono, `delete from public.respostas where id = $1`, [env.id]);
  assert.equal(del.rowCount, 1);
  await db.query(`delete from public.relatorios`);
  await db.query(`delete from public.processos where codigo in ('AB2C') or nome = 'Seleção Teste'`);
});

test('admins: ninguém remove o próprio acesso e sempre sobra 1 admin', async () => {
  exigirBanco();
  await rejeita(logado(U.dono, `delete from public.admins where user_id = $1`, [U.dono]), /Você não pode excluir o seu próprio acesso\./);
  // Pelo servidor (service role, sem usuário) também não apaga o último admin.
  await rejeita(como('service_role', null, `delete from public.admins`), /Precisa existir pelo menos um administrador ativo\./);
  // Apagar o usuário do Auth apaga o admin em cascata (quando não é o último).
  await logado(U.dono, `insert into public.admins (user_id, nome) values ($1, 'Terceiro')`, [U.terceiro]);
  await db.query(`delete from auth.users where id = $1`, [U.terceiro]);
  assert.equal((await db.query(`select count(*)::int n from public.admins`)).rows[0].n, 1);
  await criarUsuario(U.terceiro, 'terceiro@empresa.com');
});

test('processos: campo sensível do ClickUp é recusado e processo com respostas não é excluído', async () => {
  exigirBanco();
  const cfg = (campo, extra) => JSON.stringify(Object.assign({ etapas: [{ id: 'e1', nome: 'Entrevista', peso: 1, campo }] }, extra || {}));
  await rejeita(logado(U.dono, `insert into public.processos (nome, config) values ('X', $1)`, [cfg('Estado Civil')]),
    /O campo "Estado Civil" é um dado sensível e não pode ser usado\./);
  await rejeita(logado(U.dono, `insert into public.processos (nome, config) values ('X', $1)`,
    [JSON.stringify({ bonus: [{ id: 'b1', nome: 'B', campo: 'Possui filhos?', regra: { tipo: 'checkbox', pontos: 1 } }] })]),
  /dado sensível/);
  await rejeita(logado(U.dono, `insert into public.processos (nome, config) values ('X', $1)`, [cfg('Saúde')]), /dado sensível/);
  await logado(U.dono, `insert into public.processos (nome, config) values ('Saude ok', $1)`, [cfg('Saúde', { permitirSaude: true })]);
  await rejeita(logado(U.dono, `insert into public.processos (nome, config) values ('X', $1)`, [cfg('Antecedentes criminais')]), /dado sensível/);
  await logado(U.dono, `insert into public.processos (nome, config) values ('Antecedentes ok', $1)`, [cfg('Antecedentes criminais', { permitirAntecedentes: true })]);
  // "graça" não casa com "raca" (termo só no começo da palavra)
  await logado(U.dono, `insert into public.processos (nome, config) values ('Graça ok', $1)`, [cfg('Nota de graça')]);
  await rejeita(logado(U.dono, `update public.processos set config = $1 where nome = 'Graça ok'`, [cfg('Religião')]), /dado sensível/);
  await db.query(`delete from public.processos where nome in ('Saude ok', 'Antecedentes ok', 'Graça ok')`);

  const env = await rpc('anon', null, 'enviar_resposta', [JSON.stringify(payload({ avaliacao: 'RLS1' }))]);
  assert.equal(env.ok, true, env.erro);
  await rejeita(logado(U.dono, `delete from public.processos where codigo = 'RLS1'`),
    /Esta avaliação já tem respostas\. Desative a avaliação em vez de excluir/);
  await limparRespostas();
  const ok = await logado(U.dono, `delete from public.processos where codigo = 'RLS1'`);
  assert.equal(ok.rowCount, 1);
});

// ---------------------------------------------------------------------------
// avaliacao_publica
// ---------------------------------------------------------------------------

test('avaliacao_publica: só processos ativos; código normalizado; erro igual ao Code.gs', async () => {
  exigirBanco();
  await db.query(`insert into public.processos (codigo, nome, tipo, empresa, mostrar_resultado, clickup_list_id, config)
    values ('PUB1', 'Seleção Recepção', 'selecao', 'Clínica Exemplo', true, '901', '{"corte":70}'),
           ('OFF1', 'Antigo', 'equipe', 'Loja', false, null, '{}')`);
  await db.query(`update public.processos set ativo = false where codigo = 'OFF1'`);
  const r = await rpc('anon', null, 'avaliacao_publica', [' pub1 ']);
  assert.equal(r.ok, true);
  const esperado = { codigo: 'PUB1', nome: 'Seleção Recepção', tipo: 'selecao', empresaNome: 'Clínica Exemplo', mostrarResultado: true,
    formulario: { campos: { idade: 'obrigatorio', funcao: 'opcional', empresa: 'opcional', email: 'oculto', cidade: 'oculto' }, perguntas: [] } };
  assert.deepEqual(r.avaliacao, esperado);
  for (const k of Object.keys(esperado)) assert.deepEqual(r[k], esperado[k]);
  assert.equal(JSON.stringify(r).includes('901'), false, 'não expõe a lista do ClickUp');
  const msg = 'Link inválido ou avaliação encerrada. Fale com quem enviou o link.';
  assert.deepEqual(await rpc('anon', null, 'avaliacao_publica', ['OFF1']), { ok: false, erro: msg });
  assert.deepEqual(await rpc('anon', null, 'avaliacao_publica', ['ZZZZ']), { ok: false, erro: msg });
  assert.deepEqual(await rpc('anon', null, 'avaliacao_publica', ['abc']), { ok: false, erro: msg });
  assert.deepEqual(await rpc('anon', null, 'avaliacao_publica', [null]), { ok: false, erro: msg });
  // Mesmo resultado do Code.gs para os mesmos códigos
  assert.equal(gas.g.normalizarCodigoAvaliacao(' pub1 '), 'PUB1');
});

// ---------------------------------------------------------------------------
// enviar_resposta
// ---------------------------------------------------------------------------

test('enviar_resposta grava, recalcula D/I/S/C e perfil e devolve protocolo', async () => {
  exigirBanco();
  await limparRespostas();
  const rnd = prng(7);
  const resp = respostasAleatorias(rnd);
  const p = payload({ respostas: S.compactar(resp), avaliacao: 'pub1', validacao: validacaoValida(),
    resultado: { percentuais: { D: 1, I: 1, S: 1, C: 97 }, codigo: 'CS' } });
  const r = await rpc('anon', null, 'enviar_resposta', [JSON.stringify(p)]);
  assert.equal(r.ok, true, r.erro);
  assert.equal(r.id, p.id);
  assert.match(r.protocolo, /^[0-9]{2}[A-HJ-NP-Z]$/);
  assert.equal(r.duplicado, undefined);

  const calc = S.calcular(resp);
  const linha = (await db.query(`select r.*, p.codigo as proc_codigo from public.respostas r
    left join public.processos p on p.id = r.processo_id where r.id = $1`, [p.id])).rows[0];
  assert.equal(linha.proc_codigo, 'PUB1');
  assert.equal(linha.avaliacao, 'PUB1');
  assert.equal(linha.protocolo, r.protocolo);
  assert.equal(linha.status, 'em_analise');
  assert.equal(linha.observacoes, '');
  assert.equal(linha.nome, 'João da Silva');
  assert.equal(linha.telefone, '5511999998888');
  assert.equal(linha.idade, 30);
  assert.equal(linha.duracao_seg, 600);
  assert.equal(linha.inicio.toISOString(), '2026-10-01T12:00:00.000Z');
  for (const l of ['D', 'I', 'S', 'C']) assert.equal(Number(linha[l.toLowerCase()]), calc.percentuais[l], l);
  assert.equal(linha.perfil, calc.codigo);
  assert.deepEqual(linha.payload.resultado, { percentuais: calc.percentuais, codigo: calc.codigo });
  assert.equal(linha.clickup_sync, null);
  // payload e validação iguais aos do Code.gs (mesma limpeza)
  const v = gas.g.validarPayload(JSON.parse(JSON.stringify(p)));
  const esperado = Object.assign(JSON.parse(JSON.stringify(v.payload)), NOVOS_NO_PAYLOAD);
  assert.deepEqual(linha.payload, esperado);
  assert.deepEqual(linha.validacao, esperado.validacao);
});

test('enviar_resposta é idempotente pelo id (mesmo protocolo, duplicado:true)', async () => {
  exigirBanco();
  const p = payload();
  const r1 = await rpc('anon', null, 'enviar_resposta', [JSON.stringify(p)]);
  assert.equal(r1.ok, true, r1.erro);
  const r2 = await rpc('anon', null, 'enviar_resposta', [JSON.stringify(Object.assign({}, p, { nome: 'Outro Nome Qualquer' }))]);
  assert.deepEqual(r2, { ok: true, duplicado: true, id: p.id, protocolo: r1.protocolo });
  const n = await db.query('select count(*)::int n, min(nome) nome from public.respostas where id = $1', [p.id]);
  assert.deepEqual(n.rows[0], { n: 1, nome: 'João da Silva' });
  // Linha antiga (importada) sem protocolo ganha um no reenvio, e o mesmo nas vezes seguintes.
  await db.query(`insert into public.respostas (id, nome, respostas) values ('antigo-000001', 'Fulano de Tal', repeat('4321', 25))`);
  const r3 = await rpc('anon', null, 'enviar_resposta', [JSON.stringify(payload({ id: 'antigo-000001' }))]);
  assert.equal(r3.duplicado, true);
  assert.match(r3.protocolo, /^[0-9]{2}[A-HJ-NP-Z]$/);
  const r4 = await rpc('anon', null, 'enviar_resposta', [JSON.stringify(payload({ id: 'antigo-000001' }))]);
  assert.equal(r4.protocolo, r3.protocolo);
});

test('enviar_resposta recusa link inexistente ou desativado', async () => {
  exigirBanco();
  const msg = 'Este link de avaliação não está mais ativo.';
  for (const avaliacao of ['OFF1', 'NADA', 'xx!', 12345]) {
    const r = await rpc('anon', null, 'enviar_resposta', [JSON.stringify(payload({ avaliacao }))]);
    assert.deepEqual(r, { ok: false, erro: msg }, String(avaliacao));
  }
  // Vazio = link geral
  const geral = await rpc('anon', null, 'enviar_resposta', [JSON.stringify(payload({ avaliacao: '  ' }))]);
  assert.equal(geral.ok, true, geral.erro);
  const l = await db.query('select processo_id, avaliacao from public.respostas where id = $1', [geral.id]);
  assert.deepEqual(l.rows[0], { processo_id: null, avaliacao: '' });
});

test('enviar_resposta valida tudo como o Code.gs (mesmas mensagens e mesma limpeza)', async () => {
  exigirBanco();
  const base = () => payload({ avaliacao: '', validacao: validacaoValida() });
  const casos = [
    null, [], 'texto', {},
    { id: 'curto' }, { id: 'tem espaço no meio' }, { id: '   abc_DEF-123   ' }, { id: 123456789 },
    { nome: 'João' }, { nome: 'Jo Al' }, { nome: 'Zé Ló' }, { nome: '  Ana   Maria\tSouza  ' }, { nome: 'Ítalo Ñúñez' },
    { nome: 'A'.repeat(200) + ' B' }, { nome: 'Ana 123' }, { nome: 'Анна Иванова' },
    { telefone: '11999998888' }, { telefone: '(11) 3333-4444' }, { telefone: '+55 11 99999-8888' },
    { telefone: '1199999888' }, { telefone: '4411999998888' }, { telefone: 5511999998888 }, { telefone: '' },
    { idade: undefined }, { idade: null }, { idade: '' }, { idade: '  ' }, { idade: '30' }, { idade: ' 45 ' },
    { idade: 13 }, { idade: 100 }, { idade: 14 }, { idade: 99 }, { idade: 30.5 }, { idade: '3O' }, { idade: true },
    { idade: '1000' }, { idade: -20 }, { idade: '030' },
    { consentimento: false }, { consentimento: 'true' }, { consentimento: undefined },
    { respostas: '1234' }, { respostas: '1'.repeat(100) }, { respostas: ' ' + '4321'.repeat(25) + ' ' },
    { respostas: '1234'.repeat(24) + '1123' }, { respostas: 1234 },
    { avaliacao: 'ab' },
    { validacao: undefined }, { validacao: null }, { validacao: 'x' }, { validacao: [] },
    { validacao: Object.assign(validacaoValida(), { versao: 0 }) },
    { validacao: Object.assign(validacaoValida(), { versao: '1' }) },
    { validacao: Object.assign(validacaoValida(), { pares: [['D', 'X']] }) },
    { validacao: Object.assign(validacaoValida(), { pares: [['D', 'C'], ['D', 'C'], ['D', 'C'], ['D', 'C']] }) },
    { validacao: Object.assign(validacaoValida(), { pares: ['DC'] }) },
    { validacao: Object.assign(validacaoValida(), { escolhas: ['Z'] }) },
    { validacao: Object.assign(validacaoValida(), { itens: [{ id: 'a b', letra: 'D', tipo: 'forca', nota: 3 }] }) },
    { validacao: Object.assign(validacaoValida(), { itens: [{ id: 'a', letra: 'D', tipo: 'outro', nota: 3 }] }) },
    { validacao: Object.assign(validacaoValida(), { itens: [{ id: 'a', letra: 'D', tipo: 'forca', nota: 6 }] }) },
    { validacao: Object.assign(validacaoValida(), { itens: [{ id: 'a', letra: 'D', tipo: 'forca', nota: 2.5 }] }) },
    { validacao: Object.assign(validacaoValida(), { itens: [{ id: 'a', letra: 'D', tipo: 'forca', nota: 2, extra: 'x' }] }) },
    { validacao: Object.assign(validacaoValida(), { gruposSeg: [1, -1] }) },
    { validacao: Object.assign(validacaoValida(), { gruposSeg: [1, '2'] }) },
    { validacao: Object.assign(validacaoValida(), { gruposSeg: [0.05, 0.15, 2.25, 86400] }) },
    { validacao: Object.assign(validacaoValida(), { gruposSeg: new Array(26).fill(1) }) },
    { validacao: Object.assign(validacaoValida(), { semMexer: 26 }) },
    { validacao: Object.assign(validacaoValida(), { semMexer: undefined }) },
    { validacao: Object.assign(validacaoValida(), { demonstracao: undefined }) },
    { validacao: Object.assign(validacaoValida(), { demonstracao: true }) },
    { validacao: Object.assign(validacaoValida(), { demonstracao: null }) },
    { validacao: Object.assign(validacaoValida(), { demonstracao: 'sim' }) },
    { validacao: Object.assign(validacaoValida(), { lixo: 'x'.repeat(4100) }) },
    { validacao: Object.assign(validacaoValida(), { outro: 'campo ignorado' }) },
    { funcao: '  Recepcionista   chefe  ', empresa: 'E'.repeat(120), vaga: 'V'.repeat(150) },
    { funcao: null, empresa: undefined, vaga: 42 },
    { inicio: 'ontem', fim: '2026-10-01T12:10:00Z' },
    { inicio: '2026-10-01T09:00:00-03:00', fim: '2026-10-01T12:10:30.123Z', duracaoSeg: 'abc' },
    { duracaoSeg: -5 }, { duracaoSeg: 10 * 86400 }, { duracaoSeg: '512' }, { duracaoSeg: 511.5 }, { duracaoSeg: null },
    { inicio: '', fim: '', duracaoSeg: 'x' }
  ];
  let i = 0;
  for (const c of casos) {
    i += 1;
    let p;
    if (c === null || Array.isArray(c) || typeof c !== 'object') p = c;
    else {
      p = base();
      for (const [k, v] of Object.entries(c)) { if (v === undefined) delete p[k]; else p[k] = v; }
    }
    const json = JSON.stringify(p);
    const esperado = JSON.parse(JSON.stringify(gas.g.validarPayload(p === null ? null : JSON.parse(json))));
    const obtido = (await db.query('select disc_interno.validar_payload($1::jsonb) as r', [json])).rows[0].r;
    const rotulo = `caso ${i}: ${JSON.stringify(c).slice(0, 120)}`;
    assert.equal(obtido.ok, esperado.ok, rotulo + ' -> ' + JSON.stringify(obtido.erro || esperado.erro));
    if (!esperado.ok) assert.equal(obtido.erro, esperado.erro, rotulo);
    else assert.deepEqual(obtido.payload, Object.assign({}, esperado.payload, NOVOS_NO_PAYLOAD), rotulo);
  }
  // E pela RPC de verdade, com a mesma mensagem.
  const r = await rpc('anon', null, 'enviar_resposta', [JSON.stringify(payload({ telefone: '123' }))]);
  assert.deepEqual(r, { ok: false, erro: 'Telefone inválido. Informe DDD + número.' });
  const grande = await rpc('anon', null, 'enviar_resposta', [JSON.stringify(payload({ vaga: 'x'.repeat(21000) }))]);
  assert.deepEqual(grande, { ok: false, erro: 'Requisição grande demais.' });
  assert.deepEqual(await rpc('anon', null, 'enviar_resposta', [null]), { ok: false, erro: 'Dados do teste ausentes.' });
});

test('enviar_resposta: perfil igual ao Code.gs para muitas respostas aleatórias', async () => {
  exigirBanco();
  const rnd = prng(42);
  for (let k = 0; k < 60; k++) {
    const str = S.compactar(respostasAleatorias(rnd));
    const esperado = gas.g.calcularDisc(str);
    const r = (await db.query('select disc_interno.calcular_disc($1) as r', [str])).rows[0].r;
    assert.deepEqual(r.percentuais, JSON.parse(JSON.stringify(esperado.percentuais)));
    assert.equal(r.codigo, esperado.codigo);
  }
  // Empates seguem a ordem D, I, S, C
  const empate = (await db.query(`select disc_interno.calcular_disc(repeat('1234', 25)) as r`)).rows[0].r;
  assert.equal(empate.codigo, gas.g.calcularDisc('1234'.repeat(25)).codigo);
  const empate2 = (await db.query(`select disc_interno.calcular_disc(repeat('43214321', 12) || '1234') as r`)).rows[0].r;
  assert.equal(empate2.codigo, gas.g.calcularDisc('43214321'.repeat(12) + '1234').codigo);
});

test('protocolo: único, formato certo e erro claro quando esgota', async () => {
  exigirBanco();
  await limparRespostas();
  // Ocupa 2.399 dos 2.400 códigos direto no banco: o gerador acha o único livre.
  await db.query(`
    insert into public.respostas (id, nome, respostas, protocolo, recebido_em)
    select 'lote-' || k, 'Fulano de Tal', repeat('1234', 25),
           lpad((k / 24)::text, 2, '0') || substr('ABCDEFGHJKLMNPQRSTUVWXYZ', k % 24 + 1, 1), now() - interval '1 day'
    from generate_series(0, 2399) k where k <> 1234`);
  const livre = (await db.query(`select disc_interno.gerar_protocolo() p`)).rows[0].p;
  assert.equal(livre, '51' + 'ABCDEFGHJKLMNPQRSTUVWXYZ'[1234 % 24]);
  await db.query(`insert into public.respostas (id, nome, respostas, protocolo) values ('lote-1234', 'Fulano de Tal', repeat('1234', 25), $1)`, [livre]);
  await rejeita(db.query(`select disc_interno.gerar_protocolo()`),
    /Limite de códigos atingido: todos os 2400 códigos estão em uso\. Exclua candidatos antigos ou de teste no painel e tente de novo\./);
  // A RPC para antes (limite de 2.000 linhas) com a mensagem do Code.gs.
  const r = await rpc('anon', null, 'enviar_resposta', [JSON.stringify(payload())]);
  assert.deepEqual(r, { ok: false, erro: 'Limite de respostas atingido. Avise o recrutador.' });
  // Protocolo repetido nunca entra (unique).
  await rejeita(db.query(`insert into public.respostas (id, nome, respostas, protocolo) values ('outro-01', 'Fulano de Tal', repeat('1234', 25), '00A')`), /duplicate key/);
  await limparRespostas();

  // Envios reais: todos com protocolo distinto.
  const vistos = new Set();
  for (let k = 0; k < 30; k++) {
    const e = await rpc('anon', null, 'enviar_resposta', [JSON.stringify(payload())]);
    assert.equal(e.ok, true, e.erro);
    assert.ok(!vistos.has(e.protocolo));
    vistos.add(e.protocolo);
  }
  await limparRespostas();
});

test('enviar_resposta: no máximo 40 envios a cada 10 minutos e 2000 linhas', async () => {
  exigirBanco();
  await limparRespostas();
  await db.query(`
    insert into public.respostas (id, nome, respostas, recebido_em)
    select 'janela-' || k, 'Fulano de Tal', repeat('1234', 25), now() - interval '9 minutes'
    from generate_series(1, 39) k`);
  const ok = await rpc('anon', null, 'enviar_resposta', [JSON.stringify(payload())]);
  assert.equal(ok.ok, true, ok.erro);
  const bloqueado = await rpc('anon', null, 'enviar_resposta', [JSON.stringify(payload())]);
  assert.deepEqual(bloqueado, { ok: false, erro: 'Muitos envios em pouco tempo. Aguarde alguns minutos e tente novamente.' });
  // Reenvio do mesmo id continua respondendo (não conta como envio novo).
  const dup = await rpc('anon', null, 'enviar_resposta', [JSON.stringify(payload({ id: ok.id }))]);
  assert.equal(dup.duplicado, true);
  // Passada a janela, volta a aceitar.
  await db.query(`update public.respostas set recebido_em = now() - interval '11 minutes'`);
  const depois = await rpc('anon', null, 'enviar_resposta', [JSON.stringify(payload())]);
  assert.equal(depois.ok, true, depois.erro);

  await limparRespostas();
  await db.query(`
    insert into public.respostas (id, nome, respostas, recebido_em)
    select 'cheio-' || k, 'Fulano de Tal', repeat('1234', 25), now() - interval '1 day'
    from generate_series(1, 2000) k`);
  const cheio = await rpc('anon', null, 'enviar_resposta', [JSON.stringify(payload())]);
  assert.deepEqual(cheio, { ok: false, erro: 'Limite de respostas atingido. Avise o recrutador.' });
  await limparRespostas();
});

// ---------------------------------------------------------------------------
// relatorio_publico
// ---------------------------------------------------------------------------

test('relatorio_publico: só relatório publicado, sem o id da lista do ClickUp', async () => {
  exigirBanco();
  const pid = (await db.query(`select id from public.processos where codigo = 'PUB1'`)).rows[0].id;
  const dados = { processo: { nome: 'Seleção Recepção', clickupListId: '901' }, candidatos: [{ nome: 'Ana S.' }] };
  const rel = await logado(U.dono, `insert into public.relatorios (processo_id, dados) values ($1, $2) returning token`, [pid, JSON.stringify(dados)]);
  const token = rel.rows[0].token;
  const naoAchou = { ok: false, erro: 'Relatório não encontrado ou fora do ar.' };

  assert.deepEqual(await rpc('anon', null, 'relatorio_publico', [token]), naoAchou, 'rascunho não aparece');
  await logado(U.dono, `update public.relatorios set status = 'publicado' where token = $1`, [token]);
  const pub = await rpc('anon', null, 'relatorio_publico', [token]);
  assert.equal(pub.ok, true);
  assert.deepEqual(pub.relatorio, { processo: { nome: 'Seleção Recepção' }, candidatos: [{ nome: 'Ana S.' }] });
  assert.match(pub.publicadoEm, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.deepEqual(Object.keys(pub).sort(), ['modelo', 'ok', 'publicadoEm', 'relatorio']);
  assert.equal(pub.modelo, 'processo');

  await logado(U.dono, `update public.relatorios set status = 'rascunho' where token = $1`, [token]);
  assert.deepEqual(await rpc('anon', null, 'relatorio_publico', [token]), naoAchou, 'despublicado some');
  assert.deepEqual(await rpc('anon', null, 'relatorio_publico', ['a'.repeat(64)]), naoAchou);
  assert.deepEqual(await rpc('anon', null, 'relatorio_publico', ['curto']), naoAchou);
  assert.deepEqual(await rpc('anon', null, 'relatorio_publico', [null]), naoAchou);
  assert.deepEqual(await rpc('anon', null, 'relatorio_publico', ["' or 1=1 --" + 'x'.repeat(40)]), naoAchou);
  // token curto demais não é aceito pela tabela
  await rejeita(db.query(`insert into public.relatorios (token, processo_id) values ('abc', $1)`, [pid]), /check constraint/);
  await db.query(`delete from public.relatorios`);
});

test('service_role (Edge Functions) lê e grava tudo, inclusive clickup_sync', async () => {
  exigirBanco();
  const e = await rpc('anon', null, 'enviar_resposta', [JSON.stringify(payload({ avaliacao: 'PUB1' }))]);
  assert.equal(e.ok, true, e.erro);
  const r = await como('service_role', null, `update public.respostas set clickup_sync = '{"ok":true}' where id = $1 returning telefone`, [e.id]);
  assert.equal(r.rows[0].telefone, '5511999998888');
  const p = await como('service_role', null, `select clickup_list_id from public.processos where codigo = 'PUB1'`);
  assert.equal(p.rows[0].clickup_list_id, '901');
  await limparRespostas();
});

// ---------------------------------------------------------------------------
// Segurança adversarial (QA final)
// ---------------------------------------------------------------------------

test('segurança: toda função security definer tem search_path fixo; nada de privilégio sobrando para anon', async () => {
  exigirBanco();
  const semPath = await db.query(`
    select n.nspname || '.' || p.proname as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'disc_interno') and p.prosecdef
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`);
  assert.deepEqual(semPath.rows, [], 'security definer sem search_path');
  const privs = ['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger'];
  for (const t of TABELAS) {
    for (const pr of privs) {
      const r = await db.query(`select has_table_privilege('anon', 'public.${t}', $1) v`, [pr]);
      assert.equal(r.rows[0].v, false, `anon tem ${pr} em ${t}`);
    }
    for (const pr of ['truncate', 'references', 'trigger']) {
      const r = await db.query(`select has_table_privilege('authenticated', 'public.${t}', $1) v`, [pr]);
      assert.equal(r.rows[0].v, false, `authenticated tem ${pr} em ${t}`);
    }
  }
  // Nenhuma coluna de respostas além de status/observacoes pode ser alterada por authenticated.
  const cols = await db.query(`
    select attname from pg_attribute where attrelid = 'public.respostas'::regclass and attnum > 0 and not attisdropped
      and has_column_privilege('authenticated', 'public.respostas', attname, 'update') order by 1`);
  assert.deepEqual(cols.rows.map((r) => r.attname), ['observacoes', 'status']);
  assert.equal((await db.query(`select has_table_privilege('authenticated', 'public.respostas', 'insert') v`)).rows[0].v, false);
});

test('segurança: não-admin não se promove a admin nem chama funções internas', async () => {
  exigirBanco();
  await criarUsuario('44444444-4444-4444-8444-444444444444', 'intruso@x.com', 'Intruso');
  const intruso = '44444444-4444-4444-8444-444444444444';
  assert.deepEqual(await rpc('authenticated', intruso, 'garantir_primeiro_admin'), { ok: true, admin: false });
  await rejeita(logado(intruso, `insert into public.admins (user_id, nome) values ($1, 'x')`, [intruso]), /row-level security/);
  assert.equal((await logado(intruso, `update public.admins set user_id = $1`, [intruso])).rowCount, 0);
  assert.equal((await logado(intruso, `delete from public.admins`)).rowCount, 0);
  await rejeita(logado(intruso, `select disc_interno.gerar_protocolo()`), /permission denied/);
  await rejeita(logado(intruso, `truncate public.respostas`), /permission denied/);
  // JWT forjado com sub de um admin não passa por aqui (auth.uid vem do Auth); mas um "sub" inválido não quebra nada.
  await rejeita(logado('nao-e-uuid', `select public.e_admin()`), /uuid/);
  assert.equal(await rpc('authenticated', intruso, 'e_admin'), false);
});

test('segurança: enviar_resposta trata texto malicioso como dado e ignora campos extras', async () => {
  exigirBanco();
  await db.query(`insert into public.processos (nome, codigo) values ('Adversarial', 'ADV2') on conflict (codigo) do nothing`);
  const injecao = "Robert'); drop table public.respostas; -- Silva";
  const formula = '=HYPERLINK("http://mal.example","x")';
  const p = payload({
    avaliacao: 'ADV2', nome: injecao, funcao: formula, empresa: '<script>alert(1)</script>', vaga: 'x'.repeat(5000),
    // campos que o candidato NÃO pode controlar
    status: 'aprovado', protocolo: '00A', processo_id: '00000000-0000-4000-8000-000000000000',
    observacoes: 'aprovado pelo candidato', d: 100, perfil: 'DD', clickup_sync: { ok: true }
  });
  const r = await rpc('anon', null, 'enviar_resposta', [JSON.stringify(p)]);
  assert.equal(r.ok, true, r.erro);
  const l = (await db.query(`select * from public.respostas where id = $1`, [r.id])).rows[0];
  assert.equal(l.nome, injecao);
  assert.equal(l.funcao, formula.substring(0, 80));
  assert.equal(l.vaga.length, 120);
  assert.equal(l.status, 'em_analise');
  assert.equal(l.observacoes, '');
  assert.equal(l.clickup_sync, null);
  assert.notEqual(l.perfil, 'DD');
  assert.match(l.protocolo, /^[0-9]{2}[A-HJ-NP-Z]$/);
  const proc = (await db.query(`select id from public.processos where codigo = 'ADV2'`)).rows[0].id;
  assert.equal(l.processo_id, proc);
  assert.deepEqual(Object.keys(l.payload).sort(), ['avaliacao', 'cidade', 'consentimento', 'duracaoSeg', 'email', 'empresa',
    'extras', 'fim', 'funcao', 'id', 'idade', 'inicio', 'nome', 'respostas', 'resultado', 'telefone', 'v', 'vaga', 'validacao']);
  // tabela continua lá
  assert.equal((await db.query(`select to_regclass('public.respostas') is not null v`)).rows[0].v, true);

  // tipos errados e payloads estranhos nunca derrubam a função (sempre {ok:false, erro})
  for (const ruim of ['[]', '"texto"', '123', 'null', JSON.stringify({ id: { $ne: 1 } }),
    JSON.stringify(Object.assign(payload(), { respostas: ['1234'] })),
    JSON.stringify(Object.assign(payload(), { validacao: { versao: 1, pares: 'x' } })),
    JSON.stringify(Object.assign(payload(), { id: "a' or '1'='1" })),
    JSON.stringify(Object.assign(payload(), { idade: '1e2' })),
    JSON.stringify(Object.assign(payload(), { nome: 'x'.repeat(19000) }))]) {
    const res = await rpc('anon', null, 'enviar_resposta', [ruim]);
    assert.equal(res.ok, false, ruim.substring(0, 60));
    assert.equal(typeof res.erro, 'string');
  }
  await limparRespostas();
});

test('segurança: relatorio_publico nunca devolve rascunho, nem por token parecido', async () => {
  exigirBanco();
  const pid = (await db.query(`select id from public.processos where codigo = 'ADV2'`)).rows[0].id;
  const t = (await db.query(`insert into public.relatorios (processo_id, dados, status) values ($1, '{"x":1}', 'rascunho') returning token`, [pid])).rows[0].token;
  const naoAchou = { ok: false, erro: 'Relatório não encontrado ou fora do ar.' };
  for (const tentativa of [t, t.toUpperCase(), t + ' ', ' ' + t, t.substring(0, 32), t + '%', '%' + 'a'.repeat(40)]) {
    assert.deepEqual(await rpc('anon', null, 'relatorio_publico', [tentativa]), naoAchou, tentativa);
  }
  await db.query(`delete from public.relatorios`);
});

// ---------------------------------------------------------------------------
// Formulário do processo e pessoas (migração 20261006120000_pessoas_formulario.sql)
// ---------------------------------------------------------------------------

const FORM_PADRAO = { campos: { idade: 'obrigatorio', funcao: 'opcional', empresa: 'opcional', email: 'oculto', cidade: 'oculto' }, perguntas: [] };

test('processos: formulário normalizado ao gravar e pergunta sensível recusada', async () => {
  exigirBanco();
  const cfg = (formulario) => JSON.stringify({ formulario });
  for (const texto of ['Você tem filhos?', 'Qual seu estado civil?', 'Qual sua religião?', 'Tem algum problema de saúde?',
    'Possui antecedentes criminais?', 'Qual seu gênero?']) {
    await rejeita(logado(U.dono, `insert into public.processos (nome, config) values ('X', $1)`,
      [cfg({ perguntas: [{ id: 'p1', texto: 'Qual sua pretensão salarial?' }, { id: 'p2', texto }] })]),
    new RegExp('A pergunta "' + texto.replace(/[?]/g, '\\?') + '" pede um dado sensível e não pode ser usada\\.'));
  }
  // Nem com permitirSaude/permitirAntecedentes a pergunta ao candidato passa.
  await rejeita(logado(U.dono, `insert into public.processos (nome, config) values ('X', $1)`,
    [JSON.stringify({ permitirSaude: true, formulario: { perguntas: [{ texto: 'Como está sua saúde?' }] } })]), /dado sensível/);

  const r = await logado(U.dono, `insert into public.processos (nome, codigo, config) values ('Formulário', 'FRM1', $1) returning config`, [cfg({
    campos: { idade: 'oculto', email: 'obrigatorio', cidade: 'opcional', funcao: 'talvez' },
    perguntas: [
      { id: 'p1', texto: '  Qual sua   pretensão salarial?  ', obrigatoria: true },
      { id: 'p1', texto: 'Tem disponibilidade aos sábados?', obrigatoria: 'sim' },
      { id: 'Inválido!', texto: 'Como soube da vaga?' },
      { texto: 'ok' }, 'texto solto', null,
      { id: 'carro', texto: 'Tem carro próprio?', obrigatoria: false },
      { texto: 'Pergunta seis aqui?' }, { texto: 'Pergunta sete aqui?' }
    ]
  })]);
  assert.deepEqual(r.rows[0].config.formulario, {
    campos: { idade: 'oculto', funcao: 'opcional', empresa: 'opcional', email: 'obrigatorio', cidade: 'opcional' },
    perguntas: [
      { id: 'p1', texto: 'Qual sua pretensão salarial?', obrigatoria: true },
      { id: 'p2', texto: 'Tem disponibilidade aos sábados?', obrigatoria: false },
      { id: 'p3', texto: 'Como soube da vaga?', obrigatoria: false },
      { id: 'carro', texto: 'Tem carro próprio?', obrigatoria: false },
      { id: 'p4', texto: 'Pergunta seis aqui?', obrigatoria: false }
    ]
  });
  // Formulário inválido vira o padrão; processo sem formulário não ganha a chave (dados antigos intocados).
  const ruim = await logado(U.dono, `insert into public.processos (nome, config) values ('Ruim', $1) returning id, config`, [cfg('x')]);
  assert.deepEqual(ruim.rows[0].config.formulario, FORM_PADRAO);
  const sem = await logado(U.dono, `insert into public.processos (nome, config) values ('Sem', '{"corte":70}') returning id, config`);
  assert.deepEqual(sem.rows[0].config, { corte: 70 });
  await db.query(`delete from public.processos where id in ($1, $2)`, [ruim.rows[0].id, sem.rows[0].id]);
  // avaliacao_publica devolve o formulário normalizado
  const pub = await rpc('anon', null, 'avaliacao_publica', ['frm1']);
  assert.deepEqual(pub.avaliacao.formulario, r.rows[0].config.formulario);
  assert.deepEqual(pub.formulario, r.rows[0].config.formulario);
});

test('enviar_resposta: segue o formulário do processo (obrigatórios, ocultos, e-mail e perguntas extras)', async () => {
  exigirBanco();
  await limparRespostas();
  const env = async (extra) => rpc('anon', null, 'enviar_resposta', [JSON.stringify(payload(Object.assign({ avaliacao: 'FRM1' }, extra)))]);
  const extrasOk = [{ id: 'p1', pergunta: 'texto antigo', resposta: '  R$ 3.000  ' }];
  assert.deepEqual(await env({ extras: extrasOk }), { ok: false, erro: 'Informe o e-mail.' });
  assert.deepEqual(await env({ email: 'nao-e-email', extras: extrasOk }), { ok: false, erro: 'E-mail inválido.' });
  assert.deepEqual(await env({ email: 'a@b.co' }), { ok: false, erro: 'Responda a pergunta "Qual sua pretensão salarial?".' });
  assert.deepEqual(await env({ email: 'a@b.co', extras: [{ id: 'p1', resposta: '   ' }] }),
    { ok: false, erro: 'Responda a pergunta "Qual sua pretensão salarial?".' });
  assert.deepEqual(await env({ email: 'a@b.co', extras: 'lixo' }), { ok: false, erro: 'Responda a pergunta "Qual sua pretensão salarial?".' });

  const p = payload({
    avaliacao: 'FRM1', idade: 'abc', email: ' Pessoa@Exemplo.COM ', cidade: '  Boa   Vista ',
    extras: extrasOk.concat([{ id: 'inventada', pergunta: 'X?', resposta: 'ignorar' }, { id: 'carro', resposta: 'Sim' }, { id: 'p2', resposta: '' }])
  });
  const r = await rpc('anon', null, 'enviar_resposta', [JSON.stringify(p)]);
  assert.equal(r.ok, true, r.erro);
  const l = (await db.query(`select * from public.respostas where id = $1`, [p.id])).rows[0];
  assert.equal(l.idade, null, 'idade oculta não é gravada (nem validada)');
  assert.equal(l.email, 'pessoa@exemplo.com');
  assert.equal(l.cidade, 'Boa Vista');
  assert.deepEqual(l.extras, [
    { id: 'p1', pergunta: 'Qual sua pretensão salarial?', resposta: 'R$ 3.000' },
    { id: 'carro', pergunta: 'Tem carro próprio?', resposta: 'Sim' }
  ]);
  assert.deepEqual(l.payload.extras, l.extras);
  assert.equal(l.payload.idade, null);

  // Idade opcional: pode faltar, mas se vier precisa ser válida. Função obrigatória.
  await db.query(`insert into public.processos (nome, codigo, config) values ('Opcional', 'OPC1', $1)`,
    [JSON.stringify({ formulario: { campos: { idade: 'opcional', funcao: 'obrigatorio', empresa: 'obrigatorio', cidade: 'obrigatorio' } } })]);
  const opc = (extra) => rpc('anon', null, 'enviar_resposta', [JSON.stringify(payload(Object.assign({ avaliacao: 'OPC1', cidade: 'Campinas' }, extra)))]);
  assert.deepEqual(await opc({ idade: 120 }), { ok: false, erro: 'Idade inválida: precisa ser entre 14 e 99 anos.' });
  assert.deepEqual(await opc({ funcao: '  ' }), { ok: false, erro: 'Informe a função atual ou última.' });
  assert.deepEqual(await opc({ empresa: '' }), { ok: false, erro: 'Informe a empresa atual ou última.' });
  assert.deepEqual(await opc({ cidade: '' }), { ok: false, erro: 'Informe a cidade onde mora.' });
  const semIdade = await opc({ idade: null, email: 'ignorado@x.com' });
  assert.equal(semIdade.ok, true, semIdade.erro);
  const ls = (await db.query(`select idade, email, cidade from public.respostas where id = $1`, [semIdade.id])).rows[0];
  assert.deepEqual(ls, { idade: null, email: '', cidade: 'Campinas' }, 'e-mail oculto não é gravado');
  // Link geral (sem processo): padrão de sempre (idade obrigatória).
  assert.match((await rpc('anon', null, 'enviar_resposta', [JSON.stringify(payload({ idade: null }))])).erro, /Idade não informada/);
  await limparRespostas();
  await db.query(`delete from public.processos where codigo = 'OPC1'`);
});

test('pessoas: envio liga à pessoa pelo WhatsApp, atualiza a ficha sem apagar campos e some com a última resposta', async () => {
  exigirBanco();
  await limparRespostas();
  assert.equal((await db.query(`select count(*)::int n from public.pessoas`)).rows[0].n, 0);
  const r1 = await rpc('anon', null, 'enviar_resposta', [JSON.stringify(payload({ telefone: '(11) 97777-6666', idade: 30, funcao: 'Caixa', empresa: 'Mercado' }))]);
  assert.equal(r1.ok, true, r1.erro);
  let pes = (await db.query(`select * from public.pessoas`)).rows;
  assert.equal(pes.length, 1);
  assert.deepEqual([pes[0].telefone, pes[0].nome, pes[0].idade, pes[0].funcao, pes[0].empresa, pes[0].email, pes[0].cidade],
    ['5511977776666', 'João da Silva', 30, 'Caixa', 'Mercado', '', '']);
  const criado = pes[0].criado_em;

  // Mesma pessoa (outro formato do número), outro processo com e-mail/cidade; função vazia não apaga a ficha.
  const r2 = await rpc('anon', null, 'enviar_resposta', [JSON.stringify(payload({
    avaliacao: 'FRM1', telefone: '11977776666', nome: 'João Pedro da Silva', funcao: '', empresa: '',
    email: 'joao@exemplo.com', cidade: 'Campinas', extras: [{ id: 'p1', resposta: 'A combinar' }]
  }))]);
  assert.equal(r2.ok, true, r2.erro);
  // Outra pessoa
  const r3 = await rpc('anon', null, 'enviar_resposta', [JSON.stringify(payload({ telefone: '21 96666-5555', nome: 'Maria Lima Souza' }))]);
  assert.equal(r3.ok, true, r3.erro);
  pes = (await db.query(`select * from public.pessoas order by telefone`)).rows;
  assert.equal(pes.length, 2);
  const joao = pes.find((p) => p.telefone === '5511977776666');
  assert.deepEqual([joao.nome, joao.idade, joao.funcao, joao.empresa, joao.email, joao.cidade],
    ['João Pedro da Silva', 30, 'Caixa', 'Mercado', 'joao@exemplo.com', 'Campinas'], 'ficha atualizada sem apagar com vazio');
  assert.equal(joao.criado_em.toISOString(), criado.toISOString());
  assert.ok(joao.atualizado_em >= criado);
  const ligacoes = (await db.query(`select id, pessoa_id from public.respostas order by recebido_em, id`)).rows;
  assert.equal(ligacoes.filter((x) => x.pessoa_id === joao.id).length, 2);
  // Reenvio (mesmo id) não mexe na ficha nem cria resposta
  const dup = await rpc('anon', null, 'enviar_resposta', [JSON.stringify(payload({ id: r1.id, telefone: '11977776666', nome: 'Nome Diferente Aqui', funcao: 'Outra' }))]);
  assert.equal(dup.duplicado, true);
  assert.equal((await db.query(`select nome from public.pessoas where id = $1`, [joao.id])).rows[0].nome, 'João Pedro da Silva');

  // Admin lê pessoas pelo PostgREST (embutido); anon e não-admin não.
  const viaAdmin = await logado(U.dono, `select r.id, p.nome from public.respostas r join public.pessoas p on p.id = r.pessoa_id`);
  assert.equal(viaAdmin.rowCount, 3);
  assert.equal((await logado(U.outro, `select * from public.pessoas`)).rowCount, 0);
  await rejeita(anon(`select * from public.pessoas`), /permission denied/);
  await rejeita(logado(U.dono, `update public.pessoas set nome = 'X Y'`), /permission denied/);
  await rejeita(logado(U.dono, `insert into public.pessoas (telefone) values ('5511900000000')`), /permission denied/);
  await rejeita(logado(U.dono, `update public.respostas set pessoa_id = null`), /permission denied/);

  // Exclusão: a ficha fica enquanto houver resposta; sai junto com a última (admin pelo painel).
  await logado(U.dono, `delete from public.respostas where id = $1`, [r1.id]);
  assert.equal((await db.query(`select count(*)::int n from public.pessoas where id = $1`, [joao.id])).rows[0].n, 1);
  await logado(U.dono, `delete from public.respostas where id = $1`, [r2.id]);
  assert.equal((await db.query(`select count(*)::int n from public.pessoas where id = $1`, [joao.id])).rows[0].n, 0);
  // Excluir todos: nenhuma ficha sobra.
  await logado(U.dono, `delete from public.respostas where id <> ''`);
  assert.equal((await db.query(`select count(*)::int n from public.pessoas`)).rows[0].n, 0);
});

test('pessoas: resposta gravada sem pessoa (importação/versão antiga) é ligada pelo gatilho sem sobrescrever a ficha', async () => {
  exigirBanco();
  await limparRespostas();
  const r = await rpc('anon', null, 'enviar_resposta', [JSON.stringify(payload({ telefone: '11955554444', funcao: '', empresa: 'Atual' }))]);
  assert.equal(r.ok, true, r.erro);
  await db.query(`insert into public.respostas (id, nome, telefone, idade, funcao, empresa, respostas, recebido_em)
    values ('import-0001', 'Nome Antigo Importado', '(11) 95555-4444', 22, 'Estagiário', 'Antiga', repeat('1234', 25), now() - interval '1 year'),
           ('import-0002', 'Outra Pessoa Importada', '5511944443333', null, '', '', repeat('1234', 25), now() - interval '1 year'),
           ('import-0003', 'Sem Telefone Importado', '', null, '', '', repeat('1234', 25), now() - interval '1 year')`);
  const l = (await db.query(`select id, pessoa_id from public.respostas order by id`)).rows;
  const p1 = (await db.query(`select * from public.pessoas where telefone = '5511955554444'`)).rows[0];
  assert.equal(l.find((x) => x.id === 'import-0001').pessoa_id, p1.id);
  assert.equal(l.find((x) => x.id === r.id).pessoa_id, p1.id);
  assert.equal(l.find((x) => x.id === 'import-0003').pessoa_id, null);
  assert.deepEqual([p1.nome, p1.idade, p1.funcao, p1.empresa], ['João da Silva', 30, 'Estagiário', 'Atual'], 'importação só preenche o que estava vazio');
  assert.equal((await db.query(`select count(*)::int n from public.pessoas`)).rows[0].n, 2);
  await limparRespostas();
  assert.equal((await db.query(`select count(*)::int n from public.pessoas`)).rows[0].n, 0);
  await db.query(`delete from public.processos where codigo = 'FRM1'`);
});

test('rodar a migração antiga de novo depois da nova não perde a ligação com a pessoa (e a nova volta a valer)', async () => {
  exigirBanco();
  await limparRespostas();
  await db.query(MIGRACAO);
  const r = await rpc('anon', null, 'enviar_resposta', [JSON.stringify(payload({ telefone: '11933332222' }))]);
  assert.equal(r.ok, true, r.erro);
  const l = (await db.query(`select r.pessoa_id, p.telefone from public.respostas r join public.pessoas p on p.id = r.pessoa_id where r.id = $1`, [r.id])).rows[0];
  assert.equal(l.telefone, '5511933332222');
  await db.query(MIGRACAO_PESSOAS);
  await db.query(MIGRACAO_EQUIPES);
  assert.ok((await rpc('anon', null, 'avaliacao_publica', ['PUB1'])).formulario);
  await limparRespostas();
  assert.equal((await db.query(`select count(*)::int n from public.pessoas`)).rows[0].n, 0);
});
