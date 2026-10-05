/*
 * Código de resultado: "DISC1." + base64url(JSON em UTF-8).
 * Usado como plano B quando não há backend: o candidato copia/envia o código
 * e o recrutador cola no painel admin para importar.
 */
(function (root) {
  var PREFIXO = 'DISC1.';
  var ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

  function utf8Encode(str) {
    if (typeof TextEncoder !== 'undefined') return Array.prototype.slice.call(new TextEncoder().encode(str));
    var bin = unescape(encodeURIComponent(str));
    var out = [];
    for (var i = 0; i < bin.length; i++) out.push(bin.charCodeAt(i));
    return out;
  }

  function utf8Decode(bytes) {
    if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes));
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return decodeURIComponent(escape(bin));
  }

  function bytesParaBase64url(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length; i += 3) {
      var b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2];
      var n = (b0 << 16) | ((b1 || 0) << 8) | (b2 || 0);
      out += ALFABETO[(n >> 18) & 63] + ALFABETO[(n >> 12) & 63];
      if (i + 1 < bytes.length) out += ALFABETO[(n >> 6) & 63];
      if (i + 2 < bytes.length) out += ALFABETO[n & 63];
    }
    return out;
  }

  function base64urlParaBytes(str) {
    // Aceita também base64 padrão (+ / =).
    str = str.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    if (/[^A-Za-z0-9\-_]/.test(str) || str.length % 4 === 1) throw new Error('Código de resultado inválido.');
    var bytes = [];
    var buf = 0, bits = 0;
    for (var i = 0; i < str.length; i++) {
      buf = (buf << 6) | ALFABETO.indexOf(str[i]);
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        bytes.push((buf >> bits) & 255);
      }
    }
    return bytes;
  }

  function encode(payload) {
    return PREFIXO + bytesParaBase64url(utf8Encode(JSON.stringify(payload)));
  }

  function decode(codigo) {
    var s = String(codigo == null ? '' : codigo).replace(/\s+/g, '');
    var idx = s.indexOf(PREFIXO);
    if (idx === -1) throw new Error('Código de resultado inválido: ele deve começar com "' + PREFIXO + '".');
    s = s.slice(idx + PREFIXO.length);
    if (!s) throw new Error('Código de resultado vazio.');
    var json;
    try {
      json = utf8Decode(base64urlParaBytes(s));
    } catch (e) {
      throw new Error('Código de resultado inválido ou incompleto. Verifique se ele foi copiado inteiro.');
    }
    try {
      return JSON.parse(json);
    } catch (e) {
      throw new Error('Código de resultado corrompido. Verifique se ele foi copiado inteiro.');
    }
  }

  var DISC_CODEC = { PREFIXO: PREFIXO, encode: encode, decode: decode };
  if (typeof module !== 'undefined' && module.exports) module.exports = DISC_CODEC;
  else root.DISC_CODEC = DISC_CODEC;
})(typeof self !== 'undefined' ? self : this);
