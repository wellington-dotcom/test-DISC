'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/confiabilidade.js');
const S = require('../js/scoring.js');
const { respostasFixas } = require('./helpers/fixtures.js');

const PROIBIDOS = /\bdisc\b|dominân|influên|estabilid|conformid|ótim|melhor|pior/i;
// Resultado bem definido: D=40%, I=30%, S=20%, C=10% (ordem D, I, S, C).
const RESP = S.compactar(respostasFixas(['D', 'I', 'S', 'C']));

function validacao(extra) {
  return Object.assign({
    versao: 1,
    pares: [['C', 'D'], ['I', 'S'], ['S', 'D']],
    escolhas: ['D', 'I', 'D'],
    itens: [
      { id: 'D-f1', letra: 'D', tipo: 'forca', nota: 5 },
      { id: 'D-s1', letra: 'D', tipo: 'sombra', nota: 4 },
      { id: 'I-f2', letra: 'I', tipo: 'forca', nota: 4 },
      { id: 'C-f1', letra: 'C', tipo: 'contraste', nota: 2 }
    ],
    gruposSeg: Array(25).fill(12),
    semMexer: 2,
    demonstracao: false
  }, extra || {});
}
function comNota(v, tipo, letra, nota) {
  v.itens = v.itens.map((it) => (it.tipo === tipo && it.letra === letra ? Object.assign({}, it, { nota }) : it));
  return v;
}

test('participante coerente => alta, sem alertas', () => {
  const r = C.avaliar(RESP, validacao());
  assert.equal(r.nivel, 'alta');
  assert.equal(r.detalhes.acertos, 3);
  assert.equal(r.detalhes.coerente, true);
  assert.deepEqual(r.detalhes.alertasFortes, []);
  assert.deepEqual(r.detalhes.alertasLeves, []);
  assert.ok(r.pontos >= 80 && r.pontos <= 100);
  assert.ok(r.motivos.length >= 1);
});

test('escolheu retratos opostos ao resultado => baixa', () => {
  const r = C.avaliar(RESP, validacao({ escolhas: ['C', 'S', 'S'] }));
  assert.equal(r.detalhes.acertos, 0);
  assert.equal(r.nivel, 'baixa');
  assert.ok(r.motivos.some((m) => /retratos/.test(m)));
  assert.ok(r.pontos < 50);
});

test('um acerto só já é baixa; dois acertos ainda podem ser alta', () => {
  assert.equal(C.avaliar(RESP, validacao({ escolhas: ['D', 'S', 'S'] })).nivel, 'baixa');
  assert.equal(C.avaliar(RESP, validacao({ escolhas: ['D', 'S', 'D'] })).nivel, 'alta');
});

test('rápido demais => alerta forte com a contagem de grupos', () => {
  const seg = Array(25).fill(10);
  for (let i = 0; i < 10; i++) seg[i] = 2;
  const r = C.avaliar(RESP, validacao({ gruposSeg: seg }));
  assert.equal(r.detalhes.rapidos, 10);
  assert.ok(r.detalhes.alertasFortes.some((m) => m.includes('10 grupos em menos de 3 segundos')));
  assert.equal(r.nivel, 'media');
  // até 30% não alerta
  const ok = Array(25).fill(10);
  for (let i = 0; i < 7; i++) ok[i] = 1;
  assert.equal(C.avaliar(RESP, validacao({ gruposSeg: ok })).detalhes.alertasFortes.length, 0);
});

test('rápido demais + frase oposta => 2 alertas fortes => baixa', () => {
  const seg = Array(25).fill(1);
  let v = validacao({ gruposSeg: seg });
  v = comNota(v, 'contraste', 'C', 5);
  v = comNota(v, 'forca', 'D', 1);
  const r = C.avaliar(RESP, v);
  assert.equal(r.detalhes.incoerente, true);
  assert.equal(r.detalhes.alertasFortes.length, 2);
  assert.equal(r.nivel, 'baixa');
});

test('semMexer alto => alerta', () => {
  const r = C.avaliar(RESP, validacao({ semMexer: 20 }));
  assert.ok(r.detalhes.alertasLeves.some((m) => /sem mexer em 20 grupos/.test(m)));
  assert.equal(r.nivel, 'alta'); // um alerta leve só ainda é alta
  assert.equal(C.avaliar(RESP, validacao({ semMexer: 12 })).detalhes.alertasLeves.length, 0);
});

test('perfil achatado => alerta "perfil pouco definido"', () => {
  // 24 grupos em rodízio (todas as letras empatam em 60) + 1 grupo D>I>S>C => 25,6 / 25,2 / 24,8 / 24,4
  const rod = [['D', 'I', 'S', 'C'], ['I', 'S', 'C', 'D'], ['S', 'C', 'D', 'I'], ['C', 'D', 'I', 'S']];
  const resp = [];
  for (let i = 0; i < 24; i++) {
    const g = {};
    rod[i % 4].forEach((l, j) => { g[l] = 4 - j; });
    resp.push(g);
  }
  resp.push({ D: 4, I: 3, S: 2, C: 1 });
  const r = C.avaliar(S.compactar(resp), validacao());
  assert.ok(r.detalhes.amplitude < 8);
  assert.ok(r.detalhes.alertasLeves.some((m) => /pouco definido/i.test(m)));
});

