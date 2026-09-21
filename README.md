# Area04-Backend

Backend da Área 04 (Administrativa) da Plura — Hono em Cloudflare Workers.

Funções desta área:
- Indicadores agregados
- Monitorar/excluir contas
- Criar processos de certificação de acessibilidade
- Aprovar/reprovar Certificado de Acessibilidade (única escrita cross-projeto no grupo.01)
- Fila de moderação de avaliações sinalizadas

Banco de dados próprio: Supabase `grupo.02` (`https://sbmvjrfswhbkioynrajd.supabase.co`), isolado.
Acesso cross-projeto ao `grupo.01` via papel restrito `area04_backend`
(SELECT em paginas/vinculos/certificados/avaliações sinalizadas + UPDATE
somente na coluna `status` de `certificados`) — a conexão ainda precisa ser
ligada (ver comentário em `src/lib/supabase.ts`).

## Deploy
O workflow `.github/workflows/deploy.yml` roda `wrangler deploy` a cada push.
Precisa dos secrets do repositório: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.
