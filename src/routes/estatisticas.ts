import type { Context } from 'hono'
import { getDb } from '../lib/db'
import type { AppEnv } from '../types'

interface PontoMensal {
  mes: string
  total: number
}

function preencherMeses(meses: string[], linhas: PontoMensal[]): number[] {
  const porMes = new Map(linhas.map((l) => [l.mes, l.total]))
  return meses.map((m) => porMes.get(m) ?? 0)
}

export async function estatisticas(c: Context<AppEnv>) {
  const sql = getDb(c.env.AREA04_DB_URL)

  const mesesLinhas = await sql<{ mes: string }[]>`
    select to_char(d, 'YYYY-MM') as mes
    from generate_series(date_trunc('month', now()) - interval '11 months', date_trunc('month', now()), interval '1 month') d
  `
  const meses = mesesLinhas.map((l) => l.mes)
  const desde = 'date_trunc(\'month\', now()) - interval \'11 months\''

  const [usuariosLinhas, empresasLinhas, govLinhas, loginsLinhas] = await Promise.all([
    sql<PontoMensal[]>`
      select to_char(date_trunc('month', created_at), 'YYYY-MM') as mes, count(*)::int as total
      from usuarios where created_at >= date_trunc('month', now()) - interval '11 months'
      group by 1
    `,
    sql<PontoMensal[]>`
      select to_char(date_trunc('month', created_at), 'YYYY-MM') as mes, count(*)::int as total
      from paginas where tipo = 'privada' and created_at >= date_trunc('month', now()) - interval '11 months'
      group by 1
    `,
    sql<PontoMensal[]>`
      select to_char(date_trunc('month', created_at), 'YYYY-MM') as mes, count(*)::int as total
      from gov_contas where created_at >= date_trunc('month', now()) - interval '11 months'
      group by 1
    `,
    sql<{ mes: string; origem: string; total: number }[]>`
      select to_char(date_trunc('month', created_at), 'YYYY-MM') as mes, origem, count(*)::int as total
      from login_eventos where created_at >= date_trunc('month', now()) - interval '11 months'
      group by 1, 2
    `,
  ])

  const loginsPessoaEmpresa = loginsLinhas.filter((l) => l.origem === 'pessoa_empresa')
  const loginsGov = loginsLinhas.filter((l) => l.origem === 'gov')

  return c.json({
    meses,
    usuarios_por_mes: preencherMeses(meses, usuariosLinhas),
    empresas_por_mes: preencherMeses(meses, empresasLinhas),
    gov_por_mes: preencherMeses(meses, govLinhas),
    logins_pessoa_empresa_por_mes: preencherMeses(meses, loginsPessoaEmpresa),
    logins_gov_por_mes: preencherMeses(meses, loginsGov),
  })
}
