// Ações da Edge Function "admin" (só administrador). Mesmos nomes, entradas e respostas {ok, ...} das
// ações do Apps Script (Code.gs/ClickUp.gs/Relatorio.gs), mais usuarios.* do Supabase Auth.
//
// ctx = { env, db, authAdmin, usuario:{id,email}, cu (cliente do ClickUp), fetch, agora, motor, confiabilidade }
// Processos (listar/salvar/excluir) e respostas dos candidatos ficam no PostgREST com RLS (não aqui).
import {
  erro, limparTexto, limparTextoLongo, letrasContadas, normalizarEmail, emailValido, processoDaLinha
} from './regras.js';
import {
  MSG_CU_NAO_CONFIGURADO, cuId, cuListas, cuEhBriefing, cuMontarDadosProcesso
} from './clickup.js';
import {
  relTokenValido, relNovoToken, relMontar, relAplicarEdicao, relBaseSite, relChamarIa, relIdsParaIa,
  REL_MAX_TEXTO
} from './relatorio.js';
import { lerAvisos } from './avisos.js';
import { acaoDiagnostico, acaoTestar } from './conexoes.js';
import { criarResend } from './asaas.js';
import { montarEmailRelatorio } from './email.js';

function agoraIso(ctx) { return new Date(ctx.agora()).toISOString(); }

// ---------------------------------------------------------------------------
// ClickUp
// ---------------------------------------------------------------------------

async function acaoClickupStatus(ctx) {
  const env = ctx.env;
  const r = {
    ok: true, configurado: ctx.cu.configurado, pastaConfigurada: !!env.CLICKUP_PASTA_ID,
    iaConfigurada: !!env.ANTHROPIC_API_KEY, avisos: await lerAvisos(ctx.db, ctx.agora())
  };
  if (!r.configurado) return r;
  try {
    const u = (await ctx.cu.get('/user')).user || {};
    r.conectado = true;
    r.usuario = u.username || '';
  } catch (err) {
    r.conectado = false;
    r.erro = 'Não foi possível falar com o ClickUp: ' + err.message;
  }
  return r;
}

async function acaoClickupListas(ctx) {
  if (!ctx.cu.configurado) return erro(MSG_CU_NAO_CONFIGURADO);
  try {
    return { ok: true, listas: await cuListas(ctx.cu) };
  } catch (err) {
    return erro('Não foi possível ler as listas do ClickUp: ' + err.message);
  }
}

/** Valida o processo para leitura no ClickUp. {ok, processo} ou erro. */
async function processoPronto(ctx, id) {
  const proc = processoDaLinha(await ctx.db.processoPorId(limparTexto(id, 60)));
  if (!proc) return erro('Processo não encontrado.');
  if (!proc.clickupListId) return erro('Este processo ainda não está ligado a uma lista do ClickUp.');
  if (!ctx.cu.configurado) return erro(MSG_CU_NAO_CONFIGURADO);
  return { ok: true, processo: proc };
}

/** processoDados do processo (ClickUp + respostas do DISC no banco). Lança erro se o ClickUp falhar. */
export async function montarDadosDoProcesso(ctx, proc) {
  const linhas = await ctx.db.respostasDoProcesso(proc);
  return cuMontarDadosProcesso(ctx.cu, proc, linhas, ctx.confiabilidade);
}

async function acaoProcessoDados(ctx, id) {
  const p = await processoPronto(ctx, id);
  if (!p.ok) return p;
  let dados;
  try { dados = await montarDadosDoProcesso(ctx, p.processo); } catch (err) { return erro('Não foi possível ler o ClickUp: ' + err.message); }
  return { ok: true, processo: dados.processo, config: dados.config, status: dados.status, candidatos: dados.candidatos, avisos: dados.avisos };
}

// ---------------------------------------------------------------------------
// Relatórios
// ---------------------------------------------------------------------------

