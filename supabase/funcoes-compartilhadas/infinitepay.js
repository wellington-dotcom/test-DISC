// Cliente mínimo do "Checkout Integrado" da InfinitePay (CloudWalk), sem nada do Deno: recebe fetch por parâmetro
// (testável no Node com respostas falsas).
//
// A API é pública e NÃO tem chave: a conta é identificada pela InfiniteTag ("handle", sem o $), guardada no segredo
// INFINITEPAY_HANDLE (Supabase > Edge Functions > Secrets). Não é senha, mas trate como configuração (não no código).
//
//   POST https://api.checkout.infinitepay.io/links
//     {handle, items:[{quantity, price (CENTAVOS, inteiro), description}], order_nsu, redirect_url, webhook_url,
//      customer?:{name, email, phone_number}}
//     -> {url: 'https://checkout.infinitepay.io/...'}  (a página hospedada oferece Pix e cartão)
//   Ao pagar, o cliente volta para redirect_url com ?order_nsu&transaction_nsu&slug&capture_method&receipt_url.
//   O webhook (POST em webhook_url) traz order_nsu, transaction_nsu, invoice_slug/slug, amount/paid_amount,
//   capture_method, receipt_url — SEM assinatura: o corpo nunca é confiável; sempre conferir com payment_check.
//   POST https://api.checkout.infinitepay.io/payment_check {handle, order_nsu, transaction_nsu, slug}
//     -> {success, paid: bool, amount, paid_amount, installments, capture_method}
//
// SUPOSIÇÕES (a documentação oficial — https://www.infinitepay.io/checkout-documentacao — não pôde ser lida daqui):
//   * a URL do checkout vem em `url` (aceitamos também `link`, `checkout_url`, `payment_url` e os mesmos dentro de `data`);
//   * amount/paid_amount do payment_check estão em CENTAVOS (como o preço do link). Número com casas decimais é lido
//     como reais (×100). Na dúvida o pedido NÃO é liberado (valor menor que o do pedido = não pago);
//   * `paid` pode vir como booleano ou texto 'true'; `success:false` = não pago.

export const INFINITEPAY_API = 'https://api.checkout.infinitepay.io';
const INFINITEPAY_TIMEOUT_MS = 15000;
const RE_HANDLE = /^[a-z0-9._-]{1,60}$/i;
const RE_REF = /^[A-Za-z0-9._:-]{1,120}$/;

/** InfiniteTag do segredo -> handle sem "$"/"@" e sem espaços; inválida -> ''. */
export function normalizarHandle(v) {
  const h = String(v == null ? '' : v).trim().replace(/^[$@]+/, '').trim();
  return RE_HANDLE.test(h) ? h : '';
}

/** transaction_nsu / slug vindos da URL ou do webhook: só caracteres seguros; senão ''. */
export function refInfinitePay(v) {
  const s = String(v == null ? '' : v).trim();
  return RE_REF.test(s) ? s : '';
}

/** capture_method da InfinitePay -> pedidos.metodo */
export function infinitepayMetodo(v) {
  const s = String(v || '').toLowerCase();
  if (s === 'pix') return 'pix';
  if (/credit|debit|card|cartao/.test(s)) return 'cartao';
  return '';
}

/** amount/paid_amount -> centavos (inteiro). Inteiro = centavos; com casas decimais (29.9, '29.00') = reais. NaN se inválido. */
export function centavosInfinitePay(v) {
  if (v === null || v === undefined || v === '') return NaN;
  const txt = typeof v === 'string' ? v.trim().replace(',', '.') : v;
  const n = Number(txt);
  if (!isFinite(n) || n < 0) return NaN;
  const emReais = !Number.isInteger(n) || (typeof txt === 'string' && txt.indexOf('.') >= 0);
  return emReais ? Math.round(n * 100) : n;
}

