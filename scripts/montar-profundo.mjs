#!/usr/bin/env node
// Monta js/disc-profundo-dados.js (conteúdo do Relatório Completo Avançado) a partir de conteudo/profundo/<CODIGO>.json.
//
//   node scripts/montar-profundo.mjs           -> valida cada JSON (regras de scripts/checar-profundo.mjs) e grava o gerado
//   node scripts/montar-profundo.mjs --checar  -> só confere; sai com código 1 se algum JSON for inválido ou o gerado
//                                                 estiver desatualizado (roda no npm test)
//
// Um arquivo por combinação (D, I, S, C, DI, DS, ...). Arquivos que começam com "_" (ex.: _exemplo.json) só entram
// se tiverem "exemplo": true e se não houver o arquivo real da mesma combinação. O gerado é UMD:
// global DISC_PROFUNDO_DADOS = { D: {...}, DI: {...} } (ou module.exports no Node).
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { checarConteudo, contarPalavras, CODIGOS } from './checar-profundo.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const PASTA = join(RAIZ, 'conteudo', 'profundo');
const SAIDA = join(RAIZ, 'js', 'disc-profundo-dados.js');

export function lerConteudo(pasta = PASTA) {
  const erros = [];
  const reais = {}, exemplos = {}, resumo = [];
  const arquivos = existsSync(pasta) ? readdirSync(pasta).filter((a) => a.endsWith('.json')).sort() : [];
  for (const arq of arquivos) {
    let d;
    try { d = JSON.parse(readFileSync(join(pasta, arq), 'utf8')); } catch (e) { erros.push(arq + ': JSON inválido: ' + e.message); continue; }
    const problemas = checarConteudo(d);
    problemas.forEach((m) => erros.push(arq + ': ' + m));
    if (problemas.length) continue;
    const exemplo = arq.startsWith('_');
    if (exemplo && d.exemplo !== true) { erros.push(arq + ': arquivo de exemplo precisa de "exemplo": true'); continue; }
    if (!exemplo && d.exemplo) { erros.push(arq + ': só arquivos que começam com "_" podem ser exemplo'); continue; }
    if (!exemplo && arq !== d.codigo + '.json') { erros.push(arq + ': o nome do arquivo deve ser ' + d.codigo + '.json'); continue; }
    const alvo = exemplo ? exemplos : reais;
    if (alvo[d.codigo]) { erros.push(arq + ': combinação ' + d.codigo + ' repetida'); continue; }
    alvo[d.codigo] = d;
    resumo.push({ arquivo: arq, codigo: d.codigo, palavras: contarPalavras(d), exemplo });
  }
  const dados = {};
  for (const c of CODIGOS) {
    if (reais[c]) dados[c] = reais[c];
    else if (exemplos[c]) dados[c] = exemplos[c];
  }
  return { dados, erros, resumo };
}

export function gerar(dados) {
  const codigos = Object.keys(dados);
  return [
    '// ARQUIVO GERADO AUTOMATICAMENTE — NÃO EDITE. Fonte: conteudo/profundo/<CODIGO>.json. Rode: node scripts/montar-profundo.mjs',
    '// Conteúdo do Relatório Completo Avançado por combinação DISC (' + (codigos.length ? codigos.join(', ') : 'nenhuma') + ').',
    '// UMD: global DISC_PROFUNDO_DADOS = { <codigo>: { codigo, retrato, manual, dimensoes, pressao, relacoes, o_que_dizem, pdi } }.',
    '(function (root) {',
    '  \'use strict\';',
    '  var DADOS = ' + JSON.stringify(dados, null, 1).replace(/\n/g, '\n  ') + ';',
    '  if (typeof module !== \'undefined\' && module.exports) module.exports = DADOS;',
    '  else root.DISC_PROFUNDO_DADOS = DADOS;',
    '})(typeof self !== \'undefined\' ? self : this);',
    ''
  ].join('\n');
}

function principal() {
  const checar = process.argv.includes('--checar');
  const { dados, erros, resumo } = lerConteudo();
  if (erros.length) {
    console.error('montar-profundo: ' + erros.length + ' problema(s) no conteúdo\n' + erros.map((e) => '  ✗ ' + e).join('\n'));
    process.exit(1);
  }
  const novo = gerar(dados);
  const atual = existsSync(SAIDA) ? readFileSync(SAIDA, 'utf8').replace(/\r\n/g, '\n') : '';
  const lista = resumo.map((r) => r.codigo + (r.exemplo ? ' (exemplo)' : '') + ' ' + r.palavras).join(', ');
  if (checar) {
    if (atual !== novo) {
      console.error('montar-profundo: js/disc-profundo-dados.js desatualizado. Rode: node scripts/montar-profundo.mjs');
      process.exit(1);
    }
    console.log('montar-profundo: ok (' + Object.keys(dados).length + ' combinações' + (lista ? ': ' + lista : '') + ')');
    return;
  }
  if (atual !== novo) writeFileSync(SAIDA, novo);
  console.log('montar-profundo: ' + (atual !== novo ? 'gravado' : 'sem mudanças') + ' js/disc-profundo-dados.js (' + Object.keys(dados).length + ' combinações' + (lista ? ': ' + lista : '') + ')');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) principal();
