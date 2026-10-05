/**
 * Backend do Teste DISC — Google Apps Script vinculado a uma Google Planilha.
 *
 * Como usar (resumo — o passo a passo completo está em docs/BACKEND.md):
 *   1. Na planilha: Extensões > Apps Script, cole este arquivo como Code.gs.
 *   2. Execute a função setup() uma vez e copie a chave de primeiro acesso do registro de execução.
 *   3. Implantar > Nova implantação > App da Web (Executar como: Eu; Quem pode acessar: Qualquer pessoa).
 *   4. Cole a URL (termina em /exec) em js/config.js -> API_URL.
 *   5. No painel (admin.html), em "Primeiro acesso", use a chave uma única vez para criar o seu login.
 *
 * API (POST, corpo JSON em text/plain: {"acao": "...", ...}). Resposta {ok:true, ...} ou {ok:false, erro}.
 *   Públicas:
 *     enviar {payload}                         candidato (payload.avaliacao = código do link, opcional)
 *     avaliacaoPublica {codigo}                dados da avaliação para personalizar o teste
 *     login {email, senha}                     -> {token, usuario}
 *     primeiroAcesso {chave, nome, email, senha}  cria (ou recupera) um login de administrador
 *   Com sessão ({token}; token inválido/expirado -> {ok:false, sessaoExpirada:true}):
 *     eu, sair, trocarSenha {senhaAtual, novaSenha}
 *     listar, atualizar {id, campos}, excluir {id}, excluirTodos {avaliacao?}
 *     empresas.listar | empresas.salvar {empresa} | empresas.excluir {id}            (só admin)
 *     avaliacoes.listar (gestor: só a empresa dele) | avaliacoes.salvar | avaliacoes.excluir (só admin)
 *     usuarios.listar | usuarios.salvar {usuario, senhaTemporaria?} | usuarios.excluir {id}
 *       | usuarios.redefinirSenha {id, senhaTemporaria}                                (só admin)
 *     processos.listar | processos.salvar {processo} | processos.excluir {id}           (só admin;
 *       "avaliacoes.*" continuam valendo como apelido)
 *     clickup.status | clickup.listas | processo.dados {id}                           (só admin; ClickUp.gs)
 *     relatorio.rascunho {processoId} | relatorio.salvar {relatorioToken, relatorio|textos}
 *       | relatorio.publicar {relatorioToken, baseUrl?} | relatorio.despublicar {relatorioToken}
 *       | relatorios.listar {processoId?} | relatorio.melhorarTextos {relatorioToken, ids?}  (só admin; Relatorio.gs)
 *     (o "token" do corpo é sempre o da sessão; o do relatório vai em "relatorioToken")
 *   Pública: relatorioPublico {token} -> {ok, relatorio} (só relatório publicado)
 * GET -> {"ok":true,"servico":"DISC"} (teste de saúde).
 *
 * Arquivos do projeto no Apps Script (todos no mesmo escopo global): Code.gs (este), ClickUp.gs,
 * Relatorio.gs e RelatorioMotor.gs (gerado a partir de js/relatorio-motor.js). Segredos (CLICKUP_TOKEN,
 * ANTHROPIC_API_KEY) ficam só nas Propriedades do script e nunca voltam para o navegador.
 *
 * Papéis: "admin" faz tudo; "gestor" só vê os participantes e as avaliações da própria empresa e só
 * muda status/observações (não exclui nem cria nada).
 *
 * O resultado DISC é SEMPRE recalculado aqui a partir de "respostas" (o campo "resultado"
 * enviado pelo navegador é ignorado). O campo "validacao" do payload só é conferido e guardado:
 * a confiabilidade é calculada no painel.
 *
 * Código do candidato (protocolo): ao gravar um envio, o servidor gera um código curto e único
 * (2 algarismos + 1 letra maiúscula sem I e O, ex.: "47K") e devolve {ok, id, protocolo}.
 */

var NOME_ABA = 'Respostas';
var CABECALHO = ['id', 'recebidoEm', 'nome', 'telefone', 'vaga', 'inicio', 'fim', 'duracaoSeg',
  'respostas', 'D', 'I', 'S', 'C', 'perfil', 'status', 'observacoes', 'payloadJson', 'protocolo',
  'idade', 'funcao', 'empresa', 'avaliacao', 'empresaId'];
var COL = {}; // nome da coluna -> índice (0-based)
CABECALHO.forEach(function (nome, i) { COL[nome] = i; });

var LETRAS = ['D', 'I', 'S', 'C'];
var TOTAL_GRUPOS = 25;
var LIMITE_CORPO = 20000;      // bytes/caracteres aceitos no corpo da requisição
var LIMITE_CORPO_RELATORIO = 450000; // só "relatorio.salvar" (o relatório inteiro volta do painel)
var ACOES_CORPO_GRANDE = ['relatorio.salvar'];
var LIMITE_LINHAS = 500;       // proteção contra abuso (o uso esperado é de poucas dezenas)
var LIMITE_ENVIOS_JANELA = 40; // envios aceitos por janela de tempo (todos os candidatos juntos)
var JANELA_ENVIOS_SEG = 600;   // janela de 10 minutos
var STATUS_VALIDOS = ['em_analise', 'aprovado', 'reprovado'];
var STATUS_PADRAO = 'em_analise';
var COLUNAS_TEXTO = ['id', 'recebidoEm', 'nome', 'telefone', 'vaga', 'inicio', 'fim',
  'respostas', 'perfil', 'status', 'observacoes', 'payloadJson', 'protocolo', 'funcao', 'empresa',
  'avaliacao', 'empresaId'];
var IDADE_MIN = 14;
var IDADE_MAX = 99;
var LIMITE_FUNCAO_EMPRESA = 80;
var LIMITE_VALIDACAO = 4000;   // tamanho máximo (JSON) do objeto "validacao" do payload

// Protocolo: 2 algarismos + 1 letra (sem I e O, que se confundem com 1 e 0) -> 100 × 24 = 2.400 códigos.
var LETRAS_PROTOCOLO = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
var TOTAL_PROTOCOLOS = 100 * LETRAS_PROTOCOLO.length;
var TENTATIVAS_SORTEIO = 40;

// Logins, empresas e avaliações (abas criadas automaticamente).
var TABELAS = {
  Usuarios: {
    cabecalho: ['id', 'email', 'nome', 'papel', 'empresaId', 'hash', 'sal', 'ativo', 'tentativas', 'bloqueadoAte', 'criadoEm'],
    booleanas: ['ativo'],
    numericas: ['tentativas', 'bloqueadoAte']
  },
  Empresas: {
    cabecalho: ['id', 'nome', 'criadaEm'],
    booleanas: [],
    numericas: []
  },
  // Aba "Avaliacoes" = processos seletivos (na interface: "Processos"). As colunas a partir de "empresa"
  // foram acrescentadas depois (planilhas antigas ganham as colunas no fim, sem perder nada).
  Avaliacoes: {
    cabecalho: ['id', 'codigo', 'empresaId', 'nome', 'tipo', 'mostrarResultado', 'ativa', 'criadaEm',
      'empresa', 'vaga', 'cidade', 'consultor', 'contratante', 'periodoInicio', 'periodoFim', 'clickupListId', 'config'],
    booleanas: ['mostrarResultado', 'ativa'],
    numericas: []
  },
  // Relatórios do processo (rascunho ou publicado). Um relatório grande ocupa várias linhas com o mesmo
  // token ("parte" 0, 1, 2…), porque cada célula aceita no máximo 50.000 caracteres.
  Relatorios: {
    cabecalho: ['token', 'processoId', 'status', 'parte', 'json', 'criadoEm', 'publicadoEm', 'atualizadoEm'],
    booleanas: [],
    numericas: ['parte']
  }
};
var PAPEIS = ['admin', 'gestor'];
var TIPOS_AVALIACAO = ['selecao', 'equipe'];
var ALFABETO_CODIGO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // código do link de avaliação (4 caracteres)
var TAMANHO_CODIGO = 4;
var SENHA_MIN = 8;
var SENHA_MAX = 100;
var ITERACOES_HASH = 2000;
var MAX_TENTATIVAS_LOGIN = 5;
var BLOQUEIO_MS = 15 * 60 * 1000;
var VALIDADE_SESSAO_SEG = 6 * 60 * 60; // 6 h (máximo do CacheService); renova a cada uso

var MSG_LOGIN_INVALIDO = 'E-mail ou senha incorretos.';
var MSG_BLOQUEIO = 'Muitas tentativas. Tente de novo em 15 minutos.';
var MSG_SESSAO = 'Sessão expirada. Entre de novo.';
var MSG_SEM_PERMISSAO = 'Sem permissão.';
var MSG_LINK_INATIVO = 'Este link de avaliação não está mais ativo.';
var MSG_LINK_INVALIDO = 'Link inválido ou avaliação encerrada. Fale com quem enviou o link.';

/** Relógio do servidor (substituível nos testes). */
function agora_() { return Date.now(); }

// ---------------------------------------------------------------------------
// Pontos de entrada do Web App
// ---------------------------------------------------------------------------

function doGet() {
  return responder_({ ok: true, servico: 'DISC' });
}

function doPost(e) {
  var resposta;
  try {
    resposta = processarRequisicao_(e && e.postData ? e.postData.contents : '');
  } catch (err) {
    console.error(err);
    resposta = { ok: false, erro: 'Erro interno no servidor. Tente novamente em instantes.' };
  }
  return responder_(resposta);
}

function responder_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Ações que exigem sessão. soAdmin: gestor recebe "Sem permissão.".
 * Cada função recebe (usuario, corpo, token) — usuario já validado (ativo, papel e empresa conferidos).
 */
