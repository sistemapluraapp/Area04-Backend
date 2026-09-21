import { Hono } from 'hono'

type Bindings = {
  SUPABASE_URL: string
  SUPABASE_ANON_KEY: string
  AREA: string
}

const app = new Hono<{ Bindings: Bindings }>()

app.get('/health', (c) =>
  c.json({ status: 'ok', area: c.env.AREA, service: 'backend' })
)

export default app
