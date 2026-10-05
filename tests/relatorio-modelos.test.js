'use strict';
// Montadores dos modelos de relatório (equipe, liderança, pessoa): formato, determinismo e privacidade.
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../js/relatorio-modelos.js');

const GERADO = '2026-10-05T12:00:00.000Z';
const R = {
  DI: { percentuais: { D: 45, I: 25, S: 15, C: 15 }, codigo: 'DI' },
  SC: { percentuais: { D: 15, I: 20, S: 45, C: 20 }, codigo: 'SC' },
  CS: { percentuais: { D: 10, I: 15, S: 25, C: 50 }, codigo: 'CS' },
  DI2: { percentuais: { D: 40, I: 35, S: 10, C: 15 }, codigo: 'DI' },
  IS: { percentuais: { D: 20, I: 40, S: 25, C: 15 }, codigo: 'IS' }
};

function entradaEquipe(comFoco) {
  const e = {
    empresa: { nome: 'Cartório Exemplo', cidade: 'Boa Vista' },
    consultor: 'Wellington V.',
    colaboradores: [
      { vinculoId: 'v1', pessoaId: 'uuid-ana', nome: 'Ana Paula Souza', telefone: '5595991112222', email: 'ana@exemplo.com', idade: 41, cargo: 'Diretora', area: 'Diretoria', status: 'ativo', inicio: '2024-01-02', resultado: R.DI, respondidoEm: '2026-09-01' },
      { vinculoId: 'v2', pessoaId: 'uuid-bruno', nome: 'Bruno Lima', telefone: '5595990000001', cargo: 'Gerente', status: 'ativo', resultado: R.SC },
      { vinculoId: 'v3', pessoaId: 'uuid-carla', nome: 'Carla Dias', cargo: 'Analista', status: 'ativo', resultado: R.CS },
      { vinculoId: 'v4', pessoaId: 'uuid-davi', nome: 'Davi Reis', cargo: 'Vendedor', status: 'ativo', resultado: null },
      { vinculoId: 'v5', pessoaId: 'uuid-eva', nome: 'Eva Nunes', cargo: 'Vendedora', status: 'ativo', resultado: R.DI2 },
      { vinculoId: 'v6', pessoaId: 'uuid-fabio', nome: 'Fábio Costa', cargo: 'Ex-colaborador', status: 'desligado', resultado: R.CS }
    ],
    relacoes: [
      { de: 'uuid-ana', para: 'uuid-bruno', tipo: 'lidera' },
      { de: 'uuid-ana', para: 'uuid-eva', tipo: 'lidera' },
      { de: 'uuid-bruno', para: 'uuid-carla', tipo: 'lidera' },
      { de: 'uuid-bruno', para: 'uuid-davi', tipo: 'lidera' },
      { de: 'uuid-carla', para: 'uuid-eva', tipo: 'direto' },
      { de: 'uuid-fabio', para: 'uuid-carla', tipo: 'direto' }
    ]
  };
  if (comFoco) {
    e.foco = { nome: 'Gabriel Rocha Neto', telefone: '5595998887777', cargo: 'Analista', resultado: R.IS,
      relacoes: [{ de: 'uuid-bruno', para: 'foco', tipo: 'lidera' }, { de: 'foco', para: 'uuid-carla', tipo: 'direto' }] };
  }
  return e;
}

const PROIBIDOS = ['5595991112222', '5595990000001', '5595998887777', 'ana@exemplo.com', 'uuid-', 'Souza', 'Paula', 'Lima', 'Rocha', 'Fábio',
  '"idade"', '"telefone"', '"email"', '"respondidoEm"', '"vinculoId"', '"inicio"', '2024-01-02'];
function semSensiveis(dados) {
  const json = JSON.stringify(dados);
  for (const p of PROIBIDOS) assert.ok(!json.includes(p), 'não pode aparecer no snapshot: ' + p);
  assert.ok(!/"41"|:41[,}]/.test(json), 'idade não aparece');
}

