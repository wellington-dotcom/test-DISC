// Edge Function "admin" — painel do recrutador (só administradores). Corpo {acao, ...}; resposta {ok, ...}.
// Ações: clickup.status, clickup.listas, processo.dados, relatorio.rascunho, relatorio.salvar,
// relatorio.publicar, relatorio.despublicar, relatorios.listar, relatorio.melhorarTextos,
// usuarios.listar, usuarios.convidar, usuarios.remover. Lógica em supabase/funcoes-compartilhadas/.
// Para colar no painel do Supabase use dist/funcoes/admin/index.ts (gerado por npm run montar:funcoes).
// @ts-nocheck
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { atenderAdmin } from '../../funcoes-compartilhadas/http.js';
import { criarBaseSupabase } from '../../funcoes-compartilhadas/supabase-adaptadores.js';
import { DISC_RELATORIO, DISC_CONFIABILIDADE } from '../../funcoes-compartilhadas/motores-gerado.js';

Deno.serve((req) => atenderAdmin(req, criarBaseSupabase(createClient, (n) => Deno.env.get(n), {
  motor: DISC_RELATORIO,
  confiabilidade: DISC_CONFIABILIDADE
})));
