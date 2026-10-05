/*
 * Inteligência de compatibilidade de equipe — motor PURO (sem DOM, sem rede).
 *
 * Entrada de montar(dados):
 *   {
 *     empresa: { nome },
 *     pessoas: [ { id, nome, cargo, percentuais: {D,I,S,C} | null } ],   // null = ainda não fez o teste
 *     relacoes: [ { de, para, tipo: 'lidera' | 'direto' | 'indireto' } ], // 'lidera': de é líder de para
 *     foco: id | null                                                       // opcional
 *   }
 *
 * Saída (serializável): { empresa, equipe, pares, liderancas, foco, organograma, avisos }
 *   - pares[]: { de, para, tipo, peso, nivel: 'fluido'|'atencao'|'tensao'|'indefinido',
 *                pontuacao (0–100 | null), sinergias[], riscos[], dicas[] }
 *   - nomes sempre como "Primeiro S."; só id, nome curto e cargo saem da entrada
 *     (qualquer outro campo — idade, gênero, telefone… — é ignorado).
 *
 * Regras (teoria DISC): ritmo rápido (D+I) × cauteloso (S+C); foco em tarefas (D+C) ×
 * pessoas (I+S); regras específicas por par de fatores altos (≥ 30%, média 25%), com
 * intensidade proporcional ao percentual. 'lidera' e 'direto' pesam 1; 'indireto' 0,6.
 */
