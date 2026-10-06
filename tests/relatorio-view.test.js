'use strict';
// Página pública do relatório: formatação, token da URL, montagem do HTML, escape e privacidade.
const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../js/relatorio-view.js');
const MOTOR = require('../js/relatorio-motor.js');
const PROCESSO = require('./fixtures/processo-exemplo.json');

function relatorio() {
  return MOTOR.montar(JSON.parse(JSON.stringify(PROCESSO)), { geradoEm: '2026-10-02T15:00:00.000Z' });
}

test('formatação pt-BR: número com 1 casa, moeda, porcentagem, datas', () => {
  assert.equal(V.numero(87.94), '87,9');
  assert.equal(V.numero(94), '94,0');
  assert.equal(V.numero(1234.5), '1.234,5');
  assert.equal(V.numero(null), '—');
  assert.equal(V.numero(NaN), '—');
  assert.equal(V.numeroCurto(8), '8');
  assert.equal(V.numeroCurto(7.5), '7,5');
  assert.equal(V.moeda(2431.4), 'R$ 2.431');
  assert.equal(V.moeda(undefined), '—');
  assert.equal(V.pct(52.5), '52,5%');
  assert.equal(V.pct(15), '15%');
  assert.equal(V.data('2026-08-03'), '03 ago 2026');
  assert.equal(V.data('2026-10-02T15:00:00.000Z'), '02 out 2026');
  assert.equal(V.data('lixo'), '');
  assert.equal(V.periodo({ inicio: '2026-08-03', fim: '2026-10-02' }), '03 ago — 02 out 2026');
  assert.equal(V.periodo({ inicio: '2025-12-01', fim: '2026-01-10' }), '01 dez 2025 — 10 jan 2026');
  assert.equal(V.periodo(null), '');
});

test('rótulos de situação, aderência e confiabilidade', () => {
  assert.equal(V.rotuloSituacao('aprovado'), 'Aprovado');
  assert.equal(V.rotuloSituacao('nao_recomendado'), 'Não recomendado');
  assert.equal(V.rotuloAderencia('ideal'), 'Ideal');
  assert.equal(V.rotuloConfiabilidade('baixa'), 'Pouco confiável');
  assert.equal(V.rotuloSituacao('xyz'), '—');
});

test('token da URL: ?r=TOKEN ou #r-TOKEN, só caracteres seguros', () => {
  const t = 'a'.repeat(40);
  assert.equal(V.tokenDaUrl('?r=' + t, ''), t);
  assert.equal(V.tokenDaUrl('', '#r-' + t), t);
  assert.equal(V.tokenDaUrl('?x=1&r=' + t + '&y=2', ''), t);
  assert.equal(V.tokenDaUrl('?r=' + t, '#r-outro-token-qualquer'), t, 'a query vence o hash');
  assert.equal(V.tokenDaUrl('', ''), '');
  assert.equal(V.tokenDaUrl('?r=abc', ''), '', 'curto demais');
  assert.equal(V.tokenDaUrl('?r=%3Cscript%3Ealert(1)%3C%2Fscript%3E', ''), '');
  assert.equal(V.tokenDaUrl('', '#r-' + t + '"onload'), '');
  assert.equal(V.tokenDaUrl('?r=%E0%A4%A', ''), '', 'URL malformada não quebra');
});

