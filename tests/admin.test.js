'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const AD = require('../js/admin.js');
const C = require('../js/codec.js');
const L = require('../js/lideranca.js');
const { payloadValido } = require('./helpers/fixtures.js');

test('recalcular ignora o resultado enviado e marca inválidos', () => {
  const r = AD.recalcular(payloadValido({ resultado: { codigo: 'CS' }, status: 'xyz' }));
  assert.equal(r.calc.codigo, 'DI');
  assert.equal(r.invalido, false);
  assert.equal(r.status, 'em_analise');
  const ruim = AD.recalcular(payloadValido({ respostas: '1111'.repeat(25) }));
  assert.equal(ruim.invalido, true);
  assert.equal(ruim.calc, null);
});

test('formatarTelefone e linkWhatsApp', () => {
  assert.equal(AD.formatarTelefone('5511999998888'), '(11) 99999-8888');
  assert.equal(AD.formatarTelefone('551133334444'), '(11) 3333-4444');
  assert.equal(AD.linkWhatsApp('5511999998888'), 'https://wa.me/5511999998888');
  assert.equal(AD.linkWhatsApp('11999998888'), 'https://wa.me/5511999998888');
  assert.equal(AD.linkWhatsApp(''), '');
});

test('extrairCodigos encontra códigos no meio de uma mensagem', () => {
  const a = C.encode(payloadValido({ id: 'aaaaaa1' }));
  const b = C.encode(payloadValido({ id: 'bbbbbb2' }));
  const msg = 'Olá! Concluí o teste DISC.\nNome: João\n\nCódigo de resultado:\n' + a + '\noutro: ' + b;
  assert.deepEqual(AD.extrairCodigos(msg), [a, b]);
});

test('gerarCsv: BOM, separador ; e proteção contra fórmula', () => {
  const regs = [AD.recalcular(payloadValido({ nome: '=cmd Silva', observacoes: 'linha 1\nlinha "2"' }))];
  const csv = AD.gerarCsv(regs);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  const linhas = csv.slice(1).split('\r\n');
  assert.ok(linhas[0].split(';').length >= 10);
  assert.ok(linhas[1].indexOf("'=cmd Silva") !== -1);
  assert.ok(csv.indexOf('"linha 1\nlinha ""2"""') !== -1);
  assert.ok(linhas[1].indexOf('40') !== -1);
});

test('resumoEquipe', () => {
  const r = AD.resumoEquipe([AD.recalcular(payloadValido()), AD.recalcular(payloadValido({ respostas: '1234'.repeat(25) }))]);
  assert.equal(r.total, 2);
  assert.equal(r.primarios.D, 1);
  assert.equal(r.primarios.C, 1);
  assert.equal(r.media.D, 25);
});

test('guiaComoTexto', () => {
  const reg = AD.recalcular(payloadValido());
  const txt = AD.guiaComoTexto(L.gerarGuia(reg.calc, reg.nome), reg);
  assert.ok(txt.indexOf('João da Silva') !== -1);
  assert.ok(txt.indexOf('DI') !== -1);
  assert.ok(txt.indexOf('•') !== -1);
});

test('validarImportado exige consentimento e as mesmas regras do backend', () => {
  assert.equal(AD.validarImportado(payloadValido()), '');
  assert.match(AD.validarImportado(payloadValido({ consentimento: false })), /consentimento/);
  assert.match(AD.validarImportado(payloadValido({ consentimento: 'true' })), /consentimento/);
  assert.match(AD.validarImportado(payloadValido({ nome: 'Joãozinho' })), /nome/);
  assert.match(AD.validarImportado(payloadValido({ telefone: '1234' })), /telefone/);
  assert.equal(AD.validarImportado(payloadValido({ nome: 'Ωμέγα Αλφα' })), '');
  assert.match(AD.validarImportado({ id: 'x' }), /incompletos/);
});

test('cores do gráfico batem com os tokens de notus.css', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const css = fs.readFileSync(path.join(__dirname, '..', 'assets', 'notus.css'), 'utf8');
  const token = (nome) => {
    const m = css.match(new RegExp('--' + nome + ':\\s*(#[0-9a-fA-F]{6})'));
    assert.ok(m, 'token --' + nome + ' não encontrado');
    return m[1].toLowerCase();
  };
  assert.equal(AD.CORES.D, token('tinta'));
  assert.equal(AD.CORES.I, token('ambar'));
  assert.equal(AD.CORES.S, token('ardosia-clara'));
  assert.equal(AD.CORES.C, token('ardosia'));
  assert.equal(AD.CORES.trilho, token('trilho'));
  assert.equal(AD.CORES.suave, token('suave'));
});

test('painel não usa a identidade antiga (amarelo/preto, hachuras) nem cor/tamanho solto', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const ler = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const fontes = ler('admin.html') + ler('assets/admin.css') + ler('js/admin.js');
  assert.doesNotMatch(fontes, /botao--preto|botao--amarelo|caixa--preta|caixa--amarela|caixa--gradiente|hachura|selo--amarelo|selo--preto|class="marca|#ffda00|#131313/i);
  const css = ler('assets/admin.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const semRoot = css.replace(/:root\s*\{[^}]*\}/, '');
  assert.doesNotMatch(semRoot, /#[0-9a-fA-F]{3,8}\b/, 'cor solta fora do :root');
  assert.doesNotMatch(css, /font-size:\s*\d/, 'tamanho de fonte fora da escala --t-*');
  assert.doesNotMatch(css, /font-weight:\s*(?!400|600|700)\d/, 'peso fora de 400/600/700');
});

test('protocolo: normaliza, mostra "—" quando não há e recalcular preserva', () => {
  assert.equal(AD.normalizarProtocolo(' 47k '), '47K');
  assert.equal(AD.normalizarProtocolo('4 7 K'), '47K');
  assert.equal(AD.normalizarProtocolo('47I'), '');
  assert.equal(AD.normalizarProtocolo(undefined), '');
  assert.equal(AD.textoProtocolo('47K'), '47K');
  assert.equal(AD.textoProtocolo(''), '—');
  assert.equal(AD.recalcular(payloadValido({ protocolo: '12a' })).protocolo, '12A');
  assert.equal(AD.recalcular(payloadValido()).protocolo, '', 'importado por código longo não tem protocolo');
});

test('busca encontra por protocolo (ignorando maiúsculas e espaços), nome, vaga e telefone', () => {
  const r = AD.recalcular(payloadValido({ protocolo: '47K', telefone: '5511988887777', vaga: 'Supervisora' }));
  const sem = AD.recalcular(payloadValido());
  ['47K', '47k', '47 k', ' 4 7 K ', '47', 'joão', 'SILVA', 'super', '98888', '(11) 98888'].forEach((b) => {
    assert.equal(AD.correspondeBusca(r, b), true, b);
  });
  ['48K', '47L', '7K', 'maria', '4'].forEach((b) => assert.equal(AD.correspondeBusca(r, b), false, b));
  assert.equal(AD.correspondeBusca(sem, '47K'), false);
  assert.equal(AD.correspondeBusca(sem, ''), true);
});

test('CSV ganha a coluna protocolo ("—" para quem não tem)', () => {
  const csv = AD.gerarCsv([AD.recalcular(payloadValido({ id: 'com-cod-1', protocolo: '47K' })), AD.recalcular(payloadValido({ id: 'sem-cod-2' }))]);
  const linhas = csv.slice(1).split('\r\n').map((l) => l.split(';'));
  const i = linhas[0].indexOf('protocolo');
  assert.ok(i > 0, 'coluna protocolo no cabeçalho');
  assert.equal(linhas[1][i], '47K');
  assert.equal(linhas[2][i], '—');
});

test('guia copiado leva o código do candidato quando existe', () => {
  const reg = AD.recalcular(payloadValido({ protocolo: '47K' }));
  assert.ok(AD.guiaComoTexto(L.gerarGuia(reg.calc, reg.nome), reg).indexOf('Código 47K') !== -1);
});

test('admin.html carrega js/api-simulada.js logo depois de js/api.js', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(scripts[scripts.indexOf('js/api.js') + 1], 'js/api-simulada.js');
  assert.match(html, /id="dica-previa"[^>]*hidden/);
});

test('validarImportado aceita códigos novos (com idade/função/empresa) e antigos (sem esses campos)', () => {
  assert.equal(AD.validarImportado(payloadValido({ idade: 30, funcao: 'Vendedor', empresa: 'Loja X' })), '');
  const antigo = payloadValido();
  delete antigo.idade; delete antigo.funcao; delete antigo.empresa;
  assert.equal(AD.validarImportado(antigo), '');
  assert.match(AD.validarImportado(payloadValido({ idade: 120 })), /idade/);
  assert.match(AD.validarImportado(payloadValido({ idade: 'abc' })), /idade/);
});

test('textoIdade e textoExperiencia ("—" e "" quando não há)', () => {
  assert.equal(AD.textoIdade(30), '30 anos');
  assert.equal(AD.textoIdade(undefined), '—');
  assert.equal(AD.textoIdade(null), '—');
  assert.equal(AD.textoIdade(''), '—');
  assert.equal(AD.textoExperiencia({ funcao: 'Recepcionista', empresa: 'Loja Centro' }), 'Recepcionista · Loja Centro');
  assert.equal(AD.textoExperiencia({ funcao: '', empresa: 'Loja Centro' }), 'Loja Centro');
  assert.equal(AD.textoExperiencia({ funcao: 'Vendedor' }), 'Vendedor');
  assert.equal(AD.textoExperiencia({}), '');
});

test('CSV ganha idade, funcao e empresa (vazios para registros antigos)', () => {
  const antigo = payloadValido({ id: 'antigo-0001' });
  delete antigo.idade; delete antigo.funcao; delete antigo.empresa;
  const csv = AD.gerarCsv([AD.recalcular(payloadValido({ id: 'novo-0001', idade: 30, funcao: 'Vendedor', empresa: '=Loja' })), AD.recalcular(antigo)]);
  const linhas = csv.slice(1).split('\r\n').map((l) => l.split(';'));
  const [ii, fi, ei] = ['idade', 'funcao', 'empresa'].map((c) => linhas[0].indexOf(c));
  assert.ok(ii > 0 && fi > 0 && ei > 0, 'colunas no cabeçalho');
  assert.equal(linhas[1][ii], '30');
  assert.equal(linhas[1][fi], 'Vendedor');
  assert.equal(linhas[1][ei], "'=Loja", 'protegido contra fórmula');
  assert.deepEqual([linhas[2][ii], linhas[2][fi], linhas[2][ei]], ['', '', '']);
});

test('busca encontra por função e empresa, mas não pela idade', () => {
  const r = AD.recalcular(payloadValido({ idade: 47, funcao: 'Recepcionista', empresa: 'Clínica Boa Vista' }));
  assert.equal(AD.correspondeBusca(r, 'recepcion'), true);
  assert.equal(AD.correspondeBusca(r, 'boa vista'), true);
  assert.equal(AD.correspondeBusca(r, '47'), false, 'idade não é critério de busca');
  assert.equal(AD.correspondeBusca(r, '47 anos'), false);
});

test('idade só no detalhe: o card da lista, os resumos e os filtros não usam r.idade', () => {
  const fonte = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'js', 'admin.js'), 'utf8');
  const corpo = (nome) => {
    const i = fonte.indexOf('function ' + nome + '(');
    assert.ok(i !== -1, nome);
    const prox = fonte.indexOf('\n  function ', i + 10);
    return fonte.slice(i, prox === -1 ? undefined : prox);
  };
  ['renderizarLista', 'renderizarResumo', 'filtrados', 'correspondeBusca', 'textoExperiencia'].forEach((f) => {
    assert.ok(!/\.idade\b|textoIdade/.test(corpo(f)), f + ' não deve usar a idade');
  });
  assert.ok(/textoIdade\(ficha\.idade\)/.test(corpo('renderizarDetalhe')), 'detalhe mostra a idade (da ficha da pessoa)');
});

