// Funcionalidades do painel: cada administrador recebe uma ou mais.
// São as colunas da matriz de permissões na tela "Administradores".
export const PERMISSOES = [
  { codigo: 'indicadores', rotulo: 'Indicadores, eventos e infraestrutura' },
  { codigo: 'moderacao', rotulo: 'Moderação' },
  { codigo: 'certificados', rotulo: 'Certificados' },
  { codigo: 'contas', rotulo: 'Contas e convites Gov' },
  { codigo: 'configuracoes', rotulo: 'Configurações (acessibilidade, catálogo, necessidades)' },
  { codigo: 'comunicacao', rotulo: 'E-mails, boas-vindas e termos' },
  { codigo: 'administradores', rotulo: 'Administradores e logs' },
] as const

export type Permissao = (typeof PERMISSOES)[number]['codigo']
export const CODIGOS_PERMISSAO = PERMISSOES.map((p) => p.codigo) as readonly string[]

// Prefixo da rota → permissão exigida. Rotas fora da lista (ex.: /me,
// /notificacoes) valem para qualquer administrador ativo.
const ROTAS: { prefixo: string; permissao: Permissao }[] = [
  { prefixo: '/indicadores', permissao: 'indicadores' },
  { prefixo: '/estatisticas', permissao: 'indicadores' },
  { prefixo: '/infraestrutura', permissao: 'indicadores' },
  { prefixo: '/eventos', permissao: 'indicadores' },
  { prefixo: '/comentarios', permissao: 'moderacao' },
  { prefixo: '/avaliacoes', permissao: 'moderacao' },
  { prefixo: '/denuncias', permissao: 'moderacao' },
  { prefixo: '/certificados', permissao: 'certificados' },
  { prefixo: '/contas', permissao: 'contas' },
  { prefixo: '/convites-gov', permissao: 'contas' },
  { prefixo: '/catalogo', permissao: 'configuracoes' },
  { prefixo: '/filtros', permissao: 'configuracoes' },
  { prefixo: '/grupos-acessibilidade', permissao: 'configuracoes' },
  { prefixo: '/comunicacao', permissao: 'comunicacao' },
  { prefixo: '/termos', permissao: 'comunicacao' },
  { prefixo: '/admins', permissao: 'administradores' },
  { prefixo: '/logs', permissao: 'administradores' },
]

export function permissaoDaRota(caminho: string): Permissao | null {
  return ROTAS.find((r) => caminho === r.prefixo || caminho.startsWith(`${r.prefixo}/`))?.permissao ?? null
}

// Texto do log ("o quê") a partir da rota e do corpo enviado
type Corpo = Record<string, unknown> | null
const t = (v: unknown) => (v === undefined || v === null || v === '' ? null : String(v).slice(0, 200))

