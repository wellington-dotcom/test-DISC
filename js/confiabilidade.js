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
