// @ts-nocheck
// ARQUIVO GERADO AUTOMATICAMENTE — NÃO EDITE. Gerado de supabase/funcoes-fonte/clickup-webhook/index.ts por: npm run montar:funcoes
// Autocontido: cole este arquivo inteiro no editor da Edge Function no painel do Supabase.

import { createClient } from 'jsr:@supabase/supabase-js@2';

// ======== supabase/funcoes-compartilhadas/regras.js ========
// Regras puras compartilhadas pelas Edge Functions (porte fiel de apps-script/Code.gs).
// ES module sem dependências: roda no Node (testes) e no Deno (Supabase). Nada de rede aqui.

const MSG_SESSAO = 'Sessão expirada. Entre de novo.';
const MSG_SEM_PERMISSAO = 'Sem permissão.';
const MSG_ERRO_INTERNO = 'Erro interno no servidor. Tente novamente em instantes.';

const LETRAS_DISC = ['D', 'I', 'S', 'C'];
const TOTAL_GRUPOS_DISC = 25;

/** {ok:false, erro, ...extra} — mesmo formato do Code.gs. */
function erro(mensagem, extra) {
  const r = { ok: false, erro: mensagem };
  if (extra) for (const k of Object.keys(extra)) r[k] = extra[k];
  return r;
}

/** Remove caracteres de controle, junta espaços repetidos, apara e corta no limite. */
function limparTexto(v, max) {
  if (v === null || v === undefined) return '';
  let s = String(v).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
  if (max && s.length > max) s = s.substring(0, max).trim();
  return s;
}

/** Texto multilinha: mantém quebras de linha, remove outros controles. */
function limparTextoLongo(v, max) {
  if (v === null || v === undefined) return '';
  let s = String(v).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, ' ').trim();
  if (max && s.length > max) s = s.substring(0, max).trim();
  return s;
}

function letrasContadas(texto) { return (String(texto).match(/\p{L}/gu) || []).length; }

function normalizarEmail(v) { return limparTexto(v, 120).toLowerCase(); }

function emailValido(email) {
  return typeof email === 'string' && email.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Mesma regra de js/scoring.js: 100 dígitos, cada bloco de 4 é permutação de 1..4. */
function validarRespostasCompactas(str) {
  if (typeof str !== 'string' || !/^[1-4]{100}$/.test(str)) return false;
  for (let i = 0; i < TOTAL_GRUPOS_DISC; i++) {
    const bloco = str.substr(i * 4, 4);
    if (new Set(bloco).size !== 4) return false;
  }
  return true;
}

/** Totais, percentuais (total/2.5) e perfil (maior + segundo maior; empate na ordem D,I,S,C). */
function calcularDisc(str) {
  if (!validarRespostasCompactas(str)) throw new Error('Respostas inválidas.');
  const totais = { D: 0, I: 0, S: 0, C: 0 };
  for (let i = 0; i < TOTAL_GRUPOS_DISC; i++) {
    for (let j = 0; j < 4; j++) totais[LETRAS_DISC[j]] += Number(str[i * 4 + j]);
  }
  const percentuais = {};
  LETRAS_DISC.forEach((l) => { percentuais[l] = Math.round((totais[l] / 2.5) * 10) / 10; });
  const ordem = LETRAS_DISC.slice().sort((a, b) => (totais[b] - totais[a]) || (LETRAS_DISC.indexOf(a) - LETRAS_DISC.indexOf(b)));
  return { totais, percentuais, ordem, primario: ordem[0], secundario: ordem[1], codigo: ordem[0] + ordem[1] };
}

function protocoloValido(v) {
  return typeof v === 'string' && /^[0-9]{2}[A-HJ-NP-Z]$/.test(v);
}

function normalizarProtocolo(v) {
  if (v === null || v === undefined) return '';
  const s = String(v).replace(/^'/, '').replace(/\s+/g, '').toUpperCase();
  return protocoloValido(s) ? s : '';
}

// ---------------------------------------------------------------------------
// Campos do ClickUp: nomes normalizados e termos sensíveis
// ---------------------------------------------------------------------------

const TERMOS_SENSIVEIS = ['sexo', 'genero', 'estado civil', 'filho', 'religi', 'gravid', 'etnia', 'raca',
  'cor da pele', 'orientacao', 'deficien', 'doenca', 'saude', 'antecedente', 'processo em seu nome', 'criminal'];
const TERMOS_ANTECEDENTES = ['antecedente', 'processo em seu nome', 'criminal'];

/** Nome de campo normalizado: minúsculas, sem acento, só letras/algarismos/% separados por 1 espaço. */
function normalizarNomeCampo(nome) {
  let s = String(nome === null || nome === undefined ? '' : nome).toLowerCase();
  s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
  return s.replace(/[^a-z0-9%]+/g, ' ').trim();
}

/** '' (pode ler), 'sensivel' (nunca ler) ou 'antecedente' (só com config.permitirAntecedentes). */
function classificarCampo(nome, config) {
  const n = ' ' + normalizarNomeCampo(nome);
  config = config || {};
  for (const termo of TERMOS_SENSIVEIS) {
    if (n.indexOf(' ' + termo) === -1) continue;
    if (termo === 'saude' && config.permitirSaude === true) continue;
    if (TERMOS_ANTECEDENTES.indexOf(termo) >= 0) return config.permitirAntecedentes === true ? 'antecedente' : 'sensivel';
    return 'sensivel';
  }
  return '';
}

function numeroOuPadrao(v, padrao, min, max) {
  const n = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v.replace(',', '.')) : NaN);
  if (!isFinite(n)) return padrao;
  return Math.max(min, Math.min(max, n));
}

function idSimplesConfig(v, prefixo, i) {
  const s = limparTexto(v, 40);
  return /^[A-Za-z0-9_-]{1,40}$/.test(s) ? s : prefixo + (i + 1);
}

/** Valida e completa a config do processo (mesma regra do Code.gs). {ok, config} ou {ok:false, erro}. */
function validarConfigProcesso(c) {
  if (c === undefined || c === null) c = {};
  if (typeof c !== 'object' || Array.isArray(c)) return erro('Configuração do processo inválida.');
  let json;
  try { json = JSON.stringify(c); } catch (err) { return erro('Configuração do processo inválida.'); }
  if (json.length > 40000) return erro('Configuração do processo grande demais.');
  const perfil = String(c.perfilIdeal || '').toUpperCase().replace(/[^DISC]/g, '');
  if (perfil.length > 2 || (perfil.length === 2 && perfil[0] === perfil[1])) return erro('Perfil ideal inválido: use 1 ou 2 letras entre D, I, S e C.');
  const permitirAntecedentes = c.permitirAntecedentes === true;
  const base = { permitirAntecedentes, permitirSaude: c.permitirSaude === true };
  let problema = null;
  const campo = (v) => {
    const nome = limparTexto(v, 120);
    if (nome && classificarCampo(nome, base) === 'sensivel') problema = problema || ('O campo "' + nome + '" é um dado sensível e não pode ser usado.');
    return nome;
  };
  const ids = {};
  const idUnico = (v, prefixo, i) => {
    let id = idSimplesConfig(v, prefixo, i);
    while (ids[id]) id = id + '_';
    ids[id] = true;
    return id;
  };
  const etapas = (Array.isArray(c.etapas) ? c.etapas : []).slice(0, 20).map((e, i) => {
    e = e && typeof e === 'object' ? e : {};
    return {
      id: idUnico(e.id, 'etapa', i), nome: limparTexto(e.nome, 80) || ('Etapa ' + (i + 1)),
      peso: numeroOuPadrao(e.peso, 0, 0, 1000), campo: campo(e.campo), descricao: limparTextoLongo(e.descricao, 1000)
    };
  });
  const bonus = (Array.isArray(c.bonus) ? c.bonus : []).slice(0, 20).map((b, i) => {
    b = b && typeof b === 'object' ? b : {};
    const regra = b.regra && typeof b.regra === 'object' ? b.regra : {};
    let r;
    if (regra.tipo === 'mapa') {
      const pontos = {};
      const origem = regra.pontos && typeof regra.pontos === 'object' ? regra.pontos : {};
      Object.keys(origem).slice(0, 50).forEach((k) => {
        const chave = limparTexto(k, 120);
        if (chave) pontos[chave] = numeroOuPadrao(origem[k], 0, -100, 100);
      });
      r = { tipo: 'mapa', pontos };
    } else {
      r = { tipo: 'checkbox', pontos: numeroOuPadrao(regra.pontos, 0, -100, 100) };
    }
    return { id: idUnico(b.id, 'bonus', i), nome: limparTexto(b.nome, 80) || ('Bônus ' + (i + 1)), campo: campo(b.campo), regra: r };
  });
  if (problema) return erro(problema);
  const corte = numeroOuPadrao(c.corte, 70, 0, 200);
  const faixa = numeroOuPadrao(c.faixaAvaliar, 55, 0, 200);
  if (faixa > corte) return erro('A faixa "avaliar" precisa ser menor ou igual à nota de corte.');
  return {
    ok: true,
    config: {
      perfilIdeal: perfil,
      explicacaoPerfil: limparTextoLongo(c.explicacaoPerfil, 2000),
      etapas,
      bonus,
      corte,
      faixaAvaliar: faixa,
      statusFinalistas: (Array.isArray(c.statusFinalistas) ? c.statusFinalistas : []).slice(0, 30)
        .map((x) => limparTexto(x, 80)).filter(Boolean),
      permitirAntecedentes,
      permitirSaude: c.permitirSaude === true
    }
  };
}

/** Config gravada (jsonb ou texto JSON), sempre completa com os padrões. */
function configDoProcesso(proc) {
  let bruto = proc && proc.config;
  if (typeof bruto === 'string') { try { bruto = JSON.parse(bruto); } catch (err) { bruto = {}; } }
  const v = validarConfigProcesso(bruto || {});
  return v.ok ? v.config : validarConfigProcesso({}).config;
}

/** Linha da tabela public.processos (snake_case) -> processo no formato usado pela lógica (camelCase). */
function processoDaLinha(l) {
  if (!l) return null;
  return {
    id: String(l.id),
    codigo: l.codigo || '',
    nome: l.nome || '',
    tipo: l.tipo || 'selecao',
    empresa: l.empresa || '',
    vaga: l.vaga || '',
    cidade: l.cidade || '',
    consultor: l.consultor || '',
    contratante: l.contratante || '',
    periodoInicio: l.periodo_inicio ? String(l.periodo_inicio).substring(0, 10) : '',
    periodoFim: l.periodo_fim ? String(l.periodo_fim).substring(0, 10) : '',
    clickupListId: l.clickup_list_id ? String(l.clickup_list_id) : '',
    config: l.config || {},
    ativa: l.ativo !== false
  };
}

// ======== supabase/funcoes-compartilhadas/clickup.js ========
// Integração com o ClickUp (API v2 REST) — porte de apps-script/ClickUp.gs para as Edge Functions.
// ES module puro: a rede entra por "fetch" injetado (nos testes, um ClickUp falso).
//
// Dados sensíveis: campos cujo nome começa uma palavra com sexo, genero, estado civil, filho, religi,
// gravid, etnia, raca, cor da pele, orientacao, deficien, doenca, saude, antecedente, processo em seu
// nome ou criminal NUNCA são lidos (classificarCampo). Antecedentes só com config.permitirAntecedentes
// e nunca entram no relatório. Telefone e e-mail nunca saem daqui (só servem para achar a tarefa).

const CLICKUP_API = 'https://api.clickup.com/api/v2';
const CU_LIMITE_POR_MINUTO = 90;   // o ClickUp aceita 100/min por token; sobra folga
const CU_MAX_PAGINAS = 50;         // 100 tarefas por página -> até 5.000 tarefas por lista
const MSG_CU_NAO_CONFIGURADO = 'ClickUp não configurado: falta o segredo CLICKUP_TOKEN nas Edge Functions do Supabase.';

const CU_CAMPOS_DISC = {
  D: 'DISC D %', I: 'DISC I %', S: 'DISC S %', C: 'DISC C %',
  perfil: 'DISC Perfil', confiabilidade: 'DISC Confiabilidade', codigo: 'DISC Código'
};
const CU_ORDEM_DISC = ['D', 'I', 'S', 'C', 'perfil', 'confiabilidade', 'codigo'];

const CU_APELIDOS = {
  telefone: ['whatsapp', 'telefone', 'celular'],
  idade: ['idade'],
  statusTrabalho: ['status de trabalho'],
  pretensao: ['pretensao salarial'],
  ultimoSalario: ['ultimo salario'],
  formacao: ['formacao', 'escolaridade', 'curso']
};

const CU_ROTULO_CONFIABILIDADE = { alta: 'Alta', media: 'Média', baixa: 'Baixa', indisponivel: 'Indisponível' };

function cuId(v) { return encodeURIComponent(String(v)); }

/**
 * Cliente do ClickUp para UMA execução: GET guardado (não repete a mesma leitura), escrita limpa o
 * guardado, ritmo de até 90 chamadas/min e uma nova tentativa depois de 429. Erros viram Error em pt-BR
 * (nunca com o token). "avisos" junta o que deu errado sem derrubar (o chamador grava para o painel).
 */
function criarClickUp(op) {
  const token = (op && op.token) || '';
  const fetchFn = op && op.fetch;
  const dormir = (op && op.dormir) || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const agora = (op && op.agora) || (() => Date.now());
  const estado = { chamadas: [], cache: new Map() };
  const avisos = [];

  async function respeitarLimite() {
    const t = agora();
    estado.chamadas = estado.chamadas.filter((x) => t - x < 60000);
    if (estado.chamadas.length >= CU_LIMITE_POR_MINUTO) {
      await dormir(Math.max(1000, 60000 - (t - estado.chamadas[0])));
      estado.chamadas = [];
    }
    estado.chamadas.push(agora());
  }

  async function requisicao(metodo, caminho, corpo) {
    if (!token) throw new Error(MSG_CU_NAO_CONFIGURADO);
    metodo = metodo.toUpperCase();
    if (metodo === 'GET' && estado.cache.has(caminho)) return estado.cache.get(caminho);
    if (metodo !== 'GET') estado.cache.clear();
    const opcoes = { method: metodo, headers: { Authorization: token } };
    if (corpo !== undefined) {
      opcoes.headers['Content-Type'] = 'application/json';
      opcoes.body = JSON.stringify(corpo);
    }
    for (let tentativa = 0; tentativa < 2; tentativa++) {
      await respeitarLimite();
      let resp;
      try {
        resp = await fetchFn(CLICKUP_API + caminho, opcoes);
      } catch (err) {
        throw new Error('não foi possível falar com o ClickUp (' + String(err && err.message || err).substring(0, 120) + ')');
      }
      const codigo = resp.status;
      if (codigo === 429 && tentativa === 0) {
        const reset = Number(resp.headers && resp.headers.get ? resp.headers.get('x-ratelimit-reset') : NaN) * 1000;
        const t = agora();
        const espera = isFinite(reset) && reset > t ? reset - t : 10000;
        await dormir(Math.min(60000, Math.max(1000, espera)));
        continue;
      }
      const texto = await resp.text().catch(() => '');
      let dados = {};
      try { dados = texto ? JSON.parse(texto) : {}; } catch (err) { dados = {}; }
      if (codigo >= 200 && codigo < 300) {
        if (metodo === 'GET') estado.cache.set(caminho, dados);
        return dados;
      }
      const e = new Error('o ClickUp respondeu ' + codigo + ' em ' + metodo + ' ' + caminho.split('?')[0] +
        (dados && dados.err ? ' (' + String(dados.err).substring(0, 120) + ')' : ''));
      e.status = codigo;
      throw e;
    }
    throw new Error('o ClickUp está recebendo chamadas demais. Tente de novo em 1 minuto.');
  }

  const cu = {
    configurado: !!token,
    pastaId: (op && op.pastaId) || '',
    avisos,
    registrarAviso(msg) { avisos.push(String(msg).substring(0, 300)); },
    get: (c) => requisicao('get', c),
    post: (c, corpo) => requisicao('post', c, corpo),
    put: (c, corpo) => requisicao('put', c, corpo),
    lista: (listId) => requisicao('get', '/list/' + cuId(listId)),
    async campos(listId) { return (await requisicao('get', '/list/' + cuId(listId) + '/field')).fields || []; },
    async tarefas(listId) {
      let todas = [];
      for (let pagina = 0; pagina < CU_MAX_PAGINAS; pagina++) {
        const r = await requisicao('get', '/list/' + cuId(listId) + '/task?page=' + pagina + '&include_closed=true&subtasks=false');
        const tarefas = r.tasks || [];
        todas = todas.concat(tarefas);
        if (r.last_page === true || !tarefas.length) break;
      }
      return todas;
    },
    tarefa: (id) => requisicao('get', '/task/' + cuId(id))
  };
  return cu;
}

/** Listas que aparecem no painel: as da pasta CLICKUP_PASTA_ID, ou todas as acessíveis. */
async function cuListas(cu) {
  const saida = [];
  const add = (listas, nomePasta) => {
    (listas || []).forEach((l) => saida.push({ id: String(l.id), nome: l.name || '', pasta: nomePasta || (l.folder && l.folder.name) || '' }));
  };
  if (cu.pastaId) {
    add((await cu.get('/folder/' + cuId(cu.pastaId) + '/list?archived=false')).lists, '');
    return saida;
  }
  for (const time of (await cu.get('/team')).teams || []) {
    for (const espaco of (await cu.get('/team/' + cuId(time.id) + '/space?archived=false')).spaces || []) {
      for (const f of (await cu.get('/space/' + cuId(espaco.id) + '/folder?archived=false')).folders || []) {
        const listas = Array.isArray(f.lists) ? f.lists : (await cu.get('/folder/' + cuId(f.id) + '/list?archived=false')).lists;
        add(listas, espaco.name + ' / ' + f.name);
      }
      add((await cu.get('/space/' + cuId(espaco.id) + '/list?archived=false')).lists, espaco.name);
    }
  }
  return saida;
}

// ---------------------------------------------------------------------------
// Conversão de valores dos campos personalizados
// ---------------------------------------------------------------------------

/** "R$ 2.500,00" -> 2500; "7,5" -> 7.5; número fica número. null se não der. */
function cuNumero(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  let s = String(v).replace(/[^0-9,.\-]/g, '');
  if (!s) return null;
  if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return isFinite(n) ? n : null;
}

/** Valor legível de um campo personalizado (mesma regra do ClickUp.gs). */
function cuValorCampo(campo, definicao) {
  if (!campo) return null;
  const tipo = campo.type || (definicao && definicao.type) || '';
  const cfg = campo.type_config || (definicao && definicao.type_config) || {};
  const v = campo.value;
  if (tipo === 'checkbox') return v === true || v === 'true';
  if (v === null || v === undefined || v === '') return null;
  const opcoes = cfg.options || [];
  if (tipo === 'drop_down') {
    const achada = opcoes.find((o) => String(o.id) === String(v)) || opcoes.find((o) => Number(o.orderindex) === Number(v));
    return achada ? String(achada.name || achada.label || '') : null;
  }
  if (tipo === 'labels') {
    const ids = Array.isArray(v) ? v : [v];
    const nomes = ids.map((id) => {
      const o = opcoes.find((x) => String(x.id) === String(id));
      return o ? (o.label || o.name || '') : '';
    }).filter(Boolean);
    return nomes.length ? nomes.join(', ') : null;
  }
  if (tipo === 'number' || tipo === 'currency' || tipo === 'emoji') return cuNumero(v);
  if (tipo === 'date') { const t = Number(v); return isFinite(t) ? new Date(t).toISOString() : null; }
  if (typeof v === 'object') return null;
  return String(v);
}

/** Telefone -> {ddd, fim (últimos 8 dígitos)}; aceita +55, 0 na frente, máscara. null se curto demais. */
function cuChaveTelefone(v) {
  let d = String(v === null || v === undefined ? '' : v).replace(/\D/g, '').replace(/^0+/, '');
  if ((d.length === 12 || d.length === 13) && d.indexOf('55') === 0) d = d.substring(2);
  if (d.length < 8) return null;
  return { ddd: d.length >= 10 ? d.substring(0, 2) : '', fim: d.slice(-8) };
}

function cuMesmoTelefone(a, b) {
  const x = cuChaveTelefone(a), y = cuChaveTelefone(b);
  if (!x || !y || x.fim !== y.fim) return false;
  return !x.ddd || !y.ddd || x.ddd === y.ddd;
}

function cuCampoPorNome(campos, nome, config) {
  const alvo = normalizarNomeCampo(nome);
  if (!alvo) return null;
  for (const c of campos) {
    if (normalizarNomeCampo(c.name) === alvo) return classificarCampo(c.name, config) === 'sensivel' ? null : c;
  }
  return null;
}

function cuCampoPorApelido(campos, papel, config) {
  const apelidos = CU_APELIDOS[papel];
  const livres = campos.filter((c) => classificarCampo(c.name, config) === '');
  for (const a of apelidos) for (const c of livres) if (normalizarNomeCampo(c.name) === a) return c;
  for (const a of apelidos) {
    for (const c of livres) if ((' ' + normalizarNomeCampo(c.name) + ' ').indexOf(' ' + a + ' ') >= 0) return c;
  }
  return null;
}

function cuCamposTelefone(campos, config) {
  return campos.filter((c) => {
    if (classificarCampo(c.name, config) !== '') return false;
    const n = ' ' + normalizarNomeCampo(c.name) + ' ';
    return c.type === 'phone' || CU_APELIDOS.telefone.some((a) => n.indexOf(' ' + a + ' ') >= 0);
  });
}

function cuValorNaTarefa(tarefa, definicao) {
  if (!definicao) return null;
  const c = (tarefa.custom_fields || []).find((x) => String(x.id) === String(definicao.id));
  return c ? cuValorCampo(c, definicao) : null;
}

function cuEhBriefing(nome) { return normalizarNomeCampo(nome).indexOf('briefing') === 0; }

// ---------------------------------------------------------------------------
// Confiabilidade (usa DISC_CONFIABILIDADE de js/confiabilidade.js, embutido nas funções)
// ---------------------------------------------------------------------------

function cuConfiabilidade(motorConfiabilidade, respostas, validacao) {
  if (motorConfiabilidade && typeof motorConfiabilidade.avaliar === 'function') {
    try {
      const r = motorConfiabilidade.avaliar(respostas, validacao || null);
      return { nivel: r.nivel, motivos: (r.motivos || []).slice(0, 10) };
    } catch (err) { /* cai no padrão abaixo */ }
  }
  return { nivel: 'indisponivel', motivos: ['Confiabilidade não calculada no servidor.'] };
}

function cuNivelDeTexto(t) {
  const n = normalizarNomeCampo(t);
  if (n.indexOf('alta') === 0) return 'alta';
  if (n.indexOf('media') === 0) return 'media';
  if (n.indexOf('baixa') === 0) return 'baixa';
  return 'indisponivel';
}

// ---------------------------------------------------------------------------
// Envio do candidato -> tarefa no ClickUp
// ---------------------------------------------------------------------------

/**
 * Grava o resultado do DISC na tarefa do candidato (achada pelo WhatsApp). Sem tarefa: cria
 * "<nome> (DISC)" com o WhatsApp na descrição e a etiqueta "sem formulário". Campos DISC que faltam
 * na lista -> resultado num comentário. resposta = {nome, telefone, respostas, validacao, protocolo}.
 * Lança erro se o ClickUp falhar.
 */
