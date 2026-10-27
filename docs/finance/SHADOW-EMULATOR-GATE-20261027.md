# FINNOS — Gate de captura transacional shadow (27/10/2026)

**Estado:** experimental; **somente testes sintéticos no Firestore Emulator**. Nenhum agregado shadow pode substituir os totais do Dashboard/Fluxo/Orçamento ou ficar ativo em um UID de produção.

## O que foi implementado

- `finnos/lib/finance_shadow_outbox.py`: envelope de eventos por revisão financeira, capturando em centavos os deltas de transações criadas, editadas e excluídas; preserva revisões sem alterações (respostas offline idempotentes). Alterações em cartão, estornos ou dados insuficientes declaram `requires_rebuild=True`.
- `finnos/lib/finance_shadow_replay.py`: replay somente leitura que exige UID sintético, baseline com checksum e `source_count`, revisões estritamente consecutivas e envelopes íntegros. Qualquer lacuna, evento de cartão ou estorno interrompe o replay e exige reconstrução e segunda conferência.
- `test_finance_shadow_outbox.py` e `test_finance_shadow_replay.py`: deltas exatos, UID, criação/edição/exclusão, operações repetidas, revisões ausentes e rollback de contextos.
- `test_finance_shadow_emulator_live.py`: prova transacional **isolada** num projeto `demo-finnos`; verifica criação, alteração, cartão com crédito, revisão/noop, **replay dos envelopes persistidos em revisões consecutivas**, rejeição do replay quando aparece um crédito, reconstrução e dupla reconciliação. Usa credenciais anônimas, sem conta de serviço, e não é importada pelo servidor.
- `.github/workflows/finance-shadow-emulator.yml` executa o teste no emulador real com configuração em `.github/test-fixtures`; as regras permissivas nesse diretório são **exclusivamente do projeto demo** e jamais devem ser implantadas em produção.

## Como executar localmente, sem credenciais de produção

Requer Python 3.12, Java 21, Node 24 e Firebase CLI. Executar a partir da raiz do repositório:

```bash
python -m pip install -r frontend/requirements.txt pytest httpx
npm install -g firebase-tools
export FIREBASE_PROJECT_ID=demo-finnos
export FINNOS_SHADOW_OUTBOX_MODE=emulator
export PYTHONPATH=frontend
firebase emulators:exec \
  --project demo-finnos \
  --config .github/test-fixtures/firebase.shadow.json \
  --only firestore \
  'FIRESTORE_EMULATOR_HOST=127.0.0.1:8089 python -m pytest -q frontend/finnos/tests/test_finance_shadow_emulator_live.py'
```

A captura recusa configuração inesperada: só aceita `FINNOS_SHADOW_OUTBOX_MODE=emulator`, `FIRESTORE_EMULATOR_HOST`, `FIREBASE_PROJECT_ID=demo-*` e UID `test-*`. Sem configuração, o mecanismo não realiza operação alguma.

## Limitações de segurança e gates pendentes

1. **Ainda não conectado ao adaptador ativo.** A alteração do invólucro transacional de produção foi bloqueada; nenhum caminho de escrita real chama os hooks e nenhuma coleção shadow foi criada em produção. O harness do emulador chama `begin`, `capture_event`, `finish` e `end` explicitamente na mesma transação.
2. O outbox fornece intenção de alteração financeira, mas **não** uma fonte certificada de saldos. Sem uma conciliação completa e uma versão inicial aprovada, nenhum replay pode servir relatórios financeiros.
3. Ainda é obrigatório homologar todos os endpoints de gravação (CRUD, importações, edição/exclusão offline, pagamentos, créditos e reembolsos) com dados sintéticos, validar índices/quotas/conflitos e concluir a integração na transação canônica, sem adicionar leitura após a primeira escrita.
4. O controle `test_monthly_shadow_activation_guards.py` continua impedindo importação dos agregados pelas rotas atuais.

**Não autoriza:** merge, deploy, Firestore de produção, alteração Auth/Rules ou migração de histórico financeiro.