var ACOES_COM_SESSAO = {
  'eu': { fn: function (u) { return { ok: true, usuario: usuarioPublico_(u, mapaEmpresas_()) }; } },
  'sair': { fn: function (u, c, token) { encerrarSessao_(token); return { ok: true }; } },
  'trocarSenha': { fn: function (u, c, token) { return acaoTrocarSenha_(u, c, token); } },
  'listar': { fn: function (u) { return acaoListar_(u); } },
  'atualizar': { fn: function (u, c) { return acaoAtualizar_(c.id, c.campos, u); } },
  'excluir': { soAdmin: true, fn: function (u, c) { return acaoExcluir_(c.id); } },
  'excluirTodos': { soAdmin: true, fn: function (u, c) { return acaoExcluirTodos_(c.avaliacao); } },
  'empresas.listar': { soAdmin: true, fn: function () { return acaoEmpresasListar_(); } },
  'empresas.salvar': { soAdmin: true, fn: function (u, c) { return acaoEmpresasSalvar_(c.empresa); } },
  'empresas.excluir': { soAdmin: true, fn: function (u, c) { return acaoEmpresasExcluir_(c.id); } },
  'avaliacoes.listar': { fn: function (u) { return acaoAvaliacoesListar_(u); } },
  'avaliacoes.salvar': { soAdmin: true, fn: function (u, c) { return acaoAvaliacoesSalvar_(c.avaliacao); } },
  'avaliacoes.excluir': { soAdmin: true, fn: function (u, c) { return acaoAvaliacoesExcluir_(c.id); } },
  'processos.listar': { soAdmin: true, fn: function () { return acaoProcessosListar_(); } },
  'processos.salvar': { soAdmin: true, fn: function (u, c) { return acaoProcessosSalvar_(c.processo); } },
  'processos.excluir': { soAdmin: true, fn: function (u, c) { return acaoAvaliacoesExcluir_(c.id); } },
  'clickup.status': { soAdmin: true, fn: function () { return acaoClickupStatus_(); } },
  'clickup.listas': { soAdmin: true, fn: function () { return acaoClickupListas_(); } },
  'processo.dados': { soAdmin: true, fn: function (u, c) { return acaoProcessoDados_(c.id); } },
  'relatorio.rascunho': { soAdmin: true, fn: function (u, c) { return acaoRelatorioRascunho_(c.processoId); } },
  'relatorio.salvar': { soAdmin: true, fn: function (u, c) { return acaoRelatorioSalvar_(c); } },
  'relatorio.publicar': { soAdmin: true, fn: function (u, c) { return acaoRelatorioPublicar_(c.relatorioToken, c.baseUrl); } },
  'relatorio.despublicar': { soAdmin: true, fn: function (u, c) { return acaoRelatorioDespublicar_(c.relatorioToken); } },
  'relatorios.listar': { soAdmin: true, fn: function (u, c) { return acaoRelatoriosListar_(c.processoId); } },
  'relatorio.melhorarTextos': { soAdmin: true, fn: function (u, c) { return acaoRelatorioMelhorarTextos_(c.relatorioToken, c.ids); } },
  'usuarios.listar': { soAdmin: true, fn: function () { return acaoUsuariosListar_(); } },
  'usuarios.salvar': { soAdmin: true, fn: function (u, c) { return acaoUsuariosSalvar_(u, c.usuario, c.senhaTemporaria); } },
  'usuarios.excluir': { soAdmin: true, fn: function (u, c) { return acaoUsuariosExcluir_(u, c.id); } },
  'usuarios.redefinirSenha': { soAdmin: true, fn: function (u, c) { return acaoUsuariosRedefinirSenha_(c.id, c.senhaTemporaria); } }
};

/** Lê o corpo bruto, valida e despacha para a ação. Retorna sempre um objeto {ok, ...}. */
function processarRequisicao_(conteudo) {
  conteudo = typeof conteudo === 'string' ? conteudo : '';
  if (!conteudo) return erro_('Requisição vazia.');
  if (conteudo.length > LIMITE_CORPO_RELATORIO) return erro_('Requisição grande demais.');
  // Corpo grande só é lido se for a edição do relatório (conferido de novo depois do JSON.parse).
  if (conteudo.length > LIMITE_CORPO && conteudo.indexOf('"relatorio.salvar"') === -1) return erro_('Requisição grande demais.');

  var corpo;
  try { corpo = JSON.parse(conteudo); } catch (err) { return erro_('JSON inválido.'); }
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) return erro_('Formato de requisição inválido.');

  var acao = corpo.acao;
  // Só a edição do relatório pode mandar um corpo maior; todo o resto continua com o limite pequeno.
  if (conteudo.length > LIMITE_CORPO && ACOES_CORPO_GRANDE.indexOf(acao) === -1) return erro_('Requisição grande demais.');
  if (typeof cuReiniciar_ === 'function') cuReiniciar_(); // cada requisição começa sem leituras do ClickUp guardadas (ClickUp.gs)

  if (acao === 'enviar') return acaoEnviar_(corpo.payload);
  if (acao === 'relatorioPublico') return acaoRelatorioPublico_(corpo.token);
  if (acao === 'avaliacaoPublica') return acaoAvaliacaoPublica_(corpo.codigo);
  if (acao === 'login') return acaoLogin_(corpo.email, corpo.senha);
  if (acao === 'primeiroAcesso') return acaoPrimeiroAcesso_(corpo);

  if (typeof acao !== 'string' || !Object.prototype.hasOwnProperty.call(ACOES_COM_SESSAO, acao)) {
    return erro_('Ação desconhecida.');
  }
  var sessao = validarSessao_(corpo.token);
  if (!sessao.ok) return sessao;
  var regra = ACOES_COM_SESSAO[acao];
  if (regra.soAdmin && sessao.usuario.papel !== 'admin') return erro_(MSG_SEM_PERMISSAO);
  return regra.fn(sessao.usuario, corpo, sessao.token);
}

function erro_(mensagem, extra) {
  var r = { ok: false, erro: mensagem };
  if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) r[k] = extra[k];
  return r;
}

// ---------------------------------------------------------------------------
// Senhas e sessões
// ---------------------------------------------------------------------------

/** Bytes (com sinal, como devolve o Apps Script) -> texto hexadecimal minúsculo. */
function hexDeBytes_(bytes) {
  var s = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = (bytes[i] + 256) % 256;
    s += (b < 16 ? '0' : '') + b.toString(16);
  }
  return s;
}

function sha256Hex_(texto) {
  return hexDeBytes_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, texto, Utilities.Charset.UTF_8));
}

/**
 * Hash da senha: SHA-256 iterado ITERACOES_HASH vezes.
 *   x = sal + senha;  repita 2000×: x = hex(SHA-256(x));  hash = x
 * (O js/api-simulada.js usa exatamente a mesma conta, para a prévia.)
 */
function hashSenha(senha, sal) {
  var x = String(sal) + String(senha);
  for (var i = 0; i < ITERACOES_HASH; i++) x = sha256Hex_(x);
  return x;
}

/** Sal aleatório de 16 bytes (32 caracteres hexadecimais). */
function gerarSal_() {
  return sha256Hex_(Utilities.getUuid() + Utilities.getUuid() + agora_()).substring(0, 32);
}

/** Comparação que não para no primeiro caractere diferente. */
function iguaisSeguro_(a, b) {
  a = String(a); b = String(b);
  var dif = a.length ^ b.length;
  for (var i = 0; i < Math.max(a.length, b.length); i++) dif |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return dif === 0;
}

function senhaConfere_(senha, usuario) {
  if (typeof senha !== 'string' || !senha || senha.length > SENHA_MAX || !usuario.sal || !usuario.hash) return false;
  return iguaisSeguro_(hashSenha(senha, usuario.sal), usuario.hash);
}

/** Regra da senha: de 8 a 100 caracteres. Retorna {ok} ou {ok:false, erro}. */
function validarSenhaNova(senha) {
  if (typeof senha !== 'string' || senha.length < SENHA_MIN) return erro_('A senha precisa ter pelo menos ' + SENHA_MIN + ' caracteres.');
  if (senha.length > SENHA_MAX) return erro_('A senha pode ter no máximo ' + SENHA_MAX + ' caracteres.');
  return { ok: true };
}

function definirSenha_(usuario, senha) {
  usuario.sal = gerarSal_();
  usuario.hash = hashSenha(senha, usuario.sal);
  usuario.tentativas = 0;
  usuario.bloqueadoAte = 0;
}

function normalizarEmail(v) {
  return limparTexto(v, 120).toLowerCase();
}

function emailValido(email) {
  return typeof email === 'string' && email.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function cacheScript_() { return CacheService.getScriptCache(); }

/** Marca da senha guardada na sessão: trocar ou redefinir a senha derruba as sessões antigas. */
function marcaSenha_(usuario) { return String(usuario.hash || '').substring(0, 16); }

function criarSessao_(usuario) {
  var token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '').toLowerCase();
  gravarSessao_(token, usuario);
  return token;
}

function gravarSessao_(token, usuario) {
  cacheScript_().put('sessao_' + token, JSON.stringify({ usuarioId: usuario.id, h: marcaSenha_(usuario) }), VALIDADE_SESSAO_SEG);
}

function encerrarSessao_(token) {
  if (typeof token === 'string' && token) cacheScript_().remove('sessao_' + token);
}

/** Confere o token e devolve {ok, usuario, token} ou o erro de sessão expirada. Renova a validade. */
function validarSessao_(token) {
  var expirada = erro_(MSG_SESSAO, { sessaoExpirada: true });
  if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) return expirada;
  var cache = cacheScript_();
  var bruto = cache.get('sessao_' + token);
  if (!bruto) return expirada;
  var sessao;
  try { sessao = JSON.parse(bruto); } catch (err) { return expirada; }
  var usuario = sessao && buscarPor_(lerTabela_('Usuarios').registros, 'id', sessao.usuarioId);
  if (!usuario || !usuario.ativo || PAPEIS.indexOf(usuario.papel) === -1 || sessao.h !== marcaSenha_(usuario)) {
    cache.remove('sessao_' + token);
    return expirada;
  }
  cache.put('sessao_' + token, bruto, VALIDADE_SESSAO_SEG);
  return { ok: true, usuario: usuario, token: token };
}

function usuarioPublico_(u, empresas) {
  return {
    id: u.id, nome: u.nome, email: u.email, papel: u.papel,
    empresaId: u.papel === 'gestor' ? u.empresaId : '',
    empresaNome: u.papel === 'gestor' ? (empresas[u.empresaId] || '') : ''
  };
}

// ---------------------------------------------------------------------------
// Abas de cadastro (Usuarios, Empresas, Avaliacoes) — leitura e gravação genéricas
// ---------------------------------------------------------------------------

function abaTabela_(nome) {
  var def = TABELAS[nome];
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Script não está vinculado a uma planilha.');
  var aba = ss.getSheetByName(nome);
  if (!aba) aba = ss.insertSheet(nome);
  var textos = def.cabecalho.filter(function (c) { return def.booleanas.indexOf(c) === -1 && def.numericas.indexOf(c) === -1; });
  if (aba.getLastRow() === 0) escreverCabecalho_(aba, def.cabecalho, textos);
  else completarCabecalho_(aba, nome, def.cabecalho, textos);
  return aba;
}