async function cuSincronizarEnvio(cu, processo, resposta, motorConfiabilidade) {
  if (!cu.configurado) return { ok: false, avisos: [MSG_CU_NAO_CONFIGURADO] };
  const listId = processo.clickupListId;
  const config = configDoProcesso(processo);
  const protocolo = resposta.protocolo || '';
  const campos = await cu.campos(listId);
  const telefones = cuCamposTelefone(campos, config);
  const avisos = [];
  let tarefa = null;
  if (telefones.length) {
    const tarefas = await cu.tarefas(listId);
    for (const t of tarefas) {
      if (tarefa) break;
      if (cuEhBriefing(t.name)) continue;
      for (const c of telefones) {
        const tel = cuValorNaTarefa(t, c);
        if (tel && cuMesmoTelefone(tel, resposta.telefone)) { tarefa = t; break; }
      }
    }
  } else {
    avisos.push('A lista não tem campo de WhatsApp/telefone: não deu para achar a tarefa do candidato.');
  }
  let criada = false;
  if (!tarefa) {
    tarefa = await cu.post('/list/' + cuId(listId) + '/task', {
      name: resposta.nome + ' (DISC)',
      description: 'WhatsApp: +' + resposta.telefone + '\nCriada pelo teste DISC: o candidato não foi encontrado na lista (sem formulário).',
      tags: ['sem formulário']
    });
    criada = true;
  }
  const r = calcularDisc(resposta.respostas);
  const conf = cuConfiabilidade(motorConfiabilidade, resposta.respostas, resposta.validacao);
  const valores = {
    D: r.percentuais.D, I: r.percentuais.I, S: r.percentuais.S, C: r.percentuais.C,
    perfil: r.codigo, confiabilidade: CU_ROTULO_CONFIABILIDADE[conf.nivel] || 'Indisponível', codigo: protocolo
  };
  const faltando = [];
  for (const k of CU_ORDEM_DISC) {
    const campo = cuCampoPorNome(campos, CU_CAMPOS_DISC[k], config);
    if (!campo) { faltando.push(CU_CAMPOS_DISC[k]); continue; }
    let valor = valores[k];
    if (campo.type === 'drop_down') {
      const opcoes = (campo.type_config && campo.type_config.options) || [];
      const opcao = opcoes.find((o) => normalizarNomeCampo(o.name) === normalizarNomeCampo(valor));
      if (!opcao) { faltando.push(CU_CAMPOS_DISC[k]); continue; }
      valor = opcao.id;
    } else if (campo.type !== 'number' && campo.type !== 'currency') {
      valor = String(valor);
    }
    await cu.post('/task/' + cuId(tarefa.id) + '/field/' + cuId(campo.id), { value: valor });
  }
  if (faltando.length) {
    await cu.post('/task/' + cuId(tarefa.id) + '/comment', {
      comment_text: 'Resultado do teste DISC\n' +
        'Perfil: ' + valores.perfil + '\n' +
        'D ' + valores.D + '% · I ' + valores.I + '% · S ' + valores.S + '% · C ' + valores.C + '%\n' +
        'Confiabilidade: ' + valores.confiabilidade + '\n' +
        'Código: ' + valores.codigo,
      notify_all: false
    });
    avisos.push('Campos que faltam na lista: ' + faltando.join(', ') + '. O resultado foi gravado num comentário da tarefa.');
  }
  if (criada) avisos.push('Candidato não encontrado pelo WhatsApp: tarefa "' + resposta.nome + ' (DISC)" criada com a etiqueta "sem formulário".');
  avisos.forEach((a) => cu.registrarAviso('Envio ' + protocolo + ': ' + a));
  return { ok: true, tarefaId: String(tarefa.id), criada, avisos };
}

// ---------------------------------------------------------------------------
// Dados normalizados do processo (contrato "processoDados")
// ---------------------------------------------------------------------------

/** Linha de public.respostas -> item com resultado recalculado (ignora linha com respostas inválidas). */
function itemDaResposta(l) {
  let resultado = null;
  try { resultado = calcularDisc(String(l.respostas || '')); } catch (err) { resultado = null; }
  let validacao = l.validacao === undefined ? null : l.validacao;
  if (typeof validacao === 'string') { try { validacao = JSON.parse(validacao); } catch (err) { validacao = null; } }
  return {
    id: String(l.id), telefone: l.telefone || '', respostas: l.respostas || '', validacao,
    protocolo: normalizarProtocolo(l.protocolo), resultado,
    pessoaId: l.pessoa_id ? String(l.pessoa_id) : '', recebidoEm: l.recebido_em ? String(l.recebido_em) : '',
    foto: fotoDaLinha(l)
  };
}

/** Foto da resposta ou, sem ela, a da ficha da pessoa (pessoas embutida); '' se nenhuma válida. */
function fotoDaLinha(l) {
  const ok = (f) => typeof f === 'string' && f.length <= 40000 && /^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/=]+$/.test(f);
  if (ok(l.foto)) return l.foto;
  const p = Array.isArray(l.pessoas) ? l.pessoas[0] : l.pessoas;
  return p && ok(p.foto) ? p.foto : '';
}

/**
 * Mesma pessoa com várias respostas no processo: fica só a MAIS RECENTE (por recebido_em). A pessoa é o
 * mesmo WhatsApp (como public.pessoas; vale também para linha antiga ainda sem pessoa_id) ou, sem telefone
 * utilizável, o pessoa_id. Mantém a ordem original das que ficam.
 */
function respostasMaisRecentesPorPessoa(itens) {
  const tempo = (it) => { const t = Date.parse(it.recebidoEm); return isNaN(t) ? -Infinity : t; };
  const chave = (it) => {
    const t = cuChaveTelefone(it.telefone);
    if (t) return 't:' + t.ddd + t.fim;
    return it.pessoaId ? 'p:' + it.pessoaId : 'id:' + it.id;
  };
  const escolhida = {};
  itens.forEach((it, i) => {
    const k = chave(it);
    if (escolhida[k] === undefined || tempo(it) >= tempo(itens[escolhida[k]])) escolhida[k] = i;
  });
  const ficam = new Set(Object.values(escolhida));
  return itens.filter((_, i) => ficam.has(i));
}

function cuDiscDaResposta(item, motorConfiabilidade) {
  return {
    percentuais: item.resultado.percentuais,
    codigo: item.resultado.codigo,
    confiabilidade: cuConfiabilidade(motorConfiabilidade, item.respostas, item.validacao),
    protocolo: item.protocolo || ''
  };
}

function cuDiscDaTarefa(tarefa, camposDisc) {
  const v = (k) => (camposDisc[k] ? cuValorNaTarefa(tarefa, camposDisc[k]) : null);
  const p = { D: cuNumero(v('D')), I: cuNumero(v('I')), S: cuNumero(v('S')), C: cuNumero(v('C')) };
  if (p.D === null || p.I === null || p.S === null || p.C === null) return null;
  let codigo = String(v('perfil') || '').toUpperCase().replace(/[^DISC]/g, '').substring(0, 2);
  if (codigo.length < 2) codigo = ['D', 'I', 'S', 'C'].sort((a, b) => p[b] - p[a]).slice(0, 2).join('');
  return {
    percentuais: p, codigo,
    confiabilidade: { nivel: cuNivelDeTexto(v('confiabilidade')), motivos: [] },
    protocolo: normalizarProtocolo(v('codigo')) || String(v('codigo') || '').substring(0, 12)
  };
}

function cuNota(v) {
  const n = cuNumero(v);
  return n === null ? null : Math.max(0, Math.min(10, n));
}

/**
 * Monta processoDados a partir do ClickUp e das respostas do DISC gravadas no banco (linhas de
 * public.respostas do processo). Só lê os campos que o contrato usa. Lança erro se o ClickUp falhar.
 */
async function cuMontarDadosProcesso(cu, proc, linhasRespostas, motorConfiabilidade) {
  const config = configDoProcesso(proc);
  const listId = proc.clickupListId;
  const lista = await cu.lista(listId);
  const campos = await cu.campos(listId);
  const tarefas = await cu.tarefas(listId);
  const avisos = [];

  const papeis = {};
  Object.keys(CU_APELIDOS).forEach((p) => { if (p !== 'telefone') papeis[p] = cuCampoPorApelido(campos, p, config); });
  const telefones = cuCamposTelefone(campos, config);
  const camposDisc = {};
  CU_ORDEM_DISC.forEach((k) => { camposDisc[k] = cuCampoPorNome(campos, CU_CAMPOS_DISC[k], config); });
  const antecedentes = config.permitirAntecedentes === true
    ? campos.filter((c) => classificarCampo(c.name, config) === 'antecedente')
    : [];

  const campoConfigurado = (nomeCampo, rotulo) => {
    if (!nomeCampo) { avisos.push(rotulo + ' sem campo do ClickUp configurado.'); return null; }
    if (classificarCampo(nomeCampo, config) === 'sensivel') {
      avisos.push('Campo "' + nomeCampo + '" é um dado sensível e foi ignorado.');
      return null;
    }
    const c = cuCampoPorNome(campos, nomeCampo, config);
    if (!c) avisos.push('Campo "' + nomeCampo + '" não encontrado na lista');
    return c;
  };
  const camposEtapa = {};
  config.etapas.forEach((e) => { camposEtapa[e.id] = campoConfigurado(e.campo, 'Etapa "' + e.nome + '"'); });
  const camposBonus = {};
  config.bonus.forEach((b) => { camposBonus[b.id] = campoConfigurado(b.campo, 'Bônus "' + b.nome + '"'); });

  const respostas = respostasMaisRecentesPorPessoa((linhasRespostas || []).map(itemDaResposta).filter((it) => it.resultado));
  const usadas = {};
  const finalistasStatus = config.statusFinalistas.map(normalizarNomeCampo);

  const candidatos = [];
  for (const t of tarefas) {
    if (cuEhBriefing(t.name)) continue;
    const fones = telefones.map((c) => cuValorNaTarefa(t, c)).filter(Boolean);
    let disc = null;
    let foto = '';
    for (const resp of respostas) {
      if (disc) break;
      if (usadas[resp.id]) continue;
      if (fones.some((f) => cuMesmoTelefone(f, resp.telefone))) {
        disc = cuDiscDaResposta(resp, motorConfiabilidade);
        foto = resp.foto || '';
        usadas[resp.id] = true;
      }
    }
    if (!disc) disc = cuDiscDaTarefa(t, camposDisc);

    const idadeBruta = cuValorNaTarefa(t, papeis.idade);
    let idade = typeof idadeBruta === 'number' ? Math.round(idadeBruta) : null;
    let idadeFaixa = (idadeBruta !== null && typeof idadeBruta !== 'number') ? String(idadeBruta) : null;
    if (idade === null && idadeFaixa && /^\s*\d{1,3}\s*$/.test(idadeFaixa)) { idade = Number(idadeFaixa); idadeFaixa = null; }

    const notas = {};
    let temNota = false;
    config.etapas.forEach((e) => {
      notas[e.id] = cuNota(cuValorNaTarefa(t, camposEtapa[e.id]));
      if (notas[e.id] !== null) temNota = true;
    });
    const bonusValores = {};
    config.bonus.forEach((b) => {
      const c = camposBonus[b.id];
      bonusValores[b.id] = c ? cuValorNaTarefa(t, c) : null;
    });
    const status = (t.status && t.status.status) || '';
    const finalista = finalistasStatus.length
      ? finalistasStatus.indexOf(normalizarNomeCampo(status)) >= 0
      : (temNota || !!disc);
    const texto = (c) => { const v = cuValorNaTarefa(t, c); return v === null || v === undefined ? null : String(v); };
    const cand = {
      id: String(t.id),
      nome: limparTexto(t.name, 120).replace(/\s*\(DISC\)\s*$/, ''),
      status,
      criadoEm: isFinite(Number(t.date_created)) && t.date_created ? new Date(Number(t.date_created)).toISOString() : '',
      idade,
      idadeFaixa,
      statusTrabalho: texto(papeis.statusTrabalho),
      pretensao: cuNumero(cuValorNaTarefa(t, papeis.pretensao)),
      ultimoSalario: cuNumero(cuValorNaTarefa(t, papeis.ultimoSalario)),
      formacao: texto(papeis.formacao),
      notas,
      bonusValores,
      disc,
      finalista
    };
    if (foto) cand.foto = foto;
    if (antecedentes.length) {
      cand.antecedentes = antecedentes.map((c) => cuValorNaTarefa(t, c))
        .filter((v) => v !== null && v !== false).map(String).join('; ') || null;
    }
    candidatos.push(cand);
  }
  const sobra = respostas.filter((r) => !usadas[r.id]).length;
  if (sobra) avisos.push(sobra + (sobra === 1 ? ' resposta' : ' respostas') + ' do DISC deste processo sem tarefa correspondente no ClickUp (WhatsApp diferente).');

  return {
    processo: {
      id: proc.id, nome: proc.nome, codigo: proc.codigo,
      empresa: proc.empresa || '',
      vaga: proc.vaga || '', cidade: proc.cidade || '', consultor: proc.consultor || '',
      contratante: proc.contratante || '',
      periodo: { inicio: proc.periodoInicio || '', fim: proc.periodoFim || '' },
      clickupListId: proc.clickupListId
    },
    config,
    status: (lista.statuses || []).map((s) => ({ nome: s.status, tipo: s.type, cor: s.color })),
    candidatos,
    avisos
  };
}

// ======== supabase/funcoes-compartilhadas/avisos.js ========
// Avisos do ClickUp para o painel (clickup.status): últimos 20, válidos por 6 h, guardados na tabela
// public.configuracoes (chave "clickup_avisos"). Equivale ao CacheService do Apps Script.
const CHAVE_AVISOS = 'clickup_avisos';
const MAX_AVISOS = 20;
const VALIDADE_AVISOS_MS = 6 * 60 * 60 * 1000;

function avisosValidos(bruto, agoraMs) {
  let lista = [];
  try { lista = JSON.parse(bruto || '[]') || []; } catch (err) { lista = []; }
  if (!Array.isArray(lista)) return [];
  return lista.filter((a) => a && typeof a.aviso === 'string' && agoraMs - Date.parse(a.em) < VALIDADE_AVISOS_MS);
}

async function lerAvisos(db, agoraMs) {
  try { return avisosValidos(await db.configLer(CHAVE_AVISOS), agoraMs); } catch (err) { return []; }
}

/** Junta os avisos novos (mais recentes primeiro). Nunca lança: aviso não derruba nada. */
async function gravarAvisos(db, novos, agoraMs) {
  if (!novos || !novos.length) return;
  try { novos.forEach((m) => console.warn(m)); } catch (err) { /* sem console */ }
  try {
    const em = new Date(agoraMs).toISOString();
    const atuais = await lerAvisos(db, agoraMs);
    const lista = novos.slice().reverse().map((m) => ({ em, aviso: String(m).substring(0, 300) })).concat(atuais);
    await db.configGravar(CHAVE_AVISOS, JSON.stringify(lista.slice(0, MAX_AVISOS)));
  } catch (err) { /* aviso nunca derruba nada */ }
}

// ======== supabase/funcoes-compartilhadas/relatorio.js ========
// Relatório do processo seletivo — porte de apps-script/Relatorio.gs (sem a divisão em partes: no
// Postgres o JSON inteiro vai numa coluna jsonb). O texto é montado pelo MESMO motor do site
// (js/relatorio-motor.js, embutido nas funções por scripts/montar-funcoes.mjs).

const REL_MAX_JSON = 400000;
const REL_MAX_TEXTO = 4000;
const REL_MAX_TEXTOS_IA = 80;
const MSG_REL_NAO_ENCONTRADO = 'Relatório não encontrado ou fora do ar.';
const REL_IA_URL = 'https://api.anthropic.com/v1/messages';
const REL_IA_MODELO = 'claude-opus-5-5';

function relTokenValido(t) { return typeof t === 'string' && /^[0-9a-f]{40,128}$/.test(t); }

/** Token aleatório de 64 caracteres hexadecimais (32 bytes do gerador criptográfico). */
function relNovoToken() {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Primeiro nome + inicial do último sobrenome ("Maria da Silva" -> "Maria S."). */
function relNomeCurto(nome) {
  const partes = limparTexto(nome, 120).split(' ').filter((p) => /\p{L}/u.test(p));
  if (partes.length < 2) return partes[0] || '';
  return partes[0] + ' ' + partes[partes.length - 1].charAt(0).toUpperCase() + '.';
}

// Fotos dos candidatos (data URL JPEG até 40 000 caracteres, a mesma regra do banco).
const REL_FOTO_MAX = 40000;
const REL_MAX_JSON_COM_FOTOS = 1500000;
const RE_FOTO = /^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/=]+$/;
function relFotoValida(f) { return typeof f === 'string' && f.length <= REL_FOTO_MAX && RE_FOTO.test(f); }

const PARTICULAS = { de: 1, da: 1, das: 1, do: 1, dos: 1, e: 1, di: 1, du: 1, del: 1, van: 1, von: 1 };

/**
 * Mesmos nomes curtos que o motor usa nos candidatos (nomesCurtos de js/relatorio-motor.js, com o
 * primeiroNome dele): {idDoCandidato: "Ana P."}. Serve para pôr a foto certa em cada linha do relatório.
 */
function relNomesCurtos(motor, candidatos) {
  const mapa = {};
  const usados = {};
  const texto = (v) => (v === null || v === undefined ? '' : String(v));
  const maiuscula = (v) => { v = texto(v); return v.charAt(0).toUpperCase() + v.slice(1); };
  (candidatos || []).filter((c) => c && typeof c === 'object').forEach((c) => {
    let curto = motor.primeiroNome(c.nome);
    if (usados[curto]) {
      const partes = texto(c.nome).split(/\s+/).filter((p) => p && !PARTICULAS[p.toLowerCase()]);
      let alt = maiuscula(partes[0] || curto);
      for (let i = 1; i < partes.length; i++) alt += ' ' + partes[i].charAt(0).toUpperCase() + '.';
      curto = usados[alt] ? curto : alt;
    }
    const base = curto;
    let n = 2;
    while (usados[curto]) curto = base + ' (' + (n++) + ')';
    usados[curto] = true;
    mapa[c.id] = curto;
  });
  return mapa;
}

/**
 * Põe "foto" em cada candidato do relatório (ranking.linhas e disc.quadro) a partir de candidatos[].foto.
 * Só fotos válidas; sem foto o campo não aparece (a página mostra as iniciais). Se o JSON passar de
 * REL_MAX_JSON_COM_FOTOS, as fotos que não couberem ficam de fora (na ordem do ranking).
 */
function relAplicarFotos(relatorio, motor, candidatos) {
  if (!relatorio || !motor || typeof motor.primeiroNome !== 'function') return relatorio;
  const curtos = relNomesCurtos(motor, candidatos);
  const porNome = {};
  (candidatos || []).forEach((c) => {
    if (c && relFotoValida(c.foto) && curtos[c.id]) porNome[curtos[c.id]] = c.foto;
  });
  if (!Object.keys(porNome).length) return relatorio;
  const linhas = (relatorio.ranking && Array.isArray(relatorio.ranking.linhas)) ? relatorio.ranking.linhas : [];
  const quadro = (relatorio.disc && Array.isArray(relatorio.disc.quadro)) ? relatorio.disc.quadro : [];
  let tamanho = JSON.stringify(relatorio).length;
  const nomes = [];
  linhas.concat(quadro).forEach((l) => { if (l && porNome[l.nome] && nomes.indexOf(l.nome) < 0) nomes.push(l.nome); });
  nomes.forEach((nome) => {
    const alvos = linhas.concat(quadro).filter((l) => l && l.nome === nome);
    const custo = alvos.length * (porNome[nome].length + 10);
    if (tamanho + custo > REL_MAX_JSON_COM_FOTOS) return;
    alvos.forEach((l) => { l.foto = porNome[nome]; });
    tamanho += custo;
  });
  return relatorio;
}

/**
 * Roda o motor com uma cópia dos dados SEM antecedentes e devolve o relatório. Garante, no fim, que
 * nenhum nome completo ficou no JSON (troca por "Nome S.") e tira o id da lista do ClickUp. As fotos dos
 * candidatos (candidatos[].foto) entram depois, em ranking.linhas[].foto e disc.quadro[].foto.
 */
function relMontar(motor, dados, geradoEm) {
  if (!motor || typeof motor.montar !== 'function') throw new Error('Motor do relatório ausente nas Edge Functions (rode npm run montar:funcoes).');
  const copia = JSON.parse(JSON.stringify(dados));
  (copia.candidatos || []).forEach((c) => { delete c.antecedentes; delete c.foto; });
  const relatorio = motor.montar(copia, { geradoEm });
  if (relatorio && relatorio.processo) delete relatorio.processo.clickupListId;
  let json = JSON.stringify(relatorio);
  (dados.candidatos || []).forEach((c) => {
    const completo = limparTexto(c.nome, 120);
    const curto = relNomeCurto(completo);
    if (completo && curto && completo !== curto && completo.indexOf(' ') > 0) {
      json = json.split(JSON.stringify(completo).slice(1, -1)).join(JSON.stringify(curto).slice(1, -1));
    }
  });
  if (json.length > REL_MAX_JSON) throw new Error('Relatório grande demais para guardar.');
  return relAplicarFotos(JSON.parse(json), motor, dados.candidatos);
}

/**
 * Aplica a edição dos textos: aceita {relatorio:{textos}} ou {textos}; cada valor é texto ou {texto}.
 * Só textos que já existem; marca origem 'editado'. Devolve o número de alterados (ou null se nada veio).
 */
function relAplicarEdicao(relatorio, corpo) {
  const novos = (corpo.relatorio && typeof corpo.relatorio === 'object' && corpo.relatorio.textos) || corpo.textos;
  if (!novos || typeof novos !== 'object' || Array.isArray(novos)) return null;
  const textos = relatorio.textos || {};
  let alterados = 0;
  Object.keys(novos).forEach((id) => {
    if (!Object.prototype.hasOwnProperty.call(textos, id)) return;
    const v = novos[id];
    let texto = typeof v === 'string' ? v : (v && typeof v.texto === 'string' ? v.texto : null);
    if (texto === null) return;
    texto = limparTextoLongo(texto, REL_MAX_TEXTO);
    if (textos[id] && texto === textos[id].texto) return;
    textos[id] = { texto, origem: 'editado' };
    alterados++;
  });
  return alterados;
}

/** Endereço do site: baseUrl do painel (https) ou SITE_URL. '' se nenhum. Termina em "/". */
function relBaseSite(baseUrl, siteUrl) {
  let b = typeof baseUrl === 'string' ? baseUrl.trim() : '';
  if (!/^https:\/\/[^\s"'<>]+$/.test(b)) b = siteUrl || '';
  b = String(b).trim().split('#')[0].split('?')[0];
  if (!/^https?:\/\/[^\s"'<>]+$/.test(b)) return '';
  if (b.charAt(b.length - 1) !== '/') {
    const ultimo = b.substring(b.lastIndexOf('/') + 1);
    // "https://site.com.br" ou ".../pasta" (sem ponto no fim) -> é pasta; ".../admin.html" -> tira o arquivo.
    if (/^https?:\/\/[^/]+$/.test(b) || ultimo.indexOf('.') === -1) b = b + '/';
    else b = b.substring(0, b.lastIndexOf('/') + 1);
  }
  return b;
}

// ---------------------------------------------------------------------------
// IA (opcional): reescreve textos com a API da Anthropic (Messages API) — mesma chamada do Relatorio.gs
// ---------------------------------------------------------------------------

const REL_IA_SISTEMA = [
  'Você revisa textos de um relatório de processo seletivo escrito por uma consultoria de RH (Gestão sem Caos)',
  'para a empresa contratante. Reescreva cada texto em português do Brasil simples, com tom de consultor,',
  'frases curtas e sem jargão técnico. Regras: mantenha exatamente os mesmos fatos, números, notas, nomes e',
  'conclusões; não invente nada; não acrescente recomendações novas; nunca mencione idade, sexo, estado civil,',
  'filhos, saúde, religião, etnia ou qualquer outro dado pessoal sensível. Devolva todos os ids recebidos.'
].join(' ');

/** Corpo da requisição à Messages API (igual ao Relatorio.gs). */
function relCorpoIa(itens) {
  return {
    model: REL_IA_MODELO,
    max_tokens: 16000,
    fallbacks: 'default', // se o modelo recusar, a própria API tenta o modelo reserva recomendado
    output_config: {
      effort: 'low',
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            textos: {
              type: 'array',
              items: {
                type: 'object',
                properties: { id: { type: 'string' }, texto: { type: 'string' } },
                required: ['id', 'texto'],
                additionalProperties: false
              }
            }
          },
          required: ['textos'],
          additionalProperties: false
        }
      }
    },
    system: REL_IA_SISTEMA,
    messages: [{ role: 'user', content: 'Reescreva estes textos (JSON com id e texto):\n' + JSON.stringify(itens) }]
  };
}

/** Chama a Messages API e devolve {id: texto}. Lança Error em pt-BR se algo der errado. */
async function relChamarIa(fetchFn, chave, itens) {
  let resp;
  try {
    resp = await fetchFn(REL_IA_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': chave,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'server-side-fallback-2026-07-01'
      },
      body: JSON.stringify(relCorpoIa(itens))
    });
  } catch (err) {
    throw new Error('não foi possível falar com a IA.');
  }
  const codigo = resp.status;
  let dados;
  try { dados = JSON.parse((await resp.text()) || '{}'); } catch (err) { dados = {}; }
  if (codigo !== 200) {
    const tipo = dados && dados.error && dados.error.type ? ' (' + dados.error.type + ')' : '';
    throw new Error('a IA respondeu ' + codigo + tipo + '.');
  }
  if (dados.stop_reason === 'refusal') throw new Error('a IA não quis reescrever estes textos.');
  if (dados.stop_reason === 'max_tokens') throw new Error('a resposta da IA ficou longa demais; escolha menos textos.');
  const texto = (dados.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  let saida;
  try { saida = JSON.parse(texto); } catch (err) { throw new Error('a IA devolveu um formato inesperado.'); }
  const mapa = {};
  (saida && Array.isArray(saida.textos) ? saida.textos : []).forEach((t) => {
    if (t && typeof t.id === 'string' && typeof t.texto === 'string' && t.texto.trim()) mapa[t.id] = t.texto;
  });
  return mapa;
}