test('equipe: formato completo do snapshot', () => {
  const d = M.equipe(entradaEquipe(false), { geradoEm: GERADO });
  assert.equal(d.modelo, 'equipe');
  assert.equal(d.versao, M.VERSAO);
  assert.equal(d.geradoEm, GERADO);
  assert.match(d.titulo, /Relatório de equipe — Cartório Exemplo/);
  assert.deepEqual(d.empresa, { nome: 'Cartório Exemplo', cidade: 'Boa Vista' });
  assert.equal(d.consultor, 'Wellington V.');
  // desligado fica de fora (e as relações dele também)
  assert.equal(d.numeros.pessoas, 5);
  assert.equal(d.numeros.comTeste, 4);
  assert.equal(d.pares.length, 5);
  assert.equal(d.colaboradores.length, 5);
  // organograma: Ana no topo, Bruno e Eva abaixo, Carla e Davi abaixo de Bruno
  const raiz = d.organograma.raizes[0];
  assert.equal(raiz.nome, 'Ana P.');
  assert.equal(raiz.codigo, 'DI');
  assert.deepEqual(raiz.filhos.map((f) => f.nome), ['Bruno L.', 'Eva N.']);
  assert.deepEqual(raiz.filhos[0].filhos.map((f) => [f.nome, f.codigo]), [['Carla D.', 'CS'], ['Davi R.', null]]);
  assert.equal(raiz.filhos[0].codigo, 'SC', 'código do resultado (não o recalculado)');
  // sumário: equilíbrio, harmonia, até 3 destaques e 3 alertas
  assert.ok(d.sumario.equilibrio.rotulo);
  assert.equal(typeof d.sumario.harmonia, 'number');
  assert.ok(['fluido', 'atencao', 'tensao'].includes(d.sumario.harmoniaNivel));
  assert.equal(d.sumario.destaques.length, 3);
  assert.equal(d.sumario.alertas.length, 3);
  assert.match(d.sumario.alertas[0], /tensão/);
  // pares: tensão primeiro; cada um com sinergias, riscos e dicas
  assert.equal(d.pares[0].nivel, 'tensao');
  const niveis = d.pares.map((p) => p.nivel);
  assert.deepEqual(niveis, niveis.slice().sort((a, b) => ['tensao', 'atencao', 'fluido', 'indefinido'].indexOf(a) - ['tensao', 'atencao', 'fluido', 'indefinido'].indexOf(b)));
  for (const p of d.pares) { assert.ok(Array.isArray(p.sinergias) && Array.isArray(p.riscos) && p.dicas.length >= 1); }
  // equilíbrio do time
  assert.deepEqual(Object.keys(d.equilibrio.media), ['D', 'I', 'S', 'C']);
  assert.deepEqual(d.equilibrio.semTeste, [{ nome: 'Davi R.', cargo: 'Vendedor' }]);
  // guia por líder: Ana (Bruno, Eva) e Bruno (Carla, Davi)
  assert.deepEqual(d.liderancas.map((l) => l.nome), ['Ana P.', 'Bruno L.']);
  assert.deepEqual(d.liderancas[1].liderados.map((x) => x.nome), ['Carla D.', 'Davi R.']);
  assert.ok(d.liderancas[0].liderados[0].comoConduzir.length >= 1);
  // "como liderar" resumido de cada colaborador
  const ana = d.colaboradores[0];
  assert.equal(ana.codigo, 'DI');
  assert.ok(ana.estilo);
  assert.match(ana.resumo, /^Ana P\. tende a/, 'primeira frase inteira, sem cortar na inicial');
  assert.deepEqual(ana.secoes.map((s) => s.chave), ['comunicacao', 'delegar', 'feedback', 'motivacao', 'estresse']);
  for (const s of ana.secoes) assert.ok(s.itens.length >= 1 && s.itens.length <= 2);
  const davi = d.colaboradores[3];
  assert.equal(davi.codigo, null);
  assert.deepEqual(davi.secoes, []);
  assert.equal(d.foco, null);
  assert.ok(d.avisos.limites.length >= 3);
  assert.ok(d.avisos.observacoes.some((t) => /sem teste/.test(t)));
  assert.ok(JSON.stringify(d).length < 300 * 1024, 'cabe no limite de 300 KB');
});

