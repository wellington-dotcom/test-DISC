'use strict';
// Carrega apps-script/Code.gs num contexto vm com stubs mínimos dos serviços do Google.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const CODIGO = fs.readFileSync(path.join(__dirname, '..', '..', 'apps-script', 'Code.gs'), 'utf8');

function criarAba(nome) {
  const aba = {
    nome,
    linhas: [],          // matriz de valores (linha 1 = índice 0)
    formatos: [],
    congeladas: 0,
    getLastRow() { return this.linhas.length; },
    getMaxRows() { return Math.max(1000, this.linhas.length); },
    setFrozenRows(n) { this.congeladas = n; },
    appendRow(valores) { this.linhas.push(valores.slice()); return this; },
    deleteRow(n) { this.linhas.splice(n - 1, 1); },
    deleteRows(inicio, qtd) { this.linhas.splice(inicio - 1, qtd); },
    getRange(linha, coluna, nLinhas, nColunas) {
      nLinhas = nLinhas || 1; nColunas = nColunas || 1;
      const self = this;
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
  const props = Object.assign({}, opcoes.props || {});
  const abas = {};
  const ss = {
    getSheetByName(n) { return abas[n] || null; },
    insertSheet(n) { abas[n] = criarAba(n); return abas[n]; }
  };
  const logs = [];
  const sleeps = [];
  const cache = {};
  let uuid = 0;
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
      }
    },
    Logger: { log: (m) => { logs.push(String(m)); } },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => (Object.prototype.hasOwnProperty.call(cache, k) ? cache[k] : null),
        put: (k, v) => { cache[k] = String(v); }
      })
    }
  };
  vm.createContext(contexto);
  vm.runInContext(CODIGO, contexto, { filename: 'Code.gs' });

  function post(corpo) {
    const conteudo = typeof corpo === 'string' ? corpo : JSON.stringify(corpo);
    const saida = contexto.doPost({ postData: { contents: conteudo, type: 'text/plain' } });
    assertJson(saida);
    return JSON.parse(saida.conteudo);
  }
  function assertJson(saida) {
    if (!saida || saida.mime !== 'application/json') throw new Error('resposta sem MimeType JSON');
  }
  return { g: contexto, props, abas, logs, sleeps, cache, post, aba: () => abas.Respostas };
}

module.exports = { carregarGas };
