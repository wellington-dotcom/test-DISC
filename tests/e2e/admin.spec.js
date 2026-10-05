'use strict';
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const { API_FALSA, coletarErros, configurar, simularApi, fazerTesteCompleto } = require('./util.js');

// Escolhe uma opção no seletor em pílula (substitui o <select> nativo).
async function escolher(page, seletor, valor) {
  await page.click(seletor);
  await page.locator(seletor + '-lista [role="option"][data-valor="' + valor + '"]').click();
  await expect(page.locator(seletor)).toHaveAttribute('value', valor);
}

// Monta um código DISC1.* no próprio navegador (mesmo codec do candidato).
async function gerarCodigo(page, payload) {
  return page.evaluate((p) => window.DISC_CODEC.encode(p), payload);
}

function payload(extra) {
  return Object.assign({
    v: 1,
    id: 'lx9e2e-' + Math.random().toString(36).slice(2, 8),
    nome: 'Carla Nogueira Dias',
    telefone: '5511988887777',
    vaga: 'Supervisora',
    consentimento: true,
    inicio: '2026-10-01T12:00:00.000Z',
    fim: '2026-10-01T12:09:30.000Z',
    duracaoSeg: 570,
    respostas: '4321'.repeat(25),
    resultado: { percentuais: { D: 40, I: 30, S: 20, C: 10 }, codigo: 'DI' }
  }, extra || {});
}

