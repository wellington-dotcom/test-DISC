'use strict';
// Motor do relatório (js/relatorio-motor.js): score, aderência DISC, funil, textos por regra e a fixture
// tests/fixtures/processo-exemplo.json (processo fictício completo).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RAIZ = path.join(__dirname, '..');
const M = require('../js/relatorio-motor.js');
const FIXTURE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'processo-exemplo.json'), 'utf8'));
const AGORA = '2026-10-05T12:00:00.000Z';
const copia = (o) => JSON.parse(JSON.stringify(o));

const CONFIG = {
  perfilIdeal: 'CD',
  etapas: [
    { id: 'a', nome: 'Revisão documental', peso: 30 },
    { id: 'b', nome: 'Redação situacional', peso: 15 },
    { id: 'c', nome: 'Digitação', peso: 10 },
    { id: 'd', nome: 'Atenção', peso: 20 },
    { id: 's', nome: 'Simulação ao vivo', peso: 25 }
  ],
  bonus: [
    { id: 'grad', nome: 'Graduação na área', regra: { tipo: 'checkbox', pontos: 10 } },
    { id: 'pres', nome: 'Perfil presencial', regra: { tipo: 'mapa', pontos: { '5': 15, '4': 10, '3': 0 } } }
  ],
  corte: 70,
  faixaAvaliar: 55
};
const cand = (id, nome, notas, bonusValores, extra) => Object.assign({
  id, nome, status: 'finalista', criadoEm: '2026-08-01T12:00:00.000Z', idade: null, statusTrabalho: null, pretensao: null,
  ultimoSalario: null, formacao: null, notas, bonusValores: bonusValores || {}, disc: null, finalista: true
}, extra || {});

function idsReferenciados(rel) {
  const ids = [];
  (function andar(o) {
    if (Array.isArray(o)) return o.forEach(andar);
    if (!o || typeof o !== 'object') return;
    Object.keys(o).forEach((k) => {
      if (k === 'textos') return;
      if (/textoId$/i.test(k) && o[k]) ids.push(o[k]);
      else if (k === 'proximosPassos') o[k].forEach((id) => ids.push(id));
      else andar(o[k]);
    });
  })(rel);
  return ids;
}

// ---------------------------------------------------------------------------
// Score
// ---------------------------------------------------------------------------

test('score: pesos normalizados sobre as etapas aplicadas, pendentes fora, bônus por fora', () => {
  const c = cand('1', 'Ana Exemplo', { a: 8, b: 7, c: 10, d: 10, s: null }, { grad: true, pres: '5' });
  const s = M.calcularScore(c, CONFIG, ['a', 'b', 'c', 'd']);
  // 0,8×40 + 0,7×20 + 1×13,33 + 1×26,67 = 86
  assert.equal(s.tecnico, 86);
  assert.equal(s.bonus, 25);
  assert.equal(s.total, 111);
  assert.equal(s.situacao, 'aprovado');
  assert.equal(s.incompleto, false);
  assert.deepEqual(s.pendentes, ['s']);
  assert.deepEqual(s.contribuicoes, { a: 32, b: 14, c: 13.3, d: 26.7 });
  assert.deepEqual(s.bonusDetalhe.map((b) => [b.id, b.pontos]), [['grad', 10], ['pres', 15]]);
});

test('score: nota vazia numa etapa aplicada conta zero e marca incompleto', () => {
  const c = cand('1', 'Bruna Teste', { a: 5, b: null, c: 5, d: 5 });
  const s = M.calcularScore(c, CONFIG, ['a', 'b', 'c', 'd']);
  assert.equal(s.incompleto, true);
  assert.deepEqual(s.faltando, ['b']);
  assert.equal(s.tecnico, 40); // 0,5 × (40 + 13,33 + 26,67)
  assert.equal(s.situacao, 'nao_recomendado');
});

test('score: sem a lista de aplicadas, valem as etapas com nota do próprio candidato', () => {
  const s = M.calcularScore(cand('1', 'X Y', { a: 10, b: 10 }), CONFIG);
  assert.equal(s.tecnico, 100);
  assert.deepEqual(s.pendentes, ['c', 'd', 's']);
});

test('score: nenhuma etapa aplicada dá técnico zero, sem erro', () => {
  const s = M.calcularScore(cand('1', 'X Y', {}), CONFIG, []);
  assert.equal(s.tecnico, 0);
  assert.equal(s.total, 0);
  assert.equal(s.pendentes.length, 5);
});

