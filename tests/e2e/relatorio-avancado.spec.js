'use strict';
// Relatório Completo Avançado (meu-relatorio.html, pacotes completo e completo_plus): capa, sumário com 20+ capítulos,
// radar das tendências, celular 375 px sem rolagem lateral, impressão sem botões, caixinhas do plano guardadas no aparelho.
// A API simulada responde relatorioPessoal com um resultado fixo de uma combinação que tem conteúdo em
// js/disc-profundo-dados.js (escolhida na hora, para o teste valer com qualquer conjunto de JSONs).
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { coletarErros, configurar } = require('./util.js');

const PRINTS = process.env.PRINTS_DIR || '';
const TOKEN = 'tokenDeTesteAvancado0123456789';

// Resultado DISC que cai na combinação pedida (regra de DISC_COMBINACOES.codigo).
function resultadoPara(cod) {
  const L = ['D', 'I', 'S', 'C'];
  const p = { D: 20, I: 20, S: 20, C: 20 };
  if (cod.length === 1) {
    p[cod] = 40;
    return { percentuais: p, codigo: cod + L.filter((l) => l !== cod)[0] };
  }
  const outros = L.filter((l) => l !== cod[0] && l !== cod[1]);
  p[cod[0]] = 30; p[cod[1]] = 28; p[outros[0]] = 21; p[outros[1]] = 21;
  return { percentuais: p, codigo: cod };
}

const DADOS = require('../../js/disc-profundo-dados.js');
const CODIGO = Object.keys(DADOS)[0];

async function abrir(page, pacote, exigido) {
  await configurar(page, { API_URL: 'simulada' });
  const resp = { ok: true, nome: 'Ana Avançada Teste', resultado: resultadoPara(CODIGO), exigido: exigido || null, pacote, pacoteNome: '', precisaParte2: false, status: 'pago' };
  await page.addInitScript((r) => {
    document.addEventListener('DOMContentLoaded', () => {
      if (window.DISC_API) window.DISC_API.relatorioPessoal = () => Promise.resolve(r);
    });
  }, resp);
  await page.goto('/meu-relatorio.html#t-' + TOKEN);
  await expect(page.locator('.relatorio-avancado')).toBeVisible();
}

async function semRolagemLateral(page) {
  const larg = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(larg[0]).toBeLessThanOrEqual(larg[1]);
}

