# Multiempresa — plano de implementação (Gestão sem Caos · sistema DISC)

> Escrito pelo agente arquiteto (sessão só leitura) e salvo aqui pela sessão principal, sem alterações de conteúdo.
> Escopo: cada empresa cliente tem seus usuários (dono/RH) que veem e operam **só** os dados da própria empresa; a
> Gestão sem Caos (dono do sistema) continua vendo e operando tudo. Pré-requisito para a assinatura B2B (Stripe Billing,
> fora deste plano). Base lida: CLAUDE.md, docs/SPEC.md, docs/SUPABASE.md, as 11 migrações (20261005…20261015),
> supabase/funcoes-compartilhadas/{admin,http,supabase-adaptadores}.js, js/api-supabase.js, js/admin.js.

## Resumo
1. Inquilino = `empresas`. Nova tabela `membros` (empresa_id, user_id, papel `admin_empresa`|`leitor`); `admins` ganha
   `papel` (`dono`|`consultor`), todos os admins atuais viram `dono` (zero perda para o dono).
2. `respostas` ganha `empresa_id` (gatilho a partir do processo; B2C/link geral = nulo, visível só para interno; B2C só dono).
3. Ponto crítico: `pessoas` é global por WhatsApp e é sobrescrita por envios de qualquer empresa e do B2C → vazaria
   e-mail/foto/cidade entre clientes; `salvar_colaborador`/`mover_colaborador`/`contratar_pessoa` mexem em outra empresa e
   revelam o nome dela. Solução: ficha por empresa (`pessoas.empresa_id`, `unique nulls not distinct (empresa_id, telefone)`)
   com separação atômica dos dados atuais, conferida no próprio bloco.
4. Segurança no banco (RLS) com `e_dono()`, `minhas_empresas()`, `minhas_empresas_edicao()`, `pode_editar_empresa()`,
   `meu_acesso()`; uma política por comando; B2C e `configuracoes` só `e_dono()`.
5. 12 funções SECURITY DEFINER revistas; fora do escopo responde igual a "não encontrado". Na Edge Function `admin`, cada
   ação tem `quem`; para membro, toda leitura pelo JWT do usuário (RLS), nunca pela chave de serviço.
6. Convite sem SMTP: `auth.admin.generateLink` → link `admin.html#convite-<hash>` copiável/WhatsApp; aceito só no clique
   (`verifyOtp`), porque a prévia do WhatsApp gastaria o token. Nunca gerar link para conta existente.
7. Painel: seletor de empresa para dono/consultor; usuário da empresa não vê Vendas, Página de venda, Conexões, Importar,
   ClickUp, IA nem a faixa do banco; leitor só lê.
8. Testes: `tests/supabase/multiempresa.test.js` (matriz de 7 usuários) + guardas automáticos (função definer nova, grant a
   anon ou política não classificada fazem o teste falhar); e2e na prévia.
9. Migração aditiva → preenchimento → troca de políticas; idempotente; qualquer combinação de versões (painel/banco/função)
   continua funcionando.
10. 9 etapas, ~29 pontos; o dono não vê mudança até a etapa 6 (convites).
11. Riscos: limites globais (2.000 respostas, 40 envios/10 min, 2.400 protocolos) viram ataque entre clientes; códigos de
    processo de 4 caracteres são varríveis; observações internas visíveis ao cliente.
12. Decisões do dono: consultor agora ou depois; o que o cliente vê de observações/rascunhos; validade do link (OTP 24 h);
    LGPD (controlador × operador).

## 1. Como está hoje
| Dado | Tabela | Liga à empresa? | Observação |
|---|---|---|---|
| Empresas clientes | `empresas` | é a própria | `observacoes` é nota **interna** da consultoria |
| Processos (links) | `processos` | `empresa_id` opcional (on delete set null) + texto `empresa` | processos antigos podem estar sem `empresa_id` |
| Respostas | `respostas` | não; só via `processo_id → processos.empresa_id` (histórico importado: só pelo código `avaliacao`) | `origem='pessoal'` = B2C |
| Pessoas | `pessoas` | não; global por WhatsApp (`unique(telefone)`) | sobrescrita por envio de qualquer processo; completada pelo B2C (`respostas_ligar_pessoa`) |
| Colaboradores | `vinculos` | `empresa_id` not null | "1 vínculo ativo por pessoa" global |
| Organograma | `relacoes` | `empresa_id` not null | |
| Relatórios | `relatorios` | `processo` via processo; `equipe`/`lideranca` com `empresa_id`; `pessoa` gerado pelo detalhe sai com `empresa_id` nulo | FK `empresa_id on delete cascade` |
| Config/ClickUp | `configuracoes` | global (interno) | |
| B2C | `pacotes`, `cupons`, `pedidos`, `limites_vendas` | global (dono) | |
| Usuários | `admins` + Auth | — | `e_admin()` vê tudo |

