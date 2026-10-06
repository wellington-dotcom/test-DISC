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
| `js/api-simulada.js` | Só age com `CONFIG.API_URL === 'simulada'`: troca `DISC_API` por um backend falso em `localStorage` que imita o `Code.gs` ação por ação, com as mesmas mensagens (teste de paridade em `tests/api-simulada.test.js`). Semente da prévia: `admin@previa.com` / `gestor@previa.com` (senha `previa123`), empresa "Clínica Exemplo", avaliações `SEL1` (seleção), `EQP1` (equipe, mostra resultado) e `ATD1` (mostra resultado; formulário com e-mail obrigatório, cidade opcional e 1 pergunta extra), processo `CRT1` (mostra resultado), 5 respostas de exemplo (a mesma pessoa respondeu `SEL1` e `ATD1`). Chave de primeiro acesso: `previa`. |
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
  "email": "",
  "cidade": "",
  "extras": [{ "id": "p1", "pergunta": "Qual sua pretensão salarial?", "resposta": "R$ 3.000" }],
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

- `idade`: número inteiro de 14 a 99, ou `null`. Obrigatória só quando o formulário do processo diz `obrigatorio` (o padrão, e sempre no link geral); se vier, precisa estar na faixa. Campo `oculto` é ignorado (grava `null`).
- `funcao` / `empresa`: função e empresa **atual ou última** (texto, até 80 caracteres; `''` quando não informadas ou ocultas). Não confundir com `vaga`, que é a vaga **pretendida** neste processo.
- `email` (até 120, formato `a@b.c`, gravado em minúsculas) e `cidade` (cidade onde mora, até 80): `''` quando ocultos/vazios.
- `extras`: respostas às perguntas extras do processo, `[{id, pergunta, resposta}]` (resposta até 500). O servidor só aceita ids que existem no formulário do processo (os outros são ignorados), grava a `pergunta` com o texto do processo e não guarda resposta vazia.
- Obrigatórios do formulário vazios são recusados com mensagem clara: "Informe o e-mail.", "E-mail inválido.", "Informe a cidade onde mora.", "Informe a função atual ou última.", "Informe a empresa atual ou última.", `Responda a pergunta "<texto>".`. Ordem das verificações: id, nome, telefone, idade, função, empresa, e-mail, cidade, extras, consentimento, respostas, código do link, validação.
- Continua `v: 1`. Payloads antigos (sem `idade`, `funcao`, `empresa`) seguem válidos para leitura no painel e na planilha: aparecem como `—`. Na importação por código longo eles são aceitos (`validarImportado`); com servidor, porém, o `enviar` exige a idade e recusa o código antigo com mensagem clara.

O admin e o backend **recalculam** o resultado a partir de `respostas` (nunca confiam no campo `resultado`).
O payload **não** leva protocolo: ele é gerado pelo servidor e volta só na resposta de `enviar`.

### Formulário do processo (`processo.config.formulario`)

O recrutador define, por processo (link), o que perguntar na identificação. Nome completo e WhatsApp são sempre obrigatórios (não configuráveis).

```json
{
  "campos": { "idade": "obrigatorio", "funcao": "opcional", "empresa": "opcional", "email": "oculto", "cidade": "oculto", "foto": "opcional" },
  "perguntas": [ { "id": "p1", "texto": "Qual sua pretensão salarial?", "obrigatoria": false } ],
  "parte2": "desligada"
}
```

- Modos de campo: `obrigatorio` | `opcional` | `oculto`. Ausente ou inválido = o padrão acima (o comportamento de antes). Rótulos ao candidato: idade "Idade", funcao "Função atual ou última", empresa "Empresa atual ou última", email "E-mail", cidade "Cidade onde mora", foto "Sua foto" (só Supabase e prévia; ver Fotos).
- `perguntas`: até 5; texto 3–200 caracteres (espaços normalizados; menor que 3 é descartado); `id` `^[a-z0-9_]{1,20}$` (faltando, inválido ou repetido vira o primeiro `p1`…`pN` livre); `obrigatoria` só `true` vale.
- Normalização igual em todos os lados: `normalizarFormulario(f)` em `js/api-supabase.js` e `js/api-simulada.js` e `disc_interno.normalizar_formulario` no banco (o gatilho de `processos` grava o formulário já normalizado).
- Pergunta com termo sensível (mesma lista de `classificarCampo`: sexo, gênero, estado civil, filhos, religião, gravidez, etnia/raça, cor da pele, orientação, deficiência, doença, saúde, antecedentes, criminal…) é **recusada**, sem exceção (nem `permitirSaude`/`permitirAntecedentes`): `A pergunta "<texto>" pede um dado sensível e não pode ser usada.`
- `avaliacaoPublica(codigo)` devolve também `formulario` (normalizado). Sem link (fluxo geral) vale o padrão.

### Parte 2 — perfil exigido pelo trabalho (`formulario.parte2`, só Supabase e prévia)

