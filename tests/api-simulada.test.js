'use strict';
// API simulada (js/api-simulada.js) rodando no Node com um localStorage falso.
// Confere que ela se comporta como o apps-script/Code.gs (mesmas regras e mensagens).
const test = require('node:test');
const assert = require('node:assert/strict');
const SIM = require('../js/api-simulada.js');
const S = require('../js/scoring.js');
const { carregarGas } = require('./helpers/gas.js');
const { payloadValido, respostasFixas, prng } = require('./helpers/fixtures.js');

const RE_PROTOCOLO = /^[0-9]{2}[A-HJ-NP-Z]$/;

function localStorageFalso(inicial) {
  const dados = Object.assign({}, inicial || {});
  return {
    dados,
    getItem: (k) => (Object.prototype.hasOwnProperty.call(dados, k) ? dados[k] : null),
    setItem: (k, v) => { dados[k] = String(v); },
    removeItem: (k) => { delete dados[k]; }
  };
}

function nova(extra) {
  const armazenamento = localStorageFalso();
  const api = SIM.criar(Object.assign({ armazenamento, scoring: S, latenciaMs: 0 }, extra || {}));
  return { api, armazenamento };
}

test('enviar gera protocolo no formato do contrato e grava na chave disc_planilha_simulada', async () => {
  const { api, armazenamento } = nova();
  const r = await api.enviar(payloadValido());
  assert.equal(r.ok, true);
  assert.equal(r.id, 'lx1abc-teste01');
  assert.match(r.protocolo, RE_PROTOCOLO);
  assert.equal(SIM.CHAVE_ARMAZENAMENTO, 'disc_planilha_simulada');
  const salvo = JSON.parse(armazenamento.dados.disc_planilha_simulada);
  assert.equal(salvo.length, 1);
  assert.equal(salvo[0].protocolo, r.protocolo);
});

test('reenvio do mesmo id devolve o mesmo protocolo sem duplicar', async () => {
  const { api } = nova();
  const p = payloadValido();
  const r1 = await api.enviar(p);
  const r2 = await api.enviar(p);
  assert.deepEqual(r2, { ok: true, duplicado: true, id: p.id, protocolo: r1.protocolo });
  assert.equal(api.ler().length, 1);
});

test('protocolos únicos; quase cheia acha o único livre; cheia recusa com "Limite de códigos atingido"', async () => {
  const todos = [];
  for (let n = 0; n < 100; n++) for (const l of 'ABCDEFGHJKLMNPQRSTUVWXYZ') todos.push(String(n).padStart(2, '0') + l);
  assert.equal(todos.length, 2400);
  const livre = '71Q';
  assert.equal(SIM.gerarProtocolo(Object.fromEntries(todos.filter((p) => p !== livre).map((p) => [p, true])), prng(3)), livre);
  assert.throws(() => SIM.gerarProtocolo(Object.fromEntries(todos.map((p) => [p, true]))), /Limite de códigos atingido/);

  // Pela API: a planilha falsa já com 2.399 linhas usadas (o limite de 500 linhas não deixaria
  // chegar aí num uso real; aqui o alvo é só o protocolo, então o teste vai direto ao gerador).
  const { api } = nova({ aleatorio: prng(11) });
  const vistos = new Set();
  for (let i = 0; i < 25; i++) {
    const r = await api.enviar(payloadValido({ id: 'simulado-' + String(i).padStart(3, '0') }));
    assert.match(r.protocolo, RE_PROTOCOLO);
    assert.ok(!vistos.has(r.protocolo));
    vistos.add(r.protocolo);
  }
});

test('listar/atualizar/excluir/excluirTodos exigem a chave "previa"', async () => {
  const { api } = nova();
  await api.enviar(payloadValido());
  for (const chamada of [
    () => api.listar('errada'),
    () => api.atualizar('errada', 'lx1abc-teste01', { status: 'aprovado' }),
    () => api.excluir('errada', 'lx1abc-teste01'),
    () => api.excluirTodos('Previa ')
  ]) {
    await assert.rejects(chamada(), /Chave de administrador inválida\./);
  }
  await assert.rejects(api.listar(''), /Informe a chave de acesso/);
  const l = await api.listar(' previa ');
  assert.equal(l.itens.length, 1);
  assert.equal(SIM.CHAVE_ADMIN, 'previa');
});

test('listar recalcula o perfil pelas respostas (ignora o resultado enviado) e devolve protocolo', async () => {
  const { api } = nova();
  const p = payloadValido({
    respostas: S.compactar(respostasFixas(['S', 'C', 'I', 'D'])),
    resultado: { percentuais: { D: 40, I: 30, S: 20, C: 10 }, codigo: 'DI' },
    telefone: '(21) 98888-7777'
  });
  const r = await api.enviar(p);
  const { itens } = await api.listar('previa');
  assert.equal(itens[0].resultado.codigo, 'SC');
  assert.equal(itens[0].telefone, '5521988887777');
  assert.equal(itens[0].status, 'em_analise');
  assert.equal(itens[0].observacoes, '');
  assert.equal(itens[0].protocolo, r.protocolo);
  assert.ok(!isNaN(Date.parse(itens[0].recebidoEm)));
});

