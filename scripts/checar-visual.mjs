#!/usr/bin/env node
// Confere a identidade visual Notus (docs/IDENTIDADE-VISUAL.md) nos arquivos de tela.
// Sai com código 1 e lista arquivo:linha de cada problema.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const ARQUIVOS = ['assets/styles.css', 'assets/admin.css', 'js/app.js', 'js/admin.js', 'index.html', 'admin.html'];

// Tokens da identidade (assets/notus.css) + vermelho/verde funcionais + cores do próprio ícone.
const CORES_LIBERADAS = new Set([
  '#f34405', '#f2762e', '#ff9f40', '#324e73', '#13283f', '#0c1a2a', '#141414', '#f2f2f2',
  '#c43803', '#eaeef4', '#e2e6ec', '#6b7586', '#46546a', '#e9ecef', '#8a97ab', '#5d7699', '#c5ccd6',
  '#fff', '#ffffff', '#fdba74',
  // funcionais: erro (vermelho) e sucesso (verde)
  '#b91c1c', '#dc2626', '#fecaca', '#fef2f2', '#fca5a5', '#047857', '#065f46', '#ecfdf5',
]);
const ESCALA_PX = new Set([11, 12, 13, 15, 16, 18, 24, 28, 32, 44]);
const PESOS = new Set(['400', '600', '700', 'normal', 'bold', 'inherit']);
const CLASSES_ANTIGAS = ['botao--preto', 'botao--amarelo', 'caixa--preta', 'caixa--amarela', 'caixa--gradiente', 'hachura', 'selo--amarelo', 'selo--preto', 'class="marca"'];

const problemas = [];
const anotar = (arq, n, msg) => problemas.push(`${arq}:${n}: ${msg}`);

for (const arq of ARQUIVOS) {
  const linhas = readFileSync(join(raiz, arq), 'utf8').split('\n');
  const ehHtml = arq.endsWith('.html');
  let dentroCores = false;
  let profundidade = 0;
  linhas.forEach((linha, i) => {
    const n = i + 1;
    // O objeto CORES do admin.js é liberado (cores do gráfico, conferidas pelo teste contra notus.css).
    if (arq === 'js/admin.js' && /\bCORES\s*=\s*(Object\.freeze\()?\{/.test(linha)) { dentroCores = true; profundidade = 0; }
    if (dentroCores) {
      profundidade += (linha.match(/\{/g) || []).length - (linha.match(/\}/g) || []).length;
      if (profundidade <= 0) dentroCores = false;
      return;
    }
    const semComentario = linha.replace(/\/\*.*?\*\//g, '');
    if (/^\s*(\/\/|\*|\/\*)/.test(semComentario)) return;

    for (const m of semComentario.matchAll(/#([0-9a-fA-F]{3,8})\b/g)) {
      const antes = semComentario.slice(0, m.index);
      if (ehHtml && /(href|id|for|aria-[a-z]+)=["'][^"']*$/.test(antes)) continue; // âncoras e ids
      if (![3, 4, 6, 8].includes(m[1].length)) continue;
      const cor = `#${m[1].toLowerCase()}`;
      if (!CORES_LIBERADAS.has(cor)) anotar(arq, n, `cor fora da paleta ${m[0]} (use os tokens de notus.css)`);
    }
    for (const m of semComentario.matchAll(/font-size\s*:\s*([0-9.]+)px/gi)) {
      if (!ESCALA_PX.has(Number(m[1]))) anotar(arq, n, `font-size ${m[1]}px fora da escala (use var(--t-*))`);
    }
    for (const m of semComentario.matchAll(/fontSize\s*[:=]\s*['"]?([0-9.]+)(px)?/g)) {
      if (!ESCALA_PX.has(Number(m[1]))) anotar(arq, n, `fontSize ${m[1]} fora da escala`);
    }
    for (const m of semComentario.matchAll(/font-weight\s*:\s*([a-z0-9]+)/gi)) {
      if (!PESOS.has(m[1].toLowerCase())) anotar(arq, n, `font-weight ${m[1]} fora dos três pesos (400/600/700)`);
    }
    for (const m of semComentario.matchAll(/font-weight=["']?([a-z0-9]+)/gi)) {
      if (!PESOS.has(m[1].toLowerCase())) anotar(arq, n, `font-weight ${m[1]} fora dos três pesos (400/600/700)`);
    }
    if (/<select\b/i.test(semComentario)) anotar(arq, n, '<select> nativo proibido (use o seletor em pílula)');
    if (/(^|[^.\w])(window\.)?(confirm|prompt|alert)\s*\(/.test(semComentario) && !/function\s+(confirm|prompt|alert)/.test(semComentario)) {
      anotar(arq, n, 'confirm/prompt/alert do navegador proibido (use a confirmação na página)');
    }
    for (const c of CLASSES_ANTIGAS) if (semComentario.includes(c)) anotar(arq, n, `classe antiga "${c}"`);
    if (/repeating-(linear|radial)-gradient/i.test(semComentario)) anotar(arq, n, 'listras/hachura (repeating-*-gradient) proibidas');
  });
}

if (problemas.length) {
  console.error(`checar-visual: ${problemas.length} problema(s)\n` + problemas.join('\n'));
  process.exit(1);
}
console.log(`checar-visual: ok (${ARQUIVOS.length} arquivos)`);
