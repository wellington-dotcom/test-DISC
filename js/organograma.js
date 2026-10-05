/*
 * Organograma corporativo (árvore de cima para baixo, cartões ligados por linhas em ângulo reto).
 * UMD, global DISC_ORGANOGRAMA. Estilos: assets/organograma.css (+ tokens de assets/notus.css).
 *
 * Funções puras (testadas em tests/organograma.test.js):
 *   estrutura(dados)            -> { ids, porId, pai, filhos, raizes, sem, colegas }
 *   arvore(dados)               -> { raizes: [{ id, filhos: [...] }], semPosicao: [ids] }
 *   layout(arvore, opcoes?)     -> { nos: [{id,x,y,w,h,nivel,pai}], arestas: [{de,para,pontos}], largura, altura }
 *   mover(dados, id, destino)   -> { relacoes, topoIds, semPosicaoIds, erro, mudou }
 *                                  destino: {tipo:'lider', id} | {tipo:'topo'} | {tipo:'sem'}
 *   paraHtml(dados, opcoes?)    -> HTML estático (cartões + SVG) para leitura/impressão A4
 *
 * Componente (navegador):
 *   montar(container, dados)    -> { atualizar(dados), ajustar(), destruir() }
 *   dados = { pessoas: [{id, nome, cargo, foto, codigo, combinacao, semTeste}], relacoes: [{de, para, tipo}],
 *             topoIds?: [ids], semPosicaoIds?: [ids], modo: 'editar'|'ler',
 *             aoMudar?(relacoesNovas, mudanca), aoAbrirPessoa?(id) }
 *   relacoes: tipo 'lidera' (de = líder, para = liderado); 'direto'/'indireto' = colegas (linha tracejada opcional).
 *   topoIds: quem fica no topo (sem líder) mesmo sem liderados. Depois de cada mudança, mudanca.topoIds = todas as
 *            raízes atuais, na ordem do desenho (guarde junto com as relações).
 *   semPosicaoIds: ids que ficam na coluna "Sem posição" mesmo que as relações os coloquem na árvore.
 *   mudanca = { id, nome, de: destinoAnterior, para: destino, topoIds, semPosicaoIds, texto }.
 */
