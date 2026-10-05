# Vender o Mapa de Perfil — passo a passo (Gestão sem Caos)

## Opção recomendada: InfinitePay

Você já tem conta na **InfinitePay**, e o sistema agora usa ela como meio de pagamento **padrão**. O cliente clica em
"Comprar", vai para a **página de pagamento da InfinitePay** (Pix ou cartão), paga e **volta sozinho** para o
relatório, já liberado. O Asaas (passos 2 a 8 mais abaixo) continua funcionando como **alternativa**: só é usado se você
escolher (`PAGAMENTO_PROVEDOR = asaas`) ou se a InfinitePay não estiver configurada.

**Passo a passo (uns 15 minutos):**

1. **Pegue a sua InfiniteTag** no app da InfinitePay (é o seu "@" de recebimento, aparece no seu perfil, começa com
   `$`, por exemplo `$gestaosemcaos`). Anote **sem o `$`**: `gestaosemcaos`.
2. **Guarde no Supabase:** menu **Edge Functions → Secrets → Add new secret**:
   - `INFINITEPAY_HANDLE` = a InfiniteTag sem o `$` (é só o identificador da conta, não é senha — mas trate como
     configuração: fica nos Secrets, não no código nem em conversa);
   - `PAGAMENTO_PROVEDOR` = `infinitepay` (deixa a escolha explícita; sem ele, a InfinitePay já é usada quando o
     `INFINITEPAY_HANDLE` existe);
   - confira que `SITE_URL` = `https://disc.gestaosemcaos.com.br` (sem barra no fim) — é para lá que o cliente volta.
3. **Confira a função nova:** em **Edge Functions** deve aparecer o cartão **`infinitepay-webhook`** (além de
   `pagamento`). Clique nela → **Details** → **Verify JWT desligado**. Se não aparecer, crie à mão colando
   `dist/funcoes/infinitepay-webhook/index.ts` (e atualize `pagamento` com `dist/funcoes/pagamento/index.ts`).
   No painel do sistema não pode aparecer a faixa "banco desatualizado" (a migração `20261012120000_infinitepay.sql`
   tem de ter rodado).
4. **Nada de webhook para cadastrar:** o endereço do aviso de pagamento vai dentro de cada link de pagamento. Por
   segurança o sistema **não acredita** no aviso: sempre pergunta à InfinitePay ("esse pedido foi pago, e quanto?")
   antes de liberar o relatório.
5. **Compra de teste de R$ 1 (dinheiro de verdade, depois você devolve):**
   - no painel → **Vendas → Cupons**, crie o cupom `TESTE1` do tipo **valor**, desconto = preço do pacote menos R$ 1
     (ex.: Relatório completo a R$ 29 → desconto de R$ 28), **1 uso**, só para o pacote `completo`;
   - faça o teste no celular, escolha o Relatório completo, use o cupom `TESTE1` e pague R$ 1 por **Pix**;
   - *o que deve acontecer:* você volta para o site, aparece "Pagamento confirmado" e o relatório abre. No painel → Vendas
     o pedido aparece **pago**, método Pix. (Se a InfinitePay recusar valor tão baixo, faça o mesmo teste com R$ 5.)
   - repita com **cartão** se quiser ver os dois caminhos; depois **desative o cupom**.
6. **Reembolso** (garantia de 7 dias): devolva o dinheiro **pelo app da InfinitePay** (na venda → estornar/devolver) e
   depois, no painel → Vendas, clique em **"Reembolsar/estornar"** no pedido — o aviso de estorno da InfinitePay não
   chega sozinho ao sistema, então este clique é o que bloqueia o relatório.
7. **Nota fiscal:** a InfinitePay **não emite NFS-e automaticamente** (o Asaas tem essa opção). Combine com o seu
   contador: emitir pela prefeitura (nota de serviço) para cada venda — ou um resumo mensal, se a sua prefeitura e o
   seu regime permitirem — ou contratar um serviço de emissão de nota que se ligue à sua conta.

**Asaas × InfinitePay (resumo):**

| | InfinitePay | Asaas |
|---|---|---|
| Conta | a que você já tem (app) | conta nova, com aprovação de documentos |
| Configuração | 1 segredo (InfiniteTag) | chave de API + token do webhook + ambiente |
| Pagamento | página da InfinitePay (Pix e cartão); o cliente sai do site e volta | Pix (QR) dentro do site + página do Asaas para cartão |
| Aviso de pagamento | automático no link; o sistema confere antes de liberar | webhook cadastrado à mão, com token |
| Estorno | pelo app; marcar no painel | pelo Asaas (o aviso marca sozinho) |
| Nota fiscal | não emite (contador/prefeitura) | pode emitir NFS-e automática |
| Taxas | veja no **seu app** (dependem do seu plano) | veja no painel do Asaas |

