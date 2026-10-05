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

// Planilha falsa SEM a semente da prévia, com um admin criado pelo "Primeiro acesso" (chave "previa").
function nova(extra) {
  const armazenamento = localStorageFalso();
  const api = SIM.criar(Object.assign({ armazenamento, scoring: S, latenciaMs: 0, semente: false }, extra || {}));
  const r = api.processar({ acao: 'primeiroAcesso', chave: 'previa', nome: 'Dona do Sistema', email: 'dona@empresa.com', senha: 'senha-forte-1' });
  if (!r.ok) throw new Error(r.erro);
  return { api, armazenamento, T: r.token };
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

test('ações do painel exigem sessão; a chave "previa" só serve para o primeiro acesso', async () => {
  const { api, T } = nova();
  await api.enviar(payloadValido());
  for (const chamada of [
    () => api.listar('previa'),
    () => api.atualizar('errado', 'lx1abc-teste01', { status: 'aprovado' }),
    () => api.excluir('f'.repeat(64), 'lx1abc-teste01'),
    () => api.excluirTodos(T + 'x'),
    () => api.listar('')
  ]) {
    await assert.rejects(chamada(), (e) => e.message === 'Sessão expirada. Entre de novo.' && e.sessaoExpirada === true);
  }
  const l = await api.listar(T);
  assert.equal(l.itens.length, 1);
  assert.equal(SIM.CHAVE_ADMIN, 'previa');
  await assert.rejects(api.primeiroAcesso('errada', 'Nome Teste', 'n@x.com', '12345678'), /Chave de primeiro acesso inválida/);
});

test('listar recalcula o perfil pelas respostas (ignora o resultado enviado) e devolve protocolo', async () => {
  const { api, T } = nova();
  const p = payloadValido({
    respostas: S.compactar(respostasFixas(['S', 'C', 'I', 'D'])),
    resultado: { percentuais: { D: 40, I: 30, S: 20, C: 10 }, codigo: 'DI' },
    telefone: '(21) 98888-7777'
  });
  const r = await api.enviar(p);
  const { itens } = await api.listar(T);
  assert.equal(itens[0].resultado.codigo, 'SC');
  assert.equal(itens[0].telefone, '5521988887777');
  assert.equal(itens[0].status, 'em_analise');
  assert.equal(itens[0].observacoes, '');
  assert.equal(itens[0].protocolo, r.protocolo);
  assert.ok(!isNaN(Date.parse(itens[0].recebidoEm)));
});

test('atualizar, excluir e excluirTodos', async () => {
  const { api, T } = nova();
  await api.enviar(payloadValido({ id: 'id-aaaaaa1' }));
  await api.enviar(payloadValido({ id: 'id-bbbbbb2' }));
  await api.atualizar(T, 'id-aaaaaa1', { status: 'aprovado', observacoes: 'Boa.\nContratar.' });
  let { itens } = await api.listar(T);
  const a = itens.find((i) => i.id === 'id-aaaaaa1');
  assert.equal(a.status, 'aprovado');
  assert.equal(a.observacoes, 'Boa.\nContratar.');
  await assert.rejects(api.atualizar(T, 'id-aaaaaa1', { status: 'contratado' }), /Status inválido/);
  await assert.rejects(api.atualizar(T, 'nao-existe-1', { status: 'aprovado' }), /não encontrado/);
  await api.excluir(T, 'id-bbbbbb2');
  await assert.rejects(api.excluir(T, 'id-bbbbbb2'), /não encontrado/);
  const t = await api.excluirTodos(T);
  assert.equal(t.excluidos, 1);
  ({ itens } = await api.listar(T));
  assert.deepEqual(itens, []);
});

test('mesmas mensagens de erro do Code.gs para payloads inválidos', async () => {
  const gas = carregarGas({ props: { ADMIN_KEY: 'k' } });
  const { api } = nova();
  const casos = [
    { respostas: '4321'.repeat(24) }, { respostas: '4421'.repeat(25) }, { nome: 'Jo' }, { nome: 'Joãozinho' },
    { telefone: '1234' }, { consentimento: false }, { consentimento: 'true' }, { id: 'a b' }, { id: '' },
    { idade: null }, { idade: '' }, { idade: 13 }, { idade: 100 }, { idade: 30.5 }, { idade: 'trinta' }
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
    { acao: 'enviar', payload: payloadValido({ id: 'roteiro-0003', idade: '52', funcao: '  -Gerente  ', empresa: 'E'.repeat(100) }) },
    { acao: 'enviar', payload: payloadValido({ id: 'roteiro-0001' }) },
    { acao: 'listar', chave: 'previa' },
    { acao: 'listar', token: 'nao' }
  ];
  const limpar = (r) => JSON.parse(JSON.stringify(r, (k, v) => (k === 'protocolo' || k === 'recebidoEm' ? undefined : v)));
  for (const corpo of roteiro) {
    assert.deepEqual(limpar(api.processar(corpo)), limpar(gas.post(corpo)), corpo.acao + ' ' + ((corpo.payload && corpo.payload.id) || ''));
  }
});

test('sem localStorage (navegação privada) funciona só em memória', async () => {
  const quebrado = { getItem() { throw new Error('bloqueado'); }, setItem() { throw new Error('bloqueado'); } };
  const api = SIM.criar({ armazenamento: quebrado, scoring: S, latenciaMs: 0 });
  const r = await api.enviar(payloadValido());
  assert.match(r.protocolo, RE_PROTOCOLO);
  const login = await api.login('admin@previa.com', 'previa123');
  const { itens } = await api.listar(login.token);
  assert.equal(itens.length, 5, '4 exemplos da semente + o envio');
  // conteúdo corrompido no armazenamento não derruba
  const lsRuim = localStorageFalso({ disc_planilha_simulada: '{não é json', disc_simulada_semente: '1' });
  const api2 = SIM.criar({ armazenamento: lsRuim, scoring: S, latenciaMs: 0 });
  const p = await api2.primeiroAcesso('previa', 'Nova Pessoa', 'nova@x.com', '12345678');
  assert.deepEqual((await api2.listar(p.token)).itens, []);
});

test('instalar só troca o DISC_API quando API_URL === "simulada"', async () => {
  const API = require('../js/api.js');
  const falso = { enviar: () => 'real', listar: () => 'real', atualizar() {}, excluir() {}, excluirTodos() {}, configurado: () => false };
  // a simulada troca exatamente os métodos de servidor do js/api.js
  assert.deepEqual(SIM.METODOS, API.METODOS);
  API.METODOS.forEach((m) => assert.equal(typeof API[m], 'function', m));
  assert.equal(SIM.instalar(falso, { API_URL: '' }), null);
  assert.equal(SIM.instalar(falso, { API_URL: 'https://script.google.com/macros/s/x/exec' }), null);
  assert.equal(falso.enviar(), 'real');
  const sim = SIM.instalar(falso, { API_URL: 'simulada' }, { armazenamento: localStorageFalso(), scoring: S, latenciaMs: 0 });
  assert.ok(sim);
  assert.equal(falso.simulada, true);
  API.METODOS.forEach((m) => assert.equal(typeof falso[m], 'function', m));
  assert.equal(falso.PREVIA.admin.email, 'admin@previa.com');
  assert.equal(typeof falso.reiniciarSimulada, 'function');
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
  const api = SIM.criar({ armazenamento: localStorageFalso(), scoring: S, latenciaMs: 30, semente: false });
  const t0 = Date.now();
  await api.enviar(payloadValido());
  assert.ok(Date.now() - t0 >= 25);
});

test('idade ausente: mesma recusa do Code.gs; listar devolve idade/funcao/empresa e "null" para linhas antigas', async () => {
  const gas = carregarGas({ props: { ADMIN_KEY: 'k' } });
  const { api, armazenamento, T } = nova();
  const semIdade = payloadValido({ id: 'sem-idade-01' });
  delete semIdade.idade;
  const esperado = gas.post({ acao: 'enviar', payload: semIdade });
  assert.equal(esperado.ok, false);
  assert.match(esperado.erro, /Idade não informada/);
  assert.deepEqual(api.processar({ acao: 'enviar', payload: semIdade }), esperado);

  assert.equal((await api.enviar(payloadValido({ id: 'com-idade-01', idade: 33 }))).ok, true);
  // Linha gravada por uma versão anterior da prévia (sem os campos novos)
  const linhas = JSON.parse(armazenamento.getItem(SIM.CHAVE_ARMAZENAMENTO));
  const antiga = Object.assign({}, linhas[0], { id: 'antiga-0001' });
  delete antiga.idade; delete antiga.funcao; delete antiga.empresa;
  linhas.push(antiga);
  armazenamento.setItem(SIM.CHAVE_ARMAZENAMENTO, JSON.stringify(linhas));
  const { itens } = await api.listar(T);
  assert.deepEqual(itens.map((i) => [i.id, i.idade, i.funcao, i.empresa]), [
    ['com-idade-01', 33, 'Recepcionista', 'Loja Centro'],
    ['antiga-0001', null, '', '']
  ]);
});

// ---------------------------------------------------------------------------
// Logins, empresas, avaliações e semente da prévia
// ---------------------------------------------------------------------------

test('hash de senha igual ao do Code.gs (SHA-256 em JS puro conferido com o do Node)', () => {
  const crypto = require('node:crypto');
  ['', 'abc', 'é ç 漢字 😀', 'x'.repeat(55), 'x'.repeat(56), 'y'.repeat(1000)].forEach((s) => {
    assert.equal(SIM.sha256Hex(s), crypto.createHash('sha256').update(s, 'utf8').digest('hex'), 'tamanho ' + s.length);
  });
  const gas = carregarGas();
  assert.equal(SIM.hashSenha('previa123', 'sal-abc'), gas.g.hashSenha('previa123', 'sal-abc'));
});

test('semente da prévia: admin e gestor, Clínica Exemplo, SEL1/EQP1 e 4 respostas com validação variada', async () => {
  const armazenamento = localStorageFalso();
  const api = SIM.criar({ armazenamento, scoring: S, latenciaMs: 0 });
  const adm = await api.login('admin@previa.com', 'previa123');
  assert.deepEqual(adm.usuario, { id: adm.usuario.id, nome: 'Você (admin)', email: 'admin@previa.com', papel: 'admin', empresaId: '', empresaNome: '' });
  const ges = await api.login('GESTOR@previa.com', 'previa123');
  assert.equal(ges.usuario.papel, 'gestor');
  assert.equal(ges.usuario.empresaNome, 'Clínica Exemplo');

  const avs = (await api.listarAvaliacoes(adm.token)).avaliacoes;
  assert.deepEqual(avs.map((a) => [a.codigo, a.nome, a.tipo, a.mostrarResultado, a.ativa, a.empresaNome, a.respostas]), [
    ['SEL1', 'Recepcionista 2026', 'selecao', false, true, 'Clínica Exemplo', 2],
    ['EQP1', 'Equipe comercial', 'equipe', true, true, 'Clínica Exemplo', 2],
    ['CRT1', 'Cartório Exemplo — Escrevente', 'selecao', false, true, 'Cartório Exemplo', 0]
  ]);
  const { itens } = await api.listar(adm.token);
  assert.equal(itens.length, 4);
  itens.forEach((i) => {
    assert.ok(i.resultado, i.nome);
    assert.match(i.protocolo, RE_PROTOCOLO);
    assert.ok(/Exemplo|Fictício|Modelo/.test(i.nome), 'nome fictício óbvio: ' + i.nome);
    assert.deepEqual(SIM.validarValidacao(i.validacao), { ok: true, validacao: i.validacao }, 'validação no formato do contrato');
    assert.equal(i.empresaNome, 'Clínica Exemplo');
  });
  // confiabilidade variada (uma baixa), se o módulo do painel já existir
  let C = null;
  try { global.DISC_SCORING = S; C = require('../js/confiabilidade.js'); } catch (e) { C = null; }
  if (C && typeof C.avaliar === 'function') {
    const niveis = itens.map((i) => C.avaliar(i.respostas, i.validacao).nivel);
    assert.ok(niveis.includes('baixa'), niveis.join(','));
    assert.ok(niveis.includes('alta'), niveis.join(','));
  }
  // a semente só é criada uma vez (recarregar a página não duplica)
  const api2 = SIM.criar({ armazenamento, scoring: S, latenciaMs: 0 });
  assert.equal((await api2.listar(adm.token)).itens.length, 4, 'sessão continua valendo depois de recarregar');
  assert.equal((await api2.listarUsuarios(adm.token)).usuarios.length, 2);
  // reiniciar volta ao estado inicial
  await api2.excluirTodos(adm.token);
  api2.reiniciar();
  const nova2 = await api2.login('admin@previa.com', 'previa123');
  assert.equal((await api2.listar(nova2.token)).itens.length, 4);
  assert.ok(!JSON.stringify(armazenamento.dados).includes('previa123'), 'senha nunca guardada');
});

test('prévia: avaliacaoPublica, enviar com código ativo/inativo/inexistente e gestor só da própria empresa', async () => {
  const api = SIM.criar({ armazenamento: localStorageFalso(), scoring: S, latenciaMs: 0 });
  const pub = await api.avaliacaoPublica('eqp1');
  assert.deepEqual(pub.avaliacao, { codigo: 'EQP1', nome: 'Equipe comercial', tipo: 'equipe', empresaNome: 'Clínica Exemplo', mostrarResultado: true });
  await assert.rejects(api.avaliacaoPublica('NADA'), { message: 'Link inválido ou avaliação encerrada. Fale com quem enviou o link.' });
  const r = await api.enviar(payloadValido({ id: 'link-sel1-0001', avaliacao: 'SEL1' }));
  assert.match(r.protocolo, RE_PROTOCOLO);
  await assert.rejects(api.enviar(payloadValido({ id: 'link-xxxx-0001', avaliacao: 'ZZZZ' })), { message: 'Este link de avaliação não está mais ativo.' });

  const T = (await api.login('admin@previa.com', 'previa123')).token;
  const sel = (await api.listarAvaliacoes(T)).avaliacoes.find((a) => a.codigo === 'SEL1');
  await api.salvarAvaliacao(T, Object.assign({}, sel, { ativa: false }));
  await assert.rejects(api.enviar(payloadValido({ id: 'link-sel1-0002', avaliacao: 'SEL1' })), { message: 'Este link de avaliação não está mais ativo.' });

  // empresa e avaliação de outra empresa: o gestor da Clínica Exemplo não vê
  const outra = (await api.salvarEmpresa(T, { nome: 'Outra Empresa' })).empresa;
  const av = (await api.salvarAvaliacao(T, { empresaId: outra.id, nome: 'Seleção da outra', tipo: 'selecao' })).avaliacao;
  await api.enviar(payloadValido({ id: 'outra-emp-0001', avaliacao: av.codigo }));
  await api.enviar(payloadValido({ id: 'geral-semcod-01' }));
  const TG = (await api.login('gestor@previa.com', 'previa123')).token;
  const vis = (await api.listar(TG)).itens.map((i) => i.id);
  assert.ok(vis.includes('link-sel1-0001'));
  assert.ok(!vis.includes('outra-emp-0001') && !vis.includes('geral-semcod-01'));
  assert.deepEqual((await api.listarAvaliacoes(TG)).avaliacoes.map((a) => a.codigo), ['SEL1', 'EQP1']);
  await assert.rejects(api.atualizar(TG, 'outra-emp-0001', { status: 'aprovado' }), { message: 'Sem permissão.' });
  await assert.rejects(api.excluir(TG, 'link-sel1-0001'), { message: 'Sem permissão.' });
  await assert.rejects(api.listarUsuarios(TG), { message: 'Sem permissão.' });
  assert.equal((await api.atualizar(TG, 'link-sel1-0001', { status: 'aprovado' })).ok, true);

  // excluirTodos por avaliação
  const ex = await api.excluirTodos(T, 'sel1');
  assert.deepEqual(ex, { ok: true, excluidos: 3, avaliacao: 'SEL1' });
  assert.ok(!(await api.listar(T)).itens.some((i) => i.avaliacao === 'SEL1'));
});

test('prévia: bloqueio após 5 erros por 15 minutos e sessão que expira após 6 h parada', async () => {
  let agora = Date.parse('2026-10-05T12:00:00Z');
  const api = SIM.criar({ armazenamento: localStorageFalso(), scoring: S, latenciaMs: 0, agora: () => agora });
  for (let i = 0; i < 4; i++) await assert.rejects(api.login('admin@previa.com', 'errada' + i), { message: 'E-mail ou senha incorretos.' });
  await assert.rejects(api.login('admin@previa.com', 'errada9'), { message: 'Muitas tentativas. Tente de novo em 15 minutos.' });
  await assert.rejects(api.login('admin@previa.com', 'previa123'), { message: 'Muitas tentativas. Tente de novo em 15 minutos.' });
  await assert.rejects(api.login('ninguem@previa.com', 'previa123'), { message: 'E-mail ou senha incorretos.' });
  agora += 15 * 60 * 1000 + 1;
  const { token } = await api.login('admin@previa.com', 'previa123');
  agora += 5 * 3600 * 1000;
  await api.eu(token);
  agora += 5 * 3600 * 1000;
  await api.eu(token);
  agora += 6 * 3600 * 1000 + 1;
  await assert.rejects(api.eu(token), (e) => e.sessaoExpirada === true && e.message === 'Sessão expirada. Entre de novo.');
});

// Roda o mesmo roteiro no Code.gs e na simulada. "$nome" no corpo é trocado pelo valor guardado de cada
// lado (tokens e ids são diferentes); nas respostas, esses valores voltam a ser "$nome" antes de comparar.
test('mesmo comportamento do Code.gs no roteiro de logins, empresas, avaliações e usuários', () => {
  const gas = carregarGas({ props: { ADMIN_KEY: 'previa' } });
  const sim = SIM.criar({ armazenamento: localStorageFalso(), scoring: S, latenciaMs: 0, semente: false });
  const lados = [
    { nome: 'gas', chamar: (c) => gas.post(c), vars: {} },
    { nome: 'sim', chamar: (c) => sim.processar(c), vars: {} }
  ];
  const trocar = (v, vars) => {
    if (typeof v === 'string' && v.startsWith('$')) return vars[v.slice(1)];
    if (Array.isArray(v)) return v.map((x) => trocar(x, vars));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, trocar(x, vars)]));
    return v;
  };
  const normalizar = (r, vars) => {
    let txt = JSON.stringify(r, (k, v) => (['protocolo', 'recebidoEm', 'criadaEm', 'criadoEm', 'token'].includes(k) ? undefined : v));
    Object.entries(vars).forEach(([n, val]) => { if (typeof val === 'string' && val.length >= 4) txt = txt.split(val).join('$' + n); });
    return JSON.parse(txt);
  };
  const P = (o) => payloadValido(o);
  const roteiro = [
    [{ acao: 'primeiroAcesso', chave: 'errada', nome: 'Dona', email: 'dona@x.com', senha: '12345678' }],
    [{ acao: 'primeiroAcesso', chave: 'previa', nome: 'Dona', email: 'dona@x', senha: '12345678' }],
    [{ acao: 'primeiroAcesso', chave: 'previa', nome: 'Dona', email: 'dona@x.com', senha: '1234567' }],
    [{ acao: 'primeiroAcesso', chave: 'previa', nome: 'Dona Admin', email: ' DONA@x.com ', senha: '12345678' }, (r) => ({ T: r.token, adm: r.usuario.id })],
    [{ acao: 'eu', token: '$T' }],
    [{ acao: 'empresas.salvar', token: '$T', empresa: { nome: ' ' } }],
    [{ acao: 'empresas.salvar', token: '$T', empresa: { nome: 'Clínica Alfa' } }, (r) => ({ eA: r.empresa.id })],
    [{ acao: 'empresas.salvar', token: '$T', empresa: { nome: 'CLÍNICA ALFA' } }],
    [{ acao: 'empresas.salvar', token: '$T', empresa: { nome: 'Loja Beta' } }, (r) => ({ eB: r.empresa.id })],
    [{ acao: 'empresas.salvar', token: '$T', empresa: { id: 'emp_x', nome: 'Nada Aqui' } }],
    [{ acao: 'avaliacoes.salvar', token: '$T', avaliacao: { empresaId: '$eA', nome: 'Recepção', tipo: 'selecao' } }, (r) => ({ avA: r.avaliacao.id, cA: r.avaliacao.codigo })],
    [{ acao: 'avaliacoes.salvar', token: '$T', avaliacao: { empresaId: '$eB', nome: 'Vendas', tipo: 'equipe', mostrarResultado: true } }, (r) => ({ avB: r.avaliacao.id, cB: r.avaliacao.codigo })],
    [{ acao: 'avaliacoes.salvar', token: '$T', avaliacao: { empresaId: '$eA', nome: 'X', tipo: 'selecao' } }],
    [{ acao: 'avaliacoes.salvar', token: '$T', avaliacao: { empresaId: '$eA', nome: 'Outra', tipo: 'misto' } }],
    [{ acao: 'avaliacoes.salvar', token: '$T', avaliacao: { empresaId: 'nada', nome: 'Outra', tipo: 'selecao' } }],
    [{ acao: 'avaliacaoPublica', codigo: '$cB' }],
    [{ acao: 'avaliacaoPublica', codigo: 'QQQQ' }],
    [{ acao: 'usuarios.salvar', token: '$T', usuario: { nome: 'Gestora', email: 'g@alfa.com', papel: 'gestor', empresaId: '$eA' } }],
    [{ acao: 'usuarios.salvar', token: '$T', usuario: { nome: 'Gestora', email: 'g@alfa.com', papel: 'gestor', empresaId: '' }, senhaTemporaria: '12345678' }],
    [{ acao: 'usuarios.salvar', token: '$T', usuario: { nome: 'Gestora', email: 'g@alfa.com', papel: 'gestor', empresaId: '$eA' }, senhaTemporaria: '12345678' }, (r) => ({ g: r.usuario.id })],
    [{ acao: 'usuarios.salvar', token: '$T', usuario: { nome: 'Dup', email: 'G@ALFA.com', papel: 'admin' }, senhaTemporaria: '12345678' }],
    [{ acao: 'login', email: 'g@alfa.com', senha: 'errada' }],
    [{ acao: 'login', email: 'g@alfa.com', senha: '12345678' }, (r) => ({ TG: r.token })],
    // e-mail inexistente: mesma mensagem e mesmo bloqueio na 5ª tentativa (não revela se o e-mail existe)
    ...Array.from({ length: 6 }, () => [{ acao: 'login', email: 'nao@existe.com', senha: 'qualquer1' }]),
    [{ acao: 'enviar', payload: P({ id: 'rot-a-000001', avaliacao: '$cA' }) }],
    [{ acao: 'enviar', payload: P({ id: 'rot-b-000001', avaliacao: '$cB' }) }],
    [{ acao: 'enviar', payload: P({ id: 'rot-g-000001' }) }],
    [{ acao: 'enviar', payload: P({ id: 'rot-x-000001', avaliacao: 'ZZZZ' }) }],
    [{ acao: 'enviar', payload: P({ id: 'rot-v-000001', validacao: { versao: 1 } }) }],
    [{ acao: 'listar', token: '$T' }],
    [{ acao: 'listar', token: '$TG' }],
    [{ acao: 'avaliacoes.listar', token: '$TG' }],
    // gestor tentando outra empresa com campos extras no corpo: tudo ignorado
    [{ acao: 'listar', token: '$TG', empresaId: '$eB', usuario: { papel: 'admin', empresaId: '$eB' } }],
    [{ acao: 'avaliacoes.listar', token: '$TG', empresaId: '$eB' }],
    [{ acao: 'eu', token: '$TG', papel: 'admin' }],
    [{ acao: 'atualizar', token: '$TG', id: 'rot-b-000001', empresaId: '$eB', campos: { status: 'aprovado' } }],
    [{ acao: 'atualizar', token: '$TG', id: 'rot-a-000001', campos: { empresaId: '$eB', avaliacao: '$cB', nome: 'Outro Nome' } }],
    [{ acao: 'atualizar', token: '$TG', id: 'rot-b-000001', campos: { status: 'aprovado' } }],
    [{ acao: 'atualizar', token: '$TG', id: 'rot-a-000001', campos: { status: 'aprovado', observacoes: '=ok' } }],
    [{ acao: 'excluir', token: '$TG', id: 'rot-a-000001' }],
    [{ acao: 'empresas.listar', token: '$TG' }],
    [{ acao: 'empresas.excluir', token: '$T', id: '$eA' }],
    [{ acao: 'avaliacoes.excluir', token: '$T', id: '$avA' }],
    [{ acao: 'avaliacoes.salvar', token: '$T', avaliacao: { id: '$avA', empresaId: '$eB', nome: 'Recepção', tipo: 'selecao' } }],
    [{ acao: 'avaliacoes.salvar', token: '$T', avaliacao: { id: '$avA', empresaId: '$eA', nome: 'Recepção', tipo: 'selecao', ativa: false } }],
    [{ acao: 'enviar', payload: P({ id: 'rot-a-000002', avaliacao: '$cA' }) }],
    [{ acao: 'usuarios.listar', token: '$T' }],
    [{ acao: 'usuarios.excluir', token: '$T', id: '$adm' }],
    [{ acao: 'usuarios.salvar', token: '$T', usuario: { id: '$adm', nome: 'Dona Admin', email: 'dona@x.com', papel: 'admin', ativo: false } }],
    [{ acao: 'usuarios.redefinirSenha', token: '$T', id: '$g', senhaTemporaria: 'curta' }],
    [{ acao: 'usuarios.redefinirSenha', token: '$T', id: '$g', senhaTemporaria: 'outra-senha' }],
    [{ acao: 'eu', token: '$TG' }],
    [{ acao: 'trocarSenha', token: '$T', senhaAtual: 'errada', novaSenha: 'abcdefghi' }],
    [{ acao: 'trocarSenha', token: '$T', senhaAtual: '12345678', novaSenha: 'abcdefghi' }],
    [{ acao: 'excluirTodos', token: '$T', avaliacao: '$cB' }],
    [{ acao: 'excluirTodos', token: '$T', avaliacao: '#' }],
    [{ acao: 'usuarios.excluir', token: '$T', id: '$g' }],
    [{ acao: 'empresas.excluir', token: '$T', id: '$eA' }],
    [{ acao: 'sair', token: '$T' }],
    [{ acao: 'listar', token: '$T' }],
    [{ acao: 'empresas.voar', token: '$T' }]
  ];
  roteiro.forEach(([corpo, guardar], n) => {
    const res = lados.map((lado) => {
      const r = lado.chamar(trocar(corpo, lado.vars));
      if (guardar && r.ok) Object.assign(lado.vars, guardar(r));
      return r;
    });
    assert.deepEqual(normalizar(res[1], lados[1].vars), normalizar(res[0], lados[0].vars), '#' + n + ' ' + corpo.acao);
  });
});

