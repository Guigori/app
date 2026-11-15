"""finnos.lib.tx_pack pieces that need no Firestore (the full behaviour runs in test_tx_pack_emulator.py)."""
from google.cloud.firestore_v1 import SERVER_TIMESTAMP, Increment

from finnos.lib import db as store
from finnos.lib import tx_pack


class Ref:
    def __init__(self, path):
        self.path = path


def test_month_of():
    assert tx_pack.month_of({"date": "2026-11-14"}) == "2026-11"
    assert tx_pack.month_of({"date": None}) == "sem-data"
    assert tx_pack.month_of({}) == "sem-data"


def test_records_only_lancamentos_and_rereads_what_it_cannot_see_whole():
    token = tx_pack.begin()
    tx_pack.record_write(Ref("users/u/transactions/a"), {"date": "2026-11-01", "value_cents": 1})
    tx_pack.record_write(Ref("users/u/transactions/b"), {"value_cents": 2}, partial=True)
    tx_pack.record_write(Ref("users/u/transactions/c"), deleted=True)
    tx_pack.record_write(Ref("users/u/transactions/d"), {"created_at": SERVER_TIMESTAMP})
    tx_pack.record_write(Ref("users/u/transactions/e"), {"n": {"x": Increment(1)}})
    tx_pack.record_write(Ref("users/u/accounts/a"), {"name": "Conta"})
    tx_pack.record_write(Ref("users/u/_meta/finance"), {"revision": 2})
    changes = tx_pack.take(token)
    assert changes == {"a": {"date": "2026-11-01", "value_cents": 1}, "b": tx_pack.REREAD, "c": None,
                       "d": tx_pack.REREAD, "e": tx_pack.REREAD}


def test_nothing_recorded_outside_atomic():
    tx_pack.record_write(Ref("users/u/transactions/a"), {"date": "2026-11-01"})
    token = tx_pack.begin()
    assert tx_pack.take(token) == {}


def test_watch_records_and_still_writes():
    calls = []

    class Tr:
        def create(self, ref, data):
            calls.append(("create", ref.path))

        def set(self, ref, data, merge=False):
            calls.append(("set", ref.path, merge))

        def update(self, ref, data):
            calls.append(("update", ref.path))

        def delete(self, ref):
            calls.append(("delete", ref.path))

    tr = Tr()
    tx_pack.watch_transaction(tr)
    tx_pack.watch_transaction(tr)  # twice (a retried attempt) wraps once
    token = tx_pack.begin()
    tr.create(Ref("users/u/transactions/a"), {"date": "2026-01-01"})
    tr.set(Ref("users/u/transactions/b"), {"date": "2026-01-01"}, merge=True)
    tr.update(Ref("users/u/transactions/c"), {"x": 1})
    tr.delete(Ref("users/u/transactions/d"))
    assert tx_pack.take(token) == {"a": {"date": "2026-01-01"}, "b": tx_pack.REREAD, "c": tx_pack.REREAD, "d": None}
    assert calls == [("create", "users/u/transactions/a"), ("set", "users/u/transactions/b", True),
                     ("update", "users/u/transactions/c"), ("delete", "users/u/transactions/d")]


def test_broad_transaction_queries_use_the_pack(monkeypatch):
    every = [{"id": "a", "user_id": "u", "type": "despesa", "status": "pago", "date": "2026-11-01"},
             {"id": "b", "user_id": "u", "type": "receita", "status": "pago", "date": "2026-11-02"}]
    monkeypatch.setattr(store, "_all_transactions", lambda db, uid, only_if_current=False: [dict(d) for d in every])
    monkeypatch.setattr(store, "rows", lambda *a, **k: (_ for _ in ()).throw(AssertionError("full scan")))
    assert [d["id"] for d in store.query_rows(None, "u", "transactions", {"user_id": "u"})] == ["a", "b"]
    assert [d["id"] for d in store.query_rows(None, "u", "transactions", {"type": "despesa", "status": "pago"})] == ["a"]


def test_which_queries_read_the_pack():
    choice = store._pack_choice
    assert choice([]) == "pack"
    assert choice([("type", "==", "despesa"), ("status", "==", "pago")]) == "pack"
    assert choice([("card_id", "==", "c")]) == "pack-if-current"
    assert choice([("account_id", "==", "a"), ("type", "==", "despesa")]) == "pack-if-current"
    assert choice([("status", "in", ["agendado", "pendente"])]) == "query"
    assert choice([("date", ">=", "2026-11-01"), ("date", "<=", "2026-11-30")]) == "query"
    assert choice([("name", "==", "Mercado")]) == "query"


def test_selective_queries_and_other_collections_do_not(monkeypatch):
    monkeypatch.setattr(store, "_all_transactions", lambda *a: (_ for _ in ()).throw(AssertionError("pack")))
    monkeypatch.setattr(store, "rows", lambda db, uid, name: [{"id": "x", "user_id": uid, "name": "Conta"}])
    assert len(store.query_rows(None, "u", "accounts", {"user_id": "u"})) == 1
    monkeypatch.setenv("FINNOS_TX_PACK", "0")
    assert len(store.query_rows(None, "u", "transactions", {"user_id": "u"})) == 1
