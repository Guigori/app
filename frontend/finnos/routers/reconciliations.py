"""Conferência da conta com o extrato (etapa 3).

The file is read on the device (OFX, CSV, PDF with text) or, for scans and
photos, by the FDI OCR worker; this router receives the lines, matches them
with the account's movements and keeps every decision as an append-only
event. Data only changes on an explicit decision; undo is a new event.
"""
from __future__ import annotations

import hashlib
from datetime import date, datetime, timedelta, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from finnos.lib import db as store
from finnos.lib.dates import today_iso
from finnos.lib.history import record_event
from finnos.lib.money import D, cents
from finnos.lib.statement_matching import match_lines, origin_key
from finnos.lib.stats import balance_effects
from finnos.routers.auth import require_user

router = APIRouter(tags=["reconciliations"])

MAX_DAYS = 90
MAX_LINES = 2000


class StatementLineIn(BaseModel):
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    description: str = Field(min_length=1, max_length=200)
    value: float = Field(gt=0)
    direction: Literal["in", "out"]
    fitid: Optional[str] = Field(default=None, max_length=120)


class ReconciliationIn(BaseModel):
    period_start: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    period_end: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    file_name: str = Field(default="", max_length=200)
    file_hash: str = Field(min_length=8, max_length=128)
    source: Literal["ofx", "csv", "pdf", "ocr"] = "csv"
    bank_closing_balance: Optional[float] = None
    lines: list[StatementLineIn] = Field(max_length=MAX_LINES)


class PageTextIn(BaseModel):
    page: int = Field(ge=1, le=60)
    text: str = Field(max_length=20000)


class CardReconciliationIn(BaseModel):
    cycle: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    file_name: str = Field(default="", max_length=200)
    file_hash: str = Field(min_length=8, max_length=128)
    source: Literal["ofx", "csv", "pdf", "ocr"] = "pdf"
    # PDF with text: the lines pdf.js rebuilt on the device, read here by the FDI.
    pages: list[PageTextIn] = Field(default_factory=list, max_length=60)
    # CSV/OFX already parsed on the device.
    lines: list[StatementLineIn] = Field(default_factory=list, max_length=MAX_LINES)


class CompleteIn(BaseModel):
    note: str = Field(default="", max_length=300)


LineAction = Literal["confirm", "separate", "use_bank_value", "keep_value", "link", "ignore"]
FinnosAction = Literal["keep", "keep_pending", "delete"]


class ResolveIn(BaseModel):
    line: Optional[int] = None
    tx_id: Optional[str] = None  # for finnos items, or the movement to link
    action: str
    note: str = Field(default="", max_length=300)


class AdjustmentIn(BaseModel):
    target_balance: float
    reason: str = Field(min_length=3, max_length=300)
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    reconciliation_id: Optional[str] = None


def _now():
    return datetime.now(timezone.utc)


def _cents(value: float) -> int:
    return cents(D(str(value)))


def _account(owner, tr, account_id: str) -> dict:
    snap = owner.collection("accounts").document(store.resource_id(account_id)).get(transaction=tr)
    if not snap.exists:
        raise HTTPException(404, "Conta não encontrada.")
    return dict(store.decode(snap.to_dict()), id=account_id)


def balance_until(movements: list[dict], account: dict, until: str) -> int:
    """Realized balance at the end of ``until`` (cents)."""
    total = cents(account.get("initial_balance") or 0)
    for tx in movements:
        if str(tx.get("date", "")) > until:
            continue
        for account_id, amount in balance_effects(tx, until):
            if account_id == account["id"]:
                total += cents(amount)
    return total


def _summary(doc: dict) -> dict:
    lines = doc["lines"]
    counts: dict[str, int] = {}
    for line in lines:
        counts[line["state"]] = counts.get(line["state"], 0) + 1
    finnos_open = sum(1 for item in doc["finnos"] if item["state"] == "open")
    return {**doc, "counts": counts, "finnos_open": finnos_open,
            "pending": counts.get("review", 0) + counts.get("open", 0) + finnos_open}


# ---------------------------------------------------------------- create


