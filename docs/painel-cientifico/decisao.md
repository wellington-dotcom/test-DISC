# Decisão do painel: Relatório de Equipe avançado e Pesquisa de Clima

**Moderação:** psicologia organizacional, psicometria e compliance · **Data:** 10/10/2026
**Base:** pareceres `psicometria.md` (**Psi**), `equipes.md` (**Eq**) e `etica.md` (**Ét**), mais a leitura do código em `/home/user/test-DISC`: `docs/SPEC.md`, `js/relatorio-modelos.js` (função `equipe`) e `js/compatibilidade.js`. Para conferir pontos específicos também foram lidos `js/relatorio-view.js`, `js/relatorio-motor.js`, `js/scoring.js` e `js/admin.js`.
**Não é parecer jurídico nem psicológico.** O moderador não fez busca nova. As evidências vêm dos três pareceres e mantêm as marcas deles. O que o moderador decidiu ou conferiu no código tem marca própria.

### Marcas usadas

| Marca | Significado | Equivalência nos pareceres |
|---|---|---|
| **[V]** | verificado em fonte primária ou oficial por algum especialista | Psi [V], Eq [V], Ét [V] |
| **[S]** | confirmado só em fonte secundária | Psi [S], Eq [V-sec], Ét [V2] |
| **[M]** | de memória: verificar antes de usar em texto para cliente | [M] nos três |
| **[C]** | cálculo reprodutível | Psi [C] |
| **[I]** | interpretação ou recomendação de especialista; não é norma | Ét [I], Psi [R] |
| **[Mod]** | decisão ou julgamento do moderador | (novo) |
| **[Cód]** | conferido pelo moderador no código do repositório | (novo) |

Quem afirmou aparece entre parênteses: (Psi), (Eq), (Ét). Quando dois especialistas marcaram a mesma afirmação de forma diferente, aparecem as duas marcas, por exemplo [V Psi / S Ét].

---

## 1. Resumo para o dono

1. **A Pesquisa de Clima vai ao ar com perguntas próprias da Gestão sem Caos.** São 25 perguntas, cerca de 5 minutos no celular, escritas a partir de temas com boa pesquisa científica por trás: liberdade para falar, clareza de metas, confiança, conflitos, aprender com erros, apoio do líder e carga de trabalho. Não depende de licença de ninguém.
2. **Não chamamos a pesquisa de "validada", "laudo" nem "conformidade NR-1".** Para a NR-1, ela ajuda a empresa a identificar problemas e a ouvir os funcionários. Quem fecha o programa de riscos (PGR) é o responsável técnico da empresa.
3. **Ninguém vê a resposta de ninguém, nem quem respondeu.** Um grupo só aparece com 5 respostas ou mais. Detalhes, comentários e temas delicados exigem 10 ou mais. Empresa com menos de 5 respondentes não faz a pesquisa.
4. **Não há perguntas de saúde** (esgotamento, ansiedade, sintomas). Isso é dado sensível e exige profissional de saúde.
5. **O relatório de equipe atual perde a "Harmonia X/100", o "Fulano e Beltrano em tensão" e o "Encaixe do candidato /100".** São números sem base científica e podem levar a decisões injustas sobre pessoas. O DISC continua, como linguagem comum da equipe.
6. **Em paralelo, você pede autorização por escrito** para usar dois questionários científicos com versão brasileira: o COPSOQ II (para a NR-1) e a escala de segurança psicológica. Os e-mails estão prontos na seção 3.2. Se autorizarem, trocamos.
7. **O maior risco do negócio hoje não está no clima: está em usar o DISC para escolher candidatos sem psicólogo responsável** (Lei 4.119/62). Recomendo ter um(a) psicólogo(a) como responsável técnico(a) ou tirar o DISC da etapa de seleção.
8. **O que você precisa fazer:** (a) decidir o que fazer com o DISC em seleção (seção 7); (b) enviar os e-mails de autorização; (c) contratar advogado(a) de LGPD/trabalho e psicólogo(a) com CRP para revisar perguntas e textos antes de vender; (d) aprovar a prévia visual das mudanças no relatório antes da publicação.

---

## 2. Ata do debate

### 2.1 Quadro de votos

| # | Ponto | Psi | Eq | Ét | Decisão | Voto vencido |
|---|---|---|---|---|---|---|
| P1 | Instrumento do clima / NR-1 | COPSOQ II-Br curto | itens próprios + Edmondson + carga do COPSOQ | itens próprios; COPSOQ só com confirmação escrita | Trilha A (própria) agora; COPSOQ II-Br na Trilha B | Psi (em parte) |
| P2 | Segurança psicológica | Edmondson BR com permissão; sem permissão, dimensões do COPSOQ | Edmondson, 7 itens | itens próprios sobre o construto | bloco próprio na Trilha A; Edmondson BR na Trilha B | Psi (plano sem permissão); Eq (uso literal já) |
| P3 | Mínimo de respondentes: 5 × 10 | 5; 10 para temas sensíveis | 5 para tudo | 5 para médias; 10 para distribuição, comentários e recortes | 5 para faixa e escore; 10 para o resto | Eq; Psi (distribuição com 5) |
| P4 | Dono vê o clima por equipe | sim, sem ranking | sim, mapa de calor | sim, com k ≥ 5 | sim, ordem fixa e sem ranking | nenhum |
| P5 | "Harmonia X/100" e "pares em tensão" | sem afirmação causal | tirar do sumário; manter "como conduzir" | sem alegação sem prova nem rótulo | tirar números e "tensão" de todo o relatório | nenhum (o moderador amplia) |
| P6 | DISC ipsativo no relatório de equipe | média ipsativa é problemática; só hipótese | manter como vocabulário, sem números | DISC nominal permitido com aviso; nunca cruzar com clima individual | manter estilos (contagem); tirar médias | nenhum |
| P7 | Itens de saúde/esgotamento | só os do COPSOQ, no nível da empresa, n ≥ 10 | 1 item de frequência de esgotamento | não perguntar: é dado de saúde | nenhum na Trilha A; na Trilha B só com condições | Eq |
| P8 | Comparação líder × equipe | líder vê a própria resposta ao lado da média, n ≥ 5 | só para líder e consultor | não se opôs | aprovada com condições | nenhum |
| P9 | Comentários abertos | sem pergunta aberta na equipe | 1 aberta; trechos ao líder | só temas, k ≥ 10 | 1 aberta opcional; só temas, k ≥ 10 | Eq |
| P10 | Faixas de leitura | 3 faixas por terços | 4 faixas (forte a crítico) | "pontos de atenção" | 3 faixas com cortes pela âncora da escala | Eq (4 faixas); Psi (terços) |
| P11 | Reaplicação | anual + pulso de 3 a 6 meses | 6 meses + pulso aos 60 dias; depois anual + trimestral | não tratou | 0 → 60 dias → 6 meses → anual; pulso a cada 3 a 6 meses | nenhum |
| P12 | Link, anonimato, armazenamento | sem `pessoa_id`; "confidencial" ≠ "anônimo" | link separado, token de equipe | definições e textos de anônimo × confidencial | link coletivo por equipe (anônimo) como padrão | nenhum |
| P13 | "Encaixe do candidato" e "pressão" por pessoa | não debatido | risco de "trocar a pessoa C" | sem ranking nem aderência automática | tirar a nota de encaixe; "pressão" vira descrição | nenhum (ponto do moderador) |

### 2.2 Pontos em detalhe

**P1. Instrumento do clima e da ponte com a NR-1**
- **Psi.**
  - O COPSOQ II-Br curto (Gonçalves, Moriguchi, Chaves & Sato, 2021, *Rev Saúde Pública* 55:69) [V] é o único candidato que cumpre as quatro restrições ao mesmo tempo: validação brasileira, uso comercial gratuito seguindo as diretrizes da rede [V Psi], tamanho e cobertura da NR-1.
  - Limites reconhecidos pelo próprio Psi: cerca de 40 itens na versão curta internacional [S] (número exato da BR a verificar), itens com referente individual e escalas de saúde.
- **Eq.** Questionário curto de 24 a 27 itens em 7 blocos: Edmondson completo e um bloco de carga tirado do COPSOQ II-Br. A licença do COPSOQ ficou como [M].
- **Ét.**
  - Considera o COPSOQ o "melhor candidato para o módulo NR-1". Porém a licença CC BY-NC-ND parece conflitar com o uso comercial, e as diretrizes pedem contato com a equipe nacional antes de adaptar [S Ét].
  - Para Ét, o caminho padrão seguro são itens próprios inspirados nos construtos, sem afirmar equivalência a nenhum instrumento.
- **Resolução [Mod].** O lançamento usa a **Trilha A** (itens próprios). A **Trilha B** usa o COPSOQ II-Br íntegro, num momento separado e anual, e só entra quando a rede e a equipe brasileira confirmarem por escrito.
- **Motivo.**
  1. Mesmo com a declaração da rede [V Psi], só uma confirmação escrita resolve três pontos: o conflito com a cláusula NC, se as escalas de saúde podem ser omitidas sem perder o nome e quantos itens tem a versão BR.
  2. Cerca de 40 itens estouram o orçamento de 30 e o tempo de resposta no celular.
  3. O COPSOQ pergunta sobre a experiência individual. O próprio Psi diz que a média da equipe vira "% de expostos" (modelo aditivo), enquanto o produto principal é o relatório **de equipe**, que pede referente coletivo.
  4. Pedir a confirmação custa um e-mail.
- **Voto vencido: Psi, em parte.** Registro: "Itens próprios sem validação são mais fracos que um instrumento validado. A Trilha A só é aceitável com a palavra 'validado' proibida e com plano de validação obrigatório." As duas condições foram incorporadas (seções 3.1.10 e 6.4).

**P2. Segurança psicológica**
- **Psi.**
  - Usar a escala de Edmondson (1999) na versão brasileira de Ramalho & Porto (2021, *Psico-USF* 26(1)) [V]: α = 0,84, CFI = 0,995, ICC(1) = 0,195 [V]. A amostra é só feminina [V].
  - Só com permissão escrita de Edmondson e das autoras brasileiras.
  - Sem permissão, "não criar itens parecidos e chamá-los de validados" e usar dimensões do COPSOQ.
- **Eq.** Usar os 7 itens de Edmondson (proposta de acordo D1).
- **Ét.**
  - Não usar literalmente sem autorização escrita. Escrever itens próprios sobre o construto, citando Edmondson.
  - A escala foi a de relato menos rigoroso entre 5 medidas numa meta-análise [S].
  - Ét registrou "versão PT-BR não confirmada". Psi e Eq localizaram a versão brasileira [V], e essa divergência de fato fica resolvida a favor da existência da versão BR.
- **Resolução.** Na Trilha A entra o bloco próprio "Liberdade para falar" (5 itens, referente "nesta equipe"). A versão BR literal fica na Trilha B.
- **Motivo.**
  - O direito autoral protege o texto, não o construto (Lei 9.610/98, art. 8º I e art. 29 IV [S Ét]).
  - A alternativa do Psi (dimensões do COPSOQ) também depende de confirmação escrita e mede experiência individual, não o clima da equipe.
  - A preocupação do Psi fica atendida porque o bloco **nunca** será chamado de validado nem de "escala de Edmondson".
