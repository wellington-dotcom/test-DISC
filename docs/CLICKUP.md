# ClickUp + Teste DISC: guia de configuração

Este guia é para quem cuida do ClickUp da Notus. Ele explica o que criar no ClickUp para o sistema ler os candidatos, gravar o DISC e montar o relatório para o contratante.

**Ideia geral**

- **Um processo seletivo = uma lista do ClickUp.** Cada candidato é uma tarefa da lista.
- O ClickUp é a **fonte** dos candidatos. A planilha do Google guarda só: logins do painel, processos (configuração), respostas do DISC (cópia de segurança) e relatórios publicados.
- O sistema **só lê** os campos que conhece pelo nome. Campos de dado sensível são sempre ignorados (veja a seção 4).

---

## 1. Campos personalizados (crie no nível da PASTA)

Crie os campos **na pasta "Recrutamento e Seleção"** (não em cada lista). Assim toda lista nova de processo já nasce com eles.

No ClickUp: abra a pasta → **⋯** → **Campos personalizados** (Custom Fields) → **+ Novo campo**.

O sistema compara os nomes **sem diferenciar maiúsculas, acentos e pontuação** ("Pretensão salarial" = "pretensao salarial"). Mesmo assim, use os nomes abaixo.

### 1.1 Dados do candidato (vindos do formulário)

| Nome do campo | Tipo no ClickUp | Para que serve |
|---|---|---|
| `WhatsApp` | Telefone | Achar a tarefa do candidato quando ele faz o DISC. Também aceita os nomes `Telefone` ou `Celular`. **Nunca vai para o relatório.** |
| `Idade` | Número | Só números gerais do processo (faixas de idade no bloco "Atração"). Nunca é critério de nota. Se preferir faixas, use **Lista suspensa** (ex.: "18 a 24", "25 a 34"…). |
| `Status de trabalho` | Lista suspensa | Ex.: "Empregado", "Desempregado", "Autônomo". Aparece como contagem no relatório. |
| `Pretensão salarial` | Moeda (R$) | Média da pretensão no relatório. |
| `Último salário` | Moeda (R$) | Média do último salário no relatório. |
| `Formação` | Texto curto | Também aceita `Escolaridade` ou `Curso`. |

### 1.2 Notas das etapas (um campo por etapa)

| Exemplo de nome | Tipo |
|---|---|
| `Nota – Revisão documental` | Número (0 a 10) |
| `Nota – Redação situacional` | Número (0 a 10) |
| `Nota – Simulação ao vivo` | Número (0 a 10) |

- Crie **um campo numérico por etapa**, com nota de **0 a 10** (aceita decimal, ex.: 7,5).
- No painel, ao configurar o processo, cada etapa pede o **nome exato do campo** (ex.: `Nota – Revisão documental`) e o **peso** da etapa.
- Etapa que ninguém fez ainda aparece no relatório como "peso em aberto" (pendente).
- Candidato sem nota numa etapa que os outros já fizeram conta como 0 nessa etapa e fica marcado como "incompleto".

### 1.3 Bônus (opcional)

| Exemplo de nome | Tipo | Regra no painel |
|---|---|---|
| `Graduação na área` | Caixa de seleção (checkbox) | Marcado = soma os pontos definidos (ex.: +10). |
| `Perfil presencial` | Lista suspensa com as opções `3`, `4`, `5` | Cada opção vale uns pontos (ex.: 3 = 0, 4 = +10, 5 = +15). Escreva no painel o **texto exato da opção**. |

O bônus é somado **por fora** da nota técnica (total = técnica + bônus).

### 1.4 Campos do DISC (o sistema preenche sozinho)

| Nome do campo | Tipo |
|---|---|
| `DISC D %` | Número |
| `DISC I %` | Número |
| `DISC S %` | Número |
| `DISC C %` | Número |
| `DISC Perfil` | Texto curto (ex.: "CD") |
| `DISC Confiabilidade` | Texto curto (Alta, Média, Baixa) |
| `DISC Código` | Texto curto (o protocolo do candidato, ex.: "47K") |

Ninguém precisa digitar nesses campos. Se algum deles não existir na lista, o sistema grava tudo num **comentário** da tarefa e mostra um aviso no painel.

---

## 2. Status do funil

Os status são da lista (ou herdados da pasta). Sugestão:

| Status | Tipo | Uso |
|---|---|---|
| `novo` | Aberto | Acabou de chegar pelo formulário. |
| `sem resposta` | Personalizado | Não respondeu ao contato. |
| `aguardando retorno` | Personalizado | Contato feito, esperando. |
| `fora do perfil` | Personalizado | Não segue no processo. |
| `em avaliação` | Personalizado | Fazendo as etapas. |
| `finalista` | Personalizado | Chegou à fase final. |
| `aprovado` | Concluído | Indicado ao contratante. |
| `desistente` | Fechado | Saiu do processo. |
| `gerar relatório` | Personalizado | **Só para a tarefa de briefing** (seção 3). |
| `relatório em revisão` | Personalizado | **Só para a tarefa de briefing**. |

No painel, em cada processo, você escolhe quais status contam como **finalistas** (ex.: `finalista` e `aprovado`). Se não escolher nenhum, conta como finalista quem tem alguma nota de etapa ou o DISC.