test.describe('Admin sem API (importar código)', () => {
  test('importa código colado da mensagem do WhatsApp e mostra perfil, gráfico e guia', async ({ page }) => {
    const erros = coletarErros(page);
    await page.goto('/admin.html');
    await expect(page.locator('#modo-indicador')).toHaveText('Modo local (importar códigos)');
    await expect(page.locator('#dica-previa')).toBeHidden();
    await expect(page.locator('#vista-importar')).toBeVisible();

    // Código inválido
    await page.fill('#campo-codigos', 'DISC1.@@@');
    await page.click('#btn-importar');
    await expect(page.locator('#resultado-importacao')).toContainText('0 importados');
    await expect(page.locator('#resultado-importacao')).toContainText('formato inválido');

    // Mensagem completa do WhatsApp com dois códigos (um deles com nome malicioso para testar XSS)
    const c1 = await gerarCodigo(page, payload({ id: 'e2e-carla-01' }));
    const c2 = await gerarCodigo(page, payload({ id: 'e2e-xss-0002', nome: '<img src=x onerror="window.__xss=1"> Silva', respostas: '1234'.repeat(25) }));
    await page.fill('#campo-codigos', 'Olá! Concluí o teste DISC.\nNome: Carla\n\nCódigo de resultado:\n' + c1 + '\n\n' + c2);
    await page.click('#btn-importar');
    await expect(page.locator('#resultado-importacao')).toContainText('2 importados');

    // Reimportar o mesmo código não duplica
    await page.fill('#campo-codigos', c1);
    await page.click('#btn-importar');
    await expect(page.locator('#resultado-importacao')).toContainText('1 já existia');

    await page.locator('.aba[data-aba="lista"]').click();
    await expect(page.locator('#lista-candidatos > li')).toHaveCount(2);
    await expect(page.locator('#contagem')).toHaveText('2 de 2 candidatos');
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();

    // Filtro por perfil primário
    await escolher(page, '#filtro-perfil', 'C');
    await expect(page.locator('#lista-candidatos > li')).toHaveCount(1);
    await escolher(page, '#filtro-perfil', '');
    await page.fill('#filtro-busca', 'carla');
    await expect(page.locator('#lista-candidatos > li')).toHaveCount(1);
    await page.fill('#filtro-busca', '');

    const card = page.locator('#lista-candidatos > li', { hasText: 'Carla Nogueira Dias' });
    await expect(card.locator('.badge')).toHaveText('DI');
    await expect(card.locator('.protocolo__valor')).toHaveText('—');
    await expect(card.locator('a.link-wa')).toHaveAttribute('href', 'https://wa.me/5511988887777');
    await card.getByRole('button', { name: /Ver detalhes/ }).click();

    const det = page.locator('#vista-detalhe');
    await expect(det).toBeVisible();
    await expect(det.locator('h2')).toHaveText('Carla Nogueira Dias');
    // Código antigo (sem idade/função/empresa) continua importável e mostra "—"
    await expect(det.locator('#det-idade')).toHaveText('—');
    await expect(det.locator('#det-funcao')).toHaveText('—');
    await expect(det.locator('#det-empresa')).toHaveText('—');
    await expect(det.locator('svg.grafico')).toBeVisible();
    await expect(det.locator('svg.grafico rect')).toHaveCount(4);
    // Identidade nova: trilho liso (sem padrões hachurados) e cores dos tokens DISC
    await expect(det.locator('svg.grafico pattern')).toHaveCount(0);
    await expect(det.locator('svg.grafico rect.barra-D')).toHaveAttribute('fill', '#13283f');
    await expect(det.locator('.perfil-card.caixa--suave')).toHaveCount(1);
    await expect(det.locator('.caixa--vidro')).toHaveCount(1);
    await expect(det.locator('svg.grafico')).toHaveAttribute('aria-label', /D 40%, I 30%, S 20%, C 10%/);
    await expect(det.locator('.perfil-card')).toHaveCount(2);

    const guia = det.locator('section.guia');
    await expect(guia).toBeVisible();
    await expect(guia.locator('h3')).toContainText('Liderança');
    const secoes = guia.locator('.guia-secao');
    expect(await secoes.count()).toBeGreaterThanOrEqual(5);
    for (let i = 0; i < await secoes.count(); i++) {
      expect(await secoes.nth(i).locator('li').count()).toBeGreaterThan(0);
    }
    await expect(guia).toContainText('Carla');

    // Marcar aprovado (local) e ver no comparativo
    await escolher(page, '#det-status', 'aprovado');
    await expect(page.locator('#aviso-geral')).toContainText('Aprovado');
    await page.locator('.aba[data-aba="comparativo"]').click();
    await expect(page.locator('#vista-comparativo')).toContainText('1 aprovado.');
    await expect(page.locator('#vista-comparativo .empilhados')).toBeVisible();
    await expect(page.locator('#resumo-lista .caixa--destaque')).toContainText('1');

    // Persistência local após recarregar
    await page.reload();
    await page.locator('.aba[data-aba="lista"]').click();
    await expect(page.locator('#lista-candidatos > li')).toHaveCount(2);
    await expect(page.locator('#lista-candidatos > li', { hasText: 'Carla' }).locator('.status')).toHaveText('Aprovado');

    // XSS: o nome aparece como texto, sem criar <img>
    await page.locator('#lista-candidatos > li', { hasText: 'Silva' }).getByRole('button', { name: /Ver detalhes/ }).click();
    await expect(page.locator('#vista-detalhe h2')).toContainText('<img src=x');
    expect(await page.locator('#vista-detalhe img').count()).toBe(0);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    await page.keyboard.press('Escape');

    // Excluir todos com confirmação digitando EXCLUIR
    await page.click('#btn-excluir-todos');
    await expect(page.locator('#confirmar-ok')).toBeDisabled();
    await page.fill('#confirmar-texto', 'excluir errado');
    await expect(page.locator('#confirmar-ok')).toBeDisabled();
    await page.fill('#confirmar-texto', 'EXCLUIR');
    await page.click('#confirmar-ok');
    await expect(page.locator('#confirmar')).toHaveCount(0);
    await expect(page.locator('#lista-candidatos > li')).toHaveCount(0);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('disc_admin_registros') || '[]').length)).toBe(0);

    expect(erros).toEqual([]);
  });
});

