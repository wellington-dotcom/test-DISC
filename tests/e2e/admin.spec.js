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
    const c2 = await gerarCodigo(page, payload({ id: 'e2e-xss-0002', telefone: '5511977770002', nome: '<img src=x onerror="window.__xss=1"> Silva', respostas: '1234'.repeat(25) }));
    await page.fill('#campo-codigos', 'Olá! Concluí o teste DISC.\nNome: Carla\n\nCódigo de resultado:\n' + c1 + '\n\n' + c2);
    await page.click('#btn-importar');
    await expect(page.locator('#resultado-importacao')).toContainText('2 importados');

    // Reimportar o mesmo código não duplica
    await page.fill('#campo-codigos', c1);
    await page.click('#btn-importar');
    await expect(page.locator('#resultado-importacao')).toContainText('1 já existia');

    await abrirAba(page, 'lista');
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
    await abrirAba(page, 'comparativo');
    await expect(page.locator('#vista-comparativo')).toContainText('1 aprovado.');
    await expect(page.locator('#vista-comparativo .empilhados')).toBeVisible();
    await expect(page.locator('#resumo-lista .caixa--destaque')).toContainText('1');

    // Persistência local após recarregar
    await page.reload();
    await abrirAba(page, 'lista');
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
  await abrirAba(page, 'lista');
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
// Menu lateral: em tela estreita (< 1024px) ele é uma gaveta aberta pelo botão "Menu" do topo.
async function abrirGavetaSePreciso(page) {
  if (await page.locator('#btn-menu').isVisible() && (await page.locator('#btn-menu').getAttribute('aria-expanded')) !== 'true') {
    await page.click('#btn-menu');
  }
}
async function abrirAba(page, aba) {
  await abrirGavetaSePreciso(page);
  await page.locator('.aba[data-aba="' + aba + '"]').click();
}
async function abrirMenuUsuario(page) {
  await abrirGavetaSePreciso(page);
  await page.click('#btn-usuario');
}

async function entrar(page, email, senha) {
  await expect(page.locator('#form-login')).toBeVisible();
  await page.fill('#campo-email', email);
  await page.fill('#campo-senha', senha);
  await page.click('#btn-entrar');
  await expect(page.locator('#tela-painel')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#contagem')).not.toHaveText('Carregando…');
}

async function sairDoPainel(page) {
  await abrirMenuUsuario(page);
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
      Object.assign(payload({ id: 'api-item-002', telefone: '5511977770003', nome: 'Beatriz Santos', respostas: '2143'.repeat(25), resultado: { codigo: 'DI' } }), { status: 'reprovado', observacoes: 'Sem disponibilidade', recebidoEm: '2026-10-03T10:00:00.000Z', protocolo: '03W' }),
      Object.assign(payload({ id: 'api-item-003', telefone: '5511977770004', nome: 'Registro Corrompido', respostas: '1111' }), { status: 'em_analise', observacoes: '', recebidoEm: '2026-10-01T10:00:00.000Z' })
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
    expect(await abasVisiveis(page)).toEqual(['lista', 'processos', 'comparativo', 'importar', 'empresas', 'relatorios', 'usuarios']);
    await expect(page.locator('.aba[data-aba="processos"]')).toHaveText('Processos');
    // Apps Script (legado): a aba Empresas só avisa que precisa do Supabase, sem chamar a API
    await abrirAba(page, 'empresas');
    await expect(page.locator('#empresas-indisponivel')).toContainText('Disponível com o servidor Supabase');
    await expect(page.locator('#btn-nova-empresa')).toHaveCount(0);
    await abrirAba(page, 'lista');

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
    await abrirAba(page, 'comparativo');
    await expect(page.locator('#vista-comparativo')).toContainText('1 aprovado.');
    await expect(page.locator('#vista-comparativo')).toContainText('Rafael Moreira Lima');

    // Exportar CSV
    await abrirAba(page, 'lista');
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

    await abrirAba(page, 'lista');
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
    await abrirAba(page, 'usuarios');
    await expect(page.locator('#lista-usuarios [data-email="gestor@empresa.com"]')).toContainText('gestor (desativado nesta versão)');
    await page.click('#btn-novo-usuario');
    await expect(page.locator('#us-papel')).toHaveCount(0);
    await page.click('#janela-cancelar');

    // Novo processo com config
    await abrirAba(page, 'processos');
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
      corte: 70, faixaAvaliar: 55, statusFinalistas: ['finalista', 'aprovado'], permitirAntecedentes: false,
      formulario: { campos: { idade: 'obrigatorio', funcao: 'opcional', empresa: 'opcional', email: 'oculto', cidade: 'oculto', foto: 'opcional' }, perguntas: [], parte2: 'desligada' }
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

  test('processo: "O que perguntar ao candidato" salva config.formulario, recusa pergunta sensível e mostra o resumo', async ({ page }) => {
    const erros = coletarErros(page);
    const TOKEN = 'token-e2e-form';
    const processos = [];
    await configurar(page, { API_URL: API_FALSA });
    const chamadas = await simularApi(page, (corpo) => {
      if (corpo.acao === 'login') return { ok: true, token: TOKEN, usuario: { id: 'u1', nome: 'Ana Admin', email: corpo.email, papel: 'admin' } };
      if (corpo.token !== TOKEN) return { ok: false, erro: 'Sessão expirada. Entre de novo.', sessaoExpirada: true };
      switch (corpo.acao) {
        case 'listar': return { ok: true, itens: [] };
        case 'usuarios.listar': return { ok: true, usuarios: [] };
        case 'clickup.status': return { ok: true, configurado: false };
        case 'processos.listar': return { ok: true, processos };
        case 'relatorios.listar': return { ok: true, relatorios: [] };
        case 'processos.salvar': {
          const p = Object.assign({ id: 'proc-f1', codigo: 'F0RM', respostas: 0 }, corpo.processo);
          processos.splice(0, processos.length, p);
          return { ok: true, processo: p };
        }
        default: return { ok: false, erro: 'Ação inesperada no teste: ' + corpo.acao };
      }
    });
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/admin.html');
    await entrar(page, 'ana@empresa.com', 'senha-certa-1');
    await abrirAba(page, 'processos');
    await page.click('#btn-novo-processo');
    await page.fill('#proc-nome', 'Recepção 2027');
    await expect(page.locator('#proc-mostrar + span')).toContainText('relatório DISC completo');

    // Nome e WhatsApp fixos; padrão: idade obrigatória, função/empresa opcionais, e-mail/cidade não perguntados
    await expect(page.locator('#proc-campos-fixos')).toContainText('Nome completo');
    await expect(page.locator('#proc-campos-fixos')).toContainText('WhatsApp');
    await expect(page.locator('#proc-campos-fixos .selo')).toHaveText(['Sempre pedido', 'Sempre pedido']);
    await expect(page.locator('#proc-campo-idade')).toHaveAttribute('value', 'obrigatorio');
    await expect(page.locator('#proc-campo-email')).toHaveAttribute('value', 'oculto');
    await expect(page.locator('#form-processo select')).toHaveCount(0);
    await escolher(page, '#proc-campo-idade', 'oculto');
    await escolher(page, '#proc-campo-email', 'obrigatorio');
    await escolher(page, '#proc-campo-cidade', 'opcional');

    // Segunda parte do teste: pílula desligada para seleção; ao CRIAR segue o tipo (equipe liga) até alguém mexer nela
    const p2 = page.locator('#proc-parte2');
    await expect(p2).toHaveAttribute('role', 'switch');
    await expect(p2).toHaveAttribute('aria-checked', 'false');
    await escolher(page, '#proc-tipo', 'equipe');
    await expect(p2).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#proc-parte2-nota')).toContainText('10');
    await escolher(page, '#proc-tipo', 'selecao');
    await expect(p2).toHaveAttribute('aria-checked', 'false');
    await p2.click();
    await expect(p2).toHaveAttribute('aria-checked', 'true');
    await p2.click();
    await escolher(page, '#proc-tipo', 'equipe');
    await expect(p2).toHaveAttribute('aria-checked', 'false');
    await escolher(page, '#proc-tipo', 'selecao');

    // Perguntas extras: até 5; sensível é recusada (aviso na hora e no salvar)
    for (let i = 0; i < 5; i++) await page.click('#btn-add-pergunta');
    await expect(page.locator('#proc-perguntas > li')).toHaveCount(5);
    await expect(page.locator('#btn-add-pergunta')).toBeDisabled();
    for (let i = 4; i >= 2; i--) await page.locator('#proc-perguntas > li').nth(i).getByRole('button', { name: 'Remover pergunta ' + (i + 1) }).click();
    await expect(page.locator('#btn-add-pergunta')).toBeEnabled();
    await page.fill('#pergunta-texto-0', 'Qual sua pretensão salarial?');
    await page.check('#pergunta-obrig-0');
    await page.fill('#pergunta-texto-1', 'Você tem filhos?');
    await expect(page.locator('#pergunta-erro-1')).toHaveText('A pergunta "Você tem filhos?" pede um dado sensível e não pode ser usada.');
    await page.click('#btn-salvar-processo');
    await expect(page.locator('#proc-erro')).toHaveText('A pergunta "Você tem filhos?" pede um dado sensível e não pode ser usada.');
    expect(chamadas.filter((c) => c.corpo.acao === 'processos.salvar').length).toBe(0);
    await page.fill('#pergunta-texto-1', 'Tem disponibilidade aos sábados?');
    await expect(page.locator('#pergunta-erro-1')).toHaveText('');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    await page.click('#btn-salvar-processo');
    await expect(page.locator('#aviso-geral')).toContainText('Processo criado');
    const salvo = chamadas.find((c) => c.corpo.acao === 'processos.salvar').corpo.processo;
    expect(salvo.config.formulario).toEqual({
      campos: { idade: 'oculto', funcao: 'opcional', empresa: 'opcional', email: 'obrigatorio', cidade: 'opcional', foto: 'opcional' },
      perguntas: [
        { id: 'p1', texto: 'Qual sua pretensão salarial?', obrigatoria: true },
        { id: 'p2', texto: 'Tem disponibilidade aos sábados?', obrigatoria: false }
      ],
      parte2: 'desligada'
    });
    await expect(page.locator('#proc-parte2-resumo')).toHaveAttribute('data-parte2', 'desligada');

    // Página do processo: resumo do que é perguntado
    const resumo = page.locator('#proc-formulario');
    await expect(resumo).toContainText('Nome completo');
    await expect(resumo.locator('li[data-modo="obrigatorio"]', { hasText: 'E-mail' })).toHaveCount(1);
    await expect(resumo.locator('li', { hasText: 'Pergunta: Qual sua pretensão salarial?' })).toContainText('Obrigatória');
    await expect(resumo.locator('li', { hasText: 'Pergunta: Tem disponibilidade aos sábados?' })).toContainText('Opcional');
    await expect(resumo).toContainText('Não perguntamos: Idade.');
    await expect(page.locator('#proc-mostra-resultado')).toHaveText('O participante não vê o resultado');

    // Editar reabre com o que foi salvo
    await page.click('#btn-editar-processo');
    await expect(page.locator('#proc-campo-idade')).toHaveAttribute('value', 'oculto');
    await expect(page.locator('#pergunta-texto-1')).toHaveValue('Tem disponibilidade aos sábados?');
    await expect(page.locator('#pergunta-obrig-0')).toBeChecked();
    // Editar não muda a Parte 2 sozinho (nem trocando o tipo); ligar à mão salva 'ligada' e aparece no resumo
    await expect(p2).toHaveAttribute('aria-checked', 'false');
    await escolher(page, '#proc-tipo', 'equipe');
    await expect(p2).toHaveAttribute('aria-checked', 'false');
    await p2.click();
    await page.click('#btn-salvar-processo');
    await expect(page.locator('#aviso-geral')).toContainText('Processo salvo');
    const editado = chamadas.filter((c) => c.corpo.acao === 'processos.salvar').pop().corpo.processo;
    expect(editado.config.formulario.parte2).toBe('ligada');
    await expect(page.locator('#proc-parte2-resumo')).toContainText('Ligada');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    expect(erros).toEqual([]);
  });

  test('pessoas: uma linha por pessoa com selo "N respostas", histórico, consistência, formulário, exclusão e CSV', async ({ page }) => {
    const erros = coletarErros(page);
    const TOKEN = 'token-e2e-pessoas';
    const base = (id, extra) => Object.assign(payload({ id }), { status: 'em_analise', observacoes: '', email: '', cidade: '', extras: [], pessoaId: '', pessoa: null }, extra);
    const carla = { id: 'pes-1', nome: 'Carla Nogueira Dias', telefone: '5511988887777', idade: 31, funcao: 'Supervisora', empresa: 'Loja Centro', email: 'carla@exemplo.com', cidade: 'Boa Vista', atualizadoEm: '2026-10-03T10:00:00.000Z' };
    const itens = [
      base('c-1', { fim: '2026-10-01T10:00:00.000Z', protocolo: '11A', avaliacao: 'AB23', pessoaId: 'pes-1', pessoa: carla, idade: null, email: 'carla@exemplo.com', cidade: 'Boa Vista',
        extras: [{ id: 'p1', pergunta: 'Qual sua pretensão salarial?', resposta: 'R$ 3.000' }, { id: 'p2', pergunta: 'Tem disponibilidade aos sábados?', resposta: '' }] }),
      base('c-2', { fim: '2026-10-03T10:00:00.000Z', protocolo: '22B', avaliacao: 'AB23', pessoaId: 'pes-1', pessoa: carla }),
      base('b-1', { fim: '2026-10-02T10:00:00.000Z', protocolo: '33C', avaliacao: 'AB23', nome: 'Bruno Lima Souza', telefone: '5511955554444', idade: null }),
      // Sem pessoaId (Apps Script antigo): agrupa pelo WhatsApp, mesmo com máscara diferente
      base('d-1', { fim: '2026-09-20T10:00:00.000Z', protocolo: '44D', nome: 'Daniela Reis Prado', telefone: '(21) 97777-6666' }),
      base('d-2', { fim: '2026-09-25T10:00:00.000Z', protocolo: '55E', nome: 'Daniela Reis Prado', telefone: '5521977776666', respostas: '1234'.repeat(25) })
    ];
    await configurar(page, { API_URL: API_FALSA });
    const chamadas = await simularApi(page, (corpo) => {
      if (corpo.acao === 'login') return { ok: true, token: TOKEN, usuario: { id: 'u1', nome: 'Ana Admin', email: corpo.email, papel: 'admin' } };
      if (corpo.token !== TOKEN) return { ok: false, erro: 'Sessão expirada. Entre de novo.', sessaoExpirada: true };
      switch (corpo.acao) {
        case 'listar': return { ok: true, itens };
        case 'usuarios.listar': return { ok: true, usuarios: [] };
        case 'clickup.status': return { ok: true, configurado: false };
        case 'processos.listar': return { ok: true, processos: [{ id: 'a1', codigo: 'AB23', empresa: 'Loja Modelo', nome: 'Vendedor 2026', tipo: 'selecao', ativa: true, respostas: 3, config: {} }] };
        case 'excluir': {
          const i = itens.findIndex((x) => x.id === corpo.id);
          if (i === -1) return { ok: false, erro: 'Participante não encontrado.' };
          itens.splice(i, 1);
          return { ok: true, id: corpo.id };
        }
        default: return { ok: false, erro: 'Ação inesperada no teste: ' + corpo.acao };
      }
    });
    await page.goto('/admin.html');
    await entrar(page, 'ana@empresa.com', 'senha-certa-1');

    // Lista: 3 pessoas, 5 respostas; selo só para quem tem mais de uma
    const cards = page.locator('#lista-candidatos > li');
    await expect(cards).toHaveCount(3);
    await expect(page.locator('#contagem')).toHaveText('3 de 3 participantes (5 de 5 respostas)');
    await expect(page.locator('#resumo-pessoas')).toContainText('Pessoas');
    await expect(page.locator('#resumo-pessoas .resumo__valor')).toHaveText('3');
    await expect(page.locator('#resumo-pessoas')).toContainText('5 respostas no total');
    const cardCarla = cards.filter({ hasText: 'Carla Nogueira Dias' });
    await expect(cardCarla.locator('.selo-respostas')).toHaveText('2 respostas');
    await expect(cardCarla.locator('.protocolo__valor')).toHaveText('22B'); // a mais recente
    await expect(cards.filter({ hasText: 'Daniela Reis Prado' }).locator('.selo-respostas')).toHaveText('2 respostas');
    await expect(cards.filter({ hasText: 'Bruno Lima Souza' }).locator('.selo-respostas')).toHaveCount(0);
    // Ordem: pela resposta mais recente de cada pessoa
    await expect(cards.locator('.card-nome')).toHaveText(['Carla Nogueira Dias', 'Bruno Lima Souza', 'Daniela Reis Prado']);
    // Filtro por processo: agrupa dentro do processo
    await escolher(page, '#filtro-processo', 'AB23');
    await expect(cards).toHaveCount(2);
    await expect(cards.filter({ hasText: 'Carla' }).locator('.selo-respostas')).toHaveText('2 respostas');
    await escolher(page, '#filtro-processo', '-');
    await expect(cards).toHaveCount(1);
    await expect(cards.locator('.selo-respostas')).toHaveText('2 respostas');
    await escolher(page, '#filtro-processo', '');

    // Detalhe da Carla: ficha da pessoa, formulário, histórico com troca e consistência
    await cardCarla.getByRole('button', { name: /Ver detalhes/ }).click();
    await expect(page.locator('#det-protocolo')).toHaveText('Código 22B');
    await expect(page.locator('#det-idade')).toHaveText('31 anos');
    await expect(page.locator('#det-funcao')).toHaveText('Supervisora');
    await expect(page.locator('#det-formulario')).toContainText('carla@exemplo.com');
    await expect(page.locator('#det-cidade')).toHaveText('Boa Vista');
    const hist = page.locator('#det-historico-lista > li');
    await expect(hist).toHaveCount(2);
    await expect(hist.nth(0)).toHaveAttribute('aria-current', 'true');
    await expect(hist.nth(0)).toContainText('Vendedor 2026');
    await expect(hist.nth(1).locator('.mini-barras')).toBeVisible();
    await expect(hist.nth(1).locator('.protocolo__valor')).toHaveText('11A');
    await expect(page.locator('#det-consistencia')).toContainText('O perfil se manteve nas 2 respostas.');
    await expect(page.locator('#det-consistencia')).toHaveAttribute('data-igual', 'sim');
    await hist.nth(1).locator('[data-acao="ver-resposta"]').click();
    await expect(page.locator('#det-protocolo')).toHaveText('Código 11A');
    await expect(page.locator('#det-historico-lista > li').nth(1)).toHaveAttribute('aria-current', 'true');
    const extras = page.locator('#det-formulario .det-extra');
    await expect(extras).toHaveCount(2);
    await expect(extras.nth(0)).toContainText('Qual sua pretensão salarial?');
    await expect(extras.nth(0)).toContainText('R$ 3.000');
    await expect(extras.nth(1)).toContainText('Sem resposta');
    await expect(page.locator('#btn-excluir-participante')).toHaveText('Excluir só esta resposta');
    await expect(page.locator('#btn-excluir-pessoa')).toHaveText('Excluir as 2 respostas da pessoa');
    await page.setViewportSize({ width: 375, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.keyboard.press('Escape');

    // Bruno: sem idade (processo que não pergunta) e sem formulário extra
    await cards.filter({ hasText: 'Bruno' }).getByRole('button', { name: /Ver detalhes/ }).click();
    await expect(page.locator('#det-idade')).toHaveText('—');
    await expect(page.locator('#det-historico')).toHaveCount(0);
    await expect(page.locator('#det-formulario')).toHaveCount(0);
    await expect(page.locator('#btn-excluir-pessoa')).toHaveCount(0);
    await page.keyboard.press('Escape');

    // Daniela: perfil mudou entre as respostas; excluir só uma resposta mantém a outra
    await cards.filter({ hasText: 'Daniela' }).getByRole('button', { name: /Ver detalhes/ }).click();
    await expect(page.locator('#det-consistencia')).toContainText('O perfil mudou entre as respostas: vale conversar sobre o momento de cada uma.');
    await expect(page.locator('#det-consistencia')).toHaveAttribute('data-igual', 'nao');
    await page.click('#btn-excluir-participante');
    await expect(page.locator('#confirmar-desc')).toContainText('A outra resposta de Daniela Reis Prado continua.');
    await page.click('#confirmar-ok');
    await expect(page.locator('#aviso-geral')).toContainText('Resposta excluída');
    await expect(page.locator('#det-protocolo')).toHaveText('Código 44D');
    await expect(page.locator('#det-historico')).toHaveCount(0);
    expect(chamadas.filter((c) => c.corpo.acao === 'excluir').map((c) => c.corpo.id)).toEqual(['d-2']);
    await page.keyboard.press('Escape');

    // CSV: uma linha por resposta, com e-mail, cidade e perguntas extras
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#btn-csv')]);
    const linhas = fs.readFileSync(await download.path(), 'utf8').slice(1).trim().split(/\r\n/);
    expect(linhas.length).toBe(5);
    expect(linhas[0]).toMatch(/;e-mail;cidade;perguntas extras$/);
    expect(linhas.find((l) => l.indexOf(';11A;') !== -1)).toMatch(/;carla@exemplo\.com;Boa Vista;Qual sua pretensão salarial\?: R\$ 3\.000 \| Tem disponibilidade aos sábados\?: —$/);

    // Excluir todas as respostas da pessoa (confirmação digitando EXCLUIR)
    await cardCarla.getByRole('button', { name: /Ver detalhes/ }).click();
    await page.click('#btn-excluir-pessoa');
    await expect(page.locator('#confirmar-desc')).toContainText('as 2 respostas de Carla Nogueira Dias e a ficha dela');
    await expect(page.locator('#confirmar-ok')).toBeDisabled();
    await page.fill('#confirmar-texto', 'EXCLUIR');
    await page.click('#confirmar-ok');
    await expect(page.locator('#aviso-geral')).toContainText('Pessoa excluída com as 2 respostas');
    await expect(page.locator('#vista-lista')).toBeVisible();
    await expect(cards).toHaveCount(2);
    await expect(page.locator('#vista-lista')).not.toContainText('Carla');
    expect(chamadas.filter((c) => c.corpo.acao === 'excluir').map((c) => c.corpo.id).sort()).toEqual(['c-1', 'c-2', 'd-2']);
    expect(erros).toEqual([]);
  });
});

// Tamanho do seed da prévia gravado pela api-simulada: respostas e pessoas (mesmo WhatsApp/pessoaId = uma pessoa).
async function seedDaPrevia(page) {
  return page.evaluate(() => {
    const linhas = JSON.parse(localStorage.getItem('disc_planilha_simulada') || '[]');
    const chaves = new Set(linhas.map((r) => {
      if (r.pessoaId) return 'p:' + r.pessoaId;
      let d = String(r.telefone || '').replace(/\D/g, '');
      if ((d.length === 10 || d.length === 11) && d.indexOf('55') !== 0) d = '55' + d;
      return d ? 't:' + d : 'r:' + r.id;
    }));
    return { respostas: linhas.length, pessoas: chaves.size };
  });
}

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
    // O seed da prévia muda entre versões: as contagens partem do que está gravado na página.
    const seed = await seedDaPrevia(page);
    await expect(page.locator('#lista-candidatos > li')).toHaveCount(seed.pessoas);
    await expect(page.locator('#usuario-nome')).toHaveText('Você (admin)');

    // Envio "do participante" pela API simulada: o servidor falso devolve o protocolo
    const r1 = await page.evaluate((p) => window.DISC_API.enviar(p), payload({ id: 'previa-envio-01', telefone: '5521977770011', nome: 'Paula Mendes Rocha', idade: 28 }));
    expect(r1.protocolo).toMatch(/^[0-9]{2}[A-HJ-NP-Z]$/);
    const r2 = await page.evaluate((p) => window.DISC_API.enviar(p), payload({ id: 'previa-envio-01', telefone: '5521977770011', nome: 'Paula Mendes Rocha', idade: 28 }));
    expect(r2).toEqual({ ok: true, duplicado: true, id: 'previa-envio-01', protocolo: r1.protocolo });

    // Código importado na aba "Importar códigos" também ganha protocolo; código sem idade é recusado pelo servidor
    await page.locator('#aba-importar').click();
    const antigoSemIdade = await gerarCodigo(page, payload({ id: 'previa-antigo-3', nome: 'Rui Antigo Melo' }));
    await page.fill('#campo-codigos', await gerarCodigo(page, payload({ id: 'previa-import-2', telefone: '5521977770012', nome: 'Otávio Prado Lins', idade: 61, respostas: '1234'.repeat(25) })) + '\n' + antigoSemIdade);
    await page.click('#btn-importar');
    await expect(page.locator('#resultado-importacao')).toContainText('1 importado');
    await expect(page.locator('#resultado-importacao')).toContainText('Idade não informada');

    await abrirAba(page, 'lista');
    await expect(page.locator('#lista-candidatos > li')).toHaveCount(seed.pessoas + 2);
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
    await expect(page.locator('#lista-candidatos > li')).toHaveCount(seed.pessoas + 2);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('disc_planilha_simulada')).length)).toBe(seed.respostas + 2);
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
    // A prévia mostra Vendas (depois de Relatórios) quando a API simulada tem a venda direta.
    const temVendas = await page.evaluate(() => typeof window.DISC_API.listarPedidos === 'function');
    // Menu lateral agrupado: Seleção, Empresas, Vendas (se houver) e Configurações.
    expect(await abasVisiveis(page)).toEqual(['lista', 'processos', 'comparativo', 'importar', 'empresas', 'relatorios'].concat(temVendas ? ['vendas', 'divulgar'] : []).concat(['usuarios', 'conexoes']));

    // Processo novo
    await abrirAba(page, 'processos');
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
    await abrirAba(page, 'processos');
    const card = page.locator('.proc-card', { hasText: 'Atendente 2027' });
    await expect(card.locator('.av-codigo')).toHaveText(codigo);
    await expect(card).toContainText('Padaria Teste E2E');
    await expect(card.locator('[data-acao="excluir"]')).toHaveCount(1);

    // Uma resposta chega pelo link novo; o filtro "Processo" mostra só ela
    await page.evaluate((p) => window.DISC_API.enviar(p), payload({ id: 'e2e-padaria-01', nome: 'Marcos Padaria Teste', idade: 25, avaliacao: codigo }));
    await abrirAba(page, 'lista');
    await page.click('#btn-atualizar');
    await expect(page.locator('#lista-candidatos > li', { hasText: 'Marcos Padaria Teste' })).toHaveCount(1);
    const total = await page.locator('#lista-candidatos > li').count();
    await escolher(page, '#filtro-processo', codigo);
    await expect(page.locator('#lista-candidatos > li')).toHaveCount(1);
    await expect(page.locator('#lista-candidatos > li .card-origem')).toHaveText('Atendente 2027 · Padaria Teste E2E');
    await escolher(page, '#filtro-processo', '');
    // "Ver participantes" na página do processo já aplica o filtro
    await abrirAba(page, 'processos');
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
    await abrirAba(page, 'processos');
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
    await abrirMenuUsuario(page);
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

