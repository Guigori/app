# Comparação linha a linha — infraestrutura e módulos sem equivalente legado

**Nota:** `backend/server.py` não é executado pelo deploy Vercel, que usa `frontend/api/index.py` e `frontend/finnos/routes.py`. O diff dos entrypoints é estrutural, não demonstra substituição de cada função. Não há `backend/routers/goals.py` para comparar.


## backend/lib/db.py ↔ frontend/finnos/lib/db.py

```text
L---- | F---- | código
- 0001 | ---- | """Shared Mongo handle — import `client`/`db` from here (server.py, routers, seed.py)."""
+ ---- | 0001 | """Small adapter for the existing router query contracts, backed only by Firestore.
= 0002 | 0002 | 
- 0003 | ---- | import logging
+ ---- | 0003 | Every query requires the Firebase UID in the request context. All writes for a
+ ---- | 0004 | user share a transactional revision, so reference checks and deletes serialize.
+ ---- | 0005 | No Motor, MongoDB, legacy auth or database startup is imported.
+ ---- | 0006 | """
+ ---- | 0007 | 
+ ---- | 0008 | import re
= 0004 | 0009 | import os
- 0005 | ---- | from pathlib import Path
+ ---- | 0010 | import uuid
+ ---- | 0011 | import hashlib
+ ---- | 0012 | import json
+ ---- | 0013 | from datetime import date, datetime
+ ---- | 0014 | from decimal import Decimal
+ ---- | 0015 | from contextvars import ContextVar
+ ---- | 0016 | from types import SimpleNamespace
+ ---- | 0017 | from firebase_admin import firestore
+ ---- | 0018 | from fastapi import HTTPException
+ ---- | 0019 | from google.api_core.exceptions import GoogleAPICallError
+ ---- | 0020 | from starlette.concurrency import run_in_threadpool
+ ---- | 0021 | from finnos.lib.money import D, cents
= 0006 | 0022 | 
- 0007 | ---- | from dotenv import load_dotenv
- 0008 | ---- | from motor.motor_asyncio import AsyncIOMotorClient
- 0009 | ---- | from pymongo import ASCENDING, DESCENDING, IndexModel
+ ---- | 0023 | active_uid = ContextVar("finnos_uid", default=None)
+ ---- | 0024 | firebase_application = None
+ ---- | 0025 | MONEY_FIELDS = {
+ ---- | 0026 |     "value",
+ ---- | 0027 |     "adjusted_value",
+ ---- | 0028 |     "installment_value",
+ ---- | 0029 |     "initial_balance",
+ ---- | 0030 |     "monthly_budget",
+ ---- | 0031 |     "monthly_goal",
+ ---- | 0032 |     "limit",
+ ---- | 0033 |     "amount", "planned", "expected_income", "target", "saved", "contribution",
+ ---- | 0034 | }
= 0010 | 0035 | 
- 0011 | ---- | load_dotenv(Path(__file__).parent.parent / ".env")
= 0012 | 0036 | 
- 0013 | ---- | mongo_url = os.environ["MONGO_URL"]
- 0014 | ---- | client = AsyncIOMotorClient(mongo_url)
- 0015 | ---- | db = client[os.environ["DB_NAME"]]
+ ---- | 0037 | def encode(doc):
+ ---- | 0038 |     result = {}
+ ---- | 0039 |     for key, value in doc.items():
+ ---- | 0040 |         if key == "_id":
+ ---- | 0041 |             continue
+ ---- | 0042 |         if key in MONEY_FIELDS and value is not None:
+ ---- | 0043 |             result[key + "_cents"] = cents(value)
+ ---- | 0044 |         elif isinstance(value, dict):
+ ---- | 0045 |             result[key] = encode(value)
+ ---- | 0046 |         elif isinstance(value, list):
+ ---- | 0047 |             result[key] = [encode(x) if isinstance(x, dict) else x for x in value]
+ ---- | 0048 |         elif isinstance(value, date) and not isinstance(value, datetime):
+ ---- | 0049 |             result[key] = value.isoformat()
+ ---- | 0050 |         elif isinstance(value, Decimal):
+ ---- | 0051 |             result[key] = float(value)
+ ---- | 0052 |         else:
+ ---- | 0053 |             result[key] = value
+ ---- | 0054 |     return result
= 0016 | 0055 | 
- 0017 | ---- | logger = logging.getLogger(__name__)
= 0018 | 0056 | 
- 0019 | ---- | # One entry per collection: every field a route filters, sorts, or dedupes on. Applied by ensure_indexes() at startup.
- 0020 | ---- | INDEXES: dict[str, list[IndexModel]] = {
- 0021 | ---- |     "status_checks": [IndexModel([("timestamp", DESCENDING)], name="timestamp_desc")],
- 0022 | ---- |     "users": [
- 0023 | ---- |         IndexModel([("id", ASCENDING)], name="id", unique=True),
- 0024 | ---- |         IndexModel([("email", ASCENDING)], name="email", unique=True),
- 0025 | ---- |     ],
- 0026 | ---- |     "sessions": [
- 0027 | ---- |         IndexModel([("token", ASCENDING)], name="token", unique=True),
- 0028 | ---- |         IndexModel([("user_id", ASCENDING)], name="user_id"),
- 0029 | ---- |         IndexModel([("expires_at", ASCENDING)], name="expires_at"),
- 0030 | ---- |     ],
- 0031 | ---- |     "accounts": [
- 0032 | ---- |         IndexModel([("id", ASCENDING)], name="id", unique=True),
- 0033 | ---- |         IndexModel([("user_id", ASCENDING), ("created_at", ASCENDING)], name="user_created"),
- 0034 | ---- |     ],
- 0035 | ---- |     "categories": [
- 0036 | ---- |         IndexModel([("id", ASCENDING)], name="id", unique=True),
- 0037 | ---- |         IndexModel([("user_id", ASCENDING), ("created_at", ASCENDING)], name="user_created"),
- 0038 | ---- |     ],
- 0039 | ---- |     "transactions": [
- 0040 | ---- |         IndexModel([("id", ASCENDING)], name="id", unique=True),
- 0041 | ---- |         IndexModel([("user_id", ASCENDING), ("date", DESCENDING)], name="user_date"),
- 0042 | ---- |         IndexModel([("user_id", ASCENDING), ("account_id", ASCENDING)], name="user_account"),
- 0043 | ---- |         IndexModel([("user_id", ASCENDING), ("category_id", ASCENDING)], name="user_category"),
- 0044 | ---- |         IndexModel([("user_id", ASCENDING), ("card_id", ASCENDING)], name="user_card"),
- 0045 | ---- |     ],
- 0046 | ---- |     "push_subscriptions": [
- 0047 | ---- |         IndexModel([("endpoint", ASCENDING)], name="endpoint", unique=True),
- 0048 | ---- |         IndexModel([("user_id", ASCENDING)], name="user"),
- 0049 | ---- |     ],
- 0050 | ---- |     "notify_prefs": [IndexModel([("user_id", ASCENDING)], name="user", unique=True)],
- 0051 | ---- |     "reminder_log": [IndexModel([("key", ASCENDING)], name="key", unique=True)],
- 0052 | ---- |     "cards": [
- 0053 | ---- |         IndexModel([("id", ASCENDING)], name="id", unique=True),
- 0054 | ---- |         IndexModel([("user_id", ASCENDING), ("created_at", ASCENDING)], name="user_created"),
- 0055 | ---- |     ],
- 0056 | ---- |     "ai_keys": [
- 0057 | ---- |         IndexModel([("user_id", ASCENDING), ("provider", ASCENDING)], name="user_provider", unique=True),
- 0058 | ---- |     ],
- 0059 | ---- |     "ai_feedback": [IndexModel([("user_id", ASCENDING), ("created_at", DESCENDING)], name="user_created")],
- 0060 | ---- |     "radar_states": [
- 0061 | ---- |         IndexModel([("user_id", ASCENDING), ("signal_id", ASCENDING)], name="user_signal", unique=True),
- 0062 | ---- |         IndexModel([("user_id", ASCENDING), ("updated_at", DESCENDING)], name="user_updated"),
- 0063 | ---- |     ],
- 0064 | ---- |     "radar_feedback": [
- 0065 | ---- |         IndexModel([("user_id", ASCENDING), ("created_at", DESCENDING)], name="user_created"),
- 0066 | ---- |         IndexModel([("signal_id", ASCENDING)], name="signal"),
- 0067 | ---- |     ],
- 0068 | ---- |     "budget_cycles": [
- 0069 | ---- |         IndexModel([("id", ASCENDING)], name="id", unique=True),
- 0070 | ---- |         IndexModel([("user_id", ASCENDING), ("start_date", DESCENDING)], name="user_start"),
- 0071 | ---- |         IndexModel([("user_id", ASCENDING), ("end_date", DESCENDING)], name="user_end"),
- 0072 | ---- |     ],
- 0073 | ---- | }
+ ---- | 0057 | def decode(doc):
+ ---- | 0058 |     result = {}
+ ---- | 0059 |     for key, value in doc.items():
+ ---- | 0060 |         if key.endswith("_cents") and key[:-6] in MONEY_FIELDS:
+ ---- | 0061 |             if not isinstance(value, int) or isinstance(value, bool):
+ ---- | 0062 |                 raise HTTPException(503, "Registro financeiro inválido.")
+ ---- | 0063 |             result[key[:-6]] = D(value) / 100
+ ---- | 0064 |         elif isinstance(value, list):
+ ---- | 0065 |             result[key] = [decode(x) if isinstance(x, dict) else x for x in value]
+ ---- | 0066 |         elif key in MONEY_FIELDS and value is not None:
+ ---- | 0067 |             # Existing Firestore records can be read without a Mongo migration.
+ ---- | 0068 |             result[key] = D(value)
+ ---- | 0069 |         elif isinstance(value, dict):
+ ---- | 0070 |             result[key] = decode(value)
+ ---- | 0071 |         else:
+ ---- | 0072 |             result[key] = value
+ ---- | 0073 |     return result
= 0074 | 0074 | 
= 0075 | 0075 | 
- 0076 | ---- | async def ensure_indexes() -> None:
- 0077 | ---- |     for collection, models in INDEXES.items():
- 0078 | ---- |         for model in models:  # one at a time so a bad spec skips only itself
- 0079 | ---- |             try:
- 0080 | ---- |                 await db[collection].create_indexes([model])
- 0081 | ---- |             except Exception as exc:  # never block boot on an index; the log line names what to fix
- 0082 | ---- |                 logger.error("ensure_indexes(%s.%s): %s", collection, model.document["name"], exc)
+ ---- | 0076 | def matches(doc, query):
+ ---- | 0077 |     for key, expected in query.items():
+ ---- | 0078 |         if key == "$or":
+ ---- | 0079 |             if not any(matches(doc, part) for part in expected):
+ ---- | 0080 |                 return False
+ ---- | 0081 |             continue
+ ---- | 0082 |         actual = doc.get(key)
+ ---- | 0083 |         if isinstance(expected, dict):
+ ---- | 0084 |             for operator, operand in expected.items():
+ ---- | 0085 |                 if operator == "$gte" and (actual is None or actual < operand):
+ ---- | 0086 |                     return False
+ ---- | 0087 |                 if operator == "$gt" and (actual is None or actual <= operand):
+ ---- | 0088 |                     return False
+ ---- | 0089 |                 if operator == "$lt" and (actual is None or actual >= operand):
+ ---- | 0090 |                     return False
+ ---- | 0091 |                 if operator == "$lte" and (actual is None or actual > operand):
+ ---- | 0092 |                     return False
+ ---- | 0093 |                 if operator == "$ne" and actual == operand:
+ ---- | 0094 |                     return False
+ ---- | 0095 |                 if operator == "$in" and actual not in operand:
+ ---- | 0096 |                     return False
+ ---- | 0097 |                 if operator == "$regex" and not re.search(operand, actual or "", re.I):
+ ---- | 0098 |                     return False
+ ---- | 0099 |         elif actual != expected:
+ ---- | 0100 |             return False
+ ---- | 0101 |     return True
= 0083 | 0102 | 
+ ---- | 0103 | 
+ ---- | 0104 | def scoped(query):
+ ---- | 0105 |     uid = active_uid.get()
+ ---- | 0106 |     if not uid or query.get("user_id") != uid:
+ ---- | 0107 |         raise HTTPException(403, "Identidade financeira inválida.")
+ ---- | 0108 |     return uid
+ ---- | 0109 | 
+ ---- | 0110 | 
+ ---- | 0111 | def resource_id(value):
+ ---- | 0112 |     if not isinstance(value, str) or not value or "/" in value or len(value) > 1500:
+ ---- | 0113 |         raise HTTPException(404, "Registro não encontrado.")
+ ---- | 0114 |     return value
+ ---- | 0115 | 
+ ---- | 0116 | 
+ ---- | 0117 | def client():
+ ---- | 0118 |     instance = firestore.client(app=firebase_application())
+ ---- | 0119 |     expected = os.getenv("FIREBASE_PROJECT_ID")
+ ---- | 0120 |     if os.getenv("VERCEL_ENV") == "preview" and expected != "finnos-app":
+ ---- | 0121 |         raise HTTPException(503, "Preview requer o projeto autorizado finnos-app.")
+ ---- | 0122 |     if not expected or instance.project != expected:
+ ---- | 0123 |         raise HTTPException(503, "Projeto financeiro inesperado.")
+ ---- | 0124 |     return instance
+ ---- | 0125 | 
+ ---- | 0126 | 
+ ---- | 0127 | def root(db, uid):
+ ---- | 0128 |     return db.collection("users").document(resource_id(uid))
+ ---- | 0129 | 
+ ---- | 0130 | 
+ ---- | 0131 | def rows(db, uid, name, transaction=None):
+ ---- | 0132 |     snapshots = (
+ ---- | 0133 |         root(db, uid)
+ ---- | 0134 |         .collection(name)
+ ---- | 0135 |         .limit(20001)
+ ---- | 0136 |         .stream(transaction=transaction, timeout=15)
+ ---- | 0137 |     )
+ ---- | 0138 |     docs = [dict(decode(s.to_dict()), id=s.id, user_id=uid) for s in snapshots]
+ ---- | 0139 |     if len(docs) > 20000:
+ ---- | 0140 |         raise HTTPException(
+ ---- | 0141 |             413, "Volume financeiro exige paginação; nenhum total parcial foi exibido."
+ ---- | 0142 |         )
+ ---- | 0143 |     return docs
+ ---- | 0144 | 
+ ---- | 0145 | 
+ ---- | 0146 | def atomic(db, uid, action):
+ ---- | 0147 |     @firestore.transactional
+ ---- | 0148 |     def execute(transaction):
+ ---- | 0149 |         revision = root(db, uid).collection("_meta").document("finance")
+ ---- | 0150 |         before = revision.get(transaction=transaction)
+ ---- | 0151 |         version = (before.to_dict() or {}).get("revision", 0)
+ ---- | 0152 |         result = action(transaction)
+ ---- | 0153 |         transaction.set(revision, {"revision": version + 1})
+ ---- | 0154 |         return result
+ ---- | 0155 | 
+ ---- | 0156 |     return execute(db.transaction(max_attempts=5))
+ ---- | 0157 | 
+ ---- | 0158 | 
+ ---- | 0159 | def validate_refs(db, uid, name, doc, transaction):
+ ---- | 0160 |     fields = []
+ ---- | 0161 |     if name == "transactions":
+ ---- | 0162 |         fields = [
+ ---- | 0163 |             ("account_id", "accounts"),
+ ---- | 0164 |             ("to_account_id", "accounts"),
+ ---- | 0165 |             ("category_id", "categories"),
+ ---- | 0166 |             ("card_id", "cards"),
+ ---- | 0167 |         ]
+ ---- | 0168 |     if name == "cards":
+ ---- | 0169 |         fields = [("payment_account_id", "accounts")]
+ ---- | 0170 |     if name == "transactions":
+ ---- | 0171 |         if doc.get("invoice_payment"):
+ ---- | 0172 |             raise HTTPException(409, "Pagamento de fatura é imutável; use o fluxo de faturas.")
+ ---- | 0173 |         cards = rows(db, uid, "cards", transaction)
+ ---- | 0174 |         if doc.get("card_id"):
+ ---- | 0175 |             from finnos.lib.invoices import occurrences
+ ---- | 0176 |             card = next((c for c in cards if c["id"] == doc["card_id"]), None)
+ ---- | 0177 |             if card and any(key in (card.get("invoice_cycles") or {}) for key, _, _ in occurrences(card, doc)):
+ ---- | 0178 |                 raise HTTPException(409, "Ciclo com pagamentos está congelado; compra exige ajuste auditado.")
+ ---- | 0179 |         if any(any(item["id"] == doc["id"] for cycle in (card.get("invoice_cycles") or {}).values() for item in cycle["items"]) for card in cards):
+ ---- | 0180 |             raise HTTPException(409, "Compra pertence a uma fatura com pagamentos; alteração exige estorno auditado.")
+ ---- | 0181 |     if name == "cards":
+ ---- | 0182 |         old = root(db, uid).collection(name).document(doc["id"]).get(transaction=transaction)
+ ---- | 0183 |         if old.exists and old.to_dict().get("invoice_cycles") and any(doc.get(k) != old.to_dict().get(k) for k in ["closing_day", "due_day"]):
+ ---- | 0184 |             raise HTTPException(409, "Ciclo de cartão com pagamentos não pode ser alterado.")
+ ---- | 0185 |     if name == "budget_cycles":
+ ---- | 0186 |         ids = [a['category_id'] for a in doc.get('allocations', [])]
+ ---- | 0187 |         if len(ids) != len(set(ids)):
+ ---- | 0188 |             raise HTTPException(422, "Categoria duplicada no orçamento.")
+ ---- | 0189 |         fields = [("category_id", "categories")]
+ ---- | 0190 |         for identifier in ids:
+ ---- | 0191 |             if not root(db, uid).collection('categories').document(resource_id(identifier)).get(transaction=transaction).exists:
+ ---- | 0192 |                 raise HTTPException(400, "Categoria de orçamento inválida.")
+ ---- | 0193 |         for cycle in rows(db, uid, 'budget_cycles', transaction):
+ ---- | 0194 |             if cycle['id'] != doc['id'] and not cycle.get('closed_at') and cycle['start_date'] <= doc['end_date'] and cycle['end_date'] >= doc['start_date']:
+ ---- | 0195 |                 raise HTTPException(409, "Já existe orçamento nesse período.")
+ ---- | 0196 |     if name == "goals":
+ ---- | 0197 |         fields = [("account", "accounts")]
+ ---- | 0198 |     for field, collection in fields:
+ ---- | 0199 |         identifier = doc.get(field)
+ ---- | 0200 |         if (
+ ---- | 0201 |             identifier
+ ---- | 0202 |             and not root(db, uid)
+ ---- | 0203 |             .collection(collection)
+ ---- | 0204 |             .document(resource_id(identifier))
+ ---- | 0205 |             .get(transaction=transaction)
+ ---- | 0206 |             .exists
+ ---- | 0207 |         ):
+ ---- | 0208 |             raise HTTPException(
+ ---- | 0209 |                 400, "Referência financeira inválida para este usuário."
+ ---- | 0210 |             )
+ ---- | 0211 | 
+ ---- | 0212 | 
+ ---- | 0213 | class Cursor:
+ ---- | 0214 |     def __init__(self, collection, query):
+ ---- | 0215 |         self.collection, self.query, self.order = collection, query, []
+ ---- | 0216 | 
+ ---- | 0217 |     def sort(self, key, direction=None):
+ ---- | 0218 |         self.order = key if isinstance(key, list) else [(key, direction)]
+ ---- | 0219 |         return self
+ ---- | 0220 | 
+ ---- | 0221 |     async def to_list(self, maximum, *, allow_truncate=False):
+ ---- | 0222 |         uid = scoped(self.query)
+ ---- | 0223 | 
+ ---- | 0224 |         def read():
+ ---- | 0225 |             docs = [
+ ---- | 0226 |                 d
+ ---- | 0227 |                 for d in rows(client(), uid, self.collection.name)
+ ---- | 0228 |                 if matches(d, self.query)
+ ---- | 0229 |             ]
+ ---- | 0230 |             for key, direction in reversed(self.order):
+ ---- | 0231 |                 docs.sort(key=lambda d: str(d.get(key) or ""), reverse=direction == -1)
+ ---- | 0232 |             if len(docs) > maximum and not allow_truncate:
+ ---- | 0233 |                 raise HTTPException(413, "Consulta financeira excedeu o limite; paginação necessária.")
+ ---- | 0234 |             return docs[:maximum]
+ ---- | 0235 | 
+ ---- | 0236 |         return await run_in_threadpool(read)
+ ---- | 0237 | 
+ ---- | 0238 | 
+ ---- | 0239 | class Collection:
+ ---- | 0240 |     def __init__(self, name):
+ ---- | 0241 |         self.name = name
+ ---- | 0242 | 
+ ---- | 0243 |     def find(self, query):
+ ---- | 0244 |         scoped(query)
+ ---- | 0245 |         return Cursor(self, query)
+ ---- | 0246 | 
+ ---- | 0247 |     async def find_one(self, query, sort=None):
+ ---- | 0248 |         cursor = self.find(query)
+ ---- | 0249 |         if sort: cursor.sort(sort)
+ ---- | 0250 |         docs = await cursor.to_list(20000)
+ ---- | 0251 |         return docs[0] if docs else None
+ ---- | 0252 | 
+ ---- | 0253 |     async def count_documents(self, query):
+ ---- | 0254 |         return len(await self.find(query).to_list(20000))
+ ---- | 0255 | 
+ ---- | 0256 |     async def insert_one(self, doc):
+ ---- | 0257 |         uid = scoped(doc)
+ ---- | 0258 | 
+ ---- | 0259 |         def write():
+ ---- | 0260 |             db = client()
+ ---- | 0261 | 
+ ---- | 0262 |             def action(tr):
+ ---- | 0263 |                 if doc.get("operation_id"):
+ ---- | 0264 |                     identifier = str(
+ ---- | 0265 |                         uuid.uuid5(uuid.NAMESPACE_URL, uid + ":" + doc["operation_id"])
+ ---- | 0266 |                     )
+ ---- | 0267 |                     doc["id"] = identifier
+ ---- | 0268 |                 else:
+ ---- | 0269 |                     identifier = doc.get("id") or str(uuid.uuid4())
+ ---- | 0270 |                 doc["id"] = identifier
+ ---- | 0271 |                 ref = (
+ ---- | 0272 |                     root(db, uid)
+ ---- | 0273 |                     .collection(self.name)
+ ---- | 0274 |                     .document(resource_id(identifier))
+ ---- | 0275 |                 )
+ ---- | 0276 |                 existing = ref.get(transaction=tr)
+ ---- | 0277 |                 operation_ref = None
+ ---- | 0278 |                 fingerprint = None
+ ---- | 0279 |                 if doc.get("operation_id"):
+ ---- | 0280 |                     op = hashlib.sha256((self.name + ":create:" + doc["operation_id"]).encode()).hexdigest()
+ ---- | 0281 |                     operation_ref = root(db, uid).collection("sync_receipts").document(op)
+ ---- | 0282 |                     receipt = operation_ref.get(transaction=tr)
+ ---- | 0283 |                     fingerprint = hashlib.sha256(json.dumps(encode({k:v for k,v in doc.items() if k not in {"id", "created_at", "updated_at", "version"}}), default=str, sort_keys=True).encode()).hexdigest()
+ ---- | 0284 |                     if receipt.exists:
+ ---- | 0285 |                         if receipt.to_dict()["fingerprint"] != fingerprint:
+ ---- | 0286 |                             raise HTTPException(409, "Operação já utilizada com outros dados.")
+ ---- | 0287 |                         if not existing.exists:
+ ---- | 0288 |                             raise HTTPException(409, "A transação original foi removida.")
+ ---- | 0289 |                         doc.update(decode(existing.to_dict()))
+ ---- | 0290 |                         return
+ ---- | 0291 |                 validate_refs(db, uid, self.name, doc, tr)
+ ---- | 0292 |                 if existing.exists:
+ ---- | 0293 |                     if (
+ ---- | 0294 |                         doc.get("operation_id")
+ ---- | 0295 |                         and existing.to_dict().get("operation_id")
+ ---- | 0296 |                         == doc["operation_id"]
+ ---- | 0297 |                     ):
+ ---- | 0298 |                         doc.update(decode(existing.to_dict()))
+ ---- | 0299 |                         return
+ ---- | 0300 |                     raise HTTPException(409, "Registro já existe.")
+ ---- | 0301 |                 if self.name == "transactions": doc["version"] = 1
+ ---- | 0302 |                 tr.create(ref, encode(doc))
+ ---- | 0303 |                 if operation_ref is not None:
+ ---- | 0304 |                     tr.create(operation_ref, {"fingerprint": fingerprint, "target_id": identifier})
+ ---- | 0305 | 
+ ---- | 0306 |             return atomic(db, uid, action)
+ ---- | 0307 | 
+ ---- | 0308 |         return await run_in_threadpool(write)
+ ---- | 0309 | 
+ ---- | 0310 |     async def update_one(self, query, update, upsert=False):
+ ---- | 0311 |         return await self._change(query, update, upsert=upsert)
+ ---- | 0312 | 
+ ---- | 0313 |     async def replace_one(self, query, doc):
+ ---- | 0314 |         return await self._change(query, doc, replace=True)
+ ---- | 0315 | 
+ ---- | 0316 |     async def _change(self, query, update, replace=False, upsert=False):
+ ---- | 0317 |         uid = scoped(query)
+ ---- | 0318 | 
+ ---- | 0319 |         def write():
+ ---- | 0320 |             db = client()
+ ---- | 0321 | 
+ ---- | 0322 |             def action(tr):
+ ---- | 0323 |                 docs = [d for d in rows(db, uid, self.name, tr) if matches(d, query)]
+ ---- | 0324 |                 if not docs and not upsert:
+ ---- | 0325 |                     return SimpleNamespace(matched_count=0)
+ ---- | 0326 |                 doc = docs[0] if docs else dict(query, id=str(uuid.uuid4()))
+ ---- | 0327 |                 ref = (
+ ---- | 0328 |                     root(db, uid).collection(self.name).document(resource_id(doc["id"]))
+ ---- | 0329 |                 )
+ ---- | 0330 |                 previous_version = doc.get("version", 1)
+ ---- | 0331 |                 expected_version = update.get("_expected_version")
+ ---- | 0332 |                 operation_ref = None
+ ---- | 0333 |                 if replace and update.get("operation_id"):
+ ---- | 0334 |                     op = hashlib.sha256((self.name + ":update:" + update["operation_id"]).encode()).hexdigest()
+ ---- | 0335 |                     operation_ref = root(db, uid).collection("sync_receipts").document(op)
+ ---- | 0336 |                     receipt = operation_ref.get(transaction=tr)
+ ---- | 0337 |                     fingerprint = hashlib.sha256(json.dumps(encode({k:v for k,v in update.items() if k not in {"created_at", "updated_at", "_expected_version"}}), default=str, sort_keys=True).encode()).hexdigest()
+ ---- | 0338 |                     if receipt.exists:
+ ---- | 0339 |                         if receipt.to_dict()['fingerprint'] != fingerprint:
+ ---- | 0340 |                             raise HTTPException(409, "Identificador de operação reutilizado.")
+ ---- | 0341 |                         return SimpleNamespace(matched_count=1)
+ ---- | 0342 |                 if expected_version is not None and expected_version != previous_version:
+ ---- | 0343 |                     raise HTTPException(409, "Conflito: registro alterado desde a cópia offline. Revise antes de reenviar.")
+ ---- | 0344 |                 if replace:
+ ---- | 0345 |                     doc = dict(update, id=doc["id"], user_id=uid)
+ ---- | 0346 |                     doc.pop("_expected_version", None)
+ ---- | 0347 |                 else:
+ ---- | 0348 |                     if not docs:
+ ---- | 0349 |                         doc.update(update.get("$setOnInsert", {}))
+ ---- | 0350 |                     doc.update(update["$set"])
+ ---- | 0351 |                 if self.name == 'transactions': doc['version'] = previous_version + 1
+ ---- | 0352 |                 validate_refs(db, uid, self.name, doc, tr)
+ ---- | 0353 |                 tr.set(ref, encode(doc))
+ ---- | 0354 |                 if operation_ref is not None:
+ ---- | 0355 |                     tr.create(operation_ref, {'fingerprint':fingerprint, 'target_id':doc['id']})
+ ---- | 0356 |                 return SimpleNamespace(matched_count=1)
+ ---- | 0357 | 
+ ---- | 0358 |             return atomic(db, uid, action)
+ ---- | 0359 | 
+ ---- | 0360 |         return await run_in_threadpool(write)
+ ---- | 0361 | 
+ ---- | 0362 |     async def delete_one(self, query):
+ ---- | 0363 |         uid = scoped(query)
+ ---- | 0364 | 
+ ---- | 0365 |         def write():
+ ---- | 0366 |             db = client()
+ ---- | 0367 | 
+ ---- | 0368 |             def action(tr):
+ ---- | 0369 |                 docs = [d for d in rows(db, uid, self.name, tr) if matches(d, query)]
+ ---- | 0370 |                 if not docs:
+ ---- | 0371 |                     return SimpleNamespace(deleted_count=0)
+ ---- | 0372 |                 doc = docs[0]
+ ---- | 0373 |                 if self.name == "transactions":
+ ---- | 0374 |                     validate_refs(db, uid, self.name, doc, tr)
+ ---- | 0375 |                 if self.name == "cards" and doc.get("invoice_cycles"):
+ ---- | 0376 |                     raise HTTPException(409, "Cartão possui histórico de pagamentos.")
+ ---- | 0377 |                 if self.name in {"accounts", "categories", "cards"}:
+ ---- | 0378 |                     fields = {
+ ---- | 0379 |                         "accounts": ["account_id", "to_account_id"],
+ ---- | 0380 |                         "categories": ["category_id"],
+ ---- | 0381 |                         "cards": ["card_id"],
+ ---- | 0382 |                     }[self.name]
+ ---- | 0383 |                     txs = rows(db, uid, "transactions", tr)
+ ---- | 0384 |                     if any(any(t.get(f) == doc["id"] for f in fields) for t in txs):
+ ---- | 0385 |                         raise HTTPException(
+ ---- | 0386 |                             409, "Registro possui transações vinculadas."
+ ---- | 0387 |                         )
+ ---- | 0388 |                     if self.name == "accounts" and any(
+ ---- | 0389 |                         c.get("payment_account_id") == doc["id"]
+ ---- | 0390 |                         for c in rows(db, uid, "cards", tr)
+ ---- | 0391 |                     ):
+ ---- | 0392 |                         raise HTTPException(409, "Conta possui cartão vinculado.")
+ ---- | 0393 |                     if self.name == "accounts" and any(
+ ---- | 0394 |                         goal.get("account") == doc["id"]
+ ---- | 0395 |                         for goal in rows(db, uid, "goals", tr)
+ ---- | 0396 |                     ):
+ ---- | 0397 |                         raise HTTPException(409, "Conta possui metas vinculadas.")
+ ---- | 0398 |                     if self.name == "categories" and any(
+ ---- | 0399 |                         allocation.get("category_id") == doc["id"]
+ ---- | 0400 |                         for budget in rows(db, uid, "budget_cycles", tr)
+ ---- | 0401 |                         for allocation in budget.get("allocations", [])
+ ---- | 0402 |                     ):
+ ---- | 0403 |                         raise HTTPException(409, "Categoria pertence a um orçamento.")
+ ---- | 0404 |                 tr.delete(
+ ---- | 0405 |                     root(db, uid).collection(self.name).document(resource_id(doc["id"]))
+ ---- | 0406 |                 )
+ ---- | 0407 |                 return SimpleNamespace(deleted_count=1)
+ ---- | 0408 | 
+ ---- | 0409 |             return atomic(db, uid, action)
+ ---- | 0410 | 
+ ---- | 0411 |         return await run_in_threadpool(write)
+ ---- | 0412 | 
+ ---- | 0413 |     async def update_many(self, query, update, upsert=False):
+ ---- | 0414 |         for doc in await self.find(query).to_list(20000):
+ ---- | 0415 |             await self.update_one({"user_id": doc["user_id"], "id": doc["id"]}, update)
+ ---- | 0416 | 
+ ---- | 0417 |     async def insert_many(self, docs):
+ ---- | 0418 |         for doc in docs:
+ ---- | 0419 |             await self.insert_one(doc)
+ ---- | 0420 | 
+ ---- | 0421 | 
+ ---- | 0422 | db = SimpleNamespace(
+ ---- | 0423 |     **{
+ ---- | 0424 |         name: Collection(name)
+ ---- | 0425 |         for name in [
+ ---- | 0426 |             "accounts",
+ ---- | 0427 |             "categories",
+ ---- | 0428 |             "transactions",
+ ---- | 0429 |             "cards",
+ ---- | 0430 |             "notification_states", "budget_cycles", "radar_states", "radar_feedback", "goals", "ai_keys", "ai_feedback",
+ ---- | 0431 |         ]
+ ---- | 0432 |     }
+ ---- | 0433 | )
+ ---- | 0434 | 
```


