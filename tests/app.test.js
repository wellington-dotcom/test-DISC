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
  const p = A.montarPayload({ id: 'abc123-x', nome: ' Maria  Souza ', telefone: '11999998888', idade: '27',
    funcao: '  Recepcionista ', empresa: ' Clínica  Boa Vista ', vaga: ' Caixa ',
    consentimento: true, inicio: '2026-10-01T12:00:00Z' }, sel, fim);
  assert.equal(p.v, 1);
  assert.equal(p.nome, 'Maria Souza');
  assert.equal(p.telefone, '5511999998888');
  assert.equal(p.vaga, 'Caixa');
  assert.equal(p.idade, 27, 'idade vai como número inteiro');
  assert.equal(p.funcao, 'Recepcionista');
  assert.equal(p.empresa, 'Clínica Boa Vista');
  assert.equal(p.consentimento, true);
  assert.equal(p.duracaoSeg, 600);
  assert.equal(p.respostas, '1234'.repeat(25));
  assert.deepEqual(p.resultado, { percentuais: S.calcular(S.descompactar(p.respostas)).percentuais, codigo: 'CS' });
});

test('montarPayload: função e empresa vazias viram "" e são cortadas em 80 caracteres', () => {
  const sel = [];
  for (let i = 0; i < 25; i++) sel.push(['C', 'S', 'I', 'D']);
  const p = A.montarPayload({ id: 'abc123-y', nome: 'Maria Souza', telefone: '11999998888', idade: 40, consentimento: true }, sel);
  assert.equal(p.idade, 40);
  assert.equal(p.funcao, '');
  assert.equal(p.empresa, '');
  assert.equal(A.limparTextoCurto('x'.repeat(100)).length, 80);
});

test('validarIdade: obrigatória, só números, de 14 a 99', () => {
  ['14', '30', '99', 45, ' 18 '].forEach((v) => assert.equal(A.validarIdade(v), '', String(v)));
  ['', '   ', null, undefined, 'trinta', '3 0', '30a', '-20', '30.5', '1e2'].forEach((v) => {
    assert.equal(A.validarIdade(v), 'Informe sua idade (só números).', String(v));
  });
  ['13', '0', '100', '150', 7].forEach((v) => {
    assert.equal(A.validarIdade(v), 'Confira a idade: precisa ser entre 14 e 99 anos.', String(v));
  });
  assert.equal(A.limparIdade('3a0'), '30');
  assert.equal(A.limparIdade('12345'), '123');
  assert.equal(A.idadeParaSalvar('30'), 30);
  assert.equal(A.idadeParaSalvar('abc'), null);
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
  assert.match(A.mensagemErroEnvio('Resposta inesperada do servidor. Confira se a URL do Apps Script está correta'), /Gerar código de segurança/);
  assert.match(A.mensagemErroEnvio('O endereço do servidor (API_URL) não está configurado.'), /Gerar código de segurança/);
  assert.match(A.mensagemErroEnvio('Não foi possível conectar ao servidor. Verifique sua conexão'), /conexão/);
});

test('progressoExpirado: vence após 7 dias', () => {
  const agora = Date.parse('2026-10-10T12:00:00Z');
  assert.equal(A.progressoExpirado({ salvoEm: '2026-10-09T12:00:00Z' }, agora), false);
  assert.equal(A.progressoExpirado({ salvoEm: '2026-10-01T12:00:00Z' }, agora), true);
  assert.equal(A.progressoExpirado({ inicio: '2026-10-08T12:00:00Z' }, agora), false);
  assert.equal(A.progressoExpirado({ nome: 'Sem Data' }, agora), true);
});

