import type { Context } from 'hono'
import { getDb } from '../lib/db'
import type { AppEnv } from '../types'

// Etapa 8a: certificações configuradas pelo ADM.
// Certificação → etapas (sequenciais ou paralelas) → requisitos.
// A estrutura (etapas + requisitos) é salva inteira de uma vez pelo editor.

const ESCOPOS = ['b2b', 'b2g', 'ambos'] as const
const STATUS = ['rascunho', 'publicada', 'arquivada'] as const
const MODOS = ['sequencial', 'paralela'] as const
export const TIPOS_REQUISITO = ['arquivo', 'texto', 'formulario', 'link', 'video', 'vistoria'] as const
const TIPOS_CAMPO = ['texto_curto', 'texto_longo', 'numero', 'data', 'sim_nao', 'opcoes'] as const
const TIPOS_BLOCO = ['titulo', 'texto', 'imagem', 'link'] as const

const COLUNAS =
  'id, titulo, resumo, descricao, imagem_url, icone, escopo, pais, uf, cidade, validade_meses, status, gratuita, preco_centavos, ordem, created_at, updated_at'

type Resultado<T> = { valor: T; erro?: undefined } | { erro: string; valor?: undefined }

function texto(valor: unknown, max: number, campo: string, obrigatorio = false): Resultado<string | null> {
  if (valor === undefined || valor === null || valor === '') {
    return obrigatorio ? { erro: `${campo} é obrigatório` } : { valor: null }
  }
  if (typeof valor !== 'string') return { erro: `${campo} deve ser texto` }
  const t = valor.trim()
  if (obrigatorio && !t) return { erro: `${campo} é obrigatório` }
  if (t.length > max) return { erro: `${campo} deve ter no máximo ${max} caracteres` }
  return { valor: t || null }
}

