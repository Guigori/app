"""Apple Pay → FINNOS through the iPhone Shortcuts app.

Two parts:
- /integrations/shortcut-tokens (signed-in FINNOS session): create, list and revoke
  the personal code the Wallet automation carries, and see its recent activity.
- POST /shortcuts/pendentes (the code as `Authorization: Bearer fns_…`): leaves the
  purchase waiting for review. Answers are always {"ok", "mensagem"} so the Shortcut
  can show them, errors included.

The older flows (a ready-made shortcut registering directly, /shortcuts/opcoes and
/shortcuts/lancamentos) were removed: every Apple Pay purchase now goes through review.
"""
from datetime import datetime
from typing import Optional, Union

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from firebase_admin import auth as firebase_auth
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from finnos.lib import db as store
from finnos.lib import integration_tokens as tokens
from finnos.lib import pending_captures as pending
from finnos.lib.dates import today_iso
from finnos.lib.db import active_uid, db
from finnos.routers.auth import require_user

router = APIRouter(tags=["shortcuts"])



def brl(value) -> str:
    text = f"{float(value):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"R$ {text}"


# --- Managing the codes (from the app) ---------------------------------------

class TokenIn(BaseModel):
    label: str = Field(default="iPhone", min_length=1, max_length=40)


@router.get("/integrations/shortcut-tokens")
async def list_shortcut_tokens(user: dict = Depends(require_user)):
    rows = await run_in_threadpool(tokens.list_tokens, user["id"])
    return [{"id": r["id"], "label": r.get("label"), "hint": r.get("hint"), "created_at": r.get("created_at"), "last_used_at": r.get("last_used_at")} for r in rows]


@router.post("/integrations/shortcut-tokens", status_code=201)
async def create_shortcut_token(payload: TokenIn, user: dict = Depends(require_user)):
    raw = tokens.new_token()
    saved = await run_in_threadpool(tokens.save_token, user["id"], raw, payload.label.strip())
    await run_in_threadpool(tokens.audit, user["id"], {"action": "conectado", "ok": True, "token": saved["id"], "mensagem": f"Atalho \"{saved['label']}\" conectado."})
    # The only time the code is ever shown.
    return {"id": saved["id"], "label": saved["label"], "hint": saved["hint"], "token": raw}


@router.delete("/integrations/shortcut-tokens/{token_id}", status_code=204)
async def revoke_shortcut_token(token_id: str, user: dict = Depends(require_user)):
    if not await run_in_threadpool(tokens.revoke_token, user["id"], token_id):
        raise HTTPException(404, "Atalho não encontrado.")
    await run_in_threadpool(tokens.audit, user["id"], {"action": "desconectado", "ok": True, "token": token_id, "mensagem": "Atalho desconectado."})


@router.get("/integrations/shortcut-activity")
async def shortcut_activity(user: dict = Depends(require_user)):
    return await run_in_threadpool(tokens.recent_audit, user["id"])


# --- Used by the Shortcut ----------------------------------------------------

def account_ok(uid: str) -> None:
    """A deleted, disabled or unconfirmed FINNOS account stops its Shortcuts too."""
    try:
        user = firebase_auth.get_user(uid, app=store.firebase_application())
    except firebase_auth.UserNotFoundError as exc:
        raise HTTPException(401, "Conta FINNOS não encontrada.") from exc
    if user.disabled or not user.email_verified:
        raise HTTPException(403, "Conta FINNOS indisponível.")


async def shortcut_user(request: Request) -> dict:
    scheme, _, raw = request.headers.get("authorization", "").partition(" ")
    raw = raw.strip()
    if scheme.lower() != "bearer" or not tokens.looks_like_token(raw):
        raise HTTPException(401, "Falta o código do FINNOS no atalho. Gere um em Configurações → Integrações.")
    record = await run_in_threadpool(tokens.use_token, raw)
    await run_in_threadpool(account_ok, record["uid"])
    active_uid.set(record["uid"])
    return {"id": record["uid"], "token": record["id"]}


def answer(status: int, ok: bool, mensagem: str, **extra) -> JSONResponse:
    return JSONResponse({"ok": ok, "mensagem": mensagem, **extra}, status_code=status)


async def _wallets(uid: str):
    accounts = [a for a in await db.accounts.find({"user_id": uid}).to_list(500) if a.get("active", True)]
    cards = [c for c in await db.cards.find({"user_id": uid}).to_list(200) if c.get("active", True)]
    categories = await db.categories.find({"user_id": uid}).to_list(500)
    return accounts, cards, categories