test('equipe com foco: encaixe do candidato e organograma com ele marcado', () => {
  const d = M.equipe(entradaEquipe(true), { geradoEm: GERADO });
  const f = d.foco;
  assert.equal(f.nome, 'Gabriel R.');
  assert.equal(f.codigo, 'IS');
  assert.equal(typeof f.pontuacao, 'number');
  assert.equal(f.lider.nome, 'Bruno L.');
  assert.equal(f.diretos[0].nome, 'Carla D.');
  assert.equal(f.recomendacoes90.length, 3);
  assert.ok(f.riscos.some((t) => /tensão|atenção/.test(t)), 'nível com acento no texto');
  const bruno = f.organograma.raizes[0].filhos[0];
  const cand = bruno.filhos.find((x) => x.foco);
  assert.ok(cand, 'candidato no organograma, abaixo do líder');
  assert.equal(cand.codigo, 'IS');
  // a análise do time não muda por causa do candidato
  const sem = M.equipe(entradaEquipe(false), { geradoEm: GERADO });
  assert.deepEqual(d.equilibrio, sem.equilibrio);
  assert.deepEqual(d.organograma, sem.organograma);
});

test('determinismo: mesma entrada e geradoEm -> mesmo snapshot', () => {
  const a = M.equipe(entradaEquipe(true), { geradoEm: GERADO });
  const b = M.equipe(entradaEquipe(true), { geradoEm: GERADO });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  const l1 = M.lideranca({ pessoa: { nome: 'Bruno Lima', cargo: 'Gerente', resultado: R.SC }, lider: { nome: 'Ana Souza', resultado: R.DI }, empresa: { nome: 'X' } }, { geradoEm: GERADO });
  const l2 = M.lideranca({ pessoa: { nome: 'Bruno Lima', cargo: 'Gerente', resultado: R.SC }, lider: { nome: 'Ana Souza', resultado: R.DI }, empresa: { nome: 'X' } }, { geradoEm: GERADO });
  assert.equal(JSON.stringify(l1), JSON.stringify(l2));
  assert.equal(JSON.stringify(M.pessoa({ pessoa: { nome: 'Carla Dias', resultado: R.CS } }, { geradoEm: GERADO })),
    JSON.stringify(M.pessoa({ pessoa: { nome: 'Carla Dias', resultado: R.CS } }, { geradoEm: GERADO })));
  // snapshot é JSON puro
  assert.deepEqual(JSON.parse(JSON.stringify(a)), a);
  // sem geradoEm: data de agora
  assert.match(M.pessoa({ pessoa: { nome: 'Carla', resultado: R.CS } }).geradoEm, /^\d{4}-\d{2}-\d{2}T/);
});

test('nenhum dado sensível no snapshot (telefone, e-mail, idade, ids do banco, sobrenome)', () => {
  semSensiveis(M.equipe(entradaEquipe(true), { geradoEm: GERADO }));
  semSensiveis(M.lideranca({ pessoa: { nome: 'Bruno Lima', cargo: 'Gerente', telefone: '5595990000001', email: 'ana@exemplo.com', idade: 41, resultado: R.SC },
    lider: { nome: 'Ana Paula Souza', telefone: '5595991112222', resultado: R.DI }, empresa: { nome: 'Cartório' } }, { geradoEm: GERADO }));
  semSensiveis(M.pessoa({ pessoa: { nome: 'Carla Dias', telefone: '5595991112222', email: 'ana@exemplo.com', idade: 41, resultado: R.CS } }, { geradoEm: GERADO }));
});

test('lideranca: guia curto para o líder sobre uma pessoa', () => {
  const d = M.lideranca({ pessoa: { nome: 'Bruno Lima', cargo: 'Gerente', resultado: R.SC }, lider: { nome: 'Ana Souza', resultado: R.DI }, empresa: { nome: 'Cartório' }, consultor: 'Wellington V.' }, { geradoEm: GERADO });
  assert.equal(d.modelo, 'lideranca');
  assert.equal(d.versao, M.VERSAO);
  assert.equal(d.titulo, 'Como liderar Bruno L. — Gerente');
  assert.equal(d.geradoEm, GERADO);
  assert.equal(d.pessoa.nome, 'Bruno L.');
  assert.equal(d.pessoa.codigo, 'SC');
  assert.deepEqual(d.lider, { nome: 'Ana S.', codigo: 'DI', foto: null });
  assert.ok(['fluido', 'atencao', 'tensao'].includes(d.relacao.nivel));
  assert.ok(d.relacao.dicas.length >= 1);
  assert.ok(d.resumo.length > 20);
  const chaves = d.secoes.map((s) => s.chave);
  for (const k of ['comunicacao', 'delegar', 'feedback', 'motivacao', 'plano', 'voceEEla']) assert.ok(chaves.includes(k), k);
  assert.ok(d.secoes.find((s) => s.chave === 'plano').etapas.length === 3);
  assert.match(d.aviso, /DISC/);
  // sem líder: sem relação nem "você e esta pessoa"
  const s = M.lideranca({ pessoa: { nome: 'Bruno Lima', resultado: R.SC }, lider: null, empresa: { nome: 'X' } }, { geradoEm: GERADO });
  assert.equal(s.lider, null);
  assert.equal(s.relacao, null);
  assert.ok(!s.secoes.some((x) => x.chave === 'voceEEla'));
  assert.equal(s.titulo, 'Como liderar Bruno L.');
});