/* ---------- Rodada ClickUp: processos, relatórios e página pública (prévia) ---------- */

const FIXTURE = require('./fixtures/processo-exemplo.json');

async function previa() {
  const armazenamento = localStorageFalso();
  const api = SIM.criar({ armazenamento, scoring: S, latenciaMs: 0 });
  const T = (await api.login('admin@previa.com', 'previa123')).token;
  return { api, armazenamento, T };
}

test('js/fixture-processo-exemplo.js é a cópia em dia de tests/fixtures/processo-exemplo.json (npm run montar:fixture)', async () => {
  const { montarConteudo } = await import('../scripts/montar-fixture.mjs');
  const fs = require('node:fs');
  const path = require('node:path');
  const atual = fs.readFileSync(path.join(__dirname, '..', 'js', 'fixture-processo-exemplo.js'), 'utf8');
  assert.equal(atual, montarConteudo(fs.readFileSync(path.join(__dirname, 'fixtures', 'processo-exemplo.json'), 'utf8')),
    'rode: npm run montar:fixture');
  assert.deepEqual(require('../js/fixture-processo-exemplo.js'), FIXTURE);
});

test('prévia: processo de exemplo ligado ao ClickUp, status/listas simulados e processo.dados com a fixture', async () => {
  const { api, T } = await previa();
  const st = await api.clickupStatus(T);
  assert.equal(st.configurado, true);
  assert.equal(st.usuario, 'Prévia');
  const { listas } = await api.clickupListas(T);
  assert.equal(listas.length, 3);
  listas.forEach((l) => { assert.ok(l.id && l.nome && l.pasta); });

  const { processos } = await api.processosListar(T);
  const cart = processos.find((p) => p.codigo === 'CRT1');
  assert.ok(cart, 'processo de exemplo da prévia');
  assert.equal(cart.nome, 'Cartório Exemplo — Escrevente');
  assert.equal(cart.empresa, 'Cartório Exemplo');
  assert.equal(cart.clickupListId, FIXTURE.processo.clickupListId);
  assert.equal(cart.config.perfilIdeal, FIXTURE.config.perfilIdeal);
  assert.deepEqual(cart.config.etapas.map((e) => e.id), FIXTURE.config.etapas.map((e) => e.id));
  assert.deepEqual(cart.periodo, FIXTURE.processo.periodo);
  // SEL1/EQP1 também aparecem como processos (sem lista do ClickUp)
  assert.equal(processos.find((p) => p.codigo === 'SEL1').clickupListId, '');

  const d = await api.processoDados(T, cart.id);
  assert.equal(d.processo.id, cart.id);
  assert.equal(d.processo.codigo, 'CRT1');
  assert.equal(d.candidatos.length, FIXTURE.candidatos.length);
  assert.deepEqual(d.status, FIXTURE.status);
  assert.ok(d.avisos.some((a) => /Prévia/.test(a)));
  const sel = processos.find((p) => p.codigo === 'SEL1');
  await assert.rejects(api.processoDados(T, sel.id), { message: 'Este processo ainda não está ligado a uma lista do ClickUp.' });
  await assert.rejects(api.processoDados(T, 'ava_nada'), { message: 'Processo não encontrado.' });
  await assert.rejects(api.processoDados('', cart.id), (e) => e.sessaoExpirada === true);
});

