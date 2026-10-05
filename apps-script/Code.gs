/**
 * Backend do Teste DISC — Google Apps Script vinculado a uma Google Planilha.
 *
 * Como usar (resumo — o passo a passo completo está em docs/BACKEND.md):
 *   1. Na planilha: Extensões > Apps Script, cole este arquivo como Code.gs.
 *   2. Execute a função setup() uma vez e copie a chave de administrador do registro de execução.
 *   3. Implantar > Nova implantação > App da Web (Executar como: Eu; Quem pode acessar: Qualquer pessoa).
 *   4. Cole a URL (termina em /exec) em js/config.js -> API_URL.
 *
 * API (POST, corpo JSON em text/plain):
 *   {"acao":"enviar","payload":{...}}                         público (candidato)
 *   {"acao":"listar","chave":"..."}                           admin
 *   {"acao":"atualizar","chave":"...","id":"...","campos":{"status":"...","observacoes":"..."}}
 *   {"acao":"excluir","chave":"...","id":"..."}
 *   {"acao":"excluirTodos","chave":"..."}
 * GET -> {"ok":true,"servico":"DISC"} (teste de saúde).
 *
 * O resultado DISC é SEMPRE recalculado aqui a partir de "respostas" (o campo "resultado"
 * enviado pelo navegador é ignorado).
 *
 * Código do candidato (protocolo): ao gravar um envio, o servidor gera um código curto e único
 * (2 algarismos + 1 letra maiúscula sem I e O, ex.: "47K") e devolve {ok, id, protocolo}.
 * O candidato informa esse código ao recrutador, que o encontra pela busca do painel.
 */

var NOME_ABA = 'Respostas';
var CABECALHO = ['id', 'recebidoEm', 'nome', 'telefone', 'vaga', 'inicio', 'fim', 'duracaoSeg',
  'respostas', 'D', 'I', 'S', 'C', 'perfil', 'status', 'observacoes', 'payloadJson', 'protocolo'];
var COL = {}; // nome da coluna -> índice (0-based)
CABECALHO.forEach(function (nome, i) { COL[nome] = i; });

var LETRAS = ['D', 'I', 'S', 'C'];
var TOTAL_GRUPOS = 25;
var LIMITE_CORPO = 20000;      // bytes/caracteres aceitos no corpo da requisição
var LIMITE_LINHAS = 500;       // proteção contra abuso (o uso esperado é de poucas dezenas)
var LIMITE_ENVIOS_JANELA = 40; // envios aceitos por janela de tempo (todos os candidatos juntos)
var JANELA_ENVIOS_SEG = 600;   // janela de 10 minutos
var STATUS_VALIDOS = ['em_analise', 'aprovado', 'reprovado'];
var STATUS_PADRAO = 'em_analise';
var COLUNAS_TEXTO = ['id', 'recebidoEm', 'nome', 'telefone', 'vaga', 'inicio', 'fim',
  'respostas', 'perfil', 'status', 'observacoes', 'payloadJson', 'protocolo'];

// Protocolo: 2 algarismos + 1 letra (sem I e O, que se confundem com 1 e 0) -> 100 × 24 = 2.400 códigos.
var LETRAS_PROTOCOLO = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
var TOTAL_PROTOCOLOS = 100 * LETRAS_PROTOCOLO.length;
var TENTATIVAS_SORTEIO = 40;

// ---------------------------------------------------------------------------
// Pontos de entrada do Web App
// ---------------------------------------------------------------------------

function doGet() {
  return responder_({ ok: true, servico: 'DISC' });
}

function doPost(e) {
  var resposta;
  try {
    resposta = processarRequisicao_(e && e.postData ? e.postData.contents : '');
  } catch (err) {
    console.error(err);
    resposta = { ok: false, erro: 'Erro interno no servidor. Tente novamente em instantes.' };
  }
  return responder_(resposta);
}

