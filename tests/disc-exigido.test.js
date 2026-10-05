'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../js/disc-exigido.js');
const S = require('../js/scoring.js');
const DATA = require('../js/disc-data.js');
const COMPAT = require('../js/compatibilidade.js');
const { prng } = require('./helpers/fixtures.js');

const L = ['D', 'I', 'S', 'C'];
const PERMS = [];
(function gerar(pref, resto) {
  if (!resto.length) { PERMS.push(pref); return; }
  resto.forEach((n, i) => gerar(pref + n, resto.slice(0, i).concat(resto.slice(i + 1))));
})('', ['1', '2', '3', '4']);

function aleatorio(rnd) {
  let s = '';
  for (let i = 0; i < 10; i++) s += PERMS[Math.floor(rnd() * PERMS.length)];
  return s;
}
// Proibido nos textos: saúde/estado emocional, neurociência, rótulos de exclusão.
const PROIBIDOS = /estresse|estressad|saúde|saude|doen|burnout|esgota|ansied|sofri|adoec|emocional|cérebro|cerebr|reprov|demit|incapa/i;

test('GRUPOS: 10 índices fixos e válidos do DISC_DATA', () => {
  assert.deepEqual(E.GRUPOS, [0, 2, 5, 7, 10, 12, 15, 17, 20, 22]);
  assert.equal(E.TOTAL_GRUPOS, 10);
  E.GRUPOS.forEach((i) => L.forEach((l) => assert.ok(DATA.grupos[i][l], 'grupo ' + i)));
});

test('validar: aceita só 40 dígitos com permutações de 1..4', () => {
  assert.equal(E.validar('4321'.repeat(10)), true);
  assert.equal(E.validar(PERMS.slice(0, 10).join('')), true);
  [undefined, null, 123, '', '4321'.repeat(9), '4321'.repeat(11), '4321'.repeat(25),
    '4421' + '4321'.repeat(9), '4325' + '4321'.repeat(9), '4320' + '4321'.repeat(9),
    '1111'.repeat(10), '4321'.repeat(9) + '432a', ' ' + '4321'.repeat(10)
  ].forEach((s) => assert.equal(E.validar(s), false, String(s)));
  assert.throws(() => E.calcular('1111'.repeat(10)));
  assert.throws(() => E.calcular(''));
});

test('calcular: totais 10–40, percentuais = totais e soma 100; código com a regra do DISC_SCORING', () => {
  const r = E.calcular('4321'.repeat(10));
  assert.deepEqual(r.totais, { D: 40, I: 30, S: 20, C: 10 });
  assert.deepEqual(r.percentuais, r.totais);
  assert.equal(r.codigo, 'DI');
  assert.deepEqual(r.ordem, ['D', 'I', 'S', 'C']);
  assert.equal(E.calcular('1234'.repeat(10)).codigo, 'CS');
  const rnd = prng(7);
  for (let k = 0; k < 300; k++) {
    const s = aleatorio(rnd);
    const x = E.calcular(s);
    assert.equal(L.reduce((a, l) => a + x.percentuais[l], 0), 100);
    L.forEach((l) => assert.ok(x.totais[l] >= 10 && x.totais[l] <= 40));
    // mesma regra de ordenação/empate do DISC_SCORING (sort estável na ordem D, I, S, C)
    const ordemEsperada = L.slice().sort((a, b) => x.totais[b] - x.totais[a]);
    assert.equal(x.codigo, ordemEsperada[0] + ordemEsperada[1]);
  }
});

test('compactar/descompactar ida e volta', () => {
  const s = PERMS.slice(5, 15).join('');
  assert.equal(E.compactar(E.descompactar(s)), s);
  assert.throws(() => E.compactar([{ D: 1, I: 1, S: 2, C: 3 }]));
});