test('score: notas fora de 0–10 são limitadas; texto com vírgula vira número', () => {
  const s = M.calcularScore(cand('1', 'X Y', { a: 15, b: '5,5' }), CONFIG, ['a', 'b']);
  // a: 10 × 66,67%; b: 5,5 × 33,33%
  assert.equal(s.tecnico, 85);
});

test('bônus: checkbox aceita true/"true"/"sim"; mapa casa valor exibido, sem acento/maiúsculas e "5 - Excelente"', () => {
  const r = CONFIG.bonus[0].regra, m = CONFIG.bonus[1].regra;
  assert.equal(M.pontosBonus(r, true), 10);
  assert.equal(M.pontosBonus(r, 'true'), 10);
  assert.equal(M.pontosBonus(r, 'Sim'), 10);
  assert.equal(M.pontosBonus(r, false), 0);
  assert.equal(M.pontosBonus(r, null), 0);
  assert.equal(M.pontosBonus(m, '5'), 15);
  assert.equal(M.pontosBonus(m, 4), 10);
  assert.equal(M.pontosBonus(m, '5 - Excelente'), 15);
  assert.equal(M.pontosBonus(m, '2'), 0);
  assert.equal(M.pontosBonus({ tipo: 'mapa', pontos: { 'Ótimo': 7 } }, 'otimo'), 7);
});

test('situação: corte e faixa de avaliação (comparando o valor exibido com 1 casa)', () => {
  const cfg = Object.assign({}, CONFIG, { bonus: [], etapas: [{ id: 'a', nome: 'A', peso: 1 }] });
  const sit = (n) => M.calcularScore(cand('1', 'X', { a: n / 10 }), cfg, ['a']).situacao;
  assert.equal(sit(70), 'aprovado');
  assert.equal(sit(69.96), 'aprovado');
  assert.equal(sit(69.9), 'avaliar');
  assert.equal(sit(55), 'avaliar');
  assert.equal(sit(54.9), 'nao_recomendado');
  const padrao = M.calcularScore(cand('1', 'X', { a: 6 }), { etapas: cfg.etapas }, ['a']);
  assert.equal(padrao.situacao, 'avaliar', 'sem corte/faixa valem 70/55');
});

test('ranking: empate no total desempata pelo técnico e depois pelo nome', () => {
  const dados = {
    processo: { nome: 'P' },
    config: Object.assign({}, CONFIG, { etapas: [{ id: 'a', nome: 'A', peso: 1 }] }),
    candidatos: [
      cand('1', 'Zélia Teste', { a: 6 }, { grad: true }),    // 60 + 10 = 70
      cand('2', 'Bia Teste', { a: 7 }),                        // 70
      cand('3', 'Ana Teste', { a: 7 }),                        // 70
      cand('4', 'Caio Teste', { a: 9 })                        // 90
    ]
  };
  const r = M.montar(dados, { agora: AGORA });
  assert.deepEqual(r.ranking.linhas.map((l) => l.nome), ['Caio T.', 'Ana T.', 'Bia T.', 'Zélia T.']);
  assert.deepEqual(r.ranking.linhas.map((l) => l.posicao), [1, 2, 3, 4]);
});

// ---------------------------------------------------------------------------
// DISC, nomes e funil
// ---------------------------------------------------------------------------

test('aderência DISC', () => {
  assert.equal(M.aderenciaDisc('CD', 'CD', { nivel: 'alta' }), 'ideal');
  assert.equal(M.aderenciaDisc('CS', 'C', 'alta'), 'ideal', 'ideal de 1 letra: primeira letra igual');
  assert.equal(M.aderenciaDisc('CS', 'CD', 'alta'), 'boa');
  assert.equal(M.aderenciaDisc('C', 'CD', 'media'), 'boa');
  assert.equal(M.aderenciaDisc('DC', 'CD', 'alta'), 'media');
  assert.equal(M.aderenciaDisc('IC', 'CD', 'alta'), 'media');
  assert.equal(M.aderenciaDisc('IS', 'CD', 'alta'), 'baixa');
  assert.equal(M.aderenciaDisc('CD', 'CD', { nivel: 'baixa' }), 'indefinida', 'confiabilidade baixa');
  assert.equal(M.aderenciaDisc('', 'CD', 'alta'), 'indefinida');
  assert.equal(M.aderenciaDisc('CD', '', 'alta'), 'indefinida');
  assert.equal(M.aderenciaDisc('cd', 'cd', 'indisponivel'), 'ideal');
});

