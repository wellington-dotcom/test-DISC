/*
 * Relatório EMPRESA — INDIVIDUAL ("Como liderar esta pessoa").
 * Quem recebe é o líder/empresa; o foco é como liderar o(a) colaborador(a) no dia a dia.
 *
 * Módulo PURO (sem DOM, sem rede), UMD: window.DISC_RELATORIO_LIDERANCA / module.exports.
 * Reaproveita DISC_LIDERANCA (gerarGuia, porPerfil, combinacoes) e DISC_DATA.perfis;
 * aqui ficam só os textos que o Guia para a Liderança não tem (canal/ritmo, cobrança,
 * riscos, 30/60/90, exemplos de frase e ajustes "você e esta pessoa").
 *
 * montar(resultado, ctx)
 *   resultado: { percentuais: {D,I,S,C}, codigo? }   (codigo = primário+secundário, ex.: "DI")
 *   ctx:       { nome, cargo, lider: { nome, percentuais } | null,
 *                exigido?: string de 40 dígitos (Parte 2) | { percentuais, codigo? } | null }
 * -> {
 *      modelo: 'empresa-individual', versao, titulo,
 *      pessoa: { nome, cargo, codigo, primario, secundario, estilo, percentuais, intensidade, equilibrado, intenso },
 *      lider: { nome, codigo, percentuais } | null,
 *      adaptacao: { indice, faixa, rotulo, maisCobrado, menosUsado, porFator, eixos,
 *                   exigido: { percentuais, codigo } } | null      (só com ctx.exigido válido; via DISC_EXIGIDO)
 *      resumo, secoes: [{ chave, titulo, itens: [string], etapas?: [{ periodo, itens }] }], aviso
 *    }
 * Seções (ordem): comunicacao, delegar, feedback, motivacao, precisa, evita, cobrar, estresse, reconhecer,
 *   rendeMais, esforco (só com exigido), riscos, plano, voceEEla (só com percentuais do líder).
 * gerarTexto(dados) -> texto com *negrito* e • para WhatsApp.
 *
 * Nome exibido sempre como "Primeiro nome + inicial" (ex.: "Ana P."). Nenhum dado
 * sensível (idade, gênero, contato, documento) é lido ou devolvido.
 */
