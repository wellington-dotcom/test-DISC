# Especificação técnica — Sistema de Teste DISC

Contrato compartilhado entre todos os módulos. Se algo aqui conflitar com o código, **este arquivo vence**.

## Objetivo

1. Candidatos de processo seletivo fazem o teste DISC (25 grupos de 4 palavras) pelo celular ou computador.
2. Cada candidato se identifica com **nome completo**, **telefone (WhatsApp)** e **idade** — opcionalmente a vaga pretendida, a função atual ou última e a empresa atual ou última.
3. O recrutador (admin) vê os resultados, filtra, marca quem foi aprovado e gera um **Guia para a Liderança** de cada candidato aprovado (como liderar, motivar, dar feedback, delegar, sinais de estresse).
4. Poucos candidatos; os dados são apagados depois (LGPD: consentimento + exclusão).

## Arquitetura (sem build, sem servidor próprio)

- Site estático (HTML + CSS + JS puro, sem frameworks, sem bundler), publicável no GitHub Pages.
- Backend: **Google Apps Script** publicado como Web App, gravando numa **Google Sheet** do recrutador.
- **ClickUp é a fonte dos candidatos** do processo seletivo (um processo = uma lista do ClickUp). A planilha guarda só: usuários admin, processos (config), respostas DISC (cópia de segurança) e relatórios.
- Com backend, o servidor devolve um **protocolo** curto (ex. `47K`) que o candidato vê na conclusão e informa ao recrutador.
- Plano B sem backend (ou envio com falha): ao concluir, o candidato vê um **código de segurança** longo (e botão "Enviar pelo WhatsApp" quando `CONFIG.WHATSAPP_RECRUTADOR` está preenchido). O admin cola o código no painel para importar.

## Arquivos e responsáveis

| Arquivo | Conteúdo |
|---|---|
| `js/disc-data.js` | **Pronto.** `DISC_DATA = { grupos: [25 × {titulo, D, I, S, C}], perfis: {D,I,S,C: {nome, rotulo, cor, positivos[], valorEquipe[], ambienteIdeal[], sobPressao[], limitantes[]}} }` |
| `js/scoring.js` | **Pronto.** `DISC_SCORING = { LETRAS, TOTAL_GRUPOS, validarGrupo, validarRespostas, calcular, compactar, descompactar }` |
| `js/config.js` | `CONFIG = { API_URL: '', WHATSAPP_RECRUTADOR: '', EMPRESA: '', MOSTRAR_RESULTADO_AO_CANDIDATO: false, GRUPOS_DEMONSTRACAO: 0 }`. `API_URL: 'simulada'` liga a API simulada (prévia). |
| `js/codec.js` | `DISC_CODEC = { encode(payload) -> string, decode(string) -> payload }` (base64url de JSON UTF-8, prefixo `DISC1.`) |
| `js/api.js` | `DISC_API`: públicas `enviar(payload)`, `avaliacaoPublica(codigo)`, `login(email, senha)`, `primeiroAcesso(chave, nome, email, senha)`; com sessão (token sempre o 1º argumento) `eu`, `sair`, `trocarSenha`, `listar`, `atualizar(token, id, campos)`, `excluir`, `excluirTodos(token, avaliacao?)`, `listarEmpresas`, `salvarEmpresa`, `excluirEmpresa`, `listarAvaliacoes`, `salvarAvaliacao`, `excluirAvaliacao`, `listarUsuarios`, `salvarUsuario(token, usuario, senhaTemporaria?)`, `excluirUsuario`, `redefinirSenha(token, id, senhaTemporaria)`; utilitários `protocoloValido`, `normalizarProtocolo`, `normalizarCodigoAvaliacao`, `codigoAvaliacaoDaUrl(search, hash)`. Erros têm `sessaoExpirada` e `resposta`. |
| `js/api-simulada.js` | Só age com `CONFIG.API_URL === 'simulada'`: troca `DISC_API` por um backend falso em `localStorage` que imita o `Code.gs` ação por ação, com as mesmas mensagens (teste de paridade em `tests/api-simulada.test.js`). Semente da prévia: `admin@previa.com` / `gestor@previa.com` (senha `previa123`), empresa "Clínica Exemplo", avaliações `SEL1` (seleção) e `EQP1` (equipe, mostra resultado), 4 respostas de exemplo. Chave de primeiro acesso: `previa`. |
| `js/validacao.js` | `DISC_VALIDACAO = { retratos, afirmacoes, ESCALA, montarEtapa(resultado, rnd?) }` — etapa de confirmação do participante (texto neutro, sem termos DISC). |
| `js/confiabilidade.js` | `DISC_CONFIABILIDADE = { avaliar(respostas, validacao) -> {nivel, pontos, motivos, detalhes}, NIVEIS }` — usado só no painel. |
| `js/dicas.js` | **Pronto.** `DISC_DICAS = { dicaPergunta(grupo), dicaPalavra(grupo, letra) -> {palavra, sentido, exemplo} }` (botão "i") |
| `index.html`, `js/app.js`, `assets/styles.css` | Fluxo do candidato |
| `admin.html`, `js/admin.js`, `assets/admin.css` | Painel do recrutador |
| `js/lideranca.js` | `DISC_LIDERANCA = { gerarGuia(resultado, nome) -> {titulo, resumo, secoes:[{titulo, itens:[]}]}, combinacoes: {...} }` |
| `js/relatorio-motor.js` | `DISC_RELATORIO = { montar(processoDados, opcoes?), calcularScore, aderenciaDisc, primeiroNome, funil, ... }` — motor do relatório, ES5 puro, copiado para `apps-script/RelatorioMotor.gs` por `npm run montar:apps-script` (o `npm test` confere que estão idênticos) |
| `relatorio.html`, `js/relatorio-view.js`, `assets/relatorio.css` | Página pública do relatório (`DISC_RELATORIO_VIEW.montarHtml`, escapa tudo) |
| `js/fixture-processo-exemplo.js` | Gerado de `tests/fixtures/processo-exemplo.json` por `npm run montar:fixture` (usado só pela prévia) |
| `apps-script/Code.gs`, `ClickUp.gs`, `Relatorio.gs`, `RelatorioMotor.gs`, `docs/BACKEND.md`, `docs/CLICKUP.md` | Backend |
| `tests/*.test.js`, `tests/e2e/*.spec.js`, `package.json` | Testes |
| `README.md` | Guia de uso para o recrutador (pt-BR, leigo) |

