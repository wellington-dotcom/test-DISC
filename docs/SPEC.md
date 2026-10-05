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
- Com backend, o servidor devolve um **protocolo** curto (ex. `47K`) que o candidato vê na conclusão e informa ao recrutador.
- Plano B sem backend (ou envio com falha): ao concluir, o candidato vê um **código de segurança** longo (e botão "Enviar pelo WhatsApp" quando `CONFIG.WHATSAPP_RECRUTADOR` está preenchido). O admin cola o código no painel para importar.

## Arquivos e responsáveis

| Arquivo | Conteúdo |
|---|---|
| `js/disc-data.js` | **Pronto.** `DISC_DATA = { grupos: [25 × {titulo, D, I, S, C}], perfis: {D,I,S,C: {nome, rotulo, cor, positivos[], valorEquipe[], ambienteIdeal[], sobPressao[], limitantes[]}} }` |
| `js/scoring.js` | **Pronto.** `DISC_SCORING = { LETRAS, TOTAL_GRUPOS, validarGrupo, validarRespostas, calcular, compactar, descompactar }` |
| `js/config.js` | `CONFIG = { API_URL: '', WHATSAPP_RECRUTADOR: '', EMPRESA: '', MOSTRAR_RESULTADO_AO_CANDIDATO: false, GRUPOS_DEMONSTRACAO: 0 }`. `API_URL: 'simulada'` liga a API simulada (prévia). |
| `js/codec.js` | `DISC_CODEC = { encode(payload) -> string, decode(string) -> payload }` (base64url de JSON UTF-8, prefixo `DISC1.`) |
| `js/api.js` | `DISC_API = { enviar(payload), listar(chave), atualizar(chave, id, campos), excluir(chave, id), excluirTodos(chave), protocoloValido(v), normalizarProtocolo(v) }` |
| `js/api-simulada.js` | Só age com `CONFIG.API_URL === 'simulada'`: troca `DISC_API` por um backend falso em `localStorage` (`disc_planilha_simulada`) que imita o `Code.gs` (protocolo único, chave admin `previa`, ~400 ms de latência). |
| `js/dicas.js` | **Pronto.** `DISC_DICAS = { dicaPergunta(grupo), dicaPalavra(grupo, letra) -> {palavra, sentido, exemplo} }` (botão "i") |
| `index.html`, `js/app.js`, `assets/styles.css` | Fluxo do candidato |
| `admin.html`, `js/admin.js`, `assets/admin.css` | Painel do recrutador |
| `js/lideranca.js` | `DISC_LIDERANCA = { gerarGuia(resultado, nome) -> {titulo, resumo, secoes:[{titulo, itens:[]}]}, combinacoes: {...} }` |
| `apps-script/Code.gs`, `docs/BACKEND.md` | Backend |
| `tests/*.test.js`, `tests/e2e/*.spec.js`, `package.json` | Testes |
| `README.md` | Guia de uso para o recrutador (pt-BR, leigo) |

