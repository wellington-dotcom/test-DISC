/**
 * ClickUp.gs — integração com o ClickUp (API v2 REST). Faz parte do mesmo projeto do Code.gs
 * (o Apps Script carrega todos os .gs no mesmo escopo global: nomes aqui começam com "cu").
 *
 * O ClickUp é a FONTE dos candidatos: cada processo seletivo é uma lista do ClickUp. A planilha guarda
 * só os processos (config), as respostas do DISC (cópia de segurança), os logins e os relatórios.
 *
 * Segredos nas Propriedades do script (nunca voltam ao navegador):
 *   CLICKUP_TOKEN      token pessoal do ClickUp (pk_...)
 *   CLICKUP_PASTA_ID   opcional: só as listas desta pasta aparecem no painel
 *
 * Dados sensíveis: campos cujo nome (minúsculas, sem acento) começa uma palavra com sexo, genero,
 * estado civil, filho, religi, gravid, etnia, raca, cor da pele, orientacao, deficien, doenca, saude,
 * antecedente, processo em seu nome ou criminal NUNCA são lidos (ver classificarCampo no Code.gs).
 * Antecedentes só com config.permitirAntecedentes === true, e nunca entram no relatório do contratante.
 * Telefone e e-mail nunca saem daqui (servem só para achar a tarefa do candidato).
 */

var CLICKUP_API = 'https://api.clickup.com/api/v2';
var CU_LIMITE_POR_MINUTO = 90;     // o ClickUp aceita 100/min por token; sobra folga
var CU_MAX_PAGINAS = 50;           // 100 tarefas por página -> até 5.000 tarefas por lista
var CU_MAX_AVISOS = 20;
var MSG_CU_NAO_CONFIGURADO = 'ClickUp não configurado: falta a propriedade CLICKUP_TOKEN nas Propriedades do script.';

// Campos que o sistema grava na tarefa do candidato (nomes exatos; comparados já normalizados).
var CU_CAMPOS_DISC = {
  D: 'DISC D %', I: 'DISC I %', S: 'DISC S %', C: 'DISC C %',
  perfil: 'DISC Perfil', confiabilidade: 'DISC Confiabilidade', codigo: 'DISC Código'
};
var CU_ORDEM_DISC = ['D', 'I', 'S', 'C', 'perfil', 'confiabilidade', 'codigo'];

// Campos do formulário reconhecidos pelo nome (apelidos já normalizados).
var CU_APELIDOS = {
  telefone: ['whatsapp', 'telefone', 'celular'],
  idade: ['idade'],
  statusTrabalho: ['status de trabalho'],
  pretensao: ['pretensao salarial'],
  ultimoSalario: ['ultimo salario'],
  formacao: ['formacao', 'escolaridade', 'curso']
};

var CU_ROTULO_CONFIABILIDADE = { alta: 'Alta', media: 'Média', baixa: 'Baixa', indisponivel: 'Indisponível' };

// Estado de UMA execução (zerado no começo de cada requisição por cuReiniciar_).
var cuEstado_ = { chamadas: [], cache: {} };

function cuReiniciar_() { cuEstado_ = { chamadas: [], cache: {} }; }

function cuToken_() {
  return PropertiesService.getScriptProperties().getProperty('CLICKUP_TOKEN') || '';
}

function cuConfigurado() { return !!cuToken_(); }

/** Segura o ritmo: no máximo CU_LIMITE_POR_MINUTO chamadas em 60 s nesta execução. */
function cuRespeitarLimite_() {
  var agora = Date.now();
  cuEstado_.chamadas = cuEstado_.chamadas.filter(function (t) { return agora - t < 60000; });
  if (cuEstado_.chamadas.length >= CU_LIMITE_POR_MINUTO) {
    Utilities.sleep(Math.max(1000, 60000 - (agora - cuEstado_.chamadas[0])));
    cuEstado_.chamadas = [];
  }
  cuEstado_.chamadas.push(Date.now());
}

/**
 * Chamada à API do ClickUp. GET fica guardado durante a execução (não repete a mesma leitura).
 * 429 (limite): espera o tempo indicado e tenta mais uma vez. Erro -> lança Error em pt-BR (sem o token).
 */
