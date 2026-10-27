# FINNOS — Backlog mestre unificado (auditorias, FINN e Calen)
**Conferência:** 27/10/2026 • **Branch:** `refactor/finn-migration-phase1-20261026` • **PR:** #47 (Draft; base PR #46)  
**Fontes:** inventário completo enviado pelo usuário (29 FIN/ARQ/SYNC/AI, 21 FNS, 12 NEW, 42 M) e `docs/finance/P0-P1-closure-20261026.md`, código e testes do PR #47.

> Este documento é o **controle de escopo**. Não equivale a aprovação de merge ou deploy. "Código implementado" significa apenas que há implementação/testes na branch, **não** homologação com conta de teste real no Firestore/Preview, nem produção. Classificações atualizadas com evidência do PR #47; onde não foi auditado o fluxo completo, manter pendente/parcial.

## Visão geral
- **29 itens de correção principal** (15 FIN, 10 ARQ, 2 SYNC, 2 AI).
- **21 itens FNS** (muitos se sobrepõem aos anteriores).
- **12 evoluções NEW**, que não são defeitos.
- **42 mapeamentos M01–M42** do FINN, que **não são 42 bugs** e não significam migração automática.
- Não somar essas contagens para medir bugs ou progresso. Usar IDs canônicos, evidências e critérios de aceite.

## Correções principais — financeiro (15)
| ID | Escopo | Estado da branch | Prioridade | Evidência / lacuna |
| --- | --- | --- | --- | --- |
| FIN-01 | Estados de faturas; priorizar fechada não paga | Código implementado | P0 | Fatura aberta/fechada/paga/parcial/atrasada; falta E2E |
| FIN-02 | Compra após pagamento parcial/antecipado | Código implementado | P0 | Regressão sintética; falta Firestore real |
| FIN-03 | Séries recorrentes estáveis e sem duplicação | Parcial | P0 | Deduplicação inicial; IDs e edição por escopo pendentes |
| FIN-04 | Parcelamento em andamento k/n | Código implementado | P0 | Testes de parcelas; importação real pendente |
| FIN-05 | Estornos sem receita bancária fictícia | Parcial | P0 | Crédito comercial e reembolso bancário; ciclo futuro/E2E pendentes |
| FIN-06 | Pagamento futuro não inflar saldo realizado | Código implementado | P0 | Bloqueio e testes; histórico legado requer revisão |
| FIN-07 | Paridade financeira Python/TypeScript | Parcial | P0 | Fixtures comuns de centavos; ampliar cobertura e Firestore real |
| FIN-08 | Projeções unificadas em Dashboard/Fluxo/Radar/Simulação | Parcial | P0 | Competência compartilhada; ledger/caixa projetado único pendente |
| FIN-09 | Limites de cartões e faturas históricas importadas | Parcial | P0 | Diagnóstico e preview somente leitura; conciliação com comprovantes pendente |
| FIN-10 | Saldo inicial negativo | Código implementado | P0 | API, formulário, modo local e testes |
| FIN-11 | Arredondamento monetário em centavos | Código implementado | P0 | HALF_UP e fixtures cruzadas |
| FIN-12 | Radar: parcelas, recorrências e alertas | Parcial | P1 | Competência/estornos ajustados; periodicidade completa pendente |
| FIN-13 | Assinaturas em projeções e orçamento | Parcial | P0 | Projeções implementadas; paridade/E2E pendentes |
| FIN-14 | Parcelas e recorrências no mês correto | Parcial | P0 | Calendário parcialmente ajustado; saldo diário futuro completo pendente |
| FIN-15 | Regra de compra no dia de fechamento por cartão | Pendente | P1 | Contrato, persistência, backend, modo local, UI e testes |

