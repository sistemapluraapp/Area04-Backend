import type { Context } from 'hono'
import { getAdminDb, getDb } from '../lib/db'
import type { AppEnv, Bindings } from '../types'

// "Consumo de recursos em infraestrutura": uso atual x teto do plano
// gratuito. Supabase soma os dois projetos (a cota do plano é da
// organização): o grupo01 é lido pelo Hyperdrive HYPERDRIVE_GRUPO01 e o
// grupo.02 pelo HYPERDRIVE_GRUPO02, ambos pela função
// public.consumo_infraestrutura().
// As requisições vêm da API GraphQL de análise do Cloudflare, que exige
// CLOUDFLARE_ANALYTICS_TOKEN (permissão "Account Analytics: Read").

type Fase = 'tranquilo' | 'prepare-se' | 'planeje' | 'critico'
type Projeto = {
  banco_bytes: number
  storage_bytes: number
  storage_arquivos: number
  autenticacoes_mes: number
  maiores_tabelas: { nome: string; bytes: number }[]
}
type Limite = { recurso: string; rotulo: string; limite: number; unidade: string; periodo: 'total' | 'mes' | 'dia'; ordem: number; dia_inicio_ciclo: number }

// Operações do R2 que contam no plano grátis (developers.cloudflare.com/r2/pricing).
// DeleteObject, DeleteBucket e AbortMultipartUpload são grátis e ficam de fora.
const R2_CLASSE_A = new Set([
  'ListBuckets', 'PutBucket', 'ListObjects', 'PutObject', 'CopyObject', 'CompleteMultipartUpload', 'CreateMultipartUpload',
  'LifecycleStorageTierTransition', 'ListMultipartUploads', 'UploadPart', 'UploadPartCopy', 'ListParts', 'PutBucketEncryption',
  'PutBucketCors', 'PutBucketLifecycleConfiguration',
])
const R2_CLASSE_B = new Set([
  'HeadBucket', 'HeadObject', 'GetObject', 'UsageSummary', 'GetBucketEncryption', 'GetBucketLocation', 'GetBucketCors',
  'GetBucketLifecycleConfiguration',
])

// Início do ciclo de cobrança que contém "agora" (ex.: dia 21 → de 21 a 21)
function inicioDoCiclo(agora: Date, dia: number) {
  const y = agora.getUTCFullYear()
  const m = agora.getUTCMonth()
  return agora.getUTCDate() >= dia ? Date.UTC(y, m, dia) : Date.UTC(y, m - 1, dia)
}

function fimDoCiclo(inicio: number) {
  const d = new Date(inicio)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
}

const PAINEL_USO_SUPABASE = 'https://supabase.com/dashboard/org/hmfrhiugkfnkcferwuyw/usage'
const DIA_MS = 86_400_000

function fasePorPercentual(p: number): Fase {
  if (p >= 90) return 'critico'
  if (p >= 75) return 'planeje'
  if (p >= 50) return 'prepare-se'
  return 'tranquilo'
}

const ORDEM_FASES: Fase[] = ['tranquilo', 'prepare-se', 'planeje', 'critico']
const maisGrave = (a: Fase, b: Fase) => (ORDEM_FASES.indexOf(a) >= ORDEM_FASES.indexOf(b) ? a : b)

async function lerProjeto(env: Bindings, admin: boolean): Promise<Projeto | { erro: string }> {
  const sql = admin ? getAdminDb(env) : getDb(env)
  try {
    const [linha] = await sql`select public.consumo_infraestrutura() as r`
    const r = linha.r as Projeto
    return {
      banco_bytes: Number(r.banco_bytes),
      storage_bytes: Number(r.storage_bytes),
      storage_arquivos: Number(r.storage_arquivos),
      autenticacoes_mes: Number(r.autenticacoes_mes),
      maiores_tabelas: r.maiores_tabelas.map((t) => ({ nome: t.nome, bytes: Number(t.bytes) })),
    }
  } catch (e) {
    console.error('consumo_infraestrutura falhou:', e)
    return { erro: 'Não foi possível ler o consumo deste projeto' }
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {})
  }
}

