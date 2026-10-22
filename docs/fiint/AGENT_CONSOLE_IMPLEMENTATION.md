# FINNOS — FIINT Agent Console (implementation specification)
Status: design and implementation plan; not yet deployed.
Reference: user-provided Tickwell screenshots, used as UX patterns, not as a source of copied proprietary assets.

## Experience
Desktop: narrow collapsible sidebar; top KPI strip; responsive agent card grid; right activity heatmap and Needs You queue. Rules: searchable rule list left; WHEN / IF / THEN / LIMIT visual builder center; dry-run drawer right. Sticky footer for save/activate. Mobile: stacked KPI cards, accessible tabs, full-height bottom sheet for simulation, 44px touch targets, safe-area padding. Respect existing FINNOS navigation, branding, light/dark theme, contrast, reduced-motion, and screen-reader labels.

## Modules
1. Agent console: reconciliation, categorization, recurring charges, budget watcher, subscriptions, insights. Each shows last run, status, count, proposed/approved actions, errors and detail.
2. Rule builder: typed trigger, nested AND/OR predicates, action, monetary threshold, approval policy, active/paused/draft state. Explain each rule in natural language.
3. Dry-run: immutable historical snapshot; matched transactions, predicted actions, rejected/ambiguous matches and reason codes. NEVER persist effects during dry-run.
4. Review queue: explicit approve/reject, rationale, transaction references, pagination, idempotency and timestamps.
5. Audit: immutable event log, rule versions, rollback via new version, actor and outcome; no sensitive data in telemetry.
6. Insights: activity heatmap and execution KPIs derived from real records, never fabricated sample figures in production.
7. Finn: natural-language draft suggestions with deterministic validation; AI never directly executes financial mutations.

## Architecture
Firestore per UID: users/{uid}/fiint_rules/{ruleId}; fiint_rule_versions/{versionId}; fiint_runs/{runId}; fiint_proposals/{proposalId}; fiint_audit/{eventId}. FastAPI authenticated endpoints under /api/fiint/*; derive UID exclusively from verified Firebase session; enforce origin checks, ownership, authorization and limits. Store money as integer cents; deterministic IDs, server timestamps, rule-engine version, input snapshot hash and idempotency key. Run evaluator server-side; reuse FIINT contracts when present. Separate rule evaluation from mutation, require review for balance-affecting actions; do not implement transfers or payment initiation. Offline: cache read-only views, queue only safe drafts, reconcile by version on reconnect.

## Build sequence and acceptance
A. Audit existing FIINT/Radar/finance modules and route conventions.
B. Build typed rule schema and deterministic evaluator; tests for boundaries, AND/OR, timezone, duplicate runs and ownership.
C. Add dry-run API and approval workflow with transactional writes and audit events; prove dry-run zero writes.
D. Add desktop/mobile console and visual builder with accessible keyboard navigation.
E. Integrate Finn suggestions and Radar notifications with explicit user consent.
F. Run typecheck, unit/integration tests, security regression and production build. Deploy to preview first; do not merge to main until verified.

## Non-goals
No direct bank transfers, silent transaction modification, copied Tickwell branding or proprietary code, and no production activation by default.
