// InfinitePay (Checkout Integrado) na Edge Function "pagamento" (criar/confirmar/status) e na "infinitepay-webhook",
// com a InfinitePay e o Resend simulados por um fetch falso e o banco por um supabase-js falso (adaptador criarDbVendas).
import test from 'node:test';
import assert from 'node:assert/strict';
import { criarSupabaseFalso } from './apoio.js';
import {
  atenderPagamento, atenderWebhookInfinitePay, criarDbVendas, provedorPagamento, limitarDados, urlRetornoInfinitePay,
  lerEnvVendas, MSG_PAG_NAO_CONFIGURADO
} from '../../supabase/funcoes-compartilhadas/pagamento.js';
import {
  INFINITEPAY_API, normalizarHandle, infinitepayMetodo, centavosInfinitePay, lerRefsInfinitePay, refInfinitePay
} from '../../supabase/funcoes-compartilhadas/infinitepay.js';

const SITE = 'https://disc.gestaosemcaos.com.br';
const SUPA = 'https://falso.supabase.co';
const ID = '0b6f7f1e-8a7d-4c1b-9a50-2a8c7c1d0e01';
const ID2 = '0b6f7f1e-8a7d-4c1b-9a50-2a8c7c1d0e02';
const TOKEN = 'a'.repeat(64);
const TOKEN2 = 'b'.repeat(64);
const AGORA = Date.parse('2026-10-05T15:00:00Z');
const CHECKOUT = 'https://checkout.infinitepay.io/notus/abc123';

function pedidoLinha(extra) {
  return Object.assign({
    id: ID, resposta_id: 'resp-000001', pacote: 'completo', valor_centavos: 2900, cupom: null, status: 'aguardando', metodo: '',
    asaas_cobranca_id: null, pagamento: null, email: 'bia@exemplo.com', nome: 'Bia Souza Lima', token_acesso: TOKEN,
    criado_em: '2026-10-05T14:59:00Z', pago_em: null, verificado_em: null,
    provedor: null, provedor_ref: null, checkout_url: null, provedor_dados: null
  }, extra || {});
}

/**
 * InfinitePay + Resend falsos. op.pagamentos[order_nsu] = {paid, amount, paid_amount, capture_method, transaction_nsu?}
 * (o payment_check só responde paid=true se transaction_nsu/slug baterem). op.link(corpo) -> {status, corpo} sobrepõe.
 */
function criarFetchIP(op) {
  op = op || {};
  const chamadas = [];
  const pagamentos = op.pagamentos || {};
  async function f(url, o) {
    o = o || {};
    const corpo = o.body ? JSON.parse(o.body) : undefined;
    chamadas.push({ url: String(url), metodo: String(o.method || 'GET'), corpo });
    const resp = (status, c) => new Response(typeof c === 'string' ? c : JSON.stringify(c), { status });
    if (String(url) === 'https://api.resend.com/emails') return resp(200, { id: 'em_1' });
    if (String(url) === INFINITEPAY_API + '/links') {
      if (op.link) { const r = op.link(corpo); if (r) return resp(r.status, r.corpo); }
      return resp(200, { url: CHECKOUT + '-' + chamadas.filter((c) => c.url.endsWith('/links')).length });
    }
    if (String(url) === INFINITEPAY_API + '/payment_check') {
      if (op.checkFalha) return resp(503, 'fora');
      const pg = pagamentos[corpo.order_nsu];
      if (!pg || corpo.handle !== 'notus' || (pg.transaction_nsu && pg.transaction_nsu !== corpo.transaction_nsu) ||
          (pg.slug && pg.slug !== corpo.slug)) {
        return resp(200, { success: false, paid: false });
      }
      return resp(200, Object.assign({ success: true, installments: 1 }, pg));
    }
    throw new Error('teste: chamada externa inesperada para ' + url);
  }
  f.chamadas = chamadas;
  f.pagamentos = pagamentos;
  return f;
}

