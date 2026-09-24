import postgres from 'postgres'
import type { Bindings } from '../types'

// As conexões passam pelo Cloudflare Hyperdrive, não direto do Worker ao
// Postgres. Conectando direto, o postgres.js no Cloudflare reconecta em
// loop, sem espera, quando o socket fecha durante o handshake TLS inicial
// (cf/src/connection.js, closed() com `initial` setado), e cada reconexão
// consome um subrequest até o Worker falhar com "Too many subrequests by
// single Worker invocation". Com o Hyperdrive, o TLS e o pool ficam do lado
// da Cloudflare e o Worker só abre uma conexão local, sem TLS.
//
// Uma conexão nova por requisição (sem singleton em variável de módulo): o
// Hyperdrive mantém o pool real, então abrir o client é barato, e reusar um
// socket entre invocações do Worker já causou 502 no passado.
function conectar(connectionString: string) {
  return postgres(connectionString, { max: 1, fetch_types: false, prepare: false })
}

// grupo.01, papel restrito `area04_backend` (leitura ampla + escrita só nas
// colunas que o painel administra) — nunca a service_role key inteira.
export function getDb(env: Bindings) {
  return conectar(env.HYPERDRIVE_GRUPO01.connectionString)
}

// grupo.02 (banco deste backend), papel restrito `area04_notifier` — usado só
// pelo Cron Trigger, que não tem um JWT de admin para autenticar via Supabase Auth.
export function getAdminDb(env: Bindings) {
  return conectar(env.HYPERDRIVE_GRUPO02.connectionString)
}
