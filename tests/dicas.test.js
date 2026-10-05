'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const DICAS = require('../js/dicas.js');
const DATA = require('../js/disc-data.js');
const A = require('../js/app.js');

const grupos = DATA.grupos || (DATA.DISC_DATA && DATA.DISC_DATA.grupos);
const LETRAS = ['D', 'I', 'S', 'C'];
const PROIBIDAS = ['ótim', 'excelente', 'qualidade', 'defeito', 'ruim', 'positiv', 'negativ',
  'ideal', 'melhor', 'pior', 'dominân', 'influên', 'estabilid', 'conformid'];

function semProibidas(texto, onde) {
  const t = String(texto).toLowerCase();
  for (const p of PROIBIDAS) assert.ok(!t.includes(p), `"${p}" encontrado em ${onde}: ${texto}`);
  // "DISC" como palavra inteira (não bloqueia "discordar", "discussão").
  assert.ok(!/\bdisc\b/i.test(t), `"DISC" encontrado em ${onde}: ${texto}`);
}

test('25 perguntas com dica', () => {
  assert.equal(DICAS.perguntas.length, 25);
  assert.equal(grupos.length, 25);
  for (let i = 0; i < 25; i++) {
    const d = DICAS.dicaPergunta(i);
    assert.ok(d && d.trim().length > 0, `pergunta ${i}`);
    semProibidas(d, `pergunta ${i}`);
  }
});

test('25 grupos x 4 letras com sentido e exemplo válidos', () => {
  assert.equal(DICAS.palavras.length, 25);
  for (let i = 0; i < 25; i++) {
    for (const L of LETRAS) {
      const d = DICAS.dicaPalavra(i, L);
      const onde = `grupo ${i} ${L}`;
      assert.ok(d, onde);
      assert.equal(d.palavra, A.palavraDoGrupo(i, grupos[i], L), onde);
      assert.ok(d.sentido.trim().length > 0, onde);
      assert.ok(d.exemplo.trim().length > 0, onde);
      assert.ok(d.exemplo.startsWith('Ex.:'), onde);
      assert.ok(d.sentido.length <= 110, `${onde} sentido longo (${d.sentido.length})`);
      assert.ok(d.exemplo.length <= 130, `${onde} exemplo longo (${d.exemplo.length})`);
      semProibidas(d.sentido, onde);
      semProibidas(d.exemplo, onde);
    }
  }
});

test('aceita texto exibido e original da palavra', () => {
  for (let i = 0; i < 25; i++) {
    for (const L of LETRAS) {
      assert.equal(DICAS.dicaPalavra(i, grupos[i][L]).sentido, DICAS.palavras[i][L].sentido, `${i}${L}`);
      assert.equal(DICAS.dicaPalavra(i, A.palavraDoGrupo(i, grupos[i], L)).sentido, DICAS.palavras[i][L].sentido);
    }
  }
  assert.equal(DICAS.dicaPalavra(19, 'Relacionadas a pessoas').palavra, 'Relacionadas a pessoas');
  assert.equal(DICAS.dicaPalavra(19, 'Relacionada a pessoas').palavra, 'Relacionadas a pessoas');
  assert.equal(DICAS.dicaPalavra(0, 'x'), null);
  assert.equal(DICAS.dicaPergunta(99), '');
});
