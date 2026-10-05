// Edge Function "admin": autenticação, CORS, ClickUp, relatório (rascunho/edição/publicação/IA) e
// usuários — com banco, Auth, ClickUp e Anthropic falsos. Nenhuma chamada real.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  gas, criarFetch, criarDbFalso, criarAuthAdminFalso, linhaProcesso, UUID_PROC, UUID_ADMIN, TOKEN_CU
} from './apoio.js';
import { atenderAdmin, origemPermitida } from '../../supabase/funcoes-compartilhadas/http.js';
import {
  relBaseSite, relNomeCurto, REL_IA_MODELO, relMontar, relNomesCurtos, relFotoValida, REL_MAX_JSON_COM_FOTOS
} from '../../supabase/funcoes-compartilhadas/relatorio.js';
import { itemDaResposta } from '../../supabase/funcoes-compartilhadas/clickup.js';
import { readFileSync } from 'node:fs';
import { DISC_RELATORIO, DISC_CONFIABILIDADE } from '../../supabase/funcoes-compartilhadas/motores-gerado.js';

const SITE = 'https://disc.gestaosemcaos.com.br';
const JWT_ADMIN = 'jwt-admin';
const JWT_COMUM = 'jwt-comum';
const OUTRO = 'aaaaaaaa-0000-4000-8000-000000000002';
const FOTO_A = 'data:image/jpeg;base64,/9j/' + 'A'.repeat(200);

function preparar(op) {
  op = op || {};
  const cuFalso = gas.criarClickUpFalso({ listas: { L1: op.lista || gas.listaExemplo() } });
  const db = criarDbFalso({
    processos: [linhaProcesso(op.processo)],
    admins: [{ user_id: UUID_ADMIN, nome: 'Dona do Sistema', criado_em: '2026-09-01T00:00:00Z' }]
  });
  const authAdmin = criarAuthAdminFalso([
    { id: UUID_ADMIN, email: 'dona@empresa.com', created_at: '2026-09-01T00:00:00Z', last_sign_in_at: '2026-10-05T09:00:00Z' },
    { id: OUTRO, email: 'outra@empresa.com', created_at: '2026-09-02T00:00:00Z' }
  ]);
  const fetch = criarFetch(cuFalso, { anthropic: op.anthropic });
  const env = Object.assign({ CLICKUP_TOKEN: TOKEN_CU, SITE_URL: SITE + '/', ANTHROPIC_API_KEY: '' }, op.env);
  const base = {
    env, fetch, db, authAdmin,
    dormir: async () => {},
    agora: () => Date.parse('2026-10-05T12:00:00Z'),
    motor: DISC_RELATORIO, confiabilidade: DISC_CONFIABILIDADE,
    autenticar: async (h) => {
      if (h === 'Bearer ' + JWT_ADMIN) return { usuario: { id: UUID_ADMIN, email: 'dona@empresa.com' }, eAdmin: true };
      if (h === 'Bearer ' + JWT_COMUM) return { usuario: { id: OUTRO, email: 'outra@empresa.com' }, eAdmin: false };
      return null;
    }
  };
  async function chamar(corpo, jwt, extra) {
    const req = new Request('https://x.supabase.co/functions/v1/admin', {
      method: (extra && extra.method) || 'POST',
      headers: Object.assign({ 'content-type': 'application/json', origin: SITE }, jwt === null ? {} : { authorization: 'Bearer ' + (jwt || JWT_ADMIN) }, extra && extra.headers),
      body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo)
    });
    const resp = await atenderAdmin(req, base);
    return { status: resp.status, headers: resp.headers, json: await resp.json() };
  }
  return { cuFalso, db, authAdmin, fetch, env, base, chamar };
}

test('sessão: sem JWT ou JWT inválido -> sessaoExpirada; não admin -> "Sem permissão."; ação desconhecida', async () => {
  const { chamar } = preparar();
  assert.deepEqual((await chamar({ acao: 'clickup.status' }, null)).json, { ok: false, erro: 'Sessão expirada. Entre de novo.', sessaoExpirada: true });
  assert.equal((await chamar({ acao: 'clickup.status' }, 'xyz')).json.sessaoExpirada, true);
  assert.deepEqual((await chamar({ acao: 'clickup.status' }, JWT_COMUM)).json, { ok: false, erro: 'Sem permissão.' });
  assert.equal((await chamar({ acao: 'nada' })).json.erro, 'Ação desconhecida.');
  assert.equal((await chamar('{x')).json.erro, 'JSON inválido.');
  assert.equal((await chamar({ acao: 'clickup.status', lixo: 'x'.repeat(30000) })).json.erro, 'Requisição grande demais.');
});

