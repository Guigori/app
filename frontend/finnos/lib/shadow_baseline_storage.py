"""ARQ-02: explicit, emulator-only atomic persistence of a certified shadow.

This NEVER runs in financial routers or production. A certified baseline
cannot replace the canonical ledger. Store metadata and all month docs at one
finance revision; delete stale months when rebuilding after missing revisions.
"""
from fastapi import HTTPException
from firebase_admin import firestore
from starlette.concurrency import run_in_threadpool

from finnos.lib import db as store
from finnos.lib.shadow_certification import _allow_synthetic
from finnos.lib.monthly_aggregate_shadow import stage_shadow_snapshot, SCHEMA_VERSION


async def persist_emulator_baseline(uid: str, certificate: dict) -> dict:
    _allow_synthetic(uid)
    candidate = certificate.get("baseline") or {}
    report = certificate.get("verification") or {}
    revision = certificate.get("finance_revision")
    if (certificate.get("uid") != uid
            or certificate.get("status") != "certified_emulator_only"
            or certificate.get("production_eligible") is not False
            or type(revision) is not int
            or candidate.get("finance_revision") != revision
            or candidate.get("schema_version") != SCHEMA_VERSION
            or not isinstance(candidate.get("months"), dict)
            or len(candidate["months"]) > 200):
        raise HTTPException(403, "Certificado shadow sintético inválido.")

    def write():
        db = store.client()
        parent = store.root(db, uid)
        meta_ref = parent.collection("_meta").document("finance_shadow_baseline_v1")

        @firestore.transactional
        def commit(transaction):
            meta = meta_ref.get(transaction=transaction)
            previous = meta.to_dict() or {} if meta.exists else {}
            old_months = previous.get("month_keys") or []
            if (not isinstance(old_months, list)
                    or len(old_months) > 200
                    or any(not isinstance(x, str) for x in old_months)):
                raise HTTPException(409, "Baseline anterior exige revisão manual.")
            if (previous.get("finance_revision") == revision
                    and previous.get("checksum") == candidate.get("checksum")):
                # Still read canonical revision: same checksum at a stale
                # finance revision is not an idempotent success.
                finance = parent.collection("_meta").document("finance").get(
                    transaction=transaction
                )
                live_revision = (finance.to_dict() or {}).get("revision", 0) if finance.exists else 0
                if live_revision != revision:
                    raise HTTPException(409, "Revisão do baseline foi alterada.")
                return {"status": "already_persisted_emulator_only", "finance_revision": revision}
            # stage_shadow_snapshot performs its own revision read before
            # writing; no Firestore reads are permitted after this call.
            stage_shadow_snapshot(
                transaction, parent, candidate, revision,
                approval=True, verification_report=report,
            )
            new_months = sorted(candidate["months"])
            for key in old_months:
                if key not in candidate["months"]:
                    transaction.delete(
                        parent.collection("_finance_month_shadows_v1").document(key)
                    )
            transaction.set(meta_ref, {
                "schema_version": SCHEMA_VERSION,
                "status": "shadow_only",
                "finance_revision": revision,
                "checksum": candidate["checksum"],
                "source_count": candidate["source_count"],
                "month_keys": new_months,
                "production_eligible": False,
            })
            return {"status": "persisted_emulator_only", "finance_revision": revision,
                    "months": len(new_months), "deleted_stale_months":
                    len(set(old_months) - set(new_months))}

        return commit(db.transaction(max_attempts=3))

    return await run_in_threadpool(write)
