'use strict';
// Relatório Completo Avançado: tendências (fórmula estável e monotônica) e montar() com cada combinação que tem conteúdo.
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../js/disc-profundo.js');
const DADOS = require('../js/disc-profundo-dados.js');
const CB = require('../js/disc-combinacoes.js');
const DATA = require('../js/disc-data.js');

const LETRAS = ['D', 'I', 'S', 'C'];
// Resultado que cai na combinação pedida (regra de DISC_COMBINACOES.codigo).
function resultadoPara(cod) {
  const p = { D: 20, I: 20, S: 20, C: 20 };
  if (cod.length === 1) { p[cod] = 40; return { percentuais: p, codigo: cod + LETRAS.filter((l) => l !== cod)[0] }; }
  const outros = LETRAS.filter((l) => l !== cod[0] && l !== cod[1]);
  p[cod[0]] = 30; p[cod[1]] = 28; p[outros[0]] = 21; p[outros[1]] = 21;
  return { percentuais: p, codigo: cod };
}
const EXIGIDO = { percentuais: { D: 18, I: 20, S: 32, C: 30 }, codigo: 'SC' };
const PROIBIDOS = /compet[eê]ncia(s)? comportamenta|c[eé]rebro|neuro|ansiedade|depress|diagn[oó]stic|autoestima|Notus/i;

test('tendências: 16, nomes, fatores de origem e faixas', () => {
  const t = P.tendencias({ D: 34, I: 30, S: 18, C: 18 });
  assert.equal(t.length, 16);
  assert.equal(new Set(t.map((x) => x.chave)).size, 16);
  for (const l of LETRAS) assert.equal(t.filter((x) => x.fator === l).length, 4);
  for (const x of t) {
    assert.ok(Number.isInteger(x.valor) && x.valor >= 0 && x.valor <= 100);
    assert.equal(x.faixa, x.valor < P.LIMITE_BAIXA ? 'baixa' : x.valor < P.LIMITE_ALTA ? 'media' : 'alta');
    assert.ok(x.frase && x.nome);
  }
  assert.ok(!t.some((x) => /compet[eê]ncia/i.test(x.nome + x.frase)));
});

test('tendências: perfil achatado = 50 em todas; inválido = null', () => {
  assert.ok(P.tendencias({ D: 25, I: 25, S: 25, C: 25 }).every((x) => x.valor === 50 && x.faixa === 'media'));
  assert.equal(P.tendencias(null), null);
  assert.equal(P.tendencias({ D: 25, I: 25, S: 25 }), null);
  assert.equal(P.tendencias({ D: 25, I: 25, S: 25, C: 'x' }), null);
});

test('tendências: perfis extremos puxam as do fator principal para o alto e as do oposto para baixo', () => {
  for (const l of LETRAS) {
    const p = { D: 20, I: 20, S: 20, C: 20 }; p[l] = 40;
    const t = P.tendencias(p);
    const doFator = t.filter((x) => x.fator === l), outras = t.filter((x) => x.fator !== l);
    assert.ok(doFator.every((x) => x.valor >= 65), l + ': tendências do fator principal altas');
    assert.ok(Math.min(...doFator.map((x) => x.valor)) > Math.max(...outras.map((x) => x.valor)), l);
  }
  const t = P.tendencias({ D: 40, I: 40, S: 10, C: 10 });
  assert.ok(t.filter((x) => x.fator === 'S' || x.fator === 'C').every((x) => x.valor <= 35));
});

test('tendências: monotônicas (subir um fator nunca baixa tendência com peso positivo nele) e estáveis', () => {
  for (const x of P.TENDENCIAS) {
    for (const l of LETRAS) {
      const w = x.pesos[l] || 0;
      let antes = null;
      for (let v = 10; v <= 40; v += 2) {
        const p = { D: 25, I: 25, S: 25, C: 25 }; p[l] = v;
        const val = P.tendencias(p).find((y) => y.chave === x.chave).valor;
        if (antes !== null) {
          if (w > 0) assert.ok(val >= antes, x.chave + ' sobe com ' + l);
          if (w < 0) assert.ok(val <= antes, x.chave + ' desce com ' + l);
          if (w === 0) assert.equal(val, antes);
        }
        antes = val;
      }
    }
  }
  const p = { D: 31.2, I: 27.6, S: 22.4, C: 18.8 };
  assert.deepEqual(P.tendencias(p), P.tendencias({ ...p }));
});

test('conteúdo: as 16 combinações têm dados', () => {
  assert.deepEqual(Object.keys(DADOS).sort(), CB.CODIGOS.slice().sort());
});