test('CORS: preflight e respostas liberam só SITE_URL e localhost', async () => {
  const { base } = preparar();
  const pre = await atenderAdmin(new Request('https://x/admin', { method: 'OPTIONS', headers: { origin: SITE } }), base);
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), SITE);
  assert.match(pre.headers.get('access-control-allow-headers'), /authorization/);
  const mal = await atenderAdmin(new Request('https://x/admin', { method: 'OPTIONS', headers: { origin: 'https://malicioso.com' } }), base);
  assert.equal(mal.headers.get('access-control-allow-origin'), null);
  assert.equal(origemPermitida('http://localhost:4173', SITE), true);
  assert.equal(origemPermitida('http://127.0.0.1:8080', SITE), true);
  assert.equal(origemPermitida('https://disc.gestaosemcaos.com.br.evil.com', SITE), false);
  assert.equal(origemPermitida('', SITE), false);
});

test('clickup.status, clickup.listas e processo.dados', async () => {
  const { chamar } = preparar({ env: { ANTHROPIC_API_KEY: 'sk-teste' } });
  const st = (await chamar({ acao: 'clickup.status' })).json;
  assert.deepEqual(st, { ok: true, configurado: true, pastaConfigurada: false, iaConfigurada: true, avisos: [], conectado: true, usuario: 'Consultora Notus' });
  assert.deepEqual((await chamar({ acao: 'clickup.listas' })).json, { ok: true, listas: [] });
  const d = (await chamar({ acao: 'processo.dados', id: UUID_PROC })).json;
  assert.equal(d.ok, true, d.erro);
  assert.deepEqual(d.candidatos.map((c) => c.nome), ['Ana Paula Souza', 'Bruno Lima Castro', 'Carla Dias']);
  assert.equal(d.processo.empresa, 'Clínica Alfa');
  assert.deepEqual(d.processo.periodo, { inicio: '2026-09-01', fim: '2026-10-15' });
  assert.equal((await chamar({ acao: 'processo.dados', id: 'nao-existe' })).json.erro, 'Processo não encontrado.');

  const sem = preparar({ env: { CLICKUP_TOKEN: '' }, processo: {} });
  const s2 = (await sem.chamar({ acao: 'clickup.status' })).json;
  assert.equal(s2.configurado, false);
  assert.match((await sem.chamar({ acao: 'clickup.listas' })).json.erro, /CLICKUP_TOKEN/);
  assert.match((await sem.chamar({ acao: 'processo.dados', id: UUID_PROC })).json.erro, /CLICKUP_TOKEN/);
  const semLista = preparar({ processo: { clickup_list_id: null } });
  assert.match((await semLista.chamar({ acao: 'relatorio.rascunho', processoId: UUID_PROC })).json.erro, /não está ligado/);
});