/* ---------- Logins, papéis, avaliações e confiabilidade ---------- */

// Validação coerente com o perfil D > I > S > C das respostas '4321' x25 (payloadValido).
function validacaoDI(extra) {
  return Object.assign({
    versao: 1,
    pares: [['D', 'C'], ['I', 'S'], ['D', 'S']],
    escolhas: ['D', 'I', 'D'],
    itens: [
      { id: 'D-f1', letra: 'D', tipo: 'forca', nota: 5 },
      { id: 'D-s1', letra: 'D', tipo: 'sombra', nota: 4 },
      { id: 'I-f2', letra: 'I', tipo: 'forca', nota: 4 },
      { id: 'C-f3', letra: 'C', tipo: 'contraste', nota: 2 }
    ],
    gruposSeg: Array(25).fill(8),
    semMexer: 0,
    demonstracao: false
  }, extra || {});
}

test('recalcular calcula a confiabilidade (objeto ou texto JSON) e o selo do card segue o nível', () => {
  const alta = AD.recalcular(payloadValido({ validacao: validacaoDI() }));
  assert.equal(alta.conf.nivel, 'alta');
  assert.deepEqual(AD.seloConfiabilidade(alta.conf), { texto: 'Confiabilidade alta', classe: 'selo--verde', nivel: 'alta' });

  const comoTexto = AD.recalcular(payloadValido({ validacao: JSON.stringify(validacaoDI()) }));
  assert.equal(comoTexto.conf.nivel, 'alta', 'código importado guarda a validação como texto');

  const baixa = AD.recalcular(payloadValido({ validacao: validacaoDI({ escolhas: ['C', 'S', 'S'], gruposSeg: Array(25).fill(1.2) }) }));
  assert.equal(baixa.conf.nivel, 'baixa');
  assert.equal(AD.seloConfiabilidade(baixa.conf).classe, 'selo--vermelho');
  assert.equal(AD.seloConfiabilidade(baixa.conf).texto, 'Confiabilidade baixa');

  const media = AD.seloConfiabilidade({ nivel: 'media' });
  assert.equal(media.classe, '');
  assert.equal(media.texto, 'Confiabilidade média');

  const antigo = AD.recalcular(payloadValido());
  assert.equal(antigo.conf.nivel, 'indisponivel');
  assert.equal(AD.seloConfiabilidade(antigo.conf), null, 'sem dados = sem selo');
  assert.equal(AD.seloConfiabilidade(null), null);
});

test('abas e permissões: só o administrador usa o painel (gestor desativado nesta versão)', () => {
  assert.deepEqual(AD.abasDoPapel('admin', true), ['lista', 'processos', 'empresas', 'relatorios', 'usuarios', 'comparativo', 'importar']);
  assert.deepEqual(AD.abasDoPapel('admin', true, true), ['lista', 'processos', 'empresas', 'relatorios', 'vendas', 'usuarios', 'comparativo', 'importar'], 'Vendas depois de Relatórios');
  assert.deepEqual(AD.abasDoPapel('', false, true), ['lista', 'comparativo', 'importar'], 'sem servidor não há Vendas');
  assert.deepEqual(AD.abasDoPapel('gestor', true), [], 'gestor não vê nada');
  assert.deepEqual(AD.abasDoPapel('', true), []);
  assert.deepEqual(AD.abasDoPapel('', false), ['lista', 'comparativo', 'importar'], 'modo local, sem login');
  assert.deepEqual(AD.abasDoPapel('admin', true, true, true).slice(-1), ['conexoes'], 'Conexões é a última');
  assert.ok(!AD.abasDoPapel('', false, true, true).includes('conexoes'), 'sem servidor não há Conexões');
  assert.deepEqual(AD.abasDoPapel('gestor', true, true, true), []);
  const g = AD.permissoes('gestor', true);
  assert.equal(g.excluir, false);
  assert.equal(g.criar, false);
  assert.equal(g.importar, false);
  assert.equal(g.statusObservacoes, false);
  const a = AD.permissoes('admin', true);
  assert.ok(a.excluir && a.criar && a.importar && a.statusObservacoes);
  assert.equal(AD.permissoes('', false).excluir, true, 'modo local continua podendo excluir');
  assert.match(AD.MSG_SO_ADMIN, /só para administradores/);
});

test('gerarSenhaTemporaria: 10 caracteres fáceis de ditar', () => {
  const { prng } = require('./helpers/fixtures.js');
  const rnd = prng(7);
  for (let i = 0; i < 50; i++) {
    const s = AD.gerarSenhaTemporaria(rnd);
    assert.match(s, /^[a-hjkmnp-z2-9]{10}$/);
  }
  assert.match(AD.gerarSenhaTemporaria(), /^[a-hjkmnp-z2-9]{10}$/, 'sem rnd usa crypto');
  assert.notEqual(AD.gerarSenhaTemporaria(), AD.gerarSenhaTemporaria());
});

test('link e mensagem do processo (empresa em texto ou empresaNome antigo)', () => {
  assert.equal(AD.linkAvaliacao('https://site.com/disc/admin.html?x=1#topo', 'SEL1'), 'https://site.com/disc/index.html?a=SEL1');
  assert.equal(AD.linkAvaliacao('http://localhost:4173/admin.html', 'K7QZ'), 'http://localhost:4173/index.html?a=K7QZ');
  const link = 'https://site.com/index.html?a=SEL1';
  const sel = AD.mensagemConvite({ nome: 'Recepcionista 2026', empresaNome: 'Clínica Exemplo', tipo: 'selecao' }, link);
  assert.match(sel, /processo seletivo de Recepcionista 2026 da Clínica Exemplo/);
  assert.ok(sel.indexOf(link) !== -1);
  const eqp = AD.mensagemConvite({ nome: 'Equipe comercial', empresaNome: 'Clínica Exemplo', tipo: 'equipe' }, link);
  assert.match(eqp, /A Clínica Exemplo está fazendo uma avaliação de perfil da equipe \(Equipe comercial\)/);
  assert.ok(eqp.indexOf(link) !== -1);
});

test('mensagem de convite usa a vaga e a empresa (texto) do processo', () => {
  const link = 'https://site.com/index.html?a=AB23';
  const m = AD.mensagemConvite({ nome: 'Escrevente 2026', vaga: 'Escrevente de atendimento', empresa: 'Cartório Exemplo', tipo: 'selecao' }, link);
  assert.match(m, /processo seletivo de Escrevente de atendimento da Cartório Exemplo/);
  assert.ok(m.indexOf(link) !== -1);
});

test('link e mensagem do relatório para o contratante', () => {
  assert.equal(AD.linkRelatorio('https://site.com/disc/admin.html?x=1#y', 'abc123TOKEN'), 'https://site.com/disc/relatorio.html?r=abc123TOKEN');
  assert.equal(AD.urlAbsoluta('relatorio.html?r=T1', 'https://site.com/disc/admin.html'), 'https://site.com/disc/relatorio.html?r=T1');
  assert.equal(AD.urlAbsoluta('https://outro.com/relatorio.html?r=T1', 'https://site.com/admin.html'), 'https://outro.com/relatorio.html?r=T1');
  const msg = AD.mensagemRelatorio({ contratante: 'Marina Souza', vaga: 'Escrevente', empresa: 'Cartório Exemplo', consultor: 'Paulo Lima' }, 'https://x/relatorio.html?r=T');
  assert.match(msg, /^Olá, Marina! O relatório do processo seletivo de Escrevente \(Cartório Exemplo\) está pronto:/);
  assert.match(msg, /https:\/\/x\/relatorio\.html\?r=T/);
  assert.match(msg, /Paulo Lima · Gestão sem Caos$/);
  assert.doesNotMatch(AD.mensagemRelatorio({}, 'u'), /undefined/);
});

test('perfil ideal: 1 ou 2 letras D/I/S/C, toque alterna e explica em pt-BR', () => {
  assert.equal(AD.normalizarPerfilIdeal('cd'), 'CD');
  assert.equal(AD.normalizarPerfilIdeal('C x D s'), 'CD');
  assert.equal(AD.normalizarPerfilIdeal('CC'), 'C');
  assert.equal(AD.alternarLetraPerfil('', 'C'), 'C');
  assert.equal(AD.alternarLetraPerfil('C', 'D'), 'CD');
  assert.equal(AD.alternarLetraPerfil('CD', 'I'), 'CI', 'com 2 letras troca a segunda');
  assert.equal(AD.alternarLetraPerfil('CD', 'C'), 'D', 'tocar de novo tira a letra');
  assert.equal(AD.alternarLetraPerfil('CD', 'X'), 'CD');
  assert.equal(AD.explicarPerfil('CD'), 'C (Conformidade) como traço principal e D (Dominância) como segundo traço.');
  assert.match(AD.explicarPerfil(''), /Escolha 1 ou 2 letras/);
});

test('campo sensível do ClickUp é recusado (antecedentes só com permissão)', () => {
  ['Sexo', 'Gênero', 'Estado civil', 'Tem filhos?', 'Religião', 'Grávida', 'Raça / cor da pele', 'Orientação sexual', 'Deficiência', 'Doença crônica', 'Saúde', 'Antecedentes criminais', 'Possui processo em seu nome?']
    .forEach((n) => assert.equal(AD.campoSensivel(n), true, n));
  ['Nota Revisão', 'Graduação na área', 'Pretensão salarial', ''].forEach((n) => assert.equal(AD.campoSensivel(n), false, n));
  assert.equal(AD.campoSensivel('Antecedentes', { permitirAntecedentes: true }), false);
  assert.equal(AD.campoSensivel('Estado civil', { permitirAntecedentes: true }), true);
});

test('pesos normalizados, ids simples e ID da lista do ClickUp', () => {
  assert.deepEqual(AD.pesosNormalizados([{ peso: 30 }, { peso: 15 }, { peso: 5 }]), [60, 30, 10]);
  assert.deepEqual(AD.pesosNormalizados([{ peso: 1 }, { peso: 2 }]), [33.3, 66.7]);
  assert.deepEqual(AD.pesosNormalizados([{ peso: 0 }, { peso: 'x' }]), [0, 0]);
  const usados = {};
  assert.equal(AD.idSimples('Revisão documental', usados), 'revisao_documental');
  assert.equal(AD.idSimples('Revisão documental', usados), 'revisao_documental_2');
  assert.equal(AD.idSimples('', usados, 'etapa'), 'etapa');
  assert.equal(AD.idListaDoTexto('https://app.clickup.com/9012/v/li/901234567890'), '901234567890');
  assert.equal(AD.idListaDoTexto(' 901234567890 '), '901234567890');
});