- **Votos vencidos:** Psi (alternativa sem permissão); Eq (uso literal imediato).
- **Nota do moderador.** Os itens da seção 3.1 foram escritos por alguém que conhece os originais. Por isso a checagem de não semelhança por um psicólogo é obrigatória antes de ir ao ar (3.1.9).

**P3. Tamanho mínimo: 5 × 10**
- **Psi.** Piso duro de n ≥ 5 por recorte. Temas sensíveis só no nível da empresa, com n ≥ 10. Supressão complementar. Mostra a distribuição (% favorável / neutro / atenção) em cada dimensão.
- **Eq.** n ≥ 5 para tudo, inclusive a distribuição por item mostrada ao líder. Mínimo de 10 "inviabiliza o produto na maioria das PMEs". A saída é fundir unidades.
- **Ét.**
  - k ≥ 5 para médias e k ≥ 10 para distribuição, comentários e recortes.
  - Em grupos de 5 a 9, a unanimidade revela a resposta de cada um.
  - Nada de resultado parcial com a pesquisa aberta.
- **Resolução.**
  - k = 5 para faixa e escore de dimensão.
  - k = 10 para distribuição (por dimensão e por item), temas de comentários, complemento de fatores psicossociais e qualquer recorte.
  - Tratamento ofensivo: só no total da empresa, com k = 10.
  - Empresa com 5 a 9 respondentes: só o total.
  - Empresa com menos de 5: não aplicar.
- **Motivo.** Os três concordam no 5 para médias. O argumento de Ét sobre unanimidade é aritmético (com n = 6, "0% favorável" revela a resposta de cada um) e ninguém o rebateu. O argumento de Eq (viabilidade em PME) fica atendido, porque a faixa da equipe continua com 5.
- **Votos vencidos:** Eq (distribuição por item ao líder com n ≥ 5); Psi (distribuição com n ≥ 5).

**P4. O dono vê o clima de cada equipe?**
- **Psi.** Faixas e distribuição, nunca ranking entre equipes. Com ICC(1) entre 0,10 e 0,195, a média de 5 a 9 pessoas tem ICC(2) entre 0,36 e 0,69 [C].
- **Eq.** Sim, num mapa de calor com todas as equipes. Nunca um ranking de líderes nem clima atrelado a bônus.
- **Ét.** Média por grupo só com k ≥ 5.
- **Resolução.**
  - Sim, por faixas.
  - As equipes aparecem na ordem fixa do organograma. Nunca ordenadas da pior para a melhor, nunca com rótulo de "pior equipe".
  - Aviso de "margem ampla" quando n < 10.
  - Proibido usar em bônus ou em avaliação de desempenho (Psi [M], Eq).
  - **Unânime.**

**P5. "Harmonia X/100" e "pares em tensão"**
- **Psi.** Não há evidência publicada de que a composição DISC cause ou preveja o clima: nada de afirmação causal.
- **Eq.**
  - "Harmonia/100" e "pares em tensão" não têm validação. As regras são heurísticas de teoria DISC.
  - Em relações que já existem, só a semelhança **percebida** continua preditiva (Montoya, Horton & Kirchner, 2008 [V]; recorte das relações existentes [S]).
  - Tirar esses números do sumário do dono. O "como conduzir" fica no guia do líder.
- **Ét.** Nenhuma alegação sem prova (CDC art. 37 [M]). Nenhum rótulo de pessoa. "Harmonia" de uma dupla nunca serve como motivo de remanejamento.
- **Código [Cód].**
  - `js/compatibilidade.js` usa `BASE = 72`, `ALTO = 30`, peso 1 para "lidera" e "direto" e 0,6 para "indireto". O nível sai de cortes fixos: 70 ou mais = fluido, 50 a 69 = atenção, abaixo de 50 = tensão.
  - A harmonia aparece na capa ("harmonia geral"), no sumário, nos destaques ("Harmonia geral de X/100"), nos alertas ("Fulano e Beltrano em tensão (NN/100)"), no guia por líder ("Relação com X em tensão (NN/100)") e no painel (`js/admin.js`, "Harmonia da equipe").
- **Resolução.** Tirar o número de harmonia do relatório inteiro e do painel. Tirar a nota de 0 a 100 dos pares e a palavra "tensão". As sugestões de combinados por relação ficam, sem nota, como "sugestão de estilo".
- **Motivo.** Se o número sair só do sumário, continua na capa, no mapa de relações e no painel. Um número com cara de medida, mas sem validade, convida a decisões sobre pessoas.
- **Voto vencido:** nenhum. O moderador amplia a proposta de Eq.

**P6. DISC ipsativo no relatório de equipe**
- **Psi.** Escores ipsativos impedem comparar pessoas e tirar médias de equipe [M]. DISC × clima só como hipótese e só no nível da equipe.
- **Eq.**
  - O teste é ipsativo: 25 grupos, notas de 1 a 4 sem repetir, percentuais que somam 100 [Cód: `js/scoring.js`].
  - Média, "falta" e "excesso" têm base fraca (Meade, 2004; Baron, 1996: citação [V], conteúdo [M]).
  - Manter o DISC como linguagem comum, com "rebaixamento epistêmico".
  - Eq antecipou que o Psi pediria a remoção do DISC. O parecer do Psi não pede isso.
- **Ét.** O DISC de equipe identificado é permitido com aviso prévio (legítimo interesse) [I]. Nunca ligar respostas de clima ao cadastro DISC.
- **Resolução.**
  - Ficam: a contagem de estilos principais declarados, "como o grupo decide", o mapa ritmo × foco por pessoa e o guia de cada pessoa.
  - Saem: as barras de média D/I/S/C da equipe.
  - "Lacunas" e "excessos" viram perguntas, sem média.
  - Hipóteses clima × DISC só para o líder e o consultor.
  - **Unânime.**

**P7. Itens de saúde e esgotamento**
- **Psi.** As escalas de saúde e de comportamentos ofensivos do COPSOQ são dado sensível (LGPD art. 5º II e art. 11 [M Psi / S Ét]). Só no nível da empresa, com n ≥ 10.
- **Eq.** Incluir "frequência de esgotamento" no bloco de carga, porque liga o clima à NR-1 e ao bem-estar. A base legal ("obrigação legal") seria definida pelo jurídico [M].
- **Ét.**
  - Não perguntar sobre saúde. "Sinto-me esgotado" é dado de saúde [I].
  - O legítimo interesse não está entre as bases do art. 11 [S].
  - Preferir itens sobre condições de trabalho.
- **Resolução.**
  - A Trilha A não tem nenhum item de saúde. A carga é medida por condições de trabalho: o volume cabe no horário, as metas são possíveis, falta ou não recurso.
  - Na Trilha B, pedir à rede autorização para omitir as escalas de saúde. Se exigirem mantê-las, elas só entram com:
    - base do art. 11 definida por advogado;
    - profissional de saúde ou de SST envolvido;
    - exibição apenas no total da empresa, com n ≥ 10;
    - nenhuma devolutiva individual.
- **Motivo.** A NR-1 foca a organização do trabalho, não o rastreamento clínico de pessoas (Perguntas e Respostas MTE, maio/2026 [S Ét]). Os itens de condição cobrem os exemplos do guia do MTE, como excesso de trabalho e metas impossíveis [S].
- **Voto vencido: Eq.** Registro: "Sem um indicador de bem-estar, perde-se o desfecho central e a ponte mais direta com a NR-1."

**P8. Comparação líder × equipe**
- **Psi.** A resposta do líder fica fora da média. Ele vê a própria resposta ao lado da média se a equipe tiver n ≥ 5.
- **Eq.** É o dado mais acionável para o líder. Mostrar só ao líder e ao consultor, nunca ao dono como ranking.
- **Ét.** Não tratou do ponto. A objeção que Eq antecipou não apareceu.
- **Resolução: aprovada com condições.**
  - O líder responde um formulário próprio (3.1.3), em link próprio, identificado pelo papel.
  - A comparação é por dimensão (A a F) e fica visível só para ele e o consultor.
  - A equipe precisa ter n ≥ 5 sem contar o líder.
  - O dono só vê a comparação quando ele mesmo é o líder daquela equipe.
  - Nunca usar em avaliação de desempenho ou bônus.
  - O líder é avisado antes de responder (6.1).
  - **Unânime.**

**P9. Comentários abertos**
- **Psi.** Sem pergunta aberta no nível da equipe: em equipe pequena, o jeito de escrever identifica a pessoa.
- **Eq.** Uma pergunta aberta opcional, com o aviso "não escreva nomes". O líder recebe temas e trechos sem identificação, revisados pelo consultor.
- **Ét.** Só temas, só com k ≥ 10. O texto literal nunca vai ao cliente.
- **Resolução.** Uma pergunta aberta opcional. As respostas só são processadas em grupo com 10 ou mais respondentes. O cliente vê apenas temas escritos pelo consultor. O texto bruto fica com o consultor durante o prazo de retenção e não é exportado.
- **Voto vencido: Eq** (trechos ao líder).

**P10. Faixas de leitura**
- **Psi.** Escala de 0 a 100 com Favorável · Intermediário · Ponto de atenção, em terços fixos provisórios. Não há norma brasileira.
- **Eq.** Quatro faixas: forte, adequado, atenção, crítico.
- **Ét.** Linguagem de "pontos de atenção".
- **Resolução [Mod].** Três faixas (proposta do Psi), com cortes ancorados na escala de concordância:
  - **Favorável:** ≥ 75 (média ≥ 4, "concordo").
  - **Intermediário:** de 50 a 74.
  - **Ponto de atenção:** < 50 (média abaixo de "nem concordo nem discordo").
  - As faixas são provisórias até existir base própria (≥ 100 equipes e ≥ 1.000 respondentes, Psi).
- **Motivo [Mod].**
  - Nos itens próprios, o ponto 3 é neutro. Por terços, uma equipe com média 2,4 (abaixo do neutro) sairia "intermediária" e o problema ficaria escondido.
  - "Crítico" soa como gravidade de risco, e só a avaliação do PGR pode atribuir gravidade. O Psi também proíbe "risco grave".
  - Na Trilha B (COPSOQ) vale a convenção do próprio instrumento.
- **Votos vencidos:** Eq (4 faixas); Psi (terços na Trilha A).

**P11. Reaplicação**
- **Psi.** Clima/NR-1 uma vez por ano ou depois de mudança grande. Pulso de equipe a cada 3 a 6 meses. Teste-reteste numa subamostra.
- **Eq.**
  - Devolutiva entre os dias 0 e 10, pulso aos 60 dias, reaplicação completa aos 6 meses. Depois, anual com pulso trimestral.
  - Medir cedo demais capta regressão à média.
- **Resolução.**
  - No primeiro ano, o ciclo de Eq.
  - Depois, aplicação completa anual e pulso a cada 3 a 6 meses, só das dimensões-alvo.
  - O complemento NR-1 é anual ou vem depois de mudança grande.
  - Os pulsos seguem as mesmas regras de k.
  - **Unânime na prática.**

