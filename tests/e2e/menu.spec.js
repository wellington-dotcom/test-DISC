'use strict';
// Menu lateral do painel (prévia): grupos com título e ícone, item ativo, contador, usuário no pé,
// recolher (lembrado no localStorage) e gaveta em tela estreita.
const { test, expect } = require('@playwright/test');
const { coletarErros, configurar } = require('./util.js');

const PASTA = process.env.CAPTURAS_CONEXOES || '';

async function entrar(page, largura) {
  await configurar(page, { API_URL: 'simulada' });
  await page.setViewportSize({ width: largura || 1366, height: 900 });
  await page.goto('/admin.html');
  await page.fill('#campo-email', 'admin@previa.com');
  await page.fill('#campo-senha', 'previa123');
  await page.click('#btn-entrar');
  await expect(page.locator('#tela-painel')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#contagem')).not.toHaveText('Carregando…');
}

test('menu lateral: grupos, item ativo com marca laranja, contador, usuário embaixo e recolher lembrado', async ({ page }) => {
  const erros = coletarErros(page);
  await entrar(page);
  await expect(page.locator('#menu-lateral')).toBeVisible();
  await expect(page.locator('.topo')).toBeHidden();
  await expect(page.locator('.menu-grupo__titulo:visible')).toHaveText(['Seleção', 'Empresas', 'Vendas', 'Configurações']);
  await expect(page.locator('.menu-grupo[data-grupo="selecao"] .aba:visible .aba__texto')).toHaveText(['Participantes', 'Processos', 'Comparativo', 'Importar códigos']);
  await expect(page.locator('.menu-grupo[data-grupo="config"] .aba:visible .aba__texto')).toHaveText(['Usuários', 'Conexões']);
  await expect(page.locator('.menu-lateral__topo .menu-lateral__logo')).toHaveAttribute('src', 'assets/marca/gsc-logo.svg');
  await expect(page.locator('#aba-n-lista')).toHaveText(/^\d+$/);
  const ativo = page.locator('.aba[aria-current="page"]');
  await expect(ativo).toHaveAttribute('data-aba', 'lista');
  expect(await ativo.evaluate((n) => getComputedStyle(n, '::before').backgroundColor)).toBe('rgb(243, 68, 5)');
  // Conteúdo ao lado do menu, sem ficar por baixo dele.
  const menu = await page.locator('#menu-lateral').boundingBox();
  const vista = await page.locator('#vista-lista').boundingBox();
  expect(vista.x).toBeGreaterThanOrEqual(menu.x + menu.width);
  // Usuário no pé do menu: Minha foto, Trocar senha e Sair.
  await expect(page.locator('#menu-lateral #usuario-area')).toBeVisible();
  await page.click('#btn-usuario');
  await expect(page.locator('#menu-usuario')).toBeVisible();
  await expect(page.locator('#menu-usuario .usuario__item')).toHaveText(['Minha foto', 'Trocar senha', 'Sair']);
  await page.keyboard.press('Escape');
  await page.locator('.aba[data-aba="empresas"]').click();
  await expect(page.locator('.aba[aria-current="page"]')).toHaveAttribute('data-aba', 'empresas');
  await expect(page.locator('#vista-empresas')).toBeVisible();
  if (PASTA) await page.screenshot({ path: PASTA + '/menu-aberto.png' });

  // Recolher: só ícones; a escolha fica no localStorage e volta depois de recarregar.
  await page.click('#btn-recolher-menu');
  await expect(page.locator('body')).toHaveClass(/menu-recolhido/);
  await expect(page.locator('#btn-recolher-menu')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.aba[data-aba="empresas"] .aba__texto')).toBeHidden();
  await expect.poll(async () => (await page.locator('#menu-lateral').boundingBox()).width).toBeLessThan(90);
  expect(await page.evaluate(() => localStorage.getItem('disc_admin_menu_recolhido'))).toBe('1');
  if (PASTA) await page.screenshot({ path: PASTA + '/menu-recolhido.png' });
  await page.reload();
  await expect(page.locator('#tela-painel')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('body')).toHaveClass(/menu-recolhido/);
  await page.click('#btn-recolher-menu');
  await expect(page.locator('.aba[data-aba="empresas"] .aba__texto')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('disc_admin_menu_recolhido'))).toBe('0');
  expect(await page.locator('admin select, #menu-lateral select').count()).toBe(0);
  expect(await page.locator('#menu-lateral').innerText()).not.toMatch(/Notus/i);
  expect(erros).toEqual([]);
});

test('tela estreita (900px): o menu vira gaveta aberta pelo botão "Menu"; escolher um item fecha a gaveta', async ({ page }) => {
  const erros = coletarErros(page);
  await entrar(page, 900);
  await expect(page.locator('.topo')).toBeVisible();
  await expect(page.locator('#btn-menu')).toBeVisible();
  await expect(page.locator('.aba[data-aba="processos"]')).toBeHidden();
  await page.click('#btn-menu');
  await expect(page.locator('#btn-menu')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#menu-veu')).toBeVisible();
  await page.locator('.aba[data-aba="processos"]').click();
  await expect(page.locator('#vista-processos')).toBeVisible();
  await expect(page.locator('#menu-veu')).toBeHidden();
  await expect(page.locator('.aba[data-aba="processos"]')).toBeHidden();
  // Esc também fecha.
  await page.click('#btn-menu');
  await page.keyboard.press('Escape');
  await expect(page.locator('#btn-menu')).toHaveAttribute('aria-expanded', 'false');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(erros).toEqual([]);
});
