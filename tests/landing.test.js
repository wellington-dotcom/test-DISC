'use strict';
// Landing de venda (descubra.html) e páginas legais: identidade (só a paleta Notus, escala e pesos permitidos),
// marca "Gestão sem Caos" no texto visível e as funções puras de js/landing.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../js/landing.js');

const raiz = path.join(__dirname, '..');
const ler = (a) => fs.readFileSync(path.join(raiz, a), 'utf8');
const ARQUIVOS = ['descubra.html', 'assets/landing.css', 'js/landing.js', 'termos.html', 'privacidade.html'];
const HTML = ['descubra.html', 'termos.html', 'privacidade.html'];

// Mesmas cores liberadas de scripts/checar-visual.mjs (tokens de assets/notus.css + funcionais).
const CORES = new Set([
  '#f34405', '#f2762e', '#ff9f40', '#324e73', '#13283f', '#0c1a2a', '#141414', '#f2f2f2',
  '#c43803', '#eaeef4', '#e2e6ec', '#6b7586', '#46546a', '#e9ecef', '#8a97ab', '#5d7699', '#c5ccd6',
  '#fff', '#ffffff', '#b91c1c', '#dc2626', '#fecaca', '#fef2f2', '#fca5a5', '#047857', '#065f46', '#ecfdf5'
]);
const rgb = (h) => { const x = h.length === 4 ? h.slice(1).split('').map((c) => c + c).join('') : h.slice(1); return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16)).join(','); };
const RGB = new Set([...CORES].map(rgb));
// A landing é moldura de marca: usa a escala editorial (docs/IDENTIDADE-VISUAL.md, "Documentos").
const ESCALA = new Set([11, 12, 13, 15, 16, 18, 20, 22, 24, 28, 32, 40, 44, 56, 64, 72]);
const PESOS = new Set(['400', '500', '600', '700', 'normal', 'bold', 'inherit']);

