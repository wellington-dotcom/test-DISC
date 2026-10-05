/**
 * Relatorio.gs — relatórios do processo seletivo (rascunho, edição, publicação, IA opcional e gatilho
 * pelo ClickUp). Faz parte do mesmo projeto do Code.gs e do ClickUp.gs (nomes aqui começam com "rel").
 *
 * O texto do relatório é montado pelo MESMO motor do site: RelatorioMotor.gs (global DISC_RELATORIO),
 * gerado a partir de js/relatorio-motor.js por "npm run montar:apps-script".
 *
 * Aba "Relatorios": token, processoId, status (rascunho|publicado), parte, json, criadoEm, publicadoEm,
 * atualizadoEm. Cada célula aceita 50.000 caracteres: o JSON é dividido em partes de REL_TAMANHO_PARTE
 * (uma linha por parte, mesmo token). Cada parte começa com "#" para o Sheets nunca tratá-la como
 * fórmula, número ou texto com apóstrofo.
 *
 * Link público: relatorio.html?r=TOKEN (token aleatório de 64 caracteres). Só relatório publicado abre.
 * Propriedades do script usadas: SITE_URL (opcional, endereço do site), ANTHROPIC_API_KEY (opcional, IA).
 */

var REL_TAMANHO_PARTE = 45000;
var REL_MAX_JSON = 400000;
var REL_MAX_TEXTO = 4000;
var REL_MAX_TEXTOS_IA = 80;
var MSG_REL_NAO_ENCONTRADO = 'Relatório não encontrado ou fora do ar.';
var REL_IA_URL = 'https://api.anthropic.com/v1/messages';
var REL_IA_MODELO = 'claude-opus-5-5';
var REL_GATILHO = 'verificarBriefingsClickUp';

function relTokenValido_(t) { return typeof t === 'string' && /^[0-9a-f]{40,128}$/.test(t); }

function relNovoToken_() {
  return sha256Hex_(Utilities.getUuid() + Utilities.getUuid() + agora_() + Math.random());
}

function relAgoraIso_() { return new Date(agora_()).toISOString(); }

