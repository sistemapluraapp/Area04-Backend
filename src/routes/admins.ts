import type { Context } from 'hono'
import { enviarEmailObrigatorio } from '../lib/email'
import { escaparHtml, montarEmail } from '../lib/emailLayout'
import { CODIGOS_PERMISSAO, PERMISSOES } from '../lib/permissoes'
import { getAnonClient, getUserClient } from '../lib/supabase'
import { registrarLog } from '../middleware/auth'
import type { AppEnv } from '../types'

// Administradores do painel: matriz de permissões, convites por e-mail (o
// convidado define a própria senha) e log das ações.

const DIAS_CONVITE = 7
import { URL_PAINEL } from '../lib/urlPainel'

function validarPermissoes(valor: unknown): string[] | null {
  if (!Array.isArray(valor) || valor.some((p) => typeof p !== 'string' || !CODIGOS_PERMISSAO.includes(p))) return null
  return [...new Set(valor as string[])]
}

async function gerarToken(): Promise<{ token: string; hash: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const token = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  return { token, hash }
}

async function enviarConvite(c: Context<AppEnv>, para: string, nome: string, token: string) {
  const link = `${URL_PAINEL}/aceitar-convite?token=${encodeURIComponent(token)}`
  const quemConvida = c.get('admin').nome || c.get('admin').email
  const html = montarEmail({
    titulo: `Você foi convidado para o painel da Plura`,
    corpoHtml: `<p>Olá, ${escaparHtml(nome)}!</p><p>${escaparHtml(quemConvida)} convidou você para administrar a Plura. Clique no botão abaixo para criar sua senha e acessar o painel.</p><p>O convite vale por ${DIAS_CONVITE} dias e só pode ser usado uma vez.</p>`,
    acao: { texto: 'Criar minha senha', link },
    previa: 'Convite para administrar a Plura',
  })
  await enviarEmailObrigatorio(c.env.RESEND_API_KEY, para, 'Convite para o painel administrativo da Plura', html, c.env.EMAIL_REMETENTE)
}

export function meuAcesso(c: Context<AppEnv>) {
  return c.json({ admin: c.get('admin'), permissoes_disponiveis: PERMISSOES })
}

export async function listarAdmins(c: Context<AppEnv>) {
  const supabase = c.get('supabase')
  const [admins, convites] = await Promise.all([
    supabase.from('admins').select('id, nome, email, ativo, permissoes, created_at').order('nome'),
    supabase
      .from('admin_convites')
      .select('id, nome, email, permissoes, expira_em, criado_em')
      .is('usado_em', null)
      .is('cancelado_em', null)
      .order('criado_em', { ascending: false }),
  ])
  const erro = admins.error ?? convites.error
  if (erro) return c.json({ error: erro.message }, 500)
  return c.json({ admins: admins.data, convites: convites.data, permissoes_disponiveis: PERMISSOES })
}

export async function atualizarAdmin(c: Context<AppEnv>) {
  const id = c.req.param('id') as string
  const body = await c.req.json<{ permissoes?: unknown; ativo?: unknown }>().catch(() => null)
  if (!body) return c.json({ error: 'Corpo da requisição inválido' }, 400)

  const patch: Record<string, unknown> = {}
  if (body.permissoes !== undefined) {
    const permissoes = validarPermissoes(body.permissoes)
    if (!permissoes) return c.json({ error: 'Permissões inválidas' }, 400)
    // Não deixa ninguém tirar de si o acesso à gestão (evita painel sem gestor)
    if (id === c.get('admin').id && !permissoes.includes('administradores')) {
      return c.json({ error: 'Você não pode remover de si mesmo a permissão de gerenciar administradores.' }, 400)
    }
    patch.permissoes = permissoes
  }
  if (body.ativo !== undefined) {
    if (typeof body.ativo !== 'boolean') return c.json({ error: 'ativo deve ser verdadeiro ou falso' }, 400)
    if (id === c.get('admin').id && !body.ativo) return c.json({ error: 'Você não pode desativar o próprio acesso.' }, 400)
    patch.ativo = body.ativo
  }
  if (Object.keys(patch).length === 0) return c.json({ error: 'Nada para alterar' }, 400)

  const { data, error } = await c.get('supabase').from('admins').update(patch).eq('id', id).select('id, nome, email, ativo, permissoes, created_at').maybeSingle()
  if (error) return c.json({ error: error.message }, 500)
  if (!data) return c.json({ error: 'Administrador não encontrado' }, 404)
  return c.json(data)
}

