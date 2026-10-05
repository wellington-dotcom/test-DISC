# Teste DISC — sistema de seleção

Site estático (HTML/CSS/JS puro, sem build) + backend Google Apps Script. Contrato técnico: `docs/SPEC.md`.

## Marca (quem é o dono do produto)
- O sistema e o produto DISC são da **Gestão sem Caos** (consultoria). **Notus** é a agência de marketing que fez o design.
- Em todo texto que cliente, candidato, colaborador ou contratante vê: "Gestão sem Caos". Nunca "Notus" / "Notus Agência" em tela ou relatório.
- A paleta e os componentes abaixo continuam valendo (é o sistema visual). O **logo oficial da Gestão sem Caos** está em `assets/marca/` (horizontal colorida, negativa para fundo azul-escuro, preta para moldura laranja, símbolo e favicons); quando usar cada um: `docs/IDENTIDADE-VISUAL.md`, seção Logo. A estrela `assets/icone.svg` é da Notus: não usar em nenhuma tela pública.

## Visual — identidade Notus (obrigatório)
Siga `docs/IDENTIDADE-VISUAL.md` à risca (identidade nova out/2026: laranja `#F34405` + azul-escuro `#13283F`) e use as peças de `assets/notus.css` e o logo de `assets/marca/` (não crie cores/estilos fora dos tokens). A identidade antiga amarelo+preto foi substituída.
Referência viva: `theROCCO-data/bi-isabella-eleuterio` (cópia: `wellington-dotcom/bi-isabella-eleuterio`, branch `ajuste/reestruturacao-visual`).

## Celular × computador
- Celular é prioridade só para quem RESPONDE (teste, pesquisa, avaliação) e para quem LÊ o relatório.
- O painel (edição, cadastros, organograma, relatórios, configuração) é para computador; não gaste esforço com versão móvel dele.

## Fluxo de trabalho com o dono do projeto
- Mudanças visuais: publicar primeiro uma **prévia (artefato)** para ele ver; **só fazer push depois que ele aprovar**.
- Testes: `npm test` (unidade) e `npm run test:e2e` (Playwright). Não quebre os seletores usados em `tests/e2e`.
