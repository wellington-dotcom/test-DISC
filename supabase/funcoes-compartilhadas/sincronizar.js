// Edge Function "disc-sync": depois do envio do candidato (RPC enviar_resposta), o site chama esta
// função com {id}. Idempotente: grava o DISC na tarefa do ClickUp uma vez só e guarda o resultado em
// public.respostas.clickup_sync. Nunca devolve dados ao navegador.
//
// clickup_sync = { estado: 'sincronizando'|'ok'|'erro', ok, em, tarefaId?, criada?, avisos?, erro? }
import { processoDaLinha } from './regras.js';
import { cuSincronizarEnvio, MSG_CU_NAO_CONFIGURADO } from './clickup.js';

export const SYNC_TRAVA_MS = 5 * 60 * 1000; // "sincronizando" mais velho que isso pode ser retomado

export function idEnvioValido(id) { return typeof id === 'string' && /^[A-Za-z0-9_-]{6,64}$/.test(id); }

/**
 * Sincroniza uma resposta. Devolve {feito, motivo} (só para log/testes; o HTTP responde só {ok}).
 * ctx = { db, cu, agora, confiabilidade }
 */
export async function sincronizarResposta(ctx, id) {
  if (!idEnvioValido(id)) return { feito: false, motivo: 'id_invalido' };
  const linha = await ctx.db.respostaPorId(id);
  if (!linha) return { feito: false, motivo: 'nao_encontrada' };
  const atual = linha.clickup_sync;
  if (atual && atual.ok === true) return { feito: false, motivo: 'ja_sincronizada' };
  if (!linha.processo_id) return { feito: false, motivo: 'sem_processo' };
  const proc = processoDaLinha(await ctx.db.processoPorId(linha.processo_id));
  if (!proc || !proc.clickupListId) return { feito: false, motivo: 'sem_lista' };
  const em = new Date(ctx.agora()).toISOString();
  if (!ctx.cu.configurado) {
    await ctx.db.gravarSync(id, { estado: 'erro', ok: false, em, erro: MSG_CU_NAO_CONFIGURADO });
    return { feito: false, motivo: 'sem_token' };
  }
  // Reserva atômica: só um chamador por vez (o banco só troca se ainda estiver livre).
  const limite = new Date(ctx.agora() - SYNC_TRAVA_MS).toISOString();
  const reservou = await ctx.db.reservarSync(id, { estado: 'sincronizando', ok: false, em }, limite);
  if (!reservou) return { feito: false, motivo: 'em_andamento' };
  try {
    const r = await cuSincronizarEnvio(ctx.cu, proc, linha, ctx.confiabilidade);
    await ctx.db.gravarSync(id, {
      estado: r.ok ? 'ok' : 'erro', ok: !!r.ok, em: new Date(ctx.agora()).toISOString(),
      tarefaId: r.tarefaId || '', criada: !!r.criada, avisos: r.avisos || []
    });
    return { feito: !!r.ok, motivo: r.ok ? 'ok' : 'erro' };
  } catch (err) {
    const msg = String(err && err.message || err).substring(0, 300);
    ctx.cu.registrarAviso('Envio ' + (linha.protocolo || '') + ': não foi possível gravar no ClickUp (' + msg + ').');
    await ctx.db.gravarSync(id, { estado: 'erro', ok: false, em: new Date(ctx.agora()).toISOString(), erro: msg });
    return { feito: false, motivo: 'erro' };
  }
}