function celulaTexto_(v) {
  if (v instanceof Date) return v.toISOString();
  v = v === null || v === undefined ? '' : String(v);
  return v.charAt(0) === "'" ? v.substring(1) : v;
}

function celulaBooleana_(v) {
  return v === true || /^(true|verdadeiro|sim|1)$/i.test(String(v === null || v === undefined ? '' : v).trim());
}

/** Lê uma aba de cadastro: {aba, def, registros:[{_linha, campo: valor}]} (linhas sem id são ignoradas). */
function lerTabela_(nome) {
  var def = TABELAS[nome];
  var aba = abaTabela_(nome);
  var registros = [];
  var ultima = aba.getLastRow();
  if (ultima >= 2) {
    var valores = aba.getRange(2, 1, ultima - 1, def.cabecalho.length).getValues();
    valores.forEach(function (linha, i) {
      var r = { _linha: i + 2 };
      def.cabecalho.forEach(function (campo, c) {
        if (def.booleanas.indexOf(campo) >= 0) r[campo] = celulaBooleana_(linha[c]);
        else if (def.numericas.indexOf(campo) >= 0) r[campo] = Number(linha[c]) || 0;
        else r[campo] = celulaTexto_(linha[c]);
      });
      if (String(r[def.cabecalho[0]]).trim()) registros.push(r); // linha sem a 1ª coluna (id/token) é ignorada
    });
  }
  return { nome: nome, aba: aba, def: def, registros: registros };
}

/** Grava o registro (na linha dele, ou no fim se for novo), protegido contra fórmulas. */
function gravarRegistro_(tabela, reg) {
  var def = tabela.def;
  var linha = def.cabecalho.map(function (campo) {
    var v = reg[campo];
    if (def.booleanas.indexOf(campo) >= 0) return v === true;
    if (def.numericas.indexOf(campo) >= 0) return Number(v) || 0;
    return forcarTexto(v === null || v === undefined ? '' : String(v));
  });
  if (reg._linha) {
    tabela.aba.getRange(reg._linha, 1, 1, linha.length).setValues([linha]);
  } else {
    tabela.aba.appendRow(linha);
    reg._linha = tabela.aba.getLastRow();
    tabela.registros.push(reg);
  }
  return reg;
}

function excluirRegistro_(tabela, reg) {
  tabela.aba.deleteRow(reg._linha);
}

function buscarPor_(registros, campo, valor) {
  for (var i = 0; i < registros.length; i++) if (registros[i][campo] === valor) return registros[i];
  return null;
}

function novoId_(prefixo) {
  return prefixo + '_' + Utilities.getUuid().replace(/-/g, '').substring(0, 12).toLowerCase();
}

function mapaEmpresas_() {
  var mapa = {};
  lerTabela_('Empresas').registros.forEach(function (e) { mapa[e.id] = e.nome; });
  return mapa;
}

function letrasContadas_(texto) { return (String(texto).match(/\p{L}/gu) || []).length; }

// ---------------------------------------------------------------------------
// Regras de negócio puras (sem serviços do Google) — testáveis no Node
// ---------------------------------------------------------------------------

/** Mesma regra de js/scoring.js: 100 dígitos, cada bloco de 4 é permutação de 1..4. */
function validarRespostasCompactas(str) {
  if (typeof str !== 'string' || !/^[1-4]{100}$/.test(str)) return false;
  for (var i = 0; i < TOTAL_GRUPOS; i++) {
    var bloco = str.substr(i * 4, 4);
    var vistos = {};
    for (var j = 0; j < 4; j++) {
      if (vistos[bloco[j]]) return false;
      vistos[bloco[j]] = true;
    }
  }
  return true;
}

/** Recalcula totais, percentuais (total/2.5) e perfil (maior + segundo maior; empate na ordem D,I,S,C). */
function calcularDisc(str) {
  if (!validarRespostasCompactas(str)) throw new Error('Respostas inválidas.');
  var totais = { D: 0, I: 0, S: 0, C: 0 };
  for (var i = 0; i < TOTAL_GRUPOS; i++) {
    for (var j = 0; j < 4; j++) totais[LETRAS[j]] += Number(str[i * 4 + j]);
  }
  var percentuais = {};
  LETRAS.forEach(function (l) { percentuais[l] = Math.round((totais[l] / 2.5) * 10) / 10; });
  var ordem = LETRAS.slice().sort(function (a, b) {
    return (totais[b] - totais[a]) || (LETRAS.indexOf(a) - LETRAS.indexOf(b));
  });
  return {
    totais: totais,
    percentuais: percentuais,
    ordem: ordem,
    primario: ordem[0],
    secundario: ordem[1],
    codigo: ordem[0] + ordem[1]
  };
}

/** Remove caracteres de controle, junta espaços repetidos, apara e corta no limite. */
function limparTexto(v, max) {
  if (v === null || v === undefined) return '';
  var s = String(v).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
  if (max && s.length > max) s = s.substring(0, max).trim();
  return s;
}

/** Texto multilinha (observações): mantém quebras de linha, remove outros controles. */
function limparTextoLongo(v, max) {
  if (v === null || v === undefined) return '';
  var s = String(v).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, ' ').trim();
  if (max && s.length > max) s = s.substring(0, max).trim();
  return s;
}

/** Evita injeção de fórmula na planilha: valores começando com = + - @ recebem apóstrofo. */
function protegerCelula(v) {
  if (typeof v !== 'string') return v;
  return /^[=+\-@\t\r]/.test(v) ? "'" + v : v;
}

/** Telefone: só dígitos; 10/11 (DDD + número) -> prefixa 55; 12/13 começando com 55 é aceito. */
function normalizarTelefone(v) {
  var d = String(v === null || v === undefined ? '' : v).replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) return '55' + d;
  if ((d.length === 12 || d.length === 13) && d.indexOf('55') === 0) return d;
  return '';
}

function nomeValido(nome) {
  // Mesmo critério do app (js/app.js): qualquer letra Unicode conta.
  var palavras = nome.split(' ').filter(function (p) { return /\p{L}/u.test(p); });
  var letras = (nome.match(/\p{L}/gu) || []).length;
  return palavras.length >= 2 && letras >= 5;
}

/**
 * Idade: inteiro de 14 a 99 (número ou texto só com dígitos).
 * Retorna { ok:true, idade } ou { ok:false, erro } com mensagem em pt-BR.
 */
function validarIdadeServidor(v) {
  if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) {
    return erro_('Idade não informada: a idade é obrigatória (só números, de 14 a 99 anos).');
  }
  var s = typeof v === 'number' ? String(v) : (typeof v === 'string' ? v.trim() : '');
  if (!/^[0-9]{1,3}$/.test(s)) return erro_('Idade inválida: use só números (entre 14 e 99 anos).');
  var n = Number(s);
  if (n < IDADE_MIN || n > IDADE_MAX) return erro_('Idade inválida: precisa ser entre 14 e 99 anos.');
  return { ok: true, idade: n };
}

