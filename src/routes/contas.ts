import type { Context } from 'hono'
import { getDb } from '../lib/db'
import type { AppEnv } from '../types'

export async function listarUsuarios(c: Context<AppEnv>) {
  const sql = getDb(c.env.AREA04_DB_URL)
  const usuarios = await sql`select id, cpf, nome, created_at from usuarios order by created_at desc limit 200`
  return c.json({ usuarios })
}

export async function listarGovContas(c: Context<AppEnv>) {
  const sql = getDb(c.env.AREA04_DB_URL)
  const contas = await sql`
    select id, nome, orgao, cidade, nivel_acesso, created_at
    from gov_contas order by created_at desc limit 200
  `
  return c.json({ contas })
}

export async function listarPaginas(c: Context<AppEnv>) {
  const sql = getDb(c.env.AREA04_DB_URL)
  const paginas = await sql`select id, tipo, nome, descricao, created_at from paginas order by created_at desc limit 200`
  return c.json({ paginas })
}

export async function excluirConta(c: Context<AppEnv>) {
  const id = c.req.param('id') as string
  const sql = getDb(c.env.AREA04_DB_URL)

  // Apaga o auth.users; usuarios/gov_contas têm ON DELETE CASCADE a partir
  // dele, então o perfil some junto — evita conta órfã.
  const resultado = await sql`delete from auth.users where id = ${id}`
  if (resultado.count === 0) {
    return c.json({ error: 'Conta não encontrada' }, 404)
  }
  return c.body(null, 204)
}
