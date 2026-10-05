'use strict';
// Régua de intensidade DISC (js/disc-intensidade.js): faixas calibradas e 20 textos letra × faixa.
const test = require('node:test');
const assert = require('node:assert/strict');
const IN = require('../js/disc-intensidade.js');
const S = require('../js/scoring.js');

const LETRAS = ['D', 'I', 'S', 'C'];
const SENSIVEIS = ['sexo', 'idade', 'gênero', 'autoestima', 'cérebro', 'cerebral', 'neuro\\w*', 'emociona\\w*', 'saúde', 'doença', 'ansiedade', 'trauma', 'medo', 'religião'];
const palavra = (p) => new RegExp('(^|[^\\p{L}])(' + p + ')([^\\p{L}]|$)', 'iu');

test('faixa: limites 15 / 22 / 29 / 36 e entradas inválidas', () => {
  assert.deepEqual(IN.FAIXAS, ['muito_baixa', 'baixa', 'media', 'alta', 'muito_alta']);
  assert.deepEqual(IN.LIMITES, [15, 22, 29, 36]);
  const casos = [[10, 'muito_baixa'], [14.9, 'muito_baixa'], [15, 'baixa'], [21.9, 'baixa'], [22, 'media'], [25, 'media'],
    [28.9, 'media'], [29, 'alta'], [35.9, 'alta'], [36, 'muito_alta'], [40, 'muito_alta'], ['30', 'alta'], [0, 'muito_baixa'], [100, 'muito_alta']];
  casos.forEach(([pct, f]) => assert.equal(IN.faixa(pct), f, String(pct)));
  [null, undefined, '', 'x', -1, 101, NaN, true].forEach((v) => assert.equal(IN.faixa(v), null, String(v)));
  IN.FAIXAS.forEach((f) => assert.ok(IN.ROTULOS[f]));
});

test('calibragem: todas as faixas são alcançáveis no teste real e a média cai em "media"', () => {
  // Percentuais possíveis: total 25..100 / 2.5 (10..40, passos de 0.4).
  const vistas = new Set();
  for (let t = 25; t <= 100; t++) vistas.add(IN.faixa(Math.round((t / 2.5) * 10) / 10));
  assert.deepEqual([...vistas].sort(), [...IN.FAIXAS].sort());
  assert.equal(IN.faixa(25), 'media');
  // Respostas extremas (sempre a mesma ordem) dão muito_alta / alta / baixa / muito_baixa.
  const r = S.calcular(Array.from({ length: 25 }, () => ({ D: 4, I: 3, S: 2, C: 1 })));
  assert.deepEqual(LETRAS.map((l) => IN.faixa(r.percentuais[l])), ['muito_alta', 'alta', 'baixa', 'muito_baixa']);
});

test('texto: 20 combinações letra × faixa, completas, distintas e com tom construtivo', () => {
  const vistos = new Set();
  LETRAS.forEach((l) => IN.FAIXAS.forEach((f) => {
    const t = IN.texto(l, f);
    assert.ok(t, l + ' ' + f);
    assert.deepEqual(Object.keys(t), ['resumo', 'comportamento', 'excesso', 'falta']);
    assert.ok(t.resumo.length > 30 && t.comportamento.length > 40, l + ' ' + f);
    assert.ok(t.resumo.includes(IN.NOMES[l]), 'resumo cita o fator');
    if (f === 'alta' || f === 'muito_alta') { assert.match(t.excesso, /^Quando exagerad/); assert.equal(t.falta, null); }
    else if (f === 'baixa' || f === 'muito_baixa') { assert.match(t.falta, /^Quando falta/); assert.equal(t.excesso, null); }
    else { assert.equal(t.excesso, null); assert.equal(t.falta, null); }
    [t.resumo, t.comportamento, t.excesso, t.falta].filter(Boolean).forEach((x) => {
      assert.ok(!vistos.has(x), 'texto repetido: ' + x); vistos.add(x);
      SENSIVEIS.forEach((p) => assert.doesNotMatch(x, palavra(p)));
    });
  }));
  assert.equal(vistos.size, 20 * 2 + 16);
  assert.equal(IN.texto('X', 'alta'), null);
  assert.equal(IN.texto('D', 'enorme'), null);
  assert.deepEqual(IN.texto('d', 'alta'), IN.texto('D', 'alta'));
  // Devolve cópia
  IN.texto('D', 'alta').resumo = 'mudado';
  assert.notEqual(IN.texto('D', 'alta').resumo, 'mudado');
});

test('regua: 4 fatores na ordem D, I, S, C com faixa e texto; null se inválido', () => {
  const r = IN.regua({ D: 38, I: 30, S: 18, C: 14 });
  assert.deepEqual(r.map((f) => [f.letra, f.nome, f.pct, f.faixa, f.rotulo]), [
    ['D', 'Dominância', 38, 'muito_alta', 'Muito alta'], ['I', 'Influência', 30, 'alta', 'Alta'],
    ['S', 'Estabilidade', 18, 'baixa', 'Baixa'], ['C', 'Conformidade', 14, 'muito_baixa', 'Muito baixa']]);
  assert.equal(r[0].resumo, IN.texto('D', 'muito_alta').resumo);
  assert.deepEqual(JSON.parse(JSON.stringify(r)), r);
  assert.equal(IN.regua(null), null);
  assert.equal(IN.regua({ D: 30, I: 30, S: 30 }), null);
  // Determinístico
  assert.deepEqual(IN.regua({ D: 38, I: 30, S: 18, C: 14 }), r);
});
