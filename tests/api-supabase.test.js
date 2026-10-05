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
      respostas: opcoes.respostas || []
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
      order(c) { q.ordem = c; return b; },
      range(a, z) { q.intervalo = [a, z]; return b; },
      maybeSingle() { q.unico = true; return b; },
      then(ok, nok) { return Promise.resolve().then(() => executar(q)).then(ok, nok); }
    };
    return b;
  }

  function executar(q) {
    estado.chamadas.push({ tabela: q.tabela, op: q.op, dados: q.dados, eqs: q.eqs || [] });
    if (estado.falhaRede) throw new TypeError('Failed to fetch');
    if (!estado.sessao) return { data: q.op === 'select' ? [] : [], error: null }; // RLS: anon não vê nada
    if (opcoes.erroBanco && opcoes.erroBanco[q.tabela + '.' + q.op]) return { data: null, error: opcoes.erroBanco[q.tabela + '.' + q.op] };
    const linhas = estado.tabelas[q.tabela];
    const casa = (l) => q.filtros.every((f) => f(l));
    let res;
    if (q.op === 'select') {
      res = linhas.filter(casa);
      if (q.ordem) res = res.slice().sort((a, b) => String(a[q.ordem]).localeCompare(String(b[q.ordem])));
      if (q.intervalo) res = res.slice(q.intervalo[0], q.intervalo[1] + 1);
    } else if (q.op === 'insert') {
      const nova = Object.assign({ id: '33333333-3333-4333-8333-33333333333' + linhas.length, codigo: 'K7QZ', criado_em: '2026-10-05T12:00:00+00:00' }, q.dados);
      linhas.push(nova);
      res = [nova];
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

test('config.js: padrão continua appsscript; tem BACKEND, SUPABASE_URL e SUPABASE_ANON_KEY', () => {
  const cfg = require('../js/config.js');
  assert.equal(cfg.BACKEND, 'appsscript');
  assert.ok('SUPABASE_URL' in cfg && 'SUPABASE_ANON_KEY' in cfg);
  assert.match(cfg.API_URL, /^https:\/\/script\.google\.com\//);
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
      relatorio_publico: () => ({ data: { ok: true, relatorio: { titulo: 'R' }, publicadoEm: '2026-10-05T12:00:00.000Z' }, error: null })
    }
  });
  assert.deepEqual(await api.avaliacaoPublica('SEL1'), { ok: true, avaliacao: { codigo: 'SEL1', nome: 'Recepcionista', tipo: 'selecao', empresaNome: 'Clínica', mostrarResultado: false } });
  await assert.rejects(api.avaliacaoPublica('ZZZZ'), /Link inválido ou avaliação encerrada/);
  await assert.rejects(api.avaliacaoPublica(''), /Link inválido/);
  const t = 'a'.repeat(64);
  assert.deepEqual(await api.relatorioPublico(t), { ok: true, relatorio: { titulo: 'R' }, publicadoEm: '2026-10-05T12:00:00.000Z' });
  assert.deepEqual(e.chamadas.filter((c) => c.rpc === 'relatorio_publico')[0].args, { p_token: t });
  await assert.rejects(api.relatorioPublico(''), /Relatório não encontrado ou fora do ar/);
});

test('login: signInWithPassword + garantir_primeiro_admin -> {ok, token, usuario admin}; senha errada genérica', async () => {
  const { api, e, login } = await logado();
  assert.equal(login.ok, true);
  assert.equal(login.token, 'jwt-dona@empresa.com');
  assert.deepEqual(login.usuario, { id: UID, nome: 'Dona do Sistema', email: 'dona@empresa.com', papel: 'admin', empresaId: '', empresaNome: '' });
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
  assert.deepEqual(await api.eu(T), { ok: true, usuario: { id: UID, nome: 'Dona do Sistema', email: 'dona@empresa.com', papel: 'admin', empresaId: '', empresaNome: '' } });
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
  const { api, T } = await logado({ processos: [processo()], respostas: [resposta({ validacao: { versao: 1 } }), resposta({ id: 'antigo-sem-processo', processo_id: null, avaliacao: '', protocolo: null, idade: null, recebido_em: '2026-09-01T10:00:00+00:00' })] });
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
    processoId: PID, empresaNome: 'Clínica Exemplo', avaliacaoNome: 'Recepcionista 2026', avaliacaoTipo: 'selecao'
  });
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

test('salvarUsuario com id só muda o nome; listarEmpresas vazio e salvarEmpresa explica', async () => {
  const { api, T, e } = await logado();
  const r = await api.salvarUsuario(T, { id: UID, nome: 'Dona Renomeada', email: 'dona@empresa.com', papel: 'admin', ativo: true });
  assert.equal(r.usuario.nome, 'Dona Renomeada');
  assert.equal(e.admins[0].nome, 'Dona Renomeada');
  await assert.rejects(api.salvarUsuario(T, { id: UID, nome: 'Dona', ativo: false }), /exclua o usuário/);
  assert.deepEqual(await api.listarEmpresas(T), { ok: true, empresas: [] });
  await assert.rejects(api.salvarEmpresa(T, { nome: 'X' }), /a empresa agora é um texto no processo/);
});