**P12. Link, anonimato e armazenamento**
- **Psi.** Guardar a resposta só com o código da equipe e a rodada, sem `pessoa_id`. O controle de "já respondeu" fica separado. "Anônimo" é diferente de "confidencial".
- **Eq.** Link de clima separado do link do DISC, só com token de equipe.
- **Ét.**
  - **Anônimo** só se nem a Gestão sem Caos consegue ligar a resposta à pessoa. **Confidencial** quando ela consegue ligar, mas a empresa nunca vê.
  - Sem resultado parcial com a pesquisa aberta. A taxa de resposta só aparece agregada.
- **Resolução.**
  - O padrão é um **link coletivo por equipe**, e o texto ao respondente diz "anônimo".
  - Link individual só quando o cliente precisar evitar respostas repetidas. Nesse caso o texto diz "confidencial" (variante 6.1-b).
  - Em nenhum dos dois casos a empresa sabe quem respondeu.
  - **Unânime.**

**P13. "Encaixe do candidato" e "pressão do trabalho" por pessoa (ponto levantado pelo moderador)**
- **Não foi debatido.** Ét proíbe ranquear candidatos por perfil e criar "aderência à vaga" automática (regras 8 e 11; art. 20 da LGPD [S]). Eq alerta para o risco de "trocar a pessoa C que falta" (2.2, item 6).
- **Código [Cód].**
  - `analisarFoco` (`js/compatibilidade.js`) dá ao candidato uma nota de 0 a 100: +8 por "preencher lacuna" do time e −6 por "reforçar excesso".
  - O relatório de equipe mostra "Encaixe do candidato NN/100" e "Preenche lacuna do time".
  - O capítulo "Pressão do trabalho sobre o estilo" mostra o "esforço de adaptação" por pessoa nomeada, com faixas que vão até "Muito alta".
- **Resolução [Mod].**
  - Tirar a nota e o nível do encaixe, e também "preenche lacuna" e "reforça excesso". O capítulo passa a ser um "Plano de integração", usado **depois** da contratação.
  - "Pressão do trabalho" ganha nome e texto descritivos e um aviso de que não mede estresse nem risco psicossocial e não entra no PGR. As barras por pessoa ficam só no guia do líder.
  - **Submeter ao psicólogo.**

---

## 3. Decisão de instrumento

### 3.1 Trilha A: questionário próprio da Gestão sem Caos (vai ao ar sem licença de terceiros)

**3.1.1 Nome e enquadramento**
- **Nome:** "Pesquisa de Clima da Equipe · Gestão sem Caos".
- **Complemento opcional para o GRO:** "Pesquisa de Fatores Psicossociais do Trabalho (apoio ao GRO)".
- **Como apresentar:** "Perguntas próprias da Gestão sem Caos, inspiradas em temas estudados pela psicologia organizacional (referências no anexo). Em validação."
- **Nunca** dizer "validado", "versão de", "equivalente a" nem o nome de outro instrumento (Ét 4.3, regra 29).
- **Unidade de análise:** a equipe do organograma, ou seja, o líder e seus liderados diretos, já modelados em `relacoes` com tipo `lidera` [Psi; Cód SPEC]. Convidados = liderados diretos ativos.

**3.1.2 Escala de resposta**
- **Itens A a H1 e N1 a N3, N5:** concordância em 5 pontos, todos com rótulo.
  - 1 Discordo totalmente · 2 Discordo · 3 Nem concordo nem discordo · 4 Concordo · 5 Concordo totalmente.
- **Item N4:** frequência. Nunca · Uma ou duas vezes · Três vezes ou mais · Prefiro não responder.
- **Nenhuma resposta é obrigatória.** Cada tela tem "Pular esta pergunta", porque a participação é voluntária (Ét).
- **No celular:** uma tela por bloco, botões grandes com o rótulo escrito e barra de progresso.

**3.1.3 Lista final de itens (rascunho v0, para revisão de conteúdo)**

Legenda: **D** = direto (concordar é favorável); **I** = invertido (recodificar antes de calcular).

*Bloco A · Liberdade para falar.* Construto: segurança psicológica da equipe (Edmondson, 1999 [V]; meta-análise de Frazier et al., 2017 [V]). Referente: "nesta equipe".

| Id | Enunciado | Sentido |
|---|---|---|
| A1 | Nesta equipe, as pessoas falam o que pensam, mesmo quando pensam diferente do líder. | D |
| A2 | Quando alguém aqui erra, a conversa é sobre como resolver, e não sobre achar culpado. | D |
| A3 | Nesta equipe, quem faz uma pergunta simples pode virar motivo de piada. | I |
| A4 | Nesta equipe, quem vê um problema avisa logo, mesmo quando a notícia é ruim. | D |
| A5 | Aqui dá para propor um jeito novo de fazer o trabalho, mesmo sem ter certeza de que vai dar certo. | D |

*Bloco B · Clareza de metas e papéis.* Construtos: metas de grupo específicas (Kleingeld, van Mierlo & Arends, 2011 [V]); ambiguidade de papel (Tubre & Collins, 2000 [S]); condições de efetividade de Hackman (Wageman, Hackman & Lehman, 2005 [V para a referência]).

| Id | Enunciado | Sentido |
|---|---|---|
| B1 | Todos na equipe sabem quais são as prioridades deste mês. | D |
| B2 | Quando chega uma tarefa nova, fica claro quem é o responsável por ela. | D |
| B3 | A equipe sabe como medir se o trabalho do mês deu certo. | D |
| B4 | As prioridades mudam tanto que a equipe deixa trabalhos pela metade. | I |

*Bloco C · Confiança e apoio entre colegas.* Construtos: confiança intraequipe (De Jong, Dirks & Gillespie, 2016 [V]); compartilhamento de informação (Mesmer-Magnus & DeChurch, 2009 [V]).

| Id | Enunciado | Sentido |
|---|---|---|
| C1 | Nesta equipe, as pessoas cumprem o que combinam umas com as outras. | D |
| C2 | Aqui, as pessoas passam aos colegas as informações de que eles precisam para trabalhar. | D |
| C3 | Quando alguém da equipe está sobrecarregado(a), os outros se oferecem para ajudar. | D |

*Bloco D · Como a equipe lida com divergências.* Construtos: conflito de relacionamento e de processo, e norma de debate (Jehn, 1995 [M]; De Dreu & Weingart, 2003 [S]; de Wit, Greer & Jehn, 2012 [V]).

| Id | Enunciado | Sentido |
|---|---|---|
| D1 | Aqui, desentendimentos pessoais acabam virando briga ou "gelo" entre colegas. | I (relacionamento) |
| D2 | Na nossa equipe, a divisão do trabalho costuma gerar discussão e mal-estar. | I (processo) |
| D3 | Nesta equipe, dá para discordar de uma ideia sem que a conversa vire pessoal. | D (norma de debate) |

*Bloco E · Aprender com o trabalho.* Construtos: aprendizagem e reflexão de equipe (Edmondson, 1999 [V]; Marlow & Lacerenza, 2025 [V]); debrief (Tannenbaum & Cerasoli, 2013 [V]).

| Id | Enunciado | Sentido |
|---|---|---|
| E1 | Depois de uma entrega importante, a equipe conversa sobre o que deu certo e o que não deu. | D |
| E2 | Quando um erro se repete, a equipe muda o jeito de trabalhar para ele não voltar. | D |
| E3 | Na nossa equipe, ideias de melhoria saem do papel. | D |

*Bloco F · Apoio da liderança.* Construtos: liderança focada em pessoas e empoderamento (Burke et al., 2006 [V]); feedback focado na tarefa (Kluger & DeNisi, 1996 [V]). No topo da tela: "Seu líder é a pessoa a quem você responde no dia a dia".

| Id | Enunciado | Sentido |
|---|---|---|
| F1 | Quando algo no meu trabalho precisa melhorar, meu líder me fala de forma clara. | D |
| F2 | Meu líder pede a opinião da equipe antes de decidir coisas que mudam o nosso trabalho. | D |
| F3 | Meu líder deixa a equipe decidir como fazer o trabalho, sem controlar cada passo. | D |

*Bloco G · Carga e recursos.* Construto: demandas e recursos do trabalho (modelo JD-R; Lesener, Gusy & Wolter, 2019: citação [V], conteúdo [M]); exemplos do Guia MTE de fatores psicossociais, como excesso de trabalho e metas impossíveis [S]. Referente: "eu". **Condições de trabalho, não saúde.**

| Id | Enunciado | Sentido |
|---|---|---|
| G1 | O volume de trabalho que recebo cabe no meu horário normal. | D |
| G2 | As metas que recebo são possíveis de alcançar. | D |
| G3 | Perco tempo no trabalho por falta de ferramenta, sistema ou informação. | I |

*Fecho*

| Id | Enunciado | Uso |
|---|---|---|
| H1 | No geral, esta equipe consegue entregar o que se espera dela. | D. Eficácia percebida (Eq), mostrada à parte e fora das dimensões |
| H2 | (Aberta, opcional) Se você pudesse mudar uma coisa no trabalho da equipe, o que seria? Não escreva nomes nem informações de saúde. | Só com k ≥ 10, só como temas (P9) |

*Complemento "Fatores psicossociais do trabalho".* Opcional, para clientes que contratam o apoio ao GRO. Aparece **só no nível da área ou da empresa**, com k ≥ 10.

| Id | Enunciado | Construto | Sentido |
|---|---|---|---|
| N1 | Quando algo muda no meu trabalho (horário, sistema, regra), sou avisado(a) com tempo para me preparar. | previsibilidade e gestão de mudanças (ISO 45003 [V Eq]) | D |
| N2 | O ritmo do meu trabalho me permite fazer pausas curtas quando preciso. | controle sobre o ritmo (modelo demanda-controle, Karasek [M]) | D |
| N3 | O esforço que eu coloco no trabalho é reconhecido de forma justa. | equilíbrio esforço-recompensa (Siegrist; construto citado no Psi e no guia MTE [S]) | D |
| N4 | Nos últimos 6 meses, fui tratado(a) com grosseria, humilhação ou ameaça no trabalho. | relato de exposição a comportamento ofensivo, sem diagnóstico | Escala de frequência; ver regras abaixo |
| N5 | Se eu passar por uma situação de desrespeito no trabalho, sei a quem recorrer. | acesso a canal de escuta ou denúncia | D |

**Regras de N4**
- Só se ativa se a empresa tiver um canal de denúncia ou de escuta definido. O link do canal aparece logo depois da pergunta.
- Janela de 6 meses, para coincidir com o ciclo de reaplicação. Na tradição COPSOQ são 12 meses (Psi).
- Nunca usar a palavra "assédio" como rótulo do resultado.

**Formulário do líder**
- Link próprio, identificado pelo papel. O líder **não** entra na média da equipe.
- Responde A1 a E3 e H1 com o mesmo texto, pensando na sua equipe.
- No lugar do bloco F, responde a versão de autopercepção:
  - FL1: "Quando algo no trabalho de alguém da equipe precisa melhorar, eu falo de forma clara com a pessoa." (D)
  - FL2: "Peço a opinião da equipe antes de decidir coisas que mudam o trabalho dela." (D)
  - FL3: "Deixo a equipe decidir como fazer o trabalho, sem controlar cada passo." (D)
- A própria carga (G) e o complemento N, o líder responde como liderado, no link da equipe do seu próprio líder.

**Item de pulso** (só nas reaplicações curtas)
- P1: "Depois da última pesquisa, vi mudanças concretas no trabalho da equipe." (D). Ideia de Eq; redação do moderador.

