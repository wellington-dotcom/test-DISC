/*
 * Relatório Completo Avançado (pacotes "completo" e "completo_plus" de meu-relatorio.html e "Pessoa · completo" no painel).
 * Texto escrito POR COMBINAÇÃO (16: D, I, S, C, DI, DS, ...) em conteudo/profundo/<CODIGO>.json, montado em
 * js/disc-profundo-dados.js (global DISC_PROFUNDO_DADOS) por scripts/montar-profundo.mjs.
 *
 * Módulo PURO (UMD, global DISC_PROFUNDO; sem DOM, testável no Node):
 *   TENDENCIAS            -> [{ chave, nome, fator, pesos: {D,I,S,C}, frases: { baixa, media, alta } }] (16)
 *   tendencias(percentuais) -> [{ chave, nome, fator, valor (0–100), faixa: 'baixa'|'media'|'alta', rotulo, frase }] ou null
 *   codigoCombinacao(resultado) -> 'DI' | 'D' | ... (regra de DISC_COMBINACOES.codigo: puro quando o secundário é fraco) ou null
 *   temDados(codigo)      -> bool
 *   montar(resultado, nome?, opcoes?) -> relatório avançado (abaixo) ou null (sem dados da combinação: quem chama
 *                            usa o relatório de antes, DISC_RELATORIO_PESSOA.montar)
 *     opcoes: { exigido: 40 dígitos | { percentuais, codigo } (Parte 2), dados: DISC_PROFUNDO_DADOS (testes), data: DISC_DATA,
 *               emitidoEm: ISO (data da capa; padrão: agora) }
 *   secoesDocumento(m)    -> os capítulos em seções genéricas { id, titulo, intro, texto, paragrafos, itens, listas, perfis, sinais }
 *                            para o documento do painel (js/relatorio-view.js, corpoSecaoPessoa)
 *
 * Tendências comportamentais (NUNCA "competências": DISC descreve estilo, não capacidade). Fórmula, estável e monotônica:
 *   z(L) = limita((pct(L) − 25) / 15, −1, 1)        // 25 = média dos quatro fatores; 10 e 40 = extremos do teste
 *   valor = arredonda(50 + 50 × Σ peso(L) × z(L) / Σ |peso(L)|)   (0 a 100)
 *   Cada tendência tem peso 1 no fator de origem e pesos menores (±0,2 a ±0,4) nos fatores que a reforçam ou a seguram.
 *   Perfil achatado (25/25/25/25) = 50 em todas; subir um fator sobe (ou nunca desce) as tendências com peso positivo nele.
 *   Faixas: baixa < 35 ≤ média < 65 ≤ alta.
 *
 * Estrutura de montar():
 *   { versao: 1, variante: 'avancado', nome, codigo, combinacao: { codigo, puro, nome, frase, descricao },
 *     primario, secundario, frase, emitidoEm, fatores, intensidade, tendencias, mapa: { natural, exigido|null },
 *     esticando|null, travas, plano90|null, temParte2,
 *     capitulos: [{ id, numero, titulo, curto, intro, ...conteúdo }], aviso }
 *   Capítulos (ids, nesta ordem): retrato, intensidade, tendencias, mapa, travas, dia_a_dia, decisao, aprendizado, mudanca,
 *   tempo, comunicacao (+ manual), conflito, pressao, motivacao, lideranca, equipe, relacoes, ambientes, pontos_cegos,
 *   esticando (só com a Parte 2; + plano90), plano.
 * Reaproveita DISC_RELATORIO_PESSOA (fatores, régua, travas, plano90, esticando, ritmo de decisão), DISC_INTENSIDADE e
 * DISC_COMBINACOES. Só texto puro: escape ao exibir.
 */
