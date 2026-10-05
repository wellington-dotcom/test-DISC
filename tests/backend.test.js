'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarGas } = require('./helpers/gas.js');
const S = require('../js/scoring.js');
const { payloadValido, respostasAleatorias, respostasFixas, prng } = require('./helpers/fixtures.js');

const CHAVE = 'chave-secreta-de-teste-1234567890abcdef';

function novo() { return carregarGas({ props: { ADMIN_KEY: CHAVE } }); }

test('doGet responde saúde em JSON', () => {
  const { g } = novo();
  const r = g.doGet();
  assert.equal(r.mime, 'application/json');
  assert.deepEqual(JSON.parse(r.conteudo), { ok: true, servico: 'DISC' });
});

test('enviar grava linha com cabeçalho e resultado recalculado (ignora resultado do navegador)', () => {
  const ctx = novo();
  const p = payloadValido({ resultado: { percentuais: { D: 1, I: 1, S: 1, C: 97 }, codigo: 'CS' } });
  const r = ctx.post({ acao: 'enviar', payload: p });
  assert.equal(r.ok, true, r.erro);
  assert.equal(r.id, p.id);
  const aba = ctx.aba();
  assert.ok(aba, 'aba Respostas criada');
  const cab = aba.linhas[0];
  assert.deepEqual(cab, ['id', 'recebidoEm', 'nome', 'telefone', 'vaga', 'inicio', 'fim', 'duracaoSeg',
    'respostas', 'D', 'I', 'S', 'C', 'perfil', 'status', 'observacoes', 'payloadJson']);
  assert.equal(aba.linhas.length, 2);
  const linha = aba.linhas[1];
  const col = (n) => linha[cab.indexOf(n)];
  assert.equal(col('id'), p.id);
  assert.equal(col('nome'), 'João da Silva');
  assert.equal(String(col('telefone')).replace(/^'/, ''), '5511999998888');
  assert.equal(String(col('respostas')).replace(/^'/, ''), p.respostas);
  assert.equal(col('D'), 40);
  assert.equal(col('C'), 10);
  assert.equal(col('perfil'), 'DI');
  assert.equal(col('status'), 'em_analise');
});

test('enviar normaliza telefone de 11 dígitos para 55 + número', () => {
  const ctx = novo();
  const r = ctx.post({ acao: 'enviar', payload: payloadValido({ telefone: '(21) 98888-7777' }) });
  assert.equal(r.ok, true, r.erro);
  const l = ctx.post({ acao: 'listar', chave: CHAVE });
  assert.equal(l.itens[0].telefone, '5521988887777');
});

test('id duplicado responde ok + duplicado sem gravar de novo', () => {
  const ctx = novo();
  const p = payloadValido();
  assert.equal(ctx.post({ acao: 'enviar', payload: p }).ok, true);
  const r2 = ctx.post({ acao: 'enviar', payload: p });
  assert.equal(r2.ok, true);
  assert.equal(r2.duplicado, true);
  assert.equal(ctx.aba().linhas.length, 2);
});

test('enviar rejeita payloads inválidos', () => {
  const ctx = novo();
  const casos = [
    [{ respostas: '4321'.repeat(24) }, /respostas/i],
    [{ respostas: '4421'.repeat(25) }, /respostas/i],
    [{ respostas: '5321'.repeat(25) }, /respostas/i],
    [{ nome: 'Jo' }, /nome/i],
    [{ nome: 'Joãozinho' }, /nome/i],
    [{ telefone: '1234' }, /telefone/i],
    [{ consentimento: false }, /aceitar|consent/i],
    [{ consentimento: 'true' }, /aceitar|consent/i],
    [{ id: 'a b' }, /identificador/i],
    [{ id: '' }, /identificador/i]
  ];
  casos.forEach(([extra, re]) => {
    const r = ctx.post({ acao: 'enviar', payload: payloadValido(extra) });
    assert.equal(r.ok, false, JSON.stringify(extra));
    assert.match(r.erro, re, JSON.stringify(extra));
  });
  assert.equal(ctx.post({ acao: 'enviar' }).ok, false);
  assert.equal(ctx.aba() ? ctx.aba().linhas.length <= 1 : true, true, 'nada gravado');
});

test('requisições malformadas', () => {
  const ctx = novo();
  assert.match(ctx.post('não é json').erro, /JSON/);
  assert.match(ctx.post('').erro, /vazia/);
  assert.match(ctx.post('[1,2]').erro, /inválido/);
  assert.match(ctx.post({ acao: 'hackear' }).erro, /desconhecida/);
  assert.match(ctx.post('x'.repeat(30000)).erro, /grande/);
  const semPost = JSON.parse(ctx.g.doPost(undefined).conteudo);
  assert.equal(semPost.ok, false);
});

test('injeção de fórmula: nome, vaga e observações começando com = + - @ ficam como texto', () => {
  const ctx = novo();
  const p = payloadValido({ nome: '=HYPERLINK("http://x") Silva', vaga: '+SUM(A1:A2)' });
  const r = ctx.post({ acao: 'enviar', payload: p });
  assert.equal(r.ok, true, r.erro);
  const aba = ctx.aba();
  const cab = aba.linhas[0];
  const linha = aba.linhas[1];
  linha.forEach((v, i) => {
    if (typeof v === 'string') assert.ok(!/^[=+\-@]/.test(v), 'célula ' + cab[i] + ' começa com fórmula: ' + v);
  });
  assert.equal(linha[cab.indexOf('nome')].charAt(0), "'");
  assert.equal(linha[cab.indexOf('vaga')].charAt(0), "'");

  const up = ctx.post({ acao: 'atualizar', chave: CHAVE, id: p.id, campos: { observacoes: '@cmd|calc' } });
  assert.equal(up.ok, true, up.erro);
  assert.equal(aba.linhas[1][cab.indexOf('observacoes')], "'@cmd|calc");

  // Na leitura o apóstrofo é removido.
  const item = ctx.post({ acao: 'listar', chave: CHAVE }).itens[0];
  assert.equal(item.nome, '=HYPERLINK("http://x") Silva');
  assert.equal(item.vaga, '+SUM(A1:A2)');
  assert.equal(item.observacoes, '@cmd|calc');
});

test('protegerCelula / forcarTexto', () => {
  const { g } = novo();
  assert.equal(g.protegerCelula('=1+1'), "'=1+1");
  assert.equal(g.protegerCelula('-5'), "'-5");
  assert.equal(g.protegerCelula('Maria'), 'Maria');
  assert.equal(g.protegerCelula(10), 10);
  assert.equal(g.forcarTexto('5511999998888'), "'5511999998888");
  assert.equal(g.forcarTexto('Maria'), 'Maria');
});

test('listar devolve itens com payload + status + observacoes + recebidoEm', () => {
  const ctx = novo();
  const p1 = payloadValido({ id: 'id-um-000001' });
  const p2 = payloadValido({ id: 'id-dois-00002', nome: 'Ana Paula Reis', respostas: S.compactar(respostasFixas(['S', 'C', 'I', 'D'])) });
  ctx.post({ acao: 'enviar', payload: p1 });
  ctx.post({ acao: 'enviar', payload: p2 });
  const r = ctx.post({ acao: 'listar', chave: CHAVE });
  assert.equal(r.ok, true, r.erro);
  assert.equal(r.itens.length, 2);
  const b = r.itens.find((i) => i.id === 'id-dois-00002');
  assert.equal(b.nome, 'Ana Paula Reis');
  assert.equal(b.respostas, p2.respostas);
  assert.match(b.respostas, /^[1-4]{100}$/);
  assert.equal(b.status, 'em_analise');
  assert.equal(b.observacoes, '');
  assert.ok(b.recebidoEm && !isNaN(Date.parse(b.recebidoEm)));
  assert.equal(b.resultado.codigo, 'SC');
  assert.equal(b.consentimento, true);
  assert.equal(b.duracaoSeg, 600);
  assert.ok(JSON.stringify(r).indexOf(CHAVE) === -1, 'nunca devolve a chave');
});

test('listar vazio', () => {
  const ctx = novo();
  const r = ctx.post({ acao: 'listar', chave: CHAVE });
  assert.deepEqual(r, { ok: true, itens: [] });
});

test('atualizar status e observações', () => {
  const ctx = novo();
  const p = payloadValido();
  ctx.post({ acao: 'enviar', payload: p });
  let r = ctx.post({ acao: 'atualizar', chave: CHAVE, id: p.id, campos: { status: 'aprovado', observacoes: 'Boa entrevista.\nContratar.' } });
  assert.equal(r.ok, true, r.erro);
  let item = ctx.post({ acao: 'listar', chave: CHAVE }).itens[0];
  assert.equal(item.status, 'aprovado');
  assert.equal(item.observacoes, 'Boa entrevista.\nContratar.');

  r = ctx.post({ acao: 'atualizar', chave: CHAVE, id: p.id, campos: { status: 'contratado' } });
  assert.equal(r.ok, false);
  assert.match(r.erro, /Status inválido/);
  r = ctx.post({ acao: 'atualizar', chave: CHAVE, id: 'nao-existe-123', campos: { status: 'reprovado' } });
  assert.equal(r.ok, false);
  assert.match(r.erro, /não encontrado/);
  r = ctx.post({ acao: 'atualizar', chave: CHAVE, id: p.id, campos: {} });
  assert.equal(r.ok, false);
});

test('excluir e excluirTodos', () => {
  const ctx = novo();
  ['id-aaaaaa1', 'id-bbbbbb2', 'id-cccccc3'].forEach((id) => ctx.post({ acao: 'enviar', payload: payloadValido({ id }) }));
  let r = ctx.post({ acao: 'excluir', chave: CHAVE, id: 'id-bbbbbb2' });
  assert.equal(r.ok, true, r.erro);
  let ids = ctx.post({ acao: 'listar', chave: CHAVE }).itens.map((i) => i.id).sort();
  assert.deepEqual(ids, ['id-aaaaaa1', 'id-cccccc3']);
  assert.equal(ctx.post({ acao: 'excluir', chave: CHAVE, id: 'id-bbbbbb2' }).ok, false);

  r = ctx.post({ acao: 'excluirTodos', chave: CHAVE });
  assert.equal(r.ok, true);
  assert.equal(r.excluidos, 2);
  assert.deepEqual(ctx.post({ acao: 'listar', chave: CHAVE }).itens, []);
  assert.equal(ctx.aba().linhas.length, 1, 'cabeçalho mantido');
});

test('chave errada ou ausente é recusada em todas as ações admin', () => {
  const ctx = novo();
  ctx.post({ acao: 'enviar', payload: payloadValido() });
  const acoes = [
    { acao: 'listar' },
    { acao: 'atualizar', id: 'lx1abc-teste01', campos: { status: 'aprovado' } },
    { acao: 'excluir', id: 'lx1abc-teste01' },
    { acao: 'excluirTodos' }
  ];
  acoes.forEach((a) => {
    [undefined, '', 'errada', CHAVE + 'x', 123].forEach((chave) => {
      const r = ctx.post(Object.assign({ chave }, a));
      assert.equal(r.ok, false, a.acao + ' com chave ' + chave);
      assert.match(r.erro, /chave/i);
      assert.ok(JSON.stringify(r).indexOf(CHAVE) === -1, 'nunca devolve a chave');
    });
  });
  assert.equal(ctx.aba().linhas.length, 2, 'nada foi apagado');
  assert.ok(ctx.sleeps.length > 0, 'atraso contra força bruta');
});

test('sem ADMIN_KEY configurada, ações admin pedem para rodar setup', () => {
  const ctx = carregarGas();
  const r = ctx.post({ acao: 'listar', chave: 'qualquer' });
  assert.equal(r.ok, false);
  assert.match(r.erro, /setup/);
});

test('setup cria aba e chave de 40 caracteres hexadecimais e não troca a existente', () => {
  const ctx = carregarGas();
  ctx.g.setup();
  assert.ok(ctx.aba(), 'aba criada');
  assert.match(ctx.props.ADMIN_KEY, /^[0-9a-f]{40}$/);
  assert.ok(ctx.logs.some((l) => l === ctx.props.ADMIN_KEY), 'chave registrada no log');
  const antiga = ctx.props.ADMIN_KEY;
  ctx.g.setup();
  assert.equal(ctx.props.ADMIN_KEY, antiga);
  const r = ctx.post({ acao: 'listar', chave: antiga });
  assert.equal(r.ok, true);
});

test('cálculo do servidor é idêntico ao de js/scoring.js', () => {
  const { g } = novo();
  const rnd = prng(2026);
  for (let k = 0; k < 300; k++) {
    const resp = respostasAleatorias(rnd);
    const a = S.calcular(resp);
    const b = g.calcularDisc(S.compactar(resp));
    assert.deepEqual(JSON.parse(JSON.stringify(b)), JSON.parse(JSON.stringify(a)));
  }
});

test('nome com letras fora do Latin-1 é aceito (mesmo critério do app)', () => {
  const ctx = novo();
  ['Ωμέγα Αλφα', 'Łukasz Żółć'].forEach((nome, i) => {
    const r = ctx.post({ acao: 'enviar', payload: payloadValido({ id: 'unicode-nome-' + i, nome }) });
    assert.equal(r.ok, true, nome + ': ' + r.erro);
  });
});

test('limitador global recusa envios em excesso na mesma janela', () => {
  const ctx = novo();
  let recusado = null;
  for (let i = 0; i < 45; i++) {
    const r = ctx.post({ acao: 'enviar', payload: payloadValido({ id: 'rajada-envio-' + String(i).padStart(3, '0') }) });
    if (!r.ok) { recusado = { i, r }; break; }
  }
  assert.ok(recusado, 'deveria recusar algum envio');
  assert.equal(recusado.i, 40);
  assert.match(recusado.r.erro, /Muitos envios/);
  assert.equal(ctx.aba().linhas.length, 41);
});
