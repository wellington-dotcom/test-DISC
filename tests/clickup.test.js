'use strict';
// Servidor (Apps Script) x ClickUp: processos, leitura dos candidatos, campos sensíveis e envio do DISC.
// Tudo contra o ClickUp FALSO de tests/helpers/gas.js (nenhuma chamada real).
const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarGas, criarClickUpFalso, listaExemplo, configExemplo } = require('./helpers/gas.js');
const { payloadValido } = require('./helpers/fixtures.js');

const CHAVE = 'chave-secreta-de-teste-1234567890abcdef';
const ADMIN = { nome: 'Dona do Sistema', email: 'dona@empresa.com', senha: 'senha-forte-1' };

function hierarquia() {
  return [{
    id: 'T1', name: 'Notus',
    espacos: [{
      id: 'S1', name: 'Seleção',
      pastas: [{ id: 'F1', name: 'Processos 2026', listas: [{ id: 'L1', name: 'Recepcionista — Clínica Alfa' }, { id: 'L2', name: 'Vendedor' }] }],
      listas: [{ id: 'L9', name: 'Avulsa' }]
    }]
  }];
}

function preparar(op) {
  op = op || {};
  const cu = criarClickUpFalso(Object.assign({ listas: { L1: listaExemplo(op.lista) }, times: hierarquia() }, op.clickup));
  const props = Object.assign({ ADMIN_KEY: CHAVE, CLICKUP_TOKEN: cu.token }, op.props);
  if (op.semToken) delete props.CLICKUP_TOKEN;
  const ctx = carregarGas({ props, clickup: cu, confiabilidade: op.confiabilidade !== false });
  const r = ctx.post(Object.assign({ acao: 'primeiroAcesso', chave: CHAVE }, ADMIN));
  assert.equal(r.ok, true, r.erro);
  const T = r.token;
  const proc = ctx.post({ acao: 'processos.salvar', token: T, processo: {
    nome: 'Recepcionista 2026', empresa: 'Clínica Alfa', vaga: 'Recepcionista', cidade: 'Campinas',
    consultor: 'Wellington', contratante: 'Dra. Marta', periodo: { inicio: '2026-09-01', fim: '2026-10-15' },
    clickupListId: 'L1', config: configExemplo(op.config)
  } });
  assert.equal(proc.ok, true, proc.erro);
  return { ctx, cu, T, proc: proc.processo };
}

const semSensiveis = (txt) => {
  ['Feminino', 'Masculino', 'Casada', 'Asma', 'Nada consta', 'ana@exemplo.com', '98888', '97777', '96666', 'pk_teste']
    .forEach((s) => assert.ok(!txt.includes(s), 'não pode conter "' + s + '"'));
};

test('classificarCampo: termos sensíveis no começo de palavra; antecedentes e saúde só com permissão', () => {
  const { g } = carregarGas();
  const sens = ['Sexo', 'Gênero', 'Estado civil', 'Quantos filhos?', 'Religião', 'Está grávida?', 'Etnia', 'Raça/cor',
    'Cor da pele', 'Orientação sexual', 'Pessoa com deficiência', 'Doença crônica', 'Saúde', 'Antecedentes', 'Tem processo em seu nome?', 'Histórico criminal'];
  sens.forEach((n) => assert.equal(g.classificarCampo(n, {}), 'sensivel', n));
  ['Idade', 'Graça', 'WhatsApp', 'Bloco A', 'Escolaridade', 'DISC Código'].forEach((n) => assert.equal(g.classificarCampo(n, {}), '', n));
  assert.equal(g.classificarCampo('Antecedentes criminais', { permitirAntecedentes: true }), 'antecedente');
  assert.equal(g.classificarCampo('Problema de saúde', { permitirSaude: true }), '');
  assert.equal(g.classificarCampo('Sexo', { permitirAntecedentes: true, permitirSaude: true }), 'sensivel');
  assert.equal(g.normalizarNomeCampo('  Pretensão   Salarial! '), 'pretensao salarial');
});

