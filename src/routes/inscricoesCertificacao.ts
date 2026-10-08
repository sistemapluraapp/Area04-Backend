import type { Context } from 'hono'
import { getDb } from '../lib/db'
import type { AppEnv } from '../types'

// Etapa 8d: análise das inscrições das páginas (B2B e Gov) nas certificações.
// A decisão fica em funções do banco (adm_*), que também avisam a equipe da
// página e registram no log dela. Aqui: listas, detalhes e download de arquivos.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DIAS_A_VENCER = 60

// Filtros das abas do painel
const FILTROS: Record<string, string> = {
  fila: `i.status = 'enviada'`,
  andamento: `i.status = 'em_andamento'`,
  certificadas: `i.status = 'aprovada' and (i.expira_em is null or i.expira_em > now() + interval '${DIAS_A_VENCER} days')`,
  a_vencer: `i.status = 'aprovada' and i.expira_em between now() and now() + interval '${DIAS_A_VENCER} days'`,
  vencidas: `i.status = 'aprovada' and i.expira_em < now()`,
  reprovadas: `i.status = 'reprovada'`,
  canceladas: `i.status = 'cancelada'`,
}

function erroBanco(c: Context<AppEnv>, err: unknown) {
  const e = err as { code?: string; message?: string }
  if (e?.code === 'P0002') return c.json({ error: e.message }, 404)
  if (e?.code === '22023') return c.json({ error: e.message }, 400)
  throw err
}

// GET /certificacoes-inscricoes?filtro=fila&busca=texto
export async function listarInscricoes(c: Context<AppEnv>) {
  const sql = getDb(c.env)
  const filtro = FILTROS[c.req.query('filtro') ?? 'fila'] ? (c.req.query('filtro') ?? 'fila') : 'fila'
  const busca = (c.req.query('busca') ?? '').trim().slice(0, 100)
  const termo = `%${busca.replace(/[%_\\]/g, '\\$&')}%`
  const inscricoes = await sql`
    select i.id, i.status, i.created_at, i.enviada_em, i.decidida_em, i.concedida_em, i.expira_em, i.analisada_por,
      c.id as certificacao_id, c.titulo as certificacao_titulo, c.icone as certificacao_icone,
      p.id as pagina_id, p.nome as pagina_nome, p.tipo::text as pagina_tipo, p.cidade as pagina_cidade, p.uf as pagina_uf, p.logo_url as pagina_logo,
      (select count(*)::int from certificacao_respostas r where r.inscricao_id = i.id and r.status = 'enviada') as respostas_pendentes
    from certificacao_inscricoes i
    join certificacoes c on c.id = i.certificacao_id
    join paginas p on p.id = i.pagina_id
    where ${sql.unsafe(FILTROS[filtro])}
      ${busca ? sql`and (p.nome ilike ${termo} or c.titulo ilike ${termo} or p.cidade ilike ${termo})` : sql``}
    order by ${filtro === 'fila' ? sql`i.enviada_em asc nulls last` : filtro === 'a_vencer' || filtro === 'vencidas' ? sql`i.expira_em asc` : sql`i.updated_at desc`}
    limit 200
  `
  const [contagens] = await sql`
    select ${sql.unsafe(Object.entries(FILTROS).map(([k, w]) => `count(*) filter (where ${w})::int as ${k}`).join(', '))}
    from certificacao_inscricoes i
  `
  return c.json({ filtro, inscricoes, contagens })
}

// GET /certificacoes-inscricoes/:id
export async function obterInscricao(c: Context<AppEnv>) {
  const sql = getDb(c.env)
  const id = c.req.param('id') as string
  if (!UUID.test(id)) return c.json({ error: 'Inscrição não encontrada' }, 404)
  const [insc] = await sql`
    select i.*, p.nome as pagina_nome, p.tipo::text as pagina_tipo, p.cidade as pagina_cidade, p.uf as pagina_uf, p.logo_url as pagina_logo
    from certificacao_inscricoes i join paginas p on p.id = i.pagina_id
    where i.id = ${id}
  `
  if (!insc) return c.json({ error: 'Inscrição não encontrada' }, 404)
  const [cert] = await sql`select id, titulo, resumo, icone, validade_meses, escopo from certificacoes where id = ${insc.certificacao_id}`
  const etapas = await sql`select id, titulo, descricao, modo, ordem from certificacao_etapas where certificacao_id = ${insc.certificacao_id} order by ordem, id`
  const requisitos = await sql`
    select r.id, r.etapa_id, r.titulo, r.descricao, r.tipo, r.obrigatorio, r.config, r.ordem
    from certificacao_requisitos r join certificacao_etapas e on e.id = r.etapa_id
    where e.certificacao_id = ${insc.certificacao_id} order by r.ordem
  `
  const respostas = await sql`
    select requisito_id, valor, status, comentario_adm, updated_at, avaliada_por, avaliada_em
    from certificacao_respostas where inscricao_id = ${id}
  `
  const liberadas = await sql`select etapa_id, aprovada from internal.etapas_liberadas(${id})`
  const equipe = await sql`
    select coalesce(nullif(u.nome_social, ''), u.nome, g.nome) as nome, v.papel::text as papel, v.cargo
    from vinculos v
    left join usuarios u on u.id = v.usuario_id
    left join gov_contas g on g.id = v.gov_conta_id
    where v.pagina_id = ${insc.pagina_id} and v.status = 'ativo' and (v.papel = 'administrador' or 'selos' = any(v.permissoes))
    order by v.papel
  `
  return c.json({
    ...insc,
    certificacao: { ...cert, etapas: etapas.map((e) => ({ ...e, requisitos: requisitos.filter((r) => r.etapa_id === e.id) })) },
    respostas,
    etapas_liberadas: liberadas,
    equipe,
  })
}

