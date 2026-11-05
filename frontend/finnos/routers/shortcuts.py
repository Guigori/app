"""Apple Shortcuts: register a lançamento from the iPhone without opening FINNOS.

Two parts:
- /integrations/shortcut-tokens (signed-in FINNOS session): create, list and revoke
  the personal code a Shortcut carries, and see its recent activity.
- /shortcuts/* (the code as `Authorization: Bearer fns_…`): the names to choose from
  and the register itself. Answers are always {"ok", "mensagem"} so the Shortcut can
  show them, errors included.

The register goes through the same validation and storage as the app (accounts,
cards, invoices, installments), is saved once even if sent twice, and is marked
as coming from "ios_shortcut".
"""
import uuid
from datetime import datetime
from typing import Optional, Union

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from firebase_admin import auth as firebase_auth
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from finnos.lib import db as store
from finnos.lib import integration_tokens as tokens
from finnos.lib.dates import today_iso
from finnos.lib.db import active_uid, db
from finnos.models.finnos import TransactionIn
from finnos.routers import transactions as tx
from finnos.routers.auth import require_user

router = APIRouter(tags=["shortcuts"])

FORMAS = {"pix": "Pix", "debito": "Débito", "dinheiro": "Dinheiro", "vale": "Vale", "credito": "Crédito"}


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


@router.get("/shortcuts/opcoes")
async def shortcut_options(request: Request):
    try:
        user = await shortcut_user(request)
    except HTTPException as exc:
        return answer(exc.status_code, False, exc.detail)
    accounts, cards, categories = await _wallets(user["id"])
    return answer(
        200, True, "Pronto.",
        tipos=["Despesa", "Receita"],
        formas=list(FORMAS.values()),
        contas=[a["name"] for a in accounts],
        cartoes=[c["name"] for c in cards],
        # One list for "Escolher da Lista": accounts first, then cards.
        carteiras=[a["name"] for a in accounts] + [c["name"] for c in cards],
        categorias=sorted(c["name"] for c in categories),
    )


class LancamentoIn(BaseModel):
    valor: Union[str, float]
    tipo: str = "despesa"
    forma: Optional[str] = None
    carteira: Optional[str] = Field(default=None, max_length=80)
    categoria: Optional[str] = Field(default=None, max_length=60)
    parcelas: Optional[Union[int, str]] = None
    descricao: Optional[str] = Field(default=None, max_length=80)
    data: Optional[str] = Field(default=None, max_length=20)
    id: Optional[str] = Field(default=None, max_length=80)


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


def _installments(value) -> int:
    if value in (None, "", 0, "0", 1, "1"):
        return 1
    try:
        n = int(str(value).strip().lower().rstrip("x"))
    except ValueError:
        raise HTTPException(422, "Parcelas inválidas. Use um número, como 3.")
    if not 1 <= n <= 120:
        raise HTTPException(422, "Parcelas inválidas: de 1 a 120.")
    return n


async def _category_from_history(uid: str, name: str, kind: str) -> Optional[str]:
    """No category sent (Apple Pay): reuse the one used last time for the same name."""
    rows = await db.transactions.find({"user_id": uid, "name": name}).to_list(50)
    rows = [r for r in rows if r.get("type") == kind and r.get("category_id")]
    rows.sort(key=lambda r: str(r.get("date")), reverse=True)
    return rows[0]["category_id"] if rows else None