Vazamentos se só se acrescentassem usuários de empresa: ficha global (A veria dados dados a B ou ao B2C); `enviar_resposta`
de B escreve na ficha que A vê; `salvar_colaborador` revela "outra empresa (Nome)"; `mover_colaborador`/`contratar_pessoa`
desligam vínculo na outra empresa; `remover_foto` apaga em todas as empresas; Edge Function `admin` usa chave de serviço e
só confere `e_admin()`.

## 2. Modelo de dados
### 2.1 Papéis
| Papel | Onde | Vê | Opera | Não vê |
|---|---|---|---|---|
| Dono do sistema | `admins.papel='dono'` (todos de hoje) | tudo | tudo | — |
| Consultor (opcional) | `admins.papel='consultor'` | todas as empresas, processos, respostas de processo, relatórios, ClickUp | como o dono nos dados de clientes | vendas B2C, respostas `pessoal`, Conexões, Usuários internos, `configuracoes` |
| Admin da empresa | `membros.papel='admin_empresa'` | só empresas em que é membro (e `ativo`) | processos sem ClickUp, respostas (status, observações, excluir), colaboradores, organograma, relatórios por modelo, publicar, enviar por e-mail, convidar membros da própria empresa | outras empresas, internas, B2C, Conexões, ClickUp, IA |
| Leitor da empresa | `membros.papel='leitor'` | igual ao admin da empresa | nada | idem |

"Interno" = dono ou consultor = `e_admin()` (nome e significado mantidos). Um usuário pode ser membro de várias empresas
(cobre holding). Assinatura B2B futura por `empresa_id`.

### 2.2 Tabelas e colunas
- `admins.papel text not null check (papel in ('dono','consultor'))`; preenchimento `dono`; padrão para novas `consultor`;
  sem grant de coluna para `authenticated`.
- `membros` (nova): id uuid pk, empresa_id → empresas on delete cascade, user_id → auth.users on delete cascade,
  papel ('admin_empresa'|'leitor'), nome ≤120, ativo default true, convidado_por, criado_em; unique(empresa_id, user_id);
  índice (user_id). Escrita só pela Edge Function.
- `respostas.empresa_id → empresas on delete set null` + índice (empresa_id, recebido_em); gatilho é a fonte da verdade;
  `pessoal` → nulo.
- `pessoas.empresa_id → empresas on delete cascade` (nulo = base interna); `unique nulls not distinct (empresa_id, telefone)`
  (Postgres ≥ 15 — conferir na etapa 0).
- `relatorios`: sem coluna nova; empresa efetiva = `coalesce(empresa_id, processos.empresa_id)` (copiar a empresa faria o
  cascade apagar relatórios de processo ao excluir a empresa).
- Etapa 8: `empresas_notas` para tirar a nota interna do alcance do cliente.

### 2.3 Regras de pertencimento
- I1: resposta com `empresa_id = X` → `pessoa_id` nulo ou ficha da empresa X.
- I2: resposta interna (empresa nula, origem processo) pode apontar para qualquer ficha; B2C só ficha nula.
- I3: `vinculos`, `relacoes` (as duas pessoas) e `relatorios.pessoa_id` → ficha da mesma empresa.
- I4: "1 vínculo ativo por pessoa" por empresa; aviso "já é colaboradora de outra empresa (X)" só para interno.

### 2.4 Ficha por empresa (alternativa B escolhida; A — ficha global com visibilidade por vínculo — vaza; C — tabela
`fichas` — exige reescrever embeds). Separação (etapa 4) num único `do $$…$$`:
1. Cópia em `disc_backup.<tabela>_20261018` (sem grants; apagar em 30 dias).
2. E(p) = empresas das respostas, vínculos, relações e relatórios da ficha.
3. |E|=0 → nula; |E|=1 → X; |E|≥2 → principal (vínculo ativo, senão atividade mais recente) + uma cópia por empresa.
4. Repontar respostas, vínculos, relações, relatórios; B2C → ficha nula do telefone; internas na principal.
5. Campos de cada ficha refeitos só com respostas da própria empresa.
6. Trocar o índice único.
7. Conferência no mesmo bloco; qualquer contagem ≠ 0 → `raise exception`.

### 2.5 B2C
Respostas `pessoal`, pedidos, cupons, pacotes só com `e_dono()`; `enviar_resposta_pessoal` e `respostas_ligar_pessoa`
ligam só à ficha `(null, telefone)`.

