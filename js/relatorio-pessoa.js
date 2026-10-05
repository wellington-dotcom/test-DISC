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

  function montar(rel, nome, data) {
    var r = rel ? dadosDoResultado(rel.percentuais, rel.codigo) : null;
    var D = dadosDisc(data);
    if (!r || !D || !D.perfis) return null;
    var perfis = D.perfis;
    var pri = r.codigo.charAt(0), sec = r.codigo.charAt(1);
    if (!perfis[pri] || !perfis[sec]) return null;
    var primeiroNome = String(nome == null ? '' : nome).replace(/\s+/g, ' ').trim().split(' ')[0] || '';
    // Fator menos presente (empate: o último na ordem D, I, S, C), diferente do principal e do secundário.
    var menor = null;
    LETRAS.forEach(function (l) {
      if (l === pri || l === sec) return;
      if (menor === null || r.percentuais[l] <= r.percentuais[menor]) menor = l;
    });
    var plano = copia(PLANO[pri]);
    if (menor) plano.push(JSON.parse(JSON.stringify(PLANO_MENOR[menor])));

    return {
      versao: 1,
      nome: primeiroNome,
      codigo: r.codigo,
      primario: perfilResumo(pri, perfis),
      secundario: perfilResumo(sec, perfis),
      frase: FRASE_PRINCIPAL[pri] + ', ' + FRASE_SECUNDARIO[sec] + '.',
      fatores: LETRAS.map(function (l) {
        return { letra: l, nome: perfis[l].nome, pct: r.percentuais[l], descricao: FATORES[l] };
      }),
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
      aviso: AVISO
    };
  }

  var API = {
    LETRAS: LETRAS,
    FATORES: FATORES,
    COMUNICACAO: COMUNICACAO,
    AVISO: AVISO,
    dadosDoResultado: dadosDoResultado,
    montar: montar
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.DISC_RELATORIO_PESSOA = API;
})(typeof self !== 'undefined' ? self : this);