async def build(uid: str, body: LancamentoIn) -> tuple[TransactionIn, dict]:
    """Turns what the Shortcut sent into the app's own TransactionIn."""
    value = tokens.parse_amount(body.valor)
    kind = tokens.normalize(body.tipo)
    if kind not in {"despesa", "receita"}:
        raise HTTPException(422, "Tipo inválido: use Despesa ou Receita.")
    forma = tokens.normalize(body.forma or "") or None
    if forma and forma not in FORMAS:
        raise HTTPException(422, f"Forma de pagamento inválida. Opções: {', '.join(FORMAS.values())}.")
    accounts, cards, categories = await _wallets(uid)

    card = None
    if forma == "credito" or (not forma and body.carteira and kind == "despesa"):
        try:
            card = tokens.resolve(body.carteira, cards, "o cartão") if body.carteira else None
        except HTTPException:
            if forma == "credito":
                raise
        if forma == "credito" and not card:
            if len(cards) == 1:
                card = cards[0]
            else:
                raise HTTPException(422, "Escolha o cartão. Opções: " + (", ".join(c["name"] for c in cards) or "nenhum cadastrado") + ".")
    if card and kind == "receita":
        raise HTTPException(422, "Receita não pode ser no cartão de crédito.")

    if card:
        account = next((a for a in accounts if a["id"] == card.get("payment_account_id")), None)
        if not account:
            raise HTTPException(422, f"O cartão {card['name']} está sem conta de pagamento. Defina em Carteira → Cartões.")
    else:
        account = tokens.resolve(body.carteira, accounts, "a conta") if body.carteira else (accounts[0] if len(accounts) == 1 else None)
        if not account:
            raise HTTPException(422, "Escolha a conta. Opções: " + (", ".join(a["name"] for a in accounts) or "nenhuma cadastrada") + ".")

    installments = _installments(body.parcelas)
    if installments > 1 and not card:
        raise HTTPException(422, "Parcelamento só no cartão de crédito.")

    category = tokens.resolve(body.categoria, categories, "a categoria")
    name = (body.descricao or "").strip() or (category["name"] if category else ("Receita" if kind == "receita" else "Gasto"))
    category_id = category["id"] if category else await _category_from_history(uid, name, kind)
    when = _date(body.data)
    status = "agendado" if when > today_iso() else "pago"
    via = FORMAS.get(forma or "", "Crédito" if card else None)

    payload = TransactionIn(
        name=name[:80], value=value, type=kind, status=status, date=when,
        account_id=account["id"], card_id=card["id"] if card else None, category_id=category_id,
        installment=installments > 1, total_installments=installments if installments > 1 else None,
        current_installment=1 if installments > 1 else None,
        notes=f"Registrado pelo Atalhos{f' · {via}' if via else ''}",
    )
    summary = {
        "nome": name, "valor": brl(value), "carteira": card["name"] if card else account["name"],
        "categoria": next((c["name"] for c in categories if c["id"] == category_id), None),
        "parcelas": installments,
    }
    return payload, summary


@router.post("/shortcuts/lancamentos")
async def shortcut_register(request: Request, body: LancamentoIn):
    try:
        user = await shortcut_user(request)
    except HTTPException as exc:
        return answer(exc.status_code, False, exc.detail)
    uid = user["id"]
    try:
        payload, summary = await build(uid, body)
        await tx._validate(uid, payload)
        doc = tx._document(uid, payload)
        doc["operation_id"] = body.id.strip() if body.id and body.id.strip() else tokens.operation_id(uid, body.model_dump())
        doc["source"] = "ios_shortcut"
        target = str(uuid.uuid5(uuid.NAMESPACE_URL, uid + ":" + doc["operation_id"]))
        repeated = await db.transactions.find_one({"id": target, "user_id": uid}) is not None
        await db.transactions.insert_one(doc)
    except HTTPException as exc:
        await run_in_threadpool(tokens.audit, uid, {"action": "registro", "ok": False, "token": user["token"], "mensagem": str(exc.detail)})
        return answer(exc.status_code, False, str(exc.detail))

    parts = [summary["nome"], summary["valor"] + (f" em {summary['parcelas']}x" if summary["parcelas"] > 1 else ""), summary["carteira"]]
    if summary["categoria"] and summary["categoria"] != summary["nome"]:
        parts.append(summary["categoria"])
    mensagem = ("Já estava registrado: " if repeated else "Registrado no FINNOS: ") + " · ".join(parts)
    await run_in_threadpool(tokens.audit, uid, {"action": "registro", "ok": True, "token": user["token"], "mensagem": mensagem, "transaction_id": doc["id"], "repetido": repeated})
    return answer(200 if repeated else 201, True, mensagem, id=doc["id"], repetido=repeated, **summary)