test('fluxo integrado: código gerado pelo candidato é importado no painel', async ({ page }) => {
  const erros = coletarErros(page);
  await fazerTesteCompleto(page, { nome: 'Lucas Fernandes Rocha', telefone: '31999990000', vaga: 'Analista' }, ['I', 'D', 'C', 'S']);
  await page.locator('[data-acao="enviar"]').click();
  const codigo = await page.locator('textarea#codigo').inputValue();

  await page.goto('/admin.html');
  await page.fill('#campo-codigos', codigo);
  await page.click('#btn-importar');
  await expect(page.locator('#resultado-importacao')).toContainText('1 importado');
  await page.locator('.aba[data-aba="lista"]').click();
  const card = page.locator('#lista-candidatos > li', { hasText: 'Lucas Fernandes Rocha' });
  await expect(card.locator('.badge')).toHaveText('ID');
  await expect(card).toContainText('(31) 99999-0000');
  await card.getByRole('button', { name: /Ver detalhes/ }).click();
  await expect(page.locator('#vista-detalhe svg.grafico')).toBeVisible();
  await expect(page.locator('#vista-detalhe section.guia')).toContainText('Lucas');
  expect(erros).toEqual([]);
});

test.describe('Admin com API simulada', () => {
  test('login com chave, lista, marca aprovado, salva observações e exporta CSV', async ({ page }) => {
    const erros = coletarErros(page);
    const CHAVE = 'chave-e2e-123';
    await configurar(page, { API_URL: API_FALSA, EMPRESA: 'Empresa Teste' });
    const itens = [
      Object.assign(payload({ id: 'api-item-001', nome: 'Rafael Moreira Lima', idade: 34, funcao: 'Supervisor de vendas', empresa: 'Loja Centro' }), { status: 'em_analise', observacoes: '', recebidoEm: '2026-10-02T10:00:00.000Z', protocolo: '47K' }),
      Object.assign(payload({ id: 'api-item-002', nome: 'Beatriz Santos', respostas: '2143'.repeat(25), resultado: { codigo: 'DI' } }), { status: 'reprovado', observacoes: 'Sem disponibilidade', recebidoEm: '2026-10-03T10:00:00.000Z', protocolo: '03W' }),
      Object.assign(payload({ id: 'api-item-003', nome: 'Registro Corrompido', respostas: '1111' }), { status: 'em_analise', observacoes: '', recebidoEm: '2026-10-01T10:00:00.000Z' })
    ];
    const chamadas = await simularApi(page, (corpo) => {
      if (corpo.chave !== CHAVE) return { ok: false, erro: 'Chave de administrador inválida.', naoAutorizado: true };
      if (corpo.acao === 'listar') return { ok: true, itens };
      if (corpo.acao === 'atualizar') {
        const it = itens.find((i) => i.id === corpo.id);
        if (!it) return { ok: false, erro: 'Candidato não encontrado.' };
        Object.assign(it, corpo.campos);
        return { ok: true, id: corpo.id };
      }
      return { ok: false, erro: 'Ação inesperada no teste.' };
    });

    await page.goto('/admin.html');
    await expect(page.locator('#tela-login')).toBeVisible();

    await page.fill('#campo-chave', 'errada');
    await page.click('#btn-entrar');
    await expect(page.locator('#erro-login')).toHaveText('Chave de administrador inválida.');
    await expect(page.locator('#tela-painel')).toBeHidden();

    await page.fill('#campo-chave', CHAVE);
    await page.click('#btn-entrar');
    await expect(page.locator('#tela-painel')).toBeVisible();
    await expect(page.locator('#lista-candidatos > li')).toHaveCount(3);
    expect(await page.evaluate(() => sessionStorage.getItem('disc_admin_chave'))).toBe(CHAVE);

    // Registro corrompido aparece como inválido; o perfil é recalculado das respostas (2143 -> S4 C3 = SC), ignorando resultado.codigo
    await expect(page.locator('#lista-candidatos > li', { hasText: 'Registro Corrompido' }).locator('.status')).toHaveText('Inválido');
    await expect(page.locator('#lista-candidatos > li', { hasText: 'Beatriz Santos' }).locator('.badge')).toHaveText('SC');

    // Protocolo em cada card ("—" para quem não tem) e busca por protocolo (ignora maiúsculas/espaços)
    await expect(page.locator('#lista-candidatos > li', { hasText: 'Rafael' }).locator('.protocolo__valor')).toHaveText('47K');
    await expect(page.locator('#lista-candidatos > li', { hasText: 'Beatriz' }).locator('.protocolo__valor')).toHaveText('03W');
    await expect(page.locator('#lista-candidatos > li', { hasText: 'Registro Corrompido' }).locator('.protocolo__valor')).toHaveText('—');
    await page.fill('#filtro-busca', '47 k');
    await expect(page.locator('#lista-candidatos > li')).toHaveCount(1);
    await expect(page.locator('#lista-candidatos > li')).toContainText('Rafael Moreira Lima');
    await page.fill('#filtro-busca', '03w');
    await expect(page.locator('#lista-candidatos > li')).toHaveCount(1);
    await expect(page.locator('#lista-candidatos > li')).toContainText('Beatriz Santos');
    await page.fill('#filtro-busca', '');
    await expect(page.locator('#lista-candidatos > li')).toHaveCount(3);

    // Card da lista: "Função · Empresa" discreto, e NUNCA a idade (só no detalhe — Lei 9.029/95)
    const cardRafael = page.locator('#lista-candidatos > li', { hasText: 'Rafael' });
    await expect(cardRafael.locator('.card-experiencia')).toHaveText('Supervisor de vendas · Loja Centro');
    await expect(cardRafael).not.toContainText('34 anos');
    await expect(cardRafael).not.toContainText('Idade');
    expect(await cardRafael.innerText()).not.toMatch(/\b34\b/);
    await expect(page.locator('#lista-candidatos > li', { hasText: 'Beatriz' }).locator('.card-experiencia')).toHaveCount(0);
    await expect(page.locator('#vista-lista')).not.toContainText('34 anos');
    await expect(page.locator('#vista-lista')).not.toContainText('Idade');
    // Busca por função/empresa encontra; pela idade, não
    await page.fill('#filtro-busca', 'loja centro');
    await expect(page.locator('#lista-candidatos > li')).toHaveCount(1);
    await expect(page.locator('#lista-candidatos > li')).toContainText('Rafael Moreira Lima');
    await page.fill('#filtro-busca', 'de vendas');
    await expect(page.locator('#lista-candidatos > li')).toHaveCount(1);
    await page.fill('#filtro-busca', '34');
    await expect(page.locator('#lista-candidatos > li')).toHaveCount(0);
    await page.fill('#filtro-busca', '');
    await expect(page.locator('#lista-candidatos > li')).toHaveCount(3);

    // Filtro por status
    await escolher(page, '#filtro-status', 'reprovado');
    await expect(page.locator('#lista-candidatos > li')).toHaveCount(1);
    await escolher(page, '#filtro-status', '');

    // Detalhe e aprovação
    await page.locator('#lista-candidatos > li', { hasText: 'Rafael' }).getByRole('button', { name: /Ver detalhes/ }).click();
    await expect(page.locator('#vista-detalhe h2')).toHaveText('Rafael Moreira Lima');
    await expect(page.locator('#det-protocolo')).toHaveText('Código 47K');
    await expect(page.locator('#det-idade')).toHaveText('34 anos');
    await expect(page.locator('#det-funcao')).toHaveText('Supervisor de vendas');
    await expect(page.locator('#det-empresa')).toHaveText('Loja Centro');
    await expect(page.locator('#vista-detalhe section.guia')).toContainText('Rafael');
    await escolher(page, '#det-status', 'aprovado');
    await expect(page.locator('#aviso-geral')).toContainText('Aprovado');
    await page.fill('#det-obs', 'Ótima comunicação.');
    await page.getByRole('button', { name: 'Salvar observações' }).click();
    await expect(page.locator('#aviso-geral')).toContainText('Observações salvas');

    const atualizacoes = chamadas.filter((c) => c.corpo.acao === 'atualizar').map((c) => c.corpo);
    expect(atualizacoes).toEqual([
      { acao: 'atualizar', chave: CHAVE, id: 'api-item-001', campos: { status: 'aprovado' } },
      { acao: 'atualizar', chave: CHAVE, id: 'api-item-001', campos: { observacoes: 'Ótima comunicação.' } }
    ]);
    chamadas.forEach((c) => expect(c.headers['content-type']).toContain('text/plain'));

    // Comparativo dos aprovados
    await page.locator('.aba[data-aba="comparativo"]').click();
    await expect(page.locator('#vista-comparativo')).toContainText('1 aprovado.');
    await expect(page.locator('#vista-comparativo')).toContainText('Rafael Moreira Lima');

    // Exportar CSV
    await page.locator('.aba[data-aba="lista"]').click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#btn-csv')]);
    expect(download.suggestedFilename()).toMatch(/^candidatos-disc-\d{4}-\d{2}-\d{2}\.csv$/);
    const csv = fs.readFileSync(await download.path(), 'utf8');
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const linhas = csv.slice(1).trim().split(/\r\n/);
    expect(linhas.length).toBe(4);
    expect(linhas[0]).toContain('nome;telefone');
    expect(linhas[0]).toContain('protocolo');
    const rafael = linhas.find((l) => l.indexOf('Rafael Moreira Lima') !== -1);
    expect(rafael).toContain('(11) 98888-7777');
    expect(rafael).toContain('Aprovado');
    expect(rafael).toContain('Ótima comunicação.');
    expect(rafael).toContain(';DI;');
    expect(rafael).toContain(';47K;');
    expect(linhas[0]).toContain(';vaga;idade;funcao;empresa;');
    expect(rafael).toContain(';Supervisora;34;Supervisor de vendas;Loja Centro;');
    const beatriz = linhas.find((l) => l.indexOf('Beatriz Santos') !== -1);
    expect(beatriz).toContain(';Supervisora;;;;');

    // Sair limpa a sessão
    await page.click('#btn-sair');
    await expect(page.locator('#tela-login')).toBeVisible();
    expect(await page.evaluate(() => sessionStorage.getItem('disc_admin_chave'))).toBeNull();

    expect(erros).toEqual([]);
  });
});

