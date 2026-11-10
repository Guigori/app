"""Compras pendentes (vindas do Apple Pay): ver, registrar, excluir e ajustar.

O Atalho só *deixa* a compra aqui (`POST /shortcuts/pendentes`, em shortcuts.py). Quem decide é
a pessoa, no app: registrar vira um lançamento comum com a mesma validação do app; excluir
descarta. Registrar duas vezes (toque duplo, rede lenta) grava uma vez só.

Cada registro feito pela pessoa ensina o FINNOS: a categoria daquele comerciante e a conta (débito)
ou o cartão (crédito) daquele nome de cartão do Apple Pay. Isso só pré-preenche a próxima compra;
débito é o padrão e débito/crédito é sempre confirmado.

Com "registrar sozinho" ligado, só uma combinação confirmada várias vezes seguidas, no débito, é
registrada na hora, com aviso e "Desfazer" (que faz o FINNOS desaprender aquela combinação).
"""
import uuid
from decimal import Decimal
from typing import Literal, Optional, Union

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from finnos.lib import integration_tokens as tokens
from finnos.lib import pending_captures as pending
from finnos.lib.dates import today_iso
from finnos.lib.db import db
from finnos.models.finnos import TransactionIn
from finnos.routers import transactions as tx
from finnos.routers.auth import require_user
from finnos.routers.shortcuts import _category_from_history, _date, _wallets

router = APIRouter(prefix="/pending-captures", tags=["pending-captures"])
# A purchase waiting this long is flagged "pendente há N dias" so it is not forgotten.
STALE_DAYS = 3


async def present(uid: str, rows: list[dict]) -> list[dict]:
    """The stored captures with their origin re-checked against today's cards, accounts and choices.

    Re-checking matters: a card registered after the purchase arrived stops being "não
    cadastrado" as soon as it exists, without anyone touching the pending purchase.
    """
    accounts, cards, _ = await _wallets(uid)
    rules = await run_in_threadpool(pending.learned, uid) if rows else pending.empty_rules()
    out = []
    for row in rows:
        stored = row.get("source") or {}
        source = pending.identify_source(stored.get("sent"), accounts, cards)
        hint = pending.suggest(stored.get("sent"), row["name"], rules, accounts, cards)
        category = hint["category_id"] or (None if row.get("is_test") else await _category_from_history(uid, row["name"], "despesa"))
        days = pending.waiting_days(row.get("created_at"))
        out.append({
            "id": row["id"],
            "name": row["name"],
            "value": row["value_cents"] / 100,
            "date": row["date"],
            "created_at": row.get("created_at"),
            "is_test": bool(row.get("is_test")),
            "waiting_days": days,
            "stale": days >= STALE_DAYS,
            "source_kind": source["kind"],
            "source_registered": source["registered"],
            "source_id": source["id"],
            "source_name": source["name"],
            "source_sent": source["sent"],
            "pays_from": source["pays_from"],
            "origin": pending.origin_label(source),
            # Pre-filled answers: débito by default, with what FINNOS learned.
            "suggested_method": hint["method"],
            "suggested_account_id": hint["debit_account_id"],
            "suggested_card_id": hint["credit_card_id"],
            "suggested_category_id": category,
            "ambiguous": hint["ambiguous"],
            "learned_wallet": hint["learned_wallet"],
            "learned_category": hint["learned_category"],
        })
    return out


def present_auto(rows: list[dict], accounts: list[dict]) -> list[dict]:
    """Purchases registered on their own in the last days, to confirm ("Ok") or undo."""
    names = {a["id"]: a["name"] for a in accounts}
    out = []
    for row in rows:
        if pending.waiting_days(row.get("created_at")) > pending.AUTO_LOG_DAYS:
            continue
        capture = row.get("capture") or {}
        out.append({
            "id": row["id"],
            "transaction_id": row["transaction_id"],
            "name": capture.get("name", ""),
            "value": capture.get("value_cents", 0) / 100,
            "date": capture.get("date"),
            "account_name": names.get(row.get("account_id")),
            "category_id": row.get("category_id"),
            # Registered although far above the merchant's usual (hold_unusual off).
            "unusual": bool(row.get("unusual")),
        })
    return out


