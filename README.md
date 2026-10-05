# Teste DISC para processo seletivo

Sistema simples para aplicar o **teste de perfil comportamental DISC** aos candidatos de um processo seletivo e, depois, gerar um **Guia para a Liderança** de quem foi aprovado. O guia explica ao gestor como se comunicar, delegar, motivar, dar feedback e acompanhar a pessoa nos primeiros 30 dias.

- **Candidato:** abre um link no celular ou no computador, informa nome completo e telefone (WhatsApp), autoriza o uso dos dados e responde 25 grupos de palavras. Leva cerca de 10 minutos.
- **Recrutador:** abre o painel (`admin.html`), vê os resultados, filtra, marca quem foi aprovado e abre o Guia para a Liderança, que pode ser impresso, salvo em PDF ou copiado.

Não precisa instalar nada e não tem mensalidade. O site é estático (GitHub Pages) e os resultados ficam numa **planilha do Google que é sua**.

---

## 1. Como funciona o teste

1. Em cada um dos 25 grupos aparecem 4 palavras ou frases.
2. O candidato toca primeiro na que **mais** combina com ele (vale 4), depois na próxima (3) e na seguinte (2). A última recebe 1 automaticamente. O botão **Refazer grupo** recomeça o grupo.
3. A ordem das palavras é embaralhada para cada candidato, o que dificulta "escolher a resposta certa".
4. Ao final o candidato revisa as respostas e envia.
5. O sistema soma os pontos de cada fator: **D** (Dominância), **I** (Influência), **S** (Estabilidade) e **C** (Conformidade). Os quatro somam 100%, e a média de cada um é 25%. O perfil é a letra mais alta seguida da segunda mais alta (ex.: **DI**, **SC**).

> O DISC descreve o comportamento preferido da pessoa no trabalho. Ele **não mede** capacidade, inteligência nem caráter. Use o resultado como apoio à entrevista, nunca como único critério de decisão.

---

## 2. Publicar o site no GitHub Pages (grátis)

1. Crie uma conta em <https://github.com> (se ainda não tiver).
2. Clique em **New repository**, dê um nome (ex.: `teste-disc`), deixe **Public** e clique em **Create repository**.
3. Clique em **uploading an existing file** e arraste os arquivos e pastas do projeto: `index.html`, `admin.html`, `assets/` e `js/` (as outras pastas podem ir junto, não atrapalham). Clique em **Commit changes**.
4. Vá em **Settings > Pages**. Em **Source**, escolha **Deploy from a branch**, branch **main**, pasta **/ (root)**, e clique em **Save**.
5. Em 1 ou 2 minutos aparece o endereço do site, por exemplo:
   - **Link para os candidatos:** `https://seu-usuario.github.io/teste-disc/`
   - **Painel do recrutador:** `https://seu-usuario.github.io/teste-disc/admin.html`

Para mudar algo depois (por exemplo o `js/config.js`), abra o arquivo no GitHub, clique no lápis, edite e clique em **Commit changes**.

> Nenhum arquivo do site é secreto. A chave de primeiro acesso e as senhas ficam **só** no Google, nunca nos arquivos do site.

---

## 3. Configuração mínima (`js/config.js`)

Abra `js/config.js` e preencha:

| Campo | O que é | Exemplo |
|---|---|---|
| `API_URL` | Endereço do servidor (Google Apps Script) que grava os resultados na sua planilha. | `'https://script.google.com/macros/s/AKfy.../exec'` |
| `WHATSAPP_RECRUTADOR` | Seu WhatsApp com 55 + DDD, só números. Aparece como botão "Enviar pelo WhatsApp" quando o candidato precisa mandar o código. | `'5511999998888'` |
| `EMPRESA` | Nome da empresa exibido nas telas (opcional). | `'Padaria Bom Pão'` |
| `MOSTRAR_RESULTADO_AO_CANDIDATO` | `true` mostra o perfil ao candidato no final. | `false` |

> **Atenção:** preencha **pelo menos um** entre `API_URL` e `WHATSAPP_RECRUTADOR`. Se os dois ficarem vazios, o candidato termina o teste com um código, mas a tela não informa **para onde** mandar. Nesse caso, diga na mensagem com o link do teste: "ao terminar, me mande o código por aqui".

### Opção recomendada: com servidor (planilha do Google)

Os resultados chegam sozinhos na sua planilha e aparecem no painel. O passo a passo completo, com imagens de onde clicar, está em **[docs/BACKEND.md](docs/BACKEND.md)**. Resumo:

1. Crie uma planilha no Google Planilhas.
2. **Extensões > Apps Script**: cole o conteúdo de `apps-script/Code.gs`.
3. Execute a função **setup** uma vez e **copie a chave de primeiro acesso** que aparece no registro de execução. Guarde-a em local seguro: ela cria o seu login no painel (veja "Logins e avaliações").
4. **Implantar > Nova implantação > App da Web** (Executar como: **Eu**; Quem pode acessar: **Qualquer pessoa**).
5. Copie a URL que termina em `/exec` e cole em `API_URL` no `js/config.js`.

