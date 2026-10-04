-- Aplicada no grupo.02 (sbmvjrfswhbkioynrajd).
-- "Esqueci minha senha" do painel ADM: link de uso único, válido por 1 hora.
-- O token vai só no e-mail; aqui fica o hash SHA-256.

create table if not exists public.admin_redefinicoes_senha (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references public.admins(id) on delete cascade,
  token_hash text not null unique,
  expira_em timestamptz not null,
  usado_em timestamptz,
  criado_em timestamptz not null default now()
);
create index if not exists admin_redefinicoes_senha_admin on public.admin_redefinicoes_senha (admin_id, criado_em desc);
alter table public.admin_redefinicoes_senha enable row level security;
-- Sem políticas: só as funções abaixo (security definer) mexem na tabela.

-- Chamada só pelo backend (papel area04_notifier): registra o pedido e
-- devolve nome/e-mail para o envio. Máximo de 3 pedidos por hora por admin.
create or replace function public.solicitar_redefinicao_admin(p_email text, p_token_hash text)
returns table (nome text, email text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin public.admins;
begin
  select * into v_admin from public.admins a
  where lower(a.email) = lower(trim(p_email)) and a.ativo;
  if v_admin.id is null then return; end if;

  if (select count(*) from public.admin_redefinicoes_senha r
      where r.admin_id = v_admin.id and r.criado_em > now() - interval '1 hour') >= 3 then
    return;
  end if;

  insert into public.admin_redefinicoes_senha (admin_id, token_hash, expira_em)
  values (v_admin.id, p_token_hash, now() + interval '1 hour');

  return query select v_admin.nome, v_admin.email;
end;
$$;
revoke all on function public.solicitar_redefinicao_admin(text, text) from public, anon, authenticated;
grant execute on function public.solicitar_redefinicao_admin(text, text) to area04_notifier;

-- Tela pública "redefinir senha": troca a senha com o token do e-mail,
-- invalida os outros links pendentes e encerra as sessões abertas.
create or replace function public.redefinir_senha_admin(p_token text, p_senha text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pedido public.admin_redefinicoes_senha;
  v_admin public.admins;
begin
  if p_senha is null or char_length(p_senha) < 8 or char_length(p_senha) > 72 then return false; end if;

  select * into v_pedido from public.admin_redefinicoes_senha
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and usado_em is null and expira_em > now()
  for update;
  if v_pedido.id is null then return false; end if;

  select * into v_admin from public.admins where id = v_pedido.admin_id and ativo;
  if v_admin.id is null then return false; end if;

  update auth.users
    set encrypted_password = extensions.crypt(p_senha, extensions.gen_salt('bf')),
        email_confirmed_at = coalesce(email_confirmed_at, now()),
        updated_at = now()
    where id = v_admin.id;

  update auth.refresh_tokens set revoked = true where user_id = v_admin.id::text and not revoked;

  update public.admin_redefinicoes_senha set usado_em = now()
  where admin_id = v_admin.id and usado_em is null;

  insert into public.admin_logs (admin_id, admin_nome, admin_email, acao, funcionalidade)
  values (v_admin.id, v_admin.nome, v_admin.email, 'Redefiniu a própria senha pelo link de recuperação', 'administradores');

  return true;
end;
$$;
revoke all on function public.redefinir_senha_admin(text, text) from public;
grant execute on function public.redefinir_senha_admin(text, text) to anon, authenticated;