test('landing usa só cores da paleta, tamanhos da escala e pesos permitidos', () => {
  const problemas = [];
  for (const arq of ARQUIVOS) {
    ler(arq).split('\n').forEach((linha, i) => {
      const onde = `${arq}:${i + 1}`;
      const l = linha.replace(/\/\*.*?\*\//g, '');
      for (const m of l.matchAll(/#([0-9a-fA-F]{3,8})\b/g)) {
        const antes = l.slice(0, m.index);
        if (/(href|id|for|aria-[a-z]+)=["'][^"']*$/.test(antes) || /url\(#$/.test(antes)) continue;
        if (![3, 6].includes(m[1].length)) { problemas.push(`${onde}: cor ${m[0]}`); continue; }
        if (!CORES.has('#' + m[1].toLowerCase())) problemas.push(`${onde}: cor fora da paleta ${m[0]}`);
      }
      for (const m of l.matchAll(/%23([0-9a-fA-F]{6})\b/g)) {
        if (!CORES.has('#' + m[1].toLowerCase())) problemas.push(`${onde}: cor fora da paleta %23${m[1]}`);
      }
      for (const m of l.matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g)) {
        if (!RGB.has(`${m[1]},${m[2]},${m[3]}`)) problemas.push(`${onde}: rgba fora da paleta ${m[0]}`);
      }
      for (const m of l.matchAll(/font-size\s*[:=]\s*['"]?([0-9.]+)(px)?/gi)) {
        if (!ESCALA.has(Number(m[1]))) problemas.push(`${onde}: font-size ${m[1]} fora da escala`);
      }
      if (/font-size\s*:\s*[0-9.]+(rem|em|vw|vh|pt)\b|font-size\s*:\s*(clamp|calc|min|max)\(/i.test(l)) problemas.push(`${onde}: font-size só em px da escala ou var()`);
      for (const m of l.matchAll(/font-weight\s*[:=]\s*['"]?([a-z0-9]+)/gi)) {
        if (!PESOS.has(m[1].toLowerCase())) problemas.push(`${onde}: font-weight ${m[1]}`);
      }
      if (/<select\b/i.test(l)) problemas.push(`${onde}: <select> nativo`);
      if (/(^|[^.\w])(window\.)?(confirm|prompt|alert)\s*\(/.test(l)) problemas.push(`${onde}: confirm/prompt/alert`);
      if (/repeating-(linear|radial)-gradient/i.test(l)) problemas.push(`${onde}: listras`);
    });
  }
  assert.deepEqual(problemas, []);
});

test('marca visível é "Gestão sem Caos" (sem "Notus" no texto nem o ícone da estrela)', () => {
  for (const arq of HTML) {
    const html = ler(arq);
    const texto = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<[^>]+>/g, ' ');
    assert.ok(!/notus/i.test(texto), `${arq}: "Notus" no texto visível`);
    assert.ok(!/content="[^"]*notus/i.test(html), `${arq}: "Notus" em meta`);
    assert.ok(!html.includes('icone.svg'), `${arq}: não usar o logo da estrela`);
    assert.ok(/Gestão sem Caos/.test(html), `${arq}: falta a marca`);
  }
  for (const arq of ['termos.html', 'privacidade.html']) assert.match(ler(arq), /revisar com advogado/i);
});

test('logo oficial da Gestão sem Caos em todas as páginas públicas (nunca a estrela da Notus)', () => {
  for (const arq of ['descubra.html', 'termos.html', 'privacidade.html', 'index.html', 'meu-relatorio.html', 'relatorio.html', 'admin.html']) {
    const html = ler(arq);
    assert.ok(!html.includes('icone.svg'), `${arq}: logo da Notus`);
    assert.match(html, /rel="icon" type="image\/svg\+xml" href="assets\/marca\/gsc-favicon\.svg"/, `${arq}: favicon`);
  }
  for (const arq of ['descubra.html', 'termos.html', 'privacidade.html', 'meu-relatorio.html', 'index.html', 'admin.html']) {
    assert.match(ler(arq), /src="assets\/marca\/gsc-logo(-negativo|-preto)?\.svg" alt="Gestão sem Caos"/, `${arq}: logo`);
  }
  for (const f of ['gsc-logo.svg', 'gsc-logo-negativo.svg', 'gsc-logo-preto.svg', 'gsc-simbolo.svg', 'gsc-favicon.svg', 'gsc-favicon-32.png', 'gsc-apple-touch-icon.png']) {
    assert.ok(fs.existsSync(path.join(raiz, 'assets/marca', f)), f);
  }
  for (const arq of ['js/app.js', 'js/relatorio-view.js', 'js/admin.js']) assert.ok(!ler(arq).includes('icone.svg'), `${arq}: logo da Notus`);
});

test('descubra.html tem as metas para anúncio e a imagem og existe (1200×630)', () => {
  const html = ler('descubra.html');
  for (const p of ['og:title', 'og:description', 'og:image', 'og:url', 'og:type']) assert.match(html, new RegExp(`property="${p}" content="[^"]+"`));
  const png = fs.readFileSync(path.join(raiz, 'assets/og-mapa-disc.png'));
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
});

test('formatarPreco', () => {
  assert.equal(L.formatarPreco(0), 'R$ 0');
  assert.equal(L.formatarPreco(3900), 'R$ 39');
  assert.equal(L.formatarPreco(2990), 'R$ 29,90');
  assert.equal(L.formatarPreco(2905), 'R$ 29,05');
  assert.equal(L.formatarPreco(123400), 'R$ 1.234');
});

test('precoAtual respeita preço de lançamento e a data limite', () => {
  const agora = new Date(2026, 9, 10);
  assert.deepEqual(L.precoAtual({ precoCentavos: 3900, precoLancamentoCentavos: 2900, lancamentoAte: null }, agora), { valor: 2900, de: 3900 });
  assert.deepEqual(L.precoAtual({ precoCentavos: 3900, precoLancamentoCentavos: 2900, lancamentoAte: '2026-10-10' }, agora), { valor: 2900, de: 3900 });
  assert.deepEqual(L.precoAtual({ precoCentavos: 3900, precoLancamentoCentavos: 2900, lancamentoAte: '2026-10-09' }, agora), { valor: 3900, de: null });
  assert.deepEqual(L.precoAtual({ precoCentavos: 3900, precoLancamentoCentavos: null }, agora), { valor: 3900, de: null });
  assert.deepEqual(L.precoAtual({ precoCentavos: 3900, precoLancamentoCentavos: 4900 }, agora), { valor: 3900, de: null });
});

test('normalizarPacotes aceita snake/camel, ignora inativos e completa textos', () => {
  assert.equal(L.normalizarPacotes(null), null);
  assert.equal(L.normalizarPacotes({ ok: true, pacotes: [] }), null);
  const lista = L.normalizarPacotes({ ok: true, pacotes: [
    { chave: 'completo_plus', nome: 'Plus', preco_centavos: 7900, preco_lancamento_centavos: null, ordem: 3 },
    { chave: 'completo', nome: 'Completo', precoCentavos: 4500, precoLancamentoCentavos: 3500, ordem: 2, descricao: { itens: ['<b>x</b>'] } },
    { chave: 'gratis', preco_centavos: 0, ordem: 1 },
    { chave: 'velho', preco_centavos: 100, ativo: false },
    { chave: 'Inválida!', preco_centavos: 1 }
  ] });
  assert.deepEqual(lista.map((p) => p.chave), ['gratis', 'completo', 'completo_plus']);
  assert.equal(lista[0].nome, 'Resumo grátis');
  assert.equal(lista[1].precoLancamentoCentavos, 3500);
  assert.equal(lista[1].itensConfiaveis, false);
  // Texto vindo do servidor é escapado
  assert.ok(!L.htmlPacotes(lista, '').includes('<b>x</b>'));
  assert.ok(L.htmlPacotes(lista, '').includes('&lt;b&gt;x&lt;/b&gt;'));
});

test('hrefTeste e parâmetros de campanha', () => {
  assert.equal(L.hrefTeste(''), 'index.html?modo=pessoal');
  assert.equal(L.hrefTeste('completo'), 'index.html?modo=pessoal&pacote=completo');
  assert.equal(L.hrefTeste('gratis', '?utm_source=ig&x=1&fbclid=abc'), 'index.html?modo=pessoal&pacote=gratis&utm_source=ig&fbclid=abc');
  // Link do painel "Página de venda": ?pacote=…&cupom=… chega ao teste (pacote só se for válido; o do card clicado ganha)
  assert.equal(L.hrefTeste('', '?pacote=completo_plus&cupom=PRO050-7K'), 'index.html?modo=pessoal&pacote=completo_plus&cupom=PRO050-7K');
  assert.equal(L.hrefTeste('', '?cupom=PRO050-7K&pacote=COMPLETO'), 'index.html?modo=pessoal&pacote=completo&cupom=PRO050-7K');
  assert.equal(L.hrefTeste('completo', '?pacote=completo_plus&cupom=X1Y'), 'index.html?modo=pessoal&pacote=completo&cupom=X1Y');
  assert.equal(L.hrefTeste('', '?pacote=premium&cupom=X1Y'), 'index.html?modo=pessoal&cupom=X1Y', 'pacote inválido fica de fora');
  assert.equal(L.hrefTeste('', '?pacote=completo&pacote=completo_plus'), 'index.html?modo=pessoal&pacote=completo', 'um pacote só');
  assert.deepEqual(L.paramsCampanha('?pacote=gratis&utm_source=ig'), ['pacote=gratis', 'utm_source=ig']);
  assert.equal(L.pacoteDaBusca('?cupom=A&pacote=completo_plus'), 'completo_plus');
  assert.equal(L.pacoteDaBusca('?pacote=x'), '');
  // O card do pacote pedido na URL fica em destaque
  const html = L.htmlPacotes(L.PADRAO, '?pacote=completo_plus&cupom=X1Y');
  assert.match(html, /class="pacote pacote--destaque" data-pacote="completo_plus"/);
  assert.equal((html.match(/pacote--destaque/g) || []).length, 1);
  assert.match(html, /href="index\.html\?modo=pessoal&amp;pacote=completo_plus&amp;cupom=X1Y"/);
  assert.match(L.htmlPacotes(L.PADRAO, '?pacote=gratis'), /class="pacote pacote--destaque" data-pacote="completo"/, 'grátis não tira o destaque do completo');
  assert.equal(L.linkWhatsApp('', 'oi'), '');
  assert.equal(L.linkWhatsApp('+55 (11) 99999-8888', 'oi'), 'https://wa.me/5511999998888?text=oi');
});

test('pacotes padrão: os 3 do contrato, com o completo em destaque', () => {
  assert.deepEqual(L.PADRAO.map((p) => [p.chave, p.precoCentavos, p.precoLancamentoCentavos]), [['gratis', 0, null], ['completo', 3900, 2900], ['completo_plus', 6900, 4900]]);
  const html = L.htmlPacotes(L.PADRAO, '');
  assert.equal((html.match(/pacote--destaque/g) || []).length, 1);
  assert.match(html, /data-pacote="completo" [^>]*>|class="pacote pacote--destaque" data-pacote="completo"/);
});

test('cupomDaBusca: o link com desconto mostra o cupom desde a landing (normalizado como no teste)', () => {
  assert.equal(L.cupomDaBusca('?pacote=completo&cupom=previa100'), 'PREVIA100');
  assert.equal(L.cupomDaBusca('?cupom=%20lanca10%20'), 'LANCA10');
  assert.equal(L.cupomDaBusca('?cupom=<b>'), '');
  assert.equal(L.cupomDaBusca('?cupom=ab'), '');
  assert.equal(L.cupomDaBusca(''), '');
});

test('contatoSuporte: WhatsApp primeiro, depois e-mail; sem nenhum, nada é prometido', () => {
  assert.equal(L.contatoSuporte({ WHATSAPP_SUPORTE: '5511999998888', EMAIL_SUPORTE: 'oi@gsc.com.br' }).tipo, 'whatsapp');
  assert.match(L.contatoSuporte({ WHATSAPP_SUPORTE: '5511999998888' }).href, /^https:\/\/wa\.me\/5511999998888/);
  assert.deepEqual(L.contatoSuporte({ EMAIL_SUPORTE: 'oi@gsc.com.br' }), { href: 'mailto:oi@gsc.com.br', texto: 'oi@gsc.com.br', tipo: 'email' });
  assert.equal(L.contatoSuporte({ WHATSAPP_SUPORTE: '', EMAIL_SUPORTE: '' }), null);
  assert.equal(L.contatoSuporte({ EMAIL_SUPORTE: 'sem-arroba' }), null);
});

test('landing: faixa do cupom e textos de suporte existem e começam escondidos/neutros', () => {
  const html = ler('descubra.html');
  assert.equal((html.match(/data-cupom-ativo role="note" hidden/g) || []).length, 2);
  assert.match(html, /data-suporte-lead>Se a sua não estiver aqui, fale com a Gestão sem Caos pelo canal em que você nos conheceu\./);
  assert.doesNotMatch(html, /pelo canal de suporte\./, 'sem canal configurado, não promete um "canal de suporte" que não existe');
});

for (const pagina of ['termos.html', 'privacidade.html']) {
  test(pagina + ': sem "a preencher" visível quando falta a razão social; Voltar inteligente', () => {
    const html = ler(pagina);
    assert.match(html, /n\.textContent = legal \|\| 'Gestão sem Caos'/);
    assert.match(html, /data-voltar/);
    assert.match(html, /history\.back\(\)/);
  });
}
