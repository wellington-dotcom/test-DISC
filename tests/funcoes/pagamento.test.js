// Edge Functions da venda direta: "pagamento" (criar/status/recuperar) e "asaas-webhook", com o Asaas e o Resend
// simulados por um fetch falso e o banco por um supabase-js falso (passando pelo adaptador criarDbVendas).
import test from 'node:test';
import assert from 'node:assert/strict';
import { criarSupabaseFalso } from './apoio.js';
import {
  atenderPagamento, atenderWebhookAsaas, criarDbVendas, montarEmailAcesso, dataBrasil, lerEnvVendas,
  MSG_PAG_NAO_CONFIGURADO, MSG_EMAIL_NAO_CONFIGURADO
} from '../../supabase/funcoes-compartilhadas/pagamento.js';
import { documentoValido, asaasMetodo, asaasAmbiente, iguaisSeguro, ASAAS_URLS } from '../../supabase/funcoes-compartilhadas/asaas.js';

const SITE = 'https://disc.gestaosemcaos.com.br';
const ID = '0b6f7f1e-8a7d-4c1b-9a50-2a8c7c1d0e01';
const ID2 = '0b6f7f1e-8a7d-4c1b-9a50-2a8c7c1d0e02';
const TOKEN = 'a'.repeat(64);
const TOKEN2 = 'b'.repeat(64);
const AGORA = Date.parse('2026-10-05T15:00:00Z');
const CPF = '529.982.247-25';

function pedidoLinha(extra) {
  return Object.assign({
    id: ID, resposta_id: 'resp-000001', pacote: 'completo', valor_centavos: 2900, cupom: null, status: 'aguardando', metodo: '',
    asaas_cobranca_id: null, pagamento: null, email: 'bia@exemplo.com', nome: 'Bia Souza Lima', token_acesso: TOKEN,
    criado_em: '2026-10-05T14:59:00Z', pago_em: null, verificado_em: null
  }, extra || {});
}

/** Asaas + Resend falsos. op.asaas(metodo, caminho, corpo) -> {status, corpo} sobrepõe o padrão. */
function criarFetchVendas(op) {
  op = op || {};
  const chamadas = [];
  const cobrancas = {};
  let n = 0;
  async function f(url, o) {
    o = o || {};
    const metodo = String(o.method || 'GET');
    const corpo = o.body ? JSON.parse(o.body) : undefined;
    chamadas.push({ url: String(url), metodo, corpo, headers: o.headers || {} });
    const resp = (status, c) => new Response(JSON.stringify(c), { status });
    if (String(url) === 'https://api.resend.com/emails') {
      if (op.resendFalha) return resp(500, { message: 'x' });
      return resp(200, { id: 'em_1' });
    }
    const base = ASAAS_URLS.sandbox;
    if (!String(url).startsWith(base)) throw new Error('teste: chamada externa inesperada para ' + url);
    const caminho = String(url).slice(base.length);
    if ((o.headers || {}).access_token !== 'chave-asaas-teste') return resp(401, { errors: [{ code: 'invalid_access_token', description: 'Chave inválida' }] });
    if (op.asaas) { const r = op.asaas(metodo, caminho, corpo); if (r) return resp(r.status, r.corpo); }
    if (metodo === 'POST' && caminho === '/customers') {
      if (op.exigeCpf && !corpo.cpfCnpj) return resp(400, { errors: [{ code: 'invalid_cpfCnpj', description: 'O CPF/CNPJ do cliente é obrigatório.' }] });
      return resp(200, { id: 'cus_' + (++n) });
    }
    if (metodo === 'POST' && caminho === '/payments') {
      const id = 'pay_' + (++n);
      cobrancas[id] = { id, status: 'PENDING', value: corpo.value, billingType: 'UNDEFINED', externalReference: corpo.externalReference };
      return resp(200, Object.assign({ invoiceUrl: 'https://sandbox.asaas.com/i/' + id }, cobrancas[id]));
    }
    let m = /^\/payments\/([^/]+)\/pixQrCode$/.exec(caminho);
    if (m) return resp(200, { encodedImage: 'iVBORw0KGgo=', payload: '00020126pix-' + m[1], expirationDate: '2026-10-06 23:59:59' });
    m = /^\/payments\/([^/]+)$/.exec(caminho);
    if (m && cobrancas[m[1]]) return resp(200, cobrancas[m[1]]);
    return resp(404, { errors: [{ code: 'not_found', description: 'Não encontrado' }] });
  }
  f.chamadas = chamadas;
  f.cobrancas = cobrancas;
  return f;
}

