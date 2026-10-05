'use strict';
// Carrega apps-script/Code.gs, ClickUp.gs e Relatorio.gs (+ o motor js/relatorio-motor.js, como o
// RelatorioMotor.gs no Apps Script) num contexto vm com stubs dos serviços do Google: planilha, cache,
// propriedades, UrlFetchApp (roteador falso da API do ClickUp e da Anthropic) e ScriptApp (gatilhos).
// Nenhum teste chama serviço real.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const RAIZ = path.join(__dirname, '..', '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
const ARQUIVOS_GS = ['Code.gs', 'ClickUp.gs', 'Relatorio.gs']
  .filter((f) => fs.existsSync(path.join(RAIZ, 'apps-script', f)))
  .map((f) => ({ nome: f, codigo: ler(path.join('apps-script', f)) }));
const CAMINHO_MOTOR = process.env.DISC_MOTOR || path.join(RAIZ, 'js', 'relatorio-motor.js');
const TEM_MOTOR = fs.existsSync(CAMINHO_MOTOR);

// ---------------------------------------------------------------------------
// ClickUp falso (API v2). Estado em memória; cada requisição fica registrada em "requisicoes".
// ---------------------------------------------------------------------------
function criarClickUpFalso(inicial) {
  const st = Object.assign({
    token: 'pk_teste_123',
    usuario: { id: 1, username: 'Consultora Notus' },
    times: [],            // [{id, name, espacos:[{id, name, pastas:[{id, name, listas:[{id,name}] }], listas:[{id,name}] }]}]
    listas: {},           // id -> {id, name, statuses:[{status,type,color}], campos:[...], tarefas:[...], comentarios:[]}
    porPagina: 100,
    falha: null,          // função (req) -> {codigo, corpo} | null, para simular erros
    requisicoes: []
  }, inicial || {});
  let novoId = 0;
  const achaTarefa = (id) => {
    for (const l of Object.values(st.listas)) {
      const t = l.tarefas.find((x) => String(x.id) === String(id));
      if (t) return { lista: l, tarefa: t };
    }
    return null;
  };
  const tarefaApi = (l, t) => ({
    id: t.id, name: t.name, description: t.description || '', tags: (t.tags || []).map((n) => ({ name: n })),
    status: { status: t.status, type: (l.statuses.find((s) => s.status === t.status) || {}).type || 'custom' },
    date_created: String(t.criado || Date.UTC(2026, 9, 1)),
    custom_fields: l.campos.map((c) => {
      const f = JSON.parse(JSON.stringify(c));
      const v = (t.valores || {})[c.id];
      if (v !== undefined && v !== null) f.value = v;
      return f;
    })
  });
  function responder(codigo, corpo) { return { codigo, corpo }; }
  function rotear(metodo, url, corpo) {
    const u = new URL(url);
    const p = u.pathname.replace(/^\/api\/v2/, '');
    let m;
    if (metodo === 'get' && p === '/user') return responder(200, { user: st.usuario });
    if (metodo === 'get' && p === '/team') return responder(200, { teams: st.times.map((t) => ({ id: t.id, name: t.name })) });
    if (metodo === 'get' && (m = p.match(/^\/team\/([^/]+)\/space$/))) {
      const t = st.times.find((x) => x.id === m[1]);
      return responder(200, { spaces: (t ? t.espacos : []).map((e) => ({ id: e.id, name: e.name })) });
    }
    const espaco = (id) => st.times.flatMap((t) => t.espacos).find((e) => e.id === id);
    if (metodo === 'get' && (m = p.match(/^\/space\/([^/]+)\/folder$/))) {
      const e = espaco(m[1]);
      return responder(200, { folders: (e ? e.pastas : []).map((f) => ({ id: f.id, name: f.name, lists: f.listas })) });
    }
    if (metodo === 'get' && (m = p.match(/^\/space\/([^/]+)\/list$/))) {
      const e = espaco(m[1]);
      return responder(200, { lists: e ? e.listas : [] });
    }
    if (metodo === 'get' && (m = p.match(/^\/folder\/([^/]+)\/list$/))) {
      const f = st.times.flatMap((t) => t.espacos).flatMap((e) => e.pastas).find((x) => x.id === m[1]);
      if (!f) return responder(404, { err: 'Folder not found' });
      return responder(200, { lists: f.listas.map((l) => Object.assign({ folder: { id: f.id, name: f.name } }, l)) });
    }
    if ((m = p.match(/^\/list\/([^/]+)(\/.*)?$/))) {
      const l = st.listas[m[1]];
      if (!l) return responder(404, { err: 'List not found' });
      const resto = m[2] || '';
      if (metodo === 'get' && resto === '') return responder(200, { id: l.id, name: l.name, statuses: l.statuses });
      if (metodo === 'get' && resto === '/field') return responder(200, { fields: l.campos });
      if (metodo === 'get' && resto === '/task') {
        const pagina = Number(u.searchParams.get('page') || 0);
        const todas = l.tarefas;
        const fatia = todas.slice(pagina * st.porPagina, (pagina + 1) * st.porPagina);
        return responder(200, { tasks: fatia.map((t) => tarefaApi(l, t)), last_page: (pagina + 1) * st.porPagina >= todas.length });
      }
      if (metodo === 'post' && resto === '/task') {
        const t = { id: 'nova' + (++novoId), name: corpo.name, description: corpo.description, tags: corpo.tags || [], status: l.statuses[0].status, valores: {}, comentarios: [] };
        l.tarefas.push(t);
        return responder(200, tarefaApi(l, t));
      }
      if (metodo === 'post' && resto === '/comment') { l.comentarios.push(corpo.comment_text); return responder(200, { id: 'c' + (++novoId) }); }
    }
    if ((m = p.match(/^\/task\/([^/]+)(\/.*)?$/))) {
      const achado = achaTarefa(m[1]);
      if (!achado) return responder(404, { err: 'Task not found' });
      const { lista, tarefa } = achado;
      const resto = m[2] || '';
      let mc;
      if (metodo === 'post' && (mc = resto.match(/^\/field\/([^/]+)$/))) {
        if (!lista.campos.find((c) => c.id === mc[1])) return responder(400, { err: 'Field not found' });
        tarefa.valores = tarefa.valores || {};
        tarefa.valores[mc[1]] = corpo.value;
        return responder(200, {});
      }
      if (metodo === 'post' && resto === '/comment') { (tarefa.comentarios = tarefa.comentarios || []).push(corpo.comment_text); return responder(200, { id: 'c' + (++novoId) }); }
      if (metodo === 'put' && resto === '') {
        if (corpo.status) tarefa.status = corpo.status;
        return responder(200, tarefaApi(lista, tarefa));
      }
    }
    return responder(404, { err: 'Rota falsa inexistente: ' + metodo + ' ' + p });
  }
  st.atender = function (url, opcoes) {
    const metodo = String(opcoes.method || 'get').toLowerCase();
    const corpo = opcoes.payload ? JSON.parse(opcoes.payload) : undefined;
    const req = { metodo, url, corpo, headers: opcoes.headers || {} };
    st.requisicoes.push(req);
    if ((opcoes.headers || {}).Authorization !== st.token) return { codigo: 401, corpo: { err: 'Token invalid' } };
    const f = st.falha && st.falha(req);
    if (f) return f;
    return rotear(metodo, url, corpo);
  };
  return st;
}

