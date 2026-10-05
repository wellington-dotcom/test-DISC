'use strict';
const { test, expect } = require('@playwright/test');
const { coletarErros, configurar } = require('./util.js');

// Nomes de empresa, avaliação, usuário e participante com HTML: nada pode virar elemento nem rodar script,
// nem no painel (todas as abas e o detalhe) nem na tela do participante aberta pelo link.
const XSS = '<img src=x onerror="window.__xss=1"> Teste';

async function entrar(page, email, senha) {
  await expect(page.locator('#form-login')).toBeVisible();
  await page.fill('#campo-email', email);
  await page.fill('#campo-senha', senha);
  await page.click('#btn-entrar');
  await expect(page.locator('#tela-painel')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#contagem')).not.toHaveText('Carregando…');
}

async function semInjecao(page) {
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  expect(await page.locator('img[src="x"]').count()).toBe(0);
}

test('XSS: nomes com HTML aparecem como texto no painel e no link do participante', async ({ page }) => {
  const erros = coletarErros(page);
  await configurar(page, { API_URL: 'simulada' });
  await page.goto('/admin.html');
  await entrar(page, 'admin@previa.com', 'previa123');

  const codigo = await page.evaluate(async (x) => {
    const api = window.DISC_API;
    const token = sessionStorage.getItem('disc_admin_token');
    const emp = await api.salvarEmpresa(token, { nome: 'Empresa ' + x });
    const av = await api.salvarAvaliacao(token, { empresaId: emp.empresa.id, nome: 'Vaga ' + x, tipo: 'selecao', mostrarResultado: true, ativa: true });
    await api.salvarUsuario(token, { nome: 'Gestor ' + x, email: 'xss@teste.com', papel: 'gestor', empresaId: emp.empresa.id, ativo: true }, 'senha-xss-1');
    await api.enviar({
      v: 1, id: 'xss-e2e-000001', nome: 'Ana ' + x, telefone: '11988887777', idade: 30, vaga: x, funcao: x, empresa: x,
      consentimento: true, inicio: '2026-10-01T12:00:00.000Z', fim: '2026-10-01T12:09:00.000Z', duracaoSeg: 540,
      respostas: '4321'.repeat(25), avaliacao: av.avaliacao.codigo
    });
    return av.avaliacao.codigo;
  }, XSS);

  await page.reload();
  await expect(page.locator('#tela-painel')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#lista-candidatos > li')).toHaveCount(5);
  for (const aba of ['lista', 'avaliacoes', 'empresas', 'usuarios', 'comparativo']) {
    await page.locator('.aba[data-aba="' + aba + '"]').click();
    await page.waitForTimeout(150);
    await semInjecao(page);
  }
  await expect(page.locator('#lista-usuarios')).toContainText('Gestor <img src=x');
  await page.locator('.aba[data-aba="lista"]').click();
  await page.locator('#lista-candidatos > li', { hasText: 'Ana <img' }).getByRole('button', { name: /Ver detalhes/ }).click();
  await expect(page.locator('#vista-detalhe')).toContainText('Vaga <img src=x');
  await semInjecao(page);

  // O gestor dessa empresa também vê tudo como texto
  await page.click('#btn-usuario');
  await page.click('#btn-sair');
  await entrar(page, 'xss@teste.com', 'senha-xss-1');
  await expect(page.locator('#lista-candidatos > li')).toHaveCount(1);
  await expect(page.locator('#usuario-empresa, #btn-usuario').first()).toBeVisible();
  await semInjecao(page);

  // Participante pelo link: empresa e avaliação com HTML no consentimento e no cabeçalho
  await page.goto('/index.html#a-' + codigo);
  await expect(page.locator('body')).toContainText('Empresa <img src=x', { timeout: 10000 });
  await semInjecao(page);
  expect(erros).toEqual([]);
});