**Totais**
- Núcleo: 25 itens fechados (A5 + B4 + C3 + D3 + E3 + F3 + G3 + H1) e 1 aberto.
- Com o complemento: 30 itens fechados e 1 aberto.
- Invertidos: 5 de 25 no núcleo (A3, B4, D1, D2, G3). Nenhum com dupla negação.

**3.1.4 Tempo estimado.** Núcleo de 4 a 6 minutos; com o complemento, de 5 a 7 minutos. Eq estimou de 4 a 6 minutos para 24 itens [M]. **Medir no piloto e na entrevista cognitiva** (Psi).

**3.1.5 Regras de cálculo**
1. **Recodificação:** item invertido vale x' = 6 − x.
2. **Dimensão por respondente (A a G):**
   - É a média dos itens respondidos, desde que pelo menos metade dos itens do bloco tenha resposta (arredondando para cima): A ≥ 3 de 5; B ≥ 2 de 4; C, D, E, F e G ≥ 2 de 3.
   - Abaixo disso, a dimensão fica ausente para aquela pessoa. É a regra que o Psi descreve para o COPSOQ [M], adotada aqui [Mod].
3. **Conversão para 0 a 100:** escore = (média − 1) × 25.
4. **Escore do grupo:**
   - É a média dos escores válidos dos respondentes, sem o líder.
   - O "n da dimensão" é o número de escores válidos. Se for menor que k, a dimensão é suprimida.
   - Exibir o número inteiro, sem casas decimais (Psi, Eq).
5. **Não existe índice geral de clima.** Um número único repetiria o problema da "Harmonia X/100" [Mod].
6. **Alinhamento da equipe** (concordância intragrupo):
   - Fórmula: rwg(j) = J·(1 − s̄²/σ²) / [J·(1 − s̄²/σ²) + s̄²/σ²], em que J = itens do bloco, s̄² = média das variâncias dos itens dentro da equipe e σ² = 2,0, a variância da nula uniforme numa escala de 5 pontos [C Psi]. Referência: James, Demaree & Wolf, 1984 [M].
   - Truncar o resultado entre 0 e 1 [M].
   - Rótulos: ≥ 0,70 "equipe alinhada"; de 0,50 a 0,69 "opiniões variadas"; < 0,50 "opiniões divididas". Os cortes são convenção (LeBreton & Senter, 2008: referência [V], faixas [M]).
   - Calcular também o AD (desvio médio; Burke et al., 1999 [M]) como conferência interna. O psicometrista define o corte (convencionalmente A/6 ≈ 0,83 na escala de 5 pontos [M]).
7. **Distribuição** (só com k ≥ 10): % de respondentes com escore da dimensão ≥ 75, entre 50 e 74 e < 50.
8. **Itens únicos (H1, N1 a N3, N5):** mesma conversão para 0 a 100, com o rótulo "indicador de 1 pergunta".
9. **N4:** % de quem marcou "uma ou duas vezes" ou "três vezes ou mais", entre quem respondeu ("prefiro não responder" fica fora do denominador).
10. **Taxa de resposta:** respondentes ÷ convidados (liderados diretos ativos).
11. **Variação entre rodadas:**
    - A variação em pontos aparece como "subiu" ou "desceu" só se |Δ| ≥ 10 pontos. Abaixo disso, "dentro da margem".
    - Os 10 pontos traduzem o limiar de ruído de 0,3 a 0,5 ponto na escala de 5 sugerido por Eq [M]. O psicometrista troca por um limiar baseado no erro padrão quando houver dados.
12. **Qualidade de resposta:**
    - Respostas rápidas demais (< 2 s por item [M Psi], a calibrar) e "linha reta" em todos os itens, inclusive os invertidos, são sinalizadas.
    - Essas respostas saem só da análise psicométrica. Não são excluídas em silêncio do relatório do cliente; o consultor recebe a contagem (Psi).

**3.1.6 Faixas de leitura (provisórias, sem rótulo clínico)**

| Faixa | Escore 0–100 | Leitura padrão |
|---|---|---|
| Favorável | ≥ 75 | "A equipe relata uma boa experiência neste tema." |
| Intermediário | 50 a 74 | "Há pontos a melhorar neste tema; vale conversar." |
| Ponto de atenção | < 50 | "A equipe relata dificuldade neste tema; vale priorizar na conversa." |

- **Legenda fixa:** "Faixas de referência provisórias, definidas pela escala de resposta. Não são normas nem comparação com outras empresas."
- **Quando substituir:** as faixas viram percentis da própria base quando houver ≥ 100 equipes e ≥ 1.000 respondentes (Psi, fase 5).
- **Linguagem:** sempre descritiva ("a equipe relata…", "vale conversar sobre…"). Palavras proibidas: 6.4.

**3.1.7 Regras de anonimato**

| O que | Mínimo de respondentes | Nível onde pode aparecer |
|---|---|---|
| Faixa e escore de uma dimensão (A a G, H1) | k ≥ 5 válidos, sem o líder | equipe, área, empresa |
| Rótulo de alinhamento | k ≥ 5 | onde a faixa aparecer |
| Distribuição % por dimensão e por item | k ≥ 10 | equipe, área, empresa |
| Complemento N1 a N3 e N5 | k ≥ 10 | área ou empresa (nunca equipe) |
| N4 (tratamento ofensivo) | k ≥ 10 | **só empresa** |
| Temas dos comentários (H2) | k ≥ 10 | área ou empresa |
| Visão do líder × equipe | equipe com k ≥ 5 | só para o líder e o consultor |
| Variação entre rodadas | k ≥ 5 nas duas rodadas | onde a faixa aparecer |
| Recortes por sexo, idade, tempo de casa, cargo ou perfil DISC | **não oferecer no lançamento**; no futuro, k ≥ 10 por célula **e** no complemento | — |

**Supressão complementar** [Psi, Ét, Eq]
- Se dois grupos aparecem e um está dentro do outro (área X e equipe X1), a diferença entre eles (X sem X1) também precisa ter k ≥ 5. Se não tiver, mostra-se só o nível de cima.
- Na prática:
  - empresa com 5 a 9 respondentes: só o total;
  - empresa com 10 ou mais: equipes e áreas, desde que passem pela regra de complemento;
  - equipes com menos de 5: fundidas em "Outras equipes", que também precisa ter k ≥ 5.
- **Os agrupamentos são congelados no encerramento da rodada [Mod].** Um relatório novo com outro agrupamento para a mesma rodada só sai com o consultor refazendo a checagem contra **todos** os recortes já publicados. Sem isso, a diferença entre dois relatórios revela um grupo pequeno.

**Quando NÃO mostrar**
- Grupo com menos de 5 respondentes válidos, ou cujo complemento tenha menos de 5.
- Qualquer resultado enquanto a pesquisa está aberta. Liberar só no encerramento e sem horário das respostas (Ét).
- Distribuição, temas e complemento em grupos com menos de 10.
- Variação entre rodadas quando a composição mudou e n < 10 (Psi). Com n ≥ 10 e mais de 30% de troca, mostrar com o aviso "comparação frágil" (Eq [M]).
- Lista de quem respondeu ou não respondeu: nunca. A taxa só aparece agregada.
- Resposta bruta ou exportação linha a linha para o cliente: nunca.
- Empresa com menos de 5 respondentes possíveis: **não aplicar**. Oferecer conversa facilitada pelo consultor (Ét).
- Equipe "dividida" (rwg < 0,50): a faixa aparece com o texto de opiniões divididas e não dispara hipótese (5.6).

**3.1.8 Armazenamento** (Psi, Eq, Ét)
- A resposta de clima fica numa tabela própria, só com o token da equipe, a rodada e o papel (membro ou líder). Sem `pessoa_id`, nome, telefone, e-mail ou IP.
- Nenhuma ligação com `pessoas`, `respostas` (DISC) ou `vinculos`. O link de clima é separado do link do DISC.
- Na variante com link individual, o controle de "já respondeu" fica numa tabela separada que nunca vai para o cliente.
- **Retenção** (Ét [I], prazos a validar com o advogado):
  - respostas brutas apagadas ou agregadas de forma irreversível até 90 dias após a entrega do relatório;
  - até 12 meses, guardando só agregados de grupos com k ≥ 5, se o cliente contratar a comparação anual.
- Público: maiores de 18 anos. Jovem aprendiz fica de fora até o advogado decidir (LGPD art. 14 [M Ét]).

**3.1.9 Antes de ir ao ar (condições bloqueantes)**
1. **Checagem de não semelhança**, feita por psicólogo(a) com acesso aos originais: nenhum item pode ser cópia, tradução ou paráfrase próxima de itens do Gallup Q12, HSE-IT, COPSOQ II-Br, Edmondson / Ramalho & Porto, TCI, Jehn ou UWES (Ét regra 28).
   - Alerta do moderador [M]: o exemplo "sei o que esperam de mim" (Ét, regra 17) lembra de perto o 1º item do Gallup Q12 e um item de papel do HSE-IT. Por isso ficou fora.
   - Pela mesma razão foram evitados itens do tipo "tenho o material e o equipamento de que preciso" e "minha opinião conta".
2. **Validade de conteúdo** com 3 a 5 juízes (Ét 4.3).
3. **Entrevista cognitiva** no celular com 8 a 12 trabalhadores de PME de escolaridade variada, medindo o tempo real (Psi).
4. **Advogado(a):** aviso ao respondente, DPA com o cliente, base legal, RIPD (Ét).
5. **Supressão no servidor**, com testes automatizados (5.9).

**3.1.10 Plano de validação depois do lançamento** (resumo do Psi, seção 7)
- **Piloto:** ≥ 300 respondentes em ≥ 40 equipes com n ≥ 5. Ômega e alfa por dimensão (≥ 0,70); AFC ordinal (WLSMV), com CFI/TLI ≥ 0,95, RMSEA ≤ 0,08 e SRMR ≤ 0,08 [M Hu & Bentler]; checar fator de método dos invertidos.
- **Multinível:** ≥ 50 equipes. ICC(1), ICC(2), distribuição de rwg. Dimensão com ICC(1) próximo de 0 sai do recorte de equipe e fica só na empresa.
- **Invariância:** por sexo, idade, escolaridade, setor, porte e líder × não líder.
- **Critério:** escores de equipe × rotatividade em 6 a 12 meses, com hipóteses registradas antes de olhar os dados.
- **Normas:** com ≥ 1.000 respondentes e ≥ 100 equipes.
- **Nota técnica** versionada a cada mudança de item. A palavra "validado" só pode ser usada depois dela.

### 3.2 Trilha B: depende de autorização por escrito

**3.2.1 O que usar se a licença sair**

