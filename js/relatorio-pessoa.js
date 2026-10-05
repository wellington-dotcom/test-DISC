/*
 * Relatório DISC "modelo pessoa": o relatório que a PRÓPRIA pessoa recebe, voltado para como ela pode se desenvolver.
 * (Não é o modelo para a empresa/liderança: aqui não entra vaga, função, aderência, nota nem empresa.)
 *
 * Módulo PURO e reutilizável (candidato na conclusão; depois o painel, para colaboradores):
 *   montar({ percentuais: {D,I,S,C}, codigo: 'DI' }, nome?, data?) -> dados serializáveis (ou null se inválido)
 *   {
 *     versao: 1, nome, codigo,
 *     primario: { letra, nome, rotulo }, secundario: { letra, nome, rotulo },
 *     frase,                                   // seu perfil em uma frase
 *     fatores: [{ letra, nome, pct, descricao }],   // D, I, S, C (pct soma 100)
 *     secoes: [                                // nesta ordem
 *       { id: 'fortes',      titulo, intro, caracteristicas: [..], itens: [{ titulo, texto }] },
 *       { id: 'atencao',     titulo, intro, itens: [{ titulo, texto }] },
 *       { id: 'pressao',     titulo, intro, sinais: [..], itens: [{ titulo, texto }] },
 *       { id: 'comunicacao', titulo, intro, perfis: [{ letra, nome, rotulo, texto }] },   // os 3 outros perfis
 *       { id: 'plano',       titulo, intro, itens: [{ prazo, titulo, texto }] }           // 30/60/90 dias
 *     ],
 *     aviso                                    // DISC descreve estilo, não certo/errado
 *   }
 * A renderização fica com quem usa (js/app.js no candidato). Só texto puro: escape ao exibir.
 * Fonte das listas (características, sob pressão): DISC_DATA.perfis (js/disc-data.js).
 */
