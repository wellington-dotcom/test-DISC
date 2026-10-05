/*
 * Fluxo do candidato — Teste DISC.
 * Telas: boas-vindas → identificação → 25 grupos → revisão → envio → conclusão.
 * Depende de: CONFIG, DISC_DATA, DISC_SCORING, DISC_CODEC, DISC_API (globais).
 * No Node exporta apenas as funções puras (validações, máscara, payload) para testes.
 */
(function (root) {
  'use strict';

  var CHAVE_PROGRESSO = 'disc_progresso_v1';
  var CHAVE_CONCLUIDO = 'disc_concluido_v1';
  var VALIDADE_PROGRESSO_MS = 7 * 24 * 60 * 60 * 1000;   // progresso abandonado é apagado após 7 dias
  var LETRAS = ['D', 'I', 'S', 'C'];
  var TOTAL = 25;
  // Pergunta mostrada ao candidato em cada grupo (a planilha traz títulos escritos para o avaliador).
  // A pontuação continua mapeada pela letra de cada palavra, então o cálculo não muda.
  var PERGUNTAS = [
    'Costumo agir de forma...',
    'Eu me sinto confortável com...',
    'Eu desejo...',
    'Sob estresse, posso me tornar...',
    'Minha principal característica é ser...',
    'Em um conflito, sou alguém que...',
    'Meu ponto forte é ser...',
    'Diante de um erro, sou alguém que...',
    'Sob estresse, também posso ficar...',
    'Às vezes, posso ser visto(a) como...',
    'Eu preciso de...',
    'Uma limitação minha é ser...',
    'Tenho medo de...',
    'Meço meu desempenho por meio de...',
    'Com pessoas que lidero, costumo ser...',
    'Meu jeito de trabalhar é...',
    'Outra limitação minha é ser...',
    'Tenho mais dificuldade com...',
    'Também meço meu desempenho por meio de...',
    'Prefiro tarefas...',
    'Diante de atrasos, sou alguém que...',
    'Em situações extremas, sou alguém que...',
    'Preciso melhorar...',
    'Em uma discussão, sou alguém que...',
    'Quando vou às compras, sou alguém que...'
  ];

  // Textos das palavras corrigidos para exibição (concordância). Chave: índice do grupo + letra.
  var AJUSTES_PALAVRAS = { '19I': 'Relacionadas a pessoas' };

  function perguntaDoGrupo(i, grupo) {
    return PERGUNTAS[i] || (grupo && grupo.titulo ? String(grupo.titulo).replace(/\.{4,}/g, '...') : '');
  }

  function palavraDoGrupo(i, grupo, letra) {
    return AJUSTES_PALAVRAS[i + letra] || (grupo ? grupo[letra] : '');
  }

  var ROTULOS = {
    4: 'Mais me identifica',
    3: 'Me identifica',
    2: 'Me identifica pouco',
    1: 'Menos me identifica'
  };

  /* ------------------------------------------------------------------ */
  /* Funções puras (testáveis no Node)                                   */
  /* ------------------------------------------------------------------ */

  function contarLetras(texto) {
    var m;
    try { m = String(texto).match(new RegExp('\\p{L}', 'gu')); } catch (e) { m = String(texto).match(/[A-Za-zÀ-ÖØ-öø-ÿ]/g); }
    return m ? m.length : 0;
  }

  function normalizarNome(nome) {
    return String(nome || '').replace(/\s+/g, ' ').trim();
  }

  // Retorna mensagem de erro (string) ou '' se válido.
  function validarNome(nome) {
    var n = normalizarNome(nome);
    if (!n) return 'Informe seu nome completo.';
    var palavras = n.split(' ').filter(function (p) { return contarLetras(p) > 0; });
    if (palavras.length < 2) return 'Informe nome e sobrenome.';
    if (contarLetras(n) < 5) return 'O nome precisa ter pelo menos 5 letras.';
    if (/[0-9]/.test(n)) return 'O nome não deve conter números.';
    return '';
  }

  // Remove tudo que não é dígito e o DDI 55 quando presente. Retorna DDD + número.
  function limparTelefone(tel) {
    var d = String(tel || '').replace(/\D/g, '');
    if (d.length > 11 && d.indexOf('55') === 0) d = d.slice(2);
    if (d.length > 11 && d.charAt(0) === '0') d = d.replace(/^0+/, '');
    return d;
  }

  function validarTelefone(tel) {
    var d = limparTelefone(tel);
    if (!d) return 'Informe seu telefone com DDD.';
    if (d.length < 10 || d.length > 11) return 'Telefone inválido: use DDD + número, ex.: (11) 99999-8888.';
    if (d.charAt(0) === '0') return 'Informe o DDD sem o zero, ex.: (11) 99999-8888.';
    if (d.length === 11 && d.charAt(2) !== '9') return 'Celular com 11 dígitos deve começar com 9 após o DDD.';
    if (d.length === 10 && /[6-9]/.test(d.charAt(2))) return 'Confira o número: celulares têm 9 dígitos após o DDD.';
    return '';
  }

  // Máscara progressiva: (11) 9999-8888 ou (11) 99999-8888.
  function formatarTelefone(tel) {
    var d = limparTelefone(tel).slice(0, 11);
    if (!d) return '';
    if (d.length <= 2) return '(' + d;
    var ddd = d.slice(0, 2), resto = d.slice(2);
    if (resto.length <= 4) return '(' + ddd + ') ' + resto;
    var corte = resto.length === 9 ? 5 : 4;
    return '(' + ddd + ') ' + resto.slice(0, corte) + '-' + resto.slice(corte);
  }

  // Telefone salvo com 55 na frente (12 ou 13 dígitos).
  function telefoneParaSalvar(tel) {
    return '55' + limparTelefone(tel);
  }

  function gerarId() {
    var aleatorio = Math.random().toString(36).slice(2, 8);
    try {
      if (root.crypto && root.crypto.getRandomValues) {
        var a = new Uint32Array(1);
        root.crypto.getRandomValues(a);
        aleatorio = a[0].toString(36);
      }
    } catch (e) { /* usa Math.random */ }
    return Date.now().toString(36) + '-' + aleatorio;
  }

  function embaralhar(lista, aleatorio) {
    var rnd = aleatorio || Math.random;
    var a = lista.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // Ordem das 4 letras de cada um dos 25 grupos (gerada uma vez por candidato).
  function gerarPermutacoes(aleatorio) {
    var out = [];
    for (var i = 0; i < TOTAL; i++) out.push(embaralhar(LETRAS, aleatorio));
    return out;
  }

  // selecao: letras na ordem em que foram tocadas (4, 3, 2, 1). Retorna {D,I,S,C} ou null.
  function selecaoParaGrupo(selecao) {
    if (!selecao || selecao.length !== 4) return null;
    var g = {};
    selecao.forEach(function (letra, idx) { g[letra] = 4 - idx; });
    return g;
  }

  // Ao escolher a 3ª palavra, a última recebe 1 automaticamente.
  function escolher(selecao, letra) {
    var s = (selecao || []).slice();
    if (s.indexOf(letra) !== -1 || s.length >= 4) return s;
    s.push(letra);
    if (s.length === 3) {
      var resto = LETRAS.filter(function (l) { return s.indexOf(l) === -1; });
      if (resto.length === 1) s.push(resto[0]);
    }
    return s;
  }

  function montarPayload(dados, selecoes, agora) {
    var respostas = selecoes.map(selecaoParaGrupo);
    var scoring = root.DISC_SCORING || (typeof require === 'function' ? require('./scoring.js') : null);
    var res = scoring.calcular(respostas);
    var fim = agora || new Date();
    var inicio = dados.inicio ? new Date(dados.inicio) : fim;
    return {
      v: 1,
      id: dados.id,
      nome: normalizarNome(dados.nome),
      telefone: telefoneParaSalvar(dados.telefone),
      vaga: String(dados.vaga || '').trim(),
      consentimento: !!dados.consentimento,
      inicio: inicio.toISOString(),
      fim: fim.toISOString(),
      duracaoSeg: Math.max(0, Math.round((fim.getTime() - inicio.getTime()) / 1000)),
      respostas: scoring.compactar(respostas),
      resultado: { percentuais: res.percentuais, codigo: res.codigo }
    };
  }

  function escapar(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Mensagem de erro de envio para o candidato: falhas de conexão/tempo são mostradas;
  // erros técnicos (configuração, servidor) viram uma orientação genérica.
  function mensagemErroEnvio(msg) {
    msg = String(msg || '');
    if (/conex|conectar|internet|demorou|ocupado|Muitos envios/i.test(msg)) return msg;
    return 'Não conseguimos enviar agora. Toque em "Gerar código de resultado" e envie o código ao recrutador.';
  }

  // Progresso salvo há mais de 7 dias (ou sem data) é considerado vencido.
  function progressoExpirado(p, agora) {
    if (!p || typeof p !== 'object') return true;
    var ref = Date.parse(p.salvoEm || p.inicio || '');
    if (isNaN(ref)) return !!(p.nome || p.telefone);
    return (agora || Date.now()) - ref > VALIDADE_PROGRESSO_MS;
  }

  var PURAS = {
    validarNome: validarNome,
    normalizarNome: normalizarNome,
    validarTelefone: validarTelefone,
    limparTelefone: limparTelefone,
    formatarTelefone: formatarTelefone,
    telefoneParaSalvar: telefoneParaSalvar,
    gerarId: gerarId,
    embaralhar: embaralhar,
    gerarPermutacoes: gerarPermutacoes,
    escolher: escolher,
    selecaoParaGrupo: selecaoParaGrupo,
    montarPayload: montarPayload,
    escapar: escapar,
    perguntaDoGrupo: perguntaDoGrupo,
    palavraDoGrupo: palavraDoGrupo,
    mensagemErroEnvio: mensagemErroEnvio,
    progressoExpirado: progressoExpirado,
    PERGUNTAS: PERGUNTAS,
    ROTULOS: ROTULOS
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PURAS;
    return;
  }
  root.DISC_APP = PURAS;
  if (typeof document === 'undefined') return;

  /* ------------------------------------------------------------------ */
  /* Navegador                                                           */
  /* ------------------------------------------------------------------ */

  var CONFIG = root.CONFIG || {};
  var DATA = root.DISC_DATA;
  var app, aviso;
  var estado;
  var envio = { carregando: false, erro: '' };

  function estadoInicial() {
    return {
      etapa: 'boasvindas',
      id: '',
      nome: '',
      telefone: '',
      vaga: '',
      consentimento: false,
      inicio: '',
      permutacoes: null,
      selecoes: [],
      grupo: 0,
      voltarParaRevisao: false
    };
  }

  function lerStorage(chave) {
    try {
      var v = root.localStorage.getItem(chave);
      return v ? JSON.parse(v) : null;
    } catch (e) { return null; }
  }
  function gravarStorage(chave, valor) {
    try { root.localStorage.setItem(chave, JSON.stringify(valor)); } catch (e) { /* sem armazenamento */ }
  }
  function apagarStorage(chave) {
    try { root.localStorage.removeItem(chave); } catch (e) { /* ignora */ }
  }
  // Conclusão: fica só nesta aba (sessionStorage), para não expor dados ao próximo usuário do aparelho.
  function lerSessao(chave) {
    try {
      var v = root.sessionStorage.getItem(chave);
      return v ? JSON.parse(v) : null;
    } catch (e) { return null; }
  }
  function gravarSessao(chave, valor) {
    try { root.sessionStorage.setItem(chave, JSON.stringify(valor)); } catch (e) { /* sem armazenamento */ }
  }
  function apagarSessao(chave) {
    try { root.sessionStorage.removeItem(chave); } catch (e) { /* ignora */ }
  }

  function salvar() {
    if (estado.etapa === 'boasvindas' && !estado.id) return;
    var copia = {};
    for (var k in estado) if (k !== 'concluido' && Object.prototype.hasOwnProperty.call(estado, k)) copia[k] = estado[k];
    copia.salvoEm = new Date().toISOString();
    gravarStorage(CHAVE_PROGRESSO, copia);
  }

  function progressoValido(p) {
    return p && typeof p === 'object' && Array.isArray(p.selecoes) &&
      (!p.permutacoes || (Array.isArray(p.permutacoes) && p.permutacoes.length === TOTAL));
  }

  function temProgresso(p) {
    return progressoValido(p) && (p.nome || p.selecoes.some(function (s) { return s && s.length; }));
  }

  function anunciar(msg) {
    if (!aviso) return;
    aviso.textContent = '';
    setTimeout(function () { aviso.textContent = msg; }, 30);
  }

  function irPara(etapa) {
    estado.etapa = etapa;
    salvar();
    render(true);
  }

  function nomeEmpresa() {
    return CONFIG.EMPRESA ? String(CONFIG.EMPRESA) : '';
  }

  function grupoCompleto(i) {
    var s = estado.selecoes[i];
    return !!(s && s.length === 4);
  }

  function gruposRespondidos() {
    var n = 0;
    for (var i = 0; i < TOTAL; i++) if (grupoCompleto(i)) n++;
    return n;
  }

  function primeiroIncompleto() {
    for (var i = 0; i < TOTAL; i++) if (!grupoCompleto(i)) return i;
    return -1;
  }

  /* -------------------------- Render ------------------------------- */

  function render(focar) {
    var html;
    switch (estado.etapa) {
      case 'identificacao': html = telaIdentificacao(); break;
      case 'teste': html = telaGrupo(); break;
      case 'revisao': html = telaRevisao(); break;
      case 'enviando': html = telaEnvio(); break;
      case 'concluido': html = telaConclusao(); break;
      default: html = telaBoasVindas();
    }
    app.innerHTML = html;
    // Largura da página depende da tela (boas-vindas é mais larga, como o login do BI).
    try { document.body.setAttribute('data-etapa', estado.etapa || 'boasvindas'); } catch (e) { /* ignora */ }
    ligarEventos();
    if (focar) {
      var titulo = app.querySelector('h1');
      if (titulo) {
        titulo.setAttribute('tabindex', '-1');
        try { titulo.focus({ preventScroll: true }); } catch (e) { titulo.focus(); }
      }
      try { root.scrollTo(0, 0); } catch (e) { /* ignora */ }
    }
  }

  // Passos do processo, em cartões numerados (1º preto, demais brancos), como no login do BI.
  var PASSOS = ['Seus dados', 'Ordene 25 grupos de palavras', 'Pronto, ~10 minutos'];

  function telaBoasVindas() {
    var salvo = lerStorage(CHAVE_PROGRESSO);
    var continuar = temProgresso(salvo);
    var empresa = nomeEmpresa();
    var passos = PASSOS.map(function (t, k) {
      return '<li class="passo' + (k === 0 ? ' passo--preto' : '') + '"><span class="passo-num" aria-hidden="true">' + (k + 1) + '</span><span class="passo-texto">' + t + '</span></li>';
    }).join('');
    return '' +
      '<section class="entrada-tela surgir" aria-labelledby="titulo">' +
        '<div class="entrada-amarela">' +
          '<span class="brilho brilho--claro" aria-hidden="true"></span>' +
          '<span class="brilho brilho--escuro" aria-hidden="true"></span>' +
          '<span class="marca marca--preta" aria-hidden="true"></span>' +
          '<div class="entrada-corpo">' +
            '<p class="sobretitulo">' + (empresa ? 'Processo seletivo · ' + escapar(empresa) : 'Processo seletivo') + '</p>' +
            '<h1 id="titulo">Teste de Perfil Comportamental DISC</h1>' +
            '<p class="frase-impacto">Conhecer seu jeito de trabalhar é o primeiro passo.</p>' +
            '<ol class="passos" aria-label="Como funciona">' + passos + '</ol>' +
          '</div>' +
        '</div>' +
        '<div class="entrada-preta area-preta">' +
          '<p class="destaque">Este teste ajuda a entender como você costuma agir, se comunicar e trabalhar em equipe.</p>' +
          '<ul class="lista-info">' +
            '<li><strong>Leva cerca de 10 minutos.</strong> Faça com calma, em um lugar tranquilo.</li>' +
            '<li><strong>São 25 grupos de 4 palavras.</strong> Em cada grupo, toque primeiro na palavra que <em>mais</em> combina com você, depois na próxima, e assim por diante.</li>' +
            '<li><strong>Não há respostas certas ou erradas.</strong> Responda pensando em como você realmente é, e não em como gostaria de ser.</li>' +
            '<li>Seu progresso fica salvo neste aparelho por até 7 dias caso a página seja fechada, e é apagado ao concluir.</li>' +
          '</ul>' +
          (continuar
            ? '<div class="acoes acoes-coluna">' +
                '<button type="button" class="botao botao--amarelo botao--grande" data-acao="continuar">Continuar de onde parei</button>' +
                '<button type="button" class="botao botao--contorno botao--grande" data-acao="recomecar">Começar do zero</button>' +
              '</div>'
            : '<div class="acoes acoes-coluna"><button type="button" class="botao botao--amarelo botao--grande" data-acao="comecar">Começar</button></div>') +
        '</div>' +
      '</section>';
  }

  function telaIdentificacao() {
    return '' +
      '<section class="caixa caixa--ampla surgir" aria-labelledby="titulo">' +
        '<p class="selo etapa">Etapa 1 de 3</p>' +
        '<h1 id="titulo" class="titulo-pagina">Sua identificação</h1>' +
        '<p class="texto-medio subtitulo">Precisamos destes dados para vincular o resultado à sua candidatura.</p>' +
        '<form id="form-identificacao" class="formulario" novalidate>' +
          '<div class="campo">' +
            '<label class="campo__rotulo" for="nome">Nome completo <span class="obrigatorio" aria-hidden="true">*</span></label>' +
            '<input class="entrada" id="nome" name="nome" type="text" autocomplete="name" autocapitalize="words" required maxlength="120" ' +
              'aria-describedby="erro-nome" value="' + escapar(estado.nome) + '">' +
            '<p class="campo__erro erro" id="erro-nome" role="alert"></p>' +
          '</div>' +
          '<div class="campo">' +
            '<label class="campo__rotulo" for="telefone">Telefone (WhatsApp) com DDD <span class="obrigatorio" aria-hidden="true">*</span></label>' +
            '<input class="entrada" id="telefone" name="telefone" type="tel" inputmode="numeric" autocomplete="tel-national" required maxlength="25" ' +
              'placeholder="(11) 99999-8888" aria-describedby="dica-telefone erro-telefone" value="' + escapar(formatarTelefone(estado.telefone)) + '">' +
            '<p class="campo__ajuda" id="dica-telefone">Somente números, com DDD.</p>' +
            '<p class="campo__erro erro" id="erro-telefone" role="alert"></p>' +
          '</div>' +
          '<div class="campo">' +
            '<label class="campo__rotulo" for="vaga">Vaga ou cargo <span class="texto-suave">(opcional)</span></label>' +
            '<input class="entrada" id="vaga" name="vaga" type="text" autocomplete="organization-title" maxlength="80" value="' + escapar(estado.vaga) + '">' +
          '</div>' +
          '<div class="campo consentimento">' +
            '<label class="marcar" for="consentimento">' +
              '<input id="consentimento" name="consentimento" type="checkbox" required aria-describedby="erro-consentimento"' + (estado.consentimento ? ' checked' : '') + '>' +
              '<span>Autorizo o uso dos meus dados (nome, telefone e respostas) <strong>apenas neste processo seletivo</strong>' +
                (nomeEmpresa() ? ' da ' + escapar(nomeEmpresa()) : '') +
                '. Sei que eles serão <strong>excluídos ao final do processo</strong>, conforme a LGPD.</span>' +
            '</label>' +
            '<p class="campo__erro erro" id="erro-consentimento" role="alert"></p>' +
          '</div>' +
          '<div class="acoes">' +
            '<button type="button" class="botao botao--claro botao--grande" data-acao="voltar-inicio">Voltar</button>' +
            '<button type="submit" class="botao botao--preto botao--grande">' + (estado.voltarParaRevisao ? 'Salvar e voltar à revisão' : 'Iniciar teste') + '</button>' +
          '</div>' +
        '</form>' +
      '</section>';
  }

  function textoRotulo(n) { return ROTULOS[n] || ''; }

  function telaGrupo() {
    var i = estado.grupo;
    var g = DATA.grupos[i];
    var ordem = estado.permutacoes[i];
    var sel = estado.selecoes[i] || [];
    var completo = sel.length === 4;
    var pct = Math.round(((i + (completo ? 1 : 0)) / TOTAL) * 100);
    var visivel = Math.max(pct, 8);
    var proxima = 4 - sel.length;
    var instrucao = completo
      ? 'Pronto! Confira a ordem e avance.'
      : 'Toque na palavra que <strong>' + (sel.length === 0 ? 'mais' : 'mais, entre as restantes,') + '</strong> combina com você (' + proxima + ' · ' + textoRotulo(proxima) + ').';

    function botaoPalavra(letra) {
      var pos = sel.indexOf(letra);
      var nota = pos === -1 ? 0 : 4 - pos;
      var escolhida = nota > 0;
      var texto = escapar(palavraDoGrupo(i, g, letra));
      return '' +
        '<li>' +
          '<button type="button" class="palavra' + (escolhida ? ' escolhida nota-' + nota : '') + '" data-letra="' + letra + '"' +
            ' aria-pressed="' + (escolhida ? 'true' : 'false') + '"' +
            (escolhida ? ' aria-label="' + texto + ': ' + nota + ', ' + textoRotulo(nota) + '"' : '') +
            (completo && !escolhida ? ' disabled' : '') + '>' +
            '<span class="palavra-corpo">' +
              '<span class="palavra-texto">' + texto + '</span>' +
              (escolhida ? '<span class="selo-rotulo" aria-hidden="true">' + textoRotulo(nota) + '</span>' : '') +
            '</span>' +
            (escolhida
              ? '<span class="selo-num" aria-hidden="true">' + nota + '</span>'
              : '<span class="selo-vazio" aria-hidden="true"></span>') +
          '</button>' +
        '</li>';
    }

    // Escolhidas formam a pilha (4 → 1); as restantes ficam abaixo, na ordem embaralhada.
    var pilha = sel.map(botaoPalavra).join('');
    var restantes = ordem.filter(function (l) { return sel.indexOf(l) === -1; }).map(botaoPalavra).join('');

    var ultimo = i === TOTAL - 1;
    return '' +
      '<section class="caixa caixa--ampla tela-grupo" aria-labelledby="titulo">' +
        '<div class="progresso">' +
          '<div class="progresso-topo"><span>Grupo ' + (i + 1) + ' de ' + TOTAL + '</span><span class="texto-suave">' + pct + '%</span></div>' +
          '<div class="progresso-barra" role="progressbar" aria-label="Progresso do teste" aria-valuemin="0" aria-valuemax="' + TOTAL + '" aria-valuenow="' + (i + (completo ? 1 : 0)) + '" aria-valuetext="Grupo ' + (i + 1) + ' de ' + TOTAL + '">' +
            '<span class="progresso-trilho hachura-clara"></span>' +
            '<span class="progresso-feito" style="width:' + visivel + '%"></span>' +
            '<span class="progresso-ponto vidro-claro" style="left:' + (visivel - 0.5) + '%"><i></i><i></i><i></i></span>' +
          '</div>' +
        '</div>' +
        '<h1 id="titulo" class="titulo-grupo">' + escapar(perguntaDoGrupo(i, g)) + '</h1>' +
        '<p class="instrucao" id="instrucao">' + instrucao + '</p>' +
        (pilha ? '<ol class="pilha" aria-label="Sua ordem">' + pilha + '</ol>' : '') +
        (restantes ? '<ul class="palavras" aria-describedby="instrucao">' + restantes + '</ul>' : '') +
        '<div class="acoes-grupo">' +
          '<button type="button" class="botao botao--link" data-acao="refazer"' + (sel.length ? '' : ' disabled') + '>↺ Refazer grupo</button>' +
        '</div>' +
        '<div class="acoes">' +
          '<button type="button" class="botao botao--claro botao--grande" data-acao="anterior">Voltar</button>' +
          '<button type="button" class="botao botao--preto botao--grande" data-acao="proximo"' + (completo ? '' : ' disabled') + '>' +
            (estado.voltarParaRevisao || ultimo ? 'Revisar respostas' : 'Avançar') +
          '</button>' +
        '</div>' +
      '</section>';
  }

  function telaRevisao() {
    var linhas = DATA.grupos.map(function (g, i) {
      var sel = estado.selecoes[i] || [];
      var completo = sel.length === 4;
      var conteudo = completo
        ? '<ol class="revisao-ordem">' + sel.map(function (l, k) {
            return '<li><span class="mini-nota nota-' + (4 - k) + '" aria-hidden="true">' + (4 - k) + '</span> ' + escapar(palavraDoGrupo(i, g, l)) + '</li>';
          }).join('') + '</ol>'
        : '<p class="erro-inline">Grupo incompleto</p>';
      return '' +
        '<li class="revisao-item' + (completo ? '' : ' incompleto') + '">' +
          '<div class="revisao-cab">' +
            '<span class="revisao-num">' + (i + 1) + '.</span> ' +
            '<span class="revisao-titulo">' + escapar(perguntaDoGrupo(i, g)) + '</span>' +
            '<button type="button" class="botao botao--link botao--pequeno" data-acao="editar-grupo" data-grupo="' + i + '" aria-label="Alterar grupo ' + (i + 1) + '">Alterar</button>' +
          '</div>' +
          conteudo +
        '</li>';
    }).join('');
    var faltando = TOTAL - gruposRespondidos();
    return '' +
      '<section class="caixa caixa--ampla surgir" aria-labelledby="titulo">' +
        '<p class="selo etapa">Etapa 3 de 3</p>' +
        '<h1 id="titulo" class="titulo-pagina">Revise suas respostas</h1>' +
        '<div class="resumo-dados">' +
          '<dl>' +
            '<div><dt>Nome</dt><dd>' + escapar(normalizarNome(estado.nome)) + '</dd></div>' +
            '<div><dt>Telefone</dt><dd>' + escapar(formatarTelefone(estado.telefone)) + '</dd></div>' +
            (estado.vaga ? '<div><dt>Vaga</dt><dd>' + escapar(estado.vaga) + '</dd></div>' : '') +
          '</dl>' +
          '<button type="button" class="botao botao--link botao--pequeno" data-acao="editar-dados">Alterar dados</button>' +
        '</div>' +
        '<p class="texto-medio">Em cada grupo, a ordem vai do <strong>4 (mais me identifica)</strong> ao <strong>1 (menos me identifica)</strong>. Se quiser, altere algum grupo antes de enviar.</p>' +
        '<ol class="revisao-lista">' + linhas + '</ol>' +
        (envio.erro ? '<div class="aviso aviso--erro alerta" role="alert">' + escapar(envio.erro) + '</div>' : '') +
        (faltando ? '<p class="campo__erro erro" role="alert">Faltam ' + faltando + ' grupo(s) para concluir.</p>' : '') +
        '<div class="acoes">' +
          '<button type="button" class="botao botao--claro botao--grande" data-acao="voltar-teste">Voltar</button>' +
          '<button type="button" class="botao botao--preto botao--grande" data-acao="enviar"' + (faltando ? ' disabled' : '') + '>Enviar respostas</button>' +
        '</div>' +
      '</section>';
  }

  function telaEnvio() {
    if (envio.carregando || !envio.erro) {
      return '' +
        '<section class="caixa caixa--ampla centro surgir" aria-labelledby="titulo" aria-busy="true">' +
          '<div class="giro giro--grande" aria-hidden="true"></div>' +
          '<h1 id="titulo" class="titulo-pagina">Enviando suas respostas…</h1>' +
          '<p class="texto-medio">Isso leva só alguns segundos. Não feche esta página.</p>' +
        '</section>';
    }
    return '' +
      '<section class="caixa caixa--ampla surgir" aria-labelledby="titulo">' +
        '<h1 id="titulo" class="titulo-pagina">Não foi possível enviar</h1>' +
        '<div class="aviso aviso--erro alerta" role="alert">' + escapar(envio.erro) + '</div>' +
        '<p class="texto-medio">Suas respostas continuam salvas neste aparelho. Você pode tentar de novo ou gerar um código de resultado para enviar ao recrutador.</p>' +
        '<div class="acoes acoes-coluna">' +
          '<button type="button" class="botao botao--preto botao--grande" data-acao="retentar">Tentar novamente</button>' +
          '<button type="button" class="botao botao--claro botao--grande" data-acao="usar-codigo">Gerar código de resultado</button>' +
          '<button type="button" class="botao botao--link" data-acao="voltar-revisao">Voltar à revisão</button>' +
        '</div>' +
      '</section>';
  }

  function blocoPerfil(payload) {
    var res;
    try { res = root.DISC_SCORING.calcular(root.DISC_SCORING.descompactar(payload.respostas)); } catch (e) { return ''; }
    var p = DATA.perfis[res.primario];
    var s = DATA.perfis[res.secundario];
    var barras = LETRAS.map(function (l) {
      var perfil = DATA.perfis[l];
      var v = res.percentuais[l];
      return '' +
        '<li class="barra-linha">' +
          '<span class="letra-disc disc-' + l + ' barra-letra">' + l + '</span>' +
          '<span class="barra-nome">' + escapar(perfil.nome) + '</span>' +
          '<span class="barra-trilho hachura-clara" aria-hidden="true"><span class="barra-valor disc-' + l + '" style="width:' + Math.max(4, Math.min(100, (v / 40) * 100)) + '%"></span></span>' +
          '<span class="barra-pct">' + String(v).replace('.', ',') + '%</span>' +
        '</li>';
    }).join('');
    var pontos = (p.positivos || []).slice(0, 6).map(function (t) { return '<li class="selo">' + escapar(t) + '</li>'; }).join('');
    return '' +
      '<section class="caixa caixa--ampla perfil surgir" aria-labelledby="titulo-perfil">' +
        '<h2 id="titulo-perfil" class="caixa__titulo">Seu perfil predominante</h2>' +
        '<p class="perfil-titulo"><span class="letra-disc disc-' + res.primario + ' badge">' + res.primario + '</span> ' +
          '<span>' + escapar(p.rotulo) + ' <span class="perfil-sub">(' + escapar(p.nome) + '), com traços de ' + escapar(s.rotulo) + '</span></span></p>' +
        '<ul class="barras">' + barras + '</ul>' +
        (pontos ? '<h3 class="perfil-h3">Pontos fortes</h3><ul class="tags">' + pontos + '</ul>' : '') +
      '</section>';
  }

  function linkWhatsApp(codigo, payload) {
    var num = String(CONFIG.WHATSAPP_RECRUTADOR || '').replace(/\D/g, '');
    if (!num) return '';
    var texto = 'Olá! Concluí o teste DISC.\nNome: ' + payload.nome + '\nTelefone: ' + formatarTelefone(payload.telefone) +
      (payload.vaga ? '\nVaga: ' + payload.vaga : '') + '\n\nCódigo de resultado:\n' + codigo;
    return 'https://wa.me/' + num + '?text=' + encodeURIComponent(texto);
  }

  function telaConclusao() {
    var dados = estado.concluido || lerSessao(CHAVE_CONCLUIDO);
    if (!dados || (!dados.payload && !dados.enviado)) { estado = estadoInicial(); return telaBoasVindas(); }
    var payload = dados.payload || null;
    var enviado = !!dados.enviado;
    var primeiroNome = payload ? normalizarNome(payload.nome).split(' ')[0] : String(dados.primeiroNome || '');
    var titulo = primeiroNome ? 'Obrigado, ' + escapar(primeiroNome) + '!' : 'Obrigado!';
    var rodape = '' +
      '<div class="rodape">' +
        '<p class="rodape-nota">Seus dados serão usados apenas neste processo seletivo e excluídos ao final.</p>' +
        '<button type="button" class="botao botao--link" data-acao="novo-teste">Iniciar um novo teste neste aparelho</button>' +
      '</div>';
    function agradecimento(texto) {
      return '' +
        '<section class="caixa caixa--gradiente caixa--ampla agradecimento surgir" aria-labelledby="titulo">' +
          '<div class="icone-ok" aria-hidden="true">✓</div>' +
          '<h1 id="titulo" class="titulo-pagina">' + titulo + '</h1>' +
          '<p class="destaque">' + texto + '</p>' +
        '</section>';
    }

    if (enviado) {
      // Enviado com sucesso: nenhum dado pessoal fica guardado nem é exibido (aparelho pode ser compartilhado).
      return '' +
        '<div class="pilha-telas">' +
          agradecimento('Suas respostas foram enviadas com sucesso. O recrutador entrará em contato pelo telefone informado.') +
          (CONFIG.MOSTRAR_RESULTADO_AO_CANDIDATO && payload ? blocoPerfil(payload) : '') +
          rodape +
        '</div>';
    }

    var codigo = root.DISC_CODEC.encode(payload);
    var wa = linkWhatsApp(codigo, payload);
    var semContato = !wa;
    return '' +
      '<div class="pilha-telas">' +
        agradecimento('Você concluiu o teste. Para finalizar, envie o código abaixo ao recrutador' +
          (semContato ? ' pelo mesmo canal (WhatsApp ou e-mail) em que você recebeu o link deste teste.' : '.')) +
        (CONFIG.MOSTRAR_RESULTADO_AO_CANDIDATO ? blocoPerfil(payload) : '') +
        '<section class="caixa caixa--ampla codigo-bloco surgir" aria-label="Código de resultado">' +
          '<label class="caixa__titulo" for="codigo">Código de resultado</label>' +
          '<p class="campo__ajuda dica" id="dica-codigo">' +
            'Copie o código e envie ao recrutador' + (wa ? ', ou use o botão do WhatsApp.' : '.') +
            ' Por segurança, ele deixa de aparecer quando esta aba for fechada.</p>' +
          '<textarea id="codigo" class="entrada codigo" readonly rows="4" aria-describedby="dica-codigo" spellcheck="false">' + escapar(codigo) + '</textarea>' +
          '<div class="acoes acoes-coluna">' +
            (wa ? '<a class="botao botao--amarelo botao--grande btn-whatsapp" href="' + escapar(wa) + '" target="_blank" rel="noopener noreferrer">Enviar pelo WhatsApp</a>' : '') +
            '<button type="button" class="botao ' + (wa ? 'botao--claro' : 'botao--preto') + ' botao--grande" data-acao="copiar">Copiar código</button>' +
          '</div>' +
          '<p class="sucesso" id="copiado" role="status" aria-live="polite"></p>' +
        '</section>' +
        rodape +
      '</div>';
  }

  /* -------------------------- Eventos ------------------------------ */

  function ligarEventos() {
    var form = app.querySelector('#form-identificacao');
    if (form) {
      var tel = form.querySelector('#telefone');
      tel.addEventListener('input', function () {
        var antes = tel.value;
        var fmt = formatarTelefone(antes);
        if (fmt !== antes) {
          tel.value = fmt;
          try { tel.setSelectionRange(fmt.length, fmt.length); } catch (e) { /* ignora */ }
        }
      });
      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        enviarIdentificacao(form);
      });
      ['nome', 'telefone', 'vaga'].forEach(function (campo) {
        form.querySelector('#' + campo).addEventListener('change', function () {
          estado[campo] = campo === 'telefone' ? limparTelefone(this.value) : this.value;
          salvar();
        });
      });
    }
  }

  function mostrarErro(form, campo, msg) {
    var el = form.querySelector('#erro-' + campo);
    var input = form.querySelector('#' + campo);
    if (el) el.textContent = msg;
    if (input) {
      if (msg) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    }
    return !msg;
  }

  function enviarIdentificacao(form) {
    var nome = form.querySelector('#nome').value;
    var tel = form.querySelector('#telefone').value;
    var vaga = form.querySelector('#vaga').value;
    var cons = form.querySelector('#consentimento').checked;
    var okNome = mostrarErro(form, 'nome', validarNome(nome));
    var okTel = mostrarErro(form, 'telefone', validarTelefone(tel));
    var okCons = mostrarErro(form, 'consentimento', cons ? '' : 'Para continuar, marque a autorização de uso dos dados.');
    if (!okNome || !okTel || !okCons) {
      var primeiro = form.querySelector('[aria-invalid="true"]');
      if (primeiro) primeiro.focus();
      return;
    }
    estado.nome = normalizarNome(nome);
    estado.telefone = limparTelefone(tel);
    estado.vaga = String(vaga || '').trim();
    estado.consentimento = true;
    if (!estado.id) estado.id = gerarId();
    if (!estado.permutacoes) estado.permutacoes = gerarPermutacoes();
    if (!estado.inicio) estado.inicio = new Date().toISOString();
    if (estado.voltarParaRevisao) {
      estado.voltarParaRevisao = false;
      irPara('revisao');
      return;
    }
    var p = primeiroIncompleto();
    estado.grupo = p === -1 ? 0 : p;
    irPara(p === -1 ? 'revisao' : 'teste');
  }

  function aoClicar(ev) {
    var alvo = ev.target.closest('button, a[data-acao]');
    if (!alvo || !app.contains(alvo) || alvo.disabled) return;

    if (alvo.classList.contains('palavra')) {
      tocarPalavra(alvo.getAttribute('data-letra'));
      return;
    }
    var acao = alvo.getAttribute('data-acao');
    if (!acao) return;

    switch (acao) {
      case 'comecar':
        if (estado.etapa === 'concluido') estado = estadoInicial();
        irPara('identificacao');
        break;
      case 'continuar':
        estado = lerStorage(CHAVE_PROGRESSO) || estadoInicial();
        if (!progressoValido(estado)) estado = estadoInicial();
        if (estado.etapa === 'boasvindas' || estado.etapa === 'concluido') estado.etapa = 'identificacao';
        if (estado.etapa === 'enviando') estado.etapa = 'revisao';
        if (estado.etapa === 'teste' && !estado.permutacoes) estado.etapa = 'identificacao';
        render(true);
        break;
      case 'recomecar':
        apagarStorage(CHAVE_PROGRESSO);
        estado = estadoInicial();
        irPara('identificacao');
        break;
      case 'voltar-inicio':
        guardarCamposForm();
        estado.voltarParaRevisao = false;
        irPara('boasvindas');
        break;
      case 'refazer':
        estado.selecoes[estado.grupo] = [];
        salvar();
        render(false);
        focarPrimeiraPalavra();
        anunciar('Grupo reiniciado. Escolha novamente a palavra que mais combina com você.');
        break;
      case 'anterior':
        if (estado.voltarParaRevisao) { estado.voltarParaRevisao = false; irPara('revisao'); }
        else if (estado.grupo === 0) irPara('identificacao');
        else { estado.grupo--; irPara('teste'); }
        break;
      case 'proximo':
        if (!grupoCompleto(estado.grupo)) return;
        if (estado.voltarParaRevisao || estado.grupo === TOTAL - 1) {
          estado.voltarParaRevisao = false;
          var falta = primeiroIncompleto();
          if (falta !== -1 && falta > estado.grupo) { estado.grupo = falta; irPara('teste'); }
          else irPara('revisao');
        } else {
          estado.grupo++;
          irPara('teste');
        }
        break;
      case 'editar-grupo':
        estado.grupo = Number(alvo.getAttribute('data-grupo')) || 0;
        estado.voltarParaRevisao = true;
        irPara('teste');
        break;
      case 'editar-dados':
        estado.voltarParaRevisao = true;
        irPara('identificacao');
        break;
      case 'voltar-teste':
        envio = { carregando: false, erro: '' };
        var inc = primeiroIncompleto();
        estado.grupo = inc === -1 ? TOTAL - 1 : inc;
        irPara('teste');
        break;
      case 'enviar':
      case 'retentar':
        concluir();
        break;
      case 'usar-codigo':
        finalizar(montarPayload(estado, estado.selecoes), false);
        break;
      case 'voltar-revisao':
        envio = { carregando: false, erro: '' };
        irPara('revisao');
        break;
      case 'copiar':
        copiarCodigo();
        break;
      case 'novo-teste':
        // Confirmação em dois toques (sem confirm() do navegador)
        if (alvo.getAttribute('data-confirmar') !== 'sim') {
          alvo.setAttribute('data-confirmar', 'sim');
          alvo.textContent = 'Toque de novo para confirmar';
          return;
        }
        apagarSessao(CHAVE_CONCLUIDO);
        apagarStorage(CHAVE_CONCLUIDO);
        apagarStorage(CHAVE_PROGRESSO);
        estado = estadoInicial();
        render(true);
        break;
    }
  }

  function guardarCamposForm() {
    var form = app.querySelector('#form-identificacao');
    if (!form) return;
    estado.nome = form.querySelector('#nome').value;
    estado.telefone = limparTelefone(form.querySelector('#telefone').value);
    estado.vaga = form.querySelector('#vaga').value;
    estado.consentimento = form.querySelector('#consentimento').checked;
  }

  function focarPrimeiraPalavra() {
    var b = app.querySelector('.palavra:not(.escolhida)') || app.querySelector('.palavra');
    if (b) b.focus();
  }

  function tocarPalavra(letra) {
    var i = estado.grupo;
    var antes = estado.selecoes[i] || [];
    if (antes.indexOf(letra) !== -1 || antes.length >= 4) return;
    var depois = escolher(antes, letra);
    estado.selecoes[i] = depois;
    salvar();
    render(false);
    var g = DATA.grupos[i];
    var nota = 4 - depois.indexOf(letra);
    var msg = palavraDoGrupo(i, g, letra) + ': ' + nota + ', ' + textoRotulo(nota) + '.';
    if (depois.length === 4) {
      var ultima = depois[3];
      msg += ' ' + palavraDoGrupo(i, g, ultima) + ' recebeu 1, ' + textoRotulo(1) + '. Grupo completo.';
      var prox = app.querySelector('[data-acao="proximo"]');
      if (prox) prox.focus();
    } else {
      focarPrimeiraPalavra();
    }
    anunciar(msg);
  }

  function finalizar(payload, enviado) {
    var concluido = { payload: payload, enviado: enviado };
    // Só o necessário, só nesta aba: com envio confirmado não guarda nome, telefone nem respostas;
    // sem envio guarda o payload para o código continuar visível se a página for recarregada.
    gravarSessao(CHAVE_CONCLUIDO, enviado
      ? { enviado: true, primeiroNome: normalizarNome(payload.nome).split(' ')[0] }
      : { enviado: false, payload: payload });
    apagarStorage(CHAVE_CONCLUIDO);
    apagarStorage(CHAVE_PROGRESSO);
    estado.concluido = concluido;
    envio = { carregando: false, erro: '' };
    estado.etapa = 'concluido';
    render(true);
  }

  function concluir() {
    if (envio.carregando) return;
    if (primeiroIncompleto() !== -1) { irPara('revisao'); return; }
    var payload;
    try {
      payload = montarPayload(estado, estado.selecoes);
    } catch (e) {
      envio = { carregando: false, erro: 'Encontramos um problema nas respostas. Revise os grupos e tente novamente.' };
      irPara('revisao');
      return;
    }
    var api = root.DISC_API;
    var temApi = CONFIG.API_URL && String(CONFIG.API_URL).trim() && api;
    if (!temApi) { finalizar(payload, false); return; }

    envio = { carregando: true, erro: '' };
    irPara('enviando');
    api.enviar(payload).then(function () {
      finalizar(payload, true);
    }, function (erro) {
      var msg = (erro && erro.message) || 'Erro desconhecido.';
      // Se uma tentativa anterior chegou ao servidor, o id já existe: tratar como sucesso.
      if (/duplicad|já (foi )?(recebid|registrad|enviad|existe)/i.test(msg)) { finalizar(payload, true); return; }
      if (root.console && root.console.warn) root.console.warn('Falha no envio do teste DISC:', msg);
      envio = { carregando: false, erro: mensagemErroEnvio(msg) };
      estado.etapa = 'enviando';
      render(true);
    });
  }

  function copiarCodigo() {
    var ta = app.querySelector('#codigo');
    var status = app.querySelector('#copiado');
    if (!ta) return;
    var texto = ta.value;
    function ok() { if (status) status.textContent = 'Código copiado!'; }
    function manual() {
      ta.focus();
      ta.select();
      var copiou = false;
      try { copiou = document.execCommand('copy'); } catch (e) { copiou = false; }
      if (copiou) ok();
      else if (status) status.textContent = 'Selecione o código e copie manualmente.';
    }
    if (root.navigator && root.navigator.clipboard && root.isSecureContext) {
      root.navigator.clipboard.writeText(texto).then(ok, manual);
    } else {
      manual();
    }
  }

  function iniciar() {
    app = document.getElementById('app');
    aviso = document.getElementById('aviso');
    if (!app) return;
    if (!DATA || !root.DISC_SCORING || !root.DISC_CODEC) {
      app.innerHTML = '<section class="caixa caixa--ampla"><h1 class="titulo-pagina">Não foi possível carregar o teste</h1><p class="texto-medio">Atualize a página. Se o problema continuar, avise o recrutador.</p></section>';
      return;
    }
    var empresa = nomeEmpresa();
    var selo = document.getElementById('topo-empresa');
    if (selo && empresa) { selo.textContent = empresa; selo.hidden = false; }
    if (empresa) document.title = 'Teste DISC · ' + empresa;

    estado = estadoInicial();
    // Versões antigas guardavam a conclusão (com dados pessoais) no localStorage: remove.
    apagarStorage(CHAVE_CONCLUIDO);
    var salvo = lerStorage(CHAVE_PROGRESSO);
    if (salvo && (!progressoValido(salvo) || progressoExpirado(salvo))) apagarStorage(CHAVE_PROGRESSO);
    var concluido = lerSessao(CHAVE_CONCLUIDO);
    if (concluido && (concluido.payload || concluido.enviado)) {
      estado.concluido = concluido;
      estado.etapa = 'concluido';
    }
    app.addEventListener('click', aoClicar);
    render(false);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})(typeof self !== 'undefined' ? self : this);
