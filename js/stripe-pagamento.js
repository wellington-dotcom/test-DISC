/*
 * Pagamento dentro do site com o Stripe Payment Element (cartão digitado na página, Apple Pay e Google Pay num toque,
 * Pix com QR na hora). Usado pelo checkout do Mapa de Perfil (js/checkout.js) e pelo pagamento de teste da aba Conexões
 * do painel (js/admin.js). Textos para quem paga: "Gestão sem Caos".
 *
 * Módulo UMD (global DISC_STRIPE). Parte PURA (testada no Node):
 *   URL_STRIPE_JS, mensagemErro(erroStripe) (português), pixDoIntent(paymentIntent) -> {qr, copiaECola, expira, instrucoesUrl}|null,
 *   resultadoConfirmacao({error, paymentIntent}) -> {status:'pago'|'pendente'|'erro', mensagem, pix, paymentIntent}
 * Parte do navegador:
 *   carregar() -> Promise<Stripe>   injeta https://js.stripe.com/v3/ SÓ quando chamado (obrigatório vir do domínio do
 *                                   Stripe; nunca copiado para o nosso site).
 *   aparencia() -> appearance do Elements com os tokens de assets/notus.css (lidos do :root), fonte Plus Jakarta Sans.
 *   montar({el, publicavel, clientSecret, aoPronto(), aoErro(msg), aoMudar({completo, tipo})}) -> Promise<sessao>
 *   montarSimulado({el, aoPronto(), simularPago() -> Promise, pixFicticio:{qr, copiaECola}, paymentIntent?, aoMudar({tipo}), metodo?: 'pix'})
 *                                   -> sessao (prévia/demonstração:
 *                                   campos de cartão FICTÍCIOS + Pix com QR de enfeite; nada vai para o Stripe)
 *   sessao: { confirmar(returnUrl) -> Promise<resultadoConfirmacao>, destruir() }
 */
