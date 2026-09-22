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
  const sql = getDb(c.env.AREA04_DB_URL)

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
