/*
 * Etapa de validação ("Confira se isto combina com você") — aparece depois dos grupos e antes da revisão.
 *
 * Objetivo: a própria pessoa confirma (ou não) o retrato que o teste formou dela. Serve para o painel
 * medir a confiabilidade do resultado (js/confiabilidade.js), pegando respostas ao acaso ou "decoradas".
 *
 * REGRA DE NEUTRALIDADE (leia antes de editar):
 *   - Nada de nome do teste, letras, perfis ou fatores no texto visível.
 *   - Os 4 retratos precisam ser IGUALMENTE positivos e atraentes: a pessoa deve escolher aquele em
 *     que se reconhece, não "o mais bonito". Nada de elogio comparativo.
 *   - Cada "sombra" é o EXCESSO da força de mesmo índice (sombras[k] <-> forcas[k]), dita de forma
 *     honesta e sem ofender. Toda qualidade, quando passa do ponto, tem um custo — reconhecer isso
 *     é sinal de autoconhecimento, não de defeito.
 *   - Linguagem simples, 1ª pessoa, sem marcar gênero.
 *   O teste tests/validacao.test.js verifica termos proibidos e a estrutura.
 */
(function (root) {
  var LETRAS = ['D', 'I', 'S', 'C'];

  var retratos = {
    D: 'Gosto de desafios e de ver as coisas acontecerem. Quando aparece um problema, prefiro tomar a frente e resolver logo. Metas claras me dão energia.',
    I: 'Gosto de gente e de conversar. Tenho facilidade para animar o grupo e para fazer os outros toparem uma ideia nova. Trabalho com mais vontade quando o clima é leve e todo mundo participa.',
    S: 'Sou uma pessoa calma e paciente. Gosto de ajudar quem está ao meu lado e de fazer as coisas com constância, do começo ao fim. As pessoas sabem que podem contar comigo.',
    C: 'Gosto de fazer as coisas do jeito certo, com cuidado e atenção aos detalhes. Antes de agir, prefiro entender bem e conferir as informações. Me sinto bem quando o trabalho sai caprichado e sem erros.'
  };

  function item(id, texto) { return { id: id, texto: texto }; }

  var afirmacoes = {
    D: {
      forcas: [
        item('D-f1', 'Gosto de decidir rápido e resolver logo.'),
        item('D-f2', 'Fico à vontade para assumir a responsabilidade quando algo precisa ser feito.'),
        item('D-f3', 'Falo de forma direta, sem rodeios.')
      ],
      sombras: [
        item('D-s1', 'Às vezes decido tão rápido que passo por cima de detalhes ou da opinião dos outros.'),
        item('D-s2', 'Às vezes tomo a frente de coisas que outras pessoas também queriam conduzir.'),
        item('D-s3', 'Às vezes falo de um jeito tão direto que a outra pessoa se sente cobrada ou magoada.')
      ]
    },
    I: {
      forcas: [
        item('I-f1', 'Puxo conversa com facilidade, até com quem acabei de conhecer.'),
        item('I-f2', 'Consigo animar as pessoas e deixar o ambiente mais leve.'),
        item('I-f3', 'Me empolgo com ideias novas e gosto de começar projetos.')
      ],
      sombras: [
        item('I-s1', 'Às vezes falo tanto que deixo pouco espaço para os outros ou me distraio da tarefa.'),
        item('I-s2', 'Às vezes, para manter o clima bom, evito dizer algo difícil que precisava ser dito.'),
        item('I-s3', 'Às vezes me empolgo com algo novo e deixo o que já tinha começado sem terminar.')
      ]
    },
    S: {
      forcas: [
        item('S-f1', 'Tenho paciência para ouvir e ajudar quem precisa.'),
        item('S-f2', 'Gosto de rotina e de fazer as coisas com constância.'),
        item('S-f3', 'Prefiro manter a calma e evitar brigas.')
      ],
      sombras: [
        item('S-s1', 'Às vezes ajudo tanto os outros que deixo minhas próprias tarefas para depois.'),
        item('S-s2', 'Às vezes demoro para me acostumar quando a rotina muda de repente.'),
        item('S-s3', 'Às vezes guardo para mim o que penso, para evitar conflito, mesmo quando discordo.')
      ]
    },
    C: {
      forcas: [
        item('C-f1', 'Presto atenção nos detalhes e confiro o que faço.'),
        item('C-f2', 'Gosto de seguir as regras e de fazer do jeito combinado.'),
        item('C-f3', 'Antes de decidir, gosto de pensar com calma e reunir informações.')
      ],
      sombras: [
        item('C-s1', 'Às vezes confiro tanto que demoro mais do que o necessário para entregar.'),
        item('C-s2', 'Às vezes me incomodo muito quando alguém faz de um jeito diferente do combinado.'),
        item('C-s3', 'Às vezes espero ter tanta certeza que adio decisões que já podiam ser tomadas.')
      ]
    }
  };

  var ESCALA = ['Discordo totalmente', 'Discordo', 'Em parte', 'Concordo', 'Concordo totalmente'];

  function embaralhar(lista, rnd) {
    var a = lista.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // Aceita o objeto de DISC_SCORING.calcular (usa .ordem) ou algo com .totais/.percentuais.
  function ordemDe(resultado) {
    if (resultado && Array.isArray(resultado.ordem) && resultado.ordem.length === 4) return resultado.ordem.slice();
    var base = (resultado && (resultado.totais || resultado.percentuais)) || {};
    return LETRAS.slice().sort(function (a, b) { return (Number(base[b]) || 0) - (Number(base[a]) || 0); });
  }

  function indice(rnd) { return Math.min(2, Math.floor(rnd() * 3)); }

  // -> { pares: [[l1,l2] x3] (ordem de exibição embaralhada), itens: [{id, letra, tipo, texto} x4] (embaralhados) }
  function montarEtapa(resultado, rnd) {
    rnd = typeof rnd === 'function' ? rnd : Math.random;
    var ordem = ordemDe(resultado);
    var primario = ordem[0], secundario = ordem[1], terceiro = ordem[2], ultimo = ordem[3];

    var pares = [[primario, ultimo], [secundario, terceiro], [primario, terceiro]].map(function (p) {
      return embaralhar(p, rnd);
    });
    pares = embaralhar(pares, rnd);

    var kP = indice(rnd), kS = indice(rnd), kU = indice(rnd);
    var fP = afirmacoes[primario].forcas[kP];
    var sP = afirmacoes[primario].sombras[kP];
    var fS = afirmacoes[secundario].forcas[kS];
    var fU = afirmacoes[ultimo].forcas[kU];
    var itens = [
      { id: fP.id, letra: primario, tipo: 'forca', texto: fP.texto },
      { id: sP.id, letra: primario, tipo: 'sombra', texto: sP.texto },
      { id: fS.id, letra: secundario, tipo: 'forca', texto: fS.texto },
      { id: fU.id, letra: ultimo, tipo: 'contraste', texto: fU.texto }
    ];
    return { pares: pares, itens: embaralhar(itens, rnd) };
  }

  var DISC_VALIDACAO = {
    retratos: retratos,
    afirmacoes: afirmacoes,
    ESCALA: ESCALA,
    montarEtapa: montarEtapa
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = DISC_VALIDACAO;
  else root.DISC_VALIDACAO = DISC_VALIDACAO;
})(typeof self !== 'undefined' ? self : this);
