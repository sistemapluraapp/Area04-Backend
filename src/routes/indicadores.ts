import type { Context } from 'hono'
import { getDb } from '../lib/db'
import type { AppEnv } from '../types'

export async function indicadores(c: Context<AppEnv>) {
  const sql = getDb(c.env)

  const [linha] = await sql`
    select
      (select count(*) from usuarios)::int as usuarios,
      (select count(*) from gov_contas)::int as contas_gov,
      (select count(*) from paginas where tipo = 'privada')::int as paginas_privadas,
      (select count(*) from paginas where tipo = 'publica')::int as paginas_publicas,
      (select count(*) from avaliacoes)::int as avaliacoes,
      (select count(*) from avaliacoes where sinalizada)::int as avaliacoes_sinalizadas,
      (select count(*) from certificados where status = 'pendente')::int as certificados_pendentes,
      (select count(*) from certificados where status = 'aprovado')::int as certificados_aprovados,
      (select count(*) from certificados where status = 'reprovado')::int as certificados_reprovados
  `

  return c.json(linha)
}
