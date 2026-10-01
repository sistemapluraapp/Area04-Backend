-- Aplicada no grupo.01 (uoembacxxnkuwldmdgcu).
-- Termos e condições editáveis no ADM, um para cada formulário. O aceite do
-- cadastro fica nos metadados da conta (Auth); o da página, em paginas.
create table if not exists public.termos (
  chave text primary key check (chave ~ '^[a-z0-9_]+$'),
  nome text not null,
  descricao text,
  titulo text not null check (char_length(titulo) <= 200),
  conteudo_html text not null default '' check (char_length(conteudo_html) <= 100000),
  atualizado_em timestamptz not null default now(),
  atualizado_por text
);
alter table public.termos enable row level security;
create policy termos_select_publico on public.termos for select to anon, authenticated using (true);
create policy area04_all_termos on public.termos for all to area04_backend using (true) with check (true);
grant select on public.termos to anon, authenticated;
grant select, insert, update on public.termos to area04_backend;

alter table public.paginas add column if not exists termos_aceitos_em timestamptz;

insert into public.termos (chave, nome, descricao, titulo, conteudo_html) values
('termos_usuario', 'Cadastro de usuário', 'Exibido no cadastro de pessoas em plura.app.br.', 'Termos e condições de uso da Plura',
 '<p><strong>Texto provisório.</strong> Edite este termo no painel administrativo (Comunicação → Termos e condições).</p><p>Ao criar sua conta, você concorda em usar a Plura de forma respeitosa, fornecer informações verdadeiras e respeitar as regras de avaliações e comentários.</p>'),
('termos_gov', 'Cadastro institucional (Gov)', 'Exibido no cadastro de contas institucionais pelo link de convite.', 'Termos e condições para contas institucionais',
 '<p><strong>Texto provisório.</strong> Edite este termo no painel administrativo (Comunicação → Termos e condições).</p><p>Ao criar a conta institucional, o órgão se compromete a publicar informações corretas e atualizadas sobre a acessibilidade dos seus atrativos e programas.</p>'),
('termos_empresa', 'Criação de página de empresa (B2B)', 'Exibido ao criar a página de um empreendimento em login.plura.app.br.', 'Termos e condições para empreendimentos',
 '<p><strong>Texto provisório.</strong> Edite este termo no painel administrativo (Comunicação → Termos e condições).</p><p>Ao criar a página, o empreendimento declara que as informações de acessibilidade são verdadeiras e se compromete a mantê-las atualizadas.</p>'),
('termos_pagina_gov', 'Criação de página institucional (Gov)', 'Exibido ao criar uma página institucional em gov.plura.app.br.', 'Termos e condições para páginas institucionais',
 '<p><strong>Texto provisório.</strong> Edite este termo no painel administrativo (Comunicação → Termos e condições).</p><p>Ao criar a página institucional, o órgão declara que as informações publicadas são verdadeiras e se compromete a mantê-las atualizadas.</p>'),
('termos_certificacao', 'Inscrição em certificação', 'Exibido ao se inscrever em uma certificação de acessibilidade.', 'Termos e condições das certificações',
 '<p><strong>Texto provisório.</strong> Edite este termo no painel administrativo (Comunicação → Termos e condições).</p><p>Ao se inscrever, você autoriza a Plura a analisar os documentos enviados e declara que eles são verdadeiros.</p>')
on conflict (chave) do nothing;