def _date(text: Optional[str]) -> str:
    if not text or not text.strip():
        return today_iso()
    text = text.strip()
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d/%m/%y"):
        try:
            return datetime.strptime(text[:10] if fmt == "%Y-%m-%d" else text, fmt).date().isoformat()
        except ValueError:
            continue
    raise HTTPException(422, "Data inválida. Use dd/mm/aaaa.")


async def _category_from_history(uid: str, name: str, kind: str) -> Optional[str]:
    """No category sent (Apple Pay): reuse the one used last time for the same name."""
    rows = await db.transactions.find({"user_id": uid, "name": name}).to_list(50)
    rows = [r for r in rows if r.get("type") == kind and r.get("category_id")]
    rows.sort(key=lambda r: str(r.get("date")), reverse=True)
    return rows[0]["category_id"] if rows else None


class PendenteIn(BaseModel):
    """What the Wallet "Transação" automation knows: amount, merchant and the card's name."""
    valor: Union[str, float]
    descricao: Optional[str] = Field(default=None, max_length=80)
    carteira: Optional[str] = Field(default=None, max_length=80)
    data: Optional[str] = Field(default=None, max_length=20)
    id: Optional[str] = Field(default=None, max_length=80)


@router.post("/shortcuts/pendentes")
async def shortcut_pending(request: Request, body: PendenteIn):
    """Saves the purchase as *pendente*: it only becomes a lançamento when confirmed in the app.

    Deliberately forgiving: a purchase is kept even when the card is not registered (it is shown
    as "não cadastrado"), because losing it is worse than asking the person to review it.
    With "registrar sozinho" on, a combination confirmed several times in débito is registered right away.
    """
    # Imported here: that router needs this module's helpers, so a top-level import would loop.
    from finnos.routers.pending_captures import try_auto_register

    try:
        user = await shortcut_user(request)
    except HTTPException as exc:
        return answer(exc.status_code, False, exc.detail)
    uid = user["id"]
    try:
        value = tokens.parse_amount(body.valor)
        when = _date(body.data)
        name = ((body.descricao or "").strip() or "Compra")[:80]
        accounts, cards, _ = await _wallets(uid)
        source = pending.identify_source(body.carteira, accounts, cards)
        operation_id = body.id.strip() if body.id and body.id.strip() else tokens.operation_id(uid, body.model_dump())
        if await run_in_threadpool(pending.count, uid) >= pending.MAX_PENDING:
            raise HTTPException(429, "Você tem compras pendentes demais. Confirme ou exclua algumas no FINNOS.")
        doc = pending.new_document(uid, operation_id, name=name, value=value, date=when, source=source, token=user["token"])
        saved, created = await run_in_threadpool(pending.save, uid, doc)
    except HTTPException as exc:
        await run_in_threadpool(tokens.audit, uid, {"action": "pendente", "ok": False, "token": user["token"], "mensagem": str(exc.detail)})
        return answer(exc.status_code, False, str(exc.detail))

    origin = pending.origin_label(source)
    extra = dict(nome=name, valor=brl(value), origem=origin, cadastrado=source["registered"])
    if created:
        auto = await try_auto_register(uid, saved)
        # No sound if the person turned push off in Configurações → Notificações.
        prefs = await db.notification_preferences.find_one({"user_id": uid, "id": "prefs"})
        push_on = (prefs or {}).get("push_enabled", True)
        if auto:
            mensagem = f"Registrado no FINNOS (débito): {name} · {brl(value)} · {auto['account_name']}. Para desfazer, toque em Desfazer no Início."
            await run_in_threadpool(tokens.audit, uid, {"action": "registro", "ok": True, "token": user["token"], "mensagem": mensagem, "transaction_id": auto["id"], "automatico": True})
            if push_on:
                await run_in_threadpool(pending.alert, uid, "Registrado automaticamente: " + name, f"Débito em {auto['account_name']}. Toque para conferir ou desfazer.", "/")
            return answer(201, True, mensagem, id=auto["id"], repetido=False, automatico=True, **extra)
        if push_on:
            await run_in_threadpool(pending.alert, uid, "Compra pendente: " + name, origin + ". Toque para registrar ou excluir.", "/")
    mensagem = ("Já estava pendente: " if not created else "Pendente no FINNOS: ") + f"{name} · {brl(value)} · {origin}"
    await run_in_threadpool(tokens.audit, uid, {"action": "pendente", "ok": True, "token": user["token"], "mensagem": mensagem, "pending_id": saved["id"], "repetido": not created})
    return answer(201 if created else 200, True, mensagem, id=saved["id"], repetido=not created, automatico=False, **extra)