// Soma de requisições de todos os Workers da conta desde 00:00 UTC (quando
// o limite diário do plano gratuito zera).
async function lerRequisicoesCloudflare(env: Bindings, agora: Date) {
  if (!env.CLOUDFLARE_ANALYTICS_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID) return { erro: 'aguardando-token' as const }
  const inicio = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate()))
  const query = `query($conta: string!, $inicio: Time!, $fim: Time!) {
    viewer { accounts(filter: { accountTag: $conta }) {
      workersInvocationsAdaptive(limit: 10000, filter: { datetime_geq: $inicio, datetime_leq: $fim }) {
        sum { requests }
        dimensions { scriptName }
      }
    } }
  }`
  try {
    const resp = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.CLOUDFLARE_ANALYTICS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { conta: env.CLOUDFLARE_ACCOUNT_ID, inicio: inicio.toISOString(), fim: agora.toISOString() } }),
    })
    const json = (await resp.json()) as {
      data?: { viewer?: { accounts?: { workersInvocationsAdaptive?: { sum: { requests: number }; dimensions: { scriptName: string } }[] }[] } }
      errors?: { message: string }[] | null
    }
    if (!resp.ok || json.errors?.length) {
      console.error('GraphQL Cloudflare:', resp.status, JSON.stringify(json.errors))
      return { erro: 'Não foi possível ler as requisições do Cloudflare (verifique o token)' }
    }
    const linhas = json.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive ?? []
    const porWorker = new Map<string, number>()
    for (const l of linhas) porWorker.set(l.dimensions.scriptName, (porWorker.get(l.dimensions.scriptName) ?? 0) + l.sum.requests)
    const detalhes = [...porWorker].map(([nome, uso]) => ({ nome, uso })).sort((a, b) => b.uso - a.uso)
    return { total: detalhes.reduce((s, d) => s + d.uso, 0), detalhes }
  } catch (e) {
    console.error('GraphQL Cloudflare falhou:', e)
    return { erro: 'Não foi possível ler as requisições do Cloudflare' }
  }
}

type DetalheR2 = { nome: string; uso: number }
type LeituraR2 = { armazenamento: { total: number; detalhes: DetalheR2[] }; classeA: { total: number; detalhes: DetalheR2[] }; classeB: { total: number; detalhes: DetalheR2[] } }

// Uso do Cloudflare R2 (arquivos das certificações): espaço ocupado agora e
// operações classe A/B desde o início do ciclo de cobrança. Mesma API e
// mesmo token das requisições dos Workers.
async function lerR2Cloudflare(env: Bindings, agora: Date, inicioCiclo: number): Promise<LeituraR2 | { erro: string }> {
  if (!env.CLOUDFLARE_ANALYTICS_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID) return { erro: 'aguardando-token' }
  const query = `query($conta: string!, $inicio: Time!, $inicioEspaco: Time!, $fim: Time!) {
    viewer { accounts(filter: { accountTag: $conta }) {
      r2OperationsAdaptiveGroups(limit: 10000, filter: { datetime_geq: $inicio, datetime_leq: $fim }) {
        sum { requests }
        dimensions { actionType bucketName }
      }
      r2StorageAdaptiveGroups(limit: 10000, filter: { datetime_geq: $inicioEspaco, datetime_leq: $fim }, orderBy: [datetime_DESC]) {
        max { payloadSize metadataSize }
        dimensions { bucketName datetime }
      }
    } }
  }`
  try {
    const resp = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.CLOUDFLARE_ANALYTICS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        variables: {
          conta: env.CLOUDFLARE_ACCOUNT_ID,
          inicio: new Date(inicioCiclo).toISOString(),
          inicioEspaco: new Date(agora.getTime() - 2 * DIA_MS).toISOString(),
          fim: agora.toISOString(),
        },
      }),
    })
    const json = (await resp.json()) as {
      data?: { viewer?: { accounts?: {
        r2OperationsAdaptiveGroups?: { sum: { requests: number }; dimensions: { actionType: string; bucketName: string } }[]
        r2StorageAdaptiveGroups?: { max: { payloadSize: number; metadataSize: number }; dimensions: { bucketName: string; datetime: string } }[]
      }[] } }
      errors?: { message: string }[] | null
    }
    if (!resp.ok || json.errors?.length) {
      console.error('GraphQL R2:', resp.status, JSON.stringify(json.errors))
      return { erro: 'Não foi possível ler o uso do R2 (verifique o token)' }
    }
    const conta = json.data?.viewer?.accounts?.[0]
    const somar = (classe: Set<string>) => {
      const porBucket = new Map<string, number>()
      for (const l of conta?.r2OperationsAdaptiveGroups ?? []) {
        if (classe.has(l.dimensions.actionType)) porBucket.set(l.dimensions.bucketName, (porBucket.get(l.dimensions.bucketName) ?? 0) + l.sum.requests)
      }
      const detalhes = [...porBucket].map(([nome, uso]) => ({ nome, uso })).sort((a, b) => b.uso - a.uso)
      return { total: detalhes.reduce((s, d) => s + d.uso, 0), detalhes }
    }
    // Espaço: a leitura mais recente de cada bucket (a lista vem da mais nova para a mais antiga)
    const espaco = new Map<string, number>()
    for (const l of conta?.r2StorageAdaptiveGroups ?? []) {
      if (!espaco.has(l.dimensions.bucketName)) espaco.set(l.dimensions.bucketName, Number(l.max.payloadSize) + Number(l.max.metadataSize))
    }
    const detalhesEspaco = [...espaco].map(([nome, uso]) => ({ nome, uso })).sort((a, b) => b.uso - a.uso)
    return {
      armazenamento: { total: detalhesEspaco.reduce((s, d) => s + d.uso, 0), detalhes: detalhesEspaco },
      classeA: somar(R2_CLASSE_A),
      classeB: somar(R2_CLASSE_B),
    }
  } catch (e) {
    console.error('GraphQL R2 falhou:', e)
    return { erro: 'Não foi possível ler o uso do R2' }
  }
}

