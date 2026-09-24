import type { Context } from 'hono'
import { getDb } from '../lib/db'
import type { AppEnv } from '../types'

// Catálogo gerenciado pela administração: categorias, tags, preferências de
// turismo e itens do "Antes de ir". escopo define em qual área o item aparece
// (b2b = Área 02, b2g = Área 03, ambos).
const TIPOS = ['categoria', 'tag', 'preferencia_turismo', 'antes_de_ir'] as const
const ESCOPOS = ['b2b', 'b2g', 'ambos'] as const

type Tipo = (typeof TIPOS)[number]
type Escopo = (typeof ESCOPOS)[number]

interface ItemBody {
  tipo?: Tipo
  codigo?: string
  rotulo?: string
  icone?: string | null
  escopo?: Escopo
  ordem?: number
  ativo?: boolean
}

const COLUNAS = 'id, tipo, codigo, rotulo, icone, escopo, ordem, ativo, created_at, updated_at'

export async function listarCatalogo(c: Context<AppEnv>) {
  const sql = getDb(c.env)
  const tipo = c.req.query('tipo')
  if (tipo && !TIPOS.includes(tipo as Tipo)) return c.json({ error: `tipo deve ser: ${TIPOS.join(', ')}` }, 400)

  const itens = tipo
    ? await sql`select ${sql.unsafe(COLUNAS)} from catalogo_itens where tipo = ${tipo} order by ordem, rotulo`
    : await sql`select ${sql.unsafe(COLUNAS)} from catalogo_itens order by tipo, ordem, rotulo`
  return c.json({ itens })
}

export async function criarItemCatalogo(c: Context<AppEnv>) {
  const sql = getDb(c.env)
  const body = await c.req.json<ItemBody>().catch(() => null)

  if (!body?.tipo || !body.codigo || !body.rotulo) {
    return c.json({ error: 'Campos obrigatórios: tipo, codigo, rotulo' }, 400)
  }
  if (!TIPOS.includes(body.tipo)) return c.json({ error: `tipo deve ser: ${TIPOS.join(', ')}` }, 400)
  if (body.escopo && !ESCOPOS.includes(body.escopo)) return c.json({ error: `escopo deve ser: ${ESCOPOS.join(', ')}` }, 400)
  if (!/^[a-z0-9_]+$/.test(body.codigo)) return c.json({ error: 'codigo deve conter apenas letras minúsculas, números e _' }, 400)

  try {
    const [item] = await sql`
      insert into catalogo_itens (tipo, codigo, rotulo, icone, escopo, ordem)
      values (${body.tipo}, ${body.codigo}, ${body.rotulo}, ${body.icone ?? null}, ${body.escopo ?? 'ambos'}, ${body.ordem ?? 0})
      returning ${sql.unsafe(COLUNAS)}
    `
    return c.json(item, 201)
  } catch (e) {
    const mensagem = e instanceof Error ? e.message : 'Erro ao criar item'
    return c.json({ error: mensagem.includes('duplicate') ? 'Já existe um item com esse código nesse tipo' : mensagem }, 400)
  }
}

export async function atualizarItemCatalogo(c: Context<AppEnv>) {
  const sql = getDb(c.env)
  const id = c.req.param('id') as string
  const body = await c.req.json<ItemBody>().catch(() => null)

  if (!body) return c.json({ error: 'Corpo da requisição inválido' }, 400)
  if (body.escopo && !ESCOPOS.includes(body.escopo)) return c.json({ error: `escopo deve ser: ${ESCOPOS.join(', ')}` }, 400)

  const [item] = await sql`
    update catalogo_itens set
      rotulo = coalesce(${body.rotulo ?? null}, rotulo),
      icone = ${body.icone === undefined ? sql`icone` : body.icone},
      escopo = coalesce(${body.escopo ?? null}, escopo),
      ordem = coalesce(${body.ordem ?? null}, ordem),
      ativo = coalesce(${body.ativo ?? null}, ativo),
      updated_at = now()
    where id = ${id}
    returning ${sql.unsafe(COLUNAS)}
  `
  if (!item) return c.json({ error: 'Item não encontrado' }, 404)
  return c.json(item)
}

export async function reordenarCatalogo(c: Context<AppEnv>) {
  const sql = getDb(c.env)
  const body = await c.req.json<{ itens?: { id: string; ordem: number }[] }>().catch(() => null)

  if (!body?.itens || !Array.isArray(body.itens) || body.itens.length === 0) {
    return c.json({ error: 'Campo obrigatório: itens (array de { id, ordem })' }, 400)
  }

  await sql.begin(async (tx) => {
    for (const item of body.itens!) {
      await tx`update catalogo_itens set ordem = ${item.ordem}, updated_at = now() where id = ${item.id}`
    }
  })
  return c.json({ ok: true })
}

export async function excluirItemCatalogo(c: Context<AppEnv>) {
  const sql = getDb(c.env)
  const id = c.req.param('id') as string

  const resultado = await sql`delete from catalogo_itens where id = ${id}`
  if (resultado.count === 0) return c.json({ error: 'Item não encontrado' }, 404)
  return c.body(null, 204)
}