@router.get("")
async def list_pending(user: dict = Depends(require_user)):
    rows = await run_in_threadpool(pending.list_all, user["id"])
    items = await present(user["id"], rows)
    auto_rows = await run_in_threadpool(pending.auto_log_list, user["id"])
    auto = present_auto(auto_rows, (await _wallets(user["id"]))[0]) if auto_rows else []
    return {"items": items, "count": len(items), "auto": auto}


class ConfirmIn(BaseModel):
    """What the person fixed on the screen before registering. Everything is optional.

    method "debito": the money left account_id (or the suggested account) right away.
    method "credito": it went on card_id (or the suggested card), in `installments` parts, and is
    paid with that card's invoice. Without method, the old behaviour: card or account by name.
    """
    method: Optional[Literal["debito", "credito"]] = None
    account_id: Optional[str] = Field(default=None, max_length=200)
    card_id: Optional[str] = Field(default=None, max_length=200)
    category_id: Optional[str] = Field(default=None, max_length=200)
    name: Optional[str] = Field(default=None, max_length=80)
    value: Optional[Union[str, float]] = None
    date: Optional[str] = Field(default=None, max_length=20)
    installments: int = Field(default=1, ge=1, le=120)


async def register_capture(uid: str, capture: dict, body: ConfirmIn, learn: bool = True, auto: bool = False, unusual: bool = False) -> str:
    """Turns one pending purchase into a lançamento. Returns the lançamento id.

    Raises HTTPException (422 and friends) with a plain-Portuguese reason when it cannot, leaving
    the pending purchase untouched. Registering the same capture twice yields the same lançamento.
    """
    if capture.get("is_test"):
        raise HTTPException(422, "Esta é uma compra de teste: exclua-a. Ela mostra que o Atalho está falando com o FINNOS.")
    accounts, cards, _ = await _wallets(uid)
    sent = (capture.get("source") or {}).get("sent")
    found = pending.identify_source(sent, accounts, cards)
    rules = await run_in_threadpool(pending.learned, uid)
    hint = pending.suggest(sent, capture["name"], rules, accounts, cards)
    active_cards = [c for c in cards if c.get("active", True)]
    active_accounts = [a for a in accounts if a.get("active", True)]

    card = None
    account = None
    if body.method == "credito":
        wanted = body.card_id or hint["credit_card_id"]
        card = next((c for c in active_cards if c["id"] == wanted), None)
        if not card:
            raise HTTPException(422, "Crédito: escolha o cartão de crédito usado.")
    elif body.method == "debito":
        if body.installments > 1:
            raise HTTPException(422, "Parcelamento só no crédito. Mude para Crédito ou registre à vista.")
        wanted = body.account_id or hint["debit_account_id"]
        account = next((a for a in active_accounts if a["id"] == wanted), None)
        if not account:
            raise HTTPException(422, "Débito: escolha a conta de onde saiu o dinheiro.")
    elif body.card_id:
        card = next((c for c in cards if c["id"] == body.card_id), None)
        if not card:
            raise HTTPException(422, "Cartão inválido: escolha um cartão cadastrado.")
    elif body.account_id:
        account = next((a for a in accounts if a["id"] == body.account_id), None)
        if not account:
            raise HTTPException(422, "Conta inválida: escolha uma conta cadastrada.")
    elif found["kind"] == "cartao":
        card = next(c for c in cards if c["id"] == found["id"])
    elif found["kind"] == "conta":
        account = next(a for a in accounts if a["id"] == found["id"])
    else:
        # Never default to "the first account": the whole point is to know where it came from.
        raise HTTPException(422, "Escolha de onde saiu o dinheiro: um cartão ou uma conta cadastrada.")

    if card:
        account = next((a for a in accounts if a["id"] == card.get("payment_account_id")), None)
        if not account:
            raise HTTPException(422, f"O cartão {card['name']} está sem conta de pagamento. Defina em Carteira → Cartões.")
    installments = body.installments
    if installments > 1 and not card:
        raise HTTPException(422, "Parcelamento só no cartão de crédito.")

    value = tokens.parse_amount(body.value) if body.value not in (None, "") else Decimal(capture["value_cents"]) / 100
    when = _date(body.date or capture.get("date"))
    name = ((body.name or "").strip() or capture["name"])[:80]
    category_id = body.category_id or hint["category_id"] or await _category_from_history(uid, name, "despesa")
    payload = TransactionIn(
        name=name, value=value, type="despesa", status="agendado" if when > today_iso() else "pago", date=when,
        account_id=account["id"], card_id=card["id"] if card else None, category_id=category_id or None,
        installment=installments > 1, total_installments=installments if installments > 1 else None,
        current_installment=1 if installments > 1 else None,
        notes="Capturado pelo Apple Pay" + (" · Crédito" if card else " · Débito") + (f" · {sent}" if sent else ""),
    )
    await tx._validate(uid, payload)
    doc = tx._document(uid, payload)
    doc["operation_id"] = "pending:" + capture["id"]
    doc["source"] = "ios_shortcut"
    # Shown in Fluxo as "Apple Pay" / "Apple Pay · automático", so these stay easy to find.
    doc["capture_auto"] = auto
    doc["capture_unusual"] = unusual
    # Same capture confirmed twice → same lançamento id, so it is saved once.
    target = str(uuid.uuid5(uuid.NAMESPACE_URL, uid + ":" + doc["operation_id"]))
    if await db.transactions.find_one({"id": target, "user_id": uid}) is None:
        await db.transactions.insert_one(doc)
    await run_in_threadpool(pending.remove, uid, capture["id"])
    if learn:
        changed = pending.learn(
            rules, merchant=capture["name"], label=capture["name"], category_id=category_id,
            value_cents=int(value * 100), sent=sent, method="credito" if card else "debito",
            wallet_id=card["id"] if card else account["id"],
        )
        await run_in_threadpool(pending.save_rules, uid, changed)
    return target


