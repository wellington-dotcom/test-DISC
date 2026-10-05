-- =============================================================================
-- Teste DISC — rodada "Parte 2: perfil exigido pelo trabalho".
-- Roda DEPOIS de 20261005120000_disc.sql, 20261006120000_pessoas_formulario.sql e
-- 20261007120000_empresas_equipes.sql.
-- Idempotente e seguro sobre dados reais: só cria o que falta e recria funções; nada é apagado e as linhas
-- que já existem continuam válidas (respostas antigas ficam com exigido nulo; processos antigos, sem
-- formulario.parte2, valem como 'desligada').
-- É aplicada sozinha pela integração do GitHub do Supabase no push; à mão: colar no SQL Editor e "Run".
--
--   * respostas.exigido: nulo ou 40 dígitos 1–4 (10 grupos × 4, ordem D,I,S,C — a mesma convenção do
--     campo respostas), cada bloco de 4 uma permutação de 1..4. Grupos usados: js/disc-exigido.js (GRUPOS).
--   * processos.config.formulario.parte2: 'desligada' (padrão) | 'ligada'. normalizar_formulario passa a
--     devolvê-lo, então avaliacao_publica e o gatilho de processos já o incluem.
--   * enviar_resposta: com parte2 'ligada' o exigido válido é obrigatório ("Responda também a segunda parte
--     do teste."); com 'desligada' (ou link geral) o exigido enviado é descartado. Idempotência pelo id igual.
-- ATENÇÃO: não rode de novo as migrações anteriores depois desta sem rodar esta em seguida (elas recriam
-- normalizar_formulario e enviar_resposta nas versões antigas).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Validação do exigido
-- -----------------------------------------------------------------------------

-- 40 dígitos 1..4 e cada bloco de 4 é permutação de 1..4 (DISC_EXIGIDO.validar).
create or replace function disc_interno.exigido_valido(p text)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  b text;
begin
  if p is null or p !~ '^[1-4]{40}$' then return false; end if;
  for g in 0..9 loop
    b := substr(p, g * 4 + 1, 4);
    if strpos(b, '1') = 0 or strpos(b, '2') = 0 or strpos(b, '3') = 0 or strpos(b, '4') = 0 then return false; end if;
  end loop;
  return true;
end;
$$;

alter table public.respostas add column if not exists exigido text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'respostas_exigido_valido'
                 and conrelid = 'public.respostas'::regclass) then
    alter table public.respostas add constraint respostas_exigido_valido
      check (exigido is null or disc_interno.exigido_valido(exigido));
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Formulário do processo: + parte2
-- -----------------------------------------------------------------------------

