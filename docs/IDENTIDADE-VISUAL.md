# Identidade visual Notus (out/2026)

Padrão de todos os sistemas da Notus. Fonte da verdade: o BI da Clínica Isabella Eleutério
(`theROCCO-data/bi-isabella-eleuterio`; cópia em `wellington-dotcom/bi-isabella-eleuterio`, branch `ajuste/reestruturacao-visual`),
nos arquivos `frontend/src/index.css`, `lib/cores.ts`, `componentes/ui.tsx`, `componentes/caixas.tsx`, `componentes/Logo.tsx`, `paginas/Login.tsx` e no `CLAUDE.md`, seção Visual.
Neste projeto, as peças prontas estão em `assets/notus.css` e o logo em `assets/icone.svg`. **Use essas peças em vez de criar estilos novos.**

> A identidade antiga (amarelo `#ffda00` + preto) foi **substituída**. Não use mais.

## Paleta (só estas cores)

| Token | Cor | Papel |
|---|---|---|
| `--notus` | `#F34405` laranja principal | **"olhe aqui"**: item selecionado, número de destaque, card em foco, alerta. **Nunca** como série de gráfico nem para indicar "piorou". |
| `--laranja` | `#F2762E` laranja médio | 2ª série quando é linha |
| `--ambar` | `#FF9F40` âmbar | 2ª série quando é preenchimento; texto de destaque sobre azul-escuro |
| `--ardosia` | `#324E73` azul acinzentado | superfícies escuras secundárias, séries |
| `--tinta` | `#13283F` azul-escuro | texto, botão principal, moldura (login, menu) |
| `--preto` | `#141414` | texto sobre o laranja |
| `--fundo` | `#F2F2F2` cinza claro | fundo da página; os cards são brancos |

Tons funcionais permitidos:
- `--notus-forte` `#C43803`: texto pequeno em laranja sobre fundo claro.
- `--nevoa` `#EAEEF4`: card suave.
- `--linha` `#E2E6EC`.
- `--suave` `#6B7586`.
- `--medio` `#46546A`.
- `--trilho` `#E9ECEF`.
- `--ardosia-clara` `#8A97AB`, `--ardosia-media` `#5D7699` e `--cinza-claro` `#C5CCD6`.
- Vermelho e verde só para indicar erro e sucesso.

## Regras (seguir à risca)

1. **Onde vale o celular primeiro (375px):** só no que o participante usa — responder o teste/pesquisa/avaliação (`index.html`) e ler o relatório (`relatorio.html`). Ali: sem rolagem lateral, nenhum texto pode estourar a caixa e os campos de digitação ficam com **16px** no celular.
   **Painel (`admin.html`) é feito para o computador** (decisão do dono, out/2026): edição, cadastros, organograma, geração de relatórios e configurações são pensados para tela de computador (a partir de ~1024px). No celular o painel não precisa ser otimizado; basta não quebrar (nada de investir em gestos de toque ou layouts móveis para tarefas de edição).
2. **Minimalista:** nada de bloco de cor sólida em card ou área de informação. Os fundos de card permitidos são:
   - **branco**;
   - **suave**: `--nevoa`;
   - **destaque**: branco com contorno laranja leve e o número em laranja;
   - **vidro**: brilho quente discreto, **só um por tela**.
3. **Moldura pode ter cor:** login, tela de entrada e menu usam o laranja e o azul-escuro, porque são moldura e não informação. A entrada tem metade laranja, com brilho e o logo, e metade azul-escura com os campos.
4. **Contraste:** o laranja principal **nunca** aparece como texto pequeno sobre fundo claro; nesse caso use `--notus-forte`. Texto sobre o laranja usa `#141414`. Texto pequeno de destaque sobre o azul-escuro usa âmbar.
5. **Fonte:** Plus Jakarta Sans, só com a escala abaixo e **três pesos**: normal, seminegrito (títulos de card) e negrito (números de destaque grandes). Rótulos e descrições vão menores e em cinza (`--suave`).
   - Escala: eixo 11 · nota 12 · rótulo 13 · corpo 15 · título 18 · indicador 24 · página 28 · número 32 · número grande 44 · campo 16.
6. **Algarismos de largura fixa** (`tabular-nums`) em tabelas, listas e eixos. No número grande, não.
7. **Barras:** a parte feita fica preenchida em azul-escuro e o que falta fica num **trilho liso cinza-claro** (`--trilho`). A posição atual é marcada com uma **bolinha de vidro claro**. **Nada de listras ou hachuras** em barra, anel ou gráfico.
8. **Séries de gráfico, nesta ordem:** azul-escuro, âmbar, azul acinzentado claro, azul acinzentado, laranja médio. O laranja principal fica fora. **No DISC: D azul-escuro, I âmbar, S azul acinzentado claro, C azul acinzentado**, sempre com a letra escrita ao lado.
9. **Botões em pílula:**
   - o principal é azul-escuro;
   - o de destaque é laranja, com texto `#141414`, um por tela;
   - o secundário é `claro` (branco com borda) ou `contorno` (borda laranja e texto `--notus-forte`);
   - o de perigo é branco com texto vermelho.
   Escreva os botões com só a primeira letra maiúscula ("Salvar alterações").
