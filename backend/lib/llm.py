"""Provider-agnostic LLM call using the END USER's own API key.

FINNOS ships no bundled LLM key: every request is authenticated with the key the
signed-in user registered. Models are allowlisted server-side — the client never
supplies a URL or an arbitrary model id.
"""

from __future__ import annotations

import logging

import httpx

logger = logging.getLogger(__name__)

PROVIDERS: dict[str, dict] = {
    "openai": {
        "label": "ChatGPT (OpenAI)",
        "default_model": "gpt-5.6-terra",
        "models": ["gpt-5.6-terra", "gpt-5.2", "gpt-5.1-mini"],
        "console_url": "https://platform.openai.com/api-keys",
    },
    "anthropic": {
        "label": "Claude (Anthropic)",
        "default_model": "claude-sonnet-5",
        "models": ["claude-sonnet-5", "claude-opus-5.5", "claude-haiku-4.5"],
        "console_url": "https://console.anthropic.com/settings/keys",
    },
    "gemini": {
        "label": "Gemini (Google)",
        "default_model": "gemini-3.8-flash",
        "models": ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-3.1-pro-preview"],
        "console_url": "https://aistudio.google.com/apikey",
    },
}

ERROR_MESSAGES = {
    "invalid_key": "Chave inválida ou sem autorização para este provedor. Confira a chave e tente novamente.",
    "rate_limited": "O provedor limitou as requisições por agora. Tente novamente em instantes.",
    "quota_exhausted": "A cota ou os créditos desta chave acabaram. Verifique o faturamento no painel do provedor.",
    "model_unavailable": "Sua chave não tem acesso a este modelo. Escolha outro modelo nas configurações.",
    "provider_error": "O provedor recusou a solicitação. Tente novamente em instantes.",
    "timeout": "O provedor demorou demais para responder. Tente novamente.",
}


class ProviderError(Exception):
    def __init__(self, status: int, code: str):
        super().__init__(code)
        self.status = status
        self.code = code

    @property
    def message(self) -> str:
        return ERROR_MESSAGES.get(self.code, ERROR_MESSAGES["provider_error"])


def resolve_model(provider: str, model: str | None) -> str:
    meta = PROVIDERS[provider]
    if model and model in meta["models"]:
        return model
    return meta["default_model"]


def _classify(status: int, body: str) -> ProviderError:
    s = body.lower()
    if status == 401 or (status == 403 and any(x in s for x in ("invalid", "unauthorized", "authentication"))):
        return ProviderError(401, "invalid_key")
    if status == 429:
        quota = any(x in s for x in ("quota", "insufficient_quota", "billing", "credit", "exhaust"))
        return ProviderError(429, "quota_exhausted" if quota else "rate_limited")
    if status == 404 and "model" in s:
        return ProviderError(400, "model_unavailable")
    return ProviderError(502, "provider_error")


async def call_llm(*, provider: str, user_key: str, model: str, system_prompt: str, question: str, history: list[dict] | None = None) -> str:
    history = (history or [])[-12:]
    timeout = httpx.Timeout(45.0, connect=10.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        if provider == "openai":
            url = "https://api.openai.com/v1/chat/completions"
            headers = {"Authorization": f"Bearer {user_key}"}
            body = {
                "model": model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    *history,
                    {"role": "user", "content": question},
                ],
                "max_completion_tokens": 700,
            }
        elif provider == "anthropic":
            url = "https://api.anthropic.com/v1/messages"
            headers = {"x-api-key": user_key, "anthropic-version": "2023-06-01"}
            body = {
                "model": model,
                "max_tokens": 700,
                "system": system_prompt,
                "messages": [*history, {"role": "user", "content": question}],
            }
        else:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
            headers = {"x-goog-api-key": user_key}
            body = {
                "systemInstruction": {"parts": [{"text": system_prompt}]},
                "contents": [*[{"role": "model" if m["role"] == "assistant" else "user", "parts": [{"text": m["content"]}]} for m in history], {"role": "user", "parts": [{"text": question}]}],
                "generationConfig": {"maxOutputTokens": 700},
            }

        try:
            resp = await client.post(url, headers={**headers, "Content-Type": "application/json"}, json=body)
        except httpx.TimeoutException as exc:
            raise ProviderError(504, "timeout") from exc
        except httpx.HTTPError as exc:
            logger.error("LLM transport error for %s: %s", provider, type(exc).__name__)
            raise ProviderError(502, "provider_error") from exc

        if resp.status_code >= 400:
            # Never surface the raw provider body: it can echo the key back.
            logger.error("LLM %s rejected request: status=%s", provider, resp.status_code)
            raise _classify(resp.status_code, resp.text)

        data = resp.json()

    try:
        if provider == "openai":
            return (data["choices"][0]["message"]["content"] or "").strip()
        if provider == "anthropic":
            return "".join(p.get("text", "") for p in data["content"] if p.get("type") == "text").strip()
        parts = data["candidates"][0]["content"]["parts"]
        return "".join(p.get("text", "") for p in parts).strip()
    except (KeyError, IndexError, TypeError) as exc:
        logger.error("Unexpected %s response shape", provider)
        raise ProviderError(502, "provider_error") from exc


async def verify_key(*, provider: str, user_key: str, model: str) -> None:
    """Cheapest possible real call — validates key, model access and billing at once."""
    await call_llm(
        provider=provider,
        user_key=user_key,
        model=model,
        system_prompt="Responda apenas OK.",
        question="ping",
    )