- `formulario.parte2`: `'desligada'` (padrão; ausente/inválido/formulário antigo) | `'ligada'` (o painel liga por padrão ao criar processo `equipe`). Com `'ligada'` o candidato responde, depois dos 25 grupos e antes da confirmação, 10 grupos (`DISC_EXIGIDO.GRUPOS` = índices 0, 2, 5, 7, 10, 12, 15, 17, 20, 22 de `DISC_DATA.grupos`) pensando em como o trabalho exige que ele seja.
- Payload ganha `exigido`: string de **40 dígitos** 1–4, 4 por grupo na ordem D,I,S,C (mesma convenção de `respostas`), cada bloco uma permutação de 1..4. Percentual de cada fator = total da letra nos 10 grupos (10–40; soma 100); código = maior + segundo (empate na ordem D, I, S, C).
- Servidor (`enviar_resposta`, migração `20261008120000_parte2.sql`, e a prévia): processo com `'ligada'` → `exigido` obrigatório e válido, senão `Responda também a segunda parte do teste.` (validado antes da idempotência, como os outros campos); `'desligada'` ou link geral → `exigido` descartado. Gravado em `respostas.exigido` (nulo ou 40 dígitos válidos — restrição `respostas_exigido_valido`) e no `payload`.
- `listar`: cada item ganha `exigido` (string ou `''`) e `resultadoExigido` (`{percentuais, codigo}` ou `null`, calculado no cliente). `listarEquipe`: cada colaborador ganha `exigido` (`{percentuais, codigo}` ou `null`) da resposta mais recente. O Apps Script legado não tem Parte 2.

### Fotos (candidato, colaborador e usuário do painel; só Supabase e prévia)

- Formato único: data URL `data:image/jpeg;base64,…` (JPEG 192×192, recortado ao centro e reduzido no navegador com `<canvas>`, qualidade ~0.72), **no máximo 40 000 caracteres**. O banco aceita só `^data:image/jpeg;base64,/9j/[A-Za-z0-9+/=]+$` (o base64 de um JPEG começa em `/9j/`); `fotoValida(str)` em `js/api-supabase.js`/`js/api-simulada.js`. Nada de Storage: fica no banco (migração `20261009120000_fotos.sql`), em `pessoas.foto`, `respostas.foto` e `admins.foto` (restrições `<tabela>_foto_valida`).
- Formulário: `formulario.campos.foto` `obrigatorio` | `opcional` (padrão) | `oculto`. Payload ganha `foto` (`''` = sem foto). `enviar_resposta`: obrigatória sem foto → `Envie uma foto.`; oculta → descartada; inválida → `Foto inválida ou grande demais. Escolha outra imagem.` (validada antes da idempotência). A foto vai para `respostas.foto` (**não** para o `payload`) e para a ficha: foto nova substitui; envio sem foto não apaga a que havia. O envio inteiro pode ter até **80 000 caracteres** (era 20 000).
- API (Supabase e prévia): `listar` → `item.foto` (da resposta, `''` sem) e `item.pessoa.foto` (da ficha); `listarEquipe` → `colaborador.foto` (da ficha); `eu`/`sessaoAtual`/`login` → `usuario.foto`; `listarUsuarios` → `usuario.foto`; `salvarMinhaFoto(token, dataUrl | '')` → `{foto}` (só a do próprio usuário; `''` remove); `removerFoto(token, respostaId)` → `{id, removidas}` (LGPD: some da resposta, da ficha e das outras respostas da pessoa; também `atualizar(token, id, {foto: ''})` — trocar a foto de alguém pelo painel não é possível). No Apps Script legado `salvarMinhaFoto`/`removerFoto` respondem `Disponível só com o servidor Supabase.`
- Segurança: `anon` nunca lê foto (tabelas fechadas; `avaliacao_publica`/`enviar_resposta` não devolvem foto; o relatório publicado mostra só o que está no snapshot). `admins.foto` só pelo próprio usuário: `salvar_minha_foto(p_foto)` usa `auth.uid()`; o painel só tem `insert (user_id, nome, criado_em)` e `update (nome)` em `admins`, e um gatilho recusa trocar a foto de outra linha com usuário logado. `respostas.foto`/`pessoas.foto` só entram pelo envio e saem por `remover_foto(p_resposta)` (só admin).
- Relatórios: o de **processo** (montado no servidor, `relMontar`) põe `foto` em `ranking.linhas[]` e `disc.quadro[]` (da resposta casada pelo WhatsApp ou, sem ela, da ficha), pelo mesmo nome curto do motor; se o JSON passar de 1,5 MB as fotos que não cabem ficam de fora. Os **por modelo** levam as fotos no snapshot montado no navegador (limite do snapshot: **1 MB**). Relatório já gerado guarda a foto até ser refeito ou excluído.
- Prévia/seed: avatares **fictícios** (iniciais sobre a cor do fator principal do DISC, JPEG 192 px gerado por código) para Ana, Carla, Diego, Marta e Renata; no relatório do Cartório Exemplo, Ana E. e Carla M.

### Pessoas (mesma pessoa = mesmo WhatsApp normalizado)

