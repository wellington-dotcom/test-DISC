/*
 * meu-relatorio.html — o relatório completo de quem comprou o Mapa de Perfil (venda B2C, Gestão sem Caos).
 *
 * Abre por meu-relatorio.html#t-<token> (o link que a pessoa recebe). Busca os dados com
 * DISC_API.relatorioPessoal(token) -> { nome, resultado: { percentuais, codigo }, exigido: '40 dígitos' | null,
 * pacote, pacoteNome, precisaParte2 } e monta o texto aqui, com js/relatorio-pessoa.js (DISC_RELATORIO_PESSOA)
 * e a mesma renderização do relatório ao candidato (DISC_APP.relatorioPessoaHtml), mais "O que está te travando",
 * e, no Completo + Parte 2, "Onde você está se esticando", o mapa ritmo × foco e o plano de 90 dias.
 * Relatório Completo Avançado: com js/disc-profundo.js + js/disc-profundo-dados.js carregados e o conteúdo da combinação,
 * os pacotes completo e completo_plus mostram a versão por combinação (capa, sumário, ~20 capítulos; DISC_APP.relatorioPessoaHtml
 * com avancado: true). Sem o conteúdo, cai no relatório acima. Caixinhas do plano: localStorage (disc_plano_<token>).
 * Completo + Parte 2 sem a Parte 2: pede a Parte 2 antes (index.html?modo=pessoal#p2-<token>, a mesma mecânica de arrastar).
 * Sem token (ou #recuperar): "Recuperar meu relatório" por e-mail (DISC_API.recuperarAcesso).
 *
 * Parte PURA (Node): tokenDaUrl(hash, search), dadosRelatorio(resp).
 */