export async function consumoInfraestrutura(c: Context<AppEnv>) {
  const sql = getDb(c.env)
  const agora = new Date()
  const hoje = agora.toISOString().slice(0, 10)

  const limites = await sql<Limite[]>`select recurso, rotulo, limite::float8 as limite, unidade, periodo, ordem, dia_inicio_ciclo from infraestrutura_limites order by ordem`
  const diaCicloR2 = limites.find((l) => l.recurso.startsWith('r2_'))?.dia_inicio_ciclo ?? 1
  const [grupo01, grupo02, cloudflare, r2] = await Promise.all([
    lerProjeto(c.env, false),
    lerProjeto(c.env, true),
    lerRequisicoesCloudflare(c.env, agora),
    lerR2Cloudflare(c.env, agora, inicioDoCiclo(agora, diaCicloR2)),
  ])

  const projetos = [
    { nome: 'grupo01 (usuários, empreendimentos e governo)', dados: grupo01 },
    { nome: 'grupo.02 (administração)', dados: grupo02 },
  ]
  const ok = projetos.flatMap((p) => ('erro' in p.dados ? [] : [p.dados]))
  const completo = ok.length === projetos.length
  const soma = (campo: 'banco_bytes' | 'storage_bytes' | 'autenticacoes_mes') => ok.reduce((s, p) => s + p[campo], 0)
  const detalhe = (campo: 'banco_bytes' | 'storage_bytes' | 'autenticacoes_mes') =>
    projetos.map((p) => ('erro' in p.dados ? { nome: p.nome, uso: null, erro: p.dados.erro } : { nome: p.nome, uso: p.dados[campo] }))

  const leituras: Record<string, { uso: number | null; detalhes?: { nome: string; uso: number | null; erro?: string }[]; erro?: string; aviso?: string }> = {
    banco: { uso: ok.length ? soma('banco_bytes') : null, detalhes: detalhe('banco_bytes'), aviso: completo ? undefined : 'Soma parcial: um dos projetos não respondeu' },
    storage: { uso: ok.length ? soma('storage_bytes') : null, detalhes: detalhe('storage_bytes'), aviso: completo ? undefined : 'Soma parcial: um dos projetos não respondeu' },
    autenticacoes: { uso: ok.length ? soma('autenticacoes_mes') : null, detalhes: detalhe('autenticacoes_mes'), aviso: completo ? undefined : 'Soma parcial: um dos projetos não respondeu' },
    egress: { uso: null, erro: 'indisponivel' },
    requisicoes:
      'erro' in cloudflare
        ? { uso: null, erro: cloudflare.erro }
        : { uso: cloudflare.total, detalhes: cloudflare.detalhes },
    r2_armazenamento: 'erro' in r2 ? { uso: null, erro: r2.erro } : { uso: r2.armazenamento.total, detalhes: r2.armazenamento.detalhes },
    r2_operacoes_a: 'erro' in r2 ? { uso: null, erro: r2.erro } : { uso: r2.classeA.total, detalhes: r2.classeA.detalhes },
    r2_operacoes_b: 'erro' in r2 ? { uso: null, erro: r2.erro } : { uso: r2.classeB.total, detalhes: r2.classeB.detalhes },
  }

  // Guarda a leitura do dia (só quando os dois projetos responderam, para a
  // tendência não enxergar uma queda falsa) e lê o histórico dos últimos 30 dias.
  const independentes = ['requisicoes', 'r2_armazenamento', 'r2_operacoes_a', 'r2_operacoes_b']
  const gravar = Object.entries(leituras).filter(([recurso, l]) => l.uso !== null && (completo || independentes.includes(recurso)))
  for (const [recurso, l] of gravar) {
    await sql`
      insert into infraestrutura_historico (dia, recurso, uso) values (${hoje}, ${recurso}, ${l.uso})
      on conflict (dia, recurso) do update set uso = excluded.uso, atualizado_em = now()
    `
  }
  const historico = await sql<{ dia: string; recurso: string; uso: number }[]>`
    select dia::text as dia, recurso, uso::float8 as uso from infraestrutura_historico
    where dia >= current_date - 30 order by dia
  `
  await sql.end({ timeout: 5 }).catch(() => {})

  const inicioMes = Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), 1)
  const fimMes = Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth() + 1, 1)
  const inicioDia = Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate())

  const recursos = limites.map((lim) => {
    const leitura = leituras[lim.recurso] ?? { uso: null, erro: 'indisponivel' }
    const serie = historico.filter((h) => h.recurso === lim.recurso).map((h) => ({ dia: h.dia, uso: h.uso }))
    const base = { ...lim, ...leitura, historico: serie }
    if (leitura.uso === null) return { ...base, percentual: null, fase: null, previsao: null }

    const uso = leitura.uso
    const percentual = (uso / lim.limite) * 100
    let fase = fasePorPercentual(percentual)
    let previsao: { texto: string; percentual_fim_periodo?: number; dias_ate_teto?: number } | null = null

    if (lim.periodo === 'total') {
      // Tendência linear entre a leitura mais antiga e a atual.
      const primeiro = serie[0]
      const dias = primeiro ? (Date.parse(hoje) - Date.parse(primeiro.dia)) / DIA_MS : 0
      const porDia = dias >= 3 ? (uso - primeiro.uso) / dias : null
      if (porDia === null) previsao = { texto: 'Previsão disponível após alguns dias de leituras' }
      else if (porDia <= 0) previsao = { texto: 'Uso estável nos últimos dias' }
      else {
        const diasAteTeto = Math.max(0, Math.floor((lim.limite - uso) / porDia))
        previsao = { texto: `No ritmo atual, atinge o teto em cerca de ${diasAteTeto} dias`, dias_ate_teto: diasAteTeto }
        if (diasAteTeto <= 30) fase = maisGrave(fase, 'planeje')
      }
    } else {
      // Mensal: mês do calendário, ou o ciclo de cobrança quando não começa no dia 1º (R2)
      const inicioCiclo = lim.dia_inicio_ciclo > 1 ? inicioDoCiclo(agora, lim.dia_inicio_ciclo) : inicioMes
      const fimCiclo = lim.dia_inicio_ciclo > 1 ? fimDoCiclo(inicioCiclo) : fimMes
      const [inicio, fim] = lim.periodo === 'mes' ? [inicioCiclo, fimCiclo] : [inicioDia, inicioDia + DIA_MS]
      const decorrido = (agora.getTime() - inicio) / (fim - inicio)
      const minimo = lim.periodo === 'mes' ? 3 / 30 : 1 / 24
      if (decorrido < minimo) previsao = { texto: 'Previsão disponível mais adiante no período' }
      else {
        const projetado = (uso / decorrido / lim.limite) * 100
        const quando = lim.periodo === 'mes' ? (lim.dia_inicio_ciclo > 1 ? 'no fim do ciclo de cobrança' : 'no fim do mês') : 'no fim do dia (UTC)'
        previsao = { texto: `No ritmo atual, chega a ${Math.round(projetado)}% do teto ${quando}`, percentual_fim_periodo: projetado }
        if (projetado >= 100) fase = maisGrave(fase, 'planeje')
      }
    }
    return { ...base, percentual, fase, previsao }
  })

  const maioresTabelas = projetos.flatMap((p) => ('erro' in p.dados ? [] : p.dados.maiores_tabelas.map((t) => ({ ...t, projeto: p.nome }))))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 8)

  return c.json({
    atualizado_em: agora.toISOString(),
    painel_supabase: PAINEL_USO_SUPABASE,
    recursos,
    maiores_tabelas: maioresTabelas,
  })
}

// Ajusta um teto (ex.: após contratar um plano maior).
export async function atualizarLimite(c: Context<AppEnv>) {
  const recurso = c.req.param('recurso') as string
  const body = await c.req.json<{ limite?: number }>().catch(() => null)
  const limite = Number(body?.limite)
  if (!Number.isFinite(limite) || limite <= 0) return c.json({ error: 'limite deve ser um número maior que zero' }, 400)

  const sql = getDb(c.env)
  const [linha] = await sql`
    update infraestrutura_limites set limite = ${limite}, updated_at = now()
    where recurso = ${recurso}
    returning recurso, limite::float8 as limite
  `
  if (!linha) return c.json({ error: 'Recurso não encontrado' }, 404)
  return c.json(linha)
}
