/*
 * Conteúdo do Teste DISC — extraído da planilha "Teste de Perfil DISC - Completo Planilha modelo.xlsx".
 * 25 grupos (5 blocos x 5 colunas). Em cada grupo, cada letra (D, I, S, C) tem uma palavra.
 * O candidato ordena as 4 palavras de 4 (mais se identifica) a 1 (menos se identifica).
 * FONTE ÚNICA DE VERDADE: não duplique este conteúdo em outros arquivos.
 */
(function (root) {
  var DISC_DATA = {
  "grupos": [
    {
      "titulo": "Tende a agir de forma...",
      "D": "Assertiva",
      "I": "Persuasiva",
      "S": "Paciente",
      "C": "Contemplativa"
    },
    {
      "titulo": "Confortável com...",
      "D": "Ser decisivo",
      "I": "Amizade social",
      "S": "Ser parte de um time",
      "C": "Planejamento e ordem"
    },
    {
      "titulo": "Desejo de...",
      "D": "Variedade",
      "I": "Menos estrutura",
      "S": "Harmonia",
      "C": "Lógica"
    },
    {
      "titulo": "Sob estresse pode se tornar...",
      "D": "Ditatorial",
      "I": "Sarcástico",
      "S": "Submisso",
      "C": "Arredio"
    },
    {
      "titulo": "Característica principal...",
      "D": "Franco",
      "I": "Otimista",
      "S": "Serviçal",
      "C": "Ordeiro"
    },
    {
      "titulo": "Quando em conflito, esse estilo…",
      "D": "Demanda ação",
      "I": "Ataca",
      "S": "Reclama",
      "C": "Evita"
    },
    {
      "titulo": "Força aparente...",
      "D": "Solucionador de problemas",
      "I": "Encorajador",
      "S": "Apoiador",
      "C": "Organizador"
    },
    {
      "titulo": "Com erros...",
      "D": "Informa o erro diretamente",
      "I": "Chama a pessoa e explica o erro",
      "S": "Fica calado e aceita o erro",
      "C": "Se incomoda e questiona"
    },
    {
      "titulo": "Sob estresse pode se tornar...",
      "D": "Crítico",
      "I": "Superficial",
      "S": "Indeciso",
      "C": "Cabeça dura"
    },
    {
      "titulo": "Pode ser considerado...",
      "D": "Impaciente",
      "I": "Inoportuno",
      "S": "Indeciso",
      "C": "Inseguro"
    },
    {
      "titulo": "Necessita de....",
      "D": "Controle",
      "I": "Aprovação",
      "S": "Rotina",
      "C": "Padrão"
    },
    {
      "titulo": "Limitação desse perfil...",
      "D": "Direto",
      "I": "Desorganizado",
      "S": "Indireto",
      "C": "Detalhista"
    },
    {
      "titulo": "Possui medo de...",
      "D": "Perder",
      "I": "Rejeição",
      "S": "Mudanças bruscas",
      "C": "Estar errado"
    },
    {
      "titulo": "Mensura desempenho com...",
      "D": "Resultados",
      "I": "Reconhecimento",
      "S": "Compatibilidade",
      "C": "Precisão"
    },
    {
      "titulo": "Com subalternos, costuma ser...",
      "D": "Orgulhoso",
      "I": "Permissivo",
      "S": "Humilde",
      "C": "Cauteloso"
    },
    {
      "titulo": "Abordagem primária...",
      "D": "Independente",
      "I": "Interativo",
      "S": "Estável",
      "C": "Corretivo"
    },
    {
      "titulo": "Outra limitação desse perfil...",
      "D": "Intenso",
      "I": "Não tradicional",
      "S": "Indeciso",
      "C": "Impessoal"
    },
    {
      "titulo": "Ponto cego...",
      "D": "Ser responsabilizado",
      "I": "Realizar compromissos",
      "S": "Necessidade de mudança",
      "C": "Tomada de decisão"
    },
    {
      "titulo": "Mensura desempenho com...",
      "D": "Histórico",
      "I": "Elogios",
      "S": "Contribuição",
      "C": "Qualidade dos resultados"
    },
    {
      "titulo": "Prefere tarefas....",
      "D": "Desafiadoras",
      "I": "Relacionada a pessoas",
      "S": "Agendadas",
      "C": "Estruturadas"
    },
    {
      "titulo": "Com atrasos...",
      "D": "Se irrita e confronta",
      "I": "Nem liga, está distraído",
      "S": "Sabe do atraso, mas aceita",
      "C": "Reclama e analisa a situação"
    },
    {
      "titulo": "Em situações extremas...",
      "D": "Se preocupa demais com metas",
      "I": "Fala sem pensar",
      "S": "Procrastina ao invés de fazer",
      "C": "Analisa demais"
    },
    {
      "titulo": "Precisa melhorar...",
      "D": "Empatia e Paciência",
      "I": "Controle emocional",
      "S": "Ser assertivo sob pressão",
      "C": "Se preocupar menos sobre tudo"
    },
    {
      "titulo": "Em uma discussão...",
      "D": "Busca ter a razão",
      "I": "Busca diminuir o conflito",
      "S": "Busca concordância",
      "C": "Busca comprovar sua opinião"
    },
    {
      "titulo": "Quando vai às compras...",
      "D": "Sabe o que quer",
      "I": "Se diverte",
      "S": "Fica indeciso",
      "C": "Busca ofertas"
    }
  ],
  "perfis": {
    "D": {
      "nome": "Dominância",
      "rotulo": "Dominante",
      "cor": "#d64545",
      "positivos": [
        "Aventureiro",
        "Com iniciativa",
        "Competitivo",
        "Determinado",
        "Direto",
        "Responsável",
        "Exigente",
        "Foco nos resultados",
        "Líder",
        "Ousado",
        "Persistente",
        "Pioneiro",
        "Superador",
        "Resolve problemas"
      ],
      "valorEquipe": [
        "Coordenador",
        "Inovador",
        "Previdente",
        "Tem iniciativa",
        "Voltado para o desafio"
      ],
      "ambienteIdeal": [
        "Debate para expressar pontos de vista",
        "Livre de controle, supervisão e detalhes",
        "Trabalho com desafios e oportunidades",
        "Um ambiente inovador",
        "Um trabalho que não seja rotineiro"
      ],
      "sobPressao": [
        "Exigente",
        "Nervoso",
        "Agressivo",
        "Egoísta"
      ],
      "limitantes": [
        "Ser arrogante",
        "Aproveita-se de sua posição",
        "Atribui-se muitas coisas",
        "Correr muitos riscos",
        "Cria medo nas pessoas",
        "Exigências muito altas",
        "Falar sem pensar",
        "Falta de tato e diplomacia",
        "Não recebe bem feedback",
        "Não ser um bom ouvinte",
        "Problemas de delegação",
        "Ser impaciente",
        "Ser insensível com pessoas",
        "Ser multitarefa e não dar conta"
      ]
    },
    "I": {
      "nome": "Influência",
      "rotulo": "Influente",
      "cor": "#e0a100",
      "positivos": [
        "Atencioso",
        "Bom humor",
        "Caloroso",
        "Confiante",
        "Confidente",
        "Convincente",
        "Encantador",
        "Entusiasta",
        "Inspirador",
        "Otimista",
        "Persuasivo",
        "Político",
        "Popular",
        "Sociável"
      ],
      "valorEquipe": [
        "Criativo, resolve conflitos",
        "Joga em equipe",
        "Motiva os demais a alcançar seus objetivos",
        "Negocia conflitos",
        "Otimista e entusiasta"
      ],
      "ambienteIdeal": [
        "Contato constante com as pessoas",
        "Debate para ouvir ideias",
        "Liberdade de movimento",
        "Livre de controle e detalhes",
        "Supervisor democrático com quem se associar"
      ],
      "sobPressao": [
        "Falante",
        "Muito otimista",
        "Pouco realista",
        "Se autopromove"
      ],
      "limitantes": [
        "Abandonar quando há conflito",
        "Confia indiscriminadamente nas pessoas",
        "Demasiadamente otimista",
        "Desatento para os detalhes",
        "Falar muito rápido (ruído)",
        "Falar sem pensar",
        "Não ouve em todas as ocasiões",
        "Perde o foco com facilidade",
        "Pouco realista ao avaliar as pessoas",
        "Problemas com o tempo",
        "Problemas em completar tarefas",
        "Problemas na comunicação",
        "Ser desorganizado",
        "Ser indireto na comunicação"
      ]
    },
    "S": {
      "nome": "Estabilidade",
      "rotulo": "Estável",
      "cor": "#2f9e6e",
      "positivos": [
        "Amável",
        "Amigável",
        "Apaziguador",
        "Calmo",
        "Compreensivo",
        "Confiável",
        "Consciente",
        "Descontraído",
        "Grande ouvinte",
        "Leal",
        "Paciente",
        "Planejador",
        "Sabe escutar",
        "Sincero"
      ],
      "valorEquipe": [
        "Joga em equipe",
        "Lógico, analisa",
        "Orientado para o serviço",
        "Paciente e enérgico",
        "Trabalha para um líder e por uma causa"
      ],
      "ambienteIdeal": [
        "Ambiente estável e previsível",
        "Ambiente que lhe permita mudar",
        "Liberdade de normas de restrição",
        "Pouco conflito entre as pessoas",
        "Relações de trabalho duradouras"
      ],
      "sobPressao": [
        "Despreocupado",
        "Indeciso",
        "Inflexível",
        "Reservado"
      ],
      "limitantes": [
        "Cede, evita controvérsia",
        "Correr pouquíssimo risco",
        "Dificuldade em estabelecer prioridades",
        "Dificuldade para lidar com diversas situações",
        "Falta iniciativa",
        "Fazer uma coisa de cada vez",
        "Guardar rancor",
        "Não gosta de mudanças repentinas",
        "Não gostar de mudanças",
        "Não ter muita ambição",
        "Pouco expansível",
        "Ser lento",
        "Ser possessivo",
        "Ser tolerante demais"
      ]
    },
    "C": {
      "nome": "Conformidade",
      "rotulo": "Cauteloso",
      "cor": "#3b6fd6",
      "positivos": [
        "Acabador",
        "Alto padrão de qualidade",
        "Analítico",
        "Consciente",
        "Cuidadoso",
        "Diplomático",
        "Exato",
        "Faz boas perguntas",
        "Firme",
        "Maduro",
        "Paciente",
        "Pensa objetivamente",
        "Preciso",
        "Procura realizações"
      ],
      "valorEquipe": [
        "Compreensivo, resolve problemas",
        "Consciente e consistente",
        "Define, esclarece, obtém a informação e a põe à prova",
        "Mantém padrões altos",
        "Objetivo: “estar ancorado na realidade”"
      ],
      "ambienteIdeal": [
        "Ambiente de trabalho familiar",
        "Cargo técnico ou em uma área especializada",
        "Escritório ou área de trabalho privada",
        "Onde é necessário pensamento crítico",
        "Relação estreita com um grupo pequeno"
      ],
      "sobPressao": [
        "Difícil de agradar",
        "Meticuloso",
        "Muito crítico",
        "Pessimista"
      ],
      "limitantes": [
        "Arrogante quando contrariado",
        "Correr pouco risco",
        "Defensivo às críticas",
        "Inflexível",
        "Internalizar sentimentos",
        "Muito intenso em determinadas situações",
        "Ótimo é inimigo do bom",
        "Parece distante e frio",
        "Requer dados demais",
        "Se apega aos detalhes",
        "Ser muito crítico",
        "Ser muito duro consigo",
        "Ser muito lento para agir"
      ]
    }
  }
};
  if (typeof module !== 'undefined' && module.exports) module.exports = DISC_DATA;
  else root.DISC_DATA = DISC_DATA;
})(typeof self !== 'undefined' ? self : this);