test('validarConfig: mensagens claras antes de mandar ao servidor', () => {
  const ok = { perfilIdeal: 'CD', etapas: [{ nome: 'Revisão', peso: 30, campo: 'Nota Revisão' }], bonus: [{ nome: 'Graduação', campo: 'Graduação na área', regra: { tipo: 'checkbox', pontos: 10 } }], corte: 70, faixaAvaliar: 55 };
  assert.equal(AD.validarConfig(ok), '');
  assert.equal(AD.validarConfig(Object.assign({}, ok, { perfilIdeal: 'CC' })), 'Perfil ideal inválido: use 1 ou 2 letras entre D, I, S e C.');
  assert.equal(AD.validarConfig(Object.assign({}, ok, { faixaAvaliar: 80 })), 'A faixa "avaliar" precisa ser menor ou igual à nota de corte.');
  assert.equal(AD.validarConfig(Object.assign({}, ok, { etapas: [{ nome: '', peso: 1 }] })), 'Dê um nome para a etapa 1.');
  assert.equal(AD.validarConfig(Object.assign({}, ok, { etapas: [{ nome: 'X', peso: 1, campo: 'Estado civil' }] })), 'O campo "Estado civil" é um dado sensível e não pode ser usado.');
  assert.equal(AD.validarConfig(Object.assign({}, ok, { bonus: [{ nome: 'Presencial', campo: 'Perfil', regra: { tipo: 'mapa', pontos: {} } }] })), 'Informe ao menos um valor com pontos no bônus "Presencial".');
  assert.equal(AD.validarConfig(Object.assign({}, ok, { corte: null })), 'Informe a nota de corte.');
  assert.equal(AD.validarConfig(AD.configPadrao()), '', 'config vazia de processo novo é válida');
});

test('editor: textos editáveis na ordem do documento e edição marca origem "editado"', () => {
  const M = require('../js/relatorio-motor.js');
  const rel = M.montar(JSON.parse(JSON.stringify(require('./fixtures/processo-exemplo.json'))));
  const lista = AD.textosEditaveis(rel);
  assert.equal(lista.length, Object.keys(rel.textos).length, 'todos os textos aparecem uma vez');
  assert.equal(new Set(lista.map((t) => t.id)).size, lista.length);
  assert.equal(lista[0].id, rel.sumario.recomendacao.textoId);
  assert.equal(lista[0].secao, 'Sumário executivo');
  const secoes = [...new Set(lista.map((t) => t.secao))];
  assert.deepEqual(secoes.slice(0, 5), ['Sumário executivo', 'Painel de atração', 'Avaliação técnica', 'Análise DISC', 'Ranking final']);
  const passo = lista.find((t) => t.rotulo === 'Próximo passo 1');
  assert.ok(passo && passo.secao === 'Encerramento');
  assert.equal(AD.editarTexto(rel, 'recomendacao', rel.textos.recomendacao.texto), false, 'sem mudança não marca');
  assert.equal(AD.editarTexto(rel, 'recomendacao', 'Texto novo.'), true);
  assert.deepEqual(rel.textos.recomendacao, { texto: 'Texto novo.', origem: 'editado' });
  assert.equal(AD.editarTexto(rel, 'nao-existe', 'x'), false, 'não cria texto novo');
  assert.deepEqual(AD.textosEditaveis(null), []);
});

test('textoOrigem: avaliação e empresa no card; "Link geral" sem código', () => {
  assert.equal(AD.textoOrigem({ avaliacaoNome: 'Recepcionista 2026', empresaNome: 'Clínica Exemplo', avaliacao: 'SEL1' }), 'Recepcionista 2026 · Clínica Exemplo');
  assert.equal(AD.textoOrigem({ avaliacao: 'ABCD' }), 'Avaliação ABCD');
  assert.equal(AD.textoOrigem({}), 'Link geral');
  const r = AD.recalcular(payloadValido({ avaliacaoNome: 'Equipe comercial', empresaNome: 'Clínica Exemplo' }));
  assert.equal(AD.correspondeBusca(r, 'comercial'), true, 'busca encontra pela avaliação');
  assert.equal(AD.correspondeBusca(r, 'clínica'), true);
});

test('resumoValidacao: retratos escolhidos e frases com nota, nomeando os perfis', () => {
  const reg = AD.recalcular(payloadValido({ validacao: validacaoDI({ escolhas: ['D', 'S', 'D'] }) }));
  const res = AD.resumoValidacao(reg.validacao, reg.calc);
  assert.equal(res.retratos.length, 3);
  assert.deepEqual(res.retratos.map((p) => [p.escolha, p.outra, p.acertou]), [['D', 'C', true], ['S', 'I', false], ['D', 'S', true]]);
  assert.equal(res.frases.length, 4);
  const forca = res.frases.find((f) => f.id === 'D-f1');
  assert.equal(forca.texto, require('../js/validacao.js').afirmacoes.D.forcas[0].texto);
  assert.equal(forca.notaTexto, 'Concordo totalmente (5/5)');
  assert.match(forca.rotulo, /traço principal — D Dominância/);
  assert.match(res.frases.find((f) => f.tipo === 'contraste').rotulo, /contraste/);
  assert.match(res.frases.find((f) => f.tipo === 'sombra').rotulo, /Excesso/);
  assert.match(res.frases.find((f) => f.id === 'I-f2').rotulo, /2º traço — I Influência/);
  assert.equal(AD.resumoValidacao(null, reg.calc), null);
  assert.equal(AD.resumoValidacao(validacaoDI(), null), null);
});

test('CSV ganha avaliação, empresa da avaliação e confiabilidade (antes de e-mail, cidade e extras)', () => {
  const csv = AD.gerarCsv([AD.recalcular(payloadValido({ avaliacao: 'SEL1', avaliacaoNome: 'Recepcionista 2026', empresaNome: 'Clínica Exemplo', validacao: validacaoDI() }))]);
  const linhas = csv.slice(1).split('\r\n').map((l) => l.split(';'));
  const fim = linhas[0].slice(-6, -3);
  assert.deepEqual(fim, ['avaliação', 'empresa da avaliação', 'confiabilidade']);
  assert.deepEqual(linhas[1].slice(-6, -3), ['Recepcionista 2026', 'Clínica Exemplo', 'Alta']);
});

test('guia copiado leva o aviso quando a confiabilidade é baixa', () => {
  const reg = AD.recalcular(payloadValido({ validacao: validacaoDI({ escolhas: ['C', 'S', 'S'] }) }));
  assert.equal(reg.conf.nivel, 'baixa');
  assert.ok(AD.guiaComoTexto(L.gerarGuia(reg.calc, reg.nome), reg).indexOf(AD.AVISO_GUIA_BAIXA) !== -1);
  assert.equal(AD.AVISO_GUIA_BAIXA, 'Atenção: a confiabilidade deste resultado é baixa. Use o guia com cautela e confirme em entrevista.');
});

test('admin.html: login por e-mail e senha, sem a tela de chave, carrega validacao/confiabilidade/relatorio-view antes do admin.js e tem a aba Empresas', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  const iAdmin = scripts.indexOf('js/admin.js');
  assert.ok(scripts.indexOf('js/validacao.js') !== -1 && scripts.indexOf('js/validacao.js') < iAdmin);
  assert.ok(scripts.indexOf('js/confiabilidade.js') !== -1 && scripts.indexOf('js/confiabilidade.js') < iAdmin);
  assert.ok(scripts.indexOf('js/scoring.js') < scripts.indexOf('js/confiabilidade.js'));
  assert.match(html, /id="campo-email"/);
  assert.match(html, /id="campo-senha"/);
  assert.match(html, /id="form-primeiro"/);
  assert.doesNotMatch(html, /campo-chave/);
  assert.ok(scripts.indexOf('js/relatorio-view.js') !== -1 && scripts.indexOf('js/relatorio-view.js') < iAdmin);
  assert.match(html, /Prévia: <span class="negrito">admin@previa\.com<\/span>, senha <span class="negrito">previa123<\/span>/);
  assert.doesNotMatch(html, /gestor@previa/);
  assert.match(html, /data-aba="processos"[^]*?<span class="aba__texto">Processos</);
  assert.doesNotMatch(html, /data-aba="avaliacoes"/);
  assert.match(html, /data-aba="empresas"[^]*?<span class="aba__texto">Empresas</);
  assert.match(html, /id="vista-empresas"/);
  assert.match(html, /id="vista-processos"/);
});

test('Supabase: modo ligado por BACKEND ou por DISC_API.MODO', () => {
  assert.equal(AD.modoSupabase({ BACKEND: 'supabase' }, null), true);
  assert.equal(AD.modoSupabase({ BACKEND: ' Supabase ' }, null), true);
  assert.equal(AD.modoSupabase({ BACKEND: 'appsscript' }, { MODO: 'supabase' }), true);
  assert.equal(AD.modoSupabase({ BACKEND: 'appsscript' }, {}), false);
  assert.equal(AD.modoSupabase({}, { backend: 'supabase' }), true);
  assert.equal(AD.modoSupabase({ API_URL: 'simulada' }, { MODO: 'simulada' }), false);
  assert.equal(AD.modoSupabase(null, null), false);
});

test('Supabase: volta do e-mail (redefinição, convite e link vencido)', () => {
  assert.deepEqual(AD.lerRetornoAuth('#access_token=abc&expires_in=3600&refresh_token=x&token_type=bearer&type=recovery', ''), { tipo: 'recovery', erro: '' });
  assert.deepEqual(AD.lerRetornoAuth('#access_token=abc&type=invite', ''), { tipo: 'invite', erro: '' });
  assert.deepEqual(AD.lerRetornoAuth('', '?type=recovery'), { tipo: 'recovery', erro: '' });
  assert.deepEqual(AD.lerRetornoAuth('#access_token=abc&type=signup', ''), { tipo: '', erro: '' });
  assert.deepEqual(AD.lerRetornoAuth('', ''), { tipo: '', erro: '' });
  assert.deepEqual(AD.lerRetornoAuth('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired', ''),
    { tipo: '', erro: AD.MSG_LINK_EXPIRADO });
  assert.match(AD.lerRetornoAuth('#error=server_error', '').erro, /Não foi possível usar o link/);
  assert.match(AD.MSG_LINK_EXPIRADO, /Esqueci minha senha/);
});

test('Supabase: endereço do painel para o link de redefinição não leva consulta nem âncora', () => {
  assert.equal(AD.enderecoPainel('https://disc.gestaosemcaos.com.br/admin.html?x=1#type=recovery'), 'https://disc.gestaosemcaos.com.br/admin.html');
  assert.equal(AD.enderecoPainel(''), '');
});

