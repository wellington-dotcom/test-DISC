/*
 * Cliente do backend Supabase (Postgres + Auth + Edge Functions) — mesma interface do DISC_API (js/api.js).
 *
 * Liga só quando CONFIG.BACKEND === 'supabase' (com SUPABASE_URL e SUPABASE_ANON_KEY preenchidos).
 * Carregue DEPOIS de js/api.js, js/api-simulada.js e assets/vendor/supabase.js:
 *   <script src="js/api.js"></script>
 *   <script src="js/api-simulada.js"></script>
 *   <script src="assets/vendor/supabase.js"></script>
 *   <script src="js/api-supabase.js"></script>
 * Com outro BACKEND este arquivo não faz nada (o DISC_API do Apps Script ou da prévia continua valendo).
 *
 * Todos os métodos de DISC_API.METODOS são trocados, com os MESMOS nomes, argumentos e respostas {ok, ...}
 * (erros: Error em pt-BR com erro.sessaoExpirada e erro.resposta, como no js/api.js):
 *   - públicas pelas funções do banco (RPC, papel anon): enviar -> enviar_resposta (e, em segundo plano,
 *     a Edge Function "disc-sync", que leva o resultado ao ClickUp; falha nela nunca afeta o candidato),
 *     avaliacaoPublica -> avaliacao_publica, relatorioPublico -> relatorio_publico;
 *   - login/sair/trocarSenha pelo Supabase Auth (signInWithPassword, signOut, updateUser). No 1º login,
 *     garantir_primeiro_admin() torna administrador quem entrar se ainda não houver nenhum;
 *   - participantes (respostas) e processos direto nas tabelas (PostgREST com RLS: só admin enxerga);
 *   - ClickUp, relatórios, IA e usuários pela Edge Function "admin" ({acao, ...}).
 * O "token" (1º argumento dos métodos com sessão) é o access_token do Supabase. A sessão de verdade fica
 * guardada pelo supabase-js (renovada sozinha): o token passado só precisa existir (mantém a assinatura).
 *
 * Diferenças do Supabase (métodos extras, usados pelo painel quando DISC_API.backend === 'supabase'):
 *   recuperarSenha(email)            -> envia o e-mail "Esqueci minha senha" (link volta para admin.html)
 *   linkDeAcesso()                   -> {tipo: 'recovery'|'invite'|'signup'|'magiclink'|'', erro} lido do
 *                                       endereço ao abrir a página (#type=recovery = "Defina sua nova senha")
 *   definirNovaSenha(novaSenha)      -> grava a senha da sessão aberta pelo link e entra: {ok, token, usuario}
 *   sessaoAtual()                    -> {ok, token, usuario} da sessão guardada (ou rejeita com sessaoExpirada)
 *   convidarUsuario(token, {email, nome}) · removerUsuario(token, id)
 *   primeiroAcesso e redefinirSenha  -> recusam com mensagem explicando o jeito do Supabase.
 *
 * Empresas, colaboradores e organograma (tabelas empresas/vinculos/relacoes, só admin pela RLS; as operações
 * que precisam ser atômicas vão pelas funções do banco salvar_colaborador, mover_colaborador e salvar_relacoes):
 *   listarEmpresas(token) -> {empresas:[{id, nome, cidade, observacoes, ativo, criadoEm, atualizadoEm, colaboradores}]}
 *   salvarEmpresa(token, {id?, nome, cidade, observacoes, ativo}) -> {empresa} · excluirEmpresa(token, id) -> {id}
 *     (recusa com colaborador ativo: "Desligue ou mova os colaboradores antes.")
 *   listarEquipe(token, empresaId) -> {empresa, colaboradores:[{vinculoId, pessoaId, nome, telefone, cargo, area,
 *     status, inicio, fim, resultado:{percentuais, codigo}|null, respondidoEm,
 *     exigido:{percentuais, codigo}|null (Parte 2 da resposta mais recente)}], relacoes:[{de, para, tipo}], historico:[…]}
 *   salvarColaborador(token, {empresaId, pessoaId? | nome + telefone, cargo, area}) -> {colaborador}
 *   moverColaborador(token, {pessoaId, empresaId, cargo, area}) -> {colaborador} · desligarColaborador(token, vinculoId) -> {id}
 *   salvarRelacoes(token, empresaId, [{de, para, tipo}], {topoIds}?) -> {relacoes, topoIds} (substitui o conjunto;
 *     topoIds = quem fica no topo do organograma mesmo sem liderados, guardado em empresas.organograma;
 *     sem o 4º argumento o topo salvo não muda). listarEquipe devolve também topoIds (só de ativos).
 * Rodada 4 (migração 20261010120000_mover_versao.sql):
 *   moverResposta(token, respostaId, processoId | '') -> {id, processoId, avaliacao, historicoProcessos}
 *     (só admin; '' = sem processo; registra em respostas.historico_processos [{de, para, deCodigo, paraCodigo, em}]).
 *     listar: item.historicoProcessos.
 *   contratarPessoa(token, {respostaId | pessoaId, empresaId, cargo, area}) -> {colaborador, movido, deEmpresaId}
 *     (colaborador ativo na empresa; ativo em outra = move, lá fica desligado com fim = hoje; respostaId = 'aprovado').
 *   versaoBanco() -> {versao, faltando:[nomes das migrações cujo efeito não está no banco], semFuncao?}. Sem a
 *     função versao_banco (banco sem a 20261010) sonda tabelas/colunas com consultas "limit 0" (precisa de login de
 *     admin) e devolve semFuncao: true. Função do banco que não existe (PGRST202) em qualquer chamada vira
 *     "O banco de dados está desatualizado…" com erro.bancoDesatualizado = true.
 * Relatórios por modelo (equipe/lideranca/pessoa; snapshot "dados" montado no navegador, até 300 KB):
 *   salvarRelatorioModelo(token, {id?, modelo, empresaId?, pessoaId?, dados, publicar?}) -> {relatorio:{id, token,
 *     status, modelo, url?}} · listarRelatoriosModelo(token, {empresaId?, pessoaId?}) -> {relatorios:[…]}
 *   excluirRelatorioModelo(token, id) -> {id}. relatorioPublico devolve também o "modelo".
 * Fotos (data URL "data:image/jpeg;base64,/9j/…", até 40 000 caracteres, guardada no banco; fotoValida(str)):
 *   enviar: payload.foto ('' = sem foto), conforme formulario.campos.foto ('obrigatorio'|'opcional'|'oculto').
 *   listar: item.foto (da resposta, '' sem foto) e item.pessoa.foto (da ficha). listarEquipe: colaborador.foto
 *   (da ficha da pessoa). eu/sessaoAtual/login: usuario.foto. listarUsuarios: usuario.foto.
 *   salvarMinhaFoto(token, dataUrl | '') -> {foto} (só a do próprio usuário; '' remove)
 *   removerFoto(token, respostaId) -> {id, removidas} (LGPD: some da resposta, da ficha e das outras respostas
 *     da pessoa; também por atualizar(token, id, {foto: ''})).
 *
 *
 * ============================================================================================================
 * VENDA DIRETA (B2C, rodada 5 — migrações 20261011120000_vendas.sql e 20261012120000_infinitepay.sql + Edge Functions
 * "pagamento", "infinitepay-webhook" e "asaas-webhook").
 * Contrato usado pelas telas do cliente (js/app.js modo pessoal, js/checkout.js, js/meu-relatorio.js) e pelo painel
 * (aba Vendas). MESMOS nomes, argumentos e respostas em js/api-simulada.js; em js/api.js (Apps Script) todos rejeitam
 * com "Disponível só com o servidor Supabase.". Valores em dinheiro: SEMPRE centavos (inteiro). Erros: Error em pt-BR
 * com erro.resposta = {ok:false, erro, ...}, como o resto da API — exceto os 2 casos "não configurado" abaixo, que
 * RESOLVEM com {ok:false, ...} para a tela mostrar a alternativa.
 * Públicas (sem login):
 *   pacotesPublicos() -> {ok, pacotes:[{chave:'gratis'|'completo'|'completo_plus', nome, precoCentavos,
 *     precoLancamentoCentavos|null, lancamentoAte:'AAAA-MM-DD'|'', valorCentavos (o que vale hoje), emLancamento,
 *     descricao:{subtitulo, itens:[texto]}, ordem}]} (só os ativos, na ordem)
 *   enviarPessoal(payload) -> {ok, id, protocolo:'', tokenResumo, duplicado?}
 *     payload = o mesmo do enviar() (id, nome, respostas, validacao, inicio, fim, duracaoSeg, consentimento:true) +
 *     email (OBRIGATÓRIO) + telefone (WhatsApp, opcional) + exigido? (Parte 2, opcional). Idade/função/empresa/cidade/
 *     foto/avaliacao são ignorados. Limite: 2 envios/minuto e 20/dia por e-mail.
 *   resumoPessoal(tokenResumo) -> {ok, nome (primeiro nome), resultado:{percentuais:{D,I,S,C}, codigo}, recebidoEm, temParte2}
 *   criarPedido(tokenResumo, pacote, cupom?) -> {ok, pedidoId, tokenAcesso, valor, valorOriginal, gratuito, status, jaPago?}
 *     gratuito = cupom de 100% (status 'cortesia': relatório liberado na hora). jaPago = esta resposta já tinha
 *     comprado este pacote (devolve aquele pedido). Cupom ruim: "Cupom inválido ou expirado.".
 *   iniciarPagamento(pedidoId, tokenAcesso, {cpf}?) -> uma destas (o PROVEDOR é escolhido no servidor pelos segredos
 *     PAGAMENTO_PROVEDOR / STRIPE_SECRET_KEY / INFINITEPAY_HANDLE / ASAAS_API_KEY; o Stripe é o padrão quando configurado):
 *     | Stripe (migração 20261014120000_stripe.sql): {ok:true, provedor:'stripe', clientSecret ('pi_…_secret_…'), publicavel
 *       ('pk_…'), valor} -> o site carrega https://js.stripe.com/v3/ e monta o Payment Element NA PÁGINA (cartão, Apple Pay,
 *       Google Pay, Pix com QR). stripe.confirmPayment com redirect:'if_required'; se o banco pedir 3DS/redirecionamento, a
 *       volta é meu-relatorio.html?pedido=<id>&payment_intent=pi_…&payment_intent_client_secret=…&redirect_status=…#t-<token>
 *       e a página chama confirmarRetorno(pedidoId, tokenAcesso, {paymentIntent}).
 *     | InfinitePay (migração 20261012120000_infinitepay.sql): {ok:true, provedor:'infinitepay', redirecionarUrl, valor}
 *       -> o site faz location.href = redirecionarUrl (página da InfinitePay: Pix e cartão; sem Pix embutido no site).
 *       Depois de pagar a InfinitePay devolve o cliente para
 *         meu-relatorio.html?pedido=<pedidoId>&order_nsu=<pedidoId>&transaction_nsu=…&slug=…&capture_method=pix|credit_card
 *         &receipt_url=…#t-<tokenAcesso>
 *       (os parâmetros dela são ACRESCENTADOS ao redirect_url; leia-os de location.search e, por tolerância, também de
 *       depois do token no hash: "#t-<64 hex>?order_nsu=…" ou "#t-<64 hex>&order_nsu=…"). A página chama
 *       confirmarRetorno(pedidoId, tokenAcesso, {transactionNsu, slug}) e, enquanto 'aguardando', statusPedido a cada 4 s.
 *     | Asaas: {ok:true, provedor:'asaas', pix:{qrBase64 (PNG base64, sem "data:"), copiaECola, expira}|null,
 *       cartaoUrl (página do Asaas: cartão/Pix/boleto), valor, vencimento}
 *     | {ok:true, pago:true, status} (já liberado)
 *     | {ok:false, erro:'Pagamento ainda não configurado.', naoConfigurado:true} (nenhum provedor configurado ou função não
 *       publicada: mostre "Compra disponível em breve — use um cupom")
 *     | {ok:false, erro:'Informe o seu CPF para pagar.' | 'CPF inválido…', precisaCpf:true} (só Asaas, que exige CPF: peça e
 *       chame de novo com {cpf}; o CPF vai só para o Asaas, não fica no banco)
 *   confirmarRetorno(pedidoId, tokenAcesso, {transactionNsu, slug, paymentIntent}) -> {ok, status:'aguardando'|'pago'|…}
 *     Stripe: o servidor busca o PaymentIntent do pedido (status succeeded, valor e pedido conferidos) e marca pago.
 *     Volta da InfinitePay: o servidor confere no payment_check (paid=true e valor pago >= valor do pedido) e marca pago.
 *     'aguardando' = ainda não confirmado (Pix em processamento): siga com statusPedido. Os parâmetros da URL NÃO
 *     liberam nada sozinhos. Sem a Edge Function: devolve o status do banco.
 *   statusPedido(pedidoId, tokenAcesso) -> {ok, status:'aguardando'|'pago'|'cortesia'|'estornado'|'cancelado'}
 *     (consulte a cada 4 s; a Edge Function confere no provedor no máximo a cada 15 s; sem ela, lê do banco)
 *   relatorioPessoal(tokenAcesso) -> {ok, nome (primeiro nome), resultado:{percentuais, codigo},
 *     exigido:{percentuais, codigo}|null, exigidoRespostas:'40 dígitos'|'', pacote, pacoteNome, precisaParte2, status}
 *     SÓ com pedido 'pago'/'cortesia'; senão rejeita ("Pagamento ainda não confirmado." / "Esta compra foi estornada…" /
 *     "Link inválido…"), com erro.resposta.status quando houver.
 *   salvarParte2Pessoal(tokenAcesso, exigido) -> {ok, exigido:{percentuais, codigo}, exigidoRespostas} (só completo_plus;
 *     uma vez: outro conteúdo depois -> "A segunda parte já foi respondida.")
 *   recuperarAcesso(email) -> {ok:true} (manda os links por e-mail se houver compra; não revela se houve)
 *     | {ok:false, erro:'O envio por e-mail ainda não está configurado. Fale com o suporte.', naoConfigurado:true}
 * Painel (token da sessão de admin; tabelas pedidos/cupons/pacotes com RLS):
 *   listarPedidos(token, {status?, pacote?, de?:'AAAA-MM-DD', ate?, busca?, limite?:500}) -> {ok, pedidos:[{id, respostaId,
 *     pacote, valorCentavos, valorOriginalCentavos, cupom, status, metodo:''|'pix'|'cartao'|'boleto'|'cupom'|'manual',
 *     provedor:''|'asaas'|'infinitepay'|'stripe', provedorRef (InfinitePay: transaction_nsu; Stripe: pi_… do PaymentIntent), asaasCobrancaId, faturaUrl (link de
 *     pagamento: checkout da InfinitePay ou fatura do Asaas), email, nome, criadoEm, pagoEm, reembolsadoEm}]} (mais novos primeiro)
 *   atualizarPedido(token, id, {status}) -> {ok, pedido} — 'estornado' (de pago/cortesia; o dinheiro é devolvido no
 *     painel do Asaas), 'cortesia' ("Liberar como cortesia"), 'pago' (confirmação manual), 'cancelado' (de aguardando).
 *   listarCupons(token) -> {ok, cupons:[{codigo, tipo:'percentual'|'valor', valor (1–100 ou centavos), usosMax|null, usos,
 *     validoAte:'AAAA-MM-DD'|'', ativo, pacotes:[chaves] ([] = todos), descricao, criadoEm}]}
 *   salvarCupom(token, {codigo, tipo, valor, usosMax?, validoAte?, ativo?, pacotes?, descricao?}) -> {ok, cupom}
 *     (cria ou altera pelo código; o código vira MAIÚSCULO) · excluirCupom(token, codigo) -> {ok, codigo}
 *   listarPacotes(token) -> {ok, pacotes:[{chave, nome, precoCentavos, precoLancamentoCentavos|null, lancamentoAte, ativo,
 *     ordem, descricao, valorCentavos, emLancamento, atualizadoEm}]}
 *   salvarPacote(token, {chave, nome?, precoCentavos?, precoLancamentoCentavos? (null = sem lançamento), lancamentoAte?
 *     ('' = sem fim), ativo?, ordem?, descricao?}) -> {ok, pacote} (só altera; os 3 pacotes vêm da migração)
 *   resumoVendas(token, 'hoje'|'7d'|'30d'|'mes'|'tudo') -> {ok, periodo, hoje:{vendas, receitaCentavos}, mes:{…}, vendas,
 *     receitaCentavos, cortesias, estornos, aguardando, resumos, compras, conversao (0–1 = compras/resumos), porPacote:[…]}
 *   listar: item.origem = 'processo' | 'pessoal'.
 * Aba Conexões do painel (só admin; migração 20261013120000_conexoes.sql + ações conexoes.* da Edge Function "admin"):
 *   diagnosticoConexoes(token) -> {ok, em, siteAtual, banco:{ms, versao, semFuncao, faltando:[{nome, descricao}],
 *     contagens:{processos, respostas, pessoas, empresas, pedidos (sem os de teste)}, ultimaResposta, erro},
 *     login:{sessao, email, admin}, servidor: resposta de conexoes.diagnostico | null,
 *     servidorEstado:'ok'|'desatualizada'|'ausente'|'erro', servidorErro}. Nunca traz valores de segredos.
 *   testarConexao(token, alvo, {pedidoId?, transactionNsu?, slug?}) -> {ok, alvo, sucesso, mensagem, verificado, em, detalhes?}
 *     alvo 'banco' (aqui no navegador) | 'funcoes' | 'clickup' | 'asaas' | 'ia' | 'email' | 'infinitepay.link' |
 *     'infinitepay.verificar' | 'stripe' | 'stripe.pagamento' (detalhes {pedidoId, clientSecret, publicavel, valorCentavos,
 *     modo, retornoUrl}: o painel monta o Payment Element) | 'stripe.verificar' (no servidor, prazo de 8 s por teste). Função admin antiga: sucesso false +
 *     estadoServidor 'desatualizada'. listarPedidos esconde os pedidos de teste (pedidos.teste).
 * Só na prévia (js/api-simulada.js): simularPagamento(pedidoId) -> {ok, status:'pago'} (botão "Simular pagamento aprovado").
 *
 * No Node (testes): require('./js/api-supabase.js').criar({ supabase: libFalsa, url, chave, local?, timeoutMs? }).
 */
