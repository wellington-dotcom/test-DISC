// Adaptadores entre a lógica das funções e o supabase-js (cliente "service role" no servidor).
// Recebem o cliente pronto (createClient vem do index.ts via jsr:@supabase/supabase-js@2), então
// são testáveis no Node com um cliente falso.

export const NOMES_ENV = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'CLICKUP_TOKEN',
  'CLICKUP_PASTA_ID', 'CLICKUP_WEBHOOK_SECRET', 'ANTHROPIC_API_KEY', 'SITE_URL',
  // Só para a aba Conexões (presença) e os pagamentos de teste (Stripe/InfinitePay): os valores nunca saem do servidor.
  'PAGAMENTO_PROVEDOR', 'STRIPE_SECRET_KEY', 'STRIPE_PUBLISHABLE_KEY', 'STRIPE_WEBHOOK_SECRET', 'INFINITEPAY_HANDLE', 'ASAAS_API_KEY', 'ASAAS_WEBHOOK_TOKEN', 'ASAAS_AMBIENTE',
  'RESEND_API_KEY', 'EMAIL_REMETENTE'];

/** Lê os segredos pelo getter (Deno.env.get). Ausente -> ''. */
export function lerEnv(get) {
  const env = {};
  NOMES_ENV.forEach((n) => { let v = ''; try { v = get(n) || ''; } catch (err) { v = ''; } env[n] = String(v).trim(); });
  return env;
}

const COLUNAS_TESTE = 'id, status, valor_centavos, checkout_url, provedor_dados, criado_em, pago_em';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function uuidValido(v) { return typeof v === 'string' && UUID.test(v); }

function falhaDb(error) {
  const e = new Error('falha no banco de dados (' + String((error && (error.message || error.code)) || 'erro').substring(0, 160) + ')');
  e.causa = error;
  return e;
}

async function dados(consulta) {
  const { data, error } = await consulta;
  if (error) throw falhaDb(error);
  return data;
}

/** Acesso às tabelas (public.*) com o cliente service role (ignora RLS: só código do servidor usa). */
export function criarDb(sb) {
  return {
    async processoPorId(id) {
      if (!uuidValido(String(id || ''))) return null;
      return dados(sb.from('processos').select('*').eq('id', id).maybeSingle());
    },
    async processoPorLista(listId) {
      const linhas = await dados(sb.from('processos').select('*').eq('clickup_list_id', String(listId)).eq('ativo', true)
        .order('criado_em', { ascending: false }).limit(1));
      return (linhas && linhas[0]) || null;
    },
    /** Respostas do DISC do processo (pelo processo_id; histórico importado só com o código também vale). */
    async respostasDoProcesso(proc) {
      let q = sb.from('respostas').select('id, pessoa_id, telefone, respostas, validacao, protocolo, recebido_em, foto, pessoas(foto)');
      q = /^[A-Z0-9]{4}$/.test(proc.codigo || '')
        ? q.or('processo_id.eq.' + proc.id + ',avaliacao.eq.' + proc.codigo)
        : q.eq('processo_id', proc.id);
      return (await dados(q.order('recebido_em', { ascending: true }))) || [];
    },
    async respostaPorId(id) {
      return dados(sb.from('respostas').select('id, processo_id, nome, telefone, respostas, validacao, protocolo, clickup_sync')
        .eq('id', id).maybeSingle());
    },
    /** Troca clickup_sync por "marca" só se estiver livre (vazio, com erro ou travado há mais de "limiteIso"). */
    async reservarSync(id, marca, limiteIso) {
      const linhas = await dados(sb.from('respostas').update({ clickup_sync: marca }).eq('id', id)
        .or('clickup_sync.is.null,clickup_sync->>estado.eq.erro,and(clickup_sync->>estado.eq.sincronizando,clickup_sync->>em.lt."' + limiteIso + '")')
        .select('id'));
      return !!(linhas && linhas.length);
    },
    async gravarSync(id, valor) {
      await dados(sb.from('respostas').update({ clickup_sync: valor }).eq('id', id));
    },
    async relatorioInserir(reg) {
      await dados(sb.from('relatorios').insert(reg));
    },
    async relatorioLer(token) {
      return dados(sb.from('relatorios').select('*').eq('token', token).maybeSingle());
    },
    async relatorioAtualizar(token, campos) {
      await dados(sb.from('relatorios').update(campos).eq('token', token));
    },
    async relatoriosListar(processoId) {
      let q = sb.from('relatorios').select('token, processo_id, status, criado_em, atualizado_em, publicado_em');
      if (processoId) {
        if (!uuidValido(processoId)) return [];
        q = q.eq('processo_id', processoId);
      }
      return (await dados(q.order('criado_em', { ascending: false }))) || [];
    },
    async configLer(chave) {
      const l = await dados(sb.from('configuracoes').select('valor').eq('chave', chave).maybeSingle());
      return l ? l.valor : null;
    },
    async configGravar(chave, valor) {
      await dados(sb.from('configuracoes').upsert({ chave, valor }, { onConflict: 'chave' }));
    },
    /** Anti-abuso (tabela limites_vendas): registra uma tentativa e devolve quantas houve desde "desdeIso" (inclui esta). */
    async contarTentativa(tipo, chave, desdeIso, agoraIso) {
      const c = String(chave).substring(0, 200);
      await dados(sb.from('limites_vendas').insert({ tipo, chave: c, em: agoraIso }));
      const linhas = await dados(sb.from('limites_vendas').select('id').eq('tipo', tipo).eq('chave', c).gte('em', desdeIso).limit(1000));
      return (linhas || []).length;
    },
    async adminsListar() {
      return (await dados(sb.from('admins').select('user_id, nome, criado_em, foto').order('criado_em', { ascending: true }))) || [];
    },
    async adminInserir(userId, nome) {
      await dados(sb.from('admins').upsert({ user_id: userId, nome }, { onConflict: 'user_id' }));
    },
    async adminRemover(userId) {
      await dados(sb.from('admins').delete().eq('user_id', userId));
    },
    // Pedidos de TESTE da aba Conexões (pedidos.teste = true; migração 20261013120000_conexoes.sql).
    async pedidoTesteInserir(reg) {
      return dados(sb.from('pedidos').insert(reg).select('id, criado_em').single());
    },
    async pedidoTesteLer(id) {
      if (!uuidValido(String(id || ''))) return null;
      return dados(sb.from('pedidos').select(COLUNAS_TESTE).eq('id', id).eq('teste', true).maybeSingle());
    },
    async pedidoTesteUltimo() {
      const linhas = await dados(sb.from('pedidos').select(COLUNAS_TESTE).eq('teste', true).order('criado_em', { ascending: false }).limit(1));
      return (linhas && linhas[0]) || null;
    },
    async pedidoTesteAtualizar(id, campos) {
      await dados(sb.from('pedidos').update(campos).eq('id', id).eq('teste', true));
    }
  };
}

