# Como configurar o servidor (Google Planilha + Apps Script)

Este guia mostra, passo a passo, como fazer as respostas dos candidatos chegarem automaticamente a uma **Google Planilha só sua**. Não precisa saber programar: é só copiar, colar e clicar. Leva uns 10 minutos.

> **Não quer configurar agora?** O sistema funciona sem servidor: ao terminar o teste, o candidato recebe um **código de resultado** (e pode enviá-lo pelo WhatsApp). Você cola esse código no painel do recrutador (`admin.html`). Com o servidor, tudo chega sozinho.

---

## 1. Criar a planilha

1. Acesse <https://sheets.new> (abre uma planilha nova no seu Google Drive).
2. Dê um nome, por exemplo **Teste DISC – Respostas**.
3. Não precisa criar nada dentro dela: a aba **Respostas** é criada automaticamente.

> Use uma planilha **nova**, separada da planilha original do teste DISC.

## 2. Colar o código do servidor

1. Na planilha, clique no menu **Extensões > Apps Script**. Abre uma nova aba com um editor.
2. No editor, apague todo o conteúdo do arquivo `Código.gs` (ou `Code.gs`).
3. Abra o arquivo `apps-script/Code.gs` deste projeto, copie **todo** o conteúdo e cole no editor.
4. Clique no ícone de disquete (**Salvar projeto**) ou pressione `Ctrl + S`.
5. (Opcional) Dê um nome ao projeto no topo, por exemplo **DISC servidor**.

> O arquivo `apps-script/appsscript.json` é opcional. Ele só define o fuso horário (São Paulo). Para usá-lo: no editor, clique na engrenagem **Configurações do projeto**, marque **Mostrar arquivo de manifesto "appsscript.json" no editor**, abra esse arquivo e substitua o conteúdo.

## 3. Rodar a configuração inicial (`setup`) e copiar a chave

1. No topo do editor, ao lado do botão **Executar**, há uma lista de funções. Escolha **setup**.
2. Clique em **Executar**.
3. Na primeira vez, o Google pede autorização:
   - Clique em **Revisar permissões** e escolha sua conta.
   - Se aparecer "O Google não verificou este app", clique em **Avançado** e depois em **Acessar DISC servidor (não seguro)**. Isso é normal: o "app" é o seu próprio script.
   - Clique em **Permitir**.
4. Embaixo aparece o **Registro de execução** com uma linha parecida com:

   ```
   Chave de administrador criada. Copie e guarde em local seguro:
   3f9a1c...e7b2   (40 letras e números)
   ```

5. **Copie essa chave** e guarde num lugar seguro (gerenciador de senhas, por exemplo). É ela que você vai digitar para entrar no painel do recrutador.
6. Volte para a planilha: deve existir uma aba **Respostas** com o cabeçalho das colunas.

> **Perdeu a chave?** Rode `setup` de novo: ele mostra a chave atual no registro.
> **Quer trocar a chave?** Escolha a função **gerarNovaChave** e clique em Executar. A chave antiga para de funcionar na hora.

## 4. Publicar como App da Web

1. No editor, clique no botão azul **Implantar > Nova implantação**.
2. Clique na engrenagem ao lado de "Selecionar tipo" e escolha **App da Web**.
3. Preencha:
   - **Descrição:** `DISC v1` (qualquer texto).
   - **Executar como:** **Eu** (seu e-mail).
   - **Quem pode acessar:** **Qualquer pessoa**.
4. Clique em **Implantar** (se pedir autorização de novo, autorize como no passo 3).
5. Copie a **URL do app da Web**. Ela termina em `/exec`, algo como:

   ```
   https://script.google.com/macros/s/AKfycb.../exec
   ```

6. **Teste:** cole a URL no navegador. Deve aparecer `{"ok":true,"servico":"DISC"}`.

> "Qualquer pessoa" é necessário para que candidatos sem conta Google consigam enviar o teste. Isso **não** expõe a planilha: quem não tem a chave de administrador só consegue **enviar** um teste, nunca ler, alterar ou apagar respostas.