test('só aceita a força e nega a sombra => alerta leve', () => {
  const v = comNota(validacao(), 'sombra', 'D', 1);
  const r = C.avaliar(RESP, v);
  assert.equal(r.detalhes.soPositivo, true);
  assert.ok(r.detalhes.alertasLeves.some((m) => /lado positivo/.test(m)));
  assert.deepEqual(r.detalhes.alertasFortes, []);
  assert.equal(r.nivel, 'alta');
  // somado a outro alerta leve vira média
  assert.equal(C.avaliar(RESP, Object.assign(v, { semMexer: 20 })).nivel, 'media');
});

test('payload sem validacao => indisponivel', () => {
  [undefined, null, {}, 'x'].forEach((v) => {
    const r = C.avaliar(RESP, v);
    assert.equal(r.nivel, 'indisponivel');
    assert.equal(r.motivos.length, 1);
  });
  assert.equal(C.avaliar('123', validacao()).nivel, 'indisponivel');
});

test('demonstração => motivo "modo demonstração"', () => {
  const seg = Array(25).fill(0);
  for (let i = 0; i < 5; i++) seg[i] = 8;
  const r = C.avaliar(RESP, validacao({ demonstracao: true, gruposSeg: seg, semMexer: 1 }));
  assert.ok(r.motivos.some((m) => /modo demonstração/.test(m)));
  assert.equal(r.detalhes.respondidos, 5);
  assert.equal(C.avaliar(RESP, validacao()).motivos.some((m) => /demonstração/.test(m)), false);
});

test('textos dos motivos sem termos proibidos e pontos sempre entre 0 e 100', () => {
  const casos = [validacao(), validacao({ escolhas: ['C', 'S', 'S'], gruposSeg: Array(25).fill(1), semMexer: 25, demonstracao: true })];
  casos.forEach((v) => {
    const r = C.avaliar(RESP, v);
    assert.ok(r.pontos >= 0 && r.pontos <= 100);
    r.motivos.forEach((m) => assert.ok(!PROIBIDOS.test(m), m));
  });
});

// ---- Rodada 3: novos sinais ----
function respDe(grupos) {
  // grupos: lista de [letras em ordem de preferência, quantidade]
  const out = [];
  grupos.forEach(([ordem, n]) => {
    for (let i = 0; i < n; i++) {
      const g = {};
      ordem.forEach((l, j) => { g[l] = 4 - j; });
      out.push(g);
    }
  });
  return S.compactar(out);
}

test('perfil achatado também quando todos os fatores ficam entre 20% e 30% (um só alerta)', () => {
  // 9 grupos I>D>C>S e 16 grupos S>C>D>I => D 23,6 · I 20,8 · S 29,2 · C 26,4 (amplitude 8,4: só a regra 20–30 pega)
  const resp = respDe([[['I', 'D', 'C', 'S'], 9], [['S', 'C', 'D', 'I'], 16]]);
  const r = C.avaliar(resp, validacao({ pares: [['S', 'D'], ['C', 'I'], ['S', 'I']], escolhas: ['S', 'C', 'S'] }));
  const p = S.calcular(S.descompactar(resp)).percentuais;
  assert.ok(['D', 'I', 'S', 'C'].every((l) => p[l] >= 20 && p[l] <= 30), JSON.stringify(p));
  assert.ok(r.detalhes.amplitude >= 8);
  assert.equal(r.detalhes.achatado, true);
  assert.equal(r.detalhes.alertasLeves.filter((m) => /pouco definido/.test(m)).length, 1);
  assert.equal(C.avaliar(RESP, validacao()).detalhes.achatado, false);
});

test('fatores opostos altos (D e S, I e C) => alerta leve para conversar, não de fraude', () => {
  // D>S>I>C e S>D>C>I alternados => D 35, S 35, I 15, C 15
  const ds = respDe([[['D', 'S', 'I', 'C'], 13], [['S', 'D', 'C', 'I'], 12]]);
  const r = C.avaliar(ds, validacao({ pares: [['D', 'C'], ['S', 'I'], ['D', 'I']], escolhas: ['D', 'S', 'D'] }));
  assert.deepEqual(r.detalhes.opostos, ['DS']);
  const msg = r.detalhes.alertasLeves.find((m) => /opostos/.test(m));
  assert.ok(msg, 'sem alerta de opostos');
  assert.match(msg, /conversar/);
  assert.ok(!/fraude|mentir|falso|engan/i.test(msg));
  assert.ok(!PROIBIDOS.test(msg), msg);
  assert.deepEqual(r.detalhes.alertasFortes, []);
  assert.equal(r.nivel, 'alta'); // um leve só não derruba o selo
  // I e C
  const ic = respDe([[['I', 'C', 'D', 'S'], 13], [['C', 'I', 'S', 'D'], 12]]);
  assert.deepEqual(C.avaliar(ic, validacao()).detalhes.opostos, ['IC']);
  // perfil comum não acusa
  assert.deepEqual(C.avaliar(RESP, validacao()).detalhes.opostos, []);
});

