/*
 * Configuração do sistema DISC — edite aqui antes de publicar.
 *
 *   API_URL                         URL do Web App do Google Apps Script (termina em /exec).
 *                                   Deixe vazio para funcionar sem backend: o candidato recebe
 *                                   um código de resultado para enviar ao recrutador.
 *   WHATSAPP_RECRUTADOR             Número do recrutador com DDI+DDD, só dígitos (ex.: '5511999998888').
 *                                   Quando preenchido, aparece o botão "Enviar pelo WhatsApp".
 *   EMPRESA                         Nome da empresa exibido nas telas (opcional).
 *   MOSTRAR_RESULTADO_AO_CANDIDATO  true para o candidato ver o próprio perfil ao final.
 */
(function (root) {
  var CONFIG = {
    API_URL: '',
    WHATSAPP_RECRUTADOR: '',
    EMPRESA: '',
    MOSTRAR_RESULTADO_AO_CANDIDATO: false
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = CONFIG;
  else root.CONFIG = CONFIG;
})(typeof self !== 'undefined' ? self : this);
