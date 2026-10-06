// Venda direta (B2C): Edge Functions "pagamento" (site do cliente), "stripe-webhook", "infinitepay-webhook" e
// "asaas-webhook" (o meio de pagamento avisa). Lógica sem nada do Deno: testável no Node 20+ com fetch e banco falsos.
//
// PROVEDOR (meio de pagamento): segredo PAGAMENTO_PROVEDOR = 'stripe' | 'infinitepay' | 'asaas'. Sem ele: 'stripe' se
// houver STRIPE_SECRET_KEY, senão 'infinitepay' se houver INFINITEPAY_HANDLE, senão 'asaas' se houver ASAAS_API_KEY,
// senão nenhum ("Pagamento ainda não configurado.").
// Um pedido que já começou num provedor (pedidos.provedor) continua nele enquanto esse provedor estiver configurado.
//
// "pagamento" (POST JSON {acao, ...}; resposta sempre HTTP 200 {ok, ...}):
//   criar     Stripe (pagamento DENTRO do site, Payment Element): {pedidoId, tokenAcesso} -> {ok, provedor:'stripe',
//             clientSecret, publicavel (STRIPE_PUBLISHABLE_KEY), valor}. Um PaymentIntent por pedido (Idempotency-Key
//             "mapa-disc-<pedido>-<valor>"; reaproveitado enquanto ainda pode ser pago): amount em centavos, currency brl,
//             automatic_payment_methods (cartão, Apple Pay, Google Pay, Pix), metadata[pedido_id]. pedidos.provedor_ref
//             = id do PaymentIntent (pi_…). Sem STRIPE_PUBLISHABLE_KEY: "não configurado".
//   criar     InfinitePay: {pedidoId, tokenAcesso} -> {ok, provedor:'infinitepay', redirecionarUrl, valor} (o site manda o
//             cliente para a página da InfinitePay — Pix e cartão; o link é reaproveitado por 12 h). order_nsu = pedidoId;
//             redirect_url = SITE_URL/meu-relatorio.html?pedido=<id>#t-<token> (a InfinitePay acrescenta order_nsu,
//             transaction_nsu, slug, capture_method, receipt_url); webhook_url = SUPABASE_URL/functions/v1/infinitepay-webhook.
//             Sem SITE_URL: "não configurado".
//             Asaas: {pedidoId, tokenAcesso, cpf?} -> {ok, provedor:'asaas', pix:{qrBase64, copiaECola, expira}|null,
//             cartaoUrl, valor, vencimento}
//             | {ok:true, status:'pago'|'cortesia', pago:true} (já liberado)
//             | {ok:false, erro:'Pagamento ainda não configurado.'} (nenhum provedor configurado)
//             | {ok:false, erro:'Informe o seu CPF para pagar.', precisaCpf:true} (o Asaas exige CPF/CNPJ)
//             Cobrança única por pedido (reaproveitada enquanto o Pix não vence); billingType UNDEFINED = Pix
//             (QR) + cartão/boleto na página do Asaas (invoiceUrl). O CPF vai só para o Asaas (não é gravado aqui).
//   status    {pedidoId, tokenAcesso} -> {ok, status}. Se ainda 'aguardando', confere no provedor no máximo a cada
//             15 s (cobre webhook perdido) e marca pago. InfinitePay: só depois que transaction_nsu/slug forem
//             conhecidos (retorno do cliente ou webhook).
//   confirmar Stripe: {pedidoId, tokenAcesso, paymentIntent?} -> {ok, status}: busca o PaymentIntent do pedido no Stripe e só
//             marca pago com status 'succeeded', amount_received >= valor do pedido, moeda brl e metadata[pedido_id] certo.
//   confirmar {pedidoId, tokenAcesso, transactionNsu, slug} -> {ok, status} (retorno da InfinitePay: o site lê os
//             parâmetros da URL e chama esta ação). Confere com payment_check (paid=true e valor pago >= valor do
//             pedido) e marca pago. Guarda transaction_nsu/slug para o "status" voltar a conferir (Pix ainda pendente).
//             No máximo 1 conferência a cada 5 s por pedido.
//   recuperar {email} -> {ok:true} sempre que o envio estiver configurado (não revela se o e-mail comprou); manda
//             por e-mail os links dos pedidos pagos. Sem RESEND_API_KEY/SITE_URL -> {ok:false, erro:'...suporte.'}.
//             Limite: 3 pedidos por e-mail por hora e 60 no total por hora.
//   enviarLink {tokenAcesso} -> {ok, email (mascarado)}: botão "Enviar para meu e-mail" de meu-relatorio.html; manda o
//             link do relatório para o e-mail da compra (só pedido pago/cortesia). Limite: 3 por pedido por hora.
// "infinitepay-webhook": SEM assinatura (a InfinitePay não documenta uma). O corpo NUNCA é confiável: lê order_nsu
//   (= pedidoId), transaction_nsu e slug e confere com payment_check; só marca pago com paid=true e valor >= pedido.
//   Idempotente (pedido já pago: nada). Grava o corpo bruto em pedidos.provedor_dados.webhook (depuração).
//   Resposta 200 {ok, feito, motivo}; falha no banco -> 500 e InfinitePay fora -> 502 (para ela reenviar).
// "stripe-webhook": assinatura Stripe-Signature (HMAC-SHA256 de `${t}.${corpo}` com STRIPE_WEBHOOK_SECRET; tolerância
//   5 min; sem segredo 503, assinatura ruim 400). payment_intent.succeeded -> confere o PaymentIntent no Stripe (valor,
//   moeda, metadata) e marca 'pago' (idempotente); charge.refunded / charge.dispute.created -> 'estornado';
//   payment_intent.payment_failed -> guarda a recusa em provedor_dados.recusa (o pedido segue 'aguardando': dá para
//   tentar de novo com outro cartão no mesmo PaymentIntent) e o painel mostra "Última recusa".
//   Falha no banco -> 500 e Stripe fora -> 502 (o Stripe reenvia).
// "asaas-webhook": cabeçalho asaas-access-token == ASAAS_WEBHOOK_TOKEN (senão 401; sem segredo 503).
//   PAYMENT_RECEIVED/CONFIRMED -> 'pago' (só de aguardando/cancelado; valor pago >= valor do pedido);
//   PAYMENT_REFUNDED/PARTIALLY_REFUNDED/CHARGEBACK_* -> 'estornado' (relatório volta a bloqueado);
//   PAYMENT_DELETED -> 'cancelado' (só se aguardando). Idempotente: as trocas só valem a partir do status certo;
//   reenvio do mesmo evento não faz nada. Falha no banco -> 500 (o Asaas tenta de novo).
import { erro, normalizarEmail, emailValido, MSG_ERRO_INTERNO } from './regras.js';
import { criarInfinitePay, lerRefsInfinitePay, refInfinitePay } from './infinitepay.js';
import {
  criarStripe, idIntentStripe, segredoClienteStripe, recusaStripe, chavePublicavelStripe, stripeMetodo, verificarAssinaturaStripe,
  STRIPE_ABERTOS, STRIPE_DESCRICAO
} from './stripe.js';
import {
  criarAsaas, criarResend, asaasMetodo, iguaisSeguro, documentoValido,
  ASAAS_PAGO, ASAAS_EVENTOS_PAGO, ASAAS_EVENTOS_ESTORNO, ASAAS_EVENTOS_CANCELA
} from './asaas.js';