## Correções principais — arquitetura (10)
| ID | Escopo | Estado da branch | Prioridade | Evidência / lacuna |
| --- | --- | --- | --- | --- |
| ARQ-01 | Rotas Vercel de onboarding/instituições/APIs | Código implementado; falta E2E | P0 | Testes estáticos; smoke Preview autenticado pendente |
| ARQ-02 | Consultas indexadas e agregados Firestore | Parcial | P0 | Contas: ledger paginado por ID sem limite 20k, com revisão; ainda O(N) leituras. Dashboard/faturas/agregados pendentes |
| ARQ-03 | Paginação por cursor em todas as visualizações relevantes | Parcial | P0 | Lista de transações paginada; outras telas ainda usam legado |
| ARQ-04 | Núcleo financeiro compartilhado e versionado | Parcial | P0 | AccountLedger compartilhado por Contas/Dashboard, competência/fixtures; caixa projetado e ledger TS completo pendentes |
| ARQ-05 | Build e lockfile determinísticos | Código implementado | P0 | npm ci/lockfile; conflito pywebpush/cryptography corrigido |
| ARQ-06 | Job de notificações e transporte Push | Parcial; não ativo em produção | P1 | Contrato GET+Bearer, dispatcher e regras; VAPID/Preview/deploy pendentes |
| ARQ-07 | FIINT no FastAPI ativo; arquivar backend legado | Pendente | P1 | Migrar contratos e testes antes de desativar legado |
| ARQ-08 | Logs, métricas e observabilidade Firestore | Pendente | P1 | Estruturar latência, contagem de leituras, erros e correlação |
| ARQ-09 | Posicionamento visual do Radar apenas no frontend | Pendente | P2 | Separar coordenadas de dados de domínio |
| ARQ-10 | Menu sem rótulos duplicados e código órfão | Pendente | P2 | Inventariar consumidores antes de remover |

## Correções principais — offline e inteligência (4)
| ID | Escopo | Estado da branch | Prioridade | Evidência / lacuna |
| --- | --- | --- | --- | --- |
| SYNC-01 | Fila offline FIFO, UID, conflitos e idempotência | Código implementado; falta E2E | P0 | Testes sintéticos; reconexão IndexedDB+Firestore real pendente |
| SYNC-02 | CRUD offline de cadastros e exclusões com revisão | Parcial | P0 | Transações e criação de entidades; edição/exclusão de outras entidades pendentes |
| AI-01 | Finn com ferramentas financeiras verificáveis | Pendente | P2 | Ferramentas tipadas, evidências, reconciliação e confirmação |
| AI-02 | Modelos IA e dependências confiáveis | Pendente | P2 | Auditar provedores, identificadores, fallback e testes |

## Auditoria do Claude — FNS (21)
| ID | Escopo | Estado da branch | Prioridade | Relação / lacuna |
| --- | --- | --- | --- | --- |
| FNS-001 | Bloquear edição/exclusão de pagamento liquidado | Código implementado | P0 | FIN-01/02 e trilha de auditoria |
| FNS-002 | Índices e agregados mensais Firestore | Parcial | P0 | ARQ-02/03; saldo de contas paginado sem truncar, agregados materializados ainda pendentes |
| FNS-003 | Dashboard Web v3, hooks e testes de renderização | Pendente de validação específica | P1 | UI Dashboard |
| FNS-004 | FIINT no FastAPI | Pendente | P1 | ARQ-07 |
| FNS-005 | Lançamentos pagos futuros | Código implementado | P0 | FIN-06 |
| FNS-006 | Timezone por usuário e semântica de datas | Parcial | P0 | FIN-07/08 e perfil |
| FNS-007 | Conflitos e reenvio offline após resposta perdida | Parcial; reforços implementados | P0 | SYNC-01/02 |
| FNS-008 | Auditoria de Firestore Rules e acesso direto no emulador | Pendente; somente auditoria | P0 | Não alterar Auth/Rules sem autorização |
| FNS-009 | Faturas futuras e IDs de séries recorrentes | Parcial | P0 | FIN-03/08/14 |
| FNS-010 | Indicador investido correto ou oculto | Pendente | P1 | Dashboard/Patrimônio |
| FNS-011 | CSP, frame, nosniff e Referrer-Policy | Pendente | P1 | Cabeçalhos sem quebrar Firebase/Preview |
| FNS-012 | Rate limiting por UID e IP | Pendente | P1 | APIs sensíveis e custos |
| FNS-013 | Fixtures compartilhadas Python/TS | Parcial | P0 | FIN-07/11 |
| FNS-014 | Arquivar backend antigo e CI legado | Pendente | P1 | ARQ-07 |
| FNS-015 | Job /api/push/dispatch | Parcial; contrato corrigido | P1 | ARQ-06; deployment e VAPID pendentes |
| FNS-016 | Modelos IA/dependências | Pendente | P2 | AI-02 |
| FNS-017 | Code splitting e fontes | Pendente | P1 | Performance frontend |
| FNS-018 | Testes API/adapter Firestore por módulo | Parcial | P0 | 207 testes backend, adapter sintético; E2E real pendente |
| FNS-019 | Allowlist X-FINNOS-Source | Código implementado | P1 | 422 para valores não permitidos |
| FNS-020 | Estornos e ajustes auditados de faturas pagas | Parcial; falta E2E | P0 | FIN-05/09, histórico |
| FNS-021 | Fechamento específico por cartão | Pendente | P1 | FIN-15 |