test('primeiroNome: primeiro nome + inicial do sobrenome, nunca o nome completo', () => {
  assert.equal(M.primeiroNome('Ana Paula Souza'), 'Ana P.');
  assert.equal(M.primeiroNome('maria da silva'), 'Maria S.');
  assert.equal(M.primeiroNome('Fábio'), 'Fábio');
  assert.equal(M.primeiroNome('  Élida   Órfão  '), 'Élida Ó.');
  assert.equal(M.primeiroNome(''), 'Sem nome');
  assert.equal(M.primeiroNome(null), 'Sem nome');
});

test('nomes curtos repetidos no mesmo processo são desempatados', () => {
  const dados = {
    config: Object.assign({}, CONFIG, { etapas: [{ id: 'a', nome: 'A', peso: 1 }] }),
    candidatos: [cand('1', 'Ana Paula Souza', { a: 9 }), cand('2', 'Ana Pereira Lima', { a: 8 })]
  };
  const nomes = M.montar(dados, { agora: AGORA }).ranking.linhas.map((l) => l.nome);
  assert.equal(new Set(nomes).size, 2, nomes.join(' / '));
  nomes.forEach((n) => assert.ok(!/Souza|Lima|Pereira/.test(n), n));
});

test('funil: conta por status, percentual com 1 casa, maior primeiro', () => {
  const lista = ['a', 'a', 'b', 'c', 'c', 'c', 'B'].map((s, i) => ({ id: String(i), status: s }));
  const f = M.funil(lista, [{ nome: 'c' }, { nome: 'b' }, { nome: 'a' }]);
  assert.equal(f.total, 7);
  assert.deepEqual(f.porStatus, [
    { status: 'c', qtd: 3, pct: 42.9 },
    { status: 'b', qtd: 2, pct: 28.6 },
    { status: 'a', qtd: 2, pct: 28.6 }
  ]);
  assert.deepEqual(M.funil([], []), { total: 0, porStatus: [] });
});

// ---------------------------------------------------------------------------
// Fixture completa
// ---------------------------------------------------------------------------

