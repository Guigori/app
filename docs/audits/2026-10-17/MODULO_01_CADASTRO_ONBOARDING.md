# FINNOS — Módulo 01: auditoria de cadastro, autenticação e onboarding

**Data:** 17/10/2026  
**Branch de referência (somente leitura):** `main` @ `c30e88932c9caa99847abe6759dfff71be025938`  
**Branch de trabalho:** `feat/uso-real-onboarding-carteira-auditoria-20261017`  
**Estado:** diagnóstico para aprovação. Nenhum arquivo funcional modificado.

## Resumo executivo

A autenticação está substancialmente implementada com Firebase SDK (e-mail/senha, Google), e a API troca ID token validado por cookie HttpOnly de sessão. Já há testes unitários/contratuais para esse caminho. O onboarding, contudo, não corresponde às seis etapas aprovadas e não gerencia progresso por usuário. A importação financeira gera identificadores aleatórios a cada leitura, oferecendo proteção contra repetição da mesma tentativa, mas não contra reimportação posterior do mesmo arquivo.

**Estimativa de implementação estática do Módulo 01: 50% (9/18 pontos de critérios funcionais).** É um indicador provisório de presença de código, NÃO é a taxa de sucesso de testes ponta a ponta nem um percentual do FINNOS inteiro.

Regra de pontuação: 1 = implementado identificável no código, 0,5 = parcialmente implementado, 0 = ausente. Os oito fundamentos de autenticação somam 8 pontos; duas partes incompletas do onboarding somam 1 ponto; demais comportamentos de onboarding somam 0. Reavaliar após teste E2E e homologação.

## Matriz de auditoria (18 critérios)

| # | Critério | Pontos | Evidência |
|---|---|---:|---|
| 1 | Cadastro por e-mail e senha | 1 | `src/pages/Register.tsx`, `src/lib/emailSession.ts` |
| 2 | Login por e-mail e senha | 1 | `src/pages/Login.tsx`, `src/lib/emailSession.ts` |
| 3 | Login Google | 1 | `src/lib/googleSession.ts` |
| 4 | Verificação do e-mail por link | 1 | `src/lib/emailSession.ts`, `api/index.py` |
| 5 | Recuperação de senha | 1 | `src/pages/Login.tsx`, `src/lib/emailSession.ts` |
| 6 | Cookie HTTP-only/Secure em Preview/produção + validação do UID | 1 | `api/index.py` |
| 7 | Logout e limpeza de cache | 1 | `src/lib/session.ts` |
| 8 | Bloqueio de páginas sem sessão | 1 | `src/components/RequireAuth.tsx` |
| 9 | Etapa de nome preferido no onboarding | 0,5 | Nome coletado no cadastro e editável pela API, mas não existe como etapa |
| 10 | Etapa de renda mensal | 0 | Ausente de `src/pages/Onboarding.tsx` |
| 11 | Etapa de orçamento 50/30/20 ou personalizado | 0 | Ausente do onboarding |
| 12 | Etapa de instituições, contas e cartões | 0,5 | Só existe abertura do diálogo de uma conta; cartões são tratados em outra tela |
| 13 | Etapa de primeiro lançamento de demonstração (sem persistir fictícios) | 0 | Ausente |
| 14 | Tour de conclusão | 0 | Ausente |
| 15 | Pular e retomar onboarding | 0 | Ausente |
| 16 | Estado de onboarding por UID com persistência no Firestore | 0 | `finish()` escreve apenas no localStorage |
| 17 | Redirecionamento condicional de primeiro acesso | 0 | Login → Home; Google no cadastro → onboarding sempre; `RequireAuth` não verifica progresso |
| 18 | Importação segura contra reenvio do mesmo arquivo | 0 | `importFinancial.ts` gera `crypto.randomUUID()` em cada leitura; repetir upload cria novos IDs de operação |

## Achados priorizados

**M01-01 — Bloqueador, onboarding incompleto.** `frontend/src/pages/Onboarding.tsx` implementa três blocos (conta, método de entrada e revisão), não as seis etapas planejadas. Não possui renda, orçamento, tour ou primeiro lançamento guiado.

**M01-02 — Alto, progresso não acompanha usuário/dispositivo.** `finish()` usa `window.localStorage.setItem("finnos:onboarding:completed","1")`, sem UID; usuários diferentes no mesmo navegador também podem compartilhar essa marca local. Não há endpoint de progresso autenticado.

**M01-03 — Alto, roteamento inconsistente.** No `Login.tsx`, login normal e Google navegam `"/"`. No `Register.tsx`, criação/Google navegam `"/onboarding"` sem consultar progresso; `RequireAuth.tsx` não faz decisão de onboarding. Propor decidir com perfil/estado do backend, respeitando novos e existentes.

