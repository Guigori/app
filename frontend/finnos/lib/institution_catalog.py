"""Known institutions offered when registering a bank, card or benefit.

The catalog is a *picker*, not an alias table: a typed name only takes a
catalog color when it is exactly the catalog name (same normalized key). The
frontend keeps a copy for local mode (src/lib/institutionCatalog.ts); a test
keeps both in sync.
"""
from __future__ import annotations

from finnos.lib.institutions import institution_key

# id, name, color, kind
CATALOG: list[dict] = [
    {"id": "nubank", "name": "Nubank", "color": "#820AD1", "kind": "banco"},
    {"id": "itau", "name": "Itaú", "color": "#EC7000", "kind": "banco"},
    {"id": "bradesco", "name": "Bradesco", "color": "#CC092F", "kind": "banco"},
    {"id": "inter", "name": "Inter", "color": "#FF7A00", "kind": "banco"},
    {"id": "santander", "name": "Santander", "color": "#EC0000", "kind": "banco"},
    {"id": "bb", "name": "Banco do Brasil", "color": "#0038A8", "kind": "banco"},
    {"id": "caixa", "name": "Caixa", "color": "#005CA9", "kind": "banco"},
    {"id": "c6", "name": "C6 Bank", "color": "#242424", "kind": "banco"},
    {"id": "mercadopago", "name": "Mercado Pago", "color": "#009EE3", "kind": "banco"},
    {"id": "picpay", "name": "PicPay", "color": "#11C76F", "kind": "banco"},
    {"id": "pagbank", "name": "PagBank", "color": "#00A868", "kind": "banco"},
    {"id": "btg", "name": "BTG Pactual", "color": "#0A2240", "kind": "banco"},
    {"id": "xp", "name": "XP", "color": "#1C1C1C", "kind": "banco"},
    {"id": "sicredi", "name": "Sicredi", "color": "#3FA110", "kind": "banco"},
    {"id": "sicoob", "name": "Sicoob", "color": "#003641", "kind": "banco"},
    {"id": "neon", "name": "Neon", "color": "#0098DA", "kind": "banco"},
    {"id": "alelo", "name": "Alelo", "color": "#00A86B", "kind": "beneficio"},
    {"id": "pluxee", "name": "Pluxee", "color": "#0F4C81", "kind": "beneficio"},
    {"id": "ticket", "name": "Ticket", "color": "#E4002B", "kind": "beneficio"},
    {"id": "vr", "name": "VR", "color": "#00A651", "kind": "beneficio"},
    {"id": "caju", "name": "Caju", "color": "#FF5A5F", "kind": "beneficio"},
    {"id": "flash", "name": "Flash", "color": "#FF2E63", "kind": "beneficio"},
]

_BY_ID = {item["id"]: item for item in CATALOG}
_BY_KEY = {institution_key(item["name"]): item for item in CATALOG}

# Custom institutions get a stable color from their name; the person does not pick one.
FALLBACK_COLORS = ["#4B2CFF", "#0EA5E9", "#14B8A6", "#8C5BFF", "#F59E0B", "#EC4899", "#64748B", "#070F52"]


def catalog_item(catalog_id: str | None) -> dict | None:
    return _BY_ID.get(catalog_id or "")


def exact_catalog_match(name: str) -> dict | None:
    """Only the very same name (case/spacing aside) counts; never an alias."""
    return _BY_KEY.get(institution_key(name))


def fallback_color(name: str) -> str:
    # Same arithmetic as the frontend copy, so local and signed-in modes agree.
    key = institution_key(" ".join((name or "").split()))
    return FALLBACK_COLORS[sum(ord(ch) for ch in key) % len(FALLBACK_COLORS)]


def institution_identity(name: str, catalog_id: str | None = None) -> dict:
    """Name, color, kind and catalog id a new institution is stored with."""
    item = catalog_item(catalog_id) or exact_catalog_match(name)
    if item:
        return {"name": item["name"], "color": item["color"], "kind": item["kind"], "catalog_id": item["id"]}
    clean = " ".join((name or "").split())
    return {"name": clean, "color": fallback_color(clean), "kind": "outro", "catalog_id": None}
