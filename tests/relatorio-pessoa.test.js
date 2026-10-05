'use strict';
// Relatório DISC "modelo pessoa" (desenvolvimento da própria pessoa): dados puros e serializáveis.
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../js/relatorio-pessoa.js');
const DATA = require('../js/disc-data.js');
const S = require('../js/scoring.js');

const REL = { percentuais: { D: 30, I: 10, S: 20, C: 40 }, codigo: 'CD' };

test('dadosDoResultado valida percentuais e código', () => {
  assert.deepEqual(R.dadosDoResultado(REL.percentuais, 'cd'), REL);
  assert.equal(R.dadosDoResultado(null, 'CD'), null);
  assert.equal(R.dadosDoResultado({ D: 30, I: 10, S: 20 }, 'CD'), null);
  assert.equal(R.dadosDoResultado({ D: 30, I: 10, S: 20, C: 140 }, 'CD'), null);
  assert.equal(R.dadosDoResultado(REL.percentuais, 'CC'), null);
  assert.equal(R.dadosDoResultado(REL.percentuais, 'XD'), null);
  assert.equal(R.montar(null, 'Ana'), null);
  assert.equal(R.montar({ percentuais: REL.percentuais, codigo: 'C' }, 'Ana'), null);
});

test('montar: perfil, 4 fatores, seções na ordem e aviso', () => {
  const d = R.montar(REL, '  Bruna  Lima ', DATA);
  assert.equal(d.versao, 1);
  assert.equal(d.nome, 'Bruna');
  assert.equal(d.codigo, 'CD');
  assert.deepEqual(d.primario, { letra: 'C', nome: 'Conformidade', rotulo: 'Cauteloso' });
  assert.deepEqual(d.secundario, { letra: 'D', nome: 'Dominância', rotulo: 'Dominante' });
  assert.ok(d.frase.length > 20 && d.frase.endsWith('.'));
  assert.deepEqual(d.fatores.map((f) => [f.letra, f.nome, f.pct]),
    [['D', 'Dominância', 30], ['I', 'Influência', 10], ['S', 'Estabilidade', 20], ['C', 'Conformidade', 40]]);
  d.fatores.forEach((f) => assert.ok(f.descricao));
  assert.deepEqual(d.secoes.map((s) => s.id), ['fortes', 'atencao', 'pressao', 'comunicacao', 'plano']);
  const sec = Object.fromEntries(d.secoes.map((s) => [s.id, s]));
  assert.deepEqual(sec.fortes.caracteristicas, DATA.perfis.C.positivos);
  assert.ok(sec.fortes.itens.length >= 3);
  assert.ok(sec.atencao.itens.every((it) => /quando exagerad/i.test(it.texto)), 'tom construtivo');
  assert.deepEqual(sec.pressao.sinais, DATA.perfis.C.sobPressao);
  assert.ok(sec.pressao.itens.length >= 3);
  assert.deepEqual(sec.comunicacao.perfis.map((p) => p.letra), ['D', 'I', 'S'], 'os 3 outros perfis');
  sec.comunicacao.perfis.forEach((p) => assert.equal(p.texto, R.COMUNICACAO[p.letra]));
  assert.ok(sec.plano.itens.length >= 3 && sec.plano.itens.length <= 5);
  assert.deepEqual([...new Set(sec.plano.itens.map((i) => i.prazo))].sort(), ['30 dias', '60 dias', '90 dias']);
  // Hábito do fator menos presente (I = 10%)
  assert.ok(sec.plano.itens.some((i) => /Influência/.test(i.texto)));
  assert.match(d.aviso, /estilo de comportamento/);
  assert.match(d.aviso, /certo ou errado/);
  // Serializável e sem nada de empresa/vaga/aderência
  const json = JSON.stringify(d);
  assert.deepEqual(JSON.parse(json), d);
  assert.doesNotMatch(json, /vaga|aderência|nota final|empresa|liderança/i);
});