## 5. Ligar o site ao servidor

1. Abra o arquivo `js/config.js` do projeto.
2. Cole a URL entre as aspas de `API_URL`:

   ```js
   API_URL: 'https://script.google.com/macros/s/AKfycb.../exec',
   ```

3. (Opcional) Preencha também `WHATSAPP_RECRUTADOR` (ex.: `'5511999998888'`) e `EMPRESA`.
4. Salve e publique o site (veja a seção 8).
5. Faça um teste você mesmo pelo `index.html`. Em seguida abra `admin.html`, entre com a chave e confira se a resposta aparece (ela também aparece como nova linha na aba **Respostas**).

## 6. Atualizar o servidor (quando o `Code.gs` mudar)

> **Sempre que atualizar o `Code.gs`, reimplante o App da Web como "Nova versão"** (passos abaixo). Só salvar o código **não basta**: a URL `/exec` continua rodando a versão antiga até você publicar a nova. Exemplo: o **código do candidato** (seção 6.1) só começa a aparecer depois dessa reimplantação.

Se você receber uma versão nova do `Code.gs`:

1. Em **Extensões > Apps Script**, substitua todo o conteúdo pelo novo e salve.
2. Clique em **Implantar > Gerenciar implantações**.
3. Clique no lápis (**Editar**) da implantação existente.
4. Em **Versão**, escolha **Nova versão** e clique em **Implantar**.

Assim a **URL continua a mesma** e não é preciso mexer no `js/config.js`.

> Atenção: se você usar **Nova implantação** em vez de editar a existente, o Google gera uma **URL nova**, e aí é preciso atualizar o `API_URL` no `js/config.js`.

### 6.1 O código do candidato (ex.: `47K`)

Quando o candidato envia o teste, o servidor cria um **código curto e único** para ele: **2 números + 1 letra**, por exemplo **47K**. Esse código aparece grande na tela final do candidato, que pode passá-lo a você (por exemplo, pelo WhatsApp: "Fiz o teste, meu código é 47K").

- No painel, digite o código na **busca** da lista de candidatos para achar a pessoa na hora. Pode digitar em minúscula ou com espaço (`47 k` também encontra).
- O código aparece em cada cartão da lista, no detalhe do candidato ("Código 47K") e na coluna **protocolo** do CSV e da planilha.
- As letras **I** e **O** nunca são usadas (para não confundir com 1 e 0). São 2.400 códigos possíveis, sem repetição na mesma planilha. Se um dia todos estiverem em uso, o candidato vê "Limite de códigos atingido": exclua candidatos antigos ou de teste.
- Se o candidato tocar em Enviar duas vezes, o servidor reconhece o mesmo envio e devolve **o mesmo código**.
- **Planilha de antes desta versão:** não precisa fazer nada. Depois de reimplantar (seção 6), as colunas novas (**protocolo**, **idade**, **funcao**, **empresa**) são criadas sozinhas no fim do cabeçalho da aba **Respostas**. Quem respondeu antes fica sem esses dados (o painel mostra "—").
- **Sem servidor ou se o envio falhar**, não há código curto: o candidato vê um **Código de segurança** longo com o aviso "Não conseguimos enviar suas respostas. Envie este código ao recrutador pelo WhatsApp." Cole esse código na aba **Importar códigos** do painel (seção "Problemas comuns"). Candidatos importados assim no modo sem servidor aparecem sem código curto ("—").

### 6.2 Prévia sem servidor (demonstração)

Para mostrar o sistema sem criar planilha, coloque `API_URL: 'simulada'` no `js/config.js`. O site passa a usar uma planilha **de mentira**, guardada só no navegador (dados de demonstração), com as mesmas regras do servidor de verdade — inclusive o código do candidato. A chave do painel nesse modo é **`previa`**. Não use em processo seletivo real: os dados não saem do navegador de quem fez o teste.

## 7. Apagar os dados ao fim do processo seletivo (LGPD)

Os candidatos autorizaram o uso dos dados **apenas neste processo seletivo**. Ao terminar, os dados precisam ser eliminados de verdade.

