"""Etapa 2 (approved effects table, 12/11/2026): partial payment carries the
rest to the next invoice, funds/cheque especial check, payment undo with a
linked reversal, transfer funds check. Synthetic Firestore doubles."""
import asyncio
import copy
from decimal import Decimal

import pytest
from fastapi import HTTPException

from finnos.lib import db as store
from finnos.lib.account_funds import ensure_funds
from finnos.lib.invoices import commitment, invoice_state, next_cycle
from finnos.models.notify import PayInvoiceIn
from finnos.routers import cards as cards_router
from finnos.routers.cards import pay_invoice, undo_invoice_payment


class Ref:
    def __init__(self, name, data=None):
        self.name = name
        self.data = copy.deepcopy(data)

    def get(self, transaction=None):
        parent = self
        return type("Snap", (), {
            "exists": parent.data is not None,
            "to_dict": lambda self: copy.deepcopy(parent.data),
        })()


CARD = {"id": "card", "name": "Nubank", "closing_day": 29, "due_day": 7, "invoice_cycles": {}}
PURCHASE = {"id": "p1", "name": "Mercado", "date": "2026-10-10", "value": Decimal("100.00"),
            "card_id": "card", "type": "despesa", "status": "pago", "installment": False}


def world(monkeypatch, *, balance="1000.00", overdraft=None, today="2026-11-12"):
    card = Ref("cards:card", CARD)
    account = {"id": "bank", "name": "Itaú", "initial_balance": Decimal(balance)}
    if overdraft is not None:
        account["overdraft_limit"] = Decimal(overdraft)
    bank = Ref("accounts:bank", account)
    receipts: dict = {}
    transactions: dict = {}
    purchases = [dict(PURCHASE)]

    class Owner:
        def collection(self, name):
            table = {
                "cards": lambda key: card,
                "accounts": lambda key: bank,
                "invoice_payments": lambda key: receipts.setdefault(key, Ref("invoice_payments:" + key)),
                "transactions": lambda key: transactions.setdefault(key, Ref("transactions:" + key)),
                "finance_history": lambda key: Ref("history:" + key),
            }
            if name not in table:
                raise AssertionError("Unexpected collection " + name)
            return type("Coll", (), {"document": lambda self, key: table[name](key)})()

    class Tx:
        def create(self, ref, value):
            if ref.data is not None:
                raise AssertionError("Duplicate financial operation")
            ref.data = copy.deepcopy(value)

        def set(self, ref, value):
            ref.data = copy.deepcopy(value)

        def update(self, ref, value):
            ref.data.update(copy.deepcopy(value))

    def movements(db, uid, account_id, transaction):
        rows = [dict(store.decode(ref.data), id=key) for key, ref in transactions.items() if ref.data]
        return [row for row in rows if row.get("account_id") == account_id]

    monkeypatch.setattr(store, "scoped", lambda query: "uid")
    monkeypatch.setattr(store, "client", lambda: object())
    monkeypatch.setattr(store, "root", lambda db, uid: Owner())
    monkeypatch.setattr(store, "atomic", lambda db, uid, fn: fn(Tx()))
    monkeypatch.setattr(store, "card_purchase_rows", lambda db, uid, card_id, transaction: purchases)
    monkeypatch.setattr(store, "rows", lambda db, uid, kind, transaction: [])
    monkeypatch.setattr(store, "account_movement_rows", movements)
    monkeypatch.setattr(cards_router, "today_iso", lambda: today)
    return card, bank, transactions, receipts, purchases


def pay(value=None, *, op="op", cycle="2026-10-29", allow=False):
    return asyncio.run(pay_invoice("card", PayInvoiceIn(cycle=cycle, account_id="bank", date="2026-11-05",
                                                        value=value, allow_overdraft=allow),
                                   user={"id": "uid"}, x_finnos_operation_id=op))


def undo(payment_id, *, op="undo-op"):
    return asyncio.run(undo_invoice_payment("card", payment_id, user={"id": "uid"}, x_finnos_operation_id=op))


