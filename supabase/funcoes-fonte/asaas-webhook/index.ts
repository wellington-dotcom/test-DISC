// Edge Function "asaas-webhook" — o Asaas avisa pagamento confirmado, estorno e cobrança removida.
// Pública: no painel, desligue "Verify JWT"; a segurança é o cabeçalho asaas-access-token (segredo ASAAS_WEBHOOK_TOKEN).
// Lógica em supabase/funcoes-compartilhadas/pagamento.js. Para colar no painel do Supabase use
// dist/funcoes/asaas-webhook/index.ts (gerado por npm run montar:funcoes).
// @ts-nocheck
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { atenderWebhookAsaas, criarBaseVendas } from '../../funcoes-compartilhadas/pagamento.js';

Deno.serve((req) => atenderWebhookAsaas(req, criarBaseVendas(createClient, (n) => Deno.env.get(n))));