10. **Vidro fosco:** em cabeçalhos e barras. Janelas que abrem por cima de dados ficam **quase opacas** (97%).
11. **Logo:** a estrela com a seta (`assets/icone.svg`). Use sempre o desenho original, com as cores do próprio ícone; não recolorir nem distorcer.
12. **Formatos aprovados:** cartões empilhados, anel com etiqueta de vidro e barras. **Bolhas ou círculos sobrepostos estão proibidos.**
13. **Sem `<select>` nativo e sem `confirm`/`prompt` do navegador:** use o seletor em pílula e a confirmação dentro da página.
14. **Respiro:** cards com padding de 24px no celular e 28px no computador, e cantos de 24px.
15. **Nada pula de lugar:** ao interagir, os elementos não podem trocar de posição de repente nem empurrar os botões. Movimento só animado e quando a pessoa pede (por exemplo, ao arrastar).
16. **Animação:** só a entrada `surgir` (0,45s) e as transições curtas. Sempre respeite `prefers-reduced-motion`.

## Documentos (relatórios e manuais)

Variante **editorial** da identidade, só para documentos de leitura que vão para o cliente (hoje: o relatório público do processo seletivo, `relatorio.html` + `assets/relatorio.css` + `js/relatorio-view.js`). Telas do sistema (candidato e painel) continuam com as regras acima, sem exceção.

- **Papel:** fundo creme `#F5F1EA` (`--papel`); páginas de apoio (índice) em `#ECE5D8` (`--creme`); fios `#D6CFC1` (`--linha-doc`); rótulos `#6B6960` (`--mudo`). Cartões de conteúdo são brancos com fio, cantos de 2px (jeito de documento impresso).
- **Cores da marca:** azul-escuro `#13283F` (texto, capa, encerramento, cartão de recomendação), laranja médio `#F2762E` (divisores de seção, número de destaque grande), laranja principal `#F34405` só como "olhe aqui" (selo "aderência ideal", contorno de destaque), âmbar `#FF9F40` (2ª série e destaque sobre o azul-escuro), azul `#324E73`. Texto pequeno em laranja sobre o papel usa `--notus-forte`. Verde e vermelho só para "aprovado"/erro.
- **Moldura pode ser cor cheia:** capa, divisores de seção ("01 Sumário executivo"), cartão da recomendação e encerramento são moldura do documento, não área de dado. Dentro das seções, o conteúdo segue minimalista (cartões brancos, barras com trilho liso, sem listras/hachuras).
- **Fontes do documento** (locais em `assets/fonts`, licença OFL, só latin e latin-ext): **Bricolage Grotesque** nos títulos e números, **Instrument Sans** no texto, **Instrument Serif itálico** nos destaques (abertura de seção, encerramento), **JetBrains Mono** nos rótulos pequenos em caixa alta. Pesos 400, 500, 600 e 700.
- **Escala do documento** (px, via tokens `--f-*`): 11 · 12 · 13 · 15 · 16 · 18 · 20 · 22 · 24 · 28 · 32 · 40 · 44 · 56 · 64 · 72 · 96 · 120 · 160. Os grandes ficam para capa, divisores e o score final; no celular os tokens encolhem.
- **Estrutura:** capa (título, cliente, consultoria, período, números grandes, líder), índice, seções numeradas 01–06 com divisor, cabeçalho de página em mono ("01 · SUMÁRIO EXECUTIVO ——"), rodapé com o logo, o consultor e "Notus Agência".
- **Gráficos:** barras e colunas em SVG/CSS, feito em azul-escuro e trilho liso; DISC com as cores e letras de sempre (D azul-escuro, I âmbar, S azul acinzentado claro, C azul acinzentado).
- **Celular primeiro (375px)** sem rolagem lateral (tabelas largas viram cartões) e **impressão A4** limpa: capa em página inteira, cada seção começa em página nova, cores preservadas, cartões não quebram no meio.
- **Privacidade no documento:** nomes como "Primeiro nome + inicial"; nunca telefone, e-mail ou dados sensíveis. Idade só como faixa agregada do público, nunca por candidato nem como critério.
- `scripts/checar-visual.mjs` confere `assets/relatorio.css` e `js/relatorio-view.js` com esta paleta e esta escala.