test('atualizar, excluir e excluirTodos', async () => {
  const { api } = nova();
  await api.enviar(payloadValido({ id: 'id-aaaaaa1' }));
  await api.enviar(payloadValido({ id: 'id-bbbbbb2' }));
  await api.atualizar('previa', 'id-aaaaaa1', { status: 'aprovado', observacoes: 'Boa.\nContratar.' });
  let { itens } = await api.listar('previa');
  const a = itens.find((i) => i.id === 'id-aaaaaa1');
  assert.equal(a.status, 'aprovado');
  assert.equal(a.observacoes, 'Boa.\nContratar.');
  await assert.rejects(api.atualizar('previa', 'id-aaaaaa1', { status: 'contratado' }), /Status inválido/);
  await assert.rejects(api.atualizar('previa', 'nao-existe-1', { status: 'aprovado' }), /não encontrado/);
  await api.excluir('previa', 'id-bbbbbb2');
  await assert.rejects(api.excluir('previa', 'id-bbbbbb2'), /não encontrado/);
  const t = await api.excluirTodos('previa');
  assert.equal(t.excluidos, 1);
  ({ itens } = await api.listar('previa'));
  assert.deepEqual(itens, []);
});

test('mesmas mensagens de erro do Code.gs para payloads inválidos', async () => {
  const gas = carregarGas({ props: { ADMIN_KEY: 'k' } });
  const { api } = nova();
  const casos = [
    { respostas: '4321'.repeat(24) }, { respostas: '4421'.repeat(25) }, { nome: 'Jo' }, { nome: 'Joãozinho' },
    { telefone: '1234' }, { consentimento: false }, { consentimento: 'true' }, { id: 'a b' }, { id: '' }
  ];
  for (const extra of casos) {
    const esperado = gas.post({ acao: 'enviar', payload: payloadValido(extra) });
    assert.equal(esperado.ok, false);
    assert.deepEqual(api.processar({ acao: 'enviar', payload: payloadValido(extra) }), esperado, JSON.stringify(extra));
    await assert.rejects(api.enviar(payloadValido(extra)), { message: esperado.erro });
  }
  assert.deepEqual(api.processar({ acao: 'hackear' }), gas.post({ acao: 'hackear' }));
  assert.deepEqual(api.processar({ acao: 'enviar' }), gas.post({ acao: 'enviar' }));
});

test('mesmo comportamento do Code.gs num roteiro completo (fora protocolo e data)', async () => {
  const gas = carregarGas({ props: { ADMIN_KEY: 'previa' } });
  const { api } = nova();
  const roteiro = [
    { acao: 'enviar', payload: payloadValido({ id: 'roteiro-0001', nome: '=HYPERLINK("x") Silva', vaga: '+SUM(A1)' }) },
    { acao: 'enviar', payload: payloadValido({ id: 'roteiro-0002', nome: 'Ana Paula Reis', respostas: S.compactar(respostasFixas(['C', 'S', 'I', 'D'])) }) },
    { acao: 'enviar', payload: payloadValido({ id: 'roteiro-0001' }) },
    { acao: 'atualizar', chave: 'previa', id: 'roteiro-0001', campos: { status: 'reprovado', observacoes: '@nota' } },
    { acao: 'atualizar', chave: 'previa', id: 'roteiro-0002', campos: {} },
    { acao: 'excluir', chave: 'previa', id: 'xxxxxx' },
    { acao: 'listar', chave: 'previa' },
    { acao: 'listar', chave: 'nao' }
  ];
  const limpar = (r) => JSON.parse(JSON.stringify(r, (k, v) => (k === 'protocolo' || k === 'recebidoEm' ? undefined : v)));
  for (const corpo of roteiro) {
    assert.deepEqual(limpar(api.processar(corpo)), limpar(gas.post(corpo)), corpo.acao + ' ' + (corpo.id || (corpo.payload && corpo.payload.id) || ''));
  }
});

test('sem localStorage (navegação privada) funciona só em memória', async () => {
  const quebrado = { getItem() { throw new Error('bloqueado'); }, setItem() { throw new Error('bloqueado'); } };
  const api = SIM.criar({ armazenamento: quebrado, scoring: S, latenciaMs: 0 });
  const r = await api.enviar(payloadValido());
  assert.match(r.protocolo, RE_PROTOCOLO);
  const { itens } = await api.listar('previa');
  assert.equal(itens.length, 1);
  // conteúdo corrompido no armazenamento não derruba
  const lsRuim = localStorageFalso({ disc_planilha_simulada: '{não é json' });
  const api2 = SIM.criar({ armazenamento: lsRuim, scoring: S, latenciaMs: 0 });
  assert.deepEqual((await api2.listar('previa')).itens, []);
});

test('instalar só troca o DISC_API quando API_URL === "simulada"', async () => {
  const API = require('../js/api.js');
  const falso = { enviar: () => 'real', listar: () => 'real', atualizar() {}, excluir() {}, excluirTodos() {}, configurado: () => false };
  assert.equal(SIM.instalar(falso, { API_URL: '' }), null);
  assert.equal(SIM.instalar(falso, { API_URL: 'https://script.google.com/macros/s/x/exec' }), null);
  assert.equal(falso.enviar(), 'real');
  const sim = SIM.instalar(falso, { API_URL: 'simulada' }, { armazenamento: localStorageFalso(), scoring: S, latenciaMs: 0 });
  assert.ok(sim);
  assert.equal(falso.simulada, true);
  assert.equal(falso.configurado(), true);
  const r = await falso.enviar(payloadValido());
  assert.match(r.protocolo, RE_PROTOCOLO);
  // helpers de protocolo do js/api.js (usados pelas telas)
  assert.equal(API.normalizarProtocolo(' 4 7k'), '47K');
  assert.equal(API.protocoloValido('47K'), true);
  assert.equal(API.protocoloValido('47O'), false);
});

test('latência simulada padrão de ~400 ms', async () => {
  assert.equal(SIM.LATENCIA_MS, 400);
  const api = SIM.criar({ armazenamento: localStorageFalso(), scoring: S, latenciaMs: 30 });
  const t0 = Date.now();
  await api.enviar(payloadValido());
  assert.ok(Date.now() - t0 >= 25);
});