test('cuValorCampo converte drop_down (orderindex e id), labels, número, moeda em texto, checkbox e data', () => {
  const { g } = carregarGas();
  const dd = { type: 'drop_down', type_config: { options: [{ id: 'a1', name: 'Um', orderindex: 0 }, { id: 'b2', name: 'Dois', orderindex: 1 }] } };
  assert.equal(g.cuValorCampo(Object.assign({ value: 1 }, dd)), 'Dois');
  assert.equal(g.cuValorCampo(Object.assign({ value: 'a1' }, dd)), 'Um');
  assert.equal(g.cuValorCampo(Object.assign({}, dd)), null);
  assert.equal(g.cuValorCampo({ type: 'labels', value: ['x', 'y'], type_config: { options: [{ id: 'x', label: 'Xis' }, { id: 'y', label: 'Ípsilon' }] } }), 'Xis, Ípsilon');
  assert.equal(g.cuValorCampo({ type: 'currency', value: '2500.5' }), 2500.5);
  assert.equal(g.cuValorCampo({ type: 'number', value: 7 }), 7);
  assert.equal(g.cuValorCampo({ type: 'checkbox' }), false);
  assert.equal(g.cuValorCampo({ type: 'checkbox', value: 'true' }), true);
  assert.equal(g.cuValorCampo({ type: 'short_text', value: 'oi' }), 'oi');
  assert.equal(g.cuValorCampo({ type: 'date', value: String(Date.UTC(2026, 0, 2)) }), '2026-01-02T00:00:00.000Z');
  assert.equal(g.cuNumero('R$ 2.100,00'), 2100);
  assert.equal(g.cuNumero('7,5'), 7.5);
  assert.equal(g.cuMesmoTelefone('+55 (11) 98888-1111', '5511988881111'), true);
  assert.equal(g.cuMesmoTelefone('98888-1111', '5511988881111'), true, 'sem DDD: compara só os 8 últimos');
  assert.equal(g.cuMesmoTelefone('(21) 98888-1111', '5511988881111'), false, 'DDD diferente');
  assert.equal(g.cuMesmoTelefone('011 98888-1111', '5511988881111'), true, '0 na frente');
});

test('clickup.status: sem token não chama nada; com token conecta e nunca devolve o token', () => {
  const sem = preparar({ semToken: true });
  const r0 = sem.ctx.post({ acao: 'clickup.status', token: sem.T });
  assert.equal(r0.ok, true);
  assert.equal(r0.configurado, false);
  assert.equal(sem.ctx.fetches.length, 0);
  assert.match(sem.ctx.post({ acao: 'clickup.listas', token: sem.T }).erro, /CLICKUP_TOKEN/);
  assert.match(sem.ctx.post({ acao: 'processo.dados', token: sem.T, id: sem.proc.id }).erro, /CLICKUP_TOKEN/);

  const { ctx, T, cu } = preparar();
  const r = ctx.post({ acao: 'clickup.status', token: T });
  assert.equal(r.configurado, true);
  assert.equal(r.conectado, true);
  assert.equal(r.usuario, 'Consultora Notus');
  assert.equal(r.iaConfigurada, false);
  assert.ok(!JSON.stringify(r).includes(cu.token));
  assert.equal(cu.requisicoes[0].headers.Authorization, cu.token, 'header Authorization: <token>');
  cu.token = 'pk_outro';
  const ruim = ctx.post({ acao: 'clickup.status', token: T });
  assert.equal(ruim.conectado, false);
  assert.match(ruim.erro, /401/);
  assert.ok(!JSON.stringify(ruim).includes('pk_teste'));
});

