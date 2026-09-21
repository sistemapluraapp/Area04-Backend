import postgres from 'postgres'

// Conexão direta ao Postgres do grupo.01, autenticada como o papel
// restrito `area04_backend` (leitura ampla + escrita só em
// certificados.status) — nunca a service_role key inteira.
// Reaproveitada entre requisições no mesmo isolate do Worker.
let sql: ReturnType<typeof postgres> | null = null

export function getDb(dbUrl: string) {
  if (!sql) {
    sql = postgres(dbUrl, { max: 3, idle_timeout: 20, ssl: 'require' })
  }
  return sql
}
