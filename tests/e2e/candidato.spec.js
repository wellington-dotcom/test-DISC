'use strict';
const { test, expect } = require('@playwright/test');
const { API_FALSA, coletarErros, configurar, simularApi, ordemNaTela, responderGrupo, preencherIdentificacao, fazerTesteCompleto } = require('./util.js');

const DADOS = { nome: 'Maria Conceição Ávila', telefone: '11987654321', vaga: 'Atendimento' };

test.describe('Candidato (celular, sem API)', () => {
  test('valida identificação, retoma progresso após recarregar e gera o código', async ({ page }) => {
    const erros = coletarErros(page);
    await page.goto('/index.html');
    await expect(page.locator('h1')).toHaveText('Teste de Perfil Comportamental DISC');
    await page.locator('[data-acao="comecar"]').click();
    await expect(page.locator('h1')).toHaveText('Sua identificação');

    const enviar = page.locator('#form-identificacao button[type="submit"]');

    // Tudo vazio
    await enviar.click();
    await expect(page.locator('#erro-nome')).toHaveText('Informe seu nome completo.');
    await expect(page.locator('#erro-telefone')).toContainText('Informe seu telefone');
    await expect(page.locator('#erro-consentimento')).toContainText('autorização');
    await expect(page.locator('#nome')).toHaveAttribute('aria-invalid', 'true');

    // Nome de uma palavra e telefone curto
    await page.fill('#nome', 'Maria');
    await page.locator('#telefone').pressSequentially('1199999');
    await enviar.click();
    await expect(page.locator('#erro-nome')).toHaveText('Informe nome e sobrenome.');
    await expect(page.locator('#erro-telefone')).toContainText('Telefone inválido');

    // Dados válidos, mas sem consentimento
    await preencherIdentificacao(page, Object.assign({}, DADOS, { consentimento: false }));
    await expect(page.locator('#telefone')).toHaveValue('(11) 98765-4321');
    await enviar.click();
    await expect(page.locator('#erro-nome')).toHaveText('');
    await expect(page.locator('#erro-telefone')).toHaveText('');
    await expect(page.locator('#erro-consentimento')).not.toHaveText('');
    await expect(page.locator('h1')).toHaveText('Sua identificação');

    await page.check('#consentimento');
    await enviar.click();

    // Grupo 1: 4 cartões, "Avançar" desabilitado até a pessoa ordenar; sem "Refazer grupo".
    await expect(page.locator('.progresso-topo')).toContainText('Grupo 1 de 25');
    await expect(page.locator('.cartao')).toHaveCount(4);
    await expect(page.locator('[data-acao="proximo"]')).toBeDisabled();
    await expect(page.locator('[data-acao="refazer"]')).toHaveCount(0);

    const ordem = ['S', 'C', 'I', 'D'];
    for (let i = 0; i < 12; i++) {
      await expect(page.locator('.progresso-topo')).toContainText('Grupo ' + (i + 1) + ' de 25');
      await responderGrupo(page, ordem);
      if (i === 0) {
        expect(await ordemNaTela(page)).toEqual(ordem);
        await expect(page.locator('[data-acao="proximo"]')).toBeEnabled();
      }
      await page.locator('[data-acao="proximo"]').click();
    }

    // A ordem das palavras é embaralhada (não é sempre D, I, S, C).
    const ordemTela = await page.locator('.cartao').evaluateAll((els) => els.map((e) => e.getAttribute('data-letra')).join(''));
    expect(ordemTela.split('').sort().join('')).toBe('CDIS');

    // Recarrega no meio: deve oferecer "Continuar de onde parei" e voltar ao grupo 13.
    await page.reload();
    await expect(page.locator('[data-acao="continuar"]')).toBeVisible();
    await page.locator('[data-acao="continuar"]').click();
    await expect(page.locator('.progresso-topo')).toContainText('Grupo 13 de 25');
    const ordemDepois = await page.locator('.cartao').evaluateAll((els) => els.map((e) => e.getAttribute('data-letra')).join(''));
    expect(ordemDepois).toBe(ordemTela);

    for (let i = 12; i < 25; i++) {
      await expect(page.locator('.progresso-topo')).toContainText('Grupo ' + (i + 1) + ' de 25');
      await responderGrupo(page, ordem);
      await page.locator('[data-acao="proximo"]').click();
    }

    // Revisão
    await expect(page.locator('h1')).toHaveText('Revise suas respostas');
    await expect(page.locator('.resumo-dados')).toContainText('Maria Conceição Ávila');
    await expect(page.locator('.resumo-dados')).toContainText('(11) 98765-4321');
    await expect(page.locator('.revisao-item')).toHaveCount(25);
    await expect(page.locator('.revisao-item.incompleto')).toHaveCount(0);

    await page.locator('[data-acao="enviar"]').click();
    await expect(page.locator('h1')).toHaveText('Obrigado, Maria!');
    // Sem servidor não há protocolo: plano B com o código de segurança longo.
    await expect(page.locator('#protocolo')).toHaveCount(0);
    await expect(page.locator('.codigo-bloco')).toContainText('Código de segurança');
    await expect(page.locator('.codigo-bloco')).toContainText('Não conseguimos enviar suas respostas. Envie este código ao recrutador pelo WhatsApp.');
    const codigo = await page.locator('textarea#codigo').inputValue();
    expect(codigo.startsWith('DISC1.')).toBe(true);

    const payload = await page.evaluate((c) => window.DISC_CODEC.decode(c), codigo);
    expect(payload.v).toBe(1);
    expect(payload.nome).toBe('Maria Conceição Ávila');
    expect(payload.telefone).toBe('5511987654321');
    expect(payload.vaga).toBe('Atendimento');
    expect(payload.consentimento).toBe(true);
    expect(payload.respostas).toBe('1243'.repeat(25)); // D=1, I=2, S=4, C=3
    expect(payload.resultado.codigo).toBe('SC');
    expect(payload.id).toMatch(/^[A-Za-z0-9_-]{6,64}$/);

    // Progresso limpo; após recarregar a tela de conclusão continua com o mesmo código.
    expect(await page.evaluate(() => localStorage.getItem('disc_progresso_v1'))).toBeNull();
    // Dados pessoais da conclusão não ficam no localStorage (aparelho compartilhado).
    expect(await page.evaluate(() => localStorage.getItem('disc_concluido_v1'))).toBeNull();
    await page.reload();
    await expect(page.locator('textarea#codigo')).toHaveValue(codigo);

    // Novo teste neste aparelho
    await page.locator('[data-acao="novo-teste"]').click();
    await expect(page.locator('[data-acao="novo-teste"]')).toHaveText('Toque de novo para confirmar');
    await page.locator('[data-acao="novo-teste"]').click();
    await expect(page.locator('[data-acao="comecar"]')).toBeVisible();

    expect(erros).toEqual([]);
  });

  test('sem rolagem horizontal no celular', async ({ page }) => {
    const erros = coletarErros(page);
    await page.goto('/index.html');
    await page.locator('[data-acao="comecar"]').click();
    await preencherIdentificacao(page, DADOS);
    await page.locator('#form-identificacao button[type="submit"]').click();
    const larguras = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    expect(larguras[0]).toBeLessThanOrEqual(larguras[1]);
    expect(erros).toEqual([]);
  });
});

