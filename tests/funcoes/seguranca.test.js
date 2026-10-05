// Segurança das Edge Functions (QA final): termos sensíveis nunca chegam ao relatório, autenticador
// recusa chave pública/JWT inválido/não admin, e erros internos não vazam segredos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { gas, criarFetch, criarDbFalso, criarAuthAdminFalso, linhaProcesso, UUID_ADMIN, UUID_PROC, TOKEN_CU } from './apoio.js';
import { atenderAdmin } from '../../supabase/funcoes-compartilhadas/http.js';
import { criarAutenticador } from '../../supabase/funcoes-compartilhadas/supabase-adaptadores.js';
import { DISC_RELATORIO, DISC_CONFIABILIDADE } from '../../supabase/funcoes-compartilhadas/motores-gerado.js';

const SITE = 'https://disc.gestaosemcaos.com.br';
const SERVICE_KEY = 'eyJ-service-role-secreta';

function base(op) {
  op = op || {};
  const cuFalso = gas.criarClickUpFalso({ listas: { L1: gas.listaExemplo() } });
  const db = criarDbFalso({
    processos: [linhaProcesso({ config: op.config || gas.configExemplo() })],
    admins: [{ user_id: UUID_ADMIN, nome: 'Dona', criado_em: '2026-09-01T00:00:00Z' }]
  });
  return {
    db,
    b: {
      env: { CLICKUP_TOKEN: TOKEN_CU, SITE_URL: SITE + '/', SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, ANTHROPIC_API_KEY: 'sk-ant-segredo' },
      fetch: criarFetch(cuFalso), db, authAdmin: criarAuthAdminFalso([{ id: UUID_ADMIN, email: 'dona@x.com' }]),
      dormir: async () => {}, agora: () => Date.parse('2026-10-05T12:00:00Z'),
      motor: DISC_RELATORIO, confiabilidade: DISC_CONFIABILIDADE,
      autenticar: async () => ({ usuario: { id: UUID_ADMIN, email: 'dona@x.com' }, eAdmin: true })
    }
  };
}

async function chamar(b, corpo) {
  const r = await atenderAdmin(new Request('https://x/functions/v1/admin', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer jwt', origin: SITE },
    body: JSON.stringify(corpo)
  }), b);
  return { texto: await r.clone().text(), json: await r.json() };
}

test('relatório: campos sensíveis do ClickUp nunca entram, mesmo com config gravada direto no banco', async () => {
  // Config "envenenada" (como se alguém gravasse com a service role, sem o gatilho do banco):
  // etapa e bônus apontando para campos sensíveis + antecedentes liberados.
  const config = gas.configExemplo({
    permitirAntecedentes: true,
    etapas: [
      { id: 'civil', nome: 'Civil', peso: 50, campo: 'Estado Civil', descricao: '' },
      { id: 'entrevista', nome: 'Entrevista', peso: 50, campo: 'Entrevista', descricao: '' }
    ],
    bonus: [
      { id: 'saude', nome: 'Saúde', campo: 'Problema de saúde', regra: { tipo: 'checkbox', pontos: 3 } },
      { id: 'sexo', nome: 'Sexo', campo: 'Sexo', regra: { tipo: 'checkbox', pontos: 3 } }
    ]
  });
  const { b, db } = base({ config });
  const r = await chamar(b, { acao: 'relatorio.rascunho', processoId: UUID_PROC });
  assert.equal(r.json.ok, true, r.json.erro);
  const guardado = JSON.stringify(db.st.relatorios[0].dados);
  for (const proibido of ['Casada', 'Asma', 'Nada consta', 'Feminino', 'Ana Paula Souza', 'Bruno Lima Castro',
    '98888', 'ana@exemplo.com', '"L1"', 'clickupListId']) {
    assert.ok(!guardado.includes(proibido), 'relatório guardado contém ' + proibido);
    assert.ok(!r.texto.includes(proibido), 'resposta contém ' + proibido);
  }
  assert.ok(/Ana S\.|Bruno C\.|Carla D\./.test(guardado), 'nomes curtos presentes: ' + guardado.substring(0, 300));
  // (config inválida por campo sensível é trocada inteira pela padrão em configDoProcesso: nada sensível é lido)
});

test('erro interno não vaza segredos nem detalhes', async () => {
  const { b } = base();
  b.db.processoPorId = async () => { throw new Error('falha com ' + SERVICE_KEY + ' e ' + TOKEN_CU); };
  const r = await chamar(b, { acao: 'processo.dados', id: UUID_PROC });
  assert.equal(r.json.ok, false);
  for (const s of [SERVICE_KEY, TOKEN_CU, 'sk-ant-segredo']) assert.ok(!r.texto.includes(s), 'vazou ' + s);
  const st = await chamar(b, { acao: 'clickup.status' });
  for (const s of [SERVICE_KEY, TOKEN_CU, 'sk-ant-segredo']) assert.ok(!st.texto.includes(s), 'status vazou ' + s);
});

test('autenticador: sem Bearer, chave pública, JWT recusado pelo Auth ou e_admin falhando -> não admin', async () => {
  const env = { SUPABASE_URL: 'https://p.supabase.co', SUPABASE_ANON_KEY: 'anon-publica' };
  let usuarioOk = true;
  let eAdmin = { data: true, error: null };
  const vistos = [];
  const createClient = (url, chave, op) => {
    vistos.push({ url, chave, auth: op.global.headers.Authorization });
    return {
      auth: { getUser: async (jwt) => (usuarioOk && jwt === 'jwt-bom' ? { data: { user: { id: 'u1', email: 'a@b.c' } }, error: null } : { data: null, error: { message: 'invalid' } }) },
      rpc: async (nome) => { assert.equal(nome, 'e_admin'); return eAdmin; }
    };
  };
  const autenticar = criarAutenticador(createClient, env);
  assert.equal(await autenticar(''), null);
  assert.equal(await autenticar('Basic abc'), null);
  assert.equal(await autenticar('Bearer anon-publica'), null);
  assert.equal(await autenticar('Bearer jwt-ruim'), null);
  assert.deepEqual(await autenticar('Bearer jwt-bom'), { usuario: { id: 'u1', email: 'a@b.c' }, eAdmin: true });
  eAdmin = { data: null, error: { message: 'permission denied' } };
  assert.equal((await autenticar('Bearer jwt-bom')).eAdmin, false);
  eAdmin = { data: 'true', error: null };
  assert.equal((await autenticar('Bearer jwt-bom')).eAdmin, false, 'só true booleano vale');
  // O cliente do usuário usa a chave pública + o JWT dele (nunca a service role).
  assert.ok(vistos.every((v) => v.chave === 'anon-publica' && v.auth === 'Bearer ' + (v.auth.split(' ')[1])));
});