function montar(op) {
  op = op || {};
  const sb = criarSupabaseFalso({ tabelas: { pedidos: op.pedidos || [pedidoLinha()], limites_vendas: [] } });
  const fetch = criarFetchVendas(op.fetch);
  let relogio = AGORA;
  const base = {
    env: Object.assign({ SITE_URL: SITE, ASAAS_API_KEY: 'chave-asaas-teste', ASAAS_AMBIENTE: 'sandbox', ASAAS_WEBHOOK_TOKEN: 'webhook-segredo',
      RESEND_API_KEY: 're_teste', EMAIL_REMETENTE: '' }, op.env || {}),
    fetch,
    agora: () => relogio,
    db: criarDbVendas(sb.createClient('u', 'service'))
  };
  return {
    sb, fetch, base,
    avancar(ms) { relogio += ms; },
    pedido: (id) => sb.st.tabelas.pedidos.find((p) => p.id === (id || ID)),
    async post(corpo, cab) {
      const r = await atenderPagamento(new Request('https://x/functions/v1/pagamento', {
        method: 'POST', headers: Object.assign({ 'content-type': 'application/json', origin: SITE }, cab || {}), body: JSON.stringify(corpo)
      }), base);
      return { status: r.status, json: await r.json(), cors: r.headers.get('access-control-allow-origin') };
    },
    async webhook(evento, token) {
      const r = await atenderWebhookAsaas(new Request('https://x/functions/v1/asaas-webhook', {
        method: 'POST', headers: token === null ? {} : { 'asaas-access-token': token || 'webhook-segredo' }, body: JSON.stringify(evento)
      }), base);
      return { status: r.status, json: await r.json() };
    }
  };
}

const evento = (event, extra) => ({ id: 'evt_' + Math.random().toString(36).slice(2), event,
  payment: Object.assign({ id: 'pay_2', externalReference: ID, value: 29, billingType: 'PIX', status: 'RECEIVED' }, extra || {}) });

test('auxiliares: CPF/CNPJ, método, ambiente, comparação, datas, segredos lidos do ambiente', () => {
  assert.equal(documentoValido(CPF), '52998224725');
  assert.equal(documentoValido('111.111.111-11'), '');
  assert.equal(documentoValido('52998224724'), '');
  assert.equal(documentoValido('11.222.333/0001-81'), '11222333000181');
  assert.equal(documentoValido('11.222.333/0001-82'), '');
  assert.deepEqual(['PIX', 'CREDIT_CARD', 'BOLETO', 'X'].map(asaasMetodo), ['pix', 'cartao', 'boleto', '']);
  assert.equal(asaasAmbiente('producao'), 'producao');
  assert.equal(asaasAmbiente(''), 'sandbox');
  assert.equal(iguaisSeguro('abc', 'abc'), true);
  assert.equal(iguaisSeguro('abc', 'abd'), false);
  assert.equal(iguaisSeguro('', ''), false);
  assert.equal(dataBrasil(Date.parse('2026-10-06T02:00:00Z'), 0), '2026-10-05', 'hoje em Brasília (UTC-3)');
  assert.equal(dataBrasil(AGORA, 1), '2026-10-06');
  const env = lerEnvVendas((n) => ({ ASAAS_API_KEY: ' k ', SITE_URL: SITE }[n]));
  assert.equal(env.ASAAS_API_KEY, 'k');
  assert.equal(env.RESEND_API_KEY, '');
  const m = montarEmailAcesso({ SITE_URL: SITE + '/' }, 'Bia <script> Souza', [{ pacote: 'completo', token_acesso: TOKEN }]);
  assert.ok(m.texto.includes(SITE + '/meu-relatorio.html#t-' + TOKEN));
  assert.ok(m.html.includes('Olá, Bia &lt;script&gt;'.split(' ')[0]));
  assert.ok(!m.html.includes('<script>'));
  assert.ok(m.texto.includes('Gestão sem Caos'));
  assert.ok(!/notus/i.test(m.texto + m.html));
});

