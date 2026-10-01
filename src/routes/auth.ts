import type { Context } from 'hono'
import { getAnonClient, getUserClient } from '../lib/supabase'
import { registrarLog } from '../middleware/auth'
import type { AppEnv } from '../types'

// Cadastro aberto foi desativado: novos administradores entram só por convite
// (tela Administradores → Convidar), que define as permissões de cada um.
export function signup(c: Context<AppEnv>) {
  return c.json({ error: 'O cadastro de administradores agora é feito por convite. Peça um convite a quem gerencia o painel.' }, 410)
}

export async function login(c: Context<AppEnv>) {
  const body = await c.req.json<{ email?: string; password?: string }>().catch(() => null)
  if (!body?.email || !body.password) {
    return c.json({ error: 'Campos obrigatórios: email, password' }, 400)
  }

  const anon = getAnonClient(c)
  const { data, error } = await anon.auth.signInWithPassword({
    email: body.email,
    password: body.password,
  })

  if (error || !data.session) {
    return c.json({ error: 'E-mail ou senha inválidos' }, 401)
  }

  const supabase = getUserClient(c, data.session.access_token)
  const { data: admin } = await supabase.from('admins').select('id, nome, email, ativo').eq('id', data.user.id).maybeSingle()
  if (!admin || !admin.ativo) {
    return c.json({ error: 'Esta conta não tem acesso ativo ao painel. Peça um convite a quem gerencia os administradores.', sem_acesso: true }, 403)
  }
  c.set('supabase', supabase)
  c.set('admin', { id: admin.id, nome: admin.nome ?? '', email: admin.email ?? data.user.email ?? '', permissoes: [] })
  await registrarLog(c, 'Entrou no painel', null)

  return c.json({
    user: { id: data.user.id, email: data.user.email },
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  })
}

export async function refresh(c: Context<AppEnv>) {
  const body = await c.req.json<{ refresh_token?: string }>().catch(() => null)
  if (!body?.refresh_token) {
    return c.json({ error: 'Campo obrigatório: refresh_token' }, 400)
  }

  const anon = getAnonClient(c)
  const { data, error } = await anon.auth.refreshSession({ refresh_token: body.refresh_token })

  if (error || !data.session) {
    return c.json({ error: 'Sessão inválida ou expirada, faça login novamente' }, 401)
  }

  return c.json({
    user: { id: data.user!.id, email: data.user!.email },
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  })
}