async def try_auto_register(uid: str, capture: dict) -> Optional[dict]:
    """"Registrar sozinho": only what the person already confirmed the same way several times.

    Débito only, from the learned account, with the learned category, not in the future and not
    far above the usual value (pending.auto_choice). Everything else waits. The purchase is kept
    in a log so the person sees it and can undo it. Returns {"id", "account_name"} or None.
    """
    settings = await run_in_threadpool(pending.get_settings, uid)
    if not settings.get("auto_register") or capture.get("is_test"):
        return None
    if capture["date"] > today_iso():
        return None
    accounts, cards, _ = await _wallets(uid)
    choice = pending.auto_choice(capture, await run_in_threadpool(pending.learned, uid), accounts, cards,
                                 hold_unusual=settings.get("hold_unusual", True))
    if not choice:
        return None
    try:
        tid = await register_capture(
            uid, capture, ConfirmIn(method="debito", account_id=choice["account_id"], category_id=choice["category_id"]),
            learn=False, auto=True, unusual=choice["unusual"],
        )
    except HTTPException:
        return None
    await run_in_threadpool(pending.auto_log_save, uid, {
        "id": capture["id"], "transaction_id": tid, "capture": capture, "created_at": capture.get("created_at"),
        **choice,
    })
    return {"id": tid, "account_name": next((a["name"] for a in accounts if a["id"] == choice["account_id"]), "")}


@router.post("/{capture_id}/confirm", status_code=201)
async def confirm_pending(capture_id: str, body: ConfirmIn, user: dict = Depends(require_user)):
    uid = user["id"]
    capture = await run_in_threadpool(pending.get, uid, capture_id)
    if not capture:
        raise HTTPException(404, "Compra pendente não encontrada. Ela pode já ter sido registrada.")
    return {"ok": True, "transaction_id": await register_capture(uid, capture, body)}


@router.delete("/{capture_id}", status_code=204)
async def discard_pending(capture_id: str, user: dict = Depends(require_user)):
    if not await run_in_threadpool(pending.remove, user["id"], capture_id):
        raise HTTPException(404, "Compra pendente não encontrada.")