function montar(op) {
  op = op || {};
  const sb = criarSupabaseFalso({ tabelas: { pedidos: op.pedidos || [pedidoLinha()], limites_vendas: [] } });
  const fetch = criarFetchIP(op.fetch);
  let relogio = AGORA;
  const base = {
    env: Object.assign({ SITE_URL: SITE, SUPABASE_URL: SUPA, INFINITEPAY_HANDLE: '$notus', RESEND_API_KEY: 're_teste' }, op.env || {}),
    fetch,
    agora: () => relogio,
    db: criarDbVendas(sb.createClient('u', 'service'))
  };
  return {
    sb, fetch, base,
    avancar(ms) { relogio += ms; },
    pedido: (id) => sb.st.tabelas.pedidos.find((p) => p.id === (id || ID)),
    checks: () => fetch.chamadas.filter((c) => c.url.endsWith('/payment_check')).length,
    emails: () => fetch.chamadas.filter((c) => c.url === 'https://api.resend.com/emails').length,
    async post(corpo) {
      const r = await atenderPagamento(new Request('https://x/functions/v1/pagamento', {
        method: 'POST', headers: { 'content-type': 'application/json', origin: SITE }, body: JSON.stringify(corpo)
      }), base);
      return r.json();
    },
    async webhook(corpo) {
      const r = await atenderWebhookInfinitePay(new Request('https://x/functions/v1/infinitepay-webhook', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo)
      }), base);
      return { status: r.status, json: await r.json() };
    }
  };
}

const webhookCorpo = (extra) => Object.assign({ order_nsu: ID, transaction_nsu: 'TX1', invoice_slug: 'SLUG1', amount: 2900,
  paid_amount: 2900, capture_method: 'pix', receipt_url: 'https://recibo.infinitepay.io/x' }, extra || {});

test('auxiliares: provedor escolhido pelos segredos, handle, método, centavos, referências, retorno', () => {
  assert.equal(provedorPagamento({ INFINITEPAY_HANDLE: 'notus', ASAAS_API_KEY: 'k' }), 'infinitepay', 'InfinitePay é o padrão');
  assert.equal(provedorPagamento({ ASAAS_API_KEY: 'k' }), 'asaas');
  assert.equal(provedorPagamento({}), '');
  assert.equal(provedorPagamento({ PAGAMENTO_PROVEDOR: 'asaas', INFINITEPAY_HANDLE: 'notus', ASAAS_API_KEY: 'k' }), 'asaas');
  assert.equal(provedorPagamento({ PAGAMENTO_PROVEDOR: 'Asaas', INFINITEPAY_HANDLE: 'notus' }), '', 'escolhido sem chave = não configurado');
  assert.equal(provedorPagamento({ PAGAMENTO_PROVEDOR: 'infinitepay', ASAAS_API_KEY: 'k' }), '');
  assert.equal(lerEnvVendas((n) => ({ INFINITEPAY_HANDLE: ' $notus ', PAGAMENTO_PROVEDOR: 'infinitepay' }[n])).INFINITEPAY_HANDLE, '$notus');
  assert.deepEqual(['$notus', ' @Notus.BR ', 'tem espaço', '', null].map(normalizarHandle), ['notus', 'Notus.BR', '', '', '']);
  assert.deepEqual(['pix', 'credit_card', 'debit_card', 'boleto', ''].map(infinitepayMetodo), ['pix', 'cartao', 'cartao', '', '']);
  assert.deepEqual([2900, '2900', 29.9, '29.00', null, 'x', -1].map(centavosInfinitePay).map((n) => (isNaN(n) ? 'NaN' : n)),
    [2900, 2900, 2990, 2900, 'NaN', 'NaN', 'NaN']);
  assert.deepEqual(lerRefsInfinitePay({ data: { order_nsu: ID, transaction_nsu: 'T', slug: 'S', capture_method: 'credit_card' } }),
    { orderNsu: ID, transactionNsu: 'T', slug: 'S', metodo: 'cartao' });
  assert.equal(refInfinitePay('<script>'), '');
  assert.equal(urlRetornoInfinitePay({ SITE_URL: SITE + '/' }, { id: ID, token_acesso: TOKEN }),
    SITE + '/meu-relatorio.html?pedido=' + ID + '#t-' + TOKEN);
  assert.deepEqual(limitarDados({ a: 1 }), { a: 1 });
  const grande = limitarDados({ x: 'a'.repeat(70000) });
  assert.equal(grande.truncado, true);
  assert.ok(JSON.stringify(grande).length < 60000);
});

