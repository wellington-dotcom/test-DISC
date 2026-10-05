// Os arquivos de dist/funcoes (para colar no painel do Supabase) estão em dia, são autocontidos e
// funcionam de ponta a ponta: cada um roda aqui no Node com um "Deno" e um supabase-js falsos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHmac } from 'node:crypto';
import { gas, fixtures, criarFetch, criarSupabaseFalso, linhaProcesso, UUID_PROC, UUID_ADMIN, TOKEN_CU } from './apoio.js';
import { gerarTudo, funcoes } from '../../scripts/montar-funcoes.mjs';
import { criarDb } from '../../supabase/funcoes-compartilhadas/supabase-adaptadores.js';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SITE = 'https://disc.gestaosemcaos.com.br';
const VENDAS = ['pagamento', 'asaas-webhook', 'infinitepay-webhook'];
const IMPORT_SUPABASE = "import { createClient } from 'jsr:@supabase/supabase-js@2';";

test('gerados em dia: motores-gerado.js e dist/funcoes/<nome>/index.ts (rode npm run montar:funcoes)', () => {
  assert.deepEqual(funcoes(), ['admin', 'asaas-webhook', 'clickup-webhook', 'disc-sync', 'infinitepay-webhook', 'pagamento']);
  for (const g of gerarTudo()) {
    assert.ok(existsSync(g.caminho), g.caminho);
    assert.equal(readFileSync(g.caminho, 'utf8'), g.conteudo, g.caminho + ' desatualizado: rode npm run montar:funcoes');
  }
});