Todos os módulos JS usam o padrão UMD já usado em `scoring.js` (global no navegador, `module.exports` no Node) para serem testáveis com `node --test`.
Ordem de scripts nas páginas: `config.js`, `disc-data.js`, `scoring.js`, `codec.js`, `api.js`, `api-simulada.js`, depois
- candidato (`index.html`): `dicas.js`, `validacao.js`, `app.js`;
- painel (`admin.html`): `lideranca.js`, `validacao.js`, `confiabilidade.js`, `relatorio-view.js`, `admin.js`.
- relatório (`relatorio.html`): só `config.js`, `api.js`, `api-simulada.js`, `relatorio-view.js` (na prévia, a simulada carrega `relatorio-motor.js` e a fixture sob demanda).

## Payload de resultado (candidato → backend / código)

```json
{
  "v": 1,
  "id": "string única (timestamp base36 + aleatório)",
  "nome": "Nome Completo",
  "telefone": "5511999998888",
  "idade": 30,
  "funcao": "Recepcionista",
  "empresa": "Clínica Exemplo",
  "vaga": "opcional",
  "consentimento": true,
  "inicio": "ISO-8601",
  "fim": "ISO-8601",
  "duracaoSeg": 512,
  "respostas": "100 dígitos — DISC_SCORING.compactar()",
  "resultado": { "percentuais": {"D":0,"I":0,"S":0,"C":0}, "codigo": "DI" },
  "avaliacao": "SEL1",
  "validacao": {
    "versao": 1,
    "pares": [["D","C"],["I","S"],["D","S"]],
    "escolhas": ["D","I","D"],
    "itens": [{"id":"D-f1","letra":"D","tipo":"forca","nota":5}, "... 4 itens (forca|sombra|contraste, nota 1..5)"],
    "gruposSeg": [12.4, "... 25 números (0 = não medido / preenchido na demonstração)"],
    "semMexer": 2,
    "demonstracao": false
  }
}
```

- `avaliacao`: código do link (`?a=SEL1` ou `#a-SEL1`); `''`/ausente = processo seletivo geral. O servidor recusa código inexistente ou desativado ("Este link de avaliação não está mais ativo.") e grava o `empresaId` da avaliação na linha.
- `validacao`: respostas da etapa de confirmação (ver abaixo). Opcional (payloads antigos não têm); o servidor só confere o formato (tipos, tamanhos, até 4.000 caracteres em JSON), guarda dentro de `payloadJson` e devolve no `listar`. Formato errado → "Dados da etapa de validação inválidos.".

- `idade`: número inteiro de 14 a 99 (obrigatório no envio ao servidor).
- `funcao` / `empresa`: função e empresa **atual ou última** (texto, até 80 caracteres; `''` quando não informadas). Não confundir com `vaga`, que é a vaga **pretendida** neste processo.
- Continua `v: 1`. Payloads antigos (sem `idade`, `funcao`, `empresa`) seguem válidos para leitura no painel e na planilha: aparecem como `—`. Na importação por código longo eles são aceitos (`validarImportado`); com servidor, porém, o `enviar` exige a idade e recusa o código antigo com mensagem clara.

