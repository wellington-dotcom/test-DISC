// @ts-nocheck
// ARQUIVO GERADO AUTOMATICAMENTE — NÃO EDITE. Gerado de supabase/funcoes-fonte/asaas-webhook/index.ts por: npm run montar:funcoes
// Autocontido: cole este arquivo inteiro no editor da Edge Function no painel do Supabase.

import { createClient } from 'jsr:@supabase/supabase-js@2';

// ======== supabase/funcoes-compartilhadas/regras.js ========
// Regras puras compartilhadas pelas Edge Functions (porte fiel de apps-script/Code.gs).
// ES module sem dependências: roda no Node (testes) e no Deno (Supabase). Nada de rede aqui.

const MSG_SESSAO = 'Sessão expirada. Entre de novo.';
const MSG_SEM_PERMISSAO = 'Sem permissão.';
const MSG_ERRO_INTERNO = 'Erro interno no servidor. Tente novamente em instantes.';

const LETRAS_DISC = ['D', 'I', 'S', 'C'];
const TOTAL_GRUPOS_DISC = 25;

/** {ok:false, erro, ...extra} — mesmo formato do Code.gs. */
function erro(mensagem, extra) {
  const r = { ok: false, erro: mensagem };
  if (extra) for (const k of Object.keys(extra)) r[k] = extra[k];
  return r;
}

/** Remove caracteres de controle, junta espaços repetidos, apara e corta no limite. */
function limparTexto(v, max) {
  if (v === null || v === undefined) return '';
  let s = String(v).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
  if (max && s.length > max) s = s.substring(0, max).trim();
  return s;
}

/** Texto multilinha: mantém quebras de linha, remove outros controles. */
function limparTextoLongo(v, max) {
  if (v === null || v === undefined) return '';
  let s = String(v).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, ' ').trim();
  if (max && s.length > max) s = s.substring(0, max).trim();
  return s;
}

function letrasContadas(texto) { return (String(texto).match(/\p{L}/gu) || []).length; }

function normalizarEmail(v) { return limparTexto(v, 120).toLowerCase(); }

function emailValido(email) {
  return typeof email === 'string' && email.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Mesma regra de js/scoring.js: 100 dígitos, cada bloco de 4 é permutação de 1..4. */
function validarRespostasCompactas(str) {
  if (typeof str !== 'string' || !/^[1-4]{100}$/.test(str)) return false;
  for (let i = 0; i < TOTAL_GRUPOS_DISC; i++) {
    const bloco = str.substr(i * 4, 4);
    if (new Set(bloco).size !== 4) return false;
  }
  return true;
}

/** Totais, percentuais (total/2.5) e perfil (maior + segundo maior; empate na ordem D,I,S,C). */
function calcularDisc(str) {
  if (!validarRespostasCompactas(str)) throw new Error('Respostas inválidas.');
  const totais = { D: 0, I: 0, S: 0, C: 0 };
  for (let i = 0; i < TOTAL_GRUPOS_DISC; i++) {
    for (let j = 0; j < 4; j++) totais[LETRAS_DISC[j]] += Number(str[i * 4 + j]);
  }
  const percentuais = {};
  LETRAS_DISC.forEach((l) => { percentuais[l] = Math.round((totais[l] / 2.5) * 10) / 10; });
  const ordem = LETRAS_DISC.slice().sort((a, b) => (totais[b] - totais[a]) || (LETRAS_DISC.indexOf(a) - LETRAS_DISC.indexOf(b)));
  return { totais, percentuais, ordem, primario: ordem[0], secundario: ordem[1], codigo: ordem[0] + ordem[1] };
}

function protocoloValido(v) {
  return typeof v === 'string' && /^[0-9]{2}[A-HJ-NP-Z]$/.test(v);
}

function normalizarProtocolo(v) {
  if (v === null || v === undefined) return '';
  const s = String(v).replace(/^'/, '').replace(/\s+/g, '').toUpperCase();
  return protocoloValido(s) ? s : '';
}

// ---------------------------------------------------------------------------
// Campos do ClickUp: nomes normalizados e termos sensíveis
// ---------------------------------------------------------------------------

const TERMOS_SENSIVEIS = ['sexo', 'genero', 'estado civil', 'filho', 'religi', 'gravid', 'etnia', 'raca',
  'cor da pele', 'orientacao', 'deficien', 'doenca', 'saude', 'antecedente', 'processo em seu nome', 'criminal'];
const TERMOS_ANTECEDENTES = ['antecedente', 'processo em seu nome', 'criminal'];

/** Nome de campo normalizado: minúsculas, sem acento, só letras/algarismos/% separados por 1 espaço. */
function normalizarNomeCampo(nome) {
  let s = String(nome === null || nome === undefined ? '' : nome).toLowerCase();
  s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
  return s.replace(/[^a-z0-9%]+/g, ' ').trim();
}

/** '' (pode ler), 'sensivel' (nunca ler) ou 'antecedente' (só com config.permitirAntecedentes). */
function classificarCampo(nome, config) {
  const n = ' ' + normalizarNomeCampo(nome);
  config = config || {};
  for (const termo of TERMOS_SENSIVEIS) {
    if (n.indexOf(' ' + termo) === -1) continue;
    if (termo === 'saude' && config.permitirSaude === true) continue;
    if (TERMOS_ANTECEDENTES.indexOf(termo) >= 0) return config.permitirAntecedentes === true ? 'antecedente' : 'sensivel';
    return 'sensivel';
  }
  return '';
}

function numeroOuPadrao(v, padrao, min, max) {
  const n = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v.replace(',', '.')) : NaN);
  if (!isFinite(n)) return padrao;
  return Math.max(min, Math.min(max, n));
}

