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
| FIN-03 | Séries recorrentes estáveis e sem duplicação | Parcial | P0 | Leitura paginada preserva fontes fixas legadas e supressão por ocorrências; IDs e edição por escopo pendentes |
| FIN-04 | Parcelamento em andamento k/n | Código implementado | P0 | Testes de parcelas; importação real pendente |
| FIN-05 | Estornos sem receita bancária fictícia | Parcial | P0 | Crédito comercial e reembolso bancário; ciclo futuro/E2E pendentes |
| FIN-06 | Pagamento futuro não inflar saldo realizado | Código implementado | P0 | Bloqueio e testes; histórico legado requer revisão |
| FIN-07 | Paridade financeira Python/TypeScript | Parcial | P0 | Fixtures comuns de centavos; ampliar cobertura e Firestore real |
| FIN-08 | Projeções unificadas em Dashboard/Fluxo/Radar/Simulação | Parcial | P0 | Competência compartilhada; ledger/caixa projetado único pendente |
| FIN-09 | Limites de cartões e faturas históricas importadas | Parcial | P0 | Diagnóstico e preview somente leitura; conciliação com comprovantes pendente |
| FIN-10 | Saldo inicial negativo | Código implementado | P0 | API, formulário, modo local e testes |
| FIN-11 | Arredondamento monetário em centavos | Código implementado | P0 | HALF_UP e fixtures cruzadas |
| FIN-12 | Radar: parcelas, recorrências e alertas | Parcial | P1 | Competência/estornos ajustados; periodicidade completa pendente |
| FIN-13 | Assinaturas em projeções e orçamento | Parcial | P0 | Leitura paginada mantém deduplicação por lançamentos explícitos e séries antigas; E2E pendente |
| FIN-14 | Parcelas e recorrências no mês correto | Parcial | P0 | Calendário parcialmente ajustado; saldo diário futuro completo pendente |
| FIN-15 | Regra de compra no dia de fechamento por cartão | Pendente | P1 | Contrato, persistência, backend, modo local, UI e testes |

## Correções principais — arquitetura (10)
| ID | Escopo | Estado da branch | Prioridade | Evidência / lacuna |
| --- | --- | --- | --- | --- |
| ARQ-01 | Rotas Vercel de onboarding/instituições/APIs | Código implementado; falta E2E | P0 | Testes estáticos; smoke Preview autenticado pendente |
| ARQ-02 | Consultas indexadas e agregados Firestore | Parcial | P0 | Calendário e lista de cartões paginados; protótipo incremental mensal e reconciliação read-only em shadow. Sem hooks de escrita ou uso em produção |
| ARQ-03 | Paginação por cursor em todas as visualizações relevantes | Parcial | P0 | Calendário via histórico paginado; cartões via consulta indexada por cartão e revisão. FIINT, Radar, Simulação e outras telas ainda pendentes |
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
| FNS-002 | Índices e agregados mensais Firestore | Parcial | P0 | Motor mensal incremental e persistência shadow opt-in; duplo scan de reconciliação implementado em código. Integração ativa ainda pendente |
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
- `frontend/finnos/routers/accounts.py` usa `stream_account_balances` (300 registros/página); Dashboard/Tendências/sugestão usam `stream_financial_window`; Fluxo/Orçamento usam `read_projection_history` (páginas de 300 sem limite 20.000). GET de fatura e escrita de pagamento/crédito/reembolso usam filtros `card_id` indexados. **Calendário, listagem de cartões, outras rotas e agregados persistidos continuam pendentes**. Projeções ainda percorrem todos os documentos no Firestore, mas só retêm os necessários.
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

## Continuidade — Dashboard, Tendências e consulta de faturas (27/10/2026)

