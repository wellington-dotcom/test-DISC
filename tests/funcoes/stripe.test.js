// Stripe (Payment Element dentro do site) na Edge Function "pagamento" (criar/status/confirmar), na "stripe-webhook"
// (assinatura Stripe-Signature) e na aba Conexões, com o Stripe e o Resend simulados por um fetch falso e o banco por um
// supabase-js falso (adaptador criarDbVendas). Nada sai para a rede.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { criarSupabaseFalso } from './apoio.js';
import {
  atenderPagamento, atenderWebhookStripe, criarDbVendas, provedorPagamento, tratarEventoStripe
} from '../../supabase/funcoes-compartilhadas/pagamento.js';
import {
  STRIPE_API, formStripe, modoStripe, stripeMetodo, lerAssinaturaStripe, verificarAssinaturaStripe, hmacStripeHex,
  idIntentStripe, segredoClienteStripe, chavePublicavelStripe, semChavesStripe, criarStripe, STRIPE_VERSAO, tipoChaveStripe, recusaStripe
} from '../../supabase/funcoes-compartilhadas/stripe.js';
import { acaoTestar, acaoDiagnostico } from '../../supabase/funcoes-compartilhadas/conexoes.js';

const SITE = 'https://disc.gestaosemcaos.com.br';
const SUPA = 'https://falso.supabase.co';
const ID = '0b6f7f1e-8a7d-4c1b-9a50-2a8c7c1d0e11';
const TOKEN = 'a'.repeat(64);
const AGORA = Date.parse('2026-10-14T15:00:00Z');
// Montadas por partes: o arquivo não tem nada com cara de chave de verdade.
const SK = 'sk_' + 'test_' + 'SEGREDO51Ab';
const PK = 'pk_' + 'test_' + 'PUBLICA51Ab';
const WH = 'whsec_' + 'ASSINA51Ab';

function pedidoLinha(extra) {
  return Object.assign({
    id: ID, resposta_id: 'resp-000001', pacote: 'completo', valor_centavos: 2900, cupom: null, status: 'aguardando', metodo: '',
    asaas_cobranca_id: null, pagamento: null, email: 'bia@exemplo.com', nome: 'Bia Souza Lima', token_acesso: TOKEN,
    criado_em: '2026-10-14T14:59:00Z', pago_em: null, verificado_em: null,
    provedor: null, provedor_ref: null, checkout_url: null, provedor_dados: null
  }, extra || {});
}

/** Stripe falso: guarda os PaymentIntents criados; Idempotency-Key repetida devolve o mesmo. */
function criarFetchStripe(op) {
  op = op || {};
  const chamadas = [];
  const intents = {};
  const porChave = {};
  let n = 0;
  async function f(url, o) {
    o = o || {};
    const u = String(url);
    chamadas.push({ url: u, metodo: String(o.method || 'GET'), corpo: o.body || '', headers: o.headers || {} });
    const resp = (status, c) => new Response(JSON.stringify(c), { status });
    if (u === 'https://api.resend.com/emails') return resp(200, { id: 'em_1' });
    if (!u.startsWith(STRIPE_API + '/v1/')) throw new Error('teste: chamada externa inesperada para ' + u);
    if ((o.headers || {}).Authorization !== 'Bearer ' + SK) return resp(401, { error: { type: 'invalid_request_error', message: 'Invalid API Key provided: ' + String((o.headers || {}).Authorization).slice(7) } });
    if (op.fora) return resp(503, { error: { message: 'fora' } });
    if (u === STRIPE_API + '/v1/payment_intents' && o.method === 'POST') {
      const chave = (o.headers || {})['Idempotency-Key'];
      if (chave && porChave[chave]) return resp(200, intents[porChave[chave]]);
      const p = new URLSearchParams(o.body);
      n += 1;
      const id = 'pi_Teste' + String(n).padStart(6, '0');
      intents[id] = { id, object: 'payment_intent', client_secret: id + '_secret_Xyz123', status: 'requires_payment_method',
        amount: Number(p.get('amount')), amount_received: 0, currency: p.get('currency'), metadata: { pedido_id: p.get('metadata[pedido_id]') },
        livemode: false, payment_method: null, payment_method_types: ['card', 'pix'] };
      if (chave) porChave[chave] = id;
      return resp(200, intents[id]);
    }
    if (u === STRIPE_API + '/v1/balance') return resp(200, { object: 'balance', available: [{ amount: 0, currency: 'brl' }] });
    if (u.startsWith(STRIPE_API + '/v1/payment_method_domains')) {
      return resp(200, { data: op.dominio === false ? [] : [{ domain_name: 'disc.gestaosemcaos.com.br', enabled: true, apple_pay: { status: 'active' }, google_pay: { status: 'active' } }] });
    }
    const m = /^\/v1\/payment_intents\/(pi_[A-Za-z0-9]+)/.exec(new URL(u).pathname);
    if (m && o.method === 'GET') {
      const pi = intents[m[1]];
      if (!pi) return resp(404, { error: { code: 'resource_missing', message: 'No such payment_intent' } });
      const x = JSON.parse(JSON.stringify(pi));
      if (/expand/.test(u) && x.payment_method) x.payment_method = { id: 'pm_1', type: x.payment_method };
      return resp(200, x);
    }
    throw new Error('teste: rota do Stripe inesperada ' + u);
  }
  f.chamadas = chamadas;
  f.intents = intents;
  return f;
}

