'use strict';
// Testes da migração 20261011120000_vendas.sql (venda direta B2C: resposta pessoal, pacotes, cupons, pedidos)
// num Postgres 17 EMBUTIDO, com as 7 migrações aplicadas EM SEQUÊNCIA sobre dados "de produção" das anteriores.
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
const MIGRACOES = ['20261005120000_disc', '20261006120000_pessoas_formulario', '20261007120000_empresas_equipes',
  '20261008120000_parte2', '20261009120000_fotos', '20261010120000_mover_versao', '20261011120000_vendas'];
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
    const dir = path.join(os.tmpdir(), 'disc-pg-vendas-' + crypto.randomBytes(6).toString('hex'));
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

test('as 7 migrações em sequência sobre dados antigos: idempotente; respostas antigas viram origem processo', async () => {
  exigirBanco();
  for (let i = 0; i < 6; i++) await db.query(SQL[i]);
  await db.query(`insert into public.processos (codigo, nome) values ('VELH', 'Velho')`);
  await db.query(`insert into public.respostas (id, avaliacao, processo_id, nome, telefone, idade, respostas)
    select 'antigo-vd', 'VELH', p.id, 'Clara Antiga Reis', '11955554444', 30, repeat('1234', 25) from public.processos p where p.codigo = 'VELH'`);
  await db.query(SQL[6]);
  await db.query(SQL[6]);
  await db.query(`insert into auth.users (id, email) values ($1, 'admin@x.com'), ($2, 'outro@x.com')`, [ADMIN, OUTRO]);
  await db.query(`insert into public.admins (user_id, nome) values ($1, 'Admin')`, [ADMIN]);

  const r = await linha('antigo-vd');
  assert.equal(r.origem, 'processo');
  assert.equal(r.token_resumo, null);
  assert.deepEqual((await db.query(`select chave, preco_centavos, preco_lancamento_centavos from public.pacotes order by ordem`)).rows,
    [{ chave: 'gratis', preco_centavos: 0, preco_lancamento_centavos: null },
      { chave: 'completo', preco_centavos: 3900, preco_lancamento_centavos: 2900 },
      { chave: 'completo_plus', preco_centavos: 6900, preco_lancamento_centavos: 4900 }]);
  // Preço mudado no painel não volta ao padrão ao rodar a migração de novo.
  await db.query(`update public.pacotes set preco_centavos = 4500 where chave = 'completo'`);
  await db.query(SQL[6]);
  assert.equal((await db.query(`select preco_centavos from public.pacotes where chave = 'completo'`)).rows[0].preco_centavos, 4500);
  await db.query(`update public.pacotes set preco_centavos = 3900 where chave = 'completo'`);

  const v = await rpcAnon('versao_banco');
  assert.deepEqual(v, { ok: true, versao: 20261011120000, migracoes: MIGRACOES, faltando: [] });
  // O envio do processo seletivo continua funcionando.
  const e = await rpcAnon('enviar_resposta', payloadValido({ id: 'proc-depois-vd', avaliacao: 'VELH', telefone: '11966661111' }));
  assert.equal(e.ok, true, e.erro);
  assert.match(e.protocolo, /^[0-9]{2}[A-HJ-NP-Z]$/);
  assert.equal((await linha('proc-depois-vd')).origem, 'processo');
});