function responder_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Lê o corpo bruto, valida e despacha para a ação. Retorna sempre um objeto {ok, ...}. */
function processarRequisicao_(conteudo) {
  conteudo = typeof conteudo === 'string' ? conteudo : '';
  if (!conteudo) return erro_('Requisição vazia.');
  if (conteudo.length > LIMITE_CORPO) return erro_('Requisição grande demais.');

  var corpo;
  try { corpo = JSON.parse(conteudo); } catch (err) { return erro_('JSON inválido.'); }
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) return erro_('Formato de requisição inválido.');

  var acao = corpo.acao;
  if (acao === 'enviar') return acaoEnviar_(corpo.payload);

  if (acao === 'listar' || acao === 'atualizar' || acao === 'excluir' || acao === 'excluirTodos') {
    var auth = verificarChave_(corpo.chave);
    if (!auth.ok) return auth;
    if (acao === 'listar') return acaoListar_();
    if (acao === 'atualizar') return acaoAtualizar_(corpo.id, corpo.campos);
    if (acao === 'excluir') return acaoExcluir_(corpo.id);
    return acaoExcluirTodos_();
  }
  return erro_('Ação desconhecida.');
}

function erro_(mensagem, extra) {
  var r = { ok: false, erro: mensagem };
  if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) r[k] = extra[k];
  return r;
}

// ---------------------------------------------------------------------------
// Autenticação do administrador
// ---------------------------------------------------------------------------

function verificarChave_(chave) {
  var esperada = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY');
  if (!esperada) {
    return erro_('A chave de administrador ainda não foi configurada. No editor do Apps Script, ' +
      'selecione a função "setup" e clique em Executar; depois copie a chave exibida no registro de execução.');
  }
  if (typeof chave !== 'string' || !chave || chave.trim() !== esperada) {
    Utilities.sleep(400); // dificulta tentativas em massa
    return erro_('Chave de administrador inválida.', { naoAutorizado: true });
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Regras de negócio puras (sem serviços do Google) — testáveis no Node
// ---------------------------------------------------------------------------

/** Mesma regra de js/scoring.js: 100 dígitos, cada bloco de 4 é permutação de 1..4. */
function validarRespostasCompactas(str) {
  if (typeof str !== 'string' || !/^[1-4]{100}$/.test(str)) return false;
  for (var i = 0; i < TOTAL_GRUPOS; i++) {
    var bloco = str.substr(i * 4, 4);
    var vistos = {};
    for (var j = 0; j < 4; j++) {
      if (vistos[bloco[j]]) return false;
      vistos[bloco[j]] = true;
    }
  }
  return true;
}

/** Recalcula totais, percentuais (total/2.5) e perfil (maior + segundo maior; empate na ordem D,I,S,C). */
function calcularDisc(str) {
  if (!validarRespostasCompactas(str)) throw new Error('Respostas inválidas.');
  var totais = { D: 0, I: 0, S: 0, C: 0 };
  for (var i = 0; i < TOTAL_GRUPOS; i++) {
    for (var j = 0; j < 4; j++) totais[LETRAS[j]] += Number(str[i * 4 + j]);
  }
  var percentuais = {};
  LETRAS.forEach(function (l) { percentuais[l] = Math.round((totais[l] / 2.5) * 10) / 10; });
  var ordem = LETRAS.slice().sort(function (a, b) {
    return (totais[b] - totais[a]) || (LETRAS.indexOf(a) - LETRAS.indexOf(b));
  });
  return {
    totais: totais,
    percentuais: percentuais,
    ordem: ordem,
    primario: ordem[0],
    secundario: ordem[1],
    codigo: ordem[0] + ordem[1]
  };
}

/** Remove caracteres de controle, junta espaços repetidos, apara e corta no limite. */
function limparTexto(v, max) {
  if (v === null || v === undefined) return '';
  var s = String(v).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
  if (max && s.length > max) s = s.substring(0, max).trim();
  return s;
}

/** Texto multilinha (observações): mantém quebras de linha, remove outros controles. */
function limparTextoLongo(v, max) {
  if (v === null || v === undefined) return '';
  var s = String(v).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, ' ').trim();
  if (max && s.length > max) s = s.substring(0, max).trim();
  return s;
}

/** Evita injeção de fórmula na planilha: valores começando com = + - @ recebem apóstrofo. */
function protegerCelula(v) {
  if (typeof v !== 'string') return v;
  return /^[=+\-@\t\r]/.test(v) ? "'" + v : v;
}

/** Telefone: só dígitos; 10/11 (DDD + número) -> prefixa 55; 12/13 começando com 55 é aceito. */
function normalizarTelefone(v) {
  var d = String(v === null || v === undefined ? '' : v).replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) return '55' + d;
  if ((d.length === 12 || d.length === 13) && d.indexOf('55') === 0) return d;
  return '';
}

