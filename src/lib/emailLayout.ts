// Layout padrão dos e-mails da Plura (compartilhado Áreas 02/03/04).
// HTML em tabelas e estilos inline: é o que os clientes de e-mail (Gmail,
// Outlook, Apple Mail) renderizam de forma consistente.

export const LOGO_PADRAO = 'https://plura.app.br/email/logo-plura.png'

export interface ConteudoEmail {
  titulo: string
  corpoHtml: string
  // Ação principal (link de confirmação, de acesso…)
  acao?: { texto: string | null; link: string } | null
  // Código numérico (verificação em duas etapas)
  codigo?: string | null
  imagemUrl?: string | null
  imagemLink?: string | null
  imagemPosicao?: 'topo' | 'assinatura' | 'nenhuma'
  // botao: botão estilizado; imagem: a imagem é o próprio link da ação
  acaoEstilo?: 'botao' | 'imagem'
  // Texto curto mostrado na prévia da caixa de entrada
  previa?: string
}

export function escaparHtml(texto: string): string {
  return texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

// {{nome}}, {{email}}… — valores entram escapados
export function aplicarVariaveis(texto: string, variaveis: Record<string, string>): string {
  return texto.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, chave: string) => escaparHtml(variaveis[chave] ?? ''))
}

// O corpo vem do editor rico do ADM; remove o que não pertence a um e-mail
function limparCorpo(html: string): string {
  return html
    .replace(/<\s*(script|style|iframe|object|embed|form)[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1="#"')
}

// Estilo dos elementos do editor rico, aplicado inline
function estilizarCorpo(html: string): string {
  return html
    // Itens de lista do editor vêm como <li><p>…</p></li>: tira o parágrafo interno
    .replace(/<li>\s*<p[^>]*>([\s\S]*?)<\/p>\s*<\/li>/gi, '<li>$1</li>')
    .replace(/<p(\s[^>]*)?>/gi, (_m, a = '') => `<p${a} style="margin:0 0 16px;${extrairAlinhamento(a)}">`)
    .replace(/<h3(\s[^>]*)?>/gi, (_m, a = '') => `<h3${a} style="margin:24px 0 8px;font-size:18px;color:#0b1220;${extrairAlinhamento(a)}">`)
    .replace(/<h4(\s[^>]*)?>/gi, (_m, a = '') => `<h4${a} style="margin:20px 0 8px;font-size:16px;color:#0b1220;${extrairAlinhamento(a)}">`)
    .replace(/<ul>/gi, '<ul style="margin:0 0 16px;padding-left:22px;">')
    .replace(/<ol>/gi, '<ol style="margin:0 0 16px;padding-left:22px;">')
    .replace(/<li>/gi, '<li style="margin:0 0 6px;">')
    .replace(/<a\s/gi, '<a style="color:#0062e6;text-decoration:underline;" ')
}

function extrairAlinhamento(atributos: string): string {
  const m = /text-align:\s*(left|center|right|justify)/i.exec(atributos)
  return m ? `text-align:${m[1]};` : ''
}

function blocoImagem(url: string, link: string | null, alt: string, assinatura: boolean): string {
  const img = `<img src="${escaparHtml(url)}" alt="${escaparHtml(alt)}" width="${assinatura ? 96 : 120}" style="display:block;border:0;outline:none;max-width:100%;height:auto;${assinatura ? '' : 'margin:0 auto;'}">`
  return link ? `<a href="${escaparHtml(link)}" target="_blank" style="display:inline-block;">${img}</a>` : img
}

export function montarEmail(c: ConteudoEmail): string {
  const posicao = c.imagemPosicao ?? 'topo'
  const estilo = c.acaoEstilo ?? 'botao'
  const imagem = c.imagemUrl ?? (posicao === 'nenhuma' ? null : LOGO_PADRAO)
  // Com estilo "imagem", clicar na imagem executa a ação
  const linkImagem = estilo === 'imagem' && c.acao ? c.acao.link : c.imagemLink ?? null

  const topo =
    imagem && posicao === 'topo'
      ? `<tr><td align="center" style="padding:32px 32px 0;">${blocoImagem(imagem, linkImagem, 'Plura', false)}</td></tr>`
      : ''
  const assinatura =
    imagem && posicao === 'assinatura'
      ? `<tr><td style="padding:8px 32px 0;">${blocoImagem(imagem, linkImagem, 'Plura', true)}</td></tr>`
      : ''

  const botao =
    c.acao && (estilo === 'botao' || !imagem || posicao === 'nenhuma')
      ? `<tr><td align="center" style="padding:8px 32px 24px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
            <td align="center" bgcolor="#0062e6" style="border-radius:12px;">
              <a href="${escaparHtml(c.acao.link)}" target="_blank" style="display:inline-block;padding:14px 28px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:12px;">${escaparHtml(c.acao.texto || 'Continuar')}</a>
            </td>
          </tr></table>
        </td></tr>`
      : ''

  const codigo = c.codigo
    ? `<tr><td align="center" style="padding:8px 32px 24px;">
        <div style="display:inline-block;padding:14px 24px;border-radius:12px;background:#eef4ff;font-family:'Courier New',monospace;font-size:28px;letter-spacing:6px;font-weight:bold;color:#0b1220;">${escaparHtml(c.codigo)}</div>
      </td></tr>`
    : ''

  const linkAlternativo = c.acao
    ? `<tr><td style="padding:0 32px 24px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:#5b6472;">
        Se o botão não funcionar, copie e cole este endereço no navegador:<br>
        <a href="${escaparHtml(c.acao.link)}" style="color:#0062e6;word-break:break-all;">${escaparHtml(c.acao.link)}</a>
      </td></tr>`
    : ''

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escaparHtml(c.titulo)}</title>
</head>
<body style="margin:0;padding:0;background:#f2f4f7;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escaparHtml(c.previa ?? c.titulo)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f2f4f7;">
  <tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;">
      ${topo}
      <tr><td style="padding:28px 32px 8px;font-family:Arial,Helvetica,sans-serif;">
        <h1 style="margin:0;font-size:24px;line-height:1.3;color:#0b1220;">${escaparHtml(c.titulo)}</h1>
      </td></tr>
      <tr><td style="padding:8px 32px 8px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6;color:#2b3340;">
        ${estilizarCorpo(limparCorpo(c.corpoHtml))}
      </td></tr>
      ${codigo}
      ${botao}
      ${linkAlternativo}
      ${assinatura}
      <tr><td style="padding:16px 32px 28px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:#5b6472;">
        Equipe Plura · <a href="https://plura.app.br" style="color:#0062e6;">plura.app.br</a><br>
        Este é um e-mail automático. Se você não reconhece esta mensagem, pode ignorá-la com segurança.
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`
}

// E-mails de aviso gerados pelo sistema (notificações), no mesmo layout
export function montarAviso(titulo: string, corpoHtml: string, acao?: { texto: string; link: string }): string {
  return montarEmail({ titulo, corpoHtml, acao: acao ?? null, previa: titulo })
}
