"""Small adapter for the existing router query contracts, backed only by Firestore.

Every query requires the Firebase UID in the request context. All writes for a
user share a transactional revision, so reference checks and deletes serialize.
No Motor, MongoDB, legacy auth or database startup is imported.
"""

import re
import os
import uuid
import hashlib
import json
from datetime import date, datetime
from decimal import Decimal
from contextvars import ContextVar
from types import SimpleNamespace
from firebase_admin import firestore
from fastapi import HTTPException
from google.api_core.exceptions import GoogleAPICallError
from starlette.concurrency import run_in_threadpool
from finnos.lib.money import D, cents

active_uid = ContextVar("finnos_uid", default=None)
firebase_application = None
MONEY_FIELDS = {
    "value",
    "adjusted_value",
    "installment_value",
    "initial_balance",
    "monthly_budget",
    "monthly_goal",
    "limit",
    "amount", "planned", "expected_income", "target", "saved", "contribution",
}


def encode(doc):
    result = {}
    for key, value in doc.items():
        if key == "_id":
            continue
        if key in MONEY_FIELDS and value is not None:
            result[key + "_cents"] = cents(value)
        elif isinstance(value, dict):
            result[key] = encode(value)
        elif isinstance(value, list):
            result[key] = [encode(x) if isinstance(x, dict) else x for x in value]
        elif isinstance(value, date) and not isinstance(value, datetime):
            result[key] = value.isoformat()
        elif isinstance(value, Decimal):
            result[key] = float(value)
        else:
            result[key] = value
    return result


def decode(doc):
    result = {}
    for key, value in doc.items():
        if key.endswith("_cents") and key[:-6] in MONEY_FIELDS:
            if not isinstance(value, int) or isinstance(value, bool):
                raise HTTPException(503, "Registro financeiro inválido.")
            result[key[:-6]] = D(value) / 100
        elif isinstance(value, list):
            result[key] = [decode(x) if isinstance(x, dict) else x for x in value]
        elif key in MONEY_FIELDS and value is not None:
            # Existing Firestore records can be read without a Mongo migration.
            result[key] = D(value)
        elif isinstance(value, dict):
            result[key] = decode(value)
        else:
            result[key] = value
    return result


def matches(doc, query):
    for key, expected in query.items():
        if key == "$or":
            if not any(matches(doc, part) for part in expected):
                return False
            continue
        actual = doc.get(key)
        if isinstance(expected, dict):
            for operator, operand in expected.items():
                if operator == "$gte" and (actual is None or actual < operand):
                    return False
                if operator == "$gt" and (actual is None or actual <= operand):
                    return False
                if operator == "$lt" and (actual is None or actual >= operand):
                    return False
                if operator == "$lte" and (actual is None or actual > operand):
                    return False
                if operator == "$ne" and actual == operand:
                    return False
                if operator == "$in" and actual not in operand:
                    return False
                if operator == "$regex" and not re.search(operand, actual or "", re.I):
                    return False
        elif actual != expected:
            return False
    return True


def scoped(query):
    uid = active_uid.get()
    if not uid or query.get("user_id") != uid:
        raise HTTPException(403, "Identidade financeira inválida.")
    return uid


def resource_id(value):
    if not isinstance(value, str) or not value or "/" in value or len(value) > 1500:
        raise HTTPException(404, "Registro não encontrado.")
    return value


def client():
    instance = firestore.client(app=firebase_application())
    expected = os.getenv("FIREBASE_PROJECT_ID")
    if os.getenv("VERCEL_ENV") == "preview" and expected != "finnos-app":
        raise HTTPException(503, "Preview requer o projeto autorizado finnos-app.")
    if not expected or instance.project != expected:
        raise HTTPException(503, "Projeto financeiro inesperado.")
    return instance


def root(db, uid):
    return db.collection("users").document(resource_id(uid))


def rows(db, uid, name, transaction=None):
    snapshots = (
        root(db, uid)
        .collection(name)
        .limit(20001)
        .stream(transaction=transaction, timeout=15)
    )
    docs = [dict(decode(s.to_dict()), id=s.id, user_id=uid) for s in snapshots]
    if len(docs) > 20000:
        raise HTTPException(
            413, "Volume financeiro exige paginação; nenhum total parcial foi exibido."
        )
    return docs


