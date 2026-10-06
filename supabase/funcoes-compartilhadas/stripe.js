// Cliente mínimo da API REST do Stripe (PaymentIntents + Payment Element no NOSSO site), sem SDK e sem nada do Deno:
// recebe fetch por parâmetro (testável no Node com respostas falsas). Corpo form-encoded, como a API do Stripe pede.
//
// Segredos (Supabase > Edge Functions > Secrets; NUNCA no código nem em conversa):
//   STRIPE_SECRET_KEY       chave do servidor. Recomendado: chave RESTRITA (rk_test_… / rk_live_…) só com PaymentIntents
//                           (escrita), PaymentMethods (leitura), Balance (leitura) e Payment method domains (leitura); a secreta
//                           (sk_…) também funciona, mas abre a conta inteira se vazar. Só o servidor usa.
//   STRIPE_PUBLISHABLE_KEY  chave publicável (pk_…): vai para o navegador montar o Payment Element (é pública).
//   STRIPE_WEBHOOK_SECRET   "Signing secret" do endpoint de webhook (whsec_…): confere a assinatura Stripe-Signature.
//
//   POST /v1/payment_intents (Idempotency-Key)  amount (centavos), currency=brl, automatic_payment_methods[enabled]=true,
//        description, statement_descriptor_suffix, metadata[pedido_id], receipt_email -> {id, client_secret, status, amount}
//   GET  /v1/payment_intents/:id[?expand[]=payment_method] -> {status, amount, amount_received, currency, metadata, …}
//   GET  /v1/balance (teste leve da chave)  ·  GET /v1/payment_method_domains?domain_name=… (Apple Pay / Google Pay)
// Assinatura do webhook: Stripe-Signature "t=<unix>,v1=<hex>[,v1=…]"; v1 = HMAC-SHA256(segredo, `${t}.${corpo bruto}`).
// Conferida com Web Crypto (crypto.subtle.verify: comparação em tempo constante) e tolerância de 5 minutos.
// Versão da API FIXA (cabeçalho Stripe-Version): mudar a versão padrão da conta no painel do Stripe não muda nada aqui.
// Para atualizar: troque STRIPE_VERSAO, rode os testes e confira um pagamento de teste na aba Conexões.

export const STRIPE_API = 'https://api.stripe.com';
export const STRIPE_VERSAO = '2026-08-26.dahlia';
export const STRIPE_TOLERANCIA_S = 300;
export const STRIPE_DESCRICAO = 'Mapa DISC — Gestão sem Caos';
export const STRIPE_SUFIXO_FATURA = 'MAPA DISC';
// Situações em que o mesmo PaymentIntent ainda pode ser pago (é reaproveitado).
export const STRIPE_ABERTOS = ['requires_payment_method', 'requires_confirmation', 'requires_action', 'processing'];
const STRIPE_TIMEOUT_MS = 15000;
const RE_INTENT_STRIPE = /^pi_[A-Za-z0-9]{6,80}$/;
const RE_SEGREDO_CLIENTE = /^pi_[A-Za-z0-9]{6,80}_secret_[A-Za-z0-9]{6,120}$/;
const RE_PUBLICAVEL = /^pk_(?:test|live)_[A-Za-z0-9]{8,200}$/;

/** Chave de servidor: 'restrita' (rk_) | 'secreta' (sk_) | '' (outra coisa). Não devolve a chave. */
export function tipoChaveStripe(chave) {
  const s = String(chave == null ? '' : chave).trim();
  if (/^rk_(?:test|live)_/.test(s)) return 'restrita';
  if (/^sk_(?:test|live)_/.test(s)) return 'secreta';
  return '';
}