test.describe('Candidato (celular, com API simulada)', () => {
  test('envio faz POST text/plain com o payload correto', async ({ page }) => {
    const erros = coletarErros(page);
    await configurar(page, { API_URL: API_FALSA, WHATSAPP_RECRUTADOR: '5511900001111', EMPRESA: 'Empresa Teste' });
    let falhar = true;
    const chamadas = await simularApi(page, (corpo) => {
      if (corpo.acao === 'enviar' && falhar) { falhar = false; return { ok: false, erro: 'Falha temporária simulada.' }; }
      return { ok: true, id: corpo.payload && corpo.payload.id, protocolo: '47K' };
    });

    await fazerTesteCompleto(page, { nome: 'José Antônio Pereira', telefone: '2133334444' }, ['D', 'I', 'S', 'C']);
    await page.locator('[data-acao="enviar"]').click();

    // Primeira tentativa falha e mostra o erro; a segunda dá certo.
    await expect(page.locator('h1')).toHaveText('Não foi possível enviar');
    // Mensagem técnica do servidor não é mostrada ao candidato; ele é orientado a usar o código.
    await expect(page.locator('.alerta')).toContainText('Gerar código de segurança');
    await expect(page.locator('.alerta')).not.toContainText('Falha temporária simulada.');
    await page.locator('[data-acao="retentar"]').click();
    await expect(page.locator('h1')).toHaveText('Obrigado, José!');
    await expect(page.locator('.destaque')).toContainText('enviadas com sucesso');
    // Envio confirmado: o protocolo curto do servidor aparece no card; nada de código longo.
    await expect(page.locator('.agradecimento')).toContainText('Seu código');
    await expect(page.locator('#protocolo')).toHaveText('47K');
    await expect(page.locator('#protocolo')).toHaveClass(/t-numero-grande/);
    await expect(page.locator('.agradecimento')).toContainText('Guarde este código. Se o recrutador pedir, é só informar.');
    await expect(page.locator('[data-acao="copiar-protocolo"]')).toHaveText('Copiar código');
    await expect(page.locator('textarea#codigo')).toHaveCount(0);
    await expect(page.locator('.codigo-bloco')).toHaveCount(0);
    const wa = await page.locator('a.btn-whatsapp').getAttribute('href');
    expect(wa).toMatch(/^https:\/\/wa\.me\/5511900001111\?text=/);
    const msg = decodeURIComponent(wa.split('?text=')[1]);
    expect(msg).toBe('Olá! Concluí o Teste DISC. Nome: José Antônio Pereira. Código: 47K.');
    expect(msg).not.toContain('DISC1.');
    // Só primeiro nome + protocolo nesta aba; nada no localStorage.
    expect(await page.evaluate(() => localStorage.getItem('disc_concluido_v1'))).toBeNull();
    const sessao = await page.evaluate(() => JSON.parse(sessionStorage.getItem('disc_concluido_v1')));
    expect(sessao).toEqual({ enviado: true, primeiroNome: 'José', protocolo: '47K' });
    await page.reload();
    await expect(page.locator('h1')).toHaveText('Obrigado, José!');
    await expect(page.locator('#protocolo')).toHaveText('47K');

    const envios = chamadas.filter((c) => c.corpo.acao === 'enviar');
    expect(envios.length).toBe(2);
    expect(envios[0].headers['content-type']).toContain('text/plain');
    const p = envios[1].corpo.payload;
    expect(envios[0].corpo.payload.id).toBe(p.id);
    expect(p.v).toBe(1);
    expect(p.nome).toBe('José Antônio Pereira');
    expect(p.telefone).toBe('552133334444');
    expect(p.vaga).toBe('');
    expect(p.consentimento).toBe(true);
    expect(p.respostas).toBe('4321'.repeat(25));
    expect(p.resultado).toEqual({ percentuais: { D: 40, I: 30, S: 20, C: 10 }, codigo: 'DI' });
    expect(Date.parse(p.inicio)).toBeLessThanOrEqual(Date.parse(p.fim));
    expect(p.duracaoSeg).toBeGreaterThanOrEqual(0);

    expect(erros).toEqual([]);
  });
});