- Tabela `public.pessoas` (`id`, `telefone` único, `nome`, `idade`, `funcao`, `empresa`, `email`, `cidade`, `criado_em`, `atualizado_em`); `respostas.pessoa_id` aponta para ela.
- Ao enviar: acha a pessoa pelo telefone ou cria; **atualiza a ficha** com o nome do envio e com os campos **não vazios** do envio (vazio não apaga o que havia). Reenvio do mesmo `id` não mexe na ficha.
- Excluir resposta (uma ou todas): a pessoa que fica sem nenhuma resposta é excluída junto (LGPD), **menos** quem é colaborador ativo de uma empresa (continua no time, sem resultado).
- Resposta gravada sem pessoa (importação da planilha, dados de exemplo) é ligada pelo gatilho `respostas_ligar_pessoa`, que só preenche o que estiver vazio na ficha.
- Item de `listar` ganha: `pessoaId` (`''` sem pessoa), `pessoa: {id, nome, telefone, idade, funcao, empresa, email, cidade, atualizadoEm} | null`, `email`, `cidade`, `extras`. O painel agrupa por `pessoaId || telefone` (o Apps Script, legado, não manda `pessoaId`).
- Relatório/ClickUp do processo (`processo.dados`): se a mesma pessoa tem várias respostas no processo, vale a **mais recente**.

### Empresas, colaboradores e organograma (só Supabase e prévia)

- Tabelas (migração `20261007120000_empresas_equipes.sql`; RLS só admin, `anon` nada): `empresas` (`nome` 1–120, `cidade` ≤ 120, `observacoes` ≤ 2000, `ativo`), `vinculos` (pessoa × empresa: `cargo`, `area`, `status` `ativo`|`desligado`, `inicio`, `fim`; **no máximo 1 vínculo ativo por pessoa** — índice único parcial), `relacoes` (`empresa_id`, `de_pessoa`, `para_pessoa`, `tipo` `lidera`|`direto`|`indireto`; única por empresa+de+para; de ≠ para; as duas pessoas precisam ser colaboradoras ativas da empresa — gatilho).
- Desligar = `status 'desligado'` (o banco põe `fim` = hoje e apaga as relações da pessoa nessa empresa). Mover = o vínculo ativo vira desligado + nasce o ativo no destino (`mover_colaborador`, atômico). Empresa com colaborador ativo não é excluída ("Desligue ou mova os colaboradores antes."); excluída, leva vínculos/relações/relatórios de equipe e deixa `processos.empresa_id` nulo (o texto `processos.empresa` fica).
- `processos.empresa_id` (opcional): ligando, o banco preenche o texto `empresa` se ele vier vazio. Link de processo **tipo `equipe` ligado a uma empresa**: quem envia e ainda não tem vínculo ativo em nenhuma empresa vira colaborador ativo dela (`cargo` = função informada); ativo em outra empresa → nada muda.
- Funções do painel (authenticated, só admin; respondem `{ok, ...}` ou `{ok:false, erro}`): `salvar_colaborador(p_dados)`, `mover_colaborador(p_dados)`, `salvar_relacoes(p_empresa, p_relacoes, p_opcoes default null)` (substitui o conjunto; valida tudo antes; repetida = vale a última; `p_opcoes.topoIds` grava o topo — desde a `20261010…`), `contratar_pessoa(p_dados)` (`20261010…`).
- `DISC_API` (`js/api-supabase.js` e `js/api-simulada.js`; no Apps Script, `js/api.js` rejeita com "Disponível só com o servidor Supabase."):
  - `listarEmpresas(token)` → `{empresas:[{id, nome, cidade, observacoes, ativo, criadoEm, atualizadoEm, colaboradores}]}` (a simulada também manda `criadaEm`, nome do Code.gs).
  - `salvarEmpresa(token, {id?, nome, cidade, observacoes, ativo})` → `{empresa}` (nome repetido recusado) · `excluirEmpresa(token, id)` → `{id}`.
  - `listarEquipe(token, empresaId)` → `{empresa, colaboradores:[{vinculoId, pessoaId, nome, telefone, cargo, area, status, inicio, fim, resultado:{percentuais, codigo}|null, respondidoEm}], relacoes:[{de, para, tipo}], historico:[mesmo formato, desligados]}` (resultado = resposta mais recente da pessoa; ativos por nome, histórico pelo fim mais recente; relações só entre ativos).
  - `salvarColaborador(token, {empresaId, pessoaId? | nome + telefone, cargo, area})` → `{colaborador:{vinculoId, pessoaId, empresaId, nome, telefone, cargo, area, status, inicio, fim}}` (sem `pessoaId`: acha/cria a pessoa pelo WhatsApp normalizado; já ativo na mesma empresa: atualiza cargo/área; ativo em outra: recusa sugerindo "Mover").
  - `moverColaborador(token, {pessoaId, empresaId, cargo, area})` → `{colaborador}` · `desligarColaborador(token, vinculoId)` → `{id}` · `salvarRelacoes(token, empresaId, [{de, para, tipo}], {topoIds}?)` → `{relacoes, topoIds}` (`topoIds` = quem fica no topo do organograma mesmo sem liderados; guardado em `empresas.organograma.topoIds`, só colaboradores ativos, sem repetir; sem o 4º argumento o topo salvo não muda). `listarEquipe` devolve também `topoIds` (só ativos).
  - `contratarPessoa(token, {respostaId | pessoaId, empresaId, cargo, area})` → `{colaborador, movido, deEmpresaId}`: o candidato vira colaborador **ativo** da empresa; ativo em outra empresa → move (lá fica desligado, `fim` = hoje, relações somem); já ativo nesta → atualiza cargo/área. Com `respostaId` a resposta vira `aprovado` e o cargo vazio usa a vaga da resposta. Erros: `Empresa não encontrada.`, `Candidato não encontrado.`, `Pessoa não encontrada.`, `Informe a pessoa.`, resposta sem WhatsApp válido. Só admin (função `contratar_pessoa`).
  - Processos: `processosListar`/`processosSalvar` levam `empresaId` (`''` = sem empresa).