function idSimplesConfig(v, prefixo, i) {
  const s = limparTexto(v, 40);
  return /^[A-Za-z0-9_-]{1,40}$/.test(s) ? s : prefixo + (i + 1);
}

/** Valida e completa a config do processo (mesma regra do Code.gs). {ok, config} ou {ok:false, erro}. */
function validarConfigProcesso(c) {
  if (c === undefined || c === null) c = {};
  if (typeof c !== 'object' || Array.isArray(c)) return erro('Configuração do processo inválida.');
  let json;
  try { json = JSON.stringify(c); } catch (err) { return erro('Configuração do processo inválida.'); }
  if (json.length > 40000) return erro('Configuração do processo grande demais.');
  const perfil = String(c.perfilIdeal || '').toUpperCase().replace(/[^DISC]/g, '');
  if (perfil.length > 2 || (perfil.length === 2 && perfil[0] === perfil[1])) return erro('Perfil ideal inválido: use 1 ou 2 letras entre D, I, S e C.');
  const permitirAntecedentes = c.permitirAntecedentes === true;
  const base = { permitirAntecedentes, permitirSaude: c.permitirSaude === true };
  let problema = null;
  const campo = (v) => {
    const nome = limparTexto(v, 120);
    if (nome && classificarCampo(nome, base) === 'sensivel') problema = problema || ('O campo "' + nome + '" é um dado sensível e não pode ser usado.');
    return nome;
  };
  const ids = {};
  const idUnico = (v, prefixo, i) => {
    let id = idSimplesConfig(v, prefixo, i);
    while (ids[id]) id = id + '_';
    ids[id] = true;
    return id;
  };
  const etapas = (Array.isArray(c.etapas) ? c.etapas : []).slice(0, 20).map((e, i) => {
    e = e && typeof e === 'object' ? e : {};
    return {
      id: idUnico(e.id, 'etapa', i), nome: limparTexto(e.nome, 80) || ('Etapa ' + (i + 1)),
      peso: numeroOuPadrao(e.peso, 0, 0, 1000), campo: campo(e.campo), descricao: limparTextoLongo(e.descricao, 1000)
    };
  });
  const bonus = (Array.isArray(c.bonus) ? c.bonus : []).slice(0, 20).map((b, i) => {
    b = b && typeof b === 'object' ? b : {};
    const regra = b.regra && typeof b.regra === 'object' ? b.regra : {};
    let r;
    if (regra.tipo === 'mapa') {
      const pontos = {};
      const origem = regra.pontos && typeof regra.pontos === 'object' ? regra.pontos : {};
      Object.keys(origem).slice(0, 50).forEach((k) => {
        const chave = limparTexto(k, 120);
        if (chave) pontos[chave] = numeroOuPadrao(origem[k], 0, -100, 100);
      });
      r = { tipo: 'mapa', pontos };
    } else {
      r = { tipo: 'checkbox', pontos: numeroOuPadrao(regra.pontos, 0, -100, 100) };
    }
    return { id: idUnico(b.id, 'bonus', i), nome: limparTexto(b.nome, 80) || ('Bônus ' + (i + 1)), campo: campo(b.campo), regra: r };
  });
  if (problema) return erro(problema);
  const corte = numeroOuPadrao(c.corte, 70, 0, 200);
  const faixa = numeroOuPadrao(c.faixaAvaliar, 55, 0, 200);
  if (faixa > corte) return erro('A faixa "avaliar" precisa ser menor ou igual à nota de corte.');
  return {
    ok: true,
    config: {
      perfilIdeal: perfil,
      explicacaoPerfil: limparTextoLongo(c.explicacaoPerfil, 2000),
      etapas,
      bonus,
      corte,
      faixaAvaliar: faixa,
      statusFinalistas: (Array.isArray(c.statusFinalistas) ? c.statusFinalistas : []).slice(0, 30)
        .map((x) => limparTexto(x, 80)).filter(Boolean),
      permitirAntecedentes,
      permitirSaude: c.permitirSaude === true
    }
  };
}