function montar(op) {
  op = op || {};
  const sb = criarSupabaseFalso({ tabelas: { pedidos: op.pedidos || [pedidoLinha()], limites_vendas: [] } });
  const fetch = criarFetchStripe(op.fetch);
  let relogio = AGORA;
  const base = {
    env: Object.assign({ SITE_URL: SITE, SUPABASE_URL: SUPA, STRIPE_SECRET_KEY: SK, STRIPE_PUBLISHABLE_KEY: PK, STRIPE_WEBHOOK_SECRET: WH,
      INFINITEPAY_HANDLE: 'notus', RESEND_API_KEY: 're_teste' }, op.env || {}),
    fetch,
    agora: () => relogio,
    db: criarDbVendas(sb.createClient('u', 'service'))
  };
  return {
    sb, fetch, base,
    avancar(ms) { relogio += ms; },
    pedido: (id) => sb.st.tabelas.pedidos.find((p) => p.id === (id || ID)),
    pagar(id, extra) { Object.assign(fetch.intents[id], { status: 'succeeded', amount_received: fetch.intents[id].amount, payment_method: 'card' }, extra || {}); },
    criacoes: () => fetch.chamadas.filter((c) => c.url === STRIPE_API + '/v1/payment_intents' && c.metodo === 'POST'),
    emails: () => fetch.chamadas.filter((c) => c.url === 'https://api.resend.com/emails').length,
    async post(corpo) {
      const r = await atenderPagamento(new Request('https://x/functions/v1/pagamento', {
        method: 'POST', headers: { 'content-type': 'application/json', origin: SITE }, body: JSON.stringify(corpo)
      }), base);
      return r.json();
    },
    async webhook(evento, opWh) {
      opWh = opWh || {};
      const corpo = typeof evento === 'string' ? evento : JSON.stringify(evento);
      const ts = opWh.ts !== undefined ? opWh.ts : Math.floor(relogio / 1000);
      const sig = opWh.assinatura !== undefined ? opWh.assinatura : 't=' + ts + ',v1=' + createHmac('sha256', opWh.segredo || WH).update(ts + '.' + corpo).digest('hex');
      const headers = { 'content-type': 'application/json' };
      if (sig) headers['stripe-signature'] = sig;
      const r = await atenderWebhookStripe(new Request('https://x/functions/v1/stripe-webhook', { method: 'POST', headers, body: corpo }), base);
      return { status: r.status, json: await r.json() };
    }
  };
}

const evento = (tipo, obj) => ({ id: 'evt_' + Math.random().toString(36).slice(2), type: tipo, data: { object: obj } });

