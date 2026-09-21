import type { Context } from 'hono'
import { getAnonClient } from '../lib/supabase'
import type { AppEnv } from '../types'

interface SignupBody {
  codigo?: string
  nome?: string
  email?: string
  password?: string
}

export async function signup(c: Context<AppEnv>) {
  const body = await c.req.json<SignupBody>().catch(() => null)
  if (!body?.codigo || !body.nome || !body.email || !body.password) {
    return c.json({ error: 'Campos obrigatórios: codigo, nome, email, password' }, 400)
  }

  if (body.codigo !== c.env.ADMIN_SIGNUP_CODE) {
    return c.json({ error: 'Código de convite inválido' }, 403)
  }

  const anon = getAnonClient(c)
  const { data: signUpData, error: signUpError } = await anon.auth.signUp({
    email: body.email,
    password: body.password,
  })

  if (signUpError || !signUpData.user) {
    return c.json({ error: signUpError?.message ?? 'Não foi possível criar a conta' }, 400)
  }

  if (!signUpData.session) {
    return c.json(
      { message: 'Conta criada. Confirme seu e-mail para poder fazer login.', pending_email_confirmation: true },
      201,
    )
  }

  const asUser = getAnonClient(c)
  await asUser.auth.setSession({
    access_token: signUpData.session.access_token,
    refresh_token: signUpData.session.refresh_token,
  })

  const { error: adminError } = await asUser.from('admins').insert({ id: signUpData.user.id, nome: body.nome })

  if (adminError) {
    return c.json({ error: `Conta criada, mas falhou ao salvar o perfil: ${adminError.message}` }, 500)
  }

  return c.json(
    {
      user: { id: signUpData.user.id, email: body.email, nome: body.nome },
      access_token: signUpData.session.access_token,
      refresh_token: signUpData.session.refresh_token,
    },
    201,
  )
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

  return c.json({
    user: { id: data.user.id, email: data.user.email },
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  })
}