test('prévia: relatório da semente já publicado abre pelo token "exemplo-cartorio", sem contato nem sobrenome', async () => {
  const { api, T } = await previa();
  const r = await api.relatorioPublico('exemplo-cartorio');
  const rel = r.relatorio;
  assert.equal(rel.versao, 1);
  assert.equal(rel.processo.codigo, 'CRT1');
  assert.equal(rel.processo.clickupListId, undefined);
  assert.ok(rel.ranking.linhas.length > 0);
  assert.ok(rel.sumario.recomendacao && rel.sumario.recomendacao.nome);
  const json = JSON.stringify(rel);
  for (const c of FIXTURE.candidatos) {
    if (c.nome.trim().includes(' ')) assert.ok(!json.includes(c.nome), 'nome completo vazou: ' + c.nome);
  }
  assert.ok(!/@|whatsapp|telefone/i.test(json), 'sem e-mail/telefone');
  // aparece na lista de relatórios do processo
  const cart = (await api.processosListar(T)).processos.find((p) => p.codigo === 'CRT1');
  const { relatorios } = await api.relatoriosListar(T, cart.id);
  assert.deepEqual(relatorios.map((x) => [x.token, x.status]), [['exemplo-cartorio', 'publicado']]);
  await assert.rejects(api.relatorioPublico('nao-existe-token'), { message: 'Relatório não encontrado ou fora do ar.' });
  await assert.rejects(api.relatorioPublico(''), { message: 'Relatório não encontrado ou fora do ar.' });
});

