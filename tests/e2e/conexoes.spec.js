'use strict';
// Aba Conexões do painel (prévia com a API simulada): aparece só para o admin, "Testar tudo", estados dos cartões,
// link de teste da InfinitePay, verificação e nenhum valor de segredo na tela.
const { test, expect } = require('@playwright/test');
const { coletarErros, configurar } = require('./util.js');

const PASTA = process.env.CAPTURAS_CONEXOES || '';

async function entrar(page) {
  await configurar(page, { API_URL: 'simulada' });
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto('/admin.html');
  await page.fill('#campo-email', 'admin@previa.com');
  await page.fill('#campo-senha', 'previa123');
  await page.click('#btn-entrar');
  await expect(page.locator('#tela-painel')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#contagem')).not.toHaveText('Carregando…');
}

const status = (page, id) => page.locator('#cx-' + id).getAttribute('data-status');

test.describe('Aba Conexões (prévia)', () => {
  test('aba é a última, testa tudo ao abrir, mostra estados, gera o link de teste e não mostra segredos', async ({ page }) => {
    const erros = coletarErros(page);
    await entrar(page);
    const abas = await page.locator('.aba:visible').evaluateAll((els) => els.map((e) => e.getAttribute('data-aba')));
    expect(abas[abas.length - 1]).toBe('conexoes');

    await page.locator('.aba[data-aba="conexoes"]').click();
    await expect(page.locator('#vista-conexoes h2')).toHaveText('Conexões');
    await expect(page.locator('#vista-conexoes .cx-cartao')).toHaveCount(10);
    await expect(page.locator('#btn-cx-testar-tudo')).toHaveText('Testar tudo', { timeout: 10000 });
    await expect(page.locator('.cx-cartao[data-status="testando"]')).toHaveCount(0);

    expect(await status(page, 'site')).toBe('ok');
    expect(await status(page, 'banco')).toBe('ok');
    expect(await status(page, 'login')).toBe('ok');
    expect(await status(page, 'funcoes')).toBe('ok');
    expect(await status(page, 'infinitepay')).toBe('ok');
    expect(await status(page, 'asaas')).toBe('nao_configurado');
    expect(await status(page, 'clickup')).toBe('ok');
    expect(await status(page, 'ia')).toBe('nao_configurado');
    expect(await status(page, 'despertador')).toBe('manual');
    await expect(page.locator('#cx-asaas .cx-pilula')).toHaveText('Não configurado');
    await expect(page.locator('#cx-clickup .cx-pilula')).toHaveText('Funcionando');
    await expect(page.locator('#cx-clickup')).toContainText('Conectado ao ClickUp como Prévia.');
    await expect(page.locator('#cx-banco')).toContainText('Respostas:');
    await expect(page.locator('#cx-infinitepay')).toContainText('existe (ge***)');
    await expect(page.locator('#cx-login')).toContainText('Cadastro livre: fechado');
    await expect(page.locator('#cx-funcoes')).toContainText('asaas-webhook — NÃO publicada (só precisa se usar o Asaas)');
    // "Como resolver" com os passos (Asaas não configurado).
    await page.locator('#cx-asaas summary').click();
    await expect(page.locator('#cx-asaas .cx-resolver__passos li').first()).toBeVisible();
    await expect(page.locator('#cx-asaas .cx-resolver__passos')).toContainText('Edge Functions → Secrets');
    if (PASTA) await page.screenshot({ path: PASTA + '/conexoes-prévia.png', fullPage: false });

    // Link de teste da InfinitePay e verificação.
    await page.locator('#cx-infinitepay [data-acao="link"]').click();
    await expect(page.locator('#cx-link-abrir')).toHaveAttribute('href', /^https:\/\/checkout\.infinitepay\.io\//);
    await expect(page.locator('#cx-link-abrir')).toHaveAttribute('target', '_blank');
    await expect(page.locator('#cx-infinitepay')).toContainText('Nada é cobrado se ninguém pagar');
    await page.locator('#cx-infinitepay [data-acao="verificar"]').click();
    await expect(page.locator('#cx-infinitepay')).toContainText('ainda não foi pago');
    // E-mail de teste.
    await page.locator('#cx-email [data-acao="email"]').click();
    await expect(page.locator('#cx-email')).toHaveAttribute('data-status', 'ok');
    await expect(page.locator('#cx-email')).toContainText('admin@previa.com');
    if (PASTA) {
      await page.locator('#cx-infinitepay').scrollIntoViewIfNeeded();
      await page.screenshot({ path: PASTA + '/conexoes-link-teste.png', fullPage: false });
    }

    // Testar um cartão só.
    await page.locator('#cx-banco [data-acao="testar"]').click();
    await expect(page.locator('#cx-banco')).toHaveAttribute('data-status', 'ok');

    const texto = await page.locator('#vista-conexoes').innerText();
    expect(texto).not.toMatch(/sk-ant-[A-Za-z0-9]{4}|pk_[A-Za-z0-9]{4}|re_[A-Za-z0-9]{6}|\$aact_|sb_secret/);
    expect(texto).not.toMatch(/Notus/i);
    expect(await page.locator('#vista-conexoes select').count()).toBe(0);
    expect(erros).toEqual([]);
  });

  test('função admin antiga: cartão Funções pede para publicar de novo; erros de teste viram mensagem no cartão', async ({ page }) => {
    const erros = coletarErros(page);
    await entrar(page);
    await page.evaluate(() => {
      const api = window.DISC_API;
      const original = api.diagnosticoConexoes;
      api.diagnosticoConexoes = function (token) {
        return original.call(api, token).then((d) => Object.assign({}, d, { servidor: null, servidorEstado: 'desatualizada', servidorErro: 'A função admin está desatualizada: publique de novo.' }));
      };
      api.testarConexao = function (token, alvo) {
        if (alvo === 'banco') return Promise.reject(new Error('Não foi possível conectar ao servidor.'));
        return Promise.resolve({ ok: true, alvo, sucesso: false, mensagem: 'A função admin está desatualizada: publique de novo.', em: new Date().toISOString() });
      };
    });
    await page.locator('.aba[data-aba="conexoes"]').click();
    await expect(page.locator('#btn-cx-testar-tudo')).toHaveText('Testar tudo', { timeout: 10000 });
    await expect(page.locator('#cx-funcoes')).toHaveAttribute('data-status', 'erro');
    await expect(page.locator('#cx-funcoes .cx-cartao__erro')).toHaveText('A função admin está desatualizada: publique de novo.');
    await expect(page.locator('#cx-funcoes .cx-resolver')).toHaveAttribute('open', '');
    await expect(page.locator('#cx-funcoes .cx-resolver__passos')).toContainText('dist/funcoes/admin/index.ts');
    await expect(page.locator('#cx-banco')).toHaveAttribute('data-status', 'erro');
    await expect(page.locator('#cx-banco')).toContainText('Não foi possível conectar ao servidor.');
    await expect(page.locator('#cx-asaas')).toHaveAttribute('data-status', 'erro');
    expect(erros).toEqual([]);
  });
});
