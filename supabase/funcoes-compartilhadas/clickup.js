// Integração com o ClickUp (API v2 REST) — porte de apps-script/ClickUp.gs para as Edge Functions.
// ES module puro: a rede entra por "fetch" injetado (nos testes, um ClickUp falso).
//
// Dados sensíveis: campos cujo nome começa uma palavra com sexo, genero, estado civil, filho, religi,
// gravid, etnia, raca, cor da pele, orientacao, deficien, doenca, saude, antecedente, processo em seu
// nome ou criminal NUNCA são lidos (classificarCampo). Antecedentes só com config.permitirAntecedentes
// e nunca entram no relatório. Telefone e e-mail nunca saem daqui (só servem para achar a tarefa).
import {
  limparTexto, normalizarNomeCampo, classificarCampo, calcularDisc, normalizarProtocolo, configDoProcesso
} from './regras.js';

export const CLICKUP_API = 'https://api.clickup.com/api/v2';
const CU_LIMITE_POR_MINUTO = 90;   // o ClickUp aceita 100/min por token; sobra folga
const CU_MAX_PAGINAS = 50;         // 100 tarefas por página -> até 5.000 tarefas por lista
export const MSG_CU_NAO_CONFIGURADO = 'ClickUp não configurado: falta o segredo CLICKUP_TOKEN nas Edge Functions do Supabase.';

export const CU_CAMPOS_DISC = {
  D: 'DISC D %', I: 'DISC I %', S: 'DISC S %', C: 'DISC C %',
  perfil: 'DISC Perfil', confiabilidade: 'DISC Confiabilidade', codigo: 'DISC Código'
};
const CU_ORDEM_DISC = ['D', 'I', 'S', 'C', 'perfil', 'confiabilidade', 'codigo'];

const CU_APELIDOS = {
  telefone: ['whatsapp', 'telefone', 'celular'],
  idade: ['idade'],
  statusTrabalho: ['status de trabalho'],
  pretensao: ['pretensao salarial'],
  ultimoSalario: ['ultimo salario'],
  formacao: ['formacao', 'escolaridade', 'curso']
};

const CU_ROTULO_CONFIABILIDADE = { alta: 'Alta', media: 'Média', baixa: 'Baixa', indisponivel: 'Indisponível' };

export function cuId(v) { return encodeURIComponent(String(v)); }

/**
 * Cliente do ClickUp para UMA execução: GET guardado (não repete a mesma leitura), escrita limpa o
 * guardado, ritmo de até 90 chamadas/min e uma nova tentativa depois de 429. Erros viram Error em pt-BR
 * (nunca com o token). "avisos" junta o que deu errado sem derrubar (o chamador grava para o painel).
 */
