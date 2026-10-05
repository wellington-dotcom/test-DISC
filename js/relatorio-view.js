/*
 * Página pública do relatório do processo seletivo (relatorio.html?r=TOKEN ou relatorio.html#r-TOKEN).
 *
 * Desenha o JSON "relatorio" (contrato em docs/SPEC.md / js/relatorio-motor.js) num documento editorial:
 * capa, índice, 01 sumário, 02 atração, 03 avaliação técnica, 04 DISC, 05 ranking, 06 encerramento, rodapé.
 * Com dados.modelo = 'equipe' | 'lideranca' | 'pessoa' (js/relatorio-modelos.js) desenha o modelo correspondente.
 * organogramaHtml(organograma, {focoId?, rotulo?}) é exportado para o painel reutilizar (estilos: bloco ".org" de relatorio.css).
 *
 * Segurança:
 *   - todo texto que vem do relatório passa por esc() antes de entrar no HTML;
 *   - só campos conhecidos são lidos (lista branca). Telefone, e-mail, idade individual e dados
 *     sensíveis nunca são desenhados, mesmo que venham no JSON por engano.
 *
 * Uso no navegador: carregue config.js, api.js, api-simulada.js e este arquivo; ele procura #relatorio,
 * lê o token da URL e chama DISC_API.relatorioPublico(token).
 * No Node (testes): require('./js/relatorio-view.js') -> { montarHtml, render, esc, numero, ... }.
 */
