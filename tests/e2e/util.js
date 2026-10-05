'use strict';
// Utilitários compartilhados pelos testes E2E.
const { expect } = require('@playwright/test');

const API_FALSA = 'https://script.google.com/macros/s/TESTE-E2E/exec';

// Registra erros de console e exceções da página; use expect(erros).toEqual([]) no fim.
function coletarErros(page) {
  const erros = [];
  page.on('console', (msg) => { if (msg.type() === 'error') erros.push('console: ' + msg.text()); });
  page.on('pageerror', (err) => erros.push('pageerror: ' + err.message));
  return erros;
}

// Substitui js/config.js por uma versão com API_URL e outros campos.
async function configurar(page, cfg) {
  const conf = Object.assign({ API_URL: '', WHATSAPP_RECRUTADOR: '', EMPRESA: '', MOSTRAR_RESULTADO_AO_CANDIDATO: false }, cfg);
  await page.route('**/js/config.js', (route) => route.fulfill({
    status: 200,
    contentType: 'text/javascript; charset=utf-8',
    body: 'window.CONFIG = ' + JSON.stringify(conf) + ';'
  }));
}

// Simula o Web App do Apps Script. handler(corpo) -> objeto de resposta.
async function simularApi(page, handler) {
  const chamadas = [];
  await page.route(API_FALSA + '**', async (route) => {
    const req = route.request();
    if (req.method() !== 'POST') {
      await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '{"ok":true}' });
      return;
    }
    const corpo = JSON.parse(req.postData() || '{}');
    chamadas.push({ corpo, headers: req.headers() });
    const resp = await handler(corpo);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(resp)
    });
  });
  return chamadas;
}

// Responde um grupo tocando as letras na ordem dada (a última recebe 1 automaticamente).
async function responderGrupo(page, ordem) {
  for (const letra of ordem.slice(0, 3)) {
    await page.locator('.palavra[data-letra="' + letra + '"]').click();
  }
  await expect(page.locator('.palavra.escolhida')).toHaveCount(4);
}

async function preencherIdentificacao(page, dados) {
  await page.fill('#nome', dados.nome);
  await page.fill('#telefone', '');
  await page.locator('#telefone').pressSequentially(dados.telefone);
  if (dados.vaga) await page.fill('#vaga', dados.vaga);
  if (dados.consentimento !== false) await page.check('#consentimento');
}

// Faz o teste inteiro (25 grupos) com a mesma ordem de preferência e chega à revisão.
async function fazerTesteCompleto(page, dados, ordem) {
  await page.goto('/index.html');
  await page.locator('[data-acao="comecar"]').click();
  await preencherIdentificacao(page, dados);
  await page.locator('#form-identificacao button[type="submit"]').click();
  for (let i = 0; i < 25; i++) {
    await expect(page.locator('.progresso-topo')).toContainText('Grupo ' + (i + 1) + ' de 25');
    await responderGrupo(page, ordem);
    await page.locator('[data-acao="proximo"]').click();
  }
  await expect(page.locator('h1')).toHaveText('Revise suas respostas');
}

module.exports = { API_FALSA, coletarErros, configurar, simularApi, responderGrupo, preencherIdentificacao, fazerTesteCompleto };