/** Lê o relatório do token: {tabela, linhas, meta, relatorio} ou null. */
function relLer_(token) {
  if (!relTokenValido_(token)) return null;
  var tabela = lerTabela_('Relatorios');
  var linhas = tabela.registros.filter(function (r) { return r.token === token; })
    .sort(function (a, b) { return a.parte - b.parte; });
  if (!linhas.length) return null;
  var json = linhas.map(function (l) { return String(l.json || '').replace(/^#/, ''); }).join('');
  var relatorio;
  try { relatorio = JSON.parse(json); } catch (err) { return null; }
  var p = linhas[0];
  return {
    tabela: tabela, linhas: linhas, relatorio: relatorio,
    meta: { token: token, processoId: p.processoId, status: p.status === 'publicado' ? 'publicado' : 'rascunho',
      criadoEm: p.criadoEm, publicadoEm: p.publicadoEm, atualizadoEm: p.atualizadoEm }
  };
}

/** Grava (ou regrava) o relatório nas linhas do token. Chamar dentro de comTrava_. */
function relGravar_(tabela, linhasAtuais, meta, relatorio) {
  var json = JSON.stringify(relatorio);
  if (json.length > REL_MAX_JSON) throw new Error('Relatório grande demais para guardar.');
  var partes = [];
  for (var i = 0; i < json.length; i += REL_TAMANHO_PARTE) partes.push(json.substring(i, i + REL_TAMANHO_PARTE));
  if (!partes.length) partes.push('');
  meta.atualizadoEm = relAgoraIso_();
  partes.forEach(function (parte, n) {
    var reg = linhasAtuais[n] || {};
    reg.token = meta.token;
    reg.processoId = meta.processoId;
    reg.status = meta.status;
    reg.parte = n;
    reg.json = '#' + parte;
    reg.criadoEm = meta.criadoEm;
    reg.publicadoEm = meta.publicadoEm || '';
    reg.atualizadoEm = meta.atualizadoEm;
    gravarRegistro_(tabela, reg);
  });
  // Partes que sobraram (relatório ficou menor): apaga de baixo para cima.
  linhasAtuais.slice(partes.length).map(function (r) { return r._linha; })
    .sort(function (a, b) { return b - a; })
    .forEach(function (linha) { tabela.aba.deleteRow(linha); });
}

/** Primeiro nome + inicial do último sobrenome ("Maria da Silva" -> "Maria S."). */
function relNomeCurto_(nome) {
  var partes = limparTexto(nome, 120).split(' ').filter(function (p) { return /\p{L}/u.test(p); });
  if (partes.length < 2) return partes[0] || '';
  return partes[0] + ' ' + partes[partes.length - 1].charAt(0).toUpperCase() + '.';
}

/**
 * Roda o motor com uma cópia dos dados SEM antecedentes e devolve o relatório. Garante, no fim, que
 * nenhum nome completo de candidato ficou no JSON (troca por "Nome S.") e tira o id da lista do ClickUp.
 */
function relMontar_(dados) {
  if (typeof DISC_RELATORIO === 'undefined' || !DISC_RELATORIO || typeof DISC_RELATORIO.montar !== 'function') {
    throw new Error('Falta o arquivo RelatorioMotor.gs no projeto do Apps Script (veja docs/BACKEND.md).');
  }
  var copia = JSON.parse(JSON.stringify(dados));
  (copia.candidatos || []).forEach(function (c) { delete c.antecedentes; });
  var relatorio = DISC_RELATORIO.montar(copia, { geradoEm: relAgoraIso_() });
  if (relatorio && relatorio.processo) delete relatorio.processo.clickupListId;
  var json = JSON.stringify(relatorio);
  (dados.candidatos || []).forEach(function (c) {
    var completo = limparTexto(c.nome, 120);
    var curto = relNomeCurto_(completo);
    if (completo && curto && completo !== curto && completo.indexOf(' ') > 0) {
      json = json.split(JSON.stringify(completo).slice(1, -1)).join(JSON.stringify(curto).slice(1, -1));
    }
  });
  return JSON.parse(json);
}

/** Lê o ClickUp, monta o relatório e grava como rascunho. {ok, relatorio, token, avisos} ou lança erro. */
function relGerarRascunho_(proc) {
  var dados = cuMontarDadosProcesso(proc);
  var relatorio = relMontar_(dados);
  var token = relNovoToken_();
  var r = comTrava_(function () {
    var tabela = lerTabela_('Relatorios');
    var agora = relAgoraIso_();
    relGravar_(tabela, [], { token: token, processoId: proc.id, status: 'rascunho', criadoEm: agora, publicadoEm: '' }, relatorio);
    return { ok: true };
  });
  if (!r.ok) return r;
  return { ok: true, relatorio: relatorio, token: token, avisos: dados.avisos || [] };
}

// ---------------------------------------------------------------------------
// Ações (todas só admin, menos relatorioPublico)
// ---------------------------------------------------------------------------

function acaoRelatorioRascunho_(processoId) {
  var p = cuProcessoPronto_(processoId);
  if (!p.ok) return p;
  try {
    return relGerarRascunho_(p.processo);
  } catch (err) {
    return erro_('Não foi possível gerar o rascunho: ' + err.message);
  }
}

/** Edição dos textos: aceita {relatorio:{textos}} ou {textos}; cada valor é texto ou {texto}. */
function acaoRelatorioSalvar_(corpo) {
  var token = corpo.relatorioToken;
  var novos = (corpo.relatorio && typeof corpo.relatorio === 'object' && corpo.relatorio.textos) || corpo.textos;
  if (!novos || typeof novos !== 'object' || Array.isArray(novos)) return erro_('Nada para salvar.');
  return comTrava_(function () {
    var r = relLer_(token);
    if (!r) return erro_('Relatório não encontrado.');
    var textos = r.relatorio.textos || {};
    var alterados = 0;
    Object.keys(novos).forEach(function (id) {
      if (!Object.prototype.hasOwnProperty.call(textos, id)) return;
      var v = novos[id];
      var texto = typeof v === 'string' ? v : (v && typeof v.texto === 'string' ? v.texto : null);
      if (texto === null) return;
      texto = limparTextoLongo(texto, REL_MAX_TEXTO);
      if (texto === textos[id].texto) return;
      textos[id] = { texto: texto, origem: 'editado' };
      alterados++;
    });
    if (alterados) relGravar_(r.tabela, r.linhas, r.meta, r.relatorio);
    return { ok: true, relatorio: r.relatorio, alterados: alterados };
  });
}

/** Endereço do site: baseUrl do painel (https) ou a propriedade SITE_URL. '' se nenhum. */
function relBaseSite_(baseUrl) {
  var b = typeof baseUrl === 'string' ? baseUrl.trim() : '';
  if (!/^https:\/\/[^\s"'<>]+$/.test(b)) b = PropertiesService.getScriptProperties().getProperty('SITE_URL') || '';
  b = String(b).trim().split('#')[0].split('?')[0];
  if (!/^https?:\/\/[^\s"'<>]+$/.test(b)) return '';
  if (b.charAt(b.length - 1) !== '/') b = b.substring(0, b.lastIndexOf('/') + 1); // tira "admin.html"
  return b;
}

/** Comenta o link na tarefa "📌 Briefing…" da lista (ou na própria lista). Lança erro se falhar. */
function relComentarNoClickUp_(proc, texto) {
  var tarefas = cuTarefasDaLista_(proc.clickupListId);
  var briefing = tarefas.filter(function (t) { return cuEhBriefing_(t.name); })[0];
  if (briefing) cuPost_('/task/' + cuId_(briefing.id) + '/comment', { comment_text: texto, notify_all: false });
  else cuPost_('/list/' + cuId_(proc.clickupListId) + '/comment', { comment_text: texto, notify_all: false });
  return briefing ? 'tarefa' : 'lista';
}

function acaoRelatorioPublicar_(token, baseUrl) {
  var base = relBaseSite_(baseUrl);
  var r = comTrava_(function () {
    var lido = relLer_(token);
    if (!lido) return erro_('Relatório não encontrado.');
    lido.meta.status = 'publicado';
    lido.meta.publicadoEm = lido.meta.publicadoEm || relAgoraIso_();
    relGravar_(lido.tabela, lido.linhas, lido.meta, lido.relatorio);
    return { ok: true, processoId: lido.meta.processoId };
  });
  if (!r.ok) return r;
  var url = base + 'relatorio.html?r=' + token;
  var resposta = { ok: true, url: url };
  var proc = processoPorId_(r.processoId);
  if (!proc || !proc.clickupListId || !cuConfigurado()) return resposta;
  if (!base) {
    resposta.aviso = 'Link não comentado no ClickUp: defina SITE_URL nas Propriedades do script (endereço do site).';
    return resposta;
  }
  try {
    resposta.comentadoEm = relComentarNoClickUp_(proc, 'Relatório publicado: ' + url);
  } catch (err) {
    resposta.aviso = 'Relatório publicado, mas não deu para comentar o link no ClickUp (' + err.message + ').';
    cuRegistrarAviso_(resposta.aviso);
  }
  return resposta;
}

function acaoRelatorioDespublicar_(token) {
  return comTrava_(function () {
    var lido = relLer_(token);
    if (!lido) return erro_('Relatório não encontrado.');
    lido.meta.status = 'rascunho';
    lido.meta.publicadoEm = '';
    relGravar_(lido.tabela, lido.linhas, lido.meta, lido.relatorio);
    return { ok: true };
  });
}

function acaoRelatoriosListar_(processoId) {
  var filtro = limparTexto(processoId, 40);
  var porToken = {};
  lerTabela_('Relatorios').registros.forEach(function (l) {
    if (filtro && l.processoId !== filtro) return;
    if (!porToken[l.token] || l.parte < porToken[l.token].parte) porToken[l.token] = l;
  });
  var lista = Object.keys(porToken).map(function (t) {
    var l = porToken[t];
    return { token: t, processoId: l.processoId, status: l.status === 'publicado' ? 'publicado' : 'rascunho',
      criadoEm: l.criadoEm, publicadoEm: l.publicadoEm, atualizadoEm: l.atualizadoEm };
  }).sort(function (a, b) { return String(b.criadoEm).localeCompare(String(a.criadoEm)); });
  return { ok: true, relatorios: lista };
}

/** PÚBLICA: devolve o relatório só se estiver publicado. */
function acaoRelatorioPublico_(token) {
  var lido = relTokenValido_(token) ? relLer_(token) : null;
  if (!lido || lido.meta.status !== 'publicado') return erro_(MSG_REL_NAO_ENCONTRADO);
  var relatorio = lido.relatorio;
  if (relatorio && relatorio.processo) delete relatorio.processo.clickupListId;
  return { ok: true, relatorio: relatorio, publicadoEm: lido.meta.publicadoEm };
}

// ---------------------------------------------------------------------------
// IA (opcional): reescreve textos com a API da Anthropic (Messages API)
// ---------------------------------------------------------------------------

var REL_IA_SISTEMA = [
  'Você revisa textos de um relatório de processo seletivo escrito por uma consultoria de RH (Notus Agência)',
  'para a empresa contratante. Reescreva cada texto em português do Brasil simples, com tom de consultor,',
  'frases curtas e sem jargão técnico. Regras: mantenha exatamente os mesmos fatos, números, notas, nomes e',
  'conclusões; não invente nada; não acrescente recomendações novas; nunca mencione idade, sexo, estado civil,',
  'filhos, saúde, religião, etnia ou qualquer outro dado pessoal sensível. Devolva todos os ids recebidos.'
].join(' ');

/** Chama a Messages API e devolve {id: texto}. Lança Error em pt-BR se algo der errado. */
function relChamarIa_(chave, itens) {
  var corpo = {
    model: REL_IA_MODELO,
    max_tokens: 16000,
    fallbacks: 'default', // se o modelo recusar, a própria API tenta o modelo reserva recomendado
    output_config: {
      effort: 'low',
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            textos: {
              type: 'array',
              items: {
                type: 'object',
                properties: { id: { type: 'string' }, texto: { type: 'string' } },
                required: ['id', 'texto'],
                additionalProperties: false
              }
            }
          },
          required: ['textos'],
          additionalProperties: false
        }
      }
    },
    system: REL_IA_SISTEMA,
    messages: [{ role: 'user', content: 'Reescreva estes textos (JSON com id e texto):\n' + JSON.stringify(itens) }]
  };
  var resp = UrlFetchApp.fetch(REL_IA_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': chave,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'server-side-fallback-2026-07-01'
    },
    payload: JSON.stringify(corpo),
    muteHttpExceptions: true
  });
  var codigo = resp.getResponseCode();
  var dados;
  try { dados = JSON.parse(resp.getContentText() || '{}'); } catch (err) { dados = {}; }
  if (codigo !== 200) {
    var tipo = dados && dados.error && dados.error.type ? ' (' + dados.error.type + ')' : '';
    throw new Error('a IA respondeu ' + codigo + tipo + '.');
  }
  if (dados.stop_reason === 'refusal') throw new Error('a IA não quis reescrever estes textos.');
  if (dados.stop_reason === 'max_tokens') throw new Error('a resposta da IA ficou longa demais; escolha menos textos.');
  var texto = (dados.content || []).filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('');
  var saida;
  try { saida = JSON.parse(texto); } catch (err) { throw new Error('a IA devolveu um formato inesperado.'); }
  var mapa = {};
  (saida && Array.isArray(saida.textos) ? saida.textos : []).forEach(function (t) {
    if (t && typeof t.id === 'string' && typeof t.texto === 'string' && t.texto.trim()) mapa[t.id] = t.texto;
  });
  return mapa;
}

function acaoRelatorioMelhorarTextos_(token, ids) {
  var chave = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!chave) return erro_('IA não configurada.');
  var lido = relLer_(token);
  if (!lido) return erro_('Relatório não encontrado.');
  var textos = lido.relatorio.textos || {};
  var escolhidos = Array.isArray(ids) && ids.length
    ? ids.filter(function (id) { return typeof id === 'string' && Object.prototype.hasOwnProperty.call(textos, id); })
    : Object.keys(textos).filter(function (id) { return textos[id] && textos[id].origem === 'regra'; });
  escolhidos = escolhidos.slice(0, REL_MAX_TEXTOS_IA);
  if (!escolhidos.length) return erro_('Nenhum texto para melhorar.');
  var mapa;
  try {
    mapa = relChamarIa_(chave, escolhidos.map(function (id) { return { id: id, texto: textos[id].texto }; }));
  } catch (err) {
    return erro_('Não foi possível melhorar os textos: ' + err.message);
  }
  return comTrava_(function () {
    var atual = relLer_(token); // relê: alguém pode ter editado enquanto a IA trabalhava
    if (!atual) return erro_('Relatório não encontrado.');
    var alterados = 0;
    escolhidos.forEach(function (id) {
      if (!mapa[id] || !atual.relatorio.textos[id]) return;
      atual.relatorio.textos[id] = { texto: limparTextoLongo(mapa[id], REL_MAX_TEXTO), origem: 'ia' };
      alterados++;
    });
    if (alterados) relGravar_(atual.tabela, atual.linhas, atual.meta, atual.relatorio);
    return { ok: true, relatorio: atual.relatorio, alterados: alterados };
  });
}

// ---------------------------------------------------------------------------
// Gatilho pelo ClickUp (opcional): tarefa "📌 Briefing…" no status "gerar relatório"
// ---------------------------------------------------------------------------

/** Execute uma vez no editor: cria o gatilho de 10 em 10 minutos (substitui um anterior). */
function instalarGatilho() {
  removerGatilho();
  ScriptApp.newTrigger(REL_GATILHO).timeBased().everyMinutes(10).create();
  Logger.log('Gatilho instalado: a cada 10 minutos o sistema confere as tarefas "📌 Briefing" no status "gerar relatório".');
}

/** Remove o gatilho criado por instalarGatilho(). */
function removerGatilho() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === REL_GATILHO) ScriptApp.deleteTrigger(t);
  });
}

