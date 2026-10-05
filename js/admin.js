/*
 * Painel do recrutador — lista, filtros, detalhe, Guia para a Liderança, comparativo e CSV.
 * Segurança: todo dado do candidato entra no DOM via textContent / setAttribute (nunca innerHTML).
 * Modo com API (CONFIG.API_URL preenchido): login pela chave (sessionStorage) e dados no Apps Script.
 * Modo sem API: importação de códigos DISC1.* guardados em localStorage (status/observações locais).
 */
(function (root) {
  'use strict';

  var LETRAS = ['D', 'I', 'S', 'C'];
  var STATUS = {
    em_analise: 'Em análise',
    aprovado: 'Aprovado',
    reprovado: 'Reprovado',
    invalido: 'Inválido'
  };
  var CORES = { D: '#d64545', I: '#e0a100', S: '#2f9e6e', C: '#3b6fd6' };
  var NOMES = { D: 'Dominância', I: 'Influência', S: 'Estabilidade', C: 'Conformidade' };
  var CHAVE_SESSAO = 'disc_admin_chave';
  var CHAVE_LOCAL = 'disc_admin_registros';

  function dep(nome) {
    if (typeof root[nome] !== 'undefined') return root[nome];
    if (typeof require === 'function') {
      try {
        var mapa = { DISC_SCORING: './scoring.js', DISC_DATA: './disc-data.js' };
        if (mapa[nome]) return require(mapa[nome]);
      } catch (e) { /* ignora */ }
    }
    return undefined;
  }

  /* ---------- Utilitários puros (testáveis em Node) ---------- */

  function escaparHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function soDigitos(s) { return String(s == null ? '' : s).replace(/\D/g, ''); }

  // '5511999998888' -> '(11) 99999-8888'
  function formatarTelefone(tel) {
    var d = soDigitos(tel);
    if ((d.length === 12 || d.length === 13) && d.indexOf('55') === 0) d = d.slice(2);
    if (d.length === 11) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
    if (d.length === 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
    return d || '—';
  }

  function linkWhatsApp(tel) {
    var d = soDigitos(tel);
    if (!d) return '';
    if (d.length === 10 || d.length === 11) d = '55' + d;
    return 'https://wa.me/' + d;
  }

  function formatarData(iso) {
    if (!iso) return '—';
    var dt = new Date(iso);
    if (isNaN(dt.getTime())) return '—';
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return p(dt.getDate()) + '/' + p(dt.getMonth() + 1) + '/' + dt.getFullYear() + ' ' + p(dt.getHours()) + ':' + p(dt.getMinutes());
  }

  function formatarDuracao(seg) {
    var n = Number(seg);
    if (!isFinite(n) || n <= 0) return '—';
    var m = Math.floor(n / 60), s = Math.round(n % 60);
    return m + ' min ' + (s < 10 ? '0' : '') + s + ' s';
  }

  function normalizarStatus(s) {
    return (s === 'aprovado' || s === 'reprovado' || s === 'em_analise') ? s : 'em_analise';
  }

  // Recalcula a partir de payload.respostas; nunca confia em payload.resultado.
  function recalcular(registro) {
    var SC = dep('DISC_SCORING');
    var r = {};
    for (var k in registro) if (Object.prototype.hasOwnProperty.call(registro, k)) r[k] = registro[k];
    r.status = normalizarStatus(r.status);
    r.observacoes = r.observacoes == null ? '' : String(r.observacoes);
    try {
      r.calc = SC.calcular(SC.descompactar(r.respostas));
      r.invalido = false;
    } catch (e) {
      r.calc = null;
      r.invalido = true;
    }
    return r;
  }

  function contarLetras(texto) {
    var m;
    try { m = String(texto).match(new RegExp('\\p{L}', 'gu')); } catch (e) { m = String(texto).match(/[A-Za-zÀ-ÖØ-öø-ÿ]/g); }
    return m ? m.length : 0;
  }

  // Mesmas regras do backend (apps-script/Code.gs, validarPayload) para um payload importado por código.
  // Retorna '' se válido ou a mensagem de erro.
  function validarImportado(p) {
    if (!p || typeof p !== 'object' || !p.id || !p.nome || !p.respostas) return 'dados incompletos.';
    if (p.consentimento !== true) return 'sem registro do consentimento LGPD.';
    var nome = String(p.nome).replace(/\s+/g, ' ').trim();
    var palavras = nome.split(' ').filter(function (w) { return contarLetras(w) > 0; });
    if (palavras.length < 2 || contarLetras(nome) < 5) return 'nome incompleto (precisa de nome e sobrenome).';
    var d = soDigitos(p.telefone);
    var telOk = d.length === 10 || d.length === 11 || ((d.length === 12 || d.length === 13) && d.indexOf('55') === 0);
    if (!telOk) return 'telefone inválido.';
    return '';
  }

  // Extrai códigos DISC1.* de um texto livre (ex.: mensagem do WhatsApp). Um por linha também funciona.
  function extrairCodigos(texto) {
    var achados = String(texto || '').match(/DISC1\.[A-Za-z0-9_\-+/=]+/g);
    if (achados && achados.length) return achados;
    return String(texto || '').split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
  }

  function celulaCsv(v) {
    var s = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // evita injeção de fórmula no Excel
    if (/[";\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function gerarCsv(registros) {
    var cab = ['id', 'nome', 'telefone', 'vaga', 'data', 'duração', 'D %', 'I %', 'S %', 'C %', 'perfil', 'status', 'observações'];
    var linhas = [cab.map(celulaCsv).join(';')];
    registros.forEach(function (r) {
      var p = r.calc ? r.calc.percentuais : {};
      function num(l) { return r.calc ? String(p[l]).replace('.', ',') : ''; }
      linhas.push([
        r.id, r.nome, formatarTelefone(r.telefone), r.vaga || '',
        formatarData(r.fim || r.recebidoEm), formatarDuracao(r.duracaoSeg),
        num('D'), num('I'), num('S'), num('C'),
        r.calc ? r.calc.codigo : 'inválido',
        r.invalido ? STATUS.invalido : STATUS[r.status],
        r.observacoes || ''
      ].map(celulaCsv).join(';'));
    });
    return '﻿' + linhas.join('\r\n');
  }

  // Comparativo: distribuição de perfis e médias D/I/S/C de um conjunto de registros válidos.
  function resumoEquipe(registros) {
    var validos = registros.filter(function (r) { return r.calc; });
    var primarios = { D: 0, I: 0, S: 0, C: 0 };
    var codigos = {};
    var soma = { D: 0, I: 0, S: 0, C: 0 };
    validos.forEach(function (r) {
      primarios[r.calc.primario]++;
      codigos[r.calc.codigo] = (codigos[r.calc.codigo] || 0) + 1;
      LETRAS.forEach(function (l) { soma[l] += r.calc.percentuais[l]; });
    });
    var media = {};
    LETRAS.forEach(function (l) { media[l] = validos.length ? Math.round((soma[l] / validos.length) * 10) / 10 : 0; });
    return { total: validos.length, primarios: primarios, codigos: codigos, media: media };
  }

  function guiaComoTexto(guia, registro) {
    var out = [];
    out.push(guia.titulo || 'Guia para a Liderança');
    if (registro) {
      out.push('Candidato: ' + (registro.nome || '') + ' — ' + formatarTelefone(registro.telefone));
      if (registro.calc) out.push('Perfil: ' + registro.calc.codigo + ' (D ' + registro.calc.percentuais.D + '% · I ' + registro.calc.percentuais.I + '% · S ' + registro.calc.percentuais.S + '% · C ' + registro.calc.percentuais.C + '%)');
    }
    out.push('');
    if (guia.resumo) { out.push(guia.resumo); out.push(''); }
    (guia.secoes || []).forEach(function (s) {
      out.push(String(s.titulo || '').toUpperCase());
      (s.itens || []).forEach(function (i) { out.push('• ' + i); });
      out.push('');
    });
    return out.join('\n').trim() + '\n';
  }

  var util = {
    escaparHtml: escaparHtml,
    formatarTelefone: formatarTelefone,
    linkWhatsApp: linkWhatsApp,
    formatarData: formatarData,
    formatarDuracao: formatarDuracao,
    normalizarStatus: normalizarStatus,
    recalcular: recalcular,
    extrairCodigos: extrairCodigos,
    validarImportado: validarImportado,
    gerarCsv: gerarCsv,
    resumoEquipe: resumoEquipe,
    guiaComoTexto: guiaComoTexto
  };

  if (typeof module !== 'undefined' && module.exports) { module.exports = util; return; }
  root.DISC_ADMIN = util;
  if (typeof document === 'undefined') return;

  /* ---------- Navegador ---------- */

  var CONFIG = root.CONFIG || { API_URL: '', EMPRESA: '' };
  var MODO_API = !!(CONFIG.API_URL && String(CONFIG.API_URL).trim());
  var estado = { chave: '', registros: [], abertoId: null, aba: 'lista' };

  function $(id) { return document.getElementById(id); }

  // Cria elementos com segurança: texto sempre via textContent.
  function el(tag, attrs, filhos) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (!Object.prototype.hasOwnProperty.call(attrs, k) || attrs[k] == null || attrs[k] === false) continue;
      if (k === 'texto') n.textContent = attrs[k];
      else if (k === 'classe') n.className = attrs[k];
      else if (k.indexOf('on') === 0 && typeof attrs[k] === 'function') n.addEventListener(k.slice(2), attrs[k]);
      else if (k === 'estilo') for (var e in attrs[k]) n.style.setProperty(e, attrs[k][e]);
      else n.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
    }
    adicionar(n, filhos);
    return n;
  }
  function adicionar(n, filhos) {
    if (filhos == null) return;
    if (!Array.isArray(filhos)) filhos = [filhos];
    filhos.forEach(function (f) {
      if (f == null || f === false) return;
      n.appendChild(typeof f === 'string' || typeof f === 'number' ? document.createTextNode(String(f)) : f);
    });
  }
  function limpar(n) { while (n.firstChild) n.removeChild(n.firstChild); }

  function svg(tag, attrs) {
    var n = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) n.setAttribute(k, attrs[k]);
    return n;
  }

  function ls(acao, chave, valor) {
    try {
      if (acao === 'get') return root.localStorage.getItem(chave);
      if (acao === 'set') root.localStorage.setItem(chave, valor);
    } catch (e) { return null; }
    return null;
  }
  function ss(acao, chave, valor) {
    try {
      if (acao === 'get') return root.sessionStorage.getItem(chave);
      if (acao === 'set') root.sessionStorage.setItem(chave, valor);
      if (acao === 'del') root.sessionStorage.removeItem(chave);
    } catch (e) { return null; }
    return null;
  }

  var avisoTimer;
  function avisar(msg, tipo) {
    var a = $('aviso-geral');
    a.textContent = msg;
    a.className = 'aviso' + (tipo ? ' aviso-' + tipo : '');
    a.hidden = false;
    clearTimeout(avisoTimer);
    avisoTimer = setTimeout(function () { a.hidden = true; }, 6000);
  }

  /* ---------- Armazenamento local ---------- */

  function lerLocais() {
    try {
      var arr = JSON.parse(ls('get', CHAVE_LOCAL) || '[]');
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }
  function salvarLocais() {
    var brutos = estado.registros.map(function (r) {
      var c = {};
      for (var k in r) if (k !== 'calc' && k !== 'invalido' && Object.prototype.hasOwnProperty.call(r, k)) c[k] = r[k];
      return c;
    });
    ls('set', CHAVE_LOCAL, JSON.stringify(brutos));
  }

  /* ---------- Carregamento ---------- */

  function ordenar(lista) {
    return lista.sort(function (a, b) {
      return String(b.fim || b.recebidoEm || '').localeCompare(String(a.fim || a.recebidoEm || ''));
    });
  }

  function carregar() {
    if (!MODO_API) {
      estado.registros = ordenar(lerLocais().map(recalcular));
      renderizarTudo();
      return Promise.resolve();
    }
    $('contagem').textContent = 'Carregando…';
    return root.DISC_API.listar(estado.chave).then(function (resp) {
      if (!resp || !resp.ok) throw new Error((resp && resp.erro) || 'Não foi possível carregar os resultados.');
      estado.registros = ordenar((resp.itens || []).map(recalcular));
      renderizarTudo();
    }).catch(function (e) {
      $('contagem').textContent = '';
      avisar(e.message || 'Erro ao carregar.', 'erro');
      if (/chave|autoriz|acesso/i.test(e.message || '')) sair();
    });
  }

  function acharRegistro(id) {
    for (var i = 0; i < estado.registros.length; i++) if (estado.registros[i].id === id) return estado.registros[i];
    return null;
  }

  function atualizarCampos(id, campos) {
    var r = acharRegistro(id);
    if (!r) return Promise.reject(new Error('Candidato não encontrado.'));
    if (!MODO_API) {
      for (var k in campos) r[k] = campos[k];
      salvarLocais();
      return Promise.resolve();
    }
    return root.DISC_API.atualizar(estado.chave, id, campos).then(function (resp) {
      if (!resp || !resp.ok) throw new Error((resp && resp.erro) || 'Não foi possível salvar.');
      for (var k in campos) r[k] = campos[k];
    });
  }

  function excluirRegistro(id) {
    var p = MODO_API ? root.DISC_API.excluir(estado.chave, id).then(function (resp) {
      if (!resp || !resp.ok) throw new Error((resp && resp.erro) || 'Não foi possível excluir.');
    }) : Promise.resolve();
    return p.then(function () {
      estado.registros = estado.registros.filter(function (r) { return r.id !== id; });
      if (!MODO_API) salvarLocais();
    });
  }

  function excluirTodos() {
    var conf = root.prompt('Esta ação apaga TODOS os candidatos e não pode ser desfeita.' +
      (MODO_API ? '\nAtenção: o Histórico de versões da planilha continua guardando os dados. Para eliminá-los de vez, exclua a planilha do Google Drive e esvazie a lixeira.' : '') +
      '\nDigite EXCLUIR para confirmar:');
    if (conf == null) return;
    if (conf.trim() !== 'EXCLUIR') { avisar('Exclusão cancelada: o texto digitado não confere.', 'erro'); return; }
    var p = MODO_API ? root.DISC_API.excluirTodos(estado.chave).then(function (resp) {
      if (!resp || !resp.ok) throw new Error((resp && resp.erro) || 'Não foi possível excluir.');
    }) : Promise.resolve();
    p.then(function () {
      estado.registros = [];
      if (!MODO_API) salvarLocais();
      fecharDetalhe();
      renderizarTudo();
      avisar('Todos os candidatos foram excluídos.', 'ok');
    }).catch(function (e) { avisar(e.message, 'erro'); });
  }

  /* ---------- Componentes ---------- */

  function badgePerfil(r) {
    if (!r.calc) return el('span', { classe: 'badge badge-invalido', texto: 'Inválido' });
    return el('span', {
      classe: 'badge badge-' + r.calc.primario,
      title: NOMES[r.calc.primario] + ' / ' + NOMES[r.calc.secundario],
      texto: r.calc.codigo
    });
  }

  function badgeStatus(r) {
    var s = r.invalido ? 'invalido' : r.status;
    return el('span', { classe: 'status status-' + s, texto: STATUS[s] });
  }

  function miniBarras(p) {
    var wrap = el('div', { classe: 'mini-barras', role: 'img',
      'aria-label': 'D ' + p.D + '%, I ' + p.I + '%, S ' + p.S + '%, C ' + p.C + '%' });
    LETRAS.forEach(function (l) {
      wrap.appendChild(el('div', { classe: 'mini-linha' }, [
        el('span', { classe: 'mini-letra', texto: l }),
        el('span', { classe: 'mini-trilho' }, el('span', { classe: 'mini-barra barra-' + l, estilo: { width: Math.min(100, (p[l] / 40) * 100) + '%' } })),
        el('span', { classe: 'mini-valor', texto: p[l] + '%' })
      ]));
    });
    return wrap;
  }

  function linkTelefone(r) {
    var href = linkWhatsApp(r.telefone);
    var txt = formatarTelefone(r.telefone);
    if (!href) return el('span', { texto: txt });
    return el('a', { href: href, target: '_blank', rel: 'noopener noreferrer', classe: 'link-wa',
      'aria-label': 'Abrir WhatsApp de ' + (r.nome || 'candidato') + ': ' + txt, texto: txt });
  }

  // Gráfico de barras DISC em SVG (sem bibliotecas).
  function graficoDisc(calc) {
    var W = 320, H = 220, base = 180, topo = 20, larg = 48, gap = 26, x0 = 30;
    var maxV = 50;
    var s = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'grafico', role: 'img',
      'aria-label': 'Gráfico DISC: D ' + calc.percentuais.D + '%, I ' + calc.percentuais.I + '%, S ' + calc.percentuais.S + '%, C ' + calc.percentuais.C + '%' });
    [0, 25, 50].forEach(function (v) {
      var y = base - (v / maxV) * (base - topo);
      s.appendChild(svg('line', { x1: x0 - 4, x2: W - 6, y1: y, y2: y, class: 'grade' }));
      var t = svg('text', { x: x0 - 8, y: y + 4, 'text-anchor': 'end', class: 'eixo' });
      t.textContent = v + '%';
      s.appendChild(t);
    });
    LETRAS.forEach(function (l, i) {
      var v = calc.percentuais[l];
      var h = (Math.min(v, maxV) / maxV) * (base - topo);
      var x = x0 + 12 + i * (larg + gap);
      var rect = svg('rect', { x: x, y: base - h, width: larg, height: h, rx: 4, fill: CORES[l] });
      s.appendChild(rect);
      var tv = svg('text', { x: x + larg / 2, y: base - h - 6, 'text-anchor': 'middle', class: 'valor' });
      tv.textContent = String(v).replace('.', ',') + '%';
      s.appendChild(tv);
      var tl = svg('text', { x: x + larg / 2, y: base + 20, 'text-anchor': 'middle', class: 'letra' });
      tl.textContent = l;
      s.appendChild(tl);
      var tt = svg('text', { x: x + larg / 2, y: base + 34, 'text-anchor': 'middle', class: 'eixo' });
      tt.textContent = 'total ' + calc.totais[l];
      s.appendChild(tt);
    });
    return s;
  }

  function listaItens(titulo, itens) {
    if (!itens || !itens.length) return null;
    return el('div', { classe: 'bloco-lista' }, [
      el('h4', { texto: titulo }),
      el('ul', null, itens.map(function (i) { return el('li', { texto: i }); }))
    ]);
  }

  function blocoPerfil(letra, papel) {
    var DATA = dep('DISC_DATA');
    var p = DATA && DATA.perfis && DATA.perfis[letra];
    if (!p) return null;
    return el('section', { classe: 'perfil-card perfil-' + letra }, [
      el('h3', null, [el('span', { classe: 'badge badge-' + letra, texto: letra }), ' ', p.nome + ' — ' + papel]),
      el('div', { classe: 'grade-listas' }, [
        listaItens('Pontos fortes', p.positivos),
        listaItens('Valor para a equipe', p.valorEquipe),
        listaItens('Ambiente ideal', p.ambienteIdeal),
        listaItens('Sob pressão', p.sobPressao),
        listaItens('Pontos de atenção', p.limitantes)
      ])
    ]);
  }

  function gerarGuia(r) {
    if (!r.calc || !root.DISC_LIDERANCA || typeof root.DISC_LIDERANCA.gerarGuia !== 'function') return null;
    try { return root.DISC_LIDERANCA.gerarGuia(r.calc, r.nome); } catch (e) { return null; }
  }

  /* ---------- Lista ---------- */

  function filtrados() {
    var busca = $('filtro-busca').value.trim().toLowerCase();
    var buscaDig = soDigitos(busca);
    var perfil = $('filtro-perfil').value;
    var status = $('filtro-status').value;
    return estado.registros.filter(function (r) {
      if (perfil && (!r.calc || r.calc.primario !== perfil)) return false;
      if (status === 'invalido' && !r.invalido) return false;
      if (status && status !== 'invalido' && (r.invalido || r.status !== status)) return false;
      if (busca) {
        var alvo = (String(r.nome || '') + ' ' + String(r.vaga || '')).toLowerCase();
        var okTexto = alvo.indexOf(busca) !== -1;
        var okTel = buscaDig.length >= 3 && soDigitos(r.telefone).indexOf(buscaDig) !== -1;
        if (!okTexto && !okTel) return false;
      }
      return true;
    });
  }

  function renderizarLista() {
    var ul = $('lista-candidatos');
    limpar(ul);
    var itens = filtrados();
    var total = estado.registros.length;
    $('contagem').textContent = total === 0
      ? (MODO_API ? 'Nenhum candidato recebido ainda.' : 'Nenhum candidato importado. Use a aba "Importar códigos".')
      : itens.length + ' de ' + total + ' candidato' + (total === 1 ? '' : 's');
    itens.forEach(function (r) {
      ul.appendChild(el('li', { classe: 'card' + (r.invalido ? ' card-invalido' : '') }, [
        el('div', { classe: 'card-topo' }, [
          el('button', { type: 'button', classe: 'card-nome', texto: r.nome || '(sem nome)',
            onclick: function () { abrirDetalhe(r.id); } }),
          badgePerfil(r)
        ]),
        el('div', { classe: 'card-meta' }, [
          linkTelefone(r),
          r.vaga ? el('span', { texto: r.vaga }) : null,
          el('span', { classe: 'muted', texto: formatarData(r.fim || r.recebidoEm) })
        ]),
        r.calc ? miniBarras(r.calc.percentuais) : el('p', { classe: 'erro', texto: 'Respostas inválidas — resultado não pode ser calculado.' }),
        el('div', { classe: 'card-rodape' }, [
          badgeStatus(r),
          el('button', { type: 'button', classe: 'btn btn-sec btn-peq', texto: 'Ver detalhes',
            'aria-label': 'Ver detalhes de ' + (r.nome || 'candidato'), onclick: function () { abrirDetalhe(r.id); } })
        ])
      ]));
    });
  }

  /* ---------- Detalhe ---------- */

  function abrirDetalhe(id) {
    estado.abertoId = id;
    renderizarDetalhe();
    $('vista-lista').hidden = true;
    $('vista-comparativo').hidden = true;
    $('vista-importar').hidden = true;
    $('vista-detalhe').hidden = false;
    root.scrollTo(0, 0);
    var h = $('vista-detalhe').querySelector('h2');
    if (h) { h.setAttribute('tabindex', '-1'); h.focus(); }
  }

  function fecharDetalhe() {
    estado.abertoId = null;
    $('vista-detalhe').hidden = true;
    mostrarAba(estado.aba);
  }

  function copiarTexto(txt) {
    if (root.navigator && root.navigator.clipboard && root.isSecureContext) {
      return root.navigator.clipboard.writeText(txt);
    }
    return new Promise(function (ok, falha) {
      var ta = el('textarea', { readonly: true, estilo: { position: 'fixed', left: '-9999px' } });
      ta.value = txt;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy') ? ok() : falha(new Error('cópia bloqueada')); }
      catch (e) { falha(e); }
      document.body.removeChild(ta);
    });
  }

  function renderizarDetalhe() {
    var art = $('vista-detalhe');
    limpar(art);
    var r = acharRegistro(estado.abertoId);
    if (!r) { fecharDetalhe(); return; }
    var guia = gerarGuia(r);

    // Ações (não impressas)
    art.appendChild(el('div', { classe: 'barra-acoes nao-imprimir' }, [
      el('button', { type: 'button', classe: 'btn btn-sec', texto: '← Voltar', onclick: fecharDetalhe }),
      el('button', { type: 'button', classe: 'btn', texto: 'Imprimir / salvar PDF', onclick: function () { root.print(); } }),
      guia ? el('button', { type: 'button', classe: 'btn btn-sec', texto: 'Copiar guia', onclick: function () {
        copiarTexto(guiaComoTexto(guia, r)).then(function () { avisar('Guia copiado para a área de transferência.', 'ok'); },
          function () { avisar('Não foi possível copiar automaticamente.', 'erro'); });
      } }) : null
    ]));

    // Cabeçalho
    art.appendChild(el('header', { classe: 'det-cabecalho' }, [
      el('p', { classe: 'muted so-imprimir', texto: 'Relatório DISC' + (CONFIG.EMPRESA ? ' — ' + CONFIG.EMPRESA : '') }),
      el('h2', { texto: r.nome || '(sem nome)' }),
      el('dl', { classe: 'det-dados' }, [
        el('dt', { texto: 'Telefone' }), el('dd', null, linkTelefone(r)),
        el('dt', { texto: 'Vaga' }), el('dd', { texto: r.vaga || '—' }),
        el('dt', { texto: 'Concluído em' }), el('dd', { texto: formatarData(r.fim || r.recebidoEm) }),
        el('dt', { texto: 'Duração' }), el('dd', { texto: formatarDuracao(r.duracaoSeg) }),
        el('dt', { texto: 'Perfil' }), el('dd', null, [badgePerfil(r), r.calc ? ' ' + NOMES[r.calc.primario] + ' / ' + NOMES[r.calc.secundario] : '']),
        el('dt', { texto: 'Status' }), el('dd', null, badgeStatus(r))
      ])
    ]));

    // Status e observações
    var selStatus = el('select', { id: 'det-status', disabled: r.invalido || null }, ['em_analise', 'aprovado', 'reprovado'].map(function (s) {
      return el('option', { value: s, selected: r.status === s || null, texto: STATUS[s] });
    }));
    selStatus.addEventListener('change', function () {
      var novo = selStatus.value;
      atualizarCampos(r.id, { status: novo }).then(function () {
        avisar('Status atualizado para "' + STATUS[novo] + '".', 'ok');
        renderizarDetalhe(); renderizarLista(); renderizarComparativo();
      }).catch(function (e) { avisar(e.message, 'erro'); selStatus.value = r.status; });
    });
    var taObs = el('textarea', { id: 'det-obs', rows: 3, maxlength: 2000 });
    taObs.value = r.observacoes || '';
    var btnObs = el('button', { type: 'button', classe: 'btn btn-sec', texto: 'Salvar observações' });
    btnObs.addEventListener('click', function () {
      btnObs.disabled = true;
      atualizarCampos(r.id, { observacoes: taObs.value }).then(function () {
        avisar('Observações salvas.', 'ok'); obsImpressa.textContent = taObs.value;
      }).catch(function (e) { avisar(e.message, 'erro'); }).then(function () { btnObs.disabled = false; });
    });
    var btnExcluir = el('button', { type: 'button', classe: 'btn btn-perigo', texto: 'Excluir candidato' });
    btnExcluir.addEventListener('click', function () {
      if (!root.confirm('Excluir definitivamente os dados de ' + (r.nome || 'este candidato') + '?')) return;
      excluirRegistro(r.id).then(function () {
        avisar('Candidato excluído.', 'ok'); fecharDetalhe(); renderizarTudo();
      }).catch(function (e) { avisar(e.message, 'erro'); });
    });
    art.appendChild(el('section', { classe: 'cartao nao-imprimir det-gestao' }, [
      el('h3', { texto: 'Avaliação do recrutador' }),
      el('div', { classe: 'campo' }, [el('label', { for: 'det-status', texto: 'Status' }), selStatus]),
      el('div', { classe: 'campo' }, [el('label', { for: 'det-obs', texto: 'Observações' }), taObs]),
      el('div', { classe: 'barra-acoes' }, [btnObs, btnExcluir])
    ]));
    var obsImpressa = el('p', { classe: 'obs-impressa', texto: r.observacoes || '' });
    art.appendChild(el('section', { classe: 'so-imprimir' }, [el('h3', { texto: 'Observações' }), obsImpressa]));

    if (!r.calc) {
      art.appendChild(el('p', { classe: 'erro cartao', texto: 'As respostas deste candidato estão incompletas ou corrompidas; não é possível calcular o perfil.' }));
      return;
    }

    // Gráfico
    art.appendChild(el('section', { classe: 'cartao det-grafico' }, [
      el('h3', { texto: 'Resultado DISC' }),
      graficoDisc(r.calc),
      el('p', { classe: 'muted legenda', texto: 'D = Dominância · I = Influência · S = Estabilidade · C = Conformidade. Cada letra varia de 10% a 40%; a soma é 100%.' })
    ]));

    // Características
    art.appendChild(el('div', { classe: 'det-perfis' }, [
      blocoPerfil(r.calc.primario, 'perfil primário'),
      blocoPerfil(r.calc.secundario, 'perfil secundário')
    ]));

    // Guia
    if (guia) {
      art.appendChild(el('section', { classe: 'cartao guia' }, [
        el('h3', { texto: guia.titulo || 'Guia para a Liderança' }),
        guia.resumo ? el('p', { classe: 'guia-resumo', texto: guia.resumo }) : null,
        el('div', { classe: 'guia-secoes' }, (guia.secoes || []).map(function (s) {
          return el('div', { classe: 'guia-secao' }, [
            el('h4', { texto: s.titulo || '' }),
            el('ul', null, (s.itens || []).map(function (i) { return el('li', { texto: i }); }))
          ]);
        }))
      ]));
    } else {
      art.appendChild(el('p', { classe: 'cartao muted', texto: 'Guia para a Liderança indisponível (módulo lideranca.js não carregado).' }));
    }
  }

  /* ---------- Comparativo ---------- */

  function renderizarComparativo() {
    var box = $('vista-comparativo');
    limpar(box);
    var aprovados = estado.registros.filter(function (r) { return !r.invalido && r.status === 'aprovado'; });
    var res = resumoEquipe(aprovados);
    box.appendChild(el('h2', { texto: 'Comparativo dos aprovados' }));
    if (!res.total) {
      box.appendChild(el('p', { classe: 'cartao muted', texto: 'Nenhum candidato aprovado ainda. Marque candidatos como "Aprovado" no detalhe para ver o comparativo da equipe.' }));
      return;
    }
    box.appendChild(el('p', { classe: 'muted', texto: res.total + ' aprovado' + (res.total === 1 ? '' : 's') + '.' }));

    var tbody = el('tbody');
    LETRAS.forEach(function (l) {
      var pct = Math.round((res.primarios[l] / res.total) * 100);
      tbody.appendChild(el('tr', null, [
        el('th', { scope: 'row' }, [el('span', { classe: 'badge badge-' + l, texto: l }), ' ' + NOMES[l]]),
        el('td', { texto: String(res.primarios[l]) }),
        el('td', { texto: pct + '%' }),
        el('td', { texto: String(res.media[l]).replace('.', ',') + '%' }),
        el('td', null, el('span', { classe: 'mini-trilho larga' }, el('span', { classe: 'mini-barra barra-' + l, estilo: { width: Math.min(100, (res.media[l] / 40) * 100) + '%' } })))
      ]));
    });
    box.appendChild(el('div', { classe: 'cartao tabela-wrap' }, [
      el('table', { classe: 'tabela' }, [
        el('caption', { texto: 'Distribuição por perfil primário e média da equipe' }),
        el('thead', null, el('tr', null, ['Perfil', 'Primário (qtd.)', '% da equipe', 'Média', ''].map(function (t) { return el('th', { scope: 'col', texto: t }); }))),
        tbody
      ])
    ]));

    var codigos = Object.keys(res.codigos).sort(function (a, b) { return res.codigos[b] - res.codigos[a]; });
    box.appendChild(el('div', { classe: 'cartao' }, [
      el('h3', { texto: 'Combinações de perfil' }),
      el('ul', { classe: 'lista-codigos' }, codigos.map(function (c) {
        return el('li', null, [el('span', { classe: 'badge badge-' + c[0], texto: c }), ' × ' + res.codigos[c]]);
      }))
    ]));

    var faltando = LETRAS.filter(function (l) { return res.primarios[l] === 0; });
    if (faltando.length) {
      box.appendChild(el('p', { classe: 'cartao dica', texto: 'Perfis ausentes entre os aprovados: ' + faltando.map(function (l) { return l + ' (' + NOMES[l] + ')'; }).join(', ') + '. Uma equipe equilibrada costuma se beneficiar da diversidade de estilos.' }));
    }

    box.appendChild(el('div', { classe: 'cartao' }, [
      el('h3', { texto: 'Aprovados' }),
      el('ul', { classe: 'lista-simples' }, aprovados.map(function (r) {
        return el('li', null, [
          el('button', { type: 'button', classe: 'link-botao', texto: r.nome || '(sem nome)', onclick: function () { abrirDetalhe(r.id); } }),
          ' ', badgePerfil(r)
        ]);
      }))
    ]));
  }

  /* ---------- Importação de códigos (plano B do candidato) ---------- */
  // Sem API: grava no localStorage deste navegador.
  // Com API: envia cada código para a planilha (o backend valida, recalcula e ignora id repetido).

  function importar() {
    var texto = $('campo-codigos').value;
    var codigos = extrairCodigos(texto);
    var out = $('resultado-importacao');
    var btn = $('btn-importar');
    limpar(out);
    if (!codigos.length) { out.appendChild(el('p', { classe: 'erro', texto: 'Cole pelo menos um código.' })); return; }
    var novos = 0, duplicados = 0, erros = [];
    var validos = [];
    codigos.forEach(function (c, i) {
      var p;
      try { p = root.DISC_CODEC.decode(c); } catch (e) { erros.push('Código ' + (i + 1) + ': formato inválido.'); return; }
      var problema = validarImportado(p);
      if (problema) { erros.push('Código ' + (i + 1) + ': ' + problema); return; }
      validos.push({ i: i, p: p });
    });

    function concluir() {
      out.appendChild(el('p', { classe: novos ? 'ok' : 'muted',
        texto: novos + ' importado' + (novos === 1 ? '' : 's') + (duplicados ? ', ' + duplicados + ' já existia' + (duplicados === 1 ? '' : 'm') : '') + '.' }));
      if (erros.length) out.appendChild(el('ul', { classe: 'erro' }, erros.map(function (e) { return el('li', { texto: e }); })));
      if (novos) $('campo-codigos').value = '';
    }

    if (MODO_API) {
      btn.disabled = true;
      var cadeia = Promise.resolve();
      validos.forEach(function (v) {
        cadeia = cadeia.then(function () {
          if (acharRegistro(String(v.p.id))) { duplicados++; return; }
          return root.DISC_API.enviar(v.p).then(function (resp) {
            if (resp && resp.duplicado) duplicados++;
            else novos++;
          }, function (e) {
            erros.push('Código ' + (v.i + 1) + ' (' + String(v.p.nome) + '): ' + ((e && e.message) || 'não foi possível enviar.'));
          });
        });
      });
      cadeia.then(function () { return novos ? carregar() : null; }).then(function () {
        btn.disabled = false;
        concluir();
      });
      return;
    }

    validos.forEach(function (v) {
      var p = v.p;
      if (acharRegistro(String(p.id))) { duplicados++; return; }
      var reg = {};
      ['v', 'id', 'nome', 'telefone', 'vaga', 'consentimento', 'inicio', 'fim', 'duracaoSeg', 'respostas'].forEach(function (k) {
        if (p[k] != null) reg[k] = typeof p[k] === 'object' ? JSON.stringify(p[k]) : p[k];
      });
      reg.id = String(reg.id);
      reg.status = 'em_analise';
      reg.observacoes = '';
      reg.recebidoEm = new Date().toISOString();
      var rc = recalcular(reg);
      if (rc.invalido) erros.push('Código ' + (v.i + 1) + ' (' + String(p.nome) + '): respostas inválidas — importado como inválido.');
      estado.registros.push(rc);
      novos++;
    });
    ordenar(estado.registros);
    salvarLocais();
    renderizarTudo();
    concluir();
  }

  /* ---------- CSV ---------- */

  function exportarCsv() {
    var lista = filtrados();
    if (!lista.length) { avisar('Não há candidatos para exportar.', 'erro'); return; }
    var blob = new Blob([gerarCsv(lista)], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var hoje = new Date().toISOString().slice(0, 10);
    var a = el('a', { href: url, download: 'candidatos-disc-' + hoje + '.csv' });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  /* ---------- Navegação ---------- */

  function mostrarAba(aba) {
    estado.aba = aba;
    if (estado.abertoId) { estado.abertoId = null; $('vista-detalhe').hidden = true; }
    $('vista-lista').hidden = aba !== 'lista';
    $('vista-comparativo').hidden = aba !== 'comparativo';
    $('vista-importar').hidden = aba !== 'importar';
    Array.prototype.forEach.call(document.querySelectorAll('.aba'), function (b) {
      if (b.getAttribute('data-aba') === aba) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
  }

  function renderizarTudo() {
    renderizarLista();
    renderizarComparativo();
    if (estado.abertoId) renderizarDetalhe();
  }

  function entrarPainel() {
    $('tela-login').hidden = true;
    $('tela-painel').hidden = false;
    $('btn-sair').hidden = !MODO_API;
    mostrarAba(MODO_API ? 'lista' : (lerLocais().length ? 'lista' : 'importar'));
    carregar();
  }

  function sair() {
    ss('del', CHAVE_SESSAO);
    estado.chave = '';
    estado.registros = [];
    estado.abertoId = null;
    $('tela-painel').hidden = true;
    $('btn-sair').hidden = true;
    $('tela-login').hidden = false;
    $('campo-chave').value = '';
    $('campo-chave').focus();
  }

  function iniciar() {
    if (CONFIG.EMPRESA) $('nome-empresa').textContent = '· ' + CONFIG.EMPRESA;
    $('modo-indicador').textContent = MODO_API ? 'Conectado à planilha' : 'Modo local (importar códigos)';
    $('aba-importar').hidden = false;
    if (MODO_API) $('destino-importacao').textContent = 'Os resultados são enviados para a planilha, como se o candidato tivesse enviado.';

    Array.prototype.forEach.call(document.querySelectorAll('.aba'), function (b) {
      b.addEventListener('click', function () { mostrarAba(b.getAttribute('data-aba')); });
    });
    ['filtro-busca', 'filtro-perfil', 'filtro-status'].forEach(function (id) {
      $(id).addEventListener('input', renderizarLista);
      $(id).addEventListener('change', renderizarLista);
    });
    $('btn-atualizar').addEventListener('click', function () { carregar().then(function () { avisar('Lista atualizada.', 'ok'); }); });
    $('btn-csv').addEventListener('click', exportarCsv);
    $('btn-excluir-todos').addEventListener('click', excluirTodos);
    $('btn-importar').addEventListener('click', importar);
    $('btn-sair').addEventListener('click', sair);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && estado.abertoId) fecharDetalhe(); });

    $('form-login').addEventListener('submit', function (e) {
      e.preventDefault();
      var chave = $('campo-chave').value.trim();
      var erro = $('erro-login');
      erro.hidden = true;
      if (!chave) { erro.textContent = 'Informe a chave.'; erro.hidden = false; return; }
      var btn = $('btn-entrar');
      btn.disabled = true; btn.textContent = 'Verificando…';
      root.DISC_API.listar(chave).then(function (resp) {
        if (!resp || !resp.ok) throw new Error((resp && resp.erro) || 'Chave inválida.');
        estado.chave = chave;
        ss('set', CHAVE_SESSAO, chave);
        entrarPainel();
      }).catch(function (err) {
        erro.textContent = err.message || 'Não foi possível entrar.';
        erro.hidden = false;
      }).then(function () { btn.disabled = false; btn.textContent = 'Entrar'; });
    });

    if (!MODO_API) { entrarPainel(); return; }
    var salva = ss('get', CHAVE_SESSAO);
    if (salva) { estado.chave = salva; entrarPainel(); }
    else { $('tela-login').hidden = false; $('campo-chave').focus(); }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})(typeof self !== 'undefined' ? self : this);
