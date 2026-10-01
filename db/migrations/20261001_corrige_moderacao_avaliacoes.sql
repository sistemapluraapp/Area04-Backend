-- Aplicada no grupo.01 (uoembacxxnkuwldmdgcu).
-- As funções dos gatilhos de avaliacoes são SECURITY DEFINER: dentro delas
-- current_user é o dono da função, nunca 'area04_backend'. A moderação do ADM
-- caía no ramo de usuário comum e o status (reprovado/aprovado) era desfeito
-- em silêncio. session_user mantém o papel que abriu a conexão.
create or replace function internal.protege_colunas_avaliacoes()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if session_user = 'area04_backend' or current_user = 'area04_backend' then
    new.nota := old.nota;
    new.comentario := old.comentario;
    new.usuario_id := old.usuario_id;
    new.pagina_id := old.pagina_id;
    if new.status is distinct from old.status then
      new.moderado_em := now();
    end if;
    return new;
  end if;

  new.moderado_em := old.moderado_em;
  new.motivo_moderacao := old.motivo_moderacao;

  if auth.uid() = old.usuario_id then
    new.resposta := old.resposta;
    new.respondido_em := old.respondido_em;
    new.sinalizada := old.sinalizada;
    if new.comentario is distinct from old.comentario or new.nota is distinct from old.nota then
      new.status := 'pendente';
    else
      new.status := old.status;
    end if;
  else
    new.nota := old.nota;
    new.comentario := old.comentario;
    new.usuario_id := old.usuario_id;
    new.pagina_id := old.pagina_id;
    new.status := old.status;
    if new.resposta is distinct from old.resposta then
      new.respondido_em := now();
    end if;
  end if;
  return new;
end;
$function$;

create or replace function internal.avaliacao_nasce_pendente()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if session_user <> 'area04_backend' and current_user <> 'area04_backend' then
    new.status := 'pendente';
    new.moderado_em := null;
    new.motivo_moderacao := null;
  end if;
  return new;
end;
$function$;