/** Lê a idade gravada na planilha (número, texto ou vazio). null quando não há idade válida. */
function idadeDaCelula(v) {
  if (v === null || v === undefined || v === '') return null;
  var n = Number(String(v).replace(/^'/, '').trim());
  return (isFinite(n) && Math.floor(n) === n && n >= IDADE_MIN && n <= IDADE_MAX) ? n : null;
}

function dataIsoOuVazio(v) {
  var s = limparTexto(v, 40);
  if (!s) return '';
  var t = Date.parse(s);
  return isNaN(t) ? '' : new Date(t).toISOString();
}

/**
 * Valida e normaliza o payload do candidato.
 * Retorna { ok:true, payload } (payload limpo, com resultado recalculado) ou { ok:false, erro }.
 */
function validarPayload(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return erro_('Dados do teste ausentes.');

  var id = limparTexto(p.id, 80);
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(id)) return erro_('Identificador do envio inválido.');

  var nome = limparTexto(p.nome, 120);
  if (!nomeValido(nome)) return erro_('Informe o nome completo (nome e sobrenome).');

  var telefone = normalizarTelefone(p.telefone);
  if (!telefone) return erro_('Telefone inválido. Informe DDD + número.');

  var idade = validarIdadeServidor(p.idade);
  if (!idade.ok) return idade;

  if (p.consentimento !== true) return erro_('É necessário aceitar o uso dos dados para participar.');

  var respostas = typeof p.respostas === 'string' ? p.respostas.trim() : '';
  if (!validarRespostasCompactas(respostas)) return erro_('Respostas do teste inválidas ou incompletas.');

  // Código do link de avaliação (opcional). Se vier, precisa ter o formato certo; a existência e se
  // está ativa são conferidas na hora de gravar.
  var avaliacao = '';
  if (p.avaliacao !== undefined && p.avaliacao !== null && String(p.avaliacao).trim() !== '') {
    avaliacao = normalizarCodigoAvaliacao(p.avaliacao);
    if (!avaliacao) return erro_(MSG_LINK_INATIVO);
  }

  var validacao = validarValidacao(p.validacao);
  if (!validacao.ok) return validacao;

  var resultado = calcularDisc(respostas);
  var inicio = dataIsoOuVazio(p.inicio);
  var fim = dataIsoOuVazio(p.fim);
  var duracao = Number(p.duracaoSeg);
  if (!isFinite(duracao) || duracao < 0 || duracao > 7 * 86400) {
    duracao = (inicio && fim) ? Math.max(0, Math.round((Date.parse(fim) - Date.parse(inicio)) / 1000)) : 0;
  }

  return {
    ok: true,
    payload: {
      v: 1,
      id: id,
      nome: nome,
      telefone: telefone,
      idade: idade.idade,
      funcao: limparTexto(p.funcao, LIMITE_FUNCAO_EMPRESA),
      empresa: limparTexto(p.empresa, LIMITE_FUNCAO_EMPRESA),
      vaga: limparTexto(p.vaga, 120),
      consentimento: true,
      inicio: inicio,
      fim: fim,
      duracaoSeg: Math.round(duracao),
      respostas: respostas,
      resultado: { percentuais: resultado.percentuais, codigo: resultado.codigo },
      avaliacao: avaliacao,
      validacao: validacao.validacao
    }
  };
}

/** Protocolo no formato do contrato: 2 algarismos + 1 letra maiúscula sem I/O (ex.: "47K"). */
function protocoloValido(v) {
  return typeof v === 'string' && /^[0-9]{2}[A-HJ-NP-Z]$/.test(v);
}

/** Normaliza o que veio da planilha ou foi digitado: tira apóstrofo e espaços, deixa maiúsculo. '' se inválido. */
function normalizarProtocolo(v) {
  if (v === null || v === undefined) return '';
  var s = String(v).replace(/^'/, '').replace(/\s+/g, '').toUpperCase();
  return protocoloValido(s) ? s : '';
}

/** Protocolo de índice n (0..TOTAL_PROTOCOLOS-1): "00A", "00B", … "99Z". */
function protocoloPorIndice_(n) {
  var numero = Math.floor(n / LETRAS_PROTOCOLO.length);
  return (numero < 10 ? '0' : '') + numero + LETRAS_PROTOCOLO.charAt(n % LETRAS_PROTOCOLO.length);
}

/**
 * Sorteia um protocolo que não está em "usados" (lista ou mapa {codigo:true}).
 * Tenta alguns sorteios; se a planilha estiver quase cheia, sorteia entre os códigos livres
 * (assim sempre acha o último livre). Sem nenhum livre, lança erro em pt-BR.
 * "aleatorio" é opcional (função 0..1, como Math.random) para testes.
 */
function gerarProtocolo(usados, aleatorio) {
  var rnd = typeof aleatorio === 'function' ? aleatorio : Math.random;
  var mapa = {};
  if (Array.isArray(usados)) usados.forEach(function (u) { var p = normalizarProtocolo(u); if (p) mapa[p] = true; });
  else if (usados) for (var k in usados) if (Object.prototype.hasOwnProperty.call(usados, k) && usados[k]) mapa[k] = true;

  function sorteio(max) { return Math.min(max - 1, Math.floor(rnd() * max)); }
  for (var t = 0; t < TENTATIVAS_SORTEIO; t++) {
    var p = protocoloPorIndice_(sorteio(TOTAL_PROTOCOLOS));
    if (!mapa[p]) return p;
  }
  var livres = [];
  for (var i = 0; i < TOTAL_PROTOCOLOS; i++) {
    var c = protocoloPorIndice_(i);
    if (!mapa[c]) livres.push(c);
  }
  if (!livres.length) {
    throw new Error('Limite de códigos atingido: todos os ' + TOTAL_PROTOCOLOS + ' códigos estão em uso. ' +
      'Exclua candidatos antigos ou de teste no painel e tente de novo.');
  }
  return livres[sorteio(livres.length)];
}

/**
 * Confere o formato básico do objeto "validacao" (etapa de confirmação do participante) e devolve
 * uma cópia limpa só com os campos conhecidos. Não recalcula nada: a confiabilidade sai no painel.
 * Ausente (payload antigo) -> {ok:true, validacao:null}.
 */
function validarValidacao(v) {
  if (v === undefined || v === null) return { ok: true, validacao: null };
  var falha = erro_('Dados da etapa de validação inválidos.');
  if (typeof v !== 'object' || Array.isArray(v)) return falha;
  var json;
  try { json = JSON.stringify(v); } catch (err) { return falha; }
  if (!json || json.length > LIMITE_VALIDACAO) return falha;

  function letra(x) { return typeof x === 'string' && LETRAS.indexOf(x) >= 0; }
  function inteiro(x, min, max) { return typeof x === 'number' && isFinite(x) && Math.floor(x) === x && x >= min && x <= max; }
  function lista(x, max) { return Array.isArray(x) && x.length <= max; }

  if (!inteiro(v.versao, 1, 99)) return falha;
  if (!lista(v.pares, 3) || !lista(v.escolhas, 3) || !lista(v.itens, 8) || !lista(v.gruposSeg, TOTAL_GRUPOS)) return falha;
  for (var i = 0; i < v.pares.length; i++) {
    var par = v.pares[i];
    if (!Array.isArray(par) || par.length !== 2 || !letra(par[0]) || !letra(par[1])) return falha;
  }
  for (i = 0; i < v.escolhas.length; i++) if (!letra(v.escolhas[i])) return falha;
  var itens = [];
  for (i = 0; i < v.itens.length; i++) {
    var it = v.itens[i];
    if (!it || typeof it !== 'object' || Array.isArray(it)) return falha;
    if (typeof it.id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(it.id)) return falha;
    if (!letra(it.letra) || ['forca', 'sombra', 'contraste'].indexOf(it.tipo) === -1 || !inteiro(it.nota, 1, 5)) return falha;
    itens.push({ id: it.id, letra: it.letra, tipo: it.tipo, nota: it.nota });
  }
  for (i = 0; i < v.gruposSeg.length; i++) {
    var s = v.gruposSeg[i];
    if (typeof s !== 'number' || !isFinite(s) || s < 0 || s > 86400) return falha;
  }
  if (!inteiro(v.semMexer, 0, TOTAL_GRUPOS)) return falha;
  if (v.demonstracao !== undefined && typeof v.demonstracao !== 'boolean') return falha;

  return {
    ok: true,
    validacao: {
      versao: v.versao,
      pares: v.pares.map(function (p) { return [p[0], p[1]]; }),
      escolhas: v.escolhas.slice(),
      itens: itens,
      gruposSeg: v.gruposSeg.map(function (n) { return Math.round(n * 10) / 10; }),
      semMexer: v.semMexer,
      demonstracao: v.demonstracao === true
    }
  };
}

/**
 * Código do link de avaliação: 4 letras/algarismos (A-Z, 0-9). Os códigos novos são sorteados só de
 * ALFABETO_CODIGO (sem I, O, 0 e 1), mas qualquer A-Z/0-9 é aceito. Aceita minúsculas/espaços. '' se inválido.
 */
function normalizarCodigoAvaliacao(v) {
  if (v === null || v === undefined) return '';
  var s = String(v).replace(/^'/, '').replace(/\s+/g, '').toUpperCase();
  return /^[A-Z0-9]{4}$/.test(s) ? s : '';
}

/** Sorteia um código de avaliação que não está em "usados" ({codigo:true}). */
function gerarCodigoAvaliacao(usados, aleatorio) {
  var rnd = typeof aleatorio === 'function' ? aleatorio : Math.random;
  for (var t = 0; t < 200; t++) {
    var c = '';
    for (var i = 0; i < TAMANHO_CODIGO; i++) c += ALFABETO_CODIGO.charAt(Math.min(ALFABETO_CODIGO.length - 1, Math.floor(rnd() * ALFABETO_CODIGO.length)));
    if (!usados || !usados[c]) return c;
  }
  throw new Error('Não foi possível gerar um código novo. Tente de novo.');
}

/** Monta a linha da planilha (na ordem de CABECALHO), já protegida contra fórmulas. */
function montarLinha(payload, recebidoEm, protocolo) {
  var r = calcularDisc(payload.respostas);
  var linha = [];
  linha[COL.id] = payload.id;
  linha[COL.recebidoEm] = recebidoEm;
  linha[COL.nome] = payload.nome;
  linha[COL.telefone] = payload.telefone;
  linha[COL.vaga] = payload.vaga;
  linha[COL.inicio] = payload.inicio;
  linha[COL.fim] = payload.fim;
  linha[COL.duracaoSeg] = payload.duracaoSeg;
  linha[COL.respostas] = payload.respostas;
  linha[COL.D] = r.percentuais.D;
  linha[COL.I] = r.percentuais.I;
  linha[COL.S] = r.percentuais.S;
  linha[COL.C] = r.percentuais.C;
  linha[COL.perfil] = r.codigo;
  linha[COL.status] = STATUS_PADRAO;
  linha[COL.observacoes] = '';
  linha[COL.payloadJson] = JSON.stringify(payload);
  linha[COL.protocolo] = normalizarProtocolo(protocolo);
  linha[COL.idade] = payload.idade;
  linha[COL.funcao] = payload.funcao || '';
  linha[COL.empresa] = payload.empresa || '';
  linha[COL.avaliacao] = payload.avaliacao || '';
  linha[COL.empresaId] = payload.empresaId || '';
  return linha.map(function (v, i) {
    return COLUNAS_TEXTO.indexOf(CABECALHO[i]) >= 0 ? forcarTexto(v) : protegerCelula(v);
  });
}

/**
 * Para colunas de texto: além da proteção contra fórmulas, valores que começam com dígito
 * (telefone, respostas, datas ISO) recebem apóstrofo para o Sheets não convertê-los em número/data.
 */
function forcarTexto(v) {
  if (typeof v !== 'string') return v;
  return /^[=+\-@\t\r0-9]/.test(v) ? "'" + v : v;
}

/** Converte uma linha lida da planilha no item retornado por "listar". */
function linhaParaItem(linha) {
  function txt(nome) { return celulaTexto_(linha[COL[nome]]); }
  var base = {};
  try { base = JSON.parse(txt('payloadJson')) || {}; } catch (err) { base = {}; }

  var respostas = txt('respostas').replace(/\D/g, '');
  var item = {
    v: 1,
    id: txt('id'),
    nome: txt('nome'),
    telefone: txt('telefone').replace(/\D/g, ''),
    vaga: txt('vaga'),
    consentimento: base.consentimento === true,
    inicio: txt('inicio'),
    fim: txt('fim'),
    duracaoSeg: Number(linha[COL.duracaoSeg]) || 0,
    respostas: respostas,
    resultado: null,
    status: STATUS_VALIDOS.indexOf(txt('status')) >= 0 ? txt('status') : STATUS_PADRAO,
    observacoes: txt('observacoes'),
    recebidoEm: txt('recebidoEm'),
    protocolo: normalizarProtocolo(txt('protocolo')),
    idade: idadeDaCelula(linha[COL.idade]),   // null em linhas antigas (sem a coluna)
    funcao: txt('funcao'),
    empresa: txt('empresa'),
    avaliacao: normalizarCodigoAvaliacao(txt('avaliacao')),
    empresaId: txt('empresaId'),
    validacao: (base.validacao && typeof base.validacao === 'object' && !Array.isArray(base.validacao)) ? base.validacao : null
  };
  if (validarRespostasCompactas(respostas)) {
    var r = calcularDisc(respostas);
    item.resultado = { percentuais: r.percentuais, codigo: r.codigo };
  }
  return item;
}

// ---------------------------------------------------------------------------
// Acesso à planilha (aba Respostas)
// ---------------------------------------------------------------------------

function obterAba_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Script não está vinculado a uma planilha.');
  var aba = ss.getSheetByName(NOME_ABA);
  if (!aba) {
    aba = ss.insertSheet(NOME_ABA);
    prepararAba_(aba);
  } else if (aba.getLastRow() === 0) {
    prepararAba_(aba);
  } else {
    garantirColunas_(aba);
  }
  return aba;
}

/**
 * Planilhas criadas antes de uma coluna existir (ex.: "protocolo", "idade", "avaliacao"): escreve o nome
 * que falta no cabeçalho e deixa a coluna em formato texto. As linhas antigas ficam com a célula vazia.
 */
function garantirColunas_(aba) {
  completarCabecalho_(aba, NOME_ABA, CABECALHO, COLUNAS_TEXTO);
}

function prepararAba_(aba) {
  escreverCabecalho_(aba, CABECALHO, COLUNAS_TEXTO);
}

/** Aba vazia: escreve o cabeçalho, congela a linha 1 e põe as colunas de texto em "texto simples". */
function escreverCabecalho_(aba, cabecalho, textos) {
  garantirLargura_(aba, cabecalho.length);
  aba.getRange(1, 1, 1, cabecalho.length).setValues([cabecalho]).setFontWeight('bold');
  aba.setFrozenRows(1);
  // Formato "texto simples" para o Sheets não converter telefone, respostas (100 dígitos) e datas ISO.
  cabecalho.forEach(function (nome, i) {
    if (textos.indexOf(nome) >= 0) aba.getRange(1, i + 1, aba.getMaxRows(), 1).setNumberFormat('@');
  });
}

/** Aba com dados: acrescenta no fim as colunas que faltam; recusa cabeçalho diferente do esperado. */
function completarCabecalho_(aba, nomeAba, cabecalho, textos) {
  garantirLargura_(aba, cabecalho.length);
  var cab = aba.getRange(1, 1, 1, cabecalho.length).getValues()[0];
  cabecalho.forEach(function (nome, i) {
    var atual = String(cab[i] === undefined || cab[i] === null ? '' : cab[i]).trim();
    if (atual === nome) return;
    if (atual !== '') {
      throw new Error('Cabeçalho da aba "' + nomeAba + '" diferente do esperado na coluna ' + (i + 1) +
        ' ("' + cab[i] + '" em vez de "' + nome + '").');
    }
    aba.getRange(1, i + 1).setValue(nome).setFontWeight('bold');
    if (textos.indexOf(nome) >= 0) aba.getRange(1, i + 1, aba.getMaxRows(), 1).setNumberFormat('@');
  });
}

/** Garante que a aba tem colunas físicas suficientes (getRange fora da aba lança erro no Apps Script). */
function garantirLargura_(aba, total) {
  total = total || CABECALHO.length;
  var max = aba.getMaxColumns();
  if (max < total) aba.insertColumnsAfter(max, total - max);
}

/** Valores de uma coluna da aba Respostas (sem o cabeçalho). */
function colunaRespostas_(aba, nome) {
  var ultima = aba.getLastRow();
  if (ultima < 2) return [];
  return aba.getRange(2, COL[nome] + 1, ultima - 1, 1).getValues().map(function (l) { return l[0]; });
}

/** Protocolos já gravados na planilha, como mapa {codigo: true}. */
function protocolosUsados_(aba) {
  var usados = {};
  colunaRespostas_(aba, 'protocolo').forEach(function (v) {
    var p = normalizarProtocolo(v);
    if (p) usados[p] = true;
  });
  return usados;
}

/** Quantidade de respostas por código de avaliação: {SEL1: 3, ...}. */
function respostasPorAvaliacao_() {
  var mapa = {};
  colunaRespostas_(obterAba_(), 'avaliacao').forEach(function (v) {
    var c = normalizarCodigoAvaliacao(celulaTexto_(v));
    if (c) mapa[c] = (mapa[c] || 0) + 1;
  });
  return mapa;
}

/** Índice da linha (1-based na planilha) do id, ou -1. */
function localizarLinha_(aba, id) {
  var ids = colunaRespostas_(aba, 'id');
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i]) === id) return i + 2;
  }
  return -1;
}

