# FINNOS — Preparação para uso real (17/10/2026)

## Objetivo
Habilitar o uso diário por um grupo pequeno de amigos, sem dados financeiros fictícios em contas reais. Não liberar produção antes dos critérios de segurança e integridade abaixo.

## Evidências observadas na main
- `src/App.tsx`: existem rotas para onboarding, contas, cartões, Home, Fluxo, Análises e Registro Inteligente.
- `src/pages/Onboarding.tsx`: `finish()` marca conclusão com `localStorage.setItem("finnos:onboarding:completed", "1")`; não comprova persistência por UID no Firestore.
- `src/components/RequireAuth.tsx`: valida sessão e renderiza `Outlet`, sem direcionamento explícito ao onboarding.
- `src/pages/Accounts.tsx`: contas exibem `institution`; formas de pagamento são configuráveis via preferências.
- `src/pages/Cards.tsx`: cartões de crédito exibem instituição, limite, uso e fatura.
- `src/pages/Dashboard.tsx`: Home consulta `fetchDashboard`; origem e reconciliação dos cálculos ainda não foram verificadas.
- `src/pages/ChartSettings.tsx`: contém prévias ilustrativas; não são evidência de gráficos financeiros conectados.

## Bloqueadores antes de cadastrar movimentações reais
- [ ] Persistir status e progresso do onboarding por UID verificado no servidor; permitir retomar e pular, sem repetição indevida.
- [ ] Verificar se cadastro e login levam novos usuários ao onboarding, sem afetar usuários existentes.
- [ ] Auditar o modelo Carteira → Instituição → contas/cartões/benefícios e os vínculos existentes; planejar migração não destrutiva.
- [ ] Suportar VR, VA e multibenefícios com saldos por carteira, recargas, histórico e restrições de uso.
- [ ] Separar recargas de benefícios das receitas monetárias comuns; transferências internas não contam como receita/despesa.
- [ ] Testar cartão de crédito: limite, compras parceladas, fechamento, vencimento e pagamento sem dupla contabilização.
- [ ] Reconciliar todos os gráficos com os mesmos lançamentos de referência, inclusive estornos, previstos e meses anteriores.
- [ ] Testar Firestore Rules no Console, isolamento entre UIDs, sincronização offline, duplicação, backup e restauração.
- [ ] Validar no ambiente Preview antes de integrar em main; preservar os dados existentes.

## Cenários mínimos de aceite
1. Usuário A se cadastra, conclui ou adia onboarding, sai e volta em outro dispositivo sem perder progresso.
2. Usuário B não vê nem altera nenhuma conta, cartão, transação ou preferência do usuário A.
3. Duas contas da mesma instituição e dois cartões têm saldos, limites e faturas independentes.
4. Um cartão multibenefícios tem VR e VA separados; gasto VR diminui só VR.
5. Transferência entre contas próprias altera os dois saldos, mas não as receitas e despesas.
6. Compra parcelada e pagamento da fatura não duplicam despesa.
7. Os valores de Home, Fluxo e Análises reconciliam com transações pagas do período.
8. Operações offline sincronizam uma única vez e mantêm valores corretos.

## Sequência de implementação
1. Mapear modelos/rotas e testes existentes.
2. Corrigir onboarding e persistência por UID.
3. Organizar Carteira e benefícios com migração não destrutiva.
4. Corrigir agregações e gráficos, com testes automatizados.
5. Testar Preview com contas de teste e somente então preparar o uso pessoal.

> Este documento registra a auditoria inicial. Nenhuma das caixas acima deve ser marcada sem evidência de teste.