@router.post("/accounts/{account_id}/reconciliations")
async def create_reconciliation(account_id: str, payload: ReconciliationIn, user: dict = Depends(require_user),
                                x_finnos_operation_id: str = Header(...)):
    start, end = date.fromisoformat(payload.period_start), date.fromisoformat(payload.period_end)
    if end < start or (end - start).days > MAX_DAYS:
        raise HTTPException(422, "O extrato pode ter no máximo 90 dias.")
    if end > date.fromisoformat(today_iso()):
        raise HTTPException(422, "O período não pode terminar no futuro.")
    uid = store.scoped({"user_id": user["id"]})
    rid = hashlib.sha256(f"{uid}:rec:{x_finnos_operation_id}".encode()).hexdigest()[:32]
    lines = []
    for index, line in enumerate(payload.lines):
        if not payload.period_start <= line.date <= payload.period_end:
            raise HTTPException(422, f"Linha {index + 1} fora do período do extrato.")
        item = {"index": index, "date": line.date, "description": line.description.strip(), "cents": _cents(line.value),
                "direction": line.direction, "fitid": line.fitid}
        item["origin_key"] = origin_key(uid, account_id, item)
        lines.append(item)

    def execute():
        instance = store.client()

        def action(tr):
            owner = store.root(instance, uid)
            ref = owner.collection("reconciliations").document(rid)
            existing = ref.get(transaction=tr)
            if existing.exists:
                return existing.to_dict()
            account = _account(owner, tr, account_id)
            movements = store.account_movement_rows(instance, uid, account_id, tr)
            window_start = (start - timedelta(days=3)).isoformat()
            window_end = (end + timedelta(days=3)).isoformat()
            in_window = [tx for tx in movements if window_start <= str(tx.get("date", "")) <= window_end]
            links = {}
            for snap in owner.collection("reconciliation_links").where("account_id", "==", account_id).limit(5001).stream(transaction=tr):
                data = snap.to_dict() or {}
                links[data.get("key")] = data.get("tx_id")
            matched = match_lines(lines, in_window, account_id, linked=links)
            stored_lines = []
            for line in lines:
                result = matched["lines"][line["index"]]
                already = bool(result["tx_id"]) and any(
                    links.get(k) == result["tx_id"] for k in (line.get("fitid"), line["origin_key"]) if k)
                state = ("matched" if result["level"] == "strong"
                         else "review" if result["level"] in ("probable", "value_diff") else "open")
                stored_lines.append({**line, "level": "already" if already else result["level"], "tx_id": result["tx_id"],
                                     "reasons": result["reasons"], "state": state})
            in_period = {tx["id"] for tx in in_window if payload.period_start <= str(tx.get("date", "")) <= payload.period_end}
            finnos = [{"tx_id": tx_id, "state": "open", "repeated_of": matched["repeated"].get(tx_id)}
                      for tx_id in matched["only_finnos"] if tx_id in in_period]
            doc = {
                "id": rid, "account_id": account_id, "period_start": payload.period_start, "period_end": payload.period_end,
                "file_name": payload.file_name, "file_hash": payload.file_hash, "source": payload.source,
                "bank_closing_cents": None if payload.bank_closing_balance is None else _cents(payload.bank_closing_balance),
                "finnos_closing_cents": balance_until(movements, account, payload.period_end),
                "status": "pronta", "lines": stored_lines, "finnos": finnos, "events": 0,
                "created_at": _now().isoformat(),
            }
            tr.create(ref, doc)
            return doc

        return store.atomic(instance, uid, action)

    return _summary(await run_in_threadpool(execute))


@router.get("/accounts/{account_id}/reconciliations")
async def list_reconciliations(account_id: str, user: dict = Depends(require_user)):
    uid = store.scoped({"user_id": user["id"]})

    def read():
        owner = store.root(store.client(), uid)
        snaps = owner.collection("reconciliations").where("account_id", "==", account_id).limit(200).stream(timeout=15)
        docs = [s.to_dict() for s in snaps]
        return sorted(({k: d[k] for k in ("id", "period_start", "period_end", "status", "file_name", "created_at",
                                          "bank_closing_cents", "finnos_closing_cents")} for d in docs),
                      key=lambda d: d["created_at"], reverse=True)

    return await run_in_threadpool(read)


@router.get("/reconciliations/open")
async def list_open_reconciliations(user: dict = Depends(require_user)):
    """Carteira (etapa 6): conferências começadas e não concluídas, para o aviso de diferença de saldo.

    One indexed equality query; the difference is the one read when the file was attached
    (bank closing − FINNOS closing), enough to tell the person there is something to review.
    """
    uid = store.scoped({"user_id": user["id"]})

    def read():
        owner = store.root(store.client(), uid)
        docs = [s.to_dict() for s in owner.collection("reconciliations").where("status", "==", "pronta").limit(200).stream(timeout=15)]
        out = []
        for d in docs:
            bank, finnos = d.get("bank_closing_cents"), d.get("finnos_closing_cents")
            out.append({
                "id": d["id"], "scope": d.get("scope") or "account", "account_id": d.get("account_id"),
                "card_id": d.get("card_id"), "cycle": d.get("cycle"), "period_end": d.get("period_end"),
                "difference": None if bank is None or finnos is None else (bank - finnos) / 100,
                "pending": _summary(d)["pending"], "created_at": d.get("created_at"),
            })
        return sorted(out, key=lambda d: d["created_at"] or "", reverse=True)

    return await run_in_threadpool(read)


