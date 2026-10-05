'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../js/lideranca.js');
const S = require('../js/scoring.js');
const { respostasFixas, respostasAleatorias, prng } = require('./helpers/fixtures.js');

const LETRAS = ['D', 'I', 'S', 'C'];
const COMBINACOES = [];
LETRAS.forEach((a) => LETRAS.forEach((b) => { if (a !== b) COMBINACOES.push(a + b); }));

function verificarGuia(guia, primeiroNome) {
  assert.ok(guia && typeof guia === 'object');
  assert.ok(String(guia.titulo || '').trim(), 'título vazio');
  assert.ok(String(guia.resumo || '').trim(), 'resumo vazio');
  assert.ok(Array.isArray(guia.secoes) && guia.secoes.length >= 5, 'poucas seções');
  guia.secoes.forEach((s) => {
    assert.ok(String(s.titulo || '').trim(), 'seção sem título');
    assert.ok(Array.isArray(s.itens) && s.itens.length > 0, 'seção vazia: ' + s.titulo);
    s.itens.forEach((i) => {
      assert.equal(typeof i, 'string');
      assert.ok(i.trim(), 'item vazio em ' + s.titulo);
      assert.ok(!/\{nome\}|undefined|null|NaN/.test(i), 'marcador não substituído em: ' + i);
    });
  });
  const tudo = JSON.stringify(guia);
  assert.ok(!/\{nome\}/.test(tudo), 'marcador {nome} sobrando');
  if (primeiroNome) assert.ok(tudo.indexOf(primeiroNome) !== -1, 'nome não aparece no guia');
}

test('combinacoes cobre as 12 combinações', () => {
  COMBINACOES.forEach((c) => {
    assert.ok(L.combinacoes[c], 'faltando ' + c);
    assert.ok(String(L.combinacoes[c].nome || '').trim());
  });
});

test('porPerfil tem os 4 perfis', () => {
  LETRAS.forEach((l) => assert.ok(L.porPerfil[l], 'faltando ' + l));
});

COMBINACOES.forEach((codigo) => {
  test('gerarGuia para ' + codigo + ' gera seções não vazias e personalizadas', () => {
    const ordem = [codigo[0], codigo[1]].concat(LETRAS.filter((l) => codigo.indexOf(l) === -1));
    const resultado = S.calcular(respostasFixas(ordem));
    assert.equal(resultado.codigo, codigo);
    const guia = L.gerarGuia(resultado, 'Maria Aparecida Souza');
    verificarGuia(guia, 'Maria');
    if (L.SECOES) assert.equal(guia.secoes.length, L.SECOES.length);
  });
});

test('perfil equilibrado (25/26/25/24) gera guia completo com aviso de resultado pouco conclusivo', () => {
  const guia = L.gerarGuia({ percentuais: { D: 25, I: 26, S: 25, C: 24 } }, 'Carlos Eduardo');
  verificarGuia(guia, 'Carlos');
  assert.match(guia.resumo, /equilibrad|conclusiv/i);
  if ('equilibrado' in guia) assert.equal(guia.equilibrado, true);
});

test('perfil intenso (D 40%) é marcado como intenso', () => {
  const guia = L.gerarGuia(S.calcular(respostasFixas(['D', 'I', 'S', 'C'])), 'Ana Lima');
  verificarGuia(guia, 'Ana');
  if ('intenso' in guia) assert.equal(guia.intenso, true);
});

test('resultados aleatórios reais nunca quebram', () => {
  const rnd = prng(123);
  for (let k = 0; k < 100; k++) {
    verificarGuia(L.gerarGuia(S.calcular(respostasAleatorias(rnd)), 'Pedro Álvares Cabral'), 'Pedro');
  }
});

test('nome com espaços extras usa só o primeiro nome', () => {
  const guia = L.gerarGuia(S.calcular(respostasFixas(['S', 'C', 'I', 'D'])), '   Érica   Fernandes  ');
  verificarGuia(guia, 'Érica');
});

test('gerarTexto produz texto puro com título, seções e itens', () => {
  const guia = L.gerarGuia(S.calcular(respostasFixas(['I', 'S', 'D', 'C'])), 'Beatriz Nogueira');
  const txt = L.gerarTexto(guia);
  assert.equal(typeof txt, 'string');
  assert.ok(txt.length > 200);
  assert.ok(txt.indexOf('Beatriz') !== -1);
  assert.ok(!/<[a-z][^>]*>/i.test(txt), 'não deve conter HTML');
  guia.secoes.forEach((s) => {
    assert.ok(txt.indexOf(s.titulo) !== -1, 'título da seção ausente: ' + s.titulo);
    assert.ok(txt.indexOf(s.itens[0]) !== -1, 'item ausente: ' + s.itens[0]);
  });
  assert.ok(txt.indexOf('•') !== -1);
});

test('guia não traz orientações opostas nem rótulos crus da planilha', () => {
  const casos = [{ D: 15, I: 30, S: 20, C: 35 }, { D: 15, I: 30, S: 35, C: 20 }, { D: 20, I: 35, S: 30, C: 15 }, { D: 20, I: 35, S: 15, C: 30 }];
  casos.forEach((pct) => {
    const txt = L.gerarTexto(L.gerarGuia({ percentuais: pct }, 'Ana Lima'));
    const publico = /Reconheça em público/.test(txt);
    const discreto = /reconhecimento discreto|reconhecimento sincero e em particular/.test(txt);
    assert.ok(!(publico && discreto), 'reconhecimento contraditório em ' + JSON.stringify(pct));
    assert.ok(!/também pode ficar falante/.test(txt));
    assert.ok(!/arrogante|egoísta|agressivo|atribui-se|liberdade de normas|ambiente que lhe permita mudar|despreocupado/i.test(txt), JSON.stringify(pct));
  });
});

test('perfil intenso explica a média e propõe ação concreta', () => {
  const guia = L.gerarGuia({ percentuais: { D: 15, I: 30, S: 20, C: 35 } }, 'Ana Lima');
  const txt = L.gerarTexto(guia);
  assert.match(txt, /a média é 25%/);
  assert.match(txt, /Plano de Desenvolvimento Individual/);
  assert.ok(!/fator mais baixo/.test(txt));
});
