# Firestore financial API for the authorized Preview

The existing React screens keep their `/api` contracts. This package ports the
existing resource models and routers from `backend/` into the Vercel project root,
without importing the legacy authentication, Motor, MongoDB or server lifespan.
The original backend files and production behavior remain unchanged.

Rules reused: account balance effects, paid/pending/scheduled status, transfer
exclusion from income/expense, installment month windows, category enrichment,
50/30/20 groups, date filters, calendar, cash-flow projections and subscriptions.
Money is calculated with Decimal and persisted as integer cents. Numeric JSON
fields remain compatible with the TypeScript contracts. The last installment
reconciles the rounding residual so the parcels sum to the purchase total.

Each database query must match the verified UID in the request context; records
live at `users/{uid}/{resource}/{id}`. No client-supplied identity selects a
Firestore namespace. Mutations validate Origin and referenced resources; a
per-user Firestore transaction revision serializes reference checks and deletes.
Offline snapshots and queued operations are scoped to Firebase UID. Online API
errors are shown, rather than replaced by a cached balance or demo data.

Published resources: accounts, categories, transactions, dashboard, analytics,
notifications, subscriptions, and read-only derived cards. Card invoice/payment,
budget-cycle configuration, AI and Radar endpoints are outside this integration
and are not mapped to a legacy Mongo backend. No data migration runs automatically.
Existing top-level Mongo migration documents are not assigned by email or guessed
ownership; this API reads only the verified UID's Firestore subcollections.

Unit contracts use a Firestore double, without credentials. Live validation must
use the authenticated Preview and authorized isolated Firebase test accounts.