def atomic(db, uid, action):
    @firestore.transactional
    def execute(transaction):
        revision = root(db, uid).collection("_meta").document("finance")
        before = revision.get(transaction=transaction)
        version = (before.to_dict() or {}).get("revision", 0)
        result = action(transaction)
        transaction.set(revision, {"revision": version + 1})
        return result

    return execute(db.transaction(max_attempts=5))


def validate_refs(db, uid, name, doc, transaction, original_tx=None):
    from finnos.lib.institutions import institution_key
    fields = []
    if name in {"accounts", "cards"}:
        fields.append(("institution_id", "institutions"))
    if name == "institutions":
        candidate = institution_key(doc.get("name", ""))
        if not candidate:
            raise HTTPException(422, "Nome da instituição inválido.")
        if any(institution_key(item.get("name", "")) == candidate and item["id"] != doc["id"]
               for item in rows(db, uid, "institutions", transaction)):
            raise HTTPException(409, "Esta instituição já está cadastrada.")
    if name == "transactions":
        fields = [
            ("account_id", "accounts"),
            ("to_account_id", "accounts"),
            ("category_id", "categories"),
            ("card_id", "cards"),
        ]
    if name == "cards":
        fields.append(("payment_account_id", "accounts"))
    if name == "transactions":
        if doc.get("invoice_payment"):
            raise HTTPException(409, "Pagamento de fatura é imutável; use o fluxo de faturas.")
        from finnos.lib.dates import today_iso
        from finnos.lib.invoices import purchase_write_conflict
        cards = rows(db, uid, "cards", transaction)
        for card in cards:
            reason = purchase_write_conflict(card, doc, today_iso(), original_tx)
            if reason:
                raise HTTPException(409, reason)
    if name == "cards":
        old = root(db, uid).collection(name).document(doc["id"]).get(transaction=transaction)
        if old.exists and old.to_dict().get("invoice_cycles") and any(doc.get(k) != old.to_dict().get(k) for k in ["closing_day", "due_day"]):
            raise HTTPException(409, "Ciclo de cartão com pagamentos não pode ser alterado.")
    if name == "budget_cycles":
        ids = [a['category_id'] for a in doc.get('allocations', [])]
        if len(ids) != len(set(ids)):
            raise HTTPException(422, "Categoria duplicada no orçamento.")
        fields = [("category_id", "categories")]
        for identifier in ids:
            if not root(db, uid).collection('categories').document(resource_id(identifier)).get(transaction=transaction).exists:
                raise HTTPException(400, "Categoria de orçamento inválida.")
        for cycle in rows(db, uid, 'budget_cycles', transaction):
            if cycle['id'] != doc['id'] and not cycle.get('closed_at') and cycle['start_date'] <= doc['end_date'] and cycle['end_date'] >= doc['start_date']:
                raise HTTPException(409, "Já existe orçamento nesse período.")
    if name == "goals":
        fields = [("account", "accounts")]
    if name == "subscriptions":
        fields = [("account_id", "accounts"), ("category_id", "categories"), ("card_id", "cards")]
    for field, collection in fields:
        identifier = doc.get(field)
        if (
            identifier
            and not root(db, uid)
            .collection(collection)
            .document(resource_id(identifier))
            .get(transaction=transaction)
            .exists
        ):
            raise HTTPException(
                400, "Referência financeira inválida para este usuário."
            )
    if name in {"accounts", "cards"} and doc.get("institution_id"):
        institution_ref = root(db, uid).collection("institutions").document(resource_id(doc["institution_id"]))
        institution = institution_ref.get(transaction=transaction)
        if institution.exists:
            doc["institution"] = institution.to_dict()["name"]


class Cursor:
    def __init__(self, collection, query):
        self.collection, self.query, self.order = collection, query, []

    def sort(self, key, direction=None):
        self.order = key if isinstance(key, list) else [(key, direction)]
        return self

    async def to_list(self, maximum, *, allow_truncate=False):
        uid = scoped(self.query)

        def read():
            docs = [
                d
                for d in rows(client(), uid, self.collection.name)
                if matches(d, self.query)
            ]
            for key, direction in reversed(self.order):
                docs.sort(key=lambda d: str(d.get(key) or ""), reverse=direction == -1)
            if len(docs) > maximum and not allow_truncate:
                raise HTTPException(413, "Consulta financeira excedeu o limite; paginação necessária.")
            return docs[:maximum]

        return await run_in_threadpool(read)


