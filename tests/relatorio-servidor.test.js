'use strict';
// Servidor (Apps Script): relatórios do processo — rascunho com o motor, edição, publicação, link
// público, divisão em várias células, IA opcional (Anthropic falsa) e gatilho pelo ClickUp.
// Nenhum serviço real é chamado (ClickUp e Anthropic falsos de tests/helpers/gas.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarGas, criarClickUpFalso, listaExemplo, configExemplo, TEM_MOTOR } = require('./helpers/gas.js');

const CHAVE = 'chave-secreta-de-teste-1234567890abcdef';
const ADMIN = { nome: 'Dona do Sistema', email: 'dona@empresa.com', senha: 'senha-forte-1' };
const SEM_MOTOR = TEM_MOTOR ? false : 'js/relatorio-motor.js ainda não existe';

function preparar(op) {
  op = op || {};
  const cu = criarClickUpFalso({ listas: { L1: listaExemplo() } });
  const ctx = carregarGas({ props: Object.assign({ ADMIN_KEY: CHAVE, CLICKUP_TOKEN: cu.token }, op.props), clickup: cu, anthropic: op.anthropic, confiabilidade: true });
  const T = ctx.post(Object.assign({ acao: 'primeiroAcesso', chave: CHAVE }, ADMIN)).token;
  const proc = ctx.post({ acao: 'processos.salvar', token: T, processo: {
    nome: 'Recepcionista 2026', empresa: 'Clínica Alfa', vaga: 'Recepcionista', cidade: 'Campinas', consultor: 'Wellington',
    contratante: 'Dra. Marta', periodo: { inicio: '2026-09-01', fim: '2026-10-15' }, clickupListId: 'L1',
    config: configExemplo(op.config)
  } }).processo;
  return { ctx, cu, T, proc };
}

// Relatório gravado direto (sem depender do motor), como o rascunho faria.
function gravarDireto(ctx, processoId, relatorio, status) {
  const g = ctx.g;
  const token = g.relNovoToken_();
  g.relGravar_(g.lerTabela_('Relatorios'), [], { token, processoId, status: status || 'rascunho', criadoEm: '2026-10-05T12:00:00.000Z', publicadoEm: '' }, relatorio);
  return token;
}

function relatorioSimples() {
  return {
    versao: 1, processo: { nome: 'Recepcionista 2026' },
    textos: {
      rec: { texto: 'Ana P. lidera com folga.', origem: 'regra' },
      leitura1: { texto: 'O DISC confirma a técnica.', origem: 'regra' },
      enc: { texto: 'Próximos passos: entrevista final.', origem: 'editado' }
    }
  };
}

