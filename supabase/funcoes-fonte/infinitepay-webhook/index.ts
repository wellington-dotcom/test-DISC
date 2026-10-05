// Edge Function "infinitepay-webhook" — a InfinitePay avisa o pagamento aprovado do checkout (Pix ou cartão).
// Pública: no painel, desligue "Verify JWT". A InfinitePay não assina o aviso: o corpo NUNCA é confiável — a função
// lê order_nsu (= id do pedido), transaction_nsu e slug e confere com o payment_check da InfinitePay antes de liberar.
// Não precisa cadastrar nada na InfinitePay: o endereço vai no próprio link de pagamento (webhook_url).
// Segredos: INFINITEPAY_HANDLE (InfiniteTag, sem o $), SITE_URL, RESEND_API_KEY?, EMAIL_REMETENTE?. Lógica em
// supabase/funcoes-compartilhadas/pagamento.js e infinitepay.js. Para colar no painel do Supabase use
// dist/funcoes/infinitepay-webhook/index.ts (gerado por npm run montar:funcoes).
// @ts-nocheck
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { atenderWebhookInfinitePay, criarBaseVendas } from '../../funcoes-compartilhadas/pagamento.js';

Deno.serve((req) => atenderWebhookInfinitePay(req, criarBaseVendas(createClient, (n) => Deno.env.get(n))));