O admin e o backend **recalculam** o resultado a partir de `respostas` (nunca confiam no campo `resultado`).
O payload **não** leva protocolo: ele é gerado pelo servidor e volta só na resposta de `enviar`.

### Protocolo (código curto do candidato)

- Formato: 2 algarismos + 1 letra maiúscula sem I e O — `/^[0-9]{2}[A-HJ-NP-Z]$/` (ex. `47K`; 2.400 combinações). Digitação no painel aceita minúsculas e espaços (`47 k`).
- Gerado pelo servidor na ação `enviar`, dentro do `LockService`: sorteia e confere contra a coluna `protocolo` até achar um livre. Sem nenhum livre: `{ok:false, erro:"Limite de códigos atingido: …"}`.
- Sem servidor ou com falha no envio **não há protocolo**: vale o código de segurança longo (`DISC_CODEC`). Itens importados por código no painel mostram `—`.

## Regras do teste (iguais à planilha)

- Em cada grupo o candidato ordena as 4 palavras: 4 = mais me identifica … 1 = menos me identifica. Sem repetição.
- UX: as 4 palavras ficam numa lista ordenável com 4 posições FIXAS (4 = mais me identifica no topo … 1 = menos me identifica embaixo). A pessoa **arrasta** (toque ou mouse) ou usa os botões ▲/▼ (e teclado) para mover; nada pula de lugar sozinho e os botões de navegação nunca mudam de posição. O grupo só conta como respondido depois que a pessoa mexe na ordem ou toca em "Esta ordem está certa" (evita aceitar a ordem inicial sem pensar).
- A ordem das 4 palavras dentro de cada grupo é **embaralhada** por candidato (na planilha o D é sempre o primeiro, o que deixa o teste manipulável). A pontuação continua mapeada pela letra.
- Total por letra = soma (25..100); percentual = total / 2.5 (soma 100).
- Perfil = letra com maior total (primário) + segunda maior (secundário).

## Validações de identificação

- Nome: pelo menos 2 palavras, mínimo 5 letras.
- Telefone: só dígitos após limpeza; 10 ou 11 dígitos (DDD + número) — salvar com `55` na frente → 12 ou 13 dígitos. Exibir com máscara `(11) 99999-8888`.
- Idade (logo após o telefone; lado a lado no computador): **obrigatória**, campo numérico (`inputmode="numeric"`, só dígitos), inteiro de 14 a 99. Erros: "Informe sua idade (só números)." / "Confira a idade: precisa ser entre 14 e 99 anos." (`DISC_APP.validarIdade`). No servidor (`Code.gs` e `api-simulada.js`, mesmas mensagens): ausente → "Idade não informada: …"; fora do formato ou da faixa → "Idade inválida: …".
- Função atual ou última e Empresa atual ou última: opcionais, até 80 caracteres (aparadas; no servidor também protegidas contra fórmula).
- Checkbox de consentimento LGPD obrigatório (texto: dados usados apenas neste processo seletivo e excluídos ao final; **a idade é usada só para fins cadastrais**).
- Revisão final mostra nome, telefone, idade e, se preenchidas, vaga pretendida, função e empresa.
- Progresso salvo em `localStorage` (try/catch) para não perder se fechar a aba; limpo ao concluir.

## UX do candidato (complementos)

- **Dicas ("i")**: botão no título da pergunta e em cada palavra (entre a palavra e ▲▼). Abre um painel flutuante (`#dica-janela`) dentro da tela, sem mover nada; fecha com Esc, toque fora, novo toque no "i" ou ao arrastar. Tocar/puxar o "i" não arrasta o cartão nem conta como resposta.
- **Conclusão com envio confirmado**: "Seu código" + protocolo grande, botões "Copiar código" e WhatsApp (mensagem curta com nome e código). `sessionStorage` guarda só `{enviado, primeiroNome, protocolo}`. Servidor antigo sem protocolo: "obrigado" sem código.
- **Sem servidor / falha**: "Código de segurança" — "Não conseguimos enviar suas respostas. Envie este código ao recrutador pelo WhatsApp."
- **Modo demonstração** (`CONFIG.GRUPOS_DEMONSTRACAO = N > 0`, nunca no site real): a pessoa responde só N grupos ("Grupo X de N", faixa de aviso no grupo e na revisão); os demais são preenchidos ao acaso (`preenchidosAoAcaso` no estado) e o payload segue com os 100 dígitos.

## Etapa de confirmação e confiabilidade

Depois do último grupo e antes da revisão ("Confirmação 1 de 2" e "2 de 2"; também no modo demonstração). Textos neutros: nada de DISC, letras ou nomes de perfil na tela do participante.