## backend/server.py ↔ frontend/api/index.py

```text
L---- | F---- | código
- 0001 | ---- | import asyncio
- 0002 | ---- | from contextlib import asynccontextmanager
- 0003 | ---- | from fastapi import FastAPI, APIRouter
- 0004 | ---- | from dotenv import load_dotenv
- 0005 | ---- | from starlette.middleware.cors import CORSMiddleware
+ ---- | 0001 | """Preview-only Firebase auth API, deliberately independent of the Mongo backend.
+ ---- | 0002 | 
+ ---- | 0003 | Vercel's project root is frontend/. Importing backend/server.py would require
+ ---- | 0004 | Mongo credentials and run its index-creation lifespan. This entrypoint never
+ ---- | 0005 | imports that server or touches MongoDB. Financial routes use UID-scoped Firestore subcollections. The diagnostic uses
+ ---- | 0006 | a temporary _migration_smoke document. Firestore rules stay unchanged.
+ ---- | 0007 | """
+ ---- | 0008 | import json
= 0006 | 0009 | import os
- 0007 | ---- | import logging
- 0008 | ---- | from pathlib import Path
- 0009 | ---- | from pydantic import BaseModel, Field
- 0010 | ---- | from typing import List
- 0011 | ---- | import uuid
- 0012 | ---- | from datetime import datetime
+ ---- | 0010 | import time
+ ---- | 0011 | from datetime import timedelta, datetime, timezone
+ ---- | 0012 | from urllib.parse import urlparse
= 0013 | 0013 | 
+ ---- | 0014 | import firebase_admin
+ ---- | 0015 | from firebase_admin import auth, credentials, exceptions
+ ---- | 0016 | from fastapi import Depends, FastAPI, HTTPException, Request, Response
= 0014 | 0017 | 
- 0015 | ---- | ROOT_DIR = Path(__file__).parent
- 0016 | ---- | load_dotenv(ROOT_DIR / '.env')
+ ---- | 0018 | app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
+ ---- | 0019 | COOKIE = "finnos_firebase_session"
+ ---- | 0020 | TTL = timedelta(days=5)
= 0017 | 0021 | 
- 0018 | ---- | # MongoDB connection
- 0019 | ---- | from lib.db import client, db, ensure_indexes
- 0020 | ---- | from routers import (
- 0021 | ---- |     accounts,
- 0022 | ---- |     ai,
- 0023 | ---- |     ai_feedback,
- 0024 | ---- |     analytics,
- 0025 | ---- |     auth,
- 0026 | ---- |     budgets,
- 0027 | ---- |     cards,
- 0028 | ---- |     categories,
- 0029 | ---- |     cron,
- 0030 | ---- |     dashboard,
- 0031 | ---- |     fca,
- 0032 | ---- |     fac,
- 0033 | ---- |     demo,
- 0034 | ---- |     notifications,
- 0035 | ---- |     migration,
- 0036 | ---- |     imports,
- 0037 | ---- |     push,
- 0038 | ---- |     radar,
- 0039 | ---- |     simulation,
- 0040 | ---- |     subscriptions,
- 0041 | ---- |     transactions,
- 0042 | ---- |     firebase_transactions,
- 0043 | ---- |     firebase_diagnostics,
- 0044 | ---- | )
= 0045 | 0022 | 
+ ---- | 0023 | @app.middleware("http")
+ ---- | 0024 | async def preview_only(request: Request, call_next):
+ ---- | 0025 |     # Fail closed outside the explicitly selected preview or local test runtime.
+ ---- | 0026 |     environment = os.getenv("VERCEL_ENV", "development")
+ ---- | 0027 |     production_approved = environment == "production" and os.getenv("FINNOS_FIREBASE_PRODUCTION_ENABLED") == "1"
+ ---- | 0028 |     if environment not in {"preview", "development"} and not production_approved:
+ ---- | 0029 |         from fastapi.responses import JSONResponse
+ ---- | 0030 |         return JSONResponse({"detail": "Not found"}, status_code=404)
+ ---- | 0031 |     response = await call_next(request)
+ ---- | 0032 |     response.headers["Cache-Control"] = "private, no-store"
+ ---- | 0033 |     return response
= 0046 | 0034 | 
- 0047 | ---- | # Startup runs before the yield, shutdown after it. Add your own setup/teardown here.
- 0048 | ---- | @asynccontextmanager
- 0049 | ---- | async def lifespan(app: FastAPI):
- 0050 | ---- |     app.state.index_task = asyncio.create_task(ensure_indexes())  # background: a big index build must not block boot
- 0051 | ---- |     yield
- 0052 | ---- |     client.close()
= 0053 | 0035 | 
+ ---- | 0036 | def firebase_app():
+ ---- | 0037 |     try:
+ ---- | 0038 |         return firebase_admin.get_app("finnos-preview-auth")
+ ---- | 0039 |     except ValueError:
+ ---- | 0040 |         raw = os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON")
+ ---- | 0041 |         if not raw:
+ ---- | 0042 |             raise HTTPException(503, "Credencial Firebase Admin ausente no Preview.")
+ ---- | 0043 |         try:
+ ---- | 0044 |             payload = json.loads(raw)
+ ---- | 0045 |             expected = os.getenv("FIREBASE_PROJECT_ID")
+ ---- | 0046 |             if not expected or payload.get("project_id") != expected:
+ ---- | 0047 |                 raise ValueError("Project mismatch")
+ ---- | 0048 |             credential = credentials.Certificate(payload)
+ ---- | 0049 |             return firebase_admin.initialize_app(credential, name="finnos-preview-auth")
+ ---- | 0050 |         except (ValueError, TypeError, KeyError) as exc:
+ ---- | 0051 |             raise HTTPException(503, "Configuração Firebase Admin inválida no Preview.") from exc
= 0054 | 0052 | 
- 0055 | ---- | # Create the main app without a prefix
- 0056 | ---- | app = FastAPI(lifespan=lifespan)
= 0057 | 0053 | 
- 0058 | ---- | # Create a router with the /api prefix
- 0059 | ---- | api_router = APIRouter(prefix="/api")
+ ---- | 0054 | def same_origin(request: Request):
+ ---- | 0055 |     origin = urlparse(request.headers.get("origin", ""))
+ ---- | 0056 |     local = os.getenv("VERCEL_ENV", "development") == "development"
+ ---- | 0057 |     allowed_schemes = {"https", "http"} if local else {"https"}
+ ---- | 0058 |     if (origin.scheme not in allowed_schemes or origin.netloc != request.headers.get("host")
+ ---- | 0059 |             or origin.path or origin.query or origin.fragment):
+ ---- | 0060 |         raise HTTPException(403, "Origem da requisição inválida.")
= 0060 | 0061 | 
= 0061 | 0062 | 
- 0062 | ---- | # Define Models
- 0063 | ---- | class StatusCheck(BaseModel):
- 0064 | ---- |     id: str = Field(default_factory=lambda: str(uuid.uuid4()))
- 0065 | ---- |     client_name: str
- 0066 | ---- |     timestamp: datetime = Field(default_factory=datetime.utcnow)
+ ---- | 0063 | def verified_claims(token: str, *, session=False):
+ ---- | 0064 |     verifier = auth.verify_session_cookie if session else auth.verify_id_token
+ ---- | 0065 |     try:
+ ---- | 0066 |         claims = verifier(token, app=firebase_app(), check_revoked=True)
+ ---- | 0067 |     except (ValueError, auth.InvalidIdTokenError, auth.InvalidSessionCookieError,
+ ---- | 0068 |             auth.ExpiredIdTokenError, auth.ExpiredSessionCookieError,
+ ---- | 0069 |             auth.RevokedIdTokenError, auth.RevokedSessionCookieError,
+ ---- | 0070 |             auth.UserDisabledError) as exc:
+ ---- | 0071 |         raise HTTPException(401, "Sessão Firebase inválida ou expirada.") from exc
+ ---- | 0072 |     except exceptions.FirebaseError as exc:
+ ---- | 0073 |         raise HTTPException(503, "Firebase indisponível. Tente novamente.") from exc
+ ---- | 0074 |     if not isinstance(claims.get("uid"), str) or not claims["uid"]:
+ ---- | 0075 |         raise HTTPException(401, "Identidade Firebase inválida.")
+ ---- | 0076 |     if not claims.get("email_verified") or not claims.get("email"):
+ ---- | 0077 |         raise HTTPException(403, "Confirme seu e-mail para continuar.")
+ ---- | 0078 |     return claims
= 0067 | 0079 | 
- 0068 | ---- | class StatusCheckCreate(BaseModel):
- 0069 | ---- |     client_name: str
= 0070 | 0080 | 
- 0071 | ---- | # Add your routes to the router instead of directly to app
- 0072 | ---- | @api_router.get("/")
- 0073 | ---- | async def root():
- 0074 | ---- |     return {"message": "Hello World"}
+ ---- | 0081 | def user_out(claims):
+ ---- | 0082 |     try:
+ ---- | 0083 |         user = auth.get_user(claims["uid"], app=firebase_app())
+ ---- | 0084 |     except auth.UserNotFoundError as exc:
+ ---- | 0085 |         raise HTTPException(401, "Conta Firebase não encontrada.") from exc
+ ---- | 0086 |     except exceptions.FirebaseError as exc:
+ ---- | 0087 |         raise HTTPException(503, "Firebase indisponível. Tente novamente.") from exc
+ ---- | 0088 |     if user.disabled or not user.email_verified:
+ ---- | 0089 |         raise HTTPException(403, "Conta Firebase indisponível ou não confirmada.")
+ ---- | 0090 |     return {
+ ---- | 0091 |         "id": user.uid,
+ ---- | 0092 |         "name": user.display_name or user.email.split("@")[0],
+ ---- | 0093 |         "email": user.email,
+ ---- | 0094 |         "created_at": datetime.fromtimestamp(
+ ---- | 0095 |             user.user_metadata.creation_timestamp / 1000, timezone.utc
+ ---- | 0096 |         ).isoformat(),
+ ---- | 0097 |         "session_mode": "account",
+ ---- | 0098 |         "auth_provider": claims.get("firebase", {}).get("sign_in_provider") or "firebase",
+ ---- | 0099 |         "auth_providers": [p.provider_id for p in getattr(user, "provider_data", [])],
+ ---- | 0100 |     }
= 0075 | 0101 | 
- 0076 | ---- | @api_router.post("/status", response_model=StatusCheck)
- 0077 | ---- | async def create_status_check(input: StatusCheckCreate):
- 0078 | ---- |     status_dict = input.model_dump()
- 0079 | ---- |     status_obj = StatusCheck(**status_dict)
- 0080 | ---- |     _ = await db.status_checks.insert_one(status_obj.model_dump())
- 0081 | ---- |     return status_obj
= 0082 | 0102 | 
- 0083 | ---- | @api_router.get("/status", response_model=List[StatusCheck])
- 0084 | ---- | async def get_status_checks():
- 0085 | ---- |     status_checks = await db.status_checks.find().to_list(1000)
- 0086 | ---- |     return [StatusCheck(**status_check) for status_check in status_checks]
+ ---- | 0103 | @app.post("/api/auth/firebase-session", dependencies=[Depends(same_origin)])
+ ---- | 0104 | def firebase_session(request: Request, response: Response):
+ ---- | 0105 |     scheme, _, token = request.headers.get("authorization", "").partition(" ")
+ ---- | 0106 |     if scheme.lower() != "bearer" or not token.strip():
+ ---- | 0107 |         raise HTTPException(401, "Token Firebase ausente.")
+ ---- | 0108 |     claims = verified_claims(token.strip())
+ ---- | 0109 |     auth_time = claims.get("auth_time")
+ ---- | 0110 |     if not isinstance(auth_time, (int, float)) or not 0 <= time.time() - auth_time <= 300:
+ ---- | 0111 |         raise HTTPException(401, "Entre novamente para iniciar a sessão.")
+ ---- | 0112 |     user = user_out(claims)
+ ---- | 0113 |     try:
+ ---- | 0114 |         cookie = auth.create_session_cookie(token.strip(), expires_in=TTL, app=firebase_app())
+ ---- | 0115 |     except exceptions.FirebaseError as exc:
+ ---- | 0116 |         raise HTTPException(503, "Não foi possível iniciar a sessão Firebase.") from exc
+ ---- | 0117 |     response.set_cookie(COOKIE, cookie, max_age=int(TTL.total_seconds()),
+ ---- | 0118 |                         httponly=True, secure=os.getenv("VERCEL_ENV") in {"preview", "production"},
+ ---- | 0119 |                         samesite="lax", path="/")
+ ---- | 0120 |     return user
= 0087 | 0121 | 
- 0088 | ---- | # Resource routers — every route hangs off api_router, never off app.
- 0089 | ---- | api_router.include_router(auth.router)
- 0090 | ---- | api_router.include_router(budgets.router)
- 0091 | ---- | api_router.include_router(accounts.router)
- 0092 | ---- | api_router.include_router(categories.router)
- 0093 | ---- | api_router.include_router(transactions.router)
- 0094 | ---- | api_router.include_router(firebase_transactions.router)
- 0095 | ---- | api_router.include_router(firebase_diagnostics.router)
- 0096 | ---- | api_router.include_router(dashboard.router)
- 0097 | ---- | api_router.include_router(fca.router)
- 0098 | ---- | api_router.include_router(fac.router)
- 0099 | ---- | api_router.include_router(demo.router)
- 0100 | ---- | api_router.include_router(ai.router)
- 0101 | ---- | api_router.include_router(ai_feedback.router)
- 0102 | ---- | api_router.include_router(analytics.router)
- 0103 | ---- | api_router.include_router(cards.router)
- 0104 | ---- | api_router.include_router(notifications.router)
- 0105 | ---- | api_router.include_router(migration.router)
- 0106 | ---- | api_router.include_router(imports.router)
- 0107 | ---- | api_router.include_router(push.router)
- 0108 | ---- | api_router.include_router(radar.router)
- 0109 | ---- | api_router.include_router(simulation.router)
- 0110 | ---- | api_router.include_router(subscriptions.router)
- 0111 | ---- | api_router.include_router(cron.router)
= 0112 | 0122 | 
- 0113 | ---- | # Include the router in the main app
- 0114 | ---- | app.include_router(api_router)
+ ---- | 0123 | @app.get("/api/auth/me")
+ ---- | 0124 | def me(request: Request):
+ ---- | 0125 |     cookie = request.cookies.get(COOKIE)
+ ---- | 0126 |     if not cookie:
+ ---- | 0127 |         raise HTTPException(401, "Não autenticado. Entre novamente.")
+ ---- | 0128 |     claims = verified_claims(cookie, session=True)
+ ---- | 0129 |     if request.headers.get("x-finnos-user-id") and request.headers["x-finnos-user-id"] != claims["uid"]:
+ ---- | 0130 |         raise HTTPException(401, "A identidade da sessão mudou.")
+ ---- | 0131 |     return user_out(claims)
= 0115 | 0132 | 
- 0116 | ---- | app.add_middleware(
- 0117 | ---- |     CORSMiddleware,
- 0118 | ---- |     allow_credentials=True,
- 0119 | ---- |     allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
- 0120 | ---- |     allow_methods=["*"],
- 0121 | ---- |     allow_headers=["*"],
- 0122 | ---- | )
= 0123 | 0133 | 
- 0124 | ---- | # Configure logging
- 0125 | ---- | logging.basicConfig(
- 0126 | ---- |     level=logging.INFO,
- 0127 | ---- |     format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
- 0128 | ---- | )
- 0129 | ---- | logger = logging.getLogger(__name__)
+ ---- | 0134 | @app.post("/api/auth/logout", status_code=204, dependencies=[Depends(same_origin)])
+ ---- | 0135 | def logout(response: Response):
+ ---- | 0136 |     response.delete_cookie(COOKIE, path="/", httponly=True,
+ ---- | 0137 |                            secure=os.getenv("VERCEL_ENV") in {"preview", "production"}, samesite="lax")
= 0130 | 0138 | 
+ ---- | 0139 | 
+ ---- | 0140 | # Diagnostic is explicitly opt-in, Preview-only, and uses no Mongo imports.
+ ---- | 0141 | def smoke_claims(request: Request):
+ ---- | 0142 |     if os.getenv("VERCEL_ENV") != "preview" or os.getenv("FIREBASE_LIVE_SMOKE") != "1":
+ ---- | 0143 |         raise HTTPException(404, "Not found")
+ ---- | 0144 |     cookie = request.cookies.get(COOKIE)
+ ---- | 0145 |     if not cookie:
+ ---- | 0146 |         raise HTTPException(401, "Não autenticado. Entre novamente.")
+ ---- | 0147 |     return verified_claims(cookie, session=True)
+ ---- | 0148 | 
+ ---- | 0149 | 
+ ---- | 0150 | def smoke_page(message: str, *, status_code=200, form=False):
+ ---- | 0151 |     from fastapi.responses import HTMLResponse
+ ---- | 0152 |     from html import escape
+ ---- | 0153 |     content = '<form method="post"><button type="submit">Executar teste isolado do Firestore</button></form>' if form else ""
+ ---- | 0154 |     response = HTMLResponse(
+ ---- | 0155 |         '<!doctype html><html lang="pt-BR"><meta charset="utf-8">'
+ ---- | 0156 |         '<meta name="viewport" content="width=device-width,initial-scale=1">'
+ ---- | 0157 |         '<title>FINNOS — Diagnóstico Firestore Preview</title>'
+ ---- | 0158 |         '<body><main><h1>FINNOS — Diagnóstico Firestore Preview</h1><p>'
+ ---- | 0159 |         + escape(message) + '</p>' + content
+ ---- | 0160 |         + '<p><a href="/">Voltar ao FINNOS</a></p></main></body></html>',
+ ---- | 0161 |         status_code=status_code,
+ ---- | 0162 |     )
+ ---- | 0163 |     response.headers["Content-Security-Policy"] = "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
+ ---- | 0164 |     response.headers["X-Content-Type-Options"] = "nosniff"
+ ---- | 0165 |     return response
+ ---- | 0166 | 
+ ---- | 0167 | 
+ ---- | 0168 | @app.get("/api/auth/firestore-smoke")
+ ---- | 0169 | def firestore_smoke_form(request: Request):
+ ---- | 0170 |     smoke_claims(request)
+ ---- | 0171 |     return smoke_page(
+ ---- | 0172 |         "Teste exclusivo do Preview: cria um documento aleatório em _migration_smoke, "
+ ---- | 0173 |         "confere a leitura e remove o documento. Não acessa dados financeiros nem MongoDB.",
+ ---- | 0174 |         form=True,
+ ---- | 0175 |     )
+ ---- | 0176 | 
+ ---- | 0177 | 
+ ---- | 0178 | @app.post("/api/auth/firestore-smoke", dependencies=[Depends(same_origin)])
+ ---- | 0179 | def firestore_smoke(request: Request):
+ ---- | 0180 |     smoke_claims(request)
+ ---- | 0181 |     from firebase_admin import firestore
+ ---- | 0182 |     from google.api_core.exceptions import GoogleAPICallError
+ ---- | 0183 |     from uuid import uuid4
+ ---- | 0184 |     client = firestore.client(app=firebase_app())
+ ---- | 0185 |     if client.project != "finnos-app":
+ ---- | 0186 |         raise HTTPException(503, "Projeto Firestore inesperado; teste não executado.")
+ ---- | 0187 |     doc_id = "smoke-" + str(uuid4())
+ ---- | 0188 |     ref = client.collection("_migration_smoke").document(doc_id)
+ ---- | 0189 |     payload = {"source": "finnos-preview-diagnostic", "nonce": doc_id,
+ ---- | 0190 |                "created_at": datetime.now(timezone.utc)}
+ ---- | 0191 |     try:
+ ---- | 0192 |         try:
+ ---- | 0193 |             ref.create(payload, timeout=10)
+ ---- | 0194 |             snapshot = ref.get(timeout=10)
+ ---- | 0195 |             if not snapshot.exists or snapshot.to_dict().get("nonce") != doc_id:
+ ---- | 0196 |                 raise RuntimeError("Firestore read-back mismatch")
+ ---- | 0197 |         finally:
+ ---- | 0198 |             # The unique random reference is the only document touched.
+ ---- | 0199 |             # Also clean up if a timed-out create reached the server.
+ ---- | 0200 |             ref.delete(timeout=10)
+ ---- | 0201 |         if ref.get(timeout=10).exists:
+ ---- | 0202 |             raise RuntimeError("Firestore cleanup mismatch")
+ ---- | 0203 |     except (GoogleAPICallError, RuntimeError):
+ ---- | 0204 |         return smoke_page(
+ ---- | 0205 |             "Teste Firestore falhou. A limpeza do documento temporário foi tentada. "
+ ---- | 0206 |             "Confira os logs do Preview; o resultado não foi aprovado.", status_code=503,
+ ---- | 0207 |         )
+ ---- | 0208 |     return smoke_page(
+ ---- | 0209 |         "APROVADO — projeto finnos-app. Escrita: OK. Leitura: OK. "
+ ---- | 0210 |         "Exclusão: OK. Ausência do documento após a limpeza: confirmada. "
+ ---- | 0211 |         "MongoDB e dados financeiros não foram acessados."
+ ---- | 0212 |     )
+ ---- | 0213 | 
+ ---- | 0214 | 
+ ---- | 0215 | from finnos.routes import mount
+ ---- | 0216 | mount(app, lambda: firebase_app(), lambda *args, **kwargs: verified_claims(*args, **kwargs), same_origin)
+ ---- | 0217 | # Passwordless validation bootstrap retired after conventional A/B/C login passed.
+ ---- | 0218 | # No route may create test identities or mint validation login tokens.
+ ---- | 0219 | 
```