## Melhorias de produto — NEW (12)
| ID | Escopo | Estado da branch | Prioridade |
| --- | --- | --- | --- |
| NEW-01 | Home personalizável e reordenação de blocos | Pendente | P2 |
| NEW-02 | Sobra prevista com despesas e faturas futuras | Pendente | P1 |
| NEW-03 | Editar recorrência: esta/próximas/todas | Parcial | P1 |
| NEW-04 | Histórico auditável e reversão compensatória | Parcial | P0 |
| NEW-05 | Importação inteligente OFX/CSV/PDF | Pendente | P2 |
| NEW-06 | Conciliação automática sugerida com prévia | Pendente | P2 |
| NEW-07 | Conferência de fatura importada vs compras | Pendente | P2 |
| NEW-08 | Revisão de duplicatas e transferências internas | Pendente | P1 |
| NEW-09 | Categorização automática e tags | Pendente | P2 |
| NEW-10 | Investimentos/aportes/resgates/renda passiva | Roadmap posterior | Futuro |
| NEW-11 | Finn com propostas confirmadas | Pendente | P2 |
| NEW-12 | Servidor MCP OAuth 2.1 | Roadmap posterior | Futuro |

## Migração FINN → FINNOS (42 mapeamentos)
O arquivo original forneceu **grupos** de IDs e objetivos, não descrição individual dos 42 métodos. Não inventar implementação por ID: cada método exige comparação de código e testes antes de qualquer incorporação.

| IDs cobertos | Origem FINN | Decisão atual | Fase |
| --- | --- | --- | --- |
| M01–M07 | Ledger, parcelas, recorrências, saldos, eventos de caixa | Avaliar/adaptar sob contratos FIN-07/08/ARQ-04 | P0 |
| M08–M10 | Ciclos e fechamento de cartões | Avaliar/adaptar sob FIN-15 | P1 |
| M11–M17 | Calendário, ritmo, Home, faturas | Avaliar/adaptar sob FIN-12/14 | P1 |
| M18–M20 | Auditoria, histórico e reversões | Avaliar/adaptar sob NEW-04/FIN-05 | P0 |
| M21–M22 | Normalização e regras automáticas | Avaliar/adaptar sob NEW-09 | P2 |
| M23–M25 | Consolidação de lançamentos | Avaliar/adaptar sob NEW-06/08 | P2 |
| M26–M29 | OFX/CSV/prévia/importação | Avaliar/adaptar sob NEW-05 | P2 |
| M30–M35 | Finn, propostas e notificações | Avaliar/adaptar sob AI-01/ARQ-06 | P2 |
| M36–M37 | Investimentos | Roadmap posterior sob NEW-10 | Futuro |
| M38 | MCP e OAuth | Roadmap posterior sob NEW-12 | Futuro |
| M39–M40 | Autenticação e SQLite FINN | Descartados: preservar Firebase Auth e Firestore | Não migrar |
| M41–M42 | Componentes React e telas | Avaliar/adaptar sem reescrever UI | P2 |

## Lotes de implementação e dependências