test('pessoa: documento de desenvolvimento, tom pessoal', () => {
  const d = M.pessoa({ pessoa: { nome: 'Carla Dias', resultado: R.CS }, consultor: 'Wellington V.' }, { geradoEm: GERADO });
  assert.equal(d.modelo, 'pessoa');
  assert.equal(d.titulo, 'Seu perfil DISC — Carla D.');
  assert.equal(d.pessoa.nome, 'Carla D.');
  assert.equal(d.pessoa.primeiroNome, 'Carla');
  assert.equal(d.pessoa.codigo, 'CS');
  assert.equal(d.pessoa.primario.letra, 'C');
  assert.match(d.frase, /^Você tende a ser/);
  assert.deepEqual(d.fatores.map((f) => f.letra), ['D', 'I', 'S', 'C']);
  const ids = d.secoes.map((s) => s.id);
  for (const id of ['fortes', 'atencao', 'pressao', 'comunicacao', 'plano']) assert.ok(ids.includes(id), id);
  assert.match(d.aviso, /não existe perfil certo ou errado/i);
});

test('resultado inválido: lideranca/pessoa recusam; equipe trata como "sem teste"', () => {
  assert.throws(() => M.pessoa({ pessoa: { nome: 'X', resultado: null } }), /Resultado DISC inválido/);
  assert.throws(() => M.lideranca({ pessoa: { nome: 'X', resultado: { percentuais: { D: 'a' } } } }), /Resultado DISC inválido/);
  assert.equal(M.resultadoValido({ percentuais: { D: 0, I: 0, S: 0, C: 0 } }), null);
  assert.deepEqual(M.resultadoValido({ percentuais: { D: 10, I: 50, S: 20, C: 20 } }), { percentuais: { D: 10, I: 50, S: 20, C: 20 }, codigo: 'IS' });
  const d = M.equipe({ empresa: { nome: 'Y' }, colaboradores: [{ pessoaId: 'a', nome: 'Zé', status: 'ativo', resultado: { percentuais: { D: 'x' } } }], relacoes: [] }, { geradoEm: GERADO });
  assert.equal(d.colaboradores[0].codigo, null);
  assert.equal(d.equilibrio.status, 'sem-dados');
  assert.deepEqual(d.sumario.alertas.length <= 3, true);
  // entrada vazia não quebra
  const v = M.equipe({}, { geradoEm: GERADO });
  assert.equal(v.numeros.pessoas, 0);
  assert.deepEqual(v.organograma.raizes, []);
});

/* ------------------------------------------------------------------ rodada 3: Parte 2, régua, combinação, mapa, simples, fotos */
const EX = require('../js/disc-exigido.js');
// exigido em string de 40 dígitos: cada grupo D,I,S,C; "4321" puxa para D/I (perfil exigido DI)
const EXIGIDO_DI = '4321'.repeat(10);
const FOTO = 'data:image/jpeg;base64,' + 'A'.repeat(200) + '==';

