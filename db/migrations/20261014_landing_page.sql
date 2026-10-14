-- Etapa 9: landing page de plura.app.br (cópia do sistema do Festival da Primavera).
-- Mesmo modelo de dados do Festival, com prefixo landing_. A equipe edita pelo
-- ADM da Plura (papel area04_backend); o público lê o que está publicado e
-- envia formulário, visitas e cliques pela Área 01 (anon).
-- created_by / updated_by guardam o nome do administrador (os admins vivem no grupo.02).
-- Projeto: grupo01-useast2.

create or replace function internal.landing_set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ===== Configurações do site (registro único) =====
create table if not exists public.landing_site_settings (
  id smallint primary key default 1 check (id = 1),
  festival_name text not null default 'Plura',
  tagline text,
  location text,
  starts_at timestamptz,
  ends_at timestamptz,
  schedule_text text,
  brand jsonb not null default '{}'::jsonb,
  theme jsonb not null default '{}'::jsonb,
  nav jsonb not null default '[]'::jsonb,
  footer jsonb not null default '{}'::jsonb,
  social jsonb not null default '{}'::jsonb,
  privacy_text text,
  updated_at timestamptz not null default now(),
  updated_by text
);
insert into public.landing_site_settings (id, festival_name, tagline, nav) values (1, 'Plura',
  'Turismo e lazer acessíveis para todas as pessoas.',
  '[{"label":"Início","href":"/","visible":true},
    {"label":"Buscar lugares","href":"/buscar","visible":true},
    {"label":"Eventos","href":"/eventos","visible":true,"auto":"eventos"},
    {"label":"Contato","href":"/#contato","visible":true}]'::jsonb)
on conflict (id) do nothing;

