-- Aplicada no grupo.01 (uoembacxxnkuwldmdgcu).
-- Etapa 7: eventos das páginas (B2B e Gov), "Tenho interesse" e agenda cultural.

create table if not exists public.eventos (
  id uuid primary key default gen_random_uuid(),
  pagina_id uuid not null references public.paginas(id) on delete cascade,
  titulo text not null check (char_length(titulo) between 1 and 150),
  descricao text check (char_length(descricao) <= 16000),
  imagem_url text,
  link text check (char_length(link) <= 500),
  inicio timestamptz not null,
  fim timestamptz,
  local_nome text check (char_length(local_nome) <= 200),
  endereco text check (char_length(endereco) <= 200),
  pais text not null default 'BR' check (pais ~ '^[A-Z]{2}$'),
  uf text check (char_length(uf) <= 60),
  cidade text check (char_length(cidade) <= 100),
  gratuito boolean,
  acessibilidades text[] not null default '{}',
  publicado boolean not null default true,
  total_interessados integer not null default 0,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  check (fim is null or fim >= inicio)
);
create index if not exists eventos_pagina on public.eventos (pagina_id, inicio);
create index if not exists eventos_agenda on public.eventos (inicio) where publicado;
alter table public.eventos enable row level security;

-- Público vê eventos publicados de páginas visíveis; quem tem vínculo vê todos os da página
create policy eventos_select on public.eventos for select using (
  (publicado and exists (select 1 from paginas p where p.id = pagina_id and p.excluida_em is null and not coalesce(p.suspensa, false)))
  or internal.tem_vinculo(pagina_id)
);
create policy eventos_insert on public.eventos for insert with check (internal.tem_vinculo(pagina_id));
create policy eventos_update on public.eventos for update using (internal.tem_vinculo(pagina_id)) with check (internal.tem_vinculo(pagina_id));
create policy eventos_delete on public.eventos for delete using (internal.tem_vinculo(pagina_id, array['administrador'::papel_vinculo]));
grant select on public.eventos to anon, authenticated;
grant insert, update, delete on public.eventos to authenticated;
grant select on public.eventos to area04_backend;

create table if not exists public.evento_interesses (
  evento_id uuid not null references public.eventos(id) on delete cascade,
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  criado_em timestamptz not null default now(),
  primary key (evento_id, usuario_id)
);
create index if not exists evento_interesses_usuario on public.evento_interesses (usuario_id, criado_em desc);
alter table public.evento_interesses enable row level security;
create policy evento_interesses_proprios on public.evento_interesses for all to authenticated
  using (usuario_id = (select auth.uid())) with check (usuario_id = (select auth.uid()));
grant select, insert, delete on public.evento_interesses to authenticated;
grant select on public.evento_interesses to area04_backend;

-- Mantém eventos.total_interessados
create or replace function internal.trg_contar_interesses()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update eventos set total_interessados = total_interessados + 1 where id = new.evento_id;
  else
    update eventos set total_interessados = greatest(total_interessados - 1, 0) where id = old.evento_id;
  end if;
  return null;
end;
$$;
create or replace trigger trg_contar_interesses
  after insert or delete on public.evento_interesses
  for each row execute function internal.trg_contar_interesses();

-- Interessados de um evento: só para quem tem vínculo com a página (sem e-mail)
create or replace function public.interessados_evento(p_evento_id uuid)
returns table (nome text, cidade text, uf text, criado_em timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(nullif(u.nome_social, ''), u.nome), u.cidade, u.uf, i.criado_em
  from evento_interesses i
  join eventos e on e.id = i.evento_id
  join usuarios u on u.id = i.usuario_id
  where i.evento_id = p_evento_id and internal.tem_vinculo(e.pagina_id)
  order by i.criado_em desc
$$;
revoke all on function public.interessados_evento(uuid) from public;
grant execute on function public.interessados_evento(uuid) to authenticated;

-- Aviso de "novo evento" para quem favoritou o local do evento (Etapa 6b)
create or replace function internal.trg_favoritos_eventos()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pagina paginas;
  v_cidade text;
  v_uf text;
  v_pais text;
  v_total integer;
begin
  if not new.publicado or coalesce(new.fim, new.inicio) < now() then return new; end if;
  if tg_op = 'UPDATE' and old.publicado then return new; end if;
  select * into v_pagina from paginas where id = new.pagina_id;
  if v_pagina.id is null or v_pagina.excluida_em is not null or coalesce(v_pagina.suspensa, false) then return new; end if;
  v_cidade := coalesce(new.cidade, v_pagina.cidade);
  v_uf := coalesce(new.uf, v_pagina.uf);
  v_pais := coalesce(new.pais, v_pagina.pais);
  if v_cidade is null or v_uf is null then return new; end if;

  insert into notificacoes (destinatario_id, tipo, titulo, corpo, entidade_tipo, entidade_id, metadata, enviar_email)
  select distinct on (u.id)
    u.id, 'favorito_evento',
    'Novo evento em ' || v_cidade || '/' || v_uf,
    new.titulo || ' — ' || to_char(new.inicio at time zone 'America/Sao_Paulo', 'DD/MM/YYYY "às" HH24:MI') || ', por ' || v_pagina.nome || '.',
    'evento', new.id,
    jsonb_build_object('pagina_id', v_pagina.id, 'pagina_nome', v_pagina.nome, 'cidade', v_cidade, 'uf', v_uf, 'pais', v_pais),
    u.avisos_favoritos_email
  from localidades_favoritas f
  join usuarios u on u.id = f.usuario_id and not coalesce(u.suspenso, false)
  where f.pais = v_pais
    and lower(f.uf) = lower(v_uf)
    and (f.cidade is null or lower(f.cidade) = lower(v_cidade))
    and internal.recursos_atendem_necessidades(new.acessibilidades || coalesce(v_pagina.recursos_acessibilidade, '{}'), u.necessidades_acessibilidade)
    and not exists (select 1 from vinculos v where v.pagina_id = v_pagina.id and v.usuario_id = u.id)
    and not exists (select 1 from notificacoes n where n.destinatario_id = u.id and n.entidade_id = new.id);
  get diagnostics v_total = row_count;
  return new;
exception
  when others then
    raise warning 'aviso de favoritos (evento) falhou: %', sqlerrm;
    return new;
end;
$$;
create or replace trigger trg_favoritos_eventos
  after insert or update of publicado on public.eventos
  for each row execute function internal.trg_favoritos_eventos();

-- Fila de e-mails: avisos de evento apontam para a página do evento
create or replace function internal.avisos_email_pendentes(p_limite integer default 100)
returns table (id uuid, email text, nome text, titulo text, corpo text, pagina_id uuid)
language sql
security definer
set search_path = public
as $$
  select n.id, u.email::text, coalesce(nullif(us.nome_social, ''), us.nome), n.titulo, n.corpo,
         coalesce((n.metadata->>'pagina_id')::uuid, n.entidade_id)
  from notificacoes n
  join auth.users u on u.id = n.destinatario_id
  left join usuarios us on us.id = n.destinatario_id
  where n.enviar_email and n.email_enviado_em is null
    and n.criada_em > now() - interval '2 days'
  order by n.criada_em
  limit p_limite
$$;

-- Relatório de eventos no ADM (Área 04)
create policy area04_select_eventos on public.eventos for select to area04_backend using (true);
create policy area04_select_evento_interesses on public.evento_interesses for select to area04_backend using (true);