- **Tela 1 – retratos:** 3 rodadas de 2 retratos em 1ª pessoa (`DISC_VALIDACAO.retratos`); a pessoa escolhe o que mais parece com ela. Pares: (primário × último), (secundário × terceiro), (primário × terceiro), em ordem embaralhada.
- **Tela 2 – frases:** 4 frases com escala de 5 pontos (`ESCALA`, notas 1..5): força do primário, a **sombra** correspondente (o excesso daquela força), força do secundário e força do último (contraste). Índices sorteados.
- A montagem fica salva no progresso; só é refeita se o resultado mudar. O app mede também o tempo por grupo (`gruposSeg`, pausa com a aba escondida) e quantos grupos foram aceitos em "Esta ordem está certa" sem mexer (`semMexer`).
- **Confiabilidade** (`DISC_CONFIABILIDADE.avaliar`, calculada no painel a partir das respostas recalculadas):
  - acertos dos retratos (esperado = letra de maior total no par; empate conta como acerto);
  - força do primário e do secundário ≥ 4 = coerente; sombra do primário ≤ 2 com a força ≥ 4 = "só reconheceu o lado positivo" (alerta leve); contraste ≥ 4 com força do primário ≤ 2 = incoerente (alerta forte);
  - mais de 30% dos grupos respondidos em menos de 3 s = alerta forte; `semMexer` > 50% = alerta leve; amplitude (maior% − menor%) < 8 = "perfil pouco definido" (leve);
  - nível: **baixa** se acertos ≤ 1 ou 2+ alertas fortes; **alta** se acertos ≥ 2, nenhum forte e no máx. 1 leve; senão **média**. Sem `validacao` = `indisponivel`. Demonstração acrescenta o motivo "modo demonstração".
- O participante **nunca** vê a confiabilidade. No painel: selo no card, bloco "Confiabilidade do resultado" e "Respostas da confirmação" no detalhe, aviso no topo do Guia quando é baixa.

## Logins, papéis, empresas e avaliações

- **Papéis:** o painel é **só para administradores** (login de gestor é recusado e a sessão encerrada; a aba Empresas saiu da interface; "empresa" agora é texto no processo). O servidor mantém o código abaixo por compatibilidade: `admin` (tudo) e `gestor` (só a própria `empresaId`: lista participantes e avaliações da empresa e muda status/observações; não exclui nem cria nada). O servidor confere o papel e a empresa em **toda** ação; campos extras no corpo (ex. `empresaId`) são ignorados.
- **Senha:** 8 a 100 caracteres. `hash = x`, com `x = sal + senha` e 2.000 rodadas de `x = hex(SHA-256(x))`; sal aleatório de 16 bytes. Hash e sal nunca saem do servidor.
- **Login:** mensagem genérica "E-mail ou senha incorretos."; 5 erros seguidos → "Muitas tentativas. Tente de novo em 15 minutos." (bloqueio de 15 min). E-mail inexistente recebe **as mesmas** mensagens e o mesmo bloqueio (contado só no `CacheService`), para não revelar quem tem cadastro.
- **Sessão:** token de 64 hex (2 UUIDs) no `CacheService` (`sessao_<token>` → `{usuarioId, marca da senha}`), 6 h de validade renovadas a cada uso. Usuário desativado, senha trocada/redefinida ou "sair" derrubam a sessão. Resposta: `{ok:false, erro:'Sessão expirada. Entre de novo.', sessaoExpirada:true}`. O painel guarda o token em `sessionStorage` (`disc_admin_token`).
- **Primeiro acesso / recuperação:** a `ADMIN_KEY` (Script Properties, criada por `setup()`) cria um admin; se o e-mail já for de um admin, redefine a senha dele.
- **Empresas** e **avaliações** são criadas pelo admin. Cada avaliação tem código único de 4 caracteres (`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`), tipo `selecao` ou `equipe`, `mostrarResultado` e `ativa`. Link: `index.html?a=CODIGO` (ou `#a-CODIGO`).
- **Personalização no participante:** `selecao` → "Processo seletivo · <empresa>", "candidato", campo "Vaga pretendida"; `equipe` → "Avaliação de equipe · <empresa>", "colaborador", sem vaga nem empresa anterior, "Seu cargo/função". Consentimento: "…apenas nesta avaliação da <empresa>, conduzida pela Notus…". Código inválido/inativo → "Link inválido ou avaliação encerrada. Fale com quem enviou o link.". Com `mostrarResultado`, a tela final mostra o resumo do perfil (retrato + pontos fortes; nunca o Guia nem a confiabilidade). Sem código vale o fluxo geral e `CONFIG.MOSTRAR_RESULTADO_AO_CANDIDATO`. A conclusão guardada na aba é ligada ao código do link: abrir outro link começa do zero.

## Processos, ClickUp e relatório

