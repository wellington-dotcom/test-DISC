#!/usr/bin/env node
// Monta as Edge Functions do Supabase em UM arquivo cada, para colar no editor do painel do Supabase.
//
//  1. supabase/funcoes-compartilhadas/motores-gerado.js: ES module com cópias de js/scoring.js,
//     js/confiabilidade.js e js/relatorio-motor.js (o servidor usa o MESMO motor do site).
//  2. dist/funcoes/<nome>/index.ts e supabase/functions/<nome>/index.ts (deploy pela integração GitHub):
//     supabase/funcoes-fonte/<nome>/index.ts com todos os módulos de
//     supabase/funcoes-compartilhadas/ embutidos (sem imports relativos; só "jsr:"/"npm:" externos).
//
//   node scripts/montar-funcoes.mjs           -> grava os arquivos gerados
//   node scripts/montar-funcoes.mjs --checar  -> só confere; sai com código 1 se algum estiver desatualizado
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve, sep } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR_FUNCOES = join(RAIZ, 'supabase', 'funcoes-fonte'); // fontes (colas Deno) que importam funcoes-compartilhadas
const DIR_DEPLOY = join(RAIZ, 'supabase', 'functions'); // lido pela integração GitHub do Supabase: só arquivos autocontidos
const DIR_COMPARTILHADAS = join(RAIZ, 'supabase', 'funcoes-compartilhadas');
const DIR_DIST = join(RAIZ, 'dist', 'funcoes');
const MOTORES = join(DIR_COMPARTILHADAS, 'motores-gerado.js');

const rel = (p) => relative(RAIZ, p).split(sep).join('/');
const ler = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

// ---------------------------------------------------------------------------
// 1. Motores do site como ES module
// ---------------------------------------------------------------------------

const SCRIPTS_MOTOR = [
  { arquivo: 'js/scoring.js', exporta: 'DISC_SCORING' },
  { arquivo: 'js/confiabilidade.js', exporta: 'DISC_CONFIABILIDADE' },
  { arquivo: 'js/relatorio-motor.js', exporta: 'DISC_RELATORIO', declaraVar: true }
];

