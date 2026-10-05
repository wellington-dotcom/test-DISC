'use strict';
// Cliente Supabase (js/api-supabase.js) com um supabase-js FALSO injetado: nada sai da máquina.
// Confere que ele implementa os mesmos métodos e formatos de resposta do DISC_API (js/api.js / Code.gs).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const SB = require('../js/api-supabase.js');
const API = require('../js/api.js');
const S = require('../js/scoring.js');
const { payloadValido } = require('./helpers/fixtures.js');

const UID = '11111111-1111-4111-8111-111111111111';
const PID = '22222222-2222-4222-8222-222222222222';
const URL_SB = 'https://exemplo.supabase.co';

// ---------------------------------------------------------------------------
// supabase-js falso: auth, rpc, from() (PostgREST mínimo com embutidos) e functions.invoke
// ---------------------------------------------------------------------------
function libFalsa(opcoes) {
  opcoes = opcoes || {};
  const estado = {
    criados: [], chamadas: [], invocacoes: [], sessao: opcoes.sessao === undefined ? null : opcoes.sessao,
    senhas: Object.assign({ 'dona@empresa.com': 'senha-forte-1' }, opcoes.senhas || {}),
    admins: opcoes.admins || [{ user_id: UID, nome: 'Dona do Sistema', criado_em: '2026-10-01T10:00:00+00:00' }],
    tabelas: {
      processos: opcoes.processos || [],
      respostas: opcoes.respostas || [],
      pessoas: opcoes.pessoas || [],
      empresas: opcoes.empresas || [],
      vinculos: opcoes.vinculos || [],
      relacoes: opcoes.relacoes || [],
      relatorios: opcoes.relatorios || [],
      pedidos: opcoes.pedidos || [],
      cupons: opcoes.cupons || [],
      pacotes: opcoes.pacotes || []
    },
    rpc: opcoes.rpc || {},
    funcoes: opcoes.funcoes || {},
    erroAuth: opcoes.erroAuth || null,
    falhaRede: false
  };
  estado.tabelas.admins = estado.admins;

  function sessaoDe(email) {
    return { access_token: 'jwt-' + email, refresh_token: 'r', user: { id: UID, email, user_metadata: { nome: '' } } };
  }

  function linhaComEmbutidos(tabela, linha, colunas) {
    const r = Object.assign({}, linha);
    if (/respostas\(count\)/.test(colunas)) r.respostas = [{ count: estado.tabelas.respostas.filter((x) => x.processo_id === linha.id).length }];
    if (/processos\(/.test(colunas) && tabela === 'respostas') {
      const p = estado.tabelas.processos.find((x) => x.id === linha.processo_id);
      r.processos = p ? { nome: p.nome, tipo: p.tipo, empresa: p.empresa, codigo: p.codigo } : null;
    }
    if (/pessoas\(/.test(colunas) && tabela === 'respostas') {
      const pe = estado.tabelas.pessoas.find((x) => x.id === linha.pessoa_id);
      r.pessoas = pe ? Object.assign({}, pe) : null;
    }
    if (/pessoas\(/.test(colunas) && tabela === 'vinculos') {
      const pe = estado.tabelas.pessoas.find((x) => x.id === linha.pessoa_id);
      r.pessoas = pe ? Object.assign({}, pe) : null;
      if (pe && /respostas\(/.test(colunas)) r.pessoas.respostas = estado.tabelas.respostas.filter((x) => x.pessoa_id === pe.id);
    }
    if (/titulo:dados->>titulo/.test(colunas)) { r.titulo = linha.dados && linha.dados.titulo; delete r.dados; }
    return r;
  }

  function construtor(tabela) {
    const q = { tabela, op: 'select', filtros: [], colunas: '*', dados: null, intervalo: null, unico: false, retornar: false };
    const b = {
      select(c) { if (q.op === 'select') q.colunas = c || '*'; else { q.retornar = true; q.colunas = c || '*'; } return b; },
      insert(d) { q.op = 'insert'; q.dados = d; return b; },
      update(d) { q.op = 'update'; q.dados = d; return b; },
      delete() { q.op = 'delete'; return b; },
      eq(c, v) { q.filtros.push((l) => l[c] === v); q.eqs = (q.eqs || []).concat([[c, v]]); return b; },
      neq(c, v) { q.filtros.push((l) => l[c] !== v); return b; },
      gte(c, v) { q.filtros.push((l) => String(l[c]) >= String(v)); q.eqs = (q.eqs || []).concat([[c, '>=' + v]]); return b; },
      lt(c, v) { q.filtros.push((l) => String(l[c]) < String(v)); q.eqs = (q.eqs || []).concat([[c, '<' + v]]); return b; },
      upsert(d, o) { q.op = 'upsert'; q.dados = d; q.conflito = o && o.onConflict; return b; },
      order(c) { q.ordem = c; return b; },
      range(a, z) { q.intervalo = [a, z]; return b; },
      limit(n) { q.limite = n; return b; },
      maybeSingle() { q.unico = true; return b; },
      then(ok, nok) { return Promise.resolve().then(() => executar(q)).then(ok, nok); }
    };
    return b;
  }

  function executar(q) {
    estado.chamadas.push({ tabela: q.tabela, op: q.op, dados: q.dados, eqs: q.eqs || [], colunas: q.colunas });
    if (estado.falhaRede) throw new TypeError('Failed to fetch');
    if (!estado.sessao) return { data: q.op === 'select' ? [] : [], error: null }; // RLS: anon não vê nada
    if (opcoes.erroBanco && opcoes.erroBanco[q.tabela + '.' + q.op]) return { data: null, error: opcoes.erroBanco[q.tabela + '.' + q.op] };
    // Banco antigo: tabela ou coluna que ainda não existe (opcoes.faltando = ['empresas', 'respostas.foto', ...]).
    if (opcoes.faltando) {
      if (opcoes.faltando.includes(q.tabela)) return { data: null, error: { code: 'PGRST205', message: 'Could not find the table' } };
      const cols = String(q.colunas).split(',').map((c) => c.trim());
      if (cols.some((c) => opcoes.faltando.includes(q.tabela + '.' + c))) return { data: null, error: { code: '42703', message: 'column does not exist' } };
    }
    const linhas = estado.tabelas[q.tabela];
    const casa = (l) => q.filtros.every((f) => f(l));
    let res;
    if (q.op === 'select') {
      res = linhas.filter(casa);
      if (q.ordem) res = res.slice().sort((a, b) => String(a[q.ordem]).localeCompare(String(b[q.ordem])));
      if (q.intervalo) res = res.slice(q.intervalo[0], q.intervalo[1] + 1);
      if (q.limite !== undefined) res = res.slice(0, q.limite);
    } else if (q.op === 'insert') {
      const nova = Object.assign({ id: '33333333-3333-4333-8333-33333333333' + linhas.length, codigo: 'K7QZ', criado_em: '2026-10-05T12:00:00+00:00' },
        q.tabela === 'relatorios' ? { token: 'f'.repeat(63) + linhas.length } : {}, q.dados);
      linhas.push(nova);
      res = [nova];
    } else if (q.op === 'upsert') {
      const atual = linhas.find((l) => l[q.conflito] === q.dados[q.conflito]);
      if (atual) Object.assign(atual, q.dados); else linhas.push(Object.assign({ usos: 0, criado_em: '2026-10-05T12:00:00+00:00' }, q.dados));
      res = [atual || linhas[linhas.length - 1]];
        } else if (q.op === 'update') {
      res = linhas.filter(casa);
      res.forEach((l) => Object.assign(l, q.dados));
    } else {
      res = linhas.filter(casa);
      estado.tabelas[q.tabela] = linhas.filter((l) => !casa(l));
      if (q.tabela === 'admins') estado.admins = estado.tabelas.admins;
    }
    res = res.map((l) => linhaComEmbutidos(q.tabela, l, q.colunas));
    if (q.unico) return { data: res[0] || null, error: null };
    return { data: res, error: null };
  }

  const lib = {
    estado,
    createClient(url, chave, op) {
      estado.criados.push({ url, chave, op });
      return {
        auth: {
          async signInWithPassword({ email, password }) {
            estado.chamadas.push({ auth: 'signIn', email });
            if (estado.erroAuth) return { data: {}, error: estado.erroAuth };
            if (estado.senhas[email] !== password) return { data: { session: null }, error: { name: 'AuthApiError', status: 400, code: 'invalid_credentials', message: 'Invalid login credentials' } };
            estado.sessao = sessaoDe(email);
            return { data: { session: estado.sessao, user: estado.sessao.user }, error: null };
          },
          async signOut() { estado.sessao = null; return { error: null }; },
          async getSession() { return { data: { session: estado.sessao }, error: null }; },
          async updateUser(d) {
            estado.chamadas.push({ auth: 'updateUser', d });
            if (!estado.sessao) return { data: {}, error: { name: 'AuthSessionMissingError', status: 400, message: 'Auth session missing!' } };
            if (d.password) estado.senhas[estado.sessao.user.email] = d.password;
            return { data: { user: estado.sessao.user }, error: null };
          },
          async resetPasswordForEmail(email, op) { estado.chamadas.push({ auth: 'reset', email, op }); return { data: {}, error: null }; }
        },
        async rpc(nome, args) {
          estado.chamadas.push({ rpc: nome, args });
          if (estado.falhaRede) throw new TypeError('Failed to fetch');
          if (estado.rpc[nome]) return estado.rpc[nome](args, estado);
          if (nome === 'garantir_primeiro_admin') {
            const eh = estado.admins.some((a) => estado.sessao && a.user_id === estado.sessao.user.id);
            return { data: { ok: true, admin: eh }, error: null };
          }
          if (nome === 'e_admin') return { data: estado.admins.some((a) => estado.sessao && a.user_id === estado.sessao.user.id), error: null };
          return { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };
        },
        from: (t) => construtor(t),
        functions: {
          async invoke(nome, op) {
            estado.invocacoes.push({ nome, body: op && op.body, comSessao: !!estado.sessao });
            if (estado.funcoes[nome]) return estado.funcoes[nome](op.body, estado);
            return { data: { ok: true }, error: null };
          }
        }
      };
    }
  };
  return lib;
}

function nova(opcoes, extra) {
  const lib = libFalsa(opcoes);
  const api = SB.criar(Object.assign({ supabase: lib, url: URL_SB, chave: 'anon-publica', scoring: S, timeoutMs: 1000, timeoutLongoMs: 1000 }, extra || {}));
  return { api, lib, e: lib.estado };
}
async function logado(opcoes, extra) {
  const x = nova(opcoes, extra);
  const r = await x.api.login('dona@empresa.com', 'senha-forte-1');
  return Object.assign(x, { T: r.token, login: r });
}

function processo(extra) {
  return Object.assign({
    id: PID, codigo: 'SEL1', nome: 'Recepcionista 2026', tipo: 'selecao', empresa: 'Clínica Exemplo', vaga: 'Recepção',
    cidade: 'Campinas', consultor: 'Ana', contratante: 'Dr. Paulo', periodo_inicio: '2026-10-01', periodo_fim: null,
    clickup_list_id: '900000000001', config: { perfilIdeal: 'SC', corte: 70 }, mostrar_resultado: false, ativo: true,
    criado_em: '2026-10-01T10:00:00+00:00'
  }, extra || {});
}
function resposta(extra) {
  const p = payloadValido();
  return Object.assign({
    id: p.id, processo_id: PID, avaliacao: 'SEL1', protocolo: '47K', recebido_em: '2026-10-01T12:10:02.5+00:00',
    nome: p.nome, telefone: p.telefone, idade: 30, vaga: p.vaga, funcao: p.funcao, empresa: p.empresa,
    inicio: '2026-10-01T12:00:00+00:00', fim: '2026-10-01T12:10:00+00:00', duracao_seg: 600, respostas: p.respostas,
    d: 40, i: 30, s: 20, c: 10, perfil: 'DI', validacao: null, status: 'em_analise', observacoes: '', payload: p, clickup_sync: null
  }, extra || {});
}

// ---------------------------------------------------------------------------

test('implementa todos os métodos do DISC_API (mesmos nomes) e os extras do Supabase', () => {
  const { api } = nova();
  assert.deepEqual(SB.METODOS, API.METODOS);
  API.METODOS.concat(SB.EXTRAS).forEach((m) => assert.equal(typeof api[m], 'function', m));
});

test('instalar: só com BACKEND "supabase" e URL/chave; troca os métodos no mesmo objeto', () => {
  const lib = libFalsa();
  const alvo = Object.assign({}, API);
  assert.equal(SB.instalar(alvo, { BACKEND: 'appsscript', SUPABASE_URL: URL_SB, SUPABASE_ANON_KEY: 'k' }, { supabase: lib }), null);
  assert.equal(SB.instalar(alvo, { BACKEND: 'supabase', SUPABASE_URL: '', SUPABASE_ANON_KEY: 'k' }, { supabase: lib }), null);
  assert.equal(alvo.enviar, API.enviar);
  const inst = SB.instalar(alvo, { BACKEND: 'supabase', SUPABASE_URL: URL_SB + '/', SUPABASE_ANON_KEY: 'k' }, { supabase: lib });
  assert.ok(inst);
  assert.notEqual(alvo.enviar, API.enviar);
  assert.equal(alvo.backend, 'supabase');
  assert.equal(alvo.configurado(), true);
  assert.equal(typeof alvo.recuperarSenha, 'function');
  assert.equal(lib.estado.criados.length, 0, 'cliente só é criado na primeira chamada');
  inst.cliente();
  assert.equal(lib.estado.criados[0].url, URL_SB);
  assert.equal(lib.estado.criados[0].op.auth.flowType, 'implicit');
  assert.equal(lib.estado.criados[0].op.auth.detectSessionInUrl, true);
});

test('config.js: site em produção usa o Supabase do projeto, só com a chave pública', () => {
  const cfg = require('../js/config.js');
  assert.equal(cfg.BACKEND, 'supabase');
  assert.match(cfg.SUPABASE_URL, /^https:\/\/[a-z0-9]{20}\.supabase\.co$/);
  assert.match(cfg.SUPABASE_ANON_KEY, /^(sb_publishable_|eyJ)/, 'só a chave pública pode ficar no site');
  assert.doesNotMatch(cfg.SUPABASE_ANON_KEY, /^sb_secret_/);
  assert.equal(cfg.API_URL, cfg.SUPABASE_URL);
});

test('páginas carregam assets/vendor/supabase.js e js/api-supabase.js depois de api.js/api-simulada.js', () => {
  ['index.html', 'relatorio.html'].forEach((f) => {
    const html = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    const s = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
    const i = s.indexOf('js/api.js');
    assert.equal(s[i + 1], 'js/api-simulada.js', f);
    assert.equal(s[i + 2], 'assets/vendor/supabase.js', f);
    assert.equal(s[i + 3], 'js/api-supabase.js', f);
  });
  const vendor = path.join(__dirname, '..', 'assets', 'vendor');
  assert.ok(fs.existsSync(path.join(vendor, 'supabase-js-LICENSE.txt')));
  const umd = fs.readFileSync(path.join(vendor, 'supabase.js'), 'utf8');
  assert.match(umd, /^var supabase=/);
  assert.doesNotMatch(umd, /\bimport\(/, 'sem import dinâmico (nada de CDN)');
});

test('enviar: RPC enviar_resposta com o payload, devolve {ok,id,protocolo} e chama disc-sync em segundo plano', async () => {
  const { api, e } = nova({ rpc: { enviar_resposta: (a) => ({ data: { ok: true, id: a.p_payload.id, protocolo: '47K' }, error: null }) } });
  const p = payloadValido();
  const r = await api.enviar(p);
  assert.deepEqual(r, { ok: true, id: p.id, protocolo: '47K' });
  assert.deepEqual(e.chamadas.find((c) => c.rpc).args, { p_payload: p });
  await new Promise((ok) => setTimeout(ok, 5));
  assert.deepEqual(e.invocacoes, [{ nome: 'disc-sync', body: { id: p.id }, comSessao: false }]);
});

test('enviar: duplicado mantém o formato do Code.gs; falha no disc-sync não afeta o candidato', async () => {
  const { api } = nova({
    rpc: { enviar_resposta: (a) => ({ data: { ok: true, duplicado: true, id: a.p_payload.id, protocolo: '47K' }, error: null }) },
    funcoes: { 'disc-sync': () => { throw new TypeError('Failed to fetch'); } }
  });
  const r = await api.enviar(payloadValido());
  assert.deepEqual(r, { ok: true, duplicado: true, id: 'lx1abc-teste01', protocolo: '47K' });
});

test('enviar: recusa do banco vira Error com erro.resposta; sem rede, mensagem de conexão', async () => {
  const x = nova({ rpc: { enviar_resposta: () => ({ data: { ok: false, erro: 'Este link de avaliação não está mais ativo.' }, error: null }) } });
  await assert.rejects(x.api.enviar(payloadValido()), (err) => {
    assert.equal(err.message, 'Este link de avaliação não está mais ativo.');
    assert.equal(err.sessaoExpirada, false);
    assert.deepEqual(err.resposta, { ok: false, erro: 'Este link de avaliação não está mais ativo.' });
    return true;
  });
  assert.equal(x.e.invocacoes.length, 0, 'sem gravação, sem disc-sync');
  const y = nova();
  y.e.falhaRede = true;
  await assert.rejects(y.api.enviar(payloadValido()), /Não foi possível conectar ao servidor/);
  await assert.rejects(y.api.enviar(null), /Nenhum resultado para enviar/);
});

test('avaliacaoPublica e relatorioPublico: formatos {ok, avaliacao} e {ok, relatorio, publicadoEm}', async () => {
  const { api, e } = nova({
    rpc: {
      avaliacao_publica: (a) => a.p_codigo === 'SEL1'
        ? { data: { ok: true, avaliacao: { codigo: 'SEL1', nome: 'Recepcionista', tipo: 'selecao', empresaNome: 'Clínica', mostrarResultado: false }, codigo: 'SEL1' }, error: null }
        : { data: { ok: false, erro: 'Link inválido ou avaliação encerrada. Fale com quem enviou o link.' }, error: null },
      relatorio_publico: (a) => ({ data: Object.assign({ ok: true, relatorio: { titulo: 'R' }, publicadoEm: '2026-10-05T12:00:00.000Z' },
        a.p_token === 'b'.repeat(64) ? { modelo: 'equipe' } : {}), error: null })
    }
  });
  assert.deepEqual(await api.avaliacaoPublica('SEL1'), { ok: true, avaliacao: { codigo: 'SEL1', nome: 'Recepcionista', tipo: 'selecao', empresaNome: 'Clínica', mostrarResultado: false,
    formulario: { campos: { idade: 'obrigatorio', funcao: 'opcional', empresa: 'opcional', email: 'oculto', cidade: 'oculto', foto: 'opcional' }, perguntas: [], parte2: 'desligada' } } });
  await assert.rejects(api.avaliacaoPublica('ZZZZ'), /Link inválido ou avaliação encerrada/);
  await assert.rejects(api.avaliacaoPublica(''), /Link inválido/);
  const t = 'a'.repeat(64);
  // banco antigo (sem "modelo") = relatório de processo
  assert.deepEqual(await api.relatorioPublico(t), { ok: true, modelo: 'processo', relatorio: { titulo: 'R' }, publicadoEm: '2026-10-05T12:00:00.000Z' });
  assert.equal((await api.relatorioPublico('b'.repeat(64))).modelo, 'equipe');
  assert.deepEqual(e.chamadas.filter((c) => c.rpc === 'relatorio_publico')[0].args, { p_token: t });
  await assert.rejects(api.relatorioPublico(''), /Relatório não encontrado ou fora do ar/);
});

test('login: signInWithPassword + garantir_primeiro_admin -> {ok, token, usuario admin}; senha errada genérica', async () => {
  const { api, e, login } = await logado();
  assert.equal(login.ok, true);
  assert.equal(login.token, 'jwt-dona@empresa.com');
  assert.deepEqual(login.usuario, { id: UID, nome: 'Dona do Sistema', email: 'dona@empresa.com', papel: 'admin', empresaId: '', empresaNome: '', foto: '' });
  assert.ok(e.chamadas.some((c) => c.rpc === 'garantir_primeiro_admin'));
  await assert.rejects(api.login('dona@empresa.com', 'errada'), /^Error: E-mail ou senha incorretos\.$/);
  await assert.rejects(api.login('', 'x'), /Informe o e-mail e a senha/);
});

test('login: o primeiro usuário vira admin (aviso); quem não é admin entra com papel vazio (o painel recusa)', async () => {
  const primeiro = nova({ admins: [], rpc: { garantir_primeiro_admin: (a, est) => { est.admins.push({ user_id: UID, nome: 'Dona', criado_em: '' }); return { data: { ok: true, admin: true, primeiro: true }, error: null }; } } });
  const r = await primeiro.api.login('dona@empresa.com', 'senha-forte-1');
  assert.equal(r.usuario.papel, 'admin');
  assert.equal(r.primeiroAdmin, true);
  assert.match(r.aviso, /primeiro administrador/);
  const outro = nova({ admins: [{ user_id: 'outro', nome: 'X' }] });
  const r2 = await outro.api.login('dona@empresa.com', 'senha-forte-1');
  assert.equal(r2.usuario.papel, '');
});

test('login: limite de tentativas do Supabase vira a mensagem de bloqueio do Code.gs', async () => {
  const { api } = nova({ erroAuth: { name: 'AuthApiError', status: 429, code: 'over_request_rate_limit', message: 'Request rate limit reached' } });
  await assert.rejects(api.login('dona@empresa.com', 'x'), /Muitas tentativas\. Tente de novo em 15 minutos\./);
});

test('sem sessão guardada (ou sem token) os métodos rejeitam com sessaoExpirada', async () => {
  const { api } = nova();
  for (const chamada of [() => api.listar('tok'), () => api.eu('tok'), () => api.processosListar('tok'), () => api.clickupStatus('tok'), () => api.listar('')]) {
    await assert.rejects(chamada(), (err) => { assert.equal(err.sessaoExpirada, true); assert.equal(err.message, 'Sessão expirada. Entre de novo.'); return true; });
  }
});

test('eu, sair e sessaoAtual', async () => {
  const { api, T, e } = await logado();
  assert.deepEqual(await api.eu(T), { ok: true, usuario: { id: UID, nome: 'Dona do Sistema', email: 'dona@empresa.com', papel: 'admin', empresaId: '', empresaNome: '', foto: '' } });
  const s = await api.sessaoAtual();
  assert.equal(s.token, T);
  assert.deepEqual(await api.sair(T), { ok: true });
  assert.equal(e.sessao, null);
  await assert.rejects(api.sessaoAtual(), (err) => err.sessaoExpirada === true);
});

test('trocarSenha confere a senha atual e valida a nova (mesmas mensagens do Code.gs)', async () => {
  const { api, T, e } = await logado();
  await assert.rejects(api.trocarSenha(T, 'senha-forte-1', 'curta'), /pelo menos 8 caracteres/);
  await assert.rejects(api.trocarSenha(T, 'errada', 'nova-senha-123'), /^Error: Senha atual incorreta\.$/);
  assert.deepEqual(await api.trocarSenha(T, 'senha-forte-1', 'nova-senha-123'), { ok: true });
  assert.equal(e.senhas['dona@empresa.com'], 'nova-senha-123');
});

test('primeiroAcesso e redefinirSenha explicam o jeito do Supabase', async () => {
  const { api, T } = await logado();
  await assert.rejects(api.primeiroAcesso('chave', 'Nome', 'a@b.com', 'senha123'), /Authentication > Users/);
  await assert.rejects(api.redefinirSenha(T, UID, 'senha123'), /Esqueci minha senha/);
});

test('recuperarSenha manda o link para admin.html; linkDeAcesso lê #type=recovery; definirNovaSenha entra', async () => {
  const local = { origin: 'https://disc.gestaosemcaos.com.br', pathname: '/admin.html', hash: '#access_token=abc&refresh_token=r&type=recovery', search: '' };
  const { api, e, lib } = nova({}, { local });
  assert.equal(lib.estado.criados.length, 1, 'com sessão no endereço o cliente nasce já (o supabase-js lê o #)');
  assert.deepEqual(api.linkDeAcesso(), { tipo: 'recovery', erro: '' });
  const r = await api.recuperarSenha(' Dona@Empresa.com ');
  assert.equal(r.ok, true);
  const reset = e.chamadas.find((c) => c.auth === 'reset');
  assert.equal(reset.email, 'dona@empresa.com');
  assert.deepEqual(reset.op, { redirectTo: 'https://disc.gestaosemcaos.com.br/admin.html' });
  await assert.rejects(api.recuperarSenha('nao-e-email'), /E-mail inválido/);

  await assert.rejects(api.definirNovaSenha('nova-senha-1'), /O link expirou ou já foi usado/);
  e.sessao = { access_token: 'jwt-rec', user: { id: UID, email: 'dona@empresa.com', user_metadata: {} } };
  await assert.rejects(api.definirNovaSenha('curta'), /pelo menos 8/);
  const ok = await api.definirNovaSenha('nova-senha-1');
  assert.equal(ok.usuario.papel, 'admin');
  assert.equal(e.senhas['dona@empresa.com'], 'nova-senha-1');
  assert.deepEqual(api.linkDeAcesso(), { tipo: '', erro: '' });

  assert.deepEqual(SB.lerLinkDeAcesso({ hash: '#error=access_denied&error_code=otp_expired', search: '' }).erro, 'O link expirou ou já foi usado. Peça outro em "Esqueci minha senha".');
  assert.equal(SB.lerLinkDeAcesso({ hash: '#access_token=x&type=invite', search: '' }).tipo, 'invite');
  assert.equal(SB.lerLinkDeAcesso({ hash: '#a-SEL1', search: '' }).tipo, '');
  assert.equal(SB.enderecoDoPainel({ origin: 'http://localhost:4173', pathname: '/sub/index.html' }), 'http://localhost:4173/sub/admin.html');
});

test('listar: itens no formato do Code.gs (resultado recalculado, processo embutido, datas ISO)', async () => {
  const PESSOA = '44444444-4444-4444-8444-444444444444';
  const { api, T, e } = await logado({
    processos: [processo()],
    pessoas: [{ id: PESSOA, telefone: '5511999998888', nome: 'João da Silva', idade: 30, funcao: 'Recepcionista', empresa: 'Loja Centro',
      email: 'joao@x.com', cidade: 'Campinas', criado_em: '2026-09-01T10:00:00+00:00', atualizado_em: '2026-10-01T12:10:02.5+00:00' }],
    respostas: [resposta({ validacao: { versao: 1 }, pessoa_id: PESSOA, email: 'joao@x.com', cidade: 'Campinas',
      extras: [{ id: 'p1', pergunta: 'Pretensão?', resposta: 'R$ 3.000' }, 'lixo'] }),
    resposta({ id: 'antigo-sem-processo', processo_id: null, avaliacao: '', protocolo: null, idade: null, recebido_em: '2026-09-01T10:00:00+00:00' })]
  });
  const r = await api.listar(T);
  assert.equal(r.ok, true);
  assert.equal(r.itens.length, 2);
  const [antigo, it] = r.itens;
  const p = payloadValido();
  assert.deepEqual(it, {
    v: 1, id: p.id, nome: p.nome, telefone: '5511999998888', vaga: p.vaga, consentimento: true,
    inicio: '2026-10-01T12:00:00.000Z', fim: '2026-10-01T12:10:00.000Z', duracaoSeg: 600, respostas: p.respostas,
    resultado: { percentuais: p.resultado.percentuais, codigo: p.resultado.codigo },
    status: 'em_analise', observacoes: '', recebidoEm: '2026-10-01T12:10:02.500Z', protocolo: '47K', idade: 30,
    funcao: p.funcao, empresa: p.empresa, avaliacao: 'SEL1', empresaId: '', validacao: { versao: 1 },
    processoId: PID, empresaNome: 'Clínica Exemplo', avaliacaoNome: 'Recepcionista 2026', avaliacaoTipo: 'selecao',
    pessoaId: PESSOA,
    pessoa: { id: PESSOA, nome: 'João da Silva', telefone: '5511999998888', idade: 30, funcao: 'Recepcionista', empresa: 'Loja Centro',
      email: 'joao@x.com', cidade: 'Campinas', foto: '', atualizadoEm: '2026-10-01T12:10:02.500Z' },
    email: 'joao@x.com', cidade: 'Campinas', extras: [{ id: 'p1', pergunta: 'Pretensão?', resposta: 'R$ 3.000' }],
    exigido: '', resultadoExigido: null, foto: '', historicoProcessos: [], origem: 'processo'
  });
  assert.equal(antigo.pessoaId, '');
  assert.equal(antigo.pessoa, null);
  assert.deepEqual([antigo.email, antigo.cidade, antigo.extras], ['', '', []]);
  // A consulta embute a ficha da pessoa (FK respostas.pessoa_id).
  assert.match(e.chamadas.find((c) => c.tabela === 'respostas' && c.op === 'select').colunas, /pessoas\(id, nome, telefone/);
  assert.equal(antigo.protocolo, '');
  assert.equal(antigo.idade, null);
  assert.equal(antigo.avaliacaoTipo, 'selecao');
  assert.equal(antigo.avaliacaoNome, '');
});

test('atualizar, excluir e excluirTodos: validações e mensagens do Code.gs', async () => {
  const { api, T, e } = await logado({ processos: [processo()], respostas: [resposta(), resposta({ id: 'outra-resposta', avaliacao: 'EQP1' })] });
  await assert.rejects(api.atualizar(T, 'lx1abc-teste01', { status: 'x' }), /Status inválido/);
  await assert.rejects(api.atualizar(T, 'lx1abc-teste01', {}), /Nada para atualizar/);
  await assert.rejects(api.atualizar(T, 'nao-existe', { status: 'aprovado' }), /Candidato não encontrado/);
  assert.deepEqual(await api.atualizar(T, 'lx1abc-teste01', { status: 'aprovado', observacoes: '  boa\r\nconversa ' }), { ok: true, id: 'lx1abc-teste01' });
  assert.equal(e.tabelas.respostas[0].status, 'aprovado');
  assert.equal(e.tabelas.respostas[0].observacoes, 'boa\nconversa');
  await assert.rejects(api.excluir(T, ''), /Candidato não informado/);
  await assert.rejects(api.excluirTodos(T, '!!'), /Código de avaliação inválido/);
  assert.deepEqual(await api.excluirTodos(T, 'eqp1'), { ok: true, excluidos: 1, avaliacao: 'EQP1' });
  assert.deepEqual(await api.excluir(T, 'lx1abc-teste01'), { ok: true, id: 'lx1abc-teste01' });
  await assert.rejects(api.excluir(T, 'lx1abc-teste01'), /Candidato não encontrado/);
  e.tabelas.respostas.push(resposta({ id: 'mais-uma-1' }), resposta({ id: 'mais-uma-2' }));
  assert.deepEqual(await api.excluirTodos(T), { ok: true, excluidos: 2 });
});

test('processosListar/Salvar/Excluir: formato processoPublico do Code.gs, config validada, campos em snake_case', async () => {
  const { api, T, e } = await logado({ processos: [processo()], respostas: [resposta()] });
  const l = await api.processosListar(T);
  assert.deepEqual(l.processos[0], {
    id: PID, codigo: 'SEL1', empresaId: '', empresaNome: 'Clínica Exemplo', nome: 'Recepcionista 2026', tipo: 'selecao',
    mostrarResultado: false, ativa: true, criadaEm: '2026-10-01T10:00:00.000Z', respostas: 1, empresa: 'Clínica Exemplo',
    vaga: 'Recepção', cidade: 'Campinas', consultor: 'Ana', contratante: 'Dr. Paulo', periodo: { inicio: '2026-10-01', fim: '' },
    clickupListId: '900000000001', config: SB.validarConfigProcesso({ perfilIdeal: 'SC', corte: 70 }).config
  });
  const av = await api.listarAvaliacoes(T);
  assert.deepEqual(Object.keys(av.avaliacoes[0]), ['id', 'codigo', 'empresaId', 'empresaNome', 'nome', 'tipo', 'mostrarResultado', 'ativa', 'criadaEm', 'respostas']);

  await assert.rejects(api.processosSalvar(T, { nome: 'X' }), /Informe o nome do processo/);
  await assert.rejects(api.processosSalvar(T, { nome: 'Processo novo', tipo: 'outro' }), /Tipo inválido/);
  await assert.rejects(api.processosSalvar(T, { nome: 'Processo novo', clickupListId: 'a b' }), /ID da lista do ClickUp inválido/);
  await assert.rejects(api.processosSalvar(T, { nome: 'Processo novo', config: { etapas: [{ nome: 'E', campo: 'Estado civil' }] } }), /"Estado civil" é um dado sensível/);
  await assert.rejects(api.processosSalvar(T, { nome: 'Processo novo', config: { corte: 50, faixaAvaliar: 60 } }), /faixa "avaliar"/);

  const novo = await api.processosSalvar(T, { nome: 'Escrevente', empresa: 'Cartório', periodo: { inicio: '2026-11-01', fim: 'x' }, clickupListId: '123', config: { perfilIdeal: 'cd' } });
  assert.equal(novo.ok, true);
  assert.equal(novo.processo.codigo, 'K7QZ');
  assert.equal(novo.processo.ativa, true);
  assert.equal(novo.processo.respostas, 0);
  assert.equal(novo.processo.config.perfilIdeal, 'CD');
  const ins = e.chamadas.find((c) => c.tabela === 'processos' && c.op === 'insert').dados;
  assert.equal(ins.periodo_inicio, '2026-11-01');
  assert.equal(ins.periodo_fim, null);
  assert.equal(ins.clickup_list_id, '123');
  assert.equal(ins.mostrar_resultado, false);
  assert.ok(!('codigo' in ins), 'o código é gerado pelo banco');

  const edit = await api.processosSalvar(T, { id: PID, nome: 'Recepcionista 2027', ativa: false });
  assert.equal(edit.processo.nome, 'Recepcionista 2027');
  assert.equal(edit.processo.ativa, false);
  assert.equal(edit.processo.vaga, 'Recepção', 'campo que não veio fica como estava');
  const upd = e.chamadas.filter((c) => c.tabela === 'processos' && c.op === 'update').pop().dados;
  assert.ok(!('mostrar_resultado' in upd) && !('vaga' in upd));
  await assert.rejects(api.processosSalvar(T, { id: 'ava_antigo', nome: 'Qualquer um' }), /Processo não encontrado/);
  await assert.rejects(api.processosExcluir(T, ''), /Processo não informado/);
  assert.deepEqual(await api.processosExcluir(T, novo.processo.id), { ok: true, id: novo.processo.id });
  await assert.rejects(api.processosExcluir(T, novo.processo.id), /Avaliação não encontrada/);
});

test('mensagem de gatilho do banco (RAISE) chega igual; sem permissão (42501) vira "Sem permissão."', async () => {
  const msg = 'Esta avaliação já tem respostas. Desative a avaliação em vez de excluir (ou exclua as respostas dela antes).';
  const x = await logado({ processos: [processo()], erroBanco: { 'processos.delete': { code: 'P0001', message: msg } } });
  await assert.rejects(x.api.processosExcluir(x.T, PID), (err) => err.message === msg && err.resposta.erro === msg);
  const y = await logado({ erroBanco: { 'respostas.select': { code: '42501', message: 'permission denied for table respostas' } } });
  await assert.rejects(y.api.listar(y.T), /^Error: Sem permissão\.$/);
  const z = await logado({ erroBanco: { 'respostas.select': { code: 'PGRST301', message: 'JWT expired' } } });
  await assert.rejects(z.api.listar(z.T), (err) => err.sessaoExpirada === true);
});

test('Edge Function "admin": ações, corpos e formatos (ClickUp, relatório, IA, usuários)', async () => {
  const respostas = {
    'clickup.status': { ok: true, configurado: true, conectado: true, iaConfigurada: false, avisos: [] },
    'clickup.listas': { ok: true, listas: [{ id: '1', nome: 'L', pasta: 'P' }] },
    'processo.dados': { ok: true, processo: {}, config: {}, status: [], candidatos: [], avisos: [] },
    'relatorio.rascunho': { ok: true, relatorio: { textos: {} }, token: 'r'.repeat(64), avisos: [] },
    'relatorio.salvar': { ok: true, relatorio: {}, alterados: 1 },
    'relatorio.publicar': { ok: true, url: 'https://disc.gestaosemcaos.com.br/relatorio.html?r=' + 'r'.repeat(64) },
    'relatorio.despublicar': { ok: true },
    'relatorios.listar': { ok: true, relatorios: [] },
    'relatorio.melhorarTextos': { ok: false, erro: 'IA não configurada.' },
    'usuarios.listar': { ok: true, usuarios: [] },
    'usuarios.convidar': { ok: true, convidado: true, usuario: { id: 'u2' } },
    'usuarios.remover': { ok: true, id: 'u2' }
  };
  const { api, T, e } = await logado({ funcoes: { admin: (b) => ({ data: respostas[b.acao], error: null }) } });
  const R = 'r'.repeat(64);
  assert.deepEqual(await api.clickupStatus(T), respostas['clickup.status']);
  assert.deepEqual(await api.clickupListas(T), respostas['clickup.listas']);
  await api.processoDados(T, PID);
  await api.relatorioRascunho(T, PID);
  await api.relatorioSalvar(T, R, { textos: { a: { texto: 'x' } }, outro: 'ignorado' });
  await api.relatorioPublicar(T, R, 'https://disc.gestaosemcaos.com.br/');
  await api.relatorioDespublicar(T, R);
  await api.relatoriosListar(T, PID);
  await assert.rejects(api.relatorioMelhorarTextos(T, R, ['a']), /IA não configurada/);
  await api.listarUsuarios(T);
  assert.equal((await api.salvarUsuario(T, { nome: 'Nova Pessoa', email: 'nova@empresa.com', papel: 'admin' }, 'ignorada')).convidado, true);
  await api.excluirUsuario(T, 'u2');
  assert.deepEqual(e.invocacoes.map((i) => i.body), [
    { acao: 'clickup.status' }, { acao: 'clickup.listas' }, { acao: 'processo.dados', id: PID },
    { acao: 'relatorio.rascunho', processoId: PID },
    { acao: 'relatorio.salvar', relatorioToken: R, relatorio: { textos: { a: { texto: 'x' } } } },
    { acao: 'relatorio.publicar', relatorioToken: R, baseUrl: 'https://disc.gestaosemcaos.com.br/' },
    { acao: 'relatorio.despublicar', relatorioToken: R }, { acao: 'relatorios.listar', processoId: PID },
    { acao: 'relatorio.melhorarTextos', relatorioToken: R, ids: ['a'] }, { acao: 'usuarios.listar' },
    { acao: 'usuarios.convidar', email: 'nova@empresa.com', nome: 'Nova Pessoa' }, { acao: 'usuarios.remover', id: 'u2' }
  ]);
  assert.ok(e.invocacoes.every((i) => i.nome === 'admin' && i.comSessao));
  await assert.rejects(api.relatorioSalvar(T, ''), /Relatório não informado/);
  await assert.rejects(api.processoDados(T, ''), /Processo não informado/);
});

test('Edge Function: sessaoExpirada da função e HTTP 401 levam ao login; 404 explica que falta publicar', async () => {
  const resp401 = { status: 401, clone() { return this; }, json: async () => ({ msg: 'Invalid JWT' }) };
  const resp404 = { status: 404, clone() { return this; }, json: async () => ({}) };
  let modo = 'sessao';
  const { api, T } = await logado({
    funcoes: {
      admin: () => {
        if (modo === 'sessao') return { data: { ok: false, erro: 'Sessão expirada. Entre de novo.', sessaoExpirada: true }, error: null };
        if (modo === '401') return { data: null, error: { name: 'FunctionsHttpError', context: resp401 } };
        if (modo === '404') return { data: null, error: { name: 'FunctionsHttpError', context: resp404 } };
        return new Promise(() => {}); // nunca responde
      }
    }
  });
  await assert.rejects(api.clickupStatus(T), (err) => err.sessaoExpirada === true);
  modo = '401';
  await assert.rejects(api.clickupStatus(T), (err) => err.sessaoExpirada === true);
  modo = '404';
  await assert.rejects(api.clickupStatus(T), /não está publicada no Supabase/);
  modo = 'pendurado';
  await assert.rejects(api.clickupStatus(T), /demorou demais/);
});

test('salvarUsuario com id só muda o nome', async () => {
  const { api, T, e } = await logado();
  const r = await api.salvarUsuario(T, { id: UID, nome: 'Dona Renomeada', email: 'dona@empresa.com', papel: 'admin', ativo: true });
  assert.equal(r.usuario.nome, 'Dona Renomeada');
  assert.equal(e.admins[0].nome, 'Dona Renomeada');
  await assert.rejects(api.salvarUsuario(T, { id: UID, nome: 'Dona', ativo: false }), /exclua o usuário/);
});

test('formulário do processo: validarConfigProcesso normaliza config.formulario e recusa pergunta sensível', async () => {
  const padrao = { campos: { idade: 'obrigatorio', funcao: 'opcional', empresa: 'opcional', email: 'oculto', cidade: 'oculto', foto: 'opcional' }, perguntas: [], parte2: 'desligada' };
  assert.deepEqual(SB.validarConfigProcesso({}).config.formulario, padrao);
  assert.equal(SB.normalizarFormulario({ parte2: 'ligada' }).parte2, 'ligada');
  assert.equal(SB.validarConfigProcesso({ formulario: { parte2: 'ligada' } }).config.formulario.parte2, 'ligada');
  for (const x of ['LIGADA', true, 1, 'sim', null]) assert.equal(SB.normalizarFormulario({ parte2: x }).parte2, 'desligada');
  assert.deepEqual(SB.normalizarFormulario('x'), padrao);
  assert.deepEqual(SB.normalizarFormulario({
    campos: { idade: 'oculto', email: 'obrigatorio', cidade: 'opcional', funcao: 'talvez' },
    perguntas: [
      { id: 'p1', texto: '  Qual sua   pretensão salarial?  ', obrigatoria: true },
      { id: 'p1', texto: 'Tem disponibilidade aos sábados?', obrigatoria: 'sim' },
      { id: 'Inválido!', texto: 'Como soube da vaga?' },
      { texto: 'ok' }, 'texto solto', null,
      { id: 'carro', texto: 'Tem carro próprio?', obrigatoria: false },
      { texto: 'Pergunta seis aqui?' }, { texto: 'Pergunta sete aqui?' }
    ]
  }), {
    // mesmo resultado de disc_interno.normalizar_formulario (tests/supabase/banco.test.js)
    campos: { idade: 'oculto', funcao: 'opcional', empresa: 'opcional', email: 'obrigatorio', cidade: 'opcional', foto: 'opcional' },
    perguntas: [
      { id: 'p1', texto: 'Qual sua pretensão salarial?', obrigatoria: true },
      { id: 'p2', texto: 'Tem disponibilidade aos sábados?', obrigatoria: false },
      { id: 'p3', texto: 'Como soube da vaga?', obrigatoria: false },
      { id: 'carro', texto: 'Tem carro próprio?', obrigatoria: false },
      { id: 'p4', texto: 'Pergunta seis aqui?', obrigatoria: false }
    ],
    parte2: 'desligada'
  });
  assert.deepEqual(SB.validarConfigProcesso({ permitirSaude: true, formulario: { perguntas: [{ texto: 'Você tem filhos?' }] } }),
    { ok: false, erro: 'A pergunta "Você tem filhos?" pede um dado sensível e não pode ser usada.' });
  assert.match(SB.validarConfigProcesso({ permitirSaude: true, formulario: { perguntas: [{ texto: 'Como está sua saúde?' }] } }).erro, /dado sensível/);

  const { api, T, e } = await logado({ processos: [processo({ config: { formulario: { campos: { email: 'obrigatorio' } } } })] });
  const l = await api.processosListar(T);
  assert.equal(l.processos[0].config.formulario.campos.email, 'obrigatorio');
  await assert.rejects(api.processosSalvar(T, { id: PID, nome: 'Recepcionista 2026', config: { formulario: { perguntas: [{ texto: 'Qual seu estado civil?' }] } } }),
    { message: 'A pergunta "Qual seu estado civil?" pede um dado sensível e não pode ser usada.' });
  const ok = await api.processosSalvar(T, { id: PID, nome: 'Recepcionista 2026', config: { formulario: { campos: { cidade: 'opcional' }, perguntas: [{ texto: 'Pretensão salarial?', obrigatoria: true }] } } });
  assert.deepEqual(ok.processo.config.formulario.perguntas, [{ id: 'p1', texto: 'Pretensão salarial?', obrigatoria: true }]);
  const upd = e.chamadas.filter((c) => c.tabela === 'processos' && c.op === 'update').pop().dados;
  assert.equal(upd.config.formulario.campos.cidade, 'opcional');
});

// ---------------------------------------------------------------------------
// Empresas, colaboradores, organograma e relatórios por modelo (rodada empresas/equipes)
// ---------------------------------------------------------------------------

const EMP = '44444444-4444-4444-8444-444444444444';
const EMP2 = '44444444-4444-4444-8444-444444444445';
const P1 = '55555555-5555-4555-8555-555555555551';
const P2 = '55555555-5555-4555-8555-555555555552';
const P3 = '55555555-5555-4555-8555-555555555553';
const V1 = '66666666-6666-4666-8666-666666666661';
function empresa(extra) {
  return Object.assign({ id: EMP, nome: 'Clínica Exemplo', cidade: 'Boa Vista', observacoes: '', ativo: true,
    criado_em: '2026-10-01T10:00:00+00:00', atualizado_em: '2026-10-02T10:00:00+00:00' }, extra || {});
}
function equipeBase() {
  return {
    empresas: [empresa(), empresa({ id: EMP2, nome: 'Loja Beta', ativo: false })],
    pessoas: [
      { id: P1, telefone: '5511900000001', nome: 'Marta Diretora Souza', idade: 40 },
      { id: P2, telefone: '5511900000002', nome: 'Lucas Vendedor Lima', idade: 25 },
      { id: P3, telefone: '5511900000003', nome: 'Bruno Antigo Reis', idade: 30 }
    ],
    respostas: [
      resposta({ id: 'r-antiga', pessoa_id: P1, recebido_em: '2026-09-01T10:00:00+00:00', respostas: '1234'.repeat(25) }),
      resposta({ id: 'r-nova', pessoa_id: P1, recebido_em: '2026-10-01T10:00:00+00:00', exigido: '4321'.repeat(10) })
    ],
    vinculos: [
      { id: V1, pessoa_id: P1, empresa_id: EMP, cargo: 'Diretora', area: 'Diretoria', status: 'ativo', inicio: '2024-01-01', fim: null },
      { id: '66666666-6666-4666-8666-666666666662', pessoa_id: P2, empresa_id: EMP, cargo: 'Vendedor', area: 'Comercial', status: 'ativo', inicio: '2025-01-01', fim: null },
      { id: '66666666-6666-4666-8666-666666666663', pessoa_id: P3, empresa_id: EMP, cargo: 'Auxiliar', area: '', status: 'desligado', inicio: '2023-01-01', fim: '2026-08-01' }
    ],
    relacoes: [
      { empresa_id: EMP, de_pessoa: P1, para_pessoa: P2, tipo: 'lidera' },
      { empresa_id: EMP, de_pessoa: P1, para_pessoa: P3, tipo: 'lidera' } // pessoa desligada: não sai
    ]
  };
}

test('listarEmpresas conta colaboradores ativos; salvarEmpresa valida e recusa nome repetido; excluirEmpresa', async () => {
  const { api, T, e } = await logado(equipeBase());
  const l = await api.listarEmpresas(T);
  assert.deepEqual(l.empresas[0], { id: EMP, nome: 'Clínica Exemplo', cidade: 'Boa Vista', observacoes: '', ativo: true,
    criadoEm: '2026-10-01T10:00:00.000Z', atualizadoEm: '2026-10-02T10:00:00.000Z', colaboradores: 2 });
  assert.deepEqual(l.empresas.map((x) => [x.nome, x.colaboradores, x.ativo]), [['Clínica Exemplo', 2, true], ['Loja Beta', 0, false]]);

  const nova = await api.salvarEmpresa(T, { nome: '  Padaria   Gama ', cidade: 'Manaus', observacoes: 'Cliente\nnovo' });
  assert.equal(nova.empresa.nome, 'Padaria Gama');
  assert.equal(nova.empresa.colaboradores, 0);
  const ins = e.chamadas.filter((c) => c.tabela === 'empresas' && c.op === 'insert').pop().dados;
  assert.deepEqual(ins, { nome: 'Padaria Gama', cidade: 'Manaus', observacoes: 'Cliente\nnovo', ativo: true });
  const ed = await api.salvarEmpresa(T, { id: EMP, nome: 'Clínica Exemplo', ativo: false });
  assert.equal(ed.empresa.ativo, false);
  assert.equal(ed.empresa.colaboradores, 2);
  assert.deepEqual(e.chamadas.filter((c) => c.tabela === 'empresas' && c.op === 'update').pop().dados, { nome: 'Clínica Exemplo', ativo: false },
    'edição só manda o que veio');
  await assert.rejects(api.salvarEmpresa(T, { nome: 'loja beta' }), /Já existe uma empresa com esse nome\./);
  await assert.rejects(api.salvarEmpresa(T, { nome: '  ' }), /Informe o nome da empresa\./);
  await assert.rejects(api.salvarEmpresa(T, { id: 'x', nome: 'Outra' }), /Empresa não encontrada\./);

  assert.deepEqual(await api.excluirEmpresa(T, EMP2), { ok: true, id: EMP2 });
  await assert.rejects(api.excluirEmpresa(T, EMP2), /Empresa não encontrada\./);
  await assert.rejects(api.excluirEmpresa(T, 'nada'), /Empresa não encontrada\./);
  // recusa do gatilho do banco passa como está
  const b = await logado(Object.assign(equipeBase(), { erroBanco: { 'empresas.delete': { code: 'P0001', message: 'Desligue ou mova os colaboradores antes.' } } }));
  await assert.rejects(b.api.excluirEmpresa(b.T, EMP), { message: 'Desligue ou mova os colaboradores antes.' });
  // sem sessão
  await assert.rejects(api.listarEmpresas(''), (err) => err.sessaoExpirada === true);
});

test('listarEquipe: ativos com o resultado mais recente, relações só entre ativos e histórico dos desligados', async () => {
  const { api, T, e } = await logado(equipeBase());
  const r = await api.listarEquipe(T, EMP);
  assert.equal(r.ok, true);
  assert.equal(r.empresa.nome, 'Clínica Exemplo');
  assert.equal(r.empresa.colaboradores, 2);
  assert.deepEqual(r.colaboradores.map((c) => c.nome), ['Lucas Vendedor Lima', 'Marta Diretora Souza']);
  const marta = r.colaboradores[1];
  const esperado = S.calcular(S.descompactar(payloadValido().respostas));
  assert.deepEqual(marta, { vinculoId: V1, pessoaId: P1, nome: 'Marta Diretora Souza', telefone: '5511900000001', cargo: 'Diretora',
    area: 'Diretoria', status: 'ativo', inicio: '2024-01-01', fim: '', resultado: { percentuais: esperado.percentuais, codigo: esperado.codigo },
    respondidoEm: '2026-10-01T10:00:00.000Z', exigido: { percentuais: { D: 40, I: 30, S: 20, C: 10 }, codigo: 'DI' }, foto: '' });
  assert.equal(r.colaboradores[0].resultado, null, 'sem teste');
  assert.equal(r.colaboradores[0].exigido, null);
  assert.equal(r.colaboradores[0].respondidoEm, '');
  assert.deepEqual(r.relacoes, [{ de: P1, para: P2, tipo: 'lidera' }]);
  assert.deepEqual(r.historico.map((c) => [c.nome, c.status, c.fim]), [['Bruno Antigo Reis', 'desligado', '2026-08-01']]);
  assert.ok(!JSON.stringify(r).includes('"idade"'), 'nada de idade na equipe');
  const sel = e.chamadas.find((c) => c.tabela === 'vinculos' && c.op === 'select' && /respostas\(/.test(c.colunas));
  assert.deepEqual(sel.eqs, [['empresa_id', EMP]]);
  assert.match(sel.colunas, /respostas\(respostas, exigido,/);
  await assert.rejects(api.listarEquipe(T, EMP2.replace('5', '9')), /Empresa não encontrada\./);
  await assert.rejects(api.listarEquipe(T, 'xyz'), /Empresa não encontrada\./);
  await assert.rejects(api.listarEquipe(T, ''), /Empresa não informada\./);
});

test('salvarColaborador, moverColaborador e salvarRelacoes chamam as funções do banco; desligarColaborador atualiza o vínculo', async () => {
  const colab = { vinculoId: V1, pessoaId: P1, empresaId: EMP, nome: 'Marta Diretora Souza', telefone: '5511900000001', cargo: 'Diretora',
    area: 'Diretoria', status: 'ativo', inicio: '2026-10-05', fim: '' };
  const { api, T, e } = await logado(Object.assign(equipeBase(), {
    rpc: {
      salvar_colaborador: (a) => (a.p_dados.telefone === '1'
        ? { data: { ok: false, erro: 'Telefone inválido. Informe DDD + número.' }, error: null }
        : { data: { ok: true, colaborador: colab }, error: null }),
      mover_colaborador: () => ({ data: { ok: true, colaborador: Object.assign({}, colab, { empresaId: EMP2 }) }, error: null }),
      salvar_relacoes: (a) => ({ data: { ok: true, relacoes: a.p_relacoes }, error: null })
    }
  }));
  const s1 = await api.salvarColaborador(T, { empresaId: EMP, nome: ' Marta  Diretora Souza ', telefone: '(11) 90000-0001', cargo: 'Diretora', area: 'Diretoria', idade: 40 });
  assert.deepEqual(s1, { ok: true, colaborador: colab });
  assert.deepEqual(e.chamadas.filter((c) => c.rpc === 'salvar_colaborador').pop().args,
    { p_dados: { empresaId: EMP, cargo: 'Diretora', area: 'Diretoria', nome: 'Marta Diretora Souza', telefone: '(11) 90000-0001' } });
  await api.salvarColaborador(T, { empresaId: EMP, pessoaId: P1, cargo: 'CEO' });
  assert.deepEqual(e.chamadas.filter((c) => c.rpc === 'salvar_colaborador').pop().args, { p_dados: { empresaId: EMP, cargo: 'CEO', area: '', pessoaId: P1 } });
  await assert.rejects(api.salvarColaborador(T, { empresaId: EMP, nome: 'A B', telefone: '1' }), /Telefone inválido/);
  await assert.rejects(api.salvarColaborador(T, { nome: 'A B' }), /Empresa não informada\./);

  const m = await api.moverColaborador(T, { pessoaId: P1, empresaId: EMP2, cargo: 'Gerente', area: 'Loja' });
  assert.equal(m.colaborador.empresaId, EMP2);
  assert.deepEqual(e.chamadas.filter((c) => c.rpc === 'mover_colaborador').pop().args, { p_dados: { pessoaId: P1, empresaId: EMP2, cargo: 'Gerente', area: 'Loja' } });
  await assert.rejects(api.moverColaborador(T, { pessoaId: P1 }), /Escolha a empresa de destino\./);

  const rel = await api.salvarRelacoes(T, EMP, [{ de: P1, para: P2, tipo: 'lidera', extra: 'x' }]);
  assert.deepEqual(rel, { ok: true, relacoes: [{ de: P1, para: P2, tipo: 'lidera' }], topoIds: [] });
  assert.deepEqual(e.chamadas.filter((c) => c.rpc === 'salvar_relacoes').pop().args, { p_empresa: EMP, p_relacoes: [{ de: P1, para: P2, tipo: 'lidera' }] });
  await assert.rejects(api.salvarRelacoes(T, EMP, 'x'), /Relações inválidas\./);

  assert.deepEqual(await api.desligarColaborador(T, V1), { ok: true, id: V1 });
  const up = e.chamadas.filter((c) => c.tabela === 'vinculos' && c.op === 'update').pop();
  assert.deepEqual([up.dados, up.eqs], [{ status: 'desligado' }, [['id', V1], ['status', 'ativo']]]);
  await assert.rejects(api.desligarColaborador(T, V1), /já desligado/);
  await assert.rejects(api.desligarColaborador(T, 'x'), /Colaborador não encontrado\./);
});

test('relatórios por modelo: salvar (rascunho/publicar com link), listar com título e excluir; nunca mexe nos de processo', async () => {
  const local = { origin: 'https://exemplo.github.io', pathname: '/test-DISC/admin.html', hash: '', search: '' };
  const base = equipeBase();
  base.relatorios = [{ id: '77777777-7777-4777-8777-777777777771', token: 'c'.repeat(64), modelo: 'processo', processo_id: PID, status: 'publicado',
    dados: { titulo: 'Processo' }, criado_em: '2026-09-01T10:00:00+00:00' }];
  const { api, T, e } = await logado(base, { local });
  const dados = { modelo: 'equipe', versao: 1, titulo: 'Equipe da Clínica', geradoEm: '2026-10-05T10:00:00.000Z' };
  const r1 = await api.salvarRelatorioModelo(T, { modelo: 'equipe', empresaId: EMP, dados });
  assert.equal(r1.relatorio.status, 'rascunho');
  assert.equal(r1.relatorio.modelo, 'equipe');
  assert.equal(r1.relatorio.url, undefined);
  assert.deepEqual(Object.keys(r1.relatorio).sort(), ['id', 'modelo', 'status', 'token']);
  const ins = e.chamadas.filter((c) => c.tabela === 'relatorios' && c.op === 'insert').pop().dados;
  assert.deepEqual(ins, { modelo: 'equipe', empresa_id: EMP, pessoa_id: null, dados, status: 'rascunho' });

  const r2 = await api.salvarRelatorioModelo(T, { id: r1.relatorio.id, modelo: 'equipe', empresaId: EMP, dados, publicar: true });
  assert.equal(r2.relatorio.status, 'publicado');
  assert.equal(r2.relatorio.url, 'https://exemplo.github.io/test-DISC/relatorio.html?r=' + r1.relatorio.token);
  const upd = e.chamadas.filter((c) => c.tabela === 'relatorios' && c.op === 'update').pop();
  assert.deepEqual(upd.eqs, [['id', r1.relatorio.id]]);
  // lideranca/pessoa precisam da pessoa; dados conferidos
  const r3 = await api.salvarRelatorioModelo(T, { modelo: 'lideranca', pessoaId: P2, empresaId: EMP, dados: { titulo: 'Como liderar o Lucas' } });
  assert.equal(e.tabelas.relatorios.find((x) => x.id === r3.relatorio.id).dados.modelo, 'lideranca', 'modelo gravado nos dados');
  await assert.rejects(api.salvarRelatorioModelo(T, { modelo: 'pessoa', dados: {} }), /Escolha a pessoa do relatório\./);
  await assert.rejects(api.salvarRelatorioModelo(T, { modelo: 'equipe', dados: {} }), /Escolha a empresa do relatório\./);
  await assert.rejects(api.salvarRelatorioModelo(T, { modelo: 'processo', empresaId: EMP, dados: {} }), /Modelo de relatório inválido/);
  await assert.rejects(api.salvarRelatorioModelo(T, { modelo: 'equipe', empresaId: EMP, dados: [] }), /Relatório vazio/);
  await assert.rejects(api.salvarRelatorioModelo(T, { modelo: 'equipe', empresaId: EMP, dados: { modelo: 'pessoa' } }), /não são de um relatório "equipe"/);
  await assert.rejects(api.salvarRelatorioModelo(T, { modelo: 'equipe', empresaId: EMP, dados: { t: 'x'.repeat(1000001) } }), /grande demais \(máximo 1 MB\)/);
  // Até 1 MB passa (as fotos vão dentro do snapshot).
  assert.equal((await api.salvarRelatorioModelo(T, { modelo: 'equipe', empresaId: EMP, dados: { t: 'x'.repeat(900000) } })).ok, true);
  e.tabelas.relatorios.pop();
  // id de relatório de processo: o update filtra modelo <> processo
  await assert.rejects(api.salvarRelatorioModelo(T, { id: '77777777-7777-4777-8777-777777777771', modelo: 'equipe', empresaId: EMP, dados }), /Relatório não encontrado\./);
  assert.equal(e.tabelas.relatorios[0].modelo, 'processo');

  const l = await api.listarRelatoriosModelo(T, { empresaId: EMP });
  assert.deepEqual(l.relatorios.map((x) => [x.modelo, x.titulo, x.status, !!x.url]),
    [['equipe', 'Equipe da Clínica', 'publicado', true], ['lideranca', 'Como liderar o Lucas', 'rascunho', false]]);
  assert.deepEqual((await api.listarRelatoriosModelo(T, { pessoaId: P2 })).relatorios.map((x) => x.modelo), ['lideranca']);
  assert.equal((await api.listarRelatoriosModelo(T)).relatorios.length, 2, 'o de processo não aparece');
  assert.deepEqual(await api.listarRelatoriosModelo(T, { empresaId: 'x' }), { ok: true, relatorios: [] });

  assert.deepEqual(await api.excluirRelatorioModelo(T, r3.relatorio.id), { ok: true, id: r3.relatorio.id });
  await assert.rejects(api.excluirRelatorioModelo(T, '77777777-7777-4777-8777-777777777771'), /Relatório não encontrado\./);
  assert.equal(e.tabelas.relatorios.length, 2);
});

test('processos: empresaId vai e volta (empresa_id); vazio desliga; inválido recusa', async () => {
  const { api, T, e } = await logado({ processos: [processo({ empresa_id: EMP })] });
  const l = await api.processosListar(T);
  assert.equal(l.processos[0].empresaId, EMP);
  assert.equal((await api.listarAvaliacoes(T)).avaliacoes[0].empresaId, EMP);
  await api.processosSalvar(T, { id: PID, nome: 'Recepcionista 2026', empresaId: EMP2 });
  assert.equal(e.chamadas.filter((c) => c.tabela === 'processos' && c.op === 'update').pop().dados.empresa_id, EMP2);
  await api.processosSalvar(T, { id: PID, nome: 'Recepcionista 2026', empresaId: '' });
  assert.equal(e.chamadas.filter((c) => c.tabela === 'processos' && c.op === 'update').pop().dados.empresa_id, null);
  await api.processosSalvar(T, { id: PID, nome: 'Recepcionista 2026' });
  assert.ok(!('empresa_id' in e.chamadas.filter((c) => c.tabela === 'processos' && c.op === 'update').pop().dados), 'sem empresaId não mexe');
  await assert.rejects(api.processosSalvar(T, { nome: 'Novo', empresaId: 'emp_x' }), /Escolha uma empresa válida\./);
});

test('api.js (Apps Script legado): métodos novos recusam com "Disponível só com o servidor Supabase."', async () => {
  for (const m of ['listarEquipe', 'salvarColaborador', 'moverColaborador', 'desligarColaborador', 'salvarRelacoes',
    'salvarRelatorioModelo', 'listarRelatoriosModelo', 'excluirRelatorioModelo']) {
    await assert.rejects(API[m]('token', {}), (err) => err.message === 'Disponível só com o servidor Supabase.' && err.resposta.ok === false, m);
  }
});

test('Parte 2: listar devolve exigido e resultadoExigido; avaliacaoPublica repassa parte2; exigidoValido/calcularExigido', async () => {
  const EX = '4321'.repeat(5) + '1234'.repeat(5);  // D=I=S=C=25 -> empate: DI
  const { api, T } = await logado({
    processos: [processo()],
    respostas: [resposta({ exigido: EX }), resposta({ id: 'ex-invalido-1', exigido: '1111'.repeat(10) })]
  });
  const { itens } = await api.listar(T);
  const ok = itens.find((i) => i.id === 'lx1abc-teste01');
  assert.equal(ok.exigido, EX);
  assert.deepEqual(ok.resultadoExigido, { percentuais: { D: 25, I: 25, S: 25, C: 25 }, codigo: 'DI' });
  const ruim = itens.find((i) => i.id === 'ex-invalido-1');
  assert.deepEqual([ruim.exigido, ruim.resultadoExigido], ['', null]);

  assert.equal(SB.exigidoValido('2143'.repeat(10)), true);
  for (const x of ['2143'.repeat(9), '2143'.repeat(9) + '2144', '2143'.repeat(9) + '5143', null, 1234]) assert.equal(SB.exigidoValido(x), false);
  const c = SB.calcularExigido('1234'.repeat(9) + '4321');
  assert.equal(c.percentuais.D + c.percentuais.I + c.percentuais.S + c.percentuais.C, 100);
  assert.deepEqual(c.percentuais, { D: 13, I: 21, S: 29, C: 37 });
  assert.equal(c.codigo, 'CS');

  const { api: api2 } = nova({ rpc: { avaliacao_publica: () => ({ data: { ok: true, avaliacao: { codigo: 'EQP1', nome: 'Equipe', tipo: 'equipe',
    formulario: { parte2: 'ligada' } } }, error: null }) } });
  assert.equal((await api2.avaliacaoPublica('EQP1')).avaliacao.formulario.parte2, 'ligada');
});

// ---------------------------------------------------------------------------
// Fotos (migração 20261009120000_fotos.sql)
// ---------------------------------------------------------------------------
const FOTO = 'data:image/jpeg;base64,/9j/' + 'A'.repeat(300);
const FOTO2 = 'data:image/jpeg;base64,/9j/' + 'B'.repeat(300);

test('fotoValida: só data URL JPEG até 40 000 caracteres', () => {
  assert.equal(SB.FOTO_MAX, 40000);
  assert.equal(SB.fotoValida(FOTO), true);
  assert.equal(SB.fotoValida('data:image/jpeg;base64,/9j/' + 'A'.repeat(40000 - 27)), true);
  for (const ruim of ['', null, undefined, 1, 'data:image/png;base64,iVBOR', 'https://x.com/a.jpg', 'data:image/jpeg;base64,AAAA',
    'data:image/jpeg;base64,/9j/"><script>', 'data:image/jpeg;base64,/9j/' + 'A'.repeat(40000 - 26)]) {
    assert.equal(SB.fotoValida(ruim), false, String(ruim).slice(0, 30));
  }
});

test('fotos em listar (resposta e ficha), listarEquipe (da ficha), eu e listarUsuarios; foto inválida vira ""', async () => {
  const base = equipeBase();
  base.pessoas[0].foto = FOTO;
  base.pessoas[1].foto = 'data:image/png;base64,AAAA';
  base.processos = [processo()];
  base.respostas = base.respostas.map((r, i) => Object.assign({}, r, { foto: i === 0 ? FOTO2 : null }));
  base.admins = [{ user_id: UID, nome: 'Dona do Sistema', criado_em: '2026-10-01T10:00:00+00:00', foto: FOTO }];
  base.funcoes = { admin: (corpo) => ({ data: corpo.acao === 'usuarios.listar'
    ? { ok: true, usuarios: [{ id: UID, nome: 'Dona', foto: FOTO }, { id: 'x', nome: 'Outro', foto: 'https://x/y.jpg' }, { id: 'y', nome: 'Sem' }] }
    : { ok: true }, error: null }) };
  const { api, T, login, e } = await logado(base);
  assert.equal(login.usuario.foto, FOTO);
  assert.equal((await api.eu(T)).usuario.foto, FOTO);
  assert.match(e.chamadas.filter((c) => c.tabela === 'admins').pop().colunas, /foto/);

  const l = await api.listar(T);
  const comFoto = l.itens.find((it) => it.id === base.respostas[0].id);
  assert.equal(comFoto.foto, FOTO2);
  assert.equal(comFoto.pessoa.foto, base.respostas[0].pessoa_id === P1 ? FOTO : '');
  l.itens.filter((it) => it !== comFoto).forEach((it) => assert.equal(it.foto, ''));
  assert.match(e.chamadas.find((c) => c.tabela === 'respostas' && c.op === 'select').colunas, /pessoas\([^)]*foto/);

  const eq = await api.listarEquipe(T, EMP);
  const porId = {};
  eq.colaboradores.concat(eq.historico).forEach((c) => { porId[c.pessoaId] = c.foto; });
  assert.equal(porId[P1], FOTO);
  assert.equal(porId[P2], '');
  assert.match(e.chamadas.find((c) => c.tabela === 'vinculos' && c.op === 'select' && /respostas\(/.test(c.colunas)).colunas, /pessoas\(id, nome, telefone, foto,/);

  const u = await api.listarUsuarios(T);
  assert.deepEqual(u.usuarios.map((x) => x.foto), [FOTO, '', '']);
});

test('salvarMinhaFoto: valida no navegador e chama salvar_minha_foto; "" remove', async () => {
  const { api, T, e } = await logado({
    rpc: { salvar_minha_foto: (a) => ({ data: { ok: true, foto: a.p_foto }, error: null }) }
  });
  assert.deepEqual(await api.salvarMinhaFoto(T, FOTO), { ok: true, foto: FOTO });
  assert.deepEqual(e.chamadas.filter((c) => c.rpc === 'salvar_minha_foto').pop().args, { p_foto: FOTO });
  assert.deepEqual(await api.salvarMinhaFoto(T, ''), { ok: true, foto: '' });
  assert.deepEqual(await api.salvarMinhaFoto(T, null), { ok: true, foto: '' });
  assert.deepEqual(e.chamadas.filter((c) => c.rpc === 'salvar_minha_foto').pop().args, { p_foto: '' });
  const n = e.chamadas.length;
  for (const ruim of ['data:image/png;base64,AAAA', 'data:image/jpeg;base64,/9j/' + 'A'.repeat(40000), 123, {}]) {
    await assert.rejects(api.salvarMinhaFoto(T, ruim), /Foto inválida ou grande demais\. Escolha outra imagem\./);
  }
  assert.equal(e.chamadas.length, n, 'nada vai ao servidor com foto inválida');
  const semPermissao = await logado({ rpc: { salvar_minha_foto: () => ({ data: { ok: false, erro: 'Sem permissão.' }, error: null }) } });
  await assert.rejects(semPermissao.api.salvarMinhaFoto(semPermissao.T, FOTO), /Sem permissão\./);
  await assert.rejects(api.salvarMinhaFoto('', FOTO), (err) => err.sessaoExpirada === true);
});

test('removerFoto e atualizar(…, {foto: ""}) chamam remover_foto (LGPD)', async () => {
  const { api, T, e } = await logado({
    processos: [processo()], respostas: [resposta({ foto: FOTO })],
    rpc: { remover_foto: (a) => ({ data: a.p_resposta === 'lx1abc-teste01' ? { ok: true, id: a.p_resposta, removidas: 2 } : { ok: false, erro: 'Candidato não encontrado.' }, error: null }) }
  });
  assert.deepEqual(await api.removerFoto(T, 'lx1abc-teste01'), { ok: true, id: 'lx1abc-teste01', removidas: 2 });
  assert.deepEqual(e.chamadas.filter((c) => c.rpc === 'remover_foto').pop().args, { p_resposta: 'lx1abc-teste01' });
  await assert.rejects(api.removerFoto(T, 'outra-123'), /Candidato não encontrado\./);
  await assert.rejects(api.removerFoto(T, ''), /Candidato não informado\./);

  const antes = e.chamadas.filter((c) => c.rpc === 'remover_foto').length;
  assert.deepEqual(await api.atualizar(T, 'lx1abc-teste01', { foto: '' }), { ok: true, id: 'lx1abc-teste01' });
  assert.deepEqual(await api.atualizar(T, 'lx1abc-teste01', { status: 'aprovado', foto: '' }), { ok: true, id: 'lx1abc-teste01' });
  assert.equal(e.tabelas.respostas[0].status, 'aprovado');
  assert.equal(e.chamadas.filter((c) => c.rpc === 'remover_foto').length, antes + 2);
  assert.ok(!e.chamadas.some((c) => c.tabela === 'respostas' && c.op === 'update' && c.dados && 'foto' in c.dados), 'a foto nunca vai por update direto');
  await assert.rejects(api.atualizar(T, 'lx1abc-teste01', { foto: FOTO2 }), /só pode ser removida/);
});

test('enviar: a foto vai no payload para enviar_resposta (o banco valida)', async () => {
  const { api, e } = nova({ rpc: { enviar_resposta: (a) => ({ data: { ok: true, id: a.p_payload.id, protocolo: '12A' }, error: null }) } });
  const p = payloadValido({ foto: FOTO });
  const r = await api.enviar(p);
  assert.equal(r.ok, true);
  assert.equal(e.chamadas.find((c) => c.rpc === 'enviar_resposta').args.p_payload.foto, FOTO);
});

// ---------------------------------------------------------------------------
// Rodada 4: mover resposta, contratar, topo do organograma e versão do banco
// ---------------------------------------------------------------------------

test('moverResposta chama mover_resposta (só uuid ou "" = sem processo) e devolve o histórico', async () => {
  const H = [{ de: PID, para: '', deCodigo: 'SEL1', paraCodigo: '', em: '2026-10-05T12:00:00.000Z' }, 'lixo'];
  const { api, T, e } = await logado({
    processos: [processo()], respostas: [resposta()],
    rpc: { mover_resposta: (a) => ({ data: a.p_resposta === 'lx1abc-teste01'
      ? { ok: true, id: a.p_resposta, processoId: a.p_processo, avaliacao: a.p_processo ? 'sel1' : '', historicoProcessos: H, mudou: true }
      : { ok: false, erro: 'Candidato não encontrado.' }, error: null }) }
  });
  const r = await api.moverResposta(T, 'lx1abc-teste01', '');
  assert.deepEqual(r, { ok: true, id: 'lx1abc-teste01', processoId: '', avaliacao: '', historicoProcessos: [H[0]] });
  assert.deepEqual(e.chamadas.filter((c) => c.rpc === 'mover_resposta').pop().args, { p_resposta: 'lx1abc-teste01', p_processo: '' });
  const r2 = await api.moverResposta(T, 'lx1abc-teste01', ' ' + PID + ' ');
  assert.deepEqual([r2.processoId, r2.avaliacao], [PID, 'SEL1']);
  assert.equal((await api.moverResposta(T, 'lx1abc-teste01', null)).processoId, '');
  await assert.rejects(api.moverResposta(T, 'lx1abc-teste01', 'SEL1'), /Processo não encontrado\./);
  await assert.rejects(api.moverResposta(T, 'outra-123', PID), /Candidato não encontrado\./);
  await assert.rejects(api.moverResposta(T, '', PID), /Candidato não informado\./);
  await assert.rejects(api.moverResposta('', 'lx1abc-teste01', PID), (err) => err.sessaoExpirada === true);
});

test('contratarPessoa chama contratar_pessoa (respostaId ou pessoaId) e devolve o colaborador', async () => {
  const colab = { vinculoId: V1, pessoaId: P1, empresaId: EMP, nome: 'Marta Diretora Souza', telefone: '5511900000001', cargo: 'Recepcionista',
    area: 'Atendimento', status: 'ativo', inicio: '2026-10-05', fim: '' };
  const { api, T, e } = await logado(Object.assign(equipeBase(), {
    rpc: { contratar_pessoa: (a) => ({ data: { ok: true, colaborador: colab, movido: !!a.p_dados.respostaId, deEmpresaId: a.p_dados.respostaId ? EMP2 : '' }, error: null }) }
  }));
  const r = await api.contratarPessoa(T, { respostaId: ' r-nova ', pessoaId: P2, empresaId: EMP, cargo: ' Recepcionista ', area: 'Atendimento', extra: 1 });
  assert.deepEqual(r, { ok: true, colaborador: colab, movido: true, deEmpresaId: EMP2 });
  assert.deepEqual(e.chamadas.filter((c) => c.rpc === 'contratar_pessoa').pop().args,
    { p_dados: { empresaId: EMP, cargo: 'Recepcionista', area: 'Atendimento', respostaId: 'r-nova' } });
  const r2 = await api.contratarPessoa(T, { pessoaId: P2, empresaId: EMP });
  assert.deepEqual([r2.movido, r2.deEmpresaId], [false, '']);
  assert.deepEqual(e.chamadas.filter((c) => c.rpc === 'contratar_pessoa').pop().args, { p_dados: { empresaId: EMP, cargo: '', area: '', pessoaId: P2 } });
  await assert.rejects(api.contratarPessoa(T, { respostaId: 'r-nova' }), /Empresa não informada\./);
  await assert.rejects(api.contratarPessoa(T, { empresaId: EMP }), /Informe a pessoa\./);
});

test('topoIds: salvarRelacoes manda p_opcoes só quando vem topoIds; listarEquipe devolve só ativos', async () => {
  const base = equipeBase();
  base.empresas[0].organograma = { topoIds: [P2, 'lixo', P3, P2] };
  const { api, T, e } = await logado(Object.assign(base, {
    rpc: { salvar_relacoes: (a) => ({ data: { ok: true, relacoes: a.p_relacoes, topoIds: a.p_opcoes ? a.p_opcoes.topoIds : [P2] }, error: null }) }
  }));
  const eq = await api.listarEquipe(T, EMP);
  assert.deepEqual(eq.topoIds, [P2], 'só colaboradores ativos, sem repetir');
  assert.deepEqual((await api.listarEquipe(T, EMP2)).topoIds, []);

  const r = await api.salvarRelacoes(T, EMP, [], { topoIds: [' ' + P2 + ' ', ''] });
  assert.deepEqual(r, { ok: true, relacoes: [], topoIds: [P2] });
  assert.deepEqual(e.chamadas.filter((c) => c.rpc === 'salvar_relacoes').pop().args, { p_empresa: EMP, p_relacoes: [], p_opcoes: { topoIds: [P2] } });
  await api.salvarRelacoes(T, EMP, [], {});
  assert.ok(!('p_opcoes' in e.chamadas.filter((c) => c.rpc === 'salvar_relacoes').pop().args), 'sem topoIds o topo salvo não muda');
  await assert.rejects(api.salvarRelacoes(T, EMP, [], { topoIds: 'x' }), /Relações inválidas\./);
});

test('versaoBanco: com a função devolve versão e faltando; sem ela sonda tabelas/colunas (banco antigo)', async () => {
  const atual = await logado({ rpc: { versao_banco: () => ({ data: { ok: true, versao: 20261012120000, migracoes: [], faltando: [] }, error: null }) } });
  assert.deepEqual(await atual.api.versaoBanco(), { ok: true, versao: 20261012120000, faltando: [] });
  assert.equal(SB.VERSAO_ATUAL, 20261012120000);
  assert.deepEqual(SB.MIGRACOES.map((m) => m.nome.slice(0, 8)), ['20261005', '20261006', '20261007', '20261008', '20261009', '20261010', '20261011', '20261012']);
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'supabase', 'migrations', SB.MIGRACOES[7].nome + '.sql')));
  SB.MIGRACOES.forEach((m) => assert.ok(fs.existsSync(path.join(__dirname, '..', 'supabase', 'migrations', m.nome + '.sql')), m.nome));

  // Banco em produção sem a 20261008 e a 20261009 (e sem a 20261010): versao_banco não existe (PGRST202).
  const velho = await logado({ faltando: ['respostas.exigido', 'respostas.foto', 'respostas.historico_processos', 'pedidos'] });
  const v = await velho.api.versaoBanco();
  assert.deepEqual(v, { ok: true, versao: 20261007120000, semFuncao: true,
    faltando: ['20261008120000_parte2', '20261009120000_fotos', '20261010120000_mover_versao', '20261011120000_vendas',
      '20261012120000_infinitepay'] });
  const sondas = velho.e.chamadas.filter((c) => c.tabela && c.tabela !== 'admins' && c.op === 'select');
  assert.deepEqual(sondas.map((c) => c.tabela + '.' + c.colunas),
    ['pessoas.id', 'empresas.id', 'respostas.exigido', 'respostas.foto', 'respostas.historico_processos', 'pedidos.id',
      'pedidos.provedor_dados']);

  // Muito antigo: sem pessoas/empresas.
  const muito = await logado({ faltando: ['pessoas', 'empresas', 'respostas.exigido', 'respostas.foto', 'respostas.historico_processos', 'pedidos'] });
  assert.deepEqual((await muito.api.versaoBanco()).faltando, SB.MIGRACOES.slice(1).map((m) => m.nome));
  // Com a 20261009 aplicada mas sem a 20261010: só ela falta.
  const quase = await logado({ faltando: ['respostas.historico_processos', 'pedidos'] });
  assert.deepEqual(await quase.api.versaoBanco(), { ok: true, versao: 20261009120000, semFuncao: true,
    faltando: ['20261010120000_mover_versao', '20261011120000_vendas', '20261012120000_infinitepay'] });
  // Com a função versao_banco (20261010) mas sem a 20261011: a função antiga responde a versão dela.
  const semVendas = await logado({ rpc: { versao_banco: () => ({ data: { ok: true, versao: 20261010120000, migracoes: [], faltando: [] }, error: null }) } });
  assert.deepEqual(await semVendas.api.versaoBanco(), { ok: true, versao: 20261010120000,
    faltando: ['20261011120000_vendas', '20261012120000_infinitepay'] });
  // Com a 20261011 mas sem a 20261012 (InfinitePay).
  const semIP = await logado({ rpc: { versao_banco: () => ({ data: { ok: true, versao: 20261011120000, migracoes: [], faltando: [] }, error: null }) } });
  assert.deepEqual(await semIP.api.versaoBanco(), { ok: true, versao: 20261011120000, faltando: ['20261012120000_infinitepay'] });
  // Sem rede: mensagem de conexão.
  quase.e.falhaRede = true;
  await assert.rejects(quase.api.versaoBanco(), /Não foi possível conectar/);
});

test('função do banco que não existe (migração faltando) vira "banco desatualizado"', async () => {
  const { api, T } = await logado(equipeBase());
  await assert.rejects(api.moverResposta(T, 'r-nova', ''), (err) => err.bancoDesatualizado === true &&
    /O banco de dados está desatualizado/.test(err.message) && err.resposta.ok === false);
});

test('api.js (legado) e simulada: moverResposta, contratarPessoa e versaoBanco', async () => {
  for (const m of ['moverResposta', 'contratarPessoa', 'versaoBanco', 'salvarMinhaFoto', 'removerFoto']) {
    await assert.rejects(API[m]('token', {}), (err) => err.message === 'Disponível só com o servidor Supabase.', m);
  }
  assert.ok(API.METODOS.includes('versaoBanco') && SB.METODOS.includes('contratarPessoa'));
});

// ---------------------------------------------------------------------------
// Venda direta (B2C) — contrato usado pelas telas do cliente e pelo painel
// ---------------------------------------------------------------------------

const TK = 'a'.repeat(64);
const TA = 'b'.repeat(64);
const PED = '44444444-4444-4444-8444-444444444444';
const EXIG = '1234'.repeat(10);
const ok = (data) => ({ data, error: null });

test('vendas: métodos novos existem no Supabase, na simulada e no legado (que recusa)', async () => {
  const novos = ['pacotesPublicos', 'enviarPessoal', 'resumoPessoal', 'criarPedido', 'iniciarPagamento', 'statusPedido', 'relatorioPessoal',
    'salvarParte2Pessoal', 'recuperarAcesso', 'confirmarRetorno', 'listarPedidos', 'atualizarPedido', 'listarCupons', 'salvarCupom',
    'excluirCupom', 'listarPacotes', 'salvarPacote', 'resumoVendas'];
  const { api } = nova();
  const SIM = require('../js/api-simulada.js');
  for (const m of novos) {
    assert.ok(API.METODOS.includes(m), 'js/api.js METODOS: ' + m);
    assert.ok(SB.METODOS.includes(m), 'api-supabase METODOS: ' + m);
    assert.ok(SIM.METODOS.includes(m), 'api-simulada METODOS: ' + m);
    assert.equal(typeof api[m], 'function', m);
    await assert.rejects(API[m](), /Disponível só com o servidor Supabase\./, 'legado: ' + m);
  }
});

test('vendas públicas: RPCs com os nomes/argumentos certos e respostas normalizadas', async () => {
  const { api, e } = nova({ rpc: {
    pacotes_publicos: () => ok({ ok: true, pacotes: [{ chave: 'completo', nome: 'Relatório completo', precoCentavos: 3900, precoLancamentoCentavos: 2900,
      lancamentoAte: '', valorCentavos: 2900, emLancamento: true, descricao: { subtitulo: 'S', itens: ['a', '', 'b'] }, ordem: 2 }] }),
    enviar_resposta_pessoal: (a) => ok({ ok: true, id: a.p_payload.id, protocolo: '', tokenResumo: TK }),
    resumo_pessoal: () => ok({ ok: true, nome: 'Bia', resultado: { percentuais: { D: 40, I: 30, S: 20, C: 10 }, codigo: 'DI' }, recebidoEm: '2026-10-05T12:00:00+00:00', temParte2: false }),
    criar_pedido: (a) => ok(a.p_cupom === 'RUIM' ? { ok: false, erro: 'Cupom inválido ou expirado.' }
      : { ok: true, pedidoId: PED, tokenAcesso: TA, valor: a.p_cupom ? 0 : 2900, valorOriginal: 2900, gratuito: !!a.p_cupom, status: a.p_cupom ? 'cortesia' : 'aguardando' }),
    relatorio_pessoal: (a) => ok(a.p_token === TA
      ? { ok: true, nome: 'Bia', resultado: { percentuais: { D: 40, I: 30, S: 20, C: 10 }, codigo: 'DI' }, exigido: EXIG, pacote: 'completo_plus',
        pacoteNome: 'Completo + Parte 2', precisaParte2: false, status: 'pago' }
      : { ok: false, erro: 'Pagamento ainda não confirmado.', status: 'aguardando' }),
    salvar_parte2_pessoal: () => ok({ ok: true, exigido: EXIG })
  } });
  const pc = await api.pacotesPublicos();
  assert.deepEqual(pc.pacotes[0].descricao, { subtitulo: 'S', itens: ['a', 'b'] });
  assert.equal(pc.pacotes[0].valorCentavos, 2900);
  const env = await api.enviarPessoal(payloadValido({ email: 'bia@x.com' }));
  assert.deepEqual(env, { ok: true, id: 'lx1abc-teste01', protocolo: '', tokenResumo: TK });
  assert.equal(e.chamadas.find((c) => c.rpc === 'enviar_resposta_pessoal').args.p_payload.email, 'bia@x.com');
  assert.equal(e.invocacoes.length, 0, 'envio pessoal não chama o disc-sync (ClickUp)');
  assert.equal((await api.resumoPessoal(TK)).nome, 'Bia');
  await assert.rejects(api.resumoPessoal('curto'), /Resultado não encontrado/);
  const p = await api.criarPedido(TK, 'completo', '');
  assert.deepEqual(p, { ok: true, pedidoId: PED, tokenAcesso: TA, valor: 2900, valorOriginal: 2900, gratuito: false, status: 'aguardando' });
  assert.equal(e.chamadas.filter((c) => c.rpc === 'criar_pedido').pop().args.p_cupom, null);
  assert.equal((await api.criarPedido(TK, 'completo', ' lanca 100 ')).gratuito, true);
  assert.equal(e.chamadas.filter((c) => c.rpc === 'criar_pedido').pop().args.p_cupom, 'LANCA100');
  await assert.rejects(api.criarPedido(TK, 'completo', 'ruim'), /Cupom inválido ou expirado/);
  const rel = await api.relatorioPessoal(TA);
  assert.deepEqual(rel.exigido, SB.calcularExigido(EXIG));
  assert.equal(rel.exigidoRespostas, EXIG);
  await assert.rejects(api.relatorioPessoal('c'.repeat(64)), (err) => err.message === 'Pagamento ainda não confirmado.' && err.resposta.status === 'aguardando');
  await assert.rejects(api.salvarParte2Pessoal(TA, '123'), /Responda todos os grupos/);
  assert.deepEqual((await api.salvarParte2Pessoal(TA, EXIG)).exigido, SB.calcularExigido(EXIG));
});

test('vendas: iniciarPagamento/statusPedido/recuperarAcesso pela Edge Function "pagamento" (e os casos não configurado)', async () => {
  let modo = 'ok';
  const resposta = (body) => {
    if (modo === 'ausente') return { data: null, error: { name: 'FunctionsHttpError', context: { status: 404, json: async () => ({}) } } };
    if (modo === 'rede') return { data: null, error: { name: 'FunctionsFetchError', message: 'Failed to fetch' } };
    if (body.acao === 'criar') {
      if (modo === 'semChave') return { data: { ok: false, erro: 'Pagamento ainda não configurado.' }, error: null };
      if (modo === 'cpf') return { data: { ok: false, erro: 'Informe o seu CPF para pagar.', precisaCpf: true }, error: null };
      if (modo === 'infinitepay') return { data: { ok: true, provedor: 'infinitepay', redirecionarUrl: 'https://checkout.infinitepay.io/notus/x', valor: 2900 }, error: null };
      if (modo === 'urlRuim') return { data: { ok: true, provedor: 'infinitepay', redirecionarUrl: 'javascript:alert(1)', valor: 2900 }, error: null };
      return { data: { ok: true, pix: { qrBase64: 'QR', copiaECola: 'PIX', expira: 'X' }, cartaoUrl: 'https://asaas/i/1', valor: 2900, vencimento: '2026-10-06' }, error: null };
    }
    if (body.acao === 'confirmar') {
      if (body.tokenAcesso !== TA) return { data: { ok: false, erro: 'Pedido não encontrado.' }, error: null };
      return { data: { ok: true, status: body.transactionNsu ? 'pago' : 'aguardando' }, error: null };
    }
    if (body.acao === 'status') return { data: body.tokenAcesso === TA ? { ok: true, status: 'pago' } : { ok: false, erro: 'Pedido não encontrado.' }, error: null };
    if (body.acao === 'recuperar') {
      if (modo === 'semEmail') return { data: { ok: false, erro: 'O envio por e-mail ainda não está configurado. Fale com o suporte.' }, error: null };
      return { data: { ok: true }, error: null };
    }
    return { data: { ok: false, erro: '?' }, error: null };
  };
  const { api, e } = nova({ funcoes: { pagamento: resposta }, rpc: { status_pedido: () => ok({ ok: true, status: 'aguardando' }) } });
  const r = await api.iniciarPagamento(PED, TA, { cpf: '529.982.247-25' });
  assert.deepEqual(r, { ok: true, provedor: 'asaas', pix: { qrBase64: 'QR', copiaECola: 'PIX', expira: 'X' }, cartaoUrl: 'https://asaas/i/1', valor: 2900, vencimento: '2026-10-06' });
  assert.deepEqual(e.invocacoes[0].body, { acao: 'criar', pedidoId: PED, tokenAcesso: TA, cpf: '529.982.247-25' });
  modo = 'semChave';
  assert.deepEqual(await api.iniciarPagamento(PED, TA), { ok: false, erro: 'Pagamento ainda não configurado.', naoConfigurado: true });
  modo = 'ausente';
  assert.deepEqual(await api.iniciarPagamento(PED, TA), { ok: false, erro: 'Pagamento ainda não configurado.', naoConfigurado: true });
  modo = 'cpf';
  assert.deepEqual(await api.iniciarPagamento(PED, TA), { ok: false, erro: 'Informe o seu CPF para pagar.', precisaCpf: true });

  modo = 'infinitepay';
  assert.deepEqual(await api.iniciarPagamento(PED, TA), { ok: true, provedor: 'infinitepay', redirecionarUrl: 'https://checkout.infinitepay.io/notus/x', valor: 2900 });
  modo = 'urlRuim';
  await assert.rejects(api.iniciarPagamento(PED, TA), /Não foi possível gerar o pagamento/);

  modo = 'ok';
  assert.deepEqual(await api.confirmarRetorno(PED, TA, { transactionNsu: 'TX1', slug: 'S1' }), { ok: true, status: 'pago' });
  assert.deepEqual(e.invocacoes[e.invocacoes.length - 1].body, { acao: 'confirmar', pedidoId: PED, tokenAcesso: TA, transactionNsu: 'TX1', slug: 'S1' });
  assert.deepEqual(await api.confirmarRetorno(PED, TA, { transactionNsu: '<script>', slug: 'a b' }), { ok: true, status: 'aguardando' });
  assert.deepEqual(e.invocacoes[e.invocacoes.length - 1].body, { acao: 'confirmar', pedidoId: PED, tokenAcesso: TA, transactionNsu: '', slug: '' });
  await assert.rejects(api.confirmarRetorno(PED, 'd'.repeat(64), { transactionNsu: 'TX1' }), /Pedido não encontrado/);
  modo = 'ausente';
  assert.deepEqual(await api.confirmarRetorno(PED, TA, { transactionNsu: 'TX1' }), { ok: true, status: 'aguardando' }, 'sem a função, lê do banco');

  modo = 'ok';
  assert.deepEqual(await api.statusPedido(PED, TA), { ok: true, status: 'pago' });
  await assert.rejects(api.statusPedido(PED, 'd'.repeat(64)), /Pedido não encontrado/);
  modo = 'rede';
  assert.deepEqual(await api.statusPedido(PED, TA), { ok: true, status: 'aguardando' }, 'sem a função, lê do banco');
  assert.deepEqual(e.chamadas.filter((c) => c.rpc === 'status_pedido').pop().args, { p_pedido: PED, p_token: TA });

  modo = 'ok';
  assert.deepEqual(await api.recuperarAcesso(' Bia@X.com '), { ok: true });
  assert.deepEqual(e.invocacoes.pop().body, { acao: 'recuperar', email: 'bia@x.com' });
  modo = 'semEmail';
  assert.deepEqual(await api.recuperarAcesso('bia@x.com'),
    { ok: false, erro: 'O envio por e-mail ainda não está configurado. Fale com o suporte.', naoConfigurado: true });
  await assert.rejects(api.recuperarAcesso('nada'), /e-mail válido/);
});

test('vendas no painel: pedidos, cupons, pacotes e resumo (tabelas com RLS e RPCs de admin)', async () => {
  const x = await logado({
    pedidos: [
      { id: PED, resposta_id: 'r1', pacote: 'completo', valor_centavos: 2900, valor_original_centavos: 2900, cupom: null, status: 'pago', metodo: 'pix',
        asaas_cobranca_id: 'pay_1', pagamento: { cartaoUrl: 'https://asaas/i/1' }, email: 'bia@x.com', nome: 'Bia Souza', token_acesso: TA,
        criado_em: '2026-10-05T12:00:00+00:00', pago_em: '2026-10-05T12:01:00+00:00', reembolsado_em: null }
    ],
    pacotes: [{ chave: 'completo', nome: 'Relatório completo', preco_centavos: 3900, preco_lancamento_centavos: 2900, lancamento_ate: null, ativo: true, ordem: 2,
      descricao: { subtitulo: 'S', itens: ['a'] }, atualizado_em: '2026-10-05T12:00:00+00:00' }],
    rpc: {
      atualizar_pedido: (a) => ok({ ok: true, pedido: { id: a.p_id, status: a.p_status, pacote: 'completo', valorCentavos: 2900, email: 'bia@x.com' } }),
      resumo_vendas: (a) => ok({ ok: true, periodo: a.p_periodo, hoje: { vendas: 1, receitaCentavos: 2900 }, mes: { vendas: 1, receitaCentavos: 2900 },
        vendas: 1, receitaCentavos: 2900, cortesias: 0, estornos: 0, aguardando: 0, resumos: 4, compras: 1, conversao: 0.25, porPacote: [] })
    }
  });
  const { api, T, e } = x;
  const l = await api.listarPedidos(T, { status: 'pago', de: '2026-10-01', busca: 'bia' });
  assert.equal(l.pedidos.length, 1);
  assert.deepEqual([l.pedidos[0].faturaUrl, l.pedidos[0].valorCentavos, l.pedidos[0].cupom, l.pedidos[0].provedor, l.pedidos[0].provedorRef],
    ['https://asaas/i/1', 2900, '', 'asaas', '']);
  assert.ok(!('token_acesso' in l.pedidos[0]) && !('tokenAcesso' in l.pedidos[0]), 'o painel não recebe o token do cliente');
  assert.deepEqual(e.chamadas.filter((c) => c.tabela === 'pedidos').pop().eqs, [['status', 'pago'], ['criado_em', '>=2026-10-01T03:00:00Z']]);
  assert.equal((await api.listarPedidos(T, { busca: 'ninguem' })).pedidos.length, 0);
  assert.equal((await api.atualizarPedido(T, PED, { status: 'estornado' })).pedido.status, 'estornado');
  await assert.rejects(api.atualizarPedido(T, PED, { status: 'qualquer' }), /Situação inválida/);

  await assert.rejects(api.salvarCupom(T, { codigo: 'a b', tipo: 'percentual', valor: 10 }), /Código do cupom/);
  await assert.rejects(api.salvarCupom(T, { codigo: 'MUITO', tipo: 'percentual', valor: 150 }), /de 1 a 100/);
  const c = await api.salvarCupom(T, { codigo: 'lanca-10', tipo: 'percentual', valor: 10, pacotes: ['completo', 'X Y'], validoAte: '2026-12-31' });
  assert.deepEqual([c.cupom.codigo, c.cupom.pacotes, c.cupom.validoAte, c.cupom.usos], ['LANCA-10', ['completo'], '2026-12-31', 0]);
  assert.equal((await api.listarCupons(T)).cupons.length, 1);
  assert.deepEqual(await api.excluirCupom(T, 'lanca-10'), { ok: true, codigo: 'LANCA-10' });
  await assert.rejects(api.excluirCupom(T, 'LANCA-10'), /Cupom não encontrado/);

  const pk = await api.listarPacotes(T);
  assert.deepEqual([pk.pacotes[0].valorCentavos, pk.pacotes[0].emLancamento, pk.pacotes[0].lancamentoAte], [2900, true, '']);
  const s = await api.salvarPacote(T, { chave: 'completo', precoLancamentoCentavos: null, nome: '  Completo  ' });
  assert.deepEqual([s.pacote.nome, s.pacote.valorCentavos, s.pacote.emLancamento], ['Completo', 3900, false]);
  assert.deepEqual(e.chamadas.filter((q) => q.tabela === 'pacotes' && q.op === 'update').pop().dados, { nome: 'Completo', preco_lancamento_centavos: null });
  await assert.rejects(api.salvarPacote(T, { chave: 'completo', precoCentavos: -1 }), /Preço inválido/);
  await assert.rejects(api.salvarPacote(T, { chave: 'completo' }), /Nada para salvar/);

  const v = await api.resumoVendas(T, 'semana');
  assert.equal(v.periodo, '30d', 'período desconhecido vira 30d');
  assert.equal(v.conversao, 0.25);
  // Sem sessão: pede login.
  const anon = nova();
  await assert.rejects(anon.api.listarPedidos('', {}), (err) => err.sessaoExpirada === true);
});
