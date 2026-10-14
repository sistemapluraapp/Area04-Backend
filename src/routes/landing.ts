import type { Context } from 'hono'
import { getDb } from '../lib/db'
import type { AppEnv } from '../types'

// Etapa 9: editor da landing page de plura.app.br (cópia do ADM do Festival da Primavera).
// As "server actions" do Festival viraram estas rotas; os nomes dos campos seguem o Festival.

type Sql = ReturnType<typeof getDb>
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const KINDS = ['home', 'evento', 'institucional'] as const
const MAX_CONTEUDO = 1_500_000 // ~1,5 MB de JSON por página

const quem = (c: Context<AppEnv>) => c.get('admin').nome

function slugify(input: string) {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

// Conteúdo das páginas: { sections: [...] } (a forma completa é validada no editor)
function conteudoValido(v: unknown): v is { sections: unknown[] } {
  if (!v || typeof v !== 'object' || !Array.isArray((v as { sections?: unknown }).sections)) return false
  return JSON.stringify(v).length <= MAX_CONTEUDO
}

async function slugUnico(sql: Sql, base: string, ignorar?: string) {
  const raiz = slugify(base) || 'pagina'
  for (let i = 0; i < 50; i++) {
    const slug = i === 0 ? raiz : `${raiz}-${i + 1}`
    const [achou] = ignorar
      ? await sql`select id from landing_pages where slug = ${slug} and id <> ${ignorar}`
      : await sql`select id from landing_pages where slug = ${slug}`
    if (!achou) return slug
  }
  return `${raiz}-${Date.now().toString(36)}`
}

// ===== Páginas =====

// GET /landing/paginas
export async function listarPaginasLanding(c: Context<AppEnv>) {
  const sql = getDb(c.env)
  const paginas = await sql`
    select p.id, p.kind, p.slug, p.title, p.status, p.publish_at, p.category, p.starts_at, p.ends_at, p.location, p.cover_url,
      p.show_in_nav, p.sort_order, p.published_at, p.updated_at, p.updated_by,
      (d.page_id is not null and (p.published_at is null or d.updated_at > p.published_at + interval '2 seconds')) as tem_rascunho
    from landing_pages p left join landing_page_drafts d on d.page_id = p.id
    order by case p.kind when 'home' then 0 else 1 end, p.sort_order, p.created_at
  `
  return c.json({ paginas })
}

// POST /landing/paginas { title, kind, content }  (o editor monta o conteúdo do modelo escolhido)
export async function criarPaginaLanding(c: Context<AppEnv>) {
  const b = await c.req.json<{ title?: unknown; kind?: unknown; content?: unknown }>().catch(() => null)
  const title = typeof b?.title === 'string' ? b.title.trim().slice(0, 200) : ''
  const kind = String(b?.kind ?? 'evento')
  if (!title) return c.json({ error: 'Informe um título.' }, 400)
  if (!KINDS.includes(kind as never) || kind === 'home') return c.json({ error: 'Tipo de página inválido.' }, 400)
  if (!conteudoValido(b?.content)) return c.json({ error: 'Conteúdo inválido.' }, 400)
  const sql = getDb(c.env)
  const slug = await slugUnico(sql, title)
  const [max] = await sql`select coalesce(max(sort_order), 0)::int as m from landing_pages`
  const [p] = await sql`
    insert into landing_pages (title, slug, kind, status, created_by, updated_by, sort_order)
    values (${title}, ${slug}, ${kind}, 'draft', ${quem(c)}, ${quem(c)}, ${max.m + 1}) returning id`
  await sql`insert into landing_page_drafts (page_id, content, updated_by) values (${p.id}, ${sql.json(b!.content as never)}, ${quem(c)})`
  return c.json({ id: p.id, title, slug }, 201)
}

// POST /landing/paginas/inicio { content }  (cria a página inicial se ainda não existir)
export async function garantirInicioLanding(c: Context<AppEnv>) {
  const sql = getDb(c.env)
  const [existe] = await sql`select id from landing_pages where kind = 'home'`
  if (existe) return c.json({ id: existe.id })
  const b = await c.req.json<{ content?: unknown }>().catch(() => null)
  if (!conteudoValido(b?.content)) return c.json({ error: 'Conteúdo inválido.' }, 400)
  const conteudo = b!.content as never
  const [p] = await sql`
    insert into landing_pages (kind, slug, title, status, content, published_at, show_in_nav, created_by, updated_by)
    values ('home', 'inicio', 'Início', 'published', ${sql.json(conteudo)}, now(), false, ${quem(c)}, ${quem(c)})
    on conflict do nothing returning id`
  const id = p?.id ?? (await sql`select id from landing_pages where kind = 'home'`)[0]?.id
  return c.json({ id }, 201)
}

// POST /landing/paginas/:id/duplicar
export async function duplicarPaginaLanding(c: Context<AppEnv>) {
  const sql = getDb(c.env)
  const id = c.req.param('id') as string
  if (!UUID.test(id)) return c.json({ error: 'Página não encontrada.' }, 404)
  const [p] = await sql`select * from landing_pages where id = ${id}`
  if (!p) return c.json({ error: 'Página não encontrada.' }, 404)
  if (p.kind === 'home') return c.json({ error: 'A página inicial não pode ser duplicada.' }, 400)
  const [d] = await sql`select content from landing_page_drafts where page_id = ${id}`
  const title = `${p.title} (cópia)`
  const slug = await slugUnico(sql, title)
  const [nova] = await sql`
    insert into landing_pages (title, slug, kind, status, category, starts_at, ends_at, location, cover_url, show_in_nav, seo, sort_order, created_by, updated_by)
    values (${title}, ${slug}, ${p.kind}, 'draft', ${p.category}, ${p.starts_at}, ${p.ends_at}, ${p.location}, ${p.cover_url}, ${p.show_in_nav},
      ${sql.json((p.seo ?? {}) as never)}, ${p.sort_order + 1}, ${quem(c)}, ${quem(c)}) returning id`
  await sql`insert into landing_page_drafts (page_id, content, updated_by) values (${nova.id}, ${sql.json((d?.content ?? p.content) as never)}, ${quem(c)})`
  return c.json({ id: nova.id }, 201)
}

// DELETE /landing/paginas/:id
export async function excluirPaginaLanding(c: Context<AppEnv>) {
  const sql = getDb(c.env)
  const id = c.req.param('id') as string
  if (!UUID.test(id)) return c.json({ error: 'Página não encontrada.' }, 404)
  const [p] = await sql`select kind, title from landing_pages where id = ${id}`
  if (!p) return c.json({ error: 'Página não encontrada.' }, 404)
  if (p.kind === 'home') return c.json({ error: 'A página inicial não pode ser excluída.' }, 400)
  await sql`delete from landing_pages where id = ${id}`
  return c.json({ ok: true, title: p.title })
}

// PUT /landing/paginas/ordem { ids }
export async function reordenarPaginasLanding(c: Context<AppEnv>) {
  const b = await c.req.json<{ ids?: unknown }>().catch(() => null)
  const ids = Array.isArray(b?.ids) ? (b!.ids as unknown[]).filter((i): i is string => typeof i === 'string' && UUID.test(i)).slice(0, 500) : []
  const sql = getDb(c.env)
  await sql.begin(async (tx) => {
    for (let i = 0; i < ids.length; i++) await tx`update landing_pages set sort_order = ${i + 1} where id = ${ids[i]}`
  })
  return c.json({ ok: true })
}

// PATCH /landing/paginas/:id/status { status: draft|published }
export async function statusPaginaLanding(c: Context<AppEnv>) {
  const b = await c.req.json<{ status?: unknown }>().catch(() => null)
  const status = String(b?.status ?? '')
  if (status !== 'draft' && status !== 'published') return c.json({ error: 'Situação inválida.' }, 400)
  const sql = getDb(c.env)
  const id = c.req.param('id') as string
  const [p] = UUID.test(id) ? await sql`select kind, title from landing_pages where id = ${id}` : []
  if (!p) return c.json({ error: 'Página não encontrada.' }, 404)
  if (p.kind === 'home' && status === 'draft') return c.json({ error: 'A página inicial fica sempre publicada.' }, 400)
  await sql`
    update landing_pages set status = ${status}, updated_by = ${quem(c)}, publish_at = null,
      published_at = case when ${status} = 'published' then now() else published_at end
    where id = ${id}`
  return c.json({ ok: true, title: p.title })
}

// GET /landing/paginas/:id  (dados do editor: página, rascunho, configurações e eventos)
export async function obterPaginaLanding(c: Context<AppEnv>) {
  const sql = getDb(c.env)
  const id = c.req.param('id') as string
  if (!UUID.test(id)) return c.json({ error: 'Página não encontrada.' }, 404)
  const [page] = await sql`select * from landing_pages where id = ${id}`
  if (!page) return c.json({ error: 'Página não encontrada.' }, 404)
  const [[draft], [settings], events] = await Promise.all([
    sql`select content from landing_page_drafts where page_id = ${id}`,
    sql`select * from landing_site_settings where id = 1`,
    sql`select id, slug, title, category, starts_at, ends_at, location, cover_url from landing_pages
        where kind = 'evento' and status in ('published', 'scheduled') order by sort_order`,
  ])
  return c.json({ page, draft: draft?.content ?? null, settings: settings ?? null, events })
}

// PUT /landing/paginas/:id/rascunho { content }
export async function salvarRascunhoLanding(c: Context<AppEnv>) {
  const b = await c.req.json<{ content?: unknown }>().catch(() => null)
  if (!conteudoValido(b?.content)) return c.json({ error: 'Conteúdo inválido ou grande demais.' }, 400)
  const sql = getDb(c.env)
  const id = c.req.param('id') as string
  if (!UUID.test(id)) return c.json({ error: 'Página não encontrada.' }, 404)
  await sql`
    insert into landing_page_drafts (page_id, content, updated_by) values (${id}, ${sql.json(b!.content as never)}, ${quem(c)})
    on conflict (page_id) do update set content = excluded.content, updated_by = excluded.updated_by`
  await sql`update landing_pages set updated_by = ${quem(c)}, updated_at = now() where id = ${id}`
  return c.json({ ok: true, savedAt: new Date().toISOString() })
}

// POST /landing/paginas/:id/publicar { content, at? }  (publica agora ou agenda; guarda versão)
export async function publicarPaginaLanding(c: Context<AppEnv>) {
  const b = await c.req.json<{ content?: unknown; at?: unknown }>().catch(() => null)
  if (!conteudoValido(b?.content)) return c.json({ error: 'Conteúdo inválido ou grande demais.' }, 400)
  const sql = getDb(c.env)
  const id = c.req.param('id') as string
  const [p] = UUID.test(id) ? await sql`select title from landing_pages where id = ${id}` : []
  if (!p) return c.json({ error: 'Página não encontrada.' }, 404)
  const at = typeof b?.at === 'string' && b.at ? new Date(b.at) : null
  const agendada = !!at && !Number.isNaN(at.getTime()) && at.getTime() > Date.now()
  const conteudo = b!.content as never
  await sql.begin(async (tx) => {
    await tx`
      update landing_pages set content = ${tx.json(conteudo)}, status = ${agendada ? 'scheduled' : 'published'},
        publish_at = ${agendada ? at!.toISOString() : null}, published_at = now(), updated_by = ${quem(c)}
      where id = ${id}`
    await tx`
      insert into landing_page_drafts (page_id, content, updated_by) values (${id}, ${tx.json(conteudo)}, ${quem(c)})
      on conflict (page_id) do update set content = excluded.content, updated_by = excluded.updated_by`
    await tx`insert into landing_page_versions (page_id, content, created_by) values (${id}, ${tx.json(conteudo)}, ${quem(c)})`
  })
  return c.json({ ok: true, title: p.title, agendada })
}

// PATCH /landing/paginas/:id { title, slug, kind, category, starts_at, ends_at, location, cover_url, show_in_nav, seo }
export async function atualizarMetaLanding(c: Context<AppEnv>) {
  const m = await c.req.json<Record<string, unknown>>().catch(() => null)
  if (!m) return c.json({ error: 'Dados inválidos.' }, 400)
  const sql = getDb(c.env)
  const id = c.req.param('id') as string
  const [cur] = UUID.test(id) ? await sql`select kind from landing_pages where id = ${id}` : []
  if (!cur) return c.json({ error: 'Página não encontrada.' }, 404)
  const title = typeof m.title === 'string' ? m.title.trim().slice(0, 200) : ''
  if (!title) return c.json({ error: 'Informe um título.' }, 400)
  const slug = cur.kind === 'home' ? 'inicio' : slugify(typeof m.slug === 'string' && m.slug ? m.slug : title)
  if (!slug) return c.json({ error: 'Endereço inválido.' }, 400)
  const [conflito] = await sql`select id from landing_pages where slug = ${slug} and id <> ${id}`
  if (conflito) return c.json({ error: 'Já existe uma página com esse endereço.' }, 400)
  const data = (v: unknown) => (typeof v === 'string' && v && !Number.isNaN(new Date(v).getTime()) ? new Date(v).toISOString() : null)
  const texto = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)
  const starts = data(m.starts_at)
  const ends = data(m.ends_at)
  if (starts && ends && new Date(ends) < new Date(starts)) return c.json({ error: 'O término é antes do início.' }, 400)
  const kind = cur.kind === 'home' ? 'home' : m.kind === 'institucional' ? 'institucional' : 'evento'
  const seo = m.seo && typeof m.seo === 'object' ? m.seo : {}
  await sql`
    update landing_pages set title = ${title}, slug = ${slug}, kind = ${kind}, category = ${texto(m.category, 120)},
      starts_at = ${starts}, ends_at = ${ends}, location = ${texto(m.location, 300)}, cover_url = ${texto(m.cover_url, 1000)},
      show_in_nav = ${m.show_in_nav !== false}, seo = ${sql.json(seo as never)}, updated_by = ${quem(c)}
    where id = ${id}`
  return c.json({ ok: true, slug })
}