test('esc escapa os 5 caracteres perigosos', () => {
  assert.equal(V.esc('<a href="x" onclick=\'y\'>&</a>'), '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
  assert.equal(V.esc(null), '');
  assert.equal(V.esc(0), '0');
});

test('montarHtml desenha todas as seções do relatório do motor', () => {
  const rel = relatorio();
  const html = V.montarHtml(rel);
  for (const id of ['capa', 'indice', 'sumario', 'atracao', 'tecnica', 'disc', 'ranking', 'encerramento', 'rodape']) {
    assert.match(html, new RegExp('data-secao="' + id + '"'), 'seção ' + id);
  }
  assert.match(html, /<img class="marca-doc__logo" src="assets\/marca\/gsc-logo-negativo\.svg" alt="Gestão sem Caos"/);
  assert.ok(!/assets\/icone\.svg/.test(html), 'sem o logo da Notus no documento');
  assert.ok(html.includes(V.esc(rel.processo.consultor)), 'consultor no documento');
  assert.ok(html.includes(V.esc(rel.sumario.recomendacao.nome)), 'líder no documento');
  assert.ok(html.includes(V.numero(rel.sumario.recomendacao.score)), 'score com vírgula');
  // cada finalista aparece no ranking
  for (const l of rel.ranking.linhas) assert.ok(html.includes(V.esc(l.nome)), l.nome);
  // etapa pendente sinalizada
  assert.match(html, /Etapa pendente/);
  // números em pt-BR (vírgula), nunca ponto decimal nos scores
  assert.ok(!/>\d+\.\d<\/td>/.test(html), 'nada de ponto decimal nas tabelas');
  // todos os textos (regra) que o relatório referencia aparecem
  const usados = [rel.sumario.recomendacao.textoId, rel.atracao.textoId, rel.encerramento.textoId]
    .concat(rel.sumario.leituras.map((x) => x.textoId))
    .concat(rel.encerramento.proximosPassos)
    .concat(rel.ranking.linhas.map((l) => l.analiseTextoId));
  for (const id of usados) {
    const t = V.texto(rel, id);
    assert.ok(t, 'texto ' + id + ' existe');
    assert.ok(html.includes(V.esc(t).slice(0, 40)), 'texto ' + id + ' desenhado');
  }
});

test('nunca desenha telefone, e-mail ou dados sensíveis, mesmo que venham no JSON', () => {
  const rel = relatorio();
  rel.ranking.linhas[0].telefone = '5595991112222';
  rel.ranking.linhas[0].email = 'ana@exemplo.com';
  rel.ranking.linhas[0].idade = 28;
  rel.ranking.linhas[0].estadoCivil = 'Casada';
  rel.disc.quadro[0].genero = 'Feminino';
  rel.processo.whatsapp = '5595990000000';
  rel.atracao.estadoCivil = [{ rotulo: 'Casado', qtd: 3 }];
  rel.atracao.filhos = [{ rotulo: 'Sim', qtd: 3 }];
  const html = V.montarHtml(rel);
  for (const proibido of ['5595991112222', '5595990000000', 'ana@exemplo.com', 'Casada', 'Feminino', 'Estado civil', 'Filhos', 'Gênero', 'clickupListId']) {
    assert.ok(!html.includes(proibido), 'não pode aparecer: ' + proibido);
  }
});

test('escapa todo texto vindo do relatório (XSS)', () => {
  const rel = relatorio();
  const ataque = '<img src=x onerror="alert(1)">';
  rel.processo.empresa = ataque;
  rel.processo.consultor = ataque;
  rel.capa.titulo = ataque;
  rel.capa.numeros[0].rotulo = ataque;
  rel.sumario.recomendacao.nome = ataque;
  rel.sumario.leituras[0].titulo = ataque;
  rel.textos[rel.sumario.recomendacao.textoId].texto = ataque;
  rel.ranking.linhas[1].nome = ataque;
  rel.ranking.linhas[1].situacao = '"><script>x</script>';
  rel.etapas[0].nome = ataque;
  rel.etapas[0].id = '"><b>';
  rel.disc.quadro[0].aderencia = '"><i>';
  rel.atracao.porStatus[0].status = ataque;
  const html = V.montarHtml(rel);
  assert.ok(!html.includes('<img src=x'), 'img injetada');
  assert.ok(!html.includes('<script>'), 'script injetado');
  assert.ok(html.includes('data-etapa="&quot;&gt;&lt;b&gt;"'), 'atributo escapado');
  assert.ok(!html.includes('"><i>'), 'classe quebrada');
  assert.ok(html.includes('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'));
});

test('relatório mínimo ou vazio não quebra', () => {
  const minimo = { versao: 1, processo: { nome: 'Teste' }, textos: {} };
  const html = V.montarHtml(minimo);
  assert.match(html, /data-secao="capa"/);
  assert.match(html, /Sem recomendação ainda/);
  assert.match(V.montarHtml(null), /Relatório não encontrado ou fora do ar\./);
});

test('render escreve no elemento e marca aria-busy', () => {
  const el = { innerHTML: '', attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } };
  V.render(relatorio(), el);
  assert.match(el.innerHTML, /data-secao="ranking"/);
  assert.equal(el.attrs['aria-busy'], 'false');
  V.mostrarErro(el);
  assert.match(el.innerHTML, /Relatório não encontrado ou fora do ar\./);
  assert.equal(el.attrs['data-estado'], 'erro');
});