## Apenas na implementação Vercel: frontend/finnos/routes.py

```text
0001 | from fastapi import APIRouter, Depends
0002 | from finnos.lib import db
0003 | from finnos.routers import (
0004 |     auth,
0005 |     accounts,
0006 |     categories,
0007 |     transactions,
0008 |     dashboard,
0009 |     analytics,
0010 |     notifications,
0011 |     subscriptions,
0012 |     cards,
0013 |     budgets,
0014 |     goals,
0015 |     radar,
0016 |     ai,
0017 |     ai_feedback,
0018 |     simulation,
0019 |     finance_validation,
0020 | )
0021 | 
0022 | 
0023 | def mount(app, firebase_app, verified_claims, same_origin):
0024 |     db.firebase_application = firebase_app
0025 |     auth.verify = verified_claims
0026 |     router = APIRouter(prefix="/api")
0027 |     for module in [
0028 |         accounts,
0029 |         categories,
0030 |         transactions,
0031 |         dashboard,
0032 |         analytics,
0033 |         notifications,
0034 |         subscriptions,
0035 |         cards,
0036 |         budgets,
0037 |         goals,
0038 |         radar,
0039 |         ai,
0040 |         ai_feedback,
0041 |         simulation,
0042 |         finance_validation,
0043 |     ]:
0044 |         router.include_router(module.router)
0045 |     app.include_router(router)
0046 | 
0047 |     # Mutation CSRF applies to finance routes; cookie auth is never sufficient on its own.
0048 |     @app.middleware("http")
0049 |     async def finance_origin(request, call_next):
0050 |         if request.method in {"POST", "PUT", "PATCH", "DELETE"} and any(
0051 |             request.url.path.startswith("/api/" + x)
0052 |             for x in ["accounts", "categories", "transactions", "notifications", "cards", "budgets", "goals", "radar", "ai", "simulate"]
0053 |         ):
0054 |             from fastapi import HTTPException
0055 |             from fastapi.responses import JSONResponse
0056 | 
0057 |             try:
0058 |                 same_origin(request)
0059 |             except HTTPException as exc:
0060 |                 return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)
0061 |         return await call_next(request)
0062 | 
```


