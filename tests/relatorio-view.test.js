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
