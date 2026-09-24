import type { Context } from 'hono'
import { getDb } from '../lib/db'
import type { AppEnv } from '../types'

function gerarToken(): string {
  return crypto.randomUUID().replace(/-/g, '')
}

export async function criarConvite(c: Context<AppEnv>) {
  const body = await c.req
    .json<{ cidade?: string; uf?: string; dias_validade?: number }>()
    .catch(() => null)

  if (!body?.cidade) {
    return c.json({ error: 'Campo obrigatório: cidade' }, 400)
  }

  const dias = body.dias_validade && body.dias_validade > 0 ? Math.floor(body.dias_validade) : 7
  const token = gerarToken()
  const sql = getDb(c.env)

  const [convite] = await sql`
    insert into chaves_acesso_gov (token, cidade, uf, expira_em)
    values (${token}, ${body.cidade}, ${body.uf ?? null}, now() + (${dias} || ' days')::interval)
    returning token, cidade, uf, criado_em, expira_em
  `

  return c.json(convite, 201)
}

export async function listarConvites(c: Context<AppEnv>) {
  const sql = getDb(c.env)
  const convites = await sql`
    select token, cidade, uf, criado_em, expira_em, usado, usado_em
    from chaves_acesso_gov
    order by criado_em desc
    limit 200
  `
  return c.json({ convites })
}
