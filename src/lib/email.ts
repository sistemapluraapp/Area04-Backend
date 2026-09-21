export async function enviarEmail(apiKey: string, to: string, subject: string, html: string) {
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'Plura <onboarding@resend.dev>', to: [to], subject, html }),
    })
  } catch {
    // falha ao enviar e-mail não deve quebrar o fluxo principal
  }
}