export const MSG_PAG_NAO_CONFIGURADO = 'Pagamento ainda não configurado.';
export const MSG_EMAIL_NAO_CONFIGURADO = 'O envio por e-mail ainda não está configurado. Fale com o suporte.';
export const MSG_PEDIDO_NAO_ENCONTRADO = 'Pedido não encontrado.';
export const MSG_PRECISA_CPF = 'Informe o seu CPF para pagar.';
export const MSG_RECUSADO = 'O pagamento não foi aprovado. Tente de novo ou use outra forma de pagamento.';
export const NOMES_ENV_VENDAS = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SITE_URL', 'PAGAMENTO_PROVEDOR',
  'STRIPE_SECRET_KEY', 'STRIPE_PUBLISHABLE_KEY', 'STRIPE_WEBHOOK_SECRET', 'INFINITEPAY_HANDLE', 'ASAAS_API_KEY', 'ASAAS_AMBIENTE', 'ASAAS_WEBHOOK_TOKEN', 'RESEND_API_KEY', 'EMAIL_REMETENTE'];
export const VERIFICAR_ASAAS_MS = 15000;
export const CONFIRMAR_MS = 5000;
export const LINK_INFINITEPAY_MS = 12 * 3600 * 1000;
const LIMITE_CORPO_PAGAMENTO = 4000;
const LIMITE_CORPO_ASAAS = 200000;
const LIMITE_CORPO_INFINITEPAY = 100000;
const LIMITE_CORPO_STRIPE = 300000;
const LIMITE_PROVEDOR_DADOS = 50000;
const NOMES_PACOTE = { completo: 'Relatório completo', completo_plus: 'Completo + Parte 2' };
const RE_UUID_VENDAS = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RE_TOKEN_VENDAS = /^[0-9a-f]{64}$/;
const COLUNAS_PEDIDO = 'id, resposta_id, pacote, valor_centavos, cupom, status, metodo, asaas_cobranca_id, pagamento, email, nome, ' +
  'token_acesso, criado_em, pago_em, verificado_em';
// Colunas da migração 20261012120000_infinitepay.sql (sem ela, o Asaas continua funcionando com as colunas antigas).
const COLUNAS_PROVEDOR = ', provedor, provedor_ref, checkout_url, provedor_dados';

/** Provedor de pagamento escolhido pelos segredos: 'stripe' | 'infinitepay' | 'asaas' | '' (nenhum configurado). */
export function provedorPagamento(env) {
  const e = env || {};
  const escolhido = String(e.PAGAMENTO_PROVEDOR || '').trim().toLowerCase();
  if (escolhido === 'stripe') return e.STRIPE_SECRET_KEY ? 'stripe' : '';
  if (escolhido === 'infinitepay') return e.INFINITEPAY_HANDLE ? 'infinitepay' : '';
  if (escolhido === 'asaas') return e.ASAAS_API_KEY ? 'asaas' : '';
  if (e.STRIPE_SECRET_KEY) return 'stripe';
  if (e.INFINITEPAY_HANDLE) return 'infinitepay';
  if (e.ASAAS_API_KEY) return 'asaas';
  return '';
}

/** Objeto -> cabe em provedor_dados (o banco recusa acima de 60 000 caracteres): grande demais vira texto cortado. */
export function limitarDados(obj, max) {
  const lim = max || LIMITE_PROVEDOR_DADOS;
  let txt = '';
  try { txt = JSON.stringify(obj === undefined ? null : obj); } catch (err) { txt = String(obj); }
  if (txt.length <= lim) return obj === undefined ? null : JSON.parse(txt);
  return { truncado: true, texto: txt.substring(0, lim - 200) };
}

// ---------------------------------------------------------------------------
// Ambiente e banco (service role)
// ---------------------------------------------------------------------------

export function lerEnvVendas(get) {
  const env = {};
  NOMES_ENV_VENDAS.forEach((n) => { let v = ''; try { v = get(n) || ''; } catch (err) { v = ''; } env[n] = String(v).trim(); });
  return env;
}

async function dadosVendas(consulta) {
  const { data, error } = await consulta;
  if (error) {
    const e = new Error('falha no banco de dados (' + String(error.message || error.code || 'erro').substring(0, 160) + ')');
    e.causa = error;
    throw e;
  }
  return data;
}

/** Acesso às tabelas de venda com o cliente service role (ignora RLS: só código do servidor). */
export function criarDbVendas(sb) {
  const um = (linhas) => (Array.isArray(linhas) && linhas[0]) || null;
  let temProvedor = null; // null = ainda não sabe se a migração 20261012120000 foi aplicada
  async function trocar(id, campos, deStatus) {
    const linhas = await dadosVendas(sb.from('pedidos').update(campos).eq('id', id).in('status', deStatus).select('id'));
    return !!(linhas && linhas.length);
  }
  /** Lê pedidos com as colunas do provedor; banco sem a migração nova (coluna inexistente) -> colunas antigas. */
  async function lerPedidos(filtrar) {
    if (temProvedor !== false) {
      const r = await filtrar(sb.from('pedidos').select(COLUNAS_PEDIDO + COLUNAS_PROVEDOR));
      if (!r.error) { temProvedor = true; return r.data; }
      const m = String(r.error.message || '') + ' ' + String(r.error.code || '');
      if (!/42703|PGRST204|provedor|checkout_url/.test(m)) return dadosVendas(Promise.resolve(r));
      temProvedor = false;
    }
    return dadosVendas(filtrar(sb.from('pedidos').select(COLUNAS_PEDIDO)));
  }
  /** Só os campos que o banco conhece (sem a migração nova, os do provedor ficam de fora). */
  function campos(c) {
    if (temProvedor !== false) return c;
    const x = Object.assign({}, c);
    ['provedor', 'provedor_ref', 'checkout_url', 'provedor_dados'].forEach((k) => { delete x[k]; });
    return x;
  }
  return {
    async pedidoPorId(id) {
      if (!RE_UUID_VENDAS.test(String(id || ''))) return null;
      return um(await lerPedidos((q) => q.eq('id', id).limit(1)));
    },
    /** Pedido pela referência do provedor (Stripe: id do PaymentIntent). */
    async pedidoPorRef(provedor, ref) {
      if (temProvedor === false || !ref) return null;
      return um(await lerPedidos((q) => q.eq('provedor', String(provedor)).eq('provedor_ref', String(ref)).limit(1)));
    },
    /** Pedido pelo token do link do relatório (meu-relatorio.html#t-<token>). */
    async pedidoPorToken(token) {
      if (!RE_TOKEN_VENDAS.test(String(token || ''))) return null;
      return um(await lerPedidos((q) => q.eq('token_acesso', String(token)).limit(1)));
    },
    async pedidoPorCobranca(cobrancaId) {
      return um(await lerPedidos((q) => q.eq('asaas_cobranca_id', String(cobrancaId)).limit(1)));
    },
    async gravarCobranca(id, cobrancaId, pagamento) {
      return trocar(id, campos({ asaas_cobranca_id: cobrancaId, pagamento, provedor: 'asaas' }), ['aguardando']);
    },
    /** Link do checkout da InfinitePay (só com o pedido aguardando). */
    async gravarCheckout(id, url, dados) {
      return trocar(id, { provedor: 'infinitepay', checkout_url: url, provedor_dados: limitarDados(dados) }, ['aguardando']);
    },
    /** PaymentIntent do Stripe criado para o pedido (só com o pedido aguardando). */
    async gravarIntent(id, ref, dados) {
      return trocar(id, { provedor: 'stripe', provedor_ref: ref, provedor_dados: limitarDados(dados) }, ['aguardando']);
    },
    /** Referência e dados brutos do provedor (qualquer status: só depuração/conferência). */
    async gravarProvedorDados(id, ref, dados) {
      const c = { provedor_dados: limitarDados(dados) };
      if (ref) c.provedor_ref = ref;
      await dadosVendas(sb.from('pedidos').update(campos(c)).eq('id', id));
    },
    /** extras: {provedor_ref, provedor_dados} (InfinitePay). */
    async marcarPago(id, metodo, extras) {
      const c = Object.assign({ status: 'pago', metodo: metodo || '' }, extras || {});
      if (c.provedor_dados !== undefined) c.provedor_dados = limitarDados(c.provedor_dados);
      return trocar(id, campos(c), ['aguardando', 'cancelado']);
    },
    async marcarEstornado(id) { return trocar(id, { status: 'estornado' }, ['pago', 'cortesia']); },
    async marcarCancelado(id) { return trocar(id, { status: 'cancelado' }, ['aguardando']); },
    async marcarVerificado(id, iso) { await dadosVendas(sb.from('pedidos').update({ verificado_em: iso }).eq('id', id)); },
    async pedidosLiberadosPorEmail(email) {
      return (await dadosVendas(sb.from('pedidos').select('id, pacote, token_acesso, status, criado_em').eq('email', email)
        .in('status', ['pago', 'cortesia']).order('criado_em', { ascending: false }).limit(10))) || [];
    },
    /** Registra uma tentativa e devolve quantas houve desde "desdeIso" (inclui esta). */
    async contarTentativa(tipo, chave, desdeIso, agoraIso) {
      await dadosVendas(sb.from('limites_vendas').insert({ tipo, chave: String(chave).substring(0, 200), em: agoraIso }));
      const linhas = await dadosVendas(sb.from('limites_vendas').select('id').eq('tipo', tipo).eq('chave', String(chave).substring(0, 200))
        .gte('em', desdeIso).limit(1000));
      return (linhas || []).length;
    }
  };
}

