"""Which documents each finance revision changed, so a device can follow the account without downloading it all.

Every write goes through db.atomic, which raises the finance revision by one. In the same transaction it writes
`users/{uid}/_changes/{revision:012d}` = {"rev": revision, "docs": [[collection, id], ...]}. A device that holds the
copy at revision R asks for R+1..current and gets only those documents (GET /api/finance/mirror/changes). Any gap,
a log entry missing or too many revisions behind, answers "full": the device downloads the whole copy instead.
"""
from finnos.lib import db as store

LOG = "_changes"
MAX_STEPS = 60          # more revisions behind than this: the whole copy is cheaper and simpler
MAX_DOCS = 400


def ref(parent, revision: int):
    return parent.collection(LOG).document(f"{revision:012d}")


def write(transaction, parent, revision: int, docs: set) -> None:
    entries = sorted([list(item) for item in docs])[:MAX_DOCS]
    transaction.set(ref(parent, revision), {"rev": revision, "docs": entries, "truncated": len(docs) > MAX_DOCS})


def read(uid: str, since: int, current: int):
    """[(collection, id), ...] changed after `since` up to `current`, or None when the log cannot say."""
    if current < since or current - since > MAX_STEPS:
        return None
    if current == since:
        return []
    client = store.client()
    parent = store.root(client, uid)
    refs = [ref(parent, rev) for rev in range(since + 1, current + 1)]
    seen, found = set(), 0
    for snap in client.get_all(refs):
        data = snap.to_dict() if snap.exists else None
        if not data or data.get("truncated"):
            return None
        found += 1
        seen.update(tuple(item) for item in data.get("docs") or [])
    if found != len(refs) or len(seen) > MAX_DOCS:
        return None
    return sorted(seen)
