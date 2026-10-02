-- Aplicada no grupo.01 (uoembacxxnkuwldmdgcu).
-- Etapa 6b: favoritar cidades e estados (qualquer país) e receber avisos de
-- novidades nesses locais (nova página, acessibilidade adicionada,
-- certificação obtida e, na Etapa 7, novo evento), cruzando com as
-- necessidades do perfil. Aviso no sininho na hora; o e-mail sai pela
-- tarefa agendada da Área 04 (a cada 5 minutos).

create table if not exists public.localidades_favoritas (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  pais text not null default 'BR' check (pais ~ '^[A-Z]{2}$'),
  uf text not null check (char_length(uf) between 1 and 60),
  cidade text check (char_length(cidade) <= 100),
  criado_em timestamptz not null default now()
);
create unique index if not exists localidades_favoritas_unica
  on public.localidades_favoritas (usuario_id, pais, lower(uf), lower(coalesce(cidade, '')));
create index if not exists localidades_favoritas_local
  on public.localidades_favoritas (pais, lower(uf), lower(coalesce(cidade, '')));
alter table public.localidades_favoritas enable row level security;
create policy localidades_favoritas_proprias on public.localidades_favoritas for all to authenticated
  using (usuario_id = (select auth.uid())) with check (usuario_id = (select auth.uid()));
grant select, insert, delete on public.localidades_favoritas to authenticated;

alter table public.usuarios add column if not exists avisos_favoritos_email boolean not null default true;
alter table public.notificacoes
  add column if not exists enviar_email boolean not null default false,
  add column if not exists email_enviado_em timestamptz;
create index if not exists notificacoes_email_pendente on public.notificacoes (criada_em) where enviar_email and email_enviado_em is null;

-- Necessidade do perfil (categoria) -> categoria de recurso da página
create or replace function internal.recursos_atendem_necessidades(p_recursos text[], p_necessidades text[])
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(cardinality(p_necessidades), 0) = 0
    or p_necessidades <@ array['nenhuma']
    or exists (
      select 1
      from filtros_acessibilidade n
      join filtros_acessibilidade r on r.tipo = 'recurso_local' and r.codigo = any(p_recursos)
      where n.tipo = 'necessidade_pessoal' and n.codigo = any(p_necessidades)
        and r.categoria = case n.categoria
          when 'visao' then 'visual'
          when 'audicao' then 'comunicacao'
          when 'mobilidade' then 'fisica'
          when 'cognitivo' then 'sensorial'
        end
    )
$$;

