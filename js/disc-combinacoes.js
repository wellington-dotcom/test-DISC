/*
 * Nomes Notus para as combinações DISC (texto e nomes 100% nossos).
 *
 * Módulo PURO (UMD, global DISC_COMBINACOES):
 *   CODIGOS               -> os 16 códigos: 4 puros ('D','I','S','C') + 12 duplas primário+secundário ('DI', 'DS', ...)
 *   nome(codigo)          -> { codigo, nome, frase, descricao } (cópia) ou null se o código não existir
 *   codigo(percentuais, codigoDisc?) -> código da combinação ('DI' ou 'D' se o secundário for fraco) ou null
 *   combinacao(percentuais, codigoDisc?) -> { codigo, puro: bool, nome, frase, descricao } ou null
 *
 * Regra do perfil puro (secundário fraco): o segundo fator fica abaixo de 22% (faixa "baixa" ou "muito baixa"
 * da régua de intensidade) OU fica 12 pontos ou mais abaixo do principal. Exemplos: D 40 / I 21 -> 'D';
 * D 38 / I 26 -> 'D'; D 34 / I 28 -> 'DI'. Sem codigoDisc, a ordem segue os percentuais (empate: D, I, S, C),
 * a mesma regra de js/scoring.js; com codigoDisc ('DI'), o primário e o secundário vêm dele.
 */