test('auxiliares: provedor padrão, modo pela chave, form-encoded, método, assinatura e validações', async () => {
  assert.equal(provedorPagamento({ STRIPE_SECRET_KEY: SK, INFINITEPAY_HANDLE: 'notus', ASAAS_API_KEY: 'k' }), 'stripe', 'Stripe é o padrão quando configurado');
  assert.equal(provedorPagamento({ INFINITEPAY_HANDLE: 'notus', ASAAS_API_KEY: 'k' }), 'infinitepay');
  assert.equal(provedorPagamento({ PAGAMENTO_PROVEDOR: 'infinitepay', STRIPE_SECRET_KEY: SK, INFINITEPAY_HANDLE: 'notus' }), 'infinitepay');
  assert.equal(provedorPagamento({ PAGAMENTO_PROVEDOR: 'Stripe', INFINITEPAY_HANDLE: 'notus' }), '', 'escolhido sem chave = não configurado');
  assert.deepEqual([SK, 'sk_' + 'live_x', PK, 'rk_' + 'live_y', 'abc', ''].map(modoStripe), ['teste', 'producao', 'teste', 'producao', '', '']);
  assert.equal(formStripe({ amount: 100, currency: 'brl', metadata: { pedido_id: 'x y' }, vazio: '', lista: ['a'] }),
    'amount=100&currency=brl&metadata%5Bpedido_id%5D=x%20y&lista%5B0%5D=a');
  assert.deepEqual([{ payment_method: { type: 'pix' } }, { payment_method: { type: 'card' } }, { payment_method_types: ['boleto'] },
    { latest_charge: { payment_method_details: { type: 'card' } } }, {}].map(stripeMetodo), ['pix', 'cartao', 'boleto', 'cartao', '']);
  assert.equal(idIntentStripe('pi_3Abc123'), 'pi_3Abc123');
  assert.equal(idIntentStripe('pi_<x>'), '');
  assert.equal(segredoClienteStripe('pi_3Abc123_secret_zz9876'), 'pi_3Abc123_secret_zz9876');
  assert.equal(segredoClienteStripe('javascript:1'), '');
  assert.equal(chavePublicavelStripe(PK), PK);
  assert.equal(chavePublicavelStripe(SK), '', 'a chave secreta nunca passa como publicável');
  assert.equal(semChavesStripe('erro ' + SK + ' e ' + WH), 'erro *** e ***');
  assert.deepEqual(lerAssinaturaStripe('t=123,v1=' + 'a'.repeat(64) + ',v0=x,v1=curta'), { t: 123, v1: ['a'.repeat(64)] });
  // Assinatura: válida, inválida, expirada, sem cabeçalho.
  const corpo = '{"id":"evt_1"}';
  const ts = Math.floor(AGORA / 1000);
  const v1 = await hmacStripeHex(WH, ts + '.' + corpo);
  assert.equal(v1, createHmac('sha256', WH).update(ts + '.' + corpo).digest('hex'));
  const conferir = (cab, agora, segredo) => verificarAssinaturaStripe({ corpo, cabecalho: cab, segredo: segredo === undefined ? WH : segredo, agoraMs: agora || AGORA });
  assert.deepEqual(await conferir('t=' + ts + ',v1=' + '0'.repeat(64) + ',v1=' + v1), { ok: true }, 'vale qualquer v1 (troca de segredo)');
  assert.deepEqual(await conferir('t=' + ts + ',v1=' + '0'.repeat(64)), { ok: false, motivo: 'invalida' });
  assert.deepEqual(await conferir('t=' + ts + ',v1=' + v1, AGORA + 301000), { ok: false, motivo: 'expirada' });
  assert.deepEqual(await conferir('t=' + ts + ',v1=' + v1, AGORA + 299000), { ok: true });
  assert.deepEqual(await conferir(''), { ok: false, motivo: 'sem_assinatura' });
  assert.deepEqual(await conferir('t=' + ts + ',v1=' + v1, AGORA, ''), { ok: false, motivo: 'sem_segredo' });
  assert.deepEqual(await verificarAssinaturaStripe({ corpo: corpo + ' ', cabecalho: 't=' + ts + ',v1=' + v1, segredo: WH, agoraMs: AGORA }), { ok: false, motivo: 'invalida' }, 'corpo alterado');
});

test('criar: PaymentIntent com centavos, brl, métodos automáticos, metadata e e-mail; idempotente e reaproveitado', async () => {
  const t = montar();
  const r = await t.post({ acao: 'criar', pedidoId: ID, tokenAcesso: TOKEN });
  assert.deepEqual(r, { ok: true, provedor: 'stripe', clientSecret: 'pi_Teste000001_secret_Xyz123', publicavel: PK, valor: 2900 });
  const c = t.criacoes()[0];
  const p = new URLSearchParams(c.corpo);
  assert.equal(p.get('amount'), '2900');
  assert.equal(p.get('currency'), 'brl');
  assert.equal(p.get('automatic_payment_methods[enabled]'), 'true');
  assert.equal(p.get('metadata[pedido_id]'), ID);
  assert.equal(p.get('receipt_email'), 'bia@exemplo.com');
  assert.equal(p.get('description'), 'Mapa DISC — Gestão sem Caos');
  assert.equal(p.get('statement_descriptor_suffix'), 'MAPA DISC');
  assert.equal(c.headers['Idempotency-Key'], 'mapa-disc-' + ID + '-2900');
  assert.equal(c.headers['Content-Type'], 'application/x-www-form-urlencoded');
  const ped = t.pedido();
  assert.deepEqual([ped.provedor, ped.provedor_ref, ped.provedor_dados.intent.id], ['stripe', 'pi_Teste000001', 'pi_Teste000001']);
  assert.ok(!JSON.stringify(ped).includes('_secret_'), 'o client_secret não é gravado no banco');
  // De novo: reaproveita (sem criar outro).
  const r2 = await t.post({ acao: 'criar', pedidoId: ID, tokenAcesso: TOKEN });
  assert.equal(r2.clientSecret, r.clientSecret);
  assert.equal(t.criacoes().length, 1);
  // Cancelado no Stripe: cria outro com outra chave de idempotência.
  t.fetch.intents.pi_Teste000001.status = 'canceled';
  const r3 = await t.post({ acao: 'criar', pedidoId: ID, tokenAcesso: TOKEN });
  assert.equal(r3.clientSecret, 'pi_Teste000002_secret_Xyz123');
  assert.equal(t.criacoes()[1].headers['Idempotency-Key'], 'mapa-disc-' + ID + '-2900-1');
  // Mesma chave de idempotência = mesmo PaymentIntent (corrida de dois cliques antes de gravar).
  const st = criarStripe({ chave: SK, fetch: t.fetch });
  const a = await st.criarIntent({ pedidoId: ID, valorCentavos: 2900, chaveIdempotencia: 'k1' });
  const b = await st.criarIntent({ pedidoId: ID, valorCentavos: 2900, chaveIdempotencia: 'k1' });
  assert.equal(a.id, b.id);
});