### Lote 0 — preservar integridade e estabelecer linha de base (P0)
- FIN-01/02/04/05/06/09/10/11 + FNS-001/005/020 + NEW-04: verificar faturas abertas/fechadas/parciais, limites, estornos, saldo negativo, arredondamento e histórico **sem inventar pagamentos**.
- FIN-07/08 + ARQ-04 + FNS-006/013 + M01–M07: definir contratos de saldo, competência, caixa e projeção; executar fixtures idênticas em Python e TypeScript com **diferença de R$ 0,00**; não remover motor offline.
- FIN-03/13/14 + FNS-009: séries recorrentes com IDs estáveis, deduplicação e projeções de assinaturas/parcelas; confirmar datas 29–31, fuso, meses curtos.
- ARQ-02/03 + FNS-002/018: remover scans completos por etapas; índices, paginação, agregados e medição de leituras, preservando UID e filtros.
- SYNC-01/02 + FNS-007: FIFO, recibos idempotentes, resposta perdida, troca de UID, conflitos, exclusões e CRUD offline.
- FNS-008: **auditar** Rules no emulador e acesso cliente; **não modificar** Firebase Auth, sessões ou regras sem autorização explícita.

### Lote 1 — tornar o produto verificavelmente utilizável (P1)
- FIN-12/15, FNS-003/010/021 e NEW-02/03/08: Dashboard Web, Radar, fechamento por cartão, recorrências editáveis, indicador investido verdadeiro, sobra prevista, duplicatas.
- ARQ-01/05/06/07/08, FNS-004/011/012/014/015/017: Preview, FIINT FastAPI, cabeçalhos, rate limiting, desempenho, observabilidade, Push. **Push remoto não está operacional em produção**.
- Testar Onboarding, Contas, Cartões, Faturas, Salário, Assinaturas, Fluxo, Orçamento, Radar, Dashboard e Web App no mesmo UID de teste.

### Lote 2 — produto e inteligência (P2)
- ARQ-09/10, AI-01/02, FNS-016, NEW-01/05/06/07/09/11 e M11–M35/M41–M42: simplificação UI, importação segura com prévia, conciliação, categorização e Finn verificável.
- NEW-10/12 e M36–M38: roadmap posterior; não bloqueiam a estabilização.
- M39–M40: **descartar**, mantendo Firebase Auth e Firestore; nunca importar SQLite/autenticação do FINN.

## Gates objetivos de encerramento
1. **Código:** implementação com contrato explícito, testes unitários/regressão e sem duplicar regra de negócio desnecessariamente.
2. **Integração:** CI no SHA exato (pytest, Vitest, typecheck, build, adaptador Firestore).
3. **Homologação:** Preview do **mesmo SHA**; conta sintética autorizada e separada, sem dados pessoais reais; E2E autenticado com Firestore real.
4. **Finanças:** nenhuma diferença de centavos entre backend/local; reconciliar faturas antigas e limites com evidência, sem escrita corretiva automática.
5. **Offline:** testar IndexedDB/reconexão, conflito, retries e troca de UID; nunca confirmar operação não sincronizada.
6. **Segurança:** revisar autorização, regras, headers, limites, logging e rollback; mudanças em Auth/Rules exigem autorização própria.
7. **Publicação:** PR #46 e PR #47 continuam Draft até revisão; **sem merge, sem promoção de Preview para produção** sem aprovação explícita.

## Evidências técnicas verificadas nesta conferência
- PR #47 HEAD `f9da102a8c2f8214b45b6f6a7fcb4e5f173cd853` antes da criação deste documento.
- Regressões nesse SHA: **207 testes Python, 113 testes frontend**, typecheck e build aprovados; adaptador Firestore **sintético**, não E2E real.
- `frontend/finnos/routers/accounts.py` agora usa `stream_account_balances` (páginas de 300), sem teto 20.000; **ainda percorre todo o histórico** e precisa de agregados persistentes após validação. Dashboard/Fluxo e outros módulos ainda têm `to_list(20000)`: ARQ-02 permanece parcial.
- `frontend/finnos/models/cards.py` e `frontend/src/components/cards/CardDialog.tsx` ainda não expõem regra por cartão para compra no dia de fechamento: FIN-15/FNS-021 pendentes.
- `.github/workflows/quality.yml` usa GET + Bearer para o dispatcher, mas não comprova agendamento efetivo em produção.
- O Preview READY visto anteriormente correspondia a SHA mais antigo; não é homologação do HEAD.
- Não declarar nenhum P0/P1 encerrado somente com CI verde.

