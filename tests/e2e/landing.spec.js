'use strict';
// Landing de venda (descubra.html) e páginas legais. Roda no projeto "desktop"; o celular é simulado por viewport.
// Para salvar capturas de página inteira: LANDING_CAPTURAS=/pasta npx playwright test tests/e2e/landing.spec.js
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { coletarErros } = require('./util');

const LARGURAS = [375, 1366];

async function semRolagemLateral(page) {
  const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(sw, 'rolagem lateral').toBeLessThanOrEqual(iw);
}

async function configComExtras(page, extras) {
  await page.route('**/js/config.js', (route) => route.fulfill({
    status: 200,
    contentType: 'text/javascript; charset=utf-8',
    body: 'window.CONFIG = ' + JSON.stringify(Object.assign({ BACKEND: 'appsscript', API_URL: '' }, extras)) + ';'
  }));
}

for (const largura of LARGURAS) {
  test(`landing ${largura}px: sem rolagem lateral, sem erros, CTAs e pacotes`, async ({ page }) => {
    await page.setViewportSize({ width: largura, height: largura < 640 ? 812 : 900 });
    const erros = coletarErros(page);
    await page.goto('/descubra.html');
    await expect(page.locator('h1')).toContainText('Descubra o que está');
    await expect(page.locator('h1')).toContainText('te travando');

    // CTAs principais
    const ctas = page.locator('a[data-cta]');
    expect(await ctas.count()).toBeGreaterThanOrEqual(3);
    for (const href of await ctas.evaluateAll((els) => els.map((a) => a.getAttribute('href')))) {
      expect(href).toBe('index.html?modo=pessoal');
    }
    await expect(page.locator('a[data-cta="heroi"]')).toHaveText(/Começar meu mapa grátis/);
    await expect(page.locator('a[data-cta="heroi"]')).toBeVisible();

    // Pacotes (valores padrão do contrato)
    const cards = page.locator('#pacotes-lista .pacote');
    await expect(cards).toHaveCount(3);
    expect(await cards.evaluateAll((els) => els.map((e) => e.dataset.pacote))).toEqual(['gratis', 'completo', 'completo_plus']);
    await expect(page.locator('.pacote--destaque')).toHaveAttribute('data-pacote', 'completo');
    for (const chave of ['gratis', 'completo', 'completo_plus']) {
      await expect(page.locator(`a[data-cta-pacote="${chave}"]`)).toHaveAttribute('href', `index.html?modo=pessoal&pacote=${chave}`);
    }
    await expect(page.locator('[data-pacote="completo"] .pacote__valor')).toContainText('R$ 29');
    await expect(page.locator('[data-pacote="completo"] s')).toHaveText('R$ 39');
    await expect(page.locator('[data-pacote="completo_plus"] .pacote__valor')).toContainText('R$ 49');
    await expect(page.locator('[data-pacote="completo_plus"] s')).toHaveText('R$ 69');
    await expect(page.locator('[data-pacote="gratis"] .pacote__valor')).toContainText('R$ 0');

    // Seções obrigatórias
    for (const id of ['como-funciona', 'o-que-recebe', 'fatores', 'pacotes', 'garantia', 'perguntas', 'empresas']) {
      await expect(page.locator('#' + id)).toHaveCount(1);
    }
    await expect(page.locator('#garantia')).toContainText('7 dias');
    await expect(page.locator('footer')).toContainText('Gestão sem Caos');
    await expect(page.locator('footer a[href="termos.html"]')).toHaveCount(1);
    await expect(page.locator('footer a[href="privacidade.html"]')).toHaveCount(1);
    await expect(page.locator('body')).not.toContainText('Notus');

    // Rola a página toda (barra fixa, imagens) e confere de novo
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 20)); }
    });
    await semRolagemLateral(page);
    if (largura < 900) {
      await page.evaluate(() => document.getElementById('o-que-recebe').scrollIntoView({ behavior: 'instant' }));
      await expect(page.locator('#cta-fixo')).toHaveClass(/cta-fixo--visivel/);
      await expect(page.locator('#cta-fixo a')).toHaveAttribute('href', 'index.html?modo=pessoal');
    }
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    if (process.env.LANDING_CAPTURAS) {
      await page.screenshot({ path: path.join(process.env.LANDING_CAPTURAS, `landing-${largura}.png`), fullPage: true });
    }
    expect(erros).toEqual([]);
  });
}

test('metas para anúncio (og/twitter) e imagem og acessível', async ({ page, request }) => {
  await page.goto('/descubra.html');
  for (const p of ['og:title', 'og:description', 'og:image', 'og:url', 'og:type', 'og:image:width', 'og:image:height']) {
    const v = await page.locator(`meta[property="${p}"]`).getAttribute('content');
    expect(v, p).toBeTruthy();
  }
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute('content', 'summary_large_image');
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /.{60,}/);
  await expect(page).toHaveTitle(/Mapa DISC/);
  const og = await request.get('/assets/og-mapa-disc.png');
  expect(og.status()).toBe(200);
  expect(og.headers()['content-type']).toContain('image/png');
});

