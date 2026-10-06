// Apoio aos testes das Edge Functions (Node, sem rede): fetch falso do ClickUp/Anthropic, banco em
// memória com a interface de supabase-adaptadores.criarDb e um supabase-js falso (query builder mínimo).
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
export const gas = require('../helpers/gas.js');
export const fixtures = require('../helpers/fixtures.js');

export const TOKEN_CU = 'pk_teste_123';

/**
 * fetch(url, opcoes) que atende o ClickUp falso de tests/helpers/gas.js (mais GET /task/{id}) e,
 * opcionalmente, a Anthropic falsa: anthropic({url, corpo, headers}) -> {codigo, corpo}.
 */
export function criarFetch(cuFalso, op) {
  op = op || {};
  const chamadas = [];
  async function fetchFalso(url, opcoes) {
    opcoes = opcoes || {};
    const metodo = String(opcoes.method || 'GET').toLowerCase();
    chamadas.push({ url: String(url), metodo, corpo: opcoes.body ? JSON.parse(opcoes.body) : undefined, headers: opcoes.headers || {} });
    if (String(url).startsWith('https://api.anthropic.com/')) {
      if (!op.anthropic) throw new Error('teste: Anthropic falsa não configurada');
      const r = op.anthropic({ url: String(url), corpo: JSON.parse(opcoes.body || '{}'), headers: opcoes.headers || {} });
      return new Response(typeof r.corpo === 'string' ? r.corpo : JSON.stringify(r.corpo || {}), { status: r.codigo });
    }
    if (!String(url).startsWith('https://api.clickup.com/api/v2/')) throw new Error('teste: chamada externa inesperada para ' + url);
    if (op.falha) {
      const f = op.falha({ metodo, url: String(url) });
      if (f) return new Response(JSON.stringify(f.corpo || {}), { status: f.codigo, headers: f.headers || {} });
    }
    // GET /task/{id}: o ClickUp falso do Apps Script não tem; responde aqui com nome, status e lista.
    const m = /\/api\/v2\/task\/([^/?]+)$/.exec(new URL(String(url)).pathname);
    if (metodo === 'get' && m) {
      if ((opcoes.headers || {}).Authorization !== cuFalso.token) return new Response('{"err":"Token invalid"}', { status: 401 });
      for (const l of Object.values(cuFalso.listas)) {
        const t = l.tarefas.find((x) => String(x.id) === decodeURIComponent(m[1]));
        if (t) return new Response(JSON.stringify({ id: t.id, name: t.name, status: { status: t.status }, list: { id: l.id } }), { status: 200 });
      }
      return new Response('{"err":"Task not found"}', { status: 404 });
    }
    const r = cuFalso.atender(String(url), { method: metodo, payload: opcoes.body, headers: opcoes.headers || {} });
    return new Response(JSON.stringify(r.corpo || {}), { status: r.codigo, headers: r.headers || {} });
  }
  fetchFalso.chamadas = chamadas;
  return fetchFalso;
}

export const UUID_PROC = '11111111-2222-4333-8444-555555555555';
export const UUID_ADMIN = 'aaaaaaaa-0000-4000-8000-000000000001';

/** Linha de public.processos de exemplo (ligada à lista L1 do ClickUp falso). */
export function linhaProcesso(extra) {
  return Object.assign({
    id: UUID_PROC, codigo: 'RCP2', nome: 'Recepcionista 2026', tipo: 'selecao', empresa: 'Clínica Alfa',
    vaga: 'Recepcionista', cidade: 'Campinas', consultor: 'Wellington', contratante: 'Dra. Marta',
    periodo_inicio: '2026-09-01', periodo_fim: '2026-10-15', clickup_list_id: 'L1',
    config: gas.configExemplo(), mostrar_resultado: false, ativo: true, criado_em: '2026-09-01T00:00:00Z'
  }, extra || {});
}

