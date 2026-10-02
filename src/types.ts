import type { SupabaseClient } from '@supabase/supabase-js'

export type Bindings = {
  CSC_API_KEY?: string
  SUPABASE_URL: string
  SUPABASE_ANON_KEY: string
  AREA: string
  HYPERDRIVE_GRUPO01: Hyperdrive
  HYPERDRIVE_GRUPO02: Hyperdrive
  ADMIN_SIGNUP_CODE: string
  RESEND_API_KEY: string
  // Remetente dos e-mails (ex.: "Plura <nao-responda@plura.app.br>")
  EMAIL_REMETENTE?: string
  AREA03_FRONTEND_URL?: string
  AREA01_FRONTEND_URL?: string
  // URL do Supabase do grupo.01 (usuários, B2B e Gov) — monta os links de confirmação
  GRUPO01_SUPABASE_URL: string
  // Segredo do Send Email Hook do grupo.01 (painel do Supabase → Auth → Hooks)
  SEND_EMAIL_HOOK_SECRET?: string
  // Opcionais: sem eles o card de requisições mostra "aguardando token".
  CLOUDFLARE_ANALYTICS_TOKEN?: string
  CLOUDFLARE_ACCOUNT_ID?: string
}

export interface AdminLogado {
  id: string
  nome: string
  email: string
  permissoes: string[]
}

export type Variables = {
  supabase: SupabaseClient
  userId: string
  userEmail: string
  admin: AdminLogado
}

export type AppEnv = { Bindings: Bindings; Variables: Variables }