test('protocolo: 2 dígitos + 1 letra maiúscula, sem I e O', () => {
  assert.equal(A.protocoloValido('47K'), true);
  assert.equal(A.protocoloValido('00A'), true);
  assert.equal(A.protocoloValido('99Z'), true);
  ['47I', '47O', '47k', '4K', '470', 'K47', '147K', '', null, undefined, 47].forEach((p) =>
    assert.equal(A.protocoloValido(p), false, String(p)));
  assert.equal(A.normalizarProtocolo(' 47 k '), '47K');
  assert.equal(A.normalizarProtocolo('47K'), '47K');
  assert.equal(A.normalizarProtocolo('47o'), '');
  assert.equal(A.normalizarProtocolo('DISC1.abc'), '');
  assert.equal(A.normalizarProtocolo(null), '');
});

test('gruposDoTeste: modo demonstração só com 1..24', () => {
  assert.equal(A.gruposDoTeste({}), 25);
  assert.equal(A.gruposDoTeste({ GRUPOS_DEMONSTRACAO: 0 }), 25);
  assert.equal(A.gruposDoTeste({ GRUPOS_DEMONSTRACAO: 3 }), 3);
  assert.equal(A.gruposDoTeste({ GRUPOS_DEMONSTRACAO: '5' }), 5);
  assert.equal(A.gruposDoTeste({ GRUPOS_DEMONSTRACAO: 25 }), 25);
  assert.equal(A.gruposDoTeste({ GRUPOS_DEMONSTRACAO: 40 }), 25);
  assert.equal(A.gruposDoTeste({ GRUPOS_DEMONSTRACAO: -2 }), 25);
  assert.equal(A.gruposDoTeste(null), 25);
  assert.equal(require('../js/config.js').GRUPOS_DEMONSTRACAO, 0, 'desligado no site real');
});

test('completarGruposDemonstracao: preenche o resto com permutações válidas sem mexer nos respondidos', () => {
  const ordens = [['S', 'C', 'I', 'D'], ['D', 'I', 'S', 'C'], ['C', 'S', 'I', 'D']];
  const respondidos = [true, true, true];
  const copiaOrdens = JSON.stringify(ordens);
  for (let semente = 1; semente <= 20; semente++) {
    const c = A.completarGruposDemonstracao(ordens, respondidos, 3, prng(semente));
    assert.equal(c.ordens.length, 25);
    assert.equal(c.respondidos.length, 25);
    assert.deepEqual(c.ordens.slice(0, 3), ordens, 'respondidos ficam iguais');
    c.ordens.forEach((o, i) => {
      assert.ok(A.ordemValida(o), 'grupo ' + i);
      assert.deepEqual(o.slice().sort(), ['C', 'D', 'I', 'S']);
    });
    assert.ok(c.respondidos.every(Boolean));
    assert.deepEqual(c.preenchidos, Array.from({ length: 22 }, (_, k) => k + 3));
    // payload com as 25 respostas (100 dígitos)
    const p = A.montarPayload({ id: 'abc123-x', nome: 'Ana Lima', telefone: '11999998888', consentimento: true }, c.ordens);
    assert.match(p.respostas, /^[1-4]{100}$/);
    assert.equal(p.respostas.slice(0, 4), '1243', 'grupo 1: S=4 C=3 I=2 D=1');
  }
  assert.equal(JSON.stringify(ordens), copiaOrdens, 'não altera a lista original');
  // Idempotente: o que já foi completado não muda numa segunda chamada.
  const c1 = A.completarGruposDemonstracao(ordens, respondidos, 3, prng(7));
  const c2 = A.completarGruposDemonstracao(c1.ordens, c1.respondidos, 3, prng(8));
  assert.deepEqual(c2.ordens, c1.ordens);
  assert.deepEqual(c2.preenchidos, []);
  // Grupo respondido além de N também é preservado; mexido mas não confirmado é sorteado de novo.
  const parcial = A.completarGruposDemonstracao([null, null, null, ['C', 'I', 'S', 'D'], ['D', 'C', 'I', 'S']], [false, false, false, true, false], 3, prng(3));
  assert.deepEqual(parcial.ordens[3], ['C', 'I', 'S', 'D']);
  assert.equal(parcial.preenchidos.indexOf(3), -1);
  assert.ok(parcial.preenchidos.indexOf(4) !== -1);
  assert.equal(parcial.ordens[0], null, 'os N primeiros não são preenchidos');
  assert.equal(parcial.respondidos[0], false);
});

