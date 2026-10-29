# FINNOS — contratos de fatura antecipada e parcelamento k/n

Status: branch de migração FINN → FINNOS; não implantado na produção.

## FIN-02: pagamento antecipado e compras posteriores

- Uma compra de cartão reconhecida em um ciclo gera uma linha identificada pelo ID do lançamento.
- Pagamento total ou parcial cria **um débito bancário separado e imutável**, com recibo e chave de idempotência; o pagamento não é outra despesa por competência.
- A fatura com pagamento preserva suas linhas anteriores como snapshot auditável. Se o ciclo **ainda está aberto**, uma nova compra no mesmo ciclo é admitida e adicionada ao total devido, sem desfazer o pagamento.
- A união dos itens de um ciclo usa **ID do lançamento** para não duplicar linhas antigas com etiquetas de parcela diferentes. O snapshot anterior prevalece em caso de divergência.
- Compras existentes vinculadas a ciclos já pagos não podem ser editadas ou excluídas destrutivamente: exigirão um fluxo separado de estorno/ajuste. Uma nova compra retroativa para ciclo já **fechado e com pagamento** é rejeitada.
- Total pendente = soma das linhas do ciclo − pagamentos acumulados, nunca inferior a zero. O limite comprometido deve refletir o mesmo conjunto de linhas.

## FIN-04: importação de parcelamentos em andamento

Contrato para uma compra importada como **k/n**:

- `value` = **valor total original da compra**, não apenas o saldo remanescente.
- `total_installments=n` = número total de parcelas da compra.
- `current_installment=k` = parcela em andamento no momento do cadastro.
- `date` = data de competência da **parcela k**, a primeira que o FINNOS deve representar.
- A partir de `date` são emitidas **n−k+1** parcelas, identificadas k/n, (k+1)/n, …, n/n.
- Os centavos residuais seguem a regra já existente do FINNOS: acrescentados às últimas parcelas. Ex.: R$ 100,00 em 3 → R$ 33,33 + R$ 33,33 + R$ 33,34; uma importação em 2/3 emite apenas R$ 33,33 e R$ 33,34.
- Parcelas anteriores a k pertencem ao histórico anterior à importação e **não** reaparecem na fatura ou no limite disponível.
- Nenhum registro de dados antigos é automaticamente editado ou migrado por essa correção.

## Critérios mínimos de regressão

- Pagamento parcial seguido de compra nova enquanto o ciclo permanece aberto: fatura/limite aumentam somente pela nova compra.
- Pagamento integral antecipado seguido de nova compra: reabre valor pendente da mesma fatura sem criar segundo pagamento.
- Editar ou excluir lançamento já liquidado: operação rejeitada; mesma regra para compra retroativa em ciclo fechado e pago.
- Importar parcela 7/10: exatamente quatro parcelas futuras, e rótulos 7/10 até 10/10.
- Compatibilidade Python ↔ TypeScript: valores idênticos em centavos para uma mesma compra.
- Importação k/n com pagamento/snapshot legado: nenhuma linha duplicada.
- pytest, Vitest, TypeScript e build aprovados. Teste HTTP transacional em Preview continua como requisito antes de merge.