test.describe('Candidato (celular, com API simulada fora do ar)', () => {
  test('envio falha, candidato gera código com WhatsApp do recrutador', async ({ page }) => {
    const erros = coletarErros(page);
    await configurar(page, { API_URL: API_FALSA, WHATSAPP_RECRUTADOR: '5511900001111' });
    await simularApi(page, () => ({ ok: false, erro: 'Limite de respostas atingido. Avise o recrutador.' }));
    await fazerTesteCompleto(page, { nome: 'Paula Regina Costa', telefone: '11912345678' }, ['C', 'S', 'I', 'D']);
    await page.locator('[data-acao="enviar"]').click();
    await expect(page.locator('h1')).toHaveText('Não foi possível enviar');
    await expect(page.locator('[data-acao="usar-codigo"]')).toHaveText('Gerar código de segurança');
    await page.locator('[data-acao="usar-codigo"]').click();
    await expect(page.locator('h1')).toHaveText('Obrigado, Paula!');
    await expect(page.locator('#protocolo')).toHaveCount(0);
    await expect(page.locator('.codigo-bloco')).toContainText('Código de segurança');
    const codigo = await page.locator('textarea#codigo').inputValue();
    expect(codigo.startsWith('DISC1.')).toBe(true);
    await expect(page.locator('a.btn-whatsapp')).toHaveAttribute('href', /^https:\/\/wa\.me\/5511900001111\?text=/);
    expect(await page.evaluate(() => localStorage.getItem('disc_concluido_v1'))).toBeNull();
    expect(erros).toEqual([]);
  });
});