test('enviar_resposta_pessoal: e-mail obrigatório, WhatsApp opcional, sem processo/protocolo; token aleatório; reenvio', async () => {
  exigirBanco();
  assert.equal((await enviarPessoal({ email: '' })).erro, 'Informe o seu e-mail.');
  assert.equal((await enviarPessoal({ email: 'nao-email' })).erro, 'E-mail inválido.');
  assert.equal((await enviarPessoal({ telefone: '123' })).erro, 'WhatsApp inválido. Informe DDD + número.');
  assert.equal((await enviarPessoal({ consentimento: false })).erro, 'É necessário aceitar o uso dos dados para participar.');
  assert.equal((await enviarPessoal({ nome: 'Bia' })).erro, 'Informe o nome completo (nome e sobrenome).');
  assert.equal((await enviarPessoal({ exigido: '1111' })).erro, 'Respostas da segunda parte inválidas.');

  const p = pessoal({ email: 'Bia.Souza@Exemplo.com', idade: 'abc', avaliacao: 'VELH', foto: 'lixo' });
  const r = await rpcAnon('enviar_resposta_pessoal', p);
  assert.equal(r.ok, true, r.erro);
  assert.equal(r.protocolo, '');
  assert.match(r.tokenResumo, /^[0-9a-f]{64}$/);
  const l = await linha(r.id);
  assert.equal(l.origem, 'pessoal');
  assert.equal(l.processo_id, null);
  assert.equal(l.avaliacao, '');
  assert.equal(l.protocolo, null);
  assert.equal(l.telefone, '');
  assert.equal(l.pessoa_id, null, 'sem WhatsApp não cria ficha');
  assert.equal(l.idade, null);
  assert.equal(l.email, 'bia.souza@exemplo.com');
  assert.equal(l.token_resumo, r.tokenResumo);
  assert.equal(l.payload.origem, 'pessoal');
  // Reenvio do mesmo id (mesmo e-mail): mesmo token; outro e-mail: recusa sem vazar nada.
  assert.deepEqual(await rpcAnon('enviar_resposta_pessoal', p),
    { ok: true, duplicado: true, id: r.id, protocolo: '', tokenResumo: r.tokenResumo });
  assert.equal((await rpcAnon('enviar_resposta_pessoal', Object.assign({}, p, { email: 'outra@x.com' }))).erro, 'Identificador do envio inválido.');
  // enviar_resposta (processo) com o id de uma resposta pessoal não devolve nada dela.
  assert.equal((await rpcAnon('enviar_resposta', payloadValido({ id: r.id }))).erro, 'Identificador do envio inválido.');
  // Tokens diferentes a cada envio.
  const r2 = await enviarPessoal({ telefone: '(11) 97777-6666', exigido: EXIGIDO });
  assert.equal(r2.ok, true, r2.erro);
  assert.notEqual(r2.tokenResumo, r.tokenResumo);
  const l2 = await linha(r2.id);
  assert.equal(l2.telefone, '5511977776666');
  assert.ok(l2.pessoa_id, 'com WhatsApp a ficha é criada/ligada');
  assert.equal(l2.exigido, EXIGIDO);
});

test('enviar_resposta_pessoal: limites por e-mail e não conta nos limites do recrutamento', async () => {
  exigirBanco();
  const email = 'limite@exemplo.com';
  assert.equal((await enviarPessoal({ email })).ok, true);
  assert.equal((await enviarPessoal({ email })).ok, true);
  assert.equal((await enviarPessoal({ email })).erro, 'Muitos envios em pouco tempo. Aguarde um minuto e tente de novo.');
  await db.query(`update public.respostas set recebido_em = now() - interval '2 hours' where email = $1`, [email]);
  for (let i = 0; i < 18; i++) {
    await db.query(`insert into public.respostas (id, nome, respostas, email, origem, recebido_em)
      values ($1, 'Lim Ite', repeat('1234', 25), $2, 'pessoal', now() - interval '3 hours')`, ['limite-' + i, email]);
  }
  assert.equal((await enviarPessoal({ email })).erro, 'Limite de testes por dia para este e-mail atingido. Tente de novo amanhã.');
  // 45 respostas pessoais recentes não travam o envio do processo seletivo (limite de 40 por 10 minutos).
  for (let i = 0; i < 45; i++) {
    await db.query(`insert into public.respostas (id, nome, respostas, email, origem) values ($1, 'Mui Tos', repeat('1234', 25), 'm@x.com', 'pessoal')`,
      ['muitos-' + i]);
  }
  const e = await rpcAnon('enviar_resposta', payloadValido({ id: 'proc-com-pessoais', avaliacao: 'VELH', telefone: '11966662222' }));
  assert.equal(e.ok, true, e.erro);
  await db.query(`delete from public.respostas where id like 'muitos-%' or id like 'limite-%'`);
});