function cuRequisicao_(metodo, caminho, corpo) {
  var token = cuToken_();
  if (!token) throw new Error(MSG_CU_NAO_CONFIGURADO);
  metodo = metodo.toLowerCase();
  if (metodo === 'get' && Object.prototype.hasOwnProperty.call(cuEstado_.cache, caminho)) return cuEstado_.cache[caminho];
  if (metodo !== 'get') cuEstado_.cache = {}; // escrita: leituras guardadas podem ter ficado velhas
  var opcoes = { method: metodo, headers: { Authorization: token }, muteHttpExceptions: true };
  if (corpo !== undefined) {
    opcoes.contentType = 'application/json';
    opcoes.payload = JSON.stringify(corpo);
  }
  for (var tentativa = 0; tentativa < 2; tentativa++) {
    cuRespeitarLimite_();
    var resp = UrlFetchApp.fetch(CLICKUP_API + caminho, opcoes);
    var codigo = resp.getResponseCode();
    if (codigo === 429 && tentativa === 0) {
      var cab = resp.getHeaders ? (resp.getHeaders() || {}) : {};
      var reset = Number(cab['X-RateLimit-Reset'] || cab['x-ratelimit-reset']) * 1000;
      var espera = isFinite(reset) && reset > Date.now() ? reset - Date.now() : 10000;
      Utilities.sleep(Math.min(60000, Math.max(1000, espera)));
      continue;
    }
    var texto = resp.getContentText() || '';
    var dados = {};
    try { dados = texto ? JSON.parse(texto) : {}; } catch (err) { dados = {}; }
    if (codigo >= 200 && codigo < 300) {
      if (metodo === 'get') cuEstado_.cache[caminho] = dados;
      return dados;
    }
    var e = new Error('o ClickUp respondeu ' + codigo + ' em ' + metodo.toUpperCase() + ' ' + caminho.split('?')[0] +
      (dados && dados.err ? ' (' + String(dados.err).substring(0, 120) + ')' : ''));
    e.status = codigo;
    throw e;
  }
  throw new Error('o ClickUp está recebendo chamadas demais. Tente de novo em 1 minuto.');
}

function cuGet_(caminho) { return cuRequisicao_('get', caminho); }
function cuPost_(caminho, corpo) { return cuRequisicao_('post', caminho, corpo); }
function cuPut_(caminho, corpo) { return cuRequisicao_('put', caminho, corpo); }
function cuId_(v) { return encodeURIComponent(String(v)); }

/** Guarda um aviso (últimos 20, 6 h) para o painel ver em clickup.status, e registra no log. */
function cuRegistrarAviso_(msg) {
  try { console.warn(msg); } catch (err) { /* sem console */ }
  try {
    var cache = CacheService.getScriptCache();
    var lista = [];
    try { lista = JSON.parse(cache.get('clickup_avisos') || '[]') || []; } catch (err) { lista = []; }
    lista.unshift({ em: new Date(agora_()).toISOString(), aviso: String(msg).substring(0, 300) });
    cache.put('clickup_avisos', JSON.stringify(lista.slice(0, CU_MAX_AVISOS)), 21600);
  } catch (err) { /* aviso nunca derruba nada */ }
}

function cuAvisosRecentes_() {
  try { return JSON.parse(CacheService.getScriptCache().get('clickup_avisos') || '[]') || []; } catch (err) { return []; }
}

// ---------------------------------------------------------------------------
// Leitura: listas, campos e tarefas
// ---------------------------------------------------------------------------

function cuLista_(listId) { return cuGet_('/list/' + cuId_(listId)); }

function cuCamposDaLista_(listId) {
  return (cuGet_('/list/' + cuId_(listId) + '/field').fields || []);
}

/** Todas as tarefas da lista (inclui fechadas, sem subtarefas), página por página até last_page. */
function cuTarefasDaLista_(listId) {
  var todas = [];
  for (var pagina = 0; pagina < CU_MAX_PAGINAS; pagina++) {
    var r = cuGet_('/list/' + cuId_(listId) + '/task?page=' + pagina + '&include_closed=true&subtasks=false');
    var tarefas = r.tasks || [];
    todas = todas.concat(tarefas);
    if (r.last_page === true || !tarefas.length) break;
  }
  return todas;
}