test('admin.html: carrega supabase-js e api-supabase depois das APIs e tem os fluxos de senha do Supabase', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  const i = (s) => scripts.indexOf(s);
  assert.ok(i('js/api.js') !== -1 && i('js/api.js') < i('js/api-simulada.js'));
  assert.ok(i('js/api-simulada.js') < i('assets/vendor/supabase.js'));
  assert.ok(i('assets/vendor/supabase.js') < i('js/api-supabase.js'));
  assert.ok(i('js/api-supabase.js') < i('js/admin.js'));
  assert.doesNotMatch(html, /<script[^>]+src="https?:/);
  for (const id of ['btn-esqueci', 'form-esqueci', 'es-email', 'ok-esqueci', 'erro-esqueci', 'form-nova-senha', 'ns-senha', 'ns-confirmar', 'erro-nova-senha', 'nota-primeiro-supabase', 'nota-esqueceu']) {
    assert.match(html, new RegExp('id="' + id + '"'), id);
  }
  assert.match(html, /id="btn-esqueci"[^>]*hidden/);
  assert.match(html, /id="form-nova-senha"[^>]*hidden/);
});

/* ---------- Formulário do processo e pessoas ---------- */

test('formulário do processo: padrão, normalização (ids p1..p5, até 5) e config nova', () => {
  assert.deepEqual(AD.formularioPadrao(), { campos: { idade: 'obrigatorio', funcao: 'opcional', empresa: 'opcional', email: 'oculto', cidade: 'oculto', foto: 'opcional' }, perguntas: [], parte2: 'desligada' });
  assert.deepEqual(AD.normalizarFormulario(null), AD.formularioPadrao());
  assert.deepEqual(AD.normalizarFormulario({ campos: { idade: 'xx', email: 'obrigatorio' } }).campos,
    { idade: 'obrigatorio', funcao: 'opcional', empresa: 'opcional', email: 'obrigatorio', cidade: 'oculto', foto: 'opcional' });
  const n = AD.normalizarFormulario({ perguntas: [
    { id: 'p2', texto: '  Pretensão   salarial? ', obrigatoria: true },
    { id: 'p2', texto: 'Disponibilidade de horário?' },
    { texto: '' }, { id: 'Ruim!', texto: 'Tem CNH?' }, { texto: 'Quatro?' }, { texto: 'Cinco?' }, { texto: 'Seis?' }
  ] });
  assert.equal(n.perguntas.length, 5);
  assert.deepEqual(n.perguntas.map((q) => q.id), ['p2', 'p1', 'p3', 'p4', 'p5']);
  assert.deepEqual(n.perguntas[0], { id: 'p2', texto: 'Pretensão salarial?', obrigatoria: true });
  assert.equal(n.perguntas[1].obrigatoria, false);
  assert.deepEqual(AD.configPadrao().formulario, AD.formularioPadrao());
  assert.equal(AD.validarConfig(AD.configPadrao()), '');
});

test('formulário: pergunta com dado sensível é recusada com a mensagem do contrato', () => {
  const base = AD.configPadrao();
  const com = (perguntas) => Object.assign({}, base, { formulario: { campos: base.formulario.campos, perguntas } });
  assert.equal(AD.validarConfig(com([{ texto: 'Qual sua pretensão salarial?', obrigatoria: false }])), '');
  assert.equal(AD.validarConfig(com([{ texto: 'Você tem filhos?' }])), 'A pergunta "Você tem filhos?" pede um dado sensível e não pode ser usada.');
  assert.equal(AD.validarConfig(com([{ texto: 'Qual seu estado civil?' }])), 'A pergunta "Qual seu estado civil?" pede um dado sensível e não pode ser usada.');
  assert.equal(AD.validarConfig(com([{ texto: 'Qual a sua religião?' }])), 'A pergunta "Qual a sua religião?" pede um dado sensível e não pode ser usada.');
  assert.equal(AD.validarConfig(com([{ texto: 'Tem algum problema de saúde?' }])), 'A pergunta "Tem algum problema de saúde?" pede um dado sensível e não pode ser usada.');
  // Começo de palavra (como classificar_campo): "embaraçado" não é "raça"
  assert.equal(AD.perguntaSensivel('Já ficou embaraçado no atendimento?'), false);
  assert.equal(AD.perguntaSensivel('Gênero (opcional)'), true);
  assert.equal(AD.validarConfig(com([{ texto: 'Oi' }])), 'Escreva a pergunta extra 1 (de 3 a 200 caracteres).');
  assert.equal(AD.validarConfig(com(Array.from({ length: 6 }, (_, i) => ({ texto: 'Pergunta ' + i })))), 'Use no máximo 5 perguntas extras.');
  assert.equal(AD.validarConfig(Object.assign({}, base, { formulario: { campos: { email: 'talvez' }, perguntas: [] } })),
    'Escolha se "E-mail" é obrigatória, opcional ou não perguntada.');
});

test('Parte 2: formulario.parte2 normalizado e validado; padrão ao criar segue o tipo', () => {
  assert.equal(AD.normalizarFormulario({ parte2: 'ligada' }).parte2, 'ligada');
  assert.equal(AD.normalizarFormulario({ parte2: 'talvez' }).parte2, 'desligada');
  assert.equal(AD.normalizarFormulario({}).parte2, 'desligada');
  const base = AD.configPadrao();
  assert.equal(AD.validarConfig(Object.assign({}, base, { formulario: { campos: base.formulario.campos, perguntas: [], parte2: 'ligada' } })), '');
  assert.equal(AD.validarConfig(Object.assign({}, base, { formulario: { campos: base.formulario.campos, perguntas: [], parte2: 'sim' } })),
    'Escolha se a segunda parte do teste fica ligada ou desligada.');
  assert.equal(AD.parte2Padrao('equipe'), 'ligada');
  assert.equal(AD.parte2Padrao('selecao'), 'desligada');
  assert.match(AD.textoParte2('ligada'), /10/);
});

test('Parte 2: exigido do registro, eixos, esforço e nome da combinação', () => {
  const EX = require('../js/disc-exigido.js');
  // 10 grupos: D mais alto (4 = mais parecido), depois C, S, I
  const exigido = '4123'.repeat(10);
  assert.equal(EX.validar(exigido), true);
  const reg = AD.recalcular(payloadValido({ exigido }));
  const ex = AD.exigidoDoRegistro(reg);
  assert.ok(ex && ex.percentuais.D > ex.percentuais.I);
  assert.equal(ex.codigo, EX.calcular(exigido).codigo);
  // Sem string válida: usa resultadoExigido; sem nada: null
  assert.deepEqual(AD.exigidoDoRegistro({ exigido: '', resultadoExigido: { percentuais: { D: 25, I: 25, S: 25, C: 25 }, codigo: 'DI' } }).percentuais, { D: 25, I: 25, S: 25, C: 25 });
  assert.equal(AD.exigidoDoRegistro({ exigido: '123' }), null);
  assert.equal(AD.exigidoDoRegistro(null), null);
  // Eixos: mesma convenção do DISC_EXIGIDO (+ acelerado, + tarefas)
  assert.deepEqual(AD.eixosDe({ D: 40, I: 30, S: 20, C: 10 }), EX.eixos({ D: 40, I: 30, S: 20, C: 10 }));
  assert.equal(AD.eixosDe({ D: 1 }), null);
  // Esforço: natural DI × exigido SC é alto; igual é baixo
  const nat = { D: 40, I: 30, S: 20, C: 10 };
  const a = AD.esforcoDe({ percentuais: nat }, { percentuais: { D: 10, I: 20, S: 30, C: 40 } });
  assert.ok(a.indice >= 30);
  assert.equal(a.faixa, 'muito_alta');
  assert.equal(AD.esforcoDe(nat, nat).faixa, 'baixa');
  assert.equal(AD.esforcoDe(nat, null), null);
  assert.equal(AD.rotuloEsforco('alta'), 'Esforço alto');
  assert.ok(AD.frasesEsforco(a).length >= 1);
  assert.deepEqual(AD.frasesEsforco(null), []);
  assert.equal(typeof AD.nomeCombinacao('DI'), 'string');
  assert.equal(AD.nomeCombinacao(''), '');
});

test('Parte 2 na empresa: pontos do mapa (natural e exigido) e esforço por colaborador em ordem', () => {
  const colabs = [
    { pessoaId: 'a', nome: 'Ana', cargo: 'Gerente', resultado: { percentuais: { D: 40, I: 30, S: 20, C: 10 }, codigo: 'DI' }, exigido: { percentuais: { D: 10, I: 20, S: 30, C: 40 }, codigo: 'CS' } },
    { pessoaId: 'b', nome: 'Bia', resultado: { percentuais: { D: 25, I: 25, S: 25, C: 25 }, codigo: 'DI' }, exigido: { percentuais: { D: 27, I: 25, S: 24, C: 24 }, codigo: 'DI' } },
    { pessoaId: 'c', nome: 'Caio', resultado: { percentuais: { D: 20, I: 20, S: 30, C: 30 }, codigo: 'SC' }, exigido: null },
    { pessoaId: 'd', nome: 'Duda', resultado: null }
  ];
  const pts = AD.pontosMapaEquipe(colabs);
  assert.deepEqual(pts.map((p) => p.id), ['a', 'b', 'c']);
  assert.ok(pts[0].exigido && typeof pts[0].natural.ritmo === 'number');
  assert.equal(pts[2].exigido, undefined);
  const esf = AD.esforcoEquipe(colabs);
  assert.deepEqual(esf.map((x) => x.pessoaId), ['a', 'b']);
  assert.ok(esf[0].indice > esf[1].indice);
  assert.equal(esf[0].cargo, 'Gerente');
});

test('fotos: fotoValida (só data URL JPEG até 40000), iniciais e foto da resposta ou da pessoa', () => {
  const ok = 'data:image/jpeg;base64,' + 'A'.repeat(100);
  assert.equal(AD.fotoValida(ok), true);
  assert.equal(AD.fotoValida('data:image/png;base64,AAAA'), false);
  assert.equal(AD.fotoValida('https://exemplo.com/a.jpg'), false);
  assert.equal(AD.fotoValida('data:image/jpeg;base64,' + 'A'.repeat(40000)), false);
  assert.equal(AD.fotoValida('data:image/jpeg;base64,AA"onerror=x'), false);
  assert.equal(AD.iniciais('Ana Maria Souza'), 'AS');
  assert.equal(AD.iniciais('bruno'), 'B');
  assert.equal(AD.iniciais(''), '?');
  assert.equal(AD.fotoDe({ foto: ok }), ok);
  assert.equal(AD.fotoDe({ foto: '', pessoa: { foto: ok } }), ok);
  assert.equal(AD.fotoDe({ foto: 'x' }), '');
  assert.equal(AD.normalizarFormulario({ campos: { foto: 'obrigatorio' } }).campos.foto, 'obrigatorio');
  assert.equal(AD.resumoFormulario(null).find((x) => x.rotulo === 'Foto').texto, 'Opcional');
});

test('organograma: líder, liderados e descendentes (o arrastar agora é do js/organograma.js)', () => {
  const rels = [
    { de: 'a', para: 'b', tipo: 'lidera' },
    { de: 'b', para: 'c', tipo: 'lidera' },
    { de: 'c', para: 'd', tipo: 'direto' }
  ];
  assert.deepEqual(AD.descendentes(rels, 'a').sort(), ['b', 'c']);
  assert.equal(AD.liderDe(rels, 'c'), 'b');
  assert.deepEqual(AD.lideradosDe(rels, 'b'), ['c']);
  assert.equal(AD.moverNoOrganograma, undefined, 'o organograma antigo (lista recuada) saiu do painel');
  assert.equal(AD.posicoesOrganograma, undefined);
});

