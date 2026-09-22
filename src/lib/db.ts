import postgres from 'postgres'

// Conexão direta ao Postgres do grupo.01, autenticada como o papel
// restrito `area04_backend` (leitura ampla + escrita só em
// certificados.status/avaliado_em e avaliacoes.notificada_em) — nunca a
// service_role key inteira.
// Reaproveitada entre requisições no mesmo isolate do Worker.
//
// prepare: false — desliga prepared statements. Sem isso, uma conexão
// mantida viva entre deploys que alteram o schema (ALTER TABLE) passa a
// reaproveitar planos de query com o formato antigo da tabela, e o
// Postgres rejeita com "cached plan must not change result type"
// (aparece como 500 genérico pro cliente). Também é a configuração
// recomendada para conexões via pooler do Supabase em geral.
let sql: ReturnType<typeof postgres> | null = null

export function getDb(dbUrl: string) {
  if (!sql) {
    sql = postgres(dbUrl, { max: 3, idle_timeout: 20, ssl: 'require', prepare: false })
  }
  return sql
}

// Conexão direta ao Postgres do próprio grupo.02 (banco deste backend),
// autenticada como o papel restrito `area04_notifier` — usada só pelo Cron
// Trigger, que não tem um JWT de admin para autenticar via Supabase Auth.
// Singleton independente da conexão acima, sem misturar as duas.
let sqlAdmin: ReturnType<typeof postgres> | null = null

export function getAdminDb(dbUrl: string) {
  if (!sqlAdmin) {
    sqlAdmin = postgres(dbUrl, { max: 3, idle_timeout: 20, ssl: 'require', prepare: false })
  }
  return sqlAdmin
}
