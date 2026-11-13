"""Benefits (etapa 5): a benefit account holds up to 8 wallets ("cartão dentro
do cartão"), each with its own name, monthly amount, recharge day and balance.

Approved rules: unused balance always accumulates and never expires; a
wallet does not go negative unless configured; one default wallet for
everything, the person picks another one when registering; each recharge
has a key per wallet and competence, so running the job twice, opening the
app offline or reprocessing never creates a second recharge.
"""
from __future__ import annotations

import calendar
import hashlib
import re
import unicodedata
import uuid
from datetime import date, timedelta
from decimal import Decimal

from fastapi import HTTPException

from finnos.lib.money import D, cents, quantize_brl

MAX_WALLETS = 8


def _key(name: str) -> str:
    plain = unicodedata.normalize("NFKD", name.casefold())
    return " ".join("".join(c for c in plain if not unicodedata.combining(c)).split())


def normalize_wallets(wallets: list[dict] | None, existing: list[dict] | None = None, *, today: str,
                      in_use: set[str] | None = None) -> list[dict]:
    """Validate and complete the wallet list of a benefit account."""
    wallets = list(wallets or [])
    if len(wallets) > MAX_WALLETS:
        raise HTTPException(422, f"Um cartão de benefício tem no máximo {MAX_WALLETS} benefícios.")
    previous = {w["id"]: w for w in existing or []}
    seen: set[str] = set()
    out = []
    for raw in wallets:
        name = " ".join(str(raw.get("name") or "").split())
        if not 1 <= len(name) <= 40:
            raise HTTPException(422, "Cada benefício precisa de um nome com até 40 letras.")
        if _key(name) in seen:
            raise HTTPException(422, f"Já existe um benefício chamado {name}.")
        seen.add(_key(name))
        day = int(raw.get("day") or 0)
        if not 1 <= day <= 31:
            raise HTTPException(422, f"O dia da recarga de {name} precisa ser de 1 a 31.")
        amount = quantize_brl(D(raw.get("monthly_amount") or 0))
        if amount < 0:
            raise HTTPException(422, f"O valor mensal de {name} não pode ser negativo.")
        wallet_id = raw.get("id") if raw.get("id") in previous else None
        if raw.get("id") and not wallet_id and not re.fullmatch(r"[A-Za-z0-9_-]{1,40}", str(raw["id"])):
            raise HTTPException(422, "Identificador de benefício inválido.")
        wallet_id = wallet_id or raw.get("id") or uuid.uuid4().hex[:12]
        kept = previous.get(wallet_id, {})
        out.append({
            "id": wallet_id,
            "name": name,
            "monthly_amount": amount,
            "day": day,
            "allow_negative": bool(raw.get("allow_negative", kept.get("allow_negative", False))),
            "is_default": bool(raw.get("is_default")),
            # Recharges start in the month the wallet was created: nothing is back-filled.
            "start": kept.get("start") or str(raw.get("start") or today),
            "initial_balance": quantize_brl(D(raw.get("initial_balance", kept.get("initial_balance", 0)) or 0)),
        })
    removed = (set(previous) - {w["id"] for w in out}) & (in_use or set())
    if removed:
        raise HTTPException(409, "Benefício com histórico não pode ser removido; deixe o valor mensal em zero.")
    defaults = [w for w in out if w["is_default"]]
    if out and len(defaults) != 1:
        for index, wallet in enumerate(out):
            wallet["is_default"] = index == 0 if not defaults else wallet["id"] == defaults[0]["id"]
    return out


def default_wallet_id(account: dict) -> str | None:
    wallets = account.get("wallets") or []
    return next((w["id"] for w in wallets if w.get("is_default")), wallets[0]["id"] if wallets else None)


def wallet_of(tx: dict, account: dict) -> str | None:
    """The wallet a movement on this benefit account belongs to (legacy → default).

    A transfer into the account lands on ``to_wallet_id``; the source side uses ``wallet_id``.
    """
    ids = {w["id"] for w in account.get("wallets") or []}
    incoming = tx.get("type") == "transferencia" and tx.get("to_account_id") == account["id"]
    chosen = tx.get("to_wallet_id") if incoming else tx.get("wallet_id")
    return chosen if chosen in ids else default_wallet_id(account)


def wallet_balances(account: dict, movements: list[dict], today: str, exclude_id: str | None = None) -> dict[str, int]:
    """Per-wallet balance in cents; legacy movements without a wallet fall on the default."""
    from finnos.lib.stats import balance_effects

    balances = {w["id"]: cents(w.get("initial_balance") or 0) for w in account.get("wallets") or []}
    if not balances:
        return {}
    fallback = default_wallet_id(account)
    for tx in movements:
        if tx.get("id") == exclude_id:
            continue
        if (tx.get("type") == "transferencia" and tx.get("account_id") == tx.get("to_account_id") == account["id"]
                and tx.get("status") == "pago" and str(tx.get("date", "")) <= today):
            src = tx.get("wallet_id") if tx.get("wallet_id") in balances else fallback
            dst = tx.get("to_wallet_id") if tx.get("to_wallet_id") in balances else fallback
            balances[src] -= cents(tx["value"])
            balances[dst] += cents(tx["value"])
            continue
        for account_id, amount in balance_effects(tx, today):
            if account_id == account["id"]:
                balances[wallet_of(tx, account)] += cents(amount)
    return balances


def recharge_date(wallet: dict, year: int, month: int) -> date:
    return date(year, month, min(wallet["day"], calendar.monthrange(year, month)[1]))


