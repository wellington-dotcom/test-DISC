// Aba Conexões (ações conexoes.diagnostico e conexoes.testar da Edge Function "admin"), com fetch, env e banco falsos.
// O ponto principal: nenhum VALOR de segredo sai na resposta; 404 = função não publicada; prazo de 8 s por teste.
import test from 'node:test';
import assert from 'node:assert/strict';
import { atenderAdmin } from '../../supabase/funcoes-compartilhadas/http.js';
import {
  ocultarSegredos, parcial, traduzirErro, comPrazo, fetchComPrazo, pingFuncao, FUNCOES_EDGE, CONEXOES_PRAZO_MS
} from '../../supabase/funcoes-compartilhadas/conexoes.js';
import { lerEnv } from '../../supabase/funcoes-compartilhadas/supabase-adaptadores.js';

const SB = 'https://projeto.supabase.co';
const SITE = 'https://disc.gestaosemcaos.com.br';
const PEDIDO = '12345678-1234-4234-8234-123456789012';
const SEGREDOS = {
  SUPABASE_URL: SB, SUPABASE_ANON_KEY: 'sb_publishable_ANONIMA_123', SUPABASE_SERVICE_ROLE_KEY: 'service-role-SEGREDO-999',
  SITE_URL: SITE + '/', PAGAMENTO_PROVEDOR: 'infinitepay', INFINITEPAY_HANDLE: 'minhaloja77',
  ASAAS_API_KEY: '$aact_CHAVE_ASAAS_777', ASAAS_WEBHOOK_TOKEN: 'token-webhook-asaas-555', ASAAS_AMBIENTE: 'sandbox',
  RESEND_API_KEY: 're_CHAVE_RESEND_444', EMAIL_REMETENTE: 'Gestão sem Caos <ola@gsc.com.br>',
  CLICKUP_TOKEN: 'pk_CLICKUP_TOKEN_333', CLICKUP_PASTA_ID: '9001', CLICKUP_WEBHOOK_SECRET: 'segredo-webhook-cu-222',
  ANTHROPIC_API_KEY: 'sk-ant-CHAVE-IA-111'
};
const VALORES_SECRETOS = ['sb_publishable_ANONIMA_123', 'service-role-SEGREDO-999', 'minhaloja77', '$aact_CHAVE_ASAAS_777',
  'token-webhook-asaas-555', 're_CHAVE_RESEND_444', 'pk_CLICKUP_TOKEN_333', 'segredo-webhook-cu-222', 'sk-ant-CHAVE-IA-111'];

function semVazamento(obj) {
  const txt = JSON.stringify(obj);
  VALORES_SECRETOS.forEach((v) => assert.ok(!txt.includes(v), 'vazou: ' + v));
}

/** fetch falso: rotas(url, opcoes) -> {status, corpo} | Promise que nunca resolve (simula demora). */
function criarFetch(rotas) {
  const chamadas = [];
  async function f(url, op) {
    op = op || {};
    chamadas.push({ url: String(url), metodo: op.method || 'GET', headers: op.headers || {}, corpo: op.body ? JSON.parse(op.body) : undefined });
    const r = await rotas(String(url), op);
    return new Response(r.corpo === undefined ? null : (typeof r.corpo === 'string' ? r.corpo : JSON.stringify(r.corpo)), { status: r.status });
  }
  f.chamadas = chamadas;
  return f;
}

function rotasPadrao(extra) {
  return async (url, op) => {
    const x = extra && await extra(url, op);
    if (x) return x;
    if (url.startsWith(SB + '/functions/v1/')) {
      if (url.endsWith('/asaas-webhook')) return { status: 404, corpo: { code: 'NOT_FOUND', message: 'Requested function was not found' } };
      return { status: 204 };
    }
    if (url === SB + '/auth/v1/settings') return { status: 200, corpo: { disable_signup: true, external: { email: true } } };
    if (url === 'https://api.clickup.com/api/v2/user') {
      return op.headers.Authorization === SEGREDOS.CLICKUP_TOKEN ? { status: 200, corpo: { user: { username: 'Wellington' } } } : { status: 401, corpo: { err: 'Token invalid' } };
    }
    if (url.startsWith('https://api-sandbox.asaas.com/v3/payments/')) {
      return op.headers.access_token === SEGREDOS.ASAAS_API_KEY ? { status: 404, corpo: { errors: [{ code: 'not_found' }] } } : { status: 401, corpo: {} };
    }
    if (url.startsWith('https://api.anthropic.com/v1/models')) {
      return op.headers['x-api-key'] === SEGREDOS.ANTHROPIC_API_KEY ? { status: 200, corpo: { data: [{ id: 'x' }] } } : { status: 401, corpo: {} };
    }
    if (url === 'https://api.resend.com/emails') return { status: 200, corpo: { id: 'em_1' } };
    if (url === 'https://api.checkout.infinitepay.io/links') return { status: 200, corpo: { url: 'https://checkout.infinitepay.io/minhaloja77/abc' } };
    if (url === 'https://api.checkout.infinitepay.io/payment_check') return { status: 200, corpo: { success: true, paid: false } };
    throw new Error('chamada inesperada: ' + url);
  };
}

