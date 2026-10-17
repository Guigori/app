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
    goals,
    radar,
    ai,
    ai_feedback,
    simulation,
    finance_validation,
    onboarding,
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
        budgets,
        goals,
        radar,
        ai,
        ai_feedback,
        simulation,
        finance_validation,
        onboarding,
    ]:
        router.include_router(module.router)
    app.include_router(router)

    # Mutation CSRF applies to finance routes; cookie auth is never sufficient on its own.
    @app.middleware("http")
    async def finance_origin(request, call_next):
        if request.method in {"POST", "PUT", "PATCH", "DELETE"} and any(
            request.url.path.startswith("/api/" + x)
            for x in ["accounts", "institutions", "categories", "transactions", "notifications", "push", "subscriptions", "cards", "budgets", "goals", "radar", "ai", "simulate", "onboarding"]
        ):
            from fastapi import HTTPException
            from fastapi.responses import JSONResponse

            try:
                same_origin(request)
            except HTTPException as exc:
                return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)
        return await call_next(request)