test('criar: sem chave publicável = não configurado; já pago = liberado; Stripe fora = mensagem amigável sem vazar chave', async () => {
  const sem = montar({ env: { STRIPE_PUBLISHABLE_KEY: '' } });
  assert.deepEqual(await sem.post({ acao: 'criar', pedidoId: ID, tokenAcesso: TOKEN }), { ok: false, erro: 'Pagamento ainda não configurado.' });
  const fora = montar({ fetch: { fora: true } });
  const r = await fora.post({ acao: 'criar', pedidoId: ID, tokenAcesso: TOKEN });
  assert.deepEqual(r, { ok: false, erro: 'Não foi possível gerar o pagamento agora. Tente de novo em instantes.' });
  const chaveErrada = montar({ env: { STRIPE_SECRET_KEY: 'sk_' + 'test_' + 'ERRADA999' } });
  const r2 = await chaveErrada.post({ acao: 'criar', pedidoId: ID, tokenAcesso: TOKEN });
  assert.ok(!JSON.stringify(r2).includes('ERRADA999'));
  const t = montar();
  await t.post({ acao: 'criar', pedidoId: ID, tokenAcesso: TOKEN });
  t.pagar('pi_Teste000001');
  assert.deepEqual(await t.post({ acao: 'criar', pedidoId: ID, tokenAcesso: TOKEN }), { ok: true, status: 'pago', pago: true });
  assert.equal(t.pedido().status, 'pago');
  assert.equal(t.pedido().metodo, 'cartao');
  assert.equal(t.emails(), 1);
  // Token errado não vê nada.
  assert.deepEqual(await t.post({ acao: 'criar', pedidoId: ID, tokenAcesso: 'b'.repeat(64) }), { ok: false, erro: 'Pedido não encontrado.' });
});

test('confirmar/status: só libera com succeeded, valor cheio, brl e o pedido certo; limite de consultas', async () => {
  const t = montar();
  await t.post({ acao: 'criar', pedidoId: ID, tokenAcesso: TOKEN });
  assert.deepEqual(await t.post({ acao: 'confirmar', pedidoId: ID, tokenAcesso: TOKEN, paymentIntent: 'pi_Teste000001' }), { ok: true, status: 'aguardando' });
  // Valor menor que o do pedido: não libera.
  t.avancar(6000);
  t.pagar('pi_Teste000001', { amount_received: 100, payment_method: 'pix' });
  assert.deepEqual(await t.post({ acao: 'confirmar', pedidoId: ID, tokenAcesso: TOKEN }), { ok: true, status: 'aguardando' });
  assert.equal(t.pedido().status, 'aguardando');
  // Metadata de outro pedido: não libera.
  t.avancar(6000);
  t.pagar('pi_Teste000001', { metadata: { pedido_id: '0b6f7f1e-8a7d-4c1b-9a50-2a8c7c1d0e99' } });
  assert.deepEqual(await t.post({ acao: 'confirmar', pedidoId: ID, tokenAcesso: TOKEN }), { ok: true, status: 'aguardando' });
  // Agora certo: Pix, valor cheio.
  t.pagar('pi_Teste000001', { metadata: { pedido_id: ID }, payment_method: 'pix' });
  assert.deepEqual(await t.post({ acao: 'confirmar', pedidoId: ID, tokenAcesso: TOKEN }), { ok: true, status: 'aguardando' }, 'menos de 5 s: não consulta de novo');
  t.avancar(6000);
  assert.deepEqual(await t.post({ acao: 'confirmar', pedidoId: ID, tokenAcesso: TOKEN }), { ok: true, status: 'pago' });
  assert.deepEqual([t.pedido().status, t.pedido().metodo, t.pedido().provedor_ref], ['pago', 'pix', 'pi_Teste000001']);

  // status: confere no Stripe no máximo a cada 15 s.
  const s = montar();
  await s.post({ acao: 'criar', pedidoId: ID, tokenAcesso: TOKEN });
  s.pagar('pi_Teste000001');
  assert.deepEqual(await s.post({ acao: 'status', pedidoId: ID, tokenAcesso: TOKEN }), { ok: true, status: 'pago' });
  const consultas = s.fetch.chamadas.filter((c) => c.metodo === 'GET').length;
  await s.post({ acao: 'status', pedidoId: ID, tokenAcesso: TOKEN });
  assert.equal(s.fetch.chamadas.filter((c) => c.metodo === 'GET').length, consultas, 'pago: não consulta mais');
});