/** Lê o ClickUp, monta o relatório e grava como rascunho. {ok, relatorio, token, avisos}; lança erro. */
export async function gerarRascunho(ctx, proc) {
  const dados = await montarDadosDoProcesso(ctx, proc);
  const agora = agoraIso(ctx);
  const relatorio = relMontar(ctx.motor, dados, agora);
  const token = relNovoToken();
  await ctx.db.relatorioInserir({
    token, processo_id: proc.id, status: 'rascunho', dados: relatorio,
    criado_em: agora, atualizado_em: agora, publicado_em: null
  });
  return { ok: true, relatorio, token, avisos: dados.avisos || [] };
}

async function acaoRelatorioRascunho(ctx, processoId) {
  const p = await processoPronto(ctx, processoId);
  if (!p.ok) return p;
  try {
    return await gerarRascunho(ctx, p.processo);
  } catch (err) {
    return erro('Não foi possível gerar o rascunho: ' + err.message);
  }
}

async function lerRelatorio(ctx, token) {
  if (!relTokenValido(token)) return null;
  const l = await ctx.db.relatorioLer(token);
  if (!l || !l.dados || typeof l.dados !== 'object') return null;
  // Relatórios dos modelos novos (equipe/liderança/pessoa) são do painel, não do processo/ClickUp.
  if (!l.processo_id || (l.modelo && l.modelo !== 'processo')) return null;
  return l;
}

async function acaoRelatorioSalvar(ctx, corpo) {
  const novos = (corpo.relatorio && typeof corpo.relatorio === 'object' && corpo.relatorio.textos) || corpo.textos;
  if (!novos || typeof novos !== 'object' || Array.isArray(novos)) return erro('Nada para salvar.');
  const l = await lerRelatorio(ctx, corpo.relatorioToken);
  if (!l) return erro('Relatório não encontrado.');
  const relatorio = l.dados;
  const alterados = relAplicarEdicao(relatorio, corpo) || 0;
  if (alterados) await ctx.db.relatorioAtualizar(l.token, { dados: relatorio, atualizado_em: agoraIso(ctx) });
  return { ok: true, relatorio, alterados };
}

/** Comenta o texto na tarefa "📌 Briefing…" da lista (ou na própria lista). Lança erro se falhar. */
export async function comentarNoClickUp(cu, proc, texto) {
  const tarefas = await cu.tarefas(proc.clickupListId);
  const briefing = tarefas.find((t) => cuEhBriefing(t.name));
  if (briefing) await cu.post('/task/' + cuId(briefing.id) + '/comment', { comment_text: texto, notify_all: false });
  else await cu.post('/list/' + cuId(proc.clickupListId) + '/comment', { comment_text: texto, notify_all: false });
  return briefing ? 'tarefa' : 'lista';
}

async function acaoRelatorioPublicar(ctx, token, baseUrl) {
  const base = relBaseSite(baseUrl, ctx.env.SITE_URL);
  const l = await lerRelatorio(ctx, token);
  if (!l) return erro('Relatório não encontrado.');
  const agora = agoraIso(ctx);
  await ctx.db.relatorioAtualizar(l.token, { status: 'publicado', publicado_em: l.publicado_em || agora, atualizado_em: agora });
  const url = base + 'relatorio.html?r=' + l.token;
  const resposta = { ok: true, url };
  const proc = processoDaLinha(await ctx.db.processoPorId(l.processo_id));
  if (!proc || !proc.clickupListId || !ctx.cu.configurado) return resposta;
  if (!base) {
    resposta.aviso = 'Link não comentado no ClickUp: defina o segredo SITE_URL nas Edge Functions (endereço do site).';
    return resposta;
  }
  try {
    resposta.comentadoEm = await comentarNoClickUp(ctx.cu, proc, 'Relatório publicado: ' + url);
  } catch (err) {
    resposta.aviso = 'Relatório publicado, mas não deu para comentar o link no ClickUp (' + err.message + ').';
    ctx.cu.registrarAviso(resposta.aviso);
  }
  return resposta;
}

