import type { Context } from 'hono'
import { getDb } from '../lib/db'
import type { AppEnv } from '../types'

// Relatório de eventos e interessados (Etapa 7)

export async function listarEventosAdm(c: Context<AppEnv>) {
  const sql = getDb(c.env)
  const q = c.req.query()
  const de = q.de ? new Date(q.de) : new Date(Date.now() - 30 * 24 * 3600 * 1000)
  const ate = q.ate ? new Date(q.ate) : new Date(Date.now() + 366 * 24 * 3600 * 1000)
  if (Number.isNaN(de.getTime()) || Number.isNaN(ate.getTime())) return c.json({ error: 'Período inválido' }, 400)
  const busca = q.q ? `%${q.q.slice(0, 80)}%` : null

  const eventos = await sql`
    select e.id, e.titulo, e.inicio, e.fim, e.local_nome, e.cidade, e.uf, e.pais, e.gratuito, e.publicado,
           e.total_interessados, e.criado_em, p.id as pagina_id, p.nome as pagina_nome, p.tipo::text as pagina_tipo
    from eventos e
    join paginas p on p.id = e.pagina_id
    where e.inicio <= ${ate} and coalesce(e.fim, e.inicio) >= ${de}
      and (${busca}::text is null or e.titulo ilike ${busca} or p.nome ilike ${busca} or e.cidade ilike ${busca})
    order by e.inicio desc
    limit 500
  `
  const [resumo] = await sql`
    select count(*)::int as total_eventos,
           count(*) filter (where coalesce(e.fim, e.inicio) >= now())::int as proximos,
           coalesce(sum(e.total_interessados), 0)::int as total_interesses,
           count(distinct i.usuario_id)::int as pessoas_interessadas
    from eventos e
    left join evento_interesses i on i.evento_id = e.id
    where e.inicio <= ${ate} and coalesce(e.fim, e.inicio) >= ${de}
  `
  return c.json({ eventos, resumo })
}

export async function interessadosEventoAdm(c: Context<AppEnv>) {
  const sql = getDb(c.env)
  const id = c.req.param('id') as string
  if (!/^[0-9a-f-]{36}$/i.test(id)) return c.json({ error: 'Evento inválido' }, 400)
  const interessados = await sql`
    select coalesce(nullif(u.nome_social, ''), u.nome) as nome, u.cidade, u.uf, i.criado_em
    from evento_interesses i
    join usuarios u on u.id = i.usuario_id
    where i.evento_id = ${id}
    order by i.criado_em desc
  `
  return c.json({ interessados })
}
