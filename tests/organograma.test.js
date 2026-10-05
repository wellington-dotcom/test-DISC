'use strict';
// Organograma corporativo (js/organograma.js): estrutura, layout puro, mover (ciclo, topoIds) e HTML estático.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ORG = require('../js/organograma.js');

const P = (id, extra) => Object.assign({ id, nome: 'Pessoa ' + id, cargo: 'Cargo ' + id, codigo: 'DI' }, extra || {});
const L = (de, para) => ({ de, para, tipo: 'lidera' });

// 7 pessoas em 3 níveis + 2 sem posição.
function exemplo() {
  return {
    pessoas: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'].map((x) => P(x)),
    relacoes: [L('a', 'b'), L('a', 'c'), L('b', 'd'), L('b', 'e'), L('c', 'f'), L('c', 'g'), { de: 'b', para: 'c', tipo: 'direto' }]
  };
}

function semSobreposicao(nos, folga) {
  for (let i = 0; i < nos.length; i++) {
    for (let j = i + 1; j < nos.length; j++) {
      const a = nos[i], b = nos[j];
      const separados = a.x + a.w + folga <= b.x || b.x + b.w + folga <= a.x || a.y + a.h + folga <= b.y || b.y + b.h + folga <= a.y;
      assert.ok(separados, 'cartões ' + a.id + ' e ' + b.id + ' se sobrepõem');
    }
  }
}

function centralizado(lay) {
  const por = {};
  lay.nos.forEach((n) => { por[n.id] = n; });
  const filhosDe = {};
  lay.nos.forEach((n) => { if (n.pai != null) (filhosDe[n.pai] = filhosDe[n.pai] || []).push(n); });
  Object.keys(filhosDe).forEach((pai) => {
    const fs2 = filhosDe[pai];
    const p = por[pai];
    const cx = p.x + p.w / 2;
    const xs = fs2.map((f) => f.x + f.w / 2);
    const meio = (Math.min(...xs) + Math.max(...xs)) / 2;
    assert.ok(Math.abs(cx - meio) < 0.01, 'líder ' + pai + ' centralizado sobre os liderados (' + cx + ' x ' + meio + ')');
    fs2.forEach((f) => assert.ok(f.y >= p.y + p.h, 'liderado ' + f.id + ' abaixo do líder'));
  });
}

test('estrutura: raízes, filhos e sem posição', () => {
  const e = ORG.estrutura(exemplo());
  assert.deepEqual(e.raizes, ['a']);
  assert.deepEqual(e.filhos.a, ['b', 'c']);
  assert.deepEqual(e.sem, ['h', 'i']);
  assert.equal(e.colegas.length, 1);
  const arv = ORG.arvore(exemplo());
  assert.deepEqual(arv.semPosicao, ['h', 'i']);
  assert.equal(arv.raizes[0].filhos[0].filhos.length, 2);
});

test('layout: 3 níveis sem sobreposição, líder centralizado, linhas em ângulo reto', () => {
  const lay = ORG.layout(ORG.arvore(exemplo()));
  assert.equal(lay.nos.length, 7);
  assert.equal(lay.arestas.length, 6);
  semSobreposicao(lay.nos, 1);
  centralizado(lay);
  const niveis = new Set(lay.nos.map((n) => n.y));
  assert.equal(niveis.size, 3);
  lay.arestas.forEach((a) => {
    for (let i = 1; i < a.pontos.length; i++) {
      const [x0, y0] = a.pontos[i - 1], [x1, y1] = a.pontos[i];
      assert.ok(x0 === x1 || y0 === y1, 'segmento reto (horizontal ou vertical)');
    }
  });
  assert.ok(lay.largura >= Math.max(...lay.nos.map((n) => n.x + n.w)));
  assert.ok(lay.altura >= Math.max(...lay.nos.map((n) => n.y + n.h)));
  assert.ok(Math.min(...lay.nos.map((n) => n.x)) >= 0);
  // Determinístico.
  assert.deepEqual(ORG.layout(ORG.arvore(exemplo())), lay);
});

test('layout: subárvores desiguais e muitos liderados (empilhados) sem sobreposição', () => {
  const pessoas = [P('r')], relacoes = [];
  for (let i = 0; i < 4; i++) { pessoas.push(P('m' + i)); relacoes.push(L('r', 'm' + i)); }
  for (let i = 0; i < 9; i++) { pessoas.push(P('x' + i)); relacoes.push(L('m0', 'x' + i)); }      // 9 folhas: pilha
  for (let i = 0; i < 3; i++) { pessoas.push(P('y' + i)); relacoes.push(L('m2', 'y' + i)); pessoas.push(P('z' + i)); relacoes.push(L('y' + i, 'z' + i)); }
  const lay = ORG.layout(ORG.arvore({ pessoas, relacoes }));
  assert.equal(lay.nos.length, pessoas.length);
  semSobreposicao(lay.nos, 1);
  // Pilha: líder centralizado sobre as duas colunas; cada folha ligada por um fio que sai do centro do líder.
  const m0 = lay.nos.find((n) => n.id === 'm0');
  const folhas = lay.nos.filter((n) => n.pai === 'm0');
  const xs = folhas.map((f) => f.x + f.w / 2);
  assert.ok(Math.abs(m0.x + m0.w / 2 - (Math.min(...xs) + Math.max(...xs)) / 2) < 0.01);
  lay.arestas.filter((a) => a.de === 'm0').forEach((a) => assert.equal(a.pontos[0][0], m0.x + m0.w / 2));
  // Os demais (sem pilha) seguem centralizados.
  const semPilha = Object.assign({}, lay, { nos: lay.nos.filter((n) => n.pai !== 'm0') });
  centralizado(semPilha);
});