-- normalizarFormulario (mesma regra de js/api-supabase.js e js/api-simulada.js). Ausente/inválido = padrão:
-- idade obrigatória, função e empresa opcionais, e-mail e cidade ocultos, sem perguntas extras, parte2 desligada.
create or replace function disc_interno.normalizar_formulario(f jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  padrao constant jsonb := '{"idade":"obrigatorio","funcao":"opcional","empresa":"opcional","email":"oculto","cidade":"oculto"}';
  origem jsonb;
  campos jsonb := '{}'::jsonb;
  perguntas jsonb := '[]'::jsonb;
  usados text[] := '{}';
  k text;
  m text;
  x jsonb;
  v_texto text;
  v_id text;
  n int;
begin
  if f is null or jsonb_typeof(f) <> 'object' then f := '{}'::jsonb; end if;
  origem := case when jsonb_typeof(f -> 'campos') = 'object' then f -> 'campos' else '{}'::jsonb end;
  foreach k in array array['idade', 'funcao', 'empresa', 'email', 'cidade'] loop
    m := case when jsonb_typeof(origem -> k) = 'string' then origem ->> k else '' end;
    if m not in ('obrigatorio', 'opcional', 'oculto') then m := padrao ->> k; end if;
    campos := campos || jsonb_build_object(k, m);
  end loop;
  if jsonb_typeof(f -> 'perguntas') = 'array' then
    for x in select t.e from jsonb_array_elements(f -> 'perguntas') with ordinality t(e, i) order by t.i loop
      exit when jsonb_array_length(perguntas) >= 5;
      if jsonb_typeof(x) <> 'object' then continue; end if;
      v_texto := disc_interno.limpar_texto(disc_interno.texto(x -> 'texto'), 200);
      if char_length(v_texto) < 3 then continue; end if;
      v_id := case when jsonb_typeof(x -> 'id') = 'string' then x ->> 'id' else '' end;
      if v_id !~ '^[a-z0-9_]{1,20}$' or v_id = any (usados) then
        n := 1;
        while ('p' || n) = any (usados) loop n := n + 1; end loop;
        v_id := 'p' || n;
      end if;
      usados := usados || v_id;
      perguntas := perguntas || jsonb_build_array(jsonb_build_object(
        'id', v_id, 'texto', v_texto, 'obrigatoria', coalesce(x -> 'obrigatoria' = 'true'::jsonb, false)));
    end loop;
  end if;
  return jsonb_build_object('campos', campos, 'perguntas', perguntas,
    'parte2', case when f -> 'parte2' = '"ligada"'::jsonb then 'ligada' else 'desligada' end);
end;
$$;

-- -----------------------------------------------------------------------------
-- Envio do candidato: igual à migração anterior + exigido (Parte 2)
-- -----------------------------------------------------------------------------

create or replace function public.enviar_resposta(p_payload jsonb)
returns json
language plpgsql
volatile
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  v jsonb;
  pl jsonb;
  d jsonb;
  existente public.respostas%rowtype;
  pr public.processos%rowtype;
  v_protocolo text;
  v_form jsonb := null;
  v_cod text;
  v_pessoa uuid;
  v_exigido text := null;
begin
  if p_payload is null then return disc_interno.erro('Dados do teste ausentes.'); end if;
  if char_length(p_payload::text) > 20000 then return disc_interno.erro('Requisição grande demais.'); end if;

  -- Formulário do processo do link (link inexistente/desativado: padrão; a recusa vem logo abaixo).
  if jsonb_typeof(p_payload) = 'object' then
    v_cod := disc_interno.normalizar_codigo(disc_interno.texto(p_payload -> 'avaliacao'));
    if v_cod <> '' then
      select pp.config -> 'formulario' into v_form from public.processos pp where pp.codigo = v_cod and pp.ativo;
    end if;
  end if;

  v := disc_interno.validar_envio(p_payload, v_form);
  if not (v ->> 'ok')::boolean then return v::json; end if;
  pl := v -> 'payload';
  d := v -> 'disc';

  -- Parte 2: obrigatória e validada só com o formulário 'ligada'; senão o que vier é descartado.
  if disc_interno.normalizar_formulario(v_form) ->> 'parte2' = 'ligada' then
    v_exigido := case when jsonb_typeof(p_payload -> 'exigido') = 'string' then btrim(p_payload ->> 'exigido') else '' end;
    if not disc_interno.exigido_valido(v_exigido) then
      return disc_interno.erro('Responda também a segunda parte do teste.');
    end if;
    pl := pl || jsonb_build_object('exigido', v_exigido);
  end if;

  -- Uma gravação por vez (protocolo único e limites sem corrida).
  perform pg_advisory_xact_lock(hashtext('disc_enviar_resposta'));

  select * into existente from public.respostas where id = pl ->> 'id';
  if found then
    v_protocolo := existente.protocolo;
    if v_protocolo is null then
      begin
        v_protocolo := disc_interno.gerar_protocolo();
      exception when others then
        return disc_interno.erro(sqlerrm);
      end;
      update public.respostas set protocolo = v_protocolo where id = existente.id;
    end if;
    return json_build_object('ok', true, 'duplicado', true, 'id', existente.id, 'protocolo', v_protocolo);
  end if;

  if pl ->> 'avaliacao' <> '' then
    select * into pr from public.processos where codigo = pl ->> 'avaliacao';
    if not found or not pr.ativo then return disc_interno.erro('Este link de avaliação não está mais ativo.'); end if;
  end if;

  if (select count(*) from public.respostas) >= 2000 then
    return disc_interno.erro('Limite de respostas atingido. Avise o recrutador.');
  end if;

  begin
    v_protocolo := disc_interno.gerar_protocolo();
  exception when others then
    return disc_interno.erro(sqlerrm);
  end;

  if (select count(*) from public.respostas r where r.recebido_em > now() - interval '10 minutes') >= 40 then
    return disc_interno.erro('Muitos envios em pouco tempo. Aguarde alguns minutos e tente novamente.');
  end if;

  -- Ficha da pessoa: nome do envio e campos NÃO vazios do envio (vazio não apaga o que já havia).
  insert into public.pessoas as pe (telefone, nome, idade, funcao, empresa, email, cidade)
  values (pl ->> 'telefone', pl ->> 'nome', (pl ->> 'idade')::int, pl ->> 'funcao', pl ->> 'empresa',
    pl ->> 'email', pl ->> 'cidade')
  on conflict (telefone) do update set
    nome = excluded.nome,
    idade = coalesce(excluded.idade, pe.idade),
    funcao = coalesce(nullif(excluded.funcao, ''), pe.funcao),
    empresa = coalesce(nullif(excluded.empresa, ''), pe.empresa),
    email = coalesce(nullif(excluded.email, ''), pe.email),
    cidade = coalesce(nullif(excluded.cidade, ''), pe.cidade)
  returning id into v_pessoa;

  insert into public.respostas (id, processo_id, avaliacao, protocolo, recebido_em, nome, telefone, idade, vaga,
    funcao, empresa, email, cidade, extras, pessoa_id, inicio, fim, duracao_seg, respostas, exigido, d, i, s, c, perfil,
    validacao, status, observacoes, payload)
  values (pl ->> 'id', pr.id, pl ->> 'avaliacao', v_protocolo, now(), pl ->> 'nome', pl ->> 'telefone',
    (pl ->> 'idade')::int, pl ->> 'vaga', pl ->> 'funcao', pl ->> 'empresa', pl ->> 'email', pl ->> 'cidade',
    pl -> 'extras', v_pessoa,
    nullif(pl ->> 'inicio', '')::timestamptz, nullif(pl ->> 'fim', '')::timestamptz,
    (pl ->> 'duracaoSeg')::int, pl ->> 'respostas', v_exigido,
    (d #>> '{percentuais,D}')::numeric, (d #>> '{percentuais,I}')::numeric,
    (d #>> '{percentuais,S}')::numeric, (d #>> '{percentuais,C}')::numeric,
    d ->> 'codigo', pl -> 'validacao', 'em_analise', '', pl);

  -- Teste de equipe: quem responde pelo link de um processo 'equipe' ligado a uma empresa vira colaborador
  -- ativo dela (cargo = função informada), se ainda não tiver vínculo ativo em NENHUMA empresa.
  if pr.id is not null and pr.tipo = 'equipe' and pr.empresa_id is not null
     and not exists (select 1 from public.vinculos vi where vi.pessoa_id = v_pessoa and vi.status = 'ativo') then
    insert into public.vinculos (pessoa_id, empresa_id, cargo, status)
    values (v_pessoa, pr.empresa_id, left(coalesce(pl ->> 'funcao', ''), 120), 'ativo')
    on conflict do nothing;
  end if;

  return json_build_object('ok', true, 'id', pl ->> 'id', 'protocolo', v_protocolo);
end;
$$;

-- -----------------------------------------------------------------------------
-- Permissões (create or replace mantém as concedidas; reforço para a função nova)
-- -----------------------------------------------------------------------------

-- exigido_valido é usada pela restrição de respostas.exigido, que roda com o papel de quem grava (o painel
-- atualiza respostas direto, com RLS): por isso todos os papéis executam essa função pura de validação.
revoke all on function public.enviar_resposta(jsonb) from public;

do $$
declare
  papel text;
begin
  foreach papel in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = papel) then
      execute format('grant execute on function disc_interno.exigido_valido(text) to %I', papel);
      execute format('grant execute on function public.enviar_resposta(jsonb) to %I', papel);
    end if;
  end loop;
end $$;