test('Admin com API: código de resultado importado é enviado à planilha', async ({ page }) => {
  const erros = coletarErros(page);
  const CHAVE = 'chave-e2e-123';
  await configurar(page, { API_URL: API_FALSA });
  const itens = [];
  const chamadas = await simularApi(page, (corpo) => {
    if (corpo.acao === 'enviar') {
      if (itens.find((i) => i.id === corpo.payload.id)) return { ok: true, duplicado: true, id: corpo.payload.id };
      itens.push(Object.assign({}, corpo.payload, { status: 'em_analise', observacoes: '', recebidoEm: '2026-10-04T10:00:00.000Z' }));
      return { ok: true, id: corpo.payload.id };
    }
    if (corpo.chave !== CHAVE) return { ok: false, erro: 'Chave de administrador inválida.' };
    if (corpo.acao === 'listar') return { ok: true, itens };
    return { ok: false, erro: 'Ação inesperada no teste.' };
  });
  await page.goto('/admin.html');
  await page.fill('#campo-chave', CHAVE);
  await page.click('#btn-entrar');
  await expect(page.locator('#tela-painel')).toBeVisible();
  await expect(page.locator('#aba-importar')).toBeVisible();
  await page.locator('#aba-importar').click();

  const bom = await gerarCodigo(page, payload({ id: 'api-import-01', nome: 'Helena Prado Souza' }));
  const semConsentimento = await gerarCodigo(page, payload({ id: 'api-import-02', consentimento: false }));
  await page.fill('#campo-codigos', bom + '\n' + semConsentimento);
  await page.click('#btn-importar');
  await expect(page.locator('#resultado-importacao')).toContainText('1 importado');
  await expect(page.locator('#resultado-importacao')).toContainText('consentimento');
  expect(chamadas.filter((c) => c.corpo.acao === 'enviar').length).toBe(1);

  await page.locator('.aba[data-aba="lista"]').click();
  await expect(page.locator('#lista-candidatos > li', { hasText: 'Helena Prado Souza' })).toHaveCount(1);
  expect(erros).toEqual([]);
});

