-- Etapa 8f: renovação de certificações e migração da tabela antiga "certificados".
-- - Avisos automáticos 60, 30 e 7 dias antes do vencimento e no dia em que vence
--   (um aviso por faixa; o cron do ADM chama adm_avisos_renovacao a cada 5 min).
-- - Lembrete manual pelo ADM.
-- - Renovação: nova inscrição ligada à anterior (renova_id). O selo atual continua
--   valendo até a renovação ser aprovada; aí a anterior fica marcada (renovada_por).
-- Projeto: grupo01-useast2.

alter table public.certificacao_inscricoes add column if not exists avisos_renovacao int[] not null default '{}';
alter table public.certificacao_inscricoes add column if not exists renova_id uuid references public.certificacao_inscricoes(id);
alter table public.certificacao_inscricoes add column if not exists renovada_por uuid references public.certificacao_inscricoes(id);

-- Uma inscrição aberta por página e certificação, e uma aprovada "vigente"
-- (a renovação aprovada substitui a anterior, que recebe renovada_por).
drop index if exists public.certificacao_inscricoes_viva_idx;
create unique index if not exists certificacao_inscricoes_aberta_idx
  on public.certificacao_inscricoes (certificacao_id, pagina_id) where status in ('em_andamento', 'enviada');
create unique index if not exists certificacao_inscricoes_vigente_idx
  on public.certificacao_inscricoes (certificacao_id, pagina_id) where status = 'aprovada' and renovada_por is null;

-- Ao aprovar uma renovação, a inscrição anterior deixa de ser a vigente
create or replace function internal.trg_renovacao_aprovada()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.status = 'aprovada' and old.status is distinct from 'aprovada' and new.renova_id is not null then
    update certificacao_inscricoes set renovada_por = new.id, updated_at = now()
    where id = new.renova_id and renovada_por is null;
  end if;
  return new;
end;
$$;
create or replace trigger certificacao_inscricoes_renovacao
  after update of status on public.certificacao_inscricoes
  for each row execute function internal.trg_renovacao_aprovada();

-- Inscrição: devolve a aberta; se a vigente vence em até 60 dias (ou venceu), abre a renovação
create or replace function public.inscrever_certificacao(p_certificacao_id uuid, p_pagina_id uuid)
returns public.certificacao_inscricoes
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_cert certificacoes;
  v_pag paginas;
  v_insc certificacao_inscricoes;
  v_vigente certificacao_inscricoes;
begin
  if not internal.pode_editar(p_pagina_id, 'selos') then
    raise exception 'Você não tem acesso à aba "Selos e certificações" desta página' using errcode = '42501';
  end if;
  select * into v_pag from paginas where id = p_pagina_id and excluida_em is null;
  if v_pag.id is null then raise exception 'Página não encontrada' using errcode = 'P0002'; end if;
  select * into v_cert from certificacoes where id = p_certificacao_id and status = 'publicada';
  if v_cert.id is null then raise exception 'Certificação não encontrada ou não publicada' using errcode = 'P0002'; end if;

  if (v_pag.tipo = 'privada' and v_cert.escopo = 'b2g') or (v_pag.tipo = 'publica' and v_cert.escopo = 'b2b') then
    raise exception 'Esta certificação é só para %', case v_cert.escopo when 'b2b' then 'empresas (B2B)' else 'órgãos públicos (Gov)' end
      using errcode = '22023';
  end if;
  if upper(coalesce(v_pag.pais, 'BR')) <> upper(v_cert.pais)
     or (v_cert.uf is not null and upper(trim(coalesce(v_pag.uf, ''))) <> upper(trim(v_cert.uf)))
     or (v_cert.cidade is not null and lower(trim(coalesce(v_pag.cidade, ''))) <> lower(trim(v_cert.cidade))) then
    raise exception 'Esta certificação vale só para %. Confira a localização da página na aba Localização.',
      coalesce(v_cert.cidade || '/' || v_cert.uf, 'o estado ' || v_cert.uf, 'o país ' || v_cert.pais)
      using errcode = '22023';
  end if;

  select * into v_insc from certificacao_inscricoes
  where certificacao_id = p_certificacao_id and pagina_id = p_pagina_id and status in ('em_andamento', 'enviada');
  if v_insc.id is not null then return v_insc; end if;

  select * into v_vigente from certificacao_inscricoes
  where certificacao_id = p_certificacao_id and pagina_id = p_pagina_id and status = 'aprovada' and renovada_por is null;
  if v_vigente.id is not null and (v_vigente.expira_em is null or v_vigente.expira_em > now() + interval '60 days') then
    return v_vigente;
  end if;

  insert into certificacao_inscricoes (certificacao_id, pagina_id, criada_por, renova_id)
  values (p_certificacao_id, p_pagina_id, auth.uid(), v_vigente.id)
  returning * into v_insc;
  perform public.registrar_log_pagina(p_pagina_id,
    case when v_vigente.id is not null then 'Iniciou a renovação da certificação ' else 'Iniciou a inscrição na certificação ' end || v_cert.titulo);
  return v_insc;