test('resumo_pessoal e pacotes_publicos: só o resumo (primeiro nome), nada de e-mail/telefone', async () => {
  exigirBanco();
  const r = await enviarPessoal({ nome: 'Carlos Eduardo Lima', telefone: '11988887777', email: 'carlos@x.com' });
  const s = await rpcAnon('resumo_pessoal', r.tokenResumo);
  assert.equal(s.ok, true);
  assert.equal(s.nome, 'Carlos');
  assert.deepEqual(Object.keys(s.resultado), ['percentuais', 'codigo']);
  assert.equal(s.resultado.codigo, 'DI');
  assert.equal(s.temParte2, false);
  const texto = JSON.stringify(s);
  for (const proibido of ['carlos@x.com', '5511988887777', 'Lima', r.id]) assert.ok(!texto.includes(proibido), proibido);
  assert.equal((await rpcAnon('resumo_pessoal', 'a'.repeat(64))).erro, 'Resultado não encontrado. Faça o teste de novo.');
  assert.equal((await rpcAnon('resumo_pessoal', "' or 1=1 --")).ok, false);

  const pc = await rpcAnon('pacotes_publicos');
  assert.deepEqual(pc.pacotes.map((p) => [p.chave, p.valorCentavos, p.emLancamento]),
    [['gratis', 0, false], ['completo', 2900, true], ['completo_plus', 4900, true]]);
  assert.ok(Array.isArray(pc.pacotes[1].descricao.itens));
  // Lançamento vencido volta ao preço cheio; pacote desativado some.
  await db.query(`update public.pacotes set lancamento_ate = current_date - 2 where chave = 'completo'`);
  await db.query(`update public.pacotes set ativo = false where chave = 'completo_plus'`);
  const pc2 = await rpcAnon('pacotes_publicos');
  assert.deepEqual(pc2.pacotes.map((p) => [p.chave, p.valorCentavos]), [['gratis', 0], ['completo', 3900]]);
  assert.equal((await rpcAnon('criar_pedido', r.tokenResumo, 'completo_plus', null)).erro, 'Pacote indisponível. Escolha outro.');
  await db.query(`update public.pacotes set lancamento_ate = null, ativo = true`);
});

test('criar_pedido + pagamento: aguardando não libera; pago libera; estorno bloqueia; idempotente', async () => {
  exigirBanco();
  const r = await enviarPessoal({ nome: 'Dora Paga Silva', email: 'dora@x.com' });
  assert.equal((await rpcAnon('criar_pedido', r.tokenResumo, 'gratis', null)).erro, 'Este pacote é gratuito: o seu resumo já está liberado.');
  assert.equal((await rpcAnon('criar_pedido', 'f'.repeat(64), 'completo', null)).erro, 'Resultado não encontrado. Faça o teste de novo.');
  const p = await rpcAnon('criar_pedido', r.tokenResumo, 'completo', null);
  assert.equal(p.ok, true, p.erro);
  assert.deepEqual([p.valor, p.valorOriginal, p.gratuito, p.status], [2900, 2900, false, 'aguardando']);
  assert.match(p.tokenAcesso, /^[0-9a-f]{64}$/);
  assert.notEqual(p.tokenAcesso, r.tokenResumo);
  // Mesmo pedido de novo: não duplica.
  const p2 = await rpcAnon('criar_pedido', r.tokenResumo, 'completo', '');
  assert.equal(p2.pedidoId, p.pedidoId);
  const pe = await pedido(p.pedidoId);
  assert.deepEqual([pe.email, pe.nome, pe.resposta_id], ['dora@x.com', 'Dora Paga Silva', r.id]);

  // Situação: precisa do id E do token.
  assert.deepEqual(await rpcAnon('status_pedido', p.pedidoId, p.tokenAcesso), { ok: true, status: 'aguardando', pacote: 'completo' });
  assert.equal((await rpcAnon('status_pedido', p.pedidoId, r.tokenResumo)).erro, 'Pedido não encontrado.');
  assert.equal((await rpcAnon('status_pedido', 'x', p.tokenAcesso)).erro, 'Pedido não encontrado.');
  // Relatório só depois de pago.
  assert.deepEqual(await rpcAnon('relatorio_pessoal', p.tokenAcesso), { ok: false, erro: 'Pagamento ainda não confirmado.', status: 'aguardando' });
  assert.equal((await rpcAnon('relatorio_pessoal', r.tokenResumo)).ok, false, 'o token do resumo não abre o relatório');

  // Edge Function (service_role) marca pago: só de aguardando/cancelado (idempotente).
  const marcar = () => marcarComoServico(`update public.pedidos set status = 'pago', metodo = 'pix'
    where id = $1 and status in ('aguardando', 'cancelado') returning id`, [p.pedidoId]);
  assert.equal((await marcar()).rowCount, 1);
  assert.equal((await marcar()).rowCount, 0);
  const pago = await pedido(p.pedidoId);
  assert.ok(pago.pago_em);
  const rel = await rpcAnon('relatorio_pessoal', p.tokenAcesso);
  assert.equal(rel.ok, true, rel.erro);
  assert.equal(rel.nome, 'Dora');
  assert.equal(rel.pacote, 'completo');
  assert.equal(rel.precisaParte2, false);
  assert.equal(rel.exigido, null);
  assert.ok(!JSON.stringify(rel).includes('dora@x.com'));
  // Comprar de novo o mesmo pacote: devolve o pedido pago.
  const de = await rpcAnon('criar_pedido', r.tokenResumo, 'completo', null);
  assert.deepEqual([de.pedidoId, de.jaPago, de.status], [p.pedidoId, true, 'pago']);
  // Parte 2 só no completo_plus.
  assert.equal((await rpcAnon('salvar_parte2_pessoal', p.tokenAcesso, EXIGIDO)).erro, 'A Parte 2 faz parte do pacote Completo + Parte 2.');

  // Estorno (webhook): relatório volta a bloqueado; não volta a "pago" por evento atrasado.
  await marcarComoServico(`update public.pedidos set status = 'estornado' where id = $1 and status in ('pago', 'cortesia')`, [p.pedidoId]);
  assert.ok((await pedido(p.pedidoId)).reembolsado_em);
  assert.equal((await rpcAnon('relatorio_pessoal', p.tokenAcesso)).erro, 'Esta compra foi estornada. O relatório não está mais disponível.');
  assert.equal((await marcar()).rowCount, 0);
  // Identificação do pedido não muda.
  await rejeita(marcarComoServico(`update public.pedidos set token_acesso = $2 where id = $1`, [p.pedidoId, 'a'.repeat(64)]), /identificação não pode mudar/);
});

