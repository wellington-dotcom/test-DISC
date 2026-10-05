'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarGas } = require('./helpers/gas.js');
const S = require('../js/scoring.js');
const { payloadValido, respostasAleatorias, respostasFixas, prng } = require('./helpers/fixtures.js');

const CHAVE = 'chave-secreta-de-teste-1234567890abcdef';

const ADMIN = { nome: 'Dona do Sistema', email: 'dona@empresa.com', senha: 'senha-forte-1' };

// Planilha nova com um administrador já criado pelo "Primeiro acesso"; ctx.token é a sessão dele.
function novo() {
  const ctx = carregarGas({ props: { ADMIN_KEY: CHAVE } });
  const r = ctx.post(Object.assign({ acao: 'primeiroAcesso', chave: CHAVE }, ADMIN));
  if (!r.ok) throw new Error(r.erro);
  ctx.token = r.token;
  ctx.adminId = r.usuario.id;
  ctx.sleeps.length = 0;
  return ctx;
}

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
    'respostas', 'D', 'I', 'S', 'C', 'perfil', 'status', 'observacoes', 'payloadJson', 'protocolo',
    'idade', 'funcao', 'empresa', 'avaliacao', 'empresaId']);
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
  assert.match(r.protocolo, /^[0-9]{2}[A-HJ-NP-Z]$/);
  assert.equal(String(col('protocolo')).replace(/^'/, ''), r.protocolo);
  assert.equal(col('idade'), 30, 'idade gravada como número');
  assert.equal(col('funcao'), 'Recepcionista');
  assert.equal(col('empresa'), 'Loja Centro');
});

test('enviar normaliza telefone de 11 dígitos para 55 + número', () => {
  const ctx = novo();
  const r = ctx.post({ acao: 'enviar', payload: payloadValido({ telefone: '(21) 98888-7777' }) });
  assert.equal(r.ok, true, r.erro);
  const l = ctx.post({ acao: 'listar', token: ctx.token });
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

  const up = ctx.post({ acao: 'atualizar', token: ctx.token, id: p.id, campos: { observacoes: '@cmd|calc' } });
  assert.equal(up.ok, true, up.erro);
  assert.equal(aba.linhas[1][cab.indexOf('observacoes')], "'@cmd|calc");

  // Na leitura o apóstrofo é removido.
  const item = ctx.post({ acao: 'listar', token: ctx.token }).itens[0];
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
  const r = ctx.post({ acao: 'listar', token: ctx.token });
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
  const r = ctx.post({ acao: 'listar', token: ctx.token });
  assert.deepEqual(r, { ok: true, itens: [] });
});

test('atualizar status e observações', () => {
  const ctx = novo();
  const p = payloadValido();
  ctx.post({ acao: 'enviar', payload: p });
  let r = ctx.post({ acao: 'atualizar', token: ctx.token, id: p.id, campos: { status: 'aprovado', observacoes: 'Boa entrevista.\nContratar.' } });
  assert.equal(r.ok, true, r.erro);
  let item = ctx.post({ acao: 'listar', token: ctx.token }).itens[0];
  assert.equal(item.status, 'aprovado');
  assert.equal(item.observacoes, 'Boa entrevista.\nContratar.');

  r = ctx.post({ acao: 'atualizar', token: ctx.token, id: p.id, campos: { status: 'contratado' } });
  assert.equal(r.ok, false);
  assert.match(r.erro, /Status inválido/);
  r = ctx.post({ acao: 'atualizar', token: ctx.token, id: 'nao-existe-123', campos: { status: 'reprovado' } });
  assert.equal(r.ok, false);
  assert.match(r.erro, /não encontrado/);
  r = ctx.post({ acao: 'atualizar', token: ctx.token, id: p.id, campos: {} });
  assert.equal(r.ok, false);
});

test('excluir e excluirTodos', () => {
  const ctx = novo();
  ['id-aaaaaa1', 'id-bbbbbb2', 'id-cccccc3'].forEach((id) => ctx.post({ acao: 'enviar', payload: payloadValido({ id }) }));
  let r = ctx.post({ acao: 'excluir', token: ctx.token, id: 'id-bbbbbb2' });
  assert.equal(r.ok, true, r.erro);
  let ids = ctx.post({ acao: 'listar', token: ctx.token }).itens.map((i) => i.id).sort();
  assert.deepEqual(ids, ['id-aaaaaa1', 'id-cccccc3']);
  assert.equal(ctx.post({ acao: 'excluir', token: ctx.token, id: 'id-bbbbbb2' }).ok, false);

  r = ctx.post({ acao: 'excluirTodos', token: ctx.token });
  assert.equal(r.ok, true);
  assert.equal(r.excluidos, 2);
  assert.deepEqual(ctx.post({ acao: 'listar', token: ctx.token }).itens, []);
  assert.equal(ctx.aba().linhas.length, 1, 'cabeçalho mantido');
});

test('token errado, ausente ou de outro formato é recusado em todas as ações com sessão', () => {
  const ctx = novo();
  ctx.post({ acao: 'enviar', payload: payloadValido() });
  const acoes = ['eu', 'listar', 'atualizar', 'excluir', 'excluirTodos', 'trocarSenha', 'empresas.listar', 'empresas.salvar',
    'avaliacoes.listar', 'avaliacoes.salvar', 'usuarios.listar', 'usuarios.salvar', 'usuarios.excluir', 'usuarios.redefinirSenha'];
  acoes.forEach((acao) => {
    [undefined, '', 'errado', ctx.token + 'x', ctx.token.replace(/.$/, '0') === ctx.token ? 'f'.repeat(64) : ctx.token.replace(/.$/, '0'), 123, CHAVE].forEach((token) => {
      const r = ctx.post({ acao, token, id: 'lx1abc-teste01', campos: { status: 'aprovado' } });
      assert.equal(r.ok, false, acao + ' com token ' + token);
      assert.equal(r.erro, 'Sessão expirada. Entre de novo.');
      assert.equal(r.sessaoExpirada, true);
    });
  });
  // A antiga autenticação por "chave" não vale mais nas ações do painel.
  assert.equal(ctx.post({ acao: 'listar', chave: CHAVE }).sessaoExpirada, true);
  assert.equal(ctx.aba().linhas.length, 2, 'nada foi apagado');
});

test('sem ADMIN_KEY configurada, o primeiro acesso pede para rodar setup', () => {
  const ctx = carregarGas();
  const r = ctx.post(Object.assign({ acao: 'primeiroAcesso', chave: 'qualquer' }, ADMIN));
  assert.equal(r.ok, false);
  assert.match(r.erro, /setup/);
});