export function criarClickUp(op) {
  const token = (op && op.token) || '';
  const fetchFn = op && op.fetch;
  const dormir = (op && op.dormir) || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const agora = (op && op.agora) || (() => Date.now());
  const estado = { chamadas: [], cache: new Map() };
  const avisos = [];

  async function respeitarLimite() {
    const t = agora();
    estado.chamadas = estado.chamadas.filter((x) => t - x < 60000);
    if (estado.chamadas.length >= CU_LIMITE_POR_MINUTO) {
      await dormir(Math.max(1000, 60000 - (t - estado.chamadas[0])));
      estado.chamadas = [];
    }
    estado.chamadas.push(agora());
  }

  async function requisicao(metodo, caminho, corpo) {
    if (!token) throw new Error(MSG_CU_NAO_CONFIGURADO);
    metodo = metodo.toUpperCase();
    if (metodo === 'GET' && estado.cache.has(caminho)) return estado.cache.get(caminho);
    if (metodo !== 'GET') estado.cache.clear();
    const opcoes = { method: metodo, headers: { Authorization: token } };
    if (corpo !== undefined) {
      opcoes.headers['Content-Type'] = 'application/json';
      opcoes.body = JSON.stringify(corpo);
    }
    for (let tentativa = 0; tentativa < 2; tentativa++) {
      await respeitarLimite();
      let resp;
      try {
        resp = await fetchFn(CLICKUP_API + caminho, opcoes);
      } catch (err) {
        throw new Error('não foi possível falar com o ClickUp (' + String(err && err.message || err).substring(0, 120) + ')');
      }
      const codigo = resp.status;
      if (codigo === 429 && tentativa === 0) {
        const reset = Number(resp.headers && resp.headers.get ? resp.headers.get('x-ratelimit-reset') : NaN) * 1000;
        const t = agora();
        const espera = isFinite(reset) && reset > t ? reset - t : 10000;
        await dormir(Math.min(60000, Math.max(1000, espera)));
        continue;
      }
      const texto = await resp.text().catch(() => '');
      let dados = {};
      try { dados = texto ? JSON.parse(texto) : {}; } catch (err) { dados = {}; }
      if (codigo >= 200 && codigo < 300) {
        if (metodo === 'GET') estado.cache.set(caminho, dados);
        return dados;
      }
      const e = new Error('o ClickUp respondeu ' + codigo + ' em ' + metodo + ' ' + caminho.split('?')[0] +
        (dados && dados.err ? ' (' + String(dados.err).substring(0, 120) + ')' : ''));
      e.status = codigo;
      throw e;
    }
    throw new Error('o ClickUp está recebendo chamadas demais. Tente de novo em 1 minuto.');
  }

  const cu = {
    configurado: !!token,
    pastaId: (op && op.pastaId) || '',
    avisos,
    registrarAviso(msg) { avisos.push(String(msg).substring(0, 300)); },
    get: (c) => requisicao('get', c),
    post: (c, corpo) => requisicao('post', c, corpo),
    put: (c, corpo) => requisicao('put', c, corpo),
    lista: (listId) => requisicao('get', '/list/' + cuId(listId)),
    async campos(listId) { return (await requisicao('get', '/list/' + cuId(listId) + '/field')).fields || []; },
    async tarefas(listId) {
      let todas = [];
      for (let pagina = 0; pagina < CU_MAX_PAGINAS; pagina++) {
        const r = await requisicao('get', '/list/' + cuId(listId) + '/task?page=' + pagina + '&include_closed=true&subtasks=false');
        const tarefas = r.tasks || [];
        todas = todas.concat(tarefas);
        if (r.last_page === true || !tarefas.length) break;
      }
      return todas;
    },
    tarefa: (id) => requisicao('get', '/task/' + cuId(id))
  };
  return cu;
}

/** Listas que aparecem no painel: as da pasta CLICKUP_PASTA_ID, ou todas as acessíveis. */
export async function cuListas(cu) {
  const saida = [];
  const add = (listas, nomePasta) => {
    (listas || []).forEach((l) => saida.push({ id: String(l.id), nome: l.name || '', pasta: nomePasta || (l.folder && l.folder.name) || '' }));
  };
  if (cu.pastaId) {
    add((await cu.get('/folder/' + cuId(cu.pastaId) + '/list?archived=false')).lists, '');
    return saida;
  }
  for (const time of (await cu.get('/team')).teams || []) {
    for (const espaco of (await cu.get('/team/' + cuId(time.id) + '/space?archived=false')).spaces || []) {
      for (const f of (await cu.get('/space/' + cuId(espaco.id) + '/folder?archived=false')).folders || []) {
        const listas = Array.isArray(f.lists) ? f.lists : (await cu.get('/folder/' + cuId(f.id) + '/list?archived=false')).lists;
        add(listas, espaco.name + ' / ' + f.name);
      }
      add((await cu.get('/space/' + cuId(espaco.id) + '/list?archived=false')).lists, espaco.name);
    }
  }
  return saida;
}

// ---------------------------------------------------------------------------
// Conversão de valores dos campos personalizados
// ---------------------------------------------------------------------------

/** "R$ 2.500,00" -> 2500; "7,5" -> 7.5; número fica número. null se não der. */
export function cuNumero(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  let s = String(v).replace(/[^0-9,.\-]/g, '');
  if (!s) return null;
  if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return isFinite(n) ? n : null;
}

/** Valor legível de um campo personalizado (mesma regra do ClickUp.gs). */
export function cuValorCampo(campo, definicao) {
  if (!campo) return null;
  const tipo = campo.type || (definicao && definicao.type) || '';
  const cfg = campo.type_config || (definicao && definicao.type_config) || {};
  const v = campo.value;
  if (tipo === 'checkbox') return v === true || v === 'true';
  if (v === null || v === undefined || v === '') return null;
  const opcoes = cfg.options || [];
  if (tipo === 'drop_down') {
    const achada = opcoes.find((o) => String(o.id) === String(v)) || opcoes.find((o) => Number(o.orderindex) === Number(v));
    return achada ? String(achada.name || achada.label || '') : null;
  }
  if (tipo === 'labels') {
    const ids = Array.isArray(v) ? v : [v];
    const nomes = ids.map((id) => {
      const o = opcoes.find((x) => String(x.id) === String(id));
      return o ? (o.label || o.name || '') : '';
    }).filter(Boolean);
    return nomes.length ? nomes.join(', ') : null;
  }
  if (tipo === 'number' || tipo === 'currency' || tipo === 'emoji') return cuNumero(v);
  if (tipo === 'date') { const t = Number(v); return isFinite(t) ? new Date(t).toISOString() : null; }
  if (typeof v === 'object') return null;
  return String(v);
}

