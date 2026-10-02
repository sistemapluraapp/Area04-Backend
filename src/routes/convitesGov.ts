import type { Context } from 'hono'
import { getDb } from '../lib/db'
import { enviarEmailObrigatorio } from '../lib/email'
import { escaparHtml, montarAviso } from '../lib/emailLayout'
import type { AppEnv } from '../types'

// Convites para contas Gov: link de uso único para um local (país, estado,
// cidade), com descrição, data limite e envio opcional por e-mail.

const COLUNAS = 'token, pais, uf, cidade, descricao, email, criado_em, criado_por, expira_em, usado, usado_em, cancelado_em'

interface CorpoConvite {
  pais?: string
  uf?: string
  cidade?: string
  descricao?: string
  expira_em?: string
  email?: string
  // compatibilidade com a tela antiga
  dias_validade?: number
}

function gerarToken(): string {
  return crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '').slice(0, 8)
}

function linkConvite(c: Context<AppEnv>, token: string) {
  return `${c.env.AREA03_FRONTEND_URL ?? 'https://gov.plura.app.br'}/convite?token=${token}`
}

function localTexto(convite: { cidade: string; uf: string | null; pais: string }) {
  const pais = convite.pais === 'BR' ? '' : (() => {
    try {
      return new Intl.DisplayNames(['pt-BR'], { type: 'region' }).of(convite.pais) ?? convite.pais
    } catch {
      return convite.pais
    }
  })()
  return [convite.cidade, convite.uf, pais].filter(Boolean).join(' · ')
}

async function enviarConvite(c: Context<AppEnv>, convite: { token: string; cidade: string; uf: string | null; pais: string; descricao: string | null; expira_em: Date | string }, email: string) {
  const local = escaparHtml(localTexto(convite))
  const validade = new Date(convite.expira_em).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
  const corpo = `<p>Você recebeu um convite para criar a conta institucional de <strong>${local}</strong> na Plura.</p>${
    convite.descricao ? `<p>${escaparHtml(convite.descricao)}</p>` : ''
  }<p>O link vale até ${validade} e só pode ser usado uma vez.</p>`
  await enviarEmailObrigatorio(
    c.env.RESEND_API_KEY,
    email,
    'Convite para a conta institucional na Plura',
    montarAviso('Convite para a Plura Gov', corpo, { texto: 'Criar conta institucional', link: linkConvite(c, convite.token) }),
    c.env.EMAIL_REMETENTE,
  )
}

// Data limite (AAAA-MM-DD) vale até o fim do dia no horário de Brasília
function fimDoDia(data: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return null
  const d = new Date(`${data}T23:59:59-03:00`)
  return Number.isNaN(d.getTime()) ? null : d
}

export async function criarConvite(c: Context<AppEnv>) {
  const body = await c.req.json<CorpoConvite>().catch(() => null)
  if (!body) return c.json({ error: 'Corpo da requisição inválido' }, 400)

  const pais = (body.pais ?? 'BR').trim().toUpperCase()
  const uf = body.uf?.trim() || null
  const cidade = body.cidade?.trim() ?? ''
  const descricao = body.descricao?.trim() || null
  const email = body.email?.trim().toLowerCase() || null

  if (!/^[A-Z]{2}$/.test(pais)) return c.json({ error: 'País inválido' }, 400)
  if (!cidade) return c.json({ error: 'Informe a cidade' }, 400)
  if (cidade.length > 100) return c.json({ error: 'Cidade deve ter no máximo 100 caracteres' }, 400)
  if (pais === 'BR' && (!uf || !/^[A-Za-z]{2}$/.test(uf))) return c.json({ error: 'Informe o estado (UF)' }, 400)
  if (uf && uf.length > 60) return c.json({ error: 'Estado deve ter no máximo 60 caracteres' }, 400)
  if (descricao && descricao.length > 500) return c.json({ error: 'Descrição deve ter no máximo 500 caracteres' }, 400)
  if (email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320)) return c.json({ error: 'E-mail inválido' }, 400)

  let expira: Date | null
  if (body.expira_em) {
    expira = fimDoDia(body.expira_em)
    if (!expira) return c.json({ error: 'Data de validade inválida' }, 400)
    if (expira.getTime() <= Date.now()) return c.json({ error: 'A validade precisa ser uma data futura' }, 400)
    if (expira.getTime() > Date.now() + 366 * 24 * 3600 * 1000) return c.json({ error: 'A validade pode ser de no máximo um ano' }, 400)
  } else {
    const dias = body.dias_validade && body.dias_validade > 0 ? Math.min(Math.floor(body.dias_validade), 366) : 7
    expira = new Date(Date.now() + dias * 24 * 3600 * 1000)
  }

  const sql = getDb(c.env)
  const [convite] = await sql`
    insert into chaves_acesso_gov (token, pais, uf, cidade, descricao, email, expira_em, criado_por)
    values (${gerarToken()}, ${pais}, ${pais === 'BR' && uf ? uf.toUpperCase() : uf}, ${cidade}, ${descricao}, ${email}, ${expira}, ${c.get('userEmail') || null})
    returning ${sql.unsafe(COLUNAS)}
  `

  const resposta: Record<string, unknown> = { ...convite, link: linkConvite(c, convite.token) }
  if (email) {
    try {
      await enviarConvite(c, convite as never, email)
      resposta.email_enviado = true
    } catch (err) {
      console.error('Falha ao enviar convite Gov:', err)
      resposta.aviso = 'O convite foi criado, mas o e-mail não pôde ser enviado agora. Copie o link e envie por outro meio.'
    }
  }
  return c.json(resposta, 201)
}

export async function listarConvites(c: Context<AppEnv>) {
  const sql = getDb(c.env)
  const convites = await sql`
    select ${sql.unsafe(COLUNAS)}
    from chaves_acesso_gov
    order by criado_em desc
    limit 300
  `
  return c.json({ convites: convites.map((v) => ({ ...v, link: linkConvite(c, v.token) })) })
}

export async function reenviarConvite(c: Context<AppEnv>) {
  const token = c.req.param('token') as string
  const sql = getDb(c.env)
  const [convite] = await sql`
    select ${sql.unsafe(COLUNAS)} from chaves_acesso_gov
    where token = ${token} and not usado and cancelado_em is null and expira_em > now()
  `
  if (!convite) return c.json({ error: 'Convite não encontrado, já usado, cancelado ou expirado' }, 404)
  if (!convite.email) return c.json({ error: 'Este convite não tem e-mail. Copie o link.' }, 400)
  try {
    await enviarConvite(c, convite as never, convite.email)
  } catch (err) {
    console.error('Falha ao reenviar convite Gov:', err)
    return c.json({ error: 'Não foi possível enviar o e-mail agora. Copie o link e envie por outro meio.' }, 502)
  }
  return c.json({ ok: true })
}

export async function cancelarConvite(c: Context<AppEnv>) {
  const token = c.req.param('token') as string
  const sql = getDb(c.env)
  const [convite] = await sql`
    update chaves_acesso_gov set cancelado_em = now()
    where token = ${token} and not usado and cancelado_em is null
    returning token
  `
  if (!convite) return c.json({ error: 'Convite não encontrado ou já usado' }, 404)
  return c.json({ ok: true })
}
