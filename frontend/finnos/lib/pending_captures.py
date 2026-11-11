"""Compras pendentes: o que o Apple Pay (ou outro atalho) captou e ainda não virou lançamento.

O Atalho manda a compra para o servidor; ela fica aqui, só do usuário, até ele registrar
(vira um lançamento comum) ou excluir. Nada some por fechar o app ou por chegar com o app
aberto, e nada entra no saldo antes da confirmação.

Também responde "de onde saiu o dinheiro?": compara o cartão informado pelo Apple Pay com os
cartões e contas cadastrados e diz se ele existe, para a pessoa nunca registrar na conta errada
sem perceber.
"""
import hashlib
from datetime import datetime, timezone
from decimal import Decimal

from finnos.lib import db as store
from finnos.lib.integration_tokens import normalize

COLLECTION = "pending_captures"
# Pending purchases waiting at once per user: far more than a person leaves unreviewed.
MAX_PENDING = 100
SOURCES = {"cartao", "conta", "desconhecido"}


def pending_id(uid: str, operation_id: str) -> str:
    """The same capture sent twice is the same document."""
    return hashlib.sha256((uid + "|" + operation_id).encode()).hexdigest()[:32]


def find_wallet(text: str | None, items: list[dict]) -> dict | None:
    """Finds a card/account by the name the phone sent, ignoring case and accents.

    Exact name first; otherwise a single partial match ("Nubank" finds "Nubank Roxinho").
    Several partial matches, or none, is "not found": the person chooses, we never guess.
    """
    wanted = normalize(text or "")
    if not wanted:
        return None
    exact = [i for i in items if normalize(i.get("name", "")) == wanted]
    if exact:
        return exact[0]
    partial = [i for i in items if wanted in normalize(i.get("name", "")) or normalize(i.get("name", "")) in wanted]
    if len(partial) == 1:
        return partial[0]
    if partial:
        return None
    # Words in common: the phone says "Pluxee Refeição", the person registered "VR Refeição" or
    # "Refeição Pluxee". The single wallet sharing the most meaningful words wins; a tie is "not found".
    words = _words(wanted)
    if not words:
        return None
    scored = sorted(((len(words & _words(normalize(i.get("name", "")))), i) for i in items), key=lambda x: -x[0])
    best = [i for n, i in scored if n and n == scored[0][0]]
    return best[0] if len(best) == 1 else None


# Words that say nothing about which wallet it is.
_GENERIC = {"cartao", "cartoes", "card", "conta", "credito", "debito", "de", "do", "da", "dos", "das", "e", "the", "visa", "master", "mastercard", "elo"}


def _words(text: str) -> set[str]:
    return {w for w in "".join(c if c.isalnum() else " " for c in text).split() if len(w) >= 3 and w not in _GENERIC}


def identify_source(text: str | None, accounts: list[dict], cards: list[dict]) -> dict:
    """Where the money comes out, and whether that wallet is registered in FINNOS.

    Apple Pay names the card, so a card wins over an account with a similar name. The answer is
    always filled in so the app can show it without guessing:
      kind        "cartao" | "conta" | "desconhecido"
      registered  the card/account exists in FINNOS
      id / name   the card or account found (None when not registered)
      pays_from   for a card, the account that pays its invoice
    When it is not registered the person registers it (a card or an account named like Apple Pay
    names it, so the next purchase matches by itself) or points this purchase at another wallet.
    """
    sent = (text or "").strip()
    card = find_wallet(sent, cards)
    if card:
        return _found("cartao", card, accounts, sent)
    account = find_wallet(sent, accounts)
    if account:
        return _found("conta", account, accounts, sent)
    return {"kind": "desconhecido", "registered": False, "id": None, "name": None, "pays_from": None, "sent": sent}


def _found(kind: str, wallet: dict, accounts: list[dict], sent: str) -> dict:
    paid_by = next((a for a in accounts if a["id"] == wallet.get("payment_account_id")), None) if kind == "cartao" else None
    return {"kind": kind, "registered": True, "id": wallet["id"], "name": wallet["name"], "pays_from": paid_by["name"] if paid_by else None, "sent": sent}


def origin_label(source: dict) -> str:
    """One line for the screen: where the money comes from, in plain Portuguese."""
    if source["kind"] == "cartao":
        paid = f" · fatura paga por {source['pays_from']}" if source.get("pays_from") else " · sem conta de pagamento"
        return f"Cartão {source['name']}{paid}"
    if source["kind"] == "conta":
        return f"Conta {source['name']}"
    if source.get("sent"):
        return f"“{source['sent']}” não está cadastrado no FINNOS"
    return "Sem cartão informado pelo Apple Pay"


