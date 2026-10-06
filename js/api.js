/*
 * Cliente do backend (Google Apps Script Web App).
 * Todas as chamadas: POST API_URL, Content-Type text/plain (evita preflight CORS),
 * corpo JSON { acao, ... }. Resposta JSON { ok, ..., erro? }.
 * Cada função retorna a Promise do JSON de resposta (ok === true) ou rejeita com Error em pt-BR.
 *
 * A URL vem de CONFIG.API_URL (global) ou de DISC_API.definirUrl(url) (útil em testes/Node).
 *
 * enviar(payload) resolve com { ok, id, protocolo } — o protocolo (ex.: "47K") é gerado pelo servidor.
 * Reenvio do mesmo id: { ok, duplicado: true, id, protocolo } com o mesmo protocolo já gravado.
 * CONFIG.API_URL === 'simulada' liga a API de demonstração de js/api-simulada.js (carregado depois deste).
 *
 * Painel: login(email, senha) resolve com { token, usuario }. O token é passado EXPLICITAMENTE em cada
 * chamada (o painel guarda onde quiser). Quando o servidor responde sessão expirada, a Promise rejeita
 * com um Error que tem erro.sessaoExpirada === true (o painel volta para a tela de login).
 * Todo Error de recusa do servidor traz erro.resposta com o JSON recebido.
 *
 *   Públicas:  enviar(payload) · avaliacaoPublica(codigo) · login(email, senha)
 *              primeiroAcesso(chave, nome, email, senha)
 *   Sessão:    eu(token) · sair(token) · trocarSenha(token, senhaAtual, novaSenha)
 *              listar(token) · atualizar(token, id, campos) · excluir(token, id) · excluirTodos(token, avaliacao?)
 *   Só admin:  listarEmpresas(token) · salvarEmpresa(token, {id?, nome}) · excluirEmpresa(token, id)
 *              listarAvaliacoes(token) (gestor também) · salvarAvaliacao(token, {id?, empresaId, nome, tipo,
 *              mostrarResultado, ativa}) · excluirAvaliacao(token, id)
 *              listarUsuarios(token) · salvarUsuario(token, {id?, nome, email, papel, empresaId, ativo}, senhaTemporaria?)
 *              excluirUsuario(token, id) · redefinirSenha(token, id, senhaTemporaria)
 *   Processos (nome novo das avaliações na interface; os métodos *Avaliacao* acima continuam valendo):
 *              processosListar(token) · processosSalvar(token, {id?, nome, empresa, vaga, cidade, consultor,
 *              contratante, periodo:{inicio,fim}, clickupListId, config, ativa}) · processosExcluir(token, id)
 *              processoDados(token, id) -> dados normalizados do processo lidos do ClickUp
 *   ClickUp:   clickupStatus(token) -> {configurado, usuario?, iaConfigurada?…} · clickupListas(token) -> {listas}
 *   Relatório: relatorioRascunho(token, processoId) -> {relatorio, token: relatorioToken}
 *              relatorioSalvar(token, relatorioToken, relatorio|{textos}) · relatorioPublicar(token, relatorioToken, baseUrl?)
 *              relatorioDespublicar(token, relatorioToken) · relatoriosListar(token, processoId?)
 *              relatorioMelhorarTextos(token, relatorioToken, ids?)
 *              (o 1º argumento é sempre o token da SESSÃO; o do relatório vai no corpo como "relatorioToken")
 *   Pública:   relatorioPublico(relatorioToken) -> {relatorio} (só relatório publicado)
 *   Só Supabase (aqui rejeitam com "Disponível só com o servidor Supabase."): listarEquipe, salvarColaborador,
 *              moverColaborador, desligarColaborador, salvarRelacoes, salvarRelatorioModelo, listarRelatoriosModelo,
 *              excluirRelatorioModelo, salvarMinhaFoto, removerFoto, moverResposta, contratarPessoa, versaoBanco
 *              (contrato em js/api-supabase.js e docs/SPEC.md).
 *   Venda direta (só Supabase; aqui também "Disponível só com o servidor Supabase."): pacotesPublicos, enviarPessoal,
 *              resumoPessoal, criarPedido, iniciarPagamento, statusPedido, relatorioPessoal, salvarParte2Pessoal,
 *              recuperarAcesso, confirmarRetorno, listarPedidos, atualizarPedido, listarCupons, salvarCupom, excluirCupom, listarPacotes,
 *              salvarPacote, resumoVendas.
 *   Aba Conexões (só Supabase/prévia; aqui também recusam): diagnosticoConexoes, testarConexao.
 *   E-mail (só Supabase/prévia; aqui também recusam): relatorioEnviarEmail, enviarLinkPorEmail.
 *   Utilitários: protocoloValido, normalizarProtocolo, normalizarCodigoAvaliacao, codigoAvaliacaoDaUrl.
 */