test('painel: organograma antigo e o "topo" no localStorage foram removidos; usa DISC_ORGANOGRAMA', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const js = fs.readFileSync(path.join(__dirname, '..', 'js', 'admin.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'assets', 'admin.css'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
  assert.doesNotMatch(js, /disc_admin_org_topo|orgd-/);
  assert.doesNotMatch(css, /\.orgd-/);
  assert.match(js, /DISC_ORGANOGRAMA/);
  assert.match(js, /api\('salvarRelacoes', p\.emp\.id, rels, \{ topoIds:/);
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(scripts.indexOf('js/organograma.js') !== -1 && scripts.indexOf('js/organograma.js') < scripts.indexOf('js/admin.js'));
  assert.match(html, /href="assets\/organograma\.css"/);
  assert.match(html, /data-aba="relatorios"[^]*?<span class="aba__texto">Relatórios</);
  assert.match(html, /id="vista-relatorios"/);
  assert.match(html, /id="faixa-banco"[^>]*hidden/);
});

test('resumo do formulário: Nome e WhatsApp sempre, campos e perguntas extras', () => {
  const r = AD.resumoFormulario({ campos: { idade: 'oculto', email: 'obrigatorio' }, perguntas: [{ texto: 'Pretensão salarial?', obrigatoria: true }] });
  assert.deepEqual(r.slice(0, 2).map((x) => x.texto), ['Sempre pedido', 'Sempre pedido']);
  assert.equal(r.find((x) => x.rotulo === 'Idade').texto, 'Não perguntar');
  assert.equal(r.find((x) => x.rotulo === 'E-mail').texto, 'Obrigatória');
  assert.deepEqual(r[r.length - 1], { rotulo: 'Pretensão salarial?', modo: 'obrigatorio', texto: 'Obrigatória', extra: true });
});

test('pessoas: agrupa por pessoaId ou WhatsApp (só dígitos), mais recente primeiro', () => {
  const rec = (id, fim, extra) => AD.recalcular(payloadValido(Object.assign({ id, fim }, extra)));
  const a1 = rec('a1', '2026-10-01T10:00:00Z', { telefone: '(11) 99999-8888' });
  const a2 = rec('a2', '2026-10-03T10:00:00Z', { telefone: '5511999998888' });
  const b1 = rec('b1', '2026-10-02T10:00:00Z', { telefone: '5511977776666', pessoaId: 'uuid-b' });
  const b2 = rec('b2', '2026-09-01T10:00:00Z', { telefone: '5511000000000', pessoaId: 'uuid-b' });
  assert.equal(AD.chavePessoa(a1), AD.chavePessoa(a2));
  const g = AD.agruparPessoas([a1, b1, a2, b2]);
  assert.equal(g.length, 2);
  assert.equal(g[0].atual.id, 'a2');
  assert.deepEqual(g[0].respostas.map((r) => r.id), ['a2', 'a1']);
  assert.equal(g[1].total, 2);
  assert.equal(g[1].atual.id, 'b1');
  assert.equal(AD.agruparPessoas([rec('x', '', { telefone: '' }), rec('y', '', { telefone: '' })]).length, 2, 'sem telefone: cada resposta é uma pessoa');
});

test('pessoas: ficha usa r.pessoa quando existe; idade null mostra "—"; extras e consistência', () => {
  const r = AD.recalcular(payloadValido({ idade: null, funcao: 'Caixa', pessoa: { id: 'p', nome: 'Nome Novo', idade: null, funcao: '', email: 'a@b.com', cidade: 'Boa Vista' } }));
  const f = AD.fichaPessoa(r);
  assert.equal(f.nome, 'Nome Novo');
  assert.equal(f.funcao, 'Caixa', 'campo vazio na ficha cai no da resposta');
  assert.equal(f.email, 'a@b.com');
  assert.equal(AD.textoIdade(f.idade), '—');
  assert.equal(AD.fichaPessoa(AD.recalcular(payloadValido({ cidade: 'Manaus' }))).cidade, 'Manaus');
  assert.deepEqual(AD.lerExtras('[{"id":"p1","pergunta":"Pretensão?","resposta":"3000"},{"id":"x"}]'), [{ id: 'p1', pergunta: 'Pretensão?', resposta: '3000' }]);
  assert.deepEqual(AD.lerExtras(null), []);
  const di = AD.recalcular(payloadValido({ id: 'c1' }));
  const di2 = AD.recalcular(payloadValido({ id: 'c2' }));
  const sc = AD.recalcular(payloadValido({ id: 'c3', respostas: '1234'.repeat(25) }));
  assert.equal(AD.consistenciaPerfil([di]), null);
  assert.deepEqual(AD.consistenciaPerfil([di, di2]), { total: 2, igual: true, texto: 'O perfil se manteve nas 2 respostas.' });
  assert.equal(AD.consistenciaPerfil([di, sc]).texto, 'O perfil mudou entre as respostas: vale conversar sobre o momento de cada uma.');
});

test('CSV ganha e-mail, cidade e perguntas extras no fim', () => {
  const csv = AD.gerarCsv([AD.recalcular(payloadValido({ email: 'ana@x.com', cidade: 'Boa Vista', idade: null,
    extras: [{ id: 'p1', pergunta: 'Pretensão?', resposta: '3000' }, { id: 'p2', pergunta: 'CNH?', resposta: '' }] }))]);
  const linhas = csv.slice(1).split('\r\n').map((l) => l.split(';'));
  const cab = linhas[0];
  assert.deepEqual(cab.slice(-3), ['e-mail', 'cidade', 'perguntas extras']);
  assert.deepEqual(linhas[1].slice(-3), ['ana@x.com', 'Boa Vista', 'Pretensão?: 3000 | CNH?: —']);
  assert.equal(linhas[1][cab.indexOf('idade')], '', 'idade null fica vazia');
});

/* ---------- Fase 2: empresas, colaboradores, ligações e relatórios dos modelos ---------- */

test('admin.html carrega compatibilidade, relatórios dos modelos e a view antes do admin.js, na ordem certa', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  const i = (s) => scripts.indexOf(s);
  for (const s of ['js/compatibilidade.js', 'js/relatorio-lideranca.js', 'js/relatorio-pessoa.js', 'js/relatorio-modelos.js', 'js/relatorio-view.js']) {
    assert.ok(i(s) !== -1 && i(s) < i('js/admin.js'), s);
  }
  assert.ok(i('js/lideranca.js') < i('js/compatibilidade.js'));
  assert.ok(i('js/compatibilidade.js') < i('js/relatorio-modelos.js'));
  assert.ok(i('js/relatorio-lideranca.js') < i('js/relatorio-modelos.js'));
  assert.ok(i('js/relatorio-pessoa.js') < i('js/relatorio-modelos.js'));
});

test('modoEmpresas: Supabase e prévia usam; Apps Script mostra aviso; sem API não tem', () => {
  assert.equal(AD.modoEmpresas(true, true, false), 'ok');
  assert.equal(AD.modoEmpresas(true, false, true), 'ok');
  assert.equal(AD.modoEmpresas(true, false, false), 'legado');
  assert.equal(AD.modoEmpresas(false, false, false), 'local');
});

test('filtrarOpcoes e filtrarEmpresas: sem acento, todas as palavras, ativas primeiro por nome', () => {
  const ops = [{ valor: '1', rotulo: 'José Álvaro', sub: 'Gerente' }, { valor: '2', rotulo: 'Ana Souza', sub: 'Caixa', busca: '5511988887777' }];
  assert.deepEqual(AD.filtrarOpcoes(ops, 'jose').map((o) => o.valor), ['1']);
  assert.deepEqual(AD.filtrarOpcoes(ops, 'alvaro gerente').map((o) => o.valor), ['1']);
  assert.deepEqual(AD.filtrarOpcoes(ops, '98888').map((o) => o.valor), ['2']);
  assert.equal(AD.filtrarOpcoes(ops, '  ').length, 2);
  const emps = [{ id: 'c', nome: 'Zeta', ativo: true }, { id: 'a', nome: 'Árvore', ativo: false, cidade: 'Natal' }, { id: 'b', nome: 'Beta', ativo: true }];
  assert.deepEqual(AD.filtrarEmpresas(emps, '').map((e) => e.id), ['b', 'c', 'a']);
  assert.deepEqual(AD.filtrarEmpresas(emps, 'natal').map((e) => e.id), ['a']);
});

test('ligacoesDe: líder, liderados, diretos e indiretos nos dois sentidos', () => {
  const rel = [
    { de: 'a', para: 'b', tipo: 'lidera' }, { de: 'b', para: 'c', tipo: 'lidera' },
    { de: 'c', para: 'b', tipo: 'direto' }, { de: 'd', para: 'b', tipo: 'indireto' }, { de: 'b', para: 'e', tipo: 'direto' }
  ];
  assert.deepEqual(AD.ligacoesDe(rel, 'b'), { lider: 'a', diretos: ['c', 'e'], indiretos: ['d'], liderados: ['c'] });
  assert.deepEqual(AD.ligacoesDe(rel, 'z'), { lider: '', diretos: [], indiretos: [], liderados: [] });
});

test('aplicarLigacoes: troca líder/diretos/indiretos da pessoa, mantém quem ela lidera e as relações dos outros', () => {
  const rel = [
    { de: 'a', para: 'b', tipo: 'lidera' }, { de: 'b', para: 'c', tipo: 'lidera' },
    { de: 'b', para: 'd', tipo: 'direto' }, { de: 'c', para: 'd', tipo: 'indireto' }
  ];
  const novo = AD.aplicarLigacoes(rel, 'b', { lider: 'e', diretos: ['d', 'e', 'b', 'f'], indiretos: ['f', 'g'] });
  assert.deepEqual(novo, [
    { de: 'b', para: 'c', tipo: 'lidera' },
    { de: 'c', para: 'd', tipo: 'indireto' },
    { de: 'e', para: 'b', tipo: 'lidera' },
    { de: 'b', para: 'd', tipo: 'direto' },
    { de: 'b', para: 'f', tipo: 'direto' },
    { de: 'b', para: 'g', tipo: 'indireto' }
  ]);
  // Escolher como líder alguém que ela lidera desfaz o sentido antigo (sem ciclo de 2)
  const troca = AD.aplicarLigacoes(rel, 'b', { lider: 'c' });
  assert.ok(!troca.some((r) => r.de === 'b' && r.para === 'c' && r.tipo === 'lidera'));
  assert.ok(troca.some((r) => r.de === 'c' && r.para === 'b' && r.tipo === 'lidera'));
  // Sem líder e sem colegas: some tudo da pessoa, menos os liderados
  assert.deepEqual(AD.aplicarLigacoes(rel, 'b', {}), [{ de: 'b', para: 'c', tipo: 'lidera' }, { de: 'c', para: 'd', tipo: 'indireto' }]);
  assert.deepEqual(AD.aplicarLigacoes(rel, 'b', { lider: 'b' }).filter((r) => r.para === 'b'), [], 'não lidera a si mesma');
});

test('relacoesEntre descarta quem saiu', () => {
  const rel = [{ de: 'a', para: 'b', tipo: 'lidera' }, { de: 'b', para: 'c', tipo: 'direto' }];
  assert.deepEqual(AD.relacoesEntre(rel, ['a', 'b']), [{ de: 'a', para: 'b', tipo: 'lidera' }]);
});

test('entradaCompatibilidade: pessoas por pessoaId, sem teste = null, candidato em foco com líder e colegas', () => {
  const colabs = [
    { pessoaId: 'p1', nome: 'Ana Souza', cargo: 'Gerente', telefone: '5511999990000', resultado: { percentuais: { D: 40, I: 30, S: 20, C: 10 }, codigo: 'DI' } },
    { pessoaId: 'p2', nome: 'Bruno Lima', cargo: 'Caixa', resultado: null }
  ];
  const e = AD.entradaCompatibilidade({ nome: 'Loja' }, colabs, [{ de: 'p1', para: 'p2', tipo: 'lidera' }]);
  assert.deepEqual(e.pessoas.map((p) => p.id), ['p1', 'p2']);
  assert.equal(e.pessoas[1].percentuais, null);
  assert.ok(!('telefone' in e.pessoas[0]), 'telefone não entra');
  assert.equal(e.foco, undefined);
  const f = AD.entradaCompatibilidade({ nome: 'Loja' }, colabs, [], { nome: 'Carla', resultado: { percentuais: { D: 10, I: 20, S: 40, C: 30 } }, liderId: 'p1', diretos: ['p2', 'p1'] });
  assert.equal(f.foco, 'foco');
  assert.deepEqual(f.relacoes, [{ de: 'p1', para: 'foco', tipo: 'lidera' }, { de: 'foco', para: 'p2', tipo: 'direto' }]);
  const C = require('../js/compatibilidade.js');
  const r = C.montar(f);
  assert.ok(r.foco, 'compatibilidade analisa o candidato em foco');
  assert.equal(r.organograma.raizes[0].nome, 'Ana S.');
});

test('pessoasDasRespostas: uma por pessoa (a mais recente), com resultado do registro', () => {
  const regs = [
    AD.recalcular(payloadValido({ id: 'r1', pessoaId: 'p1', nome: 'Ana Antiga', fim: '2026-01-01T10:00:00Z' })),
    AD.recalcular(payloadValido({ id: 'r2', pessoaId: 'p1', nome: 'Ana Nova', fim: '2026-05-01T10:00:00Z' })),
    AD.recalcular(payloadValido({ id: 'r3', nome: 'Sem Pessoa' }))
  ];
  const ps = AD.pessoasDasRespostas(regs);
  assert.equal(ps.length, 1);
  assert.equal(ps[0].pessoaId, 'p1');
  assert.equal(ps[0].nome, 'Ana Nova');
  assert.equal(ps[0].registroId, 'r2');
  assert.deepEqual(Object.keys(ps[0].resultado), ['percentuais', 'codigo']);
  assert.equal(AD.resultadoDoRegistro({ calc: null }), null);
});

test('link e mensagem dos relatórios dos modelos (relatorio.html#r-TOKEN)', () => {
  const url = AD.linkRelatorioModelo('https://x.com/painel/admin.html?a=1#topo', 'tk_123');
  assert.equal(url, 'https://x.com/painel/relatorio.html#r-tk_123');
  const eq = AD.mensagemRelatorioModelo('equipe', { empresa: 'Loja Modelo', consultor: 'Wellington' }, url);
  assert.match(eq, /relatório da equipe da Loja Modelo/);
  assert.match(eq, /Wellington · Gestão sem Caos$/);
  assert.ok(eq.includes(url));
  assert.match(AD.mensagemRelatorioModelo('lideranca', { pessoa: 'Bruno Lima', empresa: 'Loja' }, url), /como liderar Bruno \(Loja\)/);
  assert.match(AD.mensagemRelatorioModelo('pessoa', { pessoa: 'Carla Dias' }, url), /^Olá, Carla! O seu relatório/);
  assert.match(AD.textoEquipeEmpresa('Loja Modelo'), /cadastro da empresa Loja Modelo.*compartilhado com a empresa/);
});

test('painel: sem <select> nativo nem confirm/prompt do navegador nas telas novas', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const js = fs.readFileSync(path.join(__dirname, '..', 'js', 'admin.js'), 'utf8');
  assert.doesNotMatch(js, /createElement\('select'\)|el\('select'/);
  assert.doesNotMatch(js, /\b(window|root)\.(confirm|prompt|alert)\(/);
});

/* ---------- Rodada 4: aba Relatórios, mover resposta, contratar e aviso de banco ---------- */

test('catálogo dos modelos: 5 cartões na ordem, com para quem é e o que responde', () => {
  assert.deepEqual(AD.MODELOS_CATALOGO.map((m) => m.chave), ['pessoa-completo', 'pessoa-simples', 'lideranca', 'equipe', 'processo']);
  assert.deepEqual(AD.MODELOS_CATALOGO.map((m) => m.titulo), ['Pessoa · completo', 'Pessoa · simples', 'Como liderar', 'Equipe', 'Processo seletivo']);
  for (const m of AD.MODELOS_CATALOGO) {
    assert.ok(m.paraQuem.length > 10 && m.responde.length > 10, m.chave);
    assert.ok(['pessoa', 'colaborador', 'empresa', 'processo'].includes(m.alvo));
  }
  assert.equal(AD.modeloDoCatalogo('equipe').modelo, 'equipe');
  assert.equal(AD.modeloDoCatalogo('x'), null);
});

test('exemplos dos modelos: dados fictícios fixos montados pelos modelos e pelo motor do processo', () => {
  const M = require('../js/relatorio-modelos.js');
  const pc = AD.exemploModelo('pessoa-completo', { modelos: M });
  const ps = AD.exemploModelo('pessoa-simples', { modelos: M });
  const li = AD.exemploModelo('lideranca', { modelos: M });
  const eq = AD.exemploModelo('equipe', { modelos: M });
  assert.equal(pc.modelo, 'pessoa');
  assert.equal(ps.modelo, 'pessoa');
  assert.equal(ps.variante, 'simples');
  assert.equal(li.modelo, 'lideranca');
  assert.equal(eq.modelo, 'equipe');
  assert.match(JSON.stringify(eq), /Loja Exemplo/);
  // determinístico (só a data de geração pode mudar)
  const semData = (x) => JSON.stringify(x).replace(/"geradoEm":"[^"]*"/g, '');
  assert.equal(semData(AD.exemploModelo('equipe', { modelos: M })), semData(eq));
  const pr = AD.exemploModelo('processo', { motor: require('../js/relatorio-motor.js'), fixture: require('../js/fixture-processo-exemplo.js') });
  assert.ok(pr && pr.processo, 'relatório do processo de exemplo');
  assert.equal(pr.processo.clickupListId, undefined);
  assert.throws(() => AD.exemploModelo('processo', {}), /não carregou/);
  assert.throws(() => AD.exemploModelo('equipe', {}), /modelos de relatório/);
});

test('gerados: junta modelos e processos (mais recente primeiro) e filtra por modelo, empresa e situação', () => {
  const href = 'https://site.com/painel/admin.html';
  const lista = AD.juntarGerados(
    [{ id: 'm1', modelo: 'equipe', token: 't1', status: 'publicado', empresaId: 'e1', titulo: 'Relatório da equipe', criadoEm: '2026-10-01T10:00:00Z' },
      { id: 'm2', modelo: 'pessoa', token: 't2', status: 'rascunho', pessoaId: 'p1', titulo: 'Ana', criadoEm: '2026-10-03T10:00:00Z' }],
    [{ token: 'tp', processoId: 'pr1', status: 'publicado', criadoEm: '2026-10-02T10:00:00Z', publicadoEm: '2026-10-02T11:00:00Z' }],
    { empresas: { e1: 'Loja Ávila' }, processos: { pr1: { nome: 'Vendedor 2026', empresa: 'Loja Ávila' } }, href });
  assert.deepEqual(lista.map((r) => r.id), ['m:m2', 'p:tp', 'm:m1']);
  assert.equal(lista[2].url, 'https://site.com/painel/relatorio.html#r-t1');
  assert.equal(lista[1].url, 'https://site.com/painel/relatorio.html?r=tp');
  assert.equal(lista[0].url, '');
  assert.equal(lista[1].titulo, 'Processo seletivo · Vendedor 2026');
  assert.deepEqual(AD.filtrarGerados(lista, { modelo: 'processo' }).map((r) => r.id), ['p:tp']);
  assert.deepEqual(AD.filtrarGerados(lista, { empresa: 'loja avila' }).map((r) => r.id), ['p:tp', 'm:m1']);
  assert.deepEqual(AD.filtrarGerados(lista, { status: 'rascunho' }).map((r) => r.id), ['m:m2']);
  assert.equal(AD.filtrarGerados(lista, {}).length, 3);
});

test('mover resposta: processos de destino sem o atual, com "Sem processo"', () => {
  const procs = [{ id: 'a', codigo: 'AAA1', nome: 'Vendedor', empresa: 'Loja', tipo: 'selecao' }, { id: 'b', codigo: 'BBB2', nome: 'Caixa', tipo: 'selecao', ativa: false }];
  const ops = AD.opcoesMoverProcesso(procs, 'AAA1');
  assert.deepEqual(ops.map((o) => o.valor), ['', 'b']);
  assert.match(ops[1].rotulo, /Caixa \(BBB2\)/);
  assert.match(ops[1].sub, /desativado/);
  assert.deepEqual(AD.opcoesMoverProcesso(procs, '').map((o) => o.valor), ['a', 'b'], 'sem processo hoje: não oferece "Sem processo"');
});

test('aviso de banco desatualizado: lista o que falta; sem a função = mesmo aviso; em dia = nada', () => {
  assert.equal(AD.mensagemBanco({ ok: true, versao: 20261010120000, faltando: [] }), '');
  assert.equal(AD.mensagemBanco({ ok: true, versao: 20261010120000 }), '');
  assert.equal(AD.mensagemBanco({ ok: true, faltando: ['20261010120000_mover_versao', 'fotos'] }),
    'O banco de dados está desatualizado: faltam 20261010120000_mover_versao, fotos. Peça para aplicar as migrações (veja docs/SUPABASE.md).');
  assert.match(AD.mensagemBanco({ ok: false, erro: 'function versao_banco does not exist' }), /^O banco de dados está desatualizado: faltam as migrações mais recentes\. Peça/);
  assert.match(AD.mensagemBanco(null), /desatualizado/);
  assert.match(AD.mensagemBanco({ ok: true, faltando: [], semFuncao: true }), /faltam as migrações mais recentes/);
});

/* ---------- Vendas ---------- */

test('formatarReais: R$ com centavos no padrão pt-BR', () => {
  assert.equal(AD.formatarReais(3900), 'R$ 39,00');
  assert.equal(AD.formatarReais(2990), 'R$ 29,90');
  assert.equal(AD.formatarReais(5), 'R$ 0,05');
  assert.equal(AD.formatarReais(0), 'R$ 0,00');
  assert.equal(AD.formatarReais(123456789), 'R$ 1.234.567,89');
  assert.equal(AD.formatarReais(null), 'R$ 0,00');
  assert.equal(AD.formatarReais(-1500), '-R$ 15,00');
});

test('centavosDeTexto aceita vírgula, ponto, milhar e R$', () => {
  assert.equal(AD.centavosDeTexto('29,90'), 2990);
  assert.equal(AD.centavosDeTexto('R$ 1.234,56'), 123456);
  assert.equal(AD.centavosDeTexto('39'), 3900);
  assert.equal(AD.centavosDeTexto('29.9'), 2990);
  assert.equal(AD.centavosDeTexto('1.000'), 100000);
  assert.equal(AD.centavosDeTexto(''), null);
  assert.equal(AD.centavosDeTexto('abc'), null);
  assert.equal(AD.centavosDeTexto('1,999'), null);
});

test('normalizarPedido aceita camelCase e colunas do banco', () => {
  const a = AD.normalizarPedido({ id: 'p1', resposta_id: 'r1', pacote: 'completo', valor_centavos: 2900, status: 'pago', token_acesso: 'tok', criado_em: '2026-10-05T10:00:00Z', pago_em: '2026-10-05T10:01:00Z' });
  assert.equal(a.respostaId, 'r1');
  assert.equal(a.valorCentavos, 2900);
  assert.equal(a.tokenAcesso, 'tok');
  assert.equal(a.pagoEm, '2026-10-05T10:01:00Z');
  const b = AD.normalizarPedido({ id: 'p2', respostaId: 'r2', valorCentavos: 4900, status: 'qualquer' });
  assert.equal(b.status, 'aguardando', 'status desconhecido vira aguardando');
  const c = AD.normalizarCupom({ codigo: 'lanc', tipo: 'percentual', valor: 20, usos_max: 50, valido_ate: '2026-12-31T00:00:00Z', pacotes: ['completo'] });
  assert.deepEqual(c, { codigo: 'LANC', tipo: 'percentual', valor: 20, usosMax: 50, usos: 0, validoAte: '2026-12-31', ativo: true, pacotes: ['completo'] });
  const k = AD.normalizarPacote({ chave: 'completo', nome: 'Relatório completo', preco_centavos: 3900, preco_lancamento_centavos: 2900, lancamento_ate: '2026-11-30', ativo: true, ordem: 1 });
  assert.equal(k.precoLancamentoCentavos, 2900);
  assert.equal(AD.normalizarPacote({ chave: 'x', preco_centavos: 100 }).precoLancamentoCentavos, null);
});

const AGORA = new Date(2026, 9, 15, 15, 0, 0); // 15/10/2026 15h (hora local)
function iso(dia, hora) { return new Date(2026, 9, dia, hora || 10, 0, 0).toISOString(); }
function pedidos() {
  return [
    { id: 'a1', respostaId: 'r1', pacote: 'completo', valorCentavos: 2900, status: 'pago', nome: 'Ana Lima', email: 'ana@x.com', criadoEm: iso(15), pagoEm: iso(15, 11) },
    { id: 'b2', respostaId: 'r2', pacote: 'completo_plus', valorCentavos: 4900, status: 'pago', nome: 'Bruno', email: 'bruno@x.com', cupom: 'LANC', criadoEm: iso(12), pagoEm: iso(12) },
    { id: 'c3', respostaId: 'r3', pacote: 'completo', valorCentavos: 2900, status: 'pago', nome: 'Célia', email: 'celia@x.com', criadoEm: iso(2), pagoEm: iso(2) },
    { id: 'd4', respostaId: 'r4', pacote: 'completo', valorCentavos: 2900, status: 'aguardando', nome: 'Davi', email: 'davi@x.com', criadoEm: iso(15, 14) },
    { id: 'e5', respostaId: 'r5', pacote: 'completo', valorCentavos: 0, status: 'cortesia', nome: 'Eva', email: 'eva@x.com', cupom: 'PARCEIRO', criadoEm: iso(10), pagoEm: iso(10) },
    { id: 'f6', respostaId: 'r6', pacote: 'completo', valorCentavos: 2900, status: 'estornado', nome: 'Fábio', email: 'fabio@x.com', criadoEm: new Date(2026, 8, 28).toISOString(), pagoEm: new Date(2026, 8, 28).toISOString() }
  ].map(AD.normalizarPedido);
}

test('resumoDosPedidos: vendas e receita (só pagos), ticket médio, aguardando, conversão e 10 últimos', () => {
  const r = AD.resumoDosPedidos(pedidos(), AGORA, 20);
  assert.deepEqual(r.hoje, { vendas: 1, receitaCentavos: 2900 });
  assert.deepEqual(r.semana, { vendas: 2, receitaCentavos: 7800 });
  assert.deepEqual(r.mes, { vendas: 3, receitaCentavos: 10700 });
  assert.equal(r.ticketMedioCentavos, Math.round(10700 / 3));
  assert.equal(r.aguardando, 1);
  assert.equal(r.cortesias, 1);
  assert.equal(r.compras, 4, 'pago + cortesia, por resposta');
  assert.equal(r.conversao, 20, '4 de 20 resumos grátis');
  assert.equal(r.ultimos[0].id, 'd4', 'mais recente primeiro');
  assert.equal(r.ultimos.length, 6);
  const muitos = Array.from({ length: 14 }, (_, i) => AD.normalizarPedido({ id: 'x' + i, criadoEm: iso(1 + i) }));
  assert.equal(AD.resumoDosPedidos(muitos, AGORA).ultimos.length, 10);
  assert.equal(AD.resumoDosPedidos([], AGORA, 0).conversao, null, 'sem resumo grátis não divide por zero');
});

test('juntarResumo: o que vem do servidor vale; o resto é calculado', () => {
  const calc = AD.resumoDosPedidos(pedidos(), AGORA, 20);
  const j = AD.juntarResumo({ hoje: { vendas: 5, receitaCentavos: 14500 }, gratis: 50, compras: 10 }, calc);
  assert.deepEqual(j.hoje, { vendas: 5, receitaCentavos: 14500 });
  assert.deepEqual(j.mes, calc.mes);
  assert.equal(j.conversao, 20);
  assert.equal(AD.juntarResumo({ conversao: 12.5 }, calc).conversao, 12.5);
  // Formato do resumo_vendas (Supabase): resumos/compras e conversão como fração 0–1
  const sv = AD.juntarResumo({ periodo: 'mes', hoje: { vendas: 2, receitaCentavos: 5800 }, resumos: 40, compras: 6, conversao: 0.15, cortesias: 3, aguardando: 4 }, calc);
  assert.equal(sv.conversao, 15);
  assert.equal(sv.gratis, 40);
  assert.equal(sv.cortesias, 3);
  assert.equal(sv.aguardando, 4);
  assert.equal(sv.periodo, 'mes');
  assert.equal(AD.juntarResumo({ conversao: 0.375 }, calc).conversao, 37.5);
  assert.deepEqual(AD.juntarResumo(null, calc), calc);
});

test('filtrarPedidos: busca (sem acento), status, pacote e período', () => {
  const l = pedidos();
  assert.deepEqual(AD.filtrarPedidos(l, { busca: 'celia' }, AGORA).map((p) => p.id), ['c3']);
  assert.deepEqual(AD.filtrarPedidos(l, { busca: 'lanc' }, AGORA).map((p) => p.id), ['b2'], 'busca pelo cupom');
  assert.deepEqual(AD.filtrarPedidos(l, { status: 'pago' }, AGORA).map((p) => p.id), ['a1', 'b2', 'c3']);
  assert.deepEqual(AD.filtrarPedidos(l, { pacote: 'completo_plus' }, AGORA).map((p) => p.id), ['b2']);
  assert.deepEqual(AD.filtrarPedidos(l, { periodo: 'hoje' }, AGORA).map((p) => p.id), ['d4', 'a1']);
  assert.deepEqual(AD.filtrarPedidos(l, { periodo: 'mes' }, AGORA).map((p) => p.id), ['d4', 'a1', 'b2', 'e5', 'c3']);
  assert.equal(AD.filtrarPedidos(l, {}, AGORA).length, 6);
});

test('validarCupom e validarPacote', () => {
  const ok = { codigo: 'LANCAMENTO', tipo: 'percentual', valor: 20, usosMax: null, validoAte: '', pacotes: [] };
  assert.equal(AD.validarCupom(ok), '');
  assert.match(AD.validarCupom({ ...ok, codigo: 'co d' }), /código/);
  assert.match(AD.validarCupom({ ...ok, valor: 120 }), /1 a 100/);
  assert.match(AD.validarCupom({ ...ok, valor: 0 }), /valor do desconto/);
  assert.equal(AD.validarCupom({ ...ok, tipo: 'valor', valor: 1000 }), '');
  assert.match(AD.validarCupom({ ...ok, usosMax: 0 }), /limite/);
  const p = { nome: 'Relatório completo', precoCentavos: 3900, precoLancamentoCentavos: 2900, lancamentoAte: '2026-11-30', ordem: 1 };
  assert.equal(AD.validarPacote(p), '');
  assert.match(AD.validarPacote({ ...p, nome: ' ' }), /nome/);
  assert.match(AD.validarPacote({ ...p, precoCentavos: null }), /preço/);
  assert.match(AD.validarPacote({ ...p, precoLancamentoCentavos: 3900 }), /menor/);
  assert.equal(AD.validarPacote({ ...p, precoLancamentoCentavos: null, lancamentoAte: '' }), '');
});

test('links de venda: landing com cupom, relatório comprado e mensagem de reenvio (Gestão sem Caos)', () => {
  assert.equal(AD.linkLandingCupom('https://site.com/disc/admin.html#x', 'lanc 20'), 'https://site.com/disc/descubra.html?cupom=LANC%2020');
  assert.equal(AD.linkLandingCupom('https://site.com/admin.html?a=1', 'LANC'), 'https://site.com/descubra.html?cupom=LANC');
  const url = AD.linkMeuRelatorio('https://site.com/disc/admin.html', 'abc123');
  assert.equal(url, 'https://site.com/disc/meu-relatorio.html#t-abc123');
  const msg = AD.mensagemReenvio({ nome: 'Ana Lima' }, url);
  assert.match(msg, /^Olá, Ana!/);
  assert.ok(msg.includes(url));
  assert.match(msg, /Gestão sem Caos/);
  assert.doesNotMatch(msg, /Notus/);
  const rec = AD.linkRecuperar('https://site.com/disc/admin.html#x');
  assert.equal(rec, 'https://site.com/disc/meu-relatorio.html#recuperar');
  const ori = AD.mensagemOrientacao({ nome: 'Davi Souza', email: 'davi@gmail.com' }, rec);
  assert.match(ori, /^Olá, Davi!/);
  assert.ok(ori.includes(rec) && ori.includes('davi@gmail.com') && ori.includes('Gestão sem Caos'));
  assert.equal(AD.textoCupom({ tipo: 'percentual', valor: 20 }), '20% de desconto');
  assert.equal(AD.textoCupom({ tipo: 'valor', valor: 1000 }), 'R$ 10,00 de desconto');
});

test('participantes: origem "pessoal" aparece como venda direta e o e-mail entra na busca', () => {
  assert.equal(AD.textoOrigem({ origem: 'pessoal' }), 'Mapa pessoal (venda direta)');
  assert.equal(AD.textoOrigem({ origem: 'processo' }), 'Link geral');
  assert.equal(AD.correspondeBusca({ nome: 'Ana', email: 'ana.lima@gmail.com' }, 'lima@gmail'), true);
});

// ---------------------------------------------------------------------------
// Aba Conexões: cartões montados a partir do diagnóstico (sem nunca mostrar valores de segredos)
// ---------------------------------------------------------------------------

function diagConexoes(extra) {
  const seg = { SUPABASE_URL: true, SUPABASE_ANON_KEY: true, SUPABASE_SERVICE_ROLE_KEY: true, SITE_URL: true, PAGAMENTO_PROVEDOR: true,
    INFINITEPAY_HANDLE: true, ASAAS_API_KEY: false, ASAAS_WEBHOOK_TOKEN: false, ASAAS_AMBIENTE: false, RESEND_API_KEY: true,
    EMAIL_REMETENTE: false, CLICKUP_TOKEN: true, CLICKUP_PASTA_ID: false, CLICKUP_WEBHOOK_SECRET: false, ANTHROPIC_API_KEY: false };
  const funcoes = ['admin', 'disc-sync', 'clickup-webhook', 'pagamento', 'stripe-webhook', 'asaas-webhook', 'infinitepay-webhook']
    .map((nome) => ({ nome, publicada: nome !== 'asaas-webhook' && nome !== 'stripe-webhook' }));
  return Object.assign({
    ok: true, em: '2026-10-05T12:00:00Z', siteAtual: 'https://disc.gsc.com.br/',
    banco: { ms: 90, versao: 20261014120000, faltando: [], contagens: { processos: 2, respostas: 5, pessoas: 4, empresas: 1, pedidos: 0 }, ultimaResposta: '', erro: '' },
    login: { sessao: true, email: 'dona@gsc.com.br', admin: true },
    servidor: { siteUrl: 'https://disc.gsc.com.br/', segredos: seg, funcoes, auth: { cadastroFechado: true }, colunaTeste: true, pedidoTeste: null,
      pagamento: { provedor: 'infinitepay', provedorEscolhido: 'infinitepay', handleParcial: 'ge***', asaasAmbiente: 'sandbox' } },
    servidorEstado: 'ok', servidorErro: ''
  }, extra || {});
}
const porId = (lista) => Object.fromEntries(lista.map((c) => [c.id, c]));

test('Conexões: 11 cartões com estados; opcionais não contam como erro; testes externos mudam o estado', () => {
  const c = porId(AD.cartoesConexoes(diagConexoes()));
  assert.deepEqual(Object.keys(c), ['site', 'banco', 'login', 'funcoes', 'stripe', 'infinitepay', 'asaas', 'email', 'clickup', 'ia', 'despertador']);
  assert.equal(c.stripe.status, 'nao_configurado');
  assert.ok(c.funcoes.linhas.includes('stripe-webhook — NÃO publicada (só precisa se usar o Stripe)'));
  assert.equal(c.site.status, 'ok');
  assert.equal(c.banco.status, 'ok');
  assert.ok(c.banco.linhas.some((l) => /Respostas: 5/.test(l)));
  assert.equal(c.login.status, 'ok');
  assert.equal(c.funcoes.status, 'ok', 'asaas-webhook é opcional sem o Asaas');
  assert.ok(c.funcoes.linhas.includes('asaas-webhook — NÃO publicada (só precisa se usar o Asaas)'));
  assert.equal(c.infinitepay.status, 'ok');
  assert.ok(c.infinitepay.linhas.includes('InfiniteTag (INFINITEPAY_HANDLE): existe (ge***)'));
  assert.deepEqual(c.infinitepay.acoes, ['testar', 'link', 'verificar']);
  assert.equal(c.asaas.status, 'nao_configurado');
  assert.ok(c.asaas.passos.some((p) => /Edge Functions → Secrets/.test(p)));
  assert.equal(c.email.status, 'pendente');
  assert.equal(c.clickup.status, 'pendente');
  assert.equal(c.ia.status, 'nao_configurado');
  assert.equal(c.despertador.status, 'manual');

  const t = porId(AD.cartoesConexoes(diagConexoes(), {
    clickup: { sucesso: true, mensagem: 'Conectado ao ClickUp como Ana.', em: '2026-10-05T12:01:00Z', verificado: 'GET /user' },
    email: { sucesso: false, mensagem: 'O Resend recusou a chave.', em: '2026-10-05T12:01:00Z' },
    'infinitepay.link': { sucesso: true, mensagem: 'Link criado.', detalhes: { url: 'https://checkout.infinitepay.io/x/1', pedidoId: 'p1' } }
  }, { ia: true }));
  assert.equal(t.clickup.status, 'ok');
  assert.ok(t.clickup.linhas.includes('Conectado ao ClickUp como Ana.'));
  assert.equal(t.clickup.quando, '2026-10-05T12:01:00Z');
  assert.equal(t.email.status, 'erro');
  assert.equal(t.email.erro, 'O Resend recusou a chave.');
  assert.deepEqual(t.infinitepay.link, { url: 'https://checkout.infinitepay.io/x/1', pedidoId: 'p1' });
  assert.equal(t.ia.status, 'testando');
  assert.deepEqual(AD.resumoConexoes(Object.values(t)), { ok: 6, erro: 1, nao_configurado: 2, outros: 2 });
});

test('Conexões: cartão "Pagamento — Stripe" (modo pelo prefixo, sem a chave; domínio do Apple Pay; teste de R$ 1,00)', () => {
  const d = diagConexoes();
  Object.assign(d.servidor.segredos, { STRIPE_SECRET_KEY: true, STRIPE_PUBLISHABLE_KEY: true, STRIPE_WEBHOOK_SECRET: true });
  Object.assign(d.servidor.pagamento, { provedor: 'stripe', provedorEscolhido: 'stripe', stripeModo: 'teste', stripePublicavelModo: 'teste', stripeDominio: 'disc.gestaosemcaos.com.br' });
  d.servidor.funcoes.find((f) => f.nome === 'stripe-webhook').publicada = true;
  let c = porId(AD.cartoesConexoes(d));
  assert.equal(c.stripe.nome, 'Pagamento — Stripe');
  assert.equal(c.stripe.status, 'ok');
  assert.deepEqual(c.stripe.acoes, ['testar', 'stripe-pagar', 'stripe-verificar']);
  assert.ok(c.stripe.linhas.some((l) => /STRIPE_SECRET_KEY\): existe — modo teste/.test(l)));
  assert.ok(c.stripe.linhas.includes('Provedor em uso no site: Stripe'));
  assert.ok(c.infinitepay.linhas.includes('Provedor em uso no site: Stripe'));
  assert.ok(!JSON.stringify(c.stripe).includes('sk_'), 'nunca mostra a chave');
  // Domínio não registrado: erro com o passo do Apple Pay.
  c = porId(AD.cartoesConexoes(d, { stripe: { sucesso: true, mensagem: 'O Stripe aceitou a chave (modo teste).', detalhes: { dominio: 'disc.gestaosemcaos.com.br', dominioRegistrado: false } } }));
  assert.equal(c.stripe.status, 'erro');
  assert.match(c.stripe.erro, /não está registrado no Stripe: o Apple Pay não aparece/);
  assert.ok(c.stripe.passos.some((p) => /Payment method domains/.test(p)));
  // Pagamento de teste e verificação.
  c = porId(AD.cartoesConexoes(d, { 'stripe.pagamento': { sucesso: true, mensagem: 'ok', detalhes: { pedidoId: 'p9' } },
    'stripe.verificar': { sucesso: true, mensagem: 'Pagamento de teste confirmado pelo Stripe. O ciclo completo funciona.', detalhes: { pago: true } } }));
  assert.equal(c.stripe.pedidoTeste, 'p9');
  assert.ok(c.stripe.linhas.includes('Pagamento de teste confirmado pelo Stripe. O ciclo completo funciona.'));
  // Sem webhook ou chaves de modos diferentes: erro.
  d.servidor.segredos.STRIPE_WEBHOOK_SECRET = false;
  assert.match(porId(AD.cartoesConexoes(d)).stripe.erro, /STRIPE_WEBHOOK_SECRET/);
  d.servidor.segredos.STRIPE_WEBHOOK_SECRET = true;
  d.servidor.pagamento.stripePublicavelModo = 'producao';
  assert.match(porId(AD.cartoesConexoes(d)).stripe.erro, /modos diferentes/);
  assert.equal(AD.urlPagamentoStripe('pi_3Abc123'), 'https://dashboard.stripe.com/payments/pi_3Abc123');
  assert.equal(AD.urlPagamentoStripe('javascript:x'), '');
});

test('Conexões: migração faltando, SITE_URL diferente, cadastro aberto, função ausente e admin desatualizada', () => {
  const d = diagConexoes({ siteAtual: 'https://outro.com/' });
  d.banco.faltando = [{ nome: '20261013120000_conexoes', descricao: 'aba Conexões (pedido de teste fora das vendas)' }];
  d.servidor.auth.cadastroFechado = false;
  d.servidor.funcoes.find((f) => f.nome === 'pagamento').publicada = false;
  const c = porId(AD.cartoesConexoes(d));
  assert.equal(c.banco.status, 'erro');
  assert.match(c.banco.erro, /aba Conexões \(pedido de teste fora das vendas\) \(20261013120000_conexoes\.sql\)/);
  assert.equal(c.site.status, 'erro');
  assert.equal(c.login.status, 'erro');
  assert.ok(c.login.passos.some((p) => /Allow new users to sign up/.test(p)));
  assert.equal(c.funcoes.status, 'erro');
  assert.match(c.funcoes.erro, /pagamento/);
  assert.ok(c.funcoes.passos.some((p) => p.includes('dist/funcoes/pagamento/index.ts')));
  // Cópia local: endereço diferente não é erro.
  assert.equal(porId(AD.cartoesConexoes(diagConexoes({ siteAtual: 'http://localhost:4173/' }))).site.status, 'ok');
  // Sem SITE_URL: não configurado, com o passo.
  const semSite = diagConexoes();
  semSite.servidor.siteUrl = '';
  assert.equal(porId(AD.cartoesConexoes(semSite)).site.status, 'nao_configurado');

  const velha = porId(AD.cartoesConexoes(diagConexoes({ servidor: null, servidorEstado: 'desatualizada', servidorErro: 'x' })));
  assert.equal(velha.funcoes.status, 'erro');
  assert.equal(velha.funcoes.erro, 'A função admin está desatualizada: publique de novo.');
  assert.ok(velha.funcoes.passos.some((p) => p.includes('dist/funcoes/admin/index.ts')));
  assert.equal(velha.banco.status, 'ok', 'o banco é testado pelo navegador, mesmo sem a função');
  assert.equal(velha.clickup.status, 'erro');
});

test('Conexões: nenhum texto dos cartões traz valor de segredo (só "existe"/"não existe" e o handle parcial)', () => {
  const txt = JSON.stringify(AD.cartoesConexoes(diagConexoes()));
  assert.ok(!/sk-ant-[A-Za-z0-9]{4}|pk_[A-Za-z0-9]{4}|re_[A-Za-z0-9]{4}|\$aact_|sb_secret/.test(txt));
  assert.ok(!/Notus/i.test(txt));
});