/** Ids escolhidos para a IA: os pedidos (que existem) ou todos os de origem 'regra'; até 80. */
function relIdsParaIa(textos, ids) {
  const escolhidos = Array.isArray(ids) && ids.length
    ? ids.filter((id) => typeof id === 'string' && Object.prototype.hasOwnProperty.call(textos, id))
    : Object.keys(textos).filter((id) => textos[id] && textos[id].origem === 'regra');
  return escolhidos.slice(0, REL_MAX_TEXTOS_IA);
}

// ======== supabase/funcoes-compartilhadas/infinitepay.js ========
// Cliente mínimo do "Checkout Integrado" da InfinitePay (CloudWalk), sem nada do Deno: recebe fetch por parâmetro
// (testável no Node com respostas falsas).
//
// A API é pública e NÃO tem chave: a conta é identificada pela InfiniteTag ("handle", sem o $), guardada no segredo
// INFINITEPAY_HANDLE (Supabase > Edge Functions > Secrets). Não é senha, mas trate como configuração (não no código).
//
//   POST https://api.checkout.infinitepay.io/links
//     {handle, items:[{quantity, price (CENTAVOS, inteiro), description}], order_nsu, redirect_url, webhook_url,
//      customer?:{name, email, phone_number}}
//     -> {url: 'https://checkout.infinitepay.io/...'}  (a página hospedada oferece Pix e cartão)
//   Ao pagar, o cliente volta para redirect_url com ?order_nsu&transaction_nsu&slug&capture_method&receipt_url.
//   O webhook (POST em webhook_url) traz order_nsu, transaction_nsu, invoice_slug/slug, amount/paid_amount,
//   capture_method, receipt_url — SEM assinatura: o corpo nunca é confiável; sempre conferir com payment_check.
//   POST https://api.checkout.infinitepay.io/payment_check {handle, order_nsu, transaction_nsu, slug}
//     -> {success, paid: bool, amount, paid_amount, installments, capture_method}
//
// SUPOSIÇÕES (a documentação oficial — https://www.infinitepay.io/checkout-documentacao — não pôde ser lida daqui):
//   * a URL do checkout vem em `url` (aceitamos também `link`, `checkout_url`, `payment_url` e os mesmos dentro de `data`);
//   * amount/paid_amount do payment_check estão em CENTAVOS (como o preço do link). Número com casas decimais é lido
//     como reais (×100). Na dúvida o pedido NÃO é liberado (valor menor que o do pedido = não pago);
//   * `paid` pode vir como booleano ou texto 'true'; `success:false` = não pago.

const INFINITEPAY_API = 'https://api.checkout.infinitepay.io';
const INFINITEPAY_TIMEOUT_MS = 15000;
const RE_HANDLE = /^[a-z0-9._-]{1,60}$/i;
const RE_REF = /^[A-Za-z0-9._:-]{1,120}$/;

/** InfiniteTag do segredo -> handle sem "$"/"@" e sem espaços; inválida -> ''. */
function normalizarHandle(v) {
  const h = String(v == null ? '' : v).trim().replace(/^[$@]+/, '').trim();
  return RE_HANDLE.test(h) ? h : '';
}

/** transaction_nsu / slug vindos da URL ou do webhook: só caracteres seguros; senão ''. */
function refInfinitePay(v) {
  const s = String(v == null ? '' : v).trim();
  return RE_REF.test(s) ? s : '';
}

/** capture_method da InfinitePay -> pedidos.metodo */
function infinitepayMetodo(v) {
  const s = String(v || '').toLowerCase();
  if (s === 'pix') return 'pix';
  if (/credit|debit|card|cartao/.test(s)) return 'cartao';
  return '';
}

/** amount/paid_amount -> centavos (inteiro). Inteiro = centavos; com casas decimais (29.9, '29.00') = reais. NaN se inválido. */
function centavosInfinitePay(v) {
  if (v === null || v === undefined || v === '') return NaN;
  const txt = typeof v === 'string' ? v.trim().replace(',', '.') : v;
  const n = Number(txt);
  if (!isFinite(n) || n < 0) return NaN;
  const emReais = !Number.isInteger(n) || (typeof txt === 'string' && txt.indexOf('.') >= 0);
  return emReais ? Math.round(n * 100) : n;
}

/** Lê order_nsu/transaction_nsu/slug/capture_method de um corpo de webhook ou de parâmetros de retorno. */
function lerRefsInfinitePay(o) {
  const x = o && typeof o === 'object' ? o : {};
  const dentro = x.data && typeof x.data === 'object' ? x.data : {};
  const pegar = (...nomes) => {
    for (const n of nomes) {
      if (x[n] !== undefined && x[n] !== null && x[n] !== '') return x[n];
      if (dentro[n] !== undefined && dentro[n] !== null && dentro[n] !== '') return dentro[n];
    }
    return '';
  };
  return {
    orderNsu: String(pegar('order_nsu', 'orderNsu')).trim(),
    transactionNsu: refInfinitePay(pegar('transaction_nsu', 'transactionNsu')),
    slug: refInfinitePay(pegar('invoice_slug', 'slug')),
    metodo: infinitepayMetodo(pegar('capture_method', 'captureMethod'))
  };
}

function urlDoLink(r) {
  const fontes = [r, r && typeof r.data === 'object' ? r.data : null];
  for (const f of fontes) {
    if (!f) continue;
    for (const n of ['url', 'link', 'checkout_url', 'payment_url']) {
      if (typeof f[n] === 'string' && /^https:\/\//i.test(f[n].trim())) return f[n].trim();
    }
  }
  return '';
}

function erroInfinitePay(status, texto) {
  const e = new Error('InfinitePay: HTTP ' + status + (texto ? ' ' + String(texto).substring(0, 200) : ''));
  e.status = status;
  return e;
}

/**
 * criarInfinitePay({handle, fetch}) -> {configurado, handle, criarLink, conferir}
 * Lançam Error('InfinitePay: ...') com e.status em resposta não-2xx ou sem os campos esperados.
 */
function criarInfinitePay(op) {
  const handle = normalizarHandle(op && op.handle);
  const fetchFn = op && op.fetch;

  async function chamar(caminho, corpo) {
    const controle = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controle ? setTimeout(() => controle.abort(), INFINITEPAY_TIMEOUT_MS) : null;
    try {
      const r = await fetchFn(INFINITEPAY_API + caminho, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'gestao-sem-caos-mapa-disc' },
        body: JSON.stringify(corpo),
        signal: controle ? controle.signal : undefined
      });
      const texto = await r.text();
      let json = null;
      try { json = texto ? JSON.parse(texto) : null; } catch (err) { json = null; }
      if (!r.ok) throw erroInfinitePay(r.status, texto);
      return json && typeof json === 'object' ? json : {};
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  return {
    configurado: !!handle,
    handle,
    /**
     * {pedidoId, valorCentavos, descricao, redirectUrl, webhookUrl, cliente?:{nome, email, telefone}}
     * -> {url, bruto} (bruto = resposta da InfinitePay, para provedor_dados)
     */
    async criarLink(d) {
      const corpo = {
        handle,
        items: [{ quantity: 1, price: Math.round(Number(d.valorCentavos) || 0), description: String(d.descricao || '').substring(0, 120) }],
        order_nsu: String(d.pedidoId),
        redirect_url: d.redirectUrl,
        webhook_url: d.webhookUrl
      };
      const c = d.cliente || {};
      const customer = {};
      if (c.nome) customer.name = String(c.nome).substring(0, 120);
      if (c.email) customer.email = String(c.email).substring(0, 120);
      if (c.telefone) customer.phone_number = String(c.telefone).replace(/\D/g, '').substring(0, 20);
      if (Object.keys(customer).length) corpo.customer = customer;
      const r = await chamar('/links', corpo);
      const url = urlDoLink(r);
      if (!url) throw erroInfinitePay(200, 'resposta sem a URL do checkout');
      return { url, bruto: r };
    },
    /**
     * {pedidoId, transactionNsu, slug} -> {pago, valorCentavos (NaN se não veio), metodo, parcelas, bruto}
     * pago = success !== false e paid === true. A comparação com o valor do pedido fica com quem chama.
     */
    async conferir(d) {
      const r = await chamar('/payment_check', {
        handle, order_nsu: String(d.pedidoId), transaction_nsu: String(d.transactionNsu || ''), slug: String(d.slug || '')
      });
      const pago = r.success !== false && (r.paid === true || String(r.paid).toLowerCase() === 'true');
      const pagoCent = centavosInfinitePay(r.paid_amount);
      const valorCentavos = isFinite(pagoCent) ? pagoCent : centavosInfinitePay(r.amount);
      return { pago, valorCentavos, metodo: infinitepayMetodo(r.capture_method), parcelas: Number(r.installments) || 0, bruto: r };
    }
  };
}

// ======== supabase/funcoes-compartilhadas/asaas.js ========
// Cliente mínimo da API v3 do Asaas (cobrança Pix + link de cartão) e do Resend (e-mail), sem nada do Deno:
// recebe fetch por parâmetro (testável no Node com respostas falsas).
//
// Segredos (Supabase > Edge Functions > Secrets; NUNCA no código nem no repositório):
//   ASAAS_API_KEY       chave da API do Asaas (copiada do painel do Asaas). Sem ela: "Pagamento ainda não configurado."
//   ASAAS_AMBIENTE      'sandbox' (padrão, testes) ou 'producao'
//   ASAAS_WEBHOOK_TOKEN token que o Asaas manda no cabeçalho asaas-access-token do webhook
//   RESEND_API_KEY      (opcional) envio de e-mail com o link do relatório
//   EMAIL_REMETENTE     (opcional) ex.: 'Gestão sem Caos <relatorio@seudominio.com.br>' (domínio verificado no Resend)

const ASAAS_URLS = {
  sandbox: 'https://api-sandbox.asaas.com/v3',
  producao: 'https://api.asaas.com/v3'
};
const ASAAS_PAGO = ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'];
const ASAAS_EVENTOS_PAGO = ['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED'];
const ASAAS_EVENTOS_ESTORNO = ['PAYMENT_REFUNDED', 'PAYMENT_PARTIALLY_REFUNDED', 'PAYMENT_CHARGEBACK_REQUESTED',
  'PAYMENT_CHARGEBACK_DISPUTE'];
const ASAAS_EVENTOS_CANCELA = ['PAYMENT_DELETED'];
const ASAAS_TIMEOUT_MS = 15000;

function asaasAmbiente(v) {
  const s = String(v || '').trim().toLowerCase();
  return s === 'producao' || s === 'produção' || s === 'production' ? 'producao' : 'sandbox';
}

/** forma de pagamento do Asaas -> pedidos.metodo */
function asaasMetodo(billingType) {
  const b = String(billingType || '').toUpperCase();
  if (b === 'PIX') return 'pix';
  if (b === 'CREDIT_CARD' || b === 'DEBIT_CARD') return 'cartao';
  if (b === 'BOLETO') return 'boleto';
  return '';
}

/** Compara dois textos em tempo constante (tamanhos diferentes = falso). */
function iguaisSeguro(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || a.length !== b.length) return false;
  let dif = 0;
  for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return dif === 0;
}

/** CPF (11 dígitos com dígitos verificadores) ou CNPJ (14 dígitos) -> só dígitos; inválido -> ''. */
function documentoValido(v) {
  const d = String(v == null ? '' : v).replace(/\D/g, '');
  if (d.length === 11) {
    if (/^(\d)\1{10}$/.test(d)) return '';
    const dv = (n) => {
      let s = 0;
      for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i);
      const r = (s * 10) % 11;
      return r === 10 ? 0 : r;
    };
    return dv(9) === Number(d[9]) && dv(10) === Number(d[10]) ? d : '';
  }
  if (d.length === 14) {
    if (/^(\d)\1{13}$/.test(d)) return '';
    const calc = (n) => {
      const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
      let s = 0;
      for (let i = 0; i < n; i++) s += Number(d[i]) * pesos[i];
      const r = s % 11;
      return r < 2 ? 0 : 11 - r;
    };
    return calc(12) === Number(d[12]) && calc(13) === Number(d[13]) ? d : '';
  }
  return '';
}

function erroAsaas(status, corpo) {
  const lista = corpo && Array.isArray(corpo.errors) ? corpo.errors : [];
  const texto = lista.map((e) => String((e && (e.description || e.code)) || '')).filter(Boolean).join(' ') || ('HTTP ' + status);
  const e = new Error('Asaas: ' + texto.substring(0, 300));
  e.status = status;
  e.codigos = lista.map((x) => String((x && x.code) || ''));
  e.texto = texto;
  return e;
}

/**
 * criarAsaas({apiKey, ambiente, fetch}) -> {configurado, ambiente, clienteCriar, cobrancaCriar, cobranca, pixQrCode}
 * Todas lançam Error('Asaas: ...') com e.status/e.codigos/e.texto em resposta não-2xx.
 */
function criarAsaas(op) {
  const apiKey = String((op && op.apiKey) || '').trim();
  const ambiente = asaasAmbiente(op && op.ambiente);
  const base = ASAAS_URLS[ambiente];
  const fetchFn = op && op.fetch;

  async function chamar(metodo, caminho, corpo) {
    const controle = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controle ? setTimeout(() => controle.abort(), ASAAS_TIMEOUT_MS) : null;
    try {
      const r = await fetchFn(base + caminho, {
        method: metodo,
        headers: { access_token: apiKey, 'Content-Type': 'application/json', 'User-Agent': 'gestao-sem-caos-mapa-disc' },
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
        signal: controle ? controle.signal : undefined
      });
      const texto = await r.text();
      let json = null;
      try { json = texto ? JSON.parse(texto) : null; } catch (err) { json = null; }
      if (!r.ok) throw erroAsaas(r.status, json);
      return json || {};
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  return {
    configurado: !!apiKey,
    ambiente,
    /** {nome, email, cpfCnpj?, referencia} -> id do cliente (cus_...) */
    async clienteCriar(d) {
      const corpo = { name: d.nome, email: d.email, externalReference: d.referencia, notificationDisabled: true };
      if (d.cpfCnpj) corpo.cpfCnpj = d.cpfCnpj;
      const r = await chamar('POST', '/customers', corpo);
      if (!r.id) throw new Error('Asaas: cliente sem id');
      return String(r.id);
    },
    /** {cliente, valorCentavos, vencimento 'YYYY-MM-DD', descricao, referencia} -> {id, invoiceUrl, status} */
    async cobrancaCriar(d) {
      const r = await chamar('POST', '/payments', {
        customer: d.cliente, billingType: 'UNDEFINED', value: Math.round(d.valorCentavos) / 100,
        dueDate: d.vencimento, description: d.descricao, externalReference: d.referencia
      });
      if (!r.id) throw new Error('Asaas: cobrança sem id');
      return { id: String(r.id), invoiceUrl: String(r.invoiceUrl || ''), status: String(r.status || '') };
    },
    /** id -> {id, status, billingType, value, externalReference, invoiceUrl} */
    async cobranca(id) {
      return chamar('GET', '/payments/' + encodeURIComponent(id));
    },
    /** id -> {qrBase64, copiaECola, expira} */
    async pixQrCode(id) {
      const r = await chamar('GET', '/payments/' + encodeURIComponent(id) + '/pixQrCode');
      return { qrBase64: String(r.encodedImage || ''), copiaECola: String(r.payload || ''), expira: String(r.expirationDate || '') };
    }
  };
}

/** Envio pelo Resend. {configurado, enviar({para, assunto, html, texto})} — lança erro em falha. */
function criarResend(op) {
  const chave = String((op && op.apiKey) || '').trim();
  const remetente = String((op && op.remetente) || '').trim() || 'Gestão sem Caos <onboarding@resend.dev>';
  return {
    configurado: !!chave,
    async enviar(m) {
      const r = await op.fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + chave, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: remetente, to: [m.para], subject: m.assunto, html: m.html, text: m.texto })
      });
      if (!r.ok) throw new Error('Resend: HTTP ' + r.status);
      return true;
    }
  };
}

// ======== supabase/funcoes-compartilhadas/conexoes.js ========
// Aba "Conexões" do painel: ações conexoes.diagnostico e conexoes.testar da Edge Function "admin" (só administrador).
// Sem nada do Deno: recebe fetch/env/db pelo ctx (testável no Node com respostas falsas).
//
// REGRA DE OURO: nenhuma resposta leva o VALOR de um segredo. Só "existe: sim/não", o provedor escolhido (não é
// segredo), as 2 primeiras letras da InfiniteTag e mensagens. Tudo que volta passa por ocultarSegredos().
// Cada teste externo tem prazo de no máximo CONEXOES_PRAZO_MS (8 s).
//
//   conexoes.diagnostico {} -> {ok, versao, em, siteUrl, segredos:{NOME: bool}, pagamento:{provedor, provedorEscolhido,
//     handleParcial, asaasAmbiente}, funcoes:[{nome, publicada:true|false|null, status, mensagem}],
//     auth:{cadastroFechado:true|false|null}, pedidoTeste:{id, status, criadoEm, url}|null, colunaTeste:bool|null}
//   conexoes.testar {alvo, ...} -> {ok, alvo, sucesso:bool, mensagem, verificado, detalhes?}
//     alvo: 'funcoes' | 'clickup' | 'asaas' | 'ia' | 'email' (manda um e-mail para o admin logado)
//           'infinitepay.link'      cria um pedido de TESTE (pedidos.teste = true, R$ 1,00; fora das vendas/receita) e um
//                                   link real de checkout. Nada é cobrado se ninguém pagar. -> detalhes {url, pedidoId}
//           'infinitepay.verificar' {pedidoId?, transactionNsu?, slug?} confere o pedido de teste no payment_check.

const CONEXOES_VERSAO = 1;
const CONEXOES_PRAZO_MS = 8000;
const FUNCOES_EDGE = ['admin', 'disc-sync', 'clickup-webhook', 'pagamento', 'asaas-webhook', 'infinitepay-webhook'];
const SEGREDOS_CONEXOES = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SITE_URL',
  'PAGAMENTO_PROVEDOR', 'INFINITEPAY_HANDLE', 'ASAAS_API_KEY', 'ASAAS_WEBHOOK_TOKEN', 'ASAAS_AMBIENTE',
  'RESEND_API_KEY', 'EMAIL_REMETENTE', 'CLICKUP_TOKEN', 'CLICKUP_PASTA_ID', 'CLICKUP_WEBHOOK_SECRET', 'ANTHROPIC_API_KEY'];
// Segredos de verdade (o valor nunca sai do servidor). SITE_URL, PAGAMENTO_PROVEDOR e ASAAS_AMBIENTE são configuração.
const SEGREDOS_OCULTOS = ['SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'INFINITEPAY_HANDLE', 'ASAAS_API_KEY',
  'ASAAS_WEBHOOK_TOKEN', 'RESEND_API_KEY', 'CLICKUP_TOKEN', 'CLICKUP_WEBHOOK_SECRET', 'ANTHROPIC_API_KEY'];
const VALOR_TESTE_CENTAVOS = 100;
const ANTHROPIC_MODELOS = 'https://api.anthropic.com/v1/models?limit=1';
const RE_UUID_CX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cxAgoraIso(ctx) { return new Date(ctx.agora()).toISOString(); }
function cxPrazo(ctx) { return Math.min(CONEXOES_PRAZO_MS, Number(ctx.prazoConexoesMs) || CONEXOES_PRAZO_MS); }
function cxTem(env, nome) { return !!String((env && env[nome]) || '').trim(); }

/** Troca qualquer valor de segredo que apareça no texto por "***" (rede de segurança das mensagens). */
function ocultarSegredos(texto, env) {
  let s = String(texto == null ? '' : texto);
  SEGREDOS_OCULTOS.forEach((n) => {
    const v = String((env && env[n]) || '').trim();
    if (v.length >= 4) s = s.split(v).join('***');
  });
  return s;
}

/** Só as 2 primeiras letras + "***" (a InfiniteTag não aparece inteira). */
function parcial(valor) {
  const v = String(valor == null ? '' : valor).trim().replace(/^[$@]+/, '');
  return v ? v.substring(0, 2) + '***' : '';
}

/** Promessa com prazo: passou de ms -> Error com tempoEsgotado = true. */
function comPrazo(promessa, ms) {
  let timer;
  const limite = new Promise((_, rejeitar) => {
    timer = setTimeout(() => { const e = new Error('tempo esgotado'); e.tempoEsgotado = true; rejeitar(e); }, ms);
  });
  return Promise.race([Promise.resolve(promessa), limite]).finally(() => clearTimeout(timer));
}

/** fetch que desiste depois de ms (aborta a requisição). */
function fetchComPrazo(fetchFn, ms) {
  return async (url, op) => {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const o = Object.assign({}, op || {});
    if (ctl) {
      if (o.signal) { if (o.signal.aborted) ctl.abort(); else o.signal.addEventListener('abort', () => ctl.abort()); }
      o.signal = ctl.signal;
    }
    return comPrazo(fetchFn(url, o), ms).catch((err) => { if (ctl) ctl.abort(); throw err; });
  };
}

function statusDoErro(err) {
  if (err && Number(err.status)) return Number(err.status);
  const m = /(?:HTTP|respondeu)\s+(\d{3})/.exec(String((err && err.message) || ''));
  return m ? Number(m[1]) : 0;
}

/** Erro de um serviço externo -> frase curta em português simples (sem detalhes técnicos nem segredos). */
function traduzirErro(servico, err) {
  if (err && err.tempoEsgotado) return servico + ' não respondeu em 8 segundos. Pode ser instabilidade: tente de novo em alguns minutos.';
  const st = statusDoErro(err);
  if (st === 401) return servico + ' recusou a chave: ela está errada, foi apagada ou trocada. Gere uma nova e atualize o segredo.';
  if (st === 403) return servico + ' recusou o pedido por falta de permissão (chave sem acesso a isto, ou domínio/conta não verificados).';
  if (st === 404) return servico + ' não encontrou o endereço chamado (conta, ambiente ou recurso errado).';
  if (st === 422 || st === 400) return servico + ' recusou os dados enviados (erro ' + st + '). Confira a configuração da conta.';
  if (st === 429) return servico + ' recebeu chamadas demais agora. Espere 1 minuto e teste de novo.';
  if (st >= 500) return servico + ' está com problema do lado dele (erro ' + st + '). Tente de novo mais tarde.';
  if (st >= 400) return servico + ' recusou o pedido (erro ' + st + ').';
  return 'Não foi possível falar com ' + servico + ' (sem resposta da rede). Tente de novo em instantes.';
}

function resultado(ctx, alvo, sucesso, mensagem, verificado, detalhes) {
  const r = { ok: true, alvo, sucesso: !!sucesso, mensagem: ocultarSegredos(mensagem, ctx.env), verificado: verificado || '', em: cxAgoraIso(ctx) };
  if (detalhes) {
    // O link de checkout é público e leva a InfiniteTag no endereço: ele passa inteiro; o resto é filtrado.
    const url = detalhes.url;
    r.detalhes = JSON.parse(ocultarSegredos(JSON.stringify(Object.assign({}, detalhes, { url: undefined })), ctx.env));
    if (url) r.detalhes.url = String(url);
  }
  return r;
}

/** Provedor que o site usa agora (mesma regra de pagamento.js). */
function provedorAtual(env) {
  const escolhido = String(env.PAGAMENTO_PROVEDOR || '').trim().toLowerCase();
  if (escolhido === 'infinitepay') return cxTem(env, 'INFINITEPAY_HANDLE') ? 'infinitepay' : '';
  if (escolhido === 'asaas') return cxTem(env, 'ASAAS_API_KEY') ? 'asaas' : '';
  if (cxTem(env, 'INFINITEPAY_HANDLE')) return 'infinitepay';
  if (cxTem(env, 'ASAAS_API_KEY')) return 'asaas';
  return '';
}

