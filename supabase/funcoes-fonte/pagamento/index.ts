// Edge Function "pagamento" — venda direta (Mapa de Perfil). Pública: no painel, desligue "Verify JWT".
// Ações: criar (PaymentIntent do Stripe para o Payment Element no site, link do checkout da InfinitePay, ou cobrança
// Pix + link de cartão no Asaas), status (situação do pedido), confirmar (retorno do Stripe/InfinitePay), recuperar
// (link por e-mail).
// Segredos: PAGAMENTO_PROVEDOR? ('stripe' | 'infinitepay' | 'asaas'), STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY,
// INFINITEPAY_HANDLE (InfiniteTag), ASAAS_API_KEY,
// ASAAS_AMBIENTE, RESEND_API_KEY?, EMAIL_REMETENTE?, SITE_URL. Lógica em
// supabase/funcoes-compartilhadas/pagamento.js. Para colar no painel do Supabase use dist/funcoes/pagamento/index.ts
// (gerado por npm run montar:funcoes).
// @ts-nocheck
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { atenderPagamento, criarBaseVendas } from '../../funcoes-compartilhadas/pagamento.js';

Deno.serve((req) => atenderPagamento(req, criarBaseVendas(createClient, (n) => Deno.env.get(n))));