// Backend Supabase: sem rede. O supabase-js vendorizado vira um arquivo vazio e o js/api-supabase.js é trocado
// por um DISC_API falso mínimo (MODO 'supabase') que guarda as chamadas em window.__sb.
const API_SUPABASE_FALSA = `
(function () {
  var sb = window.__sb = { chamadas: [], primeiroAdmin: true, usuarios: [
    { id: 'u1', nome: 'Dona do Sistema', email: 'dona@empresa.com', papel: 'admin', ativo: true, voce: true },
    { id: 'u2', nome: 'Convidada Pendente', email: 'pendente@empresa.com', papel: 'admin', ativo: true, convitePendente: true }
  ] };
  function ok(x) { return Promise.resolve(Object.assign({ ok: true }, x || {})); }
  function anotar(nome, args) { sb.chamadas.push({ nome: nome, args: Array.prototype.slice.call(args) }); }
  var dona = { id: 'u1', nome: 'Dona do Sistema', email: 'dona@empresa.com', papel: 'admin' };
  window.DISC_API = Object.assign({}, window.DISC_API, {
    MODO: 'supabase',
    // Sem a venda direta por padrão (o js/api.js legado tem o método só para recusar); API_VENDAS_FALSA acrescenta.
    listarPedidos: undefined,
    configurado: function () { return true; },
    login: function (email, senha) {
      anotar('login', arguments);
      if (email === 'sem@empresa.com') return ok({ token: 'tk-sem', usuario: { id: 'u9', nome: 'Sem Acesso', email: email, papel: '' } });
      if (email !== 'dona@empresa.com' || senha !== 'senha-boa-1') return Promise.reject(new Error('E-mail ou senha incorretos.'));
      var primeiro = sb.primeiroAdmin; sb.primeiroAdmin = false;
      return ok({ token: 'tk-dona', usuario: dona, primeiroAdmin: primeiro });
    },
    sair: function () { anotar('sair', arguments); try { localStorage.removeItem('sb-sessao-falsa'); } catch (e) {} return ok(); },
    sessaoAtual: function () {
      var guardada = null;
      try { guardada = localStorage.getItem('sb-sessao-falsa'); } catch (e) {}
      if (!guardada) { var e2 = new Error('Sessão expirada. Entre de novo.'); e2.sessaoExpirada = true; return Promise.reject(e2); }
      return ok({ token: 'tk-guardado', usuario: dona });
    },
    recuperarSenha: function () { anotar('recuperarSenha', arguments); return ok(); },
    definirNovaSenha: function () { anotar('definirNovaSenha', arguments); return ok({ token: 'tk-dona', usuario: dona }); },
    listar: function () { return ok({ itens: [] }); },
    processosListar: function () { return ok({ processos: [] }); },
    listarUsuarios: function () { return ok({ usuarios: sb.usuarios.slice() }); },
    salvarMinhaFoto: function (token, foto) {
      anotar('salvarMinhaFoto', arguments);
      dona.foto = foto; sb.usuarios[0].foto = foto;
      return ok({ foto: foto });
    },
    listarEmpresas: function () { return ok({ empresas: [] }); },
    clickupStatus: function () { return ok({ configurado: false }); },
    // Banco em dia por padrão; window.__bancoFaltando (addInitScript) simula migração faltando ou a função ausente.
    versaoBanco: function () {
      anotar('versaoBanco', arguments);
      var f = window.__bancoFaltando;
      if (f === 'sem-funcao') return Promise.reject(new Error('function versao_banco() does not exist'));
      return ok({ versao: 20261010120000, faltando: Array.isArray(f) ? f : [] });
    },
    convidarUsuario: function (token, dados) {
      anotar('convidarUsuario', arguments);
      sb.usuarios.push({ id: 'u' + (sb.usuarios.length + 1), nome: dados.nome, email: dados.email, papel: 'admin', ativo: true, convitePendente: true });
      return ok({ convidado: true });
    },
    excluirUsuario: function (token, id) {
      anotar('excluirUsuario', arguments);
      sb.usuarios = sb.usuarios.filter(function (u) { return u.id !== id; });
      return ok({ id: id });
    }
  });
})();
`;

async function simularSupabase(page) {
  await configurar(page, { BACKEND: 'supabase', API_URL: 'https://projeto-teste.supabase.co', SUPABASE_URL: 'https://projeto-teste.supabase.co', SUPABASE_ANON_KEY: 'anon-publica' });
  await page.route('**/assets/vendor/supabase.js', (route) => route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: '/* supabase-js desligado no teste */' }));
  await page.route('**/js/api-supabase.js', (route) => route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: API_SUPABASE_FALSA }));
  // Nenhuma chamada pode sair para o Supabase de verdade.
  await page.route('https://projeto-teste.supabase.co/**', (route) => route.abort());
}

async function chamadasSb(page, nome) {
  return page.evaluate((n) => window.__sb.chamadas.filter((c) => c.nome === n).map((c) => c.args), nome);
}