| Instrumento | Uso no produto | Condições |
|---|---|---|
| **COPSOQ II-Br, versão curta** (Gonçalves et al., 2021, *Rev Saúde Pública* 55:69 [V]) | Módulo "Fatores psicossociais" para a NR-1, aplicado num momento separado, 1 vez por ano. Substitui o complemento N e, no mesmo ciclo, pode dispensar o bloco G | Usar a versão como validada. Se for modificada, não pode se chamar "COPSOQ" [V Psi / S Ét]. Cobra-se pela análise e pela consultoria, não pelo questionário [V Psi]. Escalas de saúde: ver P7. Comportamentos ofensivos: só empresa, k ≥ 10. Convenção de faixas do próprio instrumento |
| **Escala de Segurança Psicológica da Equipe** (Edmondson, 1999; versão BR de Ramalho & Porto, 2021, *Psico-USF* [V]) | Substitui o bloco A no núcleo e no pulso de equipe | Redação publicada literal; confirmar se são 5 ou 7 itens e qual a escala [S]; testar invariância por sexo (amostra BR só feminina [V]). **Trocar o bloco quebra a série histórica**: decidir antes do primeiro ciclo pago, se possível |

**Ficam fora da Trilha B por ora:**
- Gallup Q12, Belbin e TDS: proprietários [V]/[S].
- TCI: proprietário e longo.
- HSE-IT: Crown copyright, licença paga acima de 50 empregados [V Psi].
- ECO: 63 itens.
- PROART: conteúdo de "sofrimento" e "danos".
- UWES, ERI e JCQ: exigem permissão ou taxa e medem construtos individuais. O UWES pode voltar no futuro como medida de desfecho, com licença.

**3.2.2 O que pedir e a quem.** O contato vem da página oficial de cada instituição. O moderador não inventa endereços.

| Destinatário | O que pedir |
|---|---|
| **Rede COPSOQ International** (copsoq-network.org) | Confirmar por escrito o uso comercial em plataforma própria (SaaS) dentro das diretrizes; como fica a cláusula NC; se a versão curta pode omitir as escalas de saúde e de comportamentos ofensivos e ainda usar o nome; requisitos de processo e de citação |
| **Equipe brasileira da validação** (Gonçalves, Moriguchi, Chaves & Sato; vínculo com a UFSCar segundo o Psi, a confirmar) | Texto oficial dos itens, número de itens, escala, regras de cálculo, valores de referência brasileiros, se houver, e concordância com o uso |
| **Amy C. Edmondson** (Harvard Business School). Perguntar também se o pedido deve ir à editora da *Administrative Science Quarterly* ou à Fearless Organization [S]/[M] | Permissão para usar os itens da escala de 1999 em produto pago, em português, e as condições |
| **Ramalho & Porto** (UnB) | Permissão para usar a redação brasileira em produto pago; número de itens e escala; forma de citação |

**3.2.3 Texto-modelo do pedido (e-mail curto, em português)**

> **Assunto:** Pedido de autorização para uso comercial do [INSTRUMENTO] em português
>
> Prezado(a) [Prof.(a) NOME],
>
> Sou [SEU NOME], responsável pela Gestão sem Caos, consultoria brasileira que atende pequenas e médias empresas. Estamos criando um serviço de pesquisa de clima e de fatores psicossociais do trabalho, respondido pelo celular. Os resultados são só agregados por equipe (mínimo de 5 respondentes por grupo) e incluem devolutiva e plano de ação.
>
> Gostaríamos de usar o [INSTRUMENTO, ex.: "COPSOQ II, versão curta brasileira (Gonçalves et al., 2021, Rev Saúde Pública 55:69)"] nesse serviço. Pedimos, por escrito:
> 1. autorização para uso comercial em plataforma própria (cobramos pela análise e pela consultoria, não pelo questionário);
> 2. o texto oficial dos itens, a escala de resposta e as regras de cálculo;
> 3. [PERGUNTA ESPECÍFICA, ver abaixo];
> 4. as condições de citação, guarda das respostas, prazo e eventual custo.
>
> Podemos enviar o desenho do serviço e o aviso de privacidade. Agradeço desde já a atenção.
>
> Atenciosamente,
> [SEU NOME] · Gestão sem Caos · [E-MAIL] · [TELEFONE] · [SITE]

**Pergunta específica (item 3), por destinatário:**
- **Rede COPSOQ e equipe brasileira:** "se podemos aplicar a versão curta sem as escalas de saúde e de comportamentos ofensivos e, nesse caso, como devemos nomear e citar o questionário".
- **Edmondson:** "se o pedido deve ser feito à senhora, à editora da revista ou à Fearless Organization".
- **Ramalho & Porto:** "se a versão brasileira tem 5 ou 7 itens e qual escala de resposta devemos usar".

**Versão curta em inglês** (para Edmondson e para a rede internacional; é o mesmo pedido):

> **Subject:** Permission request: commercial use of [INSTRUMENT] in Portuguese
>
> Dear [Prof. NAME],
>
> I run Gestão sem Caos, a Brazilian consultancy for small and mid-sized companies. We are building a mobile workplace-climate and psychosocial-factors survey that reports only team-level aggregates (minimum 5 respondents per group), followed by feedback sessions and action plans.
>
> We would like to use [INSTRUMENT] in this service and kindly ask, in writing: (1) permission for commercial use on our own platform (we charge for analysis and consulting, not for the questionnaire); (2) the official item wording, response scale and scoring; (3) [SPECIFIC QUESTION]; (4) citation, data-storage, term and any fee conditions.
>
> Thank you for your consideration.
> [NAME] · Gestão sem Caos · [EMAIL]

**3.2.4 Se a resposta for "não" ou não vier.** A Trilha A continua. Nunca usar itens "parecidos" com os originais nem dizer que são equivalentes (Psi, Ét).

---

## 4. Mudanças no relatório de Equipe ATUAL

**Implementação**
- Seguir o fluxo do projeto: **prévia (artefato) para o dono aprovar antes do push** (CLAUDE.md).
- Atualizar com cuidado os testes que hoje afirmam a harmonia, sem quebrar seletores:
  - `tests/e2e/admin.spec.js`, linhas 1572, 1772 e 1915 (texto "Harmonia da equipe");
  - `tests/relatorio-modelos.test.js`, linhas 72 a 75 (`sumario.harmonia`, `harmoniaNivel`) [Cód].

| # | Onde (atual) [Cód] | Decisão | Justificativa | Texto substituto |
|---|---|---|---|---|
| 1 | Capa: número "harmonia geral /100" (`relatorio-view.js`, `equipeHtml`) | **Tirar** | P5 | Trocar o 4º número por "estilos presentes", ex.: "3 de 4". |
| 2 | Sumário: mini-números "harmonia" e "relações em tensão"; meta "Equilíbrio · Harmonia · Destaques e alertas" | **Tirar** os números; **reescrever** a meta | P5 | Meta: "Estilos · Destaques · Pontos para conversar". Título "Alertas" → "Pontos para conversar". |
| 3 | Destaques "Harmonia geral de X/100…" e "Fulano e Beltrano (NN/100): …" (`relatorio-modelos.js`, `equipe`) | **Tirar** | P5 | Manter só os destaques de estilo, ex.: "Força predominante: …". |
| 4 | Alertas "Fulano e Beltrano em tensão (NN/100)" e "pedem atenção (NN/100)" | **Tirar** | P5; Eq 3.3 (rótulo de dupla como motivo de remanejamento) | Nenhum. As sugestões por relação ficam no capítulo próprio, sem nota. |
| 5 | Textos `FALTA` (`compatibilidade.js`) | **Reescrever como pergunta** | P6; Eq 2.3 | **D:** "Ninguém do time descreveu Dominância como estilo forte. Vale conferir: quem destrava decisões e cobra prazos quando a equipe empaca?" **I:** "Ninguém do time descreveu Influência como estilo forte. Vale conferir: quem cuida de engajar clientes e outras áreas?" **S:** "Ninguém do time descreveu Estabilidade como estilo forte. Vale conferir: quem garante que as rotinas combinadas sejam mantidas até o fim?" **C:** "Ninguém do time descreveu Conformidade como estilo forte. Vale conferir se processos, padrões e qualidade têm dono claro." |
| 6 | Textos `EXCESSO` e o critério "média ≥ 35%" | **Reescrever**; o critério passa a ser só a **contagem** de estilo principal (≥ 60% do time, com 3 ou mais pessoas); tirar "(média X%)" do texto | P6 (média ipsativa) | **D:** "Boa parte do time descreve Dominância como estilo principal. Vale combinar como decidir quando houver divergência e quem dá a palavra final." **I:** "Boa parte do time descreve Influência como estilo principal. Vale combinar como registrar acordos e acompanhar prazos." **S:** "Boa parte do time descreve Estabilidade como estilo principal. Vale combinar como a equipe se prepara para mudanças e urgências." **C:** "Boa parte do time descreve Conformidade como estilo principal. Vale combinar quando uma decisão pode ser tomada sem todos os dados." |
| 7 | Rótulos "Equilibrado / Com lacunas / Concentrado / Desequilibrado"; título "Equilíbrio do time"; seção "Lacunas e excessos" | **Reescrever** | Rótulo avaliativo sobre dado ipsativo | "Estilos variados" / "Algum estilo pouco presente" / "Um estilo predomina" / "Um estilo predomina e outro está pouco presente". Título: "Estilos do time". Seção: "Estilos menos e mais presentes". |
| 8 | Barras "Média do time por fator" | **Tirar** do corpo; manter "Estilo principal das pessoas" (contagem) | P6; Meade 2004 / Baron 1996 (citação [V], conteúdo [M]) | Nota fixa: "Os percentuais do DISC são relativos dentro de cada pessoa e somam 100%: mostram o que cada um prioriza, não quanto tem de cada característica." |
| 9 | "Mapa de relações": nota 0 a 100, barra, níveis Fluido/Atenção/Tensão, ordem "pior primeiro" | **Reescrever** | P5 | Título: "Combinados sugeridos por relação". Dois rótulos, sem número: "Tende a fluir" / "Pede combinados". Ordem pelo tipo de relação (lidera → direto → indireto). "Riscos" → "Pontos para combinar". Lede: "Sugestões de estilo para cada relação registrada, a partir do DISC de cada pessoa. Não medem a qualidade da relação nem preveem desempenho: confirme em conversa." |
| 10 | Guia por líder: alerta "Relação com X em tensão (NN/100)" e tendência "tende a ter tensão sem acordos explícitos" | **Reescrever** | P5 | Alerta: "Com X, vale combinar desde cedo: <primeira dica>." Tendência: "A relação pede combinados claros." Rótulo do bloco "Como conduzir": "sugestão de estilo". |
| 11 | "Encaixe do candidato": nota /100, nível, "Preenche lacuna / Reforça fator que predomina" (`analisarFoco`) | **Tirar** a nota, o nível e os dois rótulos; **reposicionar** o capítulo | P13; Ét regras 8 e 11; Eq 2.2 | Título: "Plano de integração". Lede: "Este capítulo ajuda a receber bem quem foi contratado(a). Não serve para decidir a contratação." Manter o organograma com a pessoa e o plano de 90 dias. Opção "Incluir o encaixe de um candidato" no painel → "Incluir o plano de integração de quem foi contratado". |
| 12 | "Pressão do trabalho sobre o estilo" (média e barras por pessoa, faixa até "Muito alta") | **Reescrever** e **restringir** [Mod; submeter ao psicólogo] | Ninguém do painel debateu; risco de ser lido como estresse ou risco psicossocial | Título: "Distância entre o estilo natural e o que o cargo pede". Aviso: "Mostra quanto cada pessoa diz adaptar o próprio estilo ao cargo. Não mede estresse, saúde nem risco psicossocial e não deve ser usado no PGR." Barras por pessoa só no guia do líder ou no relatório individual. |
| 13 | Aviso de limites 2 (`AVISOS_LIMITE[1]`: "Compatibilidade indica…") | **Reescrever** | Sem nota de compatibilidade | "As sugestões por relação indicam onde a convivência pode pedir combinados. Não medem a qualidade da relação nem preveem desempenho; qualquer dupla pode trabalhar bem com papéis e acordos claros." |
| 14 | Encerramento | **Acrescentar** | Ét A.1 e B.8 | "Não use este relatório para decidir contratação, promoção, desligamento, remanejamento, salário ou bônus." |
| 15 | Painel: caixa "Harmonia da equipe" (`js/admin.js`, cerca da linha 6136) | **Tirar** o número | P5 (o consultor repassaria o número) | "Relações registradas: N · com combinados sugeridos". |
| 16 | Subtítulo da capa: "…compatibilidade entre as pessoas…" | **Reescrever** | P5 | "Organograma com perfis DISC, estilos do time, combinados sugeridos entre as pessoas e como liderar cada uma." |
| 17 | Organograma com perfis; "Estilo principal das pessoas"; mapa ritmo × foco; "Como o grupo decide"; "Como liderar cada pessoa"; avisos 1 e 3 | **Manter** | Descrevem cada pessoa, o que é permitido com aviso prévio (Ét 5.3), e dão vocabulário comum (Eq 2.1) | Acrescentar ao consentimento do colaborador (Ét 5.3): "O seu resultado descreve estilo de comportamento, não mede competência e não deve ser usado para decisões de desligamento ou salário." |