/**
 * Chamada pelo gatilho. Para cada processo ativo ligado ao ClickUp: se a tarefa "📌 Briefing…" estiver
 * no status "gerar relatório", gera o rascunho, comenta "Rascunho pronto para revisão no painel" e muda
 * a tarefa para "relatório em revisão" (se esse status existir na lista). Devolve um resumo.
 */
function verificarBriefingsClickUp() {
  var resumo = { verificados: 0, gerados: [], erros: [] };
  if (!cuConfigurado()) return resumo;
  lerTabela_('Avaliacoes').registros.forEach(function (proc) {
    if (!proc.clickupListId || !proc.ativa) return;
    cuReiniciar_();
    resumo.verificados++;
    try {
      var briefing = cuTarefasDaLista_(proc.clickupListId).filter(function (t) {
        return cuEhBriefing_(t.name) && normalizarNomeCampo(t.status && t.status.status) === 'gerar relatorio';
      })[0];
      if (!briefing) return;
      var r = relGerarRascunho_(proc);
      if (!r.ok) throw new Error(r.erro);
      cuPost_('/task/' + cuId_(briefing.id) + '/comment', { comment_text: 'Rascunho pronto para revisão no painel', notify_all: false });
      var revisao = (cuLista_(proc.clickupListId).statuses || []).filter(function (s) {
        return normalizarNomeCampo(s.status) === 'relatorio em revisao';
      })[0];
      if (revisao) cuPut_('/task/' + cuId_(briefing.id), { status: revisao.status });
      resumo.gerados.push({ processoId: proc.id, token: r.token });
    } catch (err) {
      var msg = 'Gatilho do processo "' + proc.nome + '": ' + err.message;
      resumo.erros.push(msg);
      cuRegistrarAviso_(msg);
    }
  });
  Logger.log('Briefings verificados: ' + resumo.verificados + '; rascunhos gerados: ' + resumo.gerados.length + '.');
  return resumo;
}