/** Base das funções de venda a partir do createClient do supabase-js e do getter de segredos. */
export function criarBaseVendas(createClient, getEnv, extras) {
  const env = lerEnvVendas(getEnv);
  const servico = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  return Object.assign({ env, fetch: (u, o) => fetch(u, o), db: criarDbVendas(servico) }, extras || {});
}

function contextoVendas(base) {
  const env = base.env || {};
  const agora = base.agora || (() => Date.now());
  return {
    env, agora, db: base.db,
    provedor: provedorPagamento(env),
    stripe: criarStripe({ chave: env.STRIPE_SECRET_KEY, fetch: base.fetch }),
    infinitepay: criarInfinitePay({ handle: env.INFINITEPAY_HANDLE, fetch: base.fetch }),
    asaas: criarAsaas({ apiKey: env.ASAAS_API_KEY, ambiente: env.ASAAS_AMBIENTE, fetch: base.fetch }),
    email: criarResend({ apiKey: env.RESEND_API_KEY, remetente: env.EMAIL_REMETENTE, fetch: base.fetch })
  };
}

// ---------------------------------------------------------------------------
// Regras
// ---------------------------------------------------------------------------

function baseDoSiteVendas(env) {
  const s = String((env && env.SITE_URL) || '').trim();
  if (!/^https?:\/\//i.test(s)) return '';
  return s.replace(/\/+$/, '') + '/';
}
export function linkRelatorio(env, token) {
  const base = baseDoSiteVendas(env);
  return base ? base + 'meu-relatorio.html#t-' + token : '';
}

/** Data 'YYYY-MM-DD' de Brasília, "dias" depois de agora. */
export function dataBrasil(agoraMs, dias) {
  return new Date(agoraMs - 3 * 3600 * 1000 + (dias || 0) * 86400000).toISOString().slice(0, 10);
}

function escaparHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** E-mail com o(s) link(s) do relatório. pedidos: [{pacote, token_acesso}] */
export function montarEmailAcesso(env, nome, pedidos) {
  const primeiro = String(nome || '').trim().split(/\s+/)[0] || '';
  const itens = pedidos.map((p) => ({ rotulo: NOMES_PACOTE[p.pacote] || 'Relatório', url: linkRelatorio(env, p.token_acesso) }));
  const ola = primeiro ? 'Olá, ' + primeiro + '!' : 'Olá!';
  const texto = [ola, '', 'Aqui está o acesso ao seu Mapa de Perfil:', '']
    .concat(itens.map((i) => i.rotulo + ': ' + i.url))
    .concat(['', 'Guarde este e-mail: o link é o seu acesso ao relatório.', '', 'Gestão sem Caos']).join('\n');
  const html = '<p>' + escaparHtml(ola) + '</p><p>Aqui está o acesso ao seu Mapa de Perfil:</p><ul>' +
    itens.map((i) => '<li><a href="' + escaparHtml(i.url) + '">' + escaparHtml(i.rotulo) + '</a></li>').join('') +
    '</ul><p>Guarde este e-mail: o link é o seu acesso ao relatório.</p><p>Gestão sem Caos</p>';
  return { assunto: 'Seu Mapa de Perfil — link de acesso', html, texto };
}

async function enviarEmailPago(ctx, pedido) {
  if (dadosDoPedido(pedido).teste === true) return false; // pedido de teste da aba Conexões: sem e-mail de acesso
  if (!ctx.email.configurado || !pedido.email || !linkRelatorio(ctx.env, pedido.token_acesso)) return false;
  try {
    const m = montarEmailAcesso(ctx.env, pedido.nome, [pedido]);
    await ctx.email.enviar({ para: pedido.email, assunto: m.assunto, html: m.html, texto: m.texto });
    return true;
  } catch (err) {
    try { console.error(err); } catch (e) { /* sem console */ }
    return false;
  }
}

/** Pedido do site: id + token conferidos (token em tempo constante). null se não bater. */
async function pedidoDoCliente(ctx, corpo) {
  const id = String(corpo.pedidoId || '');
  const token = String(corpo.tokenAcesso || '');
  if (!RE_UUID_VENDAS.test(id) || !RE_TOKEN_VENDAS.test(token)) return null;
  const p = await ctx.db.pedidoPorId(id);
  return p && iguaisSeguro(String(p.token_acesso || ''), token) ? p : null;
}

function respostaCobranca(p, cache) {
  return { ok: true, provedor: 'asaas', pix: cache.pix || null, cartaoUrl: cache.cartaoUrl || '', valor: p.valor_centavos, vencimento: cache.vencimento || '' };
}

function precisaDocumento(err) {
  const t = String((err && err.texto) || '').toLowerCase();
  return err && err.status === 400 && (/cpf|cnpj/.test(t) || (err.codigos || []).some((c) => /cpf|cnpj/i.test(c)));
}

export async function acaoCriarPagamento(ctx, corpo) {
  const p = await pedidoDoCliente(ctx, corpo);
  if (!p) return erro(MSG_PEDIDO_NAO_ENCONTRADO);
  if (p.status === 'pago' || p.status === 'cortesia') return { ok: true, status: p.status, pago: true };
  if (p.status !== 'aguardando') return erro('Este pedido não está mais aberto. Faça um novo pedido.');
  const prov = provedorDoPedido(ctx, p);
  if (prov === 'stripe') return criarStripePedido(ctx, p);
  if (prov === 'infinitepay') return criarInfinitePayPedido(ctx, p);
  if (prov !== 'asaas') return erro(MSG_PAG_NAO_CONFIGURADO);
  const cache = p.pagamento && typeof p.pagamento === 'object' ? p.pagamento : null;
  const agora = ctx.agora();
  if (cache && p.asaas_cobranca_id && cache.pix && Date.parse(cache.pix.expira || '') > agora + 5 * 60000) {
    return respostaCobranca(p, cache);
  }
  let doc = '';
  if (corpo.cpf !== undefined && corpo.cpf !== null && String(corpo.cpf).trim() !== '') {
    doc = documentoValido(corpo.cpf);
    if (!doc) return erro('CPF inválido. Confira os números.', { precisaCpf: true });
  }
  try {
    let cobrancaId = p.asaas_cobranca_id || '';
    let cartaoUrl = (cache && cache.cartaoUrl) || '';
    let vencimento = (cache && cache.vencimento) || '';
    if (!cobrancaId) {
      let cliente;
      try {
        cliente = await ctx.asaas.clienteCriar({ nome: p.nome || 'Cliente', email: p.email, cpfCnpj: doc, referencia: p.id });
      } catch (err) {
        if (precisaDocumento(err)) return erro(doc ? 'CPF recusado pelo meio de pagamento. Confira os números.' : MSG_PRECISA_CPF, { precisaCpf: true });
        throw err;
      }
      vencimento = dataBrasil(agora, 1);
      const c = await ctx.asaas.cobrancaCriar({
        cliente, valorCentavos: p.valor_centavos, vencimento, referencia: p.id,
        descricao: 'Mapa de Perfil DISC — ' + (NOMES_PACOTE[p.pacote] || p.pacote) + ' — Gestão sem Caos'
      });
      cobrancaId = c.id;
      cartaoUrl = c.invoiceUrl;
    }
    let pix = null;
    try { pix = await ctx.asaas.pixQrCode(cobrancaId); } catch (err) { pix = null; } // sem Pix: o cliente paga pela página do Asaas
    const novo = { pix, cartaoUrl, vencimento, criadoEm: new Date(agora).toISOString() };
    await ctx.db.gravarCobranca(p.id, cobrancaId, novo);
    return respostaCobranca(p, novo);
  } catch (err) {
    try { console.error(err); } catch (e) { /* sem console */ }
    return erro('Não foi possível gerar o pagamento agora. Tente de novo em instantes.');
  }
}

export async function acaoStatusPagamento(ctx, corpo) {
  const p = await pedidoDoCliente(ctx, corpo);
  if (!p) return erro(MSG_PEDIDO_NAO_ENCONTRADO);
  if (p.status === 'aguardando' && p.provedor === 'stripe') {
    if (!ctx.stripe.configurado || !idIntentStripe(p.provedor_ref)) return { ok: true, status: p.status };
    const ultimaS = Date.parse(p.verificado_em || '');
    if (isFinite(ultimaS) && ctx.agora() - ultimaS < VERIFICAR_ASAAS_MS) return { ok: true, status: p.status };
    await ctx.db.marcarVerificado(p.id, new Date(ctx.agora()).toISOString());
    try {
      const r = await conferirStripe(ctx, p, p.provedor_ref, 'status');
      return r.recusa ? { ok: true, status: r.status, recusado: true, mensagem: MSG_RECUSADO } : { ok: true, status: r.status };
    } catch (err) {
      try { console.error(err); } catch (e) { /* sem console */ }
      return { ok: true, status: p.status };
    }
  }
  if (p.status === 'aguardando' && p.provedor === 'infinitepay') {
    if (!ctx.infinitepay.configurado) return { ok: true, status: p.status };
    const refs = refsGuardadas(p);
    if (!refs.transactionNsu && !refs.slug) return { ok: true, status: p.status };
    const ultimaI = Date.parse(p.verificado_em || '');
    if (isFinite(ultimaI) && ctx.agora() - ultimaI < VERIFICAR_ASAAS_MS) return { ok: true, status: p.status };
    await ctx.db.marcarVerificado(p.id, new Date(ctx.agora()).toISOString());
    try {
      return { ok: true, status: (await conferirInfinitePay(ctx, p, refs, 'status')).status };
    } catch (err) {
      try { console.error(err); } catch (e) { /* sem console */ }
      return { ok: true, status: p.status };
    }
  }
  if (p.status !== 'aguardando' || !p.asaas_cobranca_id || !ctx.asaas.configurado) return { ok: true, status: p.status };
  const agora = ctx.agora();
  const ultima = Date.parse(p.verificado_em || '');
  if (isFinite(ultima) && agora - ultima < VERIFICAR_ASAAS_MS) return { ok: true, status: p.status };
  await ctx.db.marcarVerificado(p.id, new Date(agora).toISOString());
  try {
    const c = await ctx.asaas.cobranca(p.asaas_cobranca_id);
    if (ASAAS_PAGO.indexOf(String(c.status || '')) >= 0 && valorCobre(c.value, p.valor_centavos)) {
      if (await ctx.db.marcarPago(p.id, asaasMetodo(c.billingType))) await enviarEmailPago(ctx, p);
      return { ok: true, status: 'pago' };
    }
  } catch (err) {
    try { console.error(err); } catch (e) { /* sem console */ }
  }
  return { ok: true, status: p.status };
}

// ---------------------------------------------------------------------------
// InfinitePay
// ---------------------------------------------------------------------------

/** Provedor deste pedido: o que ele já usa (se ainda configurado) ou o escolhido pelos segredos. */
function provedorDoPedido(ctx, p) {
  if (p.provedor === 'stripe' && ctx.stripe.configurado) return 'stripe';
  if (p.provedor === 'infinitepay' && ctx.infinitepay.configurado) return 'infinitepay';
  if ((p.provedor === 'asaas' || p.asaas_cobranca_id) && ctx.asaas.configurado) return 'asaas';
  return ctx.provedor;
}

function dadosDoPedido(p) {
  return p.provedor_dados && typeof p.provedor_dados === 'object' && !Array.isArray(p.provedor_dados) ? p.provedor_dados : {};
}

/** transaction_nsu/slug já conhecidos (retorno do cliente ou webhook). */
function refsGuardadas(p) {
  const d = dadosDoPedido(p);
  const fontes = [d.retorno, d.webhook && lerRefsInfinitePay(d.webhook.corpo)];
  const refs = { transactionNsu: '', slug: '' };
  fontes.forEach((f) => {
    if (!f) return;
    if (!refs.transactionNsu && f.transactionNsu) refs.transactionNsu = refInfinitePay(f.transactionNsu);
    if (!refs.slug && f.slug) refs.slug = refInfinitePay(f.slug);
  });
  return refs;
}

export function urlRetornoInfinitePay(env, p) {
  const base = baseDoSiteVendas(env);
  return base ? base + 'meu-relatorio.html?pedido=' + encodeURIComponent(p.id) + '#t-' + p.token_acesso : '';
}

export function urlWebhookInfinitePay(env) {
  const s = String((env && env.SUPABASE_URL) || '').trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(s) ? s + '/functions/v1/infinitepay-webhook' : '';
}

async function criarInfinitePayPedido(ctx, p) {
  const agora = ctx.agora();
  const d = dadosDoPedido(p);
  const link = d.link && typeof d.link === 'object' ? d.link : null;
  if (p.provedor === 'infinitepay' && p.checkout_url && link && link.valor === p.valor_centavos &&
      agora - Date.parse(link.criadoEm || '') < LINK_INFINITEPAY_MS) {
    return { ok: true, provedor: 'infinitepay', redirecionarUrl: p.checkout_url, valor: p.valor_centavos };
  }
  const redirectUrl = urlRetornoInfinitePay(ctx.env, p);
  const webhookUrl = urlWebhookInfinitePay(ctx.env);
  if (!redirectUrl || !webhookUrl) {
    try { console.error('InfinitePay: defina SITE_URL (e SUPABASE_URL) nos segredos das Edge Functions.'); } catch (e) { /* sem console */ }
    return erro(MSG_PAG_NAO_CONFIGURADO);
  }
  try {
    const r = await ctx.infinitepay.criarLink({
      pedidoId: p.id, valorCentavos: p.valor_centavos, redirectUrl, webhookUrl,
      descricao: 'Mapa de Perfil DISC — ' + (NOMES_PACOTE[p.pacote] || p.pacote),
      cliente: { nome: p.nome, email: p.email }
    });
    const novo = Object.assign({}, d, { link: { url: r.url, valor: p.valor_centavos, criadoEm: new Date(agora).toISOString(), resposta: r.bruto } });
    await ctx.db.gravarCheckout(p.id, r.url, novo);
    return { ok: true, provedor: 'infinitepay', redirecionarUrl: r.url, valor: p.valor_centavos };
  } catch (err) {
    try { console.error(err); } catch (e) { /* sem console */ }
    return erro('Não foi possível gerar o pagamento agora. Tente de novo em instantes.');
  }
}

/**
 * Confere na InfinitePay (payment_check) e marca pago se paid=true e valor >= pedido. Lança erro se a InfinitePay
 * ou o banco falharem. {status, feito, motivo}
 */
async function conferirInfinitePay(ctx, p, refs, origem, extrasDados) {
  const c = await ctx.infinitepay.conferir({ pedidoId: p.id, transactionNsu: refs.transactionNsu, slug: refs.slug });
  const em = new Date(ctx.agora()).toISOString();
  const dados = Object.assign({}, dadosDoPedido(p), extrasDados || {}, { conferencia: { origem, em, resposta: c.bruto } });
  const ref = refs.transactionNsu || refs.slug || '';
  if (!c.pago) {
    await ctx.db.gravarProvedorDados(p.id, ref, dados);
    return { status: p.status, feito: false, motivo: 'nao_pago' };
  }
  if (!(c.valorCentavos >= Number(p.valor_centavos || 0))) {
    await ctx.db.gravarProvedorDados(p.id, ref, dados);
    return { status: p.status, feito: false, motivo: 'valor_menor' };
  }
  const mudou = await ctx.db.marcarPago(p.id, c.metodo || (refs.metodo || ''), { provedor_ref: ref || null, provedor_dados: dados });
  if (mudou) await enviarEmailPago(ctx, p);
  return { status: 'pago', feito: mudou, motivo: mudou ? 'pago' : 'repetido' };
}

export async function acaoConfirmarPagamento(ctx, corpo) {
  const p = await pedidoDoCliente(ctx, corpo);
  if (!p) return erro(MSG_PEDIDO_NAO_ENCONTRADO);
  if (p.provedor === 'stripe') return confirmarStripePedido(ctx, p, corpo);
  if (p.status !== 'aguardando' || p.provedor !== 'infinitepay' || !ctx.infinitepay.configurado) return { ok: true, status: p.status };
  const guardadas = refsGuardadas(p);
  const refs = {
    transactionNsu: refInfinitePay(corpo.transactionNsu) || guardadas.transactionNsu,
    slug: refInfinitePay(corpo.slug) || guardadas.slug
  };
  if (!refs.transactionNsu && !refs.slug) return { ok: true, status: p.status };
  const agora = ctx.agora();
  const ultima = Date.parse(p.verificado_em || '');
  if (isFinite(ultima) && agora - ultima < CONFIRMAR_MS) return { ok: true, status: p.status };
  await ctx.db.marcarVerificado(p.id, new Date(agora).toISOString());
  const retorno = { transactionNsu: refs.transactionNsu, slug: refs.slug, em: new Date(agora).toISOString() };
  try {
    return { ok: true, status: (await conferirInfinitePay(ctx, p, refs, 'retorno', { retorno })).status };
  } catch (err) {
    try { console.error(err); } catch (e) { /* sem console */ }
    // Guarda as referências para o "status" conferir de novo mais tarde.
    try { await ctx.db.gravarProvedorDados(p.id, refs.transactionNsu || refs.slug, Object.assign({}, dadosDoPedido(p), { retorno })); } catch (e) { /* ignora */ }
    return { ok: true, status: p.status };
  }
}

/** Webhook da InfinitePay (corpo NÃO confiável). {ok, feito, motivo}. Lança erro (com e.provedor se for a InfinitePay). */
export async function tratarWebhookInfinitePay(ctx, corpo) {
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) return { ok: true, feito: false, motivo: 'evento_invalido' };
  const refs = lerRefsInfinitePay(corpo);
  if (!RE_UUID_VENDAS.test(refs.orderNsu)) return { ok: true, feito: false, motivo: 'sem_pedido' };
  const p = await ctx.db.pedidoPorId(refs.orderNsu);
  if (!p) return { ok: true, feito: false, motivo: 'pedido_nao_encontrado' };
  if (p.provedor !== 'infinitepay') return { ok: true, feito: false, motivo: 'outro_provedor' };
  if (p.status !== 'aguardando' && p.status !== 'cancelado') return { ok: true, feito: false, motivo: 'repetido' };
  const webhook = { em: new Date(ctx.agora()).toISOString(), corpo };
  if (!ctx.infinitepay.configurado || (!refs.transactionNsu && !refs.slug)) {
    await ctx.db.gravarProvedorDados(p.id, '', Object.assign({}, dadosDoPedido(p), { webhook }));
    return { ok: true, feito: false, motivo: ctx.infinitepay.configurado ? 'sem_transacao' : 'nao_configurado' };
  }
  let r;
  try {
    r = await conferirInfinitePay(ctx, p, refs, 'webhook', { webhook });
  } catch (err) {
    if (err && /^InfinitePay:/.test(String(err.message || ''))) err.provedor = true;
    throw err;
  }
  return { ok: true, feito: r.feito, motivo: r.motivo };
}

