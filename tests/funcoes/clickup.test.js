// Edge Functions x Apps Script: a lógica portada (regras, ClickUp, processoDados, envio) dá o MESMO
// resultado do servidor atual, rodando os dois contra o mesmo ClickUp falso. Nenhuma chamada real.
import test from 'node:test';
import assert from 'node:assert/strict';
import { gas, fixtures, criarFetch, linhaProcesso, TOKEN_CU } from './apoio.js';
import * as regras from '../../supabase/funcoes-compartilhadas/regras.js';
import {
  criarClickUp, cuMontarDadosProcesso, cuSincronizarEnvio, cuListas, cuValorCampo, cuNumero, cuMesmoTelefone
} from '../../supabase/funcoes-compartilhadas/clickup.js';
import { DISC_CONFIABILIDADE } from '../../supabase/funcoes-compartilhadas/motores-gerado.js';

const CHAVE = 'chave-secreta-de-teste-1234567890abcdef';
const ADMIN = { nome: 'Dona do Sistema', email: 'dona@empresa.com', senha: 'senha-forte-1' };

function gasComProcesso(cuFalso, config) {
  const ctx = gas.carregarGas({ props: { ADMIN_KEY: CHAVE, CLICKUP_TOKEN: cuFalso.token }, clickup: cuFalso, confiabilidade: true });
  const r = ctx.post(Object.assign({ acao: 'primeiroAcesso', chave: CHAVE }, ADMIN));
  const proc = ctx.post({ acao: 'processos.salvar', token: r.token, processo: {
    nome: 'Recepcionista 2026', empresa: 'Clínica Alfa', vaga: 'Recepcionista', cidade: 'Campinas',
    consultor: 'Wellington', contratante: 'Dra. Marta', periodo: { inicio: '2026-09-01', fim: '2026-10-15' },
    clickupListId: 'L1', config: config || gas.configExemplo()
  } });
  assert.equal(proc.ok, true, proc.erro);
  return { ctx, T: r.token, proc: proc.processo };
}

function semDormir() {
  const pausas = [];
  return { pausas, dormir: async (ms) => { pausas.push(ms); } };
}

function clienteCu(cuFalso, extra) {
  const d = semDormir();
  const cu = criarClickUp(Object.assign({ token: cuFalso.token, fetch: criarFetch(cuFalso), dormir: d.dormir }, extra));
  cu.pausas = d.pausas;
  return cu;
}

const VALIDACAO = {
  versao: 1, pares: [['D', 'C'], ['I', 'S'], ['D', 'S']], escolhas: ['D', 'I', 'D'],
  itens: [{ id: 'D-f1', letra: 'D', tipo: 'forca', nota: 5 }, { id: 'D-s1', letra: 'D', tipo: 'sombra', nota: 3 },
    { id: 'I-f2', letra: 'I', tipo: 'forca', nota: 4 }, { id: 'C-f3', letra: 'C', tipo: 'contraste', nota: 2 }],
  gruposSeg: new Array(25).fill(9), semMexer: 0, demonstracao: false
};

test('regras: classificarCampo, normalizarNomeCampo, validarConfigProcesso e calcularDisc iguais ao Code.gs', () => {
  const { g } = gas.carregarGas();
  const nomes = ['Sexo', 'Gênero', 'Estado civil', 'Quantos filhos?', 'Religião', 'Está grávida?', 'Etnia', 'Raça/cor', 'Cor da pele',
    'Orientação sexual', 'Pessoa com deficiência', 'Doença crônica', 'Saúde', 'Problema de saúde', 'Antecedentes', 'Tem processo em seu nome?',
    'Histórico criminal', 'Idade', 'Graça', 'WhatsApp', 'Bloco A', '  Pretensão   Salarial! ', 'DISC Código'];
  for (const n of nomes) {
    for (const cfg of [{}, { permitirAntecedentes: true }, { permitirSaude: true }]) {
      assert.equal(regras.classificarCampo(n, cfg), g.classificarCampo(n, cfg), n);
    }
    assert.equal(regras.normalizarNomeCampo(n), g.normalizarNomeCampo(n));
  }
  const configs = [undefined, {}, gas.configExemplo(), gas.configExemplo({ perfilIdeal: 'dd' }), gas.configExemplo({ faixaAvaliar: 90 }),
    { etapas: [{ campo: 'Sexo' }] }, { bonus: [{ id: 'x', regra: { tipo: 'mapa', pontos: { A: '3,5', B: 999 } } }, { id: 'x' }] }, [], 'texto'];
  for (const c of configs) assert.deepEqual(regras.validarConfigProcesso(c), JSON.parse(JSON.stringify(g.validarConfigProcesso(c))));
  const rnd = fixtures.prng(7);
  for (let i = 0; i < 30; i++) {
    const s = require_compactar(fixtures.respostasAleatorias(rnd));
    assert.deepEqual(regras.calcularDisc(s), JSON.parse(JSON.stringify(g.calcularDisc(s))));
  }
  assert.equal(regras.validarRespostasCompactas('1'.repeat(100)), false);
  assert.equal(regras.normalizarProtocolo("'47 k"), '47K');
  assert.equal(regras.normalizarProtocolo('47I'), '');
});

