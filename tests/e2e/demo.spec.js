// Modo demonstração (?demo=1): dados fictícios pré-preenchidos, 3 grupos, API simulada (nada vai ao servidor).
const { test, expect } = require('@playwright/test');

test('demonstração: da landing ao teste pessoal com dados fictícios e sem chamar o servidor', async ({ page }) => {
  const chamadas = [];
  page.on('request', (r) => { if (/\/rest\/v1\/|\/functions\/v1\//.test(r.url())) chamadas.push(r.url()); });
  await page.goto('/descubra.html?demo=1');
  await expect(page.locator('#faixa-demo')).toBeVisible();
  await expect(page.locator('a[data-cta="heroi"]')).toHaveAttribute('href', /demo=1/);
  await page.locator('a[data-cta="heroi"]').click();
  await expect(page).toHaveURL(/modo=pessoal/);
  const comecar = page.locator('[data-acao="comecar"]');
  await expect(comecar.or(page.locator('#nome')).first()).toBeVisible();
  if (await comecar.isVisible()) await comecar.click();
  await expect(page.locator('#nome')).toHaveValue(/Demonstração/);
  await expect(page.locator('#email')).toHaveValue(/@exemplo\.com$/);
  await expect(page.locator('#consentimento')).toBeChecked();
  await page.locator('form button[type=submit]').click();
  await expect(page.locator('#faixa-demo')).toBeVisible();
  expect(chamadas).toEqual([]);
});

test('demonstração: ?demo=0 sai do modo e a faixa some', async ({ page }) => {
  await page.goto('/index.html?modo=pessoal&demo=1');
  await expect(page.locator('#faixa-demo')).toBeVisible();
  await page.goto('/index.html?modo=pessoal&demo=0');
  await expect(page.locator('#faixa-demo')).toHaveCount(0);
});
