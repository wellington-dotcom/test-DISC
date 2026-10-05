-- =============================================================================
-- Teste DISC — dados de EXEMPLO (opcional). Só para testar o painel num projeto de teste do Supabase.
-- NÃO rode no projeto de verdade. Rode DEPOIS das migrações (supabase/migrations/, em ordem). Pode rodar
-- de novo sem erro (não duplica nada). Para apagar:
--   delete from public.vinculos where empresa_id = '5eed0000-0000-4000-8000-000000000001';
--   delete from public.empresas where id = '5eed0000-0000-4000-8000-000000000001';
--   delete from public.respostas where id like 'previa-%';
--   delete from public.processos where codigo in ('SEL1', 'EQP1', 'ATD1');
--   delete from public.pessoas where telefone like '55119000000%';
-- Mesmos exemplos da prévia (js/api-simulada.js): processos SEL1 (seleção), EQP1 (equipe, mostra
-- resultado) e ATD1 (formulário próprio: e-mail obrigatório, cidade opcional e 1 pergunta extra) e
-- 9 respostas fictícias — a Ana respondeu 2 vezes (SEL1 e ATD1): a mesma pessoa no painel.
-- Empresa "Clínica Exemplo" (SEL1 e EQP1 ligados a ela) com 7 colaboradores ativos em 3 níveis
-- (Marta dirige; Diego e Paulo lideram áreas; Carla, Lucas, Renata e Tiago — este sem teste — são
-- liderados), relações de convivência direta/indireta e o Bruno desligado no histórico.
-- =============================================================================

insert into public.processos (codigo, nome, tipo, empresa, vaga, mostrar_resultado, ativo, config)
values
  ('SEL1', 'Recepcionista 2026', 'selecao', 'Clínica Exemplo', 'Recepcionista', false, true,
   '{"perfilIdeal": "IS", "corte": 70, "faixaAvaliar": 55, "etapas": [], "bonus": []}'::jsonb),
  ('EQP1', 'Equipe comercial', 'equipe', 'Clínica Exemplo', '', true, true, '{}'::jsonb),
  ('ATD1', 'Atendimento ao cliente', 'selecao', 'Clínica Exemplo', 'Atendente', true, true,
   '{"perfilIdeal": "IS", "corte": 70, "faixaAvaliar": 55, "etapas": [], "bonus": [],
     "formulario": {"campos": {"idade": "obrigatorio", "funcao": "opcional", "empresa": "opcional",
                               "email": "obrigatorio", "cidade": "opcional"},
                    "perguntas": [{"id": "p1", "texto": "Qual sua disponibilidade de horário?", "obrigatoria": true}]}}'::jsonb)
on conflict (codigo) do nothing;

with exemplos (id, nome, telefone, idade, codigo, vaga, funcao, empresa, email, cidade, extras, respostas, status, observacoes, protocolo, dias) as (
  values
    ('previa-exemplo-01', 'Ana Exemplo Prévia', '5511900000001', 27, 'SEL1', 'Recepcionista', 'Atendente', 'Padaria Fictícia', '', '', '[]'::jsonb,
     repeat('2431', 13) || repeat('3421', 12), 'aprovado', 'Exemplo da prévia: boa entrevista.', '01A', 6),
    ('previa-exemplo-02', 'Bruno Teste Fictício', '5511900000002', 35, 'SEL1', 'Recepcionista', 'Auxiliar administrativo', 'Loja Imaginária', '', '', '[]'::jsonb,
     repeat('4132', 13) || repeat('3142', 12), 'em_analise', '', '02B', 4),
    ('previa-exemplo-03', 'Carla Modelo Demonstração', '5511900000003', 41, 'EQP1', '', 'Vendedora', '', '', '', '[]'::jsonb,
     repeat('1243', 13) || repeat('1234', 12), 'em_analise', '', '03C', 3),
    ('previa-exemplo-04', 'Diego Exemplo Simulado', '5511900000004', 30, 'EQP1', '', 'Supervisor de vendas', '', '', '', '[]'::jsonb,
     repeat('4312', 13) || repeat('3421', 12), 'em_analise', '', '04D', 1),
    ('previa-exemplo-05', 'Ana Exemplo Prévia', '5511900000001', 27, 'ATD1', 'Atendente', 'Atendente', 'Padaria Fictícia',
     'ana.exemplo@exemplo.com', 'Boa Vista / RR',
     '[{"id": "p1", "pergunta": "Qual sua disponibilidade de horário?", "resposta": "Manhã e tarde, de segunda a sábado."}]'::jsonb,
     repeat('2431', 12) || repeat('3421', 13), 'em_analise', '', '05E', 2),
    -- Colaboradores da Clínica Exemplo que responderam pelo link de equipe (EQP1)
    ('previa-exemplo-06', 'Marta Exemplo Diretora', '5511900000006', 48, 'EQP1', '', 'Diretora geral', '', '', '', '[]'::jsonb,
     '3124421342133124421342133124421342133124421342133124421342133124421342133124421342133124421342133124', 'em_analise', '', '06F', 9),
    ('previa-exemplo-07', 'Paulo Modelo Fictício', '5511900000007', 39, 'EQP1', '', 'Coordenador de atendimento', '', '', '', '[]'::jsonb,
     '1243213421342134124321342134213412432134213421341243213421342134124321342134213412432134213421341243', 'em_analise', '', '07G', 8),
    ('previa-exemplo-08', 'Lucas Fictício Exemplo', '5511900000008', 26, 'EQP1', '', 'Vendedor', '', '', '', '[]'::jsonb,
     '4312342134214312342134214312342134214312342134214312342134214312342134214312342134214312342134214312', 'em_analise', '', '08H', 7),
    ('previa-exemplo-09', 'Renata Exemplo Fictícia', '5511900000009', 33, 'EQP1', '', 'Recepcionista', '', '', '', '[]'::jsonb,
     '2431134213421342243113421342134224311342134213422431134213421342243113421342134224311342134213422431', 'em_analise', '', '09J', 5)
),
calculado as (
  select e.*, disc_interno.calcular_disc(e.respostas) as disc, p.id as processo_id,
         now() - make_interval(days => e.dias) as recebido
  from exemplos e left join public.processos p on p.codigo = e.codigo
)
-- A pessoa (public.pessoas) de cada resposta é criada/ligada pelo gatilho respostas_ligar_pessoa.
insert into public.respostas (id, processo_id, avaliacao, protocolo, recebido_em, nome, telefone, idade, vaga, funcao,
  empresa, email, cidade, extras, inicio, fim, duracao_seg, respostas, d, i, s, c, perfil, validacao, status, observacoes, payload)