/** Recusa do PaymentIntent (last_payment_error) -> {codigo, motivo, tipo, metodo, mensagem} | null. Sem dados do cartão. */
export function recusaStripe(pi) {
  const e = pi && pi.last_payment_error;
  if (!e || typeof e !== 'object') return null;
  const t = (v, n) => String(v == null ? '' : v).substring(0, n);
  const pm = e.payment_method && typeof e.payment_method === 'object' ? e.payment_method.type : '';
  return { codigo: t(e.code, 60), motivo: t(e.decline_code, 60), tipo: t(e.type, 40), metodo: t(pm, 30), mensagem: semChavesStripe(t(e.message, 200)) };
}

/** "pi_…" válido ou ''. */
export function idIntentStripe(v) {
  const s = String(v == null ? '' : v).trim();
  return RE_INTENT_STRIPE.test(s) ? s : '';
}

/** client_secret do PaymentIntent (vai para o navegador) válido ou ''. */
export function segredoClienteStripe(v) {
  const s = String(v == null ? '' : v).trim();
  return RE_SEGREDO_CLIENTE.test(s) ? s : '';
}

/** Chave publicável (prefixo pk_ + test_ ou live_) válida ou ''. */
export function chavePublicavelStripe(v) {
  const s = String(v == null ? '' : v).trim();
  return RE_PUBLICAVEL.test(s) ? s : '';
}

/** Modo pela chave (secreta ou publicável): 'teste' | 'producao' | '' (formato desconhecido). Não devolve a chave. */
export function modoStripe(chave) {
  const s = String(chave == null ? '' : chave).trim();
  if (/^(?:sk|rk|pk)_test_/.test(s)) return 'teste';
  if (/^(?:sk|rk|pk)_live_/.test(s)) return 'producao';
  return '';
}

/** Tira qualquer chave do Stripe de um texto (rede de segurança das mensagens de erro). */
export function semChavesStripe(texto) {
  return String(texto == null ? '' : texto).replace(/\b(?:sk|rk|whsec)_[A-Za-z0-9_]{4,}/g, '***');
}

/** Objeto -> corpo form-encoded do Stripe (aninhado com colchetes: metadata[pedido_id]=…). */
export function formStripe(obj) {
  const partes = [];
  function add(prefixo, v) {
    if (v === undefined || v === null || v === '') return;
    if (Array.isArray(v)) { v.forEach((x, i) => add(prefixo + '[' + i + ']', x)); return; }
    if (typeof v === 'object') { Object.keys(v).forEach((k) => add(prefixo + '[' + k + ']', v[k])); return; }
    partes.push(encodeURIComponent(prefixo) + '=' + encodeURIComponent(String(v)));
  }
  Object.keys(obj || {}).forEach((k) => add(k, obj[k]));
  return partes.join('&');
}

/** Forma de pagamento usada -> pedidos.metodo ('pix' | 'cartao' | 'boleto' | ''). Apple Pay e Google Pay são cartão. */
export function stripeMetodo(pi) {
  const x = pi && typeof pi === 'object' ? pi : {};
  let tipo = '';
  if (x.payment_method && typeof x.payment_method === 'object') tipo = String(x.payment_method.type || '');
  if (!tipo && x.latest_charge && typeof x.latest_charge === 'object' && x.latest_charge.payment_method_details) {
    tipo = String(x.latest_charge.payment_method_details.type || '');
  }
  if (!tipo && Array.isArray(x.payment_method_types) && x.payment_method_types.length === 1) tipo = String(x.payment_method_types[0]);
  if (tipo === 'pix') return 'pix';
  if (tipo === 'card' || tipo === 'link') return 'cartao';
  if (tipo === 'boleto') return 'boleto';
  return '';
}

/** Cabeçalho Stripe-Signature -> {t (número), v1: [hex]} */
export function lerAssinaturaStripe(cabecalho) {
  const r = { t: NaN, v1: [] };
  String(cabecalho || '').split(',').forEach((parte) => {
    const i = parte.indexOf('=');
    if (i < 0) return;
    const k = parte.slice(0, i).trim();
    const v = parte.slice(i + 1).trim();
    if (k === 't' && /^\d{1,12}$/.test(v)) r.t = Number(v);
    else if (k === 'v1' && /^[0-9a-f]{64}$/i.test(v)) r.v1.push(v.toLowerCase());
  });
  return r;
}

