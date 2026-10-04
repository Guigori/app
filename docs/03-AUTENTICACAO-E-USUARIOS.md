# 03 — Autenticação e Usuários

## Alvo
Firebase Authentication será a fonte de identidade da Conta FINNOS.

Provedores previstos:
- e-mail/senha;
- Google;
- Apple.

## Backend
FastAPI deve receber token Firebase, validar assinatura/claims com SDK oficial no servidor e derivar o `uid` autenticado. Nunca confiar em `user_id` enviado pelo cliente para autorização.

## Modo Local
Não exige Conta FINNOS. O usuário deve conseguir utilizar o produto sem criar identidade remota, respeitadas as limitações de sincronização entre plataformas.

## Migração
Atualmente existem cadastro, confirmação de e-mail, login e sessões próprias no FastAPI/MongoDB. São componentes legados até a migração Firebase ser validada.

## Critérios antes de produção real
Cadastro, login, logout, recuperação, verificação, Google/Apple quando habilitados, expiração/revogação de sessão e isolamento entre dois usuários devem ser testados.