(function (root, fabrica) {
  var api = fabrica(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DISC_ORGANOGRAMA = api;
})(typeof window !== 'undefined' ? window : this, function (root) {
  'use strict';

  var CARTAO = { w: 224, h: 88 };
  var PADRAO = { largura: CARTAO.w, altura: CARTAO.h, espacoX: 24, espacoY: 60, espacoRaizes: 56, espacoPilha: 14, empilharAcima: 4 };
  var ESCALA_MIN = 0.3, ESCALA_MAX = 1.6, PASSO = 0.1, MARGEM = 24, AJUSTE_MAX = 1.15, AJUSTE_MIN = 0.9;
  var NOMES_DISC = { D: 'Dominância', I: 'Influência', S: 'Estabilidade', C: 'Conformidade' };

  /* ------------------------------------------------------------------ utilidades */

  function lista(v) { return Array.isArray(v) ? v : []; }
  function s(v) { return v == null ? '' : String(v); }
  function esc(v) {
    return s(v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  var FOTO_MAX = 40000;
  var RE_FOTO = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;
  function fotoValida(f) { return typeof f === 'string' && f.length <= FOTO_MAX && RE_FOTO.test(f); }
  function iniciais(nome) {
    var partes = s(nome).replace(/[^A-Za-zÀ-ÿ\s]/g, ' ').trim().split(/\s+/).filter(Boolean);
    if (!partes.length) return '?';
    var a = partes[0].charAt(0), b = partes.length > 1 ? partes[partes.length - 1].charAt(0) : '';
    return (a + b).toUpperCase();
  }
  function letraDisc(cod) { var l = s(cod).charAt(0).toUpperCase(); return NOMES_DISC[l] ? l : ''; }
  function codigoSeguro(cod) { var c = s(cod).toUpperCase(); return /^[DISC]{1,4}$/.test(c) ? c : ''; }

  function combinacoes() {
    if (root && root.DISC_COMBINACOES) return root.DISC_COMBINACOES;
    if (typeof require === 'function') { try { return require('./disc-combinacoes.js'); } catch (e) { /* sem nomes */ } }
    return null;
  }
  function nomeCombinacao(p) {
    if (p.combinacao && typeof p.combinacao === 'object' && p.combinacao.nome) return s(p.combinacao.nome);
    if (typeof p.combinacao === 'string' && p.combinacao.trim()) return p.combinacao.trim();
    var cb = combinacoes(), cod = codigoSeguro(p.codigo);
    var n = cb && cod ? cb.nome(cod.slice(0, 2)) : null;
    return n ? n.nome : '';
  }
  function textoPerfil(p) {
    if (p.semTeste || !codigoSeguro(p.codigo)) return 'Sem teste';
    var nome = nomeCombinacao(p), cod = codigoSeguro(p.codigo);
    return nome ? nome + ' · ' + cod : 'Perfil ' + cod;
  }

  /* ------------------------------------------------------------------ estrutura (pura) */

  // Monta quem lidera quem, a partir de pessoas + relações 'lidera' + topoIds. Ciclos nos dados são cortados
  // (a ligação da primeira pessoa do ciclo, na ordem de pessoas, é ignorada) — nada trava e ninguém some.
  function estrutura(dados) {
    var d = dados || {};
    var ids = [], porId = {}, ordem = {};
    lista(d.pessoas).forEach(function (p) {
      if (!p || p.id == null || s(p.id) === '') return;
      var id = s(p.id);
      if (porId[id]) return;
      porId[id] = p; ordem[id] = ids.length; ids.push(id);
    });
    var forcados = {};
    lista(d.semPosicaoIds).forEach(function (x) { if (porId[s(x)]) forcados[s(x)] = true; });
    var pai = {};
    lista(d.relacoes).forEach(function (r) {
      if (!r || r.tipo !== 'lidera') return;
      var de = s(r.de), para = s(r.para);
      if (!porId[de] || !porId[para] || de === para || forcados[de] || forcados[para]) return;
      if (pai[para] == null) pai[para] = de;
    });
    // Corta ciclos.
    var mudou = true;
    while (mudou) {
      mudou = false;
      for (var i = 0; i < ids.length && !mudou; i++) {
        var caminho = [], noCaminho = {}, x = ids[i];
        while (x != null && !noCaminho[x]) { noCaminho[x] = true; caminho.push(x); x = pai[x]; }
        if (x != null) {
          var ciclo = caminho.slice(caminho.indexOf(x));
          ciclo.sort(function (a, b) { return ordem[a] - ordem[b]; });
          delete pai[ciclo[0]];
          mudou = true;
        }
      }
    }
    var filhos = {};
    ids.forEach(function (id) { filhos[id] = []; });
    ids.forEach(function (id) { if (pai[id] != null) filhos[pai[id]].push(id); });
    var topo = [];
    lista(d.topoIds).forEach(function (x) { x = s(x); if (porId[x] && !forcados[x] && topo.indexOf(x) === -1) topo.push(x); });
    var raizes = [];
    topo.forEach(function (x) { if (pai[x] == null) raizes.push(x); });
    ids.forEach(function (x) { if (pai[x] == null && filhos[x].length && raizes.indexOf(x) === -1) raizes.push(x); });
    var posicionado = {};
    (function marcar(l) { l.forEach(function (x) { if (!posicionado[x]) { posicionado[x] = true; marcar(filhos[x]); } }); })(raizes);
    var sem = ids.filter(function (x) { return !posicionado[x]; });
    var colegas = [], vistos = {};
    lista(d.relacoes).forEach(function (r) {
      if (!r || (r.tipo !== 'direto' && r.tipo !== 'indireto')) return;
      var a = s(r.de), b = s(r.para);
      if (!porId[a] || !porId[b] || a === b) return;
      var k = a < b ? a + '|' + b : b + '|' + a;
      if (vistos[k]) return;
      vistos[k] = true;
      colegas.push({ de: a, para: b, tipo: r.tipo });
    });
    return { ids: ids, porId: porId, pai: pai, filhos: filhos, raizes: raizes, sem: sem, posicionado: posicionado, colegas: colegas, forcados: forcados };
  }

  function arvore(dados) {
    var e = estrutura(dados);
    function no(id) { return { id: id, filhos: e.filhos[id].map(no) }; }
    return { raizes: e.raizes.map(no), semPosicao: e.sem.slice() };
  }

  function descendentes(e, id) {
    var out = [], fila = (e.filhos[id] || []).slice(), vistos = {};
    while (fila.length) {
      var x = fila.shift();
      if (vistos[x]) continue;
      vistos[x] = true; out.push(x);
      fila.push.apply(fila, e.filhos[x] || []);
    }
    return out;
  }

  /* ------------------------------------------------------------------ layout (puro) */

  // Árvore de cima para baixo. Cada subárvore ocupa uma faixa horizontal própria (sem sobreposição); o líder fica
  // centralizado sobre o primeiro e o último liderado. Quem lidera mais de `empilharAcima` pessoas que não lideram
  // ninguém tem esses liderados em duas colunas, dos dois lados de um fio vertical (formato compacto de organograma).
  function layout(arv, opcoes) {
    var o = Object.assign({}, PADRAO, opcoes || {});
    var W = o.largura, H = o.altura, GX = o.espacoX, GY = o.espacoY;
    var raizes = Array.isArray(arv) ? arv : lista(arv && arv.raizes);
    var vistos = {};
    // Copia sem repetir ids (um id repetido = ciclo/dado inválido: a segunda ocorrência é ignorada).
    function limpar(no) {
      if (!no || no.id == null || vistos[s(no.id)]) return null;
      vistos[s(no.id)] = true;
      return { id: s(no.id), filhos: lista(no.filhos).map(limpar).filter(Boolean) };
    }
    var rs = raizes.map(limpar).filter(Boolean);
    function medir(no) {
      no.filhos.forEach(medir);
      var n = no.filhos.length;
      no.pilha = n > o.empilharAcima && no.filhos.every(function (f) { return !f.filhos.length; });
      if (!n) no.larg = W;
      else if (no.pilha) no.larg = 2 * W + GX;
      else no.larg = Math.max(W, no.filhos.reduce(function (t, f) { return t + f.larg; }, 0) + GX * (n - 1));
    }
    var nos = [], arestas = [], altura = 0;
    function por(no, x0, y, nivel, pai) {
      var item = { id: no.id, x: 0, y: y, w: W, h: H, nivel: nivel, pai: pai };
      nos.push(item);
      altura = Math.max(altura, y + H);
      var n = no.filhos.length;
      if (!n) { item.x = x0 + (no.larg - W) / 2; return item; }
      if (no.pilha) {
        var cx = x0 + no.larg / 2;
        item.x = cx - W / 2;
        no.filhos.forEach(function (f, i) {
          var lado = i % 2, linha = Math.floor(i / 2);
          var fy = y + H + GY * 0.6 + linha * (H + o.espacoPilha);
          var fx = lado ? cx + GX / 2 : cx - GX / 2 - W;
          var fi = { id: f.id, x: fx, y: fy, w: W, h: H, nivel: nivel + 1, pai: no.id };
          nos.push(fi);
          altura = Math.max(altura, fy + H);
          arestas.push({ de: no.id, para: f.id, pontos: [[cx, y + H], [cx, fy + H / 2], [lado ? fx : fx + W, fy + H / 2]] });
        });
        return item;
      }
      var total = no.filhos.reduce(function (t, f) { return t + f.larg; }, 0) + GX * (n - 1);
      var cursor = x0 + (no.larg - total) / 2, fy2 = y + H + GY, criados = [];
      no.filhos.forEach(function (f) { criados.push(por(f, cursor, fy2, nivel + 1, no.id)); cursor += f.larg + GX; });
      var pcx = (criados[0].x + criados[n - 1].x + W) / 2;
      item.x = pcx - W / 2;
      var meio = y + H + GY / 2;
      criados.forEach(function (c) {
        var ccx = c.x + W / 2;
        arestas.push({ de: no.id, para: c.id, pontos: Math.abs(ccx - pcx) < 0.5 ? [[pcx, y + H], [pcx, fy2]] : [[pcx, y + H], [pcx, meio], [ccx, meio], [ccx, fy2]] });
      });
      return item;
    }
    var x = 0;
    rs.forEach(function (r, i) {
      medir(r);
      if (i) x += o.espacoRaizes;
      por(r, x, 0, 0, null);
      x += r.larg;
    });
    return { nos: nos, arestas: arestas, largura: x, altura: altura };
  }

  // Caminho SVG de uma linha em ângulo reto com cantos levemente arredondados.
  function caminho(pontos, raio) {
    var p = [];
    pontos.forEach(function (q) { var u = p[p.length - 1]; if (!u || u[0] !== q[0] || u[1] !== q[1]) p.push(q); });
    if (!p.length) return '';
    var r = raio == null ? 8 : raio;
    var f = function (n) { return Math.round(n * 10) / 10; };
    var d = 'M' + f(p[0][0]) + ' ' + f(p[0][1]);
    for (var i = 1; i < p.length - 1; i++) {
      var a = p[i - 1], b = p[i], c = p[i + 1];
      var l1 = Math.hypot(b[0] - a[0], b[1] - a[1]), l2 = Math.hypot(c[0] - b[0], c[1] - b[1]);
      var rr = Math.min(r, l1 / 2, l2 / 2);
      var p1 = [b[0] - (b[0] - a[0]) / l1 * rr, b[1] - (b[1] - a[1]) / l1 * rr];
      var p2 = [b[0] + (c[0] - b[0]) / l2 * rr, b[1] + (c[1] - b[1]) / l2 * rr];
      d += ' L' + f(p1[0]) + ' ' + f(p1[1]) + ' Q' + f(b[0]) + ' ' + f(b[1]) + ' ' + f(p2[0]) + ' ' + f(p2[1]);
    }
    var z = p[p.length - 1];
    return d + ' L' + f(z[0]) + ' ' + f(z[1]);
  }

  // Ligação de colegas: curva tracejada de lado a lado dos cartões.
  function caminhoColega(a, b) {
    var esq = a.x <= b.x ? a : b, dir = esq === a ? b : a;
    var sx, sy, ex, ey;
    if (dir.x >= esq.x + esq.w) { sx = esq.x + esq.w; sy = esq.y + esq.h / 2; ex = dir.x; ey = dir.y + dir.h / 2; }
    else { sx = esq.x + esq.w / 2; sy = esq.y + esq.h; ex = dir.x + dir.w / 2; ey = dir.y; if (ey < sy) { sy = esq.y; ey = dir.y + dir.h; } }
    var dx = (ex - sx) / 2;
    var f = function (n) { return Math.round(n * 10) / 10; };
    return 'M' + f(sx) + ' ' + f(sy) + ' C' + f(sx + dx) + ' ' + f(sy) + ' ' + f(ex - dx) + ' ' + f(ey) + ' ' + f(ex) + ' ' + f(ey);
  }

  /* ------------------------------------------------------------------ mover (pura) */

  function descrever(e, id) {
    if (e.pai[id] != null) return { tipo: 'lider', id: e.pai[id] };
    if (e.posicionado[id]) return { tipo: 'topo' };
    return { tipo: 'sem' };
  }

  function mover(dados, id, destino) {
    var d = dados || {};
    id = s(id);
    var e = estrutura(d);
    var rels = lista(d.relacoes).filter(Boolean).map(function (r) { return { de: s(r.de), para: s(r.para), tipo: r.tipo }; });
    var base = { relacoes: rels, topoIds: e.raizes.slice(), semPosicaoIds: Object.keys(e.forcados), erro: '', mudou: false };
    var nome = function (x) { return (e.porId[x] && s(e.porId[x].nome)) || 'esta pessoa'; };
    if (!e.porId[id]) return Object.assign(base, { erro: 'Pessoa não encontrada.' });
    if (!destino || ['lider', 'topo', 'sem'].indexOf(destino.tipo) === -1) return Object.assign(base, { erro: 'Destino inválido.' });
    var atual = descrever(e, id);
    if (destino.tipo === 'lider') {
      var alvo = s(destino.id);
      if (!e.porId[alvo]) return Object.assign(base, { erro: 'Pessoa não encontrada.' });
      if (alvo === id) return base;
      if (descendentes(e, id).indexOf(alvo) !== -1) {
        return Object.assign(base, { erro: 'Não dá para colocar ' + nome(id) + ' abaixo de ' + nome(alvo) + ': ' + nome(alvo) + ' faz parte da equipe liderada por ' + nome(id) + '.' });
      }
      if (atual.tipo === 'lider' && atual.id === alvo) return base;
    } else if (destino.tipo === atual.tipo) return base;

    var forcados = Object.keys(e.forcados).filter(function (x) { return x !== id; });
    if (destino.tipo === 'lider') {
      var a = s(destino.id);
      forcados = forcados.filter(function (x) { return x !== a; });
      rels = rels.filter(function (r) {
        if (r.tipo === 'lidera' && r.para === id) return false;
        if (r.tipo !== 'lidera' && ((r.de === id && r.para === a) || (r.de === a && r.para === id))) return false;
        return true;
      });
      rels.push({ de: a, para: id, tipo: 'lidera' });
    } else if (destino.tipo === 'topo') {
      rels = rels.filter(function (r) { return !(r.tipo === 'lidera' && r.para === id); });
    } else {
      rels = rels.filter(function (r) { return !(r.tipo === 'lidera' && (r.para === id || r.de === id)); });
    }
    // Ninguém que estava no organograma sai sem querer: quem ficaria solto (ex.: o líder sem mais liderados,
    // os liderados de quem foi tirado) vai para o Topo. Só a pessoa movida para "Sem posição" sai.
    var topo = e.raizes.filter(function (x) { return !(x === id && destino.tipo !== 'topo'); });
    if (destino.tipo === 'topo') topo.push(id);
    if (destino.tipo === 'sem') e.filhos[id].forEach(function (x) { topo.push(x); });
    var provisorio = estrutura({ pessoas: d.pessoas, relacoes: rels, topoIds: topo, semPosicaoIds: forcados });
    e.ids.forEach(function (x) {
      if (x === id && destino.tipo === 'sem') return;
      if (e.posicionado[x] && !provisorio.posicionado[x] && provisorio.pai[x] == null) topo.push(x);
    });
    var final = estrutura({ pessoas: d.pessoas, relacoes: rels, topoIds: topo, semPosicaoIds: forcados });
    return { relacoes: rels, topoIds: final.raizes.slice(), semPosicaoIds: forcados, erro: '', mudou: true, de: atual };
  }

  function textoMudanca(e, id, destino) {
    var n = e.porId[id] ? s(e.porId[id].nome) : '';
    if (destino.tipo === 'lider') return n + ' agora é liderado(a) por ' + (e.porId[destino.id] ? s(e.porId[destino.id].nome) : '') + '.';
    if (destino.tipo === 'topo') return n + ' está no topo, sem líder.';
    return n + ' saiu do organograma.';
  }

  /* ------------------------------------------------------------------ HTML dos cartões */

  function avatarHtml(p) {
    var l = letraDisc(p.semTeste ? '' : p.codigo);
    var anel = l ? ' orgx-avatar--' + l : '';
    if (fotoValida(p.foto)) return '<span class="orgx-avatar orgx-avatar--foto' + anel + '"><img src="' + p.foto + '" alt="" width="40" height="40" draggable="false"></span>';
    return '<span class="orgx-avatar' + anel + '" aria-hidden="true">' + esc(iniciais(p.nome)) + '</span>';
  }

  function rotuloCartao(p) {
    return [s(p.nome), s(p.cargo), textoPerfil(p)].filter(Boolean).join(', ');
  }

  function cartaoHtml(p, op) {
    var o = op || {};
    var id = s(p.id);
    var l = letraDisc(p.semTeste ? '' : p.codigo);
    var perfil = textoPerfil(p);
    var estilo = o.pos ? ' style="left:' + o.pos.x + 'px;top:' + o.pos.y + 'px;width:' + o.pos.w + 'px;height:' + o.pos.h + 'px"' : '';
    var attrs = o.estatico ? '' : ' tabindex="0" aria-label="' + esc(rotuloCartao(p)) + '"' + (o.alvo ? ' data-org-alvo="pessoa"' : '');
    return '<div class="orgx-cartao' + (o.pos ? ' orgx-cartao--no' : '') + (l ? '' : ' orgx-cartao--sem-teste') + '" data-org-id="' + esc(id) + '"' + attrs + estilo + '>' +
      avatarHtml(p) +
      '<span class="orgx-texto">' +
        '<span class="orgx-nome" title="' + esc(p.nome) + '">' + esc(p.nome) + '</span>' +
        (p.cargo ? '<span class="orgx-cargo" title="' + esc(p.cargo) + '">' + esc(p.cargo) + '</span>' : '<span class="orgx-cargo orgx-cargo--vazio">Sem cargo</span>') +
        '<span class="orgx-perfil" title="' + esc(perfil) + '">' + esc(perfil) + '</span>' +
      '</span>' +
      '<span class="orgx-selo' + (l ? ' disc-' + l : '') + '" aria-hidden="true"' + (l ? ' title="' + NOMES_DISC[l] + '"' : '') + '>' + (l || '–') + '</span>' +
      (o.mover ? '<button type="button" class="orgx-mover" data-acao="mover" aria-label="Mover ' + esc(p.nome) + ' para…" title="Mover para…">' +
        '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>' : '') +
    '</div>';
  }

  function legendaHtml() {
    return '<span class="orgx-legenda" aria-label="Legenda DISC">' + ['D', 'I', 'S', 'C'].map(function (l) {
      return '<span class="orgx-legenda__item"><span class="orgx-legenda__letra disc-' + l + '" aria-hidden="true">' + l + '</span>' + NOMES_DISC[l] + '</span>';
    }).join('') + '</span>';
  }

  // Miolo do desenho (linhas SVG + cartões posicionados), em coordenadas do layout.
  function desenhoHtml(e, lay, op) {
    var o = op || {};
    var pos = {};
    lay.nos.forEach(function (n) { pos[n.id] = n; });
    var linhas = lay.arestas.map(function (a) {
      return '<path class="orgx-linha" data-de="' + esc(a.de) + '" data-para="' + esc(a.para) + '" d="' + caminho(a.pontos) + '"/>';
    }).join('');
    var colegas = e.colegas.filter(function (c) { return pos[c.de] && pos[c.para]; }).map(function (c) {
      return '<path class="orgx-colega orgx-colega--' + c.tipo + '" d="' + caminhoColega(pos[c.de], pos[c.para]) + '"/>';
    }).join('');
    var svg = '<svg class="orgx-linhas" width="' + lay.largura + '" height="' + lay.altura + '" viewBox="0 0 ' + Math.max(1, lay.largura) + ' ' + Math.max(1, lay.altura) + '" aria-hidden="true" focusable="false">' +
      '<g class="orgx-linhas__colegas"' + (o.colegas ? '' : ' style="display:none"') + '>' + colegas + '</g>' +
      '<g class="orgx-linhas__lideranca">' + linhas + '</g></svg>';
    var cartoes = lay.nos.map(function (n) {
      return cartaoHtml(e.porId[n.id], { pos: n, estatico: o.estatico, alvo: o.editar, mover: o.editar });
    }).join('');
    return svg + cartoes;
  }

  function layoutDe(e) {
    function no(id) { return { id: id, filhos: e.filhos[id].map(no) }; }
    return layout({ raizes: e.raizes.map(no) });
  }

  // HTML/SVG estático para leitura e impressão (A4 retrato: ~718px úteis). Precisa de assets/organograma.css.
  function paraHtml(dados, opcoes) {
    var o = opcoes || {};
    var e = estrutura(dados);
    var lay = layoutDe(e);
    var maxL = Number(o.larguraMax) > 0 ? Number(o.larguraMax) : 718;
    var esc2 = lay.largura ? Math.min(1, maxL / lay.largura) : 1;
    esc2 = Math.floor(esc2 * 1000) / 1000;
    var rot = esc(o.rotulo || 'Organograma');
    if (!e.raizes.length) {
      return '<div class="orgx-impresso orgx-impresso--vazio" role="group" aria-label="' + rot + '"><p class="orgx-nota">Ninguém posicionado no organograma.</p></div>';
    }
    var nomesSem = e.sem.map(function (x) { return esc(e.porId[x].nome); });
    return '<figure class="orgx-impresso" role="group" aria-label="' + rot + '">' +
      '<div class="orgx-impresso__area" style="width:' + Math.ceil(lay.largura * esc2) + 'px;height:' + Math.ceil(lay.altura * esc2) + 'px">' +
        '<div class="orgx-mundo" style="width:' + lay.largura + 'px;height:' + lay.altura + 'px;transform:scale(' + esc2 + ')">' +
          desenhoHtml(e, lay, { estatico: true, colegas: !!o.mostrarColegas }) +
        '</div></div>' +
      '<figcaption class="orgx-impresso__rodape">' + legendaHtml() +
        (nomesSem.length && o.semPosicao !== false ? '<span class="orgx-nota">Sem posição: ' + nomesSem.join(', ') + '</span>' : '') +
      '</figcaption></figure>';
  }

  /* ------------------------------------------------------------------ componente (navegador) */

  function montar(container, dadosIniciais) {
    if (!container || !container.ownerDocument) throw new Error('DISC_ORGANOGRAMA.montar: container inválido.');
    var doc = container.ownerDocument, win = doc.defaultView || root;
    var semMovimento = function () { try { return win.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (x) { return false; } };
    var st = { dados: null, e: null, lay: null, escala: 1, ajustar: true, colegas: false, arrasto: null, pan: null, menu: null, avisoTimer: null, destruido: false };
    var el = doc.createElement('div');
    el.className = 'orgx';
    container.innerHTML = '';
    container.appendChild(el);

    function q(sel) { return el.querySelector(sel); }
    function editar() { return st.dados.modo === 'editar'; }

    function normalizar(d) {
      var x = Object.assign({}, d || {});
      x.modo = x.modo === 'editar' ? 'editar' : 'ler';
      x.pessoas = lista(x.pessoas).filter(function (p) { return p && p.id != null && s(p.id) !== ''; });
      x.relacoes = lista(x.relacoes);
      x.topoIds = lista(x.topoIds).map(s);
      x.semPosicaoIds = lista(x.semPosicaoIds).map(s);
      return x;
    }

    function casca() {
      var ed = editar();
      el.className = 'orgx orgx--' + (ed ? 'editar' : 'ler');
      el.innerHTML =
        (ed ? '<aside class="orgx-sem" data-org-alvo="sem" aria-labelledby="orgx-sem-tit-' + uid + '">' +
          '<div class="orgx-sem__cab"><span class="orgx-sem__titulo" id="orgx-sem-tit-' + uid + '">Sem posição</span><span class="orgx-sem__n tabular" data-org-sem-n></span></div>' +
          '<p class="orgx-sem__dica">Arraste para um cartão (vira liderado) ou para o Topo. Solte aqui para tirar do organograma.</p>' +
          '<input class="entrada orgx-sem__busca" type="text" autocomplete="off" placeholder="Buscar" aria-label="Buscar em Sem posição" data-org-sem-busca hidden>' +
          '<div class="orgx-sem__lista" data-org-sem-lista></div></aside>' : '') +
        '<section class="orgx-area" aria-label="Organograma">' +
          '<div class="orgx-barra">' +
            legendaHtml() +
            '<span class="orgx-barra__acoes">' +
              (ed ? '' : '<span class="orgx-nota" data-org-nota-sem></span>') +
              '<button type="button" class="botao botao--claro orgx-botao" data-acao="colegas" aria-pressed="false">Mostrar colegas</button>' +
              '<span class="orgx-zoom" role="group" aria-label="Zoom">' +
                '<button type="button" class="orgx-zoom__b" data-acao="zoom-menos" aria-label="Diminuir">−</button>' +
                '<span class="orgx-zoom__valor tabular" data-org-zoom aria-live="polite">100%</span>' +
                '<button type="button" class="orgx-zoom__b" data-acao="zoom-mais" aria-label="Aumentar">+</button>' +
              '</span>' +
              '<button type="button" class="botao botao--claro orgx-botao" data-acao="ajustar" aria-pressed="true">Ajustar à tela</button>' +
            '</span>' +
          '</div>' +
          (ed ? '<div class="orgx-topo" data-org-alvo="topo"><span class="orgx-topo__seta" aria-hidden="true">' +
            '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 19V5M5 12l7-7 7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>' +
            '<span><b class="seminegrito">Topo</b> <span class="orgx-topo__dica">solte aqui quem não tem líder</span></span></div>' : '') +
          '<div class="orgx-moldura">' +
            '<div class="orgx-quadro" data-org-quadro>' +
              '<div class="orgx-tela" data-org-tela><div class="orgx-mundo" data-org-mundo></div></div>' +
              '<p class="orgx-vazio" data-org-vazio hidden></p>' +
            '</div>' +
            '<p class="orgx-aviso" role="alert" data-org-aviso hidden></p>' +
          '</div>' +
          '<p class="visualmente-oculto" aria-live="polite" data-org-vivo></p>' +
        '</section>';
    }
    var uid = Math.random().toString(36).slice(2, 8);

    function conteudo() {
      st.e = estrutura(st.dados);
      st.lay = layoutDe(st.e);
      var ed = editar();
      var mundo = q('[data-org-mundo]');
      mundo.innerHTML = desenhoHtml(st.e, st.lay, { editar: ed, colegas: st.colegas });
      mundo.style.width = st.lay.largura + 'px';
      mundo.style.height = st.lay.altura + 'px';
      var vazio = q('[data-org-vazio]');
      vazio.hidden = st.e.raizes.length > 0;
      vazio.textContent = ed ? 'Ninguém no organograma ainda. Arraste alguém da coluna "Sem posição" para o Topo (ou para cá) e depois os liderados sobre o cartão do líder.' : 'Ninguém posicionado no organograma.';
      var quadro = q('[data-org-quadro]');
      if (ed && !st.e.raizes.length) quadro.setAttribute('data-org-alvo', 'topo'); else quadro.removeAttribute('data-org-alvo');
      if (ed) {
        q('[data-org-sem-n]').textContent = String(st.e.sem.length);
        q('[data-org-sem-lista]').innerHTML = st.e.sem.length ?
          '<ul class="orgx-sem__itens">' + st.e.sem.map(function (x) { return '<li>' + cartaoHtml(st.e.porId[x], { mover: true }) + '</li>'; }).join('') + '</ul>' :
          '<p class="orgx-sem__vazio">Todos estão no organograma.</p>';
        var busca = q('[data-org-sem-busca]');
        busca.hidden = st.e.sem.length <= 6 && !busca.value;
        filtrarSem();
      } else {
        var nota = q('[data-org-nota-sem]');
        if (nota) nota.textContent = st.e.sem.length ? st.e.sem.length + (st.e.sem.length === 1 ? ' pessoa sem posição' : ' pessoas sem posição') : '';
      }
      var bc = q('[data-acao="colegas"]');
      var temColegas = st.e.colegas.some(function (c) { return st.e.posicionado[c.de] && st.e.posicionado[c.para]; });
      bc.disabled = !temColegas;
      bc.title = temColegas ? 'Linhas tracejadas entre quem trabalha junto (direto ou indireto)' : 'Nenhuma ligação de colegas registrada entre pessoas do organograma';
      escala();
    }

    function filtrarSem() {
      var busca = q('[data-org-sem-busca]');
      if (!busca) return;
      var t = busca.value.trim().toLowerCase();
      Array.prototype.forEach.call(el.querySelectorAll('.orgx-sem__itens > li'), function (li) {
        var c = li.querySelector('[data-org-id]'), p = c && st.e.porId[c.getAttribute('data-org-id')];
        li.hidden = !!t && !!p && (s(p.nome) + ' ' + s(p.cargo)).toLowerCase().indexOf(t) === -1;
      });
    }

    function escala() {
      var quadro = q('[data-org-quadro]'), tela = q('[data-org-tela]'), mundo = q('[data-org-mundo]');
      if (!quadro) return;
      var W = quadro.clientWidth, H = quadro.clientHeight, L = st.lay.largura, A = st.lay.altura;
      if (st.ajustar && W > 0 && H > 0 && L > 0) {
        // Ajusta pela largura (nomes legíveis): não encolhe abaixo de AJUSTE_MIN; o que passar rola dentro do quadro.
        st.escala = Math.max(AJUSTE_MIN, Math.min(AJUSTE_MAX, (W - 2 * MARGEM) / L));
      }
      var e = st.escala;
      var tw = Math.max(W, Math.ceil(L * e + 2 * MARGEM)), th = Math.max(H, Math.ceil(A * e + 2 * MARGEM));
      tela.style.width = tw + 'px';
      tela.style.height = th + 'px';
      mundo.style.left = Math.max(MARGEM, Math.round((tw - L * e) / 2)) + 'px';
      mundo.style.top = MARGEM + 'px';
      mundo.style.transform = 'scale(' + (Math.round(e * 1000) / 1000) + ')';
      q('[data-org-zoom]').textContent = Math.round(e * 100) + '%';
      var ba = q('[data-acao="ajustar"]');
      ba.setAttribute('aria-pressed', st.ajustar ? 'true' : 'false');
      q('[data-acao="zoom-menos"]').disabled = e <= ESCALA_MIN + 0.001;
      q('[data-acao="zoom-mais"]').disabled = e >= ESCALA_MAX - 0.001;
    }

    function zoom(nova) {
      var quadro = q('[data-org-quadro]');
      var antes = st.escala;
      var cx = (quadro.scrollLeft + quadro.clientWidth / 2), cy = (quadro.scrollTop + quadro.clientHeight / 2);
      st.ajustar = false;
      st.escala = Math.max(ESCALA_MIN, Math.min(ESCALA_MAX, Math.round(nova * 100) / 100));
      escala();
      var k = st.escala / antes;
      quadro.scrollLeft = Math.max(0, cx * k - quadro.clientWidth / 2);
      quadro.scrollTop = Math.max(0, cy * k - quadro.clientHeight / 2);
    }

    function aviso(msg) {
      var a = q('[data-org-aviso]');
      if (!a) return;
      clearTimeout(st.avisoTimer);
      a.textContent = msg || '';
      a.hidden = !msg;
      if (msg) st.avisoTimer = setTimeout(function () { a.hidden = true; }, 6000);
    }
    function anunciar(msg) { var v = q('[data-org-vivo]'); if (v) v.textContent = msg; }

    // Animação FLIP: cada cartão sai de onde estava e desliza até o novo lugar.
    function posicoes() {
      var m = {};
      Array.prototype.forEach.call(el.querySelectorAll('.orgx-cartao[data-org-id]'), function (c) { m[c.getAttribute('data-org-id')] = c.getBoundingClientRect(); });
      return m;
    }
    function animar(antes) {
      if (semMovimento()) return;
      var linhas = q('.orgx-linhas');
      if (linhas && linhas.animate) linhas.animate([{ opacity: 0 }, { opacity: 0 }, { opacity: 1 }], { duration: 420, easing: 'ease-out' });
      Array.prototype.forEach.call(el.querySelectorAll('.orgx-cartao[data-org-id]'), function (c) {
        var a = antes[c.getAttribute('data-org-id')];
        if (!a || !c.animate) return;
        var b = c.getBoundingClientRect();
        var k = c.classList.contains('orgx-cartao--no') ? st.escala : 1;
        var dx = (a.left - b.left) / k, dy = (a.top - b.top) / k;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
        c.animate([{ transform: 'translate(' + dx + 'px,' + dy + 'px)' }, { transform: 'none' }], { duration: 320, easing: 'cubic-bezier(.2,.7,.2,1)' });
      });
    }

    function aplicar(id, destino, focar) {
      var r = mover(st.dados, id, destino);
      if (r.erro) { aviso(r.erro); anunciar(r.erro); return false; }
      if (!r.mudou) return false;
      aviso('');
      var texto = textoMudanca(st.e, id, destino);
      var antes = posicoes();
      st.dados = Object.assign({}, st.dados, { relacoes: r.relacoes, topoIds: r.topoIds, semPosicaoIds: r.semPosicaoIds });
      conteudo();
      animar(antes);
      anunciar(texto);
      if (focar) { var c = el.querySelector('.orgx-cartao[data-org-id="' + cssEsc(id) + '"]'); if (c) c.focus(); }
      if (typeof st.dados.aoMudar === 'function') {
        st.dados.aoMudar(r.relacoes.slice(), { id: id, nome: s(st.e.porId[id].nome), de: r.de, para: destino, topoIds: r.topoIds.slice(), semPosicaoIds: r.semPosicaoIds.slice(), texto: texto });
      }
      return true;
    }
    function cssEsc(v) { return s(v).replace(/["\\]/g, '\\$&'); }

    /* ---------- arrastar e soltar (mouse) ---------- */

    function alvoEm(x, y) {
      var t = doc.elementFromPoint(x, y);
      var a = t && t.closest ? t.closest('[data-org-alvo]') : null;
      return a && el.contains(a) ? a : null;
    }
    function destinoDe(alvo) {
      if (!alvo) return null;
      var tipo = alvo.getAttribute('data-org-alvo');
      if (tipo === 'pessoa') return { tipo: 'lider', id: alvo.getAttribute('data-org-id') };
      return { tipo: tipo };
    }
    function dicaDe(a, destino) {
      if (!destino) return 'Solte num cartão, no Topo ou na coluna';
      if (destino.tipo === 'lider') {
        if (destino.id === a.id) return 'Mesma posição';
        if (a.proibidos[destino.id]) return 'Não pode: está na equipe de ' + s(st.e.porId[a.id].nome);
        return 'Liderado(a) por ' + s(st.e.porId[destino.id].nome);
      }
      if (destino.tipo === 'topo') return 'Topo, sem líder';
      return 'Sem posição';
    }

    function aoPressionar(ev) {
      if (st.destruido || ev.button !== 0) return;
      var cartao = ev.target.closest ? ev.target.closest('.orgx-cartao[data-org-id]') : null;
      if (cartao && el.contains(cartao) && !ev.target.closest('button')) {
        st.arrasto = { id: cartao.getAttribute('data-org-id'), cartao: cartao, x0: ev.clientX, y0: ev.clientY, iniciado: false, x: ev.clientX, y: ev.clientY };
        return;
      }
      var quadro = q('[data-org-quadro]');
      if (quadro && quadro.contains(ev.target) && !ev.target.closest('button, a, input') && ev.pointerType === 'mouse') {
        st.pan = { x0: ev.clientX, y0: ev.clientY, sl: quadro.scrollLeft, st: quadro.scrollTop, movido: false };
        ev.preventDefault();
      }
    }

    function iniciarArrasto(a) {
      a.iniciado = true;
      var r = a.cartao.getBoundingClientRect();
      var k = a.cartao.classList.contains('orgx-cartao--no') ? st.escala : 1;
      var w = r.width / k, h = r.height / k;
      a.dx = (a.x0 - r.left) / k; a.dy = (a.y0 - r.top) / k;
      var g = a.cartao.cloneNode(true);
      g.removeAttribute('data-org-alvo'); g.removeAttribute('tabindex'); g.removeAttribute('aria-label');
      g.setAttribute('aria-hidden', 'true');
      g.classList.remove('orgx-cartao--no');
      g.classList.add('orgx-fantasma');
      g.style.left = '0px'; g.style.top = '0px'; g.style.width = w + 'px'; g.style.height = h + 'px';
      var dica = doc.createElement('span');
      dica.className = 'orgx-fantasma__dica';
      g.appendChild(dica);
      doc.body.appendChild(g);
      a.fantasma = g; a.dica = dica;
      a.proibidos = {};
      descendentes(st.e, a.id).forEach(function (x) { a.proibidos[x] = true; });
      a.cartao.classList.add('orgx-cartao--origem');
      el.classList.add('orgx--arrastando');
      doc.body.classList.add('orgx-corpo--arrastando');
      fecharMenu();
      a.raf = win.requestAnimationFrame(rolarBordas);
    }

    function rolarBordas() {
      var a = st.arrasto;
      if (!a || !a.iniciado) return;
      var quadro = q('[data-org-quadro]');
      if (quadro) {
        var r = quadro.getBoundingClientRect(), z = 48, v = 14;
        if (a.x > r.left && a.x < r.right && a.y > r.top - z && a.y < r.bottom + z) {
          if (a.x < r.left + z) quadro.scrollLeft -= v; else if (a.x > r.right - z) quadro.scrollLeft += v;
          if (a.y < r.top + z && a.y > r.top) quadro.scrollTop -= v; else if (a.y > r.bottom - z && a.y < r.bottom) quadro.scrollTop += v;
        }
      }
      a.raf = win.requestAnimationFrame(rolarBordas);
    }

    function marcarAlvo(a, alvo) {
      if (a.alvo === alvo) return;
      if (a.alvo) a.alvo.classList.remove('orgx-alvo', 'orgx-alvo--proibido');
      a.alvo = alvo;
      var d = destinoDe(alvo);
      if (alvo) {
        var proibido = d && d.tipo === 'lider' && a.proibidos[d.id];
        var mesmo = d && d.tipo === 'lider' && d.id === a.id;
        if (!mesmo) alvo.classList.add(proibido ? 'orgx-alvo--proibido' : 'orgx-alvo');
      }
      a.dica.textContent = dicaDe(a, d);
      a.fantasma.classList.toggle('orgx-fantasma--proibido', !!(d && d.tipo === 'lider' && a.proibidos[d.id]));
    }

    function aoMover(ev) {
      var a = st.arrasto;
      if (a) {
        a.x = ev.clientX; a.y = ev.clientY;
        if (!a.iniciado) {
          if (Math.abs(ev.clientX - a.x0) + Math.abs(ev.clientY - a.y0) < 6) return;
          a.movido = true;
          if (!editar()) return;
          iniciarArrasto(a);
        }
        ev.preventDefault();
        // O fantasma fica abaixo e à direita do ponteiro: o cartão-alvo continua visível (com o realce).
        a.fantasma.style.transform = 'translate(' + (ev.clientX + 16) + 'px,' + (ev.clientY + 14) + 'px) scale(.82)';
        marcarAlvo(a, alvoEm(ev.clientX, ev.clientY));
        return;
      }
      if (st.pan) {
        var quadro = q('[data-org-quadro]');
        var dx = ev.clientX - st.pan.x0, dy = ev.clientY - st.pan.y0;
        if (!st.pan.movido && Math.abs(dx) + Math.abs(dy) < 4) return;
        st.pan.movido = true;
        quadro.classList.add('orgx-quadro--movendo');
        quadro.scrollLeft = st.pan.sl - dx;
        quadro.scrollTop = st.pan.st - dy;
      }
    }

    function encerrarArrasto(soltar) {
      var a = st.arrasto;
      st.arrasto = null;
      if (!a) return;
      if (!a.iniciado) {
        if (soltar && !a.movido && typeof st.dados.aoAbrirPessoa === 'function') st.dados.aoAbrirPessoa(a.id);
        return;
      }
      win.cancelAnimationFrame(a.raf);
      if (a.alvo) a.alvo.classList.remove('orgx-alvo', 'orgx-alvo--proibido');
      if (a.fantasma && a.fantasma.parentNode) a.fantasma.parentNode.removeChild(a.fantasma);
      a.cartao.classList.remove('orgx-cartao--origem');
      el.classList.remove('orgx--arrastando');
      doc.body.classList.remove('orgx-corpo--arrastando');
      if (!soltar) return;
      var d = destinoDe(a.alvo);
      if (d) aplicar(a.id, d, false);
    }

    function aoSoltar(ev) {
      if (st.arrasto) {
        if (st.arrasto.iniciado) { st.arrasto.x = ev.clientX; st.arrasto.y = ev.clientY; marcarAlvo(st.arrasto, alvoEm(ev.clientX, ev.clientY)); }
        encerrarArrasto(true);
      }
      if (st.pan) { var quadro = q('[data-org-quadro]'); if (quadro) quadro.classList.remove('orgx-quadro--movendo'); st.pan = null; }
    }

    function aoTecla(ev) {
      if (ev.key === 'Escape' && st.arrasto && st.arrasto.iniciado) { encerrarArrasto(false); ev.preventDefault(); return; }
      var cartao = ev.target.closest ? ev.target.closest('.orgx-cartao[data-org-id]') : null;
      if (cartao && ev.target === cartao && el.contains(cartao) && (ev.key === 'Enter' || ev.key === ' ')) {
        if (typeof st.dados.aoAbrirPessoa === 'function') { ev.preventDefault(); st.dados.aoAbrirPessoa(cartao.getAttribute('data-org-id')); }
        else if (editar() && ev.key === 'Enter') { var b = cartao.querySelector('[data-acao="mover"]'); if (b) { ev.preventDefault(); abrirMenu(cartao.getAttribute('data-org-id'), b); } }
      }
    }

    function aoClicar(ev) {
      var b = ev.target.closest ? ev.target.closest('[data-acao]') : null;
      if (!b || !el.contains(b) || b.disabled) return;
      var acao = b.getAttribute('data-acao');
      if (acao === 'ajustar') { st.ajustar = true; escala(); var qd = q('[data-org-quadro]'); qd.scrollLeft = 0; qd.scrollTop = 0; }
      else if (acao === 'zoom-mais') zoom(st.escala + PASSO);
      else if (acao === 'zoom-menos') zoom(st.escala - PASSO);
      else if (acao === 'colegas') {
        st.colegas = !st.colegas;
        b.setAttribute('aria-pressed', st.colegas ? 'true' : 'false');
        b.textContent = st.colegas ? 'Esconder colegas' : 'Mostrar colegas';
        var g = q('.orgx-linhas__colegas');
        if (g) g.style.display = st.colegas ? '' : 'none';
      } else if (acao === 'mover') {
        var c = b.closest('.orgx-cartao[data-org-id]');
        if (c) abrirMenu(c.getAttribute('data-org-id'), b);
      }
    }

    /* ---------- "Mover para…" (menu com busca, teclado) ---------- */

    function opcoesMenu(id) {
      var e = st.e, atual = descrever(e, id), proib = {};
      descendentes(e, id).forEach(function (x) { proib[x] = true; });
      var nome = s(e.porId[id].nome);
      var out = [
        { destino: { tipo: 'topo' }, titulo: 'Topo', sub: 'sem líder', desab: atual.tipo === 'topo', motivo: 'já está no topo' },
        { destino: { tipo: 'sem' }, titulo: 'Sem posição', sub: 'tirar do organograma', desab: atual.tipo === 'sem', motivo: 'já está fora' }
      ];
      e.ids.forEach(function (x) {
        if (x === id || !e.posicionado[x]) return;
        var p = e.porId[x];
        var motivo = proib[x] ? 'está na equipe de ' + nome : (atual.tipo === 'lider' && atual.id === x ? 'líder atual' : '');
        out.push({ destino: { tipo: 'lider', id: x }, titulo: 'Abaixo de ' + s(p.nome), sub: s(p.cargo), desab: !!motivo, motivo: motivo, busca: (s(p.nome) + ' ' + s(p.cargo)).toLowerCase() });
      });
      return out;
    }

    function fecharMenu(devolverFoco) {
      var m = st.menu;
      st.menu = null;
      if (!m) return;
      doc.removeEventListener('pointerdown', m.fora, true);
      if (m.no.parentNode) m.no.parentNode.removeChild(m.no);
      if (devolverFoco && m.botao && doc.contains(m.botao)) m.botao.focus();
    }

    function abrirMenu(id, botao) {
      fecharMenu();
      var p = st.e.porId[id];
      var no = doc.createElement('div');
      no.className = 'orgx-menu vidro-janela';
      no.setAttribute('role', 'dialog');
      no.setAttribute('aria-label', 'Mover ' + s(p.nome) + ' para…');
      var lid = 'orgx-menu-l-' + uid;
      no.innerHTML = '<p class="orgx-menu__titulo">Mover <b class="seminegrito">' + esc(p.nome) + '</b> para…</p>' +
        '<input class="entrada orgx-menu__busca" type="text" autocomplete="off" placeholder="Buscar líder pelo nome" aria-label="Buscar líder pelo nome" role="combobox" aria-expanded="true" aria-controls="' + lid + '">' +
        '<ul class="orgx-menu__lista" role="listbox" id="' + lid + '" aria-label="Destinos"></ul>' +
        '<p class="orgx-menu__dica">↑ ↓ para escolher · Enter para mover · Esc para fechar</p>';
      doc.body.appendChild(no);
      var m = { id: id, no: no, botao: botao, ativo: 0, itens: [], opcoes: opcoesMenu(id) };
      st.menu = m;
      var busca = no.querySelector('input'), ul = no.querySelector('ul');
      function desenhar() {
        var t = busca.value.trim().toLowerCase();
        m.itens = m.opcoes.filter(function (o) { return !t || (o.busca ? o.busca.indexOf(t) !== -1 : o.titulo.toLowerCase().indexOf(t) !== -1); });
        var habil = m.itens.map(function (o, i) { return o.desab ? -1 : i; }).filter(function (i) { return i >= 0; });
        if (habil.indexOf(m.ativo) === -1) m.ativo = habil.length ? habil[0] : -1;
        ul.innerHTML = m.itens.length ? m.itens.map(function (o, i) {
          return '<li role="option" id="' + lid + '-' + i + '" data-i="' + i + '" class="orgx-menu__op' + (i === m.ativo ? ' orgx-menu__op--ativa' : '') + '"' +
            ' aria-selected="' + (i === m.ativo ? 'true' : 'false') + '"' + (o.desab ? ' aria-disabled="true"' : '') + '>' +
            '<span class="orgx-menu__op-tit">' + esc(o.titulo) + '</span>' +
            (o.desab || o.sub ? '<span class="orgx-menu__op-sub">' + esc(o.desab ? o.motivo : o.sub) + '</span>' : '') + '</li>';
        }).join('') : '<li class="orgx-menu__nada" role="presentation">Ninguém encontrado</li>';
        if (m.ativo >= 0) {
          busca.setAttribute('aria-activedescendant', lid + '-' + m.ativo);
          var at = ul.querySelector('[data-i="' + m.ativo + '"]');
          if (at && at.scrollIntoView) at.scrollIntoView({ block: 'nearest' });
        } else busca.removeAttribute('aria-activedescendant');
      }
      function escolher(i) {
        var o = m.itens[i];
        if (!o || o.desab) return;
        fecharMenu();
        if (!aplicar(id, o.destino, true) && botao && doc.contains(botao)) botao.focus();
      }
      function passo(dir) {
        var n = m.itens.length;
        for (var k = 1; k <= n; k++) {
          var j = (m.ativo + dir * k + n * 2) % n;
          if (!m.itens[j].desab) { m.ativo = j; break; }
        }
        desenhar();
      }
      busca.addEventListener('input', function () { m.ativo = 0; desenhar(); });
      no.addEventListener('keydown', function (ev) {
        if (ev.key === 'ArrowDown') { ev.preventDefault(); passo(1); }
        else if (ev.key === 'ArrowUp') { ev.preventDefault(); passo(-1); }
        else if (ev.key === 'Enter') { ev.preventDefault(); escolher(m.ativo); }
        else if (ev.key === 'Escape') { ev.preventDefault(); fecharMenu(true); }
        else if (ev.key === 'Tab') { ev.preventDefault(); busca.focus(); }
      });
      ul.addEventListener('click', function (ev) {
        var li = ev.target.closest('[data-i]');
        if (li) escolher(Number(li.getAttribute('data-i')));
      });
      m.fora = function (ev) { if (!no.contains(ev.target) && ev.target !== botao && !(botao && botao.contains(ev.target))) fecharMenu(); };
      doc.addEventListener('pointerdown', m.fora, true);
      desenhar();
      // Posição: abaixo do botão, sem sair da janela.
      var r = botao.getBoundingClientRect(), mw = no.offsetWidth, mh = no.offsetHeight;
      var vw = win.innerWidth, vh = win.innerHeight;
      var left = Math.max(8, Math.min(r.left - 8, vw - mw - 8));
      var top = r.bottom + 6 + mh > vh - 8 ? Math.max(8, r.top - 6 - mh) : r.bottom + 6;
      no.style.left = left + 'px';
      no.style.top = top + 'px';
      busca.focus();
    }

    /* ---------- ciclo de vida ---------- */

    var ro = null;
    function ligar() {
      el.addEventListener('pointerdown', aoPressionar);
      doc.addEventListener('pointermove', aoMover);
      doc.addEventListener('pointerup', aoSoltar);
      doc.addEventListener('pointercancel', aoCancelar);
      el.addEventListener('keydown', aoTecla);
      doc.addEventListener('keydown', aoTeclaGlobal);
      el.addEventListener('click', aoClicar);
      el.addEventListener('input', function (ev) { if (ev.target.hasAttribute('data-org-sem-busca')) filtrarSem(); });
      el.addEventListener('dragstart', function (ev) { ev.preventDefault(); });
      if (win.ResizeObserver) { ro = new win.ResizeObserver(function () { if (st.ajustar) escala(); }); ro.observe(q('[data-org-quadro]')); }
      else win.addEventListener('resize', aoRedimensionar);
    }
    function aoCancelar() { encerrarArrasto(false); st.pan = null; }
    function aoTeclaGlobal(ev) { if (ev.key === 'Escape' && st.arrasto && st.arrasto.iniciado) { encerrarArrasto(false); } }
    function aoRedimensionar() { if (st.ajustar) escala(); }
    function religarObservador() {
      if (ro) { ro.disconnect(); ro.observe(q('[data-org-quadro]')); }
    }

    st.dados = normalizar(dadosIniciais);
    casca();
    conteudo();
    ligar();

    return {
      atualizar: function (novos) {
        if (st.destruido) return;
        var modoAntes = st.dados.modo;
        encerrarArrasto(false);
        fecharMenu();
        st.dados = normalizar(Object.assign({}, st.dados, novos || {}));
        if (st.dados.modo !== modoAntes) { casca(); religarObservador(); }
        conteudo();
      },
      ajustar: function () { st.ajustar = true; escala(); },
      dados: function () { return { relacoes: st.dados.relacoes.slice(), topoIds: st.e.raizes.slice(), semPosicaoIds: Object.keys(st.e.forcados) }; },
      destruir: function () {
        if (st.destruido) return;
        encerrarArrasto(false);
        fecharMenu();
        st.destruido = true;
        doc.removeEventListener('pointermove', aoMover);
        doc.removeEventListener('pointerup', aoSoltar);
        doc.removeEventListener('pointercancel', aoCancelar);
        doc.removeEventListener('keydown', aoTeclaGlobal);
        if (ro) ro.disconnect(); else win.removeEventListener('resize', aoRedimensionar);
        clearTimeout(st.avisoTimer);
        if (el.parentNode) el.parentNode.removeChild(el);
      }
    };
  }

  return {
    CARTAO: CARTAO,
    estrutura: estrutura,
    arvore: arvore,
    layout: layout,
    mover: mover,
    paraHtml: paraHtml,
    montar: montar,
    caminho: caminho,
    fotoValida: fotoValida,
    iniciais: iniciais
  };
});
