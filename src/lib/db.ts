import postgres from 'postgres'

// Conexão direta ao Postgres do grupo.01, autenticada como o papel
// restrito `area04_backend` (leitura ampla + escrita só em
// certificados.status/avaliado_em e avaliacoes.notificada_em, e agora
// também suspenso/suspensa/uf) — nunca a service_role key inteira.
//
// Importante: NÃO reaproveitamos a conexão entre requisições diferentes
// (nada de singleton em variável de módulo). Já tentamos isso e causou
// erros 502 intermitentes: o Cloudflare pode reciclar/fechar o socket
// TCP subjacente entre invocações do Worker sem avisar o código, e a
// próxima requisição que tentasse reusar essa "conexão zumbi" derrubava
// o Worker inteiro em vez de só falhar a query. Uma conexão nova por
// requisição custa um handshake TCP+TLS a mais (alguns ms), mas nunca
// fica com estado inválido persistente — aceitável para um painel
// administrativo de baixo tráfego.
//
// prepare: false — desliga prepared statements, necessário porque o
// schema desta base muda com frequência (novas colunas via ALTER TABLE)
// e planos de query em cache com o formato antigo da tabela causam erro
// no Postgres ("cached plan must not change result type").
export function getDb(dbUrl: string) {
  return postgres(dbUrl, { max: 1, idle_timeout: 20, ssl: 'require', prepare: false })
}

// Conexão direta ao Postgres do próprio grupo.02 (banco deste backend),
// autenticada como o papel restrito `area04_notifier` — usada só pelo Cron
// Trigger, que não tem um JWT de admin para autenticar via Supabase Auth.
// Mesmo raciocínio acima: sem singleton entre invocações.
export function getAdminDb(dbUrl: string) {
  return postgres(dbUrl, { max: 1, idle_timeout: 20, ssl: 'require', prepare: false })
}