test('rascunho: lê o ClickUp, roda o motor, guarda como rascunho e não deixa dado sensível nem nome completo', { skip: SEM_MOTOR }, () => {
  const { ctx, T, proc } = preparar({ config: { permitirAntecedentes: true } });
  const r = ctx.post({ acao: 'relatorio.rascunho', token: T, processoId: proc.id });
  assert.equal(r.ok, true, r.erro);
  assert.match(r.token, /^[0-9a-f]{64}$/);
  assert.equal(r.relatorio.versao, 1);
  assert.equal(typeof r.relatorio.textos, 'object');
  assert.ok(r.relatorio.processo && !('clickupListId' in r.relatorio.processo));
  const txt = JSON.stringify(r.relatorio);
  ['Ana Paula Souza', 'Bruno Lima Castro', 'ana@exemplo.com', '98888', '97777', 'Feminino', 'Casada', 'Asma', 'Nada consta', 'L1"']
    .forEach((s) => assert.ok(!txt.includes(s), 'não pode conter ' + s));
  const linhas = ctx.abas.Relatorios.linhas.slice(1);
  assert.equal(linhas.length, 1);
  assert.equal(String(linhas[0][0]).replace(/^'/, ''), r.token); // o Sheets não guarda o apóstrofo de "texto"
  assert.equal(linhas[0][1], proc.id);
  assert.equal(linhas[0][2], 'rascunho');
  const lista = ctx.post({ acao: 'relatorios.listar', token: T, processoId: proc.id });
  assert.deepEqual(lista.relatorios.map((x) => [x.token, x.status]), [[r.token, 'rascunho']]);
  assert.equal(ctx.post({ acao: 'relatorioPublico', token: r.token }).erro, 'Relatório não encontrado ou fora do ar.', 'rascunho não é público');
});

test('rascunho: processo sem lista ou sem ClickUp configurado dá erro claro', () => {
  const { ctx, T } = preparar();
  const semLista = ctx.post({ acao: 'processos.salvar', token: T, processo: { nome: 'Sem Lista' } }).processo;
  assert.match(ctx.post({ acao: 'relatorio.rascunho', token: T, processoId: semLista.id }).erro, /não está ligado/);
  assert.equal(ctx.post({ acao: 'relatorio.rascunho', token: T, processoId: 'ava_x' }).erro, 'Processo não encontrado.');
});

test('rascunho sem o motor no projeto avisa que falta o RelatorioMotor.gs', () => {
  const cu = criarClickUpFalso({ listas: { L1: listaExemplo() } });
  const ctx = carregarGas({ props: { ADMIN_KEY: CHAVE, CLICKUP_TOKEN: cu.token }, clickup: cu, motor: false });
  const T = ctx.post(Object.assign({ acao: 'primeiroAcesso', chave: CHAVE }, ADMIN)).token;
  const proc = ctx.post({ acao: 'processos.salvar', token: T, processo: { nome: 'Recepcionista', clickupListId: 'L1', config: configExemplo() } }).processo;
  assert.match(ctx.post({ acao: 'relatorio.rascunho', token: T, processoId: proc.id }).erro, /RelatorioMotor\.gs/);
});

test('salvar textos: só textos existentes, marca "editado"; corpo grande é aceito só nesta ação', () => {
  const { ctx, T, proc } = preparar();
  const tk = gravarDireto(ctx, proc.id, relatorioSimples());
  const r = ctx.post({ acao: 'relatorio.salvar', token: T, relatorioToken: tk, relatorio: { textos: {
    rec: { texto: 'Ana P. é a recomendada.', origem: 'regra' }, leitura1: { texto: 'O DISC confirma a técnica.' }, inventado: { texto: 'x' }
  } } });
  assert.equal(r.ok, true, r.erro);
  assert.equal(r.alterados, 1);
  assert.deepEqual(r.relatorio.textos.rec, { texto: 'Ana P. é a recomendada.', origem: 'editado' });
  assert.equal(r.relatorio.textos.leitura1.origem, 'regra', 'sem mudança continua "regra"');
  assert.ok(!('inventado' in r.relatorio.textos));

  const grande = { acao: 'relatorio.salvar', token: T, relatorioToken: tk, relatorio: Object.assign(relatorioSimples(), { lixo: 'x'.repeat(30000) }), textos: undefined };
  grande.relatorio.textos.enc = { texto: 'Novo encerramento.' };
  assert.equal(ctx.post(grande).ok, true, 'relatório inteiro (>20.000 caracteres) volta do painel');
  assert.match(ctx.post({ acao: 'eu', token: T, lixo: 'x'.repeat(30000) }).erro, /grande/);
  assert.equal(ctx.post({ acao: 'relatorio.salvar', token: T, relatorioToken: 'f'.repeat(64), textos: { a: 'b' } }).erro, 'Relatório não encontrado.');
  assert.equal(ctx.post({ acao: 'relatorio.salvar', token: T, relatorioToken: tk }).erro, 'Nada para salvar.');
});

test('relatório grande é dividido em várias linhas (cada célula < 50.000) e volta inteiro; encolher apaga as sobras', () => {
  const { ctx, T, proc } = preparar();
  const rel = relatorioSimples();
  rel.anexo = 'é=+@'.repeat(30000); // 120.000 caracteres, com sinais que viram fórmula no Sheets
  const tk = gravarDireto(ctx, proc.id, rel);
  const linhas = ctx.abas.Relatorios.linhas.slice(1);
  assert.equal(linhas.length, 3);
  linhas.forEach((l, i) => {
    assert.equal(String(l[0]).replace(/^'/, ''), tk);
    assert.equal(l[3], i);
    assert.ok(String(l[4]).length <= 50000);
    assert.equal(String(l[4]).charAt(0), '#', 'parte começa com # (nunca fórmula)');
  });
  const lido = ctx.g.relLer_(tk);
  assert.equal(lido.relatorio.anexo, rel.anexo);
  // um segundo relatório no meio não atrapalha
  const outro = gravarDireto(ctx, proc.id, relatorioSimples());
  delete rel.anexo;
  ctx.g.relGravar_(lido.tabela, lido.linhas, lido.meta, rel);
  assert.equal(ctx.abas.Relatorios.linhas.filter((l) => String(l[0]).replace(/^'/, '') === tk).length, 1);
  const semRealm = (o) => JSON.parse(JSON.stringify(o)); // objetos do vm têm outro protótipo
  assert.deepEqual(semRealm(ctx.g.relLer_(tk).relatorio), rel);
  assert.deepEqual(semRealm(ctx.g.relLer_(outro).relatorio), relatorioSimples());
  assert.equal(ctx.post({ acao: 'relatorios.listar', token: T }).relatorios.length, 2);
});

test('publicar: link com o endereço do site, comentário na tarefa "📌 Briefing", link público; despublicar tira do ar', () => {
  const { ctx, T, proc, cu } = preparar();
  const tk = gravarDireto(ctx, proc.id, relatorioSimples());
  const pub = ctx.post({ acao: 'relatorio.publicar', token: T, relatorioToken: tk, baseUrl: 'https://notus.github.io/test-DISC/admin.html' });
  assert.equal(pub.ok, true, pub.erro);
  assert.equal(pub.url, 'https://notus.github.io/test-DISC/relatorio.html?r=' + tk);
  const briefing = cu.listas.L1.tarefas.find((t) => t.id === 'tb');
  assert.deepEqual(briefing.comentarios, ['Relatório publicado: ' + pub.url]);
  const p = ctx.post({ acao: 'relatorioPublico', token: tk });
  assert.equal(p.ok, true, p.erro);
  assert.deepEqual(p.relatorio, relatorioSimples());
  assert.ok(p.publicadoEm);
  assert.equal(ctx.post({ acao: 'relatorios.listar', token: T, processoId: proc.id }).relatorios[0].status, 'publicado');

  assert.equal(ctx.post({ acao: 'relatorio.despublicar', token: T, relatorioToken: tk }).ok, true);
  assert.equal(ctx.post({ acao: 'relatorioPublico', token: tk }).erro, 'Relatório não encontrado ou fora do ar.');
  ['', 'abc', '<script>', 'g'.repeat(64), 'f'.repeat(64), undefined].forEach((t) => {
    assert.equal(ctx.post({ acao: 'relatorioPublico', token: t }).erro, 'Relatório não encontrado ou fora do ar.', String(t));
  });
});

test('publicar: sem tarefa de briefing comenta na lista; sem endereço do site devolve link relativo e avisa; falha no ClickUp não impede', () => {
  const { ctx, T, proc, cu } = preparar({ props: { SITE_URL: 'https://site.exemplo.com/disc/' } });
  cu.listas.L1.tarefas = cu.listas.L1.tarefas.filter((t) => t.id !== 'tb');
  const tk = gravarDireto(ctx, proc.id, relatorioSimples());
  const pub = ctx.post({ acao: 'relatorio.publicar', token: T, relatorioToken: tk, baseUrl: 'javascript:alert(1)' });
  assert.equal(pub.url, 'https://site.exemplo.com/disc/relatorio.html?r=' + tk, 'baseUrl inválida cai no SITE_URL');
  assert.deepEqual(cu.listas.L1.comentarios, ['Relatório publicado: ' + pub.url]);

  const b = preparar();
  const tk2 = gravarDireto(b.ctx, b.proc.id, relatorioSimples());
  const pub2 = b.ctx.post({ acao: 'relatorio.publicar', token: b.T, relatorioToken: tk2 });
  assert.equal(pub2.url, 'relatorio.html?r=' + tk2);
  assert.match(pub2.aviso, /SITE_URL/);

  const c = preparar();
  c.cu.falha = (q) => (q.metodo === 'post' ? { codigo: 500, corpo: {} } : null);
  const tk3 = gravarDireto(c.ctx, c.proc.id, relatorioSimples());
  const pub3 = c.ctx.post({ acao: 'relatorio.publicar', token: c.T, relatorioToken: tk3, baseUrl: 'https://x.com/' });
  assert.equal(pub3.ok, true);
  assert.match(pub3.aviso, /não deu para comentar/);
  assert.equal(c.ctx.post({ acao: 'relatorioPublico', token: tk3 }).ok, true);
});

test('melhorarTextos: sem chave "IA não configurada."; com chave chama a Messages API e marca origem "ia"', () => {
  const sem = preparar();
  const tk0 = gravarDireto(sem.ctx, sem.proc.id, relatorioSimples());
  assert.deepEqual(sem.ctx.post({ acao: 'relatorio.melhorarTextos', token: sem.T, relatorioToken: tk0 }), { ok: false, erro: 'IA não configurada.' });

  const pedidos = [];
  const anthropic = (req) => {
    pedidos.push(req);
    const itens = JSON.parse(req.corpo.messages[0].content.split('\n').slice(1).join('\n'));
    const textos = itens.map((i) => ({ id: i.id, texto: i.texto.toUpperCase() }));
    return { codigo: 200, corpo: { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify({ textos }) }] } };
  };
  const { ctx, T, proc } = preparar({ props: { ANTHROPIC_API_KEY: 'sk-ant-teste-segredo' }, anthropic });
  const tk = gravarDireto(ctx, proc.id, relatorioSimples());
  const r = ctx.post({ acao: 'relatorio.melhorarTextos', token: T, relatorioToken: tk });
  assert.equal(r.ok, true, r.erro);
  assert.equal(r.alterados, 2, 'por padrão só os textos de regra');
  assert.deepEqual(r.relatorio.textos.rec, { texto: 'ANA P. LIDERA COM FOLGA.', origem: 'ia' });
  assert.equal(r.relatorio.textos.enc.origem, 'editado', 'texto editado à mão não é trocado');
  assert.ok(!JSON.stringify(r).includes('sk-ant'), 'a chave nunca volta');
  const q = pedidos[0];
  assert.equal(q.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(q.headers['x-api-key'], 'sk-ant-teste-segredo');
  assert.equal(q.headers['anthropic-version'], '2023-06-01');
  assert.equal(q.corpo.model, 'claude-opus-5-5');
  assert.equal(q.corpo.output_config.format.type, 'json_schema');
  assert.ok(!('thinking' in q.corpo) || q.corpo.thinking.type === 'adaptive');
  assert.match(q.corpo.system, /dado pessoal sensível/);
  assert.equal(ctx.g.relLer_(tk).relatorio.textos.leitura1.origem, 'ia', 'gravado');

  const so = ctx.post({ acao: 'relatorio.melhorarTextos', token: T, relatorioToken: tk, ids: ['enc', 'nao-existe'] });
  assert.equal(so.alterados, 1);
  assert.equal(so.relatorio.textos.enc.origem, 'ia');
  assert.equal(JSON.parse(pedidos[1].corpo.messages[0].content.split('\n').slice(1).join('\n')).length, 1);
});

test('melhorarTextos: recusa da IA, erro HTTP e resposta fora do formato viram mensagens claras sem mudar nada', () => {
  let resposta;
  const { ctx, T, proc } = preparar({ props: { ANTHROPIC_API_KEY: 'sk-ant-x' }, anthropic: () => resposta });
  const tk = gravarDireto(ctx, proc.id, relatorioSimples());
  resposta = { codigo: 200, corpo: { stop_reason: 'refusal', content: [] } };
  assert.match(ctx.post({ acao: 'relatorio.melhorarTextos', token: T, relatorioToken: tk }).erro, /não quis/);
  resposta = { codigo: 529, corpo: { type: 'error', error: { type: 'overloaded_error', message: 'x' } } };
  assert.match(ctx.post({ acao: 'relatorio.melhorarTextos', token: T, relatorioToken: tk }).erro, /529 \(overloaded_error\)/);
  resposta = { codigo: 200, corpo: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'não é json' }] } };
  assert.match(ctx.post({ acao: 'relatorio.melhorarTextos', token: T, relatorioToken: tk }).erro, /formato inesperado/);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.g.relLer_(tk).relatorio)), relatorioSimples());
});