function require_compactar(respostas) {
  return respostas.map((gp) => ['D', 'I', 'S', 'C'].map((l) => gp[l]).join('')).join('');
}

test('conversões: valores dos campos, números e telefones iguais ao ClickUp.gs', () => {
  const { g } = gas.carregarGas();
  const dd = { type: 'drop_down', type_config: { options: [{ id: 'a1', name: 'Um', orderindex: 0 }, { id: 'b2', name: 'Dois', orderindex: 1 }] } };
  const casos = [
    [Object.assign({ value: 1 }, dd)], [Object.assign({ value: 'a1' }, dd)], [Object.assign({ value: 7 }, dd)],
    [{ type: 'labels', value: ['l2', 'l1', 'zz'], type_config: { options: [{ id: 'l1', label: 'A' }, { id: 'l2', label: 'B' }] } }],
    [{ type: 'currency', value: 'R$ 2.500,00' }], [{ type: 'number', value: '7,5' }], [{ type: 'checkbox', value: 'true' }],
    [{ type: 'checkbox' }], [{ type: 'date', value: '1767225600000' }], [{ type: 'short_text', value: { x: 1 } }], [{ type: 'phone', value: '+55 11 9' }]
  ];
  for (const [c] of casos) assert.deepEqual(cuValorCampo(c), g.cuValorCampo(c), JSON.stringify(c));
  for (const v of ['R$ 2.500,00', '7,5', '', null, 'abc', 12, '-3.2']) assert.equal(cuNumero(v), g.cuNumero(v));
  const pares = [['+55 11 98888-1111', '11988881111'], ['(21) 97777-2222', '5511977772222'], ['97777-2222', '5521977772222'], ['123', '123']];
  for (const [a, b] of pares) assert.equal(cuMesmoTelefone(a, b), g.cuMesmoTelefone(a, b));
});

test('processoDados: mesmo resultado do Apps Script (com resposta DISC casada pelo WhatsApp e confiabilidade)', async () => {
  const cuFalso = gas.criarClickUpFalso({ listas: { L1: gas.listaExemplo() } });
  const { ctx, T, proc } = gasComProcesso(cuFalso, gas.configExemplo({ permitirAntecedentes: true }));
  const payload = fixtures.payloadValido({ id: 'ana-envio-001', nome: 'Ana Paula Souza', telefone: '11988881111', avaliacao: proc.codigo, validacao: VALIDACAO });
  const env = ctx.post({ acao: 'enviar', payload });
  assert.equal(env.ok, true, env.erro);
  const esperado = ctx.post({ acao: 'processo.dados', token: T, id: proc.id });
  assert.equal(esperado.ok, true, esperado.erro);

  const linha = linhaProcesso({ codigo: proc.codigo, config: gas.configExemplo({ permitirAntecedentes: true }) });
  const respostas = [
    { id: 'ana-envio-001', processo_id: linha.id, telefone: '5511988881111', respostas: payload.respostas, validacao: VALIDACAO, protocolo: env.protocolo },
    { id: 'sobra-0000001', processo_id: linha.id, telefone: '5599911112222', respostas: payload.respostas, validacao: null, protocolo: '01A' }
  ];
  const cu = clienteCu(cuFalso);
  const dados = await cuMontarDadosProcesso(cu, regras.processoDaLinha(linha), respostas, DISC_CONFIABILIDADE);
  assert.deepEqual(dados.candidatos, esperado.candidatos);
  assert.deepEqual(dados.status, esperado.status);
  assert.deepEqual(dados.config, esperado.config);
  assert.deepEqual(dados.avisos, esperado.avisos.concat(['1 resposta do DISC deste processo sem tarefa correspondente no ClickUp (WhatsApp diferente).']));
  const p = Object.assign({}, esperado.processo, { id: linha.id, codigo: proc.codigo });
  assert.deepEqual(dados.processo, p);
  assert.equal(dados.candidatos[0].disc.confiabilidade.nivel, 'alta');
  assert.equal(dados.candidatos[0].antecedentes, 'Nada consta');
  const txt = JSON.stringify(dados);
  ['Feminino', 'Casada', 'Asma', 'ana@exemplo.com', '98888', 'pk_teste'].forEach((s) => assert.ok(!txt.includes(s), s));
});