test('fixture: gera o relatório completo no formato do contrato', () => {
  const r = M.montar(copia(FIXTURE), { agora: AGORA });
  assert.equal(r.versao, 1);
  assert.equal(r.geradoEm, AGORA);
  assert.ok(!('clickupListId' in r.processo));
  assert.equal(r.processo.empresa, 'Cartório Exemplo de Boa Vista');
  assert.deepEqual(r.config, { perfilIdeal: 'CD', explicacaoPerfil: FIXTURE.config.explicacaoPerfil, corte: 70, faixaAvaliar: 55 });

  assert.ok(r.capa.titulo && r.capa.subtitulo);
  assert.deepEqual(r.capa.numeros.map((n) => n.valor), [40, 8, 3, 75]);

  assert.equal(r.sumario.recomendacao.nome, 'Ana E.');
  assert.equal(r.sumario.recomendacao.situacao, 'aprovado');
  assert.ok(r.sumario.leituras.length >= 2 && r.sumario.leituras.length <= 4);
  const titulos = r.sumario.leituras.map((l) => l.titulo).join(' | ');
  assert.match(titulos, /O DISC confirma a técnica/);
  assert.match(titulos, /Fábio E\. tem contraindicação em três instrumentos/);
  assert.match(titulos, /Helena H\..*não é confiável/);

  assert.equal(r.atracao.total, 40);
  assert.equal(r.atracao.porStatus[0].status, 'fora do perfil');
  assert.equal(r.atracao.porStatus.reduce((s, x) => s + x.qtd, 0), 40);
  assert.ok(r.atracao.pretensaoMedia > 0 && r.atracao.ultimoSalarioMedio > 0);
  assert.ok(r.atracao.idadeFaixas.length > 0);
  assert.ok(r.atracao.statusTrabalho.length > 0);

  assert.deepEqual(r.etapas.map((e) => [e.id, e.pendente, e.pesoNormalizado]),
    [['revisao', false, 40], ['redacao', false, 20], ['digitacao', false, 13.3], ['atencao', false, 26.7], ['simulacao', true, null]]);
  assert.equal(r.etapas[0].resultados.length, 8);
  assert.equal(r.etapas[4].resultados.length, 0);
  assert.ok(r.etapas[3].destaques.some((d) => d.titulo === 'A etapa não diferenciou o grupo'));
  assert.ok(r.etapas[0].destaques.some((d) => d.tipo === 'alerta'));

  assert.equal(r.disc.perfilIdeal, 'CD');
  assert.equal(r.disc.quadro.length, 8);
  assert.deepEqual(r.disc.quadro.filter((q) => q.aderencia === 'ideal').map((q) => q.nome), ['Bruna T.', 'Carla M.']);
  assert.equal(r.disc.quadro.find((q) => q.nome === 'Helena H.').aderencia, 'indefinida');
  assert.equal(r.disc.quadro.find((q) => q.nome === 'Fábio E.').aderencia, 'baixa');
  assert.ok(r.disc.achados.length >= 3);

  assert.equal(r.ranking.pesoPendente, 25);
  assert.deepEqual(r.ranking.formula.map((f) => f.pesoNormalizado), [40, 20, 13.3, 26.7, null]);
  assert.deepEqual(r.ranking.linhas.map((l) => [l.nome, l.total, l.situacao]), [
    ['Ana E.', 94, 'aprovado'],
    ['Bruna T.', 88.7, 'aprovado'],
    ['Carla M.', 72, 'aprovado'],
    ['Daniela F.', 69.7, 'avaliar'],
    ['Elisa A.', 67.3, 'avaliar'],
    ['Gabriela S.', 64.7, 'avaliar'],
    ['Fábio E.', 54, 'nao_recomendado'],
    ['Helena H.', 53.3, 'nao_recomendado']
  ]);
  const ana = r.ranking.linhas[0];
  assert.deepEqual(ana.notas, { revisao: 6, redacao: 7.5, digitacao: 6.5, atencao: 8, simulacao: null });
  assert.equal(ana.tecnico, 69);
  assert.equal(ana.bonus, 25);
  assert.equal(ana.disc, 'CS');

  assert.ok(r.encerramento.textoId && r.encerramento.proximosPassos.length >= 2);
  assert.match(r.textos[r.encerramento.proximosPassos[0]].texto, /simulação ao vivo/);
});

