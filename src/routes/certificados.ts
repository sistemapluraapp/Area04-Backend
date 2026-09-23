import type { Context } from 'hono'
import { getDb } from '../lib/db'
import { enviarEmail } from '../lib/email'
import type { AppEnv } from '../types'

export async function listarPendentes(c: Context<AppEnv>) {
  const sql = getDb(c.env)
  const certificados = await sql`
    select c.id, c.pagina_id, p.nome as pagina_nome, c.status, c.solicitado_em
    from certificados c
    join paginas p on p.id = c.pagina_id
    where c.status = 'pendente'
    order by c.solicitado_em asc
  `
  return c.json({ certificados })
}

export async function atualizarStatus(c: Context<AppEnv>) {
  const id = c.req.param('id') as string
  const body = await c.req.json<{ status?: string; motivo?: string }>().catch(() => null)

  if (!body || (body.status !== 'aprovado' && body.status !== 'reprovado')) {
    return c.json({ error: "Campo obrigatório: status ('aprovado' ou 'reprovado')" }, 400)
  }
  const status = body.status
  const motivo = body.motivo ?? null

  const sql = getDb(c.env)
  const [certificado] = await sql`
    update certificados set status = ${status}, avaliado_em = now() where id = ${id}
    returning id, pagina_id, status, solicitado_em, avaliado_em
  `

  if (!certificado) return c.json({ error: 'Certificado não encontrado' }, 404)

  // Notifica o dono da página e envia e-mail — falha aqui nunca deve
  // impedir a resposta de sucesso da aprovação/reprovação em si.
  try {
    const [pagina] = await sql`select nome from paginas where id = ${certificado.pagina_id}`
    const [row] = await sql`select notificar_certificado(${id}, ${status}, ${motivo}) as email`
    const email = row?.email as string | null | undefined

    if (email) {
      const paginaNome = pagina?.nome ?? 'sua página'
      const aprovado = status === 'aprovado'
      const assunto = aprovado
        ? '[Plura] Certificado de acessibilidade aprovado'
        : '[Plura] Certificado de acessibilidade reprovado'
      const html = aprovado
        ? `<p>O certificado de acessibilidade da página <strong>${paginaNome}</strong> foi aprovado.</p>`
        : `<p>O certificado de acessibilidade da página <strong>${paginaNome}</strong> foi reprovado.</p>${
            motivo ? `<p>Motivo: ${motivo}</p>` : ''
          }`

      await enviarEmail(c.env.RESEND_API_KEY, email, assunto, html)
    }
  } catch {
    // não bloqueia a resposta de sucesso
  }

  return c.json(certificado)
}
