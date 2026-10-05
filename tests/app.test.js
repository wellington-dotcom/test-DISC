'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../js/app.js');
const S = require('../js/scoring.js');
const { prng } = require('./helpers/fixtures.js');

test('validarNome', () => {
  assert.equal(A.validarNome('João da Silva'), '');
  assert.equal(A.validarNome('  Ana   Lú '), '');
  assert.notEqual(A.validarNome(''), '');
  assert.notEqual(A.validarNome('Joãozinho'), '');
  assert.notEqual(A.validarNome('Jo Li'), '', 'menos de 5 letras');
  assert.notEqual(A.validarNome('João 123'), '');
  assert.equal(A.normalizarNome('  Maria   Clara  '), 'Maria Clara');
});

test('validarTelefone / limpar / formatar / salvar', () => {
  assert.equal(A.validarTelefone('(11) 99999-8888'), '');
  assert.equal(A.validarTelefone('1133334444'), '');
  assert.equal(A.validarTelefone('+55 11 99999-8888'), '');
  assert.notEqual(A.validarTelefone(''), '');
  assert.notEqual(A.validarTelefone('99999-8888'), '');
  assert.notEqual(A.validarTelefone('(01) 99999-8888'), '');
  assert.notEqual(A.validarTelefone('(11) 89999-8888'), '', '11 dígitos sem 9');
  assert.equal(A.limparTelefone('+55 (11) 99999-8888'), '11999998888');
  assert.equal(A.formatarTelefone('11999998888'), '(11) 99999-8888');
  assert.equal(A.formatarTelefone('1133334444'), '(11) 3333-4444');
  assert.equal(A.formatarTelefone('11'), '(11');
  assert.equal(A.telefoneParaSalvar('(11) 99999-8888'), '5511999998888');
});

test('ordemParaGrupo: topo recebe 4, base recebe 1', () => {
  assert.deepEqual(A.ordemParaGrupo(['S', 'C', 'D', 'I']), { S: 4, C: 3, D: 2, I: 1 });
  assert.equal(A.ordemParaGrupo(['D']), null);
  assert.equal(A.ordemParaGrupo(['D', 'D', 'S', 'C']), null, 'letra repetida');
  assert.equal(A.ordemParaGrupo(null), null);
  assert.equal(A.ordemValida(['C', 'S', 'I', 'D']), true);
  assert.equal(A.ordemValida(['C', 'S', 'I', 'X']), false);
});

test('mover: reposiciona sem alterar a lista original', () => {
  const o = ['D', 'I', 'S', 'C'];
  assert.deepEqual(A.mover(o, 3, 0), ['C', 'D', 'I', 'S']);
  assert.deepEqual(A.mover(o, 0, 2), ['I', 'S', 'D', 'C']);
  assert.deepEqual(A.mover(o, 1, 2), ['D', 'S', 'I', 'C']);
  assert.deepEqual(A.mover(o, 2, 2), o);
  assert.deepEqual(A.mover(o, 0, -5), o, 'limita no topo');
  assert.deepEqual(A.mover(o, 1, 99), ['D', 'S', 'C', 'I'], 'limita na base');
  assert.deepEqual(A.mover(o, 7, 0), o, 'origem inválida');
  assert.deepEqual(o, ['D', 'I', 'S', 'C']);
});

test('migrarProgresso: converte o formato antigo e valida o novo', () => {
  const antigo = { nome: 'Ana Lima', grupo: 2, selecoes: [['S', 'C', 'I', 'D'], ['D'], []] };
  const m = A.migrarProgresso(antigo);
  assert.equal(m.selecoes, undefined);
  assert.equal(m.nome, 'Ana Lima');
  assert.equal(m.ordens.length, 25);
  assert.deepEqual(m.ordens[0], ['S', 'C', 'I', 'D']);
  assert.equal(m.respondidos[0], true);
  assert.equal(m.ordens[1], null);
  assert.equal(m.respondidos[1], false);
  const novo = A.migrarProgresso({ ordens: [['D', 'I', 'S', 'C'], ['C', 'S', 'I', 'D']], respondidos: [false, true] });
  assert.deepEqual(novo.respondidos.slice(0, 3), [false, true, false]);
  assert.deepEqual(novo.ordens[0], ['D', 'I', 'S', 'C'], 'ordem mexida mas não confirmada fica guardada');
});

