-- Contador de proximidade da cobrança do Cloudflare R2 (arquivos das
-- certificações) na tela "Consumo de recursos em infraestrutura".
-- O plano grátis do R2 zera no ciclo de cobrança da conta (dia 21), não no dia 1º.
-- Projeto: grupo01-useast2.

alter table public.infraestrutura_limites
  add column if not exists dia_inicio_ciclo smallint not null default 1;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'infraestrutura_limites_dia_ciclo_check') then
    alter table public.infraestrutura_limites
      add constraint infraestrutura_limites_dia_ciclo_check check (dia_inicio_ciclo between 1 and 28);
  end if;
end $$;

insert into public.infraestrutura_limites (recurso, rotulo, limite, unidade, periodo, ordem, dia_inicio_ciclo) values
  ('r2_armazenamento', 'Arquivos das certificações (Cloudflare R2)', 10737418240, 'bytes', 'total', 6, 21),
  ('r2_operacoes_a', 'Envios de arquivos (R2, operações classe A)', 1000000, 'requisicoes', 'mes', 7, 21),
  ('r2_operacoes_b', 'Leituras de arquivos (R2, operações classe B)', 10000000, 'requisicoes', 'mes', 8, 21)
on conflict (recurso) do nothing;
