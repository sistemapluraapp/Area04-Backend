// Remetente padrão até o domínio plura.app.br ser verificado no Resend.
// Depois, basta trocar EMAIL_REMETENTE no wrangler.toml.
export const REMETENTE_PADRAO = 'Plura <onboarding@resend.dev>'

async function postarResend(apiKey: string, remetente: string, to: string, subject: string, html: string) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: remetente, to: [to], subject, html }),
  })
  if (!res.ok) throw new Error(`Resend respondeu ${res.status}: ${(await res.text()).slice(0, 300)}`)
}

// Avisos: falha ao enviar e-mail não deve quebrar o fluxo principal
export async function enviarEmail(apiKey: string, to: string, subject: string, html: string, remetente = REMETENTE_PADRAO) {
  try {
    await postarResend(apiKey, remetente, to, subject, html)
  } catch (err) {
    console.error('Falha ao enviar e-mail:', err)
  }
}

// E-mails essenciais (confirmação de conta, senha): a falha precisa aparecer
export async function enviarEmailObrigatorio(apiKey: string, to: string, subject: string, html: string, remetente = REMETENTE_PADRAO) {
  await postarResend(apiKey, remetente, to, subject, html)
}