// ---------------------------------------------------------------------------
// Stripe (Payment Element dentro do site)
// ---------------------------------------------------------------------------

export function urlRetornoStripe(env, p) { return urlRetornoInfinitePay(env, p); }

function intentGuardado(p) {
  const d = dadosDoPedido(p);
  return d.intent && typeof d.intent === 'object' ? d.intent : {};
}

async function criarStripePedido(ctx, p) {
  const publicavel = chavePublicavelStripe(ctx.env.STRIPE_PUBLISHABLE_KEY);
  if (!publicavel) {
    try { console.error('Stripe: defina STRIPE_PUBLISHABLE_KEY (pk_…) nos segredos das Edge Functions.'); } catch (e) { /* sem console */ }
    return erro(MSG_PAG_NAO_CONFIGURADO);
  }
  const agora = ctx.agora();
  const d = dadosDoPedido(p);
  const responder = (pi) => {
    const cs = segredoClienteStripe(pi && pi.client_secret);
    if (!cs) throw new Error('Stripe: PaymentIntent sem client_secret');
    return { ok: true, provedor: 'stripe', clientSecret: cs, publicavel, valor: p.valor_centavos };
  };
  try {
    let tentativa = 0;
    const atual = p.provedor === 'stripe' ? idIntentStripe(p.provedor_ref) : '';
    if (atual) {
      const pi = await ctx.stripe.intent(atual);
      const doPedido = pi && pi.metadata && String(pi.metadata.pedido_id || '') === String(p.id);
      if (pi.status === 'succeeded' && doPedido) {
        const r = await conferirStripe(ctx, p, atual, 'criar');
        if (r.status === 'pago') return { ok: true, status: 'pago', pago: true };
      }
      if (doPedido && STRIPE_ABERTOS.indexOf(String(pi.status)) >= 0 && Number(pi.amount) === Number(p.valor_centavos) && pi.currency === 'brl') {
        return responder(pi);
      }
      tentativa = (Number(intentGuardado(p).tentativa) || 0) + 1; // cancelado/outro valor: um PaymentIntent novo
    }
    const pi = await ctx.stripe.criarIntent({
      pedidoId: p.id, valorCentavos: p.valor_centavos, email: p.email, pacote: p.pacote, teste: d.teste === true,
      descricao: STRIPE_DESCRICAO,
      chaveIdempotencia: 'mapa-disc-' + p.id + '-' + p.valor_centavos + (tentativa ? '-' + tentativa : '')
    });
    const id = idIntentStripe(pi && pi.id);
    if (!id) throw new Error('Stripe: resposta sem o id do PaymentIntent');
    const novo = Object.assign({}, d, { intent: { id, valor: p.valor_centavos, tentativa, livemode: pi.livemode === true, criadoEm: new Date(agora).toISOString() } });
    await ctx.db.gravarIntent(p.id, id, novo);
    return responder(pi);
  } catch (err) {
    try { console.error(err); } catch (e) { /* sem console */ }
    return erro('Não foi possível gerar o pagamento agora. Tente de novo em instantes.');
  }
}

