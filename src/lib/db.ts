import postgres from 'postgres'

// AREA04_DB_URL e AREA04_ADMIN_DB_URL DEVEM apontar para o pooler Supavisor
// em modo transaction (porta 6543, host aws-0-<região>.pooler.supabase.com),
// nunca para a connection string direta (db.<ref>.supabase.co:5432).
//
// Causa raiz do "Too many subrequests by single Worker invocation" que
// derrubava /indicadores, /estatisticas e /contas/paginas: a connection
// string direta do Supabase só resolve em IPv6 (a menos que o projeto
// tenha o add-on de IPv4 pago). O Cloudflare Worker não conseguia abrir
// esse socket de forma confiável e o postgres.js reabria a conexão
// repetidamente dentro da mesma invocação até estourar o limite de
// subrequests do Worker — isso ficou mascarado por meses porque a versão
// antiga reaproveitava a mesma conexão (singleton) durante toda a vida do
// isolate, então só pagava esse custo raramente. Ao remover o singleton
// (para resolver os 502 intermitentes, comentário abaixo), toda requisição
// passou a pagar esse custo, e a falha virou constante.
//
// O pooler Supavisor em modo transaction é IPv4 e é justamente o método
// recomendado pela Supabase para funções serverless/edge com conexões
// curtas — resolve os dois problemas ao mesmo tempo.
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
// prepare: false — obrigatório em modo transaction do Supavisor (não
// suporta prepared statements), e também evita erro de "cached plan must
// not change result type" quando o schema muda via ALTER TABLE.
export function getDb(dbUrl: string) {
  return postgres(dbUrl, { max: 1, idle_timeout: 20, ssl: 'require', prepare: false })
}

// Conexão ao Postgres do próprio grupo.02 (banco deste backend),
// autenticada como o papel restrito `area04_notifier` — usada só pelo Cron
// Trigger, que não tem um JWT de admin para autenticar via Supabase Auth.
// Mesmo raciocínio acima: sem singleton entre invocações, e a URL também
// deve ser a do pooler Supavisor (transaction mode).
export function getAdminDb(dbUrl: string) {
  return postgres(dbUrl, { max: 1, idle_timeout: 20, ssl: 'require', prepare: false })
}
