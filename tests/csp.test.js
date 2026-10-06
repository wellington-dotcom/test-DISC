// Política de segurança (CSP) das páginas que recebem pagamento: o <script> inline precisa bater com o sha256 da
// política (senão o navegador o bloqueia em silêncio) e o Stripe precisa estar liberado (script, iframe, API e QR do Pix).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PAGINAS = ['index.html', 'meu-relatorio.html'];

function politica(html) {
  const m = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html);
  if (!m) return null;
  const dir = {};
  m[1].split(';').map((x) => x.trim()).filter(Boolean).forEach((x) => { const p = x.split(/\s+/); dir[p[0]] = p.slice(1); });
  return dir;
}

for (const nome of PAGINAS) {
  test('CSP de ' + nome + ': scripts inline com hash certo, Stripe liberado, nada de unsafe-inline/eval em script', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', nome), 'utf8');
    const csp = politica(html);
    assert.ok(csp, 'falta a meta Content-Security-Policy');
    assert.ok(html.indexOf('Content-Security-Policy') < html.indexOf('<script'), 'a política vem antes de qualquer script');
    const script = csp['script-src'];
    assert.ok(!script.includes("'unsafe-inline'") && !script.includes("'unsafe-eval'"));
    const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => "'sha256-" + crypto.createHash('sha256').update(m[1]).digest('base64') + "'");
    for (const h of inline) assert.ok(script.includes(h), 'o <script> inline mudou: atualize o hash na CSP de ' + nome + ' para ' + h);
    assert.equal(script.filter((x) => x.startsWith("'sha256-")).length, inline.length, 'hash sobrando na CSP');
    for (const [d, v] of [['script-src', 'https://js.stripe.com'], ['frame-src', 'https://js.stripe.com'], ['frame-src', 'https://hooks.stripe.com'],
      ['connect-src', 'https://api.stripe.com'], ['connect-src', 'https://*.supabase.co'], ['img-src', 'https://*.stripe.com'], ['img-src', 'data:']]) {
      assert.ok((csp[d] || []).includes(v), d + ' sem ' + v);
    }
    assert.deepEqual(csp['object-src'], ["'none'"]);
    // Nenhum script externo fora do próprio site (o Stripe.js entra dinamicamente, liberado acima).
    for (const m of html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)) assert.ok(!/^(https?:)?\/\//.test(m[1]), m[1]);
  });
}

test('CSP: a URL de cada backend em js/config.js está liberada no connect-src', () => {
  const cfg = fs.readFileSync(path.join(__dirname, '..', 'js', 'config.js'), 'utf8');
  const csp = politica(fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8'));
  const sup = /SUPABASE_URL: '(https:\/\/[a-z0-9]+)\.supabase\.co'/.exec(cfg);
  assert.ok(sup && csp['connect-src'].includes('https://*.supabase.co'));
  if (/API_URL: 'https:\/\/script\.google\.com/.test(cfg)) assert.ok(csp['connect-src'].includes('https://script.google.com'));
});