test('prévia: rascunho -> editar -> IA simulada -> publicar -> página pública -> despublicar', async () => {
  const { api, T } = await previa();
  const cart = (await api.processosListar(T)).processos.find((p) => p.codigo === 'CRT1');
  const ras = await api.relatorioRascunho(T, cart.id);
  assert.match(ras.token, /^[0-9a-f]{64}$/);
  assert.equal(ras.relatorio.processo.clickupListId, undefined);
  const ids = Object.keys(ras.relatorio.textos);
  assert.ok(ids.length > 3);
  ids.forEach((id) => assert.equal(ras.relatorio.textos[id].origem, 'regra'));
  // rascunho não abre na página pública
  await assert.rejects(api.relatorioPublico(ras.token), { message: 'Relatório não encontrado ou fora do ar.' });

  // edição: só os textos contam; id desconhecido é ignorado
  const rel = JSON.parse(JSON.stringify(ras.relatorio));
  rel.textos[ids[0]].texto = '  Texto revisado pelo consultor.  ';
  rel.textos.inventado = { texto: 'x', origem: 'regra' };
  const sal = await api.relatorioSalvar(T, ras.token, rel);
  assert.equal(sal.alterados, 1);
  assert.deepEqual(sal.relatorio.textos[ids[0]], { texto: 'Texto revisado pelo consultor.', origem: 'editado' });
  assert.equal(sal.relatorio.textos.inventado, undefined);
  // abrir de novo = salvar sem mudanças
  assert.equal((await api.relatorioSalvar(T, ras.token, { textos: {} })).alterados, 0);
  await assert.rejects(api.relatorioSalvar(T, 'f'.repeat(64), { textos: {} }), { message: 'Relatório não encontrado.' });

  // IA simulada: prefixo leve e origem 'ia'; sem ids = todos os de origem 'regra'
  const ia1 = await api.relatorioMelhorarTextos(T, ras.token, [ids[1]]);
  assert.equal(ia1.alterados, 1);
  assert.equal(ia1.relatorio.textos[ids[1]].origem, 'ia');
  assert.ok(ia1.relatorio.textos[ids[1]].texto.startsWith('[IA] '));
  const ia2 = await api.relatorioMelhorarTextos(T, ras.token);
  assert.equal(ia2.alterados, ids.length - 2);
  assert.equal(ia2.relatorio.textos[ids[0]].origem, 'editado', 'texto editado não é reescrito');
  assert.ok(!ia2.relatorio.textos[ids[1]].texto.startsWith('[IA] [IA] '));
  await assert.rejects(api.relatorioMelhorarTextos(T, ras.token), { message: 'Nenhum texto para melhorar.' });

  const pub = await api.relatorioPublicar(T, ras.token, 'https://notus.exemplo/disc/admin.html?x=1#processos');
  assert.equal(pub.url, 'https://notus.exemplo/disc/relatorio.html?r=' + ras.token);
  const aberto = await api.relatorioPublico(ras.token);
  assert.equal(aberto.relatorio.textos[ids[0]].texto, 'Texto revisado pelo consultor.');
  // sem endereço do site: link relativo (o painel completa)
  assert.equal((await api.relatorioPublicar(T, ras.token)).url, 'relatorio.html?r=' + ras.token);
  const lista = (await api.relatoriosListar(T, cart.id)).relatorios;
  assert.deepEqual(lista.map((x) => x.status).sort(), ['publicado', 'publicado']);
  assert.ok(lista.every((x) => !('relatorio' in x)), 'a lista não carrega o relatório inteiro');

  await api.relatorioDespublicar(T, ras.token);
  await assert.rejects(api.relatorioPublico(ras.token), { message: 'Relatório não encontrado ou fora do ar.' });
  await assert.rejects(api.relatorioDespublicar(T, 'f'.repeat(64)), { message: 'Relatório não encontrado.' });

  // processo sem lista do ClickUp não gera rascunho
  const sel = (await api.processosListar(T)).processos.find((p) => p.codigo === 'SEL1');
  await assert.rejects(api.relatorioRascunho(T, sel.id), { message: 'Este processo ainda não está ligado a uma lista do ClickUp.' });
});