function baseSupabase(env) {
  const s = String(env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(s) ? s : '';
}

function siteBase(env) {
  const s = String(env.SITE_URL || '').trim();
  if (!/^https?:\/\//i.test(s)) return '';
  return s.replace(/\/+$/, '') + '/';
}

// ---------------------------------------------------------------------------
// Funções publicadas (o SERVIDOR chama: sem CORS no navegador)
// ---------------------------------------------------------------------------

/** OPTIONS em SUPABASE_URL/functions/v1/<nome>: 404 = não publicada; qualquer outra resposta = publicada. */
async function pingFuncao(ctx, nome) {
  const base = baseSupabase(ctx.env);
  if (!base) return { nome, publicada: null, status: 0, mensagem: 'SUPABASE_URL não disponível no servidor.' };
  const f = fetchComPrazo(ctx.fetch, cxPrazo(ctx));
  try {
    const headers = {};
    if (cxTem(ctx.env, 'SUPABASE_ANON_KEY')) headers.apikey = ctx.env.SUPABASE_ANON_KEY;
    const r = await f(base + '/functions/v1/' + nome, { method: 'OPTIONS', headers });
    try { await r.text(); } catch (e) { /* corpo ignorado */ }
    if (r.status === 404) return { nome, publicada: false, status: 404, mensagem: 'Não publicada (o Supabase respondeu 404).' };
    if (r.status >= 500) return { nome, publicada: true, status: r.status, mensagem: 'Publicada, mas respondeu com erro ' + r.status + '.' };
    return { nome, publicada: true, status: r.status, mensagem: 'Publicada (respondeu ' + r.status + ').' };
  } catch (err) {
    return { nome, publicada: null, status: 0, mensagem: traduzirErro('O Supabase', err) };
  }
}

async function funcoesPublicadas(ctx) {
  return Promise.all(FUNCOES_EDGE.map((nome) => (nome === 'admin'
    ? { nome, publicada: true, status: 200, mensagem: 'Publicada (é ela que está respondendo agora).' }
    : pingFuncao(ctx, nome))));
}

/** Cadastro livre fechado? GET /auth/v1/settings (público) -> disable_signup. null = não deu para saber. */
async function cadastroFechado(ctx) {
  const base = baseSupabase(ctx.env);
  if (!base || !cxTem(ctx.env, 'SUPABASE_ANON_KEY')) return null;
  try {
    const r = await fetchComPrazo(ctx.fetch, cxPrazo(ctx))(base + '/auth/v1/settings', { method: 'GET', headers: { apikey: ctx.env.SUPABASE_ANON_KEY } });
    if (!r.ok) return null;
    const j = await r.json();
    return j && typeof j.disable_signup === 'boolean' ? j.disable_signup : null;
  } catch (err) {
    return null;
  }
}

function colunaInexistente(err) {
  const c = err && err.causa ? String(err.causa.code || '') + ' ' + String(err.causa.message || '') : String((err && err.message) || '');
  return /42703|PGRST204|teste/.test(c);
}

function pedidoTesteSaida(p) {
  if (!p) return null;
  return { id: String(p.id), status: String(p.status || ''), criadoEm: p.criado_em || '', url: p.checkout_url || '' };
}

// ---------------------------------------------------------------------------
// Ações
// ---------------------------------------------------------------------------

async function acaoDiagnostico(ctx) {
  const env = ctx.env || {};
  const segredos = {};
  SEGREDOS_CONEXOES.forEach((n) => { segredos[n] = cxTem(env, n); });
  const escolhido = String(env.PAGAMENTO_PROVEDOR || '').trim().toLowerCase();
  const [funcoes, fechado, teste] = await Promise.all([
    funcoesPublicadas(ctx),
    cadastroFechado(ctx),
    (async () => {
      if (!ctx.db || typeof ctx.db.pedidoTesteUltimo !== 'function') return { coluna: null, pedido: null };
      try { return { coluna: true, pedido: await comPrazo(ctx.db.pedidoTesteUltimo(), cxPrazo(ctx)) }; } catch (err) {
        return { coluna: colunaInexistente(err) ? false : null, pedido: null };
      }
    })()
  ]);
  const site = siteBase(env);
  return {
    ok: true, versao: CONEXOES_VERSAO, em: cxAgoraIso(ctx),
    siteUrl: site,
    segredos,
    pagamento: {
      provedor: provedorAtual(env),
      // PAGAMENTO_PROVEDOR não é segredo: mostra o valor (só os conhecidos; outro texto vira 'invalido').
      provedorEscolhido: !escolhido ? '' : (escolhido === 'infinitepay' || escolhido === 'asaas' ? escolhido : 'invalido'),
      handleParcial: parcial(env.INFINITEPAY_HANDLE),
      asaasAmbiente: asaasAmbiente(env.ASAAS_AMBIENTE)
    },
    funcoes,
    auth: { cadastroFechado: fechado },
    pedidoTeste: pedidoTesteSaida(teste.pedido),
    colunaTeste: teste.coluna
  };
}

async function testarFuncoes(ctx) {
  const lista = await funcoesPublicadas(ctx);
  const faltam = lista.filter((f) => f.publicada === false).map((f) => f.nome);
  const sem = lista.filter((f) => f.publicada === null).map((f) => f.nome);
  const msg = faltam.length ? 'Não publicadas: ' + faltam.join(', ') + '.'
    : (sem.length ? 'Não deu para conferir: ' + sem.join(', ') + '.' : 'Todas as ' + lista.length + ' funções estão publicadas.');
  return resultado(ctx, 'funcoes', !faltam.length && !sem.length, msg, 'Endereço de cada função chamado pelo servidor.', { funcoes: lista });
}

async function testarClickUp(ctx) {
  if (!cxTem(ctx.env, 'CLICKUP_TOKEN')) return resultado(ctx, 'clickup', false, 'Segredo CLICKUP_TOKEN não existe.', 'Presença do segredo.');
  const cu = criarClickUp({ token: ctx.env.CLICKUP_TOKEN, fetch: fetchComPrazo(ctx.fetch, cxPrazo(ctx)), dormir: async () => {}, agora: ctx.agora });
  try {
    const u = ((await comPrazo(cu.get('/user'), cxPrazo(ctx))) || {}).user || {};
    const nome = limparTexto(u.username || u.email || '', 80);
    return resultado(ctx, 'clickup', true, 'Conectado ao ClickUp' + (nome ? ' como ' + nome : '') + '.', 'Leitura do usuário dono do token (GET /user).',
      { usuario: nome, webhookSecreto: cxTem(ctx.env, 'CLICKUP_WEBHOOK_SECRET') });
  } catch (err) {
    return resultado(ctx, 'clickup', false, traduzirErro('O ClickUp', err), 'Leitura do usuário dono do token (GET /user).');
  }
}

async function testarAsaas(ctx) {
  if (!cxTem(ctx.env, 'ASAAS_API_KEY')) return resultado(ctx, 'asaas', false, 'Segredo ASAAS_API_KEY não existe.', 'Presença do segredo.');
  const asaas = criarAsaas({ apiKey: ctx.env.ASAAS_API_KEY, ambiente: ctx.env.ASAAS_AMBIENTE, fetch: fetchComPrazo(ctx.fetch, cxPrazo(ctx)) });
  const amb = asaas.ambiente === 'producao' ? 'produção' : 'sandbox (testes)';
  try {
    // Consulta leve (1 cliente, nada é criado nem cobrado). Só o "deu certo" volta para o painel.
    await comPrazo(asaas.cobranca('__teste_conexao__').catch((err) => {
      if (Number(err && err.status) === 404) return null; // chave aceita; a cobrança de mentira não existe (esperado)
      throw err;
    }), cxPrazo(ctx));
    return resultado(ctx, 'asaas', true, 'O Asaas aceitou a chave no ambiente ' + amb + '.', 'Consulta leve à API do Asaas (' + amb + ').', { ambiente: asaas.ambiente });
  } catch (err) {
    return resultado(ctx, 'asaas', false, traduzirErro('O Asaas', err) + ' (ambiente ' + amb + ')', 'Consulta leve à API do Asaas (' + amb + ').', { ambiente: asaas.ambiente });
  }
}

async function testarIa(ctx) {
  if (!cxTem(ctx.env, 'ANTHROPIC_API_KEY')) return resultado(ctx, 'ia', false, 'Segredo ANTHROPIC_API_KEY não existe (a IA é opcional).', 'Presença do segredo.');
  try {
    // Lista de modelos: não gera texto, não gasta créditos.
    const r = await fetchComPrazo(ctx.fetch, cxPrazo(ctx))(ANTHROPIC_MODELOS, {
      method: 'GET', headers: { 'x-api-key': ctx.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }
    });
    try { await r.text(); } catch (e) { /* ignora */ }
    if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
    return resultado(ctx, 'ia', true, 'A chave da IA foi aceita (teste sem custo).', 'Consulta à lista de modelos (não gera texto, não gasta créditos).');
  } catch (err) {
    return resultado(ctx, 'ia', false, traduzirErro('A IA (Anthropic)', err), 'Consulta à lista de modelos (não gera texto, não gasta créditos).');
  }
}

async function testarEmail(ctx) {
  if (!cxTem(ctx.env, 'RESEND_API_KEY')) return resultado(ctx, 'email', false, 'Segredo RESEND_API_KEY não existe.', 'Presença do segredo.');
  const para = String((ctx.usuario && ctx.usuario.email) || '').trim();
  if (!para) return resultado(ctx, 'email', false, 'Seu usuário não tem e-mail para receber o teste.', 'Envio de um e-mail de teste.');
  const resend = criarResend({ apiKey: ctx.env.RESEND_API_KEY, remetente: ctx.env.EMAIL_REMETENTE, fetch: fetchComPrazo(ctx.fetch, cxPrazo(ctx)) });
  const quando = new Date(ctx.agora()).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  try {
    await comPrazo(resend.enviar({
      para,
      assunto: 'Teste de e-mail — Gestão sem Caos',
      texto: 'Este é um e-mail de teste enviado pela aba Conexões do painel em ' + quando + '.\nSe chegou, o envio automático está funcionando.\n\nGestão sem Caos',
      html: '<p>Este é um e-mail de teste enviado pela aba <b>Conexões</b> do painel em ' + quando + '.</p><p>Se chegou, o envio automático está funcionando.</p><p>Gestão sem Caos</p>'
    }), cxPrazo(ctx));
    return resultado(ctx, 'email', true, 'E-mail de teste enviado para ' + para + '. Confira a caixa de entrada (e o spam).',
      'Envio real pelo Resend' + (cxTem(ctx.env, 'EMAIL_REMETENTE') ? '' : ' (remetente padrão do Resend: EMAIL_REMETENTE não existe)') + '.');
  } catch (err) {
    return resultado(ctx, 'email', false, traduzirErro('O Resend', err), 'Envio real pelo Resend.');
  }
}

async function gerarLinkTeste(ctx) {
  const env = ctx.env;
  if (!cxTem(env, 'INFINITEPAY_HANDLE')) return resultado(ctx, 'infinitepay.link', false, 'Segredo INFINITEPAY_HANDLE não existe.', 'Presença do segredo.');
  const site = siteBase(env);
  if (!site) return resultado(ctx, 'infinitepay.link', false, 'Segredo SITE_URL não existe: a InfinitePay precisa saber para onde voltar depois do pagamento.', 'Presença do segredo.');
  const base = baseSupabase(env);
  const ip = criarInfinitePay({ handle: env.INFINITEPAY_HANDLE, fetch: fetchComPrazo(ctx.fetch, cxPrazo(ctx)) });
  if (!ip.configurado) return resultado(ctx, 'infinitepay.link', false, 'O INFINITEPAY_HANDLE existe, mas não parece uma InfiniteTag válida (só letras, números, ponto, - ou _).', 'Formato do segredo.');
  let pedido;
  try {
    pedido = await comPrazo(ctx.db.pedidoTesteInserir({
      pacote: 'completo', valor_centavos: VALOR_TESTE_CENTAVOS, valor_original_centavos: VALOR_TESTE_CENTAVOS,
      email: limparTexto((ctx.usuario && ctx.usuario.email) || '', 120), nome: 'Teste de conexão (painel)',
      teste: true, provedor: 'infinitepay', provedor_dados: { teste: true }
    }), cxPrazo(ctx));
  } catch (err) {
    if (colunaInexistente(err)) {
      return resultado(ctx, 'infinitepay.link', false, 'Falta aplicar a migração 20261013120000_conexoes no banco (ela marca o pedido como teste, fora das vendas).', 'Criação do pedido de teste no banco.');
    }
    return resultado(ctx, 'infinitepay.link', false, 'Não foi possível criar o pedido de teste no banco.', 'Criação do pedido de teste no banco.');
  }
  try {
    const r = await comPrazo(ip.criarLink({
      pedidoId: pedido.id, valorCentavos: VALOR_TESTE_CENTAVOS,
      descricao: 'Teste de conexão — Gestão sem Caos (pode ignorar)',
      redirectUrl: site + 'admin.html?conexoes=teste',
      webhookUrl: base ? base + '/functions/v1/infinitepay-webhook' : undefined
    }), cxPrazo(ctx));
    const dados = { teste: true, link: { url: r.url, valor: VALOR_TESTE_CENTAVOS, criadoEm: cxAgoraIso(ctx) } };
    try { await ctx.db.pedidoTesteAtualizar(pedido.id, { checkout_url: r.url, provedor_dados: dados }); } catch (e) { /* o link já existe */ }
    return resultado(ctx, 'infinitepay.link', true, 'Link de teste criado (R$ 1,00). Nada é cobrado se ninguém pagar.',
      'Criação de um link real de checkout na InfinitePay (InfiniteTag ' + parcial(env.INFINITEPAY_HANDLE) + ').',
      { url: r.url, pedidoId: String(pedido.id), valorCentavos: VALOR_TESTE_CENTAVOS });
  } catch (err) {
    try { await ctx.db.pedidoTesteAtualizar(pedido.id, { status: 'cancelado' }); } catch (e) { /* ignora */ }
    return resultado(ctx, 'infinitepay.link', false, traduzirErro('A InfinitePay', err) + ' Confira se a InfiniteTag está certa.', 'Criação de um link real de checkout na InfinitePay.');
  }
}

function refsDoPedido(p) {
  const d = p && p.provedor_dados && typeof p.provedor_dados === 'object' ? p.provedor_dados : {};
  const refs = { transactionNsu: '', slug: '' };
  [d.retorno, d.webhook && lerRefsInfinitePay(d.webhook.corpo)].forEach((f) => {
    if (!f) return;
    if (!refs.transactionNsu && f.transactionNsu) refs.transactionNsu = refInfinitePay(f.transactionNsu);
    if (!refs.slug && f.slug) refs.slug = refInfinitePay(f.slug);
  });
  return refs;
}

async function verificarPagamentoTeste(ctx, corpo) {
  const alvo = 'infinitepay.verificar';
  if (!cxTem(ctx.env, 'INFINITEPAY_HANDLE')) return resultado(ctx, alvo, false, 'Segredo INFINITEPAY_HANDLE não existe.', 'Presença do segredo.');
  let p = null;
  try {
    const id = String(corpo.pedidoId || '');
    p = RE_UUID_CX.test(id) ? await ctx.db.pedidoTesteLer(id) : await ctx.db.pedidoTesteUltimo();
  } catch (err) {
    return resultado(ctx, alvo, false, colunaInexistente(err) ? 'Falta aplicar a migração 20261013120000_conexoes no banco.' : 'Não foi possível ler o pedido de teste no banco.', 'Leitura do pedido de teste.');
  }
  if (!p) return resultado(ctx, alvo, false, 'Nenhum pedido de teste encontrado. Gere um link de teste primeiro.', 'Leitura do pedido de teste.');
  if (p.status === 'pago') return resultado(ctx, alvo, true, 'O pagamento de teste já está confirmado. O ciclo completo funciona.', 'Pedido de teste no banco.', { pedidoId: String(p.id), pago: true });
  const guardadas = refsDoPedido(p);
  const refs = { transactionNsu: refInfinitePay(corpo.transactionNsu) || guardadas.transactionNsu, slug: refInfinitePay(corpo.slug) || guardadas.slug };
  const ip = criarInfinitePay({ handle: ctx.env.INFINITEPAY_HANDLE, fetch: fetchComPrazo(ctx.fetch, cxPrazo(ctx)) });
  const verificado = 'Consulta do pagamento na InfinitePay (payment_check) do pedido de teste.';
  try {
    const c = await comPrazo(ip.conferir({ pedidoId: p.id, transactionNsu: refs.transactionNsu, slug: refs.slug }), cxPrazo(ctx));
    if (c.pago && c.valorCentavos >= VALOR_TESTE_CENTAVOS) {
      try {
        await ctx.db.pedidoTesteAtualizar(p.id, { status: 'pago', metodo: c.metodo || '', provedor_ref: refs.transactionNsu || refs.slug || null });
      } catch (e) { /* a confirmação vale mesmo sem gravar */ }
      return resultado(ctx, alvo, true, 'Pagamento de teste confirmado pela InfinitePay. O ciclo completo funciona.', verificado, { pedidoId: String(p.id), pago: true });
    }
    return resultado(ctx, alvo, true, 'A InfinitePay respondeu: este pedido de teste ainda não foi pago. Pague o link (R$ 1,00) e verifique de novo.', verificado, { pedidoId: String(p.id), pago: false });
  } catch (err) {
    if (!refs.transactionNsu && !refs.slug && statusDoErro(err) >= 400 && statusDoErro(err) < 500) {
      return resultado(ctx, alvo, true, 'Ainda não há pagamento para este link. Depois de pagar, a InfinitePay avisa o sistema; verifique de novo em 1 minuto.', verificado, { pedidoId: String(p.id), pago: false });
    }
    return resultado(ctx, alvo, false, traduzirErro('A InfinitePay', err), verificado, { pedidoId: String(p.id) });
  }
}

const TESTES = {
  funcoes: testarFuncoes,
  clickup: testarClickUp,
  asaas: testarAsaas,
  ia: testarIa,
  email: testarEmail,
  'infinitepay.link': gerarLinkTeste,
  'infinitepay.verificar': verificarPagamentoTeste
};

async function acaoTestar(ctx, corpo) {
  const alvo = String((corpo && corpo.alvo) || '');
  if (!Object.prototype.hasOwnProperty.call(TESTES, alvo)) return erro('Teste desconhecido.');
  try {
    return await TESTES[alvo](ctx, corpo || {});
  } catch (err) {
    try { console.error(err); } catch (e) { /* sem console */ }
    return resultado(ctx, alvo, false, 'O teste falhou dentro do servidor. Tente de novo.', '');
  }
}

// ======== supabase/funcoes-compartilhadas/admin.js ========
// Ações da Edge Function "admin" (só administrador). Mesmos nomes, entradas e respostas {ok, ...} das
// ações do Apps Script (Code.gs/ClickUp.gs/Relatorio.gs), mais usuarios.* do Supabase Auth.
//
// ctx = { env, db, authAdmin, usuario:{id,email}, cu (cliente do ClickUp), fetch, agora, motor, confiabilidade }
// Processos (listar/salvar/excluir) e respostas dos candidatos ficam no PostgREST com RLS (não aqui).

function agoraIso(ctx) { return new Date(ctx.agora()).toISOString(); }

// ---------------------------------------------------------------------------
// ClickUp
// ---------------------------------------------------------------------------

async function acaoClickupStatus(ctx) {
  const env = ctx.env;
  const r = {
    ok: true, configurado: ctx.cu.configurado, pastaConfigurada: !!env.CLICKUP_PASTA_ID,
    iaConfigurada: !!env.ANTHROPIC_API_KEY, avisos: await lerAvisos(ctx.db, ctx.agora())
  };
  if (!r.configurado) return r;
  try {
    const u = (await ctx.cu.get('/user')).user || {};
    r.conectado = true;
    r.usuario = u.username || '';
  } catch (err) {
    r.conectado = false;
    r.erro = 'Não foi possível falar com o ClickUp: ' + err.message;
  }
  return r;
}

async function acaoClickupListas(ctx) {
  if (!ctx.cu.configurado) return erro(MSG_CU_NAO_CONFIGURADO);
  try {
    return { ok: true, listas: await cuListas(ctx.cu) };
  } catch (err) {
    return erro('Não foi possível ler as listas do ClickUp: ' + err.message);
  }
}

/** Valida o processo para leitura no ClickUp. {ok, processo} ou erro. */
async function processoPronto(ctx, id) {
  const proc = processoDaLinha(await ctx.db.processoPorId(limparTexto(id, 60)));
  if (!proc) return erro('Processo não encontrado.');
  if (!proc.clickupListId) return erro('Este processo ainda não está ligado a uma lista do ClickUp.');
  if (!ctx.cu.configurado) return erro(MSG_CU_NAO_CONFIGURADO);
  return { ok: true, processo: proc };
}

/** processoDados do processo (ClickUp + respostas do DISC no banco). Lança erro se o ClickUp falhar. */
async function montarDadosDoProcesso(ctx, proc) {
  const linhas = await ctx.db.respostasDoProcesso(proc);
  return cuMontarDadosProcesso(ctx.cu, proc, linhas, ctx.confiabilidade);
}

async function acaoProcessoDados(ctx, id) {
  const p = await processoPronto(ctx, id);
  if (!p.ok) return p;
  let dados;
  try { dados = await montarDadosDoProcesso(ctx, p.processo); } catch (err) { return erro('Não foi possível ler o ClickUp: ' + err.message); }
  return { ok: true, processo: dados.processo, config: dados.config, status: dados.status, candidatos: dados.candidatos, avisos: dados.avisos };
}

// ---------------------------------------------------------------------------
// Relatórios
// ---------------------------------------------------------------------------

/** Lê o ClickUp, monta o relatório e grava como rascunho. {ok, relatorio, token, avisos}; lança erro. */
async function gerarRascunho(ctx, proc) {
  const dados = await montarDadosDoProcesso(ctx, proc);
  const agora = agoraIso(ctx);
  const relatorio = relMontar(ctx.motor, dados, agora);
  const token = relNovoToken();
  await ctx.db.relatorioInserir({
    token, processo_id: proc.id, status: 'rascunho', dados: relatorio,
    criado_em: agora, atualizado_em: agora, publicado_em: null
  });
  return { ok: true, relatorio, token, avisos: dados.avisos || [] };
}

async function acaoRelatorioRascunho(ctx, processoId) {
  const p = await processoPronto(ctx, processoId);
  if (!p.ok) return p;
  try {
    return await gerarRascunho(ctx, p.processo);
  } catch (err) {
    return erro('Não foi possível gerar o rascunho: ' + err.message);
  }
}

async function lerRelatorio(ctx, token) {
  if (!relTokenValido(token)) return null;
  const l = await ctx.db.relatorioLer(token);
  if (!l || !l.dados || typeof l.dados !== 'object') return null;
  // Relatórios dos modelos novos (equipe/liderança/pessoa) são do painel, não do processo/ClickUp.
  if (!l.processo_id || (l.modelo && l.modelo !== 'processo')) return null;
  return l;
}

async function acaoRelatorioSalvar(ctx, corpo) {
  const novos = (corpo.relatorio && typeof corpo.relatorio === 'object' && corpo.relatorio.textos) || corpo.textos;
  if (!novos || typeof novos !== 'object' || Array.isArray(novos)) return erro('Nada para salvar.');
  const l = await lerRelatorio(ctx, corpo.relatorioToken);
  if (!l) return erro('Relatório não encontrado.');
  const relatorio = l.dados;
  const alterados = relAplicarEdicao(relatorio, corpo) || 0;
  if (alterados) await ctx.db.relatorioAtualizar(l.token, { dados: relatorio, atualizado_em: agoraIso(ctx) });
  return { ok: true, relatorio, alterados };
}

/** Comenta o texto na tarefa "📌 Briefing…" da lista (ou na própria lista). Lança erro se falhar. */
async function comentarNoClickUp(cu, proc, texto) {
  const tarefas = await cu.tarefas(proc.clickupListId);
  const briefing = tarefas.find((t) => cuEhBriefing(t.name));
  if (briefing) await cu.post('/task/' + cuId(briefing.id) + '/comment', { comment_text: texto, notify_all: false });
  else await cu.post('/list/' + cuId(proc.clickupListId) + '/comment', { comment_text: texto, notify_all: false });
  return briefing ? 'tarefa' : 'lista';
}

async function acaoRelatorioPublicar(ctx, token, baseUrl) {
  const base = relBaseSite(baseUrl, ctx.env.SITE_URL);
  const l = await lerRelatorio(ctx, token);
  if (!l) return erro('Relatório não encontrado.');
  const agora = agoraIso(ctx);
  await ctx.db.relatorioAtualizar(l.token, { status: 'publicado', publicado_em: l.publicado_em || agora, atualizado_em: agora });
  const url = base + 'relatorio.html?r=' + l.token;
  const resposta = { ok: true, url };
  const proc = processoDaLinha(await ctx.db.processoPorId(l.processo_id));
  if (!proc || !proc.clickupListId || !ctx.cu.configurado) return resposta;
  if (!base) {
    resposta.aviso = 'Link não comentado no ClickUp: defina o segredo SITE_URL nas Edge Functions (endereço do site).';
    return resposta;
  }
  try {
    resposta.comentadoEm = await comentarNoClickUp(ctx.cu, proc, 'Relatório publicado: ' + url);
  } catch (err) {
    resposta.aviso = 'Relatório publicado, mas não deu para comentar o link no ClickUp (' + err.message + ').';
    ctx.cu.registrarAviso(resposta.aviso);
  }
  return resposta;
}

async function acaoRelatorioDespublicar(ctx, token) {
  const l = await lerRelatorio(ctx, token);
  if (!l) return erro('Relatório não encontrado.');
  await ctx.db.relatorioAtualizar(l.token, { status: 'rascunho', publicado_em: null, atualizado_em: agoraIso(ctx) });
  return { ok: true };
}

async function acaoRelatoriosListar(ctx, processoId) {
  const linhas = await ctx.db.relatoriosListar(limparTexto(processoId, 60));
  const relatorios = (linhas || []).filter((l) => l.processo_id).map((l) => ({
    token: l.token, processoId: l.processo_id ? String(l.processo_id) : '',
    status: l.status === 'publicado' ? 'publicado' : 'rascunho',
    criadoEm: l.criado_em || '', publicadoEm: l.publicado_em || '', atualizadoEm: l.atualizado_em || ''
  })).sort((a, b) => String(b.criadoEm).localeCompare(String(a.criadoEm)));
  return { ok: true, relatorios };
}

async function acaoRelatorioMelhorarTextos(ctx, token, ids) {
  const chave = ctx.env.ANTHROPIC_API_KEY;
  if (!chave) return erro('IA não configurada.');
  const l = await lerRelatorio(ctx, token);
  if (!l) return erro('Relatório não encontrado.');
  const textos = l.dados.textos || {};
  const escolhidos = relIdsParaIa(textos, ids);
  if (!escolhidos.length) return erro('Nenhum texto para melhorar.');
  let mapa;
  try {
    mapa = await relChamarIa(ctx.fetch, chave, escolhidos.map((id) => ({ id, texto: textos[id].texto })));
  } catch (err) {
    return erro('Não foi possível melhorar os textos: ' + err.message);
  }
  const atual = await lerRelatorio(ctx, token); // relê: alguém pode ter editado enquanto a IA trabalhava
  if (!atual) return erro('Relatório não encontrado.');
  const relatorio = atual.dados;
  relatorio.textos = relatorio.textos || {};
  let alterados = 0;
  escolhidos.forEach((id) => {
    if (!mapa[id] || !relatorio.textos[id]) return;
    relatorio.textos[id] = { texto: limparTextoLongo(mapa[id], REL_MAX_TEXTO), origem: 'ia' };
    alterados++;
  });
  if (alterados) await ctx.db.relatorioAtualizar(atual.token, { dados: relatorio, atualizado_em: agoraIso(ctx) });
  return { ok: true, relatorio, alterados };
}

// ---------------------------------------------------------------------------
// Usuários (administradores do painel, no Supabase Auth)
// ---------------------------------------------------------------------------

function usuarioDaLista(admin, u, eu) {
  u = u || {};
  return {
    id: String(admin.user_id), nome: admin.nome || '', email: u.email || '', papel: 'admin', ativo: true,
    criadoEm: admin.criado_em || u.created_at || '',
    ultimoAcesso: u.last_sign_in_at || '',
    convitePendente: !!(u.invited_at && !u.last_sign_in_at),
    voce: String(admin.user_id) === String(eu),
    foto: typeof admin.foto === 'string' && admin.foto.length <= 40000 && /^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/=]+$/.test(admin.foto) ? admin.foto : ''
  };
}

async function acaoUsuariosListar(ctx) {
  const admins = await ctx.db.adminsListar();
  const usuarios = [];
  for (const a of admins) usuarios.push(usuarioDaLista(a, await ctx.authAdmin.usuarioPorId(a.user_id), ctx.usuario.id));
  return { ok: true, usuarios };
}

/** Endereço para onde o convite leva (painel). '' se SITE_URL não estiver definido. */
function enderecoDoPainel(siteUrl) {
  const base = relBaseSite('', siteUrl);
  return base ? base + 'admin.html' : '';
}

async function acaoUsuariosConvidar(ctx, corpo) {
  const dados = corpo.usuario && typeof corpo.usuario === 'object' ? corpo.usuario : corpo;
  const nome = limparTexto(dados.nome, 80);
  if (letrasContadas(nome) < 2) return erro('Informe o nome do usuário.');
  const email = normalizarEmail(dados.email);
  if (!emailValido(email)) return erro('E-mail inválido.');
  const existente = await ctx.authAdmin.usuarioPorEmail(email);
  let usuario;
  let convidado = false;
  if (existente) {
    const admins = await ctx.db.adminsListar();
    if (admins.some((a) => String(a.user_id) === String(existente.id))) return erro('Já existe um usuário com este e-mail.');
    usuario = existente;
  } else {
    try {
      usuario = await ctx.authAdmin.convidar(email, { nome, redirectTo: enderecoDoPainel(ctx.env.SITE_URL) });
    } catch (err) {
      return erro('Não foi possível enviar o convite: ' + err.message);
    }
    convidado = true;
  }
  await ctx.db.adminInserir(usuario.id, nome);
  const admin = { user_id: usuario.id, nome, criado_em: agoraIso(ctx) };
  return { ok: true, convidado, usuario: usuarioDaLista(admin, usuario, ctx.usuario.id) };
}

async function acaoUsuariosRemover(ctx, idBruto) {
  const id = limparTexto(idBruto, 60);
  if (id && id === String(ctx.usuario.id)) return erro('Você não pode excluir o seu próprio acesso.');
  const admins = await ctx.db.adminsListar();
  const alvo = id && admins.find((a) => String(a.user_id) === id);
  if (!alvo) return erro('Usuário não encontrado.');
  if (admins.length <= 1) return erro('Precisa existir pelo menos um administrador ativo.');
  await ctx.db.adminRemover(id);
  try { await ctx.authAdmin.excluir(id); } catch (err) { /* já sem acesso: a linha de admins saiu */ }
  return { ok: true, id };
}

// ---------------------------------------------------------------------------
// Roteador
// ---------------------------------------------------------------------------

const ACOES_ADMIN = {
  'clickup.status': (ctx) => acaoClickupStatus(ctx),
  'clickup.listas': (ctx) => acaoClickupListas(ctx),
  'processo.dados': (ctx, c) => acaoProcessoDados(ctx, c.id),
  'relatorio.rascunho': (ctx, c) => acaoRelatorioRascunho(ctx, c.processoId),
  'relatorio.salvar': (ctx, c) => acaoRelatorioSalvar(ctx, c),
  'relatorio.publicar': (ctx, c) => acaoRelatorioPublicar(ctx, c.relatorioToken, c.baseUrl),
  'relatorio.despublicar': (ctx, c) => acaoRelatorioDespublicar(ctx, c.relatorioToken),
  'relatorios.listar': (ctx, c) => acaoRelatoriosListar(ctx, c.processoId),
  'relatorio.melhorarTextos': (ctx, c) => acaoRelatorioMelhorarTextos(ctx, c.relatorioToken, c.ids),
  'usuarios.listar': (ctx) => acaoUsuariosListar(ctx),
  'usuarios.convidar': (ctx, c) => acaoUsuariosConvidar(ctx, c),
  'usuarios.remover': (ctx, c) => acaoUsuariosRemover(ctx, c.id),
  // Aba Conexões (supabase/funcoes-compartilhadas/conexoes.js): nunca devolvem valores de segredos.
  'conexoes.diagnostico': (ctx) => acaoDiagnostico(ctx),
  'conexoes.testar': (ctx, c) => acaoTestar(ctx, c)
};

/** Executa uma ação já autenticada (ctx.usuario é admin). Sempre devolve {ok, ...}. */
async function executarAcaoAdmin(ctx, corpo) {
  const acao = corpo && corpo.acao;
  if (typeof acao !== 'string' || !Object.prototype.hasOwnProperty.call(ACOES_ADMIN, acao)) return erro('Ação desconhecida.');
  return ACOES_ADMIN[acao](ctx, corpo);
}

// ======== supabase/funcoes-compartilhadas/sincronizar.js ========
// Edge Function "disc-sync": depois do envio do candidato (RPC enviar_resposta), o site chama esta
// função com {id}. Idempotente: grava o DISC na tarefa do ClickUp uma vez só e guarda o resultado em
// public.respostas.clickup_sync. Nunca devolve dados ao navegador.
//
// clickup_sync = { estado: 'sincronizando'|'ok'|'erro', ok, em, tarefaId?, criada?, avisos?, erro? }

const SYNC_TRAVA_MS = 5 * 60 * 1000; // "sincronizando" mais velho que isso pode ser retomado

function idEnvioValido(id) { return typeof id === 'string' && /^[A-Za-z0-9_-]{6,64}$/.test(id); }

/**
 * Sincroniza uma resposta. Devolve {feito, motivo} (só para log/testes; o HTTP responde só {ok}).
 * ctx = { db, cu, agora, confiabilidade }
 */
async function sincronizarResposta(ctx, id) {
  if (!idEnvioValido(id)) return { feito: false, motivo: 'id_invalido' };
  const linha = await ctx.db.respostaPorId(id);
  if (!linha) return { feito: false, motivo: 'nao_encontrada' };
  const atual = linha.clickup_sync;
  if (atual && atual.ok === true) return { feito: false, motivo: 'ja_sincronizada' };
  if (!linha.processo_id) return { feito: false, motivo: 'sem_processo' };
  const proc = processoDaLinha(await ctx.db.processoPorId(linha.processo_id));
  if (!proc || !proc.clickupListId) return { feito: false, motivo: 'sem_lista' };
  const em = new Date(ctx.agora()).toISOString();
  if (!ctx.cu.configurado) {
    await ctx.db.gravarSync(id, { estado: 'erro', ok: false, em, erro: MSG_CU_NAO_CONFIGURADO });
    return { feito: false, motivo: 'sem_token' };
  }
  // Reserva atômica: só um chamador por vez (o banco só troca se ainda estiver livre).
  const limite = new Date(ctx.agora() - SYNC_TRAVA_MS).toISOString();
  const reservou = await ctx.db.reservarSync(id, { estado: 'sincronizando', ok: false, em }, limite);
  if (!reservou) return { feito: false, motivo: 'em_andamento' };
  try {
    const r = await cuSincronizarEnvio(ctx.cu, proc, linha, ctx.confiabilidade);
    await ctx.db.gravarSync(id, {
      estado: r.ok ? 'ok' : 'erro', ok: !!r.ok, em: new Date(ctx.agora()).toISOString(),
      tarefaId: r.tarefaId || '', criada: !!r.criada, avisos: r.avisos || []
    });
    return { feito: !!r.ok, motivo: r.ok ? 'ok' : 'erro' };
  } catch (err) {
    const msg = String(err && err.message || err).substring(0, 300);
    ctx.cu.registrarAviso('Envio ' + (linha.protocolo || '') + ': não foi possível gravar no ClickUp (' + msg + ').');
    await ctx.db.gravarSync(id, { estado: 'erro', ok: false, em: new Date(ctx.agora()).toISOString(), erro: msg });
    return { feito: false, motivo: 'erro' };
  }
}

// ======== supabase/funcoes-compartilhadas/webhook.js ========
// Edge Function "clickup-webhook": o ClickUp avisa quando uma tarefa muda de status. Se a tarefa
// "📌 Briefing…" de uma lista ligada a um processo ativo for para "gerar relatório", gera o rascunho,
// comenta "Rascunho pronto para revisão no painel" e muda a tarefa para "relatório em revisão" (se
// esse status existir na lista). Substitui o gatilho de 10 minutos do Apps Script.
//
// Segurança: o corpo vem assinado (cabeçalho X-Signature = HMAC-SHA256 hexadecimal do corpo bruto com
// o "secret" que o ClickUp devolve ao criar o webhook; guardado no segredo CLICKUP_WEBHOOK_SECRET).

const WEBHOOK_REPETIDO_MS = 2 * 60 * 1000; // rascunho criado há menos disso -> ignora reenvio

function hexDe(buffer) { return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join(''); }

/** HMAC-SHA256 (hex) de "corpo" com "segredo" — WebCrypto (Deno e Node 20+). */
async function hmacSha256Hex(segredo, corpo) {
  const enc = new TextEncoder();
  const chave = await globalThis.crypto.subtle.importKey('raw', enc.encode(segredo), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hexDe(await globalThis.crypto.subtle.sign('HMAC', chave, enc.encode(corpo)));
}

/** Confere a assinatura em tempo constante. Falso se faltar segredo ou assinatura. */
async function assinaturaValida(segredo, corpo, assinatura) {
  if (!segredo || typeof assinatura !== 'string' || !assinatura) return false;
  const esperado = await hmacSha256Hex(segredo, corpo);
  const recebido = assinatura.trim().toLowerCase();
  if (recebido.length !== esperado.length) return false;
  let dif = 0;
  for (let i = 0; i < esperado.length; i++) dif |= esperado.charCodeAt(i) ^ recebido.charCodeAt(i);
  return dif === 0;
}

const GERAR = 'gerar relatorio';
const REVISAO = 'relatorio em revisao';

/** O evento fala de uma mudança PARA "gerar relatório"? (sem histórico: confere na tarefa) */
function eventoPedeRelatorio(evento) {
  const itens = Array.isArray(evento.history_items) ? evento.history_items : null;
  if (!itens || !itens.length) return true;
  return itens.some((h) => h && (h.field === 'status' || !h.field) && h.after &&
    normalizarNomeCampo(typeof h.after === 'object' ? h.after.status : h.after) === GERAR);
}

/**
 * Trata um evento já com assinatura conferida. Devolve {ok, feito, motivo, token?} (só para log/testes).
 * ctx = { db, cu, agora, motor, confiabilidade, env }
 */
async function tratarEventoClickUp(ctx, evento) {
  if (!evento || typeof evento !== 'object' || evento.event !== 'taskStatusUpdated') return { ok: true, feito: false, motivo: 'evento_ignorado' };
  const taskId = typeof evento.task_id === 'string' || typeof evento.task_id === 'number' ? String(evento.task_id) : '';
  if (!taskId) return { ok: true, feito: false, motivo: 'sem_tarefa' };
  if (!eventoPedeRelatorio(evento)) return { ok: true, feito: false, motivo: 'outro_status' };
  if (!ctx.cu.configurado) return { ok: true, feito: false, motivo: 'sem_token' };
  let procNome = '';
  try {
    const tarefa = await ctx.cu.tarefa(taskId);
    if (!cuEhBriefing(tarefa.name)) return { ok: true, feito: false, motivo: 'nao_e_briefing' };
    if (normalizarNomeCampo(tarefa.status && tarefa.status.status) !== GERAR) return { ok: true, feito: false, motivo: 'outro_status' };
    const listId = tarefa.list && tarefa.list.id ? String(tarefa.list.id) : '';
    const proc = listId ? processoDaLinha(await ctx.db.processoPorLista(listId)) : null;
    if (!proc) return { ok: true, feito: false, motivo: 'sem_processo' };
    procNome = proc.nome;
    const recentes = await ctx.db.relatoriosListar(proc.id);
    const agora = ctx.agora();
    if ((recentes || []).some((r) => r.status === 'rascunho' && agora - Date.parse(r.criado_em) < WEBHOOK_REPETIDO_MS)) {
      return { ok: true, feito: false, motivo: 'repetido' };
    }
    const r = await gerarRascunho(ctx, proc);
    await ctx.cu.post('/task/' + cuId(taskId) + '/comment', { comment_text: 'Rascunho pronto para revisão no painel', notify_all: false });
    const revisao = ((await ctx.cu.lista(listId)).statuses || []).find((s) => normalizarNomeCampo(s.status) === REVISAO);
    if (revisao) await ctx.cu.put('/task/' + cuId(taskId), { status: revisao.status });
    return { ok: true, feito: true, motivo: 'gerado', token: r.token };
  } catch (err) {
    ctx.cu.registrarAviso('Gatilho do processo "' + (procNome || '?') + '": ' + String(err && err.message || err));
    return { ok: true, feito: false, motivo: 'erro' };
  }
}

// ======== supabase/funcoes-compartilhadas/http.js ========
// Camada HTTP das Edge Functions (Request -> Response), sem nada do Deno: testável no Node 20+.
//
// base = { env, fetch, dormir?, agora?, db, authAdmin?, autenticar?, motor?, confiabilidade?, emSegundoPlano? }
//   autenticar(authorizationHeader) -> {usuario:{id,email}, eAdmin:boolean} | null
//   emSegundoPlano(promise)          -> EdgeRuntime.waitUntil (opcional)

const LIMITE_CORPO = 20000;
const LIMITE_CORPO_RELATORIO = 450000; // só "relatorio.salvar" (o painel manda os textos do relatório)
const LIMITE_CORPO_WEBHOOK = 1000000;

function origemDoSite(siteUrl) {
  try { return siteUrl ? new URL(String(siteUrl).trim()).origin : ''; } catch (err) { return ''; }
}

/** Origem permitida: a do SITE_URL ou localhost/127.0.0.1 (qualquer porta). */
function origemPermitida(origem, siteUrl) {
  if (!origem) return false;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/.test(origem)) return true;
  const site = origemDoSite(siteUrl);
  return !!site && origem === site;
}

function cabecalhosCors(req, env) {
  const origem = req.headers.get('origin') || '';
  const h = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
  if (origemPermitida(origem, env && env.SITE_URL)) h['Access-Control-Allow-Origin'] = origem;
  return h;
}

function responderJson(obj, status, extras) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, extras || {})
  });
}