// Lista de exemplo de um processo (Recepcionista) com campos comuns, sensíveis e de DISC.
function listaExemplo(extra) {
  const campos = [
    { id: 'f_whats', name: 'WhatsApp', type: 'phone', type_config: {} },
    { id: 'f_email', name: 'E-mail', type: 'email', type_config: {} },
    { id: 'f_idade', name: 'Idade', type: 'number', type_config: {} },
    { id: 'f_sexo', name: 'Sexo', type: 'drop_down', type_config: { options: [{ id: 'o_f', name: 'Feminino', orderindex: 0 }, { id: 'o_m', name: 'Masculino', orderindex: 1 }] } },
    { id: 'f_civil', name: 'Estado Civil', type: 'short_text', type_config: {} },
    { id: 'f_filhos', name: 'Tem filhos?', type: 'checkbox', type_config: {} },
    { id: 'f_saude', name: 'Problema de saúde', type: 'short_text', type_config: {} },
    { id: 'f_antec', name: 'Antecedentes criminais', type: 'short_text', type_config: {} },
    { id: 'f_trab', name: 'Status de trabalho', type: 'drop_down', type_config: { options: [{ id: 'o_emp', name: 'Empregado', orderindex: 0 }, { id: 'o_des', name: 'Desempregado', orderindex: 1 }] } },
    { id: 'f_pret', name: 'Pretensão salarial', type: 'currency', type_config: {} },
    { id: 'f_ult', name: 'Último salário', type: 'short_text', type_config: {} },
    { id: 'f_escol', name: 'Escolaridade', type: 'drop_down', type_config: { options: [{ id: 'o_med', name: 'Ensino médio', orderindex: 0 }, { id: 'o_sup', name: 'Superior', orderindex: 1 }] } },
    { id: 'f_blocoa', name: 'Bloco A', type: 'number', type_config: {} },
    { id: 'f_entrev', name: 'Entrevista', type: 'number', type_config: {} },
    { id: 'f_cnh', name: 'CNH', type: 'checkbox', type_config: {} },
    { id: 'f_ingles', name: 'Inglês', type: 'labels', type_config: { options: [{ id: 'l_bas', label: 'Básico' }, { id: 'l_flu', label: 'Fluente' }] } },
    { id: 'f_dD', name: 'DISC D %', type: 'number', type_config: {} },
    { id: 'f_dI', name: 'DISC I %', type: 'number', type_config: {} },
    { id: 'f_dS', name: 'DISC S %', type: 'number', type_config: {} },
    { id: 'f_dC', name: 'DISC C %', type: 'number', type_config: {} },
    { id: 'f_dPerfil', name: 'DISC Perfil', type: 'short_text', type_config: {} },
    { id: 'f_dConf', name: 'DISC Confiabilidade', type: 'short_text', type_config: {} },
    { id: 'f_dCod', name: 'DISC Código', type: 'short_text', type_config: {} }
  ];
  const tarefas = [
    { id: 'tb', name: '📌 Briefing — Recepcionista', status: 'gerar relatório', valores: {} },
    { id: 't1', name: 'Ana Paula Souza', status: 'entrevista', criado: Date.UTC(2026, 8, 1),
      valores: { f_whats: '+55 11 98888-1111', f_email: 'ana@exemplo.com', f_idade: 29, f_sexo: 0, f_civil: 'Casada', f_filhos: true,
        f_saude: 'Asma', f_antec: 'Nada consta', f_trab: 'o_des', f_pret: 2500, f_ult: 'R$ 2.100,00', f_escol: 1,
        f_blocoa: 8, f_entrev: 9, f_cnh: true, f_ingles: ['l_flu'] } },
    { id: 't2', name: 'Bruno Lima Castro', status: 'entrevista', criado: Date.UTC(2026, 8, 2),
      valores: { f_whats: '(21) 97777-2222', f_idade: 41, f_trab: 0, f_pret: 3000, f_escol: 'o_med', f_blocoa: 6, f_cnh: false } },
    { id: 't3', name: 'Carla Dias', status: 'novo', criado: Date.UTC(2026, 8, 3),
      valores: { f_whats: '11 96666-3333', f_idade: 35,
        f_dD: 10, f_dI: 20, f_dS: 30, f_dC: 40, f_dPerfil: 'CS', f_dConf: 'Baixa', f_dCod: '12A' } }
  ];
  return Object.assign({
    id: 'L1', name: 'Recepcionista — Clínica Alfa',
    statuses: [
      { status: 'novo', type: 'open', color: '#d3d3d3' },
      { status: 'entrevista', type: 'custom', color: '#f34405' },
      { status: 'gerar relatório', type: 'custom', color: '#ff9f40' },
      { status: 'relatório em revisão', type: 'custom', color: '#324e73' },
      { status: 'concluído', type: 'closed', color: '#13283f' }
    ],
    campos, tarefas, comentarios: []
  }, extra || {});
}