### Mover resposta de processo e versão do banco (migração `20261010120000_mover_versao.sql`; só Supabase e prévia)

- `moverResposta(token, respostaId, processoId | '')` → `{id, processoId, avaliacao, historicoProcessos}`: troca `respostas.processo_id` e o código (`avaliacao`); `''` = sem processo; mesmo processo = nada muda. Registra em `respostas.historico_processos` (lista, as 50 mais recentes) `{de, para, deCodigo, paraCodigo, em}` (`de`/`para` = id do processo, `''` = sem processo; `em` ISO). `listar` devolve `item.historicoProcessos` (e a prévia também `item.processoId`). Só admin (função `mover_resposta`); erros `Processo não encontrado.`, `Candidato não encontrado.`, `Candidato não informado.`.
- `versaoBanco()` (sem token) → `{ok, versao, faltando:[nomes das migrações cujo efeito não está no banco, ex. "20261009120000_fotos"]}`. Função pública só leitura `versao_banco()` → `{ok, versao, migracoes, faltando}` (20261011120000 desde a migração de vendas; o cliente acrescenta em `faltando` as migrações mais novas que a versão respondida) (confere tabelas/colunas de cada migração: `pessoas`, `empresas`, `respostas.exigido`, `respostas.foto`, `respostas.historico_processos`/`empresas.organograma`). Banco sem a função (PostgREST `PGRST202`): o cliente sonda com consultas `limit 0` (precisa do login de admin) e devolve `semFuncao: true` com a `20261010…` em `faltando`. A prévia devolve sempre a mais nova (`faltando: []`). Lista das migrações: `DISC_API_SUPABASE.MIGRACOES`.
- Qualquer função do banco que não existe (migração faltando) vira `O banco de dados está desatualizado. Peça para aplicar as migrações (veja docs/SUPABASE.md).` com `erro.bancoDesatualizado = true`.
- No Apps Script legado (`js/api.js`) `moverResposta`, `contratarPessoa` e `versaoBanco` respondem `Disponível só com o servidor Supabase.`

### Relatórios por modelo (equipe, liderança, pessoa)

- `relatorios` ganha `id` (uuid), `modelo` (`processo` padrão | `equipe` | `lideranca` | `pessoa`), `empresa_id`, `pessoa_id`; `processo_id` pode ser nulo. Checagem: `processo` exige `processo_id`; `equipe` exige `empresa_id`; `lideranca`/`pessoa` exigem `pessoa_id`. Modelos novos: `dados` é objeto e ≤ ~1 MB (era 300 KB até a migração de fotos). `relatorio_publico` devolve também `modelo` (relatórios antigos = `processo`).
- `dados` é o snapshot pronto montado no navegador (`js/relatorio-modelos.js`), sem telefone/idade/e-mail.
- `salvarRelatorioModelo(token, {id?, modelo, empresaId?, pessoaId?, dados, publicar?})` → `{relatorio:{id, token, status, modelo, url?}}` (`publicar:true` publica, `false` volta a rascunho, ausente mantém; `url` = pasta do site + `relatorio.html?r=<token>`; os dados ganham `modelo`).
- `listarRelatoriosModelo(token, {empresaId?, pessoaId?})` → `{relatorios:[{id, token, modelo, status, titulo, empresaId, pessoaId, criadoEm, atualizadoEm, publicadoEm, url?}]}` · `excluirRelatorioModelo(token, id)` → `{id}`. Nenhum dos três toca relatórios de processo; as ações do relatório de processo (`relatorio.*`, `relatoriosListar`) ignoram os modelos novos.
- `relatorioPublico(token)` → `{ok, modelo, relatorio, publicadoEm}`.

### Venda direta B2C — "Mapa de Perfil" (migração `20261011120000_vendas.sql`; Edge Functions `pagamento` e `asaas-webhook`; só Supabase e prévia)

Produto da **Gestão sem Caos** vendido direto ao público: resumo grátis + pacotes pagos (Pix e cartão pelo Asaas). Passo a passo do dono: `docs/VENDAS.md`. Contrato completo dos métodos no topo de `js/api-supabase.js` (os agentes do site e do painel programam contra estes nomes). Dinheiro **sempre em centavos** (inteiro).