export async function convidarAdmin(c: Context<AppEnv>) {
  const body = await c.req.json<{ nome?: string; email?: string; permissoes?: unknown }>().catch(() => null)
  const nome = body?.nome?.trim()
  const email = body?.email?.trim().toLowerCase()
  if (!nome || nome.length > 120) return c.json({ error: 'Informe o nome (até 120 caracteres)' }, 400)
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return c.json({ error: 'Informe um e-mail válido' }, 400)
  const permissoes = validarPermissoes(body?.permissoes ?? [])
  if (!permissoes || permissoes.length === 0) return c.json({ error: 'Escolha pelo menos uma permissão' }, 400)

  const supabase = c.get('supabase')
  const { data: existente } = await supabase.from('admins').select('id, ativo').eq('email', email).maybeSingle()
  if (existente?.ativo) return c.json({ error: 'Este e-mail já é de um administrador ativo' }, 409)

  // Um convite pendente por e-mail: o anterior é cancelado
  await supabase.from('admin_convites').update({ cancelado_em: new Date().toISOString() }).eq('email', email).is('usado_em', null).is('cancelado_em', null)

  const { token, hash } = await gerarToken()
  const expira = new Date(Date.now() + DIAS_CONVITE * 24 * 60 * 60 * 1000).toISOString()
  const { data: convite, error } = await supabase
    .from('admin_convites')
    .insert({ nome, email, permissoes, token_hash: hash, expira_em: expira, criado_por: c.get('admin').id })
    .select('id, nome, email, permissoes, expira_em, criado_em')
    .single()
  if (error) return c.json({ error: error.message }, 500)

  try {
    await enviarConvite(c, email, nome, token)
  } catch (err) {
    return c.json({ ...convite, aviso: `Convite criado, mas o e-mail não foi enviado: ${err instanceof Error ? err.message : 'erro desconhecido'}`, link_convite: `${URL_PAINEL}/aceitar-convite?token=${encodeURIComponent(token)}` }, 201)
  }
  return c.json(convite, 201)
}

export async function reenviarConvite(c: Context<AppEnv>) {
  const id = c.req.param('id') as string
  const supabase = c.get('supabase')
  const { token, hash } = await gerarToken()
  const expira = new Date(Date.now() + DIAS_CONVITE * 24 * 60 * 60 * 1000).toISOString()
  const { data: convite, error } = await supabase
    .from('admin_convites')
    .update({ token_hash: hash, expira_em: expira })
    .eq('id', id)
    .is('usado_em', null)
    .is('cancelado_em', null)
    .select('id, nome, email, permissoes, expira_em, criado_em')
    .maybeSingle()
  if (error) return c.json({ error: error.message }, 500)
  if (!convite) return c.json({ error: 'Convite não encontrado ou já usado' }, 404)
  try {
    await enviarConvite(c, convite.email, convite.nome, token)
  } catch (err) {
    return c.json({ ...convite, aviso: `O e-mail não foi enviado: ${err instanceof Error ? err.message : 'erro desconhecido'}`, link_convite: `${URL_PAINEL}/aceitar-convite?token=${encodeURIComponent(token)}` })
  }
  return c.json(convite)
}

export async function cancelarConvite(c: Context<AppEnv>) {
  const id = c.req.param('id') as string
  const { data, error } = await c.get('supabase').from('admin_convites').update({ cancelado_em: new Date().toISOString() }).eq('id', id).is('usado_em', null).select('id').maybeSingle()
  if (error) return c.json({ error: error.message }, 500)
  if (!data) return c.json({ error: 'Convite não encontrado ou já usado' }, 404)
  return c.json({ ok: true })
}

// --- Logs ---

function filtrosLog(c: Context<AppEnv>) {
  const de = c.req.query('de')
  const ate = c.req.query('ate')
  const admin = c.req.query('admin')
  let q = c.get('supabase').from('admin_logs').select('id, admin_id, admin_nome, admin_email, acao, funcionalidade, criado_em')
  if (de && /^\d{4}-\d{2}-\d{2}$/.test(de)) q = q.gte('criado_em', `${de}T00:00:00-03:00`)
  if (ate && /^\d{4}-\d{2}-\d{2}$/.test(ate)) q = q.lte('criado_em', `${ate}T23:59:59.999-03:00`)
  if (admin && /^[0-9a-f-]{36}$/i.test(admin)) q = q.eq('admin_id', admin)
  return q.order('criado_em', { ascending: false }).order('id', { ascending: false })
}