// Config de processo usada nos testes do servidor.
function configExemplo(extra) {
  return Object.assign({
    perfilIdeal: 'S', explicacaoPerfil: 'Atendimento calmo e constante.',
    etapas: [
      { id: 'blocoA', nome: 'Bloco A', peso: 40, campo: 'Bloco A', descricao: 'Prova prática' },
      { id: 'entrevista', nome: 'Entrevista', peso: 60, campo: 'Entrevista', descricao: 'Conversa com a gestora' },
      { id: 'dinamica', nome: 'Dinâmica', peso: 20, campo: 'Dinâmica', descricao: 'Ainda não aplicada' }
    ],
    bonus: [
      { id: 'cnh', nome: 'CNH', campo: 'CNH', regra: { tipo: 'checkbox', pontos: 3 } },
      { id: 'ingles', nome: 'Inglês', campo: 'Inglês', regra: { tipo: 'mapa', pontos: { 'Fluente': 5, 'Básico': 1 } } }
    ],
    corte: 70, faixaAvaliar: 55, statusFinalistas: [], permitirAntecedentes: false
  }, extra || {});
}

function respostaHttp(r) {
  const texto = typeof r.corpo === 'string' ? r.corpo : JSON.stringify(r.corpo || {});
  return { getResponseCode: () => r.codigo, getContentText: () => texto, getHeaders: () => r.headers || {} };
}

