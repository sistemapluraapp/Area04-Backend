import type { SupabaseClient } from '@supabase/supabase-js'

export type Bindings = {
  SUPABASE_URL: string
  SUPABASE_ANON_KEY: string
  AREA: string
  AREA04_DB_URL: string
  AREA04_ADMIN_DB_URL: string
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