/**
 * Busca o PaymentIntent no Stripe e marca pago só se: status 'succeeded', metadata[pedido_id] = pedido, moeda brl e
 * amount_received >= valor do pedido. Lança erro se o Stripe ou o banco falharem. {status, feito, motivo}
 */
async function conferirStripe(ctx, p, piId, origem) {
  const pi = await ctx.stripe.intent(piId, { expandir: ['payment_method'] });
  const em = new Date(ctx.agora()).toISOString();
  const resumo = { id: String(pi.id || ''), status: String(pi.status || ''), amount: pi.amount, amount_received: pi.amount_received,
    currency: pi.currency, livemode: pi.livemode === true };
  const dados = Object.assign({}, dadosDoPedido(p), { conferencia: { origem, em, intent: resumo } });
  if (!pi.metadata || String(pi.metadata.pedido_id || '') !== String(p.id)) return { status: p.status, feito: false, motivo: 'outro_pedido' };
  if (pi.status !== 'succeeded') {
    const recusa = pi.status === 'requires_payment_method' ? recusaStripe(pi) : null;
    if (recusa) return { status: p.status, feito: false, motivo: 'recusado', recusa };
    return { status: p.status, feito: false, motivo: 'nao_pago' };
  }
  if (String(pi.currency || '').toLowerCase() !== 'brl' || !(Number(pi.amount_received) >= Number(p.valor_centavos || 0))) {
    await ctx.db.gravarProvedorDados(p.id, '', dados);
    return { status: p.status, feito: false, motivo: 'valor_menor' };
  }
  const mudou = await ctx.db.marcarPago(p.id, stripeMetodo(pi), { provedor: 'stripe', provedor_ref: idIntentStripe(pi.id) || null, provedor_dados: dados });
  if (mudou) await enviarEmailPago(ctx, p);
  return { status: 'pago', feito: mudou, motivo: mudou ? 'pago' : 'repetido' };
}