/**
 * Limitador global de envios (CacheService): impede que alguém encha a planilha com
 * envios falsos em sequência. Retorna true se o envio pode seguir.
 * Deve ser chamado dentro de comTrava_ para o contador não perder incrementos.
 */
function permitirEnvio_() {
  if (typeof CacheService === 'undefined') return true;
  var cache = CacheService.getScriptCache();
  var janela = Math.floor(Date.now() / (JANELA_ENVIOS_SEG * 1000));
  var chave = 'envios_' + janela;
  var atual = Number(cache.get(chave)) || 0;
  if (atual >= LIMITE_ENVIOS_JANELA) return false;
  cache.put(chave, String(atual + 1), JANELA_ENVIOS_SEG + 60);
  return true;
}

function comTrava_(fn) {
  var trava = LockService.getScriptLock();
  if (!trava.tryLock(15000)) return erro_('Servidor ocupado. Tente novamente em alguns segundos.');
  try { return fn(); } finally { trava.releaseLock(); }
}

// ---------------------------------------------------------------------------
// Ações públicas
// ---------------------------------------------------------------------------

function acaoEnviar_(payloadBruto) {
  var v = validarPayload(payloadBruto);
  if (!v.ok) return v;
  var payload = v.payload;
  var processo = null; // processo (avaliação) do link, para a cópia no ClickUp depois de gravar

  var r = comTrava_(function () {
    var aba = obterAba_();
    var existente = localizarLinha_(aba, payload.id);
    if (existente !== -1) {
      // Reenvio (ex.: o candidato tocou de novo em Enviar): devolve o mesmo código já gravado.
      var celula = aba.getRange(existente, COL.protocolo + 1);
      var gravado = normalizarProtocolo(celula.getValues()[0][0]);
      if (!gravado) {
        // Linha de antes do protocolo existir: ganha um código agora.
        try { gravado = gerarProtocolo(protocolosUsados_(aba)); } catch (err) { return erro_(err.message); }
        celula.setValue(forcarTexto(gravado));
      }
      return { ok: true, duplicado: true, id: payload.id, protocolo: gravado };
    }
    payload.empresaId = '';
    if (payload.avaliacao) {
      var av = buscarPor_(lerTabela_('Avaliacoes').registros, 'codigo', payload.avaliacao);
      if (!av || !av.ativa) return erro_(MSG_LINK_INATIVO);
      payload.empresaId = av.empresaId;
      processo = av;
    }
    if (aba.getLastRow() - 1 >= LIMITE_LINHAS) {
      return erro_('Limite de respostas atingido. Avise o recrutador.');
    }
    var protocolo;
    try { protocolo = gerarProtocolo(protocolosUsados_(aba)); } catch (err) { return erro_(err.message); }
    if (!permitirEnvio_()) {
      return erro_('Muitos envios em pouco tempo. Aguarde alguns minutos e tente novamente.');
    }
    aba.appendRow(montarLinha(payload, new Date().toISOString(), protocolo));
    return { ok: true, id: payload.id, protocolo: protocolo };
  });
  // Fora da trava: copia o resultado para a tarefa do candidato no ClickUp. Qualquer falha vira só
  // um aviso (registro de execução + clickup.status): o candidato conclui o teste de qualquer jeito.
  if (r.ok && !r.duplicado && processo && processo.clickupListId && typeof cuSincronizarEnvio === 'function') {
    try {
      cuSincronizarEnvio(processo, payload, r.protocolo);
    } catch (err) {
      try { cuRegistrarAviso_('Envio ' + r.protocolo + ': não foi possível gravar no ClickUp (' + err.message + ').'); } catch (e2) { /* nunca derruba o envio */ }
    }
  }
  return r;
}

function acaoAvaliacaoPublica_(codigoBruto) {
  var codigo = normalizarCodigoAvaliacao(codigoBruto);
  if (!codigo) return erro_(MSG_LINK_INVALIDO);
  var av = buscarPor_(lerTabela_('Avaliacoes').registros, 'codigo', codigo);
  if (!av || !av.ativa) return erro_(MSG_LINK_INVALIDO);
  return {
    ok: true,
    avaliacao: {
      codigo: av.codigo, nome: av.nome, tipo: av.tipo,
      empresaNome: mapaEmpresas_()[av.empresaId] || av.empresa || '',
      mostrarResultado: av.mostrarResultado === true
    }
  };
}

function acaoLogin_(emailBruto, senha) {
  var email = normalizarEmail(emailBruto);
  if (!email || typeof senha !== 'string' || !senha) return erro_('Informe o e-mail e a senha.');
  var r = comTrava_(function () {
    var tabela = lerTabela_('Usuarios');
    var u = buscarPor_(tabela.registros, 'email', email);
    if (!u || !u.ativo) {
      hashSenha(senha.substring(0, SENHA_MAX), 'sal-falso-para-gastar-o-mesmo-tempo'); // mesmo custo: não revela se o e-mail existe
      return falhaEmailDesconhecido_(email);
    }
    var agora = agora_();
    if (u.bloqueadoAte && u.bloqueadoAte > agora) return erro_(MSG_BLOQUEIO, { bloqueado: true });
    if (!senhaConfere_(senha, u)) {
      u.tentativas = (u.tentativas || 0) + 1;
      if (u.tentativas >= MAX_TENTATIVAS_LOGIN) {
        u.tentativas = 0;
        u.bloqueadoAte = agora + BLOQUEIO_MS;
        gravarRegistro_(tabela, u);
        return erro_(MSG_BLOQUEIO, { bloqueado: true });
      }
      gravarRegistro_(tabela, u);
      return erro_(MSG_LOGIN_INVALIDO);
    }
    if (u.tentativas || u.bloqueadoAte) {
      u.tentativas = 0;
      u.bloqueadoAte = 0;
      gravarRegistro_(tabela, u);
    }
    return { ok: true, token: criarSessao_(u), usuario: usuarioPublico_(u, mapaEmpresas_()) };
  });
  if (!r.ok && r.erro === MSG_LOGIN_INVALIDO) Utilities.sleep(400); // dificulta tentativas em massa
  return r;
}

/**
 * E-mail inexistente (ou de usuário desativado): conta as tentativas como se a conta existisse e,
 * na 5ª, responde com a mesma mensagem de bloqueio por 15 minutos. Assim nem a mensagem nem o
 * bloqueio revelam se o e-mail está cadastrado. Fica só no CacheService (nada é gravado na planilha).
 */
