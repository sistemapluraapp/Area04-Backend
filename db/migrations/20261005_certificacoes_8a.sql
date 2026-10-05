-- Etapa 8a: certificações configuradas pela administração (ADM).
-- Certificação → etapas (sequenciais ou paralelas) → requisitos (arquivo,
-- texto, formulário, link, vídeo ou vistoria). A tabela antiga
-- "certificados" continua até a migração da 8f.
-- Projeto: grupo01-useast2.

create table if not exists public.certificacoes (
  id uuid primary key default gen_random_uuid(),
  titulo text not null check (char_length(trim(titulo)) between 1 and 120),
  resumo text check (resumo is null or char_length(resumo) <= 300),
  descricao text,
  imagem_url text check (imagem_url is null or imagem_url ~* '^https://'),
  icone text,
  -- Quem pode se inscrever: empresas (B2B), órgãos (Gov) ou ambos
  escopo text not null default 'ambos' check (escopo in ('b2b', 'b2g', 'ambos')),
  -- Região: só país = nacional; com UF = estadual; com cidade = municipal
  pais text not null default 'BR',
  uf text,
  cidade text,
  -- Meses de validade depois de concedida (null = não vence)
  validade_meses integer check (validade_meses is null or validade_meses between 1 and 120),
  status text not null default 'rascunho' check (status in ('rascunho', 'publicada', 'arquivada')),
  -- Pagamento futuro (Mercado Pago): por enquanto todas são gratuitas
  gratuita boolean not null default true,
  preco_centavos integer not null default 0 check (preco_centavos >= 0),
  ordem integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (cidade is null or uf is not null)
);

create table if not exists public.certificacao_etapas (
  id uuid primary key default gen_random_uuid(),
  certificacao_id uuid not null references public.certificacoes(id) on delete cascade,
  titulo text not null check (char_length(trim(titulo)) between 1 and 120),
  descricao text check (descricao is null or char_length(descricao) <= 2000),
  -- sequencial: só começa depois da etapa anterior aprovada; paralela: junto com a anterior
  modo text not null default 'sequencial' check (modo in ('sequencial', 'paralela')),
  ordem integer not null default 0
);
create index if not exists certificacao_etapas_cert_idx on public.certificacao_etapas (certificacao_id, ordem);

create table if not exists public.certificacao_requisitos (
  id uuid primary key default gen_random_uuid(),
  etapa_id uuid not null references public.certificacao_etapas(id) on delete cascade,
  titulo text not null check (char_length(trim(titulo)) between 1 and 160),
  descricao text check (descricao is null or char_length(descricao) <= 2000),
  tipo text not null check (tipo in ('arquivo', 'texto', 'formulario', 'link', 'video', 'vistoria')),
  obrigatorio boolean not null default true,
  -- Configuração por tipo. Ex.: formulario → {"campos":[{"rotulo","tipo","obrigatorio"}]};
  -- arquivo → {"max_arquivos": 3}
  config jsonb not null default '{}'::jsonb,
  ordem integer not null default 0
);
create index if not exists certificacao_requisitos_etapa_idx on public.certificacao_requisitos (etapa_id, ordem);

-- Página "Buscar certificações" (B2B e Gov): textos, imagens e links
create table if not exists public.certificacoes_pagina (
  id smallint primary key default 1 check (id = 1),
  titulo text not null default 'Certificações de acessibilidade',
  subtitulo text,
  blocos jsonb not null default '[]'::jsonb,
  atualizado_em timestamptz not null default now(),
  atualizado_por text
);
insert into public.certificacoes_pagina (id, titulo, subtitulo)
values (1, 'Certificações de acessibilidade', 'Mostre ao público que o seu espaço é acessível e receba o selo da Plura.')
on conflict (id) do nothing;

-- RLS: o público lê só o que está publicado; o ADM (area04_backend) gerencia tudo
alter table public.certificacoes enable row level security;
alter table public.certificacao_etapas enable row level security;
alter table public.certificacao_requisitos enable row level security;
alter table public.certificacoes_pagina enable row level security;

do $$ begin
  if not exists (select 1 from pg_policy where polrelid = 'public.certificacoes'::regclass and polname = 'certificacoes_select_publicadas') then
    create policy certificacoes_select_publicadas on public.certificacoes for select using (status = 'publicada');
    create policy area04_all_certificacoes on public.certificacoes for all to area04_backend using (true) with check (true);

    create policy certificacao_etapas_select_publicadas on public.certificacao_etapas for select
      using (exists (select 1 from public.certificacoes c where c.id = certificacao_id and c.status = 'publicada'));
    create policy area04_all_certificacao_etapas on public.certificacao_etapas for all to area04_backend using (true) with check (true);

    create policy certificacao_requisitos_select_publicadas on public.certificacao_requisitos for select
      using (exists (
        select 1 from public.certificacao_etapas e join public.certificacoes c on c.id = e.certificacao_id
        where e.id = etapa_id and c.status = 'publicada'));
    create policy area04_all_certificacao_requisitos on public.certificacao_requisitos for all to area04_backend using (true) with check (true);

    create policy certificacoes_pagina_select on public.certificacoes_pagina for select using (true);
    create policy area04_all_certificacoes_pagina on public.certificacoes_pagina for all to area04_backend using (true) with check (true);
  end if;
end $$;

grant select on public.certificacoes, public.certificacao_etapas, public.certificacao_requisitos, public.certificacoes_pagina to anon, authenticated;
grant select, insert, update, delete on public.certificacoes, public.certificacao_etapas, public.certificacao_requisitos, public.certificacoes_pagina to area04_backend;
