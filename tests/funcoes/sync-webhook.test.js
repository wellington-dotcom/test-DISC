// Edge Functions "disc-sync" e "clickup-webhook" com banco e ClickUp falsos. Nenhuma chamada real.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { gas, fixtures, criarFetch, criarDbFalso, linhaProcesso, UUID_PROC, TOKEN_CU } from './apoio.js';
import { atenderDiscSync, atenderWebhookClickUp } from '../../supabase/funcoes-compartilhadas/http.js';
import { hmacSha256Hex, assinaturaValida } from '../../supabase/funcoes-compartilhadas/webhook.js';
import { DISC_RELATORIO, DISC_CONFIABILIDADE } from '../../supabase/funcoes-compartilhadas/motores-gerado.js';

const SITE = 'https://disc.gestaosemcaos.com.br';
const SEGREDO = 'segredo-do-webhook';

function preparar(op) {
  op = op || {};
  const cuFalso = gas.criarClickUpFalso({ listas: { L1: op.lista || gas.listaExemplo() } });
  const payload = fixtures.payloadValido({ id: 'ana-envio-001', nome: 'Ana Paula Souza', telefone: '11988881111' });
  const db = criarDbFalso({
    processos: [linhaProcesso(op.processo)],
    respostas: [{ id: 'ana-envio-001', processo_id: UUID_PROC, avaliacao: 'RCP2', nome: 'Ana Paula Souza', telefone: '5511988881111',
      respostas: payload.respostas, validacao: null, protocolo: '47K', clickup_sync: null }]
  });
  let relogio = Date.parse('2026-10-05T12:00:00Z');
  const base = {
    env: Object.assign({ CLICKUP_TOKEN: TOKEN_CU, SITE_URL: SITE, CLICKUP_WEBHOOK_SECRET: SEGREDO }, op.env),
    fetch: criarFetch(cuFalso), db, dormir: async () => {}, agora: () => relogio,
    motor: DISC_RELATORIO, confiabilidade: DISC_CONFIABILIDADE
  };
  const sync = async (corpo, extra) => {
    const resp = await atenderDiscSync(new Request('https://x/disc-sync', { method: 'POST', headers: { origin: SITE },
      body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo) }), Object.assign({}, base, extra));
    return { status: resp.status, json: await resp.json(), cors: resp.headers.get('access-control-allow-origin') };
  };
  const webhook = async (evento, assinatura) => {
    const corpo = JSON.stringify(evento);
    const sig = assinatura === undefined ? createHmac('sha256', SEGREDO).update(corpo).digest('hex') : assinatura;
    const resp = await atenderWebhookClickUp(new Request('https://x/clickup-webhook', { method: 'POST',
      headers: sig === null ? {} : { 'x-signature': sig }, body: corpo }), base);
    return { status: resp.status, json: await resp.json() };
  };
  return { cuFalso, db, base, sync, webhook, avancar: (ms) => { relogio += ms; } };
}

test('disc-sync: grava o DISC na tarefa uma vez só, responde só {ok} e guarda clickup_sync', async () => {
  const { sync, db, cuFalso } = preparar();
  const r = await sync({ id: 'ana-envio-001' });
  assert.deepEqual(r.json, { ok: true });
  assert.equal(r.cors, SITE);
  const ana = cuFalso.listas.L1.tarefas.find((t) => t.id === 't1');
  assert.equal(ana.valores.f_dPerfil, 'DI');
  assert.equal(ana.valores.f_dCod, '47K');
  const s = db.st.respostas[0].clickup_sync;
  assert.equal(s.estado, 'ok');
  assert.equal(s.ok, true);
  assert.equal(s.tarefaId, 't1');
  assert.equal(s.criada, false);
  const antes = cuFalso.requisicoes.length;
  assert.deepEqual((await sync({ id: 'ana-envio-001' })).json, { ok: true });
  assert.equal(cuFalso.requisicoes.length, antes, 'segunda chamada não fala com o ClickUp');
  // id que não existe ou inválido: nada vaza
  assert.deepEqual((await sync({ id: 'nao-existe-123' })).json, { ok: true });
  const inval = await sync({ id: 'a b' });
  assert.equal(inval.status, 400);
  assert.equal(inval.json.erro, 'Identificador do envio inválido.');
  assert.equal((await sync('{x')).status, 400);
});

