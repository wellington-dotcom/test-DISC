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
  assert.ok(/textoIdade\(r\.idade\)/.test(corpo('renderizarDetalhe')), 'detalhe mostra a idade');
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

test('abas e permissões por papel', () => {
  assert.deepEqual(AD.abasDoPapel('admin', true), ['lista', 'avaliacoes', 'empresas', 'usuarios', 'comparativo', 'importar']);
  assert.deepEqual(AD.abasDoPapel('gestor', true), ['lista', 'comparativo']);
  assert.deepEqual(AD.abasDoPapel('', true), []);
  assert.deepEqual(AD.abasDoPapel('', false), ['lista', 'comparativo', 'importar'], 'modo local, sem login');
  const g = AD.permissoes('gestor', true);
  assert.equal(g.excluir, false);
  assert.equal(g.criar, false);
  assert.equal(g.importar, false);
  assert.equal(g.filtrarEmpresa, false);
  assert.equal(g.statusObservacoes, true);
  const a = AD.permissoes('admin', true);
  assert.ok(a.excluir && a.criar && a.importar && a.filtrarEmpresa && a.statusObservacoes);
  assert.equal(AD.permissoes('', false).excluir, true, 'modo local continua podendo excluir');
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

test('link e mensagem da avaliação', () => {
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

test('CSV ganha avaliação, empresa da avaliação e confiabilidade no fim', () => {
  const csv = AD.gerarCsv([AD.recalcular(payloadValido({ avaliacao: 'SEL1', avaliacaoNome: 'Recepcionista 2026', empresaNome: 'Clínica Exemplo', validacao: validacaoDI() }))]);
  const linhas = csv.slice(1).split('\r\n').map((l) => l.split(';'));
  const fim = linhas[0].slice(-3);
  assert.deepEqual(fim, ['avaliação', 'empresa da avaliação', 'confiabilidade']);
  assert.deepEqual(linhas[1].slice(-3), ['Recepcionista 2026', 'Clínica Exemplo', 'Alta']);
});

test('guia copiado leva o aviso quando a confiabilidade é baixa', () => {
  const reg = AD.recalcular(payloadValido({ validacao: validacaoDI({ escolhas: ['C', 'S', 'S'] }) }));
  assert.equal(reg.conf.nivel, 'baixa');
  assert.ok(AD.guiaComoTexto(L.gerarGuia(reg.calc, reg.nome), reg).indexOf(AD.AVISO_GUIA_BAIXA) !== -1);
  assert.equal(AD.AVISO_GUIA_BAIXA, 'Atenção: a confiabilidade deste resultado é baixa. Use o guia com cautela e confirme em entrevista.');
});

test('admin.html: login por e-mail e senha, sem a tela de chave, e carrega validacao/confiabilidade antes do admin.js', () => {
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
  assert.match(html, /Prévia: <span class="negrito">admin@previa\.com<\/span> ou <span class="negrito">gestor@previa\.com<\/span>, senha <span class="negrito">previa123<\/span>/);
});