test('dist/funcoes: um arquivo autocontido por função (só o import jsr do supabase-js) com o motor do site', () => {
  const motor = readFileSync(join(RAIZ, 'js', 'relatorio-motor.js'), 'utf8');
  for (const nome of funcoes()) {
    const txt = readFileSync(join(RAIZ, 'dist', 'funcoes', nome, 'index.ts'), 'utf8');
    assert.ok(txt.startsWith('// @ts-nocheck\n'), nome);
    const imports = txt.split('\n').filter((l) => /^\s*import\s/.test(l) || /^\s*export\s/.test(l));
    assert.deepEqual(imports, [IMPORT_SUPABASE], nome);
    assert.ok(!/from\s+['"]\.\.?\//.test(txt), nome + ' sem imports relativos');
    if (!VENDAS.includes(nome)) assert.ok(txt.includes(motor.trim()), nome + ' embute js/relatorio-motor.js');
    else assert.ok(!txt.includes('DISC_RELATORIO'), nome + ' não precisa do motor');
    assert.ok(txt.includes('Deno.serve('), nome);
    assert.ok(!/pk_[A-Za-z0-9]|sk-ant-|\$aact_|\bre_[A-Za-z0-9]{20,}|service_role\s*[:=]\s*['"]ey/.test(txt), nome + ' sem segredos');
  }
});

/** Carrega dist/funcoes/<nome>/index.ts num módulo temporário e devolve o handler do Deno.serve. */
async function carregarFuncao(nome, dir, ambiente) {
  const txt = readFileSync(join(RAIZ, 'dist', 'funcoes', nome, 'index.ts'), 'utf8')
    .replace(IMPORT_SUPABASE, 'const { createClient } = globalThis.__supabaseFalso;');
  const arq = join(dir, nome + '-' + Math.random().toString(36).slice(2) + '.mjs');
  writeFileSync(arq, txt);
  let handler = null;
  globalThis.__supabaseFalso = ambiente.supabase;
  globalThis.Deno = { serve: (h) => { handler = h; }, env: { get: (n) => ambiente.env[n] } };
  globalThis.fetch = ambiente.fetch;
  await import(pathToFileURL(arq).href);
  assert.equal(typeof handler, 'function', nome + ' chamou Deno.serve');
  return handler;
}

test('ponta a ponta com dist/: disc-sync -> admin (rascunho, publicar) -> webhook, sobre supabase-js falso', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'funcoes-disc-'));
  const fetchOriginal = globalThis.fetch;
  t.after(() => { rmSync(dir, { recursive: true, force: true }); globalThis.fetch = fetchOriginal; delete globalThis.Deno; delete globalThis.__supabaseFalso; });

  const cuFalso = gas.criarClickUpFalso({ listas: { L1: gas.listaExemplo() } });
  const payload = fixtures.payloadValido({ id: 'ana-envio-001', nome: 'Ana Paula Souza', telefone: '11988881111' });
  const sb = criarSupabaseFalso({
    tabelas: {
      processos: [linhaProcesso()],
      respostas: [{ id: 'ana-envio-001', processo_id: UUID_PROC, avaliacao: 'RCP2', nome: 'Ana Paula Souza', telefone: '5511988881111',
        respostas: payload.respostas, validacao: null, protocolo: '47K', clickup_sync: null, recebido_em: '2026-10-05T10:00:00Z' }],
      relatorios: [],
      admins: [{ user_id: UUID_ADMIN, nome: 'Dona do Sistema', criado_em: '2026-09-01T00:00:00Z' }],
      configuracoes: []
    },
    usuarios: [{ id: UUID_ADMIN, email: 'dona@empresa.com' }, { id: 'aaaaaaaa-0000-4000-8000-000000000009', email: 'x@y.com' }],
    jwts: { 'jwt-dona': UUID_ADMIN, 'jwt-x': 'aaaaaaaa-0000-4000-8000-000000000009' }
  });
  const ambiente = {
    supabase: sb,
    fetch: criarFetch(cuFalso),
    env: { SUPABASE_URL: 'https://falso.supabase.co', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service',
      CLICKUP_TOKEN: TOKEN_CU, SITE_URL: SITE, CLICKUP_WEBHOOK_SECRET: 'segredo' }
  };
  const sync = await carregarFuncao('disc-sync', dir, ambiente);
  const admin = await carregarFuncao('admin', dir, ambiente);
  const webhook = await carregarFuncao('clickup-webhook', dir, ambiente);
  const post = async (h, corpo, cab) => {
    const r = await h(new Request('https://falso.supabase.co/functions/v1/x', { method: 'POST', headers: Object.assign({ origin: SITE }, cab), body: JSON.stringify(corpo) }));
    return { status: r.status, json: await r.json(), cors: r.headers.get('access-control-allow-origin') };
  };

  // 1. candidato: disc-sync grava no ClickUp e marca clickup_sync (filtro .or() da reserva atômica)
  assert.deepEqual((await post(sync, { id: 'ana-envio-001' }, { authorization: 'Bearer anon' })).json, { ok: true });
  assert.equal(sb.st.tabelas.respostas[0].clickup_sync.estado, 'ok');
  assert.equal(cuFalso.listas.L1.tarefas.find((t) => t.id === 't1').valores.f_dCod, '47K');

  // 2. painel: chave pública não é sessão; usuário comum sem permissão; admin gera e publica
  assert.equal((await post(admin, { acao: 'clickup.status' }, { authorization: 'Bearer anon' })).json.sessaoExpirada, true);
  assert.equal((await post(admin, { acao: 'clickup.status' }, { authorization: 'Bearer jwt-x' })).json.erro, 'Sem permissão.');
  const st = await post(admin, { acao: 'clickup.status' }, { authorization: 'Bearer jwt-dona' });
  assert.equal(st.json.conectado, true);
  assert.equal(st.cors, SITE);
  const d = (await post(admin, { acao: 'processo.dados', id: UUID_PROC }, { authorization: 'Bearer jwt-dona' })).json;
  assert.equal(d.ok, true, d.erro);
  assert.equal(d.candidatos[0].disc.protocolo, '47K', 'resposta do banco casada pelo WhatsApp');
  const r = (await post(admin, { acao: 'relatorio.rascunho', processoId: UUID_PROC }, { authorization: 'Bearer jwt-dona' })).json;
  assert.equal(r.ok, true, r.erro);
  const p = (await post(admin, { acao: 'relatorio.publicar', relatorioToken: r.token }, { authorization: 'Bearer jwt-dona' })).json;
  assert.equal(p.url, SITE + '/relatorio.html?r=' + r.token);
  assert.equal(sb.st.tabelas.relatorios[0].status, 'publicado');
  const u = (await post(admin, { acao: 'usuarios.convidar', email: 'nova@empresa.com', nome: 'Nova Pessoa' }, { authorization: 'Bearer jwt-dona' })).json;
  assert.equal(u.ok, true, u.erro);
  assert.deepEqual(sb.st.convites[0], { email: 'nova@empresa.com', opcoes: { data: { nome: 'Nova Pessoa' }, redirectTo: SITE + '/admin.html' } });

  // 3. ClickUp: webhook assinado gera outro rascunho
  const evento = JSON.stringify({ event: 'taskStatusUpdated', task_id: 'tb', history_items: [{ field: 'status', after: { status: 'gerar relatório' } }] });
  const w = await webhook(new Request('https://x/', { method: 'POST', headers: { 'x-signature': createHmac('sha256', 'segredo').update(evento).digest('hex') }, body: evento }));
  assert.equal(w.status, 200);
  // (o rascunho do painel foi publicado; o do webhook é novo)
  assert.equal(sb.st.tabelas.relatorios.filter((x) => x.status === 'rascunho').length, 1);
  assert.equal(cuFalso.listas.L1.tarefas.find((t) => t.id === 'tb').status, 'relatório em revisão');
});

test('adaptador do banco: respostas do processo por processo_id ou código; reserva respeita a trava', async () => {
  const sb = criarSupabaseFalso({ tabelas: { processos: [linhaProcesso()], respostas: [
    { id: 'a', processo_id: UUID_PROC, avaliacao: 'RCP2', recebido_em: '2', clickup_sync: null },
    { id: 'b', processo_id: null, avaliacao: 'RCP2', recebido_em: '1', clickup_sync: { estado: 'ok', ok: true, em: '2000-01-01T00:00:00.000Z' } },
    { id: 'c', processo_id: null, avaliacao: 'OUTR', recebido_em: '3', clickup_sync: { estado: 'sincronizando', em: '2026-10-05T11:59:00.000Z' } }
  ], relatorios: [], admins: [], configuracoes: [] } });
  const db = criarDb(sb.createClient('u', 'service'));
  assert.deepEqual((await db.respostasDoProcesso({ id: UUID_PROC, codigo: 'RCP2' })).map((x) => x.id), ['b', 'a']);
  assert.equal(await db.processoPorId('nao-uuid'), null);
  assert.equal((await db.processoPorId(UUID_PROC)).codigo, 'RCP2');
  assert.equal((await db.processoPorLista('L1')).id, UUID_PROC);
  const marca = { estado: 'sincronizando', ok: false, em: '2026-10-05T12:00:00.000Z' };
  assert.equal(await db.reservarSync('a', marca, '2026-10-05T11:55:00.000Z'), true);
  assert.equal(await db.reservarSync('a', marca, '2026-10-05T11:55:00.000Z'), false, 'já reservada');
  assert.equal(await db.reservarSync('b', marca, '2026-10-05T11:55:00.000Z'), false, 'já sincronizada');
  assert.equal(await db.reservarSync('c', marca, '2026-10-05T11:55:00.000Z'), false, 'trava recente');
  assert.equal(await db.reservarSync('c', marca, '2026-10-05T12:30:00.000Z'), true, 'trava velha');
  await db.configGravar('k', 'v1');
  await db.configGravar('k', 'v2');
  assert.equal(await db.configLer('k'), 'v2');
  assert.equal(await db.configLer('nada'), null);
});

test('ponta a ponta com dist/: pagamento (criar) -> asaas-webhook (pago) sobre supabase-js falso', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'funcoes-vendas-'));
  const fetchOriginal = globalThis.fetch;
  t.after(() => { rmSync(dir, { recursive: true, force: true }); globalThis.fetch = fetchOriginal; delete globalThis.Deno; delete globalThis.__supabaseFalso; });
  const ID = '0b6f7f1e-8a7d-4c1b-9a50-2a8c7c1d0e01';
  const TOKEN = 'c'.repeat(64);
  const sb = criarSupabaseFalso({ tabelas: { pedidos: [{ id: ID, pacote: 'completo', valor_centavos: 2900, status: 'aguardando', metodo: '',
    asaas_cobranca_id: null, pagamento: null, email: 'bia@x.com', nome: 'Bia Lima', token_acesso: TOKEN, verificado_em: null }], limites_vendas: [] } });
  const vistos = [];
  const fetchFalso = async (url, o) => {
    vistos.push(String(url));
    const r = (c) => new Response(JSON.stringify(c), { status: 200 });
    if (String(url).endsWith('/customers')) return r({ id: 'cus_1' });
    if (String(url).endsWith('/payments')) return r({ id: 'pay_1', invoiceUrl: 'https://sandbox.asaas.com/i/pay_1', status: 'PENDING' });
    if (String(url).endsWith('/pixQrCode')) return r({ encodedImage: 'QR', payload: 'PIX', expirationDate: '2099-01-01 23:59:59' });
    throw new Error('inesperado ' + url);
  };
  const ambiente = { supabase: sb, fetch: fetchFalso, env: { SUPABASE_URL: 'https://falso.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service',
    SITE_URL: SITE, ASAAS_API_KEY: 'k', ASAAS_WEBHOOK_TOKEN: 'w' } };
  const pagamento = await carregarFuncao('pagamento', dir, ambiente);
  const webhook = await carregarFuncao('asaas-webhook', dir, ambiente);
  const c = await pagamento(new Request('https://x/', { method: 'POST', headers: { origin: SITE }, body: JSON.stringify({ acao: 'criar', pedidoId: ID, tokenAcesso: TOKEN }) }));
  assert.deepEqual(await c.json(), { ok: true, provedor: 'asaas', pix: { qrBase64: 'QR', copiaECola: 'PIX', expira: '2099-01-01 23:59:59' },
    cartaoUrl: 'https://sandbox.asaas.com/i/pay_1', valor: 2900, vencimento: c.ok ? sb.st.tabelas.pedidos[0].pagamento.vencimento : '' });
  assert.ok(vistos.every((u) => u.startsWith('https://api-sandbox.asaas.com/v3/')), 'sandbox por padrão');
  const ev = JSON.stringify({ event: 'PAYMENT_RECEIVED', payment: { id: 'pay_1', externalReference: ID, value: 29, billingType: 'PIX' } });
  const w = await webhook(new Request('https://x/', { method: 'POST', headers: { 'asaas-access-token': 'w' }, body: ev }));
  assert.equal(w.status, 200);
  assert.equal(sb.st.tabelas.pedidos[0].status, 'pago');
});