// GET /landing/paginas/:id/versoes
export async function listarVersoesLanding(c: Context<AppEnv>) {
  const id = c.req.param('id') as string
  if (!UUID.test(id)) return c.json({ versoes: [] })
  const sql = getDb(c.env)
  const versoes = await sql`
    select id, created_at, coalesce(created_by, '—') as author from landing_page_versions
    where page_id = ${id} order by created_at desc limit 30`
  return c.json({ versoes })
}

// GET /landing/versoes/:id
export async function obterVersaoLanding(c: Context<AppEnv>) {
  const id = c.req.param('id') as string
  if (!UUID.test(id)) return c.json({ error: 'Versão não encontrada.' }, 404)
  const [v] = await getDb(c.env)`select content from landing_page_versions where id = ${id}`
  if (!v) return c.json({ error: 'Versão não encontrada.' }, 404)
  return c.json({ content: v.content })
}

// ===== Configurações do site =====

const CAMPOS_CONFIG = ['festival_name', 'tagline', 'location', 'starts_at', 'ends_at', 'schedule_text', 'brand', 'theme', 'nav', 'footer', 'social', 'privacy_text'] as const

// GET /landing/configuracoes
export async function obterConfigLanding(c: Context<AppEnv>) {
  const [s] = await getDb(c.env)`select * from landing_site_settings where id = 1`
  return c.json(s ?? null)
}