> Não colocamos números de taxa aqui de propósito: elas mudam e dependem do plano de cada conta. Compare as do seu app
> InfinitePay com as do Asaas antes de decidir.

**Detalhes técnicos que dependem da InfinitePay** (a documentação oficial não pôde ser consultada daqui): o sistema
supõe que os valores do `payment_check` vêm em **centavos** e aceita o link em `url`, `link` ou `checkout_url`. Se um
pagamento real não for liberado, o painel mostra o pedido como "aguardando" e o retorno bruto da InfinitePay fica
gravado no pedido (`provedor_dados`) — peça para conferirem ali; enquanto isso, use "Liberar como cortesia".

---

## Alternativa: Asaas

Este guia liga a venda direta ao público: a pessoa faz o teste, vê o **resumo grátis** e compra o relatório
completo por **Pix** ou **cartão**. O dinheiro cai na conta **Asaas da Gestão sem Caos**. Sem o Asaas configurado o
site continua no ar: aparece "Compra disponível em breve — use um cupom" e os cupons continuam funcionando.

> **Regra de ouro:** chave de API, token de webhook e senha **nunca** vão para conversa (chat, WhatsApp, e-mail) nem
> para o repositório do GitHub. Elas só são coladas em **um** lugar: **Supabase → Edge Functions → Secrets**.

## Resumo (o que você vai fazer)

| # | Passo | Onde | Tempo |
|---|---|---|---|
| 1 | Conferir que o banco e as funções novas subiram | Supabase | 5 min |
| 2 | Criar a conta de **testes** (sandbox) no Asaas | sandbox.asaas.com | 10 min |
| 3 | Gerar a chave de API e guardar no Supabase | Asaas + Supabase | 5 min |
| 4 | Ligar o aviso automático de pagamento (webhook) | Asaas + Supabase | 10 min |
| 5 | Testar uma compra de mentira | Site | 10 min |
| 6 | Criar o cupom de lançamento | Painel → Vendas | 2 min |
| 7 | E-mail automático com o link (opcional) | Resend + Supabase | 20 min |
| 8 | Virar para produção (dinheiro de verdade) | Asaas + Supabase | 15 min |
| 9 | Checklist jurídico antes de anunciar | Advogado/contador | — |

---

## 1. Conferir que o banco e as funções novas subiram

Quando o código desta rodada for publicado (push no GitHub), a integração do Supabase aplica sozinha a migração
`20261011120000_vendas.sql` e publica as funções `pagamento` e `asaas-webhook`.

1. Entre no painel do sistema (`admin.html`). Se aparecer a faixa **"O banco de dados está desatualizado"**, a migração
   ainda não rodou: veja em **docs/SUPABASE.md** como aplicar à mão (SQL Editor → colar o arquivo → **Run**).
2. No Supabase, menu **Edge Functions**. *O que você vê:* uma lista com os cartões `admin`, `disc-sync`,
   `clickup-webhook`, **`pagamento`** e **`asaas-webhook`**.
   - Se `pagamento` ou `asaas-webhook` não estiverem lá, crie à mão como no passo 8 do docs/SUPABASE.md, colando
     `dist/funcoes/pagamento/index.ts` e `dist/funcoes/asaas-webhook/index.ts`.
3. Clique em cada uma das duas → aba **Details** → **Verify JWT** tem de ficar **desligado** (quem chama é o site do
   cliente e o Asaas, que não têm login; a segurança é feita dentro da função).
4. Em **Edge Functions → Secrets**, confira que `SITE_URL` = `https://disc.gestaosemcaos.com.br` (sem barra no fim).

## 2. Criar a conta de testes (sandbox) no Asaas

O sandbox é um Asaas "de brincadeira": nada é cobrado. Sempre teste lá primeiro.

1. Acesse **https://sandbox.asaas.com** → **Criar conta**. Use o e-mail da Gestão sem Caos.
   *O que você vê:* um painel igual ao do Asaas de verdade, com uma faixa avisando que é ambiente de testes.
2. Preencha os dados da empresa (no sandbox podem ser fictícios).
3. Cadastre uma **chave Pix** (menu **Pix → Minhas chaves → Cadastrar chave**; no sandbox pode ser a aleatória).
   Sem chave Pix o Asaas não gera o QR Code — a pessoa ainda consegue pagar pela página do Asaas, mas o QR não aparece no site.

## 3. Gerar a chave de API e guardar no Supabase