const DESCRICOES: { metodo: string; padrao: RegExp; descrever: (m: RegExpMatchArray, b: Corpo, r: Corpo) => string }[] = [
  { metodo: 'PATCH', padrao: /^\/comentarios\/([^/]+)$/, descrever: (m, b) => `Moderou o comentário ${m[1]}: ${t(b?.status) ?? '—'}${t(b?.motivo) ? ` (motivo: ${t(b?.motivo)})` : ''}` },
  { metodo: 'PATCH', padrao: /^\/denuncias\/([^/]+)$/, descrever: (m, b) => `Atualizou a denúncia ${m[1]} para "${t(b?.status) ?? '—'}"` },
  { metodo: 'PATCH', padrao: /^\/certificados\/([^/]+)$/, descrever: (m, b) => `Avaliou o certificado ${m[1]}: ${t(b?.status) ?? '—'}${t(b?.motivo) ? ` (motivo: ${t(b?.motivo)})` : ''}` },
  { metodo: 'PATCH', padrao: /^\/contas\/(usuarios|gov|paginas)\/([^/]+)\/suspender$/, descrever: (m, _b, r) => `${r?.suspenso === false || r?.suspensa === false ? 'Reativou' : 'Suspendeu'} ${({ usuarios: 'o usuário', gov: 'a conta Gov', paginas: 'a página' } as Record<string, string>)[m[1]]} ${m[2]}` },
  { metodo: 'PATCH', padrao: /^\/contas\/(usuarios|gov)\/([^/]+)$/, descrever: (m, b) => `Alterou a UF ${m[1] === 'gov' ? 'da conta Gov' : 'do usuário'} ${m[2]} para ${t(b?.uf) ?? '—'}` },
  { metodo: 'DELETE', padrao: /^\/contas\/([^/]+)$/, descrever: (m) => `Excluiu a conta ${m[1]}` },
  { metodo: 'POST', padrao: /^\/convites-gov$/, descrever: (_m, b) => `Gerou convite Gov para ${t(b?.cidade) ?? '—'}${t(b?.uf) ? `/${t(b?.uf)}` : ''}${t(b?.pais) && b?.pais !== 'BR' ? ` (${t(b?.pais)})` : ''}${t(b?.email) ? `, enviado a ${t(b?.email)}` : ''}` },
  { metodo: 'POST', padrao: /^\/convites-gov\/([^/]+)\/reenviar$/, descrever: (m) => `Reenviou o convite Gov ${m[1].slice(0, 8)}…` },
  { metodo: 'DELETE', padrao: /^\/convites-gov\/([^/]+)$/, descrever: (m) => `Cancelou o convite Gov ${m[1].slice(0, 8)}…` },
  { metodo: 'POST', padrao: /^\/(catalogo|filtros|grupos-acessibilidade)$/, descrever: (m, b) => `Criou "${t(b?.rotulo) ?? '—'}" em ${rotuloConfig(m[1])}` },
  { metodo: 'PATCH', padrao: /^\/(catalogo|filtros)\/reordenar$/, descrever: (m) => `Reordenou ${rotuloConfig(m[1])}` },
  { metodo: 'PATCH', padrao: /^\/(catalogo|filtros|grupos-acessibilidade)\/([^/]+)$/, descrever: (m, b) => `Editou ${t(b?.rotulo) ? `"${t(b?.rotulo)}"` : m[2]} em ${rotuloConfig(m[1])}${resumoCampos(b)}` },
  { metodo: 'DELETE', padrao: /^\/(catalogo|filtros|grupos-acessibilidade)\/([^/]+)$/, descrever: (m) => `Excluiu ${m[2]} de ${rotuloConfig(m[1])}` },
  { metodo: 'PUT', padrao: /^\/comunicacao\/([^/]+)$/, descrever: (m) => `Editou o modelo de comunicação "${m[1]}"` },
  { metodo: 'POST', padrao: /^\/comunicacao\/([^/]+)\/teste$/, descrever: (m) => `Enviou um e-mail de teste do modelo "${m[1]}"` },
  { metodo: 'PUT', padrao: /^\/termos\/([^/]+)$/, descrever: (m) => `Editou o termo "${m[1]}"` },
  { metodo: 'PATCH', padrao: /^\/infraestrutura\/limites\/([^/]+)$/, descrever: (m, b) => `Alterou o limite de ${m[1]} para ${t(b?.limite) ?? '—'}` },
  { metodo: 'POST', padrao: /^\/admins\/convites$/, descrever: (_m, b) => `Convidou ${t(b?.nome) ?? ''} <${t(b?.email) ?? '—'}> como administrador (${listaPermissoes(b?.permissoes)})` },
  { metodo: 'POST', padrao: /^\/admins\/convites\/([^/]+)\/reenviar$/, descrever: (m) => `Reenviou o convite de administrador ${m[1]}` },
  { metodo: 'DELETE', padrao: /^\/admins\/convites\/([^/]+)$/, descrever: (m) => `Cancelou o convite de administrador ${m[1]}` },
  { metodo: 'PATCH', padrao: /^\/admins\/([^/]+)$/, descrever: (m, b) => `Alterou o administrador ${m[1]}:${b?.permissoes !== undefined ? ` permissões = ${listaPermissoes(b.permissoes)}` : ''}${b?.ativo !== undefined ? ` ${b.ativo ? 'reativado' : 'desativado'}` : ''}` },
]

function rotuloConfig(recurso: string) {
  return ({ catalogo: 'Catálogo', filtros: 'Necessidades/Recursos', 'grupos-acessibilidade': 'Grupos de acessibilidade' } as Record<string, string>)[recurso] ?? recurso
}

function resumoCampos(b: Corpo) {
  if (!b) return ''
  const campos = Object.keys(b).filter((k) => k !== 'rotulo')
  return campos.length ? ` (${campos.join(', ')})` : ''
}

function listaPermissoes(v: unknown) {
  if (!Array.isArray(v) || v.length === 0) return 'nenhuma permissão'
  return v.map((c) => PERMISSOES.find((p) => p.codigo === c)?.rotulo ?? String(c)).join(', ')
}

export function descreverAcao(metodo: string, caminho: string, corpo: Corpo, resposta: Corpo): string {
  for (const d of DESCRICOES) {
    if (d.metodo !== metodo) continue
    const m = caminho.match(d.padrao)
    if (m) return d.descrever(m, corpo, resposta)
  }
  return `${metodo} ${caminho}`
}