-- Cria os avisos para quem favoritou o local da página. p_recursos: os
-- recursos a cruzar com as necessidades (todos os da página, ou só os
-- recém-adicionados). Um aviso por pessoa, página e tipo a cada 24 horas.
create or replace function internal.notificar_favoritos(p_pagina_id uuid, p_tipo text, p_titulo text, p_corpo text, p_recursos text[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pagina paginas;
  v_total integer;
begin
  select * into v_pagina from paginas where id = p_pagina_id;
  if v_pagina.id is null or v_pagina.cidade is null or v_pagina.uf is null
     or v_pagina.excluida_em is not null or coalesce(v_pagina.suspensa, false) then
    return 0;
  end if;

  insert into notificacoes (destinatario_id, tipo, titulo, corpo, entidade_tipo, entidade_id, metadata, enviar_email)
  select distinct on (u.id)
    u.id, p_tipo, p_titulo, p_corpo, 'pagina', v_pagina.id,
    jsonb_build_object('pagina_nome', v_pagina.nome, 'cidade', v_pagina.cidade, 'uf', v_pagina.uf, 'pais', v_pagina.pais,
                       'favorito', case when f.cidade is null then f.uf else f.cidade end),
    u.avisos_favoritos_email
  from localidades_favoritas f
  join usuarios u on u.id = f.usuario_id and not coalesce(u.suspenso, false)
  where f.pais = v_pagina.pais
    and lower(f.uf) = lower(v_pagina.uf)
    and (f.cidade is null or lower(f.cidade) = lower(v_pagina.cidade))
    and internal.recursos_atendem_necessidades(p_recursos, u.necessidades_acessibilidade)
    and not exists (
      select 1 from vinculos v where v.pagina_id = v_pagina.id and v.usuario_id = u.id
    )
    and not exists (
      select 1 from notificacoes n
      where n.destinatario_id = u.id and n.tipo = p_tipo and n.entidade_id = v_pagina.id
        and n.criada_em > now() - interval '24 hours'
    );
  get diagnostics v_total = row_count;
  return v_total;
end;
$$;
revoke all on function internal.notificar_favoritos(uuid, text, text, text, text[]) from public;

-- Gatilhos: nova página no local, acessibilidade adicionada e certificação
create or replace function internal.trg_favoritos_paginas()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_local text;
  v_novos text[];
begin
  if new.cidade is null or new.uf is null then return new; end if;
  v_local := new.cidade || coalesce('/' || new.uf, '');

  if tg_op = 'INSERT'
     or (new.pais, lower(new.uf), lower(new.cidade)) is distinct from (old.pais, lower(old.uf), lower(old.cidade)) then
    perform internal.notificar_favoritos(new.id, 'favorito_nova_pagina',
      'Nova página em ' || v_local,
      new.nome || ' chegou à Plura em um local que você favoritou.',
      coalesce(new.recursos_acessibilidade, '{}'));
    return new;
  end if;

  select coalesce(array_agg(r), '{}') into v_novos
  from unnest(coalesce(new.recursos_acessibilidade, '{}')) r
  where not (r = any(coalesce(old.recursos_acessibilidade, '{}')));

  if cardinality(v_novos) > 0 then
    perform internal.notificar_favoritos(new.id, 'favorito_acessibilidade',
      'Mais acessibilidade em ' || v_local,
      new.nome || ' adicionou recursos de acessibilidade: ' || (
        select string_agg(coalesce(f.rotulo, r), ', ') from unnest(v_novos) r
        left join filtros_acessibilidade f on f.tipo = 'recurso_local' and f.codigo = r
      ) || '.',
      v_novos);
  end if;
  return new;
exception
  when others then
    raise warning 'aviso de favoritos falhou para a página %: %', new.id, sqlerrm;
    return new;
end;
$$;

create or replace trigger trg_favoritos_paginas
  after insert or update of cidade, uf, pais, recursos_acessibilidade on public.paginas
  for each row execute function internal.trg_favoritos_paginas();

create or replace function internal.trg_favoritos_certificados()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pagina paginas;
begin
  if new.status::text <> 'aprovado' or (tg_op = 'UPDATE' and old.status::text = 'aprovado') then return new; end if;
  select * into v_pagina from paginas where id = new.pagina_id;
  if v_pagina.id is null then return new; end if;
  perform internal.notificar_favoritos(v_pagina.id, 'favorito_certificacao',
    'Certificação de acessibilidade em ' || coalesce(v_pagina.cidade, 'um local favorito'),
    v_pagina.nome || ' recebeu uma certificação de acessibilidade da Plura.',
    coalesce(v_pagina.recursos_acessibilidade, '{}'));
  return new;
exception
  when others then
    raise warning 'aviso de favoritos (certificado) falhou: %', sqlerrm;
    return new;
end;
$$;

create or replace trigger trg_favoritos_certificados
  after insert or update of status on public.certificados
  for each row execute function internal.trg_favoritos_certificados();

-- Fila de e-mails dos avisos (lida pela tarefa agendada da Área 04)
create or replace function internal.avisos_email_pendentes(p_limite integer default 100)
returns table (id uuid, email text, nome text, titulo text, corpo text, pagina_id uuid)
language sql
security definer
set search_path = public
as $$
  select n.id, u.email::text, coalesce(nullif(us.nome_social, ''), us.nome), n.titulo, n.corpo, n.entidade_id
  from notificacoes n
  join auth.users u on u.id = n.destinatario_id
  left join usuarios us on us.id = n.destinatario_id
  where n.enviar_email and n.email_enviado_em is null
    and n.criada_em > now() - interval '2 days'
  order by n.criada_em
  limit p_limite
$$;
revoke all on function internal.avisos_email_pendentes(integer) from public;
grant usage on schema internal to area04_backend;
grant execute on function internal.avisos_email_pendentes(integer) to area04_backend;

create or replace function internal.marcar_avisos_email_enviados(p_ids uuid[])
returns void
language sql
security definer
set search_path = public
as $$
  update notificacoes set email_enviado_em = now() where id = any(p_ids) and email_enviado_em is null
$$;
revoke all on function internal.marcar_avisos_email_enviados(uuid[]) from public;
grant execute on function internal.marcar_avisos_email_enviados(uuid[]) to area04_backend;