// PATCH /certificacoes-inscricoes/:id/respostas/:requisitoId { status: aprovada|ajustes|enviada, comentario }
export async function avaliarResposta(c: Context<AppEnv>) {
  const body = await c.req.json<{ status?: unknown; comentario?: unknown }>().catch(() => null)
  const status = String(body?.status ?? '')
  if (!['aprovada', 'ajustes', 'enviada'].includes(status)) return c.json({ error: 'Avaliação inválida' }, 400)
  const comentario = typeof body?.comentario === 'string' ? body.comentario : null
  const sql = getDb(c.env)
  try {
    const [r] = await sql`select * from adm_avaliar_resposta(${c.req.param('id') as string}, ${c.req.param('requisitoId') as string}, ${status}, ${comentario}, ${c.get('admin').nome})`
    return c.json(r)
  } catch (err) {
    return erroBanco(c, err)
  }
}

// POST /certificacoes-inscricoes/:id/vistoria/:requisitoId { data: AAAA-MM-DD, periodo }
export async function confirmarVistoria(c: Context<AppEnv>) {
  const body = await c.req.json<{ data?: unknown; periodo?: unknown }>().catch(() => null)
  const data = String(body?.data ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return c.json({ error: 'Informe a data' }, 400)
  const sql = getDb(c.env)
  try {
    const [r] = await sql`select * from adm_confirmar_vistoria(${c.req.param('id') as string}, ${c.req.param('requisitoId') as string}, ${data}::date, ${String(body?.periodo ?? '')}, ${c.get('admin').nome})`
    return c.json(r)
  } catch (err) {
    return erroBanco(c, err)
  }
}

// POST /certificacoes-inscricoes/:id/concluir { decisao: concluir|reprovar, observacao }
export async function concluirAnalise(c: Context<AppEnv>) {
  const body = await c.req.json<{ decisao?: unknown; observacao?: unknown }>().catch(() => null)
  const decisao = String(body?.decisao ?? '')
  if (!['concluir', 'reprovar'].includes(decisao)) return c.json({ error: 'Decisão inválida' }, 400)
  const observacao = typeof body?.observacao === 'string' ? body.observacao : null
  const sql = getDb(c.env)
  try {
    const [r] = await sql`select * from adm_concluir_analise(${c.req.param('id') as string}, ${decisao}, ${observacao}, ${c.get('admin').nome})`
    return c.json(r)
  } catch (err) {
    return erroBanco(c, err)
  }
}

// GET /certificacoes-inscricoes/:id/arquivo?requisito=...&chave=...
export async function baixarArquivoInscricao(c: Context<AppEnv>) {
  const id = c.req.param('id') as string
  const requisito = c.req.query('requisito') ?? ''
  const chave = c.req.query('chave') ?? ''
  if (!UUID.test(id) || !UUID.test(requisito)) return c.json({ error: 'Arquivo não encontrado' }, 404)
  const sql = getDb(c.env)
  const [resp] = await sql`select valor from certificacao_respostas where inscricao_id = ${id} and requisito_id = ${requisito}`
  const itens = ((resp?.valor as { itens?: { chave: string; nome: string }[] } | undefined)?.itens ?? [])
  const item = itens.find((i) => i.chave === chave)
  if (!item) return c.json({ error: 'Arquivo não encontrado' }, 404)
  const objeto = await c.env.CERTIFICACOES.get(chave)
  if (!objeto) return c.json({ error: 'Arquivo não encontrado no armazenamento' }, 404)
  return new Response(objeto.body, {
    headers: {
      'Content-Type': objeto.httpMetadata?.contentType ?? 'application/octet-stream',
      'Content-Length': String(objeto.size),
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(item.nome)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