end;
$$;

-- Avisos automáticos de vencimento (chamado pelo cron do ADM). Devolve quantos avisos saíram.
create or replace function public.adm_avisos_renovacao()
returns int
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r record;
  v_faixa int;
  v_total int := 0;
  v_dias int;
begin
  for r in
    select i.id, i.expira_em, i.avisos_renovacao, c.titulo
    from certificacao_inscricoes i join certificacoes c on c.id = i.certificacao_id
    join paginas p on p.id = i.pagina_id
    where i.status = 'aprovada' and i.renovada_por is null and i.expira_em is not null
      and i.expira_em <= now() + interval '60 days' and p.excluida_em is null
      and not exists (select 1 from certificacao_inscricoes n where n.renova_id = i.id and n.status in ('em_andamento', 'enviada'))
  loop
    -- Faixa mais urgente ainda não avisada
    v_dias := ceil(extract(epoch from (r.expira_em - now())) / 86400)::int;
    v_faixa := case when v_dias <= 0 then 0 when v_dias <= 7 then 7 when v_dias <= 30 then 30 else 60 end;
    continue when v_faixa = any(r.avisos_renovacao);
    if v_faixa = 0 then
      perform internal.notificar_equipe_inscricao(r.id, 'certificacao_vencida', 'Certificação vencida: ' || r.titulo,
        'A certificação ' || r.titulo || ' venceu em ' || to_char(r.expira_em, 'DD/MM/YYYY') || ' e o selo saiu da página pública. Renove na aba "Selos e certificações".');
    else
      perform internal.notificar_equipe_inscricao(r.id, 'certificacao_a_vencer', 'Renove a certificação: ' || r.titulo,
        'A certificação ' || r.titulo || ' vence em ' || to_char(r.expira_em, 'DD/MM/YYYY') || ' (' || greatest(v_dias, 1) || ' dia(s)). Comece a renovação na aba "Selos e certificações" para não perder o selo.');
    end if;
    -- Marca esta faixa e as menos urgentes, para não mandar avisos atrasados em sequência
    update certificacao_inscricoes
    set avisos_renovacao = (select array_agg(distinct x) from unnest(avisos_renovacao || array(select f from unnest(array[60, 30, 7, 0]) f where f >= v_faixa)) x)
    where id = r.id;
    v_total := v_total + 1;
  end loop;
  return v_total;
end;
$$;

