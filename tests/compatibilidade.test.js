'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/compatibilidade.js');

const P = {
  D: { D: 48, I: 20, S: 12, C: 20 },
  I: { D: 18, I: 46, S: 20, C: 16 },
  S: { D: 12, I: 20, S: 46, C: 22 },
  C: { D: 15, I: 12, S: 25, C: 48 },
  EQ: { D: 26, I: 25, S: 24, C: 25 }
};

function pessoa(id, nome, perfil, extra) {
  return Object.assign({ id, nome, cargo: 'Analista', percentuais: perfil ? P[perfil] : null }, extra || {});
}

function cenario() {
  return {
    empresa: { nome: 'Empresa Exemplo' },
    pessoas: [
      pessoa('g', 'Gabriela Martins Rocha', 'D', { cargo: 'Gerente', idade: 41, genero: 'feminino', telefone: '11999998888', email: 'g@x.com' }),
      pessoa('s1', 'Sérgio da Silva', 'S', { idade: 29, sexo: 'M' }),
      pessoa('s2', 'Sandra Lopes', 'S'),
      pessoa('c', 'Carla Nunes', 'C'),
      pessoa('n', 'Nicolas Prado', null),
      pessoa('novo', 'Daniel Ferreira', 'D', { idade: 33, estadoCivil: 'casado' })
    ],
    relacoes: [
      { de: 'g', para: 's1', tipo: 'lidera' },
      { de: 'g', para: 's2', tipo: 'lidera' },
      { de: 'g', para: 'c', tipo: 'lidera' },
      { de: 'g', para: 'novo', tipo: 'lidera' },
      { de: 's1', para: 's2', tipo: 'direto' },
      { de: 'c', para: 'n', tipo: 'indireto' },
      { de: 'novo', para: 'c', tipo: 'direto' }
    ],
    foco: 'novo'
  };
}

function par(saida, de, para) {
  return saida.pares.find((p) => (p.de === de && p.para === para) || (p.de === para && p.para === de));
}

test('D × D em relação direta = tensão (disputa por controle)', () => {
  const r = C.analisarPar({ id: 1, nome: 'Ana Souza', percentuais: P.D }, { id: 2, nome: 'Bruno Lima', percentuais: P.D }, 'direto');
  assert.equal(r.nivel, 'tensao');
  assert.ok(r.pontuacao < 50);
  assert.ok(r.riscos.some((t) => /controle/.test(t)));
  assert.ok(r.dicas.length >= 2);
});

test('relação indireta pesa menos que direta', () => {
  const a = { id: 1, nome: 'Ana Souza', percentuais: P.D };
  const b = { id: 2, nome: 'Bruno Lima', percentuais: P.D };
  const direto = C.analisarPar(a, b, 'direto');
  const indireto = C.analisarPar(a, b, 'indireto');
  assert.ok(indireto.pontuacao > direto.pontuacao);
  assert.equal(indireto.peso < direto.peso, true);
});

test('S × S = fluido', () => {
  const r = C.analisarPar({ id: 1, nome: 'Ana Souza', percentuais: P.S }, { id: 2, nome: 'Bruno Lima', percentuais: P.S }, 'direto');
  assert.equal(r.nivel, 'fluido');
  assert.ok(r.pontuacao >= 70);
  assert.ok(r.sinergias.length > 0);
});

test('I × C = atrito entre entusiasmo e detalhe', () => {
  const r = C.analisarPar({ id: 1, nome: 'Ana Souza', percentuais: P.I }, { id: 2, nome: 'Bruno Lima', percentuais: P.C }, 'direto');
  assert.notEqual(r.nivel, 'fluido');
  assert.ok(r.riscos.some((t) => /detalhe/.test(t)));
});

test('D líder × S liderado traz risco de pressão e dicas de previsibilidade', () => {
  const s = C.montar(cenario());
  const p = par(s, 'g', 's1');
  assert.equal(p.tipo, 'lidera');
  assert.notEqual(p.nivel, 'fluido');
  assert.ok(p.riscos.some((t) => /pressão|insegurança/.test(t)));
  assert.ok(p.dicas.some((t) => /antecipe mudanças/.test(t)));
  assert.ok(p.dicas.every((t) => !/\.\.(\s|$)/.test(t)), 'ponto duplo');
});

test('intensidade importa: D pouco acentuado gera menos atrito', () => {
  const fraco = { D: 31, I: 25, S: 22, C: 22 };
  const forte = C.analisarPar({ id: 1, nome: 'A B', percentuais: P.D }, { id: 2, nome: 'C D', percentuais: P.D }, 'direto');
  const leve = C.analisarPar({ id: 1, nome: 'A B', percentuais: fraco }, { id: 2, nome: 'C D', percentuais: fraco }, 'direto');
  assert.ok(leve.pontuacao > forte.pontuacao);
});