test('disc-sync: chamadas simultâneas criam no máximo uma tarefa; erro no ClickUp fica registrado e pode tentar de novo', async () => {
  const { sync, db, cuFalso } = preparar();
  db.st.respostas[0].telefone = '5531955554444';
  db.st.respostas[0].nome = 'Diego Ramos';
  await Promise.all([sync({ id: 'ana-envio-001' }), sync({ id: 'ana-envio-001' }), sync({ id: 'ana-envio-001' })]);
  assert.equal(cuFalso.listas.L1.tarefas.filter((t) => t.name === 'Diego Ramos (DISC)').length, 1);
  assert.equal(db.st.respostas[0].clickup_sync.criada, true);

  const b = preparar();
  b.cuFalso.falha = (q) => (q.metodo === 'post' ? { codigo: 500, corpo: { err: 'fora do ar' } } : null);
  assert.deepEqual((await b.sync({ id: 'ana-envio-001' })).json, { ok: true });
  assert.equal(b.db.st.respostas[0].clickup_sync.estado, 'erro');
  assert.match(b.db.st.respostas[0].clickup_sync.erro, /o ClickUp respondeu 500/);
  const avisos = JSON.parse(b.db.st.configuracoes.clickup_avisos);
  assert.match(avisos[0].aviso, /Envio 47K: não foi possível gravar no ClickUp/);
  b.cuFalso.falha = null;
  await b.sync({ id: 'ana-envio-001' });
  assert.equal(b.db.st.respostas[0].clickup_sync.estado, 'ok');
});

test('disc-sync: sem processo/lista não faz nada; sem CLICKUP_TOKEN registra; trava velha é retomada', async () => {
  const a = preparar({ processo: { clickup_list_id: null } });
  await a.sync({ id: 'ana-envio-001' });
  assert.equal(a.db.st.respostas[0].clickup_sync, null);
  assert.equal(a.cuFalso.requisicoes.length, 0);

  const b = preparar({ env: { CLICKUP_TOKEN: '' } });
  await b.sync({ id: 'ana-envio-001' });
  assert.match(b.db.st.respostas[0].clickup_sync.erro, /CLICKUP_TOKEN/);

  const c = preparar();
  c.db.st.respostas[0].clickup_sync = { estado: 'sincronizando', ok: false, em: '2026-10-05T11:58:00.000Z' };
  await c.sync({ id: 'ana-envio-001' });
  assert.equal(c.db.st.respostas[0].clickup_sync.estado, 'sincronizando', 'trava recente: outro chamador está trabalhando');
  c.avancar(10 * 60 * 1000);
  await c.sync({ id: 'ana-envio-001' });
  assert.equal(c.db.st.respostas[0].clickup_sync.estado, 'ok');

  // com EdgeRuntime.waitUntil: responde antes de terminar
  const d = preparar();
  let pendente = null;
  const r = await d.sync({ id: 'ana-envio-001' }, { emSegundoPlano: (p) => { pendente = p; } });
  assert.deepEqual(r.json, { ok: true });
  await pendente;
  assert.equal(d.db.st.respostas[0].clickup_sync.estado, 'ok');
});

