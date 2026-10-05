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
  assert.match(html, /Notus <em>Agência<\/em>/);
  assert.match(html, /assets\/icone\.svg/);
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
  assert.ok(!/empresa|vaga|aderência/i.test(html.replace(/Notus <em>Agência<\/em>/g, '')), 'sem linguagem de seleção');
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
