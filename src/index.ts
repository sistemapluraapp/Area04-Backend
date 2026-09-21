import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { requireAuth } from './middleware/auth'
import { signup, login } from './routes/auth'
import { indicadores } from './routes/indicadores'
import { listarUsuarios, listarGovContas, listarPaginas, excluirConta } from './routes/contas'
import { listarSinalizadas } from './routes/avaliacoes'
import { listarPendentes, atualizarStatus } from './routes/certificados'
import { criarConvite, listarConvites } from './routes/convitesGov'
import type { AppEnv } from './types'

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

export default app