- **Processo** (antes "avaliação"; aba `Avaliacoes` ganhou colunas no fim): `id, codigo, nome, empresa (texto), vaga, cidade, consultor, contratante, periodo {inicio, fim}, clickupListId, ativa, mostrarResultado, config`. Link do teste continua `index.html?a=CODIGO` / `#a-CODIGO`.
- **config**: `{ perfilIdeal ('C', 'CD'…), explicacaoPerfil, etapas:[{id, nome, peso, campo (campo numérico 0–10 do ClickUp), descricao}], bonus:[{id, nome, campo, regra:{tipo:'checkbox', pontos} | {tipo:'mapa', pontos:{valor: n}}}], corte (70), faixaAvaliar (55), statusFinalistas:[], permitirAntecedentes (false), permitirSaude (false) }`. O servidor e o painel recusam campo sensível em etapa ou bônus.
- **processoDados** (`processo.dados`, montado do ClickUp): `{ processo, config, status:[{nome, tipo, cor}], candidatos:[{id, nome, status, criadoEm, idade, idadeFaixa, statusTrabalho, pretensao, ultimoSalario, formacao, notas, bonusValores, disc, finalista}], avisos }`. Campos achados pelo nome normalizado com apelidos (whatsapp|telefone|celular; idade; status de trabalho; pretensao salarial; ultimo salario; formacao|escolaridade|curso). Telefone/e-mail **nunca** saem do servidor (só servem para casar a resposta DISC com a tarefa).
- **Envio do candidato** (`enviar`): grava na planilha e, se o processo tiver `clickupListId` e houver `CLICKUP_TOKEN`, acha a tarefa pelo WhatsApp (últimos 8 dígitos + DDD) e grava `DISC D %`, `DISC I %`, `DISC S %`, `DISC C %`, `DISC Perfil`, `DISC Confiabilidade`, `DISC Código`; sem esses campos, grava um comentário; sem tarefa, cria `<nome> (DISC)` com a etiqueta `sem formulário`. Falha no ClickUp vira aviso (em `clickup.status`) e **nunca** impede o candidato de concluir.
- **Motor** (`DISC_RELATORIO.montar`): score técnico = Σ nota/10 × peso normalizado sobre as etapas com alguma nota (as demais são "peso em aberto"); nota vazia numa etapa aplicada = 0 e marca `incompleto`; bônus por fora; situação `aprovado` (≥ corte), `avaliar` (≥ faixaAvaliar) ou `nao_recomendado`; empate por técnico e nome. Aderência DISC: `indefinida` (confiabilidade baixa), `ideal`, `boa`, `media`, `baixa`. Textos por regras `{texto, origem:'regra'|'ia'|'editado'}`; nunca citam idade nem dado sensível. Números com 1 casa (ponto no JSON, vírgula na tela).
- **Relatório**: rascunho (aba `Relatorios`, JSON dividido em partes de 45.000 caracteres) → edição dos textos → publicar (link `relatorio.html?r=TOKEN`, token aleatório de 64 hex; comentário com o link na tarefa `📌 Briefing…` da lista, ou na lista) → despublicar. IA opcional (`ANTHROPIC_API_KEY`) reescreve textos escolhidos e marca `origem:'ia'`. Gatilho opcional `instalarGatilho()` (10 min): briefing no status `gerar relatório` → rascunho + comentário + status `relatório em revisão`.
- **Página do relatório** (`relatorio.html?r=TOKEN` ou `#r-TOKEN`): visual editorial Notus para documentos (ver `docs/IDENTIDADE-VISUAL.md`, "Documentos"), celular primeiro e impressão A4. Sem token/inválido/despublicado: "Relatório não encontrado ou fora do ar.".

### Privacidade (obrigatório)

- Campo do ClickUp cujo nome normalizado (minúsculas, sem acento) tenha uma palavra começando por `sexo, genero, estado civil, filho, religi, gravid, etnia, raca, cor da pele, orientacao, deficien, doenca, saude, antecedente, processo em seu nome, criminal` **nunca é lido** (mesma lista em `Code.gs`, `api-simulada.js` e `admin.js`). Saúde só com `config.permitirSaude === true`; antecedentes só com `config.permitirAntecedentes === true` e **nunca** no relatório (o servidor apaga antes de rodar o motor).
- Relatório do contratante: nomes como "Primeiro S." (o servidor troca qualquer nome completo que tenha sobrado); **nunca** telefone, e-mail, id de tarefa ou da lista do ClickUp. `relatorioPublico` devolve só `{ok, relatorio, publicadoEm}` e só de relatório publicado.
- `CLICKUP_TOKEN`, `ANTHROPIC_API_KEY`, `CLICKUP_PASTA_ID`, `SITE_URL` ficam só nas Propriedades do script e nunca voltam ao navegador.
- Todo texto do relatório (inclusive os editados) e todo nome entram na página escapados; a pré-visualização do painel roda num iframe sem scripts (teste E2E em `tests/e2e/seguranca.spec.js` e `tests/e2e/relatorio.spec.js`).

## API do Apps Script