@router.get("/reconciliations/{rid}")
async def get_reconciliation(rid: str, user: dict = Depends(require_user)):
    uid = store.scoped({"user_id": user["id"]})

    def read():
        owner = store.root(store.client(), uid)
        snap = owner.collection("reconciliations").document(store.resource_id(rid)).get()
        if not snap.exists:
            raise HTTPException(404, "Conferência não encontrada.")
        doc = snap.to_dict()
        events = [s.to_dict() for s in owner.collection("reconciliation_events").where("reconciliation_id", "==", rid)
                  .limit(5000).stream(timeout=15)]
        if doc["status"] != "concluida" and doc.get("scope") == "card":
            card_snap = owner.collection("cards").document(store.resource_id(doc["card_id"])).get()
            if card_snap.exists:
                card = dict(store.decode(card_snap.to_dict()), id=doc["card_id"])
                txs = store.card_purchase_rows(store.client(), uid, doc["card_id"], None)
                doc["finnos_closing_cents"] = card_movements(card, txs, doc["cycle"])[1]["total_cents"]
        elif doc["status"] != "concluida":
            # Live: decisions and adjustments change the FINNOS side until it is concluded.
            account_snap = owner.collection("accounts").document(store.resource_id(doc["account_id"])).get()
            if account_snap.exists:
                account = dict(store.decode(account_snap.to_dict()), id=doc["account_id"])
                movements = store.account_movement_rows(store.client(), uid, doc["account_id"], None)
                doc["finnos_closing_cents"] = balance_until(movements, account, doc["period_end"])
        return {**_summary(doc), "history": sorted(events, key=lambda e: e["seq"])}

    return await run_in_threadpool(read)



# ---------------------------------------------------------------- card invoice (etapa 4)

CARD_ACCOUNT = "__invoice__"  # virtual account the invoice lines are matched against


def card_movements(card: dict, txs: list[dict], cycle: str, categories: dict | None = None) -> tuple[list[dict], dict]:
    """The FINNOS side of one invoice as matchable movements (cents in ``value``)."""
    from finnos.lib.invoices import invoice_state

    state = invoice_state(card, txs, cycle, categories or {})
    movements = []
    for item in state["items"]:
        movements.append({"id": item["id"], "date": item["date"], "name": item["name"], "type": "despesa",
                          "status": "pago", "account_id": CARD_ACCOUNT, "value": D(item["purchase_cents"]) / 100,
                          "installment_label": item.get("installment_label")})
    for index, credit in enumerate(state.get("adjustments") or []):
        movements.append({"id": f"credit:{cycle}:{index}", "date": credit.get("date") or cycle,
                          "name": credit.get("description") or "Crédito na fatura", "type": "receita", "status": "pago",
                          "account_id": CARD_ACCOUNT, "value": D(credit["credit_cents"]) / 100})
    saved = (card.get("invoice_cycles") or {}).get(cycle) or {}
    for payment in saved.get("payments") or []:
        movements.append({"id": f"pay:{payment['id']}", "date": payment["date"], "name": "Pagamento da fatura",
                          "type": "receita", "status": "pago", "account_id": CARD_ACCOUNT,
                          "value": D(payment["cents"]) / 100})
    return movements, state


def _read_invoice_pages(pages: list[PageTextIn]):
    from finnos.document_intelligence.extractors import extract_card_invoice
    from finnos.document_intelligence.models import TextSpan

    spans = [TextSpan(text=line, page=p.page) for p in pages for line in p.text.splitlines() if line.strip()]
    return extract_card_invoice(spans, source_engine="native_text")


