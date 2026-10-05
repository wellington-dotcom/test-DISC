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
    await expect(page.locator('.rodape-doc img.marca-doc__logo')).toHaveAttribute('alt', 'Gestão sem Caos');
    await expect(page.locator('.capa img.marca-doc__logo')).toBeVisible();
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

/* ------------------------------------------------------------------ modelos da fase 2: equipe, liderança, pessoa */
const MODELOS = require('../../js/relatorio-modelos.js');
const GERADO = '2026-10-05T12:00:00.000Z';
const RES = {
  DI: { percentuais: { D: 45, I: 25, S: 15, C: 15 }, codigo: 'DI' },
  SC: { percentuais: { D: 15, I: 20, S: 45, C: 20 }, codigo: 'SC' },
  CS: { percentuais: { D: 10, I: 15, S: 25, C: 50 }, codigo: 'CS' },
  ID: { percentuais: { D: 30, I: 40, S: 15, C: 15 }, codigo: 'ID' },
  IS: { percentuais: { D: 20, I: 40, S: 25, C: 15 }, codigo: 'IS' }
};
const DADOS_MODELO = {
  equipe: MODELOS.equipe({
    empresa: { nome: 'Cartório Exemplo de Nome Comprido', cidade: 'Boa Vista' }, consultor: 'Wellington V.',
    colaboradores: [
      { pessoaId: 'a', nome: 'Ana Paula Souza', telefone: '5595991112222', cargo: 'Diretora geral', status: 'ativo', resultado: RES.DI },
      { pessoaId: 'b', nome: 'Bruno Lima', cargo: 'Gerente administrativo', status: 'ativo', resultado: RES.SC },
      { pessoaId: 'c', nome: 'Carla Dias', cargo: 'Analista de registros', status: 'ativo', resultado: RES.CS },
      { pessoaId: 'd', nome: 'Davi Reis', cargo: 'Escrevente', status: 'ativo', resultado: null },
      { pessoaId: 'e', nome: 'Eva Nunes', cargo: 'Atendimento', status: 'ativo', resultado: RES.ID },
      { pessoaId: 'f', nome: 'Fernanda Melo', cargo: 'Financeiro', status: 'ativo', resultado: RES.SC },
      { pessoaId: 'g', nome: 'Gustavo Alves', cargo: 'Escrevente', status: 'ativo', resultado: RES.CS }
    ],
    relacoes: [
      { de: 'a', para: 'b', tipo: 'lidera' }, { de: 'a', para: 'e', tipo: 'lidera' }, { de: 'a', para: 'f', tipo: 'lidera' },
      { de: 'b', para: 'c', tipo: 'lidera' }, { de: 'b', para: 'd', tipo: 'lidera' }, { de: 'c', para: 'g', tipo: 'lidera' },
      { de: 'c', para: 'e', tipo: 'direto' }, { de: 'f', para: 'e', tipo: 'indireto' }
    ],
    foco: { nome: 'Helena Prado', cargo: 'Escrevente', resultado: RES.IS, relacoes: [{ de: 'b', para: 'foco', tipo: 'lidera' }, { de: 'foco', para: 'c', tipo: 'direto' }] }
  }, { geradoEm: GERADO }),
  lideranca: MODELOS.lideranca({ pessoa: { nome: 'Bruno Lima', cargo: 'Gerente administrativo', resultado: RES.SC }, lider: { nome: 'Ana Paula Souza', resultado: RES.DI }, empresa: { nome: 'Cartório Exemplo' }, consultor: 'Wellington V.' }, { geradoEm: GERADO }),
  pessoa: MODELOS.pessoa({ pessoa: { nome: 'Carla Dias', resultado: RES.CS }, consultor: 'Wellington V.' }, { geradoEm: GERADO })
};
const SECOES_MODELO = {
  equipe: ['capa', 'indice', 'sumario', 'organograma', 'equilibrio', 'relacoes', 'lideres', 'pessoas', 'foco', 'encerramento', 'rodape'],
  lideranca: ['capa', 'resumo', 'liderar', 'encerramento', 'rodape'],
  pessoa: ['capa', 'perfil', 'fortes', 'atencao', 'pressao', 'comunicacao', 'plano', 'encerramento', 'rodape']
};

