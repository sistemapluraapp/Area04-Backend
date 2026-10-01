import { getAdminDb, getDb } from './db'
import { enviarEmail } from './email'
import { escaparHtml, montarAviso } from './emailLayout'
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
            'Nova avaliação sinalizada para moderação na Plura',
            montarAviso(titulo, `<p>${escaparHtml(corpo)}</p>`, { texto: 'Abrir moderação', link: 'https://area04-frontend.pages.dev/moderacao' }),
            env.EMAIL_REMETENTE,
          )
        }
      }

      await sql`update avaliacoes set notificada_em = now() where id = ${avaliacao.id}`
    } catch (err) {
      console.error(`Falha ao processar avaliação sinalizada ${avaliacao.id}:`, err)
    }
  }
}

// Lixeira: exclui de vez as páginas apagadas há mais de 30 dias
export async function purgarPaginasExcluidas(env: Bindings) {
  try {
    const sql = getDb(env)
    const [{ total }] = await sql`select internal.purgar_paginas_excluidas() as total`
    if (total > 0) console.log(`Lixeira: ${total} página(s) excluída(s) definitivamente`)
  } catch (err) {
    console.error('Falha ao purgar páginas da lixeira:', err)
  }
}
