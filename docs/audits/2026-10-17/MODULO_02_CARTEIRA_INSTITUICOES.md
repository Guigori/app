# FINNOS — Módulo 02: Auditoria de Carteira e instituições financeiras

**Data:** 17/10/2026  
**Repositório:** `Guigori/app`, base `main` @ `43f2a2be467e16f1b94ea186e3d272bec2a296c4`.  
**Branch de auditoria:** `audit/modulo-02-carteira-20261017`.  
**Estado:** diagnóstico e plano para APROVAÇÃO. **Não foram implementadas correções de negócio, feitas migrações ou publicados deployments.**

## Escopo e metodologia

Revisados os fluxos `frontend/src/pages/Accounts.tsx`, `Cards.tsx`, `frontend/src/components/accounts/*`, `frontend/src/lib/accountPaymentPreferences.ts`, `frontend/src/lib/local/engine.ts`, `frontend/src/lib/offline/accountCache.ts`, `frontend/finnos/routers/accounts.py`, `cards.py`, `transactions.py`, `frontend/finnos/lib/{db,stats,finance_audit}.py` e modelos TypeScript/Pydantic.

Foram adicionados **oito testes contratuais novos** (5 para comportamento HTTP financeiro e 3 para a simulação de instituições), sem mexer nos fluxos em produção. Os testes usam um Firestore **simulado em memória**, com autenticação e origem simuladas. Não foi realizada leitura, migração ou modificação de informações financeiras reais.

## Resultados de CI