def new_document(uid: str, operation_id: str, *, name: str, value: Decimal, date: str, source: dict, token: str | None, is_test: bool = False) -> dict:
    return {
        "id": pending_id(uid, operation_id),
        "operation_id": operation_id,
        "name": name,
        "value_cents": int((value * 100).to_integral_value()),
        "date": date,
        "source": source,
        "origin": "ios_shortcut",
        "is_test": is_test,
        "token": token,
        "created_at": datetime.now(timezone.utc),
    }


# --- Learning: merchant → category, Apple Pay card name → wallet ------------
#
# Every purchase the person registers teaches two small rules:
#   comerciante  "mercado do ernesto" → category used, how many times in a row, typical value
#   cartao       "nubank" (as Apple Pay names it) → account for débito, card for crédito
# They only *pre-fill* the next purchase. Débito is always the default and the person confirms
# débito or crédito every time; registering on its own is a separate, gradual step (AUTO_AFTER).

RULES = "capture_rules"
# Same answer this many times in a row before "registrar sozinho" may act on it.
AUTO_AFTER = 3
# A purchase above this multiple of the merchant's usual value always waits for the person.
AUTO_MAX_RATIO = 2
# "PAG*", "MP*", "IFD*"...: the payment processor, not the merchant.
_PROCESSORS = {"pag", "pg", "mp", "mercadopago", "mercpago", "ifd", "sumup", "pagseguro", "pagseg", "ps", "picpay", "ec", "stone", "cielo", "rede", "gn", "ppro", "dl"}
_LEGAL = {"ltda", "me", "mei", "eireli", "epp", "sa", "s/a", "cia"}


def merchant_key(name: str | None) -> str:
    """"MERCADO DO ERNESTO 0231", "Mercado do Ernesto" and "PAG*Mercado do Ernesto" are one merchant.

    Lowercase, no accents, no processor prefix, no tokens with digits (store codes, terminals,
    dates), no legal suffixes, no punctuation.
    """
    import re

    text = normalize(name or "")
    if "*" in text:
        head, tail = text.split("*", 1)
        if head.strip() in _PROCESSORS and tail.strip():
            text = tail
    words = [w for w in re.split(r"[^a-z0-9]+", text) if w]
    kept = [w for w in words if not any(ch.isdigit() for ch in w) and w not in _LEGAL]
    return " ".join(kept) or " ".join(words)


def card_key(sent: str | None) -> str:
    return normalize(sent or "")


def rule_id(kind: str, key: str) -> str:
    return ("m-" if kind == "comerciante" else "c-") + hashlib.sha256(key.encode()).hexdigest()[:24]


def empty_rules() -> dict:
    return {"merchants": {}, "cards": {}}


def suggest(sent: str | None, merchant: str, rules: dict, accounts: list[dict], cards: list[dict]) -> dict:
    """What the screen pre-fills for a purchase. Débito is always the default method.

      debit_account_id  learned account for this Apple Pay card name, else the account with that
                        name, else the account that pays the card with that name
      credit_card_id    learned card, else the card with that name
      category_id       learned for this merchant (None when never registered)
    """
    active_accounts = {a["id"]: a for a in accounts if a.get("active", True)}
    active_cards = {c["id"]: c for c in cards if c.get("active", True)}
    found = identify_source(sent, accounts, cards)
    card_rule = rules["cards"].get(card_key(sent)) if card_key(sent) else None
    merchant_rule = rules["merchants"].get(merchant_key(merchant))

    debit = None
    if card_rule and card_rule.get("debit_account_id") in active_accounts:
        debit = card_rule["debit_account_id"]
    elif found["kind"] == "conta":
        debit = found["id"]
    elif found["kind"] == "cartao":
        payer = next((c.get("payment_account_id") for c in cards if c["id"] == found["id"]), None)
        debit = payer if payer in active_accounts else None

    credit = None
    if card_rule and card_rule.get("credit_card_id") in active_cards:
        credit = card_rule["credit_card_id"]
    elif found["kind"] == "cartao":
        credit = found["id"]

    # Ambiguous: Apple Pay's name is both one of the person's accounts and one of their cards
    # ("Nubank" the account, "Nubank Roxinho" the card). Débito or crédito must be chosen every
    # time, never assumed, never registered in batch or automatically.
    ambiguous = bool(find_wallet(sent, cards) and find_wallet(sent, accounts))
    return {
        "method": "debito",
        "ambiguous": ambiguous,
        "debit_account_id": debit,
        "credit_card_id": credit,
        "category_id": (merchant_rule or {}).get("category_id"),
        "learned_wallet": bool(card_rule),
        "learned_category": bool(merchant_rule and merchant_rule.get("category_id")),
    }