/** Listas que aparecem no painel: as da pasta CLICKUP_PASTA_ID, ou todas as acessíveis. */
function cuListas_() {
  var pasta = PropertiesService.getScriptProperties().getProperty('CLICKUP_PASTA_ID');
  var saida = [];
  function add(listas, nomePasta) {
    (listas || []).forEach(function (l) {
      saida.push({ id: String(l.id), nome: l.name || '', pasta: nomePasta || (l.folder && l.folder.name) || '' });
    });
  }
  if (pasta) {
    add(cuGet_('/folder/' + cuId_(pasta) + '/list?archived=false').lists, '');
    return saida;
  }
  (cuGet_('/team').teams || []).forEach(function (time) {
    (cuGet_('/team/' + cuId_(time.id) + '/space?archived=false').spaces || []).forEach(function (espaco) {
      (cuGet_('/space/' + cuId_(espaco.id) + '/folder?archived=false').folders || []).forEach(function (f) {
        // A resposta de /folder já costuma trazer as listas; só pergunta de novo se não trouxer.
        var listas = Array.isArray(f.lists) ? f.lists : cuGet_('/folder/' + cuId_(f.id) + '/list?archived=false').lists;
        add(listas, espaco.name + ' / ' + f.name);
      });
      add(cuGet_('/space/' + cuId_(espaco.id) + '/list?archived=false').lists, espaco.name);
    });
  });
  return saida;
}

// ---------------------------------------------------------------------------
// Conversão de valores dos campos personalizados
// ---------------------------------------------------------------------------

/** "R$ 2.500,00" -> 2500; "7,5" -> 7.5; número fica número. null se não der. */
function cuNumero(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  var s = String(v).replace(/[^0-9,.\-]/g, '');
  if (!s) return null;
  if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
  var n = Number(s);
  return isFinite(n) ? n : null;
}

/**
 * Valor de um campo personalizado da tarefa, já legível: drop_down (orderindex ou id da opção -> nome),
 * labels (ids -> nomes, separados por vírgula), number/currency/emoji -> número, checkbox -> boolean,
 * phone/text/short_text/email/url -> texto, date -> ISO. Sem valor -> null.
 * "definicao" (opcional) é o campo vindo de /list/{id}/field, com as opções.
 */
function cuValorCampo(campo, definicao) {
  if (!campo) return null;
  var tipo = campo.type || (definicao && definicao.type) || '';
  var cfg = campo.type_config || (definicao && definicao.type_config) || {};
  var v = campo.value;
  if (tipo === 'checkbox') return v === true || v === 'true';
  if (v === null || v === undefined || v === '') return null;
  var opcoes = cfg.options || [];
  if (tipo === 'drop_down') {
    var achada = null;
    for (var i = 0; i < opcoes.length && !achada; i++) if (String(opcoes[i].id) === String(v)) achada = opcoes[i];
    for (i = 0; i < opcoes.length && !achada; i++) if (Number(opcoes[i].orderindex) === Number(v)) achada = opcoes[i];
    return achada ? String(achada.name || achada.label || '') : null;
  }
  if (tipo === 'labels') {
    var ids = Array.isArray(v) ? v : [v];
    var nomes = ids.map(function (id) {
      for (var j = 0; j < opcoes.length; j++) if (String(opcoes[j].id) === String(id)) return opcoes[j].label || opcoes[j].name || '';
      return '';
    }).filter(Boolean);
    return nomes.length ? nomes.join(', ') : null;
  }
  if (tipo === 'number' || tipo === 'currency' || tipo === 'emoji') return cuNumero(v);
  if (tipo === 'date') { var t = Number(v); return isFinite(t) ? new Date(t).toISOString() : null; }
  if (typeof v === 'object') return null;
  return String(v);
}

/** Telefone -> {ddd, fim (últimos 8 dígitos)}; aceita +55, 0 na frente, máscara. null se curto demais. */
function cuChaveTelefone(v) {
  var d = String(v === null || v === undefined ? '' : v).replace(/\D/g, '').replace(/^0+/, '');
  if ((d.length === 12 || d.length === 13) && d.indexOf('55') === 0) d = d.substring(2);
  if (d.length < 8) return null;
  return { ddd: d.length >= 10 ? d.substring(0, 2) : '', fim: d.slice(-8) };
}

/** Mesmo telefone: últimos 8 dígitos iguais e DDD igual (quando os dois lados têm DDD). */
function cuMesmoTelefone(a, b) {
  var x = cuChaveTelefone(a), y = cuChaveTelefone(b);
  if (!x || !y || x.fim !== y.fim) return false;
  return !x.ddd || !y.ddd || x.ddd === y.ddd;
}