Todas as requisições usam `Content-Type: text/plain;charset=utf-8` (evita preflight CORS). Respostas JSON `{ ok: boolean, ... , erro?: string }`.

Ações públicas:
- `enviar {payload}` → `{ok, id, protocolo}`. Id já gravado → `{ok, duplicado:true, id, protocolo}` com o **mesmo** protocolo. Limite global de envios por janela e de linhas na planilha.
- `avaliacaoPublica {codigo}` → `{ok, avaliacao:{codigo, nome, tipo, empresaNome, mostrarResultado}}` (só avaliações ativas).
- `login {email, senha}` → `{ok, token, usuario:{id, nome, email, papel, empresaId, empresaNome}}`.
- `primeiroAcesso {chave, nome, email, senha}` → igual ao login (+ `redefinida`).
- `relatorioPublico {token}` → `{ok, relatorio, publicadoEm}` só se publicado; senão "Relatório não encontrado ou fora do ar.".

Com sessão (`token` no corpo):
- `eu`, `sair`, `trocarSenha {senhaAtual, novaSenha}` (a sessão atual continua; as outras caem).
- `listar` → `{ok, itens:[payload + status, observacoes, recebidoEm, protocolo, avaliacao, empresaId, empresaNome, avaliacaoNome, avaliacaoTipo, validacao]}` (admin: tudo; gestor: só a empresa dele; respostas sem código só o admin vê).
- `atualizar {id, campos:{status?, observacoes?}}` (gestor só na própria empresa).
- Só admin: `excluir {id}`, `excluirTodos {avaliacao?}`, `empresas.listar|salvar {empresa:{id?, nome}}|excluir {id}` (recusa com avaliações ou gestores), `avaliacoes.salvar {avaliacao:{id?, empresaId, nome, tipo, mostrarResultado, ativa}}`, `avaliacoes.excluir {id}` (recusa com respostas: sugere desativar), `usuarios.listar|salvar {usuario, senhaTemporaria?}|excluir {id}|redefinirSenha {id, senhaTemporaria}` (ninguém exclui/desativa/rebaixa a si mesmo; sempre sobra 1 admin ativo).
- `avaliacoes.listar`: admin e gestor (filtrado), com a contagem de `respostas`.
- Só admin (processos, ClickUp, relatórios): `processos.listar`, `processos.salvar {processo}`, `processos.excluir {id}` (os `avaliacoes.*` continuam como apelidos), `clickup.status` → `{ok, configurado, conectado, usuario?, iaConfigurada, avisos}`, `clickup.listas` → `{ok, listas:[{id, nome, pasta}]}` (pasta `CLICKUP_PASTA_ID` ou todo o workspace), `processo.dados {id}` → processoDados, `relatorio.rascunho {processoId}` → `{ok, relatorio, token, avisos}`, `relatorio.salvar {relatorioToken, relatorio:{textos}}` (só textos existentes; marca `editado`; única ação com corpo até 450 KB), `relatorio.publicar {relatorioToken, baseUrl?}` → `{ok, url, aviso?}`, `relatorio.despublicar {relatorioToken}`, `relatorios.listar {processoId}`, `relatorio.melhorarTextos {relatorioToken, ids?}` (sem chave: "IA não configurada."). Nas ações com sessão, `token` é o da sessão; o do relatório vai em **`relatorioToken`**.
- Gestor em ação de admin → "Sem permissão.".

Abas (criadas sozinhas na primeira requisição; `setup()` também cria): `Usuarios (id, email, nome, papel, empresaId, hash, sal, ativo, tentativas, bloqueadoAte, criadoEm)`, `Empresas (id, nome, criadaEm)`, `Avaliacoes (id, codigo, empresaId, nome, tipo, mostrarResultado, ativa, criadaEm)`. Todo texto gravado passa por proteção contra fórmula (`= + - @` e dígitos iniciais recebem apóstrofo). Escritas sob `LockService` (liberado em `finally`).

Colunas da aba `Respostas`: `id, recebidoEm, nome, telefone, vaga, inicio, fim, duracaoSeg, respostas, D, I, S, C, perfil, status, observacoes, payloadJson, protocolo, idade, funcao, empresa, avaliacao, empresaId`. As colunas novas ficam sempre **no fim**: planilhas antigas sem `protocolo` / `idade` / `funcao` / `empresa` / `avaliacao` / `empresaId` ganham as colunas automaticamente no primeiro acesso (`funcao` e `empresa` em formato texto; `idade` é número); se a aba tiver menos colunas físicas, elas são inseridas. As linhas antigas ficam com essas células vazias.

Prévia: com `API_URL: 'simulada'` a mesma API roda em `js/api-simulada.js` (logins da prévia acima; chave de primeiro acesso `previa`). O ClickUp nunca é chamado: o processo "Cartório Exemplo — Escrevente" (código `CRT1`) usa a fixture, e o relatório publicado `relatorio.html#r-exemplo-cartorio` já existe; a IA só põe o prefixo `[IA] `.

