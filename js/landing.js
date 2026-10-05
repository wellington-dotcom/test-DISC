/*
 * Landing de venda do Mapa DISC (descubra.html).
 *
 * - Pacotes: desenha os 3 cards com os valores padrão (contrato de vendas) e, se houver servidor, troca pelos
 *   valores do painel: window.DISC_API.pacotesPublicos() quando existir; senão, com CONFIG.BACKEND 'supabase',
 *   chama a RPC pública pacotes_publicos direto pelo REST (sem carregar o supabase-js, para a página ficar leve).
 *   Qualquer falha mantém os valores padrão, em silêncio.
 * - CTAs: "Começar meu mapa grátis" -> index.html?modo=pessoal; cada pacote -> index.html?modo=pessoal&pacote=<chave>.
 *   Parâmetros de campanha (utm_*, gclid, fbclid) que chegam na landing seguem para o teste.
 * - Contato "Para empresas": CONFIG.WHATSAPP_SUPORTE (só dígitos com DDI) vira link de WhatsApp.
 * - Rodapé: CONFIG.EMPRESA_LEGAL (razão social e CNPJ) quando preenchido.
 * - Barra fixa de CTA no celular quando o botão do herói sai da tela.
 *
 * Módulo UMD: no Node exporta as funções puras (testadas em tests/landing.test.js).
 */
