/*
 * API simulada — para a prévia/demonstração, sem Google Apps Script.
 *
 * Liga só quando CONFIG.API_URL === 'simulada'. Carregue logo DEPOIS de js/api.js:
 *   <script src="js/api.js"></script>
 *   <script src="js/api-simulada.js"></script>
 * Nesse modo, todos os métodos do DISC_API (enviar, login, listar, empresas, avaliações, usuários…)
 * passam a usar uma "planilha" falsa guardada no localStorage deste navegador, com as MESMAS regras e
 * mensagens do apps-script/Code.gs: validação do payload, perfil recalculado a partir das respostas
 * (via DISC_SCORING), protocolo único, logins com senha (SHA-256 iterado 2000×, mesmo cálculo do
 * servidor), bloqueio após 5 erros, sessão de 6 h, papéis admin/gestor e avaliações com link.
 * Com qualquer outro API_URL este arquivo não faz nada.
 *
 * Semente da prévia (criada sozinha na primeira carga):
 *   admin  admin@previa.com  / previa123   ·  gestor  gestor@previa.com / previa123 (Clínica Exemplo)
 *   avaliações SEL1 (Recepcionista 2026, seleção), EQP1 (Equipe comercial, equipe, mostra resultado) e
 *   ATD1 (Atendimento ao cliente, mostra resultado, formulário próprio: e-mail obrigatório, cidade opcional
 *   e 1 pergunta extra). 5 respostas de exemplo: a "Ana Exemplo Prévia" respondeu 2 vezes (SEL1 e ATD1), a
 *   mesma pessoa no painel. Chave de primeiro acesso da prévia: "previa".
 *
 * Pessoas (como public.pessoas do Supabase): cada resposta é ligada à pessoa do mesmo WhatsApp (chave
 * disc_simulada_pessoas); o envio atualiza a ficha (campo vazio não apaga) e a pessoa que fica sem
 * respostas é excluída junto. O formulário de cada processo (config.formulario) decide o que é pedido.
 *   Processo "Cartório Exemplo — Escrevente" (código CRT1) ligado à lista fictícia do ClickUp da fixture
 *   (tests/fixtures/processo-exemplo.json, embutida em js/fixture-processo-exemplo.js) e um relatório
 *   JÁ PUBLICADO com o token fixo "exemplo-cartorio" (relatorio.html#r-exemplo-cartorio).
 *
 * Empresas e equipes (como public.empresas/vinculos/relacoes do Supabase): colaboradores (vínculo pessoa x
 * empresa, no máximo 1 ativo por pessoa), mover/desligar (relações da pessoa somem), organograma e
 * relatórios por modelo (equipe/lideranca/pessoa). Semente: a "Clínica Exemplo" tem 7 colaboradores ativos
 * em 3 níveis (Marta dirige; Diego e Paulo lideram áreas; Carla, Lucas, Renata e Tiago — sem teste — são
 * liderados), relações direto/indireto e o Bruno desligado no histórico; SEL1 e EQP1 (equipe) são dela.
 *
 * Processos, ClickUp e relatórios (rodada ClickUp): o ClickUp NUNCA é chamado. "processo.dados" devolve a
 * fixture (com os dados do processo gravado), "relatorio.rascunho" roda o MESMO motor do servidor
 * (js/relatorio-motor.js, DISC_RELATORIO) e "relatorio.melhorarTextos" só simula a IA (prefixo "[IA] ").
 * No navegador, o motor e a fixture são carregados sob demanda (mesma pasta deste arquivo), então as
 * páginas não precisam incluí-los.
 *
 * No Node (testes): require('./js/api-simulada.js').criar({ armazenamento, scoring, latenciaMs: 0, semente: false }).
 * Opcional: { motor, fixture } para trocar o motor do relatório e os dados do processo de exemplo.
 */
