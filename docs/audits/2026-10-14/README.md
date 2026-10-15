# FINNOS — Auditoria linha a linha do código MongoDB legado × Firestore ativo

**Data:** 14/10/2026  
**Repositório:** [Guigori/app](https://github.com/Guigori/app)  
**Referência de comparação:** `main` após os commits [9304ffb](https://github.com/Guigori/app/commit/9304ffb9e320498b1712daf96562dc4036cf0d11) e [9372c3b](https://github.com/Guigori/app/commit/9372c3bfe5c62e5b40d0e062d253888ea02a4a01).  
**Escopo:** análise estática do código de repositório e testes GitHub CI; **não** houve acesso a dados reais, MongoDB Atlas, identidade de usuários ou console Firestore. A comparação **não prova migração de dados**.

## Arquivos de comparação integral

Os arquivos abaixo alinham cada linha antiga e nova. Legenda: `=` idêntica, `-` exclusiva do legado, `+` exclusiva da API Vercel. Colunas mostram números das linhas em cada versão, inclusive para diferenças de formatação.

1. [01 — modelos, matemática, contas e categorias](./01-modelos-contas-categorias.md)
2. [02 — transações, cartões, faturas e orçamentos](./02-transacoes-cartoes-orcamentos.md)
3. [03 — Home, Fluxo, Análises, notificações e assinaturas](./03-home-fluxo-notificacoes.md)
4. [04 — Radar, IA e autenticação](./04-radar-ia-autenticacao.md)
5. [05 — banco, entrypoints, metas e auditoria Firestore](./05-entrada-dados-metas-validacao.md)

## Arquitetura — resultado confirmado pela leitura

- **Legado:** `backend/server.py` e `backend/routers/*.py` usam `backend/lib/db.py` e Motor/MongoDB; esses arquivos continuam no repositório.
- **Vercel em produção:** `frontend/api/index.py` monta `frontend/finnos/routes.py`; as rotas usam `frontend/finnos/lib/db.py` respaldado pelo Firestore Admin SDK. O namespace é `users/{UID}/{coleção}`.
- **Autenticação:** o código ativo valida sessão Firebase por cookie HTTP-only ou bearer Firebase, com UID obtido do token/cookie verificado; o cabeçalho `X-FINNOS-User-ID` não é fonte de autoridade.
- **Cálculo financeiro:** o legado usa sobretudo `float`; a versão Firestore usa `Decimal`/centavos. Compras feitas no cartão não subtraem imediatamente o saldo bancário; pagamento da fatura movimenta a conta sem inflar a despesa analítica. Transferências são efeitos opostos em duas contas.
- **Proteções:** as escritas financeiras Firestore ocorrem em transações com revisão, verificam referências por usuário e podem registrar recibos de operações offline para evitar repetição; regras de integridade mantidas pelo servidor não devem ser confundidas com políticas de segurança do Firebase Console.

## Matriz resumida de correspondência

| Módulo | Legado | API Firestore/Vercel | Avaliação de código |
| --- | --- | --- | --- |
| Autenticação | E-mail/senha e sessão em Mongo | Firebase Auth e cookie de sessão | Arquitetura substituída |
| Contas | CRUD e saldos derivados | CRUD com UID e saldos derivados | Funcionalidade principal presente |
| Categorias | CRUD 50/30/20 | CRUD UID e vínculos orçamentários | Presente com proteção extra |
| Transações | CRUD e filtros | CRUD, filtros, versões, idempotência | Presente, proteção mais robusta |
| Transferências | Débito/crédito | Débito/crédito pela função central | Presente |
| Parcelamento | Parcelas mensais com arredondamento simples | Distribuição em centavos com ajuste residual | Regra aprimorada |
| Cartões e faturas | Fatura calculada e pagamento básico | Ciclos imutáveis, parcelas e pagamentos parciais transacionais | Redesenhado; regressão exige testes |
| Dashboard | Saldo, receitas/despesas e donut | Idem com moeda decimal e faturas excluídas da despesa duplicada | Presente |
| Fluxo, calendário e análises | Tendências, projeções, orçamento | Contratos equivalentes com matemática de centavos | Presente |
| Orçamento V2 | Ciclos, sugestões, progresso | Ciclos UID, validação contra sobreposição | Presente |
| Metas | Arquivo `backend/routers/goals.py` ausente | GET, POST e sugestão | Edição/exclusão não identificadas na API |
| Radar | Sinais básicos | Motor por padrões + sinais ampliados | Implementação nova e mais extensa |
| Assinaturas | Despesas fixas derivadas | Despesas fixas derivadas | Não é um banco independente de assinaturas |
| IA | API por chave do usuário | Mesma abordagem com criptografia e controle de chamadas | IA interna Gemini sem chave não demonstrada |
| Notificações | Listagem, dismiss, clear | Idem via Firestore | Rotas duplicadas presentes nas duas versões |

## Defeitos comprovados e corrigidos neste trabalho

### 1. Listas recentes da Home e contas recebiam HTTP 413 indevido
A regra estrita de truncamento em `frontend/finnos/lib/db.py` precisava distinguir relatórios de dados completos dos `6` lançamentos recentes da Home e dos `8` movimentos exibidos na conta. **Corrigido em [PR #18](https://github.com/Guigori/app/pull/18)**: `allow_truncate=True` é opt-in somente nessas consultas; agregações financeiras continuam estritas. Testes CI e Preview aprovados, merge na `main`.

### 2. Radar usava saldo diferente da Home
O Radar somava diretamente receitas e despesas e não aplicava transferências/cartão na mesma regra do dashboard. **Corrigido em [PR #19](https://github.com/Guigori/app/pull/19)**: usa `balance_effects`; compras em cartão não são débito bancário antes do pagamento, e projeções não subtraem compras pendentes no cartão. Testes CI e Preview aprovados, merge na `main`.

## Pendências demonstradas pelo código

**P1 — Módulo Assinaturas não corresponde ao cadastro independente esperado.** `frontend/finnos/routers/subscriptions.py:28-83` deriva itens automaticamente de `transactions` com `fixed=True` e não oferece criar/editar/excluir uma assinatura como entidade própria. A contagem de assinaturas pode incluir despesas fixas comuns.

**P1 — Metas não têm edição e exclusão na API analisada.** `frontend/finnos/routers/goals.py:38-68` registra somente GET lista, POST criar e GET sugestão. A conta vinculada é validada no adaptador. O frontend pode possuir UI adicional, porém a API não disponibiliza atualização ou remoção de metas nessa rota.

**P2 — IA própria e Gemini interno são objetivos diferentes.** `frontend/finnos/routers/ai.py:76-105` exige chave do provedor cadastrada pelo próprio usuário e flag para chamadas pagas. A oferta de Gemini interno sem chave individual não está demonstrada por esse endpoint.

**P2 — Rotas de notificação duplicadas.** `frontend/finnos/routers/notifications.py:91-161` registra `POST /{id}/dismiss` e `POST /clear` duas vezes. O backend legado também repetia esses decorators. Remover as cópias reduz ambiguidade e divergência de documentação.

**P2 — Paginação/performance ainda dependem de limites do adaptador.** `frontend/finnos/lib/db.py:131-143` carrega até 20.001 documentos por coleção e rejeita totais superiores a 20.000; `Cursor.to_list` aplica filtros e ordenação em memória. Para SaaS com grande volume, precisamos de índices, consultas paginadas e agregações escaláveis.

**P2 — Regras Firestore do console não foram auditadas.** Não foram localizados `firestore.rules` ou `firebase.json` nos caminhos raiz/frontend consultados. Como a API Admin ignora Security Rules, confirmar as regras do SDK cliente e as permissões reais do projeto exige acesso a configuração externa ou um arquivo versionado.

**Limite de validação:** nenhuma comparação de contagem/ID/saldo de bancos reais foi realizada. No caso de ausência de dados históricos no MongoDB, a etapa de cópia de dados é desnecessária; isso não pode ser afirmado apenas pelo código. O projeto Firestore deve ser confirmado com auditoria por UID antes de remover de vez o backend legado.

## Testes executados

- FINNOS CI, Firebase Auth Tests e FINNOS Active Firestore Adapter: **aprovados** nos PRs de correção.
- Deploys da branch revisada na Vercel: **READY**.
- Integridade de dados reais, sessão autenticada de produção, regras Firebase Console, performance sob carga: **não testados nesta auditoria**.

> Os arquivos de diff representam alterações de **código-fonte**, não diferenças de registros MongoDB × Firestore. Uma linha distinta não significa automaticamente regressão, e uma linha igual não prova resultado igual.
