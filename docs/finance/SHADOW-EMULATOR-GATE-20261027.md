# FINNOS — Gate de captura transacional shadow (27/10/2026)

**Estado:** experimental; **somente testes sintéticos no Firestore Emulator**. Nenhum agregado shadow pode substituir os totais do Dashboard/Fluxo/Orçamento ou ficar ativo em um UID de produção.

## O que foi implementado

- `finnos/lib/finance_shadow_outbox.py`: envelope de eventos por revisão financeira, capturando em centavos os deltas de transações criadas, editadas e excluídas; preserva revisões sem alterações (respostas offline idempotentes). Alterações em cartão, estornos ou dados insuficientes declaram `requires_rebuild=True`.
- `finnos/lib/finance_shadow_replay.py`: replay somente leitura que exige UID sintético, baseline com checksum e `source_count`, revisões estritamente consecutivas e envelopes íntegros. Qualquer lacuna, evento de cartão ou estorno interrompe o replay e exige reconstrução e segunda conferência.
- `test_finance_shadow_outbox.py` e `test_finance_shadow_replay.py`: deltas exatos, UID, criação/edição/exclusão, operações repetidas, revisões ausentes e rollback de contextos.
- `test_finance_shadow_emulator_live.py`: prova transacional isolada no `demo-finnos`: compra de cartão e crédito exigem reconstrução completa, sem replay inseguro, seguidos de leitura integral e reconciliação independente.
- `test_finance_shadow_emulator_routes.py`: chama os endpoints HTTP reais no aplicativo FastAPI com autenticação **simulada exclusivamente em teste**, validação dos payloads, controle de origem e Firestore Emulator real: criação/edição/exclusão, idempotência offline, conflitos de versão, pagamentos de fatura, crédito e reembolso, todas as revisões/outbox e duplo recálculo.
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
  'FIRESTORE_EMULATOR_HOST=127.0.0.1:8089 python -m pytest -q frontend/finnos/tests/test_finance_shadow_emulator_live.py frontend/finnos/tests/test_finance_shadow_emulator_routes.py'
```

A captura recusa configuração inesperada: só aceita `FINNOS_SHADOW_OUTBOX_MODE=emulator`, `FIRESTORE_EMULATOR_HOST`, `FIREBASE_PROJECT_ID=demo-*` e UID `test-*`. Sem configuração, o mecanismo não realiza operação alguma.

## Limitações de segurança e gates pendentes

1. **Integração efetuada, inativa por padrão:** `db.atomic` executa o invólucro opcional `finance_shadow_outbox.begin/finish/end` em cada tentativa de transação; `history.record_event` captura os deltas. Pagamento e reembolso sinalizam alteração de cartão para reconstrução. Com `FINNOS_SHADOW_OUTBOX_MODE` ausente não há gravação adicional. Com configuração inconsistente retorna HTTP 503 antes da operação.
2. **Apenas emulador sintético:** a única modalidade habilitável exige `FIRESTORE_EMULATOR_HOST`, `FIREBASE_PROJECT_ID=demo-*` e `user_id=test-*`. Os testes reais de API utilizam claims sintéticas por monkeypatch, **não homologam Firebase Auth real**.
3. **Fontes de saldos inalteradas:** o outbox registra eventos de mutação, mas **não** é fonte certificada do Dashboard, Fluxo, Orçamento ou cartão. Em alterações de compras de cartão, crédito e estorno, `requires_rebuild=True` bloqueia replay simplificado porque compensações podem ocorrer em outros meses. Apenas um histórico completo mais segunda conciliação pode subsidiar um agregado.
4. **Pendências antes da produção:** validar com testes ampliados de concorrência, limites/quotas, segurança Auth real, reconciliação de histórico legado, observabilidade de falhas e política de recuperação de revisões ausentes. Nenhum dado real foi migrado nem gravado. O controle `test_monthly_shadow_activation_guards.py` impede que as rotas de leitura consumam agregados não certificados.

**Não autoriza:** merge, deploy, Firestore de produção, alteração Auth/Rules ou migração de histórico financeiro.
