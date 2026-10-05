# Identidade visual Notus

Padrão de todos os sistemas da Notus. A referência viva é o BI da Clínica Isabella Eleutério
(`wellington-dotcom/bi-isabella-eleuterio`: `frontend/src/index.css`, `componentes/ui.tsx`, `componentes/caixas.tsx`, `paginas/Login.tsx`).
Neste projeto, as peças prontas estão em `assets/notus.css`: **use as classes de lá em vez de criar estilos novos.**

## Regras (seguir à risca)

1. **Celular primeiro (375px).** Sem rolagem lateral, nenhum texto pode estourar a caixa e os campos de digitação ficam com **16px** no celular (evita o zoom do iPhone). Confira no tamanho de celular antes de publicar.
2. **Branco dominante.** O fundo da página é `#f4f4f2` e as caixas são brancas. O **amarelo Notus `#ffda00`** e o **preto `#131313`** aparecem só em caixas pontuais de destaque.
3. **Fonte: Plus Jakarta Sans** (variável, fica em `assets/fonts`). Títulos com peso 500 e letras um pouco mais juntas; nada de negrito pesado.
4. **Fundos de caixa:** `normal` (branca), `preta` ou `amarela` (cor única; é o destaque preferido) e `gradiente` (brilho amarelo sobre preto). **No máximo um gradiente por tela**, usado para quebrar o visual.
5. **Amarelo nunca é cor de texto sobre fundo branco** (o contraste fica ruim). Texto sobre amarelo usa preto ou `#5c4a00`.
6. **Formas:** caixas com cantos de 24px, botões e selos em **pílula** e campos com cantos de 12px. Separação entre caixas por espaço, sem bordas pesadas nem sombras, exceto em menus suspensos.
7. **Botões:** o principal é **preto** e o de destaque é **amarelo** (um por tela). Os secundários são brancos com borda `#e8e7e2`. O de perigo é branco com texto vermelho.
8. **Gráficos aprovados:** cartões empilhados (1º preto, 2º amarelo, demais brancos), anel com etiqueta de vidro e barras. O que ainda falta numa barra aparece **hachurado** (listras diagonais), e a posição atual é marcada com uma **bolinha de vidro**. **Bolhas ou círculos sobrepostos foram rejeitados.**
9. **Sem `<select>` nativo:** use um seletor em pílula com lista própria.
10. **Login e telas de entrada:** metade amarela com brilho, com o quadradinho preto como marca e uma frase curta de impacto; a outra metade é preta, com os campos em `#1c1c1c`. No celular, as duas partes ficam empilhadas.
11. **Animação discreta:** só a entrada `surgir` (0,45s). Sempre respeite `prefers-reduced-motion`.
12. **Cores de categoria** (quando há várias séries): preto, amarelo, cinza claro `#cfcec8` e hachurado escuro, nessa ordem, como no anel do BI. No DISC: **D preto, I amarelo, S cinza, C hachurado**. A letra fica sempre escrita ao lado, para não depender só da cor.

## Tokens

| Token | Valor | Uso |
|---|---|---|
| `--fundo` | `#f4f4f2` | fundo da página |
| `--tinta` | `#131313` | texto, botão principal, caixa preta |
| `--notus` | `#ffda00` | destaque, caixa amarela, marca |
| `--notus-escuro` | `#5c4a00` | texto secundário sobre amarelo |
| `--linha` | `#e8e7e2` | bordas de campos e botões claros |
| `--suave` | `#888780` | texto de apoio |
| `--medio` | `#5f5e5a` | texto secundário |
| `--raio-caixa` | `24px` | caixas |

Tamanhos de texto mais usados no BI: 11, 12 e 13px para apoio e rótulos, 15px para títulos de caixa e 28 a 30px para o título da página (até 48px em telas de entrada).
