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
-- Parte 2 (migração 20261008120000_parte2.sql): EQP1 com formulario.parte2 'ligada' e o perfil exigido de
-- quem respondeu por ele (Carla e Renata com esforço de adaptação alto; Diego quase igual ao natural).
-- Fotos (migração 20261009120000_fotos.sql): avatares fictícios (iniciais) para Ana, Carla, Diego, Marta e Renata.
-- Rodada 4 (migração 20261010120000_mover_versao.sql): a Marta fica gravada no topo do organograma
-- (empresas.organograma.topoIds).
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

-- -----------------------------------------------------------------------------
-- Parte 2: perfil exigido pelo trabalho (rodada parte2) — mesmos valores de js/api-simulada.js
-- -----------------------------------------------------------------------------

update public.processos
set config = jsonb_set(config, '{formulario}', coalesce(config -> 'formulario', '{}'::jsonb) || '{"parte2": "ligada"}'::jsonb)
where codigo = 'EQP1' and not coalesce(config -> 'formulario' ? 'parte2', false);

update public.respostas r
set exigido = x.exigido, payload = r.payload || jsonb_build_object('exigido', x.exigido)
from (values
    ('previa-exemplo-03', '4312342134214312342134214312342134214312'),
    ('previa-exemplo-04', '3421431243123421431243123421431243123421'),
    ('previa-exemplo-06', '3214412341234123321441234123412332144123'),
    ('previa-exemplo-07', '4123312431244123312431244123312431244123'),
    ('previa-exemplo-08', '1342243124312431134224312431243113422431'),
    ('previa-exemplo-09', '3124421342133124421342133124421342133124')
) as x(id, exigido)
where r.id = x.id and r.exigido is null;

-- -----------------------------------------------------------------------------
-- Fotos (migração 20261009120000_fotos.sql): avatares FICTÍCIOS (iniciais sobre a cor do fator principal
-- do DISC, JPEG 192 px gerado por código; nenhuma foto de gente real) — mesmos de js/api-simulada.js.
-- Ana, Carla, Diego e Marta têm a foto na ficha e na resposta; Renata só na ficha (envio sem foto não apaga).
-- -----------------------------------------------------------------------------

with avatares (telefone, resposta, foto) as (
  values
    ('5511900000001', 'previa-exemplo-05',
     'data:image/jpeg;base64,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'),
    ('5511900000003', 'previa-exemplo-03',
     'data:image/jpeg;base64,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'),
    ('5511900000004', 'previa-exemplo-04',
     'data:image/jpeg;base64,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'),
    ('5511900000006', 'previa-exemplo-06',
     'data:image/jpeg;base64,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'),
    ('5511900000009', '',
     'data:image/jpeg;base64,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')
), pes as (
  update public.pessoas p set foto = a.foto
  from avatares a where p.telefone = a.telefone and p.foto is null
  returning p.id
)
update public.respostas r set foto = a.foto
from avatares a where r.id = a.resposta and r.foto is null;

-- -----------------------------------------------------------------------------
-- Topo do organograma (migração 20261010120000_mover_versao.sql): a Marta, que dirige a Clínica Exemplo.
-- -----------------------------------------------------------------------------

update public.empresas e
set organograma = coalesce(e.organograma, '{}'::jsonb) || jsonb_build_object('topoIds', jsonb_build_array(p.id::text))
from public.pessoas p
where e.id = '5eed0000-0000-4000-8000-000000000001' and p.telefone = '5511900000006'
  and not coalesce(e.organograma ? 'topoIds', false);