-- Lembrete manual pelo ADM
create or replace function public.adm_lembrete_renovacao(p_inscricao_id uuid, p_admin text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_insc certificacao_inscricoes;
  v_titulo text;
begin
  select * into v_insc from certificacao_inscricoes where id = p_inscricao_id;
  if v_insc.id is null or v_insc.status <> 'aprovada' then raise exception 'Só dá para lembrar certificações concedidas' using errcode = '22023'; end if;
  select titulo into v_titulo from certificacoes where id = v_insc.certificacao_id;
  perform internal.notificar_equipe_inscricao(p_inscricao_id, 'certificacao_a_vencer', 'Lembrete: renove a certificação ' || v_titulo,
    case when v_insc.expira_em is null then 'A equipe da Plura pede que vocês revisem a certificação ' || v_titulo || '.'
         when v_insc.expira_em <= now() then 'A certificação ' || v_titulo || ' venceu em ' || to_char(v_insc.expira_em, 'DD/MM/YYYY') || '. Renove na aba "Selos e certificações".'
         else 'A certificação ' || v_titulo || ' vence em ' || to_char(v_insc.expira_em, 'DD/MM/YYYY') || '. Comece a renovação na aba "Selos e certificações".' end);
  insert into pagina_logs (pagina_id, autor_id, autor_nome, acao)
  values (v_insc.pagina_id, null, 'Plura (administração)', left('A Plura enviou um lembrete de renovação da certificação ' || v_titulo || ' (' || coalesce(p_admin, 'ADM') || ')', 300));
end;
$$;

-- Selos públicos: só a inscrição vigente
create or replace function public.certificacoes_publicas_pagina(p_pagina_id uuid)
returns table (codigo text, titulo text, icone text, imagem_url text, concedida_em timestamptz, expira_em timestamptz)
language sql
stable
security definer
set search_path to 'public'
as $$
  select i.codigo, c.titulo, c.icone, c.imagem_url, i.concedida_em, i.expira_em
  from certificacao_inscricoes i
  join certificacoes c on c.id = i.certificacao_id
  join paginas p on p.id = i.pagina_id
  where i.pagina_id = p_pagina_id and i.status = 'aprovada' and i.codigo is not null and i.renovada_por is null
    and (i.expira_em is null or i.expira_em > now())
    and p.excluida_em is null and not coalesce(p.suspensa, false)
  order by i.concedida_em;
$$;

-- Migração da tabela antiga: certificados aprovados viram inscrições aprovadas
-- de uma certificação "modelo anterior" (arquivada, sem vencimento).
alter table public.certificados add column if not exists migrado_para uuid;
do $$
declare
  v_cert uuid;
  r record;
  v_nova uuid;
begin
  if exists (select 1 from certificados where status::text = 'aprovado' and migrado_para is null) then
    select id into v_cert from certificacoes where titulo = 'Certificação Plura (modelo anterior)' limit 1;
    if v_cert is null then
      insert into certificacoes (titulo, resumo, escopo, pais, status, validade_meses)
      values ('Certificação Plura (modelo anterior)', 'Certificados concedidos antes do novo modelo de certificações.', 'ambos', 'BR', 'arquivada', null)
      returning id into v_cert;
    end if;
    for r in select * from certificados where status::text = 'aprovado' and migrado_para is null loop
      if exists (select 1 from paginas where id = r.pagina_id) then
        insert into certificacao_inscricoes (certificacao_id, pagina_id, status, created_at, enviada_em, decidida_em, concedida_em, codigo, analisada_por)
        values (v_cert, r.pagina_id, 'aprovada', r.solicitado_em, r.solicitado_em, coalesce(r.avaliado_em, r.solicitado_em), coalesce(r.avaliado_em, r.solicitado_em),
          internal.gerar_codigo_certificado(), 'Migração do modelo anterior')
        on conflict do nothing
        returning id into v_nova;
        update certificados set migrado_para = v_nova where id = r.id;
      end if;
    end loop;
  end if;
end $$;

revoke all on function public.adm_avisos_renovacao() from public, anon, authenticated;
revoke all on function public.adm_lembrete_renovacao(uuid, text) from public, anon, authenticated;
grant execute on function public.adm_avisos_renovacao() to area04_backend;
grant execute on function public.adm_lembrete_renovacao(uuid, text) to area04_backend;

-- Aplicado em partes (o DROP INDEX acima depende de confirmação manual no painel).
-- O gatilho de renovação roda BEFORE UPDATE, para a anterior sair do índice
-- "vigente" antes de a renovação virar aprovada:
create or replace trigger certificacao_inscricoes_renovacao
  before update of status on public.certificacao_inscricoes
  for each row execute function internal.trg_renovacao_aprovada();

-- Fila de e-mails de avisos com tipo e link (convites de equipe, certificações e favoritos)
create or replace function internal.avisos_email_pendentes_v2(p_limite integer default 100)
returns table (id uuid, email text, nome text, titulo text, corpo text, pagina_id uuid, tipo text, link text)
language sql
security definer
set search_path to 'public'
as $$
  select n.id, u.email::text, coalesce(nullif(us.nome_social, ''), us.nome, g.nome), n.titulo, n.corpo,
         coalesce((n.metadata->>'pagina_id')::uuid, n.entidade_id), n.tipo, n.metadata->>'link'
  from notificacoes n
  join auth.users u on u.id = n.destinatario_id
  left join usuarios us on us.id = n.destinatario_id
  left join gov_contas g on g.id = n.destinatario_id
  where n.enviar_email and n.email_enviado_em is null
    and n.criada_em > now() - interval '2 days'
  order by n.criada_em
  limit p_limite
$$;
revoke all on function internal.avisos_email_pendentes_v2(integer) from public, anon, authenticated;
grant execute on function internal.avisos_email_pendentes_v2(integer) to area04_backend;