async function acaoRelatorioDespublicar(ctx, token) {
  const l = await lerRelatorio(ctx, token);
  if (!l) return erro('Relatório não encontrado.');
  await ctx.db.relatorioAtualizar(l.token, { status: 'rascunho', publicado_em: null, atualizado_em: agoraIso(ctx) });
  return { ok: true };
}

async function acaoRelatoriosListar(ctx, processoId) {
  const linhas = await ctx.db.relatoriosListar(limparTexto(processoId, 60));
  const relatorios = (linhas || []).filter((l) => l.processo_id).map((l) => ({
    token: l.token, processoId: l.processo_id ? String(l.processo_id) : '',
    status: l.status === 'publicado' ? 'publicado' : 'rascunho',
    criadoEm: l.criado_em || '', publicadoEm: l.publicado_em || '', atualizadoEm: l.atualizado_em || ''
  })).sort((a, b) => String(b.criadoEm).localeCompare(String(a.criadoEm)));
  return { ok: true, relatorios };
}

async function acaoRelatorioMelhorarTextos(ctx, token, ids) {
  const chave = ctx.env.ANTHROPIC_API_KEY;
  if (!chave) return erro('IA não configurada.');
  const l = await lerRelatorio(ctx, token);
  if (!l) return erro('Relatório não encontrado.');
  const textos = l.dados.textos || {};
  const escolhidos = relIdsParaIa(textos, ids);
  if (!escolhidos.length) return erro('Nenhum texto para melhorar.');
  let mapa;
  try {
    mapa = await relChamarIa(ctx.fetch, chave, escolhidos.map((id) => ({ id, texto: textos[id].texto })));
  } catch (err) {
    return erro('Não foi possível melhorar os textos: ' + err.message);
  }
  const atual = await lerRelatorio(ctx, token); // relê: alguém pode ter editado enquanto a IA trabalhava
  if (!atual) return erro('Relatório não encontrado.');
  const relatorio = atual.dados;
  relatorio.textos = relatorio.textos || {};
  let alterados = 0;
  escolhidos.forEach((id) => {
    if (!mapa[id] || !relatorio.textos[id]) return;
    relatorio.textos[id] = { texto: limparTextoLongo(mapa[id], REL_MAX_TEXTO), origem: 'ia' };
    alterados++;
  });
  if (alterados) await ctx.db.relatorioAtualizar(atual.token, { dados: relatorio, atualizado_em: agoraIso(ctx) });
  return { ok: true, relatorio, alterados };
}

// ---------------------------------------------------------------------------
// Enviar o link de um relatório publicado por e-mail (Resend; só o link, nunca anexo)
// ---------------------------------------------------------------------------

export const MSG_EMAIL_PAINEL_NAO_CONFIGURADO = 'O envio por e-mail ainda não está configurado (veja Conexões).';
export const LIMITE_EMAILS_HORA = 30;
const RE_TOKEN_REL = /^[A-Za-z0-9_-]{32,128}$/;
const MODELOS_EMAIL = ['processo', 'equipe', 'lideranca', 'pessoa'];

