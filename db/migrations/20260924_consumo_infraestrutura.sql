-- =============================================================================
-- Consumo de recursos em infraestrutura (Área 04)
-- Aplicada no Supabase grupo01-useast2 (uoembacxxnkuwldmdgcu). Aditiva.
-- =============================================================================

-- Tetos do plano (editáveis pelo admin quando o plano mudar).
create table public.infraestrutura_limites (
  recurso text primary key,
  rotulo text not null,
  limite numeric not null check (limite > 0),
  unidade text not null check (unidade in ('bytes', 'usuarios', 'requisicoes')),
  periodo text not null check (periodo in ('total', 'mes', 'dia')),
  ordem int not null default 0,
  updated_at timestamptz not null default now()
);

-- Tetos do plano gratuito (Supabase: somando os dois projetos; Cloudflare
-- Workers: por conta, por dia, zera à meia-noite UTC).
insert into public.infraestrutura_limites (recurso, rotulo, limite, unidade, periodo, ordem) values
  ('banco',         'Banco de dados',                          524288000,  'bytes',       'total', 1),
  ('storage',       'Armazenamento de arquivos',               1073741824, 'bytes',       'total', 2),
  ('autenticacoes', 'Autenticações (usuários ativos no mês)',  50000,      'usuarios',    'mes',   3),
  ('egress',        'Tráfego de saída (egress)',               5368709120, 'bytes',       'mes',   4),
  ('requisicoes',   'Requisições (Cloudflare Workers)',        100000,     'requisicoes', 'dia',   5);

alter table public.infraestrutura_limites enable row level security;
create policy area04_all_infraestrutura_limites on public.infraestrutura_limites for all to area04_backend using (true) with check (true);
grant select, update on public.infraestrutura_limites to area04_backend;

-- Uma leitura por dia e recurso (a última do dia prevalece), usada para a
-- tendência e a previsão de quando o teto será atingido.
create table public.infraestrutura_historico (
  dia date not null,
  recurso text not null references public.infraestrutura_limites(recurso) on delete cascade,
  uso numeric not null,
  atualizado_em timestamptz not null default now(),
  primary key (dia, recurso)
);

alter table public.infraestrutura_historico enable row level security;
create policy area04_all_infraestrutura_historico on public.infraestrutura_historico for all to area04_backend using (true) with check (true);
grant select, insert, update on public.infraestrutura_historico to area04_backend;

-- Consumo atual deste projeto. Só a Área 04 pode executar.
-- autenticacoes: usuários distintos que entraram ou renovaram a sessão desde
-- o dia 1º do mês (aproximação do MAU do Supabase, que usa o ciclo de cobrança).
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
grant execute on function public.consumo_infraestrutura() to area04_backend;