test('webhook: assinatura HMAC-SHA256 obrigatória (sem segredo 503; errada 401)', async () => {
  assert.equal(await hmacSha256Hex('k', 'abc'), createHmac('sha256', 'k').update('abc').digest('hex'));
  assert.equal(await assinaturaValida('k', 'abc', createHmac('sha256', 'k').update('abc').digest('hex').toUpperCase()), true);
  assert.equal(await assinaturaValida('k', 'abd', createHmac('sha256', 'k').update('abc').digest('hex')), false);
  assert.equal(await assinaturaValida('', 'abc', 'x'), false);
  const { webhook, base } = preparar();
  assert.equal((await webhook({ event: 'taskStatusUpdated', task_id: 'tb' }, 'ab'.repeat(32))).status, 401);
  assert.equal((await webhook({ event: 'taskStatusUpdated', task_id: 'tb' }, null)).status, 401);
  base.env.CLICKUP_WEBHOOK_SECRET = '';
  assert.equal((await webhook({ event: 'taskStatusUpdated', task_id: 'tb' })).status, 503);
  const get = await atenderWebhookClickUp(new Request('https://x/', { method: 'GET' }), base);
  assert.equal(get.status, 405);
});

test('webhook: Briefing em "gerar relatório" -> rascunho, comentário e "relatório em revisão"; repetição e outros eventos ignorados', async () => {
  const { webhook, db, cuFalso, avancar } = preparar();
  const evento = { event: 'taskStatusUpdated', task_id: 'tb', webhook_id: 'w1',
    history_items: [{ field: 'status', before: { status: 'novo' }, after: { status: 'gerar relatório' } }] };
  assert.deepEqual((await webhook(evento)).json, { ok: true });
  assert.equal(db.st.relatorios.length, 1);
  assert.equal(db.st.relatorios[0].status, 'rascunho');
  assert.equal(db.st.relatorios[0].processo_id, UUID_PROC);
  const briefing = cuFalso.listas.L1.tarefas.find((t) => t.id === 'tb');
  assert.deepEqual(briefing.comentarios, ['Rascunho pronto para revisão no painel']);
  assert.equal(briefing.status, 'relatório em revisão');

  // ClickUp reenviando o mesmo evento (status voltou por algum motivo): não duplica em 2 min
  briefing.status = 'gerar relatório';
  await webhook(evento);
  assert.equal(db.st.relatorios.length, 1);
  avancar(3 * 60 * 1000);
  await webhook(evento);
  assert.equal(db.st.relatorios.length, 2);

  // outros eventos / status / tarefas não fazem nada
  const n = db.st.relatorios.length;
  await webhook({ event: 'taskCreated', task_id: 'tb' });
  await webhook({ event: 'taskStatusUpdated', task_id: 'tb', history_items: [{ field: 'status', after: { status: 'concluído' } }] });
  await webhook({ event: 'taskStatusUpdated', task_id: 't1', history_items: [{ field: 'status', after: { status: 'gerar relatório' } }] });
  assert.equal(db.st.relatorios.length, n);
});

test('webhook: lista sem processo ativo é ignorada; sem status "relatório em revisão" só comenta; erro vira aviso', async () => {
  const a = preparar({ processo: { ativo: false } });
  await a.webhook({ event: 'taskStatusUpdated', task_id: 'tb' });
  assert.equal(a.db.st.relatorios.length, 0);

  const lista = gas.listaExemplo();
  lista.statuses = lista.statuses.filter((s) => s.status !== 'relatório em revisão');
  const b = preparar({ lista });
  await b.webhook({ event: 'taskStatusUpdated', task_id: 'tb' });
  const briefing = b.cuFalso.listas.L1.tarefas.find((t) => t.id === 'tb');
  assert.equal(b.db.st.relatorios.length, 1);
  assert.equal(briefing.status, 'gerar relatório');
  assert.ok(!b.cuFalso.requisicoes.some((q) => q.metodo === 'put'));

  const c = preparar();
  c.cuFalso.falha = (q) => (/\/field$/.test(q.url) ? { codigo: 500, corpo: { err: 'boom' } } : null);
  assert.deepEqual((await c.webhook({ event: 'taskStatusUpdated', task_id: 'tb' })).json, { ok: true });
  assert.equal(c.db.st.relatorios.length, 0);
  assert.match(JSON.parse(c.db.st.configuracoes.clickup_avisos)[0].aviso, /^Gatilho do processo "Recepcionista 2026": o ClickUp respondeu 500/);
});