function contextoBase(base) {
  const env = base.env || {};
  const agora = base.agora || (() => Date.now());
  const cu = criarClickUp({ token: env.CLICKUP_TOKEN, pastaId: env.CLICKUP_PASTA_ID, fetch: base.fetch, dormir: base.dormir, agora });
  return {
    env, agora, cu, db: base.db, authAdmin: base.authAdmin, fetch: base.fetch,
    motor: base.motor, confiabilidade: base.confiabilidade, prazoConexoesMs: base.prazoConexoesMs
  };
}

async function lerCorpoJson(req, limite) {
  const texto = await req.text();
  if (!texto) return { erro: erro('Requisição vazia.') };
  if (texto.length > limite) return { erro: erro('Requisição grande demais.') };
  let corpo;
  try { corpo = JSON.parse(texto); } catch (err) { return { erro: erro('JSON inválido.') }; }
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) return { erro: erro('Formato de requisição inválido.') };
  return { corpo, tamanho: texto.length };
}

/**
 * Edge Function "admin": exige o JWT de um usuário logado que seja admin (public.e_admin()).
 * Responde sempre HTTP 200 com {ok, ...}; sessão inválida -> {ok:false, erro, sessaoExpirada:true}.
 */
async function atenderAdmin(req, base) {
  const cors = cabecalhosCors(req, base.env);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return responderJson(erro('Método não permitido.'), 405, cors);
  let ctx = null;
  try {
    const lido = await lerCorpoJson(req, LIMITE_CORPO_RELATORIO);
    if (lido.erro) return responderJson(lido.erro, 200, cors);
    if (lido.tamanho > LIMITE_CORPO && lido.corpo.acao !== 'relatorio.salvar') return responderJson(erro('Requisição grande demais.'), 200, cors);
    const quem = await base.autenticar(req.headers.get('authorization') || '');
    if (!quem || !quem.usuario) return responderJson(erro(MSG_SESSAO, { sessaoExpirada: true }), 200, cors);
    if (!quem.eAdmin) return responderJson(erro(MSG_SEM_PERMISSAO), 200, cors);
    ctx = contextoBase(base);
    ctx.usuario = quem.usuario;
    const r = await executarAcaoAdmin(ctx, lido.corpo);
    return responderJson(r, 200, cors);
  } catch (err) {
    try { console.error(err); } catch (e) { /* sem console */ }
    return responderJson(erro(MSG_ERRO_INTERNO), 200, cors);
  } finally {
    if (ctx) await gravarAvisos(ctx.db, ctx.cu.avisos, ctx.agora());
  }
}

/** Edge Function "disc-sync": {id} -> {ok}. Nunca devolve dados da resposta. */
async function atenderDiscSync(req, base) {
  const cors = cabecalhosCors(req, base.env);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return responderJson(erro('Método não permitido.'), 405, cors);
  const lido = await lerCorpoJson(req, 2000).catch(() => ({ erro: erro('Requisição inválida.') }));
  if (lido.erro) return responderJson(lido.erro, 400, cors);
  if (!idEnvioValido(lido.corpo.id)) return responderJson(erro('Identificador do envio inválido.'), 400, cors);
  const ctx = contextoBase(base);
  const trabalho = (async () => {
    try {
      await sincronizarResposta(ctx, lido.corpo.id);
    } catch (err) {
      try { console.error(err); } catch (e) { /* sem console */ }
    } finally {
      await gravarAvisos(ctx.db, ctx.cu.avisos, ctx.agora());
    }
  })();
  // O candidato não espera o ClickUp: responde logo e termina em segundo plano (quando houver).
  if (typeof base.emSegundoPlano === 'function') base.emSegundoPlano(trabalho);
  else await trabalho;
  return responderJson({ ok: true }, 200, cors);
}

/** Edge Function "clickup-webhook" (pública; "Verify JWT" desligado): confere X-Signature e trata o evento. */
async function atenderWebhookClickUp(req, base) {
  if (req.method !== 'POST') return responderJson(erro('Método não permitido.'), 405);
  const segredo = base.env && base.env.CLICKUP_WEBHOOK_SECRET;
  if (!segredo) return responderJson(erro('Webhook não configurado: defina o segredo CLICKUP_WEBHOOK_SECRET.'), 503);
  const texto = await req.text();
  if (texto.length > LIMITE_CORPO_WEBHOOK) return responderJson(erro('Requisição grande demais.'), 413);
  if (!(await assinaturaValida(segredo, texto, req.headers.get('x-signature') || ''))) {
    return responderJson(erro('Assinatura inválida.'), 401);
  }
  let evento;
  try { evento = JSON.parse(texto); } catch (err) { return responderJson(erro('JSON inválido.'), 400); }
  const ctx = contextoBase(base);
  const trabalho = (async () => {
    try {
      return await tratarEventoClickUp(ctx, evento);
    } catch (err) {
      try { console.error(err); } catch (e) { /* sem console */ }
      return { ok: true, feito: false, motivo: 'erro' };
    } finally {
      await gravarAvisos(ctx.db, ctx.cu.avisos, ctx.agora());
    }
  })();
  // Responde logo ao ClickUp (ele reenvia se demorar) e termina o trabalho em segundo plano.
  if (typeof base.emSegundoPlano === 'function') {
    base.emSegundoPlano(trabalho);
    return responderJson({ ok: true }, 200);
  }
  await trabalho;
  return responderJson({ ok: true }, 200);
}

// ======== supabase/funcoes-compartilhadas/supabase-adaptadores.js ========
// Adaptadores entre a lógica das funções e o supabase-js (cliente "service role" no servidor).
// Recebem o cliente pronto (createClient vem do index.ts via jsr:@supabase/supabase-js@2), então
// são testáveis no Node com um cliente falso.

const NOMES_ENV = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'CLICKUP_TOKEN',
  'CLICKUP_PASTA_ID', 'CLICKUP_WEBHOOK_SECRET', 'ANTHROPIC_API_KEY', 'SITE_URL',
  // Só para a aba Conexões (presença) e o link de teste da InfinitePay: os valores nunca saem do servidor.
  'PAGAMENTO_PROVEDOR', 'INFINITEPAY_HANDLE', 'ASAAS_API_KEY', 'ASAAS_WEBHOOK_TOKEN', 'ASAAS_AMBIENTE',
  'RESEND_API_KEY', 'EMAIL_REMETENTE'];

/** Lê os segredos pelo getter (Deno.env.get). Ausente -> ''. */
function lerEnv(get) {
  const env = {};
  NOMES_ENV.forEach((n) => { let v = ''; try { v = get(n) || ''; } catch (err) { v = ''; } env[n] = String(v).trim(); });
  return env;
}

