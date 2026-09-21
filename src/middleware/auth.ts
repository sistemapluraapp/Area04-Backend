import type { Context, Next } from 'hono'
import { getUserClient } from '../lib/supabase'
import type { AppEnv } from '../types'

export async function requireAuth(c: Context<AppEnv>, next: Next) {
  const header = c.req.header('Authorization')
  if (!header?.startsWith('Bearer ')) {
    return c.json({ error: 'Token de autenticação ausente' }, 401)
  }

  const token = header.slice('Bearer '.length)
  const supabase = getUserClient(c, token)
  const { data, error } = await supabase.auth.getUser(token)

  if (error || !data.user) {
    return c.json({ error: 'Token inválido ou expirado' }, 401)
  }

  c.set('supabase', supabase)
  c.set('userId', data.user.id)
  await next()
}
