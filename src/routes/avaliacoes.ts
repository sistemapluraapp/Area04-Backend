import type { Context } from 'hono'
import { getDb } from '../lib/db'
import type { AppEnv } from '../types'

export async function listarSinalizadas(c: Context<AppEnv>) {
  const sql = getDb(c.env.AREA04_DB_URL)
  const avaliacoes = await sql`
    select a.id, a.pagina_id, p.nome as pagina_nome, a.nota, a.comentario, a.resposta, a.sinalizada, a.created_at
    from avaliacoes a
    join paginas p on p.id = a.pagina_id
    where a.sinalizada = true
    order by a.created_at desc
  `
  return c.json({ avaliacoes })
}

export async function listarTodas(c: Context<AppEnv>) {
  const sql = getDb(c.env.AREA04_DB_URL)
  const avaliacoes = await sql`
    select a.id, a.pagina_id, p.nome as pagina_nome, a.nota, a.comentario, a.resposta, a.sinalizada, a.created_at
    from avaliacoes a
    join paginas p on p.id = a.pagina_id
    order by a.created_at desc
    limit 200
  `
  return c.json({ avaliacoes })
}
