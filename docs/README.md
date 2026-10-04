# FINNOS Web — Documentação Oficial

> Estado: documentação inicial criada em 04/10/2026.  
> Regra: distinguir sempre **Implementado**, **Em migração** e **Planejado**.

## Objetivo
FINNOS é um aplicativo de finanças pessoais Web/PWA com experiência desktop e mobile. O produto oferece dois modos: **Local** e **Conta FINNOS**.

## Arquitetura-alvo
- Frontend: React + TypeScript + Vite.
- Autenticação da Conta FINNOS: Firebase Authentication.
- Dados em nuvem: Cloud Firestore.
- Proteção do cliente: Firebase App Check.
- Backend: FastAPI/Python para regras de negócio e operações sensíveis.
- Modo Local: armazenamento no dispositivo, independente da Conta FINNOS.
- Backup: iCloud Drive e/ou Google Drive, opt-in e independente do modo.
- Importação/exportação: disponível nos dois modos.
- Apple Pay/Atalhos: integração planejada para captura de transações; limitações Web/PWA devem ser validadas antes da implementação.

## Arquitetura atual/legada
Hoje o código possui FastAPI + MongoDB e autenticação/sessões próprias. MongoDB é **legado em migração** e não deve ser removido antes da equivalência funcional e dos testes com Firebase.

## Índice
1. [Visão geral](01-VISAO-GERAL.md)
2. [Arquitetura](02-ARQUITETURA.md)
3. [Autenticação e usuários](03-AUTENTICACAO-E-USUARIOS.md)
4. [Dados e Firebase](04-DADOS-E-FIREBASE.md)
5. [Modo Local](05-MODO-LOCAL.md)
6. [Segurança](06-SEGURANCA.md)
7. [Backup, importação e exportação](07-BACKUP-IMPORTACAO-EXPORTACAO.md)
8. [Apple e Atalhos](08-APPLE-E-ATALHOS.md)
9. [UX/UI e Design System](09-UX-UI-DESIGN-SYSTEM.md)
10. [Funcionalidades](10-FUNCIONALIDADES.md)
11. [Deploy e ambientes](11-DEPLOY-E-AMBIENTES.md)
12. [Roadmap](12-ROADMAP.md)

## Princípios
Privacidade por padrão; menor privilégio; isolamento entre usuários; nenhum segredo no frontend; dados locais não devem ser enviados à nuvem sem ação/consentimento compatível com o modo escolhido; mudanças de arquitetura devem atualizar estes documentos.
