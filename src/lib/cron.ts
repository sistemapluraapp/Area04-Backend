import { getAdminDb, getDb } from './db'
import { enviarEmail } from './email'
import type { Bindings } from '../types'

export async function processarAvaliacoesSinalizadas(env: Bindings) {
  const sql = getDb(env)
  const sqlAdmin = getAdminDb(env)

  const avaliacoes = await sql`
    select id, pagina_id from avaliacoes
    where sinalizada = true and notificada_em is null
    limit 50
  `

  for (const avaliacao of avaliacoes) {
    try {
      const [pagina] = await sql`select nome from paginas where id = ${avaliacao.pagina_id}`
      const paginaNome = pagina?.nome ?? 'uma página'

      const titulo = 'Nova avaliação sinalizada para moderação'
      const corpo = `A avaliação da página "${paginaNome}" foi sinalizada e precisa de moderação.`

      const admins = await sqlAdmin`
        select * from broadcast_notificacao_admin(
          ${'avaliacao_sinalizada'},
          ${titulo},
          ${corpo},
          ${'avaliacao'},
          ${avaliacao.id},
          ${JSON.stringify({ pagina_nome: paginaNome })}::jsonb
        )
      `

      for (const admin of admins) {
        const email = admin.admin_email as string | null
        if (email) {
          await enviarEmail(
            env.RESEND_API_KEY,
            email,
            '[Plura] Nova avaliação sinalizada para moderação',
            `<p>${corpo}</p>`,
          )
        }
      }

      await sql`update avaliacoes set notificada_em = now() where id = ${avaliacao.id}`
    } catch (err) {
      console.error(`Falha ao processar avaliação sinalizada ${avaliacao.id}:`, err)
    }
  }
}