/** Config gravada (jsonb ou texto JSON), sempre completa com os padrões. */
function configDoProcesso(proc) {
  let bruto = proc && proc.config;
  if (typeof bruto === 'string') { try { bruto = JSON.parse(bruto); } catch (err) { bruto = {}; } }
  const v = validarConfigProcesso(bruto || {});
  return v.ok ? v.config : validarConfigProcesso({}).config;
}

/** Linha da tabela public.processos (snake_case) -> processo no formato usado pela lógica (camelCase). */
function processoDaLinha(l) {
  if (!l) return null;
  return {
    id: String(l.id),
    codigo: l.codigo || '',
    nome: l.nome || '',
    tipo: l.tipo || 'selecao',
    empresa: l.empresa || '',
    vaga: l.vaga || '',
    cidade: l.cidade || '',
    consultor: l.consultor || '',
    contratante: l.contratante || '',
    periodoInicio: l.periodo_inicio ? String(l.periodo_inicio).substring(0, 10) : '',
    periodoFim: l.periodo_fim ? String(l.periodo_fim).substring(0, 10) : '',
    clickupListId: l.clickup_list_id ? String(l.clickup_list_id) : '',
    config: l.config || {},
    ativa: l.ativo !== false
  };
}

// ======== supabase/funcoes-compartilhadas/infinitepay.js ========
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

const INFINITEPAY_API = 'https://api.checkout.infinitepay.io';
const INFINITEPAY_TIMEOUT_MS = 15000;
const RE_HANDLE = /^[a-z0-9._-]{1,60}$/i;
const RE_REF = /^[A-Za-z0-9._:-]{1,120}$/;

/** InfiniteTag do segredo -> handle sem "$"/"@" e sem espaços; inválida -> ''. */
function normalizarHandle(v) {
  const h = String(v == null ? '' : v).trim().replace(/^[$@]+/, '').trim();
  return RE_HANDLE.test(h) ? h : '';
}

/** transaction_nsu / slug vindos da URL ou do webhook: só caracteres seguros; senão ''. */
function refInfinitePay(v) {
  const s = String(v == null ? '' : v).trim();
  return RE_REF.test(s) ? s : '';
}

/** capture_method da InfinitePay -> pedidos.metodo */
function infinitepayMetodo(v) {
  const s = String(v || '').toLowerCase();
  if (s === 'pix') return 'pix';
  if (/credit|debit|card|cartao/.test(s)) return 'cartao';
  return '';
}

/** amount/paid_amount -> centavos (inteiro). Inteiro = centavos; com casas decimais (29.9, '29.00') = reais. NaN se inválido. */
function centavosInfinitePay(v) {
  if (v === null || v === undefined || v === '') return NaN;
  const txt = typeof v === 'string' ? v.trim().replace(',', '.') : v;
  const n = Number(txt);
  if (!isFinite(n) || n < 0) return NaN;
  const emReais = !Number.isInteger(n) || (typeof txt === 'string' && txt.indexOf('.') >= 0);
  return emReais ? Math.round(n * 100) : n;
}

