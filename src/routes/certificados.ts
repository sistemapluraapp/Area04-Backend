import type { Context } from 'hono'
import { getDb } from '../lib/db'
import type { AppEnv } from '../types'

export async function listarPendentes(c: Context<AppEnv>) {
  const sql = getDb(c.env.AREA04_DB_URL)
  const certificados = await sql`
    select c.id, c.pagina_id, p.nome as pagina_nome, c.status, c.solicitado_em
    from certificados c
    join paginas p on p.id = c.pagina_id
    where c.status = 'pendente'
    order by c.solicitado_em asc
  `
  return c.json({ certificados })
}

export async function atualizarStatus(c: Context<AppEnv>) {
  const id = c.req.param('id') as string
  const body = await c.req.json<{ status?: string }>().catch(() => null)

  if (!body || (body.status !== 'aprovado' && body.status !== 'reprovado')) {
    return c.json({ error: "Campo obrigatório: status ('aprovado' ou 'reprovado')" }, 400)
  }
  const status = body.status

  const sql = getDb(c.env.AREA04_DB_URL)
  const [certificado] = await sql`
    update certificados set status = ${status} where id = ${id}
    returning id, pagina_id, status, solicitado_em, avaliado_em
  `

  if (!certificado) return c.json({ error: 'Certificado não encontrado' }, 404)
  return c.json(certificado)
}
