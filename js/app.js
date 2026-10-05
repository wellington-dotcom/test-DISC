/*
 * Fluxo do candidato — Teste DISC.
 * Telas: boas-vindas → identificação → 25 grupos → [Parte 2: transição + 10 grupos] → confirmação → envio → conclusão.
 * A Parte 2 (perfil exigido pelo trabalho) só existe quando o processo tem formulario.parte2 === 'ligada'.
 * Depende de: CONFIG, DISC_DATA, DISC_SCORING, DISC_CODEC, DISC_API, DISC_DICAS (globais; DISC_DICAS é opcional),
 * DISC_EXIGIDO (Parte 2; opcional) e DISC_RELATORIO_PESSOA (relatório final; opcional).
 * No Node exporta apenas as funções puras (validações, máscara, payload) para testes.
 */
(function (root) {
  'use strict';

  var CHAVE_PROGRESSO = 'disc_progresso_v1';
  var CHAVE_CONCLUIDO = 'disc_concluido_v1';
  var SEM_VALIDACAO = false;   // modo pessoal (venda B2C): sem a etapa de confirmação
  var VALIDADE_PROGRESSO_MS = 7 * 24 * 60 * 60 * 1000;   // progresso abandonado é apagado após 7 dias
  var LETRAS = ['D', 'I', 'S', 'C'];
  var TOTAL = 25;
  // Parte 2: 10 grupos fixos de DISC_DATA.grupos (os mesmos de DISC_EXIGIDO.GRUPOS).
  var GRUPOS_PARTE2_PADRAO = [0, 2, 5, 7, 10, 12, 15, 17, 20, 22];
  var TOTAL2 = GRUPOS_PARTE2_PADRAO.length;
  // Pergunta de cada grupo da Parte 2 (pensando no trabalho), pela posição em GRUPOS_PARTE2.
  var PERGUNTAS_PARTE2 = [
    'No meu trabalho, preciso agir de forma...',
    'Meu trabalho pede que eu busque...',
    'Num conflito no trabalho, esperam que eu...',
    'Diante de um erro, meu trabalho pede que eu...',
    'Para fazer bem o meu trabalho, preciso de...',
    'No meu trabalho, o que mais preciso evitar é...',
    'Meu trabalho pede uma abordagem...',
    'No meu trabalho, o que mais pesa é...',
    'Diante de atrasos, meu trabalho pede que eu...',
    'Para ir bem no meu trabalho, preciso melhorar...'
  ];
  // Pergunta mostrada ao candidato em cada grupo (a planilha traz títulos escritos para o avaliador).
  // A pontuação continua mapeada pela letra de cada palavra, então o cálculo não muda.
  var PERGUNTAS = [
    'Costumo agir de forma...',
    'Eu me sinto confortável com...',
    'Eu desejo...',
    'Sob estresse, posso me tornar...',
    'Minha principal característica é ser...',
    'Em um conflito, sou alguém que...',
    'Meu ponto forte é ser...',
    'Diante de um erro, sou alguém que...',
    'Sob estresse, também posso ficar...',
    'Às vezes, posso ser visto(a) como...',
    'Eu preciso de...',
    'Uma limitação minha é ser...',
    'Tenho medo de...',
    'Meço meu desempenho por meio de...',
    'Com pessoas que lidero, costumo ser...',
    'Meu jeito de trabalhar é...',
    'Outra limitação minha é ser...',
    'Tenho mais dificuldade com...',
    'Também meço meu desempenho por meio de...',
    'Prefiro tarefas...',
    'Diante de atrasos, sou alguém que...',
    'Em situações extremas, sou alguém que...',
    'Preciso melhorar...',
    'Em uma discussão, sou alguém que...',
    'Quando vou às compras, sou alguém que...'
  ];

  // Textos das palavras corrigidos para exibição (concordância). Chave: índice do grupo + letra.
  var AJUSTES_PALAVRAS = { '19I': 'Relacionadas a pessoas' };

  function perguntaDoGrupo(i, grupo) {
    return PERGUNTAS[i] || (grupo && grupo.titulo ? String(grupo.titulo).replace(/\.{4,}/g, '...') : '');
  }

  function palavraDoGrupo(i, grupo, letra) {
    return AJUSTES_PALAVRAS[i + letra] || (grupo ? grupo[letra] : '');
  }

  var ROTULOS = {
    4: 'Mais me identifica',
    3: 'Me identifica',
    2: 'Me identifica pouco',
    1: 'Menos me identifica'
  };

  /* ------------------------------------------------------------------ */
  /* Funções puras (testáveis no Node)                                   */
  /* ------------------------------------------------------------------ */

  function contarLetras(texto) {
    var m;
    try { m = String(texto).match(new RegExp('\\p{L}', 'gu')); } catch (e) { m = String(texto).match(/[A-Za-zÀ-ÖØ-öø-ÿ]/g); }
    return m ? m.length : 0;
  }

  function normalizarNome(nome) {
    return String(nome || '').replace(/\s+/g, ' ').trim();
  }

  // Retorna mensagem de erro (string) ou '' se válido.
  function validarNome(nome) {
    var n = normalizarNome(nome);
    if (!n) return 'Informe seu nome completo.';
    var palavras = n.split(' ').filter(function (p) { return contarLetras(p) > 0; });
    if (palavras.length < 2) return 'Informe nome e sobrenome.';
    if (contarLetras(n) < 5) return 'O nome precisa ter pelo menos 5 letras.';
    if (/[0-9]/.test(n)) return 'O nome não deve conter números.';
    return '';
  }

  // Remove tudo que não é dígito e o DDI 55 quando presente. Retorna DDD + número.
  function limparTelefone(tel) {
    var d = String(tel || '').replace(/\D/g, '');
    if (d.length > 11 && d.indexOf('55') === 0) d = d.slice(2);
    if (d.length > 11 && d.charAt(0) === '0') d = d.replace(/^0+/, '');
    return d;
  }

  function validarTelefone(tel) {
    var d = limparTelefone(tel);
    if (!d) return 'Informe seu telefone com DDD.';
    if (d.length < 10 || d.length > 11) return 'Telefone inválido: use DDD + número, ex.: (11) 99999-8888.';
    if (d.charAt(0) === '0') return 'Informe o DDD sem o zero, ex.: (11) 99999-8888.';
    if (d.length === 11 && d.charAt(2) !== '9') return 'Celular com 11 dígitos deve começar com 9 após o DDD.';
    if (d.length === 10 && /[6-9]/.test(d.charAt(2))) return 'Confira o número: celulares têm 9 dígitos após o DDD.';
    return '';
  }

  // Idade: obrigatória, inteiro de 14 a 99 (só dígitos). Retorna mensagem de erro ou ''.
  var IDADE_MIN = 14, IDADE_MAX = 99;
  function limparIdade(v) {
    return String(v == null ? '' : v).replace(/\D/g, '').slice(0, 3);
  }
  function validarIdade(v) {
    var s = String(v == null ? '' : v).trim();
    if (!s || !/^[0-9]+$/.test(s)) return 'Informe sua idade (só números).';
    var n = Number(s);
    if (n < IDADE_MIN || n > IDADE_MAX) return 'Confira a idade: precisa ser entre 14 e 99 anos.';
    return '';
  }
  // Idade como número inteiro para o payload (null se inválida).
  function idadeParaSalvar(v) {
    return validarIdade(v) ? null : Number(String(v).trim());
  }

  // Função/empresa atual ou última: texto livre opcional, até 80 caracteres.
  var LIMITE_TEXTO_CURTO = 80;
  function limparTextoCurto(v) {
    return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, LIMITE_TEXTO_CURTO).trim();
  }

  /* ---------- Formulário de identificação do processo (processo.config.formulario) ---------- */
  // campos: idade/funcao/empresa/email/cidade -> 'obrigatorio' | 'opcional' | 'oculto'; perguntas extras: até 5.
  // Nome e WhatsApp são sempre obrigatórios (fora daqui). Ausente/inválido = comportamento de antes.
  var CAMPOS_FORMULARIO = ['idade', 'funcao', 'empresa', 'email', 'cidade', 'foto'];
  var MODOS_CAMPO = ['obrigatorio', 'opcional', 'oculto'];
  var CAMPOS_PADRAO = { idade: 'obrigatorio', funcao: 'opcional', empresa: 'opcional', email: 'oculto', cidade: 'oculto', foto: 'opcional' };
  var ROTULOS_CAMPOS = { idade: 'Idade', funcao: 'Função atual ou última', empresa: 'Empresa atual ou última', email: 'E-mail', cidade: 'Cidade onde mora', foto: 'Sua foto' };

  /* ---------- Foto (data URL JPEG 192x192, até 40 000 caracteres) ---------- */
  var FOTO_LADO = 192;
  var FOTO_MAX = 40000;
  var FOTO_ARQUIVO_MAX = 15 * 1024 * 1024;
  var RE_FOTO = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;
  function fotoValida(str) {
    return typeof str === 'string' && str.length <= FOTO_MAX && RE_FOTO.test(str);
  }
  // Recorte quadrado ao centro: { sx, sy, lado } da imagem de origem.
  function recorteCentro(largura, altura) {
    var lado = Math.max(0, Math.min(largura, altura));
    return { sx: Math.round((largura - lado) / 2), sy: Math.round((altura - lado) / 2), lado: lado };
  }
  // Navegador: lê o arquivo, recorta ao centro, reduz para 192 px e gera JPEG (~0,72; reduz a qualidade se passar do limite).
  function prepararFoto(file) {
    return new Promise(function (resolve, reject) {
      if (!file || (file.type && !/^image\//i.test(file.type))) { reject(new Error('Escolha um arquivo de imagem.')); return; }
      if (file.size > FOTO_ARQUIVO_MAX) { reject(new Error('A foto é grande demais (até 15 MB).')); return; }
      var URLs = root.URL || root.webkitURL;
      var url = URLs.createObjectURL(file);
      var img = new root.Image();
      img.onload = function () {
        try {
          var r = recorteCentro(img.naturalWidth || img.width, img.naturalHeight || img.height);
          if (!r.lado) throw new Error('vazia');
          var c = root.document.createElement('canvas');
          c.width = FOTO_LADO; c.height = FOTO_LADO;
          var ctx = c.getContext('2d');
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, FOTO_LADO, FOTO_LADO);
          ctx.drawImage(img, r.sx, r.sy, r.lado, r.lado, 0, 0, FOTO_LADO, FOTO_LADO);
          var qualidades = [0.72, 0.6, 0.5, 0.4, 0.3];
          for (var q = 0; q < qualidades.length; q++) {
            var dados = c.toDataURL('image/jpeg', qualidades[q]);
            if (fotoValida(dados)) { URLs.revokeObjectURL(url); resolve(dados); return; }
          }
          throw new Error('grande');
        } catch (e) {
          URLs.revokeObjectURL(url);
          reject(new Error('Não conseguimos usar esta foto. Tente outra.'));
        }
      };
      img.onerror = function () { URLs.revokeObjectURL(url); reject(new Error('Não conseguimos abrir esta foto. Tente outra (JPG ou PNG).')); };
      img.src = url;
    });
  }
  var MAX_PERGUNTAS = 5;
  var LIMITE_EMAIL = 120;
  var LIMITE_RESPOSTA = 500;
  var RE_ID_PERGUNTA = /^[a-z0-9_]{1,20}$/;
  // Mesmos termos do servidor (TERMOS_SENSIVEIS): pergunta que pede dado sensível nunca é mostrada.
  var TERMOS_SENSIVEIS = ['sexo', 'genero', 'estado civil', 'filho', 'religi', 'gravid', 'etnia', 'raca',
    'cor da pele', 'orientacao', 'deficien', 'doenca', 'saude', 'antecedente', 'processo em seu nome', 'criminal'];

  function semAcento(s) {
    var t = String(s == null ? '' : s).toLowerCase();
    try { t = t.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) { /* navegador antigo */ }
    return t.replace(/\s+/g, ' ');
  }
  function textoSensivel(texto) {
    var t = semAcento(texto);
    return TERMOS_SENSIVEIS.some(function (termo) { return t.indexOf(termo) !== -1; });
  }

  function normalizarFormulario(f) {
    var fonte = f && typeof f === 'object' ? f : {};
    var camposFonte = fonte.campos && typeof fonte.campos === 'object' ? fonte.campos : {};
    var campos = {};
    CAMPOS_FORMULARIO.forEach(function (c) {
      campos[c] = MODOS_CAMPO.indexOf(camposFonte[c]) !== -1 ? camposFonte[c] : CAMPOS_PADRAO[c];
    });
    var perguntas = [];
    var usados = {};
    (Array.isArray(fonte.perguntas) ? fonte.perguntas : []).forEach(function (p) {
      if (perguntas.length >= MAX_PERGUNTAS || !p || typeof p !== 'object') return;
      var texto = String(p.texto == null ? '' : p.texto).replace(/\s+/g, ' ').trim();
      if (texto.length < 3 || texto.length > 200 || textoSensivel(texto)) return;
      perguntas.push({ id: String(p.id == null ? '' : p.id), texto: texto, obrigatoria: p.obrigatoria === true });
    });
    // id inválido ou repetido: gera p1..p5 (o primeiro livre)
    perguntas.forEach(function (p) {
      if (RE_ID_PERGUNTA.test(p.id) && !usados[p.id]) { usados[p.id] = true; return; }
      p.id = '';
    });
    perguntas.forEach(function (p) {
      if (p.id) return;
      for (var k = 1; k <= 99; k++) if (!usados['p' + k]) { p.id = 'p' + k; usados[p.id] = true; return; }
    });
    // Parte 2 (perfil exigido pelo trabalho): só 'ligada' liga; qualquer outro valor = 'desligada'.
    return { campos: campos, perguntas: perguntas, parte2: fonte.parte2 === 'ligada' ? 'ligada' : 'desligada' };
  }

  function parte2Ligada(formulario) {
    return !!(formulario && typeof formulario === 'object' && formulario.parte2 === 'ligada');
  }

  // Formulário que vale na tela: na avaliação de equipe a "empresa atual" só aparece se for obrigatória.
  function formularioEfetivo(f, tipo) {
    var n = normalizarFormulario(f);
    if (tipo === 'equipe' && n.campos.empresa === 'opcional') n.campos.empresa = 'oculto';
    return n;
  }

  function limparEmail(v) {
    return String(v == null ? '' : v).replace(/\s+/g, '').slice(0, LIMITE_EMAIL);
  }
  function emailValido(v) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || ''));
  }
  function limparResposta(v) {
    return String(v == null ? '' : v).replace(/\r\n?/g, '\n').trim().slice(0, LIMITE_RESPOSTA).trim();
  }

  var MSG_OBRIGATORIO = {
    funcao: 'Informe a função atual ou última.',
    empresa: 'Informe a empresa atual ou última.',
    email: 'Informe o e-mail.',
    cidade: 'Informe a cidade onde mora.'
  };

  // Valida os campos configuráveis e as perguntas extras (nome, telefone e consentimento ficam fora).
  // dados: { idade, funcao, empresa, email, cidade, extras: {id: resposta} }. Retorna { campo: mensagem } (vazio = ok);
  // erros das perguntas usam a chave 'extra-<id>'.
  function validarCamposFormulario(dados, formulario) {
    var f = normalizarFormulario(formulario);
    var d = dados || {};
    var erros = {};
    var modo = f.campos;
    if (modo.idade !== 'oculto') {
      var idade = String(d.idade == null ? '' : d.idade).trim();
      if (modo.idade === 'obrigatorio' || idade) {
        var e = validarIdade(idade);
        if (e) erros.idade = e;
      }
    }
    ['funcao', 'empresa', 'cidade'].forEach(function (c) {
      if (modo[c] === 'obrigatorio' && !limparTextoCurto(d[c])) erros[c] = MSG_OBRIGATORIO[c];
    });
    if (modo.foto === 'obrigatorio' && !fotoValida(d.foto)) erros.foto = 'Envie uma foto.';
    if (modo.email !== 'oculto') {
      var email = limparEmail(d.email);
      if (!email) { if (modo.email === 'obrigatorio') erros.email = MSG_OBRIGATORIO.email; }
      else if (!emailValido(email)) erros.email = 'Confira o e-mail, ex.: nome@exemplo.com.';
    }
    var extras = d.extras && typeof d.extras === 'object' ? d.extras : {};
    f.perguntas.forEach(function (p) {
      if (p.obrigatoria && !limparResposta(extras[p.id])) erros['extra-' + p.id] = 'Responda esta pergunta.';
    });
    return erros;
  }

  // Campos do payload que vêm do formulário: oculto ou vazio vira ''/null; extras só com resposta.
  function camposDoPayload(dados, formulario) {
    var f = normalizarFormulario(formulario);
    var d = dados || {};
    var modo = f.campos;
    var extras = d.extras && typeof d.extras === 'object' ? d.extras : {};
    var email = modo.email === 'oculto' ? '' : limparEmail(d.email);
    return {
      idade: modo.idade === 'oculto' ? null : idadeParaSalvar(d.idade),
      funcao: modo.funcao === 'oculto' ? '' : limparTextoCurto(d.funcao),
      empresa: modo.empresa === 'oculto' ? '' : limparTextoCurto(d.empresa),
      email: emailValido(email) ? email : '',
      cidade: modo.cidade === 'oculto' ? '' : limparTextoCurto(d.cidade),
      foto: modo.foto !== 'oculto' && fotoValida(d.foto) ? d.foto : '',
      extras: f.perguntas.map(function (p) {
        return { id: p.id, pergunta: p.texto, resposta: limparResposta(extras[p.id]) };
      }).filter(function (x) { return !!x.resposta; })
    };
  }

  // Máscara progressiva: (11) 9999-8888 ou (11) 99999-8888.
  function formatarTelefone(tel) {
    var d = limparTelefone(tel).slice(0, 11);
    if (!d) return '';
    if (d.length <= 2) return '(' + d;
    var ddd = d.slice(0, 2), resto = d.slice(2);
    if (resto.length <= 4) return '(' + ddd + ') ' + resto;
    var corte = resto.length === 9 ? 5 : 4;
    return '(' + ddd + ') ' + resto.slice(0, corte) + '-' + resto.slice(corte);
  }

  // Telefone salvo com 55 na frente (12 ou 13 dígitos).
  function telefoneParaSalvar(tel) {
    return '55' + limparTelefone(tel);
  }

  function gerarId() {
    var aleatorio = Math.random().toString(36).slice(2, 8);
    try {
      if (root.crypto && root.crypto.getRandomValues) {
        var a = new Uint32Array(1);
        root.crypto.getRandomValues(a);
        aleatorio = a[0].toString(36);
      }
    } catch (e) { /* usa Math.random */ }
    return Date.now().toString(36) + '-' + aleatorio;
  }

  function embaralhar(lista, aleatorio) {
    var rnd = aleatorio || Math.random;
    var a = lista.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // Ordem das 4 letras de cada um dos 25 grupos (gerada uma vez por candidato).
  function gerarPermutacoes(aleatorio) {
    var out = [];
    for (var i = 0; i < TOTAL; i++) out.push(embaralhar(LETRAS, aleatorio));
    return out;
  }

  // Uma ordem válida tem as 4 letras, cada uma uma vez (posição 0 = topo = nota 4).
  function ordemValida(ordem) {
    if (!Array.isArray(ordem) || ordem.length !== 4) return false;
    return LETRAS.every(function (l) { return ordem.indexOf(l) !== -1; });
  }

  // ordem: letras de cima para baixo (topo = 4 "mais me identifica" … base = 1). Retorna {D,I,S,C} ou null.
  function ordemParaGrupo(ordem) {
    if (!ordemValida(ordem)) return null;
    var g = {};
    ordem.forEach(function (letra, idx) { g[letra] = 4 - idx; });
    return g;
  }

  // Move o item da posição `de` para a posição `para` (índices de cima para baixo). Não altera a lista original.
  function mover(ordem, de, para) {
    var a = (ordem || []).slice();
    if (de < 0 || de >= a.length) return a;
    var destino = Math.max(0, Math.min(a.length - 1, para));
    if (destino === de) return a;
    var item = a.splice(de, 1)[0];
    a.splice(destino, 0, item);
    return a;
  }

  // Converte o progresso salvo (inclusive o formato antigo, de "tocar em ordem") para {ordens, respondidos}.
  function migrarProgresso(p) {
    if (!p || typeof p !== 'object') return p;
    var out = {};
    for (var k in p) if (Object.prototype.hasOwnProperty.call(p, k) && k !== 'selecoes') out[k] = p[k];
    var ordens = [], respondidos = [];
    var antigas = Array.isArray(p.selecoes) ? p.selecoes : [];
    for (var i = 0; i < TOTAL; i++) {
      var o = Array.isArray(p.ordens) ? p.ordens[i] : antigas[i];
      var ok = ordemValida(o);
      ordens.push(ok ? o.slice() : null);
      var marcado = Array.isArray(p.ordens) ? !!(Array.isArray(p.respondidos) && p.respondidos[i]) : ok;
      respondidos.push(ok && marcado);
    }
    out.ordens = ordens;
    out.respondidos = respondidos;
    // Parte 2: 10 grupos (ausente = nada respondido).
    var ordens2 = [], respondidos2 = [];
    for (var k = 0; k < TOTAL2; k++) {
      var o2 = Array.isArray(p.ordens2) ? p.ordens2[k] : null;
      var ok2 = ordemValida(o2);
      ordens2.push(ok2 ? o2.slice() : null);
      respondidos2.push(ok2 && !!(Array.isArray(p.respondidos2) && p.respondidos2[k]));
    }
    out.ordens2 = ordens2;
    out.respondidos2 = respondidos2;
    var g2 = Math.floor(Number(p.grupo2) || 0);
    out.grupo2 = g2 >= 0 && g2 < TOTAL2 ? g2 : 0;
    if (!(Array.isArray(p.permutacoes2) && p.permutacoes2.length === TOTAL2 && p.permutacoes2.every(ordemValida))) out.permutacoes2 = null;
    return out;
  }

  // Ordem dos 10 grupos da Parte 2 (gerada uma vez por pessoa).
  function gerarPermutacoes2(aleatorio) {
    var out = [];
    for (var i = 0; i < TOTAL2; i++) out.push(embaralhar(LETRAS, aleatorio));
    return out;
  }

  // Ordens da Parte 2 -> string de 40 dígitos (4 por grupo, na ordem D,I,S,C; topo = 4). '' se faltar algum grupo.
  function exigidoDasOrdens(ordens2) {
    if (!Array.isArray(ordens2) || ordens2.length < TOTAL2) return '';
    var out = '';
    for (var i = 0; i < TOTAL2; i++) {
      var g = ordemParaGrupo(ordens2[i]);
      if (!g) return '';
      out += LETRAS.map(function (l) { return g[l]; }).join('');
    }
    return out;
  }

  // formulario: o do processo (padrão quando ausente) — decide idade/função/empresa/e-mail/cidade/extras
  // e a Parte 2: com parte2 'ligada' o payload leva `exigido` (40 dígitos de dados.ordens2); sem ela, nada de exigido.
  function montarPayload(dados, ordens, agora, formulario) {
    var respostas = ordens.map(ordemParaGrupo);
    var campos = camposDoPayload(dados, formulario);
    var scoring = modScoring();
    var res = scoring.calcular(respostas);
    var fim = agora || new Date();
    var inicio = dados.inicio ? new Date(dados.inicio) : fim;
    var exigido = '';
    if (parte2Ligada(formulario)) {
      exigido = exigidoDasOrdens(dados.ordens2);
      if (!exigido) throw new Error('Segunda parte do teste incompleta.');
    }
    var payload = {
      v: 1,
      id: dados.id,
      nome: normalizarNome(dados.nome),
      telefone: telefoneParaSalvar(dados.telefone),
      idade: campos.idade,
      funcao: campos.funcao,
      empresa: campos.empresa,
      email: campos.email,
      cidade: campos.cidade,
      foto: campos.foto,
      extras: campos.extras,
      vaga: String(dados.vaga || '').trim(),
      consentimento: !!dados.consentimento,
      inicio: inicio.toISOString(),
      fim: fim.toISOString(),
      duracaoSeg: Math.max(0, Math.round((fim.getTime() - inicio.getTime()) / 1000)),
      respostas: scoring.compactar(respostas),
      resultado: { percentuais: res.percentuais, codigo: res.codigo },
      avaliacao: String(dados.avaliacaoCodigo || '').replace(/\s+/g, '').toUpperCase(),
      validacao: montarValidacao(dados)
    };
    if (exigido) payload.exigido = exigido;
    return payload;
  }

  function escapar(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Mensagem de erro de envio para o candidato: falhas de conexão/tempo são mostradas;
  // erros técnicos (configuração, servidor) viram uma orientação genérica.
  function mensagemErroEnvio(msg) {
    msg = String(msg || '');
    if (/conex|conectar|internet|demorou|ocupado|Muitos envios|link de avalia/i.test(msg)) return msg;
    return 'Não conseguimos enviar agora. Toque em "Gerar código de segurança" e envie o código ao recrutador.';
  }

  // Protocolo curto gerado pelo servidor: 2 dígitos + 1 letra maiúscula (sem I e O), ex.: "47K".
  var RE_PROTOCOLO = /^[0-9]{2}[A-HJ-NP-Z]$/;
  function protocoloValido(p) {
    return typeof p === 'string' && RE_PROTOCOLO.test(p);
  }
  // Aceita minúsculas e espaços ("47 k" -> "47K"). Retorna '' se não for um protocolo válido.
  function normalizarProtocolo(p) {
    var s = String(p == null ? '' : p).replace(/\s+/g, '').toUpperCase();
    return RE_PROTOCOLO.test(s) ? s : '';
  }

  // Quantos grupos a pessoa responde: CONFIG.GRUPOS_DEMONSTRACAO (1..24) liga o modo demonstração; senão, 25.
  function gruposDoTeste(cfg) {
    var n = Math.floor(Number(cfg && cfg.GRUPOS_DEMONSTRACAO) || 0);
    return n > 0 && n < TOTAL ? n : TOTAL;
  }

  // Grupos da Parte 2 que a pessoa responde: 10, ou no modo demonstração o mesmo número da parte 1 (até 10).
  function gruposParte2DoTeste(cfg) {
    var n = gruposDoTeste(cfg);
    return Math.min(TOTAL2, n);
  }

  // Modo demonstração: completa os grupos a partir de `n` com ordens aleatórias válidas e marca como respondidos.
  // Não altera os grupos já respondidos. Retorna { ordens, respondidos, preenchidos: [índices preenchidos agora] }.
  // total: quantos grupos há (25 na parte 1, padrão; 10 na Parte 2).
  function completarGruposDemonstracao(ordens, respondidos, n, aleatorio, total) {
    var o = [], r = [], preenchidos = [];
    var TOT = total > 0 ? Math.floor(total) : TOTAL;
    var inicio = Math.max(0, Math.min(TOT, Math.floor(Number(n) || 0)));
    for (var i = 0; i < TOT; i++) {
      var atual = Array.isArray(ordens) ? ordens[i] : null;
      var marcado = !!(Array.isArray(respondidos) && respondidos[i]);
      if (i >= inicio && !(marcado && ordemValida(atual))) {
        o.push(embaralhar(LETRAS, aleatorio));
        r.push(true);
        preenchidos.push(i);
      } else {
        o.push(ordemValida(atual) ? atual.slice() : (atual == null ? null : atual));
        r.push(marcado);
      }
    }
    return { ordens: o, respondidos: r, preenchidos: preenchidos };
  }

  /* ---------- Link de avaliação (?a=SEL1 ou #a-SEL1) ---------- */

  // Textos que mudam conforme a avaliação do link. avaliacao: {codigo, nome, tipo, empresaNome, mostrarResultado} ou null
  // (sem link = processo seletivo geral, com o nome de CONFIG.EMPRESA). Só texto puro: escape ao exibir.
  function textosAvaliacao(avaliacao, empresaConfig) {
    var av = avaliacao && typeof avaliacao === 'object' ? avaliacao : null;
    var equipe = !!(av && av.tipo === 'equipe');
    var empresa = av ? String(av.empresaNome || '') : String(empresaConfig || '');
    var daEmpresa = empresa ? ' da ' + empresa : '';
    return {
      comLink: !!av,
      tipo: equipe ? 'equipe' : 'selecao',
      empresa: empresa,
      contexto: equipe ? 'Avaliação de equipe' : 'Processo seletivo',
      pessoa: equipe ? 'colaborador' : 'candidato',
      mostrarVaga: !equipe,
      mostrarEmpresaAtual: !equipe,
      rotuloFuncao: equipe ? 'Seu cargo/função' : 'Função atual ou última',
      ajudaFuncao: equipe ? 'Ex.: Recepcionista, Supervisor de vendas' : 'Ex.: Recepcionista, Vendedor',
      finalidade: equipe
        ? 'Precisamos destes dados para vincular o resultado à avaliação da equipe.'
        : 'Precisamos destes dados para vincular o resultado à sua candidatura.',
      // Equipe: o resultado fica no cadastro da empresa e é compartilhado com ela (orientar a liderança).
      escopo: equipe
        ? 'na avaliação da equipe' + daEmpresa + ', conduzida pela Gestão sem Caos, e sei que o meu resultado será compartilhado com a empresa para orientar a liderança'
        : (av ? 'apenas nesta avaliação' + daEmpresa + ', conduzida pela Gestão sem Caos' : 'apenas neste processo seletivo' + daEmpresa),
      fimDados: equipe ? 'excluídos quando eu deixar a empresa ou pedir a exclusão' : (av ? 'excluídos ao final da avaliação' : 'excluídos ao final do processo'),
      usoDados: equipe
        ? 'Seu resultado fica no cadastro da equipe da empresa e é compartilhado com ela. Você pode pedir a exclusão a qualquer momento.'
        : av
        ? 'Seus dados serão usados apenas nesta avaliação e excluídos ao final.'
        : 'Seus dados serão usados apenas neste processo seletivo e excluídos ao final.',
      enviado: equipe
        ? 'Suas respostas foram enviadas com sucesso. Obrigado por participar da avaliação da equipe.'
        : 'Suas respostas foram enviadas com sucesso. O recrutador entrará em contato pelo telefone informado.',
      guardarCodigo: equipe ? 'Guarde este código. Se pedirem, é só informar.' : 'Guarde este código. Se o recrutador pedir, é só informar.',
      aoResponsavel: equipe ? 'à pessoa responsável pela avaliação' : 'ao recrutador'
    };
  }

  /* ---------- Etapa de confirmação (js/validacao.js) ---------- */

  function modValidacao() {
    if (SEM_VALIDACAO) return null;
    return root.DISC_VALIDACAO || (typeof require === 'function' ? require('./validacao.js') : null);
  }
  function modScoring() {
    return root.DISC_SCORING || (typeof require === 'function' ? require('./scoring.js') : null);
  }

  // Resultado das ordens atuais (null se faltar algum grupo).
  function resultadoDasOrdens(ordens) {
    if (!Array.isArray(ordens) || ordens.length < TOTAL) return null;
    var respostas = [];
    for (var i = 0; i < TOTAL; i++) {
      var g = ordemParaGrupo(ordens[i]);
      if (!g) return null;
      respostas.push(g);
    }
    try { return modScoring().calcular(respostas); } catch (e) { return null; }
  }

  // Monta a etapa uma vez (fica no progresso). `ordem` guarda o resultado de quando foi montada:
  // se a pessoa alterar grupos e o resultado mudar, a etapa é montada de novo.
  function novaValidacao(resultado, aleatorio) {
    var m = modValidacao().montarEtapa(resultado, aleatorio);
    return {
      montagem: { ordem: resultado.ordem.join(''), pares: m.pares, itens: m.itens },
      escolhas: [null, null, null],
      notas: {}
    };
  }

  function precisaMontarValidacao(v, resultado) {
    return !v || !v.montagem || !resultado || v.montagem.ordem !== resultado.ordem.join('');
  }

  function notaValida(n) { return typeof n === 'number' && Math.floor(n) === n && n >= 1 && n <= 5; }

  // Telas da etapa: 1 = retratos (3 rodadas), 2 = frases (4 notas).
  function telaValidacaoCompleta(v, tela) {
    if (!v || !v.montagem) return false;
    if (tela === 1) {
      return v.montagem.pares.length === 3 && v.montagem.pares.every(function (par, r) {
        return Array.isArray(v.escolhas) && par.indexOf(v.escolhas[r]) !== -1;
      });
    }
    return v.montagem.itens.length === 4 && v.montagem.itens.every(function (it) {
      return !!(v.notas && notaValida(v.notas[it.id]));
    });
  }

  function validacaoCompleta(v) {
    return telaValidacaoCompleta(v, 1) && telaValidacaoCompleta(v, 2);
  }

  // Soma o tempo (ms) passado num grupo. Não altera a lista original.
  function somarTempo(lista, i, ms) {
    var a = [];
    for (var k = 0; k < TOTAL; k++) {
      var n = Number(Array.isArray(lista) ? lista[k] : 0);
      a.push(isFinite(n) && n > 0 ? n : 0);
    }
    if (i >= 0 && i < TOTAL && ms > 0 && isFinite(ms)) a[i] = Math.min(86400, Math.round((a[i] + ms / 1000) * 10) / 10);
    return a;
  }

  // Objeto `validacao` do payload (null se a etapa não foi respondida).
  function montarValidacao(dados) {
    var v = dados && dados.validacao;
    if (!validacaoCompleta(v)) return null;
    var seg = somarTempo(dados.gruposSeg, -1, 0);
    var aceitos = Array.isArray(dados.aceitos) ? dados.aceitos : [];
    var semMexer = 0;
    for (var i = 0; i < TOTAL; i++) if (aceitos[i] === true) semMexer++;
    return {
      versao: 1,
      pares: v.montagem.pares.map(function (p) { return [p[0], p[1]]; }),
      escolhas: v.escolhas.slice(0, 3),
      itens: v.montagem.itens.map(function (it) { return { id: it.id, letra: it.letra, tipo: it.tipo, nota: v.notas[it.id] }; }),
      gruposSeg: seg,
      semMexer: semMexer,
      demonstracao: !!dados.demonstracao
    };
  }

  // Progresso salvo há mais de 7 dias (ou sem data) é considerado vencido.
  function progressoExpirado(p, agora) {
    if (!p || typeof p !== 'object') return true;
    var ref = Date.parse(p.salvoEm || p.inicio || '');
    if (isNaN(ref)) return !!(p.nome || p.telefone);
    return (agora || Date.now()) - ref > VALIDADE_PROGRESSO_MS;
  }

  // Demonstração do arraste (mão fantasma): só no primeiro grupo, até a pessoa tocar ou ver uma vez.
  function deveMostrarDemo(e) {
    return !!(e && e.etapa === 'teste' && e.grupo === 0 && !e.demoVista);
  }

  // Ao continuar um progresso salvo: para onde ir. Etapas que não existem mais (ex.: 'revisao', do fluxo antigo)
  // caem num destino válido: o primeiro grupo incompleto ou, com tudo respondido, a confirmação (onde está o envio).
  // n: grupos que a pessoa responde; temValidacao: se a etapa de confirmação existe. Retorna { etapa, grupo, confTela }.
  // p2 (opcional): { n } = grupos da Parte 2 que a pessoa responde (processo com a Parte 2 ligada). Com p2 o retorno
  // ganha `grupo2`, e as etapas 'parte2-intro' (transição) e 'parte2' (grupos) entram no caminho.
  function etapaRetomada(e, n, temValidacao, p2) {
    var r = etapaRetomadaParte1(e, n, temValidacao);
    if (!p2) return r;
    var est = e && typeof e === 'object' ? e : {};
    var n1 = Math.max(1, Math.min(TOTAL, Math.floor(Number(n) || TOTAL)));
    var n2 = Math.max(1, Math.min(TOTAL2, Math.floor(Number(p2.n) || TOTAL2)));
    var g2 = Math.max(0, Math.min(n2 - 1, Math.floor(Number(est.grupo2) || 0)));
    r.grupo2 = g2;
    if (r.etapa === 'identificacao') return r;
    if (est.etapa === 'teste' && r.etapa === 'teste') return r;
    for (var i = 0; i < n1; i++) {
      if (!(Array.isArray(est.respondidos) && est.respondidos[i] && ordemValida(Array.isArray(est.ordens) ? est.ordens[i] : null))) return r;
    }
    // Parte 1 completa: confere a Parte 2.
    var falta = -1, algum = false;
    for (var k = 0; k < n2; k++) {
      var ok = !!(Array.isArray(est.respondidos2) && est.respondidos2[k] && ordemValida(Array.isArray(est.ordens2) ? est.ordens2[k] : null));
      if (ok) algum = true;
      else if (falta === -1) falta = k;
    }
    var base = { grupo: r.grupo, confTela: r.confTela };
    function com(etapa, grupo2) { return { etapa: etapa, grupo: base.grupo, confTela: base.confTela, grupo2: grupo2 }; }
    if (falta !== -1) {
      if (!est.permutacoes2 || (!algum && est.etapa !== 'parte2')) return com('parte2-intro', 0);
      return com('parte2', est.etapa === 'parte2' ? Math.min(g2, falta) : falta);
    }
    // Parte 2 completa: se parou nela, volta para ela; senão segue para a confirmação (ou o envio).
    if (est.etapa === 'parte2' || est.etapa === 'parte2-intro') return com(est.etapa, g2);
    if (!temValidacao) return com('parte2', n2 - 1);
    return r;
  }

  function etapaRetomadaParte1(e, n, temValidacao) {
    var est = e && typeof e === 'object' ? e : {};
    var total = Math.max(1, Math.min(TOTAL, Math.floor(Number(n) || TOTAL)));
    var grupo = Math.max(0, Math.min(total - 1, Math.floor(Number(est.grupo) || 0)));
    var confTela = est.confTela === 2 ? 2 : 1;
    var etapa = est.etapa;
    if (etapa === 'identificacao') return { etapa: 'identificacao', grupo: grupo, confTela: confTela };
    if (['teste', 'confirmacao', 'revisao', 'enviando', 'parte2', 'parte2-intro'].indexOf(etapa) === -1) return { etapa: 'identificacao', grupo: grupo, confTela: confTela };
    if (etapa === 'teste') return est.permutacoes ? { etapa: 'teste', grupo: grupo, confTela: confTela } : { etapa: 'identificacao', grupo: grupo, confTela: confTela };
    for (var i = 0; i < total; i++) {
      var ok = !!(Array.isArray(est.respondidos) && est.respondidos[i] && ordemValida(Array.isArray(est.ordens) ? est.ordens[i] : null));
      if (!ok) return { etapa: 'teste', grupo: i, confTela: confTela };
    }
    if (!temValidacao) return { etapa: 'teste', grupo: total - 1, confTela: confTela };
    if (etapa !== 'confirmacao') confTela = telaValidacaoCompleta(est.validacao, 1) ? 2 : 1;
    return { etapa: 'confirmacao', grupo: grupo, confTela: confTela };
  }

  /* ---------------- Relatório da pessoa (renderização pura; usada também por meu-relatorio.html) ---------------- */

  function pctTexto(v) { return String(Math.round(Number(v) * 10) / 10).replace('.', ',') + '%'; }

  function listaTags(itens) {
    if (!itens || !itens.length) return '';
    return '<ul class="tags">' + itens.map(function (t) { return '<li class="selo">' + escapar(t) + '</li>'; }).join('') + '</ul>';
  }

  // Itens { titulo, texto, prazo? } em cartões empilhados.
  function listaItens(itens, comPrazo) {
    if (!itens || !itens.length) return '';
    return '<ul class="rel-itens' + (comPrazo ? ' rel-itens--plano' : '') + '">' + itens.map(function (it) {
      return '<li class="rel-item">' +
        (comPrazo ? '<span class="rel-prazo">' + escapar(it.prazo) + '</span>' : '') +
        '<p class="rel-item-titulo">' + escapar(it.titulo) + '</p>' +
        '<p class="rel-item-texto">' + escapar(it.texto) + '</p>' +
      '</li>';
    }).join('') + '</ul>';
  }

  function secaoRelatorio(sec) {
    var corpo = '';
    if (sec.id === 'fortes') corpo = listaTags(sec.caracteristicas) + '<h3 class="rel-h3">Como usar mais</h3>' + listaItens(sec.itens);
    else if (sec.id === 'pressao') corpo = listaTags(sec.sinais) + '<h3 class="rel-h3">O que fazer nessas horas</h3>' + listaItens(sec.itens);
    else if (sec.id === 'comunicacao') {
      corpo = '<ul class="rel-itens">' + (sec.perfis || []).map(function (pf) {
        return '<li class="rel-item rel-com" data-letra="' + escapar(pf.letra) + '">' +
          '<p class="rel-item-titulo"><span class="letra-disc letra-disc--mini disc-' + escapar(pf.letra) + '" aria-hidden="true">' + escapar(pf.letra) + '</span>' +
            'Com pessoas de perfil ' + escapar(pf.rotulo) + ' <span class="perfil-sub">' + escapar(pf.nome) + '</span></p>' +
          '<p class="rel-item-texto">' + escapar(pf.texto) + '</p>' +
        '</li>';
      }).join('') + '</ul>';
    } else corpo = listaItens(sec.itens, sec.id === 'plano' || sec.id === 'plano90');
    var idT = 'rel-' + escapar(sec.id);
    return '' +
      '<section class="caixa rel-caixa rel-secao surgir" data-secao="' + escapar(sec.id) + '" aria-labelledby="' + idT + '">' +
        '<h2 id="' + idT + '" class="caixa__titulo rel-secao-titulo">' + escapar(sec.titulo) + '</h2>' +
        (sec.intro ? '<p class="rel-nota">' + escapar(sec.intro) + '</p>' : '') +
        corpo +
      '</section>';
  }

  var NOMES_FATORES = { D: 'Dominância', I: 'Influência', S: 'Estabilidade', C: 'Conformidade' };

  function larguraPct(v) { return Math.max(4, Math.min(100, (Number(v) / 40) * 100)); }

  // "Onde você está se esticando" (Parte 2): índice de esforço, natural × trabalho por fator e os textos.
  function secaoEsticando(sec, d) {
    var natural = {};
    (d.fatores || []).forEach(function (f) { natural[f.letra] = Number(f.pct); });
    var ex = (sec.exigido && sec.exigido.percentuais) || {};
    var comparacao = LETRAS.map(function (l) {
      var n = natural[l], e = Number(ex[l]);
      if (!isFinite(n) || !isFinite(e)) return '';
      var delta = Math.round((e - n) * 10) / 10;
      var deltaTxt = delta > 0 ? '+' + pctTexto(delta).replace('%', '') : delta < 0 ? '−' + pctTexto(-delta).replace('%', '') : '0';
      return '' +
        '<li class="estica-fator" data-letra="' + l + '">' +
          '<span class="letra-disc letra-disc--mini disc-' + l + '" aria-hidden="true">' + l + '</span>' +
          '<span class="estica-nome">' + escapar(NOMES_FATORES[l]) + '</span>' +
          '<span class="estica-delta' + (Math.abs(delta) >= 3 ? ' estica-delta--forte' : '') + '" aria-label="diferença de ' + escapar(deltaTxt) + ' pontos">' + escapar(deltaTxt) + '</span>' +
          '<span class="estica-barras">' +
            '<span class="estica-linha"><span class="estica-rotulo">Natural</span><span class="trilho estica-trilho"><span class="estica-valor disc-' + l + '" style="width:' + larguraPct(n) + '%"></span></span><span class="estica-pct">' + pctTexto(n) + '</span></span>' +
            '<span class="estica-linha"><span class="estica-rotulo">Trabalho</span><span class="trilho estica-trilho"><span class="estica-valor estica-valor--trabalho" style="width:' + larguraPct(e) + '%"></span></span><span class="estica-pct">' + pctTexto(e) + '</span></span>' +
          '</span>' +
        '</li>';
    }).join('');
    var indice = Math.max(0, Math.min(100, Math.round(Number(sec.indice) || 0)));
    var idT = 'rel-' + escapar(sec.id);
    return '' +
      '<section class="caixa rel-caixa rel-secao rel-esticando surgir" data-secao="esticando" data-faixa="' + escapar(sec.faixa || '') + '" aria-labelledby="' + idT + '">' +
        '<h2 id="' + idT + '" class="caixa__titulo rel-secao-titulo">' + escapar(sec.titulo) + '</h2>' +
        (sec.intro ? '<p class="rel-nota">' + escapar(sec.intro) + '</p>' : '') +
        '<div class="estica-indice">' +
          '<p class="estica-indice-num"><span class="t-numero">' + indice + '</span><span class="estica-indice-de">de 100</span></p>' +
          '<p class="estica-indice-texto">Esforço de adaptação <span class="selo selo--noite estica-faixa">' + escapar(sec.rotulo || '') + '</span></p>' +
        '</div>' +
        (comparacao ? '<ul class="estica-fatores" aria-label="Seu jeito natural e o que o trabalho pede, por fator">' + comparacao + '</ul>' : '') +
        listaItens(sec.itens) +
      '</section>';
  }

  // Relatório "modelo pessoa" (dados de js/relatorio-pessoa.js) em cartões empilhados.
  // Com a rodada 3: nome da combinação, faixa de intensidade de cada fator, as seções de aprofundamento e,
  // com a Parte 2, "Onde você está se esticando" logo depois do resumo.
  function avatarHtml(foto, nome) {
    var inicial = String(nome || '').trim().charAt(0).toUpperCase();
    return '<span class="rel-avatar" aria-hidden="true">' +
      (fotoValida(foto) ? '<img src="' + escapar(foto) + '" alt="" width="48" height="48">' : escapar(inicial || '•')) + '</span>';
  }

  // opcoes (venda B2C, meu-relatorio.html): { travas: true (seção "O que está te travando"), plano90: true (Completo + Parte 2),
  //   mapa: true (mapa ritmo × foco, com a Parte 2), botaoPdf: texto do botão (padrão "Salvar em PDF") }.
  // Sem opcoes: exatamente o relatório de antes (fluxo de processo/equipe).
  function relatorioPessoaHtml(d, foto, opcoes) {
    if (!d) return '';
    var op = opcoes || {};
    var faixas = {};
    (d.intensidade || []).forEach(function (f) { if (f && f.letra) faixas[f.letra] = f; });
    var barras = d.fatores.map(function (f) {
      var largura = larguraPct(f.pct);
      var fx = faixas[f.letra];
      return '' +
        '<li class="barra-linha rel-fator" data-letra="' + escapar(f.letra) + '"' + (fx ? ' data-faixa="' + escapar(fx.faixa) + '"' : '') + '>' +
          '<span class="letra-disc disc-' + escapar(f.letra) + ' barra-letra" aria-hidden="true">' + escapar(f.letra) + '</span>' +
          '<span class="barra-nome"><span class="rel-fator-nome">' + escapar(f.nome) + '</span>' +
            '<span class="visualmente-oculto"> (' + escapar(f.letra) + ')</span>' +
            (fx && fx.rotulo ? '<span class="rel-fator-faixa">Intensidade ' + escapar(String(fx.rotulo).toLowerCase()) + '</span>' : '') +
            '<span class="rel-fator-desc">' + escapar(f.descricao) + '</span></span>' +
          '<span class="barra-trilho trilho" aria-hidden="true"><span class="barra-valor disc-' + escapar(f.letra) + '" style="width:' + largura + '%"></span></span>' +
          '<span class="barra-pct rel-pct">' + pctTexto(f.pct) + '</span>' +
        '</li>';
    }).join('');
    var titulo = (d.nome ? escapar(d.nome) + ', seu' : 'Seu') + ' estilo é ' + escapar(d.primario.rotulo) + ', com traços de ' + escapar(d.secundario.rotulo);
    var cb = d.combinacao;
    var combinacao = cb && cb.nome
      ? '<p class="rel-combinacao"><span class="rel-combinacao-rotulo">Sua combinação</span><strong class="rel-combinacao-nome">' + escapar(cb.nome) + '</strong>' +
          (cb.frase ? '<span class="rel-combinacao-frase">' + escapar(cb.frase) + '</span>' : '') + '</p>'
      : '';
    var extras = Array.isArray(d.aprofundamento) ? d.aprofundamento : [];
    var est = extras.filter(function (x) { return x && x.id === 'esticando'; })[0] || d.esticando || null;
    var outras = extras.filter(function (x) { return x && x.id !== 'esticando'; });
    return '' +
      '<div class="relatorio-candidato relatorio-pessoa" data-codigo="' + escapar(d.codigo) + '">' +
        '<section class="caixa rel-caixa surgir" aria-labelledby="titulo-relatorio">' +
          '<div class="rel-cabeca">' + avatarHtml(foto, d.nome) + '<p class="sobretitulo">Seu relatório DISC</p></div>' +
          '<h2 id="titulo-relatorio" class="rel-titulo">' + titulo + '</h2>' +
          '<p class="rel-intro rel-frase">' + escapar(d.frase) + '</p>' +
          combinacao +
          '<h3 class="rel-h3">Seus 4 fatores</h3>' +
          '<p class="rel-nota">Quanto maior a barra, mais esse jeito aparece no seu dia a dia. Os quatro somam 100%.</p>' +
          '<ul class="barras rel-barras">' + barras + '</ul>' +
          '<div class="acoes rel-acoes">' +
            '<button type="button" class="botao botao--claro" data-acao="imprimir">' + escapar(op.botaoPdf || 'Salvar em PDF') + '</button>' +
          '</div>' +
        '</section>' +
        (op.travas && d.travas ? secaoTravas(d.travas) : '') +
        (est ? secaoEsticando(est, d) : '') +
        (op.mapa && est ? mapaRitmoFoco(d, est) : '') +
        d.secoes.map(secaoRelatorio).join('') +
        outras.map(secaoRelatorio).join('') +
        (op.plano90 && d.plano90 ? secaoRelatorio(d.plano90) : '') +
        '<p class="rel-aviso">' + escapar(d.aviso) + '</p>' +
      '</div>';
  }

  // "O que está te travando" (js/relatorio-pessoa.js, montar().travas): cada padrão com UMA ação prática.
  var ROTULO_TRAVA = { adaptacao: 'Esforço de adaptação', excesso: 'Força que passa do ponto', falta: 'O que quase não aparece', pressao: 'Sob pressão' };
  function secaoTravas(sec) {
    if (!sec || !Array.isArray(sec.itens) || !sec.itens.length) return '';
    return '' +
      '<section class="caixa rel-caixa rel-secao rel-travas surgir" data-secao="travas" aria-labelledby="rel-travas">' +
        '<h2 id="rel-travas" class="caixa__titulo rel-secao-titulo">' + escapar(sec.titulo) + '</h2>' +
        (sec.intro ? '<p class="rel-nota">' + escapar(sec.intro) + '</p>' : '') +
        '<ol class="travas">' + sec.itens.map(function (it, k) {
          return '<li class="trava" data-tipo="' + escapar(it.tipo || '') + '">' +
            '<span class="trava-num" aria-hidden="true">' + (k + 1) + '</span>' +
            '<div class="trava-corpo">' +
              '<p class="trava-tipo">' + escapar(ROTULO_TRAVA[it.tipo] || '') + '</p>' +
              '<p class="rel-item-titulo">' + escapar(it.titulo) + '</p>' +
              '<p class="rel-item-texto">' + escapar(it.texto) + '</p>' +
              (it.acao ? '<p class="trava-acao"><span class="trava-acao-rotulo">Para destravar</span>' + escapar(it.acao) + '</p>' : '') +
            '</div>' +
          '</li>';
        }).join('') + '</ol>' +
      '</section>';
  }

  // Ritmo = (D + I) − (S + C) (+ acelerado); foco = (D + C) − (I + S) (+ tarefas), como em js/disc-exigido.js.
  function eixosDe(p) {
    var v = {};
    LETRAS.forEach(function (l) { v[l] = Number(p && p[l]) || 0; });
    return { ritmo: Math.round((v.D + v.I - v.S - v.C) * 10) / 10, foco: Math.round((v.D + v.C - v.I - v.S) * 10) / 10 };
  }
  // Posição no quadro (0–100%): x = pessoas → direita, y = acelerado → em cima. Os valores vão de −60 a 60.
  function posicaoMapa(e) {
    function pct(v) { return Math.max(6, Math.min(94, Math.round((50 + (v / 60) * 50) * 10) / 10)); }
    return { x: pct(-e.foco), y: pct(-e.ritmo) };
  }
  function mapaRitmoFoco(d, est) {
    var nat = {};
    (d.fatores || []).forEach(function (f) { nat[f.letra] = Number(f.pct); });
    var ex = est && est.exigido && est.exigido.percentuais;
    var pn = posicaoMapa(eixosDe(nat));
    var pe = ex ? posicaoMapa(eixosDe(ex)) : null;
    function ponto(p, classe, rotulo) {
      return '<span class="mapa-ponto ' + classe + '" style="left:' + p.x + '%;top:' + p.y + '%" data-rotulo="' + rotulo + '"></span>';
    }
    return '' +
      '<section class="caixa rel-caixa rel-secao rel-mapa surgir" data-secao="mapa" aria-labelledby="rel-mapa">' +
        '<h2 id="rel-mapa" class="caixa__titulo rel-secao-titulo">Mapa ritmo × foco</h2>' +
        '<p class="rel-nota">Onde o seu jeito natural fica e para onde o seu trabalho puxa você. Quanto mais longe os dois pontos, mais energia a adaptação costuma pedir.</p>' +
        '<div class="mapa" role="img" aria-label="Seu jeito natural e o que o trabalho pede, no mapa de ritmo (acelerado ou cauteloso) e foco (tarefas ou pessoas)">' +
          '<span class="mapa-eixo mapa-eixo--x" aria-hidden="true"></span><span class="mapa-eixo mapa-eixo--y" aria-hidden="true"></span>' +
          '<span class="mapa-canto mapa-canto--topo">Acelerado</span><span class="mapa-canto mapa-canto--base">Cauteloso</span>' +
          '<span class="mapa-canto mapa-canto--esq">Tarefas</span><span class="mapa-canto mapa-canto--dir">Pessoas</span>' +
          (pe ? ponto(pe, 'mapa-ponto--trabalho', 'Trabalho') : '') +
          ponto(pn, 'mapa-ponto--voce', 'Você') +
        '</div>' +
        '<ul class="mapa-legenda"><li><span class="mapa-marca mapa-marca--voce" aria-hidden="true"></span>Você (natural)</li>' +
          (pe ? '<li><span class="mapa-marca mapa-marca--trabalho" aria-hidden="true"></span>O que o trabalho pede</li>' : '') + '</ul>' +
      '</section>';
  }

  /* ---------------- Modo pessoal (venda B2C, Gestão sem Caos) ---------------- */

  var EMPRESA_B2C = 'Gestão sem Caos';
  var PACOTES_PAGOS = ['completo', 'completo_plus'];

  // ?modo=pessoal (ou #pessoal) liga o modo; &pacote=completo|completo_plus pré-escolhe; &cupom=X pré-preenche o cupom
  // no checkout; #p2-<token> abre a Parte 2 de quem comprou o Completo + Parte 2. -> { pessoal, pacote, parte2Token, cupom }
  // (utm_*, gclid, fbclid e ref da landing são ignorados: o envio não tem campo para eles)
  function modoPessoalDaUrl(search, hash) {
    var q = String(search || ''), h = String(hash || '');
    function param(nome) {
      var m = new RegExp('[?&]' + nome + '=([^&#]*)').exec(q);
      try { return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : ''; } catch (e) { return ''; }
    }
    var p2 = /^#p2-([A-Za-z0-9_-]{16,128})$/.exec(h);
    var pessoal = param('modo').toLowerCase() === 'pessoal' || /^#pessoal\b/.test(h) || !!p2;
    var pacote = param('pacote').toLowerCase();
    var cupom = param('cupom').replace(/\s+/g, '').toUpperCase();
    return {
      pessoal: pessoal,
      pacote: pessoal && PACOTES_PAGOS.indexOf(pacote) !== -1 ? pacote : '',
      parte2Token: pessoal && p2 ? p2[1] : '',
      cupom: pessoal && /^[A-Z0-9_-]{3,30}$/.test(cupom) ? cupom : ''
    };
  }

  // Identificação B2C: nome, e-mail (obrigatório, é a "conta"), WhatsApp opcional e consentimento. -> { campo: msg }
  function validarIdentificacaoPessoal(d) {
    var erros = {};
    var en = validarNome(d.nome);
    if (en) erros.nome = en;
    var email = limparEmail(d.email);
    if (!email) erros.email = 'Informe seu e-mail: é por ele que você recebe e recupera o relatório.';
    else if (!emailValido(email)) erros.email = 'Confira o e-mail (ex.: nome@gmail.com).';
    if (limparTelefone(d.telefone)) { var et = validarTelefone(d.telefone); if (et) erros.telefone = et; }
    if (!d.consentimento) erros.consentimento = 'Para continuar, marque a autorização de uso dos dados.';
    return erros;
  }

  // Payload do envio pessoal (enviarPessoal): sem idade, vaga, empresa ou processo; telefone só se informado.
  function montarPayloadPessoal(dados, ordens, agora) {
    var respostas = ordens.map(ordemParaGrupo);
    var scoring = modScoring();
    var res = scoring.calcular(respostas);
    var fim = agora || new Date();
    var inicio = dados.inicio ? new Date(dados.inicio) : fim;
    var tel = limparTelefone(dados.telefone);
    return {
      v: 1,
      origem: 'pessoal',
      id: dados.id,
      nome: normalizarNome(dados.nome),
      email: limparEmail(dados.email),
      telefone: tel ? telefoneParaSalvar(tel) : '',
      consentimento: !!dados.consentimento,
      inicio: inicio.toISOString(),
      fim: fim.toISOString(),
      duracaoSeg: Math.max(0, Math.round((fim.getTime() - inicio.getTime()) / 1000)),
      respostas: scoring.compactar(respostas),
      resultado: { percentuais: res.percentuais, codigo: res.codigo }
    };
  }

  function modCheckout() {
    return root.DISC_CHECKOUT || (typeof require === 'function' ? require('./checkout.js') : null);
  }

  // Resumo grátis (montarSimples): perfil em uma frase, combinação, 4 fatores com barras e 3 forças.
  function resumoGratisHtml(s) {
    if (!s) return '';
    var barras = s.fatores.map(function (f) {
      return '' +
        '<li class="barra-linha rel-fator" data-letra="' + escapar(f.letra) + '"' + (f.faixa ? ' data-faixa="' + escapar(f.faixa) + '"' : '') + '>' +
          '<span class="letra-disc disc-' + escapar(f.letra) + ' barra-letra" aria-hidden="true">' + escapar(f.letra) + '</span>' +
          '<span class="barra-nome"><span class="rel-fator-nome">' + escapar(f.nome) + '</span>' +
            '<span class="visualmente-oculto"> (' + escapar(f.letra) + ')</span>' +
            (f.rotulo ? '<span class="rel-fator-faixa">Intensidade ' + escapar(String(f.rotulo).toLowerCase()) + '</span>' : '') + '</span>' +
          '<span class="barra-trilho trilho" aria-hidden="true"><span class="barra-valor disc-' + escapar(f.letra) + '" style="width:' + larguraPct(f.pct) + '%"></span></span>' +
          '<span class="barra-pct rel-pct">' + pctTexto(f.pct) + '</span>' +
        '</li>';
    }).join('');
    var cb = s.combinacao;
    return '' +
      '<section class="caixa caixa--vidro rel-caixa resumo-gratis surgir" aria-labelledby="titulo" data-codigo="' + escapar(s.codigo) + '">' +
        '<p class="sobretitulo">Seu resumo grátis</p>' +
        '<h1 id="titulo" class="rel-titulo resumo-titulo">' + (s.nome ? escapar(s.nome) + ', seu' : 'Seu') + ' estilo é ' + escapar(s.primario.rotulo) + ', com traços de ' + escapar(s.secundario.rotulo) + '</h1>' +
        '<p class="rel-intro rel-frase">' + escapar(s.frase) + '</p>' +
        (cb && cb.nome
          ? '<p class="rel-combinacao"><span class="rel-combinacao-rotulo">Sua combinação</span><strong class="rel-combinacao-nome">' + escapar(cb.nome) + '</strong>' +
              (cb.frase ? '<span class="rel-combinacao-frase">' + escapar(cb.frase) + '</span>' : '') + '</p>'
          : '') +
        '<h2 class="rel-h3">Seus 4 fatores</h2>' +
        '<p class="rel-nota">Quanto maior a barra, mais esse jeito aparece no seu dia a dia. Os quatro somam 100%.</p>' +
        '<ul class="barras rel-barras">' + barras + '</ul>' +
        '<h2 class="rel-h3">Suas 3 forças</h2>' +
        listaItens(s.forcas) +
      '</section>';
  }

  // Prévia do que é pago: títulos reais (inclusive os de "O que está te travando") e só a 1ª frase do 1º item;
  // o resto aparece como linhas borradas (o texto pago não vai para a tela).
  var ICONE_CADEADO = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
  function linhasBorradas(n) {
    var out = '';
    for (var k = 0; k < n; k++) out += '<span class="borrado-linha" style="width:' + [96, 88, 92, 70, 84][k % 5] + '%"></span>';
    return '<span class="borrado" aria-hidden="true">' + out + '</span>';
  }
  function primeiraFrase(t) {
    var m = /^[^.!?]*[.!?]/.exec(String(t || ''));
    return m ? m[0] : String(t || '');
  }
  function previaPagaHtml(d) {
    if (!d) return '';
    var tr = d.travas && d.travas.itens ? d.travas.itens : [];
    var outras = [
      ['Régua de intensidade', 'Em que faixa está cada fator e o que isso muda no seu dia a dia.'],
      ['Como você reage sob pressão', 'Os sinais de que o seu jeito passou do ponto e o que fazer nessas horas.'],
      ['Como você decide, aprende e se comunica', 'O seu jeito de escolher, de aprender e de falar com cada perfil.'],
      ['Seu plano de 30, 60 e 90 dias', 'Hábitos práticos, um de cada vez, para desenvolver o que mais importa.']
    ];
    return '' +
      '<section class="caixa previa-paga surgir" aria-labelledby="titulo-previa">' +
        '<p class="sobretitulo">Relatório completo</p>' +
        '<h2 id="titulo-previa" class="titulo-secao">O que o relatório completo mostra</h2>' +
        '<div class="previa-travas">' +
          '<p class="previa-rotulo">O que está te travando</p>' +
          '<ol class="previa-lista">' + tr.map(function (it, k) {
            return '<li class="previa-item"><span class="trava-num" aria-hidden="true">' + (k + 1) + '</span><div class="previa-corpo">' +
              '<p class="previa-item-titulo">' + escapar(it.titulo) + '</p>' +
              (k === 0 ? '<p class="previa-frase">' + escapar(primeiraFrase(it.texto)) + '</p>' : '') +
              linhasBorradas(k === 0 ? 2 : 3) +
              '<p class="previa-trancado">' + ICONE_CADEADO + 'Ação para destravar no relatório completo</p>' +
            '</div></li>';
          }).join('') + '</ol>' +
        '</div>' +
        '<ul class="previa-secoes">' + outras.map(function (o) {
          return '<li class="previa-secao"><p class="previa-item-titulo">' + escapar(o[0]) + '</p><p class="previa-desc">' + escapar(o[1]) + '</p>' + linhasBorradas(2) + '</li>';
        }).join('') + '</ul>' +
      '</section>';
  }

  // Cards dos pacotes pagos (o escolhido, ou o Completo + Parte 2, em destaque com o único botão laranja).
  function pacotesHtml(pacotes, escolhido, hoje) {
    var CK = modCheckout();
    var pagos = (pacotes || []).filter(function (p) { return PACOTES_PAGOS.indexOf(p.chave) !== -1; });
    if (!pagos.length || !CK) return '';
    var destaque = escolhido && pagos.some(function (p) { return p.chave === escolhido; }) ? escolhido
      : (pagos.some(function (p) { return p.chave === 'completo_plus'; }) ? 'completo_plus' : pagos[0].chave);
    return '<ul class="pacotes" id="pacotes">' + pagos.map(function (p) {
      var pv = CK.precoVigente(p, hoje);
      var em = p.chave === destaque;
      return '' +
        '<li class="pacote' + (em ? ' pacote--destaque' : '') + '" data-pacote="' + escapar(p.chave) + '">' +
          (em ? '<span class="selo selo--laranja pacote-selo">' + (escolhido === p.chave ? 'Sua escolha' : 'Mais completo') + '</span>' : '') +
          '<h3 class="pacote-nome">' + escapar(p.nome) + '</h3>' +
          '<p class="pacote-preco">' +
            (pv.lancamento ? '<s class="pacote-cheio">' + escapar(CK.formatarPreco(pv.cheioCentavos)) + '</s>' : '') +
            '<strong class="pacote-valor">' + escapar(CK.formatarPreco(pv.centavos)) + '</strong>' +
            (pv.lancamento ? '<span class="pacote-lancamento">preço de lançamento</span>' : '') +
          '</p>' +
          '<ul class="pacote-itens">' + (p.itens || []).map(function (t) { return '<li>' + escapar(t) + '</li>'; }).join('') + '</ul>' +
          '<button type="button" class="botao ' + (em ? 'botao--laranja' : 'botao--principal') + ' botao--grande botao--bloco" data-acao="comprar" data-pacote="' + escapar(p.chave) + '">' +
            'Quero o ' + escapar(p.chave === 'completo_plus' ? 'Completo + Parte 2' : 'Relatório completo') + '</button>' +
        '</li>';
    }).join('') + '</ul>';
  }


  var PURAS = {
    modoPessoalDaUrl: modoPessoalDaUrl,
    validarIdentificacaoPessoal: validarIdentificacaoPessoal,
    montarPayloadPessoal: montarPayloadPessoal,
    relatorioPessoaHtml: relatorioPessoaHtml,
    secaoTravas: secaoTravas,
    mapaRitmoFoco: mapaRitmoFoco,
    posicaoMapa: posicaoMapa,
    eixosDe: eixosDe,
    resumoGratisHtml: resumoGratisHtml,
    previaPagaHtml: previaPagaHtml,
    pacotesHtml: pacotesHtml,
    EMPRESA_B2C: EMPRESA_B2C,
    deveMostrarDemo: deveMostrarDemo,
    validarNome: validarNome,
    normalizarNome: normalizarNome,
    validarTelefone: validarTelefone,
    limparTelefone: limparTelefone,
    formatarTelefone: formatarTelefone,
    telefoneParaSalvar: telefoneParaSalvar,
    validarIdade: validarIdade,
    limparIdade: limparIdade,
    idadeParaSalvar: idadeParaSalvar,
    limparTextoCurto: limparTextoCurto,
    normalizarFormulario: normalizarFormulario,
    formularioEfetivo: formularioEfetivo,
    parte2Ligada: parte2Ligada,
    gerarPermutacoes2: gerarPermutacoes2,
    exigidoDasOrdens: exigidoDasOrdens,
    gruposParte2DoTeste: gruposParte2DoTeste,
    GRUPOS_PARTE2: GRUPOS_PARTE2_PADRAO,
    PERGUNTAS_PARTE2: PERGUNTAS_PARTE2,
    validarCamposFormulario: validarCamposFormulario,
    camposDoPayload: camposDoPayload,
    emailValido: emailValido,
    limparEmail: limparEmail,
    limparResposta: limparResposta,
    etapaRetomada: etapaRetomada,
    ROTULOS_CAMPOS: ROTULOS_CAMPOS,
    fotoValida: fotoValida,
    recorteCentro: recorteCentro,
    prepararFoto: prepararFoto,
    FOTO_MAX: FOTO_MAX,
    gerarId: gerarId,
    embaralhar: embaralhar,
    gerarPermutacoes: gerarPermutacoes,
    ordemValida: ordemValida,
    ordemParaGrupo: ordemParaGrupo,
    mover: mover,
    migrarProgresso: migrarProgresso,
    montarPayload: montarPayload,
    escapar: escapar,
    perguntaDoGrupo: perguntaDoGrupo,
    palavraDoGrupo: palavraDoGrupo,
    mensagemErroEnvio: mensagemErroEnvio,
    progressoExpirado: progressoExpirado,
    protocoloValido: protocoloValido,
    normalizarProtocolo: normalizarProtocolo,
    gruposDoTeste: gruposDoTeste,
    completarGruposDemonstracao: completarGruposDemonstracao,
    textosAvaliacao: textosAvaliacao,
    resultadoDasOrdens: resultadoDasOrdens,
    novaValidacao: novaValidacao,
    precisaMontarValidacao: precisaMontarValidacao,
    telaValidacaoCompleta: telaValidacaoCompleta,
    validacaoCompleta: validacaoCompleta,
    somarTempo: somarTempo,
    montarValidacao: montarValidacao,
    PERGUNTAS: PERGUNTAS,
    ROTULOS: ROTULOS
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PURAS;
    return;
  }
  root.DISC_APP = PURAS;
  if (typeof document === 'undefined') return;

  /* ------------------------------------------------------------------ */
  /* Navegador                                                           */
  /* ------------------------------------------------------------------ */

  var CONFIG = root.CONFIG || {};
  var DATA = root.DISC_DATA;
  var DICAS = root.DISC_DICAS || null;
  var N = gruposDoTeste(CONFIG);          // grupos que a pessoa responde (25, ou menos no modo demonstração)
  var DEMO = N < TOTAL;
  var N2 = gruposParte2DoTeste(CONFIG);   // grupos da Parte 2 que a pessoa responde (10, ou menos no modo demonstração)
  var app, aviso;
  var estado;
  var envio = { carregando: false, erro: '' };
  var arraste = null;   // arraste em andamento na lista de palavras
  // Avaliação do link (?a= / #a-): {codigo, nome, tipo, empresaNome, mostrarResultado} ou null (fluxo geral).
  var AVAL = null;
  var CODIGO_LINK = '';
  var telaLink = '';    // '', 'carregando', 'invalido' ou 'erro' (enquanto não dá para começar)
  var erroLink = '';
  var crono = null;     // tempo no grupo atual: { estado, grupo, t0 }
  // Modo pessoal (venda B2C, Gestão sem Caos): index.html?modo=pessoal (&pacote=...) ou #p2-<token> (Parte 2 comprada).
  var MODO = { pessoal: false, pacote: '', parte2Token: '', cupom: '' };
  try { MODO = modoPessoalDaUrl(root.location.search, root.location.hash); } catch (e) { /* sem URL */ }
  var PESSOAL = MODO.pessoal;
  var P2_TOKEN = '';           // Parte 2 de quem comprou o Completo + Parte 2 (definido ao entrar nela)
  var CHAVE_PESSOAL = 'disc_pessoal_v1';
  var PACOTES = null;          // pacotes do servidor (DISC_CHECKOUT.normalizarPacotes) ou null = padrão
  var checkout = null;         // controlador do checkout na tela
  var telaP2 = '';             // '', 'carregando' ou mensagem de erro ao abrir a Parte 2 pelo link
  if (PESSOAL) { SEM_VALIDACAO = true; CHAVE_PROGRESSO = 'disc_pessoal_progresso_v1'; }

  function estadoInicial() {
    return {
      etapa: 'boasvindas',
      id: '',
      nome: '',
      telefone: '',
      idade: '',
      funcao: '',
      empresa: '',
      email: '',
      cidade: '',
      extras: {},              // respostas das perguntas extras do processo: { id: texto }
      foto: '',                // data URL JPEG 192x192 (ou '')
      vaga: '',
      consentimento: false,
      inicio: '',
      permutacoes: null,
      ordens: [],
      respondidos: [],
      grupo: 0,
      reenviar: false,         // voltou à identificação no envio (dado faltando): o botão vira "Salvar e enviar"
      preenchidosAoAcaso: [],  // modo demonstração: grupos completados automaticamente
      avaliacaoCodigo: AVAL ? AVAL.codigo : '',
      gruposSeg: [],           // segundos em cada grupo (acumula se voltar)
      aceitos: [],             // grupos confirmados em "Esta ordem está certa" sem mexer
      validacao: null,         // etapa de confirmação: { montagem, escolhas, notas }
      confTela: 1,
      demoVista: false,        // a demonstração do arraste já foi vista (não reaparece sozinha)
      demonstracao: DEMO,
      // Parte 2 (perfil exigido pelo trabalho), só com o processo que a liga:
      permutacoes2: null,      // ordem inicial das palavras nos 10 grupos
      ordens2: [],
      respondidos2: [],
      grupo2: 0,
      preenchidosAoAcaso2: []  // modo demonstração: grupos da Parte 2 completados automaticamente
    };
  }

  // Progresso antigo (sem os campos novos) continua valendo.
  function garantirCampos(e) {
    if (!Array.isArray(e.gruposSeg)) e.gruposSeg = [];
    if (!Array.isArray(e.aceitos)) e.aceitos = [];
    if (e.validacao && (typeof e.validacao !== 'object' || !e.validacao.montagem)) e.validacao = null;
    if (e.confTela !== 2) e.confTela = 1;
    e.demoVista = e.demoVista === true;
    e.demonstracao = DEMO;
    delete e.voltarParaRevisao;   // fluxo antigo (tela de revisão)
    e.reenviar = e.reenviar === true;
    if (!e.extras || typeof e.extras !== 'object' || Array.isArray(e.extras)) e.extras = {};
    if (typeof e.email !== 'string') e.email = '';
    if (typeof e.cidade !== 'string') e.cidade = '';
    if (!fotoValida(e.foto)) e.foto = '';
    if (!Array.isArray(e.ordens2)) e.ordens2 = [];
    if (!Array.isArray(e.respondidos2)) e.respondidos2 = [];
    if (!Array.isArray(e.preenchidosAoAcaso2)) e.preenchidosAoAcaso2 = [];
    var g2 = Math.floor(Number(e.grupo2) || 0);
    e.grupo2 = g2 >= 0 && g2 < N2 ? g2 : 0;
    if (!(Array.isArray(e.permutacoes2) && e.permutacoes2.length === TOTAL2)) e.permutacoes2 = null;
    return e;
  }

  function T() { return textosAvaliacao(AVAL, CONFIG.EMPRESA); }

  // Formulário de identificação que vale agora (o do link ou o padrão).
  function FORM() { return formularioEfetivo(AVAL && AVAL.formulario, AVAL ? AVAL.tipo : 'selecao'); }

  /* ---- Parte 2 (perfil exigido pelo trabalho) ---- */
  function modExigido() { return root.DISC_EXIGIDO || null; }
  // Liga só com o link de um processo que tem formulario.parte2 === 'ligada'.
  function P2() { return !!P2_TOKEN || (!!AVAL && parte2Ligada(AVAL.formulario)); }
  // Índices de DISC_DATA.grupos usados na Parte 2.
  function G2() {
    var E = modExigido();
    var g = E && Array.isArray(E.GRUPOS) && E.GRUPOS.length === TOTAL2 ? E.GRUPOS : GRUPOS_PARTE2_PADRAO;
    return g;
  }
  function naParte2() { return !!estado && estado.etapa === 'parte2'; }
  // Grupos da Parte 2 que entram na barra (0 sem a Parte 2).
  function passosParte2() { return P2() ? N2 : 0; }
  // Índice em DISC_DATA.grupos do grupo na tela (parte 1 ou 2).
  function indiceDados() { return naParte2() ? G2()[estado.grupo2] : estado.grupo; }
  function perguntaParte2(k) {
    var E = modExigido();
    if (E && Array.isArray(E.PERGUNTAS) && E.PERGUNTAS[k]) return String(E.PERGUNTAS[k]);
    return PERGUNTAS_PARTE2[k] || 'No meu trabalho, preciso ser...';
  }

  // Mensagem de aviso mostrada uma vez na próxima tela (ex.: grupo incompleto no envio).
  var avisoTela = '';
  var avisoAtual = '';
  function avisoHtml() {
    return avisoAtual ? '<div class="aviso aviso--erro alerta" role="alert">' + escapar(avisoAtual) + '</div>' : '';
  }

  /* ---- Tempo por grupo: do desenho do grupo até sair dele (acumula se voltar) ---- */
  function iniciarCronometro() {
    if (crono || telaLink || !estado || estado.etapa !== 'teste') return;
    crono = { estado: estado, grupo: estado.grupo, t0: Date.now() };
  }
  function pararCronometro() {
    var c = crono;
    crono = null;
    if (!c || c.estado !== estado) return;
    estado.gruposSeg = somarTempo(estado.gruposSeg, c.grupo, Date.now() - c.t0);
  }

  function lerStorage(chave) {
    try {
      var v = root.localStorage.getItem(chave);
      return v ? JSON.parse(v) : null;
    } catch (e) { return null; }
  }
  function gravarStorage(chave, valor) {
    try { root.localStorage.setItem(chave, JSON.stringify(valor)); } catch (e) { /* sem armazenamento */ }
  }
  function apagarStorage(chave) {
    try { root.localStorage.removeItem(chave); } catch (e) { /* ignora */ }
  }
  // Conclusão: fica só nesta aba (sessionStorage), para não expor dados ao próximo usuário do aparelho.
  function lerSessao(chave) {
    try {
      var v = root.sessionStorage.getItem(chave);
      return v ? JSON.parse(v) : null;
    } catch (e) { return null; }
  }
  function gravarSessao(chave, valor) {
    try { root.sessionStorage.setItem(chave, JSON.stringify(valor)); } catch (e) { /* sem armazenamento */ }
  }
  function apagarSessao(chave) {
    try { root.sessionStorage.removeItem(chave); } catch (e) { /* ignora */ }
  }

  function salvar() {
    if (estado.etapa === 'boasvindas' && !estado.id) return;
    var copia = {};
    for (var k in estado) if (k !== 'concluido' && Object.prototype.hasOwnProperty.call(estado, k)) copia[k] = estado[k];
    if (crono && crono.estado === estado) copia.gruposSeg = somarTempo(estado.gruposSeg, crono.grupo, Date.now() - crono.t0);
    copia.salvoEm = new Date().toISOString();
    // A foto pode estourar a cota do armazenamento: nesse caso guarda o progresso sem ela e segue.
    try { root.localStorage.setItem(CHAVE_PROGRESSO, JSON.stringify(copia)); }
    catch (e) {
      if (copia.foto) { copia.foto = ''; gravarStorage(CHAVE_PROGRESSO, copia); }
    }
  }

  function progressoValido(p) {
    return !!(p && typeof p === 'object' && (Array.isArray(p.ordens) || Array.isArray(p.selecoes)) &&
      (!p.permutacoes || (Array.isArray(p.permutacoes) && p.permutacoes.length === TOTAL)));
  }

  function temProgresso(p) {
    if (!progressoValido(p)) return false;
    // Progresso de outro link (ou do fluxo geral) não é oferecido aqui.
    if (String(p.avaliacaoCodigo || '') !== (AVAL ? AVAL.codigo : '')) return false;
    var m = migrarProgresso(p);
    return !!(m.nome || m.respondidos.some(Boolean));
  }

  function anunciar(msg) {
    if (!aviso) return;
    aviso.textContent = '';
    setTimeout(function () { aviso.textContent = msg; }, 30);
  }

  function irPara(etapa) {
    pararCronometro();
    estado.etapa = etapa;
    salvar();
    render(true);
  }

  function nomeEmpresa() {
    return T().empresa;
  }

  // Ordem atual das palavras do grupo (a salva ou, se ainda não mexeu, o embaralhamento do candidato).
  function ordemDoGrupo(i) {
    var o = estado.ordens[i];
    if (ordemValida(o)) return o.slice();
    var p = estado.permutacoes && estado.permutacoes[i];
    return ordemValida(p) ? p.slice() : LETRAS.slice();
  }

  function grupoCompleto(i) {
    return !!(estado.respondidos[i] && ordemValida(estado.ordens[i]));
  }

  // Parte 2: ordem atual (a salva ou o embaralhamento) e se o grupo k está respondido.
  function ordemDoGrupo2(k) {
    var o = estado.ordens2[k];
    if (ordemValida(o)) return o.slice();
    var p = estado.permutacoes2 && estado.permutacoes2[k];
    return ordemValida(p) ? p.slice() : LETRAS.slice();
  }
  function grupoCompleto2(k) {
    return !!(estado.respondidos2[k] && ordemValida(estado.ordens2[k]));
  }
  function primeiroIncompleto2() {
    for (var k = 0; k < N2; k++) if (!grupoCompleto2(k)) return k;
    return -1;
  }
  function algumRespondido2() {
    for (var k = 0; k < N2; k++) if (grupoCompleto2(k)) return true;
    return false;
  }
  // Grupo na tela (parte 1 ou 2): completo?
  function grupoAtualCompleto() { return naParte2() ? grupoCompleto2(estado.grupo2) : grupoCompleto(estado.grupo); }

  // Só os grupos que a pessoa responde (no modo demonstração, os N primeiros).
  function gruposRespondidos() {
    var n = 0;
    for (var i = 0; i < N; i++) if (grupoCompleto(i)) n++;
    return n;
  }

  function primeiroIncompleto() {
    for (var i = 0; i < N; i++) if (!grupoCompleto(i)) return i;
    return -1;
  }

  // Modo demonstração: completa ao acaso os grupos que a pessoa não responde (o payload segue com os 25).
  function completarDemonstracao() {
    if (!DEMO) return;
    var c = completarGruposDemonstracao(estado.ordens, estado.respondidos, N);
    estado.ordens = c.ordens;
    estado.respondidos = c.respondidos;
    var marcados = Array.isArray(estado.preenchidosAoAcaso) ? estado.preenchidosAoAcaso : [];
    c.preenchidos.forEach(function (i) { if (marcados.indexOf(i) === -1) marcados.push(i); });
    estado.preenchidosAoAcaso = marcados;
  }

  // Modo demonstração na Parte 2: completa ao acaso os grupos que a pessoa não responde (o exigido segue com os 10).
  function completarDemonstracao2() {
    if (!DEMO || !P2()) return;
    var c = completarGruposDemonstracao(estado.ordens2, estado.respondidos2, N2, null, TOTAL2);
    estado.ordens2 = c.ordens;
    estado.respondidos2 = c.respondidos;
    var marcados = Array.isArray(estado.preenchidosAoAcaso2) ? estado.preenchidosAoAcaso2 : [];
    c.preenchidos.forEach(function (k) { if (marcados.indexOf(k) === -1) marcados.push(k); });
    estado.preenchidosAoAcaso2 = marcados;
  }

  // Parte 2 por fazer: vai para a transição (ou, se já começou, para o primeiro grupo que falta). true se foi.
  function irParaParte2SePreciso(direto) {
    if (!P2()) return false;
    if (!estado.permutacoes2) estado.permutacoes2 = gerarPermutacoes2();
    var falta = primeiroIncompleto2();
    if (falta === -1) return false;
    if (direto && algumRespondido2()) { estado.grupo2 = falta; irPara('parte2'); }
    else irPara('parte2-intro');
    return true;
  }

  // Depois do último grupo: 'confirmacao' (etapa de confirmação a fazer) ou 'enviar' (sem confirmação ou já feita).
  // Não há tela de revisão: terminou, envia.
  function destinoAposGrupos() {
    if (!modValidacao()) return 'enviar';
    var res = resultadoDasOrdens(estado.ordens);
    if (!res) return 'confirmacao';   // ainda falta grupo (ou o modo demonstração ainda vai completar)
    if (precisaMontarValidacao(estado.validacao, res)) return 'confirmacao';
    return validacaoCompleta(estado.validacao) ? 'enviar' : 'confirmacao';
  }

  // Monta (ou remonta, se o resultado mudou) a etapa de confirmação e vai para ela; sem a etapa, envia.
  function irDepoisDosGrupos() {
    if (PESSOAL) { concluirPessoal(); return; }
    completarDemonstracao();
    if (irParaParte2SePreciso(false)) return;
    completarDemonstracao2();
    if (!modValidacao()) { concluir(); return; }
    var res = resultadoDasOrdens(estado.ordens);
    if (!res) { irParaGrupoIncompleto('Encontramos um problema nas respostas. Confira este grupo e continue.'); return; }
    if (precisaMontarValidacao(estado.validacao, res)) {
      estado.validacao = novaValidacao(res);
      estado.confTela = 1;
    } else {
      estado.confTela = telaValidacaoCompleta(estado.validacao, 1) ? 2 : 1;
    }
    irPara('confirmacao');
  }

  // Volta ao primeiro grupo incompleto (ou ao 1º grupo) com uma mensagem.
  function irParaGrupoIncompleto(msg) {
    var inc = primeiroIncompleto();
    estado.grupo = inc === -1 ? 0 : inc;
    avisoTela = msg || '';
    irPara('teste');
  }

  function faixaDemonstracao() {
    if (!DEMO) return '';
    var n = naParte2() ? N2 : N;
    return '<p class="faixa-demo">Modo demonstração: só ' + n + ' grupos; os outros são preenchidos ao acaso. O resultado não vale como avaliação.</p>';
  }

  /* -------------------------- Render ------------------------------- */

  function render(focar) {
    var html;
    pararCronometro();
    avisoAtual = avisoTela;
    avisoTela = '';
    arraste = null;
    fecharDica(false);
    if (checkout) { checkout.parar(); checkout = null; }
    if (telaLink) html = telaDoLink();
    else if (telaP2) html = telaParte2Link();
    else switch (estado.etapa) {
      case 'identificacao': html = PESSOAL ? telaIdentificacaoPessoal() : telaIdentificacao(); break;
      case 'resumo': html = telaResumo(); break;
      case 'checkout': html = '<div class="checkout-raiz" id="checkout-raiz"></div>'; break;
      case 'teste': html = telaGrupo(); break;
      case 'parte2-intro': html = telaParte2Intro(); break;
      case 'parte2': html = telaGrupo(); break;
      case 'confirmacao': html = telaConfirmacao(); break;
      case 'enviando': html = telaEnvio(); break;
      case 'concluido': html = telaConclusao(); break;
      default: html = PESSOAL ? telaBoasVindasPessoal() : telaBoasVindas();
    }
    app.innerHTML = html;
    if (!telaLink && !telaP2 && estado.etapa === 'checkout') montarCheckout();
    // Layout da página depende da tela (boas-vindas é mais larga, como o login do BI).
    try {
      document.body.setAttribute('data-etapa', telaLink ? 'link' : (telaP2 ? 'resumo' : (estado.etapa || 'boasvindas')));
      if (PESSOAL) document.body.setAttribute('data-modo', 'pessoal');
    } catch (e) { /* ignora */ }
    ligarEventos();
    iniciarCronometro();
    if (!telaLink && deveMostrarDemo(estado)) iniciarDemo();
    if (focar) {
      var titulo = app.querySelector('h1');
      if (titulo) {
        titulo.setAttribute('tabindex', '-1');
        try { titulo.focus({ preventScroll: true }); } catch (e) { titulo.focus(); }
      }
      try { root.scrollTo(0, 0); } catch (e) { /* ignora */ }
    }
  }

  function logo(classe) {
    var tam = classe === 'logo--grande' ? 44 : 36;
    return '<img class="logo' + (classe ? ' ' + classe : '') + '" src="assets/icone.svg" alt="" width="' + tam + '" height="' + tam + '">';
  }

  // Passos do processo em mini-cartões numerados (1º azul-escuro, demais brancos), como no login do BI.
  var PASSOS = ['Seus dados', 'Ordene ' + TOTAL + ' grupos de palavras', 'Pronto, cerca de 10 minutos'];

  function telaBoasVindas() {
    var salvo = lerStorage(CHAVE_PROGRESSO);
    var continuar = temProgresso(salvo);
    var t = T();
    var empresa = t.empresa;
    var p2 = P2();
    var passos = PASSOS.map(function (t, k) {
      if (k === 1) t = p2 ? 'Ordene os grupos de palavras, em 2 partes' : 'Ordene ' + N + ' grupos de palavras';
      if (k === 2 && p2) t = 'Pronto, cerca de 15 minutos';
      return '<li class="passo' + (k === 0 ? ' passo--noite' : '') + '"><span class="passo-num" aria-hidden="true">' + (k + 1) + '</span><span class="passo-texto">' + t + '</span></li>';
    }).join('');
    return '' +
      '<section class="boasvindas surgir" aria-labelledby="titulo">' +
        '<div class="boasvindas-laranja moldura-laranja">' +
          logo('logo--grande') +
          '<div class="boasvindas-corpo">' +
            '<p class="boasvindas-sobre">' + escapar(t.contexto) + (empresa ? ' · ' + escapar(empresa) : '') + '</p>' +
            '<h1 id="titulo" class="boasvindas-titulo">Teste de Perfil Comportamental DISC</h1>' +
            '<p class="frase-impacto">Conhecer seu jeito de trabalhar é o primeiro passo.</p>' +
            '<ol class="passos" aria-label="Como funciona">' + passos + '</ol>' +
          '</div>' +
        '</div>' +
        '<div class="boasvindas-noite moldura-noite">' +
          '<p class="boasvindas-destaque">Este teste ajuda a entender como você costuma agir, se comunicar e trabalhar em equipe.</p>' +
          '<ul class="lista-info">' +
            '<li><strong>Leva cerca de ' + (p2 ? 15 : 10) + ' minutos.</strong> Faça com calma, em um lugar tranquilo.</li>' +
            '<li><strong>São ' + N + ' grupos de 4 palavras.</strong> Em cada grupo, arraste as palavras para colocar no topo a que <em>mais</em> combina com você e embaixo a que <em>menos</em> combina.</li>' +
            (p2 ? '<li><strong>Depois, uma segunda parte mais curta.</strong> São ' + N2 + ' grupos, agora pensando no que o seu trabalho exige de você.</li>' : '') +
            '<li><strong>Não entendeu uma palavra?</strong> Toque no i ao lado dela.</li>' +
            '<li><strong>Não há respostas certas ou erradas.</strong> Responda pensando em como você realmente é, e não em como gostaria de ser.</li>' +
            '<li><strong>No fim, uma confirmação rápida.</strong> Você diz o quanto o resultado combina com você.</li>' +
            '<li>Seu progresso fica salvo neste aparelho por até 7 dias caso a página seja fechada, e é apagado ao concluir.</li>' +
          '</ul>' +
          (continuar
            ? '<div class="acoes acoes-coluna">' +
                '<button type="button" class="botao botao--laranja botao--grande" data-acao="continuar">Continuar de onde parei</button>' +
                '<button type="button" class="botao botao--sobre-noite botao--grande" data-acao="recomecar">Começar do zero</button>' +
              '</div>'
            : '<div class="acoes acoes-coluna"><button type="button" class="botao botao--laranja botao--grande" data-acao="comecar">Começar</button></div>') +
          '<p class="acesso-recrutador"><a href="admin.html">Área do recrutador</a></p>' +
        '</div>' +
      '</section>';
  }

  // Marca do rótulo: * (obrigatório) ou "(opcional)".
  function marcaCampo(obrigatorio) {
    return obrigatorio
      ? ' <span class="obrigatorio" aria-hidden="true">*</span>'
      : ' <span class="texto-suave">(opcional)</span>';
  }

  // Um campo configurável do formulário (idade, função, empresa, e-mail, cidade). '' se oculto.
  function campoFormularioHtml(c, modo, t) {
    if (modo === 'oculto') return '';
    var obrig = modo === 'obrigatorio';
    var rotulo = c === 'funcao' ? t.rotuloFuncao : ROTULOS_CAMPOS[c];
    var ajuda = { idade: 'Em anos, só números.', funcao: t.ajudaFuncao, cidade: 'Ex.: Campinas (SP)' }[c] || '';
    var desc = (ajuda ? 'dica-' + c + ' ' : '') + 'erro-' + c;
    var atributos;
    if (c === 'idade') {
      atributos = 'type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" maxlength="3" value="' + escapar(limparIdade(estado.idade)) + '"';
    } else if (c === 'email') {
      atributos = 'type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" maxlength="' + LIMITE_EMAIL + '" value="' + escapar(estado.email) + '"';
    } else {
      var auto = { funcao: 'organization-title', empresa: 'organization', cidade: 'address-level2' }[c];
      atributos = 'type="text" autocomplete="' + auto + '" maxlength="' + LIMITE_TEXTO_CURTO + '" value="' + escapar(estado[c]) + '"';
    }
    return '' +
      '<div class="campo">' +
        '<label class="campo__rotulo" for="' + c + '">' + escapar(rotulo) + marcaCampo(obrig) + '</label>' +
        '<input class="entrada" id="' + c + '" name="' + c + '" ' + atributos + (obrig ? ' required' : '') + ' aria-describedby="' + desc + '">' +
        (ajuda ? '<p class="campo__ajuda" id="dica-' + c + '">' + escapar(ajuda) + '</p>' : '') +
        '<p class="campo__erro erro" id="erro-' + c + '" role="alert"></p>' +
      '</div>';
  }

  // Ícone de pessoa (sem foto) na prévia redonda.
  var ICONE_PESSOA = '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/></svg>';

  // Prévia + botões da foto (redesenhados sem mexer no resto do formulário).
  function fotoControlesHtml() {
    var tem = fotoValida(estado.foto);
    return '' +
      '<span class="foto-previa' + (tem ? ' foto-previa--com' : '') + '">' +
        (tem ? '<img src="' + escapar(estado.foto) + '" alt="Sua foto" width="64" height="64">' : ICONE_PESSOA) +
      '</span>' +
      '<span class="foto-acoes">' +
        (tem
          ? '<label class="botao botao--claro foto-botao" for="foto">Trocar</label>' +
            '<button type="button" class="botao botao--claro foto-botao" data-acao="foto-remover">Remover</button>'
          : '<label class="botao botao--contorno foto-botao" for="foto-camera">Tirar foto</label>' +
            '<label class="botao botao--claro foto-botao" for="foto">Da galeria</label>') +
      '</span>';
  }

  function campoFotoHtml(modo) {
    if (modo === 'oculto') return '';
    var obrig = modo === 'obrigatorio';
    var ajuda = (obrig ? '' : 'Opcional. ') + 'A foto aparece só para quem conduz a avaliação e nos relatórios dela.';
    return '' +
      '<div class="campo campo-foto">' +
        '<p class="campo__rotulo" id="rotulo-foto">' + escapar(ROTULOS_CAMPOS.foto) + marcaCampo(obrig) + '</p>' +
        '<div class="foto-linha" id="foto-controles">' + fotoControlesHtml() + '</div>' +
        '<input class="visualmente-oculto foto-arquivo" id="foto" name="foto" type="file" accept="image/*" aria-labelledby="rotulo-foto" aria-describedby="dica-foto erro-foto"' + (obrig ? ' required' : '') + '>' +
        '<input class="visualmente-oculto foto-arquivo" id="foto-camera" type="file" accept="image/*" capture="user" tabindex="-1" aria-hidden="true">' +
        '<p class="campo__ajuda" id="dica-foto">' + escapar(ajuda) + '</p>' +
        '<p class="campo__erro erro" id="erro-foto" role="alert"></p>' +
      '</div>';
  }

  function atualizarFotoNaTela(msgErro) {
    var caixa = app.querySelector('#foto-controles');
    if (caixa) caixa.innerHTML = fotoControlesHtml();
    var form = app.querySelector('#form-identificacao');
    if (form) mostrarErro(form, 'foto', msgErro || '');
  }

  function aoEscolherFoto(input) {
    var file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    var caixa = app.querySelector('#foto-controles');
    if (caixa) caixa.setAttribute('aria-busy', 'true');
    prepararFoto(file).then(function (dados) {
      estado.foto = dados;
      salvar();
      atualizarFotoNaTela('');
      anunciar('Foto escolhida.');
    }, function (e) {
      atualizarFotoNaTela((e && e.message) || 'Não conseguimos usar esta foto. Tente outra.');
    }).then(function () { if (caixa) caixa.removeAttribute('aria-busy'); });
  }

  // Pergunta extra do processo: texto livre até 500 caracteres, com contador discreto.
  function perguntaExtraHtml(p) {
    var id = 'extra-' + p.id;
    var valor = String((estado.extras && estado.extras[p.id]) || '').slice(0, LIMITE_RESPOSTA);
    return '' +
      '<div class="campo campo--extra">' +
        '<label class="campo__rotulo" for="' + id + '">' + escapar(p.texto) + marcaCampo(p.obrigatoria) + '</label>' +
        '<textarea class="entrada entrada--texto" id="' + id + '" name="' + id + '" data-extra="' + p.id + '" rows="3" maxlength="' + LIMITE_RESPOSTA + '"' +
          (p.obrigatoria ? ' required' : '') + ' aria-describedby="conta-' + id + ' erro-' + id + '">' + escapar(valor) + '</textarea>' +
        '<p class="campo__contador" id="conta-' + id + '" data-contador>' + valor.length + '/' + LIMITE_RESPOSTA + '</p>' +
        '<p class="campo__erro erro" id="erro-' + id + '" role="alert"></p>' +
      '</div>';
  }

  // Lista dos dados pedidos, para o texto do consentimento.
  function dadosConsentimento(f) {
    var itens = ['nome', 'telefone'];
    if (f.campos.idade !== 'oculto') itens.push('idade');
    if (f.campos.email !== 'oculto') itens.push('e-mail');
    if (f.campos.cidade !== 'oculto') itens.push('cidade');
    if (f.campos.foto !== 'oculto') itens.push('foto');
    if (f.campos.funcao !== 'oculto' || f.campos.empresa !== 'oculto') itens.push('experiência');
    itens.push(f.perguntas.length ? 'respostas do teste e das perguntas do processo' : 'respostas');
    return itens.slice(0, -1).join(', ') + ' e ' + itens[itens.length - 1];
  }

  function telaIdentificacao() {
    var t = T();
    var f = FORM();
    var campoVaga = t.mostrarVaga
      ? '<div class="campo">' +
          '<label class="campo__rotulo" for="vaga">Vaga pretendida neste processo <span class="texto-suave">(opcional)</span></label>' +
          '<input class="entrada" id="vaga" name="vaga" type="text" autocomplete="off" maxlength="80" aria-describedby="dica-vaga" value="' + escapar(estado.vaga) + '">' +
          '<p class="campo__ajuda" id="dica-vaga">A vaga a que você está se candidatando.</p>' +
        '</div>'
      : '';
    var campoTelefone = '' +
      '<div class="campo">' +
        '<label class="campo__rotulo" for="telefone">Telefone (WhatsApp) com DDD <span class="obrigatorio" aria-hidden="true">*</span></label>' +
        '<input class="entrada" id="telefone" name="telefone" type="tel" inputmode="numeric" autocomplete="tel-national" required maxlength="25" ' +
          'placeholder="(11) 99999-8888" aria-describedby="dica-telefone erro-telefone" value="' + escapar(formatarTelefone(estado.telefone)) + '">' +
        '<p class="campo__ajuda" id="dica-telefone">Somente números, com DDD.</p>' +
        '<p class="campo__erro erro" id="erro-telefone" role="alert"></p>' +
      '</div>';
    var campoIdade = campoFormularioHtml('idade', f.campos.idade, t);
    // Os demais campos visíveis vão em duplas (lado a lado no computador, empilhados no celular).
    var outros = ['funcao', 'empresa', 'email', 'cidade'].map(function (c) { return campoFormularioHtml(c, f.campos[c], t); }).filter(Boolean);
    var duplas = '';
    for (var k = 0; k < outros.length; k += 2) {
      duplas += outros[k + 1] ? '<div class="campos-dupla">' + outros[k] + outros[k + 1] + '</div>' : outros[k];
    }
    var extras = f.perguntas.map(perguntaExtraHtml).join('');
    var idadeNota = f.campos.idade !== 'oculto' ? '; a idade é usada só para fins cadastrais' : '';
    return '' +
      '<section class="caixa surgir" aria-labelledby="titulo">' +
        '<p class="sobretitulo etapa">Etapa 1 de 3</p>' +
        '<h1 id="titulo" class="titulo-pagina">Sua identificação</h1>' +
        '<p class="subtitulo">' + escapar(t.finalidade) + '</p>' +
        avisoHtml() +
        '<form id="form-identificacao" class="formulario" novalidate>' +
          '<div class="campo">' +
            '<label class="campo__rotulo" for="nome">Nome completo <span class="obrigatorio" aria-hidden="true">*</span></label>' +
            '<input class="entrada entrada--principal" id="nome" name="nome" type="text" autocomplete="name" autocapitalize="words" required maxlength="120" ' +
              'aria-describedby="erro-nome" value="' + escapar(estado.nome) + '">' +
            '<p class="campo__erro erro" id="erro-nome" role="alert"></p>' +
          '</div>' +
          (campoIdade ? '<div class="campos-dupla campos-dupla--telefone">' + campoTelefone + campoIdade + '</div>' : campoTelefone) +
          campoVaga +
          duplas +
          campoFotoHtml(f.campos.foto) +
          extras +
          '<div class="campo consentimento">' +
            '<label class="marcar" for="consentimento">' +
              '<input id="consentimento" name="consentimento" type="checkbox" required aria-describedby="erro-consentimento"' + (estado.consentimento ? ' checked' : '') + '>' +
              '<span>Autorizo o uso dos meus dados (' + escapar(dadosConsentimento(f)) + ') <strong>' + escapar(t.escopo) + '</strong>' +
                idadeNota + '. Sei que eles serão <strong>' + escapar(t.fimDados) + '</strong>, conforme a LGPD.</span>' +
            '</label>' +
            '<p class="campo__erro erro" id="erro-consentimento" role="alert"></p>' +
          '</div>' +
          '<div class="acoes">' +
            '<button type="button" class="botao botao--claro botao--grande" data-acao="voltar-inicio">Voltar</button>' +
            '<button type="submit" class="botao botao--principal botao--grande">' + (estado.reenviar ? 'Salvar e enviar' : 'Iniciar teste') + '</button>' +
          '</div>' +
        '</form>' +
      '</section>';
  }

  function textoRotulo(n) { return ROTULOS[n] || ''; }

  // Barra de progresso no padrão BarraMeta do BI: feito em azul-escuro, trilho liso, bolinha de vidro.
  // A barra conta os N grupos + as 2 telas da confirmação.
  // Com a Parte 2, a barra conta também os grupos dela (as duas partes juntas).
  var TELAS_CONFIRMACAO = 2;
  function passosTotais() {
    if (P2_TOKEN) return N2;
    return N + passosParte2() + (SEM_VALIDACAO ? 0 : TELAS_CONFIRMACAO);
  }

  // Passos feitos no grupo da tela (parte 1: i; parte 2: N + k).
  function feitosGrupo(completo) {
    if (P2_TOKEN) return estado.grupo2 + (completo ? 1 : 0);
    return naParte2() ? N + estado.grupo2 + (completo ? 1 : 0) : estado.grupo + (completo ? 1 : 0);
  }

  function progressoHtml(i, completo) {
    if (naParte2()) return barraProgressoHtml('Parte 2 · Grupo', estado.grupo2 + 1, N2, feitosGrupo(completo));
    return barraProgressoHtml(P2() ? 'Parte 1 · Grupo' : 'Grupo', i + 1, N, i + (completo ? 1 : 0));
  }

  function barraProgressoHtml(nome, atual, de, feitos) {
    var total = passosTotais();
    var pct = Math.round((feitos / total) * 100);
    var visivel = Math.max(pct, 8);
    return '' +
      '<div class="progresso">' +
        '<div class="progresso-topo">' +
          '<span class="progresso-texto">' + nome + ' <strong class="progresso-num">' + atual + '</strong> de ' + de + '</span>' +
          '<span class="progresso-pct texto-suave">' + pct + '%</span>' +
        '</div>' +
        '<div class="progresso-barra" role="progressbar" aria-label="Progresso do teste" aria-valuemin="0" aria-valuemax="' + total + '" aria-valuenow="' + feitos + '" aria-valuetext="' + nome + ' ' + atual + ' de ' + de + '">' +
          '<span class="progresso-trilho trilho"></span>' +
          '<span class="progresso-feito" style="width:' + visivel + '%"></span>' +
          '<span class="progresso-ponto vidro-claro" style="left:clamp(22px, ' + (visivel - 0.5) + '%, calc(100% - 22px))"></span>' +
        '</div>' +
      '</div>';
  }

  var ICONE_ALCA = '<svg viewBox="0 0 12 20" width="12" height="20" aria-hidden="true" focusable="false">' +
    '<circle cx="3" cy="4" r="1.6"/><circle cx="9" cy="4" r="1.6"/><circle cx="3" cy="10" r="1.6"/>' +
    '<circle cx="9" cy="10" r="1.6"/><circle cx="3" cy="16" r="1.6"/><circle cx="9" cy="16" r="1.6"/></svg>';
  // Seta da régua (aponta para o "MAIS").
  var ICONE_SETA_CIMA = '<svg viewBox="0 0 16 12" width="16" height="12" aria-hidden="true" focusable="false"><path d="M8 1.5l6 8.5H2z"/></svg>';
  // Mão (dedo) da demonstração: contorno azul-escuro, preenchimento branco (cores pelo CSS).
  var ICONE_MAO = '<svg viewBox="0 0 34 40" width="34" height="40" aria-hidden="true" focusable="false">' +
    '<path class="mao-corpo" d="M10 6a3 3 0 0 1 6 0V17a2.6 2.6 0 0 1 5.2 0V19a2.6 2.6 0 0 1 5.2 0V21a2.4 2.4 0 0 1 4.8 0V28c0 6-4 10-10 10h-3c-3.5 0-5.5-1.2-7.5-3.5L2.6 27.6a2.4 2.4 0 0 1 3.6-3.2L10 28Z"/>' +
    '<path class="mao-dobra" d="M16 17v4M21.2 19v3M26.4 21v2.5"/></svg>';
  // Ícone "i" (círculo + i), no padrão do componente Info do BI.
  var ICONE_INFO = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>';

  function botaoInfo(rotulo, atributos) {
    return '<button type="button" class="info" data-sem-arraste aria-expanded="false" aria-haspopup="dialog" aria-controls="dica-janela" ' +
      'aria-label="' + escapar(rotulo) + '" title="' + escapar(rotulo) + '" ' + atributos + '>' + ICONE_INFO + '</button>';
  }


  function descricaoPosicao(k) {
    var nota = 4 - k;
    return 'posição ' + (k + 1) + ' de 4' + (nota === 4 || nota === 1 ? ', ' + textoRotulo(nota).toLowerCase() : '');
  }

  function temDicaPalavra(i, letra) {
    try { return !!(DICAS && DICAS.dicaPalavra(i, letra)); } catch (e) { return false; }
  }
  function temDicaPergunta(i) {
    try { return !!(DICAS && DICAS.dicaPergunta(i)); } catch (e) { return false; }
  }

  function cartaoHtml(i, g, letra, k) {
    var texto = escapar(palavraDoGrupo(i, g, letra));
    return '' +
      '<li class="cartao" data-letra="' + letra + '" tabindex="0" style="--pos:' + k + '" aria-describedby="ajuda-teclado">' +
        '<span class="cartao-alca" aria-hidden="true">' + ICONE_ALCA + '</span>' +
        '<span class="cartao-texto">' + texto + '<span class="visualmente-oculto cartao-pos">, ' + descricaoPosicao(k) + '</span></span>' +
        (temDicaPalavra(i, letra) ? botaoInfo('O que significa ' + palavraDoGrupo(i, g, letra) + '?', 'data-dica="palavra" data-letra="' + letra + '"') : '') +
      '</li>';
  }

  function confirmarHtml(completo) {
    return completo
      ? '<p class="confirmado"><span class="confirmado-icone" aria-hidden="true">✓</span> Ordem registrada</p>'
      : '<button type="button" class="botao botao--contorno" data-acao="confirmar-ordem">Esta ordem está certa</button>';
  }

  function dicaHtml(completo) {
    return completo ? 'Tudo certo. Toque em Avançar quando quiser.' : 'Arraste as palavras para ordenar';
  }

  function telaGrupo() {
    var p2 = naParte2();
    var i = indiceDados();
    var g = DATA.grupos[i];
    var ordem = p2 ? ordemDoGrupo2(estado.grupo2) : ordemDoGrupo(i);
    var completo = grupoAtualCompleto();
    var ultimo = p2 ? estado.grupo2 === N2 - 1 : i === N - 1;
    var pergunta = p2 ? perguntaParte2(estado.grupo2) : perguntaDoGrupo(i, g);
    var regua = p2 ? 'o trabalho pede' : 'me identifica';
    // Régua à esquerda: números 4..1 pequenos, alinhados ao centro de cada cartão.
    var posicoes = [4, 3, 2, 1].map(function (n, k) {
      return '<li class="posicao' + (n === 4 ? ' posicao--topo' : '') + '" style="--pos:' + k + '">' + n + '</li>';
    }).join('');
    var cartoes = ordem.map(function (l, k) { return cartaoHtml(i, g, l, k); }).join('');
    return '' +
      '<section class="caixa tela-grupo' + (p2 ? ' tela-grupo--parte2' : '') + '" aria-labelledby="titulo" data-parte="' + (p2 ? 2 : 1) + '">' +
        faixaDemonstracao() +
        progressoHtml(estado.grupo, completo) +
        avisoHtml() +
        (p2 ? '<p class="selo-parte2">Pense no seu trabalho, não em você</p>' : '') +
        '<h1 id="titulo" class="titulo-grupo">' + escapar(pergunta) +
          (!p2 && temDicaPergunta(i) ? '\u00a0' + botaoInfo('Entender a pergunta', 'data-dica="pergunta"') : '') +
        '</h1>' +
        // A régua (MAIS / MENOS me identifica) faz o papel da instrução na tela; o texto fica para o leitor de tela.
        '<p class="visualmente-oculto" id="instrucao">' + (p2
          ? 'No topo, o que o seu trabalho mais exige de você; embaixo, o que ele menos exige.'
          : 'No topo, a palavra que mais combina com você; embaixo, a que menos combina.') + '</p>' +
        '<p class="visualmente-oculto" id="ajuda-teclado">Arraste a palavra ou use as setas para cima e para baixo do teclado para mudar a posição.</p>' +
        '<div class="ordenar">' +
          '<div class="regua" aria-hidden="true">' +
            '<span class="regua-seta">' + ICONE_SETA_CIMA + '</span>' +
            '<ol class="posicoes">' + posicoes + '</ol>' +
          '</div>' +
          '<div class="regua-topo">' +
            '<p class="regua-texto regua-texto--mais" aria-hidden="true"><span class="regua-forte">MAIS</span> ' + regua + '</p>' +
            '<button type="button" class="ver-demo" data-acao="ver-demo">Ver como funciona</button>' +
          '</div>' +
          '<div class="lista-ordenar">' +
            '<ol class="cartoes" aria-label="' + (p2 ? 'Palavras, da que o trabalho mais à que menos exige' : 'Palavras, da que mais à que menos combina com você') + '" aria-describedby="instrucao">' + cartoes + '</ol>' +
          '</div>' +
          '<p class="regua-texto regua-texto--menos" aria-hidden="true"><span class="regua-forte">MENOS</span> ' + regua + '</p>' +
        '</div>' +
        '<div class="confirmar" id="confirmar">' + confirmarHtml(completo) + '</div>' +
        '<div class="barra-nav">' +
          '<p class="barra-dica" id="dica-avancar">' + dicaHtml(completo) + '</p>' +
          '<div class="barra-botoes">' +
            '<button type="button" class="botao botao--claro botao--grande" data-acao="anterior">Voltar</button>' +
            '<button type="button" class="botao botao--principal botao--grande" data-acao="proximo" aria-describedby="dica-avancar"' + (completo ? '' : ' disabled') + '>' +
              rotuloProximo(ultimo) +
            '</button>' +
          '</div>' +
        '</div>' +
      '</section>';
  }

  // Sem revisão: depois do último grupo vem a confirmação ("Avançar"); sem a etapa de confirmação, já envia.
  // Com a Parte 2, o último grupo da parte 1 leva à transição ("Avançar").
  function rotuloProximo(ultimo) {
    if (PESSOAL && ultimo) return naParte2() ? 'Ver meu relatório' : 'Ver meu resultado';
    if (ultimo && P2() && !naParte2()) return 'Avançar';
    return ultimo && !modValidacao() ? 'Enviar e finalizar' : 'Avançar';
  }

  /* -------------------- Parte 2: transição -------------------- */

  function telaParte2Intro() {
    var comecou = algumRespondido2();
    return '' +
      '<section class="caixa tela-grupo tela-parte2" aria-labelledby="titulo">' +
        faixaDemonstracao() +
        barraProgressoHtml('Parte', 2, 2, P2_TOKEN ? 0 : N) +
        '<div class="parte2-corpo surgir">' +
          '<p class="sobretitulo">' + (P2_TOKEN ? 'Completo + Parte 2' : 'Primeira parte concluída') + '</p>' +
          '<h1 id="titulo" class="titulo-grupo">Agora pense no seu trabalho</h1>' +
          '<p class="parte2-destaque">Como o seu trabalho exige que você seja? Não é como você gostaria de ser.</p>' +
          '<ul class="parte2-lista">' +
            '<li><strong>São ' + N2 + ' grupos de 4 palavras</strong>, com a mesma mecânica de arrastar.</li>' +
            '<li>No topo, o que o dia a dia do seu trabalho <em>mais</em> pede de você; embaixo, o que ele <em>menos</em> pede.</li>' +
            '<li>Se não estiver trabalhando agora, pense no seu último trabalho.</li>' +
          '</ul>' +
        '</div>' +
        '<div class="barra-nav">' +
          '<p class="barra-dica" id="dica-avancar">Leva uns 3 minutos.</p>' +
          '<div class="barra-botoes">' +
            (P2_TOKEN
              ? '<a class="botao botao--claro botao--grande" href="' + escapar(linkMeuRelatorio(P2_TOKEN)) + '">Agora não</a>'
              : '<button type="button" class="botao botao--claro botao--grande" data-acao="parte2-voltar">Voltar</button>') +
            '<button type="button" class="botao botao--principal botao--grande" data-acao="parte2-comecar" aria-describedby="dica-avancar">' +
              (comecou ? 'Continuar' : 'Começar') +
            '</button>' +
          '</div>' +
        '</div>' +
      '</section>';
  }

  /* -------------------- Confirmação (depois dos grupos) -------------------- */

  var ICONE_MARCA = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

  function textoRetrato(letra) {
    var V = modValidacao();
    return V && V.retratos ? V.retratos[letra] || '' : '';
  }

  function dicaConfirmacao(tela, completo) {
    if (completo) return tela === 1 ? 'Tudo certo. Toque em Avançar quando quiser.' : 'Tudo certo. Toque em Enviar e finalizar.';
    return tela === 1 ? 'Escolha um jeito em cada rodada' : 'Marque uma opção em cada frase';
  }

  function telaConfirmacao() {
    var v = estado.validacao;
    if (!v || !v.montagem) {
      var res = resultadoDasOrdens(estado.ordens);
      if (!res || !modValidacao()) {
        // Não dá para montar a etapa (grupo faltando): volta aos grupos, sem tela de revisão.
        var inc = primeiroIncompleto();
        estado.etapa = 'teste';
        estado.grupo = inc === -1 ? N - 1 : inc;
        if (inc !== -1) avisoAtual = 'Falta ordenar este grupo para concluir.';
        return telaGrupo();
      }
      v = estado.validacao = novaValidacao(res);
      estado.confTela = 1;
      salvar();
    }
    var tela = estado.confTela === 2 ? 2 : 1;
    var completo = telaValidacaoCompleta(v, tela);
    var corpo, titulo;
    if (tela === 1) {
      titulo = 'Qual destes jeitos parece mais com você?';
      corpo = v.montagem.pares.map(function (par, r) {
        var cartoes = par.map(function (letra) {
          var marcado = v.escolhas[r] === letra;
          return '' +
            '<button type="button" class="retrato" data-acao="escolher-retrato" data-rodada="' + r + '" data-letra="' + letra + '" aria-pressed="' + marcado + '">' +
              '<span class="escolha-marca" aria-hidden="true">' + ICONE_MARCA + '</span>' +
              '<span class="retrato-texto">' + escapar(textoRetrato(letra)) + '</span>' +
            '</button>';
        }).join('');
        return '' +
          '<div class="rodada" role="group" aria-labelledby="rodada-' + r + '">' +
            '<p class="rodada-titulo" id="rodada-' + r + '">Rodada ' + (r + 1) + ' de 3</p>' +
            '<div class="retratos">' + cartoes + '</div>' +
          '</div>';
      }).join('');
    } else {
      titulo = 'Quanto cada frase combina com você?';
      var ESCALA = modValidacao().ESCALA;
      corpo = '<ol class="frases">' + v.montagem.itens.map(function (it, k) {
        var opcoes = ESCALA.map(function (rot, n) {
          var nota = n + 1;
          var marcado = v.notas[it.id] === nota;
          return '<button type="button" class="escala-opcao" data-acao="marcar-nota" data-item="' + k + '" data-nota="' + nota + '" aria-pressed="' + marcado + '" aria-label="' + nota + ': ' + escapar(rot) + '">' +
            '<span class="escala-num" aria-hidden="true">' + nota + '</span><span class="escala-rotulo" aria-hidden="true">' + escapar(rot) + '</span></button>';
        }).join('');
        return '' +
          '<li class="frase" role="group" aria-labelledby="frase-' + k + '">' +
            '<p class="frase-texto" id="frase-' + k + '">' + escapar(it.texto) + '</p>' +
            '<p class="escala-legenda" aria-hidden="true"><span>1 · ' + escapar(ESCALA[0]) + '</span><span>5 · ' + escapar(ESCALA[4]) + '</span></p>' +
            '<div class="escala">' + opcoes + '</div>' +
          '</li>';
      }).join('') + '</ol>';
    }
    var feitos = N + passosParte2() + (tela - 1) + (completo ? 1 : 0);
    return '' +
      '<section class="caixa tela-confirmacao" aria-labelledby="titulo">' +
        faixaDemonstracao() +
        barraProgressoHtml('Confirmação', tela, TELAS_CONFIRMACAO, feitos) +
        '<h1 id="titulo" class="titulo-grupo">' + titulo + '</h1>' +
        '<p class="instrucao">Para confirmar seu resultado, responda com sinceridade. <strong>Não existe resposta certa.</strong></p>' +
        corpo +
        '<div class="barra-nav">' +
          '<p class="barra-dica" id="dica-avancar">' + dicaConfirmacao(tela, completo) + '</p>' +
          // Tela 1: sem "Voltar" aos grupos (não há revisão); o espaço fica reservado para o botão não mudar de lugar.
          // Tela 2: "Enviar e finalizar" envia direto.
          '<div class="barra-botoes">' +
            (tela === 1
              ? '<span class="barra-vazio" aria-hidden="true"></span>'
              : '<button type="button" class="botao botao--claro botao--grande" data-acao="conf-anterior">Voltar</button>') +
            '<button type="button" class="botao botao--principal botao--grande" data-acao="' + (tela === 1 ? 'conf-proximo' : 'enviar') + '" data-avancar aria-describedby="dica-avancar"' + (completo ? '' : ' disabled') + '>' +
              (tela === 1 ? 'Avançar' : 'Enviar e finalizar') +
            '</button>' +
          '</div>' +
        '</div>' +
      '</section>';
  }

  // Marca a escolha sem redesenhar a tela (nada pula de lugar).
  function atualizarConfirmacao() {
    var v = estado.validacao;
    var tela = estado.confTela === 2 ? 2 : 1;
    var completo = telaValidacaoCompleta(v, tela);
    if (tela === 1) {
      Array.prototype.forEach.call(app.querySelectorAll('.retrato'), function (b) {
        var r = Number(b.getAttribute('data-rodada'));
        b.setAttribute('aria-pressed', String(v.escolhas[r] === b.getAttribute('data-letra')));
      });
    } else {
      Array.prototype.forEach.call(app.querySelectorAll('.escala-opcao'), function (b) {
        var it = v.montagem.itens[Number(b.getAttribute('data-item'))];
        b.setAttribute('aria-pressed', String(!!it && v.notas[it.id] === Number(b.getAttribute('data-nota'))));
      });
    }
    var prox = app.querySelector('[data-avancar]');
    if (prox) prox.disabled = !completo;
    var dica = app.querySelector('#dica-avancar');
    if (dica) dica.textContent = dicaConfirmacao(tela, completo);
    atualizarBarra(N + passosParte2() + (tela - 1) + (completo ? 1 : 0));
  }

  function telaEnvio() {
    if (PESSOAL) return telaEnvioPessoal();
    if (envio.carregando || !envio.erro) {
      return '' +
        '<section class="caixa centro surgir" aria-labelledby="titulo" aria-busy="true">' +
          '<div class="giro giro--grande" aria-hidden="true"></div>' +
          '<h1 id="titulo" class="titulo-pagina">Enviando suas respostas…</h1>' +
          '<p class="subtitulo">Isso leva só alguns segundos. Não feche esta página.</p>' +
        '</section>';
    }
    return '' +
      '<section class="caixa surgir" aria-labelledby="titulo">' +
        '<h1 id="titulo" class="titulo-pagina">Não foi possível enviar</h1>' +
        '<div class="aviso aviso--erro alerta" role="alert">' + escapar(envio.erro) + '</div>' +
        '<p class="subtitulo">Suas respostas continuam salvas neste aparelho. Você pode tentar de novo ou gerar um código de segurança para enviar ' + escapar(T().aoResponsavel) + '.</p>' +
        '<div class="acoes acoes-coluna">' +
          '<button type="button" class="botao botao--principal botao--grande" data-acao="retentar">Tentar novamente</button>' +
          '<button type="button" class="botao botao--claro botao--grande" data-acao="usar-codigo">Gerar código de segurança</button>' +
        '</div>' +
      '</section>';
  }

  // Dados do relatório da pessoa: só percentuais + código do perfil (é o que fica na sessionStorage).
  // Com a Parte 2, também o perfil exigido já calculado: exigido = { percentuais, codigo } (nunca as respostas).
  function relatorioDoPayload(payload) {
    var R = root.DISC_RELATORIO_PESSOA;
    if (!R || !payload) return null;
    var res;
    try { res = root.DISC_SCORING.calcular(root.DISC_SCORING.descompactar(payload.respostas)); } catch (e) { return null; }
    var rel = R.dadosDoResultado(res.percentuais, res.codigo);
    var ex = exigidoDoPayload(payload);
    if (rel && ex) rel.exigido = ex;
    return rel;
  }

  // Perfil exigido ({ percentuais, codigo }) a partir do `exigido` de 40 dígitos, ou null.
  function exigidoDoPayload(payload) {
    var E = modExigido();
    var str = payload && payload.exigido;
    if (!E || !str) return null;
    try {
      if (E.validar && !E.validar(str)) return null;
      var r = E.calcular(str);
      if (!r || !r.percentuais) return null;
      var p = {};
      for (var k = 0; k < LETRAS.length; k++) {
        var v = Number(r.percentuais[LETRAS[k]]);
        if (!isFinite(v)) return null;
        p[LETRAS[k]] = Math.round(v * 10) / 10;
      }
      return { percentuais: p, codigo: String(r.codigo || '') };
    } catch (e) { return null; }
  }

  // A pessoa vê o próprio resultado? Com link, vale a configuração da avaliação; sem link, a do CONFIG.
  function mostraResultado() {
    return AVAL ? AVAL.mostrarResultado === true : CONFIG.MOSTRAR_RESULTADO_AO_CANDIDATO === true;
  }

  // Relatório DISC da pessoa na conclusão (desenvolvimento pessoal). Nunca o Guia para a Liderança, a confiabilidade,
  // vaga, função, aderência ou empresa.
  function blocoResultado(payload, dados, primeiroNome) {
    var R = root.DISC_RELATORIO_PESSOA;
    if (!R || !mostraResultado()) return '';
    var rel = (dados && dados.relatorio) || relatorioDoPayload(payload);
    if (!rel) return '';
    var base = { percentuais: rel.percentuais, codigo: rel.codigo };
    var d;
    try {
      d = rel.exigido && rel.exigido.percentuais
        ? R.montar(base, primeiroNome, DATA, { exigido: rel.exigido })
        : R.montar(base, primeiroNome, DATA);
    } catch (e) { d = null; }
    var foto = (payload && payload.foto) || (dados && dados.foto) || '';
    return d ? relatorioPessoaHtml(d, foto) : '';
  }

  function numeroWhatsApp() {
    return String(CONFIG.WHATSAPP_RECRUTADOR || '').replace(/\D/g, '');
  }

  // Plano B (sem envio): mensagem com o código de segurança longo.
  function linkWhatsApp(codigo, payload) {
    var num = numeroWhatsApp();
    if (!num) return '';
    var texto = 'Olá! Concluí o teste DISC.\nNome: ' + payload.nome + '\nTelefone: ' + formatarTelefone(payload.telefone) +
      (payload.vaga ? '\nVaga: ' + payload.vaga : '') + '\n\nCódigo de segurança:\n' + codigo;
    return 'https://wa.me/' + num + '?text=' + encodeURIComponent(texto);
  }

  // Envio confirmado: mensagem curta com o protocolo.
  function linkWhatsAppProtocolo(nome, protocolo) {
    var num = numeroWhatsApp();
    if (!num) return '';
    var texto = 'Olá! Concluí o Teste DISC. Nome: ' + nome + '. Código: ' + protocolo + '.';
    return 'https://wa.me/' + num + '?text=' + encodeURIComponent(texto);
  }

  // Protocolo grande e em negrito; o espaço fino entre os dígitos e a letra é só visual (o texto continua "47K").
  function protocoloHtml(p) {
    return '<span class="protocolo-digitos">' + escapar(p.slice(0, 2)) + '</span><span class="protocolo-letra">' + escapar(p.slice(2)) + '</span>';
  }

  function telaConclusao() {
    var dados = estado.concluido || lerSessao(CHAVE_CONCLUIDO);
    if (!dados || (!dados.payload && !dados.enviado)) { estado = estadoInicial(); return telaBoasVindas(); }
    var payload = dados.payload || null;
    var enviado = !!dados.enviado;
    var protocolo = enviado ? normalizarProtocolo(dados.protocolo) : '';
    var primeiroNome = payload ? normalizarNome(payload.nome).split(' ')[0] : String(dados.primeiroNome || '');
    var titulo = primeiroNome ? 'Obrigado, ' + escapar(primeiroNome) + '!' : 'Obrigado!';
    var t = T();
    var resultado = blocoResultado(payload, dados, primeiroNome);
    var rodape = '' +
      '<div class="rodape">' +
        '<p class="rodape-nota">' + escapar(t.usoDados) + '</p>' +
        '<button type="button" class="botao botao--link" data-acao="novo-teste">Iniciar um novo teste neste aparelho</button>' +
      '</div>';
    // O único card "vidro" da tela.
    function agradecimento(texto, extra) {
      return '' +
        '<section class="caixa caixa--vidro agradecimento surgir" aria-labelledby="titulo">' +
          '<div class="icone-ok" aria-hidden="true">✓</div>' +
          '<h1 id="titulo" class="titulo-pagina">' + titulo + '</h1>' +
          '<p class="destaque">' + texto + '</p>' +
          (extra || '') +
        '</section>';
    }

    if (enviado && protocolo) {
      var nomeWa = payload ? normalizarNome(payload.nome) : primeiroNome;
      var waP = linkWhatsAppProtocolo(nomeWa, protocolo);
      var blocoProtocolo = '' +
        '<div class="protocolo-bloco">' +
          '<p class="protocolo-rotulo" id="rotulo-protocolo">Seu código</p>' +
          '<p class="protocolo t-numero-grande" id="protocolo" aria-describedby="rotulo-protocolo" data-protocolo="' + escapar(protocolo) + '">' + protocoloHtml(protocolo) + '</p>' +
          '<p class="protocolo-dica">' + escapar(t.guardarCodigo) + '</p>' +
          '<div class="acoes acoes-coluna protocolo-acoes">' +
            (waP ? '<a class="botao botao--laranja botao--grande btn-whatsapp" href="' + escapar(waP) + '" target="_blank" rel="noopener noreferrer">Enviar pelo WhatsApp</a>' : '') +
            '<button type="button" class="botao botao--claro botao--grande" data-acao="copiar-protocolo">Copiar código</button>' +
          '</div>' +
          '<p class="sucesso" id="copiado" role="status" aria-live="polite"></p>' +
        '</div>';
      return '' +
        '<div class="pilha-telas">' +
          agradecimento(escapar(t.enviado), blocoProtocolo) +
          resultado +
          rodape +
        '</div>';
    }

    if (enviado) {
      // Enviado com sucesso (servidor antigo, sem protocolo): nenhum dado pessoal fica guardado nem é exibido.
      return '' +
        '<div class="pilha-telas">' +
          agradecimento(escapar(t.enviado)) +
          resultado +
          rodape +
        '</div>';
    }

    // Plano B: sem servidor ou envio falhou → código de segurança longo.
    // O código de segurança vai sem a foto (ficaria longo demais para o WhatsApp).
    var paraCodigo = {};
    for (var k in payload) if (Object.prototype.hasOwnProperty.call(payload, k) && k !== 'foto') paraCodigo[k] = payload[k];
    var codigo = root.DISC_CODEC.encode(paraCodigo);
    var wa = linkWhatsApp(codigo, payload);
    return '' +
      '<div class="pilha-telas">' +
        agradecimento('Você concluiu o teste. Falta só um passo: enviar o código abaixo ' + escapar(t.aoResponsavel) + '.') +
        resultado +
        '<section class="caixa codigo-bloco surgir" aria-label="Código de segurança">' +
          '<label class="caixa__titulo" for="codigo">Código de segurança</label>' +
          '<p class="codigo-texto" id="texto-codigo">Não conseguimos enviar suas respostas. Envie este código ' + escapar(t.aoResponsavel) + ' pelo WhatsApp.</p>' +
          '<p class="campo__ajuda dica" id="dica-codigo">' +
            'Copie o código' + (wa ? ' ou use o botão do WhatsApp' : '') + '.' +
            ' Por segurança, ele deixa de aparecer quando esta aba for fechada.</p>' +
          '<textarea id="codigo" class="entrada codigo" readonly rows="4" aria-describedby="texto-codigo dica-codigo" spellcheck="false">' + escapar(codigo) + '</textarea>' +
          '<div class="acoes acoes-coluna">' +
            (wa ? '<a class="botao botao--laranja botao--grande btn-whatsapp" href="' + escapar(wa) + '" target="_blank" rel="noopener noreferrer">Enviar pelo WhatsApp</a>' : '') +
            '<button type="button" class="botao ' + (wa ? 'botao--claro' : 'botao--principal') + ' botao--grande" data-acao="copiar">Copiar código</button>' +
          '</div>' +
          '<p class="sucesso" id="copiado" role="status" aria-live="polite"></p>' +
        '</section>' +
        rodape +
      '</div>';
  }

  // Link de avaliação: abrindo, inválido/encerrado ou sem conexão.
  function telaDoLink() {
    if (telaLink === 'carregando') {
      return '' +
        '<section class="caixa centro" aria-labelledby="titulo" aria-busy="true">' +
          '<div class="giro giro--grande" aria-hidden="true"></div>' +
          '<h1 id="titulo" class="subtitulo">Abrindo a avaliação…</h1>' +
        '</section>';
    }
    if (telaLink === 'invalido') {
      return '' +
        '<section class="caixa surgir link-invalido" aria-labelledby="titulo">' +
          '<h1 id="titulo" class="titulo-pagina">Link inválido ou avaliação encerrada</h1>' +
          '<p class="subtitulo">Fale com quem enviou o link.</p>' +
        '</section>';
    }
    return '' +
      '<section class="caixa surgir" aria-labelledby="titulo">' +
        '<h1 id="titulo" class="titulo-pagina">Não foi possível abrir a avaliação</h1>' +
        '<div class="aviso aviso--erro alerta" role="alert">' + escapar(erroLink || 'Verifique sua conexão com a internet e tente novamente.') + '</div>' +
        '<div class="acoes"><button type="button" class="botao botao--principal botao--grande" data-acao="link-retentar">Tentar de novo</button></div>' +
      '</section>';
  }

  // Busca a avaliação do link no servidor e personaliza as telas.
  function carregarAvaliacao() {
    telaLink = 'carregando';
    render(false);
    root.DISC_API.avaliacaoPublica(CODIGO_LINK).then(function (resp) {
      var av = resp && resp.avaliacao;
      if (!av || !av.codigo) { telaLink = 'invalido'; render(true); return; }
      AVAL = {
        codigo: String(av.codigo),
        nome: String(av.nome || ''),
        tipo: av.tipo === 'equipe' ? 'equipe' : 'selecao',
        empresaNome: String(av.empresaNome || ''),
        mostrarResultado: av.mostrarResultado === true,
        formulario: normalizarFormulario(av.formulario)   // ausente = padrão (comportamento de antes)
      };
      telaLink = '';
      if (estado.etapa === 'boasvindas') estado.avaliacaoCodigo = AVAL.codigo;
      aplicarMarca();
      render(false);
    }, function (erro) {
      // Servidor respondeu "não" (código inexistente ou desativado) => link inválido; senão, falha de conexão.
      if (erro && erro.resposta) { telaLink = 'invalido'; }
      else { telaLink = 'erro'; erroLink = (erro && erro.message) || ''; }
      render(true);
    });
  }

  // Nome da empresa no cabeçalho e no título da aba.
  function aplicarMarca() {
    if (PESSOAL) {
      var nomeTopo = document.getElementById('marca');
      if (nomeTopo) nomeTopo.textContent = EMPRESA_B2C;
      var seloP = document.getElementById('topo-empresa');
      if (seloP) { seloP.textContent = 'Mapa de Perfil'; seloP.hidden = false; }
      document.title = 'Seu Mapa de Perfil · ' + EMPRESA_B2C;
      return;
    }
    var empresa = nomeEmpresa();
    var selo = document.getElementById('topo-empresa');
    if (selo) { selo.textContent = empresa; selo.hidden = !empresa; }
    document.title = empresa ? 'Teste DISC · ' + empresa : 'Teste DISC';
  }

  /* -------------------------- Eventos ------------------------------ */

  function ligarEventos() {
    var form = app.querySelector('#form-identificacao');
    if (form) {
      var tel = form.querySelector('#telefone');
      tel.addEventListener('input', function () {
        var antes = tel.value;
        var fmt = formatarTelefone(antes);
        if (fmt !== antes) {
          tel.value = fmt;
          try { tel.setSelectionRange(fmt.length, fmt.length); } catch (e) { /* ignora */ }
        }
      });
      var idade = form.querySelector('#idade');
      if (idade) {
        idade.addEventListener('input', function () {
          var limpo = limparIdade(idade.value);
          if (limpo !== idade.value) idade.value = limpo;
        });
      }
      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        enviarIdentificacao(form);
      });
      ['nome', 'telefone', 'idade', 'funcao', 'empresa', 'email', 'cidade', 'vaga'].forEach(function (campo) {
        var el = form.querySelector('#' + campo);
        if (!el) return;   // campo oculto pelo formulário do processo (ou vaga/empresa na avaliação de equipe)
        el.addEventListener('change', function () {
          estado[campo] = campo === 'telefone' ? limparTelefone(this.value) : campo === 'idade' ? limparIdade(this.value) : this.value;
          salvar();
        });
      });
      Array.prototype.forEach.call(form.querySelectorAll('.foto-arquivo'), function (inp) {
        inp.addEventListener('change', function () { aoEscolherFoto(inp); });
      });
      // Perguntas extras: contador discreto e progresso salvo.
      Array.prototype.forEach.call(form.querySelectorAll('textarea[data-extra]'), function (ta) {
        var id = ta.getAttribute('data-extra');
        var conta = form.querySelector('#conta-extra-' + id);
        ta.addEventListener('input', function () {
          if (conta) conta.textContent = ta.value.length + '/' + LIMITE_RESPOSTA;
        });
        ta.addEventListener('change', function () {
          estado.extras[id] = ta.value.slice(0, LIMITE_RESPOSTA);
          salvar();
        });
      });
    }
    var lista = app.querySelector('.cartoes');
    if (lista) {
      lista.addEventListener('pointerdown', aoPressionar);
      lista.addEventListener('keydown', aoTeclar);
    }
  }

  function mostrarErro(form, campo, msg) {
    var el = form.querySelector('#erro-' + campo);
    var input = form.querySelector('#' + campo);
    if (el) el.textContent = msg;
    if (input) {
      if (msg) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    }
    return !msg;
  }

  // Valor de um campo do formulário ('' se ele não existir nesta avaliação).
  function valorCampo(form, id) {
    var el = form.querySelector('#' + id);
    return el ? el.value : '';
  }

  // Respostas das perguntas extras que estão na tela: { id: texto }.
  function extrasDoForm(form) {
    var out = {};
    for (var k in estado.extras) if (Object.prototype.hasOwnProperty.call(estado.extras, k)) out[k] = estado.extras[k];
    Array.prototype.forEach.call(form.querySelectorAll('textarea[data-extra]'), function (ta) {
      out[ta.getAttribute('data-extra')] = ta.value.slice(0, LIMITE_RESPOSTA);
    });
    return out;
  }

  function enviarIdentificacao(form) {
    if (PESSOAL) { enviarIdentificacaoPessoal(form); return; }
    var f = FORM();
    var nome = form.querySelector('#nome').value;
    var tel = form.querySelector('#telefone').value;
    var vaga = valorCampo(form, 'vaga');
    var cons = form.querySelector('#consentimento').checked;
    var dados = {
      idade: valorCampo(form, 'idade'),
      funcao: valorCampo(form, 'funcao'),
      empresa: valorCampo(form, 'empresa'),
      email: valorCampo(form, 'email'),
      cidade: valorCampo(form, 'cidade'),
      foto: estado.foto,
      extras: extrasDoForm(form)
    };
    var errosForm = validarCamposFormulario(dados, f);
    var okNome = mostrarErro(form, 'nome', validarNome(nome));
    var okTel = mostrarErro(form, 'telefone', validarTelefone(tel));
    var okForm = true;
    CAMPOS_FORMULARIO.forEach(function (c) { if (!mostrarErro(form, c, errosForm[c] || '')) okForm = false; });
    f.perguntas.forEach(function (p) { if (!mostrarErro(form, 'extra-' + p.id, errosForm['extra-' + p.id] || '')) okForm = false; });
    var okCons = mostrarErro(form, 'consentimento', cons ? '' : 'Para continuar, marque a autorização de uso dos dados.');
    if (!okNome || !okTel || !okForm || !okCons) {
      var primeiro = form.querySelector('[aria-invalid="true"]');
      if (primeiro) primeiro.focus();
      return;
    }
    estado.nome = normalizarNome(nome);
    estado.telefone = limparTelefone(tel);
    if (form.querySelector('#idade')) estado.idade = limparIdade(dados.idade);
    if (form.querySelector('#funcao')) estado.funcao = limparTextoCurto(dados.funcao);
    if (form.querySelector('#empresa')) estado.empresa = limparTextoCurto(dados.empresa);
    if (form.querySelector('#email')) estado.email = limparEmail(dados.email);
    if (form.querySelector('#cidade')) estado.cidade = limparTextoCurto(dados.cidade);
    estado.extras = dados.extras;
    estado.vaga = String(vaga || '').trim();
    estado.consentimento = true;
    if (!estado.id) estado.id = gerarId();
    if (!estado.permutacoes) estado.permutacoes = gerarPermutacoes();
    if (!estado.inicio) estado.inicio = new Date().toISOString();
    // Voltou aqui no envio (dado faltando): "Salvar e enviar" reenvia.
    if (estado.reenviar) {
      estado.reenviar = false;
      concluir();
      return;
    }
    var p = primeiroIncompleto();
    if (p === -1) { irDepoisDosGrupos(); return; }
    estado.grupo = p;
    irPara('teste');
  }

  // A identificação salva ainda vale para o formulário atual? (ex.: progresso de antes do campo idade)
  function identificacaoValida() {
    if (PESSOAL) {
      var ep = validarIdentificacaoPessoal(estado);
      for (var c in ep) if (Object.prototype.hasOwnProperty.call(ep, c)) return false;
      return true;
    }
    if (validarNome(estado.nome) || validarTelefone(estado.telefone) || !estado.consentimento) return false;
    var erros = validarCamposFormulario(estado, FORM());
    for (var k in erros) if (Object.prototype.hasOwnProperty.call(erros, k)) return false;
    return true;
  }

  function aoClicar(ev) {
    var alvo = ev.target.closest('button, a[data-acao]');
    if (!alvo || !app.contains(alvo) || alvo.disabled) return;

    if (alvo.hasAttribute('data-dica')) {
      alternarDica(alvo);
      return;
    }
    var acao = alvo.getAttribute('data-acao');
    if (!acao) return;

    switch (acao) {
      case 'comprar':
        abrirCheckout(alvo.getAttribute('data-pacote'));
        break;
      case 'refazer':
        if (alvo.getAttribute('data-confirmar') !== 'sim') {
          alvo.setAttribute('data-confirmar', 'sim');
          alvo.textContent = 'Toque de novo para refazer';
          var nota = app.querySelector('#nota-refazer');
          if (nota) nota.hidden = false;
          return;
        }
        refazerPessoal();
        break;
      case 'ver-resumo':
        estado = estadoInicial();
        estado.etapa = 'resumo';
        render(true);
        break;
      case 'comecar':
        // Concluído ou dados de outro link: começa do zero.
        if (estado.etapa === 'concluido' || String(estado.avaliacaoCodigo || '') !== (AVAL ? AVAL.codigo : '')) estado = estadoInicial();
        irPara('identificacao');
        break;
      case 'continuar':
        var salvo = lerStorage(CHAVE_PROGRESSO);
        estado = garantirCampos(progressoValido(salvo) ? migrarProgresso(salvo) : estadoInicial());
        // Etapas antigas (ex.: 'revisao') caem num destino válido.
        var dest = etapaRetomada(estado, N, !!modValidacao(), P2() ? { n: N2 } : null);
        estado.etapa = dest.etapa;
        estado.grupo = dest.grupo;
        estado.confTela = dest.confTela;
        if (dest.grupo2 !== undefined) estado.grupo2 = dest.grupo2;
        if (P2() && !estado.permutacoes2 && estado.etapa === 'parte2') estado.permutacoes2 = gerarPermutacoes2();
        estado.reenviar = false;
        // Identificação incompleta para este formulário (ex.: progresso de antes do campo idade): pede antes de seguir.
        if (estado.etapa !== 'identificacao' && !identificacaoValida()) estado.etapa = 'identificacao';
        render(true);
        break;
      case 'recomecar':
        apagarStorage(CHAVE_PROGRESSO);
        estado = estadoInicial();
        irPara('identificacao');
        break;
      case 'voltar-inicio':
        guardarCamposForm();
        estado.reenviar = false;
        irPara('boasvindas');
        break;
      case 'foto-remover':
        estado.foto = '';
        salvar();
        atualizarFotoNaTela('');
        var gal = app.querySelector('#foto');
        if (gal) { try { gal.focus({ preventScroll: true }); } catch (e) { gal.focus(); } }
        anunciar('Foto removida.');
        break;
      case 'ver-demo':
        iniciarDemo();
        break;
      case 'confirmar-ordem':
        marcarRespondido(ordemNaTela(), true, true);
        var prox = app.querySelector('[data-acao="proximo"]');
        if (prox) prox.focus();
        anunciar('Ordem registrada. Você já pode avançar.');
        break;
      case 'anterior':
        if (naParte2()) {
          if (estado.grupo2 === 0) irPara('parte2-intro');
          else { estado.grupo2--; irPara('parte2'); }
        } else if (estado.grupo === 0) irPara('identificacao');
        else { estado.grupo--; irPara('teste'); }
        break;
      case 'parte2-voltar':
        estado.grupo = N - 1;
        irPara('teste');
        break;
      case 'parte2-comecar':
        if (!estado.permutacoes2) estado.permutacoes2 = gerarPermutacoes2();
        var f2 = primeiroIncompleto2();
        estado.grupo2 = f2 === -1 ? 0 : f2;
        irPara('parte2');
        break;
      case 'proximo':
        if (naParte2()) {
          if (!grupoCompleto2(estado.grupo2)) return;
          if (estado.grupo2 >= N2 - 1) {
            var falta2 = primeiroIncompleto2();
            if (falta2 !== -1) { estado.grupo2 = falta2; avisoTela = 'Falta ordenar este grupo para concluir.'; irPara('parte2'); }
            else irDepoisDosGrupos();
          } else {
            estado.grupo2++;
            irPara('parte2');
          }
          return;
        }
        if (!grupoCompleto(estado.grupo)) return;
        if (estado.grupo >= N - 1) {
          var falta = primeiroIncompleto();
          if (falta !== -1) irParaGrupoIncompleto('Falta ordenar este grupo para concluir.');
          else irDepoisDosGrupos();
        } else {
          estado.grupo++;
          irPara('teste');
        }
        break;
      case 'escolher-retrato':
        if (!estado.validacao) return;
        estado.validacao.escolhas[Number(alvo.getAttribute('data-rodada'))] = alvo.getAttribute('data-letra');
        salvar();
        atualizarConfirmacao();
        break;
      case 'marcar-nota':
        var item = estado.validacao && estado.validacao.montagem.itens[Number(alvo.getAttribute('data-item'))];
        if (!item) return;
        estado.validacao.notas[item.id] = Number(alvo.getAttribute('data-nota'));
        salvar();
        atualizarConfirmacao();
        break;
      case 'conf-anterior':
        // Só a 2ª tela volta (para a 1ª); da confirmação não se volta aos grupos.
        if (estado.confTela === 2) { estado.confTela = 1; irPara('confirmacao'); }
        break;
      case 'conf-proximo':
        if (!telaValidacaoCompleta(estado.validacao, 1)) return;
        estado.confTela = 2;
        irPara('confirmacao');
        break;
      case 'imprimir':
        try { root.print(); } catch (e) { /* sem impressão */ }
        break;
      case 'link-retentar':
        carregarAvaliacao();
        break;
      case 'enviar':
        if (estado.etapa === 'confirmacao' && !validacaoCompleta(estado.validacao)) return;
        concluir();
        break;
      case 'retentar':
        concluir();
        break;
      case 'usar-codigo':
        completarDemonstracao();
        completarDemonstracao2();
        estado.avaliacaoCodigo = AVAL ? AVAL.codigo : '';
        try {
          finalizar(montarPayload(estado, estado.ordens, null, FORM()), false);
        } catch (e) {
          envio = { carregando: false, erro: '' };
          irParaGrupoIncompleto('Encontramos um problema nas respostas. Confira este grupo e continue.');
        }
        break;
      case 'copiar':
        copiarCodigo();
        break;
      case 'copiar-protocolo':
        var elP = app.querySelector('#protocolo');
        copiarTexto(elP ? elP.getAttribute('data-protocolo') : '', null);
        break;
      case 'novo-teste':
        // Confirmação em dois toques (sem confirm() do navegador)
        if (alvo.getAttribute('data-confirmar') !== 'sim') {
          alvo.setAttribute('data-confirmar', 'sim');
          alvo.textContent = 'Toque de novo para confirmar';
          return;
        }
        apagarSessao(CHAVE_CONCLUIDO);
        apagarStorage(CHAVE_CONCLUIDO);
        apagarStorage(CHAVE_PROGRESSO);
        estado = estadoInicial();
        render(true);
        break;
    }
  }

  function guardarCamposForm() {
    var form = app.querySelector('#form-identificacao');
    if (!form) return;
    estado.nome = form.querySelector('#nome').value;
    estado.telefone = limparTelefone(form.querySelector('#telefone').value);
    // Campo que não está na tela (oculto neste processo) mantém o valor salvo.
    ['funcao', 'empresa', 'email', 'cidade', 'vaga'].forEach(function (c) {
      if (form.querySelector('#' + c)) estado[c] = valorCampo(form, c);
    });
    if (form.querySelector('#idade')) estado.idade = limparIdade(valorCampo(form, 'idade'));
    estado.extras = extrasDoForm(form);
    estado.consentimento = form.querySelector('#consentimento').checked;
  }

  /* ------------------- Dicas (botão "i") --------------------------- */
  // Um painel flutuante só (position: fixed no body): não empurra nada nem move o cartão.

  var dica = { botao: null, painel: null };

  function painelDica() {
    if (dica.painel && document.body.contains(dica.painel)) return dica.painel;
    var el = document.createElement('div');
    el.id = 'dica-janela';
    el.className = 'dica-janela vidro-janela';
    el.setAttribute('role', 'dialog');
    el.hidden = true;
    document.body.appendChild(el);
    dica.painel = el;
    return el;
  }

  function conteudoDica(botao) {
    var i = indiceDados();
    var g = DATA.grupos[i];
    try {
      if (botao.getAttribute('data-dica') === 'pergunta') {
        var texto = DICAS && DICAS.dicaPergunta(i);
        return texto ? { palavra: perguntaDoGrupo(i, g), sentido: texto, exemplo: '' } : null;
      }
      return DICAS ? DICAS.dicaPalavra(i, botao.getAttribute('data-letra')) : null;
    } catch (e) { return null; }
  }

  function posicionarDica() {
    var b = dica.botao, p = dica.painel;
    if (!b || !p || p.hidden) return;
    var r = b.getBoundingClientRect();
    var vw = document.documentElement.clientWidth || root.innerWidth;
    var vh = root.innerHeight;
    var margem = 16, vao = 8;
    var w = p.offsetWidth, h = p.offsetHeight;
    // Alinha a borda direita do painel com a do botão, sem sair da tela.
    var left = Math.max(margem, Math.min(r.right - w, vw - margem - w));
    var top = r.bottom + vao;
    if (top + h > vh - margem && r.top - vao - h >= margem) top = r.top - vao - h;   // sem espaço embaixo: abre em cima
    top = Math.max(margem, Math.min(top, vh - margem - h));
    p.style.left = Math.round(left) + 'px';
    p.style.top = Math.round(top) + 'px';
  }

  function abrirDica(botao) {
    var d = conteudoDica(botao);
    if (!d) return;
    fecharDica(false);
    var p = painelDica();
    p.innerHTML =
      '<p class="dica-palavra">' + escapar(d.palavra) + '</p>' +
      (d.sentido ? '<p class="dica-sentido">' + escapar(d.sentido) + '</p>' : '') +
      (d.exemplo ? '<p class="dica-exemplo">' + escapar(d.exemplo) + '</p>' : '');
    p.setAttribute('aria-label', botao.getAttribute('aria-label') || 'Dica');
    p.style.left = '-9999px';
    p.style.top = '-9999px';
    p.hidden = false;
    dica.botao = botao;
    botao.setAttribute('aria-expanded', 'true');
    posicionarDica();
    anunciar(d.palavra + '. ' + (d.sentido || '') + (d.exemplo ? ' ' + d.exemplo : ''));
  }

  function fecharDica(devolverFoco) {
    var b = dica.botao;
    dica.botao = null;
    if (dica.painel) { dica.painel.hidden = true; dica.painel.innerHTML = ''; }
    if (b) {
      b.setAttribute('aria-expanded', 'false');
      if (devolverFoco && document.body.contains(b)) { try { b.focus({ preventScroll: true }); } catch (e) { b.focus(); } }
    }
  }

  function alternarDica(botao) {
    if (dica.botao === botao) fecharDica(false);
    else abrirDica(botao);
  }

  function ligarDicasGlobais() {
    // Clique/toque fora fecha (o próprio "i" alterna no clique).
    document.addEventListener('pointerdown', function (ev) {
      if (!dica.botao) return;
      var t = ev.target;
      if (dica.painel && dica.painel.contains(t)) return;
      if (t && t.closest && t.closest('[data-dica]') === dica.botao) return;
      fecharDica(false);
    }, true);
    document.addEventListener('keydown', function (ev) {
      if (dica.botao && (ev.key === 'Escape' || ev.key === 'Esc')) { ev.preventDefault(); fecharDica(true); }
    });
    root.addEventListener('resize', posicionarDica);
    root.addEventListener('scroll', posicionarDica, true);
  }

  /* ------------- Demonstração do arraste (mão fantasma) ------------- */
  // Uma cópia do último cartão sobe até o topo e volta (2 ciclos), com a mão e o balão "Arraste para ordenar".
  // É só desenho por cima da lista (pointer-events: none): não muda a ordem real e não conta como interação.
  // Some no primeiro toque ou tecla; com prefers-reduced-motion fica só a dica parada.

  function iniciarDemo() {
    encerrarDemo(false);
    var caixa = app.querySelector('.lista-ordenar');
    var cartoes = cartoesNaTela();
    if (!caixa || cartoes.length !== 4) return;
    var ultimo = cartoes[3];
    var texto = palavraDoGrupo(indiceDados(), DATA.grupos[indiceDados()], ultimo.getAttribute('data-letra'));
    var el = document.createElement('div');
    el.className = 'demo';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '' +
      '<div class="demo-arrasto">' +
        '<div class="demo-cartao"><span class="cartao-alca">' + ICONE_ALCA + '</span><span class="cartao-texto">' + escapar(texto) + '</span></div>' +
        '<span class="demo-mao"><span class="demo-toque"></span>' + ICONE_MAO + '</span>' +
      '</div>' +
      '<p class="demo-balao vidro-janela">Arraste para ordenar</p>';
    caixa.appendChild(el);
    caixa.classList.add('lista-ordenar--demo');
    var arrasto = el.querySelector('.demo-arrasto');
    arrasto.addEventListener('animationend', function (ev) {
      if (ev.target === arrasto) encerrarDemo(true);
    });
  }

  // marcar: grava no progresso que a demonstração já foi vista.
  function encerrarDemo(marcar) {
    var el = app && app.querySelector('.demo');
    if (!el) return;
    var caixa = el.parentNode;
    caixa.removeChild(el);
    caixa.classList.remove('lista-ordenar--demo');
    if (marcar && estado && !estado.demoVista) {
      estado.demoVista = true;
      salvar();
    }
  }

  function ligarDemoGlobal() {
    // Captura: o primeiro toque/tecla em qualquer lugar some com a demonstração antes de qualquer outra ação.
    document.addEventListener('pointerdown', function () { encerrarDemo(true); }, true);
    document.addEventListener('keydown', function () { encerrarDemo(true); }, true);
  }

  /* ------------------- Lista ordenável (grupos) -------------------- */

  function cartoesNaTela() {
    var lista = app.querySelector('.cartoes');
    return lista ? Array.prototype.slice.call(lista.querySelectorAll('.cartao')) : [];
  }

  function ordemNaTela() {
    return cartoesNaTela().map(function (c) { return c.getAttribute('data-letra'); });
  }

  // Grava a ordem, marca o grupo como respondido e atualiza só o que muda (nada é redesenhado).
  // aceito: true quando a pessoa tocou em "Esta ordem está certa" sem mexer; mexer depois desfaz.
  function marcarRespondido(ordem, respondido, aceito) {
    if (naParte2()) {
      var k = estado.grupo2;
      estado.ordens2[k] = ordem.slice();
      if (respondido) estado.respondidos2[k] = true;
      salvar();
      atualizarControles();
      return;
    }
    var i = estado.grupo;
    estado.ordens[i] = ordem.slice();
    if (respondido) estado.respondidos[i] = true;
    estado.aceitos[i] = !!aceito;
    salvar();
    atualizarControles();
  }

  function atualizarControles() {
    var p2 = naParte2();
    var completo = grupoAtualCompleto();
    var prox = app.querySelector('[data-acao="proximo"]');
    if (prox) prox.disabled = !completo;
    var dica = app.querySelector('#dica-avancar');
    if (dica) dica.textContent = dicaHtml(completo);
    var conf = app.querySelector('#confirmar');
    var querConfirmado = completo ? '.confirmado' : '[data-acao="confirmar-ordem"]';
    if (conf && !conf.querySelector(querConfirmado)) conf.innerHTML = confirmarHtml(completo);
    if (prox) {
      var rotulo = rotuloProximo(p2 ? estado.grupo2 === N2 - 1 : estado.grupo === N - 1);
      if (prox.textContent !== rotulo) prox.textContent = rotulo;
    }
    atualizarBarra(feitosGrupo(completo));
  }

  // Barra de progresso (anima a largura; não redesenha a tela)
  function atualizarBarra(feitos) {
    var pct = Math.round((feitos / passosTotais()) * 100);
    var visivel = Math.max(pct, 8);
    var barra = app.querySelector('.progresso-barra');
    if (barra) {
      barra.setAttribute('aria-valuenow', String(feitos));
      var feito = barra.querySelector('.progresso-feito');
      var ponto = barra.querySelector('.progresso-ponto');
      if (feito) feito.style.width = visivel + '%';
      if (ponto) ponto.style.left = 'clamp(22px, ' + (visivel - 0.5) + '%, calc(100% - 22px))';
    }
    var pctEl = app.querySelector('.progresso-pct');
    if (pctEl) pctEl.textContent = pct + '%';
  }

  // Aplica uma nova ordem com animação FLIP: mede onde cada cartão está, reorganiza e anima até o novo lugar.
  function aplicarOrdem(nova) {
    var lista = app.querySelector('.cartoes');
    if (!lista) return;
    var cartoes = cartoesNaTela();
    var foco = document.activeElement;
    var antes = {};
    cartoes.forEach(function (c) { antes[c.getAttribute('data-letra')] = c.getBoundingClientRect().top; });
    nova.forEach(function (letra, k) {
      var c = lista.querySelector('.cartao[data-letra="' + letra + '"]');
      if (!c) return;
      lista.appendChild(c);                 // ordem no DOM = ordem visual (leitor de tela e Tab)
      c.style.setProperty('--pos', String(k));
      c.style.transform = '';
      c.classList.remove('arrastando');
      var pos = c.querySelector('.cartao-pos');
      if (pos) pos.textContent = ', ' + descricaoPosicao(k);
    });
    lista.classList.remove('ordenando');
    // FLIP: inverte (volta visualmente ao lugar antigo sem transição) e depois solta a transição.
    var mexidos = [];
    cartoesNaTela().forEach(function (c) {
      var delta = antes[c.getAttribute('data-letra')] - c.getBoundingClientRect().top;
      if (Math.abs(delta) < 0.5) return;
      c.style.transition = 'none';
      c.style.transform = 'translateY(calc(var(--pos) * var(--passo) + ' + delta + 'px))';
      mexidos.push(c);
    });
    if (mexidos.length) {
      void lista.offsetHeight;   // força o navegador a registrar a posição invertida
      mexidos.forEach(function (c) { c.style.transition = ''; c.style.transform = ''; });
    }
    // Mantém o foco onde estava (mover no DOM tira o foco do elemento).
    if (foco && lista.contains(foco)) {
      if (document.activeElement !== foco) {
        try { foco.focus({ preventScroll: true }); } catch (e) { foco.focus(); }
      }
    }
  }

  function anunciarPosicao(letra, ordem) {
    var i = indiceDados();
    var k = ordem.indexOf(letra);
    anunciar(palavraDoGrupo(i, DATA.grupos[i], letra) + ' agora está na ' + descricaoPosicao(k) + '.');
  }

  function aoTeclar(ev) {
    var cartao = ev.target.closest && ev.target.closest('.cartao');
    if (!cartao || ev.target !== cartao) return;
    var letra = cartao.getAttribute('data-letra');
    var ordem = ordemNaTela();
    var de = ordem.indexOf(letra);
    var para = de;
    if (ev.key === 'ArrowUp') para = de - 1;
    else if (ev.key === 'ArrowDown') para = de + 1;
    else if (ev.key === 'Home') para = 0;
    else if (ev.key === 'End') para = 3;
    else return;
    ev.preventDefault();
    para = Math.max(0, Math.min(3, para));
    if (para === de) return;
    var nova = mover(ordem, de, para);
    aplicarOrdem(nova);
    marcarRespondido(nova, true);
    anunciarPosicao(letra, nova);
  }

  function lerPasso(lista) {
    var v = parseFloat(root.getComputedStyle(lista).getPropertyValue('--passo'));
    if (v > 0) return v;
    var c = lista.querySelector('.cartao');
    return c ? c.offsetHeight + 8 : 72;
  }

  // Arrastar com Pointer Events (dedo e mouse). O cartão segue o ponteiro; os outros deslizam para abrir espaço.
  function aoPressionar(ev) {
    if (arraste) return;
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    if (ev.target.closest('[data-sem-arraste]')) return; // botão "i": abre a dica, nunca arrasta
    if (ev.target.closest('button')) return;
    var cartao = ev.target.closest('.cartao');
    var lista = app.querySelector('.cartoes');
    if (!cartao || !lista) return;
    var ordem = ordemNaTela();
    var letra = cartao.getAttribute('data-letra');
    arraste = {
      cartao: cartao, lista: lista, letra: letra, ordem: ordem,
      de: ordem.indexOf(letra), para: ordem.indexOf(letra),
      y0: ev.clientY, passo: lerPasso(lista), ativo: false, id: ev.pointerId
    };
    try { cartao.setPointerCapture(ev.pointerId); } catch (e) { /* ignora */ }
    cartao.addEventListener('pointermove', aoArrastar);
    cartao.addEventListener('pointerup', aoSoltar);
    cartao.addEventListener('pointercancel', aoCancelar);
  }

  function aoArrastar(ev) {
    var a = arraste;
    if (!a || ev.pointerId !== a.id) return;
    var dy = ev.clientY - a.y0;
    if (!a.ativo) {
      if (Math.abs(dy) < 6) return;
      a.ativo = true;
      fecharDica(false);
      a.cartao.classList.add('arrastando');
      a.lista.classList.add('ordenando');
    }
    ev.preventDefault();
    var max = (a.ordem.length - 1) * a.passo;
    var y = Math.max(-a.passo * 0.3, Math.min(max + a.passo * 0.3, a.de * a.passo + dy));
    a.cartao.style.transform = 'translateY(' + y + 'px)';
    var para = Math.max(0, Math.min(a.ordem.length - 1, Math.round(y / a.passo)));
    if (para !== a.para) {
      a.para = para;
      var provisoria = mover(a.ordem, a.de, para);
      provisoria.forEach(function (l, k) {
        if (l === a.letra) return;
        var c = a.lista.querySelector('.cartao[data-letra="' + l + '"]');
        if (c) c.style.setProperty('--pos', String(k));
      });
    }
  }

  function encerrarArraste() {
    var a = arraste;
    arraste = null;
    if (!a) return null;
    a.cartao.removeEventListener('pointermove', aoArrastar);
    a.cartao.removeEventListener('pointerup', aoSoltar);
    a.cartao.removeEventListener('pointercancel', aoCancelar);
    try { a.cartao.releasePointerCapture(a.id); } catch (e) { /* ignora */ }
    return a;
  }

  function aoSoltar(ev) {
    if (!arraste || ev.pointerId !== arraste.id) return;
    var a = encerrarArraste();
    if (!a.ativo) return;   // foi só um toque: nada muda
    var nova = mover(a.ordem, a.de, a.para);
    aplicarOrdem(nova);     // encaixa na posição com animação
    if (a.para !== a.de) {
      marcarRespondido(nova, true);
      anunciarPosicao(a.letra, nova);
    }
  }

  function aoCancelar(ev) {
    if (!arraste || ev.pointerId !== arraste.id) return;
    var a = encerrarArraste();
    if (a.ativo) aplicarOrdem(a.ordem);
  }

  function finalizar(payload, enviado, protocolo) {
    protocolo = enviado ? normalizarProtocolo(protocolo) : '';
    var concluido = { payload: payload, enviado: enviado, protocolo: protocolo };
    // Só o necessário, só nesta aba: com envio confirmado guarda só o primeiro nome e o protocolo
    // (nada de telefone nem respostas); sem envio guarda o payload para o código continuar visível ao recarregar.
    var primeiroNome = normalizarNome(payload.nome).split(' ')[0];
    var sessao = enviado
      ? (protocolo ? { enviado: true, primeiroNome: primeiroNome, protocolo: protocolo } : { enviado: true, primeiroNome: primeiroNome })
      : { enviado: false, payload: payload };
    // De qual link veio: ao abrir outro link (ou o link geral) nesta aba, a conclusão antiga não aparece.
    if (AVAL) sessao.avaliacao = AVAL.codigo;
    // Avaliação que mostra o resultado: guarda só percentuais + código do perfil (sem telefone nem respostas),
    // para o relatório continuar ao recarregar.
    if (enviado && mostraResultado()) {
      var rel = relatorioDoPayload(payload);
      if (rel) { sessao.relatorio = rel; concluido.relatorio = rel; }
      // A própria foto, para o cabeçalho do relatório continuar ao recarregar (só nesta aba).
      if (rel && fotoValida(payload.foto)) sessao.foto = payload.foto;
    }
    gravarSessao(CHAVE_CONCLUIDO, sessao);
    apagarStorage(CHAVE_CONCLUIDO);
    apagarStorage(CHAVE_PROGRESSO);
    estado.concluido = concluido;
    envio = { carregando: false, erro: '' };
    estado.etapa = 'concluido';
    render(true);
  }

  function concluir() {
    if (PESSOAL) { concluirPessoal(); return; }
    if (envio.carregando) return;
    envio = { carregando: false, erro: '' };
    if (primeiroIncompleto() !== -1) { irParaGrupoIncompleto('Falta ordenar este grupo para concluir.'); return; }
    if (P2() && primeiroIncompleto2() !== -1) {
      if (!estado.permutacoes2) estado.permutacoes2 = gerarPermutacoes2();
      if (!algumRespondido2()) { irPara('parte2-intro'); return; }
      estado.grupo2 = primeiroIncompleto2();
      avisoTela = 'Falta ordenar este grupo para concluir.';
      irPara('parte2');
      return;
    }
    // Dado da identificação faltando (ex.: idade obrigatória): volta à identificação; "Salvar e enviar" reenvia.
    if (!identificacaoValida()) {
      estado.reenviar = true;
      avisoTela = 'Falta completar seus dados. Confira e toque em Salvar e enviar.';
      irPara('identificacao');
      return;
    }
    completarDemonstracao();
    completarDemonstracao2();
    if (destinoAposGrupos() === 'confirmacao') { irDepoisDosGrupos(); return; }
    estado.avaliacaoCodigo = AVAL ? AVAL.codigo : '';
    var payload;
    try {
      payload = montarPayload(estado, estado.ordens, null, FORM());
    } catch (e) {
      irParaGrupoIncompleto('Encontramos um problema nas respostas. Confira este grupo e continue.');
      return;
    }
    var api = root.DISC_API;
    var temApi = CONFIG.API_URL && String(CONFIG.API_URL).trim() && api;
    if (!temApi) { finalizar(payload, false); return; }

    envio = { carregando: true, erro: '' };
    irPara('enviando');
    api.enviar(payload).then(function (resp) {
      // O servidor gera o protocolo (também no reenvio com id duplicado, devolvendo o mesmo).
      finalizar(payload, true, resp && resp.protocolo);
    }, function (erro) {
      var msg = (erro && erro.message) || 'Erro desconhecido.';
      // Se uma tentativa anterior chegou ao servidor, o id já existe: tratar como sucesso.
      if (/duplicad|já (foi )?(recebid|registrad|enviad|existe)/i.test(msg)) { finalizar(payload, true); return; }
      if (root.console && root.console.warn) root.console.warn('Falha no envio do teste DISC:', msg);
      envio = { carregando: false, erro: mensagemErroEnvio(msg) };
      estado.etapa = 'enviando';
      render(true);
    });
  }

  function copiarCodigo() {
    var ta = app.querySelector('#codigo');
    if (!ta) return;
    copiarTexto(ta.value, ta);
  }

  // Copia para a área de transferência; sem a API moderna, usa um campo (o visível ou um temporário).
  function copiarTexto(texto, campo) {
    var status = app.querySelector('#copiado');
    if (!texto) return;
    function ok() { if (status) status.textContent = 'Código copiado!'; }
    function manual() {
      var ta = campo;
      var temporario = !ta;
      if (temporario) {
        ta = document.createElement('textarea');
        ta.value = texto;
        ta.setAttribute('readonly', '');
        ta.className = 'visualmente-oculto';
        document.body.appendChild(ta);
      }
      ta.focus();
      ta.select();
      var copiou = false;
      try { copiou = document.execCommand('copy'); } catch (e) { copiou = false; }
      if (temporario) document.body.removeChild(ta);
      if (copiou) ok();
      else if (status) status.textContent = temporario ? 'Anote o código: ' + texto + '.' : 'Selecione o código e copie manualmente.';
    }
    if (root.navigator && root.navigator.clipboard && root.isSecureContext) {
      root.navigator.clipboard.writeText(texto).then(ok, manual);
    } else {
      manual();
    }
  }

  /* ------------------------------------------------------------------ */
  /* Modo pessoal (venda B2C): identificação, resumo grátis, paywall,    */
  /* checkout (js/checkout.js) e Parte 2 do Completo + Parte 2.          */
  /* ------------------------------------------------------------------ */

  function lerPessoal() {
    var p = lerStorage(CHAVE_PESSOAL);
    return p && typeof p === 'object' && p.relatorio ? p : null;
  }
  function gravarPessoal(p) { gravarStorage(CHAVE_PESSOAL, p); }
  function CK() { return root.DISC_CHECKOUT || null; }
  function pacotesAtuais() {
    var ck = CK();
    return PACOTES || (ck ? ck.normalizarPacotes(null) : []);
  }
  function linkMeuRelatorio(token) {
    var ck = CK();
    return ck ? ck.linkRelatorio(root.location.href, token) : 'meu-relatorio.html#t-' + encodeURIComponent(token);
  }
  function pedidoLiberado(ps) {
    var ck = CK();
    return !!(ps && ps.pedido && ps.pedido.tokenAcesso && ck && ck.liberado(ps.pedido.status));
  }

  function telaBoasVindasPessoal() {
    var ps = lerPessoal();
    return '' +
      '<section class="caixa surgir pessoal-retomar" aria-labelledby="titulo">' +
        '<p class="sobretitulo">' + escapar(EMPRESA_B2C) + ' · Mapa de Perfil</p>' +
        '<h1 id="titulo" class="titulo-pagina">Você tem um teste em andamento</h1>' +
        '<p class="subtitulo">Suas respostas ficaram salvas neste aparelho. Continue de onde parou ou comece de novo.</p>' +
        '<div class="acoes acoes-coluna">' +
          '<button type="button" class="botao botao--principal botao--grande" data-acao="continuar">Continuar de onde parei</button>' +
          '<button type="button" class="botao botao--claro botao--grande" data-acao="recomecar">Começar do zero</button>' +
          (ps ? '<button type="button" class="botao botao--link" data-acao="ver-resumo">Ver o meu último resumo</button>' : '') +
        '</div>' +
      '</section>';
  }

  function telaIdentificacaoPessoal() {
    return '' +
      '<section class="caixa surgir pessoal-id" aria-labelledby="titulo">' +
        '<p class="sobretitulo etapa">Seu Mapa de Perfil</p>' +
        '<h1 id="titulo" class="titulo-pagina">Antes de começar</h1>' +
        '<p class="subtitulo">São 25 grupos de 4 palavras, cerca de 10 minutos. No fim, você vê o seu resumo grátis na hora.</p>' +
        avisoHtml() +
        '<form id="form-identificacao" class="formulario" novalidate>' +
          '<div class="campo">' +
            '<label class="campo__rotulo" for="nome">Nome completo <span class="obrigatorio" aria-hidden="true">*</span></label>' +
            '<input class="entrada entrada--principal" id="nome" name="nome" type="text" autocomplete="name" autocapitalize="words" required maxlength="120" ' +
              'aria-describedby="erro-nome" value="' + escapar(estado.nome) + '">' +
            '<p class="campo__erro erro" id="erro-nome" role="alert"></p>' +
          '</div>' +
          '<div class="campo">' +
            '<label class="campo__rotulo" for="email">E-mail <span class="obrigatorio" aria-hidden="true">*</span></label>' +
            '<input class="entrada" id="email" name="email" type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" required maxlength="' + LIMITE_EMAIL + '" ' +
              'aria-describedby="dica-email erro-email" value="' + escapar(estado.email) + '">' +
            '<p class="campo__ajuda" id="dica-email">É por ele que você recebe e recupera o seu relatório.</p>' +
            '<p class="campo__erro erro" id="erro-email" role="alert"></p>' +
          '</div>' +
          '<div class="campo">' +
            '<label class="campo__rotulo" for="telefone">WhatsApp com DDD <span class="texto-suave">(opcional)</span></label>' +
            '<input class="entrada" id="telefone" name="telefone" type="tel" inputmode="numeric" autocomplete="tel-national" maxlength="25" ' +
              'placeholder="(11) 99999-8888" aria-describedby="dica-telefone erro-telefone" value="' + escapar(formatarTelefone(estado.telefone)) + '">' +
            '<p class="campo__ajuda" id="dica-telefone">Para mandar o link do relatório para você, se quiser.</p>' +
            '<p class="campo__erro erro" id="erro-telefone" role="alert"></p>' +
          '</div>' +
          '<div class="campo consentimento">' +
            '<label class="marcar" for="consentimento">' +
              '<input id="consentimento" name="consentimento" type="checkbox" required aria-describedby="erro-consentimento"' + (estado.consentimento ? ' checked' : '') + '>' +
              '<span>Autorizo a <strong>' + escapar(EMPRESA_B2C) + '</strong> a usar meus dados (nome, e-mail, WhatsApp e respostas) <strong>para gerar o meu relatório</strong> e me enviar o acesso a ele. ' +
                'Eles <strong>não são compartilhados com empresas</strong> e posso pedir a exclusão quando quiser, conforme a LGPD. ' +
                '<a href="privacidade.html" target="_blank" rel="noopener">Política de privacidade</a>.</span>' +
            '</label>' +
            '<p class="campo__erro erro" id="erro-consentimento" role="alert"></p>' +
          '</div>' +
          '<p class="pessoal-lembrete">Não há respostas certas ou erradas, nem perfil melhor ou pior. Responda pensando em como você realmente é.</p>' +
          '<div class="acoes">' +
            '<a class="botao botao--claro botao--grande" href="descubra.html">Voltar</a>' +
            '<button type="submit" class="botao botao--principal botao--grande">' + (estado.reenviar ? 'Salvar e ver meu resultado' : 'Começar o teste') + '</button>' +
          '</div>' +
        '</form>' +
      '</section>';
  }

  function enviarIdentificacaoPessoal(form) {
    var dados = {
      nome: form.querySelector('#nome').value,
      email: form.querySelector('#email').value,
      telefone: form.querySelector('#telefone').value,
      consentimento: form.querySelector('#consentimento').checked
    };
    var erros = validarIdentificacaoPessoal(dados);
    var ok = true;
    ['nome', 'email', 'telefone', 'consentimento'].forEach(function (c) { if (!mostrarErro(form, c, erros[c] || '')) ok = false; });
    if (!ok) {
      var primeiro = form.querySelector('[aria-invalid="true"]');
      if (primeiro) primeiro.focus();
      return;
    }
    estado.nome = normalizarNome(dados.nome);
    estado.email = limparEmail(dados.email);
    estado.telefone = limparTelefone(dados.telefone);
    estado.consentimento = true;
    if (!estado.id) estado.id = gerarId();
    if (!estado.permutacoes) estado.permutacoes = gerarPermutacoes();
    if (!estado.inicio) estado.inicio = new Date().toISOString();
    if (estado.reenviar) { estado.reenviar = false; concluirPessoal(); return; }
    var p = primeiroIncompleto();
    if (p === -1) { concluirPessoal(); return; }
    estado.grupo = p;
    irPara('teste');
  }

  function telaEnvioPessoal() {
    var p2 = !!P2_TOKEN;
    if (envio.carregando || !envio.erro) {
      return '' +
        '<section class="caixa centro surgir" aria-labelledby="titulo" aria-busy="true">' +
          '<div class="giro giro--grande" aria-hidden="true"></div>' +
          '<h1 id="titulo" class="titulo-pagina">' + (p2 ? 'Montando o seu relatório…' : 'Calculando o seu resultado…') + '</h1>' +
          '<p class="subtitulo">Isso leva só alguns segundos. Não feche esta página.</p>' +
        '</section>';
    }
    return '' +
      '<section class="caixa surgir" aria-labelledby="titulo">' +
        '<h1 id="titulo" class="titulo-pagina">Não foi possível continuar</h1>' +
        '<div class="aviso aviso--erro alerta" role="alert">' + escapar(envio.erro) + '</div>' +
        '<p class="subtitulo">Suas respostas continuam salvas neste aparelho. Verifique a conexão e tente de novo.</p>' +
        '<div class="acoes acoes-coluna">' +
          '<button type="button" class="botao botao--principal botao--grande" data-acao="retentar">Tentar novamente</button>' +
        '</div>' +
      '</section>';
  }

  function concluirPessoal() {
    if (P2_TOKEN) { enviarParte2Pessoal(); return; }
    if (envio.carregando) return;
    envio = { carregando: false, erro: '' };
    if (primeiroIncompleto() !== -1) { irParaGrupoIncompleto('Falta ordenar este grupo para concluir.'); return; }
    if (!identificacaoValida()) {
      estado.reenviar = true;
      avisoTela = 'Falta completar seus dados. Confira e toque em Salvar e ver meu resultado.';
      irPara('identificacao');
      return;
    }
    completarDemonstracao();
    var payload;
    try { payload = montarPayloadPessoal(estado, estado.ordens); }
    catch (e) { irParaGrupoIncompleto('Encontramos um problema nas respostas. Confira este grupo e continue.'); return; }
    var R = root.DISC_RELATORIO_PESSOA;
    var base = {
      primeiroNome: normalizarNome(estado.nome).split(' ')[0],
      email: payload.email,
      telefone: limparTelefone(estado.telefone),
      relatorio: R ? R.dadosDoResultado(payload.resultado.percentuais, payload.resultado.codigo) : payload.resultado,
      pacoteEscolhido: MODO.pacote || '',
      cupom: MODO.cupom || '',
      etapa: 'resumo',
      criadoEm: new Date().toISOString()
    };
    var api = root.DISC_API;
    var temApi = !!(CONFIG.API_URL && String(CONFIG.API_URL).trim() && api && typeof api.enviarPessoal === 'function');
    function pronto(extra) {
      for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) base[k] = extra[k];
      gravarPessoal(base);
      apagarStorage(CHAVE_PROGRESSO);
      envio = { carregando: false, erro: '' };
      pararCronometro();
      estado = estadoInicial();
      estado.etapa = 'resumo';
      render(true);
      anunciar('Seu resumo grátis está pronto.');
    }
    if (!temApi) { pronto({ tokenResumo: '' }); return; }
    envio = { carregando: true, erro: '' };
    irPara('enviando');
    api.enviarPessoal(payload).then(function (resp) {
      var token = String((resp && (resp.tokenResumo || resp.token_resumo || resp.token)) || '');
      pronto({ tokenResumo: token, protocolo: String((resp && resp.protocolo) || '') });
    }, function (erro) {
      var msg = (erro && erro.message) || 'Erro desconhecido.';
      if (root.console && root.console.warn) root.console.warn('Falha no envio do Mapa de Perfil:', msg);
      envio = { carregando: false, erro: erro && erro.resposta ? msg : mensagemErroEnvio(msg) };
      estado.etapa = 'enviando';
      render(true);
    });
  }

  function telaResumo() {
    var ps = lerPessoal();
    var R = root.DISC_RELATORIO_PESSOA;
    if (!ps || !R) { estado.etapa = 'identificacao'; return telaIdentificacaoPessoal(); }
    var s = null, d = null;
    try { s = R.montarSimples(ps.relatorio, ps.primeiroNome, DATA); d = R.montar(ps.relatorio, ps.primeiroNome, DATA); } catch (e) { s = null; }
    if (!s) { estado.etapa = 'identificacao'; return telaIdentificacaoPessoal(); }
    var venda;
    if (pedidoLiberado(ps)) {
      var url = linkMeuRelatorio(ps.pedido.tokenAcesso);
      venda = '' +
        '<section class="caixa caixa--destaque liberado surgir" aria-labelledby="titulo-liberado">' +
          '<h2 id="titulo-liberado" class="titulo-secao">Seu relatório completo está liberado</h2>' +
          '<p class="subtitulo">Abra quando quiser pelo seu link. Ele não expira.</p>' +
          '<div class="acoes acoes-coluna"><a class="botao botao--laranja botao--grande" href="' + escapar(url) + '">Abrir meu relatório</a></div>' +
        '</section>';
    } else if (!ps.tokenResumo) {
      venda = previaPagaHtml(d) +
        '<section class="caixa paywall surgir" aria-labelledby="titulo-paywall">' +
          '<h2 id="titulo-paywall" class="titulo-secao">Relatório completo</h2>' +
          '<div class="aviso">A compra do relatório completo fica disponível em breve.</div>' +
        '</section>';
    } else {
      venda = previaPagaHtml(d) +
        '<section class="caixa paywall surgir" aria-labelledby="titulo-paywall">' +
          '<p class="sobretitulo">Destrave o seu relatório</p>' +
          '<h2 id="titulo-paywall" class="titulo-secao">Escolha o seu relatório</h2>' +
          '<p class="subtitulo">Pagamento único, por Pix ou cartão. O acesso abre na hora e fica no seu link.</p>' +
          '<div id="pacotes-caixa">' + pacotesHtml(pacotesAtuais(), ps.pacoteEscolhido || MODO.pacote) + '</div>' +
          '<p class="ck-garantia"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/></svg>' +
            '<span><strong>Garantia de 7 dias.</strong> Não gostou? Devolvemos o valor, sem perguntas.</span></p>' +
        '</section>';
    }
    return '' +
      '<div class="pilha-telas pessoal-resumo">' +
        resumoGratisHtml(s) +
        venda +
        '<div class="rodape">' +
          '<p class="rodape-nota">O DISC descreve estilo de comportamento, não competência. Não existe perfil melhor ou pior.</p>' +
          '<a class="botao botao--link" href="meu-relatorio.html#recuperar">Já comprei: recuperar meu relatório</a>' +
          '<button type="button" class="botao botao--link" data-acao="refazer">Refazer o teste</button>' +
          '<p class="rodape-nota" id="nota-refazer" hidden>Um relatório já comprado continua no seu link, ligado a este resultado. Um novo resultado precisa de uma nova compra.</p>' +
        '</div>' +
      '</div>';
  }

  function abrirCheckout(chave) {
    var ps = lerPessoal();
    if (!ps || !ps.tokenResumo) return;
    ps.pacoteEscolhido = PACOTES_PAGOS.indexOf(chave) !== -1 ? chave : 'completo';
    ps.etapa = 'checkout';
    gravarPessoal(ps);
    estado.etapa = 'checkout';
    render(true);
  }

  function montarCheckout() {
    var ck = CK();
    var el = app.querySelector('#checkout-raiz');
    var ps = lerPessoal();
    if (!ck || !el || !ps) return;
    var pac = pacotesAtuais().filter(function (p) { return p.chave === ps.pacoteEscolhido; })[0] ||
      ck.PACOTES_PADRAO.filter(function (p) { return p.chave === ps.pacoteEscolhido; })[0] || ck.PACOTES_PADRAO[1];
    var salvo = ps.pedido && ps.pedido.pacote === pac.chave ? ps.pedido : null;
    checkout = ck.criar({
      api: root.DISC_API,
      tokenResumo: ps.tokenResumo,
      pacote: pac,
      pedido: salvo,
      cupom: ps.cupom || '',
      telefone: ps.telefone,
      aoAnunciar: anunciar,
      aoMudar: function (pedido) {
        var atual = lerPessoal();
        if (!atual) return;
        if (pedido) atual.pedido = pedido; else delete atual.pedido;
        gravarPessoal(atual);
      },
      aoVoltar: function () {
        var atual = lerPessoal();
        if (atual) { atual.etapa = 'resumo'; gravarPessoal(atual); }
        checkout = null;
        estado.etapa = 'resumo';
        render(true);
      },
      aoParte2: function (pedido) {
        checkout = null;
        entrarParte2(pedido.tokenAcesso, { primeiroNome: ps.primeiroNome });
      }
    });
    checkout.montar(el);
  }

  function refazerPessoal() {
    var ps = lerPessoal() || {};
    apagarStorage(CHAVE_PESSOAL);
    apagarStorage(CHAVE_PROGRESSO);
    estado = estadoInicial();
    estado.email = ps.email || '';
    estado.telefone = ps.telefone || '';
    irPara('identificacao');
  }

  /* ---- Parte 2 do Completo + Parte 2 (mesma mecânica de arrastar) ---- */

  function telaParte2Link() {
    if (telaP2 === 'carregando') {
      return '<section class="caixa centro" aria-labelledby="titulo" aria-busy="true"><div class="giro giro--grande" aria-hidden="true"></div>' +
        '<h1 id="titulo" class="subtitulo">Abrindo a Parte 2…</h1></section>';
    }
    return '' +
      '<section class="caixa surgir" aria-labelledby="titulo">' +
        '<h1 id="titulo" class="titulo-pagina">Não foi possível abrir a Parte 2</h1>' +
        '<div class="aviso aviso--erro alerta" role="alert">' + escapar(telaP2) + '</div>' +
        '<div class="acoes acoes-coluna"><a class="botao botao--principal botao--grande" href="meu-relatorio.html#recuperar">Recuperar meu relatório</a></div>' +
      '</section>';
  }

  function entrarParte2(token, dados) {
    P2_TOKEN = token;
    SEM_VALIDACAO = true;
    CHAVE_PROGRESSO = 'disc_pessoal_parte2_v1';
    telaP2 = '';
    var salvo = lerStorage(CHAVE_PROGRESSO);
    estado = estadoInicial();
    estado.p2Token = token;
    estado.nome = String((dados && dados.primeiroNome) || '');
    if (salvo && salvo.p2Token === token && !progressoExpirado(salvo)) {
      if (Array.isArray(salvo.ordens2)) estado.ordens2 = salvo.ordens2;
      if (Array.isArray(salvo.respondidos2)) estado.respondidos2 = salvo.respondidos2;
      if (Array.isArray(salvo.permutacoes2) && salvo.permutacoes2.length === TOTAL2) estado.permutacoes2 = salvo.permutacoes2;
    }
    if (!estado.permutacoes2) estado.permutacoes2 = gerarPermutacoes2();
    try { root.history.replaceState(null, '', root.location.pathname + '?modo=pessoal#p2-' + token); } catch (e) { /* ignora */ }
    if (algumRespondido2() && primeiroIncompleto2() !== -1) { estado.grupo2 = primeiroIncompleto2(); irPara('parte2'); }
    else irPara('parte2-intro');
  }

  function carregarParte2(token) {
    var api = root.DISC_API;
    if (!api || typeof api.relatorioPessoal !== 'function') { telaP2 = 'A Parte 2 precisa do servidor.'; render(true); return; }
    telaP2 = 'carregando';
    render(false);
    api.relatorioPessoal(token).then(function (r) {
      var rel = (r && r.relatorio) || r || {};
      var pacote = String(rel.pacote || '');
      var temExigido = !!(rel.exigido && (typeof rel.exigido === 'string' ? rel.exigido : rel.exigido.percentuais));
      if (pacote !== 'completo_plus' || temExigido) { root.location.replace(linkMeuRelatorio(token)); return; }
      entrarParte2(token, { primeiroNome: rel.primeiroNome || rel.nome || '' });
    }, function (e) {
      telaP2 = (e && e.message) || 'Verifique a sua conexão e tente de novo.';
      render(true);
    });
  }

  function enviarParte2Pessoal() {
    if (envio.carregando) return;
    completarDemonstracao2();
    var falta = primeiroIncompleto2();
    if (falta !== -1) { estado.grupo2 = falta; avisoTela = 'Falta ordenar este grupo para concluir.'; irPara('parte2'); return; }
    var exigido = exigidoDasOrdens(estado.ordens2);
    var api = root.DISC_API;
    envio = { carregando: true, erro: '' };
    irPara('enviando');
    Promise.resolve().then(function () { return api.salvarParte2Pessoal(P2_TOKEN, exigido); }).then(function (r) {
      if (r && r.ok === false) throw new Error(r.erro || 'Não foi possível salvar a Parte 2.');
      apagarStorage(CHAVE_PROGRESSO);
      envio = { carregando: false, erro: '' };
      root.location.assign(linkMeuRelatorio(P2_TOKEN));
    }).catch(function (e) {
      envio = { carregando: false, erro: (e && e.message) || 'Não foi possível salvar a Parte 2.' };
      estado.etapa = 'enviando';
      render(true);
    });
  }

  function carregarPacotes() {
    var api = root.DISC_API, ck = CK();
    if (!api || typeof api.pacotesPublicos !== 'function' || !ck) return;
    Promise.resolve().then(function () { return api.pacotesPublicos(); }).then(function (r) {
      PACOTES = ck.normalizarPacotes(r);
      var caixa = app.querySelector('#pacotes-caixa');
      var ps = lerPessoal();
      if (caixa && ps) caixa.innerHTML = pacotesHtml(PACOTES, ps.pacoteEscolhido || MODO.pacote);
    }, function () { /* fica o padrão */ });
  }

  function iniciarPessoal() {
    aplicarMarca();
    estado = estadoInicial();
    var temApi = !!(CONFIG.API_URL && String(CONFIG.API_URL).trim() && root.DISC_API);
    if (temApi) carregarPacotes();
    if (MODO.parte2Token) { carregarParte2(MODO.parte2Token); return; }
    var ps = lerPessoal();
    var salvo = lerStorage(CHAVE_PROGRESSO);
    if (MODO.pacote && ps && !pedidoLiberado(ps)) { ps.pacoteEscolhido = MODO.pacote; gravarPessoal(ps); }
    if (MODO.cupom && ps) { ps.cupom = MODO.cupom; gravarPessoal(ps); }
    if (temProgresso(salvo)) estado.etapa = 'boasvindas';
    else if (ps) estado.etapa = ps.etapa === 'checkout' && ps.tokenResumo && !pedidoLiberado(ps) ? 'checkout' : 'resumo';
    else estado.etapa = 'identificacao';
    render(false);
  }

  function iniciar() {
    app = document.getElementById('app');
    aviso = document.getElementById('aviso');
    if (!app) return;
    if (!DATA || !root.DISC_SCORING || !root.DISC_CODEC) {
      app.innerHTML = '<section class="caixa"><h1 class="titulo-pagina">Não foi possível carregar o teste</h1><p class="subtitulo">Atualize a página. Se o problema continuar, avise o recrutador.</p></section>';
      return;
    }
    // Link de avaliação (?a=SEL1 ou #a-SEL1). Sem servidor configurado o código é ignorado (fluxo geral).
    var api = root.DISC_API;
    try {
      CODIGO_LINK = api && api.codigoAvaliacaoDaUrl ? api.codigoAvaliacaoDaUrl(root.location.search, root.location.hash) : '';
    } catch (e) { CODIGO_LINK = ''; }
    var temApi = !!(CONFIG.API_URL && String(CONFIG.API_URL).trim() && api && api.avaliacaoPublica);
    if (!temApi) CODIGO_LINK = '';
    // Algo em ?a= ou #a- que não é um código válido: link inválido, sem chamar o servidor.
    if (PESSOAL) CODIGO_LINK = '';
    var linkMalFormado = !PESSOAL && temApi && !CODIGO_LINK && /[?&]a=|^#a-/.test(String(root.location.search || '') + String(root.location.hash || ''));
    if (!CODIGO_LINK) aplicarMarca();

    estado = estadoInicial();
    // Versões antigas guardavam a conclusão (com dados pessoais) no localStorage: remove.
    apagarStorage(CHAVE_CONCLUIDO);
    var salvo = lerStorage(CHAVE_PROGRESSO);
    if (salvo && (!progressoValido(salvo) || progressoExpirado(salvo))) apagarStorage(CHAVE_PROGRESSO);
    var concluido = lerSessao(CHAVE_CONCLUIDO);
    // Conclusão de outro link (ex.: terminou SEL1 e abriu EQP1 na mesma aba): começa do zero.
    if (concluido && String(concluido.avaliacao || '') !== CODIGO_LINK) { apagarSessao(CHAVE_CONCLUIDO); concluido = null; }
    if (concluido && (concluido.payload || concluido.enviado)) {
      estado.concluido = concluido;
      estado.etapa = 'concluido';
    }
    app.addEventListener('click', aoClicar);
    ligarDicasGlobais();
    ligarDemoGlobal();
    // Tempo por grupo: pausa com a aba escondida e grava o que já passou.
    document.addEventListener('visibilitychange', function () {
      if (!estado) return;
      if (document.hidden) { if (crono) { pararCronometro(); salvar(); } }
      else iniciarCronometro();
    });
    if (PESSOAL) { iniciarPessoal(); return; }
    if (linkMalFormado) { telaLink = 'invalido'; render(false); return; }
    if (CODIGO_LINK) { carregarAvaliacao(); return; }
    render(false);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})(typeof self !== 'undefined' ? self : this);