/** Banco em memória com a mesma interface de criarDb (supabase-adaptadores.js). */
export function criarDbFalso(inicial) {
  const st = Object.assign({ processos: [], respostas: [], relatorios: [], admins: [], configuracoes: {} }, inicial || {});
  const clone = (x) => (x === null || x === undefined ? x : JSON.parse(JSON.stringify(x)));
  return {
    st,
    async processoPorId(id) { return clone(st.processos.find((p) => p.id === id) || null); },
    async processoPorLista(listId) { return clone(st.processos.find((p) => p.clickup_list_id === String(listId) && p.ativo !== false) || null); },
    async respostasDoProcesso(proc) { return clone(st.respostas.filter((r) => r.processo_id === proc.id || r.avaliacao === proc.codigo)); },
    async respostaPorId(id) { return clone(st.respostas.find((r) => r.id === id) || null); },
    async reservarSync(id, marca, limiteIso) {
      const r = st.respostas.find((x) => x.id === id);
      if (!r) return false;
      const s = r.clickup_sync;
      const livre = !s || s.estado === 'erro' || (s.estado === 'sincronizando' && String(s.em) < limiteIso);
      if (!livre) return false;
      r.clickup_sync = clone(marca);
      return true;
    },
    async gravarSync(id, valor) { const r = st.respostas.find((x) => x.id === id); if (r) r.clickup_sync = clone(valor); },
    async relatorioInserir(reg) { st.relatorios.push(clone(reg)); },
    async relatorioLer(token) { return clone(st.relatorios.find((r) => r.token === token) || null); },
    async relatorioAtualizar(token, campos) { const r = st.relatorios.find((x) => x.token === token); if (r) Object.assign(r, clone(campos)); },
    async relatoriosListar(processoId) {
      return clone(st.relatorios.filter((r) => !processoId || r.processo_id === processoId)
        .map(({ dados, ...resto }) => resto));
    },
    async configLer(chave) { return Object.prototype.hasOwnProperty.call(st.configuracoes, chave) ? st.configuracoes[chave] : null; },
    async configGravar(chave, valor) { st.configuracoes[chave] = valor; },
    async adminsListar() { return clone(st.admins); },
    async adminInserir(userId, nome) {
      const a = st.admins.find((x) => x.user_id === userId);
      if (a) a.nome = nome; else st.admins.push({ user_id: userId, nome, criado_em: new Date().toISOString() });
    },
    async adminRemover(userId) { st.admins = st.admins.filter((a) => a.user_id !== userId); },
    async contarTentativa(tipo, chave, desdeIso, agoraIso) {
      st.limites = st.limites || [];
      st.limites.push({ tipo, chave: String(chave), em: agoraIso });
      return st.limites.filter((l) => l.tipo === tipo && l.chave === String(chave) && l.em >= desdeIso).length;
    }
  };
}

/** Auth falso (interface de criarAuthAdmin). */
export function criarAuthAdminFalso(usuarios) {
  const st = { usuarios: usuarios || [], convites: [], excluidos: [] };
  let n = 100;
  return {
    st,
    async usuarioPorId(id) { return st.usuarios.find((u) => u.id === id) || null; },
    async usuarioPorEmail(email) { return st.usuarios.find((u) => u.email === email) || null; },
    async convidar(email, op) {
      if (email.endsWith('@falha.com')) throw new Error('limite de e-mails atingido');
      const u = { id: 'bbbbbbbb-0000-4000-8000-' + String(++n).padStart(12, '0'), email, invited_at: '2026-10-05T10:00:00Z', created_at: '2026-10-05T10:00:00Z' };
      st.usuarios.push(u);
      st.convites.push({ email, op });
      return u;
    },
    async excluir(id) { st.excluidos.push(id); st.usuarios = st.usuarios.filter((u) => u.id !== id); }
  };
}

// ---------------------------------------------------------------------------
// supabase-js falso (só o que supabase-adaptadores.js usa)
// ---------------------------------------------------------------------------

function valorColuna(linha, col) {
  const m = /^([a-z_]+)->>([a-z_]+)$/.exec(col);
  if (m) {
    const obj = linha[m[1]];
    return obj && typeof obj === 'object' && obj[m[2]] !== undefined && obj[m[2]] !== null ? String(obj[m[2]]) : null;
  }
  return linha[col];
}

function separarTopo(s) {
  const partes = [];
  let nivel = 0, atual = '', aspas = false;
  for (const ch of s) {
    if (ch === '"') aspas = !aspas;
    if (!aspas && ch === '(') nivel++;
    if (!aspas && ch === ')') nivel--;
    if (!aspas && ch === ',' && nivel === 0) { partes.push(atual); atual = ''; continue; }
    atual += ch;
  }
  if (atual) partes.push(atual);
  return partes;
}

function condicao(termo) {
  const e = /^and\((.*)\)$/.exec(termo);
  if (e) { const cs = separarTopo(e[1]).map(condicao); return (l) => cs.every((c) => c(l)); }
  const m = /^(.+?)\.(eq|lt|gt|is)\.(.*)$/.exec(termo);
  if (!m) throw new Error('filtro falso não entende: ' + termo);
  const val = m[3].replace(/^"(.*)"$/, '$1');
  return (l) => {
    const v = valorColuna(l, m[1]);
    if (m[2] === 'is') return val === 'null' ? (v === null || v === undefined) : false;
    if (v === null || v === undefined) return false;
    if (m[2] === 'eq') return String(v) === val;
    if (m[2] === 'lt') return String(v) < val;
    return String(v) > val;
  };
}

