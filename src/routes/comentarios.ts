import type { Context } from 'hono'
import { getDb } from '../lib/db'
import type { AppEnv } from '../types'

// Moderação de comentários: todo comentário enviado na página do
// empreendimento entra como 'pendente' e só aparece publicamente depois de
// aprovado aqui.
const STATUS = ['pendente', 'aprovado', 'reprovado'] as const
type Status = (typeof STATUS)[number]

export async function listarComentarios(c: Context<AppEnv>) {
  const sql = getDb(c.env.AREA04_DB_URL)
  const status = c.req.query('status')
  const pessoa = c.req.query('pessoa')?.trim()
  const empreendimento = c.req.query('empreendimento')?.trim()

  if (status && !STATUS.includes(status as Status)) return c.json({ error: `status deve ser: ${STATUS.join(', ')}` }, 400)

  const comentarios = await sql`
    select a.id, a.pagina_id, p.nome as pagina_nome, a.usuario_id, u.nome as usuario_nome, u.avatar_url as usuario_avatar_url,
           a.nota, a.comentario, a.status, a.motivo_moderacao, a.moderado_em, a.sinalizada, a.created_at
    from avaliacoes a
    join paginas p on p.id = a.pagina_id
    left join usuarios u on u.id = a.usuario_id
    where true
      ${status ? sql`and a.status = ${status}` : sql``}
      ${pessoa ? sql`and u.nome ilike ${'%' + pessoa + '%'}` : sql``}
      ${empreendimento ? sql`and p.nome ilike ${'%' + empreendimento + '%'}` : sql``}
    order by (a.status = 'pendente') desc, a.created_at desc
    limit 300
  `
  return c.json({ comentarios })
}

export async function moderarComentario(c: Context<AppEnv>) {
  const sql = getDb(c.env.AREA04_DB_URL)
  const id = c.req.param('id') as string
  const body = await c.req.json<{ status?: Status; motivo?: string }>().catch(() => null)

  if (!body?.status || !STATUS.includes(body.status)) {
    return c.json({ error: `Campo obrigatório: status (${STATUS.join(', ')})` }, 400)
  }

  const [comentario] = await sql`
    update avaliacoes set
      status = ${body.status},
      motivo_moderacao = ${body.motivo?.trim() || null}
    where id = ${id}
    returning id, status, motivo_moderacao, moderado_em
  `
  if (!comentario) return c.json({ error: 'Comentário não encontrado' }, 404)
  return c.json(comentario)
}