/* ------------------------------------------------------------------ modelos da fase 2 (equipe, liderança, pessoa) */
const MODELOS = require('../js/relatorio-modelos.js');
const GERADO = '2026-10-05T12:00:00.000Z';
const RES = {
  DI: { percentuais: { D: 45, I: 25, S: 15, C: 15 }, codigo: 'DI' },
  SC: { percentuais: { D: 15, I: 20, S: 45, C: 20 }, codigo: 'SC' },
  CS: { percentuais: { D: 10, I: 15, S: 25, C: 50 }, codigo: 'CS' },
  IS: { percentuais: { D: 20, I: 40, S: 25, C: 15 }, codigo: 'IS' }
};
function dadosEquipe(foco) {
  return MODELOS.equipe({
    empresa: { nome: 'Cartório Exemplo', cidade: 'Boa Vista' }, consultor: 'Wellington V.',
    colaboradores: [
      { pessoaId: 'a', nome: 'Ana Paula Souza', telefone: '5595991112222', cargo: 'Diretora', status: 'ativo', resultado: RES.DI },
      { pessoaId: 'b', nome: 'Bruno Lima', cargo: 'Gerente', status: 'ativo', resultado: RES.SC },
      { pessoaId: 'c', nome: 'Carla Dias', cargo: 'Analista', status: 'ativo', resultado: RES.CS },
      { pessoaId: 'd', nome: 'Davi Reis', cargo: 'Vendedor', status: 'ativo', resultado: null }
    ],
    relacoes: [{ de: 'a', para: 'b', tipo: 'lidera' }, { de: 'a', para: 'd', tipo: 'lidera' }, { de: 'b', para: 'c', tipo: 'lidera' }, { de: 'c', para: 'd', tipo: 'direto' }],
    foco: foco ? { nome: 'Gabriel Rocha', cargo: 'Analista', resultado: RES.IS, relacoes: [{ de: 'b', para: 'foco', tipo: 'lidera' }] } : undefined
  }, { geradoEm: GERADO });
}

test('modelo equipe: capa, sumário, organograma, equilíbrio, relações, guia por líder, como liderar, encaixe e limites', () => {
  const d = dadosEquipe(true);
  const html = V.montarHtml(d);
  assert.match(html, /data-modelo="equipe"/);
  for (const id of ['capa', 'indice', 'sumario', 'organograma', 'equilibrio', 'relacoes', 'lideres', 'pessoas', 'foco', 'encerramento', 'rodape']) {
    assert.match(html, new RegExp('data-secao="' + id + '"'), 'seção ' + id);
  }
  assert.ok(html.includes('Cartório Exemplo') && html.includes('Wellington V.') && html.includes('05 out 2026'));
  for (const t of d.sumario.destaques.concat(d.sumario.alertas)) assert.ok(html.includes(V.esc(t)), t);
  for (const p of d.pares) assert.ok(html.includes('par-doc--' + p.nivel));
  assert.ok(html.includes('Ana P.') && html.includes('Davi R.'));
  assert.ok(!html.includes('data-secao="ranking"'), 'não desenha o processo seletivo');
  // processo atual continua igual sem modelo
  assert.match(V.montarHtml(relatorio()), /data-secao="ranking"/);
  // sem foco: sem a seção de encaixe
  assert.ok(!V.montarHtml(dadosEquipe(false)).includes('data-secao="foco"'));
});