**Regra geral de texto.** Nos pares e nos guias, usar sempre "tende a" ou "pode". Nunca usar previsões fechadas como "vai haver disputa".

---

## 5. Especificação para a equipe de desenvolvimento

### 5.1 Princípios
1. O clima é **percepção coletiva**. Não avalia pessoas e não faz diagnóstico.
2. O DISC é **linguagem comum**. Não prediz desempenho e **nunca entra no PGR** (Eq 4.3).
3. Clima e DISC só se cruzam no nível da equipe, como **hipótese para conversa** (5.6).
4. A devolutiva para a equipe e o plano 30/60/90 **fazem parte do produto** (Eq; diretrizes COPSOQ, Psi).
5. Celular primeiro para quem responde e para quem lê o relatório. O painel do consultor é para computador (CLAUDE.md).

### 5.2 Relatório de Equipe avançado (um por equipe)

| # | Capítulo | Conteúdo |
|---|---|---|
| 1 | Como ler | O que é e o que não é; n, convidados, taxa de resposta, datas; limites; frase fixa "Clima é a percepção coletiva…" (6.2) |
| 2 | Resumo de 1 página | 3 forças, 3 prioridades (dimensões), 1 recomendação principal e "confiança do retrato": taxa de resposta + alinhamento + aviso de margem quando n < 10 |
| 3 | Painel de clima | 7 dimensões (A a G) em 3 faixas, rótulo de alinhamento, variação desde a rodada anterior (regras de 3.1.5) e distribuição só com k ≥ 10. H1 à parte |
| 4 | Carga e recursos | Bloco G em destaque, com ponte para o PGR ("insumo"; 6.2) |
| 5 | Estilos DISC da equipe | Contagem de estilos principais declarados, como o grupo decide, combinados sugeridos. Sem média, sem harmonia, sem nota |
| 6 | Estrutura e liderança | Organograma e amplitude de controle (líder com mais de 8 liderados diretos é dado de estrutura [Cód: alerta já existe]). **Só no relatório do líder:** a visão dele × a da equipe, por dimensão |
| 7 | Hipóteses para conversa | **Só no relatório do líder e do consultor.** No máximo 3, no formato de 5.6 |
| 8 | Plano de ação 30/60/90 | 2 ou 3 intervenções do menu de 5.7, com responsável, data e indicador de processo |
| 9 | Acompanhamento | Data do pulso e da reaplicação; indicadores que a equipe já tem (prazo, retrabalho, rotatividade, faltas); critério de sucesso |
| 10 | Anexo de método | Itens e versão, escala, cálculo, regras de supressão, limites do DISC (ipsativo), referências; "perguntas próprias… em validação" |

### 5.3 Relatório de Clima (empresa) e anexo para o responsável pelo PGR

| # | Capítulo | Conteúdo |
|---|---|---|
| 1 | Como ler | Igual ao 5.2 |
| 2 | Resumo da empresa | Dimensões no total da empresa, taxa de resposta, 3 forças e 3 prioridades |
| 3 | Por área e equipe | Faixas de cada grupo que passa no k e no complemento, **na ordem fixa do organograma**, sem ordenar e sem "pior/melhor"; o que não passa vai para "Outras equipes" |
| 4 | Fatores psicossociais (se contratado) | N1 a N3 e N5 por área ou empresa (k ≥ 10); N4 só no total da empresa (k ≥ 10), com o link do canal |
| 5 | Temas dos comentários | Só com k ≥ 10, escritos pelo consultor, sem trechos literais |
| 6 | Plano da empresa | Medidas organizacionais (priorização, recursos, prazos) e responsáveis |
| 7 | **Anexo para o responsável pelo PGR** | Fatores identificados por grupo, sinais e sugestões de medidas, e campos **em branco** para o cliente preencher severidade, probabilidade, responsável e prazo. Lista explícita do que falta (abaixo) |
| 8 | Método | Igual ao 5.2 |

**Correspondência com os exemplos do Guia MTE.** Os exemplos vêm da imprensa [S]; o mapa é de Eq.

| Indicador | Fator citado |
|---|---|
| G Carga e recursos | excesso de trabalho; metas impossíveis |
| F Apoio da liderança | falta de apoio da chefia |
| B Clareza | falhas de comunicação |
| C Confiança; D Divergências | relações e conflito no trabalho |
| N3 Reconhecimento | desequilíbrio entre esforço e recompensa |
| N4 Tratamento ofensivo | assédio moral, **como relato agregado; a apuração é da empresa** |
| N1 Mudanças | gestão de mudanças (ISO 45003 [V Eq]) |

**O que o anexo precisa dizer que falta** (Ét 3.3; Eq 4.3)
- avaliação de risco (severidade × probabilidade) com critério documentado;
- inventário de riscos e plano de ação no PGR;
- implementação, acompanhamento e comunicação aos trabalhadores;
- integração com PCMSO e CIPA;
- outras fontes: afastamentos, CATs, horas extras, rotatividade, faltas, canal de denúncia, observação do trabalho, AEP/AET da NR-17;
- fatores que pedem registro e não percepção: jornada, turnos, pausas, trabalho isolado, violência de terceiros.

### 5.4 O que cada público vê

| Conteúdo | Dono | Líder | Consultor | Equipe (devolutiva) | Resp. PGR |
|---|---|---|---|---|---|
| Faixas por dimensão, total da empresa | sim | sim | sim | sim (resumo) | sim |
| Faixas por equipe (k ≥ 5 + complemento) | todas, em ordem fixa, sem ranking | só a própria | todas | só a própria | por área (k ≥ 10) |
| Distribuição % (k ≥ 10) | por dimensão | dimensão e item, da própria equipe | tudo | por dimensão | por dimensão |
| Rótulo de alinhamento | sim | sim | sim | sim | sim |
| Variação entre rodadas | sim | sim | sim | sim | sim |
| Visão do líder × equipe | **não** (salvo se ele for o líder daquela equipe) | **sim** (a própria) | sim | não | não |
| Temas dos comentários (k ≥ 10) | temas | temas da área, se k ≥ 10 | texto bruto, sem exportar | temas, na oficina | temas ligados a fatores |
| Complemento N (k ≥ 10; N4 só empresa) | sim | da área | sim | resumo da empresa | sim |
| Estilos DISC da equipe (contagem, decisão, combinados) | sim, sem números de harmonia | sim + "como conduzir" | sim | contagem; nomes só com o aceite de cada pessoa [Mod] | **não** |
| DISC individual ("como liderar") | sim (com aviso prévio ao colaborador) | dos seus liderados | sim | cada um vê o seu | **não** |
| Hipóteses clima × DISC | **não** | sim (máx. 3) | sim | opcional, na oficina, com o consultor | **não** |
| Plano 30/60/90 e status | sim | sim (é o dono do plano) | sim | o que foi combinado | as medidas |
| Taxa de resposta agregada | sim | sim | sim | sim | sim |
| Anexo PGR | sim | não | sim | não | sim |

### 5.5 O que nunca mostrar
- Resposta individual de clima. Também nunca "quem respondeu" ou "quem não respondeu".
- Grupo ou complemento com menos de 5 respondentes. Distribuição, comentários ou complemento N com menos de 10.
- Diferença entre recortes que isole menos de 5 pessoas (3.1.7).
- Clima por perfil DISC, sexo, idade, tempo de casa ou cargo dentro da equipe.
- Ranking de equipes ou de líderes. Clima ligado a bônus ou a avaliação de desempenho.
- Texto literal de comentários ao cliente.
- Itens de saúde ou esgotamento (Trilha A não tem; Trilha B só no total da empresa, com k ≥ 10).
- Rótulos de pessoas ("tóxico", "travador"). Nota de "harmonia" ou de "encaixe". "Tensão" entre pessoas nomeadas.
- Resultados enquanto a pesquisa está aberta.
- DISC no anexo do PGR.

### 5.6 Hipóteses clima × DISC (Eq 2.3, aprovado)
- **Disparo:** a hipótese só aparece se valerem as três condições:
  1. a dimensão está em "ponto de atenção";
  2. a equipe está "alinhada" (rwg ≥ 0,70);
  3. o padrão DISC é marcado, ou seja, um estilo principal em 60% ou mais do time, ou ausência de um estilo.
- **Limite:** no máximo 3 por relatório.
- **Formato obrigatório:**
  1. o dado de clima;
  2. uma leitura de estilo possível ("pode ser que…");
  3. **pelo menos duas explicações que não são DISC** (ex.: carga, mudança recente, papéis nunca combinados, líder novo);
  4. uma pergunta para a conversa;
  5. o primeiro passo, **tirado do menu de 5.7, não do DISC**.
- **Proibido:**
  - linguagem causal ("porque a equipe tem pouco C");
  - nomes de pessoas;
  - clima calculado por perfil;
  - correlação DISC × clima com uma equipe só.
- Não há evidência publicada de que a composição DISC cause ou preveja segurança psicológica (Psi).

### 5.7 Intervenções recomendadas por resultado

