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
  // Cores do gráfico SVG = tokens de assets/notus.css (--disc-D/--tinta, --disc-I/--ambar,
  // --disc-S/--ardosia-clara, --disc-C/--ardosia, --trilho, --suave). Se mudar lá, mude aqui (tests/admin.test.js confere).
  var CORES = {
    D: '#13283f', I: '#ff9f40', S: '#8a97ab', C: '#324e73',
    trilho: '#e9ecef', texto: '#13283f', suave: '#6b7586'
  };
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

  // Código do candidato (protocolo) gerado pelo servidor: "47K". Aceita minúsculas e espaços; '' se inválido.
  function normalizarProtocolo(v) {
    if (v == null) return '';
    var s = String(v).replace(/\s+/g, '').toUpperCase();
    return /^[0-9]{2}[A-HJ-NP-Z]$/.test(s) ? s : '';
  }

  // Texto exibido: o código, ou "—" para quem não tem (importado por código longo, envio antigo).
  function textoProtocolo(v) { return normalizarProtocolo(v) || '—'; }

  // Idade (só no detalhe do candidato — nunca na lista, nos resumos ou em filtros: evita discriminação
  // por idade, Lei 9.029/95). Registros antigos sem idade mostram "—".
  function textoIdade(v) {
    var n = Number(v);
    if (v === null || v === undefined || v === '' || !isFinite(n) || Math.floor(n) !== n || n < 14 || n > 99) return '—';
    return n + ' anos';
  }

  // Linha discreta do card: "Função · Empresa" (só o que houver; '' se nenhum).
  function textoExperiencia(r) {
    return [r && r.funcao, r && r.empresa].map(function (x) { return String(x == null ? '' : x).trim(); })
      .filter(Boolean).join(' · ');
  }

  // Busca da lista: nome/vaga/função/empresa (texto), telefone (3+ dígitos) ou protocolo (ignora maiúsculas e espaços).
  // A idade NÃO entra na busca.
  function correspondeBusca(r, busca) {
    var termo = String(busca == null ? '' : busca).trim().toLowerCase();
    if (!termo) return true;
    var alvo = [r.nome, r.vaga, r.funcao, r.empresa].map(function (x) { return String(x == null ? '' : x); }).join(' ').toLowerCase();
    if (alvo.indexOf(termo) !== -1) return true;
    var dig = soDigitos(termo);
    if (dig.length >= 3 && soDigitos(r.telefone).indexOf(dig) !== -1) return true;
    var prot = normalizarProtocolo(r.protocolo);
    var buscaProt = termo.replace(/\s+/g, '').toUpperCase();
    return !!prot && buscaProt.length >= 2 && prot.indexOf(buscaProt) === 0;
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
    r.protocolo = normalizarProtocolo(r.protocolo);
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
    // Códigos antigos (sem idade) continuam aceitos; se a idade vier, precisa ser válida.
    if (p.idade !== undefined && p.idade !== null && p.idade !== '' && textoIdade(p.idade) === '—') {
      return 'idade inválida (precisa ser entre 14 e 99 anos).';
    }
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
    var cab = ['id', 'protocolo', 'nome', 'telefone', 'vaga', 'idade', 'funcao', 'empresa', 'data', 'duração', 'D %', 'I %', 'S %', 'C %', 'perfil', 'status', 'observações'];
    var linhas = [cab.map(celulaCsv).join(';')];
    registros.forEach(function (r) {
      var p = r.calc ? r.calc.percentuais : {};
      function num(l) { return r.calc ? String(p[l]).replace('.', ',') : ''; }
      linhas.push([
        r.id, textoProtocolo(r.protocolo), r.nome, formatarTelefone(r.telefone), r.vaga || '',
        textoIdade(r.idade) === '—' ? '' : String(r.idade), r.funcao || '', r.empresa || '',
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
      out.push('Candidato: ' + (registro.nome || '') + ' — ' + formatarTelefone(registro.telefone) +
        (normalizarProtocolo(registro.protocolo) ? ' — Código ' + normalizarProtocolo(registro.protocolo) : ''));
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
    normalizarProtocolo: normalizarProtocolo,
    textoProtocolo: textoProtocolo,
    textoIdade: textoIdade,
    textoExperiencia: textoExperiencia,
    correspondeBusca: correspondeBusca,
    recalcular: recalcular,
    extrairCodigos: extrairCodigos,
    validarImportado: validarImportado,
    gerarCsv: gerarCsv,
    resumoEquipe: resumoEquipe,
    guiaComoTexto: guiaComoTexto,
    CORES: CORES
  };

  if (typeof module !== 'undefined' && module.exports) { module.exports = util; return; }
  root.DISC_ADMIN = util;
  if (typeof document === 'undefined') return;

  /* ---------- Navegador ---------- */

  var CONFIG = root.CONFIG || { API_URL: '', EMPRESA: '' };
  var MODO_API = !!(CONFIG.API_URL && String(CONFIG.API_URL).trim());
  var estado = { chave: '', registros: [], abertoId: null, aba: 'lista', listaMostrada: false };

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
    a.className = 'aviso aviso-geral surgir' + (tipo ? ' aviso--' + tipo : '');
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

  /* ---------- Confirmação na própria página (sem prompt/confirm do navegador) ---------- */
  // opcoes: { titulo, texto, exigir (texto que precisa ser digitado), botao }  -> Promise<boolean>
  function confirmar(opcoes) {
    return new Promise(function (resolver) {
      var anterior = document.activeElement;
      var entrada = opcoes.exigir ? el('input', { classe: 'entrada', id: 'confirmar-texto', autocomplete: 'off', 'aria-label': 'Digite ' + opcoes.exigir + ' para confirmar' }) : null;
      var btnOk = el('button', { type: 'button', classe: 'botao botao--perigo', id: 'confirmar-ok', texto: opcoes.botao || 'Excluir' });
      var btnCancelar = el('button', { type: 'button', classe: 'botao botao--claro', id: 'confirmar-cancelar', texto: 'Cancelar' });
      var caixa = el('div', { classe: 'caixa caixa--ampla vidro-janela confirmar__caixa surgir', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'confirmar-titulo', 'aria-describedby': 'confirmar-desc' }, [
        el('h2', { id: 'confirmar-titulo', classe: 'confirmar__titulo', texto: opcoes.titulo }),
        el('p', { id: 'confirmar-desc', classe: 'texto-medio t-corpo', texto: opcoes.texto }),
        entrada ? el('label', { classe: 'campo', for: 'confirmar-texto' }, [el('span', { classe: 'campo__rotulo', texto: 'Digite ' + opcoes.exigir + ' para confirmar' }), entrada]) : null,
        el('div', { classe: 'confirmar__acoes' }, [btnCancelar, btnOk])
      ]);
      var fundo = el('div', { classe: 'confirmar', id: 'confirmar' }, caixa);
      function fechar(ok) {
        document.removeEventListener('keydown', tecla);
        fundo.remove();
        if (anterior && anterior.focus) anterior.focus();
        resolver(ok);
      }
      function tecla(e) { if (e.key === 'Escape') fechar(false); }
      function atualizar() { if (entrada) btnOk.disabled = entrada.value.trim().toUpperCase() !== opcoes.exigir; }
      if (entrada) {
        entrada.addEventListener('input', atualizar);
        entrada.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !btnOk.disabled) fechar(true); });
      }
      btnOk.addEventListener('click', function () { fechar(true); });
      btnCancelar.addEventListener('click', function () { fechar(false); });
      fundo.addEventListener('click', function (e) { if (e.target === fundo) fechar(false); });
      document.addEventListener('keydown', tecla);
      atualizar();
      document.body.appendChild(fundo);
      (entrada || btnCancelar).focus();
    });
  }

  function excluirTodos() {
    confirmar({
      titulo: 'Excluir todos os candidatos?',
      texto: 'Esta ação apaga todos os candidatos e não pode ser desfeita.' +
        (MODO_API ? ' O histórico de versões da planilha continua guardando os dados: para eliminá-los de vez, exclua a planilha do Google Drive e esvazie a lixeira.' : ''),
      exigir: 'EXCLUIR',
      botao: 'Excluir todos'
    }).then(function (ok) { if (ok) executarExclusaoTotal(); });
  }

  function executarExclusaoTotal() {
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

  // Status como selo: aprovado verde, reprovado vermelho, em análise cinza, inválido só contorno.
  var CLASSE_STATUS = { aprovado: 'selo--verde', reprovado: 'selo--vermelho', em_analise: '', invalido: 'status--invalido' };

  function badgePerfil(r) {
    if (!r.calc) return el('span', { classe: 'badge badge--invalido', texto: 'Inválido' });
    return el('span', {
      classe: 'badge disc-' + r.calc.primario,
      title: NOMES[r.calc.primario] + ' / ' + NOMES[r.calc.secundario],
      texto: r.calc.codigo
    });
  }

  function badgeStatus(r) {
    var s = r.invalido ? 'invalido' : r.status;
    return el('span', { classe: 'status selo ' + CLASSE_STATUS[s], texto: STATUS[s] });
  }

  // Código do candidato em destaque (título, negrito, algarismos de largura fixa); "—" quando não há.
  function seloProtocolo(r, extra) {
    var p = normalizarProtocolo(r.protocolo);
    return el('span', { classe: 'protocolo' + (p ? '' : ' protocolo--vazio') + (extra ? ' ' + extra : ''),
      title: p ? 'Código do candidato' : 'Sem código (importado pelo código de resultado)' }, [
      el('span', { classe: 'protocolo__rotulo', texto: 'Código' }),
      el('span', { classe: 'protocolo__valor t-titulo negrito tabular', texto: textoProtocolo(p) })
    ]);
  }

  function letraDisc(l, extra) {
    return el('span', { classe: 'letra-disc disc-' + l + (extra ? ' ' + extra : ''), 'aria-hidden': 'true', texto: l });
  }

  function miniBarras(p) {
    var wrap = el('div', { classe: 'mini-barras', role: 'img',
      'aria-label': 'D ' + p.D + '%, I ' + p.I + '%, S ' + p.S + '%, C ' + p.C + '%' });
    LETRAS.forEach(function (l) {
      wrap.appendChild(el('div', { classe: 'mini-linha' }, [
        el('span', { classe: 'mini-letra', texto: l }),
        el('span', { classe: 'mini-trilho trilho' }, el('span', { classe: 'mini-barra disc-' + l, estilo: { width: Math.min(100, (p[l] / 40) * 100) + '%' } })),
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

  function icone(d, classe) {
    var s = svg('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', class: 'icone' + (classe ? ' ' + classe : '') });
    s.appendChild(svg('path', { d: d }));
    return s;
  }
  var ICONE_SETA = 'm6 9 6 6 6-6';
  var ICONE_CHECK = 'M20 6 9 17l-5-5';

  /* Seletor em pílula com lista própria (padrão Escolha do BI; sem <select> nativo).
     O botão gatilho guarda o valor em .value e dispara "change" ao escolher. */
  var escolhas = [];
  function criarEscolha(cfg) {
    var id = cfg.id;
    var atual = cfg.valor == null ? '' : cfg.valor;
    var aberto = false;
    var texto = el('span', { classe: 'escolha__texto', id: id + '-texto' });
    var botao = el('button', {
      type: 'button', id: id, classe: 'escolha__botao', value: atual,
      'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-controls': id + '-lista',
      'aria-labelledby': cfg.rotuloId ? cfg.rotuloId + ' ' + id + '-texto' : null,
      disabled: cfg.desabilitado || null
    }, [cfg.prefixo ? el('span', { classe: 'escolha__prefixo', texto: cfg.prefixo }) : null, texto, icone(ICONE_SETA, 'escolha__seta')]);
    var opcoes = cfg.opcoes.map(function (o, i) {
      return el('li', { role: 'option', id: id + '-op-' + i, 'data-valor': o.valor, tabindex: '-1', classe: 'escolha__opcao' }, [
        el('span', { texto: o.rotulo }), icone(ICONE_CHECK, 'escolha__check')
      ]);
    });
    var menu = el('ul', { role: 'listbox', id: id + '-lista', classe: 'escolha__menu vidro-janela', tabindex: '-1', hidden: true,
      'aria-label': cfg.rotulo }, opcoes);
    var caixa = el('div', { classe: 'escolha' + (cfg.classe ? ' ' + cfg.classe : '') }, [botao, menu]);

    function definir(v) {
      atual = v == null ? '' : String(v);
      botao.value = atual;
      cfg.opcoes.forEach(function (o, i) {
        var sel = o.valor === atual;
        opcoes[i].setAttribute('aria-selected', sel ? 'true' : 'false');
        if (sel) texto.textContent = o.rotulo;
      });
    }
    function abrir() {
      escolhas.forEach(function (e) { if (e !== api) e.fechar(); });
      aberto = true;
      menu.hidden = false;
      botao.setAttribute('aria-expanded', 'true');
      var sel = menu.querySelector('[aria-selected="true"]') || opcoes[0];
      if (sel) sel.focus();
    }
    function fechar(devolverFoco) {
      if (!aberto) return;
      aberto = false;
      menu.hidden = true;
      botao.setAttribute('aria-expanded', 'false');
      if (devolverFoco) botao.focus();
    }
    function escolher(li) {
      var v = li.getAttribute('data-valor');
      var mudou = v !== atual;
      definir(v);
      fechar(true);
      if (mudou) botao.dispatchEvent(new Event('change', { bubbles: true }));
    }
    function mover(delta, absoluto) {
      var i = opcoes.indexOf(document.activeElement);
      var n = absoluto != null ? absoluto : Math.max(0, Math.min(opcoes.length - 1, (i < 0 ? 0 : i) + delta));
      opcoes[n].focus();
    }

    botao.addEventListener('click', function () { if (aberto) fechar(false); else abrir(); });
    botao.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); abrir(); }
      else if (e.key === 'Escape' && aberto) { e.stopPropagation(); fechar(true); }
    });
    menu.addEventListener('click', function (e) {
      var li = e.target.closest ? e.target.closest('[role="option"]') : null;
      if (li) escolher(li);
    });
    menu.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); mover(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); mover(-1); }
      else if (e.key === 'Home') { e.preventDefault(); mover(0, 0); }
      else if (e.key === 'End') { e.preventDefault(); mover(0, opcoes.length - 1); }
      else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (opcoes.indexOf(document.activeElement) !== -1) escolher(document.activeElement);
      } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fechar(true); }
      else if (e.key === 'Tab') fechar(false);
    });

    var api = { caixa: caixa, botao: botao, definir: definir, fechar: fechar };
    // Remove da lista as escolhas que saíram da página (ex.: detalhe re-renderizado)
    escolhas = escolhas.filter(function (e) { return document.body.contains(e.caixa) && e.botao.id !== id; });
    escolhas.push(api);
    definir(atual);
    return api;
  }
  document.addEventListener('mousedown', function (e) {
    escolhas.forEach(function (x) { if (!x.caixa.contains(e.target)) x.fechar(false); });
  });

  // Gráfico de barras DISC em SVG (sem bibliotecas): trilho liso cinza-claro até 40%,
  // barra na cor da letra, percentual em negrito logo acima da barra, letra e total embaixo.
  function pilula(x, y, w, h) {
    var r = Math.min(w / 2, h / 2);
    return 'M' + (x + r) + ' ' + y + 'H' + (x + w - r) + 'A' + r + ' ' + r + ' 0 0 1 ' + (x + w) + ' ' + (y + r) +
      'V' + (y + h - r) + 'A' + r + ' ' + r + ' 0 0 1 ' + (x + w - r) + ' ' + (y + h) +
      'H' + (x + r) + 'A' + r + ' ' + r + ' 0 0 1 ' + x + ' ' + (y + h - r) +
      'V' + (y + r) + 'A' + r + ' ' + r + ' 0 0 1 ' + (x + r) + ' ' + y + 'Z';
  }
  function graficoDisc(calc) {
    var W = 360, H = 270, topo = 34, base = 206, larg = 56, x0 = 22;
    var gap = (W - 2 * x0 - 4 * larg) / 3;
    var maxV = 40;
    var hTotal = base - topo;
    var s = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'grafico', role: 'img',
      'aria-label': 'Gráfico DISC: D ' + calc.percentuais.D + '%, I ' + calc.percentuais.I + '%, S ' + calc.percentuais.S + '%, C ' + calc.percentuais.C + '%' });
    LETRAS.forEach(function (l, i) {
      var v = calc.percentuais[l];
      var h = Math.max(24, (Math.min(v, maxV) / maxV) * hTotal);
      var x = x0 + i * (larg + gap);
      s.appendChild(svg('path', { d: pilula(x, topo, larg, hTotal), fill: CORES.trilho, class: 'trilho-svg' }));
      s.appendChild(svg('rect', { x: x, y: base - h, width: larg, height: h, rx: Math.min(larg / 2, h / 2), fill: CORES[l], class: 'barra barra-' + l }));
      // percentual acima da barra: dentro do trilho quando sobra espaço, logo acima dele quando a barra está cheia
      var yValor = Math.max(base - h - 10, topo - 10);
      var tv = svg('text', { x: x + larg / 2, y: yValor, 'text-anchor': 'middle', class: 'valor', fill: CORES.texto });
      tv.textContent = String(v).replace('.', ',') + '%';
      s.appendChild(tv);
      var tl = svg('text', { x: x + larg / 2, y: base + 30, 'text-anchor': 'middle', class: 'letra', fill: CORES.texto });
      tl.textContent = l;
      s.appendChild(tl);
      var tt = svg('text', { x: x + larg / 2, y: base + 50, 'text-anchor': 'middle', class: 'eixo', fill: CORES.suave });
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

  function blocoPerfil(letra, papel, primario) {
    var DATA = dep('DISC_DATA');
    var p = DATA && DATA.perfis && DATA.perfis[letra];
    if (!p) return null;
    // Primário em card suave (azul bem claro), secundário em card branco: nada de bloco de cor sólida.
    return el('section', { classe: 'perfil-card caixa surgir ' + (primario ? 'caixa--suave perfil-card--primario' : 'perfil-card--secundario') + ' perfil-' + letra }, [
      el('header', { classe: 'perfil-card__topo' }, [
        letraDisc(letra, 'perfil-card__letra'),
        el('div', null, [
          el('p', { classe: 'perfil-card__papel', texto: papel }),
          el('h3', { classe: 'perfil-card__nome seminegrito', texto: p.nome })
        ])
      ]),
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
    var busca = $('filtro-busca').value;
    var perfil = $('filtro-perfil').value;
    var status = $('filtro-status').value;
    return estado.registros.filter(function (r) {
      if (perfil && (!r.calc || r.calc.primario !== perfil)) return false;
      if (status === 'invalido' && !r.invalido) return false;
      if (status && status !== 'invalido' && (r.invalido || r.status !== status)) return false;
      return correspondeBusca(r, busca);
    });
  }

  // Cartões de resumo no padrão do Início do BI: todos brancos; "Aprovados" em destaque (número em laranja).
  function renderizarResumo(animar) {
    var box = $('resumo-lista');
    limpar(box);
    var regs = estado.registros;
    var conta = function (f) { return regs.filter(f).length; };
    var cartoes = [
      { rotulo: 'Candidatos', valor: regs.length, estilo: '' },
      { rotulo: 'Aprovados', valor: conta(function (r) { return !r.invalido && r.status === 'aprovado'; }), estilo: 'caixa--destaque' },
      { rotulo: 'Em análise', valor: conta(function (r) { return !r.invalido && r.status === 'em_analise'; }), estilo: '' },
      { rotulo: 'Reprovados', valor: conta(function (r) { return !r.invalido && r.status === 'reprovado'; }), estilo: '' }
    ];
    cartoes.forEach(function (c, i) {
      box.appendChild(el('div', { classe: 'caixa caixa--compacta resumo__cartao ' + c.estilo + (animar ? ' surgir' : ''), estilo: animar ? { 'animation-delay': (i * 40) + 'ms' } : null }, [
        el('span', { classe: 'resumo__rotulo', texto: c.rotulo }),
        el('span', { classe: 'resumo__valor t-numero-grande valor-destaque', texto: String(c.valor) })
      ]));
    });
  }

  function renderizarLista() {
    var ul = $('lista-candidatos');
    limpar(ul);
    // Só anima na primeira vez: filtrar ou buscar não faz os cartões piscarem nem pularem.
    var animar = !estado.listaMostrada;
    estado.listaMostrada = true;
    renderizarResumo(animar);
    var itens = filtrados();
    var total = estado.registros.length;
    $('contagem').textContent = total === 0
      ? (MODO_API ? 'Nenhum candidato recebido ainda.' : 'Nenhum candidato importado. Use a aba "Importar códigos".')
      : itens.length + ' de ' + total + ' candidato' + (total === 1 ? '' : 's');
    itens.forEach(function (r, i) {
      var meta = [linkTelefone(r)];
      if (r.vaga) meta.push(el('span', { texto: r.vaga }));
      meta.push(el('span', { classe: 'texto-suave', texto: formatarData(r.fim || r.recebidoEm) }));
      // Função · Empresa (discreto). A idade fica só no detalhe.
      var exp = textoExperiencia(r);
      if (exp) meta.push(el('span', { classe: 'card-experiencia', texto: exp }));
      ul.appendChild(el('li', { classe: 'card caixa' + (animar ? ' surgir' : '') + (r.invalido ? ' card-invalido' : ''), estilo: animar ? { 'animation-delay': Math.min(i, 8) * 30 + 'ms' } : null }, [
        el('div', { classe: 'card-topo' }, [
          r.calc ? letraDisc(r.calc.primario, 'card-letra') : el('span', { classe: 'letra-disc card-letra card-letra--vazia', 'aria-hidden': 'true', texto: '?' }),
          el('button', { type: 'button', classe: 'card-nome', texto: r.nome || '(sem nome)',
            onclick: function () { abrirDetalhe(r.id); } }),
          seloProtocolo(r, 'card-protocolo')
        ]),
        el('div', { classe: 'card-meta' }, meta),
        r.calc ? miniBarras(r.calc.percentuais) : el('p', { classe: 'aviso aviso--erro card-aviso', texto: 'Respostas inválidas — resultado não pode ser calculado.' }),
        el('div', { classe: 'card-rodape' }, [
          el('div', { classe: 'card-selos' }, [badgePerfil(r), badgeStatus(r)]),
          el('button', { type: 'button', classe: 'botao botao--claro botao--pequeno', texto: 'Ver detalhes',
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

    // Cabeçalho no padrão do BI: título, texto suave e ações em pílula (não impressas)
    var sub = [r.vaga, formatarData(r.fim || r.recebidoEm)].filter(function (x) { return x && x !== '—'; }).join(' · ');
    art.appendChild(el('header', { classe: 'cabecalho det-cabecalho' }, [
      el('div', { classe: 'cabecalho__texto-area' }, [
        el('p', { classe: 'det-relatorio so-imprimir', texto: 'Relatório DISC' + (CONFIG.EMPRESA ? ' — ' + CONFIG.EMPRESA : '') }),
        el('p', { classe: 'sobretitulo nao-imprimir', texto: 'Processo seletivo · Candidato' }),
        el('h2', { classe: 'cabecalho__titulo t-pagina seminegrito', texto: r.nome || '(sem nome)' }),
        el('p', { classe: 'det-protocolo', id: 'det-protocolo' }, [
          el('span', { classe: 'det-protocolo__rotulo', texto: 'Código ' }),
          el('span', { classe: 'det-protocolo__valor t-indicador negrito tabular', texto: textoProtocolo(r.protocolo) })
        ]),
        sub ? el('p', { classe: 'cabecalho__texto', texto: sub }) : null
      ]),
      el('div', { classe: 'cabecalho__acoes nao-imprimir' }, [
        el('button', { type: 'button', classe: 'botao botao--claro', texto: '← Voltar', onclick: fecharDetalhe }),
        guia ? el('button', { type: 'button', classe: 'botao botao--claro', texto: 'Copiar guia', onclick: function () {
          copiarTexto(guiaComoTexto(guia, r)).then(function () { avisar('Guia copiado para a área de transferência.', 'ok'); },
            function () { avisar('Não foi possível copiar automaticamente.', 'erro'); });
        } }) : null,
        el('button', { type: 'button', classe: 'botao botao--principal', texto: 'Imprimir / salvar PDF', onclick: function () { root.print(); } })
      ])
    ]));

    // Dados do candidato
    var dados = el('section', { classe: 'caixa det-dados surgir' }, [
      el('h3', { classe: 'caixa__titulo', texto: 'Dados do candidato' }),
      el('dl', { classe: 'det-dl' }, [
        el('div', null, [el('dt', { texto: 'Telefone' }), el('dd', null, linkTelefone(r))]),
        el('div', null, [el('dt', { texto: 'Idade' }), el('dd', { id: 'det-idade', texto: textoIdade(r.idade) })]),
        el('div', null, [el('dt', { texto: 'Vaga pretendida' }), el('dd', { texto: r.vaga || '—' })]),
        el('div', null, [el('dt', { texto: 'Função atual/última' }), el('dd', { id: 'det-funcao', texto: r.funcao || '—' })]),
        el('div', null, [el('dt', { texto: 'Empresa atual/última' }), el('dd', { id: 'det-empresa', texto: r.empresa || '—' })]),
        el('div', null, [el('dt', { texto: 'Concluído em' }), el('dd', { texto: formatarData(r.fim || r.recebidoEm) })]),
        el('div', null, [el('dt', { texto: 'Duração' }), el('dd', { texto: formatarDuracao(r.duracaoSeg) })]),
        el('div', null, [el('dt', { texto: 'Perfil' }), el('dd', { classe: 'det-perfil' }, [badgePerfil(r), r.calc ? ' ' + NOMES[r.calc.primario] + ' / ' + NOMES[r.calc.secundario] : ''])]),
        el('div', null, [el('dt', { texto: 'Status' }), el('dd', { id: 'det-status-selo' }, badgeStatus(r))])
      ])
    ]);

    // Status e observações
    var escStatus = criarEscolha({
      id: 'det-status', rotulo: 'Status', rotuloId: 'det-status-rotulo', valor: r.status, desabilitado: r.invalido,
      classe: 'escolha--campo',
      opcoes: ['em_analise', 'aprovado', 'reprovado'].map(function (s) { return { valor: s, rotulo: STATUS[s] }; })
    });
    var selStatus = escStatus.botao;
    selStatus.addEventListener('change', function () {
      var novo = selStatus.value;
      atualizarCampos(r.id, { status: novo }).then(function () {
        avisar('Status atualizado para "' + STATUS[novo] + '".', 'ok');
        // Atualiza só o selo: o detalhe não é redesenhado, então nada sai do lugar.
        var selo = $('det-status-selo');
        if (selo) { limpar(selo); selo.appendChild(badgeStatus(r)); }
        renderizarLista(); renderizarComparativo();
      }).catch(function (e) { avisar(e.message, 'erro'); escStatus.definir(r.status); });
    });
    var taObs = el('textarea', { id: 'det-obs', classe: 'entrada', rows: 3, maxlength: 2000, placeholder: 'Anotações sobre a entrevista, disponibilidade…' });
    taObs.value = r.observacoes || '';
    var btnObs = el('button', { type: 'button', classe: 'botao botao--principal', texto: 'Salvar observações' });
    btnObs.addEventListener('click', function () {
      btnObs.disabled = true;
      atualizarCampos(r.id, { observacoes: taObs.value }).then(function () {
        avisar('Observações salvas.', 'ok'); obsImpressa.textContent = taObs.value;
      }).catch(function (e) { avisar(e.message, 'erro'); }).then(function () { btnObs.disabled = false; });
    });
    var btnExcluir = el('button', { type: 'button', classe: 'botao botao--perigo', texto: 'Excluir candidato' });
    btnExcluir.addEventListener('click', function () {
      confirmar({ titulo: 'Excluir este candidato?', texto: 'Os dados de ' + (r.nome || 'este candidato') + ' serão apagados definitivamente.', botao: 'Excluir candidato' }).then(function (ok) {
        if (!ok) return;
        excluirRegistro(r.id).then(function () {
          avisar('Candidato excluído.', 'ok'); fecharDetalhe(); renderizarTudo();
        }).catch(function (e) { avisar(e.message, 'erro'); });
      });
    });
    var gestao = el('section', { classe: 'caixa nao-imprimir det-gestao surgir' }, [
      el('h3', { classe: 'caixa__titulo', texto: 'Avaliação do recrutador' }),
      el('div', { classe: 'campo' }, [el('span', { classe: 'campo__rotulo', id: 'det-status-rotulo', texto: 'Status' }), escStatus.caixa]),
      el('div', { classe: 'campo' }, [el('label', { classe: 'campo__rotulo', for: 'det-obs', texto: 'Observações' }), taObs]),
      el('div', { classe: 'det-gestao__acoes' }, [btnObs, btnExcluir])
    ]);
    var obsImpressa = el('p', { classe: 'obs-impressa', texto: r.observacoes || '' });

    if (!r.calc) {
      art.appendChild(el('div', { classe: 'det-grade det-grade--simples' }, [dados, gestao]));
      art.appendChild(el('section', { classe: 'so-imprimir det-obs-impressa' }, [el('h3', { texto: 'Observações' }), obsImpressa]));
      art.appendChild(el('p', { classe: 'aviso aviso--erro', texto: 'As respostas deste candidato estão incompletas ou corrompidas; não é possível calcular o perfil.' }));
      return;
    }

    // Gráfico + lateral (dados e avaliação)
    var grafico = el('section', { classe: 'caixa det-grafico surgir' }, [
      el('header', { classe: 'det-grafico__topo' }, [
        el('h3', { classe: 'caixa__titulo', texto: 'Resultado DISC' }),
        badgePerfil(r)
      ]),
      graficoDisc(r.calc),
      el('p', { classe: 'legenda', texto: 'D = Dominância · I = Influência · S = Estabilidade · C = Conformidade. Cada letra varia de 10% a 40%; a soma é 100%.' })
    ]);
    art.appendChild(el('div', { classe: 'det-grade' }, [grafico, el('div', { classe: 'det-lado' }, [dados, gestao])]));
    art.appendChild(el('section', { classe: 'so-imprimir det-obs-impressa' }, [el('h3', { texto: 'Observações' }), obsImpressa]));

    // Características: primário em card suave, secundário em card branco
    art.appendChild(el('div', { classe: 'det-perfis' }, [
      blocoPerfil(r.calc.primario, 'Perfil primário', true),
      blocoPerfil(r.calc.secundario, 'Perfil secundário', false)
    ]));

    // Guia: resumo em card de vidro (o único da tela), seções num card branco amplo
    if (guia) {
      art.appendChild(el('section', { classe: 'guia' }, [
        el('div', { classe: 'caixa caixa--vidro guia-topo surgir' }, [
          el('p', { classe: 'sobretitulo', texto: 'Para quem vai liderar' }),
          el('h3', { classe: 'guia-titulo seminegrito', texto: guia.titulo || 'Guia para a Liderança' }),
          guia.resumo ? el('p', { classe: 'guia-resumo', texto: guia.resumo }) : null
        ]),
        el('div', { classe: 'caixa caixa--ampla guia-corpo surgir' }, [
          el('div', { classe: 'guia-secoes' }, (guia.secoes || []).map(function (s, i) {
            return el('div', { classe: 'guia-secao' }, [
              el('h4', null, [el('span', { classe: 'guia-num', 'aria-hidden': 'true', texto: String(i + 1) }), el('span', { texto: s.titulo || '' })]),
              el('ul', null, (s.itens || []).map(function (it) { return el('li', { texto: it }); }))
            ]);
          }))
        ])
      ]));
    } else {
      art.appendChild(el('p', { classe: 'aviso', texto: 'Guia para a Liderança indisponível (módulo lideranca.js não carregado).' }));
    }
  }

  /* ---------- Comparativo ---------- */

  // Cartões empilhados (padrão do BI): 1º em azul suave com o número em laranja, demais brancos com contorno.
  function cartoesEmpilhados(itens) {
    return el('ol', { classe: 'empilhados' }, itens.map(function (it, i) {
      return el('li', { classe: 'empilhado' + (i === 0 ? ' empilhado--primeiro' : '') + (i === itens.length - 1 ? ' empilhado--ultimo' : ''), estilo: { 'z-index': String(i + 1) } }, [
        it.sigla,
        el('div', { classe: 'empilhado__meio' }, [
          it.titulo,
          el('span', { classe: 'empilhado__sub', texto: it.sub })
        ]),
        el('div', { classe: 'empilhado__direita' }, [
          el('span', { classe: 'empilhado__valor', texto: it.direita }),
          it.subDireita ? el('span', { classe: 'empilhado__sub', texto: it.subDireita }) : null
        ])
      ]);
    }));
  }

  function renderizarComparativo() {
    var box = $('vista-comparativo');
    limpar(box);
    var aprovados = estado.registros.filter(function (r) { return !r.invalido && r.status === 'aprovado'; });
    var res = resumoEquipe(aprovados);
    var cab = el('div', { classe: 'cabecalho__texto-area' }, [
      el('p', { classe: 'sobretitulo', texto: 'Processo seletivo' }),
      el('h2', { classe: 'cabecalho__titulo t-pagina seminegrito', texto: 'Comparativo dos aprovados' })
    ]);
    box.appendChild(el('div', { classe: 'cabecalho' }, cab));
    if (!res.total) {
      box.appendChild(el('div', { classe: 'caixa vazio surgir' }, [
        el('p', { classe: 'vazio__texto', texto: 'Nenhum candidato aprovado ainda. Marque candidatos como "Aprovado" no detalhe para ver o comparativo da equipe.' })
      ]));
      return;
    }
    cab.appendChild(el('p', { classe: 'cabecalho__texto', texto: res.total + ' aprovado' + (res.total === 1 ? '' : 's') + '.' }));

    // Distribuição por perfil primário, do mais frequente ao menos frequente
    var ordem = LETRAS.slice().sort(function (a, b) { return res.primarios[b] - res.primarios[a] || LETRAS.indexOf(a) - LETRAS.indexOf(b); });
    var distrib = el('section', { classe: 'caixa comp-distrib surgir' }, [
      el('h3', { classe: 'caixa__titulo', texto: 'Distribuição por perfil primário' }),
      cartoesEmpilhados(ordem.map(function (l) {
        var pct = Math.round((res.primarios[l] / res.total) * 100);
        return {
          sigla: letraDisc(l, 'empilhado__sigla'),
          titulo: el('span', { classe: 'empilhado__titulo', texto: NOMES[l] }),
          sub: 'média ' + String(res.media[l]).replace('.', ',') + '%',
          direita: String(res.primarios[l]),
          subDireita: pct + '% da equipe'
        };
      }))
    ]);

    // Média da equipe em barras (trilho liso até 40%)
    var medias = el('section', { classe: 'caixa comp-medias surgir' }, [
      el('h3', { classe: 'caixa__titulo', texto: 'Média da equipe' }),
      el('div', { classe: 'barras-media', role: 'img', 'aria-label': 'Média da equipe: ' + LETRAS.map(function (l) { return l + ' ' + res.media[l] + '%'; }).join(', ') },
        LETRAS.map(function (l) {
          return el('div', { classe: 'barra-media' }, [
            letraDisc(l, 'barra-media__letra'),
            el('span', { classe: 'barra-media__trilho trilho' }, el('span', { classe: 'barra-media__cheia disc-' + l, estilo: { width: Math.max(8, Math.min(100, (res.media[l] / 40) * 100)) + '%' } })),
            el('span', { classe: 'barra-media__valor', texto: String(res.media[l]).replace('.', ',') + '%' })
          ]);
        }))
    ]);
    box.appendChild(el('div', { classe: 'comp-grade' }, [distrib, medias]));

    var codigos = Object.keys(res.codigos).sort(function (a, b) { return res.codigos[b] - res.codigos[a]; });
    var faltando = LETRAS.filter(function (l) { return res.primarios[l] === 0; });
    box.appendChild(el('div', { classe: 'comp-grade' }, [
      el('section', { classe: 'caixa surgir' }, [
        el('h3', { classe: 'caixa__titulo', texto: 'Combinações de perfil' }),
        el('ul', { classe: 'lista-codigos' }, codigos.map(function (c) {
          return el('li', null, [el('span', { classe: 'badge disc-' + c[0], texto: c }), el('span', { classe: 'texto-medio', texto: ' × ' + res.codigos[c] })]);
        }))
      ]),
      faltando.length ? el('p', { classe: 'aviso dica surgir', texto: 'Perfis ausentes entre os aprovados: ' + faltando.map(function (l) { return l + ' (' + NOMES[l] + ')'; }).join(', ') + '. Uma equipe equilibrada costuma se beneficiar da diversidade de estilos.' }) : null
    ]));

    box.appendChild(el('section', { classe: 'caixa surgir' }, [
      el('h3', { classe: 'caixa__titulo', texto: 'Aprovados' }),
      el('ul', { classe: 'lista-simples' }, aprovados.map(function (r) {
        return el('li', null, [
          r.calc ? letraDisc(r.calc.primario) : null,
          el('button', { type: 'button', classe: 'link-botao', texto: r.nome || '(sem nome)', onclick: function () { abrirDetalhe(r.id); } }),
          badgePerfil(r)
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
    if (!codigos.length) { out.appendChild(el('p', { classe: 'aviso aviso--erro', texto: 'Cole pelo menos um código.' })); return; }
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
      out.appendChild(el('p', { classe: novos ? 'aviso aviso--ok' : 'aviso',
        texto: novos + ' importado' + (novos === 1 ? '' : 's') + (duplicados ? ', ' + duplicados + ' já existia' + (duplicados === 1 ? '' : 'm') : '') + '.' }));
      if (erros.length) out.appendChild(el('ul', { classe: 'aviso aviso--erro lista-erros' }, erros.map(function (e) { return el('li', { texto: e }); })));
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
      ['v', 'id', 'nome', 'telefone', 'idade', 'funcao', 'empresa', 'vaga', 'consentimento', 'inicio', 'fim', 'duracaoSeg', 'respostas'].forEach(function (k) {
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
    var SIMULADA = String(CONFIG.API_URL || '').trim() === 'simulada';
    $('modo-indicador').textContent = SIMULADA ? 'Prévia (dados de demonstração)' : (MODO_API ? 'Conectado à planilha' : 'Modo local (importar códigos)');
    $('dica-previa').hidden = !SIMULADA;
    $('aba-importar').hidden = false;
    if (MODO_API) $('destino-importacao').textContent = 'Os resultados são enviados para a planilha, como se o candidato tivesse enviado.';

    Array.prototype.forEach.call(document.querySelectorAll('.aba'), function (b) {
      b.addEventListener('click', function () { mostrarAba(b.getAttribute('data-aba')); });
    });
    var caixaEscolhas = $('filtros-escolhas');
    caixaEscolhas.appendChild(criarEscolha({
      id: 'filtro-perfil', rotulo: 'Perfil primário', prefixo: 'Perfil', valor: '',
      opcoes: [{ valor: '', rotulo: 'Todos' }].concat(LETRAS.map(function (l) { return { valor: l, rotulo: l + ' — ' + NOMES[l] }; }))
    }).caixa);
    caixaEscolhas.appendChild(criarEscolha({
      id: 'filtro-status', rotulo: 'Status', prefixo: 'Status', valor: '',
      opcoes: [{ valor: '', rotulo: 'Todos' }].concat(['em_analise', 'aprovado', 'reprovado', 'invalido'].map(function (s) { return { valor: s, rotulo: STATUS[s] }; }))
    }).caixa);
    // Busca: só 'input'. Um 'change' na busca dispara no blur (ao tocar em "Ver detalhes") e recriaria
    // a lista no meio do clique, que então se perde no botão já removido.
    $('filtro-busca').addEventListener('input', renderizarLista);
    ['filtro-perfil', 'filtro-status'].forEach(function (id) {
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
