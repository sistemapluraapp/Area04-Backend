import type { Context } from 'hono'
import type { AppEnv } from '../types'

export async function listarNotificacoes(c: Context<AppEnv>) {
  const supabase = c.get('supabase')
  const userId = c.get('userId')

  const statusParam = c.req.query('status')
  const limitParam = Number(c.req.query('limit'))
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(Math.floor(limitParam), 100) : 30

  let query = supabase
    .from('notificacoes_admin')
    .select('*')
    .eq('admin_id', userId)
    .order('criada_em', { ascending: false })
    .limit(limit)

  if (statusParam === 'nao_lidas') {
    query = query.eq('lida', false)
  }

  const { data, error } = await query

  if (error) {
    return c.json({ error: error.message }, 500)
  }

  return c.json({ notificacoes: data })
}

export async function contarNaoLidas(c: Context<AppEnv>) {
  const supabase = c.get('supabase')
  const userId = c.get('userId')

  const { count, error } = await supabase
    .from('notificacoes_admin')
    .select('*', { count: 'exact', head: true })
    .eq('admin_id', userId)
    .eq('lida', false)

  if (error) {
    return c.json({ error: error.message }, 500)
  }

  return c.json({ total: count ?? 0 })
}

export async function marcarLida(c: Context<AppEnv>) {
  const supabase = c.get('supabase')
  const userId = c.get('userId')
  const id = c.req.param('id') as string

  const { data, error } = await supabase
    .from('notificacoes_admin')
    .update({ lida: true, lida_em: new Date().toISOString() })
    .eq('id', id)
    .eq('admin_id', userId)
    .select('id')
    .maybeSingle()

  if (error) {
    return c.json({ error: error.message }, 500)
  }
  if (!data) {
    return c.json({ error: 'Notificação não encontrada' }, 404)
  }

  return c.json({ ok: true })
}

export async function marcarTodasLidas(c: Context<AppEnv>) {
  const supabase = c.get('supabase')
  const userId = c.get('userId')

  const { error } = await supabase
    .from('notificacoes_admin')
    .update({ lida: true, lida_em: new Date().toISOString() })
    .eq('admin_id', userId)
    .eq('lida', false)

  if (error) {
    return c.json({ error: error.message }, 500)
  }

  return c.json({ ok: true })
}