test('relatório: rascunho -> salvar -> publicar (comenta no Briefing) -> listar -> despublicar', async () => {
  const { chamar, db, cuFalso } = preparar();
  const r = (await chamar({ acao: 'relatorio.rascunho', processoId: UUID_PROC })).json;
  assert.equal(r.ok, true, r.erro);
  assert.match(r.token, /^[0-9a-f]{64}$/);
  assert.ok(Array.isArray(r.avisos));
  const txt = JSON.stringify(r.relatorio);
  ['Ana Paula Souza', 'Bruno Lima Castro', 'Nada consta', 'Feminino', 'ana@exemplo.com', '98888', 'L1', TOKEN_CU].forEach((s) => assert.ok(!txt.includes(s), s));
  assert.ok(txt.includes(relNomeCurto('Ana Paula Souza')) || txt.includes('Ana P.'));
  // mesmo relatório que o Apps Script gera para a mesma lista
  const g = gas.carregarGas({ props: { ADMIN_KEY: 'chave-secreta-de-teste-1234567890abcdef', CLICKUP_TOKEN: TOKEN_CU },
    clickup: gas.criarClickUpFalso({ listas: { L1: gas.listaExemplo() } }), confiabilidade: true });
  const T = g.post({ acao: 'primeiroAcesso', chave: 'chave-secreta-de-teste-1234567890abcdef', nome: 'Dona do Sistema', email: 'dona@empresa.com', senha: 'senha-forte-1' }).token;
  const pg = g.post({ acao: 'processos.salvar', token: T, processo: { nome: 'Recepcionista 2026', empresa: 'Clínica Alfa', vaga: 'Recepcionista',
    cidade: 'Campinas', consultor: 'Wellington', contratante: 'Dra. Marta', periodo: { inicio: '2026-09-01', fim: '2026-10-15' }, clickupListId: 'L1', config: gas.configExemplo() } }).processo;
  g.avancar(Date.parse('2026-10-05T12:00:00Z') - Date.now());
  const rg = g.post({ acao: 'relatorio.rascunho', token: T, processoId: pg.id });
  assert.equal(rg.ok, true, rg.erro);
  const semIds = (x) => JSON.parse(JSON.stringify(x).split(pg.id).join('ID').split(UUID_PROC).join('ID').split(pg.codigo).join('COD').split('RCP2').join('COD')
    .replace(/"geradoEm":"[^"]*"/g, '"geradoEm":""'));
  assert.deepEqual(semIds(r.relatorio), semIds(rg.relatorio));
  assert.deepEqual(r.avisos, rg.avisos);
  assert.equal(db.st.relatorios.length, 1);
  assert.equal(db.st.relatorios[0].status, 'rascunho');
  assert.equal(db.st.relatorios[0].processo_id, UUID_PROC);

  const ids = Object.keys(r.relatorio.textos);
  const edit = (await chamar({ acao: 'relatorio.salvar', relatorioToken: r.token, relatorio: { textos: { [ids[0]]: { texto: 'Texto novo\nlinha 2' }, inexistente: 'x' } } })).json;
  assert.equal(edit.ok, true, edit.erro);
  assert.equal(edit.alterados, 1);
  assert.deepEqual(db.st.relatorios[0].dados.textos[ids[0]], { texto: 'Texto novo\nlinha 2', origem: 'editado' });
  assert.equal((await chamar({ acao: 'relatorio.salvar', relatorioToken: r.token })).json.erro, 'Nada para salvar.');
  assert.equal((await chamar({ acao: 'relatorio.salvar', relatorioToken: 'abc', textos: {} })).json.erro, 'Relatório não encontrado.');
  // corpo grande só é aceito no salvar
  const grande = (await chamar({ acao: 'relatorio.salvar', relatorioToken: r.token, textos: { [ids[1]]: 'y'.repeat(30000) } })).json;
  assert.equal(grande.ok, true);
  assert.equal(db.st.relatorios[0].dados.textos[ids[1]].texto.length, 4000);

  const pub = (await chamar({ acao: 'relatorio.publicar', relatorioToken: r.token, baseUrl: SITE + '/admin.html' })).json;
  assert.deepEqual(pub, { ok: true, url: SITE + '/relatorio.html?r=' + r.token, comentadoEm: 'tarefa' });
  assert.equal(db.st.relatorios[0].status, 'publicado');
  assert.ok(db.st.relatorios[0].publicado_em);
  const briefing = cuFalso.listas.L1.tarefas.find((t) => t.id === 'tb');
  assert.deepEqual(briefing.comentarios, ['Relatório publicado: ' + SITE + '/relatorio.html?r=' + r.token]);

  const lista = (await chamar({ acao: 'relatorios.listar', processoId: UUID_PROC })).json;
  assert.equal(lista.relatorios.length, 1);
  assert.deepEqual(Object.keys(lista.relatorios[0]).sort(), ['atualizadoEm', 'criadoEm', 'processoId', 'publicadoEm', 'status', 'token']);
  assert.equal(lista.relatorios[0].status, 'publicado');

  assert.deepEqual((await chamar({ acao: 'relatorio.despublicar', relatorioToken: r.token })).json, { ok: true });
  assert.equal(db.st.relatorios[0].status, 'rascunho');
  assert.equal(db.st.relatorios[0].publicado_em, null);
});

test('publicar: sem Briefing comenta na lista; sem SITE_URL avisa; falha no ClickUp não impede e vira aviso', async () => {
  const lista = gas.listaExemplo();
  lista.tarefas = lista.tarefas.filter((t) => t.id !== 'tb');
  const a = preparar({ lista });
  const r = (await a.chamar({ acao: 'relatorio.rascunho', processoId: UUID_PROC })).json;
  const p = (await a.chamar({ acao: 'relatorio.publicar', relatorioToken: r.token })).json;
  assert.equal(p.url, SITE + '/relatorio.html?r=' + r.token);
  assert.equal(p.comentadoEm, 'lista');
  assert.equal(a.cuFalso.listas.L1.comentarios.length, 1);

  const b = preparar({ env: { SITE_URL: '' } });
  const rb = (await b.chamar({ acao: 'relatorio.rascunho', processoId: UUID_PROC })).json;
  const pb = (await b.chamar({ acao: 'relatorio.publicar', relatorioToken: rb.token })).json;
  assert.equal(pb.url, 'relatorio.html?r=' + rb.token);
  assert.match(pb.aviso, /SITE_URL/);

  const c = preparar();
  const rc = (await c.chamar({ acao: 'relatorio.rascunho', processoId: UUID_PROC })).json;
  c.cuFalso.falha = (q) => (q.metodo === 'post' ? { codigo: 500, corpo: { err: 'fora do ar' } } : null);
  const pc = (await c.chamar({ acao: 'relatorio.publicar', relatorioToken: rc.token })).json;
  assert.equal(pc.ok, true);
  assert.match(pc.aviso, /Relatório publicado, mas não deu para comentar o link no ClickUp \(o ClickUp respondeu 500/);
  const st = (await c.chamar({ acao: 'clickup.status' })).json;
  assert.ok(st.avisos.some((x) => /não deu para comentar/.test(x.aviso)), JSON.stringify(st.avisos));
});

test('melhorarTextos: sem chave, chamada igual ao Relatorio.gs, marca "ia"; erros viram mensagens claras', async () => {
  const sem = preparar();
  const r0 = (await sem.chamar({ acao: 'relatorio.rascunho', processoId: UUID_PROC })).json;
  assert.equal((await sem.chamar({ acao: 'relatorio.melhorarTextos', relatorioToken: r0.token })).json.erro, 'IA não configurada.');

  let pedido = null;
  let resposta = null;
  const a = preparar({ env: { ANTHROPIC_API_KEY: 'sk-ant-teste' }, anthropic: (req) => { pedido = req; return resposta(req); } });
  const r = (await a.chamar({ acao: 'relatorio.rascunho', processoId: UUID_PROC })).json;
  const ids = Object.keys(r.relatorio.textos).slice(0, 2);
  resposta = (req) => {
    const itens = JSON.parse(req.corpo.messages[0].content.split('\n').slice(1).join('\n'));
    return { codigo: 200, corpo: { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ textos: itens.map((i) => ({ id: i.id, texto: 'IA: ' + i.texto })) }) }] } };
  };
  const m = (await a.chamar({ acao: 'relatorio.melhorarTextos', relatorioToken: r.token, ids: ids.concat(['nao-existe']) })).json;
  assert.equal(m.ok, true, m.erro);
  assert.equal(m.alterados, 2);
  assert.equal(m.relatorio.textos[ids[0]].origem, 'ia');
  assert.equal(pedido.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(pedido.headers['x-api-key'], 'sk-ant-teste');
  assert.equal(pedido.headers['anthropic-version'], '2023-06-01');
  assert.equal(pedido.corpo.model, REL_IA_MODELO);

  // mesmo corpo do Apps Script
  const g = gas.carregarGas();
  const itens = [{ id: 'a', texto: 'b' }];
  let corpoGas = null;
  g.g.UrlFetchApp.fetch = (url, opcoes) => { corpoGas = JSON.parse(opcoes.payload); return { getResponseCode: () => 500, getContentText: () => '{}' }; };
  assert.throws(() => g.g.relChamarIa_('k', itens));
  const { relCorpoIa } = await import('../../supabase/funcoes-compartilhadas/relatorio.js');
  assert.deepEqual(relCorpoIa(itens), corpoGas);

  resposta = () => ({ codigo: 200, corpo: { stop_reason: 'refusal', content: [] } });
  assert.match((await a.chamar({ acao: 'relatorio.melhorarTextos', relatorioToken: r.token })).json.erro, /não quis reescrever/);
  resposta = () => ({ codigo: 529, corpo: { error: { type: 'overloaded_error' } } });
  assert.equal((await a.chamar({ acao: 'relatorio.melhorarTextos', relatorioToken: r.token })).json.erro,
    'Não foi possível melhorar os textos: a IA respondeu 529 (overloaded_error).');
  resposta = () => ({ codigo: 200, corpo: { content: [{ type: 'text', text: 'oi' }] } });
  assert.match((await a.chamar({ acao: 'relatorio.melhorarTextos', relatorioToken: r.token })).json.erro, /formato inesperado/);
});