@router.post("/cards/{card_id}/reconciliations")
async def create_card_reconciliation(card_id: str, payload: CardReconciliationIn, user: dict = Depends(require_user),
                                     x_finnos_operation_id: str = Header(...)):
    """Compare the bank's invoice with the FINNOS invoice of ``cycle``."""
    uid = store.scoped({"user_id": user["id"]})
    rid = hashlib.sha256(f"{uid}:card-rec:{x_finnos_operation_id}".encode()).hexdigest()[:32]
    fields: dict = {}
    checks: list = []
    warnings: list = []
    lines: list[dict] = []
    if payload.pages:
        extraction = _read_invoice_pages(payload.pages)
        fields = {k: v.value for k, v in extraction.fields.items()}
        checks = [c.to_dict() for c in extraction.checks]
        warnings = list(extraction.warnings)
        for row in extraction.rows:
            if row.amount_cents is None or row.amount_cents.value is None or row.transaction_date is None \
                    or row.transaction_date.value is None or row.direction.value == "unknown":
                warnings.append(f"linha_ilegivel:{row.line_index}")
                continue
            lines.append({
                "date": row.transaction_date.value, "description": row.description.value if row.description else "",
                "cents": int(row.amount_cents.value), "direction": "in" if row.direction.value == "income" else "out",
                "fitid": None, "operation": row.operation.value,
                "installment": row.installment.to_dict() if row.installment else None,
                "confidence": row.confidence_level.value, "evidence": row.amount_cents.evidence.text,
            })
    else:
        for line in payload.lines:
            lines.append({"date": line.date, "description": line.description.strip(), "cents": _cents(line.value),
                          "direction": line.direction, "fitid": line.fitid, "operation": None, "installment": None,
                          "confidence": "high", "evidence": None})
    if not lines:
        raise HTTPException(422, "Não encontrei lançamentos nesta fatura.")
    for index, line in enumerate(lines):
        line["index"] = index
        line["origin_key"] = origin_key(uid, f"card:{card_id}", line)

    def execute():
        instance = store.client()

        def action(tr):
            owner = store.root(instance, uid)
            ref = owner.collection("reconciliations").document(rid)
            existing = ref.get(transaction=tr)
            if existing.exists:
                return existing.to_dict()
            snap = owner.collection("cards").document(store.resource_id(card_id)).get(transaction=tr)
            if not snap.exists:
                raise HTTPException(404, "Cartão não encontrado.")
            card = dict(store.decode(snap.to_dict()), id=card_id)
            txs = store.card_purchase_rows(instance, uid, card_id, tr)
            movements, state = card_movements(card, txs, payload.cycle)
            # Previous balance only explains the total; it is not a purchase to match.
            matchable = [l for l in lines if l.get("operation") != "previous_balance"]
            matched = match_lines(matchable, movements, CARD_ACCOUNT)
            stored = []
            for line in lines:
                if line.get("operation") == "previous_balance":
                    stored.append({**line, "level": "info", "tx_id": None, "reasons": ["saldo da fatura anterior"],
                                   "state": "matched"})
                    continue
                result = matched["lines"][line["index"]]
                state_name = ("matched" if result["level"] == "strong"
                              else "review" if result["level"] in ("probable", "value_diff") else "open")
                reasons = list(result["reasons"])
                if line.get("confidence") != "high" and state_name == "matched":
                    state_name = "review"  # an uncertain reading is always shown to the person
                    reasons.append("leitura a confirmar")
                level = result["level"]
                if line.get("confidence") != "high" and level == "strong":
                    level = "probable"
                stored.append({**line, "level": level, "tx_id": result["tx_id"], "reasons": reasons, "state": state_name})
            finnos = [{"tx_id": tx_id, "state": "open", "repeated_of": matched["repeated"].get(tx_id),
                       "name": next(m["name"] for m in movements if m["id"] == tx_id),
                       "cents": cents(next(m["value"] for m in movements if m["id"] == tx_id))}
                      for tx_id in matched["only_finnos"]]
            printed_total = fields.get("total_cents")
            doc = {
                "id": rid, "scope": "card", "card_id": card_id, "account_id": None, "cycle": payload.cycle,
                "period_start": state["cycle_start"], "period_end": payload.cycle,
                "file_name": payload.file_name, "file_hash": payload.file_hash, "source": payload.source,
                "bank_closing_cents": printed_total, "finnos_closing_cents": state["total_cents"],
                "invoice_fields": {k: fields.get(k) for k in ("due_date", "total_cents", "minimum_payment_cents",
                                                               "card_last_digits", "closing_date") if k in fields},
                "invoice_checks": checks, "warnings": warnings,
                "status": "pronta", "lines": stored, "finnos": finnos, "events": 0, "created_at": _now().isoformat(),
            }
            tr.create(ref, doc)
            return doc

        return store.atomic(instance, uid, action)

    return _summary(await run_in_threadpool(execute))


@router.get("/cards/{card_id}/reconciliations")
async def list_card_reconciliations(card_id: str, user: dict = Depends(require_user)):
    uid = store.scoped({"user_id": user["id"]})

    def read():
        owner = store.root(store.client(), uid)
        docs = [s.to_dict() for s in owner.collection("reconciliations").where("card_id", "==", card_id).limit(200).stream(timeout=15)]
        return sorted(({k: d.get(k) for k in ("id", "cycle", "period_start", "period_end", "status", "file_name", "created_at",
                                              "bank_closing_cents", "finnos_closing_cents")} for d in docs),
                      key=lambda d: d["created_at"], reverse=True)

    return await run_in_threadpool(read)