// PATCH /landing/configuracoes
export async function salvarConfigLanding(c: Context<AppEnv>) {
  const patch = await c.req.json<Record<string, unknown>>().catch(() => null)
  if (!patch) return c.json({ error: 'Dados inválidos.' }, 400)
  const limpo: Record<string, unknown> = {}
  for (const k of CAMPOS_CONFIG) if (k in patch) limpo[k] = patch[k] === '' ? null : patch[k]
  if ('festival_name' in limpo && !limpo.festival_name) return c.json({ error: 'O nome do site é obrigatório.' }, 400)
  if (limpo.starts_at && limpo.ends_at && new Date(limpo.ends_at as string) < new Date(limpo.starts_at as string)) {
    return c.json({ error: 'O término é antes do início.' }, 400)
  }
  if (JSON.stringify(limpo).length > 200_000) return c.json({ error: 'Configurações grandes demais.' }, 400)
  const sql = getDb(c.env)
  for (const [k, v] of Object.entries(limpo)) {
    const json = ['brand', 'theme', 'nav', 'footer', 'social'].includes(k)
    if (json) await sql`update landing_site_settings set ${sql(k)} = ${sql.json((v ?? (k === 'nav' ? [] : {})) as never)} where id = 1`
    else await sql`update landing_site_settings set ${sql(k)} = ${v === null || v === undefined ? null : String(v)} where id = 1`
  }
  await sql`update landing_site_settings set updated_by = ${quem(c)} where id = 1`
  return c.json({ ok: true })
}