test.describe('Admin com Supabase (DISC_API.MODO "supabase", API falsa)', () => {
  test('login: sem "Primeiro acesso" com chave, primeiro login vira admin, usuário sem convite é recusado, esqueci a senha', async ({ page }) => {
    const erros = coletarErros(page);
    await simularSupabase(page);
    await page.goto('/admin.html');
    await expect(page.locator('#form-login')).toBeVisible();
    await expect(page.locator('#modo-indicador')).toHaveText('Conectado ao servidor');
    await expect(page.locator('#btn-ir-primeiro')).toBeHidden();
    await expect(page.locator('#nota-esqueceu')).toBeHidden();
    await expect(page.locator('#nota-primeiro-supabase')).toBeVisible();
    // Texto para quem foi convidado (sem detalhe técnico do Supabase na tela de entrada).
    await expect(page.locator('#nota-primeiro-supabase')).toContainText('Recebeu um convite?');
    await expect(page.locator('#nota-primeiro-supabase')).not.toContainText('Supabase');
    await expect(page.locator('#dica-previa')).toBeHidden();

    // Esqueci minha senha: e-mail inválido, depois envio com o endereço do painel
    await page.fill('#campo-email', 'dona@empresa.com');
    await page.click('#btn-esqueci');
    await expect(page.locator('#form-esqueci')).toBeVisible();
    await expect(page.locator('#form-login')).toBeHidden();
    await expect(page.locator('#es-email')).toHaveValue('dona@empresa.com');
    await page.fill('#es-email', 'nao-e-email');
    await page.click('#btn-enviar-link');
    await expect(page.locator('#erro-esqueci')).toHaveText('Informe um e-mail válido.');
    await page.fill('#es-email', 'dona@empresa.com');
    await page.click('#btn-enviar-link');
    await expect(page.locator('#ok-esqueci')).toContainText('você vai receber um link para definir uma nova senha');
    await expect(page.locator('#erro-esqueci')).toBeHidden();
    const pedidos = await chamadasSb(page, 'recuperarSenha');
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0][0]).toBe('dona@empresa.com');
    expect(pedidos[0][1]).toMatch(/\/admin\.html$/);
    await page.click('#btn-voltar-login-esqueci');
    await expect(page.locator('#form-login')).toBeVisible();

    // Usuário que existe no Auth mas não é admin
    await page.fill('#campo-email', 'sem@empresa.com');
    await page.fill('#campo-senha', 'qualquer-1');
    await page.click('#btn-entrar');
    await expect(page.locator('#erro-login')).toHaveText('Este e-mail ainda não tem acesso ao painel. Peça a um administrador para convidar você pela aba Usuários.');
    await expect(page.locator('#tela-painel')).toBeHidden();
    expect(await chamadasSb(page, 'sair')).toHaveLength(1);

    // Senha errada
    await page.fill('#campo-email', 'dona@empresa.com');
    await page.fill('#campo-senha', 'errada');
    await page.click('#btn-entrar');
    await expect(page.locator('#erro-login')).toHaveText('E-mail ou senha incorretos.');

    // Primeiro login: vira admin e recebe o aviso
    await entrar(page, 'dona@empresa.com', 'senha-boa-1');
    await expect(page.locator('#aviso-geral')).toContainText('você agora é o administrador do painel');
    await expect(page.locator('#usuario-nome')).toHaveText('Dona do Sistema');
    expect(await abasVisiveis(page)).toEqual(['lista', 'processos', 'comparativo', 'importar', 'empresas', 'relatorios', 'usuarios', 'conexoes']);
    expect(await page.evaluate(() => sessionStorage.getItem('disc_admin_token'))).toBe('tk-dona');

    // Segundo login não repete o aviso
    await sairDoPainel(page);
    await expect(page.locator('#btn-esqueci')).toBeVisible();
    await entrar(page, 'dona@empresa.com', 'senha-boa-1');
    await expect(page.locator('#aviso-geral')).toBeHidden();
    expect(erros).toEqual([]);
  });

  test('volta do e-mail de redefinição mostra "Defina sua nova senha" e entra no painel', async ({ page }) => {
    const erros = coletarErros(page);
    await simularSupabase(page);
    await page.goto('/admin.html#access_token=abc&expires_in=3600&refresh_token=r&token_type=bearer&type=recovery');
    await expect(page.locator('#form-nova-senha')).toBeVisible();
    await expect(page.locator('#form-login')).toBeHidden();
    await expect(page.locator('#titulo-nova-senha')).toHaveText('Defina sua nova senha');
    await page.fill('#ns-senha', 'curta');
    await page.fill('#ns-confirmar', 'curta');
    await page.click('#btn-salvar-nova-senha');
    await expect(page.locator('#erro-nova-senha')).toHaveText('A senha precisa ter pelo menos 8 caracteres.');
    await page.fill('#ns-senha', 'nova-senha-1');
    await page.fill('#ns-confirmar', 'nova-senha-2');
    await page.click('#btn-salvar-nova-senha');
    await expect(page.locator('#erro-nova-senha')).toHaveText('As duas senhas não são iguais.');
    await page.fill('#ns-confirmar', 'nova-senha-1');
    await page.click('#btn-salvar-nova-senha');
    await expect(page.locator('#tela-painel')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#aviso-geral')).toHaveText('Senha definida.');
    expect(await chamadasSb(page, 'definirNovaSenha')).toEqual([['nova-senha-1']]);
    expect(new URL(page.url()).hash).toBe('');
    expect(erros).toEqual([]);
  });

  test('convite (type=invite) pede para criar a senha; link vencido avisa no login', async ({ page }) => {
    const erros = coletarErros(page);
    await simularSupabase(page);
    await page.goto('/admin.html#access_token=abc&type=invite');
    await expect(page.locator('#titulo-nova-senha')).toHaveText('Crie sua senha');
    await expect(page.locator('#texto-nova-senha')).toContainText('Você foi convidado');
    await page.click('#btn-voltar-login-nova');
    await expect(page.locator('#form-login')).toBeVisible();

    await page.goto('/admin.html?de-novo=1#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
    await expect(page.locator('#form-login')).toBeVisible();
    await expect(page.locator('#erro-login')).toHaveText('O link do e-mail expirou ou já foi usado. Peça um novo em "Esqueci minha senha".');
    expect(erros).toEqual([]);
  });

  test('sessão guardada pelo supabase-js entra direto; sair volta ao login', async ({ page }) => {
    const erros = coletarErros(page);
    await simularSupabase(page);
    await page.goto('/admin.html');
    await expect(page.locator('#form-login')).toBeVisible();
    await page.evaluate(() => localStorage.setItem('sb-sessao-falsa', '1'));
    await page.reload();
    await expect(page.locator('#tela-painel')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#usuario-nome')).toHaveText('Dona do Sistema');
    expect(await page.evaluate(() => sessionStorage.getItem('disc_admin_token'))).toBe('tk-guardado');
    await sairDoPainel(page);
    await page.evaluate(() => sessionStorage.clear());
    await page.reload();
    await expect(page.locator('#form-login')).toBeVisible();
    await expect(page.locator('#tela-painel')).toBeHidden();
    expect(erros).toEqual([]);
  });

  test('aba Usuários: convida por e-mail, mostra convite pendente e remove (sem redefinir senha manual)', async ({ page }) => {
    const erros = coletarErros(page);
    await simularSupabase(page);
    await page.goto('/admin.html');
    await entrar(page, 'dona@empresa.com', 'senha-boa-1');
    await abrirAba(page, 'usuarios');
    const lista = page.locator('#lista-usuarios');
    await expect(lista.locator('li')).toHaveCount(2);
    await expect(lista.locator('[data-email="dona@empresa.com"]')).toContainText('Dona do Sistema (você)');
    await expect(lista.locator('[data-email="dona@empresa.com"] [data-acao="excluir"]')).toHaveCount(0);
    await expect(lista.locator('[data-email="pendente@empresa.com"] [data-situacao="convite"]')).toHaveText('Convite pendente');
    await expect(lista.locator('[data-acao="redefinir"], [data-acao="editar"], [data-acao="alternar-ativo"]')).toHaveCount(0);

    await expect(page.locator('#btn-novo-usuario')).toHaveText('Convidar administrador');
    await page.click('#btn-novo-usuario');
    await expect(page.locator('#janela-usuario')).toBeVisible();
    await expect(page.locator('#janela-usuario input[type="password"], #us-senha')).toHaveCount(0);
    await page.fill('#us-nome', 'Nova Pessoa');
    await page.fill('#us-email', 'nova@empresa.com');
    await page.click('#janela-ok');
    await expect(page.locator('#aviso-geral')).toHaveText('Convite enviado para nova@empresa.com.');
    await expect(lista.locator('[data-email="nova@empresa.com"]')).toContainText('Convite pendente');
    const convites = await chamadasSb(page, 'convidarUsuario');
    expect(convites).toEqual([['tk-dona', { nome: 'Nova Pessoa', email: 'nova@empresa.com' }]]);

    await lista.locator('[data-email="pendente@empresa.com"] [data-acao="excluir"]').click();
    await page.click('#confirmar-ok');
    await expect(page.locator('#aviso-geral')).toHaveText('Acesso excluído.');
    await expect(lista.locator('[data-email="pendente@empresa.com"]')).toHaveCount(0);
    expect(await chamadasSb(page, 'excluirUsuario')).toEqual([['tk-dona', 'u2']]);
    expect(erros).toEqual([]);
  });
});

/* ---------- Fase 2: empresas, colaboradores, ligações, organograma e relatórios dos modelos ---------- */

// Acrescenta ao DISC_API falso do Supabase os métodos de empresas (memória da página, window.__sb).
const API_EMPRESAS_FALSA = `
(function () {
  var sb = window.__sb;
  sb.empresas = []; sb.vinculos = []; sb.relacoes = {}; sb.topo = {}; sb.relatorios = []; sb.processos = (window.__procsIniciais || []).slice();
  sb.relProcessos = (window.__relProcessos || []).slice(); sb.movidas = {};
  sb.pessoas = {
    'p-bruno': { nome: 'Bruno Lima Costa', telefone: '5511977776666', resultado: { percentuais: { D: 15, I: 25, S: 40, C: 20 }, codigo: 'SI' },
      exigido: { percentuais: { D: 34, I: 30, S: 16, C: 20 }, codigo: 'DI' } },
    'p-diego': { nome: 'Diego Rocha', telefone: '5511955554444', resultado: { percentuais: { D: 40, I: 30, S: 20, C: 10 }, codigo: 'DI' } }
  };
  // JPEG válido de 2×2 (uma foto quebrada agora mostra as iniciais, sem o ícone de imagem quebrada).
  sb.fotoBruno = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAACAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAA//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJEA4X//2Q==';
  var seq = 0;
  function id(p) { seq++; return p + seq; }
  function ok(x) { return Promise.resolve(Object.assign({ ok: true }, x || {})); }
  function anotar(nome, args) { sb.chamadas.push({ nome: nome, args: JSON.parse(JSON.stringify(Array.prototype.slice.call(args))) }); }
  function ativos(eid) { return sb.vinculos.filter(function (v) { return v.empresaId === eid && v.status === 'ativo'; }); }
  function colab(v) {
    var p = sb.pessoas[v.pessoaId];
    return { vinculoId: v.id, pessoaId: v.pessoaId, nome: p.nome, telefone: p.telefone, cargo: v.cargo, area: v.area, status: v.status,
      inicio: v.inicio, fim: v.fim, resultado: p.resultado || null, exigido: p.exigido || null, respondidoEm: p.resultado ? '2026-10-01T12:00:00Z' : null };
  }
  function tirarRelacoes(eid, pid) { sb.relacoes[eid] = (sb.relacoes[eid] || []).filter(function (r) { return r.de !== pid && r.para !== pid; }); }
  var resp = function (pid, nome, tel, respostas) {
    return { id: 'r-' + pid, pessoaId: pid, nome: nome, telefone: tel, vaga: 'Vendedor', status: 'em_analise', respostas: respostas,
      inicio: '2026-10-01T12:00:00.000Z', fim: '2026-10-01T12:09:30.000Z', duracaoSeg: 570, avaliacao: 'SEL1', recebidoEm: '2026-10-01T12:10:00.000Z' };
  };
  Object.assign(window.DISC_API, {
    listar: function () {
      // Bruno respondeu a Parte 2 (exigido de 40 dígitos: D mais alto); Diego não
      var bruno = Object.assign(resp('p-bruno', 'Bruno Lima Costa', '5511977776666', '1234'.repeat(25)), { exigido: '4321'.repeat(10), resultadoExigido: null, foto: sb.fotoBruno });
      var itens = [bruno, resp('p-diego', 'Diego Rocha', '5511955554444', '4321'.repeat(25))];
      itens.forEach(function (it) { if (Object.prototype.hasOwnProperty.call(sb.movidas, it.id)) it.avaliacao = sb.movidas[it.id]; });
      return ok({ itens: itens });
    },
    processosListar: function () { return ok({ processos: sb.processos.slice() }); },
    processosSalvar: function (t, p) {
      anotar('processosSalvar', arguments);
      var novo = Object.assign({ id: id('proc'), codigo: 'EQ' + seq, ativa: true, respostas: 0 }, p);
      sb.processos.push(novo);
      return ok({ processo: novo });
    },
    relatoriosListar: function (t, pid) { return ok({ relatorios: sb.relProcessos.filter(function (r) { return !pid || r.processoId === pid; }) }); },
    moverResposta: function (t, rid, pid) {
      anotar('moverResposta', arguments);
      var p = sb.processos.filter(function (x) { return x.id === pid; })[0];
      sb.movidas[rid] = p ? p.codigo : '';
      return ok({ id: rid, processoId: pid, avaliacao: p ? p.codigo : '' });
    },
    contratarPessoa: function (t, d) {
      anotar('contratarPessoa', arguments);
      var pid = d.pessoaId || String(d.respostaId).replace(/^r-/, '');
      sb.vinculos.forEach(function (v) { if (v.pessoaId === pid && v.status === 'ativo') { v.status = 'desligado'; v.fim = '2026-10-05'; tirarRelacoes(v.empresaId, pid); } });
      var v = { id: id('v'), pessoaId: pid, empresaId: d.empresaId, status: 'ativo', cargo: d.cargo, area: d.area, inicio: '2026-10-05', fim: null };
      sb.vinculos.push(v);
      return ok({ colaborador: colab(v) });
    },
    clickupListas: function () { return ok({ listas: [] }); },
    removerFoto: function (t, rid) {
      anotar('removerFoto', arguments);
      if (rid === 'r-p-bruno') sb.fotoBruno = '';
      return ok({ id: rid, removidas: 1 });
    },
    listarEmpresas: function () {
      return ok({ empresas: sb.empresas.map(function (e) { return Object.assign({}, e, { colaboradores: ativos(e.id).length }); }) });
    },
    salvarEmpresa: function (t, e) {
      anotar('salvarEmpresa', arguments);
      var x = e.id ? sb.empresas.filter(function (y) { return y.id === e.id; })[0] : null;
      if (!x) { x = { id: id('emp'), criadoEm: '2026-10-05T10:00:00Z' }; sb.empresas.push(x); }
      Object.assign(x, { nome: e.nome, cidade: e.cidade || '', observacoes: e.observacoes || '', ativo: e.ativo !== false });
      return ok({ empresa: x });
    },
    excluirEmpresa: function (t, eid) {
      anotar('excluirEmpresa', arguments);
      if (ativos(eid).length) return ok({ ok: false, erro: 'Desligue ou mova os colaboradores antes.' });
      sb.empresas = sb.empresas.filter(function (e) { return e.id !== eid; });
      return ok();
    },
    listarEquipe: function (t, eid) {
      var e = sb.empresas.filter(function (y) { return y.id === eid; })[0];
      return ok({ empresa: e, colaboradores: ativos(eid).map(colab), relacoes: (sb.relacoes[eid] || []).slice(), topoIds: (sb.topo[eid] || []).slice(),
        historico: sb.vinculos.filter(function (v) { return v.empresaId === eid && v.status === 'desligado'; }).map(colab) });
    },
    salvarColaborador: function (t, d) {
      anotar('salvarColaborador', arguments);
      var pid = d.pessoaId;
      if (!pid) { pid = id('p-'); sb.pessoas[pid] = { nome: d.nome, telefone: d.telefone, resultado: null }; }
      var v = ativos(d.empresaId).filter(function (x) { return x.pessoaId === pid; })[0];
      if (!v) { v = { id: id('v'), pessoaId: pid, empresaId: d.empresaId, status: 'ativo', inicio: '2026-10-05', fim: null }; sb.vinculos.push(v); }
      v.cargo = d.cargo || ''; v.area = d.area || '';
      return ok({ colaborador: colab(v) });
    },
    moverColaborador: function (t, d) {
      anotar('moverColaborador', arguments);
      sb.vinculos.forEach(function (v) { if (v.pessoaId === d.pessoaId && v.status === 'ativo') { v.status = 'desligado'; v.fim = '2026-10-05'; tirarRelacoes(v.empresaId, d.pessoaId); } });
      sb.vinculos.push({ id: id('v'), pessoaId: d.pessoaId, empresaId: d.empresaId, status: 'ativo', cargo: d.cargo, area: d.area, inicio: '2026-10-05', fim: null });
      return ok();
    },
    desligarColaborador: function (t, vid) {
      anotar('desligarColaborador', arguments);
      sb.vinculos.forEach(function (v) { if (v.id === vid) { v.status = 'desligado'; v.fim = '2026-10-05'; tirarRelacoes(v.empresaId, v.pessoaId); } });
      return ok();
    },
    salvarRelacoes: function (t, eid, rels, op) {
      anotar('salvarRelacoes', arguments); sb.relacoes[eid] = rels.slice();
      if (op && Array.isArray(op.topoIds)) sb.topo[eid] = op.topoIds.slice();
      return ok();
    },
    salvarRelatorioModelo: function (t, d) {
      anotar('salvarRelatorioModelo', arguments);
      var r = d.id ? sb.relatorios.filter(function (x) { return x.id === d.id; })[0] : null;
      if (!r) { r = { id: id('rel'), token: 'tok-modelo-' + seq, criadoEm: '2026-10-05T10:00:00Z' }; sb.relatorios.push(r); }
      Object.assign(r, { modelo: d.modelo, empresaId: d.empresaId || null, pessoaId: d.pessoaId || null, titulo: d.dados.titulo, status: d.publicar ? 'publicado' : 'rascunho', atualizadoEm: '2026-10-05T11:00:00Z' });
      return ok({ relatorio: { id: r.id, token: r.token, status: r.status, modelo: r.modelo } });
    },
    listarRelatoriosModelo: function (t, f) {
      return ok({ relatorios: sb.relatorios.filter(function (r) { return f.empresaId ? r.empresaId === f.empresaId : (f.pessoaId ? r.pessoaId === f.pessoaId : true); }) });
    },
    excluirRelatorioModelo: function (t, rid) { anotar('excluirRelatorioModelo', arguments); sb.relatorios = sb.relatorios.filter(function (r) { return r.id !== rid; }); return ok(); }
  });
})();
`;

async function simularEmpresas(page) {
  await simularSupabase(page);
  await page.route('**/js/api-supabase.js', (route) => route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: API_SUPABASE_FALSA + API_EMPRESAS_FALSA }));
}

// Escolhe no seletor em pílula com busca: abre, digita e toca na opção.
async function escolherBusca(page, id, texto) {
  await page.click('#' + id);
  await page.fill('#' + id + '-busca', texto);
  await page.locator('#' + id + '-lista [role="option"]', { hasText: texto }).first().click();
  // Vários: a lista continua aberta para escolher mais; "Pronto" fecha.
  const pronto = page.locator('#' + id + '-pronto');
  if (await pronto.count() && await pronto.isVisible()) await pronto.click();
}

// Capturas para revisão visual: só quando CAPTURAS_DIR está definido (ex.: CAPTURAS_DIR=/tmp/capturas npx playwright test …).
async function capturar(page, nome) {
  if (!process.env.CAPTURAS_DIR) return;
  await page.waitForTimeout(450);
  await page.screenshot({ path: require('node:path').join(process.env.CAPTURAS_DIR, 'painel-' + nome + '.png'), fullPage: true });
}

async function semRolagemLateral(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
}