- **Banco:** `respostas.origem` (`processo` | `pessoal`) e `respostas.token_resumo`; tabelas `pacotes` (`gratis`, `completo` R$ 39 / lançamento R$ 29, `completo_plus` R$ 69 / lançamento R$ 49; `lancamento_ate` nulo = sem fim), `cupons` (`percentual` 1–100 ou `valor` em centavos; `usos_max`, `valido_ate`, `pacotes` [] = todos; o uso conta quando o pedido vira pago/cortesia, uma vez), `pedidos` (`aguardando` | `pago` | `cortesia` | `estornado` | `cancelado`; `token_acesso`), `limites_vendas` (anti-abuso). Tokens: 64 hex de `gen_random_uuid()` ×2 (gerador criptográfico). RLS: `anon` não lê nada; painel lê pedidos (muda só por `atualizar_pedido`), cupons à vontade, pacotes só altera. Respostas pessoais não contam nos limites do recrutamento (`enviar_resposta` recriada com os limites só sobre `origem = 'processo'`).
- **RPCs públicas:** `enviar_resposta_pessoal(p_payload)` → `{ok, id, protocolo:'', tokenResumo}` (e-mail obrigatório, WhatsApp opcional — com ele a ficha da pessoa é ligada —, sem idade/processo/protocolo; 2 envios/min e 20/dia por e-mail, 120 por 10 min no total); `resumo_pessoal(p_token)` → `{nome (primeiro), resultado, recebidoEm, temParte2}`; `pacotes_publicos()`; `criar_pedido(p_token_resumo, p_pacote, p_cupom)` → `{pedidoId, tokenAcesso, valor, valorOriginal, gratuito, status, jaPago?}` (cupom 100% → `cortesia`; mesmo pedido aberto em 24 h é reaproveitado; 10 cupons errados/10 min e 10 pedidos/h por resposta); `status_pedido(p_pedido, p_token)`; `relatorio_pessoal(p_token)` → `{nome, resultado, exigido (40 dígitos | null), pacote, pacoteNome, precisaParte2, status}` **só** com `pago`/`cortesia`; `salvar_parte2_pessoal(p_token, p_exigido)` (só `completo_plus`, uma vez). Nenhuma devolve e-mail ou telefone.
- **RPCs do painel (admin):** `atualizar_pedido(p_id, p_status)` (estornado ← pago/cortesia; cortesia ← aguardando/cancelado/estornado; pago ← aguardando/cancelado; cancelado ← aguardando) e `resumo_vendas(p_periodo)` (`hoje`|`7d`|`30d`|`mes`|`tudo`; receita só de `pago`; conversão = compras ÷ resumos).
- **Edge Function `pagamento`** (pública, `verify_jwt = false`): `criar` (pedidoId + tokenAcesso [+ cpf]) cria cliente e cobrança `UNDEFINED` no Asaas (descrição "Mapa de Perfil DISC — <pacote> — Gestão sem Caos", `externalReference` = id do pedido, vencimento amanhã) e devolve QR Pix + copia-e-cola + `invoiceUrl` (cartão); cobrança reaproveitada; sem `ASAAS_API_KEY` → `Pagamento ainda não configurado.`; Asaas exigindo CPF → `precisaCpf` (o CPF não é gravado). `status` lê o pedido e, se aguardando, confere no Asaas no máximo a cada 15 s. `recuperar` (e-mail) manda os links pelo Resend (3/h por e-mail, 60/h no total; sem `RESEND_API_KEY` → "…Fale com o suporte."; resposta igual com ou sem compra).
- **Edge Function `asaas-webhook`** (pública, `verify_jwt = false`): cabeçalho `asaas-access-token` = `ASAAS_WEBHOOK_TOKEN` (comparação em tempo constante; sem segredo 503; errado 401). `PAYMENT_RECEIVED`/`PAYMENT_CONFIRMED` → `pago` (só de aguardando/cancelado e com valor pago ≥ valor do pedido; manda o e-mail com o link uma vez); `PAYMENT_REFUNDED`/`PAYMENT_PARTIALLY_REFUNDED`/`PAYMENT_CHARGEBACK_REQUESTED`/`PAYMENT_CHARGEBACK_DISPUTE` → `estornado` (relatório bloqueado; evento de pagamento atrasado não reabre); `PAYMENT_DELETED` → `cancelado` (se aguardando). Cobrança diferente da gravada no pedido é ignorada. Falha no banco → 500 (o Asaas reenvia).
- **Segredos novos:** `ASAAS_API_KEY`, `ASAAS_AMBIENTE` (`sandbox` padrão | `producao`), `ASAAS_WEBHOOK_TOKEN`, `RESEND_API_KEY` (opcional), `EMAIL_REMETENTE` (opcional). `js/config.js`: `WHATSAPP_SUPORTE`, `EMPRESA_LEGAL`.
- **Cliente (`DISC_API`):** públicos `pacotesPublicos`, `enviarPessoal`, `resumoPessoal`, `criarPedido`, `iniciarPagamento` (resolve `{ok:false, naoConfigurado|precisaCpf}` nos dois casos acima), `statusPedido` (Edge Function; sem ela, RPC), `relatorioPessoal` (devolve `exigido` já calculado `{percentuais, codigo}` e `exigidoRespostas`), `salvarParte2Pessoal`, `recuperarAcesso`; painel `listarPedidos`, `atualizarPedido`, `listarCupons`, `salvarCupom`, `excluirCupom`, `listarPacotes`, `salvarPacote`, `resumoVendas`; `listar` ganha `item.origem`. Prévia: Pix fictício e `DISC_API.simularPagamento(pedidoId)`; cupons `PREVIA100` e `LANCA10`. Apps Script: "Disponível só com o servidor Supabase."

