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


## Plano de homologação ampliado — 27/10/2026

**Somente Preview autenticado do SHA exato.** Esta matriz é um roteiro
de execução, **não comprovação de que a execução remota ocorreu**.

### Preparação
- Usar UID de teste separado e identificado como sintético, previamente
  autorizado, sem copiar cookies ou credenciais pessoais do titular.
- Confirmar Preview READY e SHA no Vercel; testar login real no domínio exato
  antes de gravar quaisquer dados.
- Firestore Firebase Auth, regras, projetos e sessão existentes **não devem**
  ser alterados para facilitar testes. Nenhuma escrita em produção.
- Tirar inventário dos registros do UID de teste, com backup e plano de limpeza
  restrito aos documentos sintéticos criados nessa sessão.

### Jornada financeira sintética
1. Conta bancária com saldo inicial **−R$ 500,23**; outra conta zerada;
   verificar saldo inicial no Dashboard, API e modo local.
2. Salário recebido R$ 3.000; despesa paga R$ 1.000;
   transferir R$ 120 e conferir ambos os lados do lançamento.
3. Cartão com limite e compras parceladas importadas 7/10;
   conferir ciclos, centavos e limite disponível, sem duplicar parcelas.
4. Pagar parcialmente fatura (R$ 40), adicionar nova compra no ciclo
   aberto e confirmar saldo devedor, snapshot imutável e histórico.
5. Registrar crédito comercial e reembolso bancário de fatura quitada;
   verificar competência negativa na categoria, saldo bancário aumentado
   apenas uma vez e Radar/Fluxo/Dashboard consistentes.
6. Cadastrar assinatura mensal com cobrança dia 31 e anual;
   confirmar projeção de fevereiro e supressão se existir lançamento
   manual/agendado correspondente.
7. Comparar faturas e extratos artificiais em
   `POST /api/finance/reconciliation/preview`; divergências devem ser
   **somente relatório**, sem completar pagamentos automaticamente.
8. Consultar transações por período, busca, conta, categoria, status,
   asc/desc; avançar mesmo em páginas sem resultados filtrados,
   evitando duplicações e mantendo os totais do Calendário.
9. Registrar offline, editar offline, tentar excluir offline com versão
   armazenada, restabelecer a conexão e verificar FIFO, idempotência
   da exclusão e tratamento de 409 / 422 sem descarte automático.
10. Recarregar a sessão e repetir leituras; confirmar isolamento UID,
    histórico auditável e nenhuma exposição de dados de outro usuário.

### Evidências e critérios
- Exigir **R$ 0,00** de diferença nas fixtures compartilhadas do backend
  e modo local; documentar diferenças do Firestore real, se houver.
- Fluxos de acesso não autenticado retornam 401 JSON e nunca HTML da SPA.
- O teste unitário/integrado sintético no CI não substitui teste no Preview
  autenticado. Não usar o smoke de Firestore ou qualquer conta pessoal como
  substituto do UID sintético autorizado.
- Capturar IDs de cada operação e dos recibos `sync_receipts`, hash SHA,
  horário e status. Não expor tokens ou informações pessoais no relatório.
- Se falhar, preservar registros de auditoria e abrir nova correção; nunca
  limpar dados reais nem efetuar rollback de produção sem autorização.

### Restrições verificadas no repositório
- ARQ-06: `frontend/vercel.json` declara `crons: []`. O backend informa
  que notificações Push remotas permanecem desabilitadas por falta de
  dispatcher VAPID registrado. As notificações locais/central permanecem.
- Cron Jobs da Vercel são associados a **deployments de produção**; um
  Preview READY não prova que uma agenda antiga foi desativada. Verificar
  Settings → Cron Jobs antes de liberação futura.
- A consulta programática por uma URL protegida pode exigir autenticação
  de Preview; não remover proteção nem inventar aprovação de E2E.