/** Acha o campo da lista pelo nome exato (normalizado). Campos sensíveis nunca são devolvidos. */
function cuCampoPorNome_(campos, nome, config) {
  var alvo = normalizarNomeCampo(nome);
  if (!alvo) return null;
  for (var i = 0; i < campos.length; i++) {
    if (normalizarNomeCampo(campos[i].name) === alvo) {
      return classificarCampo(campos[i].name, config) === 'sensivel' ? null : campos[i];
    }
  }
  return null;
}

/** Acha um campo do formulário pelos apelidos (igual primeiro; depois como palavra dentro do nome). */
function cuCampoPorApelido_(campos, papel, config) {
  var apelidos = CU_APELIDOS[papel];
  var livres = campos.filter(function (c) { return classificarCampo(c.name, config) === ''; });
  for (var i = 0; i < apelidos.length; i++) {
    for (var j = 0; j < livres.length; j++) if (normalizarNomeCampo(livres[j].name) === apelidos[i]) return livres[j];
  }
  for (i = 0; i < apelidos.length; i++) {
    for (j = 0; j < livres.length; j++) {
      if ((' ' + normalizarNomeCampo(livres[j].name) + ' ').indexOf(' ' + apelidos[i] + ' ') >= 0) return livres[j];
    }
  }
  return null;
}

function cuCamposTelefone_(campos, config) {
  return campos.filter(function (c) {
    if (classificarCampo(c.name, config) !== '') return false;
    var n = ' ' + normalizarNomeCampo(c.name) + ' ';
    return c.type === 'phone' || CU_APELIDOS.telefone.some(function (a) { return n.indexOf(' ' + a + ' ') >= 0; });
  });
}

function cuValorNaTarefa_(tarefa, definicao) {
  if (!definicao) return null;
  var lista = tarefa.custom_fields || [];
  for (var i = 0; i < lista.length; i++) if (String(lista[i].id) === String(definicao.id)) return cuValorCampo(lista[i], definicao);
  return null;
}

function cuEhBriefing_(nome) { return normalizarNomeCampo(nome).indexOf('briefing') === 0; }

// ---------------------------------------------------------------------------
// Confiabilidade (o servidor usa DISC_CONFIABILIDADE se o arquivo estiver no projeto)
// ---------------------------------------------------------------------------

function cuConfiabilidade_(respostas, validacao) {
  if (typeof DISC_CONFIABILIDADE !== 'undefined' && DISC_CONFIABILIDADE && typeof DISC_CONFIABILIDADE.avaliar === 'function') {
    try {
      var r = DISC_CONFIABILIDADE.avaliar(respostas, validacao || null);
      return { nivel: r.nivel, motivos: (r.motivos || []).slice(0, 10) };
    } catch (err) { /* cai no padrão abaixo */ }
  }
  return { nivel: 'indisponivel', motivos: ['Confiabilidade não calculada no servidor.'] };
}

