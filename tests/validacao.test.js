'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../js/validacao.js');
const S = require('../js/scoring.js');
const { respostasFixas, respostasAleatorias, prng } = require('./helpers/fixtures.js');

const LETRAS = ['D', 'I', 'S', 'C'];
const PROIBIDOS = /\bdisc\b|dominân|influên|estabilid|conformid|ótim|melhor|pior|dominante|influente/i;

function todosOsTextos() {
  const out = [];
  LETRAS.forEach((l) => {
    out.push(V.retratos[l]);
    V.afirmacoes[l].forcas.forEach((f) => out.push(f.texto));
    V.afirmacoes[l].sombras.forEach((s) => out.push(s.texto));
  });
  return out.concat(V.ESCALA);
}

test('estrutura: 4 retratos com 2-3 frases e 3 forças + 3 sombras por letra', () => {
  LETRAS.forEach((l) => {
    const frases = V.retratos[l].split(/[.!?]\s*/).filter(Boolean);
    assert.ok(frases.length >= 2 && frases.length <= 3, 'retrato ' + l + ' com ' + frases.length + ' frases');
    const a = V.afirmacoes[l];
    assert.equal(a.forcas.length, 3);
    assert.equal(a.sombras.length, 3);
    a.forcas.concat(a.sombras).forEach((it) => assert.ok(it.id && it.texto.trim()));
  });
  assert.deepEqual(V.ESCALA, ['Discordo totalmente', 'Discordo', 'Em parte', 'Concordo', 'Concordo totalmente']);
});

test('ids únicos em todas as afirmações', () => {
  const ids = [];
  LETRAS.forEach((l) => V.afirmacoes[l].forcas.concat(V.afirmacoes[l].sombras).forEach((it) => ids.push(it.id)));
  assert.equal(new Set(ids).size, ids.length);
});

test('nenhum texto visível com termos proibidos nem letras soltas', () => {
  todosOsTextos().forEach((t) => {
    assert.ok(!PROIBIDOS.test(t), 'termo proibido em: ' + t);
    assert.ok(!/(^|[^\p{L}])[DISC]([^\p{L}]|$)/u.test(t), 'letra solta em: ' + t);
  });
});

test('retratos têm tamanho parecido (nenhum chama mais atenção)', () => {
  const tam = LETRAS.map((l) => V.retratos[l].length);
  assert.ok(Math.max(...tam) / Math.min(...tam) < 1.6, 'tamanhos: ' + tam.join(','));
});

test('montarEtapa: 3 pares com as letras certas e 4 itens dos tipos certos (vários resultados)', () => {
  const rnd = prng(42);
  for (let n = 0; n < 200; n++) {
    const r = S.calcular(respostasAleatorias(rnd));
    const [p, s, t, u] = r.ordem;
    const e = V.montarEtapa(r, rnd);
    assert.equal(e.pares.length, 3);
    const chave = (par) => par.slice().sort().join('');
    const esperados = [[p, u], [s, t], [p, t]].map(chave).sort();
    assert.deepEqual(e.pares.map(chave).sort(), esperados);
    e.pares.forEach((par) => assert.notEqual(par[0], par[1]));

    assert.equal(e.itens.length, 4);
    const por = (letra, tipo) => e.itens.filter((it) => it.letra === letra && it.tipo === tipo);
    assert.equal(por(p, 'forca').length, 1);
    assert.equal(por(p, 'sombra').length, 1);
    assert.equal(por(s, 'forca').length, 1);
    assert.equal(por(u, 'contraste').length, 1);
    // a sombra é o excesso da força mostrada (mesmo índice)
    const k = V.afirmacoes[p].forcas.findIndex((f) => f.id === por(p, 'forca')[0].id);
    assert.equal(por(p, 'sombra')[0].id, V.afirmacoes[p].sombras[k].id);
    e.itens.forEach((it) => assert.ok(it.id && it.texto));
  }
});

test('montarEtapa: embaralha (com rnd diferente muda a ordem) e funciona sem rnd', () => {
  const r = S.calcular(respostasFixas(['D', 'I', 'S', 'C']));
  const vistos = new Set();
  for (let seed = 1; seed < 40; seed++) {
    const e = V.montarEtapa(r, prng(seed));
    vistos.add(e.itens.map((i) => i.tipo).join(',') + '|' + e.pares.map((x) => x.join('')).join(','));
  }
  assert.ok(vistos.size > 5);
  const e = V.montarEtapa(r);
  assert.equal(e.itens.length, 4);
});

test('montarEtapa aceita resultado só com percentuais', () => {
  const e = V.montarEtapa({ percentuais: { D: 10, I: 20, S: 30, C: 40 } }, prng(3));
  const chave = (par) => par.slice().sort().join('');
  assert.deepEqual(e.pares.map(chave).sort(), [['C', 'D'], ['I', 'S'], ['C', 'I']].map(chave).sort());
  assert.ok(e.itens.some((it) => it.letra === 'D' && it.tipo === 'contraste'));
});
