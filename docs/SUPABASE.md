# Como configurar o servidor no Supabase (passo a passo)

Este guia troca o servidor antigo (Google Planilha + Apps Script) pelo **Supabase**: um banco de dados de verdade, com login, e-mail de "Esqueci minha senha" e as funções que conversam com o ClickUp. O site continua o mesmo (GitHub Pages, `https://disc.gestaosemcaos.com.br`), e o ClickUp continua sendo de onde vêm os candidatos.

**Tempo:** cerca de 1 hora, sem pressa. **Custo:** o plano grátis do Supabase atende (com o "despertador" do passo 12).

> **Como ler os "prints descritos".** O painel do Supabase muda de vez em quando. Em cada passo está escrito **onde fica o botão** e **o que aparece na tela**. Se um nome estiver um pouco diferente (ex.: "Verify JWT" virou "Enforce JWT Verification"), procure o mais parecido no mesmo lugar.

**O que você vai precisar ter à mão**

- Um e-mail e senha para entrar no Supabase (ou a conta do GitHub).
- Acesso ao repositório do site no GitHub.
- O **token do ClickUp** (começa com `pk_`; veja a seção 5 de [CLICKUP.md](CLICKUP.md)).
- Opcional: a chave da Anthropic (para o botão "Melhorar textos com IA").
- Um bloco de notas para guardar o que for copiando (marcado com 📋 ao longo do guia).

**Ordem (não pule):**

| # | Passo | Onde |
|---|---|---|
| 1 | Criar o projeto | supabase.com |
| 2 | Copiar o endereço e a chave pública | Project Settings |
| 3 | Criar o banco (colar o SQL) | SQL Editor |
| 4 | Fechar o cadastro livre | Authentication > Sign In / Providers |
| 5 | Endereços do site | Authentication > URL Configuration |
| 6 | E-mails (convite e "Esqueci minha senha") | Authentication > Emails |
| 7 | Criar o seu usuário | Authentication > Users |
| 8 | Criar as 3 funções | Edge Functions |
| 9 | Guardar os segredos | Edge Functions > Secrets |
| 10 | Trazer o histórico da planilha (opcional) | SQL Editor |
| 11 | Ligar o site ao Supabase e entrar no painel | GitHub (`js/config.js`) |
| 12 | Despertador (para o projeto não "dormir") | GitHub > Settings > Secrets |
| 13 | Webhook do ClickUp ("gerar relatório") | ClickUp (comando pronto) |
| 14 | Testar tudo e desligar o servidor antigo | Site + Apps Script |

---

## 1. Criar o projeto

1. Entre em <https://supabase.com> e clique em **Start your project** (ou **Sign in**). Pode entrar com a conta do GitHub.
2. Na primeira vez ele pede uma **Organization** (organização): dê um nome (ex.: `Notus`), tipo **Personal**, plano **Free** → **Create organization**.
3. Clique em **New project**. Aparece um formulário:
   - **Project name:** `teste-disc`.
   - **Database Password:** clique em **Generate a password** e depois em **Copy**. 📋 Guarde essa senha (é a senha do banco; o site não usa, mas o suporte pode pedir).
   - **Region:** escolha **South America (São Paulo)**. Os dados ficam no Brasil e o site responde mais rápido.
   - Se aparecer **Security options / Data API**, deixe como está (**Data API** ligado, schema `public`).
4. Clique em **Create new project**. Aparece "Setting up project…". Espere 1 a 2 minutos até a tela inicial do projeto (com "Project Status" ou "Welcome to your new project").

## 2. Copiar o endereço do projeto e a chave pública

São **dois valores públicos**: podem ficar no site sem problema, porque o banco só deixa fazer o que as regras permitem.

1. No menu da esquerda, lá embaixo, clique na engrenagem **Project Settings**.
2. Clique em **Data API**. No topo aparece **Project URL**, algo como `https://abcdefghijkl.supabase.co`. Clique no ícone de copiar. 📋 Guarde como **Project URL**.
   - O pedaço `abcdefghijkl` é o **ID do projeto** (aparece também como *Project ref* / *Reference ID*). Ele aparece nos endereços das funções.
   - Nessa mesma página, em **Exposed schemas**, deve estar só `public` (e talvez `graphql_public`). **Não** adicione `disc_interno`.
