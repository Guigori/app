from dataclasses import dataclass
from typing import Callable, Optional

EVENT_DEPENDENCIES = {
    "transaction.created": ("transactions", "cards", "budgets", "liquidity", "forecast", "attention"),
    "transaction.updated": ("transactions", "cards", "budgets", "liquidity", "forecast", "attention"),
    "transaction.deleted": ("transactions", "cards", "budgets", "liquidity", "forecast", "attention"),
    "budget.changed": ("budgets", "liquidity", "forecast", "attention"),
    "card.changed": ("cards", "liquidity", "forecast", "attention"),
    "goal.changed": ("goals", "liquidity", "forecast", "attention"),
    "import.confirmed": ("transactions", "data_quality", "baseline", "forecast", "attention"),
}
_observer: Optional[Callable[[str, dict], None]] = None

@dataclass(frozen=True)
class FACEvent:
    event_id: str
    kind: str
    entity_id: str | None = None
    state_version: int = 1

def set_observer(observer):
    global _observer
    _observer = observer

def affected_modules(event_kind: str) -> tuple[str, ...]:
    if event_kind not in EVENT_DEPENDENCIES:
        if _observer:
            _observer("fac.unknown_event", {"event_kind": event_kind})
        raise ValueError(f"Unsupported FAC event kind: {event_kind}")
    return EVENT_DEPENDENCIES[event_kind]
