import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { requireAuth } from './middleware/auth'
import { signup, login, refresh } from './routes/auth'
import { indicadores } from './routes/indicadores'
import { estatisticas, estatisticasPorAno, estatisticasLoginsPorDia } from './routes/estatisticas'
import {
  listarUsuarios,
  listarGovContas,
  listarPaginas,
  excluirConta,
  suspenderUsuario,
  suspenderGovConta,
  suspenderPagina,
  atualizarUsuario,
  atualizarGovConta,
} from './routes/contas'
import { listarSinalizadas, listarTodas } from './routes/avaliacoes'
import { listarPendentes, atualizarStatus } from './routes/certificados'
import { cancelarConvite as cancelarConviteGov, criarConvite, listarConvites, reenviarConvite as reenviarConviteGov } from './routes/convitesGov'
import {
  listarFiltros,
  criarFiltro,
  atualizarFiltro,
  reordenarFiltros,
  excluirFiltro,
} from './routes/filtros'
import {
  listarCatalogo,
  criarItemCatalogo,
  atualizarItemCatalogo,
  reordenarCatalogo,
  excluirItemCatalogo,
} from './routes/catalogo'
import { listarGrupos, criarGrupo, atualizarGrupo, excluirGrupo } from './routes/grupos'
import { listarDenuncias, atualizarDenuncia } from './routes/denuncias'
import { listarComentarios, moderarComentario } from './routes/comentarios'
import { consumoInfraestrutura, atualizarLimite } from './routes/infraestrutura'
import {
  listarNotificacoes,
  contarNaoLidas,
  marcarLida,
  marcarTodasLidas,
} from './routes/notificacoes'
import { processarAvaliacoesSinalizadas, purgarPaginasExcluidas, enviarAvisosFavoritos } from './lib/cron'
import { hookEmailGrupo01 } from './routes/emailHook'
import { aceitarConviteAdmin, atualizarAdmin, cancelarConvite, convidarAdmin, exportarLogsCsv, listarAdmins, listarLogs, meuAcesso, reenviarConvite, verConviteAdmin } from './routes/admins'
import { atualizarModelo, enviarTesteModelo, listarModelos, previaModelo } from './routes/comunicacao'
import { atualizarTermo, listarTermos } from './routes/termos'
import { esqueciSenhaAdmin, redefinirSenhaAdmin } from './routes/senhaAdmin'
import { interessadosEventoAdm, listarEventosAdm } from './routes/eventos'
import { listarCidades, listarEstados } from './routes/localidades'
import type { AppEnv, Bindings } from './types'

const app = new Hono<AppEnv>()

app.use('*', cors())

app.onError((err, c) => {
  console.error('Erro não tratado:', err)
  const mensagem = err instanceof Error ? err.message : 'Erro inesperado ao falar com o servidor'
  return c.json({ error: mensagem }, 500)
})

app.get('/health', (c) => c.json({ status: 'ok', area: c.env.AREA, service: 'backend' }))

app.post('/auth/signup', signup)
app.post('/auth/login', login)
app.post('/auth/refresh', refresh)
// Chamado pelo Supabase Auth (grupo.01), autenticado pela assinatura do webhook
app.post('/hooks/email-grupo01', hookEmailGrupo01)
// Convite de administrador: o convidado ainda não tem login
app.get('/convites-admin/:token', verConviteAdmin)
app.post('/convites-admin/:token/aceitar', aceitarConviteAdmin)
app.post('/auth/esqueci-senha', esqueciSenhaAdmin)
app.post('/auth/redefinir-senha', redefinirSenhaAdmin)

app.use('*', async (c, next) => {
  const publicas = ['/health', '/auth/login', '/auth/signup', '/auth/refresh', '/auth/esqueci-senha', '/auth/redefinir-senha', '/hooks/email-grupo01']
  if (publicas.includes(c.req.path) || c.req.path.startsWith('/convites-admin/')) return next()
  return requireAuth(c, next)
})

