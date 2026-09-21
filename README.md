# Area04-Backend

Backend da Área 04 (Administrativa) da Plura — Hono em Cloudflare Workers.

Funções desta área:
- Login/signup de administradores (signup exige `ADMIN_SIGNUP_CODE`)
- Indicadores agregados
- Monitorar/excluir contas (usuários, contas gov)
- Moderar avaliações sinalizadas
- Aprovar/reprovar certificados de acessibilidade
- Gerar e listar convites de cadastro para contas Gov

Banco de dados próprio: Supabase `grupo.02` (`https://sbmvjrfswhbkioynrajd.supabase.co`), isolado — usado para auth/admins.

Acesso cross-projeto ao `grupo.01` via conexão Postgres direta (`postgres.js`),
com a role restrita `area04_backend` (SELECT em usuarios/gov_contas/paginas/
avaliacoes/certificados, INSERT/SELECT em chaves_acesso_gov, DELETE em
auth.users para exclusão de contas).

## Secrets necessários (GitHub Actions)
- `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` — usados pelo wrangler-action para deploy
- `AREA04_DB_URL` — connection string Postgres (via pooler Supabase) da role `area04_backend` no `grupo.01`
- `ADMIN_SIGNUP_CODE` — código exigido em `/auth/signup` para criar uma conta de administrador

Esses dois últimos são configurados como Worker secrets automaticamente pelo
workflow de deploy (`wrangler secret put`), a partir dos secrets do repositório.

## Deploy
O workflow `.github/workflows/deploy.yml` roda `npm run typecheck`, configura
os secrets do Worker e faz `wrangler deploy` a cada push.