def learn(rules: dict, *, merchant: str, label: str, category_id: str | None, value_cents: int,
          sent: str | None, method: str, wallet_id: str) -> list[dict]:
    """Updates the rules after the person registers a purchase. Returns the rules to store."""
    changed = []
    mkey = merchant_key(merchant)
    if mkey:
        old = rules["merchants"].get(mkey) or {"id": rule_id("comerciante", mkey), "kind": "comerciante", "key": mkey, "streak": 0, "count": 0, "total_cents": 0}
        same = bool(category_id) and old.get("category_id") == category_id
        rule = {**old, "label": label, "category_id": category_id or old.get("category_id"),
                "streak": (old.get("streak", 0) + 1) if same else (1 if category_id else 0),
                "count": old.get("count", 0) + 1, "total_cents": old.get("total_cents", 0) + int(value_cents)}
        rules["merchants"][mkey] = rule
        changed.append(rule)
    ckey = card_key(sent)
    if ckey:
        old = rules["cards"].get(ckey) or {"id": rule_id("cartao", ckey), "kind": "cartao", "key": ckey, "debit_streak": 0}
        rule = {**old, "sent": (sent or "").strip(), "last_method": method}
        if method == "credito":
            rule.update(credit_card_id=wallet_id, debit_streak=0)
        else:
            same = old.get("last_method") == "debito" and old.get("debit_account_id") == wallet_id
            rule.update(debit_account_id=wallet_id, debit_streak=(old.get("debit_streak", 0) + 1) if same else 1)
        rules["cards"][ckey] = rule
        changed.append(rule)
    return changed


def unlearn(rules: dict, *, merchant: str, sent: str | None) -> list[dict]:
    """"Desfazer" on a purchase registered on its own: that combination starts over."""
    changed = []
    mrule = rules["merchants"].get(merchant_key(merchant))
    if mrule:
        mrule = {**mrule, "streak": 0}
        rules["merchants"][mrule["key"]] = mrule
        changed.append(mrule)
    crule = rules["cards"].get(card_key(sent)) if card_key(sent) else None
    if crule:
        crule = {**crule, "debit_streak": 0}
        rules["cards"][crule["key"]] = crule
        changed.append(crule)
    return changed


def auto_choice(capture: dict, rules: dict, accounts: list[dict], cards: list[dict] | None = None,
                hold_unusual: bool = True) -> dict | None:
    """The débito account and category to use when registering automatically, or None to wait.

    Only a combination the person confirmed AUTO_AFTER times in a row, always in débito, from an
    active account, for a merchant with the same category every time. Never crédito, never a card
    name that is both an account and a card. A value above AUTO_MAX_RATIO times the merchant's
    usual waits too, unless the person turned that off (hold_unusual=False): then it is registered
    and marked "unusual" so it stands out.
    Returns {"account_id", "category_id", "unusual"}.
    """
    sent = (capture.get("source") or {}).get("sent")
    crule = rules["cards"].get(card_key(sent)) if card_key(sent) else None
    mrule = rules["merchants"].get(merchant_key(capture.get("name")))
    if not crule or not mrule:
        return None
    if cards is not None and find_wallet(sent, cards) and find_wallet(sent, accounts):
        return None
    if crule.get("last_method") != "debito" or crule.get("debit_streak", 0) < AUTO_AFTER:
        return None
    if not any(a["id"] == crule.get("debit_account_id") and a.get("active", True) for a in accounts):
        return None
    if not mrule.get("category_id") or mrule.get("streak", 0) < AUTO_AFTER:
        return None
    usual = mrule.get("total_cents", 0) / max(1, mrule.get("count", 0))
    unusual = bool(usual) and capture["value_cents"] > AUTO_MAX_RATIO * usual
    if unusual and hold_unusual:
        return None
    return {"account_id": crule["debit_account_id"], "category_id": mrule["category_id"], "unusual": unusual}


# --- Firestore: server-only. Tests replace these functions. -----------------

def _collection(db, uid: str):
    return store.root(db, uid).collection(COLLECTION)


def save(uid: str, doc: dict) -> tuple[dict, bool]:
    """Stores a capture. Returns (document, created); created is False for a repeated send."""
    from google.api_core.exceptions import AlreadyExists

    db = store.client()
    ref = _collection(db, uid).document(doc["id"])
    try:
        ref.create(doc)
        return doc, True
    except AlreadyExists:
        existing = ref.get()
        return (existing.to_dict() if existing.exists else doc), False