test('textosAvaliacao: sem link, seleção e equipe', () => {
  const geral = A.textosAvaliacao(null, 'Loja X');
  assert.equal(geral.comLink, false);
  assert.equal(geral.contexto, 'Processo seletivo');
  assert.equal(geral.empresa, 'Loja X');
  assert.equal(geral.escopo, 'apenas neste processo seletivo da Loja X');
  assert.equal(geral.mostrarVaga, true);
  assert.equal(A.textosAvaliacao(null, '').escopo, 'apenas neste processo seletivo');

  const sel = A.textosAvaliacao({ codigo: 'SEL1', tipo: 'selecao', empresaNome: 'Clínica Exemplo' }, 'Ignorada');
  assert.equal(sel.empresa, 'Clínica Exemplo');
  assert.equal(sel.pessoa, 'candidato');
  assert.equal(sel.mostrarVaga, true);
  assert.equal(sel.mostrarEmpresaAtual, true);
  assert.equal(sel.rotuloFuncao, 'Função atual ou última');
  assert.equal(sel.escopo, 'apenas nesta avaliação da Clínica Exemplo, conduzida pela Notus');

  const eq = A.textosAvaliacao({ codigo: 'EQP1', tipo: 'equipe', empresaNome: 'Clínica Exemplo' });
  assert.equal(eq.tipo, 'equipe');
  assert.equal(eq.contexto, 'Avaliação de equipe');
  assert.equal(eq.pessoa, 'colaborador');
  assert.equal(eq.mostrarVaga, false);
  assert.equal(eq.mostrarEmpresaAtual, false);
  assert.equal(eq.rotuloFuncao, 'Seu cargo/função');
  assert.match(eq.escopo, /compartilhado com a empresa/);
  assert.match(eq.usoDados, /cadastro da equipe/);
  assert.match(eq.enviado, /avaliação da equipe/);
});

function ordensFixas(ordem) {
  const o = [];
  for (let i = 0; i < 25; i++) o.push(ordem.slice());
  return o;
}

test('resultadoDasOrdens: null com grupo faltando', () => {
  const o = ordensFixas(['D', 'I', 'S', 'C']);
  assert.deepEqual(A.resultadoDasOrdens(o).ordem, ['D', 'I', 'S', 'C']);
  o[7] = null;
  assert.equal(A.resultadoDasOrdens(o), null);
  assert.equal(A.resultadoDasOrdens(null), null);
});

test('novaValidacao / precisaMontarValidacao / telas completas', () => {
  const res = A.resultadoDasOrdens(ordensFixas(['S', 'C', 'I', 'D']));
  const v = A.novaValidacao(res, prng(5));
  assert.equal(v.montagem.ordem, 'SCID');
  assert.equal(v.montagem.pares.length, 3);
  assert.equal(v.montagem.itens.length, 4);
  assert.deepEqual(v.escolhas, [null, null, null]);
  assert.equal(A.precisaMontarValidacao(v, res), false);
  assert.equal(A.precisaMontarValidacao(null, res), true);
  assert.equal(A.precisaMontarValidacao(v, A.resultadoDasOrdens(ordensFixas(['D', 'I', 'S', 'C']))), true, 'resultado mudou');
  // Mesma semente => mesma montagem
  assert.deepEqual(A.novaValidacao(res, prng(5)).montagem, v.montagem);

  assert.equal(A.telaValidacaoCompleta(v, 1), false);
  v.escolhas = v.montagem.pares.map((p) => p[0]);
  assert.equal(A.telaValidacaoCompleta(v, 1), true);
  v.escolhas[2] = 'X';
  assert.equal(A.telaValidacaoCompleta(v, 1), false, 'letra fora do par');
  v.escolhas[2] = v.montagem.pares[2][1];
  assert.equal(A.telaValidacaoCompleta(v, 2), false);
  v.montagem.itens.forEach((it, k) => { v.notas[it.id] = k + 1; });
  assert.equal(A.telaValidacaoCompleta(v, 2), true);
  assert.equal(A.validacaoCompleta(v), true);
  v.notas[v.montagem.itens[0].id] = 6;
  assert.equal(A.validacaoCompleta(v), false, 'nota fora de 1..5');
});

