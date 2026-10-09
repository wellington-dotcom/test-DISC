'use strict';
const { test, expect } = require('@playwright/test');
const { API_FALSA, coletarErros, configurar, simularApi, ordemNaTela, responderGrupo, preencherIdentificacao, responderConfirmacao, responderParte2, fazerTesteCompleto } = require('./util.js');

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
    await expect(page.locator('#erro-idade')).toHaveText('Informe sua idade (só números).');
    await expect(page.locator('#idade')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#erro-consentimento')).toContainText('autorização');
    await expect(page.locator('#nome')).toHaveAttribute('aria-invalid', 'true');

    // Nome de uma palavra e telefone curto
    await page.fill('#nome', 'Maria');
    await page.locator('#telefone').pressSequentially('1199999');
    await enviar.click();
    await expect(page.locator('#erro-nome')).toHaveText('Informe nome e sobrenome.');
    await expect(page.locator('#erro-telefone')).toContainText('Telefone inválido');

    // Idade: só dígitos (letras são descartadas) e entre 14 e 99
    await page.locator('#idade').pressSequentially('1a2');
    await expect(page.locator('#idade')).toHaveValue('12');
    await enviar.click();
    await expect(page.locator('#erro-idade')).toHaveText('Confira a idade: precisa ser entre 14 e 99 anos.');
    await page.fill('#idade', '100');
    await enviar.click();
    await expect(page.locator('#erro-idade')).toHaveText('Confira a idade: precisa ser entre 14 e 99 anos.');
    await expect(page.locator('h1')).toHaveText('Sua identificação');

    // Dados válidos, mas sem consentimento
    await preencherIdentificacao(page, Object.assign({}, DADOS, { consentimento: false }));
    await expect(page.locator('#telefone')).toHaveValue('(11) 98765-4321');
    await enviar.click();
    await expect(page.locator('#erro-nome')).toHaveText('');
    await expect(page.locator('#erro-telefone')).toHaveText('');
    await expect(page.locator('#erro-idade')).toHaveText('');
    await expect(page.locator('#idade')).not.toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#erro-consentimento')).not.toHaveText('');
    await expect(page.locator('.consentimento')).toContainText('a idade é usada só para fins cadastrais');
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
    await responderConfirmacao(page);

    // Sem tela de revisão: "Enviar e finalizar" envia direto.
    await page.locator('[data-acao="enviar"]').click();
    await expect(page.locator('h1')).toHaveText('Obrigado, Maria!');
    // Sem servidor não há protocolo: plano B com o código de segurança longo.
    await expect(page.locator('#protocolo')).toHaveCount(0);
    await expect(page.locator('.codigo-bloco')).toContainText('Código de segurança');
    // Sem o número do recrutador no config, o texto não promete WhatsApp; sem servidor não há "Tentar enviar de novo".
    await expect(page.locator('.codigo-bloco')).toContainText('Não conseguimos enviar suas respostas. Copie este código e envie ao recrutador pelo mesmo canal em que você recebeu o link do teste.');
    await expect(page.locator('.codigo-bloco')).not.toContainText('WhatsApp');
    await expect(page.locator('[data-acao="reenviar"]')).toHaveCount(0);
    const codigo = await page.locator('textarea#codigo').inputValue();
    expect(codigo.startsWith('DISC1.')).toBe(true);

    const payload = await page.evaluate((c) => window.DISC_CODEC.decode(c), codigo);
    expect(payload.v).toBe(1);
    expect(payload.nome).toBe('Maria Conceição Ávila');
    expect(payload.telefone).toBe('5511987654321');
    expect(payload.vaga).toBe('Atendimento');
    expect(payload.idade).toBe(30);
    expect(payload.funcao).toBe('');
    expect(payload.empresa).toBe('');
    expect(payload.email).toBe('');
    expect(payload.cidade).toBe('');
    expect(payload.extras).toEqual([]);
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

    await fazerTesteCompleto(page, { nome: 'José Antônio Pereira', telefone: '2133334444', idade: '52', funcao: '  Auxiliar de caixa ', empresa: 'Mercado Bom Preço' }, ['D', 'I', 'S', 'C']);
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
    expect(p.idade).toBe(52);
    expect(p.funcao).toBe('Auxiliar de caixa');
    expect(p.empresa).toBe('Mercado Bom Preço');
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

  test('progresso salvo antes do campo idade: ao continuar pede a idade e segue do mesmo grupo', async ({ page }) => {
    const erros = coletarErros(page);
    await page.goto('/index.html');
    await page.evaluate(() => {
      const agora = new Date().toISOString();
      const ordens = []; const respondidos = [];
      for (let i = 0; i < 25; i++) { ordens.push(i < 3 ? ['D', 'I', 'S', 'C'] : null); respondidos.push(i < 3); }
      localStorage.setItem('disc_progresso_v1', JSON.stringify({ etapa: 'teste', id: 'abc123-antigo', nome: 'Fulano de Tal', telefone: '11999998888',
        vaga: '', consentimento: true, ordens, respondidos, grupo: 3, inicio: agora, salvoEm: agora }));
    });
    await page.reload();
    await page.locator('[data-acao="continuar"]').click();
    await expect(page.locator('h1')).toHaveText('Sua identificação');
    await expect(page.locator('#nome')).toHaveValue('Fulano de Tal');
    await expect(page.locator('#idade')).toHaveValue('');
    await page.locator('#form-identificacao button[type="submit"]').click();
    await expect(page.locator('#erro-idade')).toHaveText('Informe sua idade (só números).');
    await page.fill('#idade', '35');
    await page.locator('#form-identificacao button[type="submit"]').click();
    await expect(page.locator('.progresso-topo')).toContainText('Grupo 4 de 25');
    expect(erros).toEqual([]);
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
    const x = caixa.x + caixa.width / 2 - 40;      // longe do botão de dica
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

  test('sem setinhas na tela; teclado reordena (acessibilidade)', async ({ page }) => {
    const erros = coletarErros(page);
    await irParaGrupo1(page);
    await expect(page.locator('.cartao button[data-mover], .seta')).toHaveCount(0);
    const inicial = await ordemNaTela(page);
    // Teclado: foco no último cartão, seta para cima troca com o terceiro
    await page.locator('.cartao[data-letra="' + inicial[3] + '"]').focus();
    await page.keyboard.press('ArrowUp');
    expect(await ordemNaTela(page)).toEqual([inicial[0], inicial[1], inicial[3], inicial[2]]);
    await expect(page.locator('[data-acao="proximo"]')).toBeEnabled();
    await expect(page.locator('#aviso')).toContainText('posição 3 de 4');
    // Home leva ao topo
    await page.keyboard.press('Home');
    expect(await ordemNaTela(page)).toEqual([inicial[3], inicial[0], inicial[1], inicial[2]]);
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
    await page.locator('.cartao[data-letra="' + inicial[2] + '"]').focus();
    await page.keyboard.press('ArrowUp');
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
    await responderConfirmacao(page);
    await page.locator('[data-acao="enviar"]').click();
    const codigo = await page.locator('textarea#codigo').inputValue();
    const payload = await page.evaluate((c) => window.DISC_CODEC.decode(c), codigo);
    expect(payload.respostas).toBe('2413'.repeat(25)); // D=2, I=4, S=1, C=3
    expect(payload.resultado.codigo).toBe('IC');
    expect(erros).toEqual([]);
  });
});

test.describe('Candidato: régua e demonstração do arraste', () => {
  async function irParaGrupo1(page) {
    await page.goto('/index.html');
    await page.locator('[data-acao="comecar"]').click();
    await preencherIdentificacao(page, DADOS);
    await page.locator('#form-identificacao button[type="submit"]').click();
    await expect(page.locator('.progresso-topo')).toContainText('Grupo 1 de 25');
  }

  test('cartões compactos; régua MAIS/MENOS; pergunta, cartões e botões cabem na tela', async ({ page }) => {
    const erros = coletarErros(page);
    await irParaGrupo1(page);
    await expect(page.locator('.regua-texto--mais')).toHaveText('MAIS me identifica');
    await expect(page.locator('.regua-texto--menos')).toHaveText('MENOS me identifica');
    await expect(page.locator('.posicao')).toHaveText(['4', '3', '2', '1']);
    const alturas = await page.locator('.cartao').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    alturas.forEach((h) => { expect(h).toBeGreaterThanOrEqual(44); expect(h).toBeLessThanOrEqual(60); });
    const m = await page.evaluate(() => ({
      titulo: document.querySelector('h1').getBoundingClientRect().top,
      fimLista: document.querySelector('.regua-texto--menos').getBoundingClientRect().bottom,
      barra: document.querySelector('.barra-nav').getBoundingClientRect().top,
      sw: document.documentElement.scrollWidth, vw: innerWidth
    }));
    expect(m.titulo).toBeGreaterThan(0);
    expect(m.fimLista).toBeLessThanOrEqual(m.barra);
    expect(m.sw).toBeLessThanOrEqual(m.vw);
    expect(erros).toEqual([]);
  });

  test('demonstração no 1º grupo: não muda a ordem nem libera o Avançar; some no toque e não volta', async ({ page }) => {
    const erros = coletarErros(page);
    await irParaGrupo1(page);
    const demo = page.locator('.demo');
    await expect(demo).toHaveCount(1);
    await expect(demo.locator('.demo-balao')).toHaveText('Arraste para ordenar');
    await expect(page.locator('.cartao')).toHaveCount(4);
    const ordem = await ordemNaTela(page);
    await page.waitForTimeout(1500);   // no meio da animação
    expect(await ordemNaTela(page)).toEqual(ordem);
    await expect(page.locator('[data-acao="proximo"]')).toBeDisabled();
    // Primeiro toque (fora da lista) some com a demonstração e grava no progresso
    await page.locator('.regua-texto--menos').click();
    await expect(demo).toHaveCount(0);
    expect(await ordemNaTela(page)).toEqual(ordem);
    await expect(page.locator('[data-acao="proximo"]')).toBeDisabled();
    const salvo = await page.evaluate(() => JSON.parse(localStorage.getItem('disc_progresso_v1')));
    expect(salvo.demoVista).toBe(true);
    expect(salvo.respondidos[0]).toBeFalsy();
    // Recarregar não mostra de novo; "Ver como funciona" repete
    await page.reload();
    await page.locator('[data-acao="continuar"]').click();
    await expect(page.locator('.progresso-topo')).toContainText('Grupo 1 de 25');
    await expect(demo).toHaveCount(0);
    await page.locator('[data-acao="ver-demo"]').click();
    await expect(demo).toHaveCount(1);
    // Arrastar continua funcionando com a demonstração na tela (ela some no toque)
    await page.locator('.cartao[data-letra="' + ordem[3] + '"]').focus();
    await expect(demo).toHaveCount(0);
    await page.keyboard.press('Home');
    expect(await ordemNaTela(page)).toEqual([ordem[3], ordem[0], ordem[1], ordem[2]]);
    // Grupo 2 não tem demonstração automática
    await page.locator('[data-acao="proximo"]').click();
    await expect(page.locator('.progresso-topo')).toContainText('Grupo 2 de 25');
    await expect(demo).toHaveCount(0);
    expect(erros).toEqual([]);
  });

  test('prefers-reduced-motion: só a dica parada', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await irParaGrupo1(page);
    await expect(page.locator('.demo')).toHaveCount(1);
    const anim = await page.locator('.demo-arrasto').evaluate((e) => getComputedStyle(e).animationName);
    expect(anim).toBe('none');
    await page.waitForTimeout(1200);
    await expect(page.locator('.demo')).toHaveCount(1);
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
    const outro = page.locator('.cartao[data-letra="' + ordem[0] + '"] .info');   // acima: o painel abre embaixo do botão
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
    await page.locator('.regua-texto--menos').click();
    await expect(janela).toBeHidden();

    await expect(proximo).toBeDisabled();
    expect(await ordemNaTela(page)).toEqual(ordem);
    expect(erros).toEqual([]);
  });

  // Antes, puxar começando no "i" não fazia nada (e é onde o polegar direito pousa). Agora: toque parado abre a dica;
  // puxar a partir do "i" arrasta o cartão, sem abrir a dica.
  test('puxar começando no "i" arrasta o cartão (sem abrir a dica); arrastar o cartão fecha a dica', async ({ page }) => {
    const erros = coletarErros(page);
    await irParaGrupo1(page);
    const ordem = await ordemNaTela(page);
    const info = page.locator('.cartao[data-letra="' + ordem[3] + '"] .info');
    const b = await info.boundingBox();
    const c0 = await page.locator('.cartao[data-letra="' + ordem[3] + '"]').boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 - 3 * c0.height - 20, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const nova = [ordem[3], ordem[0], ordem[1], ordem[2]];
    await expect.poll(() => ordemNaTela(page)).toEqual(nova);
    await expect(page.locator('.cartao.arrastando')).toHaveCount(0);
    await expect(page.locator('#dica-janela')).toBeHidden();
    await expect(page.locator('[data-acao="proximo"]')).toBeEnabled();

    // Toque parado no "i" continua abrindo a dica
    await page.locator('.cartao[data-letra="' + nova[0] + '"] .info').click();
    await expect(page.locator('#dica-janela')).toBeVisible();
    // Arrastar outro cartão fecha a dica
    const c = await page.locator('.cartao[data-letra="' + nova[3] + '"]').boundingBox();
    const x = c.x + 40, y = c.y + c.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y - 60, { steps: 6 });
    await expect(page.locator('#dica-janela')).toBeHidden();
    await page.mouse.move(x, y - 3 * c.height, { steps: 6 });
    await page.mouse.up();
    await expect.poll(() => ordemNaTela(page)).toEqual([nova[3], nova[0], nova[1], nova[2]]);
    expect(erros).toEqual([]);
  });
});