// ===== Mídia (R2, prefixo landing/; servida pela Área 01) =====

const MIME_OK = /^(image\/(png|jpeg|webp|gif|svg\+xml|avif)|video\/(mp4|webm)|application\/pdf|font\/(woff2|woff|ttf|otf))$/
const MAX_MIDIA = 50 * 1024 * 1024

// GET /landing/midia
export async function listarMidiaLanding(c: Context<AppEnv>) {
  const midia = await getDb(c.env)`select * from landing_media order by created_at desc limit 500`
  return c.json({ midia })
}

// POST /landing/midia (multipart: arquivo, pasta, nome, largura, altura)
export async function enviarMidiaLanding(c: Context<AppEnv>) {
  const corpo = await c.req.parseBody().catch(() => null)
  const arquivo = corpo?.arquivo
  if (!(arquivo instanceof File)) return c.json({ error: 'Envie um arquivo.' }, 400)
  if (arquivo.size <= 0 || arquivo.size > MAX_MIDIA) return c.json({ error: 'O arquivo precisa ter até 50 MB.' }, 400)
  const tipo = arquivo.type || 'application/octet-stream'
  if (!MIME_OK.test(tipo)) return c.json({ error: 'Tipo de arquivo não permitido.' }, 400)
  const pasta = slugify(String(corpo?.pasta ?? 'geral')) || 'geral'
  const nome = slugify(String(corpo?.nome ?? arquivo.name).replace(/\.[^.]+$/, '')) || 'arquivo'
  const ext = (arquivo.name.split('.').pop() ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'bin'
  const caminho = `${pasta}/${Date.now().toString(36)}-${nome}.${ext}`
  await c.env.CERTIFICACOES.put(`landing/${caminho}`, arquivo.stream(), { httpMetadata: { contentType: tipo, cacheControl: 'public, max-age=31536000, immutable' } })
  const url = `${c.env.AREA01_BACKEND_URL}/landing/midia/${caminho}`
  const n = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : null)
  const [item] = await getDb(c.env)`
    insert into landing_media (path, url, mime, size_bytes, width, height, alt, folder, created_by)
    values (${caminho}, ${url}, ${tipo}, ${arquivo.size}, ${n(corpo?.largura)}, ${n(corpo?.altura)}, ${nome.replace(/-/g, ' ')}, ${pasta}, ${quem(c)})
    returning *`
  return c.json(item, 201)
}

