/*
 * Página pública do relatório do processo seletivo (relatorio.html?r=TOKEN ou relatorio.html#r-TOKEN).
 *
 * Desenha o JSON "relatorio" (contrato em docs/SPEC.md / js/relatorio-motor.js) num documento editorial:
 * capa, índice, 01 sumário, 02 atração, 03 avaliação técnica, 04 DISC, 05 ranking, 06 encerramento, rodapé.
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

  function montarHtml(rel) {
    if (!rel || typeof rel !== 'object') return erroHtml(MENSAGEM_NAO_ENCONTRADO);
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
      if (!resp || resp.ok === false || !rel) { mostrarErro(el); return; }
      render(rel, el);
      el.setAttribute('data-estado', 'pronto');
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