test.describe('Relatório Completo Avançado', () => {
  test.skip(!CODIGO, 'sem conteúdo em js/disc-profundo-dados.js');

  test('celular 375 px: capa, sumário com 20 capítulos, radar, manual, plano com caixinhas e sem rolagem lateral', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 740 });
    const erros = coletarErros(page);
    await abrir(page, 'completo');
    const rel = page.locator('.relatorio-avancado');
    await expect(rel.locator('.av-capa h1')).toHaveText('Mapa DISC de Ana');
    await expect(rel.locator('.av-capa .logo-gsc')).toHaveAttribute('src', /gsc-logo-negativo\.svg$/);
    await expect(rel.locator('.rel-combinacao-nome')).not.toBeEmpty();
    const links = rel.locator('.av-sumario-link');
    expect(await links.count()).toBeGreaterThanOrEqual(20);
    await expect(rel.locator('.av-cap[data-secao]')).toHaveCount(await links.count());
    // Os capítulos existentes continuam com os seletores de antes
    await expect(rel.locator('.rel-travas h2')).toHaveText('O que está te travando');
    expect(await rel.locator('.rel-travas .trava').count()).toBeGreaterThanOrEqual(2);
    await expect(rel.locator('[data-secao="intensidade"] .rel-fator')).toHaveCount(4);
    await expect(rel.locator('[data-secao="plano"]')).toBeVisible();
    await expect(rel.locator('[data-secao="mapa"] .mapa-ponto')).toHaveCount(1);
    await expect(rel.locator('[data-secao="esticando"], [data-secao="plano90"]')).toHaveCount(0);
    // Radar SVG + lista das 16 tendências
    await expect(rel.locator('.av-radar svg[role="img"]')).toBeVisible();
    await expect(rel.locator('.av-tend-item')).toHaveCount(16);
    // Manual de como falar comigo (4 colunas), você e cada perfil (4), pressão em 3 etapas
    await expect(rel.locator('.av-manual-col')).toHaveCount(4);
    await expect(rel.locator('.av-perfil')).toHaveCount(4);
    await expect(rel.locator('.av-etapa')).toHaveCount(3);
    await expect(page.locator('body')).not.toContainText('Notus');
    await expect(page.locator('body')).not.toContainText(/competência(s)? comportamenta/i);
    await semRolagemLateral(page);
    // Sumário: vai ao capítulo sem trocar o hash (o hash é o token)
    await rel.locator('.av-sumario-link[data-alvo="cap-plano"]').click();
    await expect(page).toHaveURL(new RegExp('#t-' + TOKEN + '$'));
    await expect(rel.locator('#cap-plano h2')).toBeFocused();
    // Caixinhas do plano: ficam marcadas depois de recarregar (localStorage)
    const caixa = rel.locator('input[data-plano="d30-0"]');
    await caixa.check();
    await page.reload();
    await expect(page.locator('input[data-plano="d30-0"]')).toBeChecked();
    if (PRINTS) {
      fs.mkdirSync(PRINTS, { recursive: true });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: path.join(PRINTS, 'avancado-375-inicio.png') });
      await page.locator('#cap-tendencias').screenshot({ path: path.join(PRINTS, 'avancado-375-tendencias.png') });
      await page.locator('#cap-comunicacao').screenshot({ path: path.join(PRINTS, 'avancado-375-comunicacao.png') });
      await page.screenshot({ path: path.join(PRINTS, 'avancado-375-pagina.png'), fullPage: true });
    }
    expect(erros).toEqual([]);
  });

  test('computador + Parte 2: esticando, mapa com 2 pontos, plano de 90 dias; impressão sem botões', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const erros = coletarErros(page);
    await abrir(page, 'completo_plus', { percentuais: { D: 18, I: 20, S: 32, C: 30 }, codigo: 'SC' });
    const rel = page.locator('.relatorio-avancado');
    expect(await rel.locator('.av-sumario-link').count()).toBeGreaterThanOrEqual(21);
    await expect(rel.locator('[data-secao="esticando"]')).toBeVisible();
    await expect(rel.locator('[data-secao="mapa"] .mapa-ponto')).toHaveCount(2);
    await expect(rel.locator('[data-secao="plano90"] h2')).toHaveText('Seu plano de 90 dias no trabalho');
    await semRolagemLateral(page);
    if (PRINTS) {
      await page.screenshot({ path: path.join(PRINTS, 'avancado-1280-inicio.png') });
      await page.locator('#cap-tendencias').screenshot({ path: path.join(PRINTS, 'avancado-1280-tendencias.png') });
      await page.locator('#cap-comunicacao').screenshot({ path: path.join(PRINTS, 'avancado-1280-comunicacao.png') });
      await page.locator('#cap-relacoes').screenshot({ path: path.join(PRINTS, 'avancado-1280-relacoes.png') });
      await page.locator('#cap-plano').screenshot({ path: path.join(PRINTS, 'avancado-1280-plano.png') });
    }
    await page.emulateMedia({ media: 'print' });
    for (const sel of ['[data-acao="imprimir"]', '.av-voltar', '.meu-link', '.topo']) {
      const n = await page.locator(sel).count();
      for (let k = 0; k < n; k++) await expect(page.locator(sel).nth(k)).toBeHidden();
    }
    await expect(rel.locator('.av-capa')).toBeVisible();
    const quebra = await rel.locator('#cap-dia_a_dia').evaluate((e) => getComputedStyle(e).breakBefore);
    expect(quebra).toBe('page');
    if (PRINTS) {
      const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
      fs.writeFileSync(path.join(PRINTS, 'avancado-a4.pdf'), pdf);
    }
    expect(erros).toEqual([]);
  });
});
