"""FIN-03: prepare safe scoped edits of a persisted monthly recurrence.

Pure planning only: a caller must atomically verify the source revision,
validate account/card/category references and write the proposed document.
Never alter historical paid purchases as a side effect of forecast editing.
"""
from copy import deepcopy
from datetime import date
from uuid import NAMESPACE_URL, uuid5

from finnos.lib.money import cents

EDITABLE = frozenset({"name", "value", "account_id", "card_id", "category_id"})
SCOPES = frozenset({"esta", "proximas", "todas"})


def plan_recurrence_edit(
    source: dict, changes: dict, *, scope: str, effective_date: str,
    operation_id: str, uid: str, today: str,
) -> dict:
    if scope not in SCOPES:
        raise ValueError("Escopo de recorrência inválido.")
    try:
        day = date.fromisoformat(effective_date)
        current = date.fromisoformat(today)
        origin = date.fromisoformat(source["date"])
    except (ValueError, TypeError, KeyError) as exc:
        raise ValueError("Data de recorrência inválida.") from exc
    if (day < current or day < origin or not source.get("fixed")
            or source.get("installment") or source.get("invoice_payment")
            or source.get("type") == "transferencia"
            or source.get("recurrence", "mensal") != "mensal"):
        raise ValueError("Somente uma série mensal futura pode ser alterada.")
    if (source.get("user_id") != uid or not uid or "/" in uid
            or not operation_id or len(operation_id) > 200):
        raise ValueError("Identidade da série inválida.")
    if (not isinstance(changes, dict) or not changes
            or not set(changes).issubset(EDITABLE)):
        raise ValueError("Alterações de recorrência não autorizadas.")
    if "value" in changes and cents(changes["value"]) <= 0:
        raise ValueError("Valor de recorrência inválido.")

    series_id = source.get("recurrence_id")
    if not series_id:
        raise ValueError(
            "Série antiga sem identificador estável; reconcilie antes de editar."
        )
    if scope == "todas" and (source.get("status") == "pago" or day != origin):
        raise ValueError(
            "Não é permitido reescrever lançamentos pagos ou meses anteriores."
        )
    updated = deepcopy(source)
    updated.update(changes)
    updated["recurrence_id"] = series_id
    if scope == "todas":
        # Only mutable, future-dated roots may be changed in place.
        return {"action": "replace", "before": source, "after": updated}
    # A one-off change suppresses only the targeted month's projected series.
    # From this month forward, a new fixed root supersedes the older source,
    # while both retain the same durable series ID.
    updated["id"] = str(uuid5(
        NAMESPACE_URL,
        f"finnos:{uid}:{series_id}:{scope}:{effective_date}:{operation_id}",
    ))
    updated["date"] = effective_date
    updated["status"] = "agendado"
    updated["fixed"] = scope == "proximas"
    updated["version"] = 1
    updated["operation_id"] = operation_id
    updated.pop("invoice_cycles", None)
    return {"action": "create", "before": None, "after": updated}
