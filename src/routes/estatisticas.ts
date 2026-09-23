import type { Context } from 'hono'
import { getDb } from '../lib/db'
import type { AppEnv } from '../types'

interface LinhaEstatistica {
  mes: string
  usuarios: number
  empresas: number
  gov: number
  logins_pessoa_empresa: number
  logins_gov: number
}

export async function estatisticas(c: Context<AppEnv>) {
  const sql = getDb(c.env)

  const linhas = await sql<LinhaEstatistica[]>`
    with meses as (
      select generate_series(
        date_trunc('month', now()) - interval '11 months',
        date_trunc('month', now()),
        interval '1 month'
      ) as mes
    ),
    usu as (
      select date_trunc('month', created_at) as mes, count(*)::int as total
      from usuarios group by 1
    ),
    emp as (
      select date_trunc('month', created_at) as mes, count(*)::int as total
      from paginas where tipo = 'privada' group by 1
    ),
    gov as (
      select date_trunc('month', created_at) as mes, count(*)::int as total
      from gov_contas group by 1
    ),
    log_pe as (
      select date_trunc('month', created_at) as mes, count(*)::int as total
      from login_eventos where origem = 'pessoa_empresa' group by 1
    ),
    log_gov as (
      select date_trunc('month', created_at) as mes, count(*)::int as total
      from login_eventos where origem = 'gov' group by 1
    )
    select
      to_char(m.mes, 'YYYY-MM') as mes,
      coalesce(usu.total, 0) as usuarios,
      coalesce(emp.total, 0) as empresas,
      coalesce(gov.total, 0) as gov,
      coalesce(log_pe.total, 0) as logins_pessoa_empresa,
      coalesce(log_gov.total, 0) as logins_gov
    from meses m
    left join usu on usu.mes = m.mes
    left join emp on emp.mes = m.mes
    left join gov on gov.mes = m.mes
    left join log_pe on log_pe.mes = m.mes
    left join log_gov on log_gov.mes = m.mes
    order by m.mes
  `

  return c.json({
    meses: linhas.map((l) => l.mes),
    usuarios_por_mes: linhas.map((l) => l.usuarios),
    empresas_por_mes: linhas.map((l) => l.empresas),
    gov_por_mes: linhas.map((l) => l.gov),
    logins_pessoa_empresa_por_mes: linhas.map((l) => l.logins_pessoa_empresa),
    logins_gov_por_mes: linhas.map((l) => l.logins_gov),
  })
}

interface LinhaEstatisticaAno {
  mes: string
  usuarios: number
  empresas: number
  gov: number
}

export async function estatisticasPorAno(c: Context<AppEnv>) {
  const anoParam = c.req.query('ano')
  if (!anoParam || !/^\d{4}$/.test(anoParam)) {
    return c.json({ error: "Parâmetro obrigatório: ano (formato 'YYYY')" }, 400)
  }
  const ano = Number(anoParam)

  const sql = getDb(c.env)

  const linhas = await sql<LinhaEstatisticaAno[]>`
    with meses as (
      select generate_series(
        make_date(${ano}, 1, 1),
        make_date(${ano}, 12, 1),
        interval '1 month'
      ) as mes
    ),
    usu as (
      select date_trunc('month', created_at) as mes, count(*)::int as total
      from usuarios where extract(year from created_at) = ${ano} group by 1
    ),
    emp as (
      select date_trunc('month', created_at) as mes, count(*)::int as total
      from paginas where tipo = 'privada' and extract(year from created_at) = ${ano} group by 1
    ),
    gov as (
      select date_trunc('month', created_at) as mes, count(*)::int as total
      from gov_contas where extract(year from created_at) = ${ano} group by 1
    )
    select
      to_char(m.mes, 'MM') as mes,
      coalesce(usu.total, 0) as usuarios,
      coalesce(emp.total, 0) as empresas,
      coalesce(gov.total, 0) as gov
    from meses m
    left join usu on usu.mes = m.mes
    left join emp on emp.mes = m.mes
    left join gov on gov.mes = m.mes
    order by m.mes
  `

  return c.json({
    ano,
    meses: linhas.map((l) => l.mes),
    usuarios_por_mes: linhas.map((l) => l.usuarios),
    empresas_por_mes: linhas.map((l) => l.empresas),
    gov_por_mes: linhas.map((l) => l.gov),
  })
}

interface LinhaLoginsPorDia {
  dia: string
  logins_pessoa_empresa: number
  logins_gov: number
}

export async function estatisticasLoginsPorDia(c: Context<AppEnv>) {
  const anoParam = c.req.query('ano')
  const mesParam = c.req.query('mes')

  if (!anoParam || !/^\d{4}$/.test(anoParam)) {
    return c.json({ error: "Parâmetro obrigatório: ano (formato 'YYYY')" }, 400)
  }
  const mes = Number(mesParam)
  if (!mesParam || !Number.isInteger(mes) || mes < 1 || mes > 12) {
    return c.json({ error: 'Parâmetro obrigatório: mes (1 a 12)' }, 400)
  }
  const ano = Number(anoParam)

  const sql = getDb(c.env)

  const linhas = await sql<LinhaLoginsPorDia[]>`
    with dias as (
      select generate_series(
        make_date(${ano}, ${mes}, 1),
        (make_date(${ano}, ${mes}, 1) + interval '1 month - 1 day')::date,
        interval '1 day'
      ) as dia
    ),
    log_pe as (
      select date_trunc('day', created_at) as dia, count(*)::int as total
      from login_eventos
      where origem = 'pessoa_empresa'
        and extract(year from created_at) = ${ano}
        and extract(month from created_at) = ${mes}
      group by 1
    ),
    log_gov as (
      select date_trunc('day', created_at) as dia, count(*)::int as total
      from login_eventos
      where origem = 'gov'
        and extract(year from created_at) = ${ano}
        and extract(month from created_at) = ${mes}
      group by 1
    )
    select
      to_char(d.dia, 'DD') as dia,
      coalesce(log_pe.total, 0) as logins_pessoa_empresa,
      coalesce(log_gov.total, 0) as logins_gov
    from dias d
    left join log_pe on log_pe.dia = d.dia
    left join log_gov on log_gov.dia = d.dia
    order by d.dia
  `

  return c.json({
    ano,
    mes,
    dias: linhas.map((l) => l.dia),
    logins_pessoa_empresa_por_dia: linhas.map((l) => l.logins_pessoa_empresa),
    logins_gov_por_dia: linhas.map((l) => l.logins_gov),
  })
}