test('clickup.listas: percorre time > espaço > pasta > lista (e listas sem pasta); com CLICKUP_PASTA_ID só a pasta', () => {
  const { ctx, T, cu } = preparar();
  const r = ctx.post({ acao: 'clickup.listas', token: T });
  assert.equal(r.ok, true, r.erro);
  assert.deepEqual(r.listas, [
    { id: 'L1', nome: 'Recepcionista — Clínica Alfa', pasta: 'Seleção / Processos 2026' },
    { id: 'L2', nome: 'Vendedor', pasta: 'Seleção / Processos 2026' },
    { id: 'L9', nome: 'Avulsa', pasta: 'Seleção' }
  ]);
  assert.ok(!cu.requisicoes.some((q) => /\/folder\/F1\/list/.test(q.url)), 'a pasta já trouxe as listas: sem chamada extra');

  const p = preparar({ props: { CLICKUP_PASTA_ID: 'F1' } });
  const r2 = p.ctx.post({ acao: 'clickup.listas', token: p.T });
  assert.deepEqual(r2.listas.map((l) => [l.id, l.pasta]), [['L1', 'Processos 2026'], ['L2', 'Processos 2026']]);
  assert.equal(p.cu.requisicoes.length, 1);
});

test('processos: salvar/listar com campos novos e config; alias avaliacoes.*; recusas', () => {
  const { ctx, T, proc } = preparar();
  assert.match(proc.codigo, /^[A-Z0-9]{4}$/);
  assert.equal(proc.tipo, 'selecao');
  assert.equal(proc.ativa, true);
  assert.equal(proc.empresa, 'Clínica Alfa');
  assert.equal(proc.empresaNome, 'Clínica Alfa');
  assert.deepEqual(proc.periodo, { inicio: '2026-09-01', fim: '2026-10-15' });
  assert.equal(proc.clickupListId, 'L1');
  assert.equal(proc.config.perfilIdeal, 'S');
  assert.equal(proc.config.etapas.length, 3);
  assert.deepEqual(proc.config.bonus[1].regra, { tipo: 'mapa', pontos: { 'Fluente': 5, 'Básico': 1 } });

  const lista = ctx.post({ acao: 'processos.listar', token: T });
  assert.equal(lista.processos.length, 1);
  assert.equal(lista.processos[0].contratante, 'Dra. Marta');
  assert.equal(ctx.post({ acao: 'avaliacoes.listar', token: T }).avaliacoes[0].id, proc.id, 'alias continua');

  const pub = ctx.post({ acao: 'avaliacaoPublica', codigo: proc.codigo });
  assert.deepEqual(pub.avaliacao, { codigo: proc.codigo, nome: 'Recepcionista 2026', tipo: 'selecao', empresaNome: 'Clínica Alfa', mostrarResultado: false });

  // edição parcial mantém o resto
  const ed = ctx.post({ acao: 'processos.salvar', token: T, processo: { id: proc.id, nome: 'Recepcionista 2026 B', ativa: false } });
  assert.equal(ed.ok, true, ed.erro);
  assert.equal(ed.processo.codigo, proc.codigo);
  assert.equal(ed.processo.ativa, false);
  assert.equal(ed.processo.clickupListId, 'L1');
  assert.equal(ed.processo.config.corte, 70);

  assert.match(ctx.post({ acao: 'processos.salvar', token: T, processo: { nome: 'X Y', config: configExemplo({ etapas: [{ id: 'e', nome: 'E', peso: 1, campo: 'Estado civil' }] }) } }).erro, /sensível/);
  assert.match(ctx.post({ acao: 'processos.salvar', token: T, processo: { nome: 'X Y', config: { perfilIdeal: 'DDX' } } }).erro, /Perfil ideal/);
  assert.match(ctx.post({ acao: 'processos.salvar', token: T, processo: { nome: 'X Y', config: { corte: 50, faixaAvaliar: 60 } } }).erro, /corte/);
  assert.match(ctx.post({ acao: 'processos.salvar', token: T, processo: { nome: 'X Y', clickupListId: '../x' } }).erro, /ClickUp/);
  assert.match(ctx.post({ acao: 'processos.salvar', token: T, processo: { nome: '' } }).erro, /nome do processo/);
  assert.equal(ctx.post({ acao: 'processos.salvar', token: T, processo: { id: 'ava_nao', nome: 'X Y' } }).erro, 'Processo não encontrado.');
  const novo = ctx.post({ acao: 'processos.salvar', token: T, processo: { nome: '=Processo Novo' } });
  assert.equal(novo.ok, true);
  assert.equal(novo.processo.config.corte, 70, 'config padrão');
  assert.equal(ctx.abas.Avaliacoes.linhas[2][3], "'=Processo Novo", 'protegido contra fórmula');
  assert.equal(ctx.post({ acao: 'processos.excluir', token: T, id: novo.processo.id }).ok, true);
});

