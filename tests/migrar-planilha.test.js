'use strict';
// scripts/migrar-planilha.mjs: CSV da planilha antiga -> INSERTs SQL para o Supabase.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const S = require('../js/scoring.js');
const { respostasFixas, respostasAleatorias, prng } = require('./helpers/fixtures.js');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'migrar-planilha.mjs');
let M;
test.before(async () => { M = await import(SCRIPT); });

const CAB = 'id,recebidoEm,nome,telefone,vaga,inicio,fim,duracaoSeg,respostas,D,I,S,C,perfil,status,observacoes,' +
  'payloadJson,protocolo,idade,funcao,empresa,avaliacao,empresaId';

function csvCampo(v) {
  const s = String(v === undefined ? '' : v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function linha(o) {
  const r = S.compactar(o.grupos || respostasFixas(['D', 'I', 'S', 'C']));
  const c = Object.assign({
    id: 'abc123-xyz', recebidoEm: '2026-03-01T12:00:00.000Z', nome: 'Maria da Silva', telefone: '5511999998888',
    vaga: 'Escrevente', inicio: '2026-03-01T11:50:00.000Z', fim: '2026-03-01T12:00:00.000Z', duracaoSeg: '600',
    respostas: r, D: '40', I: '30', S: '20', C: '10', perfil: 'DI', status: 'aprovado', observacoes: '',
    payloadJson: JSON.stringify({ id: 'abc123-xyz', validacao: { versao: 1 } }), protocolo: '47K', idade: '30',
    funcao: 'Auxiliar', empresa: 'Cartório X', avaliacao: 'crt1', empresaId: ''
  }, o);
  return CAB.split(',').map((k) => csvCampo(c[k])).join(',');
}

test('lerCsv: aspas, aspas dobradas, quebra de linha dentro do campo, BOM e ponto e vírgula', () => {
  assert.deepEqual(M.lerCsv('﻿a,b\r\n"x, y","di""z"\n"linha1\nlinha2",3\n'),
    [['a', 'b'], ['x, y', 'di"z'], ['linha1\nlinha2', '3']]);
  assert.deepEqual(M.lerCsv('a;b\n1;2'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(M.lerCsv('a,b\n\n,\n1,2'), [['a', 'b'], ['1', '2']]);
});

test('sqlTexto dobra aspas simples e tira NUL (sem injeção)', () => {
  assert.equal(M.sqlTexto("O'Brien'); drop table x; --"), "'O''Brien''); drop table x; --'");
  assert.equal(M.sqlTexto('a\u0000b'), "'ab'");
  assert.equal(M.sqlTexto(null), 'null');
});

test('dataIso: ISO e formato brasileiro (hora de Brasília)', () => {
  assert.equal(M.dataIso('2026-03-01T12:00:00.000Z'), '2026-03-01T12:00:00.000Z');
  assert.equal(M.dataIso("'2026-03-01T12:00:00.000Z"), '2026-03-01T12:00:00.000Z');
  assert.equal(M.dataIso('01/03/2026 09:00:00'), '2026-03-01T12:00:00.000Z');
  assert.equal(M.dataIso('1/3/2026'), '2026-03-01T03:00:00.000Z');
  assert.equal(M.dataIso('31/13/2026'), null);
  assert.equal(M.dataIso('ontem'), null);
  assert.equal(M.dataIso(''), null);
});

test('converte uma resposta válida: recalcula D/I/S/C e perfil, liga ao processo pelo código', () => {
  const grupos = respostasAleatorias(prng(7));
  const calc = S.calcular(grupos);
  const r = M.gerarSql({ respostasCsv: CAB + '\n' + linha({ grupos, D: '99', perfil: 'ZZ' }) + '\n' });
  assert.equal(r.respostas, 1);
  assert.deepEqual(r.avisos, []);
  assert.match(r.sql, /^-- Importação/);
  assert.match(r.sql, /\nbegin;\n/);
  assert.match(r.sql, /\ncommit;\n$/);
  assert.match(r.sql, /insert into public\.respostas/);
  assert.match(r.sql, /on conflict do nothing;/);
  assert.match(r.sql, /\(select p\.id from public\.processos p where p\.codigo = 'CRT1'\)/);
  assert.ok(r.sql.includes(`'${S.compactar(grupos)}'`));
  assert.ok(r.sql.includes(`${calc.percentuais.D}, ${calc.percentuais.I}, ${calc.percentuais.S}, ${calc.percentuais.C}, '${calc.codigo}'`));
  assert.ok(!r.sql.includes(", 99, "));
  assert.ok(r.sql.includes("'47K'"));
  assert.ok(r.sql.includes("'aprovado'"));
  assert.ok(r.sql.includes(`'{"versao":1}'::jsonb`));
  assert.ok(r.sql.includes("'Cartório X'"));
});

test('ignora linhas inválidas com aviso e normaliza campos', () => {
  const csv = [
    CAB,
    linha({ id: 'a1b2c3', idade: '120', status: 'qualquer', protocolo: 'I1X', avaliacao: '', telefone: '(11) 9 9999-8888' }),
    linha({ id: 'a1b2c3' }),                                    // id repetido
    linha({ id: 'x' }),                                         // id curto
    linha({ id: 'semnome1', nome: '   ' }),
    linha({ id: 'resp-ruim', respostas: '1'.repeat(100) }),     // grupo não é permutação
    linha({ id: 'sem-data', recebidoEm: 'x', inicio: '', fim: '' }),
    linha({ id: 'data-br1', recebidoEm: '05/10/2026 14:30:00', protocolo: '47K' }),
    linha({ id: 'proto-rep', protocolo: '47K' }),               // protocolo repetido -> sem código
    linha({ id: 'aspas-01', protocolo: '', nome: "Ana D'Ávila", observacoes: 'nota "boa", ok\nsegunda linha', payloadJson: '{quebrado' })
  ].join('\n');
  const r = M.gerarSql({ respostasCsv: csv });
  assert.equal(r.respostas, 4);
  assert.equal(r.avisos.length, 7);
  assert.match(r.avisos.join('\n'), /id a1b2c3 repetido/);
  assert.match(r.avisos.join('\n'), /respostas do teste inválidas/);
  assert.match(r.avisos.join('\n'), /data de recebimento inválida/);
  assert.match(r.avisos.join('\n'), /código "I1X" inválido/);
  assert.match(r.avisos.join('\n'), /código 47K repetido/);
  const primeira = r.sql.split('\n').find((l) => l.includes("'a1b2c3'"));
  assert.ok(primeira.includes("'5511999998888'"));
  assert.ok(primeira.includes(", null, 'Escrevente'"), 'idade fora de 14..99 vira null');
  assert.ok(primeira.includes("'em_analise'"));
  assert.ok(primeira.startsWith("  values ('a1b2c3', null, '', null,"));
  assert.ok(r.sql.includes("'2026-10-05T17:30:00.000Z'::timestamptz"));
  assert.ok(r.sql.includes("'Ana D''Ávila'"));
  assert.ok(r.sql.includes("'nota \"boa\", ok\nsegunda linha'"));
});

test('processos (aba Avaliacoes): mantém o código, tipo, ativo e lista do ClickUp', () => {
  const csv = [
    'id,codigo,empresaId,nome,tipo,mostrarResultado,ativa,criadaEm,empresa,vaga,cidade,consultor,contratante,periodoInicio,periodoFim,clickupListId,config',
    'p1,crt1,,Cartório — Escrevente,selecao,FALSE,TRUE,2026-01-02T10:00:00.000Z,Cartório X,Escrevente,Campinas,Ana,João,2026-01-05,10/02/2026,901234,"{""perfilIdeal"":""SC""}"',
    'p2,EQP2,,Equipe,equipe,TRUE,FALSE,,,,,,,,,lista ruim!,',
    'p3,CRT1,,Repetido,selecao,,,,,,,,,,,,',
    'p4,XY,,Curto,selecao,,,,,,,,,,,,'
  ].join('\n');
  const r = M.gerarSql({ processosCsv: csv });
  assert.equal(r.processos, 2);
  assert.equal(r.avisos.length, 3);
  assert.match(r.sql, /insert into public\.processos/);
  assert.ok(r.sql.includes("values ('CRT1', 'Cartório — Escrevente', 'selecao', 'Cartório X', 'Escrevente', 'Campinas', 'Ana', 'João', '2026-01-05'::date, '2026-02-10'::date, '901234', '{\"perfilIdeal\":\"SC\"}'::jsonb, false, true, '2026-01-02T10:00:00.000Z'::timestamptz)"));
  assert.ok(r.sql.includes("values ('EQP2', 'Equipe', 'equipe', '', '', '', '', '', null, null, null, '{}'::jsonb, true, false, now())"));
  // processos antes das respostas (o processo_id é achado pelo código)
  const ambos = M.gerarSql({ processosCsv: csv, respostasCsv: CAB + '\n' + linha({}) });
  assert.ok(ambos.sql.indexOf('public.processos (') < ambos.sql.indexOf('public.respostas ('));
});

test('linha de comando: grava o arquivo e mostra o resumo', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrar-'));
  const entrada = path.join(dir, 'Respostas.csv');
  const saida = path.join(dir, 'importar.sql');
  fs.writeFileSync(entrada, CAB + '\n' + linha({}) + '\n');
  const out = execFileSync(process.execPath, [SCRIPT, entrada, '--saida', saida], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.equal(out, '');
  assert.match(fs.readFileSync(saida, 'utf8'), /insert into public\.respostas/);
  assert.throws(() => execFileSync(process.execPath, [SCRIPT], { stdio: 'pipe' }));
  fs.rmSync(dir, { recursive: true, force: true });
});