test('envio -> ClickUp: mesmas gravações do Apps Script (tarefa achada, criada "sem formulário" e comentário)', async () => {
  const cenarios = [
    { nome: 'Ana Paula Souza', telefone: '11988881111', lista: () => gas.listaExemplo() },
    { nome: 'Diego Ramos', telefone: '31955554444', lista: () => gas.listaExemplo() },
    { nome: 'Bruno Lima Castro', telefone: '21977772222', validacao: VALIDACAO,
      lista: () => { const l = gas.listaExemplo(); l.campos = l.campos.filter((c) => !/^DISC/.test(c.name)); return l; } }
  ];
  for (const c of cenarios) {
    const a = gas.criarClickUpFalso({ listas: { L1: c.lista() } });
    const { ctx, proc } = gasComProcesso(a);
    const payload = fixtures.payloadValido({ id: 'envio-' + c.telefone, nome: c.nome, telefone: c.telefone, avaliacao: proc.codigo, validacao: c.validacao });
    const r = ctx.post({ acao: 'enviar', payload });
    assert.equal(r.ok, true, r.erro);

    const b = gas.criarClickUpFalso({ listas: { L1: c.lista() } });
    const cu = clienteCu(b);
    const linha = { nome: c.nome, telefone: '55' + c.telefone, respostas: payload.respostas, validacao: c.validacao || null, protocolo: r.protocolo };
    const s = await cuSincronizarEnvio(cu, regras.processoDaLinha(linhaProcesso()), linha, DISC_CONFIABILIDADE);
    assert.equal(s.ok, true);
    assert.deepEqual(b.listas.L1, a.listas.L1, c.nome);
    assert.deepEqual(b.requisicoes.map((q) => q.metodo + ' ' + q.url), a.requisicoes.map((q) => q.metodo + ' ' + q.url));
    assert.equal(cu.avisos.length, s.avisos.length);
  }
});

test('listas do ClickUp, sem token, erro HTTP em pt-BR sem o token e 429 com nova tentativa', async () => {
  const times = [{ id: 'T1', name: 'Notus', espacos: [{ id: 'S1', name: 'Seleção',
    pastas: [{ id: 'F1', name: 'Processos', listas: [{ id: 'L1', name: 'Recepcionista' }] }], listas: [{ id: 'L9', name: 'Avulsa' }] }] }];
  const cuFalso = gas.criarClickUpFalso({ listas: { L1: gas.listaExemplo() }, times });
  assert.deepEqual(await cuListas(clienteCu(cuFalso)), [
    { id: 'L1', nome: 'Recepcionista', pasta: 'Seleção / Processos' }, { id: 'L9', nome: 'Avulsa', pasta: 'Seleção' }]);
  assert.deepEqual(await cuListas(clienteCu(cuFalso, { pastaId: 'F1' })), [{ id: 'L1', nome: 'Recepcionista', pasta: 'Processos' }]);

  const sem = criarClickUp({ token: '', fetch: () => { throw new Error('não deveria chamar'); } });
  assert.equal(sem.configurado, false);
  await assert.rejects(sem.get('/user'), /CLICKUP_TOKEN/);

  let primeira = true;
  const d = semDormir();
  const cu = criarClickUp({ token: TOKEN_CU, dormir: d.dormir, fetch: criarFetch(cuFalso, { falha: ({ url }) => {
    if (/\/field$/.test(url) && primeira) { primeira = false; return { codigo: 429, corpo: { err: 'Rate' } }; }
    if (/\/task\?/.test(url)) return { codigo: 500, corpo: { err: 'boom' } };
    return null;
  } }) });
  assert.equal((await cu.campos('L1')).length, gas.listaExemplo().campos.length);
  assert.deepEqual(d.pausas, [10000]);
  await assert.rejects(cu.tarefas('L1'), (e) => /o ClickUp respondeu 500 em GET \/list\/L1\/task \(boom\)/.test(e.message) && !e.message.includes(TOKEN_CU));

  // ritmo: a 91ª chamada no mesmo minuto espera
  const d2 = semDormir();
  const cu2 = criarClickUp({ token: TOKEN_CU, dormir: d2.dormir, agora: () => 1000, fetch: async () => new Response('{}', { status: 200 }) });
  for (let i = 0; i < 90; i++) await cu2.post('/x', {});
  assert.equal(d2.pausas.length, 0);
  await cu2.post('/x', {});
  assert.equal(d2.pausas.length, 1);
});