function nomeValido(nome) {
  // Mesmo critério do app (js/app.js): qualquer letra Unicode conta.
  var palavras = nome.split(' ').filter(function (p) { return /\p{L}/u.test(p); });
  var letras = (nome.match(/\p{L}/gu) || []).length;
  return palavras.length >= 2 && letras >= 5;
}

function dataIsoOuVazio(v) {
  var s = limparTexto(v, 40);
  if (!s) return '';
  var t = Date.parse(s);
  return isNaN(t) ? '' : new Date(t).toISOString();
}

/**
 * Valida e normaliza o payload do candidato.
 * Retorna { ok:true, payload } (payload limpo, com resultado recalculado) ou { ok:false, erro }.
 */
function validarPayload(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return erro_('Dados do teste ausentes.');

  var id = limparTexto(p.id, 80);
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(id)) return erro_('Identificador do envio inválido.');

  var nome = limparTexto(p.nome, 120);
  if (!nomeValido(nome)) return erro_('Informe o nome completo (nome e sobrenome).');

  var telefone = normalizarTelefone(p.telefone);
  if (!telefone) return erro_('Telefone inválido. Informe DDD + número.');

  if (p.consentimento !== true) return erro_('É necessário aceitar o uso dos dados para participar.');

  var respostas = typeof p.respostas === 'string' ? p.respostas.trim() : '';
  if (!validarRespostasCompactas(respostas)) return erro_('Respostas do teste inválidas ou incompletas.');

  var resultado = calcularDisc(respostas);
  var inicio = dataIsoOuVazio(p.inicio);
  var fim = dataIsoOuVazio(p.fim);
  var duracao = Number(p.duracaoSeg);
  if (!isFinite(duracao) || duracao < 0 || duracao > 7 * 86400) {
    duracao = (inicio && fim) ? Math.max(0, Math.round((Date.parse(fim) - Date.parse(inicio)) / 1000)) : 0;
  }

  return {
    ok: true,
    payload: {
      v: 1,
      id: id,
      nome: nome,
      telefone: telefone,
      vaga: limparTexto(p.vaga, 120),
      consentimento: true,
      inicio: inicio,
      fim: fim,
      duracaoSeg: Math.round(duracao),
      respostas: respostas,
      resultado: { percentuais: resultado.percentuais, codigo: resultado.codigo }
    }
  };
}

/** Protocolo no formato do contrato: 2 algarismos + 1 letra maiúscula sem I/O (ex.: "47K"). */
function protocoloValido(v) {
  return typeof v === 'string' && /^[0-9]{2}[A-HJ-NP-Z]$/.test(v);
}