async function acaoRelatorioEnviarEmail(ctx, corpo) {
  const token = typeof corpo.relatorioToken === 'string' ? corpo.relatorioToken.trim() : '';
  const para = normalizarEmail(corpo.para);
  const nome = limparTexto(corpo.nome, 80);
  const mensagem = limparTextoLongo(corpo.mensagem, 1000);
  if (!emailValido(para)) return erro('Informe um e-mail válido para o destinatário.');
  if (!RE_TOKEN_REL.test(token)) return erro('Relatório não encontrado.');
  const email = criarResend({ apiKey: ctx.env.RESEND_API_KEY, remetente: ctx.env.EMAIL_REMETENTE, fetch: ctx.fetch });
  if (!email.configurado) return erro(MSG_EMAIL_PAINEL_NAO_CONFIGURADO, { naoConfigurado: true });
  const l = await ctx.db.relatorioLer(token);
  if (!l || !l.dados || typeof l.dados !== 'object') return erro('Relatório não encontrado.');
  if (l.status !== 'publicado') return erro('Publique o relatório antes de enviar o link.');
  // O link do e-mail usa o endereço oficial do site (SITE_URL); sem ele, o endereço https do painel.
  const base = relBaseSite('', ctx.env.SITE_URL) || relBaseSite(corpo.baseUrl, '');
  if (!base) return erro('Defina o segredo SITE_URL nas Edge Functions (endereço do site) para enviar o link por e-mail.');
  const desde = new Date(ctx.agora() - 3600000).toISOString();
  if (typeof ctx.db.contarTentativa !== 'function') return erro(MSG_EMAIL_PAINEL_NAO_CONFIGURADO, { naoConfigurado: true });
  const n = await ctx.db.contarTentativa('relatorio_email', String(ctx.usuario.id), desde, agoraIso(ctx));
  if (n > LIMITE_EMAILS_HORA) return erro('Limite de ' + LIMITE_EMAILS_HORA + ' e-mails por hora atingido. Tente de novo mais tarde.');
  const modelo = MODELOS_EMAIL.indexOf(l.modelo) >= 0 ? l.modelo : 'processo';
  const url = base + 'relatorio.html?r=' + l.token;
  let remetente = '';
  try {
    const admins = await ctx.db.adminsListar();
    const eu = (admins || []).find((a) => String(a.user_id) === String(ctx.usuario.id));
    remetente = eu ? limparTexto(eu.nome, 80) : '';
  } catch (err) { remetente = ''; }
  const m = montarEmailRelatorio({ modelo, url, nome, mensagem, remetente, titulo: limparTexto(l.dados.titulo, 160) });
  try {
    await email.enviar({ para, assunto: m.assunto, html: m.html, texto: m.texto });
  } catch (err) {
    try { console.error(err); } catch (e) { /* sem console */ }
    return erro('Não foi possível enviar o e-mail agora (' + limparTexto(err && err.message, 120) + '). Tente de novo em instantes.');
  }
  return { ok: true, para, enviadoEm: agoraIso(ctx), assunto: m.assunto };
}

// ---------------------------------------------------------------------------
// Usuários (administradores do painel, no Supabase Auth)
// ---------------------------------------------------------------------------

function usuarioDaLista(admin, u, eu) {
  u = u || {};
  return {
    id: String(admin.user_id), nome: admin.nome || '', email: u.email || '', papel: 'admin', ativo: true,
    criadoEm: admin.criado_em || u.created_at || '',
    ultimoAcesso: u.last_sign_in_at || '',
    convitePendente: !!(u.invited_at && !u.last_sign_in_at),
    voce: String(admin.user_id) === String(eu),
    foto: typeof admin.foto === 'string' && admin.foto.length <= 40000 && /^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/=]+$/.test(admin.foto) ? admin.foto : ''
  };
}

async function acaoUsuariosListar(ctx) {
  const admins = await ctx.db.adminsListar();
  const usuarios = [];
  for (const a of admins) usuarios.push(usuarioDaLista(a, await ctx.authAdmin.usuarioPorId(a.user_id), ctx.usuario.id));
  return { ok: true, usuarios };
}

/** Endereço para onde o convite leva (painel). '' se SITE_URL não estiver definido. */
export function enderecoDoPainel(siteUrl) {
  const base = relBaseSite('', siteUrl);
  return base ? base + 'admin.html' : '';
}