## Painel admin

- Login por e-mail e senha (token em `sessionStorage`; a senha nunca é guardada), com "Primeiro acesso", "Trocar senha" e "Sair" no menu do cabeçalho. Sessão expirada volta ao login com aviso. Se `API_URL` vazio, funciona só em modo "importar código" (salvo em `localStorage`).
- Só administradores. Abas: Participantes, Processos, Usuários, Comparativo e Importar códigos (`data-aba`: `lista, processos, usuarios, comparativo, importar`).
- Processos: card com código, link, "Copiar link", "Copiar mensagem" (WhatsApp), Editar, Ativar/Desativar e Excluir (só com 0 respostas). Formulário com dados do processo, lista do ClickUp (seletor; sem ClickUp, campo para colar o ID/endereço), perfil ideal, etapas, bônus, corte, faixa "avaliar", status finalistas e antecedentes. Página do processo: relatórios, "Ver participantes" e "Gerar rascunho do relatório". Editor do rascunho: textos por seção (selo Regra/IA/Editado), pré-visualização, Salvar, Publicar (link + mensagem para o contratante), Despublicar e "Melhorar textos com IA" (só com `iaConfigurada`). Usuários: só cria administradores; gestores antigos aparecem como desativados e podem ser excluídos.
- Todo texto vindo do servidor (nomes de participante, empresa, avaliação, usuário) entra no DOM por `textContent` (teste E2E de XSS em `tests/e2e/seguranca.spec.js`).
- Lista: nome, telefone (link `https://wa.me/55...`), vaga, data, uma linha discreta "Função · Empresa" (só se houver), perfil (badge colorido), barras D/I/S/C, status.
- **Idade só no detalhe** do candidato (bloco "Dados do candidato", com "—" quando não há). Ela **não** aparece na lista/cards, nos cards de resumo, no comparativo, na busca nem como filtro. Motivo: evitar discriminação por idade na seleção (Lei 9.029/95); a idade é dado cadastral. Fica também no CSV (coluna `idade`), que é a exportação completa do cadastro.
- Protocolo em cada card ("Código 47K", ou `—`), no detalhe abaixo do nome, no CSV (coluna `protocolo`) e no "Copiar guia".
- Filtros: busca por nome, vaga, função, empresa, código (ignora maiúsculas e espaços) ou telefone (nunca pela idade); pílulas de Processo (`#filtro-processo`), Perfil e Status. Card mostra "Processo · Empresa" (ou "Link geral") e o selo de confiabilidade.
- Detalhe mostra também Idade, Vaga pretendida, Função atual/última e Empresa atual/última.
- CSV (`participantes-disc-AAAA-MM-DD.csv`): colunas `idade`, `funcao`, `empresa` logo após `vaga` (vazias para registros antigos) e, no fim, avaliação, empresa da avaliação e confiabilidade.
- Detalhe do candidato: gráfico de barras DISC (SVG/CSS, sem libs), características do perfil (de `DISC_DATA.perfis`), e o **Guia para a Liderança** de `DISC_LIDERANCA.gerarGuia`. Botão imprimir/salvar PDF (CSS `@media print`) e "copiar guia" (texto).
- Ações: marcar aprovado/reprovado/em análise, observações, excluir, excluir todos (com confirmação digitando EXCLUIR), exportar CSV.
- Comparativo: tabela com distribuição dos perfis dos aprovados (útil para montar equipe).

## Visual

pt-BR, mobile-first (375px), acessível (labels, foco visível, contraste AA). **Identidade visual Notus (out/2026)**: seguir `docs/IDENTIDADE-VISUAL.md` e usar `assets/notus.css` + `assets/icone.svg` (tema claro, como o BI). Cores DISC: D `#13283f`, I `#ff9f40`, S `#8a97ab`, C `#324e73` (classes `.disc-D/I/S/C`). Sem dependências externas (sem CDN) — a fonte Plus Jakarta Sans fica em `assets/fonts`.

## Supabase (migração do servidor)

O servidor está migrando do Apps Script + planilha para o **Supabase** (Postgres + Auth + Edge Functions). O site continua estático (GitHub Pages) e o ClickUp continua sendo a fonte dos candidatos. O Apps Script fica no repositório como legado até o corte. Passo a passo para o dono: `docs/SUPABASE.md`.