test.describe('Candidato: modo demonstração', () => {
  test('GRUPOS_DEMONSTRACAO=3: responde 3 grupos, confirma e o payload vai com os 25', async ({ page }) => {
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
      // Depois do último grupo vem a confirmação (também no modo demonstração).
      if (i === 2) await expect(page.locator('[data-acao="proximo"]')).toHaveText('Avançar');
      await page.locator('[data-acao="proximo"]').click();
    }
    await expect(page.locator('.faixa-demo')).toHaveText(faixa);
    await responderConfirmacao(page);
    await expect(page.locator('.faixa-demo')).toHaveText(faixa);
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

// Linha gravada pela API simulada (prévia) para um nome.
async function linhaSimulada(page, nome) {
  return page.evaluate((n) => (JSON.parse(localStorage.getItem('disc_planilha_simulada') || '[]')).find((l) => l.nome === n) || null, nome);
}

test.describe('Candidato: link de avaliação (API simulada)', () => {
  test('?a=SEL1 personaliza os textos de processo seletivo e envia com o código e a confirmação', async ({ page }) => {
    const erros = coletarErros(page);
    await configurar(page, { API_URL: 'simulada' });
    await page.goto('/index.html?a=SEL1');
    await expect(page.locator('.boasvindas-sobre')).toHaveText('Processo seletivo · Clínica Exemplo');
    await expect(page.locator('#topo-empresa')).toHaveText('Clínica Exemplo');
    await expect(page.locator('.lista-info')).toContainText('No fim, uma confirmação rápida.');
    await page.locator('[data-acao="comecar"]').click();
    await expect(page.locator('.subtitulo').first()).toContainText('sua candidatura');
    await expect(page.locator('#vaga')).toBeVisible();
    await expect(page.locator('label[for="funcao"]')).toContainText('Função atual ou última');
    await expect(page.locator('#empresa')).toBeVisible();
    await expect(page.locator('.consentimento')).toContainText('apenas nesta avaliação da empresa Clínica Exemplo, conduzida pela Gestão sem Caos');
    await preencherIdentificacao(page, { nome: 'Rita Exemplo Seleção', telefone: '11987654321', vaga: 'Recepção' });
    await page.locator('#form-identificacao button[type="submit"]').click();
    const ordem = ['D', 'I', 'S', 'C'];
    for (let i = 0; i < 25; i++) {
      await expect(page.locator('.progresso-topo')).toContainText('Grupo ' + (i + 1) + ' de 25');
      if (i === 0) await page.waitForTimeout(1200);   // tempo medido no grupo 1
      await responderGrupo(page, ordem);
      await page.locator('[data-acao="proximo"]').click();
    }
    // Retratos: escolhe sempre o de maior total (D > I > S > C); frases: tudo 4, menos a 2ª (2)
    await responderConfirmacao(page, { escolher: (letras) => letras.slice().sort((a, b) => ordem.indexOf(a) - ordem.indexOf(b))[0], nota: (it, k) => (k === 1 ? 2 : 4) });
    await page.locator('[data-acao="enviar"]').click();
    await expect(page.locator('h1')).toHaveText('Obrigado, Rita!');
    await expect(page.locator('.agradecimento')).toContainText('O recrutador entrará em contato');
    await expect(page.locator('#protocolo')).toBeVisible();
    // SEL1 não mostra o resultado
    await expect(page.locator('.relatorio-candidato')).toHaveCount(0);
    expect((await page.evaluate(() => JSON.parse(sessionStorage.getItem('disc_concluido_v1')))).relatorio).toBeUndefined();

    const linha = await linhaSimulada(page, 'Rita Exemplo Seleção');
    expect(linha).not.toBeNull();
    expect(linha.avaliacao).toBe('SEL1');
    const v = linha.validacao;
    expect(v.versao).toBe(1);
    expect(v.pares).toHaveLength(3);
    expect(v.escolhas).toHaveLength(3);
    v.pares.forEach((par, r) => expect(par).toContain(v.escolhas[r]));
    // Escolheu sempre a letra mais forte do par
    v.pares.forEach((par, r) => expect(v.escolhas[r]).toBe(par.slice().sort((a, b) => ordem.indexOf(a) - ordem.indexOf(b))[0]));
    expect(v.itens).toHaveLength(4);
    expect(v.itens.map((it) => it.tipo).sort()).toEqual(['contraste', 'forca', 'forca', 'sombra']);
    v.itens.forEach((it) => expect([2, 4]).toContain(it.nota));
    expect(v.gruposSeg).toHaveLength(25);
    expect(v.gruposSeg[0]).toBeGreaterThanOrEqual(1);
    v.gruposSeg.forEach((s) => expect(s).toBeGreaterThan(0));
    // Grupos em que a ordem inicial já era D,I,S,C foram aceitos sem mexer
    expect(v.semMexer).toBeGreaterThanOrEqual(0);
    expect(v.semMexer).toBeLessThanOrEqual(25);
    expect(v.demonstracao).toBe(false);
    expect(erros).toEqual([]);
  });

  test('#a-EQP1 (avaliação de equipe) esconde vaga e empresa e mostra o relatório DISC completo no final', async ({ page }) => {
    const erros = coletarErros(page);
    await configurar(page, { API_URL: 'simulada' });
    await fazerTesteCompleto(page, { nome: 'Caio Exemplo Equipe', telefone: '11987654321', funcao: 'Vendedor' }, ['I', 'S', 'D', 'C'], {
      caminho: '/index.html#a-EQP1',
      confirmacao: {}
    });
    await page.locator('[data-acao="enviar"]').click();
    await expect(page.locator('h1')).toHaveText('Obrigado, Caio!');
    await expect(page.locator('.agradecimento')).toContainText('Obrigado por participar da avaliação da equipe.');
    // Relatório completo: os 4 fatores (I=40, S=30, D=20, C=10), estilo principal e secundário
    const rel = page.locator('.relatorio-candidato');
    await expect(rel).toBeVisible();
    await expect(rel.locator('.rel-fator')).toHaveCount(4);
    await expect(rel.locator('.rel-fator .rel-fator-nome')).toHaveText(['Dominância', 'Influência', 'Estabilidade', 'Conformidade']);
    await expect(rel.locator('.rel-fator .rel-pct')).toHaveText(['20%', '40%', '30%', '10%']);
    await expect(rel).toHaveAttribute('data-codigo', 'IS');
    await expect(rel.locator('.rel-titulo')).toHaveText('Caio, seu estilo é de Influência, com traços de Estabilidade');
    // Comunicação com os outros 3 perfis
    await expect(rel.locator('.rel-com')).toHaveCount(3);
    await expect(rel.locator('.rel-com[data-letra="I"]')).toHaveCount(0);
    // Nunca o guia de liderança, a confiabilidade, nem vaga/função/aderência
    await expect(rel).not.toContainText(/Guia para a Liderança|confiabilidade|aderência|\bvaga\b|Vendedor/i);
    await expect(page.locator('.rodape-nota')).toHaveText('Seu resultado fica no cadastro da equipe da empresa e é compartilhado com ela. Você pode pedir a exclusão a qualquer momento.');
    // Na aba fica só percentuais + código + primeiro nome (sem telefone)
    const sessao = await page.evaluate(() => sessionStorage.getItem('disc_concluido_v1'));
    expect(sessao).not.toContain('98765');
    // EQP1 tem a Parte 2 ligada: também o perfil exigido já calculado (nunca as respostas de 40 dígitos)
    expect(JSON.parse(sessao).relatorio).toEqual({ percentuais: { D: 20, I: 40, S: 30, C: 10 }, codigo: 'IS',
      exigido: { percentuais: { D: 20, I: 40, S: 30, C: 10 }, codigo: 'IS' } });
    expect(sessao).not.toMatch(/[1-4]{40}/);
    await page.reload();
    await expect(page.locator('.relatorio-candidato .rel-fator')).toHaveCount(4);
    await expect(page.locator('.relatorio-candidato .rel-titulo')).toContainText('Caio');
    const linha = await linhaSimulada(page, 'Caio Exemplo Equipe');
    expect(linha.avaliacao).toBe('EQP1');
    expect(linha.empresa).toBe('');
    expect(linha.vaga).toBe('');
    expect(linha.funcao).toBe('Vendedor');
    // Outro link (ou o link geral) na mesma aba: começa do zero, sem a conclusão (nem o resumo) do EQP1
    await page.goto('about:blank');
    await page.goto('/index.html#a-SEL1');
    await expect(page.locator('.boasvindas-sobre')).toHaveText('Processo seletivo · Clínica Exemplo');
    await expect(page.locator('.relatorio-candidato')).toHaveCount(0);
    await page.goto('about:blank');
    await page.goto('/index.html#a-EQP1');
    await expect(page.locator('.boasvindas-sobre')).toHaveText('Avaliação de equipe · Clínica Exemplo');
    expect(erros).toEqual([]);
  });

  test('textos da avaliação de equipe na identificação', async ({ page }) => {
    await configurar(page, { API_URL: 'simulada' });
    await page.goto('/index.html#a-EQP1');
    await expect(page.locator('.boasvindas-sobre')).toHaveText('Avaliação de equipe · Clínica Exemplo');
    await page.locator('[data-acao="comecar"]').click();
    await expect(page.locator('#vaga')).toHaveCount(0);
    await expect(page.locator('#empresa')).toHaveCount(0);
    await expect(page.locator('label[for="funcao"]')).toContainText('Seu cargo/função');
    await expect(page.locator('.subtitulo').first()).toHaveText('Precisamos destes dados para vincular o resultado à avaliação da equipe.');
    await expect(page.locator('.consentimento')).toContainText('na avaliação da equipe da empresa Clínica Exemplo, conduzida pela Gestão sem Caos');
    await expect(page.locator('.consentimento')).toContainText('compartilhado com a empresa');
  });

  test('código inexistente, desativado ou mal escrito mostra a tela de link inválido', async ({ page }) => {
    const erros = coletarErros(page);
    await configurar(page, { API_URL: 'simulada' });
    for (const caminho of ['/index.html?a=ZZZZ', '/index.html#a-QQ9Q', '/index.html?a=!!']) {
      await page.goto(caminho);
      await expect(page.locator('h1')).toHaveText('Link inválido ou avaliação encerrada');
      await expect(page.locator('main')).toContainText('Fale com quem enviou o link.');
      await expect(page.locator('[data-acao="comecar"]')).toHaveCount(0);
    }
    // Avaliação desativada pelo admin
    await page.evaluate(() => {
      const avs = JSON.parse(localStorage.getItem('disc_simulada_avaliacoes'));
      avs.forEach((a) => { if (a.codigo === 'SEL1') a.ativa = false; });
      localStorage.setItem('disc_simulada_avaliacoes', JSON.stringify(avs));
    });
    await page.goto('/index.html?a=SEL1');
    await expect(page.locator('h1')).toHaveText('Link inválido ou avaliação encerrada');
    expect(erros).toEqual([]);
  });
});

test.describe('Candidato: etapa de confirmação', () => {
  test('obrigatória, nada pula de lugar, sobrevive ao recarregar e vai no payload', async ({ page }) => {
    const erros = coletarErros(page);
    await page.goto('/index.html');
    await page.locator('[data-acao="comecar"]').click();
    await preencherIdentificacao(page, DADOS);
    await page.locator('#form-identificacao button[type="submit"]').click();
    const ordem = ['C', 'S', 'I', 'D'];
    for (let i = 0; i < 25; i++) {
      await expect(page.locator('.progresso-topo')).toContainText('Grupo ' + (i + 1) + ' de 25');
      await responderGrupo(page, ordem);
      if (i === 24) await expect(page.locator('[data-acao="proximo"]')).toHaveText('Avançar');
      await page.locator('[data-acao="proximo"]').click();
    }
    // Tela 1: retratos
    await expect(page.locator('.progresso-topo')).toContainText('Confirmação 1 de 2');
    await expect(page.locator('h1')).toHaveText('Qual destes jeitos parece mais com você?');
    await expect(page.locator('.tela-confirmacao')).toContainText('Para confirmar seu resultado, responda com sinceridade. Não existe resposta certa.');
    await expect(page.locator('.retrato')).toHaveCount(6);
    // Texto neutro: sem letras nem nomes de perfil
    await expect(page.locator('.tela-confirmacao')).not.toContainText(/DISC|Dominante|Influente|Estável|Cauteloso/);
    const proximo = page.locator('[data-acao="conf-proximo"]');
    await expect(proximo).toBeDisabled();
    // 1ª tela: sem "Voltar" aos grupos (não há revisão)
    await expect(page.locator('[data-acao="conf-anterior"]')).toHaveCount(0);
    // Cartões: posição relativa ao card da tela (a página pode rolar ao tocar); botões: barra fixa no celular.
    const caixas = () => page.locator('.retrato, [data-acao="conf-anterior"], [data-acao="conf-proximo"]').evaluateAll((els) => els.map((e) => {
      const r = e.getBoundingClientRect();
      const base = e.closest('.barra-nav') ? { x: 0, y: 0 } : document.querySelector('.tela-confirmacao').getBoundingClientRect();
      return [Math.round(r.x - base.x), Math.round(r.y - base.y), Math.round(r.width), Math.round(r.height)];
    }));
    const antes = await caixas();
    const rodadas = page.locator('.rodada');
    for (let r = 0; r < 3; r++) {
      await rodadas.nth(r).locator('.retrato').nth(1).click();
      await expect(rodadas.nth(r).locator('.retrato').nth(1)).toHaveAttribute('aria-pressed', 'true');
      await expect(rodadas.nth(r).locator('.retrato').nth(0)).toHaveAttribute('aria-pressed', 'false');
      if (r < 2) await expect(proximo).toBeDisabled();
    }
    // Troca de ideia na rodada 1
    await rodadas.nth(0).locator('.retrato').nth(0).click();
    await expect(rodadas.nth(0).locator('.retrato').nth(0)).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(250);
    expect(await caixas()).toEqual(antes);
    await expect(proximo).toBeEnabled();

    // Recarregar mantém a montagem e as escolhas
    const salvo1 = await page.evaluate(() => JSON.parse(localStorage.getItem('disc_progresso_v1')).validacao);
    await page.reload();
    await page.locator('[data-acao="continuar"]').click();
    await expect(page.locator('.progresso-topo')).toContainText('Confirmação 1 de 2');
    const salvo2 = await page.evaluate(() => JSON.parse(localStorage.getItem('disc_progresso_v1')).validacao);
    expect(salvo2.montagem).toEqual(salvo1.montagem);
    await expect(page.locator('.retrato[aria-pressed="true"]')).toHaveCount(3);
    await proximo.click();

    // Tela 2: frases com escala; "Enviar e finalizar" no lugar do avançar
    await expect(page.locator('.progresso-topo')).toContainText('Confirmação 2 de 2');
    const enviar = page.locator('[data-acao="enviar"]');
    await expect(page.locator('.frase')).toHaveCount(4);
    await expect(page.locator('.frase').first().locator('.escala-opcao')).toHaveCount(5);
    await expect(page.locator('.escala-legenda').first()).toBeVisible();   // celular: legenda acima das pílulas 1..5
    await expect(page.locator('.escala-opcao').first()).toHaveText('1Discordo totalmente');
    await expect(page.locator('.escala-opcao').first()).toHaveAttribute('aria-label', '1: Discordo totalmente');
    await expect(enviar).toBeDisabled();
    await expect(enviar).toHaveText('Enviar e finalizar');
    const caixas2 = () => page.locator('.escala-opcao, [data-acao="enviar"]').evaluateAll((els) => els.map((e) => {
      const r = e.getBoundingClientRect();
      const base = e.closest('.barra-nav') ? { x: 0, y: 0 } : document.querySelector('.tela-confirmacao').getBoundingClientRect();
      return [Math.round(r.x - base.x), Math.round(r.y - base.y), Math.round(r.width), Math.round(r.height)];
    }));
    const antes2 = await caixas2();
    for (let k = 0; k < 4; k++) {
      await page.locator('.escala-opcao[data-item="' + k + '"][data-nota="' + (k + 2) + '"]').click();
      if (k < 3) await expect(enviar).toBeDisabled();
    }
    await page.waitForTimeout(250);
    const depois2 = await caixas2();
    expect(depois2).toEqual(antes2);
    await expect(page.locator('.escala-opcao[aria-pressed="true"]')).toHaveCount(4);
    // Voltar à tela 1 mantém tudo
    await page.locator('[data-acao="conf-anterior"]').click();
    await expect(page.locator('.retrato[aria-pressed="true"]')).toHaveCount(3);
    await proximo.click();
    await expect(page.locator('.escala-opcao[aria-pressed="true"]')).toHaveCount(4);
    await expect(enviar).toBeEnabled();
    // Envia direto: nada de "Revise suas respostas"
    await enviar.click();
    await expect(page.locator('h1')).toHaveText('Obrigado, Maria!');
    const codigo = await page.locator('textarea#codigo').inputValue();
    const payload = await page.evaluate((c) => window.DISC_CODEC.decode(c), codigo);
    expect(payload.avaliacao).toBe('');
    const v = payload.validacao;
    expect(v.versao).toBe(1);
    expect(v.escolhas).toEqual(salvo1.montagem.pares.map((p, r) => (r === 0 ? p[0] : p[1])));
    expect(v.itens.map((it) => it.nota)).toEqual([2, 3, 4, 5]);
    expect(v.itens.map((it) => it.id)).toEqual(salvo1.montagem.itens.map((it) => it.id));
    expect(v.gruposSeg).toHaveLength(25);
    v.gruposSeg.forEach((s) => expect(s).toBeGreaterThan(0));
    expect(Number.isInteger(v.semMexer)).toBe(true);
    expect(v.demonstracao).toBe(false);
    // O painel consegue avaliar
    const conf = await page.evaluate(async (p) => {
      await new Promise((ok, erro) => { const s = document.createElement('script'); s.src = 'js/confiabilidade.js'; s.onload = ok; s.onerror = erro; document.head.appendChild(s); });
      return window.DISC_CONFIABILIDADE.avaliar(p.respostas, p.validacao);
    }, payload);
    expect(['alta', 'media', 'baixa']).toContain(conf.nivel);
    expect(erros).toEqual([]);
  });

  test('"Esta ordem está certa" conta como aceito sem mexer; mexer depois desfaz', async ({ page }) => {
    await page.goto('/index.html');
    await page.locator('[data-acao="comecar"]').click();
    await preencherIdentificacao(page, DADOS);
    await page.locator('#form-identificacao button[type="submit"]').click();
    await page.locator('[data-acao="confirmar-ordem"]').click();
    let salvo = await page.evaluate(() => JSON.parse(localStorage.getItem('disc_progresso_v1')));
    expect(salvo.aceitos[0]).toBe(true);
    const inicial = await ordemNaTela(page);
    await page.locator('.cartao[data-letra="' + inicial[3] + '"]').focus();
    await page.keyboard.press('ArrowUp');
    salvo = await page.evaluate(() => JSON.parse(localStorage.getItem('disc_progresso_v1')));
    expect(salvo.aceitos[0]).toBe(false);
  });
});

test('boas-vindas tem link discreto para a área do recrutador', async ({ page }) => {
  await page.goto('/index.html');
  const link = page.locator('.acesso-recrutador a');
  await expect(link).toHaveText('Área do recrutador');
  await expect(link).toHaveAttribute('href', 'admin.html');
});

test.describe('Candidato: formulário do processo, fim sem revisão e relatório completo', () => {
  const FORMULARIO = {
    campos: { idade: 'oculto', funcao: 'oculto', empresa: 'opcional', email: 'obrigatorio', cidade: 'opcional' },
    perguntas: [
      { id: 'p1', texto: 'Qual sua pretensão salarial?', obrigatoria: true },
      { id: 'p2', texto: 'Como soube da vaga?', obrigatoria: false },
      { id: 'p3', texto: 'Você tem filhos?', obrigatoria: true }   // dado sensível: nunca aparece
    ]
  };

  async function linkComFormulario(page, formulario, mostrarResultado) {
    await configurar(page, { API_URL: API_FALSA });
    return simularApi(page, (corpo) => {
      if (corpo.acao === 'avaliacaoPublica') {
        return { ok: true, avaliacao: { codigo: 'FRM1', nome: 'Recepção', tipo: 'selecao', empresaNome: 'Clínica Teste', mostrarResultado: !!mostrarResultado, formulario } };
      }
      return { ok: true, id: corpo.payload && corpo.payload.id, protocolo: '58M' };
    });
  }

  test('campos configurados: oculto some, obrigatório bloqueia, pergunta extra vai no payload; relatório com os 4 fatores', async ({ page }) => {
    const erros = coletarErros(page);
    const chamadas = await linkComFormulario(page, FORMULARIO, true);
    await page.goto('/index.html?a=FRM1');
    await page.locator('[data-acao="comecar"]').click();
    await expect(page.locator('h1')).toHaveText('Sua identificação');
    // Ocultos não aparecem; nome e WhatsApp sempre
    await expect(page.locator('#idade')).toHaveCount(0);
    await expect(page.locator('#funcao')).toHaveCount(0);
    await expect(page.locator('#nome')).toBeVisible();
    await expect(page.locator('#telefone')).toBeVisible();
    await expect(page.locator('label[for="empresa"]')).toHaveText('Empresa atual ou última (opcional)');
    await expect(page.locator('label[for="cidade"]')).toHaveText('Cidade onde mora (opcional)');
    await expect(page.locator('label[for="email"]')).toContainText('E-mail');
    await expect(page.locator('label[for="email"]')).not.toContainText('opcional');
    await expect(page.locator('#email')).toHaveAttribute('type', 'email');
    expect(await page.locator('#email').evaluate((el) => getComputedStyle(el).fontSize)).toBe('16px');
    // Perguntas extras: textarea com contador; a sensível não aparece
    await expect(page.locator('textarea[data-extra]')).toHaveCount(2);
    await expect(page.locator('label[for="extra-p1"]')).toHaveText('Qual sua pretensão salarial? *');
    await expect(page.locator('label[for="extra-p2"]')).toHaveText('Como soube da vaga? (opcional)');
    await expect(page.locator('#form-identificacao')).not.toContainText('filhos');
    await expect(page.locator('#extra-p1')).toHaveAttribute('maxlength', '500');
    await expect(page.locator('.consentimento')).not.toContainText('a idade é usada');
    await expect(page.locator('.consentimento')).toContainText('nome, telefone, e-mail, cidade, foto, experiência e respostas do teste e das perguntas do processo');

    // Obrigatórios vazios bloqueiam
    await page.fill('#nome', 'Bruna Formulário Teste');
    await page.locator('#telefone').pressSequentially('11987650000');
    await page.check('#consentimento');
    const enviarForm = page.locator('#form-identificacao button[type="submit"]');
    await enviarForm.click();
    await expect(page.locator('#erro-email')).toHaveText('Informe o e-mail.');
    await expect(page.locator('#erro-extra-p1')).toHaveText('Responda esta pergunta.');
    await expect(page.locator('#erro-extra-p2')).toHaveText('');
    await expect(page.locator('h1')).toHaveText('Sua identificação');
    await page.fill('#email', 'bruna@exemplo');
    await enviarForm.click();
    await expect(page.locator('#erro-email')).toHaveText('Confira o e-mail, ex.: nome@exemplo.com.');
    await page.fill('#email', 'bruna@exemplo.com');
    await page.fill('#extra-p1', 'R$ 3.000');
    await expect(page.locator('#conta-extra-p1')).toHaveText('8/500');
    await page.fill('#empresa', 'Padaria Central');
    await enviarForm.click();

    // Recarregar no meio guarda os valores do formulário
    await expect(page.locator('.progresso-topo')).toContainText('Grupo 1 de 25');
    const salvo = await page.evaluate(() => JSON.parse(localStorage.getItem('disc_progresso_v1')));
    expect(salvo.email).toBe('bruna@exemplo.com');
    expect(salvo.extras).toEqual({ p1: 'R$ 3.000', p2: '' });

    const ordem = ['C', 'D', 'S', 'I'];
    for (let i = 0; i < 25; i++) {
      await expect(page.locator('.progresso-topo')).toContainText('Grupo ' + (i + 1) + ' de 25');
      await responderGrupo(page, ordem);
      await page.locator('[data-acao="proximo"]').click();
    }
    await responderConfirmacao(page);
    await page.locator('[data-acao="enviar"]').click();
    await expect(page.locator('h1')).toHaveText('Obrigado, Bruna!');
    await expect(page.locator('#protocolo')).toHaveText('58M');

    const envio = chamadas.find((c) => c.corpo.acao === 'enviar');
    const p = envio.corpo.payload;
    expect(p.avaliacao).toBe('FRM1');
    expect(p.idade).toBeNull();
    expect(p.funcao).toBe('');
    expect(p.empresa).toBe('Padaria Central');
    expect(p.email).toBe('bruna@exemplo.com');
    expect(p.cidade).toBe('');
    expect(p.extras).toEqual([{ id: 'p1', pergunta: 'Qual sua pretensão salarial?', resposta: 'R$ 3.000' }]);

    // Relatório completo: C=40, D=30, S=20, I=10 → CD
    const rel = page.locator('.relatorio-candidato');
    await expect(rel.locator('.rel-fator')).toHaveCount(4);
    await expect(rel.locator('.rel-fator .rel-fator-nome')).toHaveText(['Dominância', 'Influência', 'Estabilidade', 'Conformidade']);
    await expect(rel.locator('.rel-fator .rel-pct')).toHaveText(['30%', '10%', '20%', '40%']);
    await expect(rel.locator('.rel-fator .letra-disc')).toHaveText(['D', 'I', 'S', 'C']);
    await expect(rel.locator('.rel-titulo')).toHaveText('Bruna, seu estilo é de Conformidade, com traços de Dominância');
    // As 5 seções de sempre e, depois, o aprofundamento (combinação, régua, aprendizado, decisão...). Sem Parte 2: sem "esticando".
    const titulos = await rel.locator('.rel-secao-titulo').allTextContents();
    expect(titulos.slice(0, 5)).toEqual(['Seus pontos fortes e como usá-los mais', 'Pontos de atenção',
      'Como você reage sob pressão', 'Como se comunicar melhor com cada perfil', 'Seu plano de desenvolvimento']);
    expect(titulos).toContain('Como você aprende');
    expect(titulos).toContain('Como você decide');
    expect(titulos).toContain('Régua de intensidade');
    await expect(rel.locator('.rel-secao[data-secao="esticando"]')).toHaveCount(0);
    await expect(rel.locator('.rel-combinacao-nome')).not.toHaveText('');
    await expect(rel.locator('.rel-fator .rel-fator-faixa')).toHaveCount(4);
    await expect(rel.locator('.rel-com')).toHaveCount(3);
    const prazos = await rel.locator('.rel-prazo').allTextContents();
    expect(prazos.length).toBeGreaterThanOrEqual(3);
    expect(prazos.length).toBeLessThanOrEqual(5);
    expect(new Set(prazos)).toEqual(new Set(['30 dias', '60 dias', '90 dias']));
    await expect(rel.locator('.rel-aviso')).toContainText('estilo de comportamento');
    await expect(rel.locator('.rel-aviso')).toContainText('Não existe perfil certo ou errado');
    await expect(rel).not.toContainText(/aderência|Clínica Teste|Recepção|Padaria/i);
    await expect(rel.locator('[data-acao="imprimir"]')).toHaveText('Salvar em PDF');
    // Celular: sem rolagem lateral
    const larguras = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    expect(larguras[0]).toBeLessThanOrEqual(larguras[1]);
    // Impressão: só o relatório
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('.agradecimento')).toBeHidden();
    await expect(rel).toBeVisible();
    await expect(rel.locator('[data-acao="imprimir"]')).toBeHidden();
    await page.emulateMedia({ media: 'screen' });
    expect(erros).toEqual([]);
  });

  test('sem etapa de confirmação: o último grupo já mostra "Enviar e finalizar" e envia direto', async ({ page }) => {
    const erros = coletarErros(page);
    await page.route('**/js/validacao.js', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
    await configurar(page, { GRUPOS_DEMONSTRACAO: 2 });
    await page.goto('/index.html');
    await page.locator('[data-acao="comecar"]').click();
    await preencherIdentificacao(page, DADOS);
    await page.locator('#form-identificacao button[type="submit"]').click();
    await responderGrupo(page, ['D', 'I', 'S', 'C']);
    await expect(page.locator('[data-acao="proximo"]')).toHaveText('Avançar');
    await page.locator('[data-acao="proximo"]').click();
    await responderGrupo(page, ['D', 'I', 'S', 'C']);
    await expect(page.locator('[data-acao="proximo"]')).toHaveText('Enviar e finalizar');
    // "Voltar" entre grupos continua
    await page.locator('[data-acao="anterior"]').click();
    await expect(page.locator('.progresso-topo')).toContainText('Grupo 1 de 2');
    await page.locator('[data-acao="proximo"]').click();
    await page.locator('[data-acao="proximo"]').click();
    await expect(page.locator('h1')).toHaveText('Obrigado, Maria!');
    await expect(page.locator('textarea#codigo')).toBeVisible();
    expect(erros).toEqual([]);
  });

  test('progresso antigo parado na revisão cai na confirmação (tudo respondido) ou no grupo que falta', async ({ page }) => {
    const erros = coletarErros(page);
    await page.goto('/index.html');
    async function salvarRevisao(faltando) {
      await page.evaluate((f) => {
        const agora = new Date().toISOString();
        const ordens = []; const respondidos = []; const permutacoes = [];
        for (let i = 0; i < 25; i++) { ordens.push(i === f ? null : ['D', 'I', 'S', 'C']); respondidos.push(i !== f); permutacoes.push(['D', 'I', 'S', 'C']); }
        localStorage.setItem('disc_progresso_v1', JSON.stringify({ etapa: 'revisao', voltarParaRevisao: true, id: 'abc123-rev', nome: 'Fulano de Tal', telefone: '11999998888',
          idade: '40', vaga: '', consentimento: true, ordens, respondidos, permutacoes, grupo: 24, inicio: agora, salvoEm: agora }));
      }, faltando);
      await page.reload();
      await page.locator('[data-acao="continuar"]').click();
    }
    await salvarRevisao(-1);
    await expect(page.locator('.progresso-topo')).toContainText('Confirmação 1 de 2');
    await expect(page.locator('h1')).not.toHaveText('Revise suas respostas');
    await salvarRevisao(6);
    await expect(page.locator('.progresso-topo')).toContainText('Grupo 7 de 25');
    expect(erros).toEqual([]);
  });
});

test.describe('Candidato: Parte 2 (perfil exigido pelo trabalho)', () => {
  const NATURAL = ['D', 'I', 'S', 'C'];
  const TRABALHO = ['C', 'S', 'I', 'D'];

  async function linkParte2(page, parte2, extra) {
    await configurar(page, Object.assign({ API_URL: API_FALSA }, extra || {}));
    return simularApi(page, (corpo) => {
      if (corpo.acao === 'avaliacaoPublica') {
        return { ok: true, avaliacao: { codigo: 'EQX1', nome: 'Equipe', tipo: 'equipe', empresaNome: 'Loja Teste', mostrarResultado: true,
          formulario: { campos: { idade: 'oculto' }, perguntas: [], parte2 } } };
      }
      return { ok: true, id: corpo.payload && corpo.payload.id, protocolo: '72P' };
    });
  }

  async function iniciar(page, nome) {
    await page.goto('/index.html?a=EQX1');
    await page.locator('[data-acao="comecar"]').click();
    await preencherIdentificacao(page, { nome, telefone: '11987654321' });
    await page.locator('#form-identificacao button[type="submit"]').click();
  }

  async function semRolagemLateral(page) {
    const l = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    expect(l[0]).toBeLessThanOrEqual(l[1]);
  }

  test('com a Parte 2: transição, 10 grupos, barra das duas partes, payload com exigido e "Onde você está se esticando"', async ({ page }) => {
    const erros = coletarErros(page);
    await page.setViewportSize({ width: 375, height: 667 });
    const chamadas = await linkParte2(page, 'ligada');
    await page.goto('/index.html?a=EQX1');
    await expect(page.locator('.lista-info')).toContainText('Depois, uma segunda parte mais curta.');
    await page.locator('[data-acao="comecar"]').click();
    await preencherIdentificacao(page, { nome: 'Lia Parte Dois', telefone: '11987654321' });
    await page.locator('#form-identificacao button[type="submit"]').click();
    const barra = page.locator('.progresso-barra');
    let caixaProximo1 = null;
    for (let i = 0; i < 25; i++) {
      await expect(page.locator('.progresso-topo')).toContainText('Parte 1 · Grupo ' + (i + 1) + ' de 25');
      await responderGrupo(page, NATURAL);
      if (i === 0) caixaProximo1 = await page.locator('[data-acao="proximo"]').boundingBox();
      if (i === 24) await expect(page.locator('[data-acao="proximo"]')).toHaveText('Avançar');
      await page.locator('[data-acao="proximo"]').click();
    }
    // Transição
    await expect(page.locator('h1')).toHaveText('Agora pense no seu trabalho');
    await expect(page.locator('.tela-parte2')).toContainText('Como o seu trabalho exige que você seja? Não é como você gostaria de ser.');
    await expect(barra).toHaveAttribute('aria-valuemax', '37');
    await expect(barra).toHaveAttribute('aria-valuenow', '25');
    await semRolagemLateral(page);
    // Voltar leva ao último grupo da parte 1
    await page.locator('[data-acao="parte2-voltar"]').click();
    await expect(page.locator('.progresso-topo')).toContainText('Parte 1 · Grupo 25 de 25');
    await page.locator('[data-acao="proximo"]').click();
    await page.locator('[data-acao="parte2-comecar"]').click();

    const grupos = await page.evaluate(() => window.DISC_EXIGIDO.GRUPOS);
    for (let k = 0; k < 10; k++) {
      await expect(page.locator('.progresso-topo')).toContainText('Parte 2 · Grupo ' + (k + 1) + ' de 10');
      await expect(page.locator('.selo-parte2')).toBeVisible();
      await expect(page.locator('.regua-texto--mais')).toHaveText('MAIS o trabalho pede');
      await expect(page.locator('h1')).toContainText('trabalho');
      // As palavras são as do grupo correspondente de DISC_DATA
      const esperadas = await page.evaluate((g) => ['D', 'I', 'S', 'C'].map((l) => window.DISC_DATA.grupos[g][l]).sort(), grupos[k]);
      const naTela = (await page.locator('.cartoes .cartao .cartao-texto').evaluateAll((els) => els.map((e) => e.firstChild.textContent))).sort();
      expect(naTela).toEqual(esperadas);
      if (k === 0) {
        await expect(page.locator('[data-acao="proximo"]')).toBeDisabled();
        await expect(barra).toHaveAttribute('aria-valuenow', '25');
        // Nada pula de lugar: o Avançar fica no mesmo lugar da parte 1, e cabe na tela de 375x667
        const caixa = await page.locator('[data-acao="proximo"]').boundingBox();
        expect(Math.abs(caixa.y - caixaProximo1.y)).toBeLessThan(1);
        expect(Math.abs(caixa.x - caixaProximo1.x)).toBeLessThan(1);
        const ultimoCartao = await page.locator('.cartoes .cartao').nth(3).boundingBox();
        expect(ultimoCartao.y + ultimoCartao.height).toBeLessThanOrEqual(caixa.y);
        await semRolagemLateral(page);
      }
      await responderGrupo(page, TRABALHO);
      await expect(barra).toHaveAttribute('aria-valuenow', String(25 + k + 1));
      await page.locator('[data-acao="proximo"]').click();
    }
    await responderConfirmacao(page);
    await expect(barra).toHaveAttribute('aria-valuenow', '37');
    await page.locator('[data-acao="enviar"]').click();
    await expect(page.locator('h1')).toHaveText('Obrigado, Lia!');

    const p = chamadas.find((c) => c.corpo.acao === 'enviar').corpo.payload;
    expect(p.respostas).toBe('4321'.repeat(25));
    expect(p.exigido).toMatch(/^[1-4]{40}$/);
    expect(p.exigido).toBe('1234'.repeat(10));
    expect(await page.evaluate((e) => window.DISC_EXIGIDO.validar(e), p.exigido)).toBe(true);
    expect(p.validacao.gruposSeg).toHaveLength(25);

    // Relatório: "Onde você está se esticando" logo depois do resumo (natural DI × trabalho CS)
    const rel = page.locator('.relatorio-candidato');
    const est = rel.locator('.rel-secao[data-secao="esticando"]');
    await expect(est).toBeVisible();
    await expect(est.locator('h2')).toHaveText('Onde você está se esticando');
    await expect(est).toHaveAttribute('data-faixa', 'muito_alta');
    await expect(est.locator('.estica-indice-num .t-numero')).toHaveText('40');
    await expect(est.locator('.estica-fator')).toHaveCount(4);
    await expect(est.locator('.estica-fator[data-letra="C"] .estica-delta')).toHaveText('+30');
    await expect(est.locator('.rel-item').first()).toBeVisible();
    expect(await rel.locator('.rel-secao').first().getAttribute('data-secao')).toBe('esticando');
    await expect(rel.locator('.rel-combinacao-nome')).not.toHaveText('');
    await semRolagemLateral(page);
    const sessao = await page.evaluate(() => sessionStorage.getItem('disc_concluido_v1'));
    expect(JSON.parse(sessao).relatorio.exigido).toEqual({ percentuais: { D: 10, I: 20, S: 30, C: 40 }, codigo: 'CS' });
    expect(sessao).not.toMatch(/[1-4]{40}/);
    await page.reload();
    await expect(page.locator('.rel-secao[data-secao="esticando"]')).toBeVisible();
    expect(erros).toEqual([]);
  });

  test('sem a Parte 2 (desligada): direto para a confirmação e payload sem exigido', async ({ page }) => {
    const erros = coletarErros(page);
    const chamadas = await linkParte2(page, 'desligada');
    await page.goto('/index.html?a=EQX1');
    await expect(page.locator('.lista-info')).not.toContainText('segunda parte');
    await iniciar(page, 'Rui Sem Parte');
    for (let i = 0; i < 25; i++) {
      await expect(page.locator('.progresso-topo')).toHaveText(new RegExp('^Grupo ' + (i + 1) + ' de 25'));
      await responderGrupo(page, NATURAL);
      await page.locator('[data-acao="proximo"]').click();
    }
    await expect(page.locator('[data-acao="parte2-comecar"]')).toHaveCount(0);
    await expect(page.locator('.progresso-barra')).toHaveAttribute('aria-valuemax', '27');
    await responderConfirmacao(page);
    await page.locator('[data-acao="enviar"]').click();
    await expect(page.locator('h1')).toHaveText('Obrigado, Rui!');
    const p = chamadas.find((c) => c.corpo.acao === 'enviar').corpo.payload;
    expect('exigido' in p).toBe(false);
    await expect(page.locator('.rel-secao[data-secao="esticando"]')).toHaveCount(0);
    expect(erros).toEqual([]);
  });

  test('retoma o progresso no meio da Parte 2 depois de recarregar', async ({ page }) => {
    const erros = coletarErros(page);
    const chamadas = await linkParte2(page, 'ligada');
    await iniciar(page, 'Ana Retoma Parte');
    for (let i = 0; i < 25; i++) {
      await responderGrupo(page, NATURAL);
      await page.locator('[data-acao="proximo"]').click();
    }
    await page.locator('[data-acao="parte2-comecar"]').click();
    for (let k = 0; k < 4; k++) {
      await responderGrupo(page, TRABALHO);
      await page.locator('[data-acao="proximo"]').click();
    }
    // Mexe no 5º sem avançar
    await expect(page.locator('.progresso-topo')).toContainText('Parte 2 · Grupo 5 de 10');
    const salvo = await page.evaluate(() => JSON.parse(localStorage.getItem('disc_progresso_v1')));
    expect(salvo.etapa).toBe('parte2');
    expect(salvo.grupo2).toBe(4);
    expect(salvo.respondidos2.filter(Boolean)).toHaveLength(4);
    expect(salvo.permutacoes2).toHaveLength(10);
    await page.reload();
    await page.locator('[data-acao="continuar"]').click();
    await expect(page.locator('.progresso-topo')).toContainText('Parte 2 · Grupo 5 de 10');
    await expect(page.locator('.progresso-barra')).toHaveAttribute('aria-valuenow', '29');
    // Os grupos já respondidos continuam como estavam
    await page.locator('[data-acao="anterior"]').click();
    await expect(page.locator('.progresso-topo')).toContainText('Parte 2 · Grupo 4 de 10');
    expect(await ordemNaTela(page)).toEqual(TRABALHO);
    await expect(page.locator('.confirmado')).toBeVisible();
    await page.locator('[data-acao="proximo"]').click();
    for (let k = 4; k < 10; k++) {
      await expect(page.locator('.progresso-topo')).toContainText('Parte 2 · Grupo ' + (k + 1) + ' de 10');
      await responderGrupo(page, TRABALHO);
      await page.locator('[data-acao="proximo"]').click();
    }
    await responderConfirmacao(page);
    await page.locator('[data-acao="enviar"]').click();
    await expect(page.locator('h1')).toHaveText('Obrigado, Ana!');
    expect(chamadas.find((c) => c.corpo.acao === 'enviar').corpo.payload.exigido).toBe('1234'.repeat(10));
    expect(erros).toEqual([]);
  });

  test('modo demonstração: Parte 2 também reduzida; o resto é completado ao acaso e o exigido vai com os 10', async ({ page }) => {
    const erros = coletarErros(page);
    const chamadas = await linkParte2(page, 'ligada', { GRUPOS_DEMONSTRACAO: 2 });
    await iniciar(page, 'Davi Demo Parte');
    for (let i = 0; i < 2; i++) {
      await expect(page.locator('.progresso-topo')).toContainText('Grupo ' + (i + 1) + ' de 2');
      await responderGrupo(page, NATURAL);
      await page.locator('[data-acao="proximo"]').click();
    }
    await responderParte2(page, TRABALHO, 2);
    await expect(page.locator('.faixa-demo')).toBeVisible();
    await expect(page.locator('.progresso-barra')).toHaveAttribute('aria-valuemax', '6');
    await responderConfirmacao(page);
    const salvo = await page.evaluate(() => JSON.parse(localStorage.getItem('disc_progresso_v1')));
    expect(salvo.preenchidosAoAcaso2).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    await page.locator('[data-acao="enviar"]').click();
    await expect(page.locator('h1')).toHaveText('Obrigado, Davi!');
    const p = chamadas.find((c) => c.corpo.acao === 'enviar').corpo.payload;
    expect(p.exigido).toMatch(/^[1-4]{40}$/);
    expect(p.exigido.slice(0, 8)).toBe('1234'.repeat(2));
    expect(await page.evaluate((e) => window.DISC_EXIGIDO.validar(e), p.exigido)).toBe(true);
    expect(p.validacao.demonstracao).toBe(true);
    expect(erros).toEqual([]);
  });
});

test.describe('Candidato: foto', () => {
  // PNG 320x240 gerado no navegador (nada de foto de gente real).
  async function pngDeTeste(page) {
    const b64 = await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 320; c.height = 240;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#13283f'; ctx.fillRect(0, 0, 320, 240);
      ctx.fillStyle = '#f34405'; ctx.beginPath(); ctx.arc(160, 120, 70, 0, Math.PI * 2); ctx.fill();
      return c.toDataURL('image/png').split(',')[1];
    });
    return { name: 'eu.png', mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') };
  }

  async function linkFoto(page, foto, extra) {
    await configurar(page, Object.assign({ API_URL: API_FALSA, GRUPOS_DEMONSTRACAO: 1 }, extra || {}));
    return simularApi(page, (corpo) => {
      if (corpo.acao === 'avaliacaoPublica') {
        return { ok: true, avaliacao: { codigo: 'FOT1', nome: 'Recepção', tipo: 'selecao', empresaNome: 'Clínica Foto', mostrarResultado: true,
          formulario: { campos: { idade: 'oculto', foto }, perguntas: [] } } };
      }
      return { ok: true, id: corpo.payload && corpo.payload.id, protocolo: '33F' };
    });
  }

  async function terminar(page) {
    await responderGrupo(page, ['D', 'I', 'S', 'C']);
    await page.locator('[data-acao="proximo"]').click();
    await responderConfirmacao(page);
    await page.locator('[data-acao="enviar"]').click();
  }

  test('obrigatória bloqueia; escolher mostra a prévia redonda; trocar/remover; vai no payload e no relatório', async ({ page }) => {
    const erros = coletarErros(page);
    await page.setViewportSize({ width: 375, height: 667 });
    const chamadas = await linkFoto(page, 'obrigatorio');
    await page.goto('/index.html?a=FOT1');
    await page.locator('[data-acao="comecar"]').click();
    const campo = page.locator('.campo-foto');
    await expect(campo.locator('.campo__rotulo')).toHaveText('Sua foto *');
    await expect(campo.locator('#dica-foto')).toHaveText('A foto aparece só para quem conduz a avaliação e nos relatórios dela.');
    await expect(campo.locator('label[for="foto-camera"]')).toHaveText('Tirar foto');
    await expect(page.locator('#foto-camera')).toHaveAttribute('capture', 'user');
    await expect(page.locator('.consentimento')).toContainText('foto');
    await preencherIdentificacao(page, { nome: 'Flora Foto Teste', telefone: '11987654321' });
    const caixaAntes = await page.locator('.foto-linha').boundingBox();
    await page.locator('#form-identificacao button[type="submit"]').click();
    await expect(page.locator('#erro-foto')).toHaveText('Envie uma foto.');
    await expect(page.locator('h1')).toHaveText('Sua identificação');

    await page.locator('#foto').setInputFiles(await pngDeTeste(page));
    const img = campo.locator('.foto-previa img');
    await expect(img).toBeVisible();
    await expect(page.locator('#erro-foto')).toHaveText('');
    expect(await img.evaluate((el) => [el.naturalWidth, el.naturalHeight])).toEqual([192, 192]);
    // Nada pula: a linha da foto mantém a altura
    const caixaDepois = await page.locator('.foto-linha').boundingBox();
    expect(Math.abs(caixaDepois.height - caixaAntes.height)).toBeLessThan(1);
    await expect(campo.locator('[data-acao="foto-remover"]')).toHaveText('Remover');
    await expect(campo.locator('label[for="foto"]')).toHaveText('Trocar');
    // Progresso guarda a foto
    const salvo = await page.evaluate(() => JSON.parse(localStorage.getItem('disc_progresso_v1')).foto);
    expect(salvo).toMatch(/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/);
    // Remover e escolher de novo
    await campo.locator('[data-acao="foto-remover"]').click();
    await expect(img).toHaveCount(0);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('disc_progresso_v1')).foto)).toBe('');
    await page.locator('#foto').setInputFiles(await pngDeTeste(page));
    await expect(img).toBeVisible();
    const l = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    expect(l[0]).toBeLessThanOrEqual(l[1]);
    await page.locator('#form-identificacao button[type="submit"]').click();
    await terminar(page);
    await expect(page.locator('h1')).toHaveText('Obrigado, Flora!');

    const p = chamadas.find((c) => c.corpo.acao === 'enviar').corpo.payload;
    expect(p.foto).toMatch(/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/);
    expect(p.foto.length).toBeLessThanOrEqual(40000);
    expect(await page.evaluate((f) => window.DISC_APP.fotoValida(f), p.foto)).toBe(true);
    // Cabeçalho do relatório com a foto (continua ao recarregar)
    await expect(page.locator('.relatorio-candidato .rel-avatar img')).toBeVisible();
    await page.reload();
    await expect(page.locator('.relatorio-candidato .rel-avatar img')).toBeVisible();
    expect(erros).toEqual([]);
  });

  test('opcional (padrão) envia "" sem foto e o relatório mostra a inicial; oculta some', async ({ page }) => {
    const erros = coletarErros(page);
    const chamadas = await linkFoto(page, 'opcional');
    await page.goto('/index.html?a=FOT1');
    await page.locator('[data-acao="comecar"]').click();
    await expect(page.locator('.campo-foto .campo__rotulo')).toHaveText('Sua foto (opcional)');
    await expect(page.locator('#dica-foto')).toHaveText('Opcional. A foto aparece só para quem conduz a avaliação e nos relatórios dela.');
    await preencherIdentificacao(page, { nome: 'Otto Sem Foto', telefone: '11987654321' });
    await page.locator('#form-identificacao button[type="submit"]').click();
    await terminar(page);
    await expect(page.locator('h1')).toHaveText('Obrigado, Otto!');
    expect(chamadas.find((c) => c.corpo.acao === 'enviar').corpo.payload.foto).toBe('');
    await expect(page.locator('.rel-avatar')).toHaveText('O');

    // Oculta: o campo não aparece e o consentimento não fala de foto
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await linkFoto(page, 'oculto');
    await page.goto('about:blank');
    await page.goto('/index.html?a=FOT1');
    await page.locator('[data-acao="novo-teste"], [data-acao="comecar"]').first().waitFor();
    if (await page.locator('[data-acao="novo-teste"]').count()) {
      await page.locator('[data-acao="novo-teste"]').click();
      await page.locator('[data-acao="novo-teste"]').click();
    }
    await page.locator('[data-acao="comecar"]').click();
    await expect(page.locator('h1')).toHaveText('Sua identificação');
    await expect(page.locator('.campo-foto')).toHaveCount(0);
    await expect(page.locator('#foto')).toHaveCount(0);
    await expect(page.locator('.consentimento')).not.toContainText('foto');
    expect(erros).toEqual([]);
  });
});