- **Dashboard:** substituído `db.transactions.find(...).to_list(20000)` e a segunda consulta dos seis recentes por **uma passagem** em páginas de 300, com `FinancialWindow` (`frontend/finnos/lib/financial_summaries.py`). Saldos usam `AccountLedger`, competência usa `month_portion`, estornos usam `credit_events` e somente categorias de compras historicamente referenciadas pelos estornos são retidas em memória. Os seis recentes preservam ordenação por data e criação. Menos uma leitura integral; ainda são lidos todos os documentos históricos uma vez.
- **Tendências:** `/analytics/trends` também usa `stream_financial_window`, consolidando até 24 meses com o mesmo contrato monetário em centavos e sem truncar aos 20 mil.
- **Faturas (GET):** `/cards/{card_id}/invoice` utiliza `read_card_purchases` com filtro `card_id` indexado por Firestore e páginas de 300 em ordem documental. Não mistura compras de outros cartões, mantém compras antigas de parcelas futuras e verifica revisão ao concluir. As operações **de pagamento, créditos, reembolsos e a listagem geral de cartões** continuam com as leituras legadas: não estão otimizadas neste lote.
- **Testes novos:** `test_financial_window_streaming.py` valida paridade contra `monthly_competency`, 20.007 movimentos, receitas sem reembolso fictício, parcelas antigas, ordenação de recentes, UID e escrita concorrente; `test_card_transaction_reads.py` cobre mais de 20 mil compras, isolamento por cartão/UID e revisão financeira. `test_shared_finance_ledger_parity.py` passa pelo novo Dashboard.
- **Gates pendentes:** nenhum agregado financeiro materializado foi gravado no Firestore; persiste custo O(histórico) no Dashboard/Tendências. Não há evidência de E2E autorizado com Firestore real/Preview do SHA final. Próximas frentes: Fluxo e Orçamento com projeções/recorrência sem perda de contexto, consultas transacionais de fatura com consistência e arquitetura de agregados incrementais versionados. Produção, Auth, Rules e dados reais inalterados.

## Continuidade — Fluxo, Orçamento e escrita atômica de faturas (27/10/2026)

- **Fluxo e Orçamento V1/V2:** `frontend/finnos/lib/projection_reads.py` varre o UID em páginas de 300 e só mantém em memória lançamentos do período, **todas** as fontes fixas, **todas** as parcelas e compras originais referenciadas por créditos/reembolsos. Esse conjunto é suficiente para `monthly_competency`, `monthly_pace`, `monthly_projection_sources`, `planned_subscriptions`, `_occurrences_in_cycle` e projeções de orçamento sem apagar precedência de parcelas antigas. O Fluxo (inclusive filtragem de categoria), Orçamento mensal e progresso do Orçamento V2 agora usam essa consulta sob revisão financeira.
- **Sugestão de orçamento:** eliminada leitura histórica inteira em memória, reutilizando o `FinancialWindow` mensal em uma passagem paginada para calcular exatamente os três meses anteriores (com créditos bancários fora de receita salarial).
- **Pagamentos/estornos/reembolsos:** criada `finnos.lib.db.card_purchase_rows` para buscar **somente compras do cartão** no índice `card_id`, usando a **mesma transação Firestore** de pagamento/crédito/reembolso. Regras imutáveis, idempotência, cálculo `invoice_state`, snapshots históricos e efeitos bancários não foram alterados. Manteve-se o limite conservador de 20.000 compras **do mesmo cartão** por transação: acima disso a escrita falha explicitamente com 413 e não executa pagamento parcial. Não realizar prefetch fora de transação de escrita.
- **Testes de segurança e regressão:** `test_projection_reads.py` cobre >20 mil registros, recorrência legada, mês explicitamente agendado, parcelas históricas, categoria de estorno, UID e alteração concorrente; `test_card_atomic_queries.py` comprova filtro por cartão, operação dentro da transação, limite fail-closed e rejeição de dados incorretos. Testes existentes de Fluxo, assinaturas, reembolsos e Orçamento V2 foram adaptados à nova interface e continuam exercitando cálculos idênticos.
- **Regressão adicional:** `test_invoice_payment_atomic_route.py` verifica idempotência do pagamento parcial, compra nova após antecipação, quitação na mesma fatura e ausência de débitos bancários repetidos, usando somente dados e transações Firestore sintéticos.
- **Criação e edição de cartão:** `frontend/finnos/routers/cards.py::_context_one_card` passou a obter somente as compras do cartão criado/alterado, com a revisão financeira e a consulta indexada existente. `test_card_mutation_context.py` confirma que nenhuma leitura global de transações é necessária. A **listagem geral de cartões** continua com o caminho legado e requer lote específico.
- **Pendências reais:** Firestore ainda cobra leitura de todo histórico por usuário no leitor de projeções; índices específicos, agregados financeiros incrementais/versionados, operações de fatura com mais de 20 mil compras no mesmo cartão, listagem geral de cartões e `/analytics/calendar` continuam fora deste lote. Validar tempo/índices em Preview com UID de teste autorizado. Nenhum código autorizou merge, mudança de Auth/Rules ou migração/correção dos dados reais.

## Continuidade — Calendário, cartões e agregados mensais shadow (27/10/2026)