function criarDb(op) {
  const st = { pedidos: [], semColuna: !!(op && op.semColuna) };
  const falhaColuna = () => { const e = new Error('falha no banco de dados (column pedidos.teste does not exist)'); e.causa = { code: '42703' }; return e; };
  return {
    st,
    async pedidoTesteInserir(reg) {
      if (st.semColuna) throw falhaColuna();
      const l = Object.assign({ id: PEDIDO, status: 'aguardando', criado_em: '2026-10-05T12:00:00Z' }, reg);
      st.pedidos.push(l);
      return { id: l.id, criado_em: l.criado_em };
    },
    async pedidoTesteLer(id) { if (st.semColuna) throw falhaColuna(); return st.pedidos.find((p) => p.id === id && p.teste) || null; },
    async pedidoTesteUltimo() { if (st.semColuna) throw falhaColuna(); return st.pedidos.filter((p) => p.teste).slice(-1)[0] || null; },
    async pedidoTesteAtualizar(id, campos) { const p = st.pedidos.find((x) => x.id === id && x.teste); if (p) Object.assign(p, campos); }
  };
}

function preparar(op) {
  op = op || {};
  const fetch = criarFetch(rotasPadrao(op.rotas));
  const db = criarDb(op);
  const env = Object.assign({}, SEGREDOS, op.env || {});
  const base = {
    env, fetch, db, agora: () => Date.parse('2026-10-05T12:00:00Z'), prazoConexoesMs: op.prazo,
    autenticar: async (h) => (h === 'Bearer jwt-admin' ? { usuario: { id: 'u1', email: 'dona@empresa.com' }, eAdmin: true }
      : (h === 'Bearer jwt-comum' ? { usuario: { id: 'u2', email: 'x@y.com' }, eAdmin: false } : null))
  };
  async function chamar(corpo, jwt) {
    const req = new Request(SB + '/functions/v1/admin', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: SITE, authorization: 'Bearer ' + (jwt || 'jwt-admin') },
      body: JSON.stringify(corpo)
    });
    return (await atenderAdmin(req, base)).json();
  }
  return { fetch, db, env, chamar };
}

test('exige administrador: sem sessão e sem permissão são recusados', async () => {
  const { chamar } = preparar();
  assert.equal((await chamar({ acao: 'conexoes.diagnostico' }, 'jwt-invalido')).sessaoExpirada, true);
  assert.deepEqual(await chamar({ acao: 'conexoes.testar', alvo: 'clickup' }, 'jwt-comum'), { ok: false, erro: 'Sem permissão.' });
  assert.deepEqual(await chamar({ acao: 'conexoes.testar', alvo: 'nada' }), { ok: false, erro: 'Teste desconhecido.' });
});

test('diagnóstico: só presença dos segredos (booleanos), handle parcial, provedor; funções e cadastro', async () => {
  const { chamar, fetch } = preparar();
  const r = await chamar({ acao: 'conexoes.diagnostico' });
  assert.equal(r.ok, true);
  semVazamento(r);
  Object.values(r.segredos).forEach((v) => assert.equal(typeof v, 'boolean'));
  assert.equal(r.segredos.ASAAS_API_KEY, true);
  assert.equal(r.siteUrl, SITE + '/');
  assert.deepEqual(r.pagamento, { provedor: 'infinitepay', provedorEscolhido: 'infinitepay', handleParcial: 'mi***', asaasAmbiente: 'sandbox' });
  assert.deepEqual(r.funcoes.map((f) => [f.nome, f.publicada]), FUNCOES_EDGE.map((n) => [n, n !== 'asaas-webhook']));
  assert.equal(r.funcoes.find((f) => f.nome === 'asaas-webhook').status, 404);
  assert.deepEqual(r.auth, { cadastroFechado: true });
  assert.equal(r.pedidoTeste, null);
  assert.equal(r.colunaTeste, true);
  // As funções são chamadas pelo SERVIDOR (OPTIONS), não pelo navegador; a própria admin não se chama.
  const pings = fetch.chamadas.filter((c) => c.url.includes('/functions/v1/'));
  assert.equal(pings.length, FUNCOES_EDGE.length - 1);
  pings.forEach((c) => assert.equal(c.metodo, 'OPTIONS'));
});