# ---------------------------------------------------------------- decisions


def _tx(owner, tr, tx_id: str, doc: dict | None = None, *, changes_money: bool = True) -> tuple[object, dict]:
    if ":" in tx_id:
        raise HTTPException(409, "Este item só muda pelo próprio fluxo (pagamento, crédito ou saldo levado).")
    ref = owner.collection("transactions").document(store.resource_id(tx_id))
    snap = ref.get(transaction=tr)
    if not snap.exists:
        raise HTTPException(409, "Lançamento não encontrado; ele pode ter sido excluído.")
    tx = dict(store.decode(snap.to_dict()), id=tx_id)
    if tx.get("invoice_payment") or tx.get("invoice_refund") or tx.get("reversed_by") or tx.get("reversal_of") \
            or tx.get("balance_adjustment"):
        raise HTTPException(409, "Este lançamento só muda pelo próprio fluxo (fatura, estorno ou ajuste).")
    if doc and doc.get("scope") == "card":
        if tx.get("card_id") != doc["card_id"]:
            raise HTTPException(409, "Este lançamento não é deste cartão.")
        saved = ((doc.get("_card") or {}).get("invoice_cycles") or {}).get(doc["cycle"]) or {}
        if changes_money and saved.get("paid_cents"):
            raise HTTPException(409, "Fatura já paga: a diferença entra como crédito ou compra na próxima fatura.")
    elif doc and doc.get("account_id") and doc["account_id"] not in (tx.get("account_id"), tx.get("to_account_id")):
        raise HTTPException(409, "Este lançamento não é desta conta.")
    return ref, tx


@router.post("/reconciliations/{rid}/resolve")
async def resolve(rid: str, payload: ResolveIn, user: dict = Depends(require_user), x_finnos_operation_id: str = Header(...)):
    uid = store.scoped({"user_id": user["id"]})
    event_id = hashlib.sha256(f"{uid}:{rid}:{x_finnos_operation_id}".encode()).hexdigest()[:32]

    def execute():
        instance = store.client()

        def action(tr):
            owner = store.root(instance, uid)
            ref = owner.collection("reconciliations").document(store.resource_id(rid))
            snap = ref.get(transaction=tr)
            if not snap.exists:
                raise HTTPException(404, "Conferência não encontrada.")
            doc = snap.to_dict()
            event_ref = owner.collection("reconciliation_events").document(event_id)
            if event_ref.get(transaction=tr).exists:
                return doc  # same operation replayed
            if doc["status"] == "concluida":
                raise HTTPException(409, "Conferência concluída; abra uma nova para mudar algo.")
            if doc.get("scope") == "card":
                card_snap = owner.collection("cards").document(store.resource_id(doc["card_id"])).get(transaction=tr)
                doc["_card"] = store.decode(card_snap.to_dict()) if card_snap.exists else {}
            effects: dict = {}
            reads: dict = {}
            if payload.line is not None:
                if not 0 <= payload.line < len(doc["lines"]):
                    raise HTTPException(404, "Linha não encontrada.")
                target = f"line:{payload.line}"
                line = doc["lines"][payload.line]
                before = dict(line)
                allowed = {
                    "review": {"confirm", "separate", "use_bank_value", "keep_value"},
                    "open": {"link", "ignore"},
                }.get(line["state"], set())
                if payload.action not in allowed:
                    raise HTTPException(409, "Esta linha já foi decidida; desfaça a decisão para mudar.")
                if payload.action == "use_bank_value":
                    reads["tx"] = _tx(owner, tr, line["tx_id"], doc)
                    if line.get("installment") or reads["tx"][1].get("installment"):
                        raise HTTPException(409, "Compra parcelada: corrija o valor da compra no registro, não a parcela.")
                if payload.action == "link":
                    if not payload.tx_id:
                        raise HTTPException(422, "Informe o lançamento a ligar.")
                    if any(l.get("tx_id") == payload.tx_id and l["state"] == "matched" for l in doc["lines"]):
                        raise HTTPException(409, "Este lançamento já está ligado a outra linha.")
                    reads["link"] = _tx(owner, tr, payload.tx_id, doc, changes_money=False)
                # ---- writes start here
                if payload.action == "confirm":
                    line.update(state="matched")
                elif payload.action == "separate":
                    doc["finnos"].append({"tx_id": line["tx_id"], "state": "open", "repeated_of": None})
                    line.update(state="open", tx_id=None, level="only_statement")
                elif payload.action == "keep_value":
                    line.update(state="matched", kept_difference=True)
                elif payload.action == "use_bank_value":
                    tx_ref, tx = reads["tx"]
                    updated = dict(tx, value=D(line["cents"]) / 100, version=int(tx.get("version", 1)) + 1, updated_at=_now())
                    tr.set(tx_ref, store.encode(updated))
                    record_event(tr, owner, "transactions", "updated", tx, updated)
                    effects["tx_updated"] = {"id": tx["id"], "before_cents": cents(tx["value"])}
                    line.update(state="matched")
                elif payload.action == "link":
                    _, tx = reads["link"]
                    line.update(state="matched", tx_id=tx["id"], level="linked")
                    doc["finnos"] = [f for f in doc["finnos"] if f["tx_id"] != tx["id"]]
                    effects["linked"] = tx["id"]
                elif payload.action == "ignore":
                    line.update(state="ignored")
                after = dict(line)
            else:
                if not payload.tx_id:
                    raise HTTPException(422, "Informe a linha ou o lançamento.")
                target = f"finnos:{payload.tx_id}"
                item = next((f for f in doc["finnos"] if f["tx_id"] == payload.tx_id), None)
                if item is None or item["state"] != "open":
                    raise HTTPException(409, "Este lançamento já foi decidido; desfaça a decisão para mudar.")
                before = dict(item)
                card_scope = doc.get("scope") == "card"
                if payload.action == "delete" or (payload.action == "keep_pending" and not card_scope):
                    reads["tx"] = _tx(owner, tr, payload.tx_id, doc)
                if payload.action == "keep":
                    item.update(state="kept")
                elif payload.action == "keep_pending" and card_scope:
                    item.update(state="pending")  # it will show up on a later invoice: nothing changes
                elif payload.action == "keep_pending":
                    tx_ref, tx = reads["tx"]
                    updated = dict(tx, status="pendente", version=int(tx.get("version", 1)) + 1, updated_at=_now())
                    tr.set(tx_ref, store.encode(updated))
                    record_event(tr, owner, "transactions", "updated", tx, updated)
                    effects["tx_updated"] = {"id": tx["id"], "before_status": tx.get("status")}
                    item.update(state="pending")
                elif payload.action == "delete":
                    tx_ref, tx = reads["tx"]
                    tr.delete(tx_ref)
                    record_event(tr, owner, "transactions", "deleted", tx, None)
                    effects["tx_deleted"] = store.encode(tx)
                    item.update(state="deleted")
                else:
                    raise HTTPException(422, "Ação inválida.")
                after = dict(item)
            doc["events"] = int(doc.get("events", 0)) + 1
            tr.create(event_ref, {
                "id": event_id, "reconciliation_id": rid, "seq": doc["events"], "action": payload.action,
                "target": target, "before": before, "after": after, "effects": effects, "note": payload.note,
                "actor": uid, "created_at": _now().isoformat(), "undone_by": None, "undo_of": None,
            })
            doc.pop("_card", None)
            tr.set(ref, doc)
            return doc

        return store.atomic(instance, uid, action)

    return _summary(await run_in_threadpool(execute))