- **Calendário:** calendar_month agora usa um único read_projection_history(uid,[mês],cards,revisão), removendo teto 5000 e rescans 20000. Entradas explícitas do mês alimentam os dias; parcelas de compras antigas com competência neste mês entram no dia mensal ajustado (29–31), sem inventar contagem de transações persistidas. Recorrências fixas sem lançamento explícito geram projeção apenas em datas futuras, com assinatura equivalente suprimida. Compras originais dos estornos permanecem para compensação. Testes test_calendar_paged_history.py (>5000 eventos) e test_calendar_installment_recurrence.py (parcela antiga, recorrência e assinatura).
- **Lista de cartões:** _context_all_cards usa read_card_purchases indexado para cada cartão, verificando finance_revision no início/fim. O contrato anterior _context foi restaurado para Radar/Simulação, mas usa essa seleção em vez de scan de todas as transações. Teste test_card_list_indexed.py cobre dois cartões e revisão concorrente. Trade-off: uma consulta paginada por cartão, não consulta única com batches.
- **Agregador v1 somente código:** monthly_aggregate_shadow.py implementa deltas incrementais em centavos exatos para criação/edição/exclusão de lançamentos e mudanças de créditos/reembolsos. Reusa month_portion, installment indices e credit_events. Snapshot versionado com SHA-256, finance_revision e status shadow_only. O escritor stage_shadow_snapshot requer aprovação explícita e revisão vigente e escreve apenas namespace isolado; NÃO é chamado pelos endpoints ou pelo adaptador ativo.
- **Reconciliação:** monthly_aggregate_shadow_reads.py reconstrói um candidato lendo todo o histórico em páginas de 300 e realiza uma segunda leitura independente com FinancialWindow, cruzando centavos, categorias, meses, contagens e revisão. Falha fechada em concorrência, drift e referências inválidas. Testes test_monthly_aggregate_shadow.py e test_monthly_aggregate_shadow_reads.py, inclusive >20k registros sintéticos.
- **Gates antes do uso real:** homologar emulador/Preview com UID de teste, instrumentar todos os caminhos de escrita transacional e offline, certificar baseline por revisão, comparar dual-read no mesmo SHA e observar custo/latência. Não existe ativação automática nem alteração de saldos reais. ARQ-02/FNS-002 continuam parciais até integração e aceite; produção e regras permanecem inalteradas.

## Continuidade — planos de mutação e bloqueio de ativação (27/10/2026)

- **Integridade reforçada:** `monthly_aggregate_shadow.py::snapshot` agora inclui `source_count` no SHA-256 quando disponível. `reconcile_months` rejeita contagem de transações divergente mesmo que o candidato tenha checksum recalculado. `stage_shadow_snapshot` exige **opt-in explícito e relatório da segunda reconciliação** com `match=True`, revisão e checksum exatos, todos os meses, contagem original e nenhuma divergência. A autorização sozinha não é suficiente para escrever. Essas funções continuam sem chamador no adaptador ativo/rotas.
- **Planejamento de deltas por evento:** `monthly_aggregate_mutations.py::apply_shadow_mutations` simula um lote atômico de alterações de lançamentos/cartões, exige `user_id` consistente em todas as pré/pós-imagens, revisão consecutiva e pré-imagem exata; cópia isolada impede alterar o agregado-base em caso de falha. Trata criação, edição, exclusão, replays/importação e atualização de ajustes/reembolsos. **Correção importante:** se a categoria de uma compra original estornada muda, recalcula o crédito na categoria nova do mês da devolução mesmo sem edição do cartão.
- **Testes e gate antiativação:** `test_monthly_aggregate_mutations.py` cobre cartão e recibo em um mesmo lote, recategorização retroativa, replay duplicado, exclusão de compra com crédito, revisão e tentativa de outro UID. `test_monthly_aggregate_shadow.py` cobre relatório obrigatório, checksum e contagem. `test_monthly_shadow_activation_guards.py` impede via CI importação dos agregados shadow ou acesso ao namespace de materialização por routers/adapter enquanto não houver decisão de cutover.
- **Não concluído:** os lotes ainda são **simulações puras**, não hooks persistentes nas escritas do Firestore. A certificação exige executar no emulador e Preview com UID sintético, cobrir operações offline/reembolso/importação e avaliar quotas/custos e conflitos. Não houve substituição dos cálculos oficiais, migração dos dados ou alteração em Auth/Rules/produção.

## Continuidade — ensaio transacional emulador shadow (27/10/2026)