def count(uid: str) -> int:
    return sum(1 for _ in _collection(store.client(), uid).select([]).stream())


def list_all(uid: str) -> list[dict]:
    rows = [d.to_dict() for d in _collection(store.client(), uid).limit(MAX_PENDING + 1).stream()]
    return sorted(rows, key=lambda r: (r.get("date") or "", str(r.get("created_at"))), reverse=True)


def get(uid: str, capture_id: str) -> dict | None:
    snap = _collection(store.client(), uid).document(store.resource_id(capture_id)).get()
    return snap.to_dict() if snap.exists else None


def remove(uid: str, capture_id: str) -> bool:
    ref = _collection(store.client(), uid).document(store.resource_id(capture_id))
    if not ref.get().exists:
        return False
    ref.delete()
    return True


def _rules(db, uid: str):
    return store.root(db, uid).collection(RULES)


def learned(uid: str) -> dict:
    rules = empty_rules()
    for snap in _rules(store.client(), uid).limit(2000).stream():
        rule = snap.to_dict() or {}
        bucket = "merchants" if rule.get("kind") == "comerciante" else "cards"
        if rule.get("key"):
            rules[bucket][rule["key"]] = rule
    return rules


def save_rules(uid: str, changed: list[dict]) -> None:
    db = store.client()
    for rule in changed:
        _rules(db, uid).document(rule["id"]).set(rule)


# Purchases registered on their own, kept so the person can confirm or undo them.
AUTO_LOG = "pending_auto"
AUTO_LOG_DAYS = 7


def auto_log_save(uid: str, entry: dict) -> None:
    store.root(store.client(), uid).collection(AUTO_LOG).document(entry["id"]).set(entry)


def auto_log_list(uid: str) -> list[dict]:
    rows = [d.to_dict() for d in store.root(store.client(), uid).collection(AUTO_LOG).limit(50).stream()]
    return sorted(rows, key=lambda r: str(r.get("created_at")), reverse=True)


def auto_log_get(uid: str, entry_id: str) -> dict | None:
    snap = store.root(store.client(), uid).collection(AUTO_LOG).document(store.resource_id(entry_id)).get()
    return snap.to_dict() if snap.exists else None


def auto_log_remove(uid: str, entry_id: str) -> bool:
    ref = store.root(store.client(), uid).collection(AUTO_LOG).document(store.resource_id(entry_id))
    if not ref.get().exists:
        return False
    ref.delete()
    return True


# --- Settings ----------------------------------------------------------------

# hold_unusual: a value far above the merchant's usual waits for review even with auto on.
DEFAULT_SETTINGS = {"auto_register": False, "hold_unusual": True}


def _settings(db, uid: str):
    return store.root(db, uid).collection("pending_settings").document("prefs")


def get_settings(uid: str) -> dict:
    snap = _settings(store.client(), uid).get()
    return {**DEFAULT_SETTINGS, **(snap.to_dict() if snap.exists else {})}


def save_settings(uid: str, patch: dict) -> dict:
    merged = {**get_settings(uid), **{k: v for k, v in patch.items() if k in DEFAULT_SETTINGS and v is not None}}
    _settings(store.client(), uid).set(merged)
    return merged


# --- Telling the person ------------------------------------------------------

def waiting_days(created_at, now: datetime | None = None) -> int:
    """Whole days a purchase has been waiting; 0 when unknown."""
    if not isinstance(created_at, datetime):
        return 0
    moment = now or datetime.now(timezone.utc)
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)
    return max(0, (moment - created_at).days)


def alert(uid: str, title: str, body: str, url: str = "/") -> int:
    """Best-effort Web Push to the person's devices. Returns how many were sent; never raises.

    Does nothing when push is not configured on this deployment (FINNOS_PUSH_ENABLED and VAPID
    keys). The capture is already saved by then, so a failure here only means no alert.
    """
    import logging

    from finnos.lib import push_transport as push

    if not push.ready():
        return 0
    sent = 0
    try:
        for item in store.client().collection("finnos_push_registrations").where("uid", "==", uid).limit(10).stream(timeout=15):
            data = item.to_dict() or {}
            if data.get("subscription") and data.get("enabled"):
                try:
                    push.send(data["subscription"], {"title": title, "body": body, "url": url})
                    sent += 1
                except Exception:
                    logging.getLogger(__name__).warning("pending push failed", exc_info=True)
    except Exception:
        logging.getLogger(__name__).warning("pending push lookup failed", exc_info=True)
    return sent
