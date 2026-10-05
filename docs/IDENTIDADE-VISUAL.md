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

1. **Celular primeiro (375px):** sem rolagem lateral, nenhum texto pode estourar a caixa e os campos de digitação ficam com **16px** no celular.
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
