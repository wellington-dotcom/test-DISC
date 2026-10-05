'use strict';
// Nomes Notus das combinações DISC (js/disc-combinacoes.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const CB = require('../js/disc-combinacoes.js');

const LETRAS = ['D', 'I', 'S', 'C'];
const PROIBIDOS = ['Executor', 'Comunicador', 'Planejador', 'Analista', 'Inovador', 'Empreendedor', 'Comandante', 'Aconselhador',
  'Especialista', 'Protetor', 'Solucionador', 'Competidor', 'Articulador', 'Julgador', 'Organizador', 'Integrador', 'Influenciador',
  'Inventivo', 'Motivador', 'Vendedor', 'Diplomata', 'Atendente', 'Professoral', 'Técnico', 'Estrategista', 'Controlador', 'Administrador'];
const raiz = (n) => n.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/(or|ora|ista|ico|ivo|al|ata|ente)$/, '');
const SENSIVEIS = /(^|[^\p{L}])(sexo|idade|gênero|autoestima|cérebro|neuro\p{L}*|emociona\p{L}*|saúde|medo)([^\p{L}]|$)/iu;

test('16 códigos: 4 puros + 12 duplas, todos com nome, frase e descrição', () => {
  const esperado = LETRAS.slice();
  LETRAS.forEach((a) => LETRAS.forEach((b) => { if (a !== b) esperado.push(a + b); }));
  assert.deepEqual([...CB.CODIGOS].sort(), esperado.sort());
  assert.equal(CB.CODIGOS.length, 16);
  const nomes = new Set(), frases = new Set();
  CB.CODIGOS.forEach((c) => {
    const n = CB.nome(c);
    assert.deepEqual(Object.keys(n), ['codigo', 'nome', 'frase', 'descricao']);
    assert.equal(n.codigo, c);
    assert.ok(n.nome.length >= 4 && n.nome.length <= 20 && !/\s/.test(n.nome), 'nome curto, uma palavra: ' + n.nome);
    assert.ok(n.frase.endsWith('.') && n.frase.length < 90, n.frase);
    assert.ok(n.descricao.length > 120, c);
    nomes.add(n.nome); frases.add(n.frase);
    // A descrição cita os fatores certos (nomes técnicos).
    const nomesFator = { D: 'Dominância', I: 'Influência', S: 'Estabilidade', C: 'Conformidade' };
    c.split('').forEach((l) => assert.ok(n.descricao.includes(nomesFator[l]), c + ' cita ' + l));
    assert.doesNotMatch(n.nome + ' ' + n.frase + ' ' + n.descricao, SENSIVEIS);
  });
  assert.equal(nomes.size, 16, 'nomes distintos');
  assert.equal(frases.size, 16, 'frases distintas');
  assert.equal(CB.nome('di').nome, CB.nome('DI').nome);
  assert.equal(CB.nome('DD'), null);
  assert.equal(CB.nome('XY'), null);
  assert.equal(CB.nome(null), null);
  assert.equal(CB.nome('toString'), null);
});

test('nenhum nome do mercado (nem variação próxima)', () => {
  const raizes = PROIBIDOS.map(raiz);
  CB.CODIGOS.forEach((c) => {
    const n = CB.nome(c);
    const texto = (n.nome + ' ' + n.frase + ' ' + n.descricao).toLowerCase();
    PROIBIDOS.forEach((p) => assert.ok(!texto.includes(p.toLowerCase()), c + ' usa ' + p));
    assert.ok(!raizes.includes(raiz(n.nome)), c + ' parecido com nome do mercado: ' + n.nome);
  });
});

test('codigo/combinacao: dupla × puro (secundário fraco), ordem e entradas inválidas', () => {
  assert.equal(CB.codigo({ D: 34, I: 28, S: 20, C: 18 }), 'DI');
  assert.equal(CB.codigo({ D: 40, I: 21, S: 20, C: 19 }), 'D', 'secundário abaixo de 22');
  assert.equal(CB.codigo({ D: 38, I: 26, S: 18, C: 18 }), 'D', 'secundário 12 pontos abaixo');
  assert.equal(CB.codigo({ D: 37, I: 26, S: 19, C: 18 }), 'DI');
  assert.equal(CB.codigo({ D: 20, I: 22, S: 28, C: 30 }), 'CS');
  // Com o código do scoring (empates resolvidos por ele)
  assert.equal(CB.codigo({ D: 25, I: 25, S: 25, C: 25 }, 'SC'), 'SC');
  assert.equal(CB.codigo({ D: 25, I: 25, S: 25, C: 25 }), 'DI', 'empate: ordem D, I, S, C');
  assert.equal(CB.codigo(null), null);
  assert.equal(CB.codigo({ D: 30, I: 30, S: 30 }), null);
  const c = CB.combinacao({ D: 40, I: 21, S: 20, C: 19 }, 'DI');
  assert.deepEqual(c, Object.assign({ codigo: 'D', puro: true }, (({ nome, frase, descricao }) => ({ nome, frase, descricao }))(CB.nome('D'))));
  assert.equal(CB.combinacao({ D: 34, I: 28, S: 20, C: 18 }).puro, false);
  assert.equal(CB.combinacao(null), null);
  // Todos os 16 códigos são alcançáveis
  const vistos = new Set();
  LETRAS.forEach((a) => LETRAS.forEach((b) => {
    if (a === b) return;
    const forte = { D: 20, I: 20, S: 20, C: 20 }; forte[a] = 32; forte[b] = 28;
    const fraco = { D: 20, I: 20, S: 20, C: 20 }; fraco[a] = 40; fraco[b] = 20; LETRAS.filter((l) => l !== a && l !== b).forEach((l, i) => { fraco[l] = i ? 19 : 21; forte[l] = i ? 18 : 22; });
    vistos.add(CB.codigo(forte, a + b)); vistos.add(CB.codigo(fraco, a + b));
  }));
  assert.deepEqual([...vistos].sort(), [...CB.CODIGOS].sort());
});