async function confirmarStripePedido(ctx, p, corpo) {
  if (p.status !== 'aguardando' || !ctx.stripe.configurado) return { ok: true, status: p.status };
  // O id vem do banco; o da URL (payment_intent) só vale se for o mesmo (ou se o banco ainda não tiver um).
  const doBanco = idIntentStripe(p.provedor_ref);
  const daUrl = idIntentStripe(corpo.paymentIntent);
  const id = doBanco || daUrl;
  if (!id) return { ok: true, status: p.status };
  const agora = ctx.agora();
  const ultima = Date.parse(p.verificado_em || '');
  if (isFinite(ultima) && agora - ultima < CONFIRMAR_MS) return { ok: true, status: p.status };
  await ctx.db.marcarVerificado(p.id, new Date(agora).toISOString());
  try {
    let r = await conferirStripe(ctx, p, id, 'retorno');
    // Um PaymentIntent anterior do mesmo pedido pode ter sido o pago (a URL diz qual).
    if (r.status !== 'pago' && daUrl && daUrl !== id) r = await conferirStripe(ctx, p, daUrl, 'retorno');
    return { ok: true, status: r.status };
  } catch (err) {
    try { console.error(err); } catch (e) { /* sem console */ }
    return { ok: true, status: p.status };
  }
}

/** Pedido de um objeto do Stripe: metadata[pedido_id] ou pedidos.provedor_ref = PaymentIntent. */
async function pedidoDoStripe(ctx, pedidoId, piId) {
  let p = RE_UUID_VENDAS.test(String(pedidoId || '')) ? await ctx.db.pedidoPorId(String(pedidoId)) : null;
  if (!p && piId && typeof ctx.db.pedidoPorRef === 'function') p = await ctx.db.pedidoPorRef('stripe', piId);
  return p;
}

