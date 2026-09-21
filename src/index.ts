import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { requireAuth } from './middleware/auth'
import { signup, login } from './routes/auth'
import { indicadores } from './routes/indicadores'
import { listarUsuarios, listarGovContas, listarPaginas, excluirConta } from './routes/contas'
import { listarSinalizadas } from './routes/avaliacoes'
import { listarPendentes, atualizarStatus } from './routes/certificados'
import { criarConvite, listarConvites } from './routes/convitesGov'
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

app.use('*', async (c, next) => {
  const publicas = ['/health', '/auth/login', '/auth/signup']
  if (publicas.includes(c.req.path)) return next()
  return requireAuth(c, next)
})

app.get('/indicadores', indicadores)

app.get('/contas/usuarios', listarUsuarios)
app.get('/contas/gov', listarGovContas)
app.get('/contas/paginas', listarPaginas)
app.delete('/contas/:id', excluirConta)

app.get('/avaliacoes/sinalizadas', listarSinalizadas)

app.get('/certificados/pendentes', listarPendentes)
app.patch('/certificados/:id', atualizarStatus)

app.post('/convites-gov', criarConvite)
app.get('/convites-gov', listarConvites)

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