(function (root) {
  var TIMEOUT_MS = 20000;
  var TIMEOUT_LONGO_MS = 120000; // ações que leem o ClickUp ou chamam a IA (o Apps Script pode demorar)
  var urlManual = null;

  function obterUrl() {
    if (urlManual) return urlManual;
    var cfg = (root && root.CONFIG) || (typeof globalThis !== 'undefined' ? globalThis.CONFIG : null);
    return (cfg && cfg.API_URL) ? String(cfg.API_URL).trim() : '';
  }

  function definirUrl(url) { urlManual = url ? String(url).trim() : null; }

  function configurado() { return !!obterUrl(); }

  function chamar(corpo, limiteMs) {
    var espera = typeof limiteMs === 'number' && limiteMs > 0 ? limiteMs : TIMEOUT_MS;
    var url = obterUrl();
    if (!url) return Promise.reject(new Error('O endereço do servidor (API_URL) não está configurado.'));
    if (typeof fetch !== 'function') return Promise.reject(new Error('Este navegador não suporta envio de dados. Atualize o navegador e tente novamente.'));

    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var expirou = false;
    var timer = null;
    var opcoes = {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(corpo),
      redirect: 'follow'
    };
    if (controller) opcoes.signal = controller.signal;

    var requisicao = fetch(url, opcoes);
    var tempo = new Promise(function (_, rejeitar) {
      timer = setTimeout(function () {
        expirou = true;
        if (controller) controller.abort();
        rejeitar(new Error('O servidor demorou demais para responder. Verifique sua conexão e tente novamente.'));
      }, espera);
    });

    return Promise.race([requisicao, tempo])
      .then(function (resp) {
        if (!resp.ok) throw new Error('O servidor respondeu com erro (código ' + resp.status + '). Tente novamente em instantes.');
        return resp.text();
      }, function (erro) {
        if (expirou) throw new Error('O servidor demorou demais para responder. Verifique sua conexão e tente novamente.');
        throw new Error('Não foi possível conectar ao servidor. Verifique sua conexão com a internet e tente novamente.');
      })
      .then(function (texto) {
        var json;
        try { json = JSON.parse(texto); } catch (e) {
          throw new Error('Resposta inesperada do servidor. Confira se a URL do Apps Script está correta e publicada para "Qualquer pessoa".');
        }
        if (!json || json.ok !== true) throw erroDaResposta(json);
        return json;
      })
      .then(function (json) { clearTimeout(timer); return json; }, function (erro) { clearTimeout(timer); throw erro; });
  }

  // Error em pt-BR a partir de uma resposta {ok:false, erro, sessaoExpirada?} do servidor.
  function erroDaResposta(json) {
    var e = new Error((json && json.erro) ? String(json.erro) : 'O servidor recusou a solicitação.');
    e.sessaoExpirada = !!(json && json.sessaoExpirada);
    e.resposta = json || null;
    return e;
  }

  function exigir(valor, mensagem) {
    if (valor === undefined || valor === null || valor === '') throw new Error(mensagem);
  }

  function exigirToken(token) {
    if (typeof token !== 'string' || !token) throw erroDaResposta({ ok: false, erro: 'Sessão expirada. Entre de novo.', sessaoExpirada: true });
  }

  // Código do link de avaliação: 4 letras/algarismos (o servidor sorteia só de ALFABETO_CODIGO, sem I, O, 0 e 1,
  // mas aceita qualquer A-Z/0-9 — as avaliações da prévia são "SEL1" e "EQP1"). '' se inválido.
  var ALFABETO_CODIGO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  function normalizarCodigoAvaliacao(v) {
    if (v === null || v === undefined) return '';
    var s = String(v).replace(/\s+/g, '').toUpperCase();
    return /^[A-Z0-9]{4}$/.test(s) ? s : '';
  }
  // Lê o código de "?a=SEL1" ou "#a-SEL1" (a prévia em artefato só repassa o #). '' se não houver.
  function codigoAvaliacaoDaUrl(search, hash) {
    var m = /[?&]a=([^&#]*)/.exec(String(search || ''));
    var bruto = m ? m[1] : '';
    if (!bruto) { var h = /^#?a-([^&?#\/]*)/.exec(String(hash || '')); bruto = h ? h[1] : ''; }
    try { bruto = decodeURIComponent(bruto); } catch (e) { /* mantém */ }
    return normalizarCodigoAvaliacao(bruto);
  }

  // Código do candidato (protocolo) gerado pelo servidor: 2 algarismos + 1 letra maiúscula sem I e O.
  function protocoloValido(v) {
    return typeof v === 'string' && /^[0-9]{2}[A-HJ-NP-Z]$/.test(v);
  }
  // Aceita minúsculas e espaços ("47 k" -> "47K"); devolve '' se não for um protocolo.
  function normalizarProtocolo(v) {
    if (v === null || v === undefined) return '';
    var s = String(v).replace(/\s+/g, '').toUpperCase();
    return protocoloValido(s) ? s : '';
  }

  function seguro(fn) {
    return function () {
      try { return fn.apply(null, arguments); } catch (e) { return Promise.reject(e); }
    };
  }

  // Recursos novos (empresas com colaboradores, organograma, relatórios por modelo) não existem no Apps Script.
  var MSG_SO_SUPABASE = 'Disponível só com o servidor Supabase.';
  function soSupabase() {
    var e = new Error(MSG_SO_SUPABASE);
    e.sessaoExpirada = false;
    e.resposta = { ok: false, erro: MSG_SO_SUPABASE };
    return Promise.reject(e);
  }

  // Ação com sessão: { acao, token, ...dados }.
  function comSessao(acao, token, dados, limiteMs) {
    exigirToken(token);
    var corpo = { acao: acao, token: token };
    if (dados) for (var k in dados) if (Object.prototype.hasOwnProperty.call(dados, k)) corpo[k] = dados[k];
    return chamar(corpo, limiteMs);
  }

  // Na edição só os textos mudam: manda só eles (o servidor ignora o resto e devolve o relatório inteiro).
  function soTextos(relatorio) {
    var textos = relatorio && typeof relatorio === 'object' ? relatorio.textos : null;
    return { textos: textos && typeof textos === 'object' ? textos : {} };
  }

  var DISC_API = {
    TIMEOUT_MS: TIMEOUT_MS,
    TIMEOUT_LONGO_MS: TIMEOUT_LONGO_MS,
    ALFABETO_CODIGO: ALFABETO_CODIGO,
    definirUrl: definirUrl,
    configurado: configurado,
    protocoloValido: protocoloValido,
    normalizarProtocolo: normalizarProtocolo,
    normalizarCodigoAvaliacao: normalizarCodigoAvaliacao,
    codigoAvaliacaoDaUrl: codigoAvaliacaoDaUrl,
    erroDaResposta: erroDaResposta,

    // --- públicas ---
    enviar: seguro(function (payload) {
      exigir(payload, 'Nenhum resultado para enviar.');
      return chamar({ acao: 'enviar', payload: payload });
    }),
    avaliacaoPublica: seguro(function (codigo) {
      exigir(codigo, 'Link inválido ou avaliação encerrada. Fale com quem enviou o link.');
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

    // --- com sessão ---
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

    // --- só admin (avaliações: gestor também lista) ---
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

    // --- processos, ClickUp e relatórios (só admin) ---
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
      return comSessao('processo.dados', token, { id: id }, TIMEOUT_LONGO_MS);
    }),
    clickupStatus: seguro(function (token) { return comSessao('clickup.status', token); }),
    clickupListas: seguro(function (token) { return comSessao('clickup.listas', token, null, TIMEOUT_LONGO_MS); }),
    relatorioRascunho: seguro(function (token, processoId) {
      exigirToken(token);
      exigir(processoId, 'Processo não informado.');
      return comSessao('relatorio.rascunho', token, { processoId: processoId }, TIMEOUT_LONGO_MS);
    }),
    relatorioSalvar: seguro(function (token, relatorioToken, relatorio) {
      exigirToken(token);
      exigir(relatorioToken, 'Relatório não informado.');
      return comSessao('relatorio.salvar', token, { relatorioToken: relatorioToken, relatorio: soTextos(relatorio) });
    }),
    relatorioPublicar: seguro(function (token, relatorioToken, baseUrl) {
      exigirToken(token);
      exigir(relatorioToken, 'Relatório não informado.');
      var dados = { relatorioToken: relatorioToken };
      if (baseUrl) dados.baseUrl = String(baseUrl);
      return comSessao('relatorio.publicar', token, dados, TIMEOUT_LONGO_MS);
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
      return comSessao('relatorio.melhorarTextos', token, dados, TIMEOUT_LONGO_MS);
    }),

    // --- empresas/colaboradores/organograma e relatórios por modelo: só no servidor Supabase ---
    listarEquipe: soSupabase,
    salvarColaborador: soSupabase,
    moverColaborador: soSupabase,
    desligarColaborador: soSupabase,
    salvarRelacoes: soSupabase,
    salvarRelatorioModelo: soSupabase,
    listarRelatoriosModelo: soSupabase,
    excluirRelatorioModelo: soSupabase,
    salvarMinhaFoto: soSupabase,
    removerFoto: soSupabase,
    moverResposta: soSupabase,
    contratarPessoa: soSupabase,
    versaoBanco: soSupabase,
    // Venda direta (B2C): só no Supabase (contrato em js/api-supabase.js).
    pacotesPublicos: soSupabase,
    enviarPessoal: soSupabase,
    resumoPessoal: soSupabase,
    criarPedido: soSupabase,
    iniciarPagamento: soSupabase,
    statusPedido: soSupabase,
    relatorioPessoal: soSupabase,
    salvarParte2Pessoal: soSupabase,
    recuperarAcesso: soSupabase,
    confirmarRetorno: soSupabase,
    listarPedidos: soSupabase,
    atualizarPedido: soSupabase,
    listarCupons: soSupabase,
    salvarCupom: soSupabase,
    excluirCupom: soSupabase,
    listarPacotes: soSupabase,
    salvarPacote: soSupabase,
    resumoVendas: soSupabase,
    // Aba Conexões: só no Supabase (e na prévia).
    diagnosticoConexoes: soSupabase,
    testarConexao: soSupabase,
    // Enviar o link do relatório por e-mail (painel) e "Enviar para meu e-mail" (B2C): só no Supabase (e na prévia).
    relatorioEnviarEmail: soSupabase,
    enviarLinkPorEmail: soSupabase,

    // --- pública: página do relatório para o contratante ---
    relatorioPublico: seguro(function (relatorioToken) {
      exigir(relatorioToken, 'Relatório não encontrado ou fora do ar.');
      return chamar({ acao: 'relatorioPublico', token: relatorioToken });
    })
  };

  // Nomes de todos os métodos que falam com o servidor (a API simulada troca exatamente estes).
  DISC_API.METODOS = ['enviar', 'avaliacaoPublica', 'login', 'primeiroAcesso', 'eu', 'sair', 'trocarSenha',
    'listar', 'atualizar', 'excluir', 'excluirTodos', 'listarEmpresas', 'salvarEmpresa', 'excluirEmpresa',
    'listarAvaliacoes', 'salvarAvaliacao', 'excluirAvaliacao', 'listarUsuarios', 'salvarUsuario',
    'excluirUsuario', 'redefinirSenha',
    'processosListar', 'processosSalvar', 'processosExcluir', 'processoDados', 'clickupStatus', 'clickupListas',
    'relatorioRascunho', 'relatorioSalvar', 'relatorioPublicar', 'relatorioDespublicar', 'relatoriosListar',
    'relatorioMelhorarTextos', 'relatorioPublico', 'relatorioEnviarEmail',
    'listarEquipe', 'salvarColaborador', 'moverColaborador', 'desligarColaborador', 'salvarRelacoes',
    'salvarRelatorioModelo', 'listarRelatoriosModelo', 'excluirRelatorioModelo', 'salvarMinhaFoto', 'removerFoto',
    'moverResposta', 'contratarPessoa', 'versaoBanco',
    'pacotesPublicos', 'enviarPessoal', 'resumoPessoal', 'criarPedido', 'iniciarPagamento', 'statusPedido', 'relatorioPessoal',
    'salvarParte2Pessoal', 'recuperarAcesso', 'enviarLinkPorEmail', 'confirmarRetorno',
    'listarPedidos', 'atualizarPedido', 'listarCupons', 'salvarCupom', 'excluirCupom', 'listarPacotes', 'salvarPacote', 'resumoVendas',
    'diagnosticoConexoes', 'testarConexao'];

  if (typeof module !== 'undefined' && module.exports) module.exports = DISC_API;
  else root.DISC_API = DISC_API;
})(typeof self !== 'undefined' ? self : this);
