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
