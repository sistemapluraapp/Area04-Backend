import type { Context } from 'hono'
import { getDb } from '../lib/db'
import type { AppEnv } from '../types'

interface NovoFiltroBody {
  tipo?: 'recurso_local' | 'necessidade_pessoal'
  categoria?: string
  codigo?: string
  rotulo?: string
  ordem?: number
}

interface AtualizarFiltroBody {
  categoria?: string
  rotulo?: string
  ordem?: number
  ativo?: boolean
}

export async function listarFiltros(c: Context<AppEnv>) {
  const sql = getDb(c.env.AREA04_DB_URL)
  const filtros = await sql`
    select id, tipo, categoria, codigo, rotulo, ordem, ativo, created_at, updated_at
    from filtros_acessibilidade
    order by tipo, categoria, ordem
  `
  return c.json({ filtros })
}

export async function criarFiltro(c: Context<AppEnv>) {
  const sql = getDb(c.env.AREA04_DB_URL)
  const body = await c.req.json<NovoFiltroBody>().catch(() => null)

  if (!body?.tipo || !body.categoria || !body.codigo || !body.rotulo) {
    return c.json({ error: 'Campos obrigatórios: tipo, categoria, codigo, rotulo' }, 400)
  }
  if (body.tipo !== 'recurso_local' && body.tipo !== 'necessidade_pessoal') {
    return c.json({ error: "Campo tipo deve ser 'recurso_local' ou 'necessidade_pessoal'" }, 400)
  }

  try {
    const [filtro] = await sql`
      insert into filtros_acessibilidade (tipo, categoria, codigo, rotulo, ordem)
      values (${body.tipo}, ${body.categoria}, ${body.codigo}, ${body.rotulo}, ${body.ordem ?? 0})
      returning id, tipo, categoria, codigo, rotulo, ordem, ativo, created_at, updated_at
    `
    return c.json(filtro, 201)
  } catch (e) {
    const mensagem = e instanceof Error ? e.message : 'Erro ao criar filtro'
    return c.json({ error: mensagem.includes('duplicate') ? 'Já existe um filtro com esse código para esse tipo' : mensagem }, 400)
  }
}

export async function atualizarFiltro(c: Context<AppEnv>) {
  const sql = getDb(c.env.AREA04_DB_URL)
  const id = c.req.param('id') as string
  const body = await c.req.json<AtualizarFiltroBody>().catch(() => null)

  if (!body) return c.json({ error: 'Corpo da requisição inválido' }, 400)

  const [filtro] = await sql`
    update filtros_acessibilidade set
      categoria = coalesce(${body.categoria ?? null}, categoria),
      rotulo = coalesce(${body.rotulo ?? null}, rotulo),
      ordem = coalesce(${body.ordem ?? null}, ordem),
      ativo = coalesce(${body.ativo ?? null}, ativo),
      updated_at = now()
    where id = ${id}
    returning id, tipo, categoria, codigo, rotulo, ordem, ativo, created_at, updated_at
  `

  if (!filtro) return c.json({ error: 'Filtro não encontrado' }, 404)
  return c.json(filtro)
}

export async function reordenarFiltros(c: Context<AppEnv>) {
  const sql = getDb(c.env.AREA04_DB_URL)
  const body = await c.req.json<{ itens?: { id: string; ordem: number }[] }>().catch(() => null)

  if (!body?.itens || !Array.isArray(body.itens) || body.itens.length === 0) {
    return c.json({ error: 'Campo obrigatório: itens (array de { id, ordem })' }, 400)
  }

  await sql.begin(async (tx) => {
    for (const item of body.itens!) {
      await tx`update filtros_acessibilidade set ordem = ${item.ordem}, updated_at = now() where id = ${item.id}`
    }
  })

  return c.json({ ok: true })
}

export async function excluirFiltro(c: Context<AppEnv>) {
  const sql = getDb(c.env.AREA04_DB_URL)
  const id = c.req.param('id') as string

  const resultado = await sql`delete from filtros_acessibilidade where id = ${id}`
  if (resultado.count === 0) return c.json({ error: 'Filtro não encontrado' }, 404)

  return c.body(null, 204)
}