test.describe('Candidato: telefone e textos', () => {
  test('telefone colado com +55 não é cortado e celular truncado é recusado', async ({ page }) => {
    const erros = coletarErros(page);
    await page.goto('/index.html');
    await page.locator('[data-acao="comecar"]').click();
    await page.fill('#nome', 'Ana Beatriz Lima');
    await page.fill('#telefone', '+55 11 99999-8888');
    await expect(page.locator('#telefone')).toHaveValue('(11) 99999-8888');
    await page.fill('#telefone', '(11) 9999-9888');
    await page.check('#consentimento');
    await page.locator('#form-identificacao button[type="submit"]').click();
    await expect(page.locator('#erro-telefone')).toContainText('celulares têm 9 dígitos');
    expect(erros).toEqual([]);
  });

  test('título do grupo é uma pergunta para o candidato', async ({ page }) => {
    await page.goto('/index.html');
    await page.locator('[data-acao="comecar"]').click();
    await preencherIdentificacao(page, DADOS);
    await page.locator('#form-identificacao button[type="submit"]').click();
    await expect(page.locator('h1')).toHaveText('Costumo agir de forma...');
  });

  test('progresso abandonado há mais de 7 dias é apagado', async ({ page }) => {
    await page.goto('/index.html');
    await page.evaluate(() => {
      const velho = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString();
      localStorage.setItem('disc_progresso_v1', JSON.stringify({ etapa: 'teste', id: 'abc123-x', nome: 'Fulano de Tal', telefone: '11999998888', selecoes: [], grupo: 0, inicio: velho, salvoEm: velho }));
      localStorage.setItem('disc_concluido_v1', JSON.stringify({ enviado: true, payload: { nome: 'Antigo Candidato' } }));
    });
    await page.reload();
    await expect(page.locator('[data-acao="comecar"]')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('disc_progresso_v1'))).toBeNull();
    expect(await page.evaluate(() => localStorage.getItem('disc_concluido_v1'))).toBeNull();
  });
});