test('usuários: listar, convidar (com redirect para o painel), já existente, remover e proteções', async () => {
  const { chamar, db, authAdmin } = preparar();
  const l = (await chamar({ acao: 'usuarios.listar' })).json;
  assert.equal(l.ok, true);
  assert.deepEqual(l.usuarios, [{ id: UUID_ADMIN, nome: 'Dona do Sistema', email: 'dona@empresa.com', papel: 'admin', ativo: true,
    criadoEm: '2026-09-01T00:00:00Z', ultimoAcesso: '2026-10-05T09:00:00Z', convitePendente: false, voce: true, foto: '' }]);
  // Foto do usuário (admins.foto) vai junto; inválida vira ''.
  db.st.admins[0].foto = FOTO_A;
  assert.equal((await chamar({ acao: 'usuarios.listar' })).json.usuarios[0].foto, FOTO_A);
  db.st.admins[0].foto = 'data:image/png;base64,AAAA';
  assert.equal((await chamar({ acao: 'usuarios.listar' })).json.usuarios[0].foto, '');
  delete db.st.admins[0].foto;

  assert.equal((await chamar({ acao: 'usuarios.convidar', email: 'nova@empresa.com', nome: 'X' })).json.erro, 'Informe o nome do usuário.');
  assert.equal((await chamar({ acao: 'usuarios.convidar', email: 'nao-e-email', nome: 'Nova Pessoa' })).json.erro, 'E-mail inválido.');
  const c = (await chamar({ acao: 'usuarios.convidar', email: ' Nova@Empresa.com ', nome: 'Nova Pessoa' })).json;
  assert.equal(c.ok, true, c.erro);
  assert.equal(c.convidado, true);
  assert.equal(c.usuario.email, 'nova@empresa.com');
  assert.equal(c.usuario.convitePendente, true);
  assert.deepEqual(authAdmin.st.convites, [{ email: 'nova@empresa.com', op: { nome: 'Nova Pessoa', redirectTo: SITE + '/admin.html' } }]);
  assert.equal(db.st.admins.length, 2);
  assert.equal((await chamar({ acao: 'usuarios.convidar', email: 'nova@empresa.com', nome: 'Nova Pessoa' })).json.erro, 'Já existe um usuário com este e-mail.');
  // usuário que já existe no Auth (mas não é admin) vira admin sem novo convite
  const e = (await chamar({ acao: 'usuarios.convidar', usuario: { email: 'outra@empresa.com', nome: 'Outra Pessoa' } })).json;
  assert.equal(e.ok, true);
  assert.equal(e.convidado, false);
  assert.equal(authAdmin.st.convites.length, 1);
  assert.match((await chamar({ acao: 'usuarios.convidar', email: 'x@falha.com', nome: 'Falha Total' })).json.erro, /^Não foi possível enviar o convite: limite/);

  assert.equal((await chamar({ acao: 'usuarios.remover', id: UUID_ADMIN })).json.erro, 'Você não pode excluir o seu próprio acesso.');
  assert.equal((await chamar({ acao: 'usuarios.remover', id: 'nao' })).json.erro, 'Usuário não encontrado.');
  assert.deepEqual((await chamar({ acao: 'usuarios.remover', id: OUTRO })).json, { ok: true, id: OUTRO });
  assert.ok(!db.st.admins.some((a) => a.user_id === OUTRO));
  assert.deepEqual(authAdmin.st.excluidos, [OUTRO]);
});