(function (root) {
  'use strict';

  var URL_STRIPE_JS = 'https://js.stripe.com/v3/';
  var EMPRESA = 'Gestão sem Caos';
  var MSG_GERAL = 'Não foi possível concluir o pagamento. Confira os dados e tente de novo.';
  var MSG_CARREGAR = 'Não foi possível carregar o pagamento. Verifique a conexão e tente de novo.';

  // Códigos do Stripe -> frase curta em português (o Stripe já traduz com locale pt-BR; isto é a rede de segurança).
  var ERROS = {
    card_declined: 'O cartão foi recusado. Tente outro cartão ou pague com Pix.',
    insufficient_funds: 'O cartão não tem limite para esta compra. Tente outro cartão ou pague com Pix.',
    lost_card: 'O cartão foi recusado. Tente outro cartão ou pague com Pix.',
    stolen_card: 'O cartão foi recusado. Tente outro cartão ou pague com Pix.',
    expired_card: 'O cartão está vencido. Confira a validade ou use outro cartão.',
    incorrect_cvc: 'O código de segurança (CVC) está incorreto.',
    invalid_cvc: 'O código de segurança (CVC) está incorreto.',
    incorrect_number: 'O número do cartão está incorreto.',
    invalid_number: 'O número do cartão está incorreto.',
    invalid_expiry_month: 'O mês de validade está incorreto.',
    invalid_expiry_year: 'O ano de validade está incorreto.',
    incomplete_number: 'O número do cartão está incompleto.',
    incomplete_cvc: 'O código de segurança (CVC) está incompleto.',
    incomplete_expiry: 'A validade do cartão está incompleta.',
    processing_error: 'Houve um erro ao processar o cartão. Tente de novo em instantes.',
    authentication_required: 'O banco pediu uma confirmação que não foi concluída. Tente de novo.',
    payment_intent_authentication_failure: 'A confirmação no app do banco não foi concluída. Tente de novo.',
    payment_intent_payment_attempt_failed: 'O pagamento não foi aprovado. Tente de novo ou use outra forma de pagamento.',
    payment_intent_unexpected_state: 'Este pagamento já foi processado. Atualize a página.',
    rate_limit: 'Muitas tentativas agora. Espere alguns segundos e tente de novo.'
  };

  function mensagemErro(e) {
    if (!e) return MSG_GERAL;
    var codigo = String(e.decline_code || '');
    if (codigo && ERROS[codigo]) return ERROS[codigo];
    if (e.code && ERROS[e.code]) return ERROS[e.code];
    // card_error / validation_error: o Stripe manda a frase pronta no idioma escolhido (pt-BR).
    if ((e.type === 'card_error' || e.type === 'validation_error') && e.message) return String(e.message);
    return MSG_GERAL;
  }

  // next_action do Pix (PaymentIntent em requires_action) -> dados para mostrar na nossa tela também.
  function pixDoIntent(pi) {
    var na = pi && pi.next_action;
    var px = na && (na.pix_display_qr_code || (na.type === 'pix_display_qr_code' ? na.pix_display_qr_code : null));
    if (!px || typeof px !== 'object') return null;
    var qr = String(px.image_url_png || px.image_url_svg || '');
    if (!/^https:\/\//i.test(qr)) qr = '';
    var instr = String(px.hosted_instructions_url || '');
    if (!/^https:\/\//i.test(instr)) instr = '';
    var copia = String(px.data || '');
    if (!qr && !copia) return null;
    var expira = Number(px.expires_at) ? new Date(Number(px.expires_at) * 1000).toISOString() : '';
    return { qr: qr, copiaECola: copia, expira: expira, instrucoesUrl: instr };
  }

  function resultadoConfirmacao(r) {
    if (r && r.error) return { status: 'erro', mensagem: mensagemErro(r.error), pix: null, paymentIntent: '' };
    var pi = (r && r.paymentIntent) || {};
    var id = /^pi_[A-Za-z0-9]+$/.test(String(pi.id || '')) ? String(pi.id) : '';
    if (pi.status === 'succeeded') return { status: 'pago', mensagem: '', pix: null, paymentIntent: id };
    if (pi.status === 'processing') return { status: 'pendente', mensagem: 'Pagamento em processamento. Assim que for aprovado, o relatório abre.', pix: null, paymentIntent: id };
    if (pi.status === 'requires_action') {
      var pix = pixDoIntent(pi);
      return { status: 'pendente', mensagem: pix ? 'Pague o Pix no app do seu banco. A liberação é automática.' : 'Falta concluir a confirmação no banco.', pix: pix, paymentIntent: id };
    }
    if (pi.status === 'requires_payment_method') return { status: 'erro', mensagem: 'O pagamento não foi aprovado. Tente de novo ou use outra forma de pagamento.', pix: null, paymentIntent: id };
    return { status: 'pendente', mensagem: '', pix: null, paymentIntent: id };
  }

  var PURAS = {
    URL_STRIPE_JS: URL_STRIPE_JS,
    EMPRESA: EMPRESA,
    mensagemErro: mensagemErro,
    pixDoIntent: pixDoIntent,
    resultadoConfirmacao: resultadoConfirmacao
  };
  if (typeof module !== 'undefined' && module.exports) { module.exports = PURAS; return; }
  root.DISC_STRIPE = PURAS;
  if (typeof document === 'undefined') return;

  /* ------------------------------------------------------------------ Navegador */

  var carregando = null;
  function carregar() {
    if (root.Stripe) return Promise.resolve(root.Stripe);
    if (carregando) return carregando;
    carregando = new Promise(function (ok, falha) {
      var s = document.createElement('script');
      s.src = URL_STRIPE_JS;
      s.async = true;
      s.onload = function () { if (root.Stripe) ok(root.Stripe); else { carregando = null; falha(new Error(MSG_CARREGAR)); } };
      s.onerror = function () { carregando = null; s.remove(); falha(new Error(MSG_CARREGAR)); };
      document.head.appendChild(s);
    });
    return carregando;
  }

  // Tokens de assets/notus.css (o iframe do Stripe não lê variáveis CSS: os valores vão prontos).
  function token(nome, padrao) {
    try {
      var v = root.getComputedStyle(document.documentElement).getPropertyValue(nome).trim();
      return v || padrao;
    } catch (e) { return padrao; }
  }
  function aparencia() {
    var tinta = token('--tinta', '#13283f');
    var notus = token('--notus', '#f34405');
    var linha = token('--linha', '#e2e6ec');
    var suave = token('--suave', '#6b7586');
    var erro = token('--erro', '#dc2626');
    var nevoa = token('--nevoa', '#eaeef4');
    return {
      theme: 'stripe',
      labels: 'above',
      variables: {
        colorPrimary: notus,
        colorText: tinta,
        colorTextSecondary: suave,
        colorTextPlaceholder: suave,
        colorBackground: token('--branco', '#ffffff'),
        colorDanger: erro,
        colorIcon: suave,
        fontFamily: '"Plus Jakarta Sans", system-ui, -apple-system, "Segoe UI", sans-serif',
        fontSizeBase: '16px',
        fontWeightNormal: '400',
        fontWeightMedium: '600',
        borderRadius: '12px',
        spacingUnit: '4px',
        focusBoxShadow: '0 0 0 3px rgba(243, 68, 5, .25)',
        focusOutline: 'none'
      },
      rules: {
        '.Input': { border: '1px solid ' + linha, boxShadow: 'none', padding: '12px 14px' },
        '.Input:focus': { borderColor: notus },
        '.Input--invalid': { borderColor: erro, boxShadow: 'none' },
        '.Label': { fontWeight: '600', color: tinta, fontSize: '13px' },
        '.Tab': { border: '1px solid ' + linha, boxShadow: 'none' },
        '.Tab:hover': { borderColor: suave },
        '.Tab--selected': { borderColor: notus, boxShadow: '0 0 0 1px ' + notus, backgroundColor: token('--branco', '#ffffff') },
        '.TabIcon--selected': { fill: notus },
        '.TabLabel--selected': { color: tinta },
        '.Block': { backgroundColor: nevoa, boxShadow: 'none', border: '0' },
        '.Error': { color: erro, fontSize: '13px' }
      }
    };
  }
  var FONTES = [{ cssSrc: 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700&display=swap' }];

  function montar(op) {
    op = op || {};
    return carregar().then(function (StripeFn) {
      var stripe = StripeFn(op.publicavel, { locale: 'pt-BR' });
      var elements = stripe.elements({ clientSecret: op.clientSecret, appearance: aparencia(), fonts: FONTES, locale: 'pt-BR', loader: 'auto' });
      var pe = elements.create('payment', {
        layout: { type: 'tabs', defaultCollapsed: false },
        wallets: { applePay: 'auto', googlePay: 'auto' },
        business: { name: EMPRESA }
      });
      pe.on('ready', function () { if (op.aoPronto) op.aoPronto(); });
      pe.on('change', function (ev) { if (op.aoMudar) op.aoMudar({ completo: !!(ev && ev.complete), tipo: ev && ev.value ? ev.value.type : '' }); });
      pe.on('loaderror', function () { if (op.aoErro) op.aoErro(MSG_CARREGAR); });
      pe.mount(op.el);
      var ativo = true;
      return {
        simulado: false,
        confirmar: function (returnUrl) {
          if (!ativo) return Promise.resolve({ status: 'erro', mensagem: MSG_GERAL, pix: null, paymentIntent: '' });
          return stripe.confirmPayment({ elements: elements, confirmParams: { return_url: returnUrl }, redirect: 'if_required' })
            .then(resultadoConfirmacao, function (e) { return { status: 'erro', mensagem: mensagemErro(e), pix: null, paymentIntent: '' }; });
        },
        destruir: function () { ativo = false; try { pe.destroy(); } catch (e) { /* já saiu da página */ } }
      };
    });
  }

  /* ---- Prévia / demonstração: um "Payment Element" de mentira (nada vai para o Stripe) ---- */
  function montarSimulado(op) {
    op = op || {};
    var el = op.el;
    var metodo = 'cartao';
    el.innerHTML = '' +
      '<div class="pe-sim" data-pe-simulado="1">' +
        '<div class="pe-sim-abas" role="tablist" aria-label="Forma de pagamento">' +
          '<button type="button" class="pe-sim-aba" role="tab" aria-selected="true" data-pe-metodo="cartao">Cartão</button>' +
          '<button type="button" class="pe-sim-aba" role="tab" aria-selected="false" data-pe-metodo="pix">Pix</button>' +
        '</div>' +
        '<div class="pe-sim-carteiras" aria-hidden="true"><span class="pe-sim-carteira">Apple Pay</span><span class="pe-sim-carteira">Google Pay</span></div>' +
        '<div class="pe-sim-painel" data-pe-painel="cartao">' +
          '<label class="pe-sim-campo"><span>Número do cartão</span><input class="entrada" id="pe-sim-numero" inputmode="numeric" autocomplete="off" placeholder="1234 1234 1234 1234" maxlength="23"></label>' +
          '<div class="pe-sim-linha">' +
            '<label class="pe-sim-campo"><span>Validade</span><input class="entrada" id="pe-sim-validade" inputmode="numeric" autocomplete="off" placeholder="MM / AA" maxlength="7"></label>' +
            '<label class="pe-sim-campo"><span>CVC</span><input class="entrada" id="pe-sim-cvc" inputmode="numeric" autocomplete="off" placeholder="123" maxlength="4"></label>' +
          '</div>' +
        '</div>' +
        '<div class="pe-sim-painel" data-pe-painel="pix" hidden><p class="pe-sim-nota" data-pe-pix-dica>Toque em Gerar o Pix: o QR Code e o copia e cola aparecem logo abaixo, na hora.</p></div>' +
        '<p class="pe-sim-nota">Demonstração: campos fictícios, nada é cobrado. Cartão 4000 0000 0000 0002 simula recusa.</p>' +
      '</div>';
    function trocar(m) {
      metodo = m === 'pix' ? 'pix' : 'cartao';
      Array.prototype.forEach.call(el.querySelectorAll('[data-pe-metodo]'), function (b) { b.setAttribute('aria-selected', String(b.getAttribute('data-pe-metodo') === metodo)); });
      Array.prototype.forEach.call(el.querySelectorAll('[data-pe-painel]'), function (p) { p.hidden = p.getAttribute('data-pe-painel') !== metodo; });
      // Mesmo formato do Payment Element de verdade (change.value.type): 'card' ou 'pix'.
      if (op.aoMudar) op.aoMudar({ completo: false, tipo: metodo === 'pix' ? 'pix' : 'card' });
    }
    function clique(ev) { var b = ev.target.closest('[data-pe-metodo]'); if (b && el.contains(b)) trocar(b.getAttribute('data-pe-metodo')); }
    el.addEventListener('click', clique);
    if (op.metodo === 'pix') root.setTimeout(function () { trocar('pix'); }, 0);
    var id = /^pi_[A-Za-z0-9]+$/.test(String(op.paymentIntent || '')) ? String(op.paymentIntent) : 'pi_previa' + Math.random().toString(36).slice(2, 10);
    if (op.aoPronto) root.setTimeout(op.aoPronto, 0);
    return {
      simulado: true,
      confirmar: function () {
        if (metodo === 'pix') {
          var px = op.pixFicticio || {};
          return Promise.resolve({ status: 'pendente', mensagem: 'Pague o Pix no app do seu banco. A liberação é automática.',
            pix: { qr: px.qr || '', copiaECola: px.copiaECola || 'PREVIA-NAO-PAGUE', expira: '', instrucoesUrl: '' }, paymentIntent: id });
        }
        var num = String((el.querySelector('#pe-sim-numero') || {}).value || '').replace(/\D/g, '');
        if (num.length < 12) return Promise.resolve({ status: 'erro', mensagem: 'O número do cartão está incompleto.', pix: null, paymentIntent: '' });
        if (/0002$/.test(num)) return Promise.resolve({ status: 'erro', mensagem: ERROS.card_declined, pix: null, paymentIntent: '' });
        return Promise.resolve().then(function () { return op.simularPago ? op.simularPago() : null; })
          .then(function () { return { status: 'pago', mensagem: '', pix: null, paymentIntent: id }; });
      },
      destruir: function () { el.removeEventListener('click', clique); }
    };
  }

  root.DISC_STRIPE.carregar = carregar;
  root.DISC_STRIPE.aparencia = aparencia;
  root.DISC_STRIPE.montar = montar;
  root.DISC_STRIPE.montarSimulado = montarSimulado;
})(typeof self !== 'undefined' ? self : this);