test('tempo total: < 4 min ou > 30 min => alerta leve; fonte opcoes > validacao > soma dos grupos', () => {
  const base = C.avaliar(RESP, validacao(), { duracaoSeg: 600 });
  assert.equal(base.detalhes.tempo, null);
  assert.equal(base.detalhes.duracaoSeg, 600);
  assert.equal(base.detalhes.tempoFonte, 'payload');

  const curto = C.avaliar(RESP, validacao(), { duracaoSeg: 180 });
  assert.equal(curto.detalhes.tempo, 'curto');
  assert.ok(curto.detalhes.alertasLeves.some((m) => /cerca de 3 minutos/.test(m)));
  assert.ok(curto.pontos < base.pontos);

  const longo = C.avaliar(RESP, validacao({ duracaoSeg: 2400 }));
  assert.equal(longo.detalhes.tempoFonte, 'validacao');
  assert.equal(longo.detalhes.tempo, 'longo');
  assert.ok(longo.detalhes.alertasLeves.some((m) => /40 minutos/.test(m) && /interrup/.test(m)));

  // sem duração explícita: soma dos 25 grupos (só vale para o limite inferior)
  const soma = C.avaliar(RESP, validacao({ gruposSeg: Array(25).fill(5) }));
  assert.equal(soma.detalhes.tempoFonte, 'grupos');
  assert.equal(soma.detalhes.duracaoSeg, 125);
  assert.equal(soma.detalhes.tempo, 'curto');
  assert.equal(C.avaliar(RESP, validacao({ gruposSeg: Array(25).fill(100) })).detalhes.tempo, null);

  // demonstração ignora o tempo; sem nenhum dado de tempo, nada muda
  assert.equal(C.avaliar(RESP, validacao({ demonstracao: true }), { duracaoSeg: 30 }).detalhes.tempo, null);
  const semTempo = C.avaliar(RESP, validacao({ gruposSeg: [] }));
  assert.equal(semTempo.detalhes.duracaoSeg, null);
  assert.equal(semTempo.detalhes.tempo, null);
});

test('novos sinais somam ao selo: dois leves novos derrubam de alta para média', () => {
  const ds = respDe([[['D', 'S', 'I', 'C'], 13], [['S', 'D', 'C', 'I'], 12]]);
  const v = validacao({ pares: [['D', 'C'], ['S', 'I'], ['D', 'I']], escolhas: ['D', 'S', 'D'] });
  assert.equal(C.avaliar(ds, v, { duracaoSeg: 600 }).nivel, 'alta');
  assert.equal(C.avaliar(ds, v, { duracaoSeg: 120 }).nivel, 'media');
});

test('passiva (venda direta, sem confirmação): alta só com tempo por grupo e sem alertas; sem tempo por grupo, no máximo média', () => {
  const seg = Array(25).fill(12);
  const alta = C.avaliar(RESP, { versao: 1, passiva: true, gruposSeg: seg, semMexer: 2 }, { duracaoSeg: 420 });
  assert.equal(alta.nivel, 'alta');
  assert.equal(alta.detalhes.passiva, true);
  assert.ok(alta.motivos.some((m) => /sem a etapa de confirmação/.test(m)));
  // Respostas antigas da venda direta (validacao null): avaliação parcial, nunca "Sem dados", no máximo média.
  const antiga = C.avaliar(RESP, null, { duracaoSeg: 420, passiva: true });
  assert.equal(antiga.nivel, 'media');
  assert.ok(antiga.motivos.some((m) => /parcial/.test(m)));
  // Rapidez (forte) + tempo curto (leve) = baixa.
  const baixa = C.avaliar(RESP, { passiva: true, gruposSeg: Array(25).fill(1.5), semMexer: 0 }, { duracaoSeg: 60 });
  assert.equal(baixa.nivel, 'baixa');
  // Um alerta leve só (sem mexer na ordem) = média.
  assert.equal(C.avaliar(RESP, { passiva: true, gruposSeg: seg, semMexer: 20 }, { duracaoSeg: 420 }).nivel, 'media');
  for (const r of [alta, antiga, baixa]) for (const m of r.motivos) assert.ok(!PROIBIDOS.test(m), m);
  // Sem a marca "passiva", o comportamento antigo continua: sem confirmação = sem dados.
  assert.equal(C.avaliar(RESP, null).nivel, 'indisponivel');
});