> **Importante:** o botão **Excluir todos** do painel e a função **apagarTodosOsDados** só limpam as linhas da aba. O Google Planilhas guarda o **Histórico de versões** (Arquivo > Histórico de versões), e qualquer pessoa com acesso de edição consegue ver ou restaurar as linhas apagadas, com nome, telefone e respostas. Por isso, essas duas opções **não bastam** para cumprir a LGPD.

**Como excluir de verdade (faça ao fim de cada processo):**

1. Se quiser, exporte antes o que precisa guardar dos **aprovados** (por exemplo, o Guia para a Liderança em PDF), sem dados de quem não foi contratado.
2. No Google Drive, **exclua o arquivo da planilha** (botão direito > Mover para a lixeira).
3. Abra a **Lixeira** do Drive e **exclua o arquivo para sempre** (ou clique em **Esvaziar lixeira**).
4. O endereço do servidor deixa de funcionar junto com a planilha, porque o script fica dentro dela.

**Para o próximo processo seletivo:** crie uma planilha nova e repita as seções 1 a 5 (colar o `Code.gs`, rodar `setup`, publicar e colar a nova URL em `js/config.js`).

Uso das outras opções:

- **Excluir todos** (painel) e **apagarTodosOsDados** (editor do Apps Script) servem para limpar a lista no dia a dia, por exemplo para remover testes feitos por você antes de divulgar o link. Elas **não** apagam o histórico de versões.
- **Excluir** um candidato no painel tem a mesma limitação: some da aba, mas continua no histórico até a planilha ser excluída.

> Lembre-se de apagar também cópias exportadas (CSV, PDFs dos guias de liderança) e os códigos de resultado recebidos pelo WhatsApp que você tenha salvo no computador ou no celular.

## 8. Publicar o site no GitHub Pages (grátis)

1. Crie uma conta em <https://github.com> (se ainda não tiver).
2. Clique em **New repository**, dê um nome (ex.: `teste-disc`), deixe **Public** e clique em **Create repository**.
3. Na página do repositório, clique em **uploading an existing file** e arraste **todos** os arquivos e pastas do projeto (`index.html`, `admin.html`, `assets/`, `js/` etc.). Clique em **Commit changes**.
   - A pasta `apps-script/` e a pasta `docs/` não são necessárias no site, mas não atrapalham. Nada nelas é secreto: a chave de administrador fica **só** no Google, nunca nos arquivos.
4. Vá em **Settings > Pages**. Em **Source**, escolha **Deploy from a branch**, branch **main**, pasta **/ (root)** e clique em **Save**.
5. Depois de 1 ou 2 minutos aparece o endereço do site, algo como `https://seu-usuario.github.io/teste-disc/`.
   - Link para os candidatos: `https://seu-usuario.github.io/teste-disc/`
   - Painel do recrutador: `https://seu-usuario.github.io/teste-disc/admin.html`
6. Para alterar algo (por exemplo o `js/config.js`), abra o arquivo no GitHub, clique no lápis, edite e clique em **Commit changes**. O site atualiza em 1 ou 2 minutos.

## Problemas comuns

