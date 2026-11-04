"""ARQ-02: independently reconciled, read-only shadow baseline + gap recovery.

Never invoked by live financial routes. Only synthetic demo Firestore projects
may request certification. A snapshot is diagnostic; certification never grants
authority to replace Dashboard, account balances or the source ledger.
"""
import os
from fastapi import HTTPException
from starlette.concurrency import run_in_threadpool

from finnos.lib import db as store
from finnos.lib.account_balances import _revision
from finnos.lib.monthly_aggregate_shadow_reads import (
    build_shadow_candidate, check_shadow_candidate,
)
from finnos.lib.finance_shadow_replay import replay_shadow_events


def _allow_synthetic(uid: str):
    store.scoped({"user_id": uid})
    if (not uid.startswith("test-")
            or os.getenv("FINNOS_SHADOW_OUTBOX_MODE") != "emulator"
            or not os.getenv("FIRESTORE_EMULATOR_HOST")
            or not os.getenv("FIREBASE_PROJECT_ID", "").startswith("demo-")):
        raise HTTPException(403, "Certificação apenas no Firestore Emulator sintético.")


def _read_cards_and_revision(uid: str, *, expected: int | None = None):
    parent = store.root(store.client(), uid)
    before = _revision(parent)
    if expected is not None and before != expected:
        raise HTTPException(409, "Baseline inválido: revisão alterada.")
    snapshots = list(parent.collection("cards").limit(201).stream(timeout=15))
    if len(snapshots) > 200:
        raise HTTPException(413, "Quantidade de cartões não certificada.")
    cards = []
    for snap in snapshots:
        doc = snap.to_dict()
        if not isinstance(doc, dict):
            raise HTTPException(503, "Cartão inválido durante a certificação.")
        cards.append(dict(store.decode(doc), id=snap.id, user_id=uid))
    if _revision(parent) != before:
        raise HTTPException(409, "Cartões alterados durante a certificação.")
    return before, cards


async def certify_shadow_baseline(uid: str) -> dict:
    """Rebuild, second independent scan and compare with the same card set.

    Revision check before/after obtaining card docs, during both transaction
    scans, and once again at the end. All of this remains read-only.
    """
    _allow_synthetic(uid)
    revision, cards = await run_in_threadpool(_read_cards_and_revision, uid)
    candidate = await build_shadow_candidate(uid, cards, revision)
    report = await check_shadow_candidate(uid, cards, revision, candidate)
    final, _ = await run_in_threadpool(
        _read_cards_and_revision, uid, expected=revision
    )
    if (final != revision or report.get("match") is not True
            or report.get("diffs") != {}
            or report.get("candidate_checksum") != candidate["checksum"]
            or report.get("source_count") != candidate.get("source_count")
            or sorted(report.get("checked_months", []))
            != sorted(candidate["months"])):
        raise HTTPException(409, "Baseline diverge do motor financeiro oficial.")
    return {
        "uid": uid,
        "finance_revision": revision,
        "baseline": candidate,
        "verification": report,
        "status": "certified_emulator_only",
        "production_eligible": False,
    }


async def recover_shadow_gap(uid: str, seed: dict,
                             envelopes: list[dict], target_revision: int) -> dict:
    """Apply a complete replay or rebuild if an envelope is missing/stale.

    Fail-closed: rebuilding never invents a missing operation. The official
    historical rows are rescanned and independently verified at the revision
    we were asked to reach. A second write during recovery causes HTTP 409.
    """
    _allow_synthetic(uid)
    if type(target_revision) is not int or target_revision < 0:
        raise HTTPException(409, "Revisão alvo inválida.")
    current, _ = await run_in_threadpool(_read_cards_and_revision, uid)
    if current != target_revision:
        raise HTTPException(409, "Revisão alvo ficou desatualizada.")
    try:
        candidate = replay_shadow_events(
            seed, envelopes, user_id=uid, target_revision=target_revision,
        )
    except HTTPException as exc:
        if exc.status_code != 409:
            raise
        certificate = await certify_shadow_baseline(uid)
        if certificate["finance_revision"] != target_revision:
            raise HTTPException(409, "Reconstrução fora da revisão exigida.")
        return {
            "status": "reconstructed",
            "reason": "missing_or_unsafe_revision",
            "certificate": certificate,
            "production_eligible": False,
        }
    # A successful ordered replay still needs the independent full scan.
    certificate = await certify_shadow_baseline(uid)
    if candidate["checksum"] != certificate["baseline"]["checksum"]:
        raise HTTPException(409, "Replay não coincide com o histórico oficial.")
    return {
        "status": "replayed_and_verified",
        "certificate": certificate,
        "production_eligible": False,
    }
