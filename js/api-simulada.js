/*
 * API simulada — para a prévia/demonstração, sem Google Apps Script.
 *
 * Liga só quando CONFIG.API_URL === 'simulada'. Carregue logo DEPOIS de js/api.js:
 *   <script src="js/api.js"></script>
 *   <script src="js/api-simulada.js"></script>
 * Nesse modo, DISC_API.enviar/listar/atualizar/excluir/excluirTodos passam a usar uma "planilha" falsa
 * guardada no localStorage deste navegador (chave 'disc_planilha_simulada'), com as MESMAS regras e
 * mensagens do apps-script/Code.gs: validação do payload, perfil recalculado a partir das respostas
 * (via DISC_SCORING), protocolo único de 2 algarismos + 1 letra (sem I e O), id repetido devolvendo o
 * mesmo protocolo, limites e chave de administrador — que na prévia é "previa".
 * Com qualquer outro API_URL este arquivo não faz nada.
 *
 * No Node (testes): require('./js/api-simulada.js').criar({ armazenamento, scoring, latenciaMs: 0 }).
 */
(function (root) {
  'use strict';

  var CHAVE_ARMAZENAMENTO = 'disc_planilha_simulada';
  var CHAVE_ADMIN = 'previa';
  var LATENCIA_MS = 400;

  // Mesmos valores do Code.gs
  var LIMITE_LINHAS = 500;
  var LIMITE_ENVIOS_JANELA = 40;
  var JANELA_ENVIOS_SEG = 600;
  var STATUS_VALIDOS = ['em_analise', 'aprovado', 'reprovado'];
  var STATUS_PADRAO = 'em_analise';
  var LETRAS_PROTOCOLO = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  var TOTAL_PROTOCOLOS = 100 * LETRAS_PROTOCOLO.length;
  var TENTATIVAS_SORTEIO = 40;
  var IDADE_MIN = 14;
  var IDADE_MAX = 99;
  var LIMITE_FUNCAO_EMPRESA = 80;

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

  function obterScoring(opcoes) {
    if (opcoes && opcoes.scoring) return opcoes.scoring;
    if (root && root.DISC_SCORING) return root.DISC_SCORING;
    if (typeof require === 'function') {
      try { return require('./scoring.js'); } catch (e) { /* sem scoring */ }
    }
    throw new Error('DISC_SCORING não carregado.');
  }

  /* ---------- Planilha falsa ---------- */

  function criar(opcoes) {
    opcoes = opcoes || {};
    var SC = obterScoring(opcoes);
    var latencia = typeof opcoes.latenciaMs === 'number' ? opcoes.latenciaMs : LATENCIA_MS;
    var agora = typeof opcoes.agora === 'function' ? opcoes.agora : function () { return Date.now(); };
    var aleatorio = opcoes.aleatorio;
    var memoria = null;           // usado quando o localStorage não está disponível
    var envios = {};              // limitador: janela -> quantidade (só nesta página, como o CacheService)

    function armazenamento() {
      if (opcoes.armazenamento !== undefined) return opcoes.armazenamento;
      try { return root.localStorage || null; } catch (e) { return null; }
    }

    function ler() {
      var bruto = null;
      try { var a = armazenamento(); if (a) bruto = a.getItem(CHAVE_ARMAZENAMENTO); } catch (e) { bruto = null; }
      if (bruto === null || bruto === undefined) return memoria ? memoria.slice() : [];
      try {
        var arr = JSON.parse(bruto);
        return Array.isArray(arr) ? arr.filter(function (l) { return l && typeof l === 'object'; }) : [];
      } catch (e) { return []; }
    }

    function gravar(linhas) {
      memoria = linhas.slice();
      try { var a = armazenamento(); if (a) a.setItem(CHAVE_ARMAZENAMENTO, JSON.stringify(linhas)); } catch (e) { /* fica na memória */ }
    }

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
          inicio: inicio, fim: fim, duracaoSeg: Math.round(duracao), respostas: respostas
        }
      };
    }

    function verificarChave(chave) {
      if (typeof chave !== 'string' || !chave || chave.trim() !== CHAVE_ADMIN) {
        return erro('Chave de administrador inválida.', { naoAutorizado: true });
      }
      return { ok: true };
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
        empresa: String(l.empresa == null ? '' : l.empresa)
      };
    }

    function acaoListar() {
      return { ok: true, itens: ler().filter(function (l) { return String(l.id || '').trim(); }).map(linhaParaItem) };
    }

    function acaoAtualizar(idBruto, campos) {
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

    function acaoExcluirTodos() {
      var total = ler().length;
      gravar([]);
      return { ok: true, excluidos: total };
    }

    // Mesmo despacho do processarRequisicao_ do Code.gs (recebe o corpo já como objeto).
    function processar(corpo) {
      if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) return erro('Formato de requisição inválido.');
      var acao = corpo.acao;
      if (acao === 'enviar') return acaoEnviar(corpo.payload);
      if (acao === 'listar' || acao === 'atualizar' || acao === 'excluir' || acao === 'excluirTodos') {
        var auth = verificarChave(corpo.chave);
        if (!auth.ok) return auth;
        if (acao === 'listar') return acaoListar();
        if (acao === 'atualizar') return acaoAtualizar(corpo.id, corpo.campos);
        if (acao === 'excluir') return acaoExcluir(corpo.id);
        return acaoExcluirTodos();
      }
      return erro('Ação desconhecida.');
    }

    // Como o DISC_API real: Promise que resolve com o JSON (ok === true) ou rejeita com Error em pt-BR.
    function chamar(corpo) {
      return new Promise(function (resolver, rejeitar) {
        setTimeout(function () {
          var resp;
          try { resp = JSON.parse(JSON.stringify(processar(JSON.parse(JSON.stringify(corpo))))); }
          catch (e) { resp = erro('Erro interno no servidor. Tente novamente em instantes.'); }
          if (resp && resp.ok === true) resolver(resp);
          else rejeitar(new Error((resp && resp.erro) ? String(resp.erro) : 'O servidor recusou a solicitação.'));
        }, latencia);
      });
    }

    function exigir(valor, mensagem) {
      if (valor === undefined || valor === null || valor === '') throw new Error(mensagem);
    }
    function seguro(fn) {
      return function () {
        try { return fn.apply(null, arguments); } catch (e) { return Promise.reject(e); }
      };
    }

    return {
      simulada: true,
      CHAVE_ADMIN: CHAVE_ADMIN,
      processar: processar,
      ler: ler,
      limpar: function () { gravar([]); },
      enviar: seguro(function (payload) {
        exigir(payload, 'Nenhum resultado para enviar.');
        return chamar({ acao: 'enviar', payload: payload });
      }),
      listar: seguro(function (chave) {
        exigir(chave, 'Informe a chave de acesso.');
        return chamar({ acao: 'listar', chave: chave });
      }),
      atualizar: seguro(function (chave, id, campos) {
        exigir(chave, 'Informe a chave de acesso.');
        exigir(id, 'Candidato não informado.');
        return chamar({ acao: 'atualizar', chave: chave, id: id, campos: campos || {} });
      }),
      excluir: seguro(function (chave, id) {
        exigir(chave, 'Informe a chave de acesso.');
        exigir(id, 'Candidato não informado.');
        return chamar({ acao: 'excluir', chave: chave, id: id });
      }),
      excluirTodos: seguro(function (chave) {
        exigir(chave, 'Informe a chave de acesso.');
        return chamar({ acao: 'excluirTodos', chave: chave });
      })
    };
  }

  // Liga no lugar do DISC_API real quando CONFIG.API_URL === 'simulada' (o objeto continua o mesmo).
  function instalar(alvo, cfg, opcoes) {
    if (!alvo || !cfg || String(cfg.API_URL || '').trim() !== 'simulada') return null;
    var sim = criar(opcoes);
    ['enviar', 'listar', 'atualizar', 'excluir', 'excluirTodos'].forEach(function (m) { alvo[m] = sim[m]; });
    alvo.configurado = function () { return true; };
    alvo.simulada = true;
    alvo.CHAVE_PREVIA = CHAVE_ADMIN;
    alvo.limparSimulada = sim.limpar;
    return sim;
  }

  var DISC_API_SIMULADA = {
    CHAVE_ARMAZENAMENTO: CHAVE_ARMAZENAMENTO,
    CHAVE_ADMIN: CHAVE_ADMIN,
    LATENCIA_MS: LATENCIA_MS,
    criar: criar,
    instalar: instalar,
    gerarProtocolo: gerarProtocolo,
    protocoloValido: protocoloValido,
    normalizarProtocolo: normalizarProtocolo
  };

  if (typeof module !== 'undefined' && module.exports) { module.exports = DISC_API_SIMULADA; return; }
  root.DISC_API_SIMULADA = DISC_API_SIMULADA;
  instalar(root.DISC_API, root.CONFIG);
})(typeof self !== 'undefined' ? self : this);
