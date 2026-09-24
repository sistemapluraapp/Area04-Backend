-- =============================================================================
-- Consumo de recursos em infraestrutura — lado do grupo.02
-- Aplicada no Supabase grupo.02 (sbmvjrfswhbkioynrajd). Aditiva.
-- Mesma função do grupo01, executável só pelo papel area04_notifier
-- (AREA04_ADMIN_DB_URL), para somar os dois projetos sem token de API.
-- =============================================================================

create or replace function public.consumo_infraestrutura()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'banco_bytes', pg_database_size(current_database()),
    'storage_bytes', (select coalesce(sum((metadata->>'size')::bigint), 0) from storage.objects),
    'storage_arquivos', (select count(*) from storage.objects),
    'autenticacoes_mes', (
      select count(distinct id) from (
        select u.id from auth.users u where u.last_sign_in_at >= date_trunc('month', now())
        union all
        select s.user_id from auth.sessions s where coalesce(s.refreshed_at, s.updated_at, s.created_at) >= date_trunc('month', now())
      ) ativos
    ),
    'maiores_tabelas', (
      select coalesce(jsonb_agg(jsonb_build_object('nome', nome, 'bytes', bytes) order by bytes desc), '[]'::jsonb)
      from (
        select n.nspname || '.' || c.relname as nome, pg_total_relation_size(c.oid) as bytes
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where c.relkind = 'r' and n.nspname in ('public', 'storage', 'auth')
        order by pg_total_relation_size(c.oid) desc
        limit 5
      ) t
    )
  );
$$;

revoke all on function public.consumo_infraestrutura() from public, anon, authenticated;
grant execute on function public.consumo_infraestrutura() to area04_notifier;