/** Supabase Auth (API de administração; só com a service role key). */
export function criarAuthAdmin(sb) {
  const POR_PAGINA = 200;
  return {
    async usuarioPorId(id) {
      const { data, error } = await sb.auth.admin.getUserById(id);
      return error || !data ? null : data.user || null;
    },
    async usuarioPorEmail(email) {
      const alvo = String(email || '').toLowerCase();
      for (let pagina = 1; pagina <= 50; pagina++) {
        const { data, error } = await sb.auth.admin.listUsers({ page: pagina, perPage: POR_PAGINA });
        if (error) throw new Error('não foi possível ler os usuários (' + (error.message || 'erro') + ')');
        const lista = (data && data.users) || [];
        const achado = lista.find((u) => String(u.email || '').toLowerCase() === alvo);
        if (achado) return achado;
        if (lista.length < POR_PAGINA) break;
      }
      return null;
    },
    async convidar(email, op) {
      const opcoes = { data: { nome: op && op.nome ? op.nome : '' } };
      if (op && op.redirectTo) opcoes.redirectTo = op.redirectTo;
      const { data, error } = await sb.auth.admin.inviteUserByEmail(email, opcoes);
      if (error || !data || !data.user) throw new Error(String((error && error.message) || 'o Supabase não criou o usuário'));
      return data.user;
    },
    async excluir(id) {
      const { error } = await sb.auth.admin.deleteUser(id);
      if (error) throw new Error(String(error.message || 'erro'));
    }
  };
}

/**
 * Autenticador do painel: confere o JWT do usuário no Supabase Auth e pergunta ao banco se ele é
 * admin (RPC public.e_admin(), com o próprio JWT -> auth.uid()). {usuario, eAdmin} ou null.
 */
export function criarAutenticador(createClient, env) {
  return async function autenticar(authorization) {
    const m = /^Bearer\s+(\S+)\s*$/i.exec(String(authorization || ''));
    if (!m) return null;
    const jwt = m[1];
    if (jwt === env.SUPABASE_ANON_KEY) return null; // chave pública não é usuário logado
    const cliente = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: 'Bearer ' + jwt } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });
    const { data, error } = await cliente.auth.getUser(jwt);
    if (error || !data || !data.user) return null;
    const r = await cliente.rpc('e_admin');
    return { usuario: { id: data.user.id, email: data.user.email || '' }, eAdmin: !r.error && r.data === true };
  };
}

/** Tudo que as funções precisam, a partir do createClient do supabase-js e do getter de segredos. */
export function criarBaseSupabase(createClient, getEnv, extras) {
  const env = lerEnv(getEnv);
  const servico = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  return Object.assign({
    env,
    fetch: (u, o) => fetch(u, o),
    db: criarDb(servico),
    authAdmin: criarAuthAdmin(servico),
    autenticar: criarAutenticador(createClient, env)
  }, extras || {});
}
