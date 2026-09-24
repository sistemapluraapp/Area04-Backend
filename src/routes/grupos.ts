import type { Context } from 'hono'
import { getDb } from '../lib/db'
import type { AppEnv } from '../types'

// Grupos de acessibilidade (Física, Comunicação, Visual...). Os recursos do
// local (filtros_acessibilidade tipo 'recurso_local') apontam para o grupo
// pela coluna categoria. O "Nível de acessibilidade" exibido na página é a
// proporção de recursos do grupo que o empreendimento marcou.

interface GrupoBody {
  codigo?: string
  rotulo?: string
  descricao?: string | null
  icone?: string | null
  ordem?: number
  ativo?: boolean
}

const COLUNAS = 'codigo, rotulo, descricao, icone, ordem, ativo, created_at, updated_at'

export async function listarGrupos(c: Context<AppEnv>) {
  const sql = getDb(c.env)
  const grupos = await sql`
    select ${sql.unsafe(COLUNAS)},
      (select count(*)::int from filtros_acessibilidade f where f.tipo = 'recurso_local' and f.categoria = g.codigo) as total_recursos
    from grupos_acessibilidade g
    order by ordem, rotulo
  `
  return c.json({ grupos })
}

export async function criarGrupo(c: Context<AppEnv>) {
  const sql = getDb(c.env)
  const body = await c.req.json<GrupoBody>().catch(() => null)

  if (!body?.codigo || !body.rotulo) return c.json({ error: 'Campos obrigatórios: codigo, rotulo' }, 400)
  if (!/^[a-z0-9_]+$/.test(body.codigo)) return c.json({ error: 'codigo deve conter apenas letras minúsculas, números e _' }, 400)

  try {
    const [grupo] = await sql`
      insert into grupos_acessibilidade (codigo, rotulo, descricao, icone, ordem)
      values (${body.codigo}, ${body.rotulo}, ${body.descricao ?? null}, ${body.icone ?? null}, ${body.ordem ?? 0})
      returning ${sql.unsafe(COLUNAS)}
    `
    return c.json(grupo, 201)
  } catch (e) {
    const mensagem = e instanceof Error ? e.message : 'Erro ao criar grupo'
    return c.json({ error: mensagem.includes('duplicate') ? 'Já existe um grupo com esse código' : mensagem }, 400)
  }
}

export async function atualizarGrupo(c: Context<AppEnv>) {
  const sql = getDb(c.env)
  const codigo = c.req.param('codigo') as string
  const body = await c.req.json<GrupoBody>().catch(() => null)
  if (!body) return c.json({ error: 'Corpo da requisição inválido' }, 400)

  const [grupo] = await sql`
    update grupos_acessibilidade set
      rotulo = coalesce(${body.rotulo ?? null}, rotulo),
      descricao = ${body.descricao === undefined ? sql`descricao` : body.descricao},
      icone = ${body.icone === undefined ? sql`icone` : body.icone},
      ordem = coalesce(${body.ordem ?? null}, ordem),
      ativo = coalesce(${body.ativo ?? null}, ativo),
      updated_at = now()
    where codigo = ${codigo}
    returning ${sql.unsafe(COLUNAS)}
  `
  if (!grupo) return c.json({ error: 'Grupo não encontrado' }, 404)
  return c.json(grupo)
}

export async function excluirGrupo(c: Context<AppEnv>) {
  const sql = getDb(c.env)
  const codigo = c.req.param('codigo') as string

  const [{ total }] = await sql`
    select count(*)::int as total from filtros_acessibilidade where tipo = 'recurso_local' and categoria = ${codigo}
  `
  if (total > 0) {
    return c.json({ error: `Este grupo ainda tem ${total} recurso(s). Mova ou exclua os recursos antes de excluir o grupo.` }, 409)
  }

  const resultado = await sql`delete from grupos_acessibilidade where codigo = ${codigo}`
  if (resultado.count === 0) return c.json({ error: 'Grupo não encontrado' }, 404)
  return c.body(null, 204)
}