@router.post("/reconciliations/{rid}/events/{event_id}/undo")
async def undo_event(rid: str, event_id: str, user: dict = Depends(require_user), x_finnos_operation_id: str = Header(...)):
    uid = store.scoped({"user_id": user["id"]})
    undo_id = hashlib.sha256(f"{uid}:{rid}:undo:{x_finnos_operation_id}".encode()).hexdigest()[:32]

    def execute():
        instance = store.client()

        def action(tr):
            owner = store.root(instance, uid)
            ref = owner.collection("reconciliations").document(store.resource_id(rid))
            doc = ref.get(transaction=tr).to_dict()
            undo_ref = owner.collection("reconciliation_events").document(undo_id)
            if undo_ref.get(transaction=tr).exists:
                return doc
            if doc["status"] == "concluida":
                raise HTTPException(409, "Conferência concluída; abra uma nova para mudar algo.")
            event_ref = owner.collection("reconciliation_events").document(store.resource_id(event_id))
            event_snap = event_ref.get(transaction=tr)
            if not event_snap.exists:
                raise HTTPException(404, "Decisão não encontrada.")
            event = event_snap.to_dict()
            if event.get("undone_by") or event.get("undo_of"):
                raise HTTPException(409, "Esta decisão já foi desfeita.")
            later = [s.to_dict() for s in owner.collection("reconciliation_events")
                     .where("reconciliation_id", "==", rid).limit(5000).stream(transaction=tr)]
            depends = [e for e in later if e["seq"] > event["seq"] and not e.get("undone_by") and not e.get("undo_of")
                       and (e["target"] == event["target"]
                            or (event["effects"].get("linked") and e["target"] == f"finnos:{event['effects']['linked']}"))]
            if depends:
                raise HTTPException(409, "Uma decisão posterior depende desta; desfaça aquela primeiro.")
            effects = event["effects"]
            restore = None
            if "tx_updated" in effects:
                restore = _tx(owner, tr, effects["tx_updated"]["id"])
            recreate_ref = None
            if "tx_deleted" in effects:
                recreate_ref = owner.collection("transactions").document(store.resource_id(effects["tx_deleted"]["id"]))
                if recreate_ref.get(transaction=tr).exists:
                    raise HTTPException(409, "O lançamento excluído já existe de novo.")
            # ---- writes
            if restore is not None:
                tx_ref, tx = restore
                updated = dict(tx, version=int(tx.get("version", 1)) + 1, updated_at=_now())
                if "before_cents" in effects["tx_updated"]:
                    updated["value"] = D(effects["tx_updated"]["before_cents"]) / 100
                if "before_status" in effects["tx_updated"]:
                    updated["status"] = effects["tx_updated"]["before_status"]
                tr.set(tx_ref, store.encode(updated))
                record_event(tr, owner, "transactions", "updated", tx, updated)
            if recreate_ref is not None:
                snapshot = dict(effects["tx_deleted"])
                tr.create(recreate_ref, snapshot)
                record_event(tr, owner, "transactions", "created", None, dict(store.decode(snapshot), id=snapshot["id"]))
            kind, key = event["target"].split(":", 1)
            if kind == "line":
                doc["lines"][int(key)] = event["before"]
                if event["action"] == "separate":
                    doc["finnos"] = [f for f in doc["finnos"] if f["tx_id"] != event["before"]["tx_id"]]
                if event["action"] == "link":
                    doc["finnos"].append({"tx_id": effects["linked"], "state": "open", "repeated_of": None})
            else:
                doc["finnos"] = [event["before"] if f["tx_id"] == key else f for f in doc["finnos"]]
            doc["events"] = int(doc.get("events", 0)) + 1
            tr.create(undo_ref, {
                "id": undo_id, "reconciliation_id": rid, "seq": doc["events"], "action": "undo", "target": event["target"],
                "before": event["after"], "after": event["before"], "effects": {}, "note": "",
                "actor": uid, "created_at": _now().isoformat(), "undone_by": None, "undo_of": event["id"],
            })
            tr.update(event_ref, {"undone_by": undo_id})
            tr.set(ref, doc)
            return doc

        return store.atomic(instance, uid, action)

    return _summary(await run_in_threadpool(execute))


