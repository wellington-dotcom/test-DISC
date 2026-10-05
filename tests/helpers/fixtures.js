'use strict';
// Geradores de respostas reutilizados pelos testes unitários e E2E.
const LETRAS = ['D', 'I', 'S', 'C'];

// Gera 25 grupos em que a ordem de preferência é fixa (ex.: ['D','I','S','C'] -> D=4, I=3, S=2, C=1).
function respostasFixas(ordem) {
  const out = [];
  for (let i = 0; i < 25; i++) {
    const g = {};
    ordem.forEach((l, idx) => { g[l] = 4 - idx; });
    out.push(g);
  }
  return out;
}

// PRNG determinístico (mulberry32) para testes reprodutíveis.
function prng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function respostasAleatorias(rnd) {
  const out = [];
  for (let i = 0; i < 25; i++) {
    const notas = [1, 2, 3, 4];
    for (let k = notas.length - 1; k > 0; k--) {
      const j = Math.floor(rnd() * (k + 1));
      [notas[k], notas[j]] = [notas[j], notas[k]];
    }
    const g = {};
    LETRAS.forEach((l, idx) => { g[l] = notas[idx]; });
    out.push(g);
  }
  return out;
}

function payloadValido(extra) {
  const scoring = require('../../js/scoring.js');
  const respostas = respostasFixas(['D', 'I', 'S', 'C']);
  const res = scoring.calcular(respostas);
  return Object.assign({
    v: 1,
    id: 'lx1abc-teste01',
    nome: 'João da Silva',
    telefone: '5511999998888',
    idade: 30,
    funcao: 'Recepcionista',
    empresa: 'Loja Centro',
    vaga: 'Vendedor',
    consentimento: true,
    inicio: '2026-10-01T12:00:00.000Z',
    fim: '2026-10-01T12:10:00.000Z',
    duracaoSeg: 600,
    respostas: scoring.compactar(respostas),
    resultado: { percentuais: res.percentuais, codigo: res.codigo }
  }, extra || {});
}

module.exports = { LETRAS, respostasFixas, respostasAleatorias, prng, payloadValido };
