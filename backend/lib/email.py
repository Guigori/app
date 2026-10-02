"""Transactional email via Emergent's managed integration.

Bodies come from the server-side templates in this module only — no route ever
accepts a recipient, subject or HTML from the caller.
"""

from __future__ import annotations

import ipaddress
import logging
import os
import re
from html import escape
from html.parser import HTMLParser
from urllib.parse import urlparse

import httpx
from dotenv import load_dotenv
from fastapi import HTTPException

load_dotenv()
logger = logging.getLogger(__name__)

# Hardcoded on purpose: a constant survives deployment, an injected env var would not.
EMAIL_BASE_URL = "https://integrations.emergentagent.com"
EMAIL_KEY = os.environ.get("EMERGENT_EMAIL_KEY", "")
EMAIL_FROM_NAME = os.environ.get("EMAIL_FROM_NAME", "FINNOS")
EMAIL_REPLY_TO = os.environ.get("EMAIL_REPLY_TO")

_SHORTENERS = ("bit.ly", "tinyurl.com", "t.co", "is.gd", "cutt.ly", "goo.gl", "rebrand.ly")
_CRED_ASK = (
    "reply with your password", "reply with the code", "send your password", "cvv",
    "send us your password", "enter your password below", "confirm your card number",
    "your full card number", "seed phrase", "recovery phrase", "verify your card",
    "social security number", "confirm your bank details",
)
_HOSTISH = re.compile(r"\b(?:https?://)?((?:[a-z0-9-]+\.)+[a-z]{2,})", re.I)


def _host_ok(host: str) -> bool:
    if not host or "xn--" in host:
        return False
    try:
        ipaddress.ip_address(host)
        return False
    except ValueError:
        pass
    return not any(host == s or host.endswith("." + s) for s in _SHORTENERS)


def _same_site(shown: str, real: str) -> bool:
    return shown == real or real.endswith("." + shown) or shown.endswith("." + real)


class _EmailScan(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags, self.urls, self.anchors = set(), [], []
        self._href, self._text = None, []

    def handle_starttag(self, tag, attrs):
        self.tags.add(tag.lower())
        self.urls += [v for k, v in attrs if k.lower() in ("href", "src") and v]
        if tag.lower() == "a":
            self._href = dict((k.lower(), v) for k, v in attrs).get("href")
            self._text = []

    def handle_data(self, data):
        if self._href is not None:
            self._text.append(data)

    def handle_endtag(self, tag):
        if tag.lower() == "a" and self._href is not None:
            self.anchors.append((self._href, "".join(self._text)))
            self._href, self._text = None, []


def _assert_safe_email(subject: str, html: str) -> None:
    """Structural gate against credential-harvesting and unsafe links. Never weaken."""
    scan = _EmailScan()
    scan.feed(html)
    if scan.tags & {"form", "input", "textarea", "select"}:
        raise ValueError("No forms or input fields in email (G2)")
    body = f"{subject}\n{html}".lower()
    for p in _CRED_ASK:
        if p in body:
            raise ValueError(f"Email asks the recipient for credentials: {p!r} (G2)")
    for url in scan.urls:
        low = url.strip().lower()
        if low.startswith(("mailto:", "tel:", "cid:", "#")):
            continue
        if not low.startswith("https://"):
            raise ValueError(f"Email links/assets must be absolute https: {url!r} (G3)")
        host = urlparse(low).hostname or ""
        if not _host_ok(host) or urlparse(low).username is not None:
            raise ValueError(f"Shortened, numeric-host or credential-bearing URL: {url!r} (G3)")
    for href, text in scan.anchors:
        real = urlparse(href.strip().lower()).hostname or ""
        if not real:
            continue
        for m in _HOSTISH.finditer(text):
            if not _same_site(m.group(1).lower(), real):
                raise ValueError(f"Anchor text {m.group(1)!r} != real link host {real!r} (G3)")


async def send_email(*, to: str, subject: str, html: str) -> str | None:
    _assert_safe_email(subject, html)
    payload: dict = {"to": [to], "subject": subject, "html": html, "from_name": EMAIL_FROM_NAME}
    if EMAIL_REPLY_TO:
        payload["contact_email"] = EMAIL_REPLY_TO
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{EMAIL_BASE_URL}/api/v1/email/send",
                headers={"X-Email-Key": EMAIL_KEY},
                json=payload,
            )
        resp.raise_for_status()
        return resp.json().get("id")
    except httpx.HTTPStatusError as e:
        logger.error("Email send failed: %s %s", e.response.status_code, e.response.text)
        # An undeliverable address is the sender's mistake, not an outage: say so precisely
        # so the user can fix the typo instead of retrying forever.
        if "undeliverable_recipient" in e.response.text:
            raise HTTPException(
                status_code=400,
                detail="Não conseguimos entregar e-mails neste endereço. Confira se está correto e use um e-mail real.",
            )
        raise HTTPException(status_code=502, detail="Não foi possível enviar o e-mail agora. Tente novamente em instantes.")
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        logger.error("Email send error: %s", e)
        raise HTTPException(status_code=502, detail="Não foi possível enviar o e-mail agora.")


