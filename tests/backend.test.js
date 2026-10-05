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
    'respostas', 'D', 'I', 'S', 'C', 'perfil', 'status', 'observacoes', 'payloadJson', 'protocolo',
    'idade', 'funcao', 'empresa']);
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
  const itens = ctx.post({ acao: 'listar', chave: CHAVE }).itens;
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
  let l = ctx.post({ acao: 'listar', chave: CHAVE });
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

  l = ctx.post({ acao: 'listar', chave: CHAVE });
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
  const item = ctx.post({ acao: 'listar', chave: CHAVE }).itens[0];
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
  const itens = ctx.post({ acao: 'listar', chave: CHAVE }).itens;
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
  const itens = ctx.post({ acao: 'listar', chave: CHAVE }).itens;
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

  let l = ctx.post({ acao: 'listar', chave: CHAVE });
  assert.equal(l.ok, true, l.erro);
  assert.deepEqual(aba.linhas[0], ctx.g.CABECALHO.slice());
  assert.deepEqual([...aba.linhas[0].slice(-4)], ['protocolo', 'idade', 'funcao', 'empresa']);
  assert.equal(aba.maxColunas, 21);
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
  l = ctx.post({ acao: 'listar', chave: CHAVE });
  assert.deepEqual(l.itens.map((i) => i.idade), [null, 41]);
});
