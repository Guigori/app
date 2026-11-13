"""Etapa 4: conferência da fatura do cartão. The bank's PDF (text lines from
the device) is read by the FDI and compared with the FINNOS invoice of the
cycle. Synthetic data only."""
import asyncio
from decimal import Decimal

import pytest
from fastapi import HTTPException

from finnos.lib import db as store
from finnos.routers import reconciliations as rec
from finnos.tests.test_reconciliations import USER, Tx, World

CARD = {"id": "card", "name": "Nubank", "closing_day": 3, "due_day": 10, "invoice_cycles": {}}
INVOICE_TEXT = """Nu Pagamentos S.A. CNPJ 18.236.120/0001-58
Fatura do cartão - DOCUMENTO SINTETICO
Data de vencimento: 10/12/2026
Total da fatura R$ 489,85
Pagamento mínimo R$ 73,48
10/11 MERCADO BOM PRECO 345,90
15/11 POSTO CENTRAL 120,00
20/11 STREAMING GLOBAL 55,90
28/11 IOF COMPRA INTERNACIONAL 3,85
01/12 ESTORNO POSTO CENTRAL -35,80"""


def purchase(id, date, name, value, **extra):
    return {"id": id, "date": date, "name": name, "value": Decimal(value), "type": "despesa", "status": "pago",
            "card_id": "card", "account_id": "acc", "installment": False, "version": 1, **extra}


@pytest.fixture
def world(monkeypatch):
    w = World()
    w.table("cards")["card"] = store.encode(dict(CARD))
    for item in [purchase("m", "2026-11-10", "Mercado Bom Preço", "345.90"),
                 purchase("p", "2026-11-15", "Posto Central", "120.00"),
                 purchase("s", "2026-11-20", "Streaming", "49.90"),
                 purchase("x", "2026-11-25", "Farmácia", "22.00")]:
        w.table("transactions")[item["id"]] = store.encode(item)

    def card_rows(db, uid, card_id, transaction):
        rows = [dict(store.decode(v), id=k) for k, v in w.table("transactions").items()]
        return [r for r in rows if r.get("card_id") == card_id]

    monkeypatch.setattr(store, "scoped", lambda q: "uid")
    monkeypatch.setattr(store, "client", lambda: object())
    monkeypatch.setattr(store, "root", lambda db, uid: w)
    monkeypatch.setattr(store, "atomic", lambda db, uid, fn: fn(Tx()))
    monkeypatch.setattr(store, "card_purchase_rows", card_rows)
    monkeypatch.setattr(rec, "record_event", lambda *a, **k: None)
    return w


def create(op="c1", text=INVOICE_TEXT):
    payload = rec.CardReconciliationIn(cycle="2026-12-03", file_name="fatura.pdf", file_hash="abcdef123456",
                                       pages=[rec.PageTextIn(page=1, text=text)])
    return asyncio.run(rec.create_card_reconciliation("card", payload, user=USER, x_finnos_operation_id=op))


def resolve(rid, op, **body):
    return asyncio.run(rec.resolve(rid, rec.ResolveIn(**body), user=USER, x_finnos_operation_id=op))


def test_invoice_pdf_is_read_by_the_fdi_and_compared_line_by_line(world):
    doc = create()
    assert doc["scope"] == "card" and doc["bank_closing_cents"] == 48985
    assert doc["invoice_fields"]["minimum_payment_cents"] == 7348
    assert doc["invoice_fields"]["due_date"] == "2026-12-10"
    by = {l["description"]: (l["level"], l["state"], l["tx_id"]) for l in doc["lines"]}
    assert by["MERCADO BOM PRECO"] == ("strong", "matched", "m")
    assert by["POSTO CENTRAL"] == ("strong", "matched", "p")
    assert by["STREAMING GLOBAL"][0] == "value_diff"
    assert by["IOF COMPRA INTERNACIONAL"][:2] == ("only_statement", "open")
    assert by["ESTORNO POSTO CENTRAL"][:2] == ("only_statement", "open")
    assert [f["tx_id"] for f in doc["finnos"]] == ["x"] and doc["finnos"][0]["name"] == "Farmácia"
    assert next(c for c in doc["invoice_checks"] if c["name"] == "invoice_total")["passed"] is True


def test_card_decisions_and_completion_mark_the_invoice_reconciled(world):
    doc = create()
    rid = doc["id"]
    line = {l["description"]: l["index"] for l in doc["lines"]}
    resolve(rid, "a", line=line["STREAMING GLOBAL"], action="use_bank_value")
    assert store.decode(world.table("transactions")["s"])["value"] == Decimal("55.90")
    world.table("transactions")["iof"] = store.encode(purchase("iof", "2026-11-28", "IOF", "3.85"))
    resolve(rid, "b", line=line["IOF COMPRA INTERNACIONAL"], action="link", tx_id="iof")
    resolve(rid, "c", line=line["ESTORNO POSTO CENTRAL"], action="ignore")
    resolve(rid, "d", tx_id="x", action="keep_pending")
    assert store.decode(world.table("transactions")["x"])["status"] == "pago"  # card: nothing changes
    with pytest.raises(HTTPException) as different:
        asyncio.run(rec.complete(rid, rec.CompleteIn(), user=USER))
    assert different.value.detail["code"] == "total_diferente"
    done = asyncio.run(rec.complete(rid, rec.CompleteIn(note="Estorno do posto vou lançar pela fatura"), user=USER))
    assert done["status"] == "concluida" and done["difference_note"]
    cycle = store.decode(world.table("cards")["card"])["invoice_cycles"]["2026-12-03"]
    assert cycle["reconciled"] and cycle["minimum_cents"] == 7348


def test_paid_invoice_and_installments_are_protected(world):
    world.table("transactions")["inst"] = store.encode(purchase("inst", "2026-11-12", "Loja Parcelada", "300.00",
                                                                installment=True, total_installments=3, current_installment=1))
    doc = create(text=INVOICE_TEXT.replace("20/11 STREAMING GLOBAL 55,90", "12/11 LOJA PARCELADA PARC 01/03 110,00"))
    line = next(l for l in doc["lines"] if l["description"] == "LOJA PARCELADA")
    assert (line["level"], line["installment"]) == ("value_diff", {"current": 1, "total": 3})
    with pytest.raises(HTTPException, match="parcelada"):
        resolve(doc["id"], "i", line=line["index"], action="use_bank_value")
    card = store.decode(world.table("cards")["card"])
    card["invoice_cycles"] = {"2026-12-03": {"paid_cents": 10000}}
    world.table("cards")["card"] = store.encode(card)
    with pytest.raises(HTTPException, match="já paga"):
        resolve(doc["id"], "j", tx_id="x", action="delete")
    with pytest.raises(HTTPException, match="próprio fluxo"):
        rec._tx(world, None, "carry:2026-11-03")