test('eixos: mesma convenção de js/compatibilidade.js (ritmo + acelerado, foco + tarefas)', () => {
  assert.deepEqual(E.eixos({ D: 40, I: 30, S: 20, C: 10 }), { ritmo: 40, foco: 0 });
  assert.deepEqual(E.eixos({ D: 40, I: 10, S: 20, C: 30 }), { ritmo: 0, foco: 40 });
  const s = E.eixos({ D: 10, I: 30, S: 40, C: 20 });
  assert.ok(s.ritmo < 0 && s.foco < 0, 'S/I = cauteloso e pessoas');
  const rnd = prng(3);
  for (let k = 0; k < 50; k++) {
    const p = E.calcular(aleatorio(rnd)).percentuais;
    const c = COMPAT.perfil(p);
    const e = E.eixos(p);
    assert.equal(e.ritmo, c.ritmo);
    assert.equal(e.foco, c.foco);
    assert.ok(Math.abs(e.ritmo) <= 100 && Math.abs(e.foco) <= 100);
  }
  assert.deepEqual(E.paraPessoas({ ritmo: 12, foco: 30 }), { ritmo: 12, foco: -30 });
  assert.deepEqual(E.eixos(null), { ritmo: 0, foco: 0 });
});

test('adaptacao: natural = exigido => índice 0, baixa, sem fator destacado', () => {
  const a = E.adaptacao({ D: 40, I: 30, S: 20, C: 10 }, '4321'.repeat(10));
  assert.equal(a.indice, 0);
  assert.equal(a.faixa, 'baixa');
  assert.equal(a.rotulo, 'Baixo');
  assert.equal(a.maisCobrado, null);
  assert.equal(a.menosUsado, null);
  assert.deepEqual(a.porFator, { D: 0, I: 0, S: 0, C: 0 });
  assert.deepEqual(a.eixos.natural, a.eixos.exigido);
});

test('adaptacao: faixas, porFator (exigido − natural), maisCobrado e menosUsado', () => {
  const nat = { D: 40, I: 30, S: 20, C: 10 };
  const casos = [
    [{ D: 36, I: 30, S: 20, C: 14 }, 4, 'baixa', 'C', 'D'],
    [{ D: 34, I: 26, S: 24, C: 16 }, 10, 'moderada', 'C', 'D'],
    [{ D: 25, I: 30, S: 20, C: 25 }, 15, 'moderada', 'C', 'D'],
    [{ D: 20, I: 25, S: 25, C: 30 }, 25, 'alta', 'C', 'D'],
    [{ D: 10, I: 20, S: 30, C: 40 }, 40, 'muito_alta', 'C', 'D'],
    [{ D: 40, I: 10, S: 40, C: 10 }, 20, 'alta', 'S', 'I']
  ];
  casos.forEach(([ex, indice, faixa, mais, menos]) => {
    const a = E.adaptacao(nat, ex);
    assert.equal(a.indice, indice, JSON.stringify(ex));
    assert.equal(a.faixa, faixa, JSON.stringify(ex));
    assert.equal(a.maisCobrado, mais);
    assert.equal(a.menosUsado, menos);
    L.forEach((l) => assert.equal(a.porFator[l], ex[l] - nat[l]));
  });
  assert.equal(E.faixa(9), 'baixa');
  assert.equal(E.faixa(10), 'moderada');
  assert.equal(E.faixa(19), 'moderada');
  assert.equal(E.faixa(20), 'alta');
  assert.equal(E.faixa(29), 'alta');
  assert.equal(E.faixa(30), 'muito_alta');
  // diferença menor que 3 pontos não vira "mais cobrado"
  const leve = E.adaptacao(nat, { D: 38, I: 32, S: 20, C: 10 });
  assert.equal(leve.maisCobrado, null);
  assert.equal(leve.menosUsado, null);
});

