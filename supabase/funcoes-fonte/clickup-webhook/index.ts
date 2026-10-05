// Edge Function "clickup-webhook" — recebe os eventos do ClickUp (taskStatusUpdated). Pública: no painel,
// desligue "Verify JWT"; a segurança é a assinatura X-Signature (segredo CLICKUP_WEBHOOK_SECRET).
// Tarefa "📌 Briefing…" em "gerar relatório" -> rascunho + comentário + status "relatório em revisão".
// Para colar no painel do Supabase use dist/funcoes/clickup-webhook/index.ts (gerado por npm run montar:funcoes).
// @ts-nocheck
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { atenderWebhookClickUp } from '../../funcoes-compartilhadas/http.js';
import { criarBaseSupabase } from '../../funcoes-compartilhadas/supabase-adaptadores.js';
import { DISC_RELATORIO, DISC_CONFIABILIDADE } from '../../funcoes-compartilhadas/motores-gerado.js';

// Responde logo e termina o trabalho em segundo plano (EdgeRuntime.waitUntil do Supabase).
const emSegundoPlano = typeof EdgeRuntime !== 'undefined' && EdgeRuntime && typeof EdgeRuntime.waitUntil === 'function'
  ? (p) => EdgeRuntime.waitUntil(p)
  : undefined;

Deno.serve((req) => atenderWebhookClickUp(req, criarBaseSupabase(createClient, (n) => Deno.env.get(n), {
  motor: DISC_RELATORIO,
  confiabilidade: DISC_CONFIABILIDADE,
  emSegundoPlano
})));