export function montarMotores() {
  const partes = [
    '// ARQUIVO GERADO AUTOMATICAMENTE — NÃO EDITE. Rode: npm run montar:funcoes',
    '// Cópias de ' + SCRIPTS_MOTOR.map((s) => s.arquivo).join(', ') + ' como ES module para as Edge Functions.',
    '// Cada script roda numa função com "self" e "module" próprios (não toca no escopo global do Deno).',
    '/* eslint-disable */',
    'const __motoresDisc = {};',
    ''
  ];
  for (const s of SCRIPTS_MOTOR) {
    const codigo = ler(join(RAIZ, s.arquivo)).replace(/\s+$/, '');
    partes.push('// ---- ' + s.arquivo + ' ----');
    partes.push('(function (self, module, require) {');
    partes.push(codigo);
    if (s.declaraVar) partes.push('self.' + s.exporta + ' = ' + s.exporta + ';');
    partes.push('}).call(__motoresDisc, __motoresDisc, undefined, undefined);');
    partes.push('');
  }
  for (const s of SCRIPTS_MOTOR) partes.push('export const ' + s.exporta + ' = __motoresDisc.' + s.exporta + ';');
  return partes.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// 2. Empacotador mínimo de ES modules (só imports nomeados e "export function/const/let/class")
// ---------------------------------------------------------------------------

const RE_IMPORT = /^import\s[^;]*?from\s*['"]([^'"]+)['"];?[ \t]*\n?/gm;

function importsDe(codigo) {
  const lista = [];
  for (const m of codigo.matchAll(RE_IMPORT)) lista.push({ texto: m[0].trim(), origem: m[1] });
  return lista;
}

function semImports(codigo) { return codigo.replace(RE_IMPORT, ''); }

function nomesDeclarados(codigo) {
  const nomes = [];
  const re = /^(?:export\s+)?(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm;
  for (const m of codigo.matchAll(re)) nomes.push(m[1]);
  return nomes;
}

function tirarExports(codigo, arquivo) {
  const saida = codigo.replace(/^export\s+(?=(?:async\s+)?(?:function|const|let|var|class)\b)/gm, '');
  if (/^export\b/m.test(saida)) throw new Error(arquivo + ': use só "export function/const/let/class" (sem "export {…}" nem "export default").');
  return saida;
}

export function empacotar(entrada, conteudos) {
  // conteudos: mapa opcional caminho -> texto (para montar com o motor recém-gerado sem gravar antes)
  const lerModulo = (p) => (conteudos && conteudos.has(p) ? conteudos.get(p) : ler(p));
  const ordem = [];
  const visitados = new Set();
  const externos = [];
  function visitar(caminho, pilha) {
    if (visitados.has(caminho)) return;
    if (pilha.includes(caminho)) throw new Error('Import circular: ' + pilha.concat(caminho).map(rel).join(' -> '));
    const codigo = lerModulo(caminho);
    for (const imp of importsDe(codigo)) {
      if (imp.origem.startsWith('.')) {
        const alvo = resolve(dirname(caminho), imp.origem);
        if (!alvo.startsWith(DIR_COMPARTILHADAS + sep)) throw new Error(rel(caminho) + ': import relativo fora de supabase/funcoes-compartilhadas: ' + imp.origem);
        if (!existsSync(alvo) && !(conteudos && conteudos.has(alvo))) throw new Error(rel(caminho) + ': arquivo não encontrado: ' + imp.origem);
        visitar(alvo, pilha.concat(caminho));
      } else if (!externos.includes(imp.texto)) {
        externos.push(imp.texto);
      }
    }
    visitados.add(caminho);
    ordem.push(caminho);
  }
  visitar(entrada, []);
  const modulos = ordem.filter((p) => p !== entrada);

  const donos = new Map();
  for (const p of ordem) {
    // No motor gerado, o código do site fica dentro de funções: valem só os nomes exportados.
    const nomes = p === MOTORES
      ? ['__motoresDisc'].concat(Array.from(lerModulo(p).matchAll(/^export const ([\w$]+)/gm), (m) => m[1]))
      : nomesDeclarados(lerModulo(p));
    for (const n of nomes) {
      if (donos.has(n)) throw new Error('Nome repetido "' + n + '" em ' + rel(donos.get(n)) + ' e ' + rel(p) + ' (o pacote junta tudo num arquivo só).');
      donos.set(n, p);
    }
  }

  const corpoEntrada = semImports(lerModulo(entrada)).replace(/^\/\/ @ts-nocheck\n/m, '').replace(/^\s+/, '');
  const partes = [
    '// @ts-nocheck',
    '// ARQUIVO GERADO AUTOMATICAMENTE — NÃO EDITE. Gerado de ' + rel(entrada) + ' por: npm run montar:funcoes',
    '// Autocontido: cole este arquivo inteiro no editor da Edge Function no painel do Supabase.',
    ''
  ].concat(externos, ['']);
  for (const p of modulos) {
    partes.push('// ======== ' + rel(p) + ' ========');
    partes.push(tirarExports(semImports(lerModulo(p)), rel(p)).replace(/^\s+/, '').replace(/\s+$/, ''));
    partes.push('');
  }
  partes.push('// ======== ' + rel(entrada) + ' ========');
  partes.push(corpoEntrada.replace(/\s+$/, ''));
  return partes.join('\n') + '\n';
}

export function funcoes() {
  if (!existsSync(DIR_FUNCOES)) return [];
  return readdirSync(DIR_FUNCOES)
    .filter((n) => statSync(join(DIR_FUNCOES, n)).isDirectory() && existsSync(join(DIR_FUNCOES, n, 'index.ts')))
    .sort();
}

/** Lista de {caminho, conteudo} de tudo que é gerado. */
export function gerarTudo() {
  const motores = montarMotores();
  const conteudos = new Map([[MOTORES, motores]]);
  const saida = [{ caminho: MOTORES, conteudo: motores }];
  for (const nome of funcoes()) {
    const pacote = empacotar(join(DIR_FUNCOES, nome, 'index.ts'), conteudos);
    saida.push({ caminho: join(DIR_DIST, nome, 'index.ts'), conteudo: pacote });
    saida.push({ caminho: join(DIR_DEPLOY, nome, 'index.ts'), conteudo: pacote });
  }
  return saida;
}

const ehPrincipal = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (ehPrincipal) {
  const gerados = gerarTudo();
  if (process.argv.includes('--checar')) {
    const velhos = gerados.filter((g) => !existsSync(g.caminho) || ler(g.caminho) !== g.conteudo).map((g) => rel(g.caminho));
    if (velhos.length) {
      console.error('Edge Functions desatualizadas: ' + velhos.join(', ') + '. Rode: npm run montar:funcoes');
      process.exit(1);
    }
    console.log('Edge Functions (dist/funcoes) em dia com supabase/ e js/.');
  } else {
    for (const g of gerados) {
      mkdirSync(dirname(g.caminho), { recursive: true });
      writeFileSync(g.caminho, g.conteudo);
      console.log('gerado: ' + rel(g.caminho));
    }
  }
}