test('layout: várias raízes lado a lado, sem sobreposição; repetidos/ciclos ignorados', () => {
  const lay = ORG.layout({ raizes: [{ id: 'a', filhos: [{ id: 'b', filhos: [] }, { id: 'c', filhos: [] }] }, { id: 'd', filhos: [] }, { id: 'e', filhos: [{ id: 'f', filhos: [] }] }] });
  assert.deepEqual(lay.nos.filter((n) => n.nivel === 0).map((n) => n.id), ['a', 'd', 'e']);
  semSobreposicao(lay.nos, 1);
  centralizado(lay);
  const ys = lay.nos.filter((n) => n.nivel === 0).map((n) => n.y);
  assert.ok(ys.every((y) => y === 0));
  // Um nó que aparece de novo (ciclo nos dados) é ignorado: nada trava.
  const ciclo = { id: 'a', filhos: [{ id: 'b', filhos: [] }] };
  ciclo.filhos[0].filhos.push(ciclo);
  const lc = ORG.layout([ciclo]);
  assert.deepEqual(lc.nos.map((n) => n.id), ['a', 'b']);
  assert.deepEqual(ORG.layout({ raizes: [] }), { nos: [], arestas: [], largura: 0, altura: 0 });
});

test('estrutura: ciclo nos dados é cortado (ninguém some, nada trava)', () => {
  const d = { pessoas: [P('a'), P('b'), P('c')], relacoes: [L('a', 'b'), L('b', 'c'), L('c', 'a')] };
  const e = ORG.estrutura(d);
  assert.equal(e.raizes.length, 1);
  assert.equal(e.sem.length, 0);
  const lay = ORG.layout(ORG.arvore(d));
  assert.equal(lay.nos.length, 3);
});

test('mover: ciclo recusado com aviso', () => {
  const r = ORG.mover(exemplo(), 'a', { tipo: 'lider', id: 'd' });
  assert.equal(r.mudou, false);
  assert.match(r.erro, /Não dá para colocar Pessoa a abaixo de Pessoa d/);
  assert.equal(ORG.mover(exemplo(), 'b', { tipo: 'lider', id: 'b' }).mudou, false);
  assert.match(ORG.mover(exemplo(), 'zz', { tipo: 'topo' }).erro, /não encontrada/);
  assert.match(ORG.mover(exemplo(), 'a', { tipo: 'xyz' }).erro, /inválido/);
});

test('mover: da coluna para um líder, entre líderes, para o Topo e de volta para a coluna', () => {
  let d = exemplo();
  // h (sem posição) passa a ser liderado por d
  let r = ORG.mover(d, 'h', { tipo: 'lider', id: 'd' });
  assert.equal(r.erro, '');
  assert.ok(r.relacoes.some((x) => x.tipo === 'lidera' && x.de === 'd' && x.para === 'h'));
  d = Object.assign({}, d, r);
  // b muda de líder: a -> c (a equipe de b vai junto); a ligação 'direto' entre b e c sai
  r = ORG.mover(d, 'b', { tipo: 'lider', id: 'c' });
  assert.equal(r.erro, '');
  assert.equal(r.relacoes.filter((x) => x.tipo === 'lidera' && x.para === 'b').length, 1);
  assert.ok(!r.relacoes.some((x) => x.tipo === 'direto'));
  d = Object.assign({}, d, r);
  assert.deepEqual(ORG.estrutura(d).filhos.c, ['b', 'f', 'g']);
  // i vai para o Topo sem liderados: representado em topoIds
  r = ORG.mover(d, 'i', { tipo: 'topo' });
  assert.deepEqual(r.topoIds, ['a', 'i']);
  d = Object.assign({}, d, r);
  assert.deepEqual(ORG.estrutura(d).raizes, ['a', 'i']);
  assert.deepEqual(ORG.estrutura(d).sem, []);
  // c sai do organograma: os liderados de c (b, f, g) vão para o Topo, ninguém some
  r = ORG.mover(d, 'c', { tipo: 'sem' });
  d = Object.assign({}, d, r);
  const e = ORG.estrutura(d);
  assert.deepEqual(e.sem, ['c']);
  assert.deepEqual(e.raizes, ['a', 'i', 'b', 'f', 'g']);
  assert.deepEqual(r.topoIds, e.raizes);
});