### Opção sem servidor (código + WhatsApp)

Deixe `API_URL` vazio e preencha `WHATSAPP_RECRUTADOR`.

1. Ao terminar, o candidato vê um **código de resultado** (um texto que começa com `DISC1.`) e o botão **Enviar pelo WhatsApp**, que já abre a conversa com você com nome, telefone e código.
2. Você copia a mensagem inteira (ou só o código) e cola no painel, na aba **Importar códigos**.
3. Nesse modo os dados ficam **só no navegador** em que você importou. Use sempre o mesmo computador e navegador.

O código também é o **plano B** quando há servidor: se o envio falhar (internet ruim, por exemplo), o candidato toca em **Gerar código de resultado** e manda para você. No painel com servidor, a aba **Importar códigos** envia esse resultado para a planilha, como se o candidato tivesse enviado.

---

## 4. Enviar o link aos candidatos

Mande o link do site (ex.: `https://seu-usuario.github.io/teste-disc/`) por WhatsApp ou e-mail. Sugestão de mensagem:

> Olá, [nome]! Como parte do processo seletivo, faça este teste de perfil comportamental (cerca de 10 minutos, pelo celular): [link]. Não há respostas certas ou erradas. Se aparecer um código no final, me mande por aqui.

Cada candidato informa **nome completo** e **telefone com DDD**, que é como você o identifica depois. Se a página for fechada no meio, o progresso fica salvo no aparelho por até 7 dias, e ele continua de onde parou.

---

## 5. Usar o painel do recrutador

Abra `admin.html` (ex.: `https://seu-usuario.github.io/teste-disc/admin.html`).

1. **Entrar:** com servidor, entre com o seu **e-mail e senha** (veja "Logins e avaliações"). A sessão vale até 6 horas sem uso. Sem servidor, o painel abre direto.
2. **Importar códigos** (quando o candidato mandar um código): cole a mensagem ou o código e clique em **Importar**. Pode colar vários de uma vez.
3. **Lista:** mostra nome, telefone (clique para abrir o WhatsApp), vaga, data, função e empresa (atual ou última), perfil e as barras D/I/S/C. Use a busca (nome, telefone, função ou empresa) e os filtros de perfil e de status. A **idade** do candidato aparece só nos **Detalhes**, de propósito: para não influenciar a triagem (a lei proíbe discriminar por idade).
4. **Detalhes:** clique em **Ver detalhes** para ver o gráfico, as características do perfil e o **Guia para a Liderança**.
5. **Aprovar:** no detalhe, mude o status para **Aprovado** (ou Reprovado / Em análise) e escreva observações, se quiser.
6. **Gerar o guia para a liderança:** no detalhe do aprovado,
   - **Imprimir / salvar PDF:** abre a impressão do navegador. Escolha "Salvar como PDF" para mandar ao gestor.
   - **Copiar guia:** copia o texto pronto para colar no WhatsApp ou no e-mail.
7. **Comparativo:** mostra a distribuição dos perfis dos aprovados. Ajuda a montar uma equipe equilibrada.
8. **Exportar CSV:** baixa a lista para abrir no Excel ou no Google Planilhas.

### Logins e avaliações

- **Primeiro acesso:** no painel, toque em **Primeiro acesso**, cole a chave do passo 3 e escolha nome, e-mail e senha (mínimo 8 caracteres). Você vira **administrador**. Esqueceu a senha? Faça o primeiro acesso de novo com a mesma chave e o mesmo e-mail: a senha é redefinida.
- **Papéis:** o **administrador** vê e faz tudo. O **gestor** de uma empresa vê só os participantes dela, pode mudar o status e escrever observações, mas não exclui nem cria nada.
- **Empresas e avaliações:** na aba **Empresas**, cadastre o cliente. Na aba **Avaliações**, crie uma avaliação para ele: **Processo seletivo** (candidatos a uma vaga) ou **Avaliação de equipe** (quem já trabalha lá). Cada avaliação ganha um link próprio, como `.../index.html?a=K7QX`. Use **Copiar mensagem** para mandar pelo WhatsApp. Marque **Mostrar resultado** se a pessoa deve ver o próprio perfil no final. Para encerrar, toque em **Desativar**: o link para de funcionar.
- **Usuários:** na aba **Usuários**, crie o login do gestor, escolha a empresa dele e gere uma senha temporária. Mande a senha por um canal seguro e peça para ele trocá-la em **Trocar senha**.
- **Confiabilidade:** no fim do teste, o participante passa por uma confirmação rápida. Ele escolhe entre descrições e diz o quanto concorda com algumas frases, inclusive o lado "sombra" dos pontos fortes. O painel mostra se o resultado é de confiabilidade **alta**, **média** ou **baixa** e explica o motivo. O participante nunca vê essa informação.
- **Prévia:** com `API_URL: 'simulada'`, entre com `admin@previa.com` ou `gestor@previa.com` e a senha `previa123`. Os links de exemplo são `index.html#a-SEL1` e `index.html#a-EQP1`.