test('setup cria as abas e a chave de 40 caracteres hexadecimais e não troca a existente', () => {
  const ctx = carregarGas();
  ctx.g.setup();
  assert.ok(ctx.aba(), 'aba Respostas criada');
  assert.deepEqual(ctx.abas.Usuarios.linhas[0], ['id', 'email', 'nome', 'papel', 'empresaId', 'hash', 'sal', 'ativo', 'tentativas', 'bloqueadoAte', 'criadoEm']);
  assert.deepEqual(ctx.abas.Empresas.linhas[0], ['id', 'nome', 'criadaEm']);
  assert.deepEqual(ctx.abas.Avaliacoes.linhas[0], ['id', 'codigo', 'empresaId', 'nome', 'tipo', 'mostrarResultado', 'ativa', 'criadaEm']);
  assert.match(ctx.props.ADMIN_KEY, /^[0-9a-f]{40}$/);
  assert.ok(ctx.logs.some((l) => l === ctx.props.ADMIN_KEY), 'chave registrada no log');
  assert.ok(ctx.logs.includes("Use esta chave uma única vez no painel, em 'Primeiro acesso', para criar o seu login de administrador."));
  const antiga = ctx.props.ADMIN_KEY;
  ctx.g.setup();
  assert.equal(ctx.props.ADMIN_KEY, antiga);
  const r = ctx.post(Object.assign({ acao: 'primeiroAcesso', chave: antiga }, ADMIN));
  assert.equal(r.ok, true, r.erro);
  assert.equal(ctx.post({ acao: 'listar', token: r.token }).ok, true);
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

// ---------------------------------------------------------------------------
// Protocolo (código curto do candidato)
// ---------------------------------------------------------------------------

const RE_PROTOCOLO = /^[0-9]{2}[A-HJ-NP-Z]$/;

// Monta a aba à mão: cabeçalho + uma linha por protocolo (ids distintos).
function abaComProtocolos(ctx, protocolos, cabecalho) {
  const aba = ctx.g.SpreadsheetApp.getActiveSpreadsheet().insertSheet('Respostas');
  const cab = cabecalho || ctx.g.CABECALHO.slice();
  aba.linhas.push(cab.slice());
  const iId = cab.indexOf('id');
  const iProt = cab.indexOf('protocolo');
  protocolos.forEach((p, n) => {
    const l = new Array(cab.length).fill('');
    l[iId] = 'ocupado-' + String(n).padStart(5, '0');
    if (iProt >= 0) l[iProt] = "'" + p;
    aba.linhas.push(l);
  });
  return aba;
}

function todosProtocolos(g) {
  const out = [];
  for (let n = 0; n < 100; n++) for (const l of g.LETRAS_PROTOCOLO) out.push(String(n).padStart(2, '0') + l);
  return out;
}

test('protocoloValido: 2 algarismos + 1 letra maiúscula sem I e O', () => {
  const { g } = novo();
  assert.equal(g.LETRAS_PROTOCOLO, 'ABCDEFGHJKLMNPQRSTUVWXYZ');
  assert.equal(g.TOTAL_PROTOCOLOS, 2400);
  ['47K', '00A', '99Z', '10H', '05J'].forEach((p) => assert.equal(g.protocoloValido(p), true, p));
  ['47k', '4K', '470K', '47I', '47O', 'K47', '47 K', '', null, 47, '4KK', '47Ç'].forEach((p) => assert.equal(g.protocoloValido(p), false, String(p)));
  assert.equal(g.normalizarProtocolo(" 4 7k "), '47K');
  assert.equal(g.normalizarProtocolo("'47K"), '47K');
  assert.equal(g.normalizarProtocolo('47I'), '');
});

test('gerarProtocolo sorteia só no formato do contrato (nunca I ou O)', () => {
  const { g } = novo();
  const rnd = prng(7);
  const vistos = new Set();
  for (let k = 0; k < 3000; k++) {
    const p = g.gerarProtocolo({}, rnd);
    assert.match(p, RE_PROTOCOLO);
    vistos.add(p);
  }
  assert.ok(vistos.size > 1500, 'sorteio espalhado');
  // extremos do sorteio
  assert.equal(g.gerarProtocolo({}, () => 0), '00A');
  assert.equal(g.gerarProtocolo({}, () => 0.9999999999), '99Z');
});

test('gerarProtocolo com a planilha quase cheia acha o único código livre; cheia dá erro claro', () => {
  const { g } = novo();
  const todos = todosProtocolos(g);
  assert.equal(todos.length, 2400);
  assert.equal(new Set(todos).size, 2400);
  const livre = '58R';
  const usados = todos.filter((p) => p !== livre);
  assert.equal(usados.length, 2399);
  for (let k = 0; k < 5; k++) assert.equal(g.gerarProtocolo(usados, prng(k)), livre);
  assert.throws(() => g.gerarProtocolo(todos), /Limite de códigos atingido/);
});

test('enviar devolve protocolo único entre vários envios', () => {
  const ctx = novo();
  const vistos = new Set();
  for (let i = 0; i < 30; i++) {
    const r = ctx.post({ acao: 'enviar', payload: payloadValido({ id: 'unico-envio-' + String(i).padStart(3, '0') }) });
    assert.equal(r.ok, true, r.erro);
    assert.match(r.protocolo, RE_PROTOCOLO);
    assert.ok(!vistos.has(r.protocolo), 'protocolo repetido: ' + r.protocolo);
    vistos.add(r.protocolo);
  }
  const itens = ctx.post({ acao: 'listar', token: ctx.token }).itens;
  assert.deepEqual(new Set(itens.map((i) => i.protocolo)), vistos);
});

test('enviar com 2.399 códigos já usados grava o único livre; com todos usados recusa', () => {
  const ctx = novo();
  ctx.g.LIMITE_LINHAS = 10000; // o limite de linhas real (500) barraria antes; aqui o alvo é o protocolo
  const todos = todosProtocolos(ctx.g);
  const livre = '03W';
  abaComProtocolos(ctx, todos.filter((p) => p !== livre));
  const r = ctx.post({ acao: 'enviar', payload: payloadValido({ id: 'penultimo-01' }) });
  assert.equal(r.ok, true, r.erro);
  assert.equal(r.protocolo, livre);

  const r2 = ctx.post({ acao: 'enviar', payload: payloadValido({ id: 'sem-codigo-02' }) });
  assert.equal(r2.ok, false);
  assert.match(r2.erro, /Limite de códigos atingido/);
  assert.equal(ctx.aba().linhas.length, 2401, 'nada gravado sem protocolo');

  // Reenvio do que já entrou continua funcionando e devolve o mesmo código.
  const r3 = ctx.post({ acao: 'enviar', payload: payloadValido({ id: 'penultimo-01' }) });
  assert.equal(r3.ok, true, r3.erro);
  assert.equal(r3.duplicado, true);
  assert.equal(r3.protocolo, livre);
});

test('reenvio com id duplicado devolve o mesmo protocolo e não grava de novo', () => {
  const ctx = novo();
  const p = payloadValido({ id: 'reenvio-000001' });
  const r1 = ctx.post({ acao: 'enviar', payload: p });
  assert.equal(r1.ok, true, r1.erro);
  for (let k = 0; k < 3; k++) {
    const r = ctx.post({ acao: 'enviar', payload: p });
    assert.deepEqual(r, { ok: true, duplicado: true, id: p.id, protocolo: r1.protocolo });
  }
  assert.equal(ctx.aba().linhas.length, 2);
});

test('planilha antiga sem a coluna protocolo: a coluna é criada e os registros antigos continuam', () => {
  const ctx = novo();
  const antigo = ctx.g.CABECALHO.slice(0, 17);
  assert.ok(antigo.indexOf('protocolo') === -1);
  const aba = ctx.g.SpreadsheetApp.getActiveSpreadsheet().insertSheet('Respostas');
  aba.linhas.push(antigo.slice());
  // linha gravada pela versão anterior do Code.gs (17 colunas)
  const pAntigo = payloadValido({ id: 'antigo-000001', nome: 'Maria Antiga Souza' });
  aba.linhas.push(ctx.g.montarLinha(pAntigo, '2026-09-01T10:00:00.000Z').slice(0, 17));

  // listar antes de qualquer envio já ajusta o cabeçalho e devolve protocolo vazio para o antigo
  let l = ctx.post({ acao: 'listar', token: ctx.token });
  assert.equal(l.ok, true, l.erro);
  assert.equal(aba.linhas[0][17], 'protocolo');
  assert.equal(l.itens[0].protocolo, '');
  assert.equal(l.itens[0].nome, 'Maria Antiga Souza');
  assert.ok(aba.formatos.some((f) => f.coluna === 18 && f.f === '@'), 'coluna nova em formato texto');

  const r = ctx.post({ acao: 'enviar', payload: payloadValido({ id: 'novo-0000001' }) });
  assert.equal(r.ok, true, r.erro);
  assert.match(r.protocolo, RE_PROTOCOLO);
  assert.deepEqual(aba.linhas[0], ctx.g.CABECALHO.slice());

  // reenvio do registro antigo: ganha um código agora e passa a devolver sempre o mesmo
  const a1 = ctx.post({ acao: 'enviar', payload: pAntigo });
  assert.equal(a1.duplicado, true);
  assert.match(a1.protocolo, RE_PROTOCOLO);
  assert.notEqual(a1.protocolo, r.protocolo);
  const a2 = ctx.post({ acao: 'enviar', payload: pAntigo });
  assert.equal(a2.protocolo, a1.protocolo);

  l = ctx.post({ acao: 'listar', token: ctx.token });
  const porId = Object.fromEntries(l.itens.map((i) => [i.id, i.protocolo]));
  assert.deepEqual(porId, { 'antigo-000001': a1.protocolo, 'novo-0000001': r.protocolo });
  assert.equal(aba.linhas.length, 3);
});

test('planilha antiga com só 17 colunas físicas: insere a coluna antes de escrever o cabeçalho', () => {
  const ctx = novo();
  const antigo = ctx.g.CABECALHO.slice(0, 17);
  const aba = ctx.g.SpreadsheetApp.getActiveSpreadsheet().insertSheet('Respostas');
  aba.maxColunas = 17; // dono apagou as colunas vazias R..Z
  aba.linhas.push(antigo.slice());
  const r = ctx.post({ acao: 'enviar', payload: payloadValido({ id: 'estreita-0001' }) });
  assert.equal(r.ok, true, r.erro);
  assert.match(r.protocolo, RE_PROTOCOLO);
  assert.equal(aba.maxColunas, ctx.g.CABECALHO.length);
  assert.deepEqual(aba.linhas[0], ctx.g.CABECALHO.slice());
});

test('listar devolve protocolo em cada item (sem apóstrofo, maiúsculo)', () => {
  const ctx = novo();
  const r = ctx.post({ acao: 'enviar', payload: payloadValido() });
  const celula = ctx.aba().linhas[1][ctx.g.CABECALHO.indexOf('protocolo')];
  assert.equal(celula, "'" + r.protocolo, 'gravado como texto');
  const item = ctx.post({ acao: 'listar', token: ctx.token }).itens[0];
  assert.equal(item.protocolo, r.protocolo);
});

test('idade: obrigatória, inteiro de 14 a 99; payload sem idade é recusado com mensagem clara', () => {
  const ctx = novo();
  const casos = [
    [{ idade: undefined }, /Idade não informada/],
    [{ idade: null }, /Idade não informada/],
    [{ idade: '' }, /Idade não informada/],
    [{ idade: 13 }, /entre 14 e 99/],
    [{ idade: 100 }, /entre 14 e 99/],
    [{ idade: 0 }, /entre 14 e 99/],
    [{ idade: 30.5 }, /só números/],
    [{ idade: -20 }, /só números/],
    [{ idade: 'trinta' }, /só números/],
    [{ idade: '3 0' }, /só números/],
    [{ idade: true }, /só números/]
  ];
  casos.forEach(([extra, re]) => {
    const p = payloadValido(extra);
    if (extra.idade === undefined) delete p.idade;
    const r = ctx.post({ acao: 'enviar', payload: p });
    assert.equal(r.ok, false, JSON.stringify(extra));
    assert.match(r.erro, re, JSON.stringify(extra));
  });
  assert.equal(ctx.aba() ? ctx.aba().linhas.length <= 1 : true, true, 'nada gravado');
  // Limites e texto só com dígitos são aceitos
  [14, 99, '45', ' 18 '].forEach((idade, i) => {
    const r = ctx.post({ acao: 'enviar', payload: payloadValido({ id: 'idade-ok-' + i, idade }) });
    assert.equal(r.ok, true, r.erro);
  });
  const itens = ctx.post({ acao: 'listar', token: ctx.token }).itens;
  assert.deepEqual(itens.map((i) => i.idade), [14, 99, 45, 18]);
});

test('função e empresa: opcionais, aparadas, limitadas a 80 e protegidas contra fórmula', () => {
  const ctx = novo();
  const longo = 'A'.repeat(120);
  const p = payloadValido({ funcao: '  -Gerente   de\tloja ', empresa: '=HYPERLINK("http://x","clique")' });
  const r = ctx.post({ acao: 'enviar', payload: p });
  assert.equal(r.ok, true, r.erro);
  const aba = ctx.aba();
  const cab = aba.linhas[0];
  const linha = aba.linhas[1];
  assert.equal(linha[cab.indexOf('empresa')], '\'=HYPERLINK("http://x","clique")');
  assert.equal(linha[cab.indexOf('funcao')], "'-Gerente de loja");
  linha.forEach((v, i) => {
    if (typeof v === 'string') assert.ok(!/^[=+\-@]/.test(v), 'célula ' + cab[i] + ' começa com fórmula: ' + v);
  });
  const r2 = ctx.post({ acao: 'enviar', payload: payloadValido({ id: 'sem-exp-0001', funcao: undefined, empresa: longo }) });
  assert.equal(r2.ok, true, r2.erro);
  const itens = ctx.post({ acao: 'listar', token: ctx.token }).itens;
  assert.equal(itens[0].empresa, '=HYPERLINK("http://x","clique")', 'apóstrofo removido na leitura');
  assert.equal(itens[0].funcao, '-Gerente de loja');
  assert.equal(itens[1].funcao, '');
  assert.equal(itens[1].empresa, 'A'.repeat(80));
});

test('planilha antiga (até protocolo): ganha idade, funcao e empresa no fim; linhas antigas listam idade null', () => {
  const ctx = novo();
  const antigo = ctx.g.CABECALHO.slice(0, ctx.g.CABECALHO.indexOf('protocolo') + 1);
  assert.equal(antigo.length, 18);
  const aba = ctx.g.SpreadsheetApp.getActiveSpreadsheet().insertSheet('Respostas');
  aba.maxColunas = 18; // sem colunas físicas sobrando
  aba.linhas.push(antigo.slice());
  const pAntigo = payloadValido({ id: 'antigo-000002', nome: 'Maria Antiga Souza' });
  aba.linhas.push(ctx.g.montarLinha(pAntigo, '2026-09-01T10:00:00.000Z', '12A').slice(0, 18));

  let l = ctx.post({ acao: 'listar', token: ctx.token });
  assert.equal(l.ok, true, l.erro);
  assert.deepEqual(aba.linhas[0], ctx.g.CABECALHO.slice());
  assert.deepEqual([...aba.linhas[0].slice(-6)], ['protocolo', 'idade', 'funcao', 'empresa', 'avaliacao', 'empresaId']);
  assert.equal(aba.maxColunas, 23);
  assert.equal(l.itens[0].idade, null);
  assert.equal(l.itens[0].funcao, '');
  assert.equal(l.itens[0].empresa, '');
  assert.equal(l.itens[0].protocolo, '12A');
  // funcao (20) e empresa (21) em formato texto; idade é número
  assert.ok(aba.formatos.some((f) => f.coluna === 20 && f.f === '@'));
  assert.ok(aba.formatos.some((f) => f.coluna === 21 && f.f === '@'));
  assert.ok(!aba.formatos.some((f) => f.coluna === 19));

  const r = ctx.post({ acao: 'enviar', payload: payloadValido({ id: 'novo-0000002', idade: 41 }) });
  assert.equal(r.ok, true, r.erro);
  l = ctx.post({ acao: 'listar', token: ctx.token });
  assert.deepEqual(l.itens.map((i) => i.idade), [null, 41]);
});

// ---------------------------------------------------------------------------
// Logins, empresas e avaliações
// ---------------------------------------------------------------------------

// Cenário: admin + empresa A (gestor A, avaliação SEL) + empresa B (avaliação EQP).
function cenario() {
  const ctx = novo();
  const T = ctx.token;
  const eA = ctx.post({ acao: 'empresas.salvar', token: T, empresa: { nome: 'Clínica Alfa' } });
  const eB = ctx.post({ acao: 'empresas.salvar', token: T, empresa: { nome: 'Loja Beta' } });
  assert.equal(eA.ok, true, eA.erro);
  const avA = ctx.post({ acao: 'avaliacoes.salvar', token: T, avaliacao: { empresaId: eA.empresa.id, nome: 'Recepção 2026', tipo: 'selecao', mostrarResultado: false } });
  const avB = ctx.post({ acao: 'avaliacoes.salvar', token: T, avaliacao: { empresaId: eB.empresa.id, nome: 'Equipe de vendas', tipo: 'equipe', mostrarResultado: true } });
  assert.equal(avA.ok, true, avA.erro);
  const g = ctx.post({ acao: 'usuarios.salvar', token: T, usuario: { nome: 'Gestora Alfa', email: ' Gestora@Alfa.com ', papel: 'gestor', empresaId: eA.empresa.id }, senhaTemporaria: 'temporaria1' });
  assert.equal(g.ok, true, g.erro);
  const lg = ctx.post({ acao: 'login', email: 'gestora@alfa.com', senha: 'temporaria1' });
  assert.equal(lg.ok, true, lg.erro);
  return { ctx, T, eA: eA.empresa, eB: eB.empresa, avA: avA.avaliacao, avB: avB.avaliacao, gestor: g.usuario, TG: lg.token };
}

test('hashSenha: SHA-256 iterado 2000× sobre sal+senha (conta conferida e tempo medido)', () => {
  const ctx = carregarGas();
  const crypto = require('node:crypto');
  let x = 'sal123' + 'minhasenha';
  for (let i = 0; i < 2000; i++) x = crypto.createHash('sha256').update(x, 'utf8').digest('hex');
  const antes = ctx.digests();
  const t0 = process.hrtime.bigint();
  assert.equal(ctx.g.hashSenha('minhasenha', 'sal123'), x);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.equal(ctx.digests() - antes, 2000, '2000 chamadas a computeDigest');
  assert.ok(ms < 1000, 'hash levou ' + ms.toFixed(1) + ' ms no Node');
  assert.notEqual(ctx.g.hashSenha('minhasenha', 'sal124'), x, 'sal muda o hash');
});

test('primeiroAcesso: chave certa cria admin e já entra; chave errada recusa; e-mail de admin existente redefine a senha', () => {
  const ctx = carregarGas({ props: { ADMIN_KEY: CHAVE } });
  let r = ctx.post({ acao: 'primeiroAcesso', chave: 'errada', nome: 'Ana', email: 'ana@x.com', senha: '12345678' });
  assert.equal(r.ok, false);
  assert.equal(r.erro, 'Chave de primeiro acesso inválida.');
  assert.ok(ctx.sleeps.length > 0, 'atraso contra força bruta');
  assert.match(ctx.post({ acao: 'primeiroAcesso', chave: CHAVE, nome: 'Ana', email: 'ana@x.com', senha: '1234567' }).erro, /pelo menos 8/);
  assert.match(ctx.post({ acao: 'primeiroAcesso', chave: CHAVE, nome: 'Ana', email: 'ana-x.com', senha: '12345678' }).erro, /E-mail inválido/);
  assert.match(ctx.post({ acao: 'primeiroAcesso', chave: CHAVE, nome: '', email: 'ana@x.com', senha: '12345678' }).erro, /nome/);

  r = ctx.post({ acao: 'primeiroAcesso', chave: ' ' + CHAVE + ' ', nome: 'Ana Admin', email: ' ANA@X.com ', senha: '12345678' });
  assert.equal(r.ok, true, r.erro);
  assert.equal(r.redefinida, false);
  assert.match(r.token, /^[0-9a-f]{64}$/);
  assert.deepEqual(r.usuario, { id: r.usuario.id, nome: 'Ana Admin', email: 'ana@x.com', papel: 'admin', empresaId: '', empresaNome: '' });
  const linha = ctx.abas.Usuarios.linhas[1];
  assert.ok(!linha.includes('12345678'), 'senha nunca gravada');
  assert.match(String(linha[5]).replace(/^'/, ''), /^[0-9a-f]{64}$/, 'hash');
  assert.match(String(linha[6]).replace(/^'/, ''), /^[0-9a-f]{32}$/, 'sal de 16 bytes');
  assert.equal(ctx.post({ acao: 'eu', token: r.token }).usuario.email, 'ana@x.com');

  // recuperação: mesma chave, mesmo e-mail -> redefine a senha, sem criar outro usuário
  const r2 = ctx.post({ acao: 'primeiroAcesso', chave: CHAVE, nome: 'Ana Admin', email: 'ana@x.com', senha: 'nova-senha-9' });
  assert.equal(r2.ok, true, r2.erro);
  assert.equal(r2.redefinida, true);
  assert.equal(r2.usuario.id, r.usuario.id);
  assert.equal(ctx.abas.Usuarios.linhas.length, 2);
  assert.equal(ctx.post({ acao: 'login', email: 'ana@x.com', senha: '12345678' }).ok, false);
  assert.equal(ctx.post({ acao: 'login', email: 'ana@x.com', senha: 'nova-senha-9' }).ok, true);
  assert.equal(ctx.post({ acao: 'eu', token: r.token }).sessaoExpirada, true, 'sessão antiga cai com a senha nova');
});

test('login: certo, errado (mensagem genérica) e bloqueio de 15 minutos após 5 erros', () => {
  const ctx = novo();
  const generico = 'E-mail ou senha incorretos.';
  assert.equal(ctx.post({ acao: 'login', email: 'ninguem@x.com', senha: 'qualquer1' }).erro, generico);
  assert.equal(ctx.post({ acao: 'login', email: ADMIN.email, senha: 'errada123' }).erro, generico);
  const ok = ctx.post({ acao: 'login', email: '  DONA@empresa.com ', senha: ADMIN.senha });
  assert.equal(ok.ok, true, ok.erro);
  assert.equal(ok.usuario.papel, 'admin');
  assert.ok(!('hash' in ok.usuario) && !('sal' in ok.usuario));

  for (let i = 1; i <= 4; i++) assert.equal(ctx.post({ acao: 'login', email: ADMIN.email, senha: 'errada' + i }).erro, generico);
  const quinto = ctx.post({ acao: 'login', email: ADMIN.email, senha: 'errada5' });
  assert.equal(quinto.erro, 'Muitas tentativas. Tente de novo em 15 minutos.');
  // bloqueado: nem a senha certa entra
  assert.equal(ctx.post({ acao: 'login', email: ADMIN.email, senha: ADMIN.senha }).erro, 'Muitas tentativas. Tente de novo em 15 minutos.');
  ctx.avancar(14 * 60 * 1000);
  assert.equal(ctx.post({ acao: 'login', email: ADMIN.email, senha: ADMIN.senha }).ok, false);
  ctx.avancar(61 * 1000);
  assert.equal(ctx.post({ acao: 'login', email: ADMIN.email, senha: ADMIN.senha }).ok, true);
  assert.ok(ctx.sleeps.length > 0, 'atraso nas tentativas erradas');
  assert.match(ctx.post({ acao: 'login', email: '', senha: '' }).erro, /Informe/);
});

test('sessão: renova a cada uso, expira depois de 6 h parada e "sair" encerra', () => {
  const ctx = novo();
  const T = ctx.token;
  ctx.avancar(5 * 3600 * 1000);
  assert.equal(ctx.post({ acao: 'eu', token: T }).ok, true, 'renovou');
  ctx.avancar(5 * 3600 * 1000);
  assert.equal(ctx.post({ acao: 'listar', token: T }).ok, true, 'ainda vale (10 h desde o login, 5 h desde o último uso)');
  ctx.avancar(6 * 3600 * 1000 + 1000);
  const r = ctx.post({ acao: 'listar', token: T });
  assert.deepEqual(r, { ok: false, erro: 'Sessão expirada. Entre de novo.', sessaoExpirada: true });
  assert.ok(Object.keys(ctx.cache).every((k) => !k.startsWith('sessao_') || ctx.cache[k].valor.indexOf('hash') === -1));

  const l = ctx.post({ acao: 'login', email: ADMIN.email, senha: ADMIN.senha });
  assert.equal(ctx.post({ acao: 'sair', token: l.token }).ok, true);
  assert.equal(ctx.post({ acao: 'eu', token: l.token }).sessaoExpirada, true);
});

test('trocarSenha: confere a atual, exige 8+ caracteres e mantém a sessão atual', () => {
  const ctx = novo();
  const outra = ctx.post({ acao: 'login', email: ADMIN.email, senha: ADMIN.senha }).token;
  assert.equal(ctx.post({ acao: 'trocarSenha', token: ctx.token, senhaAtual: 'errada', novaSenha: 'outrasenha1' }).erro, 'Senha atual incorreta.');
  assert.match(ctx.post({ acao: 'trocarSenha', token: ctx.token, senhaAtual: ADMIN.senha, novaSenha: 'curta' }).erro, /pelo menos 8/);
  assert.equal(ctx.post({ acao: 'trocarSenha', token: ctx.token, senhaAtual: ADMIN.senha, novaSenha: 'outrasenha1' }).ok, true);
  assert.equal(ctx.post({ acao: 'eu', token: ctx.token }).ok, true, 'sessão atual continua');
  assert.equal(ctx.post({ acao: 'eu', token: outra }).sessaoExpirada, true, 'outras sessões caem');
  assert.equal(ctx.post({ acao: 'login', email: ADMIN.email, senha: 'outrasenha1' }).ok, true);
});

test('avaliacaoPublica e enviar com código ativo, inativo e inexistente', () => {
  const { ctx, T, eA, avA } = cenario();
  assert.match(avA.codigo, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/);
  const pub = ctx.post({ acao: 'avaliacaoPublica', codigo: avA.codigo.toLowerCase() });
  assert.deepEqual(pub, { ok: true, avaliacao: { codigo: avA.codigo, nome: 'Recepção 2026', tipo: 'selecao', empresaNome: 'Clínica Alfa', mostrarResultado: false } });
  assert.equal(ctx.post({ acao: 'avaliacaoPublica', codigo: 'ZZZZ' }).erro, 'Link inválido ou avaliação encerrada. Fale com quem enviou o link.');
  assert.equal(ctx.post({ acao: 'avaliacaoPublica', codigo: '<script>' }).ok, false);

  const r = ctx.post({ acao: 'enviar', payload: payloadValido({ id: 'com-codigo-01', avaliacao: avA.codigo }) });
  assert.equal(r.ok, true, r.erro);
  const cab = ctx.aba().linhas[0];
  assert.equal(String(ctx.aba().linhas[1][cab.indexOf('avaliacao')]).replace(/^'/, ''), avA.codigo); // o Sheets não guarda o apóstrofo de "texto"
  assert.equal(ctx.aba().linhas[1][cab.indexOf('empresaId')], eA.id);

  assert.equal(ctx.post({ acao: 'enviar', payload: payloadValido({ id: 'sem-avaliacao-1', avaliacao: 'QQQQ' }) }).erro, 'Este link de avaliação não está mais ativo.');
  assert.equal(ctx.post({ acao: 'enviar', payload: payloadValido({ id: 'sem-avaliacao-2', avaliacao: 'x' }) }).erro, 'Este link de avaliação não está mais ativo.');

  const des = ctx.post({ acao: 'avaliacoes.salvar', token: T, avaliacao: Object.assign({}, avA, { ativa: false }) });
  assert.equal(des.ok, true, des.erro);
  assert.equal(des.avaliacao.codigo, avA.codigo, 'código não muda ao editar');
  assert.equal(ctx.post({ acao: 'avaliacaoPublica', codigo: avA.codigo }).ok, false);
  assert.equal(ctx.post({ acao: 'enviar', payload: payloadValido({ id: 'inativa-0001', avaliacao: avA.codigo }) }).erro, 'Este link de avaliação não está mais ativo.');
  // reenvio de quem já tinha enviado continua devolvendo o mesmo protocolo
  assert.equal(ctx.post({ acao: 'enviar', payload: payloadValido({ id: 'com-codigo-01', avaliacao: avA.codigo }) }).protocolo, r.protocolo);
  // sem código = avaliação geral
  const geral = ctx.post({ acao: 'enviar', payload: payloadValido({ id: 'geral-000001' }) });
  assert.equal(geral.ok, true, geral.erro);
  assert.equal(ctx.aba().linhas[2][cab.indexOf('empresaId')], '');
});

test('validacao no payload: guardada como veio (formato básico), devolvida no listar; formato errado é recusado', () => {
  const ctx = novo();
  const validacao = {
    versao: 1, pares: [['D', 'C'], ['I', 'S'], ['D', 'S']], escolhas: ['D', 'I', 'D'],
    itens: [{ id: 'D-f1', letra: 'D', tipo: 'forca', nota: 5 }, { id: 'D-s1', letra: 'D', tipo: 'sombra', nota: 4 },
      { id: 'I-f2', letra: 'I', tipo: 'forca', nota: 4 }, { id: 'C-f3', letra: 'C', tipo: 'contraste', nota: 2 }],
    gruposSeg: new Array(25).fill(7.25), semMexer: 2, demonstracao: false, extra: 'ignorado'
  };
  assert.equal(ctx.post({ acao: 'enviar', payload: payloadValido({ id: 'com-validacao', validacao }) }).ok, true);
  assert.equal(ctx.post({ acao: 'enviar', payload: payloadValido({ id: 'sem-validacao' }) }).ok, true);
  const itens = ctx.post({ acao: 'listar', token: ctx.token }).itens;
  const v = itens.find((i) => i.id === 'com-validacao').validacao;
  assert.deepEqual(v.escolhas, ['D', 'I', 'D']);
  assert.equal(v.itens.length, 4);
  assert.equal(v.gruposSeg[0], 7.3);
  assert.equal(v.extra, undefined, 'só campos conhecidos');
  assert.equal(itens.find((i) => i.id === 'sem-validacao').validacao, null);

  const ruins = [
    'texto', [1], Object.assign({}, validacao, { versao: 0 }), Object.assign({}, validacao, { pares: [['D', 'X']] }),
    Object.assign({}, validacao, { escolhas: ['D', 'I', 'S', 'C'] }), Object.assign({}, validacao, { itens: [{ id: 'a', letra: 'D', tipo: 'forca', nota: 6 }] }),
    Object.assign({}, validacao, { itens: [{ id: '=x', letra: 'D', tipo: 'forca', nota: 3 }] }),
    Object.assign({}, validacao, { gruposSeg: ['3'] }), Object.assign({}, validacao, { semMexer: -1 }),
    Object.assign({}, validacao, { demonstracao: 'sim' }), Object.assign({}, validacao, { lixo: 'x'.repeat(5000) })
  ];
  ruins.forEach((ruim, i) => {
    const r = ctx.post({ acao: 'enviar', payload: payloadValido({ id: 'validacao-ruim-' + i, validacao: ruim }) });
    assert.equal(r.ok, false, JSON.stringify(ruim).slice(0, 80));
    assert.equal(r.erro, 'Dados da etapa de validação inválidos.');
  });
});

test('listar traz avaliacao, empresaId, empresaNome, avaliacaoNome e avaliacaoTipo', () => {
  const { ctx, T, eA, eB, avA, avB } = cenario();
  ctx.post({ acao: 'enviar', payload: payloadValido({ id: 'part-a-00001', avaliacao: avA.codigo }) });
  ctx.post({ acao: 'enviar', payload: payloadValido({ id: 'part-b-00001', avaliacao: avB.codigo }) });
  ctx.post({ acao: 'enviar', payload: payloadValido({ id: 'part-geral-01' }) });
  const itens = ctx.post({ acao: 'listar', token: T }).itens;
  const por = Object.fromEntries(itens.map((i) => [i.id, i]));
  assert.deepEqual(['avaliacao', 'empresaId', 'empresaNome', 'avaliacaoNome', 'avaliacaoTipo'].map((k) => por['part-a-00001'][k]),
    [avA.codigo, eA.id, 'Clínica Alfa', 'Recepção 2026', 'selecao']);
  assert.deepEqual(['avaliacao', 'empresaId', 'empresaNome', 'avaliacaoNome', 'avaliacaoTipo'].map((k) => por['part-b-00001'][k]),
    [avB.codigo, eB.id, 'Loja Beta', 'Equipe de vendas', 'equipe']);
  assert.deepEqual(['avaliacao', 'empresaId', 'empresaNome', 'avaliacaoNome', 'avaliacaoTipo'].map((k) => por['part-geral-01'][k]),
    ['', '', '', '', 'selecao']);
});

test('gestor: só vê e atualiza a própria empresa; não exclui nem cria nada', () => {
  const { ctx, TG, avA, avB, eA } = cenario();
  ctx.post({ acao: 'enviar', payload: payloadValido({ id: 'part-a-00001', avaliacao: avA.codigo }) });
  ctx.post({ acao: 'enviar', payload: payloadValido({ id: 'part-b-00001', avaliacao: avB.codigo }) });
  ctx.post({ acao: 'enviar', payload: payloadValido({ id: 'part-geral-01' }) });

  const eu = ctx.post({ acao: 'eu', token: TG }).usuario;
  assert.deepEqual(eu, { id: eu.id, nome: 'Gestora Alfa', email: 'gestora@alfa.com', papel: 'gestor', empresaId: eA.id, empresaNome: 'Clínica Alfa' });
  assert.deepEqual(ctx.post({ acao: 'listar', token: TG }).itens.map((i) => i.id), ['part-a-00001']);
  const avs = ctx.post({ acao: 'avaliacoes.listar', token: TG });
  assert.deepEqual(avs.avaliacoes.map((a) => a.codigo), [avA.codigo]);
  assert.equal(avs.avaliacoes[0].respostas, 1);

  assert.equal(ctx.post({ acao: 'atualizar', token: TG, id: 'part-a-00001', campos: { status: 'aprovado', observacoes: 'ok' } }).ok, true);
  assert.equal(ctx.post({ acao: 'atualizar', token: TG, id: 'part-b-00001', campos: { status: 'aprovado' } }).erro, 'Sem permissão.');
  assert.equal(ctx.post({ acao: 'atualizar', token: TG, id: 'part-geral-01', campos: { status: 'aprovado' } }).erro, 'Sem permissão.');

  const proibidas = [
    { acao: 'excluir', id: 'part-a-00001' }, { acao: 'excluirTodos' }, { acao: 'excluirTodos', avaliacao: avA.codigo },
    { acao: 'empresas.listar' }, { acao: 'empresas.salvar', empresa: { nome: 'Nova' } }, { acao: 'empresas.excluir', id: eA.id },
    { acao: 'avaliacoes.salvar', avaliacao: { empresaId: eA.id, nome: 'X avaliação', tipo: 'selecao' } }, { acao: 'avaliacoes.excluir', id: avA.id },
    { acao: 'usuarios.listar' }, { acao: 'usuarios.salvar', usuario: { nome: 'Outro', email: 'o@o.com', papel: 'admin' }, senhaTemporaria: '12345678' },
    { acao: 'usuarios.excluir', id: eu.id }, { acao: 'usuarios.redefinirSenha', id: eu.id, senhaTemporaria: '12345678' }
  ];
  proibidas.forEach((c) => {
    const r = ctx.post(Object.assign({ token: TG }, c));
    assert.equal(r.erro, 'Sem permissão.', c.acao);
  });
  assert.equal(ctx.aba().linhas.length, 4, 'nada excluído');
  const status = ctx.post({ acao: 'listar', token: ctx.token }).itens.map((i) => [i.id, i.status]);
  assert.deepEqual(status, [['part-a-00001', 'aprovado'], ['part-b-00001', 'em_analise'], ['part-geral-01', 'em_analise']]);
});

test('admin: empresas (criar, renomear, nome repetido, excluir com recusas)', () => {
  const { ctx, T, eA, eB, avB } = cenario();
  assert.match(ctx.post({ acao: 'empresas.salvar', token: T, empresa: { nome: ' ' } }).erro, /nome da empresa/);
  assert.equal(ctx.post({ acao: 'empresas.salvar', token: T, empresa: { nome: 'clínica alfa' } }).erro, 'Já existe uma empresa com esse nome.');
  const ren = ctx.post({ acao: 'empresas.salvar', token: T, empresa: { id: eA.id, nome: '=Clínica Alfa Nova' } });
  assert.equal(ren.ok, true, ren.erro);
  assert.equal(ctx.abas.Empresas.linhas[1][1], "'=Clínica Alfa Nova", 'protegido contra fórmula');
  assert.equal(ctx.post({ acao: 'empresas.listar', token: T }).empresas.find((e) => e.id === eA.id).nome, '=Clínica Alfa Nova');
  assert.equal(ctx.post({ acao: 'empresas.salvar', token: T, empresa: { id: 'emp_naoexiste', nome: 'X Y' } }).erro, 'Empresa não encontrada.');

  assert.match(ctx.post({ acao: 'empresas.excluir', token: T, id: eA.id }).erro, /tem avaliações/);
  assert.match(ctx.post({ acao: 'empresas.excluir', token: T, id: eB.id }).erro, /tem avaliações/);
  assert.equal(ctx.post({ acao: 'avaliacoes.excluir', token: T, id: avB.id }).ok, true);
  assert.equal(ctx.post({ acao: 'empresas.excluir', token: T, id: eB.id }).ok, true);
  const vazia = ctx.post({ acao: 'empresas.salvar', token: T, empresa: { nome: 'Empresa Sem Nada' } }).empresa;
  const g = ctx.post({ acao: 'usuarios.salvar', token: T, usuario: { nome: 'Gestor Novo', email: 'g2@x.com', papel: 'gestor', empresaId: vazia.id }, senhaTemporaria: 'temporaria2' });
  assert.equal(g.ok, true, g.erro);
  assert.match(ctx.post({ acao: 'empresas.excluir', token: T, id: vazia.id }).erro, /gestores/);
  assert.deepEqual(ctx.post({ acao: 'empresas.listar', token: T }).empresas.map((e) => e.nome).sort(), ['=Clínica Alfa Nova', 'Empresa Sem Nada']);
});

test('admin: avaliações (código único, validações, excluir recusa com respostas)', () => {
  const { ctx, T, eA, eB, avA } = cenario();
  assert.equal(ctx.post({ acao: 'avaliacoes.salvar', token: T, avaliacao: { empresaId: 'nada', nome: 'Teste X', tipo: 'selecao' } }).erro, 'Escolha uma empresa válida.');
  assert.match(ctx.post({ acao: 'avaliacoes.salvar', token: T, avaliacao: { empresaId: eA.id, nome: 'Teste X', tipo: 'outro' } }).erro, /Tipo inválido/);
  assert.match(ctx.post({ acao: 'avaliacoes.salvar', token: T, avaliacao: { empresaId: eA.id, nome: '', tipo: 'selecao' } }).erro, /nome da avaliação/);
  const codigos = new Set([avA.codigo]);
  for (let i = 0; i < 10; i++) {
    const r = ctx.post({ acao: 'avaliacoes.salvar', token: T, avaliacao: { empresaId: eA.id, nome: 'Turma ' + i, tipo: 'equipe' } });
    assert.equal(r.ok, true, r.erro);
    assert.equal(r.avaliacao.ativa, true, 'nova começa ativa');
    assert.ok(!codigos.has(r.avaliacao.codigo));
    codigos.add(r.avaliacao.codigo);
  }
  ctx.post({ acao: 'enviar', payload: payloadValido({ id: 'resp-aval-001', avaliacao: avA.codigo }) });
  assert.match(ctx.post({ acao: 'avaliacoes.excluir', token: T, id: avA.id }).erro, /Desative/);
  assert.match(ctx.post({ acao: 'avaliacoes.salvar', token: T, avaliacao: Object.assign({}, avA, { empresaId: eB.id }) }).erro, /trocar a empresa/);
  assert.equal(ctx.post({ acao: 'avaliacoes.excluir', token: T, id: 'ava_nao' }).erro, 'Avaliação não encontrada.');
  const lista = ctx.post({ acao: 'avaliacoes.listar', token: T }).avaliacoes;
  assert.equal(lista.length, 12);
  assert.equal(lista.find((a) => a.id === avA.id).respostas, 1);
  assert.equal(lista.find((a) => a.id === avA.id).empresaNome, 'Clínica Alfa');
});

test('admin: usuários (criar, e-mail repetido, nunca devolve hash/sal, redefinir senha, recusas)', () => {
  const { ctx, T, eA, gestor } = cenario();
  assert.equal(ctx.post({ acao: 'usuarios.salvar', token: T, usuario: { nome: 'Sem Senha', email: 's@x.com', papel: 'admin' } }).erro, 'Defina uma senha temporária para o novo usuário.');
  assert.match(ctx.post({ acao: 'usuarios.salvar', token: T, usuario: { nome: 'Curta', email: 'c@x.com', papel: 'admin' }, senhaTemporaria: '123' }).erro, /pelo menos 8/);
  assert.equal(ctx.post({ acao: 'usuarios.salvar', token: T, usuario: { nome: 'Repetido', email: 'GESTORA@alfa.com', papel: 'admin' }, senhaTemporaria: '12345678' }).erro, 'Já existe um usuário com este e-mail.');
  assert.equal(ctx.post({ acao: 'usuarios.salvar', token: T, usuario: { nome: 'Gestor Sem', email: 'gs@x.com', papel: 'gestor', empresaId: '' }, senhaTemporaria: '12345678' }).erro, 'Escolha a empresa do gestor.');
  assert.match(ctx.post({ acao: 'usuarios.salvar', token: T, usuario: { nome: 'Chefe', email: 'ch@x.com', papel: 'dono' }, senhaTemporaria: '12345678' }).erro, /Papel inválido/);

  const lista = ctx.post({ acao: 'usuarios.listar', token: T });
  assert.equal(lista.usuarios.length, 2);
  const txt = JSON.stringify(lista);
  assert.ok(!/hash|"sal"|tentativas|senha/.test(txt), 'sem dados de senha: ' + txt);
  assert.equal(lista.usuarios.find((u) => u.id === gestor.id).empresaNome, 'Clínica Alfa');

  // redefinir senha do gestor
  assert.equal(ctx.post({ acao: 'usuarios.redefinirSenha', token: T, id: gestor.id, senhaTemporaria: 'novatemp99' }).ok, true);
  assert.equal(ctx.post({ acao: 'login', email: 'gestora@alfa.com', senha: 'temporaria1' }).ok, false);
  assert.equal(ctx.post({ acao: 'login', email: 'gestora@alfa.com', senha: 'novatemp99' }).ok, true);
  // desativar o gestor derruba o login dele
  const TG = ctx.post({ acao: 'login', email: 'gestora@alfa.com', senha: 'novatemp99' }).token;
  assert.equal(ctx.post({ acao: 'usuarios.salvar', token: T, usuario: Object.assign({}, gestor, { ativo: false }) }).ok, true);
  assert.equal(ctx.post({ acao: 'eu', token: TG }).sessaoExpirada, true);
  assert.equal(ctx.post({ acao: 'login', email: 'gestora@alfa.com', senha: 'novatemp99' }).erro, 'E-mail ou senha incorretos.');

  // não exclui a si mesmo nem o último admin; não se rebaixa
  assert.equal(ctx.post({ acao: 'usuarios.excluir', token: T, id: ctx.adminId }).erro, 'Você não pode excluir o seu próprio acesso.');
  assert.match(ctx.post({ acao: 'usuarios.salvar', token: T, usuario: { id: ctx.adminId, nome: 'Dona', email: ADMIN.email, papel: 'gestor', empresaId: eA.id } }).erro, /próprio acesso/);
  const outro = ctx.post({ acao: 'usuarios.salvar', token: T, usuario: { nome: 'Outro Admin', email: 'outro@x.com', papel: 'admin' }, senhaTemporaria: '12345678' }).usuario;
  const TO = ctx.post({ acao: 'login', email: 'outro@x.com', senha: '12345678' }).token;
  assert.equal(ctx.post({ acao: 'usuarios.excluir', token: TO, id: ctx.adminId }).ok, true, 'com outro admin ativo, pode');
  assert.equal(ctx.post({ acao: 'usuarios.excluir', token: TO, id: outro.id }).erro, 'Você não pode excluir o seu próprio acesso.');
  assert.equal(ctx.post({ acao: 'eu', token: T }).sessaoExpirada, true, 'usuário excluído perde a sessão');
  assert.equal(ctx.post({ acao: 'usuarios.excluir', token: TO, id: 'usr_nao' }).erro, 'Usuário não encontrado.');
  assert.equal(ctx.post({ acao: 'usuarios.excluir', token: TO, id: gestor.id }).ok, true);
});

test('o último administrador ativo não pode ser excluído nem desativado por outro caminho', () => {
  const ctx = novo();
  // admin inativo não conta
  const r = ctx.post({ acao: 'usuarios.salvar', token: ctx.token, usuario: { nome: 'Admin Inativo', email: 'ina@x.com', papel: 'admin', ativo: false }, senhaTemporaria: '12345678' });
  assert.equal(r.ok, true, r.erro);
  assert.equal(ctx.post({ acao: 'usuarios.excluir', token: ctx.token, id: r.usuario.id }).ok, true, 'excluir um admin inativo é permitido');
  assert.equal(ctx.post({ acao: 'usuarios.excluir', token: ctx.token, id: ctx.adminId }).ok, false);
});

test('excluirTodos com "avaliacao" apaga só daquela avaliação', () => {
  const { ctx, T, avA, avB } = cenario();
  ['a1-000001', 'a2-000002'].forEach((id) => ctx.post({ acao: 'enviar', payload: payloadValido({ id, avaliacao: avA.codigo }) }));
  ctx.post({ acao: 'enviar', payload: payloadValido({ id: 'b1-000001', avaliacao: avB.codigo }) });
  ctx.post({ acao: 'enviar', payload: payloadValido({ id: 'g1-000001' }) });
  ctx.post({ acao: 'enviar', payload: payloadValido({ id: 'a3-000003', avaliacao: avA.codigo }) });
  const r = ctx.post({ acao: 'excluirTodos', token: T, avaliacao: avA.codigo.toLowerCase() });
  assert.deepEqual(r, { ok: true, excluidos: 3, avaliacao: avA.codigo });
  assert.deepEqual(ctx.post({ acao: 'listar', token: T }).itens.map((i) => i.id), ['b1-000001', 'g1-000001']);
  assert.equal(ctx.post({ acao: 'excluirTodos', token: T, avaliacao: '!!' }).ok, false);
  assert.equal(ctx.post({ acao: 'excluirTodos', token: T }).excluidos, 2);
});

test('segurança: e-mail inexistente recebe a mesma mensagem e o mesmo bloqueio de um e-mail cadastrado', () => {
  const ctx = novo();
  const generico = 'E-mail ou senha incorretos.';
  const bloqueio = 'Muitas tentativas. Tente de novo em 15 minutos.';
  const seq = (email) => Array.from({ length: 6 }, (_, i) => ctx.post({ acao: 'login', email, senha: 'errada-' + i }).erro);
  const existente = seq(ADMIN.email);
  const inexistente = seq('ninguem@empresa.com');
  assert.deepEqual(existente, [generico, generico, generico, generico, bloqueio, bloqueio]);
  assert.deepEqual(inexistente, existente, 'não dá para descobrir se o e-mail existe');
  assert.ok(Object.keys(ctx.cache).every((k) => !k.includes('ninguem')), 'e-mail não vai em texto puro para o cache');
  ctx.avancar(15 * 60 * 1000 + 1000);
  assert.equal(ctx.post({ acao: 'login', email: 'ninguem@empresa.com', senha: 'x1234567' }).erro, generico, 'bloqueio acaba em 15 min');
  assert.equal(ctx.abas.Usuarios.linhas.length, 2, 'nada gravado na planilha para e-mail inexistente');
});

test('segurança: gestor não alcança outra empresa nem com campos extras no corpo', () => {
  const { ctx, T, TG, avA, avB, eA, eB, gestor } = cenario();
  ctx.post({ acao: 'enviar', payload: payloadValido({ id: 'part-a-00009', avaliacao: avA.codigo }) });
  ctx.post({ acao: 'enviar', payload: payloadValido({ id: 'part-b-00009', avaliacao: avB.codigo }) });
  const extra = { empresaId: eB.id, usuario: { papel: 'admin', empresaId: eB.id }, papel: 'admin', usuarioId: 'x' };
  assert.deepEqual(ctx.post(Object.assign({ acao: 'listar', token: TG }, extra)).itens.map((i) => i.id), ['part-a-00009']);
  assert.deepEqual(ctx.post(Object.assign({ acao: 'avaliacoes.listar', token: TG }, extra)).avaliacoes.map((a) => a.codigo), [avA.codigo]);
  assert.equal(ctx.post(Object.assign({ acao: 'eu', token: TG }, extra)).usuario.papel, 'gestor');
  assert.equal(ctx.post(Object.assign({ acao: 'atualizar', token: TG, id: 'part-b-00009', campos: { status: 'reprovado' } }, extra)).erro, 'Sem permissão.');
  // só status/observações: outros campos não mudam nada (nem mover a resposta para outra empresa)
  assert.equal(ctx.post({ acao: 'atualizar', token: TG, id: 'part-a-00009', campos: { empresaId: eB.id, avaliacao: avB.codigo, nome: 'Outro Nome' } }).erro, 'Nada para atualizar.');
  const cab = ctx.aba().linhas[0];
  const linhaA = ctx.aba().linhas.find((l) => l[0] === 'part-a-00009');
  assert.equal(linhaA[cab.indexOf('empresaId')], eA.id);
  // admin muda a gestora para a outra empresa: a mesma sessão passa a ver só a nova empresa
  const mov = ctx.post({ acao: 'usuarios.salvar', token: T, usuario: Object.assign({}, gestor, { empresaId: eB.id }) });
  assert.equal(mov.ok, true, mov.erro);
  assert.deepEqual(ctx.post({ acao: 'listar', token: TG }).itens.map((i) => i.id), ['part-b-00009']);
  // desativada: a sessão cai na hora
  ctx.post({ acao: 'usuarios.salvar', token: T, usuario: Object.assign({}, gestor, { empresaId: eB.id, ativo: false }) });
  assert.equal(ctx.post({ acao: 'listar', token: TG }).sessaoExpirada, true);
  // ação com nome de propriedade herdada não vira função
  ['__proto__', 'constructor', 'toString', 'hasOwnProperty'].forEach((acao) => {
    assert.equal(ctx.post({ acao, token: T }).erro, 'Ação desconhecida.', acao);
  });
});

test('planilha antiga com Respostas até "empresa": atualiza sem perder nada e as abas novas nascem sozinhas', () => {
  const ctx = carregarGas({ props: { ADMIN_KEY: CHAVE } });
  const antigo = ctx.g.CABECALHO.slice(0, ctx.g.CABECALHO.indexOf('empresa') + 1);
  const linhaVelha = ctx.g.montarLinha(Object.assign(ctx.g.validarPayload(payloadValido({ id: 'antigo-000001' })).payload), '2026-01-01T00:00:00.000Z', '12A').slice(0, antigo.length);
  ctx.g.SpreadsheetApp.getActiveSpreadsheet().insertSheet('Respostas');
  ctx.abas.Respostas.linhas.push(antigo.slice(), linhaVelha);
  assert.equal(ctx.abas.Usuarios, undefined);
  const r = ctx.post(Object.assign({ acao: 'primeiroAcesso', chave: CHAVE }, ADMIN));
  assert.equal(r.ok, true, r.erro);
  const itens = ctx.post({ acao: 'listar', token: r.token }).itens;
  assert.equal(itens.length, 1);
  assert.equal(itens[0].id, 'antigo-000001');
  assert.equal(itens[0].avaliacao, '');
  assert.equal(itens[0].empresaId, '');
  assert.equal(itens[0].avaliacaoTipo, 'selecao');
  assert.equal(itens[0].validacao, null);
  assert.deepEqual(ctx.abas.Respostas.linhas[0], ctx.g.CABECALHO, 'colunas avaliacao e empresaId no fim');
  ['Usuarios', 'Empresas', 'Avaliacoes'].forEach((n) => assert.ok(ctx.abas[n], 'aba ' + n + ' criada'));
  assert.equal(ctx.post({ acao: 'enviar', payload: payloadValido({ id: 'novo-0000001' }) }).ok, true);
  assert.equal(ctx.abas.Respostas.linhas[2].length, ctx.g.CABECALHO.length);
});