@router.post("/reconciliations/{rid}/complete")
async def complete(rid: str, payload: CompleteIn | None = None, user: dict = Depends(require_user)):
    """All lines decided and the balances equal → account "Conferida até".

    For a card invoice the totals must match, or the person explains the
    difference in a note; the invoice is then marked as reconciled."""
    note = (payload.note if payload else "").strip()
    uid = store.scoped({"user_id": user["id"]})

    def execute():
        instance = store.client()

        def action(tr):
            owner = store.root(instance, uid)
            ref = owner.collection("reconciliations").document(store.resource_id(rid))
            doc = ref.get(transaction=tr).to_dict()
            if doc["status"] == "concluida":
                return doc
            summary = _summary(doc)
            if summary["pending"]:
                raise HTTPException(409, f"Ainda há {summary['pending']} item(ns) para decidir.")
            if doc.get("scope") == "card":
                return _complete_card(owner, tr, instance, uid, ref, doc, note)
            account_ref = owner.collection("accounts").document(store.resource_id(doc["account_id"]))
            account = _account(owner, tr, doc["account_id"])
            movements = store.account_movement_rows(instance, uid, doc["account_id"], tr)
            finnos_closing = balance_until(movements, account, doc["period_end"])
            if doc.get("bank_closing_cents") is not None and finnos_closing != doc["bank_closing_cents"]:
                raise HTTPException(409, {"code": "saldo_diferente", "finnos": finnos_closing / 100,
                                          "bank": doc["bank_closing_cents"] / 100,
                                          "message": "Os saldos ainda não batem. Corrija o saldo ou revise as linhas."})
            for line in doc["lines"]:
                if line["state"] == "matched" and line.get("tx_id"):
                    for key in (line.get("fitid"), line["origin_key"]):
                        if key:
                            link_id = hashlib.sha256(f"{doc['account_id']}:{key}".encode()).hexdigest()[:40]
                            tr.set(owner.collection("reconciliation_links").document(link_id),
                                   {"account_id": doc["account_id"], "key": key, "tx_id": line["tx_id"],
                                    "reconciliation_id": rid})
            current = account.get("reconciled_until")
            if not current or current < doc["period_end"]:
                tr.update(account_ref, {"reconciled_until": doc["period_end"]})
            doc.update(status="concluida", finnos_closing_cents=finnos_closing, completed_at=_now().isoformat())
            tr.set(ref, doc)
            return doc

        return store.atomic(instance, uid, action)

    return _summary(await run_in_threadpool(execute))


