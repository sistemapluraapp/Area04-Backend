-- Etapa 8d: análise das inscrições pelo ADM (papel area04_backend).
-- O ADM marca cada resposta enviada como aprovada ou com ajustes e depois
-- conclui a análise. A conclusão decide o novo status da inscrição, avisa a
-- equipe da página (notificação + e-mail) e registra no log da página.
-- Projeto: grupo01-useast2.

alter table public.certificacao_inscricoes add column if not exists analisada_por text;
alter table public.certificacao_respostas add column if not exists avaliada_por text;
alter table public.certificacao_respostas add column if not exists avaliada_em timestamptz;
create index if not exists certificacao_inscricoes_status_idx on public.certificacao_inscricoes (status, expira_em);

-- Quem cuida de certificações na página: administradores e quem tem a aba "selos"
create or replace function internal.notificar_equipe_inscricao(p_inscricao_id uuid, p_tipo text, p_titulo text, p_corpo text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_insc certificacao_inscricoes;
  v_pag paginas;
  v_link text;
begin
  select * into v_insc from certificacao_inscricoes where id = p_inscricao_id;
  select * into v_pag from paginas where id = v_insc.pagina_id;
  v_link := case when v_pag.tipo = 'publica' then 'https://gov.plura.app.br' else 'https://login.plura.app.br' end
    || '/pagina?id=' || v_pag.id || '&aba=selos&inscricao=' || v_insc.id;
  insert into notificacoes (destinatario_id, tipo, titulo, corpo, entidade_tipo, entidade_id, metadata, enviar_email)
  select distinct coalesce(v.usuario_id, v.gov_conta_id), p_tipo, p_titulo, p_corpo, 'certificacao_inscricao', v_insc.id,
    jsonb_build_object('pagina_id', v_pag.id, 'pagina_nome', v_pag.nome, 'pagina_tipo', v_pag.tipo, 'link', v_link),
    true
  from vinculos v
  where v.pagina_id = v_pag.id and v.status = 'ativo'
    and (v.papel = 'administrador' or 'selos' = any(v.permissoes))
    and coalesce(v.usuario_id, v.gov_conta_id) is not null;
end;
$$;

-- Avaliação de uma resposta enviada: 'aprovada' ou 'ajustes' (com comentário)
create or replace function public.adm_avaliar_resposta(p_inscricao_id uuid, p_requisito_id uuid, p_status text, p_comentario text, p_admin text)
returns public.certificacao_respostas
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_insc certificacao_inscricoes;
  v_resp certificacao_respostas;
begin
  select * into v_insc from certificacao_inscricoes where id = p_inscricao_id;
  if v_insc.id is null then raise exception 'Inscrição não encontrada' using errcode = 'P0002'; end if;
  if v_insc.status <> 'enviada' then raise exception 'Só dá para avaliar inscrições em análise' using errcode = '22023'; end if;
  if p_status not in ('aprovada', 'ajustes', 'enviada') then raise exception 'Avaliação inválida' using errcode = '22023'; end if;
  if p_status = 'ajustes' and coalesce(trim(p_comentario), '') = '' then
    raise exception 'Explique o que precisa ser ajustado' using errcode = '22023';
  end if;
  update certificacao_respostas
  set status = p_status,
      comentario_adm = case when p_status = 'ajustes' then left(trim(p_comentario), 2000) else null end,
      avaliada_por = case when p_status = 'enviada' then null else left(p_admin, 120) end,
      avaliada_em = case when p_status = 'enviada' then null else now() end
  where inscricao_id = p_inscricao_id and requisito_id = p_requisito_id and status in ('enviada', 'aprovada', 'ajustes')
  returning * into v_resp;
  if v_resp.id is null then raise exception 'Esta resposta não foi enviada para análise' using errcode = '22023'; end if;
  return v_resp;
end;
$$;

-- Confirma a data da vistoria (avisa a equipe)
create or replace function public.adm_confirmar_vistoria(p_inscricao_id uuid, p_requisito_id uuid, p_data date, p_periodo text, p_admin text)
returns public.certificacao_respostas
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_resp certificacao_respostas;
  v_req certificacao_requisitos;
begin
  select * into v_req from certificacao_requisitos where id = p_requisito_id;
  if v_req.tipo is distinct from 'vistoria' then raise exception 'Este requisito não é de vistoria' using errcode = '22023'; end if;
  if p_periodo not in ('manha', 'tarde') or p_data is null then raise exception 'Informe data e período' using errcode = '22023'; end if;
  update certificacao_respostas
  set valor = jsonb_set(valor, '{confirmada}', jsonb_build_object('data', p_data, 'periodo', p_periodo, 'por', left(p_admin, 120), 'em', now()))
  where inscricao_id = p_inscricao_id and requisito_id = p_requisito_id
  returning * into v_resp;
  if v_resp.id is null then raise exception 'A página ainda não propôs datas' using errcode = '22023'; end if;
  perform internal.notificar_equipe_inscricao(p_inscricao_id, 'certificacao_vistoria',
    'Vistoria confirmada',
    'A vistoria foi marcada para ' || to_char(p_data, 'DD/MM/YYYY') || ' (' || case p_periodo when 'manha' then 'manhã' else 'tarde' end || ').');
  return v_resp;
end;
$$;

-- Conclui a análise. p_decisao: 'concluir' (decide pelo estado das respostas) ou 'reprovar'
create or replace function public.adm_concluir_analise(p_inscricao_id uuid, p_decisao text, p_observacao text, p_admin text)
returns public.certificacao_inscricoes
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_insc certificacao_inscricoes;
  v_cert certificacoes;
  v_pendentes int;
  v_ajustes int;
  v_total_etapas int;
  v_aprovadas int;
  v_status text;
  v_titulo text;
  v_corpo text;
  v_tipo text;
  v_acao text;
begin
  select * into v_insc from certificacao_inscricoes where id = p_inscricao_id for update;
  if v_insc.id is null then raise exception 'Inscrição não encontrada' using errcode = 'P0002'; end if;
  if v_insc.status <> 'enviada' then raise exception 'Esta inscrição não está em análise' using errcode = '22023'; end if;
  select * into v_cert from certificacoes where id = v_insc.certificacao_id;

  if p_decisao = 'reprovar' then
    if coalesce(trim(p_observacao), '') = '' then raise exception 'Explique o motivo da reprovação' using errcode = '22023'; end if;
    update certificacao_inscricoes set status = 'reprovada', decidida_em = now(), updated_at = now(),
      observacao_adm = left(trim(p_observacao), 2000), analisada_por = left(p_admin, 120)
    where id = p_inscricao_id returning * into v_insc;
    v_tipo := 'certificacao_reprovada';
    v_titulo := 'Certificação não aprovada: ' || v_cert.titulo;
    v_corpo := 'A análise terminou e a certificação não foi aprovada. Motivo: ' || left(trim(p_observacao), 500);
    v_acao := 'A Plura não aprovou a certificação ' || v_cert.titulo;
  elsif p_decisao = 'concluir' then
    select count(*) filter (where status = 'enviada'), count(*) filter (where status = 'ajustes')
      into v_pendentes, v_ajustes
    from certificacao_respostas where inscricao_id = p_inscricao_id;
    if v_pendentes > 0 then
      raise exception 'Ainda há % resposta(s) sem avaliação', v_pendentes using errcode = '22023';
    end if;
    select count(*) into v_total_etapas from certificacao_etapas where certificacao_id = v_insc.certificacao_id;
    select count(*) filter (where aprovada) into v_aprovadas from internal.etapas_liberadas(p_inscricao_id);

    if v_ajustes > 0 then
      v_status := 'em_andamento';
      v_tipo := 'certificacao_ajustes';
      v_titulo := 'Ajustes pedidos: ' || v_cert.titulo;
      v_corpo := 'A Plura pediu ajustes em ' || v_ajustes || ' item(ns). Corrija e envie de novo.'
        || case when coalesce(trim(p_observacao), '') <> '' then ' Observação: ' || left(trim(p_observacao), 500) else '' end;
      v_acao := 'A Plura pediu ajustes na certificação ' || v_cert.titulo;
    elsif v_aprovadas >= v_total_etapas then
      v_status := 'aprovada';
      v_tipo := 'certificacao_aprovada';
      v_titulo := 'Certificação aprovada: ' || v_cert.titulo;
      v_corpo := 'Parabéns! A página recebeu a certificação ' || v_cert.titulo
        || case when v_cert.validade_meses is not null then ', válida até ' || to_char(now() + make_interval(months => v_cert.validade_meses), 'DD/MM/YYYY') else '' end || '.';
      v_acao := 'A Plura concedeu a certificação ' || v_cert.titulo;
    else
      v_status := 'em_andamento';
      v_tipo := 'certificacao_etapa';
      v_titulo := 'Etapa aprovada: ' || v_cert.titulo;
      v_corpo := 'Uma etapa foi aprovada e a próxima já está liberada para preenchimento.';
      v_acao := 'A Plura aprovou uma etapa da certificação ' || v_cert.titulo;
    end if;

    update certificacao_inscricoes set
      status = v_status,
      updated_at = now(),
      analisada_por = left(p_admin, 120),
      observacao_adm = nullif(left(trim(coalesce(p_observacao, '')), 2000), ''),
      decidida_em = case when v_status = 'aprovada' then now() else decidida_em end,
      concedida_em = case when v_status = 'aprovada' then now() else concedida_em end,
      expira_em = case when v_status = 'aprovada' and v_cert.validade_meses is not null
                       then now() + make_interval(months => v_cert.validade_meses) else expira_em end
    where id = p_inscricao_id returning * into v_insc;
  else
    raise exception 'Decisão inválida' using errcode = '22023';
  end if;

  insert into pagina_logs (pagina_id, autor_id, autor_nome, acao)
  values (v_insc.pagina_id, null, 'Plura (administração)', left(v_acao, 300));
  perform internal.notificar_equipe_inscricao(p_inscricao_id, v_tipo, v_titulo, v_corpo);
  return v_insc;
end;
$$;

revoke all on function public.adm_avaliar_resposta(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.adm_confirmar_vistoria(uuid, uuid, date, text, text) from public, anon, authenticated;
revoke all on function public.adm_concluir_analise(uuid, text, text, text) from public, anon, authenticated;
revoke all on function internal.notificar_equipe_inscricao(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.adm_avaliar_resposta(uuid, uuid, text, text, text) to area04_backend;
grant execute on function public.adm_confirmar_vistoria(uuid, uuid, date, text, text) to area04_backend;
grant execute on function public.adm_concluir_analise(uuid, text, text, text) to area04_backend;
grant usage on schema internal to area04_backend;
grant execute on function internal.etapas_liberadas(uuid) to area04_backend;