/** Telefone -> {ddd, fim (últimos 8 dígitos)}; aceita +55, 0 na frente, máscara. null se curto demais. */
export function cuChaveTelefone(v) {
  let d = String(v === null || v === undefined ? '' : v).replace(/\D/g, '').replace(/^0+/, '');
  if ((d.length === 12 || d.length === 13) && d.indexOf('55') === 0) d = d.substring(2);
  if (d.length < 8) return null;
  return { ddd: d.length >= 10 ? d.substring(0, 2) : '', fim: d.slice(-8) };
}

export function cuMesmoTelefone(a, b) {
  const x = cuChaveTelefone(a), y = cuChaveTelefone(b);
  if (!x || !y || x.fim !== y.fim) return false;
  return !x.ddd || !y.ddd || x.ddd === y.ddd;
}

function cuCampoPorNome(campos, nome, config) {
  const alvo = normalizarNomeCampo(nome);
  if (!alvo) return null;
  for (const c of campos) {
    if (normalizarNomeCampo(c.name) === alvo) return classificarCampo(c.name, config) === 'sensivel' ? null : c;
  }
  return null;
}

function cuCampoPorApelido(campos, papel, config) {
  const apelidos = CU_APELIDOS[papel];
  const livres = campos.filter((c) => classificarCampo(c.name, config) === '');
  for (const a of apelidos) for (const c of livres) if (normalizarNomeCampo(c.name) === a) return c;
  for (const a of apelidos) {
    for (const c of livres) if ((' ' + normalizarNomeCampo(c.name) + ' ').indexOf(' ' + a + ' ') >= 0) return c;
  }
  return null;
}

function cuCamposTelefone(campos, config) {
  return campos.filter((c) => {
    if (classificarCampo(c.name, config) !== '') return false;
    const n = ' ' + normalizarNomeCampo(c.name) + ' ';
    return c.type === 'phone' || CU_APELIDOS.telefone.some((a) => n.indexOf(' ' + a + ' ') >= 0);
  });
}

function cuValorNaTarefa(tarefa, definicao) {
  if (!definicao) return null;
  const c = (tarefa.custom_fields || []).find((x) => String(x.id) === String(definicao.id));
  return c ? cuValorCampo(c, definicao) : null;
}

export function cuEhBriefing(nome) { return normalizarNomeCampo(nome).indexOf('briefing') === 0; }

// ---------------------------------------------------------------------------
// Confiabilidade (usa DISC_CONFIABILIDADE de js/confiabilidade.js, embutido nas funções)
// ---------------------------------------------------------------------------

export function cuConfiabilidade(motorConfiabilidade, respostas, validacao) {
  if (motorConfiabilidade && typeof motorConfiabilidade.avaliar === 'function') {
    try {
      const r = motorConfiabilidade.avaliar(respostas, validacao || null);
      return { nivel: r.nivel, motivos: (r.motivos || []).slice(0, 10) };
    } catch (err) { /* cai no padrão abaixo */ }
  }
  return { nivel: 'indisponivel', motivos: ['Confiabilidade não calculada no servidor.'] };
}

function cuNivelDeTexto(t) {
  const n = normalizarNomeCampo(t);
  if (n.indexOf('alta') === 0) return 'alta';
  if (n.indexOf('media') === 0) return 'media';
  if (n.indexOf('baixa') === 0) return 'baixa';
  return 'indisponivel';
}

// ---------------------------------------------------------------------------
// Envio do candidato -> tarefa no ClickUp
// ---------------------------------------------------------------------------

/**
 * Grava o resultado do DISC na tarefa do candidato (achada pelo WhatsApp). Sem tarefa: cria
 * "<nome> (DISC)" com o WhatsApp na descrição e a etiqueta "sem formulário". Campos DISC que faltam
 * na lista -> resultado num comentário. resposta = {nome, telefone, respostas, validacao, protocolo}.
 * Lança erro se o ClickUp falhar.
 */