3. Ainda em Project Settings, clique em **API Keys**. Há duas abas:
   - **Legacy API Keys** (chaves antigas): copie a chave **`anon` `public`** (um texto longo que começa com `eyJ`). 📋 Guarde como **anon key**. **Use esta, se existir** — é a que funciona com todas as opções padrão do guia.
   - **Publishable and secret API keys**: se a aba Legacy não existir no seu projeto, copie a **Publishable key** (começa com `sb_publishable_`). Nesse caso, no passo 8 desligue o "Verify JWT" também da função `disc-sync` (está explicado lá).
4. ⚠️ **Nunca** copie para o site, para o GitHub ou para conversas a chave **`service_role`** nem a **Secret key** (`sb_secret_…`). Elas abrem o banco inteiro. As funções do Supabase já recebem essa chave sozinhas; você não precisa dela em lugar nenhum.

## 3. Criar o banco (colar o SQL)

1. Abra o arquivo [`supabase/migrations/20261005120000_disc.sql`](../supabase/migrations/20261005120000_disc.sql) no GitHub e clique no botão **Copy raw file** (ícone de duas folhinhas, no canto direito acima do código).
2. No Supabase, menu da esquerda → **SQL Editor** (ícone de terminal `>_`).
3. Clique em **+** (ou **New query** / **Create a new snippet**). Abre uma área de texto em branco.
4. Cole tudo (Ctrl+V) e clique em **Run** (canto inferior direito; ou Ctrl+Enter).
5. Se aparecer o aviso **"Potential issue detected — Query has destructive operations"**, é normal: o arquivo recria gatilhos e regras (não apaga dados). Clique em **Run this query**.
6. Embaixo, em **Results**, deve aparecer **"Success. No rows returned"**.

7. Repita os passos 1 a 6 com o arquivo [`supabase/migrations/20261006120000_pessoas_formulario.sql`](../supabase/migrations/20261006120000_pessoas_formulario.sql) (formulário por processo e fichas de pessoas) e depois com [`supabase/migrations/20261007120000_empresas_equipes.sql`](../supabase/migrations/20261007120000_empresas_equipes.sql) (empresas, colaboradores, organograma e relatórios de equipe/liderança/pessoa). Sempre **nessa ordem**: `…_disc.sql`, `…_pessoas_formulario.sql`, `…_empresas_equipes.sql`.

Para conferir: menu **Table Editor** → devem existir as tabelas `admins`, `processos`, `pessoas`, `respostas`, `relatorios`, `configuracoes`, `empresas`, `vinculos` e `relacoes`, todas sem o selo vermelho **"RLS disabled"** / **"Unrestricted"**.

> **Pode rodar de novo?** Sim. Cada arquivo só cria o que falta e atualiza as funções, **sem apagar** respostas nem processos. Se rodar um arquivo mais antigo de novo, rode os mais novos logo depois, na ordem (os antigos voltam algumas funções para a versão anterior).

> **Migrações novas são automáticas.** Com a integração do GitHub do Supabase ligada, cada arquivo novo em `supabase/migrations/` é aplicado sozinho no push para a branch de produção (foi assim com `20261006120000_pessoas_formulario.sql`: ela cria `pessoas`, liga as respostas que já existem à pessoa do mesmo WhatsApp e não apaga nada). Se a integração estiver desligada ou falhar, rode à mão: abra o arquivo, **Copy raw file**, cole no **SQL Editor** e **Run** (como nos passos acima).

## 4. Fechar o cadastro livre

Sem isso, qualquer pessoa poderia criar uma conta (ela não veria nada, mas não há motivo para deixar aberto).

1. Menu **Authentication** (ícone de pessoas) → no submenu, **Sign In / Providers** (em versões antigas: **Providers** ou **Settings**).
2. Na seção **User Signups**, **desligue** **Allow new users to sign up**.
3. Deixe **ligado** o provedor **Email** (na lista **Auth Providers**). Se quiser, dentro dele mantenha **Confirm email** ligado.
4. Clique em **Save changes**.

Convites feitos pelo painel continuam funcionando com o cadastro fechado.

## 5. Endereços do site (para os links dos e-mails)

1. **Authentication** → **URL Configuration**.
2. **Site URL:** apague o que estiver (`http://localhost:3000`) e escreva `https://disc.gestaosemcaos.com.br` → **Save changes**.
3. **Redirect URLs** → **Add URL** → escreva `https://disc.gestaosemcaos.com.br/admin.html` → **Save URLs**.
   - Opcional, para testar no computador: adicione também `http://localhost:4173/admin.html`.