test.describe('Candidato: lista ordenável dos grupos', () => {
  async function irParaGrupo1(page) {
    await page.goto('/index.html');
    await page.locator('[data-acao="comecar"]').click();
    await preencherIdentificacao(page, DADOS);
    await page.locator('#form-identificacao button[type="submit"]').click();
    await expect(page.locator('.progresso-topo')).toContainText('Grupo 1 de 25');
    await expect(page.locator('.cartao')).toHaveCount(4);
  }

  async function arrastar(page, letra, posicaoDestino) {
    const cartao = page.locator('.cartao[data-letra="' + letra + '"]');
    const caixa = await cartao.boundingBox();
    const lista = await page.locator('.cartoes').boundingBox();
    const passo = (lista.height - caixa.height) / 3;
    const x = caixa.x + caixa.width / 2 - 40;      // longe dos botões ▲/▼
    const y = caixa.y + caixa.height / 2;
    const yDestino = lista.y + caixa.height / 2 + posicaoDestino * passo;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + (yDestino - y) / 2, { steps: 6 });
    await page.mouse.move(x, yDestino, { steps: 6 });
    await page.mouse.up();
  }

  test('Avançar só libera depois de mexer; "Esta ordem está certa" libera sem mexer', async ({ page }) => {
    const erros = coletarErros(page);
    await irParaGrupo1(page);
    const proximo = page.locator('[data-acao="proximo"]');
    await expect(proximo).toBeDisabled();
    await expect(page.locator('#dica-avancar')).toHaveText('Arraste as palavras para ordenar');
    const inicial = await ordemNaTela(page);
    await page.locator('[data-acao="confirmar-ordem"]').click();
    await expect(proximo).toBeEnabled();
    await expect(page.locator('[data-acao="confirmar-ordem"]')).toHaveCount(0);
    expect(await ordemNaTela(page)).toEqual(inicial);
    // Ordem e marcação ficam no progresso salvo
    const salvo = await page.evaluate(() => JSON.parse(localStorage.getItem('disc_progresso_v1')));
    expect(salvo.ordens[0]).toEqual(inicial);
    expect(salvo.respondidos[0]).toBe(true);
    // Grupo 2 começa bloqueado de novo
    await proximo.click();
    await expect(page.locator('.progresso-topo')).toContainText('Grupo 2 de 25');
    await expect(proximo).toBeDisabled();
    expect(erros).toEqual([]);
  });

  test('botões ▲/▼ e teclado reordenam (topo e base desabilitados nas pontas)', async ({ page }) => {
    const erros = coletarErros(page);
    await irParaGrupo1(page);
    const inicial = await ordemNaTela(page);
    await expect(page.locator('.cartao').first().locator('[data-mover="-1"]')).toBeDisabled();
    await expect(page.locator('.cartao').last().locator('[data-mover="1"]')).toBeDisabled();
    // ▲ no último: troca com o terceiro
    await page.locator('.cartao[data-letra="' + inicial[3] + '"] [data-mover="-1"]').click();
    expect(await ordemNaTela(page)).toEqual([inicial[0], inicial[1], inicial[3], inicial[2]]);
    await expect(page.locator('[data-acao="proximo"]')).toBeEnabled();
    await expect(page.locator('#aviso')).toContainText('posição 3 de 4');
    // ▼ no primeiro
    await page.locator('.cartao[data-letra="' + inicial[0] + '"] [data-mover="1"]').click();
    expect(await ordemNaTela(page)).toEqual([inicial[1], inicial[0], inicial[3], inicial[2]]);
    // Teclado: foco no cartão, seta para cima leva ao topo
    await page.locator('.cartao[data-letra="' + inicial[3] + '"]').focus();
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    expect(await ordemNaTela(page)).toEqual([inicial[3], inicial[1], inicial[0], inicial[2]]);
    await expect(page.locator('.cartao[data-letra="' + inicial[3] + '"]')).toBeFocused();
    await expect(page.locator('#aviso')).toContainText('posição 1 de 4');
    expect(erros).toEqual([]);
  });

  test('arrastar com o mouse reordena', async ({ page }) => {
    const erros = coletarErros(page);
    await irParaGrupo1(page);
    const inicial = await ordemNaTela(page);
    await arrastar(page, inicial[3], 0);   // de baixo para o topo
    await expect.poll(() => ordemNaTela(page)).toEqual([inicial[3], inicial[0], inicial[1], inicial[2]]);
    await expect(page.locator('[data-acao="proximo"]')).toBeEnabled();
    await arrastar(page, inicial[3], 2);   // do topo para a posição 2
    await expect.poll(() => ordemNaTela(page)).toEqual([inicial[0], inicial[1], inicial[3], inicial[2]]);
    // Depois de soltar, cada cartão encaixa na sua linha
    await page.waitForTimeout(400);
    const tops = await page.locator('.cartao').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    for (let k = 1; k < 4; k++) expect(tops[k]).toBeGreaterThan(tops[k - 1]);
    expect(erros).toEqual([]);
  });

  test('Voltar/Avançar não mudam de lugar ao mexer nem entre grupos; resultado bate com a ordem', async ({ page }) => {
    const erros = coletarErros(page);
    await irParaGrupo1(page);
    const caixas = async () => [
      await page.locator('[data-acao="anterior"]').boundingBox(),
      await page.locator('[data-acao="proximo"]').boundingBox(),
      await page.locator('.cartoes').boundingBox()
    ];
    const antes = await caixas();
    const inicial = await ordemNaTela(page);
    await page.locator('.cartao[data-letra="' + inicial[2] + '"] [data-mover="-1"]').click();
    await page.waitForTimeout(300);
    const depois = await caixas();
    expect(depois).toEqual(antes);

    const ordem = ['I', 'C', 'D', 'S'];
    await responderGrupo(page, ordem);
    await page.locator('[data-acao="proximo"]').click();
    await expect(page.locator('.progresso-topo')).toContainText('Grupo 2 de 25');
    await page.waitForTimeout(300);
    const grupo2 = await caixas();
    expect(grupo2[0]).toEqual(antes[0]);
    expect(grupo2[1]).toEqual(antes[1]);

    // Voltar ao grupo 1 mostra a ordem salva
    await page.locator('[data-acao="anterior"]').click();
    await expect(page.locator('.progresso-topo')).toContainText('Grupo 1 de 25');
    expect(await ordemNaTela(page)).toEqual(ordem);
    await expect(page.locator('[data-acao="proximo"]')).toBeEnabled();
    await page.locator('[data-acao="proximo"]').click();

    for (let i = 1; i < 25; i++) {
      await expect(page.locator('.progresso-topo')).toContainText('Grupo ' + (i + 1) + ' de 25');
      await responderGrupo(page, ordem);
      await page.locator('[data-acao="proximo"]').click();
    }
    await expect(page.locator('h1')).toHaveText('Revise suas respostas');
    // Revisão mostra 4 → 1 e "Alterar" volta ao grupo
    await expect(page.locator('.revisao-item').first().locator('.revisao-ordem li')).toHaveCount(4);
    await expect(page.locator('.revisao-item').first().locator('.mini-nota')).toHaveText(['4', '3', '2', '1']);
    await page.locator('[data-acao="editar-grupo"][data-grupo="3"]').click();
    await expect(page.locator('.progresso-topo')).toContainText('Grupo 4 de 25');
    expect(await ordemNaTela(page)).toEqual(ordem);
    await page.locator('[data-acao="proximo"]').click();
    await expect(page.locator('h1')).toHaveText('Revise suas respostas');

    await page.locator('[data-acao="enviar"]').click();
    const codigo = await page.locator('textarea#codigo').inputValue();
    const payload = await page.evaluate((c) => window.DISC_CODEC.decode(c), codigo);
    expect(payload.respostas).toBe('2413'.repeat(25)); // D=2, I=4, S=1, C=3
    expect(payload.resultado.codigo).toBe('IC');
    expect(erros).toEqual([]);
  });
});