test('prévia: processos.salvar com config completa, campo sensível recusado e excluir', async () => {
  const { api, T } = await previa();
  const config = {
    perfilIdeal: 'is', explicacaoPerfil: 'Atendimento acolhedor.',
    etapas: [{ id: 'entrevista', nome: 'Entrevista', peso: '10', campo: 'Nota – Entrevista', descricao: '' }],
    bonus: [{ id: 'grad', nome: 'Graduação', campo: 'Graduação na área', regra: { tipo: 'checkbox', pontos: 5 } }],
    corte: 70, faixaAvaliar: 55, statusFinalistas: ['finalista'], permitirAntecedentes: false
  };
  const novo = (await api.processosSalvar(T, {
    nome: 'Atendente 2027', empresa: 'Padaria Exemplo', vaga: 'Atendente', cidade: 'Boa Vista / RR', consultor: 'Consultor Exemplo',
    contratante: 'Dona Exemplo', periodo: { inicio: '2026-10-01', fim: 'ontem' }, clickupListId: '900000000002', config
  })).processo;
  assert.match(novo.codigo, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/);
  assert.equal(novo.empresa, 'Padaria Exemplo');
  assert.equal(novo.empresaNome, 'Padaria Exemplo');
  assert.deepEqual(novo.periodo, { inicio: '2026-10-01', fim: '' });
  assert.equal(novo.config.perfilIdeal, 'IS');
  assert.equal(novo.config.etapas[0].peso, 10);
  // o link do teste continua valendo com a empresa em texto
  assert.equal((await api.avaliacaoPublica(novo.codigo)).avaliacao.empresaNome, 'Padaria Exemplo');

  await assert.rejects(api.processosSalvar(T, { id: novo.id, nome: 'Atendente 2027', config: Object.assign({}, config, {
    etapas: [{ id: 'x', nome: 'X', peso: 1, campo: 'Estado civil' }] }) }), { message: 'O campo "Estado civil" é um dado sensível e não pode ser usado.' });
  await assert.rejects(api.processosSalvar(T, { nome: 'Outro', config: { perfilIdeal: 'DD' } }), { message: 'Perfil ideal inválido: use 1 ou 2 letras entre D, I, S e C.' });
  await assert.rejects(api.processosSalvar(T, { nome: 'Outro', clickupListId: 'lista com espaço' }), { message: 'ID da lista do ClickUp inválido.' });
  // editar sem mandar a config mantém a config
  const ed = (await api.processosSalvar(T, { id: novo.id, nome: 'Atendente 2027 B', ativa: false })).processo;
  assert.equal(ed.nome, 'Atendente 2027 B');
  assert.equal(ed.ativa, false);
  assert.equal(ed.config.etapas.length, 1);
  assert.equal(ed.clickupListId, '900000000002');
  assert.equal((await api.processosExcluir(T, novo.id)).ok, true);
  assert.ok(!(await api.processosListar(T)).processos.some((p) => p.id === novo.id));

  assert.equal(SIM.classificarCampo('Nº de filhos'), 'sensivel');
  assert.equal(SIM.classificarCampo('Gênero'), 'sensivel');
  assert.equal(SIM.classificarCampo('Antecedentes criminais'), 'sensivel');
  assert.equal(SIM.classificarCampo('Antecedentes criminais', { permitirAntecedentes: true }), 'antecedente');
  assert.equal(SIM.classificarCampo('Graça'), '');
  assert.equal(SIM.classificarCampo('Pretensão salarial'), '');
});