## Apenas na implementação Vercel: frontend/finnos/routers/goals.py

```text
0001 | """UID-scoped goal plans. Saving a plan never moves bank money."""
0002 | import uuid
0003 | from datetime import datetime, timezone
0004 | from typing import Literal
0005 | from fastapi import APIRouter, Depends
0006 | from pydantic import Field, model_validator
0007 | from finnos.lib.money import FinanceModel, Money, D, cents
0008 | from finnos.lib.db import db
0009 | from finnos.lib.dates import today_iso
0010 | from finnos.lib.stats import month_portion, add_months
0011 | from finnos.routers.auth import require_user
0012 | 
0013 | router = APIRouter(prefix='/goals',tags=['goals'])
0014 | 
0015 | class GoalIn(FinanceModel):
0016 |     name: str = Field(min_length=1,max_length=100)
0017 |     category: str = Field(max_length=100)
0018 |     mode: Literal['tradicional','inteligente']
0019 |     target: Money = Field(gt=0)
0020 |     saved: Money = Field(default=0,ge=0)
0021 |     months: int = Field(ge=1,le=1200)
0022 |     contribution: Money = Field(ge=0)
0023 |     frequency: Literal['Mensal','Quinzenal','Semanal']
0024 |     account: str
0025 |     strategy: str | None = Field(None,max_length=50)
0026 |     remind: bool = True
0027 |     radar: bool = True
0028 | 
0029 |     @model_validator(mode='after')
0030 |     def valid_saved(self):
0031 |         if self.saved > self.target: raise ValueError('Reserva excede objetivo.')
0032 |         return self
0033 | 
0034 | class GoalOut(GoalIn):
0035 |     id: str
0036 |     createdAt: str
0037 | 
0038 | @router.get('',response_model=list[GoalOut])
0039 | async def list_goals(user=Depends(require_user)):
0040 |     return [GoalOut(**{k:v for k,v in row.items() if k not in {'user_id','updated_at'}}) for row in await db.goals.find({'user_id':user['id']}).to_list(500)]
0041 | 
0042 | @router.post('',response_model=GoalOut,status_code=201)
0043 | async def create_goal(payload:GoalIn,user=Depends(require_user)):
0044 |     doc=dict(payload.model_dump(),id=str(uuid.uuid4()),user_id=user['id'],createdAt=datetime.now(timezone.utc).isoformat())
0045 |     await db.goals.insert_one(doc)
0046 |     return GoalOut(**{k:v for k,v in doc.items() if k!='user_id'})
0047 | 
0048 | @router.get('/suggestion')
0049 | async def suggestion(user=Depends(require_user)):
0050 |     txs=await db.transactions.find({'user_id':user['id']}).to_list(20000)
0051 |     goals=await db.goals.find({'user_id':user['id']}).to_list(500)
0052 |     current=today_iso()[:7]
0053 |     months=[add_months(current,-i) for i in range(3)]
0054 |     observed=[m for m in months if any(month_portion(t,m) is not None for t in txs)]
0055 |     income=expense=0
0056 |     for month in observed:
0057 |         for tx in txs:
0058 |             amount=month_portion(tx,month)
0059 |             if amount is None: continue
0060 |             if tx['type']=='receita':income+=cents(amount)
0061 |             elif tx['type']=='despesa':expense+=cents(amount)
0062 |     n=max(len(observed),1)
0063 |     income=int((D(income)/n).quantize(D(1),rounding='ROUND_HALF_UP'))
0064 |     expense=int((D(expense)/n).quantize(D(1),rounding='ROUND_HALF_UP'))
0065 |     reserved=sum(cents(g['contribution'])*(52 if g['frequency']=='Semanal' else 26 if g['frequency']=='Quinzenal' else 12)//12 for g in goals if g['saved'] < g['target'])
0066 |     capacity=max(income-expense-reserved,0)
0067 |     return dict(income=income/100,expense=expense/100,reserved=reserved/100,capacity=capacity/100,months_observed=len(observed),writes_data=False,method='media_realizada_menos_aportes_planejados',strategies=[dict(id='acelerado',label='Acelerado',amount=capacity/100),dict(id='equilibrado',label='Equilibrado',amount=(capacity*75//100)/100),dict(id='seguro',label='Seguro',amount=(capacity//2)/100)])
0068 | 
```