test('pacotes vindos do DISC_API.pacotesPublicos substituem os padrão', async ({ page }) => {
  await page.addInitScript(() => {
    window.DISC_API = {
      pacotesPublicos: () => Promise.resolve({ ok: true, pacotes: [
        { chave: 'gratis', nome: 'Resumo grátis', preco_centavos: 0, ativo: true, ordem: 1 },
        { chave: 'completo', nome: 'Relatório completo', preco_centavos: 4500, preco_lancamento_centavos: null, ativo: true, ordem: 2 },
        { chave: 'completo_plus', nome: 'Completo + Parte 2', preco_centavos: 7900, preco_lancamento_centavos: 5990, lancamento_ate: '2999-12-31', ativo: true, ordem: 3 }
      ] })
    };
  });
  const erros = coletarErros(page);
  await page.goto('/descubra.html');
  await expect(page.locator('[data-pacote="completo"] .pacote__valor')).toContainText('R$ 45');
  await expect(page.locator('[data-pacote="completo"] s')).toHaveCount(0);
  await expect(page.locator('[data-pacote="completo_plus"] .pacote__valor')).toContainText('R$ 59,90');
  await expect(page.locator('[data-pacote="completo_plus"] s')).toHaveText('R$ 79');
  await expect(page.locator('a[data-cta-pacote="completo"]')).toHaveAttribute('href', 'index.html?modo=pessoal&pacote=completo');
  expect(erros).toEqual([]);
});

test('falha do servidor mantém os pacotes padrão', async ({ page }) => {
  await page.addInitScript(() => { window.DISC_API = { pacotesPublicos: () => Promise.reject(new Error('fora do ar')) }; });
  await page.goto('/descubra.html');
  await expect(page.locator('#pacotes-lista .pacote')).toHaveCount(3);
  await expect(page.locator('[data-pacote="completo"] .pacote__valor')).toContainText('R$ 29');
});

test('parâmetros de campanha seguem para o teste; CTA abre o teste', async ({ page }) => {
  await page.goto('/descubra.html?utm_source=instagram&utm_campaign=lanc&fbclid=xyz&outro=1');
  await expect(page.locator('a[data-cta="heroi"]')).toHaveAttribute('href', 'index.html?modo=pessoal&utm_source=instagram&utm_campaign=lanc&fbclid=xyz');
  await expect(page.locator('a[data-cta-pacote="completo"]')).toHaveAttribute('href', 'index.html?modo=pessoal&pacote=completo&utm_source=instagram&utm_campaign=lanc&fbclid=xyz');
  await page.goto('/descubra.html');
  await page.locator('a[data-cta="heroi"]').click();
  await expect(page).toHaveURL(/\/index\.html\?modo=pessoal$/);
});

test('Para empresas: WhatsApp de suporte quando configurado; nome legal no rodapé', async ({ page }) => {
  await configComExtras(page, { WHATSAPP_SUPORTE: '5511999998888', EMPRESA_LEGAL: 'Gestão sem Caos Ltda. · CNPJ 00.000.000/0001-00' });
  await page.goto('/descubra.html');
  const botao = page.locator('[data-contato-empresas]');
  await expect(botao).toBeVisible();
  await expect(botao).toHaveAttribute('href', /^https:\/\/wa\.me\/5511999998888\?text=/);
  await expect(page.locator('#empresa-legal')).toContainText('CNPJ 00.000.000/0001-00');
  await expect(page.locator('a[data-link-empresas]').first()).toHaveAttribute('href', '#empresas');
});

test('sem WhatsApp configurado o botão fica oculto', async ({ page }) => {
  await page.goto('/descubra.html');
  await expect(page.locator('[data-contato-empresas]')).toBeHidden();
  await expect(page.locator('[data-contato-empresas-nota]')).toBeVisible();
});

test('perguntas frequentes abrem e respondem as dúvidas principais', async ({ page }) => {
  await page.goto('/descubra.html');
  const faq = page.locator('.faq details');
  expect(await faq.count()).toBeGreaterThanOrEqual(6);
  const psico = page.locator('.faq summary', { hasText: 'teste psicológico' });
  await psico.click();
  await expect(page.locator('.faq details[open]')).toContainText('perfil comportamental');
  await expect(page.locator('.faq')).toContainText('10 minutos');
  await expect(page.locator('.faq')).toContainText('refazer');
});

for (const pagina of ['termos.html', 'privacidade.html']) {
  test(`${pagina}: carrega no celular sem rolagem lateral e marcado como rascunho`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const erros = coletarErros(page);
    await page.goto('/' + pagina);
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('.legal__rascunho')).toContainText('revisar com advogado');
    await expect(page.locator('body')).toContainText('Gestão sem Caos');
    await expect(page.locator('body')).not.toContainText('Notus');
    await semRolagemLateral(page);
    expect(erros).toEqual([]);
  });
}