| Resultado | Intervenção | Evidência | Como fazer numa PME |
|---|---|---|---|
| E (aprender) baixo; apoio a qualquer outra dimensão | Debrief / After-Action Review | Tannenbaum & Cerasoli, 2013: d = 0,67 [V]; Keiser & Arthur, 2021: d = 0,79 [S] | 20 min depois de cada entrega ou a cada 15 dias, com 4 perguntas fixas; facilitador rotativo; 1 compromisso registrado |
| B (clareza) baixo | Metas de equipe específicas e desafiadoras | Kleingeld et al., 2011: d = 0,80 contra metas vagas; metas individuais "egocêntricas" d = −1,75 [V] | 1 a 3 metas da equipe por trimestre, visíveis; revisar metas individuais que competem entre si |
| B baixo ou D2 (processo) desfavorável | Esclarecimento de papéis ("quem decide o quê") | Klein et al., 2009: papéis e metas são os componentes mais eficazes do team building [S] | Oficina de 90 min: entregas recorrentes, um responsável por item, zonas cinzentas resolvidas pelo líder |
| D1 (relacionamento) desfavorável ou C baixo | Acordo de equipe + normas de debate | Mathieu & Rapp, 2009: evidência moderada, amostra de estudantes [V] | Acordo de 1 página, revisado em 60 dias. **Conflito concentrado em duas pessoas: conversa mediada, não oficina coletiva** |
| A (liberdade para falar) baixo | Comportamento do líder + rituais estruturados de fala + debrief | Intervenções só de segurança psicológica têm resultado inconsistente (O'Donovan & McAuliffe, 2020 [V]); comportamentos do líder (Edmondson, 2018 [M]) | Treino de 1:1 do líder; perguntar antes de afirmar; reagir bem a más notícias. **Nada de "palestra de segurança psicológica"** |
| F (liderança) baixo | 1:1 quinzenal + feedback focado na tarefa + delegação | Kluger & DeNisi, 1996: d = 0,41, mas mais de 1/3 das intervenções pioraram o desempenho [V]; Burke et al., 2006 [V] | Roteiro de 1:1 (prioridades, bloqueios, desenvolvimento). O DISC entra aqui como dica de estilo de conversa |
| H1 baixo ou desempenho sem feedback | Indicadores de equipe com feedback (lógica ProMES) | Pritchard et al., 2008 [V]; valor de d [M] | 3 a 5 indicadores que a equipe controla, num quadro visível; reunião mensal de 30 min |
| Processos de trabalho em equipe fracos | Treinamento de trabalho em equipe com prática | McEwan et al., 2017: efeitos médios [V] | Simulações curtas com casos reais |
| G (carga) baixo | Medidas **organizacionais**: priorizar, redistribuir, dar recursos, rever prazos; escalar ao responsável pelo PGR | JD-R, Lesener et al., 2019 (citação [V], conteúdo [M]); controle na fonte [M] | Reunião de priorização com o dono: "o que paramos de fazer". **Nunca um programa de resiliência como resposta à carga** |
| N4 com relatos | Acionar o canal e a apuração da empresa, com orientação jurídica | Eq 4.3 (a pesquisa não é canal de denúncia) | Nunca oficina coletiva sobre o tema |
| N1 baixo | Comunicar mudanças com antecedência e consultar quem é afetado | ISO 45003 [V Eq] | Calendário de mudanças; aviso mínimo combinado |

**Não recomendar como intervenção principal:** team building recreativo, palestra motivacional, remanejar pessoas por perfil DISC, programas de resiliência em resposta a carga excessiva (Eq).

### 5.8 Plano 30/60/90 e reaplicação (Eq 3.5, aprovado)

| Momento | O quê | Quem | Indicador |
|---|---|---|---|
| Dias 0 a 10 | Devolutiva ao líder (60 min); depois oficina com a equipe (60 a 90 min), em que a equipe valida a leitura e escolhe 2 prioridades | Consultor e líder | Oficina feita; 2 prioridades escritas |
| Dia 30 | Rotinas implantadas: acordo publicado, pelo menos 2 debriefs, mapa de papéis | Líder | Número de debriefs; acordo publicado |
| Dia 60 | **Pulso**: 6 a 8 itens (dimensões-alvo + P1); revisão com o consultor | Consultor | Taxa ≥ 60% [M]; direção da mudança |
| Dia 90 | Revisão: indicadores de negócio e status das ações; manter, trocar ou encerrar cada ação | Líder e dono | Ações concluídas |
| Mês 6 | **Reaplicação completa**; comparação com a linha de base | Consultor | Mudança fora da margem (≥ 10 pontos, provisório) |
| Depois | Completa **1 vez por ano**; pulso a cada **3 a 6 meses**; reaplicar também depois de mudança grande (troca de líder, fusão de equipes, demissões) | | |

Por que não antes de 6 meses: o clima muda devagar, as intervenções precisam de "dose" e medir cedo demais capta regressão à média (Eq).

### 5.9 Requisitos técnicos (descrição, sem código)
1. **Agregação e supressão no servidor.**
   - Respostas brutas de clima nunca vão para o navegador, nem do painel do consultor. A exceção é o texto de H2 para o papel de consultor, dentro do prazo de retenção.
   - O snapshot `dados` do relatório publicado por token **só contém agregados já suprimidos** [Mod; Cód: `relatorios.dados` é snapshot].
2. **Testes automatizados de supressão:** k = 5 e k = 10, complemento, "Outras equipes", unanimidade, congelamento de agrupamento, nada antes do encerramento (Ét risco 2).
3. **Tabelas separadas** para rodadas, respostas de clima (token de equipe, rodada, papel, versão dos itens) e controle de convite. Sem chave estrangeira para `pessoas` ou `respostas`.
4. **Itens versionados** (v0, v1…) com identificador estável. A troca de item vai para a nota técnica (Psi).
5. **Link de clima separado do DISC**, sem reaproveitar sessão ou armazenamento local do teste DISC.
6. **Rodada** com abertura, encerramento, convidados por equipe (liderados diretos ativos) e grupos congelados no encerramento.
7. **Retenção automática** (3.1.8). Sem exportação linha a linha.
8. **Painel** (computador): criar rodada, ver taxa agregada, escrever temas, escolher intervenções, publicar versões por público (dono, líder, equipe, PGR).

---

## 6. Regras de produto e textos obrigatórios

### 6.1 Avisos

**a) Respondente, link coletivo (anônimo).** Base: Ét 5.1, ajustado aos parâmetros desta decisão.

> **Pesquisa de Clima da Equipe · [Empresa]**
>
> **O que é:** perguntas sobre como você percebe o seu trabalho: organização das tarefas, liderança, apoio do time e liberdade para falar. Leva cerca de 5 minutos. Pesquisa para maiores de 18 anos.
>
> **Quem conduz:** a [Empresa] é a responsável pela pesquisa. A Gestão sem Caos cuida da coleta e do relatório em nome dela.
>
> **É voluntário.** Você pode pular perguntas ou parar no meio. Nada muda para você por isso.
>
> **Não pedimos o seu nome.** A resposta não fica ligada a você: não guardamos nome, telefone, e-mail nem endereço de internet junto com ela.
>
> **A empresa só vê resultados de grupo.** Um grupo só aparece no relatório com pelo menos 5 respostas. Detalhes e comentários, só com 10 ou mais. Ninguém da empresa vê a sua resposta nem sabe se você respondeu. Nada aparece antes do fim da pesquisa.
>
> **Comentários:** não escreva nomes de pessoas nem informações sobre a sua saúde. A empresa recebe os comentários resumidos por tema, sem o texto original.
>
> **Para que serve:** orientar melhorias no ambiente de trabalho [e apoiar a identificação de fatores psicossociais no programa de gerenciamento de riscos da empresa (NR-1)]. Não serve para avaliar ninguém individualmente.
>
> **Não é avaliação psicológica** e não avalia a sua saúde.
>
> **Por quanto tempo:** as respostas são apagadas ou viram números de grupo em até [90 dias] depois da entrega do relatório.
>
> **Seus direitos:** como a resposta não fica ligada a você, depois de enviada não é possível encontrá-la para corrigir ou apagar. Dúvidas sobre dados: [canal da Empresa] ou [canal da Gestão sem Caos]. Base legal: [definida pelo advogado], conforme a LGPD (Lei 13.709/2018). [Link: aviso de privacidade completo]
>
> ☐ **Li este aviso e quero responder.**

**b) Variante com link individual (confidencial)** (Ét 5.2)
- Trocar o 4º parágrafo por: "**Seu link é individual só para evitar respostas repetidas.** A Gestão sem Caos guarda o controle de quem já respondeu separado das respostas e nunca o envia à empresa. A empresa só recebe resultados de grupo."
- Trocar "Seus direitos" por: "Até [data de encerramento] você pode pedir para apagar a sua resposta pelo [canal]. Depois disso ela vira número de grupo e não pode mais ser separada."

**c) Líder** [Mod, a partir de Psi e Eq]

> **Sua parte como líder.** Você responde às mesmas perguntas sobre a sua equipe e a três perguntas sobre o seu jeito de liderar. A sua resposta não entra na média da equipe. Você verá a sua visão ao lado da visão da equipe, por tema, e só você e o consultor da Gestão sem Caos veem essa comparação. Ela serve para o seu desenvolvimento e não pode ser usada em avaliação de desempenho, bônus ou ranking de líderes.

**d) Item N4.** Logo depois da pergunta: "Se você está passando por isso, procure [canal da empresa]. Esta pesquisa não é canal de denúncia e não identifica quem respondeu."

**e) DISC de equipe** (acréscimo ao consentimento atual; Ét 5.3)

> O seu resultado descreve estilo de comportamento, não mede competência e não deve ser usado para decisões de desligamento ou salário.

### 6.2 Textos fixos nos relatórios
- **Abertura:** "Clima é a percepção coletiva do ambiente de trabalho. Este relatório não avalia pessoas, não faz diagnóstico de saúde e não é avaliação psicológica."
- **Faixas:** "Faixas de referência provisórias, definidas pela escala de resposta. Não são normas nem comparação com outras empresas."
- **n < 10:** "Estimativa com margem ampla: com menos de 10 respostas, pequenas mudanças de opinião movem bastante o resultado."
- **Opiniões divididas:** "A média não representa bem a equipe. Vale entender as diferentes experiências na conversa de devolutiva."
- **Adesão abaixo de 60%:** "Baixa adesão ([X]% responderam): leia com cautela." (Psi [I])
- **Origem das perguntas:** "Perguntas próprias da Gestão sem Caos, inspiradas em temas estudados pela psicologia organizacional (referências no anexo). Em validação."
- **NR-1** (fusão de Psi e Ét): "Este material apoia a identificação de fatores psicossociais e a consulta aos trabalhadores prevista no gerenciamento de riscos ocupacionais (NR-1). Não substitui o PGR, a avaliação de riscos nem o plano de ação, que são do empregador e do responsável técnico."
- **DISC:** "Os percentuais do DISC são relativos dentro de cada pessoa e somam 100%: mostram o que cada um prioriza, não quanto tem de cada característica. Estilo não é competência."
- **Hipóteses:** "Hipótese para conversa, não conclusão. Há outras explicações possíveis."
- **Uso proibido:** "Não use este relatório para decidir contratação, promoção, desligamento, remanejamento, salário ou bônus."

### 6.3 Nomes de produto

| Permitidos | Proibidos |
|---|---|
| Mapa DISC; questionário de estilo comportamental (autodescrição) | Teste psicológico; avaliação psicológica; perfil psicológico; psicodiagnóstico |
| Relatório de Equipe; Leitura de equipe | Índice de Harmonia; Nota de compatibilidade; Encaixe /100 |
| Pesquisa de Clima da Equipe · Gestão sem Caos | Teste de clima; Avaliação psicológica de equipe |
| Pesquisa de Fatores Psicossociais do Trabalho (apoio ao GRO) | Laudo psicossocial; Diagnóstico NR-1; Avaliação de riscos psicossociais; Certificado ou Selo NR-1 |
| "COPSOQ II-Br" **só** na Trilha B, sem modificação e com citação | "COPSOQ" para versão modificada; "Q12"; "Belbin"; "TCI"; "UWES"; "escala de Edmondson" nos itens próprios |
| "DISC" (maiúsculas) | "DiSC", "Everything DiSC" (marcas ligadas à Wiley [S Ét]) |
| "Gestão sem Caos" em tudo o que cliente, respondente ou leitor vê | "Notus" ou "Notus Agência" em tela ou relatório (CLAUDE.md) |

