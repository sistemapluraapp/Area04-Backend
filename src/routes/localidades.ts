import type { Context } from 'hono'
import type { AppEnv } from '../types'

// Estados e cidades fora do Brasil, pela API CountryStateCity (a chave fica
// só no servidor, no secret CSC_API_KEY). O Brasil usa o IBGE direto no
// navegador. Sem a chave, responde 503 e o formulário aceita texto livre.

const BASE = 'https://api.countrystatecity.in/v1'
const UM_DIA = 60 * 60 * 24

async function consultar<T>(c: Context<AppEnv>, caminho: string): Promise<{ dados?: T; resposta?: Response }> {
  const chave = c.env.CSC_API_KEY
  if (!chave) return { resposta: c.json({ error: 'Lista de estados e cidades indisponível para este país', indisponivel: true }, 503) }
  const res = await fetch(`${BASE}${caminho}`, {
    headers: { 'X-CSCAPI-KEY': chave },
    cf: { cacheTtl: UM_DIA, cacheEverything: true },
  } as RequestInit)
  if (res.status === 404) return { dados: [] as T }
  if (!res.ok) return { resposta: c.json({ error: 'Lista de estados e cidades indisponível agora', indisponivel: true }, 503) }
  return { dados: (await res.json()) as T }
}

const ordenar = <T extends { nome: string }>(lista: T[]) => lista.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))

export async function listarEstados(c: Context<AppEnv>) {
  const pais = (c.req.param('pais') ?? '').toUpperCase()
  if (!/^[A-Z]{2}$/.test(pais)) return c.json({ error: 'País inválido' }, 400)
  const { dados, resposta } = await consultar<{ name: string; iso2: string }[]>(c, `/countries/${pais}/states`)
  if (resposta) return resposta
  c.header('Cache-Control', `public, max-age=${UM_DIA}`)
  return c.json({ estados: ordenar((dados ?? []).map((e) => ({ codigo: e.iso2, nome: e.name }))) })
}

export async function listarCidades(c: Context<AppEnv>) {
  const pais = (c.req.param('pais') ?? '').toUpperCase()
  const estado = c.req.param('estado') ?? ''
  if (!/^[A-Z]{2}$/.test(pais) || !/^[A-Za-z0-9-]{1,10}$/.test(estado)) return c.json({ error: 'Local inválido' }, 400)
  const { dados, resposta } = await consultar<{ name: string }[]>(c, `/countries/${pais}/states/${encodeURIComponent(estado)}/cities`)
  if (resposta) return resposta
  c.header('Cache-Control', `public, max-age=${UM_DIA}`)
  return c.json({ cidades: ordenar((dados ?? []).map((e) => ({ nome: e.name }))) })
}