/** Lê order_nsu/transaction_nsu/slug/capture_method de um corpo de webhook ou de parâmetros de retorno. */
function lerRefsInfinitePay(o) {
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
function criarInfinitePay(op) {
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

// ======== supabase/funcoes-compartilhadas/asaas.js ========
// Cliente mínimo da API v3 do Asaas (cobrança Pix + link de cartão) e do Resend (e-mail), sem nada do Deno:
// recebe fetch por parâmetro (testável no Node com respostas falsas).
//
// Segredos (Supabase > Edge Functions > Secrets; NUNCA no código nem no repositório):
//   ASAAS_API_KEY       chave da API do Asaas (copiada do painel do Asaas). Sem ela: "Pagamento ainda não configurado."
//   ASAAS_AMBIENTE      'sandbox' (padrão, testes) ou 'producao'
//   ASAAS_WEBHOOK_TOKEN token que o Asaas manda no cabeçalho asaas-access-token do webhook
//   RESEND_API_KEY      (opcional) envio de e-mail com o link do relatório
//   EMAIL_REMETENTE     (opcional) ex.: 'Gestão sem Caos <relatorio@seudominio.com.br>' (domínio verificado no Resend)

const ASAAS_URLS = {
  sandbox: 'https://api-sandbox.asaas.com/v3',
  producao: 'https://api.asaas.com/v3'
};
const ASAAS_PAGO = ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'];
const ASAAS_EVENTOS_PAGO = ['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED'];
const ASAAS_EVENTOS_ESTORNO = ['PAYMENT_REFUNDED', 'PAYMENT_PARTIALLY_REFUNDED', 'PAYMENT_CHARGEBACK_REQUESTED',
  'PAYMENT_CHARGEBACK_DISPUTE'];
const ASAAS_EVENTOS_CANCELA = ['PAYMENT_DELETED'];
const ASAAS_TIMEOUT_MS = 15000;

function asaasAmbiente(v) {
  const s = String(v || '').trim().toLowerCase();
  return s === 'producao' || s === 'produção' || s === 'production' ? 'producao' : 'sandbox';
}

/** forma de pagamento do Asaas -> pedidos.metodo */
function asaasMetodo(billingType) {
  const b = String(billingType || '').toUpperCase();
  if (b === 'PIX') return 'pix';
  if (b === 'CREDIT_CARD' || b === 'DEBIT_CARD') return 'cartao';
  if (b === 'BOLETO') return 'boleto';
  return '';
}

/** Compara dois textos em tempo constante (tamanhos diferentes = falso). */
function iguaisSeguro(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || a.length !== b.length) return false;
  let dif = 0;
  for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return dif === 0;
}

/** CPF (11 dígitos com dígitos verificadores) ou CNPJ (14 dígitos) -> só dígitos; inválido -> ''. */
function documentoValido(v) {
  const d = String(v == null ? '' : v).replace(/\D/g, '');
  if (d.length === 11) {
    if (/^(\d)\1{10}$/.test(d)) return '';
    const dv = (n) => {
      let s = 0;
      for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i);
      const r = (s * 10) % 11;
      return r === 10 ? 0 : r;
    };
    return dv(9) === Number(d[9]) && dv(10) === Number(d[10]) ? d : '';
  }
  if (d.length === 14) {
    if (/^(\d)\1{13}$/.test(d)) return '';
    const calc = (n) => {
      const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
      let s = 0;
      for (let i = 0; i < n; i++) s += Number(d[i]) * pesos[i];
      const r = s % 11;
      return r < 2 ? 0 : 11 - r;
    };
    return calc(12) === Number(d[12]) && calc(13) === Number(d[13]) ? d : '';
  }
  return '';
}

function erroAsaas(status, corpo) {
  const lista = corpo && Array.isArray(corpo.errors) ? corpo.errors : [];
  const texto = lista.map((e) => String((e && (e.description || e.code)) || '')).filter(Boolean).join(' ') || ('HTTP ' + status);
  const e = new Error('Asaas: ' + texto.substring(0, 300));
  e.status = status;
  e.codigos = lista.map((x) => String((x && x.code) || ''));
  e.texto = texto;
  return e;
}

/**
 * criarAsaas({apiKey, ambiente, fetch}) -> {configurado, ambiente, clienteCriar, cobrancaCriar, cobranca, pixQrCode}
 * Todas lançam Error('Asaas: ...') com e.status/e.codigos/e.texto em resposta não-2xx.
 */