test('stripe-webhook: assinatura válida libera (idempotente); inválida, expirada ou sem segredo é recusada', async () => {
  const t = montar();
  await t.post({ acao: 'criar', pedidoId: ID, tokenAcesso: TOKEN });
  const ev = evento('payment_intent.succeeded', { id: 'pi_Teste000001', amount: 2900, amount_received: 2900, metadata: { pedido_id: ID } });
  // O corpo do evento diz "pago", mas o Stripe (consulta) ainda não: não libera.
  const w0 = await t.webhook(ev);
  assert.deepEqual([w0.status, w0.json.motivo], [200, 'nao_pago']);
  t.pagar('pi_Teste000001');
  assert.deepEqual((await t.webhook(ev, { assinatura: 't=' + Math.floor(AGORA / 1000) + ',v1=' + 'f'.repeat(64) })).status, 400);
  assert.deepEqual((await t.webhook(ev, { assinatura: '' })).status, 400);
  assert.deepEqual((await t.webhook(ev, { ts: Math.floor(AGORA / 1000) - 600 })).json.motivo, 'expirada');
  assert.deepEqual((await t.webhook(ev, { segredo: 'whsec_' + 'OUTRO' })).status, 400);
  assert.equal(t.pedido().status, 'aguardando');
  const w = await t.webhook(ev);
  assert.deepEqual([w.status, w.json], [200, { ok: true, feito: true, motivo: 'pago' }]);
  assert.equal(t.pedido().status, 'pago');
  assert.equal(t.emails(), 1);
  const w2 = await t.webhook(ev);
  assert.deepEqual(w2.json, { ok: true, feito: false, motivo: 'repetido' });
  assert.equal(t.emails(), 1, 'reenvio não manda outro e-mail');
  // Sem segredo configurado: 503. Método errado: 405. Evento desconhecido: ignorado.
  const sem = montar({ env: { STRIPE_WEBHOOK_SECRET: '' } });
  assert.equal((await sem.webhook(ev)).status, 503);
  const get = await atenderWebhookStripe(new Request('https://x/', { method: 'GET' }), t.base);
  assert.equal(get.status, 405);
  assert.deepEqual((await t.webhook(evento('customer.created', { id: 'cus_1' }))).json, { ok: true, feito: false, motivo: 'evento_ignorado' });
});

test('stripe-webhook: valor menor não libera; Stripe fora = 502 (reenvia); pedido pelo provedor_ref sem metadata', async () => {
  const t = montar();
  await t.post({ acao: 'criar', pedidoId: ID, tokenAcesso: TOKEN });
  t.pagar('pi_Teste000001', { amount_received: 2000 });
  const ev = evento('payment_intent.succeeded', { id: 'pi_Teste000001', metadata: {} });
  assert.deepEqual((await t.webhook(ev)).json, { ok: true, feito: false, motivo: 'valor_menor' });
  assert.equal(t.pedido().status, 'aguardando');
  const f2 = montar({ fetch: { fora: true }, pedidos: [pedidoLinha({ provedor: 'stripe', provedor_ref: 'pi_Teste000001' })] });
  const w = await f2.webhook(evento('payment_intent.succeeded', { id: 'pi_Teste000001', metadata: { pedido_id: ID } }));
  assert.equal(w.status, 502);
  assert.deepEqual((await t.webhook(evento('payment_intent.succeeded', { id: 'pi_Outro999999', metadata: {} }))).json.motivo, 'pedido_nao_encontrado');
});

