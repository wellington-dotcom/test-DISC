/*
 * Régua de intensidade DISC: em que faixa cada fator aparece (texto 100% nosso).
 *
 * Módulo PURO (UMD, global DISC_INTENSIDADE):
 *   FAIXAS   = ['muito_baixa', 'baixa', 'media', 'alta', 'muito_alta']
 *   LIMITES  = [15, 22, 29, 36]          // pct < 15 muito_baixa; < 22 baixa; < 29 media; < 36 alta; >= 36 muito_alta
 *   ROTULOS  = { muito_baixa: 'Muito baixa', ... }
 *   faixa(pct)            -> uma das FAIXAS (ou null se pct não for número entre 0 e 100)
 *   texto(letra, faixa)   -> { resumo, comportamento, excesso: string|null, falta: string|null } (cópia) ou null
 *                            excesso só nas faixas alta/muito_alta; falta só nas faixas baixa/muito_baixa.
 *   regua(percentuais)    -> [{ letra, nome, pct, faixa, rotulo, resumo, comportamento, excesso, falta }] (D, I, S, C) ou null
 *
 * Calibragem: no teste de 25 grupos o total de cada letra vai de 25 a 100 e o percentual = total / 2,5, ou seja
 * de 10 a 40 em passos de 0,4, com média 25 (os quatro somam 100). A faixa "media" (22 a 28,9) fica centrada na média;
 * "muito_alta" (>= 36, total >= 90) e "muito_baixa" (< 15, total < 37,5) exigem escolhas quase sempre no topo ou
 * quase sempre no fim da ordem (média >= 3,6 ou < 1,5 por grupo), e por isso são raras. Os mesmos limites servem
 * para a Parte 2 (10 grupos, percentual também de 10 a 40).
 */