(function (root) {
  'use strict';

  var EMPRESA = 'Gestão sem Caos';
  var PACOTES_AVANCADO = ['completo', 'completo_plus'];

  function tokenDaUrl(hash, search) {
    // Tolerância: parâmetros do retorno depois do token (#t-<token>?order_nsu=… ou #t-<token>&…).
    var h = /^#t-([A-Za-z0-9_-]{16,128})(?:[?&].*)?$/.exec(String(hash || ''));
    if (h) return h[1];
    var q = /[?&]t=([A-Za-z0-9_-]{16,128})(?:&|$)/.exec(String(search || ''));
    return q ? q[1] : '';
  }

  // Resposta de relatorioPessoal -> { primeiroNome, rel: { percentuais, codigo }, exigido (string|obj|null), pacote,
  // pacoteNome, precisaParte2 } ou null.
  function dadosRelatorio(resp) {
    var r = resp && resp.relatorio ? resp.relatorio : resp;
    if (!r || typeof r !== 'object') return null;
    var res = r.resultado || r;
    if (!res || !res.percentuais || !res.codigo) return null;
    var ex = r.exigido;
    var temEx = !!(ex && (typeof ex === 'string' ? ex.trim() : ex.percentuais));
    var pacote = String(r.pacote || 'completo');
    return {
      primeiroNome: String(r.nome || r.primeiroNome || '').trim().split(/\s+/)[0] || '',
      rel: { percentuais: res.percentuais, codigo: String(res.codigo) },
      exigido: temEx ? ex : null,
      pacote: pacote,
      pacoteNome: String(r.pacoteNome || ''),
      precisaParte2: r.precisaParte2 === true || (pacote === 'completo_plus' && !temEx)
    };
  }

  // Volta do pagamento -> objeto ou null:
  //   InfinitePay: ?order_nsu=&transaction_nsu=&slug=&capture_method=&receipt_url=
  //   Stripe (3DS / redirecionamento do banco): ?pedido=&payment_intent=pi_…&payment_intent_client_secret=…&redirect_status=
  //     succeeded|processing|failed (o client_secret é ignorado e some da URL).
  // pedido=<id> (o nosso) ou order_nsu=<id> (InfinitePay); também lidos de depois do token no hash.
  function retornoDaUrl(search, hash) {
    var resto = /^#t-[A-Za-z0-9_-]+([?&].*)$/.exec(String(hash || ''));
    var q = String(search || '') + (resto ? '&' + resto[1].slice(1) : '');
    function param(n) {
      var m = new RegExp('[?&]' + n + '=([^&#]*)').exec(q);
      try { return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')).slice(0, 200) : ''; } catch (e) { return ''; }
    }
    var pedido = param('order_nsu') || param('pedido');
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(pedido)) return null;
    var recibo = param('receipt_url');
    var pi = param('payment_intent');
    var rs = param('redirect_status');
    return {
      pedidoId: pedido,
      transactionNsu: param('transaction_nsu'),
      slug: param('slug'),
      metodo: param('capture_method'),
      reciboUrl: /^https:\/\//i.test(recibo) ? recibo : '',
      paymentIntent: /^pi_[A-Za-z0-9]{6,80}$/.test(pi) ? pi : '',
      redirectStatus: ['succeeded', 'processing', 'failed', 'requires_action'].indexOf(rs) >= 0 ? rs : ''
    };
  }

  var PURAS = { tokenDaUrl: tokenDaUrl, dadosRelatorio: dadosRelatorio, retornoDaUrl: retornoDaUrl };
  if (typeof module !== 'undefined' && module.exports) { module.exports = PURAS; return; }
  root.DISC_MEU_RELATORIO = PURAS;
  if (typeof document === 'undefined') return;

  var CONFIG = root.CONFIG || {};
  var el, aviso, token = '', dados = null, verSemParte2 = false;

  function esc(s) { return root.DISC_APP ? root.DISC_APP.escapar(s) : String(s == null ? '' : s); }
  function anunciar(msg) { if (aviso) { aviso.textContent = ''; root.setTimeout(function () { aviso.textContent = msg; }, 30); } }
  function api() { return root.DISC_API; }
  function temApi() { return !!(CONFIG.API_URL && String(CONFIG.API_URL).trim() && api()); }
  function link() { return root.DISC_CHECKOUT ? root.DISC_CHECKOUT.linkRelatorio(root.location.href, token) : root.location.href; }

  // Canal de suporte (CONFIG.WHATSAPP_SUPORTE ou CONFIG.EMAIL_SUPORTE): link pronto ou '' (sem canal, nada é prometido).
  function suporteHtml(mensagem, texto) {
    var wa = String(CONFIG.WHATSAPP_SUPORTE || '').replace(/\D/g, '');
    if (wa.length >= 10 && wa.length <= 15) {
      return '<a href="https://wa.me/' + esc(wa) + '?text=' + esc(encodeURIComponent(mensagem)) + '" target="_blank" rel="noopener noreferrer" data-suporte>' + esc(texto || 'Fale com a gente no WhatsApp') + '</a>';
    }
    var email = String(CONFIG.EMAIL_SUPORTE || '').trim();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      return '<a href="mailto:' + esc(email) + '?subject=' + esc(encodeURIComponent(mensagem)) + '" data-suporte>' + esc(texto ? texto.replace('no WhatsApp', 'por e-mail') : 'Escreva para ' + email) + '</a>';
    }
    return '';
  }
  function rodapeGarantia() {
    var sup = suporteHtml('Olá! Quero falar sobre o meu Mapa de Perfil (garantia de 7 dias).', 'Fale com o suporte');
    return '<p class="rodape-nota meu-rodape">' + esc(EMPRESA) + ' · Mapa de Perfil. O DISC descreve estilo de comportamento, não competência. ' +
      'Garantia de 7 dias: se não gostar, peça o reembolso' + (sup ? ': ' + sup + '.' : '.') + '</p>';
  }

  function focar() {
    var h = el.querySelector('h1');
    if (h) { h.setAttribute('tabindex', '-1'); try { h.focus({ preventScroll: true }); } catch (e) { h.focus(); } }
    try { root.scrollTo(0, 0); } catch (e) { /* ignora */ }
  }

  // aguardando: o pedido do link ainda não foi pago/confirmado -> botão "Consultar de novo".
  function telaRecuperar(msgErro, titulo, aguardando) {
    var sup = String(CONFIG.WHATSAPP_SUPORTE || '').replace(/\D/g, '');
    var envios = 0, emailPedido = '';
    el.innerHTML = '' +
      '<div class="pilha-telas">' +
        (msgErro
          ? '<section class="caixa surgir" aria-labelledby="titulo-erro">' +
              '<h1 id="titulo-erro" class="titulo-pagina">' + esc(titulo || 'Não conseguimos abrir o relatório') + '</h1>' +
              '<div class="aviso aviso--erro alerta" role="alert">' + esc(msgErro) + '</div>' +
              (aguardando
                ? '<p class="subtitulo">Se você pagou agora, a confirmação pode levar alguns instantes.</p>' +
                  '<div class="acoes acoes-coluna"><button type="button" class="botao botao--principal botao--grande" data-acao="consultar-de-novo">Consultar de novo</button></div>'
                : '') +
            '</section>'
          : '') +
        '<section class="caixa surgir recuperar" aria-labelledby="titulo-recuperar">' +
          '<p class="sobretitulo">' + esc(EMPRESA) + ' · Mapa de Perfil</p>' +
          (msgErro ? '<h2 id="titulo-recuperar" class="titulo-secao">Recuperar meu relatório</h2>'
            : '<h1 id="titulo-recuperar" class="titulo-pagina">Recuperar meu relatório</h1>') +
          '<p class="subtitulo">Informe o e-mail que você usou no teste. Se houver um relatório comprado com ele, enviamos o link de acesso.</p>' +
          '<form id="form-recuperar" class="formulario" novalidate>' +
            '<div class="campo">' +
              '<label class="campo__rotulo" for="email-recuperar">E-mail</label>' +
              '<input class="entrada" id="email-recuperar" type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" maxlength="120" required aria-describedby="erro-recuperar">' +
              '<p class="campo__erro erro" id="erro-recuperar" role="alert"></p>' +
            '</div>' +
            '<div class="acoes"><button type="submit" class="botao botao--principal botao--grande">Enviar o link</button></div>' +
          '</form>' +
          '<p class="sucesso recuperar-ok" id="recuperar-ok" role="status" aria-live="polite"></p>' +
          (suporteHtml('Olá! Preciso recuperar o meu Mapa de Perfil.') ? '<p class="rodape-nota recuperar-suporte">Não recebeu? ' + suporteHtml('Olá! Preciso recuperar o meu Mapa de Perfil.') + '.</p>' : '') +
          '<p class="rodape-nota"><a href="index.html?modo=pessoal">Voltar ao meu resumo</a> · <a href="index.html?modo=pessoal">Fazer o teste grátis</a></p>' +
        '</section>' +
      '</div>';
    var form = el.querySelector('#form-recuperar');
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var campo = form.querySelector('#email-recuperar');
      var erro = form.querySelector('#erro-recuperar');
      var ok = el.querySelector('#recuperar-ok');
      var email = String(campo.value || '').replace(/\s+/g, '').toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        erro.textContent = email ? 'Confira o e-mail (ex.: nome@gmail.com).' : 'Informe o e-mail que você usou no teste.';
        campo.setAttribute('aria-invalid', 'true');
        campo.focus();
        return;
      }
      erro.textContent = '';
      campo.removeAttribute('aria-invalid');
      var botao = form.querySelector('button[type="submit"]');
      botao.disabled = true;
      if (!temApi() || typeof api().recuperarAcesso !== 'function') {
        ok.textContent = 'A recuperação por e-mail ainda não está disponível. Fale com o suporte.';
        botao.disabled = false;
        return;
      }
      Promise.resolve().then(function () { return api().recuperarAcesso(email); }).then(function (r) {
        botao.disabled = false;
        var enviado = !(r && (r.enviado === false || r.ok === false));
        if (enviado) { envios = emailPedido === email ? envios + 1 : 1; emailPedido = email; }
        ok.textContent = enviado
          ? (envios > 1
            ? 'Já pedimos o link ' + envios + ' vezes para este e-mail. Ele pode levar alguns minutos: confira também o spam e a aba Promoções antes de pedir de novo.'
            : 'Pronto. Se houver um relatório com este e-mail, o link chega em alguns minutos. Confira também o spam.')
          : (r && r.erro ? r.erro + ' ' : 'O envio por e-mail ainda não está ligado. ') + (sup ? 'Ou fale com a gente pelo WhatsApp, no link abaixo.' : '');
        anunciar(ok.textContent);
      }, function (e) {
        botao.disabled = false;
        erro.textContent = (e && e.message) || 'Não deu para enviar agora. Tente de novo.';
      });
    });
    focar();
  }

  function telaParte2() {
    var url = 'index.html?modo=pessoal#p2-' + encodeURIComponent(token);
    el.innerHTML = '' +
      '<div class="pilha-telas">' +
        '<section class="caixa caixa--vidro parte2-pedido surgir" aria-labelledby="titulo">' +
          '<p class="sobretitulo">Completo + Parte 2</p>' +
          '<h1 id="titulo" class="titulo-pagina">' + (dados.primeiroNome ? esc(dados.primeiroNome) + ', falta' : 'Falta') + ' só a Parte 2</h1>' +
          '<p class="destaque">São 10 grupos de palavras, cerca de 3 minutos, agora pensando em como o seu trabalho pede que você seja. ' +
            'É com ela que o relatório mostra onde você está se esticando, o mapa ritmo × foco e o plano de 90 dias.</p>' +
          '<div class="acoes acoes-coluna">' +
            '<a class="botao botao--laranja botao--grande" href="' + esc(url) + '" data-acao="parte2">Responder a Parte 2</a>' +
            '<button type="button" class="botao botao--link" data-acao="sem-parte2">Ver o relatório sem a Parte 2 por enquanto</button>' +
          '</div>' +
        '</section>' +
      '</div>';
    focar();
  }

  // Bloco "Seu link de acesso". topo: versão curta logo depois da capa (três botões numa linha); o bloco completo
  // continua no fim. Os dois somem na impressão (.meu-link).
  function blocoLink(topo) {
    var ck = root.DISC_CHECKOUT;
    var url = link();
    var wa = ck ? ck.linkWhatsApp('Meu Mapa de Perfil (' + EMPRESA + '): ' + url, '') : '';
    var sufixo = topo ? '-topo' : '';
    return '' +
      '<section class="caixa rel-caixa meu-link' + (topo ? ' meu-link--topo' : '') + ' surgir" aria-labelledby="titulo-link' + sufixo + '" data-bloco-link>' +
        '<h2 id="titulo-link' + sufixo + '" class="caixa__titulo">' + (topo ? 'Guarde o seu acesso' : 'Seu link de acesso') + '</h2>' +
        (topo
          ? '<p class="rel-nota">O relatório abre sempre por este link. Guarde agora: copie, mande para o seu WhatsApp ou para o seu e-mail.</p>'
          : '<p class="rel-nota">Guarde este link: é por ele que você volta ao relatório quando quiser. Quem tiver o link consegue abrir, então compartilhe só com quem você quiser.</p>' +
            '<input class="entrada ck-link-texto" id="meu-link" type="text" readonly value="' + esc(url) + '" aria-labelledby="titulo-link">') +
        '<div class="ck-link-botoes">' +
          '<button type="button" class="botao botao--claro" data-acao="copiar-link">Copiar link</button>' +
          (wa ? '<a class="botao botao--claro" href="' + esc(wa) + '" target="_blank" rel="noopener noreferrer">Enviar no WhatsApp</a>' : '') +
          (podeEnviarEmail() ? '<button type="button" class="botao botao--claro"' + (topo ? '' : ' id="btn-enviar-meu-email"') + ' data-acao="enviar-email">Enviar para meu e-mail</button>' : '') +
        '</div>' +
        '<p class="sucesso"' + (topo ? '' : ' id="copiado"') + ' data-status role="status" aria-live="polite"></p>' +
        '<p class="campo__erro erro"' + (topo ? '' : ' id="erro-meu-email"') + ' data-erro role="alert"></p>' +
      '</section>';
  }

  // Relatório Completo Avançado (js/disc-profundo.js): pacotes completo e completo_plus (este com a Parte 2).
  // Sem o conteúdo da combinação (ou sem o módulo), devolve null e a página usa o relatório de antes.
  function montarAvancado(ex) {
    var P = root.DISC_PROFUNDO;
    if (!P || PACOTES_AVANCADO.indexOf(dados.pacote) === -1) return null;
    try {
      var op = { data: root.DISC_DATA };
      if (ex && dados.pacote === 'completo_plus') op.exigido = ex;
      return P.montar(dados.rel, dados.primeiroNome, op);
    } catch (e) { return null; }
  }

  function telaRelatorio() {
    var R = root.DISC_RELATORIO_PESSOA, A = root.DISC_APP;
    var d = null, av = null;
    try {
      var ex = dados.exigido;
      if (ex && typeof ex === 'string' && root.DISC_EXIGIDO) ex = root.DISC_EXIGIDO.calcular(ex);
      av = montarAvancado(ex);
      if (!av) d = ex ? R.montar(dados.rel, dados.primeiroNome, root.DISC_DATA, { exigido: ex }) : R.montar(dados.rel, dados.primeiroNome, root.DISC_DATA);
    } catch (e) { d = null; }
    if (av && A) { telaAvancado(av); return; }
    if (!d || !A) { telaRecuperar('Não conseguimos montar o relatório. Atualize a página.'); return; }
    var plus = dados.pacote === 'completo_plus';
    el.innerHTML = '' +
      '<div class="pilha-telas">' +
        '<header class="meu-cabeca surgir">' +
          '<p class="sobretitulo">' + esc(EMPRESA) + ' · ' + esc(dados.pacoteNome || (plus ? 'Completo + Parte 2' : 'Relatório completo')) + '</p>' +
          '<h1 class="titulo-pagina">Seu Mapa de Perfil</h1>' +
        '</header>' +
        (plus && dados.precisaParte2
          ? '<div class="aviso meu-aviso-p2">Falta a Parte 2 para ver onde você está se esticando. <a href="index.html?modo=pessoal#p2-' + esc(encodeURIComponent(token)) + '">Responder agora (3 minutos)</a></div>'
          : '') +
        A.relatorioPessoaHtml(d, '', { travas: true, plano90: plus, mapa: plus, botaoPdf: 'Imprimir ou salvar em PDF' }) +
        blocoLink() +
        rodapeGarantia() +
      '</div>';
    // "Guarde o seu acesso" logo depois do primeiro cartão (o relatório é longo; o bloco completo fica no fim).
    var primeiro = el.querySelector('.relatorio-pessoa > .rel-caixa');
    if (primeiro) primeiro.insertAdjacentHTML('afterend', blocoLink(true));
    document.title = (dados.primeiroNome ? dados.primeiroNome + ' · ' : '') + 'Meu Mapa de Perfil · ' + EMPRESA;
    focar();
  }

  function telaAvancado(av) {
    var A = root.DISC_APP;
    var plus = dados.pacote === 'completo_plus';
    el.innerHTML = '' +
      '<div class="pilha-telas">' +
        (plus && dados.precisaParte2
          ? '<div class="aviso meu-aviso-p2">Falta a Parte 2 para ver onde você está se esticando. <a href="index.html?modo=pessoal#p2-' + esc(encodeURIComponent(token)) + '">Responder agora (3 minutos)</a></div>'
          : '') +
        A.relatorioPessoaHtml(av, '', { avancado: true, botaoPdf: 'Imprimir ou salvar em PDF', aposCapa: blocoLink(true) }) +
        blocoLink() +
        rodapeGarantia() +
      '</div>';
    document.title = (dados.primeiroNome ? dados.primeiroNome + ' · ' : '') + 'Meu Mapa de Perfil · ' + EMPRESA;
    restaurarPlano();
    focar();
  }

  // Caixinhas do plano 30/60/90: estado só neste aparelho (localStorage), por link de acesso.
  function chavePlano() { return 'disc_plano_' + token; }
  function lerPlano() {
    try { var v = JSON.parse(root.localStorage.getItem(chavePlano()) || '{}'); return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; }
  }
  function restaurarPlano() {
    var marcados = lerPlano();
    Array.prototype.forEach.call(el.querySelectorAll('input[data-plano]'), function (c) { c.checked = marcados[c.getAttribute('data-plano')] === true; });
  }
  function aoMarcar(ev) {
    var c = ev.target;
    if (!c || !c.matches || !c.matches('input[data-plano]')) return;
    var marcados = lerPlano();
    if (c.checked) marcados[c.getAttribute('data-plano')] = true; else delete marcados[c.getAttribute('data-plano')];
    try { root.localStorage.setItem(chavePlano(), JSON.stringify(marcados)); } catch (e) { /* sem armazenamento: só não guarda */ }
  }

  // Sumário e "Voltar ao sumário": rola até o capítulo sem mexer no hash (o hash é o token de acesso).
  function irPara(id) {
    var alvo = id ? document.getElementById(id) : null;
    if (!alvo) return;
    var reduzir = false;
    try { reduzir = root.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { reduzir = false; }
    try { alvo.scrollIntoView({ behavior: reduzir ? 'auto' : 'smooth', block: 'start' }); } catch (e) { alvo.scrollIntoView(); }
    var foco = alvo.matches('section') ? alvo.querySelector('h2') : alvo;
    if (foco) { foco.setAttribute('tabindex', '-1'); try { foco.focus({ preventScroll: true }); } catch (e) { /* ignora */ } }
  }

  // "Enviar para meu e-mail": o link vai para o e-mail usado na compra (o servidor sabe qual; aqui só o token).
  function podeEnviarEmail() { return temApi() && typeof api().enviarLinkPorEmail === 'function' && !!token; }
  function statusDo(btn, sel) {
    var bloco = btn && btn.closest ? btn.closest('[data-bloco-link]') : null;
    return (bloco && bloco.querySelector(sel)) || el.querySelector(sel === '[data-status]' ? '#copiado' : '#erro-meu-email');
  }
  function enviarMeuEmail(btn) {
    var st = statusDo(btn, '[data-status]'), er = statusDo(btn, '[data-erro]');
    if (st) st.textContent = '';
    if (er) er.textContent = '';
    btn.disabled = true;
    btn.textContent = 'Enviando…';
    Promise.resolve().then(function () { return api().enviarLinkPorEmail(token); }).then(function (r) {
      if (!r || r.ok !== true) throw new Error((r && r.erro) || 'Não foi possível enviar agora.');
      var msg = 'Enviamos o link para ' + (r.email || 'o e-mail da compra') + '. Confira também o spam.';
      if (st) st.textContent = msg;
      anunciar(msg);
      btn.textContent = 'Enviado';
    }).catch(function (e) {
      if (er) er.textContent = (e && e.message) || 'Não foi possível enviar agora. Tente de novo em instantes.';
      btn.disabled = false;
      btn.textContent = 'Enviar para meu e-mail';
    });
  }

  function copiar(texto, btn) {
    var st = statusDo(btn, '[data-status]');
    function ok() { if (st) st.textContent = 'Link copiado!'; anunciar('Link copiado.'); }
    function manual() {
      var campo = el.querySelector('#meu-link');
      if (campo) { campo.focus(); campo.select(); }
      var foi = false;
      try { foi = document.execCommand('copy'); } catch (e) { foi = false; }
      if (foi) ok(); else if (st) st.textContent = 'Selecione o link e copie manualmente.';
    }
    if (root.navigator && root.navigator.clipboard && root.isSecureContext) root.navigator.clipboard.writeText(texto).then(ok, manual);
    else manual();
  }

  function aoClicar(ev) {
    var alvo = ev.target.closest('[data-acao]');
    if (!alvo || !el.contains(alvo)) return;
    var acao = alvo.getAttribute('data-acao');
    if (acao === 'ir-capitulo') { ev.preventDefault(); irPara(alvo.getAttribute('data-alvo')); return; }
    if (acao === 'imprimir') { try { root.print(); } catch (e) { /* sem impressão */ } }
    else if (acao === 'copiar-link') copiar(link(), alvo);
    else if (acao === 'consultar-de-novo') carregar();
    else if (acao === 'enviar-email') enviarMeuEmail(alvo);
    else if (acao === 'sem-parte2') { verSemParte2 = true; telaRelatorio(); }
    else if (acao === 'ja-paguei' && espera) {
      espera.inicio = Date.now();
      statusTexto('Consultando o pagamento…');
      consultar(true);
    }
  }

  /* ---- Volta do pagamento (InfinitePay ou Stripe): confirma o retorno e espera a confirmação, se precisar ---- */
  var ESPERA_MS = 4000, ESPERA_MAX = 2 * 60 * 1000;
  var espera = null;   // { ret, inicio, timer }

  function pararEspera() { if (espera && espera.timer) root.clearTimeout(espera.timer); espera = null; }

  // Volta do banco com o pagamento recusado (3DS): nada foi cobrado; o botão leva de volta ao pagamento do mesmo pedido
  // (index.html?modo=pessoal restaura o checkout salvo neste aparelho).
  function telaPagamentoNaoConcluido() {
    var sup = suporteHtml('Olá! O banco recusou o pagamento do Mapa de Perfil e preciso de ajuda.');
    el.innerHTML = '' +
      '<div class="pilha-telas">' +
        '<section class="caixa surgir pagamento-falhou" aria-labelledby="titulo">' +
          '<p class="sobretitulo">' + esc(EMPRESA) + ' · Mapa de Perfil</p>' +
          '<h1 id="titulo" class="titulo-pagina">Pagamento não concluído</h1>' +
          '<div class="aviso aviso--erro alerta" role="alert">O pagamento não foi aprovado pelo banco e nada foi cobrado.</div>' +
          '<p class="subtitulo">Você pode tentar de novo agora, com outro cartão, Apple Pay, Google Pay ou Pix. O seu resumo e o pedido continuam salvos.</p>' +
          '<div class="acoes acoes-coluna">' +
            '<a class="botao botao--laranja botao--grande" href="index.html?modo=pessoal" data-acao="tentar-pagar">Tentar pagar de novo</a>' +
          '</div>' +
          (sup ? '<p class="rodape-nota">Algum problema? ' + sup + '.</p>' : '') +
        '</section>' +
      '</div>';
    focar();
  }

  function telaConfirmando() {
    var sup = suporteHtml('Olá! Paguei o Mapa de Perfil e o relatório não abriu. Pedido: ' + (espera ? espera.ret.pedidoId : ''));
    el.innerHTML = '' +
      '<div class="pilha-telas">' +
        '<section class="caixa centro confirmando surgir" aria-labelledby="titulo" aria-busy="true">' +
          '<div class="giro giro--grande" aria-hidden="true"></div>' +
          '<h1 id="titulo" class="titulo-pagina">Confirmando seu pagamento…</h1>' +
          '<p class="subtitulo confirmando-status" id="confirmando-status" role="status" aria-live="polite">Isso costuma levar poucos segundos. Não feche esta página.</p>' +
          '<div class="acoes acoes-coluna"><button type="button" class="botao botao--claro botao--grande" data-acao="ja-paguei">Já paguei</button></div>' +
          '<p class="rodape-nota">Algum problema? ' + (sup
            ? sup + '.'
            : '<a href="meu-relatorio.html#recuperar">Recuperar meu relatório</a>.') + '</p>' +
        '</section>' +
      '</div>';
    focar();
  }

  function statusTexto(t) { var s = el.querySelector('#confirmando-status'); if (s) s.textContent = t; }

  function liberadoStatus(st) { return st === 'pago' || st === 'cortesia'; }

  function consultar(primeira) {
    if (!espera) return;
    var e = espera;
    if (e.timer) { root.clearTimeout(e.timer); e.timer = null; }
    var a = api();
    var chamada = primeira && typeof a.confirmarRetorno === 'function'
      ? function () { return a.confirmarRetorno(e.ret.pedidoId, token, { transactionNsu: e.ret.transactionNsu, slug: e.ret.slug, paymentIntent: e.ret.paymentIntent }); }
      : function () { return a.statusPedido(e.ret.pedidoId, token); };
    Promise.resolve().then(chamada).then(function (r) {
      if (espera !== e) return;
      var st = String((r && (r.status || (r.pedido && r.pedido.status))) || '');
      if (liberadoStatus(st)) { pararEspera(); carregar(); return; }
      if (st === 'estornado' || st === 'cancelado') { pararEspera(); telaRecuperar('Este pedido foi ' + st + '.', 'Pagamento não concluído'); return; }
      agendarConsulta();
    }, function () { if (espera === e) agendarConsulta(); });
  }

  function agendarConsulta() {
    if (!espera) return;
    if (Date.now() - espera.inicio > ESPERA_MAX) {
      statusTexto('Ainda não recebemos a confirmação. Se você já pagou, toque em Já paguei em alguns instantes ou fale com o suporte.');
      return;
    }
    espera.timer = root.setTimeout(function () { consultar(false); }, ESPERA_MS);
  }

  function voltaDoPagamento(ret) {
    // Limpa a query (dados do pagamento) e mantém o hash com o token.
    try { root.history.replaceState(null, '', root.location.pathname + '#t-' + token); } catch (e) { /* ignora */ }
    pararEspera();
    // Stripe: o banco recusou (3DS não concluído etc.). Nada foi cobrado; a pessoa volta e tenta de novo.
    if (ret.redirectStatus === 'failed') { telaPagamentoNaoConcluido(); return; }
    espera = { ret: ret, inicio: Date.now(), timer: null };
    telaConfirmando();
    consultar(true);
  }

  function carregar() {
    token = tokenDaUrl(root.location.hash, root.location.search);
    if (!token || /^#recuperar/.test(String(root.location.hash || ''))) { pararEspera(); telaRecuperar(''); return; }
    var ret = retornoDaUrl(root.location.search, root.location.hash);
    if (ret && temApi() && typeof api().statusPedido === 'function') { voltaDoPagamento(ret); return; }
    if (!temApi() || typeof api().relatorioPessoal !== 'function') {
      telaRecuperar('O relatório precisa do servidor, que não está configurado nesta página.');
      return;
    }
    Promise.resolve().then(function () { return api().relatorioPessoal(token); }).then(function (r) {
      if (r && r.ok === false) throw Object.assign(new Error(r.erro || 'Relatório não encontrado.'), { resposta: r });
      dados = dadosRelatorio(r);
      if (!dados) throw new Error('Relatório não encontrado.');
      if (dados.precisaParte2 && !verSemParte2) telaParte2(); else telaRelatorio();
    }, function (e) { throw e; }).catch(function (e) {
      var st = e && e.resposta && e.resposta.status;
      telaRecuperar((e && e.message) || 'Verifique a sua conexão e tente de novo.',
        st === 'aguardando' ? 'Pagamento ainda não confirmado' : 'Não conseguimos abrir o relatório', st === 'aguardando');
    });
  }

  function iniciar() {
    el = document.getElementById('relatorio');
    aviso = document.getElementById('aviso');
    if (!el) return;
    el.addEventListener('click', aoClicar);
    el.addEventListener('change', aoMarcar);
    root.addEventListener('hashchange', function () { verSemParte2 = false; carregar(); });
    carregar();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})(typeof self !== 'undefined' ? self : this);
