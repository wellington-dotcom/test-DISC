/*
 * Painel — participantes, filtros, detalhe com confiabilidade, Guia para a Liderança, comparativo, CSV,
 * e (admin) avaliações, empresas e usuários.
 * Segurança: todo dado do participante entra no DOM via textContent / setAttribute (nunca innerHTML).
 * Modo com API (CONFIG.API_URL preenchido): login por e-mail e senha; o token da sessão fica no sessionStorage
 *   e vai explícito em cada chamada do DISC_API. Papéis: 'admin' (tudo) e 'gestor' (só a própria empresa:
 *   participantes e comparativo; muda status e observações; não exclui nem cria).
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
  var PAPEIS = { admin: 'Administrador', gestor: 'Gestor' };
  var TIPOS = { selecao: 'Processo seletivo', equipe: 'Avaliação de equipe' };
  var NIVEIS_CONF = { alta: 'Alta', media: 'Média', baixa: 'Baixa', indisponivel: 'Sem dados' };
  var CLASSE_CONF = { alta: 'selo--verde', media: '', baixa: 'selo--vermelho' };
  var AVISO_GUIA_BAIXA = 'Atenção: a confiabilidade deste resultado é baixa. Use o guia com cautela e confirme em entrevista.';
  var ALFABETO_SENHA = 'abcdefghjkmnpqrstuvwxyz23456789'; // sem l, i, o, 0 e 1: fácil de ditar
  var CHAVE_TOKEN = 'disc_admin_token';
  var CHAVE_USUARIO = 'disc_admin_usuario';
  var CHAVE_LOCAL = 'disc_admin_registros';

  function dep(nome) {
    if (typeof root[nome] !== 'undefined') return root[nome];
    if (typeof require === 'function') {
      try {
        var mapa = {
          DISC_SCORING: './scoring.js', DISC_DATA: './disc-data.js',
          DISC_CONFIABILIDADE: './confiabilidade.js', DISC_VALIDACAO: './validacao.js'
        };
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

  // Código do participante (protocolo) gerado pelo servidor: "47K". Aceita minúsculas e espaços; '' se inválido.
  function normalizarProtocolo(v) {
    if (v == null) return '';
    var s = String(v).replace(/\s+/g, '').toUpperCase();
    return /^[0-9]{2}[A-HJ-NP-Z]$/.test(s) ? s : '';
  }

  // Texto exibido: o código, ou "—" para quem não tem (importado por código longo, envio antigo).
  function textoProtocolo(v) { return normalizarProtocolo(v) || '—'; }

  // Idade (só no detalhe do participante — nunca na lista, nos resumos ou em filtros: evita discriminação
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

  // "Recepcionista 2026 · Clínica Exemplo" (avaliação e empresa); "Link geral" para quem respondeu sem código.
  function textoOrigem(r) {
    if (!r) return '';
    var av = r.avaliacaoNome ? String(r.avaliacaoNome) : (r.avaliacao ? 'Avaliação ' + r.avaliacao : 'Link geral');
    return [av, r.empresaNome ? String(r.empresaNome) : ''].filter(Boolean).join(' · ');
  }

  // Busca da lista: nome/vaga/função/empresa/avaliação (texto), telefone (3+ dígitos) ou protocolo
  // (ignora maiúsculas e espaços). A idade NÃO entra na busca.
  function correspondeBusca(r, busca) {
    var termo = String(busca == null ? '' : busca).trim().toLowerCase();
    if (!termo) return true;
    var alvo = [r.nome, r.vaga, r.funcao, r.empresa, r.avaliacaoNome, r.empresaNome]
      .map(function (x) { return String(x == null ? '' : x); }).join(' ').toLowerCase();
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

  // Objeto da etapa de validação: aceita objeto ou texto JSON (códigos importados guardam como texto).
  function lerValidacao(v) {
    if (typeof v === 'string' && v) { try { v = JSON.parse(v); } catch (e) { return null; } }
    return (v && typeof v === 'object' && !Array.isArray(v)) ? v : null;
  }

  // Confiabilidade calculada no painel (como o perfil), nunca enviada pelo participante.
  function confiabilidade(respostas, validacao) {
    var CF = dep('DISC_CONFIABILIDADE');
    if (!CF || typeof CF.avaliar !== 'function') return null;
    try { return CF.avaliar(respostas, lerValidacao(validacao)); } catch (e) { return null; }
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
    r.conf = confiabilidade(r.respostas, r.validacao);
    return r;
  }

  // Selo do card: Alta verde, Média cinza, Baixa vermelho; sem dados = sem selo (null).
  function seloConfiabilidade(conf) {
    if (!conf || !Object.prototype.hasOwnProperty.call(CLASSE_CONF, conf.nivel)) return null;
    return { texto: 'Confiabilidade ' + NIVEIS_CONF[conf.nivel].toLowerCase(), classe: CLASSE_CONF[conf.nivel], nivel: conf.nivel };
  }

  // Abas que cada papel vê. Sem API (modo local) não há login: lista, comparativo e importação.
  function abasDoPapel(papel, modoApi) {
    if (!modoApi) return ['lista', 'comparativo', 'importar'];
    if (papel === 'admin') return ['lista', 'avaliacoes', 'empresas', 'usuarios', 'comparativo', 'importar'];
    if (papel === 'gestor') return ['lista', 'comparativo'];
    return [];
  }

  // O que cada papel pode fazer na tela (o servidor confere de novo).
  function permissoes(papel, modoApi) {
    var admin = !modoApi || papel === 'admin';
    return {
      excluir: admin,
      importar: admin,
      criar: !!modoApi && papel === 'admin',
      filtrarEmpresa: !!modoApi && papel === 'admin',
      statusObservacoes: !modoApi || papel === 'admin' || papel === 'gestor'
    };
  }

  // Senha temporária de 10 caracteres fáceis de ditar (sem l, i, o, 0, 1).
  function gerarSenhaTemporaria(rnd) {
    var n = ALFABETO_SENHA.length;
    var out = '';
    var bytes = null;
    if (typeof rnd !== 'function') {
      try {
        var cr = root.crypto || (typeof globalThis !== 'undefined' ? globalThis.crypto : null);
        if (cr && cr.getRandomValues) { bytes = new Uint32Array(10); cr.getRandomValues(bytes); }
      } catch (e) { bytes = null; }
    }
    for (var i = 0; i < 10; i++) {
      var k = bytes ? bytes[i] % n : Math.min(n - 1, Math.floor((typeof rnd === 'function' ? rnd() : Math.random()) * n));
      out += ALFABETO_SENHA.charAt(k);
    }
    return out;
  }

  // Link pronto da avaliação: pasta da página atual + index.html?a=CODIGO.
  function linkAvaliacao(href, codigo) {
    var base = String(href || '').split('#')[0].split('?')[0].replace(/[^/]*$/, '');
    return base + 'index.html?a=' + encodeURIComponent(String(codigo || ''));
  }

  // Texto para colar no WhatsApp.
  function mensagemConvite(av, link) {
    var empresa = av && av.empresaNome ? String(av.empresaNome) : '';
    var nome = av && av.nome ? String(av.nome) : '';
    if (av && av.tipo === 'equipe') {
      return 'Olá! ' + (empresa ? 'A ' + empresa + ' está' : 'Estamos') + ' fazendo uma avaliação de perfil da equipe' +
        (nome ? ' (' + nome + ')' : '') + '. Responda pelo link abaixo:\n' + link +
        '\n\nLeva cerca de 10 minutos e não existe resposta certa ou errada. Faça com calma, num lugar tranquilo.';
    }
    return 'Olá! Para seguir no processo seletivo' + (nome ? ' de ' + nome : '') + (empresa ? ' da ' + empresa : '') +
      ', responda o questionário de perfil pelo link abaixo:\n' + link +
      '\n\nLeva cerca de 10 minutos e não existe resposta certa ou errada. Faça com calma, num lugar tranquilo.';
  }

  // Respostas da etapa de confirmação, prontas para o recrutador ler (aqui pode nomear os perfis).
  function resumoValidacao(validacao, calc) {
    var v = lerValidacao(validacao);
    if (!v || !calc || !calc.totais) return null;
    var VAL = dep('DISC_VALIDACAO');
    var escala = (VAL && VAL.ESCALA) || ['Discordo totalmente', 'Discordo', 'Em parte', 'Concordo', 'Concordo totalmente'];
    var pares = Array.isArray(v.pares) ? v.pares.slice(0, 3) : [];
    var escolhas = Array.isArray(v.escolhas) ? v.escolhas : [];
    var retratos = [];
    pares.forEach(function (p, i) {
      if (!Array.isArray(p) || LETRAS.indexOf(p[0]) < 0 || LETRAS.indexOf(p[1]) < 0) return;
      var esc = escolhas[i];
      var valida = esc === p[0] || esc === p[1];
      var outra = esc === p[0] ? p[1] : p[0];
      retratos.push({
        opcoes: [p[0], p[1]],
        escolha: valida ? esc : '',
        outra: valida ? outra : '',
        acertou: valida && calc.totais[esc] >= calc.totais[outra]
      });
    });
    function textoDe(id, letra) {
      var a = VAL && VAL.afirmacoes && VAL.afirmacoes[letra];
      if (!a) return '';
      var todas = (a.forcas || []).concat(a.sombras || []);
      for (var i = 0; i < todas.length; i++) if (todas[i].id === id) return todas[i].texto;
      return '';
    }
    var ROTULO = {
      forca: function (l) { return l === calc.primario ? 'Ponto forte do traço principal' : 'Ponto forte do 2º traço'; },
      sombra: function () { return 'Excesso do ponto forte principal'; },
      contraste: function () { return 'Traço mais baixo (contraste)'; }
    };
    var ESPERADO = {
      forca: 'O esperado é concordar.',
      sombra: 'Concordar mostra autoconhecimento; negar tudo pode ser só o lado bom.',
      contraste: 'O esperado é discordar ou ficar em parte.'
    };
    var frases = (Array.isArray(v.itens) ? v.itens : []).filter(function (it) {
      return it && LETRAS.indexOf(it.letra) >= 0 && ROTULO[it.tipo];
    }).map(function (it) {
      var n = Number(it.nota);
      var ok = n >= 1 && n <= 5 && Math.floor(n) === n;
      return {
        id: String(it.id || ''), letra: it.letra, tipo: it.tipo,
        texto: textoDe(it.id, it.letra) || '(frase não encontrada)',
        rotulo: ROTULO[it.tipo](it.letra) + ' — ' + it.letra + ' ' + NOMES[it.letra],
        nota: ok ? n : null,
        notaTexto: ok ? escala[n - 1] + ' (' + n + '/5)' : 'Sem resposta',
        esperado: ESPERADO[it.tipo]
      };
    });
    return { retratos: retratos, frases: frases, demonstracao: v.demonstracao === true };
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
    var cab = ['id', 'protocolo', 'nome', 'telefone', 'vaga', 'idade', 'funcao', 'empresa', 'data', 'duração', 'D %', 'I %', 'S %', 'C %', 'perfil', 'status', 'observações',
      'avaliação', 'empresa da avaliação', 'confiabilidade'];
    var linhas = [cab.map(celulaCsv).join(';')];
    registros.forEach(function (r) {
      var p = r.calc ? r.calc.percentuais : {};
      function num(l) { return r.calc ? String(p[l]).replace('.', ',') : ''; }
      var conf = r.conf && NIVEIS_CONF[r.conf.nivel] ? NIVEIS_CONF[r.conf.nivel] : '';
      linhas.push([
        r.id, textoProtocolo(r.protocolo), r.nome, formatarTelefone(r.telefone), r.vaga || '',
        textoIdade(r.idade) === '—' ? '' : String(r.idade), r.funcao || '', r.empresa || '',
        formatarData(r.fim || r.recebidoEm), formatarDuracao(r.duracaoSeg),
        num('D'), num('I'), num('S'), num('C'),
        r.calc ? r.calc.codigo : 'inválido',
        r.invalido ? STATUS.invalido : STATUS[r.status],
        r.observacoes || '',
        r.avaliacaoNome || r.avaliacao || '', r.empresaNome || '', conf
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
      out.push('Participante: ' + (registro.nome || '') + ' — ' + formatarTelefone(registro.telefone) +
        (normalizarProtocolo(registro.protocolo) ? ' — Código ' + normalizarProtocolo(registro.protocolo) : ''));
      if (registro.calc) out.push('Perfil: ' + registro.calc.codigo + ' (D ' + registro.calc.percentuais.D + '% · I ' + registro.calc.percentuais.I + '% · S ' + registro.calc.percentuais.S + '% · C ' + registro.calc.percentuais.C + '%)');
      if (registro.conf && registro.conf.nivel === 'baixa') out.push(AVISO_GUIA_BAIXA);
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
    textoOrigem: textoOrigem,
    correspondeBusca: correspondeBusca,
    recalcular: recalcular,
    lerValidacao: lerValidacao,
    seloConfiabilidade: seloConfiabilidade,
    abasDoPapel: abasDoPapel,
    permissoes: permissoes,
    gerarSenhaTemporaria: gerarSenhaTemporaria,
    linkAvaliacao: linkAvaliacao,
    mensagemConvite: mensagemConvite,
    resumoValidacao: resumoValidacao,
    extrairCodigos: extrairCodigos,
    validarImportado: validarImportado,
    gerarCsv: gerarCsv,
    resumoEquipe: resumoEquipe,
    guiaComoTexto: guiaComoTexto,
    AVISO_GUIA_BAIXA: AVISO_GUIA_BAIXA,
    CORES: CORES
  };

  if (typeof module !== 'undefined' && module.exports) { module.exports = util; return; }
  root.DISC_ADMIN = util;
  if (typeof document === 'undefined') return;

  /* ---------- Navegador ---------- */

  var CONFIG = root.CONFIG || { API_URL: '', EMPRESA: '' };
  var MODO_API = !!(CONFIG.API_URL && String(CONFIG.API_URL).trim());
  var SIMULADA = String(CONFIG.API_URL || '').trim() === 'simulada';
  var estado = {
    token: '', usuario: null,
    registros: [], avaliacoes: [], empresas: [], usuarios: [],
    abertoId: null, aba: 'lista', listaMostrada: false,
    filtros: { empresa: '', avaliacao: '', perfil: '', status: '' }
  };

  function $(id) { return document.getElementById(id); }
  function papel() { return estado.usuario ? estado.usuario.papel : ''; }
  function pode(acao) { return !!permissoes(papel(), MODO_API)[acao]; }

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

  // Erro de chamada: sessão expirada já levou ao login; o resto vira aviso.
  function falhou(e) {
    if (e && e.tratado) return;
    avisar((e && e.message) || 'Algo deu errado. Tente de novo.', 'erro');
  }

  // Chamada autenticada: o token vai como primeiro argumento. Sessão expirada -> volta ao login.
  function api(metodo) {
    var args = [estado.token].concat(Array.prototype.slice.call(arguments, 1));
    var fn = root.DISC_API && root.DISC_API[metodo];
    if (typeof fn !== 'function') return Promise.reject(new Error('Função indisponível: ' + metodo));
    return Promise.resolve().then(function () { return fn.apply(root.DISC_API, args); }).then(function (resp) {
      if (!resp || resp.ok !== true) {
        var e = new Error((resp && resp.erro) || 'O servidor recusou a solicitação.');
        e.sessaoExpirada = !!(resp && resp.sessaoExpirada);
        throw e;
      }
      return resp;
    }).catch(function (e) {
      if (e && e.sessaoExpirada) { sessaoExpirou(); e.tratado = true; }
      throw e;
    });
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
      for (var k in r) if (k !== 'calc' && k !== 'invalido' && k !== 'conf' && Object.prototype.hasOwnProperty.call(r, k)) c[k] = r[k];
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
      montarFiltros();
      renderizarTudo();
      return Promise.resolve();
    }
    $('contagem').textContent = 'Carregando…';
    var admin = papel() === 'admin';
    return Promise.all([
      api('listar'),
      api('listarAvaliacoes'),
      admin ? api('listarEmpresas') : null,
      admin ? api('listarUsuarios') : null
    ]).then(function (rs) {
      estado.registros = ordenar((rs[0].itens || []).map(recalcular));
      estado.avaliacoes = rs[1].avaliacoes || [];
      estado.empresas = rs[2] ? (rs[2].empresas || []) : [];
      estado.usuarios = rs[3] ? (rs[3].usuarios || []) : [];
      montarFiltros();
      renderizarTudo();
    }).catch(function (e) {
      $('contagem').textContent = '';
      falhou(e);
    });
  }

  function acharRegistro(id) {
    for (var i = 0; i < estado.registros.length; i++) if (estado.registros[i].id === id) return estado.registros[i];
    return null;
  }

  function atualizarCampos(id, campos) {
    var r = acharRegistro(id);
    if (!r) return Promise.reject(new Error('Participante não encontrado.'));
    if (!MODO_API) {
      for (var k in campos) r[k] = campos[k];
      salvarLocais();
      return Promise.resolve();
    }
    return api('atualizar', id, campos).then(function () {
      for (var k in campos) r[k] = campos[k];
    });
  }

  function excluirRegistro(id) {
    var p = MODO_API ? api('excluir', id) : Promise.resolve();
    return p.then(function () {
      estado.registros = estado.registros.filter(function (r) { return r.id !== id; });
      if (!MODO_API) salvarLocais();
    });
  }

  /* ---------- Janelas na própria página (sem prompt/confirm do navegador) ---------- */

  // Confirmação. opcoes: { titulo, texto, exigir (texto que precisa ser digitado), botao, extra (nó) } -> Promise<boolean>
  function confirmar(opcoes) {
    return new Promise(function (resolver) {
      var anterior = document.activeElement;
      var entrada = opcoes.exigir ? el('input', { classe: 'entrada', id: 'confirmar-texto', autocomplete: 'off', 'aria-label': 'Digite ' + opcoes.exigir + ' para confirmar' }) : null;
      var btnOk = el('button', { type: 'button', classe: 'botao botao--perigo', id: 'confirmar-ok', texto: opcoes.botao || 'Excluir' });
      var btnCancelar = el('button', { type: 'button', classe: 'botao botao--claro', id: 'confirmar-cancelar', texto: 'Cancelar' });
      var caixa = el('div', { classe: 'caixa caixa--ampla vidro-janela confirmar__caixa surgir', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'confirmar-titulo', 'aria-describedby': 'confirmar-desc' }, [
        el('h2', { id: 'confirmar-titulo', classe: 'confirmar__titulo', texto: opcoes.titulo }),
        el('p', { id: 'confirmar-desc', classe: 'texto-medio t-corpo', texto: opcoes.texto }),
        opcoes.extra || null,
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
      function tecla(e) { if (e.key === 'Escape' && !e.defaultPrevented) fechar(false); }
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

  // Janela de formulário (quase opaca). opcoes: { id, titulo, texto?, corpo: [nós], botao, aoConfirmar() -> Promise|valor }
  // Erro do aoConfirmar aparece dentro da janela, sem fechar.
  function abrirJanela(opcoes) {
    var anterior = document.activeElement;
    var erro = el('p', { classe: 'campo__erro janela__erro', id: 'janela-erro', role: 'alert' });
    var btnOk = el('button', { type: 'submit', classe: 'botao botao--principal', id: 'janela-ok', texto: opcoes.botao || 'Salvar' });
    var btnCancelar = el('button', { type: 'button', classe: 'botao botao--claro', id: 'janela-cancelar', texto: 'Cancelar' });
    var form = el('form', { classe: 'caixa caixa--ampla vidro-janela janela__caixa surgir', id: opcoes.id || null, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'janela-titulo', novalidate: true }, [
      el('h2', { id: 'janela-titulo', classe: 'confirmar__titulo', texto: opcoes.titulo }),
      opcoes.texto ? el('p', { classe: 'texto-medio t-corpo', texto: opcoes.texto }) : null,
      el('div', { classe: 'janela__corpo' }, opcoes.corpo || []),
      erro,
      el('div', { classe: 'confirmar__acoes' }, [btnCancelar, btnOk])
    ]);
    var fundo = el('div', { classe: 'confirmar janela', id: 'janela' }, form);
    var aberta = true;
    function fechar() {
      if (!aberta) return;
      aberta = false;
      document.removeEventListener('keydown', tecla);
      fundo.remove();
      if (anterior && anterior.focus && document.body.contains(anterior)) anterior.focus();
    }
    function tecla(e) { if (e.key === 'Escape' && !e.defaultPrevented) fechar(); }
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      erro.textContent = '';
      btnOk.disabled = true;
      Promise.resolve().then(opcoes.aoConfirmar).then(function () { fechar(); }, function (e2) {
        if (e2 && e2.tratado) { fechar(); return; }
        erro.textContent = (e2 && e2.message) || 'Não foi possível salvar.';
      }).then(function () { btnOk.disabled = false; });
    });
    btnCancelar.addEventListener('click', fechar);
    fundo.addEventListener('mousedown', function (e) { if (e.target === fundo) fechar(); });
    document.addEventListener('keydown', tecla);
    document.body.appendChild(fundo);
    var primeiro = form.querySelector('input:not([type="checkbox"]), .escolha__botao, button');
    if (primeiro) primeiro.focus();
    return { fechar: fechar, form: form };
  }

  function campoTexto(id, rotulo, attrs) {
    var a = { id: id, classe: 'entrada', type: 'text', autocomplete: 'off' };
    for (var k in attrs || {}) a[k] = attrs[k];
    return el('label', { classe: 'campo', for: id }, [el('span', { classe: 'campo__rotulo', texto: rotulo }), el('input', a)]);
  }
  function campoMarcar(id, rotulo, marcado) {
    return el('label', { classe: 'marcar', for: id }, [el('input', { type: 'checkbox', id: id, checked: marcado ? true : null }), el('span', { texto: rotulo })]);
  }
  function campoEscolha(rotulo, esc, rotuloId) {
    return el('div', { classe: 'campo' }, [el('span', { classe: 'campo__rotulo', id: rotuloId, texto: rotulo }), esc.caixa]);
  }

  function excluirTodos() {
    var escAv = null;
    if (MODO_API) {
      var comResp = estado.avaliacoes.filter(function (a) { return a.respostas || estado.registros.some(function (r) { return r.avaliacao === a.codigo; }); });
      var inicial = comResp.some(function (a) { return a.codigo === estado.filtros.avaliacao; }) ? estado.filtros.avaliacao : '';
      escAv = criarEscolha({
        id: 'excluir-avaliacao', rotulo: 'Quais respostas', rotuloId: 'excluir-avaliacao-rotulo', valor: inicial, classe: 'escolha--campo escolha--larga',
        opcoes: [{ valor: '', rotulo: 'Todas as respostas' }].concat(comResp.map(function (a) { return { valor: a.codigo, rotulo: a.nome + ' (' + a.codigo + ')' }; }))
      });
    }
    confirmar({
      titulo: MODO_API ? 'Excluir respostas?' : 'Excluir todos os participantes?',
      texto: MODO_API
        ? 'Escolha a avaliação. As respostas dela são apagadas e não podem ser recuperadas. O histórico de versões da planilha continua guardando os dados: para eliminá-los de vez, exclua a planilha do Google Drive e esvazie a lixeira.'
        : 'Esta ação apaga todos os participantes deste navegador e não pode ser desfeita.',
      extra: escAv ? campoEscolha('Quais respostas', escAv, 'excluir-avaliacao-rotulo') : null,
      exigir: 'EXCLUIR',
      botao: 'Excluir'
    }).then(function (ok) { if (ok) executarExclusaoTotal(escAv ? escAv.botao.value : ''); });
  }

  function executarExclusaoTotal(avaliacao) {
    if (MODO_API) {
      api('excluirTodos', avaliacao || undefined).then(function () {
        fecharDetalhe();
        avisar(avaliacao ? 'Respostas da avaliação ' + avaliacao + ' excluídas.' : 'Todas as respostas foram excluídas.', 'ok');
        return carregar();
      }).catch(falhou);
      return;
    }
    estado.registros = [];
    salvarLocais();
    fecharDetalhe();
    renderizarTudo();
    avisar('Todos os participantes foram excluídos.', 'ok');
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

  function badgeConfiabilidade(r) {
    var s = seloConfiabilidade(r.conf);
    if (!s) return null;
    return el('span', { classe: 'selo conf-selo ' + s.classe, 'data-nivel': s.nivel, title: 'Confiabilidade do resultado', texto: s.texto });
  }

  // Código do participante em destaque (título, negrito, algarismos de largura fixa); "—" quando não há.
  function seloProtocolo(r, extra) {
    var p = normalizarProtocolo(r.protocolo);
    return el('span', { classe: 'protocolo' + (p ? '' : ' protocolo--vazio') + (extra ? ' ' + extra : ''),
      title: p ? 'Código do participante' : 'Sem código (importado pelo código de resultado)' }, [
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
      'aria-label': 'Abrir WhatsApp de ' + (r.nome || 'participante') + ': ' + txt, texto: txt });
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
      'aria-label': cfg.rotuloId ? null : cfg.rotulo,
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
      escolhas.forEach(function (e) { if (e !== api2) e.fechar(); });
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
      if (opcoes[n]) opcoes[n].focus();
    }

    botao.addEventListener('click', function () { if (aberto) fechar(false); else abrir(); });
    botao.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); abrir(); }
      else if (e.key === 'Escape' && aberto) { e.preventDefault(); e.stopPropagation(); fechar(true); }
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

    var api2 = { caixa: caixa, botao: botao, definir: definir, fechar: fechar };
    // Uma entrada por id: a escolha recriada (detalhe, filtros, janelas) substitui a antiga.
    escolhas = escolhas.filter(function (e) { return e.botao.id !== id; });
    escolhas.push(api2);
    definir(atual);
    return api2;
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

  function blocoPerfil(letra, papelTxt, primario) {
    var DATA = dep('DISC_DATA');
    var p = DATA && DATA.perfis && DATA.perfis[letra];
    if (!p) return null;
    // Primário em card suave (azul bem claro), secundário em card branco: nada de bloco de cor sólida.
    return el('section', { classe: 'perfil-card caixa surgir ' + (primario ? 'caixa--suave perfil-card--primario' : 'perfil-card--secundario') + ' perfil-' + letra }, [
      el('header', { classe: 'perfil-card__topo' }, [
        letraDisc(letra, 'perfil-card__letra'),
        el('div', null, [
          el('p', { classe: 'perfil-card__papel', texto: papelTxt }),
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

  /* ---------- Filtros ---------- */

  function montarFiltros() {
    var box = $('filtros-escolhas');
    limpar(box);
    var defs = [];
    var temGeral = estado.registros.some(function (r) { return !r.avaliacao; });
    if (pode('filtrarEmpresa')) {
      defs.push({ id: 'filtro-empresa', chave: 'empresa', rotulo: 'Empresa', prefixo: 'Empresa',
        opcoes: [{ valor: '', rotulo: 'Todas' }]
          .concat(estado.empresas.map(function (e) { return { valor: e.id, rotulo: e.nome }; }))
          .concat(temGeral ? [{ valor: '-', rotulo: 'Sem empresa (link geral)' }] : []) });
    }
    if (MODO_API) {
      defs.push({ id: 'filtro-avaliacao', chave: 'avaliacao', rotulo: 'Avaliação', prefixo: 'Avaliação',
        opcoes: [{ valor: '', rotulo: 'Todas' }]
          .concat(estado.avaliacoes.map(function (a) { return { valor: a.codigo, rotulo: a.nome }; }))
          .concat(temGeral ? [{ valor: '-', rotulo: 'Link geral' }] : []) });
    }
    defs.push({ id: 'filtro-perfil', chave: 'perfil', rotulo: 'Perfil primário', prefixo: 'Perfil',
      opcoes: [{ valor: '', rotulo: 'Todos' }].concat(LETRAS.map(function (l) { return { valor: l, rotulo: l + ' — ' + NOMES[l] }; })) });
    defs.push({ id: 'filtro-status', chave: 'status', rotulo: 'Status', prefixo: 'Status',
      opcoes: [{ valor: '', rotulo: 'Todos' }].concat(['em_analise', 'aprovado', 'reprovado', 'invalido'].map(function (s) { return { valor: s, rotulo: STATUS[s] }; })) });
    defs.forEach(function (d) {
      var existe = d.opcoes.some(function (o) { return o.valor === estado.filtros[d.chave]; });
      if (!existe) estado.filtros[d.chave] = '';
      var esc = criarEscolha({ id: d.id, rotulo: d.rotulo, prefixo: d.prefixo, valor: estado.filtros[d.chave], opcoes: d.opcoes });
      esc.botao.addEventListener('change', function () { estado.filtros[d.chave] = esc.botao.value; renderizarLista(); });
      box.appendChild(esc.caixa);
    });
    box.setAttribute('data-qtd', String(defs.length));
  }

  function filtrados() {
    var busca = $('filtro-busca').value;
    var f = estado.filtros;
    return estado.registros.filter(function (r) {
      if (f.empresa === '-' && r.avaliacao) return false;
      if (f.empresa && f.empresa !== '-' && r.empresaId !== f.empresa) return false;
      if (f.avaliacao === '-' && r.avaliacao) return false;
      if (f.avaliacao && f.avaliacao !== '-' && r.avaliacao !== f.avaliacao) return false;
      if (f.perfil && (!r.calc || r.calc.primario !== f.perfil)) return false;
      if (f.status === 'invalido' && !r.invalido) return false;
      if (f.status && f.status !== 'invalido' && (r.invalido || r.status !== f.status)) return false;
      return correspondeBusca(r, busca);
    });
  }

  /* ---------- Lista ---------- */

  // Cartões de resumo no padrão do Início do BI: todos brancos; "Aprovados" em destaque (número em laranja).
  function renderizarResumo(animar) {
    var box = $('resumo-lista');
    limpar(box);
    var regs = estado.registros;
    var conta = function (f) { return regs.filter(f).length; };
    var cartoes = [
      { rotulo: 'Participantes', valor: regs.length, estilo: '' },
      { rotulo: 'Aprovados', valor: conta(function (r) { return !r.invalido && r.status === 'aprovado'; }), estilo: 'caixa--destaque' },
      { rotulo: 'Em análise', valor: conta(function (r) { return !r.invalido && r.status === 'em_analise'; }), estilo: '' },
      { rotulo: 'Confiabilidade baixa', valor: conta(function (r) { return r.conf && r.conf.nivel === 'baixa'; }), estilo: '' }
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
      ? (MODO_API ? 'Nenhuma resposta recebida ainda.' : 'Nenhum participante importado. Use a aba "Importar códigos".')
      : itens.length + ' de ' + total + ' participante' + (total === 1 ? '' : 's');
    itens.forEach(function (r, i) {
      var meta = [linkTelefone(r)];
      if (r.vaga && r.avaliacaoTipo !== 'equipe') meta.push(el('span', { texto: r.vaga }));
      meta.push(el('span', { classe: 'texto-suave', texto: formatarData(r.fim || r.recebidoEm) }));
      // Função · Empresa (discreto). A idade fica só no detalhe.
      var exp = textoExperiencia(r);
      if (exp) meta.push(el('span', { classe: 'card-experiencia', texto: exp }));
      ul.appendChild(el('li', { classe: 'card caixa' + (animar ? ' surgir' : '') + (r.invalido ? ' card-invalido' : ''), 'data-id': r.id, estilo: animar ? { 'animation-delay': Math.min(i, 8) * 30 + 'ms' } : null }, [
        el('div', { classe: 'card-topo' }, [
          r.calc ? letraDisc(r.calc.primario, 'card-letra') : el('span', { classe: 'letra-disc card-letra card-letra--vazia', 'aria-hidden': 'true', texto: '?' }),
          el('button', { type: 'button', classe: 'card-nome', texto: r.nome || '(sem nome)',
            onclick: function () { abrirDetalhe(r.id); } }),
          seloProtocolo(r, 'card-protocolo')
        ]),
        MODO_API ? el('p', { classe: 'card-origem', texto: textoOrigem(r) }) : null,
        el('div', { classe: 'card-meta' }, meta),
        r.calc ? miniBarras(r.calc.percentuais) : el('p', { classe: 'aviso aviso--erro card-aviso', texto: 'Respostas inválidas — resultado não pode ser calculado.' }),
        el('div', { classe: 'card-rodape' }, [
          el('div', { classe: 'card-selos' }, [badgePerfil(r), badgeStatus(r), badgeConfiabilidade(r)]),
          el('button', { type: 'button', classe: 'botao botao--claro botao--pequeno', texto: 'Ver detalhes',
            'aria-label': 'Ver detalhes de ' + (r.nome || 'participante'), onclick: function () { abrirDetalhe(r.id); } })
        ])
      ]));
    });
  }

  /* ---------- Detalhe ---------- */

  function esconderVistas() {
    ['vista-lista', 'vista-avaliacoes', 'vista-empresas', 'vista-usuarios', 'vista-comparativo', 'vista-importar']
      .forEach(function (id) { $(id).hidden = true; });
  }

  function abrirDetalhe(id) {
    estado.abertoId = id;
    renderizarDetalhe();
    esconderVistas();
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

  function copiarPorTextarea(txt) {
    return new Promise(function (ok, falha) {
      var ta = el('textarea', { readonly: true, estilo: { position: 'fixed', left: '-9999px' } });
      ta.value = txt;
      document.body.appendChild(ta);
      ta.select();
      try { if (document.execCommand('copy')) ok(); else falha(new Error('cópia bloqueada')); }
      catch (e) { falha(e); }
      document.body.removeChild(ta);
    });
  }
  function copiarTexto(txt) {
    if (root.navigator && root.navigator.clipboard && root.isSecureContext) {
      return root.navigator.clipboard.writeText(txt).catch(function () { return copiarPorTextarea(txt); });
    }
    return copiarPorTextarea(txt);
  }

  // Confiabilidade: nível, pontos (barra lisa) e motivos. Fortes e leves marcados para leitura rápida.
  function blocoConfiabilidade(r) {
    var c = r.conf;
    if (!c) return null;
    var nivel = NIVEIS_CONF[c.nivel] || 'Sem dados';
    var det = c.detalhes || {};
    var fortes = det.alertasFortes || [], leves = det.alertasLeves || [];
    var disponivel = c.nivel !== 'indisponivel';
    return el('section', { classe: 'caixa det-conf surgir', id: 'det-confiabilidade', 'data-nivel': c.nivel }, [
      el('h3', { classe: 'caixa__titulo', texto: 'Confiabilidade do resultado' }),
      el('div', { classe: 'conf-topo' }, [
        el('span', { classe: 'selo conf-nivel ' + (CLASSE_CONF[c.nivel] || ''), id: 'det-conf-nivel', texto: nivel }),
        disponivel ? el('p', { classe: 'conf-pontos' }, [
          el('span', { classe: 't-indicador negrito tabular', id: 'det-conf-pontos', texto: String(c.pontos) }),
          el('span', { classe: 'texto-suave t-rotulo', texto: ' de 100' })
        ]) : null
      ]),
      disponivel ? el('span', { classe: 'conf-barra trilho', role: 'img', 'aria-label': c.pontos + ' de 100 pontos' },
        el('span', { classe: 'conf-barra__cheia', estilo: { width: Math.max(4, Math.min(100, c.pontos)) + '%' } })) : null,
      el('ul', { classe: 'conf-motivos', id: 'det-conf-motivos' }, (c.motivos || []).map(function (m) {
        var tipo = fortes.indexOf(m) >= 0 ? 'forte' : (leves.indexOf(m) >= 0 ? 'leve' : 'ok');
        return el('li', { classe: 'conf-motivo conf-motivo--' + tipo, texto: m });
      })),
      el('p', { classe: 'conf-nota', texto: 'Mostra se as respostas parecem consistentes (confirmação feita pelo próprio participante e tempo de resposta). Não é uma nota da pessoa e nunca aparece para ela.' })
    ]);
  }

  // Respostas da etapa de confirmação, legíveis para o recrutador.
  function blocoConfirmacao(r) {
    var res = resumoValidacao(r.validacao, r.calc);
    if (!res) return null;
    return el('section', { classe: 'caixa det-confirmacao surgir', id: 'det-confirmacao' }, [
      el('h3', { classe: 'caixa__titulo', texto: 'Respostas da confirmação' }),
      el('p', { classe: 'conf-nota conf-nota--topo', texto: 'Depois dos grupos, a pessoa escolheu, em cada par, o retrato em que mais se reconhece e deu nota a quatro frases.' }),
      el('h4', { classe: 'conf-subtitulo', texto: 'Retratos escolhidos' }),
      el('ul', { classe: 'conf-retratos' }, res.retratos.map(function (p) {
        var esc = p.escolha;
        return el('li', { classe: 'conf-retrato' }, [
          el('div', { classe: 'conf-retrato__par' }, esc ? [
            letraDisc(esc, 'conf-letra'),
            el('span', null, [el('span', { classe: 'seminegrito', texto: NOMES[esc] }), el('span', { classe: 'texto-suave', texto: ' em vez de ' + NOMES[p.outra] + ' (' + p.outra + ')' })])
          ] : [el('span', { classe: 'texto-suave', texto: 'Sem escolha entre ' + NOMES[p.opcoes[0]] + ' e ' + NOMES[p.opcoes[1]] })]),
          el('span', { classe: 'selo ' + (p.acertou ? 'selo--verde' : 'selo--vermelho'), texto: p.acertou ? 'Combina' : 'Não combina' })
        ]);
      })),
      el('h4', { classe: 'conf-subtitulo', texto: 'Frases' }),
      el('ul', { classe: 'conf-frases' }, res.frases.map(function (f) {
        return el('li', { classe: 'conf-frase', 'data-tipo': f.tipo }, [
          el('p', { classe: 'conf-frase__texto', texto: '“' + f.texto + '”' }),
          el('p', { classe: 'conf-frase__meta' }, [
            el('span', { classe: 'seminegrito conf-frase__nota', texto: f.notaTexto }),
            el('span', { classe: 'texto-suave', texto: ' · ' + f.rotulo })
          ]),
          el('p', { classe: 'conf-frase__esperado', texto: f.esperado })
        ]);
      })),
      res.demonstracao ? el('p', { classe: 'aviso', texto: 'Feito em modo demonstração: parte dos grupos foi preenchida ao acaso.' }) : null
    ]);
  }

  function renderizarDetalhe() {
    var art = $('vista-detalhe');
    limpar(art);
    var r = acharRegistro(estado.abertoId);
    if (!r) { fecharDetalhe(); return; }
    var guia = gerarGuia(r);
    var equipe = r.avaliacaoTipo === 'equipe';

    // Cabeçalho no padrão do BI: título, texto suave e ações em pílula (não impressas)
    var sub = [equipe ? '' : r.vaga, formatarData(r.fim || r.recebidoEm)].filter(function (x) { return x && x !== '—'; }).join(' · ');
    art.appendChild(el('header', { classe: 'cabecalho det-cabecalho' }, [
      el('div', { classe: 'cabecalho__texto-area' }, [
        el('p', { classe: 'det-relatorio so-imprimir', texto: 'Relatório DISC' + (r.empresaNome ? ' — ' + r.empresaNome : (CONFIG.EMPRESA ? ' — ' + CONFIG.EMPRESA : '')) }),
        el('p', { classe: 'sobretitulo nao-imprimir', texto: equipe ? 'Avaliação de equipe · Colaborador' : 'Processo seletivo · Candidato' }),
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

    // Dados do participante (equipe: sem vaga nem empresa anterior; "Cargo/função")
    var dados = el('section', { classe: 'caixa det-dados surgir' }, [
      el('h3', { classe: 'caixa__titulo', texto: equipe ? 'Dados do colaborador' : 'Dados do candidato' }),
      el('dl', { classe: 'det-dl' }, [
        el('div', null, [el('dt', { texto: 'Telefone' }), el('dd', null, linkTelefone(r))]),
        el('div', null, [el('dt', { texto: 'Idade' }), el('dd', { id: 'det-idade', texto: textoIdade(r.idade) })]),
        equipe ? null : el('div', null, [el('dt', { texto: 'Vaga pretendida' }), el('dd', { texto: r.vaga || '—' })]),
        el('div', null, [el('dt', { texto: equipe ? 'Cargo/função' : 'Função atual/última' }), el('dd', { id: 'det-funcao', texto: r.funcao || '—' })]),
        equipe ? null : el('div', null, [el('dt', { texto: 'Empresa atual/última' }), el('dd', { id: 'det-empresa', texto: r.empresa || '—' })]),
        MODO_API ? el('div', { classe: 'det-dl__largo' }, [el('dt', { texto: 'Avaliação' }), el('dd', { id: 'det-avaliacao', texto: textoOrigem(r) })]) : null,
        el('div', null, [el('dt', { texto: 'Concluído em' }), el('dd', { texto: formatarData(r.fim || r.recebidoEm) })]),
        el('div', null, [el('dt', { texto: 'Duração' }), el('dd', { texto: formatarDuracao(r.duracaoSeg) })]),
        el('div', null, [el('dt', { texto: 'Perfil' }), el('dd', { classe: 'det-perfil' }, [badgePerfil(r), r.calc ? ' ' + NOMES[r.calc.primario] + ' / ' + NOMES[r.calc.secundario] : ''])]),
        el('div', null, [el('dt', { texto: 'Status' }), el('dd', { id: 'det-status-selo' }, badgeStatus(r))])
      ])
    ]);

    // Status e observações (admin e gestor); excluir só admin
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
      }).catch(function (e) { falhou(e); escStatus.definir(r.status); });
    });
    var taObs = el('textarea', { id: 'det-obs', classe: 'entrada', rows: 3, maxlength: 2000, placeholder: 'Anotações sobre a entrevista, disponibilidade…' });
    taObs.value = r.observacoes || '';
    var btnObs = el('button', { type: 'button', classe: 'botao botao--principal', texto: 'Salvar observações' });
    btnObs.addEventListener('click', function () {
      btnObs.disabled = true;
      atualizarCampos(r.id, { observacoes: taObs.value }).then(function () {
        avisar('Observações salvas.', 'ok'); obsImpressa.textContent = taObs.value;
      }).catch(falhou).then(function () { btnObs.disabled = false; });
    });
    var btnExcluir = null;
    if (pode('excluir')) {
      btnExcluir = el('button', { type: 'button', classe: 'botao botao--perigo', id: 'btn-excluir-participante', texto: 'Excluir participante' });
      btnExcluir.addEventListener('click', function () {
        confirmar({ titulo: 'Excluir este participante?', texto: 'Os dados de ' + (r.nome || 'este participante') + ' serão apagados definitivamente.', botao: 'Excluir participante' }).then(function (ok) {
          if (!ok) return;
          excluirRegistro(r.id).then(function () {
            avisar('Participante excluído.', 'ok'); fecharDetalhe(); renderizarTudo();
          }).catch(falhou);
        });
      });
    }
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
      art.appendChild(el('p', { classe: 'aviso aviso--erro', texto: 'As respostas deste participante estão incompletas ou corrompidas; não é possível calcular o perfil.' }));
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

    // Confiabilidade + respostas da confirmação
    var conf = blocoConfiabilidade(r);
    var confirmacao = blocoConfirmacao(r);
    if (conf || confirmacao) art.appendChild(el('div', { classe: 'det-perfis det-conf-grade' }, [conf, confirmacao]));

    // Características: primário em card suave, secundário em card branco
    art.appendChild(el('div', { classe: 'det-perfis' }, [
      blocoPerfil(r.calc.primario, 'Perfil primário', true),
      blocoPerfil(r.calc.secundario, 'Perfil secundário', false)
    ]));

    // Guia: resumo em card de vidro (o único da tela), seções num card branco amplo
    if (guia) {
      var baixa = r.conf && r.conf.nivel === 'baixa';
      art.appendChild(el('section', { classe: 'guia' }, [
        baixa ? el('p', { classe: 'aviso aviso--erro guia-aviso', id: 'aviso-guia-confiabilidade', role: 'note', texto: AVISO_GUIA_BAIXA }) : null,
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
      el('p', { classe: 'sobretitulo', texto: 'Equipe' }),
      el('h2', { classe: 'cabecalho__titulo t-pagina seminegrito', texto: 'Comparativo dos aprovados' })
    ]);
    box.appendChild(el('div', { classe: 'cabecalho' }, cab));
    if (!res.total) {
      box.appendChild(el('div', { classe: 'caixa vazio surgir' }, [
        el('p', { classe: 'vazio__texto', texto: 'Nenhum participante aprovado ainda. Marque participantes como "Aprovado" no detalhe para ver o comparativo da equipe.' })
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

  /* ---------- Avaliações (admin) ---------- */

  function cabecalhoVista(sobre, titulo, texto, acoes) {
    return el('div', { classe: 'cabecalho' }, [
      el('div', { classe: 'cabecalho__texto-area' }, [
        el('p', { classe: 'sobretitulo', texto: sobre }),
        el('h2', { classe: 'cabecalho__titulo t-pagina seminegrito', texto: titulo }),
        texto ? el('p', { classe: 'cabecalho__texto', texto: texto }) : null
      ]),
      acoes ? el('div', { classe: 'cabecalho__acoes' }, acoes) : null
    ]);
  }

  function linkDe(av) { return linkAvaliacao(root.location.href, av.codigo); }

  function renderizarAvaliacoes() {
    var box = $('vista-avaliacoes');
    limpar(box);
    if (papel() !== 'admin') return;
    box.appendChild(cabecalhoVista('Links de avaliação', 'Avaliações',
      'Crie um link para cada vaga ou equipe e envie aos participantes. As respostas chegam já ligadas à empresa.',
      [el('button', { type: 'button', classe: 'botao botao--principal', id: 'btn-nova-avaliacao', texto: 'Nova avaliação', onclick: function () { janelaAvaliacao(null); } })]));
    if (!estado.empresas.length) {
      box.appendChild(el('p', { classe: 'aviso', texto: 'Cadastre uma empresa na aba "Empresas" antes de criar avaliações.' }));
    }
    if (!estado.avaliacoes.length) {
      box.appendChild(el('div', { classe: 'caixa vazio' }, el('p', { classe: 'vazio__texto', texto: 'Nenhuma avaliação criada ainda.' })));
      return;
    }
    box.appendChild(el('ul', { classe: 'gestao-lista', id: 'lista-avaliacoes' }, estado.avaliacoes.map(function (av) {
      var link = linkDe(av);
      var n = Number(av.respostas) || 0;
      var acoes = [
        el('button', { type: 'button', classe: 'botao botao--claro botao--pequeno', 'data-acao': 'copiar-link', texto: 'Copiar link', onclick: function () {
          copiarTexto(link).then(function () { avisar('Link copiado.', 'ok'); }, function () { avisar('Não foi possível copiar. Selecione o link e copie.', 'erro'); });
        } }),
        el('button', { type: 'button', classe: 'botao botao--claro botao--pequeno', 'data-acao': 'copiar-mensagem', texto: 'Copiar mensagem', onclick: function () {
          copiarTexto(mensagemConvite(av, link)).then(function () { avisar('Mensagem copiada. Cole no WhatsApp.', 'ok'); }, function () { avisar('Não foi possível copiar.', 'erro'); });
        } }),
        el('button', { type: 'button', classe: 'botao botao--claro botao--pequeno', 'data-acao': 'editar', texto: 'Editar', onclick: function () { janelaAvaliacao(av); } }),
        el('button', { type: 'button', classe: 'botao botao--claro botao--pequeno', 'data-acao': 'alternar-ativa', texto: av.ativa ? 'Desativar' : 'Ativar', onclick: function () {
          api('salvarAvaliacao', { id: av.id, empresaId: av.empresaId, nome: av.nome, tipo: av.tipo, mostrarResultado: av.mostrarResultado, ativa: !av.ativa })
            .then(function () { avisar(av.ativa ? 'Avaliação desativada: o link deixa de aceitar respostas.' : 'Avaliação ativada.', 'ok'); return carregar(); })
            .catch(falhou);
        } }),
        n === 0 ? el('button', { type: 'button', classe: 'botao botao--perigo botao--pequeno', 'data-acao': 'excluir', texto: 'Excluir', onclick: function () {
          confirmar({ titulo: 'Excluir a avaliação?', texto: '"' + av.nome + '" ainda não tem respostas. O link ' + av.codigo + ' deixa de existir.', botao: 'Excluir avaliação' }).then(function (ok) {
            if (!ok) return;
            api('excluirAvaliacao', av.id).then(function () { avisar('Avaliação excluída.', 'ok'); return carregar(); }).catch(falhou);
          });
        } }) : null
      ];
      return el('li', { classe: 'caixa gestao-card av-card', 'data-codigo': av.codigo }, [
        el('div', { classe: 'gestao-card__topo' }, [
          el('div', { classe: 'gestao-card__titulo-area' }, [
            el('h3', { classe: 'gestao-card__titulo seminegrito', texto: av.nome }),
            el('p', { classe: 'gestao-card__sub', texto: (av.empresaNome || '—') + ' · ' + n + ' resposta' + (n === 1 ? '' : 's') })
          ]),
          el('span', { classe: 'protocolo', title: 'Código do link' }, [
            el('span', { classe: 'protocolo__rotulo', texto: 'Código' }),
            el('span', { classe: 'protocolo__valor t-titulo negrito tabular av-codigo', texto: av.codigo })
          ])
        ]),
        el('div', { classe: 'card-selos' }, [
          el('span', { classe: 'selo', texto: TIPOS[av.tipo] || av.tipo }),
          el('span', { classe: 'selo av-ativa ' + (av.ativa ? 'selo--verde' : ''), texto: av.ativa ? 'Ativa' : 'Desativada' }),
          av.mostrarResultado ? el('span', { classe: 'selo', texto: 'Mostra o resultado' }) : null
        ]),
        el('p', { classe: 'av-link', texto: link }),
        el('div', { classe: 'gestao-card__acoes' }, acoes),
        n > 0 ? el('p', { classe: 'gestao-card__nota', texto: 'Já tem respostas: para encerrar, desative em vez de excluir.' }) : null
      ]);
    })));
  }

  function janelaAvaliacao(av) {
    if (!av && !estado.empresas.length) { avisar('Cadastre uma empresa antes de criar avaliações.', 'erro'); mostrarAba('empresas'); return; }
    var escEmpresa = criarEscolha({
      id: 'av-empresa', rotulo: 'Empresa', rotuloId: 'av-empresa-rotulo', classe: 'escolha--campo escolha--larga',
      valor: av ? av.empresaId : (estado.empresas.length === 1 ? estado.empresas[0].id : ''),
      opcoes: [{ valor: '', rotulo: 'Escolha a empresa' }].concat(estado.empresas.map(function (e) { return { valor: e.id, rotulo: e.nome }; }))
    });
    var escTipo = criarEscolha({
      id: 'av-tipo', rotulo: 'Tipo', rotuloId: 'av-tipo-rotulo', classe: 'escolha--campo escolha--larga', valor: av ? av.tipo : 'selecao',
      opcoes: [{ valor: 'selecao', rotulo: TIPOS.selecao }, { valor: 'equipe', rotulo: TIPOS.equipe }]
    });
    var campoNome = campoTexto('av-nome', 'Nome (vaga ou equipe)', { maxlength: 80, placeholder: 'Ex.: Recepcionista 2026' });
    campoNome.querySelector('input').value = av ? av.nome : '';
    abrirJanela({
      id: 'janela-avaliacao',
      titulo: av ? 'Editar avaliação' : 'Nova avaliação',
      texto: av ? 'Código do link: ' + av.codigo : 'O link fica pronto para copiar assim que você salvar.',
      botao: av ? 'Salvar alterações' : 'Criar avaliação',
      corpo: [
        campoEscolha('Empresa', escEmpresa, 'av-empresa-rotulo'),
        campoNome,
        campoEscolha('Tipo', escTipo, 'av-tipo-rotulo'),
        campoMarcar('av-mostrar', 'Mostrar resultado ao participante (resumo do perfil no final)', av ? av.mostrarResultado : false),
        campoMarcar('av-ativa', 'Avaliação ativa (o link aceita respostas)', av ? av.ativa : true)
      ],
      aoConfirmar: function () {
        var dados = {
          empresaId: escEmpresa.botao.value,
          nome: $('av-nome').value.trim(),
          tipo: escTipo.botao.value,
          mostrarResultado: $('av-mostrar').checked,
          ativa: $('av-ativa').checked
        };
        if (!dados.empresaId) throw new Error('Escolha a empresa.');
        if (!dados.nome) throw new Error('Informe o nome da avaliação.');
        if (av) dados.id = av.id;
        return api('salvarAvaliacao', dados).then(function (resp) {
          var cod = resp.avaliacao && resp.avaliacao.codigo;
          avisar(av ? 'Avaliação salva.' : 'Avaliação criada. Código ' + cod + ': copie o link e envie.', 'ok');
          return carregar();
        });
      }
    });
  }

  /* ---------- Empresas (admin) ---------- */

  function renderizarEmpresas() {
    var box = $('vista-empresas');
    limpar(box);
    if (papel() !== 'admin') return;
    box.appendChild(cabecalhoVista('Clientes', 'Empresas', 'Cada avaliação e cada gestor pertencem a uma empresa.'));
    var entrada = el('input', { id: 'empresa-nova', classe: 'entrada', type: 'text', maxlength: 80, autocomplete: 'off', placeholder: 'Nome da empresa' });
    var form = el('form', { classe: 'caixa caixa--compacta empresa-nova', novalidate: true }, [
      el('label', { classe: 'visualmente-oculto', for: 'empresa-nova', texto: 'Nome da nova empresa' }),
      entrada,
      el('button', { type: 'submit', classe: 'botao botao--principal', id: 'btn-adicionar-empresa', texto: 'Adicionar empresa' })
    ]);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var nome = entrada.value.trim();
      if (!nome) { avisar('Informe o nome da empresa.', 'erro'); entrada.focus(); return; }
      api('salvarEmpresa', { nome: nome }).then(function () {
        avisar('Empresa "' + nome + '" criada.', 'ok');
        return carregar();
      }).then(function () { var n = $('empresa-nova'); if (n) n.focus(); }).catch(falhou);
    });
    box.appendChild(form);
    if (!estado.empresas.length) {
      box.appendChild(el('div', { classe: 'caixa vazio' }, el('p', { classe: 'vazio__texto', texto: 'Nenhuma empresa cadastrada ainda.' })));
      return;
    }
    box.appendChild(el('ul', { classe: 'gestao-lista gestao-lista--linhas', id: 'lista-empresas' }, estado.empresas.map(function (emp) {
      var nAv = estado.avaliacoes.filter(function (a) { return a.empresaId === emp.id; }).length;
      var nGe = estado.usuarios.filter(function (u) { return u.papel === 'gestor' && u.empresaId === emp.id; }).length;
      return el('li', { classe: 'caixa caixa--compacta gestao-linha', 'data-id': emp.id }, [
        el('div', { classe: 'gestao-linha__texto' }, [
          el('p', { classe: 'seminegrito gestao-linha__nome', texto: emp.nome }),
          el('p', { classe: 'gestao-card__sub', texto: nAv + ' avaliaç' + (nAv === 1 ? 'ão' : 'ões') + ' · ' + nGe + ' gestor' + (nGe === 1 ? '' : 'es') })
        ]),
        el('div', { classe: 'gestao-card__acoes' }, [
          el('button', { type: 'button', classe: 'botao botao--claro botao--pequeno', 'data-acao': 'renomear', texto: 'Renomear', onclick: function () {
            var campo = campoTexto('empresa-renomear', 'Novo nome', { maxlength: 80 });
            campo.querySelector('input').value = emp.nome;
            abrirJanela({ id: 'janela-empresa', titulo: 'Renomear empresa', botao: 'Salvar', corpo: [campo], aoConfirmar: function () {
              var nome = $('empresa-renomear').value.trim();
              if (!nome) throw new Error('Informe o nome da empresa.');
              return api('salvarEmpresa', { id: emp.id, nome: nome }).then(function () { avisar('Empresa renomeada.', 'ok'); return carregar(); });
            } });
          } }),
          el('button', { type: 'button', classe: 'botao botao--perigo botao--pequeno', 'data-acao': 'excluir', texto: 'Excluir', onclick: function () {
            confirmar({ titulo: 'Excluir a empresa?', texto: '"' + emp.nome + '" será apagada. Empresas com avaliações ou gestores não podem ser excluídas.', botao: 'Excluir empresa' }).then(function (ok) {
              if (!ok) return;
              api('excluirEmpresa', emp.id).then(function () { avisar('Empresa excluída.', 'ok'); return carregar(); }).catch(falhou);
            });
          } })
        ])
      ]);
    })));
  }

  /* ---------- Usuários (admin) ---------- */

  function renderizarUsuarios() {
    var box = $('vista-usuarios');
    limpar(box);
    if (papel() !== 'admin') return;
    box.appendChild(cabecalhoVista('Acessos', 'Usuários',
      'Administradores veem tudo. Gestores veem só os participantes da própria empresa e não excluem nada.',
      [el('button', { type: 'button', classe: 'botao botao--principal', id: 'btn-novo-usuario', texto: 'Novo usuário', onclick: function () { janelaUsuario(null); } })]));
    var eu = estado.usuario || {};
    box.appendChild(el('ul', { classe: 'gestao-lista gestao-lista--linhas', id: 'lista-usuarios' }, estado.usuarios.map(function (u) {
      var euMesmo = u.id === eu.id;
      var situacao = u.bloqueado ? { t: 'Bloqueado', c: 'selo--vermelho' } : (u.ativo ? { t: 'Ativo', c: 'selo--verde' } : { t: 'Desativado', c: '' });
      return el('li', { classe: 'caixa caixa--compacta gestao-linha', 'data-email': u.email }, [
        el('div', { classe: 'gestao-linha__texto' }, [
          el('p', { classe: 'seminegrito gestao-linha__nome', texto: u.nome + (euMesmo && !/você/i.test(u.nome) ? ' (você)' : '') }),
          el('p', { classe: 'gestao-card__sub', texto: u.email }),
          el('div', { classe: 'card-selos' }, [
            el('span', { classe: 'selo', texto: PAPEIS[u.papel] || u.papel }),
            u.papel === 'gestor' ? el('span', { classe: 'selo', texto: u.empresaNome || 'Sem empresa' }) : null,
            el('span', { classe: 'selo ' + situacao.c, texto: situacao.t })
          ])
        ]),
        el('div', { classe: 'gestao-card__acoes' }, [
          el('button', { type: 'button', classe: 'botao botao--claro botao--pequeno', 'data-acao': 'editar', texto: 'Editar', onclick: function () { janelaUsuario(u); } }),
          el('button', { type: 'button', classe: 'botao botao--claro botao--pequeno', 'data-acao': 'redefinir', texto: 'Redefinir senha', onclick: function () { janelaRedefinir(u); } }),
          euMesmo ? null : el('button', { type: 'button', classe: 'botao botao--claro botao--pequeno', 'data-acao': 'alternar-ativo', texto: u.ativo ? 'Desativar' : 'Ativar', onclick: function () {
            api('salvarUsuario', { id: u.id, nome: u.nome, email: u.email, papel: u.papel, empresaId: u.empresaId, ativo: !u.ativo })
              .then(function () { avisar(u.ativo ? 'Acesso desativado.' : 'Acesso ativado.', 'ok'); return carregar(); }).catch(falhou);
          } }),
          euMesmo ? null : el('button', { type: 'button', classe: 'botao botao--perigo botao--pequeno', 'data-acao': 'excluir', texto: 'Excluir', onclick: function () {
            confirmar({ titulo: 'Excluir o acesso?', texto: u.nome + ' (' + u.email + ') não vai mais conseguir entrar no painel.', botao: 'Excluir acesso' }).then(function (ok) {
              if (!ok) return;
              api('excluirUsuario', u.id).then(function () { avisar('Acesso excluído.', 'ok'); return carregar(); }).catch(falhou);
            });
          } })
        ])
      ]);
    })));
  }

  function campoSenhaTemporaria(id) {
    var entrada = el('input', { id: id, classe: 'entrada senha-temporaria tabular', type: 'text', autocomplete: 'off', spellcheck: 'false', maxlength: 100 });
    var gerar = el('button', { type: 'button', classe: 'botao botao--contorno', id: id + '-gerar', texto: 'Gerar senha', onclick: function () {
      entrada.value = gerarSenhaTemporaria();
      entrada.focus();
    } });
    return el('div', { classe: 'campo' }, [
      el('label', { classe: 'campo__rotulo', for: id, texto: 'Senha temporária (mínimo 8 caracteres)' }),
      el('div', { classe: 'campo-linha' }, [entrada, gerar]),
      el('span', { classe: 'campo__ajuda', texto: 'Passe a senha para a pessoa; ela pode trocar depois em "Trocar senha".' })
    ]);
  }

  function janelaUsuario(u) {
    var escPapel = criarEscolha({
      id: 'us-papel', rotulo: 'Papel', rotuloId: 'us-papel-rotulo', classe: 'escolha--campo escolha--larga', valor: u ? u.papel : 'gestor',
      opcoes: [{ valor: 'gestor', rotulo: 'Gestor (só a própria empresa)' }, { valor: 'admin', rotulo: 'Administrador (tudo)' }]
    });
    var escEmpresa = criarEscolha({
      id: 'us-empresa', rotulo: 'Empresa', rotuloId: 'us-empresa-rotulo', classe: 'escolha--campo escolha--larga',
      valor: u && u.empresaId ? u.empresaId : (estado.empresas.length === 1 ? estado.empresas[0].id : ''),
      opcoes: [{ valor: '', rotulo: 'Escolha a empresa' }].concat(estado.empresas.map(function (e) { return { valor: e.id, rotulo: e.nome }; }))
    });
    var blocoEmpresa = campoEscolha('Empresa do gestor', escEmpresa, 'us-empresa-rotulo');
    function atualizarEmpresa() { blocoEmpresa.hidden = escPapel.botao.value !== 'gestor'; }
    escPapel.botao.addEventListener('change', atualizarEmpresa);
    atualizarEmpresa();
    var nome = campoTexto('us-nome', 'Nome', { maxlength: 80, autocomplete: 'off' });
    var email = campoTexto('us-email', 'E-mail', { type: 'email', maxlength: 120, inputmode: 'email', autocomplete: 'off' });
    if (u) { nome.querySelector('input').value = u.nome; email.querySelector('input').value = u.email; }
    abrirJanela({
      id: 'janela-usuario',
      titulo: u ? 'Editar usuário' : 'Novo usuário',
      botao: u ? 'Salvar alterações' : 'Criar usuário',
      corpo: [nome, email, campoEscolha('Papel', escPapel, 'us-papel-rotulo'), blocoEmpresa, u ? null : campoSenhaTemporaria('us-senha')],
      aoConfirmar: function () {
        var dados = {
          nome: $('us-nome').value.trim(),
          email: $('us-email').value.trim(),
          papel: escPapel.botao.value,
          empresaId: escPapel.botao.value === 'gestor' ? escEmpresa.botao.value : '',
          ativo: u ? u.ativo : true
        };
        if (!dados.nome) throw new Error('Informe o nome.');
        if (!dados.email) throw new Error('Informe o e-mail.');
        if (dados.papel === 'gestor' && !dados.empresaId) throw new Error('Escolha a empresa do gestor.');
        var senha = u ? '' : $('us-senha').value.trim();
        if (!u && senha.length < 8) throw new Error('A senha temporária precisa ter pelo menos 8 caracteres.');
        if (u) dados.id = u.id;
        return api('salvarUsuario', dados, senha || undefined).then(function () {
          avisar(u ? 'Usuário salvo.' : 'Usuário criado. Senha temporária: ' + senha, 'ok');
          return carregar();
        });
      }
    });
  }

  function janelaRedefinir(u) {
    abrirJanela({
      id: 'janela-redefinir',
      titulo: 'Redefinir senha',
      texto: 'Nova senha temporária para ' + u.nome + '. As sessões abertas dessa pessoa são encerradas.',
      botao: 'Redefinir senha',
      corpo: [campoSenhaTemporaria('rd-senha')],
      aoConfirmar: function () {
        var senha = $('rd-senha').value.trim();
        if (senha.length < 8) throw new Error('A senha temporária precisa ter pelo menos 8 caracteres.');
        return api('redefinirSenha', u.id, senha).then(function () {
          avisar('Senha redefinida. Nova senha temporária: ' + senha, 'ok');
          return carregar();
        });
      }
    });
  }

  function janelaTrocarSenha() {
    abrirJanela({
      id: 'janela-trocar-senha',
      titulo: 'Trocar senha',
      botao: 'Trocar senha',
      corpo: [
        campoTexto('ts-atual', 'Senha atual', { type: 'password', autocomplete: 'current-password' }),
        campoTexto('ts-nova', 'Nova senha (mínimo 8 caracteres)', { type: 'password', autocomplete: 'new-password' }),
        campoTexto('ts-confirmar', 'Confirmar nova senha', { type: 'password', autocomplete: 'new-password' })
      ],
      aoConfirmar: function () {
        var atual = $('ts-atual').value, nova = $('ts-nova').value, conf = $('ts-confirmar').value;
        if (!atual) throw new Error('Informe a senha atual.');
        if (nova.length < 8) throw new Error('A nova senha precisa ter pelo menos 8 caracteres.');
        if (nova !== conf) throw new Error('As duas senhas novas não são iguais.');
        return api('trocarSenha', atual, nova).then(function () { avisar('Senha trocada.', 'ok'); });
      }
    });
  }

  /* ---------- Importação de códigos (plano B do participante) ---------- */
  // Sem API: grava no localStorage deste navegador.
  // Com API (só admin): envia cada código para a planilha (o backend valida, recalcula e ignora id repetido).

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
      ['v', 'id', 'nome', 'telefone', 'idade', 'funcao', 'empresa', 'vaga', 'consentimento', 'inicio', 'fim', 'duracaoSeg', 'respostas', 'validacao', 'avaliacao'].forEach(function (k) {
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
    if (!lista.length) { avisar('Não há participantes para exportar.', 'erro'); return; }
    var blob = new Blob([gerarCsv(lista)], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var hoje = new Date().toISOString().slice(0, 10);
    var a = el('a', { href: url, download: 'participantes-disc-' + hoje + '.csv' });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  /* ---------- Navegação ---------- */

  function abasPermitidas() { return abasDoPapel(papel(), MODO_API); }

  function mostrarAba(aba) {
    var permitidas = abasPermitidas();
    if (permitidas.indexOf(aba) === -1) aba = 'lista';
    estado.aba = aba;
    if (estado.abertoId) { estado.abertoId = null; $('vista-detalhe').hidden = true; }
    esconderVistas();
    $('vista-' + aba).hidden = false;
    Array.prototype.forEach.call(document.querySelectorAll('.aba'), function (b) {
      if (b.getAttribute('data-aba') === aba) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
  }

  function renderizarTudo() {
    renderizarLista();
    renderizarComparativo();
    if (MODO_API) { renderizarAvaliacoes(); renderizarEmpresas(); renderizarUsuarios(); }
    if (estado.abertoId) renderizarDetalhe();
  }

  // Ajusta abas, botões e menu do usuário ao papel.
  function aplicarPapel() {
    var permitidas = abasPermitidas();
    Array.prototype.forEach.call(document.querySelectorAll('.aba'), function (b) {
      b.hidden = permitidas.indexOf(b.getAttribute('data-aba')) === -1;
    });
    $('btn-excluir-todos').hidden = !pode('excluir');
    $('btn-excluir-todos').textContent = MODO_API ? 'Excluir respostas' : 'Excluir todos';
    var u = estado.usuario;
    $('usuario-area').hidden = !(MODO_API && u);
    if (u) {
      var nome = String(u.nome || u.email || '');
      $('usuario-inicial').textContent = nome.trim().charAt(0).toUpperCase() || '?';
      $('usuario-nome').textContent = nome;
      $('menu-nome').textContent = nome;
      $('menu-email').textContent = u.email || '';
      $('menu-papel').textContent = (PAPEIS[u.papel] || u.papel) + (u.papel === 'gestor' && u.empresaNome ? ' · ' + u.empresaNome : '');
    }
    $('sobretitulo-lista').textContent = MODO_API ? (u && u.papel === 'gestor' && u.empresaNome ? u.empresaNome : 'Todas as empresas') : 'Processo seletivo';
  }

  function entrarPainel() {
    $('tela-login').hidden = true;
    $('tela-painel').hidden = false;
    estado.listaMostrada = false;
    aplicarPapel();
    mostrarAba(MODO_API ? 'lista' : (lerLocais().length ? 'lista' : 'importar'));
    return carregar();
  }

  function limparSessao() {
    ss('del', CHAVE_TOKEN);
    ss('del', CHAVE_USUARIO);
    estado.token = '';
    estado.usuario = null;
    estado.registros = []; estado.avaliacoes = []; estado.empresas = []; estado.usuarios = [];
    estado.abertoId = null;
    estado.filtros = { empresa: '', avaliacao: '', perfil: '', status: '' };
    fecharMenuUsuario();
    var j = $('janela'); if (j) j.remove();
    var c = $('confirmar'); if (c) c.remove();
  }

  function mostrarLogin(expirou) {
    $('tela-painel').hidden = true;
    $('usuario-area').hidden = true;
    $('tela-login').hidden = false;
    $('form-primeiro').hidden = true;
    $('form-login').hidden = false;
    $('aviso-sessao').hidden = !expirou;
    $('erro-login').hidden = true;
    $('campo-senha').value = '';
    $('campo-email').focus();
  }

  function sair() {
    var token = estado.token;
    if (token && root.DISC_API && root.DISC_API.sair) {
      Promise.resolve().then(function () { return root.DISC_API.sair(token); }).catch(function () { /* sessão já pode ter expirado */ });
    }
    limparSessao();
    mostrarLogin(false);
  }

  function sessaoExpirou() {
    if (!estado.token && !$('tela-login').hidden) return;
    limparSessao();
    mostrarLogin(true);
  }

  function iniciarSessao(resp) {
    estado.token = resp.token;
    estado.usuario = resp.usuario;
    ss('set', CHAVE_TOKEN, resp.token);
    ss('set', CHAVE_USUARIO, JSON.stringify(resp.usuario));
    return entrarPainel();
  }

  /* ---------- Menu do usuário ---------- */

  function abrirMenuUsuario() {
    $('menu-usuario').hidden = false;
    $('btn-usuario').setAttribute('aria-expanded', 'true');
  }
  function fecharMenuUsuario() {
    var m = $('menu-usuario');
    if (!m) return;
    m.hidden = true;
    $('btn-usuario').setAttribute('aria-expanded', 'false');
  }

  /* ---------- Início ---------- */

  function erroNoForm(id, msg) {
    var e = $(id);
    e.textContent = msg;
    e.hidden = false;
  }

  function iniciar() {
    if (CONFIG.EMPRESA) $('nome-empresa').textContent = '· ' + CONFIG.EMPRESA;
    $('modo-indicador').textContent = SIMULADA ? 'Prévia (dados de demonstração)' : (MODO_API ? 'Conectado à planilha' : 'Modo local (importar códigos)');
    $('dica-previa').hidden = !SIMULADA;
    $('dica-previa-chave').hidden = !SIMULADA;
    if (MODO_API) $('destino-importacao').textContent = 'Os resultados são enviados para a planilha, como se o participante tivesse enviado.';

    Array.prototype.forEach.call(document.querySelectorAll('.aba'), function (b) {
      b.addEventListener('click', function () { mostrarAba(b.getAttribute('data-aba')); });
    });
    // Busca: só 'input'. Um 'change' na busca dispara no blur (ao tocar em "Ver detalhes") e recriaria
    // a lista no meio do clique, que então se perde no botão já removido.
    $('filtro-busca').addEventListener('input', renderizarLista);
    $('btn-atualizar').addEventListener('click', function () { carregar().then(function () { if (!$('tela-painel').hidden) avisar('Lista atualizada.', 'ok'); }); });
    $('btn-csv').addEventListener('click', exportarCsv);
    $('btn-excluir-todos').addEventListener('click', excluirTodos);
    $('btn-importar').addEventListener('click', importar);
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (!$('menu-usuario').hidden) { fecharMenuUsuario(); $('btn-usuario').focus(); return; }
      if (estado.abertoId && !$('janela') && !$('confirmar')) fecharDetalhe();
    });

    // Menu do usuário
    $('btn-usuario').addEventListener('click', function () {
      if ($('menu-usuario').hidden) abrirMenuUsuario(); else fecharMenuUsuario();
    });
    document.addEventListener('mousedown', function (e) {
      if (!$('usuario-area').contains(e.target)) fecharMenuUsuario();
    });
    $('btn-sair').addEventListener('click', sair);
    $('btn-trocar-senha').addEventListener('click', function () { fecharMenuUsuario(); janelaTrocarSenha(); });

    // Login
    $('form-login').addEventListener('submit', function (e) {
      e.preventDefault();
      var email = $('campo-email').value.trim();
      var senha = $('campo-senha').value;
      $('erro-login').hidden = true;
      $('aviso-sessao').hidden = true;
      if (!email || !senha) { erroNoForm('erro-login', 'Informe o e-mail e a senha.'); return; }
      var btn = $('btn-entrar');
      btn.disabled = true; btn.textContent = 'Verificando…';
      Promise.resolve().then(function () { return root.DISC_API.login(email, senha); }).then(function (resp) {
        if (!resp || !resp.ok || !resp.token) throw new Error((resp && resp.erro) || 'E-mail ou senha incorretos.');
        return iniciarSessao(resp);
      }).catch(function (err) {
        erroNoForm('erro-login', (err && err.message) || 'Não foi possível entrar.');
      }).then(function () { btn.disabled = false; btn.textContent = 'Entrar'; });
    });
    $('btn-ir-primeiro').addEventListener('click', function () {
      $('form-login').hidden = true;
      $('form-primeiro').hidden = false;
      $('erro-primeiro').hidden = true;
      $('pa-chave').focus();
    });
    $('btn-voltar-login').addEventListener('click', function () { mostrarLogin(false); });
    $('form-primeiro').addEventListener('submit', function (e) {
      e.preventDefault();
      $('erro-primeiro').hidden = true;
      var chave = $('pa-chave').value.trim();
      var nome = $('pa-nome').value.trim();
      var email = $('pa-email').value.trim();
      var senha = $('pa-senha').value;
      if (!chave || !nome || !email || !senha) { erroNoForm('erro-primeiro', 'Preencha todos os campos.'); return; }
      if (senha.length < 8) { erroNoForm('erro-primeiro', 'A senha precisa ter pelo menos 8 caracteres.'); return; }
      if (senha !== $('pa-confirmar').value) { erroNoForm('erro-primeiro', 'As duas senhas não são iguais.'); return; }
      var btn = $('btn-criar-acesso');
      btn.disabled = true; btn.textContent = 'Criando…';
      Promise.resolve().then(function () { return root.DISC_API.primeiroAcesso(chave, nome, email, senha); }).then(function (resp) {
        if (!resp || !resp.ok || !resp.token) throw new Error((resp && resp.erro) || 'Não foi possível criar o acesso.');
        ['pa-chave', 'pa-senha', 'pa-confirmar'].forEach(function (id) { $(id).value = ''; });
        return iniciarSessao(resp).then(function () {
          avisar(resp.redefinida ? 'Senha de administrador redefinida.' : 'Acesso de administrador criado.', 'ok');
        });
      }).catch(function (err) {
        erroNoForm('erro-primeiro', (err && err.message) || 'Não foi possível criar o acesso.');
      }).then(function () { btn.disabled = false; btn.textContent = 'Criar acesso'; });
    });

    if (!MODO_API) { entrarPainel(); return; }
    var token = ss('get', CHAVE_TOKEN);
    var usuario = null;
    try { usuario = JSON.parse(ss('get', CHAVE_USUARIO) || 'null'); } catch (e2) { usuario = null; }
    if (token && usuario && usuario.papel) {
      estado.token = token;
      estado.usuario = usuario;
      entrarPainel();
    } else {
      mostrarLogin(false);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})(typeof self !== 'undefined' ? self : this);