| Sintoma | O que fazer |
|---|---|
| Ao abrir a URL `/exec` aparece página de login do Google | Em **Quem pode acessar** não ficou **Qualquer pessoa**. Edite a implantação (seção 6) e corrija. |
| Painel diz "A chave de administrador ainda não foi configurada" | Rode a função **setup** no editor (seção 3). |
| Painel diz "Chave de administrador inválida" | Confira se copiou a chave inteira, sem espaços. Rode **setup** para vê-la de novo. |
| Mudei o `Code.gs` e nada mudou | Faltou publicar **Nova versão** na implantação existente (seção 6). |
| O candidato não recebeu o código curto (ex.: `47K`) | O servidor ainda está na versão antiga: reimplante como **Nova versão** (seção 6). |
| Candidato vê "Limite de códigos atingido" | Os 2.400 códigos estão em uso na planilha. Exclua candidatos antigos ou de teste. |
| Candidato diz que deu erro ao enviar | Peça para ele enviar o **Código de segurança** (o código longo exibido na tela, ou pelo botão do WhatsApp) e importe no painel, na aba **Importar códigos**. Com o servidor ligado, o código vai para a planilha como se o candidato tivesse enviado e ganha um código curto na hora. |
| Candidato vê "Muitos envios em pouco tempo" | Muitas pessoas enviaram ao mesmo tempo (limite de 40 a cada 10 minutos). Peça para tentar de novo após alguns minutos ou usar o código de resultado. |
| Candidato vê "Limite de respostas atingido" | A planilha chegou a 500 linhas. Exclua os registros antigos ou de teste. Se precisar de mais, aumente `LIMITE_LINHAS` no `Code.gs` e publique nova versão (seção 6). |
| Envio repetido do mesmo candidato | Não há problema: o servidor reconhece o mesmo envio e não duplica a linha. |

## Referência técnica (para quem for mexer no código)

- Aba `Respostas`, colunas: `id, recebidoEm, nome, telefone, vaga, inicio, fim, duracaoSeg, respostas, D, I, S, C, perfil, status, observacoes, payloadJson, protocolo, idade, funcao, empresa`. Em planilhas antigas as colunas que faltam (`protocolo`, `idade`, `funcao`, `empresa`) são acrescentadas automaticamente no fim, no primeiro acesso; as linhas antigas ficam com essas células vazias (o painel mostra "—").
- `enviar` exige `idade` (inteiro de 14 a 99); sem ela responde `{ok:false, erro:'Idade não informada: …'}`. `funcao` e `empresa` são opcionais (aparadas, até 80 caracteres, protegidas contra fórmula).
- Protocolo: `/^[0-9]{2}[A-HJ-NP-Z]$/` (2 algarismos + 1 letra maiúscula sem I/O; 2.400 combinações). Gerado na ação `enviar`, dentro do `LockService`: sorteia e confere contra a coluna `protocolo` até achar um livre (com a planilha quase cheia, sorteia entre os livres; sem nenhum, responde `{ok:false, erro:'Limite de códigos atingido…'}`). Resposta: `{ok:true, id, protocolo}`; id repetido: `{ok:true, duplicado:true, id, protocolo}` com o mesmo protocolo já gravado (linha antiga sem protocolo ganha um nesse momento). `listar` devolve `protocolo` em cada item (`''` quando não há). O payload do candidato não muda.
- `API_URL: 'simulada'` (prévia): `js/api-simulada.js` troca o `DISC_API` por um backend falso em `localStorage` (`disc_planilha_simulada`) com as mesmas regras e mensagens deste arquivo, chave admin `previa` e latência de ~400 ms.
- `doGet` → `{ok:true, servico:'DISC'}`. `doPost` recebe `text/plain` com JSON `{acao, ...}`; ações `enviar` (pública), `listar`, `atualizar`, `excluir`, `excluirTodos` (exigem `chave` = Script Property `ADMIN_KEY`).
- O servidor **recalcula** D/I/S/C e o perfil a partir de `respostas` (100 dígitos, cada bloco de 4 é uma permutação de 1..4; percentual = total / 2,5). O campo `resultado` enviado pelo navegador é ignorado.
- Proteções: corpo limitado a 20 KB; textos aparados e com tamanho máximo; telefone só com dígitos e prefixo `55`; valores que começam com `= + - @` recebem apóstrofo (evita fórmulas maliciosas na planilha); escrita com `LockService`; `id` repetido responde `{ok:true, duplicado:true}` sem gravar de novo; limite de 500 linhas; no máximo 40 envios a cada 10 minutos (todos os candidatos juntos, via `CacheService`) para impedir que alguém encha a planilha com envios falsos.
- Funções para rodar no editor: `setup()`, `gerarNovaChave()`, `apagarTodosOsDados()`.
- Depois de qualquer mudança no `Code.gs`: **Implantar > Gerenciar implantações > Editar > Versão: Nova versão > Implantar** (mantém a URL).