test.describe('Candidato: dicas (botão "i")', () => {
  async function irParaGrupo1(page) {
    await page.goto('/index.html');
    await page.locator('[data-acao="comecar"]').click();
    await preencherIdentificacao(page, DADOS);
    await page.locator('#form-identificacao button[type="submit"]').click();
    await expect(page.locator('.progresso-topo')).toContainText('Grupo 1 de 25');
  }

  test('boas-vindas explicam o "i"', async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.locator('.lista-info')).toContainText('Não entendeu uma palavra? Toque no i ao lado dela.');
  });

  test('"i" da pergunta e das palavras abre a dica, fecha com Esc, fora e no próprio "i"', async ({ page }) => {
    const erros = coletarErros(page);
    await irParaGrupo1(page);
    const janela = page.locator('#dica-janela');
    const proximo = page.locator('[data-acao="proximo"]');

    // Pergunta
    const infoPergunta = page.locator('h1 .info[data-dica="pergunta"]');
    await expect(infoPergunta).toHaveAttribute('aria-label', 'Entender a pergunta');
    await expect(infoPergunta).toHaveAttribute('aria-expanded', 'false');
    await infoPergunta.click();
    await expect(janela).toBeVisible();
    await expect(infoPergunta).toHaveAttribute('aria-expanded', 'true');
    const textoPergunta = await page.evaluate(() => window.DISC_DICAS.dicaPergunta(0));
    await expect(janela.locator('.dica-sentido')).toHaveText(textoPergunta);
    await page.keyboard.press('Escape');
    await expect(janela).toBeHidden();
    await expect(infoPergunta).toHaveAttribute('aria-expanded', 'false');

    // Palavra: abre sem mexer no cartão, sem liberar o Avançar
    const ordem = await ordemNaTela(page);
    const letra = ordem[1];
    const cartao = page.locator('.cartao[data-letra="' + letra + '"]');
    const info = cartao.locator('.info');
    const palavra = await page.evaluate((l) => window.DISC_DICAS.dicaPalavra(0, l), letra);
    await expect(info).toHaveAttribute('aria-label', 'O que significa ' + palavra.palavra + '?');
    const antes = await cartao.boundingBox();
    await info.click();
    await expect(janela).toBeVisible();
    await expect(janela.locator('.dica-palavra')).toHaveText(palavra.palavra);
    await expect(janela.locator('.dica-sentido')).toHaveText(palavra.sentido);
    await expect(janela.locator('.dica-exemplo')).toHaveText(palavra.exemplo);
    expect(await cartao.boundingBox()).toEqual(antes);
    expect(await ordemNaTela(page)).toEqual(ordem);
    await expect(proximo).toBeDisabled();
    // Dentro da tela
    const caixa = await janela.boundingBox();
    const vw = page.viewportSize().width;
    expect(caixa.x).toBeGreaterThanOrEqual(16);
    expect(caixa.x + caixa.width).toBeLessThanOrEqual(vw - 16 + 0.5);

    // Só um aberto: abrir outro fecha o anterior
    const outro = page.locator('.cartao[data-letra="' + ordem[2] + '"] .info');
    await outro.click();
    await expect(janela).toBeVisible();
    await expect(info).toHaveAttribute('aria-expanded', 'false');
    await expect(outro).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.info[aria-expanded="true"]')).toHaveCount(1);
    // Tocar de novo no "i" fecha
    await outro.click();
    await expect(janela).toBeHidden();
    // Clique fora fecha
    await info.click();
    await expect(janela).toBeVisible();
    await page.locator('.instrucao').click();
    await expect(janela).toBeHidden();

    await expect(proximo).toBeDisabled();
    expect(await ordemNaTela(page)).toEqual(ordem);
    expect(erros).toEqual([]);
  });

  test('pressionar e puxar o "i" não arrasta o cartão; arrastar o cartão fecha a dica', async ({ page }) => {
    const erros = coletarErros(page);
    await irParaGrupo1(page);
    const ordem = await ordemNaTela(page);
    const info = page.locator('.cartao[data-letra="' + ordem[3] + '"] .info');
    const b = await info.boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y - 200, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    expect(await ordemNaTela(page)).toEqual(ordem);
    await expect(page.locator('.cartao.arrastando')).toHaveCount(0);
    await expect(page.locator('[data-acao="proximo"]')).toBeDisabled();

    // Abre uma dica e arrasta outro cartão: a dica fecha
    await page.locator('.cartao[data-letra="' + ordem[0] + '"] .info').click();
    await expect(page.locator('#dica-janela')).toBeVisible();
    const c = await page.locator('.cartao[data-letra="' + ordem[3] + '"]').boundingBox();
    const x = c.x + 40, y = c.y + c.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y - 60, { steps: 6 });
    await expect(page.locator('#dica-janela')).toBeHidden();
    await page.mouse.move(x, y - 3 * c.height, { steps: 6 });
    await page.mouse.up();
    await expect.poll(() => ordemNaTela(page)).toEqual([ordem[3], ordem[0], ordem[1], ordem[2]]);
    expect(erros).toEqual([]);
  });
});