// PATCH /landing/midia/:id { alt, folder }
export async function atualizarMidiaLanding(c: Context<AppEnv>) {
  const b = await c.req.json<{ alt?: unknown; folder?: unknown }>().catch(() => null)
  const id = c.req.param('id') as string
  if (!b || !UUID.test(id)) return c.json({ error: 'Dados inválidos.' }, 400)
  const sql = getDb(c.env)
  if (typeof b.alt === 'string') await sql`update landing_media set alt = ${b.alt.slice(0, 500)} where id = ${id}`
  if (typeof b.folder === 'string') await sql`update landing_media set folder = ${slugify(b.folder) || 'geral'} where id = ${id}`
  return c.json({ ok: true })
}

// DELETE /landing/midia/:id
export async function excluirMidiaLanding(c: Context<AppEnv>) {
  const id = c.req.param('id') as string
  if (!UUID.test(id)) return c.json({ error: 'Arquivo não encontrado.' }, 404)
  const sql = getDb(c.env)
  const [m] = await sql`delete from landing_media where id = ${id} returning path`
  if (!m) return c.json({ error: 'Arquivo não encontrado.' }, 404)
  await c.env.CERTIFICACOES.delete(`landing/${m.path}`).catch(() => {})
  return c.json({ ok: true })
}