### ClickUp e relatórios

- **Cada processo seletivo é uma lista do ClickUp.** Os candidatos vêm de lá; o painel não tem cadastro próprio de candidatos.
- **Configurar uma vez:** crie os campos na pasta "Recrutamento e Seleção" (WhatsApp, notas das etapas, campos do DISC…) e coloque o token do ClickUp nas Propriedades do script. O passo a passo está em [docs/CLICKUP.md](docs/CLICKUP.md).
- **Ligar o processo:** na aba **Processos**, escolha a lista do ClickUp e preencha empresa, vaga, cidade, consultor, contratante, período, perfil ideal, etapas (nome do campo da nota e peso), bônus e nota de corte. O link do teste continua o mesmo (`index.html?a=CODIGO`).
- **DISC no ClickUp:** quando o candidato termina o teste, o resultado vai sozinho para a tarefa dele (achada pelo WhatsApp). Se não achar, o sistema cria a tarefa "<nome> (DISC)" com a etiqueta `sem formulário`.
- **Relatório para o contratante:** em **Gerar rascunho do relatório**, revise os textos, toque em **Publicar** e mande o link. O relatório mostra só primeiro nome + inicial do sobrenome; nunca telefone, e-mail, idade individual ou dado sensível.
- **Prévia:** com `API_URL: 'simulada'`, o processo "Cartório Exemplo — Escrevente" usa candidatos fictícios (nada é enviado ao ClickUp) e o relatório de exemplo abre em `relatorio.html#r-exemplo-cartorio`. Para quem mexe no código: os dados de exemplo saem de `tests/fixtures/processo-exemplo.json`; depois de mudar esse arquivo, rode `npm run montar:fixture`.

---

## 6. LGPD e como apagar os dados

- O candidato só começa o teste depois de marcar a autorização: os dados (nome, telefone e respostas) são usados **apenas neste processo seletivo** e **excluídos ao final**.
- No aparelho do candidato: o progresso é apagado ao concluir e expira em 7 dias se o teste for abandonado. Depois de um envio bem-sucedido, nenhum dado pessoal fica guardado no aparelho. O código de resultado só fica visível até a aba ser fechada.
- Códigos importados sem o registro da autorização são recusados pelo painel.

**Ao fim do processo seletivo, apague os dados de verdade:**

1. **Com servidor:** exclua o **arquivo da planilha** no Google Drive e **esvazie a lixeira**. O botão **Excluir todos** do painel só limpa a aba: o **Histórico de versões** da planilha continua guardando os dados. Para o próximo processo, crie uma planilha nova e repita a configuração (detalhes em [docs/BACKEND.md, seção 7](docs/BACKEND.md#7-apagar-os-dados-ao-fim-do-processo-seletivo-lgpd)).
2. **Sem servidor:** no painel, clique em **Excluir todos** e digite `EXCLUIR`. Os dados ficam só no seu navegador, então isso basta.
3. Apague também os **CSVs e PDFs** que você salvou e as **mensagens com códigos** recebidas no WhatsApp.
4. Guarde só o Guia para a Liderança de quem foi **contratado**, se for usá-lo.

---

## 7. Para quem mexe no código: rodar os testes

Requer [Node.js](https://nodejs.org) 18 ou mais recente.

```bash
npm install                     # instala o Playwright (testes de navegador)
npx playwright install chromium # baixa o navegador usado nos testes (uma vez)
npm test                        # testes de unidade (cálculo, guia, backend, painel)
npm run test:e2e                # testes de ponta a ponta no navegador (celular e computador)
npm start                       # servidor local: abra http://localhost:4173
```

Estrutura principal:

| Arquivo | Para que serve |
|---|---|
| `index.html`, `js/app.js`, `assets/styles.css` | Tela do candidato |
| `admin.html`, `js/admin.js`, `assets/admin.css` | Painel do recrutador |
| `js/disc-data.js` | Palavras dos 25 grupos e descrição dos perfis (da planilha original) |
| `js/scoring.js` | Cálculo do resultado |
| `js/lideranca.js` | Textos do Guia para a Liderança |
| `js/codec.js`, `js/api.js`, `js/config.js` | Código de resultado, conexão com o servidor e configuração |
| `apps-script/Code.gs`, `docs/BACKEND.md` | Servidor na planilha do Google e o passo a passo |
| `docs/SPEC.md` | Especificação técnica |
