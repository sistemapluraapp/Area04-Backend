import type { Context } from 'hono'
import { getDb } from '../lib/db'
import { enviarEmailObrigatorio } from '../lib/email'
import { carregarModelo, renderizarModelo } from '../lib/modelos'
import type { AppEnv } from '../types'

// "Send Email Hook" do Supabase Auth (grupo.01): em vez de enviar os e-mails
// de autenticação com o modelo padrão dele, o Supabase chama esta rota e nós
// montamos o e-mail com o modelo editável no ADM e enviamos pelo Resend.
// A chamada é autenticada pela assinatura Standard Webhooks (segredo
// SEND_EMAIL_HOOK_SECRET, gerado no painel do Supabase).

interface PayloadHook {
  user: { id: string; email: string; new_email?: string; user_metadata?: Record<string, unknown> }
  email_data: {
    token: string
    token_hash: string
    redirect_to: string
    email_action_type: string
    site_url: string
    token_new?: string
    token_hash_new?: string
  }
}

const TOLERANCIA_SEGUNDOS = 5 * 60

function base64ParaBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0))
}

function bytesParaBase64(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
}

async function assinaturaValida(segredo: string, id: string, timestamp: string, corpo: string, cabecalho: string): Promise<boolean> {
  const chave = await crypto.subtle.importKey('raw', base64ParaBytes(segredo.replace(/^v1,/, '').replace(/^whsec_/, '')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const esperada = bytesParaBase64(await crypto.subtle.sign('HMAC', chave, new TextEncoder().encode(`${id}.${timestamp}.${corpo}`)))
  // Cabeçalho pode trazer várias assinaturas: "v1,abc v1,def"
  return cabecalho.split(' ').some((parte) => {
    const recebida = parte.split(',')[1] ?? ''
    if (recebida.length !== esperada.length) return false
    let diferenca = 0
    for (let i = 0; i < esperada.length; i++) diferenca |= recebida.charCodeAt(i) ^ esperada.charCodeAt(i)
    return diferenca === 0
  })
}

function erroHook(c: Context<AppEnv>, status: number, mensagem: string) {
  return c.json({ error: { http_code: status, message: mensagem } }, status as 400)
}

function chaveDoModelo(acao: string, metadados: Record<string, unknown>): string | null {
  switch (acao) {
    case 'signup':
      return metadados.tipo === 'gov' ? 'email_confirmacao_gov' : 'email_confirmacao_usuario'
    case 'recovery':
      return 'email_recuperacao_senha'
    case 'magiclink':
    case 'email':
      return 'email_link_acesso'
    case 'invite':
      return 'email_convite'
    case 'email_change':
      return 'email_alteracao_email'
    case 'reauthentication':
      return 'email_codigo_verificacao'
    default:
      return null
  }
}

export async function hookEmailGrupo01(c: Context<AppEnv>) {
  const segredo = c.env.SEND_EMAIL_HOOK_SECRET
  if (!segredo) return erroHook(c, 503, 'Hook de e-mail não configurado (SEND_EMAIL_HOOK_SECRET)')

  const corpo = await c.req.text()
  const id = c.req.header('webhook-id') ?? ''
  const timestamp = c.req.header('webhook-timestamp') ?? ''
  const assinatura = c.req.header('webhook-signature') ?? ''
  if (!id || !timestamp || !assinatura) return erroHook(c, 401, 'Assinatura ausente')
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > TOLERANCIA_SEGUNDOS) return erroHook(c, 401, 'Assinatura expirada')
  if (!(await assinaturaValida(segredo, id, timestamp, corpo, assinatura))) return erroHook(c, 401, 'Assinatura inválida')

  let payload: PayloadHook
  try {
    payload = JSON.parse(corpo) as PayloadHook
  } catch {
    return erroHook(c, 400, 'Corpo inválido')
  }

  const { user, email_data: dados } = payload
  const metadados = user.user_metadata ?? {}
  const chave = chaveDoModelo(dados.email_action_type, metadados)
  if (!chave) return erroHook(c, 400, `Tipo de e-mail não suportado: ${dados.email_action_type}`)

  const sql = getDb(c.env)
  try {
    const modelo = await carregarModelo(sql, chave)
    if (!modelo) return erroHook(c, 500, `Modelo de e-mail não encontrado: ${chave}`)

    const urlVerificacao = (hash: string) =>
      `${c.env.GRUPO01_SUPABASE_URL}/auth/v1/verify?token=${encodeURIComponent(hash)}&type=${encodeURIComponent(dados.email_action_type)}&redirect_to=${encodeURIComponent(dados.redirect_to || dados.site_url)}`

    const nome = String(metadados.nome ?? '').trim() || 'olá'
    const remetente = c.env.EMAIL_REMETENTE

    // Cada destinatário recebe o link que vale para ele. Na troca de e-mail
    // com confirmação dupla, o Supabase manda token_hash_new para o e-mail
    // atual e token_hash para o novo.
    const envios: { para: string; hash: string | null; codigo: string | null }[] = []
    if (dados.email_action_type === 'reauthentication') {
      envios.push({ para: user.email, hash: null, codigo: dados.token })
    } else if (dados.email_action_type === 'email_change' && dados.token_hash_new) {
      envios.push({ para: user.email, hash: dados.token_hash_new, codigo: null })
      if (user.new_email) envios.push({ para: user.new_email, hash: dados.token_hash, codigo: null })
    } else if (dados.email_action_type === 'email_change') {
      envios.push({ para: user.new_email ?? user.email, hash: dados.token_hash, codigo: null })
    } else {
      envios.push({ para: user.email, hash: dados.token_hash, codigo: null })
    }

    for (const envio of envios) {
      const { assunto, html } = renderizarModelo(modelo, { nome, email: envio.para }, { link: envio.hash ? urlVerificacao(envio.hash) : null, codigo: envio.codigo })
      await enviarEmailObrigatorio(c.env.RESEND_API_KEY, envio.para, assunto, html, remetente)
    }
    return c.json({})
  } catch (err) {
    console.error('Hook de e-mail falhou:', err)
    return erroHook(c, 500, 'Não foi possível enviar o e-mail agora. Tente novamente em instantes.')
  }
}