test('instalarGatilho cria um único gatilho de 10 minutos', () => {
  const { ctx } = preparar();
  ctx.g.instalarGatilho();
  ctx.g.instalarGatilho();
  assert.equal(ctx.gatilhos.length, 1);
  assert.equal(ctx.gatilhos[0].fn, 'verificarBriefingsClickUp');
  assert.equal(ctx.gatilhos[0].minutos, 10);
  ctx.g.removerGatilho();
  assert.equal(ctx.gatilhos.length, 0);
});

test('gatilho: briefing em "gerar relatório" gera rascunho, comenta e passa para "relatório em revisão"', { skip: SEM_MOTOR }, () => {
  const { ctx, T, proc, cu } = preparar();
  const r = JSON.parse(JSON.stringify(ctx.g.verificarBriefingsClickUp()));
  assert.deepEqual(r.erros, []);
  assert.equal(r.gerados.length, 1);
  assert.equal(r.gerados[0].processoId, proc.id);
  const briefing = cu.listas.L1.tarefas.find((t) => t.id === 'tb');
  assert.deepEqual(briefing.comentarios, ['Rascunho pronto para revisão no painel']);
  assert.equal(briefing.status, 'relatório em revisão');
  assert.equal(ctx.post({ acao: 'relatorios.listar', token: T, processoId: proc.id }).relatorios.length, 1);
  // segunda volta: nada a fazer
  assert.equal(ctx.g.verificarBriefingsClickUp().gerados.length, 0);
  // processo inativo é ignorado
  briefing.status = 'gerar relatório';
  ctx.post({ acao: 'processos.salvar', token: T, processo: { id: proc.id, nome: proc.nome, ativa: false } });
  assert.equal(ctx.g.verificarBriefingsClickUp().verificados, 0);
});

