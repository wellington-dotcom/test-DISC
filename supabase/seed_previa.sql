-- =============================================================================
-- Teste DISC — dados de EXEMPLO (opcional). Só para testar o painel num projeto de teste do Supabase.
-- NÃO rode no projeto de verdade. Rode DEPOIS de migrations/001_disc.sql. Pode rodar de novo sem erro
-- (não duplica nada). Para apagar: delete from public.respostas where id like 'previa-%';
--                                  delete from public.processos where codigo in ('SEL1', 'EQP1');
-- Mesmos exemplos da prévia (js/api-simulada.js): processos SEL1 (seleção) e EQP1 (equipe, mostra
-- resultado) e 4 respostas fictícias.
-- =============================================================================

insert into public.processos (codigo, nome, tipo, empresa, vaga, mostrar_resultado, ativo, config)
values
  ('SEL1', 'Recepcionista 2026', 'selecao', 'Clínica Exemplo', 'Recepcionista', false, true,
   '{"perfilIdeal": "IS", "corte": 70, "faixaAvaliar": 55, "etapas": [], "bonus": []}'::jsonb),
  ('EQP1', 'Equipe comercial', 'equipe', 'Clínica Exemplo', '', true, true, '{}'::jsonb)
on conflict (codigo) do nothing;

with exemplos (id, nome, telefone, idade, codigo, vaga, funcao, empresa, respostas, status, observacoes, protocolo, dias) as (
  values
    ('previa-exemplo-01', 'Ana Exemplo Prévia', '5511900000001', 27, 'SEL1', 'Recepcionista', 'Atendente', 'Padaria Fictícia',
     repeat('2431', 13) || repeat('3421', 12), 'aprovado', 'Exemplo da prévia: boa entrevista.', '01A', 6),
    ('previa-exemplo-02', 'Bruno Teste Fictício', '5511900000002', 35, 'SEL1', 'Recepcionista', 'Auxiliar administrativo', 'Loja Imaginária',
     repeat('4132', 13) || repeat('3142', 12), 'em_analise', '', '02B', 4),
    ('previa-exemplo-03', 'Carla Modelo Demonstração', '5511900000003', 41, 'EQP1', '', 'Vendedora', '',
     repeat('1243', 13) || repeat('1234', 12), 'em_analise', '', '03C', 3),
    ('previa-exemplo-04', 'Diego Exemplo Simulado', '5511900000004', 30, 'EQP1', '', 'Supervisor de vendas', '',
     repeat('4312', 13) || repeat('3421', 12), 'em_analise', '', '04D', 1)
),
calculado as (
  select e.*, disc_interno.calcular_disc(e.respostas) as disc, p.id as processo_id,
         now() - make_interval(days => e.dias) as recebido
  from exemplos e left join public.processos p on p.codigo = e.codigo
)
insert into public.respostas (id, processo_id, avaliacao, protocolo, recebido_em, nome, telefone, idade, vaga, funcao,
  empresa, inicio, fim, duracao_seg, respostas, d, i, s, c, perfil, validacao, status, observacoes, payload)
select c.id, c.processo_id, c.codigo, c.protocolo, c.recebido, c.nome, c.telefone, c.idade, c.vaga, c.funcao,
  c.empresa, c.recebido - interval '9 minutes', c.recebido, 540, c.respostas,
  (c.disc #>> '{percentuais,D}')::numeric, (c.disc #>> '{percentuais,I}')::numeric,
  (c.disc #>> '{percentuais,S}')::numeric, (c.disc #>> '{percentuais,C}')::numeric,
  c.disc ->> 'codigo', null, c.status, c.observacoes,
  jsonb_build_object('v', 1, 'id', c.id, 'nome', c.nome, 'telefone', c.telefone, 'idade', c.idade,
    'funcao', c.funcao, 'empresa', c.empresa, 'vaga', c.vaga, 'consentimento', true,
    'inicio', disc_interno.iso(c.recebido - interval '9 minutes'), 'fim', disc_interno.iso(c.recebido),
    'duracaoSeg', 540, 'respostas', c.respostas,
    'resultado', jsonb_build_object('percentuais', c.disc -> 'percentuais', 'codigo', c.disc -> 'codigo'),
    'avaliacao', c.codigo, 'validacao', null)
from calculado c
on conflict do nothing;
