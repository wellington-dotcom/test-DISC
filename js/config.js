/*
 * Configuração do sistema DISC — edite aqui antes de publicar.
 *
 *   API_URL                         URL do Web App do Google Apps Script (termina em /exec).
 *                                   Deixe vazio para funcionar sem backend: o candidato recebe
 *                                   um código de resultado para enviar ao recrutador.
 *   WHATSAPP_RECRUTADOR             Número do recrutador com DDI+DDD, só dígitos (ex.: '5511999998888').
 *                                   Quando preenchido, aparece o botão "Enviar pelo WhatsApp".
 *   EMPRESA                         Nome da empresa exibido nas telas (opcional).
 *                                   Use 'simulada' só na prévia/demonstração: as respostas ficam neste
 *                                   navegador (js/api-simulada.js), sem planilha de verdade.
 *   MOSTRAR_RESULTADO_AO_CANDIDATO  true para o candidato ver o próprio perfil ao final.
 *   GRUPOS_DEMONSTRACAO             0 = desligado (padrão). Um número de 1 a 24 liga o modo demonstração:
 *                                   o candidato responde só esses primeiros grupos e os outros são
 *                                   preenchidos ao acaso.
 *                                   NÃO use no site real: o resultado com poucos grupos não vale como avaliação.
 */
(function (root) {
  var CONFIG = {
    API_URL: 'https://script.google.com/macros/s/AKfycbyg2ENrVTcvztZPOjJfpGc5ug4yIIxnco_AspnL4osjFr5_f1xsOqcJ8hPHzf5QEHybaQ/exec',
    WHATSAPP_RECRUTADOR: '',
    EMPRESA: '',
    MOSTRAR_RESULTADO_AO_CANDIDATO: false,
    GRUPOS_DEMONSTRACAO: 0   // NÃO use no site real: o resultado com poucos grupos não vale como avaliação.
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = CONFIG;
  else root.CONFIG = CONFIG;
})(typeof self !== 'undefined' ? self : this);