test('gatilho sem CLICKUP_TOKEN não faz nada', () => {
  const ctx = carregarGas({ props: { ADMIN_KEY: CHAVE } });
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.g.verificarBriefingsClickUp())), { verificados: 0, gerados: [], erros: [] });
  assert.equal(ctx.fetches.length, 0);
});

test('ponta a ponta (privacidade): rascunho -> publicar -> relatorioPublico não traz sensíveis, contato, ids nem segredos', { skip: SEM_MOTOR }, () => {
  const { ctx, T, proc, cu } = preparar({ config: { permitirAntecedentes: true }, props: { ANTHROPIC_API_KEY: 'sk-ant-segredo-de-teste' } });
  const r = ctx.post({ acao: 'relatorio.rascunho', token: T, processoId: proc.id });
  assert.equal(r.ok, true, r.erro);
  assert.equal(ctx.post({ acao: 'relatorio.publicar', token: T, relatorioToken: r.token, baseUrl: 'https://site.exemplo/admin.html' }).ok, true);
  const p = ctx.post({ acao: 'relatorioPublico', token: r.token });
  assert.equal(p.ok, true, p.erro);
  assert.deepEqual(Object.keys(p).sort(), ['ok', 'publicadoEm', 'relatorio']);
  const txt = JSON.stringify(p);
  ['Ana Paula Souza', 'Bruno Lima Castro', 'ana@exemplo.com', '98888', '97777', '96666', 'Feminino', 'Masculino', 'Casada',
    'Asma', 'Nada consta', '"L1"', '"t1"', '"t2"', '"t3"', 'clickupListId', 'antecedente', cu.token, 'sk-ant-segredo-de-teste', T]
    .forEach((s) => assert.ok(!txt.includes(s), 'relatório público não pode conter ' + s));
  // nem as respostas das ações do painel devolvem os segredos
  ['clickup.status', 'processos.listar', 'relatorios.listar'].forEach((acao) => {
    const t = JSON.stringify(ctx.post({ acao, token: T, processoId: proc.id }));
    assert.ok(!t.includes(cu.token) && !t.includes('sk-ant-segredo-de-teste'), acao);
  });
  // ações do painel exigem sessão
  ['relatorio.rascunho', 'relatorio.salvar', 'relatorio.publicar', 'relatorio.despublicar', 'relatorios.listar', 'processo.dados', 'clickup.listas']
    .forEach((acao) => assert.equal(ctx.post({ acao, processoId: proc.id, relatorioToken: r.token, id: proc.id }).ok, false, acao));
});
