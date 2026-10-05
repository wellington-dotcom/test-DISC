#!/usr/bin/env node
// Gera js/fixture-processo-exemplo.js (global DISC_FIXTURE_PROCESSO) a partir de
// tests/fixtures/processo-exemplo.json, para a prévia (API simulada) usar no navegador sem fetch.
//   node scripts/montar-fixture.mjs           -> grava o .js
//   node scripts/montar-fixture.mjs --checar  -> só confere; sai com código 1 se o .js estiver desatualizado
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const ORIGEM = join(raiz, 'tests', 'fixtures', 'processo-exemplo.json');
const DESTINO = join(raiz, 'js', 'fixture-processo-exemplo.js');

export function montarConteudo(json) {
  const dados = JSON.parse(json); // valida o JSON e normaliza a formatação
  return '// ARQUIVO GERADO AUTOMATICAMENTE — NÃO EDITE.\n' +
    '// Cópia de tests/fixtures/processo-exemplo.json (dados fictícios) para a prévia. Para atualizar: npm run montar:fixture\n' +
    '(function (root) {\n' +
    '  var DISC_FIXTURE_PROCESSO = ' + JSON.stringify(dados, null, 2).replace(/\n/g, '\n  ') + ';\n' +
    "  if (typeof module !== 'undefined' && module.exports) module.exports = DISC_FIXTURE_PROCESSO;\n" +
    '  else root.DISC_FIXTURE_PROCESSO = DISC_FIXTURE_PROCESSO;\n' +
    "})(typeof self !== 'undefined' ? self : this);\n";
}

const executadoDireto = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (executadoDireto) {
  const esperado = montarConteudo(readFileSync(ORIGEM, 'utf8'));
  if (process.argv.includes('--checar')) {
    const atual = existsSync(DESTINO) ? readFileSync(DESTINO, 'utf8') : null;
    if (atual !== esperado) {
      console.error('js/fixture-processo-exemplo.js está desatualizado em relação a tests/fixtures/processo-exemplo.json. Rode: npm run montar:fixture');
      process.exit(1);
    }
    console.log('js/fixture-processo-exemplo.js em dia com tests/fixtures/processo-exemplo.json.');
  } else {
    writeFileSync(DESTINO, esperado);
    console.log('js/fixture-processo-exemplo.js gerado a partir de tests/fixtures/processo-exemplo.json.');
  }
}