function criarAsaas(op) {
  const apiKey = String((op && op.apiKey) || '').trim();
  const ambiente = asaasAmbiente(op && op.ambiente);
  const base = ASAAS_URLS[ambiente];
  const fetchFn = op && op.fetch;

  async function chamar(metodo, caminho, corpo) {
    const controle = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controle ? setTimeout(() => controle.abort(), ASAAS_TIMEOUT_MS) : null;
    try {
      const r = await fetchFn(base + caminho, {
        method: metodo,
        headers: { access_token: apiKey, 'Content-Type': 'application/json', 'User-Agent': 'gestao-sem-caos-mapa-disc' },
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
        signal: controle ? controle.signal : undefined
      });
      const texto = await r.text();
      let json = null;
      try { json = texto ? JSON.parse(texto) : null; } catch (err) { json = null; }
      if (!r.ok) throw erroAsaas(r.status, json);
      return json || {};
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  return {
    configurado: !!apiKey,
    ambiente,
    /** {nome, email, cpfCnpj?, referencia} -> id do cliente (cus_...) */
    async clienteCriar(d) {
      const corpo = { name: d.nome, email: d.email, externalReference: d.referencia, notificationDisabled: true };
      if (d.cpfCnpj) corpo.cpfCnpj = d.cpfCnpj;
      const r = await chamar('POST', '/customers', corpo);
      if (!r.id) throw new Error('Asaas: cliente sem id');
      return String(r.id);
    },
    /** {cliente, valorCentavos, vencimento 'YYYY-MM-DD', descricao, referencia} -> {id, invoiceUrl, status} */
    async cobrancaCriar(d) {
      const r = await chamar('POST', '/payments', {
        customer: d.cliente, billingType: 'UNDEFINED', value: Math.round(d.valorCentavos) / 100,
        dueDate: d.vencimento, description: d.descricao, externalReference: d.referencia
      });
      if (!r.id) throw new Error('Asaas: cobrança sem id');
      return { id: String(r.id), invoiceUrl: String(r.invoiceUrl || ''), status: String(r.status || '') };
    },
    /** id -> {id, status, billingType, value, externalReference, invoiceUrl} */
    async cobranca(id) {
      return chamar('GET', '/payments/' + encodeURIComponent(id));
    },
    /** id -> {qrBase64, copiaECola, expira} */
    async pixQrCode(id) {
      const r = await chamar('GET', '/payments/' + encodeURIComponent(id) + '/pixQrCode');
      return { qrBase64: String(r.encodedImage || ''), copiaECola: String(r.payload || ''), expira: String(r.expirationDate || '') };
    }
  };
}

/** Envio pelo Resend. {configurado, enviar({para, assunto, html, texto})} — lança erro em falha. */
function criarResend(op) {
  const chave = String((op && op.apiKey) || '').trim();
  const remetente = String((op && op.remetente) || '').trim() || 'Gestão sem Caos <onboarding@resend.dev>';
  return {
    configurado: !!chave,
    async enviar(m) {
      const r = await op.fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + chave, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: remetente, to: [m.para], subject: m.assunto, html: m.html, text: m.texto })
      });
      if (!r.ok) throw new Error('Resend: HTTP ' + r.status);
      return true;
    }
  };
}

