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

// Novidades da simulada que o Code.gs (legado) não tem: config.formulario / avaliacao.formulario e, nos
// itens de "listar", a pessoa (pessoaId, pessoa), os campos novos do formulário (email, cidade, extras) e a
// Parte 2 (exigido, resultadoExigido) e a foto (item e usuário).
const CAMPOS_NOVOS_ITEM = ['pessoaId', 'pessoa', 'email', 'cidade', 'extras', 'exigido', 'resultadoExigido', 'foto',
  'historicoProcessos', 'processoId', 'origem'];
// Empresas (rodada empresas/equipes): cidade, observações, ativo e contagem de colaboradores.
const CAMPOS_NOVOS_EMPRESA = ['cidade', 'observacoes', 'ativo', 'atualizadoEm', 'colaboradores'];
function semNovidades(dono, k) {
  if (k === 'formulario') return true;
  // Foto do usuário (rodada fotos): o Code.gs não tem.
  if (k === 'foto' && dono && typeof dono === 'object' && !Array.isArray(dono) && 'papel' in dono) return true;
  if (dono && typeof dono === 'object' && !Array.isArray(dono) && 'colaboradores' in dono && CAMPOS_NOVOS_EMPRESA.includes(k)) return true;
  return !!(dono && typeof dono === 'object' && !Array.isArray(dono) && 'pessoaId' in dono && 'respostas' in dono && CAMPOS_NOVOS_ITEM.includes(k));
}

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
  const limpar = (r) => JSON.parse(JSON.stringify(r, function (k, v) { return (k === 'protocolo' || k === 'recebidoEm' || semNovidades(this, k) ? undefined : v); }));
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
  assert.equal(itens.length, 10, '9 exemplos da semente + o envio');
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

test('semente da prévia: admin e gestor, Clínica Exemplo, SEL1/EQP1/ATD1 e 9 respostas (a mesma pessoa em 2) com validação variada', async () => {
  const armazenamento = localStorageFalso();
  const api = SIM.criar({ armazenamento, scoring: S, latenciaMs: 0 });
  const adm = await api.login('admin@previa.com', 'previa123');
  assert.deepEqual(adm.usuario, { id: adm.usuario.id, nome: 'Você (admin)', email: 'admin@previa.com', papel: 'admin', empresaId: '', empresaNome: '', foto: '' });
  const ges = await api.login('GESTOR@previa.com', 'previa123');
  assert.equal(ges.usuario.papel, 'gestor');
  assert.equal(ges.usuario.empresaNome, 'Clínica Exemplo');

  const avs = (await api.listarAvaliacoes(adm.token)).avaliacoes;
  assert.deepEqual(avs.map((a) => [a.codigo, a.nome, a.tipo, a.mostrarResultado, a.ativa, a.empresaNome, a.respostas]), [
    ['SEL1', 'Recepcionista 2026', 'selecao', false, true, 'Clínica Exemplo', 2],
    ['EQP1', 'Equipe comercial', 'equipe', true, true, 'Clínica Exemplo', 6],
    ['ATD1', 'Atendimento ao cliente', 'selecao', true, true, 'Clínica Exemplo', 1],
    ['CRT1', 'Cartório Exemplo — Escrevente', 'selecao', true, true, 'Cartório Exemplo', 0]
  ]);
  const { itens } = await api.listar(adm.token);
  assert.equal(itens.length, 9);
  // A Ana respondeu 2 vezes (SEL1 e ATD1): mesma pessoa, ficha com os dados mais recentes.
  const ana = itens.filter((i) => i.nome === 'Ana Exemplo Prévia');
  assert.equal(ana.length, 2);
  assert.ok(ana[0].pessoaId && ana[0].pessoaId === ana[1].pessoaId);
  assert.equal(new Set(itens.map((i) => i.pessoaId)).size, 8);
  assert.equal(ana[0].pessoa.email, 'ana.exemplo@exemplo.com');
  const atd = itens.find((i) => i.avaliacao === 'ATD1');
  assert.deepEqual([atd.email, atd.cidade, atd.extras.length], ['ana.exemplo@exemplo.com', 'Boa Vista / RR', 1]);
  const formAtd = (await api.avaliacaoPublica('ATD1')).avaliacao.formulario;
  assert.equal(formAtd.campos.email, 'obrigatorio');
  assert.deepEqual(formAtd.perguntas, [{ id: 'p1', texto: 'Qual sua disponibilidade de horário?', obrigatoria: true }]);
  assert.equal((await api.avaliacaoPublica('CRT1')).avaliacao.mostrarResultado, true, 'a prévia mostra o relatório ao candidato');
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
  assert.equal((await api2.listar(adm.token)).itens.length, 9, 'sessão continua valendo depois de recarregar');
  assert.equal((await api2.listarUsuarios(adm.token)).usuarios.length, 2);
  // reiniciar volta ao estado inicial
  await api2.excluirTodos(adm.token);
  api2.reiniciar();
  const nova2 = await api2.login('admin@previa.com', 'previa123');
  assert.equal((await api2.listar(nova2.token)).itens.length, 9);
  assert.ok(!JSON.stringify(armazenamento.dados).includes('previa123'), 'senha nunca guardada');
});