function falhaEmailDesconhecido_(email) {
  var cache = cacheScript_();
  var chave = 'login_falha_' + sha256Hex_('falha:' + email).substring(0, 40);
  var reg;
  try { reg = JSON.parse(cache.get(chave) || '{}') || {}; } catch (err) { reg = {}; }
  var agora = agora_();
  if (reg.ate && reg.ate > agora) return erro_(MSG_BLOQUEIO, { bloqueado: true });
  if (reg.ate) { reg.n = 0; reg.ate = 0; }
  reg.n = (Number(reg.n) || 0) + 1;
  var resposta = erro_(MSG_LOGIN_INVALIDO);
  if (reg.n >= MAX_TENTATIVAS_LOGIN) {
    reg.n = 0;
    reg.ate = agora + BLOQUEIO_MS;
    resposta = erro_(MSG_BLOQUEIO, { bloqueado: true });
  }
  cache.put(chave, JSON.stringify(reg), VALIDADE_SESSAO_SEG);
  return resposta;
}

/**
 * Primeiro acesso / recuperação: com a ADMIN_KEY (Script Properties) cria um login de administrador.
 * Se o e-mail já for de um administrador, redefine a senha dele (e reativa/desbloqueia).
 */
function acaoPrimeiroAcesso_(corpo) {
  var esperada = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY');
  if (!esperada) {
    return erro_('A chave de primeiro acesso ainda não foi configurada. No editor do Apps Script, ' +
      'selecione a função "setup" e clique em Executar; depois copie a chave exibida no registro de execução.');
  }
  var chave = corpo.chave;
  if (typeof chave !== 'string' || !chave || !iguaisSeguro_(chave.trim(), esperada)) {
    Utilities.sleep(400);
    return erro_('Chave de primeiro acesso inválida.', { naoAutorizado: true });
  }
  var nome = limparTexto(corpo.nome, 80);
  if (letrasContadas_(nome) < 2) return erro_('Informe o seu nome.');
  var email = normalizarEmail(corpo.email);
  if (!emailValido(email)) return erro_('E-mail inválido.');
  var s = validarSenhaNova(corpo.senha);
  if (!s.ok) return s;

  return comTrava_(function () {
    var tabela = lerTabela_('Usuarios');
    var u = buscarPor_(tabela.registros, 'email', email);
    var redefinida = false;
    if (u) {
      if (u.papel !== 'admin') return erro_('Este e-mail já é usado por um gestor. Use outro e-mail.');
      redefinida = true;
      u.nome = nome;
      u.ativo = true;
    } else {
      u = { id: novoId_('usr'), email: email, nome: nome, papel: 'admin', empresaId: '', ativo: true, criadoEm: new Date(agora_()).toISOString() };
    }
    definirSenha_(u, corpo.senha);
    gravarRegistro_(tabela, u);
    return { ok: true, redefinida: redefinida, token: criarSessao_(u), usuario: usuarioPublico_(u, mapaEmpresas_()) };
  });
}

// ---------------------------------------------------------------------------
// Ações com sessão — conta
// ---------------------------------------------------------------------------

