/*
 * Montadores dos modelos de relatório da FASE 2 — módulo PURO (sem DOM, sem rede), UMD:
 * window.DISC_RELATORIO_MODELOS / module.exports.
 *
 * Cada montador devolve `dados` serializável (snapshot) pronto para DISC_API.salvarRelatorioModelo e para
 * js/relatorio-view.js, que desenha o documento por `dados.modelo`:
 *
 *   equipe({ empresa: {nome, cidade}, colaboradores, relacoes, consultor, foco? }, opcoes?)
 *     colaboradores: formato de listarEquipe ([{ pessoaId, nome, cargo, area, status, resultado: {percentuais, codigo} | null }]);
 *                    vínculos 'desligado' ficam de fora.
 *     relacoes:      [{ de: pessoaId, para: pessoaId, tipo: 'lidera' | 'direto' | 'indireto' }]
 *     foco:          candidato a encaixar (opcional): { nome, cargo, resultado, relacoes: [{ de, para, tipo }] }
 *                    — nas relações do foco, o candidato é o id 'foco' (ou foco.id, se vier).
 *     -> { modelo: 'equipe', versao, titulo, geradoEm, empresa, consultor, numeros, sumario, organograma, equilibrio,
 *          pares, liderancas, colaboradores, foco, avisos: { limites, observacoes } }
 *
 *   lideranca({ pessoa: {nome, cargo, resultado}, lider: {nome, resultado} | null, empresa: {nome}, consultor? }, opcoes?)
 *     -> { modelo: 'lideranca', versao, titulo, geradoEm, empresa, consultor, pessoa, lider, relacao, resumo, secoes, aviso }
 *
 *   pessoa({ pessoa: {nome, resultado}, consultor? }, opcoes?)
 *     -> { modelo: 'pessoa', versao, titulo, geradoEm, consultor, pessoa, frase, fatores, secoes, aviso }
 *
 * opcoes.geradoEm (ISO) fixa a data (testes); sem ele, agora.
 * Privacidade: nomes sempre "Primeiro nome + inicial" (no modelo pessoa, a saudação usa só o primeiro nome);
 * nada de telefone, idade, e-mail, ids do banco ou outros dados pessoais — só nome curto, cargo, área e o resultado DISC.
 * Resultado DISC inválido em lideranca()/pessoa() lança Error('Resultado DISC inválido.').
 */
