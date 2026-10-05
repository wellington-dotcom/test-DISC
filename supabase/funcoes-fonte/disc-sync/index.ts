// Edge Function "disc-sync" — o site do candidato chama logo depois da RPC enviar_resposta, com {id}.
// Grava o DISC na tarefa do candidato no ClickUp (uma vez só) e responde só {ok}.
// Para colar no painel do Supabase use dist/funcoes/disc-sync/index.ts (gerado por npm run montar:funcoes).
// @ts-nocheck
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { atenderDiscSync } from '../../funcoes-compartilhadas/http.js';
import { criarBaseSupabase } from '../../funcoes-compartilhadas/supabase-adaptadores.js';
import { DISC_CONFIABILIDADE } from '../../funcoes-compartilhadas/motores-gerado.js';

// Responde logo e termina o trabalho em segundo plano (EdgeRuntime.waitUntil do Supabase).
const emSegundoPlano = typeof EdgeRuntime !== 'undefined' && EdgeRuntime && typeof EdgeRuntime.waitUntil === 'function'
  ? (p) => EdgeRuntime.waitUntil(p)
  : undefined;

Deno.serve((req) => atenderDiscSync(req, criarBaseSupabase(createClient, (n) => Deno.env.get(n), {
  confiabilidade: DISC_CONFIABILIDADE,
  emSegundoPlano
})));
