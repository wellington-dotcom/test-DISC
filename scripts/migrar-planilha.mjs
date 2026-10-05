#!/usr/bin/env node
// Converte o histórico da planilha do Google (servidor antigo, Apps Script) em comandos SQL para o
// Supabase. Opcional: só serve para trazer as respostas antigas para o banco novo.
//
// Na planilha: Arquivo > Fazer download > Valores separados por vírgula (.csv) com a aba "Respostas"
// aberta (e, se quiser manter os links/códigos antigos dos processos, também com a aba "Avaliacoes").
//
//   node scripts/migrar-planilha.mjs Respostas.csv                         -> imprime o SQL na tela
//   node scripts/migrar-planilha.mjs Respostas.csv --saida importar.sql     -> grava num arquivo
//   node scripts/migrar-planilha.mjs Respostas.csv --processos Avaliacoes.csv --saida importar.sql
//
// O SQL gerado vai no SQL Editor do Supabase (depois do supabase/migrations/20261005120000_disc.sql) e pode ser
// rodado mais de uma vez: linhas que já existem (mesmo id, mesmo protocolo ou mesmo código) são puladas.
// Regras (iguais às do banco): id 6-64 caracteres [A-Za-z0-9_-], respostas com 100 dígitos válidos,
// idade 14..99 (senão fica vazia), status em_analise|aprovado|reprovado, D/I/S/C e perfil recalculados.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const SCORING = require('../js/scoring.js');

const STATUS_VALIDOS = ['em_analise', 'aprovado', 'reprovado'];
const LIMITE_OBS = 5000;
const LIMITE_TEXTO = 120;
const LIMITE_VALIDACAO = 4000;
const RE_ID = /^[A-Za-z0-9_-]{6,64}$/;
const RE_PROTOCOLO = /^[0-9]{2}[A-HJ-NP-Z]$/;
const RE_CODIGO = /^[A-Z0-9]{4}$/;
const RE_LISTA = /^[A-Za-z0-9_-]{1,40}$/;

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/** Lê um CSV (RFC 4180: aspas, aspas dobradas, quebras de linha dentro de aspas). Vírgula ou ponto e vírgula. */
export function lerCsv(texto) {
  let t = String(texto || '').replace(/^﻿/, '');
  const primeira = t.split(/\r?\n/, 1)[0] || '';
  const sep = (primeira.split(';').length > primeira.split(',').length) ? ';' : ',';
  const linhas = [];
  let linha = [];
  let campo = '';
  let aspas = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (aspas) {
      if (ch === '"') {
        if (t[i + 1] === '"') { campo += '"'; i++; } else aspas = false;
      } else campo += ch;
    } else if (ch === '"') aspas = true;
    else if (ch === sep) { linha.push(campo); campo = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && t[i + 1] === '\n') i++;
      linha.push(campo); campo = '';
      linhas.push(linha); linha = [];
    } else campo += ch;
  }
  if (campo !== '' || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas.filter((l) => l.some((c) => String(c).trim() !== ''));
}

/** CSV -> lista de objetos pelo cabeçalho (nomes comparados sem maiúsculas/espaços). */
export function csvParaObjetos(texto) {
  const linhas = lerCsv(texto);
  if (!linhas.length) return [];
  const cab = linhas[0].map((c) => String(c).trim().toLowerCase());
  return linhas.slice(1).map((l) => {
    const o = {};
    cab.forEach((nome, i) => { if (nome) o[nome] = l[i] === undefined ? '' : String(l[i]); });
    return o;
  });
}

// ---------------------------------------------------------------------------
// Conversões de valor
// ---------------------------------------------------------------------------