test('gerarPermutacoes: 25 permutações das 4 letras', () => {
  const p = A.gerarPermutacoes(prng(1));
  assert.equal(p.length, 25);
  p.forEach((g) => assert.deepEqual(g.slice().sort(), ['C', 'D', 'I', 'S']));
  const distintas = new Set(p.map((g) => g.join(''))).size;
  assert.ok(distintas > 1, 'deve embaralhar');
});

test('gerarId é único e compatível com o backend', () => {
  const ids = new Set();
  for (let i = 0; i < 200; i++) {
    const id = A.gerarId();
    assert.match(id, /^[A-Za-z0-9_-]{6,64}$/);
    ids.add(id);
  }
  assert.equal(ids.size, 200);
});

test('montarPayload segue o contrato do SPEC', () => {
  const sel = [];
  for (let i = 0; i < 25; i++) sel.push(['C', 'S', 'I', 'D']);
  const fim = new Date('2026-10-01T12:10:00Z');
  const p = A.montarPayload({ id: 'abc123-x', nome: ' Maria  Souza ', telefone: '11999998888', vaga: ' Caixa ',
    consentimento: true, inicio: '2026-10-01T12:00:00Z' }, sel, fim);
  assert.equal(p.v, 1);
  assert.equal(p.nome, 'Maria Souza');
  assert.equal(p.telefone, '5511999998888');
  assert.equal(p.vaga, 'Caixa');
  assert.equal(p.consentimento, true);
  assert.equal(p.duracaoSeg, 600);
  assert.equal(p.respostas, '1234'.repeat(25));
  assert.deepEqual(p.resultado, { percentuais: S.calcular(S.descompactar(p.respostas)).percentuais, codigo: 'CS' });
});

test('escapar', () => {
  assert.equal(A.escapar('<a href="x">\'&'), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
});

test('telefone: celular truncado com 10 dígitos é recusado', () => {
  assert.notEqual(A.validarTelefone('+55 11 99999-888'), '');
  assert.match(A.validarTelefone('(11) 9999-9888'), /9 dígitos/);
  assert.equal(A.validarTelefone('(21) 3333-4444'), '');
});

test('perguntas do candidato cobrem os 25 grupos e corrigem textos da planilha', () => {
  const D = require('../js/disc-data.js');
  assert.equal(A.PERGUNTAS.length, 25);
  D.grupos.forEach((g, i) => {
    const q = A.perguntaDoGrupo(i, g);
    assert.ok(q.trim());
    assert.ok(!/\.{4}|desse perfil|esse estilo|Ponto cego|subalternos|Mensura/.test(q), q);
  });
  assert.equal(A.palavraDoGrupo(19, D.grupos[19], 'I'), 'Relacionadas a pessoas');
  assert.equal(A.palavraDoGrupo(0, D.grupos[0], 'D'), D.grupos[0].D);
});

test('mensagemErroEnvio esconde erros técnicos e mantém os de conexão', () => {
  assert.match(A.mensagemErroEnvio('Resposta inesperada do servidor. Confira se a URL do Apps Script está correta'), /Gerar código de resultado/);
  assert.match(A.mensagemErroEnvio('O endereço do servidor (API_URL) não está configurado.'), /Gerar código de resultado/);
  assert.match(A.mensagemErroEnvio('Não foi possível conectar ao servidor. Verifique sua conexão'), /conexão/);
});

test('progressoExpirado: vence após 7 dias', () => {
  const agora = Date.parse('2026-10-10T12:00:00Z');
  assert.equal(A.progressoExpirado({ salvoEm: '2026-10-09T12:00:00Z' }, agora), false);
  assert.equal(A.progressoExpirado({ salvoEm: '2026-10-01T12:00:00Z' }, agora), true);
  assert.equal(A.progressoExpirado({ inicio: '2026-10-08T12:00:00Z' }, agora), false);
  assert.equal(A.progressoExpirado({ nome: 'Sem Data' }, agora), true);
});