test('pessoa completo sem exigido: régua, combinação e mapa; sem bloco da Parte 2', () => {
  const d = M.pessoa({ pessoa: { nome: 'Carla Dias', resultado: R.CS } }, { geradoEm: GERADO });
  assert.equal(d.variante, 'completo');
  assert.equal(d.exigido, null);
  assert.deepEqual(d.regua.limites, [15, 22, 29, 36]);
  for (const f of d.fatores) {
    assert.ok(['muito_baixa', 'baixa', 'media', 'alta', 'muito_alta'].includes(f.faixa), f.letra);
    assert.ok(f.faixaRotulo);
  }
  assert.equal(d.fatores[3].faixa, 'muito_alta'); // C 50%
  assert.equal(d.mapa.pontos.length, 1);
  const p = d.mapa.pontos[0];
  assert.deepEqual(p.natural, EX.eixos(R.CS.percentuais), 'mesma convenção do DISC_EXIGIDO (foco + = tarefas)');
  assert.ok(p.natural.ritmo < 0, 'CS é cauteloso');
  assert.equal(p.exigido, null);
  if (d.combinacao) assert.ok(d.combinacao.nome.length > 2);
});

test('pessoa completo com exigido (40 dígitos ou objeto): índice, faixa, textos e seta no mapa', () => {
  const a = M.pessoa({ pessoa: { nome: 'Carla Dias', resultado: R.CS, exigido: EXIGIDO_DI } }, { geradoEm: GERADO });
  const b = M.pessoa({ pessoa: { nome: 'Carla Dias', resultado: R.CS, exigido: EX.calcular(EXIGIDO_DI) } }, { geradoEm: GERADO });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.equal(a.exigido.codigo, 'DI');
  const esperado = EX.adaptacao(R.CS, EX.calcular(EXIGIDO_DI));
  assert.equal(a.exigido.indice, esperado.indice);
  assert.equal(a.exigido.faixa, esperado.faixa);
  assert.ok(a.exigido.textos.length >= 1);
  assert.deepEqual(a.mapa.pontos[0].exigido, esperado.eixos.exigido);
  // exigido inválido: ignorado
  const c = M.pessoa({ pessoa: { nome: 'Carla Dias', resultado: R.CS, exigido: '1111'.repeat(10) } }, { geradoEm: GERADO });
  assert.equal(c.exigido, null);
});

test('pessoaSimples: 3 forças, 3 cuidados, 3 hábitos, 4 fatores com faixa; sem seções longas', () => {
  const d = M.pessoaSimples({ pessoa: { nome: 'Carla Dias', resultado: R.CS, exigido: EXIGIDO_DI }, consultor: 'W.' }, { geradoEm: GERADO });
  assert.equal(d.modelo, 'pessoa');
  assert.equal(d.variante, 'simples');
  assert.match(d.titulo, /resumo/);
  assert.equal(d.secoes, undefined);
  for (const k of ['forcas', 'cuidados', 'habitos']) {
    assert.equal(d[k].length, 3, k);
    for (const it of d[k]) assert.ok(it.titulo || it.texto);
  }
  assert.equal(d.fatores.length, 4);
  for (const f of d.fatores) assert.ok(f.faixa && (!f.texto || (f.texto.excesso === null && f.texto.falta === null)));
  assert.ok(d.exigido.textos.length <= 2);
  assert.deepEqual(M.pessoa({ pessoa: { nome: 'Carla Dias', resultado: R.CS } }, { geradoEm: GERADO, variante: 'simples' }).forcas,
    M.pessoaSimples({ pessoa: { nome: 'Carla Dias', resultado: R.CS } }, { geradoEm: GERADO }).forcas);
});

test('liderança com exigido: bloco de esforço com textos do líder, mapa e combinação', () => {
  const sem = M.lideranca({ pessoa: { nome: 'Bruno Lima', resultado: R.SC }, empresa: { nome: 'X' } }, { geradoEm: GERADO });
  assert.equal(sem.exigido, null);
  assert.equal(sem.mapa.pontos[0].exigido, null);
  const d = M.lideranca({ pessoa: { nome: 'Bruno Lima', resultado: R.SC, exigido: EXIGIDO_DI }, empresa: { nome: 'X' } }, { geradoEm: GERADO });
  assert.equal(d.exigido.codigo, 'DI');
  assert.ok(d.exigido.indice >= 20);
  assert.ok(d.exigido.textos.some((t) => /Bruno L\./.test(t)), 'textos do líder com o nome curto');
  assert.ok(d.mapa.pontos[0].exigido);
});