test('criar: link da InfinitePay com preço em centavos, order_nsu, retorno e webhook; reaproveita o link', async () => {
  const t = montar();
  const r = await t.post({ acao: 'criar', pedidoId: ID, tokenAcesso: TOKEN });
  assert.deepEqual(r, { ok: true, provedor: 'infinitepay', redirecionarUrl: CHECKOUT + '-1', valor: 2900 });
  const link = t.fetch.chamadas.find((c) => c.url === INFINITEPAY_API + '/links').corpo;
  assert.equal(link.handle, 'notus', 'InfiniteTag sem o $');
  assert.deepEqual(link.items, [{ quantity: 1, price: 2900, description: 'Mapa de Perfil DISC — Relatório completo' }]);
  assert.ok(Number.isInteger(link.items[0].price));
  assert.equal(link.order_nsu, ID);
  assert.equal(link.redirect_url, SITE + '/meu-relatorio.html?pedido=' + ID + '#t-' + TOKEN);
  assert.equal(link.webhook_url, SUPA + '/functions/v1/infinitepay-webhook');
  assert.deepEqual(link.customer, { name: 'Bia Souza Lima', email: 'bia@exemplo.com' });
  const p = t.pedido();
  assert.deepEqual([p.provedor, p.checkout_url, p.status], ['infinitepay', CHECKOUT + '-1', 'aguardando']);
  assert.equal(p.provedor_dados.link.resposta.url, CHECKOUT + '-1', 'resposta bruta guardada');
  // De novo: mesmo link, sem chamar a InfinitePay. Passadas 12 h: link novo.
  assert.deepEqual(await t.post({ acao: 'criar', pedidoId: ID, tokenAcesso: TOKEN }), r);
  assert.equal(t.fetch.chamadas.length, 1);
  t.avancar(12 * 3600 * 1000 + 1);
  assert.equal((await t.post({ acao: 'criar', pedidoId: ID, tokenAcesso: TOKEN })).redirecionarUrl, CHECKOUT + '-2');
  // Token errado: não revela nada.
  assert.deepEqual(await t.post({ acao: 'criar', pedidoId: ID, tokenAcesso: TOKEN2 }), { ok: false, erro: 'Pedido não encontrado.' });
});