(function (root) {
  'use strict';

  var PADRAO = [
    {
      chave: 'gratis', nome: 'Resumo grátis', precoCentavos: 0, precoLancamentoCentavos: null, lancamentoAte: null, ativo: true, ordem: 1,
      resumo: 'Para conhecer o seu perfil agora, sem pagar nada.',
      itens: ['Seu perfil em uma frase', 'O nome da sua combinação', 'Os 4 fatores em barras', 'Suas 3 maiores forças'],
      botao: 'Começar grátis'
    },
    {
      chave: 'completo', nome: 'Relatório completo', precoCentavos: 3900, precoLancamentoCentavos: 2900, lancamentoAte: null, ativo: true, ordem: 2,
      resumo: 'Para entender o que te trava e saber exatamente o que fazer.',
      itens: ['Tudo do resumo grátis', '<b>O que está te travando</b>, com uma ação para cada ponto', 'Plano de 30, 60 e 90 dias', 'Régua de intensidade e todas as seções', 'Versão para imprimir ou salvar em PDF', 'Acesso pelo seu link, para sempre'],
      botao: 'Quero o completo'
    },
    {
      chave: 'completo_plus', nome: 'Completo + Parte 2', precoCentavos: 6900, precoLancamentoCentavos: 4900, lancamentoAte: null, ativo: true, ordem: 3,
      resumo: 'Para quem sente que o trabalho pede alguém que você não é.',
      itens: ['Tudo do relatório completo', '<b>Parte 2:</b> como o seu trabalho ou rotina exigem que você seja', 'Onde você está se esticando', 'Mapa ritmo × foco', 'Plano de 90 dias estendido'],
      botao: 'Quero o completo + Parte 2'
    }
  ];
  var DESTAQUE = 'completo';
  var PARAMS_CAMPANHA = /^(utm_[a-z]+|gclid|fbclid|ref|cupom|demo)$/;

  function escapar(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // Itens padrão podem ter <b>; itens vindos do servidor são texto puro.
  function itemSeguro(t, confiavel) {
    return confiavel ? String(t) : escapar(t);
  }

  // 3900 -> "R$ 39"; 2990 -> "R$ 29,90"; 0 -> "R$ 0"
  function formatarPreco(centavos) {
    var c = Math.max(0, Math.round(Number(centavos) || 0));
    var reais = Math.floor(c / 100);
    var resto = c % 100;
    var inteiro = String(reais).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return 'R$ ' + inteiro + (resto ? ',' + (resto < 10 ? '0' : '') + resto : '');
  }

  function numeroOuNulo(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }
  function primeiro(obj, nomes) {
    for (var i = 0; i < nomes.length; i++) if (obj[nomes[i]] !== undefined) return obj[nomes[i]];
    return undefined;
  }
  function hojeISO(agora) {
    var d = agora || new Date();
    var m = d.getMonth() + 1, dia = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (dia < 10 ? '0' : '') + dia;
  }

  // Lança o preço de lançamento só se existir, for menor que o cheio e a data limite (se houver) não tiver passado.
  function precoAtual(p, agora) {
    var lanc = p.precoLancamentoCentavos;
    var valido = lanc !== null && lanc < p.precoCentavos && (!p.lancamentoAte || String(p.lancamentoAte).slice(0, 10) >= hojeISO(agora));
    return valido ? { valor: lanc, de: p.precoCentavos } : { valor: p.precoCentavos, de: null };
  }

  // Aceita a resposta do servidor em vários formatos ({pacotes:[...]}, [...], snake_case ou camelCase)
  // e completa com textos padrão por chave. Devolve null se não houver nada aproveitável.
  function normalizarPacotes(resp) {
    var lista = Array.isArray(resp) ? resp : (resp && (resp.pacotes || resp.dados || resp.data));
    if (!Array.isArray(lista) || !lista.length) return null;
    var porChave = {};
    PADRAO.forEach(function (p) { porChave[p.chave] = p; });
    var saida = [];
    lista.forEach(function (bruto) {
      if (!bruto || typeof bruto !== 'object') return;
      var chave = String(bruto.chave || bruto.id || '').trim();
      if (!/^[a-z0-9_]{1,40}$/.test(chave)) return;
      var base = porChave[chave] || {};
      var preco = numeroOuNulo(primeiro(bruto, ['preco_centavos', 'precoCentavos']));
      if (preco === null) preco = base.precoCentavos !== undefined ? base.precoCentavos : null;
      if (preco === null) return;
      var ativo = primeiro(bruto, ['ativo']);
      if (ativo === false) return;
      var descricao = bruto.descricao;
      if (typeof descricao === 'string') { try { descricao = JSON.parse(descricao); } catch (e) { descricao = { resumo: descricao }; } }
      descricao = descricao || {};
      var itensServidor = Array.isArray(descricao) ? descricao : (Array.isArray(descricao.itens) ? descricao.itens : null);
      if (itensServidor) itensServidor = itensServidor.filter(function (t) { return typeof t === 'string' && t.trim(); });
      var lanc = numeroOuNulo(primeiro(bruto, ['preco_lancamento_centavos', 'precoLancamentoCentavos']));
      saida.push({
        chave: chave,
        nome: String(bruto.nome || base.nome || chave),
        precoCentavos: preco,
        precoLancamentoCentavos: lanc,
        lancamentoAte: primeiro(bruto, ['lancamento_ate', 'lancamentoAte']) || null,
        ordem: numeroOuNulo(bruto.ordem) !== null ? Number(bruto.ordem) : (base.ordem || 99),
        resumo: (!Array.isArray(descricao) && typeof descricao.resumo === 'string' && descricao.resumo) || base.resumo || '',
        itens: itensServidor && itensServidor.length ? itensServidor : (base.itens || []),
        itensConfiaveis: !(itensServidor && itensServidor.length),
        botao: base.botao || 'Escolher este'
      });
    });
    if (!saida.length) return null;
    saida.sort(function (a, b) { return a.ordem - b.ordem; });
    return saida;
  }

  function hrefTeste(chave, busca) {
    var params = [];
    params.push('modo=pessoal');
    if (chave) params.push('pacote=' + encodeURIComponent(chave));
    var extra = paramsCampanha(busca);
    return 'index.html?' + params.concat(extra).join('&');
  }

  // Repassa utm_*, gclid, fbclid, ref e cupom da URL da landing para o teste.
  function paramsCampanha(busca) {
    if (!busca) return [];
    var saida = [];
    String(busca).replace(/^\?/, '').split('&').forEach(function (par) {
      if (!par) return;
      var k = par.split('=')[0];
      var nome;
      try { nome = decodeURIComponent(k); } catch (e) { return; }
      if (PARAMS_CAMPANHA.test(nome) && saida.length < 8 && par.length <= 200) saida.push(par);
    });
    return saida;
  }

  var ICONE_CHECK = '<svg aria-hidden="true"><use href="#i-check"/></svg>';

  function htmlPacote(p, destaque, busca, agora) {
    var pr = precoAtual(p, agora);
    var gratis = pr.valor === 0;
    var h = '<article class="pacote' + (destaque ? ' pacote--destaque' : '') + '" data-pacote="' + escapar(p.chave) + '" aria-labelledby="pacote-' + escapar(p.chave) + '">';
    if (destaque) h += '<span class="pacote__selo selo selo--laranja">Recomendado</span>';
    h += '<h3 class="pacote__nome" id="pacote-' + escapar(p.chave) + '">' + escapar(p.nome) + '</h3>';
    if (p.resumo) h += '<p class="pacote__resumo">' + escapar(p.resumo) + '</p>';
    h += '<p class="pacote__preco">';
    if (pr.de !== null) h += '<span class="pacote__de"><span class="visualmente-oculto">De </span><s>' + formatarPreco(pr.de) + '</s></span>';
    h += '<span class="pacote__valor" data-preco>' + (pr.de !== null ? '<span class="visualmente-oculto">por </span>' : '') + formatarPreco(pr.valor) + '</span>';
    h += '<span class="pacote__unico">' + (gratis ? 'para sempre' : 'pagamento único') + '</span>';
    h += '</p>';
    if (pr.de !== null) h += '<span class="pacote__lancamento">Preço de lançamento</span>';
    h += '<ul class="pacote__itens">';
    p.itens.forEach(function (t) { h += '<li>' + ICONE_CHECK + '<span>' + itemSeguro(t, p.itensConfiaveis !== false) + '</span></li>'; });
    h += '</ul>';
    var classe = destaque ? 'botao botao--principal botao--grande botao--bloco' : 'botao botao--claro botao--grande botao--bloco';
    h += '<a class="' + classe + '" href="' + escapar(hrefTeste(p.chave, busca)) + '" data-cta-pacote="' + escapar(p.chave) + '">' + escapar(p.botao) + '</a>';
    h += '</article>';
    return h;
  }

  function htmlPacotes(lista, busca, agora) {
    var temDestaque = lista.some(function (p) { return p.chave === DESTAQUE; });
    return lista.map(function (p, i) {
      var destaque = temDestaque ? p.chave === DESTAQUE : (lista.length === 3 && i === 1);
      return htmlPacote(p, destaque, busca, agora);
    }).join('');
  }

  function linkWhatsApp(numero, texto) {
    var dig = String(numero || '').replace(/\D/g, '');
    if (dig.length < 10 || dig.length > 15) return '';
    return 'https://wa.me/' + dig + (texto ? '?text=' + encodeURIComponent(texto) : '');
  }

  // ---------------- Navegador ----------------
  function buscarPacotesServidor(cfg) {
    var api = root.DISC_API;
    if (api && typeof api.pacotesPublicos === 'function') {
      return Promise.resolve().then(function () { return api.pacotesPublicos(); });
    }
    var backend = String((cfg && cfg.BACKEND) || '').toLowerCase();
    var url = String((cfg && cfg.SUPABASE_URL) || '').trim().replace(/\/+$/, '');
    var chave = String((cfg && cfg.SUPABASE_ANON_KEY) || '').trim();
    if (backend !== 'supabase' || !/^https:\/\//.test(url) || !chave || typeof root.fetch !== 'function') return Promise.resolve(null);
    var ctrl = typeof root.AbortController === 'function' ? new root.AbortController() : null;
    var relogio = ctrl ? setTimeout(function () { ctrl.abort(); }, 6000) : null;
    return root.fetch(url + '/rest/v1/rpc/pacotes_publicos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: chave, Authorization: 'Bearer ' + chave },
      body: '{}',
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) {
      if (relogio) clearTimeout(relogio);
      return r.ok ? r.json() : null;
    });
  }

  function iniciar() {
    var doc = root.document;
    var cfg = root.CONFIG || {};
    var busca = (root.location && root.location.search) || '';

    // CTAs gerais com parâmetros de campanha
    var extra = paramsCampanha(busca);
    if (extra.length) {
      Array.prototype.forEach.call(doc.querySelectorAll('a[data-cta]'), function (a) { a.setAttribute('href', hrefTeste('', busca)); });
    }

    // Pacotes: padrão na hora; servidor quando responder
    var alvo = doc.getElementById('pacotes-lista');
    if (alvo) {
      alvo.innerHTML = htmlPacotes(PADRAO, busca);
      buscarPacotesServidor(cfg).then(function (resp) {
        var lista = normalizarPacotes(resp && resp.ok === false ? null : resp);
        if (lista) alvo.innerHTML = htmlPacotes(lista, busca);
      }).catch(function () { /* mantém os valores padrão */ });
    }

    // Para empresas: WhatsApp de suporte
    var wa = linkWhatsApp(cfg.WHATSAPP_SUPORTE, 'Olá! Vim pela página do Mapa DISC e quero saber sobre o mapeamento para empresas.');
    if (wa) {
      var botao = doc.querySelector('[data-contato-empresas]');
      var nota = doc.querySelector('[data-contato-empresas-nota]');
      if (botao) { botao.href = wa; botao.target = '_blank'; botao.rel = 'noopener'; botao.hidden = false; }
      if (nota) nota.hidden = true;
    }

    // Rodapé legal
    var legal = String(cfg.EMPRESA_LEGAL || '').trim();
    var ano = new Date().getFullYear();
    var rod = doc.getElementById('empresa-legal');
    if (rod) rod.textContent = '© ' + ano + ' ' + (legal || 'Gestão sem Caos') + '. Todos os direitos reservados.';

    // Barra fixa de CTA (celular): aparece quando nenhum outro CTA principal está à vista
    var fixo = doc.getElementById('cta-fixo');
    var heroiCta = doc.querySelector('[data-cta="heroi"]');
    var finalSec = doc.getElementById('comecar');
    var pacotesSec = doc.getElementById('pacotes');
    if (fixo && heroiCta && typeof root.IntersectionObserver === 'function') {
      var visiveis = { heroi: true, final: false, pacotes: false };
      var atualizar = function () {
        var mostrar = !visiveis.heroi && !visiveis.final && !visiveis.pacotes;
        fixo.classList.toggle('cta-fixo--visivel', mostrar);
        fixo.setAttribute('aria-hidden', mostrar ? 'false' : 'true');
        var link = fixo.querySelector('a');
        if (link) link.tabIndex = mostrar ? 0 : -1;
      };
      var obs = new root.IntersectionObserver(function (entradas) {
        entradas.forEach(function (e) {
          if (e.target === heroiCta) visiveis.heroi = e.isIntersecting;
          else if (e.target === finalSec) visiveis.final = e.isIntersecting;
          else if (e.target === pacotesSec) visiveis.pacotes = e.isIntersecting;
        });
        atualizar();
      });
      obs.observe(heroiCta);
      if (finalSec) obs.observe(finalSec);
      if (pacotesSec) obs.observe(pacotesSec);
    }
  }

  var LANDING = {
    PADRAO: PADRAO, formatarPreco: formatarPreco, precoAtual: precoAtual, normalizarPacotes: normalizarPacotes,
    hrefTeste: hrefTeste, paramsCampanha: paramsCampanha, linkWhatsApp: linkWhatsApp, htmlPacotes: htmlPacotes
  };
  if (typeof module !== 'undefined' && module.exports) { module.exports = LANDING; return; }
  root.DISC_LANDING = LANDING;
  if (root.document) {
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', iniciar);
    else iniciar();
  }
})(typeof self !== 'undefined' ? self : this);