(function (root) {
  var LETRAS = ['D', 'I', 'S', 'C'];
  var ALTO = 30;                 // fator "alto" (acima da média de 25%)
  var LIMIAR_EQUILIBRADO = 8;    // amplitude entre maior e menor fator
  var BASE = 72;
  var PESO = { lidera: 1, direto: 1, indireto: 0.6 };
  var TIPOS = ['lidera', 'direto', 'indireto'];
  var NOMES = { D: 'Dominância', I: 'Influência', S: 'Estabilidade', C: 'Conformidade' };
  var PARTICULAS = { de: 1, da: 1, das: 1, 'do': 1, dos: 1, e: 1, di: 1, du: 1, del: 1, van: 1, von: 1 };

  var AVISOS_LIMITE = [
    'O DISC descreve estilo de comportamento no trabalho, não competência, inteligência nem caráter; não use como critério único de contratação, promoção ou desligamento.',
    'Compatibilidade indica onde a convivência tende a fluir ou exigir combinados — não prevê desempenho. Qualquer dupla pode trabalhar bem com papéis e acordos claros.',
    'As leituras partem do autorrelato de cada pessoa e mudam com contexto, cargo e tempo; confirme em conversa antes de agir.'
  ];

  // Texto de risco quando ninguém tem o fator alto / quando o fator está em excesso.
  var FALTA = {
    D: 'Ninguém com Dominância alta: risco de decisões lentas, pouca cobrança por resultado e dificuldade em destravar impasses.',
    I: 'Ninguém com Influência alta: risco de pouca energia na comunicação, menos networking e dificuldade em engajar clientes e outras áreas.',
    S: 'Ninguém com Estabilidade alta: risco de pouca constância, rotinas abandonadas no meio e menor cuidado com o clima da equipe.',
    C: 'Ninguém com Conformidade alta: risco em processos e qualidade — erros de detalhe, pouca documentação e controles frágeis.'
  };
  var EXCESSO = {
    D: 'Dominância em excesso: risco de disputa por controle, decisões impulsivas e clima de pressão constante.',
    I: 'Influência em excesso: muita ideia e conversa, risco de pouca execução, prazos perdidos e falta de acompanhamento.',
    S: 'Estabilidade em excesso: risco de resistência a mudanças, conflitos evitados e ritmo lento diante de urgências.',
    C: 'Conformidade em excesso: risco de perfeccionismo, análise demais e decisões travadas à espera de certeza.'
  };
  var FORCA = {
    D: 'traz senso de urgência e foco em resultado',
    I: 'traz comunicação, entusiasmo e facilidade de engajar pessoas',
    S: 'traz constância, paciência e cuidado com o clima da equipe',
    C: 'traz rigor, qualidade e atenção a processos'
  };
  var ESTILO_LIDERAR = {
    D: 'Tende a liderar de forma direta e orientada a metas: decide rápido, cobra resultado e dá autonomia a quem entrega, mas pode soar impaciente e pouco presente no "como".',
    I: 'Tende a liderar pelo entusiasmo e pela inspiração: motiva, reconhece em público e abre espaço para ideias, mas pode ser vago(a) em instruções e no acompanhamento.',
    S: 'Tende a liderar com calma, apoio e previsibilidade: escuta, protege a equipe e mantém rotinas, mas pode adiar conversas difíceis e mudanças necessárias.',
    C: 'Tende a liderar por padrões e critérios claros: organiza, documenta e preza pela qualidade, mas pode microgerenciar e demorar a decidir sem dados suficientes.'
  };

  // ------------------------------------------------------------------
  // Utilitários
  // ------------------------------------------------------------------
  function obterLideranca() {
    if (root && root.DISC_LIDERANCA) return root.DISC_LIDERANCA;
    if (typeof require === 'function') {
      try { return require('./lideranca.js'); } catch (e) { /* sem guia */ }
    }
    return null;
  }

  function texto(v) { return v == null ? '' : String(v).trim(); }

  function maiuscula(p) { return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase(); }

  // "Ana Paula Souza" -> "Ana P."; "Fábio" -> "Fábio". Nunca devolve o nome completo.
  function nomeCurto(nome) {
    var partes = texto(nome).replace(/\(.*?\)/g, ' ').replace(/[^\s\wÀ-ÿ'-]/g, ' ').split(/\s+/)
      .filter(function (p) { return p; });
    if (!partes.length) return 'Sem nome';
    var primeiro = maiuscula(partes[0]);
    for (var i = 1; i < partes.length; i++) {
      if (!PARTICULAS[partes[i].toLowerCase()]) return primeiro + ' ' + partes[i].charAt(0).toUpperCase() + '.';
    }
    return primeiro;
  }

  function arred(n) { return Math.round(n * 10) / 10; }
  function limitar(n, a, b) { return Math.max(a, Math.min(b, n)); }
  function fmt(n) { return String(arred(n)).replace('.', ',') + '%'; }

  function addUnico(lista, item) { if (item && lista.indexOf(item) === -1) lista.push(item); }

  // Perfil normalizado: percentuais somando ~100, ordem, primário, secundário, intensidade.
  function perfil(percentuais) {
    if (!percentuais || typeof percentuais !== 'object') return null;
    var p = {}, soma = 0;
    LETRAS.forEach(function (l) { p[l] = Math.max(0, Number(percentuais[l]) || 0); soma += p[l]; });
    if (soma <= 0) return null;
    LETRAS.forEach(function (l) { p[l] = arred(p[l] * 100 / soma); });
    var ordem = LETRAS.slice().sort(function (a, b) { return p[b] - p[a] || LETRAS.indexOf(a) - LETRAS.indexOf(b); });
    var amplitude = p[ordem[0]] - p[ordem[3]];
    return {
      percentuais: p,
      ordem: ordem,
      primario: ordem[0],
      secundario: ordem[1],
      codigo: ordem[0] + ordem[1],
      equilibrado: amplitude < LIMIAR_EQUILIBRADO,
      ritmo: arred(p.D + p.I - p.S - p.C),     // + rápido / − cauteloso
      foco: arred(p.D + p.C - p.I - p.S)       // + tarefas / − pessoas
    };
  }

  // Intensidade 0–1 de um fator alto (30% → 0,25; 45%+ → 1).
  function intens(pf, l) { return pf.percentuais[l] < ALTO ? 0 : limitar((pf.percentuais[l] - 25) / 20, 0, 1); }
  function alto(pf, l) { return pf.percentuais[l] >= ALTO; }

  // ------------------------------------------------------------------
  // Regras de par. a/b são pessoas normalizadas ({nome, perfil}).
  // Regras de liderança: a = líder, b = liderado. Simétricas: testadas nas duas ordens.
  // ajuste negativo = atrito; positivo = sinergia. Multiplicado por intensidade e peso do tipo.
  // ------------------------------------------------------------------
  var REGRAS_SIMETRICAS = [
    {
      id: 'DD', f: function (a, b) { return alto(a.perfil, 'D') && alto(b.perfil, 'D') ? Math.min(intens(a.perfil, 'D'), intens(b.perfil, 'D')) : 0; },
      ajuste: function (f) { return -(22 + 18 * f); },
      riscos: ['Dois perfis de Dominância alta: disputa por controle, decisões atropeladas e discussões que viram queda de braço.'],
      sinergias: ['Os dois têm senso de urgência e foco em resultado.'],
      dicas: ['Dividam territórios: cada um com decisões, metas e responsabilidades claramente separadas.',
        'Combinem antes quem decide em caso de empate (ou quem é o árbitro).',
        'Discordâncias em particular e com dados; em público, uma posição única.']
    },
    {
      id: 'IC', f: function (a, b) { return alto(a.perfil, 'I') && alto(b.perfil, 'C') && a.perfil.primario !== 'C' && b.perfil.primario !== 'I' ? Math.min(intens(a.perfil, 'I'), intens(b.perfil, 'C')) : 0; },
      ajuste: function (f) { return -(10 + 10 * f); },
      riscos: ['{a} (Influência) e {b} (Conformidade): atrito entre entusiasmo e detalhe — {b} pode achar {a} superficial; {a} pode achar {b} lento(a) e crítico(a).'],
      sinergias: ['Complementares quando há papéis claros: {a} abre portas e engaja; {b} garante precisão e qualidade.'],
      dicas: ['{a}: leve dados e registre por escrito o que foi combinado.',
        '{b}: aponte primeiro o que está bom, depois os ajustes — e só os que importam.',
        'Definam juntos o "padrão mínimo de qualidade" antes de começar.']
    },
    {
      id: 'DS', tipos: ['direto', 'indireto'],
      f: function (a, b) { return alto(a.perfil, 'D') && alto(b.perfil, 'S') && a.perfil.primario !== 'S' && b.perfil.primario !== 'D' ? Math.min(intens(a.perfil, 'D'), intens(b.perfil, 'S')) : 0; },
      ajuste: function (f) { return -(6 + 8 * f); },
      riscos: ['{a} (Dominância) e {b} (Estabilidade): ritmo diferente — {a} quer velocidade, {b} precisa de previsibilidade e pode se sentir pressionado(a).'],
      sinergias: ['{a} puxa decisões; {b} dá constância e conclui o que começa.'],
      dicas: ['{a}: avise mudanças com antecedência e explique o porquê.', '{b}: diga com clareza o prazo que consegue cumprir, em vez de concordar e se sobrecarregar.']
    },
    {
      id: 'DC', tipos: ['direto', 'indireto'],
      f: function (a, b) { return alto(a.perfil, 'D') && alto(b.perfil, 'C') && a.perfil.primario !== 'C' && b.perfil.primario !== 'D' ? Math.min(intens(a.perfil, 'D'), intens(b.perfil, 'C')) : 0; },
      ajuste: function (f) { return -(3 + 5 * f); },
      riscos: ['{a} quer rapidez; {b} quer certeza — risco de atrito entre prazo e qualidade.'],
      sinergias: ['Ambos focados em tarefas: dupla forte em resultado com qualidade quando os papéis estão claros.'],
      dicas: ['Combinem prazo e critério de qualidade juntos, no início de cada entrega.']
    },
    {
      id: 'DI', f: function (a, b) { return alto(a.perfil, 'D') && alto(b.perfil, 'I') && a.perfil.primario !== 'I' && b.perfil.primario !== 'D' ? 1 : 0; },
      ajuste: function () { return 3; },
      riscos: ['Dupla rápida: risco de pular detalhes e disputar protagonismo.'],
      sinergias: ['Ritmo parecido e gosto por desafio: {a} foca o resultado, {b} engaja as pessoas.'],
      dicas: ['Escolham alguém (ou um checklist) para conferir detalhes e prazos.']
    },
    {
      id: 'IS', f: function (a, b) { return alto(a.perfil, 'I') && alto(b.perfil, 'S') ? 1 : 0; },
      ajuste: function () { return 5; },
      riscos: ['Os dois evitam conflito: problemas podem ficar sem ser ditos.'],
      sinergias: ['Ambos focados em pessoas: tendem a criar bom clima e cooperação.'],
      dicas: ['Reservem um momento fixo para falar do que não está funcionando.']
    },
    {
      id: 'SC', f: function (a, b) { return alto(a.perfil, 'S') && alto(b.perfil, 'C') && a.perfil.primario !== b.perfil.primario ? 1 : 0; },
      ajuste: function () { return 5; },
      riscos: ['Ritmo cauteloso dos dois: risco de lentidão diante de urgências.'],
      sinergias: ['Ritmo parecido, organização e constância: execução cuidadosa e confiável.'],
      dicas: ['Definam prazos-limite para decisões, para não esperar certeza total.']
    }
  ];

  var REGRAS_IGUAIS = {
    D: null, // coberto por DD
    I: { ajuste: 4, sinergias: ['Os dois são comunicativos e entusiasmados: conexão rápida e muitas ideias.'],
      riscos: ['Risco de muita conversa e pouca execução; detalhes e prazos podem escapar.'],
      dicas: ['Fechem cada conversa com responsável e data por escrito.'] },
    S: { ajuste: 10, sinergias: ['Mesmo ritmo e mesmo valor por cooperação: relação estável, de confiança e apoio mútuo.'],
      riscos: ['Risco de acomodação e de evitar conversas difíceis ou mudanças necessárias.'],
      dicas: ['Combinem revisões periódicas do que pode melhorar, para não deixar incômodos acumularem.'] },
    C: { ajuste: 6, sinergias: ['Mesmo padrão de qualidade e organização: entregas precisas e bem documentadas.'],
      riscos: ['Risco de análise demais e decisões travadas; críticas mútuas de detalhe.'],
      dicas: ['Definam o "bom o suficiente" e um prazo para decidir com a informação disponível.'] }
  };

  var REGRAS_LIDERANCA = [
    {
      id: 'D>S', f: function (l, s) { return alto(l.perfil, 'D') && alto(s.perfil, 'S') && s.perfil.primario !== 'D' ? Math.min(intens(l.perfil, 'D'), intens(s.perfil, 'S')) + 0.2 : 0; },
      ajuste: function (f) { return -(6 + 8 * f); },
      riscos: ['{a} (Dominância) liderando {b} (Estabilidade): sem previsibilidade, a cobrança rápida tende a gerar pressão e insegurança em {b}.'],
      sinergias: ['{a} dá direção e metas; {b} entrega com constância e lealdade quando sabe o que esperar.'],
      dicas: ['{a}: antecipe mudanças e explique o porquê antes do "o quê".',
        '{a}: combine prioridades da semana e prazos realistas; evite trocas de rumo de última hora.',
        '{a}: dê feedback em particular, com calma e exemplos concretos.',
        '{b}: peça clareza sobre prioridades e sinalize cedo quando o prazo não couber.']
    },
    {
      id: 'D>C', f: function (l, s) { return alto(l.perfil, 'D') && alto(s.perfil, 'C') && s.perfil.primario !== 'D' ? intens(s.perfil, 'C') : 0; },
      ajuste: function (f) { return -(4 + 6 * f); },
      riscos: ['{a} pode cobrar velocidade onde {b} precisa de tempo para garantir qualidade; {b} pode parecer resistente.'],
      sinergias: ['Os dois focam em tarefas: {a} decide, {b} assegura precisão.'],
      dicas: ['{a}: defina prazo e padrão de qualidade juntos; dê as informações e o contexto completos.', '{b}: traga riscos com dados e proponha alternativas, não só objeções.']
    },
    {
      id: 'D>I', f: function (l, s) { return alto(l.perfil, 'D') && alto(s.perfil, 'I') && s.perfil.primario !== 'D' ? 1 : 0; },
      ajuste: function () { return -2; },
      riscos: ['{b} pode sentir falta de reconhecimento e de espaço para conversar; {a} pode ver dispersão.'],
      sinergias: ['Ritmo parecido: {a} dá metas ousadas, {b} mobiliza pessoas para atingi-las.'],
      dicas: ['{a}: reconheça conquistas em público e combine metas objetivas com acompanhamento curto.']
    },
    {
      id: 'I>C', f: function (l, s) { return alto(l.perfil, 'I') && alto(s.perfil, 'C') ? intens(s.perfil, 'C') : 0; },
      ajuste: function (f) { return -(3 + 5 * f); },
      riscos: ['Instruções de {a} podem parecer vagas ou mudar sem registro, deixando {b} inseguro(a).'],
      sinergias: [],
      dicas: ['{a}: registre por escrito o que foi decidido, com critérios e prazos.', '{b}: peça os detalhes de que precisa logo no início.']
    },
    {
      id: 'I>S', f: function (l, s) { return alto(l.perfil, 'I') && alto(s.perfil, 'S') ? 1 : 0; },
      ajuste: function () { return 2; },
      riscos: ['Mudanças frequentes de ideia podem cansar {b}.'],
      sinergias: ['{a} valoriza e motiva; {b} se sente acolhido(a) e retribui com dedicação.'],
      dicas: ['{a}: filtre as ideias antes de levá-las a {b} e mantenha as prioridades estáveis.']
    },
    {
      id: 'S>D', f: function (l, s) { return alto(l.perfil, 'S') && alto(s.perfil, 'D') && l.perfil.primario !== 'D' ? intens(s.perfil, 'D') : 0; },
      ajuste: function (f) { return -(4 + 8 * f); },
      riscos: ['{b} pode achar o ritmo lento e passar por cima de {a}; {a} pode evitar o confronto e perder autoridade.'],
      sinergias: ['{a} dá estabilidade; {b} traz velocidade e iniciativa.'],
      dicas: ['{a}: dê autonomia com limites claros de decisão e seja firme quando o limite for ultrapassado.', '{b}: alinhe antes de decidir em nome da equipe.']
    },
    {
      id: 'C>I', f: function (l, s) { return alto(l.perfil, 'C') && alto(s.perfil, 'I') && l.perfil.primario !== 'I' ? intens(s.perfil, 'I') : 0; },
      ajuste: function (f) { return -(3 + 6 * f); },
      riscos: ['Risco de microgerência e crítica de detalhe; {b} pode se sentir tolhido(a) e desmotivado(a).'],
      sinergias: ['{a} traz estrutura que ajuda {b} a transformar ideias em entregas.'],
      dicas: ['{a}: corrija o essencial, reconheça o esforço e dê espaço para {b} se expressar.', '{b}: use checklists simples para atender ao padrão de {a}.']
    },
    {
      id: 'C>D', f: function (l, s) { return alto(l.perfil, 'C') && alto(s.perfil, 'D') && l.perfil.primario !== 'D' ? intens(s.perfil, 'D') : 0; },
      ajuste: function (f) { return -(3 + 6 * f); },
      riscos: ['{b} pode ver burocracia e lentidão nas exigências de {a}; {a} pode ver imprudência.'],
      sinergias: ['Ambos focados em tarefas: rigor de {a} com a energia de execução de {b}.'],
      dicas: ['{a}: explique quais regras são inegociáveis e libere o resto.', '{b}: mostre os dados que sustentam suas decisões rápidas.']
    },
    {
      id: 'S>I', f: function (l, s) { return alto(l.perfil, 'S') && alto(s.perfil, 'I') ? 1 : 0; },
      ajuste: function () { return 0; },
      riscos: ['Liderança gentil pode deixar {b} disperso(a) sem acompanhamento.'],
      sinergias: ['Clima de confiança e cooperação.'],
      dicas: ['{a}: combine pontos de acompanhamento curtos e cobre os combinados com leveza.']
    }
  ];

  function preencher(t, a, b) { return t.replace(/\{a\}/g, a.nome).replace(/\{b\}/g, b.nome); }

  // Nomes abreviados ("Bruno L.") no fim da frase geram "..": normaliza em toda a saída.
  function limpar(v) {
    if (typeof v === 'string') return v.replace(/\.\.(?=\s|\)|$)/g, '.');
    if (Array.isArray(v)) return v.map(limpar);
    if (v && typeof v === 'object') { var o = {}; Object.keys(v).forEach(function (k) { o[k] = limpar(v[k]); }); return o; }
    return v;
  }

  // ------------------------------------------------------------------
  // Análise de um par
  // ------------------------------------------------------------------
  function analisarPar(a, b, tipo) {
    var peso = PESO[tipo] || 1;
    var base = { de: a.id, para: b.id, deNome: a.nome, paraNome: b.nome, tipo: tipo, peso: peso };
    if (!a.perfil || !b.perfil) {
      var falta = [a, b].filter(function (p) { return !p.perfil; }).map(function (p) { return p.nome; });
      base.nivel = 'indefinido';
      base.pontuacao = null;
      base.sinergias = [];
      base.riscos = [];
      base.dicas = ['Aplicar o teste em ' + falta.join(' e ') + ' para avaliar esta relação.'];
      return base;
    }
    var pa = a.perfil, pb = b.perfil;
    var ajusteTotal = 0, sinergias = [], riscos = [], dicas = [], regras = [];

    function aplicar(regra, x, y, f) {
      var aj = regra.ajuste(f);
      ajusteTotal += aj < 0 ? aj * peso : aj;
      regras.push(regra.id);
      (regra.sinergias || []).forEach(function (t) { addUnico(sinergias, preencher(t, x, y)); });
      (regra.riscos || []).forEach(function (t) { addUnico(riscos, preencher(t, x, y)); });
      (regra.dicas || []).forEach(function (t) { addUnico(dicas, preencher(t, x, y)); });
    }

    if (tipo === 'lidera') {
      REGRAS_LIDERANCA.forEach(function (r) { var f = r.f(a, b); if (f > 0) aplicar(r, a, b, f); });
    }
    REGRAS_SIMETRICAS.forEach(function (r) {
      if (r.tipos && r.tipos.indexOf(tipo) === -1) return;
      var f1 = r.f(a, b), f2 = r.id === 'DD' ? 0 : r.f(b, a);
      if (f1 > 0) aplicar(r, a, b, f1);
      else if (f2 > 0) aplicar(r, b, a, f2);
    });
    if (pa.primario === pb.primario && !pa.equilibrado && !pb.equilibrado && REGRAS_IGUAIS[pa.primario]) {
      var ri = REGRAS_IGUAIS[pa.primario];
      aplicar({ id: pa.primario + '=' + pb.primario, ajuste: function () { return ri.ajuste; }, sinergias: ri.sinergias, riscos: ri.riscos, dicas: ri.dicas }, a, b, 1);
    }

    // Ritmo (rápido D+I × cauteloso S+C) e foco (tarefas D+C × pessoas I+S).
    var dRitmo = Math.abs(pa.ritmo - pb.ritmo), dFoco = Math.abs(pa.foco - pb.foco);
    if (dRitmo >= 50) {
      ajusteTotal -= (dRitmo - 30) * 0.15 * peso;
      var rapido = pa.ritmo > pb.ritmo ? a : b, lento = rapido === a ? b : a;
      addUnico(riscos, 'Ritmos diferentes: ' + rapido.nome + ' tende a ser mais rápido(a) e ' + lento.nome + ' mais cauteloso(a).');
      addUnico(dicas, rapido.nome + ': dê tempo para ' + lento.nome + ' processar; ' + lento.nome + ': sinalize cedo quando precisar de mais prazo.');
    } else if (dRitmo <= 20) {
      ajusteTotal += 3;
      addUnico(sinergias, 'Ritmo de trabalho parecido (' + (pa.ritmo + pb.ritmo >= 0 ? 'rápido' : 'cauteloso') + ').');
    }
    if (dFoco >= 60) {
      ajusteTotal -= (dFoco - 40) * 0.1 * peso;
      var tarefa = pa.foco > pb.foco ? a : b, pessoas = tarefa === a ? b : a;
      addUnico(riscos, tarefa.nome + ' foca mais em tarefas e ' + pessoas.nome + ' em pessoas: um pode achar o outro frio(a) ou disperso(a).');
      if (tipo !== 'indireto') {
        ajusteTotal += 4;
        addUnico(sinergias, 'Complementares: um cuida da entrega, o outro das relações — funciona bem com papéis claros.');
        addUnico(dicas, 'Deixem claro quem é responsável por quê; a diferença vira força quando os papéis estão definidos.');
      }
    }
    if (pa.equilibrado || pb.equilibrado) {
      addUnico(dicas, 'Perfil pouco definido em ' + [a, b].filter(function (p) { return p.perfil.equilibrado; }).map(function (p) { return p.nome; }).join(' e ') + ': confirme o estilo em conversa antes de concluir.');
    }
    if (!dicas.length) addUnico(dicas, 'Mantenham combinados claros de prioridade, prazo e forma de comunicação.');
    if (!sinergias.length) addUnico(sinergias, 'Sem atritos típicos entre os perfis; a relação depende mais de acordos e papéis do que de estilo.');

    var pontuacao = Math.round(limitar(BASE + ajusteTotal, 0, 100));
    base.nivel = pontuacao >= 70 ? 'fluido' : pontuacao >= 50 ? 'atencao' : 'tensao';
    base.pontuacao = pontuacao;
    base.codigos = [pa.codigo, pb.codigo];
    base.regras = regras;
    base.sinergias = sinergias;
    base.riscos = riscos;
    base.dicas = dicas;
    return base;
  }

  // ------------------------------------------------------------------
  // Equipe
  // ------------------------------------------------------------------
  function analisarEquipe(pessoas, pares) {
    var com = pessoas.filter(function (p) { return p.perfil; });
    var distribuicao = { D: 0, I: 0, S: 0, C: 0, equilibrado: 0 };
    var media = { D: 0, I: 0, S: 0, C: 0 };
    com.forEach(function (p) {
      if (p.perfil.equilibrado) distribuicao.equilibrado++; else distribuicao[p.perfil.primario]++;
      LETRAS.forEach(function (l) { media[l] += p.perfil.percentuais[l]; });
    });
    LETRAS.forEach(function (l) { media[l] = com.length ? arred(media[l] / com.length) : null; });
    var falta = [], excesso = [];
    if (com.length) {
      LETRAS.forEach(function (l) {
        var altos = com.filter(function (p) { return alto(p.perfil, l); }).length;
        if (!altos) falta.push({ fator: l, nome: NOMES[l], texto: FALTA[l] });
        var fracao = distribuicao[l] / com.length;
        if (media[l] >= 35 || (com.length >= 3 && fracao >= 0.6)) {
          excesso.push({ fator: l, nome: NOMES[l], texto: EXCESSO[l] + ' (média ' + fmt(media[l]) + '; ' + distribuicao[l] + ' de ' + com.length + ' com perfil principal ' + NOMES[l] + ')' });
        }
      });
    }
    var avaliados = pares.filter(function (p) { return p.pontuacao != null; });
    var somaP = 0, somaV = 0;
    avaliados.forEach(function (p) { somaP += p.peso; somaV += p.pontuacao * p.peso; });
    var contagem = { fluido: 0, atencao: 0, tensao: 0, indefinido: 0 };
    pares.forEach(function (p) { contagem[p.nivel]++; });
    var resumo;
    if (!com.length) resumo = 'Nenhuma pessoa com teste concluído ainda.';
    else {
      resumo = com.length + ' de ' + pessoas.length + ' pessoas com teste. Média: ' +
        LETRAS.map(function (l) { return l + ' ' + fmt(media[l]); }).join(' · ') + '.';
      if (falta.length) resumo += ' Lacunas: ' + falta.map(function (f) { return f.nome; }).join(', ') + '.';
      if (excesso.length) resumo += ' Em excesso: ' + excesso.map(function (f) { return f.nome; }).join(', ') + '.';
    }
    return {
      total: pessoas.length,
      comTeste: com.length,
      distribuicao: distribuicao,
      media: media,
      falta: falta,
      excesso: excesso,
      semTeste: pessoas.filter(function (p) { return !p.perfil; }).map(function (p) { return { id: p.id, nome: p.nome, cargo: p.cargo }; }),
      harmonia: somaP ? Math.round(somaV / somaP) : null,
      niveis: contagem,
      resumo: resumo
    };
  }

  // ------------------------------------------------------------------
  // Organograma (relações 'lidera'); ciclos e múltiplos líderes quebrados com aviso
  // ------------------------------------------------------------------
  function montarOrganograma(pessoas, porId, lideraRel, avisos) {
    var lider = {}, ciclos = [];
    lideraRel.forEach(function (r) {
      if (lider[r.para] !== undefined) {
        avisos.push(porId[r.para].nome + ' tem mais de um líder; no organograma ficou sob ' + porId[lider[r.para]].nome + ' (ignorado: ' + porId[r.de].nome + ').');
        return;
      }
      // r.de é descendente de r.para? então criaria ciclo
      var x = r.de, guarda = 0;
      while (x !== undefined && guarda++ <= pessoas.length) {
        if (x === r.para) break;
        x = lider[x];
      }
      if (x === r.para) {
        var caminho = [r.para], y = r.de;
        var trilha = [];
        while (y !== r.para && y !== undefined) { trilha.push(y); y = lider[y]; }
        caminho = [r.para].concat(trilha.reverse());
        caminho.push(r.para);
        ciclos.push({ ids: caminho, nomes: caminho.map(function (id) { return porId[id].nome; }), quebradoEm: { de: r.de, para: r.para } });
        avisos.push('Ciclo de liderança detectado (' + caminho.map(function (id) { return porId[id].nome; }).join(' → ') +
          '); a relação "' + porId[r.de].nome + ' lidera ' + porId[r.para].nome + '" foi ignorada no organograma.');
        return;
      }
      lider[r.para] = r.de;
    });
    var filhos = {};
    pessoas.forEach(function (p) { filhos[p.id] = []; });
    pessoas.forEach(function (p) { if (lider[p.id] !== undefined) filhos[lider[p.id]].push(p.id); });
    var nos = [], profundidade = 0;
    function no(id, nivel) {
      var p = porId[id];
      profundidade = Math.max(profundidade, nivel);
      nos.push({ id: id, nome: p.nome, cargo: p.cargo, codigo: p.perfil ? p.perfil.codigo : null, nivel: nivel,
        liderId: lider[id] !== undefined ? lider[id] : null, lideradosIds: filhos[id].slice() });
      return { id: id, nome: p.nome, cargo: p.cargo, codigo: p.perfil ? p.perfil.codigo : null,
        primario: p.perfil ? p.perfil.primario : null, nivel: nivel,
        filhos: filhos[id].map(function (f) { return no(f, nivel + 1); }) };
    }
    var raizes = pessoas.filter(function (p) { return lider[p.id] === undefined; }).map(function (p) { return no(p.id, 0); });
    return { raizes: raizes, nos: nos, profundidade: profundidade, ciclos: ciclos, lider: lider, filhos: filhos };
  }

  // ------------------------------------------------------------------
  // Lideranças
  // ------------------------------------------------------------------
  function trechos(guia, titulo, n) {
    var s = (guia && guia.secoes || []).filter(function (x) { return x.titulo.indexOf(titulo) === 0; })[0];
    return s ? s.itens.slice(0, n) : [];
  }

  function analisarLiderancas(porId, pares, org, L) {
    var ids = Object.keys(org.filhos).filter(function (id) { return org.filhos[id].length; });
    // ordem estável: a de entrada das pessoas (nos do organograma seguem a árvore; usamos porId.__ordem)
    ids.sort(function (a, b) { return porId[a].ordem - porId[b].ordem; });
    return ids.map(function (id) {
      var lider = porId[id];
      var alertas = [];
      var liderados = org.filhos[id].map(function (lid) {
        var liderado = porId[lid];
        var par = pares.filter(function (p) { return p.tipo === 'lidera' && p.de === id && p.para === lid; })[0];
        var guia = (liderado.perfil && L) ? L.gerarGuia({ percentuais: liderado.perfil.percentuais }, liderado.nome) : null;
        var combo = (liderado.perfil && L && L.combinacoes) ? L.combinacoes[liderado.perfil.codigo] : null;
        var tendencia;
        if (!lider.perfil) tendencia = lider.nome + ' ainda não fez o teste; não é possível prever o estilo da relação.';
        else if (!liderado.perfil) tendencia = liderado.nome + ' ainda não fez o teste. Estilo de ' + lider.nome + ': ' + ESTILO_LIDERAR[lider.perfil.primario];
        else tendencia = (par.riscos[0] || par.sinergias[0] || '') + (par.nivel === 'fluido' ? ' A relação tende a fluir.' : par.nivel === 'atencao' ? ' A relação pede combinados claros.' : ' A relação tende a ter tensão sem acordos explícitos.');
        if (par && par.nivel === 'tensao') alertas.push('Relação com ' + liderado.nome + ' em tensão (' + par.pontuacao + '/100): ' + (par.riscos[0] || '') );
        return {
          id: lid,
          nome: liderado.nome,
          codigo: liderado.perfil ? liderado.perfil.codigo : null,
          estiloLiderado: combo ? combo.nome : null,
          nivel: par ? par.nivel : 'indefinido',
          pontuacao: par ? par.pontuacao : null,
          tendencia: tendencia,
          comoConduzir: (par && par.pontuacao != null ? par.dicas.slice(0, 3) : []).concat(trechos(guia, 'Como se comunicar', 1), trechos(guia, 'Como delegar', 1))
            .filter(function (t, i, arr) { return arr.indexOf(t) === i; })
        };
      });
      if (!lider.perfil) alertas.push(lider.nome + ' ainda não fez o teste: aplicar para orientar a liderança.');
      var semTeste = liderados.filter(function (x) { return !x.codigo; });
      if (semTeste.length) alertas.push(semTeste.length + ' liderado(s) sem teste: ' + semTeste.map(function (x) { return x.nome; }).join(', ') + '.');
      if (liderados.length > 8) alertas.push('Amplitude de controle alta (' + liderados.length + ' liderados): risco de pouco acompanhamento individual.');
      if (lider.perfil) {
        var sAltos = liderados.filter(function (x) { return x.codigo && alto(porId[x.id].perfil, 'S'); }).length;
        if (alto(lider.perfil, 'D') && sAltos >= 2) alertas.push('Líder com Dominância alta e ' + sAltos + ' liderados de Estabilidade alta: cuidar da previsibilidade (agenda, prioridades e mudanças comunicadas com antecedência).');
      }
      return {
        id: id,
        nome: lider.nome,
        cargo: lider.cargo,
        codigo: lider.perfil ? lider.perfil.codigo : null,
        estilo: lider.perfil ? ESTILO_LIDERAR[lider.perfil.primario] : null,
        liderados: liderados,
        alertas: alertas
      };
    });
  }

  // ------------------------------------------------------------------
  // Foco: encaixe de um candidato / novo colaborador
  // ------------------------------------------------------------------
  function analisarFoco(foco, porId, pares, equipe) {
    var p = porId[foco];
    var envolve = pares.filter(function (x) { return x.de === foco || x.para === foco; });
    var comLider = envolve.filter(function (x) { return x.tipo === 'lidera' && x.para === foco; })[0] || null;
    var liderados = envolve.filter(function (x) { return x.tipo === 'lidera' && x.de === foco; });
    var diretos = envolve.filter(function (x) { return x.tipo === 'direto'; });
    var indiretos = envolve.filter(function (x) { return x.tipo === 'indireto'; });
    function outro(x) { return x.de === foco ? x.para : x.de; }
    function resumoPar(x) { return x ? { id: outro(x), nome: porId[outro(x)].nome, tipo: x.tipo, nivel: x.nivel, pontuacao: x.pontuacao } : null; }

    var res = {
      id: foco, nome: p.nome, cargo: p.cargo, codigo: p.perfil ? p.perfil.codigo : null,
      lider: resumoPar(comLider),
      liderados: liderados.map(resumoPar),
      diretos: diretos.map(resumoPar),
      indiretos: indiretos.map(resumoPar),
      encaixeEquipe: null, pontuacao: null, nivel: 'indefinido',
      pontosFortes: [], riscos: [], recomendacoes90: []
    };
    if (!p.perfil) {
      res.riscos.push(p.nome + ' ainda não fez o teste: aplicar antes de avaliar o encaixe.');
      return res;
    }
    var pf = p.perfil;
    // Contribuição para a equipe (sem contar a própria pessoa nas lacunas).
    var outros = Object.keys(porId).filter(function (id) { return id !== foco && porId[id].perfil; }).map(function (id) { return porId[id]; });
    var preenche = [], reforca = [];
    LETRAS.forEach(function (l) {
      if (!alto(pf, l)) return;
      if (!outros.some(function (o) { return alto(o.perfil, l); })) preenche.push(l);
      else if (outros.length >= 2 && outros.filter(function (o) { return o.perfil.primario === l; }).length / outros.length >= 0.5 && pf.primario === l) reforca.push(l);
    });
    var ajusteEquipe = 0;
    preenche.forEach(function (l) { ajusteEquipe += 8; res.pontosFortes.push(p.nome + ' ' + FORCA[l] + ' — fator (' + NOMES[l] + ') que hoje falta na equipe.'); });
    reforca.forEach(function (l) { ajusteEquipe -= 6; res.riscos.push('Reforça um fator que já predomina (' + NOMES[l] + '): ' + EXCESSO[l].charAt(0).toLowerCase() + EXCESSO[l].slice(1)); });
    res.encaixeEquipe = { preencheLacunas: preenche.map(function (l) { return NOMES[l]; }), reforcaExcesso: reforca.map(function (l) { return NOMES[l]; }) };

    var avaliados = envolve.filter(function (x) { return x.pontuacao != null; });
    var sp = 0, sv = 0;
    avaliados.forEach(function (x) { var w = x === comLider ? x.peso * 1.5 : x.peso; sp += w; sv += x.pontuacao * w; });
    var media = sp ? sv / sp : 65;
    res.pontuacao = Math.round(limitar(media + ajusteEquipe, 0, 100));
    res.nivel = res.pontuacao >= 70 ? 'fluido' : res.pontuacao >= 50 ? 'atencao' : 'tensao';

    avaliados.slice().sort(function (a, b) { return b.pontuacao - a.pontuacao; }).forEach(function (x) {
      if (x.nivel === 'fluido') addUnico(res.pontosFortes, 'Com ' + porId[outro(x)].nome + ': ' + x.sinergias[0]);
      else addUnico(res.riscos, 'Com ' + porId[outro(x)].nome + ' (' + ({ atencao: 'atenção', tensao: 'tensão' }[x.nivel] || x.nivel) + ', ' + x.pontuacao + '/100): ' + (x.riscos[0] || 'pede combinados claros.'));
    });
    envolve.filter(function (x) { return x.pontuacao == null; }).forEach(function (x) {
      addUnico(res.riscos, 'Sem teste de ' + porId[outro(x)].nome + ': encaixe com essa pessoa não avaliado.');
    });
    if (!res.pontosFortes.length) res.pontosFortes.push(p.nome + ' ' + FORCA[pf.primario] + '.');
    if (pf.equilibrado) res.riscos.push('Perfil pouco definido: confirmar o estilo em entrevista comportamental.');

    // Plano de 90 dias
    var nomeLider = comLider ? porId[comLider.de].nome : 'a liderança';
    var r = res.recomendacoes90;
    var p30 = ['Reunião de boas-vindas com ' + nomeLider + ' para combinar expectativas, prioridades e forma de comunicação.'];
    var INTEG = {
      D: 'Dar desde cedo uma entrega concreta com meta e autonomia definidas, deixando claros os limites de decisão.',
      I: 'Apresentar pessoalmente às pessoas-chave e dar espaço para contribuir com ideias, combinando registro por escrito dos acordos.',
      S: 'Apresentar a rotina com calma, indicar um(a) padrinho/madrinha e evitar mudanças de rumo nas primeiras semanas.',
      C: 'Entregar processos, padrões e documentação por escrito e responder às dúvidas com dados.'
    };
    p30.push(INTEG[pf.primario]);
    if (comLider && comLider.dicas.length) p30.push(comLider.dicas[0]);
    var p60 = ['Conversa de acompanhamento com ' + nomeLider + ': o que está funcionando e o que ajustar na relação.'];
    var tensos = avaliados.filter(function (x) { return x.nivel !== 'fluido'; });
    if (comLider && comLider.dicas[1]) p60.push(comLider.dicas[1]);
    tensos.filter(function (x) { return x !== comLider; }).slice(0, 2).forEach(function (x) {
      p60.push('Combinar com ' + porId[outro(x)].nome + ' — ' + (x.dicas[0] || 'papéis e prioridades.'));
    });
    preenche.forEach(function (l) { p60.push('Dar a ' + p.nome + ' uma responsabilidade visível que aproveite este ponto forte: ' + FORCA[l] + '.'); });
    var p90 = ['Avaliação de 90 dias com metas e feedback nos dois sentidos; revisar o encaixe com base no comportamento observado, não só no perfil.'];
    if (tensos.length) p90.push('Verificar se os combinados com ' + tensos.map(function (x) { return porId[outro(x)].nome; }).join(', ') + ' estão sendo cumpridos.');
    r.push({ periodo: 'Dias 1–30', itens: p30 }, { periodo: 'Dias 31–60', itens: p60 }, { periodo: 'Dias 61–90', itens: p90 });
    return res;
  }

  // ------------------------------------------------------------------
  // Entrada principal
  // ------------------------------------------------------------------
  function montar(dados) {
    dados = dados || {};
    var avisos = [];
    var porId = {}, pessoas = [];
    (Array.isArray(dados.pessoas) ? dados.pessoas : []).forEach(function (bruta, i) {
      if (!bruta || bruta.id == null || texto(bruta.id) === '') { avisos.push('Pessoa sem id ignorada (posição ' + (i + 1) + ').'); return; }
      var id = String(bruta.id);
      if (porId[id]) { avisos.push('Id repetido ignorado: ' + id + '.'); return; }
      // Só estes campos saem da entrada — nada de idade, gênero, contato ou outros dados.
      var p = { id: id, nome: nomeCurto(bruta.nome), cargo: texto(bruta.cargo) || null, perfil: perfil(bruta.percentuais), ordem: pessoas.length };
      porId[id] = p;
      pessoas.push(p);
    });

    var vistos = {}, relacoes = [];
    (Array.isArray(dados.relacoes) ? dados.relacoes : []).forEach(function (r) {
      if (!r) return;
      var de = String(r.de), para = String(r.para), tipo = r.tipo;
      if (TIPOS.indexOf(tipo) === -1) { avisos.push('Relação com tipo desconhecido ignorada: ' + texto(tipo) + '.'); return; }
      if (!porId[de] || !porId[para]) { avisos.push('Relação com pessoa inexistente ignorada (' + de + ' → ' + para + ').'); return; }
      if (de === para) { avisos.push(porId[de].nome + ': relação consigo mesmo(a) ignorada.'); return; }
      var chave = tipo === 'lidera' ? 'L|' + de + '|' + para : 'P|' + [de, para].sort().join('|');
      var chaveDupla = [de, para].sort().join('|');
      if (vistos[chave]) return;
      if (tipo !== 'lidera' && vistos['L|' + de + '|' + para] || tipo !== 'lidera' && vistos['L|' + para + '|' + de]) return;
      vistos[chave] = true;
      if (tipo === 'lidera') {
        // uma relação de liderança substitui um 'direto'/'indireto' já registrado para o mesmo par
        relacoes = relacoes.filter(function (x) { return !(x.tipo !== 'lidera' && [x.de, x.para].sort().join('|') === chaveDupla); });
      }
      relacoes.push({ de: de, para: para, tipo: tipo });
    });

    var pares = relacoes.map(function (r) { return analisarPar(porId[r.de], porId[r.para], r.tipo); });
    var org = montarOrganograma(pessoas, porId, relacoes.filter(function (r) { return r.tipo === 'lidera'; }), avisos);
    var L = obterLideranca();
    var equipe = analisarEquipe(pessoas, pares);
    var liderancas = analisarLiderancas(porId, pares, org, L);

    var foco = null;
    if (dados.foco != null && dados.foco !== '') {
      if (porId[String(dados.foco)]) foco = analisarFoco(String(dados.foco), porId, pares, equipe);
      else avisos.push('Pessoa em foco não encontrada: ' + texto(dados.foco) + '.');
    }
    if (equipe.semTeste.length) avisos.push(equipe.semTeste.length + ' pessoa(s) sem teste: análises dessas relações ficam indefinidas.');

    return limpar({
      empresa: { nome: texto(dados.empresa && dados.empresa.nome) || null },
      equipe: equipe,
      pares: pares,
      liderancas: liderancas,
      foco: foco,
      organograma: { raizes: org.raizes, nos: org.nos, profundidade: org.profundidade, ciclos: org.ciclos },
      avisos: AVISOS_LIMITE.concat(avisos)
    });
  }

  var DISC_COMPATIBILIDADE = {
    montar: montar,
    analisarPar: function (a, b, tipo) {
      return limpar(analisarPar({ id: String(a.id), nome: nomeCurto(a.nome), perfil: perfil(a.percentuais) },
        { id: String(b.id), nome: nomeCurto(b.nome), perfil: perfil(b.percentuais) }, tipo || 'direto'));
    },
    nomeCurto: nomeCurto,
    perfil: perfil,
    PESO: PESO,
    ALTO: ALTO,
    NOMES: NOMES,
    AVISOS: AVISOS_LIMITE
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = DISC_COMPATIBILIDADE;
  else root.DISC_COMPATIBILIDADE = DISC_COMPATIBILIDADE;
})(typeof self !== 'undefined' ? self : this);
