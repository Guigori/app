"""FINNOS IA — answers financial questions using the user's OWN provider key."""

from datetime import datetime, timezone
from typing import List
import os

from fastapi import APIRouter, Depends, HTTPException

from finnos.lib.ai_context import build_financial_context
from finnos.lib.crypto import decrypt_secret, encrypt_secret, mask_secret
from finnos.lib.db import db
from finnos.lib.llm import PROVIDERS, ProviderError, call_llm, resolve_model, verify_key
from finnos.models.ai import AiAnswerOut, AiAskIn, AiKeyIn, AiKeyOut, AiProviderInfo
from finnos.routers.auth import require_user

router = APIRouter(prefix="/ai", tags=["ai"])


@router.get("/providers", response_model=List[AiProviderInfo])
async def list_providers() -> list[AiProviderInfo]:
    return [
        AiProviderInfo(
            provider=key,  # type: ignore[arg-type]
            label=meta["label"],
            default_model=meta["default_model"],
            models=meta["models"],
            console_url=meta["console_url"],
        )
        for key, meta in PROVIDERS.items()
    ]


@router.get("/keys", response_model=List[AiKeyOut])
async def list_keys(user: dict = Depends(require_user)) -> list[AiKeyOut]:
    docs = await db.ai_keys.find({"user_id": user["id"]}).to_list(10)
    return [AiKeyOut(provider=d["provider"], masked=d["masked"], model=d["model"]) for d in docs]


@router.put("/keys", response_model=AiKeyOut)
async def save_key(payload: AiKeyIn, user: dict = Depends(require_user)) -> AiKeyOut:
    from finnos.lib.crypto import configured
    if not configured(): raise HTTPException(503, "Criptografia de chaves não configurada neste ambiente.")
    if os.getenv("FINNOS_AI_PAID_CALLS_ENABLED") != "1":
        raise HTTPException(503, "Chamadas pagas de IA aguardam autorização neste ambiente.")
    raw = payload.key.get_secret_value().strip()
    model = resolve_model(payload.provider, payload.model)
    try:
        await verify_key(provider=payload.provider, user_key=raw, model=model)
    except ProviderError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.message) from exc

    await db.ai_keys.update_one(
        {"user_id": user["id"], "provider": payload.provider},
        {
            "$set": {
                "ciphertext": encrypt_secret(raw),
                "masked": mask_secret(raw),
                "model": model,
                "updated_at": datetime.now(timezone.utc),
            }
        },
        upsert=True,
    )
    return AiKeyOut(provider=payload.provider, masked=mask_secret(raw), model=model)


@router.delete("/keys/{provider}", status_code=204)
async def delete_key(provider: str, user: dict = Depends(require_user)) -> None:
    if provider not in PROVIDERS:
        raise HTTPException(status_code=404, detail="Provedor desconhecido.")
    result = await db.ai_keys.delete_one({"user_id": user["id"], "provider": provider})
    if not result.deleted_count:
        raise HTTPException(status_code=404, detail="Nenhuma chave cadastrada para este provedor.")


@router.post("/ask", response_model=AiAnswerOut)
async def ask(payload: AiAskIn, user: dict = Depends(require_user)) -> AiAnswerOut:
    if os.getenv("FINNOS_AI_PAID_CALLS_ENABLED") != "1":
        raise HTTPException(503, "Chamadas pagas de IA aguardam autorização neste ambiente.")
    doc = await db.ai_keys.find_one({"user_id": user["id"], "provider": payload.provider})
    if not doc:
        raise HTTPException(
            status_code=400,
            detail="Cadastre sua chave deste provedor em Configurações para usar a IA.",
        )
    try:
        user_key = decrypt_secret(doc["ciphertext"])
    except ValueError as exc:
        raise HTTPException(
            status_code=400, detail="Não foi possível ler a chave salva. Cadastre-a novamente."
        ) from exc

    model = resolve_model(payload.provider, doc.get("model"))
    system_prompt = await build_financial_context(user["id"], payload.month)
    try:
        answer = await call_llm(
            provider=payload.provider,
            user_key=user_key,
            model=model,
            system_prompt=system_prompt,
            question=payload.question.strip(),
            history=[{"role": m.role, "content": m.content} for m in payload.history],
        )
    except ProviderError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.message) from exc

    return AiAnswerOut(answer=answer or "Não consegui gerar uma resposta agora.", provider=payload.provider, model=model)