1. No Asaas (sandbox), menu do usuário (canto superior direito) → **Integrações** → **Chaves de API** → **Gerar chave**.
   *O que você vê:* uma caixa com um texto longo. Ele aparece **uma vez só**.
2. Clique em **Copiar**. Não cole em nenhum outro lugar além do próximo passo.
3. No Supabase: **Edge Functions → Secrets → Add or replace secrets**:

| Name | Value |
|---|---|
| `ASAAS_API_KEY` | a chave que você copiou |
| `ASAAS_AMBIENTE` | `sandbox` |

4. **Save**. Vale na hora, não precisa reimplantar nada.

## 4. Ligar o aviso automático de pagamento (webhook)

Quando o Pix cai, o Asaas avisa o sistema e o relatório é liberado na hora (o site também confere sozinho a cada
poucos segundos, mas o webhook é o caminho principal e é ele que avisa estornos).

1. Invente uma senha longa só para isso (32 letras e números, por exemplo de um gerador de senhas). Ela será o
   **token do webhook**.
2. No Supabase, **Edge Functions → Secrets**: `ASAAS_WEBHOOK_TOKEN` = essa senha → **Save**.
3. No Asaas: **Integrações → Webhooks → Adicionar** (ou **Criar webhook**). Preencha:
   - **Nome:** Mapa de Perfil
   - **URL:** `https://tevpqngqzxcswmticjnr.supabase.co/functions/v1/asaas-webhook`
   - **E-mail:** o seu (o Asaas avisa se o webhook falhar)
   - **Versão da API:** v3 · **Tipo de envio:** sequencial · **Fila de sincronização:** ativada
   - **Token de autenticação:** a mesma senha do item 1
   - **Eventos:** marque *Cobrança recebida* (`PAYMENT_RECEIVED`), *Cobrança confirmada* (`PAYMENT_CONFIRMED`),
     *Cobrança estornada* (`PAYMENT_REFUNDED`), *Estorno parcial* (`PAYMENT_PARTIALLY_REFUNDED`),
     *Chargeback solicitado* (`PAYMENT_CHARGEBACK_REQUESTED`), *Disputa de chargeback* (`PAYMENT_CHARGEBACK_DISPUTE`)
     e *Cobrança removida* (`PAYMENT_DELETED`).
4. **Salvar**. *O que você vê:* o webhook na lista com a situação **Ativo**.

Se um dia a situação virar **Interrompido/Pausado**: veja em **Supabase → Edge Functions → asaas-webhook → Logs**.
"Token inválido" = a senha do Asaas e a do Supabase não são iguais (cole de novo nas duas). Depois reative a fila no Asaas.

## 5. Testar uma compra de mentira

1. Abra `https://disc.gestaosemcaos.com.br/descubra.html` no celular → **Começar meu mapa grátis**.
2. Preencha nome e um e-mail seu, responda o teste. *O que você vê no fim:* o resumo grátis e os pacotes pagos.
3. Escolha **Relatório completo** → **Pix**. *O que você vê:* o QR Code e o "copia e cola".
   - Se o site pedir **CPF**, é o Asaas exigindo o documento do pagador; use um CPF válido (no sandbox, o seu).
4. No Asaas sandbox, menu **Cobranças**: a cobrança "Mapa de Perfil DISC — Relatório completo — Gestão sem Caos"
   aparece como *Aguardando pagamento*. Abra e use **Confirmar recebimento** (simula o Pix pago).
5. Volte ao celular: em alguns segundos aparece **"Pagamento confirmado"** e o relatório completo abre
   (`meu-relatorio.html#t-…`). Guarde esse link: ele é o acesso da pessoa.
6. No painel, aba **Vendas**: o pedido aparece como **pago**.
7. Teste o estorno: no Asaas, na cobrança, **Estornar**. O pedido vira **estornado** no painel e o link do relatório
   passa a mostrar "Esta compra foi estornada".

Para testar o cartão: no passo 3 escolha **Cartão** (abre a página do Asaas) e use um cartão de teste do sandbox
(lista na documentação do Asaas, "Cartões para teste").

## 6. Criar o cupom de lançamento

Painel → aba **Vendas** → **Cupons** → **Novo cupom**:

- **Código:** por exemplo `LANCAMENTO` (letras, números, `-` ou `_`)
- **Tipo:** *percentual* (ex.: 20 = 20% de desconto) ou *valor* (desconto fixo em reais)
- **Limite de usos** (opcional), **válido até** (opcional), **pacotes** (vazio = todos)

Um cupom de **100%** libera o relatório **sem pagar** — útil para parceiros e para testar sem o Asaas.
Os preços e o "preço de lançamento" (com data de fim, se quiser) ficam em **Vendas → Pacotes**.