export async function cuSincronizarEnvio(cu, processo, resposta, motorConfiabilidade) {
  if (!cu.configurado) return { ok: false, avisos: [MSG_CU_NAO_CONFIGURADO] };
  const listId = processo.clickupListId;
  const config = configDoProcesso(processo);
  const protocolo = resposta.protocolo || '';
  const campos = await cu.campos(listId);
  const telefones = cuCamposTelefone(campos, config);
  const avisos = [];
  let tarefa = null;
  if (telefones.length) {
    const tarefas = await cu.tarefas(listId);
    for (const t of tarefas) {
      if (tarefa) break;
      if (cuEhBriefing(t.name)) continue;
      for (const c of telefones) {
        const tel = cuValorNaTarefa(t, c);
        if (tel && cuMesmoTelefone(tel, resposta.telefone)) { tarefa = t; break; }
      }
    }
  } else {
    avisos.push('A lista não tem campo de WhatsApp/telefone: não deu para achar a tarefa do candidato.');
  }
  let criada = false;
  if (!tarefa) {
    tarefa = await cu.post('/list/' + cuId(listId) + '/task', {
      name: resposta.nome + ' (DISC)',
      description: 'WhatsApp: +' + resposta.telefone + '\nCriada pelo teste DISC: o candidato não foi encontrado na lista (sem formulário).',
      tags: ['sem formulário']
    });
    criada = true;
  }
  const r = calcularDisc(resposta.respostas);
  const conf = cuConfiabilidade(motorConfiabilidade, resposta.respostas, resposta.validacao);
  const valores = {
    D: r.percentuais.D, I: r.percentuais.I, S: r.percentuais.S, C: r.percentuais.C,
    perfil: r.codigo, confiabilidade: CU_ROTULO_CONFIABILIDADE[conf.nivel] || 'Indisponível', codigo: protocolo
  };
  const faltando = [];
  for (const k of CU_ORDEM_DISC) {
    const campo = cuCampoPorNome(campos, CU_CAMPOS_DISC[k], config);
    if (!campo) { faltando.push(CU_CAMPOS_DISC[k]); continue; }
    let valor = valores[k];
    if (campo.type === 'drop_down') {
      const opcoes = (campo.type_config && campo.type_config.options) || [];
      const opcao = opcoes.find((o) => normalizarNomeCampo(o.name) === normalizarNomeCampo(valor));
      if (!opcao) { faltando.push(CU_CAMPOS_DISC[k]); continue; }
      valor = opcao.id;
    } else if (campo.type !== 'number' && campo.type !== 'currency') {
      valor = String(valor);
    }
    await cu.post('/task/' + cuId(tarefa.id) + '/field/' + cuId(campo.id), { value: valor });
  }
  if (faltando.length) {
    await cu.post('/task/' + cuId(tarefa.id) + '/comment', {
      comment_text: 'Resultado do teste DISC\n' +
        'Perfil: ' + valores.perfil + '\n' +
        'D ' + valores.D + '% · I ' + valores.I + '% · S ' + valores.S + '% · C ' + valores.C + '%\n' +
        'Confiabilidade: ' + valores.confiabilidade + '\n' +
        'Código: ' + valores.codigo,
      notify_all: false
    });
    avisos.push('Campos que faltam na lista: ' + faltando.join(', ') + '. O resultado foi gravado num comentário da tarefa.');
  }
  if (criada) avisos.push('Candidato não encontrado pelo WhatsApp: tarefa "' + resposta.nome + ' (DISC)" criada com a etiqueta "sem formulário".');
  avisos.forEach((a) => cu.registrarAviso('Envio ' + protocolo + ': ' + a));
  return { ok: true, tarefaId: String(tarefa.id), criada, avisos };
}

// ---------------------------------------------------------------------------
// Dados normalizados do processo (contrato "processoDados")
// ---------------------------------------------------------------------------

/** Linha de public.respostas -> item com resultado recalculado (ignora linha com respostas inválidas). */
export function itemDaResposta(l) {
  let resultado = null;
  try { resultado = calcularDisc(String(l.respostas || '')); } catch (err) { resultado = null; }
  let validacao = l.validacao === undefined ? null : l.validacao;
  if (typeof validacao === 'string') { try { validacao = JSON.parse(validacao); } catch (err) { validacao = null; } }
  return {
    id: String(l.id), telefone: l.telefone || '', respostas: l.respostas || '', validacao,
    protocolo: normalizarProtocolo(l.protocolo), resultado,
    pessoaId: l.pessoa_id ? String(l.pessoa_id) : '', recebidoEm: l.recebido_em ? String(l.recebido_em) : ''
  };
}