test('mover: líder que perde o único liderado continua no Topo (topoIds)', () => {
  const d = { pessoas: [P('a'), P('b')], relacoes: [L('a', 'b')] };
  const r = ORG.mover(d, 'b', { tipo: 'sem' });
  assert.deepEqual(r.topoIds, ['a']);
  const e = ORG.estrutura(Object.assign({}, d, r));
  assert.deepEqual(e.raizes, ['a']);
  assert.deepEqual(e.sem, ['b']);
  // sem topoIds, quem não lidera ninguém e não tem líder fica "Sem posição"
  assert.deepEqual(ORG.estrutura({ pessoas: d.pessoas, relacoes: [] }).sem, ['a', 'b']);
});

test('semPosicaoIds: força a pessoa na coluna; mover tira dela', () => {
  const d = Object.assign(exemplo(), { semPosicaoIds: ['g'] });
  const e = ORG.estrutura(d);
  assert.deepEqual(e.sem, ['g', 'h', 'i']);
  const r = ORG.mover(d, 'g', { tipo: 'lider', id: 'a' });
  assert.deepEqual(r.semPosicaoIds, []);
});

test('paraHtml: estático, com SVG, escapado e caber em A4', () => {
  const d = exemplo();
  d.pessoas[0].nome = '<script>x</script>';
  d.pessoas[1].foto = 'https://externo/foto.jpg';
  const h = ORG.paraHtml(d, { larguraMax: 600 });
  assert.match(h, /<svg class="orgx-linhas"/);
  assert.ok(!h.includes('<script>x'));
  assert.ok(!h.includes('https://externo'));
  assert.ok(!h.includes('tabindex'));
  assert.equal((h.match(/class="orgx-cartao/g) || []).length, 7);
  const larg = Number(/orgx-impresso__area" style="width:(\d+)px/.exec(h)[1]);
  assert.ok(larg <= 600);
  assert.match(h, /Sem posição: Pessoa h, Pessoa i/);
  assert.match(ORG.paraHtml({ pessoas: [], relacoes: [] }), /Ninguém posicionado/);
  // Combinação: nome Notus + código; sem teste
  assert.match(ORG.paraHtml({ pessoas: [P('a', { codigo: 'D' })], relacoes: [], topoIds: ['a'] }), /Abre-caminhos · D/);
  assert.match(ORG.paraHtml({ pessoas: [P('a', { semTeste: true })], relacoes: [], topoIds: ['a'] }), /Sem teste/);
});

test('caminho: linha em ângulo reto com cantos arredondados', () => {
  assert.equal(ORG.caminho([[0, 0], [0, 10]]), 'M0 0 L0 10');
  assert.match(ORG.caminho([[0, 0], [0, 20], [40, 20], [40, 40]]), /^M0 0 L0 12 Q0 20 8 20 L32 20 Q40 20 40 28 L40 40$/);
});

test('identidade: organograma.css e organograma.js só com tokens Notus, escala e pesos permitidos', () => {
  const raiz = path.join(__dirname, '..');
  const LIBERADAS = new Set(['#f34405', '#f2762e', '#ff9f40', '#324e73', '#13283f', '#0c1a2a', '#141414', '#f2f2f2', '#c43803', '#eaeef4',
    '#e2e6ec', '#6b7586', '#46546a', '#e9ecef', '#8a97ab', '#5d7699', '#c5ccd6', '#fff', '#ffffff', '#b91c1c', '#dc2626', '#fecaca', '#fef2f2', '#047857', '#065f46', '#ecfdf5']);
  for (const arq of ['assets/organograma.css', 'js/organograma.js']) {
    const txt = fs.readFileSync(path.join(raiz, arq), 'utf8');
    for (const m of txt.matchAll(/#([0-9a-fA-F]{3,8})\b/g)) {
      if (![3, 6].includes(m[1].length)) continue;
      assert.ok(LIBERADAS.has('#' + m[1].toLowerCase()), arq + ': cor fora da paleta ' + m[0]);
    }
    for (const m of txt.matchAll(/font-size\s*:\s*([^;]+);/g)) assert.match(m[1].trim(), /^var\(--t-[a-z-]+\)$/, arq + ': font-size só por token');
    for (const m of txt.matchAll(/font-weight\s*:\s*([a-z0-9]+)/gi)) assert.ok(['400', '600', '700'].includes(m[1]), arq + ': peso ' + m[1]);
    assert.ok(!/<select\b/.test(txt) && !/repeating-(linear|radial)-gradient/.test(txt), arq);
    assert.ok(!/(^|[^.\w])(confirm|prompt|alert)\s*\(/.test(txt), arq + ': sem confirm/prompt/alert');
  }
});
