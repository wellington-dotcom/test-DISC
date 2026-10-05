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
    await expect(page.locator('#contagem')).toHaveText('2 de 2 participantes');
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

/* ---------- Com servidor: login por e-mail e senha, papéis e token ---------- */

// Entra no painel com e-mail e senha e espera a lista aparecer.
async function entrar(page, email, senha) {
  await expect(page.locator('#form-login')).toBeVisible();
  await page.fill('#campo-email', email);
  await page.fill('#campo-senha', senha);
  await page.click('#btn-entrar');
  await expect(page.locator('#tela-painel')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#contagem')).not.toHaveText('Carregando…');
}

async function sairDoPainel(page) {
  await page.click('#btn-usuario');
  await expect(page.locator('#menu-usuario')).toBeVisible();
  await page.click('#btn-sair');
  await expect(page.locator('#form-login')).toBeVisible();
}

// Abas visíveis, na ordem da tela.
async function abasVisiveis(page) {
  return page.locator('.aba:visible').evaluateAll((els) => els.map((e) => e.getAttribute('data-aba')));
}

test.describe('Admin com API (servidor simulado por page.route)', () => {
  test('login com e-mail e senha, token em cada chamada, lista, aprovado, observações, CSV e sair', async ({ page }) => {
    const erros = coletarErros(page);
    const TOKEN = 'token-e2e-123';
    await configurar(page, { API_URL: API_FALSA, EMPRESA: 'Empresa Teste' });
    const itens = [
      Object.assign(payload({ id: 'api-item-001', nome: 'Rafael Moreira Lima', idade: 34, funcao: 'Supervisor de vendas', empresa: 'Loja Centro' }), { status: 'em_analise', observacoes: '', recebidoEm: '2026-10-02T10:00:00.000Z', protocolo: '47K', avaliacao: 'AB23', empresaId: 'emp1', empresaNome: 'Loja Modelo', avaliacaoNome: 'Vendedor 2026', avaliacaoTipo: 'selecao' }),
      Object.assign(payload({ id: 'api-item-002', nome: 'Beatriz Santos', respostas: '2143'.repeat(25), resultado: { codigo: 'DI' } }), { status: 'reprovado', observacoes: 'Sem disponibilidade', recebidoEm: '2026-10-03T10:00:00.000Z', protocolo: '03W' }),
      Object.assign(payload({ id: 'api-item-003', nome: 'Registro Corrompido', respostas: '1111' }), { status: 'em_analise', observacoes: '', recebidoEm: '2026-10-01T10:00:00.000Z' })
    ];
    const chamadas = await simularApi(page, (corpo) => {
      if (corpo.acao === 'login') {
        if (corpo.email === 'ana@empresa.com' && corpo.senha === 'senha-certa-1') {
          return { ok: true, token: TOKEN, usuario: { id: 'u1', nome: 'Ana Admin', email: 'ana@empresa.com', papel: 'admin', empresaId: '', empresaNome: '' } };
        }
        return { ok: false, erro: 'E-mail ou senha incorretos.' };
      }
      if (corpo.token !== TOKEN) return { ok: false, erro: 'Sessão expirada. Entre de novo.', sessaoExpirada: true };
      if (corpo.acao === 'listar') return { ok: true, itens };
      if (corpo.acao === 'avaliacoes.listar') return { ok: true, avaliacoes: [{ id: 'a1', codigo: 'AB23', empresaId: 'emp1', empresaNome: 'Loja Modelo', nome: 'Vendedor 2026', tipo: 'selecao', mostrarResultado: false, ativa: true, respostas: 1 }] };
      if (corpo.acao === 'empresas.listar') return { ok: true, empresas: [{ id: 'emp1', nome: 'Loja Modelo' }] };
      if (corpo.acao === 'usuarios.listar') return { ok: true, usuarios: [{ id: 'u1', nome: 'Ana Admin', email: 'ana@empresa.com', papel: 'admin', empresaId: '', empresaNome: '', ativo: true }] };
      if (corpo.acao === 'sair') return { ok: true };
      if (corpo.acao === 'atualizar') {
        const it = itens.find((i) => i.id === corpo.id);
        if (!it) return { ok: false, erro: 'Participante não encontrado.' };
        Object.assign(it, corpo.campos);
        return { ok: true, id: corpo.id };
      }
      return { ok: false, erro: 'Ação inesperada no teste: ' + corpo.acao };
    });

    await page.goto('/admin.html');
    await expect(page.locator('#tela-login')).toBeVisible();
    await expect(page.locator('#dica-previa')).toBeHidden();
    await expect(page.locator('#usuario-area')).toBeHidden();

    await page.fill('#campo-email', 'ana@empresa.com');
    await page.fill('#campo-senha', 'errada');
    await page.click('#btn-entrar');
    await expect(page.locator('#erro-login')).toHaveText('E-mail ou senha incorretos.');
    await expect(page.locator('#tela-painel')).toBeHidden();

    await entrar(page, 'ana@empresa.com', 'senha-certa-1');
    await expect(page.locator('#lista-candidatos > li')).toHaveCount(3);
    expect(await page.evaluate(() => sessionStorage.getItem('disc_admin_token'))).toBe(TOKEN);
    expect(await page.evaluate(() => JSON.stringify(sessionStorage))).not.toContain('senha-certa-1');
    await expect(page.locator('#usuario-nome')).toHaveText('Ana Admin');
    expect(await abasVisiveis(page)).toEqual(['lista', 'avaliacoes', 'empresas', 'usuarios', 'comparativo', 'importar']);

    // Card mostra avaliação e empresa; o perfil é recalculado das respostas (2143 -> SC), ignorando resultado.codigo
    await expect(page.locator('#lista-candidatos > li', { hasText: 'Rafael' }).locator('.card-origem')).toHaveText('Vendedor 2026 · Loja Modelo');
    await expect(page.locator('#lista-candidatos > li', { hasText: 'Beatriz' }).locator('.card-origem')).toHaveText('Link geral');
    await expect(page.locator('#lista-candidatos > li', { hasText: 'Registro Corrompido' }).locator('.status')).toHaveText('Inválido');
    await expect(page.locator('#lista-candidatos > li', { hasText: 'Beatriz Santos' }).locator('.badge')).toHaveText('SC');
    // Sem etapa de confirmação (envio antigo): sem selo de confiabilidade
    await expect(page.locator('#lista-candidatos .conf-selo')).toHaveCount(0);

    // Protocolo em cada card e busca por protocolo (ignora maiúsculas/espaços)
    await expect(page.locator('#lista-candidatos > li', { hasText: 'Rafael' }).locator('.protocolo__valor')).toHaveText('47K');
    await expect(page.locator('#lista-candidatos > li', { hasText: 'Registro Corrompido' }).locator('.protocolo__valor')).toHaveText('—');
    await page.fill('#filtro-busca', '47 k');
    await expect(page.locator('#lista-candidatos > li')).toHaveCount(1);
    await expect(page.locator('#lista-candidatos > li')).toContainText('Rafael Moreira Lima');
    await page.fill('#filtro-busca', '');

    // Card: "Função · Empresa" discreto e NUNCA a idade (só no detalhe — Lei 9.029/95)
    const cardRafael = page.locator('#lista-candidatos > li', { hasText: 'Rafael' });
    await expect(cardRafael.locator('.card-experiencia')).toHaveText('Supervisor de vendas · Loja Centro');
    expect(await cardRafael.innerText()).not.toMatch(/\b34\b/);
    await expect(page.locator('#vista-lista')).not.toContainText('Idade');
    await page.fill('#filtro-busca', '34');
    await expect(page.locator('#lista-candidatos > li')).toHaveCount(0);
    await page.fill('#filtro-busca', '');

    // Filtros em pílula: empresa, avaliação e status
    await escolher(page, '#filtro-empresa', 'emp1');
    await expect(page.locator('#lista-candidatos > li')).toHaveCount(1);
    await escolher(page, '#filtro-empresa', '');
    await escolher(page, '#filtro-avaliacao', '-');
    await expect(page.locator('#lista-candidatos > li')).toHaveCount(2);
    await escolher(page, '#filtro-avaliacao', '');
    await escolher(page, '#filtro-status', 'reprovado');
    await expect(page.locator('#lista-candidatos > li')).toHaveCount(1);
    await escolher(page, '#filtro-status', '');

    // Detalhe e aprovação
    await cardRafael.getByRole('button', { name: /Ver detalhes/ }).click();
    await expect(page.locator('#vista-detalhe h2')).toHaveText('Rafael Moreira Lima');
    await expect(page.locator('#det-protocolo')).toHaveText('Código 47K');
    await expect(page.locator('#det-idade')).toHaveText('34 anos');
    await expect(page.locator('#det-avaliacao')).toHaveText('Vendedor 2026 · Loja Modelo');
    await expect(page.locator('#det-conf-nivel')).toHaveText('Sem dados');
    await expect(page.locator('#det-confirmacao')).toHaveCount(0);
    await expect(page.locator('#vista-detalhe section.guia')).toContainText('Rafael');
    await escolher(page, '#det-status', 'aprovado');
    await expect(page.locator('#aviso-geral')).toContainText('Aprovado');
    await page.fill('#det-obs', 'Ótima comunicação.');
    await page.getByRole('button', { name: 'Salvar observações' }).click();
    await expect(page.locator('#aviso-geral')).toContainText('Observações salvas');

    const atualizacoes = chamadas.filter((c) => c.corpo.acao === 'atualizar').map((c) => c.corpo);
    expect(atualizacoes).toEqual([
      { acao: 'atualizar', token: TOKEN, id: 'api-item-001', campos: { status: 'aprovado' } },
      { acao: 'atualizar', token: TOKEN, id: 'api-item-001', campos: { observacoes: 'Ótima comunicação.' } }
    ]);
    chamadas.forEach((c) => expect(c.headers['content-type']).toContain('text/plain'));
    chamadas.filter((c) => c.corpo.acao !== 'login').forEach((c) => expect(c.corpo.token).toBe(TOKEN));

    // Comparativo dos aprovados
    await page.locator('.aba[data-aba="comparativo"]').click();
    await expect(page.locator('#vista-comparativo')).toContainText('1 aprovado.');
    await expect(page.locator('#vista-comparativo')).toContainText('Rafael Moreira Lima');

    // Exportar CSV
    await page.locator('.aba[data-aba="lista"]').click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#btn-csv')]);
    expect(download.suggestedFilename()).toMatch(/^participantes-disc-\d{4}-\d{2}-\d{2}\.csv$/);
    const csv = fs.readFileSync(await download.path(), 'utf8');
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const linhas = csv.slice(1).trim().split(/\r\n/);
    expect(linhas.length).toBe(4);
    expect(linhas[0]).toContain(';vaga;idade;funcao;empresa;');
    const rafael = linhas.find((l) => l.indexOf('Rafael Moreira Lima') !== -1);
    expect(rafael).toContain('Aprovado');
    expect(rafael).toContain('Ótima comunicação.');
    expect(rafael).toContain(';47K;');
    expect(rafael).toContain(';Supervisora;34;Supervisor de vendas;Loja Centro;');
    expect(rafael).toContain(';Vendedor 2026;Loja Modelo;Sem dados');

    // Sair (menu do usuário) limpa a sessão e avisa o servidor
    await sairDoPainel(page);
    expect(await page.evaluate(() => sessionStorage.getItem('disc_admin_token'))).toBeNull();
    await expect.poll(() => chamadas.filter((c) => c.corpo.acao === 'sair').length).toBe(1);

    expect(erros).toEqual([]);
  });

  test('código de resultado importado (só admin) é enviado à planilha', async ({ page }) => {
    const erros = coletarErros(page);
    const TOKEN = 'token-e2e-456';
    await configurar(page, { API_URL: API_FALSA });
    const itens = [];
    const chamadas = await simularApi(page, (corpo) => {
      if (corpo.acao === 'login') return { ok: true, token: TOKEN, usuario: { id: 'u1', nome: 'Ana Admin', email: corpo.email, papel: 'admin', empresaId: '', empresaNome: '' } };
      if (corpo.acao === 'enviar') {
        if (itens.find((i) => i.id === corpo.payload.id)) return { ok: true, duplicado: true, id: corpo.payload.id };
        itens.push(Object.assign({}, corpo.payload, { status: 'em_analise', observacoes: '', recebidoEm: '2026-10-04T10:00:00.000Z' }));
        return { ok: true, id: corpo.payload.id };
      }
      if (corpo.token !== TOKEN) return { ok: false, erro: 'Sessão expirada. Entre de novo.', sessaoExpirada: true };
      if (corpo.acao === 'listar') return { ok: true, itens };
      if (corpo.acao === 'avaliacoes.listar') return { ok: true, avaliacoes: [] };
      if (corpo.acao === 'empresas.listar') return { ok: true, empresas: [] };
      if (corpo.acao === 'usuarios.listar') return { ok: true, usuarios: [] };
      return { ok: false, erro: 'Ação inesperada no teste.' };
    });
    await page.goto('/admin.html');
    await entrar(page, 'ana@empresa.com', 'qualquer-senha');
    await expect(page.locator('#contagem')).toHaveText('Nenhuma resposta recebida ainda.');
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
});

test.describe('Admin na prévia (API_URL "simulada")', () => {
  test('dados de exemplo, protocolo gerado e busca por código', async ({ page }) => {
    const erros = coletarErros(page);
    await configurar(page, { API_URL: 'simulada' });
    const pedidosExternos = [];
    page.on('request', (req) => { if (!req.url().startsWith('http://localhost')) pedidosExternos.push(req.url()); });
    await page.goto('/admin.html');
    await expect(page.locator('#tela-login')).toBeVisible();
    await expect(page.locator('#dica-previa')).toBeVisible();
    await expect(page.locator('#dica-previa')).toHaveText('Prévia: admin@previa.com ou gestor@previa.com, senha previa123');
    await expect(page.locator('#modo-indicador')).toHaveText('Prévia (dados de demonstração)');

    await page.fill('#campo-email', 'admin@previa.com');
    await page.fill('#campo-senha', 'errada123');
    await page.click('#btn-entrar');
    await expect(page.locator('#erro-login')).toHaveText('E-mail ou senha incorretos.');
    await entrar(page, 'admin@previa.com', 'previa123');
    await expect(page.locator('#lista-candidatos > li')).toHaveCount(4);
    await expect(page.locator('#usuario-nome')).toHaveText('Você (admin)');

    // Envio "do participante" pela API simulada: o servidor falso devolve o protocolo
    const r1 = await page.evaluate((p) => window.DISC_API.enviar(p), payload({ id: 'previa-envio-01', nome: 'Paula Mendes Rocha', idade: 28 }));
    expect(r1.protocolo).toMatch(/^[0-9]{2}[A-HJ-NP-Z]$/);
    const r2 = await page.evaluate((p) => window.DISC_API.enviar(p), payload({ id: 'previa-envio-01', nome: 'Paula Mendes Rocha', idade: 28 }));
    expect(r2).toEqual({ ok: true, duplicado: true, id: 'previa-envio-01', protocolo: r1.protocolo });

    // Código importado na aba "Importar códigos" também ganha protocolo; código sem idade é recusado pelo servidor
    await page.locator('#aba-importar').click();
    const antigoSemIdade = await gerarCodigo(page, payload({ id: 'previa-antigo-3', nome: 'Rui Antigo Melo' }));
    await page.fill('#campo-codigos', await gerarCodigo(page, payload({ id: 'previa-import-2', nome: 'Otávio Prado Lins', idade: 61, respostas: '1234'.repeat(25) })) + '\n' + antigoSemIdade);
    await page.click('#btn-importar');
    await expect(page.locator('#resultado-importacao')).toContainText('1 importado');
    await expect(page.locator('#resultado-importacao')).toContainText('Idade não informada');

    await page.locator('.aba[data-aba="lista"]').click();
    await expect(page.locator('#lista-candidatos > li')).toHaveCount(6);
    const paula = page.locator('#lista-candidatos > li', { hasText: 'Paula Mendes Rocha' });
    await expect(paula.locator('.protocolo__valor')).toHaveText(r1.protocolo);

    const busca = r1.protocolo.slice(0, 2) + ' ' + r1.protocolo.slice(2).toLowerCase();
    await page.fill('#filtro-busca', busca);
    await expect(page.locator('#lista-candidatos > li')).toHaveCount(1);
    // Com a busca preenchida, "Ver detalhes" abre o detalhe (o blur da busca não pode recriar a lista no meio do clique)
    await page.locator('#lista-candidatos > li').getByRole('button', { name: /Ver detalhes/ }).click();
    await expect(page.locator('#vista-detalhe')).toContainText(r1.protocolo);
    await page.keyboard.press('Escape');
    await expect(page.locator('#vista-lista')).toBeVisible();
    await page.fill('#filtro-busca', '');

    // Recarregar mantém a sessão (sessionStorage) e os dados (localStorage 'disc_planilha_simulada')
    await page.reload();
    await expect(page.locator('#lista-candidatos > li')).toHaveCount(6);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('disc_planilha_simulada')).length)).toBe(6);
    expect(pedidosExternos).toEqual([]);
    expect(erros).toEqual([]);
  });

  test('admin cria empresa, avaliação e gestor, copia o link; o gestor vê só a própria empresa', async ({ page, context }) => {
    const erros = coletarErros(page);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await configurar(page, { API_URL: 'simulada' });
    await page.goto('/admin.html');
    await entrar(page, 'admin@previa.com', 'previa123');

    // Empresa
    await page.locator('.aba[data-aba="empresas"]').click();
    await page.fill('#empresa-nova', 'Padaria Teste E2E');
    await page.click('#btn-adicionar-empresa');
    await expect(page.locator('#lista-empresas')).toContainText('Padaria Teste E2E');

    // Avaliação (janela com seletor em pílula)
    await page.locator('.aba[data-aba="avaliacoes"]').click();
    await page.click('#btn-nova-avaliacao');
    await expect(page.locator('#janela-avaliacao')).toBeVisible();
    await page.click('#av-empresa');
    await page.locator('#av-empresa-lista [role="option"]', { hasText: 'Padaria Teste E2E' }).click();
    await page.fill('#av-nome', 'Atendente 2027');
    await expect(page.locator('#av-tipo')).toHaveAttribute('value', 'selecao');
    await page.click('#janela-ok');
    await expect(page.locator('#janela')).toHaveCount(0);
    const card = page.locator('.av-card', { hasText: 'Atendente 2027' });
    await expect(card).toContainText('Padaria Teste E2E · 0 respostas');
    const codigo = (await card.locator('.av-codigo').innerText()).trim();
    expect(codigo).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/);
    const link = 'http://localhost:4173/index.html?a=' + codigo;
    await expect(card.locator('.av-link')).toHaveText(link);
    await card.locator('[data-acao="copiar-link"]').click();
    await expect(page.locator('#aviso-geral')).toHaveText('Link copiado.');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
    await card.locator('[data-acao="copiar-mensagem"]').click();
    await expect(page.locator('#aviso-geral')).toContainText('Mensagem copiada');
    const msg = await page.evaluate(() => navigator.clipboard.readText());
    expect(msg).toContain(link);
    expect(msg).toContain('Padaria Teste E2E');
    // Sem respostas: pode excluir; o card das avaliações com respostas oferece desativar
    await expect(card.locator('[data-acao="excluir"]')).toHaveCount(1);
    await expect(page.locator('.av-card', { hasText: 'Recepcionista 2026' }).locator('[data-acao="excluir"]')).toHaveCount(0);
    await expect(page.locator('.av-card', { hasText: 'Recepcionista 2026' }).locator('[data-acao="alternar-ativa"]')).toHaveText('Desativar');

    // Uma resposta chega pelo link novo
    await page.evaluate((p) => window.DISC_API.enviar(p), payload({ id: 'e2e-padaria-01', nome: 'Marcos Padaria Teste', idade: 25, avaliacao: codigo }));

    // Gestor da padaria
    await page.locator('.aba[data-aba="usuarios"]').click();
    await page.click('#btn-novo-usuario');
    await page.fill('#us-nome', 'Gestora Padaria');
    await page.fill('#us-email', 'gestora@padaria.com');
    await expect(page.locator('#us-papel')).toHaveAttribute('value', 'gestor');
    await page.click('#us-empresa');
    await page.locator('#us-empresa-lista [role="option"]', { hasText: 'Padaria Teste E2E' }).click();
    await page.click('#us-senha-gerar');
    const senha = await page.inputValue('#us-senha');
    expect(senha).toMatch(/^[a-hjkmnp-z2-9]{10}$/);
    await page.click('#janela-ok');
    await expect(page.locator('#janela')).toHaveCount(0);
    await expect(page.locator('#lista-usuarios [data-email="gestora@padaria.com"]')).toContainText('Padaria Teste E2E');

    // Admin vê as 5 respostas e filtra por avaliação
    await page.locator('.aba[data-aba="lista"]').click();
    await expect(page.locator('#lista-candidatos > li')).toHaveCount(5);
    await escolher(page, '#filtro-avaliacao', codigo);
    await expect(page.locator('#lista-candidatos > li')).toHaveCount(1);
    await expect(page.locator('#lista-candidatos > li .card-origem')).toHaveText('Atendente 2027 · Padaria Teste E2E');
    await escolher(page, '#filtro-avaliacao', '');

    // Nova gestora: só a padaria, sem excluir nem criar
    await sairDoPainel(page);
    await entrar(page, 'gestora@padaria.com', senha);
    expect(await abasVisiveis(page)).toEqual(['lista', 'comparativo']);
    await expect(page.locator('#lista-candidatos > li')).toHaveCount(1);
    await expect(page.locator('#lista-candidatos > li')).toContainText('Marcos Padaria Teste');

    // Gestor da Clínica Exemplo não vê a resposta da padaria
    await sairDoPainel(page);
    await entrar(page, 'gestor@previa.com', 'previa123');
    await expect(page.locator('#lista-candidatos > li')).toHaveCount(4);
    await expect(page.locator('#vista-lista')).not.toContainText('Marcos Padaria Teste');

    // Admin exclui as respostas só daquela avaliação, digitando EXCLUIR
    await sairDoPainel(page);
    await entrar(page, 'admin@previa.com', 'previa123');
    await page.click('#btn-excluir-todos');
    await page.click('#excluir-avaliacao');
    await page.locator('#excluir-avaliacao-lista [role="option"][data-valor="' + codigo + '"]').click();
    await expect(page.locator('#confirmar-ok')).toBeDisabled();
    await page.fill('#confirmar-texto', 'EXCLUIR');
    await page.click('#confirmar-ok');
    await expect(page.locator('#confirmar')).toHaveCount(0);
    await expect(page.locator('#lista-candidatos > li')).toHaveCount(4);
    await expect(page.locator('#vista-lista')).not.toContainText('Marcos Padaria Teste');
    expect(erros).toEqual([]);
  });

  test('gestor: só participantes e comparativo, muda status mas não exclui', async ({ page }) => {
    const erros = coletarErros(page);
    await configurar(page, { API_URL: 'simulada' });
    await page.goto('/admin.html');
    await entrar(page, 'gestor@previa.com', 'previa123');
    expect(await abasVisiveis(page)).toEqual(['lista', 'comparativo']);
    await expect(page.locator('#btn-excluir-todos')).toBeHidden();
    await expect(page.locator('#filtro-empresa')).toHaveCount(0);
    await expect(page.locator('#filtro-avaliacao')).toBeVisible();
    await expect(page.locator('#sobretitulo-lista')).toHaveText('Clínica Exemplo');
    await page.click('#btn-usuario');
    await expect(page.locator('#menu-papel')).toHaveText('Gestor · Clínica Exemplo');
    await page.keyboard.press('Escape');
    await expect(page.locator('#menu-usuario')).toBeHidden();

    const card = page.locator('#lista-candidatos > li', { hasText: 'Carla Modelo Demonstração' });
    await card.getByRole('button', { name: /Ver detalhes/ }).click();
    await expect(page.locator('#vista-detalhe h2')).toHaveText('Carla Modelo Demonstração');
    // Avaliação de equipe: sem vaga nem empresa anterior; "Cargo/função"
    await expect(page.locator('#vista-detalhe .sobretitulo').first()).toHaveText('Avaliação de equipe · Colaborador');
    await expect(page.locator('#det-empresa')).toHaveCount(0);
    await expect(page.locator('#vista-detalhe')).toContainText('Cargo/função');
    await expect(page.locator('#btn-excluir-participante')).toHaveCount(0);
    await escolher(page, '#det-status', 'aprovado');
    await expect(page.locator('#aviso-geral')).toContainText('Aprovado');
    // O servidor também recusa a exclusão para o gestor
    const recusa = await page.evaluate(() => window.DISC_API.excluir(sessionStorage.getItem('disc_admin_token'), 'previa-exemplo-03').then(() => 'ok', (e) => e.message));
    expect(recusa).toBe('Sem permissão.');
    expect(erros).toEqual([]);
  });

  test('sessão expirada volta ao login com aviso; primeiro acesso cria um admin', async ({ page }) => {
    const erros = coletarErros(page);
    await configurar(page, { API_URL: 'simulada' });
    await page.goto('/admin.html');
    await entrar(page, 'admin@previa.com', 'previa123');
    await expect(page.locator('#aviso-sessao')).toBeHidden();
    // O "servidor" esquece as sessões (como o cache de 6 h expirando)
    await page.evaluate(() => localStorage.setItem('disc_simulada_sessoes', '{}'));
    await page.click('#btn-atualizar');
    await expect(page.locator('#form-login')).toBeVisible();
    await expect(page.locator('#aviso-sessao')).toBeVisible();
    await expect(page.locator('#aviso-sessao')).toHaveText('Sua sessão expirou. Entre de novo.');
    await expect(page.locator('#tela-painel')).toBeHidden();
    expect(await page.evaluate(() => sessionStorage.getItem('disc_admin_token'))).toBeNull();
    await expect(page.locator('#aviso-geral')).toBeHidden();

    // Primeiro acesso: chave + nome + e-mail + senha + confirmar
    await page.click('#btn-ir-primeiro');
    await expect(page.locator('#form-primeiro')).toBeVisible();
    await expect(page.locator('#dica-previa-chave')).toBeVisible();
    await page.fill('#pa-chave', 'errada');
    await page.fill('#pa-nome', 'Nova Administradora');
    await page.fill('#pa-email', 'nova@previa.com');
    await page.fill('#pa-senha', 'senha-nova-1');
    await page.fill('#pa-confirmar', 'senha-diferente');
    await page.click('#btn-criar-acesso');
    await expect(page.locator('#erro-primeiro')).toHaveText('As duas senhas não são iguais.');
    await page.fill('#pa-confirmar', 'senha-nova-1');
    await page.click('#btn-criar-acesso');
    await expect(page.locator('#erro-primeiro')).toHaveText('Chave de primeiro acesso inválida.');
    await page.fill('#pa-chave', 'previa');
    await page.click('#btn-criar-acesso');
    await expect(page.locator('#tela-painel')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#usuario-nome')).toHaveText('Nova Administradora');
    await expect(page.locator('.aba[data-aba="usuarios"]')).toBeVisible();

    // Trocar senha pelo menu do usuário
    await page.click('#btn-usuario');
    await page.click('#btn-trocar-senha');
    await page.fill('#ts-atual', 'senha-nova-1');
    await page.fill('#ts-nova', 'outra-senha-2');
    await page.fill('#ts-confirmar', 'outra-senha-2');
    await page.click('#janela-ok');
    await expect(page.locator('#aviso-geral')).toHaveText('Senha trocada.');
    await sairDoPainel(page);
    await entrar(page, 'nova@previa.com', 'outra-senha-2');
    expect(erros).toEqual([]);
  });

  test('detalhe mostra a confiabilidade, as respostas da confirmação e o aviso no guia quando é baixa', async ({ page }) => {
    const erros = coletarErros(page);
    await configurar(page, { API_URL: 'simulada' });
    await page.goto('/admin.html');
    await entrar(page, 'admin@previa.com', 'previa123');

    const bruno = page.locator('#lista-candidatos > li', { hasText: 'Bruno Teste Fictício' });
    await expect(bruno.locator('.conf-selo')).toHaveText('Confiabilidade baixa');
    await expect(bruno.locator('.conf-selo')).toHaveClass(/selo--vermelho/);
    await expect(page.locator('#lista-candidatos > li', { hasText: 'Ana Exemplo Prévia' }).locator('.conf-selo')).toHaveClass(/selo--verde/);
    await expect(page.locator('#resumo-lista')).toContainText('Confiabilidade baixa');

    await bruno.getByRole('button', { name: /Ver detalhes/ }).click();
    await expect(page.locator('#det-confiabilidade')).toBeVisible();
    await expect(page.locator('#det-conf-nivel')).toHaveText('Baixa');
    await expect(page.locator('#det-conf-pontos')).toHaveText(/^\d{1,3}$/);
    expect(await page.locator('#det-conf-motivos li').count()).toBeGreaterThan(0);
    await expect(page.locator('#det-conf-motivos')).toContainText('menos de 3 segundos');
    await expect(page.locator('#det-confirmacao .conf-retrato')).toHaveCount(3);
    await expect(page.locator('#det-confirmacao .conf-frase')).toHaveCount(4);
    await expect(page.locator('#det-confirmacao')).toContainText('Não combina');
    await expect(page.locator('#det-confirmacao')).toContainText('Dominância');
    const aviso = page.locator('section.guia #aviso-guia-confiabilidade');
    await expect(aviso).toHaveText('Atenção: a confiabilidade deste resultado é baixa. Use o guia com cautela e confirme em entrevista.');
    // O aviso fica no topo do guia
    expect(await page.locator('section.guia > *').first().getAttribute('id')).toBe('aviso-guia-confiabilidade');
    await page.keyboard.press('Escape');

    await page.locator('#lista-candidatos > li', { hasText: 'Ana Exemplo Prévia' }).getByRole('button', { name: /Ver detalhes/ }).click();
    await expect(page.locator('#det-conf-nivel')).toHaveText('Alta');
    await expect(page.locator('#aviso-guia-confiabilidade')).toHaveCount(0);
    await expect(page.locator('#det-confirmacao')).toContainText('Combina');
    expect(erros).toEqual([]);
  });
});
