import type { Context } from 'hono'
import { getDb } from '../lib/db'
import type { AppEnv } from '../types'

export async function listarUsuarios(c: Context<AppEnv>) {
  const sql = getDb(c.env.AREA04_DB_URL)
  const nome = c.req.query('nome')
  const uf = c.req.query('uf')

  const usuarios = await sql`
    select u.id, u.cpf, u.nome, u.cidade, u.uf, u.suspenso, u.created_at, au.email
    from usuarios u
    left join auth.users au on au.id = u.id
    where (${nome ?? null}::text is null or u.nome ilike '%' || ${nome ?? null} || '%')
      and (${uf ?? null}::text is null or u.uf = ${uf ?? null})
    order by u.created_at desc
    limit 200
  `
  return c.json({ usuarios })
}

export async function listarGovContas(c: Context<AppEnv>) {
  const sql = getDb(c.env.AREA04_DB_URL)
  const nome = c.req.query('nome')
  const uf = c.req.query('uf')

  const contas = await sql`
    select g.id, g.nome, g.orgao, g.cidade, g.uf, g.nivel_acesso, g.suspenso, g.created_at, au.email
    from gov_contas g
    left join auth.users au on au.id = g.id
    where (${nome ?? null}::text is null or g.nome ilike '%' || ${nome ?? null} || '%')
      and (${uf ?? null}::text is null or g.uf = ${uf ?? null})
    order by g.created_at desc
    limit 200
  `
  return c.json({ contas })
}

export async function listarPaginas(c: Context<AppEnv>) {
  const sql = getDb(c.env.AREA04_DB_URL)
  const nome = c.req.query('nome')
  const uf = c.req.query('uf')

  const paginas = await sql`
    select id, tipo, nome, descricao, endereco, cidade, uf, suspensa, latitude, longitude, created_at
    from paginas
    where (${nome ?? null}::text is null or nome ilike '%' || ${nome ?? null} || '%')
      and (${uf ?? null}::text is null or uf = ${uf ?? null})
    order by created_at desc
    limit 200
  `
  return c.json({ paginas })
}

export async function suspenderUsuario(c: Context<AppEnv>) {
  const id = c.req.param('id') as string
  const sql = getDb(c.env.AREA04_DB_URL)

  const [usuario] = await sql`
    update usuarios set suspenso = not suspenso where id = ${id}
    returning id, suspenso
  `
  if (!usuario) return c.json({ error: 'Usuário não encontrado' }, 404)
  return c.json(usuario)
}

export async function suspenderGovConta(c: Context<AppEnv>) {
  const id = c.req.param('id') as string
  const sql = getDb(c.env.AREA04_DB_URL)

  const [conta] = await sql`
    update gov_contas set suspenso = not suspenso where id = ${id}
    returning id, suspenso
  `
  if (!conta) return c.json({ error: 'Conta não encontrada' }, 404)
  return c.json(conta)
}

export async function suspenderPagina(c: Context<AppEnv>) {
  const id = c.req.param('id') as string
  const sql = getDb(c.env.AREA04_DB_URL)

  const [pagina] = await sql`
    update paginas set suspensa = not suspensa where id = ${id}
    returning id, suspensa
  `
  if (!pagina) return c.json({ error: 'Página não encontrada' }, 404)
  return c.json(pagina)
}

export async function atualizarUsuario(c: Context<AppEnv>) {
  const id = c.req.param('id') as string
  const body = await c.req.json<{ uf?: string }>().catch(() => null)

  if (!body?.uf) {
    return c.json({ error: 'Campo obrigatório: uf' }, 400)
  }

  const sql = getDb(c.env.AREA04_DB_URL)
  const [usuario] = await sql`
    update usuarios set uf = ${body.uf} where id = ${id}
    returning id, uf
  `
  if (!usuario) return c.json({ error: 'Usuário não encontrado' }, 404)
  return c.json(usuario)
}

export async function atualizarGovConta(c: Context<AppEnv>) {
  const id = c.req.param('id') as string
  const body = await c.req.json<{ uf?: string }>().catch(() => null)

  if (!body?.uf) {
    return c.json({ error: 'Campo obrigatório: uf' }, 400)
  }

  const sql = getDb(c.env.AREA04_DB_URL)
  const [conta] = await sql`
    update gov_contas set uf = ${body.uf} where id = ${id}
    returning id, uf
  `
  if (!conta) return c.json({ error: 'Conta não encontrada' }, 404)
  return c.json(conta)
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