## 3. Segurança
### 3.1 Auxiliares (public; execute só authenticated e service_role)
`e_dono()`, `minhas_empresas()`, `minhas_empresas_edicao()`, `pode_editar_empresa(uuid)`, `meu_acesso()` (json
{ok, interno, empresas:[{id,nome,papel}]}). Nas políticas usar `(select public.e_admin())` e
`empresa_id in (select public.minhas_empresas())`.

### 3.2 Políticas (I = interno, D = dono, M = empresa ∈ minhas, Me = ∈ minhas de edição)
| Tabela | select | insert | update | delete | Notas |
|---|---|---|---|---|---|
| admins | I | D | o próprio (nome) ou D | D | papel nunca pelo PostgREST; sempre ≥1 dono |
| membros | I · próprio · pode_editar | — | — | — | escrita só Edge Function |
| empresas | I · id ∈ minhas | I | I | I | |
| processos | I · M | I · Me | I · Me | I · Me | membro não troca empresa nem grava clickup_list_id |
| respostas | D · (I e processo) · M | — | status, observacoes: D · (I e processo) · Me | idem | empresa_id só pelo gatilho |
| pessoas | D · (I e não só-B2C) · M | — | — | I | |
| vinculos | I · M | I · Me | I · Me | I · Me | I3 |
| relacoes | I · M | I · Me | I · Me | I · Me | I3 |
| relatorios | I · (empresa efetiva ∈ minhas e (modelo<>'processo' ou publicado)) | I · (Me, modelo<>'processo', pessoa da mesma empresa) | idem | idem | membro não troca empresa/pessoa/modelo/processo/token |
| configuracoes | D | D | D | D | |
| pacotes | D | — | D | — | |
| cupons | D | D | D | D | |
| pedidos | D | — | — | — | só `atualizar_pedido` |
| limites_vendas | — | — | — | — | |

### 3.3 Gatilhos novos
`respostas_empresa`, `processos_realocar`, `vinculos_mesma_empresa`, `relatorios_coerencia`, `processos_protecao_membro`
(só age com current_user = 'authenticated'), `admins_antes_excluir` (≥1 dono).

### 3.4 Funções SECURITY DEFINER
| Função | Depois |
|---|---|
| e_admin() | igual (= interno) |
| garantir_primeiro_admin() | insere dono; nunca promove membro |
| salvar_minha_foto | interno |
| remover_foto | interno: todas do telefone; membro: só da empresa da resposta; fora → "Candidato não encontrado." |
| salvar_colaborador | pode_editar_empresa; pessoaId da empresa ("Pessoa não encontrada."); interno cria/aproveita ficha (empresa, telefone) copiando só nome; aviso "outra empresa" só interno |
| mover_colaborador | interno ou admin da origem e do destino |
| salvar_relacoes | pode_editar_empresa |
| mover_resposta | interno: qualquer destino; membro: mesma empresa editável, sem '' |
| contratar_pessoa | membro: só da própria empresa; interno como hoje |
| atualizar_pedido, resumo_vendas | e_dono |
| respostas_ligar_pessoa | ficha (empresa, telefone); B2C nula |

### 3.5 RPCs públicas
`enviar_resposta`: upsert por (empresa, telefone); id repetido de outro processo → recusado. `enviar_resposta_pessoal`:
ficha nula. `avaliacao_publica`: risco de varredura dos códigos de 4 caracteres → etapa 8 (códigos longos + limite por IP).
Demais (token aleatório): sem mudança.

### 3.6 Edge Function `admin`
`criarAutenticador` chama `meu_acesso` (fallback `e_admin` = dono); cada ação com `quem`:
conexoes.*, usuarios.* → dono; clickup.*, processo.dados, relatorio.rascunho/salvar/publicar/despublicar/melhorarTextos →
interno; relatorios.listar → interno (serviço) / membro (JWT); relatorio.enviarEmail → interno; admin da empresa lendo pelo
JWT, limite por usuário e empresa; membros.* (novas) → dono, consultor, admin da própria empresa. Membro nunca lê dado de
cliente pela chave de serviço.

### 3.7 Guardas automáticos
Lista fechada de funções prosecdef classificadas; lista fechada do que anon executa; toda tabela com RLS; nenhuma política
`true`; toda política de authenticated cita e_admin/e_dono/minhas_empresas/auth.uid().

## 4. Migração em produção
Princípios: aditivo → preencher → políticas → limpar; idempotente; versao_banco/MIGRACOES/VERSAO_BANCO; `notify pgrst`;
movimentação em um `do $$` com conferência; qualquer combinação de versões funciona; até a etapa 6 não há membros.

Arquivos: `20261016120000_papeis.sql`, `20261017120000_respostas_empresa.sql`, `20261018120000_fichas_por_empresa.sql`,
`20261019120000_rls_empresas.sql`, `20261020120000_capacidade_empresa.sql` (numeração a ajustar se outra migração ocupar
o número antes).