/** Evento do Stripe já autenticado (assinatura conferida). {ok, feito, motivo}. Lança erro (e.provedor se for o Stripe). */
export async function tratarEventoStripe(ctx, evento) {
  if (!evento || typeof evento !== 'object' || Array.isArray(evento)) return { ok: true, feito: false, motivo: 'evento_invalido' };
  const tipo = String(evento.type || '');
  const obj = evento.data && evento.data.object && typeof evento.data.object === 'object' ? evento.data.object : null;
  if (!obj) return { ok: true, feito: false, motivo: 'evento_invalido' };
  if (tipo === 'payment_intent.succeeded') {
    const piId = idIntentStripe(obj.id);
    if (!piId) return { ok: true, feito: false, motivo: 'sem_pagamento' };
    const p = await pedidoDoStripe(ctx, obj.metadata && obj.metadata.pedido_id, piId);
    if (!p) return { ok: true, feito: false, motivo: 'pedido_nao_encontrado' };
    if (p.status !== 'aguardando' && p.status !== 'cancelado') return { ok: true, feito: false, motivo: 'repetido' };
    if (!ctx.stripe.configurado) return { ok: true, feito: false, motivo: 'nao_configurado' };
    let r;
    try {
      r = await conferirStripe(ctx, p, piId, 'webhook');
    } catch (err) {
      if (err && /^Stripe:/.test(String(err.message || ''))) err.provedor = true;
      throw err;
    }
    return { ok: true, feito: r.feito, motivo: r.motivo };
  }
  if (tipo === 'payment_intent.payment_failed') {
    const piId = idIntentStripe(obj.id);
    if (!piId) return { ok: true, feito: false, motivo: 'sem_pagamento' };
    const p = await pedidoDoStripe(ctx, obj.metadata && obj.metadata.pedido_id, piId);
    if (!p) return { ok: true, feito: false, motivo: 'pedido_nao_encontrado' };
    if (p.provedor && p.provedor !== 'stripe') return { ok: true, feito: false, motivo: 'outro_provedor' };
    if (p.status !== 'aguardando') return { ok: true, feito: false, motivo: 'repetido' };
    const recusa = Object.assign({ em: new Date(ctx.agora()).toISOString(), intent: piId }, recusaStripe(obj) || { codigo: '', motivo: '', tipo: '', metodo: '', mensagem: '' });
    await ctx.db.gravarProvedorDados(p.id, '', Object.assign({}, dadosDoPedido(p), { recusa }));
    return { ok: true, feito: true, motivo: 'recusado' };
  }
  if (tipo === 'charge.refunded' || tipo === 'charge.dispute.created') {
    const piId = idIntentStripe(typeof obj.payment_intent === 'object' && obj.payment_intent ? obj.payment_intent.id : obj.payment_intent);
    if (!piId) return { ok: true, feito: false, motivo: 'sem_pagamento' };
    const p = await pedidoDoStripe(ctx, obj.metadata && obj.metadata.pedido_id, piId);
    if (!p) return { ok: true, feito: false, motivo: 'pedido_nao_encontrado' };
    if (p.provedor && p.provedor !== 'stripe') return { ok: true, feito: false, motivo: 'outro_provedor' };
    const mudou = await ctx.db.marcarEstornado(p.id);
    return { ok: true, feito: mudou, motivo: mudou ? 'estornado' : 'repetido' };
  }
  return { ok: true, feito: false, motivo: 'evento_ignorado' };
}

export async function acaoRecuperarAcesso(ctx, corpo) {
  const email = normalizarEmail(corpo.email);
  if (!emailValido(email)) return erro('Informe um e-mail válido.');
  if (!ctx.email.configurado || !baseDoSiteVendas(ctx.env)) return erro(MSG_EMAIL_NAO_CONFIGURADO);
  const hora = new Date(ctx.agora() - 3600000).toISOString();
  const agoraIso = new Date(ctx.agora()).toISOString();
  if (await ctx.db.contarTentativa('recuperar', email, hora, agoraIso) > 3) return erro('Muitos pedidos para este e-mail. Tente de novo daqui a 1 hora.');
  if (await ctx.db.contarTentativa('recuperar_total', '*', hora, agoraIso) > 60) return erro('Muitos pedidos agora. Tente de novo mais tarde.');
  const pedidos = await ctx.db.pedidosLiberadosPorEmail(email);
  if (pedidos.length) {
    const m = montarEmailAcesso(ctx.env, '', pedidos);
    try {
      await ctx.email.enviar({ para: email, assunto: m.assunto, html: m.html, texto: m.texto });
    } catch (err) {
      try { console.error(err); } catch (e) { /* sem console */ }
      return erro('Não foi possível enviar o e-mail agora. Tente de novo em instantes ou fale com o suporte.');
    }
  }
  return { ok: true };
}

/** "Enviar para meu e-mail" (meu-relatorio.html): manda o link do relatório para o e-mail da compra. */
export async function acaoEnviarLink(ctx, corpo) {
  const token = String(corpo.tokenAcesso || '');
  if (!RE_TOKEN_VENDAS.test(token)) return erro(MSG_PEDIDO_NAO_ENCONTRADO);
  if (!ctx.email.configurado || !baseDoSiteVendas(ctx.env)) return erro(MSG_EMAIL_NAO_CONFIGURADO);
  const p = typeof ctx.db.pedidoPorToken === 'function' ? await ctx.db.pedidoPorToken(token) : null;
  if (!p || !iguaisSeguro(String(p.token_acesso || ''), token) || (p.status !== 'pago' && p.status !== 'cortesia') || !p.email) {
    return erro(MSG_PEDIDO_NAO_ENCONTRADO);
  }
  const hora = new Date(ctx.agora() - 3600000).toISOString();
  const agoraIso = new Date(ctx.agora()).toISOString();
  if (await ctx.db.contarTentativa('enviar_link', p.id, hora, agoraIso) > 3) return erro('Já enviamos o link algumas vezes. Tente de novo daqui a 1 hora.');
  if (await ctx.db.contarTentativa('recuperar_total', '*', hora, agoraIso) > 60) return erro('Muitos pedidos agora. Tente de novo mais tarde.');
  const m = montarEmailAcesso(ctx.env, p.nome, [p]);
  try {
    await ctx.email.enviar({ para: p.email, assunto: m.assunto, html: m.html, texto: m.texto });
  } catch (err) {
    try { console.error(err); } catch (e) { /* sem console */ }
    return erro('Não foi possível enviar o e-mail agora. Tente de novo em instantes ou fale com o suporte.');
  }
  return { ok: true, email: mascararEmail(p.email) };
}

/** "bia@exemplo.com" -> "b**@exemplo.com" (a tela confirma para onde foi sem expor o e-mail inteiro). */
export function mascararEmail(email) {
  const s = String(email || '');
  const i = s.indexOf('@');
  if (i < 1) return '';
  return s.charAt(0) + '*'.repeat(Math.max(2, Math.min(6, i - 1))) + s.slice(i);
}

function valorCobre(valor, centavos) {
  const v = Number(valor);
  return isFinite(v) && Math.round(v * 100) >= Number(centavos || 0);
}

