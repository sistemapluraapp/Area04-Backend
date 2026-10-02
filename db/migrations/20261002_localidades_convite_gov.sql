-- Aplicada no grupo.01 (uoembacxxnkuwldmdgcu).
-- Etapa 6a: país em páginas, perfis, contas Gov e convites (ISO 3166-1
-- alfa-2, padrão BR). Para o Brasil, uf guarda a sigla; nos demais países,
-- o nome do estado/província. Convite Gov ganha descrição e e-mail.
alter table public.paginas add column if not exists pais text not null default 'BR' check (pais ~ '^[A-Z]{2}$');
alter table public.usuarios add column if not exists pais text not null default 'BR' check (pais ~ '^[A-Z]{2}$');
alter table public.gov_contas add column if not exists pais text not null default 'BR' check (pais ~ '^[A-Z]{2}$');
alter table public.chaves_acesso_gov
  add column if not exists pais text not null default 'BR' check (pais ~ '^[A-Z]{2}$'),
  add column if not exists descricao text check (char_length(descricao) <= 500),
  add column if not exists email text check (char_length(email) <= 320),
  add column if not exists cancelado_em timestamptz,
  add column if not exists criado_por text;

-- Tela pública do convite (Área 03): mostra o local e a descrição de um convite válido
create or replace function public.ver_convite_gov(p_token text)
returns table (cidade text, uf text, pais text, descricao text)
language sql
stable
security definer
set search_path = public
as $$
  select cidade, uf, pais, descricao from chaves_acesso_gov
  where token = p_token and not usado and cancelado_em is null and expira_em > now()
$$;
revoke all on function public.ver_convite_gov(text) from public;
grant execute on function public.ver_convite_gov(text) to anon, authenticated;

create or replace function public.validar_convite_gov(p_token text)
 returns table(cidade text)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select cidade from chaves_acesso_gov
  where token = p_token and not usado and cancelado_em is null and expira_em > now();
$function$;

create or replace function public.handle_new_auth_user()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_tipo text := new.raw_user_meta_data->>'tipo';
  v_nome text := new.raw_user_meta_data->>'nome';
  v_cpf text := new.raw_user_meta_data->>'cpf';
  v_orgao text := new.raw_user_meta_data->>'orgao';
  v_token text := new.raw_user_meta_data->>'convite_token';
  v_convite chaves_acesso_gov;
begin
  if v_tipo = 'usuario' then
    insert into usuarios (id, cpf, nome)
    values (new.id, v_cpf, v_nome)
    on conflict (id) do nothing;

  elsif v_tipo = 'gov' then
    select * into v_convite from chaves_acesso_gov
    where token = v_token and not usado and cancelado_em is null and expira_em > now()
    for update;

    if v_convite.id is null then
      return new;
    end if;

    insert into gov_contas (id, nome, orgao, cidade, uf, pais, nivel_acesso)
    values (new.id, v_nome, v_orgao, v_convite.cidade, v_convite.uf, v_convite.pais, 1)
    on conflict (id) do nothing;

    update chaves_acesso_gov
    set usado = true, usado_por = new.id, usado_em = now()
    where id = v_convite.id;
  end if;

  return new;
exception
  when others then
    raise warning 'handle_new_auth_user falhou para %: %', new.id, sqlerrm;
    return new;
end;
$function$;

grant select, insert, update on public.chaves_acesso_gov to area04_backend;

-- Caminho antigo de cadastro Gov: também respeita convite cancelado e copia o país
create or replace function public.cadastrar_conta_gov(p_token text, p_nome text, p_orgao text)
 returns gov_contas
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_convite chaves_acesso_gov;
  v_gov gov_contas;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;

  select * into v_convite from chaves_acesso_gov
  where token = p_token and not usado and cancelado_em is null and expira_em > now()
  for update;

  if v_convite.id is null then
    raise exception 'Link de cadastro inválido ou expirado';
  end if;

  insert into gov_contas (id, nome, orgao, cidade, uf, pais, nivel_acesso)
  values (auth.uid(), p_nome, p_orgao, v_convite.cidade, v_convite.uf, v_convite.pais, 1)
  returning * into v_gov;

  update chaves_acesso_gov
  set usado = true, usado_por = auth.uid(), usado_em = now()
  where id = v_convite.id;

  return v_gov;
end;
$function$;
