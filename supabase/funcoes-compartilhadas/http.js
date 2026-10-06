// Camada HTTP das Edge Functions (Request -> Response), sem nada do Deno: testável no Node 20+.
//
// base = { env, fetch, dormir?, agora?, db, authAdmin?, autenticar?, motor?, confiabilidade?, emSegundoPlano? }
//   autenticar(authorizationHeader) -> {usuario:{id,email}, eAdmin:boolean} | null
//   emSegundoPlano(promise)          -> EdgeRuntime.waitUntil (opcional)
import { erro, MSG_SESSAO, MSG_SEM_PERMISSAO, MSG_ERRO_INTERNO } from './regras.js';
import { criarClickUp } from './clickup.js';
import { gravarAvisos } from './avisos.js';
import { executarAcaoAdmin } from './admin.js';
import { sincronizarResposta, idEnvioValido } from './sincronizar.js';
import { assinaturaValida, tratarEventoClickUp } from './webhook.js';

const LIMITE_CORPO = 20000;
const LIMITE_CORPO_RELATORIO = 450000; // só "relatorio.salvar" (o painel manda os textos do relatório)
const LIMITE_CORPO_WEBHOOK = 1000000;

function origemDoSite(siteUrl) {
  try { return siteUrl ? new URL(String(siteUrl).trim()).origin : ''; } catch (err) { return ''; }
}

/** Origem permitida: a do SITE_URL ou localhost/127.0.0.1 (qualquer porta). */
export function origemPermitida(origem, siteUrl) {
  if (!origem) return false;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/.test(origem)) return true;
  const site = origemDoSite(siteUrl);
  return !!site && origem === site;
}

export function cabecalhosCors(req, env) {
  const origem = req.headers.get('origin') || '';
  const h = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
  if (origemPermitida(origem, env && env.SITE_URL)) h['Access-Control-Allow-Origin'] = origem;
  return h;
}

export function responderJson(obj, status, extras) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, extras || {})
  });
}

function contextoBase(base) {
  const env = base.env || {};
  const agora = base.agora || (() => Date.now());
  const cu = criarClickUp({ token: env.CLICKUP_TOKEN, pastaId: env.CLICKUP_PASTA_ID, fetch: base.fetch, dormir: base.dormir, agora });
  return {
    env, agora, cu, db: base.db, authAdmin: base.authAdmin, fetch: base.fetch,
    motor: base.motor, confiabilidade: base.confiabilidade, prazoConexoesMs: base.prazoConexoesMs
  };
}

async function lerCorpoJson(req, limite) {
  const texto = await req.text();
  if (!texto) return { erro: erro('Requisição vazia.') };
  if (texto.length > limite) return { erro: erro('Requisição grande demais.') };
  let corpo;
  try { corpo = JSON.parse(texto); } catch (err) { return { erro: erro('JSON inválido.') }; }
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) return { erro: erro('Formato de requisição inválido.') };
  return { corpo, tamanho: texto.length };
}

/**
 * Edge Function "admin": exige o JWT de um usuário logado que seja admin (public.e_admin()).
 * Responde sempre HTTP 200 com {ok, ...}; sessão inválida -> {ok:false, erro, sessaoExpirada:true}.
 */
export async function atenderAdmin(req, base) {
  const cors = cabecalhosCors(req, base.env);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return responderJson(erro('Método não permitido.'), 405, cors);
  let ctx = null;
  try {
    const lido = await lerCorpoJson(req, LIMITE_CORPO_RELATORIO);
    if (lido.erro) return responderJson(lido.erro, 200, cors);
    if (lido.tamanho > LIMITE_CORPO && lido.corpo.acao !== 'relatorio.salvar') return responderJson(erro('Requisição grande demais.'), 200, cors);
    const quem = await base.autenticar(req.headers.get('authorization') || '');
    if (!quem || !quem.usuario) return responderJson(erro(MSG_SESSAO, { sessaoExpirada: true }), 200, cors);
    if (!quem.eAdmin) return responderJson(erro(MSG_SEM_PERMISSAO), 200, cors);
    ctx = contextoBase(base);
    ctx.usuario = quem.usuario;
    const r = await executarAcaoAdmin(ctx, lido.corpo);
    return responderJson(r, 200, cors);
  } catch (err) {
    try { console.error(err); } catch (e) { /* sem console */ }
    return responderJson(erro(MSG_ERRO_INTERNO), 200, cors);
  } finally {
    if (ctx) await gravarAvisos(ctx.db, ctx.cu.avisos, ctx.agora());
  }
}

/** Edge Function "disc-sync": {id} -> {ok}. Nunca devolve dados da resposta. */
export async function atenderDiscSync(req, base) {
  const cors = cabecalhosCors(req, base.env);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return responderJson(erro('Método não permitido.'), 405, cors);
  const lido = await lerCorpoJson(req, 2000).catch(() => ({ erro: erro('Requisição inválida.') }));
  if (lido.erro) return responderJson(lido.erro, 400, cors);
  if (!idEnvioValido(lido.corpo.id)) return responderJson(erro('Identificador do envio inválido.'), 400, cors);
  const ctx = contextoBase(base);
  const trabalho = (async () => {
    try {
      await sincronizarResposta(ctx, lido.corpo.id);
    } catch (err) {
      try { console.error(err); } catch (e) { /* sem console */ }
    } finally {
      await gravarAvisos(ctx.db, ctx.cu.avisos, ctx.agora());
    }
  })();
  // O candidato não espera o ClickUp: responde logo e termina em segundo plano (quando houver).
  if (typeof base.emSegundoPlano === 'function') base.emSegundoPlano(trabalho);
  else await trabalho;
  return responderJson({ ok: true }, 200, cors);
}

/** Edge Function "clickup-webhook" (pública; "Verify JWT" desligado): confere X-Signature e trata o evento. */
export async function atenderWebhookClickUp(req, base) {
  if (req.method !== 'POST') return responderJson(erro('Método não permitido.'), 405);
  const segredo = base.env && base.env.CLICKUP_WEBHOOK_SECRET;
  if (!segredo) return responderJson(erro('Webhook não configurado: defina o segredo CLICKUP_WEBHOOK_SECRET.'), 503);
  const texto = await req.text();
  if (texto.length > LIMITE_CORPO_WEBHOOK) return responderJson(erro('Requisição grande demais.'), 413);
  if (!(await assinaturaValida(segredo, texto, req.headers.get('x-signature') || ''))) {
    return responderJson(erro('Assinatura inválida.'), 401);
  }
  let evento;
  try { evento = JSON.parse(texto); } catch (err) { return responderJson(erro('JSON inválido.'), 400); }
  const ctx = contextoBase(base);
  const trabalho = (async () => {
    try {
      return await tratarEventoClickUp(ctx, evento);
    } catch (err) {
      try { console.error(err); } catch (e) { /* sem console */ }
      return { ok: true, feito: false, motivo: 'erro' };
    } finally {
      await gravarAvisos(ctx.db, ctx.cu.avisos, ctx.agora());
    }
  })();
  // Responde logo ao ClickUp (ele reenvia se demorar) e termina o trabalho em segundo plano.
  if (typeof base.emSegundoPlano === 'function') {
    base.emSegundoPlano(trabalho);
    return responderJson({ ok: true }, 200);
  }
  await trabalho;
  return responderJson({ ok: true }, 200);
}
