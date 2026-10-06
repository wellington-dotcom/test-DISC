// Edge Function "stripe-webhook" — o Stripe avisa pagamento aprovado (payment_intent.succeeded), estorno
// (charge.refunded) e contestação (charge.dispute.created) da venda direta paga DENTRO do site (Payment Element).
// Pública: no painel, desligue "Verify JWT"; a segurança é a assinatura Stripe-Signature (segredo STRIPE_WEBHOOK_SECRET,
// o "Signing secret" whsec_… do endpoint em Developers → Webhooks). Antes de liberar, confere o PaymentIntent no Stripe
// (STRIPE_SECRET_KEY): status succeeded, valor e pedido. Lógica em supabase/funcoes-compartilhadas/pagamento.js e
// stripe.js. Para colar no painel do Supabase use dist/funcoes/stripe-webhook/index.ts (gerado por npm run montar:funcoes).
// @ts-nocheck
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { atenderWebhookStripe, criarBaseVendas } from '../../funcoes-compartilhadas/pagamento.js';

Deno.serve((req) => atenderWebhookStripe(req, criarBaseVendas(createClient, (n) => Deno.env.get(n))));