test('somarTempo acumula por grupo, em décimos de segundo', () => {
  let s = A.somarTempo([], 0, 1234);
  assert.equal(s.length, 25);
  assert.equal(s[0], 1.2);
  s = A.somarTempo(s, 0, 900);
  assert.equal(s[0], 2.1, 'voltar ao grupo soma');
  s = A.somarTempo(s, 3, -5);
  assert.equal(s[3], 0, 'tempo negativo ignorado');
  assert.equal(A.somarTempo(['x', -2, null], -1, 0).slice(0, 3).join(), '0,0,0');
});

test('montarValidacao e montarPayload levam avaliacao e validacao', () => {
  const ordens = ordensFixas(['C', 'S', 'I', 'D']);
  const res = A.resultadoDasOrdens(ordens);
  const v = A.novaValidacao(res, prng(9));
  const dados = { id: 'abc123-z', nome: 'Ana Lima', telefone: '11999998888', idade: 30, consentimento: true,
    avaliacaoCodigo: ' sel1 ', validacao: v, gruposSeg: [4.5, 2], aceitos: [true, false, true], demonstracao: false };
  assert.equal(A.montarValidacao(dados), null, 'etapa incompleta');
  let p = A.montarPayload(dados, ordens);
  assert.equal(p.avaliacao, 'SEL1');
  assert.equal(p.validacao, null);

  v.escolhas = v.montagem.pares.map((par) => par[1]);
  v.montagem.itens.forEach((it) => { v.notas[it.id] = 4; });
  p = A.montarPayload(dados, ordens);
  const val = p.validacao;
  assert.equal(val.versao, 1);
  assert.deepEqual(val.pares, v.montagem.pares);
  assert.deepEqual(val.escolhas, v.escolhas);
  assert.deepEqual(val.itens.map((it) => Object.keys(it).sort().join()), Array(4).fill('id,letra,nota,tipo'));
  assert.ok(val.itens.every((it) => it.nota === 4));
  assert.equal(val.gruposSeg.length, 25);
  assert.equal(val.gruposSeg[0], 4.5);
  assert.equal(val.gruposSeg[5], 0);
  assert.equal(val.semMexer, 2);
  assert.equal(val.demonstracao, false);
  assert.equal(A.montarValidacao(Object.assign({}, dados, { demonstracao: true })).demonstracao, true);

  // A confiabilidade (painel) consegue avaliar
  const C = require('../js/confiabilidade.js');
  const r = C.avaliar(p.respostas, val);
  assert.ok(['alta', 'media', 'baixa'].includes(r.nivel));
  assert.equal(A.montarPayload({ id: 'abc123-q', nome: 'Ana Lima', telefone: '11999998888', idade: 30 }, ordens).avaliacao, '');
});

test('deveMostrarDemo: só no primeiro grupo e até ser vista', () => {
  assert.equal(A.deveMostrarDemo({ etapa: 'teste', grupo: 0, demoVista: false }), true);
  assert.equal(A.deveMostrarDemo({ etapa: 'teste', grupo: 0 }), true, 'progresso antigo sem o campo');
  assert.equal(A.deveMostrarDemo({ etapa: 'teste', grupo: 0, demoVista: true }), false);
  assert.equal(A.deveMostrarDemo({ etapa: 'teste', grupo: 1, demoVista: false }), false);
  assert.equal(A.deveMostrarDemo({ etapa: 'identificacao', grupo: 0 }), false);
  assert.equal(A.deveMostrarDemo(null), false);
});