test('montar não altera DISC_DATA e funciona para todos os perfis', () => {
  const antes = JSON.stringify(DATA);
  const d = R.montar(REL, 'Ana', DATA);
  d.secoes[0].caracteristicas.push('X');
  d.secoes[4].itens[0].titulo = 'mudado';
  assert.equal(JSON.stringify(DATA), antes);
  assert.notEqual(R.montar(REL, 'Ana', DATA).secoes[4].itens[0].titulo, 'mudado');
  const letras = ['D', 'I', 'S', 'C'];
  letras.forEach((a) => letras.forEach((b) => {
    if (a === b) return;
    const p = { D: 10, I: 10, S: 10, C: 10 }; p[a] = 40; p[b] = 30; letras.filter((l) => l !== a && l !== b).forEach((l, k) => { p[l] = k ? 10 : 20; });
    const r = R.montar({ percentuais: p, codigo: a + b }, '', DATA);
    assert.equal(r.primario.letra, a);
    assert.equal(r.nome, '');
    r.secoes.forEach((s) => assert.ok(s.titulo && s.intro));
  }));
  // A partir de respostas reais
  const res = S.calcular(Array.from({ length: 25 }, () => ({ D: 4, I: 3, S: 2, C: 1 })));
  assert.equal(R.montar(R.dadosDoResultado(res.percentuais, res.codigo), 'José', DATA).codigo, 'DI');
});

/* ------------------------------------------------------------------ rodada 3: aprofundamento, régua, combinação, simples */
const IN = require('../js/disc-intensidade.js');
const CB = require('../js/disc-combinacoes.js');
const LETRAS4 = ['D', 'I', 'S', 'C'];
const SENSIVEIS = /(^|[^\p{L}])(sexo|idade|gênero|autoestima|cérebro|cerebral|neuro\p{L}*|emociona\p{L}*|saúde|doença|ansiedade|trauma|medos?)([^\p{L}]|$)/iu;
const MERCADO = ['Executor', 'Comunicador', 'Planejador', 'Analista', 'Inovador', 'Empreendedor', 'Comandante', 'Aconselhador',
  'Especialista', 'Protetor', 'Solucionador', 'Competidor', 'Articulador', 'Julgador', 'Organizador', 'Integrador', 'Influenciador',
  'Inventivo', 'Motivador', 'Vendedor', 'Diplomata', 'Atendente', 'Professoral', 'Técnico', 'Estrategista', 'Controlador', 'Administrador'];
const IDS_APROF = ['combinacao', 'intensidade', 'aprendizado', 'decisao', 'mudancas', 'estilo_comunicacao', 'organizacao', 'necessidades', 'desmotiva', 'valoriza'];

// Perfis de exemplo para as 12 duplas, em dois níveis de intensidade.
function perfis() {
  const out = [];
  LETRAS4.forEach((a) => LETRAS4.forEach((b) => {
    if (a === b) return;
    const resto = LETRAS4.filter((l) => l !== a && l !== b);
    const forte = { [a]: 38, [b]: 30, [resto[0]]: 18, [resto[1]]: 14 };
    const suave = { [a]: 28, [b]: 26, [resto[0]]: 24, [resto[1]]: 22 };
    out.push({ percentuais: forte, codigo: a + b }, { percentuais: suave, codigo: a + b });
  }));
  return out;
}
function textos(obj) {
  const out = [];
  (function walk(x) {
    if (typeof x === 'string') out.push(x);
    else if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === 'object') Object.values(x).forEach(walk);
  })(obj);
  return out;
}