test.describe('Empresas (Supabase, API falsa)', () => {
  test('cria empresa, adiciona colaboradores, liga líder e colegas, vê organograma e compatibilidade, gera e publica o relatório da equipe e move colaborador', async ({ page }) => {
    const erros = coletarErros(page);
    await simularEmpresas(page);
    await page.goto('/admin.html');
    await entrar(page, 'dona@empresa.com', 'senha-boa-1');
    expect(await abasVisiveis(page)).toEqual(['lista', 'processos', 'comparativo', 'importar', 'empresas', 'relatorios', 'usuarios', 'conexoes']);

    // Cadastro: duas empresas
    await abrirAba(page, 'empresas');
    await expect(page.locator('#lista-empresas')).toContainText('Nenhuma empresa cadastrada');
    await page.click('#btn-nova-empresa');
    await page.click('#janela-ok');
    await expect(page.locator('#janela-erro')).toHaveText('Informe o nome da empresa.');
    await page.fill('#emp-nome', 'Filial Norte');
    await page.click('#janela-ok');
    await expect(page.locator('#vista-empresas h2')).toHaveText('Filial Norte');
    await page.click('#btn-voltar-empresas');
    await page.click('#btn-nova-empresa');
    await page.fill('#emp-nome', 'Loja Modelo');
    await page.fill('#emp-cidade', 'Boa Vista / RR');
    await page.click('#janela-ok');
    await expect(page.locator('#vista-empresas h2')).toHaveText('Loja Modelo');
    await expect(page.locator('#btn-relatorio-equipe')).toBeDisabled();

    // Colaboradores: nova pessoa (nome + WhatsApp), pessoa que já respondeu (busca) e outra nova
    await page.click('#btn-add-colaborador');
    await page.fill('#colab-nome', 'Ana Souza');
    await page.fill('#colab-telefone', '11 9');
    await page.click('#janela-ok');
    await expect(page.locator('#janela-erro')).toHaveText('Informe o WhatsApp com DDD.');
    await page.fill('#colab-telefone', '(11) 98888-1111');
    await page.fill('#colab-cargo', 'Gerente');
    await page.click('#janela-ok');
    await expect(page.locator('#lista-colaboradores > li')).toHaveCount(1);
    await page.click('#btn-add-colaborador');
    await escolherBusca(page, 'colab-pessoa', 'Bruno');
    await expect(page.locator('#colab-novos')).toBeHidden();
    await page.fill('#colab-cargo', 'Vendedor');
    await page.fill('#colab-area', 'Comercial');
    await page.click('#janela-ok');
    await page.click('#btn-add-colaborador');
    await page.fill('#colab-nome', 'Carla Dias');
    await page.fill('#colab-telefone', '11977770000');
    await page.fill('#colab-cargo', 'Caixa');
    await page.click('#janela-ok');
    const colabs = page.locator('#lista-colaboradores > li');
    await expect(colabs).toHaveCount(3);
    const add = await chamadasSb(page, 'salvarColaborador');
    expect(add[0][1]).toEqual({ empresaId: 'emp2', cargo: 'Gerente', area: '', nome: 'Ana Souza', telefone: '11988881111' });
    expect(add[1][1]).toEqual({ empresaId: 'emp2', cargo: 'Vendedor', area: 'Comercial', pessoaId: 'p-bruno' });
    const bruno = page.locator('#lista-colaboradores > li[data-nome="Bruno Lima Costa"]');
    await expect(bruno.locator('.colab-card__codigo')).toHaveText('SI');
    await expect(bruno.locator('.mini-barras')).toBeVisible();
    await expect(page.locator('#lista-colaboradores > li[data-nome="Ana Souza"] .colab-sem-teste')).toHaveText('Sem teste');

    // Ligações do Bruno: líder Ana, trabalha diretamente com Carla
    await bruno.locator('[data-acao="ligacoes"]').click();
    await escolherBusca(page, 'lig-lider', 'Ana');
    await expect(page.locator('#lig-lider')).toContainText('Ana Souza');
    await escolherBusca(page, 'lig-diretos', 'Carla');
    await expect(page.locator('#lig-diretos-fichas .ficha')).toHaveText(['Carla Dias']);
    await page.click('#janela-ok');
    await expect(page.locator('#aviso-geral')).toHaveText('Ligações de Bruno Lima Costa salvas.');
    const rels = await chamadasSb(page, 'salvarRelacoes');
    expect(rels[0][1]).toBe('emp2');
    const idAna = await page.locator('#lista-colaboradores > li[data-nome="Ana Souza"]').getAttribute('data-pessoa');
    const idCarla = await page.locator('#lista-colaboradores > li[data-nome="Carla Dias"]').getAttribute('data-pessoa');
    expect(rels[0][2]).toEqual([{ de: idAna, para: 'p-bruno', tipo: 'lidera' }, { de: 'p-bruno', para: idCarla, tipo: 'direto' }]);
    await expect(bruno.locator('.colab-card__ligacoes')).toContainText('Líder: Ana Souza');

    await expect(bruno.locator('.colab-card__esforco')).toContainText('índice');

    // Subaba Organograma (componente DISC_ORGANOGRAMA): Ana no topo liderando o Bruno; Carla na coluna "Sem posição"
    await page.click('#emp-subaba-organograma');
    const org = page.locator('#emp-organograma');
    await expect(org).toBeVisible();
    await expect(page.locator('#lista-colaboradores')).toHaveCount(0);
    await expect(org.locator('.orgx-cartao[data-org-id="p-bruno"]')).toHaveCount(1);
    await expect(org.locator('.orgx-sem .orgx-cartao[data-org-id="' + idCarla + '"]')).toHaveCount(1);
    await expect(org.locator('.orgx-sem .orgx-cartao[data-org-id="' + idAna + '"]')).toHaveCount(0);

    // Subaba Compatibilidade: mapa de compatibilidade, ritmo × foco e esforço de adaptação (só o Bruno fez a Parte 2)
    await page.click('#emp-subaba-compatibilidade');
    await expect(page.locator('#emp-compat')).toContainText('Harmonia da equipe');
    await expect(page.locator('#emp-pares > li')).toHaveCount(2);
    await expect(page.locator('#emp-mapa svg')).toHaveCount(1);
    await expect(page.locator('#emp-esforco > li')).toHaveCount(1);
    await expect(page.locator('#emp-esforco > li[data-pessoa="p-bruno"] .esforco-selo')).toHaveText(/^Esforço /);

    // Relatório da equipe com o encaixe de um candidato (Diego, de um processo)
    await page.click('#btn-relatorio-equipe');
    await page.check('#rel-incluir-candidato');
    await escolherBusca(page, 'rel-cand', 'Diego');
    await page.fill('#rel-cand-cargo', 'Vendedor');
    await escolherBusca(page, 'rel-cand-lider', 'Ana');
    await escolherBusca(page, 'rel-cand-colegas', 'Bruno');
    await page.click('#janela-ok');
    await expect(page.locator('#rel-modelo-previa')).toBeVisible();
    await expect(page.frameLocator('#rel-modelo-previa').locator('body')).toContainText('Loja Modelo');
    await page.click('#btn-rel-rascunho');
    await expect(page.locator('#aviso-geral')).toHaveText('Rascunho salvo.');
    await page.click('#btn-rel-publicar');
    await expect(page.locator('#rel-modelo-link')).toContainText('/relatorio.html#r-tok-modelo-');
    await expect(page.locator('#rel-modelo-mensagem')).toContainText('relatório da equipe da Loja Modelo');
    const salvos = await chamadasSb(page, 'salvarRelatorioModelo');
    expect(salvos).toHaveLength(2);
    expect(salvos[0][1].id).toBeUndefined();
    expect(salvos[1][1].id).toBeTruthy();
    expect(salvos[1][1]).toMatchObject({ modelo: 'equipe', empresaId: 'emp2', publicar: true });
    expect(salvos[1][1].dados.modelo).toBe('equipe');
    expect(salvos[1][1].dados.foco).toBeTruthy();
    expect(JSON.stringify(salvos[1][1].dados)).not.toContain('5511977776666');
    const listaRel = page.locator('[id^="rel-modelos-e_"] li[data-status="publicado"]');
    await expect(listaRel).toHaveCount(1);
    await page.click('#btn-voltar-relatorio');
    await expect(page.locator('#vista-empresas h2')).toHaveText('Loja Modelo');
    await expect(page.locator('#emp-subaba-compatibilidade')).toHaveAttribute('aria-current', 'page');
    await page.click('#emp-subaba-relatorios');
    await expect(page.locator('[id^="rel-modelos-e_"]').locator('li')).toHaveCount(1);

    // Como liderar o Bruno (líder = Ana, da ligação)
    await page.click('#emp-subaba-colaboradores');
    await bruno.locator('[data-acao="como-liderar"]').click();
    await expect(page.locator('#rel-modelo-previa')).toBeVisible();
    await page.click('#btn-rel-publicar');
    const lidSalvo = (await chamadasSb(page, 'salvarRelatorioModelo')).pop()[1];
    expect(lidSalvo).toMatchObject({ modelo: 'lideranca', empresaId: 'emp2', pessoaId: 'p-bruno', publicar: true });
    expect(lidSalvo.dados.lider).toBeTruthy();
    await page.click('#btn-voltar-relatorio');

    // Relatório da pessoa: completo por padrão; "Simples" troca a prévia e é o que se publica
    await bruno.locator('[data-acao="relatorio-pessoa"]').click();
    await expect(page.locator('#btn-rel-completo')).toHaveAttribute('aria-pressed', 'true');
    await page.click('#btn-rel-simples');
    await expect(page.locator('#btn-rel-simples')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#rel-modelo-previa')).toBeVisible();
    await page.click('#btn-rel-publicar');
    const pesSalvo = (await chamadasSb(page, 'salvarRelatorioModelo')).pop()[1];
    expect(pesSalvo).toMatchObject({ modelo: 'pessoa', pessoaId: 'p-bruno', publicar: true });
    expect(pesSalvo.dados.variante).toBe('simples');
    await page.click('#btn-voltar-relatorio');

    // Mover a Carla para a Filial Norte: some da lista e vai para o histórico
    await page.locator('#lista-colaboradores > li[data-nome="Carla Dias"] [data-acao="mover"]').click();
    await page.click('#janela-ok');
    await expect(page.locator('#janela-erro')).toHaveText('Escolha a empresa de destino.');
    await escolherBusca(page, 'mover-destino', 'Filial');
    await page.click('#janela-ok');
    await expect(page.locator('#aviso-geral')).toHaveText('Carla Dias agora está em Filial Norte.');
    await expect(colabs).toHaveCount(2);
    await expect(page.locator('#emp-subaba-historico .subaba__n')).toHaveText('1');
    await page.click('#emp-subaba-historico');
    await expect(page.locator('#emp-historico')).toContainText('Carla Dias');
    expect((await chamadasSb(page, 'moverColaborador'))[0][1]).toMatchObject({ empresaId: 'emp1', cargo: 'Caixa' });
    await page.click('#btn-voltar-empresas');
    await expect(page.locator('#lista-empresas li[data-nome="Filial Norte"] .emp-contador')).toHaveText('1');
    await expect(page.locator('#lista-empresas li[data-nome="Loja Modelo"] .emp-contador')).toHaveText('2');
    await page.fill('#busca-empresas', 'loja');
    await expect(page.locator('#lista-empresas > li')).toHaveCount(1);
    await page.fill('#busca-empresas', '');

    // Excluir empresa com colaborador ativo: a janela já explica (sem o "não dá para desfazer") e oferece arquivar,
    // que vai para o fim da lista
    await page.locator('#lista-empresas li[data-nome="Filial Norte"] [data-acao="excluir"]').click();
    await expect(page.locator('#confirmar-desc')).toContainText('tem 1 colaborador ativo');
    await expect(page.locator('#confirmar-ok')).toHaveCount(0);
    await page.click('#escolha-arquivar');
    expect(await chamadasSb(page, 'excluirEmpresa')).toHaveLength(0);
    await expect(page.locator('#lista-empresas li[data-nome="Filial Norte"] .emp-arquivada')).toHaveText('Arquivada');
    await expect(page.locator('#lista-empresas > li').last()).toHaveAttribute('data-nome', 'Filial Norte');

    // Detalhe do candidato que é colaborador: atalhos "Relatório da pessoa" e "Como liderar"
    await abrirAba(page, 'lista');
    await page.locator('#lista-candidatos > li', { hasText: 'Bruno Lima Costa' }).getByRole('button', { name: /Ver detalhes/ }).click();
    await expect(page.locator('#det-vinculo')).toContainText('Colaborador(a) de Loja Modelo');
    // Natural × exigido, índice de esforço e mapa (Bruno respondeu a Parte 2; Diego não)
    await expect(page.locator('#det-parte2')).toBeVisible();
    // Foto enviada na resposta: aparece no detalhe e o admin pode removê-la (LGPD)
    await expect(page.locator('.det-avatar img')).toHaveCount(1);
    await page.click('#btn-remover-foto');
    await page.click('#confirmar-ok');
    await expect(page.locator('#aviso-geral')).toHaveText('Foto removida.');
    expect((await chamadasSb(page, 'removerFoto')).pop().slice(1)).toEqual(['r-p-bruno']);
    await expect(page.locator('.det-avatar img')).toHaveCount(0);
    await expect(page.locator('#btn-remover-foto')).toHaveCount(0);
    await expect(page.locator('#det-natural-exigido > li')).toHaveCount(4);
    await expect(page.locator('#det-esforco-indice')).toHaveText(/^\d+$/);
    await expect(page.locator('#det-esforco .esforco-selo')).toHaveText(/^Esforço /);
    await expect(page.locator('#det-mapa svg')).toHaveCount(1);
    await expect(page.locator('#btn-det-como-liderar')).toBeVisible();
    await page.click('#btn-det-rel-pessoa');
    await expect(page.locator('#rel-modelo-previa')).toBeVisible();
    // O menu continua em "Participantes" (o relatório foi aberto a partir do detalhe)
    await expect(page.locator('.aba[aria-current="page"]')).toHaveAttribute('data-aba', 'lista');
    // Prévia não salva: "← Voltar" pergunta antes de descartar
    await page.click('#btn-voltar-relatorio');
    await expect(page.locator('#confirmar-desc')).toContainText('A prévia do relatório ainda não foi salva');
    await page.click('#escolha-descartar');
    await expect(page.locator('#vista-detalhe h2')).toHaveText('Bruno Lima Costa');
    await page.keyboard.press('Escape');
    await page.locator('#lista-candidatos > li', { hasText: 'Diego Rocha' }).getByRole('button', { name: /Ver detalhes/ }).click();
    await expect(page.locator('#det-vinculo')).toHaveText('Sem vínculo ativo com empresa cadastrada.');
    await expect(page.locator('#det-parte2')).toHaveCount(0);
    await expect(page.locator('#btn-det-como-liderar')).toHaveCount(0);

    expect(erros.filter((e) => !/Blocked script execution in 'about:srcdoc'/.test(e))).toEqual([]);
  });

  test('empresa em subabas; organograma: arrastar da coluna "Sem posição" para o Topo e para um líder salva relações e topoIds', async ({ page }) => {
    const erros = coletarErros(page);
    await page.setViewportSize({ width: 1366, height: 900 });
    await simularEmpresas(page);
    await page.goto('/admin.html');
    await entrar(page, 'dona@empresa.com', 'senha-boa-1');
    await abrirAba(page, 'empresas');
    await page.click('#btn-nova-empresa');
    await page.fill('#emp-nome', 'Loja Modelo');
    await page.fill('#emp-cidade', 'Boa Vista / RR');
    await page.click('#janela-ok');
    for (const [nome, tel, cargo] of [['Ana Souza', '11988881111', 'Gerente'], ['Carla Dias', '11977770000', 'Caixa']]) {
      await page.click('#btn-add-colaborador');
      await page.fill('#colab-nome', nome);
      await page.fill('#colab-telefone', tel);
      await page.fill('#colab-cargo', cargo);
      await page.click('#janela-ok');
    }
    await page.click('#btn-add-colaborador');
    await escolherBusca(page, 'colab-pessoa', 'Bruno');
    await page.fill('#colab-cargo', 'Vendedor');
    await page.click('#janela-ok');
    await expect(page.locator('#lista-colaboradores > li')).toHaveCount(3);
    const id = async (nome) => page.locator('#lista-colaboradores > li[data-nome="' + nome + '"]').getAttribute('data-pessoa');
    const idAna = await id('Ana Souza'), idCarla = await id('Carla Dias');

    // Subabas: Colaboradores (padrão, com a contagem) | Organograma | Compatibilidade | Relatórios | Histórico
    await expect(page.locator('#emp-subabas .subaba')).toHaveText([/^Colaboradores\s*3$/, 'Organograma', 'Compatibilidade', 'Relatórios', /^Histórico\s*0$/]);
    await expect(page.locator('#emp-subaba-colaboradores')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('#emp-link')).toBeVisible();
    await expect(page.locator('#emp-organograma')).toHaveCount(0);
    await capturar(page, 'empresa-colaboradores');

    // Organograma: todos começam na coluna "Sem posição"
    await page.click('#emp-subaba-organograma');
    await expect(page.locator('#emp-subaba-organograma')).toHaveAttribute('aria-current', 'page');
    const org = page.locator('#emp-organograma');
    await expect(org.locator('.orgx-sem .orgx-cartao[data-org-id]')).toHaveCount(3);
    expect(await page.locator('#vista-empresas select').count()).toBe(0);

    async function arrastar(de, para) {
      await page.waitForTimeout(400); // animação do redesenho
      const a = await page.locator(de).first().boundingBox();
      const b = await page.locator(para).first().boundingBox();
      await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
      await page.mouse.down();
      await page.mouse.move(a.x + a.width / 2 + 12, a.y + a.height / 2 + 12, { steps: 4 });
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 14 });
      await page.mouse.up();
    }
    const cartao = (pid) => '#emp-organograma .orgx-cartao[data-org-id="' + pid + '"]';
    const ultima = async () => (await chamadasSb(page, 'salvarRelacoes')).pop();

    // Ana para o Topo (sem liderados ainda): vai para o banco em topoIds
    await arrastar(cartao(idAna), '#emp-organograma .orgx-topo');
    await expect(page.locator('#emp-org-status')).toHaveText('Salvo');
    let s = await ultima();
    expect(s.slice(1)).toEqual(['emp1', [], { topoIds: [idAna] }]);
    await expect(org.locator('.orgx-sem .orgx-cartao[data-org-id]')).toHaveCount(2);

    // Bruno, da coluna, sobre a Ana: passa a ser liderado dela
    await arrastar(cartao('p-bruno'), cartao(idAna));
    await expect(page.locator('#emp-org-status')).toHaveText('Salvo');
    s = await ultima();
    expect(s[2]).toEqual([{ de: idAna, para: 'p-bruno', tipo: 'lidera' }]);
    expect(s[3].topoIds).toEqual([idAna]);
    await expect(org.locator('.orgx-sem .orgx-cartao[data-org-id]')).toHaveCount(1);
    await expect(org.locator('.orgx-sem .orgx-cartao[data-org-id="' + idCarla + '"]')).toHaveCount(1);
    await expect(org.locator('svg path').first()).toBeAttached();
    await capturar(page, 'empresa-organograma');

    // Os outros lugares acompanham: cartão do Bruno mostra a líder
    await page.click('#emp-subaba-colaboradores');
    await expect(page.locator('#lista-colaboradores > li[data-nome="Bruno Lima Costa"] .colab-card__ligacoes')).toContainText('Líder: Ana Souza');
    await page.click('#emp-subaba-compatibilidade');
    await expect(page.locator('#emp-compat')).toContainText('Harmonia da equipe');
    await capturar(page, 'empresa-compatibilidade');
    await page.click('#emp-subaba-relatorios');
    await expect(page.locator('#btn-emp-rel-equipe')).toBeEnabled();
    await expect(page.locator('[id^="rel-modelos-e_"]')).toContainText('Nenhum relatório salvo ainda.');
    await capturar(page, 'empresa-relatorios');
    await page.click('#emp-subaba-historico');
    await expect(page.locator('#emp-historico')).toContainText('Ninguém saiu desta empresa');
    await capturar(page, 'empresa-historico');
    // Voltar à lista e abrir de novo: o Topo e as ligações vêm do servidor (sem localStorage)
    await page.click('#btn-voltar-empresas');
    expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => /org/.test(k)))).toEqual([]);
    await page.locator('#lista-empresas li[data-nome="Loja Modelo"] [data-acao="abrir"]').click();
    await expect(page.locator('#emp-subaba-colaboradores')).toHaveAttribute('aria-current', 'page');
    expect(erros.filter((e) => !/Blocked script execution in 'about:srcdoc'/.test(e))).toEqual([]);
  });

  test('"Minha foto": envia pelo menu (reduzida para JPEG), aparece no topo e na aba Usuários', async ({ page }) => {
    const erros = coletarErros(page);
    await page.setViewportSize({ width: 375, height: 800 });
    await simularEmpresas(page);
    await page.goto('/admin.html');
    await entrar(page, 'dona@empresa.com', 'senha-boa-1');
    await expect(page.locator('#usuario-inicial img')).toHaveCount(0);
    await abrirMenuUsuario(page);
    await page.click('#btn-minha-foto');
    await expect(page.locator('#janela-minha-foto')).toBeVisible();
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGP47MIKRwzEcQAQshPB9DJ7EQAAAABJRU5ErkJggg==', 'base64');
    await page.setInputFiles('#minha-foto-arquivo', { name: 'eu.png', mimeType: 'image/png', buffer: png });
    await expect(page.locator('#minha-foto-status')).toContainText('Foto pronta');
    await expect(page.locator('#minha-foto-previa img')).toHaveCount(1);
    await page.click('#janela-ok');
    await expect(page.locator('#aviso-geral')).toHaveText('Foto salva.');
    const foto = (await chamadasSb(page, 'salvarMinhaFoto'))[0][1];
    expect(foto).toMatch(/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/);
    expect(foto.length).toBeLessThanOrEqual(40000);
    await expect(page.locator('#usuario-inicial img')).toHaveCount(1);
    await abrirAba(page, 'usuarios');
    await expect(page.locator('#lista-usuarios li[data-email="dona@empresa.com"] .avatar img')).toHaveCount(1);
    await expect(page.locator('#lista-usuarios li[data-email="pendente@empresa.com"] .avatar__iniciais')).toHaveText('CP');
    // Remover
    await abrirMenuUsuario(page);
    await page.click('#btn-minha-foto');
    await page.click('#btn-minha-foto-remover');
    await page.click('#janela-ok');
    await expect(page.locator('#aviso-geral')).toHaveText('Foto removida.');
    expect((await chamadasSb(page, 'salvarMinhaFoto'))[1][1]).toBe('');
    await expect(page.locator('#usuario-inicial img')).toHaveCount(0);

    expect(erros.filter((e) => !/Blocked script execution in 'about:srcdoc'/.test(e))).toEqual([]);
  });

  test('processo de equipe escolhe a empresa cadastrada (lista com busca) e vira o link do teste da equipe', async ({ page }) => {
    const erros = coletarErros(page);
    await simularEmpresas(page);
    await page.goto('/admin.html');
    await entrar(page, 'dona@empresa.com', 'senha-boa-1');
    await abrirAba(page, 'empresas');
    await page.click('#btn-nova-empresa');
    await page.fill('#emp-nome', 'Loja Modelo');
    await page.click('#janela-ok');
    await expect(page.locator('#btn-criar-link-equipe')).toBeVisible();
    await page.click('#btn-criar-link-equipe');
    await expect(page.locator('#form-processo')).toBeVisible();
    await expect(page.locator('#proc-tipo')).toHaveAttribute('value', 'equipe');
    await expect(page.locator('#proc-empresa-id')).toContainText('Loja Modelo');
    await expect(page.locator('#proc-empresa')).toHaveValue('Loja Modelo');
    await expect(page.locator('#proc-equipe-texto')).toContainText('compartilhado com a empresa');
    expect(await page.locator('#vista-processos select').count()).toBe(0);
    await page.fill('#proc-nome', 'Equipe 2026');
    await page.click('#btn-salvar-processo');
    await expect(page.locator('#aviso-geral')).toContainText('Processo criado');
    const salvo = (await chamadasSb(page, 'processosSalvar'))[0][1];
    expect(salvo).toMatchObject({ tipo: 'equipe', empresaId: 'emp1', empresa: 'Loja Modelo' });

    // Seleção comum: trocar o tipo some com o texto da equipe
    await abrirAba(page, 'processos');
    await page.click('#btn-novo-processo');
    await expect(page.locator('#proc-equipe-texto')).toBeHidden();
    await escolher(page, '#proc-tipo', 'equipe');
    await expect(page.locator('#proc-equipe-texto')).toContainText('Escolha a empresa cadastrada');
    await escolherBusca(page, 'proc-empresa-id', 'Loja');
    await expect(page.locator('#proc-equipe-texto')).toContainText('cadastro da empresa Loja Modelo');

    // Página da empresa mostra o link do teste da equipe (o formulário preenchido pergunta antes de sair)
    await abrirAba(page, 'empresas');
    await expect(page.locator('#confirmar-titulo')).toHaveText('Sair sem salvar?');
    await page.click('#escolha-descartar');
    await page.locator('#lista-empresas li[data-nome="Loja Modelo"] [data-acao="abrir"]').click();
    await expect(page.locator('#emp-link-teste')).toContainText('index.html?a=EQ');
    expect(erros).toEqual([]);
  });

  test('celular (375px): empresa, colaboradores e janela de ligações sem rolagem lateral', async ({ page }) => {
    const erros = coletarErros(page);
    await page.setViewportSize({ width: 375, height: 800 });
    await simularEmpresas(page);
    await page.goto('/admin.html');
    await entrar(page, 'dona@empresa.com', 'senha-boa-1');
    await abrirAba(page, 'empresas');
    await page.click('#btn-nova-empresa');
    await page.fill('#emp-nome', 'Empresa com um nome bem comprido para testar a quebra de linha no celular');
    await page.click('#janela-ok');
    for (const nome of ['Ana Souza', 'Maria Eduarda Albuquerque Figueiredo']) {
      await page.click('#btn-add-colaborador');
      await page.fill('#colab-nome', nome);
      await page.fill('#colab-telefone', '11988881' + String(nome.length).padStart(3, '0'));
      await page.fill('#colab-cargo', 'Coordenadora de atendimento ao cliente');
      await page.click('#janela-ok');
    }
    await expect(page.locator('#lista-colaboradores > li')).toHaveCount(2);
    expect(await semRolagemLateral(page)).toBe(true);
    await page.locator('#lista-colaboradores > li').first().locator('[data-acao="ligacoes"]').click();
    await page.click('#lig-diretos');
    await expect(page.locator('#lig-diretos-painel')).toBeVisible();
    expect(await semRolagemLateral(page)).toBe(true);
    const fonte = await page.locator('#lig-diretos-busca').evaluate((n) => getComputedStyle(n).fontSize);
    expect(fonte).toBe('16px');
    await page.locator('#lig-diretos-lista [role="option"]').first().click();
    await page.click('#lig-diretos-pronto');
    await page.click('#janela-ok');
    await page.click('#emp-subaba-compatibilidade');
    await expect(page.locator('#emp-pares > li')).toHaveCount(1);
    expect(await semRolagemLateral(page)).toBe(true);
    expect(erros.filter((e) => !/Blocked script execution in 'about:srcdoc'/.test(e))).toEqual([]);
  });

  test('prévia (API simulada): empresa de exemplo com colaboradores, organograma, mapa e relatório da equipe publicado', async ({ page }) => {
    const erros = coletarErros(page);
    await configurar(page, { API_URL: 'simulada' });
    await page.goto('/admin.html');
    await entrar(page, 'admin@previa.com', 'previa123');
    await expect(page.locator('#faixa-banco')).toBeHidden();
    await abrirAba(page, 'empresas');
    const card = page.locator('#lista-empresas > li').first();
    await expect(card).toBeVisible();
    await card.locator('[data-acao="abrir"]').click();
    await expect(page.locator('#lista-colaboradores > li').first()).toBeVisible();
    const n = await page.locator('#lista-colaboradores > li').count();
    await expect(page.locator('#vista-empresas .emp-secao__titulo')).toHaveText('Colaboradores ativos (' + n + ')');
    await page.click('#emp-subaba-organograma');
    await expect(page.locator('#emp-organograma .orgx-cartao[data-org-id]')).toHaveCount(n);
    await page.click('#emp-subaba-compatibilidade');
    await expect(page.locator('#emp-compat')).toContainText('Harmonia da equipe');
    await page.click('#btn-relatorio-equipe');
    await page.click('#janela-ok');
    await expect(page.locator('#rel-modelo-previa')).toBeVisible();
    await page.click('#btn-rel-publicar');
    await expect(page.locator('#rel-modelo-link')).toContainText('relatorio.html');
    expect(erros.filter((e) => !/Blocked script execution in 'about:srcdoc'/.test(e))).toEqual([]);
  });

  test('prévia (API simulada, celular 375px): Parte 2 ligada no processo da equipe, mapa ritmo × foco, esforço e detail natural × exigido', async ({ page }) => {
    const erros = coletarErros(page);
    await page.setViewportSize({ width: 375, height: 800 });
    await configurar(page, { API_URL: 'simulada' });
    await page.goto('/admin.html');
    await entrar(page, 'admin@previa.com', 'previa123');

    // Contagens do seed (não números fixos): colaboradores e quantos têm a Parte 2
    await abrirAba(page, 'empresas');
    const card = page.locator('#lista-empresas > li').first();
    await card.locator('[data-acao="abrir"]').click();
    await expect(page.locator('#lista-colaboradores > li').first()).toBeVisible();
    const comTeste = await page.locator('#lista-colaboradores > li .colab-card__codigo').count();
    const comEsforco = await page.locator('#lista-colaboradores > li .colab-card__esforco').count();
    expect(comEsforco).toBeGreaterThan(0);
    await page.click('#emp-subaba-compatibilidade');
    await expect(page.locator('#emp-mapa svg')).toHaveCount(1);
    await expect(page.locator('#emp-esforco > li')).toHaveCount(comEsforco);
    expect(comTeste).toBeGreaterThanOrEqual(comEsforco);
    // Do maior para o menor esforço
    const indices = await page.locator('#emp-esforco .esforco-item__indice').allTextContents();
    expect(indices.map(Number)).toEqual(indices.map(Number).slice().sort((a, b) => b - a));
    expect(await semRolagemLateral(page)).toBe(true);

    // Processo da equipe: resumo "Segunda parte do teste: Ligada"
    await page.click('#emp-subaba-colaboradores');
    await page.locator('#emp-link').getByRole('button', { name: 'Abrir o processo' }).click();
    await expect(page.locator('#proc-parte2-resumo')).toHaveAttribute('data-parte2', 'ligada');
    await expect(page.locator('#proc-parte2-resumo')).toContainText('Ligada');
    expect(await semRolagemLateral(page)).toBe(true);

    // Detalhe de uma resposta com a Parte 2
    await abrirAba(page, 'lista');
    const linhas = page.locator('#lista-candidatos > li');
    await expect(linhas.first()).toBeVisible();
    const n = await linhas.count();
    let achou = false;
    for (let i = 0; i < n && !achou; i++) {
      await linhas.nth(i).getByRole('button', { name: /Ver detalhes/ }).click();
      await expect(page.locator('#vista-detalhe h2')).toBeVisible();
      if (await page.locator('#det-parte2').count()) achou = true;
      else await page.keyboard.press('Escape');
    }
    expect(achou).toBe(true);
    await expect(page.locator('#det-natural-exigido > li')).toHaveCount(4);
    await expect(page.locator('#det-esforco-indice')).toHaveText(/^\d+$/);
    await expect(page.locator('#det-mapa svg')).toHaveCount(1);
    expect(await semRolagemLateral(page)).toBe(true);
    expect(erros.filter((e) => !/Blocked script execution in 'about:srcdoc'/.test(e))).toEqual([]);
  });

  /* ----- Rodada 4: mover resposta, contratar, aba Relatórios e aviso de banco desatualizado ----- */

  const PROCS_INICIAIS = [
    { id: 'proc-a', codigo: 'SEL1', nome: 'Vendedor Centro', empresa: 'Loja Modelo', tipo: 'selecao', ativa: true, respostas: 2 },
    { id: 'proc-b', codigo: 'SEL2', nome: 'Vendedor Shopping', empresa: 'Loja Modelo', tipo: 'selecao', ativa: true, respostas: 0 }
  ];

  async function criarLojaModelo(page) {
    await abrirAba(page, 'empresas');
    await page.click('#btn-nova-empresa');
    await page.fill('#emp-nome', 'Loja Modelo');
    await page.fill('#emp-cidade', 'Boa Vista / RR');
    await page.click('#janela-ok');
    await expect(page.locator('#vista-empresas h2')).toHaveText('Loja Modelo');
  }

  test('detalhe do candidato: "Mover para outro processo" e "Adicionar à empresa (contratar)" com link para a empresa', async ({ page }) => {
    const erros = coletarErros(page);
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.addInitScript((p) => { window.__procsIniciais = p; }, PROCS_INICIAIS);
    await simularEmpresas(page);
    await page.goto('/admin.html');
    await entrar(page, 'dona@empresa.com', 'senha-boa-1');
    await expect(page.locator('#faixa-banco')).toBeHidden();
    await criarLojaModelo(page);

    await abrirAba(page, 'lista');
    await page.locator('#lista-candidatos > li', { hasText: 'Diego Rocha' }).getByRole('button', { name: /Ver detalhes/ }).click();
    await expect(page.locator('#det-avaliacao')).toContainText('Vendedor Centro');
    await expect(page.locator('#btn-mover-processo')).toBeVisible();
    await expect(page.locator('#btn-contratar')).toHaveText('Adicionar à empresa (contratar)');
    await expect(page.locator('#det-empresa-vinculo')).toBeHidden();
    await capturar(page, 'detalhe-botoes');

    // Mover: lista com busca dos processos (sem o atual), "Sem processo" no topo
    await page.click('#btn-mover-processo');
    await expect(page.locator('#janela-mover-processo')).toBeVisible();
    await page.click('#janela-ok');
    await expect(page.locator('#janela-erro')).toHaveText('Escolha o processo de destino.');
    await page.click('#mover-processo');
    // "Escolher o processo" é só o texto do botão: não aparece como opção clicável
    await expect(page.locator('#mover-processo-lista [role="option"]')).toHaveText([/Sem processo/, /Vendedor Shopping \(SEL2\)/]);
    await page.fill('#mover-processo-busca', 'shopping');
    await page.locator('#mover-processo-lista [role="option"]', { hasText: 'Vendedor Shopping' }).click();
    await page.click('#janela-ok');
    await expect(page.locator('#aviso-geral')).toHaveText('Resposta movida para "Vendedor Shopping".');
    await expect(page.locator('#det-avaliacao')).toContainText('Vendedor Shopping');
    expect((await chamadasSb(page, 'moverResposta'))[0]).toEqual(['tk-dona', 'r-p-diego', 'proc-b']);

    // Contratar: escolhe a empresa, cargo vem da vaga; depois mostra "Colaborador(a) em Loja Modelo" com link
    await page.click('#btn-contratar');
    await expect(page.locator('#janela-contratar')).toBeVisible();
    await expect(page.locator('#contratar-cargo')).toHaveValue('Vendedor');
    await page.click('#janela-ok');
    await expect(page.locator('#janela-erro')).toHaveText('Escolha a empresa.');
    await escolherBusca(page, 'contratar-empresa', 'Loja');
    await page.fill('#contratar-area', 'Comercial');
    await page.click('#janela-ok');
    await expect(page.locator('#aviso-geral')).toHaveText('Diego Rocha agora é colaborador(a) em Loja Modelo.');
    expect((await chamadasSb(page, 'contratarPessoa'))[0][1]).toEqual({ respostaId: 'r-p-diego', empresaId: 'emp1', cargo: 'Vendedor', area: 'Comercial' });
    await expect(page.locator('#det-empresa-vinculo')).toContainText('Colaborador(a) em Loja Modelo · Vendedor');
    await capturar(page, 'detalhe-contratado');
    await page.click('#det-link-empresa');
    await expect(page.locator('#vista-empresas h2')).toHaveText('Loja Modelo');
    await expect(page.locator('#lista-colaboradores > li[data-nome="Diego Rocha"]')).toHaveCount(1);
    expect(erros.filter((e) => !/Blocked script execution in 'about:srcdoc'/.test(e))).toEqual([]);
  });

  test('aba Relatórios: 5 modelos com "Ver exemplo", assistente gera e publica, gerados com filtro e excluir', async ({ page }) => {
    const erros = coletarErros(page);
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.addInitScript((p) => {
      window.__procsIniciais = p;
      window.__relProcessos = [{ token: 'tok-proc-1', processoId: 'proc-a', status: 'publicado', criadoEm: '2026-10-02T10:00:00Z', publicadoEm: '2026-10-02T11:00:00Z' }];
    }, PROCS_INICIAIS);
    await simularEmpresas(page);
    await page.goto('/admin.html');
    await entrar(page, 'dona@empresa.com', 'senha-boa-1');
    await criarLojaModelo(page);
    await page.click('#btn-add-colaborador');
    await escolherBusca(page, 'colab-pessoa', 'Bruno');
    await page.fill('#colab-cargo', 'Vendedor');
    await page.click('#janela-ok');
    await expect(page.locator('#lista-colaboradores > li')).toHaveCount(1);

    // Modelos: 5 cartões com para quem é e o que responde
    await abrirAba(page, 'relatorios');
    await expect(page.locator('#rel-subaba-modelos')).toHaveAttribute('aria-current', 'page');
    const cartoes = page.locator('#lista-modelos > li');
    await expect(cartoes.locator('.modelo-card__titulo')).toHaveText(['Pessoa · completo', 'Pessoa · simples', 'Como liderar', 'Equipe', 'Processo seletivo']);
    for (const c of await cartoes.all()) {
      await expect(c).toContainText('Para quem é');
      await expect(c).toContainText('O que responde');
    }
    await capturar(page, 'relatorios-modelos');

    // "Ver exemplo" de cada um abre a prévia com dados fictícios
    const esperado = { 'pessoa-completo': /Marina/, 'pessoa-simples': /Marina/, lideranca: /Rafael/, equipe: /Loja Exemplo/, processo: /Cartório Exemplo/ };
    for (const [chave, texto] of Object.entries(esperado)) {
      await page.locator('#modelo-' + chave + ' [data-acao="ver-exemplo"]').click();
      await expect(page.locator('#rel-exemplo-previa')).toBeVisible();
      await expect(page.frameLocator('#rel-exemplo-previa').locator('body')).toContainText(texto);
      if (chave === 'equipe') await capturar(page, 'relatorios-exemplo-equipe');
      await page.click('#btn-exemplo-voltar');
      await expect(page.locator('#lista-modelos')).toBeVisible();
    }

    // Assistente: modelo -> para quem -> prévia -> publicar -> link e mensagem
    await page.locator('#modelo-equipe [data-acao="gerar"]').click();
    await expect(page.locator('#assist-modelo-equipe')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#assist-passos li[aria-current="step"]')).toContainText('Para quem');
    await page.click('#btn-assist-gerar');
    await expect(page.locator('#assist-erro')).toHaveText('Escolha a empresa.');
    await escolherBusca(page, 'assist-empresa', 'Loja');
    await capturar(page, 'relatorios-assistente');
    await page.click('#btn-assist-gerar');
    await expect(page.locator('#rel-modelo-previa')).toBeVisible();
    await expect(page.locator('#assist-passos li[aria-current="step"]')).toContainText('Prévia e envio');
    await expect(page.frameLocator('#rel-modelo-previa').locator('body')).toContainText('Loja Modelo');
    await page.click('#btn-rel-publicar');
    await expect(page.locator('#rel-modelo-link')).toContainText('/relatorio.html#r-tok-modelo-');
    await expect(page.locator('#rel-modelo-mensagem')).toContainText('relatório da equipe da Loja Modelo');
    expect((await chamadasSb(page, 'salvarRelatorioModelo')).pop()[1]).toMatchObject({ modelo: 'equipe', empresaId: 'emp1', publicar: true });
    await capturar(page, 'relatorios-assistente-publicado');

    // Também gera o relatório da pessoa (simples) pelo assistente, como rascunho
    await page.click('#btn-voltar-relatorio');
    await page.click('#btn-rel-novo');
    await page.click('#assist-modelo-pessoa-simples');
    await escolherBusca(page, 'assist-pessoa', 'Diego');
    await page.click('#btn-assist-gerar');
    await expect(page.locator('#btn-rel-simples')).toHaveAttribute('aria-pressed', 'true');
    await page.click('#btn-rel-rascunho');
    await expect(page.locator('#aviso-geral')).toHaveText('Rascunho salvo.');
    expect((await chamadasSb(page, 'salvarRelatorioModelo')).pop()[1]).toMatchObject({ modelo: 'pessoa', pessoaId: 'p-diego', publicar: false });

    // Gerados: os dois dos modelos + o do processo, com filtros
    await page.click('#btn-voltar-relatorio');
    await expect(page.locator('#rel-subaba-gerados')).toHaveAttribute('aria-current', 'page');
    const linhas = page.locator('#lista-gerados > li[data-id]');
    await expect(linhas).toHaveCount(3);
    await expect(page.locator('#gerados-contagem')).toHaveText('3 de 3 relatórios');
    await expect(linhas.filter({ hasText: 'Processo seletivo · Vendedor Centro' })).toHaveCount(1);
    await capturar(page, 'relatorios-gerados');
    await escolher(page, '#filtro-rel-modelo', 'processo');
    await expect(linhas).toHaveCount(1);
    await expect(linhas.first()).toHaveAttribute('data-tipo', 'processo');
    await expect(linhas.first().locator('[data-acao="excluir"]')).toHaveCount(0);
    await escolher(page, '#filtro-rel-modelo', '');
    await escolher(page, '#filtro-rel-status', 'rascunho');
    await expect(linhas).toHaveCount(1);
    await expect(linhas.first()).toHaveAttribute('data-modelo', 'pessoa');
    await escolher(page, '#filtro-rel-status', '');
    await escolherBusca(page, 'filtro-rel-empresa', 'Loja');
    await expect(linhas).toHaveCount(2);
    await expect(page.locator('#gerados-contagem')).toHaveText('2 de 3 relatórios');
    // Excluir o da equipe
    await linhas.filter({ hasText: 'equipe' }).first().locator('[data-acao="excluir"]').click();
    await page.click('#confirmar-ok');
    await expect(page.locator('#aviso-geral')).toHaveText('Relatório excluído.');
    await expect(linhas).toHaveCount(1);
    expect(await chamadasSb(page, 'excluirRelatorioModelo')).toHaveLength(1);
    expect(await page.locator('#vista-relatorios select').count()).toBe(0);
    expect(erros.filter((e) => !/Blocked script execution in 'about:srcdoc'/.test(e))).toEqual([]);
  });

  test('faixa de banco desatualizado: lista as migrações que faltam; sem a função no banco, mesmo aviso', async ({ page }) => {
    const erros = coletarErros(page);
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.addInitScript(() => { window.__bancoFaltando = ['20261009120000_fotos', '20261010120000_mover_versao']; });
    await simularEmpresas(page);
    await page.goto('/admin.html');
    await entrar(page, 'dona@empresa.com', 'senha-boa-1');
    await expect(page.locator('#faixa-banco')).toBeVisible();
    await expect(page.locator('#faixa-banco-texto')).toHaveText('O banco de dados está desatualizado: faltam 20261009120000_fotos, 20261010120000_mover_versao. Peça para aplicar as migrações (veja docs/SUPABASE.md).');
    const faixaY = (await page.locator('#faixa-banco').boundingBox()).y;
    const abasY = (await page.locator('.abas').boundingBox()).y;
    expect(faixaY).toBeLessThan(abasY);
    await capturar(page, 'faixa-banco');
    await sairDoPainel(page);
    await expect(page.locator('#faixa-banco')).toBeHidden();

    await page.evaluate(() => { window.__bancoFaltando = 'sem-funcao'; });
    await entrar(page, 'dona@empresa.com', 'senha-boa-1');
    await expect(page.locator('#faixa-banco-texto')).toHaveText(/^O banco de dados está desatualizado: faltam as migrações mais recentes\. Peça para aplicar/);
    expect(erros).toEqual([]);
  });
});

