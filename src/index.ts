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
import { criarConvite, listarConvites } from './routes/convitesGov'
import {
  listarFiltros,
  criarFiltro,
  atualizarFiltro,
  reordenarFiltros,
  excluirFiltro,
} from './routes/filtros'
import {
  listarNotificacoes,
  contarNaoLidas,
  marcarLida,
  marcarTodasLidas,
} from './routes/notificacoes'
import { processarAvaliacoesSinalizadas } from './lib/cron'
import type { AppEnv, Bindings } from './types'

const app = new Hono<AppEnv>()

app.use('*', cors())

app.get('/health', (c) => c.json({ status: 'ok', area: c.env.AREA, service: 'backend' }))

app.post('/auth/signup', signup)
app.post('/auth/login', login)
app.post('/auth/refresh', refresh)

app.use('*', async (c, next) => {
  const publicas = ['/health', '/auth/login', '/auth/signup', '/auth/refresh']
  if (publicas.includes(c.req.path)) return next()
  return requireAuth(c, next)
})

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

app.get('/filtros', listarFiltros)
app.post('/filtros', criarFiltro)
app.patch('/filtros/reordenar', reordenarFiltros)
app.patch('/filtros/:id', atualizarFiltro)
app.delete('/filtros/:id', excluirFiltro)

app.get('/notificacoes', listarNotificacoes)
app.get('/notificacoes/contagem-nao-lidas', contarNaoLidas)
app.patch('/notificacoes/:id/ler', marcarLida)
app.patch('/notificacoes/marcar-todas-lidas', marcarTodasLidas)

export default {
  fetch: app.fetch,
  scheduled: async (_event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) => {
    ctx.waitUntil(processarAvaliacoesSinalizadas(env))
  },
}