test('criar: URL em outro campo; sem SITE_URL ou sem provedor = não configurado; InfinitePay fora; pedido Asaas fica no Asaas', async () => {
  const outro = montar({ fetch: { link: () => ({ status: 200, corpo: { data: { checkout_url: 'https://checkout.infinitepay.io/y' } } }) } });
  assert.equal((await outro.post({ acao: 'criar', pedidoId: ID, tokenAcesso: TOKEN })).redirecionarUrl, 'https://checkout.infinitepay.io/y');
  const semSite = montar({ env: { SITE_URL: '' } });
  assert.deepEqual(await semSite.post({ acao: 'criar', pedidoId: ID, tokenAcesso: TOKEN }), { ok: false, erro: MSG_PAG_NAO_CONFIGURADO });
  const nada = montar({ env: { INFINITEPAY_HANDLE: '' } });
  assert.deepEqual(await nada.post({ acao: 'criar', pedidoId: ID, tokenAcesso: TOKEN }), { ok: false, erro: MSG_PAG_NAO_CONFIGURADO });
  assert.equal(nada.fetch.chamadas.length, 0);
  const fora = montar({ fetch: { link: () => ({ status: 500, corpo: { erro: 'x' } }) } });
  assert.equal((await fora.post({ acao: 'criar', pedidoId: ID, tokenAcesso: TOKEN })).erro,
    'Não foi possível gerar o pagamento agora. Tente de novo em instantes.');
  const semUrl = montar({ fetch: { link: () => ({ status: 200, corpo: { ok: true } }) } });
  assert.equal((await semUrl.post({ acao: 'criar', pedidoId: ID, tokenAcesso: TOKEN })).ok, false);
  assert.equal(semUrl.pedido().checkout_url, null);
  // Com InfinitePay E Asaas configurados, um pedido que já tem cobrança no Asaas não troca de provedor.
  const misto = montar({ env: { ASAAS_API_KEY: 'k' }, pedidos: [pedidoLinha({ provedor: 'asaas', asaas_cobranca_id: 'pay_1',
    pagamento: { pix: { qrBase64: 'Q', copiaECola: 'C', expira: '2099-01-01 00:00:00' }, cartaoUrl: 'https://asaas/i/1', vencimento: '2026-10-06' } })] });
  const m = await misto.post({ acao: 'criar', pedidoId: ID, tokenAcesso: TOKEN });
  assert.deepEqual([m.provedor, m.cartaoUrl, m.redirecionarUrl], ['asaas', 'https://asaas/i/1', undefined]);
  // Pedido já pago: não cria link.
  const pago = montar({ pedidos: [pedidoLinha({ status: 'pago' })] });
  assert.deepEqual(await pago.post({ acao: 'criar', pedidoId: ID, tokenAcesso: TOKEN }), { ok: true, status: 'pago', pago: true });
});

test('webhook: corpo falso sem confirmação no payment_check não marca; paid=true com valor certo marca (idempotente)', async () => {
  const t = montar({ pedidos: [pedidoLinha({ provedor: 'infinitepay', checkout_url: CHECKOUT })] });
  // Alguém manda um "pago" inventado: o payment_check não confirma -> continua aguardando.
  const falso = await t.webhook(webhookCorpo());
  assert.deepEqual([falso.status, falso.json], [200, { ok: true, feito: false, motivo: 'nao_pago' }]);
  assert.equal(t.pedido().status, 'aguardando');
  assert.equal(t.pedido().provedor_dados.webhook.corpo.transaction_nsu, 'TX1', 'corpo bruto guardado para depuração');
  // O payment_check confirma, mas com valor menor: não marca.
  t.fetch.pagamentos[ID] = { paid: true, amount: 2900, paid_amount: 100, capture_method: 'pix', transaction_nsu: 'TX1' };
  assert.equal((await t.webhook(webhookCorpo())).json.motivo, 'valor_menor');
  assert.equal(t.pedido().status, 'aguardando');
  // Confirma com o valor certo: pago, método pix, referência e e-mail.
  t.fetch.pagamentos[ID].paid_amount = 2900;
  const ok = await t.webhook(webhookCorpo({ paid_amount: 1 }));
  assert.deepEqual([ok.status, ok.json], [200, { ok: true, feito: true, motivo: 'pago' }]);
  const p = t.pedido();
  assert.deepEqual([p.status, p.metodo, p.provedor_ref], ['pago', 'pix', 'TX1']);
  assert.equal(p.provedor_dados.conferencia.resposta.paid, true);
  const check = t.fetch.chamadas.filter((c) => c.url.endsWith('/payment_check')).pop().corpo;
  assert.deepEqual(check, { handle: 'notus', order_nsu: ID, transaction_nsu: 'TX1', slug: 'SLUG1' });
  assert.equal(t.emails(), 1);
  // Reenvio: nada muda, sem nova conferência nem e-mail.
  const antes = t.checks();
  assert.deepEqual((await t.webhook(webhookCorpo())).json, { ok: true, feito: false, motivo: 'repetido' });
  assert.equal(t.checks(), antes);
  assert.equal(t.emails(), 1);
});