class Collection:
    def __init__(self, name):
        self.name = name

    def find(self, query):
        scoped(query)
        return Cursor(self, query)

    async def find_one(self, query, sort=None):
        cursor = self.find(query)
        if sort: cursor.sort(sort)
        docs = await cursor.to_list(20000)
        return docs[0] if docs else None

    async def count_documents(self, query):
        return len(await self.find(query).to_list(20000))

    async def insert_one(self, doc):
        uid = scoped(doc)

        def write():
            db = client()

            def action(tr):
                if doc.get("operation_id"):
                    identifier = str(
                        uuid.uuid5(uuid.NAMESPACE_URL, uid + ":" + doc["operation_id"])
                    )
                    doc["id"] = identifier
                else:
                    identifier = doc.get("id") or str(uuid.uuid4())
                doc["id"] = identifier
                ref = (
                    root(db, uid)
                    .collection(self.name)
                    .document(resource_id(identifier))
                )
                existing = ref.get(transaction=tr)
                operation_ref = None
                fingerprint = None
                if doc.get("operation_id"):
                    op = hashlib.sha256((self.name + ":create:" + doc["operation_id"]).encode()).hexdigest()
                    operation_ref = root(db, uid).collection("sync_receipts").document(op)
                    receipt = operation_ref.get(transaction=tr)
                    fingerprint = hashlib.sha256(json.dumps(encode({k:v for k,v in doc.items() if k not in {"id", "created_at", "updated_at", "version"}}), default=str, sort_keys=True).encode()).hexdigest()
                    if receipt.exists:
                        if receipt.to_dict()["fingerprint"] != fingerprint:
                            raise HTTPException(409, "Operação já utilizada com outros dados.")
                        if not existing.exists:
                            raise HTTPException(409, "A transação original foi removida.")
                        doc.update(decode(existing.to_dict()))
                        return
                validate_refs(db, uid, self.name, doc, tr)
                if existing.exists:
                    if (
                        doc.get("operation_id")
                        and existing.to_dict().get("operation_id")
                        == doc["operation_id"]
                    ):
                        doc.update(decode(existing.to_dict()))
                        return
                    raise HTTPException(409, "Registro já existe.")
                if self.name == "transactions": doc["version"] = 1
                tr.create(ref, encode(doc))
                if operation_ref is not None:
                    tr.create(operation_ref, {"fingerprint": fingerprint, "target_id": identifier})

            return atomic(db, uid, action)

        return await run_in_threadpool(write)

    async def update_one(self, query, update, upsert=False):
        return await self._change(query, update, upsert=upsert)

    async def replace_one(self, query, doc):
        return await self._change(query, doc, replace=True)

    async def _change(self, query, update, replace=False, upsert=False):
        uid = scoped(query)

        def write():
            db = client()

            def action(tr):
                docs = [d for d in rows(db, uid, self.name, tr) if matches(d, query)]
                if not docs and not upsert:
                    return SimpleNamespace(matched_count=0)
                doc = docs[0] if docs else dict(query, id=str(uuid.uuid4()))
                original_tx = dict(doc) if self.name == "transactions" and docs else None
                if self.name == "transactions" and docs and doc.get("invoice_payment"):
                    raise HTTPException(409, "Pagamento de fatura é imutável; use o fluxo de faturas.")
                ref = (
                    root(db, uid).collection(self.name).document(resource_id(doc["id"]))
                )
                previous_version = doc.get("version", 1)
                expected_version = update.get("_expected_version")
                operation_ref = None
                if replace and update.get("operation_id"):
                    op = hashlib.sha256((self.name + ":update:" + update["operation_id"]).encode()).hexdigest()
                    operation_ref = root(db, uid).collection("sync_receipts").document(op)
                    receipt = operation_ref.get(transaction=tr)
                    fingerprint = hashlib.sha256(json.dumps(encode({k:v for k,v in update.items() if k not in {"created_at", "updated_at", "_expected_version"}}), default=str, sort_keys=True).encode()).hexdigest()
                    if receipt.exists:
                        if receipt.to_dict()['fingerprint'] != fingerprint:
                            raise HTTPException(409, "Identificador de operação reutilizado.")
                        return SimpleNamespace(matched_count=1)
                if expected_version is not None and expected_version != previous_version:
                    raise HTTPException(409, "Conflito: registro alterado desde a cópia offline. Revise antes de reenviar.")
                if replace:
                    doc = dict(update, id=doc["id"], user_id=uid)
                    doc.pop("_expected_version", None)
                else:
                    if not docs:
                        doc.update(update.get("$setOnInsert", {}))
                    doc.update(update["$set"])
                if self.name == 'transactions': doc['version'] = previous_version + 1
                validate_refs(db, uid, self.name, doc, tr, original_tx=original_tx)
                tr.set(ref, encode(doc))
                if operation_ref is not None:
                    tr.create(operation_ref, {'fingerprint':fingerprint, 'target_id':doc['id']})
                return SimpleNamespace(matched_count=1)

            return atomic(db, uid, action)

        return await run_in_threadpool(write)

    async def delete_one(self, query):
        uid = scoped(query)

        def write():
            db = client()

            def action(tr):
                docs = [d for d in rows(db, uid, self.name, tr) if matches(d, query)]
                if not docs:
                    return SimpleNamespace(deleted_count=0)
                doc = docs[0]
                if self.name == "transactions":
                    validate_refs(db, uid, self.name, doc, tr, original_tx=doc)
                if self.name == "cards" and doc.get("invoice_cycles"):
                    raise HTTPException(409, "Cartão possui histórico de pagamentos.")
                if self.name in {"accounts", "categories", "cards"}:
                    fields = {
                        "accounts": ["account_id", "to_account_id"],
                        "categories": ["category_id"],
                        "cards": ["card_id"],
                    }[self.name]
                    txs = rows(db, uid, "transactions", tr)
                    if any(any(t.get(f) == doc["id"] for f in fields) for t in txs):
                        raise HTTPException(
                            409, "Registro possui transações vinculadas."
                        )
                    if self.name == "accounts" and any(
                        c.get("payment_account_id") == doc["id"]
                        for c in rows(db, uid, "cards", tr)
                    ):
                        raise HTTPException(409, "Conta possui cartão vinculado.")
                    if self.name == "accounts" and any(
                        goal.get("account") == doc["id"]
                        for goal in rows(db, uid, "goals", tr)
                    ):
                        raise HTTPException(409, "Conta possui metas vinculadas.")
                    if self.name == "categories" and any(
                        allocation.get("category_id") == doc["id"]
                        for budget in rows(db, uid, "budget_cycles", tr)
                        for allocation in budget.get("allocations", [])
                    ):
                        raise HTTPException(409, "Categoria pertence a um orçamento.")
                    subscriptions = rows(db, uid, "subscriptions", tr)
                    subscription_field = {
                        "accounts": "account_id",
                        "categories": "category_id",
                        "cards": "card_id",
                    }[self.name]
                    if any(sub.get(subscription_field) == doc["id"] for sub in subscriptions):
                        raise HTTPException(409, "Registro possui assinatura vinculada.")
                if self.name == "institutions" and any(
                    row.get("institution_id") == doc["id"]
                    for kind in ("accounts", "cards")
                    for row in rows(db, uid, kind, tr)
                ):
                    raise HTTPException(409, "Instituição possui contas ou cartões vinculados.")
                if self.name == "accounts":
                    tr.delete(root(db, uid).collection("accountPaymentMethods").document(resource_id(doc["id"])))
                tr.delete(
                    root(db, uid).collection(self.name).document(resource_id(doc["id"]))
                )
                return SimpleNamespace(deleted_count=1)

            return atomic(db, uid, action)

        return await run_in_threadpool(write)

    async def update_many(self, query, update, upsert=False):
        for doc in await self.find(query).to_list(20000):
            await self.update_one({"user_id": doc["user_id"], "id": doc["id"]}, update)

    async def insert_many(self, docs):
        for doc in docs:
            await self.insert_one(doc)


db = SimpleNamespace(
    **{
        name: Collection(name)
        for name in [
            "accounts",
            "institutions",
            "categories",
            "transactions",
            "cards",
            "notification_states", "notification_preferences", "budget_cycles", "radar_states", "radar_feedback", "goals", "subscriptions", "ai_keys", "ai_feedback",
        ]
    }
)
