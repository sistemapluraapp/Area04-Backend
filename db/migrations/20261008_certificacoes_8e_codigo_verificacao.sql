-- Etapa 8e: código do certificado, selo na página pública, verificação
-- pública por código e e-mail de concessão com o código. Projeto: grupo01-useast2.

alter table public.certificacao_inscricoes add column if not exists codigo text;
create unique index if not exists certificacao_inscricoes_codigo_idx on public.certificacao_inscricoes (codigo) where codigo is not null;

-- Código legível e sem caracteres ambíguos: PLURA-XXXX-XXXX
create or replace function internal.gerar_codigo_certificado()
returns text
language plpgsql
volatile
set search_path to 'public'
as $$
declare
  alfabeto constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v text;
  i int;
begin
  loop
    v := 'PLURA-';
    for i in 1 .. 8 loop
      v := v || substr(alfabeto, 1 + floor(random() * length(alfabeto))::int, 1);
      if i = 4 then v := v || '-'; end if;
    end loop;
    exit when not exists (select 1 from certificacao_inscricoes where codigo = v);
  end loop;
  return v;
end;
$$;

-- Certificadas antes desta etapa também ganham código
update public.certificacao_inscricoes set codigo = internal.gerar_codigo_certificado()
where status = 'aprovada' and codigo is null;

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
      v_corpo := null; -- montado depois do update, com o código do certificado
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
                       then now() + make_interval(months => v_cert.validade_meses) else expira_em end,
      codigo = case when v_status = 'aprovada' then coalesce(codigo, internal.gerar_codigo_certificado()) else codigo end
    where id = p_inscricao_id returning * into v_insc;
    if v_status = 'aprovada' then
      v_corpo := 'Parabéns! A página recebeu a certificação ' || v_cert.titulo
        || case when v_insc.expira_em is not null then ', válida até ' || to_char(v_insc.expira_em, 'DD/MM/YYYY') else '' end
        || '. Código de verificação: ' || v_insc.codigo
        || '. Baixe o certificado em PDF na aba "Selos e certificações" da página. Qualquer pessoa pode conferir em plura.app.br/verificar.';
    end if;
  else
    raise exception 'Decisão inválida' using errcode = '22023';
  end if;

  insert into pagina_logs (pagina_id, autor_id, autor_nome, acao)
  values (v_insc.pagina_id, null, 'Plura (administração)', left(v_acao, 300));
  perform internal.notificar_equipe_inscricao(p_inscricao_id, v_tipo, v_titulo, v_corpo);
  return v_insc;
end;
$$;


-- Selos válidos de uma página (página pública da Área 01)
create or replace function public.certificacoes_publicas_pagina(p_pagina_id uuid)
returns table (codigo text, titulo text, icone text, imagem_url text, concedida_em timestamptz, expira_em timestamptz)
language sql
stable
security definer
set search_path to 'public'
as $$
  select i.codigo, c.titulo, c.icone, c.imagem_url, i.concedida_em, i.expira_em
  from certificacao_inscricoes i
  join certificacoes c on c.id = i.certificacao_id
  join paginas p on p.id = i.pagina_id
  where i.pagina_id = p_pagina_id and i.status = 'aprovada' and i.codigo is not null
    and (i.expira_em is null or i.expira_em > now())
    and p.excluida_em is null and not coalesce(p.suspensa, false)
  order by i.concedida_em;
$$;

-- Verificação pública pelo código
create or replace function public.verificar_certificacao(p_codigo text)
returns table (codigo text, certificacao_titulo text, certificacao_icone text, certificacao_resumo text,
  pagina_id uuid, pagina_nome text, pagina_tipo text, pagina_cidade text, pagina_uf text,
  concedida_em timestamptz, expira_em timestamptz, situacao text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select i.codigo, c.titulo, c.icone, c.resumo, p.id, p.nome, p.tipo::text, p.cidade, p.uf, i.concedida_em, i.expira_em,
    case
      when i.status <> 'aprovada' then 'invalida'
      when i.expira_em is not null and i.expira_em <= now() then 'vencida'
      else 'valida'
    end
  from certificacao_inscricoes i
  join certificacoes c on c.id = i.certificacao_id
  join paginas p on p.id = i.pagina_id
  where i.codigo = upper(trim(p_codigo)) and p.excluida_em is null;
$$;

revoke all on function internal.gerar_codigo_certificado() from public, anon, authenticated;
revoke all on function public.certificacoes_publicas_pagina(uuid) from public;
revoke all on function public.verificar_certificacao(text) from public;
grant execute on function public.certificacoes_publicas_pagina(uuid) to anon, authenticated, area04_backend;
grant execute on function public.verificar_certificacao(text) to anon, authenticated, area04_backend;