function cuNivelDeTexto_(t) {
  var n = normalizarNomeCampo(t);
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
 * "<nome> (DISC)" com o WhatsApp na descrição e a etiqueta "sem formulário". Campos DISC que não
 * existem na lista -> tudo vai num comentário da tarefa (e um aviso). Lança erro se o ClickUp falhar.
 */
function cuSincronizarEnvio(processo, payload, protocolo) {
  if (!cuConfigurado()) return { ok: false, avisos: [MSG_CU_NAO_CONFIGURADO] };
  var listId = processo.clickupListId;
  var config = configDoProcesso_(processo);
  var campos = cuCamposDaLista_(listId);
  var telefones = cuCamposTelefone_(campos, config);
  var avisos = [];
  var tarefa = null;
  if (telefones.length) {
    var tarefas = cuTarefasDaLista_(listId);
    for (var i = 0; i < tarefas.length && !tarefa; i++) {
      if (cuEhBriefing_(tarefas[i].name)) continue;
      for (var j = 0; j < telefones.length && !tarefa; j++) {
        var tel = cuValorNaTarefa_(tarefas[i], telefones[j]);
        if (tel && cuMesmoTelefone(tel, payload.telefone)) tarefa = tarefas[i];
      }
    }
  } else {
    avisos.push('A lista não tem campo de WhatsApp/telefone: não deu para achar a tarefa do candidato.');
  }
  var criada = false;
  if (!tarefa) {
    tarefa = cuPost_('/list/' + cuId_(listId) + '/task', {
      name: payload.nome + ' (DISC)',
      description: 'WhatsApp: +' + payload.telefone + '\nCriada pelo teste DISC: o candidato não foi encontrado na lista (sem formulário).',
      tags: ['sem formulário']
    });
    criada = true;
  }
  var r = calcularDisc(payload.respostas);
  var conf = cuConfiabilidade_(payload.respostas, payload.validacao);
  var valores = {
    D: r.percentuais.D, I: r.percentuais.I, S: r.percentuais.S, C: r.percentuais.C,
    perfil: r.codigo, confiabilidade: CU_ROTULO_CONFIABILIDADE[conf.nivel] || 'Indisponível', codigo: protocolo || ''
  };
  var faltando = [];
  CU_ORDEM_DISC.forEach(function (k) {
    var campo = cuCampoPorNome_(campos, CU_CAMPOS_DISC[k], config);
    if (!campo) { faltando.push(CU_CAMPOS_DISC[k]); return; }
    var valor = valores[k];
    if (campo.type === 'drop_down') {
      var opcoes = (campo.type_config && campo.type_config.options) || [];
      var op = opcoes.filter(function (o) { return normalizarNomeCampo(o.name) === normalizarNomeCampo(valor); })[0];
      if (!op) { faltando.push(CU_CAMPOS_DISC[k]); return; }
      valor = op.id;
    } else if (campo.type !== 'number' && campo.type !== 'currency') {
      valor = String(valor);
    }
    cuPost_('/task/' + cuId_(tarefa.id) + '/field/' + cuId_(campo.id), { value: valor });
  });
  if (faltando.length) {
    cuPost_('/task/' + cuId_(tarefa.id) + '/comment', {
      comment_text: 'Resultado do teste DISC\n' +
        'Perfil: ' + valores.perfil + '\n' +
        'D ' + valores.D + '% · I ' + valores.I + '% · S ' + valores.S + '% · C ' + valores.C + '%\n' +
        'Confiabilidade: ' + valores.confiabilidade + '\n' +
        'Código: ' + valores.codigo,
      notify_all: false
    });
    avisos.push('Campos que faltam na lista: ' + faltando.join(', ') + '. O resultado foi gravado num comentário da tarefa.');
  }
  if (criada) avisos.push('Candidato não encontrado pelo WhatsApp: tarefa "' + payload.nome + ' (DISC)" criada com a etiqueta "sem formulário".');
  avisos.forEach(function (a) { cuRegistrarAviso_('Envio ' + (protocolo || '') + ': ' + a); });
  return { ok: true, tarefaId: String(tarefa.id), criada: criada, avisos: avisos };
}

// ---------------------------------------------------------------------------
// Dados normalizados do processo (contrato "processoDados")
// ---------------------------------------------------------------------------

/** Respostas do DISC gravadas na planilha para o código do processo (cópia de segurança). */
function cuRespostasDoProcesso_(codigo) {
  var aba = obterAba_();
  var ultima = aba.getLastRow();
  if (ultima < 2 || !codigo) return [];
  return aba.getRange(2, 1, ultima - 1, CABECALHO.length).getValues()
    .filter(function (l) { return String(l[COL.id] || '').trim(); })
    .map(linhaParaItem)
    .filter(function (it) { return it.avaliacao === codigo && it.resultado; });
}

function cuDiscDaResposta_(item) {
  return {
    percentuais: item.resultado.percentuais,
    codigo: item.resultado.codigo,
    confiabilidade: cuConfiabilidade_(item.respostas, item.validacao),
    protocolo: item.protocolo || ''
  };
}

/** DISC gravado nos campos da tarefa (quando não há cópia na planilha). null se não houver. */
function cuDiscDaTarefa_(tarefa, camposDisc) {
  function v(k) { return camposDisc[k] ? cuValorNaTarefa_(tarefa, camposDisc[k]) : null; }
  var p = { D: cuNumero(v('D')), I: cuNumero(v('I')), S: cuNumero(v('S')), C: cuNumero(v('C')) };
  if (p.D === null || p.I === null || p.S === null || p.C === null) return null;
  var codigo = String(v('perfil') || '').toUpperCase().replace(/[^DISC]/g, '').substring(0, 2);
  if (codigo.length < 2) {
    codigo = ['D', 'I', 'S', 'C'].sort(function (a, b) { return p[b] - p[a]; }).slice(0, 2).join('');
  }
  var nivel = cuNivelDeTexto_(v('confiabilidade'));
  return {
    percentuais: p, codigo: codigo,
    confiabilidade: { nivel: nivel, motivos: [] },
    protocolo: normalizarProtocolo(v('codigo')) || String(v('codigo') || '').substring(0, 12)
  };
}

function cuNota_(v) {
  var n = cuNumero(v);
  if (n === null) return null;
  return Math.max(0, Math.min(10, n));
}

/**
 * Monta processoDados a partir do ClickUp (e da cópia do DISC na planilha). Só lê os campos que o
 * contrato usa; nenhum campo sensível é lido. Lança erro se o ClickUp falhar.
 */
function cuMontarDadosProcesso(proc) {
  var config = configDoProcesso_(proc);
  var listId = proc.clickupListId;
  var lista = cuLista_(listId);
  var campos = cuCamposDaLista_(listId);
  var tarefas = cuTarefasDaLista_(listId);
  var avisos = [];

  var papeis = {};
  Object.keys(CU_APELIDOS).forEach(function (p) { if (p !== 'telefone') papeis[p] = cuCampoPorApelido_(campos, p, config); });
  var telefones = cuCamposTelefone_(campos, config);
  var camposDisc = {};
  CU_ORDEM_DISC.forEach(function (k) { camposDisc[k] = cuCampoPorNome_(campos, CU_CAMPOS_DISC[k], config); });
  var antecedentes = config.permitirAntecedentes === true
    ? campos.filter(function (c) { return classificarCampo(c.name, config) === 'antecedente'; })
    : [];

  function campoConfigurado(nomeCampo, rotulo) {
    if (!nomeCampo) { avisos.push(rotulo + ' sem campo do ClickUp configurado.'); return null; }
    if (classificarCampo(nomeCampo, config) === 'sensivel') {
      avisos.push('Campo "' + nomeCampo + '" é um dado sensível e foi ignorado.');
      return null;
    }
    var c = cuCampoPorNome_(campos, nomeCampo, config);
    if (!c) avisos.push('Campo "' + nomeCampo + '" não encontrado na lista');
    return c;
  }
  var camposEtapa = {};
  config.etapas.forEach(function (e) { camposEtapa[e.id] = campoConfigurado(e.campo, 'Etapa "' + e.nome + '"'); });
  var camposBonus = {};
  config.bonus.forEach(function (b) { camposBonus[b.id] = campoConfigurado(b.campo, 'Bônus "' + b.nome + '"'); });

  var respostas = cuRespostasDoProcesso_(proc.codigo);
  var usadas = {};
  var finalistasStatus = config.statusFinalistas.map(normalizarNomeCampo);

  var candidatos = [];
  tarefas.forEach(function (t) {
    if (cuEhBriefing_(t.name)) return;
    var fones = telefones.map(function (c) { return cuValorNaTarefa_(t, c); }).filter(Boolean);
    var disc = null;
    for (var i = 0; i < respostas.length && !disc; i++) {
      if (usadas[respostas[i].id]) continue;
      for (var j = 0; j < fones.length; j++) {
        if (cuMesmoTelefone(fones[j], respostas[i].telefone)) {
          disc = cuDiscDaResposta_(respostas[i]);
          usadas[respostas[i].id] = true;
          break;
        }
      }
    }
    if (!disc) disc = cuDiscDaTarefa_(t, camposDisc);

    var idadeBruta = cuValorNaTarefa_(t, papeis.idade);
    var idade = typeof idadeBruta === 'number' ? Math.round(idadeBruta) : null;
    var idadeFaixa = (idadeBruta !== null && typeof idadeBruta !== 'number') ? String(idadeBruta) : null;
    if (idade === null && idadeFaixa && /^\s*\d{1,3}\s*$/.test(idadeFaixa)) { idade = Number(idadeFaixa); idadeFaixa = null; }

    var notas = {};
    var temNota = false;
    config.etapas.forEach(function (e) {
      notas[e.id] = cuNota_(cuValorNaTarefa_(t, camposEtapa[e.id]));
      if (notas[e.id] !== null) temNota = true;
    });
    var bonusValores = {};
    config.bonus.forEach(function (b) {
      var c = camposBonus[b.id];
      bonusValores[b.id] = c ? cuValorNaTarefa_(t, c) : null;
    });
    var status = (t.status && t.status.status) || '';
    var finalista = finalistasStatus.length
      ? finalistasStatus.indexOf(normalizarNomeCampo(status)) >= 0
      : (temNota || !!disc);
    var texto = function (c) { var v = cuValorNaTarefa_(t, c); return v === null || v === undefined ? null : String(v); };
    var cand = {
      id: String(t.id),
      nome: limparTexto(t.name, 120).replace(/\s*\(DISC\)\s*$/, ''),
      status: status,
      criadoEm: isFinite(Number(t.date_created)) && t.date_created ? new Date(Number(t.date_created)).toISOString() : '',
      idade: idade,
      idadeFaixa: idadeFaixa,
      statusTrabalho: texto(papeis.statusTrabalho),
      pretensao: cuNumero(cuValorNaTarefa_(t, papeis.pretensao)),
      ultimoSalario: cuNumero(cuValorNaTarefa_(t, papeis.ultimoSalario)),
      formacao: texto(papeis.formacao),
      notas: notas,
      bonusValores: bonusValores,
      disc: disc,
      finalista: finalista
    };
    if (antecedentes.length) {
      cand.antecedentes = antecedentes.map(function (c) { return cuValorNaTarefa_(t, c); })
        .filter(function (v) { return v !== null && v !== false; }).map(String).join('; ') || null;
    }
    candidatos.push(cand);
  });
  var sobra = respostas.filter(function (r) { return !usadas[r.id]; }).length;
  if (sobra) avisos.push(sobra + (sobra === 1 ? ' resposta' : ' respostas') + ' do DISC deste processo sem tarefa correspondente no ClickUp (WhatsApp diferente).');

  return {
    processo: {
      id: proc.id, nome: proc.nome, codigo: proc.codigo,
      empresa: proc.empresa || mapaEmpresas_()[proc.empresaId] || '',
      vaga: proc.vaga || '', cidade: proc.cidade || '', consultor: proc.consultor || '',
      contratante: proc.contratante || '',
      periodo: { inicio: proc.periodoInicio || '', fim: proc.periodoFim || '' },
      clickupListId: proc.clickupListId
    },
    config: config,
    status: (lista.statuses || []).map(function (s) { return { nome: s.status, tipo: s.type, cor: s.color }; }),
    candidatos: candidatos,
    avisos: avisos
  };
}

// ---------------------------------------------------------------------------
// Ações (chamadas pelo Code.gs; todas só admin)
// ---------------------------------------------------------------------------

function acaoClickupStatus_() {
  var props = PropertiesService.getScriptProperties();
  var r = { ok: true, configurado: cuConfigurado(), pastaConfigurada: !!props.getProperty('CLICKUP_PASTA_ID'),
    iaConfigurada: !!props.getProperty('ANTHROPIC_API_KEY'), avisos: cuAvisosRecentes_() };
  if (!r.configurado) return r;
  try {
    var u = cuGet_('/user').user || {};
    r.conectado = true;
    r.usuario = u.username || '';
  } catch (err) {
    r.conectado = false;
    r.erro = 'Não foi possível falar com o ClickUp: ' + err.message;
  }
  return r;
}

function acaoClickupListas_() {
  if (!cuConfigurado()) return erro_(MSG_CU_NAO_CONFIGURADO);
  try {
    return { ok: true, listas: cuListas_() };
  } catch (err) {
    return erro_('Não foi possível ler as listas do ClickUp: ' + err.message);
  }
}

/** Valida o processo para leitura no ClickUp. {ok, processo} ou erro. */
function cuProcessoPronto_(id) {
  var proc = processoPorId_(id);
  if (!proc) return erro_('Processo não encontrado.');
  if (!proc.clickupListId) return erro_('Este processo ainda não está ligado a uma lista do ClickUp.');
  if (!cuConfigurado()) return erro_(MSG_CU_NAO_CONFIGURADO);
  return { ok: true, processo: proc };
}

function acaoProcessoDados_(id) {
  var p = cuProcessoPronto_(id);
  if (!p.ok) return p;
  var dados;
  try { dados = cuMontarDadosProcesso(p.processo); } catch (err) { return erro_('Não foi possível ler o ClickUp: ' + err.message); }
  return { ok: true, processo: dados.processo, config: dados.config, status: dados.status, candidatos: dados.candidatos, avisos: dados.avisos };
}