test('equipe: distribuição, média, lacunas e pessoas sem teste', () => {
  const s = C.montar(cenario());
  assert.equal(s.equipe.total, 6);
  assert.equal(s.equipe.comTeste, 5);
  assert.deepEqual(s.equipe.distribuicao, { D: 2, I: 0, S: 2, C: 1, equilibrado: 0 });
  assert.ok(s.equipe.falta.some((f) => f.fator === 'I'));
  assert.deepEqual(s.equipe.semTeste.map((p) => p.id), ['n']);
  const semC = C.montar({ pessoas: [pessoa('a', 'Ana Souza', 'D'), pessoa('b', 'Bia Reis', 'I')], relacoes: [] });
  assert.ok(semC.equipe.falta.find((f) => f.fator === 'C').texto.includes('processos e qualidade'));
  const pc = par(s, 'c', 'n');
  assert.equal(pc.nivel, 'indefinido');
  assert.equal(pc.pontuacao, null);
  assert.ok(pc.dicas[0].includes('Nicolas P.'));
});

test('lideranças: estilo do líder, liderados e alertas', () => {
  const s = C.montar(cenario());
  assert.equal(s.liderancas.length, 1);
  const l = s.liderancas[0];
  assert.equal(l.id, 'g');
  assert.equal(l.nome, 'Gabriela M.');
  assert.ok(l.estilo);
  assert.deepEqual(l.liderados.map((x) => x.id), ['s1', 's2', 'c', 'novo']);
  l.liderados.forEach((x) => { assert.ok(x.tendencia); assert.ok(x.comoConduzir.length > 0); });
  assert.ok(l.alertas.some((a) => /previsibilidade/.test(a)));
  assert.ok(l.alertas.some((a) => /tensão/.test(a)), 'D líder × D liderado deve gerar alerta');
});

test('organograma: árvore, níveis e ciclo quebrado com aviso', () => {
  const s = C.montar(cenario());
  assert.deepEqual(s.organograma.raizes.map((r) => r.id), ['g', 'n']);
  assert.equal(s.organograma.raizes[0].filhos.length, 4);
  assert.equal(s.organograma.profundidade, 1);
  const ciclo = C.montar({
    pessoas: [pessoa('a', 'Ana Souza', 'D'), pessoa('b', 'Bia Reis', 'S'), pessoa('c', 'Caio Melo', 'C')],
    relacoes: [{ de: 'a', para: 'b', tipo: 'lidera' }, { de: 'b', para: 'c', tipo: 'lidera' }, { de: 'c', para: 'a', tipo: 'lidera' }]
  });
  assert.equal(ciclo.organograma.ciclos.length, 1);
  assert.deepEqual(ciclo.organograma.ciclos[0].quebradoEm, { de: 'c', para: 'a' });
  assert.deepEqual(ciclo.organograma.raizes.map((r) => r.id), ['a']);
  assert.equal(ciclo.organograma.raizes[0].filhos[0].filhos[0].id, 'c');
  assert.equal(ciclo.organograma.profundidade, 2);
  assert.ok(ciclo.avisos.some((a) => /Ciclo de liderança/.test(a)));
  // todos aparecem exatamente uma vez
  assert.deepEqual(ciclo.organograma.nos.map((n) => n.id).sort(), ['a', 'b', 'c']);
});

test('dois líderes para a mesma pessoa: fica o primeiro, com aviso', () => {
  const s = C.montar({
    pessoas: [pessoa('a', 'Ana Souza', 'D'), pessoa('b', 'Bia Reis', 'S'), pessoa('c', 'Caio Melo', 'C')],
    relacoes: [{ de: 'a', para: 'c', tipo: 'lidera' }, { de: 'b', para: 'c', tipo: 'lidera' }]
  });
  assert.equal(s.organograma.nos.find((n) => n.id === 'c').liderId, 'a');
  assert.ok(s.avisos.some((a) => /mais de um líder/.test(a)));
});

