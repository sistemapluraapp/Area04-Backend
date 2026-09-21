import { createClient } from '@supabase/supabase-js'
import type { Context } from 'hono'

type Env = {
  SUPABASE_URL: string
  SUPABASE_ANON_KEY: string
}

// Cliente do próprio grupo.02 (dados isolados da Área 04).
export function getSupabaseClient(c: Context<{ Bindings: Env }>) {
  return createClient(c.env.SUPABASE_URL, c.env.SUPABASE_ANON_KEY)
}

// Acesso cross-projeto ao grupo.01 (leitura + escrita restrita em
// certificados.status) via o papel `area04_backend` — a implementar na
// Fase 3/4 usando uma conexão Postgres direta (ex.: Cloudflare Hyperdrive),
// nunca a service_role key inteira do grupo.01.