test('montar: campos novos (combinação, régua, aprofundamento) sem quebrar o formato antigo', () => {
  const d = R.montar(REL, 'Bruna', DATA);
  assert.deepEqual(d.secoes.map((s) => s.id), ['fortes', 'atencao', 'pressao', 'comunicacao', 'plano'], 'secoes antigas intactas');
  assert.deepEqual(d.combinacao, CB.combinacao(REL.percentuais, 'CD'));
  assert.equal(d.combinacao.nome, CB.nome('CD').nome);
  assert.deepEqual(d.intensidade, IN.regua(REL.percentuais));
  assert.deepEqual(d.aprofundamento.map((s) => s.id), IDS_APROF);
  assert.equal(d.esticando, null, 'sem exigido, sem a seção');
  d.aprofundamento.forEach((s) => {
    assert.ok(s.titulo && s.intro, s.id);
    assert.ok(Array.isArray(s.itens) && s.itens.length >= 1, s.id);
    s.itens.forEach((it) => assert.ok(it.titulo && it.texto, s.id));
  });
  const ap = Object.fromEntries(d.aprofundamento.map((s) => [s.id, s]));
  assert.equal(ap.combinacao.nome, d.combinacao.nome);
  assert.match(ap.combinacao.titulo, /Arquiteto/);
  assert.equal(ap.intensidade.fatores.length, 4);
  assert.match(ap.intensidade.itens[1].titulo, /Influência: muito baixa \(10%\)/);
  // Decisão: ritmo = (D+I)−(S+C) = 40−60 = −20 -> cuidadoso; base: dados (1,5×40) > pessoas > intuição
  assert.equal(ap.decisao.ritmo, 'cuidadoso');
  assert.equal(ap.decisao.ritmoValor, -20);
  assert.equal(ap.decisao.base, 'dados');
  // Desmotiva inclui o fator menos presente (I = 10%, muito baixa)
  assert.ok(ap.desmotiva.itens.some((i) => /Influência aparece pouco/.test(i.texto)));
  // Compatível: 3º argumento pode ser omitido ou ser as opções
  assert.deepEqual(R.montar(REL, 'Bruna'), d);
  assert.deepEqual(R.montar(REL, 'Bruna', {}), d);
  assert.deepEqual(R.montar(REL, 'Bruna', DATA, {}), d);
});

test('montar: textos específicos por primário + secundário, sem frases repetidas entre seções', () => {
  const primarios = {};
  perfis().forEach((rel) => {
    const d = R.montar(rel, 'Ana', DATA);
    assert.equal(d.combinacao.codigo.charAt(0), rel.codigo.charAt(0));
    const todos = d.secoes.flatMap((s) => (s.itens || []).map((i) => i.texto)).concat(
      d.aprofundamento.filter((s) => s.id !== 'combinacao' && s.id !== 'intensidade').flatMap((s) => s.itens.map((i) => i.texto)));
    assert.equal(new Set(todos).size, todos.length, rel.codigo + ': texto repetido entre seções');
    const titulos = d.aprofundamento.filter((s) => s.id !== 'intensidade').flatMap((s) => s.itens.map((i) => i.titulo));
    assert.equal(new Set(titulos).size, titulos.length, rel.codigo + ': título repetido');
    // O secundário aparece: cada seção com item do segundo fator cita o nome dele
    const nomeSec = DATA.perfis[rel.codigo.charAt(1)].nome;
    ['aprendizado', 'mudancas', 'estilo_comunicacao', 'organizacao', 'necessidades'].forEach((id) => {
      const s = d.aprofundamento.find((x) => x.id === id);
      assert.ok(s.itens.some((i) => i.texto.includes(nomeSec)), rel.codigo + ' ' + id);
    });
    const chave = rel.codigo.charAt(0);
    primarios[chave] = primarios[chave] || new Set();
    primarios[chave].add(JSON.stringify(d.aprofundamento.map((s) => s.itens)));
  });
  // Mesmo primário com secundários/intensidades diferentes gera conteúdo diferente
  Object.values(primarios).forEach((s) => assert.ok(s.size >= 3));
  // Intensidade muda o conteúdo: perfil forte × suave da mesma dupla
  const [forte, suave] = perfis();
  const a = R.montar(forte, '', DATA), b = R.montar(suave, '', DATA);
  assert.notDeepEqual(a.intensidade.map((f) => f.faixa), b.intensidade.map((f) => f.faixa));
  assert.notDeepEqual(a.aprofundamento.find((s) => s.id === 'intensidade').itens, b.aprofundamento.find((s) => s.id === 'intensidade').itens);
  assert.notEqual(a.aprofundamento.find((s) => s.id === 'decisao').ritmo, b.aprofundamento.find((s) => s.id === 'decisao').ritmo);
});

test('montar e montarSimples: sem termos sensíveis, sem nomes do mercado, sem empresa/vaga; determinísticos', () => {
  perfis().forEach((rel) => {
    [R.montar(rel, 'Ana', DATA), R.montarSimples(rel, 'Ana', DATA)].forEach((d) => {
      const novos = d.aprofundamento ? textos([d.combinacao, d.intensidade, d.aprofundamento]) : textos(d);
      novos.forEach((t) => {
        assert.doesNotMatch(t, SENSIVEIS, t);
        MERCADO.forEach((m) => assert.ok(!t.includes(m), rel.codigo + ' usa ' + m + ': ' + t));
      });
      assert.doesNotMatch(JSON.stringify(d), /vaga|aderência|nota final|empresa|liderança/i);
    });
    assert.deepEqual(R.montar(rel, 'Ana', DATA), R.montar(rel, 'Ana', DATA));
  });
});