test('diagnóstico sem segredos: tudo false, sem provedor; sem a migração: colunaTeste false', async () => {
  const vazio = {};
  Object.keys(SEGREDOS).forEach((k) => { vazio[k] = ''; });
  const { chamar } = preparar({ env: vazio, semColuna: true });
  const r = await chamar({ acao: 'conexoes.diagnostico' });
  Object.values(r.segredos).forEach((v) => assert.equal(v, false));
  assert.equal(r.pagamento.provedor, '');
  assert.equal(r.pagamento.handleParcial, '');
  assert.ok(r.funcoes.filter((f) => f.nome !== 'admin').every((f) => f.publicada === null), 'sem SUPABASE_URL não dá para saber');
  assert.equal(r.auth.cadastroFechado, null);
  assert.equal(r.colunaTeste, false);
  // Valor desconhecido em PAGAMENTO_PROVEDOR não é repetido.
  const r2 = await preparar({ env: { PAGAMENTO_PROVEDOR: 'paypal' } }).chamar({ acao: 'conexoes.diagnostico' });
  assert.equal(r2.pagamento.provedorEscolhido, 'invalido');
});

test('pingFuncao: 404 = não publicada; 401/204 = publicada; 5xx = publicada com erro; demora = não deu para saber', async () => {
  const resp = { a: 404, b: 401, c: 503 };
  const ctx = {
    env: { SUPABASE_URL: SB }, prazoConexoesMs: 30,
    fetch: criarFetch(async (url) => {
      const n = url.split('/').pop();
      if (n === 'lenta') return new Promise(() => {});
      return { status: resp[n] || 204 };
    })
  };
  assert.equal((await pingFuncao(ctx, 'a')).publicada, false);
  assert.equal((await pingFuncao(ctx, 'b')).publicada, true);
  const c = await pingFuncao(ctx, 'c');
  assert.equal(c.publicada, true);
  assert.match(c.mensagem, /erro 503/);
  const lenta = await pingFuncao(ctx, 'lenta');
  assert.equal(lenta.publicada, null);
  assert.match(lenta.mensagem, /não respondeu em 8 segundos/);
});

test('prazo: comPrazo e fetchComPrazo desistem (máximo 8 s) e o teste vira mensagem de demora', async () => {
  assert.equal(CONEXOES_PRAZO_MS, 8000);
  await assert.rejects(comPrazo(new Promise(() => {}), 20), (e) => e.tempoEsgotado === true);
  let abortado = false;
  const f = fetchComPrazo((u, o) => new Promise(() => { o.signal.addEventListener('abort', () => { abortado = true; }); }), 20);
  await assert.rejects(f('https://x'), (e) => e.tempoEsgotado === true);
  assert.equal(abortado, true, 'a requisição é abortada');
  const { chamar } = preparar({ prazo: 30, rotas: async (url) => (url.includes('clickup') ? new Promise(() => {}) : null) });
  const t0 = Date.now();
  const r = await chamar({ acao: 'conexoes.testar', alvo: 'clickup' });
  assert.ok(Date.now() - t0 < 2000);
  assert.equal(r.sucesso, false);
  assert.match(r.mensagem, /não respondeu em 8 segundos/);
});

test('testes externos: ClickUp, Asaas, IA e e-mail — ok e chave recusada, sem vazar valores', async () => {
  const { chamar, fetch } = preparar();
  const cu = await chamar({ acao: 'conexoes.testar', alvo: 'clickup' });
  assert.deepEqual([cu.sucesso, cu.mensagem], [true, 'Conectado ao ClickUp como Wellington.']);
  assert.equal(cu.detalhes.webhookSecreto, true);
  const as = await chamar({ acao: 'conexoes.testar', alvo: 'asaas' });
  assert.equal(as.sucesso, true, as.mensagem);
  assert.match(as.mensagem, /sandbox/);
  const ia = await chamar({ acao: 'conexoes.testar', alvo: 'ia' });
  assert.equal(ia.sucesso, true);
  assert.equal(fetch.chamadas.find((c) => c.url.includes('anthropic')).metodo, 'GET', 'IA: só lista modelos (sem custo)');
  const em = await chamar({ acao: 'conexoes.testar', alvo: 'email' });
  assert.equal(em.sucesso, true);
  assert.deepEqual(fetch.chamadas.find((c) => c.url.includes('resend')).corpo.to, ['dona@empresa.com']);
  [cu, as, ia, em].forEach(semVazamento);

  const ruim = preparar({ env: { CLICKUP_TOKEN: 'pk_errado_000', ASAAS_API_KEY: 'chave-errada', ANTHROPIC_API_KEY: 'sk-errada' } });
  for (const alvo of ['clickup', 'asaas', 'ia']) {
    const r = await ruim.chamar({ acao: 'conexoes.testar', alvo });
    assert.equal(r.sucesso, false, alvo);
    assert.match(r.mensagem, /recusou a chave/, alvo);
    assert.ok(!JSON.stringify(r).includes('pk_errado_000') && !JSON.stringify(r).includes('chave-errada'));
  }
  const semChave = preparar({ env: { RESEND_API_KEY: '', ANTHROPIC_API_KEY: '' } });
  assert.equal((await semChave.chamar({ acao: 'conexoes.testar', alvo: 'email' })).mensagem, 'Segredo RESEND_API_KEY não existe.');
  assert.match((await semChave.chamar({ acao: 'conexoes.testar', alvo: 'ia' })).mensagem, /não existe \(a IA é opcional\)/);
});

