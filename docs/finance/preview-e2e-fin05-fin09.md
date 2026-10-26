# Preview E2E — FINNOS FIN-05b/08/09 + limites/categorias/histórico

**Ambiente:** Vercel Preview da branch `refactor/finn-migration-phase1-20261026` (nunca Production).  
**Dados:** conta de teste autorizada e transações sintéticas, sem usar dados financeiros do usuário.  
**Requisito:** aprovação da revisão do PR #47 antes de efetuar testes que gravem em Firestore. Não alterar Firebase Auth, sessão, regras ou credenciais.

## Verificações com critérios de aceitação

1. **Configuração inicial:** entrar com usuário de teste, criar conta bancária, cartão e categoria (Mercado) com limite mensal de R$ 600,00. Verificar isolamento por UID e lista de categorias.
2. **Limites e ritmo:** registrar gastos de R$ 100 e R$ 80 pagos; confirmar R$ 180 utilizados, R$ 420 disponíveis, dias restantes, projeção e Radar consistentes. Criar ciclo V2 com limite de R$ 500 para Mercado; categorias passam a priorizar limite do ciclo ativo sem sobrescrever limite mensal histórico.
3. **Histórico:** criar categoria, mudar limite, criar lançamento, ver 3 entradas em `/historico` com valor anterior/novo e data. Conferir paginação e impedir operações de reverter transações liquidadas. Um usuário distinto não pode consultar este histórico.
4. **Cartão e fatura:** realizar compra de R$ 300 em uma fatura que fecha em 29/10. Registrar pagamento total R$ 300 em conta. Verificar banco −300, limite restaurado, fatura paga com snapshot imutável.
5. **FIN-05b:** registrar reembolso bancário de R$ 100 dessa compra, data realizada. Confirmar banco +100; fatura continua com total R$ 300 e paga R$ 300; histórico mostra R$ 100 reembolsados; mês do reembolso reflete despesa de competência −100, mas NÃO receita ordinária +100.
6. **Idempotência:** repetir a requisição de reembolso com mesmo `X-FINNOS-Operation-ID` e payload; saldo e histórico não mudam. Reutilizar a chave com valor diferente → HTTP 409.
7. **Regras financeiras:** tentar estornar além do valor da compra, estornar fatura em aberto via endpoint bancário, data futura e conta inexistente; todos rejeitados sem escritas parciais.
8. **FIN-05a:** na fatura não quitada, registrar crédito do estabelecimento de R$ 50; verificar redução do saldo pendente, limite comprometido e despesa de competência.
9. **Parcelamento k/n e histórico:** lançar compra importada em 7/10, confirmar somente 7/10–10/10, centavos reconciliados, fatura histórica visível pelo seletor de mês.
10. **Painéis em paridade:** Dashboard, Fluxo, Orçamento, Radar, simulação e modo local exibem os mesmos totais para conjunto fixo de testes; divergência permitida: **R$ 0,00**.
11. **Offline:** repetir lançamento após reconectar e verificar que não duplica; inspecionar conflitos e retry idempotente.
12. **Limpeza/rollback:** apagar somente registros sintéticos autorizados; nunca apagar dados reais. Registrar IDs e evidências, e interromper em qualquer erro de integridade.

## Critério de liberação

- 100% de testes financeiros e build/TypeScript aprovados em CI.
- Preview READY do commit exato, não somente de um commit anterior.
- E2E autenticado executado com resultados e capturas/logs. **Ainda não realizado nesta etapa.**
- Sem alteração nas configurações de Firebase, Auth, sessões ou regras Firestore.
- PR permanece Draft e a produção inalterada até aprovação explícita.


## Cobertura incremental — FIN-08 (26/10/2026)

Regressões adicionadas **sem acessar Firestore real**:
- `test_budget_refund_consistency.py`: reembolso de fatura liquidada não incrementa salário em Orçamento V2, reversão de despesa por competência e sugestões de categoria consistentes.
- `test_radar_archived_card_credits.py`: estorno ligado a cartão arquivado entra no gasto líquido da categoria; cartão inativo não gera alerta de fatura corrente.
- `test_refund_category_donut.py`: reembolso não cria valores negativos no gráfico de rosca; total financeiro assinado permanece preservado.
- `src/lib/local/finance-migration.test.ts`: gráfico local de mês com somente devolução fica sem fatias negativas.
- `test_simulation_refund_parity.py`: simulação usa saldo bancário real e fatura quitada sem contabilizar novamente o reembolso como renda.

**Não substituir a homologação em Preview:** esses testes não comprovam autenticação,
cabeçalhos de sessão, transações reais Firestore, permissão por UID ou integração da UI.
O merge continua condicionado à matriz acima e à autorização explícita.