#### Stripe como meio de pagamento padrão (migração `20261014120000_stripe.sql`; Edge Function `stripe-webhook`)

Pagamento **dentro do site** com o Stripe Payment Element (cartão, Apple Pay, Google Pay, Pix com QR). Passo a passo: `docs/VENDAS.md` ("Opção recomendada: Stripe").

- **Provedor:** `PAGAMENTO_PROVEDOR` = `stripe` | `infinitepay` | `asaas`; sem ele: `stripe` se houver `STRIPE_SECRET_KEY`, senão `infinitepay`, senão `asaas`.
- **`criar`:** `POST /v1/payment_intents` (form-encoded, `Idempotency-Key: mapa-disc-<pedido>-<valor>[-n]`): `amount` (centavos), `currency=brl`, `automatic_payment_methods[enabled]=true`, `description="Mapa DISC — Gestão sem Caos"`, `statement_descriptor_suffix=MAPA DISC`, `metadata[pedido_id]`, `receipt_email` → `{ok, provedor:'stripe', clientSecret, publicavel (STRIPE_PUBLISHABLE_KEY), valor}`. PaymentIntent reaproveitado enquanto pode ser pago; `pedidos.provedor_ref` = `pi_…`; o client_secret não é gravado.
- **`confirmar` / `status`:** `GET /v1/payment_intents/:id?expand[]=payment_method`; pago só com `status=succeeded`, `metadata[pedido_id]` = pedido, `currency=brl` e `amount_received >= valor`.
- **`stripe-webhook`** (pública, `verify_jwt=false`): `Stripe-Signature` = HMAC-SHA256 de `${t}.${corpo}` com `STRIPE_WEBHOOK_SECRET` (Web Crypto `subtle.verify`, tolerância 5 min); `payment_intent.succeeded` → confere no Stripe e marca pago (idempotente); `charge.refunded` / `charge.dispute.created` → `estornado`; `payment_intent.payment_failed` → grava `provedor_dados.recusa` {em, intent, codigo, motivo, tipo, metodo, mensagem} sem mudar o status (o painel mostra "Última recusa"; a ação `status` devolve `recusado:true` + mensagem em português quando a última tentativa foi recusada). Todas as chamadas levam `Stripe-Version: 2026-08-26.dahlia`; a chave do servidor pode ser restrita (`rk_`). Sem segredo 503, assinatura ruim 400, banco 500, Stripe fora 502.
- **Cliente:** `js/stripe-pagamento.js` (DISC_STRIPE) carrega `https://js.stripe.com/v3/` só na hora, monta o Payment Element (tabs, pt-BR, tokens de `notus.css`) e chama `confirmPayment({redirect:'if_required', return_url: meu-relatorio.html?pedido=<id>#t-<token>})`; Pix mostra o QR também na nossa tela e a página consulta a cada 4 s. `meu-relatorio.html` trata `payment_intent`/`redirect_status` na volta (3DS) com `confirmarRetorno({paymentIntent})`. Prévia/demonstração: "Payment Element" fictício (`montarSimulado`), sem carregar o Stripe.
- **Painel:** Conexões ganha o cartão "Pagamento — Stripe" (`conexoes.testar` alvos `stripe`, `stripe.pagamento`, `stripe.verificar`); Vendas mostra "Abrir no Stripe" (`https://dashboard.stripe.com/payments/<pi>`).

#### InfinitePay como meio de pagamento (migração `20261012120000_infinitepay.sql`; Edge Function `infinitepay-webhook`)

O dono prefere a **InfinitePay** (Checkout Integrado, API pública da CloudWalk, sem chave de API: a conta é a InfiniteTag no segredo `INFINITEPAY_HANDLE`, sem o `$`). O Asaas continua funcionando como alternativa. Passo a passo: `docs/VENDAS.md` ("Opção recomendada: InfinitePay").

