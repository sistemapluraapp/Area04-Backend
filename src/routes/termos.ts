import type { Context } from 'hono'
import { getDb } from '../lib/db'
import type { AppEnv } from '../types'

// Termos e condições exibidos nos cadastros, na criação de páginas e na
// inscrição em certificações. Sem versionamento: vale sempre o texto atual.

const COLUNAS = 'chave, nome, descricao, titulo, conteudo_html, atualizado_em, atualizado_por'

export async function listarTermos(c: Context<AppEnv>) {
  const sql = getDb(c.env)
  const termos = await sql`select ${sql.unsafe(COLUNAS)} from termos order by nome`
  return c.json({ termos })
}

export async function atualizarTermo(c: Context<AppEnv>) {
  const sql = getDb(c.env)
  const chave = c.req.param('chave') as string
  const body = await c.req.json<{ titulo?: unknown; conteudo_html?: unknown }>().catch(() => null)
  if (!body) return c.json({ error: 'Corpo da requisição inválido' }, 400)
  if (typeof body.titulo !== 'string' || !body.titulo.trim()) return c.json({ error: 'O termo precisa de um título' }, 400)
  if (body.titulo.trim().length > 200) return c.json({ error: 'Título deve ter no máximo 200 caracteres' }, 400)
  if (typeof body.conteudo_html !== 'string' || !body.conteudo_html.trim()) return c.json({ error: 'O termo precisa de um texto' }, 400)
  if (body.conteudo_html.length > 100000) return c.json({ error: "Texto muito longo (limite de 100 mil caracteres com a formatação)" }, 400)

  const [termo] = await sql`
    update termos set
      titulo = ${body.titulo.trim()},
      conteudo_html = ${body.conteudo_html.trim()},
      atualizado_em = now(),
      atualizado_por = ${c.get('userEmail') || null}
    where chave = ${chave}
    returning ${sql.unsafe(COLUNAS)}
  `
  if (!termo) return c.json({ error: 'Termo não encontrado' }, 404)
  return c.json(termo)
}