test('organogramaHtml: árvore de cartões com letra e cor DISC, sem teste com traço, foco marcado', () => {
  const d = dadosEquipe(true);
  const html = V.organogramaHtml(d.organograma);
  assert.match(html, /^<div class="org"/);
  assert.equal((html.match(/class="org-cartao /g) || []).length, 4);
  assert.match(html, /org-cartao--D[^]*disc-fundo-D">D</);
  assert.match(html, /org-cartao--S/);
  assert.match(html, /org-cartao--sem[^]*>–</);
  assert.match(html, /org__filhos org__filhos--linha/, 'topo com 2 liderados: linha horizontal');
  assert.match(html, /Sem teste/);
  const comFoco = V.organogramaHtml(d.foco.organograma);
  assert.match(comFoco, /org-cartao--foco/);
  assert.match(comFoco, /candidato/);
  // também aceita o organograma cru do DISC_COMPATIBILIDADE, com focoId
  const C = require('../js/compatibilidade.js');
  const org = C.montar({ pessoas: [{ id: 'x', nome: 'Xis Um', percentuais: RES.CS.percentuais }, { id: 'y', nome: 'Ípsilon Dois', percentuais: null }], relacoes: [] }).organograma;
  const solto = V.organogramaHtml(org, { focoId: 'y' });
  assert.match(solto, /org__grade/);
  assert.match(solto, /org-cartao--sem org-cartao--foco/);
  assert.match(V.organogramaHtml(null), /Nenhum colaborador/);
  // nada de bolhas: sem border-radius 50% no HTML e nenhum SVG de círculo
  assert.ok(!/<circle/.test(html));
});

test('modelo liderança: documento curto para o líder', () => {
  const d = MODELOS.lideranca({ pessoa: { nome: 'Bruno Lima', cargo: 'Gerente', resultado: RES.SC }, lider: { nome: 'Ana Souza', resultado: RES.DI }, empresa: { nome: 'Cartório' } }, { geradoEm: GERADO });
  const html = V.montarHtml(d);
  assert.match(html, /data-modelo="lideranca"/);
  for (const id of ['capa', 'resumo', 'liderar', 'encerramento', 'rodape']) assert.match(html, new RegExp('data-secao="' + id + '"'));
  assert.match(html, /Como liderar <em>Bruno L\.<\/em>/);
  for (const s of d.secoes) assert.ok(html.includes(V.esc(s.titulo)), s.titulo);
  assert.ok(html.includes('Você e Bruno L.'));
  assert.ok(html.includes(V.esc(d.aviso)));
});

test('modelo pessoa: documento de desenvolvimento, acolhedor', () => {
  const d = MODELOS.pessoa({ pessoa: { nome: 'Carla Dias', resultado: RES.CS } }, { geradoEm: GERADO });
  const html = V.montarHtml(d);
  assert.match(html, /data-modelo="pessoa"/);
  for (const id of ['capa', 'perfil', 'fortes', 'atencao', 'pressao', 'comunicacao', 'plano', 'encerramento', 'rodape']) assert.match(html, new RegExp('data-secao="' + id + '"'), id);
  assert.match(html, /Olá, Carla\./);
  assert.ok(html.includes(V.esc(d.frase)));
  for (const s of d.secoes) assert.ok(html.includes(V.esc(s.titulo)));
  assert.ok(!/empresa|vaga|aderência/i.test(html.replace(/Gestão <em>sem Caos<\/em>/g, '')), 'sem linguagem de seleção');
});

test('modelos novos: escape (XSS), modelo desconhecido e campos sensíveis ignorados', () => {
  const ataque = '<img src=x onerror="alert(1)">';
  const d = dadosEquipe(true);
  d.empresa.nome = ataque;
  d.organograma.raizes[0].nome = ataque;
  d.organograma.raizes[0].codigo = '"><b data-x>';
  d.pares[0].riscos[0] = ataque;
  d.pares[0].nivel = '"><i data-y>';
  d.sumario.destaques[0] = ataque;
  d.colaboradores[0].secoes[0].itens[0] = ataque;
  d.colaboradores[0].telefone = '5595991112222';
  d.colaboradores[0].email = 'ana@exemplo.com';
  d.foco.nome = ataque;
  const html = V.montarHtml(d);
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('data-x>') && !html.includes('data-y>'));
  assert.ok(!html.includes('5595991112222') && !html.includes('ana@exemplo.com'));
  const p = MODELOS.pessoa({ pessoa: { nome: 'Carla Dias', resultado: RES.CS } }, { geradoEm: GERADO });
  p.frase = ataque; p.pessoa.primeiroNome = ataque; p.secoes[0].itens[0].titulo = ataque;
  assert.ok(!V.montarHtml(p).includes('<img src=x'));
  const l = MODELOS.lideranca({ pessoa: { nome: 'Bruno Lima', resultado: RES.SC }, lider: null, empresa: { nome: ataque } }, { geradoEm: GERADO });
  l.pessoa.nome = ataque; l.secoes[0].itens[0] = ataque;
  assert.ok(!V.montarHtml(l).includes('<img src=x'));
  assert.match(V.montarHtml({ modelo: 'outro' }), /Relatório não encontrado/);
  assert.match(V.montarHtml({ modelo: 'constructor' }), /Relatório não encontrado/);
  // snapshot mínimo de cada modelo não quebra
  for (const m of ['equipe', 'lideranca', 'pessoa']) assert.match(V.montarHtml({ modelo: m }), /data-secao="capa"/);
});

/* ------------------------------------------------------------------ rodada 3: mapa ritmo × foco, régua, Parte 2, simples, fotos */
const EXIGIDO_DI = '4321'.repeat(10);
const FOTO = 'data:image/jpeg;base64,' + 'A'.repeat(200) + '==';
function cx(html, id) {
  const m = html.match(new RegExp('data-id="' + id + '"><title>[^<]*</title>(?:<circle cx="[^"]+" cy="[^"]+" r="9"[^>]*>)?<circle class="mapa-rf__natural" cx="([\\d.]+)" cy="([\\d.]+)"'));
  assert.ok(m, 'ponto ' + id);
  return { x: Number(m[1]), y: Number(m[2]) };
}

test('mapaRitmoFocoHtml: quadrantes D/I/S/C, posição pelo sinal do DISC_EXIGIDO (foco + = tarefas), seta tracejada laranja', () => {
  const pontos = [
    { id: 'd', nome: 'Dani', natural: { ritmo: 40, foco: 40 } },     // acelerado + tarefas -> D (cima, esquerda)
    { id: 'i', nome: 'Ivo', natural: { ritmo: 40, foco: -40 } },     // acelerado + pessoas -> I (cima, direita)
    { id: 's', nome: 'Sara', natural: { ritmo: -40, foco: -40 }, exigido: { ritmo: 30, foco: 30 } },
    { id: 'c', nome: 'Caio', natural: { D: 10, I: 15, S: 25, C: 50 } } // aceita percentuais
  ];
  const html = V.mapaRitmoFocoHtml(pontos);
  assert.match(html, /^<figure class="mapa-rf mapa-rf--exigido"/);
  assert.match(html, /<svg class="mapa-rf__svg" viewBox="0 0 360 388"[^>]*role="img"/);
  for (const L of ['D', 'I', 'S', 'C']) assert.match(html, new RegExp('class="mapa-rf__letra">' + L + '<'));
  assert.ok(html.includes('ACELERADO') && html.includes('CAUTELOSO') && html.includes('TAREFAS') && html.includes('PESSOAS'));
  const d = cx(html, 'd'), i = cx(html, 'i'), s = cx(html, 's'), c = cx(html, 'c');
  assert.ok(d.x < 180 && d.y < 176, 'D em cima à esquerda');
  assert.ok(i.x > 180 && i.y < 176, 'I em cima à direita');
  assert.ok(s.x > 180 && s.y > 176, 'S embaixo à direita');
  assert.ok(c.x < 180 && c.y > 176, 'C embaixo à esquerda');
  // seta só para quem tem exigido, tracejada e laranja
  assert.equal((html.match(/class="mapa-rf__seta"/g) || []).length, 1);
  assert.match(html, /mapa-rf__seta" data-id="s"><line[^>]*stroke="#f34405"[^>]*stroke-dasharray="4 3"/);
  assert.equal((html.match(/class="mapa-rf__exigido"/g) || []).length, 1);
  assert.match(html, /Exigido pelo trabalho/);
  // rótulos com os nomes, sem bolhas grandes (r ≤ 9)
  for (const n of ['Dani', 'Ivo', 'Sara', 'Caio']) assert.ok(html.includes('>' + n + '</text>'));
  for (const r of html.match(/ r="([\d.]+)"/g)) assert.ok(Number(r.match(/[\d.]+/)[0]) <= 9);
  // convenção oposta por opção
  const inv = V.mapaRitmoFocoHtml([{ id: 'd', nome: 'Dani', natural: { ritmo: 40, foco: -40 } }], { focoPessoas: true });
  assert.ok(cx(inv, 'd').x < 180);
});

test('mapaRitmoFocoHtml: muitos pontos viram números + lista; coincidentes não se escondem; escape e entradas inválidas', () => {
  const muitos = Array.from({ length: 10 }, (_, k) => ({ id: 'p' + k, nome: 'Pessoa ' + k, codigo: 'DI', natural: { ritmo: 10, foco: 10 } }));
  const html = V.mapaRitmoFocoHtml(muitos);
  assert.match(html, /<ol class="mapa-rf__lista">/);
  assert.equal((html.match(/<li>/g) || []).length, 10);
  const xs = new Set(muitos.map((p) => { const q = cx(html, p.id); return q.x + ',' + q.y; }));
  assert.equal(xs.size, 10, 'pontos iguais abrem um leque');
  const ataque = V.mapaRitmoFocoHtml([{ id: '"><x', nome: '<img src=x onerror=1>', natural: { ritmo: 0, foco: 0 } }]);
  assert.ok(!ataque.includes('<img') && !ataque.includes('"><x'));
  const vazio = V.mapaRitmoFocoHtml([null, { nome: 'Sem eixos' }, { nome: 'Texto', natural: { ritmo: 'a', foco: 1 } }]);
  assert.match(vazio, /Sem pontos/);
  assert.match(V.mapaRitmoFocoHtml(null), /<svg/);
  // fora da escala: fica dentro do quadro
  const longe = V.mapaRitmoFocoHtml([{ id: 'z', nome: 'Z', natural: { ritmo: 100, foco: -100 } }]);
  const z = cx(longe, 'z');
  assert.ok(z.x <= 326 && z.y >= 30);
});

test('régua de intensidade e natural × exigido', () => {
  const r = V.reguaHtml([{ letra: 'D', nome: 'Dominância', pct: 12 }, { letra: 'C', nome: 'Conformidade', pct: 42, faixa: 'muito_alta', texto: { resumo: 'Resumo <b>', excesso: 'Excesso' } }]);
  assert.match(r, /data-letra="D" data-faixa="muito_baixa"/);
  assert.match(r, /data-letra="C" data-faixa="muito_alta"/);
  assert.ok(r.includes('Resumo &lt;b&gt;') && r.includes('Quando exagerado'));
  const n = V.naturalExigidoHtml({ D: 10, I: 15, S: 25, C: 50 }, { percentuais: { D: 35, I: 30, S: 15, C: 20 }, indice: 40, faixa: 'muito_alta' });
  assert.match(n, /40<small>\/100/);
  assert.match(n, /selo-doc--esf-muito_alta/);
  assert.match(n, /natex__dif--mais">\+25/);
  assert.equal(V.naturalExigidoHtml({}, null), '');
});

test('modelo pessoa completo: régua, mapa e (com Parte 2) "Onde você está se esticando"', () => {
  const sem = V.montarHtml(MODELOS.pessoa({ pessoa: { nome: 'Carla Dias', resultado: RES.CS } }, { geradoEm: GERADO }));
  assert.match(sem, /data-secao="intensidade"/);
  assert.match(sem, /class="regua-doc"/);
  assert.match(sem, /class="mapa-rf"/);
  assert.ok(!sem.includes('data-secao="esticando"') && !sem.includes('mapa-rf__seta'));
  const d = MODELOS.pessoa({ pessoa: { nome: 'Carla Dias', resultado: RES.CS, exigido: EXIGIDO_DI } }, { geradoEm: GERADO });
  const com = V.montarHtml(d);
  assert.match(com, /data-variante="completo"/);
  assert.match(com, /data-secao="esticando"/);
  assert.match(com, /class="natex"/);
  assert.match(com, /class="mapa-rf__seta"/);
  assert.ok(com.includes(V.esc(d.exigido.textos[0])));
  // seções antigas continuam
  for (const id of ['perfil', 'fortes', 'atencao', 'pressao', 'comunicacao', 'plano', 'encerramento']) assert.match(com, new RegExp('data-secao="' + id + '"'));
});

test('modelo pessoa simples: duas seções curtas, forças, cuidados, hábitos e régua', () => {
  const d = MODELOS.pessoaSimples({ pessoa: { nome: 'Carla Dias', resultado: RES.CS } }, { geradoEm: GERADO });
  const html = V.montarHtml(d);
  assert.match(html, /data-modelo="pessoa" data-variante="simples"/);
  for (const id of ['capa', 'resumo', 'habitos', 'encerramento', 'rodape']) assert.match(html, new RegExp('data-secao="' + id + '"'));
  for (const id of ['fortes', 'pressao', 'comunicacao']) assert.ok(!html.includes('data-secao="' + id + '"'), id);
  assert.match(html, /Suas forças/);
  assert.match(html, /Cuidados/);
  assert.equal((html.match(/class="regua-doc__item"/g) || []).length, 4);
  for (const it of d.forcas.concat(d.cuidados, d.habitos)) assert.ok(html.includes(V.esc(it.texto)));
  assert.match(html, /Olá, Carla\./);
});

test('modelo liderança: mapa, combinação e esforço de adaptação ao cargo', () => {
  const d = MODELOS.lideranca({ pessoa: { nome: 'Bruno Lima', cargo: 'Gerente', resultado: RES.SC, exigido: EXIGIDO_DI }, empresa: { nome: 'Cartório' } }, { geradoEm: GERADO });
  const html = V.montarHtml(d);
  assert.match(html, /class="mapa-rf mapa-rf--exigido"/);
  assert.match(html, /Esforço de adaptação ao cargo/);
  assert.match(html, /class="natex"/);
  const sem = V.montarHtml(MODELOS.lideranca({ pessoa: { nome: 'Bruno Lima', resultado: RES.SC }, empresa: { nome: 'X' } }, { geradoEm: GERADO }));
  assert.ok(!sem.includes('Esforço de adaptação ao cargo'));
  assert.match(sem, /class="mapa-rf"/);
});

test('modelo equipe: seção ritmo e foco com todos no mapa, decisão do grupo e pressão (com Parte 2)', () => {
  const d = dadosEquipe(true);
  const html = V.montarHtml(d);
  assert.match(html, /data-secao="ritmo"/);
  assert.match(html, /Como o grupo decide/);
  assert.ok(!html.includes('Pressão do trabalho sobre o estilo'));
  assert.equal((html.match(/class="mapa-rf__natural"/g) || []).length, d.mapa.pontos.length);
  const e = MODELOS.equipe({
    empresa: { nome: 'X' },
    colaboradores: [{ pessoaId: 'a', nome: 'Ana Souza', resultado: RES.SC, exigido: EXIGIDO_DI }, { pessoaId: 'b', nome: 'Bia Lima', resultado: RES.IS }],
    relacoes: []
  }, { geradoEm: GERADO });
  const h2 = V.montarHtml(e);
  assert.match(h2, /Pressão do trabalho sobre o estilo/);
  assert.match(h2, /class="mapa-rf__seta"/);
  assert.match(h2, /pessoa-doc__esf/);
});

test('fotos: data:image/jpeg válida vira <img>; inválida ou URL externa vira iniciais; processo sem foto não muda', () => {
  assert.equal(V.fotoValida(FOTO), true);
  for (const f of ['https://x.com/a.jpg', 'data:image/png;base64,AAAA', 'data:image/jpeg;base64,<x>', 'data:image/svg+xml;base64,AAAA', 'data:image/jpeg;base64,' + 'A'.repeat(40001), null, 42]) assert.equal(V.fotoValida(f), false, String(f).slice(0, 30));
  assert.match(V.avatarHtml('Ana Souza', FOTO, 40), /<img src="data:image\/jpeg;base64,/);
  assert.match(V.avatarHtml('Ana Souza', 'https://x.com/a.jpg', 40), /avatar--iniciais[^>]*>AS</);
  assert.ok(!V.avatarHtml('Ana', 'javascript:alert(1)').includes('<img'));
  // capa da pessoa e da liderança
  const p = MODELOS.pessoa({ pessoa: { nome: 'Carla Dias', resultado: RES.CS, foto: FOTO } }, { geradoEm: GERADO });
  assert.match(V.montarHtml(p), /capa__retrato"><span class="avatar avatar--foto avatar--capa"/);
  const p2 = MODELOS.pessoa({ pessoa: { nome: 'Carla Dias', resultado: RES.CS } }, { geradoEm: GERADO });
  assert.match(V.montarHtml(p2), /avatar--iniciais avatar--capa"[^>]*>CD</);
  p2.pessoa.foto = 'https://rastreador.exemplo/x.jpg';
  assert.ok(!V.montarHtml(p2).includes('rastreador'));
  const l = MODELOS.lideranca({ pessoa: { nome: 'Bruno Lima', resultado: RES.SC, foto: FOTO }, empresa: { nome: 'X' } }, { geradoEm: GERADO });
  assert.match(V.montarHtml(l), /capa__retrato"><span class="avatar avatar--foto/);
  // organograma: foto no cartão com a letra como selo
  const org = V.organogramaHtml({ raizes: [{ id: 'a', nome: 'Ana S.', codigo: 'DI', foto: FOTO, filhos: [{ id: 'b', nome: 'Bia L.', codigo: 'SC', foto: 'https://x/y.jpg', filhos: [] }] }] });
  assert.match(org, /org-cartao--D org-cartao--com-foto/);
  assert.match(org, /org-cartao__selo disc-fundo-D" aria-hidden="true">D</);
  assert.ok(!org.includes('https://x'));
  assert.match(org, /org-cartao--S">/);
  // processo: sem foto, nenhum avatar; com foto no ranking, avatar nos cartões
  const rel = relatorio();
  assert.ok(!V.montarHtml(rel).includes('class="avatar'));
  rel.ranking.linhas[0].foto = FOTO;
  rel.ranking.linhas[1].foto = 'https://x/y.jpg';
  const h = V.montarHtml(rel);
  assert.match(h, /avatar--rank/);
  assert.match(h, /avatar--analise/);
  assert.ok(!h.includes('https://x/y.jpg'));
});

test('prévia em nova aba: #previa-<id>, lê do localStorage uma vez (apaga), copia para a aba e expira em 1 hora', () => {
  const V = require('../js/relatorio-view.js');
  const arm = () => { const d = {}; return { d, getItem: (k) => (k in d ? d[k] : null), setItem: (k, v) => { d[k] = String(v); }, removeItem: (k) => { delete d[k]; } }; };
  assert.equal(V.previaDaUrl('#previa-0123456789abcdef0123'), '0123456789abcdef0123');
  assert.equal(V.previaDaUrl('#previa-curto'), '');
  assert.equal(V.previaDaUrl('#previa-<script>aaaaaaaaaaaaaaa'), '');
  assert.equal(V.previaDaUrl('#r-abc'), '');
  const id = 'a'.repeat(32);
  const agora = Date.parse('2026-10-06T12:00:00Z');
  const local = arm(), sessao = arm();
  const rel = { modelo: 'equipe', titulo: 'Equipe X' };
  local.setItem(V.PREFIXO_PREVIA + id, JSON.stringify({ v: 1, em: agora - 1000, relatorio: rel }));
  assert.deepEqual(V.lerPrevia(id, agora, { local, sessao }), rel);
  assert.equal(local.getItem(V.PREFIXO_PREVIA + id), null, 'apagado do localStorage depois de lido');
  assert.deepEqual(V.lerPrevia(id, agora, { local, sessao }), rel, 'recarregar a aba: vem do sessionStorage');
  assert.equal(V.lerPrevia(id, agora + V.PREVIA_VALIDADE_MS, { local, sessao }), null, 'depois de 1 hora não abre');
  assert.equal(V.lerPrevia('b'.repeat(32), agora, { local: arm(), sessao: arm() }), null);
  const ruim = arm(); ruim.setItem(V.PREFIXO_PREVIA + id, '{quebrado');
  assert.equal(V.lerPrevia(id, agora, { local: ruim, sessao: arm() }), null);
});