Conferências (todas devem dar 0): divergentes respostas×processos; B2C com empresa; I1; B2C com ficha de empresa; I3
vínculos; I3 relações; duplicados (empresa, telefone); totais iguais à cópia. Simular membro no SQL Editor com
`set local role authenticated` + `request.jwt.claims` dentro de begin/rollback. Antes da etapa 3: listar processos sem
empresa cujas respostas são de colaboradores de uma só empresa (o dono decide ligar).

Ensaio com dump no Postgres embutido local (apagar depois). Volta atrás: SQL de retorno no guia (políticas `*_admin`);
etapa 3 pelas tabelas de `disc_backup`.

## 5. Convite (sem e-mail)
OTP 24 h (Authentication → Email). A: pessoa nova → `membros.convidar` → `generateLink({type:'invite'})` sem e-mail →
link `admin.html#convite-<hashed_token>-invite` (nunca em log) → Copiar / WhatsApp / Enviar por e-mail (Resend, se
configurado) → tela "Aceitar convite" → `verifyOtp` só no clique → definir senha → entra. Expirado: "Gerar novo link"
(recovery, enquanto nunca entrou). B: conta existente → só grava membros, resposta neutra, sem link. C: "Gerar link de nova
senha": dono para qualquer um exceto outro dono; admin da empresa só se administra todas as empresas da pessoa e ela não é
interna. Limite 20 convites/h.

## 6. Painel
api-supabase: `meu_acesso` em concluirEntrada/sessaoAtual/eu; `usuario = {papel, interno, empresas, empresaId, empresaNome}`;
`itemDaLinha.empresaId`; métodos novos (meuAcesso, listarMembros, convidarMembro, mudarPapelMembro, removerMembro,
gerarLinkSenha, aceitarConvite); api.js recusa. admin.js: `capacidades(usuario)` substitui os `papel() === 'admin'`;
seletor de empresa no topo (filtro de tela; segurança é a RLS); o que some para membro (Vendas, Página de venda, Conexões,
Importar, Usuários internos → "Acessos", faixa do banco, Origem, ClickUp, rascunho, IA, cadastrar/editar empresa, mover
entre empresas, Minha foto); leitor sem botões de escrita; interno agrupa participantes por telefone. Prévia: segunda
empresa e usuários `rh@previa.com` / `leitura@previa.com` (não reaproveitar `gestor`). Prévia estática para aprovação.

## 7. Testes
tests/supabase/multiempresa.test.js (dados "de produção" com mesmo telefone em PA, PB, P0 e B2C; migrações aplicadas duas
vezes; usuários DONO, CONSULTOR, ADM_A, LEITOR_A, ADM_B, MULTI, SEM; matriz de leitura, escrita direta, RPCs, público,
gatilhos e guardas); tests/funcoes/admin.test.js (matriz `quem`); api-supabase, admin, api-simulada; e2e
tests/e2e/multiempresa.spec.js na prévia.

## 8. Riscos (resumo)
Definer esquecida (inventário + guardas); separação corromper (bloco atômico + backup + ensaio); dono perder visão
unificada (agrupar por telefone); limites globais e varredura de códigos (etapa 8 antes de vender B2B); tomada de conta por
link (nunca gerar para conta existente); enumeração de e-mails (resposta neutra + limite); WhatsApp gastar link (fragmento +
clique); nota interna visível (empresas_notas, processo só publicado); consultor excluindo sem filtro; LGPD controlador ×
operador (termos e privacidade — dono/jurídico).

## 9. Etapas
| # | Etapa | Dono vê | Esforço |
|---|---|---|---|
| 0 | Preparo (versão do Postgres, ensaio, decisões, OTP) | nada | 1 |
| 1 | Papéis internos | nada | 3 |
| 2 | Empresa nas respostas | nada | 2 |
| 3 | Seletor de empresa (interno) | filtro | 2 |
| 4 | Fichas por empresa | mesma pessoa unificada por telefone | 5 |
| 5 | RLS por empresa | nada | 5 |
| 6 | Convites e acessos | convidar piloto | 3 |
| 7 | Painel do cliente | o piloto usa | 5 |
| 8 | Capacidade e anti-abuso por empresa | antes de vender B2B | 3 |
| 9 | Stripe Billing (depois) | — | — |
Dependências: 2 → 3/4; 4 → 5; 5 → 6 → 7. Etapa 1 independente.

## 10. Depende do dono
Consultor já ou depois; cliente vê observações/rascunhos/nota da empresa?; membro cria processos na v1?; validade do link
(24 h); confirmar que todos os admins atuais são "dono"; cliente piloto; LGPD e termos; aprovar prévia; SMTP (opcional).