test('relBaseSite: baseUrl https do painel, SITE_URL com ou sem barra, nada válido -> ""', () => {
  assert.equal(relBaseSite('https://disc.gestaosemcaos.com.br/admin.html?x=1#y', ''), 'https://disc.gestaosemcaos.com.br/');
  assert.equal(relBaseSite('', 'https://disc.gestaosemcaos.com.br'), 'https://disc.gestaosemcaos.com.br/');
  assert.equal(relBaseSite('http://inseguro.com/', 'https://site.com/pasta'), 'https://site.com/pasta/');
  assert.equal(relBaseSite('javascript:alert(1)', ''), '');
});

test('relatórios dos modelos novos (equipe/liderança/pessoa, sem processo) ficam fora das ações do relatório de processo', async () => {
  const { chamar, db } = preparar({ env: { ANTHROPIC_API_KEY: 'chave-falsa' } });
  const tokenEquipe = 'e'.repeat(64);
  await db.relatorioInserir({ token: tokenEquipe, processo_id: null, modelo: 'equipe', empresa_id: 'x', status: 'rascunho',
    dados: { modelo: 'equipe', titulo: 'Equipe', textos: {} }, criado_em: '2026-10-05T00:00:00Z' });
  for (const acao of ['relatorio.publicar', 'relatorio.despublicar', 'relatorio.melhorarTextos']) {
    assert.equal((await chamar({ acao, relatorioToken: tokenEquipe })).json.erro, 'Relatório não encontrado.', acao);
  }
  assert.equal((await chamar({ acao: 'relatorio.salvar', relatorioToken: tokenEquipe, relatorio: { textos: { a: 'b' } } })).json.erro, 'Relatório não encontrado.');
  const lista = (await chamar({ acao: 'relatorios.listar' })).json;
  assert.ok(lista.relatorios.every((r) => r.token !== tokenEquipe));
});

