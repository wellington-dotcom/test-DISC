/*
 * Checkout do Mapa de Perfil (venda B2C, Gestão sem Caos): pacotes, cupom, Pix (QR + copia e cola), cartão (link),
 * espera da confirmação (consulta a cada 4 s) e confirmação com o link do relatório.
 *
 * Módulo UMD (global DISC_CHECKOUT). Parte PURA (testada no Node):
 *   PACOTES_PADRAO, normalizarPacotes(resp), precoVigente(pacote, hoje), formatarPreco(centavos),
 *   liberado(status), linkRelatorio(base, token), linkWhatsApp(texto, telefone), normalizarPagamento(resp),
 *   pagamentoIndisponivel(erroOuResp), resumoPedido(resp)
 * Parte do navegador: criar(opcoes) -> { montar(el), parar() }
 *   opcoes: { api, tokenResumo, pacote (normalizado), pedido (salvo, opcional), cupom (pré-preenchido), telefone, aoMudar(pedido),
 *             aoVoltar(), aoParte2(pedido), aoAnunciar(msg), intervaloMs (padrão 4000) }
 * Usa só as funções públicas da API B2C: criarPedido, iniciarPagamento, statusPedido (e simularPagamento na prévia).
 * Só texto puro na tela: tudo passa por escapar().
 */
