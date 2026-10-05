'use strict';
// Organograma corporativo (js/organograma.js) na página de teste tests/e2e/fixtures/organograma.html.
// 7 pessoas em 3 níveis (Ana > Bruno, Carla > Diego, Eduarda | Fábio, Gabriela) + 2 sem posição (Heitor, Isadora).
// ORG_CAPTURAS=<pasta> salva capturas de tela para revisão (org-*.png).
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { coletarErros } = require('./util');

const PAGINA = '/tests/e2e/fixtures/organograma.html';
const CAPTURAS = process.env.ORG_CAPTURAS || '';
const cartao = (page, id) => page.locator('.orgx-cartao[data-org-id="' + id + '"]');
const noDiagrama = (page, id) => page.locator('.orgx-quadro .orgx-cartao[data-org-id="' + id + '"]');
const naColuna = (page, id) => page.locator('.orgx-sem .orgx-cartao[data-org-id="' + id + '"]');

async function capturar(page, nome, testInfo) {
  await parado(page);
  const arquivo = CAPTURAS ? path.join(CAPTURAS, 'org-' + nome + '.png') : testInfo.outputPath('org-' + nome + '.png');
  await page.screenshot({ path: arquivo });
}

async function centro(loc) {
  const b = await loc.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

// Arrasta com o mouse (pointer events) de um elemento até outro.
async function arrastar(page, de, para, opcoes) {
  const a = await centro(de);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 12, a.y + 8, { steps: 3 });
  const b = await centro(para);
  await page.mouse.move(b.x, b.y, { steps: 12 });
  if (opcoes && opcoes.antesDeSoltar) await opcoes.antesDeSoltar();
  await page.mouse.up();
}

// Espera as animações (deslizar dos cartões) terminarem antes de medir posições.
async function parado(page) {
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => null))));
}

async function mudancas(page) { return page.evaluate(() => window.__mudancas); }

async function semRolagemLateral(page) {
  const [largura, janela] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(largura).toBeLessThanOrEqual(janela);
}

async function abrir(page, consulta, viewport) {
  await page.setViewportSize(viewport || { width: 1366, height: 800 });
  await page.goto(PAGINA + (consulta || ''));
  await expect(page.locator('.orgx-quadro .orgx-cartao')).not.toHaveCount(0);
}

test('desenha a árvore: cartões, linhas, coluna "Sem posição" e legenda', async ({ page }, testInfo) => {
  const erros = coletarErros(page);
  await abrir(page);
  await expect(page.locator('.orgx-quadro .orgx-cartao')).toHaveCount(7);
  await expect(page.locator('.orgx-linha')).toHaveCount(6);
  await expect(page.locator('.orgx-sem .orgx-cartao')).toHaveCount(2);
  await expect(page.locator('[data-org-sem-n]')).toHaveText('2');
  await expect(cartao(page, 'p1')).toContainText('Ana Ribeiro');
  await expect(cartao(page, 'p1')).toContainText('Diretora geral');
  await expect(cartao(page, 'p1').locator('.orgx-avatar img')).toHaveCount(1);
  await expect(cartao(page, 'p1').locator('.orgx-selo')).toHaveText('D');
  await expect(cartao(page, 'p7')).toContainText('Sem teste');
  await expect(page.locator('.orgx-legenda').first()).toContainText('Dominância');
  // Líder acima e centralizado sobre os liderados.
  const [ana, bruno, carla] = await Promise.all(['p1', 'p2', 'p3'].map((id) => noDiagrama(page, id).boundingBox()));
  expect(ana.y + ana.height).toBeLessThan(bruno.y);
  expect(Math.abs(ana.x + ana.width / 2 - (bruno.x + bruno.width / 2 + carla.x + carla.width / 2) / 2)).toBeLessThan(1.5);
  // Colegas (tracejado) só quando pedir.
  await expect(page.locator('.orgx-linhas__colegas')).toBeHidden();
  await page.getByRole('button', { name: 'Mostrar colegas' }).click();
  await expect(page.locator('.orgx-colega')).toHaveCount(2);
  await expect(page.locator('.orgx-linhas__colegas')).toBeVisible();
  await capturar(page, 'colegas', testInfo);
  await page.getByRole('button', { name: 'Esconder colegas' }).click();
  await expect(page.locator('.orgx-linhas__colegas')).toBeHidden();
  expect(erros).toEqual([]);
});