def test_partial_payment_of_closed_invoice_carries_the_rest(monkeypatch):
    card, _, transactions, _, purchases = world(monkeypatch)
    result = pay(40)
    assert (result["paid_amount"], result["carried_amount"], result["outstanding"]) == (40, 60, 0)
    assert result["carried_to"] == "2026-11-29" == next_cycle(CARD, "2026-10-29")
    saved = card.data
    following = invoice_state(saved, purchases, "2026-11-29")
    carry = [i for i in following["items"] if i.get("carry_from") == "2026-10-29"]
    assert carry and carry[0]["purchase_cents"] == 6000 and carry[0]["name"] == "Saldo da fatura anterior"
    assert following["total_cents"] == 6000
    # The limit stays occupied by the 60 that moved, not by 100 nor by 0.
    assert commitment(saved, purchases, "2026-11-29")[2] == 6000
    debit = next(r.data for r in transactions.values() if r.data)
    assert debit["invoice_payment"] and debit["type"] == "despesa"


def test_partial_payment_of_open_invoice_does_not_carry(monkeypatch):
    world(monkeypatch, today="2026-10-20")
    result = asyncio.run(pay_invoice("card", PayInvoiceIn(cycle="2026-10-29", account_id="bank", date="2026-10-20",
                                                          value=40), user={"id": "uid"}, x_finnos_operation_id="o"))
    assert (result["carried_amount"], result["outstanding"]) == (0, 60)


def test_insufficient_funds_and_cheque_especial(monkeypatch):
    world(monkeypatch, balance="30.00")
    with pytest.raises(HTTPException) as refused:
        pay(40)
    assert refused.value.status_code == 422 and refused.value.detail["code"] == "saldo_insuficiente"

    world(monkeypatch, balance="30.00", overdraft="50.00")
    with pytest.raises(HTTPException) as confirm:
        pay(40)
    assert confirm.value.detail["code"] == "confirmar_cheque_especial"
    assert "R$ 10,00" in confirm.value.detail["message"]
    assert pay(40, allow=True)["paid_amount"] == 40

    world(monkeypatch, balance="30.00", overdraft="5.00")
    with pytest.raises(HTTPException) as beyond:
        pay(40, allow=True)
    assert beyond.value.detail["code"] == "saldo_insuficiente"


def test_balance_counts_earlier_payments(monkeypatch):
    world(monkeypatch, balance="50.00")
    pay(40, op="a")  # closed cycle: 60 carried to 29/11
    with pytest.raises(HTTPException) as second:
        asyncio.run(pay_invoice("card", PayInvoiceIn(cycle="2026-11-29", account_id="bank", date="2026-11-06",
                                                     value=20), user={"id": "uid"}, x_finnos_operation_id="b"))
    assert second.value.detail["available"] == 10


def test_undo_last_payment_reverses_and_removes_the_carry(monkeypatch):
    card, _, transactions, receipts, purchases = world(monkeypatch)
    first = pay(40, op="a")
    payment_id = first["last_payment_id"]
    undone = undo(payment_id)
    assert (undone["paid_amount"], undone["carried_amount"], undone["outstanding"]) == (0, 0, 100)
    reversal = next(r.data for r in transactions.values() if r.data and r.data.get("invoice_reversal_of"))
    assert reversal["type"] == "receita" and reversal["invoice_payment"] and reversal["value_cents"] == 4000
    assert transactions[payment_id].data["type"] == "despesa"  # the original stays
    assert not invoice_state(card.data, purchases, "2026-11-29")["items"]
    assert receipts[payment_id].data["undone_at"]
    assert undo(payment_id) == undone  # same operation id: no second reversal
    with pytest.raises(HTTPException, match="já foi desfeito"):
        undo(payment_id, op="other")