(function (root) {
  'use strict';

  var MENSAGEM_NAO_ENCONTRADO = 'Relatório não encontrado ou fora do ar.';
  var MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  var LETRAS = ['D', 'I', 'S', 'C'];
  var NOMES_DISC = {
    D: { nome: 'Dominância', txt: 'Decide rápido, encara desafio e busca resultado.' },
    I: { nome: 'Influência', txt: 'Comunica, engaja pessoas e cria clima.' },
    S: { nome: 'Estabilidade', txt: 'Paciência, constância e cuidado com o outro.' },
    C: { nome: 'Conformidade', txt: 'Rigor, método e atenção a regra e detalhe.' }
  };
  var SECOES = [
    { n: '01', id: 'sumario', titulo: 'Sumário executivo', meta: 'Recomendação · Leituras' },
    { n: '02', id: 'atracao', titulo: 'Painel de atração', meta: 'Funil · Salários · Perfil do público' },
    { n: '03', id: 'tecnica', titulo: 'Avaliação técnica', meta: 'Pesos · Cortes · Resultados por etapa' },
    { n: '04', id: 'disc', titulo: 'Análise comportamental DISC', curto: 'Análise DISC', meta: 'Perfil ideal · Quadro · Achados' },
    { n: '05', id: 'ranking', titulo: 'Ranking final', meta: 'Fórmula · Tabela mestre · Posição a posição' },
    { n: '06', id: 'encerramento', titulo: 'Encerramento e próximos passos', curto: 'Encerramento', meta: 'Decisão · Próximos passos' }
  ];

  /* ------------------------------------------------------------------ formatação (funções puras) */

  function esc(v) {
    if (v === null || v === undefined) return '';
    return String(v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function ehNumero(n) { return typeof n === 'number' && isFinite(n); }

  function milhar(inteiro) {
    return String(inteiro).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }

  // numero(87.94) -> '87,9'; numero(8, 0) -> '8'; null -> '—'
  function numero(n, casas) {
    if (!ehNumero(n)) return '—';
    var c = casas === undefined ? 1 : casas;
    var neg = n < 0;
    var partes = Math.abs(n).toFixed(c).split('.');
    var txt = milhar(partes[0]) + (partes[1] ? ',' + partes[1] : '');
    return (neg ? '−' : '') + txt;
  }

  // inteiro sem casas e decimal com 1 casa: 8 -> '8', 7.5 -> '7,5'
  function numeroCurto(n) {
    if (!ehNumero(n)) return '—';
    return Math.round(n) === n ? numero(n, 0) : numero(n, 1);
  }

  function moeda(n) {
    if (!ehNumero(n)) return '—';
    return 'R$ ' + numero(Math.round(n), 0);
  }

  function pct(n) {
    if (!ehNumero(n)) return '—';
    return numeroCurto(Math.round(n * 10) / 10) + '%';
  }

  function partesData(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (!m) return null;
    var mes = Number(m[2]);
    if (mes < 1 || mes > 12) return null;
    return { ano: m[1], mes: MESES[mes - 1], dia: m[3] };
  }

  // '2026-08-03' -> '03 ago 2026'
  function data(iso) {
    var p = partesData(iso);
    return p ? p.dia + ' ' + p.mes + ' ' + p.ano : '';
  }

  // {inicio:'2026-08-03', fim:'2026-10-02'} -> '03 ago — 02 out 2026'
  function periodo(p) {
    if (!p) return '';
    var a = partesData(p.inicio);
    var b = partesData(p.fim);
    if (a && b) return (a.ano === b.ano ? a.dia + ' ' + a.mes : data(p.inicio)) + ' — ' + data(p.fim);
    return data(p.inicio) || data(p.fim);
  }

  var ROTULO_SITUACAO = { aprovado: 'Aprovado', avaliar: 'Avaliar', nao_recomendado: 'Não recomendado' };
  var ROTULO_ADERENCIA = { ideal: 'Ideal', boa: 'Boa', media: 'Média', baixa: 'Baixa', indefinida: 'Indefinida' };
  var ROTULO_CONFIABILIDADE = { alta: 'Confiável', media: 'Atenção', baixa: 'Pouco confiável', indisponivel: 'Sem validação' };

  function rotuloSituacao(s) { return ROTULO_SITUACAO[s] || '—'; }
  function rotuloAderencia(a) { return ROTULO_ADERENCIA[a] || '—'; }
  function rotuloConfiabilidade(c) { return ROTULO_CONFIABILIDADE[c] || '—'; }
  function classeSegura(v) { return String(v || '').replace(/[^a-z_]/g, ''); }

  // Token da URL: ?r=TOKEN ou #r-TOKEN. Só letras, números, _ e - (8 a 200).
  function tokenDaUrl(search, hash) {
    var t = '';
    var m = /[?&]r=([^&#]*)/.exec(String(search || ''));
    if (m) { try { t = decodeURIComponent(m[1]); } catch (e) { t = ''; } }
    if (!t) {
      var h = /^#r-(.+)$/.exec(String(hash || ''));
      if (h) { try { t = decodeURIComponent(h[1]); } catch (e2) { t = ''; } }
    }
    t = String(t).trim();
    return /^[A-Za-z0-9_-]{8,200}$/.test(t) ? t : '';
  }

  function texto(rel, id) {
    var t = rel && rel.textos && id ? rel.textos[id] : null;
    return t && t.texto ? String(t.texto) : '';
  }

  function lista(v) { return Array.isArray(v) ? v : []; }

  /* ------------------------------------------------------------------ peças */

  function paragrafos(t, classe) {
    if (!t) return '';
    return String(t).split(/\n{2,}/).map(function (p) {
      return '<p' + (classe ? ' class="' + classe + '"' : '') + '>' + esc(p).replace(/\n/g, '<br>') + '</p>';
    }).join('');
  }

  function cabecalhoPagina(secao, direita, escuro) {
    return '<div class="pag-cab' + (escuro ? ' pag-cab--escuro' : '') + '">' +
      '<span class="pag-cab__num">' + esc(secao.n + ' · ' + secao.titulo) + '</span>' +
      '<span class="pag-cab__regua" aria-hidden="true"></span>' +
      (direita ? '<span class="pag-cab__dir">' + esc(direita) + '</span>' : '') +
      '</div>';
  }

  function divisor(secao, alt) {
    return '<div class="divisor' + (alt ? ' divisor--alt' : '') + '" aria-hidden="true">' +
      '<span class="divisor__num">' + esc(secao.n) + '</span>' +
      '<span class="divisor__titulo">' + esc(secao.curto || secao.titulo) + '</span>' +
      '<span class="divisor__meta">' + esc(secao.meta) + '</span>' +
      '</div>';
  }

  function selo(classe, rotulo) {
    return '<span class="selo-doc selo-doc--' + classeSegura(classe) + '">' + esc(rotulo) + '</span>';
  }

  function barra(valor, maximo, classe, rotulo) {
    var p = maximo > 0 && ehNumero(valor) ? Math.max(0, Math.min(100, valor / maximo * 100)) : 0;
    return '<span class="barra' + (classe ? ' ' + classe : '') + '"' + (rotulo ? ' role="img" aria-label="' + esc(rotulo) + '"' : ' aria-hidden="true"') + '>' +
      '<span class="barra__feito" style="width:' + p.toFixed(1) + '%"></span></span>';
  }

  function nota(tipo, titulo, corpo) {
    return '<div class="obs obs--' + classeSegura(tipo || 'info') + '">' +
      '<div class="obs__tit">' + esc(titulo) + '</div>' + paragrafos(corpo) + '</div>';
  }

  /* ------------------------------------------------------------------ capa e índice */

  function capa(rel, ctx) {
    var p = rel.processo || {};
    var c = rel.capa || {};
    var rec = rel.sumario && rel.sumario.recomendacao;
    var titulo = esc(c.titulo || 'Relatório do processo seletivo').replace(/\bDISC\b/g, '<em>DISC</em>');
    var numeros = lista(c.numeros).slice(0, 4).map(function (n, i, arr) {
      var v = n.valor;
      var vTxt;
      if (ehNumero(v)) vTxt = esc(numeroCurto(v)) + (n.sufixo ? '<small>' + esc(n.sufixo) + '</small>' : '');
      else {
        var mm = /^\s*([\d.,]+)\s*%\s*$/.exec(String(v === undefined || v === null ? '' : v));
        vTxt = mm ? esc(mm[1]) + '<small>%</small>' : esc(v === undefined || v === null ? '—' : v);
      }
      return '<div class="capa__num' + (i === arr.length - 1 ? ' capa__num--destaque' : '') + '">' +
        '<div class="capa__num-valor">' + vTxt + '</div>' +
        '<div class="capa__num-rotulo">' + esc(n.rotulo) + '</div>' +
        (n.nota ? '<div class="capa__num-nota">' + esc(n.nota) + '</div>' : '') + '</div>';
    }).join('');
    var lider = rec ?
      '<div class="capa__lider">' + (ctx.pendente ? '<span class="capa__lider-obs">Preliminar · etapa em aberto</span>' : '') +
      '<strong>' + esc(rec.nome) + '</strong><span class="pilula-nota">' + esc(numero(rec.score)) + '<small>/100</small></span></div>' :
      '<div class="capa__rod-valor">Ainda sem ranking</div>';
    return '<section class="capa" id="capa" data-secao="capa" aria-label="Capa">' +
      '<div class="capa__grade" aria-hidden="true"></div>' +
      '<header class="capa__topo">' +
        '<span class="marca-doc"><img class="marca-doc__logo" src="assets/icone.svg" alt="" width="32" height="32">' +
        '<span class="marca-doc__nome">Notus <em>Agência</em></span></span>' +
        '<span class="capa__meta"><span>Relatório do processo</span>' + (p.cidade ? '<span>' + esc(p.cidade) + '</span>' : '') + '</span>' +
      '</header>' +
      '<div class="capa__miolo">' +
        '<div class="capa__sobre"><span class="ponto" aria-hidden="true"></span>Relatório executivo · ' + esc(p.vaga || p.nome || 'Processo seletivo') + '</div>' +
        '<h1 class="capa__titulo">' + titulo + '</h1>' +
        (c.subtitulo ? '<p class="capa__subtitulo">' + esc(c.subtitulo) + '</p>' : '') +
        (numeros ? '<div class="capa__numeros">' + numeros + '</div>' : '') +
      '</div>' +
      '<footer class="capa__rodape">' +
        '<div><div class="capa__rod-rotulo">Cliente</div><div class="capa__rod-valor">' + esc(p.empresa || '—') + (p.contratante ? '<br>' + esc(p.contratante) : '') + '</div></div>' +
        '<div><div class="capa__rod-rotulo">Consultoria</div><div class="capa__rod-valor">Notus Agência' + (p.consultor ? '<br>' + esc(p.consultor) : '') + '</div></div>' +
        '<div><div class="capa__rod-rotulo">Período</div><div class="capa__rod-valor">' + esc(periodo(p.periodo) || '—') + (rel.geradoEm ? '<br>Emitido em ' + esc(data(rel.geradoEm)) : '') + '</div></div>' +
        '<div class="capa__rod-lider"><div class="capa__rod-rotulo">Líder preliminar</div>' + lider + '</div>' +
      '</footer>' +
    '</section>';
  }

  function indice(rel, ctx) {
    var n = ctx.linhas.length;
    var tit = n ? (n === 1 ? 'Um finalista' : numeroPorExtenso(n) + ' finalistas') + '. ' +
      (ctx.etapasFeitas === 1 ? 'Uma etapa' : numeroPorExtenso(ctx.etapasFeitas, true) + ' etapas') + ' concluída' + (ctx.etapasFeitas === 1 ? '' : 's') + '.' +
      (ctx.pendente ? ' Uma decisão em aberto.' : ' Uma decisão.') : 'O processo, do anúncio à decisão.';
    return '<section class="pagina pagina--creme" id="indice" data-secao="indice" aria-labelledby="indice-tit">' +
      '<div class="pag-cab"><span class="pag-cab__num">Índice</span><span class="pag-cab__regua" aria-hidden="true"></span></div>' +
      '<div class="indice">' +
        '<div class="indice__tit"><h2 id="indice-tit">' + esc(tit) + '</h2>' +
        '<p>Seis seções, da atração de candidatos ao ranking consolidado' + (ctx.pendente ? ', com as etapas que ainda faltam no fim.' : '.') + '</p></div>' +
        '<ol class="indice__lista">' + SECOES.map(function (s) {
          return '<li><a href="#' + s.id + '"><span class="indice__n">' + s.n + '</span><span class="indice__t">' + esc(s.titulo) + '</span><span class="indice__seta" aria-hidden="true">→</span></a></li>';
        }).join('') + '</ol>' +
      '</div></section>';
  }

  function numeroPorExtenso(n, feminino) {
    var nomes = ['Zero', 'Um', 'Dois', 'Três', 'Quatro', 'Cinco', 'Seis', 'Sete', 'Oito', 'Nove', 'Dez', 'Onze', 'Doze'];
    if (feminino && n === 1) return 'Uma';
    if (feminino && n === 2) return 'Duas';
    return nomes[n] || String(n);
  }

  /* ------------------------------------------------------------------ 01 sumário */

  function sumario(rel, ctx) {
    var s = SECOES[0];
    var rec = rel.sumario && rel.sumario.recomendacao;
    var p = rel.processo || {};
    var corte = rel.config && rel.config.corte;
    var h = '';
    var lede = 'Este relatório consolida o processo seletivo conduzido pela Notus Agência para ' + (p.empresa || 'o cliente') +
      ': da atração de ' + numeroCurto(ctx.total) + ' candidatos à avaliação de ' + numeroCurto(ctx.linhas.length) + ' finalistas, com ' +
      ctx.etapasFeitas + (ctx.etapasFeitas === 1 ? ' etapa técnica' : ' etapas técnicas') + ' e a análise comportamental DISC.' +
      (ctx.pendente ? ' ' + (ctx.etapasPendentes.length === 1 ? 'A etapa ' : 'As etapas ') + ctx.etapasPendentes.join(', ') + (ctx.etapasPendentes.length === 1 ? ' ainda não foi aplicada.' : ' ainda não foram aplicadas.') : '');
    h += '<p class="lede">' + esc(lede) + '</p>';
    if (rec) {
      var seg = ctx.linhas[1];
      var margem = seg && ehNumero(rec.score) && ehNumero(seg.total) ? rec.score - seg.total : null;
      h += '<div class="rec">' +
        '<div class="rec__topo"><span class="rec__etiqueta">Recomendação ' + (ctx.pendente ? 'preliminar' : 'técnica') + '</span>' +
        '<span class="rec__nota"><span class="rec__nota-num">' + esc(numero(rec.score)) + '</span><span class="rec__nota-den">/100</span></span></div>' +
        '<div class="rec__nome">' + esc(rec.nome) + ' ' + selo(rec.situacao, rotuloSituacao(rec.situacao)) + '</div>' +
        '<div class="rec__texto">' + paragrafos(texto(rel, rec.textoId)) + '</div>' +
        (margem !== null ? '<div class="rec__margem"><span class="rec__margem-num">+' + esc(numero(margem)) + ' pts</span> sobre ' + esc(seg.nome) + ' (' + esc(numero(seg.total)) + ')' + (ehNumero(corte) ? ' · corte em ' + esc(numeroCurto(corte)) + ' pts' : '') + '</div>' : '') +
        '</div>';
    } else {
      h += '<div class="obs obs--info"><div class="obs__tit">Sem recomendação ainda</div><p>Nenhum finalista tem nota suficiente para formar o ranking.</p></div>';
    }
    if (ctx.linhas.length) {
      h += '<ol class="ranklista">' + ctx.linhas.slice(0, 4).map(function (l) {
        return '<li class="' + (l.posicao === 1 ? 'eh-topo' : '') + '">' +
          '<span class="ranklista__pos">' + esc(l.posicao) + 'º</span>' +
          '<span class="ranklista__nome"><strong>' + esc(l.nome) + '</strong>' + selo(l.situacao, rotuloSituacao(l.situacao)) + '</span>' +
          '<span class="ranklista__nota">' + esc(numero(l.total)) + '<small>/100</small></span></li>';
      }).join('') + '</ol>';
    }
    var leituras = lista(rel.sumario && rel.sumario.leituras);
    if (leituras.length) {
      h += '<h3 class="h3 mt48">' + (leituras.length === 1 ? 'Uma leitura que resume o processo' : numeroPorExtenso(leituras.length, true) + ' leituras que resumem o processo') + '</h3>' +
        '<div class="leituras' + (leituras.length % 2 === 0 ? ' leituras--par' : '') + '">' + leituras.map(function (l, i) {
          return '<article class="leitura"><div class="leitura__n">' + (i < 9 ? '0' : '') + (i + 1) + '</div>' +
            '<h4>' + esc(l.titulo) + '</h4>' + paragrafos(texto(rel, l.textoId)) + '</article>';
        }).join('') + '</div>';
    }
    return secao(s, false, cabecalhoPagina(s, p.empresa) + h);
  }

  function secao(s, alt, conteudo, classe) {
    return '<section class="secao" id="' + s.id + '" data-secao="' + s.id + '" aria-labelledby="' + s.id + '-tit">' +
      '<h2 class="visualmente-oculto" id="' + s.id + '-tit">' + esc(s.n + ' · ' + s.titulo) + '</h2>' +
      divisor(s, alt) +
      '<div class="pagina' + (classe ? ' ' + classe : '') + '">' + conteudo + '</div></section>';
  }

  /* ------------------------------------------------------------------ 02 atração */

  function barrasHorizontais(itens, total, classe) {
    var max = 0;
    itens.forEach(function (it) { if (it.qtd > max) max = it.qtd; });
    return '<ul class="barras' + (classe ? ' ' + classe : '') + '">' + itens.map(function (it) {
      var p = ehNumero(it.pct) ? it.pct : (total ? it.qtd / total * 100 : null);
      return '<li><span class="barras__rot">' + esc(it.rotulo) + '</span>' +
        barra(it.qtd, max, '', it.rotulo + ': ' + it.qtd) +
        '<span class="barras__val"><strong>' + esc(numeroCurto(it.qtd)) + '</strong>' + (p !== null ? ' · ' + esc(pct(p)) : '') + '</span></li>';
    }).join('') + '</ul>';
  }

  // Colunas verticais em SVG (faixas de idade). Sem cores no JS: tudo por classe.
  function colunasSvg(itens, titulo) {
    var max = 0;
    itens.forEach(function (it) { if (it.qtd > max) max = it.qtd; });
    var L = 320, A = 180, base = 150, topo = 22, n = itens.length || 1;
    var passo = L / n, larg = Math.min(44, passo * 0.56);
    var partes = itens.map(function (it, i) {
      var h = max ? (it.qtd / max) * (base - topo) : 0;
      var x = i * passo + (passo - larg) / 2;
      var cx = i * passo + passo / 2;
      return '<rect class="svg-col' + (it.qtd === max && max > 0 ? ' svg-col--max' : '') + '" x="' + x.toFixed(1) + '" y="' + (base - h).toFixed(1) + '" width="' + larg.toFixed(1) + '" height="' + Math.max(h, 0).toFixed(1) + '" rx="2"></rect>' +
        '<text class="svg-val" x="' + cx.toFixed(1) + '" y="' + (base - h - 6).toFixed(1) + '" text-anchor="middle">' + esc(numeroCurto(it.qtd)) + '</text>' +
        '<text class="svg-eixo" x="' + cx.toFixed(1) + '" y="' + (base + 18) + '" text-anchor="middle">' + esc(it.faixa) + '</text>';
    }).join('');
    return '<svg class="grafico-svg" viewBox="0 0 ' + L + ' ' + A + '" role="img" aria-label="' + esc(titulo) + '">' +
      '<line class="svg-base" x1="0" x2="' + L + '" y1="' + base + '" y2="' + base + '"></line>' + partes + '</svg>';
  }

  function atracao(rel, ctx) {
    var s = SECOES[1];
    var a = rel.atracao || {};
    var total = ehNumero(a.total) ? a.total : ctx.total;
    var h = '<h3 class="h2doc">Dados de atração</h3>' +
      '<p class="lede lede--curta">Números da lista de candidatos do processo, do primeiro contato até a fase final.</p>';
    h += '<div class="mini-nums">' +
      '<div class="mini-num"><div class="mini-num__valor">' + esc(numeroCurto(total)) + '</div><div class="mini-num__rot">candidatos no total</div></div>' +
      '<div class="mini-num"><div class="mini-num__valor">' + esc(moeda(a.pretensaoMedia)) + '</div><div class="mini-num__rot">pretensão salarial média</div></div>' +
      '<div class="mini-num"><div class="mini-num__valor">' + esc(moeda(a.ultimoSalarioMedio)) + '</div><div class="mini-num__rot">último salário médio</div></div>' +
      '</div>';
    var porStatus = lista(a.porStatus).map(function (x) { return { rotulo: x.status, qtd: x.qtd, pct: x.pct }; });
    if (porStatus.length) {
      h += '<div class="cartao-doc mt32"><div class="rotulo-doc">Funil por status</div>' + barrasHorizontais(porStatus, total, 'barras--funil') +
        (texto(rel, a.textoId) ? '<div class="nota-doc"><span class="nota-doc__tag">Leitura</span>' + paragrafos(texto(rel, a.textoId)) + '</div>' : '') + '</div>';
    }
    // Pretensão × último salário
    if (ehNumero(a.pretensaoMedia) || ehNumero(a.ultimoSalarioMedio)) {
      var maxS = Math.max(a.pretensaoMedia || 0, a.ultimoSalarioMedio || 0);
      var dif = ehNumero(a.pretensaoMedia) && ehNumero(a.ultimoSalarioMedio) ? a.pretensaoMedia - a.ultimoSalarioMedio : null;
      var leitura = dif === null ? '' : Math.abs(dif) <= Math.max(50, (a.ultimoSalarioMedio || 0) * 0.03) ?
        'Pretensão e último salário praticamente iguais: a expectativa está ancorada na trajetória real, o que facilita a proposta.' :
        dif > 0 ? 'Em média, os candidatos pedem ' + moeda(dif) + ' a mais do que recebiam. É o espaço normal de uma troca de emprego.' :
          'Em média, a pretensão fica ' + moeda(-dif) + ' abaixo do último salário: sinal de pressão por recolocação.';
      h += '<div class="cartao-doc mt24"><div class="rotulo-doc">Pretensão salarial × último salário (média)</div>' +
        '<ul class="barras barras--duplas">' +
          '<li><span class="barras__rot"><span class="legenda legenda--s1" aria-hidden="true"></span>Pretensão</span>' + barra(a.pretensaoMedia, maxS, 'barra--s1', 'Pretensão média ' + moeda(a.pretensaoMedia)) + '<span class="barras__val"><strong>' + esc(moeda(a.pretensaoMedia)) + '</strong></span></li>' +
          '<li><span class="barras__rot"><span class="legenda legenda--s2" aria-hidden="true"></span>Último salário</span>' + barra(a.ultimoSalarioMedio, maxS, 'barra--s2', 'Último salário médio ' + moeda(a.ultimoSalarioMedio)) + '<span class="barras__val"><strong>' + esc(moeda(a.ultimoSalarioMedio)) + '</strong></span></li>' +
        '</ul>' + (leitura ? '<p class="nota-curta">' + esc(leitura) + '</p>' : '') + '</div>';
    }
    var faixas = lista(a.idadeFaixas).filter(function (f) { return f && ehNumero(f.qtd); });
    var trab = lista(a.statusTrabalho).map(function (x) { return { rotulo: x.rotulo, qtd: x.qtd }; });
    if (faixas.length || trab.length) {
      h += '<h3 class="h3 mt48">Perfil do público</h3><p class="nota-curta">Retrato de quem se inscreveu. Serve para entender o mercado; não é critério de escolha.</p><div class="duas mt24">';
      if (faixas.length) h += '<div class="cartao-doc"><div class="rotulo-doc">Faixa de idade</div>' + colunasSvg(faixas, 'Candidatos por faixa de idade') + '</div>';
      if (trab.length) {
        var tt = 0; trab.forEach(function (x) { tt += x.qtd || 0; });
        h += '<div class="cartao-doc"><div class="rotulo-doc">Situação de trabalho</div>' + barrasHorizontais(trab, tt) + '</div>';
      }
      h += '</div>';
    }
    return secao(s, true, cabecalhoPagina(s, numeroCurto(total) + ' candidatos') + h);
  }

  /* ------------------------------------------------------------------ 03 avaliação técnica */

  function tecnica(rel, ctx) {
    var s = SECOES[2];
    var etapas = lista(rel.etapas);
    var cfg = rel.config || {};
    var h = '<h3 class="h2doc">' + (etapas.length === 1 ? 'Uma etapa' : numeroPorExtenso(etapas.length, true) + ' etapas') + ', pesos definidos</h3>';
    var pend = ctx.etapasPendentes;
    h += '<p class="lede lede--curta">' + esc(ctx.etapasFeitas === etapas.length ? 'Todas as etapas foram aplicadas.' :
      'As etapas já aplicadas somam ' + numeroCurto(100 - ctx.pesoPendentePct) + '% do peso. ' + (pend.length === 1 ? 'A etapa ' + pend[0] + ' ainda está' : 'As etapas ' + pend.join(', ') + ' ainda estão') + ' em aberto.') + '</p>';
    h += '<div class="pesos">' + etapas.map(function (e, i) {
      var pctPeso = ctx.somaPesos ? e.peso / ctx.somaPesos * 100 : 0;
      return '<div class="peso' + (e.pendente ? ' peso--pendente' : '') + '">' +
        barra(pctPeso, 100, 'barra--fina') +
        '<div class="peso__cab"><span class="peso__n">' + (i < 9 ? '0' : '') + (i + 1) + '</span><span class="peso__pct">' + esc(numeroCurto(Math.round(pctPeso * 10) / 10)) + '%</span></div>' +
        '<h4>' + esc(e.nome) + '</h4><p>' + esc(e.descricao || '') + '</p>' +
        (e.pendente ? '<p class="peso__aberto">Peso em aberto · ainda não aplicada</p>' : '') + '</div>';
    }).join('') + '</div>';
    if (ehNumero(cfg.corte)) {
      h += '<div class="cortes">' +
        '<div class="corte corte--aprovado"><div class="rotulo-doc">Aprovação direta</div><div class="corte__val">' + esc(numeroCurto(cfg.corte)) + '+ pts</div></div>' +
        (ehNumero(cfg.faixaAvaliar) ? '<div class="corte corte--avaliar"><div class="rotulo-doc">Avaliar individualmente</div><div class="corte__val">' + esc(numeroCurto(cfg.faixaAvaliar)) + '–' + esc(numeroCurto(cfg.corte)) + ' pts</div></div>' +
        '<div class="corte corte--nao"><div class="rotulo-doc">Não recomendado</div><div class="corte__val">&lt; ' + esc(numeroCurto(cfg.faixaAvaliar)) + ' pts</div></div>' : '') +
        '</div>';
    }
    etapas.forEach(function (e, i) {
      h += '<article class="etapa" data-etapa="' + esc(e.id) + '">' +
        '<div class="etapa__cab"><span class="etapa__n">' + (i < 9 ? '0' : '') + (i + 1) + '</span><div><h3 class="h3">' + esc(e.nome) + '</h3>' +
        '<p class="etapa__desc">' + esc(e.descricao || '') + (e.pendente ? '' : ' Peso: ' + esc(numeroCurto(e.pesoNormalizado)) + '% da nota técnica.') + '</p></div></div>';
      if (e.pendente) {
        h += '<div class="obs obs--info"><div class="obs__tit">Etapa pendente</div><p>Ainda não aplicada. O peso dela (' + esc(numeroCurto(e.peso)) + ' de ' + esc(numeroCurto(ctx.somaPesos)) + ') fica em aberto e o ranking pode mudar.</p></div>';
      } else {
        var res = lista(e.resultados);
        var melhor = null, pior = null;
        res.forEach(function (r) {
          if (!ehNumero(r.nota)) return;
          if (melhor === null || r.nota > melhor) melhor = r.nota;
          if (pior === null || r.nota < pior) pior = r.nota;
        });
        if (melhor === pior) melhor = null; // todos iguais: ninguém em destaque
        h += '<table class="tabela-doc tabela-notas"><thead><tr><th scope="col">Candidato</th><th scope="col" class="col-barra"><span class="visualmente-oculto">Barra</span></th><th scope="col" class="num">Nota</th></tr></thead><tbody>' +
          res.map(function (r) {
            var top = melhor !== null && ehNumero(r.nota) && r.nota === melhor && melhor > 0;
            var baixa = ehNumero(r.nota) && r.nota < 4;
            return '<tr' + (top ? ' class="hl"' : '') + '><td>' + esc(r.nome) + '</td><td class="col-barra">' + barra(r.nota, 10, baixa ? 'barra--baixa' : top ? 'barra--top' : '') + '</td>' +
              '<td class="num">' + (ehNumero(r.nota) ? esc(numero(r.nota)) : '<span class="tracinho" title="Sem nota">—</span>') + '</td></tr>';
          }).join('') + '</tbody></table>';
        var dest = lista(e.destaques);
        if (dest.length) h += '<div class="obs-grade' + (dest.length % 2 === 0 ? ' obs-grade--par' : '') + '">' + dest.map(function (d) { return nota(d.tipo, d.titulo, texto(rel, d.textoId)); }).join('') + '</div>';
      }
      h += '</article>';
    });
    return secao(s, false, cabecalhoPagina(s, ctx.etapasFeitas + ' de ' + etapas.length + ' etapas') + h);
  }

  /* ------------------------------------------------------------------ 04 DISC */

  function barraDisc(q) {
    var soma = 0;
    LETRAS.forEach(function (L) { soma += ehNumero(q[L]) ? q[L] : 0; });
    if (!soma) return '';
    return '<span class="disc-pilha" role="img" aria-label="' + esc(LETRAS.map(function (L) { return L + ' ' + numeroCurto(q[L] || 0) + '%'; }).join(', ')) + '">' +
      LETRAS.map(function (L) {
        var v = ehNumero(q[L]) ? q[L] : 0;
        if (!v) return '';
        return '<span class="disc-pilha__seg disc-seg-' + L + '" style="width:' + (v / soma * 100).toFixed(1) + '%">' + (v >= 12 ? '<b>' + L + '</b> ' + esc(numeroCurto(v)) : '') + '</span>';
      }).join('') + '</span>';
  }

  function disc(rel, ctx) {
    var s = SECOES[3];
    var d = rel.disc || {};
    var ideal = String(d.perfilIdeal || (rel.config && rel.config.perfilIdeal) || '').toUpperCase().replace(/[^DISC]/g, '');
    var explic = texto(rel, d.explicacaoTextoId) || (rel.config && rel.config.explicacaoPerfil) || '';
    var h = '<h3 class="h2doc">Perfil ideal para a vaga: <span class="perfil-ideal">' + esc(ideal || '—') + '</span></h3>' +
      (explic ? '<p class="lede lede--curta">' + esc(explic) + '</p>' : '');
    h += '<div class="disc-defs">' + LETRAS.map(function (L) {
      var no = ideal.indexOf(L) >= 0;
      return '<div class="disc-def' + (no ? ' disc-def--ideal' : '') + '"><div class="disc-def__letra disc-letra-' + L + '">' + L + '</div>' +
        '<div class="disc-def__nome">' + esc(NOMES_DISC[L].nome) + (no ? ' <span class="disc-def__tag">' + (ideal[0] === L ? 'principal' : 'secundário') + '</span>' : '') + '</div>' +
        '<p>' + esc(NOMES_DISC[L].txt) + '</p></div>';
    }).join('') + '</div>';
    var quadro = lista(d.quadro);
    if (quadro.length) {
      h += '<h3 class="h3 mt48">Quadro dos finalistas</h3><p class="nota-curta">Barra = distribuição do perfil (soma 100%). Letras: <b>D</b> Dominância · <b>I</b> Influência · <b>S</b> Estabilidade · <b>C</b> Conformidade.</p>' +
        '<ul class="quadro-disc">' + quadro.map(function (q) {
          return '<li class="quadro-disc__item">' +
            '<div class="quadro-disc__cab"><strong>' + esc(q.nome) + '</strong><span class="quadro-disc__cod">' + esc(q.codigo || '—') + '</span>' +
            '<span class="quadro-disc__selos">' + selo('ad-' + classeSegura(q.aderencia), 'Aderência ' + rotuloAderencia(q.aderencia).toLowerCase()) +
            selo('cf-' + classeSegura(q.confiabilidade), rotuloConfiabilidade(q.confiabilidade)) + '</span></div>' +
            barraDisc(q) + '</li>';
        }).join('') + '</ul>';
    } else {
      h += '<div class="obs obs--info mt24"><div class="obs__tit">Sem DISC</div><p>Nenhum finalista respondeu ao teste DISC até agora.</p></div>';
    }
    var ach = lista(d.achados);
    if (ach.length) h += '<h3 class="h3 mt48">Achados</h3><div class="obs-grade' + (ach.length % 2 === 0 ? ' obs-grade--par' : '') + '">' + ach.map(function (a) { return nota(a.tipo, a.titulo, texto(rel, a.textoId)); }).join('') + '</div>';
    return secao(s, true, cabecalhoPagina(s, 'Perfil ideal ' + ideal) + h);
  }

  /* ------------------------------------------------------------------ 05 ranking */

  function ranking(rel, ctx) {
    var s = SECOES[4];
    var r = rel.ranking || {};
    var etapas = lista(rel.etapas);
    var cfg = rel.config || {};
    var formula = lista(r.formula);
    var h = '<h3 class="h2doc">Score consolidado</h3>' +
      '<p class="lede lede--curta">Total = nota técnica (0 a 100, pela média ponderada das etapas aplicadas) + bônus.' +
      (ehNumero(r.pesoPendente) && r.pesoPendente > 0 ? ' Ainda há ' + esc(numeroCurto(r.pesoPendente)) + ' de peso em aberto.' : '') + '</p>';
    if (formula.length) {
      h += '<ul class="formula">' + formula.map(function (f) {
        return '<li class="' + (f.pendente ? 'formula--pendente' : '') + '"><span class="formula__peso">' + (f.pendente ? 'em aberto' : esc(numeroCurto(f.pesoNormalizado)) + '%') + '</span><span class="formula__nome">' + esc(f.etapa) + '</span></li>';
      }).join('') + '<li class="formula--bonus"><span class="formula__peso">+ bônus</span><span class="formula__nome">por fora</span></li></ul>';
    }
    var ativas = etapas.filter(function (e) { return !e.pendente; });
    if (ctx.linhas.length) {
      h += '<div class="tabela-mestre-caixa"><table class="tabela-doc tabela-mestre"><thead><tr>' +
        '<th scope="col">#</th><th scope="col">Candidato</th>' +
        ativas.map(function (e) { return '<th scope="col" class="num">' + esc(e.nome) + '</th>'; }).join('') +
        '<th scope="col" class="num">Técnico</th><th scope="col" class="num">Bônus</th><th scope="col" class="num">Total</th><th scope="col">Situação</th><th scope="col">DISC</th>' +
        '</tr></thead><tbody>' + ctx.linhas.map(function (l) {
          var notas = l.notas || {};
          return '<tr class="' + (l.posicao === 1 ? 'hl ' : '') + 'sit-' + classeSegura(l.situacao) + '">' +
            '<td class="pos" data-rotulo="Posição">' + esc(l.posicao) + 'º</td>' +
            '<td class="nome" data-rotulo="Candidato">' + esc(l.nome) + (l.incompleto ? ' <span class="incompleto" title="Faltou nota em alguma etapa (conta como zero)">nota faltando</span>' : '') + '</td>' +
            ativas.map(function (e) { return '<td class="num nota-etapa" data-rotulo="' + esc(e.nome) + '">' + esc(numero(notas[e.id])) + '</td>'; }).join('') +
            '<td class="num" data-rotulo="Técnico">' + esc(numero(l.tecnico)) + '</td>' +
            '<td class="num" data-rotulo="Bônus">' + (ehNumero(l.bonus) && l.bonus > 0 ? '+' : '') + esc(numero(l.bonus)) + '</td>' +
            '<td class="num total" data-rotulo="Total">' + esc(numero(l.total)) + '</td>' +
            '<td class="sit" data-rotulo="Situação">' + selo(l.situacao, rotuloSituacao(l.situacao)) + '</td>' +
            '<td class="disc-cod" data-rotulo="DISC">' + esc(l.disc || '—') + '</td></tr>';
        }).join('') + '</tbody></table></div>';
      h += '<h3 class="h3 mt48">Análise posição a posição</h3>' + (ehNumero(cfg.corte) ? '<p class="nota-curta">Barra = total de 0 a 100. O traço verde marca o corte de ' + esc(numeroCurto(cfg.corte)) + ' pontos.</p>' : '') + '<ol class="analise">' + ctx.linhas.map(function (l) {
        return '<li class="analise__item sit-' + classeSegura(l.situacao) + '">' +
          '<div class="analise__pos">' + esc(l.posicao) + 'º</div>' +
          '<div class="analise__corpo"><div class="analise__cab"><strong>' + esc(l.nome) + '</strong>' + selo(l.situacao, rotuloSituacao(l.situacao)) +
          '<span class="analise__nota">' + esc(numero(l.total)) + '</span></div>' +
          '<div class="analise__trilho">' + barra(l.total, 100, l.posicao === 1 ? 'barra--top' : '', 'Total ' + numero(l.total) + ' de 100') +
          (ehNumero(cfg.corte) ? '<span class="analise__corte" style="left:' + Math.max(0, Math.min(100, cfg.corte)) + '%" title="Corte ' + esc(numeroCurto(cfg.corte)) + '"></span>' : '') + '</div>' +
          paragrafos(texto(rel, l.analiseTextoId)) + '</div></li>';
      }).join('') + '</ol>';
    }
    return secao(s, false, cabecalhoPagina(s, ctx.linhas.length + ' finalistas') + h);
  }

  /* ------------------------------------------------------------------ 06 encerramento + rodapé */

  function encerramento(rel, ctx) {
    var s = SECOES[5];
    var e = rel.encerramento || {};
    var rec = rel.sumario && rel.sumario.recomendacao;
    var p = rel.processo || {};
    var h = '';
    if (rec) {
      h += '<div class="final">' +
        '<span class="final__chip">' + (ctx.pendente ? 'Recomendação preliminar' : 'Recomendação') + '</span>' +
        '<div class="final__nome">' + esc(rec.nome) + '</div>' +
        '<div class="final__nota"><span class="final__nota-num">' + esc(numero(rec.score)) + '</span><span class="final__nota-den">pontos de 100</span></div>' +
        '</div>';
    }
    h += '<div class="final__texto">' + paragrafos(texto(rel, e.textoId)) + '</div>';
    var passos = lista(e.proximosPassos).map(function (id) { return texto(rel, id); }).filter(Boolean);
    if (passos.length) {
      h += '<div class="passos-cab">Próximos passos</div><ol class="passos">' + passos.map(function (t, i) {
        return '<li><span class="passos__n">' + (i < 9 ? '0' : '') + (i + 1) + '</span><span class="passos__t">' + esc(t) + '</span></li>';
      }).join('') + '</ol>';
    }
    h += '<div class="assina"><div class="assina__linha" aria-hidden="true"></div>' +
      '<div class="assina__nome">' + esc(p.consultor || 'Notus Agência') + '</div>' +
      '<div class="assina__papel">Consultoria · Notus Agência</div>' +
      (rel.geradoEm ? '<div class="assina__data">' + esc(data(rel.geradoEm)) + '</div>' : '') + '</div>';
    return '<section class="secao secao--escura" id="' + s.id + '" data-secao="' + s.id + '" aria-labelledby="' + s.id + '-tit">' +
      '<h2 class="visualmente-oculto" id="' + s.id + '-tit">' + esc(s.n + ' · ' + s.titulo) + '</h2>' +
      '<div class="pagina pagina--escura">' + cabecalhoPagina(s, p.empresa, true) + h + '</div></section>';
  }

  function rodape(rel) {
    var p = rel.processo || {};
    return '<footer class="rodape-doc" data-secao="rodape">' +
      '<span class="marca-doc"><img class="marca-doc__logo" src="assets/icone.svg" alt="" width="28" height="28"><span class="marca-doc__nome">Notus <em>Agência</em></span></span>' +
      '<span class="rodape-doc__meta">' + esc([p.consultor ? 'Consultor: ' + p.consultor : '', p.empresa, p.vaga].filter(Boolean).join(' · ')) +
      '<br>Documento confidencial, para uso do contratante. Sem dados de contato dos candidatos.</span></footer>';
  }

  /* ================================================================== MODELOS DA FASE 2 (equipe · liderança · pessoa)
   * Desenhados por dados.modelo (js/relatorio-modelos.js). Mesmo padrão editorial: capa azul-escura, divisores,
   * páginas de papel, encerramento escuro e rodapé. Só campos conhecidos; todo texto passa por esc(). */

  var ROTULO_NIVEL = { fluido: 'Fluido', atencao: 'Atenção', tensao: 'Tensão', indefinido: 'Sem leitura' };
  var ROTULO_TIPO = { lidera: 'lidera', direto: 'trabalha com', indireto: 'cruza com' };
  var LIMITE_HORIZONTAL = 4; // até 4 liderados diretos do topo: linha horizontal (computador e A4)

  function rotuloNivel(n) { return ROTULO_NIVEL[n] || ROTULO_NIVEL.indefinido; }
  function nivelSeguro(n) { return ROTULO_NIVEL[n] ? n : 'indefinido'; }
  function letraDisc(codigo) {
    var l = String(codigo || '').toUpperCase().charAt(0);
    return LETRAS.indexOf(l) >= 0 ? l : '';
  }
  function codigoSeguro(c) { return String(c || '').toUpperCase().replace(/[^DISC]/g, '').slice(0, 2); }
  function seloNivel(n, pontuacao) {
    var nv = nivelSeguro(n);
    return '<span class="selo-doc selo-doc--nv-' + nv + '">' + esc(rotuloNivel(nv)) + (ehNumero(pontuacao) ? ' · ' + esc(numeroCurto(pontuacao)) : '') + '</span>';
  }
  function listaItens(itens, classe) {
    var l = lista(itens).filter(function (t) { return typeof t === 'string' && t; });
    if (!l.length) return '';
    return '<ul class="itens-doc' + (classe ? ' ' + classe : '') + '">' + l.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>';
  }
  function n2(i) { return (i < 9 ? '0' : '') + (i + 1); }

  // Cartão de uma pessoa (organograma e listas): quadrado com a letra DISC na cor do fator.
  function cartaoPessoa(no) {
    var l = letraDisc(no.codigo || no.primario);
    var cod = codigoSeguro(no.codigo);
    return '<div class="org-cartao' + (l ? ' org-cartao--' + l : ' org-cartao--sem') + (no.foco ? ' org-cartao--foco' : '') + '">' +
      '<span class="org-cartao__letra' + (l ? ' disc-fundo-' + l : '') + '" aria-hidden="true">' + (l || '–') + '</span>' +
      '<span class="org-cartao__txt"><strong class="org-cartao__nome">' + esc(no.nome) + '</strong>' +
      (no.cargo ? '<span class="org-cartao__cargo">' + esc(no.cargo) + '</span>' : '') +
      '<span class="org-cartao__cod">' + (cod ? 'Perfil ' + esc(cod) : 'Sem teste') + (no.foco ? ' · candidato' : '') + '</span></span></div>';
  }

  // Organograma: árvore de cartões ligados por linhas (CSS). Celular: lista recuada por nível.
  // Computador e A4: os liderados diretos do topo ficam lado a lado (até 4); níveis abaixo descem em lista.
  // Aceita o organograma do DISC_COMPATIBILIDADE.montar ou o snapshot dos modelos: { raizes: [{nome, cargo, codigo, filhos}] }.
  function organogramaHtml(organograma, opcoes) {
    var op = opcoes || {};
    var raizes = lista(organograma && organograma.raizes);
    var focoId = op.focoId != null ? String(op.focoId) : null;
    function marcar(no) { return focoId !== null && String(no.id) === focoId ? Object.assign({}, no, { foco: true }) : no; }
    function ramo(no, nivel) {
      var filhos = lista(no.filhos);
      var linha = nivel === 0 && filhos.length > 1 && filhos.length <= LIMITE_HORIZONTAL;
      return '<li class="org__no">' + cartaoPessoa(marcar(no)) +
        (filhos.length ? '<ul class="org__filhos' + (linha ? ' org__filhos--linha' : '') + (filhos.length === 1 ? ' org__filhos--um' : '') + '">' +
          filhos.map(function (f) { return ramo(f, nivel + 1); }).join('') + '</ul>' : '') + '</li>';
    }
    var arvores = raizes.filter(function (r) { return lista(r.filhos).length; });
    var soltos = raizes.filter(function (r) { return !lista(r.filhos).length; });
    if (!raizes.length) return '<div class="org org--vazio"><p class="nota-curta">Nenhum colaborador no organograma.</p></div>';
    var rotulo = op.rotulo || 'Organograma';
    return '<div class="org" role="group" aria-label="' + esc(rotulo) + '">' +
      arvores.map(function (r) { return '<ul class="org__arvore">' + ramo(r, 0) + '</ul>'; }).join('') +
      (soltos.length ? '<div class="org__soltos">' + (arvores.length ? '<div class="org__soltos-tit">Sem liderança registrada</div>' : '') +
        '<ul class="org__grade">' + soltos.map(function (r) { return '<li>' + cartaoPessoa(marcar(r)) + '</li>'; }).join('') + '</ul></div>' : '') +
      '<p class="org__legenda"><span class="disc-fundo-D">D</span> Dominância <span class="disc-fundo-I">I</span> Influência <span class="disc-fundo-S">S</span> Estabilidade <span class="disc-fundo-C">C</span> Conformidade</p>' +
      '</div>';
  }

  function capaModelo(c) {
    var numeros = lista(c.numeros).map(function (n) {
      return '<div class="capa__num' + (n.destaque ? ' capa__num--destaque' : '') + (n.texto ? ' capa__num--texto' : '') + '">' +
        '<div class="capa__num-valor">' + esc(n.valor) + (n.sufixo ? '<small>' + esc(n.sufixo) + '</small>' : '') + '</div>' +
        '<div class="capa__num-rotulo">' + esc(n.rotulo) + '</div></div>';
    }).join('');
    var rodape = lista(c.rodape).map(function (r) {
      return '<div><div class="capa__rod-rotulo">' + esc(r.rotulo) + '</div><div class="capa__rod-valor">' +
        lista(r.linhas).filter(Boolean).map(esc).join('<br>') + '</div></div>';
    }).join('');
    return '<section class="capa capa--modelo" id="capa" data-secao="capa" aria-label="Capa">' +
      '<div class="capa__grade" aria-hidden="true"></div>' +
      '<header class="capa__topo">' +
        '<span class="marca-doc"><img class="marca-doc__logo" src="assets/icone.svg" alt="" width="32" height="32">' +
        '<span class="marca-doc__nome">Notus <em>Agência</em></span></span>' +
        '<span class="capa__meta"><span>' + esc(c.meta) + '</span></span>' +
      '</header>' +
      '<div class="capa__miolo">' +
        '<div class="capa__sobre"><span class="ponto" aria-hidden="true"></span>' + esc(c.sobre) + '</div>' +
        '<h1 class="capa__titulo">' + c.tituloHtml + '</h1>' +
        (c.subtitulo ? '<p class="capa__subtitulo">' + esc(c.subtitulo) + '</p>' : '') +
        (numeros ? '<div class="capa__numeros">' + numeros + '</div>' : '') +
      '</div>' +
      '<footer class="capa__rodape">' + rodape + '</footer>' +
    '</section>';
  }

  function indiceModelo(secoes, titulo, sub) {
    return '<section class="pagina pagina--creme" id="indice" data-secao="indice" aria-labelledby="indice-tit">' +
      '<div class="pag-cab"><span class="pag-cab__num">Índice</span><span class="pag-cab__regua" aria-hidden="true"></span></div>' +
      '<div class="indice"><div class="indice__tit"><h2 id="indice-tit">' + esc(titulo) + '</h2><p>' + esc(sub) + '</p></div>' +
      '<ol class="indice__lista">' + secoes.map(function (s) {
        return '<li><a href="#' + s.id + '"><span class="indice__n">' + s.n + '</span><span class="indice__t">' + esc(s.titulo) + '</span><span class="indice__seta" aria-hidden="true">→</span></a></li>';
      }).join('') + '</ol></div></section>';
  }

  function encerramentoModelo(s, cab, corpo, assinatura, data_) {
    return '<section class="secao secao--escura" id="' + s.id + '" data-secao="' + s.id + '" aria-labelledby="' + s.id + '-tit">' +
      '<h2 class="visualmente-oculto" id="' + s.id + '-tit">' + esc(s.n + ' · ' + s.titulo) + '</h2>' +
      '<div class="pagina pagina--escura">' + cabecalhoPagina(s, cab, true) + corpo +
      '<div class="assina"><div class="assina__linha" aria-hidden="true"></div>' +
      '<div class="assina__nome">' + esc(assinatura || 'Notus Agência') + '</div>' +
      '<div class="assina__papel">Consultoria · Notus Agência</div>' +
      (data_ ? '<div class="assina__data">' + esc(data(data_)) + '</div>' : '') + '</div></div></section>';
  }

  function rodapeModelo(meta, nota) {
    return '<footer class="rodape-doc" data-secao="rodape">' +
      '<span class="marca-doc"><img class="marca-doc__logo" src="assets/icone.svg" alt="" width="28" height="28"><span class="marca-doc__nome">Notus <em>Agência</em></span></span>' +
      '<span class="rodape-doc__meta">' + esc(meta.filter(Boolean).join(' · ')) + '<br>' + esc(nota) + '</span></footer>';
  }

  function pilhaDe(percentuais) { return percentuais && typeof percentuais === 'object' ? barraDisc(percentuais) : ''; }

  /* ------------------------------------------------------------------ EQUIPE */

  function secoesEquipe(d) {
    var s = [
      { id: 'sumario', titulo: 'Sumário executivo', meta: 'Equilíbrio · Harmonia · Destaques e alertas' },
      { id: 'organograma', titulo: 'Organograma com perfis', curto: 'Organograma', meta: 'Quem lidera quem · Perfil DISC de cada pessoa' },
      { id: 'equilibrio', titulo: 'Equilíbrio do time', meta: 'Média D/I/S/C · Estilos · Lacunas' },
      { id: 'relacoes', titulo: 'Mapa de relações', meta: 'Fluido · Atenção · Tensão' },
      { id: 'lideres', titulo: 'Guia por líder', meta: 'Como conduzir cada liderado' },
      { id: 'pessoas', titulo: 'Como liderar cada pessoa', curto: 'Como liderar', meta: 'Comunicação · Delegação · Feedback · Motivação' }
    ];
    if (d.foco) s.push({ id: 'foco', titulo: 'Encaixe do candidato', curto: 'Encaixe', meta: 'Relações · Equipe · Plano de 90 dias' });
    s.push({ id: 'encerramento', titulo: 'Limites e próximos passos', curto: 'Limites', meta: 'Como usar este relatório' });
    s.forEach(function (x, i) { x.n = n2(i); });
    return s;
  }

  function equipeHtml(d) {
    var emp = d.empresa || {};
    var num = d.numeros || {};
    var sum = d.sumario || {};
    var eqb = d.equilibrio || {};
    var S = secoesEquipe(d);
    function sec(id) { return S.filter(function (x) { return x.id === id; })[0]; }
    var h = capaModelo({
      meta: 'Relatório de equipe', sobre: 'Relatório de equipe · ' + (emp.nome || 'Empresa'),
      tituloHtml: 'Mapa da <em>equipe</em>' + (emp.nome ? '<br>' + esc(emp.nome) : ''),
      subtitulo: 'Organograma com perfis DISC, equilíbrio do time, compatibilidade entre as pessoas e como liderar cada uma.',
      numeros: [
        { valor: numeroCurto(num.pessoas), rotulo: 'pessoas no time' },
        { valor: numeroCurto(num.comTeste), rotulo: 'com teste DISC' },
        { valor: numeroCurto(num.relacoes), rotulo: 'relações analisadas' },
        { valor: ehNumero(num.harmonia) ? numeroCurto(num.harmonia) : '—', sufixo: ehNumero(num.harmonia) ? '/100' : '', rotulo: 'harmonia geral', destaque: true }
      ],
      rodape: [
        { rotulo: 'Empresa', linhas: [emp.nome || '—', emp.cidade] },
        { rotulo: 'Consultoria', linhas: ['Notus Agência', d.consultor] },
        { rotulo: 'Emitido em', linhas: [data(d.geradoEm) || '—'] },
        { rotulo: 'Equilíbrio', linhas: [eqb.rotulo || '—'] }
      ]
    });
    h += indiceModelo(S, 'Quem é o time, como ele se equilibra e como liderar cada pessoa.', 'Leitura comportamental (DISC) da equipe: use para conversar, combinar e desenvolver, não para rotular.');

    // 01 Sumário
    var c = '<p class="lede">' + esc((sum.equilibrio && sum.equilibrio.texto) || eqb.texto || '') + '</p>';
    c += '<div class="mini-nums">' +
      '<div class="mini-num"><div class="mini-num__valor mini-num__valor--texto">' + esc(eqb.rotulo || '—') + '</div><div class="mini-num__rot">equilíbrio do time</div></div>' +
      '<div class="mini-num"><div class="mini-num__valor">' + (ehNumero(sum.harmonia) ? esc(numeroCurto(sum.harmonia)) + '<small>/100</small>' : '—') + '</div><div class="mini-num__rot">harmonia (' + esc(rotuloNivel(sum.harmoniaNivel).toLowerCase()) + ')</div></div>' +
      '<div class="mini-num"><div class="mini-num__valor">' + esc(numeroCurto((sum.niveis && sum.niveis.tensao) || 0)) + '</div><div class="mini-num__rot">relações em tensão</div></div>' +
      '</div>';
    var dest = lista(sum.destaques), al = lista(sum.alertas);
    c += '<div class="duas mt32"><div><h3 class="h3">Destaques</h3><div class="obs-pilha">' +
      (dest.length ? dest.map(function (t, i) { return '<div class="obs obs--destaque"><div class="obs__tit">' + n2(i) + '</div><p>' + esc(t) + '</p></div>'; }).join('') : '<p class="nota-curta">Sem destaques até aqui.</p>') +
      '</div></div><div><h3 class="h3">Alertas</h3><div class="obs-pilha">' +
      (al.length ? al.map(function (t, i) { return '<div class="obs obs--alerta"><div class="obs__tit">' + n2(i) + '</div><p>' + esc(t) + '</p></div>'; }).join('') : '<p class="nota-curta">Nenhum alerta relevante.</p>') +
      '</div></div></div>';
    h += secao(sec('sumario'), false, cabecalhoPagina(sec('sumario'), emp.nome) + c);

    // 02 Organograma
    c = '<h3 class="h2doc">Quem lidera quem</h3><p class="lede lede--curta">Cada cartão traz a letra principal do perfil DISC na cor do fator. Quem ainda não fez o teste aparece com traço.</p>' +
      '<div class="cartao-doc">' + organogramaHtml(d.organograma) + '</div>';
    h += secao(sec('organograma'), true, cabecalhoPagina(sec('organograma'), numeroCurto(num.pessoas) + ' pessoas') + c);

    // 03 Equilíbrio
    var media = eqb.media || {}, dist = eqb.distribuicao || {};
    c = '<h3 class="h2doc">' + esc(eqb.rotulo || 'Equilíbrio') + '</h3><p class="lede lede--curta">' + esc(eqb.texto || '') + '</p>';
    c += '<div class="duas"><div class="cartao-doc"><div class="rotulo-doc">Média do time por fator</div><ul class="barras">' + LETRAS.map(function (L) {
      return '<li><span class="barras__rot"><span class="legenda disc-fundo-' + L + '" aria-hidden="true"></span>' + esc(NOMES_DISC[L].nome) + '</span>' +
        barra(media[L], 50, 'barra--disc-' + L, NOMES_DISC[L].nome + ' ' + pct(media[L])) + '<span class="barras__val"><strong>' + esc(pct(media[L])) + '</strong></span></li>';
    }).join('') + '</ul><p class="nota-curta">Escala da barra: 0 a 50%. A média de cada fator num perfil é 25%.</p></div>' +
      '<div class="cartao-doc"><div class="rotulo-doc">Estilo principal das pessoas</div><ul class="barras">' + LETRAS.map(function (L) {
        return '<li><span class="barras__rot"><span class="legenda disc-fundo-' + L + '" aria-hidden="true"></span>' + esc(NOMES_DISC[L].nome) + '</span>' +
          barra(dist[L] || 0, eqb.comTeste || 1, 'barra--disc-' + L, NOMES_DISC[L].nome + ': ' + (dist[L] || 0)) + '<span class="barras__val"><strong>' + esc(numeroCurto(dist[L] || 0)) + '</strong> de ' + esc(numeroCurto(eqb.comTeste || 0)) + '</span></li>';
      }).join('') + (dist.equilibrado ? '<li><span class="barras__rot">Perfil equilibrado</span>' + barra(dist.equilibrado, eqb.comTeste || 1, '') + '<span class="barras__val"><strong>' + esc(numeroCurto(dist.equilibrado)) + '</strong></span></li>' : '') +
      '</ul></div></div>';
    var gaps = lista(eqb.falta).map(function (f) { return nota('alerta', 'Lacuna: ' + f.nome, f.texto); })
      .concat(lista(eqb.excesso).map(function (f) { return nota('alerta', 'Em excesso: ' + f.nome, f.texto); }));
    c += '<h3 class="h3 mt48">Lacunas e excessos</h3>' + (gaps.length ? '<div class="obs-grade">' + gaps.join('') + '</div>' :
      '<div class="obs obs--destaque mt24"><div class="obs__tit">Sem lacunas</div><p>Todos os fatores têm ao menos uma pessoa em destaque e nenhum domina o time.</p></div>');
    var sem = lista(eqb.semTeste);
    if (sem.length) c += '<div class="obs obs--info mt24"><div class="obs__tit">Sem teste (' + esc(sem.length) + ')</div><p>' + esc(sem.map(function (x) { return x.nome + (x.cargo ? ' (' + x.cargo + ')' : ''); }).join(', ')) + '. Aplicar o teste completa a leitura do time.</p></div>';
    h += secao(sec('equilibrio'), false, cabecalhoPagina(sec('equilibrio'), numeroCurto(eqb.comTeste) + ' com teste') + c);

    // 04 Mapa de relações
    var pares = lista(d.pares);
    var cont = { fluido: 0, atencao: 0, tensao: 0, indefinido: 0 };
    pares.forEach(function (p) { cont[nivelSeguro(p.nivel)]++; });
    c = '<h3 class="h2doc">Como as relações tendem a funcionar</h3><p class="lede lede--curta">Cada par com relação registrada (liderança, trabalho direto ou indireto). Pontuação de 0 a 100: a partir de 70 tende a fluir; abaixo de 50, pede acordos explícitos.</p>';
    c += '<div class="niveis-doc">' + ['fluido', 'atencao', 'tensao'].map(function (n) {
      return '<div class="nivel-doc nivel-doc--' + n + '"><div class="nivel-doc__valor">' + esc(cont[n]) + '</div><div class="nivel-doc__rot">' + esc(rotuloNivel(n)) + '</div></div>';
    }).join('') + '</div>';
    if (pares.length) {
      c += '<ol class="pares-doc">' + pares.map(function (p) {
        var nv = nivelSeguro(p.nivel);
        var cods = lista(p.codigos);
        return '<li class="par-doc par-doc--' + nv + '">' +
          '<div class="par-doc__cab"><span class="par-doc__nomes"><strong>' + esc(p.deNome) + '</strong> <span class="par-doc__tipo">' + esc(ROTULO_TIPO[p.tipo] || 'com') + '</span> <strong>' + esc(p.paraNome) + '</strong></span>' +
          seloNivel(nv, p.pontuacao) + '</div>' +
          (cods.length === 2 ? '<div class="par-doc__cods">' + esc(codigoSeguro(cods[0]) + ' × ' + codigoSeguro(cods[1])) + '</div>' : '') +
          (ehNumero(p.pontuacao) ? barra(p.pontuacao, 100, 'barra--nv-' + nv, 'Pontuação ' + p.pontuacao + ' de 100') : '') +
          '<div class="par-doc__grade">' +
          (lista(p.sinergias).length ? '<div><div class="rotulo-doc">Sinergias</div>' + listaItens(p.sinergias) + '</div>' : '') +
          (lista(p.riscos).length ? '<div><div class="rotulo-doc">Riscos</div>' + listaItens(p.riscos) + '</div>' : '') +
          (lista(p.dicas).length ? '<div><div class="rotulo-doc">Dicas</div>' + listaItens(p.dicas) + '</div>' : '') +
          '</div></li>';
      }).join('') + '</ol>';
    } else c += '<div class="obs obs--info mt24"><div class="obs__tit">Sem relações registradas</div><p>Registre quem lidera quem e quem trabalha com quem para ver o mapa.</p></div>';
    h += secao(sec('relacoes'), true, cabecalhoPagina(sec('relacoes'), pares.length + ' relações') + c);

    // 05 Guia por líder
    var lids = lista(d.liderancas);
    c = '<h3 class="h2doc">Como cada líder pode conduzir a equipe</h3><p class="lede lede--curta">Estilo provável de cada líder e, para cada liderado, a tendência da relação e o que fazer no dia a dia.</p>';
    c += lids.length ? lids.map(function (l) {
      return '<article class="lider-doc">' +
        '<div class="lider-doc__cab">' + cartaoPessoa({ nome: l.nome, cargo: l.cargo, codigo: l.codigo }) + '</div>' +
        (l.estilo ? '<p class="lider-doc__estilo">' + esc(l.estilo) + '</p>' : '') +
        (lista(l.alertas).length ? '<div class="obs obs--alerta"><div class="obs__tit">Atenção</div>' + listaItens(l.alertas) + '</div>' : '') +
        '<ul class="liderados-doc">' + lista(l.liderados).map(function (x) {
          return '<li class="liderado-doc"><div class="liderado-doc__cab"><strong>' + esc(x.nome) + '</strong>' +
            (x.codigo ? '<span class="quadro-disc__cod">' + esc(codigoSeguro(x.codigo)) + '</span>' : '') +
            (x.estiloLiderado ? '<span class="liderado-doc__estilo">' + esc(x.estiloLiderado) + '</span>' : '') + seloNivel(x.nivel, x.pontuacao) + '</div>' +
            (x.tendencia ? '<p>' + esc(x.tendencia) + '</p>' : '') +
            (lista(x.comoConduzir).length ? '<div class="rotulo-doc mt16">Como conduzir</div>' + listaItens(x.comoConduzir) : '') + '</li>';
        }).join('') + '</ul></article>';
    }).join('') : '<div class="obs obs--info"><div class="obs__tit">Sem lideranças registradas</div><p>Registre as relações "lidera" para ver o guia por líder.</p></div>';
    h += secao(sec('lideres'), false, cabecalhoPagina(sec('lideres'), lids.length + ' líderes') + c);

    // 06 Como liderar cada pessoa
    var cols = lista(d.colaboradores);
    c = '<h3 class="h2doc">Como liderar cada pessoa</h3><p class="lede lede--curta">Resumo prático do guia de liderança de cada colaborador. O guia completo pode ser enviado ao líder em um relatório individual.</p>';
    c += '<div class="pessoas-doc">' + cols.map(function (p) {
      return '<article class="pessoa-doc">' + cartaoPessoa(p) +
        (p.codigo ? pilhaDe(p.percentuais) : '') +
        (p.estilo ? '<div class="pessoa-doc__estilo">' + esc(p.estilo) + '</div>' : '') +
        (p.resumo ? '<p class="pessoa-doc__resumo">' + esc(p.resumo) + '</p>' : '') +
        (lista(p.secoes).length ? lista(p.secoes).map(function (s) {
          return '<div class="pessoa-doc__sec"><div class="rotulo-doc">' + esc(s.titulo) + '</div>' + listaItens(s.itens) + '</div>';
        }).join('') : '<p class="nota-curta">Ainda sem teste: o guia aparece quando a pessoa responder.</p>') +
        '</article>';
    }).join('') + '</div>';
    h += secao(sec('pessoas'), true, cabecalhoPagina(sec('pessoas'), cols.length + ' pessoas') + c);

    // 07 Encaixe do candidato
    if (d.foco) {
      var f = d.foco;
      var rel = [];
      if (f.lider) rel.push({ papel: 'Líder', x: f.lider });
      lista(f.liderados).forEach(function (x) { rel.push({ papel: 'Liderado(a)', x: x }); });
      lista(f.diretos).forEach(function (x) { rel.push({ papel: 'Trabalho direto', x: x }); });
      lista(f.indiretos).forEach(function (x) { rel.push({ papel: 'Trabalho indireto', x: x }); });
      c = '<div class="rec"><div class="rec__topo"><span class="rec__etiqueta">Encaixe do candidato</span>' +
        '<span class="rec__nota"><span class="rec__nota-num">' + (ehNumero(f.pontuacao) ? esc(numeroCurto(f.pontuacao)) : '—') + '</span><span class="rec__nota-den">/100</span></span></div>' +
        '<div class="rec__nome">' + esc(f.nome) + ' ' + seloNivel(f.nivel) + '</div>' +
        '<div class="rec__texto"><p>' + esc((f.cargo ? 'Posição: ' + f.cargo + '. ' : '') + (f.codigo ? 'Perfil ' + codigoSeguro(f.codigo) + '.' : 'Ainda sem teste DISC.')) + '</p></div></div>';
      if (f.percentuais) c += '<div class="mt24">' + pilhaDe(f.percentuais) + '</div>';
      if (f.organograma) c += '<h3 class="h3 mt48">Onde entra no organograma</h3><div class="cartao-doc">' + organogramaHtml(f.organograma, { rotulo: 'Organograma com o candidato' }) + '</div>';
      if (rel.length) {
        c += '<h3 class="h3 mt48">Relações na posição</h3><ul class="ranklista">' + rel.map(function (r) {
          return '<li><span class="ranklista__pos ranklista__pos--txt">' + esc(r.papel) + '</span><span class="ranklista__nome"><strong>' + esc(r.x.nome) + '</strong></span>' + seloNivel(r.x.nivel, r.x.pontuacao) + '</li>';
        }).join('') + '</ul>';
      }
      var enc = f.encaixeEquipe || {};
      if (lista(enc.preencheLacunas).length || lista(enc.reforcaExcesso).length) {
        c += '<p class="nota-curta mt24">' + esc((lista(enc.preencheLacunas).length ? 'Preenche lacuna do time: ' + enc.preencheLacunas.join(', ') + '. ' : '') +
          (lista(enc.reforcaExcesso).length ? 'Reforça fator que já predomina: ' + enc.reforcaExcesso.join(', ') + '.' : '')) + '</p>';
      }
      c += '<div class="duas mt32"><div class="cartao-doc"><div class="rotulo-doc">Pontos fortes do encaixe</div>' + (listaItens(f.pontosFortes) || '<p class="nota-curta">—</p>') + '</div>' +
        '<div class="cartao-doc"><div class="rotulo-doc">Riscos e cuidados</div>' + (listaItens(f.riscos) || '<p class="nota-curta">Nenhum risco típico.</p>') + '</div></div>';
      var etapas = lista(f.recomendacoes90);
      if (etapas.length) {
        c += '<h3 class="h3 mt48">Plano para os primeiros 90 dias</h3><div class="etapas90">' + etapas.map(function (e) {
          return '<div class="cartao-doc"><div class="rotulo-doc">' + esc(e.periodo) + '</div>' + listaItens(e.itens) + '</div>';
        }).join('') + '</div>';
      }
      h += secao(sec('foco'), false, cabecalhoPagina(sec('foco'), f.nome) + c);
    }

    // Encerramento: avisos e limites
    var av = d.avisos || {};
    c = '<div class="final__texto"><p>Este relatório mostra tendências de comportamento para orientar conversas, combinados e o desenvolvimento do time.</p></div>' +
      '<div class="passos-cab">Limites do DISC</div><ol class="passos">' + lista(av.limites).map(function (t, i) {
        return '<li><span class="passos__n">' + n2(i) + '</span><span class="passos__t passos__t--texto">' + esc(t) + '</span></li>';
      }).join('') + '</ol>' +
      (lista(av.observacoes).length ? '<div class="passos-cab">Observações sobre os dados</div>' + listaItens(av.observacoes, 'itens-doc--escuro') : '');
    h += encerramentoModelo(sec('encerramento'), emp.nome, c, d.consultor, d.geradoEm);
    h += rodapeModelo([d.consultor ? 'Consultor: ' + d.consultor : '', emp.nome, 'Relatório de equipe'], 'Documento confidencial, para uso da direção. Sem dados de contato dos colaboradores.');
    return '<article class="doc doc--equipe" data-modelo="equipe">' + h + '</article>';
  }

  /* ------------------------------------------------------------------ LIDERANÇA (individual) */

  function liderancaHtml(d) {
    var p = d.pessoa || {};
    var emp = d.empresa || {};
    var S = [
      { id: 'resumo', titulo: 'Quem é ' + (p.nome || 'esta pessoa'), curto: 'Quem é', meta: 'Perfil · Estilo · Relação com o líder' },
      { id: 'liderar', titulo: 'Como liderar no dia a dia', curto: 'Como liderar', meta: 'Comunicação · Delegação · Feedback · Plano' },
      { id: 'encerramento', titulo: 'Limites deste guia', curto: 'Limites', meta: 'Como usar' }
    ];
    S.forEach(function (x, i) { x.n = n2(i); });
    var cod = codigoSeguro(p.codigo);
    var h = capaModelo({
      meta: 'Guia de liderança', sobre: 'Guia de liderança' + (emp.nome ? ' · ' + emp.nome : ''),
      tituloHtml: 'Como liderar <em>' + esc(p.nome || 'esta pessoa') + '</em>',
      subtitulo: ('Um guia curto para o líder: como se comunicar, delegar, dar feedback e acompanhar ' + (p.nome || 'esta pessoa') + '.').replace(/\.\.$/, '.'),
      numeros: [
        { valor: cod || '—', rotulo: 'perfil DISC' },
        { valor: p.estilo || '—', rotulo: 'estilo', destaque: true, texto: true }
      ],
      rodape: [
        { rotulo: 'Colaborador(a)', linhas: [p.nome, p.cargo] },
        { rotulo: 'Líder', linhas: [d.lider ? d.lider.nome : '—'] },
        { rotulo: 'Empresa', linhas: [emp.nome || '—'] },
        { rotulo: 'Emitido em', linhas: [data(d.geradoEm) || '—'] }
      ]
    });
    // 01
    var c = '<p class="lede">' + esc(d.resumo || '') + '</p>' + pilhaDe(p.percentuais);
    if (d.relacao) {
      var r = d.relacao;
      c += '<h3 class="h3 mt48">Você e ' + esc(p.nome) + '</h3><div class="par-doc par-doc--' + nivelSeguro(r.nivel) + '">' +
        '<div class="par-doc__cab"><span class="par-doc__nomes"><strong>' + esc(d.lider && d.lider.nome) + '</strong> <span class="par-doc__tipo">lidera</span> <strong>' + esc(p.nome) + '</strong></span>' + seloNivel(r.nivel, r.pontuacao) + '</div>' +
        (ehNumero(r.pontuacao) ? barra(r.pontuacao, 100, 'barra--nv-' + nivelSeguro(r.nivel), 'Pontuação ' + r.pontuacao + ' de 100') : '') +
        '<div class="par-doc__grade">' +
        (lista(r.sinergias).length ? '<div><div class="rotulo-doc">Sinergias</div>' + listaItens(r.sinergias) + '</div>' : '') +
        (lista(r.riscos).length ? '<div><div class="rotulo-doc">Riscos</div>' + listaItens(r.riscos) + '</div>' : '') +
        (lista(r.dicas).length ? '<div><div class="rotulo-doc">Dicas</div>' + listaItens(r.dicas) + '</div>' : '') + '</div></div>';
    }
    var h1 = secao(S[0], false, cabecalhoPagina(S[0], p.cargo) + c);
    // 02
    c = '<div class="guia-doc">' + lista(d.secoes).map(function (s, i) {
      var corpo = lista(s.etapas).length ? lista(s.etapas).map(function (e) {
        return '<div class="guia-doc__etapa"><div class="rotulo-doc">' + esc(e.periodo) + '</div>' + listaItens(e.itens) + '</div>';
      }).join('') : listaItens(s.itens);
      return '<article class="guia-doc__sec' + (s.chave === 'plano' || s.chave === 'voceEEla' ? ' guia-doc__sec--larga' : '') + '"><div class="leitura__n">' + n2(i) + '</div><h3 class="h4doc">' + esc(s.titulo) + '</h3>' + corpo + '</article>';
    }).join('') + '</div>';
    var h2 = secao(S[1], true, cabecalhoPagina(S[1], cod ? 'Perfil ' + cod : '') + c);
    var h3 = encerramentoModelo(S[2], emp.nome, '<div class="final__texto"><p>' + esc(d.aviso || '') + '</p></div>', d.consultor, d.geradoEm);
    return '<article class="doc doc--lideranca" data-modelo="lideranca">' + h + h1 + h2 + h3 +
      rodapeModelo([emp.nome, 'Guia de liderança', p.nome], 'Documento confidencial, para o líder direto. Sem dados de contato.') + '</article>';
  }

  /* ------------------------------------------------------------------ PESSOA (desenvolvimento) */

  function pessoaHtml(d) {
    var p = d.pessoa || {};
    var pri = p.primario || {}, sec2 = p.secundario || {};
    var secs = lista(d.secoes);
    var S = [{ id: 'perfil', titulo: 'Seu perfil', meta: 'Os quatro fatores do DISC' }];
    secs.forEach(function (s) {
      var id = String(s.id || '').replace(/[^a-z]/g, '') || 'secao';
      S.push({ id: id, titulo: s.titulo, curto: { fortes: 'Pontos fortes', atencao: 'Pontos de atenção', pressao: 'Sob pressão', comunicacao: 'Comunicação', plano: 'Seu plano' }[id], meta: '', dados: s });
    });
    S.push({ id: 'encerramento', titulo: 'Para levar com você', curto: 'Para levar', meta: '' });
    S.forEach(function (x, i) { x.n = n2(i); });
    var fat = lista(d.fatores);
    var h = capaModelo({
      meta: 'Relatório de desenvolvimento', sobre: 'Relatório de desenvolvimento pessoal',
      tituloHtml: 'Olá, ' + esc(p.primeiroNome || p.nome || '') + '. Este é o seu <em>jeito de trabalhar</em>.',
      subtitulo: d.frase,
      numeros: fat.map(function (f) { return { valor: numeroCurto(f.pct), sufixo: '%', rotulo: f.nome, destaque: f.letra === pri.letra }; }),
      rodape: [
        { rotulo: 'Para', linhas: [p.nome] },
        { rotulo: 'Seu estilo', linhas: [codigoSeguro(p.codigo) + (pri.nome ? ' · ' + pri.nome + (sec2.nome ? ' e ' + sec2.nome : '') : '')] },
        { rotulo: 'Consultoria', linhas: ['Notus Agência', d.consultor] },
        { rotulo: 'Emitido em', linhas: [data(d.geradoEm) || '—'] }
      ]
    });
    var c = '<p class="lede">' + esc(d.frase || '') + '</p>' + pilhaDe(fat.reduce(function (o, f) { o[f.letra] = f.pct; return o; }, {})) +
      '<div class="disc-defs mt32">' + fat.map(function (f) {
        var L = letraDisc(f.letra);
        return '<div class="disc-def' + (L === pri.letra ? ' disc-def--ideal' : '') + '"><div class="disc-def__letra disc-letra-' + L + '">' + L + '</div>' +
          '<div class="disc-def__nome">' + esc(f.nome) + ' <span class="disc-def__tag">' + esc(pct(f.pct)) + '</span></div><p>' + esc(f.descricao) + '</p></div>';
      }).join('') + '</div>' +
      '<p class="nota-curta mt24">Todo mundo tem um pouco dos quatro fatores. O que muda é a dose de cada um, e isso não é certo nem errado.</p>';
    h += secao(S[0], false, cabecalhoPagina(S[0], p.nome) + c);
    S.slice(1, -1).forEach(function (s, i) {
      var x = s.dados;
      var cc = (x.intro ? '<p class="lede lede--curta">' + esc(x.intro) + '</p>' : '');
      if (lista(x.caracteristicas).length) cc += '<ul class="chips-doc">' + lista(x.caracteristicas).map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>';
      if (lista(x.sinais).length) cc += '<div class="cartao-doc mt24"><div class="rotulo-doc">Sinais de que a pressão chegou</div>' + listaItens(x.sinais) + '</div>';
      if (lista(x.perfis).length) {
        cc += '<div class="disc-defs disc-defs--3 mt24">' + lista(x.perfis).map(function (pf) {
          var L = letraDisc(pf.letra);
          return '<div class="disc-def"><div class="disc-def__letra disc-letra-' + L + '">' + L + '</div><div class="disc-def__nome">' + esc(pf.nome) + (pf.rotulo ? ' <span class="disc-def__tag">' + esc(pf.rotulo) + '</span>' : '') + '</div><p>' + esc(pf.texto) + '</p></div>';
        }).join('') + '</div>';
      }
      if (lista(x.itens).length) {
        cc += (x.id === 'plano' ? '<ol class="plano-doc mt24">' : '<div class="leituras leituras--par mt24">') + lista(x.itens).map(function (it, k) {
          if (x.id === 'plano') return '<li><span class="plano-doc__prazo">' + esc(it.prazo) + '</span><span><strong>' + esc(it.titulo) + '</strong><span class="plano-doc__txt">' + esc(it.texto) + '</span></span></li>';
          return '<article class="leitura"><div class="leitura__n">' + n2(k) + '</div><h4>' + esc(it.titulo) + '</h4><p>' + esc(it.texto) + '</p></article>';
        }).join('') + (x.id === 'plano' ? '</ol>' : '</div>');
      }
      h += secao(s, i % 2 === 0, cabecalhoPagina(s, p.nome) + cc);
    });
    h += encerramentoModelo(S[S.length - 1], p.nome, '<div class="final__texto"><p>' + esc(d.aviso || '') + '</p></div>' +
      '<div class="passos-cab">Um passo de cada vez</div><p class="final__dica">Escolha um hábito do seu plano, pratique por algumas semanas e observe o que muda. Crescer é isso: pequenas escolhas repetidas.</p>', d.consultor, d.geradoEm);
    return '<article class="doc doc--pessoa" data-modelo="pessoa">' + h +
      rodapeModelo(['Relatório de desenvolvimento', p.nome], 'Documento pessoal. Compartilhe só se quiser.') + '</article>';
  }

  var MODELOS = { equipe: equipeHtml, lideranca: liderancaHtml, pessoa: pessoaHtml };

  /* ------------------------------------------------------------------ montagem */

  function contexto(rel) {
    var etapas = lista(rel.etapas);
    var linhas = lista(rel.ranking && rel.ranking.linhas).slice().sort(function (a, b) { return (a.posicao || 0) - (b.posicao || 0); });
    var somaPesos = 0, pesoPend = 0;
    etapas.forEach(function (e) { somaPesos += ehNumero(e.peso) ? e.peso : 0; if (e.pendente) pesoPend += ehNumero(e.peso) ? e.peso : 0; });
    var pendentes = etapas.filter(function (e) { return e.pendente; }).map(function (e) { return e.nome; });
    return {
      linhas: linhas,
      total: rel.atracao && ehNumero(rel.atracao.total) ? rel.atracao.total : 0,
      somaPesos: somaPesos,
      pesoPendentePct: somaPesos ? Math.round(pesoPend / somaPesos * 1000) / 10 : 0,
      etapasPendentes: pendentes,
      etapasFeitas: etapas.length - pendentes.length,
      pendente: pendentes.length > 0
    };
  }

  // Sem dados.modelo (ou 'processo'): relatório do processo seletivo. Modelos novos: equipe, lideranca, pessoa.
  function montarHtml(rel) {
    if (!rel || typeof rel !== 'object') return erroHtml(MENSAGEM_NAO_ENCONTRADO);
    if (rel.modelo && rel.modelo !== 'processo') {
      return Object.prototype.hasOwnProperty.call(MODELOS, rel.modelo) ? MODELOS[rel.modelo](rel) : erroHtml(MENSAGEM_NAO_ENCONTRADO);
    }
    var ctx = contexto(rel);
    return '<article class="doc">' + capa(rel, ctx) + indice(rel, ctx) + sumario(rel, ctx) + atracao(rel, ctx) +
      tecnica(rel, ctx) + disc(rel, ctx) + ranking(rel, ctx) + encerramento(rel, ctx) + rodape(rel) + '</article>';
  }

  function erroHtml(msg) {
    return '<div class="doc-erro" role="alert"><img class="marca-doc__logo" src="assets/icone.svg" alt="" width="44" height="44">' +
      '<h1 class="doc-erro__tit">' + esc(msg) + '</h1><p>Confira o link recebido ou fale com a consultoria.</p></div>';
  }

  function render(rel, elemento) {
    if (!elemento) return;
    elemento.innerHTML = montarHtml(rel);
    elemento.setAttribute('aria-busy', 'false');
  }

  function mostrarErro(elemento, msg) {
    if (!elemento) return;
    elemento.innerHTML = erroHtml(msg || MENSAGEM_NAO_ENCONTRADO);
    elemento.setAttribute('aria-busy', 'false');
    elemento.setAttribute('data-estado', 'erro');
  }

  // Busca pelo DISC_API.relatorioPublico (api.js / api-simulada.js). Sem o método: "não encontrado".
  function buscarRelatorio(token) {
    if (!token) return null;
    var api = root.DISC_API;
    if (!api || typeof api.relatorioPublico !== 'function') return null;
    return Promise.resolve().then(function () { return api.relatorioPublico(token); });
  }

  function iniciar() {
    var doc = root.document;
    var el = doc && doc.getElementById('relatorio');
    if (!el) return;
    var token = tokenDaUrl(root.location && root.location.search, root.location && root.location.hash);
    var busca = buscarRelatorio(token);
    if (!busca) { mostrarErro(el); return; }
    busca.then(function (resp) {
      var rel = resp && resp.relatorio;
      if (!resp || resp.ok === false || !rel || typeof rel !== 'object') { mostrarErro(el); return; }
      // relatorio_publico também devolve `modelo` ao lado do snapshot.
      if (!rel.modelo && resp.modelo && resp.modelo !== 'processo') rel = Object.assign({}, rel, { modelo: resp.modelo });
      render(rel, el);
      el.setAttribute('data-estado', 'pronto');
      if (rel.modelo && rel.modelo !== 'processo') {
        el.setAttribute('data-modelo', String(rel.modelo).replace(/[^a-z]/g, ''));
        doc.title = 'Relatório · ' + (rel.titulo || 'Notus Agência');
        return;
      }
      var p = rel.processo || {};
      doc.title = 'Relatório · ' + (p.vaga || p.nome || 'Processo seletivo') + (p.empresa ? ' · ' + p.empresa : '');
    }, function () { mostrarErro(el); });
  }

  var DISC_RELATORIO_VIEW = {
    MENSAGEM_NAO_ENCONTRADO: MENSAGEM_NAO_ENCONTRADO,
    esc: esc,
    numero: numero,
    numeroCurto: numeroCurto,
    moeda: moeda,
    pct: pct,
    data: data,
    periodo: periodo,
    rotuloSituacao: rotuloSituacao,
    rotuloAderencia: rotuloAderencia,
    rotuloConfiabilidade: rotuloConfiabilidade,
    tokenDaUrl: tokenDaUrl,
    texto: texto,
    montarHtml: montarHtml,
    organogramaHtml: organogramaHtml,
    rotuloNivel: rotuloNivel,
    render: render,
    mostrarErro: mostrarErro,
    iniciar: iniciar
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = DISC_RELATORIO_VIEW;
  else {
    root.DISC_RELATORIO_VIEW = DISC_RELATORIO_VIEW;
    if (root.document) {
      if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', iniciar);
      else iniciar();
    }
  }
})(typeof self !== 'undefined' ? self : this);