test('montarSimples: versão curta com frase, 4 fatores com faixa, 3 forças, 3 cuidados, 3 hábitos', () => {
  const s = R.montarSimples(REL, ' Bruna Lima', DATA);
  assert.equal(s.variante, 'simples');
  assert.equal(s.nome, 'Bruna');
  assert.equal(s.codigo, 'CD');
  assert.equal(s.frase, R.montar(REL, '', DATA).frase);
  assert.equal(s.combinacao.nome, CB.nome('CD').nome);
  assert.deepEqual(s.fatores.map((f) => [f.letra, f.pct, f.faixa]), [['D', 30, 'alta'], ['I', 10, 'muito_baixa'], ['S', 20, 'baixa'], ['C', 40, 'muito_alta']]);
  s.fatores.forEach((f) => assert.ok(f.rotulo && f.resumo && f.nome));
  assert.equal(s.forcas.length, 3);
  assert.equal(s.cuidados.length, 3);
  assert.ok(s.cuidados.every((c) => /quando exagerad/i.test(c.texto)));
  assert.equal(s.habitos.length, 3);
  assert.ok(s.habitos.every((h) => h.prazo && h.titulo && h.texto));
  assert.ok(s.habitos.some((h) => /Influência/.test(h.texto)), 'hábito do fator menos presente');
  assert.equal(s.esticando, null);
  assert.ok(s.aviso.length < 150);
  assert.equal(s.secoes, undefined, 'curto: sem as seções longas');
  assert.ok(JSON.stringify(s).length < JSON.stringify(R.montar(REL, 'Bruna', DATA)).length / 3, 'bem mais curto que o completo');
  assert.equal(R.montarSimples(null, 'Ana'), null);
  assert.equal(R.montarSimples({ percentuais: REL.percentuais, codigo: 'CC' }), null);
});

test('Onde você está se esticando: integra com DISC_EXIGIDO (string de 40 dígitos ou resultado)', () => {
  const EX = require('../js/disc-exigido.js');
  const nat = { percentuais: { D: 38, I: 30, S: 16, C: 16 }, codigo: 'DI' };
  const str = '1234'.repeat(10); // exigido: D 10, I 20, S 30, C 40
  const d = R.montar(nat, 'Ana', DATA, { exigido: str });
  const est = d.aprofundamento[d.aprofundamento.length - 1];
  assert.equal(est.id, 'esticando');
  assert.deepEqual(d.esticando, est);
  assert.equal(est.titulo, 'Onde você está se esticando');
  const a = EX.adaptacao(nat.percentuais, EX.calcular(str).percentuais);
  assert.equal(est.indice, a.indice);
  assert.equal(est.faixa, a.faixa);
  assert.deepEqual(est.porFator, a.porFator);
  assert.equal(est.maisCobrado, 'C');
  assert.equal(est.menosUsado, 'D');
  assert.deepEqual(est.itens.map((i) => i.texto), a.textos.pessoa);
  est.itens.forEach((i) => assert.ok(i.titulo));
  assert.match(est.itens[0].titulo, /^Esforço de adaptação/);
  // Também aceita o resultado já calculado e funciona na versão simples
  assert.deepEqual(R.montar(nat, 'Ana', DATA, { exigido: EX.calcular(str) }).esticando.porFator, a.porFator);
  const s = R.montarSimples(nat, 'Ana', DATA, { exigido: str });
  assert.equal(s.esticando.indice, a.indice);
  assert.equal(s.esticando.texto, a.textos.pessoa[0]);
  // Exigido inválido: seção omitida, sem erro
  assert.equal(R.montar(nat, 'Ana', DATA, { exigido: '123' }).esticando, null);
  assert.equal(R.montar(nat, 'Ana', DATA, { exigido: { percentuais: null } }).esticando, null);
  assert.deepEqual(R.montar(nat, 'Ana', DATA, { exigido: '123' }).aprofundamento.map((x) => x.id), IDS_APROF);
});