test('equipe: mapa com todos, como o grupo decide, pressão média e combinações', () => {
  const e = entradaEquipe(true);
  const sem = M.equipe(e, { geradoEm: GERADO });
  assert.equal(sem.pressao, null, 'sem Parte 2: sem pressão');
  assert.equal(sem.mapa.pontos.length, 5, '4 com teste + candidato');
  assert.ok(sem.mapa.pontos.find((p) => p.id === 'foco').destaque);
  assert.ok(sem.decisao && sem.decisao.textos.length === 3);
  assert.equal(sem.decisao.bases.reduce((t, b) => t + b.qtd, 0), 4);
  e.colaboradores[0].exigido = EXIGIDO_DI;
  e.colaboradores[1].exigido = { percentuais: { D: 35, I: 30, S: 15, C: 20 }, codigo: 'DI' };
  const d = M.equipe(e, { geradoEm: GERADO });
  assert.equal(d.pressao.comExigido, 2);
  assert.ok(d.pressao.media >= 0 && d.pressao.media <= 100);
  assert.equal(d.pressao.pessoas[0].indice >= d.pressao.pessoas[1].indice, true);
  assert.ok(d.colaboradores[1].exigido.indice > 0);
  assert.ok(d.mapa.pontos.find((p) => p.id === 'p2').exigido);
  semSensiveis(d);
});

test('fotos: só data:image/jpeg válida entra no snapshot; senão null', () => {
  const e = entradaEquipe(true);
  e.colaboradores[0].foto = FOTO;
  e.colaboradores[1].foto = 'https://exemplo.com/x.jpg';
  e.colaboradores[2].foto = 'data:image/png;base64,AAAA';
  e.foco.foto = FOTO;
  const d = M.equipe(e, { geradoEm: GERADO });
  assert.equal(d.colaboradores[0].foto, FOTO);
  assert.equal(d.colaboradores[1].foto, null);
  assert.equal(d.colaboradores[2].foto, null);
  assert.equal(d.organograma.raizes[0].foto, FOTO);
  assert.equal(d.liderancas.find((l) => l.nome === 'Ana P.').foto, FOTO);
  assert.equal(d.foco.foto, FOTO);
  assert.ok(!JSON.stringify(d).includes('exemplo.com'));
  assert.equal(M.pessoa({ pessoa: { nome: 'Carla Dias', resultado: R.CS, foto: FOTO } }, { geradoEm: GERADO }).pessoa.foto, FOTO);
  assert.equal(M.pessoa({ pessoa: { nome: 'Carla Dias', resultado: R.CS, foto: 'data:image/jpeg;base64,<x>' } }, { geradoEm: GERADO }).pessoa.foto, null);
  assert.equal(M.pessoa({ pessoa: { nome: 'Carla Dias', resultado: R.CS, foto: 'data:image/jpeg;base64,' + 'A'.repeat(40001) } }, { geradoEm: GERADO }).pessoa.foto, null);
  const l = M.lideranca({ pessoa: { nome: 'Bruno Lima', resultado: R.SC, foto: FOTO }, lider: { nome: 'Ana Souza', resultado: R.DI, foto: FOTO }, empresa: { nome: 'X' } }, { geradoEm: GERADO });
  assert.equal(l.pessoa.foto, FOTO);
  assert.equal(l.lider.foto, FOTO);
});

test('determinismo e sem dados sensíveis também com exigido e na versão simples', () => {
  const ent = () => ({ pessoa: { nome: 'Carla Dias', telefone: '5595991112222', email: 'ana@exemplo.com', idade: 41, resultado: R.CS, exigido: EXIGIDO_DI } });
  assert.equal(JSON.stringify(M.pessoa(ent(), { geradoEm: GERADO })), JSON.stringify(M.pessoa(ent(), { geradoEm: GERADO })));
  assert.equal(JSON.stringify(M.pessoaSimples(ent(), { geradoEm: GERADO })), JSON.stringify(M.pessoaSimples(ent(), { geradoEm: GERADO })));
  semSensiveis(M.pessoa(ent(), { geradoEm: GERADO }));
  semSensiveis(M.pessoaSimples(ent(), { geradoEm: GERADO }));
  const l = () => M.lideranca({ pessoa: { nome: 'Bruno Lima', telefone: '5595990000001', resultado: R.SC, exigido: EXIGIDO_DI }, empresa: { nome: 'X' } }, { geradoEm: GERADO });
  assert.equal(JSON.stringify(l()), JSON.stringify(l()));
  semSensiveis(l());
});