test('normalizarFormulario: padrão, modos válidos, perguntas (texto, id, sensível, máximo 5)', () => {
  const padrao = { campos: { idade: 'obrigatorio', funcao: 'opcional', empresa: 'opcional', email: 'oculto', cidade: 'oculto' }, perguntas: [] };
  assert.deepEqual(A.normalizarFormulario(undefined), padrao);
  assert.deepEqual(A.normalizarFormulario('lixo'), padrao);
  assert.deepEqual(A.normalizarFormulario({ campos: { idade: 'talvez', email: 'obrigatorio' } }).campos,
    Object.assign({}, padrao.campos, { email: 'obrigatorio' }));
  const f = A.normalizarFormulario({ perguntas: [
    { id: 'p1', texto: '  Qual sua   pretensão salarial? ', obrigatoria: true },
    { id: 'p1', texto: 'Como soube da vaga?' },               // id repetido -> gera outro
    { id: 'X Y', texto: 'Tem disponibilidade aos sábados?', obrigatoria: 'sim' },
    { texto: 'Oi' },                                            // curto demais
    { texto: 'Qual seu estado civil?' },                        // sensível
    { texto: 'Você tem filhos?' },                              // sensível
    { texto: 'Pergunta quatro?' }, { texto: 'Pergunta cinco?' }, { texto: 'Pergunta seis?' }
  ] });
  assert.equal(f.perguntas.length, 5);
  assert.deepEqual(f.perguntas[0], { id: 'p1', texto: 'Qual sua pretensão salarial?', obrigatoria: true });
  assert.equal(f.perguntas[1].id, 'p2');
  assert.equal(f.perguntas[2].obrigatoria, false);
  assert.ok(/^[a-z0-9_]{1,20}$/.test(f.perguntas[2].id));
  assert.equal(new Set(f.perguntas.map((p) => p.id)).size, 5);
  assert.ok(!f.perguntas.some((p) => /civil|filhos/.test(p.texto)));
  // Equipe: empresa opcional some; obrigatória continua
  assert.equal(A.formularioEfetivo(undefined, 'equipe').campos.empresa, 'oculto');
  assert.equal(A.formularioEfetivo({ campos: { empresa: 'obrigatorio' } }, 'equipe').campos.empresa, 'obrigatorio');
  assert.equal(A.formularioEfetivo(undefined, 'selecao').campos.empresa, 'opcional');
});

