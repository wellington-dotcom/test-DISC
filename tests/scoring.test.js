'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../js/scoring.js');
const DATA = require('../js/disc-data.js');
const { respostasFixas, respostasAleatorias, prng } = require('./helpers/fixtures.js');

test('disc-data tem 25 grupos com as 4 letras e 4 perfis', () => {
  assert.equal(DATA.grupos.length, 25);
  DATA.grupos.forEach((g, i) => {
    assert.ok(g.titulo, 'grupo ' + i + ' sem título');
    ['D', 'I', 'S', 'C'].forEach((l) => assert.ok(String(g[l] || '').trim(), 'grupo ' + i + ' sem ' + l));
  });
  ['D', 'I', 'S', 'C'].forEach((l) => {
    const p = DATA.perfis[l];
    assert.ok(p.nome && p.rotulo && p.cor);
    assert.ok(Array.isArray(p.positivos) && p.positivos.length);
  });
});

test('constantes', () => {
  assert.deepEqual(S.LETRAS, ['D', 'I', 'S', 'C']);
  assert.equal(S.TOTAL_GRUPOS, 25);
});

test('perfil extremo D>I>S>C: totais 100/75/50/25 e percentuais 40/30/20/10', () => {
  const r = S.calcular(respostasFixas(['D', 'I', 'S', 'C']));
  assert.deepEqual(r.totais, { D: 100, I: 75, S: 50, C: 25 });
  assert.deepEqual(r.percentuais, { D: 40, I: 30, S: 20, C: 10 });
  assert.equal(r.primario, 'D');
  assert.equal(r.secundario, 'I');
  assert.equal(r.codigo, 'DI');
  assert.deepEqual(r.ordem, ['D', 'I', 'S', 'C']);
});

test('perfil C>S: código CS', () => {
  const r = S.calcular(respostasFixas(['C', 'S', 'I', 'D']));
  assert.equal(r.codigo, 'CS');
  assert.equal(r.percentuais.C, 40);
});

test('respostas aleatórias: soma dos totais = 250, percentual = total/2.5, soma 100', () => {
  const rnd = prng(42);
  for (let k = 0; k < 300; k++) {
    const resp = respostasAleatorias(rnd);
    const r = S.calcular(resp);
    const soma = r.totais.D + r.totais.I + r.totais.S + r.totais.C;
    assert.equal(soma, 250);
    let somaPct = 0;
    ['D', 'I', 'S', 'C'].forEach((l) => {
      assert.ok(r.totais[l] >= 25 && r.totais[l] <= 100);
      assert.equal(r.percentuais[l], Math.round((r.totais[l] / 2.5) * 10) / 10);
      somaPct += r.percentuais[l];
    });
    assert.ok(Math.abs(somaPct - 100) < 0.01, 'soma ' + somaPct);
    assert.ok(r.totais[r.primario] >= r.totais[r.secundario]);
    assert.equal(r.codigo, r.primario + r.secundario);
  }
});

test('empate mantém a ordem D, I, S, C', () => {
  const rnd = prng(99);
  let achados = 0;
  for (let k = 0; k < 20000 && achados < 20; k++) {
    const r = S.calcular(respostasAleatorias(rnd));
    for (let a = 0; a < 3; a++) {
      const x = r.ordem[a], y = r.ordem[a + 1];
      if (r.totais[x] === r.totais[y]) {
        achados++;
        assert.ok(S.LETRAS.indexOf(x) < S.LETRAS.indexOf(y), 'empate ' + x + '/' + y + ' fora de ordem');
      }
    }
  }
  assert.ok(achados > 0, 'nenhum empate gerado');
});

test('validação de grupo', () => {
  assert.equal(S.validarGrupo({ D: 4, I: 3, S: 2, C: 1 }), true);
  assert.equal(S.validarGrupo({ D: 4, I: 4, S: 2, C: 1 }), false, 'repetido');
  assert.equal(S.validarGrupo({ D: 5, I: 3, S: 2, C: 1 }), false, 'fora da faixa');
  assert.equal(S.validarGrupo({ D: '4', I: 3, S: 2, C: 1 }), false, 'string');
  assert.equal(S.validarGrupo({ D: 4, I: 3, S: 2 }), false, 'faltando');
  assert.equal(S.validarGrupo(null), false);
});

test('validação de respostas e erro em calcular', () => {
  const ok = respostasFixas(['D', 'I', 'S', 'C']);
  assert.equal(S.validarRespostas(ok), true);
  assert.equal(S.validarRespostas(ok.slice(0, 24)), false);
  assert.equal(S.validarRespostas('x'), false);
  const ruim = ok.slice(); ruim[10] = { D: 1, I: 1, S: 1, C: 1 };
  assert.equal(S.validarRespostas(ruim), false);
  assert.throws(() => S.calcular(ruim), /inválidas/);
});

test('compactar / descompactar round-trip', () => {
  const rnd = prng(7);
  for (let k = 0; k < 50; k++) {
    const resp = respostasAleatorias(rnd);
    const str = S.compactar(resp);
    assert.match(str, /^[1-4]{100}$/);
    assert.deepEqual(S.descompactar(str), resp);
  }
  assert.equal(S.compactar(respostasFixas(['D', 'I', 'S', 'C'])), '4321'.repeat(25));
});

test('descompactar tolera separadores e rejeita tamanho errado', () => {
  const str = '4321'.repeat(25);
  assert.deepEqual(S.descompactar(str.replace(/(\d{4})/g, '$1 ')), S.descompactar(str));
  assert.throws(() => S.descompactar('4321'), /inválidas/);
  assert.throws(() => S.descompactar(''), /inválidas/);
  assert.throws(() => S.descompactar(null), /inválidas/);
});