test('planilha antiga com Avaliacoes de 8 colunas: ganha as colunas novas no fim sem perder nada', () => {
  const ctx = carregarGas({ props: { ADMIN_KEY: CHAVE } });
  ctx.g.SpreadsheetApp.getActiveSpreadsheet().insertSheet('Avaliacoes');
  ctx.abas.Avaliacoes.linhas.push(['id', 'codigo', 'empresaId', 'nome', 'tipo', 'mostrarResultado', 'ativa', 'criadaEm'],
    ['ava_antiga', 'ABCD', '', 'Antiga', 'selecao', false, true, '2026-01-01T00:00:00.000Z']);
  const r = ctx.post(Object.assign({ acao: 'primeiroAcesso', chave: CHAVE }, ADMIN));
  const l = ctx.post({ acao: 'processos.listar', token: r.token });
  assert.equal(l.processos[0].codigo, 'ABCD');
  assert.equal(l.processos[0].clickupListId, '');
  assert.equal(l.processos[0].config.corte, 70);
  assert.equal(ctx.abas.Avaliacoes.linhas[0].length, 17);
  assert.equal(ctx.post({ acao: 'enviar', payload: payloadValido({ id: 'antiga-00001', avaliacao: 'ABCD' }) }).ok, true);
});

test('processo.dados: candidatos normalizados, sem campos sensíveis, com avisos e status da lista', () => {
  const { ctx, T, proc } = preparar();
  const d = ctx.post({ acao: 'processo.dados', token: T, id: proc.id });
  assert.equal(d.ok, true, d.erro);
  semSensiveis(JSON.stringify(d));
  assert.equal(d.processo.clickupListId, 'L1');
  assert.equal(d.processo.contratante, 'Dra. Marta');
  assert.deepEqual(d.status.map((s) => s.nome), ['novo', 'entrevista', 'gerar relatório', 'relatório em revisão', 'concluído']);
  assert.deepEqual(d.status[4], { nome: 'concluído', tipo: 'closed', cor: '#13283f' });
  assert.deepEqual(d.candidatos.map((c) => c.nome), ['Ana Paula Souza', 'Bruno Lima Castro', 'Carla Dias'], 'tarefa de briefing fica de fora');
  const [ana, bruno, carla] = d.candidatos;
  assert.equal(ana.id, 't1');
  assert.equal(ana.status, 'entrevista');
  assert.equal(ana.criadoEm, '2026-09-01T00:00:00.000Z');
  assert.equal(ana.idade, 29);
  assert.equal(ana.statusTrabalho, 'Desempregado');
  assert.equal(bruno.statusTrabalho, 'Empregado', 'drop_down por orderindex');
  assert.equal(ana.pretensao, 2500);
  assert.equal(ana.ultimoSalario, 2100, 'texto "R$ 2.100,00" vira número');
  assert.equal(ana.formacao, 'Superior');
  assert.equal(bruno.formacao, 'Ensino médio', 'drop_down por id');
  assert.deepEqual(ana.notas, { blocoA: 8, entrevista: 9, dinamica: null });
  assert.deepEqual(bruno.notas, { blocoA: 6, entrevista: null, dinamica: null });
  assert.deepEqual(ana.bonusValores, { cnh: true, ingles: 'Fluente' });
  assert.deepEqual(bruno.bonusValores, { cnh: false, ingles: null });
  assert.equal(ana.disc, null);
  assert.deepEqual(carla.disc, { percentuais: { D: 10, I: 20, S: 30, C: 40 }, codigo: 'CS', confiabilidade: { nivel: 'baixa', motivos: [] }, protocolo: '12A' });
  assert.deepEqual(d.candidatos.map((c) => c.finalista), [true, true, true], 'padrão: tem nota ou DISC');
  ['telefone', 'email', 'antecedentes', 'sexo'].forEach((k) => assert.ok(!(k in ana), k));
  assert.ok(d.avisos.includes('Campo "Dinâmica" não encontrado na lista'), JSON.stringify(d.avisos));
  // só leituras: lista, campos e tarefas (uma página)
  assert.ok(ctx.clickup.requisicoes.every((q) => q.metodo === 'get'));
});