// ======== supabase/funcoes-compartilhadas/pagamento.js ========
// Venda direta (B2C): Edge Functions "pagamento" (site do cliente), "infinitepay-webhook" e "asaas-webhook" (o meio de
// pagamento avisa). Lógica sem nada do Deno: testável no Node 20+ com fetch e banco falsos.
//
// PROVEDOR (meio de pagamento): segredo PAGAMENTO_PROVEDOR = 'infinitepay' | 'asaas'. Sem ele: 'infinitepay' se houver
// INFINITEPAY_HANDLE, senão 'asaas' se houver ASAAS_API_KEY, senão nenhum ("Pagamento ainda não configurado.").
// Um pedido que já começou num provedor (pedidos.provedor) continua nele enquanto esse provedor estiver configurado.
//
// "pagamento" (POST JSON {acao, ...}; resposta sempre HTTP 200 {ok, ...}):
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
//   confirmar {pedidoId, tokenAcesso, transactionNsu, slug} -> {ok, status} (retorno da InfinitePay: o site lê os
//             parâmetros da URL e chama esta ação). Confere com payment_check (paid=true e valor pago >= valor do
//             pedido) e marca pago. Guarda transaction_nsu/slug para o "status" voltar a conferir (Pix ainda pendente).
//             No máximo 1 conferência a cada 5 s por pedido.
//   recuperar {email} -> {ok:true} sempre que o envio estiver configurado (não revela se o e-mail comprou); manda
//             por e-mail os links dos pedidos pagos. Sem RESEND_API_KEY/SITE_URL -> {ok:false, erro:'...suporte.'}.
//             Limite: 3 pedidos por e-mail por hora e 60 no total por hora.
// "infinitepay-webhook": SEM assinatura (a InfinitePay não documenta uma). O corpo NUNCA é confiável: lê order_nsu
//   (= pedidoId), transaction_nsu e slug e confere com payment_check; só marca pago com paid=true e valor >= pedido.
//   Idempotente (pedido já pago: nada). Grava o corpo bruto em pedidos.provedor_dados.webhook (depuração).
//   Resposta 200 {ok, feito, motivo}; falha no banco -> 500 e InfinitePay fora -> 502 (para ela reenviar).
// "asaas-webhook": cabeçalho asaas-access-token == ASAAS_WEBHOOK_TOKEN (senão 401; sem segredo 503).
//   PAYMENT_RECEIVED/CONFIRMED -> 'pago' (só de aguardando/cancelado; valor pago >= valor do pedido);
//   PAYMENT_REFUNDED/PARTIALLY_REFUNDED/CHARGEBACK_* -> 'estornado' (relatório volta a bloqueado);
//   PAYMENT_DELETED -> 'cancelado' (só se aguardando). Idempotente: as trocas só valem a partir do status certo;
//   reenvio do mesmo evento não faz nada. Falha no banco -> 500 (o Asaas tenta de novo).

const MSG_PAG_NAO_CONFIGURADO = 'Pagamento ainda não configurado.';
const MSG_EMAIL_NAO_CONFIGURADO = 'O envio por e-mail ainda não está configurado. Fale com o suporte.';
const MSG_PEDIDO_NAO_ENCONTRADO = 'Pedido não encontrado.';
const MSG_PRECISA_CPF = 'Informe o seu CPF para pagar.';
const NOMES_ENV_VENDAS = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SITE_URL', 'PAGAMENTO_PROVEDOR',
  'INFINITEPAY_HANDLE', 'ASAAS_API_KEY', 'ASAAS_AMBIENTE', 'ASAAS_WEBHOOK_TOKEN', 'RESEND_API_KEY', 'EMAIL_REMETENTE'];
const VERIFICAR_ASAAS_MS = 15000;
const CONFIRMAR_MS = 5000;
const LINK_INFINITEPAY_MS = 12 * 3600 * 1000;
const LIMITE_CORPO_PAGAMENTO = 4000;
const LIMITE_CORPO_ASAAS = 200000;
const LIMITE_CORPO_INFINITEPAY = 100000;
const LIMITE_PROVEDOR_DADOS = 50000;
const NOMES_PACOTE = { completo: 'Relatório completo', completo_plus: 'Completo + Parte 2' };
const RE_UUID_VENDAS = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RE_TOKEN_VENDAS = /^[0-9a-f]{64}$/;
const COLUNAS_PEDIDO = 'id, resposta_id, pacote, valor_centavos, cupom, status, metodo, asaas_cobranca_id, pagamento, email, nome, ' +
  'token_acesso, criado_em, pago_em, verificado_em';
// Colunas da migração 20261012120000_infinitepay.sql (sem ela, o Asaas continua funcionando com as colunas antigas).
const COLUNAS_PROVEDOR = ', provedor, provedor_ref, checkout_url, provedor_dados';

/** Provedor de pagamento escolhido pelos segredos: 'infinitepay' | 'asaas' | '' (nenhum configurado). */
function provedorPagamento(env) {
  const e = env || {};
  const escolhido = String(e.PAGAMENTO_PROVEDOR || '').trim().toLowerCase();
  if (escolhido === 'infinitepay') return e.INFINITEPAY_HANDLE ? 'infinitepay' : '';
  if (escolhido === 'asaas') return e.ASAAS_API_KEY ? 'asaas' : '';
  if (e.INFINITEPAY_HANDLE) return 'infinitepay';
  if (e.ASAAS_API_KEY) return 'asaas';
  return '';
}