**M01-04 — Alto, risco de duplicação em reimportação.** `frontend/src/lib/importFinancial.ts` atribui `crypto.randomUUID()` a cada linha toda vez que o arquivo é analisado. `Onboarding.tsx` usa `onboarding-import-${row.id}` como chave. Esse token só deduplica tentativas da mesma seleção em memória; reabrir o mesmo arquivo gera IDs diferentes. Implementar identidade estável do lançamento, escopo por UID, conta/cartão, arquivo e linha, com fluxo de revisão e duplicidade explícita.

**M01-05 — Médio, experiência opcional ausente.** Não há botão `Deixar para depois`; tela exige ao menos uma conta para avançar. Deve ser possível adiar, retomar e concluir.

**M01-06 — Cobertura insuficiente de testes ponta a ponta.** `tests/e2e/` só contém `.gitkeep`; existem testes unitários para `emailSession`, `googleSession` e `profileIdentity`, mas nenhum teste específico das seis etapas na árvore revisada.

**M01-07 — Atenção operacional.** Repositório `Guigori/app` reporta visibilidade `public` em 17/10. Isso não prova exposição de credenciais, mas contraria a intenção anterior de restringir o código; revisar política de privacidade do repositório antes de distribuir convites, mantendo segredos fora do Git.

## CI e evidências de teste

- Último CI de **push na main** observado: [FINNOS CI 38752998163](https://github.com/Guigori/app/actions/runs/38752998163), 15/10/2026, **success** para frontend (typecheck, lint, unit tests, build) e backend (compilação/imports).
- Firestore adapter no mesmo SHA: [38752998227](https://github.com/Guigori/app/actions/runs/38752998227), **success**.
- CodeQL no mesmo SHA: [38752998425](https://github.com/Guigori/app/actions/runs/38752998425), **success**.
- Execuções agendadas de 17/10 com estado `success` executaram o despacho de notificações; os jobs frontend/backend ficaram `skipped`. Não devem ser interpretadas como nova validação do aplicativo.
- **Não foram executados** nesta auditoria: suíte local de testes, teste real do Firebase Console, cadastro de conta real, login em navegador, fluxo em iPhone físico, importação financeira real ou suíte Playwright. Não há confirmação de end-to-end de produção.

## Correções propostas — aguardam aprovação

1. Criar contrato `GET/PATCH /api/onboarding` protegido por cookie de sessão Firebase e UID verificado. Salvar versão, estado (`not_started`, `in_progress`, `skipped`, `completed`) e última etapa em `users/{uid}/settings/onboarding`, via Firestore Admin, sem permitir UID na entrada. **Validar naming e coleção existente antes da implementação.**
2. Criar seis etapas no design FINNOS: nome preferido, renda, orçamento 50/30/20 ou personalizado, instituições/contas/cartões e opção de importação, primeiro lançamento de exemplo sem persistência e tour final.
3. Criar opção `Deixar para depois` e `Continuar configuração`; não forçar onboarding retroativamente em perfis antigos sem análise/migração compatível; não bloquear Home por problemas de rede temporários.
4. Centralizar redirecionamento pós-login em estado por UID; diferenciar novo usuário e conta existente sem depender do caminho /cadastro ou /login.
5. Vincular nome/preferências/renda/orçamento aos endpoints e modelos próprios; não armazenar campos financeiros sensíveis em localStorage. Exigir validação e tratar erros de persistência sem informar conclusão falsa.
6. Produzir chave de importação estável e proteção server-side contra duplicação entre sessões, com opção explícita de resolver duplicidades legítimas.
7. Implementar testes unitários + API + integração para cadastro, confirmação, recuperação, Google, sessão, trocas de UID, retomada entre dispositivos, skip, primeira configuração e importação reexecutada.
8. Revisar Preview e CI; só integrar em `main` após testes e nova autorização.

## Critérios para aprovação final do Módulo 01

- Novo usuário completa ou pula o onboarding e pode retomar em outro dispositivo.
- Usuários existentes não são enviados ao onboarding contra sua vontade.
- Nenhum estado de onboarding ou preferências passa de um UID para outro.
- Firebase + FastAPI protegem operações autenticadas e nenhum perfil é criado sem consentimento.
- Primeiro lançamento de demonstração não vira transação financeira real.
- Duplo upload de extrato/fatura não duplica transações silenciosamente.
- Suite unitária, integração/contratos e E2E relevante executada sem falhas, com evidência de CI.
- Mobile real/preview validado e sem perda de estado após relogin.

**Decisão pendente:** aprovação do usuário para iniciar correções na branch de trabalho. Não aplicar deploy de produção nesta fase.