/** Normaliza o que veio da planilha ou foi digitado: tira apóstrofo e espaços, deixa maiúsculo. '' se inválido. */
function normalizarProtocolo(v) {
  if (v === null || v === undefined) return '';
  var s = String(v).replace(/^'/, '').replace(/\s+/g, '').toUpperCase();
  return protocoloValido(s) ? s : '';
}

/** Protocolo de índice n (0..TOTAL_PROTOCOLOS-1): "00A", "00B", … "99Z". */
function protocoloPorIndice_(n) {
  var numero = Math.floor(n / LETRAS_PROTOCOLO.length);
  return (numero < 10 ? '0' : '') + numero + LETRAS_PROTOCOLO.charAt(n % LETRAS_PROTOCOLO.length);
}

/**
 * Sorteia um protocolo que não está em "usados" (lista ou mapa {codigo:true}).
 * Tenta alguns sorteios; se a planilha estiver quase cheia, sorteia entre os códigos livres
 * (assim sempre acha o último livre). Sem nenhum livre, lança erro em pt-BR.
 * "aleatorio" é opcional (função 0..1, como Math.random) para testes.
 */
function gerarProtocolo(usados, aleatorio) {
  var rnd = typeof aleatorio === 'function' ? aleatorio : Math.random;
  var mapa = {};
  if (Array.isArray(usados)) usados.forEach(function (u) { var p = normalizarProtocolo(u); if (p) mapa[p] = true; });
  else if (usados) for (var k in usados) if (Object.prototype.hasOwnProperty.call(usados, k) && usados[k]) mapa[k] = true;

  function sorteio(max) { return Math.min(max - 1, Math.floor(rnd() * max)); }
  for (var t = 0; t < TENTATIVAS_SORTEIO; t++) {
    var p = protocoloPorIndice_(sorteio(TOTAL_PROTOCOLOS));
    if (!mapa[p]) return p;
  }
  var livres = [];
  for (var i = 0; i < TOTAL_PROTOCOLOS; i++) {
    var c = protocoloPorIndice_(i);
    if (!mapa[c]) livres.push(c);
  }
  if (!livres.length) {
    throw new Error('Limite de códigos atingido: todos os ' + TOTAL_PROTOCOLOS + ' códigos estão em uso. ' +
      'Exclua candidatos antigos ou de teste no painel e tente de novo.');
  }
  return livres[sorteio(livres.length)];
}

/** Monta a linha da planilha (na ordem de CABECALHO), já protegida contra fórmulas. */
function montarLinha(payload, recebidoEm, protocolo) {
  var r = calcularDisc(payload.respostas);
  var linha = [];
  linha[COL.id] = payload.id;
  linha[COL.recebidoEm] = recebidoEm;
  linha[COL.nome] = payload.nome;
  linha[COL.telefone] = payload.telefone;
  linha[COL.vaga] = payload.vaga;
  linha[COL.inicio] = payload.inicio;
  linha[COL.fim] = payload.fim;
  linha[COL.duracaoSeg] = payload.duracaoSeg;
  linha[COL.respostas] = payload.respostas;
  linha[COL.D] = r.percentuais.D;
  linha[COL.I] = r.percentuais.I;
  linha[COL.S] = r.percentuais.S;
  linha[COL.C] = r.percentuais.C;
  linha[COL.perfil] = r.codigo;
  linha[COL.status] = STATUS_PADRAO;
  linha[COL.observacoes] = '';
  linha[COL.payloadJson] = JSON.stringify(payload);
  linha[COL.protocolo] = normalizarProtocolo(protocolo);
  return linha.map(function (v, i) {
    return COLUNAS_TEXTO.indexOf(CABECALHO[i]) >= 0 ? forcarTexto(v) : protegerCelula(v);
  });
}

/**
 * Para colunas de texto: além da proteção contra fórmulas, valores que começam com dígito
 * (telefone, respostas, datas ISO) recebem apóstrofo para o Sheets não convertê-los em número/data.
 */
function forcarTexto(v) {
  if (typeof v !== 'string') return v;
  return /^[=+\-@\t\r0-9]/.test(v) ? "'" + v : v;
}

/** Converte uma linha lida da planilha no item retornado por "listar". */
function linhaParaItem(linha) {
  function txt(nome) {
    var v = linha[COL[nome]];
    if (v instanceof Date) return v.toISOString();
    v = v === null || v === undefined ? '' : String(v);
    return v.charAt(0) === "'" ? v.substring(1) : v;
  }
  var base = {};
  try { base = JSON.parse(txt('payloadJson')) || {}; } catch (err) { base = {}; }

  var respostas = txt('respostas').replace(/\D/g, '');
  var item = {
    v: 1,
    id: txt('id'),
    nome: txt('nome'),
    telefone: txt('telefone').replace(/\D/g, ''),
    vaga: txt('vaga'),
    consentimento: base.consentimento === true,
    inicio: txt('inicio'),
    fim: txt('fim'),
    duracaoSeg: Number(linha[COL.duracaoSeg]) || 0,
    respostas: respostas,
    resultado: null,
    status: STATUS_VALIDOS.indexOf(txt('status')) >= 0 ? txt('status') : STATUS_PADRAO,
    observacoes: txt('observacoes'),
    recebidoEm: txt('recebidoEm'),
    protocolo: normalizarProtocolo(txt('protocolo'))
  };
  if (validarRespostasCompactas(respostas)) {
    var r = calcularDisc(respostas);
    item.resultado = { percentuais: r.percentuais, codigo: r.codigo };
  }
  return item;
}

// ---------------------------------------------------------------------------
// Acesso à planilha
// ---------------------------------------------------------------------------

function obterAba_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Script não está vinculado a uma planilha.');
  var aba = ss.getSheetByName(NOME_ABA);
  if (!aba) {
    aba = ss.insertSheet(NOME_ABA);
    prepararAba_(aba);
  } else if (aba.getLastRow() === 0) {
    prepararAba_(aba);
  } else {
    garantirColunas_(aba);
  }
  return aba;
}

