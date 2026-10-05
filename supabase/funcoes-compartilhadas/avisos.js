// Avisos do ClickUp para o painel (clickup.status): últimos 20, válidos por 6 h, guardados na tabela
// public.configuracoes (chave "clickup_avisos"). Equivale ao CacheService do Apps Script.
export const CHAVE_AVISOS = 'clickup_avisos';
const MAX_AVISOS = 20;
const VALIDADE_AVISOS_MS = 6 * 60 * 60 * 1000;

function avisosValidos(bruto, agoraMs) {
  let lista = [];
  try { lista = JSON.parse(bruto || '[]') || []; } catch (err) { lista = []; }
  if (!Array.isArray(lista)) return [];
  return lista.filter((a) => a && typeof a.aviso === 'string' && agoraMs - Date.parse(a.em) < VALIDADE_AVISOS_MS);
}

export async function lerAvisos(db, agoraMs) {
  try { return avisosValidos(await db.configLer(CHAVE_AVISOS), agoraMs); } catch (err) { return []; }
}

/** Junta os avisos novos (mais recentes primeiro). Nunca lança: aviso não derruba nada. */
export async function gravarAvisos(db, novos, agoraMs) {
  if (!novos || !novos.length) return;
  try { novos.forEach((m) => console.warn(m)); } catch (err) { /* sem console */ }
  try {
    const em = new Date(agoraMs).toISOString();
    const atuais = await lerAvisos(db, agoraMs);
    const lista = novos.slice().reverse().map((m) => ({ em, aviso: String(m).substring(0, 300) })).concat(atuais);
    await db.configGravar(CHAVE_AVISOS, JSON.stringify(lista.slice(0, MAX_AVISOS)));
  } catch (err) { /* aviso nunca derruba nada */ }
}