async function acaoUsuariosConvidar(ctx, corpo) {
  const dados = corpo.usuario && typeof corpo.usuario === 'object' ? corpo.usuario : corpo;
  const nome = limparTexto(dados.nome, 80);
  if (letrasContadas(nome) < 2) return erro('Informe o nome do usuário.');
  const email = normalizarEmail(dados.email);
  if (!emailValido(email)) return erro('E-mail inválido.');
  const existente = await ctx.authAdmin.usuarioPorEmail(email);
  let usuario;
  let convidado = false;
  if (existente) {
    const admins = await ctx.db.adminsListar();
    if (admins.some((a) => String(a.user_id) === String(existente.id))) return erro('Já existe um usuário com este e-mail.');
    usuario = existente;
  } else {
    try {
      usuario = await ctx.authAdmin.convidar(email, { nome, redirectTo: enderecoDoPainel(ctx.env.SITE_URL) });
    } catch (err) {
      return erro('Não foi possível enviar o convite: ' + err.message);
    }
    convidado = true;
  }
  await ctx.db.adminInserir(usuario.id, nome);
  const admin = { user_id: usuario.id, nome, criado_em: agoraIso(ctx) };
  return { ok: true, convidado, usuario: usuarioDaLista(admin, usuario, ctx.usuario.id) };
}

async function acaoUsuariosRemover(ctx, idBruto) {
  const id = limparTexto(idBruto, 60);
  if (id && id === String(ctx.usuario.id)) return erro('Você não pode excluir o seu próprio acesso.');
  const admins = await ctx.db.adminsListar();
  const alvo = id && admins.find((a) => String(a.user_id) === id);
  if (!alvo) return erro('Usuário não encontrado.');
  if (admins.length <= 1) return erro('Precisa existir pelo menos um administrador ativo.');
  await ctx.db.adminRemover(id);
  try { await ctx.authAdmin.excluir(id); } catch (err) { /* já sem acesso: a linha de admins saiu */ }
  return { ok: true, id };
}

// ---------------------------------------------------------------------------
// Roteador
// ---------------------------------------------------------------------------

export const ACOES_ADMIN = {
  'clickup.status': (ctx) => acaoClickupStatus(ctx),
  'clickup.listas': (ctx) => acaoClickupListas(ctx),
  'processo.dados': (ctx, c) => acaoProcessoDados(ctx, c.id),
  'relatorio.rascunho': (ctx, c) => acaoRelatorioRascunho(ctx, c.processoId),
  'relatorio.salvar': (ctx, c) => acaoRelatorioSalvar(ctx, c),
  'relatorio.publicar': (ctx, c) => acaoRelatorioPublicar(ctx, c.relatorioToken, c.baseUrl),
  'relatorio.despublicar': (ctx, c) => acaoRelatorioDespublicar(ctx, c.relatorioToken),
  'relatorios.listar': (ctx, c) => acaoRelatoriosListar(ctx, c.processoId),
  'relatorio.melhorarTextos': (ctx, c) => acaoRelatorioMelhorarTextos(ctx, c.relatorioToken, c.ids),
  'relatorio.enviarEmail': (ctx, c) => acaoRelatorioEnviarEmail(ctx, c),
  'usuarios.listar': (ctx) => acaoUsuariosListar(ctx),
  'usuarios.convidar': (ctx, c) => acaoUsuariosConvidar(ctx, c),
  'usuarios.remover': (ctx, c) => acaoUsuariosRemover(ctx, c.id),
  // Aba Conexões (supabase/funcoes-compartilhadas/conexoes.js): nunca devolvem valores de segredos.
  'conexoes.diagnostico': (ctx) => acaoDiagnostico(ctx),
  'conexoes.testar': (ctx, c) => acaoTestar(ctx, c)
};

/** Executa uma ação já autenticada (ctx.usuario é admin). Sempre devolve {ok, ...}. */
export async function executarAcaoAdmin(ctx, corpo) {
  const acao = corpo && corpo.acao;
  if (typeof acao !== 'string' || !Object.prototype.hasOwnProperty.call(ACOES_ADMIN, acao)) return erro('Ação desconhecida.');
  return ACOES_ADMIN[acao](ctx, corpo);
}