/**
 * Planilhas criadas antes de uma coluna existir (ex.: "protocolo"): escreve o nome que falta no
 * cabeçalho e deixa a coluna em formato texto. As linhas antigas ficam com a célula vazia.
 */
function garantirColunas_(aba) {
  garantirLargura_(aba);
  var cab = aba.getRange(1, 1, 1, CABECALHO.length).getValues()[0];
  CABECALHO.forEach(function (nome, i) {
    var atual = String(cab[i] === undefined || cab[i] === null ? '' : cab[i]).trim();
    if (atual === nome) return;
    if (atual !== '') {
      throw new Error('Cabeçalho da aba "' + NOME_ABA + '" diferente do esperado na coluna ' + (i + 1) +
        ' ("' + cab[i] + '" em vez de "' + nome + '").');
    }
    aba.getRange(1, i + 1).setValue(nome).setFontWeight('bold');
    if (COLUNAS_TEXTO.indexOf(nome) >= 0) aba.getRange(1, i + 1, aba.getMaxRows(), 1).setNumberFormat('@');
  });
}

/** Garante que a aba tem colunas físicas suficientes (getRange fora da aba lança erro no Apps Script). */
function garantirLargura_(aba) {
  var max = aba.getMaxColumns();
  if (max < CABECALHO.length) aba.insertColumnsAfter(max, CABECALHO.length - max);
}

/** Protocolos já gravados na planilha, como mapa {codigo: true}. */
function protocolosUsados_(aba) {
  var usados = {};
  var ultima = aba.getLastRow();
  if (ultima < 2) return usados;
  var valores = aba.getRange(2, COL.protocolo + 1, ultima - 1, 1).getValues();
  for (var i = 0; i < valores.length; i++) {
    var p = normalizarProtocolo(valores[i][0]);
    if (p) usados[p] = true;
  }
  return usados;
}

function prepararAba_(aba) {
  garantirLargura_(aba);
  aba.getRange(1, 1, 1, CABECALHO.length).setValues([CABECALHO]).setFontWeight('bold');
  aba.setFrozenRows(1);
  // Colunas de texto em formato "texto simples" para o Sheets não converter telefone,
  // respostas (100 dígitos) e datas ISO em número/data.
  COLUNAS_TEXTO.forEach(function (nome) {
    aba.getRange(1, COL[nome] + 1, aba.getMaxRows(), 1).setNumberFormat('@');
  });
}

