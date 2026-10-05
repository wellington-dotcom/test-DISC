'use strict';
const { test, expect } = require('@playwright/test');
const { API_FALSA, coletarErros, configurar, simularApi, responderGrupo, preencherIdentificacao, fazerTesteCompleto } = require('./util.js');

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

    // Grupo 1: botão "Avançar" só habilita com o grupo completo; "refazer" limpa.
    await expect(page.locator('.progresso-topo')).toContainText('Grupo 1 de 25');
    await expect(page.locator('.palavra')).toHaveCount(4);
    await expect(page.locator('[data-acao="proximo"]')).toBeDisabled();
    await page.locator('.palavra[data-letra="C"]').click();
    await expect(page.locator('.palavra[data-letra="C"]')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('[data-acao="refazer"]').click();
    await expect(page.locator('.palavra.escolhida')).toHaveCount(0);

    const ordem = ['S', 'C', 'I', 'D'];
    for (let i = 0; i < 12; i++) {
      await expect(page.locator('.progresso-topo')).toContainText('Grupo ' + (i + 1) + ' de 25');
      await responderGrupo(page, ordem);
      if (i === 0) {
        await expect(page.locator('.palavra[data-letra="S"] .selo-num')).toHaveText('4');
        await expect(page.locator('.palavra[data-letra="D"] .selo-num')).toHaveText('1');
        await expect(page.locator('[data-acao="proximo"]')).toBeEnabled();
      }
      await page.locator('[data-acao="proximo"]').click();
    }

    // A ordem das palavras é embaralhada (não é sempre D, I, S, C).
    const ordemTela = await page.locator('.palavra').evaluateAll((els) => els.map((e) => e.getAttribute('data-letra')).join(''));
    expect(ordemTela.split('').sort().join('')).toBe('CDIS');

    // Recarrega no meio: deve oferecer "Continuar de onde parei" e voltar ao grupo 13.
    await page.reload();
    await expect(page.locator('[data-acao="continuar"]')).toBeVisible();
    await page.locator('[data-acao="continuar"]').click();
    await expect(page.locator('.progresso-topo')).toContainText('Grupo 13 de 25');
    const ordemDepois = await page.locator('.palavra').evaluateAll((els) => els.map((e) => e.getAttribute('data-letra')).join(''));
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
      return { ok: true, id: corpo.payload && corpo.payload.id };
    });

    await fazerTesteCompleto(page, { nome: 'José Antônio Pereira', telefone: '2133334444' }, ['D', 'I', 'S', 'C']);
    await page.locator('[data-acao="enviar"]').click();

    // Primeira tentativa falha e mostra o erro; a segunda dá certo.
    await expect(page.locator('h1')).toHaveText('Não foi possível enviar');
    // Mensagem técnica do servidor não é mostrada ao candidato; ele é orientado a usar o código.
    await expect(page.locator('.alerta')).toContainText('Gerar código de resultado');
    await expect(page.locator('.alerta')).not.toContainText('Falha temporária simulada.');
    await page.locator('[data-acao="retentar"]').click();
    await expect(page.locator('h1')).toHaveText('Obrigado, José!');
    await expect(page.locator('.destaque')).toContainText('enviadas com sucesso');
    // Envio confirmado: nada de código nem dados pessoais guardados no aparelho.
    await expect(page.locator('textarea#codigo')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('disc_concluido_v1'))).toBeNull();
    expect(await page.evaluate(() => sessionStorage.getItem('disc_concluido_v1'))).not.toContain('2133334444');
    await page.reload();
    await expect(page.locator('h1')).toHaveText('Obrigado, José!');

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
    await page.locator('[data-acao="usar-codigo"]').click();
    await expect(page.locator('h1')).toHaveText('Obrigado, Paula!');
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
