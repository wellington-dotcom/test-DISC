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
 * avaliar(respostasCompactas, validacao) -> { nivel: 'alta'|'media'|'baixa'|'indisponivel', pontos: 0..100,
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
 *  - Perfil achatado: maior% - menor% < 8 = leve.
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

  function avaliar(respostasCompactas, validacao) {
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
    if (amplitude < 8) leves.push('Perfil pouco definido (notas muito parecidas entre si).');

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

export const DISC_SCORING = __motoresDisc.DISC_SCORING;
export const DISC_CONFIABILIDADE = __motoresDisc.DISC_CONFIABILIDADE;
export const DISC_RELATORIO = __motoresDisc.DISC_RELATORIO;