def test_only_the_last_payment_and_not_after_the_next_invoice_was_paid(monkeypatch):
    world(monkeypatch, today="2026-10-20")
    def early(value, op):
        return asyncio.run(pay_invoice("card", PayInvoiceIn(cycle="2026-10-29", account_id="bank", date="2026-10-20",
                                                            value=value), user={"id": "uid"}, x_finnos_operation_id=op))
    first = early(30, "a")["last_payment_id"]
    early(20, "b")
    with pytest.raises(HTTPException, match="último pagamento"):
        undo(first)

    world(monkeypatch)
    carried = pay(40, op="c")["last_payment_id"]
    asyncio.run(pay_invoice("card", PayInvoiceIn(cycle="2026-11-29", account_id="bank", date="2026-11-06", value=10),
                            user={"id": "uid"}, x_finnos_operation_id="d"))
    with pytest.raises(HTTPException, match="fatura seguinte"):
        undo(carried)


def test_reconciled_invoice_cannot_be_undone(monkeypatch):
    card, *_ = world(monkeypatch)
    payment_id = pay(40)["last_payment_id"]
    card.data["invoice_cycles"]["2026-10-29"]["reconciled"] = True
    with pytest.raises(HTTPException, match="conferida"):
        undo(payment_id)


def test_ensure_funds_is_exact_to_the_cent():
    account = {"name": "Conta", "overdraft_limit": Decimal("0.01")}
    ensure_funds(Decimal("10.00"), 1000, {"name": "Conta"}, allow_overdraft=False)
    ensure_funds(Decimal("10.00"), 1001, account, allow_overdraft=True)
    with pytest.raises(HTTPException):
        ensure_funds(Decimal("10.00"), 1002, account, allow_overdraft=True)


def test_transfer_cannot_overdraw_and_rename_is_not_a_new_movement(monkeypatch):
    from finnos.lib.db import _check_transfer_funds

    source = {"id": "a", "name": "Itaú", "initial_balance": Decimal("100.00")}

    class Owner:
        def collection(self, name):
            assert name == "accounts"
            return type("Coll", (), {"document": lambda self, key: Ref("accounts:a", source)})()

    monkeypatch.setattr(store, "root", lambda db, uid: Owner())
    monkeypatch.setattr(store, "account_movement_rows", lambda db, uid, account_id, transaction: [])
    transfer = {"id": "t", "type": "transferencia", "status": "pago", "date": "2026-11-12", "value": Decimal("150"),
                "account_id": "a", "to_account_id": "b"}
    with pytest.raises(HTTPException) as refused:
        _check_transfer_funds(None, "uid", dict(transfer), None, None, "2026-11-12", False)
    assert refused.value.detail["code"] == "saldo_insuficiente"
    _check_transfer_funds(None, "uid", dict(transfer, value=Decimal("100")), None, None, "2026-11-12", False)
    _check_transfer_funds(None, "uid", dict(transfer, name="novo"), None, dict(transfer), "2026-11-12", False)
    _check_transfer_funds(None, "uid", dict(transfer, status="agendado", date="2026-12-01"), None, None, "2026-11-12", False)


# ---------------------------------------------------------------- transfer undo


def transfer_world(monkeypatch, *, destination_balance="0.00", overdraft=None):
    from finnos.routers import transactions as tx_router

    accounts = {
        "a": Ref("accounts:a", {"id": "a", "name": "Itaú", "initial_balance": Decimal("500.00")}),
        "b": Ref("accounts:b", {"id": "b", "name": "Inter", "initial_balance": Decimal(destination_balance),
                                **({"overdraft_limit": Decimal(overdraft)} if overdraft else {})}),
    }
    original = {"id": "t1", "name": "Reserva", "type": "transferencia", "status": "pago", "date": "2026-11-01",
                "value": Decimal("200.00"), "account_id": "a", "to_account_id": "b", "version": 1}
    transactions = {"t1": Ref("transactions:t1", store.encode(original))}

    class Owner:
        def collection(self, name):
            table = {
                "accounts": lambda key: accounts[key],
                "transactions": lambda key: transactions.setdefault(key, Ref("transactions:" + key)),
                "finance_history": lambda key: Ref("history:" + key),
            }
            return type("Coll", (), {"document": lambda self, key: table[name](key)})()

    class Tx:
        def create(self, ref, value):
            assert ref.data is None, "duplicate"
            ref.data = copy.deepcopy(value)

        def set(self, ref, value):
            ref.data = copy.deepcopy(value)

    def movements(db, uid, account_id, transaction):
        rows = [dict(store.decode(ref.data), id=key) for key, ref in transactions.items() if ref.data]
        return [r for r in rows if account_id in (r.get("account_id"), r.get("to_account_id"))]

    async def ref_maps(uid):
        return {k: store.decode(v.data) for k, v in accounts.items()}, {}

    async def cards_by_id(uid):
        return {}

    monkeypatch.setattr(store, "scoped", lambda query: "uid")
    monkeypatch.setattr(store, "client", lambda: object())
    monkeypatch.setattr(store, "root", lambda db, uid: Owner())
    monkeypatch.setattr(store, "atomic", lambda db, uid, fn: fn(Tx()))
    monkeypatch.setattr(store, "account_movement_rows", movements)
    monkeypatch.setattr(tx_router, "today_iso", lambda: "2026-11-12")
    monkeypatch.setattr(tx_router, "_ref_maps", ref_maps)
    monkeypatch.setattr(tx_router, "_cards_by_id", cards_by_id)
    return transactions