test('processo.dados: statusFinalistas, antecedentes só com permissão e paginação até last_page sem repetir chamadas', () => {
  const { ctx, T, proc, cu } = preparar({ config: { statusFinalistas: ['Entrevista'], permitirAntecedentes: true }, clickup: { porPagina: 1 } });
  const d = ctx.post({ acao: 'processo.dados', token: T, id: proc.id });
  assert.equal(d.ok, true, d.erro);
  assert.deepEqual(d.candidatos.map((c) => c.finalista), [true, true, false]);
  assert.equal(d.candidatos[0].antecedentes, 'Nada consta', 'permitido explicitamente no processo');
  const paginas = cu.requisicoes.filter((q) => /\/list\/L1\/task\?/.test(q.url)).map((q) => new URL(q.url).searchParams.get('page'));
  assert.deepEqual(paginas, ['0', '1', '2', '3']);
  assert.ok(cu.requisicoes.every((q) => /include_closed=true&subtasks=false/.test(q.url) || !/\/task\?/.test(q.url)));
  const urls = cu.requisicoes.map((q) => q.url);
  assert.equal(new Set(urls).size, urls.length, 'nenhuma leitura repetida');

  assert.equal(ctx.post({ acao: 'processo.dados', token: T, id: 'ava_nao' }).erro, 'Processo não encontrado.');
  const semLista = ctx.post({ acao: 'processos.salvar', token: T, processo: { nome: 'Sem Lista' } }).processo;
  assert.match(ctx.post({ acao: 'processo.dados', token: T, id: semLista.id }).erro, /não está ligado/);
});

test('limite do ClickUp: 429 espera e tenta de novo; mais de 90 chamadas por minuto faz pausa', () => {
  let primeira = true;
  const { ctx, T, proc } = preparar({
    clickup: { falha: (q) => { if (primeira && /\/field$/.test(q.url)) { primeira = false; return { codigo: 429, corpo: { err: 'Rate limit' }, headers: {} }; } return null; } }
  });
  const d = ctx.post({ acao: 'processo.dados', token: T, id: proc.id });
  assert.equal(d.ok, true, d.erro);
  assert.ok(ctx.sleeps.includes(10000), 'esperou antes de repetir');

  const muitas = listaExemplo();
  for (let i = 0; i < 120; i++) muitas.tarefas.push({ id: 'x' + i, name: 'Pessoa Número ' + i, status: 'novo', valores: {} });
  const p = preparar({ lista: muitas, clickup: { porPagina: 5 } });
  const d2 = p.ctx.post({ acao: 'processo.dados', token: p.T, id: p.proc.id });
  assert.equal(d2.ok, true, d2.erro);
  assert.equal(d2.candidatos.length, 123);

  // ritmo: a 91ª chamada no mesmo minuto espera
  p.ctx.g.cuReiniciar_();
  p.ctx.sleeps.length = 0;
  for (let i = 0; i < 90; i++) p.ctx.g.cuRespeitarLimite_();
  assert.equal(p.ctx.sleeps.length, 0);
  p.ctx.g.cuRespeitarLimite_();
  assert.equal(p.ctx.sleeps.length, 1, 'pausou para não passar de 100/min');
  assert.ok(p.ctx.sleeps[0] > 50000);

  const erro = preparar({ clickup: { falha: () => ({ codigo: 500, corpo: { err: 'boom' } }) } });
  assert.match(erro.ctx.post({ acao: 'processo.dados', token: erro.T, id: erro.proc.id }).erro, /Não foi possível ler o ClickUp: o ClickUp respondeu 500/);
});