## 6. E-mails (convite e "Esqueci minha senha")

O Supabase manda e-mails sozinho, **mas o servidor de e-mail grátis dele só entrega para os e-mails dos membros da sua organização no Supabase** e só poucos por hora. Para o "Esqueci minha senha" funcionar para você, isso basta. Para **convidar outras pessoas** para o painel, configure um servidor de e-mail próprio (SMTP):

1. **Authentication** → **Emails** → aba **SMTP Settings** → ligue **Enable Custom SMTP**.
2. Preencha com os dados do seu provedor de e-mail (ex.: Gmail com "senha de app", Brevo, Resend, Zoho):
   - **Sender email** (ex.: `nao-responda@gestaosemcaos.com.br`) e **Sender name** (ex.: `Notus · Teste DISC`);
   - **Host**, **Port**, **Username**, **Password** (o provedor informa).
3. **Save changes**.
4. Opcional: na aba **Templates**, traduza os textos de **Invite user** e **Reset Password** (ex.: assunto "Seu acesso ao painel DISC"). Mantenha o trecho `{{ .ConfirmationURL }}`, que é o link.

> Sem SMTP próprio, você ainda pode dar acesso a alguém: crie o usuário à mão (como no passo 7, com **Auto Confirm User**), mande a senha por um canal seguro e depois, **no painel**, aba **Usuários** → **Convidar administrador** com o **mesmo e-mail** (como o usuário já existe, o painel só libera o acesso, sem mandar e-mail). Sem esse último passo a pessoa entra e vê "Este e-mail ainda não tem acesso ao painel". No primeiro acesso ela troca a senha pelo menu do painel.

## 7. Criar o seu usuário (você vira administrador no primeiro login)

1. **Authentication** → **Users** → botão **Add user** (canto superior direito) → **Create new user**.
2. **Email address:** o seu e-mail. **User Password:** uma senha forte (pelo menos 8 caracteres). 📋 Guarde.
3. Marque **Auto Confirm User?** e clique em **Create user**.

Não existe mais "chave de primeiro acesso": **o primeiro usuário que entrar no painel vira administrador automaticamente** (o painel mostra uma mensagem avisando). Depois disso, só um administrador dá acesso a outra pessoa (aba **Usuários** do painel → **Convidar**).

> Faça o primeiro login **você mesmo**, logo depois do passo 11, antes de criar qualquer outro usuário.

## 8. Criar as 3 funções (Edge Functions)

O sistema tem três funções. Cada uma é **um arquivo só**, já pronto, na pasta [`dist/funcoes/`](../dist/funcoes) do repositório:

| Nome da função (exatamente assim) | Arquivo para colar | Para que serve | Verify JWT |
|---|---|---|---|
| `admin` | `dist/funcoes/admin/index.ts` | Painel: ClickUp, relatórios, IA e usuários (só administradores) | **Ligado** |
| `disc-sync` | `dist/funcoes/disc-sync/index.ts` | Leva o resultado do candidato para a tarefa dele no ClickUp | **Ligado** (desligue só se usou a Publishable key no passo 2) |
| `clickup-webhook` | `dist/funcoes/clickup-webhook/index.ts` | Recebe o aviso do ClickUp quando o briefing vai para "gerar relatório" | **Desligado** |

Para **cada** linha da tabela:

1. No GitHub, abra o arquivo da coluna "Arquivo para colar" e clique em **Copy raw file**.
2. No Supabase, menu **Edge Functions** (ícone de raio/chaves `{}`) → botão **Deploy a new function** → **Via Editor**.
3. Abre um editor com um código de exemplo (`Deno.serve…`). Clique dentro, selecione tudo (Ctrl+A), apague e cole o arquivo (Ctrl+V).
4. Embaixo, no campo **Function name**, apague o nome sugerido (ex.: `hello-world`) e escreva o nome da primeira coluna (`admin`, `disc-sync` ou `clickup-webhook`).
5. Clique em **Deploy function**. Espere a mensagem de sucesso (10 a 30 segundos). A tela muda para a página da função, com o endereço `https://<ID do projeto>.supabase.co/functions/v1/<nome>`.
6. Ajuste o **Verify JWT** conforme a última coluna: na página da função, aba **Details** → seção **Function Configuration** → chave **Verify JWT with legacy secret** / **Enforce JWT Verification** → **Save changes**.
   - `clickup-webhook` **precisa** ficar **desligado**: quem chama é o ClickUp, que não tem login. A segurança dela é a assinatura do ClickUp (segredo `CLICKUP_WEBHOOK_SECRET`, passo 9).
   - `admin` confere sozinha se quem chamou é administrador; mesmo se você desligar o Verify JWT dela, ninguém de fora consegue usar.
   - `disc-sync` só responde `{ok}` e nunca devolve dados; desligar é seguro, se precisar.

