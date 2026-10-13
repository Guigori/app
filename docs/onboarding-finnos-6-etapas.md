# FINNOS — Onboarding autenticado (6 etapas)

Status: especificação de implementação; **não representa funcionalidade implementada**.
Branch de trabalho: `feat/firebase-fastapi-migration-20261012`.

## Limites
- Preservar login, cadastro, confirmação de e-mail e Firebase Auth existentes.
- Usar exclusivamente os assets oficiais em `frontend/public/brand/` via `FinnosLogo`.
- Entrar no fluxo **após** autenticação/verificação; usuário antigo sem marcador não deve ser redirecionado à força.
- Não usar marcador global `finnos:onboarding:completed` como fonte de verdade.
- Persistir conclusão/progresso em documento protegido por UID autenticado; nunca aceitar UID enviado livremente pelo cliente.
- Não adicionar dependência nova do MongoDB; auditar rotas antigas antes de reutilizar.

## Etapas
1. Nome preferido: pré-preencher do perfil ou do e-mail, editável.
2. Renda: valor BRL positivo e frequência (semanal/quinzenal/mensal/anual), normalização sem perda de precisão.
3. Orçamento: 50/30/20 ou personalizado; soma exata de 100%; reutilizar ciclos/categorias existentes.
4. Contas e cartões: permitir múltiplos; saldo inicial opcional; cada entidade recebe escolha própria de **importar extrato/fatura exportado do banco**, **adicionar manualmente** ou **fazer depois**. Conta usa extrato, cartão usa fatura. Importação deve exigir revisão e confirmação; associação explícita ao ID da conta/cartão e UID. Detectar duplicados contra lançamentos existentes e dentro do arquivo. Arquivos não suportados não podem ser marcados como importados. A exportação de dados do FINNOS é recurso separado.
5. Lançamento de demonstração: estado efêmero apenas; nunca chamar createTransaction nem escrever no Firebase/backend.
6. Tour: Home, Fluxo, Análises, Metas, Assinaturas e Radar, pulável; prévias ilustrativas claramente rotuladas. Conclusão marca onboarding concluído por UID.

## Regras de persistência
- Usar transações/gravadores idempotentes para evitar duplicidade após refresh/retry.
- Nenhum registro financeiro de outro UID pode ser consultado ou gravado.
- Retomada de rascunho do mesmo UID; invalidar caches e rascunhos ao trocar de conta/logout.
- Conta existente sem registro de onboarding deve entrar na Home, com oferta opcional.
- Falhas de rede não devem marcar etapas como concluídas sem confirmação do servidor.

## Arquivos a integrar
- `frontend/src/pages/Onboarding.tsx` (atualmente importação simplificada).
- `frontend/src/components/onboarding/ImportReview.tsx` (atualmente destino somente conta).
- `frontend/src/lib/importFinancial.ts` (CSV/OFX/QFX/TXT; PDF precisa de implementação real).
- `frontend/src/App.tsx`, `frontend/src/components/RequireAuth.tsx`.
- `frontend/src/pages/BudgetSettings.tsx`, `frontend/src/lib/data.ts`, `frontend/src/lib/profileIdentity.ts`.
- `frontend/src/components/brand/FinnosLogo.tsx` (reutilizar, não modificar assets).

## Testes obrigatórios antes de liberar Preview
- Cadastro por e-mail confirmado e Google, retomada e pular.
- Duas contas Firebase no mesmo navegador não compartilham estado, cache, transações ou contas.
- Orçamento personalizado soma 100%; valores e arredondamento BRL corretos.
- Importação de extrato da conta A não vai para conta B; fatura do cartão A não vai para cartão B.
- Prévia sem confirmação não grava nada; demonstração nunca grava.
- Importação repetida não duplica registros; erros de arquivo são claros.
- Validação de regras Firestore, auth e backend, testes automatizados e deploy somente Preview.