test('InfinitePay: link de teste (pedido teste = true, R$ 1,00) e verificação; sem a migração, avisa', async () => {
  const { chamar, fetch, db } = preparar();
  const r = await chamar({ acao: 'conexoes.testar', alvo: 'infinitepay.link' });
  assert.equal(r.sucesso, true, r.mensagem);
  assert.equal(r.detalhes.url, 'https://checkout.infinitepay.io/minhaloja77/abc');
  semVazamento(r.mensagem + r.verificado);
  const p = db.st.pedidos[0];
  assert.deepEqual([p.teste, p.valor_centavos, p.status, p.checkout_url], [true, 100, 'aguardando', r.detalhes.url]);
  assert.equal(p.provedor_dados.teste, true);
  const link = fetch.chamadas.find((c) => c.url.endsWith('/links')).corpo;
  assert.equal(link.items[0].price, 100);
  assert.equal(link.order_nsu, PEDIDO);
  assert.equal(link.redirect_url, SITE + '/admin.html?conexoes=teste');
  assert.equal(link.webhook_url, SB + '/functions/v1/infinitepay-webhook');
  assert.equal((await chamar({ acao: 'conexoes.diagnostico' })).pedidoTeste.id, PEDIDO);

  const v = await chamar({ acao: 'conexoes.testar', alvo: 'infinitepay.verificar', pedidoId: PEDIDO, transactionNsu: 'TX1' });
  assert.equal(v.sucesso, true);
  assert.equal(v.detalhes.pago, false);
  assert.equal(fetch.chamadas.find((c) => c.url.endsWith('/payment_check')).corpo.transaction_nsu, 'TX1');

  const pago = preparar({ rotas: async (url) => (url.endsWith('/payment_check') ? { status: 200, corpo: { success: true, paid: true, paid_amount: 100, capture_method: 'pix' } } : null) });
  await pago.chamar({ acao: 'conexoes.testar', alvo: 'infinitepay.link' });
  const vp = await pago.chamar({ acao: 'conexoes.testar', alvo: 'infinitepay.verificar' });
  assert.equal(vp.detalhes.pago, true);
  assert.equal(pago.db.st.pedidos[0].status, 'pago');

  const sem = preparar({ semColuna: true });
  const s = await sem.chamar({ acao: 'conexoes.testar', alvo: 'infinitepay.link' });
  assert.equal(s.sucesso, false);
  assert.match(s.mensagem, /20261013120000_conexoes/);
  assert.equal(sem.fetch.chamadas.filter((c) => c.url.includes('infinitepay')).length, 0, 'sem a coluna não cria link');
});

test('utilitários: ocultarSegredos, parcial, traduzirErro, lerEnv lê os nomes de pagamento', () => {
  assert.equal(ocultarSegredos('erro com re_CHAVE_RESEND_444 no meio', SEGREDOS), 'erro com *** no meio');
  assert.equal(parcial('$gestaosemcaos'), 'ge***');
  assert.equal(parcial(''), '');
  assert.match(traduzirErro('O Resend', new Error('Resend: HTTP 403')), /falta de permissão/);
  assert.match(traduzirErro('O Asaas', Object.assign(new Error('x'), { status: 500 })), /problema do lado dele/);
  assert.match(traduzirErro('O ClickUp', new Error('fetch failed')), /sem resposta da rede/);
  const env = lerEnv((n) => SEGREDOS[n]);
  assert.equal(env.INFINITEPAY_HANDLE, 'minhaloja77');
  assert.equal(env.RESEND_API_KEY, SEGREDOS.RESEND_API_KEY);
});
