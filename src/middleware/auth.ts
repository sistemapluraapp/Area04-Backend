import type { Context, Next } from 'hono'
import { getUserClient } from '../lib/supabase'
import { descreverAcao, permissaoDaRota } from '../lib/permissoes'
import type { AdminLogado, AppEnv } from '../types'

// Token válido do grupo.02 não basta: a pessoa precisa ter cadastro ativo
// em `admins` (só criado por convite aceito) e a permissão da funcionalidade.
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

  const { data: admin } = await supabase.from('admins').select('id, nome, email, ativo, permissoes').eq('id', data.user.id).maybeSingle()
  if (!admin || !admin.ativo) {
    return c.json({ error: 'Seu acesso de administrador não está ativo. Fale com quem gerencia o painel.', sem_acesso: true }, 403)
  }

  c.set('supabase', supabase)
  c.set('userId', data.user.id)
  c.set('userEmail', admin.email ?? data.user.email ?? '')
  c.set('admin', { id: admin.id, nome: admin.nome ?? '', email: admin.email ?? data.user.email ?? '', permissoes: admin.permissoes ?? [] } satisfies AdminLogado)

  const exigida = permissaoDaRota(c.req.path)
  if (exigida && !(admin.permissoes ?? []).includes(exigida)) {
    return c.json({ error: 'Você não tem permissão para esta funcionalidade.', sem_permissao: exigida }, 403)
  }

  await next()

  // Log de toda ação que altera dados e deu certo
  if (c.req.method !== 'GET' && c.res.status < 400) {
    const corpo = await c.req.json<Record<string, unknown>>().catch(() => null)
    const resposta = await c.res.clone().json<Record<string, unknown>>().catch(() => null)
    await registrarLog(c, descreverAcao(c.req.method, c.req.path, corpo, resposta), exigida)
  }
}

export async function registrarLog(c: Context<AppEnv>, acao: string, funcionalidade: string | null) {
  const admin = c.get('admin')
  if (!admin) return
  const { error } = await c.get('supabase').from('admin_logs').insert({
    admin_id: admin.id,
    admin_nome: admin.nome,
    admin_email: admin.email,
    acao: acao.slice(0, 2000),
    funcionalidade,
  })
  if (error) console.error('Falha ao registrar log do admin:', error.message)
}
