/*
 * Cliente do backend (Google Apps Script Web App).
 * Todas as chamadas: POST API_URL, Content-Type text/plain (evita preflight CORS),
 * corpo JSON { acao, ... }. Resposta JSON { ok, ..., erro? }.
 * Cada função retorna a Promise do JSON de resposta (ok === true) ou rejeita com Error em pt-BR.
 *
 * A URL vem de CONFIG.API_URL (global) ou de DISC_API.definirUrl(url) (útil em testes/Node).
 */
(function (root) {
  var TIMEOUT_MS = 20000;
  var urlManual = null;

  function obterUrl() {
    if (urlManual) return urlManual;
    var cfg = (root && root.CONFIG) || (typeof globalThis !== 'undefined' ? globalThis.CONFIG : null);
    return (cfg && cfg.API_URL) ? String(cfg.API_URL).trim() : '';
  }

  function definirUrl(url) { urlManual = url ? String(url).trim() : null; }

  function configurado() { return !!obterUrl(); }

  function chamar(corpo) {
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
      }, TIMEOUT_MS);
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
        if (!json || json.ok !== true) throw new Error((json && json.erro) ? String(json.erro) : 'O servidor recusou a solicitação.');
        return json;
      })
      .then(function (json) { clearTimeout(timer); return json; }, function (erro) { clearTimeout(timer); throw erro; });
  }

  function exigir(valor, mensagem) {
    if (valor === undefined || valor === null || valor === '') throw new Error(mensagem);
  }

  function seguro(fn) {
    return function () {
      try { return fn.apply(null, arguments); } catch (e) { return Promise.reject(e); }
    };
  }

  var DISC_API = {
    TIMEOUT_MS: TIMEOUT_MS,
    definirUrl: definirUrl,
    configurado: configurado,
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

  if (typeof module !== 'undefined' && module.exports) module.exports = DISC_API;
  else root.DISC_API = DISC_API;
})(typeof self !== 'undefined' ? self : this);
