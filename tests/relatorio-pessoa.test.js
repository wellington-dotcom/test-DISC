'use strict';
// Relatório DISC "modelo pessoa" (desenvolvimento da própria pessoa): dados puros e serializáveis.
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../js/relatorio-pessoa.js');
const DATA = require('../js/disc-data.js');
const S = require('../js/scoring.js');

const REL = { percentuais: { D: 30, I: 10, S: 20, C: 40 }, codigo: 'CD' };

test('dadosDoResultado valida percentuais e código', () => {
  assert.deepEqual(R.dadosDoResultado(REL.percentuais, 'cd'), REL);
  assert.equal(R.dadosDoResultado(null, 'CD'), null);
  assert.equal(R.dadosDoResultado({ D: 30, I: 10, S: 20 }, 'CD'), null);
  assert.equal(R.dadosDoResultado({ D: 30, I: 10, S: 20, C: 140 }, 'CD'), null);
  assert.equal(R.dadosDoResultado(REL.percentuais, 'CC'), null);
  assert.equal(R.dadosDoResultado(REL.percentuais, 'XD'), null);
  assert.equal(R.montar(null, 'Ana'), null);
  assert.equal(R.montar({ percentuais: REL.percentuais, codigo: 'C' }, 'Ana'), null);
});

test('montar: perfil, 4 fatores, seções na ordem e aviso', () => {
  const d = R.montar(REL, '  Bruna  Lima ', DATA);
  assert.equal(d.versao, 1);
  assert.equal(d.nome, 'Bruna');
  assert.equal(d.codigo, 'CD');
  assert.deepEqual(d.primario, { letra: 'C', nome: 'Conformidade', rotulo: 'Cauteloso' });
  assert.deepEqual(d.secundario, { letra: 'D', nome: 'Dominância', rotulo: 'Dominante' });
  assert.ok(d.frase.length > 20 && d.frase.endsWith('.'));
  assert.deepEqual(d.fatores.map((f) => [f.letra, f.nome, f.pct]),
    [['D', 'Dominância', 30], ['I', 'Influência', 10], ['S', 'Estabilidade', 20], ['C', 'Conformidade', 40]]);
  d.fatores.forEach((f) => assert.ok(f.descricao));
  assert.deepEqual(d.secoes.map((s) => s.id), ['fortes', 'atencao', 'pressao', 'comunicacao', 'plano']);
  const sec = Object.fromEntries(d.secoes.map((s) => [s.id, s]));
  assert.deepEqual(sec.fortes.caracteristicas, DATA.perfis.C.positivos);
  assert.ok(sec.fortes.itens.length >= 3);
  assert.ok(sec.atencao.itens.every((it) => /quando exagerad/i.test(it.texto)), 'tom construtivo');
  assert.deepEqual(sec.pressao.sinais, DATA.perfis.C.sobPressao);
  assert.ok(sec.pressao.itens.length >= 3);
  assert.deepEqual(sec.comunicacao.perfis.map((p) => p.letra), ['D', 'I', 'S'], 'os 3 outros perfis');
  sec.comunicacao.perfis.forEach((p) => assert.equal(p.texto, R.COMUNICACAO[p.letra]));
  assert.ok(sec.plano.itens.length >= 3 && sec.plano.itens.length <= 5);
  assert.deepEqual([...new Set(sec.plano.itens.map((i) => i.prazo))].sort(), ['30 dias', '60 dias', '90 dias']);
  // Hábito do fator menos presente (I = 10%)
  assert.ok(sec.plano.itens.some((i) => /Influência/.test(i.texto)));
  assert.match(d.aviso, /estilo de comportamento/);
  assert.match(d.aviso, /certo ou errado/);
  // Serializável e sem nada de empresa/vaga/aderência
  const json = JSON.stringify(d);
  assert.deepEqual(JSON.parse(json), d);
  assert.doesNotMatch(json, /vaga|aderência|nota final|empresa|liderança/i);
});

test('montar não altera DISC_DATA e funciona para todos os perfis', () => {
  const antes = JSON.stringify(DATA);
  const d = R.montar(REL, 'Ana', DATA);
  d.secoes[0].caracteristicas.push('X');
  d.secoes[4].itens[0].titulo = 'mudado';
  assert.equal(JSON.stringify(DATA), antes);
  assert.notEqual(R.montar(REL, 'Ana', DATA).secoes[4].itens[0].titulo, 'mudado');
  const letras = ['D', 'I', 'S', 'C'];
  letras.forEach((a) => letras.forEach((b) => {
    if (a === b) return;
    const p = { D: 10, I: 10, S: 10, C: 10 }; p[a] = 40; p[b] = 30; letras.filter((l) => l !== a && l !== b).forEach((l, k) => { p[l] = k ? 10 : 20; });
    const r = R.montar({ percentuais: p, codigo: a + b }, '', DATA);
    assert.equal(r.primario.letra, a);
    assert.equal(r.nome, '');
    r.secoes.forEach((s) => assert.ok(s.titulo && s.intro));
  }));
  // A partir de respostas reais
  const res = S.calcular(Array.from({ length: 25 }, () => ({ D: 4, I: 3, S: 2, C: 1 })));
  assert.equal(R.montar(R.dadosDoResultado(res.percentuais, res.codigo), 'José', DATA).codigo, 'DI');
});
