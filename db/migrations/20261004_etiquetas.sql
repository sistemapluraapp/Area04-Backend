-- Etapa C: etiquetas criadas pela administração (título + ícone). Cada página
-- recebe no máximo uma, aplicada só pelo ADM, e ela aparece nos cards da
-- busca e no topo da página pública.
-- Projeto: grupo01-useast2.

create table if not exists public.etiquetas (
  id uuid primary key default gen_random_uuid(),
  titulo text not null check (char_length(trim(titulo)) between 1 and 40),
  icone text,
  descricao text check (descricao is null or char_length(descricao) <= 300),
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.paginas
  add column if not exists etiqueta_id uuid references public.etiquetas(id) on delete set null;
create index if not exists paginas_etiqueta_idx on public.paginas (etiqueta_id) where etiqueta_id is not null;

alter table public.etiquetas enable row level security;
do $$ begin
  if not exists (select 1 from pg_policy where polrelid = 'public.etiquetas'::regclass and polname = 'etiquetas_select_public') then
    create policy etiquetas_select_public on public.etiquetas for select using (true);
    create policy area04_write_etiquetas on public.etiquetas for all to area04_backend using (true) with check (true);
  end if;
end $$;
grant select on public.etiquetas to anon, authenticated;
grant select, insert, update, delete on public.etiquetas to area04_backend;
grant update (etiqueta_id) on public.paginas to area04_backend;

-- Donos e colaboradores não alteram a etiqueta (nem ao criar a página)
create or replace function internal.protege_colunas_paginas()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if tg_op = 'INSERT' then
    new.legado := false;
    if auth.uid() is not null then
      new.etiqueta_id := null;
    end if;
  else
    new.legado := old.legado;
    new.updated_at := now();
    if auth.uid() is not null then
      new.tipo := old.tipo;
      new.criado_por_usuario := old.criado_por_usuario;
      new.criado_por_gov_conta := old.criado_por_gov_conta;
      new.suspensa := old.suspensa;
      new.etiqueta_id := old.etiqueta_id;
      if new.excluida_em is distinct from old.excluida_em
         and not internal.tem_vinculo(old.id, array['administrador'::papel_vinculo]) then
        raise exception 'Só o administrador pode apagar ou restaurar a página';
      end if;
    end if;
  end if;
  return new;
end;
$$;