select c.id, c.processo_id, c.codigo, c.protocolo, c.recebido, c.nome, c.telefone, c.idade, c.vaga, c.funcao,
  c.empresa, c.email, c.cidade, c.extras, c.recebido - interval '9 minutes', c.recebido, 540, c.respostas,
  (c.disc #>> '{percentuais,D}')::numeric, (c.disc #>> '{percentuais,I}')::numeric,
  (c.disc #>> '{percentuais,S}')::numeric, (c.disc #>> '{percentuais,C}')::numeric,
  c.disc ->> 'codigo', null, c.status, c.observacoes,
  jsonb_build_object('v', 1, 'id', c.id, 'nome', c.nome, 'telefone', c.telefone, 'idade', c.idade,
    'funcao', c.funcao, 'empresa', c.empresa, 'email', c.email, 'cidade', c.cidade, 'extras', c.extras,
    'vaga', c.vaga, 'consentimento', true,
    'inicio', disc_interno.iso(c.recebido - interval '9 minutes'), 'fim', disc_interno.iso(c.recebido),
    'duracaoSeg', 540, 'respostas', c.respostas,
    'resultado', jsonb_build_object('percentuais', c.disc -> 'percentuais', 'codigo', c.disc -> 'codigo'),
    'avaliacao', c.codigo, 'validacao', null)
from calculado c
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Empresa, colaboradores e organograma (rodada empresas/equipes)
-- -----------------------------------------------------------------------------

insert into public.empresas (id, nome, cidade, observacoes)
values ('5eed0000-0000-4000-8000-000000000001', 'Clínica Exemplo', 'Boa Vista / RR',
  'Empresa fictícia da prévia: clínica com recepção, atendimento e equipe comercial.')
on conflict (id) do nothing;

update public.processos set empresa_id = '5eed0000-0000-4000-8000-000000000001'
where codigo in ('SEL1', 'EQP1') and empresa_id is null;

-- Colaborador ainda sem teste (cadastrado só com nome e WhatsApp).
insert into public.pessoas (telefone, nome, funcao)
values ('5511900000010', 'Tiago Modelo Sem Teste', 'Auxiliar administrativo')
on conflict (telefone) do nothing;

insert into public.vinculos (pessoa_id, empresa_id, cargo, area, status, inicio, fim)
select p.id, '5eed0000-0000-4000-8000-000000000001', x.cargo, x.area, x.status,
  current_date - x.desde, case when x.status = 'desligado' then current_date - 60 end
from (values
  ('5511900000006', 'Diretora geral', 'Diretoria', 'ativo', 900),
  ('5511900000004', 'Supervisor de vendas', 'Comercial', 'ativo', 500),
  ('5511900000007', 'Coordenador de atendimento', 'Atendimento', 'ativo', 420),
  ('5511900000003', 'Vendedora', 'Comercial', 'ativo', 300),
  ('5511900000008', 'Vendedor', 'Comercial', 'ativo', 120),
  ('5511900000009', 'Recepcionista', 'Atendimento', 'ativo', 200),
  ('5511900000010', 'Auxiliar administrativo', 'Atendimento', 'ativo', 30),
  ('5511900000002', 'Auxiliar administrativo', 'Atendimento', 'desligado', 400)
) as x(telefone, cargo, area, status, desde)
join public.pessoas p on p.telefone = x.telefone
where not exists (select 1 from public.vinculos v
                  where v.pessoa_id = p.id and v.empresa_id = '5eed0000-0000-4000-8000-000000000001')
  and (x.status = 'desligado' or not exists (select 1 from public.vinculos v where v.pessoa_id = p.id and v.status = 'ativo'));

insert into public.relacoes (empresa_id, de_pessoa, para_pessoa, tipo)
select '5eed0000-0000-4000-8000-000000000001', a.id, b.id, x.tipo
from (values
  ('5511900000006', '5511900000004', 'lidera'),
  ('5511900000006', '5511900000007', 'lidera'),
  ('5511900000004', '5511900000003', 'lidera'),
  ('5511900000004', '5511900000008', 'lidera'),
  ('5511900000007', '5511900000009', 'lidera'),
  ('5511900000007', '5511900000010', 'lidera'),
  ('5511900000004', '5511900000007', 'direto'),
  ('5511900000003', '5511900000008', 'direto'),
  ('5511900000008', '5511900000009', 'indireto')
) as x(de_tel, para_tel, tipo)
join public.pessoas a on a.telefone = x.de_tel
join public.pessoas b on b.telefone = x.para_tel
on conflict (empresa_id, de_pessoa, para_pessoa) do nothing;