@router.post("/confirm-all")
async def confirm_all(user: dict = Depends(require_user)):
    """Registers in débito every waiting purchase that already has an account to come out of.

    Débito is the default, the same as tapping Registrar on each one. A purchase with no account
    to suggest (card not registered and never chosen) is skipped, never put on some default
    account. Returns how many were registered, how many are left, and why any failed.
    """
    uid = user["id"]
    registered = 0
    skipped = 0
    failed: list[dict] = []
    accounts, cards, _ = await _wallets(uid)
    rules = await run_in_threadpool(pending.learned, uid)
    for capture in await run_in_threadpool(pending.list_all, uid):
        hint = pending.suggest((capture.get("source") or {}).get("sent"), capture["name"], rules, accounts, cards)
        # Ambiguous names (account and card both "Nubank") need débito or crédito picked by hand.
        if capture.get("is_test") or not hint["debit_account_id"] or hint["ambiguous"]:
            skipped += 1
            continue
        try:
            await register_capture(uid, capture, ConfirmIn(method="debito"))
            registered += 1
            rules = await run_in_threadpool(pending.learned, uid)
        except HTTPException as exc:
            failed.append({"id": capture["id"], "name": capture["name"], "detail": str(exc.detail)})
    return {"ok": not failed, "registered": registered, "skipped": skipped, "failed": failed}


@router.post("/auto/{entry_id}/undo")
async def undo_auto(entry_id: str, user: dict = Depends(require_user)):
    """Takes back a purchase registered on its own: the lançamento goes away, the purchase is
    pending again, and FINNOS stops registering that combination until it is confirmed again."""
    uid = user["id"]
    entry = await run_in_threadpool(pending.auto_log_get, uid, entry_id)
    if not entry:
        raise HTTPException(404, "Esse registro automático não está mais disponível para desfazer.")
    await db.transactions.delete_one({"id": entry["transaction_id"], "user_id": uid})
    capture = entry.get("capture") or {}
    if capture.get("id"):
        await run_in_threadpool(pending.save, uid, capture)
    rules = await run_in_threadpool(pending.learned, uid)
    changed = pending.unlearn(rules, merchant=capture.get("name"), sent=(capture.get("source") or {}).get("sent"))
    await run_in_threadpool(pending.save_rules, uid, changed)
    await run_in_threadpool(pending.auto_log_remove, uid, entry_id)
    return {"ok": True}


@router.delete("/auto/{entry_id}", status_code=204)
async def keep_auto(entry_id: str, user: dict = Depends(require_user)):
    """"Está certo": the purchase stays registered and leaves the list."""
    if not await run_in_threadpool(pending.auto_log_remove, user["id"], entry_id):
        raise HTTPException(404, "Esse registro automático não está mais na lista.")


@router.post("/test", status_code=201)
async def create_test_capture(user: dict = Depends(require_user)):
    """A fake purchase, so the person can see the whole flow without paying anything.

    It only shows the Shortcut-to-FINNOS path works; it cannot be registered, only deleted.
    """
    uid = user["id"]
    accounts, cards, _ = await _wallets(uid)
    doc = pending.new_document(
        uid, "test:" + uuid.uuid4().hex, name="Compra de teste", value=Decimal("1.00"), date=today_iso(),
        source=pending.identify_source("Cartão de teste", accounts, cards), token=None, is_test=True,
    )
    saved, _ = await run_in_threadpool(pending.save, uid, doc)
    return {"ok": True, "id": saved["id"]}


class SettingsIn(BaseModel):
    """Only what is sent changes; the rest is kept."""
    auto_register: Optional[bool] = None
    hold_unusual: Optional[bool] = None


@router.get("/settings")
async def get_pending_settings(user: dict = Depends(require_user)):
    return await run_in_threadpool(pending.get_settings, user["id"])


@router.put("/settings")
async def put_pending_settings(body: SettingsIn, user: dict = Depends(require_user)):
    return await run_in_threadpool(pending.save_settings, user["id"], body.model_dump(exclude_none=True))