test('adaptacao: aceita string natural de 100 dígitos, resultado {percentuais} e devolve null sem dados', () => {
  const nat = S.compactar(Array.from({ length: 25 }, () => ({ D: 4, I: 3, S: 2, C: 1 })));
  const a = E.adaptacao(nat, '1234'.repeat(10));
  assert.equal(a.indice, 40);
  assert.equal(a.maisCobrado, 'C');
  assert.equal(a.menosUsado, 'D');
  assert.ok(a.eixos.natural.ritmo > 0 && a.eixos.exigido.ritmo < 0);
  assert.equal(E.adaptacao({ percentuais: { D: 40, I: 30, S: 20, C: 10 } }, E.calcular('4321'.repeat(10))).indice, 0);
  assert.equal(E.adaptacao(null, '4321'.repeat(10)), null);
  assert.equal(E.adaptacao({ D: 40, I: 30, S: 20, C: 10 }, ''), null);
  assert.equal(E.adaptacao({ D: 40, I: 30, S: 20, C: 10 }, '1111'.repeat(10)), null);
});

test('calibração: só ruído (mesma preferência com respostas aleatórias) fica quase sempre em baixa', () => {
  const rnd = prng(11);
  let baixa = 0;
  const N = 400;
  for (let k = 0; k < N; k++) {
    const nat = S.calcular(S.descompactar(Array.from({ length: 25 }, () => PERMS[Math.floor(rnd() * 24)]).join(''))).percentuais;
    const a = E.adaptacao(nat, aleatorio(rnd));
    assert.ok(a.indice >= 0 && a.indice <= 100);
    if (a.faixa === 'baixa') baixa++;
  }
  assert.ok(baixa / N > 0.6, 'baixa em ' + baixa + ' de ' + N);
});

test('textos: pessoa em 2ª pessoa, líder com o nome, sem saúde/estado emocional', () => {
  const nat = { D: 40, I: 30, S: 20, C: 10 };
  const exs = ['1234'.repeat(10), '4321'.repeat(10), { D: 10, I: 40, S: 30, C: 20 }, { D: 25, I: 10, S: 25, C: 40 },
    { D: 40, I: 10, S: 40, C: 10 }, { D: 34, I: 26, S: 24, C: 16 }];
  exs.forEach((ex) => {
    const a = E.adaptacao(nat, ex, { nome: 'Ana P.' });
    assert.ok(a.textos.pessoa.length >= 2 && a.textos.lider.length === a.textos.pessoa.length);
    a.textos.pessoa.concat(a.textos.lider).forEach((t) => {
      assert.equal(typeof t, 'string');
      assert.ok(t.trim());
      assert.ok(!PROIBIDOS.test(t), t);
      assert.ok(!/\{nome\}|undefined|null|NaN|\.\./.test(t), t);
    });
    assert.ok(a.textos.lider.some((t) => t.includes('Ana P.')));
    assert.ok(a.textos.pessoa.some((t) => /\bvocê\b|\bseu\b|\bsua\b/.test(t)));
  });
  const sem = E.adaptacao(nat, '1234'.repeat(10));
  sem.textos.lider.forEach((t) => assert.ok(!/de esta pessoa|\{nome\}/.test(t), t));
  const forte = E.adaptacao(nat, '1234'.repeat(10));
  assert.ok(forte.textos.pessoa.some((t) => /Conformidade/.test(t)));
  assert.ok(forte.textos.pessoa.some((t) => /Dominância/.test(t)));
  assert.ok(forte.textos.pessoa.some((t) => /cauteloso/.test(t)));
});

test('determinístico e serializável', () => {
  const a = E.adaptacao({ D: 22, I: 31, S: 29, C: 18 }, PERMS.slice(3, 13).join(''), { nome: 'Rui' });
  const b = E.adaptacao({ D: 22, I: 31, S: 29, C: 18 }, PERMS.slice(3, 13).join(''), { nome: 'Rui' });
  assert.deepEqual(a, b);
  assert.deepEqual(JSON.parse(JSON.stringify(a)), a);
});