(function (root) {
  'use strict';

  var CHAVE_ARMAZENAMENTO = 'disc_planilha_simulada';     // respostas (mesma chave das versões anteriores)
  var CHAVES = {
    usuarios: 'disc_simulada_usuarios',
    empresas: 'disc_simulada_empresas',
    avaliacoes: 'disc_simulada_avaliacoes',
    sessoes: 'disc_simulada_sessoes',
    relatorios: 'disc_simulada_relatorios',
    pessoas: 'disc_simulada_pessoas',
    vinculos: 'disc_simulada_vinculos',
    relacoes: 'disc_simulada_relacoes',
    semente: 'disc_simulada_semente',
    sementeRelatorio: 'disc_simulada_semente_relatorio',
    sementeEquipe: 'disc_simulada_semente_equipe'
  };
  var CHAVE_ADMIN = 'previa';
  var LATENCIA_MS = 400;
  var PREVIA = {
    chave: CHAVE_ADMIN,
    admin: { email: 'admin@previa.com', senha: 'previa123' },
    gestor: { email: 'gestor@previa.com', senha: 'previa123' },
    avaliacoes: ['SEL1', 'EQP1', 'ATD1'],
    processo: { id: 'ava_previa_cartorio', codigo: 'CRT1', nome: 'Cartório Exemplo — Escrevente' },
    relatorioToken: 'exemplo-cartorio'
  };

  // Mesmos valores do Code.gs
  var LIMITE_CORPO = 20000;
  var LIMITE_CORPO_RELATORIO = 450000;      // só "relatorio.salvar" (o relatório inteiro volta do painel)
  var ACOES_CORPO_GRANDE = ['relatorio.salvar', 'relatorioModelo.salvar'];
  var MODELOS_RELATORIO = ['equipe', 'lideranca', 'pessoa'];
  var TIPOS_RELACAO = ['lidera', 'direto', 'indireto'];
  var MAX_DADOS_RELATORIO = 300000;          // mesmo limite do js/api-supabase.js (~300 KB de JSON)
  var REL_MAX_TEXTO = 4000;
  var REL_MAX_TEXTOS_IA = 80;
  var PREFIXO_IA = '[IA] ';
  var MSG_REL_NAO_ENCONTRADO = 'Relatório não encontrado ou fora do ar.';
  var MSG_CU_SEM_LISTA = 'Este processo ainda não está ligado a uma lista do ClickUp.';
  var AVISO_PREVIA = 'Prévia: candidatos fictícios de exemplo. Com o servidor de verdade eles vêm da lista do ClickUp.';
  // Ações que, no navegador, precisam do motor do relatório e da fixture (carregados sob demanda).
  var ACOES_COM_MOTOR = ['processo.dados', 'relatorio.rascunho', 'relatorio.salvar', 'relatorio.publicar',
    'relatorio.melhorarTextos', 'relatorioPublico'];
  var LISTAS_PREVIA = [
    { id: '900000000001', nome: 'Escrevente de atendimento 2026', pasta: 'Recrutamento e Seleção' },
    { id: '900000000002', nome: 'Recepcionista — Clínica Exemplo', pasta: 'Recrutamento e Seleção' },
    { id: '900000000003', nome: 'Auxiliar administrativo — Loja Fictícia', pasta: 'Recrutamento e Seleção' }
  ];
  var LIMITE_LINHAS = 500;
  var LIMITE_ENVIOS_JANELA = 40;
  var JANELA_ENVIOS_SEG = 600;
  var STATUS_VALIDOS = ['em_analise', 'aprovado', 'reprovado'];
  var STATUS_PADRAO = 'em_analise';
  var LETRAS = ['D', 'I', 'S', 'C'];
  var TOTAL_GRUPOS = 25;
  var LETRAS_PROTOCOLO = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  var TOTAL_PROTOCOLOS = 100 * LETRAS_PROTOCOLO.length;
  var TENTATIVAS_SORTEIO = 40;
  var IDADE_MIN = 14;
  var IDADE_MAX = 99;
  var LIMITE_FUNCAO_EMPRESA = 80;
  var LIMITE_VALIDACAO = 4000;
  var PAPEIS = ['admin', 'gestor'];
  var TIPOS_AVALIACAO = ['selecao', 'equipe'];
  var ALFABETO_CODIGO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var TAMANHO_CODIGO = 4;
  var SENHA_MIN = 8;
  var SENHA_MAX = 100;
  var ITERACOES_HASH = 2000;
  var MAX_TENTATIVAS_LOGIN = 5;
  var BLOQUEIO_MS = 15 * 60 * 1000;
  var VALIDADE_SESSAO_MS = 6 * 60 * 60 * 1000;

  var MSG_LOGIN_INVALIDO = 'E-mail ou senha incorretos.';
  var MSG_BLOQUEIO = 'Muitas tentativas. Tente de novo em 15 minutos.';
  var MSG_SESSAO = 'Sessão expirada. Entre de novo.';
  var MSG_SEM_PERMISSAO = 'Sem permissão.';
  var MSG_LINK_INATIVO = 'Este link de avaliação não está mais ativo.';
  var MSG_LINK_INVALIDO = 'Link inválido ou avaliação encerrada. Fale com quem enviou o link.';

  /* ---------- SHA-256 em JS puro (navegador e Node; síncrono) ---------- */

  var K256 = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  function utf8Bytes(texto) {
    var s = String(texto);
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s);
    var bin = unescape(encodeURIComponent(s));
    var out = [];
    for (var i = 0; i < bin.length; i++) out.push(bin.charCodeAt(i));
    return out;
  }

  function sha256Hex(texto) {
    var bytes = utf8Bytes(texto);
    var n = bytes.length;
    var total = ((n + 9 + 63) >> 6) << 6;
    var w = new Array(total >> 2);
    for (var i = 0; i < w.length; i++) w[i] = 0;
    for (i = 0; i < n; i++) w[i >> 2] |= bytes[i] << (24 - (i % 4) * 8);
    w[n >> 2] |= 0x80 << (24 - (n % 4) * 8);
    w[w.length - 1] = (n * 8) >>> 0;
    w[w.length - 2] = Math.floor(n / 0x20000000);
    var h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
    var h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
    var m = new Array(64);
    function rotr(x, k) { return (x >>> k) | (x << (32 - k)); }
    for (var bloco = 0; bloco < w.length; bloco += 16) {
      for (var t = 0; t < 64; t++) {
        if (t < 16) m[t] = w[bloco + t] | 0;
        else {
          var a15 = m[t - 15], a2 = m[t - 2];
          var s0 = rotr(a15, 7) ^ rotr(a15, 18) ^ (a15 >>> 3);
          var s1 = rotr(a2, 17) ^ rotr(a2, 19) ^ (a2 >>> 10);
          m[t] = (m[t - 16] + s0 + m[t - 7] + s1) | 0;
        }
      }
      var a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
      for (t = 0; t < 64; t++) {
        var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + K256[t] + m[t]) | 0;
        var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + maj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
      h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
    }
    return [h0, h1, h2, h3, h4, h5, h6, h7].map(function (x) { return ('00000000' + (x >>> 0).toString(16)).slice(-8); }).join('');
  }

  /** Mesmo cálculo do hashSenha do Code.gs: x = sal + senha; 2000×: x = hex(SHA-256(x)). */
  function hashSenha(senha, sal) {
    var x = String(sal) + String(senha);
    for (var i = 0; i < ITERACOES_HASH; i++) x = sha256Hex(x);
    return x;
  }

  function hexAleatorio(qtdBytes) {
    var bytes = [];
    var c = (typeof root !== 'undefined' && root && root.crypto) || (typeof globalThis !== 'undefined' ? globalThis.crypto : null);
    if (c && typeof c.getRandomValues === 'function') {
      var arr = new Uint8Array(qtdBytes);
      c.getRandomValues(arr);
      for (var i = 0; i < arr.length; i++) bytes.push(arr[i]);
    } else {
      for (var j = 0; j < qtdBytes; j++) bytes.push(Math.floor(Math.random() * 256));
    }
    return bytes.map(function (b) { return (b < 16 ? '0' : '') + b.toString(16); }).join('');
  }

  function iguaisSeguro(a, b) {
    a = String(a); b = String(b);
    var dif = a.length ^ b.length;
    for (var i = 0; i < Math.max(a.length, b.length); i++) dif |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
    return dif === 0;
  }

  /* ---------- Regras puras (espelho do Code.gs) ---------- */

  function erro(mensagem, extra) {
    var r = { ok: false, erro: mensagem };
    if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) r[k] = extra[k];
    return r;
  }

  function limparTexto(v, max) {
    if (v === null || v === undefined) return '';
    var s = String(v).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
    if (max && s.length > max) s = s.substring(0, max).trim();
    return s;
  }

  function limparTextoLongo(v, max) {
    if (v === null || v === undefined) return '';
    var s = String(v).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, ' ').trim();
    if (max && s.length > max) s = s.substring(0, max).trim();
    return s;
  }

  function normalizarTelefone(v) {
    var d = String(v === null || v === undefined ? '' : v).replace(/\D/g, '');
    if (d.length === 10 || d.length === 11) return '55' + d;
    if ((d.length === 12 || d.length === 13) && d.indexOf('55') === 0) return d;
    return '';
  }

  function letras(texto) {
    try { return String(texto).match(new RegExp('\\p{L}', 'gu')) || []; }
    catch (e) { return String(texto).match(/[A-Za-zÀ-ÖØ-öø-ÿ]/g) || []; }
  }

  function nomeValido(nome) {
    var palavras = nome.split(' ').filter(function (p) { return letras(p).length > 0; });
    return palavras.length >= 2 && letras(nome).length >= 5;
  }

  // Mesmas regras e mensagens do validarIdadeServidor do Code.gs.
  function validarIdade(v) {
    if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) {
      return erro('Idade não informada: a idade é obrigatória (só números, de 14 a 99 anos).');
    }
    var s = typeof v === 'number' ? String(v) : (typeof v === 'string' ? v.trim() : '');
    if (!/^[0-9]{1,3}$/.test(s)) return erro('Idade inválida: use só números (entre 14 e 99 anos).');
    var n = Number(s);
    if (n < IDADE_MIN || n > IDADE_MAX) return erro('Idade inválida: precisa ser entre 14 e 99 anos.');
    return { ok: true, idade: n };
  }

  function idadeGravada(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return (isFinite(n) && Math.floor(n) === n && n >= IDADE_MIN && n <= IDADE_MAX) ? n : null;
  }

  function dataIsoOuVazio(v) {
    var s = limparTexto(v, 40);
    if (!s) return '';
    var t = Date.parse(s);
    return isNaN(t) ? '' : new Date(t).toISOString();
  }

  function protocoloValido(v) {
    return typeof v === 'string' && /^[0-9]{2}[A-HJ-NP-Z]$/.test(v);
  }

  function normalizarProtocolo(v) {
    if (v === null || v === undefined) return '';
    var s = String(v).replace(/^'/, '').replace(/\s+/g, '').toUpperCase();
    return protocoloValido(s) ? s : '';
  }

  function protocoloPorIndice(n) {
    var numero = Math.floor(n / LETRAS_PROTOCOLO.length);
    return (numero < 10 ? '0' : '') + numero + LETRAS_PROTOCOLO.charAt(n % LETRAS_PROTOCOLO.length);
  }

  function gerarProtocolo(usados, aleatorio) {
    var rnd = typeof aleatorio === 'function' ? aleatorio : Math.random;
    function sorteio(max) { return Math.min(max - 1, Math.floor(rnd() * max)); }
    for (var t = 0; t < TENTATIVAS_SORTEIO; t++) {
      var p = protocoloPorIndice(sorteio(TOTAL_PROTOCOLOS));
      if (!usados[p]) return p;
    }
    var livres = [];
    for (var i = 0; i < TOTAL_PROTOCOLOS; i++) {
      var c = protocoloPorIndice(i);
      if (!usados[c]) livres.push(c);
    }
    if (!livres.length) {
      throw new Error('Limite de códigos atingido: todos os ' + TOTAL_PROTOCOLOS + ' códigos estão em uso. ' +
        'Exclua candidatos antigos ou de teste no painel e tente de novo.');
    }
    return livres[sorteio(livres.length)];
  }

  function normalizarCodigoAvaliacao(v) {
    if (v === null || v === undefined) return '';
    var s = String(v).replace(/^'/, '').replace(/\s+/g, '').toUpperCase();
    return /^[A-Z0-9]{4}$/.test(s) ? s : '';
  }

  function gerarCodigoAvaliacao(usados, aleatorio) {
    var rnd = typeof aleatorio === 'function' ? aleatorio : Math.random;
    for (var t = 0; t < 200; t++) {
      var c = '';
      for (var i = 0; i < TAMANHO_CODIGO; i++) c += ALFABETO_CODIGO.charAt(Math.min(ALFABETO_CODIGO.length - 1, Math.floor(rnd() * ALFABETO_CODIGO.length)));
      if (!usados || !usados[c]) return c;
    }
    throw new Error('Não foi possível gerar um código novo. Tente de novo.');
  }

  // Mesmo validarValidacao do Code.gs.
  function validarValidacao(v) {
    if (v === undefined || v === null) return { ok: true, validacao: null };
    var falha = erro('Dados da etapa de validação inválidos.');
    if (typeof v !== 'object' || Array.isArray(v)) return falha;
    var json;
    try { json = JSON.stringify(v); } catch (e) { return falha; }
    if (!json || json.length > LIMITE_VALIDACAO) return falha;
    function letra(x) { return typeof x === 'string' && LETRAS.indexOf(x) >= 0; }
    function inteiro(x, min, max) { return typeof x === 'number' && isFinite(x) && Math.floor(x) === x && x >= min && x <= max; }
    function lista(x, max) { return Array.isArray(x) && x.length <= max; }
    if (!inteiro(v.versao, 1, 99)) return falha;
    if (!lista(v.pares, 3) || !lista(v.escolhas, 3) || !lista(v.itens, 8) || !lista(v.gruposSeg, TOTAL_GRUPOS)) return falha;
    for (var i = 0; i < v.pares.length; i++) {
      var par = v.pares[i];
      if (!Array.isArray(par) || par.length !== 2 || !letra(par[0]) || !letra(par[1])) return falha;
    }
    for (i = 0; i < v.escolhas.length; i++) if (!letra(v.escolhas[i])) return falha;
    var itens = [];
    for (i = 0; i < v.itens.length; i++) {
      var it = v.itens[i];
      if (!it || typeof it !== 'object' || Array.isArray(it)) return falha;
      if (typeof it.id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(it.id)) return falha;
      if (!letra(it.letra) || ['forca', 'sombra', 'contraste'].indexOf(it.tipo) === -1 || !inteiro(it.nota, 1, 5)) return falha;
      itens.push({ id: it.id, letra: it.letra, tipo: it.tipo, nota: it.nota });
    }
    for (i = 0; i < v.gruposSeg.length; i++) {
      var s = v.gruposSeg[i];
      if (typeof s !== 'number' || !isFinite(s) || s < 0 || s > 86400) return falha;
    }
    if (!inteiro(v.semMexer, 0, TOTAL_GRUPOS)) return falha;
    if (v.demonstracao !== undefined && typeof v.demonstracao !== 'boolean') return falha;
    return {
      ok: true,
      validacao: {
        versao: v.versao,
        pares: v.pares.map(function (p) { return [p[0], p[1]]; }),
        escolhas: v.escolhas.slice(),
        itens: itens,
        gruposSeg: v.gruposSeg.map(function (n) { return Math.round(n * 10) / 10; }),
        semMexer: v.semMexer,
        demonstracao: v.demonstracao === true
      }
    };
  }

  function validarSenhaNova(senha) {
    if (typeof senha !== 'string' || senha.length < SENHA_MIN) return erro('A senha precisa ter pelo menos ' + SENHA_MIN + ' caracteres.');
    if (senha.length > SENHA_MAX) return erro('A senha pode ter no máximo ' + SENHA_MAX + ' caracteres.');
    return { ok: true };
  }

  function normalizarEmail(v) { return limparTexto(v, 120).toLowerCase(); }
  function emailValido(email) { return typeof email === 'string' && email.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }

  function obterScoring(opcoes) {
    if (opcoes && opcoes.scoring) return opcoes.scoring;
    if (root && root.DISC_SCORING) return root.DISC_SCORING;
    if (typeof require === 'function') {
      try { return require('./scoring.js'); } catch (e) { /* sem scoring */ }
    }
    throw new Error('DISC_SCORING não carregado.');
  }

  function copiar(o) { return JSON.parse(JSON.stringify(o)); }
  function buscarPor(lista, campo, valor) {
    for (var i = 0; i < lista.length; i++) if (lista[i][campo] === valor) return lista[i];
    return null;
  }

  /* ---------- Config do processo (espelho do Code.gs: validarConfigProcesso / classificarCampo) ---------- */

  var TERMOS_SENSIVEIS = ['sexo', 'genero', 'estado civil', 'filho', 'religi', 'gravid', 'etnia', 'raca',
    'cor da pele', 'orientacao', 'deficien', 'doenca', 'saude', 'antecedente', 'processo em seu nome', 'criminal'];
  var TERMOS_ANTECEDENTES = ['antecedente', 'processo em seu nome', 'criminal'];

  function normalizarNomeCampo(nome) {
    var s = String(nome === null || nome === undefined ? '' : nome).toLowerCase();
    if (s.normalize) s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return s.replace(/[^a-z0-9%]+/g, ' ').trim();
  }

  // '' (pode ler), 'sensivel' (nunca ler) ou 'antecedente' (só com permitirAntecedentes; nunca no relatório).
  function classificarCampo(nome, config) {
    var n = ' ' + normalizarNomeCampo(nome);
    config = config || {};
    for (var i = 0; i < TERMOS_SENSIVEIS.length; i++) {
      var termo = TERMOS_SENSIVEIS[i];
      if (n.indexOf(' ' + termo) === -1) continue;
      if (termo === 'saude' && config.permitirSaude === true) continue;
      if (TERMOS_ANTECEDENTES.indexOf(termo) >= 0) return config.permitirAntecedentes === true ? 'antecedente' : 'sensivel';
      return 'sensivel';
    }
    return '';
  }

  function numeroOu(v, padrao, min, max) {
    var n = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v.replace(',', '.')) : NaN);
    if (!isFinite(n)) return padrao;
    return Math.max(min, Math.min(max, n));
  }

  function idSimples(v, prefixo, i) {
    var s = limparTexto(v, 40);
    return /^[A-Za-z0-9_-]{1,40}$/.test(s) ? s : prefixo + (i + 1);
  }

  /* ---------- Formulário do processo (config.formulario) — mesma regra do banco e do js/api-supabase.js ---------- */

  var MODOS_CAMPO = ['obrigatorio', 'opcional', 'oculto'];
  var CAMPOS_FORMULARIO = ['idade', 'funcao', 'empresa', 'email', 'cidade'];
  var FORMULARIO_PADRAO = { idade: 'obrigatorio', funcao: 'opcional', empresa: 'opcional', email: 'oculto', cidade: 'oculto' };
  var MAX_PERGUNTAS = 5;

  function normalizarFormulario(f) {
    f = f && typeof f === 'object' && !Array.isArray(f) ? f : {};
    var origem = f.campos && typeof f.campos === 'object' && !Array.isArray(f.campos) ? f.campos : {};
    var campos = {};
    CAMPOS_FORMULARIO.forEach(function (k) {
      campos[k] = typeof origem[k] === 'string' && MODOS_CAMPO.indexOf(origem[k]) >= 0 ? origem[k] : FORMULARIO_PADRAO[k];
    });
    var perguntas = [];
    var usados = {};
    (Array.isArray(f.perguntas) ? f.perguntas : []).forEach(function (p) {
      if (perguntas.length >= MAX_PERGUNTAS) return;
      if (!p || typeof p !== 'object' || Array.isArray(p)) return;
      var texto = limparTexto(p.texto, 200);
      if (texto.length < 3) return;
      var id = typeof p.id === 'string' ? p.id : '';
      if (!/^[a-z0-9_]{1,20}$/.test(id) || usados[id]) {
        var n = 1;
        while (usados['p' + n]) n++;
        id = 'p' + n;
      }
      usados[id] = true;
      perguntas.push({ id: id, texto: texto, obrigatoria: p.obrigatoria === true });
    });
    return { campos: campos, perguntas: perguntas };
  }

  function perguntaSensivel(f) {
    var lista = f && typeof f === 'object' && Array.isArray(f.perguntas) ? f.perguntas : [];
    for (var i = 0; i < lista.length; i++) {
      var p = lista[i];
      if (!p || typeof p !== 'object' || Array.isArray(p)) continue;
      var texto = limparTexto(p.texto, 200);
      if (texto && classificarCampo(texto, {}) !== '') return 'A pergunta "' + texto + '" pede um dado sensível e não pode ser usada.';
    }
    return '';
  }

  function validarConfigProcesso(c) {
    if (c === undefined || c === null) c = {};
    if (typeof c !== 'object' || Array.isArray(c)) return erro('Configuração do processo inválida.');
    var json;
    try { json = JSON.stringify(c); } catch (e) { return erro('Configuração do processo inválida.'); }
    if (json.length > 40000) return erro('Configuração do processo grande demais.');
    var perfil = String(c.perfilIdeal || '').toUpperCase().replace(/[^DISC]/g, '');
    if (perfil.length > 2 || (perfil.length === 2 && perfil[0] === perfil[1])) return erro('Perfil ideal inválido: use 1 ou 2 letras entre D, I, S e C.');
    var permitirAntecedentes = c.permitirAntecedentes === true;
    var base = { permitirAntecedentes: permitirAntecedentes, permitirSaude: c.permitirSaude === true };
    var problema = null;
    function campo(v) {
      var nome = limparTexto(v, 120);
      if (nome && classificarCampo(nome, base) === 'sensivel') problema = problema || ('O campo "' + nome + '" é um dado sensível e não pode ser usado.');
      return nome;
    }
    var ids = {};
    function idUnico(v, prefixo, i) {
      var id = idSimples(v, prefixo, i);
      while (ids[id]) id = id + '_';
      ids[id] = true;
      return id;
    }
    var etapas = (Array.isArray(c.etapas) ? c.etapas : []).slice(0, 20).map(function (e, i) {
      e = e && typeof e === 'object' ? e : {};
      return {
        id: idUnico(e.id, 'etapa', i), nome: limparTexto(e.nome, 80) || ('Etapa ' + (i + 1)),
        peso: numeroOu(e.peso, 0, 0, 1000), campo: campo(e.campo), descricao: limparTextoLongo(e.descricao, 1000)
      };
    });
    var bonus = (Array.isArray(c.bonus) ? c.bonus : []).slice(0, 20).map(function (b, i) {
      b = b && typeof b === 'object' ? b : {};
      var regra = b.regra && typeof b.regra === 'object' ? b.regra : {};
      var r;
      if (regra.tipo === 'mapa') {
        var pontos = {};
        var origem = regra.pontos && typeof regra.pontos === 'object' ? regra.pontos : {};
        Object.keys(origem).slice(0, 50).forEach(function (k) {
          var chave = limparTexto(k, 120);
          if (chave) pontos[chave] = numeroOu(origem[k], 0, -100, 100);
        });
        r = { tipo: 'mapa', pontos: pontos };
      } else {
        r = { tipo: 'checkbox', pontos: numeroOu(regra.pontos, 0, -100, 100) };
      }
      return { id: idUnico(b.id, 'bonus', i), nome: limparTexto(b.nome, 80) || ('Bônus ' + (i + 1)), campo: campo(b.campo), regra: r };
    });
    if (problema) return erro(problema);
    var sensivel = perguntaSensivel(c.formulario);
    if (sensivel) return erro(sensivel);
    var corte = numeroOu(c.corte, 70, 0, 200);
    var faixa = numeroOu(c.faixaAvaliar, 55, 0, 200);
    if (faixa > corte) return erro('A faixa "avaliar" precisa ser menor ou igual à nota de corte.');
    return {
      ok: true,
      config: {
        perfilIdeal: perfil,
        explicacaoPerfil: limparTextoLongo(c.explicacaoPerfil, 2000),
        etapas: etapas,
        bonus: bonus,
        corte: corte,
        faixaAvaliar: faixa,
        statusFinalistas: (Array.isArray(c.statusFinalistas) ? c.statusFinalistas : []).slice(0, 30)
          .map(function (x) { return limparTexto(x, 80); }).filter(Boolean),
        permitirAntecedentes: permitirAntecedentes,
        permitirSaude: c.permitirSaude === true,
        formulario: normalizarFormulario(c.formulario)
      }
    };
  }

  /* ---------- Motor do relatório e fixture (Node: require; navegador: carregados sob demanda) ---------- */

  // Pasta deste arquivo no site (para carregar js/relatorio-motor.js e js/fixture-processo-exemplo.js).
  var PASTA_SCRIPTS = (function () {
    try {
      var atual = root && root.document && root.document.currentScript;
      if (atual && atual.src) return String(atual.src).replace(/[^\/]*$/, '');
    } catch (e) { /* sem DOM */ }
    return 'js/';
  })();

  function globalDe(nome) {
    if (root && root[nome]) return root[nome];
    if (typeof globalThis !== 'undefined' && globalThis[nome]) return globalThis[nome];
    return null;
  }

  function exigirModulo(nomeGlobal, arquivo) {
    var m = globalDe(nomeGlobal);
    if (m) return m;
    if (typeof require === 'function') {
      try { return require(arquivo); } catch (e) { /* segue para o erro */ }
    }
    throw new Error('não foi possível carregar ' + arquivo.replace('./', 'js/') + '.');
  }

  var carregando = {};
  function carregarScript(arquivo, nomeGlobal) {
    if (globalDe(nomeGlobal)) return Promise.resolve();
    var doc = root && root.document;
    if (!doc || typeof doc.createElement !== 'function') return Promise.resolve(); // Node: usa require
    if (carregando[arquivo]) return carregando[arquivo];
    carregando[arquivo] = new Promise(function (resolver) {
      var el = doc.createElement('script');
      el.src = PASTA_SCRIPTS + arquivo;
      el.async = true;
      // Falha vira erro claro na própria ação (exigirModulo); aqui só libera a fila.
      el.onload = function () { resolver(); };
      el.onerror = function () { delete carregando[arquivo]; resolver(); };
      (doc.head || doc.documentElement).appendChild(el);
    });
    return carregando[arquivo];
  }

  /* ---------- Planilha falsa ---------- */

  function criar(opcoes) {
    opcoes = opcoes || {};
    // Scoring só quando precisa: a página do relatório (relatorio.html) não carrega o scoring.js.
    var scoringCarregado = null;
    function SCx() { return scoringCarregado || (scoringCarregado = obterScoring(opcoes)); }
    function temScoring() { try { SCx(); return true; } catch (e) { return false; } }
    var latencia = typeof opcoes.latenciaMs === 'number' ? opcoes.latenciaMs : LATENCIA_MS;
    var agora = typeof opcoes.agora === 'function' ? opcoes.agora : function () { return Date.now(); };
    var aleatorio = opcoes.aleatorio;
    var comSemente = opcoes.semente !== false;
    var memoria = {};             // usado quando o localStorage não está disponível
    var envios = {};              // limitador: janela -> quantidade (só nesta página, como o CacheService)

    function armazenamento() {
      if (opcoes.armazenamento !== undefined) return opcoes.armazenamento;
      try { return root.localStorage || null; } catch (e) { return null; }
    }

    function lerChave(chave, padrao) {
      var bruto = null;
      try { var a = armazenamento(); if (a) bruto = a.getItem(chave); } catch (e) { bruto = null; }
      if (bruto === null || bruto === undefined) {
        return Object.prototype.hasOwnProperty.call(memoria, chave) ? copiar(memoria[chave]) : padrao;
      }
      try { return JSON.parse(bruto); } catch (e) { return padrao; }
    }

    function gravarChave(chave, valor) {
      memoria[chave] = copiar(valor);
      try { var a = armazenamento(); if (a) a.setItem(chave, JSON.stringify(valor)); } catch (e) { /* fica na memória */ }
    }

    function lerLista(chave) {
      var arr = lerChave(chave, []);
      return Array.isArray(arr) ? arr.filter(function (l) { return l && typeof l === 'object'; }) : [];
    }

    function ler() { garantirSemente(); return lerLista(CHAVE_ARMAZENAMENTO); }
    function gravar(linhas) { gravarChave(CHAVE_ARMAZENAMENTO, linhas); }

    function recalcular(respostas) {
      if (typeof respostas !== 'string' || !/^[1-4]{100}$/.test(respostas)) return null;
      var lista;
      var SC = SCx();
      try { lista = SC.descompactar(respostas); } catch (e) { return null; }
      if (!SC.validarRespostas(lista)) return null;
      var c = SC.calcular(lista);
      return { percentuais: c.percentuais, codigo: c.codigo };
    }

    // Mesmo texto e mesma ordem de verificação do validarPayload do Code.gs, mais o formulário do processo
    // (sem processo = formulário padrão, que dá o mesmo resultado do Code.gs).
    function validarPayload(p, formulario) {
      var form = normalizarFormulario(formulario);
      if (!p || typeof p !== 'object' || Array.isArray(p)) return erro('Dados do teste ausentes.');
      var id = limparTexto(p.id, 80);
      if (!/^[A-Za-z0-9_-]{6,64}$/.test(id)) return erro('Identificador do envio inválido.');
      var nome = limparTexto(p.nome, 120);
      if (!nomeValido(nome)) return erro('Informe o nome completo (nome e sobrenome).');
      var telefone = normalizarTelefone(p.telefone);
      if (!telefone) return erro('Telefone inválido. Informe DDD + número.');
      var idade = { ok: true, idade: null };
      var vazia = p.idade === null || p.idade === undefined || (typeof p.idade === 'string' && p.idade.trim() === '');
      if (form.campos.idade === 'obrigatorio' || (form.campos.idade === 'opcional' && !vazia)) {
        idade = validarIdade(p.idade);
        if (!idade.ok) return idade;
      }
      function campo(k, max) { return form.campos[k] === 'oculto' ? '' : limparTexto(p[k], max); }
      var funcao = campo('funcao', LIMITE_FUNCAO_EMPRESA);
      if (!funcao && form.campos.funcao === 'obrigatorio') return erro('Informe a função atual ou última.');
      var empresa = campo('empresa', LIMITE_FUNCAO_EMPRESA);
      if (!empresa && form.campos.empresa === 'obrigatorio') return erro('Informe a empresa atual ou última.');
      var email = campo('email', 120).toLowerCase();
      if (!email && form.campos.email === 'obrigatorio') return erro('Informe o e-mail.');
      if (email && !emailValido(email)) return erro('E-mail inválido.');
      var cidade = campo('cidade', 80);
      if (!cidade && form.campos.cidade === 'obrigatorio') return erro('Informe a cidade onde mora.');
      var extras = [];
      var enviados = Array.isArray(p.extras) ? p.extras : [];
      for (var q = 0; q < form.perguntas.length; q++) {
        var pergunta = form.perguntas[q];
        var achado = null;
        for (var e = 0; e < enviados.length; e++) {
          var x = enviados[e];
          if (x && typeof x === 'object' && !Array.isArray(x) && typeof x.id === 'string' && x.id === pergunta.id) { achado = x; break; }
        }
        var resposta = achado ? limparTexto(achado.resposta, 500) : '';
        if (!resposta) {
          if (pergunta.obrigatoria) return erro('Responda a pergunta "' + pergunta.texto + '".');
          continue;
        }
        extras.push({ id: pergunta.id, pergunta: pergunta.texto, resposta: resposta });
      }
      if (p.consentimento !== true) return erro('É necessário aceitar o uso dos dados para participar.');
      var respostas = typeof p.respostas === 'string' ? p.respostas.trim() : '';
      if (!recalcular(respostas)) return erro('Respostas do teste inválidas ou incompletas.');
      var avaliacao = '';
      if (p.avaliacao !== undefined && p.avaliacao !== null && String(p.avaliacao).trim() !== '') {
        avaliacao = normalizarCodigoAvaliacao(p.avaliacao);
        if (!avaliacao) return erro(MSG_LINK_INATIVO);
      }
      var validacao = validarValidacao(p.validacao);
      if (!validacao.ok) return validacao;
      var inicio = dataIsoOuVazio(p.inicio);
      var fim = dataIsoOuVazio(p.fim);
      var duracao = Number(p.duracaoSeg);
      if (!isFinite(duracao) || duracao < 0 || duracao > 7 * 86400) {
        duracao = (inicio && fim) ? Math.max(0, Math.round((Date.parse(fim) - Date.parse(inicio)) / 1000)) : 0;
      }
      return {
        ok: true,
        payload: {
          v: 1, id: id, nome: nome, telefone: telefone, idade: idade.idade,
          funcao: funcao, empresa: empresa, email: email, cidade: cidade, extras: extras,
          vaga: limparTexto(p.vaga, 120), consentimento: true,
          inicio: inicio, fim: fim, duracaoSeg: Math.round(duracao), respostas: respostas,
          avaliacao: avaliacao, validacao: validacao.validacao
        }
      };
    }

    function indice(linhas, id) {
      for (var i = 0; i < linhas.length; i++) if (String(linhas[i].id) === id) return i;
      return -1;
    }

    function usados(linhas) {
      var mapa = {};
      linhas.forEach(function (l) { var p = normalizarProtocolo(l.protocolo); if (p) mapa[p] = true; });
      return mapa;
    }

    function permitirEnvio() {
      var janela = Math.floor(agora() / (JANELA_ENVIOS_SEG * 1000));
      var atual = envios[janela] || 0;
      if (atual >= LIMITE_ENVIOS_JANELA) return false;
      envios = {};
      envios[janela] = atual + 1;
      return true;
    }

    /* ----- cadastros ----- */

    function usuarios() { garantirSemente(); return lerLista(CHAVES.usuarios); }
    function empresas() { garantirSemente(); return lerLista(CHAVES.empresas); }
    function avaliacoes() { garantirSemente(); return lerLista(CHAVES.avaliacoes); }
    function relatoriosSalvos() { garantirSemente(); return lerLista(CHAVES.relatorios); }
    function vinculos() { return lerLista(CHAVES.vinculos); }
    function relacoesTodas() { return lerLista(CHAVES.relacoes); }
    function obterMotor() { return opcoes.motor || exigirModulo('DISC_RELATORIO', './relatorio-motor.js'); }
    function obterFixture() { return opcoes.fixture || exigirModulo('DISC_FIXTURE_PROCESSO', './fixture-processo-exemplo.js'); }
    function mapaEmpresas() {
      var m = {};
      empresas().forEach(function (e) { m[e.id] = e.nome; });
      return m;
    }
    function respostasPorAvaliacao() {
      var m = {};
      ler().forEach(function (l) { var c = normalizarCodigoAvaliacao(l.avaliacao); if (c) m[c] = (m[c] || 0) + 1; });
      return m;
    }
    function novoId(prefixo) { return prefixo + '_' + hexAleatorio(6); }
    function agoraIso() { return new Date(agora()).toISOString(); }
    function letrasContadas(t) { return letras(t).length; }

    function definirSenha(u, senha) {
      u.sal = hexAleatorio(16);
      u.hash = hashSenha(senha, u.sal);
      u.tentativas = 0;
      u.bloqueadoAte = 0;
    }
    function senhaConfere(senha, u) {
      if (typeof senha !== 'string' || !senha || senha.length > SENHA_MAX || !u.sal || !u.hash) return false;
      return iguaisSeguro(hashSenha(senha, u.sal), u.hash);
    }

    function usuarioPublico(u, emp) {
      return {
        id: u.id, nome: u.nome, email: u.email, papel: u.papel,
        empresaId: u.papel === 'gestor' ? u.empresaId : '',
        empresaNome: u.papel === 'gestor' ? (emp[u.empresaId] || '') : ''
      };
    }

    /* ----- sessões (no lugar do CacheService) ----- */

    function marcaSenha(u) { return String(u.hash || '').substring(0, 16); }
    function sessoes() {
      var s = lerChave(CHAVES.sessoes, {});
      return s && typeof s === 'object' && !Array.isArray(s) ? s : {};
    }
    function gravarSessao(token, u) {
      var s = sessoes();
      var t = agora();
      Object.keys(s).forEach(function (k) { if (!s[k] || s[k].expira <= t) delete s[k]; });
      s[token] = { usuarioId: u.id, h: marcaSenha(u), expira: t + VALIDADE_SESSAO_MS };
      gravarChave(CHAVES.sessoes, s);
    }
    function criarSessao(u) {
      var token = hexAleatorio(32);
      gravarSessao(token, u);
      return token;
    }
    function encerrarSessao(token) {
      var s = sessoes();
      if (s[token]) { delete s[token]; gravarChave(CHAVES.sessoes, s); }
    }
    function validarSessao(token) {
      var expirada = erro(MSG_SESSAO, { sessaoExpirada: true });
      if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) return expirada;
      var s = sessoes()[token];
      if (!s || !(s.expira > agora())) return expirada;
      var u = buscarPor(usuarios(), 'id', s.usuarioId);
      if (!u || !u.ativo || PAPEIS.indexOf(u.papel) === -1 || s.h !== marcaSenha(u)) { encerrarSessao(token); return expirada; }
      gravarSessao(token, u);
      return { ok: true, usuario: u, token: token };
    }

    function podeVerEmpresa(u, empresaId) {
      if (u.papel === 'admin') return true;
      return !!u.empresaId && empresaId === u.empresaId;
    }

    /* ----- ações públicas ----- */

    /* ----- pessoas (mesma pessoa = mesmo WhatsApp normalizado) ----- */

    function pessoas() { return lerLista(CHAVES.pessoas); }
    function gravarPessoas(lista) { gravarChave(CHAVES.pessoas, lista); }

    // Acha/cria a ficha pelo telefone. sobrescrever=true (envio): nome do envio e campos não vazios do envio;
    // false (linha antiga sem pessoa): só preenche o que estiver vazio na ficha.
    function pessoaDoEnvio(lista, dados, sobrescrever, quando) {
      var tel = normalizarTelefone(dados.telefone);
      if (!tel) return null;
      var p = buscarPor(lista, 'telefone', tel);
      if (!p) {
        p = { id: novoId('pes'), telefone: tel, nome: '', idade: null, funcao: '', empresa: '', email: '', cidade: '',
          criadoEm: quando, atualizadoEm: quando };
        lista.push(p);
        sobrescrever = true;
      }
      ['nome', 'funcao', 'empresa', 'email', 'cidade'].forEach(function (k) {
        var v = String(dados[k] == null ? '' : dados[k]);
        if (v && (sobrescrever || !p[k])) p[k] = v;
      });
      var idade = idadeGravada(dados.idade);
      if (idade !== null && (sobrescrever || p.idade === null || p.idade === undefined)) p.idade = idade;
      if (sobrescrever) p.atualizadoEm = quando;
      return p;
    }

    // Linhas gravadas antes das pessoas (prévia antiga): liga cada uma à pessoa do mesmo telefone.
    function ligarPessoas(linhas) {
      var semPessoa = linhas.filter(function (l) { return !l.pessoaId && normalizarTelefone(l.telefone); });
      if (!semPessoa.length) return false;
      var lista = pessoas();
      semPessoa.slice().sort(function (a, b) { return String(b.recebidoEm || '').localeCompare(String(a.recebidoEm || '')); })
        .forEach(function (l) {
          var p = pessoaDoEnvio(lista, l, false, String(l.recebidoEm || agoraIso()));
          if (p) l.pessoaId = p.id;
        });
      gravarPessoas(lista);
      return true;
    }

    // Exclusão: a pessoa que ficou sem respostas sai junto (LGPD).
    // Menos quem é colaborador ATIVO de alguma empresa (continua no time, sem resultado).
    function apagarPessoasOrfas(linhas) {
      var comResposta = {};
      linhas.forEach(function (l) { if (l.pessoaId) comResposta[l.pessoaId] = true; });
      vinculos().forEach(function (v) { if (v.status === 'ativo') comResposta[v.pessoaId] = true; });
      var lista = pessoas();
      var ficam = lista.filter(function (p) { return comResposta[p.id]; });
      if (ficam.length === lista.length) return;
      gravarPessoas(ficam);
      // "on delete cascade": vínculos, relações e relatórios das pessoas excluídas saem junto
      var vivas = {};
      ficam.forEach(function (p) { vivas[p.id] = true; });
      gravarChave(CHAVES.vinculos, vinculos().filter(function (v) { return vivas[v.pessoaId]; }));
      gravarChave(CHAVES.relacoes, relacoesTodas().filter(function (r) { return vivas[r.de] && vivas[r.para]; }));
      gravarChave(CHAVES.relatorios, relatoriosSalvos().filter(function (r) { return !r.pessoaId || vivas[r.pessoaId]; }));
    }

    function formularioDoProcesso(av) { return av ? configDoProcesso(av).formulario : normalizarFormulario(null); }

    function acaoEnviar(bruto) {
      // Formulário do processo do link (link inexistente/desativado: padrão; a recusa vem depois, como no servidor).
      var form = null;
      if (bruto && typeof bruto === 'object' && !Array.isArray(bruto)) {
        var cod = normalizarCodigoAvaliacao(bruto.avaliacao);
        var avForm = cod ? buscarPor(avaliacoes(), 'codigo', cod) : null;
        if (avForm && avForm.ativa) form = formularioDoProcesso(avForm);
      }
      var v = validarPayload(bruto, form);
      if (!v.ok) return v;
      var payload = v.payload;
      var linhas = ler();
      var i = indice(linhas, payload.id);
      if (i !== -1) {
        var gravado = normalizarProtocolo(linhas[i].protocolo);
        if (!gravado) {
          try { gravado = gerarProtocolo(usados(linhas), aleatorio); } catch (e) { return erro(e.message); }
          linhas[i].protocolo = gravado;
          gravar(linhas);
        }
        return { ok: true, duplicado: true, id: payload.id, protocolo: gravado };
      }
      payload.empresaId = '';
      var av = null;
      if (payload.avaliacao) {
        av = buscarPor(avaliacoes(), 'codigo', payload.avaliacao);
        if (!av || !av.ativa) return erro(MSG_LINK_INATIVO);
        payload.empresaId = av.empresaId;
      }
      if (linhas.length >= LIMITE_LINHAS) return erro('Limite de respostas atingido. Avise o recrutador.');
      var protocolo;
      try { protocolo = gerarProtocolo(usados(linhas), aleatorio); } catch (e) { return erro(e.message); }
      if (!permitirEnvio()) return erro('Muitos envios em pouco tempo. Aguarde alguns minutos e tente novamente.');
      var linha = {};
      for (var k in payload) if (Object.prototype.hasOwnProperty.call(payload, k)) linha[k] = payload[k];
      linha.recebidoEm = new Date(agora()).toISOString();
      linha.status = STATUS_PADRAO;
      linha.observacoes = '';
      linha.protocolo = protocolo;
      var lsPessoas = pessoas();
      var pessoa = pessoaDoEnvio(lsPessoas, payload, true, linha.recebidoEm);
      linha.pessoaId = pessoa ? pessoa.id : '';
      gravarPessoas(lsPessoas);
      linhas.push(linha);
      gravar(linhas);
      // Teste de equipe: link de processo 'equipe' ligado a uma empresa cria o vínculo ativo (cargo = função),
      // se a pessoa ainda não tiver vínculo ativo em NENHUMA empresa.
      if (pessoa && av && av.tipo === 'equipe' && av.empresaId && buscarPor(empresas(), 'id', av.empresaId)) {
        var lsV = vinculos();
        if (!lsV.some(function (x) { return x.pessoaId === pessoa.id && x.status === 'ativo'; })) {
          lsV.push(novoVinculo(pessoa.id, av.empresaId, payload.funcao, ''));
          gravarChave(CHAVES.vinculos, lsV);
        }
      }
      return { ok: true, id: payload.id, protocolo: protocolo };
    }

    function acaoAvaliacaoPublica(codigoBruto) {
      var codigo = normalizarCodigoAvaliacao(codigoBruto);
      if (!codigo) return erro(MSG_LINK_INVALIDO);
      var av = buscarPor(avaliacoes(), 'codigo', codigo);
      if (!av || !av.ativa) return erro(MSG_LINK_INVALIDO);
      return {
        ok: true,
        avaliacao: { codigo: av.codigo, nome: av.nome, tipo: av.tipo, empresaNome: mapaEmpresas()[av.empresaId] || av.empresa || '', mostrarResultado: av.mostrarResultado === true,
          formulario: formularioDoProcesso(av) }
      };
    }

    // E-mail inexistente ou desativado: conta as tentativas e bloqueia na 5ª, igual a um e-mail cadastrado
    // (mesma regra do Code.gs: nem a mensagem nem o bloqueio revelam se o e-mail existe). Só em memória.
    var falhasDesconhecidos = Object.create(null);
    function falhaEmailDesconhecido(email) {
      var reg = falhasDesconhecidos[email] || { n: 0, ate: 0 };
      var t = agora();
      if (reg.ate && reg.ate > t) return erro(MSG_BLOQUEIO, { bloqueado: true });
      if (reg.ate) { reg.n = 0; reg.ate = 0; }
      reg.n += 1;
      falhasDesconhecidos[email] = reg;
      if (reg.n >= MAX_TENTATIVAS_LOGIN) {
        reg.n = 0;
        reg.ate = t + BLOQUEIO_MS;
        return erro(MSG_BLOQUEIO, { bloqueado: true });
      }
      return erro(MSG_LOGIN_INVALIDO);
    }

    function acaoLogin(emailBruto, senha) {
      var email = normalizarEmail(emailBruto);
      if (!email || typeof senha !== 'string' || !senha) return erro('Informe o e-mail e a senha.');
      var lista = usuarios();
      var u = buscarPor(lista, 'email', email);
      if (!u || !u.ativo) {
        hashSenha(senha.substring(0, SENHA_MAX), 'sal-falso-para-gastar-o-mesmo-tempo');
        return falhaEmailDesconhecido(email);
      }
      var t = agora();
      if (u.bloqueadoAte && u.bloqueadoAte > t) return erro(MSG_BLOQUEIO, { bloqueado: true });
      if (!senhaConfere(senha, u)) {
        u.tentativas = (u.tentativas || 0) + 1;
        if (u.tentativas >= MAX_TENTATIVAS_LOGIN) {
          u.tentativas = 0;
          u.bloqueadoAte = t + BLOQUEIO_MS;
          gravarChave(CHAVES.usuarios, lista);
          return erro(MSG_BLOQUEIO, { bloqueado: true });
        }
        gravarChave(CHAVES.usuarios, lista);
        return erro(MSG_LOGIN_INVALIDO);
      }
      if (u.tentativas || u.bloqueadoAte) { u.tentativas = 0; u.bloqueadoAte = 0; gravarChave(CHAVES.usuarios, lista); }
      return { ok: true, token: criarSessao(u), usuario: usuarioPublico(u, mapaEmpresas()) };
    }

    function acaoPrimeiroAcesso(corpo) {
      var chave = corpo.chave;
      if (typeof chave !== 'string' || !chave || !iguaisSeguro(chave.trim(), CHAVE_ADMIN)) {
        return erro('Chave de primeiro acesso inválida.', { naoAutorizado: true });
      }
      var nome = limparTexto(corpo.nome, 80);
      if (letrasContadas(nome) < 2) return erro('Informe o seu nome.');
      var email = normalizarEmail(corpo.email);
      if (!emailValido(email)) return erro('E-mail inválido.');
      var s = validarSenhaNova(corpo.senha);
      if (!s.ok) return s;
      var lista = usuarios();
      var u = buscarPor(lista, 'email', email);
      var redefinida = false;
      if (u) {
        if (u.papel !== 'admin') return erro('Este e-mail já é usado por um gestor. Use outro e-mail.');
        redefinida = true;
        u.nome = nome;
        u.ativo = true;
      } else {
        u = { id: novoId('usr'), email: email, nome: nome, papel: 'admin', empresaId: '', ativo: true, criadoEm: agoraIso() };
        lista.push(u);
      }
      definirSenha(u, corpo.senha);
      gravarChave(CHAVES.usuarios, lista);
      return { ok: true, redefinida: redefinida, token: criarSessao(u), usuario: usuarioPublico(u, mapaEmpresas()) };
    }

    /* ----- ações com sessão ----- */

    function acaoTrocarSenha(usuario, corpo, token) {
      var s = validarSenhaNova(corpo.novaSenha);
      if (!s.ok) return s;
      var lista = usuarios();
      var u = buscarPor(lista, 'id', usuario.id);
      if (!u) return erro(MSG_SESSAO, { sessaoExpirada: true });
      if (!senhaConfere(corpo.senhaAtual, u)) return erro('Senha atual incorreta.');
      definirSenha(u, corpo.novaSenha);
      gravarChave(CHAVES.usuarios, lista);
      gravarSessao(token, u);
      return { ok: true };
    }

    function linhaParaItem(l) {
      var respostas = String(l.respostas == null ? '' : l.respostas).replace(/\D/g, '');
      var status = STATUS_VALIDOS.indexOf(l.status) >= 0 ? l.status : STATUS_PADRAO;
      return {
        v: 1,
        id: String(l.id == null ? '' : l.id),
        nome: String(l.nome == null ? '' : l.nome),
        telefone: String(l.telefone == null ? '' : l.telefone).replace(/\D/g, ''),
        vaga: String(l.vaga == null ? '' : l.vaga),
        consentimento: l.consentimento === true,
        inicio: String(l.inicio || ''),
        fim: String(l.fim || ''),
        duracaoSeg: Number(l.duracaoSeg) || 0,
        respostas: respostas,
        resultado: recalcular(respostas),
        status: status,
        observacoes: String(l.observacoes == null ? '' : l.observacoes),
        recebidoEm: String(l.recebidoEm || ''),
        protocolo: normalizarProtocolo(l.protocolo),
        idade: idadeGravada(l.idade),
        funcao: String(l.funcao == null ? '' : l.funcao),
        empresa: String(l.empresa == null ? '' : l.empresa),
        avaliacao: normalizarCodigoAvaliacao(l.avaliacao),
        empresaId: String(l.empresaId == null ? '' : l.empresaId),
        validacao: (l.validacao && typeof l.validacao === 'object' && !Array.isArray(l.validacao)) ? l.validacao : null,
        pessoaId: String(l.pessoaId || ''),
        pessoa: null,
        email: String(l.email == null ? '' : l.email),
        cidade: String(l.cidade == null ? '' : l.cidade),
        extras: (Array.isArray(l.extras) ? l.extras : []).filter(function (e) { return e && typeof e === 'object' && !Array.isArray(e); })
          .map(function (e) { return { id: String(e.id || ''), pergunta: String(e.pergunta || ''), resposta: String(e.resposta || '') }; })
      };
    }

    function pessoaPublica(p) {
      if (!p) return null;
      return { id: p.id, nome: p.nome || '', telefone: p.telefone || '', idade: idadeGravada(p.idade), funcao: p.funcao || '',
        empresa: p.empresa || '', email: p.email || '', cidade: p.cidade || '', atualizadoEm: p.atualizadoEm || '' };
    }

    function acaoListar(u) {
      var emp = mapaEmpresas();
      var avs = {};
      avaliacoes().forEach(function (a) { avs[a.codigo] = a; });
      var itens = [];
      var linhas = ler();
      if (ligarPessoas(linhas)) gravar(linhas);
      var fichas = {};
      pessoas().forEach(function (p) { fichas[p.id] = p; });
      linhas.forEach(function (l) {
        if (!String(l.id || '').trim()) return;
        var item = linhaParaItem(l);
        item.pessoa = pessoaPublica(fichas[item.pessoaId]);
        if (!item.pessoa) item.pessoaId = '';
        if (!podeVerEmpresa(u, item.empresaId)) return;
        var av = avs[item.avaliacao];
        item.empresaNome = emp[item.empresaId] || '';
        item.avaliacaoNome = av ? av.nome : '';
        item.avaliacaoTipo = av ? av.tipo : 'selecao';
        itens.push(item);
      });
      return { ok: true, itens: itens };
    }

    function acaoAtualizar(idBruto, campos, u) {
      var id = limparTexto(idBruto, 80);
      if (!id) return erro('Informe o id do candidato.');
      if (!campos || typeof campos !== 'object') return erro('Nada para atualizar.');
      var novoStatus = null, novasObs = null;
      if (campos.status !== undefined) {
        novoStatus = limparTexto(campos.status, 20);
        if (STATUS_VALIDOS.indexOf(novoStatus) === -1) return erro('Status inválido. Use: aprovado, reprovado ou em_analise.');
      }
      if (campos.observacoes !== undefined) novasObs = limparTextoLongo(campos.observacoes, 5000);
      if (novoStatus === null && novasObs === null) return erro('Nada para atualizar.');
      var linhas = ler();
      var i = indice(linhas, id);
      if (i === -1) return erro('Candidato não encontrado.');
      if (u && u.papel !== 'admin' && !podeVerEmpresa(u, String(linhas[i].empresaId || ''))) return erro(MSG_SEM_PERMISSAO);
      if (novoStatus !== null) linhas[i].status = novoStatus;
      if (novasObs !== null) linhas[i].observacoes = novasObs;
      gravar(linhas);
      return { ok: true, id: id };
    }

    function acaoExcluir(idBruto) {
      var id = limparTexto(idBruto, 80);
      if (!id) return erro('Informe o id do candidato.');
      var linhas = ler();
      var i = indice(linhas, id);
      if (i === -1) return erro('Candidato não encontrado.');
      linhas.splice(i, 1);
      gravar(linhas);
      apagarPessoasOrfas(linhas);
      return { ok: true, id: id };
    }

    function acaoExcluirTodos(avaliacaoBruta) {
      var filtrar = avaliacaoBruta !== undefined && avaliacaoBruta !== null && String(avaliacaoBruta).trim() !== '';
      var codigo = filtrar ? normalizarCodigoAvaliacao(avaliacaoBruta) : '';
      if (filtrar && !codigo) return erro('Código de avaliação inválido.');
      var linhas = ler();
      if (!filtrar) { gravar([]); apagarPessoasOrfas([]); return { ok: true, excluidos: linhas.length }; }
      var ficam = linhas.filter(function (l) { return normalizarCodigoAvaliacao(l.avaliacao) !== codigo; });
      gravar(ficam);
      apagarPessoasOrfas(ficam);
      return { ok: true, excluidos: linhas.length - ficam.length, avaliacao: codigo };
    }

    // criadaEm (nome do Code.gs) e criadoEm (nome do Supabase) com o mesmo valor.
    function empresaPublica(e, ativos) {
      var n = ativos ? (ativos[e.id] || 0) : vinculos().filter(function (v) { return v.empresaId === e.id && v.status === 'ativo'; }).length;
      return { id: e.id, nome: e.nome, criadaEm: e.criadaEm, cidade: e.cidade || '', observacoes: e.observacoes || '',
        ativo: e.ativo !== false, criadoEm: e.criadaEm || '', atualizadoEm: e.atualizadoEm || e.criadaEm || '', colaboradores: n };
    }
    function contagemAtivos() {
      var m = {};
      vinculos().forEach(function (v) { if (v.status === 'ativo') m[v.empresaId] = (m[v.empresaId] || 0) + 1; });
      return m;
    }
    function acaoEmpresasListar() {
      var n = contagemAtivos();
      return { ok: true, empresas: empresas().map(function (e) { return empresaPublica(e, n); }) };
    }

    function acaoEmpresasSalvar(dados) {
      if (!dados || typeof dados !== 'object') return erro('Dados da empresa ausentes.');
      function veio(k) { return Object.prototype.hasOwnProperty.call(dados, k) && dados[k] !== undefined; }
      var nome = limparTexto(dados.nome, 120);
      if (letrasContadas(nome) < 2) return erro('Informe o nome da empresa.');
      var id = limparTexto(dados.id, 40);
      var lista = empresas();
      if (lista.some(function (e) { return e.id !== id && String(e.nome).toLowerCase() === nome.toLowerCase(); })) {
        return erro('Já existe uma empresa com esse nome.');
      }
      var e;
      if (id) {
        e = buscarPor(lista, 'id', id);
        if (!e) return erro('Empresa não encontrada.');
        e.nome = nome;
        e.atualizadoEm = agoraIso();
      } else {
        e = { id: novoId('emp'), nome: nome, criadaEm: agoraIso(), cidade: '', observacoes: '', ativo: true };
        lista.push(e);
      }
      if (veio('cidade')) e.cidade = limparTexto(dados.cidade, 120);
      if (veio('observacoes')) e.observacoes = limparTextoLongo(dados.observacoes, 2000);
      if (veio('ativo')) e.ativo = dados.ativo !== false;
      gravarChave(CHAVES.empresas, lista);
      return { ok: true, empresa: empresaPublica(e) };
    }

    function acaoEmpresasExcluir(idBruto) {
      var id = limparTexto(idBruto, 40);
      var lista = empresas();
      var e = id && buscarPor(lista, 'id', id);
      if (!e) return erro('Empresa não encontrada.');
      if (vinculos().some(function (v) { return v.empresaId === id && v.status === 'ativo'; })) return erro('Desligue ou mova os colaboradores antes.');
      if (buscarPor(avaliacoes(), 'empresaId', id)) return erro('Esta empresa tem avaliações. Exclua as avaliações dela antes.');
      if (buscarPor(usuarios(), 'empresaId', id)) return erro('Esta empresa tem gestores ligados a ela. Exclua ou mude esses gestores antes.');
      gravarChave(CHAVES.empresas, lista.filter(function (x) { return x.id !== id; }));
      // "on delete cascade": histórico, relações e relatórios de equipe da empresa
      gravarChave(CHAVES.vinculos, vinculos().filter(function (v) { return v.empresaId !== id; }));
      gravarChave(CHAVES.relacoes, relacoesTodas().filter(function (r) { return r.empresaId !== id; }));
      gravarChave(CHAVES.relatorios, relatoriosSalvos().filter(function (r) { return !(r.modelo === 'equipe' && r.empresaId === id); }));
      return { ok: true, id: id };
    }

    /* ----- colaboradores (vínculos) e organograma — mesmas regras das funções do banco ----- */

    function dataHoje() { return agoraIso().slice(0, 10); }
    function novoVinculo(pessoaId, empresaId, cargo, area) {
      return { id: novoId('vin'), pessoaId: pessoaId, empresaId: empresaId, cargo: limparTexto(cargo, 120),
        area: limparTexto(area, 120), status: 'ativo', inicio: dataHoje(), fim: '', criadoEm: agoraIso() };
    }
    // Desliga o vínculo (fim = hoje) e apaga as relações da pessoa naquela empresa.
    function desligar(v) {
      v.status = 'desligado';
      v.fim = v.fim || dataHoje();
      gravarChave(CHAVES.relacoes, relacoesTodas().filter(function (r) {
        return !(r.empresaId === v.empresaId && (r.de === v.pessoaId || r.para === v.pessoaId));
      }));
    }
    function colaboradorPublico(v, fichas) {
      var p = fichas[v.pessoaId] || {};
      return { vinculoId: v.id, pessoaId: v.pessoaId, empresaId: v.empresaId, nome: p.nome || '', telefone: p.telefone || '',
        cargo: v.cargo || '', area: v.area || '', status: v.status === 'desligado' ? 'desligado' : 'ativo',
        inicio: v.inicio || '', fim: v.fim || '' };
    }
    function mapaPessoas() { var m = {}; pessoas().forEach(function (p) { m[p.id] = p; }); return m; }

    function acaoEquipeListar(empresaIdBruto) {
      var empresaId = limparTexto(empresaIdBruto, 40);
      var e = empresaId && buscarPor(empresas(), 'id', empresaId);
      if (!e) return erro('Empresa não encontrada.');
      var linhas = ler();
      if (ligarPessoas(linhas)) gravar(linhas);
      var fichas = mapaPessoas();
      var ultima = {};
      linhas.forEach(function (l) {
        if (!l.pessoaId) return;
        if (!ultima[l.pessoaId] || String(l.recebidoEm) > String(ultima[l.pessoaId].recebidoEm)) ultima[l.pessoaId] = l;
      });
      var todos = vinculos().filter(function (v) { return v.empresaId === empresaId; }).map(function (v) {
        var c = colaboradorPublico(v, fichas);
        delete c.empresaId;
        var l = ultima[v.pessoaId];
        c.resultado = l ? recalcular(String(l.respostas || '')) : null;
        c.respondidoEm = c.resultado ? String(l.recebidoEm || '') : '';
        return c;
      });
      var porNome = function (a, b) { return String(a.nome).localeCompare(String(b.nome), 'pt-BR'); };
      var ativos = todos.filter(function (c) { return c.status === 'ativo'; }).sort(porNome);
      var historico = todos.filter(function (c) { return c.status !== 'ativo'; })
        .sort(function (a, b) { return String(b.fim).localeCompare(String(a.fim)); });
      var ids = {};
      ativos.forEach(function (c) { ids[c.pessoaId] = true; });
      var relacoes = relacoesTodas().filter(function (r) { return r.empresaId === empresaId && ids[r.de] && ids[r.para]; })
        .map(function (r) { return { de: r.de, para: r.para, tipo: r.tipo }; });
      var emp = empresaPublica(e);
      emp.colaboradores = ativos.length;
      return { ok: true, empresa: emp, colaboradores: ativos, relacoes: relacoes, historico: historico };
    }

    function acaoColaboradorSalvar(dados) {
      if (!dados || typeof dados !== 'object') return erro('Dados do colaborador ausentes.');
      var empresaId = limparTexto(dados.empresaId, 40);
      if (!empresaId || !buscarPor(empresas(), 'id', empresaId)) return erro('Empresa não encontrada.');
      var cargo = limparTexto(dados.cargo, 120);
      var area = limparTexto(dados.area, 120);
      var lsP = pessoas();
      var pessoa;
      if (limparTexto(dados.pessoaId, 40)) {
        pessoa = buscarPor(lsP, 'id', limparTexto(dados.pessoaId, 40));
        if (!pessoa) return erro('Pessoa não encontrada.');
      } else {
        var nome = limparTexto(dados.nome, 120);
        if (!nomeValido(nome)) return erro('Informe o nome completo (nome e sobrenome).');
        if (!normalizarTelefone(dados.telefone)) return erro('Telefone inválido. Informe DDD + número.');
        pessoa = pessoaDoEnvio(lsP, { telefone: dados.telefone, nome: nome, funcao: cargo }, false, agoraIso());
        gravarPessoas(lsP);
      }
      var lsV = vinculos();
      var atual = null;
      lsV.forEach(function (v) { if (v.pessoaId === pessoa.id && v.status === 'ativo') atual = v; });
      if (atual && atual.empresaId !== empresaId) {
        var outra = buscarPor(empresas(), 'id', atual.empresaId);
        return erro('Esta pessoa já é colaboradora ativa de outra empresa (' + (outra ? outra.nome : '?') + '). Use "Mover" para trocar de empresa.');
      }
      if (atual) { atual.cargo = cargo; atual.area = area; }
      else { atual = novoVinculo(pessoa.id, empresaId, cargo, area); lsV.push(atual); }
      gravarChave(CHAVES.vinculos, lsV);
      return { ok: true, colaborador: colaboradorPublico(atual, mapaPessoas()) };
    }

    function acaoColaboradorMover(dados) {
      if (!dados || typeof dados !== 'object') return erro('Dados do colaborador ausentes.');
      var pessoaId = limparTexto(dados.pessoaId, 40);
      if (!pessoaId || !buscarPor(pessoas(), 'id', pessoaId)) return erro('Pessoa não encontrada.');
      var empresaId = limparTexto(dados.empresaId, 40);
      if (!empresaId || !buscarPor(empresas(), 'id', empresaId)) return erro('Empresa não encontrada.');
      var cargo = limparTexto(dados.cargo, 120);
      var area = limparTexto(dados.area, 120);
      var lsV = vinculos();
      var atual = null;
      lsV.forEach(function (v) { if (v.pessoaId === pessoaId && v.status === 'ativo') atual = v; });
      if (atual && atual.empresaId === empresaId) {
        atual.cargo = cargo;
        atual.area = area;
      } else {
        if (atual) desligar(atual);
        atual = novoVinculo(pessoaId, empresaId, cargo, area);
        lsV.push(atual);
      }
      gravarChave(CHAVES.vinculos, lsV);
      return { ok: true, colaborador: colaboradorPublico(atual, mapaPessoas()) };
    }

    function acaoColaboradorDesligar(idBruto) {
      var id = limparTexto(idBruto, 40);
      var lsV = vinculos();
      var v = id && buscarPor(lsV, 'id', id);
      if (!v || v.status !== 'ativo') return erro('Colaborador não encontrado ou já desligado.');
      desligar(v);
      gravarChave(CHAVES.vinculos, lsV);
      return { ok: true, id: id };
    }

    function acaoRelacoesSalvar(empresaIdBruto, lista) {
      var empresaId = limparTexto(empresaIdBruto, 40);
      if (!empresaId || !buscarPor(empresas(), 'id', empresaId)) return erro('Empresa não encontrada.');
      if (!Array.isArray(lista)) return erro('Relações inválidas.');
      if (lista.length > 2000) return erro('Relações demais.');
      var ativos = {};
      vinculos().forEach(function (v) { if (v.empresaId === empresaId && v.status === 'ativo') ativos[v.pessoaId] = true; });
      var novas = [];
      for (var i = 0; i < lista.length; i++) {
        var r = lista[i];
        if (!r || typeof r !== 'object' || Array.isArray(r)) return erro('Relações inválidas.');
        var de = limparTexto(r.de, 40);
        var para = limparTexto(r.para, 40);
        var tipo = limparTexto(r.tipo, 20);
        if (!de || !para) return erro('Relações inválidas.');
        if (TIPOS_RELACAO.indexOf(tipo) === -1) return erro('Tipo de relação inválido. Use: lidera, direto ou indireto.');
        if (de === para) return erro('Uma pessoa não pode ter relação com ela mesma.');
        if (!ativos[de] || !ativos[para]) return erro('As duas pessoas da relação precisam ser colaboradoras ativas desta empresa.');
        var repetida = null;
        novas.forEach(function (n) { if (n.de === de && n.para === para) repetida = n; });
        if (repetida) repetida.tipo = tipo; // repetida: vale a última
        else novas.push({ empresaId: empresaId, de: de, para: para, tipo: tipo });
      }
      gravarChave(CHAVES.relacoes, relacoesTodas().filter(function (r) { return r.empresaId !== empresaId; }).concat(novas));
      return { ok: true, relacoes: novas.map(function (r) { return { de: r.de, para: r.para, tipo: r.tipo }; }) };
    }

    /* ----- relatórios por modelo (equipe, liderança, pessoa): snapshot pronto vindo do painel ----- */

    function urlRelatorio(token, baseUrl) {
      var base = baseSite(baseUrl);
      if (!base) { try { base = baseSite(root && root.location ? String(root.location.href) : ''); } catch (e) { base = ''; } }
      return base + 'relatorio.html?r=' + token;
    }
    function relModeloPublico(r) {
      var x = { id: r.id, token: r.token, modelo: r.modelo, status: r.status === 'publicado' ? 'publicado' : 'rascunho',
        titulo: r.relatorio && typeof r.relatorio.titulo === 'string' ? r.relatorio.titulo : '',
        empresaId: r.empresaId || '', pessoaId: r.pessoaId || '',
        criadoEm: r.criadoEm || '', atualizadoEm: r.atualizadoEm || '', publicadoEm: r.publicadoEm || '' };
      if (x.status === 'publicado') x.url = urlRelatorio(r.token);
      return x;
    }

    function acaoRelatorioModeloSalvar(dados) {
      if (!dados || typeof dados !== 'object') return erro('Dados do relatório ausentes.');
      var modelo = limparTexto(dados.modelo, 20);
      if (MODELOS_RELATORIO.indexOf(modelo) === -1) return erro('Modelo de relatório inválido. Use: equipe, lideranca ou pessoa.');
      var empresaId = limparTexto(dados.empresaId, 40);
      var pessoaId = limparTexto(dados.pessoaId, 40);
      if (empresaId && !buscarPor(empresas(), 'id', empresaId)) return erro('Empresa não encontrada.');
      if (pessoaId && !buscarPor(pessoas(), 'id', pessoaId)) return erro('Pessoa não encontrada.');
      if (modelo === 'equipe' && !empresaId) return erro('Escolha a empresa do relatório.');
      if (modelo !== 'equipe' && !pessoaId) return erro('Escolha a pessoa do relatório.');
      var snap = dados.dados;
      if (!snap || typeof snap !== 'object' || Array.isArray(snap)) return erro('Relatório vazio: gere o relatório antes de salvar.');
      if (snap.modelo !== undefined && snap.modelo !== modelo) return erro('Os dados não são de um relatório "' + modelo + '".');
      if (JSON.stringify(snap).length > MAX_DADOS_RELATORIO) return erro('Relatório grande demais (máximo 300 KB).');
      snap = copiar(snap);
      snap.modelo = modelo;
      var lista = relatoriosSalvos();
      var id = limparTexto(dados.id, 40);
      var t = agoraIso();
      var reg;
      if (id) {
        reg = buscarPor(lista, 'id', id);
        if (!reg || !reg.modelo || reg.modelo === 'processo') return erro('Relatório não encontrado.');
      } else {
        reg = { id: novoId('rel'), token: hexAleatorio(32), criadoEm: t, status: 'rascunho', publicadoEm: '' };
        lista.push(reg);
      }
      reg.modelo = modelo;
      reg.empresaId = empresaId;
      reg.pessoaId = pessoaId;
      reg.relatorio = snap;
      reg.atualizadoEm = t;
      if (dados.publicar === true) { reg.status = 'publicado'; reg.publicadoEm = reg.publicadoEm || t; }
      else if (dados.publicar === false) { reg.status = 'rascunho'; reg.publicadoEm = ''; }
      gravarChave(CHAVES.relatorios, lista);
      var r = { id: reg.id, token: reg.token, status: reg.status, modelo: modelo };
      if (reg.status === 'publicado') r.url = urlRelatorio(reg.token, dados.baseUrl);
      return { ok: true, relatorio: r };
    }

    function acaoRelatoriosModeloListar(filtro) {
      filtro = filtro && typeof filtro === 'object' ? filtro : {};
      var empresaId = limparTexto(filtro.empresaId, 40);
      var pessoaId = limparTexto(filtro.pessoaId, 40);
      var lista = relatoriosSalvos().filter(function (r) {
        return r.modelo && r.modelo !== 'processo' && (!empresaId || r.empresaId === empresaId) && (!pessoaId || r.pessoaId === pessoaId);
      }).map(relModeloPublico).sort(function (a, b) { return String(b.criadoEm).localeCompare(String(a.criadoEm)); });
      return { ok: true, relatorios: lista };
    }

    function acaoRelatorioModeloExcluir(idBruto) {
      var id = limparTexto(idBruto, 40);
      var lista = relatoriosSalvos();
      var reg = id && buscarPor(lista, 'id', id);
      if (!reg || !reg.modelo || reg.modelo === 'processo') return erro('Relatório não encontrado.');
      gravarChave(CHAVES.relatorios, lista.filter(function (r) { return r !== reg; }));
      return { ok: true, id: id };
    }

    function avaliacaoPublica(a, emp, contagem) {
      return {
        id: a.id, codigo: a.codigo, empresaId: a.empresaId, empresaNome: emp[a.empresaId] || a.empresa || '',
        nome: a.nome, tipo: a.tipo, mostrarResultado: a.mostrarResultado === true, ativa: a.ativa === true,
        criadaEm: a.criadaEm, respostas: contagem[a.codigo] || 0
      };
    }

    function acaoAvaliacoesListar(u) {
      var emp = mapaEmpresas();
      var contagem = respostasPorAvaliacao();
      return {
        ok: true,
        avaliacoes: avaliacoes().filter(function (a) { return podeVerEmpresa(u, a.empresaId); })
          .map(function (a) { return avaliacaoPublica(a, emp, contagem); })
      };
    }

    function acaoAvaliacoesSalvar(dados) { return salvarProcesso(dados, true); }

    /* ----- processos (interface nova: só admin, empresa como texto, campos do ClickUp e config) ----- */

    function configDoProcesso(a) {
      var bruto = {};
      try { bruto = a && a.config ? (typeof a.config === 'string' ? JSON.parse(a.config) : a.config) : {}; } catch (e) { bruto = {}; }
      var v = validarConfigProcesso(bruto);
      return v.ok ? v.config : validarConfigProcesso({}).config;
    }

    function processoPublico(a, emp, contagem) {
      var p = avaliacaoPublica(a, emp, contagem);
      p.empresa = a.empresa || emp[a.empresaId] || '';
      p.vaga = a.vaga || '';
      p.cidade = a.cidade || '';
      p.consultor = a.consultor || '';
      p.contratante = a.contratante || '';
      p.periodo = { inicio: a.periodoInicio || '', fim: a.periodoFim || '' };
      p.clickupListId = a.clickupListId || '';
      p.config = configDoProcesso(a);
      return p;
    }

    function acaoProcessosListar() {
      var emp = mapaEmpresas();
      var contagem = respostasPorAvaliacao();
      return { ok: true, processos: avaliacoes().map(function (a) { return processoPublico(a, emp, contagem); }) };
    }

    // Mesmo salvarProcesso_ do Code.gs. legado=true: avaliacoes.salvar (exige empresaId e tipo, como antes).
    function salvarProcesso(dados, legado) {
      var rotulo = legado ? 'avaliação' : 'processo';
      if (!dados || typeof dados !== 'object') return erro('Dados da ' + rotulo + ' ausentes.');
      function veio(k) { return Object.prototype.hasOwnProperty.call(dados, k) && dados[k] !== undefined; }
      var id = limparTexto(dados.id, 40);
      var nome = limparTexto(dados.nome, 80);
      if (letrasContadas(nome) < 2) return erro('Informe o nome ' + (legado ? 'da avaliação.' : 'do processo.'));
      var tipo = limparTexto(dados.tipo, 20);
      if (!legado && !tipo) tipo = 'selecao';
      if (TIPOS_AVALIACAO.indexOf(tipo) === -1) return erro('Tipo inválido. Use: selecao ou equipe.');
      var empresaId = limparTexto(dados.empresaId, 40);
      var extras = {};
      var textos = { empresa: 80, vaga: 120, cidade: 80, consultor: 80, contratante: 80 };
      Object.keys(textos).forEach(function (k) { if (veio(k)) extras[k] = limparTexto(dados[k], textos[k]); });
      if (veio('periodo')) {
        var per = dados.periodo && typeof dados.periodo === 'object' ? dados.periodo : {};
        var dataOk = function (d) { d = limparTexto(d, 10); return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : ''; };
        extras.periodoInicio = dataOk(per.inicio);
        extras.periodoFim = dataOk(per.fim);
      }
      if (veio('clickupListId')) {
        var lista = limparTexto(dados.clickupListId, 40);
        if (lista && !/^[A-Za-z0-9_-]{1,40}$/.test(lista)) return erro('ID da lista do ClickUp inválido.');
        extras.clickupListId = lista;
      }
      if (veio('config')) {
        var cfg = validarConfigProcesso(dados.config);
        if (!cfg.ok) return cfg;
        extras.config = JSON.stringify(cfg.config);
      }
      var emp = mapaEmpresas();
      if (legado || empresaId) {
        if (!empresaId || !Object.prototype.hasOwnProperty.call(emp, empresaId)) return erro('Escolha uma empresa válida.');
      }
      var registros = avaliacoes();
      var contagem = respostasPorAvaliacao();
      var a;
      if (id) {
        a = buscarPor(registros, 'id', id);
        if (!a) return erro(legado ? 'Avaliação não encontrada.' : 'Processo não encontrado.');
        if (!legado && !veio('empresaId')) empresaId = a.empresaId;
        if (a.empresaId !== empresaId && contagem[a.codigo]) return erro('Esta avaliação já tem respostas: não dá para trocar a empresa dela.');
        if (dados.ativa !== undefined) a.ativa = dados.ativa === true;
      } else {
        var usadosCod = {};
        registros.forEach(function (r) { usadosCod[r.codigo] = true; });
        a = { id: novoId('ava'), codigo: gerarCodigoAvaliacao(usadosCod), criadaEm: agoraIso(), ativa: dados.ativa !== false };
        if (!extras.config) extras.config = JSON.stringify(validarConfigProcesso({}).config);
        registros.push(a);
      }
      a.empresaId = empresaId;
      a.nome = nome;
      a.tipo = tipo;
      if (legado || veio('mostrarResultado') || !id) a.mostrarResultado = dados.mostrarResultado === true;
      Object.keys(extras).forEach(function (k) { a[k] = extras[k]; });
      gravarChave(CHAVES.avaliacoes, registros);
      return legado ? { ok: true, avaliacao: avaliacaoPublica(a, emp, contagem) }
        : { ok: true, processo: processoPublico(a, emp, contagem) };
    }

    /* ----- ClickUp (simulado: nunca chama o ClickUp) ----- */

    function acaoClickupStatus() {
      return { ok: true, configurado: true, conectado: true, usuario: 'Prévia', pastaConfigurada: true, iaConfigurada: true, avisos: [] };
    }

    function processoPronto(idBruto) {
      var id = limparTexto(idBruto, 40);
      var a = id && buscarPor(avaliacoes(), 'id', id);
      if (!a) return erro('Processo não encontrado.');
      if (!a.clickupListId) return erro(MSG_CU_SEM_LISTA);
      return { ok: true, processo: a };
    }

    // Dados normalizados do processo: os do processo gravado + candidatos/status da fixture.
    function dadosDoProcesso(a) {
      var fx = copiar(obterFixture());
      var config = configDoProcesso(a);
      if (!config.etapas.length) {
        var daFixture = validarConfigProcesso(fx.config || {});
        if (daFixture.ok) config = daFixture.config;
      }
      var candidatos = (Array.isArray(fx.candidatos) ? fx.candidatos : []).map(function (c) {
        delete c.antecedentes; // a prévia nunca mostra antecedentes
        return c;
      });
      return {
        processo: {
          id: a.id, nome: a.nome, codigo: a.codigo, empresa: a.empresa || mapaEmpresas()[a.empresaId] || '',
          vaga: a.vaga || '', cidade: a.cidade || '', consultor: a.consultor || '', contratante: a.contratante || '',
          periodo: { inicio: a.periodoInicio || '', fim: a.periodoFim || '' }, clickupListId: a.clickupListId || ''
        },
        config: config,
        status: Array.isArray(fx.status) ? fx.status : [],
        candidatos: candidatos,
        avisos: [AVISO_PREVIA].concat(Array.isArray(fx.avisos) ? fx.avisos : [])
      };
    }

    function acaoProcessoDados(id) {
      var p = processoPronto(id);
      if (!p.ok) return p;
      var d;
      try { d = dadosDoProcesso(p.processo); } catch (e) { return erro('Não foi possível ler o ClickUp: ' + e.message); }
      return { ok: true, processo: d.processo, config: d.config, status: d.status, candidatos: d.candidatos, avisos: d.avisos };
    }

    /* ----- relatórios (mesmas regras e mensagens do Relatorio.gs) ----- */

    function relTokenValido(t) {
      return typeof t === 'string' && (/^[0-9a-f]{40,128}$/.test(t) || t === PREVIA.relatorioToken);
    }

    // "Maria da Silva" -> "Maria S." (igual ao relNomeCurto_ do servidor).
    function nomeCurto(nome) {
      var partes = limparTexto(nome, 120).split(' ').filter(function (p) { return letras(p).length > 0; });
      if (partes.length < 2) return partes[0] || '';
      return partes[0] + ' ' + partes[partes.length - 1].charAt(0).toUpperCase() + '.';
    }

    // Roda o motor sem antecedentes; no fim troca qualquer nome completo por "Nome S." e tira o id da lista.
    function montarRelatorio(dados) {
      var M = obterMotor();
      if (!M || typeof M.montar !== 'function') throw new Error('motor do relatório indisponível.');
      var copia = copiar(dados);
      (copia.candidatos || []).forEach(function (c) { delete c.antecedentes; });
      var relatorio = M.montar(copia, { geradoEm: agoraIso() });
      if (relatorio && relatorio.processo) delete relatorio.processo.clickupListId;
      var json = JSON.stringify(relatorio);
      (dados.candidatos || []).forEach(function (c) {
        var completo = limparTexto(c.nome, 120);
        var curto = nomeCurto(completo);
        if (completo && curto && completo !== curto && completo.indexOf(' ') > 0) {
          json = json.split(JSON.stringify(completo).slice(1, -1)).join(JSON.stringify(curto).slice(1, -1));
        }
      });
      return JSON.parse(json);
    }

    // {lista, reg} do token, ou null. O relatório da semente é montado na primeira leitura.
    function relLer(token) {
      if (!relTokenValido(token)) return null;
      var lista = relatoriosSalvos();
      var reg = buscarPor(lista, 'token', token);
      if (!reg) return null;
      if (!reg.relatorio || typeof reg.relatorio !== 'object') {
        var a = buscarPor(avaliacoes(), 'id', reg.processoId);
        if (!a || !a.clickupListId) return null;
        reg.relatorio = montarRelatorio(dadosDoProcesso(a));
        gravarChave(CHAVES.relatorios, lista);
      }
      return { lista: lista, reg: reg };
    }

    // Ações do relatório de PROCESSO (editar textos, publicar, IA): não valem para os modelos novos.
    function relLerProcesso(token) {
      var lido = relLer(token);
      return lido && (!lido.reg.modelo || lido.reg.modelo === 'processo') ? lido : null;
    }

    function relGravar(lido) {
      lido.reg.atualizadoEm = agoraIso();
      gravarChave(CHAVES.relatorios, lido.lista);
    }

    function acaoRelatorioRascunho(processoId) {
      var p = processoPronto(processoId);
      if (!p.ok) return p;
      var dados, relatorio;
      try {
        dados = dadosDoProcesso(p.processo);
        relatorio = montarRelatorio(dados);
      } catch (e) {
        return erro('Não foi possível gerar o rascunho: ' + e.message);
      }
      var token = hexAleatorio(32);
      var lista = relatoriosSalvos();
      var t = agoraIso();
      lista.push({ token: token, processoId: p.processo.id, status: 'rascunho', criadoEm: t, publicadoEm: '', atualizadoEm: t, relatorio: relatorio });
      gravarChave(CHAVES.relatorios, lista);
      return { ok: true, relatorio: relatorio, token: token, avisos: dados.avisos || [] };
    }

    function acaoRelatorioSalvar(corpo) {
      var novos = (corpo.relatorio && typeof corpo.relatorio === 'object' && corpo.relatorio.textos) || corpo.textos;
      if (!novos || typeof novos !== 'object' || Array.isArray(novos)) return erro('Nada para salvar.');
      var lido = relLerProcesso(corpo.relatorioToken);
      if (!lido) return erro('Relatório não encontrado.');
      var textos = lido.reg.relatorio.textos || {};
      var alterados = 0;
      Object.keys(novos).forEach(function (id) {
        if (!Object.prototype.hasOwnProperty.call(textos, id)) return;
        var v = novos[id];
        var texto = typeof v === 'string' ? v : (v && typeof v.texto === 'string' ? v.texto : null);
        if (texto === null) return;
        texto = limparTextoLongo(texto, REL_MAX_TEXTO);
        if (texto === textos[id].texto) return;
        textos[id] = { texto: texto, origem: 'editado' };
        alterados++;
      });
      if (alterados) relGravar(lido);
      return { ok: true, relatorio: lido.reg.relatorio, alterados: alterados };
    }

    // Endereço do site a partir do baseUrl do painel (tira "admin.html", "?…" e "#…"). '' se não der.
    function baseSite(baseUrl) {
      var b = typeof baseUrl === 'string' ? baseUrl.trim() : '';
      b = b.split('#')[0].split('?')[0];
      if (!/^https?:\/\/[^\s"'<>]+$/.test(b)) return '';
      if (b.charAt(b.length - 1) !== '/') b = b.substring(0, b.lastIndexOf('/') + 1);
      return b;
    }

    function acaoRelatorioPublicar(token, baseUrl) {
      var lido = relLerProcesso(token);
      if (!lido) return erro('Relatório não encontrado.');
      lido.reg.status = 'publicado';
      lido.reg.publicadoEm = lido.reg.publicadoEm || agoraIso();
      relGravar(lido);
      // Na prévia o link não é comentado no ClickUp (o ClickUp nunca é chamado).
      return { ok: true, url: baseSite(baseUrl) + 'relatorio.html?r=' + token };
    }

    function acaoRelatorioDespublicar(token) {
      if (!relTokenValido(token)) return erro('Relatório não encontrado.');
      var lista = relatoriosSalvos();
      var reg = buscarPor(lista, 'token', token);
      if (!reg || (reg.modelo && reg.modelo !== 'processo')) return erro('Relatório não encontrado.');
      reg.status = 'rascunho';
      reg.publicadoEm = '';
      relGravar({ lista: lista, reg: reg });
      return { ok: true };
    }

    function acaoRelatoriosListar(processoId) {
      var filtro = limparTexto(processoId, 40);
      var lista = relatoriosSalvos().filter(function (r) {
        return (!r.modelo || r.modelo === 'processo') && (!filtro || r.processoId === filtro);
      }).map(function (r) {
        return { token: r.token, processoId: r.processoId, status: r.status === 'publicado' ? 'publicado' : 'rascunho',
          criadoEm: r.criadoEm, publicadoEm: r.publicadoEm || '', atualizadoEm: r.atualizadoEm };
      }).sort(function (a, b) { return String(b.criadoEm).localeCompare(String(a.criadoEm)); });
      return { ok: true, relatorios: lista };
    }

    // IA simulada: só marca os textos escolhidos com "[IA] " e origem 'ia' (nenhuma chamada externa).
    function acaoRelatorioMelhorarTextos(token, ids) {
      var lido = relLerProcesso(token);
      if (!lido) return erro('Relatório não encontrado.');
      var textos = lido.reg.relatorio.textos || {};
      var escolhidos = Array.isArray(ids) && ids.length
        ? ids.filter(function (id) { return typeof id === 'string' && Object.prototype.hasOwnProperty.call(textos, id); })
        : Object.keys(textos).filter(function (id) { return textos[id] && textos[id].origem === 'regra'; });
      escolhidos = escolhidos.slice(0, REL_MAX_TEXTOS_IA);
      if (!escolhidos.length) return erro('Nenhum texto para melhorar.');
      escolhidos.forEach(function (id) {
        var atual = String(textos[id].texto || '');
        var novo = atual.indexOf(PREFIXO_IA) === 0 ? atual : PREFIXO_IA + atual;
        textos[id] = { texto: limparTextoLongo(novo, REL_MAX_TEXTO), origem: 'ia' };
      });
      relGravar(lido);
      return { ok: true, relatorio: lido.reg.relatorio, alterados: escolhidos.length };
    }

    // PÚBLICA: só relatório publicado.
    function acaoRelatorioPublico(token) {
      var lido = null;
      try { lido = relLer(token); } catch (e) { lido = null; }
      if (!lido || lido.reg.status !== 'publicado') return erro(MSG_REL_NAO_ENCONTRADO);
      var relatorio = copiar(lido.reg.relatorio);
      if (relatorio && relatorio.processo) delete relatorio.processo.clickupListId;
      var modelo = MODELOS_RELATORIO.indexOf(lido.reg.modelo) >= 0 ? lido.reg.modelo : 'processo';
      return { ok: true, modelo: modelo, relatorio: relatorio, publicadoEm: lido.reg.publicadoEm };
    }

    function acaoAvaliacoesExcluir(idBruto) {
      var id = limparTexto(idBruto, 40);
      var lista = avaliacoes();
      var a = id && buscarPor(lista, 'id', id);
      if (!a) return erro('Avaliação não encontrada.');
      if (respostasPorAvaliacao()[a.codigo]) {
        return erro('Esta avaliação já tem respostas. Desative a avaliação em vez de excluir (ou exclua as respostas dela antes).');
      }
      gravarChave(CHAVES.avaliacoes, lista.filter(function (x) { return x.id !== id; }));
      return { ok: true, id: id };
    }

    function usuarioLista(u, emp, t) {
      var p = usuarioPublico(u, emp);
      p.ativo = u.ativo === true;
      p.criadoEm = u.criadoEm;
      p.bloqueado = !!(u.bloqueadoAte && u.bloqueadoAte > t);
      return p;
    }

    function adminsAtivos(lista, excetoId) {
      return lista.filter(function (u) { return u.papel === 'admin' && u.ativo && u.id !== excetoId; }).length;
    }

    function acaoUsuariosSalvar(atual, dados, senhaTemporaria) {
      if (!dados || typeof dados !== 'object') return erro('Dados do usuário ausentes.');
      var id = limparTexto(dados.id, 40);
      var nome = limparTexto(dados.nome, 80);
      if (letrasContadas(nome) < 2) return erro('Informe o nome do usuário.');
      var email = normalizarEmail(dados.email);
      if (!emailValido(email)) return erro('E-mail inválido.');
      var papel = limparTexto(dados.papel, 20);
      if (PAPEIS.indexOf(papel) === -1) return erro('Papel inválido. Use: admin ou gestor.');
      var empresaId = papel === 'gestor' ? limparTexto(dados.empresaId, 40) : '';
      var ativo = dados.ativo !== false;
      var temSenha = senhaTemporaria !== undefined && senhaTemporaria !== null && senhaTemporaria !== '';
      if (!id && !temSenha) return erro('Defina uma senha temporária para o novo usuário.');
      if (temSenha) { var s = validarSenhaNova(senhaTemporaria); if (!s.ok) return s; }
      var emp = mapaEmpresas();
      if (papel === 'gestor' && (!empresaId || !Object.prototype.hasOwnProperty.call(emp, empresaId))) return erro('Escolha a empresa do gestor.');
      var lista = usuarios();
      var outro = buscarPor(lista, 'email', email);
      if (outro && outro.id !== id) return erro('Já existe um usuário com este e-mail.');
      var u;
      if (id) {
        u = buscarPor(lista, 'id', id);
        if (!u) return erro('Usuário não encontrado.');
        if (u.id === atual.id && (!ativo || papel !== 'admin')) {
          return erro('Você não pode desativar o seu próprio acesso nem tirar o seu papel de administrador.');
        }
        if (u.papel === 'admin' && u.ativo && (papel !== 'admin' || !ativo) && adminsAtivos(lista, u.id) === 0) {
          return erro('Precisa existir pelo menos um administrador ativo.');
        }
      } else {
        u = { id: novoId('usr'), criadoEm: agoraIso() };
        lista.push(u);
      }
      u.nome = nome;
      u.email = email;
      u.papel = papel;
      u.empresaId = empresaId;
      u.ativo = ativo;
      if (temSenha) definirSenha(u, senhaTemporaria);
      gravarChave(CHAVES.usuarios, lista);
      return { ok: true, usuario: usuarioLista(u, emp, agora()) };
    }

    function acaoUsuariosExcluir(atual, idBruto) {
      var id = limparTexto(idBruto, 40);
      var lista = usuarios();
      var u = id && buscarPor(lista, 'id', id);
      if (!u) return erro('Usuário não encontrado.');
      if (u.id === atual.id) return erro('Você não pode excluir o seu próprio acesso.');
      if (u.papel === 'admin' && u.ativo && adminsAtivos(lista, u.id) === 0) return erro('Precisa existir pelo menos um administrador ativo.');
      gravarChave(CHAVES.usuarios, lista.filter(function (x) { return x.id !== id; }));
      return { ok: true, id: id };
    }

    function acaoUsuariosRedefinirSenha(idBruto, senhaTemporaria) {
      var id = limparTexto(idBruto, 40);
      var s = validarSenhaNova(senhaTemporaria);
      if (!s.ok) return s;
      var lista = usuarios();
      var u = id && buscarPor(lista, 'id', id);
      if (!u) return erro('Usuário não encontrado.');
      definirSenha(u, senhaTemporaria);
      gravarChave(CHAVES.usuarios, lista);
      return { ok: true, id: id };
    }

    var ACOES_COM_SESSAO = {
      'eu': { fn: function (u) { return { ok: true, usuario: usuarioPublico(u, mapaEmpresas()) }; } },
      'sair': { fn: function (u, c, token) { encerrarSessao(token); return { ok: true }; } },
      'trocarSenha': { fn: function (u, c, token) { return acaoTrocarSenha(u, c, token); } },
      'listar': { fn: function (u) { return acaoListar(u); } },
      'atualizar': { fn: function (u, c) { return acaoAtualizar(c.id, c.campos, u); } },
      'excluir': { soAdmin: true, fn: function (u, c) { return acaoExcluir(c.id); } },
      'excluirTodos': { soAdmin: true, fn: function (u, c) { return acaoExcluirTodos(c.avaliacao); } },
      'empresas.listar': { soAdmin: true, fn: function () { return acaoEmpresasListar(); } },
      'equipe.listar': { soAdmin: true, fn: function (u, c) { return acaoEquipeListar(c.empresaId); } },
      'colaboradores.salvar': { soAdmin: true, fn: function (u, c) { return acaoColaboradorSalvar(c.colaborador); } },
      'colaboradores.mover': { soAdmin: true, fn: function (u, c) { return acaoColaboradorMover(c.colaborador); } },
      'colaboradores.desligar': { soAdmin: true, fn: function (u, c) { return acaoColaboradorDesligar(c.id); } },
      'relacoes.salvar': { soAdmin: true, fn: function (u, c) { return acaoRelacoesSalvar(c.empresaId, c.relacoes); } },
      'relatorioModelo.salvar': { soAdmin: true, fn: function (u, c) { return acaoRelatorioModeloSalvar(c.relatorio); } },
      'relatoriosModelo.listar': { soAdmin: true, fn: function (u, c) { return acaoRelatoriosModeloListar(c.filtro); } },
      'relatorioModelo.excluir': { soAdmin: true, fn: function (u, c) { return acaoRelatorioModeloExcluir(c.id); } },
      'empresas.salvar': { soAdmin: true, fn: function (u, c) { return acaoEmpresasSalvar(c.empresa); } },
      'empresas.excluir': { soAdmin: true, fn: function (u, c) { return acaoEmpresasExcluir(c.id); } },
      'avaliacoes.listar': { fn: function (u) { return acaoAvaliacoesListar(u); } },
      'avaliacoes.salvar': { soAdmin: true, fn: function (u, c) { return acaoAvaliacoesSalvar(c.avaliacao); } },
      'avaliacoes.excluir': { soAdmin: true, fn: function (u, c) { return acaoAvaliacoesExcluir(c.id); } },
      'processos.listar': { soAdmin: true, fn: function () { return acaoProcessosListar(); } },
      'processos.salvar': { soAdmin: true, fn: function (u, c) { return salvarProcesso(c.processo, false); } },
      'processos.excluir': { soAdmin: true, fn: function (u, c) { return acaoAvaliacoesExcluir(c.id); } },
      'clickup.status': { soAdmin: true, fn: function () { return acaoClickupStatus(); } },
      'clickup.listas': { soAdmin: true, fn: function () { return { ok: true, listas: copiar(LISTAS_PREVIA) }; } },
      'processo.dados': { soAdmin: true, fn: function (u, c) { return acaoProcessoDados(c.id); } },
      'relatorio.rascunho': { soAdmin: true, fn: function (u, c) { return acaoRelatorioRascunho(c.processoId); } },
      'relatorio.salvar': { soAdmin: true, fn: function (u, c) { return acaoRelatorioSalvar(c); } },
      'relatorio.publicar': { soAdmin: true, fn: function (u, c) { return acaoRelatorioPublicar(c.relatorioToken, c.baseUrl); } },
      'relatorio.despublicar': { soAdmin: true, fn: function (u, c) { return acaoRelatorioDespublicar(c.relatorioToken); } },
      'relatorios.listar': { soAdmin: true, fn: function (u, c) { return acaoRelatoriosListar(c.processoId); } },
      'relatorio.melhorarTextos': { soAdmin: true, fn: function (u, c) { return acaoRelatorioMelhorarTextos(c.relatorioToken, c.ids); } },
      'usuarios.listar': {
        soAdmin: true,
        fn: function () {
          var emp = mapaEmpresas(); var t = agora();
          return { ok: true, usuarios: usuarios().map(function (u) { return usuarioLista(u, emp, t); }) };
        }
      },
      'usuarios.salvar': { soAdmin: true, fn: function (u, c) { return acaoUsuariosSalvar(u, c.usuario, c.senhaTemporaria); } },
      'usuarios.excluir': { soAdmin: true, fn: function (u, c) { return acaoUsuariosExcluir(u, c.id); } },
      'usuarios.redefinirSenha': { soAdmin: true, fn: function (u, c) { return acaoUsuariosRedefinirSenha(c.id, c.senhaTemporaria); } }
    };

    // Mesmo despacho do processarRequisicao_ do Code.gs (recebe o corpo já como objeto).
    function processar(corpo) {
      if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) return erro('Formato de requisição inválido.');
      var tamanho = 0;
      try { tamanho = JSON.stringify(corpo).length; } catch (e) { return erro('JSON inválido.'); }
      var acao = corpo.acao;
      if (tamanho > LIMITE_CORPO_RELATORIO) return erro('Requisição grande demais.');
      if (tamanho > LIMITE_CORPO && ACOES_CORPO_GRANDE.indexOf(acao) === -1) return erro('Requisição grande demais.');
      garantirSemente();
      if (acao === 'enviar') return acaoEnviar(corpo.payload);
      if (acao === 'relatorioPublico') return acaoRelatorioPublico(corpo.token);
      if (acao === 'avaliacaoPublica') return acaoAvaliacaoPublica(corpo.codigo);
      if (acao === 'login') return acaoLogin(corpo.email, corpo.senha);
      if (acao === 'primeiroAcesso') return acaoPrimeiroAcesso(corpo);
      if (typeof acao !== 'string' || !Object.prototype.hasOwnProperty.call(ACOES_COM_SESSAO, acao)) return erro('Ação desconhecida.');
      var sessao = validarSessao(corpo.token);
      if (!sessao.ok) return sessao;
      var regra = ACOES_COM_SESSAO[acao];
      if (regra.soAdmin && sessao.usuario.papel !== 'admin') return erro(MSG_SEM_PERMISSAO);
      return regra.fn(sessao.usuario, corpo, sessao.token);
    }

    /* ----- semente da prévia ----- */

    var semeando = false;
    function garantirSemente() {
      if (!comSemente || semeando) return;
      var base = !!lerChave(CHAVES.semente, null);
      var rel = !!lerChave(CHAVES.sementeRelatorio, null);
      var equipe = !!lerChave(CHAVES.sementeEquipe, null);
      if (base && rel && equipe) return;
      semeando = true;
      try {
        if (!base && temScoring()) { semear(); base = true; } // sem scoring.js (página do relatório) fica para a próxima página
        if (!rel) semearProcessoExemplo(); // prévias antigas (só com a semente base) ganham o processo de exemplo
        if (base && !equipe && temScoring()) semearEquipe(); // e a equipe da Clínica Exemplo
      } finally { semeando = false; }
    }

    // Processo de exemplo ligado à fixture + relatório JÁ PUBLICADO (token fixo). O conteúdo do relatório
    // é montado pelo motor na primeira leitura (o motor só é carregado quando alguém pede um relatório).
    function semearProcessoExemplo() {
      var t = agora();
      var dia = 24 * 3600 * 1000;
      var fx = null;
      try { fx = obterFixture(); } catch (e) { fx = null; }
      var fp = (fx && fx.processo) || {};
      var lsAv = lerLista(CHAVES.avaliacoes);
      if (!buscarPor(lsAv, 'id', PREVIA.processo.id) && !buscarPor(lsAv, 'codigo', PREVIA.processo.codigo)) {
        var cfg = validarConfigProcesso((fx && fx.config) || {});
        lsAv.push({
          id: PREVIA.processo.id, codigo: PREVIA.processo.codigo, empresaId: '', nome: PREVIA.processo.nome, tipo: 'selecao',
          mostrarResultado: true, ativa: true, criadaEm: new Date(t - 30 * dia).toISOString(),
          empresa: 'Cartório Exemplo', vaga: fp.vaga || 'Escrevente de atendimento', cidade: fp.cidade || 'Boa Vista / RR',
          consultor: fp.consultor || 'Consultor Exemplo', contratante: fp.contratante || 'Responsável Exemplo',
          periodoInicio: (fp.periodo && fp.periodo.inicio) || '', periodoFim: (fp.periodo && fp.periodo.fim) || '',
          clickupListId: fp.clickupListId || LISTAS_PREVIA[0].id,
          config: JSON.stringify(cfg.ok ? cfg.config : validarConfigProcesso({}).config)
        });
        gravarChave(CHAVES.avaliacoes, lsAv);
      }
      var lsRel = lerLista(CHAVES.relatorios);
      if (!buscarPor(lsRel, 'token', PREVIA.relatorioToken)) {
        var quando = new Date(t - 3 * dia).toISOString();
        lsRel.push({ token: PREVIA.relatorioToken, processoId: PREVIA.processo.id, status: 'publicado',
          criadoEm: quando, publicadoEm: quando, atualizadoEm: quando, relatorio: null });
        gravarChave(CHAVES.relatorios, lsRel);
      }
      gravarChave(CHAVES.sementeRelatorio, 1);
    }

    // Equipe da Clínica Exemplo: 4 colaboradores que responderam pelo link de equipe (EQP1), 1 sem teste,
    // organograma de 3 níveis e o Bruno (respondeu SEL1) desligado no histórico. Não duplica nada.
    function semearEquipe() {
      var t = agora();
      var dia = 24 * 3600 * 1000;
      var EMP = 'emp_previa_clinica';
      var lsEmp = lerLista(CHAVES.empresas);
      var emp = buscarPor(lsEmp, 'id', EMP);
      if (!emp) { gravarChave(CHAVES.sementeEquipe, 1); return; }
      if (emp.cidade === undefined) emp.cidade = 'Boa Vista / RR';
      if (emp.observacoes === undefined) emp.observacoes = 'Empresa fictícia da prévia: clínica com recepção, atendimento e equipe comercial.';
      if (emp.ativo === undefined) emp.ativo = true;
      gravarChave(CHAVES.empresas, lsEmp);

      var novos = [
        { id: 'previa-exemplo-06', nome: 'Marta Exemplo Diretora', telefone: '5511900000006', idade: 48, funcao: 'Diretora geral',
          respostas: respostasDe(['D', 'C', 'I', 'S'], ['C', 'D', 'S', 'I'], 3), validacao: { acertos: 3, notas: [5, 4, 4, 1], rapido: false, semMexer: 1 }, protocolo: '13F', dias: 9, duracao: 700 },
        { id: 'previa-exemplo-07', nome: 'Paulo Modelo Fictício', telefone: '5511900000007', idade: 39, funcao: 'Coordenador de atendimento',
          respostas: respostasDe(['C', 'S', 'D', 'I'], ['S', 'C', 'I', 'D'], 4), validacao: { acertos: 3, notas: [5, 3, 4, 2], rapido: false, semMexer: 2 }, protocolo: '24G', dias: 8, duracao: 820 },
        { id: 'previa-exemplo-08', nome: 'Lucas Fictício Exemplo', telefone: '5511900000008', idade: 26, funcao: 'Vendedor',
          respostas: respostasDe(['I', 'D', 'S', 'C'], ['D', 'I', 'C', 'S'], 3), validacao: { acertos: 2, notas: [4, 3, 4, 2], rapido: false, semMexer: 3 }, protocolo: '35H', dias: 7, duracao: 610 },
        { id: 'previa-exemplo-09', nome: 'Renata Exemplo Fictícia', telefone: '5511900000009', idade: 33, funcao: 'Recepcionista',
          respostas: respostasDe(['S', 'I', 'C', 'D'], ['I', 'S', 'D', 'C'], 4), validacao: { acertos: 3, notas: [5, 4, 4, 1], rapido: false, semMexer: 1 }, protocolo: '46J', dias: 5, duracao: 760 }
      ];
      var linhas = lerLista(CHAVE_ARMAZENAMENTO);
      var ocupados = usados(linhas);
      var lsPessoas = pessoas();
      novos.forEach(function (x) {
        if (indice(linhas, x.id) !== -1) return;
        var fim = t - x.dias * dia;
        var protocolo = ocupados[x.protocolo] ? gerarProtocolo(ocupados, aleatorio) : x.protocolo;
        ocupados[protocolo] = true;
        var linha = {
          v: 1, id: x.id, nome: x.nome, telefone: x.telefone, idade: x.idade, funcao: x.funcao, empresa: '',
          email: '', cidade: '', extras: [], vaga: '', consentimento: true,
          inicio: new Date(fim - x.duracao * 1000).toISOString(), fim: new Date(fim).toISOString(),
          duracaoSeg: x.duracao, respostas: x.respostas, avaliacao: 'EQP1', empresaId: EMP,
          validacao: validacaoDe(x.respostas, x.validacao),
          recebidoEm: new Date(fim + 2000).toISOString(), status: 'em_analise', observacoes: '', protocolo: protocolo
        };
        var p = pessoaDoEnvio(lsPessoas, linha, true, linha.recebidoEm);
        linha.pessoaId = p ? p.id : '';
        linhas.push(linha);
      });
      // Colaborador ainda sem teste (cadastrado só com nome e WhatsApp).
      pessoaDoEnvio(lsPessoas, { telefone: '5511900000010', nome: 'Tiago Modelo Sem Teste', funcao: 'Auxiliar administrativo' }, false,
        new Date(t - 30 * dia).toISOString());
      gravarPessoas(lsPessoas);
      gravar(linhas);

      var porTel = {};
      lsPessoas.forEach(function (p) { porTel[p.telefone] = p.id; });
      var lsV = lerLista(CHAVES.vinculos);
      [
        ['5511900000006', 'Diretora geral', 'Diretoria', 'ativo', 900],
        ['5511900000004', 'Supervisor de vendas', 'Comercial', 'ativo', 500],
        ['5511900000007', 'Coordenador de atendimento', 'Atendimento', 'ativo', 420],
        ['5511900000003', 'Vendedora', 'Comercial', 'ativo', 300],
        ['5511900000008', 'Vendedor', 'Comercial', 'ativo', 120],
        ['5511900000009', 'Recepcionista', 'Atendimento', 'ativo', 200],
        ['5511900000010', 'Auxiliar administrativo', 'Atendimento', 'ativo', 30],
        ['5511900000002', 'Auxiliar administrativo', 'Atendimento', 'desligado', 400]
      ].forEach(function (x, n) {
        var pid = porTel[x[0]];
        if (!pid) return;
        if (lsV.some(function (v) { return v.pessoaId === pid && v.empresaId === EMP; })) return;
        if (x[3] === 'ativo' && lsV.some(function (v) { return v.pessoaId === pid && v.status === 'ativo'; })) return;
        var inicio = new Date(t - x[4] * dia).toISOString();
        lsV.push({ id: 'vin_previa_' + (n + 1), pessoaId: pid, empresaId: EMP, cargo: x[1], area: x[2], status: x[3],
          inicio: inicio.slice(0, 10), fim: x[3] === 'desligado' ? new Date(t - 60 * dia).toISOString().slice(0, 10) : '', criadoEm: inicio });
      });
      gravarChave(CHAVES.vinculos, lsV);

      var lsR = lerLista(CHAVES.relacoes);
      [
        ['5511900000006', '5511900000004', 'lidera'], ['5511900000006', '5511900000007', 'lidera'],
        ['5511900000004', '5511900000003', 'lidera'], ['5511900000004', '5511900000008', 'lidera'],
        ['5511900000007', '5511900000009', 'lidera'], ['5511900000007', '5511900000010', 'lidera'],
        ['5511900000004', '5511900000007', 'direto'], ['5511900000003', '5511900000008', 'direto'],
        ['5511900000008', '5511900000009', 'indireto']
      ].forEach(function (x) {
        var de = porTel[x[0]];
        var para = porTel[x[1]];
        if (!de || !para) return;
        if (lsR.some(function (r) { return r.empresaId === EMP && r.de === de && r.para === para; })) return;
        lsR.push({ empresaId: EMP, de: de, para: para, tipo: x[2] });
      });
      gravarChave(CHAVES.relacoes, lsR);
      gravarChave(CHAVES.sementeEquipe, 1);
    }

    // 25 grupos: ordem principal, trocando para a alternativa a cada "cada" grupos (perfil com nuances).
    function respostasDe(principal, alternativa, cada) {
      var lista = [];
      for (var i = 0; i < TOTAL_GRUPOS; i++) {
        var ordem = (i % cada === 0) ? alternativa : principal;
        var g = {};
        ordem.forEach(function (l, idx) { g[l] = 4 - idx; });
        lista.push(g);
      }
      return SCx().compactar(lista);
    }

    // Validação de exemplo coerente com o perfil (notas: força P, sombra P, força S, contraste U).
    function validacaoDe(respostas, opcoesV) {
      var o = SCx().calcular(SCx().descompactar(respostas)).ordem;
      var acertos = opcoesV.acertos;
      var pares = [[o[0], o[3]], [o[1], o[2]], [o[0], o[2]]];
      var certas = [o[0], o[1], o[0]];
      var erradas = [o[3], o[2], o[2]];
      var notas = opcoesV.notas;
      var seg = [];
      for (var i = 0; i < TOTAL_GRUPOS; i++) seg.push(opcoesV.rapido ? (i % 5 === 0 ? 6 : 1.5 + (i % 3) * 0.4) : 6 + ((i * 7) % 11));
      return {
        versao: 1,
        pares: pares,
        escolhas: certas.map(function (l, k) { return k < acertos ? l : erradas[k]; }),
        itens: [
          { id: o[0] + '-f1', letra: o[0], tipo: 'forca', nota: notas[0] },
          { id: o[0] + '-s1', letra: o[0], tipo: 'sombra', nota: notas[1] },
          { id: o[1] + '-f2', letra: o[1], tipo: 'forca', nota: notas[2] },
          { id: o[3] + '-f3', letra: o[3], tipo: 'contraste', nota: notas[3] }
        ],
        gruposSeg: seg,
        semMexer: opcoesV.semMexer,
        demonstracao: false
      };
    }

    function semear() {
      var t = agora();
      var dia = 24 * 3600 * 1000;
      var emp = { id: 'emp_previa_clinica', nome: 'Clínica Exemplo', criadaEm: new Date(t - 20 * dia).toISOString(),
        cidade: 'Boa Vista / RR', observacoes: 'Empresa fictícia da prévia: clínica com recepção, atendimento e equipe comercial.', ativo: true };
      var lsEmp = lerLista(CHAVES.empresas);
      if (!buscarPor(lsEmp, 'id', emp.id)) { lsEmp.push(emp); gravarChave(CHAVES.empresas, lsEmp); }

      var lsAv = lerLista(CHAVES.avaliacoes);
      [
        { id: 'ava_previa_sel1', codigo: 'SEL1', empresaId: emp.id, nome: 'Recepcionista 2026', tipo: 'selecao', mostrarResultado: false, ativa: true, criadaEm: new Date(t - 15 * dia).toISOString() },
        { id: 'ava_previa_eqp1', codigo: 'EQP1', empresaId: emp.id, nome: 'Equipe comercial', tipo: 'equipe', mostrarResultado: true, ativa: true, criadaEm: new Date(t - 10 * dia).toISOString() },
        // Formulário próprio: e-mail obrigatório, cidade opcional e uma pergunta extra obrigatória.
        { id: 'ava_previa_atd1', codigo: 'ATD1', empresaId: emp.id, nome: 'Atendimento ao cliente', tipo: 'selecao', mostrarResultado: true, ativa: true, criadaEm: new Date(t - 8 * dia).toISOString(),
          empresa: 'Clínica Exemplo', vaga: 'Atendente',
          config: JSON.stringify(validarConfigProcesso({ formulario: {
            campos: { idade: 'obrigatorio', funcao: 'opcional', empresa: 'opcional', email: 'obrigatorio', cidade: 'opcional' },
            perguntas: [{ id: 'p1', texto: 'Qual sua disponibilidade de horário?', obrigatoria: true }]
          } }).config) }
      ].forEach(function (a) { if (!buscarPor(lsAv, 'codigo', a.codigo)) lsAv.push(a); });
      gravarChave(CHAVES.avaliacoes, lsAv);

      var lsUs = lerLista(CHAVES.usuarios);
      [
        { id: 'usr_previa_admin', email: PREVIA.admin.email, nome: 'Você (admin)', papel: 'admin', empresaId: '', senha: PREVIA.admin.senha },
        { id: 'usr_previa_gestor', email: PREVIA.gestor.email, nome: 'Gestor da Clínica Exemplo', papel: 'gestor', empresaId: emp.id, senha: PREVIA.gestor.senha }
      ].forEach(function (d) {
        if (buscarPor(lsUs, 'email', d.email)) return;
        var u = { id: d.id, email: d.email, nome: d.nome, papel: d.papel, empresaId: d.empresaId, ativo: true, criadoEm: new Date(t - 20 * dia).toISOString() };
        definirSenha(u, d.senha);
        lsUs.push(u);
      });
      gravarChave(CHAVES.usuarios, lsUs);

      var exemplos = [
        { id: 'previa-exemplo-01', nome: 'Ana Exemplo Prévia', avaliacao: 'SEL1', idade: 27, vaga: 'Recepcionista', funcao: 'Atendente', empresa: 'Padaria Fictícia',
          respostas: respostasDe(['I', 'S', 'D', 'C'], ['S', 'I', 'C', 'D'], 3), status: 'aprovado', observacoes: 'Exemplo da prévia: boa entrevista.',
          validacao: { acertos: 3, notas: [5, 4, 4, 2], rapido: false, semMexer: 1 }, protocolo: '12A', dias: 6, duracao: 840 },
        { id: 'previa-exemplo-02', nome: 'Bruno Teste Fictício', avaliacao: 'SEL1', idade: 35, vaga: 'Recepcionista', funcao: 'Auxiliar administrativo', empresa: 'Loja Imaginária',
          respostas: respostasDe(['D', 'C', 'I', 'S'], ['C', 'D', 'S', 'I'], 4), status: 'em_analise', observacoes: '',
          validacao: { acertos: 1, notas: [2, 1, 2, 5], rapido: true, semMexer: 19 }, protocolo: '34B', dias: 4, duracao: 95 },
        { id: 'previa-exemplo-03', nome: 'Carla Modelo Demonstração', avaliacao: 'EQP1', idade: 41, vaga: '', funcao: 'Vendedora', empresa: '',
          respostas: respostasDe(['S', 'C', 'I', 'D'], ['C', 'S', 'I', 'D'], 3), status: 'em_analise', observacoes: '',
          validacao: { acertos: 2, notas: [5, 2, 4, 2], rapido: false, semMexer: 14 }, protocolo: '56C', dias: 2, duracao: 720 },
        { id: 'previa-exemplo-04', nome: 'Diego Exemplo Simulado', avaliacao: 'EQP1', idade: 30, vaga: '', funcao: 'Supervisor de vendas', empresa: '',
          respostas: respostasDe(['D', 'I', 'C', 'S'], ['I', 'D', 'S', 'C'], 4), status: 'em_analise', observacoes: '',
          validacao: { acertos: 3, notas: [4, 4, 5, 1], rapido: false, semMexer: 0 }, protocolo: '78D', dias: 1, duracao: 660 },
        // A Ana de novo (mesmo WhatsApp): o painel junta as 2 respostas na mesma pessoa.
        { id: 'previa-exemplo-05', nome: 'Ana Exemplo Prévia', telefone: '5511900000001', avaliacao: 'ATD1', idade: 27, vaga: 'Atendente', funcao: 'Atendente', empresa: 'Padaria Fictícia',
          email: 'ana.exemplo@exemplo.com', cidade: 'Boa Vista / RR',
          extras: [{ id: 'p1', pergunta: 'Qual sua disponibilidade de horário?', resposta: 'Manhã e tarde, de segunda a sábado.' }],
          respostas: respostasDe(['I', 'S', 'C', 'D'], ['S', 'I', 'D', 'C'], 4), status: 'em_analise', observacoes: '',
          validacao: { acertos: 3, notas: [5, 3, 4, 2], rapido: false, semMexer: 2 }, protocolo: '90E', dias: 2, duracao: 780 }
      ];
      var linhas = lerLista(CHAVE_ARMAZENAMENTO);
      var ocupados = usados(linhas);
      var lsPessoas = pessoas();
      exemplos.forEach(function (x, n) {
        if (indice(linhas, x.id) !== -1) return;
        var fim = t - x.dias * dia;
        var protocolo = ocupados[x.protocolo] ? gerarProtocolo(ocupados, aleatorio) : x.protocolo;
        ocupados[protocolo] = true;
        var linha = {
          v: 1, id: x.id, nome: x.nome, telefone: x.telefone || ('551190000000' + (n + 1)), idade: x.idade, funcao: x.funcao, empresa: x.empresa,
          email: x.email || '', cidade: x.cidade || '', extras: x.extras || [],
          vaga: x.vaga, consentimento: true, inicio: new Date(fim - x.duracao * 1000).toISOString(), fim: new Date(fim).toISOString(),
          duracaoSeg: x.duracao, respostas: x.respostas, avaliacao: x.avaliacao, empresaId: emp.id,
          validacao: validacaoDe(x.respostas, x.validacao),
          recebidoEm: new Date(fim + 2000).toISOString(), status: x.status, observacoes: x.observacoes, protocolo: protocolo
        };
        var pessoa = pessoaDoEnvio(lsPessoas, linha, false, linha.recebidoEm);
        linha.pessoaId = pessoa ? pessoa.id : '';
        linhas.push(linha);
      });
      // Ficha com os dados do envio mais recente (como o servidor faria com os envios em ordem).
      lsPessoas.forEach(function (p) {
        linhas.filter(function (l) { return l.pessoaId === p.id; })
          .sort(function (a, b) { return String(a.recebidoEm).localeCompare(String(b.recebidoEm)); })
          .forEach(function (l) { pessoaDoEnvio(lsPessoas, l, true, l.recebidoEm); });
      });
      gravarPessoas(lsPessoas);
      gravar(linhas);
      gravarChave(CHAVES.semente, 1);
      semearProcessoExemplo();
    }

    // Como o DISC_API real: Promise que resolve com o JSON (ok === true) ou rejeita com Error em pt-BR
    // (com erro.sessaoExpirada e erro.resposta, iguais aos do js/api.js).
    function prepararDependencias(acao) {
      var semearExemplo = comSemente && !lerChave(CHAVES.sementeRelatorio, null); // a semente usa a fixture
      if ((ACOES_COM_MOTOR.indexOf(acao) === -1 && !semearExemplo) || (opcoes.motor && opcoes.fixture)) return Promise.resolve();
      return Promise.all([
        (opcoes.motor || ACOES_COM_MOTOR.indexOf(acao) === -1) ? null : carregarScript('relatorio-motor.js', 'DISC_RELATORIO'),
        opcoes.fixture ? null : carregarScript('fixture-processo-exemplo.js', 'DISC_FIXTURE_PROCESSO')
      ]);
    }

    function chamar(corpo) {
      return prepararDependencias(corpo && corpo.acao).then(function () { return chamarJa(corpo); });
    }

    function chamarJa(corpo) {
      return new Promise(function (resolver, rejeitar) {
        setTimeout(function () {
          var resp;
          try { resp = JSON.parse(JSON.stringify(processar(JSON.parse(JSON.stringify(corpo))))); }
          catch (e) { resp = erro('Erro interno no servidor. Tente novamente em instantes.'); }
          if (resp && resp.ok === true) { resolver(resp); return; }
          var e2 = new Error((resp && resp.erro) ? String(resp.erro) : 'O servidor recusou a solicitação.');
          e2.sessaoExpirada = !!(resp && resp.sessaoExpirada);
          e2.resposta = resp || null;
          rejeitar(e2);
        }, latencia);
      });
    }

    function exigir(valor, mensagem) {
      if (valor === undefined || valor === null || valor === '') throw new Error(mensagem);
    }
    function exigirToken(token) {
      if (typeof token !== 'string' || !token) {
        var e = new Error(MSG_SESSAO);
        e.sessaoExpirada = true;
        e.resposta = erro(MSG_SESSAO, { sessaoExpirada: true });
        throw e;
      }
    }
    function seguro(fn) {
      return function () {
        try { return fn.apply(null, arguments); } catch (e) { return Promise.reject(e); }
      };
    }
    function comSessao(acao, token, dados) {
      exigirToken(token);
      var corpo = { acao: acao, token: token };
      if (dados) for (var k in dados) if (Object.prototype.hasOwnProperty.call(dados, k)) corpo[k] = dados[k];
      return chamar(corpo);
    }

    return {
      simulada: true,
      CHAVE_ADMIN: CHAVE_ADMIN,
      PREVIA: PREVIA,
      processar: processar,
      ler: ler,
      limpar: function () { gravar([]); gravarPessoas([]); gravarChave(CHAVES.vinculos, []); gravarChave(CHAVES.relacoes, []); },
      // Volta a prévia ao estado inicial (apaga tudo e recria a semente).
      reiniciar: function () {
        [CHAVE_ARMAZENAMENTO, CHAVES.usuarios, CHAVES.empresas, CHAVES.avaliacoes, CHAVES.sessoes, CHAVES.relatorios, CHAVES.pessoas,
          CHAVES.vinculos, CHAVES.relacoes].forEach(function (k) {
          gravarChave(k, k === CHAVES.sessoes ? {} : []);
        });
        gravarChave(CHAVES.semente, 0);
        gravarChave(CHAVES.sementeRelatorio, 0);
        gravarChave(CHAVES.sementeEquipe, 0);
        garantirSemente();
      },
      enviar: seguro(function (payload) {
        exigir(payload, 'Nenhum resultado para enviar.');
        return chamar({ acao: 'enviar', payload: payload });
      }),
      avaliacaoPublica: seguro(function (codigo) {
        exigir(codigo, MSG_LINK_INVALIDO);
        return chamar({ acao: 'avaliacaoPublica', codigo: codigo });
      }),
      login: seguro(function (email, senha) {
        exigir(email, 'Informe o e-mail e a senha.');
        exigir(senha, 'Informe o e-mail e a senha.');
        return chamar({ acao: 'login', email: email, senha: senha });
      }),
      primeiroAcesso: seguro(function (chave, nome, email, senha) {
        exigir(chave, 'Informe a chave de primeiro acesso.');
        return chamar({ acao: 'primeiroAcesso', chave: chave, nome: nome, email: email, senha: senha });
      }),
      eu: seguro(function (token) { return comSessao('eu', token); }),
      sair: seguro(function (token) { return comSessao('sair', token); }),
      trocarSenha: seguro(function (token, senhaAtual, novaSenha) {
        return comSessao('trocarSenha', token, { senhaAtual: senhaAtual, novaSenha: novaSenha });
      }),
      listar: seguro(function (token) { return comSessao('listar', token); }),
      atualizar: seguro(function (token, id, campos) {
        exigirToken(token);
        exigir(id, 'Candidato não informado.');
        return comSessao('atualizar', token, { id: id, campos: campos || {} });
      }),
      excluir: seguro(function (token, id) {
        exigirToken(token);
        exigir(id, 'Candidato não informado.');
        return comSessao('excluir', token, { id: id });
      }),
      excluirTodos: seguro(function (token, avaliacao) {
        return comSessao('excluirTodos', token, avaliacao ? { avaliacao: avaliacao } : null);
      }),
      listarEmpresas: seguro(function (token) { return comSessao('empresas.listar', token); }),
      salvarEmpresa: seguro(function (token, empresa) { return comSessao('empresas.salvar', token, { empresa: empresa || {} }); }),
      excluirEmpresa: seguro(function (token, id) { return comSessao('empresas.excluir', token, { id: id }); }),
      listarAvaliacoes: seguro(function (token) { return comSessao('avaliacoes.listar', token); }),
      salvarAvaliacao: seguro(function (token, avaliacao) { return comSessao('avaliacoes.salvar', token, { avaliacao: avaliacao || {} }); }),
      excluirAvaliacao: seguro(function (token, id) { return comSessao('avaliacoes.excluir', token, { id: id }); }),
      listarUsuarios: seguro(function (token) { return comSessao('usuarios.listar', token); }),
      salvarUsuario: seguro(function (token, usuario, senhaTemporaria) {
        var dados = { usuario: usuario || {} };
        if (senhaTemporaria) dados.senhaTemporaria = senhaTemporaria;
        return comSessao('usuarios.salvar', token, dados);
      }),
      excluirUsuario: seguro(function (token, id) { return comSessao('usuarios.excluir', token, { id: id }); }),
      redefinirSenha: seguro(function (token, id, senhaTemporaria) {
        return comSessao('usuarios.redefinirSenha', token, { id: id, senhaTemporaria: senhaTemporaria });
      }),
      // Mesmas assinaturas do js/api.js (1º argumento = token da sessão; o do relatório vai como relatorioToken).
      processosListar: seguro(function (token) { return comSessao('processos.listar', token); }),
      processosSalvar: seguro(function (token, processo) { return comSessao('processos.salvar', token, { processo: processo || {} }); }),
      processosExcluir: seguro(function (token, id) {
        exigirToken(token);
        exigir(id, 'Processo não informado.');
        return comSessao('processos.excluir', token, { id: id });
      }),
      processoDados: seguro(function (token, id) {
        exigirToken(token);
        exigir(id, 'Processo não informado.');
        return comSessao('processo.dados', token, { id: id });
      }),
      clickupStatus: seguro(function (token) { return comSessao('clickup.status', token); }),
      clickupListas: seguro(function (token) { return comSessao('clickup.listas', token); }),
      relatorioRascunho: seguro(function (token, processoId) {
        exigirToken(token);
        exigir(processoId, 'Processo não informado.');
        return comSessao('relatorio.rascunho', token, { processoId: processoId });
      }),
      relatorioSalvar: seguro(function (token, relatorioToken, relatorio) {
        exigirToken(token);
        exigir(relatorioToken, 'Relatório não informado.');
        var textos = relatorio && typeof relatorio === 'object' && relatorio.textos && typeof relatorio.textos === 'object' ? relatorio.textos : {};
        return comSessao('relatorio.salvar', token, { relatorioToken: relatorioToken, relatorio: { textos: textos } });
      }),
      relatorioPublicar: seguro(function (token, relatorioToken, baseUrl) {
        exigirToken(token);
        exigir(relatorioToken, 'Relatório não informado.');
        var dados = { relatorioToken: relatorioToken };
        if (baseUrl) dados.baseUrl = String(baseUrl);
        return comSessao('relatorio.publicar', token, dados);
      }),
      relatorioDespublicar: seguro(function (token, relatorioToken) {
        exigirToken(token);
        exigir(relatorioToken, 'Relatório não informado.');
        return comSessao('relatorio.despublicar', token, { relatorioToken: relatorioToken });
      }),
      relatoriosListar: seguro(function (token, processoId) {
        return comSessao('relatorios.listar', token, processoId ? { processoId: processoId } : null);
      }),
      relatorioMelhorarTextos: seguro(function (token, relatorioToken, ids) {
        exigirToken(token);
        exigir(relatorioToken, 'Relatório não informado.');
        var dados = { relatorioToken: relatorioToken };
        if (Array.isArray(ids) && ids.length) dados.ids = ids.slice();
        return comSessao('relatorio.melhorarTextos', token, dados);
      }),
      relatorioPublico: seguro(function (relatorioToken) {
        exigir(relatorioToken, MSG_REL_NAO_ENCONTRADO);
        return chamar({ acao: 'relatorioPublico', token: relatorioToken });
      }),
      // Empresas/colaboradores/organograma e relatórios por modelo (mesmo contrato do js/api-supabase.js).
      listarEquipe: seguro(function (token, empresaId) {
        exigirToken(token);
        exigir(empresaId, 'Empresa não informada.');
        return comSessao('equipe.listar', token, { empresaId: empresaId });
      }),
      salvarColaborador: seguro(function (token, colaborador) {
        exigirToken(token);
        exigir(colaborador && colaborador.empresaId, 'Empresa não informada.');
        return comSessao('colaboradores.salvar', token, { colaborador: colaborador });
      }),
      moverColaborador: seguro(function (token, dados) {
        exigirToken(token);
        exigir(dados && dados.pessoaId, 'Colaborador não informado.');
        exigir(dados && dados.empresaId, 'Escolha a empresa de destino.');
        return comSessao('colaboradores.mover', token, { colaborador: dados });
      }),
      desligarColaborador: seguro(function (token, vinculoId) {
        exigirToken(token);
        exigir(vinculoId, 'Colaborador não informado.');
        return comSessao('colaboradores.desligar', token, { id: vinculoId });
      }),
      salvarRelacoes: seguro(function (token, empresaId, relacoes) {
        exigirToken(token);
        exigir(empresaId, 'Empresa não informada.');
        return comSessao('relacoes.salvar', token, { empresaId: empresaId, relacoes: relacoes });
      }),
      salvarRelatorioModelo: seguro(function (token, dados) {
        return comSessao('relatorioModelo.salvar', token, { relatorio: dados || {} });
      }),
      listarRelatoriosModelo: seguro(function (token, filtro) {
        return comSessao('relatoriosModelo.listar', token, { filtro: filtro || {} });
      }),
      excluirRelatorioModelo: seguro(function (token, id) {
        exigirToken(token);
        exigir(id, 'Relatório não informado.');
        return comSessao('relatorioModelo.excluir', token, { id: id });
      })
    };
  }

  var METODOS = ['enviar', 'avaliacaoPublica', 'login', 'primeiroAcesso', 'eu', 'sair', 'trocarSenha',
    'listar', 'atualizar', 'excluir', 'excluirTodos', 'listarEmpresas', 'salvarEmpresa', 'excluirEmpresa',
    'listarAvaliacoes', 'salvarAvaliacao', 'excluirAvaliacao', 'listarUsuarios', 'salvarUsuario',
    'excluirUsuario', 'redefinirSenha',
    'processosListar', 'processosSalvar', 'processosExcluir', 'processoDados', 'clickupStatus', 'clickupListas',
    'relatorioRascunho', 'relatorioSalvar', 'relatorioPublicar', 'relatorioDespublicar', 'relatoriosListar',
    'relatorioMelhorarTextos', 'relatorioPublico',
    'listarEquipe', 'salvarColaborador', 'moverColaborador', 'desligarColaborador', 'salvarRelacoes',
    'salvarRelatorioModelo', 'listarRelatoriosModelo', 'excluirRelatorioModelo'];

  // Liga no lugar do DISC_API real quando CONFIG.API_URL === 'simulada' (o objeto continua o mesmo).
  function instalar(alvo, cfg, opcoes) {
    if (!alvo || !cfg || String(cfg.API_URL || '').trim() !== 'simulada') return null;
    var sim = criar(opcoes);
    METODOS.forEach(function (m) { alvo[m] = sim[m]; });
    alvo.configurado = function () { return true; };
    alvo.simulada = true;
    alvo.CHAVE_PREVIA = CHAVE_ADMIN;
    alvo.PREVIA = PREVIA;
    alvo.limparSimulada = sim.limpar;
    alvo.reiniciarSimulada = sim.reiniciar;
    return sim;
  }

  var DISC_API_SIMULADA = {
    CHAVE_ARMAZENAMENTO: CHAVE_ARMAZENAMENTO,
    CHAVES: CHAVES,
    CHAVE_ADMIN: CHAVE_ADMIN,
    PREVIA: PREVIA,
    LATENCIA_MS: LATENCIA_MS,
    METODOS: METODOS,
    criar: criar,
    instalar: instalar,
    gerarProtocolo: gerarProtocolo,
    protocoloValido: protocoloValido,
    normalizarProtocolo: normalizarProtocolo,
    normalizarCodigoAvaliacao: normalizarCodigoAvaliacao,
    gerarCodigoAvaliacao: gerarCodigoAvaliacao,
    validarValidacao: validarValidacao,
    validarConfigProcesso: validarConfigProcesso,
    normalizarFormulario: normalizarFormulario,
    classificarCampo: classificarCampo,
    normalizarNomeCampo: normalizarNomeCampo,
    LISTAS_PREVIA: LISTAS_PREVIA,
    sha256Hex: sha256Hex,
    hashSenha: hashSenha
  };

  if (typeof module !== 'undefined' && module.exports) { module.exports = DISC_API_SIMULADA; return; }
  root.DISC_API_SIMULADA = DISC_API_SIMULADA;
  instalar(root.DISC_API, root.CONFIG);
})(typeof self !== 'undefined' ? self : this);