test('cupons: 100% vira cortesia; percentual e valor; pacote, validade, esgotado; uso conta uma vez; Parte 2', async () => {
  exigirBanco();
  await cupom('LANCA100', { valor: 100, usos_max: 1 });
  await cupom('DEZ', { valor: 10 });
  await cupom('MENOS5', { tipo: 'valor', valor: 500, pacotes: ['completo'] });
  await cupom('VELHO', { valor: 50, valido_ate: '2020-01-01' });
  await cupom('DESLIGADO', { valor: 50, ativo: false });
  const r = await enviarPessoal({ nome: 'Eva Cupom Lima', email: 'eva@x.com' });
  const t = r.tokenResumo;
  const d = await rpcAnon('criar_pedido', t, 'completo', ' dez ');
  assert.deepEqual([d.valor, d.valorOriginal, d.gratuito], [2610, 2900, false]);
  assert.equal((await pedido(d.pedidoId)).cupom, 'DEZ');
  assert.equal((await rpcAnon('criar_pedido', t, 'completo', 'menos5')).valor, 2400);
  for (const c of ['NAOEXISTE', 'VELHO', 'DESLIGADO', 'x']) assert.equal((await rpcAnon('criar_pedido', t, 'completo', c)).erro, 'Cupom inválido ou expirado.', c);
  assert.equal((await rpcAnon('criar_pedido', t, 'completo_plus', 'MENOS5')).erro, 'Cupom inválido ou expirado.', 'cupom de outro pacote');

  const g = await rpcAnon('criar_pedido', t, 'completo_plus', 'lanca100');
  assert.equal(g.ok, true, g.erro);
  assert.deepEqual([g.valor, g.gratuito, g.status], [0, true, 'cortesia']);
  const pg1 = await pedido(g.pedidoId);
  assert.deepEqual([pg1.metodo, !!pg1.pago_em], ['cupom', true]);
  assert.equal((await db.query(`select usos from public.cupons where codigo = 'LANCA100'`)).rows[0].usos, 1);
  // Esgotado (usos_max 1).
  const outra = await enviarPessoal({ email: 'outra.eva@x.com' });
  assert.equal((await rpcAnon('criar_pedido', outra.tokenResumo, 'completo', 'LANCA100')).erro, 'Cupom inválido ou expirado.');
  // Cupom com valor > 0 conta o uso quando o pedido é pago (uma vez, mesmo indo e voltando).
  await marcarComoServico(`update public.pedidos set status = 'pago' where id = $1`, [d.pedidoId]);
  await marcarComoServico(`update public.pedidos set status = 'estornado' where id = $1`, [d.pedidoId]);
  await rpcAdmin('atualizar_pedido', d.pedidoId, 'cortesia');
  assert.equal((await db.query(`select usos from public.cupons where codigo = 'DEZ'`)).rows[0].usos, 1);

  // completo_plus: precisa da Parte 2; salva uma vez; depois o relatório traz o exigido.
  let rel = await rpcAnon('relatorio_pessoal', g.tokenAcesso);
  assert.deepEqual([rel.ok, rel.pacote, rel.precisaParte2, rel.exigido], [true, 'completo_plus', true, null]);
  assert.equal((await rpcAnon('salvar_parte2_pessoal', g.tokenAcesso, '1111')).erro, 'Responda todos os grupos da segunda parte.');
  assert.deepEqual(await rpcAnon('salvar_parte2_pessoal', g.tokenAcesso, EXIGIDO), { ok: true, exigido: EXIGIDO });
  assert.equal((await rpcAnon('salvar_parte2_pessoal', g.tokenAcesso, EXIGIDO)).ok, true, 'o mesmo de novo: ok');
  assert.equal((await rpcAnon('salvar_parte2_pessoal', g.tokenAcesso, '4321'.repeat(10))).erro, 'A segunda parte já foi respondida.');
  rel = await rpcAnon('relatorio_pessoal', g.tokenAcesso);
  assert.deepEqual([rel.precisaParte2, rel.exigido], [false, EXIGIDO]);
  assert.equal((await rpcAnon('resumo_pessoal', t)).temParte2, true);
});