> **Atualizar uma função depois:** quando um desses arquivos mudar no repositório, abra **Edge Functions** → clique na função → aba **Code** → apague tudo, cole o arquivo novo → **Deploy updates**. Confira que o Verify JWT continua como na tabela.

## 9. Guardar os segredos (Secrets)

Segredos são senhas que **só as funções** enxergam; nunca vão para o site.

1. **Edge Functions** → no submenu, **Secrets**.
2. Em **Add or replace secrets**, preencha **Name** e **Value**. Use **Add another** para mais de um e, no fim, **Save**.

| Name | Value | Obrigatório? |
|---|---|---|
| `SITE_URL` | `https://disc.gestaosemcaos.com.br` (sem barra no fim) | Sim — usado no link do convite, no link do relatório comentado no ClickUp e para liberar o site a chamar as funções |
| `CLICKUP_TOKEN` | o token do ClickUp (`pk_…`) | Sim, para usar o ClickUp |
| `CLICKUP_PASTA_ID` | ID da pasta de recrutamento no ClickUp (o número no endereço da pasta) | Opcional — sem ele, o painel lista todas as listas do workspace |
| `ANTHROPIC_API_KEY` | a chave da Anthropic (`sk-ant-…`) | Opcional — sem ela, o botão "Melhorar textos com IA" não aparece |
| `CLICKUP_WEBHOOK_SECRET` | o `secret` devolvido pelo ClickUp no passo 13 | Só depois do passo 13 |

- **Não** crie `SUPABASE_URL`, `SUPABASE_ANON_KEY` nem `SUPABASE_SERVICE_ROLE_KEY`: o Supabase já fornece esses sozinho (eles aparecem na lista com um cadeado).
- Trocou um segredo? Não precisa reimplantar: vale na próxima chamada.

## 10. Trazer o histórico da planilha (opcional)

Faça este passo **antes** do passo 11 se quiser manter no painel os candidatos antigos e **os mesmos links/códigos de processo** (assim os links já enviados continuam funcionando).