(function (root) {
  'use strict';

  var EMPRESA = 'Gestão sem Caos';
  var INTERVALO_MS = 4000;
  var ESPERA_MAX_MS = 30 * 60 * 1000;   // depois de 30 min de espera, para de consultar sozinho (botão "Já paguei")

  var PACOTES_PADRAO = [
    { chave: 'gratis', nome: 'Resumo grátis', precoCentavos: 0, precoLancamentoCentavos: null, lancamentoAte: null, ordem: 0,
      itens: ['Seu perfil em uma frase', 'O nome da sua combinação', 'Os 4 fatores com barras', '3 forças do seu jeito'] },
    { chave: 'completo', nome: 'Relatório completo', precoCentavos: 3900, precoLancamentoCentavos: 2900, lancamentoAte: null, ordem: 1,
      itens: ['O que está te travando, com uma ação para cada ponto', 'Régua de intensidade dos 4 fatores',
        'Como você decide, aprende, se comunica e reage sob pressão', 'Plano prático de 30, 60 e 90 dias',
        'Versão para imprimir ou salvar em PDF', 'Acesso pelo seu link, sem prazo'] },
    { chave: 'completo_plus', nome: 'Completo + Parte 2', precoCentavos: 6900, precoLancamentoCentavos: 4900, lancamentoAte: null, ordem: 2,
      destaque: true,
      itens: ['Tudo do relatório completo', 'Parte 2: como o seu trabalho pede que você seja (3 minutos)',
        'Onde você está se esticando', 'Mapa ritmo × foco: você e o seu trabalho', 'Plano de 90 dias no trabalho'] }
  ];

  function escapar(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function num(v) {
    if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
    var n = Number(v);
    return isFinite(n) ? Math.round(n) : null;
  }
  function pega(o, nomes) {
    for (var i = 0; i < nomes.length; i++) if (o && o[nomes[i]] !== undefined && o[nomes[i]] !== null) return o[nomes[i]];
    return undefined;
  }

  // Lista de itens da descrição (jsonb): array de textos, { itens: [...] } ou texto com quebras de linha.
  function itensDe(desc, padrao) {
    var d = desc;
    if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { d = d.split(/\n+/); } }
    if (d && !Array.isArray(d) && Array.isArray(d.itens)) d = d.itens;
    if (!Array.isArray(d)) return padrao ? padrao.slice() : [];
    var out = d.map(function (x) { return String(x == null ? '' : x).trim(); }).filter(Boolean).slice(0, 10);
    return out.length ? out : (padrao ? padrao.slice() : []);
  }

  // Resposta de pacotesPublicos (array ou { pacotes }) -> pacotes ativos, na ordem, com nomes em camelCase.
  // Sem resposta válida: PACOTES_PADRAO.
  function normalizarPacotes(resp) {
    var lista = Array.isArray(resp) ? resp : (resp && Array.isArray(resp.pacotes) ? resp.pacotes : null);
    if (!lista || !lista.length) return PACOTES_PADRAO.map(function (p) { return JSON.parse(JSON.stringify(p)); });
    var padrao = {};
    PACOTES_PADRAO.forEach(function (p) { padrao[p.chave] = p; });
    return lista.map(function (p, i) {
      var chave = String(pega(p, ['chave', 'id']) || '').trim();
      var base = padrao[chave] || {};
      var preco = num(pega(p, ['precoCentavos', 'preco_centavos']));
      var lanc = num(pega(p, ['precoLancamentoCentavos', 'preco_lancamento_centavos']));
      var ativo = pega(p, ['ativo']);
      var ordem = num(pega(p, ['ordem']));
      return {
        chave: chave,
        nome: String(pega(p, ['nome']) || base.nome || chave),
        precoCentavos: preco === null ? (base.precoCentavos || 0) : Math.max(0, preco),
        precoLancamentoCentavos: lanc === null || lanc < 0 ? null : lanc,
        lancamentoAte: String(pega(p, ['lancamentoAte', 'lancamento_ate']) || '') || null,
        ordem: ordem === null ? i : ordem,
        ativo: ativo === undefined ? true : ativo !== false,
        destaque: chave === 'completo_plus',
        valorCentavos: num(pega(p, ['valorCentavos', 'valor_centavos'])),
        subtitulo: String((pega(p, ['descricao']) || {}).subtitulo || ''),
        itens: itensDe(pega(p, ['descricao', 'itens']), base.itens)
      };
    }).filter(function (p) { return p.chave && p.ativo; })
      .sort(function (a, b) { return a.ordem - b.ordem; });
  }

  function dataIso(hoje) {
    var d = hoje instanceof Date ? hoje : new Date();
    var mm = String(d.getMonth() + 1), dd = String(d.getDate());
    return d.getFullYear() + '-' + (mm.length < 2 ? '0' : '') + mm + '-' + (dd.length < 2 ? '0' : '') + dd;
  }

  // Preço que vale hoje: o de lançamento (se houver e a data não tiver passado) ou o cheio.
  // -> { centavos, cheioCentavos, lancamento: bool }
  function precoVigente(p, hoje) {
    var cheio = p && isFinite(p.precoCentavos) ? p.precoCentavos : 0;
    // O servidor já manda o valor de hoje (valorCentavos): ele manda.
    if (p && typeof p.valorCentavos === 'number' && isFinite(p.valorCentavos) && !hoje) {
      return { centavos: p.valorCentavos, cheioCentavos: cheio, lancamento: p.valorCentavos < cheio };
    }
    var lanc = p ? p.precoLancamentoCentavos : null;
    var ate = p && p.lancamentoAte ? String(p.lancamentoAte).slice(0, 10) : '';
    var valeLanc = lanc !== null && lanc !== undefined && isFinite(lanc) && lanc < cheio && (!ate || dataIso(hoje) <= ate);
    return { centavos: valeLanc ? lanc : cheio, cheioCentavos: cheio, lancamento: !!valeLanc };
  }

  // 2900 -> "R$ 29"; 2990 -> "R$ 29,90"; 0 -> "Grátis".
  function formatarPreco(centavos) {
    var c = num(centavos);
    if (!c || c <= 0) return 'Grátis';
    var reais = Math.floor(c / 100), resto = c % 100;
    var milhar = String(reais).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return 'R$ ' + milhar + (resto ? ',' + (resto < 10 ? '0' : '') + resto : '');
  }

  function liberado(status) { return status === 'pago' || status === 'cortesia'; }

  // Link do relatório: base = URL da página atual (o arquivo é trocado por meu-relatorio.html).
  function linkRelatorio(base, token) {
    var b = String(base || '').split('#')[0].split('?')[0];
    b = b.replace(/[^/]*$/, '');
    return b + 'meu-relatorio.html#t-' + encodeURIComponent(String(token || ''));
  }

  // "Enviar para meu WhatsApp": com o número da pessoa abre a conversa com ela mesma; sem número, escolhe o contato.
  function linkWhatsApp(texto, telefone) {
    var n = String(telefone || '').replace(/\D/g, '');
    if (n && n.length <= 11) n = '55' + n;
    if (n.length < 12) n = '';
    return 'https://wa.me/' + n + '?text=' + encodeURIComponent(String(texto || ''));
  }

  // Resposta de criarPedido -> { pedidoId, tokenAcesso, valorCentavos, gratuito, status, pacote }.
  function resumoPedido(resp, pacote) {
    var r = resp && resp.pedido ? resp.pedido : (resp || {});
    var valor = num(pega(r, ['valorCentavos', 'valor_centavos', 'valor']));
    var gratuito = r.gratuito === true || pega(r, ['status']) === 'cortesia';
    return {
      pedidoId: String(pega(r, ['pedidoId', 'id']) || ''),
      tokenAcesso: String(pega(r, ['tokenAcesso', 'token_acesso', 'token']) || ''),
      valorCentavos: valor === null ? null : valor,
      gratuito: gratuito,
      status: gratuito ? 'cortesia' : String(pega(r, ['status']) || 'aguardando'),
      pacote: String(pega(r, ['pacote']) || pacote || '')
    };
  }

  // Resposta de iniciarPagamento -> { qr (data URL ou ''), copiaECola, invoiceUrl, vencimento }.
  function normalizarPagamento(resp) {
    var r = resp && resp.pagamento ? resp.pagamento : (resp || {});
    var pix = r.pix || {};
    var qr = String(pega(pix, ['qrCodeBase64', 'qrBase64', 'encodedImage', 'qr']) || pega(r, ['qrCodeBase64', 'qrBase64', 'pixQrCode', 'qr']) || '');
    if (qr && !/^data:image\//.test(qr)) qr = /^[A-Za-z0-9+/=\s]+$/.test(qr) ? 'data:image/png;base64,' + qr.replace(/\s+/g, '') : '';
    if (qr && !/^data:image\/(png|jpeg|gif|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(qr)) qr = '';
    var url = String(pega(r, ['cartaoUrl', 'invoiceUrl', 'invoice_url', 'linkCartao', 'urlCartao']) || '');
    if (!/^https:\/\//i.test(url)) url = '';
    // Checkout hospedado (InfinitePay): a pessoa vai para a página do provedor e volta para meu-relatorio.html.
    var redir = String(pega(r, ['redirecionarUrl', 'redirectUrl', 'checkoutUrl']) || '');
    if (!/^https:\/\//i.test(redir) && !/^meu-relatorio\.html[?#]/.test(redir)) redir = '';
    return {
      provedor: String(pega(r, ['provedor']) || (redir ? 'infinitepay' : 'asaas')),
      redirecionarUrl: redir,
      qr: qr,
      copiaECola: String(pega(pix, ['copiaECola', 'payload', 'copiaCola']) || pega(r, ['copiaECola', 'pixCopiaECola', 'payload']) || ''),
      invoiceUrl: url,
      vencimento: String(pega(r, ['vencimento', 'dueDate']) || '')
    };
  }

  // Pagamento ainda não configurado no servidor (sem ASAAS_API_KEY)?
  function pagamentoIndisponivel(x) {
    var msg = x && (x.erro || x.message || (x.resposta && x.resposta.erro)) || '';
    return !!(x && (x.ok === false || x instanceof Error || x.message !== undefined) && /não configurad|indispon/i.test(String(msg)));
  }

  // CPF com os dígitos verificadores (o Asaas recusa CPF inválido).
  function cpfValido(v) {
    var d = String(v == null ? '' : v).replace(/\D/g, '');
    if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
    for (var t = 9; t < 11; t++) {
      var soma = 0;
      for (var i = 0; i < t; i++) soma += Number(d.charAt(i)) * (t + 1 - i);
      var dig = ((soma * 10) % 11) % 10;
      if (dig !== Number(d.charAt(t))) return false;
    }
    return true;
  }

  var PURAS = {
    cpfValido: cpfValido,
    EMPRESA: EMPRESA,
    INTERVALO_MS: INTERVALO_MS,
    PACOTES_PADRAO: PACOTES_PADRAO,
    escapar: escapar,
    normalizarPacotes: normalizarPacotes,
    precoVigente: precoVigente,
    formatarPreco: formatarPreco,
    liberado: liberado,
    linkRelatorio: linkRelatorio,
    linkWhatsApp: linkWhatsApp,
    resumoPedido: resumoPedido,
    normalizarPagamento: normalizarPagamento,
    pagamentoIndisponivel: pagamentoIndisponivel
  };
  if (typeof module !== 'undefined' && module.exports) { module.exports = PURAS; return; }
  root.DISC_CHECKOUT = PURAS;
  if (typeof document === 'undefined') return;

  /* ------------------------------------------------------------------ Navegador */

  var ICONE_PIX = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 3l9 9-9 9-9-9z"/><path d="M8 12h8"/></svg>';
  var ICONE_CARTAO = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18M7 15h4"/></svg>';
  var ICONE_ESCUDO = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/></svg>';

  function criar(op) {
    op = op || {};
    var api = op.api || root.DISC_API;
    var pacote = op.pacote || PACOTES_PADRAO[1];
    var pedido = op.pedido && op.pedido.pedidoId ? op.pedido : null;
    var el = null;
    var timer = null;
    var inicioEspera = 0;
    var st = {
      tela: pedido ? (liberado(pedido.status) ? 'confirmado' : (pedido.pagamento ? 'pagamento' : 'revisao')) : 'revisao',
      metodo: 'pix',
      cupomAberto: !!op.cupom,
      cupom: pedido && pedido.cupom ? pedido.cupom : String(op.cupom || ''),
      erro: '',
      ocupado: false,
      indisponivel: false,
      parado: false
    };

    function aviso(msg) { if (op.aoAnunciar) op.aoAnunciar(msg); }
    function mudou() { if (op.aoMudar) op.aoMudar(pedido); }
    function preco() { return precoVigente(pacote); }
    function link() { return pedido ? linkRelatorio(root.location.href, pedido.tokenAcesso) : ''; }

    function resumoPacoteHtml() {
      var pv = preco();
      var valor = pedido && pedido.valorCentavos !== null && pedido.valorCentavos !== undefined ? pedido.valorCentavos : pv.centavos;
      var riscado = pv.lancamento || (pedido && valor < pv.centavos) ? '<s class="ck-preco-cheio">' + escapar(formatarPreco(pv.lancamento ? pv.cheioCentavos : pv.centavos)) + '</s>' : '';
      return '' +
        '<div class="ck-pacote">' +
          '<div class="ck-pacote-topo">' +
            '<p class="ck-pacote-nome">' + escapar(pacote.nome) + '</p>' +
            '<p class="ck-preco">' + riscado + '<strong class="ck-preco-valor" id="ck-valor">' + escapar(formatarPreco(valor)) + '</strong></p>' +
          '</div>' +
          '<p class="ck-pacote-nota">Pagamento único. Acesso pelo seu link, sem mensalidade.</p>' +
        '</div>';
    }

    function erroHtml() {
      return '<p class="ck-erro aviso aviso--erro" id="ck-erro" role="alert"' + (st.erro ? '' : ' hidden') + '>' + escapar(st.erro) + '</p>';
    }

    function cupomHtml() {
      return '' +
        '<div class="ck-cupom">' +
          '<button type="button" class="botao botao--link ck-cupom-abrir" data-ck="cupom-abrir" aria-expanded="' + (st.cupomAberto ? 'true' : 'false') + '" aria-controls="ck-cupom-campo">Tenho um cupom</button>' +
          '<div class="campo ck-cupom-campo" id="ck-cupom-campo"' + (st.cupomAberto ? '' : ' hidden') + '>' +
            '<label class="campo__rotulo" for="ck-cupom">Cupom de desconto</label>' +
            '<input class="entrada" id="ck-cupom" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="40" value="' + escapar(st.cupom) + '">' +
            '<p class="campo__ajuda">O desconto aparece no próximo passo.</p>' +
          '</div>' +
        '</div>';
    }

    function garantiaHtml() {
      return '<p class="ck-garantia">' + ICONE_ESCUDO + '<span><strong>Garantia de 7 dias.</strong> Não gostou? Devolvemos o valor, sem perguntas.</span></p>';
    }

    function telaRevisao() {
      return '' +
        '<section class="caixa ck' + surgir() + '" aria-labelledby="ck-titulo" data-ck-tela="revisao">' +
          '<p class="sobretitulo">Seu pedido</p>' +
          '<h1 id="ck-titulo" class="titulo-pagina">Finalizar compra</h1>' +
          resumoPacoteHtml() +
          (st.indisponivel
            ? '<div class="aviso ck-indisponivel" role="status"><strong>Compra disponível em breve.</strong> Se você tem um cupom, use-o abaixo para liberar o relatório.</div>'
            : '') +
          cupomHtml() +
          (st.precisaCpf
            ? '<div class="campo ck-cpf">' +
                '<label class="campo__rotulo" for="ck-cpf">CPF</label>' +
                '<input class="entrada" id="ck-cpf" type="text" inputmode="numeric" autocomplete="off" maxlength="14" placeholder="000.000.000-00" value="' + escapar(st.cpf || '') + '">' +
                '<p class="campo__ajuda">O emissor do Pix pede o CPF de quem paga. Ele vai só para o processador do pagamento.</p>' +
              '</div>'
            : '') +
          '<div class="acoes acoes-coluna ck-acoes">' +
            '<button type="button" class="botao botao--laranja botao--grande" data-ck="continuar"' + (st.ocupado ? ' disabled aria-busy="true"' : '') + '>' +
              (st.ocupado ? 'Gerando o pagamento…' : (st.indisponivel ? 'Usar cupom' : 'Ir para o pagamento')) + '</button>' +
            '<button type="button" class="botao botao--claro botao--grande" data-ck="voltar">Voltar ao meu resumo</button>' +
          '</div>' +
          erroHtml() +
          garantiaHtml() +
          '<p class="ck-letra-miuda">Pagamento processado com segurança pelo Asaas. Vendido por ' + escapar(EMPRESA) + '.</p>' +
        '</section>';
    }

    function seletorHtml() {
      var pg = (pedido && pedido.pagamento) || {};
      var temPix = !!(pg.qr || pg.copiaECola);
      var temCartao = !!pg.invoiceUrl;
      if (!temPix && temCartao) st.metodo = 'cartao';
      if (temPix && !temCartao) st.metodo = 'pix';
      if (!(temPix && temCartao)) return '';
      return '' +
        '<div class="ck-metodos" role="tablist" aria-label="Forma de pagamento">' +
          '<button type="button" class="ck-metodo" role="tab" id="ck-aba-pix" aria-controls="ck-painel-pix" aria-selected="' + (st.metodo === 'pix') + '" data-ck="metodo" data-metodo="pix">' + ICONE_PIX + 'Pix</button>' +
          '<button type="button" class="ck-metodo" role="tab" id="ck-aba-cartao" aria-controls="ck-painel-cartao" aria-selected="' + (st.metodo === 'cartao') + '" data-ck="metodo" data-metodo="cartao">' + ICONE_CARTAO + 'Cartão</button>' +
        '</div>';
    }

    // InfinitePay: resumo do pedido + um botão para a página segura deles (mesma aba); a volta cai em meu-relatorio.html.
    function telaRedirecionar(pg) {
      return '' +
        '<section class="caixa ck' + surgir() + '" aria-labelledby="ck-titulo" data-ck-tela="pagamento" data-provedor="infinitepay">' +
          '<p class="sobretitulo">Pagamento</p>' +
          '<h1 id="ck-titulo" class="titulo-pagina">Falta só pagar</h1>' +
          resumoPacoteHtml() +
          '<div class="acoes acoes-coluna ck-acoes">' +
            '<a class="botao botao--laranja botao--grande" href="' + escapar(pg.redirecionarUrl) + '" data-ck="redirecionar">Pagar com Pix ou cartão</a>' +
          '</div>' +
          '<p class="ck-texto ck-redirecionar-nota">Você vai para a página segura da InfinitePay e volta aqui automaticamente.</p>' +
          '<div class="acoes acoes-coluna ck-acoes">' +
            '<button type="button" class="botao botao--claro botao--grande" data-ck="verificar">Já paguei</button>' +
            '<button type="button" class="botao botao--link" data-ck="trocar">Trocar o pacote ou o cupom</button>' +
          '</div>' +
          '<div class="ck-espera ck-espera--discreta" role="status" aria-live="polite"><span id="ck-status">Depois de pagar, o relatório abre sozinho.</span></div>' +
          erroHtml() +
          garantiaHtml() +
        '</section>';
    }

    function telaPagamento() {
      var pg = (pedido && pedido.pagamento) || {};
      if (pg.redirecionarUrl) return telaRedirecionar(pg);
      var simular = api && typeof api.simularPagamento === 'function';
      return '' +
        '<section class="caixa ck' + surgir() + '" aria-labelledby="ck-titulo" data-ck-tela="pagamento">' +
          '<p class="sobretitulo">Pagamento</p>' +
          '<h1 id="ck-titulo" class="titulo-pagina">Falta só pagar</h1>' +
          resumoPacoteHtml() +
          seletorHtml() +
          '<div class="ck-painel" id="ck-painel-pix" role="tabpanel" aria-labelledby="ck-aba-pix"' + (st.metodo === 'pix' ? '' : ' hidden') + '>' +
            '<ol class="ck-passos"><li>Abra o app do seu banco e escolha <strong>Pix</strong>.</li><li>Leia o QR Code ou use o <strong>Pix copia e cola</strong>.</li><li>Pronto: a liberação é automática.</li></ol>' +
            (pg.qr ? '<div class="ck-qr"><img src="' + escapar(pg.qr) + '" alt="QR Code do Pix" width="200" height="200"></div>' : '') +
            (pg.copiaECola
              ? '<div class="campo ck-copia">' +
                  '<label class="campo__rotulo" for="ck-pix">Pix copia e cola</label>' +
                  '<textarea class="entrada ck-pix-texto" id="ck-pix" readonly rows="3" spellcheck="false">' + escapar(pg.copiaECola) + '</textarea>' +
                  '<button type="button" class="botao botao--principal botao--grande botao--bloco" data-ck="copiar-pix">Copiar código Pix</button>' +
                  '<p class="sucesso" id="ck-copiado" role="status" aria-live="polite"></p>' +
                '</div>'
              : '') +
          '</div>' +
          '<div class="ck-painel" id="ck-painel-cartao" role="tabpanel" aria-labelledby="ck-aba-cartao"' + (st.metodo === 'cartao' ? '' : ' hidden') + '>' +
            '<p class="ck-texto">Você vai para a página segura de pagamento do Asaas. Depois de pagar, volte para esta tela: ela se atualiza sozinha.</p>' +
            (pg.invoiceUrl ? '<a class="botao botao--principal botao--grande botao--bloco" href="' + escapar(pg.invoiceUrl) + '" target="_blank" rel="noopener noreferrer" data-ck="cartao">Pagar com cartão</a>' : '') +
          '</div>' +
          '<div class="ck-espera" role="status" aria-live="polite">' +
            '<span class="giro" aria-hidden="true"></span>' +
            '<span id="ck-status">Aguardando a confirmação do pagamento…</span>' +
          '</div>' +
          '<div class="acoes acoes-coluna ck-acoes">' +
            '<button type="button" class="botao botao--claro botao--grande" data-ck="verificar">Já paguei</button>' +
            (simular ? '<button type="button" class="botao botao--contorno botao--grande" data-ck="simular">Simular pagamento aprovado (prévia)</button>' : '') +
            '<button type="button" class="botao botao--link" data-ck="trocar">Trocar o pacote ou o cupom</button>' +
          '</div>' +
          erroHtml() +
          (pg.vencimento ? '<p class="ck-letra-miuda">O Pix vale até ' + escapar(String(pg.vencimento).slice(0, 10).split('-').reverse().join('/')) + '.</p>' : '') +
          garantiaHtml() +
        '</section>';
    }

    function telaConfirmado() {
      var plus = pedido && pedido.pacote === 'completo_plus';
      var url = link();
      var wa = linkWhatsApp('Meu Mapa de Perfil (' + EMPRESA + '): ' + url, op.telefone);
      var cortesia = pedido && pedido.status === 'cortesia';
      return '' +
        '<section class="caixa caixa--vidro ck ck-ok' + surgir() + '" aria-labelledby="ck-titulo" data-ck-tela="confirmado">' +
          '<div class="icone-ok" aria-hidden="true">✓</div>' +
          '<h1 id="ck-titulo" class="titulo-pagina">' + (cortesia ? 'Acesso liberado' : 'Pagamento confirmado') + '</h1>' +
          '<p class="destaque">' + (plus
            ? 'Falta um passo de 3 minutos: a Parte 2, pensando no seu trabalho. Depois disso o seu relatório completo abre na hora.'
            : 'O seu relatório completo já está liberado. Guarde o link abaixo: é por ele que você volta quando quiser.') + '</p>' +
          '<div class="ck-link">' +
            '<label class="campo__rotulo" for="ck-link">Seu link</label>' +
            '<input class="entrada ck-link-texto" id="ck-link" type="text" readonly value="' + escapar(url) + '">' +
            '<div class="ck-link-botoes">' +
              '<button type="button" class="botao botao--claro" data-ck="copiar-link">Copiar link</button>' +
              '<a class="botao botao--claro" href="' + escapar(wa) + '" target="_blank" rel="noopener noreferrer">Enviar para meu WhatsApp</a>' +
            '</div>' +
            '<p class="sucesso" id="ck-copiado" role="status" aria-live="polite"></p>' +
          '</div>' +
          '<div class="acoes acoes-coluna ck-acoes">' +
            (plus
              ? '<button type="button" class="botao botao--laranja botao--grande" data-ck="parte2">Responder a Parte 2</button>'
              : '<a class="botao botao--laranja botao--grande" href="' + escapar(url) + '" data-ck="ver">Ver meu relatório</a>') +
          '</div>' +
        '</section>';
    }

    function html() {
      if (st.tela === 'confirmado') return telaConfirmado();
      if (st.tela === 'pagamento') return telaPagamento();
      return telaRevisao();
    }

    // A entrada animada só quando a tela muda (redesenhar a mesma tela não pode "pular").
    var telaDesenhada = '';
    function surgir() { return st.tela === telaDesenhada ? '' : ' surgir'; }
    function desenhar(focar) {
      if (!el) return;
      el.innerHTML = html();
      telaDesenhada = st.tela;
      if (focar) {
        var h = el.querySelector('h1');
        if (h) { h.setAttribute('tabindex', '-1'); try { h.focus({ preventScroll: true }); } catch (e) { h.focus(); } }
        try { root.scrollTo(0, 0); } catch (e) { /* ignora */ }
      }
      if (st.tela === 'pagamento') agendar(); else pararTimer();
    }

    function mostrarErro(msg) {
      st.erro = msg || '';
      var p = el && el.querySelector('#ck-erro');
      if (p) { p.textContent = st.erro; p.hidden = !st.erro; }
    }

    function pararTimer() { if (timer) { root.clearTimeout(timer); timer = null; } }

    function agendar() {
      pararTimer();
      if (st.parado || !pedido) return;
      if (!inicioEspera) inicioEspera = Date.now();
      if (Date.now() - inicioEspera > ESPERA_MAX_MS) {
        var s = el && el.querySelector('#ck-status');
        if (s) s.textContent = 'Ainda não recebemos a confirmação. Se já pagou, toque em Já paguei.';
        return;
      }
      timer = root.setTimeout(function () { verificar(false); }, op.intervaloMs || INTERVALO_MS);
    }

    function confirmar(status) {
      pedido.status = status;
      st.tela = 'confirmado';
      mudou();
      aviso(status === 'cortesia' ? 'Acesso liberado.' : 'Pagamento confirmado.');
      desenhar(true);
    }

    function verificar(manual) {
      if (!pedido || st.parado) return;
      pararTimer();
      var s = el && el.querySelector('#ck-status');
      if (manual && s) s.textContent = 'Consultando o pagamento…';
      Promise.resolve().then(function () { return api.statusPedido(pedido.pedidoId, pedido.tokenAcesso); }).then(function (r) {
        if (st.parado) return;
        var status = String((r && (r.status || (r.pedido && r.pedido.status))) || '');
        if (liberado(status)) { confirmar(status); return; }
        if (status === 'estornado' || status === 'cancelado') {
          mostrarErro('Este pedido foi ' + status + '. Gere um novo pagamento.');
          return;
        }
        if (s) s.textContent = manual ? 'Ainda não recebemos a confirmação. Pix costuma levar segundos; cartão, alguns minutos.' : 'Aguardando a confirmação do pagamento…';
        agendar();
      }, function () {
        if (st.parado) return;
        if (s) s.textContent = 'Sem conexão no momento. Tentando de novo…';
        agendar();
      });
    }

    // -> 'pago' (já liberado) ou 'pagamento'. CPF só quando o Asaas pedir (vai só para o Asaas).
    function iniciarPagamento(cpf) {
      return Promise.resolve().then(function () {
        return cpf ? api.iniciarPagamento(pedido.pedidoId, pedido.tokenAcesso, { cpf: cpf }) : api.iniciarPagamento(pedido.pedidoId, pedido.tokenAcesso);
      }).then(function (r) {
        if (r && r.pago === true) return liberado(r.status) ? r.status : 'pago';
        if (r && r.precisaCpf) throw Object.assign(new Error(r.erro || 'Informe o seu CPF para pagar.'), { precisaCpf: true });
        if (pagamentoIndisponivel(r) || (r && r.naoConfigurado)) throw Object.assign(new Error((r && r.erro) || 'Pagamento ainda não configurado.'), { indisponivel: true });
        if (r && r.ok === false) throw new Error(r.erro || 'Não conseguimos gerar o pagamento. Tente de novo em instantes.');
        var pg = normalizarPagamento(r);
        if (!pg.qr && !pg.copiaECola && !pg.invoiceUrl && !pg.redirecionarUrl) throw new Error('Não conseguimos gerar o pagamento. Tente de novo em instantes.');
        pedido.pagamento = pg;
        mudou();
        return 'pagamento';
      }, function (e) {
        if (e && e.resposta && e.resposta.precisaCpf) throw Object.assign(new Error(e.message), { precisaCpf: true });
        throw e;
      });
    }

    function continuar() {
      if (st.ocupado) return;
      var campo = el.querySelector('#ck-cupom');
      var cupom = campo ? String(campo.value || '').replace(/\s+/g, '').toUpperCase() : '';
      st.cupom = cupom;
      if (st.indisponivel && !cupom) {
        st.cupomAberto = true;
        desenhar(false);
        mostrarErro('Digite o seu cupom para continuar.');
        var c = el.querySelector('#ck-cupom'); if (c) c.focus();
        return;
      }
      var cpfCampo = el.querySelector('#ck-cpf');
      var cpf = cpfCampo ? String(cpfCampo.value || '').replace(/\D/g, '') : '';
      st.cpf = cpfCampo ? cpfCampo.value : '';
      if (st.precisaCpf && !cpfValido(cpf)) {
        mostrarErro(cpf.length === 11 ? 'CPF inválido. Confira os números.' : 'Informe o seu CPF (11 números).');
        if (cpfCampo) { cpfCampo.setAttribute('aria-invalid', 'true'); cpfCampo.focus(); }
        return;
      }
      st.ocupado = true;
      st.erro = '';
      desenhar(false);
      var reaproveita = pedido && pedido.pedidoId && !liberado(pedido.status) && (pedido.cupom || '') === cupom;
      Promise.resolve().then(function () { return reaproveita ? null : api.criarPedido(op.tokenResumo, pacote.chave, cupom); }).then(function (r) {
        if (!reaproveita) {
          if (r && r.ok === false) throw Object.assign(new Error(r.erro || 'Não foi possível criar o pedido.'), { resposta: r });
          pedido = resumoPedido(r, pacote.chave);
          pedido.cupom = cupom;
          if (!pedido.pedidoId || !pedido.tokenAcesso) throw new Error('Não foi possível criar o pedido. Tente de novo.');
          mudou();
        }
        if (liberado(pedido.status)) { st.ocupado = false; confirmar(pedido.status); return null; }
        return iniciarPagamento(st.precisaCpf ? cpf : '').then(function (res) {
          st.ocupado = false;
          if (res !== 'pagamento') { confirmar(res); return; }
          st.tela = 'pagamento';
          inicioEspera = Date.now();
          desenhar(true);
          aviso('Pagamento gerado. Aguardando a confirmação.');
        });
      }).catch(function (e) {
        st.ocupado = false;
        if (e && e.precisaCpf) {
          st.erro = st.precisaCpf ? e.message : 'Para gerar o pagamento, informe o seu CPF no campo acima.';
          st.precisaCpf = true;
          desenhar(false);
          var cc = el.querySelector('#ck-cpf'); if (cc) cc.focus();
          return;
        }
        if (e && (e.indisponivel || pagamentoIndisponivel(e))) {
          st.indisponivel = true;
          st.cupomAberto = true;
          pedido = null;
          mudou();
          st.erro = '';
          desenhar(false);
          return;
        }
        st.erro = (e && e.message) || 'Não foi possível continuar. Verifique a conexão e tente de novo.';
        desenhar(false);
      });
    }

    function copiar(texto, ok) {
      var status = el.querySelector('#ck-copiado');
      function feito() { if (status) status.textContent = ok; aviso(ok); }
      function manual() {
        var ta = document.createElement('textarea');
        ta.value = texto; ta.setAttribute('readonly', ''); ta.className = 'visualmente-oculto';
        document.body.appendChild(ta); ta.select();
        var foi = false;
        try { foi = document.execCommand('copy'); } catch (e) { foi = false; }
        document.body.removeChild(ta);
        if (foi) feito(); else if (status) status.textContent = 'Selecione o texto e copie manualmente.';
      }
      if (root.navigator && root.navigator.clipboard && root.isSecureContext) root.navigator.clipboard.writeText(texto).then(feito, manual);
      else manual();
    }

    function aoClicar(ev) {
      var alvo = ev.target.closest('[data-ck]');
      if (!alvo || !el.contains(alvo) || alvo.disabled) return;
      var acao = alvo.getAttribute('data-ck');
      switch (acao) {
        case 'cupom-abrir':
          st.cupomAberto = !st.cupomAberto;
          alvo.setAttribute('aria-expanded', String(st.cupomAberto));
          var caixa = el.querySelector('#ck-cupom-campo');
          if (caixa) caixa.hidden = !st.cupomAberto;
          if (st.cupomAberto) { var c = el.querySelector('#ck-cupom'); if (c) c.focus(); }
          break;
        case 'continuar': continuar(); break;
        case 'voltar': parar(); if (op.aoVoltar) op.aoVoltar(); break;
        case 'metodo':
          st.metodo = alvo.getAttribute('data-metodo') === 'cartao' ? 'cartao' : 'pix';
          Array.prototype.forEach.call(el.querySelectorAll('.ck-metodo'), function (b) {
            b.setAttribute('aria-selected', String(b.getAttribute('data-metodo') === st.metodo));
          });
          el.querySelector('#ck-painel-pix').hidden = st.metodo !== 'pix';
          el.querySelector('#ck-painel-cartao').hidden = st.metodo !== 'cartao';
          break;
        case 'copiar-pix': copiar(pedido && pedido.pagamento ? pedido.pagamento.copiaECola : '', 'Código Pix copiado!'); break;
        case 'copiar-link': copiar(link(), 'Link copiado!'); break;
        case 'verificar': verificar(true); break;
        case 'simular':
          alvo.disabled = true;
          Promise.resolve().then(function () { return api.simularPagamento(pedido.pedidoId, pedido.tokenAcesso); })
            .then(function () { verificar(true); }, function (e) { alvo.disabled = false; mostrarErro((e && e.message) || 'Não deu para simular.'); });
          break;
        case 'trocar':
          pararTimer();
          pedido = null;
          mudou();
          st.tela = 'revisao';
          desenhar(true);
          break;
        case 'parte2': parar(); if (op.aoParte2) op.aoParte2(pedido); break;
      }
    }

    function montar(alvo) {
      el = alvo;
      st.parado = false;
      el.addEventListener('click', aoClicar);
      desenhar(false);
      // Voltou para a aba (ex.: pagou no app do banco): consulta na hora.
      document.addEventListener('visibilitychange', aoVoltarAba);
    }
    function aoVoltarAba() { if (!document.hidden && st.tela === 'pagamento' && !st.parado) verificar(false); }

    function parar() {
      st.parado = true;
      pararTimer();
      document.removeEventListener('visibilitychange', aoVoltarAba);
      if (el) el.removeEventListener('click', aoClicar);
    }

    return { montar: montar, parar: parar, estado: function () { return { tela: st.tela, pedido: pedido }; } };
  }

  root.DISC_CHECKOUT.criar = criar;
})(typeof self !== 'undefined' ? self : this);