(function (root) {
  'use strict';

  var LETRAS = ['D', 'I', 'S', 'C'];
  var LIMITE_SECUNDARIO = 22;   // abaixo disso o secundário é fraco
  var DISTANCIA_PURO = 12;      // ou: secundário 12+ pontos abaixo do principal

  var COMBINACOES = {
    D: {
      nome: 'Abre-caminhos',
      frase: 'Vai na frente, decide e coloca as coisas em movimento.',
      descricao: 'A Dominância aparece com folga sobre os outros fatores. Você tende a encarar obstáculos de frente, gosta de metas ambiciosas e se sente à vontade em situações que pedem coragem e decisão rápida. Seu desenvolvimento passa por dosar a velocidade com escuta.'
    },
    I: {
      nome: 'Anfitrião',
      frase: 'Aproxima pessoas e faz todo mundo se sentir parte.',
      descricao: 'A Influência se destaca com folga. Você tende a criar laços com facilidade, a falar com entusiasmo e a dar vida aos ambientes por onde passa. Seu desenvolvimento passa por transformar boas conversas em compromissos acompanhados até o fim.'
    },
    S: {
      nome: 'Pilar',
      frase: 'Sustenta o time com constância, paciência e presença.',
      descricao: 'A Estabilidade se destaca com folga. Você tende a ser a referência de calma e continuidade, cumpre o combinado e cuida para que ninguém fique para trás. Seu desenvolvimento passa por se posicionar mais e enxergar nas mudanças também uma chance de ganho.'
    },
    C: {
      nome: 'Lapidador',
      frase: 'Refina cada entrega até ela ficar do jeito certo.',
      descricao: 'A Conformidade se destaca com folga. Você tende a observar com cuidado, seguir critérios bem definidos e buscar precisão em tudo o que faz. Seu desenvolvimento passa por reconhecer quando o trabalho já está bom o bastante para seguir.'
    },
    DI: {
      nome: 'Mobilizador',
      frase: 'Coloca metas na mesa e convence as pessoas a correr atrás delas.',
      descricao: 'Dominância com Influência: você junta foco em resultado com facilidade para engajar. Costuma liderar pelo exemplo e pela energia, abrir frentes novas e atrair gente para elas. Atenção ao acompanhamento dos detalhes e ao tempo de quem tem outro ritmo.'
    },
    DS: {
      nome: 'Timoneiro',
      frase: 'Mantém o rumo com firmeza e persistência.',
      descricao: 'Dominância com Estabilidade: você busca resultado, mas com constância e sem pular etapas. Costuma ser determinado e confiável, conduzindo o trabalho até o fim mesmo quando ele é longo. Atenção às mudanças de rota propostas por outras pessoas, que podem merecer mais abertura.'
    },
    DC: {
      nome: 'Construtor',
      frase: 'Transforma objetivos ambiciosos em entregas sólidas.',
      descricao: 'Dominância com Conformidade: você une ambição a um padrão alto de qualidade. Costuma decidir com base em critérios, cobrar consistência e estruturar o caminho até o resultado. Atenção ao tom com quem não acompanha o mesmo nível de exigência.'
    },
    ID: {
      nome: 'Catalisador',
      frase: 'Acende a energia do grupo e acelera o que estava parado.',
      descricao: 'Influência com Dominância: sua força de comunicação vem acompanhada de iniciativa. Você tende a convencer, mobilizar e levar ideias para a prática com rapidez. Atenção a promessas feitas no calor do momento e às tarefas que pedem paciência.'
    },
    IS: {
      nome: 'Agregador',
      frase: 'Cria laços e mantém o grupo unido.',
      descricao: 'Influência com Estabilidade: você combina simpatia com disposição para apoiar. Costuma ser acessível, bom ouvinte e alguém que deixa o ambiente mais acolhedor. Atenção à dificuldade de dizer não e a conversas difíceis adiadas para preservar o clima.'
    },
    IC: {
      nome: 'Tradutor',
      frase: 'Explica o que é complexo de um jeito que todo mundo entende.',
      descricao: 'Influência com Conformidade: você junta facilidade de comunicação com cuidado na informação. Tende a apresentar ideias de forma clara e convincente, apoiando-se em fatos. Atenção ao tempo gasto preparando a apresentação perfeita.'
    },
    SD: {
      nome: 'Maratonista',
      frase: 'Avança com passo firme até a linha de chegada.',
      descricao: 'Estabilidade com Dominância: você mantém o ritmo e, quando é preciso, mostra firmeza para chegar ao resultado. Costuma ser persistente, prático e confiável em projetos longos. Atenção a guardar incômodos até que virem uma cobrança mais dura.'
    },
    SI: {
      nome: 'Cultivador',
      frase: 'Cuida das relações com paciência e faz a confiança crescer.',
      descricao: 'Estabilidade com Influência: você combina constância com calor humano. Tende a ser paciente, receptivo e atento ao bem-estar do time, construindo relações duradouras. Atenção a assumir demandas dos outros e deixar as suas para depois.'
    },
    SC: {
      nome: 'Guardião',
      frase: 'Preserva o que funciona e garante que nada se perca.',
      descricao: 'Estabilidade com Conformidade: você une constância a cuidado com regras e qualidade. Costuma ser metódico, fiel aos processos e muito confiável no dia a dia. Atenção a mudanças rápidas, que podem pedir de você mais flexibilidade.'
    },
    CD: {
      nome: 'Arquiteto',
      frase: 'Desenha o caminho com rigor e cuida para que ele seja seguido.',
      descricao: 'Conformidade com Dominância: você analisa a fundo e, quando chega a uma conclusão, age com firmeza. Tende a definir padrões, apontar riscos e buscar soluções bem fundamentadas. Atenção à rigidez com quem pensa diferente e ao tom das críticas.'
    },
    CI: {
      nome: 'Curador',
      frase: 'Seleciona com critério e apresenta com cuidado.',
      descricao: 'Conformidade com Influência: você combina precisão com sensibilidade para as pessoas. Tende a escolher bem as informações, explicar com paciência e manter relações cordiais. Atenção à demora em se expor antes de ter tudo pronto.'
    },
    CS: {
      nome: 'Artesão',
      frase: 'Faz com calma, método e capricho.',
      descricao: 'Conformidade com Estabilidade: você une atenção aos detalhes a um ritmo constante. Tende a ser cuidadoso, organizado e muito consistente na qualidade do que entrega. Atenção à demora em decidir e à preferência pelo jeito conhecido de fazer.'
    }
  };

  var CODIGOS = ['D', 'I', 'S', 'C', 'DI', 'DS', 'DC', 'ID', 'IS', 'IC', 'SD', 'SI', 'SC', 'CD', 'CI', 'CS'];

  function nome(cod) {
    var c = String(cod == null ? '' : cod).toUpperCase();
    var x = Object.prototype.hasOwnProperty.call(COMBINACOES, c) ? COMBINACOES[c] : null;
    return x ? { codigo: c, nome: x.nome, frase: x.frase, descricao: x.descricao } : null;
  }

  function percentuaisValidos(p) {
    if (!p || typeof p !== 'object') return null;
    var out = {};
    for (var i = 0; i < LETRAS.length; i++) {
      var b = p[LETRAS[i]];
      var v = Number(b);
      if (b === null || b === '' || typeof b === 'boolean' || !isFinite(v) || v < 0 || v > 100) return null;
      out[LETRAS[i]] = v;
    }
    return out;
  }

  function codigo(percentuais, codigoDisc) {
    var p = percentuaisValidos(percentuais);
    if (!p) return null;
    var pri, sec;
    var c = String(codigoDisc == null ? '' : codigoDisc).toUpperCase();
    if (/^[DISC]{2}$/.test(c) && c.charAt(0) !== c.charAt(1)) {
      pri = c.charAt(0); sec = c.charAt(1);
    } else {
      var ordem = LETRAS.slice().sort(function (a, b) { return p[b] - p[a]; });
      pri = ordem[0]; sec = ordem[1];
    }
    if (p[sec] < LIMITE_SECUNDARIO || p[pri] - p[sec] >= DISTANCIA_PURO) return pri;
    return pri + sec;
  }

  function combinacao(percentuais, codigoDisc) {
    var c = codigo(percentuais, codigoDisc);
    var n = c ? nome(c) : null;
    if (!n) return null;
    return { codigo: c, puro: c.length === 1, nome: n.nome, frase: n.frase, descricao: n.descricao };
  }

  var API = {
    CODIGOS: CODIGOS,
    LIMITE_SECUNDARIO: LIMITE_SECUNDARIO,
    DISTANCIA_PURO: DISTANCIA_PURO,
    nome: nome,
    codigo: codigo,
    combinacao: combinacao
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.DISC_COMBINACOES = API;
})(typeof self !== 'undefined' ? self : this);