test('arrastar: da coluna para um cartão, entre cartões, para o Topo e de volta para a coluna', async ({ page }, testInfo) => {
  const erros = coletarErros(page);
  await abrir(page);

  // 1) Heitor (coluna) -> sobre Diego: passa a ser liderado por Diego.
  await arrastar(page, naColuna(page, 'p8'), noDiagrama(page, 'p4'), {
    antesDeSoltar: async () => {
      await expect(noDiagrama(page, 'p4')).toHaveClass(/orgx-alvo/);
      await expect(page.locator('.orgx-fantasma__dica')).toHaveText('Liderado(a) por Diego Martins');
      await capturar(page, 'arrastando', testInfo);
    }
  });
  await expect(noDiagrama(page, 'p8')).toHaveCount(1);
  await expect(naColuna(page, 'p8')).toHaveCount(0);
  await expect(page.locator('.orgx-fantasma')).toHaveCount(0);
  let m = await mudancas(page);
  expect(m).toHaveLength(1);
  expect(m[0].relacoes).toContainEqual({ de: 'p4', para: 'p8', tipo: 'lidera' });
  expect(m[0].mudanca).toMatchObject({ id: 'p8', para: { tipo: 'lider', id: 'p4' }, de: { tipo: 'sem' } });
  await parado(page);
  const [diego, heitor] = await Promise.all([noDiagrama(page, 'p4').boundingBox(), noDiagrama(page, 'p8').boundingBox()]);
  expect(heitor.y).toBeGreaterThan(diego.y + diego.height);

  // 2) Fábio (diagrama, sob Carla) -> sobre Bruno.
  await arrastar(page, noDiagrama(page, 'p6'), noDiagrama(page, 'p2'));
  m = await mudancas(page);
  expect(m).toHaveLength(2);
  expect(m[1].relacoes).toContainEqual({ de: 'p2', para: 'p6', tipo: 'lidera' });
  expect(m[1].relacoes).not.toContainEqual({ de: 'p3', para: 'p6', tipo: 'lidera' });
  expect(m[1].mudanca.de).toEqual({ tipo: 'lider', id: 'p3' });

  // 3) Eduarda -> Topo: sem líder, continua no organograma (topoIds).
  await arrastar(page, noDiagrama(page, 'p5'), page.locator('.orgx-topo'));
  m = await mudancas(page);
  expect(m).toHaveLength(3);
  expect(m[2].relacoes.filter((r) => r.tipo === 'lidera' && r.para === 'p5')).toEqual([]);
  expect(m[2].mudanca.topoIds).toEqual(['p1', 'p5']);
  await parado(page);
  const [ana, eduarda] = await Promise.all([noDiagrama(page, 'p1').boundingBox(), noDiagrama(page, 'p5').boundingBox()]);
  expect(Math.abs(eduarda.y - ana.y)).toBeLessThan(1);

  // 4) Diego -> coluna: sai do organograma; Heitor (liderado dele) continua, agora no Topo.
  await arrastar(page, noDiagrama(page, 'p4'), page.locator('.orgx-sem'));
  await expect(naColuna(page, 'p4')).toHaveCount(1);
  await expect(noDiagrama(page, 'p4')).toHaveCount(0);
  await expect(noDiagrama(page, 'p8')).toHaveCount(1);
  m = await mudancas(page);
  expect(m).toHaveLength(4);
  expect(m[3].mudanca.para).toEqual({ tipo: 'sem' });
  expect(m[3].mudanca.topoIds).toEqual(['p1', 'p5', 'p8']);
  expect(m[3].relacoes.some((r) => r.tipo === 'lidera' && (r.de === 'p4' || r.para === 'p4'))).toBe(false);
  await expect(page.locator('[data-org-sem-n]')).toHaveText('2');
  await capturar(page, 'depois-de-mover', testInfo);
  expect(erros).toEqual([]);
});

test('ciclo: soltar o líder sobre alguém da própria equipe é recusado com aviso', async ({ page }) => {
  const erros = coletarErros(page);
  await abrir(page);
  await arrastar(page, noDiagrama(page, 'p1'), noDiagrama(page, 'p4'), {
    antesDeSoltar: async () => {
      await expect(noDiagrama(page, 'p4')).toHaveClass(/orgx-alvo--proibido/);
      await expect(page.locator('.orgx-fantasma__dica')).toContainText('Não pode');
    }
  });
  await expect(page.locator('.orgx-aviso')).toBeVisible();
  await expect(page.locator('.orgx-aviso')).toContainText('Não dá para colocar Ana Ribeiro abaixo de Diego Martins');
  expect(await mudancas(page)).toEqual([]);
  await expect(page.locator('.orgx-quadro .orgx-cartao')).toHaveCount(7);
  expect(erros).toEqual([]);
});

test('"Mover para…" pelo teclado (menu com busca)', async ({ page }, testInfo) => {
  const erros = coletarErros(page);
  await abrir(page);
  const botao = naColuna(page, 'p9').locator('[data-acao="mover"]');
  await botao.focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('dialog', { name: 'Mover Isadora Freitas para…' });
  await expect(menu).toBeVisible();
  await expect(menu.locator('input')).toBeFocused();
  // Descendentes/líder atual aparecem desabilitados; aqui, Isadora está fora: "Sem posição" desabilitado.
  await expect(menu.getByRole('option', { name: /Sem posição/ })).toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.type('carla');
  await expect(menu.getByRole('option')).toHaveCount(1);
  await capturar(page, 'menu-mover', testInfo);
  await page.keyboard.press('Enter');
  await expect(menu).toHaveCount(0);
  await expect(noDiagrama(page, 'p9')).toHaveCount(1);
  await expect(noDiagrama(page, 'p9')).toBeFocused();
  let m = await mudancas(page);
  expect(m[0].relacoes).toContainEqual({ de: 'p3', para: 'p9', tipo: 'lidera' });

  // Pelo teclado também: Bruno -> Topo (setas) ; Esc fecha sem mudar.
  await noDiagrama(page, 'p2').locator('[data-acao="mover"]').focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(noDiagrama(page, 'p2').locator('[data-acao="mover"]')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('option', { name: /Abaixo de Diego Martins/ })).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByRole('option', { name: /Abaixo de Ana Ribeiro/ })).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByRole('option', { name: /^Topo/ })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  m = await mudancas(page);
  expect(m).toHaveLength(2);
  expect(m[1].mudanca).toMatchObject({ id: 'p2', para: { tipo: 'topo' } });
  expect(m[1].mudanca.topoIds).toEqual(['p1', 'p2']);
  expect(erros).toEqual([]);
});