// ===== Inscritos (formulário de interesse) =====

function filtrosInscritos(sql: Sql, q: Record<string, string | undefined>) {
  const partes = [sql`true`]
  if (q.status && q.status !== 'todos') partes.push(sql`status = ${q.status}`)
  if (q.page === 'sem') partes.push(sql`page_id is null`)
  else if (q.page && q.page !== 'todas' && UUID.test(q.page)) partes.push(sql`page_id = ${q.page}`)
  if (q.de && /^\d{4}-\d{2}-\d{2}$/.test(q.de)) partes.push(sql`created_at >= ${`${q.de}T00:00:00-03:00`}::timestamptz`)
  if (q.ate && /^\d{4}-\d{2}-\d{2}$/.test(q.ate)) partes.push(sql`created_at <= ${`${q.ate}T23:59:59-03:00`}::timestamptz`)
  if (q.q) {
    const t = `%${q.q.slice(0, 100).replace(/[%_\\]/g, '\\$&')}%`
    partes.push(sql`(name ilike ${t} or email ilike ${t} or phone ilike ${t} or city ilike ${t} or message ilike ${t})`)
  }
  return partes.reduce((acc, p) => sql`${acc} and ${p}`)
}

// GET /landing/inscritos?q&status&page&de&ate
export async function listarInscritosLanding(c: Context<AppEnv>) {
  const sql = getDb(c.env)
  const q = c.req.query()
  const onde = filtrosInscritos(sql, q)
  const [lista, [total], contagem, paginas] = await Promise.all([
    sql`select * from landing_form_submissions where ${onde} order by created_at desc limit 1000`,
    sql`select count(*)::int as n from landing_form_submissions where ${onde}`,
    sql`select status, count(*)::int as n from landing_form_submissions group by status`,
    sql`select id, title from landing_pages order by sort_order`,
  ])
  const por_status = Object.fromEntries(contagem.map((r) => [r.status, r.n]))
  return c.json({ inscritos: lista, total: total.n, novos: por_status.novo ?? 0, por_status, paginas })
}

// PATCH /landing/inscritos/:id { status, notes }
export async function atualizarInscritoLanding(c: Context<AppEnv>) {
  const b = await c.req.json<{ status?: unknown; notes?: unknown }>().catch(() => null)
  const id = c.req.param('id') as string
  if (!b || !UUID.test(id)) return c.json({ error: 'Dados inválidos.' }, 400)
  const sql = getDb(c.env)
  if (b.status !== undefined) {
    if (!['novo', 'contatado', 'confirmado', 'descartado'].includes(String(b.status))) return c.json({ error: 'Situação inválida.' }, 400)
    await sql`update landing_form_submissions set status = ${String(b.status)} where id = ${id}`
  }
  if (b.notes !== undefined) await sql`update landing_form_submissions set notes = ${typeof b.notes === 'string' && b.notes.trim() ? b.notes.slice(0, 5000) : null} where id = ${id}`
  return c.json({ ok: true })
}

