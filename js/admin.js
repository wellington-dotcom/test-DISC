/*
 * Painel — participantes, filtros, detalhe com confiabilidade, Guia para a Liderança, comparativo, CSV,
 * e (admin) processos seletivos (config + ClickUp + editor do relatório) e usuários.
 * Segurança: todo dado do participante entra no DOM via textContent / setAttribute (nunca innerHTML).
 *   A pré-visualização do relatório usa DISC_RELATORIO_VIEW.montarHtml (que escapa tudo) dentro de um iframe.
 * Modo com API (CONFIG.API_URL preenchido): login por e-mail e senha; o token da sessão fica no sessionStorage
 *   e vai explícito em cada chamada do DISC_API. Só administradores usam o painel (o papel "gestor" foi
 *   desativado nesta versão: o login de um gestor é recusado na tela).
 * Modo sem API: importação de códigos DISC1.* guardados em localStorage (status/observações locais).
 * Com o Supabase (CONFIG.BACKEND 'supabase' / DISC_API.MODO === 'supabase', js/api-supabase.js): o login é o do
 *   Supabase Auth. Some o "Primeiro acesso" com chave (o primeiro usuário a entrar vira admin pela RPC
 *   garantir_primeiro_admin, feita dentro de DISC_API.login, que avisa com resp.primeiroAdmin === true);
 *   aparece "Esqueci minha senha" (DISC_API.recuperarSenha(email, enderecoDoPainel)); a volta do e-mail
 *   (#type=recovery ou #type=invite) mostra "Defina sua nova senha" (DISC_API.definirNovaSenha(senha) ->
 *   {ok, token?, usuario?}); a aba Usuários convida por e-mail (DISC_API.convidarUsuario(token, {nome, email}))
 *   e remove (DISC_API.excluirUsuario), sem redefinir senha manual.
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
  var PAPEIS = { admin: 'Administrador', gestor: 'Gestor (desativado nesta versão)' };
  var MSG_SO_ADMIN = 'Este painel é só para administradores. O acesso de gestor foi desativado nesta versão.';
  var MSG_SEM_ACESSO_SUPABASE = 'Este e-mail ainda não tem acesso ao painel. Peça a um administrador para convidar você pela aba Usuários.';
  var MSG_PRIMEIRO_ADMIN = 'Primeiro acesso: você agora é o administrador do painel. Convide a equipe na aba Usuários.';
  var MSG_LINK_EXPIRADO = 'O link do e-mail expirou ou já foi usado. Peça um novo em "Esqueci minha senha".';
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
          DISC_CONFIABILIDADE: './confiabilidade.js', DISC_VALIDACAO: './validacao.js',
          DISC_EXIGIDO: './disc-exigido.js', DISC_COMBINACOES: './disc-combinacoes.js', DISC_INTENSIDADE: './disc-intensidade.js'
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
    if (r.origem === 'pessoal') return 'Mapa pessoal (venda direta)';
    var av = r.avaliacaoNome ? String(r.avaliacaoNome) : (r.avaliacao ? 'Avaliação ' + r.avaliacao : 'Link geral');
    return [av, r.empresaNome ? String(r.empresaNome) : ''].filter(Boolean).join(' · ');
  }

  // Busca da lista: nome/vaga/função/empresa/avaliação (texto), telefone (3+ dígitos) ou protocolo
  // (ignora maiúsculas e espaços). A idade NÃO entra na busca.
  function correspondeBusca(r, busca) {
    var termo = String(busca == null ? '' : busca).trim().toLowerCase();
    if (!termo) return true;
    var alvo = [r.nome, r.vaga, r.funcao, r.empresa, r.avaliacaoNome, r.empresaNome, r.email]
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
  function confiabilidade(respostas, validacao, duracaoSeg) {
    var CF = dep('DISC_CONFIABILIDADE');
    if (!CF || typeof CF.avaliar !== 'function') return null;
    var d = Number(duracaoSeg);
    try { return CF.avaliar(respostas, lerValidacao(validacao), isFinite(d) && d > 0 ? { duracaoSeg: d } : undefined); } catch (e) { return null; }
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
    r.conf = confiabilidade(r.respostas, r.validacao, r.duracaoSeg);
    return r;
  }

  // Selo do card: Alta verde, Média cinza, Baixa vermelho; sem dados = sem selo (null).
  function seloConfiabilidade(conf) {
    if (!conf || !Object.prototype.hasOwnProperty.call(CLASSE_CONF, conf.nivel)) return null;
    return { texto: 'Confiabilidade ' + NIVEIS_CONF[conf.nivel].toLowerCase(), classe: CLASSE_CONF[conf.nivel], nivel: conf.nivel };
  }

  // Abas que cada papel vê. Sem API (modo local) não há login: lista, comparativo e importação.
  // Com API, só o administrador usa o painel (gestor desativado nesta versão).
  // vendas: true quando o servidor tem a API de vendas (DISC_API.listarPedidos) — a aba Vendas vem depois de Relatórios.
  // conexoes: true quando o servidor tem a aba Conexões (DISC_API.diagnosticoConexoes) — sempre a última aba.
  function abasDoPapel(papel, modoApi, vendas, conexoes) {
    if (!modoApi) return ['lista', 'comparativo', 'importar'];
    if (papel === 'admin') return ['lista', 'processos', 'empresas', 'relatorios'].concat(vendas ? ['vendas'] : []).concat(['usuarios', 'comparativo', 'importar']).concat(conexoes ? ['conexoes'] : []);
    return [];
  }

  // O que cada papel pode fazer na tela (o servidor confere de novo).
  function permissoes(papel, modoApi) {
    var admin = !modoApi || papel === 'admin';
    return {
      excluir: admin,
      importar: admin,
      criar: !!modoApi && papel === 'admin',
      statusObservacoes: admin
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

  // Link público do relatório: pasta da página atual + relatorio.html?r=TOKEN.
  function linkRelatorio(href, token) {
    var base = String(href || '').split('#')[0].split('?')[0].replace(/[^/]*$/, '');
    return base + 'relatorio.html?r=' + encodeURIComponent(String(token || ''));
  }

  // Endereço devolvido pelo servidor: absoluto fica como está; relativo (sem SITE_URL) vira absoluto a partir do painel.
  function urlAbsoluta(url, href) {
    var u = String(url || '');
    if (/^https?:\/\//i.test(u)) return u;
    var base = String(href || '').split('#')[0].split('?')[0].replace(/[^/]*$/, '');
    return base + u.replace(/^\.?\//, '');
  }

  function empresaDe(p) { return p ? String(p.empresa || p.empresaNome || '') : ''; }

  // Texto para colar no WhatsApp (convite do participante).
  function mensagemConvite(av, link) {
    var empresa = empresaDe(av);
    var nome = av && (av.vaga || av.nome) ? String(av.vaga || av.nome) : '';
    if (av && av.tipo === 'equipe') {
      return 'Olá! ' + (empresa ? 'A ' + empresa + ' está' : 'Estamos') + ' fazendo uma avaliação de perfil da equipe' +
        (av.nome ? ' (' + av.nome + ')' : '') + '. Responda pelo link abaixo:\n' + link +
        '\n\nLeva cerca de 10 minutos e não existe resposta certa ou errada. Faça com calma, num lugar tranquilo.';
    }
    return 'Olá! Para seguir no processo seletivo' + (nome ? ' de ' + nome : '') + (empresa ? ' da ' + empresa : '') +
      ', responda o questionário de perfil pelo link abaixo:\n' + link +
      '\n\nLeva cerca de 10 minutos e não existe resposta certa ou errada. Faça com calma, num lugar tranquilo.';
  }

  // Mensagem pronta para o contratante receber o relatório publicado.
  function mensagemRelatorio(processo, url) {
    var p = processo || {};
    var contratante = String(p.contratante || '').trim().split(/\s+/)[0] || '';
    var vaga = String(p.vaga || p.nome || '').trim();
    var empresa = empresaDe(p).trim();
    var consultor = String(p.consultor || '').trim();
    return 'Olá' + (contratante ? ', ' + contratante : '') + '! O relatório do processo seletivo' +
      (vaga ? ' de ' + vaga : '') + (empresa ? ' (' + empresa + ')' : '') + ' está pronto:\n' + url +
      '\n\nAbre no celular ou no computador e dá para salvar em PDF. Qualquer dúvida, estou à disposição.' +
      '\n' + (consultor ? consultor + ' · ' : '') + 'Gestão sem Caos';
  }

  /* ---------- Processo: config (perfil ideal, etapas, bônus, cortes) ---------- */

  // Mesmos termos do servidor (Code.gs, TERMOS_SENSIVEIS): campo do ClickUp com esses nomes nunca é usado.
  var TERMOS_SENSIVEIS = ['sexo', 'genero', 'estado civil', 'filho', 'religi', 'gravid', 'etnia', 'raca',
    'cor da pele', 'orientacao', 'deficien', 'doenca', 'saude', 'antecedente', 'processo em seu nome', 'criminal'];
  var TERMOS_ANTECEDENTES = ['antecedente', 'processo em seu nome', 'criminal'];

  // minúsculas, sem acento, espaços simples
  function normalizarNome(s) {
    var t = String(s == null ? '' : s).toLowerCase();
    try { t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (e) { /* navegador antigo */ }
    return t.replace(/\s+/g, ' ').trim();
  }

  // true se o nome do campo do ClickUp é dado sensível (antecedentes só com config.permitirAntecedentes).
  function campoSensivel(nome, config) {
    var n = normalizarNome(nome);
    if (!n) return false;
    var cfg = config || {};
    return TERMOS_SENSIVEIS.some(function (t) {
      if (n.indexOf(t) === -1) return false;
      if (TERMOS_ANTECEDENTES.indexOf(t) !== -1 && cfg.permitirAntecedentes === true) return false;
      if (t === 'saude' && cfg.permitirSaude === true) return false;
      return true;
    });
  }

  // 'dc', 'C D', 'cdx' -> 'DC', 'CD', 'CD' (1 ou 2 letras D/I/S/C, sem repetir)
  function normalizarPerfilIdeal(v) {
    var out = '';
    String(v == null ? '' : v).toUpperCase().replace(/[^DISC]/g, '').split('').forEach(function (l) {
      if (out.length < 2 && out.indexOf(l) === -1) out += l;
    });
    return out;
  }

  // Toque numa letra: tira se já está; põe se cabe; com 2 letras, troca a segunda.
  function alternarLetraPerfil(atual, letra) {
    var p = normalizarPerfilIdeal(atual);
    if (LETRAS.indexOf(letra) === -1) return p;
    if (p.indexOf(letra) !== -1) return p.replace(letra, '');
    if (p.length < 2) return p + letra;
    return p.charAt(0) + letra;
  }

  // 'CD' -> 'C (Conformidade) como traço principal e D (Dominância) como segundo traço.'
  function explicarPerfil(codigo) {
    var p = normalizarPerfilIdeal(codigo);
    if (!p) return 'Escolha 1 ou 2 letras. A primeira é o traço principal que a vaga pede.';
    var t = p.charAt(0) + ' (' + NOMES[p.charAt(0)] + ') como traço principal';
    if (p.length === 2) t += ' e ' + p.charAt(1) + ' (' + NOMES[p.charAt(1)] + ') como segundo traço';
    return t + '.';
  }

  // Peso de cada etapa em % do total (1 casa). Pesos inválidos contam 0.
  function pesosNormalizados(etapas) {
    var lista = Array.isArray(etapas) ? etapas : [];
    var pesos = lista.map(function (e) { var n = Number(e && e.peso); return isFinite(n) && n > 0 ? n : 0; });
    var soma = pesos.reduce(function (a, b) { return a + b; }, 0);
    return pesos.map(function (p) { return soma ? Math.round(p / soma * 1000) / 10 : 0; });
  }

  // id simples a partir do nome ('Revisão documental' -> 'revisao_documental'), único entre os usados.
  function idSimples(nome, usados, prefixo) {
    var base = normalizarNome(nome).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30) || (prefixo || 'item');
    var id = base, i = 2;
    while (usados && usados[id]) id = base + '_' + (i++);
    if (usados) usados[id] = true;
    return id;
  }

  function numeroOuNulo(v) {
    if (v === '' || v === null || v === undefined) return null;
    var n = Number(String(v).replace(',', '.'));
    return isFinite(n) ? n : null;
  }

  // Confere a config antes de mandar ao servidor (que confere de novo). '' se ok, senão a mensagem.
  function validarConfig(c) {
    if (!c || typeof c !== 'object') return 'Configuração do processo inválida.';
    var perfil = String(c.perfilIdeal || '');
    if (perfil && normalizarPerfilIdeal(perfil) !== perfil) return 'Perfil ideal inválido: use 1 ou 2 letras entre D, I, S e C.';
    var etapas = Array.isArray(c.etapas) ? c.etapas : [];
    var bonus = Array.isArray(c.bonus) ? c.bonus : [];
    for (var i = 0; i < etapas.length; i++) {
      var e = etapas[i] || {};
      if (!String(e.nome || '').trim()) return 'Dê um nome para a etapa ' + (i + 1) + '.';
      if (!(Number(e.peso) >= 0) || e.peso === null || e.peso === '') return 'Informe o peso da etapa "' + e.nome + '".';
      if (campoSensivel(e.campo, c)) return 'O campo "' + e.campo + '" é um dado sensível e não pode ser usado.';
    }
    for (var j = 0; j < bonus.length; j++) {
      var b = bonus[j] || {};
      if (!String(b.nome || '').trim()) return 'Dê um nome para o bônus ' + (j + 1) + '.';
      if (!String(b.campo || '').trim()) return 'Informe o campo do ClickUp do bônus "' + b.nome + '".';
      if (campoSensivel(b.campo, c)) return 'O campo "' + b.campo + '" é um dado sensível e não pode ser usado.';
      var r = b.regra || {};
      if (r.tipo === 'mapa') {
        if (!r.pontos || !Object.keys(r.pontos).length) return 'Informe ao menos um valor com pontos no bônus "' + b.nome + '".';
      } else if (!isFinite(Number(r.pontos)) || r.pontos === null || r.pontos === '') {
        return 'Informe os pontos do bônus "' + b.nome + '".';
      }
    }
    var corte = Number(c.corte), faixa = Number(c.faixaAvaliar);
    if (!isFinite(corte) || corte < 0 || c.corte === null || c.corte === '') return 'Informe a nota de corte.';
    if (!isFinite(faixa) || faixa < 0 || c.faixaAvaliar === null || c.faixaAvaliar === '') return 'Informe a nota da faixa "avaliar".';
    if (faixa > corte) return 'A faixa "avaliar" precisa ser menor ou igual à nota de corte.';
    return validarFormulario(c.formulario);
  }

  // Config vazia de um processo novo (o servidor completa com os mesmos padrões).
  function configPadrao() {
    return { perfilIdeal: '', explicacaoPerfil: '', etapas: [], bonus: [], corte: 70, faixaAvaliar: 55, statusFinalistas: [], permitirAntecedentes: false,
      formulario: formularioPadrao() };
  }

  /* ---------- Formulário do processo: o que perguntar ao candidato (config.formulario) ---------- */

  // Nome completo e WhatsApp são sempre pedidos (não configuráveis).
  var CAMPOS_FORMULARIO = [
    { chave: 'idade', rotulo: 'Idade' },
    { chave: 'funcao', rotulo: 'Função atual ou última' },
    { chave: 'empresa', rotulo: 'Empresa atual ou última' },
    { chave: 'email', rotulo: 'E-mail' },
    { chave: 'cidade', rotulo: 'Cidade onde mora' },
    { chave: 'foto', rotulo: 'Foto' }
  ];
  var MODOS_CAMPO = { obrigatorio: 'Obrigatória', opcional: 'Opcional', oculto: 'Não perguntar' };
  var MAX_PERGUNTAS = 5;

  // Padrão = comportamento antigo: idade obrigatória, função e empresa opcionais, e-mail e cidade não perguntados.
  function formularioPadrao() {
    return { campos: { idade: 'obrigatorio', funcao: 'opcional', empresa: 'opcional', email: 'oculto', cidade: 'oculto', foto: 'opcional' }, perguntas: [], parte2: 'desligada' };
  }

  // Mesma regra de classificar_campo do servidor: termo sensível no começo de uma palavra (sem acento, sem pontuação).
  // Pergunta ao candidato nunca tem exceção (nem saúde nem antecedentes).
  function perguntaSensivel(texto) {
    var n = ' ' + normalizarNome(texto).replace(/[^a-z0-9%]+/g, ' ').trim();
    if (!n.trim()) return false;
    return TERMOS_SENSIVEIS.some(function (t) { return n.indexOf(' ' + t) !== -1; });
  }

  function msgPerguntaSensivel(texto) {
    return 'A pergunta "' + String(texto == null ? '' : texto).trim() + '" pede um dado sensível e não pode ser usada.';
  }

  // Ausente/inválido -> padrão. Perguntas: texto aparado, vazias saem, até 5, id ^[a-z0-9_]{1,20}$ (p1..p5 se faltar/repetir).
  function normalizarFormulario(f) {
    var pad = formularioPadrao();
    var out = { campos: {}, perguntas: [], parte2: f && typeof f === 'object' && f.parte2 === 'ligada' ? 'ligada' : 'desligada' };
    var campos = f && typeof f === 'object' && f.campos && typeof f.campos === 'object' ? f.campos : {};
    CAMPOS_FORMULARIO.forEach(function (c) {
      out.campos[c.chave] = Object.prototype.hasOwnProperty.call(MODOS_CAMPO, campos[c.chave]) ? campos[c.chave] : pad.campos[c.chave];
    });
    var lista = f && Array.isArray(f.perguntas) ? f.perguntas : [];
    var usados = {};
    lista.forEach(function (p) {
      if (!p || typeof p !== 'object' || out.perguntas.length >= MAX_PERGUNTAS) return;
      var texto = String(p.texto == null ? '' : p.texto).replace(/\s+/g, ' ').trim();
      if (!texto) return;
      var id = String(p.id == null ? '' : p.id);
      if (!/^[a-z0-9_]{1,20}$/.test(id) || usados[id]) id = '';
      out.perguntas.push({ id: id, texto: texto, obrigatoria: p.obrigatoria === true });
      if (id) usados[id] = true;
    });
    out.perguntas.forEach(function (p) {
      if (p.id) return;
      var k = 1;
      while (usados['p' + k]) k++;
      p.id = 'p' + k;
      usados[p.id] = true;
    });
    return out;
  }

  // '' se ok, senão a mensagem (mesmas regras do servidor).
  function validarFormulario(f) {
    if (f == null) return '';
    if (typeof f !== 'object') return 'Formulário do processo inválido.';
    var campos = f.campos || {};
    for (var i = 0; i < CAMPOS_FORMULARIO.length; i++) {
      var v = campos[CAMPOS_FORMULARIO[i].chave];
      if (v != null && !Object.prototype.hasOwnProperty.call(MODOS_CAMPO, v)) return 'Escolha se "' + CAMPOS_FORMULARIO[i].rotulo + '" é obrigatória, opcional ou não perguntada.';
    }
    if (f.parte2 != null && !Object.prototype.hasOwnProperty.call(PARTE2, f.parte2)) return 'Escolha se a segunda parte do teste fica ligada ou desligada.';
    var lista = Array.isArray(f.perguntas) ? f.perguntas : [];
    if (lista.length > MAX_PERGUNTAS) return 'Use no máximo ' + MAX_PERGUNTAS + ' perguntas extras.';
    for (var j = 0; j < lista.length; j++) {
      var texto = String((lista[j] && lista[j].texto) || '').replace(/\s+/g, ' ').trim();
      if (texto.length < 3 || texto.length > 200) return 'Escreva a pergunta extra ' + (j + 1) + ' (de 3 a 200 caracteres).';
      if (perguntaSensivel(texto)) return msgPerguntaSensivel(texto);
    }
    return '';
  }

  // Resumo do que o candidato responde: [{rotulo, modo, texto}] na ordem do formulário (Nome e WhatsApp sempre).
  function resumoFormulario(f) {
    var n = normalizarFormulario(f);
    var out = [
      { rotulo: 'Nome completo', modo: 'sempre', texto: 'Sempre pedido' },
      { rotulo: 'WhatsApp', modo: 'sempre', texto: 'Sempre pedido' }
    ];
    CAMPOS_FORMULARIO.forEach(function (c) {
      var m = n.campos[c.chave];
      out.push({ rotulo: c.rotulo, modo: m, texto: MODOS_CAMPO[m] });
    });
    n.perguntas.forEach(function (p) {
      out.push({ rotulo: p.texto, modo: p.obrigatoria ? 'obrigatorio' : 'opcional', texto: p.obrigatoria ? 'Obrigatória' : 'Opcional', extra: true });
    });
    return out;
  }

  /* ---------- Parte 2: perfil exigido pelo trabalho (DISC_EXIGIDO) ---------- */

  var PARTE2 = { desligada: 'Desligada', ligada: 'Ligada' };
  var ROTULO_PARTE2 = 'Segunda parte do teste (perfil exigido pelo trabalho)';
  var FAIXAS_ESFORCO = { baixa: 'Esforço baixo', moderada: 'Esforço moderado', alta: 'Esforço alto', muito_alta: 'Esforço muito alto' };
  var CLASSE_ESFORCO = { baixa: 'selo--verde', moderada: '', alta: 'selo--laranja', muito_alta: 'selo--vermelho' };

  // Ao CRIAR: ligada para avaliação de equipe, desligada para seleção. Ao editar, o valor salvo manda (não muda sozinho).
  function parte2Padrao(tipo) { return tipo === 'equipe' ? 'ligada' : 'desligada'; }

  function textoParte2(parte2) {
    return parte2 === 'ligada'
      ? 'Ligada: depois dos 25 grupos, a pessoa responde mais 10 pensando em como o trabalho exige que ela seja.'
      : 'Desligada: só o perfil natural (25 grupos).';
  }

  function pctValido(p) {
    return !!(p && typeof p === 'object' && LETRAS.every(function (l) { return typeof p[l] === 'number' && isFinite(p[l]); }));
  }

  // Perfil exigido de uma resposta: recalcula da string `exigido` (40 dígitos) quando o módulo existe; senão usa resultadoExigido.
  function exigidoDoRegistro(r) {
    if (!r) return null;
    var EX = dep('DISC_EXIGIDO');
    var s = typeof r.exigido === 'string' ? r.exigido : '';
    if (s && EX && typeof EX.validar === 'function' && typeof EX.calcular === 'function') {
      try { if (EX.validar(s)) { var c = EX.calcular(s); if (c && pctValido(c.percentuais)) return { percentuais: c.percentuais, codigo: c.codigo || '' }; } } catch (e) { /* cai no resultadoExigido */ }
    }
    var x = r.resultadoExigido || (r.exigido && typeof r.exigido === 'object' ? r.exigido : null);
    return x && pctValido(x.percentuais) ? { percentuais: x.percentuais, codigo: String(x.codigo || '') } : null;
  }

  // Eixos ritmo × foco (−100..100) pela convenção do DISC_EXIGIDO (= js/compatibilidade.js): ritmo = (D+I)−(S+C), + acelerado;
  // foco = (D+C)−(I+S), + tarefas. Sem o módulo, a mesma conta aqui.
  function eixosDe(p) {
    if (!pctValido(p)) return null;
    var EX = dep('DISC_EXIGIDO');
    if (EX && typeof EX.eixos === 'function') { try { var e = EX.eixos(p); if (e && isFinite(e.ritmo) && isFinite(e.foco)) return { ritmo: e.ritmo, foco: e.foco }; } catch (er) { /* fallback */ } }
    return { ritmo: Math.round((p.D + p.I - p.S - p.C) * 10) / 10, foco: Math.round((p.D + p.C - p.I - p.S) * 10) / 10 };
  }

  // Esforço de adaptação natural → exigido (DISC_EXIGIDO.adaptacao). null sem os dois perfis ou sem o módulo.
  function esforcoDe(natural, exigido) {
    var EX = dep('DISC_EXIGIDO');
    var n = natural && natural.percentuais ? natural.percentuais : natural;
    var x = exigido && exigido.percentuais ? exigido.percentuais : exigido;
    if (!pctValido(n) || !pctValido(x) || !EX || typeof EX.adaptacao !== 'function') return null;
    try {
      var a = EX.adaptacao(n, x);
      if (!a || !isFinite(a.indice)) return null;
      return a;
    } catch (e) { return null; }
  }

  function rotuloEsforco(faixa) { return FAIXAS_ESFORCO[faixa] || 'Esforço'; }

  // Nome Notus da combinação (DISC_COMBINACOES); '' se o módulo não existe ou o código é desconhecido.
  function nomeCombinacao(codigo) {
    var CB = dep('DISC_COMBINACOES');
    if (!codigo || !CB || typeof CB.nome !== 'function') return '';
    try { var n = CB.nome(String(codigo)); return n && n.nome ? String(n.nome) : ''; } catch (e) { return ''; }
  }

  // Pontos do mapa ritmo × foco (DISC_RELATORIO_VIEW.mapaRitmoFocoHtml) a partir dos colaboradores de listarEquipe.
  function pontosMapaEquipe(colaboradores) {
    var out = [];
    (colaboradores || []).forEach(function (c) {
      var res = c && c.resultado && pctValido(c.resultado.percentuais) ? c.resultado : null;
      if (!res) return;
      var pt = { id: String(c.pessoaId), nome: c.nome, codigo: res.codigo || '', natural: eixosDe(res.percentuais) };
      var ex = c.exigido && pctValido(c.exigido.percentuais) ? c.exigido : null;
      if (ex) pt.exigido = eixosDe(ex.percentuais);
      out.push(pt);
    });
    return out;
  }

  // Esforço por colaborador (só quem tem Parte 2), do maior para o menor.
  function esforcoEquipe(colaboradores) {
    var out = [];
    (colaboradores || []).forEach(function (c) {
      if (!c || !c.resultado || !c.exigido) return;
      var a = esforcoDe(c.resultado, c.exigido);
      if (a) out.push({ pessoaId: String(c.pessoaId), nome: c.nome, cargo: c.cargo || '', indice: a.indice, faixa: a.faixa, maisCobrado: a.maisCobrado || null, menosUsado: a.menosUsado || null });
    });
    return out.sort(function (a, b) { return b.indice - a.indice || String(a.nome).localeCompare(String(b.nome)); });
  }

  // Frase curta: qual fator o trabalho mais cobra e qual fica menos usado.
  function frasesEsforco(a) {
    if (!a) return [];
    var f = [];
    if (a.maisCobrado) f.push('O trabalho pede mais ' + NOMES[a.maisCobrado] + ' (' + a.maisCobrado + ') do que o natural da pessoa.');
    if (a.menosUsado) f.push('Usa menos ' + NOMES[a.menosUsado] + ' (' + a.menosUsado + ') do que o natural no dia a dia.');
    return f;
  }

  /* ---------- Fotos (data URL JPEG 192×192, guardada no banco) ---------- */

  var FOTO_MAX = 40000;
  var FOTO_LADO = 192;
  var FOTO_ORIGINAL_MAX = 15 * 1024 * 1024;
  function fotoValida(str) {
    return typeof str === 'string' && str.length <= FOTO_MAX && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(str);
  }
  // Iniciais para o círculo sem foto: primeira letra do primeiro e do último nome.
  function iniciais(nome) {
    var p = String(nome || '').trim().split(/\s+/).filter(Boolean);
    if (!p.length) return '?';
    return (p[0].charAt(0) + (p.length > 1 ? p[p.length - 1].charAt(0) : '')).toUpperCase();
  }
  function fotoDe(r) {
    if (!r) return '';
    if (fotoValida(r.foto)) return r.foto;
    if (r.pessoa && fotoValida(r.pessoa.foto)) return r.pessoa.foto;
    return '';
  }

  /* ---------- Organograma de arrastar: relações 'lidera' ---------- */

  function liderDe(rels, id) {
    var r = (rels || []).filter(function (x) { return x.tipo === 'lidera' && String(x.para) === String(id); })[0];
    return r ? String(r.de) : null;
  }
  function lideradosDe(rels, id) {
    return (rels || []).filter(function (x) { return x.tipo === 'lidera' && String(x.de) === String(id); }).map(function (x) { return String(x.para); });
  }
  // Todos abaixo de id (liderados, liderados dos liderados…), sem repetir.
  function descendentes(rels, id) {
    var vistos = {}, fila = [String(id)], out = [];
    while (fila.length) {
      lideradosDe(rels, fila.shift()).forEach(function (x) { if (!vistos[x] && x !== String(id)) { vistos[x] = true; out.push(x); fila.push(x); } });
    }
    return out;
  }

  /* ---------- Pessoas: várias respostas da mesma pessoa (mesmo WhatsApp) ---------- */

  // Respostas extras: [{id, pergunta, resposta}] (aceita texto JSON); só as que têm pergunta.
  function lerExtras(v) {
    if (typeof v === 'string' && v) { try { v = JSON.parse(v); } catch (e) { return []; } }
    if (!Array.isArray(v)) return [];
    return v.filter(function (x) { return x && typeof x === 'object' && String(x.pergunta || '').trim(); }).map(function (x) {
      return { id: String(x.id == null ? '' : x.id), pergunta: String(x.pergunta).trim(), resposta: String(x.resposta == null ? '' : x.resposta).trim() };
    });
  }

  // Chave da pessoa: pessoaId (Supabase) ou o WhatsApp só com dígitos (Apps Script antigo). Sem nenhum: a própria resposta.
  function chavePessoa(r) {
    if (!r) return '';
    if (r.pessoaId) return 'p:' + String(r.pessoaId);
    var d = soDigitos(r.telefone);
    if ((d.length === 10 || d.length === 11) && d.indexOf('55') !== 0) d = '55' + d;
    return d ? 't:' + d : 'r:' + String(r.id);
  }

  function dataDe(r) { return String((r && (r.fim || r.recebidoEm)) || ''); }

  // Agrupa respostas por pessoa: [{chave, respostas (mais recente primeiro), atual (a mais recente), total}],
  // na ordem da resposta mais recente de cada pessoa.
  function agruparPessoas(registros) {
    var mapa = {};
    var grupos = [];
    (registros || []).forEach(function (r) {
      var k = chavePessoa(r);
      if (!mapa[k]) { mapa[k] = { chave: k, respostas: [] }; grupos.push(mapa[k]); }
      mapa[k].respostas.push(r);
    });
    grupos.forEach(function (g) {
      g.respostas.sort(function (a, b) { return dataDe(b).localeCompare(dataDe(a)); });
      g.atual = g.respostas[0];
      g.total = g.respostas.length;
    });
    grupos.sort(function (a, b) { return dataDe(b.atual).localeCompare(dataDe(a.atual)); });
    return grupos;
  }

  // Ficha da pessoa: dados de r.pessoa (quando existe e não vazio), senão os da resposta.
  function fichaPessoa(r) {
    var p = (r && r.pessoa && typeof r.pessoa === 'object') ? r.pessoa : {};
    var out = {};
    ['nome', 'telefone', 'idade', 'funcao', 'empresa', 'email', 'cidade'].forEach(function (k) {
      var v = p[k];
      out[k] = (v !== undefined && v !== null && v !== '') ? v : (r ? r[k] : undefined);
    });
    return out;
  }

  // Perfil principal entre as respostas válidas: null com menos de 2; senão {total, igual, texto}.
  function consistenciaPerfil(registros) {
    var validos = (registros || []).filter(function (r) { return r && r.calc; });
    if (validos.length < 2) return null;
    var primeiro = validos[0].calc.primario;
    var igual = validos.every(function (r) { return r.calc.primario === primeiro; });
    return {
      total: validos.length,
      igual: igual,
      texto: igual ? 'O perfil se manteve nas ' + validos.length + ' respostas.'
        : 'O perfil mudou entre as respostas: vale conversar sobre o momento de cada uma.'
    };
  }

  // Aceita o ID puro ou o endereço da lista copiado do ClickUp (…/v/li/901234…).
  function idListaDoTexto(t) {
    var s = String(t || '').trim();
    var m = /\/li\/([A-Za-z0-9_-]+)/.exec(s) || /\/l\/(?:[^/]+\/)?([A-Za-z0-9_-]+)\/?$/.exec(s);
    if (m) return m[1];
    return s.replace(/[^A-Za-z0-9_-]/g, '');
  }

  /* ---------- Editor do relatório ---------- */

  var ORIGENS = { regra: 'Automático', ia: 'Melhorado com IA', editado: 'Editado' };

  // Lista dos textos editáveis do relatório, na ordem do documento: [{id, secao, rotulo}].
  function textosEditaveis(rel) {
    var out = [];
    var vistos = {};
    var textos = (rel && rel.textos) || {};
    function add(id, secao, rotulo) {
      if (!id || vistos[id] || !Object.prototype.hasOwnProperty.call(textos, id)) return;
      vistos[id] = true;
      out.push({ id: String(id), secao: secao, rotulo: rotulo });
    }
    function arr(v) { return Array.isArray(v) ? v : []; }
    if (!rel) return out;
    var sum = rel.sumario || {};
    if (sum.recomendacao) add(sum.recomendacao.textoId, 'Sumário executivo', 'Recomendação' + (sum.recomendacao.nome ? ' · ' + sum.recomendacao.nome : ''));
    arr(sum.leituras).forEach(function (l) { add(l.textoId, 'Sumário executivo', 'Leitura · ' + (l.titulo || '')); });
    if (rel.atracao) add(rel.atracao.textoId, 'Painel de atração', 'Comentário sobre a atração');
    arr(rel.etapas).forEach(function (e) {
      arr(e.destaques).forEach(function (d) { add(d.textoId, 'Avaliação técnica', (e.nome || 'Etapa') + ' · ' + (d.titulo || '')); });
    });
    var disc = rel.disc || {};
    add(disc.explicacaoTextoId, 'Análise DISC', 'Por que este perfil');
    arr(disc.achados).forEach(function (a) { add(a.textoId, 'Análise DISC', 'Achado · ' + (a.titulo || '')); });
    arr(rel.ranking && rel.ranking.linhas).forEach(function (l) {
      add(l.analiseTextoId, 'Ranking final', l.posicao + 'º · ' + (l.nome || ''));
    });
    var enc = rel.encerramento || {};
    add(enc.textoId, 'Encerramento', 'Encerramento');
    arr(enc.proximosPassos).forEach(function (id, i) { add(id, 'Encerramento', 'Próximo passo ' + (i + 1)); });
    Object.keys(textos).forEach(function (id) { add(id, 'Outros textos', id); });
    return out;
  }

  // Grava a edição de um texto: muda o texto e marca origem 'editado'. Devolve true se mudou.
  function editarTexto(rel, id, texto) {
    if (!rel || !rel.textos || !Object.prototype.hasOwnProperty.call(rel.textos, id)) return false;
    var atual = rel.textos[id] || {};
    var novo = String(texto == null ? '' : texto);
    if (atual.texto === novo) return false;
    rel.textos[id] = { texto: novo, origem: 'editado' };
    return true;
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
      'avaliação', 'empresa da avaliação', 'confiabilidade', 'e-mail', 'cidade', 'perguntas extras'];
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
        r.avaliacaoNome || r.avaliacao || '', r.empresaNome || '', conf,
        r.email || '', r.cidade || '',
        lerExtras(r.extras).map(function (x) { return x.pergunta + ': ' + (x.resposta || '—'); }).join(' | ')
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

  /* ---------- Supabase: modo e volta dos e-mails de acesso ---------- */

  // true quando o painel fala com o Supabase (BACKEND 'supabase' no config, DISC_API.MODO ou DISC_API.backend 'supabase').
  function modoSupabase(cfg, api) {
    if (api && (api.MODO === 'supabase' || api.backend === 'supabase')) return true;
    return !!(cfg && String(cfg.BACKEND || '').trim().toLowerCase() === 'supabase');
  }

  // Lê a volta de um e-mail do Supabase Auth: "#access_token=…&type=recovery" (ou ?type=… / erro).
  // -> { tipo: 'recovery' | 'invite' | '', erro: '' | mensagem em pt-BR }
  function lerRetornoAuth(hash, search) {
    var params = {};
    [String(search || '').replace(/^\?/, ''), String(hash || '').replace(/^#/, '')].forEach(function (parte) {
      parte.split('&').forEach(function (par) {
        if (!par) return;
        var i = par.indexOf('=');
        var k = i === -1 ? par : par.slice(0, i);
        var v = i === -1 ? '' : par.slice(i + 1);
        try { k = decodeURIComponent(k); v = decodeURIComponent(v.replace(/\+/g, ' ')); } catch (e) { /* mantém cru */ }
        params[k] = v;
      });
    });
    if (params.error || params.error_code) {
      var codigo = String(params.error_code || params.error || '');
      return { tipo: '', erro: /expired|otp|access_denied/i.test(codigo) ? MSG_LINK_EXPIRADO : 'Não foi possível usar o link do e-mail. Peça um novo em "Esqueci minha senha".' };
    }
    var tipo = String(params.type || '').toLowerCase();
    return { tipo: (tipo === 'recovery' || tipo === 'invite') ? tipo : '', erro: '' };
  }

  // Endereço do painel sem consulta nem âncora (para onde o e-mail de redefinição volta).
  function enderecoPainel(href) {
    return String(href || '').split('#')[0].split('?')[0];
  }

  /* ---------- Empresas, colaboradores e ligações (funções puras) ---------- */

  // Onde a aba Empresas funciona: 'ok' (Supabase ou prévia simulada), 'legado' (Apps Script) ou 'local' (sem API).
  function modoEmpresas(modoApi, supabase, simulada) {
    if (!modoApi) return 'local';
    return supabase || simulada ? 'ok' : 'legado';
  }

  // Filtra opções {rotulo, sub?} pela busca (sem acento, sem maiúsculas; todas as palavras precisam aparecer).
  function filtrarOpcoes(opcoes, busca) {
    var termos = normalizarNome(busca).split(' ').filter(Boolean);
    if (!termos.length) return (opcoes || []).slice();
    return (opcoes || []).filter(function (o) {
      var alvo = normalizarNome([o.rotulo, o.sub, o.busca].filter(Boolean).join(' '));
      return termos.every(function (t) { return alvo.indexOf(t) !== -1; });
    });
  }

  // Empresas na ordem de nome; arquivadas no fim; busca por nome e cidade.
  function filtrarEmpresas(empresas, busca) {
    var lista = (empresas || []).map(function (e) { return { e: e, rotulo: e.nome, sub: e.cidade }; });
    return filtrarOpcoes(lista, busca).map(function (x) { return x.e; }).sort(function (a, b) {
      if ((a.ativo !== false) !== (b.ativo !== false)) return a.ativo !== false ? -1 : 1;
      return normalizarNome(a.nome).localeCompare(normalizarNome(b.nome));
    });
  }

  // Ligações de uma pessoa a partir do conjunto de relações da empresa.
  // -> { lider: id|'' , diretos: [ids], indiretos: [ids], liderados: [ids] }
  function ligacoesDe(relacoes, id) {
    var out = { lider: '', diretos: [], indiretos: [], liderados: [] };
    id = String(id);
    (relacoes || []).forEach(function (r) {
      var de = String(r.de), para = String(r.para);
      if (r.tipo === 'lidera') {
        if (para === id && !out.lider) out.lider = de;
        else if (de === id) out.liderados.push(para);
        return;
      }
      var outro = de === id ? para : (para === id ? de : '');
      if (!outro) return;
      var lista = r.tipo === 'direto' ? out.diretos : (r.tipo === 'indireto' ? out.indiretos : null);
      if (lista && lista.indexOf(outro) === -1) lista.push(outro);
    });
    out.indiretos = out.indiretos.filter(function (x) { return out.diretos.indexOf(x) === -1; });
    return out;
  }

  // Troca as ligações de uma pessoa (líder, diretos e indiretos) e devolve o novo conjunto de relações.
  // Quem ela lidera continua. Sem duplicadas, sem ligação consigo mesma; o líder não entra como direto/indireto.
  function aplicarLigacoes(relacoes, id, lig) {
    id = String(id);
    lig = lig || {};
    var lider = lig.lider ? String(lig.lider) : '';
    if (lider === id) lider = '';
    var resto = (relacoes || []).filter(function (r) {
      var de = String(r.de), para = String(r.para);
      if (r.tipo === 'lidera') {
        if (para === id) return false;
        if (lider && de === id && para === lider) return false; // evita "um lidera o outro" nos dois sentidos
        return true;
      }
      return de !== id && para !== id;
    }).map(function (r) { return { de: String(r.de), para: String(r.para), tipo: r.tipo }; });
    if (lider) resto.push({ de: lider, para: id, tipo: 'lidera' });
    var usados = {};
    usados[id] = true;
    if (lider) usados[lider] = true;
    ['diretos', 'indiretos'].forEach(function (k) {
      (lig[k] || []).forEach(function (x) {
        x = String(x);
        if (!x || usados[x]) return;
        usados[x] = true;
        resto.push({ de: id, para: x, tipo: k === 'diretos' ? 'direto' : 'indireto' });
      });
    });
    return resto;
  }

  // Relações só entre quem está na lista de ids (ex.: depois de desligar alguém).
  function relacoesEntre(relacoes, ids) {
    var ok = {};
    (ids || []).forEach(function (i) { ok[String(i)] = true; });
    return (relacoes || []).filter(function (r) { return ok[String(r.de)] && ok[String(r.para)] && String(r.de) !== String(r.para); });
  }

  // Resultado {percentuais, codigo} de um registro já recalculado (ou null).
  function resultadoDoRegistro(r) {
    return r && r.calc ? { percentuais: r.calc.percentuais, codigo: r.calc.codigo } : null;
  }

  // Entrada de DISC_COMPATIBILIDADE.montar a partir de listarEquipe (+ candidato em foco, opcional).
  function entradaCompatibilidade(empresa, colaboradores, relacoes, foco) {
    var pessoas = (colaboradores || []).map(function (c) {
      return { id: String(c.pessoaId), nome: c.nome, cargo: c.cargo || '', percentuais: c.resultado && c.resultado.percentuais ? c.resultado.percentuais : null };
    });
    var rels = (relacoes || []).map(function (r) { return { de: String(r.de), para: String(r.para), tipo: r.tipo }; });
    var out = { empresa: { nome: (empresa && empresa.nome) || '' }, pessoas: pessoas, relacoes: rels };
    if (foco) {
      pessoas.push({ id: ID_FOCO, nome: foco.nome, cargo: foco.cargo || '', percentuais: foco.resultado ? foco.resultado.percentuais : null });
      out.relacoes = rels.concat(relacoesDoFoco(foco));
      out.foco = ID_FOCO;
    }
    return out;
  }
  var ID_FOCO = 'foco';

  // Relações do candidato em foco: o líder escolhido lidera o candidato; os colegas trabalham diretamente com ele.
  function relacoesDoFoco(foco) {
    var rels = [];
    if (foco && foco.liderId) rels.push({ de: String(foco.liderId), para: ID_FOCO, tipo: 'lidera' });
    ((foco && foco.diretos) || []).forEach(function (id) {
      if (String(id) !== String(foco.liderId || '')) rels.push({ de: ID_FOCO, para: String(id), tipo: 'direto' });
    });
    return rels;
  }

  // Pessoas que já responderam (uma por pessoa, a resposta mais recente), para escolher num seletor.
  function pessoasDasRespostas(registros) {
    return agruparPessoas((registros || []).filter(function (r) { return r && r.pessoaId; })).map(function (g) {
      var r = g.atual;
      return { pessoaId: String(r.pessoaId), nome: String((r.pessoa && r.pessoa.nome) || r.nome || ''), telefone: String((r.pessoa && r.pessoa.telefone) || r.telefone || ''),
        resultado: resultadoDoRegistro(r), registroId: r.id };
    });
  }

  // Link público dos relatórios novos (equipe, liderança, pessoa): relatorio.html#r-TOKEN.
  function linkRelatorioModelo(href, token) {
    var base = String(href || '').split('#')[0].split('?')[0].replace(/[^/]*$/, '');
    return base + 'relatorio.html#r-' + encodeURIComponent(String(token || ''));
  }

  var MODELOS_REL = { equipe: 'Relatório da equipe', lideranca: 'Como liderar', pessoa: 'Relatório da pessoa (desenvolvimento)' };

  function primeiroNome(nome) { return String(nome || '').trim().split(/\s+/)[0] || ''; }

  // Mensagem de WhatsApp para enviar o relatório publicado.
  function mensagemRelatorioModelo(modelo, ctx, url) {
    ctx = ctx || {};
    var empresa = String(ctx.empresa || '').trim();
    var pessoa = primeiroNome(ctx.pessoa);
    var rodape = '\n\nAbre no celular ou no computador e dá para salvar em PDF. Qualquer dúvida, estou à disposição.\n' +
      (ctx.consultor ? String(ctx.consultor).trim() + ' · ' : '') + 'Gestão sem Caos';
    if (modelo === 'pessoa') {
      return 'Olá' + (pessoa ? ', ' + pessoa : '') + '! O seu relatório de perfil DISC, com sugestões para o seu desenvolvimento, está pronto:\n' + url + rodape;
    }
    if (modelo === 'lideranca') {
      return 'Olá! O guia de como liderar ' + (pessoa || 'o colaborador') + (empresa ? ' (' + empresa + ')' : '') + ', a partir do perfil DISC, está pronto:\n' + url + rodape;
    }
    return 'Olá! O relatório da equipe' + (empresa ? ' da ' + empresa : '') + ' (organograma, perfis DISC e compatibilidade) está pronto:\n' + url + rodape;
  }

  // Texto do processo de equipe ligado a uma empresa cadastrada.
  function textoEquipeEmpresa(nomeEmpresa) {
    return 'As respostas deste link entram no cadastro da empresa' + (nomeEmpresa ? ' ' + nomeEmpresa : '') +
      ' como colaboradores (quem ainda não está nela entra com o cargo informado). Antes de começar, o colaborador é avisado de que o resultado é compartilhado com a empresa.';
  }

  /* ---------- Aba Relatórios: catálogo dos modelos, exemplos fictícios e lista dos gerados ---------- */

  // Os 5 modelos, na ordem da tela. alvo: o que se escolhe no assistente (pessoa | colaborador | empresa | processo).
  var MODELOS_CATALOGO = [
    { chave: 'pessoa-completo', modelo: 'pessoa', variante: 'completo', titulo: 'Pessoa · completo', alvo: 'pessoa',
      paraQuem: 'Para a própria pessoa (colaborador ou candidato aprovado).',
      responde: 'Como é o meu jeito de trabalhar, meus pontos fortes, o que me desgasta e como posso me desenvolver.' },
    { chave: 'pessoa-simples', modelo: 'pessoa', variante: 'simples', titulo: 'Pessoa · simples', alvo: 'pessoa',
      paraQuem: 'Para a própria pessoa, em 2 páginas.',
      responde: 'O resumo do perfil DISC e dicas práticas para o dia a dia, para ler em poucos minutos.' },
    { chave: 'lideranca', modelo: 'lideranca', titulo: 'Como liderar', alvo: 'colaborador',
      paraQuem: 'Para o líder direto de um colaborador.',
      responde: 'Como se comunicar, delegar, dar feedback e motivar essa pessoa, e o que evitar.' },
    { chave: 'equipe', modelo: 'equipe', titulo: 'Equipe', alvo: 'empresa',
      paraQuem: 'Para o dono ou o gestor da empresa.',
      responde: 'Como a equipe se organiza, onde combina e onde pode haver atrito, o que falta no time e como liderar cada um.' },
    { chave: 'processo', modelo: 'processo', titulo: 'Processo seletivo', alvo: 'processo',
      paraQuem: 'Para quem contratou a seleção.',
      responde: 'Quem participou, como cada candidato pontuou nas etapas, a aderência ao perfil da vaga e a recomendação final.' }
  ];
  var NOMES_MODELO = { pessoa: 'Pessoa', lideranca: 'Como liderar', equipe: 'Equipe', processo: 'Processo seletivo' };

  function modeloDoCatalogo(chave) {
    return MODELOS_CATALOGO.filter(function (m) { return m.chave === chave; })[0] || null;
  }

  // Conjunto fictício fixo dos exemplos (nada de dado real).
  var EXEMPLO_EMPRESA = { nome: 'Loja Exemplo', cidade: 'Boa Vista / RR' };
  var EXEMPLO_PESSOAS = [
    { pessoaId: 'ex-1', nome: 'Marina Costa', cargo: 'Gerente da loja', resultado: { percentuais: { D: 38, I: 30, S: 14, C: 18 }, codigo: 'DI' },
      exigido: { percentuais: { D: 36, I: 24, S: 16, C: 24 }, codigo: 'DC' } },
    { pessoaId: 'ex-2', nome: 'Rafael Souza', cargo: 'Vendedor', resultado: { percentuais: { D: 20, I: 38, S: 26, C: 16 }, codigo: 'IS' } },
    { pessoaId: 'ex-3', nome: 'Paula Mendes', cargo: 'Caixa', resultado: { percentuais: { D: 12, I: 18, S: 36, C: 34 }, codigo: 'SC' } },
    { pessoaId: 'ex-4', nome: 'Tiago Ramos', cargo: 'Estoquista', resultado: { percentuais: { D: 16, I: 14, S: 30, C: 40 }, codigo: 'CS' } },
    { pessoaId: 'ex-5', nome: 'Lúcia Pereira', cargo: 'Vendedora', resultado: { percentuais: { D: 24, I: 34, S: 22, C: 20 }, codigo: 'ID' } }
  ];
  var EXEMPLO_RELACOES = [
    { de: 'ex-1', para: 'ex-2', tipo: 'lidera' }, { de: 'ex-1', para: 'ex-3', tipo: 'lidera' }, { de: 'ex-1', para: 'ex-4', tipo: 'lidera' },
    { de: 'ex-2', para: 'ex-5', tipo: 'lidera' }, { de: 'ex-3', para: 'ex-4', tipo: 'direto' }, { de: 'ex-2', para: 'ex-3', tipo: 'indireto' }
  ];

  function copiaJson(v) { return JSON.parse(JSON.stringify(v)); }

  // Dados do exemplo de um modelo. deps: {modelos: DISC_RELATORIO_MODELOS, motor?: DISC_RELATORIO, fixture?: DISC_FIXTURE_PROCESSO}.
  function exemploModelo(chave, deps) {
    deps = deps || {};
    var M = deps.modelos;
    var consultor = 'Consultor Exemplo';
    var p = EXEMPLO_PESSOAS;
    if (chave === 'processo') {
      if (!deps.motor || typeof deps.motor.montar !== 'function' || !deps.fixture) throw new Error('O exemplo do processo seletivo não carregou.');
      var fx = copiaJson(deps.fixture);
      (fx.candidatos || []).forEach(function (c) { delete c.antecedentes; delete c.foto; });
      var rel = deps.motor.montar(fx, { geradoEm: '2026-10-02T12:00:00.000Z' });
      if (rel && rel.processo) delete rel.processo.clickupListId;
      return rel;
    }
    if (!M) throw new Error('Os modelos de relatório não foram carregados (relatorio-modelos.js).');
    if (chave === 'pessoa-completo') return M.pessoa({ pessoa: copiaJson({ nome: p[0].nome, resultado: p[0].resultado, exigido: p[0].exigido }), consultor: consultor });
    if (chave === 'pessoa-simples') return M.pessoaSimples({ pessoa: copiaJson({ nome: p[0].nome, resultado: p[0].resultado }), consultor: consultor });
    if (chave === 'lideranca') {
      return M.lideranca({ pessoa: copiaJson({ nome: p[1].nome, cargo: p[1].cargo, resultado: p[1].resultado }),
        lider: copiaJson({ nome: p[0].nome, resultado: p[0].resultado }), empresa: { nome: EXEMPLO_EMPRESA.nome } });
    }
    if (chave === 'equipe') {
      return M.equipe({ empresa: copiaJson(EXEMPLO_EMPRESA), consultor: consultor, relacoes: copiaJson(EXEMPLO_RELACOES),
        colaboradores: p.map(function (x) { return copiaJson({ pessoaId: x.pessoaId, nome: x.nome, cargo: x.cargo, status: 'ativo', resultado: x.resultado }); }) });
    }
    throw new Error('Modelo desconhecido.');
  }

  // Junta os relatórios dos modelos e os dos processos numa lista só (mais recente primeiro).
  // ctx: {empresas: {id: nome}, processos: {id: {nome, empresa}}, href}
  function juntarGerados(modelosLista, processosLista, ctx) {
    ctx = ctx || {};
    var emp = ctx.empresas || {}, procs = ctx.processos || {};
    var out = [];
    (modelosLista || []).forEach(function (r) {
      var pub = r.status === 'publicado';
      out.push({ id: 'm:' + r.id, relId: r.id, tipo: 'modelo', modelo: r.modelo, token: r.token || '', titulo: r.titulo || MODELOS_REL[r.modelo] || 'Relatório',
        empresa: r.empresaId ? String(emp[r.empresaId] || '') : '', empresaId: r.empresaId || '', pessoaId: r.pessoaId || '',
        status: pub ? 'publicado' : 'rascunho', data: String(r.atualizadoEm || r.publicadoEm || r.criadoEm || ''),
        url: pub ? (r.url ? urlAbsoluta(r.url, ctx.href) : linkRelatorioModelo(ctx.href, r.token)) : '' });
    });
    (processosLista || []).forEach(function (r) {
      var pub = r.status === 'publicado';
      var p = procs[r.processoId] || {};
      out.push({ id: 'p:' + r.token, tipo: 'processo', modelo: 'processo', token: r.token, processoId: r.processoId || '',
        titulo: p.nome ? 'Processo seletivo · ' + p.nome : 'Processo seletivo', empresa: String(p.empresa || ''),
        status: pub ? 'publicado' : 'rascunho', data: String(r.publicadoEm || r.atualizadoEm || r.criadoEm || ''),
        url: pub ? linkRelatorio(ctx.href, r.token) : '' });
    });
    return out.sort(function (a, b) { return b.data.localeCompare(a.data); });
  }

  // Filtro da lista dos gerados: modelo ('' = todos), empresa (nome, sem acento/maiúsculas), status.
  function filtrarGerados(lista, filtro) {
    filtro = filtro || {};
    var emp = semAcento(filtro.empresa);
    return (lista || []).filter(function (r) {
      if (filtro.modelo && r.modelo !== filtro.modelo) return false;
      if (filtro.status && r.status !== filtro.status) return false;
      if (emp && semAcento(r.empresa) !== emp) return false;
      return true;
    });
  }
  function semAcento(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase(); }

  // Processos para onde uma resposta pode ir (menos o atual), mais "Sem processo".
  function opcoesMoverProcesso(processos, codigoAtual) {
    var ops = (processos || []).filter(function (p) { return p && p.codigo !== codigoAtual; }).map(function (p) {
      return { valor: String(p.id), rotulo: p.nome + ' (' + p.codigo + ')', sub: [empresaDe(p), TIPOS[p.tipo] || '', p.ativa === false ? 'desativado' : ''].filter(Boolean).join(' · ') };
    });
    if (codigoAtual) ops.unshift({ valor: '', rotulo: 'Sem processo (link geral)', sub: 'A resposta fica fora de qualquer processo' });
    return ops;
  }

  // Aviso de banco desatualizado a partir da resposta de versaoBanco() ('' = está em dia).
  // Sem a função no banco (erro), o aviso é o mesmo, sem a lista.
  /* ---------- Vendas (B2C: pedidos, cupons e pacotes) ---------- */

  var STATUS_PEDIDO = { aguardando: 'Aguardando pagamento', pago: 'Pago', cortesia: 'Cortesia', estornado: 'Reembolsado', cancelado: 'Cancelado' };
  var CLASSE_PEDIDO = { aguardando: 'selo--laranja', pago: 'selo--verde', cortesia: 'selo--noite', estornado: 'selo--vermelho', cancelado: '' };
  var PERIODOS_VENDAS = { hoje: 'Hoje', '7d': 'Últimos 7 dias', mes: 'Este mês', '30d': 'Últimos 30 dias' };
  var PACOTES_PADRAO = [
    { chave: 'gratis', nome: 'Resumo grátis', precoCentavos: 0, precoLancamentoCentavos: null, lancamentoAte: '', ativo: true, ordem: 0 },
    { chave: 'completo', nome: 'Relatório completo', precoCentavos: 3900, precoLancamentoCentavos: 2900, lancamentoAte: '', ativo: true, ordem: 1 },
    { chave: 'completo_plus', nome: 'Completo + Parte 2', precoCentavos: 6900, precoLancamentoCentavos: 4900, lancamentoAte: '', ativo: true, ordem: 2 }
  ];
  var ASAAS_PAINEL = 'https://www.asaas.com/';

  function campo(o, nomes) {
    for (var i = 0; i < nomes.length; i++) if (o && o[nomes[i]] != null) return o[nomes[i]];
    return null;
  }
  function inteiroOu(v, padrao) {
    var n = Number(v);
    return v === '' || v == null || !isFinite(n) ? padrao : Math.round(n);
  }

  // 3900 -> "R$ 39,00"; 123456 -> "R$ 1.234,56" (pt-BR, sem depender do Intl do navegador).
  function formatarReais(centavos) {
    var n = Math.round(Number(centavos) || 0);
    var neg = n < 0; n = Math.abs(n);
    var inteiro = String(Math.floor(n / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    var cent = String(n % 100); if (cent.length < 2) cent = '0' + cent;
    return (neg ? '-' : '') + 'R$ ' + inteiro + ',' + cent;
  }

  // "29,90", "R$ 1.234,56", "29.9", "29" -> centavos (inteiro); vazio ou inválido -> null.
  function centavosDeTexto(t) {
    var s = String(t == null ? '' : t).replace(/R\$|\s/gi, '');
    if (!s) return null;
    if (s.indexOf(',') !== -1) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
    return Math.round(Number(s) * 100);
  }
  function textoDeCentavos(c) {
    if (c == null || c === '') return '';
    return formatarReais(c).replace(/^R\$ /, '');
  }

  // Aceita o pedido em camelCase ou com os nomes das colunas (snake_case).
  function normalizarPedido(p) {
    p = p || {};
    var status = String(campo(p, ['status']) || 'aguardando');
    return {
      id: String(campo(p, ['id']) || ''),
      respostaId: campo(p, ['respostaId', 'resposta_id']) == null ? '' : String(campo(p, ['respostaId', 'resposta_id'])),
      pacote: String(campo(p, ['pacote']) || ''),
      valorCentavos: inteiroOu(campo(p, ['valorCentavos', 'valor_centavos', 'valor']), 0),
      cupom: String(campo(p, ['cupom']) || ''),
      status: Object.prototype.hasOwnProperty.call(STATUS_PEDIDO, status) ? status : 'aguardando',
      nome: String(campo(p, ['nome']) || ''),
      email: String(campo(p, ['email']) || ''),
      telefone: String(campo(p, ['telefone', 'whatsapp']) || ''),
      tokenAcesso: String(campo(p, ['tokenAcesso', 'token_acesso']) || ''),
      criadoEm: String(campo(p, ['criadoEm', 'criado_em']) || ''),
      pagoEm: String(campo(p, ['pagoEm', 'pago_em']) || ''),
      reembolsadoEm: String(campo(p, ['reembolsadoEm', 'reembolsado_em']) || ''),
      metodo: String(campo(p, ['metodo']) || ''),
      asaasCobrancaId: String(campo(p, ['asaasCobrancaId', 'asaas_cobranca_id']) || ''),
      faturaUrl: /^https:\/\//.test(String(campo(p, ['faturaUrl']) || '')) ? String(p.faturaUrl) : ''
    };
  }
  function normalizarCupom(c) {
    c = c || {};
    var pac = campo(c, ['pacotes']);
    return {
      codigo: String(campo(c, ['codigo']) || '').toUpperCase(),
      tipo: campo(c, ['tipo']) === 'valor' ? 'valor' : 'percentual',
      valor: inteiroOu(campo(c, ['valor']), 0),
      usosMax: inteiroOu(campo(c, ['usosMax', 'usos_max']), null),
      usos: inteiroOu(campo(c, ['usos']), 0),
      validoAte: String(campo(c, ['validoAte', 'valido_ate']) || '').slice(0, 10),
      ativo: campo(c, ['ativo']) !== false,
      pacotes: Array.isArray(pac) ? pac.map(String) : []
    };
  }
  function normalizarPacote(p) {
    p = p || {};
    return {
      chave: String(campo(p, ['chave']) || ''),
      nome: String(campo(p, ['nome']) || ''),
      precoCentavos: inteiroOu(campo(p, ['precoCentavos', 'preco_centavos']), 0),
      precoLancamentoCentavos: inteiroOu(campo(p, ['precoLancamentoCentavos', 'preco_lancamento_centavos']), null),
      lancamentoAte: String(campo(p, ['lancamentoAte', 'lancamento_ate']) || '').slice(0, 10),
      ativo: campo(p, ['ativo']) !== false,
      ordem: inteiroOu(campo(p, ['ordem']), 0)
    };
  }

  // Data de referência de um pedido: quando foi pago (ou liberado), senão quando foi criado.
  function dataPedido(p) { return p.pagoEm || p.criadoEm || ''; }
  function inicioDoDia(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  // Começo do período ('hoje', '7d', '30d', 'mes') em relação a "agora"; '' -> null (sem limite).
  function inicioPeriodo(periodo, agora) {
    var a = agora ? new Date(agora) : new Date();
    var hoje = inicioDoDia(a);
    if (periodo === 'hoje') return hoje;
    if (periodo === '7d') return new Date(hoje.getTime() - 6 * 86400000);
    if (periodo === '30d') return new Date(hoje.getTime() - 29 * 86400000);
    if (periodo === 'mes') return new Date(a.getFullYear(), a.getMonth(), 1);
    return null;
  }
  function noPeriodo(iso, periodo, agora) {
    var ini = inicioPeriodo(periodo, agora);
    if (!ini) return true;
    var t = Date.parse(iso);
    return isFinite(t) && t >= ini.getTime();
  }

  // filtro: { busca, status, pacote, periodo }. A busca olha nome, e-mail, cupom e o início do id.
  function filtrarPedidos(lista, filtro, agora) {
    var f = filtro || {};
    var termo = semAcento(f.busca);
    return (lista || []).filter(function (p) {
      if (f.status && p.status !== f.status) return false;
      if (f.pacote && p.pacote !== f.pacote) return false;
      if (f.periodo && !noPeriodo(p.criadoEm || p.pagoEm, f.periodo, agora)) return false;
      if (!termo) return true;
      return semAcento([p.nome, p.email, p.cupom, p.id].join(' ')).indexOf(termo) !== -1;
    }).sort(function (a, b) { return String(b.criadoEm).localeCompare(String(a.criadoEm)); });
  }

  // Resumo calculado a partir dos pedidos. Venda = pedido pago (cortesia não conta na receita).
  // gratis = quantos resumos grátis (respostas de origem 'pessoal') existem — base da conversão.
  function resumoDosPedidos(pedidos, agora, gratis) {
    var lista = pedidos || [];
    function bloco(periodo) {
      var pagos = lista.filter(function (p) { return p.status === 'pago' && noPeriodo(dataPedido(p), periodo, agora); });
      return { vendas: pagos.length, receitaCentavos: pagos.reduce(function (s, p) { return s + p.valorCentavos; }, 0) };
    }
    var todos = bloco('');
    var compradores = {};
    lista.forEach(function (p) { if (p.status === 'pago' || p.status === 'cortesia') compradores[p.respostaId || p.email || p.id] = true; });
    var nCompra = Object.keys(compradores).length;
    var base = gratis == null ? null : Number(gratis);
    return {
      hoje: bloco('hoje'), semana: bloco('7d'), mes: bloco('mes'),
      ticketMedioCentavos: todos.vendas ? Math.round(todos.receitaCentavos / todos.vendas) : 0,
      aguardando: lista.filter(function (p) { return p.status === 'aguardando'; }).length,
      cortesias: lista.filter(function (p) { return p.status === 'cortesia'; }).length,
      gratis: base, compras: nCompra,
      conversao: base ? Math.round((nCompra / base) * 1000) / 10 : null,
      ultimos: lista.slice().sort(function (a, b) { return String(b.criadoEm).localeCompare(String(a.criadoEm)); }).slice(0, 10)
    };
  }

  // Junta o que o servidor mandou (resumoVendas) com o calculado aqui; o do servidor vale quando existe.
  function juntarResumo(doServidor, calculado) {
    var s = doServidor || {};
    var r = {};
    for (var k in calculado) r[k] = calculado[k];
    ['hoje', 'semana', 'mes'].forEach(function (k) {
      var b = s[k] || (k === 'semana' ? s['7d'] || s.seteDias : null);
      if (b && typeof b === 'object') r[k] = {
        vendas: inteiroOu(campo(b, ['vendas', 'qtd', 'quantidade']), r[k].vendas),
        receitaCentavos: inteiroOu(campo(b, ['receitaCentavos', 'receita_centavos', 'receita']), r[k].receitaCentavos)
      };
    });
    var t = campo(s, ['ticketMedioCentavos', 'ticket_medio_centavos', 'ticketMedio']);
    if (t != null) r.ticketMedioCentavos = inteiroOu(t, r.ticketMedioCentavos);
    var ag = campo(s, ['aguardando']);
    if (ag != null) r.aguardando = inteiroOu(ag, r.aguardando);
    var cort = campo(s, ['cortesias']);
    if (cort != null) r.cortesias = inteiroOu(cort, r.cortesias);
    // Conversão: compras / resumos grátis. Com os dois números, calcula aqui (em %); senão usa a do servidor
    // (fração 0–1 do resumo_vendas, ou já em %).
    var g = campo(s, ['resumos', 'gratis', 'resumosGratis', 'resumos_gratis']);
    var c = campo(s, ['compras', 'comprasPagas']);
    if (g != null) r.gratis = inteiroOu(g, r.gratis);
    if (c != null) r.compras = inteiroOu(c, r.compras);
    var conv = campo(s, ['conversao']);
    if (g != null && c != null) r.conversao = r.gratis ? Math.round((r.compras / r.gratis) * 1000) / 10 : null;
    else if (conv != null && isFinite(Number(conv))) r.conversao = Number(conv) <= 1 ? Math.round(Number(conv) * 1000) / 10 : Number(conv);
    if (s.periodo) r.periodo = String(s.periodo);
    return r;
  }

  function textoPercentual(v) { return v == null ? '—' : String(v).replace('.', ',') + '%'; }

  function nomePacote(chave, pacotes) {
    var lista = (pacotes && pacotes.length ? pacotes : PACOTES_PADRAO);
    for (var i = 0; i < lista.length; i++) if (lista[i].chave === chave) return lista[i].nome;
    return chave || '—';
  }

  // "20% de desconto" / "R$ 10,00 de desconto"
  function textoCupom(c) {
    return (c.tipo === 'valor' ? formatarReais(c.valor) : c.valor + '%') + ' de desconto';
  }

  // Erro do cupom (texto) ou '' quando está bom. c: { codigo, tipo, valor (% inteiro ou centavos), usosMax, validoAte, pacotes }
  function validarCupom(c) {
    if (!c || !/^[A-Z0-9_-]{3,30}$/.test(String(c.codigo || ''))) return 'O código precisa ter de 3 a 30 letras, números, - ou _ (sem espaço).';
    if (c.tipo !== 'percentual' && c.tipo !== 'valor') return 'Escolha o tipo do desconto.';
    var v = Number(c.valor);
    if (!isFinite(v) || v <= 0) return 'Informe o valor do desconto.';
    if (c.tipo === 'percentual' && (v > 100 || Math.round(v) !== v)) return 'O desconto em % vai de 1 a 100.';
    if (c.usosMax != null && (!isFinite(Number(c.usosMax)) || Number(c.usosMax) < 1)) return 'O limite de usos precisa ser 1 ou mais (ou deixe vazio).';
    if (c.validoAte && !/^\d{4}-\d{2}-\d{2}$/.test(c.validoAte)) return 'Validade inválida (use o calendário).';
    return '';
  }

  function validarPacote(p) {
    if (!p || !String(p.nome || '').trim()) return 'Informe o nome do pacote.';
    if (p.precoCentavos == null || p.precoCentavos < 0) return 'Informe o preço (ex.: 39,00).';
    if (p.precoLancamentoCentavos != null) {
      if (p.precoLancamentoCentavos < 0) return 'Preço de lançamento inválido.';
      if (p.precoLancamentoCentavos >= p.precoCentavos) return 'O preço de lançamento precisa ser menor que o preço normal.';
    }
    if (p.lancamentoAte && !/^\d{4}-\d{2}-\d{2}$/.test(p.lancamentoAte)) return 'Data de fim do lançamento inválida.';
    if (!isFinite(Number(p.ordem))) return 'Ordem inválida.';
    return '';
  }

  // Link da landing com o cupom já aplicado: descubra.html?cupom=CODIGO (na mesma pasta do painel).
  function linkLandingCupom(href, codigo) {
    var base = String(href || '').split('#')[0].split('?')[0].replace(/[^/]*$/, '');
    return base + 'descubra.html?cupom=' + encodeURIComponent(String(codigo || '').toUpperCase());
  }
  // Link do relatório comprado: meu-relatorio.html#t-<token>.
  function linkMeuRelatorio(href, token) {
    var base = String(href || '').split('#')[0].split('?')[0].replace(/[^/]*$/, '');
    return base + 'meu-relatorio.html#t-' + encodeURIComponent(String(token || ''));
  }
  // Página "Recuperar meu relatório" (o painel não recebe o token do cliente): meu-relatorio.html#recuperar.
  function linkRecuperar(href) {
    var base = String(href || '').split('#')[0].split('?')[0].replace(/[^/]*$/, '');
    return base + 'meu-relatorio.html#recuperar';
  }
  // Orientação para quem perdeu o link: pedir de novo pelo e-mail da compra.
  function mensagemOrientacao(pedido, url) {
    var nome = primeiroNome(pedido && pedido.nome);
    return 'Olá' + (nome ? ', ' + nome : '') + '! Para abrir de novo o seu Mapa de Perfil completo, entre em:\n' + url +
      '\n\nInforme o e-mail usado na compra' + (pedido && pedido.email ? ' (' + pedido.email + ')' : '') +
      ' e o link de acesso chega na sua caixa de entrada (confira também o spam).\nQualquer dúvida, é só responder esta mensagem.\nEquipe Gestão sem Caos';
  }
  // Mensagem para reenviar o relatório ao cliente (WhatsApp/e-mail).
  function mensagemReenvio(pedido, url) {
    var nome = primeiroNome(pedido && pedido.nome);
    return 'Olá' + (nome ? ', ' + nome : '') + '! Aqui está o link do seu Mapa de Perfil completo:\n' + url +
      '\n\nGuarde este link: ele é o seu acesso ao relatório.\nQualquer dúvida, é só responder esta mensagem.\nEquipe Gestão sem Caos';
  }

  function mensagemBanco(resp) {
    if (resp && resp.ok === true && !resp.semFuncao && (!Array.isArray(resp.faltando) || !resp.faltando.length)) return '';
    var faltam = resp && Array.isArray(resp.faltando) && resp.faltando.length ? resp.faltando.map(String).join(', ') : 'as migrações mais recentes';
    return 'O banco de dados está desatualizado: faltam ' + faltam + '. Peça para aplicar as migrações (veja docs/SUPABASE.md).';
  }

  /* ---------- Conexões (aba do admin): cartões a partir do diagnóstico; nunca mostra valor de segredo ---------- */

  var STATUS_CONEXAO = {
    ok: { texto: 'Funcionando', classe: 'selo--verde' },
    nao_configurado: { texto: 'Não configurado', classe: '' },
    erro: { texto: 'Com erro', classe: 'selo--vermelho' },
    testando: { texto: 'Testando…', classe: 'selo--noite' },
    pendente: { texto: 'Não testado', classe: '' },
    manual: { texto: 'Conferir no GitHub', classe: '' }
  };
  var PASSO_SECRETS = 'No Supabase: menu Edge Functions → Secrets → Add new secret (Name e Value) → Save. Não cole o valor em conversa nenhuma.';
  var PASSO_TESTAR = 'Volte aqui e clique em "Testar".';
  var NOMES_FUNCOES = {
    admin: 'Painel (ClickUp, relatórios, usuários, conexões)', 'disc-sync': 'Leva o resultado do candidato ao ClickUp',
    'clickup-webhook': 'Recebe os avisos do ClickUp', pagamento: 'Pagamento do site (venda direta)',
    'asaas-webhook': 'Recebe os avisos do Asaas', 'infinitepay-webhook': 'Recebe os avisos da InfinitePay'
  };
  var WEBHOOKS_SEM_JWT = ['clickup-webhook', 'asaas-webhook', 'infinitepay-webhook', 'pagamento'];

  function passosPublicarFuncao(nome) {
    return [
      'Jeito automático: com a integração do GitHub do Supabase ligada, as funções da pasta supabase/functions são publicadas a cada push na branch principal.',
      'Jeito manual: no GitHub abra dist/funcoes/' + nome + '/index.ts → Copy raw file.',
      'No Supabase: Edge Functions → clique em "' + nome + '" → aba Code → apague tudo, cole → Deploy updates. Se ela não existir: Deploy a new function → Via Editor → Function name "' + nome + '" → cole → Deploy function.',
      WEBHOOKS_SEM_JWT.indexOf(nome) >= 0 ? 'Na página da função: Details → Verify JWT (Enforce JWT Verification) DESLIGADO → Save changes.' : 'Verify JWT pode ficar ligado.',
      PASSO_TESTAR
    ];
  }

  function textoSimNao(b) { return b ? 'existe' : 'não existe'; }
  function baseUrl(u) { return String(u || '').split('#')[0].split('?')[0].replace(/[^/]*$/, '').replace(/\/+$/, '').toLowerCase(); }
  function hostLocal(u) { return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(String(u || '')); }

  // Monta os 10 cartões. diag = DISC_API.diagnosticoConexoes; testes = {alvo: resultado de testarConexao};
  // testando = {idCartao: true}. Cada cartão: {id, nome, serve, status, linhas[], erro, passos[], quando, verificado, acoes[], link?}
  function cartoesConexoes(diag, testes, testando) {
    diag = diag || {};
    testes = testes || {};
    testando = testando || {};
    var sv = diag.servidor || null;
    var sg = (sv && sv.segredos) || {};
    var pag = (sv && sv.pagamento) || {};
    var estadoSv = diag.servidorEstado || (sv ? 'ok' : 'erro');
    var semServidor = !sv;
    var avisoServidor = estadoSv === 'desatualizada' ? 'A função admin está desatualizada: publique de novo (cartão "Funções do servidor").'
      : (estadoSv === 'ausente' ? 'A função admin não está publicada (cartão "Funções do servidor").'
        : 'Não deu para perguntar ao servidor: ' + (diag.servidorErro || 'sem resposta') + '.');
    var em = diag.em || '';
    var lista = [];
    function novoCartao(c) { c.linhas = []; c.passos = []; return c; }
    function cartao(c) {
      c.linhas = c.linhas || []; c.passos = c.passos || []; c.acoes = c.acoes || ['testar'];
      c.erro = c.erro || ''; c.quando = c.quando || em; c.verificado = c.verificado || '';
      if (testando[c.id]) c.status = 'testando';
      lista.push(c);
    }
    function usarTeste(c, alvo) {
      var t = testes[alvo];
      if (!t) return false;
      c.quando = t.em || c.quando;
      c.verificado = t.verificado || c.verificado;
      if (t.sucesso) c.linhas.push(t.mensagem); else c.erro = t.mensagem || 'O teste falhou.';
      return true;
    }
    function funcaoPublicada(nome) {
      var t = testes.funcoes && testes.funcoes.detalhes && testes.funcoes.detalhes.funcoes;
      var fs = Array.isArray(t) ? t : ((sv && sv.funcoes) || []);
      for (var i = 0; i < fs.length; i++) if (fs[i].nome === nome) return fs[i].publicada;
      return null;
    }

    // 1. Site
    (function () {
      var c = novoCartao({ id: 'site', nome: 'Site', serve: 'Endereço público onde os candidatos, clientes e o painel abrem.' });
      var atual = diag.siteAtual || '';
      c.linhas.push('Endereço atual: ' + (atual || '—'));
      c.verificado = 'Endereço desta página comparado com o segredo SITE_URL das funções.';
      if (semServidor) { c.status = 'erro'; c.erro = avisoServidor; }
      else if (!sv.siteUrl) {
        c.status = 'nao_configurado';
        c.linhas.push('SITE_URL nas funções: não existe');
        c.passos = [PASSO_SECRETS, 'Name: SITE_URL — Value: o endereço do site, sem barra no fim' + (atual && !hostLocal(atual) ? ' (ex.: ' + baseUrl(atual) + ')' : '') + '.', PASSO_TESTAR];
      } else {
        c.linhas.push('SITE_URL nas funções: ' + sv.siteUrl);
        if (baseUrl(atual) === baseUrl(sv.siteUrl) || baseUrl(atual + 'x') === baseUrl(sv.siteUrl + 'x')) c.status = 'ok';
        else if (hostLocal(atual)) { c.status = 'ok'; c.linhas.push('Você está numa cópia local: os links enviados usam o SITE_URL.'); }
        else {
          c.status = 'erro';
          c.erro = 'O painel está aberto num endereço diferente do SITE_URL. Links de relatório, convites e a volta do pagamento usam o SITE_URL.';
          c.passos = [PASSO_SECRETS, 'Troque o valor de SITE_URL para o endereço certo do site (sem barra no fim).', PASSO_TESTAR];
        }
      }
      c.acoes = ['testar'];
      cartao(c);
    })();

    // 2. Banco de dados
    (function () {
      var c = novoCartao({ id: 'banco', nome: 'Banco de dados (Supabase)', serve: 'Guarda processos, respostas, pessoas, empresas e pedidos.' });
      var b = (testes.banco && testes.banco.banco) || diag.banco || null;
      if (testes.banco) c.quando = testes.banco.em || em;
      c.verificado = 'Conexão, tempo de resposta, versão do banco (migrações) e leitura das tabelas principais.';
      if (testes.banco && testes.banco.sucesso === false && !testes.banco.banco) b = { erro: testes.banco.mensagem || 'O teste falhou.' };
      if (!b) { c.status = 'pendente'; cartao(c); return; }
      if (b.erro) {
        c.status = 'erro'; c.erro = b.erro;
        c.passos = ['Abra o projeto no Supabase. Se aparecer "Project paused", clique em Restore project e espere alguns minutos.',
          'Confira em js/config.js se SUPABASE_URL e SUPABASE_ANON_KEY são os do projeto (Project Settings → API).', PASSO_TESTAR];
        cartao(c); return;
      }
      c.linhas.push('Respondeu em ' + b.ms + ' ms.');
      var ct = b.contagens || {};
      var nomes = [['processos', 'Processos'], ['respostas', 'Respostas'], ['pessoas', 'Pessoas'], ['empresas', 'Empresas'], ['pedidos', 'Pedidos']];
      c.linhas.push(nomes.map(function (n) { return n[1] + ': ' + (typeof ct[n[0]] === 'number' ? ct[n[0]] : '—'); }).join(' · '));
      var falt = Array.isArray(b.faltando) ? b.faltando : [];
      if (falt.length) {
        c.status = 'erro';
        c.erro = 'Faltam ' + falt.length + (falt.length === 1 ? ' migração' : ' migrações') + ' no banco: ' +
          falt.map(function (f) { return (f.descricao || f.nome) + ' (' + f.nome + '.sql)'; }).join('; ') + '.';
        c.passos = ['Com a integração do GitHub do Supabase ligada, as migrações rodam sozinhas no push. Se não rodaram:',
          'No GitHub abra cada arquivo supabase/migrations/<nome>.sql da lista acima, NA ORDEM → Copy raw file.',
          'No Supabase: SQL Editor → + → cole → Run (se avisar "destructive operations", Run this query: nada é apagado).', PASSO_TESTAR];
      } else {
        c.status = 'ok';
        c.linhas.push('Versão do banco: ' + (b.versao || '—') + ' (todas as migrações aplicadas).');
      }
      cartao(c);
    })();

    // 3. Login e usuários
    (function () {
      var c = novoCartao({ id: 'login', nome: 'Login e usuários', serve: 'Entrada no painel (Supabase Auth) e quem é administrador.' });
      if (!diag.login) { c.status = 'pendente'; cartao(c); return; }
      var l = diag.login;
      c.verificado = 'Sessão deste navegador, papel de administrador e a regra de cadastro do Supabase.';
      c.linhas.push('Sessão atual: ' + (l.sessao ? 'ativa' + (l.email ? ' (' + l.email + ')' : '') : 'não encontrada'));
      c.linhas.push('Papel: ' + (l.admin === true ? 'administrador' : (l.admin === false ? 'não é administrador' : 'não deu para conferir')));
      var fechado = sv && sv.auth ? sv.auth.cadastroFechado : null;
      var passosCadastro = ['No Supabase: Authentication → Sign In / Providers (em versões antigas: Providers ou Settings).',
        'Na seção User Signups, desligue "Allow new users to sign up" → Save.', PASSO_TESTAR];
      if (l.admin === false) { c.status = 'erro'; c.erro = 'Este usuário não está na lista de administradores.'; }
      else if (fechado === false) {
        c.status = 'erro';
        c.erro = 'O cadastro livre está ABERTO: qualquer pessoa pode criar uma conta (ela não vira administradora, mas o certo é fechar).';
        c.passos = passosCadastro;
      } else {
        c.status = 'ok';
        if (fechado === true) c.linhas.push('Cadastro livre: fechado (só entra quem for convidado).');
        else { c.linhas.push('Cadastro livre: não deu para conferir daqui. Lembrete: ele precisa estar fechado.'); c.passos = passosCadastro; }
      }
      cartao(c);
    })();

    // 4. Funções do servidor
    (function () {
      var c = novoCartao({ id: 'funcoes', nome: 'Funções do servidor (Edge Functions)', serve: 'Programas no Supabase que falam com ClickUp, pagamento, e-mail e IA.' });
      c.verificado = 'O servidor chama o endereço de cada função (404 = não publicada).';
      if (testes.funcoes) c.quando = testes.funcoes.em || em;
      if (semServidor) {
        c.status = 'erro';
        c.erro = estadoSv === 'desatualizada' ? 'A função admin está desatualizada: publique de novo.'
          : (estadoSv === 'ausente' ? 'A função admin não está publicada no Supabase.' : avisoServidor);
        c.passos = passosPublicarFuncao('admin');
        cartao(c); return;
      }
      var opcional = {
        'asaas-webhook': !sg.ASAAS_API_KEY && pag.provedor !== 'asaas' ? 'só precisa se usar o Asaas' : '',
        'infinitepay-webhook': !sg.INFINITEPAY_HANDLE ? 'só precisa se usar a InfinitePay' : '',
        'clickup-webhook': !sg.CLICKUP_TOKEN ? 'só precisa se usar o ClickUp' : ''
      };
      var faltam = [];
      var duvida = [];
      ['admin', 'disc-sync', 'clickup-webhook', 'pagamento', 'asaas-webhook', 'infinitepay-webhook'].forEach(function (n) {
        var p = funcaoPublicada(n);
        var txt = n + ' — ' + (p === true ? 'publicada' : (p === false ? 'NÃO publicada' + (opcional[n] ? ' (' + opcional[n] + ')' : '') : 'não deu para conferir'));
        c.linhas.push(txt);
        if (p === false && !opcional[n]) faltam.push(n);
        if (p === null) duvida.push(n);
      });
      if (faltam.length) {
        c.status = 'erro';
        c.erro = 'Não publicadas: ' + faltam.join(', ') + '.';
        c.passos = passosPublicarFuncao(faltam[0]);
        if (faltam.length > 1) c.passos.unshift('Repita para cada uma: ' + faltam.join(', ') + '.');
      } else if (duvida.length) {
        c.status = 'erro';
        c.erro = 'Não deu para conferir: ' + duvida.join(', ') + '. Tente de novo em instantes.';
      } else c.status = 'ok';
      cartao(c);
    })();

    // 5. InfinitePay
    (function () {
      var c = novoCartao({ id: 'infinitepay', nome: 'Pagamento — InfinitePay', serve: 'Recebe o pagamento (Pix e cartão) da venda direta do Mapa DISC.' });
      c.acoes = ['testar', 'link', 'verificar'];
      c.verificado = 'Presença dos segredos e da função que recebe o aviso de pagamento.';
      if (semServidor) { c.status = 'erro'; c.erro = avisoServidor; cartao(c); return; }
      c.linhas.push('InfiniteTag (INFINITEPAY_HANDLE): ' + (sg.INFINITEPAY_HANDLE ? 'existe (' + (pag.handleParcial || '***') + ')' : 'não existe'));
      c.linhas.push('SITE_URL: ' + textoSimNao(sg.SITE_URL));
      c.linhas.push('PAGAMENTO_PROVEDOR: ' + (pag.provedorEscolhido === 'invalido' ? 'valor desconhecido' : (pag.provedorEscolhido || 'não existe (usa a InfinitePay quando há InfiniteTag)')));
      c.linhas.push('Provedor em uso no site: ' + (pag.provedor === 'infinitepay' ? 'InfinitePay' : (pag.provedor === 'asaas' ? 'Asaas' : 'nenhum')));
      var passos = ['No app da InfinitePay, abra o seu perfil: a InfiniteTag é o seu "$nome" de recebimento. Anote SEM o $.', PASSO_SECRETS,
        'Name: INFINITEPAY_HANDLE — Value: a InfiniteTag sem o $.', 'Name: PAGAMENTO_PROVEDOR — Value: infinitepay.',
        'Confira também o SITE_URL (endereço do site, sem barra no fim).', PASSO_TESTAR];
      if (!sg.INFINITEPAY_HANDLE) { c.status = 'nao_configurado'; c.passos = passos; }
      else if (!sg.SITE_URL) { c.status = 'erro'; c.erro = 'Falta o segredo SITE_URL: a InfinitePay não sabe para onde devolver o cliente.'; c.passos = passos; }
      else if (pag.provedorEscolhido === 'invalido') { c.status = 'erro'; c.erro = 'PAGAMENTO_PROVEDOR tem um valor desconhecido: use infinitepay ou asaas.'; c.passos = passos; }
      else if (funcaoPublicada('infinitepay-webhook') === false) {
        c.status = 'erro'; c.erro = 'A função infinitepay-webhook não está publicada: o pagamento não seria confirmado sozinho.';
        c.passos = passosPublicarFuncao('infinitepay-webhook');
      } else c.status = 'ok';
      if (sv.colunaTeste === false) c.linhas.push('Link de teste: aplique antes a migração 20261013120000_conexoes.');
      var tl = testes['infinitepay.link'];
      if (tl) {
        c.quando = tl.em || c.quando;
        if (tl.sucesso && tl.detalhes && tl.detalhes.url) { c.link = { url: tl.detalhes.url, pedidoId: tl.detalhes.pedidoId || '' }; c.linhas.push(tl.mensagem); }
        else if (!tl.sucesso) { c.erro = tl.mensagem; c.status = 'erro'; }
      } else if (sv.pedidoTeste && sv.pedidoTeste.url) {
        c.link = { url: sv.pedidoTeste.url, pedidoId: sv.pedidoTeste.id };
        c.linhas.push('Último pedido de teste: ' + (sv.pedidoTeste.status === 'pago' ? 'pago' : 'aguardando pagamento') + '.');
      }
      var tv = testes['infinitepay.verificar'];
      if (tv) {
        c.quando = tv.em || c.quando;
        c.verificado = tv.verificado || c.verificado;
        if (tv.sucesso) c.linhas.push(tv.mensagem); else { c.erro = tv.mensagem; c.status = 'erro'; }
      }
      cartao(c);
    })();

    // 6. Asaas
    (function () {
      var c = novoCartao({ id: 'asaas', nome: 'Pagamento — Asaas (alternativa)', serve: 'Outro meio de pagamento (Pix no site e cartão), usado só se escolhido.' });
      if (semServidor) { c.status = 'erro'; c.erro = avisoServidor; cartao(c); return; }
      c.linhas.push('ASAAS_API_KEY: ' + textoSimNao(sg.ASAAS_API_KEY) + ' · ASAAS_WEBHOOK_TOKEN: ' + textoSimNao(sg.ASAAS_WEBHOOK_TOKEN));
      c.linhas.push('Ambiente: ' + (pag.asaasAmbiente === 'producao' ? 'produção' : 'sandbox (testes)') + (sg.ASAAS_AMBIENTE ? '' : ' (ASAAS_AMBIENTE não existe: vale sandbox)'));
      var passos = ['Só precisa se for usar o Asaas no lugar da InfinitePay.',
        'No Asaas: menu do usuário (canto superior direito) → Integrações → Chaves de API → Gerar chave.', PASSO_SECRETS,
        'Name: ASAAS_API_KEY — Value: a chave. Name: ASAAS_AMBIENTE — Value: sandbox (testes) ou producao.',
        'Webhook: invente uma senha longa, guarde como ASAAS_WEBHOOK_TOKEN e cadastre em Asaas → Integrações → Webhooks (passo a passo em docs/VENDAS.md).', PASSO_TESTAR];
      c.verificado = 'Presença dos segredos.';
      if (!sg.ASAAS_API_KEY) { c.status = 'nao_configurado'; c.passos = passos; }
      else if (usarTeste(c, 'asaas')) {
        c.status = testes.asaas.sucesso ? (sg.ASAAS_WEBHOOK_TOKEN ? 'ok' : 'erro') : 'erro';
        if (testes.asaas.sucesso && !sg.ASAAS_WEBHOOK_TOKEN) c.erro = 'Falta o ASAAS_WEBHOOK_TOKEN: o aviso de pagamento do Asaas seria recusado.';
        if (c.status === 'erro') c.passos = passos;
      } else c.status = 'pendente';
      cartao(c);
    })();

    // 7. E-mail
    (function () {
      var c = novoCartao({ id: 'email', nome: 'E-mail (Resend)', serve: 'Manda ao cliente o link do relatório comprado e o "recuperar meu relatório".' });
      c.acoes = ['testar', 'email'];
      if (semServidor) { c.status = 'erro'; c.erro = avisoServidor; cartao(c); return; }
      c.linhas.push('RESEND_API_KEY: ' + textoSimNao(sg.RESEND_API_KEY) + ' · EMAIL_REMETENTE: ' + textoSimNao(sg.EMAIL_REMETENTE));
      var passos = ['Em resend.com: Domains → Add domain (o domínio do site) e crie os registros DNS que ele mostrar; espere "Verified".',
        'API Keys → Create API Key (permissão Sending access) → copie.', PASSO_SECRETS,
        'Name: RESEND_API_KEY — Value: a chave. Name: EMAIL_REMETENTE — Value: Gestão sem Caos <relatorio@seudominio.com.br>.',
        'Volte aqui e clique em "Enviar e-mail de teste para mim".'];
      c.verificado = 'Presença dos segredos.';
      if (!sg.RESEND_API_KEY) { c.status = 'nao_configurado'; c.passos = passos; }
      else if (usarTeste(c, 'email')) { c.status = testes.email.sucesso ? 'ok' : 'erro'; if (c.status === 'erro') c.passos = passos; }
      else { c.status = 'pendente'; c.linhas.push('Para confirmar o envio, use "Enviar e-mail de teste para mim".'); }
      cartao(c);
    })();

    // 8. ClickUp
    (function () {
      var c = novoCartao({ id: 'clickup', nome: 'ClickUp', serve: 'Lê as listas e candidatos dos processos e recebe o pedido de "gerar relatório".' });
      if (semServidor) { c.status = 'erro'; c.erro = avisoServidor; cartao(c); return; }
      c.linhas.push('CLICKUP_TOKEN: ' + textoSimNao(sg.CLICKUP_TOKEN) + ' · CLICKUP_WEBHOOK_SECRET: ' + textoSimNao(sg.CLICKUP_WEBHOOK_SECRET));
      var passos = ['No ClickUp: clique na sua foto → Configurações → Apps → API Token → Gerar → copie (começa com pk_).', PASSO_SECRETS,
        'Name: CLICKUP_TOKEN — Value: o token.',
        'Para o aviso "gerar relatório": crie o webhook do ClickUp (docs/SUPABASE.md, passo 13) e guarde o secret como CLICKUP_WEBHOOK_SECRET.', PASSO_TESTAR];
      c.verificado = 'Presença dos segredos.';
      if (!sg.CLICKUP_TOKEN) { c.status = 'nao_configurado'; c.passos = passos; }
      else if (usarTeste(c, 'clickup')) {
        c.status = testes.clickup.sucesso ? 'ok' : 'erro';
        if (c.status === 'erro') c.passos = passos;
        else if (!sg.CLICKUP_WEBHOOK_SECRET) { c.linhas.push('Sem CLICKUP_WEBHOOK_SECRET o status "gerar relatório" do ClickUp não aciona nada (o resto funciona).'); c.passos = passos.slice(3); }
      } else c.status = 'pendente';
      cartao(c);
    })();

    // 9. IA
    (function () {
      var c = novoCartao({ id: 'ia', nome: 'IA (opcional, melhorar textos)', serve: 'Botão "Melhorar textos com IA" no editor do relatório.' });
      if (semServidor) { c.status = 'erro'; c.erro = avisoServidor; cartao(c); return; }
      c.linhas.push('ANTHROPIC_API_KEY: ' + textoSimNao(sg.ANTHROPIC_API_KEY));
      var passos = ['É opcional: sem a chave o painel funciona, só sem o botão de IA.',
        'Em console.anthropic.com: API Keys → Create Key → copie (começa com sk-ant-).', PASSO_SECRETS,
        'Name: ANTHROPIC_API_KEY — Value: a chave.', PASSO_TESTAR];
      c.verificado = 'Presença do segredo.';
      if (!sg.ANTHROPIC_API_KEY) { c.status = 'nao_configurado'; c.passos = passos; }
      else if (usarTeste(c, 'ia')) { c.status = testes.ia.sucesso ? 'ok' : 'erro'; if (c.status === 'erro') c.passos = passos; }
      else c.status = 'pendente';
      cartao(c);
    })();

    // 10. Despertador
    (function () {
      var c = novoCartao({ id: 'despertador', nome: 'Despertador (GitHub Actions)', serve: 'Consulta o banco a cada 3 dias para o Supabase grátis não pausar o projeto.' });
      c.status = 'manual';
      var b = diag.banco || {};
      c.linhas.push('Não dá para testar daqui: o despertador não grava nada no banco.');
      c.linhas.push('Última atividade registrada no banco (última resposta recebida): ' + (b.ultimaResposta ? formatarData(b.ultimaResposta) : 'nenhuma'));
      c.verificado = 'Só a última atividade do banco.';
      c.passos = ['No GitHub, abra o repositório → aba Actions → "Manter Supabase ativo": a última execução deve estar com ✓ verde (roda a cada 3 dias).',
        'Para testar agora: na mesma tela, Run workflow → Run workflow.',
        'Se aparecer "segredos ausentes": Settings → Secrets and variables → Actions → New repository secret: SUPABASE_URL e SUPABASE_ANON_KEY (a chave pública, nunca a service_role).'];
      c.acoes = [];
      cartao(c);
    })();

    return lista;
  }

  // Resumo do topo: quantos funcionam, com erro e não configurados.
  function resumoConexoes(cartoes) {
    var r = { ok: 0, erro: 0, nao_configurado: 0, outros: 0 };
    (cartoes || []).forEach(function (c) { if (r[c.status] !== undefined) r[c.status]++; else r.outros++; });
    return r;
  }

  var util = {
    STATUS_CONEXAO: STATUS_CONEXAO,
    cartoesConexoes: cartoesConexoes,
    resumoConexoes: resumoConexoes,
    STATUS_PEDIDO: STATUS_PEDIDO,
    PACOTES_PADRAO: PACOTES_PADRAO,
    formatarReais: formatarReais,
    centavosDeTexto: centavosDeTexto,
    normalizarPedido: normalizarPedido,
    normalizarCupom: normalizarCupom,
    normalizarPacote: normalizarPacote,
    inicioPeriodo: inicioPeriodo,
    filtrarPedidos: filtrarPedidos,
    resumoDosPedidos: resumoDosPedidos,
    juntarResumo: juntarResumo,
    textoCupom: textoCupom,
    validarCupom: validarCupom,
    validarPacote: validarPacote,
    linkLandingCupom: linkLandingCupom,
    linkMeuRelatorio: linkMeuRelatorio,
    mensagemReenvio: mensagemReenvio,
    linkRecuperar: linkRecuperar,
    mensagemOrientacao: mensagemOrientacao,
    MODELOS_CATALOGO: MODELOS_CATALOGO,
    modeloDoCatalogo: modeloDoCatalogo,
    exemploModelo: exemploModelo,
    juntarGerados: juntarGerados,
    filtrarGerados: filtrarGerados,
    opcoesMoverProcesso: opcoesMoverProcesso,
    mensagemBanco: mensagemBanco,
    modoEmpresas: modoEmpresas,
    filtrarOpcoes: filtrarOpcoes,
    filtrarEmpresas: filtrarEmpresas,
    ligacoesDe: ligacoesDe,
    aplicarLigacoes: aplicarLigacoes,
    relacoesEntre: relacoesEntre,
    resultadoDoRegistro: resultadoDoRegistro,
    entradaCompatibilidade: entradaCompatibilidade,
    relacoesDoFoco: relacoesDoFoco,
    pessoasDasRespostas: pessoasDasRespostas,
    linkRelatorioModelo: linkRelatorioModelo,
    mensagemRelatorioModelo: mensagemRelatorioModelo,
    textoEquipeEmpresa: textoEquipeEmpresa,
    MODELOS_REL: MODELOS_REL,
    modoSupabase: modoSupabase,
    lerRetornoAuth: lerRetornoAuth,
    enderecoPainel: enderecoPainel,
    MSG_SEM_ACESSO_SUPABASE: MSG_SEM_ACESSO_SUPABASE,
    MSG_PRIMEIRO_ADMIN: MSG_PRIMEIRO_ADMIN,
    MSG_LINK_EXPIRADO: MSG_LINK_EXPIRADO,
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
    linkRelatorio: linkRelatorio,
    urlAbsoluta: urlAbsoluta,
    mensagemConvite: mensagemConvite,
    mensagemRelatorio: mensagemRelatorio,
    campoSensivel: campoSensivel,
    normalizarPerfilIdeal: normalizarPerfilIdeal,
    alternarLetraPerfil: alternarLetraPerfil,
    explicarPerfil: explicarPerfil,
    pesosNormalizados: pesosNormalizados,
    idSimples: idSimples,
    validarConfig: validarConfig,
    configPadrao: configPadrao,
    CAMPOS_FORMULARIO: CAMPOS_FORMULARIO,
    MODOS_CAMPO: MODOS_CAMPO,
    formularioPadrao: formularioPadrao,
    normalizarFormulario: normalizarFormulario,
    validarFormulario: validarFormulario,
    perguntaSensivel: perguntaSensivel,
    resumoFormulario: resumoFormulario,
    PARTE2: PARTE2,
    FOTO_MAX: FOTO_MAX,
    fotoValida: fotoValida,
    iniciais: iniciais,
    fotoDe: fotoDe,
    liderDe: liderDe,
    lideradosDe: lideradosDe,
    descendentes: descendentes,
    parte2Padrao: parte2Padrao,
    textoParte2: textoParte2,
    exigidoDoRegistro: exigidoDoRegistro,
    eixosDe: eixosDe,
    esforcoDe: esforcoDe,
    rotuloEsforco: rotuloEsforco,
    nomeCombinacao: nomeCombinacao,
    pontosMapaEquipe: pontosMapaEquipe,
    esforcoEquipe: esforcoEquipe,
    frasesEsforco: frasesEsforco,
    lerExtras: lerExtras,
    chavePessoa: chavePessoa,
    agruparPessoas: agruparPessoas,
    fichaPessoa: fichaPessoa,
    consistenciaPerfil: consistenciaPerfil,
    textosEditaveis: textosEditaveis,
    editarTexto: editarTexto,
    idListaDoTexto: idListaDoTexto,
    MSG_SO_ADMIN: MSG_SO_ADMIN,
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
  var SUPABASE = MODO_API && modoSupabase(CONFIG, root.DISC_API);
  // Lido já no carregamento: o supabase-js limpa a âncora da URL depois de ler a sessão do e-mail.
  var RETORNO_AUTH = SUPABASE && root.location ? lerRetornoAuth(root.location.hash, root.location.search) : { tipo: '', erro: '' };
  // O js/api-supabase.js também guarda o que leu do endereço ao carregar (linkDeAcesso); vale se aqui não achou nada.
  if (SUPABASE && !RETORNO_AUTH.tipo && !RETORNO_AUTH.erro && root.DISC_API && typeof root.DISC_API.linkDeAcesso === 'function') {
    try {
      var link = root.DISC_API.linkDeAcesso() || {};
      var tipoLink = String(link.tipo || '');
      RETORNO_AUTH = { tipo: (tipoLink === 'recovery' || tipoLink === 'invite') ? tipoLink : '', erro: link.erro ? String(link.erro) : '' };
    } catch (e) { /* segue sem */ }
  }
  var estado = {
    token: '', usuario: null,
    registros: [], processos: [], usuarios: [],
    clickup: { configurado: false, iaConfigurada: false, carregado: false },
    abertoId: null, aba: 'lista', listaMostrada: false,
    filtros: { processo: '', perfil: '', status: '', origem: '' },
    // Tela dentro da aba Processos: 'lista' | 'form' | 'pagina' | 'editor'
    proc: { tela: 'lista', id: null },
    relatorios: {},   // processoId -> [{token, status, criadoEm, publicadoEm}]
    editor: null,     // {processoId, token, relatorio, avisos, status, url, sujo}
    emp: null,        // aba Empresas: ver novoEstadoEmpresas()
    vd: null,         // aba Vendas: ver novoEstadoVendas()
    cx: null,         // aba Conexões: ver novoEstadoConexoes()
    rl: null          // aba Relatórios: ver novoEstadoRelatorios()
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

  /* ---------- Fotos no navegador ---------- */

  // Avatar redondo: a foto (só data:image/jpeg validada) ou as iniciais. Com letra, um selo DISC pequeno no canto.
  function avatar(nome, foto, opcoes) {
    var op = opcoes || {};
    var tem = fotoValida(foto);
    var filhos = [tem ? el('img', { classe: 'avatar__img', src: foto, alt: '', width: 192, height: 192, loading: 'lazy', decoding: 'async' })
      : el('span', { classe: 'avatar__iniciais', texto: iniciais(nome) })];
    if (op.letra) filhos.push(el('span', { classe: 'avatar__letra disc-fundo-' + op.letra, 'aria-hidden': 'true', texto: op.letra }));
    return el('span', { classe: 'avatar' + (tem ? ' avatar--foto' : '') + (op.classe ? ' ' + op.classe : ''), 'aria-hidden': 'true', 'data-foto': tem ? 'sim' : 'nao' }, filhos);
  }

  // Arquivo de imagem -> data URL JPEG 192×192 recortada ao centro (qualidade ~0,72; baixa até caber em FOTO_MAX).
  function prepararFoto(file) {
    return new Promise(function (resolve, reject) {
      if (!file) { reject(new Error('Escolha uma foto.')); return; }
      if (file.type && !/^image\//.test(file.type)) { reject(new Error('Escolha um arquivo de imagem (JPG, PNG ou WEBP).')); return; }
      if (file.size > FOTO_ORIGINAL_MAX) { reject(new Error('A foto passa de 15 MB. Escolha outra.')); return; }
      var url = (root.URL && root.URL.createObjectURL) ? root.URL.createObjectURL(file) : '';
      var img = new Image();
      img.onload = function () {
        try {
          var lado = Math.min(img.naturalWidth, img.naturalHeight);
          var c = document.createElement('canvas');
          c.width = FOTO_LADO; c.height = FOTO_LADO;
          var ctx = c.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, FOTO_LADO, FOTO_LADO);
          ctx.drawImage(img, (img.naturalWidth - lado) / 2, (img.naturalHeight - lado) / 2, lado, lado, 0, 0, FOTO_LADO, FOTO_LADO);
          var q = 0.72, dado = c.toDataURL('image/jpeg', q);
          while (dado.length > FOTO_MAX && q > 0.3) { q -= 0.1; dado = c.toDataURL('image/jpeg', q); }
          if (url) root.URL.revokeObjectURL(url);
          if (!fotoValida(dado)) { reject(new Error('Não foi possível preparar a foto. Tente outra.')); return; }
          resolve(dado);
        } catch (e) { reject(new Error('Não foi possível ler a foto. Tente outra.')); }
      };
      img.onerror = function () { if (url) root.URL.revokeObjectURL(url); reject(new Error('Este formato de imagem não abre neste navegador. Use JPG ou PNG.')); };
      img.src = url;
    });
  }

  function desenharUsuarioTopo() {
    var u = estado.usuario;
    var box = $('usuario-inicial');
    if (!u || !box) return;
    var nome = String(u.nome || u.email || '');
    limpar(box);
    if (fotoValida(u.foto)) { box.classList.add('usuario__inicial--foto'); box.appendChild(el('img', { src: u.foto, alt: '', width: 32, height: 32 })); }
    else { box.classList.remove('usuario__inicial--foto'); box.textContent = iniciais(nome).charAt(0) || '?'; }
  }

  // "Minha foto" (menu do usuário): enviar, trocar ou remover a própria foto.
  function janelaMinhaFoto() {
    var u = estado.usuario || {};
    var nova = fotoValida(u.foto) ? u.foto : '';
    var previa = el('div', { classe: 'foto-previa', id: 'minha-foto-previa' });
    var entrada = el('input', { type: 'file', id: 'minha-foto-arquivo', classe: 'visualmente-oculto', accept: 'image/*' });
    var btnRemover = botao('botao--claro botao--pequeno', 'Remover foto', function () { nova = ''; desenhar(); }, { id: 'btn-minha-foto-remover' });
    var status = el('p', { classe: 't-nota texto-suave', id: 'minha-foto-status', 'aria-live': 'polite' });
    function desenhar() {
      limpar(previa);
      previa.appendChild(avatar(u.nome || u.email, nova, { classe: 'avatar--grande' }));
      btnRemover.hidden = !nova;
    }
    entrada.addEventListener('change', function () {
      var f = entrada.files && entrada.files[0];
      if (!f) return;
      status.textContent = 'Preparando a foto…';
      prepararFoto(f).then(function (d) { nova = d; status.textContent = 'Foto pronta. Toque em "Salvar foto".'; desenhar(); },
        function (e) { status.textContent = e.message; });
      entrada.value = '';
    });
    desenhar();
    abrirJanela({
      id: 'janela-minha-foto',
      titulo: 'Minha foto',
      texto: 'Aparece no menu, na aba Usuários e nos relatórios que você gerar. A foto é reduzida para 192×192 antes de salvar.',
      corpo: [
        el('div', { classe: 'foto-escolha' }, [
          previa,
          el('div', { classe: 'foto-escolha__acoes' }, [
            el('label', { classe: 'botao botao--contorno botao--pequeno', for: 'minha-foto-arquivo', id: 'btn-minha-foto-escolher', tabindex: '0',
              onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); entrada.click(); } } }, [fotoValida(u.foto) ? 'Trocar foto' : 'Escolher foto']),
            entrada, btnRemover
          ])
        ]),
        status
      ],
      botao: 'Salvar foto',
      aoConfirmar: function () {
        if (!metodoApi('salvarMinhaFoto')) throw new Error('Este servidor ainda não guarda fotos.');
        return api('salvarMinhaFoto', nova).then(function (resp) {
          u.foto = resp && typeof resp.foto === 'string' ? resp.foto : (resp && resp.usuario && typeof resp.usuario.foto === 'string') ? resp.usuario.foto : nova;
          ss('set', CHAVE_USUARIO, JSON.stringify(u));
          desenharUsuarioTopo();
          avisar(nova ? 'Foto salva.' : 'Foto removida.', 'ok');
          (estado.usuarios || []).forEach(function (x) { if (x.id && x.id === u.id) x.foto = u.foto; });
          renderizarUsuarios();
        });
      }
    });
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

  // Primeiro método existente no DISC_API (aceita um nome ou uma lista de nomes alternativos).
  function metodoApi(nomes) {
    var lista = Array.isArray(nomes) ? nomes : [nomes];
    for (var i = 0; i < lista.length; i++) {
      var fn = root.DISC_API && root.DISC_API[lista[i]];
      if (typeof fn === 'function') return fn;
    }
    return null;
  }

  // Chamada pública (sem token), mesma regra de resposta {ok, erro}.
  function apiPublica(nomes) {
    var args = Array.prototype.slice.call(arguments, 1);
    var fn = metodoApi(nomes);
    if (typeof fn !== 'function') return Promise.reject(new Error('Esta função não está disponível neste servidor.'));
    return Promise.resolve().then(function () { return fn.apply(root.DISC_API, args); }).then(function (resp) {
      if (!resp || resp.ok !== true) throw new Error((resp && resp.erro) || 'O servidor recusou a solicitação.');
      return resp;
    });
  }

  // Chamada autenticada: o token vai como primeiro argumento. Sessão expirada -> volta ao login.
  function api(metodo) {
    var args = [estado.token].concat(Array.prototype.slice.call(arguments, 1));
    var fn = metodoApi(metodo);
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
    return Promise.all([
      api('listar'),
      api('processosListar'),
      api('listarUsuarios'),
      // Status do ClickUp/IA: se falhar, o painel segue (o ClickUp é opcional).
      api('clickupStatus').catch(function (e) { if (e && e.tratado) throw e; return null; })
    ]).then(function (rs) {
      estado.processos = rs[1].processos || [];
      estado.registros = ordenar((rs[0].itens || []).map(function (r) { return recalcular(comProcesso(r)); }));
      estado.usuarios = rs[2].usuarios || [];
      var cu = rs[3] || {};
      estado.clickup = { configurado: cu.configurado === true, conectado: cu.conectado !== false, usuario: cu.usuario || '',
        iaConfigurada: cu.iaConfigurada === true, avisos: Array.isArray(cu.avisos) ? cu.avisos : [], carregado: !!rs[3] };
      montarFiltros();
      renderizarTudo();
      // Empresas (Supabase/prévia): carrega à parte; se falhar, a aba mostra o erro e o resto do painel segue.
      if (empresasOk()) { esquecerEquipes(); return carregarEmpresas(); }
    }).catch(function (e) {
      $('contagem').textContent = '';
      falhou(e);
    });
  }

  // O registro mostra o nome e a empresa do processo (empresa agora é texto no processo).
  function comProcesso(r) {
    if (!r || !r.avaliacao) return r;
    var p = acharProcessoPorCodigo(r.avaliacao);
    if (p) {
      if (!r.avaliacaoNome) r.avaliacaoNome = p.nome;
      if (!r.empresaNome && p.empresa) r.empresaNome = p.empresa;
      if (!r.avaliacaoTipo && p.tipo) r.avaliacaoTipo = p.tipo;
    }
    return r;
  }
  function acharProcessoPorCodigo(codigo) {
    for (var i = 0; i < estado.processos.length; i++) if (estado.processos[i].codigo === codigo) return estado.processos[i];
    return null;
  }
  function acharProcesso(id) {
    for (var i = 0; i < estado.processos.length; i++) if (estado.processos[i].id === id) return estado.processos[i];
    return null;
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
      var btnOk = el('button', { type: 'button', classe: 'botao ' + (opcoes.classeBotao || 'botao--perigo'), id: 'confirmar-ok', texto: opcoes.botao || 'Excluir' });
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
      var comResp = estado.processos.filter(function (a) { return a.respostas || estado.registros.some(function (r) { return r.avaliacao === a.codigo; }); });
      var inicial = comResp.some(function (a) { return a.codigo === estado.filtros.processo; }) ? estado.filtros.processo : '';
      escAv = criarEscolha({
        id: 'excluir-avaliacao', rotulo: 'Quais respostas', rotuloId: 'excluir-avaliacao-rotulo', valor: inicial, classe: 'escolha--campo escolha--larga',
        opcoes: [{ valor: '', rotulo: 'Todas as respostas' }].concat(comResp.map(function (a) { return { valor: a.codigo, rotulo: a.nome + ' (' + a.codigo + ')' }; }))
      });
    }
    confirmar({
      titulo: MODO_API ? 'Excluir respostas?' : 'Excluir todos os participantes?',
      texto: MODO_API
        ? 'Escolha o processo. As respostas dele são apagadas e não podem ser recuperadas. O histórico de versões da planilha continua guardando os dados: para eliminá-los de vez, exclua a planilha do Google Drive e esvazie a lixeira.'
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
        avisar(avaliacao ? 'Respostas do processo ' + avaliacao + ' excluídas.' : 'Todas as respostas foram excluídas.', 'ok');
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
    if (MODO_API) {
      defs.push({ id: 'filtro-processo', chave: 'processo', rotulo: 'Processo', prefixo: 'Processo',
        opcoes: [{ valor: '', rotulo: 'Todos' }]
          .concat(estado.processos.map(function (a) { return { valor: a.codigo, rotulo: a.nome + (empresaDe(a) ? ' · ' + empresaDe(a) : '') }; }))
          .concat(temGeral ? [{ valor: '-', rotulo: 'Link geral' }] : []) });
    }
    defs.push({ id: 'filtro-perfil', chave: 'perfil', rotulo: 'Perfil primário', prefixo: 'Perfil',
      opcoes: [{ valor: '', rotulo: 'Todos' }].concat(LETRAS.map(function (l) { return { valor: l, rotulo: l + ' — ' + NOMES[l] }; })) });
    defs.push({ id: 'filtro-status', chave: 'status', rotulo: 'Status', prefixo: 'Status',
      opcoes: [{ valor: '', rotulo: 'Todos' }].concat(['em_analise', 'aprovado', 'reprovado', 'invalido'].map(function (s) { return { valor: s, rotulo: STATUS[s] }; })) });
    // Origem: só quando há venda direta (respostas 'pessoal' ou a API de vendas).
    if (MODO_API && (temVendas() || estado.registros.some(function (r) { return r.origem === 'pessoal'; }))) {
      defs.push({ id: 'filtro-origem', chave: 'origem', rotulo: 'Origem', prefixo: 'Origem',
        opcoes: [{ valor: '', rotulo: 'Todas' }, { valor: 'processo', rotulo: 'Processos' }, { valor: 'pessoal', rotulo: 'Pessoal (venda direta)' }] });
    }
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
      if (f.processo === '-' && r.avaliacao) return false;
      if (f.processo && f.processo !== '-' && r.avaliacao !== f.processo) return false;
      if (f.perfil && (!r.calc || r.calc.primario !== f.perfil)) return false;
      if (f.origem === 'pessoal' && r.origem !== 'pessoal') return false;
      if (f.origem === 'processo' && r.origem === 'pessoal') return false;
      if (f.status === 'invalido' && !r.invalido) return false;
      if (f.status && f.status !== 'invalido' && (r.invalido || r.status !== f.status)) return false;
      return correspondeBusca(r, busca);
    });
  }

  /* ---------- Lista ---------- */

  // Cartões de resumo no padrão do Início do BI: todos brancos; "Aprovados" em destaque (número em laranja).
  // "Pessoas" conta quem respondeu (mesmo WhatsApp = mesma pessoa); os outros contam respostas.
  function renderizarResumo(animar) {
    var box = $('resumo-lista');
    limpar(box);
    var regs = estado.registros;
    var conta = function (f) { return regs.filter(f).length; };
    var pessoas = agruparPessoas(regs).length;
    var cartoes = [
      { rotulo: 'Pessoas', valor: pessoas, nota: regs.length + ' resposta' + (regs.length === 1 ? '' : 's') + ' no total', estilo: '', id: 'resumo-pessoas' },
      { rotulo: 'Aprovados', valor: conta(function (r) { return !r.invalido && r.status === 'aprovado'; }), nota: 'respostas aprovadas', estilo: 'caixa--destaque' },
      { rotulo: 'Em análise', valor: conta(function (r) { return !r.invalido && r.status === 'em_analise'; }), nota: 'respostas em análise', estilo: '' },
      { rotulo: 'Confiabilidade baixa', valor: conta(function (r) { return r.conf && r.conf.nivel === 'baixa'; }), nota: 'respostas', estilo: '' }
    ];
    cartoes.forEach(function (c, i) {
      box.appendChild(el('div', { classe: 'caixa caixa--compacta resumo__cartao ' + c.estilo + (animar ? ' surgir' : ''), id: c.id || null, estilo: animar ? { 'animation-delay': (i * 40) + 'ms' } : null }, [
        el('span', { classe: 'resumo__rotulo', texto: c.rotulo }),
        el('span', { classe: 'resumo__numeros' }, [
          el('span', { classe: 'resumo__valor t-numero-grande valor-destaque', texto: String(c.valor) }),
          el('span', { classe: 'resumo__nota', texto: c.nota })
        ])
      ]));
    });
  }

  // Uma linha por pessoa (a resposta mais recente entre as filtradas) e o selo "N respostas" quando houver mais de uma.
  function renderizarLista() {
    var ul = $('lista-candidatos');
    limpar(ul);
    // Só anima na primeira vez: filtrar ou buscar não faz os cartões piscarem nem pularem.
    var animar = !estado.listaMostrada;
    estado.listaMostrada = true;
    renderizarResumo(animar);
    var itens = filtrados();
    var grupos = agruparPessoas(itens);
    var total = agruparPessoas(estado.registros).length;
    var nResp = estado.registros.length;
    var nMenu = $('aba-n-lista');
    if (nMenu) nMenu.textContent = total ? String(total) : '';
    $('contagem').textContent = nResp === 0
      ? (MODO_API ? 'Nenhuma resposta recebida ainda.' : 'Nenhum participante importado. Use a aba "Importar códigos".')
      : grupos.length + ' de ' + total + ' participante' + (total === 1 ? '' : 's') +
        (itens.length !== grupos.length || nResp !== total ? ' (' + itens.length + ' de ' + nResp + ' respostas)' : '');
    grupos.forEach(function (g, i) {
      var r = g.atual;
      var meta = [linkTelefone(r)];
      if (r.vaga && r.avaliacaoTipo !== 'equipe') meta.push(el('span', { texto: r.vaga }));
      meta.push(el('span', { classe: 'texto-suave', texto: formatarData(r.fim || r.recebidoEm) }));
      // Função · Empresa (discreto). A idade fica só no detalhe.
      var exp = textoExperiencia(r);
      if (exp) meta.push(el('span', { classe: 'card-experiencia', texto: exp }));
      var selos = [badgePerfil(r), badgeStatus(r), badgeConfiabilidade(r)];
      if (r.origem === 'pessoal') selos.unshift(el('span', { classe: 'selo selo--laranja selo-pessoal', title: 'Fez o Mapa DISC pela página de venda (sem processo)', texto: 'Pessoal' }));
      if (g.total > 1) selos.push(el('span', { classe: 'selo selo--noite selo-respostas', title: 'Respostas desta pessoa' + (estado.filtros.processo ? ' neste filtro' : ''), texto: g.total + ' respostas' }));
      ul.appendChild(el('li', { classe: 'card caixa' + (animar ? ' surgir' : '') + (r.invalido ? ' card-invalido' : ''), 'data-id': r.id, 'data-pessoa': g.chave, 'data-respostas': String(g.total), estilo: animar ? { 'animation-delay': Math.min(i, 8) * 30 + 'ms' } : null }, [
        el('div', { classe: 'card-topo' }, [
          avatar(r.nome, fotoDe(r), { letra: r.calc ? r.calc.primario : '', classe: 'card-avatar' }),
          el('button', { type: 'button', classe: 'card-nome', texto: r.nome || '(sem nome)',
            onclick: function () { abrirDetalhe(r.id); } }),
          seloProtocolo(r, 'card-protocolo')
        ]),
        MODO_API ? el('p', { classe: 'card-origem', texto: textoOrigem(r) }) : null,
        el('div', { classe: 'card-meta' }, meta),
        r.calc ? miniBarras(r.calc.percentuais) : el('p', { classe: 'aviso aviso--erro card-aviso', texto: 'Respostas inválidas — resultado não pode ser calculado.' }),
        el('div', { classe: 'card-rodape' }, [
          el('div', { classe: 'card-selos' }, selos),
          el('button', { type: 'button', classe: 'botao botao--claro botao--pequeno', texto: 'Ver detalhes',
            'aria-label': 'Ver detalhes de ' + (r.nome || 'participante'), onclick: function () { abrirDetalhe(r.id); } })
        ])
      ]));
    });
  }

  /* ---------- Detalhe ---------- */

  function esconderVistas() {
    ['vista-lista', 'vista-processos', 'vista-empresas', 'vista-relatorios', 'vista-vendas', 'vista-usuarios', 'vista-comparativo', 'vista-importar', 'vista-conexoes']
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

  // Respostas do formulário desta resposta: e-mail, cidade e perguntas extras (null se não há nada).
  function blocoFormulario(r, ficha) {
    var extras = lerExtras(r.extras);
    var email = r.email || ficha.email || '';
    var cidade = r.cidade || ficha.cidade || '';
    if (!email && !cidade && !extras.length) return null;
    var itens = [];
    if (email) itens.push(el('div', null, [el('dt', { texto: 'E-mail' }), el('dd', { id: 'det-email', texto: String(email) })]));
    if (cidade) itens.push(el('div', null, [el('dt', { texto: 'Cidade onde mora' }), el('dd', { id: 'det-cidade', texto: String(cidade) })]));
    extras.forEach(function (x) {
      itens.push(el('div', { classe: 'det-dl__largo det-extra', 'data-pergunta': x.id }, [
        el('dt', { texto: x.pergunta }), el('dd', { classe: x.resposta ? '' : 'texto-suave', texto: x.resposta || 'Sem resposta' })
      ]));
    });
    return el('section', { classe: 'caixa det-formulario surgir', id: 'det-formulario' }, [
      el('h3', { classe: 'caixa__titulo', texto: 'Respostas do formulário' }),
      el('dl', { classe: 'det-dl' }, itens)
    ]);
  }

  // Histórico desta pessoa: todas as respostas (data, processo, perfil, mini barras, código), com troca entre elas
  // e o aviso de consistência do perfil principal (null com uma resposta só).
  function blocoHistorico(r, respostas) {
    if (!respostas || respostas.length < 2) return null;
    var cons = consistenciaPerfil(respostas);
    return el('section', { classe: 'caixa det-historico surgir nao-imprimir', id: 'det-historico' }, [
      el('h3', { classe: 'caixa__titulo', texto: 'Histórico desta pessoa' }),
      el('p', { classe: 'conf-nota conf-nota--topo', texto: respostas.length + ' respostas com o mesmo WhatsApp, da mais recente para a mais antiga.' }),
      cons ? el('p', { classe: 'aviso hist-consistencia ' + (cons.igual ? 'aviso--ok' : ''), id: 'det-consistencia', 'data-igual': cons.igual ? 'sim' : 'nao', role: 'note' }, [
        el('span', { classe: 'seminegrito', texto: cons.texto }),
        el('span', { classe: 'hist-consistencia__nota', texto: ' Repetir o mesmo perfil em momentos diferentes também é um sinal de confiabilidade.' })
      ]) : null,
      el('ol', { classe: 'hist-lista', id: 'det-historico-lista' }, respostas.map(function (x) {
        var atual = x.id === r.id;
        return el('li', { classe: 'hist-item' + (atual ? ' hist-item--atual' : ''), 'data-id': x.id, 'aria-current': atual ? 'true' : null }, [
          el('div', { classe: 'hist-item__topo' }, [
            x.calc ? badgePerfil(x) : el('span', { classe: 'badge badge--invalido', texto: 'Inválido' }),
            el('span', { classe: 'hist-item__data tabular', texto: formatarData(x.fim || x.recebidoEm) }),
            seloProtocolo(x, 'hist-item__protocolo')
          ]),
          el('p', { classe: 'hist-item__origem', texto: textoOrigem(x) || (x.vaga || '') }),
          x.calc ? miniBarras(x.calc.percentuais) : null,
          atual ? el('span', { classe: 'selo selo--noite hist-item__agora', texto: 'Vendo esta resposta' })
            : botao('botao--claro botao--pequeno hist-item__ver', 'Ver esta resposta', function () { abrirDetalhe(x.id); },
              { 'data-acao': 'ver-resposta', 'aria-label': 'Ver a resposta de ' + formatarData(x.fim || x.recebidoEm) })
        ]);
      }))
    ]);
  }

  // HTML de um desenho do relatório (string já escapada pelo DISC_RELATORIO_VIEW) num nó do painel.
  function nodoDeHtml(html, attrs) {
    var modelo = document.createElement('template');
    modelo.innerHTML = html;
    return el('div', attrs, modelo.content);
  }

  // Mapa ritmo × foco (DISC_RELATORIO_VIEW.mapaRitmoFocoHtml); null sem o módulo ou sem pontos.
  function mapaRitmoFoco(pontos, opcoes, attrs) {
    var VIEW = root.DISC_RELATORIO_VIEW;
    if (!pontos.length || !VIEW || typeof VIEW.mapaRitmoFocoHtml !== 'function') return null;
    var html = '';
    try { html = String(VIEW.mapaRitmoFocoHtml(pontos, opcoes || {}) || ''); } catch (e) { html = ''; }
    return html ? nodoDeHtml(html, attrs) : null;
  }

  function seloEsforco(a, extra) {
    return el('span', { classe: 'selo esforco-selo ' + (CLASSE_ESFORCO[a.faixa] || '') + (extra ? ' ' + extra : ''), 'data-faixa': a.faixa, texto: rotuloEsforco(a.faixa) });
  }

  // Detalhe: natural × exigido (barras lado a lado), índice de esforço com faixa e mapa ritmo × foco.
  function blocoParte2(r) {
    var ex = exigidoDoRegistro(r);
    if (!r.calc || !ex) return null;
    var nat = r.calc.percentuais, exi = ex.percentuais;
    var a = esforcoDe(nat, exi);
    var linhas = el('ul', { classe: 'comparar-barras', id: 'det-natural-exigido', role: 'list' }, LETRAS.map(function (l) {
      var d = Math.round((exi[l] - nat[l]) * 10) / 10;
      function barra(classe, v) {
        return el('span', { classe: 'comparar-barras__linha' }, [
          el('span', { classe: 'mini-trilho trilho' }, el('span', { classe: 'mini-barra ' + classe, estilo: { width: Math.min(100, (v / 40) * 100) + '%' } })),
          el('span', { classe: 'mini-valor tabular', texto: String(v).replace('.', ',') + '%' })
        ]);
      }
      return el('li', { classe: 'comparar-barras__item', 'data-letra': l, 'aria-label': NOMES[l] + ': natural ' + nat[l] + '%, exigido ' + exi[l] + '%' }, [
        letraDisc(l, 'comparar-barras__letra'),
        el('span', { classe: 'comparar-barras__barras' }, [barra('comparar-barras__natural', nat[l]), barra('comparar-barras__exigido', exi[l])]),
        el('span', { classe: 'comparar-barras__delta tabular' + (Math.abs(d) >= 5 ? ' comparar-barras__delta--forte' : ''), texto: (d > 0 ? '+' : d < 0 ? '−' : '') + String(Math.abs(d)).replace('.', ',') })
      ]);
    }));
    var esforco = a ? el('div', { classe: 'esforco', id: 'det-esforco', 'data-faixa': a.faixa }, [
      el('p', { classe: 'esforco__rotulo t-rotulo texto-suave', texto: 'Índice de esforço de adaptação' }),
      el('p', { classe: 'esforco__linha' }, [
        el('span', { classe: 't-numero tabular esforco__indice', id: 'det-esforco-indice', texto: String(Math.round(a.indice)) }),
        el('span', { classe: 'texto-suave t-rotulo', texto: ' de 100 ' }),
        seloEsforco(a)
      ]),
      el('ul', { classe: 'lista-simples esforco__frases' }, frasesEsforco(a).map(function (t) { return el('li', { classe: 't-rotulo', texto: t }); }))
    ]) : el('p', { classe: 'texto-suave t-rotulo', id: 'det-esforco', texto: 'Índice de esforço indisponível (disc-exigido.js não carregado).' });
    var mapa = mapaRitmoFoco([{ id: String(r.id), nome: primeiroNome(r.nome) || 'Pessoa', codigo: r.calc.codigo, natural: eixosDe(nat), exigido: eixosDe(exi), destaque: true }], {}, { classe: 'mapa-painel', id: 'det-mapa' });
    return el('section', { classe: 'caixa caixa--ampla det-parte2 surgir', id: 'det-parte2' }, [
      el('header', { classe: 'det-grafico__topo' }, [
        el('h3', { classe: 'caixa__titulo', texto: 'Natural × exigido pelo trabalho' }),
        ex.codigo ? el('span', { classe: 'badge disc-' + ex.codigo.charAt(0), title: 'Perfil exigido', texto: ex.codigo }) : null
      ]),
      el('p', { classe: 'texto-suave t-rotulo', texto: 'Natural: como a pessoa é (25 grupos). Exigido: como ela sente que o trabalho pede que ela seja (segunda parte). É um retrato do momento, não uma avaliação de desempenho.' }),
      el('div', { classe: 'det-parte2__grade' }, [
        el('div', null, [
          el('p', { classe: 'comparar-legenda t-nota' }, [
            el('span', { classe: 'comparar-legenda__item' }, [el('span', { classe: 'comparar-legenda__cor comparar-barras__natural', 'aria-hidden': 'true' }), 'Natural']),
            el('span', { classe: 'comparar-legenda__item' }, [el('span', { classe: 'comparar-legenda__cor comparar-barras__exigido', 'aria-hidden': 'true' }), 'Exigido'])
          ]),
          linhas,
          esforco
        ]),
        mapa ? el('div', null, [el('h4', { classe: 'conf-subtitulo', texto: 'Mapa ritmo × foco' }), mapa]) : null
      ])
    ]);
  }

  // LGPD: apaga a foto da resposta, da ficha e das outras respostas da pessoa (removerFoto no servidor; senão atualizar).
  function removerFotoResposta(r) {
    var chave = chavePessoa(r);
    function limparLocal() {
      estado.registros.forEach(function (x) {
        if (x.id !== r.id && chavePessoa(x) !== chave) return;
        x.foto = '';
        if (x.pessoa && typeof x.pessoa === 'object') x.pessoa.foto = '';
      });
      esquecerEquipes();
    }
    if (MODO_API && metodoApi('removerFoto')) return api('removerFoto', r.id).then(limparLocal);
    return atualizarCampos(r.id, { foto: '' }).then(limparLocal);
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
        el('p', { classe: 'sobretitulo nao-imprimir', texto: r.origem === 'pessoal' ? 'Venda direta · Mapa pessoal' : (equipe ? 'Avaliação de equipe · Colaborador' : 'Processo seletivo · Candidato') }),
        el('div', { classe: 'det-titulo' }, [
          avatar(r.nome, fotoDe(r), { classe: 'avatar--grande det-avatar' }),
          el('h2', { classe: 'cabecalho__titulo t-pagina seminegrito', texto: r.nome || '(sem nome)' })
        ]),
        el('p', { classe: 'det-protocolo', id: 'det-protocolo' }, [
          el('span', { classe: 'det-protocolo__rotulo', texto: 'Código ' }),
          el('span', { classe: 'det-protocolo__valor t-indicador negrito tabular', texto: textoProtocolo(r.protocolo) })
        ]),
        sub ? el('p', { classe: 'cabecalho__texto', texto: sub }) : null,
        linhaVinculoDetalhe(r)
      ]),
      el('div', { classe: 'cabecalho__acoes nao-imprimir' }, [
        el('button', { type: 'button', classe: 'botao botao--claro', texto: '← Voltar', onclick: fecharDetalhe }),
        podeMoverResposta() ? botao('botao--claro', 'Mover para outro processo', function () { janelaMoverProcesso(r); }, { id: 'btn-mover-processo' }) : null,
        podeContratar() ? botao('botao--contorno', 'Adicionar à empresa (contratar)', function () { janelaContratar(r, null); }, { id: 'btn-contratar' }) : null,
        guia ? el('button', { type: 'button', classe: 'botao botao--claro', texto: 'Copiar guia', onclick: function () {
          copiarTexto(guiaComoTexto(guia, r)).then(function () { avisar('Guia copiado para a área de transferência.', 'ok'); },
            function () { avisar('Não foi possível copiar automaticamente.', 'erro'); });
        } }) : null,
        el('button', { type: 'button', classe: 'botao botao--principal', texto: 'Imprimir / salvar PDF', onclick: function () { root.print(); } })
      ])
    ]));

    // Ficha da pessoa (dados de r.pessoa quando existe; senão os da resposta). Equipe: sem vaga nem empresa anterior.
    var ficha = fichaPessoa(r);
    var dados = el('section', { classe: 'caixa det-dados surgir', id: 'det-ficha' }, [
      el('h3', { classe: 'caixa__titulo', texto: r.origem === 'pessoal' ? 'Ficha do cliente' : (equipe ? 'Ficha do colaborador' : 'Ficha do candidato') }),
      el('dl', { classe: 'det-dl' }, [
        el('div', null, [el('dt', { texto: 'Telefone' }), el('dd', null, linkTelefone({ telefone: ficha.telefone || r.telefone, nome: ficha.nome || r.nome }))]),
        el('div', null, [el('dt', { texto: 'Idade' }), el('dd', { id: 'det-idade', texto: textoIdade(ficha.idade) })]),
        equipe ? null : el('div', null, [el('dt', { texto: 'Vaga pretendida' }), el('dd', { texto: r.vaga || '—' })]),
        el('div', null, [el('dt', { texto: equipe ? 'Cargo/função' : 'Função atual/última' }), el('dd', { id: 'det-funcao', texto: ficha.funcao || '—' })]),
        equipe ? null : el('div', null, [el('dt', { texto: 'Empresa atual/última' }), el('dd', { id: 'det-empresa', texto: ficha.empresa || '—' })]),
        MODO_API ? el('div', { classe: 'det-dl__largo' }, [el('dt', { texto: 'Processo' }), el('dd', { id: 'det-avaliacao', texto: textoOrigem(r) })]) : null,
        el('div', null, [el('dt', { texto: 'Concluído em' }), el('dd', { texto: formatarData(r.fim || r.recebidoEm) })]),
        el('div', null, [el('dt', { texto: 'Duração' }), el('dd', { texto: formatarDuracao(r.duracaoSeg) })]),
        el('div', null, [el('dt', { texto: 'Perfil' }), el('dd', { classe: 'det-perfil' }, [badgePerfil(r), r.calc ? ' ' + NOMES[r.calc.primario] + ' / ' + NOMES[r.calc.secundario] + (nomeCombinacao(r.calc.codigo) ? ' · ' + nomeCombinacao(r.calc.codigo) : '') : ''])]),
        el('div', null, [el('dt', { texto: 'Status' }), el('dd', { id: 'det-status-selo' }, badgeStatus(r))])
      ])
    ]);
    var pedidoDet = blocoPedidoDetalhe(r);
    if (pedidoDet) dados.appendChild(pedidoDet);

    // Todas as respostas desta pessoa (sem filtro), mais recente primeiro.
    var chave = chavePessoa(r);
    var doGrupo = agruparPessoas(estado.registros.filter(function (x) { return chavePessoa(x) === chave; }))[0];
    var daPessoa = doGrupo ? doGrupo.respostas : [r];

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
    var btnExcluir = null, btnExcluirPessoa = null;
    if (pode('excluir')) {
      var varias = daPessoa.length > 1;
      var quem = ficha.nome || r.nome || 'esta pessoa';
      btnExcluir = el('button', { type: 'button', classe: 'botao botao--perigo', id: 'btn-excluir-participante', texto: varias ? 'Excluir só esta resposta' : 'Excluir participante' });
      btnExcluir.addEventListener('click', function () {
        var outras = daPessoa.length - 1;
        confirmar({
          titulo: varias ? 'Excluir só esta resposta?' : 'Excluir este participante?',
          texto: varias
            ? 'Apaga definitivamente a resposta de ' + formatarData(r.fim || r.recebidoEm) + ' (código ' + textoProtocolo(r.protocolo) + '). As outras ' + outras + ' resposta' + (outras === 1 ? '' : 's') + ' de ' + quem + ' continuam.'
            : 'A resposta e a ficha de ' + quem + ' serão apagadas definitivamente.',
          botao: varias ? 'Excluir esta resposta' : 'Excluir participante'
        }).then(function (ok) {
          if (!ok) return;
          excluirRegistro(r.id).then(function () {
            avisar(varias ? 'Resposta excluída. As outras respostas da pessoa continuam.' : 'Participante excluído.', 'ok');
            var resto = daPessoa.filter(function (x) { return x.id !== r.id && acharRegistro(x.id); });
            if (resto.length) { renderizarTudo(); abrirDetalhe(resto[0].id); } else { fecharDetalhe(); renderizarTudo(); }
          }).catch(falhou);
        });
      });
      if (varias) {
        btnExcluirPessoa = el('button', { type: 'button', classe: 'botao botao--perigo', id: 'btn-excluir-pessoa', texto: 'Excluir as ' + daPessoa.length + ' respostas da pessoa' });
        btnExcluirPessoa.addEventListener('click', function () {
          confirmar({
            titulo: 'Excluir a pessoa e todas as respostas?',
            texto: 'Apaga definitivamente as ' + daPessoa.length + ' respostas de ' + quem + ' e a ficha dela. Não dá para desfazer.',
            exigir: 'EXCLUIR',
            botao: 'Excluir tudo da pessoa'
          }).then(function (ok) {
            if (!ok) return;
            var ids = daPessoa.map(function (x) { return x.id; });
            var cadeia = Promise.resolve();
            ids.forEach(function (id) { cadeia = cadeia.then(function () { return excluirRegistro(id); }); });
            cadeia.then(function () { avisar('Pessoa excluída com as ' + ids.length + ' respostas.', 'ok'); }, falhou)
              .then(function () { fecharDetalhe(); renderizarTudo(); });
          });
        });
      }
    }
    var gestao = el('section', { classe: 'caixa nao-imprimir det-gestao surgir' }, [
      el('h3', { classe: 'caixa__titulo', texto: 'Avaliação do recrutador' }),
      el('div', { classe: 'campo' }, [el('span', { classe: 'campo__rotulo', id: 'det-status-rotulo', texto: 'Status' }), escStatus.caixa]),
      el('div', { classe: 'campo' }, [el('label', { classe: 'campo__rotulo', for: 'det-obs', texto: 'Observações' }), taObs]),
      el('div', { classe: 'det-gestao__acoes' }, [btnObs, btnExcluir, btnExcluirPessoa]),
      fotoValida(r.foto) && pode('excluir') ? el('div', { classe: 'det-gestao__acoes det-foto' }, [
        botao('botao--claro', 'Remover foto', function () {
          confirmar({ titulo: 'Remover a foto desta resposta?', texto: 'A foto enviada pela pessoa é apagada desta resposta. Os dados do teste continuam.', botao: 'Remover foto' }).then(function (ok) {
            if (!ok) return;
            removerFotoResposta(r).then(function () {
              avisar('Foto removida.', 'ok');
              renderizarLista(); renderizarDetalhe();
            }).catch(falhou);
          });
        }, { id: 'btn-remover-foto' }),
        el('span', { classe: 't-nota texto-suave', texto: 'A pessoa pode pedir a remoção a qualquer momento (LGPD).' })
      ]) : null
    ]);
    var obsImpressa = el('p', { classe: 'obs-impressa', texto: r.observacoes || '' });

    var formulario = blocoFormulario(r, ficha);
    var historico = blocoHistorico(r, daPessoa);
    var extrasDet = formulario || historico ? el('div', { classe: 'det-perfis det-pessoa-grade' }, [historico, formulario]) : null;

    if (!r.calc) {
      art.appendChild(el('div', { classe: 'det-grade det-grade--simples' }, [dados, gestao]));
      art.appendChild(el('section', { classe: 'so-imprimir det-obs-impressa' }, [el('h3', { texto: 'Observações' }), obsImpressa]));
      if (extrasDet) art.appendChild(extrasDet);
      art.appendChild(el('p', { classe: 'aviso aviso--erro', texto: 'As respostas deste participante estão incompletas ou corrompidas; não é possível calcular o perfil.' }));
      return;
    }

    // Gráfico + lateral (dados e avaliação)
    var grafico = el('section', { classe: 'caixa det-grafico surgir' }, [
      el('header', { classe: 'det-grafico__topo' }, [
        el('h3', { classe: 'caixa__titulo', texto: 'Resultado DISC' }),
        badgePerfil(r)
      ]),
      nomeCombinacao(r.calc.codigo) ? el('p', { classe: 'det-combinacao', id: 'det-combinacao' }, [
        el('span', { classe: 'texto-suave', texto: 'Combinação ' + r.calc.codigo + ': ' }),
        el('span', { classe: 'seminegrito', texto: nomeCombinacao(r.calc.codigo) })
      ]) : null,
      graficoDisc(r.calc),
      el('p', { classe: 'legenda', texto: 'D = Dominância · I = Influência · S = Estabilidade · C = Conformidade. Cada letra varia de 10% a 40%; a soma é 100%.' })
    ]);
    art.appendChild(el('div', { classe: 'det-grade' }, [grafico, el('div', { classe: 'det-lado' }, [dados, gestao])]));
    var parte2 = blocoParte2(r);
    if (parte2) art.appendChild(parte2);
    art.appendChild(el('section', { classe: 'so-imprimir det-obs-impressa' }, [el('h3', { texto: 'Observações' }), obsImpressa]));
    if (extrasDet) art.appendChild(extrasDet);
    var relDet = blocoRelatoriosDetalhe(r, ficha);
    if (relDet) art.appendChild(relDet);

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

  /* ---------- Detalhe: mover a resposta de processo e contratar (levar para uma empresa) ---------- */

  function podeMoverResposta() { return MODO_API && papel() === 'admin' && !!metodoApi('moverResposta'); }
  function podeContratar() { return MODO_API && papel() === 'admin' && empresasOk() && !!metodoApi('contratarPessoa'); }

  function janelaMoverProcesso(r) {
    var ops = opcoesMoverProcesso(estado.processos, r.avaliacao || '');
    var esc = criarSeletorBusca({ id: 'mover-processo', rotulo: 'Processo de destino', rotuloId: 'mover-processo-rotulo', vazio: 'Escolher o processo',
      placeholder: 'Nome, código ou empresa…', opcoes: ops.map(function (o) { return { valor: o.valor === '' ? '-' : o.valor, rotulo: o.rotulo, sub: o.sub }; }) });
    abrirJanela({
      id: 'janela-mover-processo',
      titulo: 'Mover ' + (r.nome || 'a resposta') + ' para outro processo',
      texto: 'Hoje: ' + textoOrigem(r) + '. A resposta passa a aparecer no processo escolhido (e no relatório dele). O teste não muda.',
      corpo: [campoEscolha('Processo de destino', esc, 'mover-processo-rotulo')],
      botao: 'Mover resposta',
      aoConfirmar: function () {
        var v = esc.valor();
        if (!v) throw new Error('Escolha o processo de destino.');
        var destinoId = v === '-' ? '' : v;
        var p = destinoId ? acharProcesso(destinoId) : null;
        return api('moverResposta', r.id, destinoId).then(function () {
          var antigo = r.avaliacao ? acharProcessoPorCodigo(r.avaliacao) : null;
          if (antigo && Number(antigo.respostas)) antigo.respostas = Number(antigo.respostas) - 1;
          if (p) p.respostas = (Number(p.respostas) || 0) + 1;
          r.avaliacao = p ? p.codigo : '';
          r.avaliacaoNome = p ? p.nome : '';
          r.empresaNome = p ? empresaDe(p) : '';
          r.avaliacaoTipo = p ? p.tipo : '';
          estado.relatorios = {};
          avisar(p ? 'Resposta movida para "' + p.nome + '".' : 'Resposta tirada do processo (link geral).', 'ok');
          renderizarLista(); renderizarProcessos(); renderizarDetalhe();
        });
      }
    });
  }

  function janelaContratar(r, vinculo) {
    var empresas = (estado.emp.lista || []).filter(function (e) { return e.ativo !== false; });
    var esc = criarSeletorBusca({ id: 'contratar-empresa', rotulo: 'Empresa', rotuloId: 'contratar-empresa-rotulo', vazio: 'Escolher a empresa',
      opcoes: empresas.map(function (e) { return { valor: e.id, rotulo: e.nome, sub: e.cidade || '' }; }) });
    var nome = r.nome || 'a pessoa';
    abrirJanela({
      id: 'janela-contratar',
      titulo: 'Adicionar ' + nome + ' à empresa',
      texto: (vinculo ? 'Hoje é colaborador(a) em ' + vinculo.empresa.nome + ': se escolher outra empresa, o vínculo atual vai para o histórico. ' : '') +
        'A pessoa entra como colaboradora ativa, com o teste que já fez, e esta resposta fica como "Aprovado".',
      corpo: [
        campoEscolha('Empresa', esc, 'contratar-empresa-rotulo'),
        el('div', { classe: 'form-grade' }, [
          campoCom('contratar-cargo', 'Cargo', r.vaga || r.funcao || '', { maxlength: 120 }),
          campoCom('contratar-area', 'Área', '', { maxlength: 120 })
        ])
      ],
      botao: 'Adicionar à empresa',
      aoConfirmar: function () {
        var eid = esc.valor();
        if (!eid) throw new Error('Escolha a empresa.');
        var d = { respostaId: r.id, empresaId: eid, cargo: $('contratar-cargo').value.trim(), area: $('contratar-area').value.trim() };
        return api('contratarPessoa', d).then(function () {
          r.status = 'aprovado';
          esquecerEquipes();
          avisar(nome + ' agora é colaborador(a) em ' + nomeEmpresa(eid) + '.', 'ok');
          renderizarLista();
          return carregarEmpresas().then(function () { if (estado.abertoId === r.id) renderizarDetalhe(); });
        });
      }
    });
  }

  // Linha "Colaborador(a) em <Empresa>" no topo do detalhe (com link para a empresa).
  function linhaVinculoDetalhe(r) {
    var p = el('p', { classe: 'det-vinculo-topo', id: 'det-empresa-vinculo', hidden: true });
    if (!empresasOk() || !r.pessoaId || papel() !== 'admin') return p;
    acharVinculo(r.pessoaId).then(function (v) {
      if (!v || !document.body.contains(p)) return;
      limpar(p);
      p.appendChild(el('span', { classe: 'texto-suave', texto: 'Colaborador(a) em ' }));
      p.appendChild(el('button', { type: 'button', classe: 'link-botao seminegrito', id: 'det-link-empresa', texto: v.empresa.nome,
        onclick: function () { irParaEmpresas('pagina', v.empresa.id); } }));
      if (v.colaborador.cargo) p.appendChild(el('span', { classe: 'texto-suave', texto: ' · ' + v.colaborador.cargo }));
      p.hidden = false;
      var btn = $('btn-contratar');
      if (btn) btn.onclick = function () { janelaContratar(r, v); };
    });
    return p;
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

  /* ---------- Processos (admin): lista, formulário, página do processo e editor do relatório ---------- */

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

  function copiar(txt, msgOk) {
    copiarTexto(txt).then(function () { avisar(msgOk, 'ok'); }, function () { avisar('Não foi possível copiar. Selecione o texto e copie.', 'erro'); });
  }

  function botao(classe, texto, onclick, extra) {
    var a = { type: 'button', classe: 'botao ' + classe, texto: texto, onclick: onclick };
    for (var k in extra || {}) a[k] = extra[k];
    return el('button', a);
  }

  // Muda a tela dentro da aba Processos e leva o foco ao título.
  function irParaProcessos(tela, id) {
    estado.proc = { tela: tela || 'lista', id: id || null };
    renderizarProcessos();
    mostrarAba('processos');
    root.scrollTo(0, 0);
    var h = $('vista-processos').querySelector('h2');
    if (h) { h.setAttribute('tabindex', '-1'); h.focus(); }
  }

  function renderizarProcessos() {
    var box = $('vista-processos');
    limpar(box);
    if (papel() !== 'admin') return;
    var t = estado.proc.tela;
    var p = estado.proc.id ? acharProcesso(estado.proc.id) : null;
    if (t === 'form') return renderizarFormProcesso(box, p);
    if (t === 'pagina' && p) return renderizarPaginaProcesso(box, p);
    if (t === 'editor' && p && estado.editor && estado.editor.processoId === p.id) return renderizarEditor(box, p);
    estado.proc = { tela: 'lista', id: null };
    renderizarListaProcessos(box);
  }

  function textoLocal(p) {
    return [empresaDe(p), p.vaga && p.vaga !== p.nome ? p.vaga : '', p.cidade].filter(Boolean).join(' · ');
  }

  function renderizarListaProcessos(box) {
    box.appendChild(cabecalhoVista('Processos seletivos', 'Processos',
      'Cada processo tem o link do teste DISC, a lista do ClickUp com os candidatos e a configuração do relatório.',
      [botao('botao--principal', 'Novo processo', function () { irParaProcessos('form', null); }, { id: 'btn-novo-processo' })]));
    if (!estado.processos.length) {
      box.appendChild(el('div', { classe: 'caixa vazio' }, el('p', { classe: 'vazio__texto', texto: 'Nenhum processo criado ainda.' })));
      return;
    }
    box.appendChild(el('ul', { classe: 'gestao-lista', id: 'lista-processos' }, estado.processos.map(function (p) {
      var link = linkDe(p);
      var n = Number(p.respostas) || 0;
      var abrir = function () { irParaProcessos('pagina', p.id); };
      var acoes = [
        botao('botao--principal botao--pequeno', 'Abrir', abrir, { 'data-acao': 'abrir' }),
        botao('botao--claro botao--pequeno', 'Copiar link', function () { copiar(link, 'Link copiado.'); }, { 'data-acao': 'copiar-link' }),
        botao('botao--claro botao--pequeno', 'Copiar mensagem', function () { copiar(mensagemConvite(p, link), 'Mensagem copiada. Cole no WhatsApp.'); }, { 'data-acao': 'copiar-mensagem' }),
        botao('botao--claro botao--pequeno', 'Editar', function () { irParaProcessos('form', p.id); }, { 'data-acao': 'editar' }),
        botao('botao--claro botao--pequeno', p.ativa ? 'Desativar' : 'Ativar', function () { alternarAtivo(p); }, { 'data-acao': 'alternar-ativa' }),
        n === 0 ? botao('botao--perigo botao--pequeno', 'Excluir', function () { excluirProcesso(p); }, { 'data-acao': 'excluir' }) : null
      ];
      return el('li', { classe: 'caixa gestao-card av-card proc-card', 'data-codigo': p.codigo, 'data-id': p.id }, [
        el('div', { classe: 'gestao-card__topo' }, [
          el('div', { classe: 'gestao-card__titulo-area' }, [
            el('h3', { classe: 'gestao-card__titulo seminegrito' }, el('button', { type: 'button', classe: 'link-botao proc-card__nome', texto: p.nome, onclick: abrir })),
            el('p', { classe: 'gestao-card__sub', texto: [textoLocal(p) || '—', n + ' resposta' + (n === 1 ? '' : 's')].join(' · ') })
          ]),
          el('span', { classe: 'protocolo', title: 'Código do link' }, [
            el('span', { classe: 'protocolo__rotulo', texto: 'Código' }),
            el('span', { classe: 'protocolo__valor t-titulo negrito tabular av-codigo', texto: p.codigo })
          ])
        ]),
        el('div', { classe: 'card-selos' }, [
          el('span', { classe: 'selo av-ativa ' + (p.ativa ? 'selo--verde' : ''), texto: p.ativa ? 'Ativo' : 'Desativado' }),
          el('span', { classe: 'selo proc-clickup', texto: p.clickupListId ? 'Lista do ClickUp ligada' : 'Sem lista do ClickUp' }),
          p.tipo === 'equipe' ? el('span', { classe: 'selo', texto: TIPOS.equipe }) : null,
          p.mostrarResultado ? el('span', { classe: 'selo', texto: 'Mostra o relatório ao participante' }) : null
        ]),
        el('p', { classe: 'av-link', texto: link }),
        el('div', { classe: 'gestao-card__acoes' }, acoes),
        n > 0 ? el('p', { classe: 'gestao-card__nota', texto: 'Já tem respostas: para encerrar, desative em vez de excluir.' }) : null
      ]);
    })));
  }

  function alternarAtivo(p) {
    api('processosSalvar', { id: p.id, nome: p.nome, tipo: p.tipo || 'selecao', ativa: !p.ativa })
      .then(function () { avisar(p.ativa ? 'Processo desativado: o link deixa de aceitar respostas.' : 'Processo ativado.', 'ok'); return carregar(); })
      .catch(falhou);
  }

  function excluirProcesso(p) {
    confirmar({ titulo: 'Excluir o processo?', texto: '"' + p.nome + '" ainda não tem respostas. O link ' + p.codigo + ' deixa de existir.', botao: 'Excluir processo' }).then(function (ok) {
      if (!ok) return;
      api('processosExcluir', p.id).then(function () {
        avisar('Processo excluído.', 'ok');
        estado.proc = { tela: 'lista', id: null };
        return carregar();
      }).catch(falhou);
    });
  }

  /* ----- Formulário do processo ----- */

  function campoArea(id, rotulo, valor, attrs) {
    var a = { id: id, classe: 'entrada', rows: 3, maxlength: 2000 };
    for (var k in attrs || {}) a[k] = attrs[k];
    var ta = el('textarea', a);
    ta.value = valor || '';
    return el('label', { classe: 'campo', for: id }, [el('span', { classe: 'campo__rotulo', texto: rotulo }), ta]);
  }

  function campoCom(id, rotulo, valor, attrs) {
    var c = campoTexto(id, rotulo, attrs);
    c.querySelector('input').value = valor == null ? '' : String(valor);
    return c;
  }

  function secaoForm(titulo, texto, filhos, extraClasse) {
    return el('section', { classe: 'caixa form-secao' + (extraClasse ? ' ' + extraClasse : '') }, [
      el('h3', { classe: 'caixa__titulo', texto: titulo }),
      texto ? el('p', { classe: 'form-secao__texto', texto: texto }) : null
    ].concat(filhos));
  }

  function renderizarFormProcesso(box, p) {
    var cfgBase = (p && p.config) || configPadrao();
    // Cópia de trabalho da config (o formulário mexe só nela até salvar)
    var f = {
      perfil: normalizarPerfilIdeal(cfgBase.perfilIdeal),
      etapas: (cfgBase.etapas || []).map(function (e) { return { id: e.id, nome: e.nome || '', peso: e.peso, campo: e.campo || '', descricao: e.descricao || '' }; }),
      bonus: (cfgBase.bonus || []).map(function (b) {
        var r = b.regra || {};
        return { id: b.id, nome: b.nome || '', campo: b.campo || '', tipo: r.tipo === 'mapa' ? 'mapa' : 'checkbox',
          pontos: r.tipo === 'mapa' ? '' : r.pontos,
          pares: r.tipo === 'mapa' ? Object.keys(r.pontos || {}).map(function (k) { return { valor: k, pontos: r.pontos[k] }; }) : [] };
      })
    };
    var per = (p && p.periodo) || {};
    var preset = (!p && estado.proc.preset) || {};

    // Tipo do processo e empresa cadastrada (Supabase/prévia): equipe + empresa = link do teste da equipe.
    var escTipo = criarEscolha({ id: 'proc-tipo', rotulo: 'Tipo', rotuloId: 'proc-tipo-rotulo', classe: 'escolha--campo escolha--larga',
      valor: (p && p.tipo) || preset.tipo || 'selecao',
      opcoes: ['selecao', 'equipe'].map(function (t) { return { valor: t, rotulo: TIPOS[t] }; }) });
    var escEmpresa = null;
    if (empresasOk()) {
      var empsForm = (estado.emp.lista || []).filter(function (e) { return e.ativo !== false || (p && e.id === p.empresaId); });
      escEmpresa = criarSeletorBusca({ id: 'proc-empresa-id', rotulo: 'Empresa cadastrada', rotuloId: 'proc-empresa-id-rotulo', vazio: 'Nenhuma (só o nome em texto)',
        valor: (p && p.empresaId) || preset.empresaId || '', opcoes: empsForm.map(function (e) { return { valor: e.id, rotulo: e.nome, sub: e.cidade || '' }; }) });
    }
    var textoEquipe = el('p', { classe: 'form-secao__texto proc-equipe-texto', id: 'proc-equipe-texto', 'aria-live': 'polite' });
    function atualizarTipo() {
      var eqp = escTipo.botao.value === 'equipe';
      var empId = escEmpresa ? escEmpresa.valor() : '';
      textoEquipe.hidden = !eqp;
      textoEquipe.textContent = !eqp ? '' : (empId ? textoEquipeEmpresa(nomeEmpresa(empId))
        : (escEmpresa ? 'Escolha a empresa cadastrada para que as respostas entrem no cadastro dela como colaboradores.' : 'Avaliação de perfil dos colaboradores de uma empresa.'));
    }
    escTipo.botao.addEventListener('change', atualizarTipo);
    if (escEmpresa) escEmpresa.aoMudar(function () {
      var nome = nomeEmpresa(escEmpresa.valor());
      var campoEmp = $('proc-empresa');
      if (nome && campoEmp && !campoEmp.value.trim()) campoEmp.value = nome;
      atualizarTipo();
    });

    box.appendChild(cabecalhoVista(p ? 'Editar processo · código ' + p.codigo : 'Novo processo', p ? p.nome : 'Novo processo',
      'Preencha os dados, ligue a lista do ClickUp e diga como o relatório deve pontuar os candidatos.',
      [botao('botao--claro', '← Voltar', function () { irParaProcessos(p ? 'pagina' : 'lista', p ? p.id : null); })]));

    var form = el('form', { classe: 'form-processo', id: 'form-processo', novalidate: true });

    // 1. Dados
    form.appendChild(secaoForm('Dados do processo', null, [
      el('div', { classe: 'form-grade' }, [
        campoCom('proc-nome', 'Nome do processo', p && p.nome, { maxlength: 80, placeholder: 'Ex.: Escrevente de atendimento 2026' }),
        campoCom('proc-empresa', 'Empresa contratante', (p && empresaDe(p)) || preset.empresa || '', { maxlength: 80 }),
        campoCom('proc-vaga', 'Vaga', p && p.vaga, { maxlength: 120 }),
        campoCom('proc-cidade', 'Cidade', p && p.cidade, { maxlength: 80, placeholder: 'Ex.: Boa Vista / RR' }),
        campoCom('proc-consultor', 'Consultor responsável', p && p.consultor, { maxlength: 80 }),
        campoCom('proc-contratante', 'Quem recebe o relatório (nome)', p && p.contratante, { maxlength: 80 }),
        campoCom('proc-inicio', 'Início', per.inicio, { type: 'date' }),
        campoCom('proc-fim', 'Fim', per.fim, { type: 'date' })
      ]),
      el('div', { classe: 'form-grade' }, [
        campoEscolha('Tipo', escTipo, 'proc-tipo-rotulo'),
        escEmpresa ? campoEscolha('Empresa cadastrada', escEmpresa, 'proc-empresa-id-rotulo') : null
      ]),
      textoEquipe,
      el('div', { classe: 'form-marcas' }, [
        campoMarcar('proc-ativa', 'Processo ativo (o link aceita respostas)', p ? p.ativa : true),
        campoMarcar('proc-mostrar', 'Mostrar ao participante o relatório DISC completo dele no final (os 4 fatores, perfil principal e secundário e características; sem vaga, função ou aderência)', p ? p.mostrarResultado : false)
      ])
    ]));

    // 1b. O que perguntar ao candidato (config.formulario)
    var formBase = normalizarFormulario(cfgBase.formulario);
    f.campos = formBase.campos;
    f.perguntas = formBase.perguntas.map(function (q) { return { id: q.id, texto: q.texto, obrigatoria: q.obrigatoria }; });
    var fixos = el('ul', { classe: 'pergunta-fixos', id: 'proc-campos-fixos' }, ['Nome completo', 'WhatsApp'].map(function (t) {
      return el('li', { classe: 'pergunta-campo' }, [el('span', { classe: 'pergunta-campo__rotulo', texto: t }), el('span', { classe: 'selo selo--noite', texto: 'Sempre pedido' })]);
    }));
    var camposConfig = el('ul', { classe: 'pergunta-campos', id: 'proc-campos' }, CAMPOS_FORMULARIO.map(function (c) {
      var rotuloId = 'proc-campo-' + c.chave + '-rotulo';
      var esc = criarEscolha({ id: 'proc-campo-' + c.chave, rotulo: c.rotulo, rotuloId: rotuloId, classe: 'escolha--campo', valor: f.campos[c.chave],
        opcoes: ['obrigatorio', 'opcional', 'oculto'].map(function (m) { return { valor: m, rotulo: MODOS_CAMPO[m] }; }) });
      esc.botao.addEventListener('change', function () { f.campos[c.chave] = esc.botao.value; });
      return el('li', { classe: 'pergunta-campo', 'data-campo': c.chave }, [el('span', { classe: 'pergunta-campo__rotulo', id: rotuloId, texto: c.rotulo }), esc.caixa]);
    }));
    var listaPerguntas = el('ol', { classe: 'config-lista', id: 'proc-perguntas' });
    var btnAddPergunta = botao('botao--contorno', 'Adicionar pergunta', function () {
      if (f.perguntas.length >= MAX_PERGUNTAS) return;
      f.perguntas.push({ id: '', texto: '', obrigatoria: false });
      desenharPerguntas();
      var n = $('pergunta-texto-' + (f.perguntas.length - 1)); if (n) n.focus();
    }, { id: 'btn-add-pergunta' });
    var notaPerguntas = el('p', { classe: 'form-secao__texto', id: 'proc-perguntas-nota', 'aria-live': 'polite' });
    function desenharPerguntas() {
      limpar(listaPerguntas);
      f.perguntas.forEach(function (q, i) {
        var texto = campoCom('pergunta-texto-' + i, 'Pergunta ' + (i + 1), q.texto, { maxlength: 200, placeholder: 'Ex.: Qual sua pretensão salarial?' });
        var entrada = texto.querySelector('input');
        var erroQ = el('p', { classe: 'campo__erro pergunta-erro', id: 'pergunta-erro-' + i, role: 'alert' });
        function conferir() { erroQ.textContent = perguntaSensivel(entrada.value) ? msgPerguntaSensivel(entrada.value) : ''; }
        entrada.addEventListener('input', function () { q.texto = entrada.value; conferir(); });
        var marca = campoMarcar('pergunta-obrig-' + i, 'Obrigatória', q.obrigatoria);
        marca.querySelector('input').addEventListener('change', function (ev) { q.obrigatoria = ev.target.checked; });
        listaPerguntas.appendChild(el('li', { classe: 'config-item pergunta-item', 'data-indice': String(i) }, [
          el('div', { classe: 'config-item__topo' }, [
            el('span', { classe: 'config-item__num tabular', texto: 'Pergunta extra ' + (i + 1) }),
            botao('botao--perigo botao--pequeno', 'Remover', function () { f.perguntas.splice(i, 1); desenharPerguntas(); }, { 'aria-label': 'Remover pergunta ' + (i + 1) })
          ]),
          texto, erroQ, marca
        ]));
        conferir();
      });
      btnAddPergunta.disabled = f.perguntas.length >= MAX_PERGUNTAS;
      notaPerguntas.textContent = f.perguntas.length >= MAX_PERGUNTAS ? 'Limite de ' + MAX_PERGUNTAS + ' perguntas extras.'
        : 'Até ' + MAX_PERGUNTAS + ' perguntas abertas. Não pergunte dados sensíveis (sexo, gênero, estado civil, filhos, religião, gravidez, raça, saúde, antecedentes…).';
    }
    form.appendChild(secaoForm('O que perguntar ao candidato', 'Na identificação, antes do teste. Nome completo e WhatsApp são sempre pedidos (o WhatsApp liga as respostas da mesma pessoa).', [
      fixos, camposConfig,
      el('h4', { classe: 'conf-subtitulo', texto: 'Perguntas extras' }),
      notaPerguntas, listaPerguntas, btnAddPergunta
    ], 'form-secao--perguntas'));
    desenharPerguntas();

    // 1c. Segunda parte do teste (perfil exigido pelo trabalho). Ao criar, segue o tipo até a pessoa mexer; ao editar, fica o salvo.
    f.parte2 = p ? formBase.parte2 : parte2Padrao(escTipo.botao.value);
    var parte2Tocada = !!p;
    var estadoParte2 = el('span', { classe: 'pilula-liga__texto', id: 'proc-parte2-estado' });
    var pilulaParte2 = el('button', { type: 'button', classe: 'pilula-liga', id: 'proc-parte2', role: 'switch', 'aria-labelledby': 'proc-parte2-rotulo' }, [
      el('span', { classe: 'pilula-liga__trilho', 'aria-hidden': 'true' }, el('span', { classe: 'pilula-liga__bola' })),
      estadoParte2
    ]);
    var notaParte2 = el('p', { classe: 'form-secao__texto', id: 'proc-parte2-nota', 'aria-live': 'polite' });
    function desenharParte2() {
      var ligada = f.parte2 === 'ligada';
      pilulaParte2.setAttribute('aria-checked', ligada ? 'true' : 'false');
      pilulaParte2.setAttribute('data-valor', f.parte2);
      estadoParte2.textContent = PARTE2[f.parte2];
      notaParte2.textContent = textoParte2(f.parte2);
    }
    pilulaParte2.addEventListener('click', function () {
      parte2Tocada = true;
      f.parte2 = f.parte2 === 'ligada' ? 'desligada' : 'ligada';
      desenharParte2();
    });
    escTipo.botao.addEventListener('change', function () {
      if (parte2Tocada) return;
      f.parte2 = parte2Padrao(escTipo.botao.value);
      desenharParte2();
    });
    form.appendChild(secaoForm(ROTULO_PARTE2, 'Depois do teste, a pessoa responde 10 grupos pensando em como o trabalho exige que ela seja. O painel compara com o perfil natural e mostra o esforço de adaptação. Recomendado para avaliação de equipe.', [
      el('div', { classe: 'parte2-linha' }, [el('span', { classe: 'campo__rotulo', id: 'proc-parte2-rotulo', texto: 'Segunda parte do teste' }), pilulaParte2]),
      notaParte2
    ], 'form-secao--parte2'));
    desenharParte2();

    // 2. ClickUp
    var clickupCorpo = el('div', { classe: 'clickup-corpo', id: 'proc-clickup' });
    form.appendChild(secaoForm('Lista do ClickUp', 'Os candidatos do processo vêm dessa lista: notas das etapas, status e respostas do formulário.', [clickupCorpo]));
    var listaAtual = p ? String(p.clickupListId || '') : '';
    var lerLista = montarClickup(clickupCorpo, listaAtual);

    // 3. Link do teste
    if (p) {
      var link = linkDe(p);
      form.appendChild(secaoForm('Link do teste DISC', 'Envie aos candidatos. As respostas chegam ligadas a este processo.', [
        el('p', { classe: 'av-link', id: 'proc-link', texto: link }),
        el('div', { classe: 'gestao-card__acoes' }, [
          botao('botao--claro botao--pequeno', 'Copiar link', function () { copiar(link, 'Link copiado.'); }),
          botao('botao--claro botao--pequeno', 'Copiar mensagem', function () { copiar(mensagemConvite(p, link), 'Mensagem copiada. Cole no WhatsApp.'); })
        ])
      ]));
    }

    // 4. Perfil ideal
    var codigoPerfil = el('span', { classe: 'badge perfil-codigo', id: 'proc-perfil-codigo' });
    var explicacao = el('p', { classe: 'perfil-explicacao', id: 'proc-perfil-explicacao', 'aria-live': 'polite' });
    var letras = LETRAS.map(function (l) {
      return el('button', { type: 'button', classe: 'perfil-letra', 'data-letra': l, id: 'proc-perfil-' + l, 'aria-pressed': 'false',
        onclick: function () { f.perfil = alternarLetraPerfil(f.perfil, l); atualizarPerfil(); } }, [
        letraDisc(l, 'perfil-letra__sigla'),
        el('span', { classe: 'perfil-letra__nome', texto: NOMES[l] })
      ]);
    });
    function atualizarPerfil() {
      letras.forEach(function (b) {
        var l = b.getAttribute('data-letra');
        var pos = f.perfil.indexOf(l);
        b.setAttribute('aria-pressed', pos === -1 ? 'false' : 'true');
        b.setAttribute('data-ordem', pos === -1 ? '' : String(pos + 1));
      });
      codigoPerfil.textContent = f.perfil || '—';
      codigoPerfil.className = 'badge perfil-codigo' + (f.perfil ? ' disc-' + f.perfil.charAt(0) : ' perfil-codigo--vazio');
      explicacao.textContent = explicarPerfil(f.perfil);
    }
    form.appendChild(secaoForm('Perfil DISC ideal', 'Toque em 1 ou 2 letras. A primeira é o traço principal; a segunda, o traço de apoio.', [
      el('div', { classe: 'perfil-escolha', role: 'group', 'aria-label': 'Letras do perfil ideal' }, letras),
      el('p', { classe: 'perfil-resumo' }, [el('span', { classe: 'texto-suave', texto: 'Perfil ideal: ' }), codigoPerfil]),
      explicacao,
      campoArea('proc-explicacao', 'Por que este perfil (aparece no relatório)', cfgBase.explicacaoPerfil, { maxlength: 2000, placeholder: 'Ex.: a rotina pede conferência rigorosa (C) e firmeza para decidir no balcão (D).' })
    ]));
    atualizarPerfil();

    // 5. Etapas
    var listaEtapas = el('ol', { classe: 'config-lista', id: 'proc-etapas' });
    var somaEtapas = el('p', { classe: 'form-secao__texto tabular', id: 'proc-etapas-soma', 'aria-live': 'polite' });
    function atualizarPesos() {
      var pct = pesosNormalizados(f.etapas);
      Array.prototype.forEach.call(listaEtapas.querySelectorAll('[data-peso-pct]'), function (s, i) {
        s.textContent = String(pct[i] || 0).replace('.', ',') + '% do total';
      });
      var soma = f.etapas.reduce(function (a, e) { var n = Number(e.peso); return a + (isFinite(n) && n > 0 ? n : 0); }, 0);
      somaEtapas.textContent = f.etapas.length ? 'Soma dos pesos: ' + String(soma).replace('.', ',') + '. Cada peso vira uma fatia proporcional dos 100 pontos técnicos.' : 'Nenhuma etapa ainda.';
    }
    function desenharEtapas() {
      limpar(listaEtapas);
      f.etapas.forEach(function (e, i) {
        function ligar(campo, input) { input.addEventListener('input', function () { e[campo] = input.value; if (campo === 'peso') atualizarPesos(); }); return input; }
        var nome = campoCom('etapa-nome-' + i, 'Nome da etapa', e.nome, { maxlength: 80, 'data-campo': 'nome' });
        var peso = campoCom('etapa-peso-' + i, 'Peso', e.peso, { type: 'number', min: 0, step: 'any', inputmode: 'decimal', 'data-campo': 'peso' });
        var campo = campoCom('etapa-campo-' + i, 'Campo da nota no ClickUp (0 a 10)', e.campo, { maxlength: 120, placeholder: 'Ex.: Nota Revisão', 'data-campo': 'campo' });
        var desc = campoArea('etapa-desc-' + i, 'Descrição (aparece no relatório)', e.descricao, { rows: 2, maxlength: 1000 });
        ligar('nome', nome.querySelector('input'));
        ligar('peso', peso.querySelector('input'));
        ligar('campo', campo.querySelector('input'));
        ligar('descricao', desc.querySelector('textarea'));
        listaEtapas.appendChild(el('li', { classe: 'config-item etapa-item', 'data-indice': String(i) }, [
          el('div', { classe: 'config-item__topo' }, [
            el('span', { classe: 'config-item__num tabular', texto: 'Etapa ' + (i + 1) }),
            el('span', { classe: 'config-item__peso tabular', 'data-peso-pct': '' }),
            botao('botao--perigo botao--pequeno', 'Remover', function () { f.etapas.splice(i, 1); desenharEtapas(); }, { 'aria-label': 'Remover etapa ' + (i + 1) })
          ]),
          el('div', { classe: 'form-grade form-grade--etapa' }, [nome, peso, campo]),
          desc
        ]));
      });
      atualizarPesos();
    }
    form.appendChild(secaoForm('Etapas avaliadas', 'Cada etapa tem uma nota de 0 a 10 num campo numérico do ClickUp. Etapa sem nenhuma nota ainda aparece como "peso em aberto".', [
      somaEtapas, listaEtapas,
      botao('botao--contorno', 'Adicionar etapa', function () {
        f.etapas.push({ nome: '', peso: 10, campo: '', descricao: '' });
        desenharEtapas();
        var n = $('etapa-nome-' + (f.etapas.length - 1)); if (n) n.focus();
      }, { id: 'btn-add-etapa' })
    ]));
    desenharEtapas();

    // 6. Bônus
    var listaBonus = el('ol', { classe: 'config-lista', id: 'proc-bonus' });
    function desenharBonus() {
      limpar(listaBonus);
      f.bonus.forEach(function (b, i) {
        var nome = campoCom('bonus-nome-' + i, 'Nome do bônus', b.nome, { maxlength: 80 });
        var campo = campoCom('bonus-campo-' + i, 'Campo no ClickUp', b.campo, { maxlength: 120 });
        nome.querySelector('input').addEventListener('input', function (ev) { b.nome = ev.target.value; });
        campo.querySelector('input').addEventListener('input', function (ev) { b.campo = ev.target.value; });
        var escTipo = criarEscolha({ id: 'bonus-tipo-' + i, rotulo: 'Como pontua', rotuloId: 'bonus-tipo-' + i + '-rotulo', classe: 'escolha--campo escolha--larga', valor: b.tipo,
          opcoes: [{ valor: 'checkbox', rotulo: 'Caixa marcada vale pontos' }, { valor: 'mapa', rotulo: 'Cada valor vale uma pontuação' }] });
        escTipo.botao.addEventListener('change', function () {
          b.tipo = escTipo.botao.value;
          if (b.tipo === 'mapa' && !b.pares.length) b.pares.push({ valor: '', pontos: '' });
          desenharBonus();
        });
        var regra;
        if (b.tipo === 'mapa') {
          regra = el('div', { classe: 'mapa' }, [
            el('ul', { classe: 'mapa__lista' }, b.pares.map(function (par, k) {
              var v = el('input', { classe: 'entrada', id: 'bonus-' + i + '-valor-' + k, type: 'text', maxlength: 120, 'aria-label': 'Valor exibido no ClickUp', placeholder: 'Valor (como aparece no ClickUp)' });
              var pt = el('input', { classe: 'entrada mapa__pontos', id: 'bonus-' + i + '-pontos-' + k, type: 'number', step: 'any', inputmode: 'decimal', 'aria-label': 'Pontos', placeholder: 'Pontos' });
              v.value = par.valor; pt.value = par.pontos == null ? '' : par.pontos;
              v.addEventListener('input', function () { par.valor = v.value; });
              pt.addEventListener('input', function () { par.pontos = pt.value; });
              return el('li', { classe: 'mapa__par' }, [v, el('span', { classe: 'mapa__seta', 'aria-hidden': 'true', texto: '→' }), pt,
                botao('botao--claro botao--pequeno', 'Tirar', function () { b.pares.splice(k, 1); desenharBonus(); }, { 'aria-label': 'Tirar valor ' + (k + 1) })]);
            })),
            botao('botao--claro botao--pequeno', 'Adicionar valor', function () { b.pares.push({ valor: '', pontos: '' }); desenharBonus(); }, { id: 'bonus-' + i + '-add-valor' })
          ]);
        } else {
          regra = campoCom('bonus-pontos-' + i, 'Pontos quando marcada', b.pontos, { type: 'number', step: 'any', inputmode: 'decimal' });
          regra.querySelector('input').addEventListener('input', function (ev) { b.pontos = ev.target.value; });
        }
        listaBonus.appendChild(el('li', { classe: 'config-item bonus-item', 'data-indice': String(i) }, [
          el('div', { classe: 'config-item__topo' }, [
            el('span', { classe: 'config-item__num tabular', texto: 'Bônus ' + (i + 1) }),
            botao('botao--perigo botao--pequeno', 'Remover', function () { f.bonus.splice(i, 1); desenharBonus(); }, { 'aria-label': 'Remover bônus ' + (i + 1) })
          ]),
          el('div', { classe: 'form-grade' }, [nome, campo]),
          campoEscolha('Como pontua', escTipo, 'bonus-tipo-' + i + '-rotulo'),
          regra
        ]));
      });
    }
    form.appendChild(secaoForm('Bônus', 'Pontos extras somados por fora da nota técnica (ex.: graduação na área).', [
      listaBonus,
      botao('botao--contorno', 'Adicionar bônus', function () {
        f.bonus.push({ nome: '', campo: '', tipo: 'checkbox', pontos: 5, pares: [] });
        desenharBonus();
        var n = $('bonus-nome-' + (f.bonus.length - 1)); if (n) n.focus();
      }, { id: 'btn-add-bonus' })
    ]));
    desenharBonus();

    // 7. Corte, faixa e finalistas
    var cfgCorte = cfgBase.corte == null ? 70 : cfgBase.corte;
    var cfgFaixa = cfgBase.faixaAvaliar == null ? 55 : cfgBase.faixaAvaliar;
    form.appendChild(secaoForm('Corte e finalistas', 'Score total = nota técnica (0 a 100) + bônus. Quem passa do corte é "aprovado"; entre a faixa e o corte, "avaliar".', [
      el('div', { classe: 'form-grade' }, [
        campoCom('proc-corte', 'Nota de corte (aprovado)', cfgCorte, { type: 'number', min: 0, step: 'any', inputmode: 'decimal' }),
        campoCom('proc-faixa', 'A partir de (faixa "avaliar")', cfgFaixa, { type: 'number', min: 0, step: 'any', inputmode: 'decimal' })
      ]),
      campoCom('proc-finalistas', 'Status do ClickUp que contam como finalistas (separe por vírgula)', (cfgBase.statusFinalistas || []).join(', '),
        { maxlength: 400, placeholder: 'Vazio = quem tem nota de etapa ou DISC' }),
      campoMarcar('proc-antecedentes', 'Permitir campo de antecedentes (nunca aparece no relatório do contratante)', cfgBase.permitirAntecedentes === true)
    ]));

    var erro = el('p', { classe: 'campo__erro form-erro', id: 'proc-erro', role: 'alert' });
    var btnSalvar = el('button', { type: 'submit', classe: 'botao botao--principal botao--grande', id: 'btn-salvar-processo', texto: p ? 'Salvar alterações' : 'Criar processo' });
    form.appendChild(el('div', { classe: 'form-rodape' }, [
      erro,
      el('div', { classe: 'confirmar__acoes' }, [
        botao('botao--claro botao--grande', 'Cancelar', function () { irParaProcessos(p ? 'pagina' : 'lista', p ? p.id : null); }),
        btnSalvar
      ])
    ]));

    function montarDados() {
      var usados = {};
      f.etapas.forEach(function (e) { if (e.id) usados[e.id] = true; });
      f.bonus.forEach(function (b) { if (b.id) usados[b.id] = true; });
      var config = {
        perfilIdeal: f.perfil,
        explicacaoPerfil: $('proc-explicacao').value.trim(),
        etapas: f.etapas.map(function (e) {
          return { id: e.id || idSimples(e.nome, usados, 'etapa'), nome: String(e.nome).trim(), peso: numeroOuNulo(e.peso),
            campo: String(e.campo).trim(), descricao: String(e.descricao).trim() };
        }),
        bonus: f.bonus.map(function (b) {
          var regra;
          if (b.tipo === 'mapa') {
            var pontos = {};
            b.pares.forEach(function (par) { var v = String(par.valor).trim(); var n = numeroOuNulo(par.pontos); if (v && n !== null) pontos[v] = n; });
            regra = { tipo: 'mapa', pontos: pontos };
          } else regra = { tipo: 'checkbox', pontos: numeroOuNulo(b.pontos) };
          return { id: b.id || idSimples(b.nome, usados, 'bonus'), nome: String(b.nome).trim(), campo: String(b.campo).trim(), regra: regra };
        }),
        corte: numeroOuNulo($('proc-corte').value),
        faixaAvaliar: numeroOuNulo($('proc-faixa').value),
        statusFinalistas: $('proc-finalistas').value.split(',').map(function (x) { return x.trim(); }).filter(Boolean),
        permitirAntecedentes: $('proc-antecedentes').checked,
        formulario: {
          campos: Object.assign({}, f.campos),
          perguntas: f.perguntas.map(function (q) { return { id: q.id, texto: String(q.texto).replace(/\s+/g, ' ').trim(), obrigatoria: q.obrigatoria === true }; }),
          parte2: f.parte2 === 'ligada' ? 'ligada' : 'desligada'
        }
      };
      if (cfgBase.permitirSaude === true) config.permitirSaude = true;
      var dados = {
        nome: $('proc-nome').value.trim(),
        empresa: $('proc-empresa').value.trim(),
        vaga: $('proc-vaga').value.trim(),
        cidade: $('proc-cidade').value.trim(),
        consultor: $('proc-consultor').value.trim(),
        contratante: $('proc-contratante').value.trim(),
        periodo: { inicio: $('proc-inicio').value, fim: $('proc-fim').value },
        clickupListId: lerLista(),
        tipo: escTipo.botao.value || 'selecao',
        mostrarResultado: $('proc-mostrar').checked,
        ativa: $('proc-ativa').checked,
        config: config
      };
      if (p) dados.id = p.id;
      if (escEmpresa) dados.empresaId = escEmpresa.valor() || null;
      return dados;
    }

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      erro.textContent = '';
      var dados = montarDados();
      var problema = !dados.nome ? 'Informe o nome do processo.' : validarConfig(dados.config);
      if (!problema && dados.periodo.inicio && dados.periodo.fim && dados.periodo.fim < dados.periodo.inicio) problema = 'O fim do período precisa ser depois do início.';
      if (problema) { erro.textContent = problema; return; }
      dados.config.formulario = normalizarFormulario(dados.config.formulario);
      btnSalvar.disabled = true;
      api('processosSalvar', dados).then(function (resp) {
        var novo = resp.processo || {};
        avisar(p ? 'Processo salvo.' : 'Processo criado. Código ' + (novo.codigo || '') + ': copie o link e envie.', 'ok');
        estado.proc = { tela: 'pagina', id: novo.id || (p && p.id) };
        return carregar().then(function () { irParaProcessos(estado.proc.tela, estado.proc.id); });
      }).catch(function (e) {
        if (e && e.tratado) return;
        erro.textContent = (e && e.message) || 'Não foi possível salvar.';
      }).then(function () { btnSalvar.disabled = false; });
    });
    box.appendChild(form);
    atualizarTipo();
  }

  // Bloco da lista do ClickUp. Configurado: seletor em pílula com as listas. Senão: passo a passo + campo do ID.
  // Devolve a função que lê o ID escolhido.
  function montarClickup(corpo, atual) {
    var lerManual = null;
    function manual(textoAviso) {
      var entrada = el('input', { id: 'proc-lista-id', classe: 'entrada tabular', type: 'text', maxlength: 200, autocomplete: 'off', placeholder: 'Ex.: 901234567890 ou o endereço da lista' });
      entrada.value = atual;
      lerManual = function () { return idListaDoTexto(entrada.value); };
      return [
        textoAviso,
        el('label', { classe: 'campo', for: 'proc-lista-id' }, [
          el('span', { classe: 'campo__rotulo', texto: 'ID da lista do ClickUp' }), entrada,
          el('span', { classe: 'campo__ajuda', texto: 'Abra a lista no ClickUp e copie o endereço: o ID é o número depois de "/li/". Pode colar o endereço inteiro.' })
        ])
      ];
    }
    if (!estado.clickup.configurado) {
      adicionar(corpo, manual(el('div', { classe: 'aviso clickup-passos', id: 'clickup-desligado' }, [
        el('p', { classe: 'seminegrito', texto: 'O ClickUp ainda não está ligado ao sistema.' }),
        el('ol', { classe: 'clickup-passos__lista' }, [
          el('li', { texto: 'No ClickUp, abra seu avatar > Configurações > Apps e gere o "API Token" pessoal.' }),
          el('li', { texto: 'No Apps Script do sistema, vá em Configurações do projeto > Propriedades do script e crie CLICKUP_TOKEN com esse token.' }),
          el('li', { texto: 'Volte aqui e atualize a página. Enquanto isso, cole o ID da lista abaixo.' })
        ])
      ])));
      return function () { return lerManual(); };
    }
    var esc = null;
    var area = el('div', { classe: 'clickup-escolha' }, el('p', { classe: 'texto-suave t-rotulo', id: 'proc-lista-carregando', texto: 'Carregando as listas do ClickUp…' }));
    corpo.appendChild(area);
    api('clickupListas').then(function (resp) {
      var listas = resp.listas || [];
      var opcoes = [{ valor: '', rotulo: 'Sem lista (só o teste DISC)' }].concat(listas.map(function (l) {
        return { valor: String(l.id), rotulo: (l.pasta ? l.pasta + ' · ' : '') + l.nome };
      }));
      if (atual && !listas.some(function (l) { return String(l.id) === atual; })) opcoes.push({ valor: atual, rotulo: 'Lista ' + atual + ' (não encontrada)' });
      esc = criarEscolha({ id: 'proc-lista', rotulo: 'Lista do ClickUp', rotuloId: 'proc-lista-rotulo', classe: 'escolha--campo escolha--larga', valor: atual, opcoes: opcoes });
      limpar(area);
      area.appendChild(campoEscolha('Lista do ClickUp', esc, 'proc-lista-rotulo'));
      if (!listas.length) area.appendChild(el('p', { classe: 'campo__ajuda', texto: 'Nenhuma lista encontrada. Confira a pasta configurada (CLICKUP_PASTA_ID) ou o acesso do token.' }));
    }).catch(function (e) {
      if (e && e.tratado) return;
      limpar(area);
      adicionar(area, manual(el('p', { classe: 'aviso aviso--erro', texto: 'Não deu para ler as listas do ClickUp (' + ((e && e.message) || 'erro') + '). Cole o ID da lista.' })));
    });
    return function () {
      if (esc && $('proc-lista')) return $('proc-lista').value;
      if (lerManual) return lerManual();
      return atual;
    };
  }

  /* ----- Página do processo ----- */

  function textoPeriodo(per) {
    function br(d) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d || '')); return m ? m[3] + '/' + m[2] + '/' + m[1] : ''; }
    var a = br(per && per.inicio), b = br(per && per.fim);
    return a && b ? a + ' a ' + b : (a ? 'desde ' + a : (b ? 'até ' + b : '—'));
  }

  function dlItem(rotulo, valor, id, largo) {
    return el('div', { classe: largo ? 'det-dl__largo' : null }, [el('dt', { texto: rotulo }), el('dd', { id: id || null, texto: valor || '—' })]);
  }

  function verParticipantes(p) {
    estado.filtros.processo = p.codigo;
    $('filtro-busca').value = '';
    montarFiltros();
    renderizarLista();
    mostrarAba('lista');
  }

  function gerarRascunho(p, btn) {
    btn.disabled = true;
    btn.textContent = 'Gerando… (lendo o ClickUp)';
    api('relatorioRascunho', p.id).then(function (resp) {
      estado.editor = { processoId: p.id, token: resp.token, relatorio: resp.relatorio, avisos: resp.avisos || (resp.relatorio && resp.relatorio.avisos) || [],
        status: 'rascunho', url: '', sujo: false, modo: 'textos' };
      delete estado.relatorios[p.id];
      avisar('Rascunho gerado. Revise os textos antes de publicar.', 'ok');
      irParaProcessos('editor', p.id);
    }).catch(function (e) {
      falhou(e);
      btn.disabled = false;
      btn.textContent = 'Gerar rascunho do relatório';
    });
  }

  // Abre um relatório da lista no editor. O conteúdo vem de "relatorio.salvar" sem mudanças
  // (devolve o relatório como está, rascunho ou publicado).
  function abrirRelatorio(p, r) {
    if (estado.editor && estado.editor.token === r.token) { irParaProcessos('editor', p.id); return; }
    api('relatorioSalvar', r.token, { textos: {} }).then(function (resp) {
      if (!resp.relatorio) throw new Error('Relatório não encontrado.');
      estado.editor = { processoId: p.id, token: r.token, relatorio: resp.relatorio, avisos: [], status: r.status,
        url: r.status === 'publicado' ? linkRelatorio(root.location.href, r.token) : '', sujo: false, modo: 'textos' };
      irParaProcessos('editor', p.id);
    }).catch(falhou);
  }

  function blocoRelatorios(p) {
    var sec = el('section', { classe: 'caixa proc-relatorios', id: 'proc-relatorios' }, [el('h3', { classe: 'caixa__titulo', texto: 'Relatórios deste processo' })]);
    var lista = estado.relatorios[p.id];
    if (!lista) {
      sec.appendChild(el('p', { classe: 'texto-suave t-rotulo', texto: 'Carregando…' }));
      api('relatoriosListar', p.id).then(function (resp) {
        estado.relatorios[p.id] = resp.relatorios || [];
        if (estado.proc.tela === 'pagina' && estado.proc.id === p.id) {
          var velho = $('proc-relatorios');
          if (velho) velho.parentNode.replaceChild(blocoRelatorios(p), velho);
        }
      }).catch(falhou);
      return sec;
    }
    if (!lista.length) {
      sec.appendChild(el('p', { classe: 'texto-suave t-corpo', texto: 'Nenhum relatório ainda. Use "Gerar rascunho do relatório".' }));
      return sec;
    }
    sec.appendChild(el('ul', { classe: 'lista-simples', id: 'lista-relatorios' }, lista.map(function (r) {
      var pub = r.status === 'publicado';
      var url = linkRelatorio(root.location.href, r.token);
      return el('li', { classe: 'rel-linha', 'data-token': r.token, 'data-status': pub ? 'publicado' : 'rascunho' }, [
        el('div', { classe: 'rel-linha__texto' }, [
          el('span', { classe: 'selo ' + (pub ? 'selo--verde' : ''), texto: pub ? 'Publicado' : 'Rascunho' }),
          el('span', { classe: 'texto-suave t-rotulo tabular', texto: 'Gerado em ' + formatarData(r.criadoEm) + (pub && r.publicadoEm ? ' · publicado em ' + formatarData(r.publicadoEm) : '') })
        ]),
        el('div', { classe: 'gestao-card__acoes' }, [
          botao('botao--claro botao--pequeno', 'Abrir no editor', function () { abrirRelatorio(p, r); }, { 'data-acao': 'abrir-relatorio' }),
          pub ? botao('botao--claro botao--pequeno', 'Copiar link', function () { copiar(url, 'Link do relatório copiado.'); }, { 'data-acao': 'copiar-link-relatorio' }) : null,
          pub ? el('a', { classe: 'botao botao--claro botao--pequeno', href: url, target: '_blank', rel: 'noopener', texto: 'Ver publicado' }) : null
        ])
      ]);
    })));
    return sec;
  }

  function renderizarPaginaProcesso(box, p) {
    var n = Number(p.respostas) || 0;
    var link = linkDe(p);
    var cfg = p.config || configPadrao();
    var btnGerar = botao('botao--laranja', 'Gerar rascunho do relatório', function () { gerarRascunho(p, btnGerar); }, { id: 'btn-gerar-rascunho' });
    box.appendChild(cabecalhoVista('Processo seletivo · código ' + p.codigo, p.nome, textoLocal(p) || null, [
      botao('botao--claro', '← Processos', function () { irParaProcessos('lista'); }),
      botao('botao--claro', 'Editar', function () { irParaProcessos('form', p.id); }, { id: 'btn-editar-processo' }),
      botao('botao--claro', 'Ver participantes', function () { verParticipantes(p); }, { id: 'btn-ver-participantes' }),
      btnGerar
    ]));
    if (!p.clickupListId) {
      box.appendChild(el('p', { classe: 'aviso proc-aviso', texto: 'Este processo ainda não está ligado a uma lista do ClickUp. Edite o processo para escolher a lista: o relatório lê os candidatos de lá.' }));
    }

    var dados = el('section', { classe: 'caixa' }, [
      el('h3', { classe: 'caixa__titulo', texto: 'Dados' }),
      el('dl', { classe: 'det-dl' }, [
        dlItem('Empresa', empresaDe(p)), dlItem('Vaga', p.vaga), dlItem('Cidade', p.cidade),
        dlItem('Período', textoPeriodo(p.periodo)), dlItem('Consultor', p.consultor), dlItem('Recebe o relatório', p.contratante),
        dlItem('Lista do ClickUp', p.clickupListId, 'proc-lista-ligada'),
        dlItem('Respostas do teste DISC', String(n), 'proc-respostas'),
        dlItem('Situação', p.ativa ? 'Ativo (link aceita respostas)' : 'Desativado', null, true),
        dlItem('Ao terminar o teste', p.mostrarResultado ? 'O participante vê o relatório DISC completo dele (sem vaga nem função)' : 'O participante não vê o resultado', 'proc-mostra-resultado', true)
      ])
    ]);
    var formBox = el('section', { classe: 'caixa proc-formulario', id: 'proc-formulario' }, [
      el('h3', { classe: 'caixa__titulo', texto: 'O que o candidato responde' }),
      el('ul', { classe: 'lista-simples proc-formulario__lista' }, resumoFormulario(cfg.formulario).filter(function (it) { return it.modo !== 'oculto'; }).map(function (it) {
        return el('li', { 'data-modo': it.modo }, [
          el('span', { classe: 'proc-etapas-resumo__nome', texto: (it.extra ? 'Pergunta: ' : '') + it.rotulo }),
          el('span', { classe: 'selo' + (it.modo === 'opcional' ? '' : ' selo--noite'), texto: it.texto })
        ]);
      })),
      (function () {
        var fora = resumoFormulario(cfg.formulario).filter(function (it) { return it.modo === 'oculto'; }).map(function (it) { return it.rotulo; });
        return fora.length ? el('p', { classe: 'texto-suave t-rotulo proc-formulario__fora', texto: 'Não perguntamos: ' + fora.join(', ') + '.' }) : null;
      })(),
      (function () {
        var p2 = normalizarFormulario(cfg.formulario).parte2;
        return el('div', { classe: 'proc-parte2', id: 'proc-parte2-resumo', 'data-parte2': p2 }, [
          el('p', { classe: 'proc-parte2__topo' }, [
            el('span', { classe: 'proc-etapas-resumo__nome', texto: 'Segunda parte do teste' }),
            el('span', { classe: 'selo' + (p2 === 'ligada' ? ' selo--noite' : ''), texto: PARTE2[p2] })
          ]),
          el('p', { classe: 'texto-suave t-rotulo', texto: textoParte2(p2) })
        ]);
      })()
    ]);
    var linkBox = el('section', { classe: 'caixa' }, [
      el('h3', { classe: 'caixa__titulo', texto: 'Link do teste DISC' }),
      el('p', { classe: 'av-link', id: 'proc-link', texto: link }),
      el('div', { classe: 'gestao-card__acoes proc-link-acoes' }, [
        botao('botao--claro botao--pequeno', 'Copiar link', function () { copiar(link, 'Link copiado.'); }, { 'data-acao': 'copiar-link' }),
        botao('botao--claro botao--pequeno', 'Copiar mensagem', function () { copiar(mensagemConvite(p, link), 'Mensagem copiada. Cole no WhatsApp.'); }, { 'data-acao': 'copiar-mensagem' })
      ])
    ]);
    var pct = pesosNormalizados(cfg.etapas);
    var configBox = el('section', { classe: 'caixa proc-config' }, [
      el('h3', { classe: 'caixa__titulo', texto: 'Como o relatório pontua' }),
      el('p', { classe: 'perfil-resumo' }, [
        el('span', { classe: 'texto-suave', texto: 'Perfil DISC ideal: ' }),
        cfg.perfilIdeal ? el('span', { classe: 'badge disc-' + cfg.perfilIdeal.charAt(0), id: 'proc-perfil', texto: cfg.perfilIdeal }) : el('span', { id: 'proc-perfil', texto: 'não definido' })
      ]),
      cfg.perfilIdeal ? el('p', { classe: 'perfil-explicacao', texto: explicarPerfil(cfg.perfilIdeal) }) : null,
      el('h4', { classe: 'conf-subtitulo', texto: 'Etapas' }),
      cfg.etapas && cfg.etapas.length ? el('ul', { classe: 'lista-simples proc-etapas-resumo' }, cfg.etapas.map(function (e, i) {
        return el('li', null, [
          el('span', { classe: 'proc-etapas-resumo__nome', texto: e.nome }),
          el('span', { classe: 'texto-suave t-rotulo tabular', texto: 'peso ' + String(e.peso).replace('.', ',') + ' · ' + String(pct[i]).replace('.', ',') + '%' })
        ]);
      })) : el('p', { classe: 'texto-suave t-rotulo', texto: 'Nenhuma etapa configurada.' }),
      cfg.bonus && cfg.bonus.length ? el('h4', { classe: 'conf-subtitulo', texto: 'Bônus' }) : null,
      cfg.bonus && cfg.bonus.length ? el('ul', { classe: 'lista-simples' }, cfg.bonus.map(function (b) {
        var r = b.regra || {};
        var txt = r.tipo === 'mapa' ? Object.keys(r.pontos || {}).map(function (k) { return k + ' → ' + r.pontos[k]; }).join(' · ') : '+' + r.pontos + ' se marcado';
        return el('li', null, [el('span', { classe: 'proc-etapas-resumo__nome', texto: b.nome }), el('span', { classe: 'texto-suave t-rotulo tabular', texto: txt })]);
      })) : null,
      el('p', { classe: 'texto-medio t-rotulo proc-corte', texto: 'Corte: ' + cfg.corte + ' pontos · faixa "avaliar" a partir de ' + cfg.faixaAvaliar + '.' })
    ]);
    box.appendChild(el('div', { classe: 'proc-grade' }, [
      el('div', { classe: 'det-lado' }, [dados, linkBox, formBox]),
      el('div', { classe: 'det-lado' }, [configBox, blocoRelatorios(p)])
    ]));
  }

  /* ----- Editor do relatório ----- */

  function documentoPrevia(rel) {
    var VIEW = root.DISC_RELATORIO_VIEW;
    var corpo = VIEW && typeof VIEW.montarHtml === 'function' ? VIEW.montarHtml(rel) : '<p>Pré-visualização indisponível (relatorio-view.js não carregado).</p>';
    return '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<link rel="stylesheet" href="assets/notus.css"><link rel="stylesheet" href="assets/relatorio.css"></head>' +
      '<body class="corpo-doc"><main id="relatorio" class="relatorio" data-estado="pronto">' + corpo + '</main></body></html>';
  }

  function idTexto(id) { return 'texto-' + String(id).replace(/[^A-Za-z0-9_-]/g, '_'); }

  function salvarEditor(ed) {
    return api('relatorioSalvar', ed.token, ed.relatorio).then(function (resp) {
      if (resp.relatorio) ed.relatorio = resp.relatorio;
      ed.sujo = false;
      return resp;
    });
  }

  function renderizarEditor(box, p) {
    var ed = estado.editor;
    var rel = ed.relatorio || {};
    var publicado = ed.status === 'publicado';

    var acoes = [botao('botao--claro', '← Processo', function () { irParaProcessos('pagina', p.id); }, { id: 'btn-voltar-processo' })];
    if (estado.clickup.iaConfigurada) {
      var btnIa = botao('botao--contorno', 'Melhorar textos com IA', function () {
        btnIa.disabled = true; btnIa.textContent = 'Melhorando…';
        (ed.sujo ? salvarEditor(ed) : Promise.resolve()).then(function () {
          return api('relatorioMelhorarTextos', ed.token);
        }).then(function (resp) {
          if (resp.relatorio) ed.relatorio = resp.relatorio;
          avisar(resp.alterados != null ? resp.alterados + ' texto(s) reescrito(s) pela IA. Revise antes de publicar.' : 'Textos melhorados. Revise antes de publicar.', 'ok');
          renderizarProcessos();
        }).catch(function (e) { falhou(e); btnIa.disabled = false; btnIa.textContent = 'Melhorar textos com IA'; });
      }, { id: 'btn-melhorar-ia' });
      acoes.push(btnIa);
    }
    var btnSalvar = botao('botao--principal', publicado ? 'Salvar alterações' : 'Salvar rascunho', function () {
      btnSalvar.disabled = true;
      salvarEditor(ed).then(function () {
        avisar(publicado ? 'Alterações salvas: o link publicado já mostra a versão nova.' : 'Rascunho salvo.', 'ok');
        renderizarProcessos();
      }).catch(falhou).then(function () { btnSalvar.disabled = false; });
    }, { id: 'btn-salvar-rascunho' });
    acoes.push(btnSalvar);
    if (!publicado) {
      var btnPub = botao('botao--laranja', 'Publicar', function () {
        btnPub.disabled = true;
        (ed.sujo ? salvarEditor(ed) : Promise.resolve()).then(function () {
          return api('relatorioPublicar', ed.token, root.location.href);
        }).then(function (resp) {
          ed.status = 'publicado';
          ed.url = urlAbsoluta(resp.url || linkRelatorio(root.location.href, ed.token), root.location.href);
          delete estado.relatorios[p.id];
          avisar(resp.aviso || 'Relatório publicado. Copie o link e envie ao contratante.', resp.aviso ? '' : 'ok');
          renderizarProcessos();
        }).catch(function (e) { falhou(e); btnPub.disabled = false; });
      }, { id: 'btn-publicar' });
      acoes.push(btnPub);
    } else {
      acoes.push(botao('botao--perigo', 'Despublicar', function () {
        confirmar({ titulo: 'Tirar o relatório do ar?', texto: 'O link para de abrir na hora. Dá para publicar de novo depois, com o mesmo link.', botao: 'Despublicar' }).then(function (ok) {
          if (!ok) return;
          api('relatorioDespublicar', ed.token).then(function () {
            ed.status = 'rascunho';
            delete estado.relatorios[p.id];
            avisar('Relatório despublicado: o link não abre mais.', 'ok');
            renderizarProcessos();
          }).catch(falhou);
        });
      }, { id: 'btn-despublicar' }));
    }
    box.appendChild(cabecalhoVista('Relatório · ' + p.nome, publicado ? 'Relatório publicado' : 'Rascunho do relatório',
      'Revise cada texto. O que você mudar fica marcado como "Editado". Números e tabelas vêm do ClickUp e do DISC.', acoes));

    if (publicado && ed.url) {
      var msg = mensagemRelatorio(p, ed.url);
      box.appendChild(el('section', { classe: 'caixa caixa--destaque rel-publicado', id: 'rel-publicado' }, [
        el('h3', { classe: 'caixa__titulo', texto: 'Link para o contratante' }),
        el('p', { classe: 'av-link', id: 'rel-link', texto: ed.url }),
        el('p', { classe: 'rel-mensagem', id: 'rel-mensagem', texto: msg }),
        el('div', { classe: 'gestao-card__acoes' }, [
          botao('botao--principal botao--pequeno', 'Copiar link', function () { copiar(ed.url, 'Link do relatório copiado.'); }, { id: 'btn-copiar-link-relatorio' }),
          botao('botao--claro botao--pequeno', 'Copiar mensagem para WhatsApp', function () { copiar(msg, 'Mensagem copiada. Cole no WhatsApp do contratante.'); }, { id: 'btn-copiar-msg-relatorio' }),
          el('a', { classe: 'botao botao--claro botao--pequeno', id: 'link-abrir-relatorio', href: ed.url, target: '_blank', rel: 'noopener', texto: 'Abrir relatório' })
        ])
      ]));
    }

    var avisos = Array.isArray(ed.avisos) ? ed.avisos : [];
    if (avisos.length) {
      box.appendChild(el('div', { classe: 'aviso editor-avisos', id: 'editor-avisos', role: 'note' }, [
        el('p', { classe: 'seminegrito', texto: 'Avisos da leitura do ClickUp' }),
        el('ul', { classe: 'editor-avisos__lista' }, avisos.map(function (a) { return el('li', { texto: String(a) }); }))
      ]));
    }

    // Alternância: textos editáveis ou documento como o contratante vê
    var modo = ed.modo === 'previa' ? 'previa' : 'textos';
    function alternar(m) { ed.modo = m; renderizarProcessos(); }
    box.appendChild(el('div', { classe: 'segmento', role: 'group', 'aria-label': 'Modo do editor' }, [
      el('button', { type: 'button', classe: 'segmento__botao', id: 'btn-ver-textos', 'aria-pressed': modo === 'textos' ? 'true' : 'false', texto: 'Editar textos', onclick: function () { alternar('textos'); } }),
      el('button', { type: 'button', classe: 'segmento__botao', id: 'btn-ver-previa', 'aria-pressed': modo === 'previa' ? 'true' : 'false', texto: 'Pré-visualização', title: 'Ver como o contratante vê', onclick: function () { alternar('previa'); } })
    ]));

    if (modo === 'previa') {
      var frame = el('iframe', { classe: 'previa-doc', id: 'editor-previa', title: 'Pré-visualização do relatório', sandbox: 'allow-same-origin', loading: 'eager' });
      frame.addEventListener('load', function () {
        try {
          var d = frame.contentDocument;
          if (d && d.documentElement) frame.style.height = Math.max(600, d.documentElement.scrollHeight) + 'px';
        } catch (e) { /* mantém a altura padrão */ }
      });
      frame.srcdoc = documentoPrevia(rel);
      box.appendChild(el('div', { classe: 'caixa caixa--compacta previa-moldura' }, frame));
      return;
    }

    // Textos agrupados por seção, na ordem do documento
    var lista = textosEditaveis(rel);
    var grupos = [];
    lista.forEach(function (t) {
      var g = grupos.length && grupos[grupos.length - 1].secao === t.secao ? grupos[grupos.length - 1] : null;
      if (!g) { g = { secao: t.secao, itens: [] }; grupos.push(g); }
      g.itens.push(t);
    });
    var area = el('div', { classe: 'editor-textos', id: 'editor-textos' });
    grupos.forEach(function (g) {
      area.appendChild(el('section', { classe: 'caixa editor-secao' }, [
        el('h3', { classe: 'caixa__titulo', texto: g.secao }),
        el('div', { classe: 'editor-secao__itens' }, g.itens.map(function (t) {
          var info = rel.textos[t.id] || {};
          var origem = ORIGENS[info.origem] ? info.origem : 'regra';
          var selo = el('span', { classe: 'selo texto-origem', 'data-origem': origem, texto: ORIGENS[origem] });
          var txt = String(info.texto || '');
          var ta = el('textarea', { id: idTexto(t.id), classe: 'entrada texto-campo', 'data-texto-id': t.id, maxlength: 4000,
            rows: Math.min(10, Math.max(2, Math.ceil(txt.length / 70) + 1)) });
          ta.value = txt;
          ta.addEventListener('input', function () {
            if (editarTexto(rel, t.id, ta.value)) {
              ed.sujo = true;
              selo.textContent = ORIGENS.editado;
              selo.setAttribute('data-origem', 'editado');
            }
          });
          return el('div', { classe: 'texto-item', 'data-texto-id': t.id }, [
            el('div', { classe: 'texto-item__topo' }, [
              el('label', { classe: 'texto-item__rotulo', for: idTexto(t.id), texto: t.rotulo }),
              selo
            ]),
            ta
          ]);
        }))
      ]));
    });
    if (!grupos.length) area.appendChild(el('div', { classe: 'caixa vazio' }, el('p', { classe: 'vazio__texto', texto: 'Este relatório não tem textos para editar.' })));
    box.appendChild(area);
  }

  /* ---------- Seletor em pílula com busca (um ou vários; sem <select> nativo) ---------- */

  // cfg: { id, rotulo, rotuloId?, opcoes: [{valor, rotulo, sub?}], multiplo?, valor? (um), valores? (vários),
  //        vazio? (rótulo da opção "nenhum", só no modo de um), placeholder?, textoBotao? (vários) }
  // -> { caixa, valor(), valores(), definir(v), aoMudar(fn) }
  var buscas = [];
  function criarSeletorBusca(cfg) {
    var id = cfg.id;
    var multiplo = !!cfg.multiplo;
    var opcoes = (cfg.opcoes || []).slice();
    if (!multiplo && cfg.vazio) opcoes.unshift({ valor: '', rotulo: cfg.vazio });
    var sel = multiplo ? (cfg.valores || []).map(String) : [cfg.valor == null ? '' : String(cfg.valor)];
    var ouvintes = [];
    var aberto = false;
    var porValor = {};
    opcoes.forEach(function (o) { porValor[String(o.valor)] = o; });

    var texto = el('span', { classe: 'escolha__texto', id: id + '-texto' });
    var botao = el('button', {
      type: 'button', id: id, classe: 'escolha__botao busca-sel__botao', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-controls': id + '-painel',
      'aria-labelledby': cfg.rotuloId ? cfg.rotuloId + ' ' + id + '-texto' : null, 'aria-label': cfg.rotuloId ? null : cfg.rotulo
    }, [texto, icone(multiplo ? 'M12 5v14M5 12h14' : ICONE_SETA, 'escolha__seta')]);
    var busca = el('input', { id: id + '-busca', classe: 'entrada busca-sel__entrada', type: 'search', autocomplete: 'off',
      placeholder: cfg.placeholder || 'Buscar pelo nome…', 'aria-label': 'Buscar em ' + cfg.rotulo, 'aria-controls': id + '-lista' });
    var lista = el('ul', { role: 'listbox', id: id + '-lista', classe: 'busca-sel__lista', 'aria-label': cfg.rotulo, 'aria-multiselectable': multiplo ? 'true' : null });
    var nada = el('p', { classe: 'busca-sel__nada', texto: 'Nada encontrado.', hidden: true });
    var pronto = multiplo ? el('button', { type: 'button', id: id + '-pronto', classe: 'botao botao--claro botao--pequeno busca-sel__pronto', texto: 'Pronto', onclick: function () { fechar(true); } }) : null;
    var painel = el('div', { id: id + '-painel', classe: 'busca-sel__painel vidro-janela', hidden: true }, [busca, lista, nada, pronto]);
    var fichas = multiplo ? el('ul', { classe: 'busca-sel__fichas', id: id + '-fichas', 'aria-label': cfg.rotulo + ': escolhidos' }) : null;
    var caixa = el('div', { classe: 'escolha busca-sel' + (multiplo ? ' busca-sel--multi' : '') + ' escolha--larga', id: id + '-caixa' }, [fichas, botao, painel]);

    function avisarMudanca() {
      botao.dispatchEvent(new Event('change', { bubbles: true }));
      ouvintes.forEach(function (fn) { fn(); });
    }
    function desenharTopo() {
      botao.value = multiplo ? sel.join(',') : sel[0];
      if (multiplo) {
        texto.textContent = cfg.textoBotao || 'Adicionar';
        limpar(fichas);
        sel.forEach(function (v) {
          var o = porValor[v];
          if (!o) return;
          fichas.appendChild(el('li', { classe: 'ficha', 'data-valor': v }, [
            el('span', { classe: 'ficha__texto', texto: o.rotulo }),
            el('button', { type: 'button', classe: 'ficha__remover', 'aria-label': 'Remover ' + o.rotulo, 'data-valor': v, onclick: function () {
              sel = sel.filter(function (x) { return x !== v; }); desenharTopo(); desenharLista(); avisarMudanca();
            } }, icone('M18 6 6 18M6 6l12 12'))
          ]));
        });
      } else {
        var o2 = porValor[sel[0]];
        texto.textContent = o2 ? o2.rotulo : (cfg.vazio || 'Escolher');
      }
    }
    function desenharLista() {
      limpar(lista);
      var achadas = filtrarOpcoes(opcoes, busca.value);
      achadas.forEach(function (o, i) {
        var v = String(o.valor);
        lista.appendChild(el('li', { role: 'option', id: id + '-op-' + i, 'data-valor': v, tabindex: '-1', classe: 'escolha__opcao busca-sel__opcao',
          'aria-selected': sel.indexOf(v) !== -1 ? 'true' : 'false' }, [
          el('span', { classe: 'busca-sel__rotulo' }, [el('span', { texto: o.rotulo }), o.sub ? el('span', { classe: 'busca-sel__sub', texto: o.sub }) : null]),
          icone(ICONE_CHECK, 'escolha__check')
        ]));
      });
      nada.hidden = achadas.length > 0;
    }
    function abrir() {
      escolhas.forEach(function (e) { e.fechar(false); });
      buscas.forEach(function (b) { if (b !== api3) b.fechar(false); });
      aberto = true;
      busca.value = '';
      desenharLista();
      painel.hidden = false;
      botao.setAttribute('aria-expanded', 'true');
      busca.focus();
    }
    function fechar(devolverFoco) {
      if (!aberto) return;
      aberto = false;
      painel.hidden = true;
      botao.setAttribute('aria-expanded', 'false');
      if (devolverFoco) botao.focus();
    }
    function escolher(li) {
      var v = li.getAttribute('data-valor');
      if (multiplo) {
        if (sel.indexOf(v) === -1) sel.push(v); else sel = sel.filter(function (x) { return x !== v; });
        desenharTopo();
        li.setAttribute('aria-selected', sel.indexOf(v) !== -1 ? 'true' : 'false');
        avisarMudanca();
        return;
      }
      var mudou = v !== sel[0];
      sel = [v];
      desenharTopo();
      fechar(true);
      if (mudou) avisarMudanca();
    }
    function itens() { return Array.prototype.slice.call(lista.querySelectorAll('[role="option"]')); }
    botao.addEventListener('click', function () { if (aberto) fechar(false); else abrir(); });
    botao.addEventListener('keydown', function (e) { if (e.key === 'ArrowDown') { e.preventDefault(); abrir(); } });
    busca.addEventListener('input', desenharLista);
    busca.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); var p = itens()[0]; if (p) p.focus(); }
      else if (e.key === 'Enter') { e.preventDefault(); var u = itens(); if (u.length === 1) escolher(u[0]); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fechar(true); }
    });
    lista.addEventListener('click', function (e) {
      var li = e.target.closest ? e.target.closest('[role="option"]') : null;
      if (li) escolher(li);
    });
    lista.addEventListener('keydown', function (e) {
      var todos = itens(), i = todos.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); if (todos[i + 1]) todos[i + 1].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (i <= 0) busca.focus(); else todos[i - 1].focus(); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (i !== -1) escolher(todos[i]); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fechar(true); }
      else if (e.key === 'Tab') fechar(false);
    });
    var api3 = {
      caixa: caixa, botao: botao, fechar: fechar,
      valor: function () { return sel[0] || ''; },
      valores: function () { return sel.slice(); },
      definir: function (v) { sel = multiplo ? (v || []).map(String) : [v == null ? '' : String(v)]; desenharTopo(); },
      aoMudar: function (fn) { ouvintes.push(fn); }
    };
    buscas = buscas.filter(function (b) { return b.botao.id !== id && document.body.contains(b.caixa); });
    buscas.push(api3);
    desenharTopo();
    return api3;
  }
  document.addEventListener('mousedown', function (e) {
    buscas.forEach(function (x) { if (!x.caixa.contains(e.target)) x.fechar(false); });
  });

  /* ---------- Empresas: cadastro, colaboradores, ligações, organograma e relatórios ---------- */

  function empresasOk() { return modoEmpresas(MODO_API, SUPABASE, SIMULADA) === 'ok'; }
  function novoEstadoEmpresas() {
    return { tela: 'lista', id: null, subaba: 'colaboradores', lista: null, erro: '', busca: '', equipes: {}, relatorios: {}, rel: null, indice: null };
  }
  function acharEmpresa(id) {
    var l = estado.emp.lista || [];
    for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
    return null;
  }
  function nomeEmpresa(id) { var e = acharEmpresa(id); return e ? e.nome : ''; }
  function consultorAtual() { return estado.usuario ? String(estado.usuario.nome || '') : ''; }

  function carregarEmpresas() {
    if (!empresasOk()) return Promise.resolve();
    return api('listarEmpresas').then(function (resp) {
      estado.emp.lista = resp.empresas || [];
      estado.emp.erro = '';
    }).catch(function (e) {
      if (e && e.tratado) return; // sessão expirada: já voltou ao login
      estado.emp.lista = estado.emp.lista || [];
      estado.emp.erro = (e && e.message) || 'Não foi possível carregar as empresas.';
    }).then(function () {
      renderizarEmpresas();
    });
  }

  // Equipe de uma empresa (cache por empresa; mudou algo -> esquecer e carregar de novo).
  function carregarEquipe(id) {
    return api('listarEquipe', id).then(function (resp) {
      estado.emp.equipes[id] = { empresa: resp.empresa || acharEmpresa(id) || {}, colaboradores: resp.colaboradores || [], relacoes: resp.relacoes || [], historico: resp.historico || [],
        topoIds: Array.isArray(resp.topoIds) ? resp.topoIds.map(String) : [] };
      return estado.emp.equipes[id];
    });
  }
  function esquecerEquipes() { estado.emp.equipes = {}; estado.emp.indice = null; }

  function irParaEmpresas(tela, id, subaba) {
    if (tela === 'pagina' && (String(id) !== String(estado.emp.id) || subaba)) estado.emp.subaba = subaba || 'colaboradores';
    estado.emp.tela = tela || 'lista';
    estado.emp.id = id || null;
    renderizarEmpresas();
    mostrarAba('empresas');
    root.scrollTo(0, 0);
    var h = $('vista-empresas').querySelector('h2');
    if (h) { h.setAttribute('tabindex', '-1'); h.focus(); }
  }

  function renderizarEmpresas() {
    var box = $('vista-empresas');
    if (!box) return;
    destruirOrganograma();
    limpar(box);
    if (papel() !== 'admin') return;
    if (!empresasOk()) {
      box.appendChild(cabecalhoVista('Cadastro', 'Empresas', null));
      box.appendChild(el('div', { classe: 'caixa vazio', id: 'empresas-indisponivel' }, [
        el('p', { classe: 'vazio__texto seminegrito', texto: 'Disponível com o servidor Supabase.' }),
        el('p', { classe: 'vazio__texto t-rotulo', texto: 'Empresas, colaboradores, organograma e relatórios da equipe não existem na planilha do Google. Ligue o painel ao Supabase para usar esta aba.' })
      ]));
      return;
    }
    var t = estado.emp.tela;
    if (t === 'relatorio' && estado.emp.rel) return renderizarRelatorioModelo(box, estado.emp.rel);
    if (t === 'pagina' && estado.emp.id) return renderizarPaginaEmpresa(box, estado.emp.id);
    estado.emp.tela = 'lista';
    renderizarListaEmpresas(box);
  }

  function renderizarListaEmpresas(box) {
    box.appendChild(cabecalhoVista('Cadastro', 'Empresas',
      'Clientes atendidos, com os colaboradores, o organograma, a compatibilidade da equipe e os relatórios.',
      [botao('botao--principal', 'Nova empresa', function () { janelaEmpresa(null); }, { id: 'btn-nova-empresa' })]));
    if (estado.emp.erro) box.appendChild(el('p', { classe: 'aviso aviso--erro proc-aviso', id: 'empresas-erro', texto: estado.emp.erro }));
    if (estado.emp.lista === null) {
      box.appendChild(el('p', { classe: 'texto-suave t-corpo', texto: 'Carregando…' }));
      carregarEmpresas();
      return;
    }
    var entrada = el('input', { id: 'busca-empresas', classe: 'entrada', type: 'search', placeholder: 'Nome ou cidade da empresa…', autocomplete: 'off' });
    entrada.value = estado.emp.busca;
    box.appendChild(el('form', { classe: 'filtros', role: 'search', onsubmit: function (e) { e.preventDefault(); } }, [
      el('label', { classe: 'filtros__busca' }, [
        el('span', { classe: 'visualmente-oculto', texto: 'Buscar empresa' }),
        (function () { var s = svg('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', class: 'filtros__lupa' }); s.appendChild(svg('circle', { cx: 11, cy: 11, r: 7 })); s.appendChild(svg('path', { d: 'm20 20-3.5-3.5' })); return s; })(),
        entrada
      ])
    ]));
    var ul = el('ul', { classe: 'gestao-lista', id: 'lista-empresas' });
    box.appendChild(ul);
    function desenhar() {
      limpar(ul);
      var itens = filtrarEmpresas(estado.emp.lista, estado.emp.busca);
      if (!estado.emp.lista.length || !itens.length) {
        ul.appendChild(el('li', { classe: 'caixa vazio' }, el('p', { classe: 'vazio__texto', texto: estado.emp.lista.length ? 'Nenhuma empresa encontrada.' : 'Nenhuma empresa cadastrada ainda. Use "Nova empresa".' })));
        return;
      }
      itens.forEach(function (e) {
        var n = Number(e.colaboradores) || 0;
        var abrir = function () { irParaEmpresas('pagina', e.id); };
        ul.appendChild(el('li', { classe: 'caixa gestao-card emp-card' + (e.ativo === false ? ' gestao-linha--antigo' : ''), 'data-id': e.id, 'data-nome': e.nome }, [
          el('div', { classe: 'gestao-card__topo' }, [
            el('div', { classe: 'gestao-card__titulo-area' }, [
              el('h3', { classe: 'gestao-card__titulo seminegrito' }, el('button', { type: 'button', classe: 'link-botao proc-card__nome', texto: e.nome, onclick: abrir })),
              el('p', { classe: 'gestao-card__sub', texto: [e.cidade || '', ''].filter(Boolean).join(' · ') || 'Cidade não informada' })
            ]),
            el('span', { classe: 'protocolo', title: 'Colaboradores ativos' }, [
              el('span', { classe: 'protocolo__rotulo', texto: 'Colaboradores' }),
              el('span', { classe: 'protocolo__valor t-titulo negrito tabular emp-contador', texto: String(n) })
            ])
          ]),
          e.ativo === false ? el('div', { classe: 'card-selos' }, el('span', { classe: 'selo emp-arquivada', texto: 'Arquivada' })) : null,
          el('div', { classe: 'gestao-card__acoes' }, [
            botao('botao--principal botao--pequeno', 'Abrir', abrir, { 'data-acao': 'abrir' }),
            botao('botao--claro botao--pequeno', 'Editar', function () { janelaEmpresa(e); }, { 'data-acao': 'editar' }),
            botao('botao--claro botao--pequeno', e.ativo === false ? 'Reativar' : 'Arquivar', function () { arquivarEmpresa(e); }, { 'data-acao': 'arquivar' }),
            botao('botao--perigo botao--pequeno', 'Excluir', function () { excluirEmpresa(e); }, { 'data-acao': 'excluir' })
          ])
        ]));
      });
    }
    entrada.addEventListener('input', function () { estado.emp.busca = entrada.value; desenhar(); });
    desenhar();
  }

  function dadosEmpresa(e, extra) {
    var d = { id: e.id, nome: e.nome, cidade: e.cidade || '', observacoes: e.observacoes || '', ativo: e.ativo !== false };
    for (var k in extra || {}) d[k] = extra[k];
    return d;
  }

  function janelaEmpresa(e) {
    abrirJanela({
      id: 'janela-empresa',
      titulo: e ? 'Editar empresa' : 'Nova empresa',
      corpo: [
        campoCom('emp-nome', 'Nome da empresa', e && e.nome, { maxlength: 120 }),
        campoCom('emp-cidade', 'Cidade', e && e.cidade, { maxlength: 120, placeholder: 'Ex.: Boa Vista / RR' }),
        campoArea('emp-obs', 'Observações', e && e.observacoes, { maxlength: 2000 })
      ],
      botao: e ? 'Salvar alterações' : 'Criar empresa',
      aoConfirmar: function () {
        var nome = $('emp-nome').value.trim();
        if (!nome) throw new Error('Informe o nome da empresa.');
        var d = { nome: nome, cidade: $('emp-cidade').value.trim(), observacoes: $('emp-obs').value.trim(), ativo: e ? e.ativo !== false : true };
        if (e) d.id = e.id;
        return api('salvarEmpresa', d).then(function (resp) {
          avisar(e ? 'Empresa salva.' : 'Empresa criada.', 'ok');
          var nova = resp.empresa || {};
          return carregarEmpresas().then(function () {
            if (!e && nova.id) irParaEmpresas('pagina', nova.id);
            else renderizarEmpresas();
          });
        });
      }
    });
  }

  function arquivarEmpresa(e) {
    var arquivar = e.ativo !== false;
    api('salvarEmpresa', dadosEmpresa(e, { ativo: !arquivar })).then(function () {
      avisar(arquivar ? 'Empresa arquivada.' : 'Empresa reativada.', 'ok');
      return carregarEmpresas().then(renderizarEmpresas);
    }).catch(falhou);
  }

  function excluirEmpresa(e) {
    confirmar({ titulo: 'Excluir a empresa?', texto: '"' + e.nome + '" sai do cadastro com o histórico de colaboradores, as ligações e os relatórios dela. Não dá para desfazer.', botao: 'Excluir empresa' }).then(function (ok) {
      if (!ok) return;
      api('excluirEmpresa', e.id).then(function () {
        avisar('Empresa excluída.', 'ok');
        estado.emp.tela = 'lista'; estado.emp.id = null;
        esquecerEquipes();
        return carregarEmpresas().then(renderizarEmpresas);
      }).catch(falhou);
    });
  }

  /* ----- Página da empresa ----- */

  function processoEquipeDa(empresaId) {
    var lista = estado.processos.filter(function (p) { return p.tipo === 'equipe' && String(p.empresaId || '') === String(empresaId); });
    return lista.filter(function (p) { return p.ativa; })[0] || lista[0] || null;
  }

  function nomePorId(colabs) {
    var m = {};
    (colabs || []).forEach(function (c) { m[String(c.pessoaId)] = c.nome; });
    return m;
  }

  function textoPeriodoVinculo(c) {
    function br(d) { var x = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || '')); return x ? x[3] + '/' + x[2] + '/' + x[1] : ''; }
    var a = br(c.inicio), b = br(c.fim);
    return a && b ? a + ' a ' + b : (a ? 'desde ' + a : (b ? 'até ' + b : ''));
  }

  // Subabas da página da empresa (a escolhida fica guardada enquanto o painel está aberto).
  var SUBABAS_EMPRESA = [
    { id: 'colaboradores', rotulo: 'Colaboradores' },
    { id: 'organograma', rotulo: 'Organograma' },
    { id: 'compatibilidade', rotulo: 'Compatibilidade' },
    { id: 'relatorios', rotulo: 'Relatórios' },
    { id: 'historico', rotulo: 'Histórico' }
  ];

  function irParaSubaba(sub) {
    estado.emp.subaba = sub;
    renderizarEmpresas();
    var b = $('emp-subaba-' + sub);
    if (b) b.focus();
  }

  function renderizarPaginaEmpresa(box, id) {
    var emp = acharEmpresa(id);
    var eq = estado.emp.equipes[id];
    if (!eq) {
      box.appendChild(cabecalhoVista('Empresa', emp ? emp.nome : 'Empresa', null, [botao('botao--claro', '← Empresas', function () { irParaEmpresas('lista'); })]));
      box.appendChild(el('p', { classe: 'texto-suave t-corpo', texto: 'Carregando…' }));
      carregarEquipe(id).then(function () {
        if (estado.emp.tela === 'pagina' && estado.emp.id === id) renderizarEmpresas();
      }).catch(falhou);
      return;
    }
    emp = emp || eq.empresa || { id: id, nome: '' };
    var colabs = eq.colaboradores.filter(function (c) { return c.status !== 'desligado'; });
    var proc = processoEquipeDa(id);
    var linkTeste = proc ? linkDe(proc) : '';
    var sub = estado.emp.subaba || 'colaboradores';
    var historicoN = (eq.historico || []).length + eq.colaboradores.filter(function (c) { return c.status === 'desligado'; }).length;

    box.appendChild(cabecalhoVista('Empresa' + (emp.cidade ? ' · ' + emp.cidade : ''), emp.nome, emp.observacoes || null, [
      botao('botao--claro', '← Empresas', function () { irParaEmpresas('lista'); }, { id: 'btn-voltar-empresas' }),
      botao('botao--claro', 'Editar', function () { janelaEmpresa(emp); }, { id: 'btn-editar-empresa' }),
      botao('botao--principal', 'Adicionar colaborador', function () { janelaColaborador(emp, eq); }, { id: 'btn-add-colaborador' }),
      botao('botao--laranja', 'Gerar relatório da equipe', function () { janelaRelatorioEquipe(emp, eq); }, { id: 'btn-relatorio-equipe', disabled: colabs.length ? null : true })
    ]));
    if (emp.ativo === false) box.appendChild(el('p', { classe: 'aviso proc-aviso', texto: 'Empresa arquivada: continua no cadastro, mas fica no fim da lista.' }));

    var contagem = { colaboradores: colabs.length, historico: historicoN };
    box.appendChild(el('nav', { classe: 'subabas', id: 'emp-subabas', 'aria-label': 'Seções da empresa' }, SUBABAS_EMPRESA.map(function (s) {
      var n = contagem[s.id];
      return el('button', { type: 'button', classe: 'subaba', id: 'emp-subaba-' + s.id, 'data-subaba': s.id, 'aria-current': s.id === sub ? 'page' : null,
        onclick: function () { if (estado.emp.subaba !== s.id) irParaSubaba(s.id); } }, [
        el('span', { texto: s.rotulo }),
        n != null ? el('span', { classe: 'subaba__n tabular', texto: String(n) }) : null
      ]);
    })));

    var painel = el('div', { classe: 'emp-painel', id: 'emp-painel-' + sub, 'data-subaba': sub });
    box.appendChild(painel);
    if (sub === 'organograma') {
      var blocoOrg = blocoOrganograma(emp, eq, colabs);
      painel.appendChild(blocoOrg);
      if (blocoOrg.montar) blocoOrg.montar();
    } else if (sub === 'compatibilidade') {
      painel.appendChild(blocoCompatibilidade(compatDe(emp, colabs, eq.relacoes), colabs));
      painel.appendChild(blocoMapaEquipe(colabs));
    } else if (sub === 'relatorios') {
      painel.appendChild(el('section', { classe: 'caixa emp-bloco', id: 'emp-rel-gerar' }, [
        el('h3', { classe: 'caixa__titulo', texto: 'Gerar um relatório desta empresa' }),
        el('p', { classe: 'texto-suave t-rotulo', texto: 'Relatório da equipe (organograma, perfis e compatibilidade) aqui. Como liderar e relatório da pessoa ficam em cada colaborador, ou na aba Relatórios do painel.' }),
        el('div', { classe: 'gestao-card__acoes' }, [
          botao('botao--principal botao--pequeno', 'Relatório da equipe', function () { janelaRelatorioEquipe(emp, eq); }, { id: 'btn-emp-rel-equipe', disabled: colabs.length ? null : true }),
          botao('botao--claro botao--pequeno', 'Ver todos os modelos', function () { irParaRelatorios('modelos'); }, { id: 'btn-emp-ver-modelos' })
        ])
      ]));
      painel.appendChild(blocoRelatoriosModelo({ empresaId: id }, 'e:' + id, { empresa: emp.nome }));
    } else if (sub === 'historico') {
      painel.appendChild(blocoHistorico2(eq));
    } else {
      // Link do teste da equipe + colaboradores
      painel.appendChild(el('section', { classe: 'caixa emp-bloco', id: 'emp-link' }, proc ? [
        el('h3', { classe: 'caixa__titulo', texto: 'Link do teste da equipe' }),
        el('p', { classe: 'form-secao__texto emp-link__texto', texto: textoEquipeEmpresa(emp.nome) }),
        el('p', { classe: 'av-link', id: 'emp-link-teste', texto: linkTeste }),
        el('div', { classe: 'gestao-card__acoes' }, [
          botao('botao--claro botao--pequeno', 'Copiar link', function () { copiar(linkTeste, 'Link do teste copiado.'); }, { id: 'btn-copiar-link-equipe' }),
          botao('botao--claro botao--pequeno', 'Copiar mensagem', function () { copiar(mensagemConvite(proc, linkTeste), 'Mensagem copiada. Cole no WhatsApp.'); }, { id: 'btn-copiar-msg-equipe' }),
          botao('botao--claro botao--pequeno', 'Abrir o processo', function () { irParaProcessos('pagina', proc.id); })
        ])
      ] : [
        el('h3', { classe: 'caixa__titulo', texto: 'Link do teste da equipe' }),
        el('p', { classe: 'form-secao__texto emp-link__texto', texto: 'Ainda não há um processo de avaliação de equipe ligado a esta empresa. Crie um: ' + textoEquipeEmpresa(emp.nome) }),
        el('div', { classe: 'gestao-card__acoes' }, botao('botao--contorno botao--pequeno', 'Criar link do teste da equipe', function () {
          estado.proc = { tela: 'form', id: null, preset: { tipo: 'equipe', empresaId: id, empresa: emp.nome } };
          renderizarProcessos(); mostrarAba('processos'); root.scrollTo(0, 0);
        }, { id: 'btn-criar-link-equipe' }))
      ]));
      painel.appendChild(blocoColaboradores(emp, eq, colabs, id, proc, linkTeste));
    }
  }

  function blocoColaboradores(emp, eq, colabs, id, proc, linkTeste) {
    var nomes = nomePorId(colabs);
    var secColab = el('section', { classe: 'emp-colaboradores', id: 'emp-colaboradores' }, [
      el('h3', { classe: 'emp-secao__titulo seminegrito', texto: 'Colaboradores ativos (' + colabs.length + ')' })
    ]);
    if (!colabs.length) {
      secColab.appendChild(el('div', { classe: 'caixa vazio' }, el('p', { classe: 'vazio__texto', texto: 'Nenhum colaborador ainda. Adicione pelo nome e WhatsApp ou envie o link do teste da equipe.' })));
    } else {
      secColab.appendChild(el('ul', { classe: 'gestao-lista', id: 'lista-colaboradores' }, colabs.map(function (c) {
        var lig = ligacoesDe(eq.relacoes, c.pessoaId);
        var res = c.resultado && c.resultado.percentuais ? c.resultado : null;
        var primario = res && res.codigo ? String(res.codigo).charAt(0) : '';
        var partes = [];
        partes.push('Líder: ' + (lig.lider && nomes[lig.lider] ? nomes[lig.lider] : '—'));
        if (lig.liderados.length) partes.push('lidera ' + lig.liderados.length);
        if (lig.diretos.length) partes.push(lig.diretos.length + ' direto' + (lig.diretos.length === 1 ? '' : 's'));
        if (lig.indiretos.length) partes.push(lig.indiretos.length + ' indireto' + (lig.indiretos.length === 1 ? '' : 's'));
        return el('li', { classe: 'caixa gestao-card colab-card', 'data-pessoa': c.pessoaId, 'data-vinculo': c.vinculoId, 'data-nome': c.nome }, [
          el('div', { classe: 'card-topo' }, [
            avatar(c.nome, c.foto, { letra: primario, classe: 'card-avatar' }),
            el('div', { classe: 'colab-card__nome-area' }, [
              el('p', { classe: 'colab-card__nome seminegrito', texto: c.nome }),
              el('p', { classe: 'gestao-card__sub colab-card__cargo', texto: [c.cargo, c.area].filter(Boolean).join(' · ') || 'Cargo não informado' })
            ]),
            res ? el('span', { classe: 'badge disc-' + primario + ' colab-card__codigo', texto: res.codigo }) : el('span', { classe: 'selo colab-sem-teste', texto: 'Sem teste' })
          ]),
          res && nomeCombinacao(res.codigo) ? el('p', { classe: 'colab-card__combinacao t-rotulo texto-medio', texto: nomeCombinacao(res.codigo) }) : null,
          res ? miniBarras(res.percentuais) : el('div', { classe: 'colab-card__sem' }, [
            el('p', { classe: 'texto-suave t-rotulo', texto: 'Ainda não fez o teste DISC.' }),
            proc ? botao('botao--contorno botao--pequeno', 'Copiar link do teste', function () { copiar(linkTeste, 'Link do teste copiado. Envie para ' + primeiroNome(c.nome) + '.'); }, { 'data-acao': 'copiar-link-teste' }) : null
          ]),
          el('p', { classe: 'colab-card__ligacoes t-rotulo texto-medio', texto: partes.join(' · ') }),
          (function () {
            var a = res && c.exigido ? esforcoDe(res, c.exigido) : null;
            return a ? el('p', { classe: 'colab-card__esforco t-rotulo' }, [seloEsforco(a), el('span', { classe: 'texto-suave tabular', texto: ' índice ' + Math.round(a.indice) + ' de 100' })]) : null;
          })(),
          el('div', { classe: 'gestao-card__acoes' }, [
            botao('botao--claro botao--pequeno', 'Ligações', function () { janelaLigacoes(emp, eq, c); }, { 'data-acao': 'ligacoes' }),
            botao('botao--claro botao--pequeno', 'Editar', function () { janelaEditarColaborador(emp, c); }, { 'data-acao': 'editar' }),
            botao('botao--claro botao--pequeno', 'Mover para outra empresa', function () { janelaMover(emp, c); }, { 'data-acao': 'mover' }),
            botao('botao--claro botao--pequeno', 'Como liderar', function () { gerarLideranca(emp, eq, c); }, { 'data-acao': 'como-liderar', disabled: res ? null : true, title: res ? null : 'Precisa do teste DISC' }),
            botao('botao--claro botao--pequeno', 'Relatório da pessoa', function () { gerarPessoa(c.pessoaId, c.nome, res, { aba: 'empresas', tela: 'pagina', id: id, subaba: 'colaboradores' }, id, c.exigido || null, c.foto); }, { 'data-acao': 'relatorio-pessoa', disabled: res ? null : true }),
            botao('botao--perigo botao--pequeno', 'Desligar', function () { desligar(emp, c); }, { 'data-acao': 'desligar' })
          ])
        ]);
      })));
    }
    return secColab;
  }

  function compatDe(emp, colabs, relacoes) {
    var CP = root.DISC_COMPATIBILIDADE;
    if (!CP || typeof CP.montar !== 'function' || !colabs.length) return null;
    try { return CP.montar(entradaCompatibilidade(emp, colabs, relacoes)); } catch (e) { return null; }
  }

  // Empresa: mapa ritmo × foco com todos os colaboradores testados e o esforço de adaptação de quem respondeu a Parte 2.
  function blocoMapaEquipe(colabs) {
    var sec = el('section', { classe: 'caixa caixa--ampla emp-bloco', id: 'emp-mapa' }, [el('h3', { classe: 'caixa__titulo', texto: 'Mapa ritmo × foco' })]);
    var pontos = pontosMapaEquipe(colabs);
    if (!pontos.length) { sec.appendChild(el('p', { classe: 'texto-suave t-rotulo', texto: 'O mapa aparece quando algum colaborador fizer o teste DISC.' })); return sec; }
    var temExigido = pontos.some(function (x) { return x.exigido; });
    sec.appendChild(el('p', { classe: 'texto-suave t-rotulo', texto: 'Ritmo: acelerado (D e I) ou cauteloso (S e C). Foco: tarefas (D e C) ou pessoas (I e S).' +
      (temExigido ? ' A seta tracejada vai do perfil natural ao exigido pelo trabalho.' : '') }));
    var mapa = mapaRitmoFoco(pontos, {}, { classe: 'mapa-painel', id: 'emp-mapa-desenho' });
    sec.appendChild(mapa || el('p', { classe: 'texto-suave t-rotulo', texto: 'Mapa indisponível (relatorio-view.js sem o mapa ritmo × foco).' }));
    var lista = esforcoEquipe(colabs);
    sec.appendChild(el('h4', { classe: 'conf-subtitulo', texto: 'Esforço de adaptação por colaborador' }));
    if (!lista.length) {
      sec.appendChild(el('p', { classe: 'texto-suave t-rotulo', id: 'emp-esforco-vazio', texto: 'Ninguém respondeu a segunda parte do teste ainda. Ligue-a no processo da equipe para ver o quanto cada um se estica no cargo.' }));
      return sec;
    }
    sec.appendChild(el('ul', { classe: 'lista-simples esforco-lista', id: 'emp-esforco' }, lista.map(function (x) {
      return el('li', { classe: 'esforco-item', 'data-pessoa': x.pessoaId, 'data-faixa': x.faixa }, [
        el('span', { classe: 'esforco-item__nome' }, [
          el('span', { classe: 'seminegrito', texto: x.nome }),
          el('span', { classe: 'texto-suave t-rotulo', texto: [x.cargo, x.maisCobrado ? 'cobra mais ' + x.maisCobrado : ''].filter(Boolean).join(' · ') })
        ]),
        el('span', { classe: 'esforco-item__valor' }, [
          el('span', { classe: 'esforco-item__trilho trilho', 'aria-hidden': 'true' }, el('span', { classe: 'esforco-item__cheia', estilo: { width: Math.min(100, x.indice * 2) + '%' } })),
          el('span', { classe: 'negrito tabular esforco-item__indice', texto: String(Math.round(x.indice)) }),
          seloEsforco(x)
        ])
      ]);
    })));
    return sec;
  }

  function blocoHistorico2(eq) {
    var hist = (eq.historico || []).concat(eq.colaboradores.filter(function (c) { return c.status === 'desligado'; }));
    return el('section', { classe: 'caixa', id: 'emp-historico' }, [
      el('h3', { classe: 'caixa__titulo', texto: 'Histórico (desligados e transferidos)' }),
      hist.length ? el('ul', { classe: 'lista-simples' }, hist.map(function (c) {
        return el('li', { classe: 'emp-hist', 'data-pessoa': c.pessoaId }, [
          el('span', { classe: 'proc-etapas-resumo__nome', texto: c.nome + (c.cargo ? ' · ' + c.cargo : '') }),
          el('span', { classe: 'texto-suave t-rotulo tabular', texto: textoPeriodoVinculo(c) || 'Desligado' })
        ]);
      })) : el('p', { classe: 'texto-suave t-rotulo', texto: 'Ninguém saiu desta empresa até agora.' })
    ]);
  }

  /* ----- Organograma (componente DISC_ORGANOGRAMA: árvore com linhas, arrastar da coluna "Sem posição") ----- */
  // Cada mudança chega em aoMudar(relacoes, mudanca); salva com salvarRelacoes(token, empresaId, relacoes, {topoIds})
  // depois de ~500 ms sem mexer e mostra "Salvando…" / "Salvo". O "Topo" fica no banco (empresas.organograma).

  var org = { inst: null, timer: null, pendente: null };

  function destruirOrganograma() {
    if (org.inst && typeof org.inst.destruir === 'function') { try { org.inst.destruir(); } catch (e) { /* ignora */ } }
    org.inst = null;
  }

  function pessoasDoOrganograma(colabs) {
    return colabs.map(function (c) {
      var res = c.resultado && c.resultado.percentuais ? c.resultado : null;
      var p = { id: String(c.pessoaId), nome: c.nome, cargo: c.cargo || '', semTeste: !res };
      if (fotoValida(c.foto)) p.foto = c.foto;
      if (res) { p.codigo = res.codigo; p.combinacao = nomeCombinacao(res.codigo) || ''; }
      return p;
    });
  }

  function blocoOrganograma(emp, eq, colabs) {
    var status = el('span', { classe: 't-rotulo texto-suave org-status', id: 'emp-org-status', 'aria-live': 'polite' });
    var aviso = el('p', { classe: 'aviso aviso--erro org-aviso', id: 'emp-org-aviso', role: 'alert', hidden: true });
    var quadro = el('div', { classe: 'org-quadro', id: 'emp-org-quadro' });
    var sec = el('section', { classe: 'caixa caixa--ampla emp-bloco emp-org', id: 'emp-organograma' }, [
      el('div', { classe: 'org-cabeca' }, [
        el('div', null, [
          el('h3', { classe: 'caixa__titulo', texto: 'Organograma' }),
          el('p', { classe: 'texto-suave t-rotulo org-dica', texto: 'Arraste uma pessoa da coluna "Sem posição" e solte sobre o líder dela. Solte na faixa "Topo" para quem não tem líder. Salva sozinho.' })
        ]),
        status
      ]),
      aviso,
      quadro
    ]);
    var O = root.DISC_ORGANOGRAMA;
    if (!O || typeof O.montar !== 'function') {
      quadro.appendChild(el('p', { classe: 'texto-suave t-rotulo', id: 'emp-org-indisponivel', texto: 'Organograma indisponível (js/organograma.js não carregou). Use "Ligações" em cada colaborador.' }));
      return sec;
    }
    if (!colabs.length) {
      quadro.appendChild(el('p', { classe: 'texto-suave t-rotulo', texto: 'Adicione colaboradores para montar o organograma.' }));
      return sec;
    }
    // Monta depois de entrar na página (o componente mede o quadro).
    sec.montar = function () {
      destruirOrganograma();
      try {
        org.inst = O.montar(quadro, {
          pessoas: pessoasDoOrganograma(colabs),
          relacoes: (eq.relacoes || []).slice(),
          topoIds: (eq.topoIds || []).slice(),
          semPosicaoIds: (eq.semPosicaoIds || []).slice(),
          modo: 'editar',
          aoMudar: function (relacoes, mudanca) { mudouOrganograma(emp, eq, relacoes, mudanca); },
          aoAbrirPessoa: function (id) {
            var c = colabs.filter(function (x) { return String(x.pessoaId) === String(id); })[0];
            if (c) janelaLigacoes(emp, eq, c);
          }
        });
        var inst = org.inst;
        if (inst && typeof inst.ajustar === 'function' && root.requestAnimationFrame) {
          root.requestAnimationFrame(function () { if (org.inst === inst && document.body.contains(quadro)) inst.ajustar(); });
        }
      } catch (e) {
        limpar(quadro);
        quadro.appendChild(el('p', { classe: 'aviso aviso--erro', texto: 'Não foi possível desenhar o organograma: ' + ((e && e.message) || 'erro') }));
      }
    };
    return sec;
  }

  function mudouOrganograma(emp, eq, relacoes, mudanca) {
    var aviso = $('emp-org-aviso');
    if (mudanca && mudanca.erro) {
      if (aviso) { aviso.textContent = mudanca.erro; aviso.hidden = false; }
      return;
    }
    if (aviso) aviso.hidden = true;
    eq.relacoes = (relacoes || []).map(function (r) { return { de: String(r.de), para: String(r.para), tipo: r.tipo }; });
    if (mudanca && Array.isArray(mudanca.topoIds)) eq.topoIds = mudanca.topoIds.map(String);
    if (mudanca && Array.isArray(mudanca.semPosicaoIds)) eq.semPosicaoIds = mudanca.semPosicaoIds.map(String);
    estado.emp.indice = null;
    var st = $('emp-org-status');
    if (st) st.textContent = 'Salvando…';
    org.pendente = { emp: emp, eq: eq };
    clearTimeout(org.timer);
    org.timer = setTimeout(salvarOrganograma, 500);
  }

  function salvarOrganograma() {
    var p = org.pendente;
    org.pendente = null;
    if (!p) return;
    var rels = p.eq.relacoes.slice();
    api('salvarRelacoes', p.emp.id, rels, { topoIds: (p.eq.topoIds || []).slice() }).then(function () {
      if (org.pendente) return; // mudou de novo enquanto salvava: o próximo salvamento atualiza o status
      var st = $('emp-org-status');
      if (st) st.textContent = 'Salvo';
    }).catch(function (e) {
      var st = $('emp-org-status');
      if (st) st.textContent = 'Não salvou';
      falhou(e);
    });
  }

  var NIVEIS_PAR = { fluido: 'Fluido', atencao: 'Atenção', tensao: 'Tensão', indefinido: 'Sem teste' };
  var CLASSE_PAR = { fluido: 'selo--verde', atencao: '', tensao: 'selo--laranja', indefinido: '' };
  var TIPOS_REL = { lidera: 'lidera', direto: 'trabalha diretamente com', indireto: 'trabalha indiretamente com' };

  function blocoCompatibilidade(compat, colabs) {
    var sec = el('section', { classe: 'caixa caixa--ampla emp-bloco', id: 'emp-compat' }, [el('h3', { classe: 'caixa__titulo', texto: 'Mapa de compatibilidade' })]);
    if (!colabs.length) { sec.appendChild(el('p', { classe: 'texto-suave t-rotulo', texto: 'Sem colaboradores ainda.' })); return sec; }
    if (!compat) { sec.appendChild(el('p', { classe: 'texto-suave t-rotulo', texto: 'Mapa indisponível (compatibilidade.js não carregado).' })); return sec; }
    var eq = compat.equipe || {};
    var niveis = eq.niveis || {};
    sec.appendChild(el('div', { classe: 'compat-topo' }, [
      el('div', { classe: 'caixa caixa--compacta caixa--destaque compat-harmonia' }, [
        el('span', { classe: 'resumo__rotulo', texto: 'Harmonia da equipe' }),
        el('span', { classe: 't-numero-grande valor-destaque', id: 'emp-harmonia', texto: eq.harmonia == null ? '—' : String(eq.harmonia) }),
        el('span', { classe: 'resumo__nota', texto: eq.harmonia == null ? 'Defina as ligações entre quem já fez o teste' : 'de 0 a 100, média das ligações' })
      ]),
      el('div', { classe: 'compat-contagem' }, ['fluido', 'atencao', 'tensao'].map(function (k) {
        return el('span', { classe: 'selo ' + CLASSE_PAR[k], 'data-nivel': k, texto: NIVEIS_PAR[k] + ': ' + (niveis[k] || 0) });
      }).concat(el('p', { classe: 't-rotulo texto-medio compat-resumo', texto: eq.resumo || '' })))
    ]));
    var lacunas = (eq.falta || []).concat(eq.excesso || []);
    if (lacunas.length) {
      sec.appendChild(el('ul', { classe: 'compat-lacunas' }, lacunas.map(function (f) { return el('li', { texto: f.texto }); })));
    }
    var nomes = {};
    colabs.forEach(function (c) { nomes[String(c.pessoaId)] = c.nome; });
    var pares = (compat.pares || []).slice().sort(function (a, b) {
      var ordem = { tensao: 0, atencao: 1, fluido: 2, indefinido: 3 };
      return ordem[a.nivel] - ordem[b.nivel];
    });
    if (!pares.length) {
      sec.appendChild(el('p', { classe: 'texto-suave t-rotulo emp-dica', texto: 'Nenhuma ligação definida. Em cada colaborador, use "Ligações" para dizer quem é o líder e com quem trabalha.' }));
    } else {
      sec.appendChild(el('ul', { classe: 'compat-pares', id: 'emp-pares' }, pares.map(function (p) {
        var dicas = (p.dicas || []).slice(0, 3);
        return el('li', { classe: 'compat-par', 'data-nivel': p.nivel, 'data-de': p.de, 'data-para': p.para }, [
          el('div', { classe: 'compat-par__topo' }, [
            el('span', { classe: 'compat-par__nomes' }, [
              el('span', { classe: 'seminegrito', texto: nomes[p.de] || p.de }),
              el('span', { classe: 'texto-suave', texto: ' ' + (TIPOS_REL[p.tipo] || p.tipo) + ' ' }),
              el('span', { classe: 'seminegrito', texto: nomes[p.para] || p.para })
            ]),
            el('span', { classe: 'selo ' + (CLASSE_PAR[p.nivel] || ''), texto: NIVEIS_PAR[p.nivel] + (p.pontuacao != null ? ' · ' + p.pontuacao : '') })
          ]),
          p.riscos && p.riscos[0] ? el('p', { classe: 't-rotulo texto-medio', texto: p.riscos[0] }) : (p.sinergias && p.sinergias[0] ? el('p', { classe: 't-rotulo texto-medio', texto: p.sinergias[0] }) : null),
          dicas.length ? el('ul', { classe: 'compat-dicas' }, dicas.map(function (d) { return el('li', { texto: d }); })) : null
        ]);
      })));
    }
    if (compat.avisos && compat.avisos.length) {
      sec.appendChild(el('ul', { classe: 'compat-avisos' }, compat.avisos.map(function (a) { return el('li', { texto: a }); })));
    }
    return sec;
  }

  /* ----- Colaboradores: adicionar, editar, mover, desligar, ligações ----- */

  function depoisDeMudarEquipe(empresaId, msg) {
    avisar(msg, 'ok');
    esquecerEquipes();
    return Promise.all([carregarEquipe(empresaId), carregarEmpresas()]).then(function () { renderizarEmpresas(); });
  }

  function janelaColaborador(emp, eq) {
    var ativos = {};
    eq.colaboradores.forEach(function (c) { if (c.status !== 'desligado') ativos[String(c.pessoaId)] = true; });
    var pessoas = pessoasDasRespostas(estado.registros).filter(function (p) { return !ativos[p.pessoaId]; });
    var escPessoa = criarSeletorBusca({ id: 'colab-pessoa', rotulo: 'Pessoa que já respondeu', rotuloId: 'colab-pessoa-rotulo', vazio: 'Pessoa nova (preencher nome e WhatsApp)',
      opcoes: pessoas.map(function (p) { return { valor: p.pessoaId, rotulo: p.nome, sub: [formatarTelefone(p.telefone), p.resultado ? p.resultado.codigo : 'sem teste'].filter(Boolean).join(' · '), busca: soDigitos(p.telefone) }; }) });
    var novos = el('div', { classe: 'form-grade', id: 'colab-novos' }, [
      campoTexto('colab-nome', 'Nome completo', { maxlength: 120 }),
      campoTexto('colab-telefone', 'WhatsApp com DDD', { maxlength: 20, inputmode: 'tel', placeholder: '(11) 99999-8888' })
    ]);
    escPessoa.aoMudar(function () { novos.hidden = !!escPessoa.valor(); });
    abrirJanela({
      id: 'janela-colaborador',
      titulo: 'Adicionar colaborador',
      texto: 'Escolha alguém que já respondeu o teste ou cadastre pelo nome e WhatsApp (o teste pode vir depois).',
      corpo: [
        campoEscolha('Pessoa que já respondeu (opcional)', escPessoa, 'colab-pessoa-rotulo'),
        novos,
        el('div', { classe: 'form-grade' }, [
          campoTexto('colab-cargo', 'Cargo', { maxlength: 120 }),
          campoTexto('colab-area', 'Área', { maxlength: 120 })
        ])
      ],
      botao: 'Adicionar',
      aoConfirmar: function () {
        var d = { empresaId: emp.id, cargo: $('colab-cargo').value.trim(), area: $('colab-area').value.trim() };
        if (escPessoa.valor()) d.pessoaId = escPessoa.valor();
        else {
          d.nome = $('colab-nome').value.trim();
          d.telefone = soDigitos($('colab-telefone').value);
          if (!d.nome) throw new Error('Informe o nome do colaborador.');
          if (d.telefone.length < 10) throw new Error('Informe o WhatsApp com DDD.');
        }
        return api('salvarColaborador', d).then(function () { return depoisDeMudarEquipe(emp.id, 'Colaborador adicionado.'); });
      }
    });
  }

  function janelaEditarColaborador(emp, c) {
    abrirJanela({
      id: 'janela-editar-colaborador',
      titulo: 'Editar ' + c.nome,
      corpo: [
        campoCom('colab-cargo', 'Cargo', c.cargo, { maxlength: 120 }),
        campoCom('colab-area', 'Área', c.area, { maxlength: 120 })
      ],
      aoConfirmar: function () {
        return api('salvarColaborador', { empresaId: emp.id, pessoaId: c.pessoaId, cargo: $('colab-cargo').value.trim(), area: $('colab-area').value.trim() })
          .then(function () { return depoisDeMudarEquipe(emp.id, 'Colaborador salvo.'); });
      }
    });
  }

  function janelaMover(emp, c) {
    var outras = (estado.emp.lista || []).filter(function (e) { return e.id !== emp.id && e.ativo !== false; });
    var escDestino = criarSeletorBusca({ id: 'mover-destino', rotulo: 'Empresa de destino', rotuloId: 'mover-destino-rotulo', vazio: 'Escolher a empresa',
      opcoes: outras.map(function (e) { return { valor: e.id, rotulo: e.nome, sub: e.cidade || '' }; }) });
    abrirJanela({
      id: 'janela-mover',
      titulo: 'Mover ' + c.nome,
      texto: 'O vínculo atual com ' + emp.nome + ' vira histórico (desligado hoje) e as ligações dela aqui são apagadas. Na empresa nova ela entra como colaboradora ativa.',
      corpo: [
        campoEscolha('Empresa de destino', escDestino, 'mover-destino-rotulo'),
        el('div', { classe: 'form-grade' }, [
          campoCom('mover-cargo', 'Cargo na empresa nova', c.cargo, { maxlength: 120 }),
          campoCom('mover-area', 'Área', c.area, { maxlength: 120 })
        ])
      ],
      botao: 'Mover',
      aoConfirmar: function () {
        var destino = escDestino.valor();
        if (!destino) throw new Error('Escolha a empresa de destino.');
        return api('moverColaborador', { pessoaId: c.pessoaId, empresaId: destino, cargo: $('mover-cargo').value.trim(), area: $('mover-area').value.trim() })
          .then(function () { return depoisDeMudarEquipe(emp.id, c.nome + ' agora está em ' + nomeEmpresa(destino) + '.'); });
      }
    });
  }

  function desligar(emp, c) {
    confirmar({ titulo: 'Desligar ' + c.nome + '?', texto: 'O vínculo com ' + emp.nome + ' vai para o histórico e as ligações dela no organograma são apagadas. As respostas do teste continuam.', botao: 'Desligar' }).then(function (ok) {
      if (!ok) return;
      api('desligarColaborador', c.vinculoId).then(function () { return depoisDeMudarEquipe(emp.id, c.nome + ' foi desligado(a).'); }).catch(falhou);
    });
  }

  function janelaLigacoes(emp, eq, c) {
    var id = String(c.pessoaId);
    var lig = ligacoesDe(eq.relacoes, id);
    var outros = eq.colaboradores.filter(function (x) { return x.status !== 'desligado' && String(x.pessoaId) !== id; }).map(function (x) {
      return { valor: String(x.pessoaId), rotulo: x.nome, sub: [x.cargo, x.resultado ? x.resultado.codigo : 'sem teste'].filter(Boolean).join(' · ') };
    });
    var escLider = criarSeletorBusca({ id: 'lig-lider', rotulo: 'Líder', rotuloId: 'lig-lider-rotulo', vazio: 'Sem líder', opcoes: outros, valor: lig.lider });
    var escDiretos = criarSeletorBusca({ id: 'lig-diretos', rotulo: 'Trabalha diretamente com', rotuloId: 'lig-diretos-rotulo', multiplo: true, opcoes: outros, valores: lig.diretos, textoBotao: 'Adicionar pessoa' });
    var escIndiretos = criarSeletorBusca({ id: 'lig-indiretos', rotulo: 'Trabalha indiretamente com', rotuloId: 'lig-indiretos-rotulo', multiplo: true, opcoes: outros, valores: lig.indiretos, textoBotao: 'Adicionar pessoa' });
    abrirJanela({
      id: 'janela-ligacoes',
      titulo: 'Ligações de ' + c.nome,
      texto: outros.length ? 'Quem lidera e com quem trabalha no dia a dia. Isso monta o organograma e o mapa de compatibilidade.' : 'Adicione outros colaboradores para criar ligações.',
      corpo: [
        campoEscolha('Líder (um)', escLider, 'lig-lider-rotulo'),
        campoEscolha('Trabalha diretamente com', escDiretos, 'lig-diretos-rotulo'),
        campoEscolha('Trabalha indiretamente com', escIndiretos, 'lig-indiretos-rotulo')
      ],
      botao: 'Salvar ligações',
      aoConfirmar: function () {
        var novo = aplicarLigacoes(eq.relacoes, id, { lider: escLider.valor(), diretos: escDiretos.valores(), indiretos: escIndiretos.valores() });
        return api('salvarRelacoes', emp.id, novo).then(function () { return depoisDeMudarEquipe(emp.id, 'Ligações de ' + c.nome + ' salvas.'); });
      }
    });
  }

  /* ----- Relatórios dos modelos (equipe, como liderar, pessoa) ----- */

  function modelos() {
    var M = root.DISC_RELATORIO_MODELOS;
    if (!M) throw new Error('Os modelos de relatório não foram carregados (relatorio-modelos.js).');
    return M;
  }

  // O relatório aberto mora na aba de onde veio: Relatórios (assistente) ou Empresas (página da empresa / detalhe).
  function abrirRelatorioModelo(rel) {
    rel.id = null; rel.token = ''; rel.status = 'novo'; rel.url = '';
    if (rel.volta && rel.volta.aba === 'relatorios') {
      estado.rl.rel = rel;
      irParaRelatorios('relatorio');
      return;
    }
    estado.emp.rel = rel;
    irParaEmpresas('relatorio', null);
  }
  function relAtual() { return estado.aba === 'relatorios' ? estado.rl.rel : estado.emp.rel; }
  function redesenharRel() { if (estado.aba === 'relatorios') renderizarRelatorios(); else renderizarEmpresas(); }

  function janelaRelatorioEquipe(emp, eq) {
    var colabs = eq.colaboradores.filter(function (c) { return c.status !== 'desligado'; });
    var opColabs = colabs.map(function (c) { return { valor: String(c.pessoaId), rotulo: c.nome, sub: [c.cargo, c.resultado ? c.resultado.codigo : 'sem teste'].filter(Boolean).join(' · ') }; });
    var ids = {};
    colabs.forEach(function (c) { ids[String(c.pessoaId)] = true; });
    var candidatos = estado.registros.filter(function (r) { return r.calc && !(r.pessoaId && ids[String(r.pessoaId)]); });
    var escCand = criarSeletorBusca({ id: 'rel-cand', rotulo: 'Candidato', rotuloId: 'rel-cand-rotulo', vazio: 'Escolher uma resposta',
      opcoes: candidatos.map(function (r) { return { valor: r.id, rotulo: r.nome || '(sem nome)', sub: [r.avaliacaoNome || r.vaga, r.calc.codigo, formatarData(r.fim || r.recebidoEm)].filter(Boolean).join(' · '), busca: r.protocolo }; }) });
    var escLider = criarSeletorBusca({ id: 'rel-cand-lider', rotulo: 'Líder do candidato', rotuloId: 'rel-cand-lider-rotulo', vazio: 'Sem líder definido', opcoes: opColabs });
    var escColegas = criarSeletorBusca({ id: 'rel-cand-colegas', rotulo: 'Colegas diretos do candidato', rotuloId: 'rel-cand-colegas-rotulo', multiplo: true, opcoes: opColabs, textoBotao: 'Adicionar colega' });
    var marcar = campoMarcar('rel-incluir-candidato', 'Incluir o encaixe de um candidato nesta equipe', false);
    var area = el('div', { classe: 'janela__corpo', id: 'rel-candidato-area', hidden: true }, [
      campoEscolha('Candidato (resposta de um processo)', escCand, 'rel-cand-rotulo'),
      campoTexto('rel-cand-cargo', 'Cargo pretendido', { maxlength: 120 }),
      campoEscolha('Líder do candidato', escLider, 'rel-cand-lider-rotulo'),
      campoEscolha('Colegas diretos do candidato', escColegas, 'rel-cand-colegas-rotulo')
    ]);
    marcar.querySelector('input').addEventListener('change', function (e) { area.hidden = !e.target.checked; });
    abrirJanela({
      id: 'janela-rel-equipe',
      titulo: 'Relatório da equipe',
      texto: 'Organograma com os perfis, compatibilidade, equilíbrio do time e como liderar cada colaborador. Gerado aqui no navegador: confira a prévia antes de publicar.',
      corpo: [marcar, area],
      botao: 'Gerar prévia',
      aoConfirmar: function () {
        var foco = null;
        if ($('rel-incluir-candidato').checked) {
          var r = acharRegistro(escCand.valor());
          if (!r) throw new Error('Escolha o candidato.');
          foco = { nome: r.nome, cargo: $('rel-cand-cargo').value.trim() || r.vaga || '', resultado: resultadoDoRegistro(r), foto: fotoDe(r) || undefined,
            liderId: escLider.valor(), diretos: escColegas.valores() };
          foco.relacoes = relacoesDoFoco(foco);
        }
        var dados = modelos().equipe({ empresa: { nome: emp.nome, cidade: emp.cidade || '' }, colaboradores: colabs, relacoes: eq.relacoes,
          consultor: consultorAtual(), foco: foco || undefined });
        abrirRelatorioModelo({ modelo: 'equipe', empresaId: emp.id, pessoaId: null, dados: dados, ctx: { empresa: emp.nome },
          volta: { aba: 'empresas', tela: 'pagina', id: emp.id, subaba: estado.emp.subaba } });
      }
    });
  }

  function gerarLideranca(emp, eq, c, volta) {
    try {
      var lig = ligacoesDe(eq.relacoes, c.pessoaId);
      var l = lig.lider ? eq.colaboradores.filter(function (x) { return String(x.pessoaId) === lig.lider; })[0] : null;
      var dados = modelos().lideranca({ pessoa: { nome: c.nome, cargo: c.cargo || '', resultado: c.resultado, exigido: c.exigido && pctValido(c.exigido.percentuais) ? c.exigido : undefined, foto: fotoValida(c.foto) ? c.foto : undefined },
        lider: l ? { nome: l.nome, resultado: l.resultado || null, foto: fotoValida(l.foto) ? l.foto : undefined } : null, empresa: { nome: emp.nome } });
      abrirRelatorioModelo({ modelo: 'lideranca', empresaId: emp.id, pessoaId: c.pessoaId, dados: dados, ctx: { empresa: emp.nome, pessoa: c.nome },
        volta: volta || { aba: 'empresas', tela: 'pagina', id: emp.id, subaba: estado.emp.subaba } });
    } catch (e) { falhou(e); }
  }

  // Relatório da pessoa: completo (padrão) ou simples (2 páginas). A prévia troca a variante sem sair da tela.
  function dadosPessoa(variante, nome, resultado, exigido, foto) {
    var M = modelos();
    var entrada = { pessoa: { nome: nome, resultado: resultado }, consultor: consultorAtual() || undefined };
    if (fotoValida(foto)) entrada.pessoa.foto = foto;
    if (exigido && pctValido(exigido.percentuais)) entrada.pessoa.exigido = { percentuais: exigido.percentuais, codigo: exigido.codigo || '' };
    if (variante === 'simples') {
      if (typeof M.pessoaSimples !== 'function') throw new Error('A versão simples do relatório não está disponível (relatorio-modelos.js).');
      return M.pessoaSimples(entrada);
    }
    return M.pessoa(entrada);
  }

  function gerarPessoa(pessoaId, nome, resultado, volta, empresaId, exigido, foto) {
    try {
      var dados = dadosPessoa('completo', nome, resultado, exigido, foto);
      abrirRelatorioModelo({ modelo: 'pessoa', empresaId: empresaId || null, pessoaId: pessoaId, dados: dados, ctx: { pessoa: nome }, volta: volta,
        variante: 'completo', gerar: function (v) { return dadosPessoa(v, nome, resultado, exigido, foto); } });
    } catch (e) { falhou(e); }
  }

  function voltarDoRelatorio(rel) {
    var v = rel.volta || {};
    estado.emp.rel = null;
    estado.rl.rel = null;
    if (v.aba === 'relatorios') estado.rl.gerados = null;
    if (v.detalhe && acharRegistro(v.detalhe)) { estado.emp.tela = 'lista'; renderizarEmpresas(); mostrarAba('lista'); abrirDetalhe(v.detalhe); return; }
    if (v.aba === 'relatorios') { irParaRelatorios(v.tela || 'gerados'); return; }
    irParaEmpresas(v.tela || 'lista', v.id || null, v.subaba);
  }

  function salvarRelModelo(rel, publicar) {
    var d = { modelo: rel.modelo, dados: rel.dados, publicar: !!publicar };
    if (rel.empresaId) d.empresaId = rel.empresaId;
    if (rel.pessoaId) d.pessoaId = rel.pessoaId;
    if (rel.id) d.id = rel.id;
    return api('salvarRelatorioModelo', d).then(function (resp) {
      var r = resp.relatorio || {};
      rel.id = r.id || rel.id;
      rel.token = r.token || rel.token;
      rel.status = r.status || (publicar ? 'publicado' : 'rascunho');
      rel.url = rel.status === 'publicado' ? (r.url ? urlAbsoluta(r.url, root.location.href) : linkRelatorioModelo(root.location.href, rel.token)) : '';
      estado.emp.relatorios = {};
      return resp;
    });
  }

  function renderizarRelatorioModelo(box, rel) {
    var publicado = rel.status === 'publicado';
    var titulo = (rel.dados && rel.dados.titulo) || MODELOS_REL[rel.modelo];
    var acoes = [botao('botao--claro', '← Voltar', function () { voltarDoRelatorio(rel); }, { id: 'btn-voltar-relatorio' })];
    var btnRasc = botao(publicado ? 'botao--claro' : 'botao--principal', publicado ? 'Voltar para rascunho' : 'Salvar rascunho', function () {
      btnRasc.disabled = true;
      salvarRelModelo(rel, false).then(function () {
        avisar(publicado ? 'O relatório voltou a ser rascunho: o link não abre mais.' : 'Rascunho salvo.', 'ok');
        redesenharRel();
      }).catch(function (e) { falhou(e); btnRasc.disabled = false; });
    }, { id: 'btn-rel-rascunho' });
    acoes.push(btnRasc);
    if (!publicado) {
      var btnPub = botao('botao--laranja', 'Publicar', function () {
        btnPub.disabled = true;
        salvarRelModelo(rel, true).then(function () {
          avisar('Relatório publicado. Copie o link e envie.', 'ok');
          redesenharRel();
        }).catch(function (e) { falhou(e); btnPub.disabled = false; });
      }, { id: 'btn-rel-publicar' });
      acoes.push(btnPub);
    }
    var sub = [MODELOS_REL[rel.modelo], rel.ctx && rel.ctx.empresa, publicado ? 'publicado' : (rel.status === 'rascunho' ? 'rascunho salvo' : 'ainda não salvo')].filter(Boolean).join(' · ');
    box.appendChild(cabecalhoVista(sub, titulo, 'Prévia do documento como quem recebe vai ver. Salve como rascunho ou publique para gerar o link.', acoes));

    // Relatório da pessoa: completo / simples (troca os dados da prévia; salvar grava a variante escolhida)
    if (rel.modelo === 'pessoa' && typeof rel.gerar === 'function') {
      var variante = rel.variante === 'simples' ? 'simples' : 'completo';
      var trocar = function (v) {
        if (v === variante) return;
        try { rel.dados = rel.gerar(v); rel.variante = v; redesenharRel(); } catch (e) { falhou(e); }
      };
      box.appendChild(el('div', { classe: 'rel-variante', id: 'rel-variante' }, [
        el('span', { classe: 'campo__rotulo', id: 'rel-variante-rotulo', texto: 'Relatório da pessoa:' }),
        el('div', { classe: 'segmento', role: 'group', 'aria-labelledby': 'rel-variante-rotulo' }, [
          el('button', { type: 'button', classe: 'segmento__botao', id: 'btn-rel-completo', 'aria-pressed': variante === 'completo' ? 'true' : 'false', texto: 'Completo', onclick: function () { trocar('completo'); } }),
          el('button', { type: 'button', classe: 'segmento__botao', id: 'btn-rel-simples', 'aria-pressed': variante === 'simples' ? 'true' : 'false', texto: 'Simples (2 páginas)', onclick: function () { trocar('simples'); } })
        ])
      ]));
    }

    if (publicado && rel.url) {
      var ctx = { empresa: rel.ctx && rel.ctx.empresa, pessoa: rel.ctx && rel.ctx.pessoa, consultor: consultorAtual() };
      var msg = mensagemRelatorioModelo(rel.modelo, ctx, rel.url);
      box.appendChild(el('section', { classe: 'caixa caixa--destaque rel-publicado', id: 'rel-modelo-publicado' }, [
        el('h3', { classe: 'caixa__titulo', texto: 'Link do relatório' }),
        el('p', { classe: 'av-link', id: 'rel-modelo-link', texto: rel.url }),
        el('p', { classe: 'rel-mensagem', id: 'rel-modelo-mensagem', texto: msg }),
        el('div', { classe: 'gestao-card__acoes' }, [
          botao('botao--principal botao--pequeno', 'Copiar link', function () { copiar(rel.url, 'Link do relatório copiado.'); }, { id: 'btn-rel-copiar-link' }),
          botao('botao--claro botao--pequeno', 'Copiar mensagem para WhatsApp', function () { copiar(msg, 'Mensagem copiada. Cole no WhatsApp.'); }, { id: 'btn-rel-copiar-msg' }),
          el('a', { classe: 'botao botao--claro botao--pequeno', href: rel.url, target: '_blank', rel: 'noopener', texto: 'Abrir relatório' })
        ])
      ]));
    }

    var frame = el('iframe', { classe: 'previa-doc', id: 'rel-modelo-previa', title: 'Prévia do relatório', sandbox: 'allow-same-origin', loading: 'eager' });
    frame.addEventListener('load', function () {
      try { var d = frame.contentDocument; if (d && d.documentElement) frame.style.height = Math.max(600, d.documentElement.scrollHeight) + 'px'; } catch (e) { /* altura padrão */ }
    });
    frame.srcdoc = documentoPrevia(rel.dados);
    box.appendChild(el('div', { classe: 'caixa caixa--compacta previa-moldura' }, frame));

    var filtro = rel.modelo === 'equipe' ? { empresaId: rel.empresaId } : { pessoaId: rel.pessoaId };
    var chave = rel.modelo === 'equipe' ? 'e:' + rel.empresaId : 'p:' + rel.pessoaId;
    box.appendChild(el('div', { classe: 'emp-rodape' }, blocoRelatoriosModelo(filtro, chave, rel.ctx || {})));
  }

  // Lista dos relatórios salvos (de uma empresa ou de uma pessoa), com link, mensagem e excluir.
  function blocoRelatoriosModelo(filtro, chave, ctx) {
    var idSec = 'rel-modelos-' + chave.replace(/[^A-Za-z0-9_-]/g, '_');
    var sec = el('section', { classe: 'caixa emp-relatorios', id: idSec }, [el('h3', { classe: 'caixa__titulo', texto: filtro.empresaId ? 'Relatórios da empresa' : 'Relatórios salvos desta pessoa' })]);
    var lista = estado.emp.relatorios[chave];
    if (!lista) {
      sec.appendChild(el('p', { classe: 'texto-suave t-rotulo', texto: 'Carregando…' }));
      api('listarRelatoriosModelo', filtro).then(function (resp) {
        estado.emp.relatorios[chave] = resp.relatorios || [];
        var velho = $(idSec);
        if (velho) velho.parentNode.replaceChild(blocoRelatoriosModelo(filtro, chave, ctx), velho);
      }).catch(function (e) {
        if (e && e.tratado) return;
        var velho = $(idSec);
        if (velho) { var p = velho.querySelector('p'); if (p) p.textContent = (e && e.message) || 'Não foi possível listar os relatórios.'; }
      });
      return sec;
    }
    if (!lista.length) { sec.appendChild(el('p', { classe: 'texto-suave t-rotulo', texto: 'Nenhum relatório salvo ainda.' })); return sec; }
    sec.appendChild(el('ul', { classe: 'lista-simples' }, lista.map(function (r) {
      var pub = r.status === 'publicado';
      var url = pub ? (r.url ? urlAbsoluta(r.url, root.location.href) : linkRelatorioModelo(root.location.href, r.token)) : '';
      return el('li', { classe: 'rel-linha', 'data-id': r.id, 'data-modelo': r.modelo, 'data-status': pub ? 'publicado' : 'rascunho' }, [
        el('div', { classe: 'rel-linha__texto' }, [
          el('span', { classe: 'selo ' + (pub ? 'selo--verde' : ''), texto: pub ? 'Publicado' : 'Rascunho' }),
          el('span', { classe: 't-rotulo', texto: r.titulo || MODELOS_REL[r.modelo] || 'Relatório' }),
          el('span', { classe: 'texto-suave t-rotulo tabular', texto: formatarData(r.atualizadoEm || r.criadoEm) })
        ]),
        el('div', { classe: 'gestao-card__acoes' }, [
          pub ? botao('botao--claro botao--pequeno', 'Copiar link', function () { copiar(url, 'Link do relatório copiado.'); }, { 'data-acao': 'copiar-link' }) : null,
          pub ? botao('botao--claro botao--pequeno', 'Copiar mensagem', function () {
            copiar(mensagemRelatorioModelo(r.modelo, { empresa: ctx.empresa, pessoa: ctx.pessoa, consultor: consultorAtual() }, url), 'Mensagem copiada. Cole no WhatsApp.');
          }, { 'data-acao': 'copiar-mensagem' }) : null,
          pub ? el('a', { classe: 'botao botao--claro botao--pequeno', href: url, target: '_blank', rel: 'noopener', texto: 'Abrir' }) : null,
          botao('botao--perigo botao--pequeno', 'Excluir', function () {
            confirmar({ titulo: 'Excluir o relatório?', texto: 'O link deixa de abrir e o relatório sai da lista. Dá para gerar outro depois.', botao: 'Excluir relatório' }).then(function (ok) {
              if (!ok) return;
              api('excluirRelatorioModelo', r.id).then(function () {
                avisar('Relatório excluído.', 'ok');
                var atual = relAtual();
                if (atual && atual.id === r.id) { atual.id = null; atual.token = ''; atual.status = 'novo'; atual.url = ''; }
                estado.rl.gerados = null;
                estado.emp.relatorios = {};
                redesenharRel();
              }).catch(falhou);
            });
          }, { 'data-acao': 'excluir' })
        ])
      ]);
    })));
    return sec;
  }

  // Vínculo ativo de uma pessoa (procura nas equipes das empresas; cache até a próxima mudança).
  function acharVinculo(pessoaId) {
    if (!empresasOk() || !pessoaId) return Promise.resolve(null);
    if (!estado.emp.indice) {
      estado.emp.indice = (estado.emp.lista ? Promise.resolve() : carregarEmpresas()).then(function () {
        var idx = {};
        return Promise.all((estado.emp.lista || []).map(function (e) {
          var eq = estado.emp.equipes[e.id];
          return (eq ? Promise.resolve(eq) : carregarEquipe(e.id)).then(function (q) {
            q.colaboradores.forEach(function (c) { if (c.status !== 'desligado') idx[String(c.pessoaId)] = { empresa: e, equipe: q, colaborador: c }; });
          }).catch(function () { /* empresa sem acesso: ignora */ });
        })).then(function () { return idx; });
      });
    }
    return estado.emp.indice.then(function (idx) { return idx[String(pessoaId)] || null; });
  }

  // Atalhos no detalhe de uma resposta: relatório da pessoa e, se ela tem vínculo ativo, como liderar.
  function blocoRelatoriosDetalhe(r, ficha) {
    if (!empresasOk() || !r.calc || !r.pessoaId || papel() !== 'admin') return null;
    var nome = ficha.nome || r.nome || '';
    var acoes = el('div', { classe: 'det-gestao__acoes', id: 'det-relatorios-acoes' }, [
      botao('botao--claro', 'Relatório da pessoa', function () {
        gerarPessoa(r.pessoaId, nome, resultadoDoRegistro(r), { detalhe: r.id }, null, exigidoDoRegistro(r), fotoDe(r));
      }, { id: 'btn-det-rel-pessoa' })
    ]);
    var nota = el('p', { classe: 'texto-suave t-rotulo', id: 'det-vinculo', texto: 'Procurando vínculo com empresa…' });
    acharVinculo(r.pessoaId).then(function (v) {
      if (!document.body.contains(acoes)) return;
      if (!v) { nota.textContent = 'Sem vínculo ativo com empresa cadastrada.'; return; }
      nota.textContent = 'Colaborador(a) de ' + v.empresa.nome + (v.colaborador.cargo ? ' · ' + v.colaborador.cargo : '') + '.';
      acoes.appendChild(botao('botao--claro', 'Como liderar', function () {
        var c = v.colaborador;
        if (!c.resultado) c = Object.assign({}, c, { resultado: resultadoDoRegistro(r) });
        gerarLideranca(v.empresa, v.equipe, c);
        if (estado.emp.rel) estado.emp.rel.volta = { detalhe: r.id };
      }, { id: 'btn-det-como-liderar' }));
    });
    return el('section', { classe: 'caixa nao-imprimir det-gestao surgir', id: 'det-relatorios-modelo' }, [
      el('h3', { classe: 'caixa__titulo', texto: 'Relatórios desta pessoa' }),
      nota,
      acoes
    ]);
  }

  /* ---------- Aba Relatórios: modelos (com exemplo), assistente e todos os gerados ---------- */

  function novoEstadoRelatorios() {
    return { tela: 'modelos', chave: '', exemplo: null, rel: null, gerados: null, erro: '', filtro: { modelo: '', empresa: '', status: '' }, alvo: {} };
  }

  function irParaRelatorios(tela, chave) {
    if (tela === 'assistente') estado.rl.alvo = {};
    estado.rl.tela = tela || 'modelos';
    if (chave !== undefined) estado.rl.chave = chave;
    renderizarRelatorios();
    mostrarAba('relatorios');
    root.scrollTo(0, 0);
    var h = $('vista-relatorios').querySelector('h2');
    if (h) { h.setAttribute('tabindex', '-1'); h.focus(); }
  }

  // Carrega um script do próprio site uma vez só (motor e exemplo do processo seletivo, só quando pedidos).
  var scriptsCarregados = {};
  function carregarScript(arquivo, global) {
    if (root[global]) return Promise.resolve(root[global]);
    if (!scriptsCarregados[arquivo]) {
      scriptsCarregados[arquivo] = new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = 'js/' + arquivo;
        s.onload = function () { if (root[global]) resolve(root[global]); else reject(new Error('Não foi possível carregar ' + arquivo + '.')); };
        s.onerror = function () { delete scriptsCarregados[arquivo]; reject(new Error('Não foi possível carregar ' + arquivo + '.')); };
        document.head.appendChild(s);
      });
    }
    return scriptsCarregados[arquivo];
  }

  function dadosDoExemplo(chave) {
    if (chave !== 'processo') return Promise.resolve().then(function () { return exemploModelo(chave, { modelos: modelos() }); });
    return Promise.all([carregarScript('relatorio-motor.js', 'DISC_RELATORIO'), carregarScript('fixture-processo-exemplo.js', 'DISC_FIXTURE_PROCESSO')])
      .then(function (r) { return exemploModelo('processo', { motor: r[0], fixture: r[1] }); });
  }

  function verExemplo(chave) {
    estado.rl.chave = chave;
    estado.rl.exemplo = null;
    irParaRelatorios('exemplo');
    dadosDoExemplo(chave).then(function (dados) {
      if (estado.rl.tela !== 'exemplo' || estado.rl.chave !== chave) return;
      estado.rl.exemplo = dados;
      renderizarRelatorios();
    }).catch(function (e) {
      estado.rl.exemplo = { erro: (e && e.message) || 'Não foi possível montar o exemplo.' };
      renderizarRelatorios();
    });
  }

  // O modelo precisa do Supabase (ou da prévia) para ser salvo; o do processo usa o editor do processo (qualquer servidor).
  function modeloDisponivel(m) { return m.modelo === 'processo' ? !!MODO_API : empresasOk(); }

  function subabasRelatorios(atual) {
    var itens = [{ id: 'modelos', rotulo: 'Modelos' }, { id: 'gerados', rotulo: 'Gerados' }];
    return el('nav', { classe: 'subabas', id: 'rel-subabas', 'aria-label': 'Seções de relatórios' }, itens.map(function (s) {
      return el('button', { type: 'button', classe: 'subaba', id: 'rel-subaba-' + s.id, 'data-subaba': s.id, 'aria-current': s.id === atual ? 'page' : null,
        texto: s.rotulo, onclick: function () { irParaRelatorios(s.id); } });
    }));
  }

  function passosAssistente(n) {
    var nomes = ['Modelo', 'Para quem', 'Prévia e envio'];
    return el('ol', { classe: 'passos-assist', id: 'assist-passos', 'aria-label': 'Passos' }, nomes.map(function (t, i) {
      return el('li', { classe: 'passos-assist__item' + (i + 1 < n ? ' passos-assist__item--feito' : ''), 'aria-current': i + 1 === n ? 'step' : null }, [
        el('span', { classe: 'passos-assist__num tabular', texto: String(i + 1) }), el('span', { texto: t })
      ]);
    }));
  }

  function renderizarRelatorios() {
    var box = $('vista-relatorios');
    if (!box) return;
    limpar(box);
    if (papel() !== 'admin') return;
    var t = estado.rl.tela;
    if (t === 'relatorio' && estado.rl.rel) {
      box.appendChild(passosAssistente(3));
      return renderizarRelatorioModelo(box, estado.rl.rel);
    }
    if (t === 'exemplo' && estado.rl.chave) return renderizarExemplo(box);
    if (t === 'assistente') return renderizarAssistente(box);
    if (t === 'gerados') return renderizarGerados(box);
    estado.rl.tela = 'modelos';
    renderizarModelos(box);
  }

  function renderizarModelos(box) {
    box.appendChild(cabecalhoVista('Relatórios', 'Modelos de relatório',
      'Os cinco relatórios que o sistema gera. Veja um exemplo com dados fictícios ou gere um de verdade.',
      [botao('botao--laranja', 'Gerar relatório', function () { irParaRelatorios('assistente', ''); }, { id: 'btn-rel-novo' })]));
    box.appendChild(subabasRelatorios('modelos'));
    box.appendChild(el('ul', { classe: 'modelos-grade', id: 'lista-modelos' }, MODELOS_CATALOGO.map(function (m) {
      var ok = modeloDisponivel(m);
      return el('li', { classe: 'caixa modelo-card', id: 'modelo-' + m.chave, 'data-chave': m.chave }, [
        el('p', { classe: 'sobretitulo', texto: m.modelo === 'processo' ? 'Seleção' : (m.modelo === 'equipe' ? 'Empresa' : (m.modelo === 'lideranca' ? 'Empresa · líder' : 'Pessoa')) }),
        el('h3', { classe: 'modelo-card__titulo seminegrito', texto: m.titulo }),
        el('dl', { classe: 'modelo-card__dl' }, [
          el('div', null, [el('dt', { texto: 'Para quem é' }), el('dd', { texto: m.paraQuem })]),
          el('div', null, [el('dt', { texto: 'O que responde' }), el('dd', { texto: m.responde })])
        ]),
        ok ? null : el('p', { classe: 't-nota texto-suave', texto: 'Gerar: disponível com o servidor Supabase.' }),
        el('div', { classe: 'gestao-card__acoes modelo-card__acoes' }, [
          botao('botao--claro botao--pequeno', 'Ver exemplo', function () { verExemplo(m.chave); }, { 'data-acao': 'ver-exemplo' }),
          botao('botao--principal botao--pequeno', 'Gerar', function () { irParaRelatorios('assistente', m.chave); }, { 'data-acao': 'gerar', disabled: ok ? null : true })
        ])
      ]);
    })));
  }

  function renderizarExemplo(box) {
    var m = modeloDoCatalogo(estado.rl.chave);
    var ok = modeloDisponivel(m);
    box.appendChild(cabecalhoVista('Exemplo com dados fictícios', m.titulo, m.responde, [
      botao('botao--claro', '← Modelos', function () { irParaRelatorios('modelos'); }, { id: 'btn-exemplo-voltar' }),
      botao('botao--principal', 'Gerar este modelo', function () { irParaRelatorios('assistente', m.chave); }, { id: 'btn-exemplo-gerar', disabled: ok ? null : true })
    ]));
    var ex = estado.rl.exemplo;
    if (!ex) { box.appendChild(el('p', { classe: 'texto-suave t-corpo', id: 'rel-exemplo-carregando', texto: 'Montando o exemplo…' })); return; }
    if (ex.erro) { box.appendChild(el('p', { classe: 'aviso aviso--erro', id: 'rel-exemplo-erro', texto: ex.erro })); return; }
    box.appendChild(el('p', { classe: 'aviso proc-aviso', texto: 'Exemplo com pessoas e empresa fictícias. É assim que quem recebe o relatório vai ver.' }));
    box.appendChild(quadroPrevia('rel-exemplo-previa', 'Exemplo do relatório ' + m.titulo, ex));
  }

  function quadroPrevia(id, titulo, dados) {
    var frame = el('iframe', { classe: 'previa-doc', id: id, title: titulo, sandbox: 'allow-same-origin', loading: 'eager' });
    frame.addEventListener('load', function () {
      try { var d = frame.contentDocument; if (d && d.documentElement) frame.style.height = Math.max(600, d.documentElement.scrollHeight) + 'px'; } catch (e) { /* altura padrão */ }
    });
    frame.srcdoc = documentoPrevia(dados);
    return el('div', { classe: 'caixa caixa--compacta previa-moldura' }, frame);
  }

  /* ----- Assistente: modelo -> para quem -> prévia (tela do relatório) ----- */

  function renderizarAssistente(box) {
    var chave = estado.rl.chave;
    var m = modeloDoCatalogo(chave);
    box.appendChild(cabecalhoVista('Relatórios', 'Gerar relatório', 'Escolha o modelo e para quem é. Depois confira a prévia, salve e publique.',
      [botao('botao--claro', '← Modelos', function () { irParaRelatorios('modelos'); }, { id: 'btn-assist-voltar' })]));
    box.appendChild(passosAssistente(m ? 2 : 1));
    var passo1 = el('section', { classe: 'caixa assist-passo', id: 'assist-passo-modelo' }, [
      el('h3', { classe: 'caixa__titulo', texto: '1. Modelo' }),
      el('div', { classe: 'assist-modelos', role: 'group', 'aria-label': 'Modelo do relatório' }, MODELOS_CATALOGO.map(function (x) {
        var ok = modeloDisponivel(x);
        return el('button', { type: 'button', classe: 'assist-modelo', id: 'assist-modelo-' + x.chave, 'data-chave': x.chave,
          'aria-pressed': x.chave === chave ? 'true' : 'false', disabled: ok ? null : true, title: ok ? null : 'Disponível com o servidor Supabase',
          onclick: function () { estado.rl.chave = x.chave; estado.rl.alvo = {}; renderizarRelatorios(); var b = $('assist-modelo-' + x.chave); if (b) b.focus(); } }, [
          el('span', { classe: 'seminegrito', texto: x.titulo }),
          el('span', { classe: 't-nota texto-suave', texto: x.paraQuem })
        ]);
      }))
    ]);
    box.appendChild(passo1);
    if (!m) return;
    var passo2 = el('section', { classe: 'caixa assist-passo', id: 'assist-passo-alvo' }, [el('h3', { classe: 'caixa__titulo', texto: '2. Para quem' })]);
    box.appendChild(passo2);
    var erro = el('p', { classe: 'campo__erro', id: 'assist-erro', role: 'alert' });
    var btn = botao('botao--laranja', m.modelo === 'processo' ? 'Gerar rascunho do relatório' : 'Gerar prévia', null, { id: 'btn-assist-gerar' });
    var gerar = montarAlvoAssistente(m, passo2);
    btn.addEventListener('click', function () {
      erro.textContent = '';
      Promise.resolve().then(function () { return gerar(btn); }).catch(function (e) {
        if (e && e.tratado) return;
        erro.textContent = (e && e.message) || 'Não foi possível gerar.';
      });
    });
    passo2.addEventListener('change', function () { erro.textContent = ''; });
    passo2.appendChild(erro);
    passo2.appendChild(el('div', { classe: 'gestao-card__acoes' }, btn));
  }

  // Desenha a escolha do passo 2 e devolve a função que gera (ou leva ao editor, no processo seletivo).
  function montarAlvoAssistente(m, sec) {
    var volta = { aba: 'relatorios', tela: 'gerados' };
    if (m.alvo === 'pessoa') {
      var pessoas = pessoasDasRespostas(estado.registros).filter(function (p) { return p.resultado; });
      var escP = criarSeletorBusca({ id: 'assist-pessoa', rotulo: 'Pessoa', rotuloId: 'assist-pessoa-rotulo', vazio: 'Escolher a pessoa',
        opcoes: pessoas.map(function (p) { return { valor: p.pessoaId, rotulo: p.nome || '(sem nome)', sub: [p.resultado.codigo, formatarTelefone(p.telefone)].filter(Boolean).join(' · ') }; }) });
      sec.appendChild(campoEscolha('Pessoa que fez o teste', escP, 'assist-pessoa-rotulo'));
      if (!pessoas.length) sec.appendChild(el('p', { classe: 'texto-suave t-rotulo', texto: 'Ninguém com o teste respondido ainda.' }));
      return function () {
        var p = pessoas.filter(function (x) { return x.pessoaId === escP.valor(); })[0];
        if (!p) throw new Error('Escolha a pessoa.');
        var r = acharRegistro(p.registroId) || {};
        var nome = p.nome, res = p.resultado, exi = exigidoDoRegistro(r), foto = fotoDe(r);
        var dados = dadosPessoa(m.variante, nome, res, exi, foto);
        abrirRelatorioModelo({ modelo: 'pessoa', empresaId: null, pessoaId: p.pessoaId, dados: dados, ctx: { pessoa: nome }, volta: volta,
          variante: m.variante, gerar: function (v) { return dadosPessoa(v, nome, res, exi, foto); } });
      };
    }
    if (m.alvo === 'processo') {
      var procs = estado.processos.filter(function (p) { return p.tipo !== 'equipe'; });
      var escProc = criarSeletorBusca({ id: 'assist-processo', rotulo: 'Processo seletivo', rotuloId: 'assist-processo-rotulo', vazio: 'Escolher o processo',
        opcoes: procs.map(function (p) { return { valor: p.id, rotulo: p.nome, sub: [empresaDe(p), p.codigo].filter(Boolean).join(' · ') }; }) });
      sec.appendChild(campoEscolha('Processo seletivo', escProc, 'assist-processo-rotulo'));
      sec.appendChild(el('p', { classe: 'texto-suave t-rotulo', texto: 'O relatório do processo lê os candidatos do ClickUp e abre no editor do processo, onde você revisa os textos e publica.' }));
      return function (btn) {
        var p = acharProcesso(escProc.valor());
        if (!p) throw new Error('Escolha o processo seletivo.');
        gerarRascunho(p, btn);
      };
    }
    // Empresa (equipe) e colaborador (como liderar)
    var empresas = (estado.emp.lista || []).filter(function (e) { return e.ativo !== false; });
    var alvo = estado.rl.alvo;
    var escEmp = criarSeletorBusca({ id: 'assist-empresa', rotulo: 'Empresa', rotuloId: 'assist-empresa-rotulo', vazio: 'Escolher a empresa', valor: alvo.empresaId || '',
      opcoes: empresas.map(function (e) { return { valor: e.id, rotulo: e.nome, sub: [e.cidade, (Number(e.colaboradores) || 0) + ' colaboradores'].filter(Boolean).join(' · ') }; }) });
    sec.appendChild(campoEscolha('Empresa', escEmp, 'assist-empresa-rotulo'));
    var areaColab = el('div', { id: 'assist-colab-area' });
    sec.appendChild(areaColab);
    var escColab = null;
    function desenharColabs() {
      limpar(areaColab);
      escColab = null;
      if (m.alvo !== 'colaborador' || !alvo.empresaId) return;
      var eq = estado.emp.equipes[alvo.empresaId];
      if (!eq) {
        areaColab.appendChild(el('p', { classe: 'texto-suave t-rotulo', texto: 'Carregando os colaboradores…' }));
        carregarEquipe(alvo.empresaId).then(function () { if (document.body.contains(areaColab)) desenharColabs(); }).catch(falhou);
        return;
      }
      var colabs = eq.colaboradores.filter(function (c) { return c.status !== 'desligado' && c.resultado && c.resultado.percentuais; });
      escColab = criarSeletorBusca({ id: 'assist-colab', rotulo: 'Colaborador', rotuloId: 'assist-colab-rotulo', vazio: 'Escolher o colaborador',
        opcoes: colabs.map(function (c) { return { valor: String(c.pessoaId), rotulo: c.nome, sub: [c.cargo, c.resultado.codigo].filter(Boolean).join(' · ') }; }) });
      areaColab.appendChild(campoEscolha('Colaborador (com o teste feito)', escColab, 'assist-colab-rotulo'));
      if (!colabs.length) areaColab.appendChild(el('p', { classe: 'texto-suave t-rotulo', texto: 'Nenhum colaborador desta empresa fez o teste ainda.' }));
    }
    escEmp.aoMudar(function () { alvo.empresaId = escEmp.valor(); desenharColabs(); });
    desenharColabs();
    return function () {
      var emp = acharEmpresa(escEmp.valor());
      if (!emp) throw new Error('Escolha a empresa.');
      var eqP = estado.emp.equipes[emp.id] ? Promise.resolve(estado.emp.equipes[emp.id]) : carregarEquipe(emp.id);
      return eqP.then(function (eq) {
        var colabs = eq.colaboradores.filter(function (c) { return c.status !== 'desligado'; });
        if (m.alvo === 'colaborador') {
          var c = escColab ? colabs.filter(function (x) { return String(x.pessoaId) === escColab.valor(); })[0] : null;
          if (!c) throw new Error('Escolha o colaborador.');
          gerarLideranca(emp, eq, c, volta);
          return;
        }
        if (!colabs.length) throw new Error('Esta empresa ainda não tem colaboradores.');
        var dados = modelos().equipe({ empresa: { nome: emp.nome, cidade: emp.cidade || '' }, colaboradores: colabs, relacoes: eq.relacoes, consultor: consultorAtual() });
        abrirRelatorioModelo({ modelo: 'equipe', empresaId: emp.id, pessoaId: null, dados: dados, ctx: { empresa: emp.nome }, volta: volta });
      });
    };
  }

  /* ----- Gerados: todos os relatórios (modelos e processos) com filtro ----- */

  function carregarGerados() {
    var pedidos = [
      empresasOk() ? api('listarRelatoriosModelo', {}).then(function (r) { return r.relatorios || []; }) : Promise.resolve([]),
      api('relatoriosListar').then(function (r) { return r.relatorios || []; }),
      empresasOk() && !estado.emp.lista ? carregarEmpresas() : Promise.resolve()
    ];
    return Promise.all(pedidos).then(function (rs) {
      var empresas = {}, procs = {};
      (estado.emp.lista || []).forEach(function (e) { empresas[e.id] = e.nome; });
      estado.processos.forEach(function (p) { procs[p.id] = { nome: p.nome, empresa: empresaDe(p) }; });
      estado.rl.gerados = juntarGerados(rs[0], rs[1], { empresas: empresas, processos: procs, href: root.location.href });
      estado.rl.erro = '';
    }).catch(function (e) {
      if (e && e.tratado) return;
      estado.rl.gerados = estado.rl.gerados || [];
      estado.rl.erro = (e && e.message) || 'Não foi possível listar os relatórios.';
    }).then(function () { if (estado.rl.tela === 'gerados') renderizarRelatorios(); });
  }

  function renderizarGerados(box) {
    box.appendChild(cabecalhoVista('Relatórios', 'Relatórios gerados', 'Todos os relatórios: das pessoas, das equipes e dos processos seletivos.', [
      botao('botao--claro', 'Atualizar', function () { estado.rl.gerados = null; renderizarRelatorios(); }, { id: 'btn-gerados-atualizar' }),
      botao('botao--laranja', 'Gerar relatório', function () { irParaRelatorios('assistente', ''); }, { id: 'btn-rel-novo' })
    ]));
    box.appendChild(subabasRelatorios('gerados'));
    if (estado.rl.erro) box.appendChild(el('p', { classe: 'aviso aviso--erro proc-aviso', id: 'gerados-erro', texto: estado.rl.erro }));
    if (!estado.rl.gerados) {
      box.appendChild(el('p', { classe: 'texto-suave t-corpo', texto: 'Carregando…' }));
      carregarGerados();
      return;
    }
    var f = estado.rl.filtro;
    var todos = estado.rl.gerados;
    var escModelo = criarEscolha({ id: 'filtro-rel-modelo', rotulo: 'Modelo', valor: f.modelo, prefixo: 'Modelo',
      opcoes: [{ valor: '', rotulo: 'Todos' }].concat(['pessoa', 'lideranca', 'equipe', 'processo'].map(function (k) { return { valor: k, rotulo: NOMES_MODELO[k] }; })) });
    var escStatus = criarEscolha({ id: 'filtro-rel-status', rotulo: 'Situação', valor: f.status, prefixo: 'Situação',
      opcoes: [{ valor: '', rotulo: 'Todas' }, { valor: 'publicado', rotulo: 'Publicado' }, { valor: 'rascunho', rotulo: 'Rascunho' }] });
    var nomesEmp = {};
    todos.forEach(function (r) { if (r.empresa) nomesEmp[r.empresa] = true; });
    (estado.emp.lista || []).forEach(function (e) { nomesEmp[e.nome] = true; });
    var escEmp = criarSeletorBusca({ id: 'filtro-rel-empresa', rotulo: 'Empresa', vazio: 'Todas as empresas', valor: f.empresa,
      opcoes: Object.keys(nomesEmp).sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); }).map(function (n) { return { valor: n, rotulo: n }; }) });
    box.appendChild(el('div', { classe: 'filtros__escolhas gerados-filtros', id: 'gerados-filtros' }, [escModelo.caixa, escStatus.caixa, escEmp.caixa]));
    var contagem = el('p', { classe: 't-rotulo texto-suave', id: 'gerados-contagem', 'aria-live': 'polite' });
    box.appendChild(contagem);
    var ul = el('ul', { classe: 'gestao-lista gestao-lista--linhas gerados-lista', id: 'lista-gerados' });
    box.appendChild(ul);
    function desenhar() {
      limpar(ul);
      var itens = filtrarGerados(todos, f);
      contagem.textContent = itens.length + ' de ' + todos.length + ' relatório' + (todos.length === 1 ? '' : 's');
      if (!itens.length) {
        ul.appendChild(el('li', { classe: 'caixa vazio' }, el('p', { classe: 'vazio__texto', texto: todos.length ? 'Nenhum relatório com esses filtros.' : 'Nenhum relatório gerado ainda. Use "Gerar relatório".' })));
        return;
      }
      itens.forEach(function (r) { ul.appendChild(linhaGerado(r)); });
    }
    escModelo.botao.addEventListener('change', function () { f.modelo = escModelo.botao.value; desenhar(); });
    escStatus.botao.addEventListener('change', function () { f.status = escStatus.botao.value; desenhar(); });
    escEmp.aoMudar(function () { f.empresa = escEmp.valor(); desenhar(); });
    desenhar();
  }

  function linhaGerado(r) {
    var pub = r.status === 'publicado';
    var msg = function () {
      if (r.tipo === 'processo') { var p = acharProcesso(r.processoId); return mensagemRelatorio(p || {}, r.url); }
      return mensagemRelatorioModelo(r.modelo, { empresa: r.empresa, consultor: consultorAtual() }, r.url);
    };
    return el('li', { classe: 'caixa gestao-card gerado', 'data-id': r.id, 'data-tipo': r.tipo, 'data-modelo': r.modelo, 'data-status': r.status, 'data-empresa': r.empresa }, [
      el('div', { classe: 'gerado__texto' }, [
        el('span', { classe: 'selo ' + (pub ? 'selo--verde' : ''), texto: pub ? 'Publicado' : 'Rascunho' }),
        el('span', { classe: 'selo selo--noite', texto: NOMES_MODELO[r.modelo] || r.modelo }),
        el('span', { classe: 'seminegrito gerado__titulo', texto: r.titulo }),
        el('span', { classe: 'texto-suave t-rotulo', texto: [r.empresa, formatarData(r.data)].filter(function (x) { return x && x !== '—'; }).join(' · ') })
      ]),
      el('div', { classe: 'gestao-card__acoes' }, [
        botao('botao--claro botao--pequeno', 'Abrir', function () { abrirGerado(r); }, { 'data-acao': 'abrir' }),
        pub ? botao('botao--claro botao--pequeno', 'Copiar link', function () { copiar(r.url, 'Link do relatório copiado.'); }, { 'data-acao': 'copiar-link' }) : null,
        pub ? botao('botao--claro botao--pequeno', 'Copiar mensagem', function () { copiar(msg(), 'Mensagem copiada. Cole no WhatsApp.'); }, { 'data-acao': 'copiar-mensagem' }) : null,
        r.tipo === 'modelo' ? botao('botao--perigo botao--pequeno', 'Excluir', function () { excluirGerado(r); }, { 'data-acao': 'excluir' }) : null
      ])
    ]);
  }

  // Abrir: publicado abre o link; rascunho do processo vai para o editor; rascunho de modelo vai para onde ele nasceu.
  function abrirGerado(r) {
    if (r.tipo === 'processo') {
      var p = acharProcesso(r.processoId);
      if (p) { abrirRelatorio(p, { token: r.token, status: r.status }); return; }
    }
    if (r.status === 'publicado' && r.url) { root.open(r.url, '_blank', 'noopener'); return; }
    if (r.empresaId) { irParaEmpresas('pagina', r.empresaId, 'relatorios'); return; }
    var reg = estado.registros.filter(function (x) { return r.pessoaId && String(x.pessoaId) === String(r.pessoaId); })[0];
    if (reg) { mostrarAba('lista'); abrirDetalhe(reg.id); return; }
    avisar('Rascunho sem link: gere de novo e publique para abrir.', 'erro');
  }

  function excluirGerado(r) {
    confirmar({ titulo: 'Excluir o relatório?', texto: '"' + r.titulo + '" sai da lista e o link deixa de abrir. Dá para gerar outro depois.', botao: 'Excluir relatório' }).then(function (ok) {
      if (!ok) return;
      api('excluirRelatorioModelo', r.relId).then(function () {
        avisar('Relatório excluído.', 'ok');
        estado.rl.gerados = (estado.rl.gerados || []).filter(function (x) { return x.id !== r.id; });
        estado.emp.relatorios = {};
        renderizarRelatorios();
      }).catch(falhou);
    });
  }

  /* ---------- Usuários (admin) ---------- */

  function renderizarUsuarios() {
    var box = $('vista-usuarios');
    limpar(box);
    if (papel() !== 'admin') return;
    if (SUPABASE) { renderizarUsuariosSupabase(box); return; }
    box.appendChild(cabecalhoVista('Acessos', 'Usuários',
      'Só administradores entram no painel. Crie um acesso para cada pessoa da equipe da Gestão sem Caos que conduz processos.',
      [botao('botao--principal', 'Novo administrador', function () { janelaUsuario(null); }, { id: 'btn-novo-usuario' })]));
    var eu = estado.usuario || {};
    box.appendChild(el('ul', { classe: 'gestao-lista gestao-lista--linhas', id: 'lista-usuarios' }, estado.usuarios.map(function (u) {
      var euMesmo = u.id === eu.id;
      var gestor = u.papel !== 'admin';
      var situacao = u.bloqueado ? { t: 'Bloqueado', c: 'selo--vermelho' } : (u.ativo ? { t: 'Ativo', c: 'selo--verde' } : { t: 'Desativado', c: '' });
      return el('li', { classe: 'caixa caixa--compacta gestao-linha' + (gestor ? ' gestao-linha--antigo' : ''), 'data-email': u.email, 'data-papel': u.papel }, [
        el('div', { classe: 'gestao-linha__texto' }, [
          el('p', { classe: 'seminegrito gestao-linha__nome', texto: u.nome + (euMesmo && !/você/i.test(u.nome) ? ' (você)' : '') }),
          el('p', { classe: 'gestao-card__sub', texto: u.email }),
          el('div', { classe: 'card-selos' }, [
            el('span', { classe: 'selo usuario-papel', texto: gestor ? 'gestor (desativado nesta versão)' : PAPEIS.admin }),
            gestor ? null : el('span', { classe: 'selo ' + situacao.c, texto: situacao.t })
          ])
        ]),
        el('div', { classe: 'gestao-card__acoes' }, gestor ? [
          botao('botao--perigo botao--pequeno', 'Excluir', function () { excluirUsuario(u); }, { 'data-acao': 'excluir' })
        ] : [
          botao('botao--claro botao--pequeno', 'Editar', function () { janelaUsuario(u); }, { 'data-acao': 'editar' }),
          botao('botao--claro botao--pequeno', 'Redefinir senha', function () { janelaRedefinir(u); }, { 'data-acao': 'redefinir' }),
          euMesmo ? null : botao('botao--claro botao--pequeno', u.ativo ? 'Desativar' : 'Ativar', function () {
            api('salvarUsuario', { id: u.id, nome: u.nome, email: u.email, papel: 'admin', empresaId: '', ativo: !u.ativo })
              .then(function () { avisar(u.ativo ? 'Acesso desativado.' : 'Acesso ativado.', 'ok'); return carregar(); }).catch(falhou);
          }, { 'data-acao': 'alternar-ativo' }),
          euMesmo ? null : botao('botao--perigo botao--pequeno', 'Excluir', function () { excluirUsuario(u); }, { 'data-acao': 'excluir' })
        ])
      ]);
    })));
  }

  // Supabase: convite por e-mail e remoção; a senha cada um define pelo link do e-mail ("Esqueci minha senha").
  function renderizarUsuariosSupabase(box) {
    box.appendChild(cabecalhoVista('Acessos', 'Usuários',
      'Só administradores entram no painel. Convide cada pessoa por e-mail: ela recebe um link para criar a própria senha. Quem esquecer a senha usa "Esqueci minha senha" na tela de entrada.',
      [botao('botao--principal', 'Convidar administrador', function () { janelaConvite(); }, { id: 'btn-novo-usuario' })]));
    var eu = estado.usuario || {};
    box.appendChild(el('ul', { classe: 'gestao-lista gestao-lista--linhas', id: 'lista-usuarios' }, estado.usuarios.map(function (u) {
      var euMesmo = u.voce === true || (!!u.id && u.id === eu.id);
      var situacao = u.convitePendente ? { t: 'Convite pendente', c: '' } : { t: 'Ativo', c: 'selo--verde' };
      return el('li', { classe: 'caixa caixa--compacta gestao-linha', 'data-email': u.email, 'data-papel': 'admin' }, [
        avatar(u.nome || u.email, euMesmo && eu.foto ? eu.foto : u.foto, { classe: 'usuario-avatar' }),
        el('div', { classe: 'gestao-linha__texto' }, [
          el('p', { classe: 'seminegrito gestao-linha__nome', texto: (u.nome || u.email || '') + (euMesmo && !/você/i.test(u.nome || '') ? ' (você)' : '') }),
          el('p', { classe: 'gestao-card__sub', texto: u.email || '' }),
          el('div', { classe: 'card-selos' }, [
            el('span', { classe: 'selo usuario-papel', texto: PAPEIS.admin }),
            el('span', { classe: 'selo ' + situacao.c, texto: situacao.t, 'data-situacao': u.convitePendente ? 'convite' : 'ativo' })
          ])
        ]),
        el('div', { classe: 'gestao-card__acoes' }, [
          euMesmo ? null : botao('botao--perigo botao--pequeno', 'Remover', function () { excluirUsuario(u); }, { 'data-acao': 'excluir' })
        ])
      ]);
    })));
  }

  function janelaConvite() {
    var nome = campoTexto('us-nome', 'Nome', { maxlength: 80, autocomplete: 'off' });
    var email = campoTexto('us-email', 'E-mail', { type: 'email', maxlength: 120, inputmode: 'email', autocomplete: 'off' });
    abrirJanela({
      id: 'janela-usuario',
      titulo: 'Convidar administrador',
      texto: 'A pessoa recebe um e-mail com um link para criar a senha e entrar no painel. Ela vê tudo no painel.',
      botao: 'Enviar convite',
      corpo: [nome, email],
      aoConfirmar: function () {
        var dados = { nome: $('us-nome').value.trim(), email: $('us-email').value.trim() };
        if (!dados.nome) throw new Error('Informe o nome.');
        if (!dados.email) throw new Error('Informe o e-mail.');
        var chamada = metodoApi(['convidarUsuario', 'usuariosConvidar'])
          ? api(['convidarUsuario', 'usuariosConvidar'], dados)
          : api('salvarUsuario', { nome: dados.nome, email: dados.email, papel: 'admin', empresaId: '', ativo: true });
        return chamada.then(function (resp) {
          avisar(resp && resp.convidado === false
            ? 'Acesso liberado para ' + dados.email + '. A pessoa já tinha cadastro: entra com a senha dela ou usa "Esqueci minha senha".'
            : 'Convite enviado para ' + dados.email + '.', 'ok');
          return carregar();
        });
      }
    });
  }

  function excluirUsuario(u) {
    confirmar({ titulo: 'Excluir o acesso?', texto: u.nome + ' (' + u.email + ') não vai mais conseguir entrar no painel.', botao: 'Excluir acesso' }).then(function (ok) {
      if (!ok) return;
      api('excluirUsuario', u.id).then(function () { avisar('Acesso excluído.', 'ok'); return carregar(); }).catch(falhou);
    });
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

  // Criar/editar acesso: sempre administrador (o papel gestor foi desativado nesta versão).
  function janelaUsuario(u) {
    var nome = campoTexto('us-nome', 'Nome', { maxlength: 80, autocomplete: 'off' });
    var email = campoTexto('us-email', 'E-mail', { type: 'email', maxlength: 120, inputmode: 'email', autocomplete: 'off' });
    if (u) { nome.querySelector('input').value = u.nome; email.querySelector('input').value = u.email; }
    abrirJanela({
      id: 'janela-usuario',
      titulo: u ? 'Editar administrador' : 'Novo administrador',
      texto: u ? null : 'A pessoa entra com o e-mail e a senha temporária e vê tudo no painel.',
      botao: u ? 'Salvar alterações' : 'Criar acesso',
      corpo: [nome, email, u ? null : campoSenhaTemporaria('us-senha')],
      aoConfirmar: function () {
        var dados = {
          nome: $('us-nome').value.trim(),
          email: $('us-email').value.trim(),
          papel: 'admin',
          empresaId: '',
          ativo: u ? u.ativo : true
        };
        if (!dados.nome) throw new Error('Informe o nome.');
        if (!dados.email) throw new Error('Informe o e-mail.');
        var senha = u ? '' : $('us-senha').value.trim();
        if (!u && senha.length < 8) throw new Error('A senha temporária precisa ter pelo menos 8 caracteres.');
        if (u) dados.id = u.id;
        return api('salvarUsuario', dados, senha || undefined).then(function () {
          avisar(u ? 'Usuário salvo.' : 'Acesso criado. Senha temporária: ' + senha, 'ok');
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
      ['v', 'id', 'nome', 'telefone', 'idade', 'funcao', 'empresa', 'email', 'cidade', 'extras', 'vaga', 'consentimento', 'inicio', 'fim', 'duracaoSeg', 'respostas', 'validacao', 'avaliacao'].forEach(function (k) {
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

  /* ---------- Vendas (aba do admin; só quando o servidor tem a API de vendas) ---------- */

  // Venda direta só existe no Supabase e na prévia (o js/api.js legado tem o método, mas só para recusar).
  function temVendas() { return MODO_API && (SUPABASE || SIMULADA) && !!metodoApi('listarPedidos'); }
  function novoEstadoVendas() {
    return { sub: 'resumo', pedidoId: null, carregado: false, carregando: false, erro: '', pedidos: [], cupons: [], pacotes: [], resumo: null,
      filtro: { busca: '', status: '', pacote: '', periodo: '' } };
  }
  function listaDe(resp, nomes) {
    for (var i = 0; i < nomes.length; i++) if (resp && Array.isArray(resp[nomes[i]])) return resp[nomes[i]];
    return [];
  }
  function opcional(p) { return p.catch(function (e) { if (e && e.tratado) throw e; return null; }); }

  function carregarVendas() {
    var vd = estado.vd;
    if (vd.carregando) return vd.carregando;
    vd.erro = '';
    vd.carregando = Promise.all([
      api('listarPedidos', {}),
      metodoApi('listarCupons') ? opcional(api('listarCupons')) : Promise.resolve(null),
      metodoApi('listarPacotes') ? opcional(api('listarPacotes')) : Promise.resolve(null),
      metodoApi('resumoVendas') ? opcional(api('resumoVendas', 'mes')) : Promise.resolve(null)
    ]).then(function (rs) {
      vd.pedidos = listaDe(rs[0], ['pedidos', 'itens']).map(normalizarPedido);
      vd.cupons = listaDe(rs[1], ['cupons', 'itens']).map(normalizarCupom);
      var pac = listaDe(rs[2], ['pacotes', 'itens']).map(normalizarPacote);
      vd.pacotes = (pac.length ? pac : PACOTES_PADRAO.slice()).sort(function (a, b) { return a.ordem - b.ordem; });
      vd.resumo = rs[3] ? (rs[3].resumo || rs[3]) : null;
      vd.carregado = true;
    }).catch(function (e) {
      if (e && e.tratado) throw e;
      vd.erro = (e && e.message) || 'Não foi possível carregar as vendas.';
      vd.carregado = true;
    }).then(function () {
      vd.carregando = false;
      renderizarVendas();
      if (estado.abertoId) renderizarDetalhe();
    }, function () { vd.carregando = false; });
    return vd.carregando;
  }

  function irParaVendas(sub, pedidoId) {
    estado.vd.sub = sub || 'resumo';
    estado.vd.pedidoId = pedidoId || null;
    renderizarVendas();
    mostrarAba('vendas');
    root.scrollTo(0, 0);
    var h = $('vista-vendas').querySelector('h2');
    if (h) { h.setAttribute('tabindex', '-1'); h.focus(); }
  }

  var SUBABAS_VENDAS = [{ id: 'resumo', rotulo: 'Resumo' }, { id: 'pedidos', rotulo: 'Pedidos' }, { id: 'cupons', rotulo: 'Cupons' }, { id: 'pacotes', rotulo: 'Pacotes' }];
  var TITULOS_VENDAS = {
    resumo: ['Vendas', 'Vendas do Mapa DISC e conversão do resumo grátis em compra.'],
    pedidos: ['Pedidos', 'Cada compra do site. Abra um pedido para reenviar o link, liberar como cortesia ou registrar um reembolso.'],
    cupons: ['Cupons', 'Descontos para campanhas e parceiros. O link da página de venda já leva o cupom aplicado.'],
    pacotes: ['Pacotes', 'Preços que aparecem na página de venda e no checkout.']
  };

  function renderizarVendas() {
    var box = $('vista-vendas');
    if (!box || !estado.vd) return;
    limpar(box);
    if (!temVendas() || papel() !== 'admin') return;
    var vd = estado.vd;
    if (vd.sub === 'pedidos' && vd.pedidoId && vd.carregado) {
      var ped = vd.pedidos.filter(function (p) { return p.id === vd.pedidoId; })[0];
      if (ped) return renderizarPedido(box, ped);
      vd.pedidoId = null;
    }
    var t = TITULOS_VENDAS[vd.sub] || TITULOS_VENDAS.resumo;
    var acoes = [botao('botao--claro', 'Atualizar', function () { vd.carregado = false; renderizarVendas(); }, { id: 'btn-vendas-atualizar' })];
    if (vd.sub === 'cupons') acoes.push(botao('botao--laranja', 'Novo cupom', function () { janelaCupom(null); }, { id: 'btn-novo-cupom' }));
    box.appendChild(cabecalhoVista('Venda direta', t[0], t[1], acoes));
    box.appendChild(el('nav', { classe: 'subabas', id: 'vd-subabas', 'aria-label': 'Seções de vendas' }, SUBABAS_VENDAS.map(function (s) {
      var n = s.id === 'pedidos' && vd.carregado ? vd.pedidos.length : (s.id === 'cupons' && vd.carregado ? vd.cupons.length : null);
      return el('button', { type: 'button', classe: 'subaba', id: 'vd-subaba-' + s.id, 'data-subaba': s.id, 'aria-current': s.id === vd.sub ? 'page' : null,
        onclick: function () { if (vd.sub !== s.id || vd.pedidoId) irParaVendas(s.id); } }, [
        el('span', { texto: s.rotulo }), n != null ? el('span', { classe: 'subaba__n tabular', texto: String(n) }) : null
      ]);
    })));
    if (!vd.carregado) {
      box.appendChild(el('p', { classe: 'texto-suave t-corpo', id: 'vd-carregando', texto: 'Carregando…' }));
      carregarVendas();
      return;
    }
    if (vd.erro) { box.appendChild(el('p', { classe: 'aviso aviso--erro proc-aviso', id: 'vd-erro', role: 'alert', texto: vd.erro })); return; }
    if (vd.sub === 'pedidos') return renderizarPedidos(box);
    if (vd.sub === 'cupons') return renderizarCupons(box);
    if (vd.sub === 'pacotes') return renderizarPacotes(box);
    vd.sub = 'resumo';
    renderizarResumoVendas(box);
  }

  function cartaoVenda(id, rotulo, valor, nota, destaque) {
    return el('div', { classe: 'caixa caixa--compacta resumo__cartao vd-cartao' + (destaque ? ' caixa--destaque' : ''), id: id }, [
      el('span', { classe: 'resumo__rotulo', texto: rotulo }),
      el('span', { classe: 'resumo__numeros' }, [
        el('span', { classe: 'resumo__valor vd-cartao__valor valor-destaque tabular', texto: valor }),
        el('span', { classe: 'resumo__nota', texto: nota })
      ])
    ]);
  }
  function qtdVendas(n) { return n + (n === 1 ? ' venda' : ' vendas'); }

  function renderizarResumoVendas(box) {
    var vd = estado.vd;
    var gratis = estado.registros.filter(function (r) { return r.origem === 'pessoal'; }).length;
    var r = juntarResumo(vd.resumo, resumoDosPedidos(vd.pedidos, null, gratis));
    box.appendChild(el('div', { classe: 'resumo vd-resumo', id: 'vd-resumo' }, [
      cartaoVenda('vd-hoje', 'Hoje', formatarReais(r.hoje.receitaCentavos), qtdVendas(r.hoje.vendas), true),
      cartaoVenda('vd-semana', 'Últimos 7 dias', formatarReais(r.semana.receitaCentavos), qtdVendas(r.semana.vendas)),
      cartaoVenda('vd-mes', 'Este mês', formatarReais(r.mes.receitaCentavos), qtdVendas(r.mes.vendas)),
      cartaoVenda('vd-ticket', 'Ticket médio', formatarReais(r.ticketMedioCentavos), 'por venda paga')
    ]));
    box.appendChild(el('div', { classe: 'resumo vd-resumo', id: 'vd-resumo-2' }, [
      cartaoVenda('vd-aguardando', 'Aguardando pagamento', String(r.aguardando), r.aguardando === 1 ? 'pedido sem confirmação' : 'pedidos sem confirmação'),
      cartaoVenda('vd-conversao', 'Conversão resumo grátis → compra', textoPercentual(r.conversao),
        r.gratis == null ? 'sem dados de resumos grátis' : r.compras + ' compra' + (r.compras === 1 ? '' : 's') + ' de ' + r.gratis + ' resumo' + (r.gratis === 1 ? '' : 's') + ' grátis' + (r.periodo === 'mes' ? ' no mês' : '')),
      cartaoVenda('vd-cortesias', 'Cortesias', String(r.cortesias), 'liberadas sem pagamento')
    ]));
    var sec = el('section', { classe: 'caixa vd-ultimos-caixa' }, [
      el('div', { classe: 'gestao-linha' }, [
        el('h3', { classe: 'caixa__titulo', texto: 'Últimos pedidos' }),
        botao('botao--claro botao--pequeno', 'Ver todos os pedidos', function () { irParaVendas('pedidos'); }, { id: 'btn-vd-todos' })
      ])
    ]);
    var ul = el('ul', { classe: 'vd-linhas', id: 'vd-ultimos' });
    if (!r.ultimos.length) ul.appendChild(el('li', { classe: 'vazio' }, el('p', { classe: 'vazio__texto', texto: 'Nenhum pedido ainda. Eles aparecem aqui assim que alguém comprar pelo site.' })));
    r.ultimos.forEach(function (p) { ul.appendChild(linhaPedido(p)); });
    sec.appendChild(ul);
    box.appendChild(sec);
  }

  function seloPedido(p) {
    return el('span', { classe: 'selo vd-status ' + (CLASSE_PEDIDO[p.status] || ''), 'data-status': p.status, texto: STATUS_PEDIDO[p.status] || p.status });
  }

  function linhaPedido(p) {
    var pacotes = estado.vd.pacotes;
    return el('li', { classe: 'vd-linha', 'data-id': p.id, 'data-status': p.status, 'data-pacote': p.pacote }, [
      el('button', { type: 'button', classe: 'vd-linha__abrir', 'aria-label': 'Abrir pedido de ' + (p.nome || p.email || 'cliente'), onclick: function () { irParaVendas('pedidos', p.id); } }, [
        el('span', { classe: 'vd-linha__quem' }, [
          el('span', { classe: 'seminegrito vd-linha__nome', texto: p.nome || '(sem nome)' }),
          el('span', { classe: 'texto-suave t-rotulo vd-linha__email', texto: p.email || '—' })
        ]),
        el('span', { classe: 't-rotulo vd-linha__pacote', texto: nomePacote(p.pacote, pacotes) + (p.cupom ? ' · cupom ' + p.cupom : '') }),
        el('span', { classe: 't-rotulo texto-suave tabular vd-linha__data', texto: formatarData(p.criadoEm) }),
        el('span', { classe: 'seminegrito tabular vd-linha__valor', texto: formatarReais(p.valorCentavos) }),
        seloPedido(p)
      ])
    ]);
  }

  function renderizarPedidos(box) {
    var vd = estado.vd;
    var f = vd.filtro;
    var busca = el('input', { id: 'vd-busca', classe: 'entrada', type: 'search', placeholder: 'Nome, e-mail, cupom ou nº do pedido…', value: f.busca });
    var escStatus = criarEscolha({ id: 'vd-filtro-status', rotulo: 'Situação', prefixo: 'Situação', valor: f.status,
      opcoes: [{ valor: '', rotulo: 'Todas' }].concat(Object.keys(STATUS_PEDIDO).map(function (s) { return { valor: s, rotulo: STATUS_PEDIDO[s] }; })) });
    var escPacote = criarEscolha({ id: 'vd-filtro-pacote', rotulo: 'Pacote', prefixo: 'Pacote', valor: f.pacote,
      opcoes: [{ valor: '', rotulo: 'Todos' }].concat(vd.pacotes.filter(function (p) { return p.chave !== 'gratis'; }).map(function (p) { return { valor: p.chave, rotulo: p.nome }; })) });
    var escPeriodo = criarEscolha({ id: 'vd-filtro-periodo', rotulo: 'Período', prefixo: 'Período', valor: f.periodo,
      opcoes: [{ valor: '', rotulo: 'Tudo' }].concat(Object.keys(PERIODOS_VENDAS).map(function (k) { return { valor: k, rotulo: PERIODOS_VENDAS[k] }; })) });
    box.appendChild(el('form', { classe: 'filtros', id: 'vd-filtros', role: 'search', onsubmit: function (e) { e.preventDefault(); } }, [
      el('label', { classe: 'filtros__busca' }, [
        el('span', { classe: 'visualmente-oculto', texto: 'Buscar pedido' }),
        (function () { var s = svg('svg', { class: 'filtros__lupa', viewBox: '0 0 24 24', 'aria-hidden': 'true' }); s.appendChild(svg('circle', { cx: 11, cy: 11, r: 7 })); s.appendChild(svg('path', { d: 'm20 20-3.5-3.5' })); return s; })(),
        busca
      ]),
      el('div', { classe: 'filtros__escolhas', 'data-qtd': '3' }, [escStatus.caixa, escPacote.caixa, escPeriodo.caixa])
    ]));
    var contagem = el('p', { classe: 't-rotulo texto-suave', id: 'vd-contagem', 'aria-live': 'polite' });
    var ul = el('ul', { classe: 'vd-linhas caixa', id: 'vd-lista-pedidos' });
    box.appendChild(contagem);
    box.appendChild(ul);
    function desenhar() {
      limpar(ul);
      var itens = filtrarPedidos(vd.pedidos, f);
      var soma = itens.filter(function (p) { return p.status === 'pago'; }).reduce(function (s, p) { return s + p.valorCentavos; }, 0);
      contagem.textContent = itens.length + ' de ' + vd.pedidos.length + ' pedido' + (vd.pedidos.length === 1 ? '' : 's') + ' · ' + formatarReais(soma) + ' pagos';
      if (!itens.length) {
        ul.appendChild(el('li', { classe: 'vazio' }, el('p', { classe: 'vazio__texto', texto: vd.pedidos.length ? 'Nenhum pedido com esses filtros.' : 'Nenhum pedido ainda.' })));
        return;
      }
      itens.forEach(function (p) { ul.appendChild(linhaPedido(p)); });
    }
    busca.addEventListener('input', function () { f.busca = busca.value; desenhar(); });
    escStatus.botao.addEventListener('change', function () { f.status = escStatus.botao.value; desenhar(); });
    escPacote.botao.addEventListener('change', function () { f.pacote = escPacote.botao.value; desenhar(); });
    escPeriodo.botao.addEventListener('change', function () { f.periodo = escPeriodo.botao.value; desenhar(); });
    desenhar();
  }

  function trocarStatusPedido(p, status, msgOk) {
    return api('atualizarPedido', p.id, { status: status }).then(function (resp) {
      var novo = resp && resp.pedido ? normalizarPedido(resp.pedido) : null;
      estado.vd.pedidos = estado.vd.pedidos.map(function (x) {
        if (x.id !== p.id) return x;
        if (novo && novo.id) return novo;
        var c = {}; for (var k in x) c[k] = x[k];
        c.status = status;
        if (status === 'estornado') c.reembolsadoEm = new Date().toISOString();
        return c;
      });
      renderizarVendas();
      if (estado.abertoId) renderizarDetalhe();
      avisar(msgOk, 'ok');
    }).catch(falhou);
  }

  function liberarCortesia(p) {
    confirmar({ titulo: 'Liberar como cortesia?', botao: 'Liberar relatório', classeBotao: 'botao--principal',
      texto: 'O relatório de ' + (p.nome || p.email || 'cliente') + ' fica liberado sem pagamento. Use para parceiros, testes ou quando o pagamento foi feito por fora.' })
      .then(function (ok) { if (ok) trocarStatusPedido(p, 'cortesia', 'Pedido liberado como cortesia. Envie o link ao cliente.'); });
  }

  function cancelarPedido(p) {
    confirmar({ titulo: 'Cancelar este pedido?', botao: 'Cancelar pedido', texto: 'Use quando a pessoa desistiu ou o Pix venceu. Nada é cobrado; dá para liberar como cortesia depois.' })
      .then(function (ok) { if (ok) trocarStatusPedido(p, 'cancelado', 'Pedido cancelado.'); });
  }

  function marcarReembolsado(p) {
    var extra = el('div', { classe: 'aviso vd-lembrete', id: 'vd-lembrete-asaas' }, [
      el('p', { classe: 'seminegrito', texto: 'Lembrete: devolva o dinheiro no Asaas.' }),
      el('p', { texto: 'Marcar aqui só bloqueia o relatório e registra o reembolso. O estorno do valor (' + formatarReais(p.valorCentavos) + ') é feito no painel do Asaas' +
        (p.asaasCobrancaId ? ', cobrança ' + p.asaasCobrancaId : '') + '.' }),
      el('a', { href: ASAAS_PAINEL, target: '_blank', rel: 'noopener noreferrer', classe: 'vd-link', id: 'vd-link-asaas', texto: 'Abrir o Asaas' })
    ]);
    confirmar({ titulo: 'Marcar este pedido como reembolsado?', botao: 'Marcar reembolsado', extra: extra,
      texto: (p.nome || p.email || 'O cliente') + ' perde o acesso ao relatório completo. Garantia de 7 dias: devolva o valor integral.' })
      .then(function (ok) { if (ok) trocarStatusPedido(p, 'estornado', 'Pedido marcado como reembolsado. Confira o estorno no Asaas.'); });
  }

  function renderizarPedido(box, p) {
    var liberado = p.status === 'pago' || p.status === 'cortesia';
    var url = p.tokenAcesso ? linkMeuRelatorio(root.location.href, p.tokenAcesso) : '';
    var resposta = p.respostaId ? acharRegistro(p.respostaId) : null;
    box.appendChild(cabecalhoVista('Pedido', p.nome || p.email || 'Pedido', 'Pedido ' + (p.id.slice(0, 8) || '—') + ' · criado em ' + formatarData(p.criadoEm), [
      botao('botao--claro', '← Voltar aos pedidos', function () { irParaVendas('pedidos'); }, { id: 'btn-vd-voltar' }),
      p.status === 'aguardando' || p.status === 'cancelado' || p.status === 'estornado' ? botao('botao--principal', 'Liberar como cortesia', function () { liberarCortesia(p); }, { id: 'btn-vd-cortesia' }) : null,
      p.status === 'aguardando' ? botao('botao--claro', 'Cancelar pedido', function () { cancelarPedido(p); }, { id: 'btn-vd-cancelar' }) : null,
      p.status === 'pago' ? botao('botao--perigo', 'Marcar reembolsado', function () { marcarReembolsado(p); }, { id: 'btn-vd-reembolso' }) : null
    ]));
    var dl = el('dl', { classe: 'det-dl', id: 'vd-pedido-dados' }, [
      el('div', null, [el('dt', { texto: 'Situação' }), el('dd', null, seloPedido(p))]),
      el('div', null, [el('dt', { texto: 'Valor' }), el('dd', { classe: 'seminegrito', id: 'vd-pedido-valor', texto: formatarReais(p.valorCentavos) })]),
      el('div', null, [el('dt', { texto: 'Pacote' }), el('dd', { texto: nomePacote(p.pacote, estado.vd.pacotes) })]),
      el('div', null, [el('dt', { texto: 'Cupom' }), el('dd', { texto: p.cupom || '—' })]),
      el('div', null, [el('dt', { texto: 'E-mail' }), el('dd', { texto: p.email || '—' })]),
      el('div', null, [el('dt', { texto: 'WhatsApp' }), el('dd', null, p.telefone ? linkTelefone({ telefone: p.telefone, nome: p.nome }) : '—')]),
      el('div', null, [el('dt', { texto: 'Forma de pagamento' }), el('dd', { texto: ({ pix: 'Pix', cartao: 'Cartão', boleto: 'Boleto', cupom: 'Cupom (100%)', manual: 'Liberado no painel' })[p.metodo] || p.metodo || '—' })]),
      el('div', null, [el('dt', { texto: 'Pago em' }), el('dd', { texto: formatarData(p.pagoEm) })]),
      p.reembolsadoEm ? el('div', null, [el('dt', { texto: 'Reembolsado em' }), el('dd', { texto: formatarData(p.reembolsadoEm) })]) : null,
      p.asaasCobrancaId || p.faturaUrl ? el('div', null, [el('dt', { texto: 'Cobrança no Asaas' }), el('dd', { classe: 'tabular' }, [
        p.asaasCobrancaId || '',
        p.faturaUrl ? el('a', { classe: 'vd-link vd-link--fatura', id: 'vd-link-fatura', href: p.faturaUrl, target: '_blank', rel: 'noopener noreferrer', texto: (p.asaasCobrancaId ? ' · ' : '') + 'Abrir a cobrança' }) : null
      ])]) : null
    ]);
    var acesso = el('section', { classe: 'caixa', id: 'vd-pedido-acesso' }, [el('h3', { classe: 'caixa__titulo', texto: 'Link do relatório' })]);
    if (url && liberado) {
      acesso.appendChild(el('p', { classe: 'texto-medio t-corpo', texto: 'Reenvie este link se o cliente perdeu o acesso. Ele abre o relatório completo, sem senha.' }));
      acesso.appendChild(el('p', { classe: 'av-link', id: 'vd-pedido-link', texto: url }));
      var wa = p.telefone ? linkWhatsApp(p.telefone) : '';
      acesso.appendChild(el('div', { classe: 'gestao-card__acoes' }, [
        botao('botao--claro botao--pequeno', 'Copiar link', function () { copiar(url, 'Link do relatório copiado.'); }, { id: 'btn-vd-copiar-link' }),
        botao('botao--claro botao--pequeno', 'Copiar mensagem', function () { copiar(mensagemReenvio(p, url), 'Mensagem copiada. Cole no WhatsApp ou no e-mail.'); }, { id: 'btn-vd-copiar-msg' }),
        wa ? el('a', { classe: 'botao botao--principal botao--pequeno', id: 'btn-vd-whatsapp', target: '_blank', rel: 'noopener noreferrer',
          href: wa + '?text=' + encodeURIComponent(mensagemReenvio(p, url)), texto: 'Enviar no WhatsApp' }) : null,
        el('a', { classe: 'botao botao--claro botao--pequeno', id: 'btn-vd-abrir-relatorio', href: url, target: '_blank', rel: 'noopener noreferrer', texto: 'Abrir relatório' })
      ]));
    } else if (liberado) {
      // O painel não recebe o token do cliente: orienta a pessoa a pedir o link pelo e-mail da compra.
      var urlRec = linkRecuperar(root.location.href);
      acesso.querySelector('h3').textContent = 'Acesso do cliente';
      acesso.appendChild(el('p', { classe: 'texto-medio t-corpo', id: 'vd-pedido-orientacao', texto: 'Se o cliente perdeu o link, ele pede de novo em "Recuperar meu relatório" com o e-mail da compra (' + (p.email || 'o e-mail do pedido') + ').' }));
      acesso.appendChild(el('p', { classe: 'av-link', id: 'vd-pedido-recuperar', texto: urlRec }));
      var wa2 = p.telefone ? linkWhatsApp(p.telefone) : '';
      acesso.appendChild(el('div', { classe: 'gestao-card__acoes' }, [
        botao('botao--claro botao--pequeno', 'Copiar mensagem de orientação', function () { copiar(mensagemOrientacao(p, urlRec), 'Mensagem copiada. Cole no WhatsApp ou no e-mail.'); }, { id: 'btn-vd-copiar-orientacao' }),
        wa2 ? el('a', { classe: 'botao botao--principal botao--pequeno', id: 'btn-vd-whatsapp', target: '_blank', rel: 'noopener noreferrer',
          href: wa2 + '?text=' + encodeURIComponent(mensagemOrientacao(p, urlRec)), texto: 'Enviar no WhatsApp' }) : null
      ]));
    } else {
      acesso.appendChild(el('p', { classe: 'texto-suave t-corpo', id: 'vd-pedido-sem-link', texto: p.status === 'estornado' ? 'Pedido reembolsado: o relatório completo está bloqueado.'
        : (p.status === 'aguardando' ? 'O link é liberado quando o pagamento for confirmado (ou ao liberar como cortesia).'
          : 'Pedido cancelado: nada foi cobrado.') }));
      if (p.status === 'aguardando' && p.faturaUrl) acesso.appendChild(el('div', { classe: 'gestao-card__acoes' }, [
        botao('botao--claro botao--pequeno', 'Copiar link de pagamento (cartão)', function () { copiar(p.faturaUrl, 'Link de pagamento copiado.'); }, { id: 'btn-vd-copiar-fatura' })
      ]));
    }
    if (p.status === 'estornado') acesso.appendChild(el('p', { classe: 't-nota texto-suave', texto: 'Confira se o estorno foi feito no Asaas.' }));
    var quem = el('section', { classe: 'caixa', id: 'vd-pedido-resposta' }, [el('h3', { classe: 'caixa__titulo', texto: 'Teste respondido' })]);
    if (resposta) {
      quem.appendChild(el('p', { classe: 't-corpo' }, [
        badgePerfil(resposta), ' ',
        el('span', { texto: resposta.calc ? NOMES[resposta.calc.primario] + ' / ' + NOMES[resposta.calc.secundario] : '' })
      ]));
      quem.appendChild(el('p', { classe: 't-rotulo texto-suave', texto: 'Respondido em ' + formatarData(resposta.fim || resposta.recebidoEm) }));
      quem.appendChild(botao('botao--claro botao--pequeno', 'Ver em Participantes', function () { abrirDetalhe(resposta.id); }, { id: 'btn-vd-ver-resposta' }));
    } else {
      quem.appendChild(el('p', { classe: 'texto-suave t-corpo', texto: p.respostaId ? 'A resposta deste pedido não está na lista de participantes.' : 'Pedido sem resposta ligada.' }));
    }
    box.appendChild(el('div', { classe: 'vd-pedido-grade' }, [
      el('section', { classe: 'caixa', id: 'vd-pedido-ficha' }, [el('h3', { classe: 'caixa__titulo', texto: 'Dados do pedido' }), dl]),
      el('div', { classe: 'vd-pedido-lado' }, [acesso, quem])
    ]));
  }

  /* Cupons */

  function renderizarCupons(box) {
    var vd = estado.vd;
    var ul = el('ul', { classe: 'gestao-lista vd-cupons', id: 'vd-lista-cupons' });
    if (!vd.cupons.length) ul.appendChild(el('li', { classe: 'caixa vazio' }, el('p', { classe: 'vazio__texto', texto: 'Nenhum cupom ainda. Crie um para a campanha de lançamento ou para parceiros.' })));
    vd.cupons.slice().sort(function (a, b) { return (b.ativo - a.ativo) || a.codigo.localeCompare(b.codigo); }).forEach(function (c) {
      var link = linkLandingCupom(root.location.href, c.codigo);
      var esgotado = c.usosMax != null && c.usos >= c.usosMax;
      var hoje = new Date(); var vencido = c.validoAte && c.validoAte < (hoje.getFullYear() + '-' + ('0' + (hoje.getMonth() + 1)).slice(-2) + '-' + ('0' + hoje.getDate()).slice(-2));
      ul.appendChild(el('li', { classe: 'caixa gestao-card vd-cupom' + (c.ativo ? '' : ' vd-cupom--inativo'), 'data-codigo': c.codigo, 'data-ativo': c.ativo ? 'sim' : 'nao' }, [
        el('div', { classe: 'gestao-card__topo' }, [
          el('div', { classe: 'gestao-card__titulo-area' }, [
            el('p', { classe: 'gestao-card__titulo negrito tabular vd-cupom__codigo', texto: c.codigo }),
            el('p', { classe: 'gestao-card__sub vd-cupom__desconto', texto: textoCupom(c) })
          ]),
          el('span', { classe: 'selo ' + (!c.ativo ? '' : (esgotado || vencido ? 'selo--vermelho' : 'selo--verde')), texto: !c.ativo ? 'Desativado' : (esgotado ? 'Esgotado' : (vencido ? 'Vencido' : 'Ativo')) })
        ]),
        el('dl', { classe: 'det-dl vd-cupom__dl' }, [
          el('div', null, [el('dt', { texto: 'Usos' }), el('dd', { classe: 'vd-cupom__usos', texto: c.usos + (c.usosMax != null ? ' de ' + c.usosMax : ' (sem limite)') })]),
          el('div', null, [el('dt', { texto: 'Validade' }), el('dd', { texto: c.validoAte ? c.validoAte.split('-').reverse().join('/') : 'Sem validade' })]),
          el('div', { classe: 'det-dl__largo' }, [el('dt', { texto: 'Vale para' }), el('dd', { texto: c.pacotes.length ? c.pacotes.map(function (k) { return nomePacote(k, vd.pacotes); }).join(', ') : 'Todos os pacotes pagos' })])
        ]),
        el('p', { classe: 'av-link vd-cupom__link', texto: link }),
        el('div', { classe: 'gestao-card__acoes' }, [
          botao('botao--claro botao--pequeno', 'Copiar link da página', function () { copiar(link, 'Link com o cupom ' + c.codigo + ' copiado.'); }, { 'data-acao': 'copiar-link' }),
          botao('botao--claro botao--pequeno', 'Editar', function () { janelaCupom(c); }, { 'data-acao': 'editar' }),
          botao('botao--claro botao--pequeno', c.ativo ? 'Desativar' : 'Reativar', function () { alternarCupom(c); }, { 'data-acao': c.ativo ? 'desativar' : 'reativar' }),
          metodoApi('excluirCupom') && !c.usos ? botao('botao--perigo botao--pequeno', 'Excluir', function () { excluirCupom(c); }, { 'data-acao': 'excluir' }) : null
        ])
      ]));
    });
    box.appendChild(ul);
  }

  function salvarCupomApi(dados, msgOk) {
    return api('salvarCupom', dados).then(function (resp) {
      var c = normalizarCupom(resp && resp.cupom ? resp.cupom : dados);
      var achou = false;
      estado.vd.cupons = estado.vd.cupons.map(function (x) { if (x.codigo === c.codigo) { achou = true; return c; } return x; });
      if (!achou) estado.vd.cupons.push(c);
      renderizarVendas();
      avisar(msgOk, 'ok');
    });
  }

  function dadosCupom(c) {
    return { codigo: c.codigo, tipo: c.tipo, valor: c.valor, usosMax: c.usosMax, validoAte: c.validoAte || null, pacotes: c.pacotes.slice(), ativo: c.ativo };
  }

  function alternarCupom(c) {
    var d = dadosCupom(c);
    d.ativo = !c.ativo;
    salvarCupomApi(d, d.ativo ? 'Cupom ' + c.codigo + ' reativado.' : 'Cupom ' + c.codigo + ' desativado.').catch(falhou);
  }

  function excluirCupom(c) {
    confirmar({ titulo: 'Excluir o cupom ' + c.codigo + '?', texto: 'O cupom some da lista e o link com ele deixa de dar desconto.', botao: 'Excluir' }).then(function (ok) {
      if (!ok) return;
      api('excluirCupom', c.codigo).then(function () {
        estado.vd.cupons = estado.vd.cupons.filter(function (x) { return x.codigo !== c.codigo; });
        renderizarVendas();
        avisar('Cupom excluído.', 'ok');
      }).catch(falhou);
    });
  }

  function janelaCupom(c) {
    var novo = !c;
    var atual = c || { codigo: '', tipo: 'percentual', valor: 0, usosMax: null, validoAte: '', pacotes: [], ativo: true };
    var escTipo = criarEscolha({ id: 'cup-tipo', rotulo: 'Tipo do desconto', rotuloId: 'cup-tipo-rotulo', valor: atual.tipo, classe: 'escolha--campo',
      opcoes: [{ valor: 'percentual', rotulo: 'Porcentagem (%)' }, { valor: 'valor', rotulo: 'Valor fixo (R$)' }] });
    var valorTxt = atual.valor ? (atual.tipo === 'valor' ? textoDeCentavos(atual.valor) : String(atual.valor)) : '';
    var rotuloValor = el('span', { classe: 'campo__rotulo', id: 'cup-valor-rotulo' });
    var campoValor = el('label', { classe: 'campo', for: 'cup-valor' }, [rotuloValor,
      el('input', { id: 'cup-valor', classe: 'entrada', type: 'text', inputmode: 'decimal', autocomplete: 'off', value: valorTxt })]);
    function rotular() { rotuloValor.textContent = escTipo.botao.value === 'valor' ? 'Desconto em R$ (ex.: 10,00)' : 'Desconto em % (100 = grátis)'; }
    escTipo.botao.addEventListener('change', rotular);
    rotular();
    var pacotesPagos = estado.vd.pacotes.filter(function (p) { return p.chave !== 'gratis'; });
    abrirJanela({
      id: 'form-cupom', titulo: novo ? 'Novo cupom' : 'Editar cupom ' + atual.codigo, botao: novo ? 'Criar cupom' : 'Salvar',
      texto: 'Um cupom de 100% libera o relatório sem pagamento.',
      corpo: [
        campoTexto('cup-codigo', 'Código (o cliente digita no checkout)', { value: atual.codigo, placeholder: 'LANCAMENTO', disabled: novo ? null : true, autocapitalize: 'characters', maxlength: '30' }),
        el('div', { classe: 'form-grade vd-form-2' }, [campoEscolha('Tipo do desconto', escTipo, 'cup-tipo-rotulo'), campoValor]),
        el('div', { classe: 'form-grade vd-form-2' }, [
          campoTexto('cup-usos', 'Limite de usos (vazio = sem limite)', { type: 'number', min: '1', step: '1', inputmode: 'numeric', value: atual.usosMax == null ? '' : String(atual.usosMax) }),
          campoTexto('cup-validade', 'Válido até (vazio = sem validade)', { type: 'date', value: atual.validoAte || '' })
        ]),
        el('fieldset', { classe: 'campo vd-pacotes-campo' }, [
          el('legend', { classe: 'campo__rotulo', texto: 'Vale para (nenhum marcado = todos os pacotes pagos)' })
        ].concat(pacotesPagos.map(function (p) { return campoMarcar('cup-pac-' + p.chave, p.nome, atual.pacotes.indexOf(p.chave) !== -1); })))
      ],
      aoConfirmar: function () {
        var tipo = escTipo.botao.value;
        var bruto = $('cup-valor').value.trim();
        var valor = tipo === 'valor' ? centavosDeTexto(bruto) : (bruto === '' ? null : Number(bruto.replace(',', '.')));
        var usos = $('cup-usos').value.trim();
        var d = {
          codigo: String($('cup-codigo').value || '').trim().toUpperCase(),
          tipo: tipo, valor: valor,
          usosMax: usos === '' ? null : Number(usos),
          validoAte: $('cup-validade').value || null,
          pacotes: pacotesPagos.filter(function (p) { return $('cup-pac-' + p.chave).checked; }).map(function (p) { return p.chave; }),
          ativo: atual.ativo !== false
        };
        var erro = validarCupom(d);
        if (erro) throw new Error(erro);
        if (novo && estado.vd.cupons.some(function (x) { return x.codigo === d.codigo; })) throw new Error('Já existe um cupom com este código.');
        return salvarCupomApi(d, novo ? 'Cupom ' + d.codigo + ' criado.' : 'Cupom ' + d.codigo + ' salvo.');
      }
    });
  }

  /* Pacotes */

  function lancamentoValido(p) {
    if (p.precoLancamentoCentavos == null) return false;
    if (!p.lancamentoAte) return true;
    var h = new Date();
    return p.lancamentoAte >= h.getFullYear() + '-' + ('0' + (h.getMonth() + 1)).slice(-2) + '-' + ('0' + h.getDate()).slice(-2);
  }

  function renderizarPacotes(box) {
    var vd = estado.vd;
    box.appendChild(el('ul', { classe: 'gestao-lista vd-pacotes', id: 'vd-lista-pacotes' }, vd.pacotes.map(function (p) {
      var lanc = lancamentoValido(p);
      return el('li', { classe: 'caixa gestao-card vd-pacote', 'data-chave': p.chave, 'data-ativo': p.ativo ? 'sim' : 'nao' }, [
        el('div', { classe: 'gestao-card__topo' }, [
          el('div', { classe: 'gestao-card__titulo-area' }, [
            el('p', { classe: 'sobretitulo', texto: 'Ordem ' + p.ordem + ' · ' + p.chave }),
            el('p', { classe: 'gestao-card__titulo seminegrito', texto: p.nome })
          ]),
          el('span', { classe: 'selo ' + (p.ativo ? 'selo--verde' : ''), texto: p.ativo ? 'À venda' : 'Fora do site' })
        ]),
        el('p', { classe: 'vd-pacote__preco' }, p.chave === 'gratis' ? [el('span', { classe: 'vd-pacote__valor tabular', texto: 'Grátis' })] : [
          el('span', { classe: 'vd-pacote__valor tabular', texto: formatarReais(lanc ? p.precoLancamentoCentavos : p.precoCentavos) }),
          lanc ? el('s', { classe: 'vd-pacote__antes tabular texto-suave', texto: formatarReais(p.precoCentavos) }) : null
        ]),
        el('p', { classe: 't-rotulo texto-suave vd-pacote__nota', texto: p.chave === 'gratis' ? 'Resumo mostrado ao terminar o teste.'
          : (p.precoLancamentoCentavos == null ? 'Sem preço de lançamento.'
            : (lanc ? 'Preço de lançamento' + (p.lancamentoAte ? ' até ' + p.lancamentoAte.split('-').reverse().join('/') : ' (sem data de fim)') + '; depois, ' + formatarReais(p.precoCentavos) + '.'
              : 'Lançamento encerrado em ' + p.lancamentoAte.split('-').reverse().join('/') + '.')) }),
        el('div', { classe: 'gestao-card__acoes' }, [
          botao('botao--claro botao--pequeno', 'Editar', function () { janelaPacote(p); }, { 'data-acao': 'editar', disabled: metodoApi('salvarPacote') ? null : true })
        ])
      ]);
    })));
  }

  function janelaPacote(p) {
    var gratis = p.chave === 'gratis';
    abrirJanela({
      id: 'form-pacote', titulo: 'Editar pacote', botao: 'Salvar',
      texto: gratis ? 'O resumo grátis não tem preço; dá para mudar o nome, a ordem e se aparece no site.' : 'Valores em reais, com centavos. O preço de lançamento aparece com o preço normal riscado até a data de fim.',
      corpo: [
        campoTexto('pac-nome', 'Nome', { value: p.nome, maxlength: '60' }),
        gratis ? null : el('div', { classe: 'form-grade vd-form-2' }, [
          campoTexto('pac-preco', 'Preço (R$)', { value: textoDeCentavos(p.precoCentavos), inputmode: 'decimal', placeholder: '39,00' }),
          campoTexto('pac-lancamento', 'Preço de lançamento (R$, vazio = sem)', { value: p.precoLancamentoCentavos == null ? '' : textoDeCentavos(p.precoLancamentoCentavos), inputmode: 'decimal', placeholder: '29,00' })
        ]),
        el('div', { classe: 'form-grade vd-form-2' }, [
          gratis ? null : campoTexto('pac-lancamento-ate', 'Lançamento até (vazio = sem data)', { type: 'date', value: p.lancamentoAte || '' }),
          campoTexto('pac-ordem', 'Ordem na página', { type: 'number', step: '1', inputmode: 'numeric', value: String(p.ordem) })
        ]),
        campoMarcar('pac-ativo', 'À venda (aparece no site)', p.ativo)
      ],
      aoConfirmar: function () {
        var lanc = gratis ? '' : $('pac-lancamento').value.trim();
        var d = {
          chave: p.chave,
          nome: $('pac-nome').value.trim(),
          precoCentavos: gratis ? 0 : centavosDeTexto($('pac-preco').value),
          precoLancamentoCentavos: gratis || lanc === '' ? null : centavosDeTexto(lanc),
          lancamentoAte: gratis ? null : ($('pac-lancamento-ate').value || null),
          ativo: $('pac-ativo').checked,
          ordem: Number($('pac-ordem').value || 0)
        };
        if (!gratis && lanc !== '' && d.precoLancamentoCentavos == null) throw new Error('Preço de lançamento inválido (ex.: 29,00).');
        var erro = validarPacote(d);
        if (erro) throw new Error(erro);
        return api('salvarPacote', d).then(function (resp) {
          var novo = normalizarPacote(resp && resp.pacote ? resp.pacote : d);
          estado.vd.pacotes = estado.vd.pacotes.map(function (x) { return x.chave === novo.chave ? novo : x; }).sort(function (a, b) { return a.ordem - b.ordem; });
          renderizarVendas();
          avisar('Pacote "' + novo.nome + '" salvo.', 'ok');
        });
      }
    });
  }

  // Detalhe do participante (origem 'pessoal'): o pedido ligado a esta resposta.
  function blocoPedidoDetalhe(r) {
    if (r.origem !== 'pessoal' || !temVendas()) return null;
    var box = el('div', { classe: 'det-pedido', id: 'det-pedido' }, [
      el('h4', { classe: 'det-pedido__titulo seminegrito', texto: 'Compra' }),
      r.email ? el('p', { classe: 't-rotulo texto-medio', id: 'det-pedido-email', texto: 'E-mail: ' + r.email }) : null
    ]);
    if (!estado.vd.carregado) {
      box.appendChild(el('p', { classe: 't-rotulo texto-suave', texto: 'Carregando o pedido…' }));
      carregarVendas();
      return box;
    }
    var peds = estado.vd.pedidos.filter(function (p) { return p.respostaId === String(r.id); });
    if (!peds.length) { box.appendChild(el('p', { classe: 't-rotulo texto-suave', id: 'det-pedido-nenhum', texto: 'Só o resumo grátis (nenhum pedido ligado a esta resposta).' })); return box; }
    peds.forEach(function (p) {
      box.appendChild(el('p', { classe: 'det-pedido__linha', 'data-id': p.id }, [
        seloPedido(p), ' ',
        el('span', { classe: 't-rotulo', texto: nomePacote(p.pacote, estado.vd.pacotes) + ' · ' + formatarReais(p.valorCentavos) + ' · ' + formatarData(p.criadoEm) + ' ' }),
        el('button', { type: 'button', classe: 'link-botao vd-link-pedido seminegrito', 'data-acao': 'abrir-pedido', texto: 'Abrir pedido', onclick: function () { irParaVendas('pedidos', p.id); } })
      ]));
    });
    return box;
  }

  /* ---------- Conexões (aba do admin: estado de cada integração, com "Testar") ---------- */

  function temConexoes() { return MODO_API && (SUPABASE || SIMULADA) && !!metodoApi('diagnosticoConexoes'); }
  function novoEstadoConexoes() { return { diag: null, testes: {}, testando: {}, carregado: false, rodando: false, erro: '' }; }
  // Volta da InfinitePay depois de pagar o link de teste: admin.html?conexoes=teste&order_nsu=…&transaction_nsu=…&slug=…
  var RETORNO_CONEXOES = (function () {
    try {
      var q = new URLSearchParams(root.location.search || '');
      if (q.get('conexoes') !== 'teste') return null;
      var r = { pedidoId: q.get('order_nsu') || '', transactionNsu: q.get('transaction_nsu') || '', slug: q.get('slug') || '' };
      if (root.history && root.history.replaceState) root.history.replaceState(null, '', root.location.pathname + root.location.hash);
      return r;
    } catch (e) { return null; }
  })();
  var CARTOES_DIAGNOSTICO = ['site', 'login', 'infinitepay', 'email', 'despertador'];
  var ALVO_DO_CARTAO = { banco: 'banco', funcoes: 'funcoes', asaas: 'asaas', clickup: 'clickup', ia: 'ia' };

  function erroComoTeste(alvo, e) {
    return { ok: true, alvo: alvo, sucesso: false, mensagem: (e && e.message) || 'O teste falhou. Tente de novo.', em: new Date().toISOString() };
  }
  function carregarDiagnostico() {
    var cx = estado.cx;
    return api('diagnosticoConexoes').then(function (d) {
      cx.diag = d; cx.erro = ''; cx.carregado = true;
    }, function (e) {
      if (e && e.tratado) throw e;
      cx.erro = (e && e.message) || 'Não foi possível conferir as conexões.'; cx.carregado = true;
    });
  }
  function rodarTeste(alvo, opcoes) {
    var cx = estado.cx;
    return api('testarConexao', alvo, opcoes || {}).then(function (r) { cx.testes[alvo] = r; return r; }, function (e) {
      if (e && e.tratado) throw e;
      cx.testes[alvo] = erroComoTeste(alvo, e);
      return cx.testes[alvo];
    });
  }
  // Marca os cartões como "Testando…", espera a promessa e redesenha.
  function comTestando(ids, promessa) {
    var cx = estado.cx;
    ids.forEach(function (id) { cx.testando[id] = true; });
    renderizarConexoes();
    return promessa.then(null, function (e) { if (e && e.tratado) throw e; }).then(function () {
      ids.forEach(function (id) { delete cx.testando[id]; });
      renderizarConexoes();
    });
  }
  function testarTudo() {
    var cx = estado.cx;
    if (cx.rodando) return cx.rodando;
    var ids = cartoesConexoes(cx.diag, cx.testes, {}).map(function (c) { return c.id; });
    if (!ids.length) ids = ['site', 'banco', 'login', 'funcoes', 'infinitepay', 'asaas', 'email', 'clickup', 'ia', 'despertador'];
    cx.testes = {};
    cx.rodando = true; // antes de redesenhar: o desenho não pode disparar outro "Testar tudo"
    cx.rodando = comTestando(ids, carregarDiagnostico().then(function () {
      var sg = (cx.diag && cx.diag.servidor && cx.diag.servidor.segredos) || null;
      var alvos = ['banco'];
      if (sg) {
        alvos.push('funcoes');
        if (sg.CLICKUP_TOKEN) alvos.push('clickup');
        if (sg.ASAAS_API_KEY) alvos.push('asaas');
        if (sg.ANTHROPIC_API_KEY) alvos.push('ia');
      }
      return Promise.all(alvos.map(function (a) { return rodarTeste(a); }));
    })).then(function () {
      cx.rodando = false;
      renderizarConexoes();
      var r = resumoConexoes(cartoesConexoes(cx.diag, cx.testes, {}));
      avisar('Teste concluído: ' + r.ok + ' funcionando, ' + r.erro + ' com erro, ' + r.nao_configurado + ' não configurada' + (r.nao_configurado === 1 ? '' : 's') + '.', r.erro ? 'erro' : 'ok');
    }, function () { cx.rodando = false; renderizarConexoes(); });
    return cx.rodando;
  }
  function testarCartao(id) {
    var alvo = ALVO_DO_CARTAO[id];
    if (alvo) return comTestando([id], rodarTeste(alvo));
    return comTestando([id], carregarDiagnostico());
  }
  function acaoCartao(id, acao) {
    var cx = estado.cx;
    if (acao === 'link') return comTestando([id], rodarTeste('infinitepay.link'));
    if (acao === 'email') return comTestando([id], rodarTeste('email'));
    if (acao === 'verificar') {
      var ref = RETORNO_CONEXOES || {};
      var c = cartoesConexoes(cx.diag, cx.testes, {}).filter(function (x) { return x.id === 'infinitepay'; })[0];
      var op = { pedidoId: ref.pedidoId || (c && c.link ? c.link.pedidoId : ''), transactionNsu: ref.transactionNsu || '', slug: ref.slug || '' };
      return comTestando([id], rodarTeste('infinitepay.verificar', op));
    }
    return testarCartao(id);
  }

  var ROTULOS_ACAO = { testar: 'Testar', link: 'Gerar link de teste (R$ 1,00)', verificar: 'Verificar pagamento de teste', email: 'Enviar e-mail de teste para mim' };

  function cartaoConexao(c) {
    var st = STATUS_CONEXAO[c.status] || STATUS_CONEXAO.pendente;
    var ocupado = c.status === 'testando' || !!estado.cx.rodando;
    var art = el('article', { classe: 'caixa caixa--compacta cx-cartao cx-cartao--' + c.status, id: 'cx-' + c.id, 'data-conexao': c.id, 'data-status': c.status, 'aria-busy': c.status === 'testando' ? 'true' : null }, [
      el('div', { classe: 'cx-cartao__topo' }, [
        el('h3', { classe: 'cx-cartao__nome', texto: c.nome }),
        el('span', { classe: 'selo cx-pilula ' + st.classe, 'data-status': c.status, texto: st.texto })
      ]),
      el('p', { classe: 'cx-cartao__serve', texto: c.serve })
    ]);
    if (c.linhas.length) art.appendChild(el('ul', { classe: 'cx-cartao__linhas' }, c.linhas.map(function (l) { return el('li', { texto: l }); })));
    if (c.erro) art.appendChild(el('p', { classe: 'cx-cartao__erro', role: 'alert', texto: c.erro }));
    if (c.link) {
      art.appendChild(el('div', { classe: 'cx-link', id: 'cx-link-teste' }, [
        el('a', { classe: 'cx-link__abrir seminegrito', href: c.link.url, target: '_blank', rel: 'noopener noreferrer', id: 'cx-link-abrir', texto: 'Abrir o link de pagamento de teste ↗' }),
        el('span', { classe: 'cx-link__url', texto: c.link.url }),
        botao('botao--claro botao--pequeno', 'Copiar link', function () { copiar(c.link.url, 'Link copiado.'); }, { id: 'cx-link-copiar' })
      ]));
    }
    if (c.quando || c.verificado) {
      art.appendChild(el('p', { classe: 'cx-cartao__quando' }, [
        c.quando ? 'Último teste: ' + formatarData(c.quando) : '', c.quando && c.verificado ? ' · ' : '', c.verificado || ''
      ]));
    }
    if (c.passos.length) {
      art.appendChild(el('details', { classe: 'cx-resolver', open: c.status === 'erro' ? true : null }, [
        el('summary', { classe: 'cx-resolver__titulo seminegrito', texto: 'Como resolver' }),
        el('ol', { classe: 'cx-resolver__passos' }, c.passos.map(function (p) { return el('li', { texto: p }); }))
      ]));
    }
    if (c.acoes.length) {
      art.appendChild(el('div', { classe: 'cx-cartao__acoes' }, c.acoes.map(function (a) {
        return botao(a === 'testar' ? 'botao--claro botao--pequeno' : 'botao--contorno botao--pequeno', ROTULOS_ACAO[a],
          function () { acaoCartao(c.id, a); }, { 'data-acao': a, disabled: ocupado ? true : null });
      })));
    }
    return art;
  }

  function renderizarConexoes() {
    var box = $('vista-conexoes');
    if (!box || !estado.cx) return;
    limpar(box);
    if (!temConexoes() || papel() !== 'admin') return;
    var cx = estado.cx;
    box.appendChild(cabecalhoVista('Configurações', 'Conexões',
      'Veja se cada integração está funcionando. Nenhum segredo aparece aqui: só se ele existe.',
      [botao('botao--principal', cx.rodando ? 'Testando…' : 'Testar tudo', testarTudo, { id: 'btn-cx-testar-tudo', disabled: cx.rodando ? true : null })]));
    // Primeira vez que a aba aparece: testa tudo sozinho (não testa no login, só quando a aba é aberta).
    if (!cx.carregado && !cx.rodando) {
      if (estado.aba === 'conexoes') { testarTudo(); return; }
      box.appendChild(el('p', { classe: 'texto-suave t-corpo', texto: 'Carregando…' }));
      return;
    }
    if (cx.erro) box.appendChild(el('p', { classe: 'aviso aviso--erro proc-aviso', id: 'cx-erro', role: 'alert', texto: cx.erro }));
    var cartoes = cartoesConexoes(cx.diag, cx.testes, cx.testando);
    var r = resumoConexoes(cartoes);
    box.appendChild(el('p', { classe: 'cx-resumo', id: 'cx-resumo', 'aria-live': 'polite' }, [
      el('span', { classe: 'selo selo--verde', texto: r.ok + ' funcionando' }), ' ',
      el('span', { classe: 'selo selo--vermelho', texto: r.erro + ' com erro' }), ' ',
      el('span', { classe: 'selo', texto: r.nao_configurado + ' não configurada' + (r.nao_configurado === 1 ? '' : 's') }),
      cx.diag && cx.diag.em ? el('span', { classe: 'cx-resumo__quando', texto: ' Última verificação: ' + formatarData(cx.diag.em) }) : null
    ]));
    box.appendChild(el('div', { classe: 'cx-grade', id: 'cx-grade' }, cartoes.map(cartaoConexao)));
  }

  /* ---------- Navegação ---------- */

  function abasPermitidas() { return abasDoPapel(papel(), MODO_API, temVendas(), temConexoes()); }

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
    if (aba === 'conexoes') renderizarConexoes();
  }

  function renderizarTudo() {
    renderizarLista();
    renderizarComparativo();
    if (MODO_API && papel() === 'admin') { renderizarProcessos(); renderizarEmpresas(); renderizarRelatorios(); renderizarVendas(); renderizarUsuarios(); renderizarConexoes(); }
    if (estado.abertoId) renderizarDetalhe();
  }

  // Ajusta abas, botões e menu do usuário ao papel.
  function aplicarPapel() {
    var permitidas = abasPermitidas();
    Array.prototype.forEach.call(document.querySelectorAll('.aba'), function (b) {
      b.hidden = permitidas.indexOf(b.getAttribute('data-aba')) === -1;
    });
    // Título do grupo do menu só aparece se o grupo tem algum item visível.
    Array.prototype.forEach.call(document.querySelectorAll('.menu-grupo'), function (g) {
      g.hidden = !g.querySelector('.aba:not([hidden])');
    });
    $('btn-excluir-todos').hidden = !pode('excluir');
    $('btn-excluir-todos').textContent = MODO_API ? 'Excluir respostas' : 'Excluir todos';
    var u = estado.usuario;
    $('usuario-area').hidden = !(MODO_API && u);
    if (u) {
      var nome = String(u.nome || u.email || '');
      desenharUsuarioTopo();
      $('usuario-nome').textContent = nome;
      $('menu-nome').textContent = nome;
      $('menu-email').textContent = u.email || '';
      $('menu-papel').textContent = PAPEIS[u.papel] || u.papel;
    }
    $('sobretitulo-lista').textContent = MODO_API ? 'Todos os processos' : 'Processo seletivo';
  }

  /* ---------- Menu lateral (computador) / gaveta (tela estreita) ---------- */

  var CHAVE_MENU = 'disc_admin_menu_recolhido';
  function mostrarMenu(sim) {
    $('menu-lateral').hidden = !sim;
    $('btn-menu').hidden = !sim;
    document.body.classList.toggle('com-menu', !!sim);
    if (!sim) fecharGaveta();
  }
  function aplicarRecolhido(recolhido) {
    document.body.classList.toggle('menu-recolhido', !!recolhido);
    var b = $('btn-recolher-menu');
    b.setAttribute('aria-expanded', recolhido ? 'false' : 'true');
    b.setAttribute('aria-label', recolhido ? 'Abrir menu' : 'Recolher menu');
    b.setAttribute('title', recolhido ? 'Abrir menu' : 'Recolher menu');
  }
  function alternarRecolhido() {
    var recolhido = !document.body.classList.contains('menu-recolhido');
    aplicarRecolhido(recolhido);
    ls('set', CHAVE_MENU, recolhido ? '1' : '0');
    fecharMenuUsuario();
  }
  function gavetaAberta() { return document.body.classList.contains('menu-aberto'); }
  function abrirGaveta() {
    document.body.classList.add('menu-aberto');
    $('menu-veu').hidden = false;
    $('btn-menu').setAttribute('aria-expanded', 'true');
    var atual = document.querySelector('.aba[aria-current="page"]') || document.querySelector('.aba:not([hidden])');
    if (atual) atual.focus();
  }
  function fecharGaveta() {
    if (!document.body) return;
    document.body.classList.remove('menu-aberto');
    if ($('menu-veu')) $('menu-veu').hidden = true;
    if ($('btn-menu')) $('btn-menu').setAttribute('aria-expanded', 'false');
  }

  function entrarPainel() {
    $('tela-login').hidden = true;
    $('tela-painel').hidden = false;
    mostrarMenu(true);
    estado.listaMostrada = false;
    aplicarPapel();
    mostrarAba(MODO_API ? 'lista' : (lerLocais().length ? 'lista' : 'importar'));
    verificarBanco();
    // Volta da InfinitePay (link de teste): abre Conexões e confere o pagamento.
    if (RETORNO_CONEXOES && temConexoes() && papel() === 'admin') {
      estado.cx.carregado = true;
      mostrarAba('conexoes');
      carregarDiagnostico().then(function () { acaoCartao('infinitepay', 'verificar'); });
    }
    return carregar();
  }

  // Supabase: confere se todas as migrações foram aplicadas (versaoBanco). Faltando algo (ou sem a função no
  // banco, que é sinal de banco antigo), mostra a faixa no topo do painel. A prévia simulada nunca mostra.
  function verificarBanco() {
    var faixa = $('faixa-banco');
    if (!faixa) return;
    faixa.hidden = true;
    var fn = SUPABASE && !SIMULADA ? metodoApi('versaoBanco') : null;
    if (!fn) return;
    Promise.resolve().then(function () { return fn.call(root.DISC_API); })
      .then(null, function (e) { return { ok: false, erro: (e && e.message) || '' }; })
      .then(function (resp) {
        var msg = mensagemBanco(resp);
        if (!msg || !estado.token) return;
        $('faixa-banco-texto').textContent = msg;
        faixa.hidden = false;
      });
  }

  function limparSessao() {
    ss('del', CHAVE_TOKEN);
    ss('del', CHAVE_USUARIO);
    estado.token = '';
    estado.usuario = null;
    estado.registros = []; estado.processos = []; estado.usuarios = [];
    estado.clickup = { configurado: false, iaConfigurada: false, carregado: false };
    estado.abertoId = null;
    estado.filtros = { processo: '', perfil: '', status: '' };
    estado.proc = { tela: 'lista', id: null };
    estado.relatorios = {};
    estado.editor = null;
    estado.emp = novoEstadoEmpresas();
    estado.rl = novoEstadoRelatorios();
    estado.vd = novoEstadoVendas();
    estado.cx = novoEstadoConexoes();
    fecharMenuUsuario();
    clearTimeout(avisoTimer);
    $('aviso-geral').hidden = true;
    if ($('faixa-banco')) $('faixa-banco').hidden = true;
    destruirOrganograma();
    var j = $('janela'); if (j) j.remove();
    var c = $('confirmar'); if (c) c.remove();
  }

  // Mostra só um dos formulários da tela de entrada.
  function mostrarForm(id) {
    $('tela-painel').hidden = true;
    mostrarMenu(false);
    $('usuario-area').hidden = true;
    $('tela-login').hidden = false;
    ['form-login', 'form-primeiro', 'form-esqueci', 'form-nova-senha'].forEach(function (f) { $(f).hidden = f !== id; });
  }

  // expirou: aviso "Sua sessão expirou"; mensagem: outro aviso no mesmo lugar (ex.: "Senha definida…").
  function mostrarLogin(expirou, mensagem) {
    mostrarForm('form-login');
    var aviso = $('aviso-sessao');
    aviso.textContent = mensagem || 'Sua sessão expirou. Entre de novo.';
    aviso.hidden = !(expirou || mensagem);
    $('erro-login').hidden = true;
    $('campo-senha').value = '';
    $('campo-email').focus();
  }

  function mostrarEsqueci() {
    mostrarForm('form-esqueci');
    $('erro-esqueci').hidden = true;
    $('ok-esqueci').hidden = true;
    var email = $('campo-email').value.trim();
    if (email && !$('es-email').value) $('es-email').value = email;
    $('es-email').focus();
  }

  // Volta do e-mail do Supabase: redefinição (recovery) ou convite (invite) — a pessoa cria a senha aqui.
  function mostrarNovaSenha(tipo) {
    mostrarForm('form-nova-senha');
    var convite = tipo === 'invite';
    $('titulo-nova-senha').textContent = convite ? 'Crie sua senha' : 'Defina sua nova senha';
    $('texto-nova-senha').textContent = convite
      ? 'Você foi convidado para o painel. Escolha uma senha com pelo menos 8 caracteres para entrar.'
      : 'Escolha uma senha com pelo menos 8 caracteres. Depois você já entra no painel.';
    $('erro-nova-senha').hidden = true;
    $('ns-senha').value = '';
    $('ns-confirmar').value = '';
    $('ns-senha').focus();
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

  // Resposta de login que não é de administrador: encerra a sessão aberta e explica.
  function recusarNaoAdmin(resp) {
    Promise.resolve().then(function () { return root.DISC_API.sair(resp.token); }).catch(function () { /* ignora */ });
    throw new Error(SUPABASE ? MSG_SEM_ACESSO_SUPABASE : MSG_SO_ADMIN);
  }

  function primeiroAdmin(resp) {
    return !!(resp && (resp.primeiroAdmin === true || (resp.usuario && resp.usuario.primeiroAdmin === true)));
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
    estado.emp = novoEstadoEmpresas();
    estado.rl = novoEstadoRelatorios();
    estado.vd = novoEstadoVendas();
    estado.cx = novoEstadoConexoes();
    if (CONFIG.EMPRESA) $('nome-empresa').textContent = '· ' + CONFIG.EMPRESA;
    $('modo-indicador').textContent = SIMULADA ? 'Prévia (dados de demonstração)'
      : (SUPABASE ? 'Conectado ao servidor' : (MODO_API ? 'Conectado à planilha' : 'Modo local (importar códigos)'));
    $('menu-modo').textContent = SIMULADA ? 'Prévia' : '';
    if (CONFIG.EMPRESA) $('menu-modo').textContent = CONFIG.EMPRESA + (SIMULADA ? ' · Prévia' : '');
    aplicarRecolhido(ls('get', CHAVE_MENU) === '1');
    $('btn-recolher-menu').addEventListener('click', alternarRecolhido);
    $('btn-menu').addEventListener('click', function () { if (gavetaAberta()) fecharGaveta(); else abrirGaveta(); });
    $('menu-veu').addEventListener('click', fecharGaveta);
    $('dica-previa').hidden = !SIMULADA;
    $('dica-previa-chave').hidden = !SIMULADA;
    if (MODO_API) $('destino-importacao').textContent = SUPABASE
      ? 'Os resultados são enviados para o servidor, como se o participante tivesse enviado.'
      : 'Os resultados são enviados para a planilha, como se o participante tivesse enviado.';
    // Supabase: sem "Primeiro acesso" com chave (o primeiro login vira admin) e com "Esqueci minha senha".
    $('btn-ir-primeiro').hidden = SUPABASE;
    $('btn-esqueci').hidden = !SUPABASE;
    $('nota-esqueceu').hidden = SUPABASE;
    $('nota-primeiro-supabase').hidden = !SUPABASE;

    Array.prototype.forEach.call(document.querySelectorAll('.aba'), function (b) {
      b.addEventListener('click', function () {
        var aba = b.getAttribute('data-aba');
        // A aba Processos sempre volta para a lista (o rascunho aberto continua guardado na memória).
        if (aba === 'processos' && estado.proc.tela !== 'lista') { estado.proc = { tela: 'lista', id: null }; renderizarProcessos(); }
        if (aba === 'empresas' && estado.emp.tela !== 'lista') { estado.emp.tela = 'lista'; estado.emp.id = null; renderizarEmpresas(); }
        if (aba === 'relatorios' && estado.rl.tela !== 'modelos' && estado.rl.tela !== 'gerados') { estado.rl.tela = 'modelos'; estado.rl.rel = null; renderizarRelatorios(); }
        if (aba === 'vendas' && estado.vd.pedidoId) { estado.vd.pedidoId = null; renderizarVendas(); }
        mostrarAba(aba);
        fecharGaveta();
      });
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
      if (gavetaAberta()) { fecharGaveta(); $('btn-menu').focus(); return; }
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
    $('btn-trocar-senha').addEventListener('click', function () { fecharMenuUsuario(); fecharGaveta(); janelaTrocarSenha(); });
    $('btn-minha-foto').addEventListener('click', function () { fecharMenuUsuario(); fecharGaveta(); janelaMinhaFoto(); });

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
        // Gestor (desativado nesta versão) ou, no Supabase, usuário sem convite: encerra a sessão e não entra.
        if (!resp.usuario || resp.usuario.papel !== 'admin') recusarNaoAdmin(resp);
        return iniciarSessao(resp).then(function () {
          if (primeiroAdmin(resp)) avisar(MSG_PRIMEIRO_ADMIN, 'ok');
        });
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

    // Esqueci minha senha (Supabase): o e-mail traz um link que volta para este painel.
    $('btn-esqueci').addEventListener('click', mostrarEsqueci);
    $('btn-voltar-login-esqueci').addEventListener('click', function () { mostrarLogin(false); });
    $('form-esqueci').addEventListener('submit', function (e) {
      e.preventDefault();
      $('erro-esqueci').hidden = true;
      $('ok-esqueci').hidden = true;
      var email = $('es-email').value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { erroNoForm('erro-esqueci', 'Informe um e-mail válido.'); return; }
      var btn = $('btn-enviar-link');
      btn.disabled = true; btn.textContent = 'Enviando…';
      apiPublica(['recuperarSenha', 'esqueciSenha', 'enviarRecuperacaoSenha'], email, enderecoPainel(root.location.href)).then(function () {
        var ok = $('ok-esqueci');
        ok.textContent = 'Se este e-mail tiver acesso ao painel, você vai receber um link para definir uma nova senha. Confira a caixa de entrada e o spam.';
        ok.hidden = false;
      }).catch(function (err) {
        erroNoForm('erro-esqueci', (err && err.message) || 'Não foi possível enviar o link.');
      }).then(function () { btn.disabled = false; btn.textContent = 'Enviar link'; });
    });

    // Nova senha (volta do e-mail de redefinição ou de convite).
    $('btn-voltar-login-nova').addEventListener('click', function () { mostrarLogin(false); });
    $('form-nova-senha').addEventListener('submit', function (e) {
      e.preventDefault();
      $('erro-nova-senha').hidden = true;
      var senha = $('ns-senha').value;
      if (senha.length < 8) { erroNoForm('erro-nova-senha', 'A senha precisa ter pelo menos 8 caracteres.'); return; }
      if (senha !== $('ns-confirmar').value) { erroNoForm('erro-nova-senha', 'As duas senhas não são iguais.'); return; }
      var btn = $('btn-salvar-nova-senha');
      btn.disabled = true; btn.textContent = 'Salvando…';
      apiPublica(['definirNovaSenha', 'atualizarSenhaRecuperacao'], senha).then(function (resp) {
        $('ns-senha').value = ''; $('ns-confirmar').value = '';
        if (root.history && root.history.replaceState) {
          try { root.history.replaceState(null, '', enderecoPainel(root.location.href)); } catch (e2) { /* ignora */ }
        }
        if (resp.token && resp.usuario) {
          if (resp.usuario.papel !== 'admin') recusarNaoAdmin(resp);
          return iniciarSessao(resp).then(function () {
            avisar(primeiroAdmin(resp) ? MSG_PRIMEIRO_ADMIN : 'Senha definida.', 'ok');
          });
        }
        mostrarLogin(false, 'Senha definida. Entre com o seu e-mail e a nova senha.');
      }).catch(function (err) {
        erroNoForm('erro-nova-senha', (err && err.message) || 'Não foi possível salvar a senha.');
      }).then(function () { btn.disabled = false; btn.textContent = 'Salvar senha'; });
    });

    if (!MODO_API) { entrarPainel(); return; }
    if (SUPABASE && RETORNO_AUTH.tipo) { mostrarNovaSenha(RETORNO_AUTH.tipo); return; }
    if (SUPABASE && RETORNO_AUTH.erro) {
      mostrarLogin(false);
      erroNoForm('erro-login', RETORNO_AUTH.erro);
      return;
    }
    var token = ss('get', CHAVE_TOKEN);
    var usuario = null;
    try { usuario = JSON.parse(ss('get', CHAVE_USUARIO) || 'null'); } catch (e2) { usuario = null; }
    if (token && usuario && usuario.papel === 'admin') {
      estado.token = token;
      estado.usuario = usuario;
      entrarPainel();
    } else {
      if (token) { ss('del', CHAVE_TOKEN); ss('del', CHAVE_USUARIO); }
      mostrarLogin(false);
      // Supabase: a sessão fica guardada pelo supabase-js (outra aba, volta depois); se for de admin, entra direto.
      if (SUPABASE && metodoApi('sessaoAtual')) {
        apiPublica('sessaoAtual').then(function (resp) {
          if (resp.token && resp.usuario && resp.usuario.papel === 'admin' && !$('form-login').hidden && !estado.token) return iniciarSessao(resp);
        }).catch(function () { /* sem sessão: fica no login */ });
      }
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})(typeof self !== 'undefined' ? self : this);
