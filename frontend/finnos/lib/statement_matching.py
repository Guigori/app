"""Statement conferência: match bank lines to an account's registered movements.

Pure functions, no I/O. Approved levels (plano v1.1):

* ``strong``   – bank id already linked, or exact cents + date within 3 days +
                 only one candidate (and a similar name when not the same day);
* ``probable`` – exact cents and close date, but another candidate exists or
                 the name does not look alike → the person confirms or separates;
* ``value_diff`` – same name and close date, different value (≤ 10 %) → the
                 person uses the bank value or keeps the FINNOS one;
* ``only_statement`` – nothing registered for it.

Registered movements left unmatched are ``only_finnos``; two registered
movements that strongly fit one line are reported as ``repeated``. Nothing
here changes data: every change comes from a person's decision.
"""
from __future__ import annotations

import hashlib
import re
import unicodedata
from datetime import date

DATE_TOLERANCE_DAYS = 3
VALUE_DIFF_RATIO = 0.10
VALUE_DIFF_SAME_NAME = 0.25  # e.g. a subscription that went up
GENERIC = {
    "compra", "pagamento", "pix", "debito", "credito", "transferencia", "enviado", "enviada", "recebido",
    "recebida", "cartao", "parcela", "boleto", "ted", "doc", "com", "para", "de", "do", "da", "no", "na",
    "pagto", "pag", "transf", "conta",
}


def _plain(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", (text or "").casefold())
    return " ".join("".join(c for c in decomposed if not unicodedata.combining(c)).split())


def _tokens(text: str) -> set[str]:
    words = re.sub(r"[^a-z0-9 ]+", " ", _plain(text)).split()
    return {w for w in words if len(w) >= 3 and w not in GENERIC and not w.isdigit()}


def name_similarity(a: str, b: str) -> float:
    if _plain(a) and _plain(a) == _plain(b):
        return 1.0
    x, y = _tokens(a), _tokens(b)
    if not x or not y:
        return 0.0
    common = sum(1 for t in x if any(u == t or (len(t) >= 4 and (u.startswith(t) or t.startswith(u))) for u in y))
    return common / min(len(x), len(y))


def origin_key(uid: str, account_id: str, line: dict) -> str:
    """Same bank line exported again (other file name or period) → same key."""
    raw = "|".join([uid, account_id, line["date"], str(line["cents"]), line["direction"],
                    re.sub(r"\d{4,}", "#", _plain(line["description"]))])
    return hashlib.sha256(raw.encode()).hexdigest()


def _days(a: str, b: str) -> int:
    return abs(date.fromisoformat(a).toordinal() - date.fromisoformat(b).toordinal())


def tx_effect(tx: dict, account_id: str) -> tuple[str, int] | None:
    """(direction, cents) of a registered movement as seen by this account."""
    from finnos.lib.money import cents

    if tx.get("status") != "pago":
        return None
    value = cents(tx["value"])
    kind = tx.get("type")
    if kind == "transferencia":
        if tx.get("account_id") == account_id:
            return "out", value
        if tx.get("to_account_id") == account_id:
            return "in", value
        return None
    if tx.get("account_id") != account_id or tx.get("card_id"):
        return None  # card purchases hit the invoice, not the account
    return ("in" if kind == "receita" else "out"), value


def match_lines(lines: list[dict], txs: list[dict], account_id: str, linked: dict[str, str] | None = None) -> dict:
    """Return per-line results and the registered movements left over.

    ``lines``: {index, date, description, cents, direction in/out, fitid?}.
    ``linked``: fitid/origin key → tx id from earlier conferências.
    """
    linked = linked or {}
    movements = {}
    for tx in txs:
        effect = tx_effect(tx, account_id)
        if effect:
            movements[tx["id"]] = (tx, *effect)

    results: dict[int, dict] = {}
    used: set[str] = set()
    # 1) Ids already linked by an earlier, concluded decision.
    for line in lines:
        for key in (line.get("fitid"), line.get("origin_key")):
            tx_id = linked.get(key) if key else None
            if tx_id and tx_id in movements and tx_id not in used:
                results[line["index"]] = {"level": "strong", "tx_id": tx_id, "reasons": ["já conferido antes"]}
                used.add(tx_id)
                break

    # 2) Exact cents, close date, same direction.
    pairs = []
    for line in lines:
        if line["index"] in results:
            continue
        for tx_id, (tx, direction, value) in movements.items():
            if tx_id in used or direction != line["direction"]:
                continue
            days = _days(line["date"], tx["date"])
            if days > DATE_TOLERANCE_DAYS:
                continue
            similarity = name_similarity(line["description"], tx.get("name", ""))
            if value == line["cents"]:
                score = 0.6 + (0.25 if days == 0 else 0.15 if days == 1 else 0.05) + 0.15 * similarity
                pairs.append((score, line["index"], tx_id, "exact", days, similarity))
            elif similarity >= 0.5 and abs(value - line["cents"]) <= (
                    VALUE_DIFF_SAME_NAME if similarity >= 0.99 else VALUE_DIFF_RATIO) * max(line["cents"], 1):
                pairs.append((0.4 + 0.1 * similarity, line["index"], tx_id, "value_diff", days, similarity))
    candidates: dict[int, list] = {}
    for pair in pairs:
        candidates.setdefault(pair[1], []).append(pair)

    for score, index, tx_id, kind, days, similarity in sorted(pairs, key=lambda p: -p[0]):
        if index in results or tx_id in used:
            continue
        exact_options = [p for p in candidates[index] if p[3] == "exact" and p[2] not in used]
        reasons = ["mesmo valor" if kind == "exact" else "valor diferente",
                   "mesma data" if days == 0 else f"{days} dia(s) de diferença"]
        if similarity >= 0.5:
            reasons.append("nome parecido")
        if kind == "value_diff":
            results[index] = {"level": "value_diff", "tx_id": tx_id, "reasons": reasons}
        elif len(exact_options) == 1 and (days == 0 or similarity >= 0.5):
            # One possibility, and either the same day or a name that looks alike.
            competing = [p for p in pairs if p[2] == tx_id and p[1] != index and p[3] == "exact" and p[1] not in results]
            level = "probable" if competing else "strong"
            if competing:
                reasons.append("outra linha do extrato também serve")
            results[index] = {"level": level, "tx_id": tx_id, "reasons": reasons}
        else:
            if len(exact_options) > 1:
                reasons.append(f"{len(exact_options)} lançamentos possíveis")
            results[index] = {"level": "probable", "tx_id": tx_id, "reasons": reasons}
        used.add(tx_id)

    for line in lines:
        results.setdefault(line["index"], {"level": "only_statement", "tx_id": None, "reasons": []})

    # Repeated: an unused registered movement that would have been an exact,
    # same-name match for a line already matched → probably registered twice.
    repeated = {}
    for tx_id, (tx, direction, value) in movements.items():
        if tx_id in used:
            continue
        for line in lines:
            result = results[line["index"]]
            if (result["level"] in ("strong", "probable") and line["direction"] == direction and line["cents"] == value
                    and _days(line["date"], tx["date"]) <= DATE_TOLERANCE_DAYS
                    and name_similarity(line["description"], tx.get("name", "")) >= 0.5):
                repeated[tx_id] = result["tx_id"]
                break
    only_finnos = [tx_id for tx_id in movements if tx_id not in used]
    return {"lines": results, "only_finnos": only_finnos, "repeated": repeated}