test.describe('Candidato: modo demonstração', () => {
  test('GRUPOS_DEMONSTRACAO=3: responde 3 grupos, revisão mostra 3 e o payload vai com os 25', async ({ page }) => {
    const erros = coletarErros(page);
    await configurar(page, { GRUPOS_DEMONSTRACAO: 3 });
    await page.goto('/index.html');
    await expect(page.locator('.lista-info')).toContainText('São 3 grupos de 4 palavras.');
    await page.locator('[data-acao="comecar"]').click();
    await preencherIdentificacao(page, DADOS);
    await page.locator('#form-identificacao button[type="submit"]').click();
    const faixa = 'Modo demonstração: só 3 grupos; os outros são preenchidos ao acaso. O resultado não vale como avaliação.';
    const ordem = ['S', 'C', 'I', 'D'];
    for (let i = 0; i < 3; i++) {
      await expect(page.locator('.progresso-topo')).toContainText('Grupo ' + (i + 1) + ' de 3');
      await expect(page.locator('.faixa-demo')).toHaveText(faixa);
      await responderGrupo(page, ordem);
      if (i === 2) await expect(page.locator('[data-acao="proximo"]')).toHaveText('Revisar respostas');
      await page.locator('[data-acao="proximo"]').click();
    }
    await expect(page.locator('h1')).toHaveText('Revise suas respostas');
    await expect(page.locator('.faixa-demo')).toHaveText(faixa);
    await expect(page.locator('.revisao-item')).toHaveCount(3);
    await expect(page.locator('.revisao-item.incompleto')).toHaveCount(0);
    await expect(page.locator('[data-acao="enviar"]')).toBeEnabled();
    const salvo = await page.evaluate(() => JSON.parse(localStorage.getItem('disc_progresso_v1')));
    expect(salvo.respondidos.every(Boolean)).toBe(true);
    expect(salvo.preenchidosAoAcaso).toEqual(Array.from({ length: 22 }, (_, k) => k + 3));

    await page.locator('[data-acao="enviar"]').click();
    const codigo = await page.locator('textarea#codigo').inputValue();
    const payload = await page.evaluate((c) => window.DISC_CODEC.decode(c), codigo);
    expect(payload.respostas).toMatch(/^[1-4]{100}$/);
    expect(payload.respostas.slice(0, 12)).toBe('1243'.repeat(3));
    const valido = await page.evaluate((r) => window.DISC_SCORING.validarRespostas(window.DISC_SCORING.descompactar(r)), payload.respostas);
    expect(valido).toBe(true);
    expect(erros).toEqual([]);
  });

  test('desligado por padrão: 25 grupos e sem faixa', async ({ page }) => {
    await page.goto('/index.html');
    await page.locator('[data-acao="comecar"]').click();
    await preencherIdentificacao(page, DADOS);
    await page.locator('#form-identificacao button[type="submit"]').click();
    await expect(page.locator('.progresso-topo')).toContainText('Grupo 1 de 25');
    await expect(page.locator('.faixa-demo')).toHaveCount(0);
  });
});
