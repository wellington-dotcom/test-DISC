'use strict';
// Impressão / "Salvar em PDF" (assets/styles.css): regras que evitam regressões já vistas na varredura de UX.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'assets', 'styles.css'), 'utf8');

// Margem de cada @page (com ou sem nome) declarada no CSS.
function margensDePagina(texto) {
  const out = [];
  const re = /@page\s*([a-z-]*)\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g;
  let m;
  while ((m = re.exec(texto))) {
    const corpo = m[2].replace(/@[a-z-]+\s*\{[^{}]*\}/g, '');
    const mg = /(?:^|;|\s)margin\s*:\s*([^;]+)/.exec(corpo);
    if (mg) out.push({ nome: m[1] || '(todas)', margem: mg[1].trim() });
  }
  return out;
}

test('PDF do relatório completo: toda página (inclusive a capa) usa a mesma margem', () => {
  // Uma página nomeada com margem diferente (ex.: capa com margem 0) fazia o Chromium montar o documento na largura
  // da capa e cortar ~28 mm da lateral direita de todas as outras páginas.
  const margens = margensDePagina(css);
  assert.ok(margens.length >= 1, 'há @page com margem');
  const distintas = [...new Set(margens.map((x) => x.margem))];
  assert.deepEqual(distintas, ['14mm'], JSON.stringify(margens));
});

test('PDF do relatório do candidato: as seções podem quebrar entre páginas; cartões e títulos não', () => {
  const bloco = css.slice(css.indexOf('@media print'), css.indexOf('/* Link discreto para o painel'));
  assert.doesNotMatch(bloco, /\.relatorio-candidato \.caixa \{[^}]*break-inside:\s*avoid/, 'a seção inteira "sem quebrar" deixava a 1ª página meio vazia');
  assert.match(bloco, /\.relatorio-candidato \.rel-item[^{]*\{[^}]*break-inside:\s*avoid/);
  assert.match(bloco, /\.relatorio-candidato \.rel-impressao \{[^}]*display:\s*flex/, 'cabeçalho com a marca só no PDF');
});

test('barra fixa da capa no celular não fica presa: a entrada da capa no celular anima só a opacidade', () => {
  assert.match(css, /\.boasvindas\.surgir \{ animation-name: surgir-opacidade; \}/);
  assert.match(css, /@keyframes surgir-opacidade \{ from \{ opacity: 0; \} to \{ opacity: 1; \} \}/);
});
