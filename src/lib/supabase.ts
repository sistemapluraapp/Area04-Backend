import { createClient } from '@supabase/supabase-js'
import type { Context } from 'hono'
import type { AppEnv } from '../types'

// Cliente do próprio grupo.02 (contas de admin, isoladas).
export function getAnonClient(c: Context<AppEnv>) {
  return createClient(c.env.SUPABASE_URL, c.env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  })
}

export function getUserClient(c: Context<AppEnv>, accessToken: string) {
  return createClient(c.env.SUPABASE_URL, c.env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  })
}