for (const cod of Object.keys(DADOS)) {
  test('montar ' + cod + ': capítulos na ordem, combinação certa, sem termos proibidos nem dados sensíveis', () => {
    const r = resultadoPara(cod);
    assert.equal(CB.codigo(r.percentuais, r.codigo), cod);
    const m = P.montar(r, 'Ana Maria Souza', { data: DATA, emitidoEm: '2026-10-06T12:00:00Z' });
    assert.ok(m);
    assert.equal(m.variante, 'avancado');
    assert.equal(m.nome, 'Ana');
    assert.equal(m.combinacao.codigo, cod);
    assert.equal(m.combinacao.puro, cod.length === 1);
    assert.deepEqual(m.capitulos.map((c) => c.id), ['retrato', 'intensidade', 'tendencias', 'mapa', 'travas', 'dia_a_dia', 'decisao',
      'aprendizado', 'mudanca', 'tempo', 'comunicacao', 'conflito', 'pressao', 'motivacao', 'lideranca', 'equipe', 'relacoes',
      'ambientes', 'pontos_cegos', 'plano']);
    assert.deepEqual(m.capitulos.map((c) => c.numero), m.capitulos.map((c, i) => i + 1));
    const c = Object.fromEntries(m.capitulos.map((x) => [x.id, x]));
    assert.deepEqual(c.retrato.paragrafos, DADOS[cod].retrato);
    assert.equal(c.tendencias.tendencias.length, 16);
    assert.equal(c.comunicacao.manual.colunas.length, 4);
    assert.equal(c.pressao.etapas.length, 3);
    assert.deepEqual(c.relacoes.perfis.map((x) => x.letra), LETRAS);
    assert.ok(c.plano.habitos.length >= 5 && c.plano.perguntas.length >= 6);
    assert.deepEqual(c.plano.etapas.map((e) => e.chave), ['d30', 'd60', 'd90']);
    assert.ok(c.travas.itens.length >= 2, 'travas reaproveitadas de relatorio-pessoa');
    assert.equal(m.mapa.exigido, null);
    assert.equal(m.esticando, null);
    for (const x of m.capitulos) for (const d of x.dimensoes || []) assert.ok(d && d.texto && d.itens.length >= 3, cod + ' ' + x.id);
    const json = JSON.stringify(m);
    assert.deepEqual(JSON.parse(json), m);
    assert.doesNotMatch(json, PROIBIDOS);
    assert.doesNotMatch(json, /Maria|Souza|@|\d{4,}-\d{4}/, 'só o primeiro nome; nada de e-mail ou telefone');
  });
}

test('montar com a Parte 2: capítulo "Onde você está se esticando" (+ plano de 90 dias) e mapa com o exigido', () => {
  const cod = Object.keys(DADOS)[0];
  const m = P.montar(resultadoPara(cod), 'Bia', { exigido: EXIGIDO });
  const ids = m.capitulos.map((c) => c.id);
  assert.equal(ids.length, 21);
  assert.deepEqual(ids.slice(-2), ['esticando', 'plano']);
  const est = m.capitulos.find((c) => c.id === 'esticando');
  assert.ok(est.itens.length && est.plano90 && est.plano90.itens.length === 4);
  assert.ok(m.mapa.exigido && typeof m.mapa.exigido.ritmo === 'number');
  assert.equal(m.temParte2, true);
});

test('montar devolve null sem dados da combinação ou com resultado inválido', () => {
  assert.equal(P.montar(resultadoPara('DI'), 'Ana', { dados: {} }), null);
  assert.equal(P.montar(resultadoPara('DI'), 'Ana', { dados: { DS: DADOS.DS || {} } }), null);
  assert.equal(P.montar(null, 'Ana'), null);
  assert.equal(P.montar({ percentuais: { D: 1 }, codigo: 'DI' }, 'Ana'), null);
  assert.equal(P.temDados('XX'), false);
});

test('secoesDocumento: capítulos como seções genéricas para o painel', () => {
  const m = P.montar(resultadoPara('SC'), 'Ana', {});
  const s = P.secoesDocumento(m);
  assert.ok(s.length >= 15);
  assert.ok(s.every((x) => x.id.startsWith('av_') && x.titulo));
  assert.ok(!s.some((x) => x.id === 'av_mapa' || x.id === 'av_intensidade'));
  assert.deepEqual(P.secoesDocumento(null), []);
});

test('render (DISC_APP.relatorioPessoaHtml com avancado): capa, sumário, radar, escapa o nome', () => {
  const A = require('../js/app.js');
  const m = P.montar(resultadoPara('IS'), '<b>Zé</b>', { exigido: EXIGIDO });
  const h = A.relatorioPessoaHtml(m, '', { avancado: true, botaoPdf: 'Imprimir' });
  assert.match(h, /class="relatorio-pessoa relatorio-avancado"/);
  assert.equal((h.match(/class="av-sumario-link"/g) || []).length, 21);
  assert.match(h, /<svg viewBox="0 0 340 340" role="img"/);
  assert.match(h, /data-secao="plano90"/);
  assert.doesNotMatch(h, /<b>Zé/);
  assert.match(h, /gsc-logo-negativo\.svg/);
  assert.doesNotMatch(h, /Notus|icone\.svg/);
  // Sem avancado (ou com dados do relatório antigo) nada muda
  const R = require('../js/relatorio-pessoa.js');
  const antigo = R.montar(resultadoPara('IS'), 'Ana', DATA);
  assert.doesNotMatch(A.relatorioPessoaHtml(antigo, '', { avancado: true }), /relatorio-avancado/);
});

test('painel: modelo "Pessoa · completo" usa os capítulos do avançado quando DISC_PROFUNDO está carregado; simples não muda', () => {
  const M = require('../js/relatorio-modelos.js');
  const ent = { pessoa: { nome: 'Carla Dias', resultado: resultadoPara('CD') } };
  const antes = M.pessoa(ent, { geradoEm: '2026-10-06T00:00:00Z' });
  assert.equal(antes.avancado, undefined);
  const av = M.pessoa(ent, { geradoEm: '2026-10-06T00:00:00Z', profundo: P });
  assert.deepEqual(av.avancado, { combinacao: 'CD', capitulos: 20 });
  assert.ok(av.secoes.length >= 15 && av.secoes.every((s) => /^av_/.test(s.id)));
  const simples = M.pessoa(ent, { variante: 'simples', profundo: P });
  assert.equal(simples.avancado, undefined);
  const V = require('../js/relatorio-view.js');
  const html = V.montarHtml(av);
  assert.match(html, /Como falar comigo/);
  assert.match(html, /Seu retrato/);
});
