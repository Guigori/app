"""Etapa 3: conferência da conta com o extrato. Matching levels, decisions
with history and undo, completion with 'Conferida até', reimport without
duplicates and the auditable balance adjustment. Synthetic data only."""
import asyncio
import copy
from decimal import Decimal

import pytest
from fastapi import HTTPException

from finnos.lib import db as store
from finnos.lib.statement_matching import match_lines, name_similarity
from finnos.routers import reconciliations as rec


# ---------------------------------------------------------------- pure matching

def line(index, date, description, cents, direction="out", fitid=None):
    return {"index": index, "date": date, "description": description, "cents": cents, "direction": direction,
            "fitid": fitid, "origin_key": f"k{index}"}


def tx(id, date, name, value, type="despesa", **extra):
    return {"id": id, "date": date, "name": name, "value": Decimal(value), "type": type, "status": "pago",
            "account_id": "acc", **extra}


def test_levels_strong_probable_value_diff_and_only_statement():
    lines = [
        line(0, "2026-10-05", "PIX ENVIADO PADARIA AURORA", 1850),
        line(1, "2026-10-10", "MERCADO LIVRE", 8990),
        line(2, "2026-10-15", "NETFLIX", 5590),
        line(3, "2026-10-20", "TARIFA PACOTE", 2990),
    ]
    txs = [
        tx("a", "2026-10-05", "Padaria Aurora", "18.50"),
        tx("b", "2026-10-10", "Mercado Pago", "89.90"),
        tx("c", "2026-10-12", "Mercado Livre", "89.90"),
        tx("d", "2026-10-15", "Netflix", "55.90") | {"value": Decimal("49.90")},
        tx("e", "2026-10-25", "Aluguel", "1500.00"),
        tx("card", "2026-10-05", "Compra no cartão", "18.50", card_id="nubank"),  # hits the invoice, not the account
    ]
    out = match_lines(lines, txs, "acc")
    levels = {i: (r["level"], r["tx_id"]) for i, r in out["lines"].items()}
    assert levels[0] == ("strong", "a")
    assert levels[1][0] == "probable"  # two R$ 89,90 candidates: the person decides
    assert levels[2] == ("value_diff", "d")
    assert levels[3] == ("only_statement", None)
    assert "e" in out["only_finnos"] and "card" not in out["only_finnos"]


def test_registered_twice_is_reported_as_repeated():
    out = match_lines([line(0, "2026-10-05", "Uber", 2300)],
                      [tx("a", "2026-10-05", "Uber", "23.00"), tx("b", "2026-10-05", "Uber", "23.00")], "acc")
    assert out["lines"][0]["level"] in ("strong", "probable")
    assert len(out["repeated"]) == 1


def test_transfers_count_for_both_accounts_in_the_right_direction():
    t = {"id": "t", "date": "2026-10-05", "name": "Reserva", "value": Decimal("100"), "type": "transferencia",
         "status": "pago", "account_id": "acc", "to_account_id": "other"}
    assert match_lines([line(0, "2026-10-05", "Reserva", 10000, "out")], [t], "acc")["lines"][0]["tx_id"] == "t"
    assert match_lines([line(0, "2026-10-05", "Reserva", 10000, "in")], [t], "other")["lines"][0]["tx_id"] == "t"


def test_name_similarity_ignores_bank_words():
    assert name_similarity("PIX ENVIADO JOAO SILVA", "João Silva") == 1
    assert name_similarity("COMPRA DEBITO", "Pagamento") == 0


# ---------------------------------------------------------------- routes with a fake Firestore


class Snap:
    def __init__(self, id, data):
        self.id, self._data = id, copy.deepcopy(data)
        self.exists = data is not None

    def to_dict(self):
        return copy.deepcopy(self._data)


class Doc:
    def __init__(self, table, id):
        self.table, self.id = table, id

    def get(self, transaction=None):
        return Snap(self.id, self.table.get(self.id))


class Query:
    def __init__(self, table, filters=()):
        self.table, self.filters = table, filters

    def where(self, field, op, value):
        return Query(self.table, (*self.filters, (field, value)))

    def limit(self, n):
        return self

    def stream(self, transaction=None, timeout=None):
        return [Snap(k, v) for k, v in self.table.items() if all(v.get(f) == x for f, x in self.filters)]


class Coll(Query):
    def document(self, id):
        return Doc(self.table, id)