test('cupom: tentativas erradas demais bloqueiam; pedidos demais por hora', async () => {
  exigirBanco();
  const r = await enviarPessoal({ email: 'chuta@x.com' });
  for (let i = 0; i < 10; i++) assert.equal((await rpcAnon('criar_pedido', r.tokenResumo, 'completo', 'CHUTE' + i)).erro, 'Cupom inválido ou expirado.');
  assert.equal((await rpcAnon('criar_pedido', r.tokenResumo, 'completo', 'CHUTE99')).erro, 'Muitas tentativas de cupom. Aguarde alguns minutos.');
  const r2 = await enviarPessoal({ email: 'muitos.pedidos@x.com' });
  for (let i = 0; i < 10; i++) {
    await db.query(`insert into public.pedidos (resposta_id, pacote, valor_centavos, status) values ($1, 'completo', $2, 'aguardando')`, [r2.id, 100 + i]);
  }
  assert.equal((await rpcAnon('criar_pedido', r2.tokenResumo, 'completo', null)).erro, 'Muitos pedidos em pouco tempo. Aguarde alguns minutos.');
});

test('segurança: anon não lê tabelas nem usa funções do painel; só admin vê pedidos/cupons; pacotes só alterados', async () => {
  exigirBanco();
  for (const t of ['pedidos', 'cupons', 'pacotes', 'limites_vendas']) {
    await rejeita(anon(`select * from public.${t}`), /permission denied/);
  }
  await rejeita(anon(`select public.atualizar_pedido('x', 'pago')`), /permission denied/);
  await rejeita(anon(`select public.resumo_vendas('hoje')`), /permission denied/);
  await rejeita(anon(`select disc_interno.token_aleatorio()`), /permission denied/);
  assert.equal((await outro(`select count(*)::int n from public.pedidos`)).rows[0].n, 0, 'não admin não enxerga');
  assert.equal((await rpc('authenticated', OUTRO, 'atualizar_pedido', ['x', 'pago'])).erro, 'Sem permissão.');
  assert.equal((await rpc('authenticated', OUTRO, 'resumo_vendas', ['hoje'])).erro, 'Sem permissão.');
  assert.ok((await admin(`select count(*)::int n from public.pedidos`)).rows[0].n > 0);
  await rejeita(admin(`update public.pedidos set status = 'pago'`), /permission denied/);
  await rejeita(admin(`insert into public.pacotes (chave, nome) values ('novo', 'Novo')`), /permission denied/);
  await admin(`update public.pacotes set preco_lancamento_centavos = 1900 where chave = 'completo'`);
  await rejeita(admin(`update public.pacotes set chave = 'outro' where chave = 'completo'`), /permission denied/);
  await admin(`update public.pacotes set preco_lancamento_centavos = 2900 where chave = 'completo'`);
  await rejeita(admin(`insert into public.cupons (codigo, tipo, valor) values ('RUIM', 'percentual', 150)`), /cupons_/);
  await rejeita(admin(`insert into public.cupons (codigo, tipo, valor) values ('mi nus', 'valor', 100)`), /cupons_codigo_check/);
  // As funções públicas novas são as únicas executáveis por anon (além das antigas).
  const f = await db.query(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute') order by 1`);
  assert.deepEqual(f.rows.map((x) => x.proname), ['avaliacao_publica', 'criar_pedido', 'enviar_resposta', 'enviar_resposta_pessoal',
    'pacotes_publicos', 'relatorio_pessoal', 'relatorio_publico', 'resumo_pessoal', 'salvar_parte2_pessoal', 'status_pedido', 'versao_banco']);
});

test('atualizar_pedido (painel): transições permitidas; resumo_vendas; excluir a resposta não apaga o pedido', async () => {
  exigirBanco();
  const r = await enviarPessoal({ nome: 'Fabi Painel Reis', email: 'fabi@x.com' });
  const p = await rpcAnon('criar_pedido', r.tokenResumo, 'completo', null);
  assert.match((await rpcAdmin('atualizar_pedido', p.pedidoId, 'estornado')).erro, /Não dá para mudar este pedido de "aguardando" para "estornado"/);
  const pago = await rpcAdmin('atualizar_pedido', p.pedidoId, 'pago');
  assert.equal(pago.ok, true, pago.erro);
  assert.deepEqual([pago.pedido.status, pago.pedido.metodo, pago.pedido.email], ['pago', 'manual', 'fabi@x.com']);
  assert.ok(pago.pedido.pagoEm);
  const est = await rpcAdmin('atualizar_pedido', p.pedidoId, 'estornado');
  assert.ok(est.pedido.reembolsadoEm);
  assert.equal((await rpcAdmin('atualizar_pedido', p.pedidoId, 'cortesia')).pedido.status, 'cortesia');
  assert.equal((await rpcAdmin('atualizar_pedido', 'nao-uuid', 'pago')).erro, 'Pedido não encontrado.');

  const p2 = await rpcAnon('criar_pedido', r.tokenResumo, 'completo_plus', null);
  await marcarComoServico(`update public.pedidos set status = 'pago' where id = $1`, [p2.pedidoId]);
  const v = await rpcAdmin('resumo_vendas', 'hoje');
  assert.equal(v.ok, true, v.erro);
  assert.ok(v.hoje.vendas >= 1);
  assert.ok(v.receitaCentavos >= 4900);
  assert.ok(v.resumos >= 1 && v.conversao > 0 && v.conversao <= 1);
  assert.ok(v.porPacote.some((x) => x.pacote === 'completo_plus' && x.receitaCentavos >= 4900));
  assert.equal((await rpcAdmin('resumo_vendas', 'semana')).erro, 'Período inválido.');
  assert.equal((await rpcAdmin('resumo_vendas', 'tudo')).ok, true);

  // LGPD: excluir a resposta mantém o pedido (registro financeiro), sem relatório.
  await admin(`delete from public.respostas where id = $1`, [r.id]);
  assert.equal((await pedido(p2.pedidoId)).resposta_id, null);
  assert.equal((await rpcAnon('relatorio_pessoal', p2.tokenAcesso)).erro, 'As respostas deste relatório foram excluídas. Fale com o suporte.');
});