async function prepararModelo(page, modelo, resposta) {
  await configurar(page, { API_URL: API_FALSA });
  return simularApi(page, (corpo) => {
    if (corpo.acao === 'relatorioPublico' && corpo.token === TOKEN) return resposta || { ok: true, modelo, relatorio: DADOS_MODELO[modelo] };
    return { ok: false, erro: 'Relatório não encontrado.' };
  });
}

for (const modelo of ['equipe', 'lideranca', 'pessoa']) {
  for (const [nome, viewport] of [['celular 375', { width: 375, height: 812 }], ['computador', { width: 1280, height: 900 }]]) {
    test('modelo ' + modelo + ' abre e mostra todas as seções (' + nome + ')', async ({ page }) => {
      const erros = coletarErros(page);
      await page.setViewportSize(viewport);
      const chamadas = await prepararModelo(page, modelo);
      await page.goto('/relatorio.html#r-' + TOKEN);
      await expect(page.locator('#relatorio')).toHaveAttribute('data-estado', 'pronto');
      await expect(page.locator('#relatorio')).toHaveAttribute('data-modelo', modelo);
      await expect(page.locator('.doc[data-modelo="' + modelo + '"]')).toHaveCount(1);
      for (const id of SECOES_MODELO[modelo]) await expect(page.locator('[data-secao="' + id + '"]')).toHaveCount(1);
      await expect(page.locator('[data-secao="ranking"]')).toHaveCount(0);
      await expect(page).toHaveTitle('Relatório · ' + DADOS_MODELO[modelo].titulo);
      expect(chamadas.map((c) => c.corpo.acao)).toEqual(['relatorioPublico']);
      await page.evaluate(() => document.fonts.ready);
      await semRolagemLateral(page);
      const texto = await page.locator('body').innerText();
      for (const proibido of ['5595991112222', 'Souza', '@', 'WhatsApp']) expect(texto).not.toContain(proibido);
      expect(erros).toEqual([]);
    });
  }
}

test('organograma: cartões com letra DISC ligados por linhas; no celular vira lista recuada', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await prepararModelo(page, 'equipe');
  await page.goto('/relatorio.html#r-' + TOKEN);
  await expect(page.locator('#relatorio')).toHaveAttribute('data-estado', 'pronto');
  const org = page.locator('[data-secao="organograma"] .org');
  await expect(org.locator('.org-cartao')).toHaveCount(7);
  await expect(org.locator('.org-cartao--sem')).toHaveCount(1);
  await expect(org.locator('.org-cartao--D .org-cartao__letra')).toHaveText('D');
  // cor da letra = token DISC (D azul-escuro #13283F)
  expect(await org.locator('.org-cartao--D .org-cartao__letra').first().evaluate((e) => getComputedStyle(e).backgroundColor)).toBe('rgb(19, 40, 63)');
  expect(await org.locator('.org-cartao--I .org-cartao__letra').first().evaluate((e) => getComputedStyle(e).backgroundColor)).toBe('rgb(255, 159, 64)');
  // computador: os 3 liderados do topo lado a lado
  const linha = org.locator('.org__filhos--linha > li > .org-cartao');
  await expect(linha).toHaveCount(3);
  const ys = await linha.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  expect(new Set(ys).size).toBe(1);
  // linhas: o fio do conector existe (pseudo-elemento com borda)
  expect(await org.locator('.org__filhos--linha > li').first().evaluate((e) => getComputedStyle(e, '::after').borderLeftStyle)).toBe('solid');
  // celular: lista recuada (cada nível mais à direita), sem rolagem lateral
  await page.setViewportSize({ width: 375, height: 812 });
  const xs = await org.locator('.org__filhos--linha > li > .org-cartao').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)));
  expect(new Set(xs).size).toBe(1);
  const raiz = await org.locator('.org__arvore > .org__no > .org-cartao').evaluate((e) => e.getBoundingClientRect().left);
  expect(xs[0]).toBeGreaterThan(raiz);
  await semRolagemLateral(page);
  // impressão (A4) sem rolagem lateral
  await page.setViewportSize({ width: 794, height: 1123 });
  await page.emulateMedia({ media: 'print' });
  await semRolagemLateral(page);
});