class World:
    def __init__(self):
        self.tables: dict[str, dict] = {}

    def table(self, name):
        return self.tables.setdefault(name, {})

    def collection(self, name):
        return Coll(self.table(name))


class Tx:
    def create(self, ref, value):
        assert ref.id not in ref.table, "duplicate document"
        ref.table[ref.id] = copy.deepcopy(value)

    def set(self, ref, value):
        ref.table[ref.id] = copy.deepcopy(value)

    def update(self, ref, value):
        ref.table[ref.id].update(copy.deepcopy(value))

    def delete(self, ref):
        ref.table.pop(ref.id, None)


@pytest.fixture
def world(monkeypatch):
    w = World()
    w.table("accounts")["acc"] = store.encode({"id": "acc", "name": "Itaú", "initial_balance": Decimal("1000.00")})
    for item in [tx("a", "2026-10-05", "Padaria Aurora", "18.50"), tx("d", "2026-10-15", "Netflix", "49.90"),
                 tx("e", "2026-10-25", "Aluguel", "1500.00"), tx("s", "2026-10-02", "Salário", "3000.00", type="receita")]:
        w.table("transactions")[item["id"]] = store.encode(dict(item, version=1))

    def movements(db, uid, account_id, transaction):
        rows = [dict(store.decode(v), id=k) for k, v in w.table("transactions").items()]
        return [r for r in rows if account_id in (r.get("account_id"), r.get("to_account_id"))]

    monkeypatch.setattr(store, "scoped", lambda q: "uid")
    monkeypatch.setattr(store, "client", lambda: object())
    monkeypatch.setattr(store, "root", lambda db, uid: w)
    monkeypatch.setattr(store, "atomic", lambda db, uid, fn: fn(Tx()))
    monkeypatch.setattr(store, "account_movement_rows", movements)
    monkeypatch.setattr(rec, "today_iso", lambda: "2026-11-12")
    monkeypatch.setattr(rec, "record_event", lambda *a, **k: None)
    return w


USER = {"id": "uid"}
STATEMENT = [
    {"date": "2026-10-02", "description": "SALARIO EMPRESA", "value": 3000.00, "direction": "in", "fitid": "F1"},
    {"date": "2026-10-05", "description": "PIX ENVIADO PADARIA AURORA", "value": 18.50, "direction": "out", "fitid": "F2"},
    {"date": "2026-10-15", "description": "NETFLIX", "value": 55.90, "direction": "out", "fitid": "F3"},
    {"date": "2026-10-20", "description": "TARIFA PACOTE", "value": 29.90, "direction": "out", "fitid": "F4"},
]


def create(op="op1", lines=STATEMENT, closing=None):
    payload = rec.ReconciliationIn(period_start="2026-10-01", period_end="2026-10-31", file_hash="abcdef123456",
                                   source="ofx", file_name="extrato.ofx", bank_closing_balance=closing,
                                   lines=[rec.StatementLineIn(**l) for l in lines])
    return asyncio.run(rec.create_reconciliation("acc", payload, user=USER, x_finnos_operation_id=op))


def resolve(rid, op, **body):
    return asyncio.run(rec.resolve(rid, rec.ResolveIn(**body), user=USER, x_finnos_operation_id=op))


def undo(rid, event_id, op):
    return asyncio.run(rec.undo_event(rid, event_id, user=USER, x_finnos_operation_id=op))


def events(world):
    return sorted(world.table("reconciliation_events").values(), key=lambda e: e["seq"])