test('textos: todo textoId referenciado existe, é texto de regra e não sobra texto solto', () => {
  const casos = [copia(FIXTURE), { processo: {}, config: {}, candidatos: [] }, {}];
  // processo encerrado (sem etapa pendente) e um com notas faltando e sem DISC
  const fechado = copia(FIXTURE);
  fechado.candidatos.filter((c) => c.finalista).forEach((c, i) => { c.notas.simulacao = 9 - i; });
  casos.push(fechado);
  const furado = copia(FIXTURE);
  furado.candidatos[0].notas.redacao = null;
  furado.candidatos[1].disc = null;
  furado.candidatos.forEach((c) => { c.notas.atencao = c.finalista ? 5 + (c.nome.length % 5) : null; });
  casos.push(furado);
  casos.forEach((dados, n) => {
    const r = M.montar(dados, { agora: AGORA });
    const ids = idsReferenciados(r);
    assert.ok(ids.length > 0, 'caso ' + n);
    ids.forEach((id) => {
      const t = r.textos[id];
      assert.ok(t, 'caso ' + n + ': falta o texto ' + id);
      assert.equal(t.origem, 'regra');
      assert.equal(typeof t.texto, 'string');
      assert.ok(t.texto.trim().length > 10, id);
      assert.ok(!/undefined|NaN|null|\[object|\.\.(?!\.)|\s[,.]/.test(t.texto), 'caso ' + n + ' ' + id + ': ' + t.texto);
    });
    assert.deepEqual(Object.keys(r.textos).sort(), Array.from(new Set(ids)).sort(), 'caso ' + n + ': textos sem referência');
  });
  const furadoRel = M.montar(furado, { agora: AGORA });
  assert.ok(furadoRel.ranking.linhas.some((l) => l.incompleto));
  assert.ok(Object.values(furadoRel.textos).some((t) => /contaram como zero|contou como zero/.test(t.texto)));
  assert.ok(Object.values(furadoRel.textos).some((t) => /Enviar o teste DISC/.test(t.texto)));
});

test('privacidade: nenhum dado sensível, contato ou nome completo sai no relatório', () => {
  const dados = copia(FIXTURE);
  dados.candidatos.forEach((c, i) => {
    Object.assign(c, {
      telefone: '(95) 98888-77' + String(i).padStart(2, '0'), email: 'pessoa' + i + '@exemplo.com',
      sexo: 'Feminino', estadoCivil: 'Casada', filhos: 'Sim', religiao: 'Qualquer', saude: 'Asma', antecedentes: 'Nada consta'
    });
  });
  const r = M.montar(dados, { agora: AGORA });
  const json = JSON.stringify(r);
  ['98888', '@exemplo.com', 'Feminino', 'Casada', 'Asma', 'Nada consta', 'Qualquer'].forEach((s) => assert.ok(!json.includes(s), s));
  FIXTURE.candidatos.forEach((c) => assert.ok(!json.includes(c.nome), 'nome completo: ' + c.nome));
  const PROIBIDAS = /\b(sexo|genero|estado civil|filhos?|religi\w*|gravid\w*|etnia|raca|cor da pele|orientacao|deficien\w*|doenca|saude|antecedentes?|criminal|idades?|idos[oa]s?|jovens?|anos de vida|casad[oa]s?|solteir[oa]s?)\b/;
  Object.keys(r.textos).forEach((id) => {
    const t = r.textos[id].texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    assert.ok(!PROIBIDAS.test(t), id + ': ' + r.textos[id].texto);
  });
  r.ranking.linhas.forEach((l) => assert.deepEqual(Object.keys(l).sort(),
    ['aderencia', 'analiseTextoId', 'bonus', 'disc', 'incompleto', 'nome', 'notas', 'posicao', 'situacao', 'tecnico', 'total']));
});

test('determinístico: mesma entrada, mesma saída; sem data, geradoEm fica nulo', () => {
  const a = M.montar(copia(FIXTURE), { agora: AGORA });
  const b = M.montar(copia(FIXTURE), { agora: new Date(AGORA) });
  assert.deepEqual(a, b);
  assert.equal(M.montar(copia(FIXTURE)).geradoEm, null);
  assert.equal(M.montar(copia(FIXTURE), { geradoEm: AGORA }).geradoEm, AGORA, 'aceita geradoEm (servidor)');
  const fonte = fs.readFileSync(path.join(RAIZ, 'js', 'relatorio-motor.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/Date\.now|new Date\(|Math\.random/.test(fonte));
});

test('motor é ES5 puro (roda no Apps Script) e não depende de nada', () => {
  const fonte = fs.readFileSync(path.join(RAIZ, 'js', 'relatorio-motor.js'), 'utf8');
  const codigo = fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/'(?:[^'\\\n]|\\.)*'/g, "''");
  assert.ok(!/\b(let|const|class|import|export|require)\b/.test(codigo), 'sem let/const/class/import/require');
  assert.ok(!/=>|`|\.\.\.[\w[]/.test(codigo), 'sem arrow, template ou spread');
  assert.ok(!/\b(Object\.assign|Array\.from|\.includes\(|\.find\(|\.findIndex\(|Promise|Symbol|Map\(|Set\()/.test(codigo), 'sem APIs ES6');
});

test('apps-script/RelatorioMotor.gs é a cópia exata do motor e define DISC_RELATORIO no escopo global', () => {
  const gs = fs.readFileSync(path.join(RAIZ, 'apps-script', 'RelatorioMotor.gs'), 'utf8');
  const fonte = fs.readFileSync(path.join(RAIZ, 'js', 'relatorio-motor.js'), 'utf8');
  assert.match(gs, /^\/\/ ARQUIVO GERADO AUTOMATICAMENTE — NÃO EDITE\./);
  assert.ok(gs.endsWith(fonte), 'desatualizado: rode npm run montar:apps-script');
  const ctx = vm.createContext({});
  vm.runInContext(gs, ctx, { filename: 'RelatorioMotor.gs' });
  const rel = vm.runInContext('DISC_RELATORIO.montar(' + JSON.stringify(FIXTURE) + ', { geradoEm: "' + AGORA + '" })', ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(rel)), M.montar(copia(FIXTURE), { agora: AGORA }));
});