test('zoom: + e − e "Ajustar à tela" (o diagrama inteiro cabe no quadro)', async ({ page }) => {
  await abrir(page, '?muitos=1');
  const quadro = page.locator('.orgx-quadro');
  const ajustar = page.getByRole('button', { name: 'Ajustar à tela' });
  await expect(ajustar).toHaveAttribute('aria-pressed', 'true');
  const valor = page.locator('[data-org-zoom]');
  const inicial = parseInt(await valor.textContent(), 10);
  await page.getByRole('button', { name: 'Aumentar' }).click();
  await page.getByRole('button', { name: 'Aumentar' }).click();
  await expect(valor).toHaveText((inicial + 20) + '%');
  await expect(ajustar).toHaveAttribute('aria-pressed', 'false');
  // Maior que o quadro: rola dentro do quadro, não a página.
  const [sw, cw] = await quadro.evaluate((q) => [q.scrollWidth, q.clientWidth]);
  expect(sw).toBeGreaterThan(cw);
  await semRolagemLateral(page);
  await page.getByRole('button', { name: 'Diminuir' }).click();
  await expect(valor).toHaveText((inicial + 10) + '%');
  await ajustar.click();
  await expect(valor).toHaveText(inicial + '%');
  await expect(ajustar).toHaveAttribute('aria-pressed', 'true');

  // Sem "muitos": ajustado, todos os cartões cabem no quadro.
  await abrir(page);
  const q = await page.locator('.orgx-quadro').boundingBox();
  for (const b of await page.locator('.orgx-quadro .orgx-cartao').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()))) {
    expect(b.left).toBeGreaterThanOrEqual(q.x);
    expect(b.right).toBeLessThanOrEqual(q.x + q.width);
    expect(b.bottom).toBeLessThanOrEqual(q.y + q.height);
  }
});

for (const vp of [{ width: 1366, height: 800 }, { width: 1920, height: 1080 }]) {
  test('sem rolagem lateral da página em ' + vp.width + '×' + vp.height, async ({ page }, testInfo) => {
    const erros = coletarErros(page);
    await abrir(page, '', vp);
    await semRolagemLateral(page);
    await capturar(page, String(vp.width), testInfo);
    await abrir(page, '?muitos=1', vp);
    await semRolagemLateral(page);
    if (vp.width === 1366) await capturar(page, 'grande-1366', testInfo);
    expect(erros).toEqual([]);
  });
}

test('modo ler: mesma árvore, sem arrastar nem coluna; clique abre a pessoa', async ({ page }, testInfo) => {
  const erros = coletarErros(page);
  await abrir(page, '?modo=ler&abrir=1');
  await expect(page.locator('.orgx-quadro .orgx-cartao')).toHaveCount(7);
  await expect(page.locator('.orgx-sem')).toHaveCount(0);
  await expect(page.locator('.orgx-topo')).toHaveCount(0);
  await expect(page.locator('[data-acao="mover"]')).toHaveCount(0);
  await expect(page.locator('[data-org-nota-sem]')).toHaveText('2 pessoas sem posição');
  // Tentar arrastar não muda nada; clicar abre.
  await arrastar(page, noDiagrama(page, 'p6'), noDiagrama(page, 'p2'));
  expect(await mudancas(page)).toEqual([]);
  await noDiagrama(page, 'p3').click();
  await noDiagrama(page, 'p5').focus();
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => window.__abertos)).toEqual(['p3', 'p5']);
  await capturar(page, 'ler', testInfo);
  expect(erros).toEqual([]);
});

test('paraHtml: versão estática para impressão', async ({ page }) => {
  await abrir(page);
  const html = await page.evaluate(() => DISC_ORGANOGRAMA.paraHtml({
    pessoas: [{ id: 'a', nome: 'Ana', codigo: 'D' }, { id: 'b', nome: 'Bia', codigo: 'S' }],
    relacoes: [{ de: 'a', para: 'b', tipo: 'lidera' }]
  }));
  await page.setContent('<link rel="stylesheet" href="/assets/notus.css"><link rel="stylesheet" href="/assets/organograma.css">' + html);
  await expect(page.locator('.orgx-impresso .orgx-cartao')).toHaveCount(2);
  await expect(page.locator('.orgx-impresso .orgx-linha')).toHaveCount(1);
});