function criarAba(nome) {
  const aba = {
    nome,
    linhas: [],          // matriz de valores (linha 1 = índice 0)
    formatos: [],
    congeladas: 0,
    maxColunas: 26,      // planilha nova do Google tem 26 colunas (A..Z)
    getMaxColumns() { return this.maxColunas; },
    insertColumnsAfter(depoisDe, qtd) { if (depoisDe > this.maxColunas) throw new Error('coluna inexistente'); this.maxColunas += qtd; },
    getLastRow() { return this.linhas.length; },
    getMaxRows() { return Math.max(1000, this.linhas.length); },
    setFrozenRows(n) { this.congeladas = n; },
    appendRow(valores) { this.linhas.push(valores.slice()); return this; },
    deleteRow(n) { this.linhas.splice(n - 1, 1); },
    deleteRows(inicio, qtd) { this.linhas.splice(inicio - 1, qtd); },
    getRange(linha, coluna, nLinhas, nColunas) {
      nLinhas = nLinhas || 1; nColunas = nColunas || 1;
      const self = this;
      // Igual ao Apps Script: intervalo fora das dimensões da aba lança erro.
      if (coluna < 1 || coluna - 1 + nColunas > self.maxColunas) {
        throw new Error('The coordinates of the range are outside the dimensions of the sheet.');
      }
      const range = {
        getValues() {
          const out = [];
          for (let r = 0; r < nLinhas; r++) {
            const l = self.linhas[linha - 1 + r] || [];
            const row = [];
            for (let c = 0; c < nColunas; c++) row.push(l[coluna - 1 + c] === undefined ? '' : l[coluna - 1 + c]);
            out.push(row);
          }
          return out;
        },
        setValues(m) {
          m.forEach((row, r) => {
            const idx = linha - 1 + r;
            while (self.linhas.length <= idx) self.linhas.push([]);
            row.forEach((v, c) => { self.linhas[idx][coluna - 1 + c] = v; });
          });
          return range;
        },
        setValue(v) { return range.setValues([[v]]); },
        setFontWeight() { return range; },
        setNumberFormat(f) { self.formatos.push({ coluna, f }); return range; }
      };
      return range;
    }
  };
  return aba;
}