test('webhook: pedido inexistente, de outro provedor, sem transação, corpo inválido; falhas -> 500/502', async () => {
  const t = montar({ pedidos: [pedidoLinha({ provedor: 'infinitepay' }), pedidoLinha({ id: ID2, token_acesso: TOKEN2, provedor: 'asaas' })] });
  assert.equal((await t.webhook(webhookCorpo({ order_nsu: 'x' }))).json.motivo, 'sem_pedido');
  assert.equal((await t.webhook(webhookCorpo({ order_nsu: '0b6f7f1e-8a7d-4c1b-9a50-2a8c7c1d0e09' }))).json.motivo, 'pedido_nao_encontrado');
  assert.equal((await t.webhook(webhookCorpo({ order_nsu: ID2 }))).json.motivo, 'outro_provedor');
  assert.equal((await t.webhook({ order_nsu: ID })).json.motivo, 'sem_transacao');
  assert.equal((await t.webhook([1])).json.motivo, 'evento_invalido');
  assert.equal((await t.webhook('{')).status, 400);
  assert.equal(t.checks(), 0);
  assert.equal((await atenderWebhookInfinitePay(new Request('https://x/', { method: 'GET' }), t.base)).status, 405);
  const grande = await t.webhook({ order_nsu: ID, x: 'a'.repeat(120000) });
  assert.equal(grande.status, 413);
  // InfinitePay fora: 502 (ela reenvia). Banco fora: 500.
  const fora = montar({ pedidos: [pedidoLinha({ provedor: 'infinitepay' })], fetch: { checkFalha: true } });
  assert.equal((await fora.webhook(webhookCorpo())).status, 502);
  assert.equal(fora.pedido().status, 'aguardando');
  t.base.db.pedidoPorId = async () => { throw new Error('falha no banco'); };
  assert.equal((await t.webhook(webhookCorpo())).status, 500);
});

test('confirmar (retorno do cliente): confere e marca pago; Pix pendente fica para o status; limite de 5 s', async () => {
  const t = montar({ pedidos: [pedidoLinha({ provedor: 'infinitepay', checkout_url: CHECKOUT })] });
  // Sem token certo: nada.
  assert.equal((await t.post({ acao: 'confirmar', pedidoId: ID, tokenAcesso: TOKEN2, transactionNsu: 'TX1', slug: 'S1' })).erro,
    'Pedido não encontrado.');
  // Sem referências: só devolve o status.
  assert.deepEqual(await t.post({ acao: 'confirmar', pedidoId: ID, tokenAcesso: TOKEN }), { ok: true, status: 'aguardando' });
  assert.equal(t.checks(), 0);
  // Ainda não pago na InfinitePay: aguardando, mas guarda transaction_nsu/slug.
  assert.deepEqual(await t.post({ acao: 'confirmar', pedidoId: ID, tokenAcesso: TOKEN, transactionNsu: 'TX1', slug: 'S1' }),
    { ok: true, status: 'aguardando' });
  assert.deepEqual([t.pedido().provedor_dados.retorno.transactionNsu, t.pedido().provedor_dados.retorno.slug], ['TX1', 'S1']);
  // Chamada repetida em menos de 5 s não chama a InfinitePay de novo.
  t.fetch.pagamentos[ID] = { paid: true, amount: 2900, paid_amount: 2900, capture_method: 'credit_card', transaction_nsu: 'TX1', slug: 'S1' };
  await t.post({ acao: 'confirmar', pedidoId: ID, tokenAcesso: TOKEN, transactionNsu: 'TX1', slug: 'S1' });
  assert.equal(t.checks(), 1);
  // status: confere de novo com as referências guardadas (a cada 15 s) e marca pago.
  t.avancar(16000);
  assert.deepEqual(await t.post({ acao: 'status', pedidoId: ID, tokenAcesso: TOKEN }), { ok: true, status: 'pago' });
  assert.deepEqual([t.pedido().status, t.pedido().metodo, t.pedido().provedor_ref], ['pago', 'cartao', 'TX1']);
  assert.equal(t.emails(), 1);
  // Depois de pago: confirmar só lê o banco.
  const antes = t.checks();
  assert.deepEqual(await t.post({ acao: 'confirmar', pedidoId: ID, tokenAcesso: TOKEN, transactionNsu: 'TX1', slug: 'S1' }),
    { ok: true, status: 'pago' });
  assert.equal(t.checks(), antes);
});

