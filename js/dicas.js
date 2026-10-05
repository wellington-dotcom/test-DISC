/*
 * Dicas do botão "i" — explicam a pergunta e cada palavra de forma curta e simples.
 *
 * REGRA DE NEUTRALIDADE (leia antes de editar):
 *   - A dica EXPLICA o significado; NUNCA avalia. Não use elogios nem críticas
 *     ("ótimo", "excelente", "qualidade", "defeito", "ruim", "positivo", "negativo",
 *     "ideal", "melhor", "pior", "líder nato" etc.).
 *   - As 4 palavras de um grupo precisam soar igualmente aceitáveis. Palavras que
 *     parecem negativas (Ditatorial, Sarcástico, Submisso...) são descritas pelo
 *     COMPORTAMENTO, sem julgamento.
 *   - Nunca cite o nome do teste, letras, perfis ou fatores, nem dê pista de qual
 *     resposta "é melhor" ou "é a esperada pela empresa".
 *   - Linguagem simples: sentido com até ~14 palavras; exemplo começa com "Ex.:"
 *     e traz uma situação concreta em até ~16 palavras.
 *   - Respeite o contexto da pergunta: a mesma palavra pode ter sentido diferente.
 *   O teste tests/dicas.test.js verifica termos proibidos e limites de tamanho.
 */