/** Índice da linha (1-based na planilha) do id, ou -1. */
function localizarLinha_(aba, id) {
  var ultima = aba.getLastRow();
  if (ultima < 2) return -1;
  var ids = aba.getRange(2, COL.id + 1, ultima - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === id) return i + 2;
  }
  return -1;
}

/**
 * Limitador global de envios (CacheService): impede que alguém encha a planilha com
 * envios falsos em sequência. Retorna true se o envio pode seguir.
 * Deve ser chamado dentro de comTrava_ para o contador não perder incrementos.
 */
function permitirEnvio_() {
  if (typeof CacheService === 'undefined') return true;
  var cache = CacheService.getScriptCache();
  var janela = Math.floor(Date.now() / (JANELA_ENVIOS_SEG * 1000));
  var chave = 'envios_' + janela;
  var atual = Number(cache.get(chave)) || 0;
  if (atual >= LIMITE_ENVIOS_JANELA) return false;
  cache.put(chave, String(atual + 1), JANELA_ENVIOS_SEG + 60);
  return true;
}

function comTrava_(fn) {
  var trava = LockService.getScriptLock();
  if (!trava.tryLock(15000)) return erro_('Servidor ocupado. Tente novamente em alguns segundos.');
  try { return fn(); } finally { trava.releaseLock(); }
}

// ---------------------------------------------------------------------------
// Ações
// ---------------------------------------------------------------------------

function acaoEnviar_(payloadBruto) {
  var v = validarPayload(payloadBruto);
  if (!v.ok) return v;
  var payload = v.payload;

  return comTrava_(function () {
    var aba = obterAba_();
    var existente = localizarLinha_(aba, payload.id);
    if (existente !== -1) {
      // Reenvio (ex.: o candidato tocou de novo em Enviar): devolve o mesmo código já gravado.
      var celula = aba.getRange(existente, COL.protocolo + 1);
      var gravado = normalizarProtocolo(celula.getValues()[0][0]);
      if (!gravado) {
        // Linha de antes do protocolo existir: ganha um código agora.
        try { gravado = gerarProtocolo(protocolosUsados_(aba)); } catch (err) { return erro_(err.message); }
        celula.setValue(forcarTexto(gravado));
      }
      return { ok: true, duplicado: true, id: payload.id, protocolo: gravado };
    }
    if (aba.getLastRow() - 1 >= LIMITE_LINHAS) {
      return erro_('Limite de respostas atingido. Avise o recrutador.');
    }
    var protocolo;
    try { protocolo = gerarProtocolo(protocolosUsados_(aba)); } catch (err) { return erro_(err.message); }
    if (!permitirEnvio_()) {
      return erro_('Muitos envios em pouco tempo. Aguarde alguns minutos e tente novamente.');
    }
    aba.appendRow(montarLinha(payload, new Date().toISOString(), protocolo));
    return { ok: true, id: payload.id, protocolo: protocolo };
  });
}

function acaoListar_() {
  var aba = obterAba_();
  var ultima = aba.getLastRow();
  if (ultima < 2) return { ok: true, itens: [] };
  var linhas = aba.getRange(2, 1, ultima - 1, CABECALHO.length).getValues();
  var itens = [];
  linhas.forEach(function (linha) {
    if (String(linha[COL.id] || '').trim()) itens.push(linhaParaItem(linha));
  });
  return { ok: true, itens: itens };
}