app.get('/me', meuAcesso)
app.get('/admins', listarAdmins)
app.patch('/admins/:id', atualizarAdmin)
app.post('/admins/convites', convidarAdmin)
app.post('/admins/convites/:id/reenviar', reenviarConvite)
app.delete('/admins/convites/:id', cancelarConvite)
app.get('/logs', listarLogs)
app.get('/logs/csv', exportarLogsCsv)

app.get('/indicadores', indicadores)
app.get('/estatisticas', estatisticas)
app.get('/estatisticas/por-ano', estatisticasPorAno)
app.get('/estatisticas/logins-por-dia', estatisticasLoginsPorDia)

app.get('/contas/usuarios', listarUsuarios)
app.get('/contas/gov', listarGovContas)
app.get('/contas/paginas', listarPaginas)
app.patch('/contas/usuarios/:id/suspender', suspenderUsuario)
app.patch('/contas/gov/:id/suspender', suspenderGovConta)
app.patch('/contas/paginas/:id/suspender', suspenderPagina)
app.patch('/contas/usuarios/:id', atualizarUsuario)
app.patch('/contas/gov/:id', atualizarGovConta)
app.delete('/contas/:id', excluirConta)

app.get('/avaliacoes/sinalizadas', listarSinalizadas)
app.get('/avaliacoes/todas', listarTodas)

app.get('/certificados/pendentes', listarPendentes)
app.patch('/certificados/:id', atualizarStatus)

app.post('/convites-gov', criarConvite)
app.get('/convites-gov', listarConvites)
app.post('/convites-gov/:token/reenviar', reenviarConviteGov)
app.delete('/convites-gov/:token', cancelarConviteGov)

app.get('/filtros', listarFiltros)
app.post('/filtros', criarFiltro)
app.patch('/filtros/reordenar', reordenarFiltros)
app.patch('/filtros/:id', atualizarFiltro)
app.delete('/filtros/:id', excluirFiltro)

app.get('/grupos-acessibilidade', listarGrupos)
app.post('/grupos-acessibilidade', criarGrupo)
app.patch('/grupos-acessibilidade/:codigo', atualizarGrupo)
app.delete('/grupos-acessibilidade/:codigo', excluirGrupo)

app.get('/comunicacao', listarModelos)
app.put('/comunicacao/:chave', atualizarModelo)
app.post('/comunicacao/:chave/previa', previaModelo)
app.post('/comunicacao/:chave/teste', enviarTesteModelo)
app.get('/termos', listarTermos)
app.get('/eventos', listarEventosAdm)
app.get('/eventos/:id/interessados', interessadosEventoAdm)
app.get('/localidades/:pais/estados', listarEstados)
app.get('/localidades/:pais/estados/:estado/cidades', listarCidades)
app.put('/termos/:chave', atualizarTermo)

app.get('/catalogo', listarCatalogo)
app.post('/catalogo', criarItemCatalogo)
app.patch('/catalogo/reordenar', reordenarCatalogo)
app.patch('/catalogo/:id', atualizarItemCatalogo)
app.delete('/catalogo/:id', excluirItemCatalogo)

app.get('/denuncias', listarDenuncias)
app.patch('/denuncias/:id', atualizarDenuncia)

app.get('/comentarios', listarComentarios)
app.patch('/comentarios/:id', moderarComentario)

app.get('/infraestrutura', consumoInfraestrutura)
app.patch('/infraestrutura/limites/:recurso', atualizarLimite)

app.get('/notificacoes', listarNotificacoes)
app.get('/notificacoes/contagem-nao-lidas', contarNaoLidas)
app.patch('/notificacoes/:id/ler', marcarLida)
app.patch('/notificacoes/marcar-todas-lidas', marcarTodasLidas)

export default {
  fetch: app.fetch,
  scheduled: async (_event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) => {
    ctx.waitUntil(processarAvaliacoesSinalizadas(env))
    ctx.waitUntil(purgarPaginasExcluidas(env))
    ctx.waitUntil(enviarAvisosFavoritos(env))
  },
}
