-- =============================================================================
-- Teste DISC — rodada "fotos" (candidato, colaborador e usuário do painel).
-- Roda DEPOIS de 20261005120000_disc.sql, 20261006120000_pessoas_formulario.sql,
-- 20261007120000_empresas_equipes.sql e 20261008120000_parte2.sql.
-- Idempotente e seguro sobre dados reais: só cria o que falta e recria funções; nada é apagado e as linhas
-- que já existem continuam válidas (sem foto = nulo; processos antigos, sem formulario.campos.foto, valem
-- como 'opcional').
-- É aplicada sozinha pela integração do GitHub do Supabase no push; à mão: colar no SQL Editor e "Run".
--
--   * Formato único da foto: data URL "data:image/jpeg;base64,..." (JPEG 192×192 recortado no navegador),
--     no máximo 40 000 caracteres. Nada de Storage: fica no banco. Restrições nas colunas:
--     pessoas.foto, respostas.foto e admins.foto (nulo ou nesse formato).
--   * processos.config.formulario.campos.foto: 'obrigatorio' | 'opcional' (padrão) | 'oculto'.
--   * enviar_resposta: aceita "foto" ('' = sem foto). Obrigatória sem foto -> "Envie uma foto."; oculta ->
--     descartada; inválida -> "Foto inválida ou grande demais. Escolha outra imagem.". A foto vai para
--     respostas.foto (NÃO para o payload) e para a ficha da pessoa (foto nova substitui; envio sem foto não
--     apaga a que havia). Limite do envio: 20 000 -> 80 000 caracteres.
--   * admins.foto: só o PRÓPRIO usuário troca (função salvar_minha_foto, com auth.uid()); o painel continua
--     podendo mudar só o nome dos usuários (privilégio por coluna) e um gatilho recusa qualquer outra troca.
--   * remover_foto(id da resposta) (LGPD, só admin): apaga a foto da resposta, da pessoa e das outras
--     respostas dela. Relatórios já gerados guardam a foto do snapshot até serem refeitos/excluídos.
--   * Relatórios por modelo (equipe/liderança/pessoa): snapshot até 1 MB (era 300 KB).
--   * anon nunca lê fotos: as tabelas continuam fechadas (RLS) e as funções públicas não as devolvem; o
--     relatório publicado mostra só o que está no snapshot.
-- ATENÇÃO: não rode de novo as migrações anteriores depois desta sem rodar esta em seguida (elas recriam
-- normalizar_formulario, enviar_resposta, relatorios_validar_modelo e os privilégios de admins nas versões
-- antigas).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Validação da foto e colunas
-- -----------------------------------------------------------------------------

-- data URL JPEG (o base64 de um JPEG começa com "/9j/"), até 40 000 caracteres (mesma regra de fotoValida
-- no navegador). As restrições das colunas repetem a expressão para não depender desta função (o painel
-- grava respostas/admins com o próprio papel, que não executa funções de disc_interno).
create or replace function disc_interno.foto_valida(p text)
returns boolean language sql immutable set search_path = '' as $$
  select p is not null and char_length(p) <= 40000 and p ~ '^data:image/jpeg;base64,/9j/[A-Za-z0-9+/=]+$';
$$;

alter table public.pessoas add column if not exists foto text;
alter table public.respostas add column if not exists foto text;
alter table public.admins add column if not exists foto text;

do $$
declare
  t text;
begin
  foreach t in array array['pessoas', 'respostas', 'admins'] loop
    if not exists (select 1 from pg_constraint where conname = t || '_foto_valida'
                   and conrelid = ('public.' || t)::regclass) then
      execute format('alter table public.%I add constraint %I check (foto is null or (char_length(foto) <= 40000 '
        || 'and foto ~ ''^data:image/jpeg;base64,/9j/[A-Za-z0-9+/=]+$''))', t, t || '_foto_valida');
    end if;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Formulário do processo: + campos.foto (padrão 'opcional')
-- -----------------------------------------------------------------------------

