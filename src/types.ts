import type { SupabaseClient } from '@supabase/supabase-js'

export type Bindings = {
  SUPABASE_URL: string
  SUPABASE_ANON_KEY: string
  AREA: string
  HYPERDRIVE_GRUPO01: Hyperdrive
  HYPERDRIVE_GRUPO02: Hyperdrive
  ADMIN_SIGNUP_CODE: string
  RESEND_API_KEY: string
  // Opcionais: sem eles o card de requisições mostra "aguardando token".
  CLOUDFLARE_ANALYTICS_TOKEN?: string
  CLOUDFLARE_ACCOUNT_ID?: string
}

export type Variables = {
  supabase: SupabaseClient
  userId: string
}

export type AppEnv = { Bindings: Bindings; Variables: Variables }
