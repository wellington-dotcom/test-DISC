'use strict';
const { test, expect } = require('@playwright/test');
const { coletarErros, configurar } = require('./util.js');

// Nomes de processo, empresa, usuário, participante e textos do relatório com HTML: nada pode virar
// elemento nem rodar script — no painel (todas as abas, detalhe, editor e pré-visualização), na página
// pública do relatório e na tela do participante aberta pelo link.
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

test('XSS: nomes e textos com HTML aparecem como texto no painel, no relatório e no link do participante', async ({ page, context }) => {
  const erros = coletarErros(page);
  await configurar(page, { API_URL: 'simulada' });
  await page.goto('/admin.html');
  await entrar(page, 'admin@previa.com', 'previa123');

  const codigo = await page.evaluate(async (x) => {
    const api = window.DISC_API;
    const token = sessionStorage.getItem('disc_admin_token');
    const p = await api.processosSalvar(token, {
      nome: 'Vaga ' + x, empresa: 'Empresa ' + x, vaga: 'Cargo ' + x, cidade: 'Cidade ' + x,
      consultor: 'Consultor ' + x, contratante: 'Contratante ' + x, periodo: { inicio: '2026-09-01', fim: '2026-10-01' },
      clickupListId: '900000000002', mostrarResultado: true, ativa: true
    });
    if (!p.ok) throw new Error(p.erro);
    const u = await api.salvarUsuario(token, { nome: 'Admin ' + x, email: 'xss@teste.com', papel: 'admin', ativo: true }, 'senha-xss-1');
    if (!u.ok) throw new Error(u.erro);
    await api.enviar({
      v: 1, id: 'xss-e2e-000001', nome: 'Ana ' + x, telefone: '11988887777', idade: 30, vaga: x, funcao: x, empresa: x,
      consentimento: true, inicio: '2026-10-01T12:00:00.000Z', fim: '2026-10-01T12:09:00.000Z', duracaoSeg: 540,
      respostas: '4321'.repeat(25), avaliacao: p.processo.codigo
    });
    return p.processo.codigo;
  }, XSS);

  await page.reload();
  await expect(page.locator('#tela-painel')).toBeVisible({ timeout: 15000 });
  // Uma linha por pessoa (o seed da prévia muda com o tempo): basta a linha da participante com o nome malicioso.
  await expect(page.locator('#lista-candidatos > li').filter({ hasText: 'Ana ' + XSS })).toHaveCount(1);
  for (const aba of ['lista', 'processos', 'usuarios', 'comparativo', 'importar']) {
    await page.locator('.aba[data-aba="' + aba + '"]').click();
    await page.waitForTimeout(150);
    await semInjecao(page);
  }
  await page.locator('.aba[data-aba="usuarios"]').click();
  await expect(page.locator('#lista-usuarios')).toContainText('Admin <img src=x');
  await page.locator('.aba[data-aba="lista"]').click();
  await page.locator('#lista-candidatos > li', { hasText: 'Ana <img' }).getByRole('button', { name: /Ver detalhes/ }).click();
  await expect(page.locator('#vista-detalhe')).toContainText('Vaga <img src=x');
  await semInjecao(page);

  // Processo com HTML no nome: página do processo, rascunho, texto editado com HTML e publicação
  await page.locator('.aba[data-aba="processos"]').click();
  const card = page.locator('.proc-card', { hasText: 'Vaga <img src=x' }).first();
  await expect(card).toBeVisible();
  await semInjecao(page);
  await card.locator('[data-acao="abrir"]').click();
  await expect(page.locator('#vista-processos')).toContainText('Contratante <img src=x');
  await semInjecao(page);
  await page.click('#btn-gerar-rascunho');
  await expect(page.locator('#vista-processos h2')).toHaveText('Rascunho do relatório');
  const primeiro = page.locator('#editor-textos textarea').first();
  await primeiro.fill('Texto ' + XSS + ' <script>window.__xss=2</script>');
  await page.click('#btn-salvar-rascunho');
  await expect(page.locator('#aviso-geral')).toHaveText('Rascunho salvo.');
  await semInjecao(page);
  await page.click('#btn-ver-previa');
  const previa = page.frameLocator('#editor-previa');
  await expect(previa.locator('body')).toContainText('Texto <img src=x');
  expect(await previa.locator('img[src="x"], script').count()).toBe(0);
  await page.click('#btn-ver-textos');
  await page.click('#btn-publicar');
  const link = (await page.locator('#rel-link').innerText()).trim();
  await semInjecao(page);

  const pub = await context.newPage();
  const errosPub = coletarErros(pub);
  await configurar(pub, { API_URL: 'simulada' });
  await pub.goto(link);
  await expect(pub.locator('#relatorio')).toHaveAttribute('data-estado', 'pronto');
  await expect(pub.locator('#relatorio')).toContainText('Texto <img src=x');
  await expect(pub.locator('#relatorio')).toContainText('Empresa <img src=x');
  expect(await pub.evaluate(() => window.__xss)).toBeUndefined();
  expect(await pub.locator('#relatorio img[src="x"], #relatorio script').count()).toBe(0);
  expect(errosPub).toEqual([]);
  await pub.close();

  // O outro admin (nome com HTML) entra e vê tudo como texto
  await page.click('#btn-usuario');
  await page.click('#btn-sair');
  await entrar(page, 'xss@teste.com', 'senha-xss-1');
  await semInjecao(page);

  // Participante pelo link: empresa e processo com HTML no consentimento e no cabeçalho
  await page.goto('/index.html#a-' + codigo);
  await expect(page.locator('body')).toContainText('Empresa <img src=x', { timeout: 10000 });
  await semInjecao(page);
  expect(erros.filter((e) => !/Blocked script execution in 'about:srcdoc'/.test(e))).toEqual([]);
});