test('confirmar: valor menor não libera; referências inválidas ignoradas; pedido sem InfinitePay não confere', async () => {
  const t = montar({ pedidos: [pedidoLinha({ provedor: 'infinitepay' }), pedidoLinha({ id: ID2, token_acesso: TOKEN2, provedor: 'asaas' })] });
  t.fetch.pagamentos[ID] = { paid: true, amount: 100, paid_amount: 100, capture_method: 'pix' };
  assert.deepEqual(await t.post({ acao: 'confirmar', pedidoId: ID, tokenAcesso: TOKEN, transactionNsu: 'TX1', slug: 'S1' }),
    { ok: true, status: 'aguardando' });
  assert.equal(t.pedido().status, 'aguardando');
  t.avancar(6000);
  assert.deepEqual(await t.post({ acao: 'confirmar', pedidoId: ID, tokenAcesso: TOKEN, transactionNsu: '<x>', slug: 'a b' }),
    { ok: true, status: 'aguardando' });
  assert.equal(t.fetch.chamadas.filter((c) => c.url.endsWith('/payment_check')).pop().corpo.transaction_nsu, 'TX1', 'usa as guardadas');
  assert.deepEqual(await t.post({ acao: 'confirmar', pedidoId: ID2, tokenAcesso: TOKEN2, transactionNsu: 'TX1' }), { ok: true, status: 'aguardando' });
  assert.equal(t.checks(), 2);
  // InfinitePay fora no retorno: responde o status atual (o "status" tenta de novo depois).
  const fora = montar({ pedidos: [pedidoLinha({ provedor: 'infinitepay' })], fetch: { checkFalha: true } });
  assert.deepEqual(await fora.post({ acao: 'confirmar', pedidoId: ID, tokenAcesso: TOKEN, transactionNsu: 'TX7' }), { ok: true, status: 'aguardando' });
  assert.equal(fora.pedido().provedor_dados.retorno.transactionNsu, 'TX7');
});

test('banco sem a migração 20261012: lê com as colunas antigas e o Asaas continua funcionando', async () => {
  const sb = criarSupabaseFalso({ tabelas: { pedidos: [pedidoLinha({ status: 'pago' })], limites_vendas: [] } });
  const cliente = sb.createClient('u', 'service');
  const de = cliente.from.bind(cliente);
  let tentativas = 0;
  cliente.from = (t) => {
    const q = de(t);
    const sel = q.select.bind(q);
    q.select = (cols) => {
      if (typeof cols === 'string' && cols.includes('provedor')) {
        tentativas++;
        return { eq: () => ({ limit: () => Promise.resolve({ data: null, error: { code: '42703', message: 'column pedidos.provedor does not exist' } }) }) };
      }
      return sel(cols);
    };
    return q;
  };
  const db = criarDbVendas(cliente);
  assert.equal((await db.pedidoPorId(ID)).status, 'pago');
  assert.equal((await db.pedidoPorId(ID)).status, 'pago');
  assert.equal(tentativas, 1, 'só tenta as colunas novas uma vez');
});