test('criar: Pix + link de cartão; reaproveita a cobrança; valor e referência certos; não revela pedido alheio', async () => {
  const t = montar();
  const r = await t.post({ acao: 'criar', pedidoId: ID, tokenAcesso: TOKEN });
  assert.equal(r.json.ok, true, r.json.erro);
  assert.equal(r.cors, SITE);
  assert.deepEqual(r.json.pix, { qrBase64: 'iVBORw0KGgo=', copiaECola: '00020126pix-pay_2', expira: '2026-10-06 23:59:59' });
  assert.equal(r.json.cartaoUrl, 'https://sandbox.asaas.com/i/pay_2');
  assert.equal(r.json.valor, 2900);
  const cob = t.fetch.chamadas.find((c) => c.url.endsWith('/payments') && c.metodo === 'POST').corpo;
  assert.deepEqual([cob.value, cob.billingType, cob.externalReference, cob.dueDate], [29, 'UNDEFINED', ID, '2026-10-06']);
  assert.match(cob.description, /Gestão sem Caos/);
  assert.ok(!/notus/i.test(cob.description));
  const cli = t.fetch.chamadas.find((c) => c.url.endsWith('/customers')).corpo;
  assert.deepEqual([cli.name, cli.email, cli.notificationDisabled], ['Bia Souza Lima', 'bia@exemplo.com', true]);
  assert.equal(t.pedido().asaas_cobranca_id, 'pay_2');
  // De novo: mesma cobrança, sem chamar o Asaas.
  const antes = t.fetch.chamadas.length;
  const r2 = await t.post({ acao: 'criar', pedidoId: ID, tokenAcesso: TOKEN });
  assert.deepEqual(r2.json, r.json);
  assert.equal(t.fetch.chamadas.length, antes);
  // Token errado / id inválido: "Pedido não encontrado." sem detalhes.
  for (const c of [{ pedidoId: ID, tokenAcesso: TOKEN2 }, { pedidoId: 'x', tokenAcesso: TOKEN }, { pedidoId: ID2, tokenAcesso: TOKEN }]) {
    assert.deepEqual((await t.post(Object.assign({ acao: 'criar' }, c))).json, { ok: false, erro: 'Pedido não encontrado.' });
  }
  // Origem estranha não recebe CORS.
  assert.equal((await t.post({ acao: 'status', pedidoId: ID, tokenAcesso: TOKEN }, { origin: 'https://golpe.com' })).cors, null);
});

test('criar: sem ASAAS_API_KEY -> "Pagamento ainda não configurado."; pedido já pago; CPF exigido pelo Asaas', async () => {
  const sem = montar({ env: { ASAAS_API_KEY: '' } });
  assert.deepEqual((await sem.post({ acao: 'criar', pedidoId: ID, tokenAcesso: TOKEN })).json, { ok: false, erro: MSG_PAG_NAO_CONFIGURADO });
  assert.equal(sem.fetch.chamadas.length, 0);
  const pago = montar({ pedidos: [pedidoLinha({ status: 'cortesia' })] });
  assert.deepEqual((await pago.post({ acao: 'criar', pedidoId: ID, tokenAcesso: TOKEN })).json, { ok: true, status: 'cortesia', pago: true });
  const est = montar({ pedidos: [pedidoLinha({ status: 'estornado' })] });
  assert.equal((await est.post({ acao: 'criar', pedidoId: ID, tokenAcesso: TOKEN })).json.erro, 'Este pedido não está mais aberto. Faça um novo pedido.');

  const cpf = montar({ fetch: { exigeCpf: true } });
  assert.deepEqual((await cpf.post({ acao: 'criar', pedidoId: ID, tokenAcesso: TOKEN })).json,
    { ok: false, erro: 'Informe o seu CPF para pagar.', precisaCpf: true });
  assert.equal((await cpf.post({ acao: 'criar', pedidoId: ID, tokenAcesso: TOKEN, cpf: '123' })).json.erro, 'CPF inválido. Confira os números.');
  const ok = await cpf.post({ acao: 'criar', pedidoId: ID, tokenAcesso: TOKEN, cpf: CPF });
  assert.equal(ok.json.ok, true, ok.json.erro);
  assert.equal(cpf.fetch.chamadas.filter((c) => c.url.endsWith('/customers')).pop().corpo.cpfCnpj, '52998224725');
  assert.ok(!JSON.stringify(cpf.pedido()).includes('52998224725'), 'o CPF não fica no banco');

  // Asaas fora do ar: mensagem amigável, sem segredo.
  const fora = montar({ fetch: { asaas: () => ({ status: 503, corpo: {} }) } });
  const r = await fora.post({ acao: 'criar', pedidoId: ID, tokenAcesso: TOKEN });
  assert.equal(r.json.erro, 'Não foi possível gerar o pagamento agora. Tente de novo em instantes.');
  assert.ok(!JSON.stringify(r.json).includes('chave-asaas-teste'));
  // Sem Pix (conta sem chave Pix): ainda devolve o link da página de pagamento.
  const semPix = montar({ fetch: { asaas: (m, c) => (/pixQrCode$/.test(c) ? { status: 400, corpo: { errors: [{ description: 'Sem chave Pix' }] } } : null) } });
  const sp = await semPix.post({ acao: 'criar', pedidoId: ID, tokenAcesso: TOKEN });
  assert.deepEqual([sp.json.ok, sp.json.pix, !!sp.json.cartaoUrl], [true, null, true]);
});