test('prévia antiga (só a semente base) ganha o processo de exemplo e o relatório publicado sem duplicar respostas', async () => {
  const armazenamento = localStorageFalso();
  const api = SIM.criar({ armazenamento, scoring: S, latenciaMs: 0 });
  const T = (await api.login('admin@previa.com', 'previa123')).token;
  // simula a versão anterior: sem processo/relatórios e sem a marca nova
  const avs = JSON.parse(armazenamento.dados.disc_simulada_avaliacoes).filter((a) => a.codigo !== 'CRT1');
  armazenamento.dados.disc_simulada_avaliacoes = JSON.stringify(avs);
  delete armazenamento.dados.disc_simulada_relatorios;
  delete armazenamento.dados.disc_simulada_semente_relatorio;
  const api2 = SIM.criar({ armazenamento, scoring: S, latenciaMs: 0 });
  assert.equal((await api2.listar(T)).itens.length, 4);
  assert.ok((await api2.processosListar(T)).processos.some((p) => p.codigo === 'CRT1'));
  assert.equal((await api2.relatorioPublico('exemplo-cartorio')).ok, true);
  // reiniciar recria tudo
  api2.reiniciar();
  const T2 = (await api2.login('admin@previa.com', 'previa123')).token;
  assert.equal((await api2.relatoriosListar(T2)).relatorios.length, 1);
});