// Varredura de UX (área "cliente"): correções dos itens Crítico e Alto do teste do candidato/colaborador.
test.describe('Candidato: correções da varredura de UX', () => {
  // Faz o teste reduzido (modo demonstração) num link da API simulada e para antes de "Enviar e finalizar".
  async function ateOEnvio(page, link) {
    await page.goto('/index.html#a-' + link);
    await page.locator('[data-acao="comecar"]').click();
    await preencherIdentificacao(page, { nome: 'Bia Teste Souza', telefone: '11987654321' });
    await page.locator('#form-identificacao button[type="submit"]').click();
    for (let i = 0; i < 3; i++) {
      await responderGrupo(page, ['D', 'I', 'S', 'C']);
      await page.locator('[data-acao="proximo"]').click();
    }
    if (await page.locator('[data-acao="parte2-comecar"]').count()) await responderParte2(page, ['D', 'I', 'S', 'C'], 3);
    await responderConfirmacao(page);
  }

  test('[Crítico] falha no envio: código logo abaixo do agradecimento, "Tentar enviar de novo" envia e o progresso só some depois', async ({ page }) => {
    const erros = coletarErros(page);
    await configurar(page, { API_URL: API_FALSA, MOSTRAR_RESULTADO_AO_CANDIDATO: true, GRUPOS_DEMONSTRACAO: 3 });
    let foraDoAr = true;
    const chamadas = await simularApi(page, (corpo) => {
      if (corpo.acao === 'enviar' && foraDoAr) return { ok: false, erro: 'Não foi possível conectar ao servidor. Verifique sua conexão com a internet.' };
      return { ok: true, id: corpo.payload && corpo.payload.id, protocolo: '52M' };
    });
    await page.goto('/index.html');
    await page.locator('[data-acao="comecar"]').click();
    await preencherIdentificacao(page, { nome: 'Bia Teste Souza', telefone: '11987654321' });
    await page.locator('#form-identificacao button[type="submit"]').click();
    for (let i = 0; i < 3; i++) { await responderGrupo(page, ['D', 'I', 'S', 'C']); await page.locator('[data-acao="proximo"]').click(); }
    await responderConfirmacao(page);
    await page.locator('[data-acao="enviar"]').click();
    await page.locator('[data-acao="usar-codigo"]').click();
    await expect(page.locator('h1')).toHaveText('Obrigado, Bia!');
    // O código vem antes do relatório (que é longo) e o texto não promete WhatsApp sem número configurado.
    const ordem = await page.locator('.pilha-telas > *').evaluateAll((els) => els.map((e) => e.className));
    expect(ordem.findIndex((c) => /codigo-bloco/.test(c))).toBeLessThan(ordem.findIndex((c) => /relatorio-candidato/.test(c)));
    const y = await page.locator('#codigo').evaluate((e) => e.getBoundingClientRect().top + window.scrollY);
    expect(y).toBeLessThan(2 * (page.viewportSize().height));
    await expect(page.locator('#texto-codigo')).not.toContainText('WhatsApp');
    // O progresso continua salvo até o envio dar certo (fechar a aba não perde as respostas).
    expect(await page.evaluate(() => localStorage.getItem('disc_progresso_v1'))).not.toBeNull();
    // A internet voltou: dá para enviar daqui mesmo, com o mesmo id.
    foraDoAr = false;
    await page.locator('[data-acao="reenviar"]').click();
    await expect(page.locator('#protocolo')).toHaveText('52M');
    await expect(page.locator('textarea#codigo')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('disc_progresso_v1'))).toBeNull();
    const envios = chamadas.filter((c) => c.corpo.acao === 'enviar');
    expect(envios.length).toBeGreaterThanOrEqual(2);
    expect(envios[envios.length - 1].corpo.payload.id).toBe(envios[0].corpo.payload.id);
    expect(erros.filter((e) => !/Falha no envio/.test(e))).toEqual([]);
  });

  test('[Alto] "Começar do zero" pede dois toques e diz quantos grupos serão apagados', async ({ page }) => {
    const erros = coletarErros(page);
    await page.goto('/index.html');
    await page.locator('[data-acao="comecar"]').click();
    await preencherIdentificacao(page, DADOS);
    await page.locator('#form-identificacao button[type="submit"]').click();
    for (let i = 0; i < 4; i++) { await responderGrupo(page, ['D', 'I', 'S', 'C']); await page.locator('[data-acao="proximo"]').click(); }
    await page.reload();
    // Com progresso, a capa diz onde a pessoa parou, junto do botão principal (fixo na base no celular).
    await expect(page.locator('#nota-retomada')).toHaveText('Você parou no grupo 5 de 25.');
    const cta = await page.locator('[data-acao="continuar"]').boundingBox();
    expect(cta.y + cta.height).toBeLessThanOrEqual(page.viewportSize().height);
    const recomecar = page.locator('[data-acao="recomecar"]');
    await recomecar.scrollIntoViewIfNeeded();
    await recomecar.click();
    await expect(recomecar).toHaveText('Toque de novo para apagar');
    await expect(page.locator('#nota-recomecar')).toContainText('4 grupos respondidos');
    await expect(page.locator('h1')).toHaveText('Teste de Perfil Comportamental DISC');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('disc_progresso_v1')).respondidos.filter(Boolean).length)).toBe(4);
    await recomecar.click();
    await expect(page.locator('h1')).toHaveText('Sua identificação');
    expect(await page.evaluate(() => (JSON.parse(localStorage.getItem('disc_progresso_v1') || '{}').respondidos || []).filter(Boolean).length)).toBe(0);
    expect(erros).toEqual([]);
  });

  test('[Alto] "Voltar" do aparelho volta um grupo (não sai do teste)', async ({ page }) => {
    const erros = coletarErros(page);
    await page.goto('/index.html');
    await page.locator('[data-acao="comecar"]').click();
    await preencherIdentificacao(page, DADOS);
    await page.locator('#form-identificacao button[type="submit"]').click();
    for (let i = 0; i < 3; i++) { await responderGrupo(page, ['D', 'I', 'S', 'C']); await page.locator('[data-acao="proximo"]').click(); }
    await expect(page.locator('.progresso-topo')).toContainText('Grupo 4 de 25');
    await page.goBack();
    await expect(page.locator('.progresso-topo')).toContainText('Grupo 3 de 25');
    await page.goBack();
    await expect(page.locator('.progresso-topo')).toContainText('Grupo 2 de 25');
    expect(page.url()).toMatch(/\/index\.html$/);
    // Na confirmação, "Voltar" (da tela e do aparelho) leva ao último grupo
    await page.locator('[data-acao="proximo"]').click();
    for (let i = 2; i < 25; i++) { await responderGrupo(page, ['D', 'I', 'S', 'C']); await page.locator('[data-acao="proximo"]').click(); }
    await expect(page.locator('.progresso-topo')).toContainText('Confirmação 1 de 2');
    await page.goBack();
    await expect(page.locator('.progresso-topo')).toContainText('Grupo 25 de 25');
    await page.locator('[data-acao="proximo"]').click();
    await expect(page.locator('.progresso-topo')).toContainText('Confirmação 1 de 2');
    await page.locator('[data-acao="conf-voltar-grupo"]').click();
    await expect(page.locator('.progresso-topo')).toContainText('Grupo 25 de 25');
    expect(erros).toEqual([]);
  });

  test('[Alto] relatório: "Salvar em PDF" no topo; reabrir o link já enviado avisa em vez de recomeçar calado', async ({ page, context }) => {
    const erros = coletarErros(page);
    await configurar(page, { API_URL: 'simulada', GRUPOS_DEMONSTRACAO: 3 });
    await ateOEnvio(page, 'EQP1');
    await page.locator('[data-acao="enviar"]').click();
    await expect(page.locator('.relatorio-candidato')).toBeVisible();
    const aviso = page.locator('.agradecimento .guardar-relatorio');
    await expect(aviso).toContainText('fica só nesta aba');
    await expect(aviso.locator('[data-acao="imprimir"]')).toHaveText('Salvar em PDF');
    const yPdf = await aviso.locator('[data-acao="imprimir"]').evaluate((e) => e.getBoundingClientRect().top + window.scrollY);
    expect(yPdf).toBeLessThan(page.viewportSize().height);
    const protocolo = await page.locator('#protocolo').getAttribute('data-protocolo');
    // Só a data e o protocolo ficam no aparelho (nada de nome ou respostas)
    const enviados = await page.evaluate(() => localStorage.getItem('disc_enviados_v1'));
    expect(enviados).toContain(protocolo);
    expect(enviados).not.toContain('Bia');
    // Outra aba, mesmo link: a capa avisa que já foi enviado
    const outra = await context.newPage();
    await configurar(outra, { API_URL: 'simulada', GRUPOS_DEMONSTRACAO: 3 });
    await outra.goto('/index.html#a-EQP1');
    await expect(outra.locator('.boasvindas-ja-enviado')).toContainText('Você já enviou este teste neste aparelho');
    await expect(outra.locator('.boasvindas-ja-enviado')).toContainText('(código ' + protocolo + ')');
    await expect(outra.locator('[data-acao="comecar"]')).toHaveText('Responder de novo');
    // Link de processo: sem "Área do recrutador" (o colaborador não precisa do painel)
    await expect(outra.locator('.acesso-recrutador')).toHaveCount(0);
    expect(erros).toEqual([]);
  });

  test('link desativado no meio do teste: tela própria, sem "Tentar novamente"', async ({ page }) => {
    const erros = coletarErros(page);
    await configurar(page, { API_URL: 'simulada', GRUPOS_DEMONSTRACAO: 3 });
    await ateOEnvio(page, 'SEL1');
    await page.evaluate(() => {
      const avs = JSON.parse(localStorage.getItem('disc_simulada_avaliacoes'));
      avs.forEach((a) => { if (a.codigo === 'SEL1') a.ativa = false; });
      localStorage.setItem('disc_simulada_avaliacoes', JSON.stringify(avs));
    });
    await page.locator('[data-acao="enviar"]').click();
    await expect(page.locator('h1')).toHaveText('Esta avaliação foi encerrada');
    await expect(page.locator('[data-acao="retentar"]')).toHaveCount(0);
    await expect(page.locator('[data-acao="usar-codigo"]')).toBeVisible();
    expect(erros).toEqual([]);
  });
});
