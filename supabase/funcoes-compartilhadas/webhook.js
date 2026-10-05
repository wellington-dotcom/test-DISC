// Edge Function "clickup-webhook": o ClickUp avisa quando uma tarefa muda de status. Se a tarefa
// "📌 Briefing…" de uma lista ligada a um processo ativo for para "gerar relatório", gera o rascunho,
// comenta "Rascunho pronto para revisão no painel" e muda a tarefa para "relatório em revisão" (se
// esse status existir na lista). Substitui o gatilho de 10 minutos do Apps Script.
//
// Segurança: o corpo vem assinado (cabeçalho X-Signature = HMAC-SHA256 hexadecimal do corpo bruto com
// o "secret" que o ClickUp devolve ao criar o webhook; guardado no segredo CLICKUP_WEBHOOK_SECRET).
import { normalizarNomeCampo, processoDaLinha } from './regras.js';
import { cuId, cuEhBriefing } from './clickup.js';
import { gerarRascunho } from './admin.js';

export const WEBHOOK_REPETIDO_MS = 2 * 60 * 1000; // rascunho criado há menos disso -> ignora reenvio

function hexDe(buffer) { return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join(''); }

/** HMAC-SHA256 (hex) de "corpo" com "segredo" — WebCrypto (Deno e Node 20+). */
export async function hmacSha256Hex(segredo, corpo) {
  const enc = new TextEncoder();
  const chave = await globalThis.crypto.subtle.importKey('raw', enc.encode(segredo), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hexDe(await globalThis.crypto.subtle.sign('HMAC', chave, enc.encode(corpo)));
}

/** Confere a assinatura em tempo constante. Falso se faltar segredo ou assinatura. */
export async function assinaturaValida(segredo, corpo, assinatura) {
  if (!segredo || typeof assinatura !== 'string' || !assinatura) return false;
  const esperado = await hmacSha256Hex(segredo, corpo);
  const recebido = assinatura.trim().toLowerCase();
  if (recebido.length !== esperado.length) return false;
  let dif = 0;
  for (let i = 0; i < esperado.length; i++) dif |= esperado.charCodeAt(i) ^ recebido.charCodeAt(i);
  return dif === 0;
}

const GERAR = 'gerar relatorio';
const REVISAO = 'relatorio em revisao';

/** O evento fala de uma mudança PARA "gerar relatório"? (sem histórico: confere na tarefa) */
function eventoPedeRelatorio(evento) {
  const itens = Array.isArray(evento.history_items) ? evento.history_items : null;
  if (!itens || !itens.length) return true;
  return itens.some((h) => h && (h.field === 'status' || !h.field) && h.after &&
    normalizarNomeCampo(typeof h.after === 'object' ? h.after.status : h.after) === GERAR);
}

/**
 * Trata um evento já com assinatura conferida. Devolve {ok, feito, motivo, token?} (só para log/testes).
 * ctx = { db, cu, agora, motor, confiabilidade, env }
 */
export async function tratarEventoClickUp(ctx, evento) {
  if (!evento || typeof evento !== 'object' || evento.event !== 'taskStatusUpdated') return { ok: true, feito: false, motivo: 'evento_ignorado' };
  const taskId = typeof evento.task_id === 'string' || typeof evento.task_id === 'number' ? String(evento.task_id) : '';
  if (!taskId) return { ok: true, feito: false, motivo: 'sem_tarefa' };
  if (!eventoPedeRelatorio(evento)) return { ok: true, feito: false, motivo: 'outro_status' };
  if (!ctx.cu.configurado) return { ok: true, feito: false, motivo: 'sem_token' };
  let procNome = '';
  try {
    const tarefa = await ctx.cu.tarefa(taskId);
    if (!cuEhBriefing(tarefa.name)) return { ok: true, feito: false, motivo: 'nao_e_briefing' };
    if (normalizarNomeCampo(tarefa.status && tarefa.status.status) !== GERAR) return { ok: true, feito: false, motivo: 'outro_status' };
    const listId = tarefa.list && tarefa.list.id ? String(tarefa.list.id) : '';
    const proc = listId ? processoDaLinha(await ctx.db.processoPorLista(listId)) : null;
    if (!proc) return { ok: true, feito: false, motivo: 'sem_processo' };
    procNome = proc.nome;
    const recentes = await ctx.db.relatoriosListar(proc.id);
    const agora = ctx.agora();
    if ((recentes || []).some((r) => r.status === 'rascunho' && agora - Date.parse(r.criado_em) < WEBHOOK_REPETIDO_MS)) {
      return { ok: true, feito: false, motivo: 'repetido' };
    }
    const r = await gerarRascunho(ctx, proc);
    await ctx.cu.post('/task/' + cuId(taskId) + '/comment', { comment_text: 'Rascunho pronto para revisão no painel', notify_all: false });
    const revisao = ((await ctx.cu.lista(listId)).statuses || []).find((s) => normalizarNomeCampo(s.status) === REVISAO);
    if (revisao) await ctx.cu.put('/task/' + cuId(taskId), { status: revisao.status });
    return { ok: true, feito: true, motivo: 'gerado', token: r.token };
  } catch (err) {
    ctx.cu.registrarAviso('Gatilho do processo "' + (procNome || '?') + '": ' + String(err && err.message || err));
    return { ok: true, feito: false, motivo: 'erro' };
  }
}
