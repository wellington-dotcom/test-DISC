'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../js/relatorio-lideranca.js');

const SECOES_BASE = ['comunicacao', 'delegar', 'feedback', 'motivacao', 'cobrar', 'estresse',
  'reconhecer', 'rendeMais', 'riscos', 'plano'];

const PERFIS = {
  D: { percentuais: { D: 42, I: 28, S: 12, C: 18 }, codigo: 'DI' },
  I: { percentuais: { D: 20, I: 40, S: 25, C: 15 }, codigo: 'IS' },
  S: { percentuais: { D: 10, I: 22, S: 43, C: 25 }, codigo: 'SC' },
  C: { percentuais: { D: 24, I: 11, S: 23, C: 42 }, codigo: 'CD' }
};

function secao(dados, chave) { return dados.secoes.find((s) => s.chave === chave); }

function verificar(dados) {
  assert.equal(dados.modelo, 'empresa-individual');
  assert.ok(dados.titulo.trim());
  assert.ok(dados.resumo.trim());
  const frases = dados.resumo.split(/[.!?](?:\s|$)/).filter((f) => f.trim());
  assert.ok(frases.length >= 2 && frases.length <= 4, 'resumo com ' + frases.length + ' frases');
  assert.match(dados.aviso, /estilo/);
  assert.match(dados.aviso, /compet[eê]ncia/);
  assert.match(dados.aviso, /car[aá]ter/);
  SECOES_BASE.forEach((k) => {
    const s = secao(dados, k);
    assert.ok(s, 'faltando seção ' + k);
    assert.ok(s.titulo.trim());
    assert.ok(s.itens.length > 0, 'seção vazia: ' + k);
    s.itens.forEach((i) => {
      assert.equal(typeof i, 'string');
      assert.ok(i.trim());
      assert.ok(!/\{nome\}|\{L\}|\{P\}|undefined|null|NaN/.test(i), 'marcador sobrando: ' + i);
    });
  });
  const tudo = JSON.stringify(dados);
  assert.ok(!/\bIBC\b/.test(tudo), 'não usar IBC');
  assert.ok(!/n[aã]o contrat|descart|elimin|reprov|demit/i.test(tudo), 'linguagem de exclusão');
  assert.doesNotThrow(() => JSON.parse(tudo));
}

for (const [letra, r] of Object.entries(PERFIS)) {
  test('perfil primário ' + letra + ' gera todas as seções', () => {
    const d = R.montar(r, { nome: 'Maria Aparecida Souza', cargo: 'Analista', lider: null });
    verificar(d);
    assert.equal(d.pessoa.primario, letra);
    assert.equal(d.pessoa.nome, 'Maria A.');
    assert.ok(JSON.stringify(d).includes('Maria A.'));
    assert.ok(!JSON.stringify(d).includes('Souza'), 'nome completo vazou');
    const fb = secao(d, 'feedback').itens.join(' ');
    assert.match(fb, /Exemplo de frase \(positivo\)/);
    assert.match(fb, /Exemplo de frase \(corretivo\)/);
    const plano = secao(d, 'plano');
    assert.deepEqual(plano.etapas.map((e) => e.periodo), ['Até 30 dias', '31 a 60 dias', '61 a 90 dias']);
    plano.etapas.forEach((e) => assert.ok(e.itens.length > 0));
    const com = secao(d, 'comunicacao').itens.join(' ');
    ['Formato:', 'Ritmo:', 'Canal:', 'Evite:'].forEach((t) => assert.ok(com.includes(t), 'faltando ' + t));
    const txt = R.gerarTexto(d);
    assert.ok(txt.startsWith('*Como liderar Maria A.'));
    assert.ok(txt.includes('• '));
    assert.ok(txt.trim().endsWith('_'));
  });
}

test('usa nomes técnicos DISC e intensidade', () => {
  const d = R.montar(PERFIS.C, { nome: 'João' });
  assert.match(d.resumo, /Conformidade 42%/);
  assert.match(d.resumo, /Dominância 24%/);
  assert.equal(d.pessoa.intenso, true);
  assert.equal(d.pessoa.intensidade.C, 'alta');
  assert.equal(d.pessoa.intensidade.I, 'baixa');
  assert.ok(secao(d, 'rendeMais').itens.some((i) => /Fator menos presente: Influência/.test(i)));
});