test('estorno e contestação: charge.refunded / charge.dispute.created -> estornado (idempotente)', async () => {
  const t = montar();
  await t.post({ acao: 'criar', pedidoId: ID, tokenAcesso: TOKEN });
  t.pagar('pi_Teste000001');
  await t.webhook(evento('payment_intent.succeeded', { id: 'pi_Teste000001', metadata: { pedido_id: ID } }));
  const r = await t.webhook(evento('charge.refunded', { id: 'ch_1', payment_intent: 'pi_Teste000001', refunded: true, metadata: {} }));
  assert.deepEqual(r.json, { ok: true, feito: true, motivo: 'estornado' });
  assert.equal(t.pedido().status, 'estornado');
  assert.deepEqual((await t.webhook(evento('charge.refunded', { id: 'ch_1', payment_intent: 'pi_Teste000001' }))).json.motivo, 'repetido');
  // Contestação (chargeback) de outro pedido pago.
  const d = montar({ pedidos: [pedidoLinha({ status: 'pago', provedor: 'stripe', provedor_ref: 'pi_Disputa1234' })] });
  const x = await d.webhook(evento('charge.dispute.created', { id: 'dp_1', charge: 'ch_9', payment_intent: 'pi_Disputa1234' }));
  assert.deepEqual(x.json, { ok: true, feito: true, motivo: 'estornado' });
  // Pedido de outro provedor não é mexido.
  const o = montar({ pedidos: [pedidoLinha({ status: 'pago', provedor: 'infinitepay', provedor_ref: 'pi_Disputa1234' })] });
  const ctx = { env: o.base.env, agora: o.base.agora, db: o.base.db, stripe: criarStripe({ chave: SK, fetch: o.fetch }) };
  assert.deepEqual(await tratarEventoStripe(ctx, evento('charge.refunded', { payment_intent: 'pi_Disputa1234', metadata: { pedido_id: ID } })),
    { ok: true, feito: false, motivo: 'outro_provedor' });
});

test('versão da API fixa em toda chamada; tipo da chave (restrita x secreta); recusa sem dados do cartão', async () => {
  const t = montar();
  await t.post({ acao: 'criar', pedidoId: ID, tokenAcesso: TOKEN });
  t.avancar(16000);
  await t.post({ acao: 'status', pedidoId: ID, tokenAcesso: TOKEN });
  const doStripe = t.fetch.chamadas.filter((c) => c.url.startsWith(STRIPE_API));
  assert.ok(doStripe.length >= 2);
  assert.match(STRIPE_VERSAO, /^\d{4}-\d{2}-\d{2}\.[a-z]+$/);
  for (const c of doStripe) assert.equal(c.headers['Stripe-Version'], STRIPE_VERSAO, c.url);
  assert.equal(tipoChaveStripe('rk_' + 'live_Abc123'), 'restrita');
  assert.equal(tipoChaveStripe('sk_' + 'test_Abc123'), 'secreta');
  assert.equal(tipoChaveStripe('pk_' + 'test_Abc123'), '');
  assert.equal(modoStripe('rk_' + 'test_Abc123'), 'teste');
  assert.equal(recusaStripe({}), null);
  assert.deepEqual(recusaStripe({ last_payment_error: { code: 'card_declined', decline_code: 'insufficient_funds', type: 'card_error',
    message: 'Your card has insufficient funds.', payment_method: { type: 'card', card: { last4: '0002' } } } }),
  { codigo: 'card_declined', motivo: 'insufficient_funds', tipo: 'card_error', metodo: 'card', mensagem: 'Your card has insufficient funds.' });
});

test('recusa: payment_intent.payment_failed guarda o motivo (pedido segue aberto); status avisa o cliente; depois paga normal', async () => {
  const t = montar();
  await t.post({ acao: 'criar', pedidoId: ID, tokenAcesso: TOKEN });
  const erroCartao = { code: 'card_declined', decline_code: 'generic_decline', type: 'card_error', message: 'Your card was declined.', payment_method: { type: 'card' } };
  Object.assign(t.fetch.intents.pi_Teste000001, { status: 'requires_payment_method', last_payment_error: erroCartao });
  const w = await t.webhook(evento('payment_intent.payment_failed', { id: 'pi_Teste000001', status: 'requires_payment_method', metadata: { pedido_id: ID }, last_payment_error: erroCartao }));
  assert.deepEqual([w.status, w.json], [200, { ok: true, feito: true, motivo: 'recusado' }]);
  assert.equal(t.pedido().status, 'aguardando');
  const rec = t.pedido().provedor_dados.recusa;
  assert.deepEqual([rec.codigo, rec.motivo, rec.intent, rec.em], ['card_declined', 'generic_decline', 'pi_Teste000001', new Date(AGORA).toISOString()]);
  assert.ok(t.pedido().provedor_dados.intent, 'mantém os dados do PaymentIntent');
  // O site, ao consultar, recebe o aviso em português (sem o texto do Stripe).
  t.avancar(16000);
  const st = await t.post({ acao: 'status', pedidoId: ID, tokenAcesso: TOKEN });
  assert.deepEqual(st, { ok: true, status: 'aguardando', recusado: true, mensagem: 'O pagamento não foi aprovado. Tente de novo ou use outra forma de pagamento.' });
  // Nova tentativa aprovada no mesmo PaymentIntent.
  t.pagar('pi_Teste000001', { last_payment_error: null });
  t.avancar(16000);
  assert.deepEqual(await t.post({ acao: 'status', pedidoId: ID, tokenAcesso: TOKEN }), { ok: true, status: 'pago' });
  // Pedido já pago / de outro provedor / desconhecido: não mexe.
  assert.deepEqual((await t.webhook(evento('payment_intent.payment_failed', { id: 'pi_Teste000001', metadata: { pedido_id: ID } }))).json.motivo, 'repetido');
  const o = montar({ pedidos: [pedidoLinha({ provedor: 'asaas', provedor_ref: 'pi_Outro000001' })] });
  assert.deepEqual((await o.webhook(evento('payment_intent.payment_failed', { id: 'pi_Outro000001', metadata: { pedido_id: ID } }))).json.motivo, 'outro_provedor');
  assert.deepEqual((await t.webhook(evento('payment_intent.payment_failed', { id: 'pi_Sumiu000001', metadata: {} }))).json.motivo, 'pedido_nao_encontrado');
});