## 7. E-mail automático com o link (opcional, recomendado)

Sem isso o sistema funciona: a pessoa vê o link na tela e pode mandar para o próprio WhatsApp. Com o e-mail, ela
recebe o link ao pagar e consegue usar **"Recuperar meu relatório"** sozinha.

1. Crie a conta em **https://resend.com** e, em **Domains**, adicione `gestaosemcaos.com.br`. O Resend mostra 3 ou 4
   registros DNS: peça para quem cuida do domínio cadastrá-los. Espere ficar **Verified**.
2. **API Keys → Create API Key** (permissão *Sending access*) → copie.
3. Supabase → **Edge Functions → Secrets**:

| Name | Value |
|---|---|
| `RESEND_API_KEY` | a chave do Resend |
| `EMAIL_REMETENTE` | `Gestão sem Caos <relatorio@gestaosemcaos.com.br>` |

Sem e-mail configurado, "Recuperar meu relatório" mostra a orientação de falar com o suporte: preencha
`WHATSAPP_SUPORTE` em `js/config.js` (DDI + DDD + número, só dígitos).

## 8. Virar para produção (dinheiro de verdade)

1. Crie (ou use) a conta **Asaas de produção** em **https://www.asaas.com**, no **CNPJ da Gestão sem Caos**, e conclua
   a aprovação de documentos. Cadastre a chave Pix da empresa.
2. Gere a chave de API **de produção** (mesmo caminho do passo 3).
3. Supabase → **Secrets**: troque `ASAAS_API_KEY` pela chave de produção e `ASAAS_AMBIENTE` por `producao`.
4. Refaça o **passo 4** na conta de produção (o webhook do sandbox não vale lá). Pode usar um token novo — troque
   também o `ASAAS_WEBHOOK_TOKEN`.
5. Faça **uma compra real de R$ 1** (crie um cupom que deixe o valor baixo, ou mude o preço por alguns minutos),
   confira que liberou e depois estorne pelo Asaas.
6. Preencha `EMPRESA_LEGAL` em `js/config.js` (ex.: `Gestão sem Caos Ltda — CNPJ 00.000.000/0001-00`).

## Reembolso (garantia de 7 dias)

A compra pela internet tem direito de arrependimento de 7 dias (Código de Defesa do Consumidor, art. 49).

1. Devolva o dinheiro **no Asaas**: Cobranças → abra a cobrança (o código `pay_…` aparece no pedido, no painel) → **Estornar**.
2. O webhook marca o pedido como **estornado** sozinho. Se precisar, no painel → **Vendas** → pedido → **Reembolsar/estornar**
   (isso só bloqueia o relatório; o dinheiro é sempre devolvido no Asaas).

## Checklist jurídico (antes de anunciar)

- [ ] `termos.html` e `privacidade.html` revisados por advogado (estão marcados como rascunho).
- [ ] Razão social e CNPJ da Gestão sem Caos no rodapé (`EMPRESA_LEGAL`).
- [ ] Política de reembolso de 7 dias clara na página e no checkout.
- [ ] Textos sem promessa clínica: nada de "diagnóstico", "teste psicológico", "cura", "ansiedade", "depressão". O DISC
      descreve **estilo de comportamento**, não competência nem saúde.
- [ ] LGPD: os dados servem só para gerar o relatório; não são compartilhados com empresas; a pessoa pode pedir exclusão
      (no painel, excluir a resposta; o registro do pedido fica guardado por obrigação fiscal, sem as respostas).
- [ ] Nota fiscal de serviço: combine com o contador (o Asaas pode emitir NFS-e automaticamente).
- [ ] Anúncios (Meta/Google): a página `descubra.html` tem termos e privacidade no rodapé, exigência das plataformas.

## Problemas comuns

| O que acontece | Por quê | O que fazer |
|---|---|---|
| Site mostra "Compra disponível em breve — use um cupom" | Falta `ASAAS_API_KEY` ou a função `pagamento` não está publicada | Passos 1 e 3 |
| Pagou e não liberou | Webhook parado ou token diferente | Passo 4; veja **Edge Functions → asaas-webhook → Logs**. Enquanto isso, o site confere no Asaas sozinho quando a pessoa está na tela de espera; ou libere pelo painel (**Liberar como cortesia**) |
| QR Code não aparece, só o botão do cartão | Conta Asaas sem chave Pix | Cadastre a chave Pix (passo 2, item 3) |
| "Informe o seu CPF para pagar" | O Asaas exige o CPF do pagador | Normal: a pessoa informa o CPF; ele vai só para o Asaas |
| "Recuperar meu relatório" manda falar com o suporte | E-mail não configurado | Passo 7 |
