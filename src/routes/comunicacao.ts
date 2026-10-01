import type { Context } from 'hono'
import { getDb } from '../lib/db'
import { enviarEmailObrigatorio } from '../lib/email'
import { COLUNAS_MODELO, carregarModelo, renderizarModelo, type ModeloComunicacao } from '../lib/modelos'
import type { AppEnv } from '../types'

// E-mails e boas-vindas: modelos editáveis dos e-mails de autenticação e das
// páginas exibidas após a confirmação do cadastro.

type CorpoModelo = Partial<Pick<ModeloComunicacao, 'assunto' | 'titulo' | 'corpo_html' | 'botao_texto' | 'imagem_url' | 'imagem_link' | 'imagem_posicao' | 'acao_estilo'>>

const POSICOES = ['topo', 'assinatura', 'nenhuma'] as const
const ESTILOS = ['botao', 'imagem'] as const

function texto(valor: unknown, max: number, campo: string): { valor?: string | null; erro?: string } {
  if (valor === undefined) return {}
  if (valor === null || valor === '') return { valor: null }
  if (typeof valor !== 'string') return { erro: `${campo} deve ser texto` }
  const t = valor.trim()
  if (t.length > max) return { erro: `${campo} deve ter no máximo ${max} caracteres` }
  return { valor: t || null }
}

function urlHttps(valor: unknown, campo: string): { valor?: string | null; erro?: string } {
  const r = texto(valor, 500, campo)
  if (r.erro || !r.valor) return r
  if (!/^https:\/\//i.test(r.valor)) return { erro: `${campo} deve começar com https://` }
  return r
}

export async function listarModelos(c: Context<AppEnv>) {
  const sql = getDb(c.env)
  const modelos = await sql`select ${sql.unsafe(COLUNAS_MODELO)} from modelos_comunicacao order by tipo, nome`
  return c.json({ modelos })
}

export async function atualizarModelo(c: Context<AppEnv>) {
  const sql = getDb(c.env)
  const chave = c.req.param('chave') as string
  const body = await c.req.json<CorpoModelo>().catch(() => null)
  if (!body) return c.json({ error: 'Corpo da requisição inválido' }, 400)

  const campos = {
    assunto: texto(body.assunto, 200, 'Assunto'),
    titulo: texto(body.titulo, 200, 'Título'),
    corpo_html: texto(body.corpo_html, 20000, 'Texto'),
    botao_texto: texto(body.botao_texto, 80, 'Texto do botão'),
    imagem_url: urlHttps(body.imagem_url, 'Imagem'),
    imagem_link: urlHttps(body.imagem_link, 'Link da imagem'),
  }
  for (const r of Object.values(campos)) if (r.erro) return c.json({ error: r.erro }, 400)
  if (body.imagem_posicao !== undefined && !POSICOES.includes(body.imagem_posicao)) return c.json({ error: 'Posição da imagem inválida' }, 400)
  if (body.acao_estilo !== undefined && !ESTILOS.includes(body.acao_estilo)) return c.json({ error: 'Estilo da ação inválido' }, 400)

  const atual = await carregarModelo(sql, chave)
  if (!atual) return c.json({ error: 'Modelo não encontrado' }, 404)
  if (atual.tipo === 'email' && campos.assunto.valor === null) return c.json({ error: 'O e-mail precisa de um assunto' }, 400)

  const v = <K extends keyof typeof campos>(k: K) => (campos[k].valor === undefined ? atual[k] : campos[k].valor)
  const [modelo] = await sql`
    update modelos_comunicacao set
      assunto = ${v('assunto')},
      titulo = ${v('titulo')},
      corpo_html = ${v('corpo_html')},
      botao_texto = ${v('botao_texto')},
      imagem_url = ${v('imagem_url')},
      imagem_link = ${v('imagem_link')},
      imagem_posicao = ${body.imagem_posicao ?? atual.imagem_posicao},
      acao_estilo = ${body.acao_estilo ?? atual.acao_estilo},
      atualizado_em = now(),
      atualizado_por = ${c.get('userEmail') || null}
    where chave = ${chave}
    returning ${sql.unsafe(COLUNAS_MODELO)}
  `
  return c.json(modelo)
}

// Prévia com o rascunho ainda não salvo (o ADM manda os campos no corpo)
function mesclar(modelo: ModeloComunicacao, body: CorpoModelo | null): ModeloComunicacao {
  return { ...modelo, ...(body ?? {}) } as ModeloComunicacao
}

const EXEMPLO = { nome: 'Maria Silva', email: 'maria@exemplo.com.br' }
const LINK_EXEMPLO = 'https://plura.app.br/conta-confirmada'

export async function previaModelo(c: Context<AppEnv>) {
  const sql = getDb(c.env)
  const modelo = await carregarModelo(sql, c.req.param('chave') as string)
  if (!modelo) return c.json({ error: 'Modelo não encontrado' }, 404)
  if (modelo.tipo !== 'email') return c.json({ error: 'Prévia de e-mail só existe para modelos de e-mail' }, 400)
  const body = await c.req.json<CorpoModelo>().catch(() => null)
  const codigo = modelo.chave === 'email_codigo_verificacao' ? '482913' : null
  const { assunto, html } = renderizarModelo(mesclar(modelo, body), EXEMPLO, { link: codigo ? null : LINK_EXEMPLO, codigo })
  return c.json({ assunto, html })
}

export async function enviarTesteModelo(c: Context<AppEnv>) {
  const para = c.get('userEmail')
  if (!para) return c.json({ error: 'Seu usuário de administrador não tem e-mail cadastrado' }, 400)
  const sql = getDb(c.env)
  const modelo = await carregarModelo(sql, c.req.param('chave') as string)
  if (!modelo || modelo.tipo !== 'email') return c.json({ error: 'Modelo de e-mail não encontrado' }, 404)
  const body = await c.req.json<CorpoModelo>().catch(() => null)
  const codigo = modelo.chave === 'email_codigo_verificacao' ? '482913' : null
  const { assunto, html } = renderizarModelo(mesclar(modelo, body), { nome: 'Teste', email: para }, { link: codigo ? null : LINK_EXEMPLO, codigo })
  try {
    await enviarEmailObrigatorio(c.env.RESEND_API_KEY, para, `[Teste] ${assunto}`, html, c.env.EMAIL_REMETENTE)
  } catch (err) {
    return c.json({ error: `O Resend recusou o envio: ${err instanceof Error ? err.message : 'erro desconhecido'}` }, 502)
  }
  return c.json({ enviado_para: para })
}