def test_full_conferencia_with_decisions_undo_and_conferida_ate(world):
    doc = create(closing=1000 + 3000 - 18.50 - 55.90 - 29.90)
    rid = doc["id"]
    states = [(l["level"], l["state"]) for l in doc["lines"]]
    assert states == [("strong", "matched"), ("strong", "matched"), ("value_diff", "review"), ("only_statement", "open")]
    assert [f["tx_id"] for f in doc["finnos"]] == ["e"] and doc["pending"] == 3
    assert doc["finnos_closing_cents"] == 100000 + 300000 - 1850 - 4990 - 150000

    # Use the bank value for Netflix: the movement changes and the change is undoable.
    doc = resolve(rid, "r1", line=2, action="use_bank_value")
    assert store.decode(world.table("transactions")["d"])["value"] == Decimal("55.90")
    first = events(world)[0]
    doc = undo(rid, first["id"], "u1")
    assert store.decode(world.table("transactions")["d"])["value"] == Decimal("49.90")
    assert doc["lines"][2]["state"] == "review"
    assert events(world)[0]["undone_by"] and events(world)[-1]["undo_of"] == first["id"]
    doc = resolve(rid, "r2", line=2, action="use_bank_value")

    # The fee was not registered: the app saves it from the register, then links it.
    world.table("transactions")["fee"] = store.encode(dict(tx("fee", "2026-10-20", "Tarifa pacote", "29.90"), version=1))
    doc = resolve(rid, "r3", line=3, action="link", tx_id="fee")
    # Rent is still to fall: keep it as pending.
    doc = resolve(rid, "r4", tx_id="e", action="keep_pending")
    assert store.decode(world.table("transactions")["e"])["status"] == "pendente"
    assert doc["pending"] == 0

    done = asyncio.run(rec.complete(rid, user=USER))
    assert done["status"] == "concluida"
    assert store.decode(world.table("accounts")["acc"])["reconciled_until"] == "2026-10-31"
    with pytest.raises(HTTPException, match="concluída"):
        resolve(rid, "r5", line=0, action="ignore")

    # Same file exported again: nothing new to decide for the lines already conferred.
    again = create(op="op2")
    assert [l["level"] for l in again["lines"]] == ["already", "already", "already", "already"]


def test_undo_refuses_when_a_later_decision_depends_on_it(world):
    rid = create()["id"]
    resolve(rid, "r1", line=2, action="keep_value")
    keep = events(world)[0]
    undo(rid, keep["id"], "u1")
    resolve(rid, "r2", line=2, action="use_bank_value")
    with pytest.raises(HTTPException, match="já foi desfeita"):
        undo(rid, keep["id"], "u2")
    world.table("transactions")["fee"] = store.encode(dict(tx("fee", "2026-10-20", "Tarifa", "29.90"), version=1))
    resolve(rid, "r3", line=3, action="link", tx_id="fee")
    link = events(world)[-1]
    # Deleting the rent and undoing restores the very same document.
    resolve(rid, "r5", tx_id="e", action="delete")
    assert "e" not in world.table("transactions")
    undo(rid, events(world)[-1]["id"], "u3")
    assert store.decode(world.table("transactions")["e"])["name"] == "Aluguel"
    assert link["effects"]["linked"] == "fee"


def test_complete_requires_every_item_and_equal_balances(world):
    rid = create(closing=1.00)["id"]
    with pytest.raises(HTTPException, match="para decidir"):
        asyncio.run(rec.complete(rid, user=USER))
    resolve(rid, "a", line=2, action="keep_value")
    resolve(rid, "b", line=3, action="ignore")
    resolve(rid, "c", tx_id="e", action="keep")
    with pytest.raises(HTTPException) as different:
        asyncio.run(rec.complete(rid, user=USER))
    assert different.value.detail["code"] == "saldo_diferente"


def test_period_limits_and_invoice_movements_are_protected(world):
    with pytest.raises(HTTPException, match="90 dias"):
        asyncio.run(rec.create_reconciliation("acc", rec.ReconciliationIn(
            period_start="2026-07-01", period_end="2026-10-31", file_hash="abcdef123456", lines=[]),
            user=USER, x_finnos_operation_id="x"))
    world.table("transactions")["inv"] = store.encode(dict(tx("inv", "2026-10-28", "Fatura Nubank", "77.00"),
                                                           invoice_payment=True, version=1))
    rid = create(op="op9", lines=[STATEMENT[2]])["id"]
    with pytest.raises(HTTPException, match="próprio fluxo"):
        resolve(rid, "z", tx_id="inv", action="delete")


def test_balance_adjustment_is_auditable_and_idempotent(world):
    body = rec.AdjustmentIn(target_balance=2500.00, reason="Conferi no app do banco", date="2026-11-12")
    out = asyncio.run(rec.adjust_balance("acc", body, user=USER, x_finnos_operation_id="adj"))
    assert (out["previous_balance"], out["new_balance"], out["difference"], out["type"]) == (2431.6, 2500.0, 68.4, "receita")
    saved = store.decode(next(v for k, v in world.table("transactions").items() if k == out["id"]))
    assert saved["balance_adjustment"] and saved["adjustment"]["reason"] == "Conferi no app do banco"
    assert asyncio.run(rec.adjust_balance("acc", body, user=USER, x_finnos_operation_id="adj"))["id"] == out["id"]
    from finnos.lib.stats import month_portion
    assert month_portion(saved, "2026-11") is None  # never income or spending