1. Na planilha do Google, abra a aba **Avaliacoes** → **Arquivo** → **Fazer download** → **Valores separados por vírgula (.csv)**. Salve como `Avaliacoes.csv`.
2. Faça o mesmo com a aba **Respostas** → `Respostas.csv`.
3. Num computador com o [Node.js](https://nodejs.org) instalado, dentro da pasta do repositório:

   ```bash
   node scripts/migrar-planilha.mjs Respostas.csv --processos Avaliacoes.csv --saida importar.sql
   ```

   Ele mostra quantos processos e respostas converteu e um **Aviso** para cada linha que pulou (ex.: respostas incompletas, data inválida). Os D/I/S/C e o perfil são recalculados como o servidor faz.
   - Não tem Node? Peça ao Claude: envie os dois CSVs e peça "gere o importar.sql com scripts/migrar-planilha.mjs".
4. **SQL Editor** → **+** → cole o conteúdo de `importar.sql` → **Run**. Deve aparecer "Success".
5. Confira em **Table Editor** → `respostas` e `processos`.

Observações:
- Pode rodar o mesmo arquivo de novo: o que já existe é pulado.
- O banco aceita até 2.000 respostas no total (proteção contra abuso) e existem 2.400 códigos de candidato (ex.: `47K`); o histórico conta nos dois limites. Se a planilha tiver muitos candidatos antigos, apague antes os de processos encerrados.
- Os **relatórios** já publicados na planilha **não** são migrados: gere de novo pelo painel, se precisar.
- Os logins antigos (aba Usuarios) não são migrados: cada pessoa é convidada de novo pelo painel.
- Depois de importar, **apague os CSVs e o `importar.sql`** do computador (têm dados pessoais).

## 11. Ligar o site ao Supabase e entrar no painel

O site só passa a usar o Supabase quando o arquivo `js/config.js` mudar. O mais simples é **mandar para o Claude** a 📋 Project URL e a 📋 anon key (as duas são públicas) e pedir: "ligue o site ao Supabase". Ele publica uma prévia e só faz o push depois da sua aprovação.

Se preferir fazer você mesmo, no GitHub: abra `js/config.js` → ícone de lápis (**Edit this file**) → troque estas três linhas:

```js
    BACKEND: 'supabase',
    SUPABASE_URL: 'https://abcdefghijkl.supabase.co',
    SUPABASE_ANON_KEY: 'eyJhbGciOi...a chave anon inteira...',
```

→ **Commit changes…** → **Commit changes**. O GitHub Pages atualiza o site em 1 a 2 minutos.

Depois:

1. Abra `https://disc.gestaosemcaos.com.br/admin.html` (se a página antiga aparecer, recarregue com Ctrl+F5).
2. Entre com o e-mail e a senha do passo 7. Na primeira vez aparece o aviso de que você virou **administrador**.
3. Aba **Processos**: confira os processos (importados no passo 10) ou crie os novos. Ao ligar um processo a uma lista do ClickUp, a lista aparece num seletor (se o `CLICKUP_TOKEN` estiver certo).
4. Aba **Usuários**: **Convidar** manda um e-mail para a pessoa criar a própria senha (precisa do SMTP do passo 6). **Remover** tira o acesso. Ninguém redefine a senha de outra pessoa: cada um usa **Esqueci minha senha** na tela de entrada.

> **Voltar atrás:** se algo der muito errado, troque `BACKEND` de volta para `'appsscript'` no `js/config.js`. O servidor antigo continua no repositório (pasta `apps-script/`) até você desligá-lo no passo 14.

## 12. Despertador (para o projeto grátis não "dormir")

No plano grátis, o Supabase **pausa** o projeto depois de 7 dias sem nenhum acesso (o site para de gravar até alguém reativar). O repositório já tem um robô do GitHub ([`.github/workflows/manter-ativo.yml`](../.github/workflows/manter-ativo.yml)) que faz uma consulta inofensiva a cada 3 dias. Ele só precisa de dois segredos:

1. No GitHub, abra o repositório → **Settings** → no menu da esquerda, **Secrets and variables** → **Actions**.
2. Clique em **New repository secret**:
   - **Name:** `SUPABASE_URL` · **Secret:** a 📋 Project URL → **Add secret**.
3. De novo **New repository secret**:
   - **Name:** `SUPABASE_ANON_KEY` · **Secret:** a 📋 anon key (ou a Publishable key) → **Add secret**.
4. Teste na hora: aba **Actions** → à esquerda, **Manter Supabase ativo** → **Run workflow** → **Run workflow**. Em 1 minuto aparece um ✅ verde. Clique nele para ver "Supabase respondeu (o projeto está ativo)".

- Sem esses dois segredos o robô não faz nada (fica verde com o aviso "despertador desligado").
- O GitHub desliga robôs agendados de repositórios sem nenhuma alteração há 60 dias e manda um e-mail avisando. Se receber, vá em **Actions** → **Manter Supabase ativo** → **Enable workflow**.
- Se o projeto for pausado mesmo assim: no Supabase, abra o projeto e clique em **Restore project** (leva alguns minutos; os dados não se perdem).

## 13. Webhook do ClickUp ("gerar relatório" no ClickUp)

Isto faz o ClickUp **avisar o Supabase** quando a tarefa **📌 Briefing…** de um processo for para o status **gerar relatório**. O sistema então gera o rascunho, comenta "Rascunho pronto para revisão no painel" e muda o status para **relatório em revisão** (se esse status existir na lista). Antes isso era o gatilho de 10 minutos do Apps Script; agora é na hora.

O ClickUp **não tem tela** para esse tipo de webhook (o "Call webhook" das Automações não assina a mensagem); ele é criado com **um comando**. Você precisa de:

- **TOKEN**: o token `pk_…` do ClickUp.
- **WORKSPACE**: o número do seu workspace. Abra o ClickUp no navegador: o endereço é `https://app.clickup.com/9012345678/home` → o número depois de `app.clickup.com/` é o workspace.
- **ENDERECO**: `https://<ID do projeto>.supabase.co/functions/v1/clickup-webhook` (o ID do projeto é o pedaço da Project URL).

**No Windows** (menu Iniciar → digite `PowerShell` → abra), cole trocando os três valores:

```powershell
$TOKEN = "pk_COLE_AQUI"
$WORKSPACE = "9012345678"
$ENDERECO = "https://abcdefghijkl.supabase.co/functions/v1/clickup-webhook"
$corpo = @{ endpoint = $ENDERECO; events = @("taskStatusUpdated") } | ConvertTo-Json
$r = Invoke-RestMethod -Method Post -Uri "https://api.clickup.com/api/v2/team/$WORKSPACE/webhook" -Headers @{ Authorization = $TOKEN } -ContentType "application/json" -Body $corpo
"ID do webhook: " + $r.id
"SECRET (copie): " + $r.webhook.secret
```

**No Mac ou Linux** (Terminal):

```bash
TOKEN="pk_COLE_AQUI"
WORKSPACE="9012345678"
ENDERECO="https://abcdefghijkl.supabase.co/functions/v1/clickup-webhook"
curl -sS -X POST "https://api.clickup.com/api/v2/team/$WORKSPACE/webhook" \
  -H "Authorization: $TOKEN" -H "Content-Type: application/json" \
  -d "{\"endpoint\":\"$ENDERECO\",\"events\":[\"taskStatusUpdated\"]}"
```

A resposta tem `"id": "…"` e, dentro de `"webhook"`, um `"secret": "…"`. 📋 Copie o **secret** e guarde também o **id** (serve para apagar o webhook depois).

Por fim, no Supabase: **Edge Functions** → **Secrets** → **Name** `CLICKUP_WEBHOOK_SECRET`, **Value** = o secret → **Save**.

⚠️ **Desligue o gatilho antigo do Apps Script agora** (se ele existir): na planilha → **Extensões** → **Apps Script** → **Acionadores** (ícone de relógio) → apague o acionador criado por `instalarGatilho`. Senão os dois servidores reagem ao mesmo "gerar relatório" e o ClickUp recebe comentário em dobro.

Para testar: num processo ligado a uma lista do ClickUp, mude a tarefa **📌 Briefing…** para **gerar relatório**. Em menos de 1 minuto deve aparecer o comentário no ClickUp e o rascunho no painel (página do processo).

Comandos úteis (troque os valores; no Windows use `Invoke-RestMethod -Method Get/Delete/Put` com o mesmo cabeçalho):

```bash
# ver os webhooks e a "saúde" de cada um (health: active / failing / suspended)
curl -sS "https://api.clickup.com/api/v2/team/$WORKSPACE/webhook" -H "Authorization: $TOKEN"
# reativar um webhook suspenso
curl -sS -X PUT "https://api.clickup.com/api/v2/webhook/ID_DO_WEBHOOK" -H "Authorization: $TOKEN" \
  -H "Content-Type: application/json" -d '{"status":"active"}'
# apagar um webhook
curl -sS -X DELETE "https://api.clickup.com/api/v2/webhook/ID_DO_WEBHOOK" -H "Authorization: $TOKEN"
```

> Mesmo sem o webhook, tudo funciona: o rascunho também é gerado no painel, pelo botão **Gerar rascunho do relatório** na página do processo.

## 14. Testar tudo e desligar o servidor antigo

**Teste rápido (10 minutos):**

1. **Candidato:** no painel, aba **Processos**, copie o link de um processo e abra numa janela anônima do celular. Faça o teste com dados de teste (ex.: "Teste Notus", seu WhatsApp). No fim aparece o código (ex.: `47K`).
2. **Painel:** recarregue a aba **Participantes**: o teste aparece com o mesmo código.
3. **ClickUp:** se o processo está ligado a uma lista, em até 1 minuto a tarefa do candidato (achada pelo WhatsApp) recebe os campos do DISC; se não achar, aparece uma tarefa nova "Teste Notus (DISC)" com a etiqueta **sem formulário**.
4. **Relatório:** gere um rascunho, **Publicar**, abra o link e depois **Despublicar**.
5. **Senha:** saia do painel, clique em **Esqueci minha senha**, siga o e-mail e defina uma senha nova.
6. Apague o participante de teste (detalhe → **Excluir**) e a tarefa de teste no ClickUp.

**Desligar o servidor antigo** (depois de uns dias com tudo certo):

1. Confira que o acionador do Apps Script já foi apagado (passo 13): na planilha → **Extensões** → **Apps Script** → menu **Acionadores** (ícone de relógio) → não deve sobrar o da função de relatório (criado por `instalarGatilho`).
2. **Implantar** → **Gerenciar implantações** → **Arquivar** a implantação do App da Web.
3. Guarde a planilha por um tempo como cópia e depois apague os dados pessoais (veja "LGPD" abaixo).

---

## Se algo der errado

| O que aparece | Causa provável | O que fazer |
|---|---|---|
| SQL Editor: `ERROR: relation "auth.users" does not exist` | O SQL foi rodado fora do Supabase | Cole no SQL Editor do projeto Supabase (passo 3). |
| SQL Editor: `ERROR: ... already exists` ou `permission denied` | Rodou só um pedaço do arquivo ou um arquivo antigo | Copie o arquivo **inteiro** de novo pelo **Copy raw file** e rode. Ele pode ser rodado várias vezes. Se continuar, copie a mensagem e mande para o Claude. |
| Site do candidato: "Link inválido ou avaliação encerrada" | Código do processo errado ou processo desativado | No painel, aba Processos, confira se o processo está **Ativo** e copie o link de novo. |
| Site do candidato: "Este link de avaliação não está mais ativo." | O processo foi desativado ou apagado | Reative o processo no painel. |
| Site: "Não foi possível conectar ao servidor" | Project URL ou anon key errados no `js/config.js`, ou projeto pausado | Confira os dois valores (passo 2 e 11). No Supabase, veja se o projeto está **Paused** → **Restore project**. |
| Painel: "E-mail ou senha incorretos." | Senha errada ou usuário não confirmado | Use **Esqueci minha senha**, ou em Authentication > Users confira se o usuário existe (crie de novo marcando **Auto Confirm User**). |
| Painel: "Este e-mail ainda não tem acesso ao painel…" (ou "Sem permissão.") logo depois de entrar | Já existe outro administrador e você não é um deles | Peça a um administrador para convidar você. Se você é o dono e ninguém mais tem acesso: SQL Editor → `insert into public.admins (user_id, nome) select id, 'Dono' from auth.users where email = 'seu@email.com' on conflict do nothing;` → Run. |
| Painel: "Sessão expirada. Entre de novo." toda hora | Relógio do computador errado, ou o navegador bloqueia armazenamento | Acerte data/hora do computador; não use janela anônima para o painel. |
| "Esqueci minha senha"/convite: e-mail não chega | Servidor de e-mail grátis do Supabase (só entrega para membros da organização e poucos por hora) | Configure o SMTP próprio (passo 6). Olhe também o spam. Em **Authentication > Logs** aparece o motivo. |
| Link do e-mail abre o site errado (ex.: `localhost:3000`) ou dá "link inválido" | Site URL / Redirect URLs não configurados | Refaça o passo 5. Peça um e-mail novo (cada link vale uma vez e expira). |
| Painel: ClickUp "não configurado" | Falta o segredo `CLICKUP_TOKEN` | Passo 9. |
| Painel: ClickUp "não conectado" / listas vazias | Token errado, ou o usuário do token não vê as listas | Gere outro token com um usuário que tenha acesso às listas e troque o segredo. Se usou `CLICKUP_PASTA_ID`, confira o número. |
| Botão "Melhorar textos com IA" não aparece | Falta `ANTHROPIC_API_KEY` | Passo 9 (é opcional). |
| Publicar relatório: "Link não comentado no ClickUp: defina o segredo SITE_URL…" | Falta `SITE_URL` | Passo 9. O relatório foi publicado mesmo assim; copie o link pelo painel. |
| Navegador (F12 → Console): "blocked by CORS policy" ao chamar `functions/v1/admin` | `SITE_URL` diferente do endereço do site | `SITE_URL` deve ser exatamente `https://disc.gestaosemcaos.com.br` (com `https`, sem barra no fim). |
| Função responde **401** "Invalid JWT" / "Missing authorization header" | Verify JWT ligado onde não deveria (ou chave nova `sb_publishable_`) | `clickup-webhook` sempre com Verify JWT **desligado**. Com a Publishable key, desligue também em `disc-sync`. Se o painel der 401 na função `admin`, desligue nela também (ela confere o login sozinha). |
| Tarefa do candidato não recebeu o DISC no ClickUp | Processo sem lista, WhatsApp diferente no formulário, ou campos DISC faltando na pasta | Veja [CLICKUP.md](CLICKUP.md) (campos do DISC e "Como o DISC acha o candidato"). Os avisos aparecem no painel em Processos. **Edge Functions → disc-sync → Logs** mostra o erro. |
| "gerar relatório" no ClickUp não faz nada | Webhook não criado, `CLICKUP_WEBHOOK_SECRET` errado, ou webhook suspenso | **Edge Functions → clickup-webhook → Logs**: "Assinatura inválida" = secret errado (copie de novo; se perdeu, apague o webhook e crie outro); "Webhook não configurado" = falta o segredo. Veja a saúde do webhook com o comando "ver os webhooks" (passo 13) e reative se estiver `suspended`. A tarefa precisa começar com **📌 Briefing** e estar numa lista ligada a um processo ativo. |
| Candidatos recebem "Muitos envios em pouco tempo…" | Proteção: no máximo 40 envios a cada 10 minutos | Espere 10 minutos. Se for um uso legítimo grande, fale com o Claude para ajustar o limite. |
| Candidatos recebem "Limite de respostas atingido. Avise o recrutador." | O banco tem 2.000 respostas (proteção) | Exporte o CSV no painel e apague respostas antigas (processos encerrados). |
| Candidatos recebem "Limite de códigos atingido…" | Os 2.400 códigos de candidato (ex.: `47K`) estão em uso | Apague candidatos antigos ou de teste no painel (o código volta a ficar livre). |
| GitHub Actions "Manter Supabase ativo" com ❌ | Segredos do GitHub errados ou projeto pausado | Confira `SUPABASE_URL` e `SUPABASE_ANON_KEY` (passo 12) e se o projeto está ativo. |

**Onde ver os erros no Supabase:** **Edge Functions** → clique na função → aba **Logs** (ou **Invocations**); **Authentication** → **Logs** (login e e-mails); **Logs & Analytics** no menu (banco e API).

## LGPD: apagar os dados

- **Pelo painel:** detalhe do candidato → **Excluir**, ou **Excluir todos** (digitando EXCLUIR), por processo.
- **Pelo Supabase:** **Table Editor** → `respostas` → marque as linhas → **Delete**. Ou no SQL Editor:
  `delete from public.respostas where recebido_em < now() - interval '6 months';`
- A ficha da pessoa (`public.pessoas`) sai sozinha junto com a última resposta dela (por qualquer um dos caminhos acima) — **menos** se ela for colaboradora ativa de uma empresa (continua no time, sem resultado). Para tirá-la também: desligue no painel e apague no SQL Editor `delete from public.pessoas where id = '…';` (vínculos, relações e relatórios dela saem junto).
- Apague também CSVs, PDFs e mensagens com códigos que tiver salvo, como antes.
- No plano grátis não há cópia de segurança para baixar: exporte o CSV pelo painel de vez em quando, se quiser guardar.

## Referência técnica (para quem for mexer no código)

- Banco: `supabase/migrations/20261005120000_disc.sql` + `supabase/migrations/20261006120000_pessoas_formulario.sql` + `supabase/migrations/20261007120000_empresas_equipes.sql` (em ordem; `pessoas` + formulário por processo; empresas/vínculos/relações + relatórios por modelo, com `salvar_colaborador`, `mover_colaborador` e `salvar_relacoes` só para admin; idempotentes; RLS em todas as tabelas; anon só chama `avaliacao_publica`, `enviar_resposta`, `relatorio_publico`; authenticated só com `public.e_admin()`; `garantir_primeiro_admin()`). Dados de exemplo para projeto de teste: `supabase/seed_previa.sql` (não rode no projeto real).
- Funções: fonte em `supabase/functions/<nome>/index.ts` + `supabase/funcoes-compartilhadas/*.js`; `npm run montar:funcoes` gera `dist/funcoes/<nome>/index.ts` (um arquivo por função, para colar no painel). `npm test` confere se os gerados estão atualizados.
- Site: `js/config.js` (`BACKEND`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`), `js/api-supabase.js`, `assets/vendor/supabase.js`.
- Despertador: `.github/workflows/manter-ativo.yml`. Migração: `scripts/migrar-planilha.mjs` (testes em `tests/migrar-planilha.test.js`).
- Testes do banco num Postgres embutido: `npm run test:supabase`.
- Contrato completo: seção "Supabase" de [SPEC.md](SPEC.md).
