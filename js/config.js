/*
 * Configuração do sistema DISC — edite aqui antes de publicar.
 *
 *   BACKEND                         Qual servidor o site usa:
 *                                     'appsscript' (padrão atual) — Google Apps Script + planilha (API_URL abaixo);
 *                                     'supabase'  — Supabase (SUPABASE_URL + SUPABASE_ANON_KEY abaixo; js/api-supabase.js);
 *                                     'simulada'  — só prévia/demonstração: dados neste navegador (js/api-simulada.js).
 *   API_URL                         URL do Web App do Google Apps Script (termina em /exec), usada com BACKEND 'appsscript'.
 *                                   Vazio = funciona sem backend: o candidato recebe um código de resultado
 *                                   para enviar ao recrutador. 'simulada' também liga a prévia (forma antiga).
 *   SUPABASE_URL                    "Project URL" do Supabase (Project Settings > API), ex.: https://abcd1234.supabase.co
 *   SUPABASE_ANON_KEY               Chave "anon public" do Supabase. É PÚBLICA por natureza (o banco é protegido
 *                                   pelas regras de acesso/RLS): pode ficar aqui. NUNCA cole aqui a "service_role".
 *   WHATSAPP_RECRUTADOR             Número do recrutador com DDI+DDD, só dígitos (ex.: '5511999998888').
 *                                   Quando preenchido, aparece o botão "Enviar pelo WhatsApp".
 *   EMPRESA                         Nome da empresa exibido nas telas (opcional).
 *   MOSTRAR_RESULTADO_AO_CANDIDATO  true para o candidato ver o próprio perfil ao final.
 *   GRUPOS_DEMONSTRACAO             0 = desligado (padrão). Um número de 1 a 24 liga o modo demonstração:
 *                                   o candidato responde só esses primeiros grupos e os outros são
 *                                   preenchidos ao acaso.
 *                                   NÃO use no site real: o resultado com poucos grupos não vale como avaliação.
 *
 * As telas olham CONFIG.API_URL para saber se há servidor; por isso, no fim deste arquivo, BACKEND 'simulada'
 * vira API_URL 'simulada' e BACKEND 'supabase' vira API_URL = SUPABASE_URL (as chamadas vão pelo supabase-js).
 */
(function (root) {
  var CONFIG = {
    BACKEND: 'appsscript',
    API_URL: 'https://script.google.com/macros/s/AKfycbyg2ENrVTcvztZPOjJfpGc5ug4yIIxnco_AspnL4osjFr5_f1xsOqcJ8hPHzf5QEHybaQ/exec',
    SUPABASE_URL: 'https://tevpqngqzxcswmticjnr.supabase.co',
    SUPABASE_ANON_KEY: 'sb_publishable_8B735nOKFWn-CC8dYpr1sg_RQs5y_W-',
    WHATSAPP_RECRUTADOR: '',
    EMPRESA: '',
    MOSTRAR_RESULTADO_AO_CANDIDATO: false,
    GRUPOS_DEMONSTRACAO: 0   // NÃO use no site real: o resultado com poucos grupos não vale como avaliação.
  };
  var backend = String(CONFIG.BACKEND || '').trim().toLowerCase();
  if (backend === 'simulada') CONFIG.API_URL = 'simulada';
  else if (backend === 'supabase') CONFIG.API_URL = String(CONFIG.SUPABASE_URL || '').trim();
  if (typeof module !== 'undefined' && module.exports) module.exports = CONFIG;
  else root.CONFIG = CONFIG;
})(typeof self !== 'undefined' ? self : this);
