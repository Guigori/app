# FINNOS — auditoria arquitetural (fase 1)

## Evidências confirmadas no código

- `backend/lib/stats.py` e `frontend/finnos/lib/stats.py` implementam funções homônimas, porém **não são equivalentes**. A segunda exclui `invoice_payment` de `month_portion`, exclui `card_id` de `balance_effects` e usa `installment_portion` com Decimal. A primeira usa float e `installment_value` diretamente. Não substituir uma pela outra sem identificar importadores e testes de paridade.
- `frontend/src/lib/data.ts` expõe múltiplos domínios e deve manter compatibilidade enquanto os consumidores migram para fachadas em `src/lib/services/`.
- `frontend/src/lib/local/engine.ts` declara que replica regras do backend. Exige testes cruzados para pagamentos de fatura, transferências, parcelamentos, arredondamentos e saldos.
- `frontend/src/lib/sync/queue.ts` vincula operações a UID e filtra a listagem pelo usuário atual; usa `X-FINNOS-Operation-ID` para idempotência solicitada ao servidor. Confirmar tratamento real no backend e persistência de operações interrompidas antes de considerar idempotência garantida.
- `Dashboard.tsx` consome `@/lib/data`. A separação visual deve ser precedida de contratos de domínio e testes, sem duplicar lógica financeira.

## Plano de migração segura

1. Identificar entrypoints Python e importadores efetivos de ambas as árvores de backend.
2. Adicionar testes de paridade com cenários de cartão, fatura, estorno, transferência e parcelas com resíduos em centavos.
3. Migrar consumidores frontend gradualmente para as fachadas por domínio; extrair implementações só após testes.
4. Criar testes de IndexedDB por UID, retry após falha, alternância de sessão e idempotência no servidor.
5. Separar rotas/layouts Web App e Dashboard, compartilhando tipos, hooks e serviços.
6. Dividir Transactions e Settings em módulos de apresentação, sem alterar regras financeiras.
7. Localizar implementações atuais FIINT/FAC e verificar contratos de Radar e Análises antes de refatorar.

Nenhum destes itens é considerado concluído apenas por este documento. A execução de testes e revisão de código continuam necessárias.
