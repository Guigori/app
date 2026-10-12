"""Explicitly authorized, owner-only Preview fixtures and real isolation checks.

Creates three passwordless Firebase test identities only after the owner clicks
Prepare. Tokens never enter the report, Firestore audit or logs. Financial writes
and checks go through the real HTTP routes with real verified Firebase ID tokens.
"""

import os
from decimal import Decimal, ROUND_HALF_UP
from uuid import uuid4
import httpx
from firebase_admin import auth, firestore
from fastapi import Depends, HTTPException, Request
from fastapi.testclient import TestClient
from pydantic import BaseModel, ConfigDict
from finnos.lib.dates import today_iso


class TestLogin(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: str


def mount_validation(app, firebase_app, verified_claims, same_origin):
    def owner(request):
        expected = os.getenv("FINNOS_PREVIEW_TEST_OWNER_UID", "")
        if os.getenv("VERCEL_ENV") != "preview" or not expected:
            raise HTTPException(404, "Not found")
        cookie = request.cookies.get("finnos_firebase_session")
        if not cookie:
            raise HTTPException(401, "Não autenticado.")
        claims = verified_claims(cookie, session=True)
        if claims.get("uid") != expected:
            raise HTTPException(403, "Validação restrita ao responsável autorizado.")
        return claims

    def audit_ref(claims):
        db = firestore.client(app=firebase_app())
        if db.project != "finnos-app":
            raise HTTPException(503, "Projeto inesperado.")
        return (
            db.collection("users")
            .document(claims["uid"])
            .collection("_validation")
            .document("finance")
        )

    @app.get("/api/validation/finance")
    def report(request: Request):
        claims = owner(request)
        saved = audit_ref(claims).get().to_dict()
        return saved or {"status": "not_prepared", "users": [], "checks": []}

    @app.post("/api/validation/finance", dependencies=[Depends(same_origin)])
    def prepare(request: Request):
        claims = owner(request)
        ref = audit_ref(claims)
        saved = ref.get().to_dict()
        if saved and saved.get("status") == "passed":
            return saved
        if saved and saved.get("status") == "running":
            raise HTTPException(409, "Validação já está em andamento.")
        key = os.getenv("VITE_FIREBASE_API_KEY")
        if not key:
            raise HTTPException(503, "Configuração Web ausente para a validação real.")
        run_id = str(uuid4())
        result = {"run_id": run_id, "status": "running", "users": [], "checks": []}
        ref.set(result)
        tokens = {}
        host = request.headers["host"]
        try:
            for label in ["A", "B", "C"]:
                uid = "finnos-preview-" + run_id + "-" + label.lower()
                email = (
                    "teste-" + label.lower() + "-" + run_id + "@finnos-preview.invalid"
                )
                user = auth.create_user(
                    uid=uid,
                    email=email,
                    email_verified=True,
                    display_name="Teste-" + label + " FINNOS",
                    app=firebase_app(),
                )
                custom = auth.create_custom_token(
                    user.uid, {"finnos_preview_test": run_id}, app=firebase_app()
                ).decode()
                response = httpx.post(
                    "https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken",
                    params={"key": key},
                    json={"token": custom, "returnSecureToken": True},
                    timeout=20,
                )
                if response.status_code != 200:
                    raise RuntimeError("Firebase test sign-in failed")
                tokens[label] = response.json()["idToken"]
                result["users"].append(
                    {"label": label, "uid": uid, "name": user.display_name}
                )
                ref.set(result)

            with TestClient(app, base_url="https://" + host) as client:

                def call(label, method, path, payload=None, expected=200):
                    response = client.request(
                        method,
                        "/api" + path,
                        json=payload,
                        headers={
                            "Origin": "https://" + host,
                            "Authorization": "Bearer " + tokens[label],
                        },
                    )
                    if response.status_code != expected:
                        raise RuntimeError(
                            method
                            + " "
                            + path
                            + " returned "
                            + str(response.status_code)
                        )
                    return response.json() if response.status_code != 204 else None

                date = today_iso()
                for factor, user in enumerate(result["users"], 1):
                    label = user["label"]
                    main = call(
                        label,
                        "POST",
                        "/accounts",
                        {
                            "name": "Teste " + label + " · Banco",
                            "initial_balance": 1000 * factor,
                        },
                        201,
                    )
                    savings = call(
                        label,
                        "POST",
                        "/accounts",
                        {
                            "name": "Teste " + label + " · Reserva",
                            "initial_balance": 100 * factor,
                        },
                        201,
                    )
                    category = call(
                        label,
                        "POST",
                        "/categories",
                        {
                            "name": "Teste " + label + " · Mercado",
                            "group": "necessidades",
                        },
                        201,
                    )
                    payload = {
                        "name": "Salário teste " + label,
                        "value": 3000 * factor,
                        "type": "receita",
                        "status": "pago",
                        "date": date,
                        "account_id": main["id"],
                    }
                    income = call(label, "POST", "/transactions", payload, 201)
                    call(
                        label,
                        "POST",
                        "/transactions",
                        dict(
                            payload,
                            name="Mercado teste " + label,
                            type="despesa",
                            value=float(Decimal("123.45") * factor),
                            category_id=category["id"],
                        ),
                        201,
                    )
                    call(
                        label,
                        "POST",
                        "/transactions",
                        dict(
                            payload,
                            name="Parcelamento teste " + label,
                            type="despesa",
                            value=100 * factor,
                            installment=True,
                            total_installments=3,
                            category_id=category["id"],
                        ),
                        201,
                    )
                    call(
                        label,
                        "POST",
                        "/transactions",
                        dict(
                            payload,
                            name="Transferência teste " + label,
                            type="transferencia",
                            value=75 * factor,
                            to_account_id=savings["id"],
                        ),
                        201,
                    )
                    call(
                        label,
                        "POST",
                        "/transactions",
                        dict(
                            payload,
                            name="Agendamento teste " + label,
                            status="agendado",
                            value=500 * factor,
                        ),
                        201,
                    )
                    parcel = (Decimal(100 * factor) / 3).quantize(
                        Decimal(".01"), rounding=ROUND_HALF_UP
                    )
                    expense = Decimal("123.45") * factor + parcel
                    expected_balance = Decimal(4100 * factor) - expense
                    dashboard = call(label, "GET", "/dashboard?month=" + date[:7])
                    if (
                        Decimal(str(dashboard["total_balance"])) != expected_balance
                        or Decimal(str(dashboard["expense"])) != expense
                        or dashboard["income"] != 3000 * factor
                    ):
                        raise RuntimeError("Dashboard arithmetic mismatch")
                    accounts = call(label, "GET", "/accounts")
                    transactions = call(label, "GET", "/transactions")
                    if len(accounts) != 2 or len(transactions) != 5:
                        raise RuntimeError("Fixture ownership listing mismatch")
                    stored = (
                        firestore.client(app=firebase_app())
                        .collection("users")
                        .document(user["uid"])
                        .collection("transactions")
                        .stream()
                    )
                    if not all(
                        isinstance(snapshot.to_dict().get("value_cents"), int)
                        for snapshot in stored
                    ):
                        raise RuntimeError("Canonical cents storage mismatch")
                    temporary = call(
                        label,
                        "POST",
                        "/transactions",
                        dict(
                            payload,
                            name="Temporária de validação",
                            value=0.01,
                        ),
                        201,
                    )
                    call(
                        label,
                        "PUT",
                        "/transactions/" + temporary["id"],
                        dict(payload, name="Temporária atualizada", value=0.02),
                    )
                    call(
                        label,
                        "DELETE",
                        "/transactions/" + temporary["id"],
                        expected=204,
                    )
                    user.update(
                        {
                            "account_id": main["id"],
                            "transaction_id": income["id"],
                            "income": 3000 * factor,
                            "expense": float(expense),
                            "total_balance": float(expected_balance),
                        }
                    )
                    result["checks"].append(
                        {
                            "user": label,
                            "check": "create/read/dashboard/centavos",
                            "status": "passed",
                        }
                    )
                    ref.set(result)
                for current in result["users"]:
                    label = current["label"]
                    for other in result["users"]:
                        if other["label"] == label:
                            continue
                        account_path = "/accounts/" + other["account_id"]
                        transaction_path = "/transactions/" + other["transaction_id"]
                        for path in [account_path, transaction_path]:
                            call(label, "GET", path, expected=404)
                            call(label, "DELETE", path, expected=404)
                        call(
                            label,
                            "PUT",
                            account_path,
                            {"name": "Tentativa de acesso cruzado"},
                            404,
                        )
                        payload = {
                            "name": "Tentativa de acesso cruzado",
                            "value": 1,
                            "type": "receita",
                            "date": date,
                            "account_id": current["account_id"],
                        }
                        call(label, "PUT", transaction_path, payload, 404)
                        call(
                            label,
                            "POST",
                            "/transactions",
                            dict(payload, account_id=other["account_id"]),
                            400,
                        )
                        result["checks"].append(
                            {
                                "user": label,
                                "target": other["label"],
                                "check": "GET/PUT/DELETE/referencia estrangeira",
                                "status": "passed",
                            }
                        )
                for user in result["users"]:
                    if len(call(user["label"], "GET", "/transactions")) != 5:
                        raise RuntimeError("Isolation check altered another user")
                    current = call(user["label"], "GET", "/dashboard?month=" + date[:7])
                    if Decimal(str(current["total_balance"])) != Decimal(
                        str(user["total_balance"])
                    ):
                        raise RuntimeError(
                            "Cross-user check altered a financial balance"
                        )
            result["status"] = "passed"
            ref.set(result)
            return result
        except Exception:
            result["status"] = "failed"
            result["error"] = (
                "Validação real incompleta; nenhum segredo foi incluído no relatório."
            )
            ref.set(result)
            raise HTTPException(503, result["error"])

    @app.post("/api/validation/finance/token", dependencies=[Depends(same_origin)])
    def test_token(payload: TestLogin, request: Request):
        claims = owner(request)
        saved = audit_ref(claims).get().to_dict() or {}
        selected = next(
            (u for u in saved.get("users", []) if u["label"] == payload.label), None
        )
        if (
            saved.get("status") != "passed"
            or not selected
            or not selected["uid"].startswith("finnos-preview-" + saved["run_id"])
        ):
            raise HTTPException(404, "Conta de teste autorizada não encontrada.")
        token = auth.create_custom_token(
            selected["uid"],
            {"finnos_preview_test": saved["run_id"]},
            app=firebase_app(),
        ).decode()
        return {"token": token}