-- normalizarFormulario (mesma regra de js/api-supabase.js e js/api-simulada.js). Ausente/inválido = padrão:
-- idade obrigatória, função, empresa e foto opcionais, e-mail e cidade ocultos, sem perguntas extras,
-- parte2 desligada.
create or replace function disc_interno.normalizar_formulario(f jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  padrao constant jsonb := '{"idade":"obrigatorio","funcao":"opcional","empresa":"opcional","email":"oculto","cidade":"oculto","foto":"opcional"}';
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
  foreach k in array array['idade', 'funcao', 'empresa', 'email', 'cidade', 'foto'] loop
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
-- Envio do candidato: igual à migração anterior + foto (e limite de 80 000 caracteres)
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
  v_modo_foto text;
  v_foto text := null;
begin
  if p_payload is null then return disc_interno.erro('Dados do teste ausentes.'); end if;
  if char_length(p_payload::text) > 80000 then return disc_interno.erro('Requisição grande demais.'); end if;

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

  -- Foto (formulario.campos.foto): 'oculto' descarta; 'obrigatorio' exige; vazia = sem foto.
  v_modo_foto := disc_interno.normalizar_formulario(v_form) #>> '{campos,foto}';
  if v_modo_foto <> 'oculto' then
    v_foto := case when jsonb_typeof(p_payload -> 'foto') = 'string' then btrim(p_payload ->> 'foto') else '' end;
    if v_foto = '' then
      if v_modo_foto = 'obrigatorio' then return disc_interno.erro('Envie uma foto.'); end if;
      v_foto := null;
    elsif not disc_interno.foto_valida(v_foto) then
      return disc_interno.erro('Foto inválida ou grande demais. Escolha outra imagem.');
    end if;
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

  -- Ficha da pessoa: nome do envio e campos NÃO vazios do envio (vazio não apaga o que já havia; a foto
  -- nova substitui a antiga, sem foto mantém a que havia).
  insert into public.pessoas as pe (telefone, nome, idade, funcao, empresa, email, cidade, foto)
  values (pl ->> 'telefone', pl ->> 'nome', (pl ->> 'idade')::int, pl ->> 'funcao', pl ->> 'empresa',
    pl ->> 'email', pl ->> 'cidade', v_foto)
  on conflict (telefone) do update set
    nome = excluded.nome,
    idade = coalesce(excluded.idade, pe.idade),
    funcao = coalesce(nullif(excluded.funcao, ''), pe.funcao),
    empresa = coalesce(nullif(excluded.empresa, ''), pe.empresa),
    email = coalesce(nullif(excluded.email, ''), pe.email),
    cidade = coalesce(nullif(excluded.cidade, ''), pe.cidade),
    foto = coalesce(excluded.foto, pe.foto)
  returning id into v_pessoa;

  insert into public.respostas (id, processo_id, avaliacao, protocolo, recebido_em, nome, telefone, idade, vaga,
    funcao, empresa, email, cidade, extras, pessoa_id, inicio, fim, duracao_seg, respostas, exigido, foto, d, i, s, c, perfil,
    validacao, status, observacoes, payload)
  values (pl ->> 'id', pr.id, pl ->> 'avaliacao', v_protocolo, now(), pl ->> 'nome', pl ->> 'telefone',
    (pl ->> 'idade')::int, pl ->> 'vaga', pl ->> 'funcao', pl ->> 'empresa', pl ->> 'email', pl ->> 'cidade',
    pl -> 'extras', v_pessoa,
    nullif(pl ->> 'inicio', '')::timestamptz, nullif(pl ->> 'fim', '')::timestamptz,
    (pl ->> 'duracaoSeg')::int, pl ->> 'respostas', v_exigido, v_foto,
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
-- Relatórios por modelo: snapshot até 1 MB (as fotos vão dentro dele)
-- -----------------------------------------------------------------------------

create or replace function disc_interno.relatorios_validar_modelo()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.modelo <> 'processo' then
    if new.dados is null or jsonb_typeof(new.dados) <> 'object' then
      raise exception 'Dados do relatório inválidos.';
    end if;
    if char_length(new.dados::text) > 1100000 then
      raise exception 'Relatório grande demais (máximo 1 MB).';
    end if;
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Foto do usuário do painel (admins.foto): só o próprio usuário
-- -----------------------------------------------------------------------------

-- Defesa extra além dos privilégios por coluna: com usuário logado (auth.uid() presente), só ele mesmo
-- grava a própria foto. Sem auth.uid() (servidor/service role, SQL Editor) passa.
create or replace function disc_interno.admins_proteger_foto()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then return new; end if;
  if (tg_op = 'INSERT' and new.foto is not null)
     or (tg_op = 'UPDATE' and new.foto is distinct from old.foto) then
    if new.user_id is distinct from v_uid then
      raise exception 'Só o próprio usuário troca a foto dele.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists admins_proteger_foto on public.admins;
create trigger admins_proteger_foto before insert or update on public.admins
  for each row execute function disc_interno.admins_proteger_foto();

-- salvarMinhaFoto: foto do usuário logado ('' ou nulo remove). {ok, foto} ou {ok:false, erro}.
create or replace function public.salvar_minha_foto(p_foto text)
returns json
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_foto text := nullif(btrim(coalesce(p_foto, '')), '');
begin
  if v_uid is null or not public.e_admin() then return disc_interno.erro('Sem permissão.'); end if;
  if v_foto is not null and not disc_interno.foto_valida(v_foto) then
    return disc_interno.erro('Foto inválida ou grande demais. Escolha outra imagem.');
  end if;
  update public.admins set foto = v_foto where user_id = v_uid;
  return json_build_object('ok', true, 'foto', coalesce(v_foto, ''));
end;
$$;

-- -----------------------------------------------------------------------------
-- Remover a foto de um participante (LGPD, só admin)
-- -----------------------------------------------------------------------------

-- Apaga a foto da resposta, da ficha da pessoa e de todas as respostas dela. {ok, id, removidas}.
create or replace function public.remover_foto(p_resposta text)
returns json
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id text := left(btrim(coalesce(p_resposta, '')), 80);
  v_pessoa uuid;
  n int := 0;
  m int := 0;
begin
  if not public.e_admin() then return disc_interno.erro('Sem permissão.'); end if;
  select r.pessoa_id into v_pessoa from public.respostas r where r.id = v_id;
  if not found then return disc_interno.erro('Candidato não encontrado.'); end if;
  update public.respostas set foto = null
  where foto is not null and (id = v_id or (v_pessoa is not null and pessoa_id = v_pessoa));
  get diagnostics n = row_count;
  if v_pessoa is not null then
    update public.pessoas set foto = null where id = v_pessoa and foto is not null;
    get diagnostics m = row_count;
  end if;
  return json_build_object('ok', true, 'id', v_id, 'removidas', n + m);
end;
$$;

-- -----------------------------------------------------------------------------
-- Permissões
-- -----------------------------------------------------------------------------

-- admins: o painel (authenticated) insere só user_id/nome e muda só o nome; a foto, pela salvar_minha_foto.
-- respostas/pessoas: nada muda (a foto só entra pelo envio e sai pela remover_foto).
revoke all on function public.enviar_resposta(jsonb) from public;
revoke all on function public.salvar_minha_foto(text) from public;
revoke all on function public.remover_foto(text) from public;
revoke all on function disc_interno.foto_valida(text) from public;
revoke all on function disc_interno.admins_proteger_foto() from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.salvar_minha_foto(text), public.remover_foto(text) from anon;
    revoke all on function disc_interno.foto_valida(text), disc_interno.admins_proteger_foto() from anon;
    grant execute on function public.enviar_resposta(jsonb) to anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke insert, update on public.admins from authenticated;
    grant insert (user_id, nome, criado_em), update (nome) on public.admins to authenticated;
    revoke all on function disc_interno.foto_valida(text), disc_interno.admins_proteger_foto() from authenticated;
    grant execute on function public.enviar_resposta(jsonb), public.salvar_minha_foto(text), public.remover_foto(text)
      to authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function disc_interno.foto_valida(text), disc_interno.admins_proteger_foto() to service_role;
    grant execute on function public.enviar_resposta(jsonb), public.salvar_minha_foto(text), public.remover_foto(text)
      to service_role;
  end if;
end $$;
