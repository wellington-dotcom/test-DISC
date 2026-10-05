'use strict';
// Página pública do relatório (relatorio.html?r=TOKEN / #r-TOKEN). Servidor sempre simulado (page.route).
const { test, expect } = require('@playwright/test');
const { API_FALSA, coletarErros, configurar, simularApi } = require('./util');
const MOTOR = require('../../js/relatorio-motor.js');
const PROCESSO = require('../fixtures/processo-exemplo.json');

const TOKEN = 'tokenE2E_' + 'x'.repeat(32);
const RELATORIO = MOTOR.montar(JSON.parse(JSON.stringify(PROCESSO)), { geradoEm: '2026-10-02T15:00:00.000Z' });

async function preparar(page) {
  await configurar(page, { API_URL: API_FALSA });
  return simularApi(page, (corpo) => {
    if (corpo.acao === 'relatorioPublico' && corpo.token === TOKEN) return { ok: true, relatorio: RELATORIO };
    return { ok: false, erro: 'Relatório não encontrado.' };
  });
}

async function semRolagemLateral(page) {
  const [largura, janela] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(largura).toBeLessThanOrEqual(janela);
}

const SECOES = ['capa', 'indice', 'sumario', 'atracao', 'tecnica', 'disc', 'ranking', 'encerramento', 'rodape'];

for (const [nome, viewport] of [['celular 375', { width: 375, height: 812 }], ['computador', { width: 1280, height: 900 }]]) {
  test('relatório abre pelo #r-TOKEN e mostra todas as seções (' + nome + ')', async ({ page }) => {
    const erros = coletarErros(page);
    await page.setViewportSize(viewport);
    const chamadas = await preparar(page);
    await page.goto('/relatorio.html#r-' + TOKEN);
    await expect(page.locator('#relatorio')).toHaveAttribute('data-estado', 'pronto');
    for (const id of SECOES) await expect(page.locator('[data-secao="' + id + '"]')).toHaveCount(1);
    await expect(page.locator('.capa__titulo')).toBeVisible();
    await expect(page.locator('.rec__nome')).toContainText(RELATORIO.sumario.recomendacao.nome);
    await expect(page.locator('.analise__item')).toHaveCount(RELATORIO.ranking.linhas.length);
    await expect(page.locator('.quadro-disc__item')).toHaveCount(RELATORIO.disc.quadro.length);
    await expect(page.locator('.rodape-doc')).toContainText('Notus Agência');
    await expect(page.locator('.rodape-doc')).toContainText(RELATORIO.processo.consultor);
    await expect(page).toHaveTitle(/Relatório/);
    expect(chamadas.map((c) => c.corpo.acao)).toEqual(['relatorioPublico']);
    await page.evaluate(() => document.fonts.ready);
    await semRolagemLateral(page);
    // nada de dado sensível na página
    const texto = await page.locator('body').innerText();
    for (const proibido of ['Estado civil', 'Gênero', 'Filhos', 'WhatsApp', '@']) expect(texto).not.toContain(proibido);
    expect(erros).toEqual([]);
  });
}

test('relatório abre também por ?r=TOKEN e imprime sem rolagem lateral', async ({ page }) => {
  await preparar(page);
  await page.goto('/relatorio.html?r=' + TOKEN);
  await expect(page.locator('#relatorio')).toHaveAttribute('data-estado', 'pronto');
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('[data-secao="ranking"] .tabela-mestre')).toBeVisible();
  await semRolagemLateral(page);
});

test('token inválido ou ausente mostra "Relatório não encontrado ou fora do ar."', async ({ page }) => {
  const erros = coletarErros(page);
  const chamadas = await preparar(page);
  await page.goto('/relatorio.html#r-' + 'y'.repeat(40));
  await expect(page.locator('.doc-erro')).toContainText('Relatório não encontrado ou fora do ar.');
  await expect(page.locator('[data-secao="capa"]')).toHaveCount(0);
  await page.goto('/relatorio.html');
  await expect(page.locator('.doc-erro')).toContainText('Relatório não encontrado ou fora do ar.');
  await page.goto('/relatorio.html?r=%3Cscript%3E');
  await expect(page.locator('.doc-erro')).toContainText('Relatório não encontrado ou fora do ar.');
  expect(chamadas.length).toBe(1); // só o token com formato válido chega ao servidor
  expect(erros).toEqual([]);
});

test('texto malicioso no relatório não executa (XSS)', async ({ page }) => {
  const ataque = '<img src=x onerror="window.__xss=1">';
  const rel = JSON.parse(JSON.stringify(RELATORIO));
  rel.processo.empresa = ataque;
  rel.sumario.recomendacao.nome = ataque;
  rel.textos[rel.encerramento.textoId].texto = ataque;
  await configurar(page, { API_URL: API_FALSA });
  await simularApi(page, () => ({ ok: true, relatorio: rel }));
  await page.goto('/relatorio.html#r-' + TOKEN);
  await expect(page.locator('#relatorio')).toHaveAttribute('data-estado', 'pronto');
  await expect(page.locator('.rec__nome')).toContainText('<img src=x');
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  expect(await page.locator('#relatorio img[src="x"]').count()).toBe(0);
});