/** Evento do Asaas já autenticado. {ok, feito, motivo} (só para log/testes). Lança erro se o banco falhar. */
export async function tratarEventoAsaas(ctx, evento) {
  if (!evento || typeof evento !== 'object') return { ok: true, feito: false, motivo: 'evento_invalido' };
  const tipo = String(evento.event || '');
  const pag = evento.payment && typeof evento.payment === 'object' ? evento.payment : null;
  if (!pag || !pag.id) return { ok: true, feito: false, motivo: 'sem_cobranca' };
  const pago = ASAAS_EVENTOS_PAGO.indexOf(tipo) >= 0;
  const estorno = ASAAS_EVENTOS_ESTORNO.indexOf(tipo) >= 0;
  const cancela = ASAAS_EVENTOS_CANCELA.indexOf(tipo) >= 0;
  if (!pago && !estorno && !cancela) return { ok: true, feito: false, motivo: 'evento_ignorado' };
  let p = await ctx.db.pedidoPorCobranca(String(pag.id));
  if (!p && RE_UUID_VENDAS.test(String(pag.externalReference || ''))) {
    p = await ctx.db.pedidoPorId(String(pag.externalReference));
    if (p && p.asaas_cobranca_id && p.asaas_cobranca_id !== String(pag.id)) p = null; // outra cobrança: ignora
  }
  if (!p) return { ok: true, feito: false, motivo: 'pedido_nao_encontrado' };
  if (pago) {
    if (!valorCobre(pag.value, p.valor_centavos)) return { ok: true, feito: false, motivo: 'valor_menor' };
    const mudou = await ctx.db.marcarPago(p.id, asaasMetodo(pag.billingType));
    if (mudou) await enviarEmailPago(ctx, p);
    return { ok: true, feito: mudou, motivo: mudou ? 'pago' : 'repetido' };
  }
  if (estorno) {
    const mudou = await ctx.db.marcarEstornado(p.id);
    return { ok: true, feito: mudou, motivo: mudou ? 'estornado' : 'repetido' };
  }
  const mudou = await ctx.db.marcarCancelado(p.id);
  return { ok: true, feito: mudou, motivo: mudou ? 'cancelado' : 'repetido' };
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

function respJson(obj, status, extras) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, extras || {})
  });
}

/** CORS: só a origem do SITE_URL (e localhost/127.0.0.1 para testes). */
export function corsVendas(req, env) {
  const origem = req.headers.get('origin') || '';
  const h = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
  let site = '';
  try { site = env && env.SITE_URL ? new URL(String(env.SITE_URL).trim()).origin : ''; } catch (err) { site = ''; }
  if (origem && (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/.test(origem) || (site && origem === site))) {
    h['Access-Control-Allow-Origin'] = origem;
  }
  return h;
}

/** Edge Function "pagamento" (pública; "Verify JWT" desligado). */
export async function atenderPagamento(req, base) {
  const cors = corsVendas(req, base.env);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return respJson(erro('Método não permitido.'), 405, cors);
  try {
    const texto = await req.text();
    if (!texto) return respJson(erro('Requisição vazia.'), 200, cors);
    if (texto.length > LIMITE_CORPO_PAGAMENTO) return respJson(erro('Requisição grande demais.'), 200, cors);
    let corpo;
    try { corpo = JSON.parse(texto); } catch (err) { return respJson(erro('JSON inválido.'), 200, cors); }
    if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) return respJson(erro('Formato de requisição inválido.'), 200, cors);
    const ctx = contextoVendas(base);
    let r;
    if (corpo.acao === 'criar') r = await acaoCriarPagamento(ctx, corpo);
    else if (corpo.acao === 'status') r = await acaoStatusPagamento(ctx, corpo);
    else if (corpo.acao === 'confirmar') r = await acaoConfirmarPagamento(ctx, corpo);
    else if (corpo.acao === 'recuperar') r = await acaoRecuperarAcesso(ctx, corpo);
    else if (corpo.acao === 'enviarLink') r = await acaoEnviarLink(ctx, corpo);
    else r = erro('Ação desconhecida.');
    return respJson(r, 200, cors);
  } catch (err) {
    try { console.error(err); } catch (e) { /* sem console */ }
    return respJson(erro(MSG_ERRO_INTERNO), 200, cors);
  }
}

/** Edge Function "asaas-webhook" (pública; "Verify JWT" desligado): confere asaas-access-token. */
export async function atenderWebhookAsaas(req, base) {
  if (req.method !== 'POST') return respJson(erro('Método não permitido.'), 405);
  const segredo = base.env && base.env.ASAAS_WEBHOOK_TOKEN;
  if (!segredo) return respJson(erro('Webhook não configurado: defina o segredo ASAAS_WEBHOOK_TOKEN.'), 503);
  if (!iguaisSeguro(String(req.headers.get('asaas-access-token') || ''), segredo)) return respJson(erro('Token inválido.'), 401);
  const texto = await req.text();
  if (texto.length > LIMITE_CORPO_ASAAS) return respJson(erro('Requisição grande demais.'), 413);
  let evento;
  try { evento = JSON.parse(texto); } catch (err) { return respJson(erro('JSON inválido.'), 400); }
  try {
    const r = await tratarEventoAsaas(contextoVendas(base), evento);
    return respJson(r, 200);
  } catch (err) {
    try { console.error(err); } catch (e) { /* sem console */ }
    return respJson(erro(MSG_ERRO_INTERNO), 500);
  }
}

/** Edge Function "infinitepay-webhook" (pública; "Verify JWT" desligado). Sem assinatura: confere com payment_check. */
export async function atenderWebhookInfinitePay(req, base) {
  if (req.method !== 'POST') return respJson(erro('Método não permitido.'), 405);
  const texto = await req.text();
  if (texto.length > LIMITE_CORPO_INFINITEPAY) return respJson(erro('Requisição grande demais.'), 413);
  let corpo;
  try { corpo = JSON.parse(texto); } catch (err) { return respJson(erro('JSON inválido.'), 400); }
  try {
    return respJson(await tratarWebhookInfinitePay(contextoVendas(base), corpo), 200);
  } catch (err) {
    try { console.error(err); } catch (e) { /* sem console */ }
    return respJson(erro(MSG_ERRO_INTERNO), err && err.provedor ? 502 : 500);
  }
}

/** Edge Function "stripe-webhook" (pública; "Verify JWT" desligado): confere a assinatura Stripe-Signature. */
export async function atenderWebhookStripe(req, base) {
  if (req.method !== 'POST') return respJson(erro('Método não permitido.'), 405);
  const segredo = base.env && base.env.STRIPE_WEBHOOK_SECRET;
  if (!segredo) return respJson(erro('Webhook não configurado: defina o segredo STRIPE_WEBHOOK_SECRET.'), 503);
  const texto = await req.text();
  if (texto.length > LIMITE_CORPO_STRIPE) return respJson(erro('Requisição grande demais.'), 413);
  const agora = (base.agora || (() => Date.now()))();
  let assinatura;
  try {
    assinatura = await verificarAssinaturaStripe({ corpo: texto, cabecalho: req.headers.get('stripe-signature'), segredo, agoraMs: agora });
  } catch (err) {
    try { console.error(err); } catch (e) { /* sem console */ }
    return respJson(erro(MSG_ERRO_INTERNO), 500);
  }
  if (!assinatura.ok) return respJson(erro('Assinatura inválida.', { motivo: assinatura.motivo }), 400);
  let evento;
  try { evento = JSON.parse(texto); } catch (err) { return respJson(erro('JSON inválido.'), 400); }
  try {
    return respJson(await tratarEventoStripe(contextoVendas(base), evento), 200);
  } catch (err) {
    try { console.error(err); } catch (e) { /* sem console */ }
    return respJson(erro(MSG_ERRO_INTERNO), err && err.provedor ? 502 : 500);
  }
}
