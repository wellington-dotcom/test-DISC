'use strict';
// Correções do painel (varredura de UX, out/2026), na prévia (API simulada, dados de exemplo):
// nunca perder o que foi digitado, endereço por tela (#hash), confirmações nas ações que mudam o que o cliente
// já recebeu, preço mínimo de R$ 0,50 e os achados Críticos/Altos de Seleção, Empresas e Vendas.
const { test, expect } = require('@playwright/test');
const { coletarErros } = require('./util.js');

async function configurarPrevia(context) {
  await context.route('**/js/config.js', (route) => route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8',
    body: 'window.CONFIG = ' + JSON.stringify({ API_URL: 'simulada', WHATSAPP_RECRUTADOR: '', EMPRESA: '', MOSTRAR_RESULTADO_AO_CANDIDATO: false, GRUPOS_DEMONSTRACAO: 0 }) + ';' }));
}
async function entrar(page) {
  await expect(page.locator('#form-login')).toBeVisible();
  await page.fill('#campo-email', 'admin@previa.com');
  await page.fill('#campo-senha', 'previa123');
  await page.click('#btn-entrar');
  await expect(page.locator('#tela-painel')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#contagem')).not.toHaveText('Carregando…');
}
// Entra na prévia em 1366 × 900 (o painel é para computador); `hash` abre direto numa tela.
async function entrarPrevia(page, context, hash) {
  await page.setViewportSize({ width: 1366, height: 900 });
  await configurarPrevia(context);
  await page.goto('/admin.html' + (hash || ''));
  await entrar(page);
}
const aba = (page, nome) => page.locator('.aba[data-aba="' + nome + '"]').click();
const cartaoDe = (page, nome) => page.locator('#lista-candidatos > li', { hasText: nome });
async function abrirDetalhe(page, nome) {
  await cartaoDe(page, nome).first().getByRole('button', { name: /Ver detalhes/ }).click();
  await expect(page.locator('#vista-detalhe')).toBeVisible();
}

test.describe('Seleção: não perder o que foi digitado', () => {
  test('Observações: Esc dentro da caixa não fecha; sair pelo menu pergunta (continuar, salvar e sair)', async ({ page, context }) => {
    const erros = coletarErros(page);
    await entrarPrevia(page, context);
    await abrirDetalhe(page, 'Carla Modelo Demonstração');
    await page.fill('#det-obs', 'Boa entrevista, disponível à tarde.');
    await page.locator('#det-obs').press('Escape');
    await expect(page.locator('#vista-detalhe')).toBeVisible();
    await expect(page.locator('#det-obs')).toHaveValue('Boa entrevista, disponível à tarde.');

    // Menu com observação não salva: pergunta, "Continuar editando" fica na tela.
    await aba(page, 'processos');
    await expect(page.locator('#confirmar-titulo')).toHaveText('Sair sem salvar?');
    await page.click('#escolha-ficar');
    await expect(page.locator('#vista-detalhe')).toBeVisible();
    await expect(page.locator('#det-obs')).toHaveValue('Boa entrevista, disponível à tarde.');

    // "← Voltar" também pergunta; "Salvar e sair" grava.
    await page.click('#btn-voltar-detalhe');
    await expect(page.locator('#confirmar-titulo')).toHaveText('Sair sem salvar?');
    await page.click('#escolha-salvar');
    await expect(page.locator('#vista-lista')).toBeVisible();
    await abrirDetalhe(page, 'Carla Modelo Demonstração');
    await expect(page.locator('#det-obs')).toHaveValue('Boa entrevista, disponível à tarde.');
    expect(erros).toEqual([]);
  });

  test('Formulário do processo: F5 devolve o rascunho; sair pelo menu pergunta antes de descartar', async ({ page, context }) => {
    const erros = coletarErros(page);
    await entrarPrevia(page, context, '#processos/novo');
    await expect(page.locator('#proc-nome')).toBeVisible();
    await page.fill('#proc-nome', 'Vendedor externo 2026');
    await page.reload();
    await expect(page.locator('#tela-painel')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#proc-rascunho-recuperado')).toBeVisible();
    await expect(page.locator('#proc-nome')).toHaveValue('Vendedor externo 2026');

    await aba(page, 'lista');
    await expect(page.locator('#confirmar-titulo')).toHaveText('Sair sem salvar?');
    await page.click('#escolha-ficar');
    await expect(page.locator('#proc-nome')).toHaveValue('Vendedor externo 2026');
    await aba(page, 'lista');
    await page.click('#escolha-descartar');
    await expect(page.locator('#vista-lista')).toBeVisible();
    // Descartado: abrir o formulário de novo começa vazio.
    await page.goto('/admin.html#processos/novo');
    await expect(page.locator('#proc-nome')).toHaveValue('');
    await expect(page.locator('#proc-rascunho-recuperado')).toHaveCount(0);
    expect(erros).toEqual([]);
  });
});

test.describe('Seleção: navegação e sessão', () => {
  test('cada tela no endereço: Voltar do navegador fica no painel e F5 mantém a tela', async ({ page, context }) => {
    const erros = coletarErros(page);
    await entrarPrevia(page, context);
    await expect(page).toHaveURL(/admin\.html(#)?$/);
    await abrirDetalhe(page, 'Carla Modelo Demonstração');
    await expect(page).toHaveURL(/#participante\/previa-exemplo-03$/);
    await aba(page, 'processos');
    await expect(page).toHaveURL(/#processos$/);
    await expect(page.locator('#vista-processos')).toBeVisible();

    await page.goBack();
    await expect(page.locator('#vista-detalhe')).toBeVisible();
    await expect(page.locator('#vista-detalhe h1, #vista-detalhe h2').first()).toContainText('Carla');
    await page.goBack();
    await expect(page.locator('#vista-lista')).toBeVisible();
    await expect(page).toHaveURL(/admin\.html/);

    await page.goForward();
    await expect(page.locator('#vista-detalhe')).toBeVisible();
    await page.reload();
    await expect(page.locator('#vista-detalhe')).toBeVisible({ timeout: 15000 });
    await expect(page).toHaveURL(/#participante\/previa-exemplo-03$/);

    // Empresa e subaba também ficam no endereço.
    await page.goto('/admin.html#empresa/emp_previa_clinica/organograma');
    await expect(page.locator('#emp-organograma')).toBeVisible();
    await page.reload();
    await expect(page.locator('#emp-subaba-organograma')).toHaveAttribute('aria-current', 'page');
    await page.click('#emp-subaba-historico');
    await expect(page).toHaveURL(/#empresa\/emp_previa_clinica\/historico$/);
    await page.goBack();
    await expect(page.locator('#emp-subaba-organograma')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('#emp-organograma')).toBeVisible();
    expect(erros).toEqual([]);
  });

  test('"Sair" com um participante aberto: ao entrar de novo, a lista aparece sem o detalhe preso por cima', async ({ page, context }) => {
    await entrarPrevia(page, context);
    await abrirDetalhe(page, 'Bruno Teste Fictício');
    await page.click('#btn-usuario');
    await page.click('#btn-sair');
    await entrar(page);
    await expect(page.locator('#vista-lista')).toBeVisible();
    await expect(page.locator('#vista-detalhe')).toBeHidden();
    await aba(page, 'processos');
    await expect(page.locator('#vista-processos')).toBeVisible();
    await expect(page.locator('#vista-detalhe')).toBeHidden();
  });
});

test.describe('Seleção: detalhe, contratar, IA e comparativo', () => {
  test('confiabilidade baixa aparece no topo do detalhe e na janela de contratar', async ({ page, context }) => {
    await entrarPrevia(page, context);
    await abrirDetalhe(page, 'Bruno Teste Fictício');
    await expect(page.locator('#det-conf-topo')).toBeVisible();
    await expect(page.locator('#det-conf-topo')).toContainText(/Confiabilidade baixa/i);
    await page.click('#btn-contratar');
    await expect(page.locator('#janela-contratar')).toBeVisible();
    await expect(page.locator('#contratar-conf-baixa')).toContainText('confiabilidade deste resultado é baixa');
  });

  test('"Adicionar à empresa" de quem já é colaborador abre UMA janela, com o aviso do vínculo atual', async ({ page, context }) => {
    await entrarPrevia(page, context);
    await abrirDetalhe(page, 'Carla Modelo Demonstração');
    await expect(page.locator('#det-empresa-vinculo')).toContainText('Clínica Exemplo');
    await page.click('#btn-contratar');
    await expect(page.locator('#janela-contratar')).toBeVisible();
    await expect(page.locator('.janela')).toHaveCount(1);
    await expect(page.locator('#janela-contratar')).toContainText('Hoje é colaborador(a) em Clínica Exemplo');
    await page.click('#janela-cancelar');
    await expect(page.locator('.janela')).toHaveCount(0);
  });

  test('"Melhorar textos com IA" num relatório publicado pergunta antes (o link do contratante muda)', async ({ page, context }) => {
    await entrarPrevia(page, context, '#processo/ava_previa_cartorio/relatorio/exemplo-cartorio');
    await expect(page.locator('#btn-melhorar-ia')).toBeVisible({ timeout: 15000 });
    await page.click('#btn-melhorar-ia');
    await expect(page.locator('#confirmar-titulo')).toHaveText('Mudar o relatório já publicado?');
    await page.locator('#confirmar').getByRole('button', { name: 'Voltar' }).click();
    await expect(page.locator('#confirmar')).toHaveCount(0);
    await expect(page.locator('#btn-melhorar-ia')).toHaveText('Melhorar textos com IA');
  });

  test('Comparativo: abre no processo do último aprovado; "todos" avisa que soma processos e empresas diferentes', async ({ page, context }) => {
    await entrarPrevia(page, context, '#comparativo');
    await expect(page.locator('#comp-processo')).toHaveAttribute('value', 'SEL1');
    await expect(page.locator('#comp-aviso-todos')).toHaveCount(0);
    await expect(page.locator('#comp-aprovados')).toContainText('Ana Exemplo Prévia');
    await page.click('#comp-processo');
    await page.locator('#comp-processo-lista [role="option"][data-valor=""]').click();
    await expect(page.locator('#comp-aviso-todos')).toBeVisible();
    await page.click('#comp-processo');
    await page.locator('#comp-processo-lista [role="option"][data-valor="EQP1"]').click();
    await expect(page.locator('#comp-aviso-todos')).toHaveCount(0);
    await expect(page.locator('#vista-comparativo')).not.toContainText('Ana Exemplo Prévia');
  });
});

test.describe('Empresas: organograma, ligações e relatórios', () => {
  test('tirar um líder do organograma pergunta o que fazer com a equipe; "Desfazer" volta como estava', async ({ page, context }) => {
    const erros = coletarErros(page);
    await entrarPrevia(page, context, '#empresa/emp_previa_clinica/organograma');
    const org = page.locator('#emp-organograma');
    const paulo = org.locator('.orgx-quadro .orgx-cartao[data-org-id]', { hasText: 'Paulo Modelo' });
    await expect(paulo).toHaveCount(1);
    await paulo.locator('[data-acao="mover"]').click();
    await page.getByRole('option', { name: /Sem posição/ }).click();
    // Pergunta antes de mexer na equipe (Renata e Tiago).
    await expect(page.locator('#confirmar-titulo')).toHaveText(/^Tirar Paulo Modelo Fictício do organograma\?/);
    await expect(page.locator('#confirmar')).toContainText('Renata Exemplo Fictícia e Tiago Modelo Sem Teste');
    await page.click('#escolha-cancelar');
    await expect(paulo).toHaveCount(1);

    await paulo.locator('[data-acao="mover"]').click();
    await page.getByRole('option', { name: /Sem posição/ }).click();
    await page.click('#escolha-subir');
    await expect(page.locator('#emp-org-status')).toHaveText('Salvo');
    await expect(org.locator('.orgx-sem .orgx-cartao[data-org-id]', { hasText: 'Paulo Modelo' })).toHaveCount(1);
    await expect(page.locator('#aviso-geral')).toContainText('a equipe passou para Marta');

    await page.click('#aviso-geral-acao');
    await expect(page.locator('#emp-org-status')).toHaveText('Salvo');
    await expect(org.locator('.orgx-quadro .orgx-cartao[data-org-id]', { hasText: 'Paulo Modelo' })).toHaveCount(1);
    await page.reload();
    await expect(page.locator('#emp-organograma .orgx-quadro .orgx-cartao[data-org-id]', { hasText: 'Paulo Modelo' })).toHaveCount(1);
    expect(erros).toEqual([]);
  });

  test('"Ligações": o líder não pode ser alguém da própria equipe (sem ciclo de liderança)', async ({ page, context }) => {
    await entrarPrevia(page, context, '#empresa/emp_previa_clinica/colaboradores');
    await page.locator('#lista-colaboradores .colab-card[data-nome="Marta Exemplo Diretora"] [data-acao="ligacoes"]').click();
    await expect(page.locator('#janela-ligacoes')).toBeVisible();
    await expect(page.locator('#janela-titulo')).toHaveText('Ligações de Marta Exemplo Diretora');
    await page.click('#lig-lider');
    const opcoes = page.locator('#lig-lider-lista [role="option"]');
    await expect(opcoes.first()).toBeVisible();
    const textos = await opcoes.allInnerTexts();
    for (const nome of ['Diego', 'Paulo', 'Carla', 'Lucas', 'Renata', 'Tiago']) {
      expect(textos.some((t) => t.includes(nome)), nome + ' é da equipe da Marta').toBe(false);
    }
    await page.keyboard.press('Escape');
    await page.click('#janela-cancelar');
    // Paulo lidera Renata e Tiago: eles não aparecem como líder do Paulo; Diego (de outra equipe) aparece.
    await page.locator('#lista-colaboradores .colab-card[data-nome="Paulo Modelo Fictício"] [data-acao="ligacoes"]').click();
    await page.click('#lig-lider');
    const doPaulo = await page.locator('#lig-lider-lista [role="option"]').allInnerTexts();
    expect(doPaulo.some((t) => t.includes('Diego'))).toBe(true);
    expect(doPaulo.some((t) => t.includes('Renata') || t.includes('Tiago'))).toBe(false);
  });

  test('rascunho do relatório da equipe: "Continuar" reabre e publica; despublicar pede confirmação', async ({ page, context }) => {
    const erros = coletarErros(page);
    await entrarPrevia(page, context, '#empresa/emp_previa_clinica/relatorios');
    await page.click('#btn-emp-rel-equipe');
    await page.click('#janela-ok');
    await expect(page.locator('#btn-rel-rascunho')).toBeVisible({ timeout: 15000 });
    await page.click('#btn-rel-rascunho');
    await expect(page.locator('#aviso-geral')).toContainText('Rascunho salvo');
    await page.click('#btn-voltar-relatorio');
    const linha = page.locator('.rel-linha[data-status="rascunho"][data-modelo="equipe"]').first();
    await expect(linha).toBeVisible();
    await linha.locator('[data-acao="continuar"]').click();
    await expect(page.locator('#btn-rel-publicar')).toBeVisible({ timeout: 15000 });
    await page.click('#btn-rel-publicar');
    await expect(page.locator('#btn-rel-rascunho')).toHaveText('Despublicar (voltar para rascunho)');

    await page.click('#btn-rel-rascunho');
    await expect(page.locator('#confirmar-titulo')).toHaveText('Despublicar o relatório?');
    await page.click('#confirmar-cancelar');
    await expect(page.locator('#btn-rel-rascunho')).toHaveText('Despublicar (voltar para rascunho)');
    await page.click('#btn-rel-rascunho');
    await page.click('#confirmar-ok');
    await expect(page.locator('#aviso-geral')).toContainText('voltou a ser rascunho');
    await expect(page.locator('#aviso-geral-acao')).toHaveText('Publicar de novo');
    await page.click('#aviso-geral-acao');
    await expect(page.locator('#btn-rel-rascunho')).toHaveText('Despublicar (voltar para rascunho)');
    expect(erros.filter((e) => !/Blocked script execution in 'about:srcdoc'/.test(e))).toEqual([]);
  });

  test('relatório da equipe: quem comprou o Mapa no site (venda direta) não aparece como candidato', async ({ page, context }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await configurarPrevia(context);
    await page.goto('/admin.html');
    await page.evaluate(() => window.DISC_API.enviarPessoal({ v: 1, id: 'b2c-e2e-0001', nome: 'Compradora Site Exemplo', telefone: '5511955550001',
      email: 'compradora@exemplo.com', consentimento: true, inicio: '2026-10-01T12:00:00.000Z', fim: '2026-10-01T12:09:30.000Z', duracaoSeg: 570,
      respostas: '4321'.repeat(25), resultado: { percentuais: { D: 40, I: 30, S: 20, C: 10 }, codigo: 'DI' } }));
    await page.goto('/admin.html#empresa/emp_previa_clinica/relatorios');
    await entrar(page);
    await page.click('#btn-emp-rel-equipe');
    await page.check('#rel-incluir-candidato');
    await page.click('#rel-cand');
    const opcoes = page.locator('#rel-cand-lista [role="option"]');
    await expect(opcoes.first()).toBeVisible();
    const textos = await opcoes.allInnerTexts();
    expect(textos.some((t) => t.includes('Compradora Site Exemplo'))).toBe(false);
    expect(textos.some((t) => t.includes('Bruno Teste Fictício'))).toBe(true);
  });
});

test.describe('Vendas: preço mínimo, reembolso e cortesia', () => {
  test('Novo cupom: mostra o preço final e recusa desconto que deixa o pacote entre R$ 0,01 e R$ 0,49', async ({ page, context }) => {
    const erros = coletarErros(page);
    await entrarPrevia(page, context, '#vendas/cupons');
    await page.click('#btn-novo-cupom');
    await page.fill('#cup-codigo', 'QUASEGRATIS');
    await page.click('#cup-tipo');
    await page.locator('#cup-tipo-lista [role="option"][data-valor="valor"]').click();
    await page.fill('#cup-valor', '28,80');
    await expect(page.locator('#cup-precos')).toContainText('0,20');
    await page.click('#janela-ok');
    await expect(page.locator('#cup-precos')).toContainText('O Stripe só cobra a partir de R$ 0,50');
    await expect(page.locator('#janela-erro')).toContainText('R$ 0,50 ou mais');
    await expect(page.locator('#form-cupom')).toBeVisible();
    // R$ 28,50 de desconto: o completo sai por R$ 0,50 (vale).
    await page.fill('#cup-valor', '10');
    await expect(page.locator('#cup-precos')).toContainText('O cliente paga hoje');
    await page.click('#janela-ok');
    await expect(page.locator('#form-cupom')).toHaveCount(0);
    await expect(page.locator('#aviso-geral')).toContainText('Cupom QUASEGRATIS criado');
    expect(erros).toEqual([]);
  });

  async function pedidoDaPrevia(page, context, id, pagar) {
    await page.setViewportSize({ width: 1366, height: 900 });
    await configurarPrevia(context);
    await page.goto('/admin.html');
    return page.evaluate(async ([id, pagar]) => {
      const e = await window.DISC_API.enviarPessoal({ v: 1, id, nome: 'Cliente Pedido Exemplo', telefone: '5511955550002', email: 'cliente.' + id + '@exemplo.com',
        consentimento: true, inicio: '2026-10-01T12:00:00.000Z', fim: '2026-10-01T12:09:30.000Z', duracaoSeg: 570,
        respostas: '4321'.repeat(25), resultado: { percentuais: { D: 40, I: 30, S: 20, C: 10 }, codigo: 'DI' } });
      const p = await window.DISC_API.criarPedido(e.tokenResumo, 'completo', '');
      if (pagar) await window.DISC_API.simularPagamento(p.pedidoId);
      return p.pedidoId;
    }, [id, pagar]);
  }

  test('"Marcar reembolsado" com o Stripe manda devolver no Stripe (não no Asaas)', async ({ page, context }) => {
    const pedido = await pedidoDaPrevia(page, context, 'pedido-e2e-stripe', true);
    await page.goto('/admin.html#vendas/pedido/' + pedido);
    await entrar(page);
    await expect(page.locator('#btn-vd-reembolso')).toBeVisible();
    await page.click('#btn-vd-reembolso');
    await expect(page.locator('#vd-lembrete-stripe')).toContainText('devolva o dinheiro no Stripe');
    await expect(page.locator('#vd-lembrete-asaas')).toHaveCount(0);
    await expect(page.locator('#vd-link-stripe-reembolso')).toHaveAttribute('href', /dashboard\.stripe\.com/);
    await page.click('#confirmar-cancelar');
  });

  test('"Liberar como cortesia" explica como avisar o cliente e oferece enviar o acesso por e-mail', async ({ page, context }) => {
    const erros = coletarErros(page);
    const pedido = await pedidoDaPrevia(page, context, 'pedido-e2e-cortesia', false);
    await page.goto('/admin.html#vendas/pedido/' + pedido);
    await entrar(page);
    await page.click('#btn-vd-cortesia');
    await expect(page.locator('#confirmar-desc')).toContainText('manda o link de acesso por e-mail');
    await page.click('#confirmar-ok');
    await expect(page.locator('#btn-vd-enviar-acesso')).toBeVisible();
    await page.click('#btn-vd-enviar-acesso');
    await expect(page.locator('#aviso-geral')).toContainText('E-mail com o link de acesso enviado para cliente.pedido-e2e-cortesia@exemplo.com');
    expect(erros).toEqual([]);
  });
});
