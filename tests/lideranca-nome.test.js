'use strict';
// Guia de liderança (js/lideranca.js): o estilo usa o nome oficial da combinação (js/disc-combinacoes.js),
// o mesmo do painel e dos relatórios (ex.: DI = "Mobilizador"), e não um nome próprio do guia.
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../js/lideranca.js');
const CB = require('../js/disc-combinacoes.js');

const LETRAS = ['D', 'I', 'S', 'C'];

test('estilo e resumo do guia usam o nome oficial de cada combinação', () => {
  for (const a of LETRAS) {
    for (const b of LETRAS) {
      if (a === b) continue;
      const cod = a + b;
      const pct = { D: 10, I: 10, S: 10, C: 10 };
      pct[a] = 45; pct[b] = 35;
      const g = L.gerarGuia({ percentuais: pct }, 'Diego Souza');
      assert.equal(g.estilo, CB.nome(cod).nome, cod);
      assert.match(g.resumo, new RegExp('Estilo ' + CB.nome(cod).nome + ':'), cod);
    }
  }
});