test('prévia: avaliacaoPublica, enviar com código ativo/inativo/inexistente e gestor só da própria empresa', async () => {
  const api = SIM.criar({ armazenamento: localStorageFalso(), scoring: S, latenciaMs: 0 });
  const pub = await api.avaliacaoPublica('eqp1');
  assert.deepEqual(pub.avaliacao, { codigo: 'EQP1', nome: 'Equipe comercial', tipo: 'equipe', empresaNome: 'Clínica Exemplo', mostrarResultado: true,
    formulario: { campos: { idade: 'obrigatorio', funcao: 'opcional', empresa: 'opcional', email: 'oculto', cidade: 'oculto', foto: 'opcional' }, perguntas: [], parte2: 'ligada' } });
  await assert.rejects(api.avaliacaoPublica('NADA'), { message: 'Link inválido ou avaliação encerrada. Fale com quem enviou o link.' });
  assert.equal((await api.avaliacaoPublica('SEL1')).avaliacao.formulario.parte2, 'desligada');
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
  assert.deepEqual((await api.listarAvaliacoes(TG)).avaliacoes.map((a) => a.codigo), ['SEL1', 'EQP1', 'ATD1']);
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
    let txt = JSON.stringify(r, function (k, v) { return (['protocolo', 'recebidoEm', 'criadaEm', 'criadoEm', 'token'].includes(k) || semNovidades(this, k) ? undefined : v); });
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
  assert.equal((await api2.listar(T)).itens.length, 9);
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
    let txt = JSON.stringify(r, function (k, v) { return (['criadaEm', 'criadoEm', 'token', 'codigo', 'id'].includes(k) || semNovidades(this, k) ? undefined : v); });
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

/* ---------- Formulário do processo e pessoas (mesmo comportamento do Supabase) ---------- */

test('formulário do processo: obrigatórios, ocultos, e-mail, perguntas extras e pergunta sensível recusada', async () => {
  const { api, T } = nova();
  await assert.rejects(api.processosSalvar(T, { nome: 'Atendimento', config: { formulario: { perguntas: [{ texto: 'Você tem filhos?' }] } } }),
    { message: 'A pergunta "Você tem filhos?" pede um dado sensível e não pode ser usada.' });
  const proc = (await api.processosSalvar(T, { nome: 'Atendimento', config: { formulario: {
    campos: { idade: 'oculto', email: 'obrigatorio', cidade: 'opcional' },
    perguntas: [{ id: 'p1', texto: 'Qual sua pretensão salarial?', obrigatoria: true }, { texto: 'Tem carro?' }]
  } } })).processo;
  assert.deepEqual(proc.config.formulario.perguntas.map((p) => p.id), ['p1', 'p2']);
  assert.deepEqual((await api.avaliacaoPublica(proc.codigo)).avaliacao.formulario, proc.config.formulario);
  const env = (extra) => api.enviar(payloadValido(Object.assign({ id: 'form-' + Math.random().toString(36).slice(2, 10), avaliacao: proc.codigo }, extra)));
  await assert.rejects(env({ extras: [{ id: 'p1', resposta: 'R$ 3.000' }] }), { message: 'Informe o e-mail.' });
  await assert.rejects(env({ email: 'x@', extras: [{ id: 'p1', resposta: 'R$ 3.000' }] }), { message: 'E-mail inválido.' });
  await assert.rejects(env({ email: 'a@b.co' }), { message: 'Responda a pergunta "Qual sua pretensão salarial?".' });
  const ok = await env({ idade: 'abc', email: ' A@B.CO ', cidade: ' Campinas ', extras: [{ id: 'p1', pergunta: 'velha', resposta: ' R$ 3.000 ' }, { id: 'zz', resposta: 'x' }] });
  assert.equal(ok.ok, true);
  const it = (await api.listar(T)).itens.find((i) => i.id === ok.id);
  assert.deepEqual([it.idade, it.email, it.cidade, it.extras], [null, 'a@b.co', 'Campinas',
    [{ id: 'p1', pergunta: 'Qual sua pretensão salarial?', resposta: 'R$ 3.000' }]]);
  // Sem link: padrão (idade obrigatória, e-mail oculto)
  await assert.rejects(api.enviar(payloadValido({ id: 'geral-sem-idade', idade: null })), /Idade não informada/);
  const geral = await api.enviar(payloadValido({ id: 'geral-com-email', email: 'ignorado@x.com' }));
  assert.equal((await api.listar(T)).itens.find((i) => i.id === geral.id).email, '');
});

test('pessoas: agrupadas pelo WhatsApp, ficha atualizada sem apagar com vazio e excluída com a última resposta', async () => {
  const { api, armazenamento, T } = nova();
  await api.enviar(payloadValido({ id: 'pessoa-0001', telefone: '(11) 97777-6666', funcao: 'Caixa', empresa: 'Mercado' }));
  await api.enviar(payloadValido({ id: 'pessoa-0002', telefone: '11977776666', nome: 'João Pedro da Silva', funcao: '', empresa: '', idade: 31 }));
  await api.enviar(payloadValido({ id: 'pessoa-0003', telefone: '21966665555', nome: 'Maria Lima Souza' }));
  let itens = (await api.listar(T)).itens;
  const [a, b, c] = itens;
  assert.ok(a.pessoaId && a.pessoaId === b.pessoaId && c.pessoaId !== a.pessoaId);
  assert.deepEqual([a.pessoa.nome, a.pessoa.idade, a.pessoa.funcao, a.pessoa.empresa, a.pessoa.telefone],
    ['João Pedro da Silva', 31, 'Caixa', 'Mercado', '5511977776666']);
  assert.match(a.pessoa.atualizadoEm, /^\d{4}-\d{2}-\d{2}T/);
  // Linha antiga (sem pessoa) é ligada à pessoa do mesmo telefone ao listar.
  const linhas = JSON.parse(armazenamento.getItem(SIM.CHAVE_ARMAZENAMENTO));
  linhas.push(Object.assign({}, linhas[2], { id: 'antiga-0009', pessoaId: undefined, telefone: '5521966665555' }));
  armazenamento.setItem(SIM.CHAVE_ARMAZENAMENTO, JSON.stringify(linhas));
  itens = (await api.listar(T)).itens;
  assert.equal(itens.find((i) => i.id === 'antiga-0009').pessoaId, c.pessoaId);
  // Exclusão: a ficha sai junto com a última resposta da pessoa.
  const fichas = () => JSON.parse(armazenamento.getItem('disc_simulada_pessoas')).map((p) => p.id).sort();
  await api.excluir(T, 'pessoa-0001');
  assert.deepEqual(fichas(), [a.pessoaId, c.pessoaId].sort());
  await api.excluir(T, 'pessoa-0002');
  assert.deepEqual(fichas(), [c.pessoaId]);
  await api.excluirTodos(T);
  assert.deepEqual(fichas(), []);
});

/* ---------- Rodada empresas/equipes: colaboradores, organograma e relatórios por modelo ---------- */

test('semente: Clínica Exemplo com 7 colaboradores ativos (1 sem teste), organograma de 3 níveis e 1 desligado', async () => {
  const { api, T, armazenamento } = await previa();
  const emps = (await api.listarEmpresas(T)).empresas;
  const clinica = emps.find((x) => x.nome === 'Clínica Exemplo');
  assert.deepEqual([clinica.cidade, clinica.ativo, clinica.colaboradores], ['Boa Vista / RR', true, 7]);
  const procs = (await api.processosListar(T)).processos;
  assert.equal(procs.find((p) => p.codigo === 'SEL1').empresaId, clinica.id);
  assert.deepEqual([procs.find((p) => p.codigo === 'EQP1').empresaId, procs.find((p) => p.codigo === 'EQP1').tipo], [clinica.id, 'equipe']);

  const eq = await api.listarEquipe(T, clinica.id);
  assert.equal(eq.colaboradores.length, 7);
  assert.deepEqual(eq.colaboradores.filter((c) => !c.resultado).map((c) => c.nome), ['Tiago Modelo Sem Teste']);
  const codigos = eq.colaboradores.filter((c) => c.resultado).map((c) => c.resultado.codigo[0]);
  assert.deepEqual([...new Set(codigos)].sort(), ['C', 'D', 'I', 'S'], 'DISC variados: as 4 letras aparecem como primárias');
  eq.colaboradores.forEach((c) => {
    assert.ok(/Exemplo|Fictício|Modelo/.test(c.nome), 'nome fictício: ' + c.nome);
    assert.equal(c.status, 'ativo');
    assert.match(c.inicio, /^\d{4}-\d{2}-\d{2}$/);
  });
  assert.deepEqual(eq.historico.map((c) => [c.nome, c.status, !!c.fim]), [['Bruno Teste Fictício', 'desligado', true]]);
  assert.equal(eq.relacoes.length, 9);
  assert.deepEqual([...new Set(eq.relacoes.map((r) => r.tipo))].sort(), ['direto', 'indireto', 'lidera']);
  // o motor de compatibilidade monta o organograma de 3 níveis com a Marta no topo
  const C = require('../js/compatibilidade.js');
  const m = C.montar({ empresa: { nome: clinica.nome }, foco: null, relacoes: eq.relacoes,
    pessoas: eq.colaboradores.map((c) => ({ id: c.pessoaId, nome: c.nome, cargo: c.cargo, percentuais: c.resultado ? c.resultado.percentuais : null })) });
  assert.equal(m.organograma.profundidade, 2, '3 níveis (0, 1 e 2)');
  assert.equal(m.organograma.raizes.length, 1);
  // a semente da equipe não duplica ao recarregar; prévia antiga (sem a marca da equipe) ganha a equipe uma vez só
  delete armazenamento.dados.disc_simulada_semente_equipe;
  const api2 = SIM.criar({ armazenamento, scoring: S, latenciaMs: 0 });
  const eq2 = await api2.listarEquipe(T, clinica.id);
  assert.deepEqual([eq2.colaboradores.length, eq2.historico.length, eq2.relacoes.length], [7, 1, 9]);
  assert.equal((await api2.listar(T)).itens.length, 9);
});

test('colaboradores: sem teste pelo WhatsApp, 1 vínculo ativo por pessoa, mover e desligar limpam as relações', async () => {
  const { api, T } = nova();
  const a = (await api.salvarEmpresa(T, { nome: 'Clínica Alfa', cidade: 'Manaus', observacoes: 'obs' })).empresa;
  const b = (await api.salvarEmpresa(T, { nome: 'Loja Beta' })).empresa;
  assert.deepEqual([a.cidade, a.observacoes, a.ativo, a.colaboradores], ['Manaus', 'obs', true, 0]);
  const c1 = (await api.salvarColaborador(T, { empresaId: a.id, nome: '  Lia  Lider Souza', telefone: '(11) 92222-0001', cargo: 'Diretora', area: 'Diretoria' })).colaborador;
  assert.deepEqual([c1.nome, c1.telefone, c1.cargo, c1.status, c1.fim], ['Lia Lider Souza', '5511922220001', 'Diretora', 'ativo', '']);
  const c2 = (await api.salvarColaborador(T, { empresaId: a.id, nome: 'Pedro Liderado Um', telefone: '11922220002', cargo: 'Vendedor' })).colaborador;
  // mesmo WhatsApp: mesma pessoa e mesmo vínculo (atualiza cargo)
  const c2b = (await api.salvarColaborador(T, { empresaId: a.id, nome: 'Outro Nome Aqui', telefone: '5511922220002', cargo: 'Gerente' })).colaborador;
  assert.deepEqual([c2b.vinculoId, c2b.pessoaId, c2b.nome, c2b.cargo], [c2.vinculoId, c2.pessoaId, 'Pedro Liderado Um', 'Gerente']);
  await assert.rejects(api.salvarColaborador(T, { empresaId: b.id, pessoaId: c2.pessoaId }), /outra empresa \(Clínica Alfa\)\. Use "Mover"/);
  await assert.rejects(api.salvarColaborador(T, { empresaId: a.id, nome: 'Só', telefone: '11922220003' }), /nome completo/);
  await assert.rejects(api.salvarColaborador(T, { empresaId: a.id, nome: 'Nome Completo', telefone: '12' }), /Telefone inválido/);
  await assert.rejects(api.salvarColaborador(T, { empresaId: 'emp_x', nome: 'Nome Completo', telefone: '11922220003' }), /Empresa não encontrada/);

  const c3 = (await api.salvarColaborador(T, { empresaId: a.id, nome: 'Paula Liderada Dois', telefone: '11922220003' })).colaborador;
  await api.salvarRelacoes(T, a.id, [
    { de: c1.pessoaId, para: c2.pessoaId, tipo: 'lidera' }, { de: c1.pessoaId, para: c3.pessoaId, tipo: 'lidera' },
    { de: c2.pessoaId, para: c3.pessoaId, tipo: 'direto' }, { de: c2.pessoaId, para: c3.pessoaId, tipo: 'indireto' }]);
  let eq = await api.listarEquipe(T, a.id);
  assert.equal(eq.relacoes.length, 3, 'repetida: vale a última');
  assert.equal(eq.relacoes.find((r) => r.de === c2.pessoaId).tipo, 'indireto');
  await assert.rejects(api.salvarRelacoes(T, a.id, [{ de: c1.pessoaId, para: c1.pessoaId, tipo: 'direto' }]), /ela mesma/);
  await assert.rejects(api.salvarRelacoes(T, a.id, [{ de: c1.pessoaId, para: c2.pessoaId, tipo: 'chefe' }]), /Tipo de relação inválido/);
  assert.equal((await api.listarEquipe(T, a.id)).relacoes.length, 3, 'erro não muda nada');

  // mover Pedro para B: vínculo antigo desligado (fim = hoje) e relações dele em A somem
  const mv = (await api.moverColaborador(T, { pessoaId: c2.pessoaId, empresaId: b.id, cargo: 'Gerente', area: 'Loja' })).colaborador;
  assert.deepEqual([mv.empresaId, mv.status, mv.cargo], [b.id, 'ativo', 'Gerente']);
  eq = await api.listarEquipe(T, a.id);
  assert.deepEqual(eq.colaboradores.map((c) => c.nome), ['Lia Lider Souza', 'Paula Liderada Dois']);
  assert.deepEqual(eq.relacoes, [{ de: c1.pessoaId, para: c3.pessoaId, tipo: 'lidera' }]);
  assert.deepEqual(eq.historico.map((c) => [c.nome, c.status, c.fim.length]), [['Pedro Liderado Um', 'desligado', 10]]);
  await assert.rejects(api.salvarRelacoes(T, a.id, [{ de: c1.pessoaId, para: c2.pessoaId, tipo: 'lidera' }]), /colaboradoras ativas desta empresa/);
  assert.equal((await api.listarEmpresas(T)).empresas.find((x) => x.id === b.id).colaboradores, 1);

  // desligar Paula: relação some; empresa só é excluída sem colaborador ativo
  await api.desligarColaborador(T, c3.vinculoId);
  assert.deepEqual((await api.listarEquipe(T, a.id)).relacoes, []);
  await assert.rejects(api.desligarColaborador(T, c3.vinculoId), /já desligado/);
  await assert.rejects(api.excluirEmpresa(T, a.id), /Desligue ou mova os colaboradores antes\./);
  await api.desligarColaborador(T, c1.vinculoId);
  assert.deepEqual(await api.excluirEmpresa(T, a.id), { ok: true, id: a.id });
  await assert.rejects(api.listarEquipe(T, a.id), /Empresa não encontrada/);
});

test('envio pelo link de equipe ligado à empresa cria o vínculo; colaborador ativo continua sem as respostas', async () => {
  const { api, T } = nova();
  const a = (await api.salvarEmpresa(T, { nome: 'Clínica Equipe' })).empresa;
  const b = (await api.salvarEmpresa(T, { nome: 'Outra Clínica' })).empresa;
  const eqp = (await api.processosSalvar(T, { nome: 'Equipe X', tipo: 'equipe', empresaId: a.id })).processo;
  const sel = (await api.processosSalvar(T, { nome: 'Seleção X', tipo: 'selecao', empresaId: a.id })).processo;
  assert.equal(eqp.empresaId, a.id);
  await api.enviar(payloadValido({ id: 'eqp-000001', avaliacao: eqp.codigo, telefone: '11944440001', nome: 'Rita Equipe Souza', funcao: 'Recepcionista' }));
  await api.enviar(payloadValido({ id: 'eqp-000002', avaliacao: eqp.codigo, telefone: '11944440001', nome: 'Rita Equipe Souza', funcao: 'Gerente' }));
  await api.enviar(payloadValido({ id: 'sel-000001', avaliacao: sel.codigo, telefone: '11944440003', nome: 'Sem Vinculo Teste' }));
  const caio = (await api.salvarColaborador(T, { empresaId: b.id, nome: 'Caio Outra Lima', telefone: '11944440002' })).colaborador;
  await api.enviar(payloadValido({ id: 'eqp-000003', avaliacao: eqp.codigo, telefone: '11944440002', nome: 'Caio Outra Lima' }));
  const eq = await api.listarEquipe(T, a.id);
  assert.deepEqual(eq.colaboradores.map((c) => [c.nome, c.cargo, !!c.resultado]), [['Rita Equipe Souza', 'Recepcionista', true]]);
  assert.match(eq.colaboradores[0].respondidoEm, /^\d{4}-/);
  assert.deepEqual((await api.listarEquipe(T, b.id)).colaboradores.map((c) => c.pessoaId), [caio.pessoaId], 'ativo em outra: não mexe');
  // excluir todas as respostas: quem é colaborador ativo continua (sem resultado)
  await api.excluirTodos(T);
  const depois = await api.listarEquipe(T, a.id);
  assert.deepEqual(depois.colaboradores.map((c) => [c.nome, c.resultado]), [['Rita Equipe Souza', null]]);
});

test('relatórios por modelo: salvar, publicar (link), página pública com o modelo, listar e excluir', async () => {
  const { api, T } = await previa();
  const clinica = (await api.listarEmpresas(T)).empresas.find((x) => x.nome === 'Clínica Exemplo');
  const eq = await api.listarEquipe(T, clinica.id);
  const dados = { modelo: 'equipe', versao: 1, titulo: 'Equipe da Clínica Exemplo', geradoEm: '2026-10-05T10:00:00.000Z' };
  const r1 = (await api.salvarRelatorioModelo(T, { modelo: 'equipe', empresaId: clinica.id, dados })).relatorio;
  assert.deepEqual([r1.status, r1.modelo, r1.url], ['rascunho', 'equipe', undefined]);
  assert.match(r1.token, /^[0-9a-f]{64}$/);
  await assert.rejects(api.relatorioPublico(r1.token), /Relatório não encontrado ou fora do ar/);
  const r2 = (await api.salvarRelatorioModelo(T, { id: r1.id, modelo: 'equipe', empresaId: clinica.id, dados, publicar: true, baseUrl: 'https://x.github.io/site/admin.html' })).relatorio;
  assert.equal(r2.url, 'https://x.github.io/site/relatorio.html?r=' + r1.token);
  assert.deepEqual(await api.relatorioPublico(r1.token), { ok: true, modelo: 'equipe', relatorio: dados, publicadoEm: (await api.relatorioPublico(r1.token)).publicadoEm });
  const marta = eq.colaboradores.find((c) => /Marta/.test(c.nome));
  // grande demais passa do limite do corpo comum (20 mil) mas fica abaixo de 300 KB: aceito
  const grande = { titulo: 'Como liderar a Marta', texto: 'x'.repeat(60000) };
  const r3 = (await api.salvarRelatorioModelo(T, { modelo: 'lideranca', pessoaId: marta.pessoaId, empresaId: clinica.id, dados: grande })).relatorio;
  await assert.rejects(api.salvarRelatorioModelo(T, { modelo: 'pessoa', dados: {} }), /Escolha a pessoa do relatório/);
  await assert.rejects(api.salvarRelatorioModelo(T, { modelo: 'equipe', empresaId: clinica.id, dados: { modelo: 'pessoa' } }), /não são de um relatório "equipe"/);
  await assert.rejects(api.salvarRelatorioModelo(T, { modelo: 'x', empresaId: clinica.id, dados: {} }), /Modelo de relatório inválido/);
  const lista = (await api.listarRelatoriosModelo(T, { empresaId: clinica.id })).relatorios;
  assert.deepEqual(lista.map((x) => [x.modelo, x.titulo, x.status]).sort(),
    [['equipe', 'Equipe da Clínica Exemplo', 'publicado'], ['lideranca', 'Como liderar a Marta', 'rascunho']]);
  assert.deepEqual((await api.listarRelatoriosModelo(T, { pessoaId: marta.pessoaId })).relatorios.map((x) => x.id), [r3.id]);
  // a lista de relatórios de processo e as ações dele não enxergam os modelos novos
  assert.ok((await api.relatoriosListar(T)).relatorios.every((x) => x.token !== r1.token));
  await assert.rejects(api.relatorioDespublicar(T, r1.token), /Relatório não encontrado/);
  await assert.rejects(api.relatorioMelhorarTextos(T, r1.token), /Relatório não encontrado/);
  assert.equal((await api.relatorioPublico('exemplo-cartorio')).modelo, 'processo');
  assert.deepEqual(await api.excluirRelatorioModelo(T, r3.id), { ok: true, id: r3.id });
  await assert.rejects(api.excluirRelatorioModelo(T, r3.id), /Relatório não encontrado/);
});

/* ---------- Fotos (como a migração 20261009120000_fotos.sql) ---------- */
const FOTO = 'data:image/jpeg;base64,/9j/' + 'A'.repeat(300);
const FOTO2 = 'data:image/jpeg;base64,/9j/' + 'B'.repeat(300);

test('fotos: envio conforme formulario.campos.foto; ficha guarda a mais recente; listar devolve as duas', async () => {
  const { api, T } = nova();
  const proc = async (codigoForm) => (await api.processosSalvar(T, { nome: 'Proc ' + codigoForm, config: { formulario: { campos: { foto: codigoForm } } } })).processo;
  const obrig = await proc('obrigatorio');
  const oculta = await proc('oculto');
  assert.equal(obrig.config.formulario.campos.foto, 'obrigatorio');
  assert.equal((await api.processosSalvar(T, { nome: 'Padrão' })).processo.config.formulario.campos.foto, 'opcional');

  await assert.rejects(api.enviar(payloadValido({ id: 'ft-obrig-1', avaliacao: obrig.codigo })), /^Error: Envie uma foto\.$/);
  for (const ruim of ['data:image/png;base64,AAAA', 'https://x/y.jpg', 'data:image/jpeg;base64,/9j/' + 'A'.repeat(40000)]) {
    await assert.rejects(api.enviar(payloadValido({ id: 'ft-ruim-1', foto: ruim })), /Foto inválida ou grande demais/);
  }
  await assert.rejects(api.enviar(payloadValido({ id: 'ft-grande', foto: FOTO, vaga: 'x'.repeat(81000) })), /Requisição grande demais/);
  assert.equal((await api.enviar(payloadValido({ id: 'ft-obrig-2', avaliacao: obrig.codigo, foto: FOTO, telefone: '11977770001' }))).ok, true);
  assert.equal((await api.enviar(payloadValido({ id: 'ft-oculta', avaliacao: oculta.codigo, foto: 'lixo', telefone: '11977770002' }))).ok, true);
  assert.equal((await api.enviar(payloadValido({ id: 'ft-sem', telefone: '11977770001' }))).ok, true);
  assert.equal((await api.enviar(payloadValido({ id: 'ft-maior', foto: 'data:image/jpeg;base64,/9j/' + 'C'.repeat(39000), vaga: 'x'.repeat(30000), telefone: '11977770003' }))).ok, true);

  const itens = (await api.listar(T)).itens;
  const por = Object.fromEntries(itens.map((i) => [i.id, i]));
  assert.equal(por['ft-obrig-2'].foto, FOTO);
  assert.equal(por['ft-obrig-2'].pessoa.foto, FOTO);
  assert.equal(por['ft-sem'].foto, '');
  assert.equal(por['ft-sem'].pessoa.foto, FOTO, 'envio sem foto não apaga a da ficha');
  assert.equal(por['ft-oculta'].foto, '');
  assert.equal(por['ft-oculta'].pessoa.foto, '');
});

test('fotos: removerFoto / atualizar {foto: ""} apagam da ficha e de todas as respostas da pessoa (só admin)', async () => {
  const { api, T } = nova();
  await api.enviar(payloadValido({ id: 'rm-foto-1', foto: FOTO, telefone: '11977771111' }));
  await api.enviar(payloadValido({ id: 'rm-foto-2', foto: FOTO2, telefone: '11977771111' }));
  await api.enviar(payloadValido({ id: 'rm-foto-3', foto: FOTO, telefone: '11977772222' }));
  assert.deepEqual(await api.removerFoto(T, 'rm-foto-1'), { ok: true, id: 'rm-foto-1', removidas: 3 });
  let por = Object.fromEntries((await api.listar(T)).itens.map((i) => [i.id, i]));
  assert.deepEqual([por['rm-foto-1'].foto, por['rm-foto-2'].foto, por['rm-foto-2'].pessoa.foto, por['rm-foto-3'].foto], ['', '', '', FOTO]);
  await assert.rejects(api.removerFoto(T, 'nao-existe'), /Candidato não encontrado/);
  assert.deepEqual(await api.atualizar(T, 'rm-foto-3', { foto: '' }), { ok: true, id: 'rm-foto-3' });
  por = Object.fromEntries((await api.listar(T)).itens.map((i) => [i.id, i]));
  assert.equal(por['rm-foto-3'].foto, '');
  await assert.rejects(api.atualizar(T, 'rm-foto-3', { foto: FOTO }), /só pode ser removida/);
});

test('fotos: salvarMinhaFoto (só a própria), eu e listarUsuarios', async () => {
  const { api, T } = nova();
  assert.equal((await api.eu(T)).usuario.foto, '');
  assert.deepEqual(await api.salvarMinhaFoto(T, FOTO), { ok: true, foto: FOTO });
  assert.equal((await api.eu(T)).usuario.foto, FOTO);
  assert.equal((await api.listarUsuarios(T)).usuarios[0].foto, FOTO);
  await assert.rejects(api.salvarMinhaFoto(T, 'data:image/png;base64,AAAA'), /Foto inválida ou grande demais/);
  assert.deepEqual(await api.salvarMinhaFoto(T, ''), { ok: true, foto: '' });
  assert.equal((await api.eu(T)).usuario.foto, '');
  await assert.rejects(api.salvarMinhaFoto('', FOTO), (e) => e.sessaoExpirada === true);
});

test('fotos na prévia: avatares fictícios (iniciais) em fichas, respostas, equipe e no relatório do Cartório Exemplo', async () => {
  const { api, T } = await previa();
  const itens = (await api.listar(T)).itens;
  const porId = Object.fromEntries(itens.map((i) => [i.id, i]));
  for (const id of ['previa-exemplo-03', 'previa-exemplo-04', 'previa-exemplo-05', 'previa-exemplo-06']) {
    assert.ok(SIM.fotoValida(porId[id].foto), id);
    assert.equal(porId[id].pessoa.foto, porId[id].foto);
  }
  assert.equal(porId['previa-exemplo-01'].foto, '');
  assert.equal(porId['previa-exemplo-01'].pessoa.foto, porId['previa-exemplo-05'].foto, 'Ana: mesma ficha');
  assert.equal(porId['previa-exemplo-09'].foto, '');
  assert.ok(SIM.fotoValida(porId['previa-exemplo-09'].pessoa.foto), 'Renata só na ficha');
  Object.values(SIM.AVATARES_PREVIA).forEach((f) => { assert.ok(SIM.fotoValida(f)); assert.ok(f.length < 15000); });
  const emp = (await api.listarEmpresas(T)).empresas.find((e) => e.nome === 'Clínica Exemplo');
  const eq = await api.listarEquipe(T, emp.id);
  assert.equal(eq.colaboradores.filter((c) => c.foto).length, 4);
  assert.equal(eq.colaboradores.find((c) => /Tiago/.test(c.nome)).foto, '');
  const rel = (await api.relatorioPublico('exemplo-cartorio')).relatorio;
  const comFoto = rel.ranking.linhas.filter((l) => l.foto).map((l) => l.nome).sort();
  assert.deepEqual(comFoto, ['Ana E.', 'Carla M.']);
  assert.ok(rel.disc.quadro.some((q) => q.nome === 'Ana E.' && q.foto === SIM.AVATARES_PREVIA['5511900000001']));
});

test('relatório por modelo: até 1 MB passa (as fotos vão no snapshot)', async () => {
  const { api, T } = await previa();
  const emp = (await api.listarEmpresas(T)).empresas.find((e) => e.nome === 'Clínica Exemplo');
  const ok = await api.salvarRelatorioModelo(T, { modelo: 'equipe', empresaId: emp.id, dados: { titulo: 'Grande', t: 'x'.repeat(900000) } });
  assert.equal(ok.ok, true);
  await assert.rejects(api.salvarRelatorioModelo(T, { modelo: 'equipe', empresaId: emp.id, dados: { t: 'x'.repeat(1000001) } }), /grande demais/);
});

// Rodada 4 (como a migração 20261010120000_mover_versao.sql)
test('moverResposta: troca processo/código/empresa, guarda o histórico; "" = sem processo; só admin', async () => {
  const api = SIM.criar({ armazenamento: localStorageFalso(), scoring: S, latenciaMs: 0 });
  const T = (await api.login('admin@previa.com', 'previa123')).token;
  const procs = (await api.processosListar(T)).processos;
  const sel = procs.find((p) => p.codigo === 'SEL1');
  const atd = procs.find((p) => p.codigo === 'ATD1');
  let bruno = (await api.listar(T)).itens.find((i) => i.id === 'previa-exemplo-02');
  assert.deepEqual([bruno.avaliacao, bruno.processoId, bruno.historicoProcessos], ['SEL1', sel.id, []]);

  const r = await api.moverResposta(T, 'previa-exemplo-02', atd.id);
  assert.equal(r.ok, true);
  assert.deepEqual([r.id, r.processoId, r.avaliacao, r.historicoProcessos.length], ['previa-exemplo-02', atd.id, 'ATD1', 1]);
  assert.deepEqual(Object.assign({}, r.historicoProcessos[0], { em: '' }), { de: sel.id, para: atd.id, deCodigo: 'SEL1', paraCodigo: 'ATD1', em: '' });
  bruno = (await api.listar(T)).itens.find((i) => i.id === 'previa-exemplo-02');
  assert.deepEqual([bruno.avaliacao, bruno.processoId, bruno.avaliacaoNome, bruno.historicoProcessos.length], ['ATD1', atd.id, atd.nome, 1]);
  assert.equal((await api.moverResposta(T, 'previa-exemplo-02', atd.id)).historicoProcessos.length, 1, 'mesmo processo: nada muda');

  const sem = await api.moverResposta(T, 'previa-exemplo-02', '');
  assert.deepEqual([sem.processoId, sem.avaliacao, sem.historicoProcessos.length], ['', '', 2]);
  bruno = (await api.listar(T)).itens.find((i) => i.id === 'previa-exemplo-02');
  assert.deepEqual([bruno.avaliacao, bruno.processoId, bruno.empresaId], ['', '', '']);

  await assert.rejects(api.moverResposta(T, 'previa-exemplo-02', 'nao-existe'), /Processo não encontrado\./);
  await assert.rejects(api.moverResposta(T, 'nao-existe-1', atd.id), /Candidato não encontrado\./);
  await assert.rejects(api.moverResposta(T, '', atd.id), /Candidato não informado\./);
  const TG = (await api.login('gestor@previa.com', 'previa123')).token;
  await assert.rejects(api.moverResposta(TG, 'previa-exemplo-02', atd.id), /Sem permissão\./);
});

test('contratarPessoa: candidato vira colaborador (resposta aprovada); ativo em outra empresa = move', async () => {
  const api = SIM.criar({ armazenamento: localStorageFalso(), scoring: S, latenciaMs: 0 });
  const T = (await api.login('admin@previa.com', 'previa123')).token;
  const clinica = (await api.listarEmpresas(T)).empresas.find((e) => e.nome === 'Clínica Exemplo');
  const antes = (await api.listarEquipe(T, clinica.id)).colaboradores.length;

  const r = await api.contratarPessoa(T, { respostaId: 'previa-exemplo-01', empresaId: clinica.id, area: 'Atendimento' });
  assert.equal(r.ok, true);
  assert.deepEqual([r.colaborador.nome, r.colaborador.cargo, r.colaborador.area, r.colaborador.status, r.movido],
    ['Ana Exemplo Prévia', 'Recepcionista', 'Atendimento', 'ativo', false], 'cargo vazio usa a vaga da resposta');
  const ana = (await api.listar(T)).itens.find((i) => i.id === 'previa-exemplo-01');
  assert.equal(ana.status, 'aprovado');
  assert.equal((await api.listarEquipe(T, clinica.id)).colaboradores.length, antes + 1);

  // De novo na mesma empresa: só atualiza o cargo.
  const r2 = await api.contratarPessoa(T, { pessoaId: ana.pessoaId, empresaId: clinica.id, cargo: 'Recepcionista líder' });
  assert.deepEqual([r2.colaborador.cargo, r2.movido], ['Recepcionista líder', false]);

  // Ativa em outra empresa: move (lá fica desligada, com fim).
  const outra = (await api.salvarEmpresa(T, { nome: 'Padaria Nova' })).empresa;
  const r3 = await api.contratarPessoa(T, { pessoaId: ana.pessoaId, empresaId: outra.id, cargo: 'Caixa' });
  assert.deepEqual([r3.movido, r3.deEmpresaId, r3.colaborador.empresaId], [true, clinica.id, outra.id]);
  const eqC = await api.listarEquipe(T, clinica.id);
  assert.equal(eqC.colaboradores.length, antes);
  assert.ok(eqC.historico.some((c) => c.pessoaId === ana.pessoaId && c.status === 'desligado' && c.fim));
  assert.deepEqual((await api.listarEquipe(T, outra.id)).colaboradores.map((c) => c.nome), ['Ana Exemplo Prévia']);

  await assert.rejects(api.contratarPessoa(T, { respostaId: 'previa-exemplo-01', empresaId: 'emp_nao' }), /Empresa não encontrada\./);
  await assert.rejects(api.contratarPessoa(T, { empresaId: clinica.id }), /Informe a pessoa\./);
  await assert.rejects(api.contratarPessoa(T, { respostaId: 'nao-existe-1', empresaId: clinica.id }), /Candidato não encontrado\./);
  const TG = (await api.login('gestor@previa.com', 'previa123')).token;
  await assert.rejects(api.contratarPessoa(TG, { respostaId: 'previa-exemplo-01', empresaId: clinica.id }), /Sem permissão\./);
});

test('topoIds do organograma: salvarRelacoes guarda na empresa; listarEquipe devolve só ativos; versaoBanco', async () => {
  const api = SIM.criar({ armazenamento: localStorageFalso(), scoring: S, latenciaMs: 0 });
  const T = (await api.login('admin@previa.com', 'previa123')).token;
  const clinica = (await api.listarEmpresas(T)).empresas.find((e) => e.nome === 'Clínica Exemplo');
  const eq = await api.listarEquipe(T, clinica.id);
  assert.deepEqual(eq.topoIds, []);
  const [a, b] = eq.colaboradores;
  const desligado = eq.historico[0].pessoaId;
  const r = await api.salvarRelacoes(T, clinica.id, eq.relacoes, { topoIds: [b.pessoaId, desligado, b.pessoaId, a.pessoaId] });
  assert.deepEqual(r.topoIds, [b.pessoaId, a.pessoaId]);
  assert.deepEqual((await api.listarEquipe(T, clinica.id)).topoIds, [b.pessoaId, a.pessoaId]);
  // Sem o 4º argumento o topo continua.
  assert.deepEqual((await api.salvarRelacoes(T, clinica.id, eq.relacoes)).topoIds, [b.pessoaId, a.pessoaId]);
  // Quem é desligado sai do topo na leitura.
  await api.desligarColaborador(T, b.vinculoId);
  assert.deepEqual((await api.listarEquipe(T, clinica.id)).topoIds, [a.pessoaId]);
  await assert.rejects(api.salvarRelacoes(T, clinica.id, [], { topoIds: 'x' }), /Relações inválidas\./);

  assert.deepEqual(await api.versaoBanco(), { ok: true, versao: 20261013120000, faltando: [] });
});

// ---------------------------------------------------------------------------
// Venda direta (B2C) — como a migração 20261011120000_vendas.sql (contrato em js/api-supabase.js)
// ---------------------------------------------------------------------------

test('vendas (prévia): resumo grátis -> pedido -> Pix fictício -> simularPagamento -> relatório; Parte 2; cupons', async () => {
  const { api, T } = nova({ provedorPagamento: 'asaas' });
  const pc = await api.pacotesPublicos();
  assert.deepEqual(pc.pacotes.map((p) => [p.chave, p.valorCentavos, p.precoCentavos, p.emLancamento]),
    [['gratis', 0, 0, false], ['completo', 2900, 3900, true], ['completo_plus', 4900, 6900, true]]);
  await assert.rejects(api.enviarPessoal(payloadValido({ id: 'pessoal-001', email: '' })), /Informe o seu e-mail/);
  await assert.rejects(api.enviarPessoal(payloadValido({ id: 'pessoal-001', email: 'a@b.com', telefone: '12' })), /WhatsApp inválido/);
  const e = await api.enviarPessoal(payloadValido({ id: 'pessoal-001', email: 'Bia@X.com', telefone: '', idade: 'x', avaliacao: 'ZZZZ' }));
  assert.deepEqual(Object.keys(e), ['ok', 'id', 'protocolo', 'tokenResumo']);
  assert.match(e.tokenResumo, /^[0-9a-f]{64}$/);
  assert.equal(e.protocolo, '');
  assert.equal((await api.enviarPessoal(payloadValido({ id: 'pessoal-001', email: 'bia@x.com' }))).tokenResumo, e.tokenResumo, 'reenvio');
  const r = await api.resumoPessoal(e.tokenResumo);
  assert.deepEqual([r.nome, r.resultado.codigo, r.temParte2], ['João', 'DI', false]);
  await assert.rejects(api.resumoPessoal('f'.repeat(64)), /Resultado não encontrado/);

  await assert.rejects(api.criarPedido(e.tokenResumo, 'gratis', ''), /gratuito/);
  const p = await api.criarPedido(e.tokenResumo, 'completo_plus', '');
  assert.deepEqual([p.valor, p.valorOriginal, p.gratuito, p.status], [4900, 4900, false, 'aguardando']);
  assert.equal((await api.criarPedido(e.tokenResumo, 'completo_plus', '')).pedidoId, p.pedidoId, 'não duplica');
  const pg = await api.iniciarPagamento(p.pedidoId, p.tokenAcesso);
  assert.deepEqual([pg.ok, pg.provedor], [true, 'asaas']);
  assert.match(pg.pix.qrBase64, /^iVBORw0KGgo/);
  assert.match(pg.pix.copiaECola, /^PREVIA-NAO-PAGUE/);
  await assert.rejects(api.iniciarPagamento(p.pedidoId, 'e'.repeat(64)), /Pedido não encontrado/);
  assert.deepEqual(await api.statusPedido(p.pedidoId, p.tokenAcesso), { ok: true, status: 'aguardando' });
  await assert.rejects(api.relatorioPessoal(p.tokenAcesso), (err) => /Pagamento ainda não confirmado/.test(err.message) && err.resposta.status === 'aguardando');
  assert.deepEqual(await api.simularPagamento(p.pedidoId), { ok: true, status: 'pago' });
  assert.deepEqual(await api.statusPedido(p.pedidoId, p.tokenAcesso), { ok: true, status: 'pago' });
  let rel = await api.relatorioPessoal(p.tokenAcesso);
  assert.deepEqual([rel.nome, rel.pacote, rel.precisaParte2, rel.exigido], ['João', 'completo_plus', true, null]);
  const EX = '1234'.repeat(10);
  await assert.rejects(api.salvarParte2Pessoal(p.tokenAcesso, '12'), /Responda todos os grupos/);
  assert.deepEqual((await api.salvarParte2Pessoal(p.tokenAcesso, EX)).exigido, SIM.calcularExigido(EX));
  await assert.rejects(api.salvarParte2Pessoal(p.tokenAcesso, '4321'.repeat(10)), /já foi respondida/);
  rel = await api.relatorioPessoal(p.tokenAcesso);
  assert.deepEqual([rel.precisaParte2, rel.exigidoRespostas], [false, EX]);
  assert.equal((await api.criarPedido(e.tokenResumo, 'completo_plus', '')).jaPago, true);

  // Cupons (painel) e cupom 100% = cortesia na hora.
  await api.salvarCupom(T, { codigo: 'gratis100', tipo: 'percentual', valor: 100, usosMax: 1 });
  await api.salvarCupom(T, { codigo: 'MENOS5', tipo: 'valor', valor: 500, pacotes: ['completo'] });
  await assert.rejects(api.criarPedido(e.tokenResumo, 'completo', 'NAOEXISTE'), /Cupom inválido ou expirado/);
  assert.equal((await api.criarPedido(e.tokenResumo, 'completo', 'menos5')).valor, 2400);
  const g = await api.criarPedido(e.tokenResumo, 'completo', 'GRATIS100');
  assert.deepEqual([g.valor, g.gratuito, g.status], [0, true, 'cortesia']);
  assert.equal((await api.relatorioPessoal(g.tokenAcesso)).ok, true);
  const cupons = (await api.listarCupons(T)).cupons;
  assert.equal(cupons.find((c) => c.codigo === 'GRATIS100').usos, 1);
  const outra = await api.enviarPessoal(payloadValido({ id: 'pessoal-002', email: 'outra@x.com' }));
  await assert.rejects(api.criarPedido(outra.tokenResumo, 'completo', 'GRATIS100'), /Cupom inválido ou expirado/, 'esgotado');
  assert.deepEqual(await api.recuperarAcesso('bia@x.com'), { ok: true });

  // Painel: pedidos, estorno, cortesia, pacotes, resumo; Participantes mostra a origem.
  const ls = await api.listarPedidos(T, { status: 'pago' });
  assert.deepEqual(ls.pedidos.map((x) => x.id), [p.pedidoId]);
  assert.ok(!JSON.stringify(ls).includes(p.tokenAcesso), 'o painel não recebe o token do cliente');
  const est = await api.atualizarPedido(T, p.pedidoId, { status: 'estornado' });
  assert.ok(est.pedido.reembolsadoEm);
  await assert.rejects(api.relatorioPessoal(p.tokenAcesso), /estornada/);
  await assert.rejects(api.atualizarPedido(T, p.pedidoId, { status: 'pago' }), /Não dá para mudar/);
  assert.equal((await api.atualizarPedido(T, p.pedidoId, { status: 'cortesia' })).pedido.status, 'cortesia');
  const pk = await api.salvarPacote(T, { chave: 'completo', precoLancamentoCentavos: null });
  assert.deepEqual([pk.pacote.valorCentavos, pk.pacote.emLancamento], [3900, false]);
  await api.salvarPacote(T, { chave: 'completo_plus', ativo: false });
  assert.deepEqual((await api.pacotesPublicos()).pacotes.map((x) => x.chave), ['gratis', 'completo']);
  assert.equal((await api.listarPacotes(T)).pacotes.length, 3);
  const v = await api.resumoVendas(T, 'hoje');
  assert.deepEqual([v.resumos, v.vendas, v.receitaCentavos], [2, 0, 0]);
  assert.equal(v.cortesias, 2);
  const itens = (await api.listar(T)).itens;
  assert.deepEqual(itens.filter((i) => i.origem === 'pessoal').map((i) => i.id).sort(), ['pessoal-001', 'pessoal-002']);
  assert.equal(itens.find((i) => i.id === 'pessoal-001').email, 'bia@x.com');
});

test('vendas (prévia): InfinitePay é o padrão — redirecionarUrl de volta ao meu-relatorio; confirmarRetorno marca pago', async () => {
  const { api, T } = nova();
  const e = await api.enviarPessoal(payloadValido({ id: 'pessoal-ip1', email: 'ip@x.com', telefone: '' }));
  const p = await api.criarPedido(e.tokenResumo, 'completo', '');
  const pg = await api.iniciarPagamento(p.pedidoId, p.tokenAcesso);
  assert.deepEqual(pg, { ok: true, simulado: true, provedor: 'infinitepay', valor: 2900,
    redirecionarUrl: 'meu-relatorio.html?pedido=' + p.pedidoId + '&order_nsu=' + p.pedidoId +
      '&transaction_nsu=SIM&slug=SIM&capture_method=pix#t-' + p.tokenAcesso });
  assert.ok(!('pix' in pg));
  // Sem referência, ou token errado: não libera.
  assert.deepEqual(await api.confirmarRetorno(p.pedidoId, p.tokenAcesso, {}), { ok: true, status: 'aguardando' });
  await assert.rejects(api.confirmarRetorno(p.pedidoId, 'e'.repeat(64), { transactionNsu: 'SIM' }), /Pedido não encontrado/);
  assert.deepEqual(await api.confirmarRetorno(p.pedidoId, p.tokenAcesso, { transactionNsu: 'SIM', slug: 'SIM' }), { ok: true, status: 'pago' });
  assert.deepEqual(await api.statusPedido(p.pedidoId, p.tokenAcesso), { ok: true, status: 'pago' });
  assert.equal((await api.relatorioPessoal(p.tokenAcesso)).pacote, 'completo');
  assert.deepEqual(await api.confirmarRetorno(p.pedidoId, p.tokenAcesso, { transactionNsu: 'SIM' }), { ok: true, status: 'pago' }, 'idempotente');
  const ped = (await api.listarPedidos(T, {})).pedidos.find((x) => x.id === p.pedidoId);
  assert.deepEqual([ped.provedor, ped.provedorRef, ped.metodo, ped.status], ['infinitepay', 'SIM', 'pix', 'pago']);
  assert.match(ped.faturaUrl, /^meu-relatorio\.html\?pedido=/);
  // CONFIG.PAGAMENTO_PREVIA = 'asaas' troca a prévia para o Pix fictício.
  const alvo = { METODOS: [] };
  const sim = SIM.instalar(alvo, { API_URL: 'simulada', PAGAMENTO_PREVIA: 'asaas' }, { armazenamento: localStorageFalso(), scoring: S, latenciaMs: 0 });
  assert.ok(sim);
  assert.equal(typeof alvo.confirmarRetorno, 'function');
});

test('vendas (prévia): semente com cupons PREVIA100/LANCA10 e simularPagamento instalado no DISC_API', () => {
  const alvo = { METODOS: [] };
  const armazenamento = localStorageFalso();
  SIM.instalar(alvo, { API_URL: 'simulada' }, { armazenamento, scoring: S, latenciaMs: 0 });
  assert.equal(typeof alvo.simularPagamento, 'function');
  assert.equal(typeof alvo.criarPedido, 'function');
  const api = SIM.criar({ armazenamento: localStorageFalso(), scoring: S, latenciaMs: 0 });
  assert.equal(api.processar({ acao: 'pacotes.publicos' }).pacotes.length, 3);
  const e = api.processar({ acao: 'pessoal.enviar', payload: payloadValido({ id: 'pessoal-semente', email: 'x@y.com' }) });
  assert.equal(e.ok, true, e.erro);
  assert.equal(api.processar({ acao: 'pedido.criar', tokenResumo: e.tokenResumo, pacote: 'completo', cupom: 'previa100' }).gratuito, true);
  assert.equal(api.processar({ acao: 'pedido.criar', tokenResumo: e.tokenResumo, pacote: 'completo_plus', cupom: 'LANCA10' }).valor, 4410);
});
