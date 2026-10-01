-- Aplicada no grupo.02 (sbmvjrfswhbkioynrajd).
-- Administradores com permissões por funcionalidade, convites com link para
-- definir a senha e log das ações. Fecha duas brechas: (1) qualquer conta
-- criada no Auth do grupo.02 com tipo 'admin' virava admin automaticamente;
-- (2) o backend aceitava qualquer usuário autenticado do grupo.02.

alter table public.admins
  add column if not exists email text,
  add column if not exists ativo boolean not null default true,
  add column if not exists permissoes text[] not null default '{}',
  add column if not exists convidado_por uuid references public.admins(id),
  add column if not exists ultimo_acesso_em timestamptz;

-- O único usuário atual do painel vira super administrador (todas as permissões)
insert into public.admins (id, nome, email, permissoes)
select u.id, coalesce(nullif(u.raw_user_meta_data->>'nome', ''), 'Administrador Plura'), u.email,
       array['indicadores','moderacao','certificados','contas','configuracoes','comunicacao','administradores']
from auth.users u
where u.email = 'sistemapluraapp@gmail.com'
on conflict (id) do update set
  email = excluded.email,
  ativo = true,
  permissoes = excluded.permissoes;

-- Admins só nascem por convite aceito (aceitar_convite_admin), nunca pelo signup
create or replace function public.handle_new_auth_user()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  return new;
end;
$function$;

create or replace function public.admin_tem_permissao(p_permissao text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admins
    where id = auth.uid() and ativo and p_permissao = any(permissoes)
  )
$$;
revoke all on function public.admin_tem_permissao(text) from public;
grant execute on function public.admin_tem_permissao(text) to authenticated;

-- Cada admin vê o próprio cadastro; quem gerencia administradores vê e edita todos
alter policy admins_select_own on public.admins
  using ((select auth.uid()) = id or public.admin_tem_permissao('administradores'));
alter policy admins_update_own on public.admins
  using (public.admin_tem_permissao('administradores'))
  with check (public.admin_tem_permissao('administradores'));
alter policy admins_insert_own on public.admins
  with check (false);

-- Log das ações no painel: quem, quando e o quê
create table if not exists public.admin_logs (
  id bigint generated always as identity primary key,
  admin_id uuid not null references public.admins(id),
  admin_nome text,
  admin_email text,
  acao text not null check (char_length(acao) <= 2000),
  funcionalidade text,
  criado_em timestamptz not null default now()
);
create index if not exists admin_logs_criado_em_idx on public.admin_logs (criado_em desc);
create index if not exists admin_logs_admin_idx on public.admin_logs (admin_id, criado_em desc);
alter table public.admin_logs enable row level security;
create policy admin_logs_insert_proprio on public.admin_logs for insert to authenticated
  with check (admin_id = (select auth.uid()) and exists (select 1 from public.admins where id = (select auth.uid()) and ativo));
create policy admin_logs_select_gestor on public.admin_logs for select to authenticated
  using (public.admin_tem_permissao('administradores'));
grant select, insert on public.admin_logs to authenticated;

-- Convites: o token vai só no e-mail; aqui fica o hash SHA-256
create table if not exists public.admin_convites (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(email)),
  nome text not null,
  permissoes text[] not null default '{}',
  token_hash text not null unique,
  expira_em timestamptz not null,
  usado_em timestamptz,
  cancelado_em timestamptz,
  criado_por uuid references public.admins(id),
  criado_em timestamptz not null default now()
);
alter table public.admin_convites enable row level security;
create policy admin_convites_gestor on public.admin_convites for all to authenticated
  using (public.admin_tem_permissao('administradores'))
  with check (public.admin_tem_permissao('administradores'));
grant select, insert, update on public.admin_convites to authenticated;

-- Tela pública "aceitar convite": mostra nome/e-mail de um convite válido
create or replace function public.ver_convite_admin(p_token text)
returns table (email text, nome text)
language sql
stable
security definer
set search_path = public
as $$
  select c.email, c.nome from public.admin_convites c
  where c.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and c.usado_em is null and c.cancelado_em is null and c.expira_em > now()
$$;
revoke all on function public.ver_convite_admin(text) from public;
grant execute on function public.ver_convite_admin(text) to anon, authenticated;

-- Conclui o convite depois que a conta do convidado foi criada no Auth com o
-- mesmo e-mail: confirma o e-mail (o link do convite já provou a posse) e
-- cria o cadastro de admin com as permissões escolhidas.
create or replace function public.aceitar_convite_admin(p_token text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_convite public.admin_convites;
  v_usuario uuid;
begin
  select * into v_convite from public.admin_convites
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and usado_em is null and cancelado_em is null and expira_em > now()
  for update;
  if not found then return false; end if;

  select id into v_usuario from auth.users where lower(email) = v_convite.email;
  if v_usuario is null then return false; end if;

  update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()) where id = v_usuario;

  insert into public.admins (id, nome, email, permissoes, convidado_por, ativo)
  values (v_usuario, v_convite.nome, v_convite.email, v_convite.permissoes, v_convite.criado_por, true)
  on conflict (id) do update set
    nome = excluded.nome, email = excluded.email, permissoes = excluded.permissoes, ativo = true;

  update public.admin_convites set usado_em = now() where id = v_convite.id;
  return true;
end;
$$;
revoke all on function public.aceitar_convite_admin(text) from public;
grant execute on function public.aceitar_convite_admin(text) to anon, authenticated;

-- Substitui aceitar_convite_admin: se já existir uma conta NÃO confirmada com
-- o e-mail do convite (que pode ter sido criada por outra pessoa), a senha
-- passa a ser a escolhida pelo convidado. Contas já confirmadas mantêm a senha.
create or replace function public.concluir_convite_admin(p_token text, p_senha text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_convite public.admin_convites;
  v_usuario auth.users;
begin
  if p_senha is null or char_length(p_senha) < 8 then return false; end if;

  select * into v_convite from public.admin_convites
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and usado_em is null and cancelado_em is null and expira_em > now()
  for update;
  if not found then return false; end if;

  select * into v_usuario from auth.users where lower(email) = v_convite.email;
  if v_usuario.id is null then return false; end if;

  if v_usuario.email_confirmed_at is null then
    update auth.users
      set encrypted_password = extensions.crypt(p_senha, extensions.gen_salt('bf')),
          email_confirmed_at = now()
      where id = v_usuario.id;
  end if;

  insert into public.admins (id, nome, email, permissoes, convidado_por, ativo)
  values (v_usuario.id, v_convite.nome, v_convite.email, v_convite.permissoes, v_convite.criado_por, true)
  on conflict (id) do update set
    nome = excluded.nome, email = excluded.email, permissoes = excluded.permissoes, ativo = true;

  update public.admin_convites set usado_em = now() where id = v_convite.id;
  return true;
end;
$$;
revoke all on function public.concluir_convite_admin(text, text) from public;
grant execute on function public.concluir_convite_admin(text, text) to anon, authenticated;
revoke execute on function public.aceitar_convite_admin(text) from anon, authenticated;