// ---------------------------------------------------------------------------
// Fotos no relatório do processo (snapshot montado no servidor)
// ---------------------------------------------------------------------------
const FIXTURE = JSON.parse(readFileSync(new URL('../fixtures/processo-exemplo.json', import.meta.url), 'utf8'));
const fotoDe = (id, tam) => 'data:image/jpeg;base64,/9j/' + id.replace(/[^A-Za-z0-9]/g, '') + 'Q'.repeat(tam || 300);

test('relatório do processo: cada candidato do ranking e do quadro DISC ganha a foto certa (nomes curtos repetidos)', () => {
  const dados = JSON.parse(JSON.stringify(FIXTURE));
  // Dois finalistas com o mesmo nome curto ("Ana P."): o motor desempata e a foto tem de seguir a pessoa certa.
  dados.candidatos[0].nome = 'Ana Paula Souza';
  dados.candidatos[1].nome = 'Ana Pereira Lima';
  dados.candidatos.forEach((c, i) => { if (i !== 2) c.foto = fotoDe(c.id); });
  dados.candidatos[3].foto = 'data:image/png;base64,AAAA'; // inválida: fica sem foto
  const rel = relMontar(DISC_RELATORIO, dados, '2026-10-05T12:00:00.000Z');
  const curtos = relNomesCurtos(DISC_RELATORIO, dados.candidatos);
  const linhas = rel.ranking.linhas;
  assert.ok(linhas.length >= 5);
  const nomesCurtos = new Set(Object.values(curtos));
  linhas.concat(rel.disc.quadro).forEach((l) => assert.ok(nomesCurtos.has(l.nome), 'nome do motor reconhecido: ' + l.nome));
  // Confere de forma independente: casa cada linha do ranking com o candidato pelas notas.
  let conferidas = 0;
  linhas.forEach((l) => {
    const casam = dados.candidatos.filter((c) => c.finalista && Object.keys(l.notas).every((k) => l.notas[k] === null || c.notas[k] === l.notas[k]));
    if (casam.length !== 1) return;
    const c = casam[0];
    const esperada = relFotoValida(c.foto) ? c.foto : undefined;
    assert.equal(l.foto, esperada, l.nome);
    const q = rel.disc.quadro.find((x) => x.nome === l.nome);
    if (q) assert.equal(q.foto, esperada, 'quadro ' + l.nome);
    conferidas++;
  });
  assert.ok(conferidas >= 5, 'conferidas: ' + conferidas);
  assert.ok(linhas.some((l) => l.nome.startsWith('Ana P') && l.foto), 'Ana com foto');
  assert.ok(!JSON.stringify(rel).includes('image/png'));
  // Sem fotos: nenhum campo foto.
  const semFoto = relMontar(DISC_RELATORIO, FIXTURE, '2026-10-05T12:00:00.000Z');
  assert.ok(!JSON.stringify(semFoto).includes('"foto"'));
});