/** Lê order_nsu/transaction_nsu/slug/capture_method de um corpo de webhook ou de parâmetros de retorno. */
export function lerRefsInfinitePay(o) {
  const x = o && typeof o === 'object' ? o : {};
  const dentro = x.data && typeof x.data === 'object' ? x.data : {};
  const pegar = (...nomes) => {
    for (const n of nomes) {
      if (x[n] !== undefined && x[n] !== null && x[n] !== '') return x[n];
      if (dentro[n] !== undefined && dentro[n] !== null && dentro[n] !== '') return dentro[n];
    }
    return '';
  };
  return {
    orderNsu: String(pegar('order_nsu', 'orderNsu')).trim(),
    transactionNsu: refInfinitePay(pegar('transaction_nsu', 'transactionNsu')),
    slug: refInfinitePay(pegar('invoice_slug', 'slug')),
    metodo: infinitepayMetodo(pegar('capture_method', 'captureMethod'))
  };
}

function urlDoLink(r) {
  const fontes = [r, r && typeof r.data === 'object' ? r.data : null];
  for (const f of fontes) {
    if (!f) continue;
    for (const n of ['url', 'link', 'checkout_url', 'payment_url']) {
      if (typeof f[n] === 'string' && /^https:\/\//i.test(f[n].trim())) return f[n].trim();
    }
  }
  return '';
}

function erroInfinitePay(status, texto) {
  const e = new Error('InfinitePay: HTTP ' + status + (texto ? ' ' + String(texto).substring(0, 200) : ''));
  e.status = status;
  return e;
}

/**
 * criarInfinitePay({handle, fetch}) -> {configurado, handle, criarLink, conferir}
 * Lançam Error('InfinitePay: ...') com e.status em resposta não-2xx ou sem os campos esperados.
 */
export function criarInfinitePay(op) {
  const handle = normalizarHandle(op && op.handle);
  const fetchFn = op && op.fetch;

  async function chamar(caminho, corpo) {
    const controle = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controle ? setTimeout(() => controle.abort(), INFINITEPAY_TIMEOUT_MS) : null;
    try {
      const r = await fetchFn(INFINITEPAY_API + caminho, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'gestao-sem-caos-mapa-disc' },
        body: JSON.stringify(corpo),
        signal: controle ? controle.signal : undefined
      });
      const texto = await r.text();
      let json = null;
      try { json = texto ? JSON.parse(texto) : null; } catch (err) { json = null; }
      if (!r.ok) throw erroInfinitePay(r.status, texto);
      return json && typeof json === 'object' ? json : {};
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  return {
    configurado: !!handle,
    handle,
    /**
     * {pedidoId, valorCentavos, descricao, redirectUrl, webhookUrl, cliente?:{nome, email, telefone}}
     * -> {url, bruto} (bruto = resposta da InfinitePay, para provedor_dados)
     */
    async criarLink(d) {
      const corpo = {
        handle,
        items: [{ quantity: 1, price: Math.round(Number(d.valorCentavos) || 0), description: String(d.descricao || '').substring(0, 120) }],
        order_nsu: String(d.pedidoId),
        redirect_url: d.redirectUrl,
        webhook_url: d.webhookUrl
      };
      const c = d.cliente || {};
      const customer = {};
      if (c.nome) customer.name = String(c.nome).substring(0, 120);
      if (c.email) customer.email = String(c.email).substring(0, 120);
      if (c.telefone) customer.phone_number = String(c.telefone).replace(/\D/g, '').substring(0, 20);
      if (Object.keys(customer).length) corpo.customer = customer;
      const r = await chamar('/links', corpo);
      const url = urlDoLink(r);
      if (!url) throw erroInfinitePay(200, 'resposta sem a URL do checkout');
      return { url, bruto: r };
    },
    /**
     * {pedidoId, transactionNsu, slug} -> {pago, valorCentavos (NaN se não veio), metodo, parcelas, bruto}
     * pago = success !== false e paid === true. A comparação com o valor do pedido fica com quem chama.
     */
    async conferir(d) {
      const r = await chamar('/payment_check', {
        handle, order_nsu: String(d.pedidoId), transaction_nsu: String(d.transactionNsu || ''), slug: String(d.slug || '')
      });
      const pago = r.success !== false && (r.paid === true || String(r.paid).toLowerCase() === 'true');
      const pagoCent = centavosInfinitePay(r.paid_amount);
      const valorCentavos = isFinite(pagoCent) ? pagoCent : centavosInfinitePay(r.amount);
      return { pago, valorCentavos, metodo: infinitepayMetodo(r.capture_method), parcelas: Number(r.installments) || 0, bruto: r };
    }
  };
}