test('status: confere no Asaas no máximo a cada 15 s e marca pago (webhook perdido); e-mail com o link', async () => {
  const t = montar();
  await t.post({ acao: 'criar', pedidoId: ID, tokenAcesso: TOKEN });
  assert.deepEqual((await t.post({ acao: 'status', pedidoId: ID, tokenAcesso: TOKEN })).json, { ok: true, status: 'aguardando' });
  t.fetch.cobrancas.pay_2.status = 'RECEIVED';
  t.fetch.cobrancas.pay_2.billingType = 'PIX';
  t.avancar(5000);
  assert.equal((await t.post({ acao: 'status', pedidoId: ID, tokenAcesso: TOKEN })).json.status, 'aguardando', 'ainda dentro dos 15 s');
  t.avancar(15000);
  assert.deepEqual((await t.post({ acao: 'status', pedidoId: ID, tokenAcesso: TOKEN })).json, { ok: true, status: 'pago' });
  assert.deepEqual([t.pedido().status, t.pedido().metodo], ['pago', 'pix']);
  const emails = t.fetch.chamadas.filter((c) => c.url === 'https://api.resend.com/emails');
  assert.equal(emails.length, 1);
  assert.deepEqual(emails[0].corpo.to, ['bia@exemplo.com']);
  assert.ok(emails[0].corpo.text.includes(SITE + '/meu-relatorio.html#t-' + TOKEN));
  assert.match(emails[0].corpo.from, /Gestão sem Caos/);
  // Depois de pago, só lê o banco.
  const antes = t.fetch.chamadas.length;
  assert.equal((await t.post({ acao: 'status', pedidoId: ID, tokenAcesso: TOKEN })).json.status, 'pago');
  assert.equal(t.fetch.chamadas.length, antes);
});

test('webhook: token obrigatório; pago idempotente (e-mail 1 vez); valor menor ignorado; estorno; cobrança alheia', async () => {
  const t = montar({ pedidos: [pedidoLinha({ asaas_cobranca_id: 'pay_2' }), pedidoLinha({ id: ID2, token_acesso: TOKEN2, asaas_cobranca_id: 'pay_9' })] });
  assert.equal((await t.webhook(evento('PAYMENT_RECEIVED'), null)).status, 401);
  assert.equal((await t.webhook(evento('PAYMENT_RECEIVED'), 'errado')).status, 401);
  const semSegredo = montar({ env: { ASAAS_WEBHOOK_TOKEN: '' } });
  assert.equal((await semSegredo.webhook(evento('PAYMENT_RECEIVED'))).status, 503);
  assert.equal(t.pedido().status, 'aguardando');

  assert.deepEqual((await t.webhook(evento('PAYMENT_CREATED'))).json, { ok: true, feito: false, motivo: 'evento_ignorado' });
  assert.deepEqual((await t.webhook(evento('PAYMENT_RECEIVED', { value: 10 }))).json, { ok: true, feito: false, motivo: 'valor_menor' });
  const r = await t.webhook(evento('PAYMENT_CONFIRMED', { billingType: 'CREDIT_CARD' }));
  assert.deepEqual([r.status, r.json.motivo], [200, 'pago']);
  assert.deepEqual([t.pedido().status, t.pedido().metodo], ['pago', 'cartao']);
  assert.deepEqual((await t.webhook(evento('PAYMENT_RECEIVED'))).json, { ok: true, feito: false, motivo: 'repetido' });
  assert.equal(t.fetch.chamadas.filter((c) => c.url === 'https://api.resend.com/emails').length, 1, 'e-mail só na 1ª confirmação');
  // Referência de um pedido que tem OUTRA cobrança: ignora.
  assert.deepEqual((await t.webhook(evento('PAYMENT_RECEIVED', { id: 'pay_x', externalReference: ID2 }))).json,
    { ok: true, feito: false, motivo: 'pedido_nao_encontrado' });
  assert.equal(t.pedido(ID2).status, 'aguardando');
  // Estorno e chargeback: bloqueia; evento atrasado de pagamento não reabre.
  assert.equal((await t.webhook(evento('PAYMENT_REFUNDED'))).json.motivo, 'estornado');
  assert.equal(t.pedido().status, 'estornado');
  assert.equal((await t.webhook(evento('PAYMENT_RECEIVED'))).json.motivo, 'repetido');
  assert.equal(t.pedido().status, 'estornado');
  // Cobrança removida: cancela só se ainda aguardando.
  assert.equal((await t.webhook(evento('PAYMENT_DELETED', { id: 'pay_9', externalReference: ID2 }))).json.motivo, 'cancelado');
  assert.equal(t.pedido(ID2).status, 'cancelado');
  assert.equal((await t.webhook({ event: 'PAYMENT_RECEIVED' })).json.motivo, 'sem_cobranca');
  // Banco fora: 500 (o Asaas reenvia).
  t.base.db.pedidoPorCobranca = async () => { throw new Error('falha no banco'); };
  assert.equal((await t.webhook(evento('PAYMENT_RECEIVED'))).status, 500);
});