export async function listarLogs(c: Context<AppEnv>) {
  const limite = Math.min(Math.max(Number(c.req.query('limite')) || 100, 1), 500)
  const antes = Number(c.req.query('antes_id'))
  let q = filtrosLog(c)
  if (antes > 0) q = q.lt('id', antes)
  const { data, error } = await q.limit(limite)
  if (error) return c.json({ error: error.message }, 500)
  return c.json({ logs: data, tem_mais: (data?.length ?? 0) === limite })
}

function celulaCsv(v: unknown) {
  const s = String(v ?? '')
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export async function exportarLogsCsv(c: Context<AppEnv>) {
  const { data, error } = await filtrosLog(c).limit(10000)
  if (error) return c.json({ error: error.message }, 500)
  const linhas = [
    ['Quem', 'E-mail', 'Quando', 'O que foi feito', 'Funcionalidade'],
    ...(data ?? []).map((l) => [
      l.admin_nome,
      l.admin_email,
      new Date(l.criado_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
      l.acao,
      PERMISSOES.find((p) => p.codigo === l.funcionalidade)?.rotulo ?? l.funcionalidade ?? '',
    ]),
  ]
  // BOM + ";" para abrir direto no Excel em português
  const csv = '﻿' + linhas.map((l) => l.map(celulaCsv).join(';')).join('\r\n')
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="logs-plura-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  })
}

// --- Aceitar convite (público) ---

export async function verConviteAdmin(c: Context<AppEnv>) {
  const token = c.req.param('token') as string
  const { data, error } = await getAnonClient(c).rpc('ver_convite_admin', { p_token: token })
  if (error) return c.json({ error: error.message }, 500)
  const convite = Array.isArray(data) ? data[0] : null
  if (!convite) return c.json({ error: 'Convite inválido, expirado ou já usado' }, 404)
  return c.json(convite)
}

export async function aceitarConviteAdmin(c: Context<AppEnv>) {
  const token = c.req.param('token') as string
  const body = await c.req.json<{ senha?: string }>().catch(() => null)
  const senha = body?.senha ?? ''
  if (senha.length < 8) return c.json({ error: 'A senha precisa ter pelo menos 8 caracteres' }, 400)

  const anon = getAnonClient(c)
  const { data: dados } = await anon.rpc('ver_convite_admin', { p_token: token })
  const convite = Array.isArray(dados) ? (dados[0] as { email: string; nome: string } | undefined) : undefined
  if (!convite) return c.json({ error: 'Convite inválido, expirado ou já usado' }, 404)

  // Cria a conta no Auth; se o e-mail já tiver conta, segue com a senha dela
  const { error: erroCadastro } = await anon.auth.signUp({ email: convite.email, password: senha, options: { data: { nome: convite.nome } } })
  if (erroCadastro && !/registered|exists/i.test(erroCadastro.message)) return c.json({ error: erroCadastro.message }, 400)

  const { data: aceito, error: erroAceite } = await anon.rpc('concluir_convite_admin', { p_token: token, p_senha: senha })
  if (erroAceite) return c.json({ error: erroAceite.message }, 500)
  if (!aceito) return c.json({ error: 'Não foi possível concluir o convite. Peça um novo convite.' }, 400)

  const { data: sessao, error: erroLogin } = await anon.auth.signInWithPassword({ email: convite.email, password: senha })
  if (erroLogin || !sessao.session) {
    return c.json({ error: 'Acesso liberado, mas este e-mail já tinha uma senha cadastrada. Entre com ela na tela de login.' }, 409)
  }

  const supabase = getUserClient(c, sessao.session.access_token)
  c.set('supabase', supabase)
  c.set('admin', { id: sessao.user.id, nome: convite.nome, email: convite.email, permissoes: [] })
  await registrarLog(c, 'Aceitou o convite e entrou no painel pela primeira vez', null)

  return c.json({
    user: { id: sessao.user.id, email: sessao.user.email },
    access_token: sessao.session.access_token,
    refresh_token: sessao.session.refresh_token,
  })
}