test('Admin na prévia (API_URL "simulada"): chave previa, protocolo gerado e busca por código', async ({ page }) => {
  const erros = coletarErros(page);
  await configurar(page, { API_URL: 'simulada' });
  const pedidosExternos = [];
  page.on('request', (req) => { if (!req.url().startsWith('http://localhost')) pedidosExternos.push(req.url()); });
  await page.goto('/admin.html');
  await expect(page.locator('#tela-login')).toBeVisible();
  await expect(page.locator('#dica-previa')).toBeVisible();
  await expect(page.locator('#dica-previa')).toHaveText('Prévia: use a chave previa');
  await expect(page.locator('#modo-indicador')).toHaveText('Prévia (dados de demonstração)');

  await page.fill('#campo-chave', 'errada');
  await page.click('#btn-entrar');
  await expect(page.locator('#erro-login')).toHaveText('Chave de administrador inválida.');
  await page.fill('#campo-chave', 'previa');
  await page.click('#btn-entrar');
  await expect(page.locator('#tela-painel')).toBeVisible();
  await expect(page.locator('#contagem')).toHaveText('Nenhum candidato recebido ainda.');

  // Envio "do candidato" pela API simulada: o servidor falso devolve o protocolo
  const r1 = await page.evaluate((p) => window.DISC_API.enviar(p), payload({ id: 'previa-envio-01', nome: 'Paula Mendes Rocha', idade: 28 }));
  expect(r1.protocolo).toMatch(/^[0-9]{2}[A-HJ-NP-Z]$/);
  const r2 = await page.evaluate((p) => window.DISC_API.enviar(p), payload({ id: 'previa-envio-01', nome: 'Paula Mendes Rocha', idade: 28 }));
  expect(r2).toEqual({ ok: true, duplicado: true, id: 'previa-envio-01', protocolo: r1.protocolo });

  // Código importado na aba "Importar códigos" também ganha protocolo
  await page.locator('#aba-importar').click();
  // Com servidor, código antigo sem idade é recusado pelo servidor (idade obrigatória) com mensagem clara
  const antigoSemIdade = await gerarCodigo(page, payload({ id: 'previa-antigo-3', nome: 'Rui Antigo Melo' }));
  await page.fill('#campo-codigos', await gerarCodigo(page, payload({ id: 'previa-import-2', nome: 'Otávio Prado Lins', idade: 61, respostas: '1234'.repeat(25) })) + '\n' + antigoSemIdade);
  await page.click('#btn-importar');
  await expect(page.locator('#resultado-importacao')).toContainText('1 importado');
  await expect(page.locator('#resultado-importacao')).toContainText('Idade não informada');

  await page.locator('.aba[data-aba="lista"]').click();
  await expect(page.locator('#lista-candidatos > li')).toHaveCount(2);
  const paula = page.locator('#lista-candidatos > li', { hasText: 'Paula Mendes Rocha' });
  await expect(paula.locator('.protocolo__valor')).toHaveText(r1.protocolo);
  await expect(page.locator('#lista-candidatos > li', { hasText: 'Otávio' }).locator('.protocolo__valor')).toHaveText(/^[0-9]{2}[A-HJ-NP-Z]$/);

  const busca = r1.protocolo.slice(0, 2) + ' ' + r1.protocolo.slice(2).toLowerCase();
  await page.fill('#filtro-busca', busca);
  await expect(page.locator('#lista-candidatos > li')).toHaveCount(1);
  await expect(page.locator('#lista-candidatos > li')).toContainText('Paula Mendes Rocha');
  // Com a busca preenchida, "Ver detalhes" abre o detalhe (o blur da busca não pode recriar a lista no meio do clique)
  await page.locator('#lista-candidatos > li').getByRole('button', { name: /Ver detalhes/ }).click();
  await expect(page.locator('#vista-detalhe')).toBeVisible();
  await expect(page.locator('#vista-detalhe')).toContainText(r1.protocolo);
  await page.keyboard.press('Escape');
  await expect(page.locator('#vista-lista')).toBeVisible();
  await page.fill('#filtro-busca', '');

  // Os dados sobrevivem a recarregar (localStorage 'disc_planilha_simulada')
  await page.reload();
  await expect(page.locator('#lista-candidatos > li')).toHaveCount(2);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('disc_planilha_simulada')).length)).toBe(2);
  expect(pedidosExternos).toEqual([]);
  expect(erros).toEqual([]);
});