O relatório mostra o funil (quantos candidatos em cada status), sem nomes.

---

## 3. Tarefa de briefing da vaga

Em cada lista, crie uma tarefa com o nome começando por **`📌 Briefing`**, por exemplo: **`📌 Briefing da vaga`**.

- Ela **não conta como candidato**.
- Quando um relatório é **publicado**, o link entra como **comentário** nessa tarefa (se ela não existir, o comentário vai para a lista).
- **Gerar o rascunho pelo ClickUp (opcional):** mude o status da tarefa de briefing para **`gerar relatório`**. Em até 10 minutos o sistema gera o rascunho, comenta "Rascunho pronto para revisão no painel" e muda o status para **`relatório em revisão`**. Para isso funcionar, a função `instalarGatilho()` precisa ter sido executada uma vez no Apps Script (veja `docs/BACKEND.md`).

---

## 4. O que NÃO coletar

Não crie (e não peça no formulário) campos sobre:

- **sexo, gênero, estado civil, filhos, gravidez;**
- **religião, etnia, raça, cor da pele, orientação sexual;**
- **deficiência, doença, saúde.**

Esses dados não servem para escolher candidato e podem levar a discriminação (Lei 9.029/95 e LGPD). Mesmo que existam na lista, o sistema **nunca lê, mostra, exporta ou guarda** campos cujo nome contenha essas palavras.

**Antecedentes criminais / "processo em seu nome":** só quando o cargo realmente justificar (ex.: cartório, segurança, valores). Mesmo assim, só são lidos se o processo marcar "permitir antecedentes" no painel, e **nunca aparecem no relatório do contratante**.

**Telefone e e-mail** nunca aparecem no relatório. Os nomes aparecem só como **primeiro nome + inicial do sobrenome** (ex.: "Ana S.").

---

## 5. Token da API do ClickUp

1. No ClickUp, clique na sua foto (canto) → **Configurações** → **Apps** (ou "Aplicativos").
2. Em **API Token**, clique em **Gerar** e copie o código (começa com `pk_`).
3. No Apps Script do projeto: **Configurações do projeto** (engrenagem) → **Propriedades do script** → **Adicionar propriedade**:
   - `CLICKUP_TOKEN` = o código copiado.
   - `CLICKUP_PASTA_ID` (opcional, recomendado) = o número da pasta "Recrutamento e Seleção" (aparece no endereço da pasta no navegador). Com ele, o painel mostra só as listas dessa pasta.
   - `SITE_URL` (opcional) = endereço do site (ex.: `https://seu-usuario.github.io/test-DISC/`), usado no link do relatório comentado no ClickUp.
   - `ANTHROPIC_API_KEY` (opcional) = chave da API da Anthropic, para o botão "Melhorar textos com IA".
4. Salve (não precisa reimplantar). O token **fica só no servidor**: nunca aparece no navegador nem no painel.

Dica: gere o token com um usuário que tenha acesso às listas de recrutamento. Se ele sair da empresa, gere outro token e troque a propriedade. Mais detalhes (e o que fazer em caso de erro) em `docs/BACKEND.md`.

---

## 6. Como o DISC acha o candidato pelo WhatsApp

1. No painel, ligue o processo a uma lista do ClickUp e mande aos candidatos o link do teste (`index.html?a=CODIGO`).
2. O candidato informa o WhatsApp no começo do teste.
3. Ao concluir, o sistema procura na lista a tarefa com o **mesmo WhatsApp**: compara os **últimos 8 dígitos** e o **DDD** (aceita com ou sem +55, com ou sem máscara).
4. Achou: grava os campos do DISC (seção 1.4) na tarefa.
5. Não achou: cria a tarefa **"<nome> (DISC)"**, com o WhatsApp na descrição e a etiqueta **`sem formulário`**. Confira essas tarefas: geralmente é alguém que fez o teste sem preencher o formulário, ou digitou outro número.
6. Se o ClickUp estiver fora do ar, o candidato **conclui o teste normalmente**. O resultado fica na planilha e o painel mostra um aviso.

---

## 7. Gerar e publicar o relatório

1. No painel, aba **Processos** → abra o processo → confira a configuração: perfil ideal, etapas (nome do campo e peso), bônus, nota de corte e faixa "avaliar".
2. Toque em **Gerar rascunho do relatório** (ou use o status `gerar relatório` na tarefa de briefing). O sistema lê a lista do ClickUp e escreve os textos.
3. **Revise cada texto.** O que você muda fica marcado como "Editado". Se a IA estiver configurada, "Melhorar textos com IA" reescreve os textos de forma mais fluida (revise depois).
4. Toque em **Publicar**. Você recebe um link `relatorio.html?r=...` e uma mensagem pronta para mandar ao contratante. O link também é comentado na tarefa `📌 Briefing`.
5. Precisa corrigir? Edite e salve: o mesmo link já mostra a versão nova. Para tirar do ar, use **Despublicar**.

Na **prévia** (`API_URL: 'simulada'`) nada disso fala com o ClickUp: o processo "Cartório Exemplo — Escrevente" usa candidatos fictícios, e o relatório de exemplo abre em `relatorio.html#r-exemplo-cartorio`.