function acaoTrocarSenha_(usuario, corpo, token) {
  var s = validarSenhaNova(corpo.novaSenha);
  if (!s.ok) return s;
  return comTrava_(function () {
    var tabela = lerTabela_('Usuarios');
    var u = buscarPor_(tabela.registros, 'id', usuario.id);
    if (!u) return erro_(MSG_SESSAO, { sessaoExpirada: true });
    if (!senhaConfere_(corpo.senhaAtual, u)) return erro_('Senha atual incorreta.');
    definirSenha_(u, corpo.novaSenha);
    gravarRegistro_(tabela, u);
    gravarSessao_(token, u); // esta sessão continua valendo; as outras caem
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// Ações com sessão — participantes (aba Respostas)
// ---------------------------------------------------------------------------

function podeVerEmpresa_(usuario, empresaId) {
  if (usuario.papel === 'admin') return true;
  return !!usuario.empresaId && empresaId === usuario.empresaId;
}

function acaoListar_(usuario) {
  var aba = obterAba_();
  var ultima = aba.getLastRow();
  if (ultima < 2) return { ok: true, itens: [] };
  var linhas = aba.getRange(2, 1, ultima - 1, CABECALHO.length).getValues();
  var empresas = mapaEmpresas_();
  var avaliacoes = {};
  lerTabela_('Avaliacoes').registros.forEach(function (a) { avaliacoes[a.codigo] = a; });
  var itens = [];
  linhas.forEach(function (linha) {
    if (!String(linha[COL.id] || '').trim()) return;
    var item = linhaParaItem(linha);
    if (!podeVerEmpresa_(usuario, item.empresaId)) return;
    var av = avaliacoes[item.avaliacao];
    item.empresaNome = empresas[item.empresaId] || '';
    item.avaliacaoNome = av ? av.nome : '';
    item.avaliacaoTipo = av ? av.tipo : 'selecao'; // sem código = processo seletivo geral
    itens.push(item);
  });
  return { ok: true, itens: itens };
}

function acaoAtualizar_(idBruto, campos, usuario) {
  var id = limparTexto(idBruto, 80);
  if (!id) return erro_('Informe o id do candidato.');
  if (!campos || typeof campos !== 'object') return erro_('Nada para atualizar.');

  var novoStatus = null, novasObs = null;
  if (campos.status !== undefined) {
    novoStatus = limparTexto(campos.status, 20);
    if (STATUS_VALIDOS.indexOf(novoStatus) === -1) return erro_('Status inválido. Use: aprovado, reprovado ou em_analise.');
  }
  if (campos.observacoes !== undefined) novasObs = limparTextoLongo(campos.observacoes, 5000);
  if (novoStatus === null && novasObs === null) return erro_('Nada para atualizar.');

  return comTrava_(function () {
    var aba = obterAba_();
    var linha = localizarLinha_(aba, id);
    if (linha === -1) return erro_('Candidato não encontrado.');
    if (usuario && usuario.papel !== 'admin') {
      var empresaId = celulaTexto_(aba.getRange(linha, COL.empresaId + 1).getValues()[0][0]);
      if (!podeVerEmpresa_(usuario, empresaId)) return erro_(MSG_SEM_PERMISSAO);
    }
    if (novoStatus !== null) aba.getRange(linha, COL.status + 1).setValue(novoStatus);
    if (novasObs !== null) aba.getRange(linha, COL.observacoes + 1).setValue(protegerCelula(novasObs));
    return { ok: true, id: id };
  });
}

function acaoExcluir_(idBruto) {
  var id = limparTexto(idBruto, 80);
  if (!id) return erro_('Informe o id do candidato.');
  return comTrava_(function () {
    var aba = obterAba_();
    var linha = localizarLinha_(aba, id);
    if (linha === -1) return erro_('Candidato não encontrado.');
    aba.deleteRow(linha);
    return { ok: true, id: id };
  });
}

/** Sem "avaliacao": apaga todas as respostas. Com "avaliacao" (código): só as daquela avaliação. */
function acaoExcluirTodos_(avaliacaoBruta) {
  var filtrar = avaliacaoBruta !== undefined && avaliacaoBruta !== null && String(avaliacaoBruta).trim() !== '';
  var codigo = filtrar ? normalizarCodigoAvaliacao(avaliacaoBruta) : '';
  if (filtrar && !codigo) return erro_('Código de avaliação inválido.');
  return comTrava_(function () {
    var aba = obterAba_();
    var ultima = aba.getLastRow();
    var total = Math.max(0, ultima - 1);
    if (!filtrar) {
      if (total > 0) aba.deleteRows(2, total);
      return { ok: true, excluidos: total };
    }
    var codigos = colunaRespostas_(aba, 'avaliacao');
    var excluidos = 0;
    for (var i = codigos.length - 1; i >= 0; i--) { // de baixo para cima: as linhas de cima não mudam
      if (normalizarCodigoAvaliacao(celulaTexto_(codigos[i])) === codigo) {
        aba.deleteRow(i + 2);
        excluidos++;
      }
    }
    return { ok: true, excluidos: excluidos, avaliacao: codigo };
  });
}

// ---------------------------------------------------------------------------
// Ações com sessão — empresas, avaliações e usuários
// ---------------------------------------------------------------------------

function empresaPublica_(e) { return { id: e.id, nome: e.nome, criadaEm: e.criadaEm }; }

function acaoEmpresasListar_() {
  return { ok: true, empresas: lerTabela_('Empresas').registros.map(empresaPublica_) };
}

function acaoEmpresasSalvar_(dados) {
  if (!dados || typeof dados !== 'object') return erro_('Dados da empresa ausentes.');
  var nome = limparTexto(dados.nome, 80);
  if (letrasContadas_(nome) < 2) return erro_('Informe o nome da empresa.');
  var id = limparTexto(dados.id, 40);
  return comTrava_(function () {
    var tabela = lerTabela_('Empresas');
    var repetida = tabela.registros.filter(function (e) { return e.id !== id && e.nome.toLowerCase() === nome.toLowerCase(); });
    if (repetida.length) return erro_('Já existe uma empresa com esse nome.');
    var e;
    if (id) {
      e = buscarPor_(tabela.registros, 'id', id);
      if (!e) return erro_('Empresa não encontrada.');
      e.nome = nome;
    } else {
      e = { id: novoId_('emp'), nome: nome, criadaEm: new Date(agora_()).toISOString() };
    }
    gravarRegistro_(tabela, e);
    return { ok: true, empresa: empresaPublica_(e) };
  });
}

function acaoEmpresasExcluir_(idBruto) {
  var id = limparTexto(idBruto, 40);
  return comTrava_(function () {
    var tabela = lerTabela_('Empresas');
    var e = id && buscarPor_(tabela.registros, 'id', id);
    if (!e) return erro_('Empresa não encontrada.');
    if (buscarPor_(lerTabela_('Avaliacoes').registros, 'empresaId', id)) {
      return erro_('Esta empresa tem avaliações. Exclua as avaliações dela antes.');
    }
    if (buscarPor_(lerTabela_('Usuarios').registros, 'empresaId', id)) {
      return erro_('Esta empresa tem gestores ligados a ela. Exclua ou mude esses gestores antes.');
    }
    excluirRegistro_(tabela, e);
    return { ok: true, id: id };
  });
}

function avaliacaoPublica_(a, empresas, contagem) {
  return {
    id: a.id, codigo: a.codigo, empresaId: a.empresaId, empresaNome: empresas[a.empresaId] || a.empresa || '',
    nome: a.nome, tipo: a.tipo, mostrarResultado: a.mostrarResultado === true, ativa: a.ativa === true,
    criadaEm: a.criadaEm, respostas: contagem[a.codigo] || 0
  };
}

/** Processo = avaliação + campos da rodada ClickUp (vazios em avaliações antigas). */
function processoPublico_(a, empresas, contagem) {
  var p = avaliacaoPublica_(a, empresas, contagem);
  p.empresa = a.empresa || empresas[a.empresaId] || '';
  p.vaga = a.vaga || '';
  p.cidade = a.cidade || '';
  p.consultor = a.consultor || '';
  p.contratante = a.contratante || '';
  p.periodo = { inicio: a.periodoInicio || '', fim: a.periodoFim || '' };
  p.clickupListId = a.clickupListId || '';
  p.config = configDoProcesso_(a);
  return p;
}

/** Config do processo gravada (JSON na coluna "config"), sempre completa com os padrões. */
function configDoProcesso_(a) {
  var bruto = {};
  try { bruto = a && a.config ? JSON.parse(a.config) : {}; } catch (err) { bruto = {}; }
  var v = validarConfigProcesso(bruto);
  return v.ok ? v.config : validarConfigProcesso({}).config;
}

/** Processo (aba Avaliacoes) pelo id, ou null. */
function processoPorId_(id) {
  id = limparTexto(id, 40);
  return id ? buscarPor_(lerTabela_('Avaliacoes').registros, 'id', id) : null;
}

var TERMOS_SENSIVEIS = ['sexo', 'genero', 'estado civil', 'filho', 'religi', 'gravid', 'etnia', 'raca',
  'cor da pele', 'orientacao', 'deficien', 'doenca', 'saude', 'antecedente', 'processo em seu nome', 'criminal'];
var TERMOS_ANTECEDENTES = ['antecedente', 'processo em seu nome', 'criminal'];

/** Nome de campo normalizado: minúsculas, sem acento, só letras/algarismos/% separados por 1 espaço. */
function normalizarNomeCampo(nome) {
  var s = String(nome === null || nome === undefined ? '' : nome).toLowerCase();
  if (s.normalize) s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return s.replace(/[^a-z0-9%]+/g, ' ').trim();
}

/**
 * Classifica o nome de um campo do ClickUp: '' (pode ler), 'sensivel' (nunca ler) ou 'antecedente'
 * (só com config.permitirAntecedentes === true; e nunca vai para o relatório do contratante).
 * "saude" só passa com config.permitirSaude === true. Os termos valem no começo de uma palavra
 * ("filhos" casa com "filho"; "graça" não casa com "raca").
 */
function classificarCampo(nome, config) {
  var n = ' ' + normalizarNomeCampo(nome);
  config = config || {};
  for (var i = 0; i < TERMOS_SENSIVEIS.length; i++) {
    var termo = TERMOS_SENSIVEIS[i];
    if (n.indexOf(' ' + termo) === -1) continue;
    if (termo === 'saude' && config.permitirSaude === true) continue;
    if (TERMOS_ANTECEDENTES.indexOf(termo) >= 0) return config.permitirAntecedentes === true ? 'antecedente' : 'sensivel';
    return 'sensivel';
  }
  return '';
}

function numeroOu_(v, padrao, min, max) {
  var n = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v.replace(',', '.')) : NaN);
  if (!isFinite(n)) return padrao;
  return Math.max(min, Math.min(max, n));
}

function idSimples_(v, prefixo, i) {
  var s = limparTexto(v, 40);
  return /^[A-Za-z0-9_-]{1,40}$/.test(s) ? s : prefixo + (i + 1);
}

/**
 * Valida e completa a config do processo (contrato da rodada ClickUp). Retorna {ok, config} ou {ok:false, erro}.
 * Campos do ClickUp com nome sensível são recusados com mensagem clara.
 */
function validarConfigProcesso(c) {
  if (c === undefined || c === null) c = {};
  if (typeof c !== 'object' || Array.isArray(c)) return erro_('Configuração do processo inválida.');
  var json;
  try { json = JSON.stringify(c); } catch (err) { return erro_('Configuração do processo inválida.'); }
  if (json.length > 40000) return erro_('Configuração do processo grande demais.');
  var perfil = String(c.perfilIdeal || '').toUpperCase().replace(/[^DISC]/g, '');
  if (perfil.length > 2 || (perfil.length === 2 && perfil[0] === perfil[1])) return erro_('Perfil ideal inválido: use 1 ou 2 letras entre D, I, S e C.');
  var permitirAntecedentes = c.permitirAntecedentes === true;
  var base = { permitirAntecedentes: permitirAntecedentes, permitirSaude: c.permitirSaude === true };
  var problema = null;
  function campo(v) {
    var nome = limparTexto(v, 120);
    if (nome && classificarCampo(nome, base) === 'sensivel') problema = problema || ('O campo "' + nome + '" é um dado sensível e não pode ser usado.');
    return nome;
  }
  var ids = {};
  function idUnico(v, prefixo, i) {
    var id = idSimples_(v, prefixo, i);
    while (ids[id]) id = id + '_';
    ids[id] = true;
    return id;
  }
  var etapas = (Array.isArray(c.etapas) ? c.etapas : []).slice(0, 20).map(function (e, i) {
    e = e && typeof e === 'object' ? e : {};
    return {
      id: idUnico(e.id, 'etapa', i), nome: limparTexto(e.nome, 80) || ('Etapa ' + (i + 1)),
      peso: numeroOu_(e.peso, 0, 0, 1000), campo: campo(e.campo), descricao: limparTextoLongo(e.descricao, 1000)
    };
  });
  var bonus = (Array.isArray(c.bonus) ? c.bonus : []).slice(0, 20).map(function (b, i) {
    b = b && typeof b === 'object' ? b : {};
    var regra = b.regra && typeof b.regra === 'object' ? b.regra : {};
    var r;
    if (regra.tipo === 'mapa') {
      var pontos = {};
      var origem = regra.pontos && typeof regra.pontos === 'object' ? regra.pontos : {};
      Object.keys(origem).slice(0, 50).forEach(function (k) {
        var chave = limparTexto(k, 120);
        if (chave) pontos[chave] = numeroOu_(origem[k], 0, -100, 100);
      });
      r = { tipo: 'mapa', pontos: pontos };
    } else {
      r = { tipo: 'checkbox', pontos: numeroOu_(regra.pontos, 0, -100, 100) };
    }
    return { id: idUnico(b.id, 'bonus', i), nome: limparTexto(b.nome, 80) || ('Bônus ' + (i + 1)), campo: campo(b.campo), regra: r };
  });
  if (problema) return erro_(problema);
  var corte = numeroOu_(c.corte, 70, 0, 200);
  var faixa = numeroOu_(c.faixaAvaliar, 55, 0, 200);
  if (faixa > corte) return erro_('A faixa "avaliar" precisa ser menor ou igual à nota de corte.');
  return {
    ok: true,
    config: {
      perfilIdeal: perfil,
      explicacaoPerfil: limparTextoLongo(c.explicacaoPerfil, 2000),
      etapas: etapas,
      bonus: bonus,
      corte: corte,
      faixaAvaliar: faixa,
      statusFinalistas: (Array.isArray(c.statusFinalistas) ? c.statusFinalistas : []).slice(0, 30)
        .map(function (x) { return limparTexto(x, 80); }).filter(Boolean),
      permitirAntecedentes: permitirAntecedentes,
      permitirSaude: c.permitirSaude === true
    }
  };
}

function acaoAvaliacoesListar_(usuario) {
  var empresas = mapaEmpresas_();
  var contagem = respostasPorAvaliacao_();
  var lista = lerTabela_('Avaliacoes').registros
    .filter(function (a) { return podeVerEmpresa_(usuario, a.empresaId); })
    .map(function (a) { return avaliacaoPublica_(a, empresas, contagem); });
  return { ok: true, avaliacoes: lista };
}

function acaoAvaliacoesSalvar_(dados) {
  return salvarProcesso_(dados, true);
}

/** Processos (interface nova): só admin, empresa como texto, campos do ClickUp e config. */
function acaoProcessosListar_() {
  var empresas = mapaEmpresas_();
  var contagem = respostasPorAvaliacao_();
  return { ok: true, processos: lerTabela_('Avaliacoes').registros.map(function (a) { return processoPublico_(a, empresas, contagem); }) };
}

function acaoProcessosSalvar_(dados) {
  return salvarProcesso_(dados, false);
}

/**
 * Grava avaliação/processo. legado=true (avaliacoes.salvar): exige empresaId e tipo, como antes.
 * legado=false (processos.salvar): empresa é texto, tipo padrão "selecao", empresaId opcional.
 * Em edição, campo que não veio no corpo fica como estava.
 */
function salvarProcesso_(dados, legado) {
  var rotulo = legado ? 'avaliação' : 'processo';
  if (!dados || typeof dados !== 'object') return erro_('Dados da ' + rotulo + ' ausentes.');
  function veio(k) { return Object.prototype.hasOwnProperty.call(dados, k) && dados[k] !== undefined; }
  var id = limparTexto(dados.id, 40);
  var nome = limparTexto(dados.nome, 80);
  if (letrasContadas_(nome) < 2) return erro_('Informe o nome ' + (legado ? 'da avaliação.' : 'do processo.'));
  var tipo = limparTexto(dados.tipo, 20);
  if (!legado && !tipo) tipo = 'selecao';
  if (TIPOS_AVALIACAO.indexOf(tipo) === -1) return erro_('Tipo inválido. Use: selecao ou equipe.');
  var empresaId = limparTexto(dados.empresaId, 40);
  var extras = {};
  var textos = { empresa: 80, vaga: 120, cidade: 80, consultor: 80, contratante: 80 };
  Object.keys(textos).forEach(function (k) { if (veio(k)) extras[k] = limparTexto(dados[k], textos[k]); });
  if (veio('periodo')) {
    var per = dados.periodo && typeof dados.periodo === 'object' ? dados.periodo : {};
    var dataOk = function (d) { d = limparTexto(d, 10); return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : ''; };
    extras.periodoInicio = dataOk(per.inicio);
    extras.periodoFim = dataOk(per.fim);
  }
  if (veio('clickupListId')) {
    var lista = limparTexto(dados.clickupListId, 40);
    if (lista && !/^[A-Za-z0-9_-]{1,40}$/.test(lista)) return erro_('ID da lista do ClickUp inválido.');
    extras.clickupListId = lista;
  }
  if (veio('config')) {
    var cfg = validarConfigProcesso(dados.config);
    if (!cfg.ok) return cfg;
    extras.config = JSON.stringify(cfg.config);
  }
  return comTrava_(function () {
    var empresas = mapaEmpresas_();
    if (legado || empresaId) {
      if (!empresaId || !Object.prototype.hasOwnProperty.call(empresas, empresaId)) return erro_('Escolha uma empresa válida.');
    }
    var tabela = lerTabela_('Avaliacoes');
    var contagem = respostasPorAvaliacao_();
    var a;
    if (id) {
      a = buscarPor_(tabela.registros, 'id', id);
      if (!a) return erro_(legado ? 'Avaliação não encontrada.' : 'Processo não encontrado.');
      if (!legado && !veio('empresaId')) empresaId = a.empresaId;
      if (a.empresaId !== empresaId && contagem[a.codigo]) {
        return erro_('Esta avaliação já tem respostas: não dá para trocar a empresa dela.');
      }
      if (dados.ativa !== undefined) a.ativa = dados.ativa === true;
    } else {
      var usados = {};
      tabela.registros.forEach(function (r) { usados[r.codigo] = true; });
      a = { id: novoId_('ava'), codigo: gerarCodigoAvaliacao(usados), criadaEm: new Date(agora_()).toISOString(), ativa: dados.ativa !== false };
      if (!extras.config) extras.config = JSON.stringify(validarConfigProcesso({}).config);
    }
    a.empresaId = empresaId;
    a.nome = nome;
    a.tipo = tipo;
    if (legado || veio('mostrarResultado') || !id) a.mostrarResultado = dados.mostrarResultado === true;
    Object.keys(extras).forEach(function (k) { a[k] = extras[k]; });
    gravarRegistro_(tabela, a);
    return legado ? { ok: true, avaliacao: avaliacaoPublica_(a, empresas, contagem) }
      : { ok: true, processo: processoPublico_(a, empresas, contagem) };
  });
}

function acaoAvaliacoesExcluir_(idBruto) {
  var id = limparTexto(idBruto, 40);
  return comTrava_(function () {
    var tabela = lerTabela_('Avaliacoes');
    var a = id && buscarPor_(tabela.registros, 'id', id);
    if (!a) return erro_('Avaliação não encontrada.');
    if (respostasPorAvaliacao_()[a.codigo]) {
      return erro_('Esta avaliação já tem respostas. Desative a avaliação em vez de excluir (ou exclua as respostas dela antes).');
    }
    excluirRegistro_(tabela, a);
    return { ok: true, id: id };
  });
}

function usuarioLista_(u, empresas, agora) {
  var p = usuarioPublico_(u, empresas);
  p.ativo = u.ativo === true;
  p.criadoEm = u.criadoEm;
  p.bloqueado = !!(u.bloqueadoAte && u.bloqueadoAte > agora);
  return p;
}

function acaoUsuariosListar_() {
  var empresas = mapaEmpresas_();
  var agora = agora_();
  return { ok: true, usuarios: lerTabela_('Usuarios').registros.map(function (u) { return usuarioLista_(u, empresas, agora); }) };
}

function adminsAtivos_(registros, excetoId) {
  return registros.filter(function (u) { return u.papel === 'admin' && u.ativo && u.id !== excetoId; }).length;
}

function acaoUsuariosSalvar_(atual, dados, senhaTemporaria) {
  if (!dados || typeof dados !== 'object') return erro_('Dados do usuário ausentes.');
  var id = limparTexto(dados.id, 40);
  var nome = limparTexto(dados.nome, 80);
  if (letrasContadas_(nome) < 2) return erro_('Informe o nome do usuário.');
  var email = normalizarEmail(dados.email);
  if (!emailValido(email)) return erro_('E-mail inválido.');
  var papel = limparTexto(dados.papel, 20);
  if (PAPEIS.indexOf(papel) === -1) return erro_('Papel inválido. Use: admin ou gestor.');
  var empresaId = papel === 'gestor' ? limparTexto(dados.empresaId, 40) : '';
  var ativo = dados.ativo !== false;
  var temSenha = senhaTemporaria !== undefined && senhaTemporaria !== null && senhaTemporaria !== '';
  if (!id && !temSenha) return erro_('Defina uma senha temporária para o novo usuário.');
  if (temSenha) { var s = validarSenhaNova(senhaTemporaria); if (!s.ok) return s; }

  return comTrava_(function () {
    var empresas = mapaEmpresas_();
    if (papel === 'gestor' && (!empresaId || !Object.prototype.hasOwnProperty.call(empresas, empresaId))) {
      return erro_('Escolha a empresa do gestor.');
    }
    var tabela = lerTabela_('Usuarios');
    var outro = buscarPor_(tabela.registros, 'email', email);
    if (outro && outro.id !== id) return erro_('Já existe um usuário com este e-mail.');
    var u;
    if (id) {
      u = buscarPor_(tabela.registros, 'id', id);
      if (!u) return erro_('Usuário não encontrado.');
      if (u.id === atual.id && (!ativo || papel !== 'admin')) {
        return erro_('Você não pode desativar o seu próprio acesso nem tirar o seu papel de administrador.');
      }
      if (u.papel === 'admin' && u.ativo && (papel !== 'admin' || !ativo) && adminsAtivos_(tabela.registros, u.id) === 0) {
        return erro_('Precisa existir pelo menos um administrador ativo.');
      }
    } else {
      u = { id: novoId_('usr'), criadoEm: new Date(agora_()).toISOString() };
    }
    u.nome = nome;
    u.email = email;
    u.papel = papel;
    u.empresaId = empresaId;
    u.ativo = ativo;
    if (temSenha) definirSenha_(u, senhaTemporaria);
    gravarRegistro_(tabela, u);
    return { ok: true, usuario: usuarioLista_(u, empresas, agora_()) };
  });
}

function acaoUsuariosExcluir_(atual, idBruto) {
  var id = limparTexto(idBruto, 40);
  return comTrava_(function () {
    var tabela = lerTabela_('Usuarios');
    var u = id && buscarPor_(tabela.registros, 'id', id);
    if (!u) return erro_('Usuário não encontrado.');
    if (u.id === atual.id) return erro_('Você não pode excluir o seu próprio acesso.');
    if (u.papel === 'admin' && u.ativo && adminsAtivos_(tabela.registros, u.id) === 0) {
      return erro_('Precisa existir pelo menos um administrador ativo.');
    }
    excluirRegistro_(tabela, u);
    return { ok: true, id: id };
  });
}

function acaoUsuariosRedefinirSenha_(idBruto, senhaTemporaria) {
  var id = limparTexto(idBruto, 40);
  var s = validarSenhaNova(senhaTemporaria);
  if (!s.ok) return s;
  return comTrava_(function () {
    var tabela = lerTabela_('Usuarios');
    var u = id && buscarPor_(tabela.registros, 'id', id);
    if (!u) return erro_('Usuário não encontrado.');
    definirSenha_(u, senhaTemporaria);
    gravarRegistro_(tabela, u);
    return { ok: true, id: id };
  });
}

// ---------------------------------------------------------------------------
// Funções para executar manualmente no editor do Apps Script
// ---------------------------------------------------------------------------

/** Cria as abas (Respostas, Usuarios, Empresas, Avaliacoes, Relatorios) e a chave de primeiro acesso (se ainda não existir). */
function setup() {
  obterAba_();
  Object.keys(TABELAS).forEach(function (nome) { abaTabela_(nome); });
  var props = PropertiesService.getScriptProperties();
  var chave = props.getProperty('ADMIN_KEY');
  if (!chave) {
    chave = gerarChave_();
    props.setProperty('ADMIN_KEY', chave);
    Logger.log('Chave de primeiro acesso criada. Copie e guarde em local seguro:');
  } else {
    Logger.log('A chave de primeiro acesso já existia (use gerarNovaChave() para trocar):');
  }
  Logger.log(chave);
  Logger.log("Use esta chave uma única vez no painel, em 'Primeiro acesso', para criar o seu login de administrador.");
  Logger.log('Abas prontas. Agora faça Implantar > Nova implantação > App da Web (ou, se já publicou, Gerenciar implantações > Nova versão).');
}

/** Troca a chave de primeiro acesso (a anterior deixa de funcionar). Logins já criados continuam valendo. */
function gerarNovaChave() {
  var chave = gerarChave_();
  PropertiesService.getScriptProperties().setProperty('ADMIN_KEY', chave);
  Logger.log('Nova chave de primeiro acesso:');
  Logger.log(chave);
}

/**
 * Apaga todas as linhas da aba Respostas (mantém o cabeçalho).
 * ATENÇÃO: o Histórico de versões da planilha continua guardando os dados apagados.
 * Para excluir de verdade ao fim do processo, exclua o arquivo da planilha do Drive e
 * esvazie a lixeira (veja docs/BACKEND.md, seção 7).
 */
function apagarTodosOsDados() {
  var r = acaoExcluirTodos_();
  Logger.log(r.ok ? ('Respostas apagadas: ' + r.excluidos) : r.erro);
}

function gerarChave_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '').substring(0, 40);
}

// Exportação para testes no Node (no Apps Script "module" não existe e isto é ignorado).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    doGet: doGet, doPost: doPost, setup: setup,
    validarRespostasCompactas: validarRespostasCompactas, calcularDisc: calcularDisc,
    validarPayload: validarPayload, validarIdadeServidor: validarIdadeServidor, protegerCelula: protegerCelula, forcarTexto: forcarTexto, normalizarTelefone: normalizarTelefone,
    montarLinha: montarLinha, linhaParaItem: linhaParaItem, CABECALHO: CABECALHO,
    protocoloValido: protocoloValido, normalizarProtocolo: normalizarProtocolo, gerarProtocolo: gerarProtocolo,
    LETRAS_PROTOCOLO: LETRAS_PROTOCOLO, TOTAL_PROTOCOLOS: TOTAL_PROTOCOLOS,
    hashSenha: hashSenha, validarValidacao: validarValidacao, normalizarCodigoAvaliacao: normalizarCodigoAvaliacao,
    gerarCodigoAvaliacao: gerarCodigoAvaliacao, validarConfigProcesso: validarConfigProcesso,
    classificarCampo: classificarCampo, normalizarNomeCampo: normalizarNomeCampo
  };
}