test('enviar com processo ligado ao ClickUp: grava os campos DISC na tarefa achada pelo WhatsApp', () => {
  const { ctx, T, proc, cu } = preparar();
  const p = payloadValido({ id: 'ana-envio-001', nome: 'Ana Paula Souza', telefone: '11988881111', avaliacao: proc.codigo });
  const r = ctx.post({ acao: 'enviar', payload: p });
  assert.equal(r.ok, true, r.erro);
  const ana = cu.listas.L1.tarefas.find((t) => t.id === 't1');
  assert.deepEqual([ana.valores.f_dD, ana.valores.f_dI, ana.valores.f_dS, ana.valores.f_dC], [40, 30, 20, 10]);
  assert.equal(ana.valores.f_dPerfil, 'DI');
  assert.equal(ana.valores.f_dCod, r.protocolo);
  assert.equal(ana.valores.f_dConf, 'Indisponível', 'payload sem etapa de validação');
  assert.equal(cu.listas.L1.tarefas.length, 4, 'nenhuma tarefa nova');
  assert.ok(!cu.requisicoes.some((q) => /\/comment$/.test(q.url)), 'campos existem: sem comentário');

  // reenvio (duplicado) não grava de novo
  const antes = cu.requisicoes.length;
  assert.equal(ctx.post({ acao: 'enviar', payload: p }).duplicado, true);
  assert.equal(cu.requisicoes.length, antes);

  // processo.dados agora usa a cópia da planilha (protocolo e confiabilidade calculada)
  const d = ctx.post({ acao: 'processo.dados', token: T, id: proc.id });
  assert.equal(d.candidatos[0].disc.codigo, 'DI');
  assert.equal(d.candidatos[0].disc.protocolo, r.protocolo);
  assert.equal(d.candidatos[0].disc.confiabilidade.nivel, 'indisponivel');
});

test('enviar: candidato fora da lista vira tarefa "<nome> (DISC)" com a etiqueta "sem formulário"', () => {
  const { ctx, T, proc, cu } = preparar();
  const r = ctx.post({ acao: 'enviar', payload: payloadValido({ id: 'novo-envio-01', nome: 'Diego Ramos', telefone: '31955554444', avaliacao: proc.codigo }) });
  assert.equal(r.ok, true, r.erro);
  const nova = cu.listas.L1.tarefas[cu.listas.L1.tarefas.length - 1];
  assert.equal(nova.name, 'Diego Ramos (DISC)');
  assert.deepEqual(nova.tags, ['sem formulário']);
  assert.match(nova.description, /5531955554444/);
  assert.equal(nova.valores.f_dPerfil, 'DI');
  const st = ctx.post({ acao: 'clickup.status', token: T });
  assert.ok(st.avisos.some((a) => /sem formulário/.test(a.aviso)));
  // nos dados do processo o nome aparece sem " (DISC)"
  const d = ctx.post({ acao: 'processo.dados', token: T, id: proc.id });
  assert.ok(d.candidatos.some((c) => c.nome === 'Diego Ramos' && c.disc && c.disc.codigo === 'DI'));
});