/** Objeto -> cabe em provedor_dados (o banco recusa acima de 60 000 caracteres): grande demais vira texto cortado. */
function limitarDados(obj, max) {
  const lim = max || LIMITE_PROVEDOR_DADOS;
  let txt = '';
  try { txt = JSON.stringify(obj === undefined ? null : obj); } catch (err) { txt = String(obj); }
  if (txt.length <= lim) return obj === undefined ? null : JSON.parse(txt);
  return { truncado: true, texto: txt.substring(0, lim - 200) };
}

// ---------------------------------------------------------------------------
// Ambiente e banco (service role)
// ---------------------------------------------------------------------------

function lerEnvVendas(get) {
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
function criarDbVendas(sb) {
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
function criarBaseVendas(createClient, getEnv, extras) {
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
function linkRelatorio(env, token) {
  const base = baseDoSiteVendas(env);
  return base ? base + 'meu-relatorio.html#t-' + token : '';
}

/** Data 'YYYY-MM-DD' de Brasília, "dias" depois de agora. */
function dataBrasil(agoraMs, dias) {
  return new Date(agoraMs - 3 * 3600 * 1000 + (dias || 0) * 86400000).toISOString().slice(0, 10);
}

function escaparHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** E-mail com o(s) link(s) do relatório. pedidos: [{pacote, token_acesso}] */
function montarEmailAcesso(env, nome, pedidos) {
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

async function acaoCriarPagamento(ctx, corpo) {
  const p = await pedidoDoCliente(ctx, corpo);
  if (!p) return erro(MSG_PEDIDO_NAO_ENCONTRADO);
  if (p.status === 'pago' || p.status === 'cortesia') return { ok: true, status: p.status, pago: true };
  if (p.status !== 'aguardando') return erro('Este pedido não está mais aberto. Faça um novo pedido.');
  const prov = provedorDoPedido(ctx, p);
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

async function acaoStatusPagamento(ctx, corpo) {
  const p = await pedidoDoCliente(ctx, corpo);
  if (!p) return erro(MSG_PEDIDO_NAO_ENCONTRADO);
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

function urlRetornoInfinitePay(env, p) {
  const base = baseDoSiteVendas(env);
  return base ? base + 'meu-relatorio.html?pedido=' + encodeURIComponent(p.id) + '#t-' + p.token_acesso : '';
}

function urlWebhookInfinitePay(env) {
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

async function acaoConfirmarPagamento(ctx, corpo) {
  const p = await pedidoDoCliente(ctx, corpo);
  if (!p) return erro(MSG_PEDIDO_NAO_ENCONTRADO);
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
async function tratarWebhookInfinitePay(ctx, corpo) {
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

async function acaoRecuperarAcesso(ctx, corpo) {
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

function valorCobre(valor, centavos) {
  const v = Number(valor);
  return isFinite(v) && Math.round(v * 100) >= Number(centavos || 0);
}

/** Evento do Asaas já autenticado. {ok, feito, motivo} (só para log/testes). Lança erro se o banco falhar. */
async function tratarEventoAsaas(ctx, evento) {
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
function corsVendas(req, env) {
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
async function atenderPagamento(req, base) {
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
    else r = erro('Ação desconhecida.');
    return respJson(r, 200, cors);
  } catch (err) {
    try { console.error(err); } catch (e) { /* sem console */ }
    return respJson(erro(MSG_ERRO_INTERNO), 200, cors);
  }
}

/** Edge Function "asaas-webhook" (pública; "Verify JWT" desligado): confere asaas-access-token. */
async function atenderWebhookAsaas(req, base) {
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
async function atenderWebhookInfinitePay(req, base) {
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

// ======== supabase/funcoes-fonte/asaas-webhook/index.ts ========
// Edge Function "asaas-webhook" — o Asaas avisa pagamento confirmado, estorno e cobrança removida.
// Pública: no painel, desligue "Verify JWT"; a segurança é o cabeçalho asaas-access-token (segredo ASAAS_WEBHOOK_TOKEN).
// Lógica em supabase/funcoes-compartilhadas/pagamento.js. Para colar no painel do Supabase use
// dist/funcoes/asaas-webhook/index.ts (gerado por npm run montar:funcoes).

Deno.serve((req) => atenderWebhookAsaas(req, criarBaseVendas(createClient, (n) => Deno.env.get(n))));