def _complete_card(owner, tr, instance, uid, ref, doc, note):
    card_ref = owner.collection("cards").document(store.resource_id(doc["card_id"]))
    snap = card_ref.get(transaction=tr)
    card = dict(store.decode(snap.to_dict()), id=doc["card_id"])
    txs = store.card_purchase_rows(instance, uid, doc["card_id"], tr)
    total = card_movements(card, txs, doc["cycle"])[1]["total_cents"]
    bank = doc.get("bank_closing_cents")
    if bank is not None and total != bank and len(note) < 3:
        raise HTTPException(409, {"code": "total_diferente", "finnos": total / 100, "bank": bank / 100,
                                  "message": "Os totais ainda não batem. Registre o que falta ou explique a diferença."})
    for line in doc["lines"]:
        if line["state"] == "matched" and line.get("tx_id") and ":" not in line["tx_id"]:
            link_id = hashlib.sha256(f"card:{doc['card_id']}:{line['origin_key']}".encode()).hexdigest()[:40]
            tr.set(owner.collection("reconciliation_links").document(link_id),
                   {"account_id": f"card:{doc['card_id']}", "key": line["origin_key"], "tx_id": line["tx_id"],
                    "reconciliation_id": doc["id"]})
    cycles = card.setdefault("invoice_cycles", {})
    entry = dict(cycles.get(doc["cycle"]) or {})
    fields = doc.get("invoice_fields") or {}
    entry.update(reconciled=True, reconciled_at=_now().isoformat(), reconciled_total_cents=bank,
                 minimum_cents=fields.get("minimum_payment_cents"), reconciliation_id=doc["id"])
    cycles[doc["cycle"]] = entry
    tr.set(card_ref, store.encode(card))
    doc.update(status="concluida", finnos_closing_cents=total, completed_at=_now().isoformat(),
               difference_note=note or None)
    tr.set(ref, doc)
    return doc


# ---------------------------------------------------------------- balance adjustment


@router.post("/accounts/{account_id}/adjustments")
async def adjust_balance(account_id: str, payload: AdjustmentIn, user: dict = Depends(require_user),
                         x_finnos_operation_id: str = Header(...)):
    """Auditable balance correction: reason, before/after/difference, author and
    the conferência that originated it. Kept out of spending and income."""
    if payload.date > today_iso():
        raise HTTPException(422, "O ajuste não pode ter data futura.")
    uid = store.scoped({"user_id": user["id"]})
    tx_id = hashlib.sha256(f"{uid}:adjust:{x_finnos_operation_id}".encode()).hexdigest()

    def execute():
        instance = store.client()

        def action(tr):
            owner = store.root(instance, uid)
            ref = owner.collection("transactions").document(tx_id)
            existing = ref.get(transaction=tr)
            if existing.exists:
                return dict(store.decode(existing.to_dict()), id=tx_id)
            account = _account(owner, tr, account_id)
            movements = store.account_movement_rows(instance, uid, account_id, tr)
            before = balance_until(movements, account, payload.date)
            target = _cents(payload.target_balance) if payload.target_balance >= 0 else -_cents(-payload.target_balance)
            diff = target - before
            if diff == 0:
                raise HTTPException(409, "O saldo já é este; nada a ajustar.")
            now = _now()
            doc = {
                "id": tx_id, "user_id": uid, "name": "Ajuste de saldo", "value": D(abs(diff)) / 100,
                "type": "receita" if diff > 0 else "despesa", "status": "pago", "date": payload.date,
                "account_id": account_id, "card_id": None, "to_account_id": None, "category_id": None,
                "fixed": False, "installment": False, "notes": payload.reason, "balance_adjustment": True,
                "adjustment": {"previous_cents": before, "new_cents": target, "difference_cents": diff,
                               "reason": payload.reason, "author": uid,
                               "reconciliation_id": payload.reconciliation_id},
                "source": "manual", "version": 1, "created_at": now, "updated_at": now,
            }
            tr.create(ref, store.encode(doc))
            record_event(tr, owner, "transactions", "created", None, doc)
            return doc

        return store.atomic(instance, uid, action)

    doc = await run_in_threadpool(execute)
    adjustment = doc.get("adjustment") or {}
    return {"id": doc["id"], "type": doc["type"], "value": float(doc["value"]), "date": doc["date"],
            "previous_balance": adjustment.get("previous_cents", 0) / 100,
            "new_balance": adjustment.get("new_cents", 0) / 100,
            "difference": adjustment.get("difference_cents", 0) / 100}