-- ===== Páginas =====
create table if not exists public.landing_pages (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'evento' check (kind in ('home', 'evento', 'institucional')),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text not null,
  status text not null default 'draft' check (status in ('draft', 'published', 'scheduled')),
  publish_at timestamptz,
  category text,
  starts_at timestamptz,
  ends_at timestamptz,
  location text,
  cover_url text,
  show_in_nav boolean not null default true,
  sort_order integer not null default 0,
  seo jsonb not null default '{}'::jsonb,
  content jsonb not null default '{"sections":[]}'::jsonb,
  published_at timestamptz,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists landing_pages_single_home on public.landing_pages (kind) where kind = 'home';
create index if not exists landing_pages_public_idx on public.landing_pages (status, kind, sort_order);

create table if not exists public.landing_page_drafts (
  page_id uuid primary key references public.landing_pages (id) on delete cascade,
  content jsonb not null default '{"sections":[]}'::jsonb,
  updated_by text,
  updated_at timestamptz not null default now()
);

create table if not exists public.landing_page_versions (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.landing_pages (id) on delete cascade,
  content jsonb not null,
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists landing_page_versions_page_idx on public.landing_page_versions (page_id, created_at desc);

-- ===== Mídia (arquivos no R2, servidos pela Área 01) =====
create table if not exists public.landing_media (
  id uuid primary key default gen_random_uuid(),
  path text not null unique,
  url text not null,
  mime text,
  size_bytes bigint,
  width integer,
  height integer,
  alt text,
  folder text,
  created_by text,
  created_at timestamptz not null default now()
);

-- ===== Formulários =====
create table if not exists public.landing_form_submissions (
  id uuid primary key default gen_random_uuid(),
  page_id uuid references public.landing_pages (id) on delete set null,
  name text not null check (char_length(name) between 1 and 200),
  email text check (char_length(email) <= 320),
  phone text check (char_length(phone) <= 40),
  city text check (char_length(city) <= 120),
  interests text[] not null default '{}',
  heard_from text check (char_length(heard_from) <= 200),
  message text check (char_length(message) <= 5000),
  consent boolean not null,
  newsletter boolean not null default false,
  extra jsonb not null default '{}'::jsonb,
  utm jsonb not null default '{}'::jsonb,
  referrer text,
  status text not null default 'novo' check (status in ('novo', 'contatado', 'confirmado', 'descartado')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists landing_form_submissions_created_idx on public.landing_form_submissions (created_at desc);
create index if not exists landing_form_submissions_page_idx on public.landing_form_submissions (page_id);

-- ===== Métricas =====
create table if not exists public.landing_page_views (
  id bigint generated always as identity primary key,
  page_id uuid references public.landing_pages (id) on delete set null,
  path text not null check (char_length(path) <= 500),
  referrer text check (char_length(referrer) <= 1000),
  utm_source text, utm_medium text, utm_campaign text,
  device text check (device in ('mobile', 'tablet', 'desktop')),
  session_hash text,
  created_at timestamptz not null default now()
);
create index if not exists landing_page_views_created_idx on public.landing_page_views (created_at desc);
create index if not exists landing_page_views_page_idx on public.landing_page_views (page_id, created_at desc);

create table if not exists public.landing_click_events (
  id bigint generated always as identity primary key,
  page_id uuid references public.landing_pages (id) on delete set null,
  target text not null check (char_length(target) <= 500),
  label text check (char_length(label) <= 200),
  path text check (char_length(path) <= 500),
  session_hash text,
  created_at timestamptz not null default now()
);
create index if not exists landing_click_events_created_idx on public.landing_click_events (created_at desc);

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'landing_site_settings_updated_at') then
    create trigger landing_site_settings_updated_at before update on public.landing_site_settings for each row execute function internal.landing_set_updated_at();
    create trigger landing_pages_updated_at before update on public.landing_pages for each row execute function internal.landing_set_updated_at();
    create trigger landing_page_drafts_updated_at before update on public.landing_page_drafts for each row execute function internal.landing_set_updated_at();
    create trigger landing_form_submissions_updated_at before update on public.landing_form_submissions for each row execute function internal.landing_set_updated_at();
  end if;
end $$;

-- ===== RLS =====
alter table public.landing_site_settings enable row level security;
alter table public.landing_pages enable row level security;
alter table public.landing_page_drafts enable row level security;
alter table public.landing_page_versions enable row level security;
alter table public.landing_media enable row level security;
alter table public.landing_form_submissions enable row level security;
alter table public.landing_page_views enable row level security;
alter table public.landing_click_events enable row level security;

do $$ begin
  if not exists (select 1 from pg_policy where polrelid = 'public.landing_pages'::regclass and polname = 'landing_pages_publicas') then
    create policy landing_settings_leitura on public.landing_site_settings for select to anon, authenticated using (true);
    create policy landing_pages_publicas on public.landing_pages for select to anon, authenticated
      using (status = 'published' or (status = 'scheduled' and publish_at <= now()));
    create policy landing_media_leitura on public.landing_media for select to anon, authenticated using (true);
    create policy landing_form_envio on public.landing_form_submissions for insert to anon, authenticated
      with check (consent = true and status = 'novo' and notes is null);
    create policy landing_views_registro on public.landing_page_views for insert to anon, authenticated with check (true);
    create policy landing_clicks_registro on public.landing_click_events for insert to anon, authenticated with check (true);

    create policy area04_landing_settings on public.landing_site_settings for all to area04_backend using (true) with check (true);
    create policy area04_landing_pages on public.landing_pages for all to area04_backend using (true) with check (true);
    create policy area04_landing_drafts on public.landing_page_drafts for all to area04_backend using (true) with check (true);
    create policy area04_landing_versions on public.landing_page_versions for all to area04_backend using (true) with check (true);
    create policy area04_landing_media on public.landing_media for all to area04_backend using (true) with check (true);
    create policy area04_landing_forms on public.landing_form_submissions for all to area04_backend using (true) with check (true);
    create policy area04_landing_views on public.landing_page_views for all to area04_backend using (true) with check (true);
    create policy area04_landing_clicks on public.landing_click_events for all to area04_backend using (true) with check (true);
  end if;
end $$;

grant select on public.landing_site_settings, public.landing_pages, public.landing_media to anon, authenticated;
grant insert on public.landing_form_submissions, public.landing_page_views, public.landing_click_events to anon, authenticated;
grant select, insert, update, delete on public.landing_site_settings, public.landing_pages, public.landing_page_drafts,
  public.landing_page_versions, public.landing_media, public.landing_form_submissions, public.landing_page_views,
  public.landing_click_events to area04_backend;

-- ===== Resumo de métricas (ADM) =====
create or replace function public.landing_metrics_overview(p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
with v as (
  select pv.*,
    (pv.created_at at time zone 'America/Sao_Paulo')::date as d,
    case
      when pv.utm_source is not null and pv.utm_source <> '' then initcap(pv.utm_source)
      when pv.referrer is null or pv.referrer = '' then 'Direto'
      when pv.referrer ~* 'instagram' then 'Instagram'
      when pv.referrer ~* '(facebook|fb\.)' then 'Facebook'
      when pv.referrer ~* '(whatsapp|wa\.me)' then 'WhatsApp'
      when pv.referrer ~* 'google' then 'Google'
      when pv.referrer ~* '(t\.co|twitter|x\.com)' then 'X / Twitter'
      when pv.referrer ~* 'tiktok' then 'TikTok'
      when pv.referrer ~* 'youtube' then 'YouTube'
      else 'Outros sites'
    end as source
  from public.landing_page_views pv
  where pv.created_at >= p_from and pv.created_at < p_to
),
s as (
  select fs.*, (fs.created_at at time zone 'America/Sao_Paulo')::date as d
  from public.landing_form_submissions fs
  where fs.created_at >= p_from and fs.created_at < p_to
),
c as (
  select ce.* from public.landing_click_events ce
  where ce.created_at >= p_from and ce.created_at < p_to
),
days as (
  select gs::date as d
  from generate_series((p_from at time zone 'America/Sao_Paulo')::date, ((p_to - interval '1 second') at time zone 'America/Sao_Paulo')::date, interval '1 day') gs
)
select jsonb_build_object(
  'totals', jsonb_build_object(
    'views', (select count(*) from v),
    'visitors', (select count(distinct session_hash) from v),
    'submissions', (select count(*) from s),
    'clicks', (select count(*) from c)
  ),
  'daily', coalesce((
    select jsonb_agg(jsonb_build_object(
      'date', days.d,
      'views', (select count(*) from v where v.d = days.d),
      'visitors', (select count(distinct session_hash) from v where v.d = days.d),
      'submissions', (select count(*) from s where s.d = days.d)
    ) order by days.d) from days
  ), '[]'::jsonb),
  'pages', coalesce((
    select jsonb_agg(row_to_json(t) order by t.views desc) from (
      select v.page_id, max(v.path) as path, p.title, count(*) as views, count(distinct v.session_hash) as visitors,
        (select count(*) from s where s.page_id is not distinct from v.page_id) as submissions
      from v left join public.landing_pages p on p.id = v.page_id
      group by v.page_id, p.title
      order by count(*) desc limit 20
    ) t
  ), '[]'::jsonb),
  'clicks', coalesce((
    select jsonb_agg(row_to_json(t) order by t.clicks desc) from (
      select c.target, max(c.label) as label, count(*) as clicks, count(distinct c.session_hash) as people
      from c group by c.target order by count(*) desc limit 20
    ) t
  ), '[]'::jsonb),
  'sources', coalesce((
    select jsonb_agg(row_to_json(t) order by t.visitors desc) from (
      select source, count(distinct session_hash) as visitors, count(*) as views from v group by source
    ) t
  ), '[]'::jsonb),
  'devices', coalesce((
    select jsonb_agg(row_to_json(t) order by t.visitors desc) from (
      select coalesce(device, 'desktop') as device, count(distinct session_hash) as visitors from v group by 1
    ) t
  ), '[]'::jsonb),
  'cities', coalesce((
    select jsonb_agg(row_to_json(t) order by t.n desc) from (
      select initcap(trim(city)) as city, count(*) as n from s where coalesce(trim(city), '') <> '' group by 1 order by 2 desc limit 10
    ) t
  ), '[]'::jsonb),
  'heard', coalesce((
    select jsonb_agg(row_to_json(t) order by t.n desc) from (
      select heard_from as label, count(*) as n from s where coalesce(heard_from, '') <> '' group by 1 order by 2 desc limit 10
    ) t
  ), '[]'::jsonb)
);
$$;
revoke all on function public.landing_metrics_overview(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.landing_metrics_overview(timestamptz, timestamptz) to area04_backend;
