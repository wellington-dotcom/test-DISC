# Teste DISC — sistema de seleção

Site estático (HTML/CSS/JS puro, sem build) + backend Google Apps Script. Contrato técnico: `docs/SPEC.md`.

## Visual — identidade Notus (obrigatório)
Siga `docs/IDENTIDADE-VISUAL.md` à risca e use as peças de `assets/notus.css` (não crie cores/estilos fora dos tokens).
Referência viva: repositório `wellington-dotcom/bi-isabella-eleuterio`.

## Fluxo de trabalho com o dono do projeto
- Mudanças visuais: publicar primeiro uma **prévia (artefato)** para ele ver; **só fazer push depois que ele aprovar**.
- Testes: `npm test` (unidade) e `npm run test:e2e` (Playwright). Não quebre os seletores usados em `tests/e2e`.
