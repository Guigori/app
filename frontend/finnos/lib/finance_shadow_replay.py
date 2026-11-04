"""Read-only, fail-closed shadow outbox replay over a certified seed.

No Firestore writes, no live routers, no automatic fallback to partial totals.
Only emulator-only revision envelopes can be applied. Card/refund events must
trigger a rebuilt and independently reconciled snapshot, not invented deltas.
"""
from copy import deepcopy
from fastapi import HTTPException

from finnos.lib.monthly_aggregate_shadow import (
    IncrementalMonthlyLedger, MonthTotals, SCHEMA_VERSION, snapshot_checksum,
)

EMPTY = MonthTotals().row()


def _row(value: dict) -> MonthTotals:
    if not isinstance(value, dict) or set(value) != set(EMPTY):
        raise HTTPException(409, "Estrutura do agregado desconhecida.")
    fields = ("income_cents", "expense_cents", "count")
    if any(type(value.get(key)) is not int for key in fields):
        raise HTTPException(409, "Centavos ou contagem inválidos.")
    categories = value["categories_cents"]
    if (not isinstance(categories, dict)
            or any(not isinstance(k, str) or type(v) is not int
                   for k, v in categories.items())):
        raise HTTPException(409, "Categorias do agregado inválidas.")
    return MonthTotals(
        income_cents=value["income_cents"],
        expense_cents=value["expense_cents"],
        count=value["count"],
        categories_cents=dict(categories),
    )


def replay_shadow_events(
    seed: dict, events: list[dict], *, user_id: str, target_revision: int,
) -> dict:
    """Replay complete consecutive envelopes into an untrusted shadow candidate.

    The seed is independently reconciled and has a source_count. Replays never
    grant production eligibility; all month totals need second-pass checking.
    """
    if (seed.get("schema_version") != SCHEMA_VERSION
            or seed.get("status") != "shadow_only"
            or seed.get("checksum") != snapshot_checksum(seed)
            or type(seed.get("source_count")) is not int
            or seed["source_count"] < 0):
        raise HTTPException(409, "Baseline shadow sem integridade verificável.")
    if (not isinstance(user_id, str) or not user_id.startswith("test-")
            or "/" in user_id
            or type(target_revision) is not int):
        raise HTTPException(403, "Replay financeiro autorizado somente para usuário sintético.")
    starting = seed.get("finance_revision")
    if type(starting) is not int or not starting <= target_revision:
        raise HTTPException(409, "Revisão inicial inválida.")

    ledger = IncrementalMonthlyLedger()
    for month, row in seed["months"].items():
        ledger.months[month] = _row(row)
    source_count = seed["source_count"]
    revision = starting
    for envelope in events:
        if (not isinstance(envelope, dict)
                or envelope.get("schema_version") != SCHEMA_VERSION
                or envelope.get("status") != "emulator_only"
                or envelope.get("user_id") != user_id
                or type(envelope.get("previous_revision")) is not int
                or type(envelope.get("finance_revision")) is not int
                or envelope["previous_revision"] != revision
                or envelope["finance_revision"] != revision + 1):
            raise HTTPException(409, "Eventos shadow fora de sequência ou de outro UID.")
        changed = envelope.get("events")
        if (not isinstance(changed, list)
                or envelope.get("is_noop") is not (len(changed) == 0)
                or envelope.get("requires_rebuild") is not
                any(isinstance(x, dict) and x.get("requires_rebuild") is True
                    for x in changed)):
            raise HTTPException(409, "Envelope shadow contraditório.")
        if envelope["requires_rebuild"]:
            raise HTTPException(
                409, "Mudança de cartão/estorno exige reconstrução integral."
            )
        for change in changed:
            if (change.get("entity") != "transactions"
                    or change.get("requires_rebuild") is not False
                    or type(change.get("source_count_delta")) is not int
                    or change["source_count_delta"] not in (-1, 0, 1)
                    or not isinstance(change.get("delta_months"), dict)):
                raise HTTPException(409, "Delta financeiro sem pré-imagem suficiente.")
            for month, raw in change["delta_months"].items():
                if not isinstance(month, str) or len(month) != 7:
                    raise HTTPException(409, "Mês financeiro inválido.")
                ledger._apply({month: _row(raw)}, 1)
            source_count += change["source_count_delta"]
            if source_count < 0:
                raise HTTPException(409, "Quantidade de lançamentos inconsistente.")
        revision += 1
    if revision != target_revision:
        raise HTTPException(409, "Histórico shadow incompleto; revisão ausente.")
    result = ledger.snapshot(revision, source_count=source_count)
    result["production_eligible"] = False
    return result
