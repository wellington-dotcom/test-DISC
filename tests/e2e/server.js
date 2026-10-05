'use strict';
// Servidor estático mínimo (sem dependências) para os testes E2E e para testar localmente:
//   node tests/e2e/server.js   ->  http://localhost:4173
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '..', '..');
const PORTA = Number(process.env.PORT) || 4173;
const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.md': 'text/plain; charset=utf-8'
};

const servidor = http.createServer((req, res) => {
  let caminho;
  try { caminho = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch (e) { caminho = '/'; }
  if (caminho === '/') caminho = '/index.html';
  if (caminho === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  const arquivo = path.normalize(path.join(RAIZ, caminho));
  if (!arquivo.startsWith(RAIZ + path.sep) || /[\\/](node_modules|\.git)([\\/]|$)/.test(arquivo)) {
    res.writeHead(403); res.end('Proibido'); return;
  }
  fs.readFile(arquivo, (erro, dados) => {
    if (erro) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Não encontrado'); return; }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(arquivo)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(dados);
  });
});

servidor.listen(PORTA, () => console.log('Servidor de teste em http://localhost:' + PORTA));
