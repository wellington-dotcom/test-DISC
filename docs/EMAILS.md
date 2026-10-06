# E-mails de acesso (Supabase Auth) com a marca Gestão sem Caos

Os e-mails de senha, convite e confirmação são enviados pelo **Supabase Auth**. Os modelos com a nossa marca, em
português, ficam em `supabase/templates/`. Eles **não** sobem sozinhos com o GitHub: cole cada um no painel do Supabase
uma vez (passo 2).

## 1. Remetente próprio (recomendado — e necessário para convidar outras pessoas)

Sem configuração, o Supabase envia como "Supabase Auth <noreply@mail.app.supabase.io>", com limite de poucos e-mails por
hora e **só para e-mails da equipe do projeto Supabase** (convites para outras pessoas não chegam). Para enviar como
"Gestão sem Caos <nao-responda@gestaosemcaos.com.br>":

1. Crie uma conta grátis em **resend.com** → **Domains → Add domain** → `gestaosemcaos.com.br`.
2. Copie os registros DNS que o Resend mostrar (SPF/DKIM) para o DNS do domínio e espere ficar **Verified**.
3. Resend → **API Keys → Create** (permissão *Sending access*). Não cole a chave em conversa nenhuma.
4. Supabase → **Authentication → Emails → SMTP Settings → Enable custom SMTP**:
   - Sender email: `nao-responda@gestaosemcaos.com.br` · Sender name: `Gestão sem Caos`
   - Host: `smtp.resend.com` · Port: `465` · Username: `resend` · Password: a chave do Resend
5. Aproveite a mesma chave para o e-mail com o link do relatório comprado: Supabase → **Edge Functions → Secrets** →
   `RESEND_API_KEY` = a chave, e `EMAIL_REMETENTE` = `Gestão sem Caos <nao-responda@gestaosemcaos.com.br>`. A aba **Conexões** do painel testa o envio.
   A mesma chave liga o botão **"Enviar por e-mail"** dos relatórios no painel (só o link, com o visual da marca, até 30
   envios por hora por administrador; o link usa o `SITE_URL`) e o **"Enviar para meu e-mail"** do relatório comprado.

## 2. Modelos (assunto + conteúdo)

Supabase → **Authentication → Emails → Templates**. Em cada aba, troque o **Subject** e cole o arquivo inteiro em
**Message body** (modo *Source*/HTML) → **Save**.

| Aba no Supabase | Subject | Arquivo |
|---|---|---|
| Reset Password | `Crie uma nova senha · Mapa DISC` | `supabase/templates/recuperar-senha.html` |
| Invite user | `Seu acesso ao painel do Mapa DISC` | `supabase/templates/convite.html` |
| Confirm signup | `Confirme seu e-mail · Mapa DISC` | `supabase/templates/confirmar-cadastro.html` |
| Magic Link | `Seu link de acesso · Mapa DISC` | `supabase/templates/link-de-acesso.html` |
| Change Email Address | `Confirme o novo e-mail · Mapa DISC` | `supabase/templates/trocar-email.html` |

O logo vem de `https://disc.gestaosemcaos.com.br/assets/marca/gsc-logo-email.png` (PNG, porque o Gmail não mostra SVG).

## 3. Endereços permitidos (evita link que "não funciona")

Supabase → **Authentication → URL Configuration**:
- **Site URL**: `https://disc.gestaosemcaos.com.br`
- **Redirect URLs**: `https://disc.gestaosemcaos.com.br/admin.html` e `https://disc.gestaosemcaos.com.br/**`

Sem isso, o link do e-mail pode cair numa página errada e a nova senha não é gravada.