test('nenhuma resposta (pagamento, webhook, Conexões) leva a chave secreta ou o segredo do webhook', async () => {
  const t = montar();
  const tudo = [];
  tudo.push(await t.post({ acao: 'criar', pedidoId: ID, tokenAcesso: TOKEN }));
  tudo.push(await t.post({ acao: 'status', pedidoId: ID, tokenAcesso: TOKEN }));
  tudo.push((await t.webhook(evento('payment_intent.succeeded', { id: 'pi_Teste000001', metadata: { pedido_id: ID } }))).json);
  tudo.push(t.pedido());
  const txt = JSON.stringify(tudo);
  assert.ok(!txt.includes(SK) && !txt.includes(WH), 'vazou chave');
  // Em todas as chamadas ao Stripe a chave vai só no cabeçalho Authorization (nunca na URL ou no corpo).
  t.fetch.chamadas.filter((c) => c.url.startsWith(STRIPE_API)).forEach((c) => {
    assert.ok(!c.url.includes(SK) && !c.corpo.includes(SK));
    assert.equal(c.headers.Authorization, 'Bearer ' + SK);
  });
});

// ---------------------------------------------------------------------------
// Aba Conexões: cartão "Pagamento — Stripe"
// ---------------------------------------------------------------------------

function ctxConexoes(op) {
  op = op || {};
  const fetch = criarFetchStripe(op.fetch);
  const st = { pedidos: [] };
  const db = {
    async pedidoTesteInserir(reg) {
      if (op.semMigracao) { const e = new Error('falha no banco de dados (violates check constraint "pedidos_provedor_valido")'); e.causa = { code: '23514' }; throw e; }
      const l = Object.assign({ id: '12345678-1234-4234-8234-1234567890ab', status: 'aguardando', criado_em: '2026-10-14T12:00:00Z' }, reg);
      st.pedidos.push(l);
      return { id: l.id, criado_em: l.criado_em };
    },
    async pedidoTesteLer(id) { return st.pedidos.find((p) => p.id === id && p.teste) || null; },
    async pedidoTesteUltimo() { return st.pedidos.filter((p) => p.teste).slice(-1)[0] || null; },
    async pedidoTesteAtualizar(id, campos) { const p = st.pedidos.find((x) => x.id === id && x.teste); if (p) Object.assign(p, campos); }
  };
  const env = Object.assign({ SITE_URL: SITE, SUPABASE_URL: '', STRIPE_SECRET_KEY: SK, STRIPE_PUBLISHABLE_KEY: PK, STRIPE_WEBHOOK_SECRET: WH }, op.env || {});
  return { fetch, st, ctx: { env, fetch, db, agora: () => AGORA, usuario: { email: 'dona@empresa.com' } } };
}

