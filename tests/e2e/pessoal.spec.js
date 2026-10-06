'use strict';
// Venda B2C (modo pessoal, Gestão sem Caos): grátis -> resumo + paywall -> checkout (Pix simulado, cupom) ->
// meu-relatorio.html; Completo + Parte 2; abrir pelo link depois; celular 375 px sem rolagem lateral.
// Usa a API simulada (CONFIG.API_URL = 'simulada'): pagamento aprovado pelo botão "Simular pagamento aprovado".
const { test, expect } = require('@playwright/test');
const { coletarErros, configurar } = require('./util.js');

test.use({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, reducedMotion: 'reduce' });

const GRUPOS = 3;   // modo demonstração: 3 grupos (o resto é completado ao acaso)

// Posição na página (não na janela): o clique pode rolar a tela.
async function topo(loc) { return loc.evaluate((e) => Math.round(e.getBoundingClientRect().top + window.scrollY)); }

async function semRolagemLateral(page) {
  const larg = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(larg[0]).toBeLessThanOrEqual(larg[1]);
}

// Identificação B2C + os grupos do teste até o resumo grátis.
async function fazerTestePessoal(page, dados, caminho) {
  await page.goto(caminho || '/index.html?modo=pessoal');
  await expect(page.locator('h1')).toHaveText('Antes de começar');
  await expect(page.locator('.topo .logo-gsc')).toBeVisible();
  await expect(page.locator('.topo .logo-gsc')).toHaveAttribute('alt', 'Gestão sem Caos');
  await expect(page.locator('#marca')).toBeHidden();
  await page.fill('#nome', dados.nome);
  await page.fill('#email', dados.email);
  if (dados.telefone) await page.locator('#telefone').pressSequentially(dados.telefone);
  await page.check('#consentimento');
  await page.locator('#form-identificacao button[type="submit"]').click();
  for (let i = 0; i < GRUPOS; i++) {
    await expect(page.locator('.progresso-topo')).toContainText('Grupo ' + (i + 1) + ' de ' + GRUPOS);
    await page.locator('[data-acao="confirmar-ordem"]').click();
    if (i === GRUPOS - 1) await expect(page.locator('[data-acao="proximo"]')).toHaveText('Ver meu resultado');
    await page.locator('[data-acao="proximo"]').click();
  }
  await expect(page.locator('.resumo-gratis')).toBeVisible();
}

async function cupomCem(page, codigo) {
  // Cria o cupom de 100% pelo painel (API simulada, login da prévia).
  await page.evaluate(async (cod) => {
    const api = window.DISC_API;
    const s = await api.login('admin@previa.com', 'previa123');
    await api.salvarCupom(s.token, { codigo: cod, tipo: 'percentual', valor: 100, ativo: true });
  }, codigo);
}