function urlHttps(valor: unknown, campo: string): Resultado<string | null> {
  const r = texto(valor, 500, campo)
  if (r.erro !== undefined || !r.valor) return r
  if (!/^https:\/\//i.test(r.valor)) return { erro: `${campo} deve começar com https://` }
  return r
}

interface CertificacaoBody {
  titulo?: unknown
  resumo?: unknown
  descricao?: unknown
  imagem_url?: unknown
  icone?: unknown
  escopo?: unknown
  pais?: unknown
  uf?: unknown
  cidade?: unknown
  validade_meses?: unknown
  status?: unknown
  ordem?: unknown
}

// Monta os campos válidos do corpo (parcial no PATCH, completo no POST)
function montarCampos(body: CertificacaoBody, criando: boolean): Resultado<Record<string, unknown>> {
  const campos: Record<string, unknown> = {}
  const usar = <T>(nome: string, r: Resultado<T>) => {
    if (r.erro !== undefined) throw new Error(r.erro)
    campos[nome] = r.valor
  }
  try {
    if (criando || body.titulo !== undefined) usar('titulo', texto(body.titulo, 120, 'Título', true))
    if (body.resumo !== undefined) usar('resumo', texto(body.resumo, 300, 'Resumo'))
    if (body.descricao !== undefined) usar('descricao', texto(body.descricao, 20000, 'Descrição'))
    if (body.imagem_url !== undefined) usar('imagem_url', urlHttps(body.imagem_url, 'Imagem'))
    if (body.icone !== undefined) usar('icone', texto(body.icone, 80, 'Ícone'))
    if (body.escopo !== undefined) {
      if (!ESCOPOS.includes(body.escopo as never)) throw new Error('Público deve ser: b2b, b2g ou ambos')
      campos.escopo = body.escopo
    }
    if (body.pais !== undefined) usar('pais', texto(body.pais, 2, 'País', true))
    if (body.uf !== undefined) usar('uf', texto(body.uf, 60, 'Estado'))
    if (body.cidade !== undefined) usar('cidade', texto(body.cidade, 100, 'Cidade'))
    if (campos.cidade && body.uf !== undefined && !campos.uf) throw new Error('Para escolher a cidade, informe também o estado')
    if (body.validade_meses !== undefined) {
      const v = body.validade_meses === null || body.validade_meses === '' ? null : Number(body.validade_meses)
      if (v !== null && (!Number.isInteger(v) || v < 1 || v > 120)) throw new Error('Validade deve ser de 1 a 120 meses (ou vazia, para não vencer)')
      campos.validade_meses = v
    }
    if (body.status !== undefined) {
      if (!STATUS.includes(body.status as never)) throw new Error('Situação deve ser: rascunho, publicada ou arquivada')
      campos.status = body.status
    }
    if (body.ordem !== undefined) {
      const o = Number(body.ordem)
      if (!Number.isInteger(o)) throw new Error('Ordem inválida')
      campos.ordem = o
    }
  } catch (e) {
    return { erro: e instanceof Error ? e.message : 'Dados inválidos' }
  }
  return { valor: campos }
}

export async function listarCertificacoes(c: Context<AppEnv>) {
  const sql = getDb(c.env)
  const certificacoes = await sql`
    select ${sql.unsafe(COLUNAS.split(', ').map((col) => `c.${col}`).join(', '))},
      (select count(*)::int from certificacao_etapas e where e.certificacao_id = c.id) as total_etapas,
      (select count(*)::int from certificacao_requisitos r join certificacao_etapas e on e.id = r.etapa_id where e.certificacao_id = c.id) as total_requisitos
    from certificacoes c
    order by case c.status when 'publicada' then 0 when 'rascunho' then 1 else 2 end, c.ordem, c.titulo
  `
  return c.json({ certificacoes })
}

export async function obterCertificacao(c: Context<AppEnv>) {
  const sql = getDb(c.env)
  const id = c.req.param('id') as string
  const [certificacao] = await sql`select ${sql.unsafe(COLUNAS)} from certificacoes where id = ${id}`
  if (!certificacao) return c.json({ error: 'Certificação não encontrada' }, 404)
  const etapas = await sql`select id, titulo, descricao, modo, ordem from certificacao_etapas where certificacao_id = ${id} order by ordem`
  const requisitos = await sql`
    select r.id, r.etapa_id, r.titulo, r.descricao, r.tipo, r.obrigatorio, r.config, r.ordem
    from certificacao_requisitos r join certificacao_etapas e on e.id = r.etapa_id
    where e.certificacao_id = ${id} order by r.ordem
  `
  return c.json({
    ...certificacao,
    etapas: etapas.map((e) => ({ ...e, requisitos: requisitos.filter((r) => r.etapa_id === e.id) })),
  })
}

export async function criarCertificacao(c: Context<AppEnv>) {
  const sql = getDb(c.env)
  const body = await c.req.json<CertificacaoBody>().catch(() => null)
  if (!body) return c.json({ error: 'Corpo da requisição inválido' }, 400)
  const r = montarCampos(body, true)
  if (r.erro !== undefined) return c.json({ error: r.erro }, 400)
  const [certificacao] = await sql`insert into certificacoes ${sql(r.valor)} returning ${sql.unsafe(COLUNAS)}`
  return c.json({ ...certificacao, etapas: [] }, 201)
}

export async function atualizarCertificacao(c: Context<AppEnv>) {
  const sql = getDb(c.env)
  const id = c.req.param('id') as string
  const body = await c.req.json<CertificacaoBody>().catch(() => null)
  if (!body) return c.json({ error: 'Corpo da requisição inválido' }, 400)
  const r = montarCampos(body, false)
  if (r.erro !== undefined) return c.json({ error: r.erro }, 400)
  if (Object.keys(r.valor).length === 0) return c.json({ error: 'Nada para atualizar' }, 400)

  if (r.valor.status === 'publicada') {
    const [{ total }] = await sql`
      select count(*)::int as total from certificacao_requisitos q join certificacao_etapas e on e.id = q.etapa_id
      where e.certificacao_id = ${id}
    `
    if (total === 0) return c.json({ error: 'Para publicar, crie ao menos uma etapa com um requisito' }, 400)
  }

  const [certificacao] = await sql`
    update certificacoes set ${sql({ ...r.valor, updated_at: new Date() })}
    where id = ${id}
    returning ${sql.unsafe(COLUNAS)}
  `
  if (!certificacao) return c.json({ error: 'Certificação não encontrada' }, 404)
  return c.json(certificacao)
}

export async function excluirCertificacao(c: Context<AppEnv>) {
  const sql = getDb(c.env)
  const id = c.req.param('id') as string
  const [cert] = await sql`select status from certificacoes where id = ${id}`
  if (!cert) return c.json({ error: 'Certificação não encontrada' }, 404)
  if (cert.status === 'publicada') return c.json({ error: 'Arquive a certificação antes de excluir (ela está publicada)' }, 400)
  await sql`delete from certificacoes where id = ${id}`
  return c.body(null, 204)
}

// ---------- Estrutura: etapas e requisitos ----------

interface CampoFormulario {
  rotulo: string
  tipo: (typeof TIPOS_CAMPO)[number]
  obrigatorio: boolean
  opcoes?: string[]
}

function validarConfig(tipo: string, config: unknown): Resultado<Record<string, unknown>> {
  const cfg = (config && typeof config === 'object' ? config : {}) as Record<string, unknown>
  if (tipo === 'formulario') {
    const campos = Array.isArray(cfg.campos) ? cfg.campos : []
    if (campos.length === 0) return { erro: 'Formulário precisa de ao menos um campo' }
    if (campos.length > 30) return { erro: 'Formulário pode ter no máximo 30 campos' }
    const limpos: CampoFormulario[] = []
    for (const campo of campos as Record<string, unknown>[]) {
      const rotulo = texto(campo?.rotulo, 120, 'Pergunta do formulário', true)
      if (rotulo.erro !== undefined) return { erro: rotulo.erro }
      if (!TIPOS_CAMPO.includes(campo.tipo as never)) return { erro: `Tipo de campo inválido na pergunta "${rotulo.valor}"` }
      const item: CampoFormulario = { rotulo: rotulo.valor as string, tipo: campo.tipo as CampoFormulario['tipo'], obrigatorio: campo.obrigatorio !== false }
      if (item.tipo === 'opcoes') {
        const opcoes = (Array.isArray(campo.opcoes) ? campo.opcoes : []).map((o) => String(o).trim()).filter(Boolean).slice(0, 20)
        if (opcoes.length < 2) return { erro: `A pergunta "${item.rotulo}" precisa de ao menos 2 opções` }
        item.opcoes = opcoes
      }
      limpos.push(item)
    }
    return { valor: { campos: limpos } }
  }
  if (tipo === 'arquivo') {
    const max = cfg.max_arquivos === undefined ? 1 : Number(cfg.max_arquivos)
    if (!Number.isInteger(max) || max < 1 || max > 10) return { erro: 'Arquivos por requisito: de 1 a 10' }
    return { valor: { max_arquivos: max } }
  }
  return { valor: {} }
}

interface RequisitoBody {
  id?: string
  titulo?: unknown
  descricao?: unknown
  tipo?: unknown
  obrigatorio?: unknown
  config?: unknown
}
interface EtapaBody {
  id?: string
  titulo?: unknown
  descricao?: unknown
  modo?: unknown
  requisitos?: RequisitoBody[]
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Literal de array do Postgres ('{a,b}'): com fetch_types desligado (Hyperdrive),
// o postgres.js não serializa arrays JS como parâmetro. Só recebe ids já validados.
function arrayUuid(ids: string[]) {
  return `{${ids.filter((id) => UUID.test(id)).join(',')}}`
}

export async function salvarEstrutura(c: Context<AppEnv>) {
  const sql = getDb(c.env)
  const certificacaoId = c.req.param('id') as string
  const body = await c.req.json<{ etapas?: EtapaBody[] }>().catch(() => null)
  if (!body || !Array.isArray(body.etapas)) return c.json({ error: 'Campo obrigatório: etapas' }, 400)
  if (body.etapas.length > 30) return c.json({ error: 'Máximo de 30 etapas' }, 400)

  // Valida tudo antes de gravar
  const etapas: { id: string | null; titulo: string; descricao: string | null; modo: string; requisitos: { id: string | null; titulo: string; descricao: string | null; tipo: string; obrigatorio: boolean; config: Record<string, unknown> }[] }[] = []
  for (const [i, e] of body.etapas.entries()) {
    const titulo = texto(e.titulo, 120, `Título da etapa ${i + 1}`, true)
    if (titulo.erro !== undefined) return c.json({ error: titulo.erro }, 400)
    const descricao = texto(e.descricao, 2000, `Descrição da etapa ${i + 1}`)
    if (descricao.erro !== undefined) return c.json({ error: descricao.erro }, 400)
    // A primeira etapa sempre começa sozinha
    const modo = i === 0 ? 'sequencial' : MODOS.includes(e.modo as never) ? (e.modo as string) : 'sequencial'
    const requisitos = []
    const lista = Array.isArray(e.requisitos) ? e.requisitos : []
    if (lista.length > 40) return c.json({ error: `A etapa "${titulo.valor}" pode ter no máximo 40 requisitos` }, 400)
    for (const [j, q] of lista.entries()) {
      const tituloQ = texto(q.titulo, 160, `Requisito ${j + 1} da etapa "${titulo.valor}"`, true)
      if (tituloQ.erro !== undefined) return c.json({ error: tituloQ.erro }, 400)
      const descricaoQ = texto(q.descricao, 2000, `Descrição do requisito "${tituloQ.valor}"`)
      if (descricaoQ.erro !== undefined) return c.json({ error: descricaoQ.erro }, 400)
      if (!TIPOS_REQUISITO.includes(q.tipo as never)) return c.json({ error: `Tipo inválido no requisito "${tituloQ.valor}"` }, 400)
      const config = validarConfig(q.tipo as string, q.config)
      if (config.erro !== undefined) return c.json({ error: `${tituloQ.valor}: ${config.erro}` }, 400)
      requisitos.push({
        id: typeof q.id === 'string' && UUID.test(q.id) ? q.id : null,
        titulo: tituloQ.valor as string,
        descricao: descricaoQ.valor,
        tipo: q.tipo as string,
        obrigatorio: q.obrigatorio !== false,
        config: config.valor,
      })
    }
    etapas.push({ id: typeof e.id === 'string' && UUID.test(e.id) ? e.id : null, titulo: titulo.valor as string, descricao: descricao.valor, modo, requisitos })
  }

  const [existe] = await sql`select 1 from certificacoes where id = ${certificacaoId}`
  if (!existe) return c.json({ error: 'Certificação não encontrada' }, 404)

  await sql.begin(async (tx) => {
    const atuais = await tx`select id from certificacao_etapas where certificacao_id = ${certificacaoId}`
    const idsAtuais = new Set(atuais.map((e) => e.id as string))
    const etapasMantidas: string[] = []
    const requisitosMantidos: string[] = []

    for (const [i, e] of etapas.entries()) {
      let etapaId: string
      if (e.id && idsAtuais.has(e.id)) {
        await tx`update certificacao_etapas set titulo = ${e.titulo}, descricao = ${e.descricao}, modo = ${e.modo}, ordem = ${i} where id = ${e.id}`
        etapaId = e.id
      } else {
        const [nova] = await tx`
          insert into certificacao_etapas (certificacao_id, titulo, descricao, modo, ordem)
          values (${certificacaoId}, ${e.titulo}, ${e.descricao}, ${e.modo}, ${i}) returning id
        `
        etapaId = nova.id as string
      }
      etapasMantidas.push(etapaId)

      for (const [j, q] of e.requisitos.entries()) {
        // Requisito existente (mesmo que tenha mudado de etapa) é atualizado; os novos são criados
        const [atualizado] = q.id
          ? await tx`
              update certificacao_requisitos r set etapa_id = ${etapaId}, titulo = ${q.titulo}, descricao = ${q.descricao},
                tipo = ${q.tipo}, obrigatorio = ${q.obrigatorio}, config = ${tx.json(q.config as never)}, ordem = ${j}
              from certificacao_etapas e
              where r.id = ${q.id} and e.id = r.etapa_id and e.certificacao_id = ${certificacaoId}
              returning r.id
            `
          : []
        if (atualizado) {
          requisitosMantidos.push(atualizado.id as string)
        } else {
          const [novo] = await tx`
            insert into certificacao_requisitos (etapa_id, titulo, descricao, tipo, obrigatorio, config, ordem)
            values (${etapaId}, ${q.titulo}, ${q.descricao}, ${q.tipo}, ${q.obrigatorio}, ${tx.json(q.config as never)}, ${j})
            returning id
          `
          requisitosMantidos.push(novo.id as string)
        }
      }
    }

    // Remove o que saiu da estrutura
    await tx`
      delete from certificacao_requisitos r using certificacao_etapas e
      where e.id = r.etapa_id and e.certificacao_id = ${certificacaoId}
        and not (r.id = any(${arrayUuid(requisitosMantidos)}::uuid[]))
    `
    await tx`
      delete from certificacao_etapas
      where certificacao_id = ${certificacaoId} and not (id = any(${arrayUuid(etapasMantidas)}::uuid[]))
    `
    await tx`update certificacoes set updated_at = now() where id = ${certificacaoId}`
  })

  return obterCertificacao(c)
}

// ---------- Página "Buscar certificações" ----------

interface Bloco {
  tipo: (typeof TIPOS_BLOCO)[number]
  texto?: string | null
  html?: string | null
  url?: string | null
  alt?: string | null
}

export async function obterPaginaCertificacoes(c: Context<AppEnv>) {
  const sql = getDb(c.env)
  const [pagina] = await sql`select titulo, subtitulo, blocos, atualizado_em, atualizado_por from certificacoes_pagina where id = 1`
  return c.json(pagina ?? { titulo: 'Certificações de acessibilidade', subtitulo: null, blocos: [] })
}

export async function salvarPaginaCertificacoes(c: Context<AppEnv>) {
  const sql = getDb(c.env)
  const body = await c.req.json<{ titulo?: unknown; subtitulo?: unknown; blocos?: unknown }>().catch(() => null)
  if (!body) return c.json({ error: 'Corpo da requisição inválido' }, 400)
  const titulo = texto(body.titulo, 120, 'Título', true)
  if (titulo.erro !== undefined) return c.json({ error: titulo.erro }, 400)
  const subtitulo = texto(body.subtitulo, 300, 'Subtítulo')
  if (subtitulo.erro !== undefined) return c.json({ error: subtitulo.erro }, 400)

  const blocos: Bloco[] = []
  const lista = Array.isArray(body.blocos) ? (body.blocos as Record<string, unknown>[]) : []
  if (lista.length > 30) return c.json({ error: 'A página pode ter no máximo 30 blocos' }, 400)
  for (const [i, b] of lista.entries()) {
    const n = i + 1
    if (!TIPOS_BLOCO.includes(b?.tipo as never)) return c.json({ error: `Bloco ${n}: tipo inválido` }, 400)
    const tipo = b.tipo as Bloco['tipo']
    if (tipo === 'titulo') {
      const t = texto(b.texto, 160, `Bloco ${n} (título)`, true)
      if (t.erro !== undefined) return c.json({ error: t.erro }, 400)
      blocos.push({ tipo, texto: t.valor })
    } else if (tipo === 'texto') {
      const h = texto(b.html, 20000, `Bloco ${n} (texto)`, true)
      if (h.erro !== undefined) return c.json({ error: h.erro }, 400)
      blocos.push({ tipo, html: h.valor })
    } else if (tipo === 'imagem') {
      const u = urlHttps(b.url, `Bloco ${n} (imagem)`)
      if (u.erro !== undefined) return c.json({ error: u.erro }, 400)
      if (!u.valor) return c.json({ error: `Bloco ${n}: informe o endereço da imagem` }, 400)
      const alt = texto(b.alt, 300, `Bloco ${n} (descrição da imagem)`, true)
      if (alt.erro !== undefined) return c.json({ error: `${alt.erro}: ela é lida por quem usa leitor de tela` }, 400)
      blocos.push({ tipo, url: u.valor, alt: alt.valor })
    } else {
      const u = urlHttps(b.url, `Bloco ${n} (link)`)
      if (u.erro !== undefined) return c.json({ error: u.erro }, 400)
      if (!u.valor) return c.json({ error: `Bloco ${n}: informe o endereço do link` }, 400)
      const t = texto(b.texto, 120, `Bloco ${n} (texto do link)`, true)
      if (t.erro !== undefined) return c.json({ error: t.erro }, 400)
      blocos.push({ tipo, url: u.valor, texto: t.valor })
    }
  }

  const [pagina] = await sql`
    insert into certificacoes_pagina (id, titulo, subtitulo, blocos, atualizado_em, atualizado_por)
    values (1, ${titulo.valor}, ${subtitulo.valor}, ${sql.json(blocos as never)}, now(), ${c.get('userEmail') || null})
    on conflict (id) do update set titulo = excluded.titulo, subtitulo = excluded.subtitulo, blocos = excluded.blocos,
      atualizado_em = now(), atualizado_por = excluded.atualizado_por
    returning titulo, subtitulo, blocos, atualizado_em, atualizado_por
  `
  return c.json(pagina)
}
