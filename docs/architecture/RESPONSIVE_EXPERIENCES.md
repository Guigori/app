# FINNOS responsive experience architecture

Decision: one FINNOS product, one authenticated financial platform, two independent presentation shells.

## Routing
- Mobile/small screens: existing AppShell and its quick actions.
- Desktop/wide screens: DashboardShell, with Tickwell-inspired professional dashboard composition.
- Tablet portrait: FINNOS App presentation. Tablet landscape: FINNOS Dashboard presentation. Orientation changes should switch the experience automatically, without reauthentication or full-page reload.
- Smartphones use FINNOS App in both orientations. Desktop and laptop use FINNOS Dashboard regardless of window orientation; a narrow desktop window may need a compact dashboard layout rather than impersonating a phone.
- Detect tablet class with capability/viewport heuristics and orientation via matchMedia; avoid orientation alone or user-agent alone as the sole determinant. Test iPadOS desktop-class user agents and browser resizing.
- Existing financial deep links remain valid. Do not redirect a user away from an in-progress transaction or registration when viewport changes.
- Automatic desktop landing on DashboardShell should only be enabled after live data parity and smoke tests; until then /dashboard is an opt-in preview route.
- Experience selection must be centralized in a tested useExperienceMode hook; honor explicit user override and persist it per device. Do not infer device from user-agent alone. Keep form drafts and unsaved state across orientation switches, and preserve filters and route context.

## Separation boundaries
- UI and navigation: independent mobile and dashboard shells, pages and presentation components.
- Shared: verified Firebase authentication, FastAPI financial services, Firestore documents, query/cache contracts, monetary calculations and FIINT business rules.
- No duplicate finance backend, no forked transaction logic, no duplicate user accounts.
- Shared design tokens; distinct density and navigation by experience.
- Scope CSS to each shell to avoid visual regressions in App.
- Protect both experiences with RequireAuth and preserve UID isolation.

## Release gates
1. Implement live dashboard KPI data and state handling (loading/empty/error), no fabricated production figures.
2. Verify cross-platform parity of balances, period filters and transactions.
3. Validate desktop navigation, mobile App regression, tablet portrait-to-landscape and landscape-to-portrait switching, unsaved form drafts, accessibility and browser zoom.
4. Enable automatic desktop landing only after these tests pass.
5. Preview deployment and explicit approval before production merge.
