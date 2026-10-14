import { URL_PAINEL } from './urlPainel'
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
            montarAviso(titulo, `<p>${escaparHtml(corpo)}</p>`, { texto: 'Abrir moderação', link: `${URL_PAINEL}/moderacao` }),
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

// Certificações (8f): avisos de vencimento em 60, 30 e 7 dias e no dia que vence.
// O banco cria o aviso no sino (com e-mail na fila) e marca a faixa como enviada.
export async function avisarRenovacoesCertificacoes(env: Bindings) {
  try {
    const sql = getDb(env)
    const [{ total }] = await sql`select adm_avisos_renovacao() as total`
    if (total > 0) console.log(`Certificações: ${total} aviso(s) de renovação`)
  } catch (err) {
    console.error('Falha nos avisos de renovação de certificações:', err)
  }
}

// Avisos de locais favoritos (Etapa 6b): o banco cria o aviso no sininho na
// hora e deixa o e-mail na fila; aqui ele sai pelo Resend.
export async function enviarAvisosFavoritos(env: Bindings) {
  const sql = getDb(env)
  const pendentes = await sql`select * from internal.avisos_email_pendentes_v2(100)`
  if (pendentes.length === 0) return

  const site = env.AREA01_FRONTEND_URL ?? 'https://plura.app.br'
  const enviados: string[] = []
  for (const aviso of pendentes) {
    if (!aviso.email) {
      enviados.push(aviso.id)
      continue
    }
    try {
      const tipo = String(aviso.tipo ?? '')
      const nome = aviso.nome ? `, ${escaparHtml(String(aviso.nome).split(' ')[0])}` : ''
      // Convites de equipe e certificações levam à área da página; favoritos, à página pública
      const daEquipe = tipo.startsWith('convite_equipe') || tipo.startsWith('certificacao_')
      const rodape = daEquipe
        ? 'Você recebe este aviso porque faz parte da equipe desta página na Plura.'
        : 'Você recebe este aviso porque favoritou este local na Plura. Para mudar, acesse seu perfil.'
      const corpo = `<p>Olá${nome}!</p><p>${escaparHtml(aviso.corpo ?? '')}</p><p style="font-size:13px;color:#667085">${rodape}</p>`
      const link = typeof aviso.link === 'string' && /^https:\/\//.test(aviso.link) ? aviso.link : aviso.pagina_id ? `${site}/pagina?id=${aviso.pagina_id}` : site
      const botao = tipo.startsWith('certificacao_') ? 'Abrir certificação' : tipo.startsWith('convite_equipe') ? 'Abrir minhas páginas' : 'Ver a página'
      await enviarEmailObrigatorio(env.RESEND_API_KEY, aviso.email, aviso.titulo, montarAviso(aviso.titulo, corpo, { texto: botao, link }), env.EMAIL_REMETENTE)
      enviados.push(aviso.id)
    } catch (err) {
      // Fica na fila e tenta de novo na próxima rodada (até 2 dias)
      console.error('Falha ao enviar aviso por e-mail:', err)
    }
  }
  // postgres.js com fetch_types: false não serializa arrays JS: manda o literal do Postgres
  const ids = enviados.filter((id) => /^[0-9a-f-]{36}$/i.test(id))
  if (ids.length) await sql`select internal.marcar_avisos_email_enviados(${`{${ids.join(',')}}`}::uuid[])`
}