test('ponta a ponta com dist/: pagamento (criar link InfinitePay) -> infinitepay-webhook (confere e marca pago)', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'funcoes-infinitepay-'));
  const fetchOriginal = globalThis.fetch;
  t.after(() => { rmSync(dir, { recursive: true, force: true }); globalThis.fetch = fetchOriginal; delete globalThis.Deno; delete globalThis.__supabaseFalso; });
  const ID = '0b6f7f1e-8a7d-4c1b-9a50-2a8c7c1d0e03';
  const TOKEN = 'd'.repeat(64);
  const sb = criarSupabaseFalso({ tabelas: { pedidos: [{ id: ID, pacote: 'completo', valor_centavos: 2900, status: 'aguardando', metodo: '',
    asaas_cobranca_id: null, pagamento: null, email: 'bia@x.com', nome: 'Bia Lima', token_acesso: TOKEN, verificado_em: null,
    provedor: null, provedor_ref: null, checkout_url: null, provedor_dados: null }], limites_vendas: [] } });
  let pago = false;
  const vistos = [];
  const fetchFalso = async (url, o) => {
    vistos.push({ url: String(url), corpo: JSON.parse(o.body) });
    const r = (c) => new Response(JSON.stringify(c), { status: 200 });
    if (String(url) === 'https://api.checkout.infinitepay.io/links') return r({ url: 'https://checkout.infinitepay.io/notus/x' });
    if (String(url) === 'https://api.checkout.infinitepay.io/payment_check') return r({ success: true, paid: pago, amount: 2900, paid_amount: 2900, capture_method: 'pix' });
    throw new Error('inesperado ' + url);
  };
  const ambiente = { supabase: sb, fetch: fetchFalso, env: { SUPABASE_URL: 'https://falso.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service',
    SITE_URL: SITE, INFINITEPAY_HANDLE: 'notus', ASAAS_API_KEY: 'k' } };
  const pagamento = await carregarFuncao('pagamento', dir, ambiente);
  const webhook = await carregarFuncao('infinitepay-webhook', dir, ambiente);
  const c = await pagamento(new Request('https://x/', { method: 'POST', headers: { origin: SITE }, body: JSON.stringify({ acao: 'criar', pedidoId: ID, tokenAcesso: TOKEN }) }));
  assert.deepEqual(await c.json(), { ok: true, provedor: 'infinitepay', redirecionarUrl: 'https://checkout.infinitepay.io/notus/x', valor: 2900 });
  assert.equal(vistos[0].corpo.items[0].price, 2900);
  const corpo = JSON.stringify({ order_nsu: ID, transaction_nsu: 'TX1', invoice_slug: 'S1', paid_amount: 2900, capture_method: 'pix' });
  const w1 = await webhook(new Request('https://x/', { method: 'POST', body: corpo }));
  assert.equal(w1.status, 200);
  assert.equal(sb.st.tabelas.pedidos[0].status, 'aguardando', 'sem confirmação do payment_check não libera');
  pago = true;
  const w2 = await webhook(new Request('https://x/', { method: 'POST', body: corpo }));
  assert.deepEqual([w2.status, (await w2.json()).motivo], [200, 'pago']);
  assert.equal(sb.st.tabelas.pedidos[0].status, 'pago');
});