test('validarCamposFormulario e camposDoPayload seguem o formulário', () => {
  const form = { campos: { idade: 'opcional', funcao: 'oculto', empresa: 'obrigatorio', email: 'obrigatorio', cidade: 'opcional' },
    perguntas: [{ id: 'p1', texto: 'Qual sua pretensão?', obrigatoria: true }, { id: 'p2', texto: 'Algo mais?', obrigatoria: false }] };
  assert.deepEqual(A.validarCamposFormulario({}, form), {
    empresa: 'Informe a empresa atual ou última.', email: 'Informe o e-mail.', 'extra-p1': 'Responda esta pergunta.'
  });
  const erros = A.validarCamposFormulario({ idade: '12', empresa: 'X', email: 'a@b', extras: { p1: '   ' } }, form);
  assert.equal(erros.idade, 'Confira a idade: precisa ser entre 14 e 99 anos.');
  assert.equal(erros.email, 'Confira o e-mail, ex.: nome@exemplo.com.');
  assert.equal(erros['extra-p1'], 'Responda esta pergunta.');
  assert.deepEqual(A.validarCamposFormulario({ empresa: 'Loja', email: 'ana@loja.com.br', extras: { p1: 'R$ 2 mil' } }, form), {});
  // Padrão: idade obrigatória (como antes)
  assert.equal(A.validarCamposFormulario({}, undefined).idade, 'Informe sua idade (só números).');

  const c = A.camposDoPayload({ idade: '', funcao: 'Caixa', empresa: '  Loja  Azul ', email: ' ana@loja.com.br ', cidade: 'Campinas',
    extras: { p1: '  R$ 2 mil ', p2: '', p9: 'não existe' } }, form);
  assert.deepEqual(c, { idade: null, funcao: '', empresa: 'Loja Azul', email: 'ana@loja.com.br', cidade: 'Campinas',
    extras: [{ id: 'p1', pergunta: 'Qual sua pretensão?', resposta: 'R$ 2 mil' }] });
  assert.equal(A.limparResposta('x'.repeat(600)).length, 500);
  // Ocultos não vão, mesmo com valor salvo
  const oculto = A.camposDoPayload({ idade: '30', email: 'a@b.com', cidade: 'X' }, { campos: { idade: 'oculto' } });
  assert.equal(oculto.idade, null);
  assert.equal(oculto.email, '');
  assert.equal(oculto.cidade, '');

  const sel = [];
  for (let i = 0; i < 25; i++) sel.push(['C', 'S', 'I', 'D']);
  const p = A.montarPayload({ id: 'abc123-z', nome: 'Ana Souza', telefone: '11999998888', email: 'ana@loja.com.br', empresa: 'Loja',
    extras: { p1: 'Sim' }, consentimento: true }, sel, null, form);
  assert.equal(p.idade, null);
  assert.equal(p.email, 'ana@loja.com.br');
  assert.deepEqual(p.extras, [{ id: 'p1', pergunta: 'Qual sua pretensão?', resposta: 'Sim' }]);
  const padrao = A.montarPayload({ id: 'abc123-w', nome: 'Ana Souza', telefone: '11999998888', idade: '30', email: 'x@y.com', consentimento: true }, sel);
  assert.equal(padrao.idade, 30);
  assert.equal(padrao.email, '', 'e-mail oculto no padrão');
  assert.deepEqual(padrao.extras, []);
});

test('etapaRetomada: sem revisão; progresso antigo cai num destino válido', () => {
  const ordens = Array.from({ length: 25 }, () => ['D', 'I', 'S', 'C']);
  const todos = Array.from({ length: 25 }, () => true);
  const perm = ordens;
  assert.deepEqual(A.etapaRetomada({ etapa: 'revisao', ordens, respondidos: todos, permutacoes: perm, grupo: 24 }, 25, true),
    { etapa: 'confirmacao', grupo: 24, confTela: 1 });
  assert.deepEqual(A.etapaRetomada({ etapa: 'revisao', ordens, respondidos: todos, grupo: 3 }, 25, false),
    { etapa: 'teste', grupo: 24, confTela: 1 });
  const faltando = todos.slice(); faltando[7] = false;
  assert.equal(A.etapaRetomada({ etapa: 'enviando', ordens, respondidos: faltando }, 25, true).grupo, 7);
  assert.equal(A.etapaRetomada({ etapa: 'revisao', ordens, respondidos: faltando }, 25, true).etapa, 'teste');
  assert.equal(A.etapaRetomada({ etapa: 'concluido' }, 25, true).etapa, 'identificacao');
  assert.equal(A.etapaRetomada({ etapa: 'teste', grupo: 4 }, 25, true).etapa, 'identificacao', 'sem permutações');
  assert.deepEqual(A.etapaRetomada({ etapa: 'teste', grupo: 4, permutacoes: perm }, 25, true), { etapa: 'teste', grupo: 4, confTela: 1 });
  assert.equal(A.etapaRetomada({ etapa: 'confirmacao', confTela: 2, ordens, respondidos: todos }, 25, true).confTela, 2);
  // Modo demonstração: só os N primeiros contam
  assert.equal(A.etapaRetomada({ etapa: 'revisao', ordens, respondidos: faltando }, 3, true).etapa, 'confirmacao');
});
