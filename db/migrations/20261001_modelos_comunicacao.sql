-- Aplicada no grupo.01 (uoembacxxnkuwldmdgcu).
-- Modelos editáveis no ADM: e-mails de autenticação (enviados pelo hook
-- "Send Email" do Supabase → Área 04 → Resend) e as páginas exibidas depois
-- da confirmação do cadastro. Variáveis aceitas nos textos: {{nome}}, {{email}}.
create table if not exists public.modelos_comunicacao (
  chave text primary key check (chave ~ '^[a-z0-9_]+$'),
  tipo text not null check (tipo in ('email', 'pagina')),
  nome text not null,
  descricao text,
  assunto text check (char_length(assunto) <= 200),
  titulo text check (char_length(titulo) <= 200),
  corpo_html text check (char_length(corpo_html) <= 20000),
  botao_texto text check (char_length(botao_texto) <= 80),
  imagem_url text check (imagem_url is null or (char_length(imagem_url) <= 500 and imagem_url ~ '^https://')),
  imagem_link text check (imagem_link is null or (char_length(imagem_link) <= 500 and imagem_link ~ '^https://')),
  -- topo: banner/logo acima do texto; assinatura: no fim, como assinatura; nenhuma
  imagem_posicao text not null default 'topo' check (imagem_posicao in ('topo', 'assinatura', 'nenhuma')),
  -- botão: botão estilizado; imagem: a própria imagem é o link de ação
  acao_estilo text not null default 'botao' check (acao_estilo in ('botao', 'imagem')),
  atualizado_em timestamptz not null default now(),
  atualizado_por text
);

alter table public.modelos_comunicacao enable row level security;

-- As páginas de boas-vindas são públicas; os modelos de e-mail, não
create policy modelos_comunicacao_select_paginas on public.modelos_comunicacao
  for select to anon, authenticated using (tipo = 'pagina');
create policy area04_all_modelos_comunicacao on public.modelos_comunicacao
  for all to area04_backend using (true) with check (true);

grant select on public.modelos_comunicacao to anon, authenticated;
grant select, insert, update on public.modelos_comunicacao to area04_backend;

insert into public.modelos_comunicacao (chave, tipo, nome, descricao, assunto, titulo, corpo_html, botao_texto, imagem_url) values
('email_confirmacao_usuario', 'email', 'Confirmação de cadastro — Usuário', 'Enviado quando uma pessoa cria a conta na Plura (Área 01).',
 'Confirme seu cadastro na Plura', 'Boas-vindas à Plura, {{nome}}!',
 '<p>Que bom ter você com a gente! A Plura reúne lugares e experiências pensados para que todas as pessoas possam aproveitar com autonomia e segurança.</p><p>Para ativar sua conta, confirme seu e-mail no botão abaixo.</p>',
 'Confirmar meu e-mail', 'https://plura.app.br/email/logo-plura.png'),
('email_confirmacao_gov', 'email', 'Confirmação de cadastro — Gov', 'Enviado quando um órgão público cria a conta institucional pelo convite (Área 03).',
 'Confirme o cadastro institucional na Plura', 'Boas-vindas à Plura, {{nome}}!',
 '<p>Sua conta institucional foi criada. Com ela, você publica e mantém as páginas de atrativos e programas acessíveis do seu órgão.</p><p>Para ativar a conta, confirme seu e-mail no botão abaixo.</p>',
 'Confirmar e-mail institucional', 'https://plura.app.br/email/logo-plura.png'),
('email_recuperacao_senha', 'email', 'Recuperação de senha', 'Enviado quando alguém pede para redefinir a senha.',
 'Redefina sua senha da Plura', 'Vamos criar uma nova senha',
 '<p>Recebemos um pedido para redefinir a senha da conta {{email}}.</p><p>Se foi você, use o botão abaixo. Se não foi, ignore este e-mail: sua senha continua a mesma.</p>',
 'Redefinir senha', 'https://plura.app.br/email/logo-plura.png'),
('email_alteracao_email', 'email', 'Alteração de e-mail', 'Enviado para confirmar a troca do e-mail da conta.',
 'Confirme a alteração do seu e-mail na Plura', 'Confirme seu novo e-mail',
 '<p>Recebemos um pedido para alterar o e-mail da sua conta na Plura.</p><p>Confirme no botão abaixo para concluir a troca.</p>',
 'Confirmar alteração', 'https://plura.app.br/email/logo-plura.png'),
('email_link_acesso', 'email', 'Link de acesso', 'Enviado quando a pessoa entra por link mágico, sem senha.',
 'Seu link de acesso à Plura', 'Seu acesso está a um clique',
 '<p>Use o botão abaixo para entrar na sua conta. O link vale por pouco tempo e só pode ser usado uma vez.</p>',
 'Entrar na Plura', 'https://plura.app.br/email/logo-plura.png'),
('email_convite', 'email', 'Convite', 'Enviado quando a equipe convida alguém para a plataforma.',
 'Você foi convidado para a Plura', 'Você recebeu um convite',
 '<p>Você foi convidado para fazer parte da Plura. Aceite o convite no botão abaixo para criar seu acesso.</p>',
 'Aceitar convite', 'https://plura.app.br/email/logo-plura.png'),
('email_codigo_verificacao', 'email', 'Código de verificação', 'Enviado quando uma ação sensível pede confirmação por código.',
 'Seu código de verificação da Plura', 'Seu código de verificação',
 '<p>Use o código abaixo para confirmar a ação na sua conta. Ele vale por poucos minutos.</p>',
 null, 'https://plura.app.br/email/logo-plura.png'),
('pagina_confirmada_usuario', 'pagina', 'Página de boas-vindas — Usuário', 'Exibida em plura.app.br depois que a pessoa confirma o e-mail.',
 null, 'Conta confirmada!',
 '<p>Seu e-mail foi confirmado e sua conta na Plura já está ativa.</p><p>Agora você pode salvar seus lugares favoritos, avaliar experiências e receber novidades sobre acessibilidade.</p>',
 'Entrar na minha conta', null),
('pagina_confirmada_gov', 'pagina', 'Página de boas-vindas — Gov', 'Exibida em gov.plura.app.br depois que o órgão confirma o e-mail.',
 null, 'Conta institucional confirmada!',
 '<p>O e-mail foi confirmado e a conta institucional já está ativa.</p><p>Entre para criar a primeira página do seu órgão ou atrativo.</p>',
 'Entrar na área institucional', null)
on conflict (chave) do nothing;