/* ---------- Rodada 5: venda direta (aba Vendas e origem "pessoal" em Participantes) ---------- */

// Acrescenta ao DISC_API falso do Supabase a API de vendas (pedidos, cupons, pacotes, resumo) e respostas de origem 'pessoal'.
const API_VENDAS_FALSA = `
(function () {
  var sb = window.__sb;
  function ok(x) { return Promise.resolve(Object.assign({ ok: true }, x || {})); }
  function anotar(nome, args) { sb.chamadas.push({ nome: nome, args: JSON.parse(JSON.stringify(Array.prototype.slice.call(args))) }); }
  var agora = Date.now();
  function ha(horas) { return new Date(agora - horas * 3600000).toISOString(); }
  // "Hoje" de verdade mesmo logo depois da meia-noite: nunca recua além de metade do tempo desde 00:00 local.
  var meiaNoite = new Date(agora); meiaNoite.setHours(0, 0, 0, 0);
  // Escala proporcional (mantém a ordem entre os pedidos): até 0,5 h cabe sempre dentro de hoje.
  var escalaHoje = Math.min(1, (agora - meiaNoite.getTime()) / 3600000 / 2 / 0.5);
  function recente(horas) { return ha(horas * escalaHoje); }
  function resp(id, nome, tel, email, origem, respostas) {
    return { id: id, nome: nome, telefone: tel, email: email, origem: origem, status: 'em_analise', respostas: respostas,
      inicio: ha(30), fim: ha(29), duracaoSeg: 540, avaliacao: origem === 'pessoal' ? '' : 'SEL1', avaliacaoNome: origem === 'pessoal' ? '' : 'Vendedor 2026', recebidoEm: ha(29) };
  }
  sb.respostas = [
    resp('r-ana', 'Ana Lima Prado', '5511911112222', 'ana.lima@gmail.com', 'pessoal', '4321'.repeat(25)),
    resp('r-davi', 'Davi Souza', '5511933334444', 'davi@gmail.com', 'pessoal', '1234'.repeat(25)),
    resp('r-caio', 'Caio Processo', '5511955556666', '', 'processo', '3412'.repeat(25))
  ];
  sb.pedidos = [
    { id: 'ped-ana-0001', resposta_id: 'r-ana', pacote: 'completo', valor_centavos: 2900, status: 'pago', nome: 'Ana Lima Prado', email: 'ana.lima@gmail.com',
      telefone: '5511911112222', criado_em: recente(0.5), pago_em: recente(0.4), metodo: 'pix', asaas_cobranca_id: 'pay_123abc' },
    { id: 'ped-davi-002', resposta_id: 'r-davi', pacote: 'completo_plus', valor_centavos: 4900, status: 'aguardando', nome: 'Davi Souza', email: 'davi@gmail.com',
      criado_em: recente(0.2), metodo: 'pix', faturaUrl: 'https://sandbox.asaas.com/i/davi123' },
    { id: 'ped-bia-0003', resposta_id: 'r-bia', pacote: 'completo_plus', valor_centavos: 3920, status: 'pago', nome: 'Beatriz Nunes', email: 'bia@uol.com.br', cupom: 'LANC20',
      criado_em: ha(50), pago_em: ha(50), metodo: 'cartao' },
    { id: 'ped-eva-0004', resposta_id: 'r-eva', pacote: 'completo', valor_centavos: 0, status: 'cortesia', nome: 'Eva Reis', email: 'eva@gmail.com', cupom: 'PARCEIRO100',
      criado_em: ha(80), pago_em: ha(80), metodo: 'cupom' }
  ];
  sb.cupons = [{ codigo: 'LANC20', tipo: 'percentual', valor: 20, usos_max: 100, usos: 1, valido_ate: '2026-12-31', ativo: true, pacotes: [] }];
  sb.pacotes = [
    { chave: 'gratis', nome: 'Resumo grátis', preco_centavos: 0, preco_lancamento_centavos: null, lancamento_ate: null, ativo: true, ordem: 0 },
    { chave: 'completo', nome: 'Relatório completo', preco_centavos: 3900, preco_lancamento_centavos: 2900, lancamento_ate: '2099-12-31', ativo: true, ordem: 1 },
    { chave: 'completo_plus', nome: 'Completo + Parte 2', preco_centavos: 6900, preco_lancamento_centavos: 4900, lancamento_ate: '2099-12-31', ativo: true, ordem: 2 }
  ];
  Object.assign(window.DISC_API, {
    listar: function () { return ok({ itens: sb.respostas.slice() }); },
    listarPedidos: function (t, filtros) { anotar('listarPedidos', arguments); return ok({ pedidos: sb.pedidos.slice() }); },
    atualizarPedido: function (t, id, d) {
      anotar('atualizarPedido', arguments);
      var p = sb.pedidos.filter(function (x) { return x.id === id; })[0];
      p.status = d.status;
      if (d.status === 'estornado') p.reembolsado_em = new Date().toISOString();
      return ok({ pedido: p });
    },
    listarCupons: function () { return ok({ cupons: sb.cupons.slice() }); },
    salvarCupom: function (t, c) {
      anotar('salvarCupom', arguments);
      var x = sb.cupons.filter(function (y) { return y.codigo === c.codigo; })[0];
      if (!x) { x = { usos: 0 }; sb.cupons.push(x); }
      Object.assign(x, { codigo: c.codigo, tipo: c.tipo, valor: c.valor, usos_max: c.usosMax, valido_ate: c.validoAte, ativo: c.ativo, pacotes: c.pacotes });
      return ok({ cupom: x });
    },
    excluirCupom: function (t, codigo) { anotar('excluirCupom', arguments); sb.cupons = sb.cupons.filter(function (c) { return c.codigo !== codigo; }); return ok(); },
    listarPacotes: function () { return ok({ pacotes: sb.pacotes.slice() }); },
    salvarPacote: function (t, p) {
      anotar('salvarPacote', arguments);
      var x = sb.pacotes.filter(function (y) { return y.chave === p.chave; })[0];
      Object.assign(x, { nome: p.nome, preco_centavos: p.precoCentavos, preco_lancamento_centavos: p.precoLancamentoCentavos, lancamento_ate: p.lancamentoAte, ativo: p.ativo, ordem: p.ordem });
      return ok({ pacote: x });
    },
    // Resumo do servidor: só a base da conversão (o resto o painel calcula dos pedidos).
    resumoVendas: function (t, periodo) { anotar('resumoVendas', arguments); return ok({ periodo: periodo, resumos: 8, compras: 3, conversao: 0.375 }); }
  });
})();
`;