test('Conexões: Stripe — chave aceita (GET /v1/balance), modo pelo prefixo, domínio para Apple Pay; sem vazar', async () => {
  const { ctx, fetch } = ctxConexoes();
  const r = await acaoTestar(ctx, { alvo: 'stripe' });
  assert.equal(r.sucesso, true, r.mensagem);
  assert.match(r.mensagem, /aceitou a chave secreta \(modo teste\)\. Recomendado: troque por uma chave restrita/);
  assert.equal(r.detalhes.chaveTipo, 'secreta');
  assert.match(r.mensagem, /disc\.gestaosemcaos\.com\.br registrado \(Apple Pay ativo, Google Pay ativo\)/);
  assert.deepEqual([r.detalhes.modo, r.detalhes.dominioRegistrado, r.detalhes.applePay, r.detalhes.webhookSecreto], ['teste', true, true, true]);
  assert.ok(fetch.chamadas.some((c) => c.url === STRIPE_API + '/v1/balance'));
  assert.ok(fetch.chamadas.some((c) => c.url.includes('/v1/payment_method_domains?') && c.url.includes('domain_name=disc.gestaosemcaos.com.br')));
  assert.ok(!JSON.stringify(r).includes(SK));
  const semDominio = await acaoTestar(ctxConexoes({ fetch: { dominio: false } }).ctx, { alvo: 'stripe' });
  assert.equal(semDominio.detalhes.dominioRegistrado, false);
  assert.match(semDominio.mensagem, /não está registrado em Payment method domains/);
  const recusada = await acaoTestar(ctxConexoes({ env: { STRIPE_SECRET_KEY: 'sk_' + 'live_' + 'ERRADA777' } }).ctx, { alvo: 'stripe' });
  assert.equal(recusada.sucesso, false);
  assert.match(recusada.mensagem, /recusou a chave.*modo produção/);
  assert.ok(!JSON.stringify(recusada).includes('ERRADA777'));
  const sem = await acaoTestar(ctxConexoes({ env: { STRIPE_SECRET_KEY: '' } }).ctx, { alvo: 'stripe' });
  assert.equal(sem.mensagem, 'Segredo STRIPE_SECRET_KEY não existe.');
  // Diagnóstico: modo e domínio, nunca a chave.
  const d = await acaoDiagnostico(Object.assign({}, ctx, { env: Object.assign({}, ctx.env, { PAGAMENTO_PROVEDOR: 'stripe' }) }));
  assert.deepEqual([d.pagamento.provedor, d.pagamento.provedorEscolhido, d.pagamento.stripeModo, d.pagamento.stripePublicavelModo, d.pagamento.stripeDominio],
    ['stripe', 'stripe', 'teste', 'teste', 'disc.gestaosemcaos.com.br']);
  assert.equal(d.segredos.STRIPE_SECRET_KEY, true);
  assert.equal(d.pagamento.stripeChaveTipo, 'secreta');
  const pk = await acaoTestar(ctxConexoes({ env: { STRIPE_SECRET_KEY: PK } }).ctx, { alvo: 'stripe' });
  assert.match(pk.mensagem, /não parece uma chave de servidor/);
  assert.ok(!JSON.stringify(d).includes(SK) && !JSON.stringify(d).includes(WH));
});

test('Conexões: pagamento de teste de R$ 1,00 (pedido teste, fora das vendas) e verificação; sem a migração avisa', async () => {
  const { ctx, fetch, st } = ctxConexoes();
  const r = await acaoTestar(ctx, { alvo: 'stripe.pagamento' });
  assert.equal(r.sucesso, true, r.mensagem);
  assert.deepEqual([r.detalhes.valorCentavos, r.detalhes.publicavel, r.detalhes.modo], [100, PK, 'teste']);
  assert.match(r.detalhes.clientSecret, /^pi_Teste000001_secret_/);
  assert.equal(r.detalhes.retornoUrl, SITE + '/admin.html?conexoes=teste&provedor=stripe&pedido=' + st.pedidos[0].id);
  const p = st.pedidos[0];
  assert.deepEqual([p.teste, p.valor_centavos, p.provedor, p.provedor_ref, p.provedor_dados.teste], [true, 100, 'stripe', 'pi_Teste000001', true]);
  const corpo = new URLSearchParams(fetch.chamadas.find((c) => c.metodo === 'POST').corpo);
  assert.deepEqual([corpo.get('amount'), corpo.get('metadata[teste]')], ['100', 'true']);
  const v = await acaoTestar(ctx, { alvo: 'stripe.verificar', pedidoId: p.id });
  assert.deepEqual([v.sucesso, v.detalhes.pago], [true, false]);
  fetch.intents.pi_Teste000001.status = 'succeeded';
  fetch.intents.pi_Teste000001.amount_received = 100;
  fetch.intents.pi_Teste000001.payment_method = 'card';
  const v2 = await acaoTestar(ctx, { alvo: 'stripe.verificar' });
  assert.deepEqual([v2.sucesso, v2.detalhes.pago], [true, true]);
  assert.deepEqual([p.status, p.metodo], ['pago', 'cartao']);
  const sem = await acaoTestar(ctxConexoes({ semMigracao: true }).ctx, { alvo: 'stripe.pagamento' });
  assert.equal(sem.sucesso, false);
  assert.match(sem.mensagem, /20261014120000_stripe/);
  const semPk = await acaoTestar(ctxConexoes({ env: { STRIPE_PUBLISHABLE_KEY: '' } }).ctx, { alvo: 'stripe.pagamento' });
  assert.equal(semPk.sucesso, false);
});