- **Escolha do provedor (servidor):** segredo `PAGAMENTO_PROVEDOR` = `infinitepay` | `asaas`; sem ele: `infinitepay` se houver `INFINITEPAY_HANDLE`, senão `asaas` se houver `ASAAS_API_KEY`, senão "Pagamento ainda não configurado.". Pedido que já começou num provedor (`pedidos.provedor`) continua nele enquanto esse provedor estiver configurado.
- **Banco:** `pedidos.provedor` (`asaas` | `infinitepay` | null; pedidos com cobrança do Asaas viram `asaas`), `provedor_ref` (InfinitePay: `transaction_nsu`, ou o slug), `checkout_url` (link de pagamento, `https://`), `provedor_dados` (jsonb ≤ 60 000 caracteres: link criado, retorno do cliente, corpo bruto do webhook e resposta do `payment_check` — só depuração). `pedido_json` ganha `provedor`, `provedorRef`, `checkoutUrl`; `versao_banco()` → `20261012120000`.
- **`pagamento` → `criar` com InfinitePay:** `POST https://api.checkout.infinitepay.io/links` com `{handle, items:[{quantity:1, price (centavos), description}], order_nsu = id do pedido, redirect_url = SITE_URL/meu-relatorio.html?pedido=<id>#t-<token>, webhook_url = SUPABASE_URL/functions/v1/infinitepay-webhook, customer:{name, email}}` → `{ok, provedor:'infinitepay', redirecionarUrl, valor}` (link reaproveitado por 12 h; URL lida de `url`, `link`, `checkout_url` ou `payment_url`). Sem `SITE_URL` → não configurado. Com Asaas a resposta ganha `provedor:'asaas'` (resto igual).
- **`pagamento` → `confirmar`** `{pedidoId, tokenAcesso, transactionNsu, slug}` → `{ok, status}`: `POST …/payment_check {handle, order_nsu, transaction_nsu, slug}`; marca `pago` só com `paid = true` **e** `paid_amount` (ou `amount`) ≥ valor do pedido (método `pix`/`cartao` de `capture_method`; e-mail com o link uma vez). Guarda as referências para o `status` voltar a conferir (a cada 15 s) enquanto aguardando; no máximo 1 conferência a cada 5 s.
- **`infinitepay-webhook`** (pública, `verify_jwt = false`): a InfinitePay não assina o aviso → o corpo **nunca** libera nada sozinho: lê `order_nsu`, `transaction_nsu`, `invoice_slug`/`slug` e confere com o `payment_check` (mesma regra). Só pedidos com `provedor = 'infinitepay'`; idempotente (pago → `repetido`); grava o corpo bruto em `provedor_dados.webhook`. 200 `{ok, feito, motivo}`; banco fora → 500; InfinitePay fora → 502 (para reenviar). Não há webhook a cadastrar: o endereço vai em cada link.
- **Suposições (documentação oficial inacessível deste ambiente):** `amount`/`paid_amount` em centavos (número com casas decimais é lido como reais); na dúvida o pedido **não** é liberado. Estorno/reembolso da InfinitePay não chega por webhook: marque "Reembolsar/estornar" no painel.
- **Cliente (`DISC_API`):** `iniciarPagamento` pode devolver `{ok, provedor:'infinitepay', redirecionarUrl, valor}` (o site faz `location.href = redirecionarUrl`); `confirmarRetorno(pedidoId, tokenAcesso, {transactionNsu, slug})` → `{ok, status}` (sem a função: RPC `status_pedido`). Na volta, `meu-relatorio.html` lê `pedido`/`order_nsu`, `transaction_nsu`, `slug` de `location.search` (tolerante: também depois do token no hash) e o token de `#t-<64 hex>`. Prévia: InfinitePay por padrão — `redirecionarUrl = 'meu-relatorio.html?pedido=<id>&order_nsu=<id>&transaction_nsu=SIM&slug=SIM&capture_method=pix#t-<token>'` e `confirmarRetorno` marca pago; `CONFIG.PAGAMENTO_PREVIA = 'asaas'` volta ao Pix fictício. Apps Script: "Disponível só com o servidor Supabase."

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
- `avaliacaoPublica {codigo}` → `{ok, avaliacao:{codigo, nome, tipo, empresaNome, mostrarResultado, formulario}}` (só avaliações ativas; `formulario` no Supabase e na prévia — o Apps Script legado não manda e o site usa o padrão).
- `login {email, senha}` → `{ok, token, usuario:{id, nome, email, papel, empresaId, empresaNome}}`.
- `primeiroAcesso {chave, nome, email, senha}` → igual ao login (+ `redefinida`).
- `relatorioPublico {token}` → `{ok, relatorio, publicadoEm}` só se publicado; senão "Relatório não encontrado ou fora do ar.".

