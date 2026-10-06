#!/usr/bin/env node
// Confere o conteúdo do Relatório Completo Avançado (um JSON por combinação DISC em conteudo/profundo/).
// Cópia das regras de checar.mjs (guia de quem escreve o conteúdo): formato, tamanho mínimo e termos proibidos.
//
//   node scripts/checar-profundo.mjs conteudo/profundo/DI.json ...   -> lista ✓/✗ e sai com 1 se houver erro
//   import { checarConteudo, palavras } from './checar-profundo.mjs'  -> checarConteudo(dados) devolve [mensagens de erro]
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const PROIBIDAS = /\b(cérebro|cerebral|hemisf|neuro|ansiedade|depress|transtorno|diagn[oó]stic|cura|patolog|autoestima|teste psicol|QI|Executor|Comunicador|Planejador|Analista|Comandante|Aconselhador|Especialista|Protetor|Solucionador|Competidor|Articulador|Julgador|Organizador|Integrador|Influenciador|Inventivo|Motivador|Vendedor|Diplomata|Atendente|Professoral|Estrategista|Controlador|Administrador|Notus|IBC)\b/i;
export const DIM = ['dia_a_dia', 'decisao', 'aprendizado', 'mudanca', 'tempo_organizacao', 'comunicacao', 'conflito', 'motivadores', 'desmotivadores', 'necessidades', 'como_lidera', 'como_prefere_ser_liderado', 'papel_na_equipe', 'persuasao_negociacao', 'ambientes', 'pontos_cegos', 'valoriza_nos_outros'];
export const CODIGOS = ['D', 'I', 'S', 'C', 'DI', 'DS', 'DC', 'ID', 'IS', 'IC', 'SD', 'SI', 'SC', 'CD', 'CI', 'CS'];
export const palavras = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;

// Erros de formato/tamanho/termos de UMA combinação (lista vazia = ok).
export function checarConteudo(d) {
  const erros = [];
  const erro = (m) => erros.push(m);
  if (!d || typeof d !== 'object') return ['não é um objeto'];
  const txt = JSON.stringify(d);
  const m = PROIBIDAS.exec(txt); if (m) erro('termo proibido: ' + m[0]);
  if (!/^(D|I|S|C|DI|DS|DC|ID|IS|IC|SD|SI|SC|CD|CI|CS)$/.test(d.codigo || '')) erro('codigo');
  if (!Array.isArray(d.retrato) || d.retrato.length !== 4 || d.retrato.some((p) => palavras(p) < 60)) erro('retrato: 4 parágrafos de 60+ palavras');
  const man = d.manual || {};
  for (const [k, n] of [['como_falar_comigo', 5], ['evite', 4], ['me_energiza', 4], ['me_desgasta', 4]]) if (!Array.isArray(man[k]) || man[k].length < n) erro('manual.' + k + ' >= ' + n);
  const di = d.dimensoes || {};
  for (const k of DIM) {
    const x = di[k];
    if (!x || palavras(x.texto) < 70) { erro('dimensoes.' + k + '.texto 70+ palavras'); continue; }
    if (!Array.isArray(x.itens) || x.itens.length < 3 || x.itens.some((i) => !i.titulo || palavras(i.texto) < 12)) erro('dimensoes.' + k + '.itens: 3+ {titulo, texto 12+ palavras}');
  }
  const p = d.pressao || {};
  for (const k of ['primeira_reacao', 'se_continua', 'como_volta']) if (palavras(p[k]) < 30) erro('pressao.' + k + ' 30+ palavras');
  if (!Array.isArray(p.sinais) || p.sinais.length < 4) erro('pressao.sinais >= 4');
  if (!Array.isArray(p.o_que_ajuda) || p.o_que_ajuda.length < 4) erro('pressao.o_que_ajuda >= 4');
  const r = d.relacoes || {};
  for (const l of ['D', 'I', 'S', 'C']) if (!r[l] || palavras(r[l].texto) < 45 || !Array.isArray(r[l].dicas) || r[l].dicas.length < 3) erro('relacoes.' + l + ' (texto 45+ e 3 dicas)');
  const o = d.o_que_dizem || {};
  if (!Array.isArray(o.elogios) || o.elogios.length < 4 || !Array.isArray(o.criticas) || o.criticas.length < 4) erro('o_que_dizem: 4 elogios e 4 críticas');
  const pdi = d.pdi || {};
  if (palavras(pdi.foco) < 40) erro('pdi.foco 40+ palavras');
  if (!Array.isArray(pdi.habitos) || pdi.habitos.length < 5 || pdi.habitos.some((h) => !h.nome || palavras(h.como) < 15 || !h.sinal_de_progresso)) erro('pdi.habitos: 5 {nome, como 15+, sinal_de_progresso}');
  if (!Array.isArray(pdi.perguntas) || pdi.perguntas.length < 6) erro('pdi.perguntas >= 6');
  for (const k of ['dias_30', 'dias_60', 'dias_90']) if (!Array.isArray(pdi[k]) || pdi[k].length < 3 || pdi[k].some((a) => palavras(a) < 10)) erro('pdi.' + k + ': 3+ ações de 10+ palavras');
  return erros;
}

export function contarPalavras(d) {
  return palavras(Object.values(d || {}).map((v) => JSON.stringify(v)).join(' ').replace(/[{}\[\]",:]/g, ' '));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  let total = 0;
  for (const arq of process.argv.slice(2)) {
    let d;
    try { d = JSON.parse(fs.readFileSync(arq, 'utf8')); } catch (e) { total++; console.log('✗ ' + arq + ': JSON inválido: ' + e.message); continue; }
    const erros = checarConteudo(d);
    erros.forEach((m) => console.log('✗ ' + arq + ': ' + m));
    total += erros.length;
    console.log((erros.length ? '' : '✓ ') + arq + ': ' + contarPalavras(d) + ' palavras');
  }
  process.exit(total ? 1 : 0);
}