test.describe('Venda B2C (celular, API simulada)', () => {
  test.beforeEach(async ({ page }) => {
    await configurar(page, { API_URL: 'simulada', GRUPOS_DEMONSTRACAO: GRUPOS });
  });

  test('grátis: identificação B2C valida o e-mail; resumo grátis real + prévia borrada + pacotes', async ({ page }) => {
    const erros = coletarErros(page);
    await page.goto('/index.html?modo=pessoal&pacote=completo');
    await expect(page.locator('h1')).toHaveText('Antes de começar');
    await expect(page.locator('#idade, #vaga, #funcao')).toHaveCount(0);
    await expect(page.locator('.consentimento')).toContainText('Gestão sem Caos');
    await expect(page.locator('.consentimento')).toContainText('não são compartilhados com empresas');
    await expect(page.locator('body')).not.toContainText('Notus');
    await page.fill('#nome', 'Bruna Teste');
    await page.locator('#form-identificacao button[type="submit"]').click();
    await expect(page.locator('#erro-email')).toContainText('Informe seu e-mail');
    await expect(page.locator('#erro-consentimento')).not.toHaveText('');
    await page.fill('#email', 'bruna@');
    await page.locator('#form-identificacao button[type="submit"]').click();
    await expect(page.locator('#erro-email')).toContainText('Confira o e-mail');
    await semRolagemLateral(page);

    await page.evaluate(() => localStorage.clear());
    await page.goto('about:blank');
    await fazerTestePessoal(page, { nome: 'Bruna Teste Silva', email: 'bruna.gratis@exemplo.com' }, '/index.html?modo=pessoal&pacote=completo');
    const res = page.locator('.resumo-gratis');
    await expect(res.locator('h1')).toContainText('Bruna, seu estilo é');
    await expect(res.locator('.rel-fator')).toHaveCount(4);
    await expect(res.locator('.rel-combinacao-nome')).not.toBeEmpty();
    await expect(res.locator('.rel-item')).toHaveCount(3);
    // Prévia: títulos de "O que está te travando" e linhas borradas (sem o texto da ação)
    const previa = page.locator('.previa-paga');
    await expect(previa.locator('h2')).toHaveText('O que o relatório completo mostra');
    expect(await previa.locator('.previa-lista .previa-item').count()).toBeGreaterThanOrEqual(2);
    await expect(previa.locator('.borrado').first()).toBeVisible();
    await expect(previa).not.toContainText('Para destravar');
    // Pacotes: o pré-escolhido em destaque, preço de lançamento riscado, garantia
    const cards = page.locator('.pacote');
    await expect(cards).toHaveCount(2);
    await expect(page.locator('.pacote--destaque')).toHaveAttribute('data-pacote', 'completo');
    await expect(page.locator('.pacote[data-pacote="completo"] .pacote-valor')).toHaveText('R$ 29');
    await expect(page.locator('.pacote[data-pacote="completo"] .pacote-cheio')).toHaveText('R$ 39');
    await expect(page.locator('.pacote[data-pacote="completo_plus"] .pacote-valor')).toHaveText('R$ 49');
    await expect(page.locator('.botao--laranja')).toHaveCount(1);
    await expect(page.locator('.paywall')).toContainText('Garantia de 7 dias');
    await semRolagemLateral(page);
    // Recarregar mantém o resumo (o token fica neste aparelho)
    await page.reload();
    await expect(page.locator('.resumo-gratis .rel-fator')).toHaveCount(4);
    // Refazer: confirmação em dois toques com o aviso da compra ligada ao resultado
    await page.locator('[data-acao="refazer"]').click();
    await expect(page.locator('#nota-refazer')).toBeVisible();
    await expect(page.locator('#nota-refazer')).toContainText('nova compra');
    await page.locator('[data-acao="refazer"]').click();
    await expect(page.locator('h1')).toHaveText('Antes de começar');
    await expect(page.locator('#email')).toHaveValue('bruna.gratis@exemplo.com');
    expect(erros).toEqual([]);
  });

  test('comprar o completo com Pix simulado: QR, copia e cola, espera, confirmação e relatório completo', async ({ page }) => {
    await configurar(page, { API_URL: 'simulada', GRUPOS_DEMONSTRACAO: GRUPOS, PAGAMENTO_PREVIA: 'asaas' });   // Pix embutido (Asaas)
    const erros = coletarErros(page);
    await fazerTestePessoal(page, { nome: 'Carla Compra Pix', email: 'carla.pix@exemplo.com', telefone: '11987654321' });
    await page.locator('[data-acao="comprar"][data-pacote="completo"]').click();
    await expect(page.locator('[data-ck-tela="revisao"] h1')).toHaveText('Finalizar compra');
    await expect(page.locator('#ck-valor')).toHaveText('R$ 29');
    await page.locator('[data-ck="continuar"]').click();
    const pag = page.locator('[data-ck-tela="pagamento"]');
    await expect(pag).toBeVisible();
    await expect(pag.locator('.ck-qr img')).toBeVisible();
    await expect(pag.locator('#ck-pix')).not.toHaveValue('');
    await expect(pag.locator('#ck-status')).toContainText('Aguardando');
    await semRolagemLateral(page);
    // Botões não mudam de lugar enquanto espera (a consulta acontece a cada 4 s)
    const antes = await topo(page.locator('[data-ck="verificar"]'));
    await page.locator('[data-ck="verificar"]').click();
    await expect(pag.locator('#ck-status')).toContainText(/Ainda não recebemos|Aguardando|Consultando/);
    expect(Math.abs(await topo(page.locator('[data-ck="verificar"]')) - antes)).toBeLessThanOrEqual(1);
    // Recarregar no meio da espera volta para o pagamento
    await page.reload();
    await expect(page.locator('[data-ck-tela="pagamento"]')).toBeVisible();
    await page.locator('[data-ck="simular"]').click();
    const ok = page.locator('[data-ck-tela="confirmado"]');
    await expect(ok.locator('h1')).toHaveText('Pagamento confirmado');
    const link = await ok.locator('#ck-link').inputValue();
    expect(link).toMatch(/\/meu-relatorio\.html#t-[A-Za-z0-9_-]{16,}$/);
    await expect(ok.locator('a[href^="https://wa.me/5511987654321?text="]')).toHaveText('Enviar para meu WhatsApp');
    await semRolagemLateral(page);
    await ok.locator('[data-ck="ver"]').click();
    await expect(page).toHaveURL(/meu-relatorio\.html#t-/);
    const rel = page.locator('.relatorio-pessoa');
    await expect(rel).toBeVisible();
    await expect(page.locator('.rel-travas h2')).toHaveText('O que está te travando');
    expect(await page.locator('.rel-travas .trava').count()).toBeGreaterThanOrEqual(2);
    await expect(page.locator('.rel-travas .trava-acao').first()).toContainText('Para destravar');
    await expect(rel.locator('[data-secao="intensidade"]')).toBeVisible();
    await expect(rel.locator('[data-secao="plano"]')).toBeVisible();
    await expect(rel.locator('.rel-combinacao-nome')).not.toBeEmpty();
    await expect(rel.locator('[data-secao="mapa"], [data-secao="plano90"]')).toHaveCount(0);
    await expect(page.locator('[data-acao="imprimir"]')).toHaveText('Imprimir ou salvar em PDF');
    await expect(page.locator('#meu-link')).toHaveValue(link);
    await expect(page.locator('body')).not.toContainText('Notus');
    await semRolagemLateral(page);
    // De volta ao index: o resumo mostra que o relatório está liberado
    await page.goto('/index.html?modo=pessoal');
    await expect(page.locator('.liberado')).toContainText('Seu relatório completo está liberado');
    expect(erros).toEqual([]);
  });

  test('cupom 100%: libera sem pagar; cupom inválido mostra o erro sem mudar os botões de lugar', async ({ page }) => {
    const erros = coletarErros(page);
    await fazerTestePessoal(page, { nome: 'Davi Cupom Teste', email: 'davi.cupom@exemplo.com' });
    await cupomCem(page, 'TESTE100');
    await page.locator('[data-acao="comprar"][data-pacote="completo"]').click();
    await page.locator('[data-ck="cupom-abrir"]').click();
    await page.fill('#ck-cupom', 'NAOEXISTE');
    const antes = await topo(page.locator('[data-ck="continuar"]'));
    await page.locator('[data-ck="continuar"]').click();
    await expect(page.locator('#ck-erro')).toContainText('Cupom inválido');
    expect(Math.abs(await topo(page.locator('[data-ck="continuar"]')) - antes)).toBeLessThanOrEqual(1);
    await page.fill('#ck-cupom', 'teste100');
    await page.locator('[data-ck="continuar"]').click();
    await expect(page.locator('[data-ck-tela="confirmado"] h1')).toHaveText('Acesso liberado');
    await page.locator('[data-ck="ver"]').click();
    await expect(page.locator('.rel-travas')).toBeVisible();
    expect(erros).toEqual([]);
  });

  test('cupom vindo da landing (?cupom=PREVIA100) chega preenchido no checkout e libera', async ({ page }) => {
    const erros = coletarErros(page);
    await fazerTestePessoal(page, { nome: 'Hana Cupom Url', email: 'hana@exemplo.com' }, '/index.html?modo=pessoal&pacote=completo&cupom=previa100&utm_source=ig');
    await page.locator('[data-acao="comprar"][data-pacote="completo"]').click();
    await expect(page.locator('#ck-cupom')).toHaveValue('PREVIA100');
    await expect(page.locator('#ck-cupom')).toBeVisible();
    await page.locator('[data-ck="continuar"]').click();
    await expect(page.locator('[data-ck-tela="confirmado"] h1')).toHaveText('Acesso liberado');
    expect(erros).toEqual([]);
  });

  test('Completo + Parte 2: paga, responde a Parte 2 arrastando e vê esticando, mapa e plano de 90 dias', async ({ page }) => {
    await configurar(page, { API_URL: 'simulada', GRUPOS_DEMONSTRACAO: GRUPOS, PAGAMENTO_PREVIA: 'asaas' });   // Pix embutido (Asaas)
    const erros = coletarErros(page);
    await fazerTestePessoal(page, { nome: 'Eva Parte Dois', email: 'eva.p2@exemplo.com' }, '/index.html?modo=pessoal&pacote=completo_plus');
    await expect(page.locator('.pacote--destaque')).toHaveAttribute('data-pacote', 'completo_plus');
    await page.locator('[data-acao="comprar"][data-pacote="completo_plus"]').click();
    await expect(page.locator('#ck-valor')).toHaveText('R$ 49');
    await page.locator('[data-ck="continuar"]').click();
    await page.locator('[data-ck="simular"]').click();
    await expect(page.locator('[data-ck-tela="confirmado"] h1')).toHaveText('Pagamento confirmado');
    await page.locator('[data-ck="parte2"]').click();
    await expect(page.locator('.tela-parte2 h1')).toHaveText('Agora pense no seu trabalho');
    await expect(page.locator('.tela-parte2 .sobretitulo')).toHaveText('Completo + Parte 2');
    await page.locator('[data-acao="parte2-comecar"]').click();
    for (let k = 0; k < GRUPOS; k++) {
      await expect(page.locator('.progresso-topo')).toContainText('Parte 2 · Grupo ' + (k + 1) + ' de ' + GRUPOS);
      // Mesma mecânica de arrastar: move pelo teclado (o cartão de cima desce uma posição)
      await page.locator('.cartoes .cartao').first().focus();
      await page.keyboard.press('ArrowDown');
      await expect(page.locator('[data-acao="proximo"]')).toBeEnabled();
      if (k === GRUPOS - 1) await expect(page.locator('[data-acao="proximo"]')).toHaveText('Ver meu relatório');
      await page.locator('[data-acao="proximo"]').click();
    }
    await expect(page).toHaveURL(/meu-relatorio\.html#t-/);
    await expect(page.locator('[data-secao="esticando"]')).toBeVisible();
    await expect(page.locator('[data-secao="mapa"] .mapa-ponto')).toHaveCount(2);
    await expect(page.locator('[data-secao="plano90"] h2')).toHaveText('Seu plano de 90 dias no trabalho');
    await expect(page.locator('.rel-travas .trava').first()).toHaveAttribute('data-tipo', /adaptacao|excesso/);
    await semRolagemLateral(page);
    expect(erros).toEqual([]);
  });

  test('abrir meu-relatorio pelo link depois (outra aba); Completo+ sem a Parte 2 pede a Parte 2; link inválido recupera', async ({ page, context }) => {
    const erros = coletarErros(page);
    await fazerTestePessoal(page, { nome: 'Fabio Link Depois', email: 'fabio.link@exemplo.com' });
    await cupomCem(page, 'LINK100');
    await page.locator('[data-acao="comprar"][data-pacote="completo_plus"]').click();
    await page.locator('[data-ck="cupom-abrir"]').click();
    await page.fill('#ck-cupom', 'LINK100');
    await page.locator('[data-ck="continuar"]').click();
    const link = await page.locator('#ck-link').inputValue();
    // Outra aba, depois: o link abre o relatório; sem a Parte 2, ela é pedida antes
    const outra = await context.newPage();
    await configurar(outra, { API_URL: 'simulada', GRUPOS_DEMONSTRACAO: GRUPOS });
    const erros2 = coletarErros(outra);
    await outra.goto(link);
    await expect(outra.locator('.parte2-pedido h1')).toHaveText('Fabio, falta só a Parte 2');
    await expect(outra.locator('[data-acao="parte2"]')).toHaveAttribute('href', /index\.html\?modo=pessoal#p2-/);
    await outra.locator('[data-acao="sem-parte2"]').click();
    await expect(outra.locator('.rel-travas')).toBeVisible();
    await expect(outra.locator('.meu-aviso-p2')).toContainText('Falta a Parte 2');
    await semRolagemLateral(outra);
    // A Parte 2 também abre direto pelo link #p2-
    await outra.locator('.meu-aviso-p2 a').click();
    await expect(outra.locator('.tela-parte2 h1')).toHaveText('Agora pense no seu trabalho');
    // Link inválido: mensagem e "Recuperar meu relatório"
    await outra.goto('/meu-relatorio.html#t-' + '0'.repeat(64));
    await expect(outra.locator('.recuperar h2')).toHaveText('Recuperar meu relatório');
    await outra.fill('#email-recuperar', 'fabio.link@exemplo.com');
    await outra.locator('#form-recuperar button[type="submit"]').click();
    await expect(outra.locator('#recuperar-ok')).not.toBeEmpty();
    await outra.goto('/meu-relatorio.html#recuperar');
    await expect(outra.locator('h1')).toHaveText('Recuperar meu relatório');
    await semRolagemLateral(outra);
    expect(erros).toEqual([]);
    expect(erros2.filter((e) => !/404|Failed to load resource/.test(e))).toEqual([]);
  });
});

// Checkout hospedado (InfinitePay, CONFIG.PAGAMENTO_PREVIA = 'infinitepay'): iniciarPagamento devolve redirecionarUrl; a volta cai em
// meu-relatorio.html com order_nsu/transaction_nsu/slug na query e confirmarRetorno confirma.
// "Ainda não confirmado": o confirmarRetorno da prévia é trocado por uma consulta simples (o pedido segue aguardando).
async function retornoSemConfirmar(page) {
  await page.route('**/js/api-simulada.js', async (route) => {
    const resp = await route.fetch();
    await route.fulfill({ response: resp, body: (await resp.text()) +
      ';(function () { var A = window.DISC_API; if (A) A.confirmarRetorno = function (id, t) { return A.statusPedido(id, t); }; })();' });
  });
}

test.describe('Venda B2C com InfinitePay (checkout hospedado, API simulada)', () => {
  test.beforeEach(async ({ page }) => {
    await configurar(page, { API_URL: 'simulada', GRUPOS_DEMONSTRACAO: GRUPOS, PAGAMENTO_PREVIA: 'infinitepay' });
  });

  test('botão leva para a página do provedor; na volta confirma, limpa a query e mostra o relatório', async ({ page }) => {
    const erros = coletarErros(page);
    await fazerTestePessoal(page, { nome: 'Iris Infinite Pay', email: 'iris@exemplo.com' });
    await page.locator('[data-acao="comprar"][data-pacote="completo"]').click();
    await page.locator('[data-ck="continuar"]').click();
    const tela = page.locator('[data-ck-tela="pagamento"][data-provedor="infinitepay"]');
    await expect(tela).toBeVisible();
    await expect(tela.locator('.ck-qr, #ck-pix')).toHaveCount(0);
    await expect(tela).toContainText('Você vai para a página segura da InfinitePay e volta aqui automaticamente.');
    const botao = tela.locator('[data-ck="redirecionar"]');
    await expect(botao).toHaveText('Pagar com Pix ou cartão');
    await expect(botao).not.toHaveAttribute('target', /.+/);
    await semRolagemLateral(page);
    const pedidoId = /order_nsu=([^&#]+)/.exec(await botao.getAttribute('href'))[1];
    await botao.click();
    await expect(page.locator('.rel-travas')).toBeVisible();
    await expect(page).toHaveURL(/\/meu-relatorio\.html#t-[A-Za-z0-9_-]+$/);   // query limpa, hash mantido
    // Tolerância: parâmetros do retorno depois do token, no hash
    const token = /#t-([A-Za-z0-9_-]+)$/.exec(page.url())[1];
    await page.goto('about:blank');
    await page.goto('/meu-relatorio.html#t-' + token + '?order_nsu=' + pedidoId + '&transaction_nsu=SIM&slug=SIM');
    await expect(page.locator('.rel-travas')).toBeVisible();
    await expect(page).toHaveURL(new RegExp('/meu-relatorio\\.html#t-' + token + '$'));
    expect(erros).toEqual([]);
  });

  test('pagamento ainda não confirmado na volta: "Confirmando seu pagamento…" e abre quando confirma', async ({ page }) => {
    const erros = coletarErros(page);
    await retornoSemConfirmar(page);
    await fazerTestePessoal(page, { nome: 'Joao Espera Retorno', email: 'joao.espera@exemplo.com' });
    await page.locator('[data-acao="comprar"][data-pacote="completo"]').click();
    await page.locator('[data-ck="continuar"]').click();
    const href = await page.locator('[data-ck="redirecionar"]').getAttribute('href');
    const pedidoId = /order_nsu=([^&]+)/.exec(href)[1];
    await page.locator('[data-ck="redirecionar"]').click();
    await expect(page.locator('.confirmando h1')).toHaveText('Confirmando seu pagamento…');
    await expect(page.locator('[data-acao="ja-paguei"]')).toBeVisible();
    await expect(page).toHaveURL(/\/meu-relatorio\.html#t-/);
    expect(page.url()).not.toContain('order_nsu');
    await semRolagemLateral(page);
    await page.evaluate((id) => window.DISC_API.simularPagamento(id), pedidoId);
    await expect(page.locator('.rel-travas')).toBeVisible({ timeout: 10000 });
    expect(erros).toEqual([]);
  });
});

// Stripe (padrão da prévia): o pagamento acontece NA PÁGINA com o Payment Element. Na prévia é um "Payment Element"
// FICTÍCIO (js/stripe-pagamento.js, montarSimulado): nada vai para o Stripe (nenhuma chamada a stripe.com).
const CAPTURAS_STRIPE = process.env.CAPTURAS_STRIPE || '';

test.describe('Venda B2C com Stripe (pagamento dentro do site, Payment Element simulado)', () => {
  test.beforeEach(async ({ page }) => {
    await configurar(page, { API_URL: 'simulada', GRUPOS_DEMONSTRACAO: GRUPOS });
  });

  test('cartão: recusa em português abaixo do botão sem nada pular; aprovado libera na hora; 375 px sem rolagem lateral', async ({ page }) => {
    const erros = coletarErros(page);
    const stripe = [];
    page.on('request', (r) => { if (/stripe\.com/.test(r.url())) stripe.push(r.url()); });
    await fazerTestePessoal(page, { nome: 'Sara Stripe Cartao', email: 'sara.stripe@exemplo.com' });
    await page.locator('[data-acao="comprar"][data-pacote="completo"]').click();
    await page.locator('[data-ck="continuar"]').click();
    const tela = page.locator('[data-ck-tela="pagamento"][data-provedor="stripe"]');
    await expect(tela).toBeVisible();
    await expect(tela.locator('[data-pe-simulado]')).toBeVisible();
    const pagar = tela.locator('[data-ck="pagar"]');
    await expect(pagar).toHaveText('Pagar R$ 29');
    await expect(pagar).toBeEnabled();
    await expect(pagar).toHaveClass(/botao--laranja/);
    await expect(tela).toContainText('Pagamento processado com segurança pelo Stripe');
    await expect(tela.locator('.pe-sim-carteira')).toHaveText(['Apple Pay', 'Google Pay']);
    await semRolagemLateral(page);
    if (CAPTURAS_STRIPE) await page.screenshot({ path: CAPTURAS_STRIPE + '/checkout-375.png', fullPage: true });
    // Cartão recusado: erro em português abaixo do botão; o botão não sai do lugar.
    const antes = await topo(pagar);
    await tela.locator('#pe-sim-numero').fill('4000 0000 0000 0002');
    await tela.locator('#pe-sim-validade').fill('12 / 34');
    await tela.locator('#pe-sim-cvc').fill('123');
    await pagar.click();
    await expect(tela.locator('#ck-erro')).toHaveText('O cartão foi recusado. Tente outro cartão ou pague com Pix.');
    expect(Math.abs(await topo(pagar) - antes)).toBeLessThanOrEqual(1);
    const erroTopo = await topo(tela.locator('#ck-erro'));
    expect(erroTopo).toBeGreaterThan(antes);
    if (CAPTURAS_STRIPE) await page.screenshot({ path: CAPTURAS_STRIPE + '/checkout-375-recusado.png', fullPage: true });
    // Aprovado: libera na hora.
    await tela.locator('#pe-sim-numero').fill('4242 4242 4242 4242');
    await pagar.click();
    const ok = page.locator('[data-ck-tela="confirmado"]');
    await expect(ok.locator('h1')).toHaveText('Pagamento confirmado');
    await semRolagemLateral(page);
    await ok.locator('[data-ck="ver"]').click();
    await expect(page.locator('.rel-travas')).toBeVisible();
    // O client_secret nunca fica salvo no aparelho.
    const salvo = await page.evaluate(() => JSON.stringify(Object.assign({}, window.localStorage)));
    expect(salvo).not.toContain('_secret_');
    expect(stripe).toEqual([]);
    expect(erros).toEqual([]);
  });

  test('Pix: o QR e o copia e cola aparecem na nossa tela na hora; consulta a cada 4 s e libera quando pago', async ({ page }) => {
    const erros = coletarErros(page);
    await fazerTestePessoal(page, { nome: 'Pedro Stripe Pix', email: 'pedro.pix@exemplo.com' });
    await page.locator('[data-acao="comprar"][data-pacote="completo"]').click();
    await page.locator('[data-ck="continuar"]').click();
    const tela = page.locator('[data-ck-tela="pagamento"][data-provedor="stripe"]');
    await tela.locator('[data-pe-metodo="pix"]').click();
    await expect(tela.locator('[data-pe-metodo="pix"]')).toHaveAttribute('aria-selected', 'true');
    await tela.locator('[data-ck="pagar"]').click();
    await expect(tela.locator('#ck-pix-stripe .ck-qr img')).toBeVisible();
    await expect(tela.locator('#ck-pix')).toHaveValue(/^PREVIA-NAO-PAGUE-/);
    await expect(tela.locator('#ck-status')).toContainText('Pague o Pix no app do seu banco');
    await semRolagemLateral(page);
    if (CAPTURAS_STRIPE) await page.screenshot({ path: CAPTURAS_STRIPE + '/checkout-375-pix.png', fullPage: true });
    // O "banco" confirma (fora da página): a consulta de 4 s libera sozinha.
    const pedidoId = await page.evaluate(() => JSON.parse(localStorage.getItem('disc_pessoal_v1')).pedido.pedidoId);
    await page.evaluate((id) => window.DISC_API.simularPagamento(id), pedidoId);
    await expect(page.locator('[data-ck-tela="confirmado"] h1')).toHaveText('Pagamento confirmado', { timeout: 10000 });
    expect(erros).toEqual([]);
  });

  test('volta do 3DS: meu-relatorio com payment_intent e redirect_status=succeeded confirma e limpa a URL; failed avisa', async ({ page }) => {
    const erros = coletarErros(page);
    await fazerTestePessoal(page, { nome: 'Rita Retorno Stripe', email: 'rita.3ds@exemplo.com' });
    await page.locator('[data-acao="comprar"][data-pacote="completo"]').click();
    await page.locator('[data-ck="continuar"]').click();
    await expect(page.locator('[data-ck-tela="pagamento"][data-provedor="stripe"]')).toBeVisible();
    const dados = await page.evaluate(async () => {
      const ps = JSON.parse(localStorage.getItem('disc_pessoal_v1'));
      const r = await window.DISC_API.iniciarPagamento(ps.pedido.pedidoId, ps.pedido.tokenAcesso);
      return { id: ps.pedido.pedidoId, token: ps.pedido.tokenAcesso, cs: r.clientSecret };
    });
    const pi = dados.cs.split('_secret_')[0];
    // Recusado pelo banco: avisa e não libera.
    await page.goto('/meu-relatorio.html?pedido=' + dados.id + '&payment_intent=' + pi + '&payment_intent_client_secret=' + dados.cs + '&redirect_status=failed#t-' + dados.token);
    await expect(page.locator('h1').first()).toHaveText('Pagamento não concluído');
    await expect(page.locator('.alerta')).toContainText('nada foi cobrado');
    // Aprovado (o Stripe acrescenta payment_intent, payment_intent_client_secret e redirect_status ao return_url).
    await page.goto('about:blank');
    await page.goto('/meu-relatorio.html?pedido=' + dados.id + '&payment_intent=' + pi + '&payment_intent_client_secret=' + dados.cs + '&redirect_status=succeeded#t-' + dados.token);
    await expect(page.locator('.rel-travas')).toBeVisible();
    await expect(page).toHaveURL(new RegExp('/meu-relatorio\\.html#t-' + dados.token + '$'));
    expect(page.url()).not.toContain('_secret_');
    await semRolagemLateral(page);
    expect(erros).toEqual([]);
  });
});

test('modo pessoal sem servidor: resumo grátis na hora e compra "em breve"', async ({ page }) => {
  const erros = coletarErros(page);
  await configurar(page, { API_URL: '', GRUPOS_DEMONSTRACAO: GRUPOS });
  await fazerTestePessoal(page, { nome: 'Gil Sem Servidor', email: 'gil@exemplo.com' });
  await expect(page.locator('.resumo-gratis .rel-fator')).toHaveCount(4);
  await expect(page.locator('.paywall')).toContainText('disponível em breve');
  await expect(page.locator('[data-acao="comprar"]')).toHaveCount(0);
  await semRolagemLateral(page);
  expect(erros).toEqual([]);
});
