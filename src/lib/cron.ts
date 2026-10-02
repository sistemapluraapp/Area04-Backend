import { getAdminDb, getDb } from './db'
import { enviarEmail, enviarEmailObrigatorio } from './email'
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

// Avisos de locais favoritos (Etapa 6b): o banco cria o aviso no sininho na
// hora e deixa o e-mail na fila; aqui ele sai pelo Resend.
export async function enviarAvisosFavoritos(env: Bindings) {
  const sql = getDb(env)
  const pendentes = await sql`select * from internal.avisos_email_pendentes(100)`
  if (pendentes.length === 0) return

  const site = env.AREA01_FRONTEND_URL ?? 'https://plura.app.br'
  const enviados: string[] = []
  for (const aviso of pendentes) {
    if (!aviso.email) {
      enviados.push(aviso.id)
      continue
    }
    try {
      const nome = aviso.nome ? `, ${escaparHtml(String(aviso.nome).split(' ')[0])}` : ''
      const corpo = `<p>Olá${nome}!</p><p>${escaparHtml(aviso.corpo ?? '')}</p><p style="font-size:13px;color:#667085">Você recebe este aviso porque favoritou este local na Plura. Para mudar, acesse seu perfil.</p>`
      const link = aviso.pagina_id ? `${site}/pagina?id=${aviso.pagina_id}` : site
      await enviarEmailObrigatorio(env.RESEND_API_KEY, aviso.email, aviso.titulo, montarAviso(aviso.titulo, corpo, { texto: 'Ver a página', link }), env.EMAIL_REMETENTE)
      enviados.push(aviso.id)
    } catch (err) {
      // Fica na fila e tenta de novo na próxima rodada (até 2 dias)
      console.error('Falha ao enviar aviso de favorito:', err)
    }
  }
  if (enviados.length) await sql`select internal.marcar_avisos_email_enviados(${enviados}::uuid[])`
}