async function simularVendas(page) {
  await simularSupabase(page);
  await page.route('**/js/api-supabase.js', (route) => route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: API_SUPABASE_FALSA + API_VENDAS_FALSA }));
}

// Capturas da aba Vendas (1366×900): só quando CAPTURAS_VENDAS aponta uma pasta.
async function capturarVendas(page, nome) {
  if (!process.env.CAPTURAS_VENDAS) return;
  await page.waitForTimeout(450);
  // O aviso flutuante de outra ação não entra na captura.
  if (nome !== 'cupons') await page.evaluate(() => { document.getElementById('aviso-geral').hidden = true; });
  await page.screenshot({ path: require('node:path').join(process.env.CAPTURAS_VENDAS, 'painel-vendas-' + nome + '.png'), fullPage: true });
}

test.describe('Vendas (venda direta, API falsa)', () => {
  test('aba Vendas: resumo, pedidos com filtro, reembolso com lembrete do Asaas, cortesia, cupons e pacotes', async ({ page, context }) => {
    const erros = coletarErros(page);
    await page.setViewportSize({ width: 1366, height: 900 });
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await simularVendas(page);
    await page.goto('/admin.html');
    await entrar(page, 'dona@empresa.com', 'senha-boa-1');
    expect(await abasVisiveis(page)).toEqual(['lista', 'processos', 'comparativo', 'importar', 'empresas', 'relatorios', 'vendas', 'divulgar', 'usuarios', 'conexoes']);

    // Resumo: receita com centavos, vendas, ticket médio, aguardando, conversão e últimos pedidos
    await abrirAba(page, 'vendas');
    await expect(page.locator('#vd-subaba-resumo')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('#vd-hoje')).toContainText('R$ 29,00');
    await expect(page.locator('#vd-hoje')).toContainText('1 venda');
    await expect(page.locator('#vd-semana')).toContainText('R$ 68,20');
    await expect(page.locator('#vd-semana')).toContainText('2 vendas');
    await expect(page.locator('#vd-ticket')).toContainText('R$ 34,10');
    await expect(page.locator('#vd-aguardando .resumo__valor')).toHaveText('1');
    await expect(page.locator('#vd-conversao .resumo__valor')).toHaveText('37,5%');
    await expect(page.locator('#vd-conversao')).toContainText('3 compras de 8 resumos grátis no mês');
    await expect(page.locator('#vd-ultimos > li')).toHaveCount(4);
    await expect(page.locator('#vd-ultimos > li').first()).toHaveAttribute('data-id', 'ped-davi-002');
    expect(await chamadasSb(page, 'resumoVendas')).toEqual([['tk-dona', 'mes']]);
    await capturarVendas(page, 'resumo');

    // Pedidos: filtros por situação, pacote, busca e período
    await page.click('#vd-subaba-pedidos');
    const linhas = page.locator('#vd-lista-pedidos > li[data-id]');
    await expect(linhas).toHaveCount(4);
    await expect(page.locator('#vd-contagem')).toHaveText('4 de 4 pedidos · R$ 68,20 pagos');
    await escolher(page, '#vd-filtro-status', 'aguardando');
    await expect(linhas).toHaveCount(1);
    await escolher(page, '#vd-filtro-status', '');
    await escolher(page, '#vd-filtro-pacote', 'completo_plus');
    await expect(linhas).toHaveCount(2);
    await escolher(page, '#vd-filtro-pacote', '');
    await page.fill('#vd-busca', 'lanc20');
    await expect(linhas).toHaveCount(1);
    await expect(linhas.first()).toHaveAttribute('data-id', 'ped-bia-0003');
    await page.fill('#vd-busca', '');
    await escolher(page, '#vd-filtro-periodo', 'hoje');
    await expect(linhas).toHaveCount(2);
    await capturarVendas(page, 'pedidos');
    await escolher(page, '#vd-filtro-periodo', '');

    // Detalhe do pedido pago: orientação para recuperar o link (o painel não recebe o token) e reembolso com confirmação
    await page.locator('#vd-lista-pedidos > li[data-id="ped-ana-0001"] button').click();
    await expect(page.locator('#vista-vendas h2')).toHaveText('Ana Lima Prado');
    await expect(page.locator('#vd-pedido-valor')).toHaveText('R$ 29,00');
    await expect(page.locator('#vd-pedido-orientacao')).toContainText('ana.lima@gmail.com');
    await expect(page.locator('#vd-pedido-recuperar')).toHaveText(/\/meu-relatorio\.html#recuperar$/);
    await expect(page.locator('#btn-vd-cortesia')).toHaveCount(0);
    await expect(page.locator('#btn-vd-cancelar')).toHaveCount(0);
    await expect(page.locator('#btn-vd-whatsapp')).toHaveAttribute('href', /^https:\/\/wa\.me\/5511911112222\?text=/);
    expect(await page.locator('#btn-vd-whatsapp').getAttribute('href')).toContain(encodeURIComponent('Gestão sem Caos'));
    await page.click('#btn-vd-copiar-orientacao');
    await expect(page.locator('#aviso-geral')).toHaveText('Mensagem copiada. Cole no WhatsApp ou no e-mail.');
    const msg = await page.evaluate(() => navigator.clipboard.readText());
    expect(msg).toContain('Olá, Ana!');
    expect(msg).toContain('meu-relatorio.html#recuperar');
    expect(msg).toContain('ana.lima@gmail.com');
    expect(msg).not.toContain('Notus');
    await expect(page.locator('#vd-pedido-resposta')).toContainText('Respondido em');
    await capturarVendas(page, 'pedido');
    await page.click('#btn-vd-reembolso');
    await expect(page.locator('#confirmar')).toBeVisible();
    await expect(page.locator('#vd-lembrete-asaas')).toContainText('devolva o dinheiro no Asaas');
    await expect(page.locator('#vd-lembrete-asaas')).toContainText('pay_123abc');
    await expect(page.locator('#vd-link-asaas')).toHaveAttribute('target', '_blank');
    await capturarVendas(page, 'reembolso');
    await page.click('#confirmar-cancelar');
    expect(await chamadasSb(page, 'atualizarPedido')).toHaveLength(0);
    await page.click('#btn-vd-reembolso');
    await page.click('#confirmar-ok');
    await expect(page.locator('#aviso-geral')).toContainText('Pedido marcado como reembolsado');
    await expect(page.locator('#vd-pedido-dados .vd-status')).toHaveText('Reembolsado');
    await expect(page.locator('#vd-pedido-sem-link')).toContainText('bloqueado');
    await expect(page.locator('#btn-vd-reembolso')).toHaveCount(0);
    await expect(page.locator('#btn-vd-cortesia')).toBeVisible();
    expect(await chamadasSb(page, 'atualizarPedido')).toEqual([['tk-dona', 'ped-ana-0001', { status: 'estornado' }]]);

    // Pedido aguardando: liberar como cortesia
    await page.click('#btn-vd-voltar');
    await page.locator('#vd-lista-pedidos > li[data-id="ped-davi-002"] button').click();
    await expect(page.locator('#vd-pedido-sem-link')).toContainText('quando o pagamento for confirmado');
    await expect(page.locator('#vd-link-fatura')).toHaveAttribute('href', 'https://sandbox.asaas.com/i/davi123');
    await expect(page.locator('#btn-vd-cancelar')).toBeVisible();
    await expect(page.locator('#btn-vd-reembolso')).toHaveCount(0);
    await page.click('#btn-vd-cortesia');
    await expect(page.locator('#confirmar-ok')).toHaveText('Liberar relatório');
    await page.click('#confirmar-ok');
    await expect(page.locator('#vd-pedido-dados .vd-status')).toHaveText('Cortesia');
    await expect(page.locator('#vd-pedido-orientacao')).toContainText('davi@gmail.com');
    await expect(page.locator('#btn-vd-cortesia')).toHaveCount(0);
    expect((await chamadasSb(page, 'atualizarPedido'))[1]).toEqual(['tk-dona', 'ped-davi-002', { status: 'cortesia' }]);

    // Cupons: criar (validação na janela), link da landing com o cupom, desativar
    await page.click('#btn-vd-voltar');
    await page.click('#vd-subaba-cupons');
    await expect(page.locator('#vd-lista-cupons > li[data-codigo="LANC20"]')).toContainText('20% de desconto');
    await page.click('#btn-novo-cupom');
    await page.fill('#cup-codigo', 'com espaço');
    await page.fill('#cup-valor', '20');
    await page.click('#janela-ok');
    await expect(page.locator('#janela-erro')).toContainText('O código precisa ter de 3 a 30');
    await page.fill('#cup-codigo', 'amigo10');
    await escolher(page, '#cup-tipo', 'valor');
    await expect(page.locator('#cup-valor-rotulo')).toHaveText('Desconto em R$ (ex.: 10,00)');
    await page.fill('#cup-valor', '10,50');
    await page.fill('#cup-usos', '30');
    await page.fill('#cup-validade', '2026-12-31');
    await page.check('#cup-pac-completo');
    await capturarVendas(page, 'cupom-novo');
    await page.click('#janela-ok');
    await expect(page.locator('#aviso-geral')).toHaveText('Cupom AMIGO10 criado.');
    expect((await chamadasSb(page, 'salvarCupom'))[0]).toEqual(['tk-dona', { codigo: 'AMIGO10', tipo: 'valor', valor: 1050, usosMax: 30, validoAte: '2026-12-31', pacotes: ['completo'], ativo: true }]);
    const amigo = page.locator('#vd-lista-cupons > li[data-codigo="AMIGO10"]');
    await expect(amigo).toContainText('R$ 10,50 de desconto');
    await expect(amigo).toContainText('0 de 30');
    await expect(amigo).toContainText('Relatório completo');
    // Cupom de um pacote só: o link já leva o pacote escolhido
    await expect(amigo.locator('.vd-cupom__link')).toHaveText(/\/descubra\.html\?pacote=completo&cupom=AMIGO10$/);
    await expect(page.locator('#vd-lista-cupons > li[data-codigo="LANC20"] .vd-cupom__link')).toHaveText(/\/descubra\.html\?cupom=LANC20$/);
    await amigo.locator('[data-acao="copiar-link"]').click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/descubra\.html\?pacote=completo&cupom=AMIGO10$/);
    await capturarVendas(page, 'cupons');
    await page.locator('#vd-lista-cupons > li[data-codigo="LANC20"] [data-acao="desativar"]').click();
    await expect(page.locator('#vd-lista-cupons > li[data-codigo="LANC20"]')).toHaveAttribute('data-ativo', 'nao');
    expect((await chamadasSb(page, 'salvarCupom'))[1][1]).toMatchObject({ codigo: 'LANC20', ativo: false });
    await amigo.locator('[data-acao="excluir"]').click();
    await page.click('#confirmar-ok');
    await expect(page.locator('#vd-lista-cupons > li[data-codigo="AMIGO10"]')).toHaveCount(0);

    // Pacotes: preço, preço de lançamento e data de fim, ativo e ordem
    await page.click('#vd-subaba-pacotes');
    const completo = page.locator('#vd-lista-pacotes > li[data-chave="completo"]');
    await expect(completo.locator('.vd-pacote__valor')).toHaveText('R$ 29,00');
    await expect(completo.locator('.vd-pacote__antes')).toHaveText('R$ 39,00');
    await completo.locator('[data-acao="editar"]').click();
    await page.fill('#pac-preco', '44,90');
    await page.fill('#pac-lancamento', '50');
    await page.click('#janela-ok');
    await expect(page.locator('#janela-erro')).toHaveText('O preço de lançamento precisa ser menor que o preço normal.');
    await page.fill('#pac-lancamento', '34,90');
    await page.fill('#pac-lancamento-ate', '2099-01-31');
    await page.click('#janela-ok');
    await expect(page.locator('#aviso-geral')).toHaveText('Pacote "Relatório completo" salvo.');
    expect((await chamadasSb(page, 'salvarPacote'))[0]).toEqual(['tk-dona', { chave: 'completo', nome: 'Relatório completo', precoCentavos: 4490, precoLancamentoCentavos: 3490, lancamentoAte: '2099-01-31', ativo: true, ordem: 1 }]);
    await expect(completo.locator('.vd-pacote__valor')).toHaveText('R$ 34,90');
    await expect(completo.locator('.vd-pacote__antes')).toHaveText('R$ 44,90');
    await expect(completo).toContainText('até 31/01/2099');
    await page.locator('#vd-lista-pacotes > li[data-chave="completo_plus"] [data-acao="editar"]').click();
    await page.uncheck('#pac-ativo');
    await page.click('#janela-ok');
    await expect(page.locator('#vd-lista-pacotes > li[data-chave="completo_plus"]')).toHaveAttribute('data-ativo', 'nao');
    await capturarVendas(page, 'pacotes');

    expect(await page.locator('#vista-vendas select').count()).toBe(0);
    expect(erros).toEqual([]);
  });

  test('participantes: selo "Pessoal", filtro de origem e o pedido ligado no detalhe', async ({ page }) => {
    const erros = coletarErros(page);
    await page.setViewportSize({ width: 1366, height: 900 });
    await simularVendas(page);
    await page.goto('/admin.html');
    await entrar(page, 'dona@empresa.com', 'senha-boa-1');
    const cards = page.locator('#lista-candidatos > li');
    await expect(cards).toHaveCount(3);
    const ana = cards.filter({ hasText: 'Ana Lima Prado' });
    await expect(ana.locator('.selo-pessoal')).toHaveText('Pessoal');
    await expect(ana.locator('.card-origem')).toHaveText('Mapa pessoal (venda direta)');
    await expect(cards.filter({ hasText: 'Caio Processo' }).locator('.selo-pessoal')).toHaveCount(0);
    await escolher(page, '#filtro-origem', 'pessoal');
    await expect(cards).toHaveCount(2);
    await escolher(page, '#filtro-origem', 'processo');
    await expect(cards).toHaveCount(1);
    await escolher(page, '#filtro-origem', '');
    await page.fill('#filtro-busca', 'davi@gmail');
    await expect(cards).toHaveCount(1);
    await page.fill('#filtro-busca', '');
    await capturarVendas(page, 'participantes');

    await ana.getByRole('button', { name: /Ver detalhes/ }).click();
    const ped = page.locator('#det-pedido');
    await expect(ped).toContainText('E-mail: ana.lima@gmail.com');
    await expect(ped.locator('.det-pedido__linha')).toHaveCount(1);
    await expect(ped).toContainText('Pago');
    await expect(ped).toContainText('Relatório completo · R$ 29,00');
    await capturarVendas(page, 'participante-detalhe');
    await ped.locator('[data-acao="abrir-pedido"]').click();
    await expect(page.locator('#vista-vendas')).toBeVisible();
    await expect(page.locator('#vista-vendas h2')).toHaveText('Ana Lima Prado');
    // De volta ao participante pelo pedido
    await page.click('#btn-vd-ver-resposta');
    await expect(page.locator('#vista-detalhe h2')).toHaveText('Ana Lima Prado');
    await page.keyboard.press('Escape');
    await expect(page.locator('#vista-vendas')).toBeVisible();

    // Participante pessoal sem pedido pago fica com o aviso; quem veio de processo não tem o bloco
    await abrirAba(page, 'lista');
    await cards.filter({ hasText: 'Caio Processo' }).getByRole('button', { name: /Ver detalhes/ }).click();
    await expect(page.locator('#det-pedido')).toHaveCount(0);
    expect(erros).toEqual([]);
  });

  test('sem a API de vendas no servidor, a aba Vendas e o filtro de origem não aparecem', async ({ page }) => {
    const erros = coletarErros(page);
    await simularSupabase(page);
    await page.goto('/admin.html');
    await entrar(page, 'dona@empresa.com', 'senha-boa-1');
    expect(await abasVisiveis(page)).not.toContain('vendas');
    expect(await abasVisiveis(page)).not.toContain('divulgar');
    await expect(page.locator('#filtro-origem')).toHaveCount(0);
    expect(erros).toEqual([]);
  });
});