def verification_code_html(*, name: str, code: str) -> str:
    """Server-side template for the signup confirmation code."""
    safe_name = escape(name)
    safe_code = escape(code)
    return (
        '<table role="presentation" width="100%" style="background:#F5F3FF;padding:32px 0">'
        '<tr><td align="center">'
        '<table role="presentation" width="100%" style="max-width:480px;background:#FFFFFF;'
        'border-radius:20px;padding:32px;font-family:Arial,Helvetica,sans-serif;color:#10142B">'
        '<tr><td>'
        '<p style="margin:0;font-size:22px;font-weight:bold;letter-spacing:-0.5px">FINNOS</p>'
        f'<p style="margin:24px 0 0;font-size:16px">Olá, {safe_name}!</p>'
        '<p style="margin:12px 0 0;font-size:15px;line-height:22px;color:#4A4A63">'
        'Use o código abaixo para confirmar seu e-mail e ativar sua conta no FINNOS:</p>'
        f'<p style="margin:24px 0;padding:18px;background:#F5F3FF;border-radius:14px;'
        f'text-align:center;font-size:34px;font-weight:bold;letter-spacing:10px;color:#5B3FE4">'
        f'{safe_code}</p>'
        '<p style="margin:0;font-size:14px;color:#4A4A63">O código expira em 15 minutos.</p>'
        '<p style="margin:16px 0 0;font-size:13px;color:#6B6B85">Se você não criou uma conta no '
        'FINNOS, basta ignorar esta mensagem.</p>'
        '<p style="margin:24px 0 0;font-size:12px;color:#8A8AA3;border-top:1px solid #EDE9FE;'
        'padding-top:16px">Enviado por FINNOS. Nunca pedimos sua senha ou dados de cartão '
        'por e-mail.</p>'
        '</td></tr></table></td></tr></table>'
    )


def due_reminder_html(*, name: str, when: str, date_label: str, items: list[tuple[str, float]]) -> str:
    """Server-side template for the "conta chegando no vencimento" reminder."""
    safe_name = escape(name)
    rows = "".join(
        '<tr><td style="padding:8px 0;font-size:15px;color:#10142B">'
        f"{escape(item_name)}</td>"
        '<td style="padding:8px 0;font-size:15px;text-align:right;color:#10142B">'
        + (f"R$ {value:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".") if value else "—")
        + "</td></tr>"
        for item_name, value in items
    )
    return (
        '<table role="presentation" width="100%" style="background:#F5F3FF;padding:32px 0">'
        '<tr><td align="center">'
        '<table role="presentation" width="100%" style="max-width:480px;background:#FFFFFF;'
        'border-radius:20px;padding:32px;font-family:Arial,Helvetica,sans-serif;color:#10142B">'
        '<tr><td>'
        '<p style="margin:0;font-size:22px;font-weight:bold;letter-spacing:-0.5px">FINNOS</p>'
        f'<p style="margin:24px 0 0;font-size:16px">Olá, {safe_name}!</p>'
        '<p style="margin:12px 0 0;font-size:15px;line-height:22px;color:#4A4A63">'
        f"Isto vence {escape(when)} ({escape(date_label)}):</p>"
        f'<table role="presentation" width="100%" style="margin:16px 0;border-top:1px solid #EDE9FE">{rows}</table>'
        '<p style="margin:0;font-size:14px;color:#4A4A63">Abra o FINNOS para marcar como pago '
        'ou reagendar.</p>'
        '<p style="margin:24px 0 0;font-size:12px;color:#8A8AA3;border-top:1px solid #EDE9FE;'
        'padding-top:16px">Você pode desligar estes avisos em Configurações. Nunca pedimos sua '
        'senha ou dados de cartão por e-mail.</p>'
        '</td></tr></table></td></tr></table>'
    )