export function criarSupabaseFalso(inicial) {
  const st = Object.assign({ tabelas: { processos: [], respostas: [], relatorios: [], admins: [], configuracoes: [] }, usuarios: [], jwts: {}, chamadas: [], convites: [] }, inicial || {});
  const chaves = { admins: 'user_id', configuracoes: 'chave', relatorios: 'token' };
  const clone = (x) => (x === null || x === undefined ? x : JSON.parse(JSON.stringify(x)));

  function consulta(tabela) {
    const q = { op: 'select', filtros: [], ordem: null, limite: null, retorna: false, unico: false, valores: null, conflito: null };
    const exec = () => {
      const linhas = st.tabelas[tabela];
      st.chamadas.push({ tabela, op: q.op });
      const casa = (l) => q.filtros.every((f) => f(l));
      if (q.op === 'insert') { linhas.push(...[].concat(clone(q.valores))); return { data: null, error: null }; }
      if (q.op === 'upsert') {
        const chave = q.conflito || chaves[tabela];
        [].concat(q.valores).forEach((v) => {
          const atual = linhas.find((l) => l[chave] === v[chave]);
          if (atual) Object.assign(atual, clone(v)); else linhas.push(clone(v));
        });
        return { data: null, error: null };
      }
      if (q.op === 'delete') { st.tabelas[tabela] = linhas.filter((l) => !casa(l)); return { data: null, error: null }; }
      if (q.op === 'update') {
        const alvo = linhas.filter(casa);
        alvo.forEach((l) => Object.assign(l, clone(q.valores)));
        return { data: q.retorna ? clone(alvo) : null, error: null };
      }
      let r = linhas.filter(casa);
      if (q.ordem) {
        const { col, asc } = q.ordem;
        r = r.slice().sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0) * (asc ? 1 : -1));
      }
      if (q.limite !== null) r = r.slice(0, q.limite);
      r = clone(r);
      if (q.cols && q.cols !== '*') {
        const cols = q.cols.split(',').map((c) => c.trim());
        r = r.map((l) => Object.fromEntries(cols.map((c) => [c, l[c] === undefined ? null : l[c]])));
      }
      if (q.unico) return { data: r[0] || null, error: null };
      return { data: r, error: null };
    };
    const b = {
      select(cols) { if (q.op === 'select') q.cols = cols; else q.retorna = true; return b; },
      insert(v) { q.op = 'insert'; q.valores = v; return b; },
      update(v) { q.op = 'update'; q.valores = v; return b; },
      upsert(v, o) { q.op = 'upsert'; q.valores = v; q.conflito = o && o.onConflict; return b; },
      delete() { q.op = 'delete'; return b; },
      eq(col, val) { q.filtros.push((l) => String(valorColuna(l, col)) === String(val)); return b; },
      in(col, vals) { q.filtros.push((l) => vals.map(String).includes(String(valorColuna(l, col)))); return b; },
      gte(col, val) { q.filtros.push((l) => valorColuna(l, col) !== null && valorColuna(l, col) !== undefined && String(valorColuna(l, col)) >= String(val)); return b; },
      or(expr) { const cs = separarTopo(expr).map(condicao); q.filtros.push((l) => cs.some((c) => c(l))); return b; },
      order(col, o) { q.ordem = { col, asc: !(o && o.ascending === false) }; return b; },
      limit(n) { q.limite = n; return b; },
      maybeSingle() { q.unico = true; return b; },
      then(ok, falha) { return Promise.resolve().then(exec).then(ok, falha); }
    };
    return b;
  }

  function createClient(url, chave, opcoes) {
    const auth = ((opcoes && opcoes.global && opcoes.global.headers) || {}).Authorization || '';
    const jwt = auth.replace(/^Bearer\s+/, '');
    return {
      from: (t) => consulta(t),
      async rpc(nome) {
        if (nome !== 'e_admin') return { data: null, error: { message: 'rpc falsa desconhecida' } };
        const uid = st.jwts[jwt];
        return { data: !!uid && st.tabelas.admins.some((a) => a.user_id === uid), error: null };
      },
      auth: {
        async getUser(token) {
          const uid = st.jwts[token];
          const u = uid && st.usuarios.find((x) => x.id === uid);
          return u ? { data: { user: clone(u) }, error: null } : { data: { user: null }, error: { message: 'invalid JWT' } };
        },
        admin: {
          async getUserById(id) {
            const u = st.usuarios.find((x) => x.id === id);
            return u ? { data: { user: clone(u) }, error: null } : { data: { user: null }, error: { message: 'not found' } };
          },
          async listUsers({ page, perPage }) {
            return { data: { users: clone(st.usuarios.slice((page - 1) * perPage, page * perPage)) }, error: null };
          },
          async inviteUserByEmail(email, o) {
            const u = { id: 'cccccccc-0000-4000-8000-' + String(st.usuarios.length + 1).padStart(12, '0'), email, invited_at: '2026-10-05T00:00:00Z' };
            st.usuarios.push(u);
            st.convites.push({ email, opcoes: clone(o) });
            return { data: { user: clone(u) }, error: null };
          },
          async deleteUser(id) {
            st.usuarios = st.usuarios.filter((u) => u.id !== id);
            st.tabelas.admins = st.tabelas.admins.filter((a) => a.user_id !== id);
            return { data: {}, error: null };
          }
        }
      },
      _chave: chave
    };
  }
  return { st, createClient };
}