/* ---------- Página de venda (subaba "Divulgar"): links da página e links com desconto ---------- */

// Capturas da subaba Divulgar (1366 px): só quando CAPTURAS_DIVULGAR aponta uma pasta.
async function capturarDivulgar(page, nome) {
  if (!process.env.CAPTURAS_DIVULGAR) return;
  await page.waitForTimeout(450);
  await page.evaluate(() => { document.getElementById('aviso-geral').hidden = true; });
  // Janela da altura da página (o menu lateral fixo sai inteiro na captura) e de volta a 1366×900.
  const altura = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: 1366, height: Math.max(900, altura) });
  await page.screenshot({ path: require('node:path').join(process.env.CAPTURAS_DIVULGAR, 'divulgar-' + nome + '.png') });
  await page.setViewportSize({ width: 1366, height: 900 });
}
// Data local (dd/mm/aaaa e aaaa-mm-dd) daqui a n dias, calculada no navegador.
async function daquiA(page, n) {
  return page.evaluate((dias) => {
    const h = new Date(); const d = new Date(h.getFullYear(), h.getMonth(), h.getDate() + dias);
    const p = (x) => String(x).padStart(2, '0');
    return { br: p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear(), iso: d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) };
  }, n);
}

test.describe('Página de venda (Divulgar)', () => {
  test('menu "Página de venda": links da página, link de R$ 0,50 do Completo + Parte 2, aviso abaixo do mínimo e cortesia', async ({ page, context }) => {
    const erros = coletarErros(page);
    await page.setViewportSize({ width: 1366, height: 900 });
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await simularVendas(page);
    await page.goto('/admin.html');
    await entrar(page, 'dona@empresa.com', 'senha-boa-1');

    // Abre pelo menu lateral; "Divulgar" é a primeira subaba
    await expect(page.locator('.aba[data-aba="divulgar"]')).toHaveText('Página de venda');
    await abrirAba(page, 'divulgar');
    await expect(page.locator('#vista-vendas h2')).toHaveText('Página de venda');
    await expect(page.locator('.aba[data-aba="divulgar"]')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('.aba[data-aba="vendas"]')).not.toHaveAttribute('aria-current', 'page');
    expect(await page.locator('#vd-subabas .subaba').evaluateAll((els) => els.map((e) => e.getAttribute('data-subaba')))).toEqual(['divulgar', 'resumo', 'pedidos', 'cupons', 'pacotes']);
    await expect(page.locator('#vd-subaba-divulgar')).toHaveAttribute('aria-current', 'page');

    // a) Sua página de venda + um link por pacote, com o preço de hoje
    await expect(page.locator('#dv-link-pagina .dv-link__url')).toHaveText(/^http:\/\/localhost:\d+\/descubra\.html$/);
    await expect(page.locator('#dv-link-completo .dv-link__url')).toHaveText(/\/descubra\.html\?pacote=completo$/);
    await expect(page.locator('#dv-link-completo')).toContainText('R$ 29,00');
    await expect(page.locator('#dv-link-completo_plus .dv-link__url')).toHaveText(/\/descubra\.html\?pacote=completo_plus$/);
    await expect(page.locator('#dv-link-completo_plus')).toContainText('R$ 49,00');
    const waPagina = await page.locator('#dv-link-pagina [data-acao="whatsapp"]').getAttribute('href');
    expect(waPagina).toMatch(/^https:\/\/wa\.me\/\?text=/);
    expect(decodeURIComponent(waPagina.split('text=')[1])).toContain('Gestão sem Caos');
    expect(decodeURIComponent(waPagina)).not.toContain('Notus');
    await expect(page.locator('#dv-link-completo_plus [data-acao="abrir"]')).toHaveAttribute('target', '_blank');
    await page.locator('#dv-link-completo_plus [data-acao="copiar"]').click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/descubra\.html\?pacote=completo_plus$/);

    // b) Formulário: já vem com o Completo + Parte 2 e R$ 0,50 (1 pessoa, 30 dias)
    const em30 = await daquiA(page, 30);
    await expect(page.locator('#dv-pac-completo_plus')).toBeChecked();
    await expect(page.locator('#dv-modo-teste')).toBeChecked();
    await expect(page.locator('#dv-usos-1')).toBeChecked();
    await expect(page.locator('#dv-validade')).toHaveValue(em30.iso);
    await expect(page.locator('#dv-codigo')).toHaveValue(/^PRO050-[A-Z0-9]{3}$/);
    await expect(page.locator('#dv-resumo')).toHaveText('O cliente paga R$ 0,50 em vez de R$ 49,00 no Completo + Parte 2. Vale para 1 pessoa até ' + em30.br + '.');
    await expect(page.locator('#dv-lista-links > li[data-codigo="LANC20"]')).toContainText('20% de desconto em todos os pacotes');
    await capturarDivulgar(page, 'inicial');

    // Abaixo do mínimo do Stripe: aviso e botão bloqueado, sem os botões mudarem de lugar
    const topoCriar = () => page.locator('#btn-dv-criar').evaluate((e) => Math.round(e.getBoundingClientRect().top + window.scrollY));
    const antes = await topoCriar();
    await page.locator('label[data-modo="valor"]').click();
    await page.fill('#dv-valor', '0,20');
    await expect(page.locator('#dv-aviso')).toBeVisible();
    await expect(page.locator('#dv-aviso')).toContainText('O Stripe só cobra a partir de R$ 0,50');
    await expect(page.locator('#dv-resumo')).toBeHidden();
    await expect(page.locator('#btn-dv-criar')).toBeDisabled();
    expect(Math.abs((await topoCriar()) - antes)).toBeLessThanOrEqual(1);
    await capturarDivulgar(page, 'aviso-minimo');
    // Por porcentagem também: 99% de R$ 49,00 = R$ 0,49
    await page.locator('label[data-modo="percentual"]').click();
    await page.fill('#dv-pct', '99');
    await expect(page.locator('#dv-aviso')).toContainText('R$ 0,49');
    await page.fill('#dv-pct', '20');
    await expect(page.locator('#dv-resumo')).toContainText('O cliente paga R$ 39,20 em vez de R$ 49,00');
    await expect(page.locator('#dv-codigo')).toHaveValue(/^PRO20-/);
    // Valor maior que o preço: erro
    await page.locator('label[data-modo="valor"]').click();
    await page.fill('#dv-valor', '60');
    await expect(page.locator('#dv-resumo')).toContainText('menor que o preço atual (R$ 49,00)');
    await expect(page.locator('#btn-dv-criar')).toBeDisabled();
    await page.fill('#dv-valor', '0,20');
    await page.click('#btn-dv-usar-050');
    await expect(page.locator('#dv-aviso')).toBeHidden();
    await expect(page.locator('#dv-modo-teste')).toBeChecked();
    await expect(page.locator('#dv-resumo')).toContainText('O cliente paga R$ 0,50 em vez de R$ 49,00');

    // Criar link -> cupom de valor (R$ 49,00 − R$ 0,50) só para o Completo + Parte 2
    const codigo = await page.locator('#dv-codigo').inputValue();
    expect(codigo).toMatch(/^PRO050-/);
    await page.click('#btn-dv-criar');
    await expect(page.locator('#dv-criado')).toBeVisible();
    await expect(page.locator('#aviso-geral')).toHaveText('Link criado com o cupom ' + codigo + '.');
    expect((await chamadasSb(page, 'salvarCupom'))[0]).toEqual(['tk-dona', { codigo, tipo: 'valor', valor: 4850, usosMax: 1, validoAte: em30.iso, pacotes: ['completo_plus'], ativo: true }]);
    const link = await page.locator('#dv-link-criado').textContent();
    expect(link).toMatch(new RegExp('/descubra\\.html\\?pacote=completo_plus&cupom=' + codigo + '$'));
    await expect(page.locator('#dv-criado-resumo')).toHaveText('O cliente paga R$ 0,50 em vez de R$ 49,00 no Completo + Parte 2. Vale para 1 pessoa até ' + em30.br + '.');
    const wa = await page.locator('#btn-dv-whatsapp').getAttribute('href');
    expect(wa).toMatch(/^https:\/\/wa\.me\/\?text=/);
    const msgWa = decodeURIComponent(wa.split('text=')[1]);
    expect(msgWa).toContain(link);
    expect(msgWa).toContain('Gestão sem Caos');
    expect(msgWa).toContain('R$ 0,50');
    await expect(page.locator('#btn-dv-abrir')).toHaveAttribute('href', link);
    await page.click('#btn-dv-copiar');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
    // c) Links criados: o novo primeiro, com usos e o desconto em texto
    const novo = page.locator('#dv-lista-links > li').first();
    await expect(novo).toHaveAttribute('data-codigo', codigo);
    await expect(novo).toContainText('Paga R$ 0,50 no Completo + Parte 2');
    await expect(novo).toContainText('0 de 1 uso');
    await expect(novo.locator('.dv-links__url')).toHaveText(link);
    await capturarDivulgar(page, 'link-criado');

    // Mesmo código de novo: recusado antes de chamar o servidor
    await page.click('#btn-dv-outro');
    await expect(page.locator('#dv-criar')).toBeVisible();
    await page.fill('#dv-codigo', codigo.toLowerCase());
    await expect(page.locator('#dv-codigo')).toHaveValue(codigo);
    await page.click('#btn-dv-criar');
    await expect(page.locator('#dv-erro')).toContainText('Já existe um cupom com o código ' + codigo);
    expect(await chamadasSb(page, 'salvarCupom')).toHaveLength(1);

    // Cortesia para um parceiro: 100%, código CORTESIA-…, Relatório completo, 5 pessoas
    await page.fill('#dv-codigo', '');
    await page.locator('label[data-pacote="completo"]').click();
    await page.locator('label[data-modo="gratis"]').click();
    await page.locator('label[data-usos="5"]').click();
    await expect(page.locator('#dv-codigo')).toHaveValue(/^CORTESIA-[A-Z0-9]{3}$/);
    await expect(page.locator('#dv-resumo')).toHaveText('O cliente recebe o Relatório completo de graça (em vez de R$ 29,00). Vale para 5 pessoas até ' + em30.br + '.');
    const cortesia = await page.locator('#dv-codigo').inputValue();
    await page.click('#btn-dv-criar');
    await expect(page.locator('#dv-link-criado')).toHaveText(new RegExp('/descubra\\.html\\?pacote=completo&cupom=' + cortesia + '$'));
    expect((await chamadasSb(page, 'salvarCupom'))[1]).toEqual(['tk-dona', { codigo: cortesia, tipo: 'percentual', valor: 100, usosMax: 5, validoAte: em30.iso, pacotes: ['completo'], ativo: true }]);
    await expect(page.locator('#dv-lista-links > li[data-codigo="' + cortesia + '"]')).toContainText('Grátis no Relatório completo');

    // Desativar um link na lista; "Ver todos os cupons" leva à subaba Cupons (link com o pacote)
    await page.locator('#dv-lista-links > li[data-codigo="' + cortesia + '"] [data-acao="desativar"]').click();
    await expect(page.locator('#dv-lista-links > li[data-codigo="' + cortesia + '"]')).toHaveCount(0);
    expect((await chamadasSb(page, 'salvarCupom'))[2][1]).toMatchObject({ codigo: cortesia, ativo: false });
    await page.click('#btn-dv-ver-cupons');
    await expect(page.locator('#vd-subaba-cupons')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('.aba[data-aba="vendas"]')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('#vd-lista-cupons > li[data-codigo="' + codigo + '"] .vd-cupom__link')).toHaveText(link);

    // "Vendas" no menu continua abrindo o Resumo
    await page.click('#vd-subaba-divulgar');
    await expect(page.locator('.aba[data-aba="divulgar"]')).toHaveAttribute('aria-current', 'page');
    await abrirAba(page, 'vendas');
    await expect(page.locator('#vd-subaba-resumo')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('.aba[data-aba="vendas"]')).toHaveAttribute('aria-current', 'page');

    expect(await page.locator('#vista-vendas select').count()).toBe(0);
    expect(erros).toEqual([]);
  });

  test('prévia: o link de R$ 0,50 criado no painel abre a landing e chega ao checkout com o pacote e o cupom aplicados', async ({ page }) => {
    const erros = coletarErros(page);
    await page.setViewportSize({ width: 1366, height: 900 });
    await configurar(page, { API_URL: 'simulada', GRUPOS_DEMONSTRACAO: 3 });
    await page.goto('/admin.html');
    await entrar(page, 'admin@previa.com', 'previa123');
    const temVendas = await page.evaluate(() => typeof window.DISC_API.listarPedidos === 'function');
    test.skip(!temVendas, 'API simulada sem a venda direta');
    await abrirAba(page, 'divulgar');
    await expect(page.locator('#dv-resumo')).toContainText('O cliente paga R$ 0,50 em vez de R$ 49,00 no Completo + Parte 2');
    const codigo = await page.locator('#dv-codigo').inputValue();
    await page.click('#btn-dv-criar');
    const link = await page.locator('#dv-link-criado').textContent();
    expect(link).toContain('descubra.html?pacote=completo_plus&cupom=' + codigo);

    // Landing: o card do Completo + Parte 2 em destaque e os CTAs levam pacote e cupom ao teste
    await page.goto(link);
    await expect(page.locator('.pacote--destaque')).toHaveAttribute('data-pacote', 'completo_plus');
    await expect(page.locator('a[data-cta="heroi"]')).toHaveAttribute('href', 'index.html?modo=pessoal&pacote=completo_plus&cupom=' + codigo);
    await page.locator('a[data-cta="heroi"]').click();
    await expect(page).toHaveURL(new RegExp('index\\.html\\?modo=pessoal&pacote=completo_plus&cupom=' + codigo + '$'));

    // Teste (modo demonstração: 3 grupos) até o resumo grátis
    await expect(page.locator('h1')).toHaveText('Antes de começar');
    await page.fill('#nome', 'Paulo Link Teste');
    await page.fill('#email', 'paulo.link@exemplo.com');
    await page.check('#consentimento');
    await page.locator('#form-identificacao button[type="submit"]').click();
    for (let i = 0; i < 3; i++) {
      await expect(page.locator('.progresso-topo')).toContainText('Grupo ' + (i + 1) + ' de 3');
      await page.locator('[data-acao="confirmar-ordem"]').click();
      await page.locator('[data-acao="proximo"]').click();
    }
    await expect(page.locator('.resumo-gratis')).toBeVisible();
    // O pacote do link vem escolhido; no checkout, o cupom já vem preenchido e o valor cai para R$ 0,50
    await expect(page.locator('.pacote--destaque')).toHaveAttribute('data-pacote', 'completo_plus');
    await expect(page.locator('.pacote--destaque .pacote-selo')).toHaveText('Sua escolha');
    await page.locator('[data-acao="comprar"][data-pacote="completo_plus"]').click();
    await expect(page.locator('#ck-cupom')).toHaveValue(codigo);
    await expect(page.locator('#ck-cupom')).toBeVisible();
    await page.locator('[data-ck="continuar"]').click();
    await expect(page.locator('[data-ck-tela="pagamento"]')).toBeVisible();
    await expect(page.locator('#ck-valor')).toHaveText('R$ 0,50');
    await expect(page.locator('[data-ck-tela="pagamento"] .ck-pacote-nome')).toHaveText('Completo + Parte 2');
    expect(erros).toEqual([]);
  });
});