(function (root) {
  'use strict';

  var VERSAO = 1;
  var LETRAS = ['D', 'I', 'S', 'C'];
  var NOMES = { D: 'Dominância', I: 'Influência', S: 'Estabilidade', C: 'Conformidade' };
  var FORCA = {
    D: 'senso de urgência, decisão e foco em resultado',
    I: 'comunicação, entusiasmo e facilidade de engajar pessoas',
    S: 'constância, paciência e cuidado com o clima da equipe',
    C: 'rigor, qualidade e atenção a processos'
  };
  // Seções do "Como liderar" que entram resumidas no relatório de equipe (2 itens cada).
  var CHAVES_RESUMO = ['comunicacao', 'delegar', 'feedback', 'motivacao', 'estresse'];
  var ITENS_RESUMO = 2;
  var ORDEM_NIVEL = { tensao: 0, atencao: 1, fluido: 2, indefinido: 3 };

  function dep(global, arquivo) {
    if (root && root[global]) return root[global];
    if (typeof require === 'function') {
      try { return require(arquivo); } catch (e) { /* ausente */ }
    }
    return null;
  }
  function compat() {
    var C = dep('DISC_COMPATIBILIDADE', './compatibilidade.js');
    if (!C) throw new Error('DISC_COMPATIBILIDADE não carregado.');
    return C;
  }

  function texto(v) { return v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim(); }
  function limitar(s, n) { s = texto(s); return s.length > n ? s.slice(0, n - 1).trim() + '…' : s; }
  function copia(v) { return v === undefined ? null : JSON.parse(JSON.stringify(v)); }
  function addUnico(lista, item) { if (item && lista.indexOf(item) === -1) lista.push(item); }
  function agora(opcoes, entrada) {
    var g = (opcoes && opcoes.geradoEm) || (entrada && entrada.geradoEm);
    return g ? String(g) : new Date().toISOString();
  }
  function nomeCurto(nome) { return compat().nomeCurto(nome); }
  function primeiroNome(nome) { return nomeCurto(nome).split(' ')[0]; }
  // Primeira frase, sem cortar em iniciais de nome ("Ana P. tende a…").
  function primeiraFrase(t) {
    var s = texto(t), re = /[.!?](?=\s|$)/g, m;
    while ((m = re.exec(s))) {
      if (/(^|\s)[A-ZÀ-Ý]$/.test(s.slice(0, m.index))) continue;
      return s.slice(0, m.index + 1);
    }
    return s;
  }

  // { percentuais: {D,I,S,C}, codigo } válido (percentuais 0–100, soma > 0) ou null. Sem código: o do maior fator.
  function resultadoValido(r) {
    if (!r || typeof r !== 'object' || !r.percentuais || typeof r.percentuais !== 'object') return null;
    var p = {}, soma = 0;
    for (var i = 0; i < LETRAS.length; i++) {
      var bruto = r.percentuais[LETRAS[i]];
      var v = Number(bruto);
      if (bruto === null || bruto === '' || typeof bruto === 'boolean' || !isFinite(v) || v < 0 || v > 100) return null;
      p[LETRAS[i]] = Math.round(v * 10) / 10;
      soma += v;
    }
    if (soma <= 0) return null;
    var c = texto(r.codigo).toUpperCase();
    if (!/^[DISC]{2}$/.test(c) || c.charAt(0) === c.charAt(1)) c = compat().perfil(p).codigo;
    return { percentuais: p, codigo: c };
  }

  /* ------------------------------------------------------------------ peças da rodada 3 (Parte 2, régua, combinações, mapa)
   * Todas degradam com elegância: sem o módulo (DISC_EXIGIDO, DISC_INTENSIDADE, DISC_COMBINACOES), o snapshot sai sem
   * aquele bloco (ou com o cálculo numérico local), e a view simplesmente não desenha o que falta. */

  // Foto: só data URL JPEG em base64 até 40 000 caracteres; outra coisa vira null (a view desenha as iniciais).
  var RE_FOTO = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;
  function fotoValida(f) { return typeof f === 'string' && f.length <= 40000 && RE_FOTO.test(f); }
  function fotoDe(f) { return fotoValida(f) ? f : null; }

  function arred1(n) { return Math.round(n * 10) / 10; }
  function exigidoMod() { return dep('DISC_EXIGIDO', './disc-exigido.js'); }

  // Eixos ritmo × foco na convenção de DISC_EXIGIDO.eixos / compatibilidade (ritmo + acelerado, foco + TAREFAS).
  function eixosDe(percentuais) {
    var X = exigidoMod();
    if (X && typeof X.eixos === 'function') { var e = X.eixos(percentuais); return { ritmo: e.ritmo, foco: e.foco }; }
    var p = percentuais, soma = 0;
    LETRAS.forEach(function (l) { soma += p[l]; });
    var q = {};
    LETRAS.forEach(function (l) { q[l] = p[l] * 100 / soma; });
    return { ritmo: arred1(q.D + q.I - q.S - q.C), foco: arred1(q.D + q.C - q.I - q.S) };
  }

  // Perfil exigido: string de 40 dígitos (calculada por DISC_EXIGIDO) ou {percentuais, codigo}. Inválido/ausente -> null.
  function exigidoValido(x) {
    if (x === null || x === undefined || x === '') return null;
    if (typeof x === 'string') {
      var X = exigidoMod();
      if (!X || !X.validar(x)) return null;
      try { var c = X.calcular(x); return resultadoValido({ percentuais: c.percentuais, codigo: c.codigo }); } catch (e) { return null; }
    }
    return resultadoValido(x);
  }

  // Bloco "natural × exigido" do snapshot. textos: 'pessoa' | 'lider' (DISC_EXIGIDO.adaptacao).
  function blocoExigido(natural, exigido, quem, nome) {
    if (!natural || !exigido) return null;
    var X = exigidoMod();
    var a = X && typeof X.adaptacao === 'function' ? X.adaptacao(natural, exigido, quem === 'lider' ? { nome: nome } : undefined) : null;
    var porFator = {}, soma = 0;
    LETRAS.forEach(function (l) { porFator[l] = arred1(exigido.percentuais[l] - natural.percentuais[l]); soma += Math.abs(porFator[l]); });
    var indice = a ? a.indice : Math.round(soma / 2);
    var faixa = a ? a.faixa : indice < 10 ? 'baixa' : indice < 20 ? 'moderada' : indice < 30 ? 'alta' : 'muito_alta';
    return {
      percentuais: copia(exigido.percentuais), codigo: exigido.codigo,
      indice: indice, faixa: faixa, rotulo: a && a.rotulo ? a.rotulo : null,
      porFator: a ? copia(a.porFator) : porFator,
      maisCobrado: a ? a.maisCobrado : null, menosUsado: a ? a.menosUsado : null,
      eixos: { natural: eixosDe(natural.percentuais), exigido: eixosDe(exigido.percentuais) },
      textos: a && a.textos && Array.isArray(a.textos[quem]) ? a.textos[quem].slice() : []
    };
  }

  // Régua de intensidade: faixa + rótulo + texto por fator (DISC_INTENSIDADE). Sem o módulo: faixa local, sem texto.
  var LIMITES_PADRAO = [15, 22, 29, 36];
  var ROTULOS_PADRAO = { muito_baixa: 'Muito baixa', baixa: 'Baixa', media: 'Média', alta: 'Alta', muito_alta: 'Muito alta' };
  var FAIXAS_INT = ['muito_baixa', 'baixa', 'media', 'alta', 'muito_alta'];
  function intensidadeMod() { return dep('DISC_INTENSIDADE', './disc-intensidade.js'); }
  function regua() {
    var I = intensidadeMod();
    var lim = I && Array.isArray(I.LIMITES) && I.LIMITES.length === 4 ? I.LIMITES.slice() : LIMITES_PADRAO.slice();
    var rot = {};
    FAIXAS_INT.forEach(function (f) { rot[f] = I && I.ROTULOS && typeof I.ROTULOS[f] === 'string' ? I.ROTULOS[f] : ROTULOS_PADRAO[f]; });
    return { limites: lim, min: 10, max: 40, rotulos: rot };
  }
  function intensidade(letra, pct, rg) {
    var I = intensidadeMod();
    var faixa = null;
    if (I && typeof I.faixa === 'function') faixa = I.faixa(pct);
    if (FAIXAS_INT.indexOf(faixa) < 0) {
      faixa = FAIXAS_INT[4];
      for (var i = 0; i < 4; i++) if (pct < rg.limites[i]) { faixa = FAIXAS_INT[i]; break; }
    }
    var t = null;
    if (I && typeof I.texto === 'function') {
      var x = I.texto(letra, faixa);
      if (x && typeof x === 'object') t = { resumo: texto(x.resumo) || null, comportamento: texto(x.comportamento) || null, excesso: texto(x.excesso) || null, falta: texto(x.falta) || null };
    }
    return { faixa: faixa, faixaRotulo: rg.rotulos[faixa], texto: t };
  }

  // Nome Notus da combinação (DISC_COMBINACOES.nome). Sem o módulo ou sem nome: null.
  function combinacao(codigo, percentuais) {
    var CB = dep('DISC_COMBINACOES', './disc-combinacoes.js');
    if (!CB || typeof CB.nome !== 'function' || !codigo) return null;
    var c = null;
    try { c = CB.nome(codigo, percentuais); } catch (e) { c = null; }
    if (!c || typeof c !== 'object' || !texto(c.nome)) return null;
    return { codigo: texto(c.codigo) || codigo, nome: texto(c.nome), frase: texto(c.frase) || null, descricao: texto(c.descricao) || null };
  }

  function nivelHarmonia(n) {
    if (n === null || n === undefined) return 'indefinido';
    return n >= 70 ? 'fluido' : n >= 50 ? 'atencao' : 'tensao';
  }

  // Remove ids externos: o organograma do compat já usa as referências locais (p1, p2…).
  function organogramaLimpo(org, focoRef) {
    function no(n) {
      var x = { id: n.id, nome: n.nome, cargo: n.cargo || null, codigo: n.codigo || null, primario: n.primario || null, nivel: n.nivel,
        filhos: (n.filhos || []).map(no) };
      if (focoRef && n.id === focoRef) x.foco = true;
      return x;
    }
    return { raizes: (org.raizes || []).map(no), profundidade: org.profundidade || 0 };
  }

  /* ------------------------------------------------------------------ EQUIPE */

  // Base de decisão pelo fator principal: D decide pelo resultado e pela intuição prática; I e S, ouvindo as pessoas;
  // C, pelos dados. Ritmo: média dos eixos do time.
  var BASE_DE = { D: 'intuicao', I: 'pessoas', S: 'pessoas', C: 'dados' };
  var BASE_TXT = {
    intuicao: { nome: 'Intuição e resultado', texto: 'boa parte do time decide pela experiência e pelo resultado que quer alcançar, sem esperar ter todas as informações' },
    pessoas: { nome: 'Pessoas e acordo', texto: 'boa parte do time decide ouvindo quem será afetado e buscando acordo antes de seguir' },
    dados: { nome: 'Dados e critério', texto: 'boa parte do time decide comparando informações, regras e riscos antes de escolher' }
  };
  var BASE_CUIDADO = {
    intuicao: 'Para equilibrar, vale reservar um momento curto para checar números e ouvir quem executa antes de fechar decisões grandes.',
    pessoas: 'Para equilibrar, vale definir quem dá a palavra final e um prazo, para que a busca de consenso não atrase o que é urgente.',
    dados: 'Para equilibrar, vale combinar quanto de análise cada decisão merece, para que a busca da informação completa não segure o que pode andar.'
  };
  function decisaoGrupo(colabs) {
    var com = colabs.filter(function (c) { return c.resultado; });
    if (!com.length) return null;
    var base = { dados: 0, pessoas: 0, intuicao: 0 }, soma = { ritmo: 0, foco: 0 };
    com.forEach(function (c) {
      base[BASE_DE[c.resultado.codigo.charAt(0)]]++;
      var e = eixosDe(c.resultado.percentuais);
      soma.ritmo += e.ritmo; soma.foco += e.foco;
    });
    var ritmo = arred1(soma.ritmo / com.length), focoM = arred1(soma.foco / com.length);
    var ordem = ['dados', 'pessoas', 'intuicao'].sort(function (a, b) { return base[b] - base[a]; });
    var pred = base[ordem[0]] > base[ordem[1]] ? ordem[0] : null;
    var t = [];
    t.push(ritmo >= 10 ? 'O time tende a decidir rápido: prefere agir e ajustar no caminho a esperar por todas as respostas.' :
      ritmo <= -10 ? 'O time tende a decidir com cuidado: prefere pensar, consultar e ter segurança antes de mudar o rumo.' :
        'O ritmo de decisão do time é equilibrado: há quem acelere e quem peça mais tempo, e isso pode ser uma força se os papéis forem combinados.');
    t.push(focoM >= 10 ? 'Na hora de decidir, o olhar vai primeiro para a tarefa: prazos, metas e qualidade da entrega.' :
      focoM <= -10 ? 'Na hora de decidir, o olhar vai primeiro para as pessoas: como cada um será afetado e como manter o grupo junto.' :
        'Na hora de decidir, o time olha tanto para a tarefa quanto para as pessoas.');
    if (pred) t.push(BASE_TXT[pred].nome + ': ' + BASE_TXT[pred].texto + '. ' + BASE_CUIDADO[pred]);
    else t.push('Não há uma única base de decisão predominante: dados, pessoas e intuição aparecem no time. Combinar quem traz cada olhar ajuda a decidir melhor.');
    return {
      ritmo: ritmo, foco: focoM,
      ritmoRotulo: ritmo >= 10 ? 'Rápido' : ritmo <= -10 ? 'Cuidadoso' : 'Equilibrado',
      focoRotulo: focoM >= 10 ? 'Tarefas' : focoM <= -10 ? 'Pessoas' : 'Equilibrado',
      base: base, basePredominante: pred,
      bases: ['dados', 'pessoas', 'intuicao'].map(function (k) { return { chave: k, nome: BASE_TXT[k].nome, qtd: base[k] }; }),
      textos: t
    };
  }

  // Pressão média (Parte 2): só com colaboradores que responderam o perfil exigido.
  function pressaoGrupo(colabs, colaboradores) {
    var com = colaboradores.filter(function (c) { return c.exigido; });
    if (!com.length) return null;
    var soma = 0, porFaixa = { baixa: 0, moderada: 0, alta: 0, muito_alta: 0 }, cobrado = { D: 0, I: 0, S: 0, C: 0 };
    com.forEach(function (c) {
      soma += c.exigido.indice;
      if (porFaixa[c.exigido.faixa] !== undefined) porFaixa[c.exigido.faixa]++;
      if (c.exigido.maisCobrado) cobrado[c.exigido.maisCobrado]++;
    });
    var media = Math.round(soma / com.length);
    var faixa = media < 10 ? 'baixa' : media < 20 ? 'moderada' : media < 30 ? 'alta' : 'muito_alta';
    var maisCobrado = null;
    LETRAS.forEach(function (l) { if (cobrado[l] && (!maisCobrado || cobrado[l] > cobrado[maisCobrado])) maisCobrado = l; });
    var altos = porFaixa.alta + porFaixa.muito_alta;
    var t = [];
    t.push(faixa === 'baixa' ? 'Em média, o trabalho pede das pessoas algo próximo do jeito natural delas: pouco esforço de adaptação.' :
      faixa === 'moderada' ? 'Em média, o trabalho pede ajustes moderados em relação ao jeito natural das pessoas.' :
        'Em média, o trabalho pede um estilo bem diferente do natural das pessoas: vale olhar papéis, rotinas e apoios.');
    if (altos) t.push(altos + ' de ' + com.length + ' pessoa' + (com.length > 1 ? 's' : '') + ' com esforço alto ou muito alto: são as primeiras conversas a ter sobre como distribuir tarefas.');
    if (maisCobrado) t.push('Fator mais cobrado pelo trabalho: ' + NOMES[maisCobrado] + '.');
    return {
      comExigido: com.length, total: colabs.length, media: media, faixa: faixa, porFaixa: porFaixa, maisCobrado: maisCobrado,
      pessoas: com.slice().sort(function (a, b) { return b.exigido.indice - a.exigido.indice; }).map(function (c) {
        return { id: c.id, nome: c.nome, indice: c.exigido.indice, faixa: c.exigido.faixa, maisCobrado: c.exigido.maisCobrado };
      }),
      textos: t
    };
  }

  function equipe(entrada, opcoes) {
    entrada = entrada || {};
    var C = compat();
    var RL = dep('DISC_RELATORIO_LIDERANCA', './relatorio-lideranca.js');
    var empresa = { nome: limitar(entrada.empresa && entrada.empresa.nome, 120) || 'Empresa', cidade: limitar(entrada.empresa && entrada.empresa.cidade, 120) || null };

    // Colaboradores ativos -> referências locais (p1, p2…); ids do banco não entram no snapshot.
    var refDe = {}, pessoas = [], colabs = [];
    (Array.isArray(entrada.colaboradores) ? entrada.colaboradores : []).forEach(function (c) {
      if (!c || c.status === 'desligado') return;
      var idOrig = texto(c.pessoaId != null ? c.pessoaId : c.id);
      if (!idOrig || refDe[idOrig]) return;
      var ref = 'p' + (pessoas.length + 1);
      refDe[idOrig] = ref;
      var r = resultadoValido(c.resultado);
      pessoas.push({ id: ref, nome: texto(c.nome), cargo: limitar(c.cargo, 120) || null, percentuais: r ? r.percentuais : null });
      colabs.push({ ref: ref, nome: nomeCurto(c.nome), cargo: limitar(c.cargo, 120) || null, area: limitar(c.area, 120) || null, resultado: r, foto: fotoDe(c.foto),
        exigido: r ? exigidoValido(c.exigido !== undefined ? c.exigido : c.resultadoExigido) : null });
    });
    function mapRel(lista, extra) {
      var out = [];
      (Array.isArray(lista) ? lista : []).forEach(function (r) {
        if (!r) return;
        var de = extra && texto(r.de) === extra.id ? extra.ref : refDe[texto(r.de)];
        var para = extra && texto(r.para) === extra.id ? extra.ref : refDe[texto(r.para)];
        if (!de || !para || de === para) return;
        out.push({ de: de, para: para, tipo: r.tipo });
      });
      return out;
    }
    var relacoes = mapRel(entrada.relacoes);
    var analise = C.montar({ empresa: { nome: empresa.nome }, pessoas: pessoas, relacoes: relacoes });
    var eq = analise.equipe;
    var porRef = {};
    colabs.forEach(function (c) { porRef[c.ref] = c; });

    // ---- pares (ordem: tensão, atenção, fluido, indefinido; menor pontuação primeiro)
    var pares = analise.pares.map(function (p, i) {
      return { de: p.de, para: p.para, deNome: p.deNome, paraNome: p.paraNome, tipo: p.tipo, nivel: p.nivel, pontuacao: p.pontuacao,
        codigos: p.codigos || null, sinergias: p.sinergias.slice(0, 3), riscos: p.riscos.slice(0, 3), dicas: p.dicas.slice(0, 4), _i: i };
    }).sort(function (a, b) {
      return (ORDEM_NIVEL[a.nivel] - ORDEM_NIVEL[b.nivel]) || ((a.pontuacao == null ? 101 : a.pontuacao) - (b.pontuacao == null ? 101 : b.pontuacao)) || (a._i - b._i);
    });
    pares.forEach(function (p) { delete p._i; });

    // ---- lideranças (guia por líder)
    var liderancas = analise.liderancas.map(function (l) {
      return { id: l.id, nome: l.nome, cargo: l.cargo || null, codigo: l.codigo, estilo: l.estilo, alertas: l.alertas.slice(),
        liderados: l.liderados.map(function (x) {
          return { id: x.id, nome: x.nome, codigo: x.codigo, estiloLiderado: x.estiloLiderado, nivel: x.nivel, pontuacao: x.pontuacao,
            tendencia: x.tendencia, comoConduzir: x.comoConduzir.slice(0, 4) };
        }) };
    });

    // ---- "como liderar" de cada colaborador (DISC_RELATORIO_LIDERANCA, resumido)
    var colaboradores = colabs.map(function (c) {
      var item = { id: c.ref, nome: c.nome, cargo: c.cargo, area: c.area, foto: c.foto, codigo: null, percentuais: null, estilo: null, resumo: null, secoes: [] };
      if (!c.resultado) return item;
      item.codigo = c.resultado.codigo;
      item.percentuais = copia(c.resultado.percentuais);
      item.combinacao = combinacao(c.resultado.codigo, c.resultado.percentuais);
      var bx = blocoExigido(c.resultado, c.exigido, 'lider', c.nome);
      if (bx) item.exigido = { percentuais: bx.percentuais, codigo: bx.codigo, indice: bx.indice, faixa: bx.faixa, rotulo: bx.rotulo, maisCobrado: bx.maisCobrado, menosUsado: bx.menosUsado };
      if (RL) {
        var g = RL.montar(c.resultado, { nome: c.nome, cargo: c.cargo, lider: null });
        item.estilo = g.pessoa.estilo;
        item.resumo = primeiraFrase(g.resumo);
        item.secoes = g.secoes.filter(function (s) { return CHAVES_RESUMO.indexOf(s.chave) >= 0; })
          .map(function (s) { return { chave: s.chave, titulo: s.titulo, itens: s.itens.slice(0, ITENS_RESUMO) }; });
      }
      return item;
    });
    // O código mostrado é o do resultado (o mesmo dos blocos "como liderar").
    function codigoDe(ref, cod) { return porRef[ref] && porRef[ref].resultado ? porRef[ref].resultado.codigo : cod; }
    var organograma = organogramaLimpo(analise.organograma);
    function fotoRef(ref) { return porRef[ref] ? porRef[ref].foto : null; }
    (function ajustar(nos) { nos.forEach(function (n) { n.codigo = codigoDe(n.id, n.codigo); n.primario = n.codigo ? n.codigo.charAt(0) : null; n.foto = fotoRef(n.id); ajustar(n.filhos); }); })(organograma.raizes);
    pares.forEach(function (p) { if (p.codigos) p.codigos = [codigoDe(p.de, p.codigos[0]), codigoDe(p.para, p.codigos[1])]; });
    liderancas.forEach(function (l) { l.foto = fotoRef(l.id); l.codigo = codigoDe(l.id, l.codigo); l.liderados.forEach(function (x) { x.codigo = codigoDe(x.id, x.codigo); }); });

    // ---- equilíbrio
    var status = !eq.comTeste ? 'sem-dados' : eq.falta.length && eq.excesso.length ? 'lacunas-excesso' : eq.falta.length ? 'lacunas' : eq.excesso.length ? 'excesso' : 'equilibrado';
    var ROTULO_EQ = { 'sem-dados': 'Sem dados', equilibrado: 'Equilibrado', lacunas: 'Com lacunas', excesso: 'Concentrado', 'lacunas-excesso': 'Desequilibrado' };
    var predominante = null;
    LETRAS.forEach(function (l) { if (eq.distribuicao[l] && (!predominante || eq.distribuicao[l] > eq.distribuicao[predominante])) predominante = l; });
    var textoEq;
    if (status === 'sem-dados') textoEq = 'Ainda não há colaboradores com o teste concluído; o equilíbrio do time aparece quando as respostas chegarem.';
    else if (status === 'equilibrado') textoEq = 'As quatro forças do DISC estão presentes no time, sem um estilo dominando os demais.';
    else {
      textoEq = 'O time ' + (eq.falta.length ? 'não tem ninguém com ' + eq.falta.map(function (f) { return f.nome; }).join(' nem ') + ' em destaque' : 'tem todas as forças representadas') +
        (eq.excesso.length ? (eq.falta.length ? ' e concentra ' : ', mas concentra ') + eq.excesso.map(function (f) { return f.nome; }).join(' e ') : '') + '.';
    }
    if (predominante) textoEq += ' Estilo mais comum: ' + NOMES[predominante] + ' (' + eq.distribuicao[predominante] + ' de ' + eq.comTeste + ').';
    var equilibrio = {
      status: status, rotulo: ROTULO_EQ[status], texto: textoEq,
      media: copia(eq.media), distribuicao: copia(eq.distribuicao),
      falta: copia(eq.falta), excesso: copia(eq.excesso),
      semTeste: eq.semTeste.map(function (s) { return { nome: s.nome, cargo: s.cargo || null }; }),
      total: eq.total, comTeste: eq.comTeste
    };

    // ---- sumário: 3 destaques e 3 alertas
    var destaques = [], alertas = [];
    if (eq.harmonia !== null && eq.harmonia >= 70) addUnico(destaques, 'Harmonia geral de ' + eq.harmonia + '/100: a maior parte das relações tende a fluir.');
    pares.filter(function (p) { return p.nivel === 'fluido'; }).sort(function (a, b) { return b.pontuacao - a.pontuacao; }).slice(0, 2)
      .forEach(function (p) { addUnico(destaques, p.deNome + ' e ' + p.paraNome + ' (' + p.pontuacao + '/100): ' + (p.sinergias[0] || 'relação que tende a fluir.')); });
    if (eq.comTeste && !eq.falta.length) addUnico(destaques, 'As quatro forças do DISC estão presentes no time: há quem decida, quem engaje, quem sustente a rotina e quem cuide da qualidade.');
    liderancas.forEach(function (l) {
      if (l.liderados.length && l.liderados.every(function (x) { return x.nivel === 'fluido'; })) addUnico(destaques, 'A liderança de ' + l.nome + ' tende a fluir com toda a equipe direta (' + l.liderados.length + ' pessoa' + (l.liderados.length > 1 ? 's' : '') + ').');
    });
    if (predominante) addUnico(destaques, 'Força predominante: ' + NOMES[predominante] + ' — o time traz ' + FORCA[predominante] + '.');
    LETRAS.forEach(function (l) { if (eq.distribuicao[l] && l !== predominante) addUnico(destaques, NOMES[l] + ' presente no time: ' + FORCA[l] + '.'); });

    pares.filter(function (p) { return p.nivel === 'tensao'; }).forEach(function (p) {
      addUnico(alertas, p.deNome + ' e ' + p.paraNome + ' em tensão (' + p.pontuacao + '/100): ' + (p.riscos[0] || 'pede acordos explícitos.'));
    });
    eq.falta.forEach(function (f) { addUnico(alertas, f.texto); });
    eq.excesso.forEach(function (f) { addUnico(alertas, f.texto); });
    liderancas.forEach(function (l) { l.alertas.forEach(function (a) { if (!/^Relação com .* em tensão/.test(a)) addUnico(alertas, a.indexOf(l.nome) === 0 ? a : l.nome + ': ' + a.charAt(0).toLowerCase() + a.slice(1)); }); });
    if (eq.semTeste.length) addUnico(alertas, eq.semTeste.length + ' pessoa' + (eq.semTeste.length > 1 ? 's' : '') + ' sem teste (' + eq.semTeste.map(function (s) { return s.nome; }).join(', ') + '): as relações delas ficam sem leitura.');
    pares.filter(function (p) { return p.nivel === 'atencao'; }).forEach(function (p) {
      addUnico(alertas, p.deNome + ' e ' + p.paraNome + ' pedem atenção (' + p.pontuacao + '/100): ' + (p.riscos[0] || 'combinem papéis e prioridades.'));
    });

    var sumario = {
      equilibrio: { status: status, rotulo: ROTULO_EQ[status], texto: textoEq },
      harmonia: eq.harmonia, harmoniaNivel: nivelHarmonia(eq.harmonia),
      niveis: copia(eq.niveis),
      resumo: eq.resumo,
      destaques: destaques.slice(0, 3),
      alertas: alertas.slice(0, 3)
    };

    // ---- foco (encaixe do candidato) — segunda análise com o candidato incluído
    var foco = null;
    var observacoes = analise.avisos.slice(C.AVISOS.length);
    if (entrada.foco && typeof entrada.foco === 'object' && texto(entrada.foco.nome)) {
      var f = entrada.foco;
      var rf = resultadoValido(f.resultado);
      var idFoco = texto(f.id) || 'foco';
      var REF_FOCO = 'foco';
      var relFoco = mapRel(f.relacoes, { id: idFoco, ref: REF_FOCO }).filter(function (r) { return r.de === REF_FOCO || r.para === REF_FOCO; });
      var a2 = C.montar({ empresa: { nome: empresa.nome },
        pessoas: pessoas.concat([{ id: REF_FOCO, nome: texto(f.nome), cargo: limitar(f.cargo, 120) || null, percentuais: rf ? rf.percentuais : null }]),
        relacoes: relacoes.concat(relFoco), foco: REF_FOCO });
      var fo = a2.foco;
      var resumoPar = function (x) { return x ? { nome: x.nome, tipo: x.tipo, nivel: x.nivel, pontuacao: x.pontuacao } : null; };
      foco = {
        nome: fo.nome, cargo: fo.cargo || null, foto: fotoDe(f.foto), codigo: rf ? rf.codigo : null, percentuais: rf ? copia(rf.percentuais) : null,
        pontuacao: fo.pontuacao, nivel: fo.nivel,
        lider: resumoPar(fo.lider),
        liderados: fo.liderados.map(resumoPar), diretos: fo.diretos.map(resumoPar), indiretos: fo.indiretos.map(resumoPar),
        encaixeEquipe: copia(fo.encaixeEquipe),
        pontosFortes: fo.pontosFortes.slice(0, 5), riscos: fo.riscos.slice(0, 5),
        recomendacoes90: copia(fo.recomendacoes90),
        organograma: organogramaLimpo(a2.organograma, REF_FOCO)
      };
      (function ajustar(nos) { nos.forEach(function (n) { if (n.id !== REF_FOCO) { n.codigo = codigoDe(n.id, n.codigo); n.primario = n.codigo ? n.codigo.charAt(0) : null; n.foto = fotoRef(n.id); } else { n.foto = fotoDe(f.foto); if (rf) { n.codigo = rf.codigo; n.primario = rf.codigo.charAt(0); } } ajustar(n.filhos); }); })(foco.organograma.raizes);
    }

    // ---- mapa ritmo × foco com todos (e o candidato em destaque), como o grupo decide e pressão média (Parte 2)
    var pontos = colabs.filter(function (c) { return c.resultado; }).map(function (c) {
      return { id: c.ref, nome: c.nome, codigo: c.resultado.codigo, natural: eixosDe(c.resultado.percentuais), exigido: c.exigido ? eixosDe(c.exigido.percentuais) : null };
    });
    if (foco && foco.percentuais) pontos.push({ id: 'foco', nome: foco.nome, codigo: foco.codigo, natural: eixosDe(foco.percentuais), exigido: null, destaque: true });
    var mapa = { pontos: pontos };
    var decisao = decisaoGrupo(colabs);
    var pressao = pressaoGrupo(colabs, colaboradores);

    var nLid = liderancas.length;
    return {
      modelo: 'equipe',
      versao: VERSAO,
      titulo: 'Relatório de equipe — ' + empresa.nome,
      geradoEm: agora(opcoes, entrada),
      empresa: empresa,
      consultor: limitar(entrada.consultor, 120) || null,
      numeros: { pessoas: eq.total, comTeste: eq.comTeste, relacoes: pares.length, liderancas: nLid, harmonia: eq.harmonia },
      sumario: sumario,
      organograma: organograma,
      equilibrio: equilibrio,
      pares: pares,
      liderancas: liderancas,
      colaboradores: colaboradores,
      foco: foco,
      mapa: mapa,
      decisao: decisao,
      pressao: pressao,
      avisos: { limites: C.AVISOS.slice(), observacoes: observacoes }
    };
  }

  /* ------------------------------------------------------------------ LIDERANÇA (individual) */

  function lideranca(entrada, opcoes) {
    entrada = entrada || {};
    var RL = dep('DISC_RELATORIO_LIDERANCA', './relatorio-lideranca.js');
    if (!RL) throw new Error('DISC_RELATORIO_LIDERANCA não carregado.');
    var p = entrada.pessoa || {};
    var r = resultadoValido(p.resultado);
    if (!r) throw new Error('Resultado DISC inválido.');
    var l = entrada.lider && texto(entrada.lider.nome) ? entrada.lider : null;
    var rl = l ? resultadoValido(l.resultado) : null;
    var ex = exigidoValido(p.exigido !== undefined ? p.exigido : p.resultadoExigido);
    var ctx = { nome: p.nome, cargo: limitar(p.cargo, 120), lider: l && rl ? { nome: l.nome, percentuais: rl.percentuais } : null };
    if (ex) ctx.exigido = { percentuais: ex.percentuais, codigo: ex.codigo };
    var g = RL.montar(r, ctx);
    var relacao = null;
    if (l && rl) {
      var par = compat().analisarPar({ id: 'l', nome: l.nome, percentuais: rl.percentuais }, { id: 'p', nome: p.nome, percentuais: r.percentuais }, 'lidera');
      relacao = { nivel: par.nivel, pontuacao: par.pontuacao, sinergias: par.sinergias.slice(0, 3), riscos: par.riscos.slice(0, 3), dicas: par.dicas.slice(0, 4) };
    }
    var nome = g.pessoa.nome;
    return {
      modelo: 'lideranca',
      versao: VERSAO,
      titulo: 'Como liderar ' + nome + (g.pessoa.cargo ? ' — ' + g.pessoa.cargo : ''),
      geradoEm: agora(opcoes, entrada),
      empresa: { nome: limitar(entrada.empresa && entrada.empresa.nome, 120) || null },
      consultor: limitar(entrada.consultor, 120) || null,
      pessoa: { nome: nome, cargo: g.pessoa.cargo || null, foto: fotoDe(p.foto), codigo: g.pessoa.codigo, primario: g.pessoa.primario, secundario: g.pessoa.secundario,
        estilo: g.pessoa.estilo, percentuais: copia(g.pessoa.percentuais), equilibrado: !!g.pessoa.equilibrado },
      lider: l ? { nome: nomeCurto(l.nome), codigo: rl ? rl.codigo : null, foto: fotoDe(l.foto) } : null,
      relacao: relacao,
      combinacao: combinacao(g.pessoa.codigo, r.percentuais),
      mapa: { pontos: [{ id: 'p1', nome: nome, codigo: g.pessoa.codigo, natural: eixosDe(r.percentuais), exigido: ex ? eixosDe(ex.percentuais) : null }] },
      exigido: blocoExigido(r, ex, 'lider', nome),
      resumo: g.resumo,
      secoes: g.secoes.map(function (s) {
        var x = { chave: s.chave, titulo: s.titulo, itens: s.itens.slice() };
        if (s.etapas) x.etapas = copia(s.etapas);
        return x;
      }),
      aviso: g.aviso
    };
  }

  /* ------------------------------------------------------------------ PESSOA (desenvolvimento) */

  // Fatores com a régua de intensidade (faixa, rótulo e texto por fator).
  function fatoresComRegua(fatores, rg) {
    return (fatores || []).map(function (f) {
      var x = { letra: f.letra, nome: f.nome, pct: f.pct, descricao: f.descricao || null };
      var it = intensidade(f.letra, f.pct, rg);
      x.faixa = f.faixa && FAIXAS_INT.indexOf(f.faixa) >= 0 ? f.faixa : it.faixa;
      x.faixaRotulo = rg.rotulos[x.faixa];
      x.texto = it.texto;
      return x;
    });
  }

  // Itens de uma lista do relatório simples: strings ou {titulo, texto} -> {titulo, texto}.
  function itensSimples(lista, n) {
    return (Array.isArray(lista) ? lista : []).map(function (it) {
      if (typeof it === 'string') return { titulo: null, texto: texto(it) };
      if (it && typeof it === 'object') return { titulo: texto(it.titulo) || null, texto: texto(it.texto || it.descricao) || null };
      return null;
    }).filter(function (it) { return it && (it.titulo || it.texto); }).slice(0, n);
  }
  function secaoDe(secoes, id) { return (secoes || []).filter(function (x) { return x && x.id === id; })[0] || null; }

  // pessoa({ pessoa: {nome, resultado, exigido?}, consultor? }, opcoes?)  — opcoes.variante: 'completo' (padrão) | 'simples'
  //   exigido: string de 40 dígitos (Parte 2) ou {percentuais, codigo} (resultadoExigido). Inválido: ignorado.
  //   Completo -> + regua, fatores[].faixa/texto, combinacao, mapa, exigido (+ seção do RP "onde você está se esticando").
  //   Simples  -> { variante: 'simples', frase, combinacao, fatores (com faixa), forcas[3], cuidados[3], habitos[3], mapa, exigido }
  function pessoa(entrada, opcoes) {
    entrada = entrada || {};
    opcoes = opcoes || {};
    var RP = dep('DISC_RELATORIO_PESSOA', './relatorio-pessoa.js');
    if (!RP) throw new Error('DISC_RELATORIO_PESSOA não carregado.');
    var p = entrada.pessoa || {};
    var r = resultadoValido(p.resultado);
    var ex = exigidoValido(p.exigido !== undefined ? p.exigido : p.resultadoExigido);
    var opRP = ex ? { exigido: { percentuais: ex.percentuais, codigo: ex.codigo } } : undefined;
    var m = r ? RP.montar(r, p.nome, undefined, opRP) : null;
    if (!m) throw new Error('Resultado DISC inválido.');
    var simples = opcoes.variante === 'simples';
    var nome = nomeCurto(p.nome);
    var rg = regua();
    var bloco = blocoExigido(r, ex, 'pessoa');
    var base = {
      modelo: 'pessoa',
      versao: VERSAO,
      variante: simples ? 'simples' : 'completo',
      titulo: (simples ? 'Seu perfil DISC em resumo — ' : 'Seu perfil DISC — ') + nome,
      geradoEm: agora(opcoes, entrada),
      consultor: limitar(entrada.consultor, 120) || null,
      pessoa: { nome: nome, primeiroNome: primeiroNome(p.nome), foto: fotoDe(p.foto), codigo: m.codigo, primario: copia(m.primario), secundario: copia(m.secundario) },
      frase: m.frase,
      combinacao: combinacao(m.codigo, r.percentuais),
      regua: rg,
      fatores: fatoresComRegua(m.fatores, rg),
      mapa: { pontos: [{ id: 'p1', nome: nome, codigo: m.codigo, natural: eixosDe(r.percentuais), exigido: bloco ? bloco.eixos.exigido : null }] },
      exigido: bloco,
      aviso: m.aviso
    };
    if (!simples) {
      base.secoes = copia(m.secoes);
      return base;
    }
    // Versão simples (2 páginas): RP.montarSimples quando existir; senão, recorte do completo.
    var sm = typeof RP.montarSimples === 'function' ? RP.montarSimples(r, p.nome, undefined, opRP) : null;
    if (sm && typeof sm === 'object') {
      if (sm.frase) base.frase = texto(sm.frase);
      base.forcas = itensSimples(sm.forcas, 3);
      base.cuidados = itensSimples(sm.cuidados, 3);
      base.habitos = itensSimples(sm.habitos, 3);
      if (Array.isArray(sm.fatores) && sm.fatores.length === 4) {
        var porLetra = {};
        sm.fatores.forEach(function (f) { if (f && f.letra) porLetra[f.letra] = f; });
        base.fatores.forEach(function (f) {
          var o = porLetra[f.letra];
          if (o && FAIXAS_INT.indexOf(o.faixa) >= 0) { f.faixa = o.faixa; f.faixaRotulo = rg.rotulos[o.faixa]; }
        });
      }
    }
    if (!base.forcas || !base.forcas.length) base.forcas = itensSimples((secaoDe(m.secoes, 'fortes') || {}).itens, 3);
    if (!base.cuidados || !base.cuidados.length) base.cuidados = itensSimples((secaoDe(m.secoes, 'atencao') || {}).itens, 3);
    if (!base.habitos || !base.habitos.length) base.habitos = itensSimples((secaoDe(m.secoes, 'plano') || {}).itens, 3);
    // No simples, a régua mostra só faixa (sem os textos longos).
    base.fatores.forEach(function (f) { if (f.texto) f.texto = { resumo: f.texto.resumo, comportamento: null, excesso: null, falta: null }; });
    if (bloco) bloco.textos = bloco.textos.slice(0, 2);
    return base;
  }

  function pessoaSimples(entrada, opcoes) {
    return pessoa(entrada, Object.assign({}, opcoes || {}, { variante: 'simples' }));
  }

  var DISC_RELATORIO_MODELOS = {
    VERSAO: VERSAO,
    MODELOS: ['equipe', 'lideranca', 'pessoa'],
    equipe: equipe,
    lideranca: lideranca,
    pessoa: pessoa,
    pessoaSimples: pessoaSimples,
    resultadoValido: resultadoValido,
    exigidoValido: exigidoValido,
    fotoValida: fotoValida,
    eixosDe: eixosDe
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = DISC_RELATORIO_MODELOS;
  else root.DISC_RELATORIO_MODELOS = DISC_RELATORIO_MODELOS;
})(typeof self !== 'undefined' ? self : this);