(function (root) {
  'use strict';

  var LETRAS = ['D', 'I', 'S', 'C'];

  // O que cada fator descreve (sem julgamento).
  var FATORES = {
    D: 'Como você encara desafios, toma decisões e busca resultados.',
    I: 'Como você se comunica, se relaciona e envolve as pessoas.',
    S: 'Como você lida com ritmo, constância, cooperação e mudanças.',
    C: 'Como você lida com regras, qualidade, informações e detalhes.'
  };

  // Perfil em uma frase: "<principal> ... <secundário acrescenta>".
  var FRASE_PRINCIPAL = {
    D: 'Você tende a ser direto, decidido e movido por desafios',
    I: 'Você tende a ser comunicativo, otimista e bom de envolver as pessoas',
    S: 'Você tende a ser calmo, paciente e alguém com quem os outros podem contar',
    C: 'Você tende a ser cuidadoso, analítico e atento à qualidade'
  };
  var FRASE_SECUNDARIO = {
    D: 'com um toque de iniciativa e foco em resultado',
    I: 'com um toque de entusiasmo e facilidade para se relacionar',
    S: 'com um toque de calma e disposição para cooperar',
    C: 'com um toque de organização e atenção aos detalhes'
  };

  // Pontos fortes e como usá-los mais.
  var FORTES = {
    D: [
      { titulo: 'Tomar a frente', texto: 'Ofereça-se para conduzir tarefas travadas ou sem dono. Seu jeito de decidir destrava o grupo.' },
      { titulo: 'Foco em resultado', texto: 'Transforme objetivos vagos em metas claras, com prazo e responsável. Compartilhe essas metas com quem trabalha com você.' },
      { titulo: 'Coragem diante de problemas', texto: 'Use sua disposição para encarar o que os outros evitam, chamando as pessoas para resolver junto.' }
    ],
    I: [
      { titulo: 'Comunicação', texto: 'Use sua facilidade de falar para explicar ideias, apresentar propostas e aproximar pessoas que não se conhecem.' },
      { titulo: 'Entusiasmo que contagia', texto: 'Em momentos de desânimo, seja quem lembra o grupo do que já deu certo e do que vem pela frente.' },
      { titulo: 'Rede de contatos', texto: 'Cultive relações de forma intencional: anote combinados e retome contato com quem pode ajudar ou ser ajudado.' }
    ],
    S: [
      { titulo: 'Constância', texto: 'Seja a pessoa que garante que o combinado acontece do começo ao fim. Mostre o andamento para que esse esforço seja visto.' },
      { titulo: 'Escuta e apoio', texto: 'Use sua paciência para acolher colegas novos e ajudar a acalmar conversas difíceis.' },
      { titulo: 'Trabalho em equipe', texto: 'Proponha rotinas simples que ajudem o grupo a funcionar melhor: listas, combinados, passagens de turno.' }
    ],
    C: [
      { titulo: 'Qualidade', texto: 'Crie checklists e padrões para tarefas repetidas e ofereça-os ao grupo: seu cuidado vira referência.' },
      { titulo: 'Análise', texto: 'Antes de decisões importantes, levante dados e mostre as opções com prós e contras de forma resumida.' },
      { titulo: 'Organização', texto: 'Use seu método para organizar informações e processos que hoje dependem da memória das pessoas.' }
    ]
  };

  // Pontos de atenção (tom construtivo: força que, quando exagerada, pode atrapalhar).
  var ATENCAO = {
    D: [
      { titulo: 'Pressa para decidir', texto: 'Quando exagerada, pode fazer você decidir sem ouvir quem será afetado. Antes de bater o martelo, pergunte: "o que eu não estou vendo?"' },
      { titulo: 'Jeito direto', texto: 'Quando exagerado, pode soar como cobrança ou dureza. Comece pelo que está bom e depois diga o que precisa mudar.' },
      { titulo: 'Fazer tudo', texto: 'Quando exagerado, pode virar dificuldade de delegar e sobrecarga. Escolha uma tarefa por semana para confiar a outra pessoa.' }
    ],
    I: [
      { titulo: 'Otimismo', texto: 'Quando exagerado, pode fazer você prometer mais do que cabe no tempo. Confira a agenda antes de dizer sim.' },
      { titulo: 'Muitas ideias ao mesmo tempo', texto: 'Quando exagerado, pode deixar tarefas pela metade. Termine uma antes de começar a próxima.' },
      { titulo: 'Falar muito', texto: 'Quando exagerado, pode tirar espaço dos outros. Em reuniões, experimente falar por último e resumir o que ouviu.' }
    ],
    S: [
      { titulo: 'Evitar conflito', texto: 'Quando exagerado, pode fazer você concordar com o que não acredita e guardar incômodos. Diga com calma o que pensa, mesmo que discorde.' },
      { titulo: 'Gostar do previsível', texto: 'Quando exagerado, pode tornar mudanças mais pesadas do que precisam ser. Peça informações cedo e encare cada mudança como um passo de cada vez.' },
      { titulo: 'Ajudar sempre', texto: 'Quando exagerado, pode deixar suas prioridades para depois. Aprenda a dizer "agora não consigo, posso depois de tal hora".' }
    ],
    C: [
      { titulo: 'Perfeccionismo', texto: 'Quando exagerado, pode atrasar entregas que já estavam boas. Combine antes qual é o "bom o suficiente" para cada tarefa.' },
      { titulo: 'Precisar de muitos dados', texto: 'Quando exagerado, pode adiar decisões. Defina um prazo para pesquisar e decida com o que tiver em mãos.' },
      { titulo: 'Senso crítico', texto: 'Quando exagerado, pode soar como frieza ou crítica pessoal. Reconheça o esforço antes de apontar o que corrigir.' }
    ]
  };

  // Sob pressão: o que fazer nessas horas.
  var PRESSAO = {
    D: [
      { titulo: 'Respire antes de responder', texto: 'Conte até dez ou saia por um minuto antes de responder a algo que irritou você.' },
      { titulo: 'Troque ordens por perguntas', texto: '"Como podemos resolver isso?" envolve as pessoas mais do que uma ordem.' },
      { titulo: 'Separe o problema da pessoa', texto: 'Seja firme com o problema e gentil com quem está envolvido nele.' }
    ],
    I: [
      { titulo: 'Escreva antes de falar', texto: 'Liste os fatos em três tópicos antes de uma conversa difícil, para não se perder.' },
      { titulo: 'Olhe para os números', texto: 'Confira prazos e dados reais antes de prometer uma solução.' },
      { titulo: 'Peça ajuda cedo', texto: 'Avise quando estiver sobrecarregado, antes que o prazo aperte.' }
    ],
    S: [
      { titulo: 'Diga o que está sentindo', texto: 'Ficar em silêncio não resolve: conte a alguém de confiança o que está pesando.' },
      { titulo: 'Divida a mudança em partes', texto: 'Pergunte qual é o primeiro passo e foque só nele.' },
      { titulo: 'Defina um limite', texto: 'Escolha o que é prioridade hoje e combine o restante para depois.' }
    ],
    C: [
      { titulo: 'Aceite o suficiente', texto: 'Pergunte: "isto resolve o que precisa ser resolvido agora?" Se sim, entregue.' },
      { titulo: 'Converse, não só analise', texto: 'Compartilhe a preocupação com alguém em vez de remoê-la sozinho.' },
      { titulo: 'Cuide do tom', texto: 'Sob tensão a crítica sai mais dura: releia mensagens antes de enviar.' }
    ]
  };

  // Como se comunicar melhor com pessoas de cada perfil.
  var COMUNICACAO = {
    D: 'Seja breve e vá direto ao ponto. Traga o objetivo, as opções e a sua recomendação. Evite rodeios e detalhes que não mudam a decisão.',
    I: 'Comece pela conversa e pela relação. Mostre entusiasmo, dê espaço para ideias e combine os próximos passos por escrito para nada se perder.',
    S: 'Tenha calma e explique o porquê das coisas. Avise mudanças com antecedência, ofereça apoio e dê tempo para a pessoa se posicionar.',
    C: 'Traga fatos, dados e exemplos. Seja preciso, organize a informação e dê tempo para a pessoa analisar antes de pedir uma resposta.'
  };

  // Plano de desenvolvimento prático (30/60/90 dias): 4 hábitos do estilo principal + 1 do fator menos usado.
  var PLANO = {
    D: [
      { prazo: '30 dias', titulo: 'Ouvir antes de decidir', texto: 'Em toda decisão que afete outras pessoas, pergunte a opinião de pelo menos uma delas antes de decidir.' },
      { prazo: '30 dias', titulo: 'Elogio específico', texto: 'Uma vez por semana, reconheça em voz alta algo concreto que alguém fez bem.' },
      { prazo: '60 dias', titulo: 'Delegar de verdade', texto: 'Escolha duas tarefas que você sempre faz e passe para outra pessoa, combinando o resultado esperado e sem refazer.' },
      { prazo: '90 dias', titulo: 'Pedir feedback', texto: 'Pergunte a duas pessoas: "o que eu faço que atrapalha você?" Escolha um ponto e trabalhe nele.' }
    ],
    I: [
      { prazo: '30 dias', titulo: 'Lista do dia', texto: 'Comece cada dia escrevendo as três tarefas mais importantes e só passe para outras quando concluí-las.' },
      { prazo: '30 dias', titulo: 'Escuta ativa', texto: 'Em cada conversa importante, resuma o que a outra pessoa disse antes de dar sua opinião.' },
      { prazo: '60 dias', titulo: 'Combinados por escrito', texto: 'Depois de reuniões, envie uma mensagem curta com o que foi decidido, quem faz e até quando.' },
      { prazo: '90 dias', titulo: 'Projeto do começo ao fim', texto: 'Escolha um projeto e acompanhe-o até a conclusão, registrando o andamento toda semana.' }
    ],
    S: [
      { prazo: '30 dias', titulo: 'Dar opinião', texto: 'Em cada reunião, diga pelo menos uma ideia ou discordância, mesmo que pequena.' },
      { prazo: '30 dias', titulo: 'Dizer não com gentileza', texto: 'Quando estiver sem tempo, responda "agora não consigo, posso depois de tal hora" em vez de aceitar tudo.' },
      { prazo: '60 dias', titulo: 'Pequenas mudanças', texto: 'Mude de propósito uma rotina sua por semana (ordem das tarefas, ferramenta, caminho) para treinar flexibilidade.' },
      { prazo: '90 dias', titulo: 'Assumir uma frente', texto: 'Ofereça-se para liderar uma tarefa ou melhoria do seu dia a dia e apresente o resultado ao grupo.' }
    ],
    C: [
      { prazo: '30 dias', titulo: 'Bom o suficiente', texto: 'Antes de cada tarefa, defina qual é o padrão necessário e pare quando atingi-lo.' },
      { prazo: '30 dias', titulo: 'Decidir com prazo', texto: 'Dê a si mesmo um tempo limite para pesquisar antes de cada decisão e decida quando ele acabar.' },
      { prazo: '60 dias', titulo: 'Reconhecer antes de corrigir', texto: 'Ao revisar o trabalho de alguém, comece apontando o que está bom.' },
      { prazo: '90 dias', titulo: 'Mais conversa', texto: 'Troque algumas mensagens por conversas rápidas, para fortalecer a relação com o time.' }
    ]
  };
  // Hábito extra para exercitar o fator menos presente (90 dias).
  var PLANO_MENOR = {
    D: { prazo: '90 dias', titulo: 'Exercitar a iniciativa', texto: 'Seu fator Dominância é o menos presente: uma vez por semana, tome uma decisão pequena sem esperar que alguém decida por você.' },
    I: { prazo: '90 dias', titulo: 'Exercitar a conexão', texto: 'Seu fator Influência é o menos presente: puxe uma conversa por semana com alguém com quem você fala pouco.' },
    S: { prazo: '90 dias', titulo: 'Exercitar a paciência', texto: 'Seu fator Estabilidade é o menos presente: em uma tarefa por semana, vá até o fim antes de começar outra.' },
    C: { prazo: '90 dias', titulo: 'Exercitar o cuidado', texto: 'Seu fator Conformidade é o menos presente: revise com calma uma entrega importante por semana antes de enviar.' }
  };

  /* ------------------------------------------------------------------ Seções de aprofundamento (rodada 3)
   * Cada tabela: PRI[letra] = 2 itens do fator principal; SEC[letra] = 1 item do segundo fator.
   * Textos escritos para não repetir as frases de outras seções. */

  var APRENDIZADO = {
    PRI: {
      D: [
        { titulo: 'Aprende fazendo e com desafio', texto: 'Você costuma aprender mais quando tem um problema real para resolver e liberdade para testar caminhos. Teoria longa, sem aplicação imediata, tende a perder sua atenção.' },
        { titulo: 'Objetivo antes do conteúdo', texto: 'Saber para que serve o que está aprendendo acelera o seu interesse. Antes de um curso ou treinamento, defina qual resultado você quer alcançar com ele.' }
      ],
      I: [
        { titulo: 'Aprende trocando com pessoas', texto: 'Conversas, grupos de estudo e exemplos contados por quem viveu a situação: o aprendizado fica quando passa pela troca.' },
        { titulo: 'Variedade mantém o interesse', texto: 'Formatos dinâmicos, como vídeos, histórias e atividades em grupo, prendem mais a sua atenção do que leitura extensa. Para conteúdos densos, divida o estudo em sessões curtas.' }
      ],
      S: [
        { titulo: 'Aprende passo a passo', texto: 'Você costuma absorver melhor quando o conteúdo vem em sequência, com tempo para praticar cada etapa antes de seguir para a próxima.' },
        { titulo: 'Liberdade para perguntar', texto: 'Rende mais quando pode tirar dúvidas sem pressa, com alguém de confiança. Se o ritmo de um treinamento estiver rápido demais, peça um momento de prática acompanhada.' }
      ],
      C: [
        { titulo: 'Aprende entendendo a lógica', texto: 'Você gosta de saber o porquê e o como antes de aplicar. Materiais bem estruturados, manuais e fontes confiáveis funcionam melhor do que explicações soltas.' },
        { titulo: 'Estudo com profundidade', texto: 'Tende a ir a fundo em um assunto. Para não travar no excesso de leitura, alterne o estudo com aplicações pequenas e rápidas.' }
      ]
    },
    SEC: {
      D: { titulo: 'Toque de prática', texto: 'Seu lado de Dominância pede aplicação: escolha uma coisa do que aprendeu e use já na semana seguinte.' },
      I: { titulo: 'Toque de troca', texto: 'Seu lado de Influência ajuda a fixar ensinando: conte a um colega o ponto principal do que estudou.' },
      S: { titulo: 'Toque de constância', texto: 'Seu lado de Estabilidade favorece o hábito: um pouco de estudo em horário fixo rende mais do que maratonas.' },
      C: { titulo: 'Toque de método', texto: 'Seu lado de Conformidade gosta de registro: mantenha anotações organizadas para consultar depois.' }
    }
  };

  // Ritmo = (D + I) − (S + C), a mesma convenção de js/compatibilidade.js (positivo = rápido).
  var LIMITE_RITMO = 10;
  var DECISAO_RITMO = {
    rapido: { titulo: 'Ritmo: rápido', texto: 'Seus fatores de ritmo acelerado (Dominância e Influência) pesam mais do que os de ritmo cauteloso. Você tende a decidir depressa e ajustar no caminho; para escolhas difíceis de desfazer, vale dar a si mesmo um tempo extra.' },
    equilibrado: { titulo: 'Ritmo: equilibrado', texto: 'Seus fatores de ritmo acelerado e cauteloso estão próximos. Você consegue decidir rápido quando há urgência e desacelerar quando o assunto pede mais cuidado; o desafio é perceber qual dos dois momentos é o atual.' },
    cuidadoso: { titulo: 'Ritmo: cuidadoso', texto: 'Seus fatores de ritmo cauteloso (Estabilidade e Conformidade) pesam mais. Você tende a pensar bem antes de escolher, o que evita retrabalho; em situações urgentes, uma decisão boa no prazo vale mais do que a ideal fora dele.' }
  };
  // Base da decisão: pontuação dados = 1,5×C; pessoas = S + I/2; intuição = D + I/2 (empate: dados, pessoas, intuição).
  var DECISAO_BASE = {
    dados: { titulo: 'Base: dados e critérios', texto: 'Você tende a se apoiar em fatos, números e regras antes de escolher. Isso traz segurança; só cuide para não esperar uma certeza que a situação não oferece.' },
    pessoas: { titulo: 'Base: pessoas', texto: 'Você costuma pesar o impacto nas pessoas e ouvir quem será afetado. Isso gera adesão; lembre-se de que nem toda decisão boa agrada a todos.' },
    intuicao: { titulo: 'Base: intuição e objetivo', texto: 'Você tende a decidir pelo objetivo e pela leitura rápida da situação. É uma força em momentos de urgência; em escolhas de maior impacto, confira pelo menos um dado concreto.' }
  };
  var DECISAO_DICA = {
    D: { titulo: 'Um teste rápido', texto: 'Para decisões que afetam o time, escreva em uma linha o motivo da escolha. Se não couber, provavelmente vale ouvir mais alguém.' },
    I: { titulo: 'Do entusiasmo ao critério', texto: 'Quando uma ideia empolgar, defina dois critérios objetivos que ela precisa cumprir antes de seguir adiante.' },
    S: { titulo: 'Data para decidir', texto: 'Se a decisão depende de você, marque um dia para ela. Pedir opiniões é bom, mas o consenso completo nem sempre chega.' },
    C: { titulo: 'Margem de incerteza', texto: 'Defina antes quanto de incerteza você aceita em cada decisão. Ao chegar a esse ponto, escolha e acompanhe o resultado.' }
  };

  var MUDANCAS = {
    PRI: {
      D: [
        { titulo: 'Mudança como oportunidade', texto: 'Você costuma aceitar bem mudanças que trazem desafio ou resultado melhor, e muitas vezes é quem as provoca. O incômodo aparece quando a mudança vem imposta, sem explicação, ou reduz a sua autonomia.' },
        { titulo: 'Leve o time junto', texto: 'Sua velocidade de adaptação pode ser maior que a dos colegas. Ao propor algo novo, explique o motivo e combine um prazo de transição.' }
      ],
      I: [
        { titulo: 'Abertura ao novo', texto: 'Novidades costumam te animar, principalmente quando envolvem pessoas, projetos diferentes ou mais visibilidade.' },
        { titulo: 'Depois da empolgação', texto: 'O desafio costuma vir depois do começo animado: sustentar o novo jeito de fazer. Crie lembretes para os primeiros dias da mudança.' }
      ],
      S: [
        { titulo: 'Mudança com tempo e motivo', texto: 'Você se adapta bem quando sabe por que a mudança acontece, o que continua igual e qual é o primeiro passo. Mudanças repentinas pedem um pouco mais de energia.' },
        { titulo: 'Busque a informação cedo', texto: 'Em vez de esperar o anúncio oficial, procure quem pode explicar o plano. Saber antes reduz o desconforto e ajuda você a apoiar o time.' }
      ],
      C: [
        { titulo: 'Mudança bem fundamentada', texto: 'Você aceita mudar quando vê lógica e dados que justificam. Mudanças improvisadas ou mal explicadas tendem a gerar muitas perguntas da sua parte.' },
        { titulo: 'Contribua com o plano', texto: 'Seu olhar para riscos é útil em qualquer transição. Além de apontar o que pode dar errado, sugira como fazer dar certo.' }
      ]
    },
    SEC: {
      D: { titulo: 'Impulso para agir', texto: 'Seu lado de Dominância ajuda a passar da discussão para a ação quando a mudança já foi decidida.' },
      I: { titulo: 'Ponte com as pessoas', texto: 'Seu lado de Influência pode ajudar colegas resistentes a enxergar o lado bom do que está mudando.' },
      S: { titulo: 'Âncora na transição', texto: 'Seu lado de Estabilidade lembra o grupo do que deve ser preservado enquanto o resto muda.' },
      C: { titulo: 'Olhar para as lacunas', texto: 'Seu lado de Conformidade ajuda a perceber o que ficou sem responsável ou sem regra durante a transição.' }
    }
  };

  var ESTILO_COMUNICACAO = {
    PRI: {
      D: [
        { titulo: 'Direto e objetivo', texto: 'Você costuma ir ao ponto, com frases curtas e foco no que precisa acontecer. Isso economiza tempo e deixa claro o que você espera.' },
        { titulo: 'Ajuste para quem precisa de contexto', texto: 'Algumas pessoas precisam entender o cenário antes da conclusão. Acrescente uma frase de contexto e uma de reconhecimento às suas mensagens.' }
      ],
      I: [
        { titulo: 'Expressivo e próximo', texto: 'Você se comunica com energia, histórias e exemplos, e costuma deixar as pessoas à vontade.' },
        { titulo: 'Ajuste para quem quer o essencial', texto: 'Com pessoas mais objetivas, comece pela conclusão e deixe a história para depois, se houver interesse.' }
      ],
      S: [
        { titulo: 'Calmo e atento', texto: 'Você escuta mais do que fala, escolhe bem as palavras e evita tons agressivos. As pessoas costumam se sentir ouvidas ao seu lado.' },
        { titulo: 'Ajuste para ser ouvido', texto: 'Em grupos acelerados, a sua opinião pode ficar de fora. Prepare antes o ponto principal que você quer dizer e peça a palavra.' }
      ],
      C: [
        { titulo: 'Preciso e fundamentado', texto: 'Você prefere comunicar com fatos e boa organização, e se preocupa em não dizer nada incorreto.' },
        { titulo: 'Ajuste para quem quer o resumo', texto: 'Nem todos precisam de todos os detalhes. Comece com um resumo de três linhas e ofereça o restante para quem quiser aprofundar.' }
      ]
    },
    SEC: {
      D: { titulo: 'Firmeza', texto: 'Seu lado de Dominância dá segurança à sua fala quando é preciso defender uma posição.' },
      I: { titulo: 'Calor humano', texto: 'Seu lado de Influência suaviza a mensagem e aproxima quem está ouvindo.' },
      S: { titulo: 'Serenidade', texto: 'Seu lado de Estabilidade ajuda a manter conversas tensas em um tom tranquilo.' },
      C: { titulo: 'Clareza', texto: 'Seu lado de Conformidade ajuda a organizar a mensagem em uma sequência lógica.' }
    }
  };

  var ORGANIZACAO = {
    PRI: {
      D: [
        { titulo: 'Pelo que gera mais impacto', texto: 'Você costuma se organizar pelo que move o resultado e deixa o restante para depois. Listas curtas funcionam melhor do que planejamentos detalhados.' },
        { titulo: 'O que costuma acumular', texto: 'Tarefas pequenas e administrativas tendem a ficar para trás. Separe um horário fixo na semana só para elas.' }
      ],
      I: [
        { titulo: 'Flexível e aberto ao imprevisto', texto: 'Você costuma se organizar de forma mais livre, encaixando conversas e oportunidades que surgem ao longo do dia.' },
        { titulo: 'Agenda à vista', texto: 'Um quadro ou aplicativo simples, revisado toda manhã, ajuda a não perder prazos no meio de tantas frentes.' }
      ],
      S: [
        { titulo: 'Rotina estável', texto: 'Você rende mais com uma sequência previsível de tarefas e costuma cumprir o que planejou.' },
        { titulo: 'Margem para o inesperado', texto: 'Deixe um espaço livre na agenda; assim uma urgência não desorganiza o dia inteiro.' }
      ],
      C: [
        { titulo: 'Método e registro', texto: 'Você costuma planejar, dividir o trabalho em etapas e manter arquivos e anotações em ordem.' },
        { titulo: 'Planejar na medida', texto: 'Detalhe o que é crítico e simplifique o que é rotineiro, para o planejamento não tomar o tempo da execução.' }
      ]
    },
    SEC: {
      D: { titulo: 'Senso de prazo', texto: 'Seu lado de Dominância ajuda a manter os olhos na data final.' },
      I: { titulo: 'Gente na agenda', texto: 'Seu lado de Influência lembra de incluir no plano as pessoas que precisam ser envolvidas.' },
      S: { titulo: 'Passo regular', texto: 'Seu lado de Estabilidade ajuda a manter um ritmo constante, sem picos de correria.' },
      C: { titulo: 'Conferência final', texto: 'Seu lado de Conformidade ajuda a revisar o que foi planejado antes de dar algo como concluído.' }
    }
  };

  var NECESSIDADES = {
    PRI: {
      D: [
        { titulo: 'Autonomia e desafio', texto: 'Metas claras, liberdade para escolher o caminho e problemas que valham o esforço.' },
        { titulo: 'Agilidade', texto: 'Respostas rápidas e decisões que não fiquem paradas por muito tempo.' }
      ],
      I: [
        { titulo: 'Contato e reconhecimento', texto: 'Convivência com pessoas, espaço para expor ideias e retorno sobre o que você faz bem.' },
        { titulo: 'Clima leve', texto: 'Um ambiente aberto, com colaboração e alguma variedade no dia a dia.' }
      ],
      S: [
        { titulo: 'Clareza e previsibilidade', texto: 'Saber o que se espera de você, com combinados estáveis e tempo para fazer bem feito.' },
        { titulo: 'Time unido', texto: 'Relações de confiança e cooperação, em que um apoia o outro.' }
      ],
      C: [
        { titulo: 'Padrões e informação', texto: 'Critérios de qualidade definidos, acesso às informações necessárias e instruções precisas.' },
        { titulo: 'Tempo para concentrar', texto: 'Períodos sem interrupção para analisar e conferir o trabalho.' }
      ]
    },
    SEC: {
      D: { titulo: 'Espaço para decidir', texto: 'Como o seu segundo fator é Dominância, também ajuda ter alguma área em que a decisão seja sua.' },
      I: { titulo: 'Troca com colegas', texto: 'Como o seu segundo fator é Influência, momentos de conversa com o time fazem diferença no seu dia.' },
      S: { titulo: 'Combinados avisados', texto: 'Como o seu segundo fator é Estabilidade, mudanças comunicadas com antecedência ajudam você a render.' },
      C: { titulo: 'Critério explícito', texto: 'Como o seu segundo fator é Conformidade, saber exatamente qual é o padrão esperado traz tranquilidade.' }
    }
  };

  var DESMOTIVA = {
    PRI: {
      D: [
        { titulo: 'Lentidão e burocracia', texto: 'Processos demorados, decisões que não saem e muitas aprovações para coisas simples.' },
        { titulo: 'Pouca autonomia', texto: 'Ser acompanhado em cada passo ou precisar pedir permissão para tudo.' }
      ],
      I: [
        { titulo: 'Isolamento', texto: 'Passar longos períodos sem contato com pessoas ou sem poder trocar ideias.' },
        { titulo: 'Falta de retorno', texto: 'Trabalhar sem saber se o que você faz está sendo percebido.' }
      ],
      S: [
        { titulo: 'Prioridades que mudam o tempo todo', texto: 'Mudanças de rumo a toda hora, sem explicação e sem tempo para se adaptar.' },
        { titulo: 'Clima de conflito', texto: 'Ambientes com disputas abertas, cobranças agressivas ou pouca cooperação.' }
      ],
      C: [
        { titulo: 'Improviso e informação incompleta', texto: 'Tarefas sem critério claro, regras alteradas sem aviso e decisões sem fundamento.' },
        { titulo: 'Pressa que compromete a qualidade', texto: 'Precisar entregar algo que você sabe que poderia estar melhor, sem chance de revisar.' }
      ]
    },
    // Fator menos presente, quando está na faixa baixa ou muito baixa da régua.
    MENOR: {
      D: { titulo: 'Disputa por espaço', texto: 'Como a Dominância aparece pouco em você, ambientes muito competitivos, em que é preciso brigar por espaço, tendem a cansar.' },
      I: { titulo: 'Exposição constante', texto: 'Como a Influência aparece pouco em você, situações que pedem falar para muita gente ou se promover o tempo todo tendem a cansar.' },
      S: { titulo: 'Repetição sem novidade', texto: 'Como a Estabilidade aparece pouco em você, tarefas iguais por muito tempo tendem a cansar.' },
      C: { titulo: 'Controle minucioso', texto: 'Como a Conformidade aparece pouco em você, procedimentos muito detalhados e controles de cada passo tendem a cansar.' }
    }
  };

  var VALORIZA = {
    PRI: {
      D: [
        { titulo: 'Competência e iniciativa', texto: 'Você costuma admirar quem resolve, assume responsabilidades e entrega o que promete.' },
        { titulo: 'Franqueza', texto: 'Prefere quem fala o que pensa, sem rodeios, mesmo para discordar.' }
      ],
      I: [
        { titulo: 'Abertura e bom humor', texto: 'Você tende a se aproximar de pessoas receptivas, que compartilham ideias e tornam o ambiente agradável.' },
        { titulo: 'Reconhecimento mútuo', texto: 'Valoriza quem celebra conquistas e dá crédito ao trabalho dos outros.' }
      ],
      S: [
        { titulo: 'Lealdade e consideração', texto: 'Você valoriza quem cumpre o combinado, respeita o tempo dos outros e está presente nos momentos difíceis.' },
        { titulo: 'Gentileza', texto: 'Aprecia quem trata as pessoas com respeito, mesmo sob pressão.' }
      ],
      C: [
        { titulo: 'Coerência e preparo', texto: 'Você valoriza quem se prepara, sabe do que está falando e mantém a palavra.' },
        { titulo: 'Capricho', texto: 'Aprecia quem faz com atenção e respeita padrões e acordos.' }
      ]
    },
    // Um convite para enxergar o valor de estilos diferentes do seu.
    OUTROS: {
      D: { titulo: 'Ritmos diferentes', texto: 'Quem pergunta mais ou leva mais tempo para decidir muitas vezes está evitando um erro que você não viu. Dê espaço a esse cuidado.' },
      I: { titulo: 'Contribuições silenciosas', texto: 'Colegas mais reservados também colaboram muito, muitas vezes longe dos holofotes. Pergunte a opinião deles diretamente.' },
      S: { titulo: 'Franqueza também é cuidado', texto: 'Pessoas mais diretas podem parecer duras, mas em geral estão tentando ajudar. Separe o tom da intenção.' },
      C: { titulo: 'Agilidade também tem valor', texto: 'Quem decide rápido ou improvisa pode complementar o seu cuidado. Procure o que cada estilo traz de útil.' }
    }
  };

  var AVISO_SIMPLES = 'O DISC descreve estilo de comportamento, não certo ou errado. Todas as pessoas têm um pouco dos quatro fatores.';

  var AVISO = 'O DISC descreve o seu estilo de comportamento: como você costuma agir, se comunicar e trabalhar. ' +
    'Não existe perfil certo ou errado, melhor ou pior. Todo estilo tem forças e pontos a cuidar, todas as pessoas têm um pouco dos ' +
    'quatro fatores, e o comportamento muda com o tempo, com o contexto e com o que você escolhe desenvolver.';

  function dadosDisc(data) {
    if (data && data.perfis) return data;
    if (root && root.DISC_DATA) return root.DISC_DATA;
    if (typeof require === 'function') { try { return require('./disc-data.js'); } catch (e) { /* sem dados */ } }
    return null;
  }

  // Só o necessário (também o que fica guardado): { percentuais: {D,I,S,C}, codigo: 'DI' } ou null se inválido.
  function dadosDoResultado(percentuais, codigo) {
    if (!percentuais || typeof percentuais !== 'object') return null;
    var p = {};
    for (var i = 0; i < LETRAS.length; i++) {
      var bruto = percentuais[LETRAS[i]];
      var v = Number(bruto);
      if (bruto === null || bruto === '' || typeof bruto === 'boolean' || !isFinite(v) || v < 0 || v > 100) return null;
      p[LETRAS[i]] = Math.round(v * 10) / 10;
    }
    var c = String(codigo == null ? '' : codigo).toUpperCase();
    if (!/^[DISC]{2}$/.test(c) || c.charAt(0) === c.charAt(1)) return null;
    return { percentuais: p, codigo: c };
  }

  function copia(lista) { return (lista || []).map(function (x) { return typeof x === 'object' ? JSON.parse(JSON.stringify(x)) : x; }); }

  function perfilResumo(letra, perfis) {
    return { letra: letra, nome: perfis[letra].nome, rotulo: perfis[letra].rotulo };
  }

  function modulo(global, caminho) {
    if (root && root[global]) return root[global];
    if (typeof require === 'function') { try { return require(caminho); } catch (e) { /* módulo opcional ausente */ } }
    return null;
  }

  // Aceita montar(rel, nome, data, opcoes) e também montar(rel, nome, opcoes) (sem DISC_DATA explícito).
  function argumentos(data, opcoes) {
    if (data && !data.perfis && opcoes === undefined && typeof data === 'object') return { data: null, opcoes: data };
    return { data: data, opcoes: opcoes || {} };
  }

  // Base comum de montar() e montarSimples().
  function base(rel, nome, data) {
    var r = rel ? dadosDoResultado(rel.percentuais, rel.codigo) : null;
    var D = dadosDisc(data);
    if (!r || !D || !D.perfis) return null;
    var perfis = D.perfis;
    var pri = r.codigo.charAt(0), sec = r.codigo.charAt(1);
    if (!perfis[pri] || !perfis[sec]) return null;
    // Fator menos presente (empate: o último na ordem D, I, S, C), diferente do principal e do secundário.
    var menor = null;
    LETRAS.forEach(function (l) {
      if (l === pri || l === sec) return;
      if (menor === null || r.percentuais[l] <= r.percentuais[menor]) menor = l;
    });
    return {
      r: r, perfis: perfis, pri: pri, sec: sec, menor: menor,
      primeiroNome: String(nome == null ? '' : nome).replace(/\s+/g, ' ').trim().split(' ')[0] || ''
    };
  }

  function combinacaoDe(r) {
    var CB = modulo('DISC_COMBINACOES', './disc-combinacoes.js');
    return CB ? CB.combinacao(r.percentuais, r.codigo) : null;
  }

  function reguaDe(r) {
    var IN = modulo('DISC_INTENSIDADE', './disc-intensidade.js');
    return IN ? IN.regua(r.percentuais) : null;
  }

  function secao(id, titulo, intro, itens, extra) {
    var s = { id: id, titulo: titulo, intro: intro };
    if (extra) Object.keys(extra).forEach(function (k) { s[k] = extra[k]; });
    s.itens = copia(itens);
    return s;
  }

  function decisao(b) {
    var p = b.r.percentuais;
    var ritmoValor = Math.round((p.D + p.I - p.S - p.C) * 10) / 10;
    var ritmo = ritmoValor >= LIMITE_RITMO ? 'rapido' : (ritmoValor <= -LIMITE_RITMO ? 'cuidadoso' : 'equilibrado');
    var pontos = { dados: 1.5 * p.C, pessoas: p.S + p.I / 2, intuicao: p.D + p.I / 2 };
    var baseDecisao = ['dados', 'pessoas', 'intuicao'].reduce(function (m, k) { return pontos[k] > pontos[m] ? k : m; }, 'dados');
    return secao('decisao', 'Como você decide',
      'Duas perguntas ajudam a entender o seu jeito de decidir: com que velocidade você costuma escolher e no que você mais se apoia para isso.',
      [DECISAO_RITMO[ritmo], DECISAO_BASE[baseDecisao], DECISAO_DICA[b.pri]],
      { ritmo: ritmo, ritmoValor: ritmoValor, base: baseDecisao });
  }

  // Parte 2 (perfil exigido): usa DISC_EXIGIDO se estiver carregado; sem ele, a seção é omitida.
  function esticando(b, exigido) {
    if (!exigido) return null;
    var EX = modulo('DISC_EXIGIDO', './disc-exigido.js');
    if (!EX || typeof EX.adaptacao !== 'function') return null;
    var ex = null;
    try {
      if (typeof exigido === 'string') ex = (EX.validar && !EX.validar(exigido)) ? null : EX.calcular(exigido);
      else if (exigido && typeof exigido === 'object') ex = exigido;
      var pctEx = ex && dadosDoResultado(ex.percentuais, ex.codigo || 'DI');
      if (!pctEx) return null;
      var a = EX.adaptacao(b.r.percentuais, pctEx.percentuais);
      if (!a) return null;
      var textos = (a.textos && a.textos.pessoa) || [];
      // Os textos da Parte 2 são frases soltas: a primeira fala do tamanho do ajuste, a última fecha a seção.
      var rotulo = a.rotulo || ({ baixa: 'Baixo', moderada: 'Moderado', alta: 'Alto', muito_alta: 'Muito alto' })[a.faixa] || '';
      var itens = textos.map(function (t, i) {
        var texto = String(t && typeof t === 'object' ? (t.texto || '') : (t == null ? '' : t));
        var titulo = t && typeof t === 'object' && t.titulo ? String(t.titulo)
          : i === 0 ? 'Esforço de adaptação: ' + rotulo.toLowerCase()
          : (i === textos.length - 1 && textos.length > 2) ? 'Como usar esta leitura'
          : 'O que o trabalho pede de diferente';
        return { titulo: titulo, texto: texto };
      }).filter(function (t) { return t.texto; });
      if (!itens.length) return null;
      return secao('esticando', 'Onde você está se esticando',
        'Comparação entre o seu jeito natural e o jeito que você sente que o trabalho pede de você. Diferenças são normais; quanto maiores, mais energia a adaptação costuma consumir.',
        itens,
        {
          indice: a.indice, faixa: a.faixa, rotulo: rotulo,
          porFator: copia([a.porFator])[0] || null,
          maisCobrado: a.maisCobrado || null, menosUsado: a.menosUsado || null,
          exigido: { percentuais: pctEx.percentuais, codigo: ex.codigo || null }
        });
    } catch (e) {
      return null;
    }
  }

  function aprofundamento(b, combinacao, regua, opcoes) {
    var pri = b.pri, sec = b.sec, out = [];
    if (combinacao) {
      out.push(secao('combinacao', 'Sua combinação: ' + combinacao.nome,
        combinacao.puro
          ? 'Seu fator principal se destaca com folga sobre os demais, por isso a sua combinação leva o nome de um perfil puro.'
          : 'O nome resume a mistura do seu fator principal com o segundo mais forte.',
        [{ titulo: combinacao.nome, texto: combinacao.descricao }],
        { codigo: combinacao.codigo, puro: combinacao.puro, nome: combinacao.nome, frase: combinacao.frase, descricao: combinacao.descricao }));
    }
    if (regua) {
      out.push(secao('intensidade', 'Régua de intensidade',
        'Além de saber qual fator vem primeiro, importa o quanto cada um aparece. Veja em que faixa está cada fator e o que isso costuma significar.',
        regua.map(function (f) {
          var extra = f.excesso || f.falta;
          return { titulo: f.nome + ': ' + f.rotulo.toLowerCase() + ' (' + f.pct + '%)', texto: f.resumo + ' ' + f.comportamento + (extra ? ' ' + extra : '') };
        }),
        { fatores: copia(regua) }));
    }
    out.push(secao('aprendizado', 'Como você aprende',
      'Conhecer o seu jeito de aprender ajuda a escolher cursos, formatos e momentos que rendem mais.',
      APRENDIZADO.PRI[pri].concat([APRENDIZADO.SEC[sec]])));
    out.push(decisao(b));
    out.push(secao('mudancas', 'Como você lida com mudanças',
      'Toda mudança pede adaptação. O que muda de pessoa para pessoa é o que facilita e o que pesa nesse processo.',
      MUDANCAS.PRI[pri].concat([MUDANCAS.SEC[sec]])));
    out.push(secao('estilo_comunicacao', 'Como você se comunica',
      'O seu jeito natural de falar e escrever, e um ajuste simples para chegar melhor a quem é diferente de você.',
      ESTILO_COMUNICACAO.PRI[pri].concat([ESTILO_COMUNICACAO.SEC[sec]])));
    out.push(secao('organizacao', 'Como você se organiza',
      'Cada estilo tem uma forma própria de planejar o tempo e as tarefas. Use o que já funciona e reforce o que costuma escapar.',
      ORGANIZACAO.PRI[pri].concat([ORGANIZACAO.SEC[sec]])));
    out.push(secao('necessidades', 'Do que você precisa no trabalho',
      'Condições que costumam ajudar você a render bem. Vale conversar sobre elas com quem coordena o seu trabalho.',
      NECESSIDADES.PRI[pri].concat([NECESSIDADES.SEC[sec]])));
    var desmotiva = DESMOTIVA.PRI[pri].slice();
    var IN = modulo('DISC_INTENSIDADE', './disc-intensidade.js');
    var faixaMenor = b.menor && IN ? IN.faixa(b.r.percentuais[b.menor]) : null;
    if (faixaMenor === 'baixa' || faixaMenor === 'muito_baixa') desmotiva.push(DESMOTIVA.MENOR[b.menor]);
    out.push(secao('desmotiva', 'O que tende a te desmotivar',
      'Situações que costumam tirar a sua energia. Reconhecê-las ajuda a se preparar e a pedir ajustes quando for possível.',
      desmotiva));
    out.push(secao('valoriza', 'O que você valoriza nos outros',
      'As qualidades que você mais percebe e aprecia nas pessoas, e um convite para enxergar também o valor de quem é diferente.',
      VALORIZA.PRI[pri].concat([VALORIZA.OUTROS[pri]])));
    var est = esticando(b, opcoes && opcoes.exigido);
    if (est) out.push(est);
    return out;
  }

  /*
   * montar(resultado, nome?, data?, opcoes?) — compatível com a versão anterior; campos novos (rodada 3):
   *   combinacao: { codigo: 'DI'|'D', puro, nome, frase, descricao } | null   (js/disc-combinacoes.js)
   *   intensidade: [{ letra, nome, pct, faixa, rotulo, resumo, comportamento, excesso, falta }] | null  (js/disc-intensidade.js)
   *   aprofundamento: seções extras na ordem abaixo, todas com { id, titulo, intro, itens: [{ titulo, texto }] }:
   *     'combinacao' (+ codigo, puro, nome, frase, descricao), 'intensidade' (+ fatores), 'aprendizado',
   *     'decisao' (+ ritmo: 'rapido'|'equilibrado'|'cuidadoso', ritmoValor, base: 'dados'|'pessoas'|'intuicao'),
   *     'mudancas', 'estilo_comunicacao', 'organizacao', 'necessidades', 'desmotiva', 'valoriza',
   *     'esticando' (só com opcoes.exigido e DISC_EXIGIDO carregado; + indice, faixa, porFator, maisCobrado, menosUsado, exigido)
   *   esticando: a mesma seção 'esticando' ou null.
   * opcoes.exigido: string de 40 dígitos (Parte 2) ou { percentuais, codigo }.
   * 'combinacao' e 'intensidade' só aparecem se os módulos estiverem carregados (no navegador, inclua os scripts antes).
   */
  function montar(rel, nome, data, opcoes) {
    var a = argumentos(data, opcoes);
    var b = base(rel, nome, a.data);
    if (!b) return null;
    var r = b.r, perfis = b.perfis, pri = b.pri, sec = b.sec, menor = b.menor;
    var plano = copia(PLANO[pri]);
    if (menor) plano.push(JSON.parse(JSON.stringify(PLANO_MENOR[menor])));
    var combinacao = combinacaoDe(r);
    var regua = reguaDe(r);
    var extras = aprofundamento(b, combinacao, regua, a.opcoes);
    var est = extras.filter(function (s) { return s.id === 'esticando'; })[0] || null;

    return {
      versao: 1,
      nome: b.primeiroNome,
      codigo: r.codigo,
      primario: perfilResumo(pri, perfis),
      secundario: perfilResumo(sec, perfis),
      frase: FRASE_PRINCIPAL[pri] + ', ' + FRASE_SECUNDARIO[sec] + '.',
      combinacao: combinacao,
      fatores: LETRAS.map(function (l) {
        return { letra: l, nome: perfis[l].nome, pct: r.percentuais[l], descricao: FATORES[l] };
      }),
      intensidade: regua,
      secoes: [
        {
          id: 'fortes',
          titulo: 'Seus pontos fortes e como usá-los mais',
          intro: 'Características que costumam acompanhar o seu estilo e jeitos práticos de aproveitá-las no dia a dia.',
          caracteristicas: copia(perfis[pri].positivos),
          itens: copia(FORTES[pri])
        },
        {
          id: 'atencao',
          titulo: 'Pontos de atenção',
          intro: 'Não são defeitos: são as suas próprias forças quando passam do ponto. Perceber isso é o primeiro passo para crescer.',
          itens: copia(ATENCAO[pri])
        },
        {
          id: 'pressao',
          titulo: 'Como você reage sob pressão',
          intro: 'Todo mundo muda um pouco sob pressão. No seu estilo, isso pode aparecer assim:',
          sinais: copia(perfis[pri].sobPressao),
          itens: copia(PRESSAO[pri])
        },
        {
          id: 'comunicacao',
          titulo: 'Como se comunicar melhor com cada perfil',
          intro: 'As pessoas à sua volta têm estilos diferentes do seu. Pequenos ajustes deixam a conversa mais fácil para os dois lados.',
          perfis: LETRAS.filter(function (l) { return l !== pri; }).map(function (l) {
            return { letra: l, nome: perfis[l].nome, rotulo: perfis[l].rotulo, texto: COMUNICACAO[l] };
          })
        },
        {
          id: 'plano',
          titulo: 'Seu plano de desenvolvimento',
          intro: 'Hábitos simples para praticar. Escolha um de cada vez e observe o que muda em 30, 60 e 90 dias.',
          itens: plano
        }
      ],
      aprofundamento: extras,
      esticando: est ? JSON.parse(JSON.stringify(est)) : null,
      aviso: AVISO
    };
  }

  /*
   * montarSimples(resultado, nome?, data?, opcoes?) — versão curta (cerca de 2 páginas):
   *   { versao: 1, variante: 'simples', nome, codigo, primario, secundario, combinacao|null, frase,
   *     fatores: [{ letra, nome, pct, faixa, rotulo, resumo }],   // faixa/rotulo/resumo null sem DISC_INTENSIDADE
   *     forcas: [3 { titulo, texto }], cuidados: [3 { titulo, texto }], habitos: [3 { prazo, titulo, texto }],
   *     esticando: { indice, faixa, texto } | null, aviso }
   */
  function montarSimples(rel, nome, data, opcoes) {
    var a = argumentos(data, opcoes);
    var b = base(rel, nome, a.data);
    if (!b) return null;
    var r = b.r, perfis = b.perfis, pri = b.pri, sec = b.sec;
    var regua = reguaDe(r);
    var habitos = copia(PLANO[pri].slice(0, 2));
    habitos.push(JSON.parse(JSON.stringify(b.menor ? PLANO_MENOR[b.menor] : PLANO[pri][2])));
    var est = esticando(b, a.opcoes && a.opcoes.exigido);
    return {
      versao: 1,
      variante: 'simples',
      nome: b.primeiroNome,
      codigo: r.codigo,
      primario: perfilResumo(pri, perfis),
      secundario: perfilResumo(sec, perfis),
      combinacao: combinacaoDe(r),
      frase: FRASE_PRINCIPAL[pri] + ', ' + FRASE_SECUNDARIO[sec] + '.',
      fatores: LETRAS.map(function (l, i) {
        var f = regua ? regua[i] : null;
        return { letra: l, nome: perfis[l].nome, pct: r.percentuais[l], faixa: f ? f.faixa : null, rotulo: f ? f.rotulo : null, resumo: f ? f.resumo : null };
      }),
      forcas: copia(FORTES[pri]).slice(0, 3),
      cuidados: copia(ATENCAO[pri]).slice(0, 3),
      habitos: habitos,
      esticando: est ? { indice: est.indice, faixa: est.faixa, texto: est.itens[0].texto } : null,
      aviso: AVISO_SIMPLES
    };
  }

  var API = {
    LETRAS: LETRAS,
    FATORES: FATORES,
    COMUNICACAO: COMUNICACAO,
    AVISO: AVISO,
    AVISO_SIMPLES: AVISO_SIMPLES,
    LIMITE_RITMO: LIMITE_RITMO,
    dadosDoResultado: dadosDoResultado,
    montar: montar,
    montarSimples: montarSimples
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.DISC_RELATORIO_PESSOA = API;
})(typeof self !== 'undefined' ? self : this);
