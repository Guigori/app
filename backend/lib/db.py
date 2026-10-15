"""Disabled MongoDB adapter — retained only as a migration audit marker.

FINNOS serves all financial data from Cloud Firestore via frontend/finnos/lib/db.py.
The original Motor adapter was decommissioned on 2026-10-15, not deleted from
Git history. This module deliberately fails before attempting any connection.

To recover an old database, work from a reviewed historical commit and an
operator-approved read-only export; do not re-enable this endpoint in FINNOS.
"""
raise RuntimeError(
    "O adaptador MongoDB legado foi desativado. "
    "Use a API Firebase/Firestore em frontend/api/index.py."
)