## Apenas na implementação Vercel: frontend/vercel.json

```text
0001 | {
0002 |   "framework": "vite",
0003 |   "routes": [
0004 |     {
0005 |       "src": "/api/(auth/(me|firebase-session|logout|firestore-smoke)|accounts(?:/.*)?|categories(?:/.*)?|transactions(?:/.*)?|dashboard|analytics(?:/.*)?|cards(?:/.*)?|notifications(?:/.*)?|subscriptions|budgets(?:/.*)?|goals(?:/.*)?|radar(?:/.*)?|ai(?:/.*)?|simulate(?:/.*)?|finance/integrity|validation/finance(?:/.*)?)",
0006 |       "dest": "/api"
0007 |     },
0008 |     {
0009 |       "handle": "filesystem"
0010 |     },
0011 |     {
0012 |       "src": "/(?!api(?:/|$)).*",
0013 |       "dest": "/index.html"
0014 |     }
0015 |   ]
0016 | }
0017 | 
```


## Apenas na implementação Vercel: frontend/finnos/lib/finance_audit.py

```text
0001 | """Pure checks for the active Firestore financial data model.
0002 | 
0003 | Passing this audit does NOT prove that an earlier MongoDB account has been
0004 | migrated. Legacy reconciliation is an independent operator-controlled step.
0005 | """
0006 | from collections import Counter
0007 | from finnos.lib.money import D
0008 | from finnos.lib.stats import balance_effects
0009 | from finnos.lib.dates import today_iso
0010 | 
0011 | KINDS = ("accounts", "categories", "cards", "transactions", "goals", "budget_cycles")
0012 | 
0013 | 
0014 | def audit_finance(records):
0015 |     accounts = {row["id"] for row in records["accounts"]}
0016 |     categories = {row["id"] for row in records["categories"]}
0017 |     cards = {row["id"] for row in records["cards"]}
0018 |     problems = Counter()
0019 | 
0020 |     for card in records["cards"]:
0021 |         if card.get("payment_account_id") and card["payment_account_id"] not in accounts:
0022 |             problems["card_payment_account_missing"] += 1
0023 | 
0024 |     for tx in records["transactions"]:
0025 |         if tx.get("account_id") not in accounts:
0026 |             problems["transaction_source_account_missing"] += 1
0027 |         if tx.get("to_account_id") and tx["to_account_id"] not in accounts:
0028 |             problems["transaction_target_account_missing"] += 1
0029 |         if tx.get("category_id") and tx["category_id"] not in categories:
0030 |             problems["transaction_category_missing"] += 1
0031 |         if tx.get("card_id") and tx["card_id"] not in cards:
0032 |             problems["transaction_card_missing"] += 1
0033 |         if tx.get("type") == "transferencia" and (
0034 |             not tx.get("to_account_id") or tx["to_account_id"] == tx.get("account_id")
0035 |         ):
0036 |             problems["transaction_transfer_invalid"] += 1
0037 |         if tx.get("invoice_payment") and tx.get("invoice_card_id") not in cards:
0038 |             problems["invoice_payment_card_missing"] += 1
0039 | 
0040 |     for goal in records["goals"]:
0041 |         if goal.get("account") not in accounts:
0042 |             problems["goal_account_missing"] += 1
0043 | 
0044 |     for budget in records["budget_cycles"]:
0045 |         for allocation in budget.get("allocations", []):
0046 |             if allocation.get("category_id") not in categories:
0047 |                 problems["budget_category_missing"] += 1
0048 | 
0049 |     total_balance = sum((D(acc.get("initial_balance") or 0) for acc in records["accounts"]), D(0))
0050 |     # Only compute a total when all account references exist; otherwise it
0051 |     # would conceal missing destinations or generate a misleading balance.
0052 |     if not problems:
0053 |         for tx in records["transactions"]:
0054 |             for _, amount in balance_effects(tx, today_iso()):
0055 |                 total_balance += amount
0056 | 
0057 |     counts = {kind: len(records[kind]) for kind in KINDS}
0058 |     return {
0059 |         "storage": "firestore",
0060 |         "integrity_ok": not problems,
0061 |         "issues": dict(sorted(problems.items())),
0062 |         "counts": counts,
0063 |         "has_financial_records": any(counts[k] for k in ("accounts", "cards", "transactions")),
0064 |         "total_account_balance": float(round(total_balance, 2)) if not problems else None,
0065 |         "legacy_reconciliation": "not_verified",
0066 |     }
0067 | 
```


## Apenas na implementação Vercel: frontend/finnos/routers/finance_validation.py

```text
0001 | """Authenticated, read-only Firestore finance validation endpoint."""
0002 | from fastapi import APIRouter, Depends
0003 | from finnos.lib.db import db
0004 | from finnos.lib.finance_audit import KINDS, audit_finance
0005 | from finnos.routers.auth import require_user
0006 | 
0007 | router = APIRouter(prefix="/finance", tags=["finance-validation"])
0008 | 
0009 | 
0010 | @router.get("/integrity")
0011 | async def validation(user: dict = Depends(require_user)):
0012 |     uid = user["id"]
0013 |     records = {}
0014 |     for kind in KINDS:
0015 |         records[kind] = await getattr(db, kind).find({"user_id": uid}).to_list(20000)
0016 |     return audit_finance(records)
0017 | 
```
