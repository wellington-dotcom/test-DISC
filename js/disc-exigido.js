/*
 * Parte 2 do teste — perfil EXIGIDO ("como o seu trabalho exige que você seja").
 *
 * Módulo PURO (sem DOM, sem rede), UMD: window.DISC_EXIGIDO / module.exports.
 * Depende só de DISC_SCORING (opcional: para aceitar o `respostas` natural de 100 dígitos).
 *
 * Formato `exigido` (contrato compartilhado app/painel/servidor):
 *   string de 40 dígitos 1–4, 4 por grupo na ordem D,I,S,C (mesma convenção do `respostas` de 100
 *   dígitos, ver js/scoring.js compactar/descompactar). Cada grupo é uma permutação de 1..4.
 *   Os 10 grupos usados são os índices GRUPOS de DISC_DATA.grupos, nesta ordem.
 *
 * API
 *   GRUPOS                         -> [0, 2, 5, 7, 10, 12, 15, 17, 20, 22]
 *   TOTAL_GRUPOS                   -> 10
 *   validar(str) -> bool
 *   calcular(str) -> { totais:{D,I,S,C} (10–40), percentuais:{D,I,S,C} (= totais, soma 100),
 *                      ordem, primario, secundario, codigo }        // lança erro se inválido
 *   compactar(grupos[10]) / descompactar(str) -> mesma ideia do DISC_SCORING, com 10 grupos
 *   eixos(percentuais) -> { ritmo, foco }  em −100..100 (na prática −60..60), 1 casa decimal.
 *       CONVENÇÃO = a de js/compatibilidade.js (fonte única):
 *         ritmo = (D+I) − (S+C)   positivo = acelerado / negativo = cauteloso
 *         foco  = (D+C) − (I+S)   positivo = TAREFAS   / negativo = PESSOAS
 *       Atenção: o contrato da rodada 3 descrevia foco com o sinal oposto (+ pessoas). Prevaleceu o motor
 *       de compatibilidade; para quem precisar de "+ pessoas" existe paraPessoas(eixos).
 *   paraPessoas(eixos) -> { ritmo, foco }  com foco invertido (positivo = pessoas)
 *   CONVENCAO -> descrição textual dos sinais
 *   adaptacao(natural, exigido, opcoes?) -> {
 *       indice: 0–100 inteiro (= soma |exigido − natural| / 2),
 *       faixa: 'baixa' (<10) | 'moderada' (<20) | 'alta' (<30) | 'muito_alta' (≥30),
 *       rotulo: 'Baixo' | 'Moderado' | 'Alto' | 'Muito alto',
 *       porFator: {D,I,S,C}  (exigido − natural, 1 casa),
 *       maisCobrado: letra de maior Δ positivo (Δ ≥ 3) | null,
 *       menosUsado:  letra de maior Δ negativo (Δ ≤ −3) | null,
 *       eixos: { natural:{ritmo,foco}, exigido:{ritmo,foco} },
 *       textos: { pessoa:[string] (2ª pessoa, "você"), lider:[string] (3ª pessoa, com opcoes.nome) }
 *     } | null (se faltar algum dos dois perfis)
 *     natural / exigido aceitam: objeto {D,I,S,C}, resultado {percentuais}, string de 40 dígitos (exigido)
 *     ou de 100 dígitos (natural, via DISC_SCORING). Os dois são normalizados para somar 100.
 *     opcoes.nome: nome exibido nos textos do líder (padrão "esta pessoa").
 *
 * Calibração das faixas: só ruído de resposta (mesma pessoa, sem mudança real) dá índice ~5–8;
 * um fator deslocado 10 pontos dá ~10; perfil "virado" (ex.: DI natural e SC exigido) passa de 30.
 * O limiar de 3 pontos para maisCobrado/menosUsado evita apontar diferenças que são ruído.
 *
 * Regra de conteúdo: o índice descreve quanto o comportamento pedido pelo trabalho difere do estilo
 * natural. Fala de comportamento e de ajustes no trabalho — nunca de saúde ou de estado emocional.
 */