test('recuperar: sem e-mail configurado orienta o suporte; manda os links; não revela; limita', async () => {
  const pagos = [pedidoLinha({ status: 'pago' }), pedidoLinha({ id: ID2, token_acesso: TOKEN2, status: 'cortesia', pacote: 'completo_plus' })];
  const sem = montar({ pedidos: pagos, env: { RESEND_API_KEY: '' } });
  assert.deepEqual((await sem.post({ acao: 'recuperar', email: 'bia@exemplo.com' })).json, { ok: false, erro: MSG_EMAIL_NAO_CONFIGURADO });
  assert.match(MSG_EMAIL_NAO_CONFIGURADO, /fale com o suporte/i);

  const t = montar({ pedidos: pagos });
  assert.equal((await t.post({ acao: 'recuperar', email: 'xx' })).json.erro, 'Informe um e-mail válido.');
  assert.deepEqual((await t.post({ acao: 'recuperar', email: ' BIA@exemplo.com ' })).json, { ok: true });
  const em = t.fetch.chamadas.filter((c) => c.url === 'https://api.resend.com/emails');
  assert.equal(em.length, 1);
  assert.ok(em[0].corpo.text.includes('#t-' + TOKEN) && em[0].corpo.text.includes('#t-' + TOKEN2));
  // E-mail sem compra: mesma resposta, nenhum envio.
  assert.deepEqual((await t.post({ acao: 'recuperar', email: 'ninguem@exemplo.com' })).json, { ok: true });
  assert.equal(t.fetch.chamadas.filter((c) => c.url === 'https://api.resend.com/emails').length, 1);
  await t.post({ acao: 'recuperar', email: 'bia@exemplo.com' });
  await t.post({ acao: 'recuperar', email: 'bia@exemplo.com' });
  assert.equal((await t.post({ acao: 'recuperar', email: 'bia@exemplo.com' })).json.erro, 'Muitos pedidos para este e-mail. Tente de novo daqui a 1 hora.');
  t.avancar(3600 * 1000 + 1000);
  assert.deepEqual((await t.post({ acao: 'recuperar', email: 'bia@exemplo.com' })).json, { ok: true }, 'passada 1 hora, libera');
  assert.equal((await t.post({ acao: 'desconhecida' })).json.erro, 'Ação desconhecida.');
});

test('HTTP: OPTIONS, método, corpo grande ou inválido', async () => {
  const t = montar();
  const op = await atenderPagamento(new Request('https://x/', { method: 'OPTIONS', headers: { origin: SITE } }), t.base);
  assert.equal(op.status, 204);
  assert.equal((await atenderPagamento(new Request('https://x/', { method: 'GET' }), t.base)).status, 405);
  const grande = await atenderPagamento(new Request('https://x/', { method: 'POST', body: JSON.stringify({ acao: 'criar', x: 'a'.repeat(5000) }) }), t.base);
  assert.equal((await grande.json()).erro, 'Requisição grande demais.');
  const ruim = await atenderPagamento(new Request('https://x/', { method: 'POST', body: '{' }), t.base);
  assert.equal((await ruim.json()).erro, 'JSON inválido.');
  assert.equal((await atenderWebhookAsaas(new Request('https://x/', { method: 'GET' }), t.base)).status, 405);
});