/** Texto da célula: tira o apóstrofo de "forçar texto" do Sheets, NUL e espaços das pontas. */
function celula(v) {
  return String(v === undefined || v === null ? '' : v).replace(/\u0000/g, '').replace(/^'/, '').trim();
}

/** Literal SQL de texto (standard_conforming_strings: só dobra a aspa simples). */
export function sqlTexto(v) {
  if (v === null || v === undefined) return 'null';
  return "'" + String(v).replace(/\u0000/g, '').replace(/'/g, "''") + "'";
}

function sqlJson(obj) {
  return obj === null || obj === undefined ? 'null' : sqlTexto(JSON.stringify(obj)) + '::jsonb';
}

function sqlNumero(n) {
  return (typeof n === 'number' && isFinite(n)) ? String(n) : 'null';
}

function sqlBool(b) { return b ? 'true' : 'false'; }

/**
 * Data/hora da planilha -> ISO 8601 (ou null). Aceita ISO ("2026-03-01T12:00:00.000Z") e o formato
 * brasileiro do Sheets ("01/03/2026 09:00:00", hora de Brasília = -03:00).
 */
export function dataIso(v) {
  const s = celula(v);
  if (!s) return null;
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (m) {
    const dois = (x) => String(x || 0).padStart(2, '0');
    const iso = `${m[3]}-${dois(m[2])}-${dois(m[1])}T${dois(m[4])}:${dois(m[5])}:${dois(m[6])}-03:00`;
    const d = new Date(iso);
    return isNaN(d.getTime()) || Number(m[2]) > 12 || Number(m[1]) > 31 ? null : d.toISOString();
  }
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/** Só a data (AAAA-MM-DD) para colunas "date". */
function soData(v) {
  const s = celula(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const iso = dataIso(s);
  if (!iso) return null;
  // Data brasileira sem hora: mantém o dia digitado.
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return iso.slice(0, 10);
}

function inteiro(v) {
  const s = celula(v).replace(',', '.');
  if (!/^\d+(\.0+)?$/.test(s)) return null;
  return Number(s);
}

/** Mesma regra do Code.gs (normalizarTelefone); número fora do padrão fica só com os dígitos (até 20). */
function telefone(v) {
  const d = celula(v).replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) return '55' + d;
  return d.slice(0, 20);
}

function booleano(v) {
  const s = celula(v).toLowerCase();
  return s === 'true' || s === 'verdadeiro' || s === '1' || s === 'sim';
}

function textoLimite(v, max) {
  return celula(v).replace(/\s+/g, ' ').slice(0, max);
}

function json(v) {
  const s = celula(v);
  if (!s) return null;
  try {
    const o = JSON.parse(s);
    return (o && typeof o === 'object' && !Array.isArray(o)) ? o : null;
  } catch (e) {
    return null;
  }
}

/** "a1b2" -> respostas no formato compacto de 100 dígitos, ou null se inválidas (cada grupo = 1,2,3,4). */
function respostasValidas(v) {
  const s = celula(v).replace(/\s/g, '');
  if (!/^[1-4]{100}$/.test(s)) return null;
  try {
    const grupos = SCORING.descompactar(s);
    return SCORING.validarRespostas(grupos) ? { compacto: s, grupos } : null;
  } catch (e) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Processos (aba "Avaliacoes")
// ---------------------------------------------------------------------------

/** Linhas da aba Avaliacoes -> INSERTs em public.processos (mantém o código do link antigo). */
export function converterProcessos(objetos) {
  const avisos = [];
  const comandos = [];
  const vistos = new Set();
  objetos.forEach((o, i) => {
    const n = i + 2; // linha da planilha (1 = cabeçalho)
    const codigo = celula(o.codigo).toUpperCase().replace(/\s/g, '');
    if (!RE_CODIGO.test(codigo)) { avisos.push(`Avaliacoes linha ${n}: código "${codigo}" inválido — ignorada.`); return; }
    if (vistos.has(codigo)) { avisos.push(`Avaliacoes linha ${n}: código ${codigo} repetido — ignorada.`); return; }
    vistos.add(codigo);
    const tipo = celula(o.tipo) === 'equipe' ? 'equipe' : 'selecao';
    let lista = celula(o.clickuplistid);
    if (lista && !RE_LISTA.test(lista)) { avisos.push(`Avaliacoes linha ${n}: lista do ClickUp "${lista}" inválida — deixada vazia.`); lista = ''; }
    const config = json(o.config) || {};
    const criado = dataIso(o.criadaem);
    const valores = [
      sqlTexto(codigo),
      sqlTexto(textoLimite(o.nome, LIMITE_TEXTO)),
      sqlTexto(tipo),
      sqlTexto(textoLimite(o.empresa, LIMITE_TEXTO)),
      sqlTexto(textoLimite(o.vaga, LIMITE_TEXTO)),
      sqlTexto(textoLimite(o.cidade, LIMITE_TEXTO)),
      sqlTexto(textoLimite(o.consultor, LIMITE_TEXTO)),
      sqlTexto(textoLimite(o.contratante, LIMITE_TEXTO)),
      soData(o.periodoinicio) ? sqlTexto(soData(o.periodoinicio)) + '::date' : 'null',
      soData(o.periodofim) ? sqlTexto(soData(o.periodofim)) + '::date' : 'null',
      lista ? sqlTexto(lista) : 'null',
      sqlJson(config),
      sqlBool(booleano(o.mostrarresultado)),
      sqlBool(celula(o.ativa) === '' ? true : booleano(o.ativa)),
      criado ? sqlTexto(criado) + '::timestamptz' : 'now()'
    ];
    comandos.push('insert into public.processos (codigo, nome, tipo, empresa, vaga, cidade, consultor, contratante, ' +
      'periodo_inicio, periodo_fim, clickup_list_id, config, mostrar_resultado, ativo, criado_em)\n  values (' +
      valores.join(', ') + ')\n  on conflict do nothing;');
  });
  return { comandos, avisos, total: comandos.length };
}

// ---------------------------------------------------------------------------
// Respostas (aba "Respostas")
// ---------------------------------------------------------------------------

/** Linhas da aba Respostas -> INSERTs em public.respostas. */
export function converterRespostas(objetos) {
  const avisos = [];
  const comandos = [];
  const ids = new Set();
  const protocolos = new Set();
  objetos.forEach((o, i) => {
    const n = i + 2;
    const id = celula(o.id);
    if (!RE_ID.test(id)) { avisos.push(`Respostas linha ${n}: id "${id.slice(0, 70)}" inválido — ignorada.`); return; }
    if (ids.has(id)) { avisos.push(`Respostas linha ${n}: id ${id} repetido — ignorada.`); return; }
    const nome = textoLimite(o.nome, LIMITE_TEXTO);
    if (!nome) { avisos.push(`Respostas linha ${n}: sem nome — ignorada.`); return; }
    const resp = respostasValidas(o.respostas);
    if (!resp) { avisos.push(`Respostas linha ${n} (${nome}): respostas do teste inválidas ou incompletas — ignorada.`); return; }
    const recebido = dataIso(o.recebidoem) || dataIso(o.fim) || dataIso(o.inicio);
    if (!recebido) { avisos.push(`Respostas linha ${n} (${nome}): data de recebimento inválida — ignorada.`); return; }
    ids.add(id);

    let protocolo = celula(o.protocolo).toUpperCase();
    if (protocolo && !RE_PROTOCOLO.test(protocolo)) {
      avisos.push(`Respostas linha ${n} (${nome}): código "${protocolo}" inválido — importada sem código.`);
      protocolo = '';
    }
    if (protocolo && protocolos.has(protocolo)) {
      avisos.push(`Respostas linha ${n} (${nome}): código ${protocolo} repetido — importada sem código.`);
      protocolo = '';
    }
    if (protocolo) protocolos.add(protocolo);

    const calc = SCORING.calcular(resp.grupos);
    let idade = inteiro(o.idade);
    if (idade !== null && (idade < 14 || idade > 99)) idade = null;
    let status = celula(o.status);
    if (STATUS_VALIDOS.indexOf(status) < 0) status = 'em_analise';
    const avaliacao = celula(o.avaliacao).toUpperCase().replace(/\s/g, '');
    const payload = json(o.payloadjson);
    let validacao = payload && payload.validacao && typeof payload.validacao === 'object' && !Array.isArray(payload.validacao)
      ? payload.validacao : null;
    if (validacao && JSON.stringify(validacao).length > LIMITE_VALIDACAO) validacao = null;
    const duracao = inteiro(o.duracaoseg);
    const inicio = dataIso(o.inicio);
    const fim = dataIso(o.fim);
    const tel = telefone(o.telefone);

    const valores = [
      sqlTexto(id),
      RE_CODIGO.test(avaliacao)
        ? `(select p.id from public.processos p where p.codigo = ${sqlTexto(avaliacao)})`
        : 'null',
      sqlTexto(RE_CODIGO.test(avaliacao) ? avaliacao : ''),
      protocolo ? sqlTexto(protocolo) : 'null',
      sqlTexto(recebido) + '::timestamptz',
      sqlTexto(nome),
      sqlTexto(tel),
      idade === null ? 'null' : String(idade),
      sqlTexto(textoLimite(o.vaga, LIMITE_TEXTO)),
      sqlTexto(textoLimite(o.funcao, 80)),
      sqlTexto(textoLimite(o.empresa, 80)),
      inicio ? sqlTexto(inicio) + '::timestamptz' : 'null',
      fim ? sqlTexto(fim) + '::timestamptz' : 'null',
      String(duracao === null ? 0 : Math.min(duracao, 2147483647)),
      sqlTexto(resp.compacto),
      sqlNumero(calc.percentuais.D),
      sqlNumero(calc.percentuais.I),
      sqlNumero(calc.percentuais.S),
      sqlNumero(calc.percentuais.C),
      sqlTexto(calc.codigo),
      sqlJson(validacao),
      sqlTexto(status),
      sqlTexto(celula(o.observacoes).slice(0, LIMITE_OBS)),
      sqlJson(payload)
    ];
    comandos.push('insert into public.respostas (id, processo_id, avaliacao, protocolo, recebido_em, nome, telefone, ' +
      'idade, vaga, funcao, empresa, inicio, fim, duracao_seg, respostas, d, i, s, c, perfil, validacao, status, ' +
      'observacoes, payload)\n  values (' + valores.join(', ') + ')\n  on conflict do nothing;');
  });
  return { comandos, avisos, total: comandos.length };
}

/** Monta o arquivo SQL completo (uma transação: ou importa tudo, ou nada). */
export function gerarSql({ respostasCsv, processosCsv } = {}) {
  const proc = processosCsv ? converterProcessos(csvParaObjetos(processosCsv)) : { comandos: [], avisos: [], total: 0 };
  const resp = respostasCsv ? converterRespostas(csvParaObjetos(respostasCsv)) : { comandos: [], avisos: [], total: 0 };
  const partes = [
    '-- Importação do histórico da planilha (gerado por scripts/migrar-planilha.mjs).',
    '-- Cole no SQL Editor do Supabase DEPOIS do 20261005120000_disc.sql e clique em Run. Pode rodar de novo:',
    '-- o que já existe é pulado (on conflict do nothing).',
    `-- Processos: ${proc.total} · Respostas: ${resp.total} · Avisos: ${proc.avisos.length + resp.avisos.length}`,
    'begin;'
  ];
  if (proc.comandos.length) partes.push('', '-- Processos (aba Avaliacoes)', ...proc.comandos);
  if (resp.comandos.length) partes.push('', '-- Respostas (aba Respostas)', ...resp.comandos);
  partes.push('', 'commit;', '');
  return {
    sql: partes.join('\n'),
    avisos: proc.avisos.concat(resp.avisos),
    processos: proc.total,
    respostas: resp.total
  };
}

// ---------------------------------------------------------------------------
// Linha de comando
// ---------------------------------------------------------------------------

function principal(argv) {
  const args = argv.slice(2);
  let respostas = '';
  let processos = '';
  let saida = '';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--processos') processos = args[++i] || '';
    else if (args[i] === '--saida') saida = args[++i] || '';
    else if (!respostas) respostas = args[i];
  }
  if (!respostas && !processos) {
    process.stderr.write('Uso: node scripts/migrar-planilha.mjs Respostas.csv [--processos Avaliacoes.csv] [--saida importar.sql]\n');
    return 2;
  }
  const r = gerarSql({
    respostasCsv: respostas ? readFileSync(respostas, 'utf8') : '',
    processosCsv: processos ? readFileSync(processos, 'utf8') : ''
  });
  if (saida) writeFileSync(saida, r.sql);
  else process.stdout.write(r.sql);
  r.avisos.forEach((a) => process.stderr.write('Aviso: ' + a + '\n'));
  process.stderr.write(`Pronto: ${r.processos} processo(s) e ${r.respostas} resposta(s)` +
    (saida ? ` em ${saida}` : '') + '.\n');
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = principal(process.argv);
}