test('prévia (API simulada): aba Vendas abre as quatro subabas sem erro', async ({ page }) => {
  const erros = coletarErros(page);
  await page.setViewportSize({ width: 1366, height: 900 });
  await configurar(page, { API_URL: 'simulada' });
  await page.goto('/admin.html');
  await entrar(page, 'admin@previa.com', 'previa123');
  const temVendas = await page.evaluate(() => typeof window.DISC_API.listarPedidos === 'function');
  test.skip(!temVendas, 'API simulada ainda sem a venda direta');
  await abrirAba(page, 'vendas');
  await expect(page.locator('#vd-hoje')).toContainText('R$');
  await expect(page.locator('#vd-erro')).toHaveCount(0);
  await page.click('#vd-subaba-pedidos');
  await expect(page.locator('#vd-contagem')).toContainText('pedido');
  await page.click('#vd-subaba-cupons');
  await expect(page.locator('#vd-lista-cupons')).toBeVisible();
  await page.click('#vd-subaba-pacotes');
  await expect(page.locator('#vd-lista-pacotes > li')).toHaveCount(3);
  await capturarVendas(page, 'previa-pacotes');
  expect(erros).toEqual([]);
});

/* ----- Criar empresa sem sair da janela, prévia em nova aba e envio por e-mail (prévia, API simulada) ----- */

const PRINTS_PAINEL2 = process.env.PRINTS_PAINEL2 || '';
async function print2(page, nome) {
  if (!PRINTS_PAINEL2) return;
  await page.waitForTimeout(450);
  fs.mkdirSync(PRINTS_PAINEL2, { recursive: true });
  await page.screenshot({ path: require('node:path').join(PRINTS_PAINEL2, nome + '.png') });
}
async function entrarPrevia(page, context) {
  await page.setViewportSize({ width: 1366, height: 900 });
  // No contexto (e não só na página): a aba nova da prévia também usa a API simulada.
  await context.route('**/js/config.js', (route) => route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8',
    body: 'window.CONFIG = ' + JSON.stringify({ API_URL: 'simulada', WHATSAPP_RECRUTADOR: '', EMPRESA: '', MOSTRAR_RESULTADO_AO_CANDIDATO: false, GRUPOS_DEMONSTRACAO: 0 }) + ';' }));
  await page.goto('/admin.html');
  await entrar(page, 'admin@previa.com', 'previa123');
}

test.describe('Painel: empresa nova na hora, prévia em nova aba e envio por e-mail (prévia)', () => {
  test('"Adicionar à empresa": "+ Cadastrar" cria a empresa ali mesmo (erro sem fechar) e segue no fluxo', async ({ page, context }) => {
    const erros = coletarErros(page);
    await entrarPrevia(page, context);
    await page.locator('#lista-candidatos > li', { hasText: 'Bruno Teste Fictício' }).getByRole('button', { name: /Ver detalhes/ }).click();
    await page.click('#btn-contratar');
    await expect(page.locator('#janela-contratar')).toBeVisible();
    await page.click('#contratar-empresa');
    // Texto que já é uma empresa: sem "Cadastrar"
    await page.fill('#contratar-empresa-busca', 'clinica exemplo');
    await expect(page.locator('#contratar-empresa-lista [role="option"]', { hasText: 'Clínica Exemplo' })).toBeVisible();
    await expect(page.locator('#contratar-empresa-novo')).toBeHidden();
    // Nome inválido: o erro do servidor aparece no painel, a janela continua aberta
    await page.fill('#contratar-empresa-busca', 'X');
    await expect(page.locator('#contratar-empresa-novo')).toHaveText('+ Cadastrar “X”');
    await page.click('#contratar-empresa-novo');
    await page.click('#contratar-empresa-criar-ok');
    await expect(page.locator('#contratar-empresa-criar-erro')).toHaveText('Informe o nome da empresa.');
    await expect(page.locator('#janela-contratar')).toBeVisible();
    await page.click('#contratar-empresa-criar-voltar');
    // Nome novo: cidade opcional + Confirmar -> cadastra, já escolhe e fecha só o painel
    await page.fill('#contratar-empresa-busca', 'Padaria Nova Era');
    await expect(page.locator('#contratar-empresa-lista [role="option"]')).toHaveCount(0);
    await expect(page.locator('#contratar-empresa-novo')).toHaveText('+ Cadastrar “Padaria Nova Era”');
    await page.click('#contratar-empresa-novo');
    await expect(page.locator('#contratar-empresa-criar-nome')).toHaveText('Padaria Nova Era');
    await page.fill('#contratar-empresa-criar-cidade', 'Boa Vista / RR');
    await print2(page, '1-cadastrar-empresa-na-janela');
    await page.keyboard.press('Enter'); // Enter na cidade confirma o cadastro (não envia a janela)
    await expect(page.locator('#contratar-empresa-painel')).toBeHidden();
    await expect(page.locator('#janela-contratar')).toBeVisible();
    await expect(page.locator('#contratar-empresa-texto')).toHaveText('Padaria Nova Era');
    await expect(page.locator('#aviso-geral')).toHaveText('Empresa "Padaria Nova Era" cadastrada.');
    await print2(page, '2-empresa-cadastrada-e-escolhida');
    await page.click('#janela-ok');
    await expect(page.locator('#janela-contratar')).toHaveCount(0);
    await expect(page.locator('#aviso-geral')).toContainText('agora é colaborador(a) em Padaria Nova Era');
    const emp = await page.evaluate(async () => {
      const t = sessionStorage.getItem('disc_admin_token');
      return (await window.DISC_API.listarEmpresas(t)).empresas.find((e) => e.nome === 'Padaria Nova Era');
    });
    expect(emp).toMatchObject({ nome: 'Padaria Nova Era', cidade: 'Boa Vista / RR' });
    expect(erros).toEqual([]);
  });

  test('assistente: "Abrir prévia em nova aba" mostra o relatório sem publicar; publicado, "Enviar por e-mail" mostra "Enviado"', async ({ page, context }) => {
    const erros = coletarErros(page);
    await entrarPrevia(page, context);
    await abrirAba(page, 'relatorios');
    await page.click('#btn-rel-novo');
    await page.click('#assist-modelo-equipe');
    // A empresa também pode nascer aqui
    await page.click('#assist-empresa');
    await page.fill('#assist-empresa-busca', 'Clínica Exemplo');
    await page.locator('#assist-empresa-lista [role="option"]', { hasText: 'Clínica Exemplo' }).click();
    await page.click('#btn-assist-gerar');
    await expect(page.locator('#rel-modelo-previa')).toBeVisible();
    await expect(page.locator('#btn-rel-previa-aba')).toHaveText('Abrir prévia em nova aba');
    await print2(page, '3-assistente-previa');

    const [aba] = await Promise.all([context.waitForEvent('page'), page.click('#btn-rel-previa-aba')]);
    const errosAba = coletarErros(aba);
    await aba.waitForLoadState();
    expect(aba.url()).toMatch(/\/relatorio\.html#previa-[0-9a-f]{32}$/);
    await expect(aba.locator('#doc-previa-faixa')).toHaveText('Prévia — ainda não publicado');
    await expect(aba.locator('#relatorio')).toHaveAttribute('data-estado', 'pronto');
    await expect(aba.locator('#relatorio')).toContainText('Clínica Exemplo');
    await expect(aba).toHaveTitle(/^Prévia · /);
    // O snapshot sai do localStorage depois de lido; recarregar a aba continua mostrando (sessionStorage da aba)
    expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.indexOf('disc_previa_') === 0))).toEqual([]);
    await aba.reload();
    await expect(aba.locator('#doc-previa-faixa')).toBeVisible();
    await aba.setViewportSize({ width: 1366, height: 900 });
    await print2(aba, '4-previa-em-nova-aba');
    expect(errosAba).toEqual([]);
    await aba.close();
    // Nada foi publicado
    await expect(page.locator('#btn-rel-publicar')).toBeVisible();
    await expect(page.locator('#rel-modelo-publicado')).toHaveCount(0);

    await page.click('#btn-rel-publicar');
    await expect(page.locator('#rel-modelo-link')).toBeVisible();
    await page.click('#btn-rel-enviar-email');
    await expect(page.locator('#janela-enviar-email')).toBeVisible();
    await page.click('#janela-ok');
    await expect(page.locator('#janela-erro')).toHaveText('Informe um e-mail válido para o destinatário.');
    await page.fill('#email-para', 'dono@clinica-exemplo.com');
    await page.fill('#email-nome', 'Marta');
    await page.fill('#email-mensagem', 'Segue o relatório da equipe.');
    await print2(page, '5-enviar-por-email');
    await page.click('#janela-ok');
    await expect(page.locator('#janela-enviar-email')).toHaveCount(0);
    await expect(page.locator('#aviso-geral')).toHaveText('Enviado para dono@clinica-exemplo.com.');
    await expect(page.locator('#rel-modelo-envio')).toContainText('Enviado por e-mail para dono@clinica-exemplo.com');
    await print2(page, '6-enviado');

    // Lista "Gerados": o publicado também tem "Enviar por e-mail"
    await page.click('#btn-voltar-relatorio');
    const linha = page.locator('#lista-gerados > li[data-status="publicado"]').first();
    await expect(linha.locator('[data-acao="enviar-email"]')).toBeVisible();
    await expect(page.locator('#lista-gerados')).toContainText('Enviado por e-mail para dono@clinica-exemplo.com');
    await print2(page, '7-gerados');
    // A prévia embutida (iframe sandbox, já existente) avisa que não roda scripts: não é erro desta tela.
    expect(erros.filter((e) => !/about:srcdoc/.test(e))).toEqual([]);
  });

  test('sem o Resend configurado, a janela explica e leva à aba Conexões', async ({ page, context }) => {
    await entrarPrevia(page, context);
    await page.evaluate(() => {
      window.DISC_API.relatorioEnviarEmail = () => Promise.resolve({ ok: false, erro: 'O envio por e-mail ainda não está configurado (veja Conexões).', naoConfigurado: true });
    });
    await abrirAba(page, 'relatorios');
    await page.click('#btn-rel-novo');
    await page.click('#assist-modelo-equipe');
    await page.click('#assist-empresa');
    await page.locator('#assist-empresa-lista [role="option"]', { hasText: 'Clínica Exemplo' }).click();
    await page.click('#btn-assist-gerar');
    await page.click('#btn-rel-publicar');
    await page.click('#btn-rel-enviar-email');
    await page.fill('#email-para', 'dono@clinica-exemplo.com');
    await page.click('#janela-ok');
    await expect(page.locator('#janela-erro')).toHaveText('O envio por e-mail ainda não está configurado (veja Conexões).');
    await expect(page.locator('#email-nao-configurado')).toBeVisible();
    await print2(page, '8-email-nao-configurado');
    await page.click('#btn-email-conexoes');
    await expect(page.locator('#janela-enviar-email')).toHaveCount(0);
    await expect(page.locator('#vista-conexoes')).toBeVisible();
  });
});
