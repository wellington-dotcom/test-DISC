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