- **FINNOS Firebase Auth Tests: 115 passed**, 2 warnings — [run 39071832834](https://github.com/Guigori/app/actions/runs/39071832834). Abrange os oito testes novos no conjunto.
- FINNOS CI (TypeScript, lint, Vitest e build; compilação backend) — [run 39071832845](https://github.com/Guigori/app/actions/runs/39071832845); conferir a conclusão final antes de merge.
- CodeQL — [run 39071832870](https://github.com/Guigori/app/actions/runs/39071832870); conferir a conclusão final antes de merge.
- Não foi executado teste E2E específico da nova carteira, que **ainda não existe**, nem teste de autorização das regras do Firestore em ambiente real.

## Matriz de prontidão (19 critérios de peso igual)

| # | Critério | Pontos | Evidência |
|---|---|---:|---|
| 1 | Criar contas com validação | 1 | AccountDialog + POST /accounts |
| 2 | Editar contas preservando IDs | 1 | PUT /accounts/{id}, teste wallet_02 |
| 3 | Exclusão protegida no Firestore | 1 | db.Collection.delete_one (vínculos transações/cartões/metas/assinaturas) |
| 4 | Consulta de contas e saldos | 1 | GET /accounts + _enriched_accounts |
| 5 | Tipos corrente/salário/digital/poupança/carteira | 1 | AccountIn/AccountType |
| 6 | Cartões e conta de pagamento | 1 | CardDialog + CardIn + validação de vínculos |
| 7 | Crédito não reduz saldo até quitação da fatura | 1 | balance_effects + testes de cartão |
| 8 | Formas de pagamento com persistência autenticada validada | 0,5 | SDK Firestore grava por UID, mas regras reais não verificadas |
| 9 | Transferências: soma zero do patrimônio | 1 | balance_effects + test_wallet_02_transfers |
| 10 | Pendente/agendado fora do saldo efetivado | 1 | balance_effects + testes HTTP |
| 11 | Isolamento de recursos por UID | 1 | scoped() + verificação Firestore + teste wallet_02_cross_uid |
| 12 | Cache offline segregado por UID | 1 | cachedFetch + accountCache.test.ts |
| 13 | Exclusão local impede cartões órfãos | 0 | localDeleteAccount não consulta db.cards |
| 14 | Ocultar saldo E entradas/saídas no card de conta | 0,5 | saldo escondido; valores de fluxo continuam aparentes |
| 15 | Histórico de transferência mostra entrada/saída conforme a conta | 0 | AccountDetailDialog usa `type === "receita" ? +value : -value` para todas |
| 16 | Cadastro de instituição com identificador próprio | 0 | AccountIn/CardIn possuem somente string `institution` |
| 17 | Agrupamento de contas e cartões por instituição | 0 | telas distintas, nenhum vínculo issuer comum |
| 18 | Migração persistente, idempotente, auditada e não destrutiva | 0 | somente dry-run sem escrita; sem dados reais |
| 19 | Visão consolidada Carteira FINNOS | 0 | /contas e /cartoes separados |
| | **Total** | **12/19** | **63% (estimativa auditável de funcionalidades presentes)** |

A estimativa **não é cobertura de testes, não prova regras Firestore em produção e não representa o FINNOS inteiro**.

## Problemas identificados e priorização

**M02-01 — Alta, integridade do modo local.** `frontend/src/lib/local/engine.ts::localDeleteAccount` verifica transações e assinaturas, mas NÃO `db.cards[].payment_account_id`. Excluir conta sem transações pode deixar cartão com conta de pagamento inexistente. O backend Firestore bloqueia esse caso. O armazenamento local atual (`LocalDb`) não contém metas; portanto, a ausência de validação de metas locais é um requisito futuro, não um órfão de meta já comprovado.

**M02-02 — Alta, histórico apresenta transferência recebida como saída.** `AccountDetailDialog.tsx` faz `formatBRL(t.type === "receita" ? t.value : -t.value)`. Se `account.id === t.to_account_id`, o valor deveria aparecer como entrada; o componente nem tipa `to_account_id` na interface reduzida local. É defeito de exibição, não evidência de saldo backend incorreto.

**M02-03 — Alta, opção de privacidade incompleta.** `Accounts.tsx` esconde o saldo principal com `hidden`, mas `account.total_income` e `account.total_expense` continuam sempre renderizados com `formatBRL`. Os números permanecem visíveis com o olho fechado.

**M02-04 — Alta, entidades financeiras desconectadas.** `institution` é texto livre em `AccountIn` e `CardIn`, sem instituição por UID, sem ID estável e sem grupo visual. Dados como `NuBank` / `Nubank` variam e `Inter` / `Banco Inter` não podem ser fundidos automaticamente sem validação.

**M02-05 — Média, método de pagamento fora da API e regras pendentes.** `accountPaymentPreferences.ts` acessa `users/{uid}/accountPaymentMethods/{accountId}` diretamente pelo SDK Web com `setDoc/getDoc`. O UID é tomado do Firebase Auth; entretanto, não há versão de regras Firestore no repositório e as permissões efetivas não foram testadas nesta auditoria. NÃO afirmar que existe vazamento. Também não se vê rotina que elimine o documento de preferências quando a conta for excluída.

**M02-06 — Média, contas inativas continuam selecionáveis para novos registros.** A API valida a existência da conta, não seu estado `active`. Definir semântica: permitir edição de histórico e reativação, mas evitar selecionar conta arquivada em novos lançamentos. Depende de decisão de produto.

**M02-07 — Evolução, ausência de visão unificada.** O usuário não tem uma Carteira com subtotal por instituição, cartões, contas e acesso às formas de pagamento num mesmo contexto. Não misturar limite de cartão com dinheiro disponível nem VR/VA com saldo bancário. VR/VA/multibenefícios permanecem como Módulo 03.

## Validação de migração sem escrita

Ferramenta: `backend/scripts/wallet_institution_dry_run.py`; exercitada por 3 testes em `backend/tests/test_firestore_finance.py`.

Com dados artificiais:
- `" Nubank "`, `"nubank"`, `"NUBANK"` → mesmo candidato `nubank` por igualdade normalizada, **sem criar ID real nem gravar**.
- `"Inter"` e `"Banco Inter"` → permanecem dois candidatos; equivalência exige revisão humana.
- `""` e `"   "` → registros `unassigned` para vinculação manual, não descartados.
- IDs de contas/cartões, saldo total, limites e `payment_account_id` permanecem intactos; `write_operations=0`; entradas duplicadas de origem são rejeitadas.

**Não foi inspecionado o histórico real do Firebase:** portanto, quantidade de instituições, colisões, saldos, conflitos e necessidade real de limpeza continuam desconhecidos. A simulação valida o algoritmo conservador, não uma migração executada.

### Plano de migração seguro para aprovação

1. **Backup e inventário antes de alterações**, leitura por UID autenticado e geração de relatório com contagem por coleção e checagens de integridade/valores em centavos. Não executar mudanças em massa sem anuência explícita.
2. Criar `users/{uid}/institutions/{institutionId}` e `institution_id` opcional nas contas e cartões. O sistema deve aceitar registros antigos durante a transição, mantendo `institution` como string de compatibilidade temporária.
3. Gerar candidatas por igualdade estrita normalizada; nomes faltantes e aliases ambíguos → revisão do proprietário. Não agrupar contas por `payment_account_id`: esse campo indica **de onde sai o pagamento**, não quem emitiu o cartão.
4. Fazer migração em etapas **idempotentes**, sob UID validado, com escrita transacional e trilha de auditoria. Preservar IDs de contas, cartões, transações, faturas, metas, assinaturas, saldos iniciais e valores.
5. Comparar registros antes/depois: mesmas contagens, somatórios exatos em centavos, nenhum órfão, nenhuma operação financeira nova, mesma soma consolidada por titular; bloquear se surgir divergência.
6. Implementar UI Carteira agrupada no estilo FINNOS claro/escuro, preservando /contas e /cartoes como caminhos compatíveis; testar desempenho com instituições múltiplas.
7. Testar criação, edição, exclusão, associação de cartões, transferências, ocultar valores, isolamento por UID, offline/local, migração repetida e rollback em ambiente Preview.
8. Somente depois de homologação e aprovação adicional promover para `main` e Vercel produção.

## Critérios de aceite

- Nenhuma conta ou cartão perde ID ou vínculo.
- Instituições compartilhadas por conta e cartão têm IDs distintos por UID; nenhuma equivalência arriscada é inferida silenciosamente.
- Saldos e faturas não são alterados pela reorganização de UI/dados.
- Cartão emitido por A e pago por conta em B permanece associado à instituição emissora A.
- Transferências recebidas aparecem positivas no detalhamento da conta destino; saídas negativas na origem.
- Esconder valores oculta saldo, entradas e saídas em todas as telas da Carteira.
- Excluir contas/cartões mantém integridade no modo local e no Firestore.
- Todos os testes automatizados e homologação manual passam; migração idempotente em Preview com conferência antes/depois.

## Decisão pendente

O usuário pediu **auditoria/testes/relatório** do Módulo 02. **Aguardar aprovação das correções funcionais antes de implementá-las**. A PR #36 contém apenas testes, simulador sem escrita e documentação; permanecer em rascunho.