function cryptoStripe() {
  const c = typeof globalThis !== 'undefined' ? globalThis.crypto : null;
  if (!c || !c.subtle) throw new Error('Web Crypto indisponível');
  return c.subtle;
}

function hexParaBytes(hex) {
  const b = new Uint8Array(hex.length / 2);
  for (let i = 0; i < b.length; i++) b[i] = parseInt(hex.substr(i * 2, 2), 16);
  return b;
}

/** HMAC-SHA256 em hex (para montar assinaturas nos testes). */
export async function hmacStripeHex(segredo, texto) {
  const sub = cryptoStripe();
  const enc = new TextEncoder();
  const chave = await sub.importKey('raw', enc.encode(String(segredo)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await sub.sign('HMAC', chave, enc.encode(String(texto))));
  return Array.from(sig, (x) => x.toString(16).padStart(2, '0')).join('');
}

/**
 * Confere a assinatura do webhook. {corpo (texto bruto), cabecalho, segredo, agoraMs, toleranciaS?}
 * -> {ok:true} | {ok:false, motivo:'sem_segredo'|'sem_assinatura'|'expirada'|'invalida'}
 * Comparação em tempo constante: crypto.subtle.verify (Web Crypto) com cada v1 recebido.
 */
export async function verificarAssinaturaStripe(op) {
  const segredo = String((op && op.segredo) || '');
  if (!segredo) return { ok: false, motivo: 'sem_segredo' };
  const a = lerAssinaturaStripe(op.cabecalho);
  if (!isFinite(a.t) || !a.v1.length) return { ok: false, motivo: 'sem_assinatura' };
  const tol = Number(op.toleranciaS) > 0 ? Number(op.toleranciaS) : STRIPE_TOLERANCIA_S;
  const agoraS = Math.floor(Number(op.agoraMs) / 1000);
  if (!isFinite(agoraS) || Math.abs(agoraS - a.t) > tol) return { ok: false, motivo: 'expirada' };
  const sub = cryptoStripe();
  const enc = new TextEncoder();
  const chave = await sub.importKey('raw', enc.encode(segredo), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const dados = enc.encode(a.t + '.' + String(op.corpo == null ? '' : op.corpo));
  let ok = false;
  for (const v of a.v1) {
    // Todas as assinaturas são conferidas (sem sair cedo): o tempo não depende de qual bateu.
    if (await sub.verify('HMAC', chave, hexParaBytes(v), dados)) ok = true;
  }
  return ok ? { ok: true } : { ok: false, motivo: 'invalida' };
}

function erroStripe(status, json, texto) {
  const e0 = json && json.error && typeof json.error === 'object' ? json.error : {};
  const msg = semChavesStripe(e0.message || texto || '').substring(0, 200);
  const e = new Error('Stripe: HTTP ' + status + (msg ? ' ' + msg : ''));
  e.status = status;
  e.codigo = String(e0.code || '');
  e.tipo = String(e0.type || '');
  e.parametro = String(e0.param || '');
  return e;
}

/**
 * criarStripe({chave, fetch}) -> {configurado, modo, criarIntent, intent, saldo, dominio}
 * Lançam Error('Stripe: HTTP …') com e.status/e.codigo em resposta não-2xx (a mensagem nunca leva a chave).
 */
export function criarStripe(op) {
  const chave = String((op && op.chave) || '').trim();
  const fetchFn = op && op.fetch;

  async function chamar(metodo, caminho, corpo, extrasCab) {
    const controle = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controle ? setTimeout(() => controle.abort(), STRIPE_TIMEOUT_MS) : null;
    try {
      const headers = Object.assign({ Authorization: 'Bearer ' + chave, Accept: 'application/json', 'Stripe-Version': STRIPE_VERSAO, 'User-Agent': 'gestao-sem-caos-mapa-disc' }, extrasCab || {});
      const o = { method: metodo, headers, signal: controle ? controle.signal : undefined };
      if (corpo !== undefined) { headers['Content-Type'] = 'application/x-www-form-urlencoded'; o.body = formStripe(corpo); }
      const r = await fetchFn(STRIPE_API + caminho, o);
      const texto = await r.text();
      let json = null;
      try { json = texto ? JSON.parse(texto) : null; } catch (err) { json = null; }
      if (!r.ok) throw erroStripe(r.status, json, texto);
      return json && typeof json === 'object' ? json : {};
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  return {
    configurado: !!chave,
    modo: modoStripe(chave),
    /**
     * {pedidoId, valorCentavos, email?, pacote?, teste?, chaveIdempotencia, descricao?, sufixo?} -> PaymentIntent.
     * Mesmo Idempotency-Key + mesmos parâmetros = o MESMO PaymentIntent (nada é criado em dobro).
     */
    async criarIntent(d) {
      const corpo = {
        amount: Math.round(Number(d.valorCentavos) || 0),
        currency: 'brl',
        'automatic_payment_methods[enabled]': 'true',
        description: d.descricao || STRIPE_DESCRICAO,
        statement_descriptor_suffix: d.sufixo === undefined ? STRIPE_SUFIXO_FATURA : d.sufixo,
        metadata: { pedido_id: String(d.pedidoId), pacote: d.pacote ? String(d.pacote) : undefined, teste: d.teste ? 'true' : undefined, origem: 'mapa-disc' }
      };
      if (d.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(d.email))) corpo.receipt_email = String(d.email).substring(0, 120);
      const cab = d.chaveIdempotencia ? { 'Idempotency-Key': String(d.chaveIdempotencia).substring(0, 255) } : null;
      try {
        return await chamar('POST', '/v1/payment_intents', corpo, cab);
      } catch (err) {
        // Conta que não aceita o sufixo da fatura: tenta de novo sem ele (o Stripe não guarda erros de validação na idempotência).
        if (err && err.status === 400 && /statement_descriptor/.test(err.parametro + ' ' + err.message) && corpo.statement_descriptor_suffix) {
          delete corpo.statement_descriptor_suffix;
          return chamar('POST', '/v1/payment_intents', corpo, cab);
        }
        throw err;
      }
    },
    /** GET /v1/payment_intents/:id (expandir: ['payment_method'] etc.) */
    async intent(id, opcoes) {
      const pid = idIntentStripe(id);
      if (!pid) throw erroStripe(404, null, 'PaymentIntent inválido');
      const exp = (opcoes && opcoes.expandir) || [];
      const q = exp.length ? '?' + exp.map((x) => 'expand[]=' + encodeURIComponent(x)).join('&') : '';
      return chamar('GET', '/v1/payment_intents/' + pid + q);
    },
    /** GET /v1/balance (só confere se a chave é aceita; nada é criado). */
    async saldo() { return chamar('GET', '/v1/balance'); },
    /** Domínio registrado para Apple Pay / Google Pay -> {registrado, ativo, applePay, googlePay} */
    async dominio(nome) {
      const r = await chamar('GET', '/v1/payment_method_domains?limit=10&domain_name=' + encodeURIComponent(String(nome || '')));
      const lista = Array.isArray(r.data) ? r.data : [];
      const d = lista.find((x) => String(x.domain_name || '').toLowerCase() === String(nome || '').toLowerCase()) || null;
      if (!d) return { registrado: false, ativo: false, applePay: false, googlePay: false };
      const st = (o) => !!(o && typeof o === 'object' && o.status === 'active');
      return { registrado: true, ativo: d.enabled !== false, applePay: st(d.apple_pay), googlePay: st(d.google_pay) };
    }
  };
}
