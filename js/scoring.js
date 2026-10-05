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
