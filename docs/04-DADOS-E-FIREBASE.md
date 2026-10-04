# 04 — Dados e Firebase

## Firestore
Banco-alvo da Conta FINNOS: Cloud Firestore.

Domínios previstos: users, spaces, accounts, cards, transactions, categories, budgets/budgetCycles, subscriptions, goals, investments e settings.

## Espaços
Preparar o modelo para `space_id`/workspace. O espaço inicial é **Pessoal**. Isso permite expansão futura sem redesenhar a propriedade de cada transação.

## Regras
Todo dado financeiro deve possuir proprietário/espaço verificável. Consultas e mutações nunca podem autorizar acesso apenas pelo ID do documento.

## Migração MongoDB
1. modelar Firestore;
2. implementar Auth;
3. integrar validação Firebase no FastAPI;
4. migrar domínio por domínio;
5. testar equivalência;
6. planejar migração de dados existentes;
7. somente então desativar MongoDB.

Não manter duas fontes de verdade indefinidamente.

## Ferramenta de migração inicial

Script: `backend/scripts/migrate_mongodb_to_firestore.py`.

- O padrão é **dry-run**: conta os documentos e não grava nada.
- A execução exige `--execute`, credenciais de serviço Firebase no ambiente e `FIREBASE_PROJECT_ID`.
- A ferramenta usa uma lista permitida de coleções e IDs estáveis para permitir repetição sem duplicar documentos.
- MongoDB não é apagado nem alterado.
- Sessões, hashes de senha/códigos de confirmação e chaves de API de IA são excluídos intencionalmente.
- Perfis de usuário são copiados sem material de autenticação e marcados para migração de identidade separada.
- Documentos preservam `user_id` legado; a ligação entre IDs antigos e Firebase UID precisa ser planejada antes de mudar a autenticação.
- Após a cópia, comparar contagens e amostras por coleção, validar referências entre contas/cartões/categorias/transações e testar isolamento entre usuários.

## Bloqueio antes de produção

A cópia de dados não significa que o aplicativo já usa Firestore. Os endpoints atuais ainda leem e gravam MongoDB. O cutover só pode ocorrer depois de adaptar e testar os repositórios/serviços do backend, validar Firebase Authentication e preparar rollback. Nunca colocar credenciais de serviço no frontend ou no repositório.