(function (root) {
  'use strict';

  var TIMEOUT_MS = 20000;
  var TIMEOUT_LONGO_MS = 120000;   // Edge Function que lê o ClickUp ou chama a IA
  var MSG_SESSAO = 'Sessão expirada. Entre de novo.';
  var MSG_SEM_PERMISSAO = 'Sem permissão.';
  var MSG_LOGIN_INVALIDO = 'E-mail ou senha incorretos.';
  var MSG_BLOQUEIO = 'Muitas tentativas. Tente de novo em 15 minutos.';
  var MSG_CONEXAO = 'Não foi possível conectar ao servidor. Verifique sua conexão com a internet e tente novamente.';
  var MSG_DEMORA = 'O servidor demorou demais para responder. Verifique sua conexão e tente novamente.';
  var MSG_RECUSA = 'O servidor recusou a solicitação.';
  var MSG_INTERNO = 'Erro interno no servidor. Tente novamente em instantes.';
  var MSG_LINK_INVALIDO = 'Link inválido ou avaliação encerrada. Fale com quem enviou o link.';
  var MSG_REL_NAO_ENCONTRADO = 'Relatório não encontrado ou fora do ar.';
  var MSG_LINK_EXPIRADO = 'O link expirou ou já foi usado. Peça outro em "Esqueci minha senha".';
  var MSG_ADMIN_DESATUALIZADA = 'A função admin está desatualizada: publique de novo.';
  var MSG_ADMIN_AUSENTE = 'A função admin não está publicada no Supabase.';
  var MSG_BANCO_DESATUALIZADO = 'O banco de dados está desatualizado. Peça para aplicar as migrações (veja docs/SUPABASE.md).';
  // Migrações (supabase/migrations), na ordem, e como conferir cada uma sem a função versao_banco.
  var MIGRACOES = [
    { nome: '20261005120000_disc', descricao: 'base (processos, respostas, relatórios)' },
    { nome: '20261006120000_pessoas_formulario', descricao: 'pessoas e formulário', tabela: 'pessoas', coluna: 'id' },
    { nome: '20261007120000_empresas_equipes', descricao: 'empresas, colaboradores e organograma', tabela: 'empresas', coluna: 'id' },
    { nome: '20261008120000_parte2', descricao: 'Parte 2 (perfil exigido)', tabela: 'respostas', coluna: 'exigido' },
    { nome: '20261009120000_fotos', descricao: 'fotos', tabela: 'respostas', coluna: 'foto' },
    { nome: '20261010120000_mover_versao', descricao: 'mover resposta, contratar, topo do organograma e versão do banco',
      tabela: 'respostas', coluna: 'historico_processos' },
    { nome: '20261011120000_vendas', descricao: 'venda direta (pacotes, cupons, pedidos)', tabela: 'pedidos', coluna: 'id' },
    { nome: '20261012120000_infinitepay', descricao: 'InfinitePay (provedor do pagamento)', tabela: 'pedidos', coluna: 'provedor_dados' },
    { nome: '20261013120000_conexoes', descricao: 'aba Conexões (pedido de teste fora das vendas)', tabela: 'pedidos', coluna: 'teste' },
    { nome: '20261014120000_stripe', descricao: 'Stripe (pagamento dentro do site)' }
  ];
  var VERSAO_ATUAL = 20261014120000;
  var MSG_PRIMEIRO_ACESSO = 'Com o Supabase não há chave de primeiro acesso: crie o seu usuário no painel do Supabase ' +
    '(Authentication > Users > Add user) e entre com esse e-mail e senha. O primeiro login vira administrador.';
  var MSG_REDEFINIR = 'Com o Supabase cada pessoa cria a própria senha nova pelo "Esqueci minha senha", na tela de entrada.';
  var MODELOS_RELATORIO = ['equipe', 'lideranca', 'pessoa'];
  var TIPOS_RELACAO = ['lidera', 'direto', 'indireto'];
  var MAX_DADOS_RELATORIO = 1000000;    // ~1 MB de JSON (o banco recusa acima de 1,1 milhão de caracteres)
  var MSG_REL_GRANDE = 'Relatório grande demais (máximo 1 MB).';
  var FOTO_MAX = 40000;                 // data URL inteira (o banco recusa acima disso)
  var RE_FOTO = /^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/=]+$/;
  var MSG_FOTO_INVALIDA = 'Foto inválida ou grande demais. Escolha outra imagem.';
  var SENHA_MIN = 8;
  var SENHA_MAX = 100;
  var STATUS_VALIDOS = ['em_analise', 'aprovado', 'reprovado'];
  var STATUS_PADRAO = 'em_analise';
  var TIPOS = ['selecao', 'equipe'];
  var LETRAS = ['D', 'I', 'S', 'C'];
  var PAGINA = 1000;            // linhas por leitura no PostgREST (o limite padrão do Supabase)
  var MAX_LINHAS = 5000;
  var RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var TERMOS_SENSIVEIS = ['sexo', 'genero', 'estado civil', 'filho', 'religi', 'gravid', 'etnia', 'raca',
    'cor da pele', 'orientacao', 'deficien', 'doenca', 'saude', 'antecedente', 'processo em seu nome', 'criminal'];
  var TERMOS_ANTECEDENTES = ['antecedente', 'processo em seu nome', 'criminal'];

  // ---------------------------------------------------------------------------
  // Textos e validações (mesmas regras do apps-script/Code.gs)
  // ---------------------------------------------------------------------------

  function limparTexto(v, max) {
    if (v === null || v === undefined) return '';
    var s = String(v).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
    if (max && s.length > max) s = s.substring(0, max).trim();
    return s;
  }
  function limparTextoLongo(v, max) {
    if (v === null || v === undefined) return '';
    var s = String(v).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, ' ').trim();
    if (max && s.length > max) s = s.substring(0, max).trim();
    return s;
  }
  var RE_LETRA = (function () { try { return new RegExp('\\p{L}', 'gu'); } catch (e) { return /[A-Za-zÀ-ɏ]/g; } })();
  function letrasContadas(t) { return (String(t).match(RE_LETRA) || []).length; }
  function normalizarEmail(v) { return limparTexto(v, 120).toLowerCase(); }
  function emailValido(e) { return typeof e === 'string' && e.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }
  function validarSenhaNova(senha) {
    if (typeof senha !== 'string' || senha.length < SENHA_MIN) return 'A senha precisa ter pelo menos ' + SENHA_MIN + ' caracteres.';
    if (senha.length > SENHA_MAX) return 'A senha pode ter no máximo ' + SENHA_MAX + ' caracteres.';
    return '';
  }
  function normalizarCodigo(v) {
    if (v === null || v === undefined) return '';
    var s = String(v).replace(/\s+/g, '').toUpperCase();
    return /^[A-Z0-9]{4}$/.test(s) ? s : '';
  }
  function normalizarProtocolo(v) {
    var s = v === null || v === undefined ? '' : String(v).replace(/\s+/g, '').toUpperCase();
    return /^[0-9]{2}[A-HJ-NP-Z]$/.test(s) ? s : '';
  }
  function iso(v) {
    if (!v) return '';
    var t = Date.parse(v);
    return isNaN(t) ? String(v) : new Date(t).toISOString();
  }
  function numero(v) { var n = Number(v); return isFinite(n) ? n : 0; }

  function normalizarNomeCampo(nome) {
    var s = String(nome === null || nome === undefined ? '' : nome).toLowerCase();
    if (s.normalize) s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
    return s.replace(/[^a-z0-9%]+/g, ' ').trim();
  }
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
  function numeroOu(v, padrao, min, max) {
    var n = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v.replace(',', '.')) : NaN);
    if (!isFinite(n)) return padrao;
    return Math.max(min, Math.min(max, n));
  }
  function idSimples(v, prefixo, i) {
    var s = limparTexto(v, 40);
    return /^[A-Za-z0-9_-]{1,40}$/.test(s) ? s : prefixo + (i + 1);
  }

  // ---------------------------------------------------------------------------
  // Formulário do processo (config.formulario): o que perguntar na identificação do candidato.
  // Mesma regra de disc_interno.normalizar_formulario (banco) e de js/api-simulada.js.
  // ---------------------------------------------------------------------------
  var MODOS_CAMPO = ['obrigatorio', 'opcional', 'oculto'];
  var CAMPOS_FORMULARIO = ['idade', 'funcao', 'empresa', 'email', 'cidade', 'foto'];
  var FORMULARIO_PADRAO = { idade: 'obrigatorio', funcao: 'opcional', empresa: 'opcional', email: 'oculto', cidade: 'oculto', foto: 'opcional' };
  var MAX_PERGUNTAS = 5;

  /** {campos:{idade,funcao,empresa,email,cidade,foto: 'obrigatorio'|'opcional'|'oculto'}, perguntas:[{id,texto,obrigatoria}],
   *  parte2:'desligada'|'ligada'} */
  function normalizarFormulario(f) {
    f = f && typeof f === 'object' && !Array.isArray(f) ? f : {};
    var origem = f.campos && typeof f.campos === 'object' && !Array.isArray(f.campos) ? f.campos : {};
    var campos = {};
    CAMPOS_FORMULARIO.forEach(function (k) {
      campos[k] = typeof origem[k] === 'string' && MODOS_CAMPO.indexOf(origem[k]) >= 0 ? origem[k] : FORMULARIO_PADRAO[k];
    });
    var perguntas = [];
    var usados = {};
    (Array.isArray(f.perguntas) ? f.perguntas : []).forEach(function (p) {
      if (perguntas.length >= MAX_PERGUNTAS) return;
      if (!p || typeof p !== 'object' || Array.isArray(p)) return;
      var texto = limparTexto(p.texto, 200);
      if (texto.length < 3) return;
      var id = typeof p.id === 'string' ? p.id : '';
      if (!/^[a-z0-9_]{1,20}$/.test(id) || usados[id]) {
        var n = 1;
        while (usados['p' + n]) n++;
        id = 'p' + n;
      }
      usados[id] = true;
      perguntas.push({ id: id, texto: texto, obrigatoria: p.obrigatoria === true });
    });
    return { campos: campos, perguntas: perguntas, parte2: f.parte2 === 'ligada' ? 'ligada' : 'desligada' };
  }
  // ---------------------------------------------------------------------------
  // Parte 2 (perfil exigido pelo trabalho): 40 dígitos, 10 grupos × 4 na ordem D,I,S,C, cada grupo uma
  // permutação de 1..4. Usa DISC_EXIGIDO (js/disc-exigido.js) quando carregado; senão o cálculo mínimo
  // com a mesma regra (total por letra nos 10 grupos = percentual; código = maior + segundo, empate D,I,S,C).
  // ---------------------------------------------------------------------------
  function moduloExigido() {
    if (root && root.DISC_EXIGIDO) return root.DISC_EXIGIDO;
    if (typeof require === 'function') {
      try { return require('./disc-exigido.js'); } catch (e) { /* usa o cálculo local */ }
    }
    return null;
  }
  function exigidoValido(str) {
    if (typeof str !== 'string' || !/^[1-4]{40}$/.test(str)) return false;
    for (var g = 0; g < 10; g++) {
      if (str.substr(g * 4, 4).split('').sort().join('') !== '1234') return false;
    }
    return true;
  }
  /** exigido (string) -> {percentuais:{D,I,S,C}, codigo} ou null se ausente/inválido. */
  function calcularExigido(str) {
    str = typeof str === 'string' ? str.replace(/\D/g, '') : '';
    if (!exigidoValido(str)) return null;
    var m = moduloExigido();
    if (m && typeof m.calcular === 'function') {
      try {
        var r = m.calcular(str);
        if (r && r.percentuais) return { percentuais: r.percentuais, codigo: r.codigo };
      } catch (e) { /* usa o cálculo local */ }
    }
    var letras = ['D', 'I', 'S', 'C'];
    var tot = { D: 0, I: 0, S: 0, C: 0 };
    for (var i = 0; i < 40; i++) tot[letras[i % 4]] += Number(str[i]);
    var ordem = letras.slice().sort(function (a, b) { return tot[b] - tot[a]; });
    return { percentuais: { D: tot.D, I: tot.I, S: tot.S, C: tot.C }, codigo: ordem[0] + ordem[1] };
  }

  /** Foto aceita pelo servidor: data URL JPEG (base64 começando em "/9j/") com até 40 000 caracteres. */
  function fotoValida(str) {
    return typeof str === 'string' && str.length <= FOTO_MAX && RE_FOTO.test(str);
  }
  function fotoOuVazio(str) { return fotoValida(str) ? str : ''; }

  /** Mensagem de recusa se alguma pergunta extra pede dado sensível (sem exceções); senão ''. */
  function perguntaSensivel(f) {
    var lista = f && typeof f === 'object' && Array.isArray(f.perguntas) ? f.perguntas : [];
    for (var i = 0; i < lista.length; i++) {
      var p = lista[i];
      if (!p || typeof p !== 'object' || Array.isArray(p)) continue;
      var texto = limparTexto(p.texto, 200);
      if (texto && classificarCampo(texto, {}) !== '') return 'A pergunta "' + texto + '" pede um dado sensível e não pode ser usada.';
    }
    return '';
  }

  /** Mesma validação do Code.gs (validarConfigProcesso) + formulário: {ok, config} ou {ok:false, erro}. */
  function validarConfigProcesso(c) {
    if (c === undefined || c === null) c = {};
    if (typeof c !== 'object' || Array.isArray(c)) return { ok: false, erro: 'Configuração do processo inválida.' };
    var json;
    try { json = JSON.stringify(c); } catch (e) { return { ok: false, erro: 'Configuração do processo inválida.' }; }
    if (json.length > 40000) return { ok: false, erro: 'Configuração do processo grande demais.' };
    var perfil = String(c.perfilIdeal || '').toUpperCase().replace(/[^DISC]/g, '');
    if (perfil.length > 2 || (perfil.length === 2 && perfil[0] === perfil[1])) return { ok: false, erro: 'Perfil ideal inválido: use 1 ou 2 letras entre D, I, S e C.' };
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
      var id = idSimples(v, prefixo, i);
      while (ids[id]) id = id + '_';
      ids[id] = true;
      return id;
    }
    var etapas = (Array.isArray(c.etapas) ? c.etapas : []).slice(0, 20).map(function (e, i) {
      e = e && typeof e === 'object' ? e : {};
      return {
        id: idUnico(e.id, 'etapa', i), nome: limparTexto(e.nome, 80) || ('Etapa ' + (i + 1)),
        peso: numeroOu(e.peso, 0, 0, 1000), campo: campo(e.campo), descricao: limparTextoLongo(e.descricao, 1000)
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
          if (chave) pontos[chave] = numeroOu(origem[k], 0, -100, 100);
        });
        r = { tipo: 'mapa', pontos: pontos };
      } else {
        r = { tipo: 'checkbox', pontos: numeroOu(regra.pontos, 0, -100, 100) };
      }
      return { id: idUnico(b.id, 'bonus', i), nome: limparTexto(b.nome, 80) || ('Bônus ' + (i + 1)), campo: campo(b.campo), regra: r };
    });
    if (problema) return { ok: false, erro: problema };
    var sensivel = perguntaSensivel(c.formulario);
    if (sensivel) return { ok: false, erro: sensivel };
    var corte = numeroOu(c.corte, 70, 0, 200);
    var faixa = numeroOu(c.faixaAvaliar, 55, 0, 200);
    if (faixa > corte) return { ok: false, erro: 'A faixa "avaliar" precisa ser menor ou igual à nota de corte.' };
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
        permitirSaude: c.permitirSaude === true,
        formulario: normalizarFormulario(c.formulario)
      }
    };
  }

  // ---------------------------------------------------------------------------
  // Erros (mesmo formato do js/api.js)
  // ---------------------------------------------------------------------------

  function erroDaResposta(json) {
    var e = new Error((json && json.erro) ? String(json.erro) : MSG_RECUSA);
    e.sessaoExpirada = !!(json && json.sessaoExpirada);
    e.resposta = json || null;
    return e;
  }
  function recusa(msg, extra) {
    var json = { ok: false, erro: msg };
    if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) json[k] = extra[k];
    return erroDaResposta(json);
  }
  function erroSessao() { return recusa(MSG_SESSAO, { sessaoExpirada: true }); }

  function exigir(valor, mensagem) {
    if (valor === undefined || valor === null || valor === '') throw new Error(mensagem);
  }
  function exigirToken(token) {
    if (typeof token !== 'string' || !token) throw erroSessao();
  }
  function seguro(fn) {
    return function () {
      try { return Promise.resolve(fn.apply(null, arguments)); } catch (e) { return Promise.reject(e); }
    };
  }

  function ehFalhaDeRede(erro) {
    var m = String((erro && (erro.message || erro.details)) || '');
    var nome = String((erro && erro.name) || '');
    return nome === 'TypeError' || nome === 'AuthRetryableFetchError' || nome === 'FunctionsFetchError' ||
      /Failed to fetch|NetworkError|Load failed|fetch failed|ECONNREFUSED|ENOTFOUND/i.test(m);
  }
  function ehErroDeSessao(erro) {
    if (!erro) return false;
    var codigo = String(erro.code || '');
    var m = String(erro.message || '');
    return codigo === 'PGRST301' || codigo === 'PGRST302' || codigo === 'PGRST303' || erro.status === 401 ||
      /JWT|jwt expired|invalid claim|session.*(missing|not found)|refresh token/i.test(m);
  }

  /** Erro do PostgREST/RPC -> Error em pt-BR. Mensagens dos gatilhos do banco (RAISE) passam como estão. */
  function erroDoBanco(erro) {
    if (ehErroDeSessao(erro)) return erroSessao();
    if (ehFalhaDeRede(erro)) return new Error(MSG_CONEXAO);
    var codigo = String((erro && erro.code) || '');
    if (codigo === '42501') return recusa(MSG_SEM_PERMISSAO);
    if (codigo === 'PGRST202' || codigo === '42883') {
      var velho = recusa(MSG_BANCO_DESATUALIZADO, { bancoDesatualizado: true });
      velho.bancoDesatualizado = true;
      return velho;
    }
    if (codigo === 'P0001' && erro.message) return recusa(String(erro.message));
    if (codigo === '23505') return recusa('Já existe um registro com estes dados.');
    if (codigo === '23514' || codigo === '22P02' || codigo === '22001' || codigo === '22007' || codigo === '22008') {
      return recusa('Dados inválidos. Confira os campos e tente de novo.');
    }
    return recusa(MSG_INTERNO);
  }

  /** Erro do Supabase Auth -> Error em pt-BR. */
  function erroDoAuth(erro, padrao) {
    if (!erro) return recusa(padrao || MSG_RECUSA);
    if (ehFalhaDeRede(erro)) return new Error(MSG_CONEXAO);
    var codigo = String(erro.code || '');
    var m = String(erro.message || '');
    if (erro.status === 429 || codigo === 'over_request_rate_limit' || codigo === 'over_email_send_rate_limit' || /rate limit/i.test(m)) {
      return recusa(codigo === 'over_email_send_rate_limit' || /email/i.test(m) ? 'Muitos e-mails em pouco tempo. Aguarde alguns minutos e tente de novo.' : MSG_BLOQUEIO);
    }
    if (codigo === 'invalid_credentials' || /invalid login credentials/i.test(m)) return recusa(MSG_LOGIN_INVALIDO);
    if (codigo === 'email_not_confirmed' || /email not confirmed/i.test(m)) return recusa('Confirme o seu e-mail pelo link que o Supabase enviou antes de entrar.');
    if (codigo === 'same_password' || /should be different/i.test(m)) return recusa('A nova senha precisa ser diferente da atual.');
    if (codigo === 'weak_password' || /weak|password should/i.test(m)) return recusa('Senha fraca demais. Use pelo menos ' + SENHA_MIN + ' caracteres, misturando letras e números.');
    if (codigo === 'user_banned') return recusa(MSG_SEM_PERMISSAO);
    if (codigo === 'session_not_found' || codigo === 'session_expired' || codigo === 'refresh_token_not_found' ||
        erro.name === 'AuthSessionMissingError' || erro.status === 401) return erroSessao();
    return recusa(padrao || MSG_RECUSA);
  }

  /** Promise com prazo: depois de ms rejeita com a mensagem de demora (e aborta, se der). */
  function comPrazo(promessa, ms, controle) {
    var timer;
    var tempo = new Promise(function (_, rejeitar) {
      timer = setTimeout(function () {
        if (controle) try { controle.abort(); } catch (e) { /* ignora */ }
        rejeitar(new Error(MSG_DEMORA));
      }, ms);
    });
    return Promise.race([Promise.resolve(promessa), tempo]).then(
      function (v) { clearTimeout(timer); return v; },
      function (e) { clearTimeout(timer); throw e; });
  }

  // ---------------------------------------------------------------------------
  // Endereço da página (link de recuperação/convite e base do site)
  // ---------------------------------------------------------------------------

  /** Lê o resultado de um link do Supabase Auth no endereço (#access_token=…&type=recovery, #error=…). */
  function lerLinkDeAcesso(local) {
    var hash = String((local && local.hash) || '').replace(/^#/, '');
    var busca = String((local && local.search) || '').replace(/^\?/, '');
    var p = {};
    (hash + '&' + busca).split('&').forEach(function (par) {
      if (!par) return;
      var i = par.indexOf('=');
      var k = i === -1 ? par : par.slice(0, i);
      var v = i === -1 ? '' : par.slice(i + 1);
      try { v = decodeURIComponent(v.replace(/\+/g, ' ')); } catch (e) { /* mantém */ }
      if (!Object.prototype.hasOwnProperty.call(p, k)) p[k] = v;
    });
    var tipo = ['recovery', 'invite', 'signup', 'magiclink', 'email_change'].indexOf(p.type) >= 0 ? p.type : '';
    var erro = '';
    if (p.error || p.error_code) erro = MSG_LINK_EXPIRADO;
    return { tipo: (p.access_token || p.code || p.token_hash) ? tipo : (erro ? tipo : ''), erro: erro, temSessao: !!(p.access_token || p.code) };
  }

  /** Endereço do painel (mesma pasta da página atual + admin.html). */
  function enderecoDoPainel(local) {
    if (!local || !local.origin || !/^https?:/.test(String(local.origin))) return '';
    var caminho = String(local.pathname || '/');
    return local.origin + caminho.replace(/[^\/]*$/, '') + 'admin.html';
  }

  // ---------------------------------------------------------------------------
  // Conversões banco -> formato do Code.gs
  // ---------------------------------------------------------------------------

  function contagemRespostas(linha) {
    var r = linha && linha.respostas;
    if (Array.isArray(r) && r.length && r[0] && r[0].count !== undefined) return numero(r[0].count);
    if (typeof r === 'number') return r;
    return 0;
  }

  /** Processo (linha de public.processos) no formato de processos.listar do Code.gs. */
  function processoPublico(l) {
    var cfg = validarConfigProcesso(l.config && typeof l.config === 'object' ? l.config : {});
    return {
      id: String(l.id), codigo: l.codigo || '', empresaId: l.empresa_id ? String(l.empresa_id) : '', empresaNome: l.empresa || '',
      nome: l.nome || '', tipo: TIPOS.indexOf(l.tipo) >= 0 ? l.tipo : 'selecao',
      mostrarResultado: l.mostrar_resultado === true, ativa: l.ativo === true,
      criadaEm: iso(l.criado_em), respostas: contagemRespostas(l),
      empresa: l.empresa || '', vaga: l.vaga || '', cidade: l.cidade || '', consultor: l.consultor || '',
      contratante: l.contratante || '',
      periodo: { inicio: l.periodo_inicio ? String(l.periodo_inicio).slice(0, 10) : '', fim: l.periodo_fim ? String(l.periodo_fim).slice(0, 10) : '' },
      clickupListId: l.clickup_list_id || '',
      config: cfg.ok ? cfg.config : validarConfigProcesso({}).config
    };
  }
  function avaliacaoPublica(l) {
    var p = processoPublico(l);
    return { id: p.id, codigo: p.codigo, empresaId: p.empresaId, empresaNome: p.empresaNome, nome: p.nome, tipo: p.tipo,
      mostrarResultado: p.mostrarResultado, ativa: p.ativa, criadaEm: p.criadaEm, respostas: p.respostas };
  }

  function calcularDisc(respostas, linha, scoring) {
    if (!/^[1-4]{100}$/.test(respostas)) return null;
    if (scoring && typeof scoring.calcular === 'function' && typeof scoring.descompactar === 'function') {
      try {
        var r = scoring.calcular(scoring.descompactar(respostas));
        if (r && r.percentuais) return { percentuais: r.percentuais, codigo: r.codigo };
      } catch (e) { /* usa o que o servidor gravou */ }
    }
    var p = {};
    LETRAS.forEach(function (l) { p[l] = numero(linha[l.toLowerCase()]); });
    return { percentuais: p, codigo: linha.perfil || '' };
  }

  /** Ficha embutida (pessoas(...)) -> {id, nome, telefone, idade, funcao, empresa, email, cidade, atualizadoEm} ou null. */
  function pessoaDaLinha(p) {
    if (Array.isArray(p)) p = p[0];
    if (!p || typeof p !== 'object' || !p.id) return null;
    var idade = p.idade === null || p.idade === undefined || p.idade === '' ? null : Number(p.idade);
    return {
      id: String(p.id), nome: p.nome || '', telefone: String(p.telefone || '').replace(/\D/g, ''),
      idade: isFinite(idade) ? idade : null, funcao: p.funcao || '', empresa: p.empresa || '',
      email: p.email || '', cidade: p.cidade || '', foto: fotoOuVazio(p.foto), atualizadoEm: iso(p.atualizado_em)
    };
  }
  /** Respostas das perguntas extras gravadas: [{id, pergunta, resposta}] (o que não tiver esse formato sai). */
  function extrasDaLinha(x) {
    if (!Array.isArray(x)) return [];
    return x.filter(function (e) { return e && typeof e === 'object' && !Array.isArray(e); }).map(function (e) {
      return { id: String(e.id || ''), pergunta: String(e.pergunta || ''), resposta: String(e.resposta || '') };
    });
  }

  /** Linha de public.respostas (com processos e pessoas embutidos) no item de "listar" do Code.gs + pessoa. */
  function itemDaLinha(l, scoring) {
    var base = l.payload && typeof l.payload === 'object' ? l.payload : {};
    var proc = l.processos && typeof l.processos === 'object' && !Array.isArray(l.processos) ? l.processos : null;
    var respostas = String(l.respostas || '').replace(/\D/g, '');
    var validacao = l.validacao && typeof l.validacao === 'object' && !Array.isArray(l.validacao) ? l.validacao
      : (base.validacao && typeof base.validacao === 'object' && !Array.isArray(base.validacao) ? base.validacao : null);
    var idade = l.idade === null || l.idade === undefined || l.idade === '' ? null : Number(l.idade);
    return {
      v: 1,
      id: String(l.id),
      nome: l.nome || '',
      telefone: String(l.telefone || '').replace(/\D/g, ''),
      vaga: l.vaga || '',
      consentimento: base.consentimento === true,
      inicio: iso(l.inicio),
      fim: iso(l.fim),
      duracaoSeg: numero(l.duracao_seg),
      respostas: respostas,
      resultado: calcularDisc(respostas, l, scoring),
      exigido: exigidoValido(l.exigido) ? l.exigido : '',
      resultadoExigido: calcularExigido(l.exigido),
      foto: fotoOuVazio(l.foto),
      status: STATUS_VALIDOS.indexOf(l.status) >= 0 ? l.status : STATUS_PADRAO,
      observacoes: l.observacoes || '',
      recebidoEm: iso(l.recebido_em),
      protocolo: normalizarProtocolo(l.protocolo),
      idade: isFinite(idade) ? idade : null,
      funcao: l.funcao || '',
      empresa: l.empresa || '',
      avaliacao: normalizarCodigo(l.avaliacao),
      empresaId: '',
      validacao: validacao,
      processoId: l.processo_id ? String(l.processo_id) : '',
      empresaNome: proc ? (proc.empresa || '') : '',
      avaliacaoNome: proc ? (proc.nome || '') : '',
      avaliacaoTipo: proc && TIPOS.indexOf(proc.tipo) >= 0 ? proc.tipo : 'selecao',
      pessoaId: l.pessoa_id ? String(l.pessoa_id) : '',
      pessoa: pessoaDaLinha(l.pessoas),
      email: l.email || '',
      cidade: l.cidade || '',
      extras: extrasDaLinha(l.extras),
      historicoProcessos: historicoDaLinha(l.historico_processos),
      origem: l.origem === 'pessoal' ? 'pessoal' : 'processo'
    };
  }
  /** respostas.historico_processos -> [{de, para, deCodigo, paraCodigo, em}] (lixo vira lista vazia). */
  function historicoDaLinha(h) {
    if (!Array.isArray(h)) return [];
    return h.filter(function (e) { return e && typeof e === 'object' && !Array.isArray(e); }).map(function (e) {
      return { de: String(e.de || ''), para: String(e.para || ''), deCodigo: String(e.deCodigo || ''),
        paraCodigo: String(e.paraCodigo || ''), em: String(e.em || '') };
    });
  }
  /** empresas.organograma.topoIds só com ids de colaboradores ativos (sem repetir). */
  function topoDaLinha(organograma, ativos) {
    var ids = organograma && typeof organograma === 'object' && Array.isArray(organograma.topoIds) ? organograma.topoIds : [];
    var vistos = {};
    return ids.map(function (x) { return String(x); }).filter(function (x) {
      if (!ativos[x] || vistos[x]) return false;
      vistos[x] = true;
      return true;
    });
  }

  /** Linha de public.empresas no formato do painel (colaboradores = vínculos ativos). */
  function empresaDaLinha(l, colaboradores) {
    return {
      id: String(l.id), nome: l.nome || '', cidade: l.cidade || '', observacoes: l.observacoes || '',
      ativo: l.ativo !== false, criadoEm: iso(l.criado_em), atualizadoEm: iso(l.atualizado_em),
      colaboradores: numero(colaboradores)
    };
  }
  function dataCurta(v) { return v ? String(v).slice(0, 10) : ''; }

  /** Vínculo (com pessoas(…, respostas(…)) embutido) -> colaborador do painel, com o resultado mais recente. */
  function colaboradorDaLinha(v, scoring) {
    var p = Array.isArray(v.pessoas) ? v.pessoas[0] : v.pessoas;
    p = p && typeof p === 'object' ? p : {};
    var resps = (Array.isArray(p.respostas) ? p.respostas : []).filter(function (r) { return r && typeof r === 'object'; })
      .slice().sort(function (a, b) { return String(b.recebido_em || '').localeCompare(String(a.recebido_em || '')); });
    var ultima = resps[0] || null;
    var resultado = ultima ? calcularDisc(String(ultima.respostas || '').replace(/\D/g, ''), ultima, scoring) : null;
    return {
      vinculoId: String(v.id), pessoaId: String(v.pessoa_id || p.id || ''), nome: p.nome || '',
      telefone: String(p.telefone || '').replace(/\D/g, ''), cargo: v.cargo || '', area: v.area || '',
      status: v.status === 'desligado' ? 'desligado' : 'ativo', inicio: dataCurta(v.inicio), fim: dataCurta(v.fim),
      resultado: resultado, respondidoEm: resultado && ultima ? iso(ultima.recebido_em) : '',
      exigido: ultima ? calcularExigido(ultima.exigido) : null,
      foto: fotoOuVazio(p.foto)
    };
  }
  function colaboradorDaRpc(c) {
    c = c && typeof c === 'object' ? c : {};
    return {
      vinculoId: String(c.vinculoId || ''), pessoaId: String(c.pessoaId || ''), empresaId: String(c.empresaId || ''),
      nome: c.nome || '', telefone: String(c.telefone || '').replace(/\D/g, ''), cargo: c.cargo || '', area: c.area || '',
      status: c.status === 'desligado' ? 'desligado' : 'ativo', inicio: dataCurta(c.inicio), fim: dataCurta(c.fim)
    };
  }
  function porNome(a, b) { return String(a.nome).localeCompare(String(b.nome), 'pt-BR'); }

  /** Endereço do site (pasta da página atual), terminando em "/". '' fora do navegador. */
  function baseDoSite(local) {
    var painel = enderecoDoPainel(local);
    return painel ? painel.replace(/admin\.html$/, '') : '';
  }

  // ---------------------------------------------------------------------------
  // Venda direta (B2C) — formatos (mesmos de js/api-simulada.js)
  // ---------------------------------------------------------------------------
  var STATUS_PEDIDO = ['aguardando', 'pago', 'cortesia', 'estornado', 'cancelado'];
  var PERIODOS_VENDAS = ['hoje', '7d', '30d', 'mes', 'tudo'];
  var RE_TOKEN_VENDA = /^[0-9a-f]{64}$/;
  var RE_CUPOM = /^[A-Z0-9_-]{3,30}$/;
  var MSG_PAG_NAO_CONFIGURADO = 'Pagamento ainda não configurado.';
  var MSG_EMAIL_NAO_CONFIGURADO = 'O envio por e-mail ainda não está configurado. Fale com o suporte.';
  var MSG_PEDIDO_NAO_ENCONTRADO = 'Pedido não encontrado.';
  var MSG_RESUMO_NAO_ENCONTRADO = 'Resultado não encontrado. Faça o teste de novo.';
  var MSG_LINK_RELATORIO = 'Link inválido. Confira o endereço ou use "Recuperar meu relatório".';

  function inteiroOuNulo(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? Math.round(n) : null;
  }
  function dataOuVazio(v) {
    var d = limparTexto(v, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d)) ? d : '';
  }
  function normalizarCupom(v) { return String(v == null ? '' : v).replace(/\s+/g, '').toUpperCase(); }
  function descricaoPacote(d) {
    d = d && typeof d === 'object' && !Array.isArray(d) ? d : {};
    return { subtitulo: limparTexto(d.subtitulo, 200),
      itens: (Array.isArray(d.itens) ? d.itens : []).map(function (x) { return limparTexto(x, 200); }).filter(Boolean).slice(0, 20) };
  }
  /** Preço que vale hoje (centavos) — mesma regra de disc_interno.preco_atual (data em Brasília). */
  function precoAtual(p, hoje) {
    var lanc = inteiroOuNulo(p.precoLancamentoCentavos);
    if (lanc !== null && (!p.lancamentoAte || p.lancamentoAte >= hoje)) return lanc;
    return inteiroOuNulo(p.precoCentavos) || 0;
  }
  function hojeBrasil(agoraMs) { return new Date((agoraMs || Date.now()) - 3 * 3600000).toISOString().slice(0, 10); }
  function pacoteDaLinha(l) {
    var p = {
      chave: String(l.chave || ''), nome: l.nome || '', precoCentavos: numero(l.preco_centavos),
      precoLancamentoCentavos: inteiroOuNulo(l.preco_lancamento_centavos), lancamentoAte: dataOuVazio(l.lancamento_ate),
      ativo: l.ativo !== false, ordem: numero(l.ordem), descricao: descricaoPacote(l.descricao), atualizadoEm: iso(l.atualizado_em)
    };
    p.valorCentavos = precoAtual(p, hojeBrasil());
    p.emLancamento = p.valorCentavos !== p.precoCentavos;
    return p;
  }
  function pacotePublico(p) {
    return { chave: String(p.chave || ''), nome: p.nome || '', precoCentavos: numero(p.precoCentavos),
      precoLancamentoCentavos: inteiroOuNulo(p.precoLancamentoCentavos), lancamentoAte: dataOuVazio(p.lancamentoAte),
      valorCentavos: numero(p.valorCentavos), emLancamento: p.emLancamento === true, descricao: descricaoPacote(p.descricao),
      ordem: numero(p.ordem) };
  }
  function cupomDaLinha(l) {
    return { codigo: String(l.codigo || ''), tipo: l.tipo === 'valor' ? 'valor' : 'percentual', valor: numero(l.valor),
      usosMax: inteiroOuNulo(l.usos_max), usos: numero(l.usos), validoAte: dataOuVazio(l.valido_ate), ativo: l.ativo !== false,
      pacotes: (Array.isArray(l.pacotes) ? l.pacotes : []).map(String), descricao: l.descricao || '', criadoEm: iso(l.criado_em) };
  }
  function pedidoDaLinha(l) {
    var pag = l.pagamento && typeof l.pagamento === 'object' ? l.pagamento : {};
    return { id: String(l.id || ''), respostaId: l.resposta_id ? String(l.resposta_id) : '', pacote: String(l.pacote || ''),
      valorCentavos: numero(l.valor_centavos), valorOriginalCentavos: numero(l.valor_original_centavos), cupom: l.cupom || '',
      status: STATUS_PEDIDO.indexOf(l.status) >= 0 ? l.status : 'aguardando', metodo: l.metodo || '',
      provedor: l.provedor || (l.asaas_cobranca_id ? 'asaas' : ''), provedorRef: l.provedor_ref || '',
      asaasCobrancaId: l.asaas_cobranca_id || '',
      faturaUrl: l.checkout_url ? String(l.checkout_url) : (typeof pag.cartaoUrl === 'string' ? pag.cartaoUrl : ''),
      email: l.email || '', nome: l.nome || '', criadoEm: iso(l.criado_em), pagoEm: iso(l.pago_em), reembolsadoEm: iso(l.reembolsado_em) };
  }
  /** Pedido do painel vindo da RPC (pedido_json) -> mesmo formato de pedidoDaLinha. */
  function pedidoDaRpc(p) {
    p = p && typeof p === 'object' ? p : {};
    return { id: String(p.id || ''), respostaId: String(p.respostaId || ''), pacote: String(p.pacote || ''),
      valorCentavos: numero(p.valorCentavos), valorOriginalCentavos: numero(p.valorOriginalCentavos), cupom: p.cupom || '',
      status: STATUS_PEDIDO.indexOf(p.status) >= 0 ? p.status : 'aguardando', metodo: p.metodo || '',
      provedor: p.provedor || (p.asaasCobrancaId ? 'asaas' : ''), provedorRef: p.provedorRef || '',
      asaasCobrancaId: p.asaasCobrancaId || '', faturaUrl: p.checkoutUrl ? String(p.checkoutUrl) : '', email: p.email || '', nome: p.nome || '',
      criadoEm: iso(p.criadoEm), pagoEm: iso(p.pagoEm), reembolsadoEm: iso(p.reembolsadoEm) };
  }
  /** Validação do cupom do painel. {ok, linha} | {ok:false, erro} */
  function validarCupom(c) {
    if (!c || typeof c !== 'object') return { ok: false, erro: 'Dados do cupom ausentes.' };
    var codigo = normalizarCupom(c.codigo);
    if (!RE_CUPOM.test(codigo)) return { ok: false, erro: 'Código do cupom: 3 a 30 letras, números, - ou _ (sem espaço).' };
    var tipo = c.tipo === 'valor' ? 'valor' : (c.tipo === 'percentual' ? 'percentual' : '');
    if (!tipo) return { ok: false, erro: 'Escolha o tipo do cupom: percentual ou valor.' };
    var valor = inteiroOuNulo(c.valor);
    if (valor === null || valor <= 0) return { ok: false, erro: 'Informe o desconto do cupom.' };
    if (tipo === 'percentual' && valor > 100) return { ok: false, erro: 'O desconto percentual vai de 1 a 100.' };
    var usosMax = inteiroOuNulo(c.usosMax);
    if (usosMax !== null && usosMax < 1) usosMax = null;
    var validoAte = c.validoAte ? dataOuVazio(c.validoAte) : '';
    if (c.validoAte && !validoAte) return { ok: false, erro: 'Data de validade inválida.' };
    var pacotes = (Array.isArray(c.pacotes) ? c.pacotes : []).map(function (x) { return limparTexto(x, 30); })
      .filter(function (x) { return /^[a-z0-9_]{2,30}$/.test(x); });
    return { ok: true, linha: { codigo: codigo, tipo: tipo, valor: valor, usos_max: usosMax, valido_ate: validoAte || null,
      ativo: c.ativo !== false, pacotes: pacotes, descricao: limparTexto(c.descricao, 200) } };
  }

  // ---------------------------------------------------------------------------
  // Cliente
  // ---------------------------------------------------------------------------

  /**
   * opcoes: { supabase (biblioteca com createClient) | cliente (já criado), url, chave, local (window.location),
   *           scoring (DISC_SCORING), timeoutMs, timeoutLongoMs }
   */
  function criar(opcoes) {
    opcoes = opcoes || {};
    var local = opcoes.local || null;
    var prazo = opcoes.timeoutMs || TIMEOUT_MS;
    var prazoLongo = opcoes.timeoutLongoMs || TIMEOUT_LONGO_MS;
    var linkInicial = lerLinkDeAcesso(local);
    var clienteCriado = opcoes.cliente || null;

    function cliente() {
      if (clienteCriado) return clienteCriado;
      var lib = opcoes.supabase;
      if (!lib || typeof lib.createClient !== 'function') throw new Error('A biblioteca do Supabase não carregou. Recarregue a página.');
      if (!opcoes.url || !opcoes.chave) throw new Error('O Supabase não está configurado (SUPABASE_URL e SUPABASE_ANON_KEY em js/config.js).');
      clienteCriado = lib.createClient(opcoes.url, opcoes.chave, {
        auth: {
          persistSession: true, autoRefreshToken: true, detectSessionInUrl: true,
          flowType: 'implicit', storageKey: 'disc-supabase-auth'
        }
      });
      return clienteCriado;
    }
    // Link de recuperação/convite no endereço: cria o cliente já, para o supabase-js ler a sessão do #.
    if (linkInicial.temSessao) { try { cliente(); } catch (e) { /* o erro aparece na primeira chamada */ } }

    function scoring() { return opcoes.scoring || (root && root.DISC_SCORING) || null; }

    // ---- banco ----
    function rpc(nome, args) {
      return comPrazo(Promise.resolve().then(function () { return cliente().rpc(nome, args || {}); }), prazo)
        .then(function (r) {
          if (r && r.error) throw erroDoBanco(r.error);
          return r ? r.data : null;
        }, function (e) {
          if (e && e.message === MSG_DEMORA) throw e;
          if (e && (e.sessaoExpirada || e.resposta)) throw e;
          throw ehFalhaDeRede(e) ? new Error(MSG_CONEXAO) : e;
        });
    }
    /** RPC pública que devolve {ok, ...}: resolve com o JSON ou rejeita com erro.resposta. */
    function rpcOk(nome, args) {
      return rpc(nome, args).then(function (json) {
        if (typeof json === 'string') { try { json = JSON.parse(json); } catch (e) { json = null; } }
        if (!json || json.ok !== true) throw erroDaResposta(json && typeof json === 'object' ? json : { ok: false, erro: MSG_RECUSA });
        return json;
      });
    }
    /** Executa uma consulta do PostgREST (função que recebe o cliente) e devolve data (ou rejeita). */
    function consulta(fn) {
      return comPrazo(Promise.resolve().then(function () { return fn(cliente()); }), prazo).then(function (r) {
        if (r && r.error) throw erroDoBanco(r.error);
        return r ? r.data : null;
      }, function (e) {
        if (e && (e.message === MSG_DEMORA || e.sessaoExpirada || e.resposta)) throw e;
        throw ehFalhaDeRede(e) ? new Error(MSG_CONEXAO) : e;
      });
    }

    // ---- sessão ----
    function sessaoGuardada() {
      return Promise.resolve().then(function () { return cliente().auth.getSession(); }).then(function (r) {
        var s = r && r.data && r.data.session;
        if (r && r.error) throw erroDoAuth(r.error);
        return s || null;
      }, function (e) {
        throw ehFalhaDeRede(e) ? new Error(MSG_CONEXAO) : e;
      });
    }
    function exigirSessao(token) {
      exigirToken(token);
      return sessaoGuardada().then(function (s) {
        if (!s || !s.access_token) throw erroSessao();
        return s;
      });
    }

    /** Dados do usuário logado no formato do Code.gs (papel 'admin' só se estiver em public.admins). */
    function montarUsuario(sessao, eAdmin) {
      var u = (sessao && sessao.user) || {};
      var meta = u.user_metadata || {};
      var usuario = {
        id: String(u.id || ''), nome: limparTexto(meta.nome || meta.name || '', 120), email: String(u.email || ''),
        papel: eAdmin ? 'admin' : '', empresaId: '', empresaNome: '', foto: ''
      };
      if (!eAdmin) return Promise.resolve(usuario);
      return consulta(function (c) { return c.from('admins').select('nome, foto').eq('user_id', usuario.id).maybeSingle(); })
        .then(function (linha) {
          if (linha && linha.nome) usuario.nome = linha.nome;
          if (linha) usuario.foto = fotoOuVazio(linha.foto);
          return usuario;
        },
          function () { return usuario; })
        .then(function (x) { if (!x.nome) x.nome = x.email; return x; });
    }
    /** Depois de entrar: garante o 1º admin e monta {ok, token, usuario, primeiroAdmin?}. */
    function concluirEntrada(sessao) {
      return rpc('garantir_primeiro_admin').then(function (r) {
        if (typeof r === 'string') { try { r = JSON.parse(r); } catch (e) { r = null; } }
        if (r && r.ok === false) throw erroDaResposta(r);
        var eAdmin = !!(r && r.admin);
        return montarUsuario(sessao, eAdmin).then(function (usuario) {
          var resp = { ok: true, token: sessao.access_token, usuario: usuario };
          if (r && r.primeiro) {
            resp.primeiroAdmin = true;
            resp.aviso = 'Você é o primeiro administrador deste painel. Os próximos são convidados pela aba Usuários.';
          }
          return resp;
        });
      });
    }

    // ---- Edge Functions ----
    function lerCorpoErro(erro) {
      var ctx = erro && erro.context;
      if (!ctx || typeof ctx.json !== 'function') return Promise.resolve(null);
      return Promise.resolve().then(function () { return ctx.clone ? ctx.clone().json() : ctx.json(); }).catch(function () { return null; });
    }
    function invocar(nome, corpo, limiteMs) {
      var controle = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var opcoesInvoke = { body: corpo };
      if (controle) opcoesInvoke.signal = controle.signal;
      return comPrazo(Promise.resolve().then(function () { return cliente().functions.invoke(nome, opcoesInvoke); }), limiteMs || prazo, controle)
        .then(function (r) {
          var erro = r && r.error;
          if (!erro) return r ? r.data : null;
          return lerCorpoErro(erro).then(function (json) {
            var status = erro.context && erro.context.status;
            if (status === 401) throw erroSessao();
            if (json && typeof json === 'object' && json.erro) throw erroDaResposta(json);
            if (erro.name === 'FunctionsFetchError' || ehFalhaDeRede(erro)) throw new Error(MSG_CONEXAO);
            if (erro.name === 'FunctionsRelayError' || status === 404) {
              var ausente = recusa('A função "' + nome + '" não está publicada no Supabase. Confira as Edge Functions (docs/SUPABASE.md).');
              ausente.funcaoAusente = true;
              throw ausente;
            }
            throw recusa('O servidor respondeu com erro' + (status ? ' (código ' + status + ')' : '') + '. Tente novamente em instantes.');
          });
        }, function (e) {
          if (e && (e.message === MSG_DEMORA || e.sessaoExpirada || e.resposta)) throw e;
          throw ehFalhaDeRede(e) || (e && e.name === 'AbortError') ? new Error(MSG_CONEXAO) : e;
        })
        .then(function (data) {
          if (typeof data === 'string') { try { data = JSON.parse(data); } catch (e) { data = null; } }
          if (!data || typeof data !== 'object') throw new Error('Resposta inesperada do servidor. Confira se as Edge Functions do Supabase estão publicadas.');
          if (data.ok !== true) throw erroDaResposta(data);
          return data;
        });
    }
    /** Ação da Edge Function "admin" (exige sessão de administrador; o supabase-js manda o JWT). */
    function admin(token, acao, dados, limiteMs) {
      return exigirSessao(token).then(function () {
        var corpo = { acao: acao };
        if (dados) for (var k in dados) if (Object.prototype.hasOwnProperty.call(dados, k)) corpo[k] = dados[k];
        return invocar('admin', corpo, limiteMs);
      });
    }

    // ---- participantes ----
    function listarTodas(tabela, colunas, ordem) {
      var todas = [];
      function pagina(de) {
        return consulta(function (cl) {
          return cl.from(tabela).select(colunas).order(ordem, { ascending: true }).range(de, de + PAGINA - 1);
        }).then(function (linhas) {
          linhas = Array.isArray(linhas) ? linhas : [];
          todas = todas.concat(linhas);
          if (linhas.length < PAGINA || todas.length >= MAX_LINHAS) return todas;
          return pagina(de + PAGINA);
        });
      }
      return pagina(0);
    }

    function salvarProcesso(dados, legado) {
      var rotulo = legado ? 'avaliação' : 'processo';
      if (!dados || typeof dados !== 'object') return Promise.reject(recusa('Dados da ' + rotulo + ' ausentes.'));
      function veio(k) { return Object.prototype.hasOwnProperty.call(dados, k) && dados[k] !== undefined; }
      var id = limparTexto(dados.id, 40);
      var nome = limparTexto(dados.nome, 80);
      if (letrasContadas(nome) < 2) return Promise.reject(recusa('Informe o nome ' + (legado ? 'da avaliação.' : 'do processo.')));
      var tipo = limparTexto(dados.tipo, 20);
      if (!tipo) tipo = 'selecao';
      if (TIPOS.indexOf(tipo) === -1) return Promise.reject(recusa('Tipo inválido. Use: selecao ou equipe.'));
      var linha = { nome: nome, tipo: tipo };
      var textos = { empresa: 80, vaga: 120, cidade: 80, consultor: 80, contratante: 80 };
      Object.keys(textos).forEach(function (k) { if (veio(k)) linha[k] = limparTexto(dados[k], textos[k]); });
      if (!veio('empresa') && veio('empresaNome')) linha.empresa = limparTexto(dados.empresaNome, 80);
      if (veio('periodo')) {
        var per = dados.periodo && typeof dados.periodo === 'object' ? dados.periodo : {};
        var dataOk = function (d) { d = limparTexto(d, 10); return /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d)) ? d : null; };
        linha.periodo_inicio = dataOk(per.inicio);
        linha.periodo_fim = dataOk(per.fim);
      }
      if (veio('clickupListId')) {
        var lista = limparTexto(dados.clickupListId, 40);
        if (lista && !/^[A-Za-z0-9_-]{1,40}$/.test(lista)) return Promise.reject(recusa('ID da lista do ClickUp inválido.'));
        linha.clickup_list_id = lista || null;
      }
      if (veio('empresaId')) {
        // Empresa cadastrada (opcional). Ligando, o banco preenche o texto "empresa" se ele vier vazio.
        var empresaId = limparTexto(dados.empresaId, 40);
        if (empresaId && !RE_UUID.test(empresaId)) return Promise.reject(recusa('Escolha uma empresa válida.'));
        linha.empresa_id = empresaId || null;
      }
      if (veio('config')) {
        var cfg = validarConfigProcesso(dados.config);
        if (!cfg.ok) return Promise.reject(recusa(cfg.erro));
        linha.config = cfg.config;
      }
      var colunas = '*, respostas(count)';
      var naoAchou = legado ? 'Avaliação não encontrada.' : 'Processo não encontrado.';
      var feito;
      if (id) {
        if (!RE_UUID.test(id)) return Promise.reject(recusa(naoAchou));
        if (dados.ativa !== undefined) linha.ativo = dados.ativa === true;
        if (legado || veio('mostrarResultado')) linha.mostrar_resultado = dados.mostrarResultado === true;
        feito = consulta(function (c) { return c.from('processos').update(linha).eq('id', id).select(colunas); });
      } else {
        linha.ativo = dados.ativa !== false;
        linha.mostrar_resultado = dados.mostrarResultado === true;
        if (!linha.config) linha.config = validarConfigProcesso({}).config;
        feito = consulta(function (c) { return c.from('processos').insert(linha).select(colunas); });
      }
      return feito.then(function (linhas) {
        var l = Array.isArray(linhas) ? linhas[0] : linhas;
        if (!l) throw recusa(naoAchou);
        return legado ? { ok: true, avaliacao: avaliacaoPublica(l) } : { ok: true, processo: processoPublico(l) };
      });
    }

    function excluirProcesso(idBruto) {
      var id = limparTexto(idBruto, 40);
      if (!id || !RE_UUID.test(id)) return Promise.reject(recusa('Avaliação não encontrada.'));
      return consulta(function (c) { return c.from('processos').delete().eq('id', id).select('id'); }).then(function (linhas) {
        if (!Array.isArray(linhas) || !linhas.length) throw recusa('Avaliação não encontrada.');
        return { ok: true, id: id };
      });
    }

    function listarProcessos() {
      return consulta(function (c) {
        return c.from('processos').select('*, respostas(count)').order('criado_em', { ascending: true });
      }).then(function (linhas) { return Array.isArray(linhas) ? linhas : []; });
    }

    // ---- empresas, colaboradores e organograma ----
    function idValido(v) { var s = limparTexto(v, 40); return RE_UUID.test(s) ? s : ''; }

    function contarAtivos(empresaId) {
      return consulta(function (c) {
        var q = c.from('vinculos').select('empresa_id').eq('status', 'ativo');
        return empresaId ? q.eq('empresa_id', empresaId) : q;
      }).then(function (linhas) {
        var n = {};
        (Array.isArray(linhas) ? linhas : []).forEach(function (l) { n[l.empresa_id] = (n[l.empresa_id] || 0) + 1; });
        return n;
      });
    }

    function salvarEmpresa(dados) {
      if (!dados || typeof dados !== 'object') throw recusa('Dados da empresa ausentes.');
      function veio(k) { return Object.prototype.hasOwnProperty.call(dados, k) && dados[k] !== undefined; }
      var id = limparTexto(dados.id, 40);
      var nome = limparTexto(dados.nome, 120);
      if (letrasContadas(nome) < 1) throw recusa('Informe o nome da empresa.');
      if (id && !RE_UUID.test(id)) throw recusa('Empresa não encontrada.');
      var linha = { nome: nome };
      if (veio('cidade') || !id) linha.cidade = limparTexto(dados.cidade, 120);
      if (veio('observacoes') || !id) linha.observacoes = limparTextoLongo(dados.observacoes, 2000);
      if (veio('ativo') || !id) linha.ativo = dados.ativo !== false;
      return consulta(function (c) { return c.from('empresas').select('id, nome'); }).then(function (todas) {
        var igual = (Array.isArray(todas) ? todas : []).some(function (e) {
          return String(e.id) !== id && String(e.nome || '').toLowerCase() === nome.toLowerCase();
        });
        if (igual) throw recusa('Já existe uma empresa com esse nome.');
        return consulta(function (c) {
          return id ? c.from('empresas').update(linha).eq('id', id).select('*') : c.from('empresas').insert(linha).select('*');
        });
      }).then(function (linhas) {
        var l = Array.isArray(linhas) ? linhas[0] : linhas;
        if (!l) throw recusa('Empresa não encontrada.');
        return contarAtivos(String(l.id)).then(function (n) { return { ok: true, empresa: empresaDaLinha(l, n[l.id]) }; });
      });
    }

    function listarEquipe(empresaIdBruto) {
      var empresaId = idValido(empresaIdBruto);
      if (!empresaId) throw recusa('Empresa não encontrada.');
      return Promise.all([
        consulta(function (c) { return c.from('empresas').select('*').eq('id', empresaId).maybeSingle(); }),
        consulta(function (c) {
          return c.from('vinculos').select('*, pessoas(id, nome, telefone, foto, respostas(respostas, exigido, d, i, s, c, perfil, recebido_em))')
            .eq('empresa_id', empresaId).order('inicio', { ascending: true });
        }),
        consulta(function (c) { return c.from('relacoes').select('de_pessoa, para_pessoa, tipo').eq('empresa_id', empresaId); })
      ]).then(function (r) {
        var emp = r[0];
        if (!emp) throw recusa('Empresa não encontrada.');
        var sc = scoring();
        var todos = (Array.isArray(r[1]) ? r[1] : []).map(function (v) { return colaboradorDaLinha(v, sc); });
        var ativos = todos.filter(function (c) { return c.status === 'ativo'; }).sort(porNome);
        var historico = todos.filter(function (c) { return c.status !== 'ativo'; })
          .sort(function (a, b) { return String(b.fim).localeCompare(String(a.fim)); });
        var ids = {};
        ativos.forEach(function (c) { ids[c.pessoaId] = true; });
        var relacoes = (Array.isArray(r[2]) ? r[2] : []).map(function (x) {
          return { de: String(x.de_pessoa), para: String(x.para_pessoa), tipo: x.tipo };
        }).filter(function (x) { return ids[x.de] && ids[x.para] && TIPOS_RELACAO.indexOf(x.tipo) >= 0; });
        return { ok: true, empresa: empresaDaLinha(emp, ativos.length), colaboradores: ativos, relacoes: relacoes,
          topoIds: topoDaLinha(emp.organograma, ids), historico: historico };
      });
    }

    // ---- versão do banco (aviso de migração faltando no painel) ----
    function codigoDoErro(e) { return String((e && e.code) || ''); }
    function funcaoNaoExiste(e) {
      var c = codigoDoErro(e);
      return c === 'PGRST202' || c === '42883' || (e && e.status === 404 && /function/i.test(String(e.message || '')));
    }
    function faltaNoBanco(e) {
      var c = codigoDoErro(e);
      return c === '42P01' || c === 'PGRST205' || c === '42703' || c === 'PGRST204' || c === 'PGRST200';
    }
    /** Consulta leve (limit 0): true = existe, false = tabela/coluna não existe, null = não deu para saber. */
    function sondar(tabela, coluna) {
      return comPrazo(Promise.resolve().then(function () { return cliente().from(tabela).select(coluna).limit(0); }), prazo)
        .then(function (r) {
          if (r && r.error) {
            if (faltaNoBanco(r.error)) return false;
            if (ehFalhaDeRede(r.error)) throw new Error(MSG_CONEXAO);
            return null;
          }
          return true;
        }, function (e) {
          if (e && e.message === MSG_DEMORA) throw e;
          throw ehFalhaDeRede(e) ? new Error(MSG_CONEXAO) : e;
        });
    }
    function versaoPorSondagem() {
      var sondadas = MIGRACOES.filter(function (m) { return m.tabela; });
      return Promise.all(sondadas.map(function (m) { return sondar(m.tabela, m.coluna); })).then(function (res) {
        var faltando = [];
        var versao = Number(MIGRACOES[0].nome.slice(0, 14));
        sondadas.forEach(function (m, i) {
          if (res[i] === false) faltando.push(m.nome);
          else if (res[i] === true) versao = Math.max(versao, Number(m.nome.slice(0, 14)));
        });
        // Sem a função versao_banco (criada na 20261010) a 20261010 não está completa, nem as seguintes.
        var desde = MIGRACOES.map(function (m) { return m.nome; }).indexOf('20261010120000_mover_versao');
        MIGRACOES.slice(desde).forEach(function (m) { if (faltando.indexOf(m.nome) === -1) faltando.push(m.nome); });
        faltando.sort();
        return { ok: true, versao: versao, faltando: faltando, semFuncao: true };
      });
    }
    function versaoBanco() {
      return comPrazo(Promise.resolve().then(function () { return cliente().rpc('versao_banco', {}); }), prazo)
        .then(function (r) {
          if (r && r.error) {
            if (funcaoNaoExiste(r.error)) return versaoPorSondagem();
            throw erroDoBanco(r.error);
          }
          var j = r ? r.data : null;
          if (typeof j === 'string') { try { j = JSON.parse(j); } catch (e) { j = null; } }
          if (!j || j.ok !== true) throw erroDaResposta(j && typeof j === 'object' ? j : { ok: false, erro: MSG_RECUSA });
          var faltando = (Array.isArray(j.faltando) ? j.faltando : []).map(function (x) { return String(x); });
          // versao_banco de uma migração antiga não conhece as mais novas: as posteriores à versão dela faltam.
          MIGRACOES.forEach(function (m) {
            if (Number(m.nome.slice(0, 14)) > numero(j.versao) && faltando.indexOf(m.nome) === -1) faltando.push(m.nome);
          });
          return { ok: true, versao: numero(j.versao), faltando: faltando };
        }, function (e) {
          if (e && (e.message === MSG_DEMORA || e.sessaoExpirada || e.resposta)) throw e;
          throw ehFalhaDeRede(e) ? new Error(MSG_CONEXAO) : e;
        });
    }

    // ---- relatórios por modelo (tabela relatorios, direto com RLS) ----
    function urlRelatorio(token) { return baseDoSite(local) + 'relatorio.html?r=' + token; }
    var COLUNAS_REL_MODELO = 'id, token, modelo, status, empresa_id, pessoa_id, criado_em, atualizado_em, publicado_em, titulo:dados->>titulo';
    function relatorioModeloDaLinha(l) {
      var r = {
        id: String(l.id), token: String(l.token), modelo: l.modelo, status: l.status === 'publicado' ? 'publicado' : 'rascunho',
        titulo: l.titulo || '', empresaId: l.empresa_id ? String(l.empresa_id) : '', pessoaId: l.pessoa_id ? String(l.pessoa_id) : '',
        criadoEm: iso(l.criado_em), atualizadoEm: iso(l.atualizado_em), publicadoEm: iso(l.publicado_em)
      };
      if (r.status === 'publicado') r.url = urlRelatorio(r.token);
      return r;
    }

    function salvarRelatorioModelo(dados) {
      if (!dados || typeof dados !== 'object') throw recusa('Dados do relatório ausentes.');
      var modelo = limparTexto(dados.modelo, 20);
      if (MODELOS_RELATORIO.indexOf(modelo) === -1) throw recusa('Modelo de relatório inválido. Use: equipe, lideranca ou pessoa.');
      var id = limparTexto(dados.id, 40);
      if (id && !RE_UUID.test(id)) throw recusa('Relatório não encontrado.');
      var empresaId = limparTexto(dados.empresaId, 40);
      var pessoaId = limparTexto(dados.pessoaId, 40);
      if (empresaId && !RE_UUID.test(empresaId)) throw recusa('Empresa não encontrada.');
      if (pessoaId && !RE_UUID.test(pessoaId)) throw recusa('Pessoa não encontrada.');
      if (modelo === 'equipe' && !empresaId) throw recusa('Escolha a empresa do relatório.');
      if (modelo !== 'equipe' && !pessoaId) throw recusa('Escolha a pessoa do relatório.');
      var snap = dados.dados;
      if (!snap || typeof snap !== 'object' || Array.isArray(snap)) throw recusa('Relatório vazio: gere o relatório antes de salvar.');
      if (snap.modelo !== undefined && snap.modelo !== modelo) throw recusa('Os dados não são de um relatório "' + modelo + '".');
      var json;
      try { json = JSON.stringify(snap); } catch (e) { throw recusa('Dados do relatório inválidos.'); }
      if (json.length > MAX_DADOS_RELATORIO) throw recusa(MSG_REL_GRANDE);
      snap = JSON.parse(json);
      snap.modelo = modelo;
      var linha = { modelo: modelo, empresa_id: empresaId || null, pessoa_id: pessoaId || null, dados: snap };
      if (dados.publicar === true) linha.status = 'publicado';
      else if (dados.publicar === false || !id) linha.status = 'rascunho';
      return consulta(function (c) {
        return id ? c.from('relatorios').update(linha).eq('id', id).neq('modelo', 'processo').select(COLUNAS_REL_MODELO)
          : c.from('relatorios').insert(linha).select(COLUNAS_REL_MODELO);
      }).then(function (linhas) {
        var l = Array.isArray(linhas) ? linhas[0] : linhas;
        if (!l) throw recusa('Relatório não encontrado.');
        var r = relatorioModeloDaLinha(l);
        var saida = { id: r.id, token: r.token, status: r.status, modelo: r.modelo };
        if (r.url) saida.url = r.url;
        return { ok: true, relatorio: saida };
      });
    }

    var linkAtual = { tipo: linkInicial.tipo, erro: linkInicial.erro };

    var api = {
      supabase: true,
      backend: 'supabase',
      cliente: cliente,

      // --- públicas ---
      enviar: seguro(function (payload) {
        exigir(payload, 'Nenhum resultado para enviar.');
        return rpcOk('enviar_resposta', { p_payload: payload }).then(function (resp) {
          // Leva o resultado ao ClickUp em segundo plano. Idempotente; falha aqui nunca afeta o candidato.
          var id = resp.id || (payload && payload.id);
          if (id) {
            try { Promise.resolve(invocar('disc-sync', { id: String(id) }, prazo)).catch(function () { /* ignora */ }); }
            catch (e) { /* ignora */ }
          }
          var r = { ok: true, id: resp.id, protocolo: resp.protocolo };
          if (resp.duplicado) r = { ok: true, duplicado: true, id: resp.id, protocolo: resp.protocolo };
          return r;
        });
      }),
      avaliacaoPublica: seguro(function (codigo) {
        exigir(codigo, MSG_LINK_INVALIDO);
        return rpcOk('avaliacao_publica', { p_codigo: String(codigo) }).then(function (r) {
          var a = r.avaliacao && typeof r.avaliacao === 'object' ? r.avaliacao : r;
          return { ok: true, avaliacao: { codigo: a.codigo, nome: a.nome, tipo: a.tipo, empresaNome: a.empresaNome || '', mostrarResultado: a.mostrarResultado === true,
            formulario: normalizarFormulario(a.formulario) } };
        });
      }),
      relatorioPublico: seguro(function (relatorioToken) {
        exigir(relatorioToken, MSG_REL_NAO_ENCONTRADO);
        return rpcOk('relatorio_publico', { p_token: String(relatorioToken) }).then(function (r) {
          return { ok: true, modelo: MODELOS_RELATORIO.indexOf(r.modelo) >= 0 ? r.modelo : 'processo', relatorio: r.relatorio, publicadoEm: r.publicadoEm || '' };
        });
      }),
      // --- venda direta (B2C): públicas ---
      pacotesPublicos: seguro(function () {
        return rpcOk('pacotes_publicos', {}).then(function (r) {
          return { ok: true, pacotes: (Array.isArray(r.pacotes) ? r.pacotes : []).map(pacotePublico) };
        });
      }),
      enviarPessoal: seguro(function (payload) {
        exigir(payload, 'Nenhum resultado para enviar.');
        return rpcOk('enviar_resposta_pessoal', { p_payload: payload }).then(function (r) {
          var x = { ok: true, id: String(r.id || ''), protocolo: '', tokenResumo: String(r.tokenResumo || '') };
          if (r.duplicado) x.duplicado = true;
          return x;
        });
      }),
      resumoPessoal: seguro(function (tokenResumo) {
        if (!RE_TOKEN_VENDA.test(String(tokenResumo || ''))) throw recusa(MSG_RESUMO_NAO_ENCONTRADO);
        return rpcOk('resumo_pessoal', { p_token: String(tokenResumo) }).then(function (r) {
          return { ok: true, nome: r.nome || '', resultado: r.resultado || null, recebidoEm: iso(r.recebidoEm), temParte2: r.temParte2 === true };
        });
      }),
      criarPedido: seguro(function (tokenResumo, pacote, cupom) {
        if (!RE_TOKEN_VENDA.test(String(tokenResumo || ''))) throw recusa(MSG_RESUMO_NAO_ENCONTRADO);
        exigir(pacote, 'Escolha um pacote.');
        var args = { p_token_resumo: String(tokenResumo), p_pacote: String(pacote), p_cupom: normalizarCupom(cupom) || null };
        return rpcOk('criar_pedido', args).then(function (r) {
          var x = { ok: true, pedidoId: String(r.pedidoId || ''), tokenAcesso: String(r.tokenAcesso || ''), valor: numero(r.valor),
            valorOriginal: numero(r.valorOriginal), gratuito: r.gratuito === true, status: r.status || 'aguardando' };
          if (r.jaPago) x.jaPago = true;
          return x;
        });
      }),
      iniciarPagamento: seguro(function (pedidoId, tokenAcesso, dados) {
        exigir(pedidoId, MSG_PEDIDO_NAO_ENCONTRADO);
        exigir(tokenAcesso, MSG_PEDIDO_NAO_ENCONTRADO);
        var corpo = { acao: 'criar', pedidoId: String(pedidoId), tokenAcesso: String(tokenAcesso) };
        if (dados && dados.cpf) corpo.cpf = String(dados.cpf);
        return invocar('pagamento', corpo, prazo).then(function (r) {
          if (r.pago) return { ok: true, pago: true, status: r.status };
          if (r.provedor === 'stripe') {
            var cs = String(r.clientSecret || '');
            var pk = String(r.publicavel || '');
            if (!/^pi_[A-Za-z0-9]+_secret_[A-Za-z0-9]+$/.test(cs) || !/^pk_(test|live)_[A-Za-z0-9]+$/.test(pk)) {
              throw recusa('Não foi possível gerar o pagamento agora. Tente de novo em instantes.');
            }
            return { ok: true, provedor: 'stripe', clientSecret: cs, publicavel: pk, valor: numero(r.valor) };
          }
          if (r.redirecionarUrl) {
            var url = String(r.redirecionarUrl);
            if (!/^https:\/\//i.test(url)) throw recusa('Não foi possível gerar o pagamento agora. Tente de novo em instantes.');
            return { ok: true, provedor: 'infinitepay', redirecionarUrl: url, valor: numero(r.valor) };
          }
          return { ok: true, provedor: 'asaas', pix: r.pix && typeof r.pix === 'object' ? { qrBase64: String(r.pix.qrBase64 || ''),
            copiaECola: String(r.pix.copiaECola || ''), expira: String(r.pix.expira || '') } : null,
            cartaoUrl: String(r.cartaoUrl || ''), valor: numero(r.valor), vencimento: String(r.vencimento || '') };
        }, function (e) {
          var resp = e && e.resposta;
          if (e && e.funcaoAusente) return { ok: false, erro: MSG_PAG_NAO_CONFIGURADO, naoConfigurado: true };
          if (resp && resp.erro === MSG_PAG_NAO_CONFIGURADO) return { ok: false, erro: MSG_PAG_NAO_CONFIGURADO, naoConfigurado: true };
          if (resp && resp.precisaCpf) return { ok: false, erro: String(resp.erro), precisaCpf: true };
          throw e;
        });
      }),
      statusPedido: seguro(function (pedidoId, tokenAcesso) {
        exigir(pedidoId, MSG_PEDIDO_NAO_ENCONTRADO);
        exigir(tokenAcesso, MSG_PEDIDO_NAO_ENCONTRADO);
        var porRpc = function () {
          return rpcOk('status_pedido', { p_pedido: String(pedidoId), p_token: String(tokenAcesso) })
            .then(function (r) { return { ok: true, status: r.status }; });
        };
        // A Edge Function confere também no Asaas (cobre webhook perdido); fora do ar, lê direto do banco.
        return invocar('pagamento', { acao: 'status', pedidoId: String(pedidoId), tokenAcesso: String(tokenAcesso) }, prazo)
          .then(function (r) { return { ok: true, status: r.status }; }, function (e) {
            if (e && e.resposta && !e.funcaoAusente) throw e;
            return porRpc();
          });
      }),
      confirmarRetorno: seguro(function (pedidoId, tokenAcesso, dados) {
        exigir(pedidoId, MSG_PEDIDO_NAO_ENCONTRADO);
        exigir(tokenAcesso, MSG_PEDIDO_NAO_ENCONTRADO);
        var d = dados && typeof dados === 'object' ? dados : {};
        var ref = function (v) { var x = String(v == null ? '' : v).trim(); return /^[A-Za-z0-9._:-]{1,120}$/.test(x) ? x : ''; };
        var corpo = { acao: 'confirmar', pedidoId: String(pedidoId), tokenAcesso: String(tokenAcesso),
          transactionNsu: ref(d.transactionNsu), slug: ref(d.slug) };
        var pi = String(d.paymentIntent == null ? '' : d.paymentIntent).trim();
        if (/^pi_[A-Za-z0-9]{6,80}$/.test(pi)) corpo.paymentIntent = pi;
        return invocar('pagamento', corpo, prazo).then(function (r) { return { ok: true, status: r.status }; }, function (e) {
          if (e && e.resposta && !e.funcaoAusente) throw e;
          return rpcOk('status_pedido', { p_pedido: String(pedidoId), p_token: String(tokenAcesso) })
            .then(function (r) { return { ok: true, status: r.status }; });
        });
      }),
      relatorioPessoal: seguro(function (tokenAcesso) {
        if (!RE_TOKEN_VENDA.test(String(tokenAcesso || ''))) throw recusa(MSG_LINK_RELATORIO);
        return rpcOk('relatorio_pessoal', { p_token: String(tokenAcesso) }).then(function (r) {
          var ex = exigidoValido(r.exigido) ? r.exigido : '';
          return { ok: true, nome: r.nome || '', resultado: r.resultado || null, exigido: calcularExigido(ex), exigidoRespostas: ex,
            pacote: String(r.pacote || ''), pacoteNome: r.pacoteNome || '', precisaParte2: r.precisaParte2 === true, status: r.status || 'pago' };
        });
      }),
      salvarParte2Pessoal: seguro(function (tokenAcesso, exigido) {
        if (!RE_TOKEN_VENDA.test(String(tokenAcesso || ''))) throw recusa(MSG_LINK_RELATORIO);
        var ex = typeof exigido === 'string' ? exigido.replace(/\D/g, '') : '';
        if (!exigidoValido(ex)) throw recusa('Responda todos os grupos da segunda parte.');
        return rpcOk('salvar_parte2_pessoal', { p_token: String(tokenAcesso), p_exigido: ex }).then(function () {
          return { ok: true, exigido: calcularExigido(ex), exigidoRespostas: ex };
        });
      }),
      recuperarAcesso: seguro(function (email) {
        var e = normalizarEmail(email);
        if (!emailValido(e)) throw recusa('Informe um e-mail válido.');
        return invocar('pagamento', { acao: 'recuperar', email: e }, prazo).then(function () { return { ok: true }; }, function (err) {
          if (err && err.funcaoAusente) return { ok: false, erro: MSG_EMAIL_NAO_CONFIGURADO, naoConfigurado: true };
          if (err && err.resposta && err.resposta.erro === MSG_EMAIL_NAO_CONFIGURADO) {
            return { ok: false, erro: MSG_EMAIL_NAO_CONFIGURADO, naoConfigurado: true };
          }
          throw err;
        });
      }),

      // --- venda direta (B2C): painel (só admin; tabelas com RLS) ---
      listarPedidos: seguro(function (token, filtros) {
        var f = filtros && typeof filtros === 'object' ? filtros : {};
        return exigirSessao(token).then(function () {
          return consulta(function (c) {
            var q = c.from('pedidos').select('*');
            if (STATUS_PEDIDO.indexOf(f.status) >= 0) q = q.eq('status', f.status);
            if (dataOuVazio(f.de)) q = q.gte('criado_em', dataOuVazio(f.de) + 'T03:00:00Z');
            if (dataOuVazio(f.ate)) q = q.lt('criado_em', new Date(Date.parse(dataOuVazio(f.ate) + 'T03:00:00Z') + 86400000).toISOString());
            if (f.pacote) q = q.eq('pacote', limparTexto(f.pacote, 30));
            var lim = Math.max(1, Math.min(MAX_LINHAS, inteiroOuNulo(f.limite) || 500));
            return q.order('criado_em', { ascending: false }).limit(lim);
          });
        }).then(function (linhas) {
          // Pedidos de teste da aba Conexões (pedidos.teste) não são vendas: ficam fora da lista e da receita.
          var lista = (Array.isArray(linhas) ? linhas : []).filter(function (l) { return !(l && l.teste === true); }).map(pedidoDaLinha);
          var busca = normalizarNomeCampo(f.busca || '');
          if (busca) {
            lista = lista.filter(function (p) {
              return normalizarNomeCampo(p.nome + ' ' + p.email + ' ' + p.cupom + ' ' + p.id).indexOf(busca) >= 0;
            });
          }
          return { ok: true, pedidos: lista };
        });
      }),
      atualizarPedido: seguro(function (token, id, campos) {
        exigir(id, MSG_PEDIDO_NAO_ENCONTRADO);
        var status = campos && typeof campos === 'object' ? campos.status : campos;
        if (STATUS_PEDIDO.indexOf(status) < 0) throw recusa('Situação inválida.');
        return exigirSessao(token).then(function () { return rpcOk('atualizar_pedido', { p_id: String(id), p_status: status }); })
          .then(function (r) { return { ok: true, pedido: pedidoDaRpc(r.pedido) }; });
      }),
      listarCupons: seguro(function (token) {
        return exigirSessao(token).then(function () {
          return consulta(function (c) { return c.from('cupons').select('*').order('criado_em', { ascending: false }); });
        }).then(function (linhas) { return { ok: true, cupons: (Array.isArray(linhas) ? linhas : []).map(cupomDaLinha) }; });
      }),
      salvarCupom: seguro(function (token, cupom) {
        var v = validarCupom(cupom);
        if (!v.ok) throw recusa(v.erro);
        return exigirSessao(token).then(function () {
          return consulta(function (c) { return c.from('cupons').upsert(v.linha, { onConflict: 'codigo' }).select('*'); });
        }).then(function (linhas) {
          var l = Array.isArray(linhas) ? linhas[0] : linhas;
          return { ok: true, cupom: cupomDaLinha(l || v.linha) };
        });
      }),
      excluirCupom: seguro(function (token, codigo) {
        var cod = normalizarCupom(codigo);
        if (!RE_CUPOM.test(cod)) throw recusa('Cupom não encontrado.');
        return exigirSessao(token).then(function () {
          return consulta(function (c) { return c.from('cupons').delete().eq('codigo', cod).select('codigo'); });
        }).then(function (linhas) {
          if (!Array.isArray(linhas) || !linhas.length) throw recusa('Cupom não encontrado.');
          return { ok: true, codigo: cod };
        });
      }),
      listarPacotes: seguro(function (token) {
        return exigirSessao(token).then(function () {
          return consulta(function (c) { return c.from('pacotes').select('*').order('ordem', { ascending: true }); });
        }).then(function (linhas) { return { ok: true, pacotes: (Array.isArray(linhas) ? linhas : []).map(pacoteDaLinha) }; });
      }),
      salvarPacote: seguro(function (token, pacote) {
        if (!pacote || typeof pacote !== 'object') throw recusa('Dados do pacote ausentes.');
        var chave = limparTexto(pacote.chave, 30);
        if (!/^[a-z0-9_]{2,30}$/.test(chave)) throw recusa('Pacote não encontrado.');
        var veio = function (k) { return Object.prototype.hasOwnProperty.call(pacote, k) && pacote[k] !== undefined; };
        var mudar = {};
        if (veio('nome')) {
          var nome = limparTexto(pacote.nome, 80);
          if (!nome) throw recusa('Informe o nome do pacote.');
          mudar.nome = nome;
        }
        if (veio('precoCentavos')) {
          var preco = inteiroOuNulo(pacote.precoCentavos);
          if (preco === null || preco < 0 || preco > 10000000) throw recusa('Preço inválido.');
          mudar.preco_centavos = preco;
        }
        if (veio('precoLancamentoCentavos')) {
          var lanc = inteiroOuNulo(pacote.precoLancamentoCentavos);
          if (lanc !== null && (lanc < 0 || lanc > 10000000)) throw recusa('Preço de lançamento inválido.');
          mudar.preco_lancamento_centavos = lanc;
        }
        if (veio('lancamentoAte')) {
          if (pacote.lancamentoAte && !dataOuVazio(pacote.lancamentoAte)) throw recusa('Data do fim do lançamento inválida.');
          mudar.lancamento_ate = dataOuVazio(pacote.lancamentoAte) || null;
        }
        if (veio('ativo')) mudar.ativo = pacote.ativo !== false;
        if (veio('ordem')) mudar.ordem = Math.max(-1000, Math.min(1000, inteiroOuNulo(pacote.ordem) || 0));
        if (veio('descricao')) mudar.descricao = descricaoPacote(pacote.descricao);
        if (!Object.keys(mudar).length) throw recusa('Nada para salvar.');
        return exigirSessao(token).then(function () {
          return consulta(function (c) { return c.from('pacotes').update(mudar).eq('chave', chave).select('*'); });
        }).then(function (linhas) {
          if (!Array.isArray(linhas) || !linhas.length) throw recusa('Pacote não encontrado.');
          return { ok: true, pacote: pacoteDaLinha(linhas[0]) };
        });
      }),
      resumoVendas: seguro(function (token, periodo) {
        var p = PERIODOS_VENDAS.indexOf(periodo) >= 0 ? periodo : '30d';
        return exigirSessao(token).then(function () { return rpcOk('resumo_vendas', { p_periodo: p }); }).then(function (r) {
          var bloco = function (b) { b = b || {}; return { vendas: numero(b.vendas), receitaCentavos: numero(b.receitaCentavos) }; };
          return { ok: true, periodo: r.periodo || p, hoje: bloco(r.hoje), mes: bloco(r.mes), vendas: numero(r.vendas),
            receitaCentavos: numero(r.receitaCentavos), cortesias: numero(r.cortesias), estornos: numero(r.estornos),
            aguardando: numero(r.aguardando), resumos: numero(r.resumos), compras: numero(r.compras), conversao: numero(r.conversao),
            porPacote: (Array.isArray(r.porPacote) ? r.porPacote : []).map(function (x) {
              return { pacote: String(x.pacote || ''), vendas: numero(x.vendas), receitaCentavos: numero(x.receitaCentavos) };
            }) };
        });
      }),

      login: seguro(function (email, senha) {
        exigir(email, 'Informe o e-mail e a senha.');
        exigir(senha, 'Informe o e-mail e a senha.');
        var e = normalizarEmail(email);
        return Promise.resolve().then(function () { return cliente().auth.signInWithPassword({ email: e, password: String(senha) }); })
          .then(function (r) {
            if (r && r.error) throw erroDoAuth(r.error, MSG_LOGIN_INVALIDO);
            var s = r && r.data && r.data.session;
            if (!s) throw recusa(MSG_LOGIN_INVALIDO);
            return concluirEntrada(s);
          }, function (err) { throw ehFalhaDeRede(err) ? new Error(MSG_CONEXAO) : err; });
      }),
      primeiroAcesso: seguro(function () {
        return Promise.reject(recusa(MSG_PRIMEIRO_ACESSO));
      }),

      // --- recuperação de senha e convites (só no Supabase) ---
      recuperarSenha: seguro(function (email) {
        var e = normalizarEmail(email);
        if (!emailValido(e)) throw recusa('E-mail inválido.');
        var destino = enderecoDoPainel(local);
        var op = destino ? { redirectTo: destino } : {};
        return Promise.resolve().then(function () { return cliente().auth.resetPasswordForEmail(e, op); }).then(function (r) {
          if (r && r.error) throw erroDoAuth(r.error, 'Não foi possível enviar o e-mail. Tente de novo em instantes.');
          return { ok: true, mensagem: 'Se este e-mail tiver acesso ao painel, enviamos um link para criar uma nova senha. Confira também a caixa de spam.' };
        }, function (err) { throw ehFalhaDeRede(err) ? new Error(MSG_CONEXAO) : err; });
      }),
      linkDeAcesso: function () { return { tipo: linkAtual.tipo, erro: linkAtual.erro }; },
      definirNovaSenha: seguro(function (novaSenha) {
        var problema = validarSenhaNova(novaSenha);
        if (problema) throw recusa(problema);
        return sessaoGuardada().then(function (s) {
          if (!s) throw recusa(MSG_LINK_EXPIRADO);
          return Promise.resolve(cliente().auth.updateUser({ password: novaSenha })).then(function (r) {
            if (r && r.error) throw erroDoAuth(r.error, 'Não foi possível gravar a nova senha.');
            linkAtual = { tipo: '', erro: '' };
            return sessaoGuardada().then(function (s2) { return concluirEntrada(s2 || s); });
          });
        });
      }),
      sessaoAtual: seguro(function () {
        return sessaoGuardada().then(function (s) {
          if (!s || !s.access_token) throw erroSessao();
          return rpc('e_admin').then(function (eAdmin) {
            return montarUsuario(s, eAdmin === true).then(function (usuario) { return { ok: true, token: s.access_token, usuario: usuario }; });
          });
        });
      }),

      // --- com sessão ---
      eu: seguro(function (token) {
        return exigirSessao(token).then(function (s) {
          return rpc('e_admin').then(function (eAdmin) {
            return montarUsuario(s, eAdmin === true).then(function (usuario) { return { ok: true, usuario: usuario }; });
          });
        });
      }),
      sair: seguro(function (token) {
        return Promise.resolve().then(function () { return cliente().auth.signOut({ scope: 'local' }); })
          .then(function () { return { ok: true }; }, function () { return { ok: true }; });
      }),
      trocarSenha: seguro(function (token, senhaAtual, novaSenha) {
        var problema = validarSenhaNova(novaSenha);
        return exigirSessao(token).then(function (s) {
          if (problema) throw recusa(problema);
          var email = s.user && s.user.email;
          if (!email) throw erroSessao();
          // Confere a senha atual entrando de novo (a sessão é renovada; o painel continua logado).
          return Promise.resolve(cliente().auth.signInWithPassword({ email: email, password: String(senhaAtual || '') })).then(function (r) {
            if (r && r.error) {
              var e = erroDoAuth(r.error, 'Senha atual incorreta.');
              if (e.message === MSG_LOGIN_INVALIDO) throw recusa('Senha atual incorreta.');
              throw e;
            }
            return cliente().auth.updateUser({ password: novaSenha });
          }).then(function (r) {
            if (r && r.error) throw erroDoAuth(r.error, 'Não foi possível trocar a senha.');
            return { ok: true };
          });
        });
      }),
      listar: seguro(function (token) {
        return exigirSessao(token).then(function () {
          return listarTodas('respostas', '*, processos(nome, tipo, empresa, codigo), ' +
            'pessoas(id, nome, telefone, idade, funcao, empresa, email, cidade, foto, atualizado_em)', 'recebido_em');
        }).then(function (linhas) {
          var sc = scoring();
          return { ok: true, itens: linhas.map(function (l) { return itemDaLinha(l, sc); }) };
        });
      }),
      atualizar: seguro(function (token, idBruto, campos) {
        exigirToken(token);
        exigir(idBruto, 'Candidato não informado.');
        var id = limparTexto(idBruto, 80);
        if (!id) throw recusa('Informe o id do candidato.');
        if (!campos || typeof campos !== 'object') throw recusa('Nada para atualizar.');
        var mudar = {};
        if (campos.status !== undefined) {
          var st = limparTexto(campos.status, 20);
          if (STATUS_VALIDOS.indexOf(st) === -1) throw recusa('Status inválido. Use: aprovado, reprovado ou em_analise.');
          mudar.status = st;
        }
        if (campos.observacoes !== undefined) mudar.observacoes = limparTextoLongo(campos.observacoes, 5000);
        var tirarFoto = false;
        if (campos.foto !== undefined) {
          if (campos.foto !== '' && campos.foto !== null) throw recusa('A foto do participante só pode ser removida.');
          tirarFoto = true;
        }
        if (!Object.keys(mudar).length && !tirarFoto) throw recusa('Nada para atualizar.');
        return exigirSessao(token).then(function () {
          if (!Object.keys(mudar).length) return [{ id: id }];
          return consulta(function (c) { return c.from('respostas').update(mudar).eq('id', id).select('id'); });
        }).then(function (linhas) {
          if (!Array.isArray(linhas) || !linhas.length) throw recusa('Candidato não encontrado.');
          if (!tirarFoto) return { ok: true, id: id };
          return rpcOk('remover_foto', { p_resposta: id }).then(function () { return { ok: true, id: id }; });
        });
      }),
      removerFoto: seguro(function (token, idBruto) {
        exigirToken(token);
        exigir(idBruto, 'Candidato não informado.');
        var id = limparTexto(idBruto, 80);
        return exigirSessao(token).then(function () { return rpcOk('remover_foto', { p_resposta: id }); })
          .then(function (r) { return { ok: true, id: id, removidas: numero(r.removidas) }; });
      }),
      salvarMinhaFoto: seguro(function (token, dataUrl) {
        exigirToken(token);
        var foto = dataUrl === null || dataUrl === undefined ? '' : (typeof dataUrl === 'string' ? dataUrl.trim() : null);
        if (foto === null || (foto !== '' && !fotoValida(foto))) throw recusa(MSG_FOTO_INVALIDA);
        return exigirSessao(token).then(function () { return rpcOk('salvar_minha_foto', { p_foto: foto }); })
          .then(function (r) { return { ok: true, foto: fotoOuVazio(r.foto) }; });
      }),
      excluir: seguro(function (token, idBruto) {
        exigirToken(token);
        exigir(idBruto, 'Candidato não informado.');
        var id = limparTexto(idBruto, 80);
        if (!id) throw recusa('Informe o id do candidato.');
        return exigirSessao(token).then(function () {
          return consulta(function (c) { return c.from('respostas').delete().eq('id', id).select('id'); });
        }).then(function (linhas) {
          if (!Array.isArray(linhas) || !linhas.length) throw recusa('Candidato não encontrado.');
          return { ok: true, id: id };
        });
      }),
      excluirTodos: seguro(function (token, avaliacaoBruta) {
        var filtrar = avaliacaoBruta !== undefined && avaliacaoBruta !== null && String(avaliacaoBruta).trim() !== '';
        var codigo = filtrar ? normalizarCodigo(avaliacaoBruta) : '';
        return exigirSessao(token).then(function () {
          if (filtrar && !codigo) throw recusa('Código de avaliação inválido.');
          return consulta(function (c) {
            var q = c.from('respostas').delete();
            q = filtrar ? q.eq('avaliacao', codigo) : q.neq('id', '');
            return q.select('id');
          });
        }).then(function (linhas) {
          var n = Array.isArray(linhas) ? linhas.length : 0;
          return filtrar ? { ok: true, excluidos: n, avaliacao: codigo } : { ok: true, excluidos: n };
        });
      }),

      // --- empresas, colaboradores e organograma ---
      listarEmpresas: seguro(function (token) {
        return exigirSessao(token).then(function () {
          return Promise.all([
            consulta(function (c) { return c.from('empresas').select('*').order('nome', { ascending: true }); }),
            contarAtivos('')
          ]);
        }).then(function (r) {
          var n = r[1];
          var empresas = (Array.isArray(r[0]) ? r[0] : []).map(function (l) { return empresaDaLinha(l, n[l.id]); }).sort(porNome);
          return { ok: true, empresas: empresas };
        });
      }),
      salvarEmpresa: seguro(function (token, empresa) {
        return exigirSessao(token).then(function () { return salvarEmpresa(empresa || {}); });
      }),
      excluirEmpresa: seguro(function (token, idBruto) {
        exigirToken(token);
        exigir(idBruto, 'Empresa não informada.');
        var id = idValido(idBruto);
        return exigirSessao(token).then(function () {
          if (!id) throw recusa('Empresa não encontrada.');
          return consulta(function (c) { return c.from('empresas').delete().eq('id', id).select('id'); });
        }).then(function (linhas) {
          if (!Array.isArray(linhas) || !linhas.length) throw recusa('Empresa não encontrada.');
          return { ok: true, id: id };
        });
      }),
      listarEquipe: seguro(function (token, empresaId) {
        exigirToken(token);
        exigir(empresaId, 'Empresa não informada.');
        return exigirSessao(token).then(function () { return listarEquipe(empresaId); });
      }),
      salvarColaborador: seguro(function (token, dados) {
        exigirToken(token);
        dados = dados && typeof dados === 'object' ? dados : {};
        exigir(dados.empresaId, 'Empresa não informada.');
        var p = { empresaId: limparTexto(dados.empresaId, 40), cargo: limparTexto(dados.cargo, 120), area: limparTexto(dados.area, 120) };
        if (dados.pessoaId) p.pessoaId = limparTexto(dados.pessoaId, 40);
        else { p.nome = limparTexto(dados.nome, 120); p.telefone = limparTexto(dados.telefone, 40); }
        return exigirSessao(token).then(function () { return rpcOk('salvar_colaborador', { p_dados: p }); })
          .then(function (r) { return { ok: true, colaborador: colaboradorDaRpc(r.colaborador) }; });
      }),
      moverColaborador: seguro(function (token, dados) {
        exigirToken(token);
        dados = dados && typeof dados === 'object' ? dados : {};
        exigir(dados.pessoaId, 'Colaborador não informado.');
        exigir(dados.empresaId, 'Escolha a empresa de destino.');
        var p = { pessoaId: limparTexto(dados.pessoaId, 40), empresaId: limparTexto(dados.empresaId, 40),
          cargo: limparTexto(dados.cargo, 120), area: limparTexto(dados.area, 120) };
        return exigirSessao(token).then(function () { return rpcOk('mover_colaborador', { p_dados: p }); })
          .then(function (r) { return { ok: true, colaborador: colaboradorDaRpc(r.colaborador) }; });
      }),
      desligarColaborador: seguro(function (token, vinculoId) {
        exigirToken(token);
        exigir(vinculoId, 'Colaborador não informado.');
        var id = idValido(vinculoId);
        return exigirSessao(token).then(function () {
          if (!id) throw recusa('Colaborador não encontrado.');
          // O banco carimba o fim (hoje) e apaga as relações da pessoa nessa empresa.
          return consulta(function (c) { return c.from('vinculos').update({ status: 'desligado' }).eq('id', id).eq('status', 'ativo').select('id'); });
        }).then(function (linhas) {
          if (!Array.isArray(linhas) || !linhas.length) throw recusa('Colaborador não encontrado ou já desligado.');
          return { ok: true, id: id };
        });
      }),
      salvarRelacoes: seguro(function (token, empresaId, relacoes, opcoesOrg) {
        exigirToken(token);
        exigir(empresaId, 'Empresa não informada.');
        if (!Array.isArray(relacoes)) throw recusa('Relações inválidas.');
        var lista = relacoes.map(function (r) {
          r = r && typeof r === 'object' ? r : {};
          return { de: limparTexto(r.de, 40), para: limparTexto(r.para, 40), tipo: limparTexto(r.tipo, 20) };
        });
        var args = { p_empresa: limparTexto(empresaId, 40), p_relacoes: lista };
        if (opcoesOrg && typeof opcoesOrg === 'object' && opcoesOrg.topoIds !== undefined) {
          if (!Array.isArray(opcoesOrg.topoIds)) throw recusa('Relações inválidas.');
          args.p_opcoes = { topoIds: opcoesOrg.topoIds.map(function (x) { return limparTexto(x, 40); }).filter(Boolean) };
        }
        return exigirSessao(token).then(function () {
          return rpcOk('salvar_relacoes', args);
        }).then(function (r) {
          var saida = (Array.isArray(r.relacoes) ? r.relacoes : []).map(function (x) { return { de: String(x.de), para: String(x.para), tipo: x.tipo }; });
          var topo = (Array.isArray(r.topoIds) ? r.topoIds : []).map(function (x) { return String(x); });
          return { ok: true, relacoes: saida, topoIds: topo };
        });
      }),
      moverResposta: seguro(function (token, respostaId, processoId) {
        exigirToken(token);
        exigir(respostaId, 'Candidato não informado.');
        var id = limparTexto(respostaId, 80);
        var proc = processoId === null || processoId === undefined ? '' : limparTexto(processoId, 40);
        if (proc && !RE_UUID.test(proc)) throw recusa('Processo não encontrado.');
        return exigirSessao(token).then(function () {
          return rpcOk('mover_resposta', { p_resposta: id, p_processo: proc });
        }).then(function (r) {
          return { ok: true, id: String(r.id || id), processoId: String(r.processoId || ''),
            avaliacao: normalizarCodigo(r.avaliacao), historicoProcessos: historicoDaLinha(r.historicoProcessos) };
        });
      }),
      contratarPessoa: seguro(function (token, dados) {
        exigirToken(token);
        dados = dados && typeof dados === 'object' ? dados : {};
        exigir(dados.empresaId, 'Empresa não informada.');
        if (!dados.respostaId && !dados.pessoaId) throw recusa('Informe a pessoa.');
        var p = { empresaId: limparTexto(dados.empresaId, 40), cargo: limparTexto(dados.cargo, 120), area: limparTexto(dados.area, 120) };
        if (dados.respostaId) p.respostaId = limparTexto(dados.respostaId, 80);
        else p.pessoaId = limparTexto(dados.pessoaId, 40);
        return exigirSessao(token).then(function () { return rpcOk('contratar_pessoa', { p_dados: p }); })
          .then(function (r) {
            return { ok: true, colaborador: colaboradorDaRpc(r.colaborador), movido: r.movido === true,
              deEmpresaId: String(r.deEmpresaId || '') };
          });
      }),
      versaoBanco: seguro(function () { return versaoBanco(); }),

      // --- relatórios por modelo (equipe, liderança, pessoa) ---
      salvarRelatorioModelo: seguro(function (token, dados) {
        return exigirSessao(token).then(function () { return salvarRelatorioModelo(dados); });
      }),
      listarRelatoriosModelo: seguro(function (token, filtro) {
        filtro = filtro && typeof filtro === 'object' ? filtro : {};
        var empresaId = limparTexto(filtro.empresaId, 40);
        var pessoaId = limparTexto(filtro.pessoaId, 40);
        return exigirSessao(token).then(function () {
          if ((empresaId && !RE_UUID.test(empresaId)) || (pessoaId && !RE_UUID.test(pessoaId))) return [];
          return consulta(function (c) {
            var q = c.from('relatorios').select(COLUNAS_REL_MODELO).neq('modelo', 'processo');
            if (empresaId) q = q.eq('empresa_id', empresaId);
            if (pessoaId) q = q.eq('pessoa_id', pessoaId);
            return q.order('criado_em', { ascending: false });
          });
        }).then(function (linhas) {
          var lista = (Array.isArray(linhas) ? linhas : []).map(relatorioModeloDaLinha)
            .sort(function (a, b) { return String(b.criadoEm).localeCompare(String(a.criadoEm)); });
          return { ok: true, relatorios: lista };
        });
      }),
      excluirRelatorioModelo: seguro(function (token, idBruto) {
        exigirToken(token);
        exigir(idBruto, 'Relatório não informado.');
        var id = idValido(idBruto);
        return exigirSessao(token).then(function () {
          if (!id) throw recusa('Relatório não encontrado.');
          return consulta(function (c) { return c.from('relatorios').delete().eq('id', id).neq('modelo', 'processo').select('id'); });
        }).then(function (linhas) {
          if (!Array.isArray(linhas) || !linhas.length) throw recusa('Relatório não encontrado.');
          return { ok: true, id: id };
        });
      }),

      // --- avaliações (nome antigo dos processos) ---
      listarAvaliacoes: seguro(function (token) {
        return exigirSessao(token).then(listarProcessos).then(function (linhas) { return { ok: true, avaliacoes: linhas.map(avaliacaoPublica) }; });
      }),
      salvarAvaliacao: seguro(function (token, avaliacao) {
        return exigirSessao(token).then(function () { return salvarProcesso(avaliacao || {}, true); });
      }),
      excluirAvaliacao: seguro(function (token, id) {
        return exigirSessao(token).then(function () { return excluirProcesso(id); });
      }),

      // --- processos (tabela public.processos, direto com RLS) ---
      processosListar: seguro(function (token) {
        return exigirSessao(token).then(listarProcessos).then(function (linhas) { return { ok: true, processos: linhas.map(processoPublico) }; });
      }),
      processosSalvar: seguro(function (token, processo) {
        return exigirSessao(token).then(function () { return salvarProcesso(processo || {}, false); });
      }),
      processosExcluir: seguro(function (token, id) {
        exigirToken(token);
        exigir(id, 'Processo não informado.');
        return exigirSessao(token).then(function () { return excluirProcesso(id); });
      }),

      // --- usuários (Supabase Auth, pela Edge Function "admin") ---
      listarUsuarios: seguro(function (token) {
        return admin(token, 'usuarios.listar').then(function (r) {
          if (Array.isArray(r.usuarios)) r.usuarios.forEach(function (u) { if (u && typeof u === 'object') u.foto = fotoOuVazio(u.foto); });
          return r;
        });
      }),
      convidarUsuario: seguro(function (token, usuario) {
        usuario = usuario || {};
        return admin(token, 'usuarios.convidar', { email: usuario.email, nome: usuario.nome }, prazoLongo);
      }),
      salvarUsuario: seguro(function (token, usuario) {
        usuario = usuario && typeof usuario === 'object' ? usuario : {};
        var id = limparTexto(usuario.id, 60);
        if (!id) return admin(token, 'usuarios.convidar', { email: usuario.email, nome: usuario.nome }, prazoLongo);
        // Edição: só o nome (cada pessoa cuida da própria senha; para tirar o acesso, exclua o usuário).
        var nome = limparTexto(usuario.nome, 80);
        return exigirSessao(token).then(function () {
          if (letrasContadas(nome) < 2) throw recusa('Informe o nome do usuário.');
          if (usuario.ativo === false) throw recusa('Para tirar o acesso de alguém, exclua o usuário.');
          if (!RE_UUID.test(id)) throw recusa('Usuário não encontrado.');
          return consulta(function (c) { return c.from('admins').update({ nome: nome }).eq('user_id', id).select('user_id, nome, criado_em, foto'); });
        }).then(function (linhas) {
          var l = Array.isArray(linhas) ? linhas[0] : null;
          if (!l) throw recusa('Usuário não encontrado.');
          return { ok: true, usuario: { id: String(l.user_id), nome: l.nome || '', email: limparTexto(usuario.email, 120), papel: 'admin', empresaId: '', empresaNome: '', ativo: true, criadoEm: iso(l.criado_em), foto: fotoOuVazio(l.foto) } };
        });
      }),
      excluirUsuario: seguro(function (token, id) { return admin(token, 'usuarios.remover', { id: id }); }),
      removerUsuario: seguro(function (token, id) { return admin(token, 'usuarios.remover', { id: id }); }),
      redefinirSenha: seguro(function (token) {
        return exigirSessao(token).then(function () { throw recusa(MSG_REDEFINIR); });
      }),

      // --- ClickUp e relatórios (Edge Function "admin") ---
      processoDados: seguro(function (token, id) {
        exigirToken(token);
        exigir(id, 'Processo não informado.');
        return admin(token, 'processo.dados', { id: id }, prazoLongo);
      }),
      clickupStatus: seguro(function (token) { return admin(token, 'clickup.status'); }),
      clickupListas: seguro(function (token) { return admin(token, 'clickup.listas', null, prazoLongo); }),
      relatorioRascunho: seguro(function (token, processoId) {
        exigirToken(token);
        exigir(processoId, 'Processo não informado.');
        return admin(token, 'relatorio.rascunho', { processoId: processoId }, prazoLongo);
      }),
      relatorioSalvar: seguro(function (token, relatorioToken, relatorio) {
        exigirToken(token);
        exigir(relatorioToken, 'Relatório não informado.');
        var textos = relatorio && typeof relatorio === 'object' && relatorio.textos && typeof relatorio.textos === 'object' ? relatorio.textos : {};
        return admin(token, 'relatorio.salvar', { relatorioToken: relatorioToken, relatorio: { textos: textos } });
      }),
      relatorioPublicar: seguro(function (token, relatorioToken, baseUrl) {
        exigirToken(token);
        exigir(relatorioToken, 'Relatório não informado.');
        var dados = { relatorioToken: relatorioToken };
        if (baseUrl) dados.baseUrl = String(baseUrl);
        return admin(token, 'relatorio.publicar', dados, prazoLongo);
      }),
      relatorioDespublicar: seguro(function (token, relatorioToken) {
        exigirToken(token);
        exigir(relatorioToken, 'Relatório não informado.');
        return admin(token, 'relatorio.despublicar', { relatorioToken: relatorioToken });
      }),
      relatoriosListar: seguro(function (token, processoId) {
        return admin(token, 'relatorios.listar', processoId ? { processoId: processoId } : null);
      }),
      relatorioMelhorarTextos: seguro(function (token, relatorioToken, ids) {
        exigirToken(token);
        exigir(relatorioToken, 'Relatório não informado.');
        var dados = { relatorioToken: relatorioToken };
        if (Array.isArray(ids) && ids.length) dados.ids = ids.slice();
        return admin(token, 'relatorio.melhorarTextos', dados, prazoLongo);
      }),

      // --- aba Conexões (só admin): banco testado aqui; o resto pela Edge Function "admin" (nunca valores de segredos) ---
      diagnosticoConexoes: seguro(function (token) {
        return exigirSessao(token).then(function (sessao) {
          return Promise.all([
            diagnosticoBanco(),
            rpc('e_admin').then(function (x) { return x === true; }, function () { return null; }),
            servidorConexoes(token, 'conexoes.diagnostico', null)
          ]).then(function (r) {
            var u = (sessao && sessao.user) || {};
            return { ok: true, em: new Date().toISOString(), siteAtual: baseDoSite(local), banco: r[0],
              login: { sessao: true, email: String(u.email || ''), admin: r[1] },
              servidor: r[2].dados, servidorEstado: r[2].estado, servidorErro: r[2].erro };
          });
        });
      }),
      testarConexao: seguro(function (token, alvo, opcoes) {
        var a = String(alvo || '');
        if (a === 'banco') {
          return exigirSessao(token).then(diagnosticoBanco).then(function (b) {
            return { ok: true, alvo: 'banco', sucesso: !b.erro, em: new Date().toISOString(), banco: b,
              mensagem: b.erro ? b.erro : 'O banco respondeu em ' + b.ms + ' ms.', verificado: 'Conexão, versão do banco e leitura das tabelas principais.' };
          });
        }
        var dados = { alvo: a };
        if (opcoes && typeof opcoes === 'object') ['pedidoId', 'transactionNsu', 'slug'].forEach(function (k) {
          if (opcoes[k]) dados[k] = limparTexto(opcoes[k], 120);
        });
        return servidorConexoes(token, 'conexoes.testar', dados).then(function (r) {
          if (r.dados) return r.dados;
          return { ok: true, alvo: a, sucesso: false, em: new Date().toISOString(), estadoServidor: r.estado,
            mensagem: r.estado === 'desatualizada' ? MSG_ADMIN_DESATUALIZADA : (r.estado === 'ausente' ? MSG_ADMIN_AUSENTE : r.erro) };
        });
      })
    };

    // ---- aba Conexões ----
    /** Chama a Edge Function "admin" sem quebrar a tela: {estado:'ok'|'desatualizada'|'ausente'|'erro', dados, erro}. */
    function servidorConexoes(token, acao, dados) {
      return admin(token, acao, dados, Math.max(prazo, 25000)).then(function (r) {
        return { estado: 'ok', dados: r, erro: '' };
      }, function (e) {
        if (e && e.sessaoExpirada) throw e;
        var msg = String((e && e.message) || MSG_RECUSA);
        if (msg === 'Ação desconhecida.') return { estado: 'desatualizada', dados: null, erro: MSG_ADMIN_DESATUALIZADA };
        if (e && e.funcaoAusente) return { estado: 'ausente', dados: null, erro: MSG_ADMIN_AUSENTE };
        return { estado: 'erro', dados: null, erro: msg };
      });
    }
    /** Contagem (head, sem trazer linhas) pela RLS do admin. null = não deu para ler. */
    function contarTabela(tabela, filtrar) {
      return comPrazo(Promise.resolve().then(function () {
        var q = cliente().from(tabela).select('*', { count: 'exact', head: true });
        return filtrar ? filtrar(q) : q;
      }), prazo).then(function (r) {
        if (!r || r.error) return null;
        return typeof r.count === 'number' ? r.count : null;
      }, function () { return null; });
    }
    /** Banco: tempo de resposta, versão/migrações faltando (com nome amigável), contagens e última resposta recebida. */
    function diagnosticoBanco() {
      var t0 = Date.now();
      var b = { ms: 0, versao: 0, semFuncao: false, faltando: [], contagens: {}, ultimaResposta: '', erro: '' };
      return versaoBanco().then(function (v) {
        b.ms = Date.now() - t0;
        b.versao = v.versao;
        b.semFuncao = !!v.semFuncao;
        b.faltando = (v.faltando || []).map(function (nome) {
          var m = MIGRACOES.filter(function (x) { return x.nome === nome; })[0];
          return { nome: nome, descricao: m ? m.descricao : '' };
        });
        var semTeste = b.faltando.some(function (f) { return f.nome === '20261013120000_conexoes'; });
        var tabelas = ['processos', 'respostas', 'pessoas', 'empresas', 'pedidos'];
        return Promise.all(tabelas.map(function (t) {
          return contarTabela(t, t === 'pedidos' && !semTeste ? function (q) { return q.eq('teste', false); } : null);
        })).then(function (ns) {
          tabelas.forEach(function (t, i) { b.contagens[t] = ns[i]; });
          return consulta(function (c) { return c.from('respostas').select('recebido_em').order('recebido_em', { ascending: false }).limit(1); })
            .then(function (l) { b.ultimaResposta = Array.isArray(l) && l[0] ? iso(l[0].recebido_em) : ''; }, function () { /* sem a data */ });
        });
      }).then(function () { return b; }, function (e) {
        if (e && e.sessaoExpirada) throw e;
        b.ms = Date.now() - t0;
        b.erro = String((e && e.message) || MSG_CONEXAO);
        return b;
      });
    }
    return api;
  }

  // Métodos que o painel usa só no Supabase (além dos de DISC_API.METODOS).
  var EXTRAS = ['recuperarSenha', 'linkDeAcesso', 'definirNovaSenha', 'sessaoAtual', 'convidarUsuario', 'removerUsuario'];

  /** Liga no lugar do DISC_API quando CONFIG.BACKEND === 'supabase' (o objeto continua o mesmo). */
  function instalar(alvo, cfg, opcoes) {
    if (!alvo || !cfg || String(cfg.BACKEND || '').trim().toLowerCase() !== 'supabase') return null;
    opcoes = opcoes || {};
    var url = String(cfg.SUPABASE_URL || '').trim().replace(/\/+$/, '');
    var chave = String(cfg.SUPABASE_ANON_KEY || '').trim();
    if (!url || !chave) return null;
    var api = criar({
      supabase: opcoes.supabase || (root && root.supabase) || null,
      cliente: opcoes.cliente || null,
      url: url, chave: chave,
      local: opcoes.local || (root && root.location) || null,
      scoring: opcoes.scoring || null,
      timeoutMs: opcoes.timeoutMs, timeoutLongoMs: opcoes.timeoutLongoMs
    });
    var metodos = Array.isArray(alvo.METODOS) ? alvo.METODOS : METODOS;
    metodos.concat(EXTRAS).forEach(function (m) { if (typeof api[m] === 'function') alvo[m] = api[m]; });
    alvo.configurado = function () { return true; };
    alvo.supabase = true;
    alvo.backend = 'supabase';
    alvo.MODO = 'supabase';
    alvo.clienteSupabase = api.cliente;
    return api;
  }

  var METODOS = ['enviar', 'avaliacaoPublica', 'login', 'primeiroAcesso', 'eu', 'sair', 'trocarSenha',
    'listar', 'atualizar', 'excluir', 'excluirTodos', 'listarEmpresas', 'salvarEmpresa', 'excluirEmpresa',
    'listarAvaliacoes', 'salvarAvaliacao', 'excluirAvaliacao', 'listarUsuarios', 'salvarUsuario',
    'excluirUsuario', 'redefinirSenha',
    'processosListar', 'processosSalvar', 'processosExcluir', 'processoDados', 'clickupStatus', 'clickupListas',
    'relatorioRascunho', 'relatorioSalvar', 'relatorioPublicar', 'relatorioDespublicar', 'relatoriosListar',
    'relatorioMelhorarTextos', 'relatorioPublico',
    'listarEquipe', 'salvarColaborador', 'moverColaborador', 'desligarColaborador', 'salvarRelacoes',
    'salvarRelatorioModelo', 'listarRelatoriosModelo', 'excluirRelatorioModelo', 'salvarMinhaFoto', 'removerFoto',
    'moverResposta', 'contratarPessoa', 'versaoBanco',
    'pacotesPublicos', 'enviarPessoal', 'resumoPessoal', 'criarPedido', 'iniciarPagamento', 'statusPedido', 'relatorioPessoal',
    'salvarParte2Pessoal', 'recuperarAcesso', 'confirmarRetorno',
    'listarPedidos', 'atualizarPedido', 'listarCupons', 'salvarCupom', 'excluirCupom', 'listarPacotes', 'salvarPacote', 'resumoVendas',
    'diagnosticoConexoes', 'testarConexao'];

  var DISC_API_SUPABASE = {
    METODOS: METODOS,
    EXTRAS: EXTRAS,
    TIMEOUT_MS: TIMEOUT_MS,
    TIMEOUT_LONGO_MS: TIMEOUT_LONGO_MS,
    criar: criar,
    instalar: instalar,
    lerLinkDeAcesso: lerLinkDeAcesso,
    enderecoDoPainel: enderecoDoPainel,
    validarConfigProcesso: validarConfigProcesso,
    normalizarFormulario: normalizarFormulario,
    FORMULARIO_PADRAO: FORMULARIO_PADRAO,
    processoPublico: processoPublico,
    itemDaLinha: itemDaLinha,
    exigidoValido: exigidoValido,
    calcularExigido: calcularExigido,
    fotoValida: fotoValida,
    FOTO_MAX: FOTO_MAX,
    MIGRACOES: MIGRACOES,
    VERSAO_ATUAL: VERSAO_ATUAL,
    MSG_BANCO_DESATUALIZADO: MSG_BANCO_DESATUALIZADO
  };

  if (typeof module !== 'undefined' && module.exports) { module.exports = DISC_API_SUPABASE; return; }
  root.DISC_API_SUPABASE = DISC_API_SUPABASE;
  instalar(root.DISC_API, root.CONFIG);
})(typeof self !== 'undefined' ? self : this);
