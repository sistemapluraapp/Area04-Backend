import type postgres from 'postgres'
import { aplicarVariaveis, montarEmail } from './emailLayout'

export interface ModeloComunicacao {
  chave: string
  tipo: 'email' | 'pagina'
  nome: string
  descricao: string | null
  assunto: string | null
  titulo: string | null
  corpo_html: string | null
  botao_texto: string | null
  imagem_url: string | null
  imagem_link: string | null
  imagem_posicao: 'topo' | 'assinatura' | 'nenhuma'
  acao_estilo: 'botao' | 'imagem'
  atualizado_em: string
  atualizado_por: string | null
}

export const COLUNAS_MODELO =
  'chave, tipo, nome, descricao, assunto, titulo, corpo_html, botao_texto, imagem_url, imagem_link, imagem_posicao, acao_estilo, atualizado_em, atualizado_por'

export async function carregarModelo(sql: postgres.Sql, chave: string): Promise<ModeloComunicacao | null> {
  const [modelo] = await sql<ModeloComunicacao[]>`select ${sql.unsafe(COLUNAS_MODELO)} from modelos_comunicacao where chave = ${chave}`
  return modelo ?? null
}

export function renderizarModelo(
  modelo: ModeloComunicacao,
  variaveis: Record<string, string>,
  acao: { link?: string | null; codigo?: string | null },
): { assunto: string; html: string } {
  const titulo = aplicarVariaveis(modelo.titulo ?? modelo.nome, variaveis)
  // aplicarVariaveis escapa os valores; o título vai escapado de novo no layout
  const tituloTexto = titulo.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  const assunto = aplicarVariaveis(modelo.assunto ?? modelo.nome, variaveis).replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
  const html = montarEmail({
    titulo: tituloTexto,
    corpoHtml: aplicarVariaveis(modelo.corpo_html ?? '', variaveis),
    acao: acao.link ? { texto: modelo.botao_texto, link: acao.link } : null,
    codigo: acao.codigo ?? null,
    imagemUrl: modelo.imagem_url,
    imagemLink: modelo.imagem_link,
    imagemPosicao: modelo.imagem_posicao,
    acaoEstilo: modelo.acao_estilo,
    previa: assunto,
  })
  return { assunto, html }
}