function carregarGas(opcoes) {
  opcoes = opcoes || {};
  const clickup = opcoes.clickup || null;          // criarClickUpFalso(...) ou null
  const anthropic = opcoes.anthropic || null;      // função (req) -> {codigo, corpo}
  const fetches = [];
  const gatilhos = [];
  const props = Object.assign({}, opcoes.props || {});
  const abas = {};
  const ss = {
    getSheetByName(n) { return abas[n] || null; },
    insertSheet(n) { abas[n] = criarAba(n); return abas[n]; }
  };
  const logs = [];
  const sleeps = [];
  const cache = {};            // chave -> { valor, expira (ms no relógio do cache) }
  const relogio = { deslocamentoMs: 0 };   // avançar para simular o tempo passando (cache e agora_)
  const agoraCache = () => Date.now() + relogio.deslocamentoMs;
  let uuid = 0;
  let digests = 0;
  const contexto = {
    console: { log() {}, error() {}, warn() {} },
    JSON, Math, Date, Number, String, Object, Array, RegExp, Error, isNaN, isFinite, parseInt,
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} }) },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (Object.prototype.hasOwnProperty.call(props, k) ? props[k] : null),
        setProperty: (k, v) => { props[k] = String(v); }
      })
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput(txt) {
        return { conteudo: txt, mime: null, setMimeType(m) { this.mime = m; return this; }, getContent() { return this.conteudo; } };
      }
    },
    Utilities: {
      sleep: (ms) => { sleeps.push(ms); },
      getUuid: () => {
        uuid++;
        const h = (uuid * 2654435761 >>> 0).toString(16).padStart(8, '0');
        return h + '-abcd-4ef0-9123-' + h + 'cafe';
      },
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      Charset: { UTF_8: 'UTF_8' },
      // Igual ao Apps Script: devolve os bytes COM sinal (-128..127).
      computeDigest: (alg, texto, charset) => {
        if (alg !== 'SHA_256' || charset !== 'UTF_8') throw new Error('computeDigest: uso inesperado');
        digests++;
        return Array.from(crypto.createHash('sha256').update(String(texto), 'utf8').digest(), (b) => (b > 127 ? b - 256 : b));
      }
    },
    Logger: { log: (m) => { logs.push(String(m)); } },
    UrlFetchApp: {
      fetch(url, op) {
        op = op || {};
        fetches.push({ url, op });
        if (op.muteHttpExceptions !== true) throw new Error('teste: use muteHttpExceptions');
        if (String(url).indexOf('https://api.clickup.com/api/v2/') === 0) {
          if (!clickup) throw new Error('teste: ClickUp falso não configurado');
          return respostaHttp(clickup.atender(url, op));
        }
        if (String(url).indexOf('https://api.anthropic.com/') === 0) {
          if (!anthropic) throw new Error('teste: Anthropic falsa não configurada');
          return respostaHttp(anthropic({ url, op, corpo: JSON.parse(op.payload || '{}'), headers: op.headers || {} }));
        }
        throw new Error('teste: chamada externa inesperada para ' + url);
      }
    },
    ScriptApp: {
      newTrigger(fn) {
        const g = { fn, tipo: null, minutos: null, getHandlerFunction: () => fn };
        const b = {
          timeBased() { g.tipo = 'tempo'; return b; },
          everyMinutes(n) { g.minutos = n; return b; },
          create() { gatilhos.push(g); return g; }
        };
        return b;
      },
      getProjectTriggers: () => gatilhos.slice(),
      deleteTrigger(g) { const i = gatilhos.indexOf(g); if (i >= 0) gatilhos.splice(i, 1); }
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => {
          if (!Object.prototype.hasOwnProperty.call(cache, k)) return null;
          if (cache[k].expira <= agoraCache()) { delete cache[k]; return null; }
          return cache[k].valor;
        },
        put: (k, v, seg) => {
          if (seg !== undefined && seg > 21600) throw new Error('CacheService: validade máxima é 21600 s');
          cache[k] = { valor: String(v), expira: agoraCache() + (seg === undefined ? 600 : seg) * 1000 };
        },
        remove: (k) => { delete cache[k]; }
      })
    }
  };
  vm.createContext(contexto);
  ARQUIVOS_GS.forEach((a) => vm.runInContext(a.codigo, contexto, { filename: a.nome }));
  if (opcoes.confiabilidade) {
    // Como se scoring.js + confiabilidade.js também estivessem no projeto do Apps Script.
    vm.runInContext(ler('js/scoring.js'), contexto, { filename: 'scoring.js' });
    vm.runInContext(ler('js/confiabilidade.js'), contexto, { filename: 'confiabilidade.js' });
  }
  if (TEM_MOTOR && opcoes.motor !== false) {
    vm.runInContext(fs.readFileSync(CAMINHO_MOTOR, 'utf8'), contexto, { filename: 'RelatorioMotor.gs' });
  }
  // O relógio do servidor (agora_) acompanha o do cache, para testar bloqueio e sessão expirada.
  contexto.agora_ = () => Date.now() + relogio.deslocamentoMs;
  function avancar(ms) { relogio.deslocamentoMs += ms; }

  function post(corpo) {
    const conteudo = typeof corpo === 'string' ? corpo : JSON.stringify(corpo);
    const saida = contexto.doPost({ postData: { contents: conteudo, type: 'text/plain' } });
    assertJson(saida);
    return JSON.parse(saida.conteudo);
  }
  function assertJson(saida) {
    if (!saida || saida.mime !== 'application/json') throw new Error('resposta sem MimeType JSON');
  }
  return {
    g: contexto, props, abas, logs, sleeps, cache, post, avancar, fetches, gatilhos, clickup,
    aba: () => abas.Respostas,
    digests: () => digests
  };
}

module.exports = { carregarGas, criarClickUpFalso, listaExemplo, configExemplo, TEM_MOTOR };