O Psi usou "Diagnóstico de Clima / NR-1" como nome de etapa. Aqui ele foi trocado, para evitar a leitura de "diagnóstico" como laudo [Mod].

### 6.4 Promessas e palavras proibidas
- **Em venda:**
  - "cumpre / atende / garante conformidade com a NR-1", "evite multas", "laudo";
  - "científico", "validado", "comprovado", "preciso", "prevê desempenho", "aprovado pelo CFP/SATEPSI" (Ét A.3; CDC art. 37 [M]);
  - discurso de medo de multa enquanto as sanções estiverem suspensas pelo STF (Ét).
- **Nos relatórios:**
  - "burnout", "adoecimento", "depressão" ou "ansiedade" como diagnóstico;
  - "equipe tóxica", "assédio" como conclusão, "risco grave", "crítico" (Psi 6.5);
  - "tensão" entre pessoas nomeadas, "harmonia", "tóxico", "travador" (Eq 3.3).
- **"Validado":** só depois da nota técnica de 3.1.10. Até lá, "em validação".

### 6.5 Regras de uso (também no contrato com o cliente)
1. O clima não entra em avaliação de desempenho, bônus ou ranking de líderes (Psi, Eq).
2. A empresa não pode tentar reidentificar respondentes, pedir dados brutos nem "quem respondeu" (Ét, DPA).
3. A devolutiva para a equipe é obrigatória quando a pesquisa é feita (Eq; diretrizes COPSOQ [V Psi]).
4. O DISC não é critério eliminatório nem nota de corte e não ranqueia pessoas (Ét regra 8).
5. Toda decisão sobre pessoas é humana e registrada como tal (Ét regra 11; LGPD art. 20 [S]).

---

## 7. Riscos para o dono decidir

### 7.1 DISC em SELEÇÃO sem psicólogo (o maior risco)

**Fatos**
- A Lei 4.119/1962, art. 13 §1º, reserva ao psicólogo "a utilização de métodos e técnicas psicológicas" para, entre outros fins, a **seleção profissional** [V Ét].
- O CRP-MT cita o DISC nominalmente e trata o uso em recrutamento por não psicólogo como exercício ilegal, com encaminhamento à Polícia Federal (LCP, art. 47) [S Ét].
- Ét **não encontrou** norma nacional do CFP sobre o DISC nem decisão judicial condenando alguém pelo uso. A posição do CRP-MT tem cerca de 5 anos.
- O STF liberou a **venda** de testes (ADI 3481), mas os conselhos sustentam que o **uso** continua privativo [S Ét].
- O fabricante do DiSC original não recomenda usar o teste em triagem pré-contratação [S Ét].
- Não há evidência publicada de validade preditiva do DISC para desempenho [S Ét; Eq].
- O formato ipsativo limita comparar pessoas [M]/[I].

**O que existe hoje no sistema [Cód]**
- Avaliações e processos do tipo `selecao`, e envio do DISC para a tarefa do candidato no ClickUp (SPEC).
- Relatório do processo seletivo com "Perfil ideal para a vaga" e selo de **"Aderência ideal / boa / média / baixa"** por finalista, com o quadro **ordenado por aderência** (`js/relatorio-motor.js`, `aderenciaDisc`). O próprio texto diz que "o DISC não dá nota" e a aderência não entra no score.
- No relatório de equipe, "Encaixe do candidato NN/100" (P13).

**Opções**

| Opção | O que é | Risco que sobra | Custo e efeito |
|---|---|---|---|
| **A. Psicólogo(a) responsável técnico(a)** | Profissional com CRP ativo responde pelo serviço de seleção: escolhe e interpreta os instrumentos; o DISC fica como complemento, nunca eliminatório. Consultar o CRP regional sobre o registro da PJ [M] | Baixo a moderado | Contratação ou parceria; mantém a oferta de seleção |
| **B. Tirar o DISC da seleção** | O DISC passa a ser aplicado só depois da contratação: integração, desenvolvimento, equipe, liderança. Relatórios de seleção sem DISC | Baixo | Perde-se um diferencial da seleção; o resto do produto fica |
| **C. DISC na seleção só como roteiro de entrevista** | Sem perfil ideal, sem aderência, sem ordenação, sem encaixe; decisão humana registrada | **O risco regulatório continua**: a finalidade "seleção profissional" está no texto da lei, seja qual for o nome do instrumento [I Ét]. Caem os riscos técnico e trabalhista | Baixo custo; é medida de transição, não solução |
| **D. Manter como está** | Perfil ideal + aderência + encaixe /100 | Alto (Ét risco 1: probabilidade média, impacto alto) | Nenhum custo agora |

**Recomendação [Mod]**
1. **Já, antes de vender o próximo processo seletivo:** aplicar as medidas da opção C (tirar aderência, ordenação por aderência e encaixe /100) e parar de anunciar o DISC como ferramenta de seleção.
2. **Depois, decidir entre A e B.** Se a seleção é uma linha de receita relevante, A. Se não é, B.
3. **Não tratar C como solução definitiva.**

### 7.2 Outros riscos

| # | Risco | Mitigação decidida | Quem decide |
|---|---|---|---|
| 1 | Quebra de anonimato em empresa pequena: grupo pequeno, subtração, comentários, cruzamento com DISC (Ét: probabilidade alta, impacto alto) | 3.1.7, 3.1.8, 5.9; não aplicar com menos de 5 | Dev + consultor |
| 2 | Itens próprios parecidos demais com itens protegidos | Checagem de não semelhança (3.1.9) | Psicólogo(a) |
| 3 | Promessa de conformidade NR-1 | 6.2 a 6.4; contrato dizendo que o PGR é do cliente | Dono + advogado(a) |
| 4 | Dado de saúde coletado sem base | Trilha A sem itens de saúde; Trilha B com as condições de P7 | Advogado(a) + SST |
| 5 | Ler a licença do COPSOQ como "liberada" sem confirmar | Trilha B só com confirmação escrita | Dono (e-mail) |
| 6 | Mudança da NR-1 na conciliação do STF. As ADPF 1316, 1333 e 1340 suspenderam **sanções**, não a obrigação, até cerca do fim de dez/2026 [S Ét] | Vender como apoio; conferir o andamento antes de cada material | Dono + advogado(a) |
| 7 | Base legal frágil (consentimento sob subordinação) | Legítimo interesse ou obrigação legal, com teste de balanceamento (Ét [I]) | Advogado(a) |
| 8 | Origem dos 25 grupos de palavras do DISC (`js/disc-data.js`): confirmar autoria própria; se houver dúvida, reescrever (Ét regra 30 [I]) | Verificação documental | Dono |
| 9 | Clima usado como bônus ou ranking de líderes | 6.5; contrato | Dono |
| 10 | Consultor cruzar DISC e clima "de cabeça" na reunião com o dono (Eq D2) | Capítulo de hipóteses com regras (5.6) e treino dos consultores | Dono |
| 11 | Transferência internacional (hospedagem, e-mail, pagamento) | Mecanismo do art. 33 [M Ét] | Advogado(a) |
| 12 | ME/EPP achando que está dispensada de gerir riscos psicossociais [S Eq; S Ét] | Texto de venda não promete dispensa; conferir no texto oficial | Advogado(a) + SST |

---

## 8. O que exige profissional humano antes de vender

| Profissional | Tarefa | Bloqueia |
|---|---|---|
| **Psicólogo(a) com CRP ativo** | Checagem de não semelhança dos itens; juiz de conteúdo; revisão de todos os textos de relatório (rótulos, linguagem, dano); decisão sobre "pressão do trabalho" (P13); devolutivas sensíveis (ex.: relatos em N4); **responsável técnico, se a opção 7.1-A for escolhida** | Lançamento do clima; continuidade da seleção com DISC |
| **Psicometrista** (pode ser o mesmo psicólogo) | Entrevista cognitiva; piloto; ω/α, AFC, multinível, invariância; nota técnica; cortes de rwg/AD e limiar de mudança | Uso da palavra "validado"; troca das faixas provisórias |
| **Advogado(a)** de proteção de dados, trabalho e consumidor | Papéis (empresa = controladora; Gestão sem Caos = operadora [I Ét]); base legal; teste de balanceamento; DPA; RIPD; avisos (6.1); retenção; menores; transferência internacional; material de venda sobre NR-1; busca de marca "DISC" no INPI; contratos de licença da Trilha B | Lançamento do clima; venda do complemento NR-1 |
| **Profissional de SST** (engenheiro ou técnico de segurança, médico do trabalho) | Formato do anexo para o responsável pelo PGR; integração ao inventário e ao plano; parceria para quem precisar da avaliação completa; condições de P7 na Trilha B | Venda do complemento NR-1 |
| **Encarregado ou canal do titular** | Responder a titulares em até 15 dias e registrar incidentes [S Ét] | Contínuo, desde o lançamento |
| **Consultor da Gestão sem Caos** (treinado) | Conduzir devolutiva e oficina, escrever temas de comentários, aplicar o formato de hipóteses e o menu de intervenções | Cada entrega |

---

## 9. Pendências de verificação (não usar em texto para cliente antes de conferir)

1. Número exato de itens, redação, escala e cálculo da COPSOQ II-Br curta (PDF de Gonçalves et al., 2021) [S]. O conflito "NC × uso comercial" e as regras de omissão de escalas ficam para a confirmação escrita.
2. Ramalho & Porto (2021): 5 ou 7 itens, escala, itens invertidos [S].
3. Res. CFP 31/2022 no texto oficial (definição de "instrumento não privativo") e lista vigente do SATEPSI [S Ét].
4. Posição nacional do CFP sobre o DISC e eventual jurisprudência (Ét não localizou).
5. Andamento das ADPF 1316, 1333 e 1340 no STF depois de dez/2026 [S Ét].
6. NR-1: itens 1.5.3.3 (consulta) e 1.5.4.4.6 (revisão) [M Eq]; alcance da dispensa de PGR para ME/EPP [S].
7. Cortes de rwg e AD; taxa de resposta de 60%; limiar de ruído de 0,3 a 0,5 ponto [M].
8. Lembrança do moderador sobre a redação do Gallup Q12 e do HSE-IT, usada na checagem de semelhança [M]. Confirmar contra os originais.
9. Modelo demanda-controle (Karasek) como referência de N2 [M].
10. Retenção de 90 dias e 12 meses; base legal; art. 14 da LGPD para menores [I]/[M].
11. **Resolvido pelo moderador [Cód]:** Ét apontou que `docs/SPEC.md` (linha ~268) diria "conduzida pela Notus". O texto atual diz "conduzida pela Gestão sem Caos". As menções a "Notus" que restam na SPEC tratam do sistema visual interno, o que o CLAUDE.md permite.
