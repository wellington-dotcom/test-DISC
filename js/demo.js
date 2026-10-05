/* Modo demonstração (CONFIG.DEMO, ligado por ?demo=1 ou #demo — veja js/config.js):
 * mostra uma faixa "Demonstração" e preenche a identificação com dados fictícios para só passar pelas telas.
 * Fora do modo demonstração este arquivo não faz nada. */
(function (root) {
  'use strict';
  var CONFIG = root.CONFIG || {};
  if (!CONFIG.DEMO || !root.document) return;
  var doc = root.document;
  var sufixo = String(Math.floor(1000 + Math.random() * 9000));
  var FICTICIO = {
    nome: 'Paula Demonstração Teste', telefone: '(95) 99999-' + sufixo, idade: '30',
    funcao: 'Recepcionista', empresa: 'Empresa Fictícia', email: 'demo' + sufixo + '@exemplo.com',
    cidade: 'Boa Vista', vaga: 'Vaga de demonstração'
  };
  function preencher(el, valor) {
    if (!el || el.value) return;
    el.value = valor;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function faixa() {
    if (doc.getElementById('faixa-demo') || !doc.body) return;
    var f = doc.createElement('div');
    f.id = 'faixa-demo';
    f.setAttribute('role', 'note');
    f.className = 'faixa-demo';
    f.innerHTML = '<strong>Demonstração</strong> · dados fictícios, 3 grupos e pagamento simulado (cupom ou botão "Simular pagamento"). Nada é salvo. <a href="?demo=0">Sair da demonstração</a>';
    doc.body.insertBefore(f, doc.body.firstChild);
  }
  function aplicar() {
    faixa();
    Object.keys(FICTICIO).forEach(function (id) { preencher(doc.getElementById(id), FICTICIO[id]); });
    Array.prototype.forEach.call(doc.querySelectorAll('textarea[id^="extra-"]'), function (t) { preencher(t, 'Resposta fictícia da demonstração.'); });
    var cons = doc.getElementById('consentimento');
    if (cons && !cons.checked && !cons.getAttribute('data-demo')) { cons.setAttribute('data-demo', '1'); cons.click(); }
  }
  var agendado = false;
  new root.MutationObserver(function () {
    if (agendado) return;
    agendado = true;
    root.setTimeout(function () { agendado = false; aplicar(); }, 60);
  }).observe(doc.documentElement, { childList: true, subtree: true });
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', aplicar); else aplicar();
})(typeof self !== 'undefined' ? self : this);
