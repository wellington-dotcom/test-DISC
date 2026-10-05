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
  const conf = Object.assign({ API_URL: '', WHATSAPP_RECRUTADOR: '', EMPRESA: '', MOSTRAR_RESULTADO_AO_CANDIDATO: false, GRUPOS_DEMONSTRACAO: 0 }, cfg);
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

// Ordem das letras na tela, de cima (posição 4) para baixo (posição 1).
async function ordemNaTela(page) {
  return page.locator('.cartoes .cartao').evaluateAll((els) => els.map((e) => e.getAttribute('data-letra')));
}

// Responde um grupo deixando as palavras na ordem dada (letras da posição 4 até a 1).
// Move pelo teclado (seta para cima no cartão); se a ordem inicial já for a pedida, toca em "Esta ordem está certa".
async function responderGrupo(page, ordem) {
  await expect(page.locator('.cartoes .cartao')).toHaveCount(4);
  let mexeu = false;
  for (let k = 0; k < ordem.length; k++) {
    const atual = await ordemNaTela(page);
    let j = atual.indexOf(ordem[k]);
    while (j > k) {
      await page.locator('.cartao[data-letra="' + ordem[k] + '"]').focus();
      await page.keyboard.press('ArrowUp');
      j--;
      mexeu = true;
    }
  }
  expect(await ordemNaTela(page)).toEqual(ordem);
  const confirmar = page.locator('[data-acao="confirmar-ordem"]');
  if (!mexeu && await confirmar.count()) await confirmar.click();
  await expect(page.locator('[data-acao="proximo"]')).toBeEnabled();
}

// dados: { nome, telefone, idade? (padrão '30'; '' deixa vazio), funcao?, empresa?, vaga?, consentimento? }
async function preencherIdentificacao(page, dados) {
  await page.fill('#nome', dados.nome);
  await page.fill('#telefone', '');
  await page.locator('#telefone').pressSequentially(dados.telefone);
  await page.fill('#idade', dados.idade === undefined ? '30' : String(dados.idade));
  if (dados.funcao) await page.fill('#funcao', dados.funcao);
  if (dados.empresa && await page.locator('#empresa').count()) await page.fill('#empresa', dados.empresa);
  if (dados.vaga && await page.locator('#vaga').count()) await page.fill('#vaga', dados.vaga);
  if (dados.consentimento !== false) await page.check('#consentimento');
}

// Etapa de confirmação (depois do último grupo): escolhe um retrato em cada rodada e dá nota às 4 frases.
// opcoes.escolher(par, rodada) -> letra (padrão: a primeira do par); opcoes.nota(item) -> 1..5 (padrão: 4).
// Termina na revisão.
async function responderConfirmacao(page, opcoes) {
  const op = opcoes || {};
  await expect(page.locator('.progresso-topo')).toContainText('Confirmação 1 de 2');
  const rodadas = page.locator('.rodada');
  await expect(rodadas).toHaveCount(3);
  for (let r = 0; r < 3; r++) {
    const letras = await rodadas.nth(r).locator('.retrato').evaluateAll((els) => els.map((e) => e.getAttribute('data-letra')));
    const letra = op.escolher ? op.escolher(letras, r) : letras[0];
    await rodadas.nth(r).locator('.retrato[data-letra="' + letra + '"]').click();
  }
  await page.locator('[data-acao="conf-proximo"]').click();
  await expect(page.locator('.progresso-topo')).toContainText('Confirmação 2 de 2');
  const itens = await page.evaluate(() => JSON.parse(localStorage.getItem('disc_progresso_v1')).validacao.montagem.itens);
  for (let k = 0; k < itens.length; k++) {
    const nota = op.nota ? op.nota(itens[k], k) : 4;
    await page.locator('.escala-opcao[data-item="' + k + '"][data-nota="' + nota + '"]').click();
  }
  await page.locator('[data-acao="conf-proximo"]').click();
  await expect(page.locator('h1')).toHaveText('Revise suas respostas');
}

// Faz o teste inteiro (25 grupos + confirmação) com a mesma ordem de preferência e chega à revisão.
// opcoes: { caminho (padrão '/index.html'), confirmacao (opções de responderConfirmacao) }
async function fazerTesteCompleto(page, dados, ordem, opcoes) {
  const op = opcoes || {};
  await page.goto(op.caminho || '/index.html');
  await page.locator('[data-acao="comecar"]').click();
  await preencherIdentificacao(page, dados);
  await page.locator('#form-identificacao button[type="submit"]').click();
  for (let i = 0; i < 25; i++) {
    await expect(page.locator('.progresso-topo')).toContainText('Grupo ' + (i + 1) + ' de 25');
    await responderGrupo(page, ordem);
    await page.locator('[data-acao="proximo"]').click();
  }
  await responderConfirmacao(page, op.confirmacao);
}

module.exports = { API_FALSA, coletarErros, configurar, simularApi, ordemNaTela, responderGrupo, preencherIdentificacao, responderConfirmacao, fazerTesteCompleto };