def due_recharges(account: dict, today: date) -> list[tuple[dict, str, date]]:
    """(wallet, competence YYYY-MM, date) for this and last month that are due."""
    found = []
    for wallet in account.get("wallets") or []:
        if D(wallet.get("monthly_amount") or 0) <= 0:
            continue
        start = date.fromisoformat(str(wallet.get("start") or today.isoformat())[:10])
        months = [(today.year, today.month)]
        first = today.replace(day=1) - timedelta(days=1)
        months.insert(0, (first.year, first.month))
        for year, month in months:
            when = recharge_date(wallet, year, month)
            if when <= today and when >= start:
                found.append((wallet, f"{year:04d}-{month:02d}", when))
    return found


def recharge_id(uid: str, account_id: str, wallet_id: str, competence: str) -> str:
    return hashlib.sha256(f"{uid}:recharge:{account_id}:{wallet_id}:{competence}".encode()).hexdigest()


def recharge_doc(uid: str, account: dict, wallet: dict, competence: str, when: date, now) -> dict:
    return {
        "id": recharge_id(uid, account["id"], wallet["id"], competence), "user_id": uid,
        "name": f"Recarga {wallet['name']}", "value": quantize_brl(D(wallet["monthly_amount"])), "type": "receita",
        "status": "pago", "date": when.isoformat(), "account_id": account["id"], "wallet_id": wallet["id"],
        "card_id": None, "to_account_id": None, "category_id": None, "fixed": False, "installment": False,
        "benefit_recharge": True, "recharge_competence": competence, "source": "automation", "version": 1,
        "notes": f"Recarga de {competence[5:]}/{competence[:4]} do benefício {wallet['name']}.",
        "created_at": now, "updated_at": now,
    }


def pace(wallet: dict, balance_cents: int, movements: list[dict], account: dict, today: date) -> dict:
    """Daily allowance until the next recharge and when it runs out at the current pace."""
    following = recharge_date(wallet, today.year, today.month)
    if following <= today:
        nxt = (today.replace(day=28) + timedelta(days=4)).replace(day=1)
        following = recharge_date(wallet, nxt.year, nxt.month)
    days_left = max(1, (following - today).days)
    since = (today - timedelta(days=30)).isoformat()
    spent = 0
    for tx in movements:
        if (tx.get("type") == "despesa" and tx.get("status") == "pago" and tx.get("account_id") == account["id"]
                and wallet_of(tx, account) == wallet["id"] and since <= str(tx.get("date", "")) <= today.isoformat()):
            spent += cents(tx["value"])
    per_day = spent / 30
    runs_out = None
    if per_day > 0 and balance_cents > 0:
        runs_out_day = today + timedelta(days=int(balance_cents // per_day))
        if runs_out_day < following:
            runs_out = runs_out_day.isoformat()
    return {
        "next_recharge": following.isoformat(),
        "daily_allowance": max(0, balance_cents) / 100 / days_left,
        "runs_out_on": runs_out,
    }


def check_wallet_funds(balance_cents: int, amount_cents: int, wallet: dict) -> None:
    if wallet.get("allow_negative") or balance_cents - amount_cents >= 0:
        return
    from finnos.lib.account_funds import _brl

    raise HTTPException(422, {
        "code": "saldo_beneficio_insuficiente",
        "message": f"{wallet['name']} tem {_brl(max(balance_cents, 0))}. Divida o valor com outro benefício ou com uma conta.",
        "available": max(balance_cents, 0) / 100,
        "amount": amount_cents / 100,
        "wallet_id": wallet["id"],
    })


__all__ = [
    "MAX_WALLETS", "Decimal", "check_wallet_funds", "default_wallet_id", "due_recharges", "normalize_wallets", "pace",
    "recharge_doc", "recharge_id", "wallet_balances", "wallet_of",
]


def run_recharges(uid: str, today: date | None = None) -> list[dict]:
    """Create every due recharge that does not exist yet, in one finance transaction.

    The id is derived from (user, card, benefit, competence): the cron, the app
    opening on two phones and a retry all land on the same document, which is
    created only once. Returns the recharges created now.
    """
    from datetime import datetime, timezone

    from finnos.lib import db as store
    from finnos.lib.dates import today_iso
    from finnos.lib.history import record_event

    today = today or date.fromisoformat(today_iso())
    instance = store.client()

    def action(tr):
        owner = store.root(instance, uid)
        accounts = [dict(store.decode(s.to_dict()), id=s.id)
                    for s in owner.collection("accounts").where("type", "==", "beneficio").stream(transaction=tr)]
        pending = []
        for account in accounts:
            if account.get("active") is False:
                continue
            for wallet, competence, when in due_recharges(account, today):
                ref = owner.collection("transactions").document(recharge_id(uid, account["id"], wallet["id"], competence))
                pending.append((ref, account, wallet, competence, when))
        snaps = [ref.get(transaction=tr) for ref, *_ in pending]  # all reads before writes
        created = []
        now = datetime.now(timezone.utc)
        for (ref, account, wallet, competence, when), snap in zip(pending, snaps):
            if snap.exists:
                continue
            doc = recharge_doc(uid, account, wallet, competence, when, now)
            tr.create(ref, store.encode(doc))
            record_event(tr, owner, "transactions", "created", None, doc)
            created.append(doc)
        return created

    # Cheap pre-read: most calls find nothing due and should not touch the finance revision.
    owner = store.root(instance, uid)
    missing = False
    for snap in owner.collection("accounts").where("type", "==", "beneficio").stream():
        account = dict(store.decode(snap.to_dict()), id=snap.id)
        if account.get("active") is False:
            continue
        for wallet, competence, _ in due_recharges(account, today):
            if not owner.collection("transactions").document(recharge_id(uid, account["id"], wallet["id"], competence)).get().exists:
                missing = True
    if not missing:
        return []
    return store.atomic(instance, uid, action)