// DELETE /landing/inscritos/:id (LGPD)
export async function excluirInscritoLanding(c: Context<AppEnv>) {
  const id = c.req.param('id') as string
  if (!UUID.test(id)) return c.json({ error: 'Inscrito não encontrado.' }, 404)
  await getDb(c.env)`delete from landing_form_submissions where id = ${id}`
  return c.json({ ok: true })
}

// GET /landing/inscritos/csv
export async function csvInscritosLanding(c: Context<AppEnv>) {
  const sql = getDb(c.env)
  const lista = await sql`
    select s.*, p.title as pagina from landing_form_submissions s left join landing_pages p on p.id = s.page_id
    where ${filtrosInscritos(sql, c.req.query())} order by s.created_at desc limit 10000`
  const cel = (v: unknown) => {
    const t = v === null || v === undefined ? '' : Array.isArray(v) ? v.join('; ') : String(v)
    const seguro = /^[=+\-@\t\r]/.test(t) ? `'${t}` : t
    return `"${seguro.replace(/"/g, '""')}"`
  }
  const cab = ['Data', 'Nome', 'E-mail', 'WhatsApp', 'Cidade', 'Interesses', 'Como conheceu', 'Mensagem', 'Novidades', 'Página', 'Origem', 'Situação', 'Observações']
  const linhas = lista.map((s) =>
    [new Date(s.created_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }), s.name, s.email, s.phone, s.city, s.interests, s.heard_from, s.message,
      s.newsletter ? 'Sim' : 'Não', s.pagina, (s.utm as { source?: string })?.source ?? s.referrer, s.status, s.notes].map(cel).join(','),
  )
  return new Response('﻿' + [cab.map(cel).join(','), ...linhas].join('\n'), {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="inscritos-plura-${new Date().toISOString().slice(0, 10)}.csv"` },
  })
}

// ===== Métricas =====

// GET /landing/metricas?de=AAAA-MM-DD&ate=AAAA-MM-DD
export async function metricasLanding(c: Context<AppEnv>) {
  const de = c.req.query('de') ?? ''
  const ate = c.req.query('ate') ?? ''
  const hoje = new Date()
  const fim = /^\d{4}-\d{2}-\d{2}$/.test(ate) ? new Date(`${ate}T23:59:59-03:00`) : hoje
  const inicio = /^\d{4}-\d{2}-\d{2}$/.test(de) ? new Date(`${de}T00:00:00-03:00`) : new Date(hoje.getTime() - 29 * 86400000)
  const [r] = await getDb(c.env)`select landing_metrics_overview(${inicio.toISOString()}::timestamptz, ${new Date(fim.getTime() + 1000).toISOString()}::timestamptz) as m`
  return c.json(r.m)
}

// GET /landing/resumo (painel inicial: novos inscritos e páginas)
export async function resumoLanding(c: Context<AppEnv>) {
  const sql = getDb(c.env)
  const [[novos], [paginas], [visitas]] = await Promise.all([
    sql`select count(*)::int as n from landing_form_submissions where status = 'novo'`,
    sql`select count(*)::int as total, count(*) filter (where status = 'published')::int as publicadas from landing_pages`,
    sql`select count(*)::int as n, count(distinct session_hash)::int as pessoas from landing_page_views where created_at > now() - interval '7 days'`,
  ])
  return c.json({ novos: novos.n, paginas, visitas_7d: visitas.n, pessoas_7d: visitas.pessoas })
}