test('modelo vindo só no campo "modelo" da resposta também é desenhado', async ({ page }) => {
  const dados = Object.assign({}, DADOS_MODELO.pessoa);
  delete dados.modelo;
  await prepararModelo(page, 'pessoa', { ok: true, modelo: 'pessoa', relatorio: dados });
  await page.goto('/relatorio.html?r=' + TOKEN);
  await expect(page.locator('#relatorio')).toHaveAttribute('data-modelo', 'pessoa');
  await expect(page.locator('.capa__titulo')).toContainText('Olá, Carla.');
});

/* ------------------------------------------------------------------ rodada 3: mapa ritmo × foco, régua, Parte 2, versão simples, fotos */
const EXIGIDO_DI = '4321'.repeat(10);
// JPEG 1×1 válido (data URL) — foto de teste, sem gente real.
const FOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
const DADOS_R3 = {
  pessoaCompleto: MODELOS.pessoa({ pessoa: { nome: 'Carla Dias', resultado: RES.CS, exigido: EXIGIDO_DI, foto: FOTO }, consultor: 'Wellington V.' }, { geradoEm: GERADO }),
  pessoaSimples: MODELOS.pessoaSimples({ pessoa: { nome: 'Carla Dias', resultado: RES.CS, exigido: EXIGIDO_DI } }, { geradoEm: GERADO }),
  lideranca: MODELOS.lideranca({ pessoa: { nome: 'Bruno Lima', cargo: 'Gerente', resultado: RES.SC, exigido: EXIGIDO_DI, foto: 'https://exemplo.com/foto.jpg' }, lider: { nome: 'Ana Paula Souza', resultado: RES.DI }, empresa: { nome: 'Cartório Exemplo' } }, { geradoEm: GERADO }),
  equipe: MODELOS.equipe({
    empresa: { nome: 'Clínica Exemplo' }, consultor: 'Wellington V.',
    colaboradores: [
      { pessoaId: 'a', nome: 'Ana Paula Souza', cargo: 'Diretora', status: 'ativo', resultado: RES.DI, exigido: EXIGIDO_DI, foto: FOTO },
      { pessoaId: 'b', nome: 'Bruno Lima', cargo: 'Gerente', status: 'ativo', resultado: RES.SC, exigido: { percentuais: { D: 35, I: 30, S: 15, C: 20 }, codigo: 'DI' } },
      { pessoaId: 'c', nome: 'Carla Dias', cargo: 'Analista', status: 'ativo', resultado: RES.CS },
      { pessoaId: 'e', nome: 'Eva Nunes', cargo: 'Atendimento', status: 'ativo', resultado: RES.ID },
      { pessoaId: 'f', nome: 'Fernanda Melo', cargo: 'Financeiro', status: 'ativo', resultado: RES.SC }
    ],
    relacoes: [{ de: 'a', para: 'b', tipo: 'lidera' }, { de: 'a', para: 'e', tipo: 'lidera' }, { de: 'b', para: 'c', tipo: 'lidera' }]
  }, { geradoEm: GERADO })
};
const SECOES_R3 = {
  pessoaCompleto: ['capa', 'perfil', 'intensidade', 'esticando', 'fortes', 'plano', 'encerramento', 'rodape'],
  pessoaSimples: ['capa', 'resumo', 'habitos', 'encerramento', 'rodape'],
  lideranca: ['capa', 'resumo', 'liderar', 'encerramento', 'rodape'],
  equipe: ['capa', 'sumario', 'organograma', 'equilibrio', 'ritmo', 'relacoes', 'pessoas', 'encerramento', 'rodape']
};

