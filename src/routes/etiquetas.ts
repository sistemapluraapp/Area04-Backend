import type { Context } from 'hono'
import { getDb } from '../lib/db'
import type { AppEnv } from '../types'

// Etiquetas da administração (ex.: Oficial, Parceiro): título + ícone. Cada
// página recebe no máximo uma; ela aparece nos cards da busca e no topo da
// página pública. Donos das páginas não conseguem alterá-la (trigger no banco).

interface EtiquetaBody {
  titulo?: string
  icone?: string | null
  descricao?: string | null
  ativo?: boolean
}

const COLUNAS = 'e.id, e.titulo, e.icone, e.descricao, e.ativo, e.created_at, e.updated_at'

function texto(valor: unknown, limite: number): string | null | undefined {
  if (valor === undefined) return undefined
  if (valor === null) return null
  const t = String(valor).trim()
  return t ? t.slice(0, limite) : null
}

export async function listarEtiquetas(c: Context<AppEnv>) {
  const sql = getDb(c.env)
  const etiquetas = await sql`
    select ${sql.unsafe(COLUNAS)}, (select count(*)::int from paginas p where p.etiqueta_id = e.id) as total_paginas
    from etiquetas e
    order by e.titulo
  `
  return c.json({ etiquetas })
}

export async function criarEtiqueta(c: Context<AppEnv>) {
  const sql = getDb(c.env)
  const body = await c.req.json<EtiquetaBody>().catch(() => null)
  const titulo = texto(body?.titulo, 40)
  if (!titulo) return c.json({ error: 'Informe o título da etiqueta (até 40 caracteres)' }, 400)

  const [etiqueta] = await sql`
    insert into etiquetas (titulo, icone, descricao)
    values (${titulo}, ${texto(body?.icone, 80) ?? null}, ${texto(body?.descricao, 300) ?? null})
    returning id, titulo, icone, descricao, ativo, created_at, updated_at
  `
  return c.json({ ...etiqueta, total_paginas: 0 }, 201)
}

export async function atualizarEtiqueta(c: Context<AppEnv>) {
  const sql = getDb(c.env)
  const id = c.req.param('id') as string
  const body = await c.req.json<EtiquetaBody>().catch(() => null)
  if (!body) return c.json({ error: 'Corpo da requisição inválido' }, 400)
  const titulo = texto(body.titulo, 40)
  if (body.titulo !== undefined && !titulo) return c.json({ error: 'O título não pode ficar vazio' }, 400)

  const [etiqueta] = await sql`
    update etiquetas set
      titulo = coalesce(${titulo ?? null}, titulo),
      icone = ${body.icone === undefined ? sql`icone` : texto(body.icone, 80) ?? null},
      descricao = ${body.descricao === undefined ? sql`descricao` : texto(body.descricao, 300) ?? null},
      ativo = coalesce(${body.ativo ?? null}, ativo),
      updated_at = now()
    where id = ${id}
    returning id, titulo, icone, descricao, ativo, created_at, updated_at
  `
  if (!etiqueta) return c.json({ error: 'Etiqueta não encontrada' }, 404)
  return c.json(etiqueta)
}

// Excluir tira a etiqueta das páginas que a usam (on delete set null)
export async function excluirEtiqueta(c: Context<AppEnv>) {
  const sql = getDb(c.env)
  const id = c.req.param('id') as string
  const resultado = await sql`delete from etiquetas where id = ${id}`
  if (resultado.count === 0) return c.json({ error: 'Etiqueta não encontrada' }, 404)
  return c.body(null, 204)
}

// Páginas para aplicar etiquetas: busca por nome/cidade, ou só as etiquetadas
export async function paginasParaEtiquetar(c: Context<AppEnv>) {
  const sql = getDb(c.env)
  const termo = c.req.query('q')?.trim().slice(0, 80) ?? ''
  const soEtiquetadas = c.req.query('etiquetadas') === '1'
  const filtro = `%${termo.replace(/[%_\\]/g, (m) => `\\${m}`)}%`
  const paginas = await sql`
    select p.id, p.nome, p.tipo, p.cidade, p.uf, p.logo_url, p.etiqueta_id, p.suspensa
    from paginas p
    where p.excluida_em is null
      ${termo ? sql`and (p.nome ilike ${filtro} or p.cidade ilike ${filtro})` : sql``}
      ${soEtiquetadas ? sql`and p.etiqueta_id is not null` : sql``}
    order by p.nome
    limit 50
  `
  return c.json({ paginas })
}

export async function aplicarEtiqueta(c: Context<AppEnv>) {
  const sql = getDb(c.env)
  const paginaId = c.req.param('paginaId') as string
  const body = await c.req.json<{ etiqueta_id?: string | null }>().catch(() => null)
  if (!body || body.etiqueta_id === undefined) return c.json({ error: 'Campo obrigatório: etiqueta_id (ou null para remover)' }, 400)

  if (body.etiqueta_id) {
    const [existe] = await sql`select 1 from etiquetas where id = ${body.etiqueta_id}`
    if (!existe) return c.json({ error: 'Etiqueta não encontrada' }, 404)
  }
  const [pagina] = await sql`
    update paginas set etiqueta_id = ${body.etiqueta_id ?? null}
    where id = ${paginaId}
    returning id, nome, etiqueta_id
  `
  if (!pagina) return c.json({ error: 'Página não encontrada' }, 404)
  return c.json(pagina)
}
