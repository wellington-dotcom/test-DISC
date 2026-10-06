// Aba "Conexões" do painel: ações conexoes.diagnostico e conexoes.testar da Edge Function "admin" (só administrador).
// Sem nada do Deno: recebe fetch/env/db pelo ctx (testável no Node com respostas falsas).
//
// REGRA DE OURO: nenhuma resposta leva o VALOR de um segredo. Só "existe: sim/não", o provedor escolhido (não é
// segredo), as 2 primeiras letras da InfiniteTag e mensagens. Tudo que volta passa por ocultarSegredos().
// Cada teste externo tem prazo de no máximo CONEXOES_PRAZO_MS (8 s).
//
//   conexoes.diagnostico {} -> {ok, versao, em, siteUrl, segredos:{NOME: bool}, pagamento:{provedor, provedorEscolhido,
//     handleParcial, asaasAmbiente, stripeModo:'teste'|'producao'|'', stripePublicavelModo, stripeDominio}, funcoes:[{nome, publicada:true|false|null, status, mensagem}],
//     auth:{cadastroFechado:true|false|null}, pedidoTeste:{id, status, criadoEm, url}|null, colunaTeste:bool|null}
//   conexoes.testar {alvo, ...} -> {ok, alvo, sucesso:bool, mensagem, verificado, detalhes?}
//     alvo: 'funcoes' | 'clickup' | 'asaas' | 'ia' | 'email' (manda um e-mail para o admin logado)
//           'infinitepay.link'      cria um pedido de TESTE (pedidos.teste = true, R$ 1,00; fora das vendas/receita) e um
//                                   link real de checkout. Nada é cobrado se ninguém pagar. -> detalhes {url, pedidoId}
//           'infinitepay.verificar' {pedidoId?, transactionNsu?, slug?} confere o pedido de teste no payment_check.
//           'stripe'                chave aceita (GET /v1/balance, nada é criado), modo teste/produção pelo prefixo e se o
//                                   domínio do site está em payment_method_domains (Apple Pay / Google Pay).
//                                   -> detalhes {modo, dominio, dominioRegistrado, applePay, googlePay}
//           'stripe.pagamento'      cria um pedido de TESTE (R$ 1,00, fora das vendas) e um PaymentIntent real para pagar
//                                   no próprio painel (Payment Element). -> detalhes {pedidoId, clientSecret, publicavel,
//                                   valorCentavos, modo, retornoUrl}
//           'stripe.verificar'      {pedidoId?} confere o PaymentIntent do pedido de teste no Stripe e marca pago.
import { erro, limparTexto } from './regras.js';
import { criarClickUp } from './clickup.js';
import { criarInfinitePay, refInfinitePay, lerRefsInfinitePay } from './infinitepay.js';
import { criarAsaas, criarResend, asaasAmbiente } from './asaas.js';
import { criarStripe, modoStripe, tipoChaveStripe, chavePublicavelStripe, segredoClienteStripe, idIntentStripe, stripeMetodo } from './stripe.js';

export const CONEXOES_VERSAO = 1;
export const CONEXOES_PRAZO_MS = 8000;
export const FUNCOES_EDGE = ['admin', 'disc-sync', 'clickup-webhook', 'pagamento', 'stripe-webhook', 'asaas-webhook', 'infinitepay-webhook'];
export const SEGREDOS_CONEXOES = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SITE_URL',
  'PAGAMENTO_PROVEDOR', 'STRIPE_SECRET_KEY', 'STRIPE_PUBLISHABLE_KEY', 'STRIPE_WEBHOOK_SECRET', 'INFINITEPAY_HANDLE', 'ASAAS_API_KEY', 'ASAAS_WEBHOOK_TOKEN', 'ASAAS_AMBIENTE',
  'RESEND_API_KEY', 'EMAIL_REMETENTE', 'CLICKUP_TOKEN', 'CLICKUP_PASTA_ID', 'CLICKUP_WEBHOOK_SECRET', 'ANTHROPIC_API_KEY'];
// Segredos de verdade (o valor nunca sai do servidor). SITE_URL, PAGAMENTO_PROVEDOR e ASAAS_AMBIENTE são configuração.
const SEGREDOS_OCULTOS = ['SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'INFINITEPAY_HANDLE', 'ASAAS_API_KEY',
  'ASAAS_WEBHOOK_TOKEN', 'RESEND_API_KEY', 'CLICKUP_TOKEN', 'CLICKUP_WEBHOOK_SECRET', 'ANTHROPIC_API_KEY'];
export const VALOR_TESTE_CENTAVOS = 100;
const ANTHROPIC_MODELOS = 'https://api.anthropic.com/v1/models?limit=1';
export const DOMINIO_PADRAO_STRIPE = 'disc.gestaosemcaos.com.br';
const RE_UUID_CX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cxAgoraIso(ctx) { return new Date(ctx.agora()).toISOString(); }
function cxPrazo(ctx) { return Math.min(CONEXOES_PRAZO_MS, Number(ctx.prazoConexoesMs) || CONEXOES_PRAZO_MS); }
function cxTem(env, nome) { return !!String((env && env[nome]) || '').trim(); }