Todos os módulos JS usam o padrão UMD já usado em `scoring.js` (global no navegador, `module.exports` no Node) para serem testáveis com `node --test`.
Ordem de scripts nas páginas: `config.js`, `disc-data.js`, `scoring.js`, `codec.js`, `api.js`, `api-simulada.js`, (`dicas.js` no candidato | `lideranca.js` no painel), `app.js`/`admin.js`.

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
  "resultado": { "percentuais": {"D":0,"I":0,"S":0,"C":0}, "codigo": "DI" }
}
```

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

## API do Apps Script

Todas as requisições usam `Content-Type: text/plain;charset=utf-8` (evita preflight CORS). Respostas JSON `{ ok: boolean, ... , erro?: string }`.

- `POST API_URL` corpo `{"acao":"enviar","payload":{...}}` → grava linha e responde `{ok:true, id, protocolo}`. Pública (candidato). Rejeita payload inválido. Id já gravado → `{ok:true, duplicado:true, id, protocolo}` com o **mesmo** protocolo (linha antiga sem protocolo ganha um nesse momento).
- `POST API_URL` corpo `{"acao":"listar","chave":"..."}` → `{ok, itens:[payload + status + observacoes + recebidoEm + protocolo]}` (`protocolo` = `''` quando não há; `idade` = `null` e `funcao`/`empresa` = `''` em linhas antigas).
- `POST API_URL` corpo `{"acao":"atualizar","chave":"...","id":"...","campos":{"status":"aprovado|reprovado|em_analise","observacoes":"..."}}`.
- `POST API_URL` corpo `{"acao":"excluir","chave":"...","id":"..."}` e `{"acao":"excluirTodos","chave":"..."}`.
- A chave admin fica nas Script Properties (`ADMIN_KEY`). Comparação em tempo constante não é necessária, mas nunca retornar a chave.

Colunas da aba `Respostas`: `id, recebidoEm, nome, telefone, vaga, inicio, fim, duracaoSeg, respostas, D, I, S, C, perfil, status, observacoes, payloadJson, protocolo, idade, funcao, empresa`. As colunas novas ficam sempre **no fim**: planilhas antigas sem `protocolo` / `idade` / `funcao` / `empresa` ganham as colunas automaticamente no primeiro acesso (`funcao` e `empresa` em formato texto; `idade` é número); se a aba tiver menos colunas físicas, elas são inseridas. As linhas antigas ficam com essas células vazias.

Prévia: com `API_URL: 'simulada'` a mesma API roda em `js/api-simulada.js` (chave `previa`).

## Painel admin

- Login pela chave admin (guardada em `sessionStorage`). Se `API_URL` vazio, funciona só em modo "importar código" (salvo em `localStorage`).
- Lista: nome, telefone (link `https://wa.me/55...`), vaga, data, uma linha discreta "Função · Empresa" (só se houver), perfil (badge colorido), barras D/I/S/C, status.
- **Idade só no detalhe** do candidato (bloco "Dados do candidato", com "—" quando não há). Ela **não** aparece na lista/cards, nos cards de resumo, no comparativo, na busca nem como filtro. Motivo: evitar discriminação por idade na seleção (Lei 9.029/95); a idade é dado cadastral. Fica também no CSV (coluna `idade`), que é a exportação completa do cadastro.
- Protocolo em cada card ("Código 47K", ou `—`), no detalhe abaixo do nome, no CSV (coluna `protocolo`) e no "Copiar guia".
- Filtros: busca por nome, vaga, função, empresa, código (ignora maiúsculas e espaços) ou telefone (nunca pela idade), perfil primário, status.
- Detalhe mostra também Idade, Vaga pretendida, Função atual/última e Empresa atual/última.
- CSV: colunas `idade`, `funcao`, `empresa` logo após `vaga` (vazias para registros antigos).
- Detalhe do candidato: gráfico de barras DISC (SVG/CSS, sem libs), características do perfil (de `DISC_DATA.perfis`), e o **Guia para a Liderança** de `DISC_LIDERANCA.gerarGuia`. Botão imprimir/salvar PDF (CSS `@media print`) e "copiar guia" (texto).
- Ações: marcar aprovado/reprovado/em análise, observações, excluir, excluir todos (com confirmação digitando EXCLUIR), exportar CSV.
- Comparativo: tabela com distribuição dos perfis dos aprovados (útil para montar equipe).

## Visual

pt-BR, mobile-first (375px), acessível (labels, foco visível, contraste AA). **Identidade visual Notus (out/2026)**: seguir `docs/IDENTIDADE-VISUAL.md` e usar `assets/notus.css` + `assets/icone.svg` (tema claro, como o BI). Cores DISC: D `#13283f`, I `#ff9f40`, S `#8a97ab`, C `#324e73` (classes `.disc-D/I/S/C`). Sem dependências externas (sem CDN) — a fonte Plus Jakarta Sans fica em `assets/fonts`.
