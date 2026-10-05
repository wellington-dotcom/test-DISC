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
      if (corpo.acao === 'processos.listar') return { ok: true, processos: [{ id: 'a1', codigo: 'AB23', empresa: 'Loja Modelo', nome: 'Vendedor 2026', tipo: 'selecao', mostrarResultado: false, ativa: true, respostas: 1, config: {} }] };
      if (corpo.acao === 'clickup.status') return { ok: true, configurado: false, iaConfigurada: false };
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
    expect(await abasVisiveis(page)).toEqual(['lista', 'processos', 'usuarios', 'comparativo', 'importar']);
    await expect(page.locator('.aba[data-aba="processos"]')).toHaveText('Processos');

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

    // Filtros em pílula: processo e status (sem filtro de empresa)
    await expect(page.locator('#filtro-empresa')).toHaveCount(0);
    await escolher(page, '#filtro-processo', 'AB23');
    await expect(page.locator('#lista-candidatos > li')).toHaveCount(1);
    await escolher(page, '#filtro-processo', '-');
    await expect(page.locator('#lista-candidatos > li')).toHaveCount(2);
    await escolher(page, '#filtro-processo', '');
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
      if (corpo.acao === 'processos.listar') return { ok: true, processos: [] };
      if (corpo.acao === 'clickup.status') return { ok: false, erro: 'Falha temporária.' };
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

  test('processos: cria com config e lista do ClickUp, gera rascunho, edita, publica e o link público abre', async ({ page, context }) => {
    const erros = coletarErros(page);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const TOKEN = 'token-e2e-proc';
    const REL = 'relTokenE2E' + 'x'.repeat(30);
    const motor = require('../../js/relatorio-motor.js');
    const dadosExemplo = JSON.parse(fs.readFileSync(require('node:path').join(__dirname, '..', 'fixtures', 'processo-exemplo.json'), 'utf8'));
    const processos = [];
    const relatorios = {};
    const servidor = (corpo) => {
      if (corpo.acao === 'login') {
        const papel = corpo.email === 'gestor@empresa.com' ? 'gestor' : 'admin';
        return { ok: true, token: TOKEN + papel, usuario: { id: 'u-' + papel, nome: 'Pessoa ' + papel, email: corpo.email, papel, empresaId: '', empresaNome: '' } };
      }
      if (corpo.acao === 'relatorioPublico') {
        const r = relatorios[corpo.token];
        return r && r.status === 'publicado' ? { ok: true, relatorio: r.relatorio } : { ok: false, erro: 'Relatório não encontrado ou fora do ar.' };
      }
      if (corpo.acao === 'sair') return { ok: true };
      if (corpo.token !== TOKEN + 'admin') return { ok: false, erro: 'Sessão expirada. Entre de novo.', sessaoExpirada: true };
      switch (corpo.acao) {
        case 'listar': return { ok: true, itens: [] };
        case 'usuarios.listar': return { ok: true, usuarios: [
          { id: 'u-admin', nome: 'Pessoa admin', email: 'ana@empresa.com', papel: 'admin', ativo: true },
          { id: 'u-g', nome: 'Gestor Antigo', email: 'gestor@empresa.com', papel: 'gestor', empresaId: 'e1', empresaNome: 'Loja', ativo: true }] };
        case 'processos.listar': return { ok: true, processos };
        case 'clickup.status': return { ok: true, configurado: true, conectado: true, usuario: 'notus', iaConfigurada: true, avisos: [] };
        case 'clickup.listas': return { ok: true, listas: [{ id: '900000000001', nome: 'Escrevente 2026', pasta: 'Cartório' }, { id: '900000000002', nome: 'Recepção', pasta: 'Clínica' }] };
        case 'processos.salvar': {
          const p = Object.assign({ id: 'proc-' + (processos.length + 1), codigo: 'K7QZ', respostas: 0 }, corpo.processo);
          processos.push(p);
          return { ok: true, processo: p };
        }
        case 'relatorio.rascunho': {
          const rel = motor.montar(JSON.parse(JSON.stringify(dadosExemplo)));
          relatorios[REL] = { processoId: corpo.processoId, status: 'rascunho', relatorio: rel, criadoEm: '2026-10-05T12:00:00.000Z' };
          return { ok: true, relatorio: rel, token: REL, avisos: ['Campo "Bloco A" não encontrado na lista'] };
        }
        case 'relatorio.salvar': {
          const r = relatorios[corpo.relatorioToken];
          Object.keys(corpo.relatorio.textos || {}).forEach((id) => {
            if (r.relatorio.textos[id] && r.relatorio.textos[id].texto !== corpo.relatorio.textos[id].texto) r.relatorio.textos[id] = { texto: corpo.relatorio.textos[id].texto, origem: 'editado' };
          });
          return { ok: true, relatorio: r.relatorio };
        }
        case 'relatorio.melhorarTextos': return { ok: false, erro: 'Não foi possível melhorar os textos: limite de uso.' };
        case 'relatorio.publicar': relatorios[corpo.relatorioToken].status = 'publicado'; return { ok: true, url: 'relatorio.html?r=' + corpo.relatorioToken };
        case 'relatorio.despublicar': relatorios[corpo.relatorioToken].status = 'rascunho'; return { ok: true };
        case 'relatorios.listar': return { ok: true, relatorios: Object.keys(relatorios).map((t) => ({ token: t, processoId: relatorios[t].processoId, status: relatorios[t].status, criadoEm: relatorios[t].criadoEm })) };
        default: return { ok: false, erro: 'Ação inesperada no teste: ' + corpo.acao };
      }
    };
    await configurar(page, { API_URL: API_FALSA });
    const chamadas = await simularApi(page, servidor);
    await page.goto('/admin.html');

    // Gestor (desativado nesta versão) não entra
    await page.fill('#campo-email', 'gestor@empresa.com');
    await page.fill('#campo-senha', 'senha-do-gestor');
    await page.click('#btn-entrar');
    await expect(page.locator('#erro-login')).toHaveText('Este painel é só para administradores. O acesso de gestor foi desativado nesta versão.');
    await expect(page.locator('#tela-painel')).toBeHidden();
    await expect.poll(() => chamadas.filter((c) => c.corpo.acao === 'sair').length).toBe(1);

    await entrar(page, 'ana@empresa.com', 'senha-certa-1');
    // Usuários: só administrador; gestor antigo aparece como desativado
    await page.locator('.aba[data-aba="usuarios"]').click();
    await expect(page.locator('#lista-usuarios [data-email="gestor@empresa.com"]')).toContainText('gestor (desativado nesta versão)');
    await page.click('#btn-novo-usuario');
    await expect(page.locator('#us-papel')).toHaveCount(0);
    await page.click('#janela-cancelar');

    // Novo processo com config
    await page.locator('.aba[data-aba="processos"]').click();
    await page.click('#btn-novo-processo');
    await page.fill('#proc-nome', 'Escrevente 2026');
    await page.fill('#proc-empresa', 'Cartório Exemplo');
    await page.fill('#proc-vaga', 'Escrevente de atendimento');
    await page.fill('#proc-cidade', 'Boa Vista / RR');
    await page.fill('#proc-consultor', 'Paulo Lima');
    await page.fill('#proc-contratante', 'Marina Souza');
    await page.fill('#proc-inicio', '2026-08-03');
    await page.fill('#proc-fim', '2026-10-02');
    await escolher(page, '#proc-lista', '900000000001');
    await page.click('#proc-perfil-C');
    await page.click('#proc-perfil-D');
    await expect(page.locator('#proc-perfil-codigo')).toHaveText('CD');
    await expect(page.locator('#proc-perfil-explicacao')).toHaveText('C (Conformidade) como traço principal e D (Dominância) como segundo traço.');
    await page.fill('#proc-explicacao', 'Rigor na conferência e firmeza no balcão.');
    await page.click('#btn-add-etapa');
    await page.fill('#etapa-nome-0', 'Revisão documental');
    await page.fill('#etapa-peso-0', '30');
    await page.fill('#etapa-campo-0', 'Nota Revisão documental');
    await page.click('#btn-add-etapa');
    await page.fill('#etapa-nome-1', 'Digitação');
    await page.fill('#etapa-peso-1', '10');
    await page.fill('#etapa-campo-1', 'Estado civil');
    await expect(page.locator('#proc-etapas [data-peso-pct]').first()).toHaveText('75% do total');
    await page.click('#btn-add-bonus');
    await page.fill('#bonus-nome-0', 'Perfil presencial');
    await page.fill('#bonus-campo-0', 'Perfil presencial');
    await escolher(page, '#bonus-tipo-0', 'mapa');
    await page.fill('#bonus-0-valor-0', '4');
    await page.fill('#bonus-0-pontos-0', '10');
    await page.click('#bonus-0-add-valor');
    await page.fill('#bonus-0-valor-1', '5');
    await page.fill('#bonus-0-pontos-1', '15');
    await page.fill('#proc-corte', '70');
    await page.fill('#proc-faixa', '55');
    await page.fill('#proc-finalistas', 'finalista, aprovado');
    // Campo sensível é recusado na tela
    await page.click('#btn-salvar-processo');
    await expect(page.locator('#proc-erro')).toHaveText('O campo "Estado civil" é um dado sensível e não pode ser usado.');
    await page.fill('#etapa-campo-1', 'Nota Digitação');
    await page.click('#btn-salvar-processo');
    await expect(page.locator('#aviso-geral')).toContainText('Processo criado. Código K7QZ');
    const salvo = chamadas.find((c) => c.corpo.acao === 'processos.salvar').corpo.processo;
    expect(salvo).toMatchObject({
      nome: 'Escrevente 2026', empresa: 'Cartório Exemplo', vaga: 'Escrevente de atendimento', cidade: 'Boa Vista / RR',
      consultor: 'Paulo Lima', contratante: 'Marina Souza', periodo: { inicio: '2026-08-03', fim: '2026-10-02' }, clickupListId: '900000000001', ativa: true
    });
    expect(salvo.config).toEqual({
      perfilIdeal: 'CD', explicacaoPerfil: 'Rigor na conferência e firmeza no balcão.',
      etapas: [
        { id: 'revisao_documental', nome: 'Revisão documental', peso: 30, campo: 'Nota Revisão documental', descricao: '' },
        { id: 'digitacao', nome: 'Digitação', peso: 10, campo: 'Nota Digitação', descricao: '' }
      ],
      bonus: [{ id: 'perfil_presencial', nome: 'Perfil presencial', campo: 'Perfil presencial', regra: { tipo: 'mapa', pontos: { 4: 10, 5: 15 } } }],
      corte: 70, faixaAvaliar: 55, statusFinalistas: ['finalista', 'aprovado'], permitirAntecedentes: false
    });

    // Página do processo: link do teste e geração do rascunho
    await expect(page.locator('#vista-processos h2')).toHaveText('Escrevente 2026');
    await expect(page.locator('#proc-link')).toHaveText('http://localhost:4173/index.html?a=K7QZ');
    await expect(page.locator('#proc-perfil')).toHaveText('CD');
    await page.click('#btn-gerar-rascunho');
    await expect(page.locator('#vista-processos h2')).toHaveText('Rascunho do relatório');
    await expect(page.locator('#editor-avisos')).toContainText('Campo "Bloco A" não encontrado na lista');

    // Editar um texto marca "Editado" e o salvar manda o relatório com o texto novo
    const ta = page.locator('textarea[data-texto-id="recomendacao"]');
    await expect(ta).toBeVisible();
    await ta.fill('Recomendamos Ana E. para a vaga: liderou a técnica e tem o perfil pedido.');
    await expect(page.locator('.texto-item[data-texto-id="recomendacao"] .texto-origem')).toHaveText('Editado');
    await page.click('#btn-salvar-rascunho');
    await expect(page.locator('#aviso-geral')).toHaveText('Rascunho salvo.');
    const salvar = chamadas.filter((c) => c.corpo.acao === 'relatorio.salvar').pop().corpo;
    expect(salvar.relatorioToken).toBe(REL);
    expect(salvar.relatorio.textos.recomendacao).toEqual({ texto: 'Recomendamos Ana E. para a vaga: liderou a técnica e tem o perfil pedido.', origem: 'editado' });

    // IA configurada: botão aparece; erro do servidor vira aviso
    await page.click('#btn-melhorar-ia');
    await expect(page.locator('#aviso-geral')).toContainText('limite de uso');
    await expect(page.locator('#btn-melhorar-ia')).toBeEnabled();

    // Pré-visualização do documento
    await page.click('#btn-ver-previa');
    const previa = page.frameLocator('#editor-previa');
    await expect(previa.locator('body')).toContainText('Recomendamos Ana E. para a vaga');
    await page.click('#btn-ver-textos');

    // Publicar: link + mensagem para o contratante
    await page.click('#btn-publicar');
    const url = 'http://localhost:4173/relatorio.html?r=' + REL;
    await expect(page.locator('#rel-link')).toHaveText(url);
    await expect(page.locator('#rel-mensagem')).toContainText('Olá, Marina! O relatório do processo seletivo de Escrevente de atendimento (Cartório Exemplo) está pronto:');
    await page.click('#btn-copiar-link-relatorio');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
    expect(chamadas.find((c) => c.corpo.acao === 'relatorio.publicar').corpo.relatorioToken).toBe(REL);

    // O link público abre o relatório (outra aba, mesmo "servidor")
    const pub = await context.newPage();
    await configurar(pub, { API_URL: API_FALSA });
    await simularApi(pub, servidor);
    await pub.goto(url);
    await expect(pub.locator('#relatorio')).toHaveAttribute('data-estado', 'pronto');
    await expect(pub.locator('#relatorio')).toContainText('Recomendamos Ana E. para a vaga');
    await pub.close();

    // Lista de relatórios na página do processo e despublicar
    await page.click('#btn-voltar-processo');
    await expect(page.locator('#lista-relatorios [data-status="publicado"]')).toHaveCount(1);
    await page.locator('#lista-relatorios [data-acao="abrir-relatorio"]').click();
    await page.click('#btn-despublicar');
    await page.click('#confirmar-ok');
    await expect(page.locator('#aviso-geral')).toContainText('Relatório despublicado');
    await expect(page.locator('#btn-publicar')).toBeVisible();
    expect(relatorios[REL].status).toBe('rascunho');
    // A pré-visualização roda num iframe sem scripts (sandbox): o aviso de bloqueio do Chromium não é erro do painel.
    expect(erros.filter((e) => !/Blocked script execution in 'about:srcdoc'/.test(e))).toEqual([]);
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
    await expect(page.locator('#dica-previa')).toHaveText('Prévia: admin@previa.com, senha previa123');
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

  test('admin cria processo, copia o link e filtra os participantes pelo processo; gestor não entra', async ({ page, context }) => {
    const erros = coletarErros(page);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await configurar(page, { API_URL: 'simulada' });
    await page.goto('/admin.html');

    // O papel gestor foi desativado nesta versão: o login dele é recusado na tela
    await page.fill('#campo-email', 'gestor@previa.com');
    await page.fill('#campo-senha', 'previa123');
    await page.click('#btn-entrar');
    await expect(page.locator('#erro-login')).toHaveText('Este painel é só para administradores. O acesso de gestor foi desativado nesta versão.');
    await expect(page.locator('#tela-painel')).toBeHidden();

    await entrar(page, 'admin@previa.com', 'previa123');
    expect(await abasVisiveis(page)).toEqual(['lista', 'processos', 'usuarios', 'comparativo', 'importar']);

    // Processo novo
    await page.locator('.aba[data-aba="processos"]').click();
    await page.click('#btn-novo-processo');
    await page.fill('#proc-nome', 'Atendente 2027');
    await page.fill('#proc-empresa', 'Padaria Teste E2E');
    await page.fill('#proc-vaga', 'Atendente');
    await page.click('#proc-perfil-I');
    await page.click('#btn-add-etapa');
    await page.fill('#etapa-nome-0', 'Entrevista');
    await page.fill('#etapa-peso-0', '10');
    await page.fill('#etapa-campo-0', 'Nota Entrevista');
    await page.click('#btn-salvar-processo');
    await expect(page.locator('#aviso-geral')).toContainText('Processo criado');
    await expect(page.locator('#vista-processos h2')).toHaveText('Atendente 2027');
    const link = (await page.locator('#proc-link').innerText()).trim();
    const codigo = link.split('?a=')[1];
    expect(codigo).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/);
    expect(link).toBe('http://localhost:4173/index.html?a=' + codigo);
    await page.locator('.proc-link-acoes [data-acao="copiar-link"]').click();
    await expect(page.locator('#aviso-geral')).toHaveText('Link copiado.');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
    await page.locator('.proc-link-acoes [data-acao="copiar-mensagem"]').click();
    await expect(page.locator('#aviso-geral')).toContainText('Mensagem copiada');
    const msg = await page.evaluate(() => navigator.clipboard.readText());
    expect(msg).toContain(link);
    expect(msg).toContain('Padaria Teste E2E');

    // Lista de processos: card com código; sem respostas pode excluir
    await page.locator('.aba[data-aba="processos"]').click();
    const card = page.locator('.proc-card', { hasText: 'Atendente 2027' });
    await expect(card.locator('.av-codigo')).toHaveText(codigo);
    await expect(card).toContainText('Padaria Teste E2E');
    await expect(card.locator('[data-acao="excluir"]')).toHaveCount(1);

    // Uma resposta chega pelo link novo; o filtro "Processo" mostra só ela
    await page.evaluate((p) => window.DISC_API.enviar(p), payload({ id: 'e2e-padaria-01', nome: 'Marcos Padaria Teste', idade: 25, avaliacao: codigo }));
    await page.locator('.aba[data-aba="lista"]').click();
    await page.click('#btn-atualizar');
    await expect(page.locator('#lista-candidatos > li', { hasText: 'Marcos Padaria Teste' })).toHaveCount(1);
    const total = await page.locator('#lista-candidatos > li').count();
    await escolher(page, '#filtro-processo', codigo);
    await expect(page.locator('#lista-candidatos > li')).toHaveCount(1);
    await expect(page.locator('#lista-candidatos > li .card-origem')).toHaveText('Atendente 2027 · Padaria Teste E2E');
    await escolher(page, '#filtro-processo', '');
    // "Ver participantes" na página do processo já aplica o filtro
    await page.locator('.aba[data-aba="processos"]').click();
    await page.locator('.proc-card', { hasText: 'Atendente 2027' }).locator('[data-acao="abrir"]').click();
    await page.click('#btn-ver-participantes');
    await expect(page.locator('#filtro-processo')).toHaveAttribute('value', codigo);
    await expect(page.locator('#lista-candidatos > li')).toHaveCount(1);
    await escolher(page, '#filtro-processo', '');

    // Exclui as respostas só daquele processo, digitando EXCLUIR
    await page.click('#btn-excluir-todos');
    await page.click('#excluir-avaliacao');
    await page.locator('#excluir-avaliacao-lista [role="option"][data-valor="' + codigo + '"]').click();
    await expect(page.locator('#confirmar-ok')).toBeDisabled();
    await page.fill('#confirmar-texto', 'EXCLUIR');
    await page.click('#confirmar-ok');
    await expect(page.locator('#confirmar')).toHaveCount(0);
    await expect(page.locator('#lista-candidatos > li')).toHaveCount(total - 1);
    await expect(page.locator('#vista-lista')).not.toContainText('Marcos Padaria Teste');
    expect(erros).toEqual([]);
  });

  test('prévia: processo de exemplo gera rascunho, edita um texto, publica e o link público abre', async ({ page, context }) => {
    const erros = coletarErros(page);
    await configurar(page, { API_URL: 'simulada' });
    await page.goto('/admin.html');
    await entrar(page, 'admin@previa.com', 'previa123');
    await page.locator('.aba[data-aba="processos"]').click();
    // O processo de exemplo da prévia é o que tem lista do ClickUp ligada
    const card = page.locator('.proc-card', { hasText: 'Lista do ClickUp ligada' }).first();
    await card.locator('[data-acao="abrir"]').click();
    await page.click('#btn-gerar-rascunho');
    await expect(page.locator('#vista-processos h2')).toHaveText('Rascunho do relatório');
    const primeiro = page.locator('#editor-textos textarea').first();
    const id = await primeiro.getAttribute('data-texto-id');
    await primeiro.fill('Texto revisado pelo consultor na prévia.');
    await expect(page.locator('.texto-item[data-texto-id="' + id + '"] .texto-origem')).toHaveText('Editado');
    await page.click('#btn-salvar-rascunho');
    await expect(page.locator('#aviso-geral')).toHaveText('Rascunho salvo.');
    await page.click('#btn-publicar');
    const link = (await page.locator('#rel-link').innerText()).trim();
    expect(link).toMatch(/relatorio\.html\?r=[A-Za-z0-9_-]{32,}$/);
    await expect(page.locator('#rel-mensagem')).toContainText(link);

    // Mesma origem (mesmo localStorage da prévia): a página pública lê o relatório publicado
    const pub = await context.newPage();
    await configurar(pub, { API_URL: 'simulada' });
    await pub.goto(link);
    await expect(pub.locator('#relatorio')).toHaveAttribute('data-estado', 'pronto');
    await expect(pub.locator('#relatorio')).toContainText('Texto revisado pelo consultor na prévia.');
    await pub.close();

    await page.click('#btn-despublicar');
    await page.click('#confirmar-ok');
    await expect(page.locator('#btn-publicar')).toBeVisible();
    const fora = await context.newPage();
    await configurar(fora, { API_URL: 'simulada' });
    await fora.goto(link);
    await expect(fora.locator('#relatorio')).toContainText('Relatório não encontrado ou fora do ar.');
    await fora.close();
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
