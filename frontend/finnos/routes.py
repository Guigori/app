from fastapi import APIRouter, Depends
from finnos.lib import db
from finnos.routers import (
    auth,
    accounts,
    institutions,
    categories,
    transactions,
    dashboard,
    analytics,
    notifications,
    push,
    subscriptions,
    cards,
    budgets,
    budget_months,
    goals,
    investments,
    preferences,
    radar,
    ai,
    ai_feedback,
    simulation,
    finance_validation,
    onboarding,
    backup,
    shortcuts,
    pending_captures,
    reconciliations,
)


def mount(app, firebase_app, verified_claims, same_origin):
    db.firebase_application = firebase_app
    auth.verify = verified_claims
    router = APIRouter(prefix="/api")
    for module in [
        accounts,
        institutions,
        categories,
        transactions,
        dashboard,
        analytics,
        notifications,
        push,
        subscriptions,
        cards,
        budget_months,
        budgets,
        goals,
        investments,
        preferences,
        radar,
        ai,
        ai_feedback,
        simulation,
        finance_validation,
        onboarding,
        backup,
        shortcuts,
        pending_captures,
        reconciliations,
    ]:
        router.include_router(module.router)
    app.include_router(router)

    # How many Firestore documents each request read (header + one log line): the way to measure the cost.
    from finnos.lib import read_meter
    read_meter.install()

    @app.middleware("http")
    async def count_reads(request, call_next):
        meter = read_meter.start()
        response = await call_next(request)
        if request.url.path.startswith("/api/"):
            response.headers["X-Finnos-Reads"] = str(meter.reads)
            if meter.revision is not None:
                response.headers["X-Finnos-Revision"] = str(meter.revision)
            read_meter.report(request.url.path, meter)
        return response

    # Mutation CSRF applies to finance routes; cookie auth is never sufficient on its own.
    @app.middleware("http")
    async def finance_origin(request, call_next):
        if request.method in {"POST", "PUT", "PATCH", "DELETE"} and any(
            request.url.path.startswith("/api/" + x)
            for x in ["accounts", "institutions", "categories", "transactions", "notifications", "push", "subscriptions", "cards", "budgets", "goals", "investments", "preferences", "radar", "ai", "simulate", "onboarding", "integrations", "pending-captures"]
        ):
            from fastapi import HTTPException
            from fastapi.responses import JSONResponse

            try:
                same_origin(request)
            except HTTPException as exc:
                return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)
        return await call_next(request)