(function (root) {
  'use strict';

  var LETRAS = ['D', 'I', 'S', 'C'];
  var NOMES = { D: 'Dominância', I: 'Influência', S: 'Estabilidade', C: 'Conformidade' };
  var MEDIA = 25, AMPLITUDE = 15;
  var LIMITE_BAIXA = 35, LIMITE_ALTA = 65;
  var ROTULOS = { baixa: 'Baixa', media: 'Média', alta: 'Alta' };

  function t(chave, nome, fator, pesos, baixa, media, alta) {
    return { chave: chave, nome: nome, fator: fator, pesos: pesos, frases: { baixa: baixa, media: media, alta: alta } };
  }

  var TENDENCIAS = [
    t('iniciativa', 'Iniciativa', 'D', { D: 1, I: 0.3, S: -0.3, C: 0 },
      'Você tende a esperar o momento certo ou um pedido claro antes de começar algo novo.',
      'Você costuma tomar a frente quando o assunto é seu, sem precisar puxar tudo.',
      'Você tende a começar antes de ser chamado e a colocar as coisas em movimento.'),
    t('assertividade', 'Assertividade', 'D', { D: 1, I: 0, S: -0.4, C: 0 },
      'Você tende a suavizar o que pensa para preservar a conversa.',
      'Você costuma dizer o que pensa quando o tema importa, escolhendo o momento.',
      'Você tende a dizer o que pensa de forma direta, mesmo quando a conversa esquenta.'),
    t('foco_resultado', 'Foco em resultado', 'D', { D: 1, I: 0, S: -0.2, C: 0.3 },
      'Você tende a valorizar mais o caminho e as pessoas do que o placar final.',
      'Você costuma equilibrar a meta com a forma de chegar até ela.',
      'Você tende a medir o dia pelo que foi entregue e a cobrar avanço concreto.'),
    t('desafio', 'Gosto por desafio', 'D', { D: 1, I: 0.2, S: -0.4, C: 0 },
      'Você tende a preferir o terreno conhecido a apostas arriscadas.',
      'Você costuma aceitar desafios quando enxerga sentido e algum apoio.',
      'Você tende a se animar quando a meta parece difícil ou quando alguém duvida.'),
    t('persuasao', 'Persuasão', 'I', { D: 0.4, I: 1, S: 0, C: -0.2 },
      'Você tende a deixar os fatos falarem por si, sem insistir para convencer.',
      'Você costuma convencer quando acredita na ideia e conhece o público.',
      'Você tende a encontrar o argumento certo para cada pessoa e a mudar opiniões.'),
    t('sociabilidade', 'Sociabilidade', 'I', { D: 0, I: 1, S: 0.2, C: -0.3 },
      'Você tende a preferir poucos contatos, construídos com calma.',
      'Você costuma circular bem entre pessoas sem depender disso para render.',
      'Você tende a criar laços com facilidade e a ganhar energia perto de gente.'),
    t('otimismo', 'Otimismo', 'I', { D: 0.2, I: 1, S: 0, C: -0.4 },
      'Você tende a olhar primeiro os riscos e o que pode dar errado.',
      'Você costuma equilibrar esperança e cautela ao olhar para o futuro.',
      'Você tende a enxergar a possibilidade antes do problema e a contagiar o grupo.'),
    t('expressividade', 'Expressividade', 'I', { D: 0.2, I: 1, S: -0.2, C: -0.3 },
      'Você tende a guardar emoções e opiniões para si até ter certeza.',
      'Você costuma mostrar o que sente quando há confiança no ambiente.',
      'Você tende a mostrar entusiasmo, opinião e emoção de forma visível.'),
    t('paciencia', 'Paciência', 'S', { D: -0.4, I: 0, S: 1, C: 0.2 },
      'Você tende a se incomodar com esperas e com quem tem outro ritmo.',
      'Você costuma esperar o tempo necessário, desde que veja algum avanço.',
      'Você tende a manter a calma em processos longos e com pessoas que precisam de tempo.'),
    t('cooperacao', 'Cooperação', 'S', { D: -0.3, I: 0.3, S: 1, C: 0 },
      'Você tende a preferir trabalhar do seu jeito, com autonomia.',
      'Você costuma colaborar bem quando os papéis estão claros.',
      'Você tende a se colocar à disposição e a pensar primeiro no que o grupo precisa.'),
    t('constancia', 'Constância', 'S', { D: 0, I: -0.3, S: 1, C: 0.3 },
      'Você tende a buscar variedade e a cansar de rotinas repetidas.',
      'Você costuma manter o ritmo quando a tarefa tem começo, meio e fim claros.',
      'Você tende a manter o mesmo ritmo do começo ao fim, dia após dia.'),
    t('escuta', 'Escuta', 'S', { D: -0.4, I: 0, S: 1, C: 0.2 },
      'Você tende a pensar na resposta enquanto o outro ainda está falando.',
      'Você costuma ouvir com atenção quando o assunto pede.',
      'Você tende a ouvir até o fim e a fazer a outra pessoa se sentir entendida.'),
    t('precisao', 'Precisão', 'C', { D: 0, I: -0.3, S: 0.2, C: 1 },
      'Você tende a olhar o todo e a deixar o detalhe fino para depois.',
      'Você costuma caprichar no que é crítico e ser prático no resto.',
      'Você tende a perceber erros pequenos e a conferir antes de entregar.'),
    t('planejamento', 'Planejamento', 'C', { D: 0, I: -0.3, S: 0.3, C: 1 },
      'Você tende a decidir o caminho enquanto anda.',
      'Você costuma planejar o essencial e ajustar no meio do caminho.',
      'Você tende a pensar nas etapas antes de começar e a prever obstáculos.'),
    t('processos', 'Respeito a processos', 'C', { D: -0.3, I: -0.2, S: 0.3, C: 1 },
      'Você tende a achar regras detalhadas cansativas e a criar o próprio caminho.',
      'Você costuma seguir o processo quando entende o motivo dele.',
      'Você tende a seguir o combinado à risca e a cuidar para que os outros também sigam.'),
    t('analise', 'Análise crítica', 'C', { D: 0.3, I: -0.3, S: 0, C: 1 },
      'Você tende a confiar mais na intuição e na experiência do que em análises longas.',
      'Você costuma analisar quando a decisão é importante.',
      'Você tende a questionar dados, testar hipóteses e apontar o que não fecha.')
  ];

  function numero(v) {
    if (v === null || v === '' || typeof v === 'boolean') return null;
    var n = Number(v);
    return isFinite(n) && n >= 0 && n <= 100 ? n : null;
  }

  function percentuaisValidos(p) {
    if (!p || typeof p !== 'object') return null;
    var out = {};
    for (var i = 0; i < LETRAS.length; i++) {
      var v = numero(p[LETRAS[i]]);
      if (v === null) return null;
      out[LETRAS[i]] = v;
    }
    return out;
  }

  function faixaDe(valor) { return valor < LIMITE_BAIXA ? 'baixa' : valor < LIMITE_ALTA ? 'media' : 'alta'; }

  function tendencias(percentuais) {
    var p = percentuaisValidos(percentuais);
    if (!p) return null;
    var z = {};
    LETRAS.forEach(function (l) { z[l] = Math.max(-1, Math.min(1, (p[l] - MEDIA) / AMPLITUDE)); });
    return TENDENCIAS.map(function (x) {
      var soma = 0, total = 0;
      LETRAS.forEach(function (l) { var w = x.pesos[l] || 0; soma += w * z[l]; total += Math.abs(w); });
      var valor = Math.max(0, Math.min(100, Math.round(50 + 50 * soma / total)));
      var f = faixaDe(valor);
      return { chave: x.chave, nome: x.nome, fator: x.fator, fatorNome: NOMES[x.fator], valor: valor, faixa: f, rotulo: ROTULOS[f], frase: x.frases[f] };
    });
  }

  /* ------------------------------------------------------------------ módulos vizinhos */

  function modulo(global, caminho) {
    if (root && root[global]) return root[global];
    if (typeof require === 'function') { try { return require(caminho); } catch (e) { /* ausente */ } }
    return null;
  }
  function dadosProfundo(opcoes) {
    if (opcoes && opcoes.dados && typeof opcoes.dados === 'object') return opcoes.dados;
    return modulo('DISC_PROFUNDO_DADOS', './disc-profundo-dados.js') || {};
  }
  function copia(v) { return v === undefined || v === null ? null : JSON.parse(JSON.stringify(v)); }
  function lista(v) { return Array.isArray(v) ? v : []; }

  function codigoCombinacao(resultado) {
    var CB = modulo('DISC_COMBINACOES', './disc-combinacoes.js');
    if (!CB || !resultado) return null;
    return CB.codigo(resultado.percentuais, resultado.codigo);
  }

  function temDados(codigo, opcoes) {
    var D = dadosProfundo(opcoes);
    return !!(codigo && Object.prototype.hasOwnProperty.call(D, codigo) && D[codigo] && D[codigo].dimensoes);
  }

  // Ritmo = (D + I) − (S + C) (+ acelerado); foco = (D + C) − (I + S) (+ tarefas), como em js/disc-exigido.js.
  function eixos(p) {
    return { ritmo: Math.round((p.D + p.I - p.S - p.C) * 10) / 10, foco: Math.round((p.D + p.C - p.I - p.S) * 10) / 10 };
  }
  function leituraEixos(e) {
    var r = e.ritmo >= 10 ? 'mais acelerado' : e.ritmo <= -10 ? 'mais cauteloso' : 'equilibrado entre acelerado e cauteloso';
    var f = e.foco >= 10 ? 'mais voltado a tarefas' : e.foco <= -10 ? 'mais voltado a pessoas' : 'equilibrado entre tarefas e pessoas';
    return { ritmo: r, foco: f };
  }

  /* ------------------------------------------------------------------ capítulos */

  var DIMENSAO_TITULO = {
    dia_a_dia: 'No dia a dia', decisao: 'Como você decide', aprendizado: 'Como você aprende', mudanca: 'Você diante de mudanças',
    tempo_organizacao: 'Tempo e organização', comunicacao: 'Como você se comunica', conflito: 'Você no conflito',
    motivadores: 'O que te motiva', desmotivadores: 'O que te desmotiva', necessidades: 'Do que você precisa no ambiente',
    como_lidera: 'Como você lidera', como_prefere_ser_liderado: 'Como você prefere ser liderado',
    papel_na_equipe: 'Seu papel na equipe', persuasao_negociacao: 'Como você convence e negocia',
    ambientes: 'Onde você tende a render mais', pontos_cegos: 'Pontos cegos', valoriza_nos_outros: 'O que você valoriza nos outros'
  };

  function dimensao(dados, chave) {
    var x = dados.dimensoes && dados.dimensoes[chave];
    if (!x) return null;
    return {
      chave: chave,
      titulo: DIMENSAO_TITULO[chave],
      texto: String(x.texto || ''),
      itens: lista(x.itens).filter(function (it) { return it && it.titulo; }).map(function (it) { return { titulo: String(it.titulo), texto: String(it.texto || '') }; })
    };
  }

  var RITMO_DECISAO = {
    rapido: 'Pelo equilíbrio dos seus fatores, o seu ritmo natural de decisão tende a ser rápido.',
    equilibrado: 'Pelo equilíbrio dos seus fatores, o seu ritmo natural de decisão tende a ser equilibrado: nem por impulso, nem por excesso de análise.',
    cuidadoso: 'Pelo equilíbrio dos seus fatores, o seu ritmo natural de decisão tende a ser cuidadoso.'
  };

  var AVISO = 'O DISC descreve o seu estilo de comportamento: como você costuma agir, se comunicar e trabalhar. ' +
    'Não mede competência, inteligência, caráter nem saúde, e não existe perfil certo ou errado, melhor ou pior. ' +
    'Todo estilo tem forças e pontos a cuidar, todas as pessoas têm um pouco dos quatro fatores, e o comportamento muda com o tempo, ' +
    'com o contexto e com o que você escolhe desenvolver. Use este relatório como ponto de partida para conversas e escolhas, não como rótulo.';

  function capitulo(id, titulo, curto, intro, extra) {
    var c = { id: id, titulo: titulo, curto: curto || titulo, intro: intro || '' };
    if (extra) Object.keys(extra).forEach(function (k) { c[k] = extra[k]; });
    return c;
  }

  function montar(resultado, nome, opcoes) {
    opcoes = opcoes || {};
    var RP = modulo('DISC_RELATORIO_PESSOA', './relatorio-pessoa.js');
    var IN = modulo('DISC_INTENSIDADE', './disc-intensidade.js');
    if (!RP || !resultado) return null;
    var cod = codigoCombinacao(resultado);
    if (!cod || !temDados(cod, opcoes)) return null;
    var dados = dadosProfundo(opcoes)[cod];
    var opRP = opcoes.exigido ? { exigido: opcoes.exigido } : {};
    var base = opcoes.data ? RP.montar(resultado, nome, opcoes.data, opRP) : RP.montar(resultado, nome, opRP);
    if (!base) return null;
    var p = {};
    base.fatores.forEach(function (f) { p[f.letra] = Number(f.pct); });
    var tend = tendencias(p);
    var regua = base.intensidade || (IN ? IN.regua(p) : null);
    var faixas = {};
    lista(regua).forEach(function (f) { faixas[f.letra] = f; });
    var fatores = base.fatores.map(function (f) {
      var fx = faixas[f.letra];
      return { letra: f.letra, nome: f.nome, pct: f.pct, descricao: f.descricao, faixa: fx ? fx.faixa : null, rotulo: fx ? fx.rotulo : null };
    });
    var est = base.esticando || null;
    var exPct = est && est.exigido && est.exigido.percentuais ? est.exigido.percentuais : null;
    var natural = eixos(p), exigido = exPct ? eixos(exPct) : null;
    var dec = lista(base.aprofundamento).filter(function (s) { return s.id === 'decisao'; })[0] || null;
    var cb = base.combinacao || null;
    var comb = cb ? { codigo: cb.codigo, puro: cb.puro, nome: cb.nome, frase: cb.frase, descricao: cb.descricao } : null;
    var porValor = tend.slice().sort(function (a, b) { return b.valor - a.valor; });
    var leitura = leituraEixos(natural);
    var D = function (k) { return dimensao(dados, k); };
    var pr = dados.pressao || {};
    var pdi = dados.pdi || {};
    var od = dados.o_que_dizem || {};

    var caps = [];
    caps.push(capitulo('retrato', 'Seu retrato', 'Retrato',
      'Quem você tende a ser no trabalho, a mistura dos seus dois fatores mais fortes e o que costuma te levar ao seu melhor.',
      { paragrafos: lista(dados.retrato).map(String), combinacao: copia(comb) }));
    caps.push(capitulo('intensidade', 'Seus 4 fatores e a intensidade de cada um', 'Seus 4 fatores',
      'Quanto cada fator aparece no seu jeito de trabalhar, de muito baixa a muito alta. Faixas altas mostram forças evidentes; faixas baixas, comportamentos que você usa menos, não falhas.',
      { fatores: copia(regua) || [] }));
    caps.push(capitulo('tendencias', 'Suas tendências comportamentais', 'Tendências',
      'Dezesseis tendências que nascem da combinação dos seus quatro fatores. Elas mostram o que você tende a fazer com mais naturalidade, não o que você sabe ou consegue fazer.',
      { tendencias: copia(tend), destaques: porValor.slice(0, 3).map(function (x) { return x.chave; }), menores: porValor.slice(-3).map(function (x) { return x.chave; }) }));
    caps.push(capitulo('mapa', 'Mapa ritmo × foco', 'Ritmo e foco',
      exigido
        ? 'Onde o seu jeito natural fica e para onde o seu trabalho puxa você. Quanto mais longe os dois pontos, mais energia a adaptação costuma pedir.'
        : 'Dois eixos simples para enxergar o seu estilo: o ritmo (acelerado ou cauteloso) e o foco (tarefas ou pessoas).',
      {
        natural: natural, exigido: exigido,
        texto: 'O seu jeito natural tende a ter ritmo ' + leitura.ritmo + ' e foco ' + leitura.foco + '.' +
          (exigido ? ' O ponto do trabalho mostra o que você sente que a sua rotina pede hoje: ritmo ' + leituraEixos(exigido).ritmo + ' e foco ' + leituraEixos(exigido).foco + '.' : '')
      }));
    caps.push(capitulo('travas', base.travas.titulo, 'O que te trava', base.travas.intro, { itens: copia(base.travas.itens) }));
    caps.push(capitulo('dia_a_dia', 'Você no dia a dia', 'Dia a dia', '', { dimensoes: [D('dia_a_dia')] }));
    caps.push(capitulo('decisao', 'Como você decide', 'Decisão', '', {
      dimensoes: [D('decisao')], ritmo: dec ? dec.ritmo : null, ritmoTexto: dec ? RITMO_DECISAO[dec.ritmo] : ''
    }));
    caps.push(capitulo('aprendizado', 'Como você aprende', 'Aprendizado', '', { dimensoes: [D('aprendizado')] }));
    caps.push(capitulo('mudanca', 'Você diante de mudanças', 'Mudanças', '', { dimensoes: [D('mudanca')] }));
    caps.push(capitulo('tempo', 'Tempo e organização', 'Tempo', '', { dimensoes: [D('tempo_organizacao')] }));
    caps.push(capitulo('comunicacao', 'Comunicação e o manual de como falar com você', 'Comunicação', '', {
      dimensoes: [D('comunicacao')],
      manual: {
        titulo: 'Manual de como falar comigo',
        colunas: [
          { chave: 'como_falar_comigo', titulo: 'Como falar comigo', itens: lista(dados.manual && dados.manual.como_falar_comigo).map(String) },
          { chave: 'evite', titulo: 'Evite', itens: lista(dados.manual && dados.manual.evite).map(String) },
          { chave: 'me_energiza', titulo: 'Me energiza', itens: lista(dados.manual && dados.manual.me_energiza).map(String) },
          { chave: 'me_desgasta', titulo: 'Me desgasta', itens: lista(dados.manual && dados.manual.me_desgasta).map(String) }
        ]
      }
    }));
    caps.push(capitulo('conflito', 'Você no conflito', 'Conflito', '', { dimensoes: [D('conflito')] }));
    caps.push(capitulo('pressao', 'Sob pressão', 'Pressão',
      'Todo mundo muda sob pressão. No seu estilo, a mudança costuma seguir três etapas.',
      {
        etapas: [
          { chave: 'primeira_reacao', titulo: 'Primeira reação', texto: String(pr.primeira_reacao || '') },
          { chave: 'se_continua', titulo: 'Se a pressão continua', texto: String(pr.se_continua || '') },
          { chave: 'como_volta', titulo: 'Como você volta', texto: String(pr.como_volta || '') }
        ],
        sinais: lista(pr.sinais).map(String),
        ajuda: lista(pr.o_que_ajuda).map(String)
      }));
    caps.push(capitulo('motivacao', 'Motivadores, desmotivadores e necessidades', 'Motivação', '',
      { dimensoes: [D('motivadores'), D('desmotivadores'), D('necessidades')] }));
    caps.push(capitulo('lideranca', 'Liderança', 'Liderança',
      'Liderar não depende de cargo: vale para conduzir um projeto, uma reunião ou um colega novo.',
      { dimensoes: [D('como_lidera'), D('como_prefere_ser_liderado')] }));
    caps.push(capitulo('equipe', 'Seu papel na equipe e sua persuasão', 'Equipe', '',
      { dimensoes: [D('papel_na_equipe'), D('persuasao_negociacao')] }));
    caps.push(capitulo('relacoes', 'Você e cada perfil', 'Cada perfil',
      'Como o seu estilo tende a se dar com pessoas em que cada fator aparece forte, com afinidades, atritos e dicas práticas.',
      {
        dimensoes: [D('valoriza_nos_outros')],
        perfis: LETRAS.map(function (l) {
          var r = (dados.relacoes || {})[l] || {};
          return { letra: l, nome: NOMES[l], texto: String(r.texto || ''), dicas: lista(r.dicas).map(String) };
        })
      }));
    caps.push(capitulo('ambientes', 'Ambientes onde você rende mais', 'Ambientes', '', { dimensoes: [D('ambientes')] }));
    caps.push(capitulo('pontos_cegos', 'Pontos cegos e o que dizem de você', 'Pontos cegos', '', {
      dimensoes: [D('pontos_cegos')],
      elogios: lista(od.elogios).map(String),
      criticas: lista(od.criticas).map(String)
    }));
    if (est) {
      caps.push(capitulo('esticando', est.titulo, 'Se esticando', est.intro, {
        indice: est.indice, faixa: est.faixa, rotulo: est.rotulo, maisCobrado: est.maisCobrado, menosUsado: est.menosUsado,
        exigido: copia(est.exigido), itens: copia(est.itens), plano90: copia(base.plano90)
      }));
    }
    caps.push(capitulo('plano', 'Seu plano de desenvolvimento', 'Seu plano',
      'Um foco, cinco hábitos e um caminho de 90 dias. Escolha um passo de cada vez e marque o que já fez.',
      {
        foco: String(pdi.foco || ''),
        habitos: lista(pdi.habitos).map(function (h) { return { nome: String(h.nome || ''), como: String(h.como || ''), sinal: String(h.sinal_de_progresso || '') }; }),
        etapas: [
          { chave: 'd30', prazo: 'Dias 1 a 30', acoes: lista(pdi.dias_30).map(String) },
          { chave: 'd60', prazo: 'Dias 31 a 60', acoes: lista(pdi.dias_60).map(String) },
          { chave: 'd90', prazo: 'Dias 61 a 90', acoes: lista(pdi.dias_90).map(String) }
        ],
        perguntas: lista(pdi.perguntas).map(String)
      }));
    caps.forEach(function (c, i) { c.numero = i + 1; });

    return {
      versao: 1,
      variante: 'avancado',
      nome: base.nome,
      codigo: base.codigo,
      combinacao: comb,
      primario: copia(base.primario),
      secundario: copia(base.secundario),
      frase: base.frase,
      emitidoEm: opcoes.emitidoEm ? String(opcoes.emitidoEm) : new Date().toISOString(),
      fatores: fatores,
      intensidade: copia(regua),
      tendencias: tend,
      mapa: { natural: natural, exigido: exigido },
      esticando: copia(est),
      travas: copia(base.travas),
      plano90: copia(base.plano90),
      temParte2: !!est,
      capitulos: caps,
      aviso: AVISO
    };
  }

  /* ------------------------------------------------------------------ painel: capítulos como seções genéricas */

  function secoesDocumento(m) {
    if (!m || !Array.isArray(m.capitulos)) return [];
    var out = [];
    m.capitulos.forEach(function (c) {
      if (c.id === 'intensidade' || c.id === 'mapa' || c.id === 'esticando') return;   // o documento já desenha régua, mapa e Parte 2
      var s = { id: 'av_' + c.id, titulo: c.titulo, curto: c.curto, intro: c.intro || '' };
      var listas = [];
      function dims() {
        lista(c.dimensoes).forEach(function (d, k) {
          if (!d) return;
          if (k === 0 && lista(c.dimensoes).length === 1) {
            s.texto = d.texto;
            s.itens = (s.itens || []).concat(d.itens);
          } else {
            listas.push({ titulo: d.titulo, texto: d.texto, itens: d.itens.map(function (it) { return it.titulo + ': ' + it.texto; }) });
          }
        });
      }
      if (c.id === 'retrato') s.paragrafos = c.paragrafos.slice();
      else if (c.id === 'tendencias') {
        s.itens = c.tendencias.map(function (x) { return { titulo: x.nome + ' · ' + x.valor + '/100', texto: x.frase }; });
      } else if (c.id === 'travas') {
        s.itens = c.itens.map(function (it) { return { titulo: it.titulo, texto: it.texto + (it.acao ? ' Para destravar: ' + it.acao : '') }; });
      } else if (c.id === 'pressao') {
        s.itens = c.etapas.map(function (e) { return { titulo: e.titulo, texto: e.texto }; });
        s.sinais = c.sinais.slice();
        listas.push({ titulo: 'O que ajuda', itens: c.ajuda.slice() });
      } else if (c.id === 'relacoes') {
        dims();
        s.perfis = c.perfis.map(function (pf) { return { letra: pf.letra, nome: pf.nome, texto: pf.texto + (pf.dicas.length ? ' Dicas: ' + pf.dicas.join(' ') : '') }; });
      } else if (c.id === 'pontos_cegos') {
        dims();
        listas.push({ titulo: 'O que costumam elogiar', itens: c.elogios.slice() });
        listas.push({ titulo: 'O que costumam criticar', itens: c.criticas.slice() });
      } else if (c.id === 'comunicacao') {
        dims();
        c.manual.colunas.forEach(function (col) { listas.push({ titulo: col.titulo, itens: col.itens.slice() }); });
      } else if (c.id === 'plano') {
        s.texto = c.foco;
        s.itens = c.etapas.map(function (e) { return { prazo: e.prazo, titulo: e.prazo, texto: e.acoes.join(' ') }; });
        listas.push({ titulo: 'Cinco hábitos', itens: c.habitos.map(function (h) { return h.nome + ': ' + h.como + ' Sinal de progresso: ' + h.sinal; }) });
        listas.push({ titulo: 'Perguntas para refletir', itens: c.perguntas.slice() });
      } else {
        dims();
        if (c.ritmoTexto) s.intro = (s.intro ? s.intro + ' ' : '') + c.ritmoTexto;
      }
      if (listas.length) s.listas = listas;
      out.push(s);
    });
    return out;
  }

  var API = {
    LETRAS: LETRAS,
    TENDENCIAS: TENDENCIAS,
    LIMITE_BAIXA: LIMITE_BAIXA,
    LIMITE_ALTA: LIMITE_ALTA,
    AVISO: AVISO,
    tendencias: tendencias,
    codigoCombinacao: codigoCombinacao,
    temDados: function (codigo, opcoes) { return temDados(String(codigo || '').toUpperCase(), opcoes); },
    montar: montar,
    secoesDocumento: secoesDocumento
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.DISC_PROFUNDO = API;
})(typeof self !== 'undefined' ? self : this);
