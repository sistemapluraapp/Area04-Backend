import type { Context } from 'hono'
import { getAdminDb } from '../lib/db'
import { enviarEmailObrigatorio } from '../lib/email'
import { escaparHtml, montarEmail } from '../lib/emailLayout'
import { getAnonClient } from '../lib/supabase'
import type { AppEnv } from '../types'

// "Esqueci minha senha" do painel: link de uso único, válido por 1 hora,
// enviado pelo nosso backend (o grupo.02 não envia e-mails pelo Supabase).

import { URL_PAINEL } from '../lib/urlPainel'
const RESPOSTA = 'Se este e-mail for de um administrador ativo, enviamos um link para criar uma nova senha. Confira também a caixa de spam.'

async function gerarToken(): Promise<{ token: string; hash: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const token = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  return { token, hash }
}

export async function esqueciSenhaAdmin(c: Context<AppEnv>) {
  const body = await c.req.json<{ email?: string }>().catch(() => null)
  const email = body?.email?.trim().toLowerCase()
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return c.json({ error: 'Informe um e-mail válido' }, 400)

  const { token, hash } = await gerarToken()
  const sql = getAdminDb(c.env)
  try {
    const [admin] = await sql`select * from public.solicitar_redefinicao_admin(${email}, ${hash})`
    if (admin?.email) {
      const link = `${URL_PAINEL}/redefinir-senha?token=${encodeURIComponent(token)}`
      const html = montarEmail({
        titulo: 'Crie uma nova senha para o painel da Plura',
        corpoHtml: `<p>Olá, ${escaparHtml(String(admin.nome || ''))}!</p><p>Recebemos um pedido para criar uma nova senha de acesso ao painel administrativo da Plura. Clique no botão abaixo para escolher a nova senha.</p><p>O link vale por 1 hora e só pode ser usado uma vez. Se você não fez este pedido, ignore este e-mail: sua senha atual continua valendo.</p>`,
        acao: { texto: 'Criar nova senha', link },
        previa: 'Link para criar uma nova senha do painel',
      })
      await enviarEmailObrigatorio(c.env.RESEND_API_KEY, admin.email, 'Nova senha do painel administrativo da Plura', html, c.env.EMAIL_REMETENTE)
    }
  } catch (err) {
    console.error('Recuperação de senha do painel falhou:', err)
    return c.json({ error: 'Não foi possível enviar o link agora. Tente novamente em instantes.' }, 500)
  }
  return c.json({ message: RESPOSTA })
}

export async function redefinirSenhaAdmin(c: Context<AppEnv>) {
  const body = await c.req.json<{ token?: string; senha?: string }>().catch(() => null)
  const token = body?.token?.trim()
  const senha = body?.senha ?? ''
  if (!token) return c.json({ error: 'Link inválido. Peça um novo link na tela de login.' }, 400)
  if (senha.length < 8) return c.json({ error: 'A senha precisa ter pelo menos 8 caracteres' }, 400)
  if (senha.length > 72) return c.json({ error: 'A senha pode ter no máximo 72 caracteres' }, 400)

  const { data, error } = await getAnonClient(c).rpc('redefinir_senha_admin', { p_token: token, p_senha: senha })
  if (error) return c.json({ error: 'Não foi possível alterar a senha agora. Tente novamente.' }, 500)
  if (!data) return c.json({ error: 'Este link expirou ou já foi usado. Peça um novo link na tela de login.' }, 400)
  return c.json({ message: 'Senha alterada. Entre com a nova senha.' })
}