- **Emulador e outbox isolados:** `finnos/lib/finance_shadow_outbox.py` prepara um envelope por revisão com deltas financeiros em centavos, sem dados originais completos; captura aceita apenas `FIRESTORE_EMULATOR_HOST`, projeto `demo-*` e UID `test-*`. Alterações de cartões/créditos são marcadas como `requires_rebuild` e reenvios sem alteração recebem evento `noop`, não um segundo débito.
- **Replay sem lacunas:** `finnos/lib/finance_shadow_replay.py` exige checksum/contagem do baseline, UID, sequência consecutiva e ausência de alterações de cartão para autorizar **somente cálculo de candidato**. Não ativa dashboards nem persiste agregados.
- **Testes reais HTTP e Firestore Emulator:** `finance-shadow-emulator.yml` executa `test_finance_shadow_emulator_live.py` e `test_finance_shadow_emulator_routes.py` em `demo-finnos`; validam endpoints HTTP de lançamentos, edição, exclusão, faturas, créditos, reembolsos e retries offline, revisão e dupla conciliação. O teste HTTP usa claims sintéticas isoladas, sem Firebase Auth real. Testes unitários de outbox/replay cobrem revisões ausentes e dados inválidos. Documentação em `docs/finance/SHADOW-EMULATOR-GATE-20261027.md`.
- **Adaptador transacional integrado em modo OFF:** `db.atomic` liga `finance_shadow_outbox.begin/finish/end` à mesma transação/revisão (contexto isolado por tentativa/retry); `history.record_event` captura mudanças de CRUD e cartões, e faturas de pagamento/reembolso emitem evento de cartão com `requires_rebuild=True`. A captura só escreve no projeto `demo-*` com `FIRESTORE_EMULATOR_HOST`, UID `test-*` e flag explícita; ausência de flag = zero writes shadow. Não há leitura de agregados pelas telas nem escrita em Firestore real.
- **Observação:** namespace do outbox é **exclusivamente demonstrativo**; sua presença não é prova de fonte certificada. Compras de cartão sempre exigem reconstrução, pois a compra original pode ter créditos em meses posteriores. Agregados históricos e UI financeira permanecem intocados. Ainda faltam provas de concorrência/quotas/cobertura Auth real e cutover versionado antes de habilitar qualquer leitura materializada.

## Ciclo P0/P1 de 28/10/2026 — código entregue; aceite real ainda pendente

Consultar **[LOTE-P0-P1-20261028.md](./LOTE-P0-P1-20261028.md)** para arquivos, testes, limitações e critérios de aceite de cada prioridade. Esta seção prevalece sobre estados históricos descritos acima, sem apagar o registro original.

- **ARQ-02/FNS-002 — avanço emulador:** certificação por duas leituras independentes da revisão, persiste baseline isolado (opt-in só em `demo-*`/`test-*`), recupera lacunas do outbox por rebuild completo e elimina meses removidos. **Continua parcial**: sem acesso às leituras do Dashboard e sem prova de concorrência/custo em Firestore real.
- **FIN-03/07/08/13/14 — avanço parcial:** novas séries fixas têm `recurrence_id` determinístico; planejador puro admite mudanças esta/próximas/todas futuras sem alterar histórico pago; Radar e Simulação compartilham projeção de caixa em centavos. **Ainda parcial**: o fluxo de edição por escopo não está ligado ao formulário ou a uma escrita atômica de série; sem migração automática do legado ou paridade global Python/TS.
- **SYNC-01/02/FNS-007 — avanço parcial:** CRUD de quatro cadastros aceita versões/recibos idempotentes; a fila TS prepara update/delete UID-scoped; regressão sintética e HTTP emulador exercitam reenvios. **Ainda parcial**: integração dos formulários offline e ensaio PWA/reconexão em navegador real.
- **FNS-011 — avanço em código:** headers de segurança API e preservação do smoke HTML; **FNS-008/012 e ARQ-08 pendentes**: Rules reais, rate limiting distribuído, observabilidade e autenticação real.
- **FNS-003/010/017 — avanço parcial UX/performance:** code splitting de rotas, dashboards e Registro Inteligente móvel, estados de erro Radar/Patrimônio; **FNS-004 e FIN-15 pendentes**, revisão visual e responsiva real pendente.
- **Gate:** PR #47 continua Draft, nenhuma mudança de produção/Rules/Auth, nenhuma ativação de agregado materializado como fonte de saldos. Registrar o CI no SHA final antes de classificar qualquer item como homologado.

## Regra de manutenção
Toda implementação futura deve atualizar a linha correspondente: **estado → arquivo/commit/teste → evidência Preview/Firestore → aceite**. Não apagar itens por parecerem duplicados; registrar a equivalência (ex.: FNS-021 ↔ FIN-15) e manter o vínculo. Alterar estados para "homologado" somente após os gates completos.