- **Escolha do backend** (`js/config.js`): `BACKEND: 'appsscript'` (padrão enquanto o dono não configurar) | `'supabase'` | `'simulada'`; `SUPABASE_URL` e `SUPABASE_ANON_KEY` são públicos (nunca a `service_role`). Nas 3 páginas, `assets/vendor/supabase.js` (supabase-js UMD, versão fixa, sem CDN; ver `assets/vendor/LEIAME.txt`) e `js/api-supabase.js` carregam depois de `js/api.js`; o arquivo só substitui o `DISC_API` quando `BACKEND === 'supabase'`, com os mesmos métodos, argumentos e respostas `{ok, ...}` (erros com `sessaoExpirada`).
- **Banco** (`supabase/migrations/20261005120000_disc.sql`, um arquivo idempotente; `supabase/seed_previa.sql` = exemplos para projeto de teste): tabelas `admins`, `processos` (código de 4 caracteres gerado por gatilho), `respostas` (id do payload, protocolo único, D/I/S/C e perfil recalculados, `status`, `validacao`, `payload`, `clickup_sync`), `relatorios` (token ≥ 32 caracteres; `rascunho`|`publicado`) e `configuracoes` (só valores não secretos). **RLS em todas**; `anon` não acessa tabela nenhuma; `authenticated` só com `public.e_admin()`. Auxiliares no schema `disc_interno` (fora da API).
- **RPCs** (security definer, `search_path` fixo): `avaliacao_publica(p_codigo)` → `{codigo, nome, tipo, empresaNome, mostrarResultado}` (só processos ativos); `enviar_resposta(p_payload)` → `{ok, id, protocolo, duplicado?}` com as mesmas validações e mensagens do `Code.gs` (idempotente por `id`; no máx. 40 envios por 10 minutos e 2.000 linhas); `relatorio_publico(p_token)` → `{ok, relatorio, publicadoEm}` (só publicado); `garantir_primeiro_admin()` (tabela `admins` vazia → o usuário logado vira admin; depois só admin convida admin).
- **Edge Functions** (Deno; fonte em `supabase/functions/<nome>/index.ts` + `supabase/funcoes-compartilhadas/*.js`; `npm run montar:funcoes` gera `dist/funcoes/<nome>/index.ts`, um arquivo autocontido por função para colar no painel; `npm test` confere se estão atualizados):
  - `admin` (JWT de usuário admin): `clickup.status`, `clickup.listas`, `processo.dados`, `relatorio.rascunho`, `relatorio.salvar`, `relatorio.publicar` (comenta o link na tarefa "📌 Briefing…"), `relatorio.despublicar`, `relatorios.listar`, `relatorio.melhorarTextos`, `usuarios.listar|convidar|remover` (convite por `inviteUserByEmail` com retorno para `SITE_URL/admin.html`). Participantes e processos vão direto nas tabelas (PostgREST com RLS).
  - `disc-sync` (o site chama logo depois de `enviar_resposta`, com `{id}`; responde só `{ok}`): grava o DISC na tarefa do candidato achada pelo WhatsApp, ou cria "<nome> (DISC)" com a etiqueta "sem formulário"; idempotente (`respostas.clickup_sync`).
  - `clickup-webhook` (público, "Verify JWT" desligado; assinatura `X-Signature` HMAC-SHA256 com `CLICKUP_WEBHOOK_SECRET`): tarefa "📌 Briefing…" que vai para "gerar relatório" numa lista ligada a um processo → rascunho, comentário e status "relatório em revisão" (substitui o gatilho de 10 minutos).
  - Segredos: `CLICKUP_TOKEN`, `SITE_URL`, `CLICKUP_PASTA_ID` (opcional), `ANTHROPIC_API_KEY` (opcional), `CLICKUP_WEBHOOK_SECRET`; `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` são automáticos. CORS: origem de `SITE_URL` e `localhost`.
- **Painel com Supabase:** login por e-mail e senha do Supabase Auth, "Esqueci minha senha" (volta com `#type=recovery` → "Defina sua nova senha"; convite `#type=invite` idem); sem "Primeiro acesso" com chave; aba Usuários convida e remove administradores (sem redefinir senha de outra pessoa). Com `appsscript`/`simulada`, tudo como antes.
- **Operação:** `.github/workflows/manter-ativo.yml` chama `avaliacao_publica('ZZZZ')` a cada 3 dias (segredos do GitHub `SUPABASE_URL` e `SUPABASE_ANON_KEY`; sem eles não faz nada) para o projeto grátis não pausar. `scripts/migrar-planilha.mjs Respostas.csv [--processos Avaliacoes.csv] [--saida importar.sql]` converte o CSV das abas da planilha em `INSERT … on conflict do nothing` (numa transação; mantém id, protocolo e o código do processo; recalcula D/I/S/C e perfil; pula linhas inválidas com aviso; telefone normalizado como `normalizarTelefone` do `Code.gs`).
- **Testes:** `npm test` (unidade, incluindo `tests/funcoes/` e `tests/migrar-planilha.test.js`); `npm run test:supabase` roda a migração num Postgres embutido (`embedded-postgres`) com um schema `auth` mínimo e os papéis `anon`/`authenticated`/`service_role`. Nenhum teste acessa `*.supabase.co`, o ClickUp ou a Anthropic.
