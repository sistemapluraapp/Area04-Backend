import type { Context } from 'hono'
import { getDb } from '../lib/db'
import type { AppEnv } from '../types'

// "Essa informação está incorreta?" — denúncias enviadas pelos usuários na
// página do empreendimento.
const STATUS = ['pendente', 'resolvida', 'descartada'] as const
type Status = (typeof STATUS)[number]

export async function listarDenuncias(c: Context<AppEnv>) {
  const sql = getDb(c.env.AREA04_DB_URL)
  const status = c.req.query('status')
  if (status && !STATUS.includes(status as Status)) return c.json({ error: `status deve ser: ${STATUS.join(', ')}` }, 400)

  const denuncias = await sql`
    select d.id, d.pagina_id, p.nome as pagina_nome, d.usuario_id, u.nome as usuario_nome,
           d.motivo, d.comentario, d.status, d.observacao_admin, d.resolvida_em, d.created_at
    from denuncias_informacao d
    join paginas p on p.id = d.pagina_id
    left join usuarios u on u.id = d.usuario_id
    ${status ? sql`where d.status = ${status}` : sql``}
    order by d.created_at desc
    limit 300
  `
  return c.json({ denuncias })
}

export async function atualizarDenuncia(c: Context<AppEnv>) {
  const sql = getDb(c.env.AREA04_DB_URL)
  const id = c.req.param('id') as string
  const body = await c.req.json<{ status?: Status; observacao_admin?: string }>().catch(() => null)

  if (!body?.status || !STATUS.includes(body.status)) {
    return c.json({ error: `Campo obrigatório: status (${STATUS.join(', ')})` }, 400)
  }

  const [denuncia] = await sql`
    update denuncias_informacao set
      status = ${body.status},
      observacao_admin = coalesce(${body.observacao_admin ?? null}, observacao_admin),
      resolvida_em = ${body.status === 'pendente' ? null : sql`now()`}
    where id = ${id}
    returning id, status, observacao_admin, resolvida_em
  `
  if (!denuncia) return c.json({ error: 'Denúncia não encontrada' }, 404)
  return c.json(denuncia)
}
