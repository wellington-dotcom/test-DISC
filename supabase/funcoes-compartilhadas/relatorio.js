// Relatório do processo seletivo — porte de apps-script/Relatorio.gs (sem a divisão em partes: no
// Postgres o JSON inteiro vai numa coluna jsonb). O texto é montado pelo MESMO motor do site
// (js/relatorio-motor.js, embutido nas funções por scripts/montar-funcoes.mjs).
import { limparTexto, limparTextoLongo } from './regras.js';

export const REL_MAX_JSON = 400000;
export const REL_MAX_TEXTO = 4000;
export const REL_MAX_TEXTOS_IA = 80;
export const MSG_REL_NAO_ENCONTRADO = 'Relatório não encontrado ou fora do ar.';
export const REL_IA_URL = 'https://api.anthropic.com/v1/messages';
export const REL_IA_MODELO = 'claude-opus-5-5';

export function relTokenValido(t) { return typeof t === 'string' && /^[0-9a-f]{40,128}$/.test(t); }

/** Token aleatório de 64 caracteres hexadecimais (32 bytes do gerador criptográfico). */
export function relNovoToken() {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Primeiro nome + inicial do último sobrenome ("Maria da Silva" -> "Maria S."). */
export function relNomeCurto(nome) {
  const partes = limparTexto(nome, 120).split(' ').filter((p) => /\p{L}/u.test(p));
  if (partes.length < 2) return partes[0] || '';
  return partes[0] + ' ' + partes[partes.length - 1].charAt(0).toUpperCase() + '.';
}

// Fotos dos candidatos (data URL JPEG até 40 000 caracteres, a mesma regra do banco).
export const REL_FOTO_MAX = 40000;
export const REL_MAX_JSON_COM_FOTOS = 1500000;
const RE_FOTO = /^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/=]+$/;
export function relFotoValida(f) { return typeof f === 'string' && f.length <= REL_FOTO_MAX && RE_FOTO.test(f); }

const PARTICULAS = { de: 1, da: 1, das: 1, do: 1, dos: 1, e: 1, di: 1, du: 1, del: 1, van: 1, von: 1 };

/**
 * Mesmos nomes curtos que o motor usa nos candidatos (nomesCurtos de js/relatorio-motor.js, com o
 * primeiroNome dele): {idDoCandidato: "Ana P."}. Serve para pôr a foto certa em cada linha do relatório.
 */
export function relNomesCurtos(motor, candidatos) {
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
export function relAplicarFotos(relatorio, motor, candidatos) {
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
export function relMontar(motor, dados, geradoEm) {
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
export function relAplicarEdicao(relatorio, corpo) {
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
export function relBaseSite(baseUrl, siteUrl) {
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

export const REL_IA_SISTEMA = [
  'Você revisa textos de um relatório de processo seletivo escrito por uma consultoria de RH (Notus Agência)',
  'para a empresa contratante. Reescreva cada texto em português do Brasil simples, com tom de consultor,',
  'frases curtas e sem jargão técnico. Regras: mantenha exatamente os mesmos fatos, números, notas, nomes e',
  'conclusões; não invente nada; não acrescente recomendações novas; nunca mencione idade, sexo, estado civil,',
  'filhos, saúde, religião, etnia ou qualquer outro dado pessoal sensível. Devolva todos os ids recebidos.'
].join(' ');

/** Corpo da requisição à Messages API (igual ao Relatorio.gs). */
export function relCorpoIa(itens) {
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
export async function relChamarIa(fetchFn, chave, itens) {
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
export function relIdsParaIa(textos, ids) {
  const escolhidos = Array.isArray(ids) && ids.length
    ? ids.filter((id) => typeof id === 'string' && Object.prototype.hasOwnProperty.call(textos, id))
    : Object.keys(textos).filter((id) => textos[id] && textos[id].origem === 'regra');
  return escolhidos.slice(0, REL_MAX_TEXTOS_IA);
}