function acaoAtualizar_(idBruto, campos) {
  var id = limparTexto(idBruto, 80);
  if (!id) return erro_('Informe o id do candidato.');
  if (!campos || typeof campos !== 'object') return erro_('Nada para atualizar.');

  var novoStatus = null, novasObs = null;
  if (campos.status !== undefined) {
    novoStatus = limparTexto(campos.status, 20);
    if (STATUS_VALIDOS.indexOf(novoStatus) === -1) return erro_('Status inválido. Use: aprovado, reprovado ou em_analise.');
  }
  if (campos.observacoes !== undefined) novasObs = limparTextoLongo(campos.observacoes, 5000);
  if (novoStatus === null && novasObs === null) return erro_('Nada para atualizar.');

  return comTrava_(function () {
    var aba = obterAba_();
    var linha = localizarLinha_(aba, id);
    if (linha === -1) return erro_('Candidato não encontrado.');
    if (novoStatus !== null) aba.getRange(linha, COL.status + 1).setValue(novoStatus);
    if (novasObs !== null) aba.getRange(linha, COL.observacoes + 1).setValue(protegerCelula(novasObs));
    return { ok: true, id: id };
  });
}

function acaoExcluir_(idBruto) {
  var id = limparTexto(idBruto, 80);
  if (!id) return erro_('Informe o id do candidato.');
  return comTrava_(function () {
    var aba = obterAba_();
    var linha = localizarLinha_(aba, id);
    if (linha === -1) return erro_('Candidato não encontrado.');
    aba.deleteRow(linha);
    return { ok: true, id: id };
  });
}

function acaoExcluirTodos_() {
  return comTrava_(function () {
    var aba = obterAba_();
    var ultima = aba.getLastRow();
    var total = Math.max(0, ultima - 1);
    if (total > 0) aba.deleteRows(2, total);
    return { ok: true, excluidos: total };
  });
}

// ---------------------------------------------------------------------------
// Funções para executar manualmente no editor do Apps Script
// ---------------------------------------------------------------------------

/** Cria a aba "Respostas" e gera a chave de administrador (se ainda não existir). */
function setup() {
  obterAba_();
  var props = PropertiesService.getScriptProperties();
  var chave = props.getProperty('ADMIN_KEY');
  if (!chave) {
    chave = gerarChave_();
    props.setProperty('ADMIN_KEY', chave);
    Logger.log('Chave de administrador criada. Copie e guarde em local seguro:');
  } else {
    Logger.log('A chave de administrador já existia (use gerarNovaChave() para trocar):');
  }
  Logger.log(chave);
  Logger.log('Aba "' + NOME_ABA + '" pronta. Agora faça Implantar > Nova implantação > App da Web.');
}

/** Troca a chave de administrador (a anterior deixa de funcionar). */
function gerarNovaChave() {
  var chave = gerarChave_();
  PropertiesService.getScriptProperties().setProperty('ADMIN_KEY', chave);
  Logger.log('Nova chave de administrador:');
  Logger.log(chave);
}

/**
 * Apaga todas as linhas da aba (mantém o cabeçalho).
 * ATENÇÃO: o Histórico de versões da planilha continua guardando os dados apagados.
 * Para excluir de verdade ao fim do processo, exclua o arquivo da planilha do Drive e
 * esvazie a lixeira (veja docs/BACKEND.md, seção 7).
 */
function apagarTodosOsDados() {
  var r = acaoExcluirTodos_();
  Logger.log(r.ok ? ('Respostas apagadas: ' + r.excluidos) : r.erro);
}

function gerarChave_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '').substring(0, 40);
}

// Exportação para testes no Node (no Apps Script "module" não existe e isto é ignorado).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    doGet: doGet, doPost: doPost, setup: setup,
    validarRespostasCompactas: validarRespostasCompactas, calcularDisc: calcularDisc,
    validarPayload: validarPayload, protegerCelula: protegerCelula, forcarTexto: forcarTexto, normalizarTelefone: normalizarTelefone,
    montarLinha: montarLinha, linhaParaItem: linhaParaItem, CABECALHO: CABECALHO,
    protocoloValido: protocoloValido, normalizarProtocolo: normalizarProtocolo, gerarProtocolo: gerarProtocolo,
    LETRAS_PROTOCOLO: LETRAS_PROTOCOLO, TOTAL_PROTOCOLOS: TOTAL_PROTOCOLOS
  };
}