for (const chave of Object.keys(DADOS_R3)) {
  for (const [nome, viewport] of [['celular 375', { width: 375, height: 812 }], ['computador', { width: 1280, height: 900 }]]) {
    test('rodada 3: ' + chave + ' com mapa ritmo × foco e seta, sem rolagem lateral (' + nome + ')', async ({ page }) => {
      const erros = coletarErros(page);
      await page.setViewportSize(viewport);
      const d = DADOS_R3[chave];
      await prepararModelo(page, d.modelo, { ok: true, modelo: d.modelo, relatorio: d });
      await page.goto('/relatorio.html#r-' + TOKEN);
      await expect(page.locator('#relatorio')).toHaveAttribute('data-estado', 'pronto');
      for (const id of SECOES_R3[chave]) await expect(page.locator('[data-secao="' + id + '"]')).toHaveCount(1);
      const mapa = page.locator('.mapa-rf').first();
      await expect(mapa).toBeVisible();
      await expect(mapa.locator('.mapa-rf__letra')).toHaveText(['D', 'I', 'C', 'S']);
      // seta tracejada laranja do natural ao exigido
      const seta = mapa.locator('.mapa-rf__seta line').first();
      await expect(seta).toHaveAttribute('stroke-dasharray', '4 3');
      expect(await seta.evaluate((e) => getComputedStyle(e).stroke)).toBe('rgb(243, 68, 5)');
      // o mapa cabe na largura (sem estourar o cartão)
      const caixa = await mapa.boundingBox();
      expect(caixa.x).toBeGreaterThanOrEqual(0);
      expect(caixa.x + caixa.width).toBeLessThanOrEqual(viewport.width);
      if (chave.startsWith('pessoa')) await expect(page.locator('.regua-doc__item')).toHaveCount(4);
      if (chave === 'equipe') {
        await expect(page.locator('[data-secao="ritmo"]')).toContainText('Como o grupo decide');
        await expect(page.locator('[data-secao="ritmo"]')).toContainText('Pressão do trabalho sobre o estilo');
        await expect(page.locator('[data-secao="organograma"] .org-cartao--com-foto img')).toHaveCount(1);
      }
      if (chave === 'pessoaCompleto') await expect(page.locator('.capa__retrato img')).toHaveCount(1);
      if (chave === 'lideranca') {
        // foto inválida (URL externa) vira iniciais; nenhuma imagem externa na página
        await expect(page.locator('.capa__retrato .avatar--iniciais')).toHaveText('BL');
        await expect(page.locator('.esforco, [data-secao="resumo"]')).toContainText('Esforço de adaptação ao cargo');
      }
      expect(await page.locator('img[src^="http"]').count()).toBe(0);
      await page.evaluate(() => document.fonts.ready);
      await semRolagemLateral(page);
      const texto = await page.locator('body').innerText();
      for (const proibido of ['Souza', '@', 'WhatsApp', 'exemplo.com']) expect(texto).not.toContain(proibido);
      expect(erros).toEqual([]);
    });
  }
}

test('rodada 3: versão simples e pessoa completa imprimem em A4 sem rolagem lateral', async ({ page }) => {
  for (const chave of ['pessoaSimples', 'pessoaCompleto', 'equipe']) {
    const d = DADOS_R3[chave];
    await page.setViewportSize({ width: 794, height: 1123 });
    await prepararModelo(page, d.modelo, { ok: true, modelo: d.modelo, relatorio: d });
    await page.goto('/relatorio.html#r-' + TOKEN);
    await expect(page.locator('#relatorio')).toHaveAttribute('data-estado', 'pronto');
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('.mapa-rf').first()).toBeVisible();
    await semRolagemLateral(page);
    await page.emulateMedia({ media: 'screen' });
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  }
});

test('rodada 3: foto no relatório de processo (ranking) e sem foto nada muda', async ({ page }) => {
  const rel = JSON.parse(JSON.stringify(RELATORIO));
  rel.ranking.linhas[0].foto = FOTO;
  rel.ranking.linhas[1].foto = 'https://exemplo.com/x.jpg';
  await page.setViewportSize({ width: 375, height: 812 });
  await configurar(page, { API_URL: API_FALSA });
  await simularApi(page, () => ({ ok: true, relatorio: rel }));
  await page.goto('/relatorio.html#r-' + TOKEN);
  await expect(page.locator('#relatorio')).toHaveAttribute('data-estado', 'pronto');
  await expect(page.locator('.analise__item .avatar--foto img')).toHaveCount(1);
  expect(await page.locator('img[src^="http"]').count()).toBe(0);
  await semRolagemLateral(page);
});
