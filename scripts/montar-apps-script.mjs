#!/usr/bin/env node
// Copia o motor do relatório (js/relatorio-motor.js) para o Apps Script (apps-script/RelatorioMotor.gs),
// para o servidor gerar o rascunho com o MESMO código do site.
//   node scripts/montar-apps-script.mjs           -> grava o .gs
//   node scripts/montar-apps-script.mjs --checar  -> só confere; sai com código 1 se o .gs estiver desatualizado
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const ORIGEM = join(raiz, 'js', 'relatorio-motor.js');
const DESTINO = join(raiz, 'apps-script', 'RelatorioMotor.gs');

const CABECALHO =
  '// ARQUIVO GERADO AUTOMATICAMENTE — NÃO EDITE.\n' +
  '// Cópia de js/relatorio-motor.js. Para atualizar, edite o original e rode: npm run montar:apps-script\n\n';

function montarConteudo() {
  return CABECALHO + readFileSync(ORIGEM, 'utf8');
}

const esperado = montarConteudo();
if (process.argv.includes('--checar')) {
  const atual = existsSync(DESTINO) ? readFileSync(DESTINO, 'utf8') : null;
  if (atual !== esperado) {
    console.error('apps-script/RelatorioMotor.gs está desatualizado em relação a js/relatorio-motor.js. Rode: npm run montar:apps-script');
    process.exit(1);
  }
  console.log('apps-script/RelatorioMotor.gs em dia com js/relatorio-motor.js.');
} else {
  writeFileSync(DESTINO, esperado);
  console.log('apps-script/RelatorioMotor.gs gerado a partir de js/relatorio-motor.js.');
}