Com sessão (`token` no corpo):
- `eu`, `sair`, `trocarSenha {senhaAtual, novaSenha}` (a sessão atual continua; as outras caem).
- `listar` → `{ok, itens:[payload + status, observacoes, recebidoEm, protocolo, avaliacao, empresaId, empresaNome, avaliacaoNome, avaliacaoTipo, validacao (+ pessoaId, pessoa, email, cidade, extras no Supabase e na prévia)]}` (admin: tudo; gestor: só a empresa dele; respostas sem código só o admin vê).
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
- **Banco** (`supabase/migrations/`, aplicadas em ordem, cada uma idempotente: `20261005120000_disc.sql`, `20261006120000_pessoas_formulario.sql`, `20261007120000_empresas_equipes.sql`, `20261008120000_parte2.sql`, `20261009120000_fotos.sql`, `20261010120000_mover_versao.sql` e `20261011120000_vendas.sql`; `supabase/seed_previa.sql` = exemplos para projeto de teste): tabelas `admins`, `processos` (código de 4 caracteres gerado por gatilho; `config.formulario` normalizado e pergunta sensível recusada), `pessoas` (ficha por WhatsApp; `foto`), `respostas` (id do payload, protocolo único, D/I/S/C e perfil recalculados, `status`, `validacao`, `payload`, `clickup_sync`, `pessoa_id`, `email`, `cidade`, `extras`, `exigido`, `foto`, `historico_processos`), `relatorios` (token ≥ 32 caracteres; `rascunho`|`publicado`; `modelo`), `empresas` (`organograma` = {topoIds}), `vinculos`, `relacoes` e `configuracoes` (só valores não secretos). **RLS em todas**; `anon` não acessa tabela nenhuma; `authenticated` só com `public.e_admin()`. Auxiliares no schema `disc_interno` (fora da API).
- **RPCs** (security definer, `search_path` fixo): `avaliacao_publica(p_codigo)` → `{codigo, nome, tipo, empresaNome, mostrarResultado, formulario}` (só processos ativos; `formulario.parte2` incluso); `enviar_resposta(p_payload)` → `{ok, id, protocolo, duplicado?}` com as mesmas validações e mensagens do `Code.gs` mais as do formulário do processo, ligando a resposta à pessoa e atualizando a ficha (idempotente por `id`; no máx. 40 envios por 10 minutos e 2.000 linhas); `relatorio_publico(p_token)` → `{ok, modelo, relatorio, publicadoEm}` (só publicado); para o painel (authenticated, só admin): `salvar_colaborador`, `mover_colaborador`, `salvar_relacoes`, `remover_foto`, `salvar_minha_foto` (só a própria foto); `garantir_primeiro_admin()` (tabela `admins` vazia → o usuário logado vira admin; depois só admin convida admin).
- **Edge Functions** (Deno; fonte em `supabase/functions/<nome>/index.ts` + `supabase/funcoes-compartilhadas/*.js`; `npm run montar:funcoes` gera `dist/funcoes/<nome>/index.ts`, um arquivo autocontido por função para colar no painel; `npm test` confere se estão atualizados):
  - `admin` (JWT de usuário admin): `clickup.status`, `clickup.listas`, `processo.dados`, `relatorio.rascunho`, `relatorio.salvar`, `relatorio.publicar` (comenta o link na tarefa "📌 Briefing…"), `relatorio.despublicar`, `relatorios.listar`, `relatorio.melhorarTextos`, `usuarios.listar|convidar|remover` (convite por `inviteUserByEmail` com retorno para `SITE_URL/admin.html`). Participantes e processos vão direto nas tabelas (PostgREST com RLS).
  - `disc-sync` (o site chama logo depois de `enviar_resposta`, com `{id}`; responde só `{ok}`): grava o DISC na tarefa do candidato achada pelo WhatsApp, ou cria "<nome> (DISC)" com a etiqueta "sem formulário"; idempotente (`respostas.clickup_sync`).
  - `clickup-webhook` (público, "Verify JWT" desligado; assinatura `X-Signature` HMAC-SHA256 com `CLICKUP_WEBHOOK_SECRET`): tarefa "📌 Briefing…" que vai para "gerar relatório" numa lista ligada a um processo → rascunho, comentário e status "relatório em revisão" (substitui o gatilho de 10 minutos).
  - `pagamento`, `stripe-webhook`, `infinitepay-webhook` e `asaas-webhook` (venda direta; ver "Venda direta B2C" e "InfinitePay" acima).
  - Segredos: `CLICKUP_TOKEN`, `SITE_URL`, `CLICKUP_PASTA_ID` (opcional), `ANTHROPIC_API_KEY` (opcional), `CLICKUP_WEBHOOK_SECRET`; `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` são automáticos. CORS: origem de `SITE_URL` e `localhost`.
- **Painel com Supabase:** login por e-mail e senha do Supabase Auth, "Esqueci minha senha" (volta com `#type=recovery` → "Defina sua nova senha"; convite `#type=invite` idem); sem "Primeiro acesso" com chave; aba Usuários convida e remove administradores (sem redefinir senha de outra pessoa). Com `appsscript`/`simulada`, tudo como antes.
- **Operação:** `.github/workflows/manter-ativo.yml` chama `avaliacao_publica('ZZZZ')` a cada 3 dias (segredos do GitHub `SUPABASE_URL` e `SUPABASE_ANON_KEY`; sem eles não faz nada) para o projeto grátis não pausar. `scripts/migrar-planilha.mjs Respostas.csv [--processos Avaliacoes.csv] [--saida importar.sql]` converte o CSV das abas da planilha em `INSERT … on conflict do nothing` (numa transação; mantém id, protocolo e o código do processo; recalcula D/I/S/C e perfil; pula linhas inválidas com aviso; telefone normalizado como `normalizarTelefone` do `Code.gs`).
- **Testes:** `npm test` (unidade, incluindo `tests/funcoes/` e `tests/migrar-planilha.test.js`); `npm run test:supabase` roda a migração num Postgres embutido (`embedded-postgres`) com um schema `auth` mínimo e os papéis `anon`/`authenticated`/`service_role`. Nenhum teste acessa `*.supabase.co`, o ClickUp ou a Anthropic.