(function (root) {
  var LETRAS = ['D', 'I', 'S', 'C'];

  // Mesmas correções de texto exibido usadas em js/app.js (palavraDoGrupo).
  var AJUSTES_PALAVRAS = { '19I': 'Relacionadas a pessoas' };

  var PALAVRAS_ORIGINAIS = [
    ['Assertiva', 'Persuasiva', 'Paciente', 'Contemplativa'],
    ['Ser decisivo', 'Amizade social', 'Ser parte de um time', 'Planejamento e ordem'],
    ['Variedade', 'Menos estrutura', 'Harmonia', 'Lógica'],
    ['Ditatorial', 'Sarcástico', 'Submisso', 'Arredio'],
    ['Franco', 'Otimista', 'Serviçal', 'Ordeiro'],
    ['Demanda ação', 'Ataca', 'Reclama', 'Evita'],
    ['Solucionador de problemas', 'Encorajador', 'Apoiador', 'Organizador'],
    ['Informa o erro diretamente', 'Chama a pessoa e explica o erro', 'Fica calado e aceita o erro', 'Se incomoda e questiona'],
    ['Crítico', 'Superficial', 'Indeciso', 'Cabeça dura'],
    ['Impaciente', 'Inoportuno', 'Indeciso', 'Inseguro'],
    ['Controle', 'Aprovação', 'Rotina', 'Padrão'],
    ['Direto', 'Desorganizado', 'Indireto', 'Detalhista'],
    ['Perder', 'Rejeição', 'Mudanças bruscas', 'Estar errado'],
    ['Resultados', 'Reconhecimento', 'Compatibilidade', 'Precisão'],
    ['Orgulhoso', 'Permissivo', 'Humilde', 'Cauteloso'],
    ['Independente', 'Interativo', 'Estável', 'Corretivo'],
    ['Intenso', 'Não tradicional', 'Indeciso', 'Impessoal'],
    ['Ser responsabilizado', 'Realizar compromissos', 'Necessidade de mudança', 'Tomada de decisão'],
    ['Histórico', 'Elogios', 'Contribuição', 'Qualidade dos resultados'],
    ['Desafiadoras', 'Relacionada a pessoas', 'Agendadas', 'Estruturadas'],
    ['Se irrita e confronta', 'Nem liga, está distraído', 'Sabe do atraso, mas aceita', 'Reclama e analisa a situação'],
    ['Se preocupa demais com metas', 'Fala sem pensar', 'Procrastina ao invés de fazer', 'Analisa demais'],
    ['Empatia e Paciência', 'Controle emocional', 'Ser assertivo sob pressão', 'Se preocupar menos sobre tudo'],
    ['Busca ter a razão', 'Busca diminuir o conflito', 'Busca concordância', 'Busca comprovar sua opinião'],
    ['Sabe o que quer', 'Se diverte', 'Fica indeciso', 'Busca ofertas']
  ];

  var perguntas = [
    'Como você costuma se comportar no dia a dia.',
    'Em que tipo de situação você se sente à vontade.',
    'O que você gostaria de ter mais no trabalho ou na vida.',
    'Como você tende a ficar quando está muito pressionado.',
    'O jeito de ser que mais aparece em você.',
    'O que você costuma fazer quando há uma briga ou desentendimento.',
    'No que você mais ajuda as pessoas ou o trabalho.',
    'O que você faz quando alguém comete um erro.',
    'Outra forma de como você pode ficar quando está muito pressionado.',
    'Como outras pessoas às vezes podem ver você.',
    'O que você precisa ter para se sentir bem no trabalho.',
    'Um jeito seu que às vezes atrapalha um pouco.',
    'O que mais te preocupa ou te deixa com receio.',
    'Como você sabe se fez um bom trabalho.',
    'Como você trata as pessoas que estão sob sua responsabilidade.',
    'O seu jeito mais comum de fazer o trabalho.',
    'Outro jeito seu que às vezes atrapalha um pouco.',
    'O que é mais difícil para você.',
    'Outra forma de saber se você fez um bom trabalho.',
    'Que tipo de tarefa você prefere fazer.',
    'O que você faz quando algo ou alguém atrasa.',
    'Como você reage em momentos de muita pressão.',
    'O que você sente que ainda precisa desenvolver em você.',
    'O que você procura quando está discutindo com alguém.',
    'Como você costuma agir quando vai comprar algo.'
  ];

  function p(sentido, exemplo) { return { sentido: sentido, exemplo: exemplo }; }

  var palavras = [
    // 0 Costumo agir de forma...
    {
      D: p('Fala o que pensa com firmeza e segurança.', 'Ex.: Digo claramente o que precisa ser feito na tarefa.'),
      I: p('Consegue convencer as pessoas com sua conversa.', 'Ex.: Convenço o colega a testar uma ideia nova comigo.'),
      S: p('Sabe esperar com calma, sem pressa.', 'Ex.: Espero a minha vez na fila sem me irritar.'),
      C: p('Para, observa e pensa bastante antes de agir.', 'Ex.: Penso em todos os passos antes de começar a tarefa.')
    },
    // 1 Eu me sinto confortável com...
    {
      D: p('Tomar decisões rápido, sem ficar em dúvida.', 'Ex.: Escolho logo o que fazer quando surge um problema.'),
      I: p('Estar com pessoas, conversar e fazer amizades.', 'Ex.: Gosto de conversar com os colegas no intervalo.'),
      S: p('Trabalhar junto com um grupo de pessoas.', 'Ex.: Prefiro fazer a tarefa junto com a equipe.'),
      C: p('Ter um plano e as coisas no lugar certo.', 'Ex.: Faço uma lista do que vou fazer antes de começar.')
    },
    // 2 Eu desejo...
    {
      D: p('Fazer coisas diferentes, sem repetir sempre o mesmo.', 'Ex.: Gosto quando cada dia de trabalho traz algo novo.'),
      I: p('Ter menos regras e mais liberdade para fazer do seu jeito.', 'Ex.: Prefiro fazer a tarefa sem seguir um passo a passo fixo.'),
      S: p('Paz e bom convívio entre as pessoas.', 'Ex.: Gosto quando todos na equipe se dão bem.'),
      C: p('Que as coisas façam sentido e tenham explicação.', 'Ex.: Quero entender o motivo de uma regra antes de seguir.')
    },
    // 3 Sob estresse, posso me tornar...
    {
      D: p('Passa a decidir sozinho e dar ordens, sem abrir espaço para opinião.', 'Ex.: Na correria, eu mesmo decido e digo a cada um o que fazer.'),
      I: p('Usa brincadeiras ou ironias para mostrar incômodo.', 'Ex.: Faço uma piada com o atraso do colega em vez de reclamar.'),
      S: p('Aceita o que os outros querem, sem discordar.', 'Ex.: Faço do jeito do outro, mesmo pensando diferente.'),
      C: p('Se afasta das pessoas e fica mais na sua.', 'Ex.: Quando estou tenso, prefiro ficar quieto no meu canto.')
    },
    // 4 Minha principal característica é ser...
    {
      D: p('Fala a verdade de forma direta, sem rodeios.', 'Ex.: Digo ao colega exatamente o que penso do trabalho dele.'),
      I: p('Acredita que as coisas vão dar certo.', 'Ex.: Mesmo com problema, acho que vamos conseguir resolver.'),
      S: p('Gosta de ajudar e servir as pessoas.', 'Ex.: Ofereço ajuda ao colega que está cheio de tarefas.'),
      C: p('Gosta de ordem, regras e tudo arrumado.', 'Ex.: Deixo minhas ferramentas sempre no mesmo lugar.')
    },
    // 5 Em um conflito, sou alguém que...
    {
      D: p('Cobra que algo seja feito logo para resolver.', 'Ex.: Peço uma solução na hora quando surge um desentendimento.'),
      I: p('Responde na hora, falando de forma forte.', 'Ex.: Se alguém me acusa, respondo de imediato e em tom alto.'),
      S: p('Mostra que está insatisfeito, falando do incômodo.', 'Ex.: Conto a um colega que não gostei do que aconteceu.'),
      C: p('Prefere se afastar e não entrar na discussão.', 'Ex.: Saio de perto quando começa uma briga.')
    },
    // 6 Meu ponto forte é ser...
    {
      D: p('Quem encontra saídas quando algo dá errado.', 'Ex.: A máquina parou e eu procuro logo um jeito de resolver.'),
      I: p('Quem anima e dá força para as pessoas.', 'Ex.: Digo ao colega cansado que ele vai conseguir.'),
      S: p('Quem está junto e ajuda quando precisam.', 'Ex.: Fico até o fim ajudando o colega a terminar a tarefa.'),
      C: p('Quem arruma, planeja e põe as coisas em ordem.', 'Ex.: Separo as tarefas do dia e organizo o local de trabalho.')
    },
    // 7 Diante de um erro, sou alguém que...
    {
      D: p('Fala do erro na hora, de forma direta.', 'Ex.: Vejo o erro e já digo ao colega o que está errado.'),
      I: p('Conversa com a pessoa e mostra como fazer.', 'Ex.: Chamo o colega de lado e explico como corrigir.'),
      S: p('Não comenta e deixa passar.', 'Ex.: Vejo o erro, mas não falo nada para ninguém.'),
      C: p('Fica incomodado e pergunta por que aconteceu.', 'Ex.: Pergunto como o erro aconteceu e o que faltou conferir.')
    },
    // 8 Sob estresse, também posso ficar...
    {
      D: p('Aponta com mais frequência o que está errado.', 'Ex.: Na pressão, comento tudo o que vejo fora do lugar.'),
      I: p('Olha as coisas por cima, sem entrar em detalhes.', 'Ex.: Na correria, confiro a tarefa só rapidamente.'),
      S: p('Tem dificuldade para escolher o que fazer.', 'Ex.: Fico em dúvida entre duas opções e demoro a decidir.'),
      C: p('Mantém sua opinião e não muda de ideia facilmente.', 'Ex.: Mesmo com outros discordando, continuo fazendo do meu jeito.')
    },
    // 9 Às vezes, posso ser visto(a) como...
    {
      D: p('Quer que as coisas aconteçam rápido e não gosta de esperar.', 'Ex.: Fico agitado quando a reunião demora a começar.'),
      I: p('Fala ou age em momentos que os outros não esperam.', 'Ex.: Conto uma novidade enquanto o colega está concentrado.'),
      S: p('Demora para decidir e fica em dúvida.', 'Ex.: Penso muito antes de escolher qual tarefa fazer primeiro.'),
      C: p('Não tem certeza se está fazendo do jeito certo.', 'Ex.: Pergunto de novo para confirmar antes de entregar.')
    },
    // 10 Eu preciso de...
    {
      D: p('Ter o comando da situação e decidir os rumos.', 'Ex.: Gosto de decidir como a tarefa vai ser feita.'),
      I: p('Saber que as pessoas gostam e aceitam você.', 'Ex.: Gosto quando o grupo concorda com a minha ideia.'),
      S: p('Fazer as coisas do mesmo jeito todo dia.', 'Ex.: Gosto de saber o horário e as tarefas de cada dia.'),
      C: p('Ter um modelo certo a seguir, sempre igual.', 'Ex.: Sigo o mesmo passo a passo em toda entrega.')
    },
    // 11 Uma limitação minha é ser...
    {
      D: p('Fala as coisas sem suavizar as palavras.', 'Ex.: Digo "isso está errado" sem rodeios.'),
      I: p('Tem dificuldade para manter coisas e horários em ordem.', 'Ex.: Às vezes esqueço onde deixei um documento.'),
      S: p('Dá a mensagem com rodeios, sem falar claramente.', 'Ex.: Dou uma indireta em vez de pedir algo ao colega.'),
      C: p('Presta atenção em cada pequeno detalhe.', 'Ex.: Confiro várias vezes a mesma tarefa antes de entregar.')
    },
    // 12 Tenho medo de...
    {
      D: p('Não alcançar o que queria ou ficar para trás.', 'Ex.: Fico preocupado em não bater a meta do mês.'),
      I: p('Não ser aceito ou ser deixado de lado.', 'Ex.: Fico chateado se não me chamam para o almoço do grupo.'),
      S: p('Mudanças grandes que acontecem de repente.', 'Ex.: Fico inseguro quando mudam meu setor sem aviso.'),
      C: p('Fazer algo errado ou dar uma resposta errada.', 'Ex.: Confiro antes de entregar para não ter erro.')
    },
    // 13 Meço meu desempenho por meio de...
    {
      D: p('O que foi entregue e alcançado no fim.', 'Ex.: Vejo se bati a meta ou terminei a tarefa.'),
      I: p('As pessoas notarem e valorizarem seu trabalho.', 'Ex.: Fico feliz quando o chefe comenta meu trabalho.'),
      S: p('Se o trabalho combina e se encaixa com o da equipe.', 'Ex.: Vejo se minha parte ajudou o grupo a andar junto.'),
      C: p('Fazer tudo certo, sem erros e com exatidão.', 'Ex.: Vejo se as contas e medidas ficaram exatas.')
    },
    // 14 Com pessoas que lidero, costumo ser...
    {
      D: p('Mostra que tem orgulho do que sabe e do que faz.', 'Ex.: Gosto de mostrar à equipe como eu resolveria o problema.'),
      I: p('Deixa as pessoas fazerem do jeito delas, sem cobrar muito.', 'Ex.: Deixo a equipe escolher o horário de cada tarefa.'),
      S: p('Trata todos de igual para igual, sem se colocar acima.', 'Ex.: Ajudo a equipe na tarefa como qualquer outro colega.'),
      C: p('Age com cuidado e pensa antes de decidir.', 'Ex.: Analiso bem antes de passar uma tarefa para alguém.')
    },
    // 15 Meu jeito de trabalhar é...
    {
      D: p('Faz as coisas sozinho, sem depender dos outros.', 'Ex.: Resolvo a tarefa por conta própria, sem pedir ajuda.'),
      I: p('Trabalha conversando e trocando ideias com as pessoas.', 'Ex.: Converso com os colegas enquanto fazemos a tarefa.'),
      S: p('Mantém o mesmo ritmo, com calma e constância.', 'Ex.: Faço meu trabalho no mesmo ritmo todos os dias.'),
      C: p('Procura o que está errado para consertar.', 'Ex.: Reviso o trabalho e corrijo o que não ficou certo.')
    },
    // 16 Outra limitação minha é ser...
    {
      D: p('Faz tudo com muita força e energia.', 'Ex.: Me envolvo tanto na tarefa que esqueço de fazer pausas.'),
      I: p('Não segue o jeito de sempre, faz diferente.', 'Ex.: Mudo a forma de fazer a tarefa mesmo sem precisar.'),
      S: p('Demora para decidir e fica em dúvida.', 'Ex.: Peço a opinião de outros antes de escolher.'),
      C: p('Foca na tarefa e deixa os sentimentos de lado.', 'Ex.: Falo só do trabalho, sem conversa pessoal.')
    },
    // 17 Tenho mais dificuldade com...
    {
      D: p('Ter que responder pelos resultados ou erros.', 'Ex.: Me incomoda ter que explicar ao chefe por que algo falhou.'),
      I: p('Cumprir o que foi combinado, no prazo.', 'Ex.: Às vezes marco algo e acabo me atrasando.'),
      S: p('Aceitar quando algo precisa mudar.', 'Ex.: Demoro a me acostumar com um novo sistema no trabalho.'),
      C: p('Escolher e decidir, principalmente sem tempo.', 'Ex.: Fico travado quando preciso decidir algo na hora.')
    },
    // 18 Também meço meu desempenho por meio de...
    {
      D: p('O que já conseguiu fazer até hoje.', 'Ex.: Olho tudo o que já entreguei nos últimos meses.'),
      I: p('Ouvir das pessoas que fez um bom trabalho.', 'Ex.: Fico contente quando um cliente agradece meu atendimento.'),
      S: p('O quanto ajudou o grupo a chegar lá.', 'Ex.: Vejo se minha parte ajudou a equipe a terminar.'),
      C: p('Trabalho bem-feito, caprichado e sem falhas.', 'Ex.: Vejo se a peça saiu certinha, sem nada para corrigir.')
    },
    // 19 Prefiro tarefas...
    {
      D: p('Difíceis, que exigem esforço para vencer.', 'Ex.: Gosto quando me dão um problema complicado para resolver.'),
      I: p('Que envolvem falar e lidar com pessoas.', 'Ex.: Gosto de atender clientes e conversar com eles.'),
      S: p('Marcadas com dia e hora, sem surpresas.', 'Ex.: Gosto de saber de manhã tudo o que farei no dia.'),
      C: p('Com passos claros e bem definidos.', 'Ex.: Gosto de tarefas que têm um passo a passo para seguir.')
    },
    // 20 Diante de atrasos, sou alguém que...
    {
      D: p('Fica irritado e fala direto com quem atrasou.', 'Ex.: Cobro o colega na hora quando ele chega atrasado.'),
      I: p('Não dá muita atenção ao atraso, está com a cabeça em outra coisa.', 'Ex.: Nem percebo que o colega chegou tarde.'),
      S: p('Percebe o atraso, mas aceita sem reclamar.', 'Ex.: Vejo que o pedido atrasou e espero com calma.'),
      C: p('Comenta o incômodo e tenta entender o motivo.', 'Ex.: Reclamo do atraso e vejo o que causou o problema.')
    },
    // 21 Em situações extremas, sou alguém que...
    {
      D: p('Pensa muito em bater as metas e no resultado.', 'Ex.: Na pressão, só penso em cumprir a meta do dia.'),
      I: p('Fala no impulso, antes de pensar bem.', 'Ex.: Respondo na hora e depois percebo que podia ter dito diferente.'),
      S: p('Deixa para depois o que precisa fazer agora.', 'Ex.: Adio uma tarefa difícil para o dia seguinte.'),
      C: p('Pensa e repensa muito antes de agir.', 'Ex.: Fico revendo as opções várias vezes antes de começar.')
    },
    // 22 Preciso melhorar...
    {
      D: p('Entender o lado do outro e saber esperar.', 'Ex.: Escutar o colega até o fim antes de responder.'),
      I: p('Controlar as emoções em momentos difíceis.', 'Ex.: Manter a calma quando um cliente fala alto comigo.'),
      S: p('Falar com firmeza quando há pressão.', 'Ex.: Dizer "não consigo" quando me passam tarefas demais.'),
      C: p('Se preocupar menos com tudo ao redor.', 'Ex.: Entregar a tarefa sem revisar tantas vezes.')
    },
    // 23 Em uma discussão, sou alguém que...
    {
      D: p('Quer sair da conversa com a razão.', 'Ex.: Defendo meu ponto até o fim da conversa.'),
      I: p('Tenta acalmar e diminuir a briga.', 'Ex.: Faço uma brincadeira para aliviar o clima.'),
      S: p('Procura que todos cheguem a um acordo.', 'Ex.: Proponho um meio-termo que agrade os dois lados.'),
      C: p('Mostra fatos e provas do que está dizendo.', 'Ex.: Mostro o documento que comprova o que eu disse.')
    },
    // 24 Quando vou às compras, sou alguém que...
    {
      D: p('Já sabe o que vai comprar e vai direto.', 'Ex.: Entro na loja, pego o que preciso e vou embora.'),
      I: p('Aproveita o passeio e se distrai comprando.', 'Ex.: Gosto de olhar as lojas e passear com amigos.'),
      S: p('Tem dificuldade para escolher entre as opções.', 'Ex.: Fico em dúvida entre duas camisas e demoro a escolher.'),
      C: p('Compara preços e procura promoções.', 'Ex.: Pesquiso em várias lojas antes de comprar.')
    }
  ];

  function normalizar(t) {
    t = String(t == null ? '' : t).trim().toLowerCase();
    try { t = t.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) { /* sem normalize */ }
    return t;
  }

  function palavraExibida(i, letra) {
    return AJUSTES_PALAVRAS[i + letra] || (PALAVRAS_ORIGINAIS[i] ? PALAVRAS_ORIGINAIS[i][LETRAS.indexOf(letra)] : '');
  }

  // Aceita a letra ('D','I','S','C') ou o texto da palavra (exibido ou original).
  function resolverLetra(i, chave) {
    var k = String(chave == null ? '' : chave).trim();
    if (LETRAS.indexOf(k.toUpperCase()) !== -1 && k.length === 1) return k.toUpperCase();
    var n = normalizar(k);
    for (var j = 0; j < LETRAS.length; j++) {
      var L = LETRAS[j];
      if (normalizar(palavraExibida(i, L)) === n) return L;
      if (PALAVRAS_ORIGINAIS[i] && normalizar(PALAVRAS_ORIGINAIS[i][j]) === n) return L;
    }
    return null;
  }

  function dicaPergunta(i) {
    return perguntas[i] || '';
  }

  function dicaPalavra(i, letra) {
    var L = resolverLetra(i, letra);
    var d = L && palavras[i] && palavras[i][L];
    if (!d) return null;
    return { palavra: palavraExibida(i, L), sentido: d.sentido, exemplo: d.exemplo };
  }

  var DISC_DICAS = {
    perguntas: perguntas,
    palavras: palavras,
    dicaPergunta: dicaPergunta,
    dicaPalavra: dicaPalavra
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = DISC_DICAS;
  else root.DISC_DICAS = DISC_DICAS;
})(typeof self !== 'undefined' ? self : this);