/**
 * Mesma pessoa com várias respostas no processo: fica só a MAIS RECENTE (por recebido_em). A pessoa é o
 * mesmo WhatsApp (como public.pessoas; vale também para linha antiga ainda sem pessoa_id) ou, sem telefone
 * utilizável, o pessoa_id. Mantém a ordem original das que ficam.
 */
export function respostasMaisRecentesPorPessoa(itens) {
  const tempo = (it) => { const t = Date.parse(it.recebidoEm); return isNaN(t) ? -Infinity : t; };
  const chave = (it) => {
    const t = cuChaveTelefone(it.telefone);
    if (t) return 't:' + t.ddd + t.fim;
    return it.pessoaId ? 'p:' + it.pessoaId : 'id:' + it.id;
  };
  const escolhida = {};
  itens.forEach((it, i) => {
    const k = chave(it);
    if (escolhida[k] === undefined || tempo(it) >= tempo(itens[escolhida[k]])) escolhida[k] = i;
  });
  const ficam = new Set(Object.values(escolhida));
  return itens.filter((_, i) => ficam.has(i));
}

function cuDiscDaResposta(item, motorConfiabilidade) {
  return {
    percentuais: item.resultado.percentuais,
    codigo: item.resultado.codigo,
    confiabilidade: cuConfiabilidade(motorConfiabilidade, item.respostas, item.validacao),
    protocolo: item.protocolo || ''
  };
}

function cuDiscDaTarefa(tarefa, camposDisc) {
  const v = (k) => (camposDisc[k] ? cuValorNaTarefa(tarefa, camposDisc[k]) : null);
  const p = { D: cuNumero(v('D')), I: cuNumero(v('I')), S: cuNumero(v('S')), C: cuNumero(v('C')) };
  if (p.D === null || p.I === null || p.S === null || p.C === null) return null;
  let codigo = String(v('perfil') || '').toUpperCase().replace(/[^DISC]/g, '').substring(0, 2);
  if (codigo.length < 2) codigo = ['D', 'I', 'S', 'C'].sort((a, b) => p[b] - p[a]).slice(0, 2).join('');
  return {
    percentuais: p, codigo,
    confiabilidade: { nivel: cuNivelDeTexto(v('confiabilidade')), motivos: [] },
    protocolo: normalizarProtocolo(v('codigo')) || String(v('codigo') || '').substring(0, 12)
  };
}

function cuNota(v) {
  const n = cuNumero(v);
  return n === null ? null : Math.max(0, Math.min(10, n));
}

/**
 * Monta processoDados a partir do ClickUp e das respostas do DISC gravadas no banco (linhas de
 * public.respostas do processo). Só lê os campos que o contrato usa. Lança erro se o ClickUp falhar.
 */