(function (root) {
  var LETRAS = ['D', 'I', 'S', 'C'];
  var GRUPOS = [0, 2, 5, 7, 10, 12, 15, 17, 20, 22];
  var TOTAL_GRUPOS = GRUPOS.length;
  var LIMIAR_FATOR = 3;
  var LIMIAR_EIXO = 15;
  var FAIXAS = [
    { ate: 10, faixa: 'baixa' },
    { ate: 20, faixa: 'moderada' },
    { ate: 30, faixa: 'alta' },
    { ate: Infinity, faixa: 'muito_alta' }
  ];
  var ROTULOS = { baixa: 'Baixo', moderada: 'Moderado', alta: 'Alto', muito_alta: 'Muito alto' };
  var NOMES = { D: 'Dominância', I: 'Influência', S: 'Estabilidade', C: 'Conformidade' };
  var CONVENCAO = {
    ritmo: '(D+I) − (S+C): positivo = acelerado, negativo = cauteloso',
    foco: '(D+C) − (I+S): positivo = tarefas, negativo = pessoas (mesma convenção de js/compatibilidade.js)'
  };

  function dep(global, arquivo) {
    if (root && root[global]) return root[global];
    if (typeof require === 'function') {
      try { return require(arquivo); } catch (e) { /* ausente */ }
    }
    return null;
  }

  function arred(n) { return Math.round(n * 10) / 10; }

  // ------------------------------------------------------------------ formato
  function validar(str) {
    if (typeof str !== 'string' || !/^[1-4]{40}$/.test(str)) return false;
    for (var i = 0; i < TOTAL_GRUPOS; i++) {
      var g = str.substr(i * 4, 4);
      if (g.split('').sort().join('') !== '1234') return false;
    }
    return true;
  }

  function descompactar(str) {
    if (!validar(str)) throw new Error('Parte 2 inválida: esperado 40 dígitos (10 grupos com notas 1-4 sem repetição).');
    var out = [];
    for (var i = 0; i < TOTAL_GRUPOS; i++) {
      var g = {};
      LETRAS.forEach(function (l, j) { g[l] = Number(str[i * 4 + j]); });
      out.push(g);
    }
    return out;
  }

  function compactar(grupos) {
    if (!Array.isArray(grupos) || grupos.length !== TOTAL_GRUPOS) throw new Error('Parte 2 inválida: esperado 10 grupos.');
    var s = grupos.map(function (g) { return LETRAS.map(function (l) { return g && g[l]; }).join(''); }).join('');
    if (!validar(s)) throw new Error('Parte 2 inválida: notas 1-4 sem repetição em cada grupo.');
    return s;
  }

  // Mesma regra do DISC_SCORING: ordem decrescente por total, empate mantém D, I, S, C.
  function calcular(str) {
    var grupos = descompactar(str);
    var totais = { D: 0, I: 0, S: 0, C: 0 };
    grupos.forEach(function (g) { LETRAS.forEach(function (l) { totais[l] += g[l]; }); });
    var percentuais = {};
    LETRAS.forEach(function (l) { percentuais[l] = totais[l]; }); // 10 grupos x (1+2+3+4) = 100
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

  // ------------------------------------------------------------------ percentuais de qualquer entrada
  function normalizar(pct) {
    if (!pct || typeof pct !== 'object') return null;
    var p = {}, soma = 0;
    LETRAS.forEach(function (l) {
      var v = Number(pct[l]);
      p[l] = isFinite(v) && v > 0 ? v : 0;
      soma += p[l];
    });
    if (soma <= 0) return null;
    LETRAS.forEach(function (l) { p[l] = arred(p[l] * 100 / soma); });
    return p;
  }

  function lerPerfil(x) {
    if (x === null || x === undefined || x === '') return null;
    if (typeof x === 'string') {
      var s = x.replace(/\D/g, '');
      if (s.length === 40) return validar(s) ? calcular(s).percentuais : null;
      if (s.length === 100) {
        var SC = dep('DISC_SCORING', './scoring.js');
        if (!SC) return null;
        try { return SC.calcular(SC.descompactar(s)).percentuais; } catch (e) { return null; }
      }
      return null;
    }
    if (typeof x === 'object') return normalizar(x.percentuais && typeof x.percentuais === 'object' ? x.percentuais : x);
    return null;
  }

  // ------------------------------------------------------------------ eixos
  function eixos(percentuais) {
    var p = normalizar(percentuais && percentuais.percentuais ? percentuais.percentuais : percentuais);
    if (!p) return { ritmo: 0, foco: 0 };
    return {
      ritmo: arred(p.D + p.I - p.S - p.C),  // + acelerado / − cauteloso
      foco: arred(p.D + p.C - p.I - p.S)    // + tarefas / − pessoas (igual a js/compatibilidade.js)
    };
  }

  function paraPessoas(e) {
    e = e || {};
    return { ritmo: Number(e.ritmo) || 0, foco: arred(-(Number(e.foco) || 0)) || 0 };
  }

  function faixaDe(indice) {
    for (var i = 0; i < FAIXAS.length; i++) if (indice < FAIXAS[i].ate) return FAIXAS[i].faixa;
    return 'muito_alta';
  }

  // ------------------------------------------------------------------ textos (nossos)
  var T_FAIXA = {
    baixa: {
      pessoa: 'O que o seu trabalho pede está próximo do seu jeito natural: você tende a usar seus pontos fortes no dia a dia sem precisar se ajustar muito.',
      lider: 'O que {nome} percebe que o cargo pede está perto do estilo natural: a função tende a aproveitar bem os pontos fortes naturais.'
    },
    moderada: {
      pessoa: 'O seu trabalho pede alguns ajustes em relação ao seu jeito natural. É o tipo de adaptação comum na maior parte das funções e costuma ficar mais fácil com combinados claros e um pouco de prática.',
      lider: '{nome} percebe alguns ajustes entre o estilo natural e o que o cargo pede — algo comum na maior parte das funções. Vale acompanhar os pontos abaixo nas conversas individuais.'
    },
    alta: {
      pessoa: 'O seu trabalho pede um jeito de agir bem diferente do seu natural em pelo menos um ponto. Dá para fazer bem, mas o ajuste é constante — vale combinar rotinas, ferramentas e apoios que deixem esse esforço mais leve.',
      lider: 'O cargo pede de {nome} um comportamento bem diferente do natural em pelo menos um ponto. A entrega pode ser boa, mas o ajuste é contínuo: vale revisar rotinas, apoios e a distribuição de tarefas.'
    },
    muito_alta: {
      pessoa: 'O seu trabalho pede um estilo muito diferente do seu natural. Isso não diz nada sobre a sua capacidade: significa que boa parte do dia é dedicada a se ajustar. Vale conversar com a liderança sobre como organizar tarefas e apoios para que você também use mais o seu jeito natural.',
      lider: 'Há uma distância grande entre o estilo natural de {nome} e o que o cargo pede. Não é falta de capacidade; é um convite a revisar o desenho da função: quais tarefas podem ser redistribuídas, que apoios ajudam e onde o estilo natural dessa pessoa pode render mais.'
    }
  };

  var T_COBRADO = {
    D: {
      pessoa: 'O trabalho pede mais Dominância do que é natural para você: decidir mais rápido, tomar a frente e se posicionar com firmeza. Ajuda combinar com a liderança quais decisões são suas e preparar antes os pontos em que precisa ser firme.',
      lider: 'O cargo pede de {nome} mais decisão e firmeza do que o estilo natural oferece. Deixe claro quais decisões são dessa pessoa, dê respaldo quando ela precisar se posicionar e acompanhe por resultados — sem cobrar que pareça alguém que não é.'
    },
    I: {
      pessoa: 'O trabalho pede mais Influência do que é natural para você: falar mais, se expor, convencer e animar as pessoas. Ajuda preparar as conversas importantes com antecedência e reservar momentos mais tranquilos entre um contato e outro.',
      lider: 'O cargo pede de {nome} mais exposição e articulação com pessoas do que o natural. Preparem juntos as conversas mais importantes, reconheça o empenho em se colocar e, se possível, equilibre a agenda com tarefas mais individuais.'
    },
    S: {
      pessoa: 'O trabalho pede mais Estabilidade do que é natural para você: paciência, constância, rotina e atenção ao ritmo dos outros. Ajuda transformar a rotina em metas curtas e visíveis e buscar alguma variedade dentro do que é possível.',
      lider: 'O cargo pede de {nome} mais paciência e constância do que o natural. Ofereça variedade dentro da rotina, metas curtas e visíveis e espaço para propor melhorias no processo.'
    },
    C: {
      pessoa: 'O trabalho pede mais Conformidade do que é natural para você: seguir padrões, conferir detalhes e documentar. Ajuda usar listas de checagem e modelos prontos, para que a precisão não dependa só de atenção redobrada.',
      lider: 'O cargo pede de {nome} mais precisão e atenção a padrões do que o natural. Ofereça listas de checagem, modelos e uma revisão em dupla nos pontos críticos, em vez de olhar só para o erro.'
    }
  };

  var T_MENOS = {
    D: {
      pessoa: 'O trabalho usa menos a sua Dominância: há pouco espaço para decidir e conduzir do seu jeito. Procure projetos em que possa tomar a frente ou combine metas com mais autonomia no "como".',
      lider: 'O cargo usa pouco a iniciativa e a capacidade de decisão de {nome}. Delegue um projeto com meta própria e autonomia no "como" — é uma forma simples de aproveitar melhor esse traço.'
    },
    I: {
      pessoa: 'O trabalho usa menos a sua Influência: há pouca interação ou pouco espaço para ideias. Proponha momentos de troca com o time e, quando fizer sentido, ofereça-se para apresentar, integrar pessoas ou receber quem chega.',
      lider: 'O cargo usa pouco a facilidade de {nome} com pessoas. Quando fizer sentido, envolva em integrações, apresentações ou no acolhimento de quem chega ao time.'
    },
    S: {
      pessoa: 'O trabalho usa menos a sua Estabilidade: o dia a dia pede mais mudança e respostas rápidas do que você prefere. Ajuda pedir prioridades claras e criar pequenas rotinas próprias que tragam previsibilidade.',
      lider: 'O cargo pede de {nome} menos constância e mais mudança do que o natural. Antecipe mudanças, explique o porquê e mantenha alguns pontos fixos na rotina dessa pessoa.'
    },
    C: {
      pessoa: 'O trabalho usa menos a sua Conformidade: pede velocidade mais do que profundidade. Combine o que é "bom o suficiente" em cada entrega e guarde a análise detalhada para o que realmente pede.',
      lider: 'O cargo usa pouco o cuidado com qualidade de {nome}. Dê uma frente em que a precisão conte (revisão, controle, padronização) e combine o nível de detalhe esperado no restante.'
    }
  };

  var T_EIXO = {
    acelerado: {
      pessoa: 'No geral, o trabalho pede um ritmo mais acelerado do que o seu: mais rapidez para responder, decidir e mudar de rumo.',
      lider: 'No geral, o cargo pede de {nome} um ritmo mais acelerado do que o natural; prioridades claras ajudam a manter a velocidade sem perder qualidade.'
    },
    cauteloso: {
      pessoa: 'No geral, o trabalho pede um ritmo mais cauteloso do que o seu: mais tempo para conferir, planejar e seguir o processo.',
      lider: 'No geral, o cargo pede de {nome} um ritmo mais cauteloso do que o natural; combine onde vale ir devagar e onde dá para acelerar.'
    },
    tarefas: {
      pessoa: 'O trabalho também pede mais atenção a tarefas e resultados e menos a relacionamentos do que você naturalmente dá.',
      lider: 'O cargo pede de {nome} mais foco em tarefas e resultados do que em relacionamentos; momentos de troca com o time ajudam a equilibrar.'
    },
    pessoas: {
      pessoa: 'O trabalho também pede mais atenção a pessoas e relacionamentos do que você naturalmente dá, e menos a tarefas isoladas.',
      lider: 'O cargo pede de {nome} mais atenção a pessoas do que o natural; reserve na agenda tempo para as tarefas individuais que essa pessoa faz melhor.'
    }
  };

  var FECHO = {
    pessoa: 'Esta parte mostra como você percebe o que o trabalho pede. Use-a para conversar com a sua liderança sobre ajustes possíveis — não é nota nem avaliação de desempenho.',
    lider: 'Esta leitura vem da percepção de {nome} sobre o cargo. Confirme numa conversa o que de fato é esperado e quais ajustes são possíveis.'
  };

  function maiuscula(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  // ------------------------------------------------------------------ adaptação
  function adaptacao(natural, exigido, opcoes) {
    var pn = lerPerfil(natural), pe = lerPerfil(exigido);
    if (!pn || !pe) return null;
    opcoes = opcoes || {};
    var nome = String(opcoes.nome || '').trim();
    function comNome(t) {
      t = nome ? t.replace(/\{nome\}/g, nome) : t.replace(/\bde \{nome\}/g, 'desta pessoa').replace(/\{nome\}/g, 'esta pessoa');
      return maiuscula(t.replace(/( [A-ZÀ-Ý]\.)\./g, '$1'));
    }

    var porFator = {}, soma = 0;
    LETRAS.forEach(function (l) {
      porFator[l] = arred(pe[l] - pn[l]) || 0;
      soma += Math.abs(pe[l] - pn[l]);
    });
    var indice = Math.max(0, Math.min(100, Math.round(soma / 2)));
    var faixa = faixaDe(indice);

    var maisCobrado = null, menosUsado = null;
    LETRAS.forEach(function (l) {
      if (porFator[l] >= LIMIAR_FATOR && (!maisCobrado || porFator[l] > porFator[maisCobrado])) maisCobrado = l;
      if (porFator[l] <= -LIMIAR_FATOR && (!menosUsado || porFator[l] < porFator[menosUsado])) menosUsado = l;
    });

    var en = eixos(pn), ee = eixos(pe);
    var pessoa = [], lider = [];
    function add(t) {
      pessoa.push(t.pessoa);
      lider.push(comNome(t.lider));
    }
    add(T_FAIXA[faixa]);
    if (faixa !== 'baixa' || indice >= 5) {
      if (maisCobrado) add(T_COBRADO[maisCobrado]);
      if (menosUsado) add(T_MENOS[menosUsado]);
    }
    var dr = ee.ritmo - en.ritmo, df = ee.foco - en.foco;
    if (dr >= LIMIAR_EIXO) add(T_EIXO.acelerado);
    else if (dr <= -LIMIAR_EIXO) add(T_EIXO.cauteloso);
    if (df >= LIMIAR_EIXO) add(T_EIXO.tarefas);
    else if (df <= -LIMIAR_EIXO) add(T_EIXO.pessoas);
    add(FECHO);

    return {
      indice: indice,
      faixa: faixa,
      rotulo: ROTULOS[faixa],
      porFator: porFator,
      maisCobrado: maisCobrado,
      menosUsado: menosUsado,
      eixos: { natural: en, exigido: ee },
      textos: { pessoa: pessoa, lider: lider }
    };
  }

  var DISC_EXIGIDO = {
    LETRAS: LETRAS,
    GRUPOS: GRUPOS,
    TOTAL_GRUPOS: TOTAL_GRUPOS,
    NOMES: NOMES,
    ROTULOS: ROTULOS,
    CONVENCAO: CONVENCAO,
    LIMIAR_FATOR: LIMIAR_FATOR,
    validar: validar,
    calcular: calcular,
    compactar: compactar,
    descompactar: descompactar,
    eixos: eixos,
    paraPessoas: paraPessoas,
    faixa: faixaDe,
    adaptacao: adaptacao
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = DISC_EXIGIDO;
  else root.DISC_EXIGIDO = DISC_EXIGIDO;
})(typeof self !== 'undefined' ? self : this);