## Continuidade após a consolidação — FIN-07/08 (27/10/2026)

- **Corrigido em código:** parcelas legadas k/n sem `installment_value` não projetam mais R$ 0,00 no Fluxo/Calendário. A função canônica `finnos.lib.transaction_amount.occurrence_amount` é usada por Analytics e Orçamento V2; o modo local usa `occurrenceAmount` em Flow/Calendar. Valores explícitos antigos são preservados, sem mutação do Firestore.
- **Fixture nova:** `frontend/fixtures/finance-occurrence-amount-parity.json` verifica primeira/última parcela, 7/10, centavos residuais e valor legado explícito nos dois motores. Testes: `test_occurrence_amount_parity.py`, `occurrenceAmount.test.ts`, integração em `finance-migration.test.ts`.
- **Corrigido em código:** a lista de categorias do Fluxo reutiliza o cálculo de pesos positivos já existente no Dashboard; estornos que tornem uma categoria negativa **continuam no gasto líquido real**, mas não produzem barra negativa ou percentual maior que 100%. Testes de integração Python/TS usam o ledger sintético compartilhado.
- **Estado:** FIN-07/08/ARQ-04 continuam **parciais**. Não refazer estes patches; seguir para centralização do ledger/caixa, consultas agregadas, faturas históricas e E2E Firestore real. Não afirmar homologação no Preview sem SHA exato e UID de teste autorizado.
- **Validação:** workflows no SHA `e7f7ef51d0bbac24e73e92fa9d0cd6a3ba5f3ff8` foram aprovados. Os commits posteriores de categorias e testes exigem novo CI no SHA final.

## Continuidade — ledger paginado de contas e Dashboard (27/10/2026)

- **Implementado:** `frontend/finnos/lib/account_balances.py` define `AccountLedger`, que reutiliza `balance_effects` para saldos, entradas e saídas em `Decimal`. `/accounts` faz leitura paginada por `__name__` (300 documentos por página) sem truncar após 20 mil. O Dashboard reutiliza o mesmo ledger puro para o saldo total, mantendo sua consulta legada de competência até a próxima etapa.
- **Integridade:** revisão financeira capturada **antes** de ler os saldos iniciais e revalidada após o histórico; uma escrita concorrente pelo adaptador resulta em HTTP 409 em vez de exibir saldo parcial. Movimento liquidado com conta ausente resulta em 409; registro monetário corrompido resulta em 503.
- **Testes:** `test_account_balances_streaming.py` cobre mais de 20 mil lançamentos sintéticos, transferências, pagamento de fatura, saldo negativo, histórico legado, UID, corrupção e concorrência; `test_shared_finance_ledger_parity.py` compara Dashboard/contas com a fixture compartilhada.
- **Limitação importante:** paginação reduz uso de memória e remove o limite rígido de 20 mil, **mas não reduz o número total de leituras históricas**. Índices/agregados incrementais, tempo de resposta real e regras de consistência sob escrita direta externa continuam pendentes. Não alterar saldos armazenados ou criar eventos compensatórios automaticamente.
- **Gate:** testes do SHA final, Preview do mesmo SHA e E2E com UID sintético autorizado ainda são necessários para homologação; nenhuma mudança em Auth/Rules ou produção.

## Regra de manutenção
Toda implementação futura deve atualizar a linha correspondente: **estado → arquivo/commit/teste → evidência Preview/Firestore → aceite**. Não apagar itens por parecerem duplicados; registrar a equivalência (ex.: FNS-021 ↔ FIN-15) e manter o vínculo. Alterar estados para "homologado" somente após os gates completos.