test('mesmo comportamento do Code.gs em processos.* (sem ClickUp) e nas recusas de relatório', () => {
  const gas = carregarGas({ props: { ADMIN_KEY: 'previa' } });
  const sim = SIM.criar({ armazenamento: localStorageFalso(), scoring: S, latenciaMs: 0, semente: false });
  const cfg = { perfilIdeal: 'cd', etapas: [{ id: 'rev', nome: 'Revisão', peso: 30, campo: 'Nota Revisão' }, { nome: '', peso: 'x' }],
    bonus: [{ nome: 'Presencial', campo: 'Perfil presencial', regra: { tipo: 'mapa', pontos: { 3: 0, 4: '10', 5: 15 } } }], corte: 70, faixaAvaliar: 80 };
  const lados = [{ chamar: (c) => gas.post(c), vars: {} }, { chamar: (c) => sim.processar(c), vars: {} }];
  const trocar = (v, vars) => {
    if (typeof v === 'string' && v.startsWith('$')) return vars[v.slice(1)];
    if (Array.isArray(v)) return v.map((x) => trocar(x, vars));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, trocar(x, vars)]));
    return v;
  };
  const normalizar = (r, vars) => {
    let txt = JSON.stringify(r, (k, v) => (['criadaEm', 'criadoEm', 'token', 'codigo', 'id'].includes(k) ? undefined : v));
    Object.entries(vars).forEach(([n, val]) => { if (typeof val === 'string' && val.length >= 4) txt = txt.split(val).join('$' + n); });
    return JSON.parse(txt);
  };
  const roteiro = [
    [{ acao: 'primeiroAcesso', chave: 'previa', nome: 'Dona Admin', email: 'dona@x.com', senha: '12345678' }, (r) => ({ T: r.token })],
    [{ acao: 'processos.salvar', token: '$T', processo: { nome: 'X' } }],
    [{ acao: 'processos.salvar', token: '$T', processo: { nome: 'Escrevente', config: cfg } }],
    [{ acao: 'processos.salvar', token: '$T', processo: { nome: 'Escrevente', config: Object.assign({}, cfg, { faixaAvaliar: 50 }) } }, (r) => ({ p: r.processo.id })],
    [{ acao: 'processos.salvar', token: '$T', processo: { nome: 'Escrevente', config: { etapas: [{ campo: 'Religião' }] } } }],
    [{ acao: 'processos.salvar', token: '$T', processo: { nome: 'Escrevente', config: { etapas: [{ campo: 'Antecedentes' }], permitirAntecedentes: true } } }],
    [{ acao: 'processos.salvar', token: '$T', processo: { id: '$p', nome: 'Escrevente 2026', empresa: ' Cartório  Alfa ', vaga: 'Escrevente', cidade: 'Boa Vista', consultor: 'Ana', contratante: 'Beto', periodo: { inicio: '2026-01-02', fim: '2026-13' }, clickupListId: '900' } }],
    [{ acao: 'processos.salvar', token: '$T', processo: { id: 'ava_x', nome: 'Nada Aqui' } }],
    [{ acao: 'processos.salvar', token: '$T', processo: { nome: 'Com empresa', empresaId: 'emp_nada' } }],
    [{ acao: 'processos.listar', token: '$T' }],
    [{ acao: 'avaliacoes.listar', token: '$T' }],
    [{ acao: 'processo.dados', token: '$T', id: 'ava_nada' }],
    [{ acao: 'relatorio.rascunho', token: '$T', processoId: 'ava_nada' }],
    [{ acao: 'relatorio.salvar', token: '$T', relatorioToken: 'f'.repeat(64), textos: {} }],
    [{ acao: 'relatorio.salvar', token: '$T', relatorioToken: 'f'.repeat(64) }],
    [{ acao: 'relatorio.publicar', token: '$T', relatorioToken: 'f'.repeat(64) }],
    [{ acao: 'relatorio.despublicar', token: '$T', relatorioToken: 'nada' }],
    [{ acao: 'relatorios.listar', token: '$T' }],
    [{ acao: 'relatorioPublico', token: 'f'.repeat(64) }],
    [{ acao: 'relatorioPublico', token: '<script>' }],
    [{ acao: 'processos.excluir', token: '$T', id: '$p' }],
    [{ acao: 'processos.excluir', token: '$T', id: '$p' }],
    [{ acao: 'processos.listar', token: 'x' }]
  ];
  roteiro.forEach(([corpo, guardar], n) => {
    const res = lados.map((lado) => {
      const r = lado.chamar(trocar(corpo, lado.vars));
      if (guardar && r.ok) Object.assign(lado.vars, guardar(r));
      return r;
    });
    assert.deepEqual(normalizar(res[1], lados[1].vars), normalizar(res[0], lados[0].vars), '#' + n + ' ' + corpo.acao);
  });
});