test('enviar: lista sem os campos DISC grava tudo num comentário e deixa aviso; com validação calcula a confiabilidade', () => {
  const lista = listaExemplo();
  lista.campos = lista.campos.filter((c) => !/^DISC/.test(c.name));
  const { ctx, T, proc, cu } = preparar({ lista });
  const validacao = {
    versao: 1, pares: [['D', 'C'], ['I', 'S'], ['D', 'S']], escolhas: ['D', 'I', 'D'],
    itens: [{ id: 'D-f1', letra: 'D', tipo: 'forca', nota: 5 }, { id: 'D-s1', letra: 'D', tipo: 'sombra', nota: 3 },
      { id: 'I-f2', letra: 'I', tipo: 'forca', nota: 4 }, { id: 'C-f3', letra: 'C', tipo: 'contraste', nota: 2 }],
    gruposSeg: new Array(25).fill(9), semMexer: 0, demonstracao: false
  };
  const r = ctx.post({ acao: 'enviar', payload: payloadValido({ id: 'bruno-envio-1', nome: 'Bruno Lima Castro', telefone: '21977772222', avaliacao: proc.codigo, validacao }) });
  assert.equal(r.ok, true, r.erro);
  const bruno = cu.listas.L1.tarefas.find((t) => t.id === 't2');
  assert.equal(bruno.comentarios.length, 1);
  assert.match(bruno.comentarios[0], /Perfil: DI/);
  assert.match(bruno.comentarios[0], /D 40% · I 30% · S 20% · C 10%/);
  assert.match(bruno.comentarios[0], /Confiabilidade: Alta/);
  assert.match(bruno.comentarios[0], new RegExp('Código: ' + r.protocolo));
  const st = ctx.post({ acao: 'clickup.status', token: T });
  assert.ok(st.avisos.some((a) => /Campos que faltam na lista: DISC D %/.test(a.aviso)), JSON.stringify(st.avisos));
});

test('enviar: falha no ClickUp ou ClickUp não configurado nunca impedem o candidato de concluir', () => {
  const { ctx, T, proc } = preparar({ clickup: { falha: (q) => (q.metodo === 'post' ? { codigo: 500, corpo: { err: 'fora do ar' } } : null) } });
  const r = ctx.post({ acao: 'enviar', payload: payloadValido({ id: 'falha-clickup1', telefone: '11988881111', avaliacao: proc.codigo }) });
  assert.equal(r.ok, true, r.erro);
  assert.match(r.protocolo, /^[0-9]{2}[A-HJ-NP-Z]$/);
  assert.deepEqual(Object.keys(r).sort(), ['id', 'ok', 'protocolo'], 'o candidato não vê avisos');
  assert.ok(ctx.post({ acao: 'clickup.status', token: T }).avisos.some((a) => /não foi possível gravar no ClickUp/.test(a.aviso)));

  const sem = preparar({ semToken: true });
  assert.equal(sem.ctx.post({ acao: 'enviar', payload: payloadValido({ id: 'sem-token-001', avaliacao: sem.proc.codigo }) }).ok, true);
  assert.equal(sem.ctx.fetches.length, 0);
});

test('gestor e quem não tem sessão não alcançam processos, ClickUp nem relatórios', () => {
  const { ctx, T, proc } = preparar();
  const emp = ctx.post({ acao: 'empresas.salvar', token: T, empresa: { nome: 'Clínica Alfa' } }).empresa;
  ctx.post({ acao: 'usuarios.salvar', token: T, usuario: { nome: 'Gestora Alfa', email: 'g@alfa.com', papel: 'gestor', empresaId: emp.id }, senhaTemporaria: 'temporaria1' });
  const TG = ctx.post({ acao: 'login', email: 'g@alfa.com', senha: 'temporaria1' }).token;
  const acoes = [
    { acao: 'processos.listar' }, { acao: 'processos.salvar', processo: { nome: 'X Y' } }, { acao: 'processos.excluir', id: proc.id },
    { acao: 'clickup.status' }, { acao: 'clickup.listas' }, { acao: 'processo.dados', id: proc.id },
    { acao: 'relatorio.rascunho', processoId: proc.id }, { acao: 'relatorio.salvar', relatorioToken: 'a'.repeat(64), textos: {} },
    { acao: 'relatorio.publicar', relatorioToken: 'a'.repeat(64) }, { acao: 'relatorio.despublicar', relatorioToken: 'a'.repeat(64) },
    { acao: 'relatorios.listar' }, { acao: 'relatorio.melhorarTextos', relatorioToken: 'a'.repeat(64) }
  ];
  const antes = ctx.clickup.requisicoes.length;
  acoes.forEach((c) => {
    assert.equal(ctx.post(Object.assign({ token: TG }, c)).erro, 'Sem permissão.', c.acao);
    assert.equal(ctx.post(c).sessaoExpirada, true, c.acao);
  });
  assert.equal(ctx.clickup.requisicoes.length, antes, 'nenhuma chamada ao ClickUp');
});