test('líder D com pessoa S gera ajuste específico', () => {
  const d = R.montar(PERFIS.S, { nome: 'Ana Paula', lider: { nome: 'Carlos Lima', percentuais: { D: 50, I: 20, S: 10, C: 20 } } });
  const v = secao(d, 'voceEEla');
  assert.ok(v, 'seção Você e esta pessoa ausente');
  assert.equal(v.titulo, 'Você e esta pessoa');
  const t = v.itens.join(' ');
  assert.match(t, /Desacelere/);
  assert.match(t, /silêncio/);
  assert.match(t, /Você tem bem mais Dominância \(50%\) que Ana P\. \(10%\)/);
  assert.match(t, /Ana P\. tem bem mais Estabilidade \(43%\) que você \(10%\)/);
  assert.equal(d.lider.codigo, 'DI');
  assert.equal(d.lider.nome, 'Carlos L.');
  assert.ok(R.gerarTexto(d).includes('*Você e esta pessoa*'));
});

test('sem líder (ou sem percentuais do líder) a seção some', () => {
  [null, undefined, { nome: 'Carlos' }, { nome: 'Carlos', percentuais: { D: 0, I: 0, S: 0, C: 0 } }].forEach((lider) => {
    const d = R.montar(PERFIS.D, { nome: 'Pedro', lider });
    assert.equal(secao(d, 'voceEEla'), undefined);
    assert.equal(d.lider, null);
    assert.ok(!R.gerarTexto(d).includes('Você e esta pessoa'));
  });
});

test('determinístico', () => {
  const p = { nome: 'Bia Costa', cargo: 'Vendas', lider: { nome: 'Rui', percentuais: { D: 20, I: 20, S: 20, C: 40 } } };
  const a = R.montar(PERFIS.I, p);
  const b = R.montar(JSON.parse(JSON.stringify(PERFIS.I)), JSON.parse(JSON.stringify(p)));
  assert.deepEqual(a, b);
  assert.equal(R.gerarTexto(a), R.gerarTexto(b));
});

test('nenhum campo sensível na saída', () => {
  const d = R.montar(PERFIS.D, {
    nome: 'Lucas Ferreira', cargo: 'Supervisor', idade: 37, genero: 'masculino', sexo: 'M',
    email: 'lucas@exemplo.com', telefone: '11999990000', cpf: '123.456.789-00', nascimento: '1989-01-01',
    lider: { nome: 'Sara', percentuais: { D: 25, I: 25, S: 25, C: 25 }, email: 'sara@exemplo.com', idade: 50 }
  });
  const tudo = JSON.stringify(d) + R.gerarTexto(d);
  assert.ok(!/["\s](idade|genero|gênero|sexo|email|telefone|cpf|nascimento)["\s:]/i.test(tudo), 'campo sensível na saída');
  ['masculino', 'lucas@exemplo.com', 'sara@exemplo.com', '11999990000', '123.456.789-00', '1989', '"37"', 'Ferreira'
  ].forEach((s) => assert.ok(!tudo.includes(s), 'dado sensível na saída: ' + s));
  assert.ok(!/\b(37|50) anos\b/.test(tudo));
});

test('perfil equilibrado e entrada vazia não quebram', () => {
  const e = R.montar({ percentuais: { D: 25, I: 26, S: 25, C: 24 } }, { nome: '' });
  verificar(e);
  assert.equal(e.pessoa.equilibrado, true);
  assert.match(e.resumo, /equilibrad/);
  verificar(R.montar({}, {}));
  verificar(R.montar());
});

test('todas as 12 combinações geram relatório válido', () => {
  const L = ['D', 'I', 'S', 'C'];
  L.forEach((a) => L.forEach((b) => {
    if (a === b) return;
    const pct = { D: 15, I: 15, S: 15, C: 15 };
    pct[a] = 40; pct[b] = 30;
    const d = R.montar({ percentuais: pct, codigo: a + b }, { nome: 'Teste', lider: { percentuais: { D: 40, I: 30, S: 15, C: 15 } } });
    verificar(d);
    assert.equal(d.pessoa.codigo, a + b);
    assert.ok(secao(d, 'voceEEla').itens.length >= 2);
  }));
});