test('foco: encaixe com líder, diretos, equipe e plano de 90 dias', () => {
  const s = C.montar(cenario());
  const f = s.foco;
  assert.equal(f.id, 'novo');
  assert.equal(f.nome, 'Daniel F.');
  assert.equal(f.lider.id, 'g');
  assert.equal(f.lider.nivel, 'tensao');
  assert.deepEqual(f.diretos.map((d) => d.id), ['c']);
  assert.ok(['fluido', 'atencao', 'tensao'].includes(f.nivel));
  assert.ok(f.pontuacao >= 0 && f.pontuacao <= 100);
  assert.ok(f.pontosFortes.length > 0);
  assert.ok(f.riscos.some((r) => /Gabriela M\./.test(r)));
  assert.deepEqual(f.recomendacoes90.map((r) => r.periodo), ['Dias 1–30', 'Dias 31–60', 'Dias 61–90']);
  f.recomendacoes90.forEach((r) => assert.ok(r.itens.length > 0));
});

test('foco que preenche lacuna da equipe vira ponto forte', () => {
  const s = C.montar({
    pessoas: [pessoa('l', 'Lia Costa', 'S'), pessoa('x', 'Rui Alves', 'S'), pessoa('novo', 'Iara Dias', 'I')],
    relacoes: [{ de: 'l', para: 'novo', tipo: 'lidera' }, { de: 'x', para: 'novo', tipo: 'direto' }],
    foco: 'novo'
  });
  assert.ok(s.foco.pontosFortes.some((t) => /falta na equipe/.test(t)));
  assert.deepEqual(s.foco.encaixeEquipe.preencheLacunas, ['Influência']);
});

test('foco sem teste e foco inexistente', () => {
  const d = cenario(); d.foco = 'n';
  const s = C.montar(d);
  assert.equal(s.foco.nivel, 'indefinido');
  assert.ok(s.foco.riscos[0].includes('não fez o teste'));
  d.foco = 'zzz';
  const s2 = C.montar(d);
  assert.equal(s2.foco, null);
  assert.ok(s2.avisos.some((a) => /não encontrada/.test(a)));
});

test('determinismo e serialização', () => {
  const a = JSON.stringify(C.montar(cenario()));
  const b = JSON.stringify(C.montar(cenario()));
  assert.equal(a, b);
  assert.deepEqual(JSON.parse(a), C.montar(cenario()));
});

test('nenhum campo sensível nem nome completo na saída', () => {
  const saida = C.montar(cenario());
  const chaves = new Set();
  (function andar(v) {
    if (Array.isArray(v)) v.forEach(andar);
    else if (v && typeof v === 'object') Object.keys(v).forEach((k) => { chaves.add(k); andar(v[k]); });
  })(saida);
  ['idade', 'genero', 'sexo', 'telefone', 'email', 'estadoCivil'].forEach((k) => assert.ok(!chaves.has(k), 'chave sensível: ' + k));
  const txt = JSON.stringify(saida);
  assert.ok(!/\b(idade|gênero|genero|sexo)\b/i.test(txt), 'texto cita dado sensível');
  ['11999998888', 'g@x.com', 'feminino', 'casado',
    'Gabriela Martins', 'Sérgio da Silva', 'Daniel Ferreira', 'IBC'].forEach((t) => {
    assert.ok(!txt.includes(t), 'vazou: ' + t);
  });
  assert.ok(txt.includes('Sérgio S.'));
  assert.ok(!/undefined|NaN|\{a\}|\{b\}|\{nome\}/.test(txt));
});

test('avisos de limite sempre presentes; relações inválidas ignoradas', () => {
  const s = C.montar({ pessoas: [pessoa('a', 'Ana Souza', 'EQ')], relacoes: [{ de: 'a', para: 'x', tipo: 'direto' }, { de: 'a', para: 'a', tipo: 'lidera' }, { de: 'a', para: 'a', tipo: 'chefe' }] });
  assert.ok(s.avisos[0].includes('não competência'));
  assert.equal(s.pares.length, 0);
  assert.equal(s.equipe.distribuicao.equilibrado, 1);
  assert.ok(s.avisos.length >= 6);
  const vazio = C.montar();
  assert.equal(vazio.equipe.total, 0);
  assert.deepEqual(vazio.organograma.raizes, []);
});

test('lidera substitui direto do mesmo par (sem duplicar)', () => {
  const s = C.montar({
    pessoas: [pessoa('a', 'Ana Souza', 'D'), pessoa('b', 'Bia Reis', 'S')],
    relacoes: [{ de: 'a', para: 'b', tipo: 'direto' }, { de: 'b', para: 'a', tipo: 'direto' }, { de: 'a', para: 'b', tipo: 'lidera' }, { de: 'a', para: 'b', tipo: 'indireto' }]
  });
  assert.equal(s.pares.length, 1);
  assert.equal(s.pares[0].tipo, 'lidera');
});