(function (root) {
  var LETRAS = ['D', 'I', 'S', 'C'];
  var VERSAO = 1;
  var LIMIAR_EQUILIBRADO = 8;
  var LIMIAR_INTENSO = 35;
  var LIMIAR_BAIXO = 15;
  var LIMIAR_DIFERENCA = 20; // pontos entre líder e pessoa num mesmo fator
  var MEDIA = 25;
  var PARTICULAS = { de: 1, da: 1, das: 1, 'do': 1, dos: 1, e: 1, di: 1, du: 1, del: 1, van: 1, von: 1 };
  var NOMES_PADRAO = { D: 'Dominância', I: 'Influência', S: 'Estabilidade', C: 'Conformidade' };

  var AVISO = 'O DISC descreve estilo de comportamento preferido no trabalho — não mede competência, inteligência nem caráter. ' +
    'Use este relatório como ponto de partida para conversas e ajustes de liderança, nunca como único critério de decisão sobre a pessoa.';

  // Ordem das seções do Guia para a Liderança (DISC_LIDERANCA.SECOES).
  var CHAVES_GUIA = ['comunicar', 'delegar', 'motivar', 'feedback', 'ambiente', 'estresse', 'pdi', 'evitar', 'onboarding'];

  var TITULOS = {
    comunicacao: 'Como se comunicar',
    delegar: 'Como delegar e acompanhar',
    feedback: 'Como dar feedback',
    motivacao: 'O que motiva e o que desmotiva',
    precisa: 'Do que esta pessoa precisa',
    evita: 'O que ela tende a evitar',
    esforco: 'Esforço de adaptação ao cargo',
    cobrar: 'Como cobrar resultado',
    estresse: 'Sinais de estresse e como agir',
    reconhecer: 'Como reconhecer',
    rendeMais: 'Onde rende mais',
    riscos: 'Riscos se for mal liderada',
    plano: 'Plano de acompanhamento 30/60/90 dias',
    voceEEla: 'Você e esta pessoa'
  };

  // ------------------------------------------------------------------
  // Textos próprios deste modelo (o restante vem do DISC_LIDERANCA)
  // ------------------------------------------------------------------
  var porPerfil = {
    D: {
      comunicacao: {
        formato: 'comece pela conclusão e pela decisão necessária; detalhes só se {nome} pedir.',
        ritmo: 'rápido — conversas curtas, com pauta e fechamento claro.',
        canal: 'conversa direta (presencial ou chamada rápida) e mensagens curtas com o ponto principal na primeira linha.',
        evitar: 'rodeios, reuniões sem decisão e excesso de contexto.'
      },
      acompanhar: 'Acompanhe por marcos e resultados (ex.: checagem semanal de 15 minutos), não passo a passo.',
      feedback: {
        positivo: 'ligue o elogio a um resultado concreto — número, meta batida, problema resolvido.',
        exPositivo: 'Você destravou o projeto X em duas semanas; isso liberou o time para fechar a meta do mês.',
        corretivo: 'vá direto ao fato e ao impacto no resultado, e peça que {nome} proponha a solução.',
        exCorretivo: 'O prazo de X passou e isso atrasou Y. O que você propõe para recuperarmos até sexta?',
        momento: 'logo depois do fato, em conversa curta e reservada.',
        exCombinado: 'Seu ritmo puxa o time. No próximo projeto, quero que você ouça a equipe antes de fechar a decisão — uma rodada rápida de 10 minutos basta. Combinado?',
        evitar: 'rodeios, elogio e crítica misturados na mesma frase e comentários vagos sem exemplo.'
      },
      precisa: [
        'Clareza sobre o objetivo e sobre até onde vai a autonomia de {nome}.',
        'Desafios reais e liberdade para decidir o "como".',
        'Respostas rápidas quando uma decisão depende da liderança.',
        'Conversas francas, em que discordar seja bem-vindo.'
      ],
      evita: [
        'Tarefas repetitivas e sem desafio — tende a adiá-las ou fazê-las no automático.',
        'Reuniões longas sem decisão e etapas que parecem não levar a nada.',
        'Pedir ajuda cedo: costuma tentar resolver por conta própria antes de envolver alguém.',
        'Situações em que depende de muitas aprovações ou perde o controle do resultado.'
      ],
      motiva: [
        'Desafios novos, metas ousadas e problemas difíceis para resolver.',
        'Autonomia para decidir o "como" e perspectiva de mais responsabilidade.'
      ],
      cobrar: [
        'Cobre pelo número e pelo prazo, de forma direta e curta.',
        'Combine a meta e deixe {nome} dizer como vai chegar lá.',
        'Em atraso, vá ao fato e peça um plano de recuperação com data.'
      ],
      tarefas: 'Tarefas que pedem decisão rápida, metas desafiadoras, problemas a destravar e projetos novos.',
      riscos: [
        'Se for microgerenciada, tende a perder o engajamento ou a disputar espaço com a liderança.',
        'Sem limites claros de autoridade, pode passar por cima de processos e de pessoas.',
        'Sem desafio por muito tempo, tende a se desinteressar da função.'
      ],
      d60: [
        'Amplie a autonomia: entregue um projeto com meta própria e limites de decisão claros.',
        'Combine com {nome} o tom esperado ao cobrar e discordar com a equipe.'
      ],
      d90: [
        'Revise resultados contra as metas combinadas e defina o próximo desafio.',
        'Pergunte o que está travando a velocidade de {nome} e o que você, como líder, pode remover.'
      ]
    },
    I: {
      comunicacao: {
        formato: 'comece pela visão geral e pelo impacto nas pessoas; os detalhes vão por escrito depois.',
        ritmo: 'dinâmico e interativo — deixe espaço para troca de ideias.',
        canal: 'presencial ou chamada, seguida de um resumo escrito curto com os combinados.',
        evitar: 'frieza, textos longos como único canal e crítica na frente dos outros.'
      },
      acompanhar: 'Faça check-ins curtos e frequentes (2 a 3 por semana no início), com prazos intermediários por escrito.',
      feedback: {
        positivo: 'elogie de forma visível e cite o impacto do trabalho nas pessoas.',
        exPositivo: 'A forma como você conduziu a reunião com o cliente deixou todo mundo mais confiante. Obrigado(a)!',
        corretivo: 'comece pelo vínculo, seja claro(a) sobre o ponto a mudar e registre o combinado.',
        exCorretivo: 'Gosto muito da energia que você traz. Preciso que o relatório X saia até quinta — o que você precisa para isso acontecer?',
        momento: 'elogios em público e correções em particular, logo depois do fato, sem deixar acumular.',
        exCombinado: 'Suas ideias movimentam o time. Para que virem resultado, vamos escolher uma por mês e definir prazo e responsável. Qual você quer começar?',
        evitar: 'crítica na frente dos outros, tom frio e conversas que terminam sem um combinado claro.'
      },
      precisa: [
        'Contato frequente com pessoas e abertura para propor ideias.',
        'Reconhecimento visível e retorno rápido sobre o que fez.',
        'Apoio para organizar prazos e prioridades, de preferência combinados por escrito.',
        'Variedade de tarefas e algum espaço para criar.'
      ],
      evita: [
        'Trabalho isolado, por muito tempo, sem interação.',
        'Conversas que possam estremecer a relação — pode adiar uma crítica ou um "não".',
        'Tarefas de controle e conferência minuciosa, como registros longos.',
        'Ambientes em que só se fala de números e de falhas.'
      ],
      motiva: [
        'Contato com pessoas, espaço para propor ideias e um clima leve.',
        'Reconhecimento visível e oportunidades de representar a equipe.'
      ],
      cobrar: [
        'Registre por escrito o que foi prometido, com data, e retome nos check-ins.',
        'Cobre com leveza, mas sem deixar o assunto se perder na conversa.',
        'Divida entregas grandes em marcos curtos e visíveis.'
      ],
      tarefas: 'Tarefas com pessoas: apresentar, articular, negociar, integrar equipes e atender.',
      riscos: [
        'Sem acompanhamento de prazos, entregas podem ficar pela metade.',
        'Com frieza ou crítica pública, a motivação cai rápido.',
        'Isolada em tarefas solitárias e repetitivas, tende a se dispersar e perder energia.'
      ],
      d60: [
        'Dê uma responsabilidade de articulação (cliente, outra área, integração) com marcos escritos.',
        'Revise se os combinados estão sendo concluídos e ajuste a organização da agenda.'
      ],
      d90: [
        'Conversa de reconhecimento + balanço de entregas concluídas versus iniciadas.',
        'Defina com {nome} uma meta de organização (ex.: prazos cumpridos) para o próximo trimestre.'
      ]
    },
    S: {
      comunicacao: {
        formato: 'contexto, motivo e passo a passo; confirme o entendimento no final.',
        ritmo: 'calmo e sem pressa; avise mudanças com antecedência.',
        canal: 'conversa individual, com material escrito para consulta depois.',
        evitar: 'mudanças de última hora, tom ríspido e tomar silêncio por concordância.'
      },
      acompanhar: 'Mantenha uma conversa individual fixa (semanal) e deixe claro que dúvidas são bem-vindas a qualquer momento.',
      feedback: {
        positivo: 'reconheça a constância e a ajuda ao time, de forma sincera e em particular.',
        exPositivo: 'Percebi o cuidado que você teve com X nas últimas semanas. Isso faz muita diferença para o time.',
        corretivo: 'em particular e com tom calmo, deixe claro que a relação não está em risco e combine um passo a passo.',
        exCorretivo: 'Está tudo bem entre nós; quero ajustar um ponto: em X, preciso que Y. Vamos combinar juntos como fazer?',
        momento: 'em particular, sem pressa; avise o assunto ao marcar a conversa, para não gerar apreensão.',
        exCombinado: 'Você é quem o time procura quando precisa de ajuda. Quero que você também me avise quando estiver com coisa demais — assim consigo redistribuir. Podemos combinar isso?',
        evitar: 'tom ríspido, feedback na frente do time e pedidos de mudança sem explicar o porquê.'
      },
      precisa: [
        'Previsibilidade: saber com antecedência o que vai mudar e por quê.',
        'Papel claro e uma referência definida a quem recorrer.',
        'Tempo para aprender o novo passo a passo.',
        'Sentir que faz parte do time e que o próprio trabalho é valorizado.'
      ],
      evita: [
        'Conflitos abertos — tende a ceder ou a guardar o incômodo para manter o clima.',
        'Mudanças bruscas e decisões sem explicação.',
        'Dizer "não" a pedidos, mesmo com a agenda cheia.',
        'Exposição e pressão por respostas imediatas.'
      ],
      motiva: [
        'Segurança — clareza do papel, rotina previsível e equipe estável.',
        'Sentir que ajuda as pessoas e que o próprio trabalho sustenta o time.'
      ],
      cobrar: [
        'Deixe claro o que é prioridade e o que pode esperar — {nome} tende a abraçar tudo.',
        'Cobre em particular, com tom calmo, mostrando o impacto no time.',
        'Pergunte o que está travando: pode haver um obstáculo que ainda não foi dito.'
      ],
      tarefas: 'Tarefas de continuidade: processos recorrentes, suporte, atendimento e rotinas que pedem cuidado e constância.',
      riscos: [
        'Com mudanças bruscas e sem explicação, pode resistir em silêncio e perder a confiança.',
        'Se ninguém perguntar, pode acumular sobrecarga e incômodos até se desmotivar.',
        'Sob cobrança agressiva, tende a se retrair e deixar de trazer problemas cedo.'
      ],
      d60: [
        'Amplie responsabilidades uma de cada vez, com uma referência clara de a quem recorrer.',
        'Peça a opinião de {nome} sobre um processo da área e estimule propor melhorias.'
      ],
      d90: [
        'Conversa individual: como se sente, o que falta para ter segurança e o que mudaria.',
        'Combine um pequeno desafio fora da rotina, com apoio, para exercitar a adaptação.'
      ]
    },
    C: {
      comunicacao: {
        formato: 'dados, critérios e lógica, em material organizado e completo.',
        ritmo: 'dê tempo para análise antes de pedir uma posição.',
        canal: 'por escrito (e-mail, documento) antes da conversa; reuniões com pauta.',
        evitar: 'pedidos vagos, opinião sem embasamento e pressão por resposta imediata.'
      },
      acompanhar: 'Combine antes o critério de "pronto" e revise por entregas parciais; acompanhe mais o prazo do que o método.',
      feedback: {
        positivo: 'seja específico(a) sobre a qualidade técnica, com um exemplo concreto.',
        exPositivo: 'A análise de X estava completa e sem erros — usei direto na reunião com a diretoria.',
        corretivo: 'baseie-se em fatos verificáveis, separe o trabalho da pessoa e dê tempo para {nome} voltar com um plano.',
        exCorretivo: 'No relatório X, os itens 3 e 5 ficaram fora do padrão combinado. Como podemos evitar isso nas próximas entregas?',
        momento: 'com os dados em mãos, pauta avisada antes e tempo para {nome} responder depois, se preferir.',
        exCombinado: 'Sua revisão evita retrabalho. Nas entregas internas, o nível de detalhe pode ser menor: vamos definir juntos o que é essencial e o que pode ficar para depois?',
        evitar: 'generalizações ("sempre", "nunca"), opiniões sem exemplo e correções na frente de outras pessoas.'
      },
      precisa: [
        'Informação completa e critérios claros de qualidade e de "pronto".',
        'Tempo para analisar antes de decidir ou se posicionar.',
        'Processos organizados e regras que valham para todos.',
        'Espaço para aprofundar o conhecimento técnico.'
      ],
      evita: [
        'Errar na frente dos outros — por isso pode revisar demais antes de entregar.',
        'Decisões no improviso, sem dados que as sustentem.',
        'Situações ambíguas, com responsabilidades e expectativas pouco definidas.',
        'Exposição social intensa e conversas mais pessoais do que objetivas.'
      ],
      motiva: [
        'Padrões claros, tempo para fazer bem feito e autonomia técnica.',
        'Decisões baseadas em dados e espaço para se especializar.'
      ],
      cobrar: [
        'Defina antes o que é "bom o suficiente" e o prazo, para evitar perfeccionismo.',
        'Cobre com base em critérios e indicadores combinados, não em impressões.',
        'Se o prazo apertar, decida junto o que pode ser simplificado.'
      ],
      tarefas: 'Tarefas analíticas e técnicas: controle, revisão, qualidade, documentação e melhoria de processos.',
      riscos: [
        'Com pedidos vagos e mudanças constantes, tende a travar ou refazer o trabalho.',
        'Pressionada a decidir sem dados, pode ficar defensiva e mais crítica.',
        'Sem critério de "pronto", pode se aprofundar demais nos detalhes e perder prazos.'
      ],
      d60: [
        'Dê autonomia técnica em uma entrega maior, com padrão e prazo combinados.',
        'Combine o nível de detalhe adequado para cada tipo de tarefa.'
      ],
      d90: [
        'Revisão com dados: qualidade, prazos e dúvidas pendentes.',
        'Envolva {nome} em uma decisão de melhoria de processo ou de controle de risco da área.'
      ]
    }
  };

  // Ajustes do líder: estilo primário do líder + estilo primário da pessoa.
  var AJUSTES = {
    DD: ['Dois estilos diretos: combinem quem decide o quê, para evitar disputa de espaço.',
      'Discorde em particular e com argumentos; deixe {nome} conduzir algumas decisões.'],
    DI: ['Você tende a ir direto ao ponto; reserve alguns minutos para conversa e vínculo antes do assunto.',
      'Seu foco é o resultado; {nome} também precisa de reconhecimento visível — elogie na frente do time.'],
    DS: ['Desacelere: seu ritmo rápido e seu tom firme podem soar como pressão para {nome}.',
      'Avise mudanças com antecedência e explique o porquê, mesmo quando para você parecer óbvio.',
      'Não tome silêncio por concordância: pergunte diretamente, e em particular, o que {nome} pensa.'],
    DC: ['Antes de pedir uma decisão, entregue os dados e dê um tempo para análise.',
      'Ao cobrar rapidez, definam juntos o que é "bom o suficiente".',
      'Explique a lógica das suas decisões; ordens sem justificativa geram resistência.'],
    ID: ['Seja mais objetivo(a): leve conclusões e decisões, com menos conversa.',
      'Cumpra e registre o que combinar — {nome} valoriza coerência entre o que se fala e o que se entrega.'],
    II: ['Vocês dois se animam com ideias: definam juntos prazos e responsáveis por escrito.',
      'Cuide para que a afinidade não substitua a cobrança de entregas.'],
    IS: ['Modere a intensidade: dê espaço para {nome} falar e tempo para responder.',
      'Evite mudar de ideia com frequência; {nome} precisa de previsibilidade.'],
    IC: ['Leve dados e detalhes, não só entusiasmo; {nome} confia em fatos.',
      'Envie os combinados por escrito e evite mudanças de última hora.',
      'Reconheça de forma discreta e específica, sem celebração pública exagerada.'],
    SD: ['Seja mais direto(a) e rápido(a) do que costuma: {nome} prefere ir ao ponto.',
      'Dê autonomia e desafios; proteger demais pode soar como falta de confiança.',
      'Não fuja do conflito: {nome} respeita quem se posiciona com firmeza.'],
    SI: ['Dê mais visibilidade e reconhecimento público do que é natural para você.',
      'Aceite um ritmo mais dinâmico e ideias novas, mas cobre os prazos combinados.'],
    SS: ['Vocês têm ritmo parecido: cuidado para não adiarem juntos as conversas difíceis.',
      'Estimule em {nome} (e em você) a iniciativa e a adaptação a mudanças.'],
    SC: ['Vocês se entendem na calma e na previsibilidade; cuidado para não travarem decisões por excesso de cautela.',
      'Combinem prazos claros para decidir.'],
    CD: ['Vá mais direto ao ponto: resumo e decisão primeiro, detalhes se {nome} pedir.',
      'Dê autonomia no "como"; excesso de regra e de revisão tende a incomodar.',
      'Aceite riscos calculados e decisões rápidas quando o prazo exigir.'],
    CI: ['Seja mais próximo(a) e informal; a relação importa para {nome}.',
      'Não corrija cada detalhe na frente dos outros; priorize o essencial e fale em particular.',
      'Reconheça entusiasmo e iniciativa, não só a precisão.'],
    CS: ['Vocês compartilham cuidado e método; acrescente proximidade e reconhecimento pessoal.',
      'Cuide para que a crítica técnica não soe como crítica à pessoa.'],
    CC: ['Estilos parecidos: combinem um prazo para decidir, para que a análise não se estenda demais.',
      'Cuidem juntos da comunicação com o resto da equipe, que pode precisar de mais proximidade.']
  };

  // Diferença grande num mesmo fator ({L} = % do líder, {P} = % da pessoa).
  var DIFERENCA = {
    D: {
      liderMais: 'Você tem bem mais Dominância ({L}) que {nome} ({P}): o que para você é objetividade pode soar como pressão. Suavize o tom e explique o porquê.',
      pessoaMais: '{nome} tem bem mais Dominância ({P}) que você ({L}): espere iniciativa e questionamentos diretos; não leve para o lado pessoal e deixe claros os limites de decisão.'
    },
    I: {
      liderMais: 'Você tem bem mais Influência ({L}) que {nome} ({P}): menos conversa e mais objetividade tendem a funcionar melhor; registre os combinados.',
      pessoaMais: '{nome} tem bem mais Influência ({P}) que você ({L}): reserve tempo para interação e reconhecimento, mesmo que para você pareça dispensável.'
    },
    S: {
      liderMais: 'Você tem bem mais Estabilidade ({L}) que {nome} ({P}): {nome} pode querer mais velocidade e variedade do que você costuma oferecer.',
      pessoaMais: '{nome} tem bem mais Estabilidade ({P}) que você ({L}): antecipe mudanças e mantenha um ritmo previsível; o seu pode parecer acelerado.'
    },
    C: {
      liderMais: 'Você tem bem mais Conformidade ({L}) que {nome} ({P}): evite exigir o mesmo nível de detalhe em tudo; combine o que é essencial.',
      pessoaMais: '{nome} tem bem mais Conformidade ({P}) que você ({L}): espere pedidos de dados e critérios; documente e justifique suas decisões.'
    }
  };

  // ------------------------------------------------------------------
  // Dependências (browser: globais; Node: require)
  // ------------------------------------------------------------------
  function dep(global, arquivo) {
    if (root && root[global]) return root[global];
    if (typeof require === 'function') {
      try { return require(arquivo); } catch (e) { /* ausente */ }
    }
    return null;
  }

  // ------------------------------------------------------------------
  // Utilitários
  // ------------------------------------------------------------------
  function texto(v) { return v === null || v === undefined ? '' : String(v); }
  function maiuscula(s) { s = texto(s); return s.charAt(0).toUpperCase() + s.slice(1); }

  // "Ana Paula Souza" -> "Ana P."; "fábio" -> "Fábio". Nunca o nome completo.
  function nomeExibicao(nome) {
    var partes = texto(nome).replace(/\(.*?\)/g, ' ').replace(/[^\s\wÀ-ÿ'-]/g, ' ').split(/\s+/)
      .filter(function (p) { return p; });
    if (!partes.length) return '';
    var primeiro = maiuscula(partes[0].toLowerCase());
    for (var i = 1; i < partes.length; i++) {
      if (!PARTICULAS[partes[i].toLowerCase()]) return primeiro + ' ' + partes[i].charAt(0).toUpperCase() + '.';
    }
    return primeiro;
  }

  function fmtPct(n) {
    n = Number(n) || 0;
    return (Math.round(n * 10) / 10).toString().replace('.', ',') + '%';
  }

  function lerPercentuais(pct) {
    pct = pct || {};
    var p = {}, soma = 0;
    LETRAS.forEach(function (l) {
      var v = Number(pct[l]);
      p[l] = isFinite(v) && v > 0 ? Math.round(v * 10) / 10 : 0;
      soma += p[l];
    });
    return soma > 0 ? p : null;
  }

  // Ordem decrescente, empate desfeito pela ordem D, I, S, C (determinístico).
  function ordenar(p) {
    return LETRAS.slice().sort(function (a, b) {
      return (p[b] - p[a]) || (LETRAS.indexOf(a) - LETRAS.indexOf(b));
    });
  }

  function analisar(percentuais, codigo) {
    var p = lerPercentuais(percentuais) || { D: 25, I: 25, S: 25, C: 25 };
    var ordem = ordenar(p);
    var cod = texto(codigo).toUpperCase().replace(/[^DISC]/g, '');
    var prim = ordem[0], sec = ordem[1];
    if (cod.length >= 2 && cod[0] !== cod[1]) { prim = cod[0]; sec = cod[1]; }
    var valores = LETRAS.map(function (l) { return p[l]; });
    var amplitude = Math.max.apply(null, valores) - Math.min.apply(null, valores);
    var equilibrado = amplitude < LIMIAR_EQUILIBRADO;
    var intensidade = {};
    LETRAS.forEach(function (l) {
      intensidade[l] = p[l] >= LIMIAR_INTENSO ? 'alta' : p[l] >= MEDIA ? 'acima da média' : p[l] >= LIMIAR_BAIXO ? 'abaixo da média' : 'baixa';
    });
    return {
      percentuais: p, ordem: ordem, primario: prim, secundario: sec, codigo: prim + sec,
      equilibrado: equilibrado, intenso: !equilibrado && p[prim] >= LIMIAR_INTENSO,
      intensidade: intensidade, amplitude: amplitude
    };
  }

  function addUnico(lista, item) {
    if (item && lista.indexOf(item) === -1) lista.push(item);
  }

  function primeiros(lista, n) { return (lista || []).slice(0, n); }

  // ------------------------------------------------------------------
  // Montagem
  // ------------------------------------------------------------------
  function montar(resultado, pessoa) {
    resultado = resultado || {};
    pessoa = pessoa || {};
    var LID = dep('DISC_LIDERANCA', './lideranca.js');
    var DADOS = dep('DISC_DATA', './disc-data.js');
    var perfis = (DADOS && DADOS.perfis) || {};
    function nomeFator(l) { return (perfis[l] && perfis[l].nome) || NOMES_PADRAO[l]; }

    var a = analisar(resultado.percentuais, resultado.codigo);
    var prim = a.primario, sec = a.secundario, p = a.percentuais;
    var nome = nomeExibicao(pessoa.nome) || 'Colaborador(a)';
    var cargo = texto(pessoa.cargo).trim();
    var T = porPerfil[prim];
    var Tsec = porPerfil[sec];
    function nm(s) { return texto(s).replace(/\{nome\}/g, nome).replace(/( [A-ZÀ-Ý]\.)\./g, '$1'); }

    // Guia para a Liderança (mesclagem primário + secundário + combinação + intensidade).
    // O marcador '{nome}' passa intacto por gerarGuia e é trocado aqui pelo nome exibido.
    var guia = {};
    CHAVES_GUIA.forEach(function (k) { guia[k] = []; });
    var combo = null;
    if (LID && typeof LID.gerarGuia === 'function') {
      var g = LID.gerarGuia({ percentuais: p, ordem: a.ordem, primario: prim, secundario: sec, codigo: a.codigo }, '{nome}');
      (g.secoes || []).forEach(function (s, i) { if (CHAVES_GUIA[i]) guia[CHAVES_GUIA[i]] = (s.itens || []).slice(); });
      combo = (LID.combinacoes && LID.combinacoes[a.codigo]) || null;
    }
    var estilo = a.equilibrado ? 'Perfil equilibrado' : (combo ? combo.nome : nomeFator(prim));

    // ---- Resumo (3 frases) ----
    var resumoBase = (LID && LID.porPerfil && LID.porPerfil[prim] && LID.porPerfil[prim].resumo) || '';
    var frase3 = 'Perfil ' + a.codigo + ' (' + estilo + '): ' + nomeFator(prim) + ' ' + fmtPct(p[prim]) +
      ' como traço principal e ' + nomeFator(sec) + ' ' + fmtPct(p[sec]) + ' como secundário';
    if (a.equilibrado) frase3 += ' — resultado equilibrado, então confirme na prática como ' + nome + ' age no dia a dia.';
    else if (a.intenso) frase3 += ' — traço principal acentuado (média ' + MEDIA + '%), então as características abaixo tendem a aparecer com mais força.';
    else frase3 += '.';
    var resumo = nm(resumoBase) + ' ' + frase3;

    var secoes = [];
    function secao(chave, itens, extra) {
      var s = { chave: chave, titulo: TITULOS[chave], itens: itens.map(nm) };
      if (extra) Object.keys(extra).forEach(function (k) { s[k] = extra[k]; });
      secoes.push(s);
      return s;
    }

    // ---- Comunicação ----
    var com = T.comunicacao;
    var itensCom = [
      'Formato: ' + com.formato,
      'Ritmo: ' + com.ritmo,
      'Canal: ' + com.canal,
      'Evite: ' + com.evitar
    ];
    if (!a.equilibrado && sec !== prim && p[sec] >= MEDIA) {
      itensCom.push('Pelo traço secundário (' + nomeFator(sec) + ', ' + fmtPct(p[sec]) + '), ajuste também: ' + Tsec.comunicacao.formato);
    }
    primeiros(guia.comunicar, 2).forEach(function (t) { addUnico(itensCom, t); });
    secao('comunicacao', itensCom);

    // ---- Delegar e acompanhar ----
    var itensDel = primeiros(guia.delegar, 4);
    addUnico(itensDel, T.acompanhar);
    secao('delegar', itensDel);

    // ---- Feedback ----
    var fb = T.feedback;
    var itensFb = [
      'Positivo: ' + fb.positivo,
      'Exemplo de frase (positivo): “' + fb.exPositivo + '”',
      'Corretivo: ' + fb.corretivo,
      'Exemplo de frase (corretivo): “' + fb.exCorretivo + '”'
    ];
    itensFb.push('Momento: ' + fb.momento);
    itensFb.push('Exemplo de frase (combinado de mudança): “' + fb.exCombinado + '”');
    itensFb.push('Evite no feedback: ' + fb.evitar);
    primeiros(guia.feedback, 2).forEach(function (t) { addUnico(itensFb, t); });
    secao('feedback', itensFb);

    // ---- Motiva / desmotiva ----
    var itensMot = T.motiva.map(function (t) { return 'Motiva: ' + t; });
    if (!a.equilibrado && sec !== prim) addUnico(itensMot, 'Motiva (traço secundário): ' + Tsec.motiva[0]);
    primeiros(guia.evitar, 4).forEach(function (t) { addUnico(itensMot, 'Desmotiva: ' + t); });
    secao('motivacao', itensMot);

    // ---- Do que precisa / o que tende a evitar ----
    var itensPrecisa = T.precisa.slice();
    var itensEvita = T.evita.slice();
    if (!a.equilibrado && sec !== prim && p[sec] >= MEDIA) {
      addUnico(itensPrecisa, 'Pelo traço secundário (' + nomeFator(sec) + '): ' + Tsec.precisa[0].charAt(0).toLowerCase() + Tsec.precisa[0].slice(1));
      addUnico(itensEvita, 'Pelo traço secundário (' + nomeFator(sec) + '): ' + Tsec.evita[0].charAt(0).toLowerCase() + Tsec.evita[0].slice(1));
    }
    if (a.equilibrado) itensPrecisa.push('Resultado equilibrado: pergunte diretamente a {nome} do que precisa para render bem — as preferências podem variar conforme a situação.');
    secao('precisa', itensPrecisa);
    secao('evita', itensEvita);

    // ---- Cobrar resultado ----
    secao('cobrar', T.cobrar.slice());

    // ---- Estresse ----
    secao('estresse', guia.estresse.slice());

    // ---- Reconhecer ----
    secao('reconhecer', primeiros(guia.motivar, 5));

    // ---- Onde rende mais ----
    var itensRende = [T.tarefas];
    guia.ambiente.forEach(function (t) { addUnico(itensRende, t); });
    var baixo = a.ordem[3];
    if (!a.equilibrado && p[baixo] < LIMIAR_BAIXO && LID && LID.porPerfil[baixo]) {
      addUnico(itensRende, 'Fator menos presente: ' + nomeFator(baixo) + ' (' + fmtPct(p[baixo]) + '). Tarefas que exigem ' +
        LID.porPerfil[baixo].comportamentos + ' tendem a pedir mais energia de {nome}; dê apoio ou combine com alguém do time.');
    }
    secao('rendeMais', itensRende);

    // ---- Esforço de adaptação ao cargo (só com a Parte 2) ----
    var adaptacao = null;
    var EX = pessoa.exigido ? dep('DISC_EXIGIDO', './disc-exigido.js') : null;
    if (EX) {
      var ad = EX.adaptacao(p, pessoa.exigido, { nome: nome });
      var pe = null;
      if (typeof pessoa.exigido === 'string' && EX.validar(pessoa.exigido)) pe = EX.calcular(pessoa.exigido);
      else if (pessoa.exigido && typeof pessoa.exigido === 'object') pe = analisar(pessoa.exigido.percentuais || pessoa.exigido, pessoa.exigido.codigo);
      if (ad && pe) {
        adaptacao = {
          indice: ad.indice, faixa: ad.faixa, rotulo: ad.rotulo, maisCobrado: ad.maisCobrado, menosUsado: ad.menosUsado,
          porFator: ad.porFator, eixos: ad.eixos,
          exigido: { percentuais: lerPercentuais(pe.percentuais), codigo: pe.codigo }
        };
        var itensEsf = [
          'Índice de esforço de adaptação: ' + ad.indice + ' de 100 (' + ad.rotulo.toLowerCase() + '). Estilo natural ' + a.codigo +
            '; estilo que {nome} percebe que o cargo pede: ' + pe.codigo + '.'
        ];
        ad.textos.lider.forEach(function (t) { itensEsf.push(t); });
        secao('esforco', itensEsf);
      }
    }

    // ---- Riscos se mal liderada ----
    var itensRisco = T.riscos.slice();
    if (a.intenso) itensRisco.push('Com ' + nomeFator(prim) + ' em ' + fmtPct(p[prim]) + ', esses riscos tendem a aparecer com mais força sob pressão.');
    if (a.equilibrado) itensRisco.push('Resultado equilibrado: os riscos acima são indicativos; observe o comportamento real nas primeiras semanas.');
    secao('riscos', itensRisco);

    // ---- Plano 30/60/90 ----
    var d30 = primeiros(guia.onboarding, 4);
    var d60 = T.d60.slice();
    if (adaptacao && (adaptacao.faixa === 'alta' || adaptacao.faixa === 'muito_alta')) {
      d60.push('Revise com {nome} os pontos do cargo que pedem mais ajuste (veja "Esforço de adaptação ao cargo") e combine um apoio concreto para cada um.');
    }
    var etapas = [
      { periodo: 'Até 30 dias', itens: d30.map(nm) },
      { periodo: '31 a 60 dias', itens: d60.map(nm) },
      { periodo: '61 a 90 dias', itens: T.d90.map(nm) }
    ];
    var itensPlano = [];
    etapas.forEach(function (e) { e.itens.forEach(function (t) { itensPlano.push(e.periodo + ': ' + t); }); });
    secao('plano', itensPlano, { etapas: etapas });

    // ---- Você e esta pessoa (só com percentuais do líder) ----
    var lider = null;
    var lp = pessoa.lider && lerPercentuais(pessoa.lider.percentuais);
    if (lp) {
      var la = analisar(lp, null);
      lider = { nome: nomeExibicao(pessoa.lider.nome), codigo: la.codigo, percentuais: la.percentuais };
      var itensVoce = [
        'Seu estilo: ' + la.codigo + ' (' + nomeFator(la.primario) + ' ' + fmtPct(lp[la.primario]) + '). Estilo de ' + nome + ': ' +
          a.codigo + ' (' + nomeFator(prim) + ' ' + fmtPct(p[prim]) + ').'
      ];
      (AJUSTES[la.primario + prim] || []).forEach(function (t) { itensVoce.push(t); });
      LETRAS.forEach(function (l) {
        var dif = lp[l] - p[l];
        if (Math.abs(dif) < LIMIAR_DIFERENCA) return;
        var modelo = dif > 0 ? DIFERENCA[l].liderMais : DIFERENCA[l].pessoaMais;
        itensVoce.push(modelo.replace('{L}', fmtPct(lp[l])).replace('{P}', fmtPct(p[l])));
      });
      secao('voceEEla', itensVoce);
    }

    var titulo = 'Como liderar ' + nome + (cargo ? ' — ' + cargo : '') + ' (' + a.codigo + ' · ' + estilo + ')';
    return {
      modelo: 'empresa-individual',
      versao: VERSAO,
      titulo: titulo,
      pessoa: {
        nome: nome,
        cargo: cargo,
        codigo: a.codigo,
        primario: prim,
        secundario: sec,
        estilo: estilo,
        percentuais: p,
        intensidade: a.intensidade,
        equilibrado: a.equilibrado,
        intenso: a.intenso
      },
      lider: lider,
      adaptacao: adaptacao,
      resumo: resumo,
      secoes: secoes,
      aviso: AVISO
    };
  }

  // Texto puro (copiar / WhatsApp)
  function gerarTexto(dados) {
    if (!dados) return '';
    var linhas = ['*' + dados.titulo + '*', ''];
    if (dados.resumo) { linhas.push(dados.resumo); linhas.push(''); }
    (dados.secoes || []).forEach(function (s) {
      linhas.push('*' + s.titulo + '*');
      if (s.etapas && s.etapas.length) {
        s.etapas.forEach(function (e) {
          linhas.push('_' + e.periodo + '_');
          (e.itens || []).forEach(function (i) { linhas.push('• ' + i); });
        });
      } else {
        (s.itens || []).forEach(function (i) { linhas.push('• ' + i); });
      }
      linhas.push('');
    });
    linhas.push('_' + (dados.aviso || AVISO) + '_');
    return linhas.join('\n');
  }

  var DISC_RELATORIO_LIDERANCA = {
    VERSAO: VERSAO,
    AVISO: AVISO,
    TITULOS: TITULOS,
    porPerfil: porPerfil,
    AJUSTES: AJUSTES,
    nomeExibicao: nomeExibicao,
    montar: montar,
    gerarTexto: gerarTexto
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = DISC_RELATORIO_LIDERANCA;
  else root.DISC_RELATORIO_LIDERANCA = DISC_RELATORIO_LIDERANCA;
})(typeof self !== 'undefined' ? self : this);