const COLUNAS_TESTE = 'id, status, valor_centavos, checkout_url, provedor_dados, criado_em, pago_em';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuidValido(v) { return typeof v === 'string' && UUID.test(v); }

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
function criarDb(sb) {
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
function criarAuthAdmin(sb) {
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
function criarAutenticador(createClient, env) {
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
function criarBaseSupabase(createClient, getEnv, extras) {
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

// ======== supabase/funcoes-compartilhadas/motores-gerado.js ========
// ARQUIVO GERADO AUTOMATICAMENTE — NÃO EDITE. Rode: npm run montar:funcoes
// Cópias de js/scoring.js, js/confiabilidade.js, js/relatorio-motor.js como ES module para as Edge Functions.
// Cada script roda numa função com "self" e "module" próprios (não toca no escopo global do Deno).
/* eslint-disable */
const __motoresDisc = {};

// ---- js/scoring.js ----
(function (self, module, require) {
/*
 * Cálculo DISC — replica exatamente as fórmulas da aba "Modelo" da planilha:
 *   total de cada letra = soma das notas (1..4) dos 25 grupos  -> 25..100
 *   percentual          = total / 2.5                           -> 10..40 (soma dos 4 = 100)
 *
 * Formato das respostas (contrato compartilhado entre app, admin e backend):
 *   respostas: array com 25 objetos { D: n, I: n, S: n, C: n }, cada n em {1,2,3,4} sem repetir.
 *   Forma compacta (para transporte/planilha): string de 100 dígitos, 4 por grupo na ordem D,I,S,C.
 */
(function (root) {
  var LETRAS = ['D', 'I', 'S', 'C'];
  var TOTAL_GRUPOS = 25;

  function validarGrupo(g) {
    if (!g) return false;
    var vistos = {};
    for (var i = 0; i < LETRAS.length; i++) {
      var n = g[LETRAS[i]];
      if (n !== 1 && n !== 2 && n !== 3 && n !== 4) return false;
      if (vistos[n]) return false;
      vistos[n] = true;
    }
    return true;
  }

  function validarRespostas(respostas) {
    if (!Array.isArray(respostas) || respostas.length !== TOTAL_GRUPOS) return false;
    for (var i = 0; i < respostas.length; i++) if (!validarGrupo(respostas[i])) return false;
    return true;
  }

  // Retorna { totais: {D,I,S,C}, percentuais: {D,I,S,C}, ordem: ['D','C',...], primario, secundario, codigo }
  function calcular(respostas) {
    if (!validarRespostas(respostas)) throw new Error('Respostas inválidas: esperado 25 grupos com notas 1-4 sem repetição.');
    var totais = { D: 0, I: 0, S: 0, C: 0 };
    respostas.forEach(function (g) {
      LETRAS.forEach(function (l) { totais[l] += g[l]; });
    });
    var percentuais = {};
    LETRAS.forEach(function (l) { percentuais[l] = Math.round((totais[l] / 2.5) * 10) / 10; });
    // Empate: mantém a ordem D, I, S, C (estável).
    var ordem = LETRAS.slice().sort(function (a, b) { return totais[b] - totais[a]; });
    return {
      totais: totais,
      percentuais: percentuais,
      ordem: ordem,
      primario: ordem[0],
      secundario: ordem[1],
      codigo: ordem[0] + ordem[1]
    };
  }

  function compactar(respostas) {
    return respostas.map(function (g) { return LETRAS.map(function (l) { return g[l]; }).join(''); }).join('');
  }

  function descompactar(str) {
    str = String(str || '').replace(/\D/g, '');
    if (str.length !== TOTAL_GRUPOS * 4) throw new Error('Respostas compactas inválidas.');
    var out = [];
    for (var i = 0; i < TOTAL_GRUPOS; i++) {
      var g = {};
      LETRAS.forEach(function (l, j) { g[l] = Number(str[i * 4 + j]); });
      out.push(g);
    }
    return out;
  }

  var DISC_SCORING = {
    LETRAS: LETRAS,
    TOTAL_GRUPOS: TOTAL_GRUPOS,
    validarGrupo: validarGrupo,
    validarRespostas: validarRespostas,
    calcular: calcular,
    compactar: compactar,
    descompactar: descompactar
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = DISC_SCORING;
  else root.DISC_SCORING = DISC_SCORING;
})(typeof self !== 'undefined' ? self : this);
}).call(__motoresDisc, __motoresDisc, undefined, undefined);

// ---- js/confiabilidade.js ----
(function (self, module, require) {
/*
 * Confiabilidade do resultado — calculada no painel (como o perfil), a partir das respostas e do
 * objeto `validacao` do payload (etapa de js/validacao.js). Nunca é mostrada ao participante.
 *
 * avaliar(respostasCompactas, validacao, opcoes?) -> { nivel: 'alta'|'media'|'baixa'|'indisponivel', pontos: 0..100,
 *                                             motivos: [string], detalhes: {...} }
 *
 * validacao = { versao: 1, pares: [[l1,l2] x3], escolhas: [letra x3], itens: [{id, letra, tipo, nota 1..5} x4],
 *               gruposSeg: [número x25], semMexer: inteiro, demonstracao: bool }
 *
 * Regras (docs/SPEC.md):
 *  - Retratos: em cada par o esperado é a letra de maior total (empate: qualquer uma vale). Acertos 0..3.
 *  - Frases: força do 1º e do 2º traço >= 4 = coerente; sombra do 1º <= 2 com força do 1º >= 4 =
 *    "só reconheceu o lado positivo" (leve); contraste >= 4 com força do 1º <= 2 = incoerente (forte).
 *  - Rapidez: grupos com 0 < seg < 3 em mais de 30% dos respondidos = forte.
 *  - Ordem aceita sem mexer em mais de 50% dos respondidos = leve.
 *  - Perfil achatado: maior% - menor% < 8 OU todos os fatores entre 20% e 30% = leve (um só alerta).
 *  - Fatores opostos altos: D e S >= 30% ou I e C >= 30% = leve. É um ponto para conversar (a pessoa
 *    pode transitar entre estilos opostos ou ter respondido pensando em situações diferentes), não sinal de fraude.
 *  - Tempo total < 4 min ou > 30 min = leve. Fonte, nesta ordem: opcoes.duracaoSeg (3º argumento,
 *    ex.: payload.duracaoSeg), validacao.duracaoSeg, soma de gruposSeg (só quando os 25 grupos têm tempo;
 *    sem a soma de telas fora dos grupos, por isso só vale para o limite inferior). Ignorado em demonstração.
 *  - Nível: baixa se acertos <= 1 ou 2+ fortes; alta se acertos >= 2, nenhum forte e no máx. 1 leve; senão média.
 */
(function (root) {
  var SCORING = (typeof module !== 'undefined' && module.exports)
    ? require('./scoring.js')
    : root.DISC_SCORING;
  var LETRAS = ['D', 'I', 'S', 'C'];

  function ehLetra(l) { return LETRAS.indexOf(l) >= 0; }

  function indisponivel(motivo) {
    return { nivel: 'indisponivel', pontos: 0, motivos: [motivo], detalhes: {} };
  }

  function nota(itens, letra, tipo) {
    for (var i = 0; i < itens.length; i++) {
      var it = itens[i];
      if (it && it.letra === letra && it.tipo === tipo) {
        var n = Number(it.nota);
        return n >= 1 && n <= 5 ? n : null;
      }
    }
    return null;
  }

  var LIMIAR_OPOSTO = 30;
  var TEMPO_MIN = 4 * 60;
  var TEMPO_MAX = 30 * 60;

  function minutos(seg) {
    var m = Math.round(seg / 60);
    return m <= 1 ? 'cerca de 1 minuto' : 'cerca de ' + m + ' minutos';
  }

  function avaliar(respostasCompactas, validacao, opcoes) {
    opcoes = opcoes && typeof opcoes === 'object' ? opcoes : {};
    if (!validacao || typeof validacao !== 'object' || !Array.isArray(validacao.pares)) {
      return indisponivel('Respostas sem a etapa de confirmação (feitas antes dela existir).');
    }
    var resultado;
    try { resultado = SCORING.calcular(SCORING.descompactar(respostasCompactas)); }
    catch (e) { return indisponivel('Não foi possível ler as respostas.'); }

    var totais = resultado.totais;
    var ordem = resultado.ordem;
    var primario = ordem[0], secundario = ordem[1], ultimo = ordem[3];
    var fortes = [], leves = [], positivos = [];

    // 1) Retratos
    var pares = validacao.pares;
    var escolhas = Array.isArray(validacao.escolhas) ? validacao.escolhas : [];
    var acertos = 0, paresValidos = 0;
    for (var i = 0; i < pares.length && i < 3; i++) {
      var p = pares[i];
      if (!Array.isArray(p) || !ehLetra(p[0]) || !ehLetra(p[1])) continue;
      paresValidos++;
      var esc = escolhas[i];
      if (esc !== p[0] && esc !== p[1]) continue;
      var outra = esc === p[0] ? p[1] : p[0];
      if (totais[esc] >= totais[outra]) acertos++;
    }
    if (acertos === 3) positivos.push('Reconheceu-se nos 3 retratos que combinam com o resultado.');
    else if (acertos === 2) positivos.push('Reconheceu-se em 2 de 3 retratos que combinam com o resultado.');
    else fortes.push('Escolheu retratos diferentes do resultado (' + acertos + ' de 3).');

    // 2) Força x sombra
    var itens = Array.isArray(validacao.itens) ? validacao.itens : [];
    var fP = nota(itens, primario, 'forca');
    var sP = nota(itens, primario, 'sombra');
    var fS = nota(itens, secundario, 'forca');
    var ctr = nota(itens, ultimo, 'contraste');
    var coerente = fP !== null && fS !== null && fP >= 4 && fS >= 4;
    var soPositivo = fP !== null && sP !== null && fP >= 4 && sP <= 2;
    var incoerente = ctr !== null && fP !== null && ctr >= 4 && fP <= 2;
    if (coerente) positivos.push('Concordou com as frases sobre seus pontos fortes.');
    if (soPositivo) leves.push('Só reconheceu o lado positivo (negou o excesso do próprio ponto forte).');
    if (incoerente) fortes.push('Concordou com a frase oposta ao resultado e discordou da que combina.');

    // 3) Rapidez e ordem aceita
    var seg = Array.isArray(validacao.gruposSeg) ? validacao.gruposSeg : [];
    var respondidos = 0, rapidos = 0;
    seg.forEach(function (s) {
      s = Number(s);
      if (s > 0) { respondidos++; if (s < 3) rapidos++; }
    });
    if (respondidos > 0 && rapidos / respondidos > 0.3) {
      fortes.push('Respondeu ' + rapidos + ' grupos em menos de 3 segundos.');
    }
    var semMexer = Math.max(0, Math.floor(Number(validacao.semMexer) || 0));
    var base = respondidos || SCORING.TOTAL_GRUPOS;
    if (semMexer / base > 0.5) {
      leves.push('Aceitou a ordem inicial sem mexer em ' + semMexer + ' grupos.');
    }

    // 4) Perfil achatado
    var pcts = LETRAS.map(function (l) { return resultado.percentuais[l]; });
    var amplitude = Math.round((Math.max.apply(null, pcts) - Math.min.apply(null, pcts)) * 10) / 10;
    var pct = resultado.percentuais;
    var faixaMedia = LETRAS.every(function (l) { return pct[l] >= 20 && pct[l] <= 30; });
    var achatado = amplitude < 8 || faixaMedia;
    if (achatado) leves.push('Perfil pouco definido (notas muito parecidas entre si).');

    // 5) Fatores opostos altos (ritmo: D × S; foco: I × C)
    var opostos = [];
    if (pct.D >= LIMIAR_OPOSTO && pct.S >= LIMIAR_OPOSTO) opostos.push('DS');
    if (pct.I >= LIMIAR_OPOSTO && pct.C >= LIMIAR_OPOSTO) opostos.push('IC');
    if (opostos.length) {
      leves.push('Dois estilos opostos aparecem altos ao mesmo tempo (' +
        opostos.map(function (o) { return o === 'DS' ? 'agir rápido e manter a calma e a constância' : 'falar com as pessoas e se concentrar nos detalhes'; }).join('; ') +
        '). Vale conversar: pode ser versatilidade real ou respostas pensadas em situações diferentes.');
    }

    // 6) Tempo total
    var duracaoSeg = null, tempoFonte = null;
    [[opcoes.duracaoSeg, 'payload'], [validacao.duracaoSeg, 'validacao']].forEach(function (c) {
      var n = Number(c[0]);
      if (duracaoSeg === null && c[0] !== null && c[0] !== undefined && c[0] !== '' && isFinite(n) && n > 0) { duracaoSeg = Math.round(n); tempoFonte = c[1]; }
    });
    if (duracaoSeg === null && respondidos >= SCORING.TOTAL_GRUPOS) {
      duracaoSeg = Math.round(seg.reduce(function (a, s) { s = Number(s); return a + (s > 0 ? s : 0); }, 0));
      tempoFonte = 'grupos';
    }
    var tempo = null;
    if (duracaoSeg !== null && validacao.demonstracao !== true) {
      if (duracaoSeg < TEMPO_MIN) tempo = 'curto';
      else if (duracaoSeg > TEMPO_MAX && tempoFonte !== 'grupos') tempo = 'longo';
    }
    if (tempo === 'curto') leves.push('Fez o teste em ' + minutos(duracaoSeg) + ' (menos de 4 minutos é pouco para ler e ordenar os grupos com atenção).');
    if (tempo === 'longo') leves.push('Levou ' + minutos(duracaoSeg) + ' para concluir (mais de 30 minutos): pode ter havido interrupções; vale confirmar na conversa.');

    // Nível
    var nivel;
    if (acertos <= 1 || fortes.length >= 2) nivel = 'baixa';
    else if (acertos >= 2 && fortes.length === 0 && leves.length <= 1) nivel = 'alta';
    else nivel = 'media';

    var pontos = 10 + acertos * 20 + (coerente ? 30 : 0) - fortes.length * 25 - leves.length * 10;
    pontos = Math.max(0, Math.min(100, pontos));

    var motivos = fortes.concat(leves, positivos);
    if (validacao.demonstracao === true) motivos.push('Feito em modo demonstração (parte dos grupos preenchida ao acaso).');

    return {
      nivel: nivel,
      pontos: pontos,
      motivos: motivos,
      detalhes: {
        acertos: acertos,
        paresValidos: paresValidos,
        coerente: coerente,
        soPositivo: soPositivo,
        incoerente: incoerente,
        respondidos: respondidos,
        rapidos: rapidos,
        semMexer: semMexer,
        amplitude: amplitude,
        achatado: achatado,
        opostos: opostos,
        duracaoSeg: duracaoSeg,
        tempoFonte: tempoFonte,
        tempo: tempo,
        alertasFortes: fortes,
        alertasLeves: leves,
        demonstracao: validacao.demonstracao === true
      }
    };
  }

  var NIVEIS = { alta: 'Alta', media: 'Média', baixa: 'Baixa', indisponivel: 'Sem dados' };

  var DISC_CONFIABILIDADE = { avaliar: avaliar, NIVEIS: NIVEIS };
  if (typeof module !== 'undefined' && module.exports) module.exports = DISC_CONFIABILIDADE;
  else root.DISC_CONFIABILIDADE = DISC_CONFIABILIDADE;
})(typeof self !== 'undefined' ? self : this);
}).call(__motoresDisc, __motoresDisc, undefined, undefined);

// ---- js/relatorio-motor.js ----
(function (self, module, require) {
/*
 * Motor do relatório do processo seletivo (DISC_RELATORIO).
 *
 * Recebe os dados normalizados do processo (montados pelo servidor a partir do ClickUp) e devolve o
 * JSON do relatório para o contratante: capa, sumário, atração, etapas, DISC, ranking e encerramento,
 * com os textos escritos por regras (origem 'regra'). Veja o contrato em docs/SPEC.md.
 *
 * Regras de ouro:
 *  - ES5 puro, sem dependências e determinístico: o mesmo arquivo roda no navegador, no Node (testes) e
 *    no Apps Script (apps-script/RelatorioMotor.gs é uma cópia gerada por "npm run montar:apps-script").
 *  - Nada de Date.now() dentro de montar: a data de geração vem de opcoes.agora (ou opcoes.geradoEm).
 *  - Só lê campos conhecidos do candidato. Nomes saem como "primeiro nome + inicial" e nunca há
 *    telefone, e-mail, idade individual ou qualquer dado sensível no relatório. Os textos nunca usam
 *    idade ou dados pessoais como critério.
 *
 * API: montar(processoDados, opcoes?), calcularScore(candidato, config, aplicadas?),
 *      aderenciaDisc(codigo, perfilIdeal, confiabilidade), primeiroNome(nome), funil(candidatos, status).
 */
var DISC_RELATORIO = (function () {
  'use strict';

  var VERSAO = 1;
  var CORTE_PADRAO = 70;
  var FAIXA_PADRAO = 55;
  var NOTA_MUITO_BAIXA = 4;
  var LETRAS = ['D', 'I', 'S', 'C'];
  var PARTICULAS = { de: 1, da: 1, das: 1, 'do': 1, dos: 1, e: 1, di: 1, du: 1, del: 1, van: 1, von: 1 };
  var MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  var EXTENSO = ['zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez'];
  var TRACO = {
    D: 'decisão e foco em resultado',
    I: 'comunicação e persuasão',
    S: 'paciência e constância',
    C: 'rigor e atenção às regras'
  };
  var NOME_LETRA = { D: 'Dominante', I: 'Influente', S: 'Estável', C: 'Cauteloso' };
  var ORDEM_ADERENCIA = { ideal: 0, boa: 1, media: 2, baixa: 3, indefinida: 4 };

  // ---------------------------------------------------------------------------
  // Utilitários
  // ---------------------------------------------------------------------------

  function ehNumero(n) { return typeof n === 'number' && isFinite(n); }
  function r1(n) { return ehNumero(n) ? Math.round(n * 10 + (n >= 0 ? 1e-9 : -1e-9)) / 10 : null; }
  function texto(v) { return v === null || v === undefined ? '' : String(v); }

  function semAcento(s) {
    s = texto(s);
    if (typeof s.normalize === 'function') s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
    return s;
  }
  function normalizar(s) { return semAcento(s).toLowerCase().replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, ''); }

  // 12,5 · 70 · -3,2
  function fmt(n) {
    var v = r1(n);
    if (v === null) return '—';
    var s = (Math.round(v * 10) % 10 === 0) ? String(Math.round(v)) : v.toFixed(1);
    return s.replace('.', ',');
  }
  // sempre com uma casa: 87,9 · 70,0
  function fmt1(n) { var v = r1(n); return v === null ? '—' : v.toFixed(1).replace('.', ','); }
  function fmtPts(n) { var v = r1(n); return fmt(v) + (Math.abs(v) === 1 ? ' ponto' : ' pontos'); }
  function fmtMoeda(n) {
    if (!ehNumero(n)) return '—';
    var s = String(Math.round(n));
    var neg = s.charAt(0) === '-';
    if (neg) s = s.slice(1);
    var out = '';
    while (s.length > 3) { out = '.' + s.slice(-3) + out; s = s.slice(0, -3); }
    return (neg ? '-' : '') + 'R$ ' + s + out;
  }
  function extenso(n) { return n >= 0 && n <= 10 && n === Math.floor(n) ? EXTENSO[n] : String(n); }

  // "A", "A e B", "A, B e C"
  function juntar(lista) {
    if (!lista.length) return '';
    if (lista.length === 1) return lista[0];
    return lista.slice(0, -1).join(', ') + ' e ' + lista[lista.length - 1];
  }
  function maiuscula(s) { s = texto(s); return s.charAt(0).toUpperCase() + s.slice(1); }
  function semPontoFinal(s) { return texto(s).replace(/[\s.;:]+$/, ''); }
  function comPonto(s) { s = texto(s); return /[.!?]$/.test(s) ? s : s + '.'; }
  // "Revisão documental" -> "revisão documental" (mantém siglas: "CLT", "DISC")
  function minuscula(s) {
    s = texto(s);
    if (s.length > 1 && s.charAt(1) !== s.charAt(1).toLowerCase()) return s;
    return s.charAt(0).toLowerCase() + s.slice(1);
  }

  function comparaTexto(a, b) {
    var x = normalizar(a), y = normalizar(b);
    return x < y ? -1 : (x > y ? 1 : 0);
  }

  function dataCurta(iso, comAno) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(texto(iso));
    if (!m) return '';
    var mes = MESES[Number(m[2]) - 1];
    if (!mes) return '';
    return Number(m[3]) + ' ' + mes + (comAno ? ' ' + m[1] : '');
  }
  function periodoTexto(p) {
    if (!p) return '';
    var ini = texto(p.inicio), fim = texto(p.fim);
    var anoIni = ini.slice(0, 4), anoFim = fim.slice(0, 4);
    if (ini && fim) return dataCurta(ini, anoIni !== anoFim) + ' — ' + dataCurta(fim, true);
    return dataCurta(ini || fim, true);
  }

  // ---------------------------------------------------------------------------
  // Nomes
  // ---------------------------------------------------------------------------

  // "Ana Paula Souza" -> "Ana P."; "Fábio" -> "Fábio". Nunca devolve o nome completo.
  function primeiroNome(nome) {
    var partes = texto(nome).replace(/\(.*?\)/g, ' ').replace(/[^\s\wÀ-ÿ'-]/g, ' ').split(/\s+/)
      .filter(function (p) { return p; });
    if (!partes.length) return 'Sem nome';
    var primeiro = maiuscula(partes[0]);
    for (var i = 1; i < partes.length; i++) {
      if (!PARTICULAS[partes[i].toLowerCase()]) return primeiro + ' ' + partes[i].charAt(0).toUpperCase() + '.';
    }
    return primeiro;
  }

  // Nome curto único dentro do processo (desempata com mais iniciais).
  function nomesCurtos(candidatos) {
    var mapa = {}, usados = {};
    candidatos.forEach(function (c) {
      var curto = primeiroNome(c.nome);
      if (usados[curto]) {
        var partes = texto(c.nome).split(/\s+/).filter(function (p) { return p && !PARTICULAS[p.toLowerCase()]; });
        var alt = maiuscula(partes[0] || curto);
        for (var i = 1; i < partes.length; i++) alt += ' ' + partes[i].charAt(0).toUpperCase() + '.';
        curto = usados[alt] ? curto : alt;
      }
      var base = curto, n = 2;
      while (usados[curto]) curto = base + ' (' + (n++) + ')';
      usados[curto] = true;
      mapa[c.id] = curto;
    });
    return mapa;
  }

  // ---------------------------------------------------------------------------
  // Configuração
  // ---------------------------------------------------------------------------

  function lerConfig(cfg) {
    cfg = cfg || {};
    var etapas = (cfg.etapas || []).filter(function (e) { return e && e.id; }).map(function (e) {
      var peso = Number(e.peso);
      return { id: String(e.id), nome: texto(e.nome) || String(e.id), peso: ehNumero(peso) && peso > 0 ? peso : 0, descricao: texto(e.descricao) };
    });
    var bonus = (cfg.bonus || []).filter(function (b) { return b && b.id; }).map(function (b) {
      return { id: String(b.id), nome: texto(b.nome) || String(b.id), regra: b.regra || {} };
    });
    var corte = Number(cfg.corte), faixa = Number(cfg.faixaAvaliar);
    return {
      perfilIdeal: codigoLimpo(cfg.perfilIdeal).slice(0, 2),
      explicacaoPerfil: texto(cfg.explicacaoPerfil),
      etapas: etapas,
      bonus: bonus,
      corte: ehNumero(corte) && cfg.corte !== null && cfg.corte !== '' ? corte : CORTE_PADRAO,
      faixaAvaliar: ehNumero(faixa) && cfg.faixaAvaliar !== null && cfg.faixaAvaliar !== '' ? faixa : FAIXA_PADRAO,
      statusFinalistas: (cfg.statusFinalistas || []).map(normalizar)
    };
  }

  function codigoLimpo(c) {
    var s = texto(c).toUpperCase().replace(/[^DISC]/g, '');
    var out = '';
    for (var i = 0; i < s.length; i++) if (out.indexOf(s.charAt(i)) < 0) out += s.charAt(i);
    return out;
  }

  function notaDe(candidato, etapaId) {
    var v = candidato && candidato.notas ? candidato.notas[etapaId] : null;
    if (v === null || v === undefined || v === '') return null;
    var n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
    if (!ehNumero(n)) return null;
    return Math.max(0, Math.min(10, n));
  }

  // Etapas aplicadas = com ao menos uma nota no processo.
  function etapasAplicadas(candidatos, config) {
    var cfg = lerConfig(config);
    var ids = [];
    cfg.etapas.forEach(function (e) {
      for (var i = 0; i < candidatos.length; i++) {
        if (notaDe(candidatos[i], e.id) !== null) { ids.push(e.id); return; }
      }
    });
    return ids;
  }

  function verdadeiro(v) {
    if (v === true || v === 1) return true;
    var n = normalizar(v);
    return n === 'true' || n === 'sim' || n === '1' || n === 'x' || n === 'yes';
  }

  function pontosBonus(regra, valor) {
    if (!regra || valor === null || valor === undefined || valor === '' || valor === false) return 0;
    if (regra.tipo === 'checkbox') return verdadeiro(valor) ? (Number(regra.pontos) || 0) : 0;
    if (regra.tipo === 'mapa' && regra.pontos && typeof regra.pontos === 'object') {
      var chave = texto(valor);
      if (Object.prototype.hasOwnProperty.call(regra.pontos, chave)) return Number(regra.pontos[chave]) || 0;
      var alvo = normalizar(chave), k;
      for (k in regra.pontos) {
        if (Object.prototype.hasOwnProperty.call(regra.pontos, k) && normalizar(k) === alvo) return Number(regra.pontos[k]) || 0;
      }
      // "5 - Excelente" casa com a chave "5"
      var m = /^\s*(-?\d+(?:[.,]\d+)?)/.exec(chave);
      if (m) {
        for (k in regra.pontos) {
          if (Object.prototype.hasOwnProperty.call(regra.pontos, k) && normalizar(k) === m[1].replace(',', '.')) return Number(regra.pontos[k]) || 0;
        }
      }
      return 0;
    }
    return 0;
  }

  // ---------------------------------------------------------------------------
  // Score
  // ---------------------------------------------------------------------------

  function pesosNormalizados(cfg, aplicadas) {
    var marca = {};
    aplicadas.forEach(function (id) { marca[id] = true; });
    var usadas = cfg.etapas.filter(function (e) { return marca[e.id]; });
    var soma = 0;
    usadas.forEach(function (e) { soma += e.peso; });
    var mapa = {};
    usadas.forEach(function (e) { mapa[e.id] = soma > 0 ? e.peso / soma * 100 : 100 / usadas.length; });
    return mapa;
  }

  function situacaoDe(total, cfg) {
    var t = r1(total);
    if (t >= cfg.corte) return 'aprovado';
    if (t >= cfg.faixaAvaliar) return 'avaliar';
    return 'nao_recomendado';
  }

  /*
   * calcularScore(candidato, config, aplicadas?)
   *  aplicadas: ids das etapas que contam (com ao menos uma nota no processo). Sem ela, valem as
   *  etapas em que este candidato tem nota.
   *  -> { tecnico, bonus, total, situacao, incompleto, contribuicoes:{etapaId:pts}, bonusDetalhe:[{id,nome,pontos}],
   *       aplicadas:[ids], pendentes:[ids], faltando:[ids] }
   */
  function calcularScore(candidato, config, aplicadas) {
    var cfg = lerConfig(config);
    if (!aplicadas) aplicadas = etapasAplicadas([candidato], cfg);
    var pesos = pesosNormalizados(cfg, aplicadas);
    var tecnico = 0, incompleto = false, contribuicoes = {}, faltando = [], pendentes = [];
    cfg.etapas.forEach(function (e) {
      if (!Object.prototype.hasOwnProperty.call(pesos, e.id)) { pendentes.push(e.id); return; }
      var n = notaDe(candidato, e.id);
      if (n === null) { incompleto = true; faltando.push(e.id); n = 0; }
      var pts = n / 10 * pesos[e.id];
      contribuicoes[e.id] = r1(pts);
      tecnico += pts;
    });
    var bonus = 0, bonusDetalhe = [];
    var valores = (candidato && candidato.bonusValores) || {};
    cfg.bonus.forEach(function (b) {
      var p = pontosBonus(b.regra, valores[b.id]);
      if (p) bonusDetalhe.push({ id: b.id, nome: b.nome, pontos: p });
      bonus += p;
    });
    var total = tecnico + bonus;
    return {
      tecnico: r1(tecnico), bonus: r1(bonus), total: r1(total), situacao: situacaoDe(total, cfg),
      incompleto: incompleto, contribuicoes: contribuicoes, bonusDetalhe: bonusDetalhe,
      aplicadas: aplicadas.slice(), pendentes: pendentes, faltando: faltando
    };
  }

  // ---------------------------------------------------------------------------
  // DISC
  // ---------------------------------------------------------------------------

  function nivelConfiabilidade(conf) {
    var n = conf && typeof conf === 'object' ? conf.nivel : conf;
    n = normalizar(n);
    return n === 'alta' || n === 'media' || n === 'baixa' ? n : 'indisponivel';
  }

  function aderenciaDisc(codigo, perfilIdeal, confiabilidade) {
    var c = codigoLimpo(codigo), ideal = codigoLimpo(perfilIdeal);
    if (!c || !ideal) return 'indefinida';
    if (nivelConfiabilidade(confiabilidade) === 'baixa') return 'indefinida';
    if (c === ideal || (ideal.length === 1 && c.charAt(0) === ideal)) return 'ideal';
    if (c.charAt(0) === ideal.charAt(0)) return 'boa';
    if (ideal.indexOf(c.charAt(0)) >= 0 || (c.length > 1 && ideal.indexOf(c.charAt(1)) >= 0)) return 'media';
    return 'baixa';
  }

  function descreverIdeal(ideal) {
    if (!ideal) return '';
    var a = ideal.charAt(0), b = ideal.charAt(1);
    var s = NOME_LETRA[a] + ' (' + a + ')';
    if (b) s += ' com ' + NOME_LETRA[b] + ' (' + b + ') como segundo traço';
    return s;
  }

  // ---------------------------------------------------------------------------
  // Funil / atração
  // ---------------------------------------------------------------------------

  function funil(candidatos, status) {
    candidatos = candidatos || [];
    var ordem = {}, nomes = {};
    (status || []).forEach(function (s, i) {
      var k = normalizar(s && s.nome);
      if (k && !Object.prototype.hasOwnProperty.call(ordem, k)) { ordem[k] = i; nomes[k] = s.nome; }
    });
    var cont = {}, chaves = [];
    candidatos.forEach(function (c) {
      var k = normalizar(c.status) || 'sem status';
      if (!cont[k]) { cont[k] = 0; chaves.push(k); if (!nomes[k]) nomes[k] = texto(c.status) || 'sem status'; }
      cont[k]++;
    });
    var total = candidatos.length;
    chaves.sort(function (a, b) {
      if (cont[b] !== cont[a]) return cont[b] - cont[a];
      var oa = Object.prototype.hasOwnProperty.call(ordem, a) ? ordem[a] : 999;
      var ob = Object.prototype.hasOwnProperty.call(ordem, b) ? ordem[b] : 999;
      return oa !== ob ? oa - ob : comparaTexto(a, b);
    });
    return {
      total: total,
      porStatus: chaves.map(function (k) { return { status: nomes[k], qtd: cont[k], pct: total ? r1(cont[k] / total * 100) : 0 }; })
    };
  }

  function media(lista) {
    var v = lista.filter(function (n) { return ehNumero(n) && n > 0; });
    if (!v.length) return null;
    var s = 0;
    v.forEach(function (n) { s += n; });
    return s / v.length;
  }

  var FAIXAS = [
    { ate: 24, rotulo: 'Até 24' }, { ate: 29, rotulo: '25 a 29' }, { ate: 34, rotulo: '30 a 34' },
    { ate: 44, rotulo: '35 a 44' }, { ate: 999, rotulo: '45 ou mais' }
  ];
  function faixasEtarias(candidatos) {
    var cont = {}, ordem = [];
    function soma(rotulo) { if (!cont[rotulo]) { cont[rotulo] = 0; ordem.push(rotulo); } cont[rotulo]++; }
    FAIXAS.forEach(function (f) { cont[f.rotulo] = 0; });
    candidatos.forEach(function (c) {
      if (ehNumero(c.idade) && c.idade > 0) {
        for (var i = 0; i < FAIXAS.length; i++) if (c.idade <= FAIXAS[i].ate) { cont[FAIXAS[i].rotulo]++; break; }
      } else if (texto(c.idadeFaixa)) {
        soma(texto(c.idadeFaixa).slice(0, 40));
      }
    });
    var out = FAIXAS.filter(function (f) { return cont[f.rotulo] > 0; }).map(function (f) { return { faixa: f.rotulo, qtd: cont[f.rotulo] }; });
    ordem.sort(comparaTexto).forEach(function (r) { out.push({ faixa: r, qtd: cont[r] }); });
    return out;
  }

  function contarRotulos(candidatos, campo) {
    var cont = {}, nomes = {}, chaves = [];
    candidatos.forEach(function (c) {
      var v = texto(c[campo]).slice(0, 60);
      if (!v) return;
      var k = normalizar(v);
      if (!cont[k]) { cont[k] = 0; nomes[k] = v; chaves.push(k); }
      cont[k]++;
    });
    chaves.sort(function (a, b) { return cont[b] - cont[a] || comparaTexto(a, b); });
    return chaves.map(function (k) { return { rotulo: nomes[k], qtd: cont[k] }; });
  }

  // ---------------------------------------------------------------------------
  // Montagem
  // ---------------------------------------------------------------------------

  function ehFinalista(c, cfg) {
    if (c.finalista === true) return true;
    if (c.finalista === false) return false;
    if (cfg.statusFinalistas.length) return cfg.statusFinalistas.indexOf(normalizar(c.status)) >= 0;
    for (var i = 0; i < cfg.etapas.length; i++) if (notaDe(c, cfg.etapas[i].id) !== null) return true;
    return !!c.disc;
  }

  function copiarProcesso(p) {
    p = p || {};
    var out = {};
    ['id', 'nome', 'codigo', 'empresa', 'vaga', 'cidade', 'consultor', 'contratante'].forEach(function (k) {
      out[k] = texto(p[k]);
    });
    out.periodo = { inicio: texto(p.periodo && p.periodo.inicio), fim: texto(p.periodo && p.periodo.fim) };
    return out;
  }

  function lerDisc(d) {
    if (!d || typeof d !== 'object') return null;
    var p = d.percentuais || {};
    var out = { codigo: codigoLimpo(d.codigo).slice(0, 2), nivel: nivelConfiabilidade(d.confiabilidade), motivos: [] };
    LETRAS.forEach(function (l) { var n = Number(p[l]); out[l] = ehNumero(n) ? r1(n) : null; });
    var mot = d.confiabilidade && d.confiabilidade.motivos;
    if (mot && mot.length) out.motivos = mot.slice(0, 5).map(function (m) { return texto(m).slice(0, 200); });
    if (!out.codigo) {
      // sem código: deduz pelas duas maiores letras
      var ord = LETRAS.filter(function (l) { return out[l] !== null; }).sort(function (a, b) { return out[b] - out[a]; });
      if (ord.length) out.codigo = ord[0] + (ord[1] && out[ord[1]] > 0 ? ord[1] : '');
    }
    return out.codigo ? out : null;
  }

  function montar(dados, opcoes) {
    dados = dados || {};
    opcoes = opcoes || {};
    var cfg = lerConfig(dados.config);
    var processo = copiarProcesso(dados.processo);
    var todos = (dados.candidatos || []).filter(function (c) { return c && typeof c === 'object'; });
    var curto = nomesCurtos(todos);
    var finais = todos.filter(function (c) { return ehFinalista(c, cfg); });

    var textos = {};
    function T(id, s) { textos[id] = { texto: s, origem: 'regra' }; return id; }

    // Etapas aplicadas e pesos
    var aplicadas = etapasAplicadas(finais.length ? finais : todos, cfg);
    var pesos = pesosNormalizados(cfg, aplicadas);
    var aplicada = {};
    aplicadas.forEach(function (id) { aplicada[id] = true; });
    var etapasAp = cfg.etapas.filter(function (e) { return aplicada[e.id]; });
    var etapasPend = cfg.etapas.filter(function (e) { return !aplicada[e.id]; });
    var pesoTotal = 0, pesoPend = 0;
    cfg.etapas.forEach(function (e) { pesoTotal += e.peso; if (!aplicada[e.id]) pesoPend += e.peso; });
    var pctPendente = pesoTotal > 0 ? pesoPend / pesoTotal * 100 : (etapasPend.length && cfg.etapas.length ? etapasPend.length / cfg.etapas.length * 100 : 0);
    var pctConcluido = cfg.etapas.length ? 100 - pctPendente : 0;

    // Linhas (finalistas)
    var linhas = finais.map(function (c) {
      var s = calcularScore(c, dados.config, aplicadas);
      var d = lerDisc(c.disc);
      var notas = {};
      cfg.etapas.forEach(function (e) { notas[e.id] = aplicada[e.id] ? notaDe(c, e.id) : null; });
      return {
        id: c.id, nome: curto[c.id], notas: notas, score: s, disc: d,
        aderencia: d ? aderenciaDisc(d.codigo, cfg.perfilIdeal, d.nivel) : 'indefinida'
      };
    });
    linhas.sort(function (a, b) {
      if (b.score.total !== a.score.total) return b.score.total - a.score.total;
      if (b.score.tecnico !== a.score.tecnico) return b.score.tecnico - a.score.tecnico;
      return comparaTexto(a.nome, b.nome);
    });
    linhas.forEach(function (l, i) { l.posicao = i + 1; });

    var aprovados = linhas.filter(function (l) { return l.score.situacao === 'aprovado'; });
    var avaliar = linhas.filter(function (l) { return l.score.situacao === 'avaliar'; });
    var naoRec = linhas.filter(function (l) { return l.score.situacao === 'nao_recomendado'; });
    var nomesDe = function (lista) { return lista.map(function (l) { return l.nome; }); };

    // Estatísticas por etapa
    var estat = {};
    etapasAp.forEach(function (e) {
      var vals = linhas.map(function (l) { return l.notas[e.id]; }).filter(function (n) { return n !== null; });
      var soma = 0, max = null, min = null;
      vals.forEach(function (n) { soma += n; max = max === null || n > max ? n : max; min = min === null || n < min ? n : min; });
      var m = vals.length ? soma / vals.length : null;
      var dp = 0;
      vals.forEach(function (n) { dp += (n - m) * (n - m); });
      estat[e.id] = { media: m, max: max, min: min, qtd: vals.length, desvio: vals.length ? Math.sqrt(dp / vals.length) : 0, iguais: vals.length > 1 && max === min };
    });

    function fortesEFracos(l) {
      var forte = null, fraco = null;
      etapasAp.forEach(function (e) {
        var st = estat[e.id], n = l.notas[e.id];
        if (n === null || st.iguais || st.qtd < 2) return;
        var dif = n - st.media;
        if (!forte || dif > forte.dif || (dif === forte.dif && pesos[e.id] > pesos[forte.e.id])) forte = { e: e, n: n, dif: dif };
        if (!fraco || dif < fraco.dif || (dif === fraco.dif && pesos[e.id] > pesos[fraco.e.id])) fraco = { e: e, n: n, dif: dif };
      });
      if (forte && forte.dif <= 0) forte = null;
      if (fraco && (fraco.dif >= -0.5 && fraco.n >= 5)) fraco = null;
      if (forte && fraco && forte.e.id === fraco.e.id) fraco = null;
      return { forte: forte, fraco: fraco };
    }
    function etapaMaisBaixa(l) {
      var pior = null;
      etapasAp.forEach(function (e) {
        var n = l.notas[e.id];
        if (n !== null && n < NOTA_MUITO_BAIXA && (!pior || n < pior.n)) pior = { e: e, n: n };
      });
      return pior;
    }
    function notasBaixas(l) {
      return etapasAp.filter(function (e) { var n = l.notas[e.id]; return n !== null && n < NOTA_MUITO_BAIXA; })
        .map(function (e) { return { e: e, n: l.notas[e.id] }; });
    }

    var lider = linhas[0] || null, segundo = linhas[1] || null;
    var nomesPend = etapasPend.map(function (e) { return e.nome; });
    var pendTexto = nomesPend.length ? juntar(nomesPend.map(minuscula)) : '';
    var ideal = cfg.perfilIdeal;

    // -------------------------------------------------------------------------
    // Capa
    // -------------------------------------------------------------------------
    var cargo = processo.vaga || processo.nome;
    var sub = [processo.empresa, processo.cidade, periodoTexto(processo.periodo)].filter(function (s) { return s; });
    var capa = {
      titulo: cargo ? 'Processo seletivo · ' + cargo : 'Processo seletivo',
      subtitulo: sub.join(' · '),
      numeros: [
        { rotulo: 'Candidatos inscritos', valor: todos.length, nota: 'Total na lista do processo' },
        { rotulo: 'Finalistas avaliados', valor: linhas.length, nota: etapasAp.length ? 'Com ' + extenso(etapasAp.length) + (etapasAp.length === 1 ? ' etapa aplicada' : ' etapas aplicadas') : 'Nenhuma etapa aplicada ainda' },
        { rotulo: 'Acima do corte', valor: aprovados.length, nota: 'Score total de ' + fmt(cfg.corte) + ' pontos ou mais' },
        { rotulo: 'Do processo concluído', valor: r1(pctConcluido), sufixo: '%', nota: !cfg.etapas.length ? 'Nenhuma etapa configurada' : (etapasPend.length ? 'Falta ' + pendTexto : 'Todas as etapas aplicadas') }
      ]
    };

    // -------------------------------------------------------------------------
    // Sumário: recomendação
    // -------------------------------------------------------------------------
    var recomendacao = null;
    if (lider) {
      var rt = [];
      var margem = segundo ? r1(lider.score.total - segundo.score.total) : null;
      if (lider.score.situacao === 'aprovado') {
        if (!segundo) rt.push(lider.nome + ' é a única candidatura finalista e soma ' + fmt1(lider.score.total) + ' pontos.');
        else if (margem >= 5) rt.push(lider.nome + ' lidera com folga: ' + fmt1(lider.score.total) + ' pontos, ' + fmt(margem) + ' à frente de ' + segundo.nome + ' (' + fmt1(segundo.score.total) + ').');
        else if (margem >= 2) rt.push(lider.nome + ' lidera com vantagem clara: ' + fmt1(lider.score.total) + ' pontos, ' + fmt(margem) + ' à frente de ' + segundo.nome + '.');
        else rt.push(lider.nome + ' lidera por pouco: ' + fmt1(lider.score.total) + ' contra ' + fmt1(segundo.score.total) + ' de ' + segundo.nome + '. A diferença ainda pode virar.');
        var folga = r1(lider.score.total - cfg.corte);
        rt.push(folga >= 10 ? 'Passa do corte de ' + fmt(cfg.corte) + ' pontos com sobra (' + fmtPts(folga) + ' acima).' : 'Está ' + fmtPts(folga) + ' acima do corte de ' + fmt(cfg.corte) + '.');
      } else {
        rt.push('Nenhuma candidatura finalista atingiu o corte de ' + fmt(cfg.corte) + ' pontos. ' + lider.nome + ' é quem chega mais perto, com ' + fmt1(lider.score.total) + '.');
      }
      if (lider.score.bonus > 0 && linhas.length > 1) {
        var porTec = linhas.slice().sort(function (a, b) { return b.score.tecnico - a.score.tecnico || comparaTexto(a.nome, b.nome); })[0];
        if (porTec.id !== lider.id) rt.push('O bônus (+' + fmt(lider.score.bonus) + ') decide a liderança: só na parte técnica, ' + porTec.nome + ' estaria à frente (' + fmt1(porTec.score.tecnico) + ' contra ' + fmt1(lider.score.tecnico) + ').');
        else if (lider.score.bonusDetalhe.length) rt.push('Lidera também na parte técnica; o bônus (' + juntar(lider.score.bonusDetalhe.map(function (b) { return minuscula(b.nome); })) + ') só amplia a vantagem.');
      }
      if (lider.disc && ideal) {
        if (lider.aderencia === 'ideal') rt.push('O DISC (' + lider.disc.codigo + ') é exatamente o perfil pedido para a vaga.');
        else if (lider.aderencia === 'boa') rt.push('O DISC (' + lider.disc.codigo + ') tem o traço principal do perfil pedido (' + ideal + ').');
        else if (lider.aderencia === 'baixa') rt.push('Ponto de atenção: o DISC (' + lider.disc.codigo + ') se afasta do perfil ' + ideal + '. Vale testar isso na entrevista.');
        else if (lider.aderencia === 'indefinida') rt.push('O DISC desta candidatura não é confiável e não entrou na leitura.');
      } else if (!lider.disc && ideal) rt.push('Ainda falta o DISC para completar a leitura.');
      if (etapasPend.length) rt.push('Recomendação preliminar: ' + pendTexto + ' (' + fmt(pctPendente) + '% do peso) ainda não ' + (etapasPend.length > 1 ? 'foram aplicadas.' : 'foi aplicada.'));
      T('recomendacao', rt.join(' '));
      recomendacao = { nome: lider.nome, score: lider.score.total, situacao: lider.score.situacao, textoId: 'recomendacao' };
    }

    // -------------------------------------------------------------------------
    // Sumário: leituras
    // -------------------------------------------------------------------------
    var leituras = [];
    function leitura(titulo, corpo) {
      if (leituras.length >= 4) return;
      var id = T('leitura' + (leituras.length + 1), corpo);
      leituras.push({ titulo: titulo, textoId: id });
    }
    var topo = Math.max(aprovados.length, Math.min(3, linhas.length));
    var idealLin = linhas.filter(function (l) { return l.aderencia === 'ideal'; });
    if (ideal && idealLin.length && linhas.length > 1) {
      var noTopo = idealLin.filter(function (l) { return l.posicao <= topo; });
      if (noTopo.length === idealLin.length) {
        leitura('O DISC confirma a técnica',
          juntar(nomesDe(idealLin)) + (idealLin.length > 1 ? ' têm' : ' tem') + ' o perfil ' + ideal + ', o pedido para a vaga, e ' +
          (idealLin.length > 1 ? 'estão' : 'está') + ' entre os ' + extenso(topo) + ' primeiros do ranking (' +
          juntar(idealLin.map(function (l) { return l.posicao + 'º'; })) + '). Testes técnicos e perfil comportamental apontam na mesma direção.');
      } else if (!noTopo.length) {
        leitura('O perfil ideal ficou fora do topo',
          juntar(nomesDe(idealLin)) + (idealLin.length > 1 ? ' têm' : ' tem') + ' o perfil ' + ideal + ', mas ' + (idealLin.length > 1 ? 'aparecem' : 'aparece') + ' só em ' +
          idealLin.map(function (l) { return l.posicao + 'º'; }).join(', ') + ' no ranking. O comportamento ajuda, mas não compensou a técnica. A entrevista pode mostrar se vale apostar no perfil.');
      } else {
        leitura('O DISC confirma parte do ranking',
          juntar(nomesDe(noTopo)) + ' une perfil ' + ideal + ' e boa posição técnica. ' + juntar(nomesDe(idealLin.filter(function (l) { return l.posicao > topo; }))) +
          ' também tem o perfil, mas ficou mais abaixo: a técnica pesou contra.');
      }
    } else if (ideal && linhas.length > 1 && linhas.some(function (l) { return l.disc; })) {
      leitura('Ninguém no perfil exato',
        'Nenhuma candidatura finalista tem o perfil ' + ideal + '. A decisão deve se apoiar mais nos testes técnicos, e a entrevista precisa checar ' + TRACO[ideal.charAt(0)] + ', o traço que a vaga mais pede.');
    }
    // contraindicação por vários instrumentos
    naoRec.forEach(function (l) {
      if (l.aderencia !== 'baixa') return;
      var baixas = notasBaixas(l);
      if (!baixas.length) return;
      var n = 1 + baixas.length;
      var partes = ['o DISC ' + l.disc.codigo + ' (longe do perfil ' + ideal + ')'].concat(baixas.map(function (b) { return 'a nota ' + fmt(b.n) + ' em ' + minuscula(b.e.nome); }));
      var extra = l.score.bonus > 0 ? ' Nem o bônus (+' + fmt(l.score.bonus) + ') leva o score à faixa de avaliação.' : '';
      leitura(l.nome + ' tem contraindicação em ' + extenso(n) + ' instrumentos',
        maiuscula(juntar(partes)) + ' apontam na mesma direção. O score final (' + fmt1(l.score.total) + ') fica abaixo de ' + fmt(cfg.faixaAvaliar) + ' pontos.' + extra);
    });
    // confiabilidade baixa
    linhas.forEach(function (l) {
      if (!l.disc || l.disc.nivel !== 'baixa') return;
      var mot = l.disc.motivos.length ? ' (' + minuscula(semPontoFinal(l.disc.motivos[0])) + ')' : '';
      leitura('O DISC de ' + l.nome + ' não é confiável',
        'As respostas mostram sinais de pouca consistência' + mot + '. O resultado não deve pesar na decisão. ' +
        (l.score.situacao === 'aprovado' ? 'A técnica sustenta a posição, mas o comportamento precisa ser lido na entrevista.' : 'A impressão da entrevista vale mais que o perfil declarado.'));
    });
    // disputa na linha de corte
    var naLinha = avaliar.filter(function (l) { return cfg.corte - l.score.total <= 3; });
    if (naLinha.length && etapasPend.length) {
      var nl = naLinha[0];
      leitura(nl.nome + ' está a ' + fmtPts(r1(cfg.corte - nl.score.total)) + ' do corte',
        'Com ' + pendTexto + ' ainda por aplicar (' + fmt(pctPendente) + '% do peso), essa posição pode mudar. ' +
        (aprovados.length ? 'A última candidatura acima do corte, ' + aprovados[aprovados.length - 1].nome + ', tem ' + fmt1(aprovados[aprovados.length - 1].score.total) + '.' : ''));
    }
    // especialista na etapa de maior peso
    var maisPesada = etapasAp.slice().sort(function (a, b) { return b.peso - a.peso; })[0];
    if (maisPesada && !estat[maisPesada.id].iguais && lider) {
      var melhores = linhas.filter(function (l) { return l.notas[maisPesada.id] === estat[maisPesada.id].max; });
      if (melhores.length === 1 && melhores[0].id !== lider.id) {
        var esp = melhores[0], ff = fortesEFracos(esp);
        leitura(esp.nome + ' tem o melhor resultado em ' + minuscula(maisPesada.nome),
          'Nota ' + fmt(esp.notas[maisPesada.id]) + ' na etapa de maior peso (' + fmt(pesos[maisPesada.id]) + '% da parte técnica). Fica em ' + esp.posicao + 'º no geral' +
          (ff.fraco ? ' porque ' + minuscula(ff.fraco.e.nome) + ' (' + fmt(ff.fraco.n) + ') puxou o score para baixo.' : '.'));
      }
    }
    if (leituras.length < 2 && linhas.length) {
      leitura('O retrato do grupo',
        'Dos ' + linhas.length + ' finalistas, ' + aprovados.length + ' passaram do corte, ' + avaliar.length + ' ficam na faixa de avaliação (' + fmt(cfg.faixaAvaliar) + ' a ' + fmt1(cfg.corte - 0.1) + ') e ' + naoRec.length + ' abaixo dela.' +
        (lider ? ' A maior pontuação é ' + fmt1(lider.score.total) + ' e a menor, ' + fmt1(linhas[linhas.length - 1].score.total) + '.' : ''));
    }
    if (leituras.length < 2 && etapasPend.length) {
      leitura('Ainda há peso em aberto', maiuscula(pendTexto) + ' vale ' + fmt(pctPendente) + '% do peso e ainda não foi aplicada. Os números atuais mostram a tendência, não a decisão.');
    }
    if (leituras.length < 2 && !linhas.length) {
      leitura('Sem finalistas ainda', 'Nenhuma candidatura chegou à etapa final. O relatório mostra a atração; a avaliação aparece quando as notas forem lançadas no ClickUp.');
    }

    // -------------------------------------------------------------------------
    // Atração
    // -------------------------------------------------------------------------
    var fn = funil(todos, dados.status);
    var pret = media(todos.map(function (c) { return c.pretensao; }));
    var sal = media(todos.map(function (c) { return c.ultimoSalario; }));
    var trabalho = contarRotulos(todos, 'statusTrabalho');
    var at = [];
    if (fn.total) {
      at.push(fn.total + (fn.total === 1 ? ' pessoa se inscreveu' : ' pessoas se inscreveram') + ' e ' + linhas.length + ' chegaram à etapa final (' + fmt(r1(linhas.length / fn.total * 100)) + '%).');
      var foraPerfil = fn.porStatus.filter(function (s) { return normalizar(s.status).indexOf('fora') === 0; })[0];
      if (foraPerfil && foraPerfil.pct >= 40) at.push(fmt(foraPerfil.pct) + '% ficaram fora do perfil: em captação aberta, um descarte alto é esperado. O que importa é a qualidade de quem sobra.');
      else if (fn.porStatus.length) at.push('O status mais comum é "' + fn.porStatus[0].status + '", com ' + fmt(fn.porStatus[0].pct) + '% da lista.');
      var semResp = fn.porStatus.filter(function (s) { return /sem resposta|nao respond/.test(normalizar(s.status)); })[0];
      if (semResp && semResp.qtd) at.push(semResp.qtd + ' não responderam ao contato, um ponto a melhorar na próxima campanha.');
    } else {
      at.push('Ainda não há inscrições na lista do processo.');
    }
    if (pret && sal) {
      var dif = (pret - sal) / sal * 100;
      if (Math.abs(dif) < 5) at.push('Pretensão média (' + fmtMoeda(pret) + ') e último salário médio (' + fmtMoeda(sal) + ') são praticamente iguais: a expectativa está ancorada na trajetória, o que facilita a proposta.');
      else if (dif > 0) at.push('A pretensão média (' + fmtMoeda(pret) + ') fica ' + fmt(r1(dif)) + '% acima do último salário médio (' + fmtMoeda(sal) + '): parte do grupo busca crescimento, o que pede atenção na negociação.');
      else at.push('A pretensão média (' + fmtMoeda(pret) + ') fica abaixo do último salário médio (' + fmtMoeda(sal) + '): o grupo tende a aceitar a faixa oferecida.');
    } else if (pret) at.push('A pretensão média é de ' + fmtMoeda(pret) + '.');
    if (trabalho.length && fn.total) {
      var top = trabalho[0];
      var comInfo = 0;
      trabalho.forEach(function (t) { comInfo += t.qtd; });
      at.push('Situação de trabalho mais comum: ' + minuscula(top.rotulo) + ', com ' + fmt(r1(top.qtd / comInfo * 100)) + '% de quem informou.');
    }
    T('atracao', at.join(' '));
    var atracao = {
      total: fn.total, porStatus: fn.porStatus,
      pretensaoMedia: r1(pret), ultimoSalarioMedio: r1(sal),
      idadeFaixas: faixasEtarias(todos), statusTrabalho: trabalho, textoId: 'atracao'
    };

    // -------------------------------------------------------------------------
    // Etapas
    // -------------------------------------------------------------------------
    var maisSeparou = null;
    etapasAp.forEach(function (e) {
      if (estat[e.id].qtd > 1 && (!maisSeparou || estat[e.id].desvio > estat[maisSeparou.id].desvio)) maisSeparou = e;
    });
    var etapas = cfg.etapas.map(function (e) {
      var pend = !aplicada[e.id];
      var out = {
        id: e.id, nome: e.nome, peso: e.peso, pesoNormalizado: pend ? null : r1(pesos[e.id]), descricao: e.descricao,
        pendente: pend, resultados: [], destaques: []
      };
      var k = 0;
      function destaque(tipo, titulo, corpo) {
        k++;
        out.destaques.push({ tipo: tipo, titulo: titulo, textoId: T('etapa-' + e.id + '-' + k, corpo) });
      }
      if (pend) {
        destaque('info', 'Etapa ainda não aplicada',
          'Vale ' + fmt(pesoTotal ? e.peso / pesoTotal * 100 : 0) + '% do peso total. Os scores atuais foram calculados sem ela; quando as notas entrarem no ClickUp, o ranking é refeito.');
        return out;
      }
      out.resultados = linhas.map(function (l) { return { nome: l.nome, nota: l.notas[e.id] }; })
        .sort(function (a, b) {
          if (a.nota === null || b.nota === null) return a.nota === null ? (b.nota === null ? comparaTexto(a.nome, b.nome) : 1) : -1;
          return b.nota - a.nota || comparaTexto(a.nome, b.nome);
        });
      var st = estat[e.id];
      if (st.iguais) {
        destaque('info', 'A etapa não diferenciou o grupo',
          'Todas as ' + st.qtd + ' candidaturas tiraram ' + fmt(st.max) + '. O peso da etapa entrou igual para todos e não mudou a ordem do ranking.');
      } else if (st.qtd) {
        var top = linhas.filter(function (l) { return l.notas[e.id] === st.max; });
        var seg = out.resultados.filter(function (r) { return r.nota !== null && r.nota < st.max; })[0];
        destaque('destaque', juntar(nomesDe(top)) + ': melhor nota (' + fmt(st.max) + ')',
          (top.length > 1 ? 'Dividem o topo da etapa' : 'Fica no topo da etapa') + (seg ? '; a nota seguinte é ' + fmt(seg.nota) : '') +
          '. Média do grupo: ' + fmt(r1(st.media)) + '. Esta etapa vale ' + fmt(pesos[e.id]) + '% da parte técnica.');
        var baixas = linhas.filter(function (l) { return l.notas[e.id] !== null && l.notas[e.id] < NOTA_MUITO_BAIXA; });
        if (baixas.length) {
          var custo = r1((st.media - (baixas[0].notas[e.id])) / 10 * pesos[e.id]);
          destaque('alerta', 'Notas muito baixas: ' + juntar(nomesDe(baixas)),
            juntar(baixas.map(function (l) { return l.nome + ' (' + fmt(l.notas[e.id]) + ')'; })) + (baixas.length > 1 ? ' ficaram' : ' ficou') + ' abaixo de ' + NOTA_MUITO_BAIXA + '. ' +
            (custo > 0 ? 'Em relação à média do grupo, ' + (baixas.length > 1 ? 'a nota mais baixa custa' : 'isso custa') + ' cerca de ' + fmtPts(custo) + ' no score.' : 'Isso pesa no score final.'));
        }
        if (maisSeparou && maisSeparou.id === e.id && etapasAp.length > 1 && st.max - st.min >= 3) {
          destaque('info', 'A etapa que mais separou o grupo',
            'Do ' + fmt(st.max) + ' ao ' + fmt(st.min) + ': foi aqui que as candidaturas mais se distanciaram. Boa parte da ordem do ranking nasce nesta etapa.');
        }
      }
      var faltas = linhas.filter(function (l) { return l.notas[e.id] === null; });
      if (faltas.length) {
        destaque('alerta', 'Sem nota: ' + juntar(nomesDe(faltas)),
          'Sem nota lançada, a etapa contou como zero no score. Se a avaliação foi feita, lance a nota no ClickUp e gere o relatório de novo.');
      }
      return out;
    });

    // -------------------------------------------------------------------------
    // DISC
    // -------------------------------------------------------------------------
    var explic = [];
    if (cfg.explicacaoPerfil) explic.push(semPontoFinal(cfg.explicacaoPerfil) + '.');
    else if (ideal) explic.push('O perfil pedido para a vaga é ' + descreverIdeal(ideal) + ': ' + TRACO[ideal.charAt(0)] + (ideal.charAt(1) ? ', com apoio de ' + TRACO[ideal.charAt(1)] : '') + '.');
    explic.push('O DISC não dá nota: serve para calibrar a leitura dos testes e orientar a gestão nos primeiros meses.');
    T('disc-explicacao', explic.join(' '));

    var quadro = linhas.slice().sort(function (a, b) {
      return ORDEM_ADERENCIA[a.aderencia] - ORDEM_ADERENCIA[b.aderencia] || a.posicao - b.posicao;
    }).map(function (l) {
      var d = l.disc || {};
      return {
        nome: l.nome, D: l.disc ? d.D : null, I: l.disc ? d.I : null, S: l.disc ? d.S : null, C: l.disc ? d.C : null,
        codigo: l.disc ? d.codigo : null, aderencia: l.aderencia, confiabilidade: l.disc ? d.nivel : 'indisponivel'
      };
    });

    var achados = [];
    var na = 0;
    function achado(tipo, titulo, corpo) { na++; achados.push({ tipo: tipo, titulo: titulo, textoId: T('disc-achado' + na, corpo) }); }
    if (idealLin.length) {
      achado('destaque', juntar(nomesDe(idealLin)) + ': perfil ' + ideal + ', o pedido',
        (idealLin.length > 1 ? 'Têm' : 'Tem') + ' exatamente o perfil que a vaga pede: ' + TRACO[ideal.charAt(0)] + (ideal.charAt(1) ? ' com ' + TRACO[ideal.charAt(1)] : '') + '. ' +
        'No ranking: ' + idealLin.map(function (l) { return l.nome + ' em ' + l.posicao + 'º'; }).join(', ') + '.');
    }
    var boas = linhas.filter(function (l) { return l.aderencia === 'boa'; });
    if (boas.length) {
      achado('info', juntar(nomesDe(boas)) + ': traço principal certo',
        'Perfis ' + juntar(boas.map(function (l) { return l.disc.codigo; }).filter(function (c, i, a) { return a.indexOf(c) === i; })) + ': o traço principal (' + ideal.charAt(0) + ') é o da vaga, com outro segundo traço. ' +
        'Bom encaixe; o ajuste fica no ritmo, a ser acompanhado na integração.');
    }
    linhas.filter(function (l) { return l.disc && l.disc.nivel === 'baixa'; }).forEach(function (l) {
      achado('alerta', l.nome + ': resultado não confiável',
        'O teste indicou ' + l.disc.codigo + ', mas as respostas têm sinais de inconsistência' + (l.disc.motivos.length ? ' (' + minuscula(semPontoFinal(l.disc.motivos[0])) + ')' : '') + '. ' +
        'Não considere este perfil na decisão; a entrevista é a fonte mais segura.');
    });
    linhas.filter(function (l) { return l.aderencia === 'baixa'; }).forEach(function (l) {
      var forte = LETRAS.slice().sort(function (a, b) { return (l.disc[b] || 0) - (l.disc[a] || 0); });
      var letraIdeal = ideal.charAt(0);
      var baixas = notasBaixas(l);
      achado('alerta', l.nome + ': perfil ' + l.disc.codigo + ', distante do pedido',
        'Os traços mais fortes são ' + NOME_LETRA[forte[0]] + ' (' + forte[0] + ') e ' + NOME_LETRA[forte[1]] + ' (' + forte[1] + '), ligados a ' + TRACO[forte[0]] + '. ' +
        NOME_LETRA[letraIdeal] + ' (' + letraIdeal + '), o traço principal da vaga, aparece com só ' + fmt(l.disc[letraIdeal]) + '%. ' +
        (baixas.length ? 'As notas técnicas confirmam o desencaixe para a função.' : 'A técnica compensa em parte, mas o perfil pede acompanhamento próximo.'));
    });
    var medias = linhas.filter(function (l) { return l.aderencia === 'media'; });
    if (medias.length) {
      achado('info', juntar(nomesDe(medias)) + ': encaixe parcial',
        'O traço pedido aparece, mas não como o principal (' + juntar(medias.map(function (l) { return l.nome + ': ' + l.disc.codigo; })) + '). Vale observar na entrevista como ' + (medias.length > 1 ? 'reagem' : 'reage') + ' a tarefas de ' + TRACO[ideal.charAt(0)] + '.');
    }
    var semDisc = linhas.filter(function (l) { return !l.disc; });
    if (semDisc.length) {
      achado('info', 'Sem DISC: ' + juntar(nomesDe(semDisc)),
        (semDisc.length > 1 ? 'Ainda não responderam' : 'Ainda não respondeu') + ' ao teste. Envie o link do processo antes da decisão final.');
    }
    var disc = { perfilIdeal: ideal, explicacaoTextoId: 'disc-explicacao', quadro: quadro, achados: achados };

    // -------------------------------------------------------------------------
    // Ranking
    // -------------------------------------------------------------------------
    var formula = cfg.etapas.map(function (e) {
      return { etapa: e.nome, peso: e.peso, pesoNormalizado: aplicada[e.id] ? r1(pesos[e.id]) : null, pendente: !aplicada[e.id] };
    });
    var linhasRanking = linhas.map(function (l, i) {
      var id = 'analise-' + l.posicao;
      T(id, analisar(l, i));
      return {
        posicao: l.posicao, nome: l.nome, notas: l.notas, tecnico: l.score.tecnico, bonus: l.score.bonus, total: l.score.total,
        situacao: l.score.situacao, disc: l.disc ? l.disc.codigo : null, aderencia: l.aderencia, incompleto: l.score.incompleto,
        analiseTextoId: id
      };
    });

    function analisar(l, i) {
      var s = [];
      var ant = linhas[i - 1], prox = linhas[i + 1];
      var sc = l.score;
      var ff = fortesEFracos(l);
      if (i === 0 && prox) s.push(sc.situacao === 'aprovado' ? 'Lidera com ' + fmtPts(r1(sc.total - prox.score.total)) + ' de vantagem.' : 'Melhor posição, mas ainda abaixo do corte.');
      else if (i === 0) s.push('Única candidatura finalista.');
      else if (sc.situacao === 'aprovado') {
        var folga = r1(sc.total - cfg.corte);
        s.push(folga < 2 ? 'Na linha do corte, com só ' + fmtPts(folga) + ' de folga.' : 'Acima do corte com ' + fmtPts(folga) + ' de folga.');
      } else if (sc.situacao === 'avaliar') {
        var falta = r1(cfg.corte - sc.total);
        s.push(falta <= 3 ? 'A ' + fmtPts(falta) + ' do corte' + (etapasPend.length ? ': as etapas em aberto podem mudar a posição.' : '.') : 'Na faixa de avaliação, ' + fmtPts(falta) + ' abaixo do corte.');
      } else {
        var pior = etapaMaisBaixa(l);
        s.push('Abaixo da faixa de avaliação' + (pior ? '; a nota em ' + minuscula(pior.e.nome) + ' (' + fmt(pior.n) + ') é o que mais pesa.' : '.'));
      }
      if (ant && i > 0 && r1(ant.score.total - sc.total) < 1 && sc.situacao !== 'nao_recomendado') {
        s.push('Empate técnico com ' + ant.nome + ' (' + fmt1(ant.score.total) + ').');
      }
      var det = [];
      if (ff.forte) det.push('ponto forte em ' + minuscula(ff.forte.e.nome) + ' (' + fmt(ff.forte.n) + (estat[ff.forte.e.id].max === ff.forte.n ? ', melhor do grupo' : '') + ')');
      var piorAqui = sc.situacao === 'nao_recomendado' ? etapaMaisBaixa(l) : null;
      if (ff.fraco && !(piorAqui && piorAqui.e.id === ff.fraco.e.id)) det.push('ponto fraco em ' + minuscula(ff.fraco.e.nome) + ' (' + fmt(ff.fraco.n) + ')');
      if (sc.bonusDetalhe.length) det.push('bônus de ' + fmt(sc.bonus) + ' por ' + juntar(sc.bonusDetalhe.map(function (b) { return minuscula(b.nome); })));
      if (det.length) s.push(maiuscula(juntar(det)) + '.');
      if (l.disc) {
        var ad = {
          ideal: 'DISC ' + l.disc.codigo + ', o perfil pedido.',
          boa: 'DISC ' + l.disc.codigo + ', com o traço principal da vaga.',
          media: 'DISC ' + l.disc.codigo + ', encaixe parcial com o perfil.',
          baixa: 'DISC ' + l.disc.codigo + ', distante do perfil pedido.',
          indefinida: 'DISC sem confiabilidade: decidir pela entrevista.'
        }[l.aderencia];
        if (ad) s.push(ad);
      } else s.push('Sem DISC respondido.');
      if (sc.incompleto) s.push('Faltam notas em ' + juntar(sc.faltando.map(function (id) { return minuscula(nomeEtapa(id)); })) + ' (contaram como zero).');
      return s.join(' ');
    }
    function nomeEtapa(id) {
      for (var i = 0; i < cfg.etapas.length; i++) if (cfg.etapas[i].id === id) return cfg.etapas[i].nome;
      return id;
    }

    var ranking = { formula: formula, pesoPendente: r1(pctPendente), linhas: linhasRanking };

    // -------------------------------------------------------------------------
    // Encerramento
    // -------------------------------------------------------------------------
    var enc = [];
    if (!linhas.length) {
      enc.push('O processo ainda está na fase de atração. Quando as primeiras notas forem lançadas no ClickUp, este relatório passa a trazer a avaliação e o ranking.');
    } else if (etapasPend.length) {
      enc.push('Com ' + juntar(etapasAp.map(function (e) { return minuscula(e.nome); })) + ' concluídas, o processo tem ' + fmt(pctConcluido) + '% da avaliação pronta.');
      enc.push(aprovados.length
        ? 'O ranking já permite uma recomendação técnica: ' + juntar(nomesDe(aprovados)) + (aprovados.length > 1 ? ' estão' : ' está') + ' acima do corte.'
        : 'Ninguém passou do corte até aqui, então as etapas restantes são decisivas.');
      enc.push(maiuscula(pendTexto) + ' é o que falta antes da decisão final.');
    } else {
      enc.push('Todas as etapas foram aplicadas e o ranking é final.');
      enc.push(aprovados.length
        ? (aprovados.length > 1 ? juntar(nomesDe(aprovados)) + ' estão acima do corte; ' + lider.nome + ' é a recomendação principal.' : lider.nome + ' é a recomendação: única candidatura acima do corte.')
        : 'Nenhuma candidatura atingiu o corte. Vale avaliar com o contratante se reabre a captação ou se decide entre as melhores da faixa de avaliação.');
    }
    T('encerramento', enc.join(' '));

    var passos = [];
    function passo(t) { passos.push(T('passo' + (passos.length + 1), t)); }
    if (etapasPend.length && linhas.length) {
      var seguem = linhas.filter(function (l) { return l.score.situacao !== 'nao_recomendado'; });
      passo(comPonto('Aplicar ' + pendTexto + ' (' + fmt(pctPendente) + '% do peso)' + (seguem.length ? ' com ' + juntar(nomesDe(seguem)) : ' com os finalistas')));
    }
    for (var p = 0; p + 1 < linhas.length; p++) {
      var a = linhas[p], b = linhas[p + 1];
      var cruza = a.score.situacao !== b.score.situacao && a.score.situacao === 'aprovado';
      if (cruza && r1(a.score.total - b.score.total) <= 3) {
        passo('Observar de perto ' + a.nome + ' e ' + b.nome + ': ' + fmtPts(r1(a.score.total - b.score.total)) + ' de diferença, um de cada lado do corte.' + (etapasPend.length ? ' A próxima etapa decide a ordem.' : ''));
        break;
      }
    }
    linhas.filter(function (l) { return l.disc && l.disc.nivel === 'baixa'; }).forEach(function (l) {
      passo('Reaplicar o DISC de ' + l.nome + ' ou decidir esta candidatura só pela entrevista.');
    });
    if (semDisc.length) passo(comPonto('Enviar o teste DISC para ' + juntar(nomesDe(semDisc))));
    var incompletos = linhas.filter(function (l) { return l.score.incompleto; });
    if (incompletos.length) passo('Lançar no ClickUp as notas que faltam: ' + juntar(incompletos.map(function (l) { return l.nome + ' (' + juntar(l.score.faltando.map(function (id) { return minuscula(nomeEtapa(id)); })) + ')'; })) + '.');
    if (naoRec.length) passo('Decidir com o contratante se ' + juntar(nomesDe(naoRec)) + (etapasPend.length ? ' ainda participa' + (naoRec.length > 1 ? 'm' : '') + ' da etapa final ou se o processo encerra agora para ' + (naoRec.length > 1 ? 'essas candidaturas.' : 'essa candidatura.') : ' recebe' + (naoRec.length > 1 ? 'm' : '') + ' retorno agora.'));
    passo(linhas.length
      ? 'Apresentar este relatório' + (processo.contratante ? ' a ' + processo.contratante : ' ao contratante') + ' e definir quem segue' + (etapasPend.length ? ' para a etapa final.' : ' para a proposta.')
      : 'Acompanhar a captação e lançar as notas das primeiras etapas no ClickUp.');

    var encerramento = { textoId: 'encerramento', proximosPassos: passos };

    var agora = opcoes.agora !== undefined ? opcoes.agora : opcoes.geradoEm;
    var geradoEm = agora instanceof Date ? agora.toISOString() : (agora ? String(agora) : null);

    return {
      versao: VERSAO,
      geradoEm: geradoEm,
      processo: processo,
      config: { perfilIdeal: ideal, explicacaoPerfil: cfg.explicacaoPerfil, corte: cfg.corte, faixaAvaliar: cfg.faixaAvaliar },
      capa: capa,
      sumario: { recomendacao: recomendacao, leituras: leituras },
      atracao: atracao,
      etapas: etapas,
      disc: disc,
      ranking: ranking,
      encerramento: encerramento,
      textos: textos
    };
  }

  return {
    VERSAO: VERSAO,
    montar: montar,
    calcularScore: calcularScore,
    aderenciaDisc: aderenciaDisc,
    primeiroNome: primeiroNome,
    funil: funil,
    etapasAplicadas: etapasAplicadas,
    pontosBonus: pontosBonus,
    formatar: fmt1
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = DISC_RELATORIO;
self.DISC_RELATORIO = DISC_RELATORIO;
}).call(__motoresDisc, __motoresDisc, undefined, undefined);

const DISC_SCORING = __motoresDisc.DISC_SCORING;
const DISC_CONFIABILIDADE = __motoresDisc.DISC_CONFIABILIDADE;
const DISC_RELATORIO = __motoresDisc.DISC_RELATORIO;

// ======== supabase/funcoes-fonte/clickup-webhook/index.ts ========
// Edge Function "clickup-webhook" — recebe os eventos do ClickUp (taskStatusUpdated). Pública: no painel,
// desligue "Verify JWT"; a segurança é a assinatura X-Signature (segredo CLICKUP_WEBHOOK_SECRET).
// Tarefa "📌 Briefing…" em "gerar relatório" -> rascunho + comentário + status "relatório em revisão".
// Para colar no painel do Supabase use dist/funcoes/clickup-webhook/index.ts (gerado por npm run montar:funcoes).

// Responde logo e termina o trabalho em segundo plano (EdgeRuntime.waitUntil do Supabase).
const emSegundoPlano = typeof EdgeRuntime !== 'undefined' && EdgeRuntime && typeof EdgeRuntime.waitUntil === 'function'
  ? (p) => EdgeRuntime.waitUntil(p)
  : undefined;

Deno.serve((req) => atenderWebhookClickUp(req, criarBaseSupabase(createClient, (n) => Deno.env.get(n), {
  motor: DISC_RELATORIO,
  confiabilidade: DISC_CONFIABILIDADE,
  emSegundoPlano
})));
