"""Funds check for money leaving an account (invoice payment, transfer).

Approved rule (12/11/2026): an operation that would take the realized balance
below zero is refused, unless the account has an overdraft limit (cheque
especial) registered, the balance after the operation stays within that limit
and the person explicitly confirmed (``allow_overdraft``).

The balance is computed *inside* the caller's Firestore transaction. Every
finance write of a user also reads and bumps ``_meta/finance``, so two
operations on the same account serialize: the second one re-reads the
balance on retry and is refused if it no longer fits.
"""
from __future__ import annotations

from decimal import Decimal

from fastapi import HTTPException

from finnos.lib import db as store
from finnos.lib.money import D, cents, quantize_brl
from finnos.lib.stats import balance_effects


def balance_in_transaction(instance, uid: str, account: dict, transaction, today: str,
                           exclude_id: str | None = None) -> Decimal:
    total = D(account.get("initial_balance") or D("0.0"))
    for tx in store.account_movement_rows(instance, uid, account["id"], transaction):
        if tx["id"] == exclude_id:
            continue
        for account_id, amount in balance_effects(tx, today):
            if account_id == account["id"]:
                total += amount
    return quantize_brl(total)


def overdraft_limit_cents(account: dict) -> int:
    value = account.get("overdraft_limit")
    return 0 if value in (None, "") else max(0, cents(value))


def _brl(value_cents: int) -> str:
    whole, frac = divmod(abs(value_cents), 100)
    sign = "-" if value_cents < 0 else ""
    return f"{sign}R$ {whole:,}".replace(",", ".") + f",{frac:02d}"


def ensure_funds(balance: Decimal, amount_cents: int, account: dict, *, allow_overdraft: bool) -> None:
    """Raise 422 when ``amount_cents`` does not fit; detail carries the numbers."""
    available = cents(balance)
    after = available - amount_cents
    if after >= 0:
        return
    limit = overdraft_limit_cents(account)
    detail = {
        "code": "saldo_insuficiente",
        "message": f"Saldo insuficiente em {account.get('name') or 'conta'}: disponível {_brl(available)}.",
        "available": available / 100,
        "amount": amount_cents / 100,
        "overdraft_limit": limit / 100,
    }
    if limit and after >= -limit:
        if allow_overdraft:
            return
        detail.update(code="confirmar_cheque_especial",
                      message=f"Vai usar {_brl(-after)} do cheque especial. Confirme para continuar.")
    raise HTTPException(422, detail)