export async function cuMontarDadosProcesso(cu, proc, linhasRespostas, motorConfiabilidade) {
  const config = configDoProcesso(proc);
  const listId = proc.clickupListId;
  const lista = await cu.lista(listId);
  const campos = await cu.campos(listId);
  const tarefas = await cu.tarefas(listId);
  const avisos = [];

  const papeis = {};
  Object.keys(CU_APELIDOS).forEach((p) => { if (p !== 'telefone') papeis[p] = cuCampoPorApelido(campos, p, config); });
  const telefones = cuCamposTelefone(campos, config);
  const camposDisc = {};
  CU_ORDEM_DISC.forEach((k) => { camposDisc[k] = cuCampoPorNome(campos, CU_CAMPOS_DISC[k], config); });
  const antecedentes = config.permitirAntecedentes === true
    ? campos.filter((c) => classificarCampo(c.name, config) === 'antecedente')
    : [];

  const campoConfigurado = (nomeCampo, rotulo) => {
    if (!nomeCampo) { avisos.push(rotulo + ' sem campo do ClickUp configurado.'); return null; }
    if (classificarCampo(nomeCampo, config) === 'sensivel') {
      avisos.push('Campo "' + nomeCampo + '" é um dado sensível e foi ignorado.');
      return null;
    }
    const c = cuCampoPorNome(campos, nomeCampo, config);
    if (!c) avisos.push('Campo "' + nomeCampo + '" não encontrado na lista');
    return c;
  };
  const camposEtapa = {};
  config.etapas.forEach((e) => { camposEtapa[e.id] = campoConfigurado(e.campo, 'Etapa "' + e.nome + '"'); });
  const camposBonus = {};
  config.bonus.forEach((b) => { camposBonus[b.id] = campoConfigurado(b.campo, 'Bônus "' + b.nome + '"'); });

  const respostas = respostasMaisRecentesPorPessoa((linhasRespostas || []).map(itemDaResposta).filter((it) => it.resultado));
  const usadas = {};
  const finalistasStatus = config.statusFinalistas.map(normalizarNomeCampo);

  const candidatos = [];
  for (const t of tarefas) {
    if (cuEhBriefing(t.name)) continue;
    const fones = telefones.map((c) => cuValorNaTarefa(t, c)).filter(Boolean);
    let disc = null;
    for (const resp of respostas) {
      if (disc) break;
      if (usadas[resp.id]) continue;
      if (fones.some((f) => cuMesmoTelefone(f, resp.telefone))) {
        disc = cuDiscDaResposta(resp, motorConfiabilidade);
        usadas[resp.id] = true;
      }
    }
    if (!disc) disc = cuDiscDaTarefa(t, camposDisc);

    const idadeBruta = cuValorNaTarefa(t, papeis.idade);
    let idade = typeof idadeBruta === 'number' ? Math.round(idadeBruta) : null;
    let idadeFaixa = (idadeBruta !== null && typeof idadeBruta !== 'number') ? String(idadeBruta) : null;
    if (idade === null && idadeFaixa && /^\s*\d{1,3}\s*$/.test(idadeFaixa)) { idade = Number(idadeFaixa); idadeFaixa = null; }

    const notas = {};
    let temNota = false;
    config.etapas.forEach((e) => {
      notas[e.id] = cuNota(cuValorNaTarefa(t, camposEtapa[e.id]));
      if (notas[e.id] !== null) temNota = true;
    });
    const bonusValores = {};
    config.bonus.forEach((b) => {
      const c = camposBonus[b.id];
      bonusValores[b.id] = c ? cuValorNaTarefa(t, c) : null;
    });
    const status = (t.status && t.status.status) || '';
    const finalista = finalistasStatus.length
      ? finalistasStatus.indexOf(normalizarNomeCampo(status)) >= 0
      : (temNota || !!disc);
    const texto = (c) => { const v = cuValorNaTarefa(t, c); return v === null || v === undefined ? null : String(v); };
    const cand = {
      id: String(t.id),
      nome: limparTexto(t.name, 120).replace(/\s*\(DISC\)\s*$/, ''),
      status,
      criadoEm: isFinite(Number(t.date_created)) && t.date_created ? new Date(Number(t.date_created)).toISOString() : '',
      idade,
      idadeFaixa,
      statusTrabalho: texto(papeis.statusTrabalho),
      pretensao: cuNumero(cuValorNaTarefa(t, papeis.pretensao)),
      ultimoSalario: cuNumero(cuValorNaTarefa(t, papeis.ultimoSalario)),
      formacao: texto(papeis.formacao),
      notas,
      bonusValores,
      disc,
      finalista
    };
    if (antecedentes.length) {
      cand.antecedentes = antecedentes.map((c) => cuValorNaTarefa(t, c))
        .filter((v) => v !== null && v !== false).map(String).join('; ') || null;
    }
    candidatos.push(cand);
  }
  const sobra = respostas.filter((r) => !usadas[r.id]).length;
  if (sobra) avisos.push(sobra + (sobra === 1 ? ' resposta' : ' respostas') + ' do DISC deste processo sem tarefa correspondente no ClickUp (WhatsApp diferente).');

  return {
    processo: {
      id: proc.id, nome: proc.nome, codigo: proc.codigo,
      empresa: proc.empresa || '',
      vaga: proc.vaga || '', cidade: proc.cidade || '', consultor: proc.consultor || '',
      contratante: proc.contratante || '',
      periodo: { inicio: proc.periodoInicio || '', fim: proc.periodoFim || '' },
      clickupListId: proc.clickupListId
    },
    config,
    status: (lista.statuses || []).map((s) => ({ nome: s.status, tipo: s.type, cor: s.color })),
    candidatos,
    avisos
  };
}
