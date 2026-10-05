/*
 * Guia para a Liderança — transforma o resultado DISC de um candidato aprovado em
 * instruções práticas para o gestor direto (comunicação, delegação, motivação,
 * feedback, ambiente, estresse, PDI, o que evitar e onboarding de 30 dias).
 *
 * Entrada: resultado = DISC_SCORING.calcular(respostas)
 *   { percentuais: {D,I,S,C}, ordem: [...], primario, secundario, codigo }
 * Saída de gerarGuia: { titulo, resumo, secoes: [{ titulo, itens: [string] }], ... }
 *
 * Nos textos, "{nome}" é substituído pelo primeiro nome do candidato.
 */
(function (root) {
  var LETRAS = ['D', 'I', 'S', 'C'];
  var LIMIAR_EQUILIBRADO = 8;   // diferença (pontos percentuais) entre 1º e 4º
  var LIMIAR_INTENSO = 35;      // percentual do fator primário
  var MEDIA = 25;               // média de cada fator (os 4 somam 100%)

  var SECOES = [
    { chave: 'comunicar', titulo: 'Como se comunicar' },
    { chave: 'delegar', titulo: 'Como delegar tarefas' },
    { chave: 'motivar', titulo: 'Como motivar e reconhecer' },
    { chave: 'feedback', titulo: 'Como dar feedback' },
    { chave: 'ambiente', titulo: 'Ambiente em que rende mais' },
    { chave: 'estresse', titulo: 'Sinais de estresse e como agir' },
    { chave: 'pdi', titulo: 'Pontos de desenvolvimento (Plano de Desenvolvimento Individual – PDI)' },
    { chave: 'evitar', titulo: 'O que evitar' },
    { chave: 'onboarding', titulo: 'Primeiros 30 dias (onboarding)' }
  ];

  var AVISO = 'O DISC descreve o comportamento preferido da pessoa no trabalho — não mede capacidade, inteligência nem caráter. ' +
    'Use este guia como ponto de partida para a conversa, nunca como único critério de decisão.';

  // ------------------------------------------------------------------
  // Perfis puros
  // ------------------------------------------------------------------
  var porPerfil = {
    D: {
      estilo: 'Dominante — foco em resultado e desafio',
      resumo: '{nome} tende a ser direto(a), rápido(a) nas decisões e movido(a) por desafios e metas. Rende mais quando tem autonomia e clareza sobre o resultado esperado.',
      comunicar: [
        'Comece pela conclusão: {nome} quer saber o resultado e a decisão, não o histórico.',
        'Seja breve e objetivo; reuniões curtas, com pauta e decisão no final.',
        'Apresente opções com prós e contras e deixe {nome} participar da escolha.',
        'Discordâncias diretas são bem recebidas — fale com firmeza, sem rodeios e sem levar para o lado pessoal.'
      ],
      delegar: [
        'Delegue o "o quê" e o "até quando"; deixe o "como" com {nome}.',
        'Defina metas mensuráveis e limites claros de autoridade (o que pode decidir sozinho e o que precisa alinhar).',
        'Dê projetos desafiadores ou que precisem "destravar" algo parado.',
        'Combine pontos de controle curtos (marcos), não acompanhamento diário de cada passo.'
      ],
      motivar: [
        'Reconheça resultados concretos: números, metas batidas, problemas resolvidos.',
        'Ofereça novos desafios, mais responsabilidade e perspectiva de crescimento como recompensa.',
        'Dê visibilidade às conquistas diante da liderança superior.',
        'Competições saudáveis e metas ousadas costumam energizar.'
      ],
      feedback: [
        'Seja direto(a) e específico(a): fato, impacto no resultado, o que muda a partir de agora.',
        'Ligue o feedback a metas e resultados — é a linguagem que {nome} valoriza.',
        'Espere uma reação inicial defensiva ou argumentativa; mantenha a calma e volte aos fatos.',
        'Feche com um compromisso claro e prazo, e deixe {nome} propor a solução.'
      ],
      ambiente: [
        'Trabalho variado, com metas desafiadoras e espaço para tomar decisões.',
        'Pouca microgestão e pouca burocracia desnecessária.'
      ],
      estresse: [
        'Sinais: fica mais impaciente, ríspido(a), centralizador(a) e passa por cima das pessoas.',
        'Como agir: converse em particular, reconheça a urgência e redirecione o foco para o objetivo comum.',
        'Ajude a priorizar: tire tarefas de baixo impacto e esclareça o que é realmente crítico.'
      ],
      pdi: [
        'Escuta ativa e empatia: praticar perguntar antes de decidir.',
        'Paciência com ritmos diferentes do seu e com processos necessários.',
        'Delegação real: confiar a execução a outros sem retomar o controle.'
      ],
      evitar: [
        'Microgerenciar ou exigir aprovação para cada pequeno passo.',
        'Rodeios, reuniões longas sem decisão e excesso de detalhes irrelevantes.',
        'Disputas de poder em público — divergências fortes, trate a portas fechadas.',
        'Tarefas repetitivas por longos períodos sem nenhum desafio.'
      ],
      onboarding: [
        'Semana 1: apresente metas da área, indicadores e o que se espera em 30/60/90 dias.',
        'Semana 2: entregue um primeiro desafio real com começo, meio e fim.',
        'Semana 3: deixe claro quem são os parceiros-chave e combine regras de convivência e de decisão.',
        'Dia 30: conversa objetiva de resultados — o que entregou, o que travou e o próximo desafio.'
      ],
      // Pontos de atenção em linguagem neutra e comportamental (usados no PDI).
      atencao: [
        'Pode soar impositivo(a) ao cobrar ou discordar; combine com {nome} o tom esperado com a equipe.',
        'Tende a decidir rápido e aceitar riscos altos; peça que mostre quais riscos considerou antes de agir.'
      ],
      // Como é agir no estilo deste perfil (usado quando ele é o fator mais baixo).
      comportamentos: 'tomar decisões com mais rapidez e se posicionar com firmeza quando necessário'
    },
    I: {
      estilo: 'Influente — foco em pessoas e entusiasmo',
      resumo: '{nome} tende a ser comunicativo(a), otimista e persuasivo(a). Rende mais quando se relaciona com pessoas, recebe reconhecimento e tem liberdade para propor ideias.',
      comunicar: [
        'Reserve alguns minutos para conversa informal antes de entrar no assunto — a relação importa.',
        'Prefira conversas presenciais ou por chamada a longos textos.',
        'Mostre a visão geral e o impacto nas pessoas; depois combine os detalhes por escrito.',
        'Sempre registre os combinados (mensagem ou e-mail curto) após a conversa.'
      ],
      delegar: [
        'Delegue tarefas que envolvam pessoas: apresentações, articulação, atendimento, integração de equipes.',
        'Defina prazos intermediários e confira o andamento — o entusiasmo inicial pode se dispersar.',
        'Use checklists simples para as partes de detalhe e controle.',
        'Deixe {nome} trazer ideias, mas peça um plano mínimo antes de executar.'
      ],
      motivar: [
        'Reconheça em público: elogio na reunião, menção no grupo, agradecimento visível.',
        'Ofereça oportunidades de falar, representar a equipe e se relacionar.',
        'Crie um clima leve e colaborativo; celebrações de pequenas vitórias funcionam bem.',
        'Mostre o quanto o trabalho de {nome} impacta as pessoas.'
      ],
      feedback: [
        'Comece pelo vínculo e pelo que está indo bem — {nome} é sensível à rejeição.',
        'Seja claro(a) sobre o ponto a melhorar; não suavize tanto a ponto de a mensagem se perder.',
        'Peça para {nome} repetir com as próprias palavras o que foi combinado.',
        'Dê feedback de correção sempre em particular.'
      ],
      ambiente: [
        'Contato frequente com pessoas, trabalho em equipe e liberdade de movimento.',
        'Liderança acessível e democrática, com abertura para ideias.'
      ],
      estresse: [
        'Sinais: fala demais, promete mais do que entrega, fica disperso(a) ou usa ironia.',
        'Como agir: acolha primeiro, depois ajude a transformar o entusiasmo em um plano com prazos realistas.',
        'Reduza o isolamento: tarefas solitárias e só de detalhe por muito tempo esgotam esse perfil.'
      ],
      pdi: [
        'Organização e gestão do tempo (agenda, lista de prioridades, prazos).',
        'Concluir o que começou antes de abraçar novos projetos.',
        'Controle emocional e escuta: falar menos, ouvir mais em reuniões.'
      ],
      evitar: [
        'Críticas em público ou frieza no trato — afetam muito a motivação.',
        'Isolar {nome} em tarefas solitárias e repetitivas por muito tempo.',
        'Assumir que "entendeu" sem registrar por escrito o que foi combinado.',
        'Excesso de regras sem explicação do porquê.'
      ],
      onboarding: [
        'Semana 1: apresente {nome} pessoalmente à equipe e a parceiros de outras áreas.',
        'Semana 2: defina um "padrinho/madrinha" e um checklist simples das rotinas obrigatórias.',
        'Semana 3: dê uma tarefa com contato com pessoas e prazo curto, com acompanhamento.',
        'Dia 30: conversa de reconhecimento + alinhamento do que ainda precisa de mais organização.'
      ],
      // Pontos de atenção em linguagem neutra e comportamental (usados no PDI).
      atencao: [
        'Pode se comprometer com mais do que consegue entregar; acompanhe os prazos combinados.',
        'Tende a dividir a atenção entre muitas frentes; ajude {nome} a escolher as prioridades da semana.'
      ],
      // Como é agir no estilo deste perfil (usado quando ele é o fator mais baixo).
      comportamentos: 'se comunicar com mais abertura e se aproximar das pessoas da equipe'
    },
    S: {
      estilo: 'Estável — foco em cooperação e constância',
      resumo: '{nome} tende a ser calmo(a), leal, paciente e colaborativo(a). Rende mais com rotina clara, previsibilidade e um clima de confiança na equipe.',
      comunicar: [
        'Fale com calma e cordialidade; demonstre interesse genuíno por {nome}.',
        'Antecipe mudanças com antecedência e explique o porquê e o passo a passo.',
        'Faça perguntas abertas e dê tempo para resposta — {nome} pode não discordar em voz alta.',
        'Confirme o entendimento em conversas individuais, não apenas em reunião de grupo.'
      ],
      delegar: [
        'Explique o processo completo, com exemplos e a quem recorrer em caso de dúvida.',
        'Dê uma tarefa por vez, com prioridades explícitas.',
        'Delegue atividades de continuidade, suporte, atendimento e processos recorrentes.',
        'Combine acompanhamento regular e deixe a porta aberta para dúvidas.'
      ],
      motivar: [
        'Reconheça a constância, a confiabilidade e a ajuda que {nome} dá aos colegas.',
        'Prefira reconhecimento sincero e em particular ou em pequeno grupo.',
        'Ofereça segurança: clareza sobre o papel, estabilidade e relações de longo prazo.',
        'Mostre como o trabalho de {nome} contribui para o time.'
      ],
      feedback: [
        'Use um tom calmo e acolhedor, em particular; deixe claro que a relação não está em risco.',
        'Seja específico(a) e dê um passo a passo do que fazer diferente.',
        'Pergunte como {nome} se sente e o que precisa — pode guardar incômodos sem falar.',
        'Acompanhe depois: um retorno de "está melhorando" faz muita diferença.'
      ],
      ambiente: [
        'Ambiente previsível, com rotinas claras e pouco conflito entre as pessoas.',
        'Equipe estável, em que possa construir relações de confiança duradouras.'
      ],
      estresse: [
        'Sinais: fica calado(a), concorda com tudo, adia decisões, fica mais lento(a) ou resistente a mudanças.',
        'Como agir: abra espaço seguro para falar, pergunte diretamente o que está incomodando.',
        'Em mudanças, divida em etapas e dê tempo de adaptação com apoio próximo.'
      ],
      pdi: [
        'Assertividade: dizer "não", expor discordâncias e pedir ajuda.',
        'Adaptação a mudanças e tomada de decisão com prazo.',
        'Iniciativa: propor melhorias sem esperar ser solicitado(a).'
      ],
      evitar: [
        'Mudanças bruscas sem aviso ou explicação.',
        'Pressão excessiva, cobrança agressiva ou conflito em público.',
        'Interpretar silêncio como concordância.',
        'Sobrecarregar {nome} porque "nunca reclama".'
      ],
      onboarding: [
        'Semana 1: apresente a rotina, os processos e as pessoas com calma; entregue o material por escrito.',
        'Semana 2: acompanhe de perto com um colega de referência e tire dúvidas diariamente.',
        'Semana 3: aumente a autonomia gradualmente, uma responsabilidade por vez.',
        'Dia 30: conversa individual tranquila — pergunte como está se sentindo e o que falta para ficar seguro(a).'
      ],
      // Pontos de atenção em linguagem neutra e comportamental (usados no PDI).
      atencao: [
        'Pode evitar discordar ou dizer "não"; pergunte a opinião de {nome} de forma direta e em particular.',
        'Tende a precisar de mais tempo para se adaptar a mudanças; avise com antecedência e explique o porquê.'
      ],
      // Como é agir no estilo deste perfil (usado quando ele é o fator mais baixo).
      comportamentos: 'ter mais paciência, ouvir com atenção e manter a constância nas entregas'
    },
    C: {
      estilo: 'Conforme — foco em qualidade e precisão',
      resumo: '{nome} tende a ser analítico(a), organizado(a), criterioso(a) e atento(a) aos detalhes. Rende mais com padrões claros, informações completas e tempo para fazer bem feito.',
      comunicar: [
        'Traga dados, fatos e lógica; evite opiniões sem embasamento.',
        'Prefira comunicação escrita e organizada, com tempo para {nome} analisar.',
        'Responda às perguntas com paciência — questionar é a forma de {nome} garantir qualidade.',
        'Seja preciso(a) com prazos, números e critérios; mudanças de última hora precisam de justificativa.'
      ],
      delegar: [
        'Defina critérios de qualidade, padrões e o "pronto" de forma explícita.',
        'Delegue tarefas analíticas, técnicas, de controle, revisão e melhoria de processos.',
        'Combine o nível de detalhe necessário e o prazo — para evitar o perfeccionismo excessivo.',
        'Forneça documentação, acessos e informações antes de cobrar o início.'
      ],
      motivar: [
        'Reconheça a qualidade, a precisão e o cuidado técnico, com exemplos concretos.',
        'Dê autonomia técnica e oportunidade de se especializar.',
        'Valorize a opinião de {nome} em decisões que envolvem risco e qualidade.',
        'Prefira reconhecimento discreto e objetivo a celebrações expansivas.'
      ],
      feedback: [
        'Baseie-se em fatos e exemplos verificáveis; evite generalizações ("você sempre...").',
        'Separe a crítica do trabalho da crítica à pessoa — {nome} tende a ser duro(a) consigo.',
        'Dê tempo para {nome} processar e voltar com perguntas ou um plano.',
        'Combine indicadores objetivos para acompanhar a melhoria.'
      ],
      ambiente: [
        'Ambiente organizado, com processos e padrões claros e espaço para concentração.',
        'Equipe pequena e próxima, com valorização do pensamento crítico.'
      ],
      estresse: [
        'Sinais: fica mais crítico(a), fechado(a), pessimista, analisa demais e trava decisões.',
        'Como agir: dê informações claras, reduza a ambiguidade e defina o que é "bom o suficiente".',
        'Estabeleça prazo para a decisão e assuma junto o risco quando faltar informação.'
      ],
      pdi: [
        'Tomada de decisão com informação incompleta e prazo definido.',
        'Flexibilidade: aceitar o "bom o suficiente" quando o contexto exigir.',
        'Comunicação interpessoal: expor ideias e sentimentos com mais abertura.'
      ],
      evitar: [
        'Pedidos vagos, mudanças sem explicação e prazos irreais.',
        'Pressionar por decisões imediatas sem dados.',
        'Criticar em público ou de forma emocional.',
        'Interromper constantemente o foco com demandas fora de prioridade.'
      ],
      onboarding: [
        'Semana 1: entregue documentação, processos, padrões de qualidade e organograma.',
        'Semana 2: explique os critérios de avaliação do trabalho e os indicadores da área.',
        'Semana 3: dê uma tarefa técnica bem definida e combine o nível de detalhe esperado.',
        'Dia 30: revisão objetiva com dados — o que funcionou, dúvidas pendentes e próximos padrões a dominar.'
      ],
      // Pontos de atenção em linguagem neutra e comportamental (usados no PDI).
      atencao: [
        'Pode buscar informação demais antes de agir; combine um prazo para a decisão.',
        'Tende a receber críticas ao trabalho como algo pessoal; separe sempre o fato da pessoa.'
      ],
      // Como é agir no estilo deste perfil (usado quando ele é o fator mais baixo).
      comportamentos: 'planejar com antecedência, conferir detalhes e seguir os padrões combinados'
    }
  };

  // ------------------------------------------------------------------
  // Combinações primário + secundário
  // dicas: [secao, texto] — mescladas no topo da seção correspondente
  // ------------------------------------------------------------------
  var combinacoes = {
    DI: {
      nome: 'Realizador persuasivo',
      resumo: 'Combina foco em resultado com facilidade de convencer pessoas. Costuma liderar pelo entusiasmo e pela urgência, mobilizando a equipe em torno de metas.',
      dicas: [
        ['delegar', 'Dê metas ousadas que exijam mobilizar outras pessoas — é onde {nome} mais brilha.'],
        ['comunicar', 'Seja rápido(a) e energético(a); conversas longas e muito técnicas perdem a atenção.'],
        ['pdi', 'Trabalhar a consistência na execução: planejamento e acompanhamento dos detalhes.'],
        ['evitar', 'Deixar {nome} prometer prazos sem validar a capacidade da equipe.']
      ]
    },
    DS: {
      nome: 'Executor determinado',
      resumo: 'Une firmeza para buscar resultados com persistência e constância. Tende a ser determinado(a) e confiável, preferindo objetivos claros a mudanças constantes.',
      dicas: [
        ['delegar', 'Delegue metas claras de médio prazo; {nome} tende a ir até o fim com persistência.'],
        ['comunicar', 'Seja direto(a), mas avise com antecedência sobre mudanças de rumo.'],
        ['estresse', 'Sob pressão pode alternar entre impaciência e teimosia; ajude a revisar prioridades.'],
        ['pdi', 'Flexibilidade diante de mudanças e abertura a outros pontos de vista.']
      ]
    },
    DC: {
      nome: 'Estrategista exigente',
      resumo: 'Combina orientação a resultados com alto padrão de qualidade. Costuma ser exigente consigo e com os outros, decidindo com base em lógica e dados.',
      dicas: [
        ['comunicar', 'Traga números e argumentos lógicos — {nome} questiona decisões sem embasamento.'],
        ['delegar', 'Dê problemas complexos para resolver, com autonomia e critérios de qualidade claros.'],
        ['pdi', 'Diplomacia e tato: cuidar do tom ao cobrar e ao discordar.'],
        ['evitar', 'Improviso e falta de critério; e não deixe a cobrança de {nome} sobre a equipe correr sem mediação.']
      ]
    },
    ID: {
      nome: 'Persuasor ousado',
      resumo: 'Entusiasmo e carisma combinados com iniciativa. Costuma influenciar e abrir portas, assumindo riscos para fazer as coisas acontecerem.',
      dicas: [
        ['delegar', 'Funções de negociação, vendas, articulação e abertura de novos contatos.'],
        ['motivar', 'Reconhecimento público + metas desafiadoras é a combinação que mais motiva {nome}.'],
        ['pdi', 'Avaliar riscos e dados antes de agir; não decidir só pela intuição.'],
        ['evitar', 'Deixar sem acompanhamento de prazos e entregas intermediárias.']
      ]
    },
    IS: {
      nome: 'Conselheiro acolhedor',
      resumo: 'Comunicativo(a) e acolhedor(a), valoriza harmonia e boas relações. Costuma ser o "elo" da equipe, ouvindo e apoiando os colegas.',
      dicas: [
        ['delegar', 'Atendimento, integração de pessoas novas, suporte ao cliente e mediação.'],
        ['feedback', 'Seja gentil, mas claro(a): {nome} pode evitar conflito e não falar do que incomoda.'],
        ['pdi', 'Firmeza: dizer "não", cobrar colegas e lidar com conflitos de frente.'],
        ['estresse', 'Sob pressão tende a ceder demais para agradar; ajude a estabelecer limites.']
      ]
    },
    IC: {
      nome: 'Comunicador criterioso',
      resumo: 'Combina facilidade de comunicação com cuidado e atenção à qualidade. Costuma explicar bem assuntos técnicos e convencer com argumentos.',
      dicas: [
        ['delegar', 'Treinamentos, apresentações técnicas, documentação para clientes e padronização com pessoas.'],
        ['comunicar', 'Combine a conversa próxima com material de apoio organizado.'],
        ['estresse', 'Pode oscilar entre otimismo e autocrítica; dê retorno equilibrado e frequente.'],
        ['pdi', 'Decidir mais rápido quando houver conflito entre agradar e fazer "perfeito".']
      ]
    },
    SD: {
      nome: 'Realizador constante',
      resumo: 'Calmo(a) e persistente, mas com firmeza quando precisa entregar. Costuma ser confiável, trabalhando em ritmo constante até alcançar o objetivo.',
      dicas: [
        ['delegar', 'Responsabilidades contínuas com metas claras; {nome} entrega com consistência.'],
        ['comunicar', 'Combine previsibilidade com objetividade: explique o plano e o resultado esperado.'],
        ['estresse', 'Pode acumular incômodos em silêncio e reagir de forma firme de repente; faça check-ins regulares.'],
        ['pdi', 'Lidar com mudanças rápidas e expressar discordâncias mais cedo.']
      ]
    },
    SI: {
      nome: 'Colaborador harmonizador',
      resumo: 'Cooperativo(a), paciente e simpático(a). Costuma criar um clima agradável e apoiar os colegas, valorizando a convivência e a estabilidade.',
      dicas: [
        ['motivar', 'Valorize o espírito de equipe e a ajuda que {nome} dá aos outros.'],
        ['delegar', 'Funções de suporte, relacionamento com clientes recorrentes e acolhimento.'],
        ['pdi', 'Iniciativa e assertividade para defender as próprias ideias.'],
        ['evitar', 'Conflitos abertos e cobranças ríspidas — tendem a gerar retração.']
      ]
    },
    SC: {
      nome: 'Especialista confiável',
      resumo: 'Metódico(a), paciente e cuidadoso(a). Costuma seguir processos com precisão e ser a referência de confiabilidade na equipe.',
      dicas: [
        ['delegar', 'Processos recorrentes, controles, qualidade e rotinas que exigem cuidado.'],
        ['comunicar', 'Mudanças devem vir por escrito, com antecedência e passo a passo.'],
        ['pdi', 'Iniciativa, agilidade em decisões e conforto com o imprevisto.'],
        ['evitar', 'Mudanças repentinas de prioridade e pressão por improviso.']
      ]
    },
    CD: {
      nome: 'Analista decidido',
      resumo: 'Analítico(a) e exigente, mas sem medo de decidir quando os dados estão claros. Costuma buscar eficiência e qualidade ao mesmo tempo.',
      dicas: [
        ['delegar', 'Projetos de melhoria, auditoria, análise e implantação de processos com autonomia.'],
        ['feedback', 'Use dados e seja direto(a); {nome} respeita objetividade e argumentos sólidos.'],
        ['pdi', 'Empatia e flexibilidade ao lidar com quem tem padrões diferentes.'],
        ['estresse', 'Pode ficar crítico(a) e inflexível; peça soluções em vez de só apontamentos.']
      ]
    },
    CI: {
      nome: 'Avaliador comunicativo',
      resumo: 'Combina rigor e análise com habilidade de se relacionar. Costuma avaliar bem as situações e explicar suas conclusões de forma acessível.',
      dicas: [
        ['delegar', 'Análises que precisam ser apresentadas e "vendidas" para outras áreas.'],
        ['comunicar', 'Traga dados, mas dê espaço para troca de ideias e debate.'],
        ['motivar', 'Reconheça a qualidade técnica diante do grupo, com moderação.'],
        ['pdi', 'Equilibrar perfeccionismo com prazos e aceitar críticas sem se sentir atacado(a).']
      ]
    },
    CS: {
      nome: 'Perfeccionista estável',
      resumo: 'Cuidadoso(a), preciso(a) e consistente. Costuma valorizar procedimentos, estabilidade e entregas sem erro, preferindo ambientes previsíveis.',
      dicas: [
        ['delegar', 'Tarefas que exigem precisão, conferência, conformidade e documentação.'],
        ['comunicar', 'Dê instruções detalhadas por escrito e tempo para análise antes de decidir.'],
        ['estresse', 'Sob pressão pode se fechar e travar; reduza a incerteza e acompanhe de perto.'],
        ['pdi', 'Agilidade, tolerância a risco e comunicação mais aberta com a equipe.']
      ]
    }
  };

  // Conteúdo para perfil equilibrado/indefinido
  var equilibrado = {
    comunicar: ['O resultado ficou equilibrado: observe na prática se {nome} prefere conversas objetivas, informais, calmas ou detalhadas, e adapte.'],
    delegar: ['Teste diferentes tipos de tarefa nas primeiras semanas e observe onde {nome} entrega melhor.'],
    motivar: ['Pergunte diretamente a {nome} que tipo de reconhecimento valoriza mais.'],
    feedback: ['Combine com {nome} o formato de feedback preferido (direto, por escrito, em conversa individual).'],
    ambiente: ['Perfis equilibrados tendem a se adaptar a contextos variados, mas confirme isso na entrevista.'],
    estresse: ['Observe mudanças de comportamento em períodos de pressão e registre para ajustar este guia.'],
    pdi: ['Antes de definir o PDI, faça uma entrevista comportamental para identificar pontos fortes e gaps reais.'],
    evitar: ['Evite rotular {nome} por este resultado; ele é pouco conclusivo.'],
    onboarding: ['Dia 30: faça uma conversa estruturada para entender preferências de trabalho e completar este guia.']
  };

  // ------------------------------------------------------------------
  // Itens do perfil secundário que contradizem o primário.
  // Chave: letra do secundário + '.' + seção + '.' + índice; valor: primários com conflito.
  // ------------------------------------------------------------------
  var CONFLITOS_SECUNDARIO = {
    'I.motivar.0': ['C', 'S'],   // reconhecimento em público x discreto/em particular
    'I.motivar.2': ['C'],        // celebrações expansivas x reconhecimento discreto
    'S.motivar.1': ['I', 'D'],   // reconhecimento em particular x em público/visibilidade
    'C.motivar.3': ['I', 'D'],   // reconhecimento discreto x em público/visibilidade
    'I.comunicar.1': ['C'],      // evitar textos longos x preferir comunicação escrita
    'C.comunicar.1': ['I'],      // comunicação escrita x conversas presenciais
    'D.comunicar.3': ['S'],      // discordância direta x tom calmo
    'D.feedback.0': ['S', 'I'],  // feedback direto x acolhedor
    'S.delegar.1': ['D'],        // uma tarefa por vez x projetos desafiadores
    'D.delegar.0': ['S', 'C']    // "deixe o como" x processo completo / critérios explícitos
  };

  function conflita(sec, secao, indice, prim) {
    var lista = CONFLITOS_SECUNDARIO[sec + '.' + secao + '.' + indice];
    return !!(lista && lista.indexOf(prim) !== -1);
  }

  // ------------------------------------------------------------------
  // Utilitários
  // ------------------------------------------------------------------
  function obterDados() {
    if (root && root.DISC_DATA) return root.DISC_DATA;
    if (typeof require === 'function') {
      try { return require('./disc-data.js'); } catch (e) { /* sem dados extras */ }
    }
    return null;
  }

  function primeiroNome(nome) {
    var p = String(nome || '').trim().split(/\s+/)[0] || '';
    if (!p) return 'o(a) colaborador(a)';
    return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
  }

  function minusc(s) {
    s = String(s || '');
    return s.charAt(0).toLowerCase() + s.slice(1);
  }

  function fmtPct(n) {
    n = Number(n) || 0;
    return (Math.round(n * 10) / 10).toString().replace('.', ',') + '%';
  }

  function normalizar(resultado) {
    resultado = resultado || {};
    var pct = resultado.percentuais || {};
    var p = {};
    LETRAS.forEach(function (l) { p[l] = Number(pct[l]) || 0; });
    var ordem = Array.isArray(resultado.ordem) && resultado.ordem.length === 4
      ? resultado.ordem.slice()
      : LETRAS.slice().sort(function (a, b) { return p[b] - p[a]; });
    var prim = porPerfil[resultado.primario] ? resultado.primario : ordem[0];
    var sec = porPerfil[resultado.secundario] && resultado.secundario !== prim ? resultado.secundario : ordem[1];
    if (sec === prim) sec = ordem[0] === prim ? ordem[1] : ordem[0];
    return { percentuais: p, ordem: ordem, primario: prim, secundario: sec, codigo: prim + sec };
  }

  function addUnico(lista, item) {
    if (item && lista.indexOf(item) === -1) lista.push(item);
  }

  // ------------------------------------------------------------------
  // Geração do guia
  // ------------------------------------------------------------------
  function gerarGuia(resultado, nome) {
    var r = normalizar(resultado);
    var pn = primeiroNome(nome);
    var dados = obterDados();
    var perfisDados = (dados && dados.perfis) || {};
    var prim = r.primario, sec = r.secundario;
    var P = porPerfil[prim], S = porPerfil[sec];
    var combo = combinacoes[r.codigo] || null;

    var valores = LETRAS.map(function (l) { return r.percentuais[l]; });
    var amplitude = Math.max.apply(null, valores) - Math.min.apply(null, valores);
    var isEquilibrado = amplitude < LIMIAR_EQUILIBRADO;
    var isIntenso = !isEquilibrado && r.percentuais[prim] >= LIMIAR_INTENSO;

    var nomePrim = (perfisDados[prim] && perfisDados[prim].nome) || prim;
    var nomeSec = (perfisDados[sec] && perfisDados[sec].nome) || sec;

    var itens = {};
    SECOES.forEach(function (s) { itens[s.chave] = []; });

    // 1) Aviso de resultado equilibrado no topo
    if (isEquilibrado) {
      SECOES.forEach(function (s) { (equilibrado[s.chave] || []).forEach(function (t) { addUnico(itens[s.chave], t); }); });
    }

    // 2) Dicas específicas da combinação
    if (combo && !isEquilibrado) {
      combo.dicas.forEach(function (d) { addUnico(itens[d[0]], d[1]); });
    }

    // 3) Perfil primário (completo)
    SECOES.forEach(function (s) { (P[s.chave] || []).forEach(function (t) { addUnico(itens[s.chave], t); }); });

    // 4) Perfil secundário (complemento enxuto: 1 item por seção, 2 se equilibrado),
    //    pulando itens que contradizem o perfil primário.
    var qtdSec = isEquilibrado ? 2 : 1;
    ['comunicar', 'delegar', 'motivar', 'feedback', 'evitar'].forEach(function (k) {
      var lista = S[k] || [];
      var usados = 0;
      for (var n = 0; n < lista.length && usados < qtdSec; n++) {
        if (conflita(sec, k, n, prim)) continue;
        addUnico(itens[k], lista[n]);
        usados++;
      }
    });

    // 5) Ambiente do traço secundário e pontos de atenção (textos curados, neutros)
    if (S.ambiente && S.ambiente.length) {
      addUnico(itens.ambiente, 'Pelo traço secundário (' + nomeSec + '), também valoriza: ' + minusc(S.ambiente[0]));
    }
    (P.atencao || []).forEach(function (t) { addUnico(itens.pdi, t); });

    // 6) Intensidade
    if (isIntenso) {
      addUnico(itens.estresse, 'Traço ' + nomePrim + ' muito acentuado (' + fmtPct(r.percentuais[prim]) + '; a média é ' + MEDIA +
        '%): as características deste perfil tendem a aparecer com mais força, inclusive os excessos sob pressão. Acompanhe de perto.');
      var baixo = r.ordem[3];
      var nomeBaixo = (perfisDados[baixo] && perfisDados[baixo].nome) || baixo;
      if (porPerfil[baixo] && porPerfil[baixo].comportamentos) {
        addUnico(itens.pdi, 'Por ser um traço intenso, inclua no plano a prática de comportamentos do estilo menos presente (' +
          nomeBaixo + '): ' + porPerfil[baixo].comportamentos + '.');
      }
    }

    // Personaliza
    var secoes = SECOES.map(function (s) {
      return {
        titulo: s.titulo,
        itens: itens[s.chave].map(function (t) { return t.replace(/\{nome\}/g, pn); })
      };
    });

    // Resumo
    var pctTxt = LETRAS.map(function (l) { return l + ' ' + fmtPct(r.percentuais[l]); }).join(' · ');
    var resumo;
    if (isEquilibrado) {
      resumo = 'Perfil equilibrado/indefinido (' + pctTxt + '). A diferença entre o fator mais alto e o mais baixo é de apenas ' +
        fmtPct(amplitude).replace('%', ' pontos') + ', então o resultado é pouco conclusivo. ' +
        'Recomenda-se uma entrevista comportamental para confirmar como ' + pn + ' age no dia a dia. ' +
        'As orientações abaixo são uma referência inicial, com tendência ' + nomePrim + '/' + nomeSec + '.';
    } else {
      resumo = P.resumo.replace(/\{nome\}/g, pn) +
        (combo ? ' Estilo ' + combo.nome + ': ' + combo.resumo.replace(/\{nome\}/g, pn) : '') +
        ' (' + pctTxt + ')' +
        (isIntenso ? ' Atenção: o traço ' + nomePrim + ' é muito acentuado (a média de cada fator é ' + MEDIA + '%).' : '');
    }

    var estilo = isEquilibrado ? 'Perfil equilibrado' : (combo ? combo.nome : P.estilo);
    return {
      titulo: 'Guia para a Liderança — ' + pn + ' (' + r.codigo + ' · ' + estilo + ')',
      nome: String(nome || '').trim(),
      primeiroNome: pn,
      codigo: r.codigo,
      estilo: estilo,
      equilibrado: isEquilibrado,
      intenso: isIntenso,
      resumo: resumo,
      aviso: AVISO,
      secoes: secoes
    };
  }

  // Texto puro (para copiar / WhatsApp)
  function gerarTexto(guia) {
    if (!guia) return '';
    var linhas = [];
    linhas.push('*' + guia.titulo + '*');
    linhas.push('');
    if (guia.resumo) { linhas.push(guia.resumo); linhas.push(''); }
    (guia.secoes || []).forEach(function (s) {
      linhas.push('*' + s.titulo + '*');
      (s.itens || []).forEach(function (i) { linhas.push('• ' + i); });
      linhas.push('');
    });
    linhas.push('_' + (guia.aviso || AVISO) + '_');
    return linhas.join('\n');
  }

  var DISC_LIDERANCA = {
    SECOES: SECOES.map(function (s) { return s.titulo; }),
    AVISO: AVISO,
    LIMIAR_EQUILIBRADO: LIMIAR_EQUILIBRADO,
    LIMIAR_INTENSO: LIMIAR_INTENSO,
    porPerfil: porPerfil,
    combinacoes: combinacoes,
    gerarGuia: gerarGuia,
    gerarTexto: gerarTexto
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = DISC_LIDERANCA;
  else root.DISC_LIDERANCA = DISC_LIDERANCA;
})(typeof self !== 'undefined' ? self : this);