def reverse(op="r1", allow=False):
    from finnos.routers.transactions import ReverseTransferIn, reverse_transfer

    return asyncio.run(reverse_transfer("t1", ReverseTransferIn(allow_overdraft=allow), user={"id": "uid"},
                                        x_finnos_operation_id=op))


def test_transfer_undo_is_an_inverse_transfer_linked_both_ways(monkeypatch):
    transactions = transfer_world(monkeypatch)
    out = reverse()
    assert (out.account_id, out.to_account_id, out.value, out.reversal_of) == ("b", "a", Decimal("200.00"), "t1")
    original = store.decode(transactions["t1"].data)
    assert original["reversed_by"] == out.id and original["version"] == 2
    assert reverse().id == out.id  # same operation: no second inverse
    with pytest.raises(HTTPException, match="já foi desfeita"):
        reverse(op="r2")


def test_transfer_undo_needs_the_destination_to_cover_it(monkeypatch):
    transactions = transfer_world(monkeypatch)
    # The destination already spent part of what it received.
    transactions["spent"] = Ref("transactions:spent", store.encode({
        "id": "spent", "name": "Aluguel", "type": "despesa", "status": "pago", "date": "2026-11-05",
        "value": Decimal("150.00"), "account_id": "b"}))
    with pytest.raises(HTTPException) as refused:
        reverse()
    assert refused.value.detail["code"] == "saldo_insuficiente"


def test_reversed_transfers_cannot_be_edited():
    from finnos.lib.db import validate_refs

    with pytest.raises(HTTPException, match="desfeita"):
        validate_refs(None, "uid", "transactions", {"type": "transferencia"}, None,
                      original_tx={"id": "t1", "reversed_by": "x"})


# ---------------------------------------------------------------- reminders


def test_invoice_reminder_shows_what_is_owed_and_skips_settled(monkeypatch):
    from datetime import date
    from finnos.routers import notifications

    card = dict(CARD)

    class Cursor:
        async def to_list(self, limit):
            return [dict(PURCHASE)]

    monkeypatch.setattr(notifications, "db", type("Db", (), {
        "transactions": type("T", (), {"find": lambda self, query: Cursor()})()})())
    today = date(2026, 11, 3)
    items = asyncio.run(notifications._invoice_reminders("uid", card, today, today.toordinal() + 7, set()))
    owed = [i for i in items if i.date == "2026-11-07"]
    assert owed and owed[0].value == Decimal("100") and "Confirme" in owed[0].description
    assert owed[0].target_url == "/cartoes/card?cycle=2026-10-29"
    late = asyncio.run(notifications._invoice_reminders("uid", card, date(2026, 11, 10), date(2026, 11, 17).toordinal(), set()))
    assert any(i.title.endswith("atrasada") for i in late)
    card["invoice_cycles"] = {"2026-10-29": {"paid_cents": 10000}}
    paid = asyncio.run(notifications._invoice_reminders("uid", card, today, today.toordinal() + 7, set()))
    assert not [i for i in paid if i.date == "2026-11-07"]