/** Troca qualquer valor de segredo que apareça no texto por "***" (rede de segurança das mensagens). */
export function ocultarSegredos(texto, env) {
  let s = String(texto == null ? '' : texto);
  SEGREDOS_OCULTOS.forEach((n) => {
    const v = String((env && env[n]) || '').trim();
    if (v.length >= 4) s = s.split(v).join('***');
  });
  return s;
}

/** Só as 2 primeiras letras + "***" (a InfiniteTag não aparece inteira). */
export function parcial(valor) {
  const v = String(valor == null ? '' : valor).trim().replace(/^[$@]+/, '');
  return v ? v.substring(0, 2) + '***' : '';
}

/** Promessa com prazo: passou de ms -> Error com tempoEsgotado = true. */
export function comPrazo(promessa, ms) {
  let timer;
  const limite = new Promise((_, rejeitar) => {
    timer = setTimeout(() => { const e = new Error('tempo esgotado'); e.tempoEsgotado = true; rejeitar(e); }, ms);
  });
  return Promise.race([Promise.resolve(promessa), limite]).finally(() => clearTimeout(timer));
}

/** fetch que desiste depois de ms (aborta a requisição). */
export function fetchComPrazo(fetchFn, ms) {
  return async (url, op) => {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const o = Object.assign({}, op || {});
    if (ctl) {
      if (o.signal) { if (o.signal.aborted) ctl.abort(); else o.signal.addEventListener('abort', () => ctl.abort()); }
      o.signal = ctl.signal;
    }
    return comPrazo(fetchFn(url, o), ms).catch((err) => { if (ctl) ctl.abort(); throw err; });
  };
}

function statusDoErro(err) {
  if (err && Number(err.status)) return Number(err.status);
  const m = /(?:HTTP|respondeu)\s+(\d{3})/.exec(String((err && err.message) || ''));
  return m ? Number(m[1]) : 0;
}

/** Erro de um serviço externo -> frase curta em português simples (sem detalhes técnicos nem segredos). */
export function traduzirErro(servico, err) {
  if (err && err.tempoEsgotado) return servico + ' não respondeu em 8 segundos. Pode ser instabilidade: tente de novo em alguns minutos.';
  const st = statusDoErro(err);
  if (st === 401) return servico + ' recusou a chave: ela está errada, foi apagada ou trocada. Gere uma nova e atualize o segredo.';
  if (st === 403) return servico + ' recusou o pedido por falta de permissão (chave sem acesso a isto, ou domínio/conta não verificados).';
  if (st === 404) return servico + ' não encontrou o endereço chamado (conta, ambiente ou recurso errado).';
  if (st === 422 || st === 400) return servico + ' recusou os dados enviados (erro ' + st + '). Confira a configuração da conta.';
  if (st === 429) return servico + ' recebeu chamadas demais agora. Espere 1 minuto e teste de novo.';
  if (st >= 500) return servico + ' está com problema do lado dele (erro ' + st + '). Tente de novo mais tarde.';
  if (st >= 400) return servico + ' recusou o pedido (erro ' + st + ').';
  return 'Não foi possível falar com ' + servico + ' (sem resposta da rede). Tente de novo em instantes.';
}

function resultado(ctx, alvo, sucesso, mensagem, verificado, detalhes) {
  const r = { ok: true, alvo, sucesso: !!sucesso, mensagem: ocultarSegredos(mensagem, ctx.env), verificado: verificado || '', em: cxAgoraIso(ctx) };
  if (detalhes) {
    // O link de checkout é público e leva a InfiniteTag no endereço: ele passa inteiro; o resto é filtrado.
    const url = detalhes.url;
    r.detalhes = JSON.parse(ocultarSegredos(JSON.stringify(Object.assign({}, detalhes, { url: undefined })), ctx.env));
    if (url) r.detalhes.url = String(url);
  }
  return r;
}

/** Provedor que o site usa agora (mesma regra de pagamento.js). */
function provedorAtual(env) {
  const escolhido = String(env.PAGAMENTO_PROVEDOR || '').trim().toLowerCase();
  if (escolhido === 'stripe') return cxTem(env, 'STRIPE_SECRET_KEY') ? 'stripe' : '';
  if (escolhido === 'infinitepay') return cxTem(env, 'INFINITEPAY_HANDLE') ? 'infinitepay' : '';
  if (escolhido === 'asaas') return cxTem(env, 'ASAAS_API_KEY') ? 'asaas' : '';
  if (cxTem(env, 'STRIPE_SECRET_KEY')) return 'stripe';
  if (cxTem(env, 'INFINITEPAY_HANDLE')) return 'infinitepay';
  if (cxTem(env, 'ASAAS_API_KEY')) return 'asaas';
  return '';
}

/** Domínio do site (para Apple Pay / Google Pay): host do SITE_URL; sem ele, o domínio oficial. */
function dominioSite(env) {
  try { const h = new URL(String(env.SITE_URL || '').trim()).hostname; if (h && !/^(localhost|127\.0\.0\.1)$/.test(h)) return h.toLowerCase(); } catch (e) { /* sem SITE_URL */ }
  return DOMINIO_PADRAO_STRIPE;
}

