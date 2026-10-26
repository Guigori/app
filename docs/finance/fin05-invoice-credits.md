# FIN-05a — Nota de crédito auditável em faturas ainda não liquidadas

**Estado:** implementado apenas na branch `refactor/finn-migration-phase1-20261026`; não publicado.

## Alcance seguro do primeiro lote

A nova ação **Registrar estorno**, na tela da fatura, registra um crédito vinculado
a uma compra/parcela específica. É um evento **aditivo, com ID e motivo**.
Não apaga a compra e não edita a transação de pagamento da fatura.

- Endpoint: `POST /api/cards/{card_id}/credits`
- Cabeçalho de idempotência: `X-FINNOS-Operation-ID` (mesma convenção do pagamento).
- Campos: `cycle`, `purchase_id`, `value` (R$), `reason`.
- Registro append-only no próprio documento do cartão, em
  `invoice_adjustments[cycle][]`: `id`, `fingerprint`, `purchase_id`,
  `credit_cents` (inteiro), `date`, `created_at`, `reason`.
  Essa chave deliberadamente **não** se chama `amount_cents`, pois o
  decodificador existente transforma chaves monetárias reconhecidas.
- A gravação é atômica e protegida por UID e pela revisão financeira existente.
  Repetições com a mesma chave e dados não aplicam outro crédito; chave
  reutilizada com outros dados retorna conflito.
- A leitura da fatura retorna `adjustments` e `adjustment_total`. Faturas,
  total pendente e limite utilizado passam a deduzir o crédito, sem modificar
  o snapshot anterior de compras já vinculado a pagamentos.
- A mesma funcionalidade funciona no modo local, sem chamadas ao servidor.

## Restrições indispensáveis

1. Crédito deve ser positivo e não pode superar o valor daquela
   compra/parcela, descontados créditos anteriores.
2. Crédito não pode superar o **saldo ainda não pago da fatura**.
   Se a fatura está integralmente quitada, é necessário outro fluxo de
   reembolso à conta de origem ou crédito em ciclo futuro. **Não** é
   registrado recebimento bancário de forma automática.
3. A compra referenciada por um crédito não pode ser editada/excluída
   diretamente; posteriores reversões precisam de novos eventos de ajuste.
4. Este lote deduz créditos do valor da fatura e do limite. A dedução da
   despesa no **histórico analítico e nos orçamentos** ainda não foi unificada.
   Esse desdobramento depende do motor único FIN-08 para evitar dupla contagem.
5. Não implementa reembolso bancário de fatura paga, não migra registros
   históricos e não altera regras Firestore, autenticação, login ou sessões.

## Critérios de teste

- Crédito parcial em ciclo aberto e em fatura parcialmente paga.
- Recusa de valor negativo, valor além da compra, crédito além do saldo,
  compra inexistente e fatura já quitada.
- Preservação de compras, pagamentos e snapshots auditáveis.
- Repetição idempotente; rejeição de mesmo ID com payload diferente.
- Limite comprometido após crédito, paridade do modo local, tipagem e build.
- E2E autenticado com dados **sintéticos** em Preview permanece obrigatório
  antes de qualquer merge.