(function (root) {
  'use strict';

  var LETRAS = ['D', 'I', 'S', 'C'];
  var NOMES = { D: 'Dominância', I: 'Influência', S: 'Estabilidade', C: 'Conformidade' };
  var FAIXAS = ['muito_baixa', 'baixa', 'media', 'alta', 'muito_alta'];
  var LIMITES = [15, 22, 29, 36];
  var ROTULOS = { muito_baixa: 'Muito baixa', baixa: 'Baixa', media: 'Média', alta: 'Alta', muito_alta: 'Muito alta' };

  // 20 combinações letra × faixa.
  var TEXTOS = {
    D: {
      muito_alta: {
        resumo: 'Dominância muito alta: a busca por resultado e a vontade de decidir estão no centro do seu jeito de trabalhar.',
        comportamento: 'Você tende a assumir o comando quase de forma automática, enfrenta obstáculos de frente e se incomoda com lentidão ou indefinição.',
        excesso: 'Quando exagerada, essa força pode atropelar o tempo dos outros e transformar conversas em disputas. Vale combinar com o grupo quando você vai decidir sozinho e quando vai consultar.',
        falta: null
      },
      alta: {
        resumo: 'Dominância alta: você costuma se posicionar com firmeza e gosta de ver as coisas andando.',
        comportamento: 'Em geral toma iniciativa, aceita desafios e prefere metas claras, mas consegue recuar quando o contexto pede mais escuta.',
        excesso: 'Quando exagerada, pode soar como impaciência. Antes de cobrar, procure saber em que pé a outra pessoa está.',
        falta: null
      },
      media: {
        resumo: 'Dominância na média: você assume a frente quando a situação pede, sem precisar disso o tempo todo.',
        comportamento: 'Consegue decidir e defender uma posição, e também se sente à vontade seguindo a direção de outra pessoa quando confia nela.',
        excesso: null,
        falta: null
      },
      baixa: {
        resumo: 'Dominância baixa: você prefere construir acordos a impor caminhos.',
        comportamento: 'Tende a buscar consenso, evita confrontos desnecessários e se sente melhor quando a decisão é compartilhada.',
        excesso: null,
        falta: 'Quando falta, você pode demorar a se posicionar em situações que pedem uma resposta firme. Treine dizer o que você decidiria antes de ouvir todo mundo.'
      },
      muito_baixa: {
        resumo: 'Dominância muito baixa: disputar espaço ou pressionar por resultado não é o seu modo natural.',
        comportamento: 'Você costuma deixar a condução para outras pessoas e contribui melhor em ambientes colaborativos, sem competição aberta.',
        excesso: null,
        falta: 'Quando falta, decisões difíceis podem ficar paradas esperando alguém. Escolha pequenas decisões do seu dia para assumir por inteiro, com prazo definido.'
      }
    },
    I: {
      muito_alta: {
        resumo: 'Influência muito alta: conversar, convencer e envolver as pessoas é o que mais dá energia ao seu trabalho.',
        comportamento: 'Você cria conexões com rapidez, se expressa com entusiasmo e costuma ser quem anima o grupo e abre portas.',
        excesso: 'Quando exagerada, pode espalhar sua atenção em muitas frentes e deixar o acompanhamento para depois. Registre os combinados e feche um assunto antes de abrir outro.',
        falta: null
      },
      alta: {
        resumo: 'Influência alta: você tem facilidade para se comunicar e gosta de estar em contato com gente.',
        comportamento: 'Costuma ser bem recebido em grupos, explica com exemplos e prefere trabalhar perto das pessoas a ficar isolado.',
        excesso: 'Quando exagerada, a conversa pode ocupar o tempo da entrega. Reserve blocos do dia sem interrupções.',
        falta: null
      },
      media: {
        resumo: 'Influência na média: você transita bem entre momentos de conversa e momentos de concentração.',
        comportamento: 'Participa, se expressa e cria vínculos quando há propósito, sem depender de interação constante para render.',
        excesso: null,
        falta: null
      },
      baixa: {
        resumo: 'Influência baixa: você prefere conversas objetivas e relações construídas aos poucos.',
        comportamento: 'Costuma falar quando tem algo concreto a dizer, observa antes de se expor e se sente bem trabalhando com mais autonomia.',
        excesso: null,
        falta: 'Quando falta, suas ideias podem passar despercebidas. Compartilhe o que pensa mais cedo, mesmo que ainda não esteja completo.'
      },
      muito_baixa: {
        resumo: 'Influência muito baixa: persuadir e se expor diante de muita gente não é o que te move.',
        comportamento: 'Você tende a ser reservado, valoriza mais o conteúdo do que a forma e prefere que o trabalho fale por si.',
        excesso: null,
        falta: 'Quando falta, o grupo pode não saber o que você está fazendo nem o valor disso. Combine uma forma simples e regular de contar o andamento do seu trabalho.'
      }
    },
    S: {
      muito_alta: {
        resumo: 'Estabilidade muito alta: constância, previsibilidade e cooperação são a base do seu jeito de trabalhar.',
        comportamento: 'Você mantém o ritmo mesmo em tarefas longas, é leal ao time e transmite calma; mudanças bruscas costumam pedir mais tempo de adaptação.',
        excesso: 'Quando exagerada, pode levar você a aceitar mais do que cabe e a adiar conversas necessárias. Discordar com respeito também é uma forma de cooperar.',
        falta: null
      },
      alta: {
        resumo: 'Estabilidade alta: você é alguém em quem o grupo confia para manter as coisas funcionando.',
        comportamento: 'Costuma ser paciente, escuta com atenção e gosta de saber o que esperar; se adapta melhor quando a mudança é explicada.',
        excesso: 'Quando exagerada, pode prender você ao jeito conhecido de fazer. Teste uma melhoria pequena antes de descartar a novidade.',
        falta: null
      },
      media: {
        resumo: 'Estabilidade na média: você equilibra rotina e variedade sem grande esforço.',
        comportamento: 'Gosta de ter alguma previsibilidade, mas lida bem com mudanças quando entende o motivo e o próximo passo.',
        excesso: null,
        falta: null
      },
      baixa: {
        resumo: 'Estabilidade baixa: variedade e movimento te estimulam mais do que a rotina.',
        comportamento: 'Você tende a mudar de tarefa com facilidade, se adapta rápido ao novo e pode perder o interesse em atividades repetitivas.',
        excesso: null,
        falta: 'Quando falta, tarefas longas podem ficar pela metade. Defina marcos curtos e comemore cada etapa concluída.'
      },
      muito_baixa: {
        resumo: 'Estabilidade muito baixa: manter o mesmo ritmo por muito tempo não combina com você.',
        comportamento: 'Você busca novidade, age com urgência e costuma ser quem puxa o grupo para mudar; a paciência com processos lentos é menor.',
        excesso: null,
        falta: 'Quando falta, as pessoas ao redor podem sentir instabilidade nos combinados. Antes de mudar um plano, avise quem depende dele e explique o motivo.'
      }
    },
    C: {
      muito_alta: {
        resumo: 'Conformidade muito alta: precisão, método e qualidade orientam praticamente todas as suas escolhas.',
        comportamento: 'Você analisa a fundo, segue padrões com rigor e percebe falhas que passam despercebidas a outras pessoas.',
        excesso: 'Quando exagerada, pode transformar cada entrega em uma revisão sem fim. Combine antes o nível de detalhe que a tarefa realmente pede.',
        falta: null
      },
      alta: {
        resumo: 'Conformidade alta: você gosta de fazer bem feito e de entender como as coisas funcionam.',
        comportamento: 'Costuma se preparar antes de agir, prefere instruções claras e confere o próprio trabalho antes de entregar.',
        excesso: 'Quando exagerada, pode atrasar decisões à espera de mais informação. Estabeleça um prazo para analisar e siga em frente.',
        falta: null
      },
      media: {
        resumo: 'Conformidade na média: você cuida da qualidade sem se prender a cada detalhe.',
        comportamento: 'Segue regras e padrões quando fazem sentido e sabe flexibilizá-los quando a situação exige agilidade.',
        excesso: null,
        falta: null
      },
      baixa: {
        resumo: 'Conformidade baixa: você prefere liberdade de método a procedimentos fixos.',
        comportamento: 'Tende a confiar na experiência e no bom senso, resolve as coisas do seu jeito e pode achar regras muito detalhadas cansativas.',
        excesso: null,
        falta: 'Quando falta, pequenos erros podem escapar. Use uma lista curta de conferência nas entregas que mais importam.'
      },
      muito_baixa: {
        resumo: 'Conformidade muito baixa: detalhes, normas e análises longas não são onde você coloca sua energia.',
        comportamento: 'Você age a partir do panorama geral, improvisa com facilidade e prefere testar a planejar cada passo.',
        excesso: null,
        falta: 'Quando falta, prazos, registros e padrões podem ficar descobertos. Combine com alguém detalhista uma revisão das partes críticas e registre o essencial.'
      }
    }
  };

  function numero(pct) {
    if (pct === null || pct === '' || typeof pct === 'boolean') return null;
    var v = Number(pct);
    return isFinite(v) && v >= 0 && v <= 100 ? v : null;
  }

  function faixa(pct) {
    var v = numero(pct);
    if (v === null) return null;
    for (var i = 0; i < LIMITES.length; i++) if (v < LIMITES[i]) return FAIXAS[i];
    return FAIXAS[FAIXAS.length - 1];
  }

  function texto(letra, f) {
    var l = String(letra == null ? '' : letra).toUpperCase();
    var t = TEXTOS[l] && TEXTOS[l][f];
    if (!t) return null;
    return { resumo: t.resumo, comportamento: t.comportamento, excesso: t.excesso, falta: t.falta };
  }

  function regua(percentuais) {
    if (!percentuais || typeof percentuais !== 'object') return null;
    var out = [];
    for (var i = 0; i < LETRAS.length; i++) {
      var l = LETRAS[i];
      var v = numero(percentuais[l]);
      if (v === null) return null;
      var f = faixa(v), t = texto(l, f);
      out.push({
        letra: l, nome: NOMES[l], pct: Math.round(v * 10) / 10, faixa: f, rotulo: ROTULOS[f],
        resumo: t.resumo, comportamento: t.comportamento, excesso: t.excesso, falta: t.falta
      });
    }
    return out;
  }

  var API = {
    LETRAS: LETRAS,
    NOMES: NOMES,
    FAIXAS: FAIXAS,
    LIMITES: LIMITES,
    ROTULOS: ROTULOS,
    faixa: faixa,
    texto: texto,
    regua: regua
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.DISC_INTENSIDADE = API;
})(typeof self !== 'undefined' ? self : this);
