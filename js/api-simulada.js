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
 *   avaliações SEL1 (Recepcionista 2026, seleção) e EQP1 (Equipe comercial, equipe, mostra resultado)
 *   4 respostas de exemplo (2 em cada avaliação). Chave de primeiro acesso da prévia: "previa".
 *
 * No Node (testes): require('./js/api-simulada.js').criar({ armazenamento, scoring, latenciaMs: 0, semente: false }).
 */
(function (root) {
  'use strict';

  var CHAVE_ARMAZENAMENTO = 'disc_planilha_simulada';     // respostas (mesma chave das versões anteriores)
  var CHAVES = {
    usuarios: 'disc_simulada_usuarios',
    empresas: 'disc_simulada_empresas',
    avaliacoes: 'disc_simulada_avaliacoes',
    sessoes: 'disc_simulada_sessoes',
    semente: 'disc_simulada_semente'
  };
  var CHAVE_ADMIN = 'previa';
  var LATENCIA_MS = 400;
  var PREVIA = {
    chave: CHAVE_ADMIN,
    admin: { email: 'admin@previa.com', senha: 'previa123' },
    gestor: { email: 'gestor@previa.com', senha: 'previa123' },
    avaliacoes: ['SEL1', 'EQP1']
  };

  // Mesmos valores do Code.gs
  var LIMITE_CORPO = 20000;
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

  /* ---------- Planilha falsa ---------- */

  function criar(opcoes) {
    opcoes = opcoes || {};
    var SC = obterScoring(opcoes);
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
      try { lista = SC.descompactar(respostas); } catch (e) { return null; }
      if (!SC.validarRespostas(lista)) return null;
      var c = SC.calcular(lista);
      return { percentuais: c.percentuais, codigo: c.codigo };
    }

    // Mesmo texto e mesma ordem de verificação do validarPayload do Code.gs.
    function validarPayload(p) {
      if (!p || typeof p !== 'object' || Array.isArray(p)) return erro('Dados do teste ausentes.');
      var id = limparTexto(p.id, 80);
      if (!/^[A-Za-z0-9_-]{6,64}$/.test(id)) return erro('Identificador do envio inválido.');
      var nome = limparTexto(p.nome, 120);
      if (!nomeValido(nome)) return erro('Informe o nome completo (nome e sobrenome).');
      var telefone = normalizarTelefone(p.telefone);
      if (!telefone) return erro('Telefone inválido. Informe DDD + número.');
      var idade = validarIdade(p.idade);
      if (!idade.ok) return idade;
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
          funcao: limparTexto(p.funcao, LIMITE_FUNCAO_EMPRESA), empresa: limparTexto(p.empresa, LIMITE_FUNCAO_EMPRESA),
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

    function acaoEnviar(bruto) {
      var v = validarPayload(bruto);
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
      if (payload.avaliacao) {
        var av = buscarPor(avaliacoes(), 'codigo', payload.avaliacao);
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
      linhas.push(linha);
      gravar(linhas);
      return { ok: true, id: payload.id, protocolo: protocolo };
    }

    function acaoAvaliacaoPublica(codigoBruto) {
      var codigo = normalizarCodigoAvaliacao(codigoBruto);
      if (!codigo) return erro(MSG_LINK_INVALIDO);
      var av = buscarPor(avaliacoes(), 'codigo', codigo);
      if (!av || !av.ativa) return erro(MSG_LINK_INVALIDO);
      return {
        ok: true,
        avaliacao: { codigo: av.codigo, nome: av.nome, tipo: av.tipo, empresaNome: mapaEmpresas()[av.empresaId] || '', mostrarResultado: av.mostrarResultado === true }
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
        validacao: (l.validacao && typeof l.validacao === 'object' && !Array.isArray(l.validacao)) ? l.validacao : null
      };
    }

    function acaoListar(u) {
      var emp = mapaEmpresas();
      var avs = {};
      avaliacoes().forEach(function (a) { avs[a.codigo] = a; });
      var itens = [];
      ler().forEach(function (l) {
        if (!String(l.id || '').trim()) return;
        var item = linhaParaItem(l);
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
      return { ok: true, id: id };
    }

    function acaoExcluirTodos(avaliacaoBruta) {
      var filtrar = avaliacaoBruta !== undefined && avaliacaoBruta !== null && String(avaliacaoBruta).trim() !== '';
      var codigo = filtrar ? normalizarCodigoAvaliacao(avaliacaoBruta) : '';
      if (filtrar && !codigo) return erro('Código de avaliação inválido.');
      var linhas = ler();
      if (!filtrar) { gravar([]); return { ok: true, excluidos: linhas.length }; }
      var ficam = linhas.filter(function (l) { return normalizarCodigoAvaliacao(l.avaliacao) !== codigo; });
      gravar(ficam);
      return { ok: true, excluidos: linhas.length - ficam.length, avaliacao: codigo };
    }

    function empresaPublica(e) { return { id: e.id, nome: e.nome, criadaEm: e.criadaEm }; }

    function acaoEmpresasSalvar(dados) {
      if (!dados || typeof dados !== 'object') return erro('Dados da empresa ausentes.');
      var nome = limparTexto(dados.nome, 80);
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
      } else {
        e = { id: novoId('emp'), nome: nome, criadaEm: agoraIso() };
        lista.push(e);
      }
      gravarChave(CHAVES.empresas, lista);
      return { ok: true, empresa: empresaPublica(e) };
    }

    function acaoEmpresasExcluir(idBruto) {
      var id = limparTexto(idBruto, 40);
      var lista = empresas();
      var e = id && buscarPor(lista, 'id', id);
      if (!e) return erro('Empresa não encontrada.');
      if (buscarPor(avaliacoes(), 'empresaId', id)) return erro('Esta empresa tem avaliações. Exclua as avaliações dela antes.');
      if (buscarPor(usuarios(), 'empresaId', id)) return erro('Esta empresa tem gestores ligados a ela. Exclua ou mude esses gestores antes.');
      gravarChave(CHAVES.empresas, lista.filter(function (x) { return x.id !== id; }));
      return { ok: true, id: id };
    }

    function avaliacaoPublica(a, emp, contagem) {
      return {
        id: a.id, codigo: a.codigo, empresaId: a.empresaId, empresaNome: emp[a.empresaId] || '',
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

    function acaoAvaliacoesSalvar(dados) {
      if (!dados || typeof dados !== 'object') return erro('Dados da avaliação ausentes.');
      var id = limparTexto(dados.id, 40);
      var nome = limparTexto(dados.nome, 80);
      if (letrasContadas(nome) < 2) return erro('Informe o nome da avaliação.');
      var tipo = limparTexto(dados.tipo, 20);
      if (TIPOS_AVALIACAO.indexOf(tipo) === -1) return erro('Tipo inválido. Use: selecao ou equipe.');
      var empresaId = limparTexto(dados.empresaId, 40);
      var emp = mapaEmpresas();
      if (!empresaId || !Object.prototype.hasOwnProperty.call(emp, empresaId)) return erro('Escolha uma empresa válida.');
      var lista = avaliacoes();
      var contagem = respostasPorAvaliacao();
      var a;
      if (id) {
        a = buscarPor(lista, 'id', id);
        if (!a) return erro('Avaliação não encontrada.');
        if (a.empresaId !== empresaId && contagem[a.codigo]) return erro('Esta avaliação já tem respostas: não dá para trocar a empresa dela.');
        if (dados.ativa !== undefined) a.ativa = dados.ativa === true;
      } else {
        var usadosCod = {};
        lista.forEach(function (r) { usadosCod[r.codigo] = true; });
        a = { id: novoId('ava'), codigo: gerarCodigoAvaliacao(usadosCod), criadaEm: agoraIso(), ativa: dados.ativa !== false };
        lista.push(a);
      }
      a.empresaId = empresaId;
      a.nome = nome;
      a.tipo = tipo;
      a.mostrarResultado = dados.mostrarResultado === true;
      gravarChave(CHAVES.avaliacoes, lista);
      return { ok: true, avaliacao: avaliacaoPublica(a, emp, contagem) };
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
      'empresas.listar': { soAdmin: true, fn: function () { return { ok: true, empresas: empresas().map(empresaPublica) }; } },
      'empresas.salvar': { soAdmin: true, fn: function (u, c) { return acaoEmpresasSalvar(c.empresa); } },
      'empresas.excluir': { soAdmin: true, fn: function (u, c) { return acaoEmpresasExcluir(c.id); } },
      'avaliacoes.listar': { fn: function (u) { return acaoAvaliacoesListar(u); } },
      'avaliacoes.salvar': { soAdmin: true, fn: function (u, c) { return acaoAvaliacoesSalvar(c.avaliacao); } },
      'avaliacoes.excluir': { soAdmin: true, fn: function (u, c) { return acaoAvaliacoesExcluir(c.id); } },
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
      if (tamanho > LIMITE_CORPO) return erro('Requisição grande demais.');
      garantirSemente();
      var acao = corpo.acao;
      if (acao === 'enviar') return acaoEnviar(corpo.payload);
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
      if (lerChave(CHAVES.semente, null)) return;
      semeando = true;
      try { semear(); } finally { semeando = false; }
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
      return SC.compactar(lista);
    }

    // Validação de exemplo coerente com o perfil (notas: força P, sombra P, força S, contraste U).
    function validacaoDe(respostas, opcoesV) {
      var o = SC.calcular(SC.descompactar(respostas)).ordem;
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
      var emp = { id: 'emp_previa_clinica', nome: 'Clínica Exemplo', criadaEm: new Date(t - 20 * dia).toISOString() };
      var lsEmp = lerLista(CHAVES.empresas);
      if (!buscarPor(lsEmp, 'id', emp.id)) { lsEmp.push(emp); gravarChave(CHAVES.empresas, lsEmp); }

      var lsAv = lerLista(CHAVES.avaliacoes);
      [
        { id: 'ava_previa_sel1', codigo: 'SEL1', empresaId: emp.id, nome: 'Recepcionista 2026', tipo: 'selecao', mostrarResultado: false, ativa: true, criadaEm: new Date(t - 15 * dia).toISOString() },
        { id: 'ava_previa_eqp1', codigo: 'EQP1', empresaId: emp.id, nome: 'Equipe comercial', tipo: 'equipe', mostrarResultado: true, ativa: true, criadaEm: new Date(t - 10 * dia).toISOString() }
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
          validacao: { acertos: 3, notas: [4, 4, 5, 1], rapido: false, semMexer: 0 }, protocolo: '78D', dias: 1, duracao: 660 }
      ];
      var linhas = lerLista(CHAVE_ARMAZENAMENTO);
      var ocupados = usados(linhas);
      exemplos.forEach(function (x, n) {
        if (indice(linhas, x.id) !== -1) return;
        var fim = t - x.dias * dia;
        var protocolo = ocupados[x.protocolo] ? gerarProtocolo(ocupados, aleatorio) : x.protocolo;
        ocupados[protocolo] = true;
        linhas.push({
          v: 1, id: x.id, nome: x.nome, telefone: '551190000000' + (n + 1), idade: x.idade, funcao: x.funcao, empresa: x.empresa,
          vaga: x.vaga, consentimento: true, inicio: new Date(fim - x.duracao * 1000).toISOString(), fim: new Date(fim).toISOString(),
          duracaoSeg: x.duracao, respostas: x.respostas, avaliacao: x.avaliacao, empresaId: emp.id,
          validacao: validacaoDe(x.respostas, x.validacao),
          recebidoEm: new Date(fim + 2000).toISOString(), status: x.status, observacoes: x.observacoes, protocolo: protocolo
        });
      });
      gravar(linhas);
      gravarChave(CHAVES.semente, 1);
    }

    // Como o DISC_API real: Promise que resolve com o JSON (ok === true) ou rejeita com Error em pt-BR
    // (com erro.sessaoExpirada e erro.resposta, iguais aos do js/api.js).
    function chamar(corpo) {
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
      limpar: function () { gravar([]); },
      // Volta a prévia ao estado inicial (apaga tudo e recria a semente).
      reiniciar: function () {
        [CHAVE_ARMAZENAMENTO, CHAVES.usuarios, CHAVES.empresas, CHAVES.avaliacoes, CHAVES.sessoes].forEach(function (k) {
          gravarChave(k, k === CHAVES.sessoes ? {} : []);
        });
        gravarChave(CHAVES.semente, 0);
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
      })
    };
  }

  var METODOS = ['enviar', 'avaliacaoPublica', 'login', 'primeiroAcesso', 'eu', 'sair', 'trocarSenha',
    'listar', 'atualizar', 'excluir', 'excluirTodos', 'listarEmpresas', 'salvarEmpresa', 'excluirEmpresa',
    'listarAvaliacoes', 'salvarAvaliacao', 'excluirAvaliacao', 'listarUsuarios', 'salvarUsuario',
    'excluirUsuario', 'redefinirSenha'];

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
    sha256Hex: sha256Hex,
    hashSenha: hashSenha
  };

  if (typeof module !== 'undefined' && module.exports) { module.exports = DISC_API_SIMULADA; return; }
  root.DISC_API_SIMULADA = DISC_API_SIMULADA;
  instalar(root.DISC_API, root.CONFIG);
})(typeof self !== 'undefined' ? self : this);