function baseSupabase(env) {
  const s = String(env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(s) ? s : '';
}

function siteBase(env) {
  const s = String(env.SITE_URL || '').trim();
  if (!/^https?:\/\//i.test(s)) return '';
  return s.replace(/\/+$/, '') + '/';
}

// ---------------------------------------------------------------------------
// Funções publicadas (o SERVIDOR chama: sem CORS no navegador)
// ---------------------------------------------------------------------------

/** OPTIONS em SUPABASE_URL/functions/v1/<nome>: 404 = não publicada; qualquer outra resposta = publicada. */
export async function pingFuncao(ctx, nome) {
  const base = baseSupabase(ctx.env);
  if (!base) return { nome, publicada: null, status: 0, mensagem: 'SUPABASE_URL não disponível no servidor.' };
  const f = fetchComPrazo(ctx.fetch, cxPrazo(ctx));
  try {
    const headers = {};
    if (cxTem(ctx.env, 'SUPABASE_ANON_KEY')) headers.apikey = ctx.env.SUPABASE_ANON_KEY;
    const r = await f(base + '/functions/v1/' + nome, { method: 'OPTIONS', headers });
    try { await r.text(); } catch (e) { /* corpo ignorado */ }
    if (r.status === 404) return { nome, publicada: false, status: 404, mensagem: 'Não publicada (o Supabase respondeu 404).' };
    if (r.status >= 500) return { nome, publicada: true, status: r.status, mensagem: 'Publicada, mas respondeu com erro ' + r.status + '.' };
    return { nome, publicada: true, status: r.status, mensagem: 'Publicada (respondeu ' + r.status + ').' };
  } catch (err) {
    return { nome, publicada: null, status: 0, mensagem: traduzirErro('O Supabase', err) };
  }
}

async function funcoesPublicadas(ctx) {
  return Promise.all(FUNCOES_EDGE.map((nome) => (nome === 'admin'
    ? { nome, publicada: true, status: 200, mensagem: 'Publicada (é ela que está respondendo agora).' }
    : pingFuncao(ctx, nome))));
}

/** Cadastro livre fechado? GET /auth/v1/settings (público) -> disable_signup. null = não deu para saber. */
async function cadastroFechado(ctx) {
  const base = baseSupabase(ctx.env);
  if (!base || !cxTem(ctx.env, 'SUPABASE_ANON_KEY')) return null;
  try {
    const r = await fetchComPrazo(ctx.fetch, cxPrazo(ctx))(base + '/auth/v1/settings', { method: 'GET', headers: { apikey: ctx.env.SUPABASE_ANON_KEY } });
    if (!r.ok) return null;
    const j = await r.json();
    return j && typeof j.disable_signup === 'boolean' ? j.disable_signup : null;
  } catch (err) {
    return null;
  }
}

function provedorRecusado(err) {
  const c = err && err.causa ? String(err.causa.code || '') + ' ' + String(err.causa.message || '') : String((err && err.message) || '');
  return /23514|pedidos_provedor_valido/.test(c);
}

function colunaInexistente(err) {
  const c = err && err.causa ? String(err.causa.code || '') + ' ' + String(err.causa.message || '') : String((err && err.message) || '');
  return /42703|PGRST204|teste/.test(c);
}

function pedidoTesteSaida(p) {
  if (!p) return null;
  return { id: String(p.id), status: String(p.status || ''), criadoEm: p.criado_em || '', url: p.checkout_url || '' };
}

// ---------------------------------------------------------------------------
// Ações
// ---------------------------------------------------------------------------

export async function acaoDiagnostico(ctx) {
  const env = ctx.env || {};
  const segredos = {};
  SEGREDOS_CONEXOES.forEach((n) => { segredos[n] = cxTem(env, n); });
  const escolhido = String(env.PAGAMENTO_PROVEDOR || '').trim().toLowerCase();
  const [funcoes, fechado, teste] = await Promise.all([
    funcoesPublicadas(ctx),
    cadastroFechado(ctx),
    (async () => {
      if (!ctx.db || typeof ctx.db.pedidoTesteUltimo !== 'function') return { coluna: null, pedido: null };
      try { return { coluna: true, pedido: await comPrazo(ctx.db.pedidoTesteUltimo(), cxPrazo(ctx)) }; } catch (err) {
        return { coluna: colunaInexistente(err) ? false : null, pedido: null };
      }
    })()
  ]);
  const site = siteBase(env);
  return {
    ok: true, versao: CONEXOES_VERSAO, em: cxAgoraIso(ctx),
    siteUrl: site,
    segredos,
    pagamento: {
      provedor: provedorAtual(env),
      // PAGAMENTO_PROVEDOR não é segredo: mostra o valor (só os conhecidos; outro texto vira 'invalido').
      provedorEscolhido: !escolhido ? '' : (['stripe', 'infinitepay', 'asaas'].indexOf(escolhido) >= 0 ? escolhido : 'invalido'),
      handleParcial: parcial(env.INFINITEPAY_HANDLE),
      asaasAmbiente: asaasAmbiente(env.ASAAS_AMBIENTE),
      // Modo pelo PREFIXO da chave (sk_test_/sk_live_); a chave em si nunca sai daqui.
      stripeModo: modoStripe(env.STRIPE_SECRET_KEY),
      // 'restrita' (rk_, recomendado) | 'secreta' (sk_) | '' — só o tipo, pelo prefixo.
      stripeChaveTipo: tipoChaveStripe(env.STRIPE_SECRET_KEY),
      stripePublicavelModo: modoStripe(env.STRIPE_PUBLISHABLE_KEY),
      stripeDominio: dominioSite(env)
    },
    funcoes,
    auth: { cadastroFechado: fechado },
    pedidoTeste: pedidoTesteSaida(teste.pedido),
    colunaTeste: teste.coluna
  };
}

async function testarFuncoes(ctx) {
  const lista = await funcoesPublicadas(ctx);
  const faltam = lista.filter((f) => f.publicada === false).map((f) => f.nome);
  const sem = lista.filter((f) => f.publicada === null).map((f) => f.nome);
  const msg = faltam.length ? 'Não publicadas: ' + faltam.join(', ') + '.'
    : (sem.length ? 'Não deu para conferir: ' + sem.join(', ') + '.' : 'Todas as ' + lista.length + ' funções estão publicadas.');
  return resultado(ctx, 'funcoes', !faltam.length && !sem.length, msg, 'Endereço de cada função chamado pelo servidor.', { funcoes: lista });
}

async function testarClickUp(ctx) {
  if (!cxTem(ctx.env, 'CLICKUP_TOKEN')) return resultado(ctx, 'clickup', false, 'Segredo CLICKUP_TOKEN não existe.', 'Presença do segredo.');
  const cu = criarClickUp({ token: ctx.env.CLICKUP_TOKEN, fetch: fetchComPrazo(ctx.fetch, cxPrazo(ctx)), dormir: async () => {}, agora: ctx.agora });
  try {
    const u = ((await comPrazo(cu.get('/user'), cxPrazo(ctx))) || {}).user || {};
    const nome = limparTexto(u.username || u.email || '', 80);
    return resultado(ctx, 'clickup', true, 'Conectado ao ClickUp' + (nome ? ' como ' + nome : '') + '.', 'Leitura do usuário dono do token (GET /user).',
      { usuario: nome, webhookSecreto: cxTem(ctx.env, 'CLICKUP_WEBHOOK_SECRET') });
  } catch (err) {
    return resultado(ctx, 'clickup', false, traduzirErro('O ClickUp', err), 'Leitura do usuário dono do token (GET /user).');
  }
}

async function testarAsaas(ctx) {
  if (!cxTem(ctx.env, 'ASAAS_API_KEY')) return resultado(ctx, 'asaas', false, 'Segredo ASAAS_API_KEY não existe.', 'Presença do segredo.');
  const asaas = criarAsaas({ apiKey: ctx.env.ASAAS_API_KEY, ambiente: ctx.env.ASAAS_AMBIENTE, fetch: fetchComPrazo(ctx.fetch, cxPrazo(ctx)) });
  const amb = asaas.ambiente === 'producao' ? 'produção' : 'sandbox (testes)';
  try {
    // Consulta leve (1 cliente, nada é criado nem cobrado). Só o "deu certo" volta para o painel.
    await comPrazo(asaas.cobranca('__teste_conexao__').catch((err) => {
      if (Number(err && err.status) === 404) return null; // chave aceita; a cobrança de mentira não existe (esperado)
      throw err;
    }), cxPrazo(ctx));
    return resultado(ctx, 'asaas', true, 'O Asaas aceitou a chave no ambiente ' + amb + '.', 'Consulta leve à API do Asaas (' + amb + ').', { ambiente: asaas.ambiente });
  } catch (err) {
    return resultado(ctx, 'asaas', false, traduzirErro('O Asaas', err) + ' (ambiente ' + amb + ')', 'Consulta leve à API do Asaas (' + amb + ').', { ambiente: asaas.ambiente });
  }
}

async function testarIa(ctx) {
  if (!cxTem(ctx.env, 'ANTHROPIC_API_KEY')) return resultado(ctx, 'ia', false, 'Segredo ANTHROPIC_API_KEY não existe (a IA é opcional).', 'Presença do segredo.');
  try {
    // Lista de modelos: não gera texto, não gasta créditos.
    const r = await fetchComPrazo(ctx.fetch, cxPrazo(ctx))(ANTHROPIC_MODELOS, {
      method: 'GET', headers: { 'x-api-key': ctx.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }
    });
    try { await r.text(); } catch (e) { /* ignora */ }
    if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
    return resultado(ctx, 'ia', true, 'A chave da IA foi aceita (teste sem custo).', 'Consulta à lista de modelos (não gera texto, não gasta créditos).');
  } catch (err) {
    return resultado(ctx, 'ia', false, traduzirErro('A IA (Anthropic)', err), 'Consulta à lista de modelos (não gera texto, não gasta créditos).');
  }
}

async function testarEmail(ctx) {
  if (!cxTem(ctx.env, 'RESEND_API_KEY')) return resultado(ctx, 'email', false, 'Segredo RESEND_API_KEY não existe.', 'Presença do segredo.');
  const para = String((ctx.usuario && ctx.usuario.email) || '').trim();
  if (!para) return resultado(ctx, 'email', false, 'Seu usuário não tem e-mail para receber o teste.', 'Envio de um e-mail de teste.');
  const resend = criarResend({ apiKey: ctx.env.RESEND_API_KEY, remetente: ctx.env.EMAIL_REMETENTE, fetch: fetchComPrazo(ctx.fetch, cxPrazo(ctx)) });
  const quando = new Date(ctx.agora()).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  try {
    await comPrazo(resend.enviar({
      para,
      assunto: 'Teste de e-mail — Gestão sem Caos',
      texto: 'Este é um e-mail de teste enviado pela aba Conexões do painel em ' + quando + '.\nSe chegou, o envio automático está funcionando.\n\nGestão sem Caos',
      html: '<p>Este é um e-mail de teste enviado pela aba <b>Conexões</b> do painel em ' + quando + '.</p><p>Se chegou, o envio automático está funcionando.</p><p>Gestão sem Caos</p>'
    }), cxPrazo(ctx));
    return resultado(ctx, 'email', true, 'E-mail de teste enviado para ' + para + '. Confira a caixa de entrada (e o spam).',
      'Envio real pelo Resend' + (cxTem(ctx.env, 'EMAIL_REMETENTE') ? '' : ' (remetente padrão do Resend: EMAIL_REMETENTE não existe)') + '.');
  } catch (err) {
    return resultado(ctx, 'email', false, traduzirErro('O Resend', err), 'Envio real pelo Resend.');
  }
}

async function gerarLinkTeste(ctx) {
  const env = ctx.env;
  if (!cxTem(env, 'INFINITEPAY_HANDLE')) return resultado(ctx, 'infinitepay.link', false, 'Segredo INFINITEPAY_HANDLE não existe.', 'Presença do segredo.');
  const site = siteBase(env);
  if (!site) return resultado(ctx, 'infinitepay.link', false, 'Segredo SITE_URL não existe: a InfinitePay precisa saber para onde voltar depois do pagamento.', 'Presença do segredo.');
  const base = baseSupabase(env);
  const ip = criarInfinitePay({ handle: env.INFINITEPAY_HANDLE, fetch: fetchComPrazo(ctx.fetch, cxPrazo(ctx)) });
  if (!ip.configurado) return resultado(ctx, 'infinitepay.link', false, 'O INFINITEPAY_HANDLE existe, mas não parece uma InfiniteTag válida (só letras, números, ponto, - ou _).', 'Formato do segredo.');
  let pedido;
  try {
    pedido = await comPrazo(ctx.db.pedidoTesteInserir({
      pacote: 'completo', valor_centavos: VALOR_TESTE_CENTAVOS, valor_original_centavos: VALOR_TESTE_CENTAVOS,
      email: limparTexto((ctx.usuario && ctx.usuario.email) || '', 120), nome: 'Teste de conexão (painel)',
      teste: true, provedor: 'infinitepay', provedor_dados: { teste: true }
    }), cxPrazo(ctx));
  } catch (err) {
    if (colunaInexistente(err)) {
      return resultado(ctx, 'infinitepay.link', false, 'Falta aplicar a migração 20261013120000_conexoes no banco (ela marca o pedido como teste, fora das vendas).', 'Criação do pedido de teste no banco.');
    }
    return resultado(ctx, 'infinitepay.link', false, 'Não foi possível criar o pedido de teste no banco.', 'Criação do pedido de teste no banco.');
  }
  try {
    const r = await comPrazo(ip.criarLink({
      pedidoId: pedido.id, valorCentavos: VALOR_TESTE_CENTAVOS,
      descricao: 'Teste de conexão — Gestão sem Caos (pode ignorar)',
      redirectUrl: site + 'admin.html?conexoes=teste',
      webhookUrl: base ? base + '/functions/v1/infinitepay-webhook' : undefined
    }), cxPrazo(ctx));
    const dados = { teste: true, link: { url: r.url, valor: VALOR_TESTE_CENTAVOS, criadoEm: cxAgoraIso(ctx) } };
    try { await ctx.db.pedidoTesteAtualizar(pedido.id, { checkout_url: r.url, provedor_dados: dados }); } catch (e) { /* o link já existe */ }
    return resultado(ctx, 'infinitepay.link', true, 'Link de teste criado (R$ 1,00). Nada é cobrado se ninguém pagar.',
      'Criação de um link real de checkout na InfinitePay (InfiniteTag ' + parcial(env.INFINITEPAY_HANDLE) + ').',
      { url: r.url, pedidoId: String(pedido.id), valorCentavos: VALOR_TESTE_CENTAVOS });
  } catch (err) {
    try { await ctx.db.pedidoTesteAtualizar(pedido.id, { status: 'cancelado' }); } catch (e) { /* ignora */ }
    return resultado(ctx, 'infinitepay.link', false, traduzirErro('A InfinitePay', err) + ' Confira se a InfiniteTag está certa.', 'Criação de um link real de checkout na InfinitePay.');
  }
}

function refsDoPedido(p) {
  const d = p && p.provedor_dados && typeof p.provedor_dados === 'object' ? p.provedor_dados : {};
  const refs = { transactionNsu: '', slug: '' };
  [d.retorno, d.webhook && lerRefsInfinitePay(d.webhook.corpo)].forEach((f) => {
    if (!f) return;
    if (!refs.transactionNsu && f.transactionNsu) refs.transactionNsu = refInfinitePay(f.transactionNsu);
    if (!refs.slug && f.slug) refs.slug = refInfinitePay(f.slug);
  });
  return refs;
}

async function verificarPagamentoTeste(ctx, corpo) {
  const alvo = 'infinitepay.verificar';
  if (!cxTem(ctx.env, 'INFINITEPAY_HANDLE')) return resultado(ctx, alvo, false, 'Segredo INFINITEPAY_HANDLE não existe.', 'Presença do segredo.');
  let p = null;
  try {
    const id = String(corpo.pedidoId || '');
    p = RE_UUID_CX.test(id) ? await ctx.db.pedidoTesteLer(id) : await ctx.db.pedidoTesteUltimo();
  } catch (err) {
    return resultado(ctx, alvo, false, colunaInexistente(err) ? 'Falta aplicar a migração 20261013120000_conexoes no banco.' : 'Não foi possível ler o pedido de teste no banco.', 'Leitura do pedido de teste.');
  }
  if (!p) return resultado(ctx, alvo, false, 'Nenhum pedido de teste encontrado. Gere um link de teste primeiro.', 'Leitura do pedido de teste.');
  if (p.status === 'pago') return resultado(ctx, alvo, true, 'O pagamento de teste já está confirmado. O ciclo completo funciona.', 'Pedido de teste no banco.', { pedidoId: String(p.id), pago: true });
  const guardadas = refsDoPedido(p);
  const refs = { transactionNsu: refInfinitePay(corpo.transactionNsu) || guardadas.transactionNsu, slug: refInfinitePay(corpo.slug) || guardadas.slug };
  const ip = criarInfinitePay({ handle: ctx.env.INFINITEPAY_HANDLE, fetch: fetchComPrazo(ctx.fetch, cxPrazo(ctx)) });
  const verificado = 'Consulta do pagamento na InfinitePay (payment_check) do pedido de teste.';
  try {
    const c = await comPrazo(ip.conferir({ pedidoId: p.id, transactionNsu: refs.transactionNsu, slug: refs.slug }), cxPrazo(ctx));
    if (c.pago && c.valorCentavos >= VALOR_TESTE_CENTAVOS) {
      try {
        await ctx.db.pedidoTesteAtualizar(p.id, { status: 'pago', metodo: c.metodo || '', provedor_ref: refs.transactionNsu || refs.slug || null });
      } catch (e) { /* a confirmação vale mesmo sem gravar */ }
      return resultado(ctx, alvo, true, 'Pagamento de teste confirmado pela InfinitePay. O ciclo completo funciona.', verificado, { pedidoId: String(p.id), pago: true });
    }
    return resultado(ctx, alvo, true, 'A InfinitePay respondeu: este pedido de teste ainda não foi pago. Pague o link (R$ 1,00) e verifique de novo.', verificado, { pedidoId: String(p.id), pago: false });
  } catch (err) {
    if (!refs.transactionNsu && !refs.slug && statusDoErro(err) >= 400 && statusDoErro(err) < 500) {
      return resultado(ctx, alvo, true, 'Ainda não há pagamento para este link. Depois de pagar, a InfinitePay avisa o sistema; verifique de novo em 1 minuto.', verificado, { pedidoId: String(p.id), pago: false });
    }
    return resultado(ctx, alvo, false, traduzirErro('A InfinitePay', err), verificado, { pedidoId: String(p.id) });
  }
}

// ---------------------------------------------------------------------------
// Stripe: chave, domínio (Apple Pay / Google Pay) e pagamento de teste de R$ 1,00 dentro do painel
// ---------------------------------------------------------------------------

function nomeModo(m) { return m === 'producao' ? 'produção' : (m === 'teste' ? 'teste' : 'desconhecido'); }

async function testarStripe(ctx) {
  const env = ctx.env;
  if (!cxTem(env, 'STRIPE_SECRET_KEY')) return resultado(ctx, 'stripe', false, 'Segredo STRIPE_SECRET_KEY não existe.', 'Presença do segredo.');
  const modo = modoStripe(env.STRIPE_SECRET_KEY);
  const tipoChave = tipoChaveStripe(env.STRIPE_SECRET_KEY);
  if (!modo || !tipoChave) return resultado(ctx, 'stripe', false, 'O STRIPE_SECRET_KEY existe, mas não parece uma chave de servidor do Stripe (começa com rk_test_, rk_live_, sk_test_ ou sk_live_).', 'Formato do segredo.');
  const st = criarStripe({ chave: env.STRIPE_SECRET_KEY, fetch: fetchComPrazo(ctx.fetch, cxPrazo(ctx)) });
  const dominio = dominioSite(env);
  const verificado = 'Consulta leve ao saldo (GET /v1/balance, nada é criado) e aos domínios de Apple Pay / Google Pay.';
  try {
    await comPrazo(st.saldo(), cxPrazo(ctx));
  } catch (err) {
    return resultado(ctx, 'stripe', false, traduzirErro('O Stripe', err) + ' (modo ' + nomeModo(modo) + ')', verificado, { modo });
  }
  let d = null;
  try { d = await comPrazo(st.dominio(dominio), cxPrazo(ctx)); } catch (err) { d = null; }
  const pub = modoStripe(env.STRIPE_PUBLISHABLE_KEY);
  const partes = ['O Stripe aceitou a chave ' + (tipoChave === 'restrita' ? 'restrita' : 'secreta') + ' (modo ' + nomeModo(modo) + ').'];
  if (tipoChave === 'secreta') partes.push('Recomendado: troque por uma chave restrita (rk_…) só com as permissões do pagamento — veja docs/VENDAS.md.');
  if (!cxTem(env, 'STRIPE_PUBLISHABLE_KEY')) partes.push('Falta o STRIPE_PUBLISHABLE_KEY (pk_…): sem ele o site não mostra o pagamento.');
  else if (pub && pub !== modo) partes.push('Atenção: a chave publicável é de ' + nomeModo(pub) + ' e a secreta de ' + nomeModo(modo) + '. Use as duas do mesmo modo.');
  if (d === null) partes.push('Não deu para conferir o domínio ' + dominio + ' para Apple Pay / Google Pay' + (tipoChave === 'restrita' ? ' (a chave restrita precisa de leitura em Payment method domains).' : '.'));
  else if (!d.registrado) partes.push('O domínio ' + dominio + ' não está registrado em Payment method domains: Apple Pay não aparece.');
  else partes.push('Domínio ' + dominio + ' registrado (Apple Pay ' + (d.applePay ? 'ativo' : 'inativo') + ', Google Pay ' + (d.googlePay ? 'ativo' : 'inativo') + ').');
  return resultado(ctx, 'stripe', true, partes.join(' '), verificado, {
    modo, chaveTipo: tipoChave, publicavelModo: pub, dominio, dominioRegistrado: d ? d.registrado : null,
    applePay: d ? d.applePay : null, googlePay: d ? d.googlePay : null, webhookSecreto: cxTem(env, 'STRIPE_WEBHOOK_SECRET')
  });
}

async function gerarPagamentoStripeTeste(ctx) {
  const alvo = 'stripe.pagamento';
  const env = ctx.env;
  if (!cxTem(env, 'STRIPE_SECRET_KEY')) return resultado(ctx, alvo, false, 'Segredo STRIPE_SECRET_KEY não existe.', 'Presença do segredo.');
  const publicavel = chavePublicavelStripe(env.STRIPE_PUBLISHABLE_KEY);
  if (!publicavel) return resultado(ctx, alvo, false, 'Segredo STRIPE_PUBLISHABLE_KEY não existe ou não parece uma chave publicável do Stripe (começa com pk_).', 'Presença do segredo.');
  const site = siteBase(env);
  let pedido;
  try {
    pedido = await comPrazo(ctx.db.pedidoTesteInserir({
      pacote: 'completo', valor_centavos: VALOR_TESTE_CENTAVOS, valor_original_centavos: VALOR_TESTE_CENTAVOS,
      email: limparTexto((ctx.usuario && ctx.usuario.email) || '', 120), nome: 'Teste de conexão (painel)',
      teste: true, provedor: 'stripe', provedor_dados: { teste: true }
    }), cxPrazo(ctx));
  } catch (err) {
    if (colunaInexistente(err)) return resultado(ctx, alvo, false, 'Falta aplicar a migração 20261013120000_conexoes no banco (ela marca o pedido como teste, fora das vendas).', 'Criação do pedido de teste no banco.');
    if (provedorRecusado(err)) return resultado(ctx, alvo, false, 'Falta aplicar a migração 20261014120000_stripe no banco (ela libera o provedor "stripe" nos pedidos).', 'Criação do pedido de teste no banco.');
    return resultado(ctx, alvo, false, 'Não foi possível criar o pedido de teste no banco.', 'Criação do pedido de teste no banco.');
  }
  const modo = modoStripe(env.STRIPE_SECRET_KEY);
  const st = criarStripe({ chave: env.STRIPE_SECRET_KEY, fetch: fetchComPrazo(ctx.fetch, cxPrazo(ctx)) });
  try {
    const pi = await comPrazo(st.criarIntent({
      pedidoId: pedido.id, valorCentavos: VALOR_TESTE_CENTAVOS, email: (ctx.usuario && ctx.usuario.email) || '', teste: true,
      descricao: 'Teste de conexão — Gestão sem Caos (pode ignorar)', chaveIdempotencia: 'mapa-disc-teste-' + pedido.id
    }), cxPrazo(ctx));
    const id = idIntentStripe(pi && pi.id);
    const cs = segredoClienteStripe(pi && pi.client_secret);
    if (!id || !cs) throw new Error('Stripe: resposta sem o PaymentIntent');
    const dados = { teste: true, intent: { id, valor: VALOR_TESTE_CENTAVOS, livemode: pi.livemode === true, criadoEm: cxAgoraIso(ctx) } };
    try { await ctx.db.pedidoTesteAtualizar(pedido.id, { provedor_ref: id, provedor_dados: dados }); } catch (e) { /* o pagamento já existe */ }
    return resultado(ctx, alvo, true, 'Pagamento de teste criado (R$ 1,00, modo ' + nomeModo(modo) + '). Pague na janela que abriu; nada é cobrado se você fechar.',
      'Criação de um PaymentIntent real no Stripe para o pedido de teste.',
      { pedidoId: String(pedido.id), clientSecret: cs, publicavel, valorCentavos: VALOR_TESTE_CENTAVOS, modo,
        retornoUrl: site ? site + 'admin.html?conexoes=teste&provedor=stripe&pedido=' + encodeURIComponent(String(pedido.id)) : '' });
  } catch (err) {
    try { await ctx.db.pedidoTesteAtualizar(pedido.id, { status: 'cancelado' }); } catch (e) { /* ignora */ }
    return resultado(ctx, alvo, false, traduzirErro('O Stripe', err), 'Criação de um PaymentIntent real no Stripe.');
  }
}

async function verificarPagamentoStripeTeste(ctx, corpo) {
  const alvo = 'stripe.verificar';
  if (!cxTem(ctx.env, 'STRIPE_SECRET_KEY')) return resultado(ctx, alvo, false, 'Segredo STRIPE_SECRET_KEY não existe.', 'Presença do segredo.');
  let p = null;
  try {
    const id = String(corpo.pedidoId || '');
    p = RE_UUID_CX.test(id) ? await ctx.db.pedidoTesteLer(id) : await ctx.db.pedidoTesteUltimo();
  } catch (err) {
    return resultado(ctx, alvo, false, colunaInexistente(err) ? 'Falta aplicar a migração 20261013120000_conexoes no banco.' : 'Não foi possível ler o pedido de teste no banco.', 'Leitura do pedido de teste.');
  }
  if (!p) return resultado(ctx, alvo, false, 'Nenhum pedido de teste encontrado. Gere um pagamento de teste primeiro.', 'Leitura do pedido de teste.');
  if (p.status === 'pago') return resultado(ctx, alvo, true, 'O pagamento de teste já está confirmado. O ciclo completo funciona.', 'Pedido de teste no banco.', { pedidoId: String(p.id), pago: true });
  const d = p.provedor_dados && typeof p.provedor_dados === 'object' ? p.provedor_dados : {};
  const piId = idIntentStripe(p.provedor_ref) || idIntentStripe(d.intent && d.intent.id);
  if (!piId) return resultado(ctx, alvo, false, 'Este pedido de teste não tem pagamento no Stripe. Gere um novo.', 'Leitura do pedido de teste.', { pedidoId: String(p.id) });
  const st = criarStripe({ chave: ctx.env.STRIPE_SECRET_KEY, fetch: fetchComPrazo(ctx.fetch, cxPrazo(ctx)) });
  const verificado = 'Consulta do PaymentIntent do pedido de teste no Stripe.';
  try {
    const pi = await comPrazo(st.intent(piId, { expandir: ['payment_method'] }), cxPrazo(ctx));
    const doPedido = pi.metadata && String(pi.metadata.pedido_id || '') === String(p.id);
    if (doPedido && pi.status === 'succeeded' && Number(pi.amount_received) >= VALOR_TESTE_CENTAVOS) {
      try { await ctx.db.pedidoTesteAtualizar(p.id, { status: 'pago', metodo: stripeMetodo(pi), provedor_ref: piId }); } catch (e) { /* vale mesmo sem gravar */ }
      return resultado(ctx, alvo, true, 'Pagamento de teste confirmado pelo Stripe. O ciclo completo funciona.', verificado, { pedidoId: String(p.id), pago: true });
    }
    return resultado(ctx, alvo, true, 'O Stripe respondeu: este pagamento de teste ainda não foi concluído (situação: ' + String(pi.status || '—') + ').', verificado, { pedidoId: String(p.id), pago: false });
  } catch (err) {
    return resultado(ctx, alvo, false, traduzirErro('O Stripe', err), verificado, { pedidoId: String(p.id) });
  }
}

const TESTES = {
  funcoes: testarFuncoes,
  clickup: testarClickUp,
  asaas: testarAsaas,
  ia: testarIa,
  email: testarEmail,
  'infinitepay.link': gerarLinkTeste,
  'infinitepay.verificar': verificarPagamentoTeste,
  stripe: testarStripe,
  'stripe.pagamento': gerarPagamentoStripeTeste,
  'stripe.verificar': verificarPagamentoStripeTeste
};

export async function acaoTestar(ctx, corpo) {
  const alvo = String((corpo && corpo.alvo) || '');
  if (!Object.prototype.hasOwnProperty.call(TESTES, alvo)) return erro('Teste desconhecido.');
  try {
    return await TESTES[alvo](ctx, corpo || {});
  } catch (err) {
    try { console.error(err); } catch (e) { /* sem console */ }
    return resultado(ctx, alvo, false, 'O teste falhou dentro do servidor. Tente de novo.', '');
  }
}