test('relatório do processo: fotos que estourariam o limite ficam de fora (o relatório continua)', () => {
  const dados = JSON.parse(JSON.stringify(FIXTURE));
  dados.candidatos.forEach((c) => { c.foto = fotoDe(c.id, 39900); });
  const rel = relMontar(DISC_RELATORIO, dados, '2026-10-05T12:00:00.000Z');
  assert.ok(JSON.stringify(rel).length <= REL_MAX_JSON_COM_FOTOS);
  const com = rel.ranking.linhas.filter((l) => l.foto).length;
  assert.ok(com >= 1 && com <= rel.ranking.linhas.length);
});

test('itemDaResposta: foto da resposta ou, sem ela, a da ficha (pessoas embutida)', () => {
  const base = { id: 'r1', telefone: '5511999990000', respostas: '1234'.repeat(25), recebido_em: '2026-10-01T00:00:00Z' };
  assert.equal(itemDaResposta(Object.assign({ foto: FOTO_A, pessoas: { foto: fotoDe('x') } }, base)).foto, FOTO_A);
  assert.equal(itemDaResposta(Object.assign({ foto: null, pessoas: { foto: fotoDe('x') } }, base)).foto, fotoDe('x'));
  assert.equal(itemDaResposta(Object.assign({ foto: 'https://x/y.jpg', pessoas: [{ foto: 'lixo' }] }, base)).foto, '');
  assert.equal(itemDaResposta(base).foto, '');
});

test('processo.dados e rascunho: a resposta do DISC casada pelo WhatsApp leva a foto (da resposta ou da ficha)', async () => {
  const a = preparar();
  a.db.st.respostas.push({ id: 'r-ana', processo_id: UUID_PROC, avaliacao: 'RCP2', telefone: '5511988881111',
    respostas: '4321'.repeat(25), protocolo: '11A', recebido_em: '2026-09-10T00:00:00Z', foto: null, pessoas: { foto: FOTO_A } });
  a.db.st.respostas.push({ id: 'r-bruno', processo_id: UUID_PROC, avaliacao: 'RCP2', telefone: '5521977772222',
    respostas: '1234'.repeat(25), protocolo: '12B', recebido_em: '2026-09-10T00:00:00Z', foto: 'data:image/png;base64,AAAA' });
  const d = (await a.chamar({ acao: 'processo.dados', id: UUID_PROC })).json;
  assert.equal(d.ok, true, d.erro);
  const porNome = Object.fromEntries(d.candidatos.map((c) => [c.nome, c]));
  assert.equal(porNome['Ana Paula Souza'].foto, FOTO_A);
  assert.equal(porNome['Bruno Lima Castro'].foto, undefined);
  assert.equal(porNome['Carla Dias'].foto, undefined);
  const r = (await a.chamar({ acao: 'relatorio.rascunho', processoId: UUID_PROC })).json;
  assert.equal(r.ok, true, r.erro);
  const json = JSON.stringify(r.relatorio);
  assert.ok(!json.includes('image/png'));
  const linhasComFoto = r.relatorio.ranking.linhas.filter((l) => l.foto);
  assert.ok(linhasComFoto.length >= 1, 'Ana aparece no ranking com foto');
  assert.ok(linhasComFoto.every((l) => l.foto === FOTO_A && l.nome.startsWith('Ana')));
});