test('corpo grande só é aceito em relatorio.salvar (mesmo limite do Code.gs)', () => {
  const sim = SIM.criar({ armazenamento: localStorageFalso(), scoring: S, latenciaMs: 0, semente: false });
  const grande = 'x'.repeat(30000);
  assert.deepEqual(sim.processar({ acao: 'listar', token: 'a', lixo: grande }), { ok: false, erro: 'Requisição grande demais.' });
  assert.deepEqual(sim.processar({ acao: 'relatorio.salvar', token: 'a', lixo: grande }), { ok: false, erro: 'Sessão expirada. Entre de novo.', sessaoExpirada: true });
  assert.deepEqual(sim.processar({ acao: 'relatorio.salvar', token: 'a', lixo: 'x'.repeat(460000) }), { ok: false, erro: 'Requisição grande demais.' });
});

test('js/api.js: ações novas mandam o corpo do contrato (token da sessão + relatorioToken) e relatorioPublico é pública', async () => {
  const API = require('../js/api.js');
  const corpos = [];
  const fetchAntigo = global.fetch;
  global.fetch = async (url, op) => {
    corpos.push(JSON.parse(op.body));
    return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true }) };
  };
  try {
    API.definirUrl('https://script.google.com/macros/s/teste/exec');
    const S1 = 'a'.repeat(64);
    const R = 'b'.repeat(64);
    await API.processosListar(S1);
    await API.processosSalvar(S1, { nome: 'P' });
    await API.processosExcluir(S1, 'ava_1');
    await API.processoDados(S1, 'ava_1');
    await API.clickupStatus(S1);
    await API.clickupListas(S1);
    await API.relatorioRascunho(S1, 'ava_1');
    await API.relatorioSalvar(S1, R, { versao: 1, capa: { titulo: 'grande' }, textos: { t1: { texto: 'novo', origem: 'regra' } } });
    await API.relatorioPublicar(S1, R, 'https://site/admin.html');
    await API.relatorioDespublicar(S1, R);
    await API.relatoriosListar(S1, 'ava_1');
    await API.relatorioMelhorarTextos(S1, R, ['t1']);
    await API.relatorioPublico(R);
    assert.deepEqual(corpos, [
      { acao: 'processos.listar', token: S1 },
      { acao: 'processos.salvar', token: S1, processo: { nome: 'P' } },
      { acao: 'processos.excluir', token: S1, id: 'ava_1' },
      { acao: 'processo.dados', token: S1, id: 'ava_1' },
      { acao: 'clickup.status', token: S1 },
      { acao: 'clickup.listas', token: S1 },
      { acao: 'relatorio.rascunho', token: S1, processoId: 'ava_1' },
      { acao: 'relatorio.salvar', token: S1, relatorioToken: R, relatorio: { textos: { t1: { texto: 'novo', origem: 'regra' } } } },
      { acao: 'relatorio.publicar', token: S1, relatorioToken: R, baseUrl: 'https://site/admin.html' },
      { acao: 'relatorio.despublicar', token: S1, relatorioToken: R },
      { acao: 'relatorios.listar', token: S1, processoId: 'ava_1' },
      { acao: 'relatorio.melhorarTextos', token: S1, relatorioToken: R, ids: ['t1'] },
      { acao: 'relatorioPublico', token: R }
    ]);
    // sem sessão: recusa antes de chamar o servidor
    await assert.rejects(API.processosListar(''), (e) => e.sessaoExpirada === true);
    await assert.rejects(API.relatorioSalvar(S1, ''), { message: 'Relatório não informado.' });
    assert.equal(corpos.length, 13);
    assert.ok(API.TIMEOUT_LONGO_MS > API.TIMEOUT_MS);
  } finally {
    global.fetch = fetchAntigo;
    API.definirUrl(null);
  }
});
