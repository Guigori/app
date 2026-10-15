# Comparação linha a linha — transações, cartões, faturas e orçamentos

Arquivos `Guigori/app/main` em 14/10/2026. `=` linhas idênticas, `-` código legado, `+` código Firestore. A comparação é textual; faturamento foi redesenhado e exige análise semântica adicional.


## backend/routers/transactions.py ↔ frontend/finnos/routers/transactions.py

Linhas legado 215; ativo 266.

```text
L---- | F---- | código
- 0001 | ---- | """Transactions CRUD — filters, installment math and server-side enrichment."""
+ ---- | 0001 | from finnos.lib.money import D
= 0002 | 0002 | 
+ ---- | 0003 | """Transactions CRUD — filters, installment math and server-side enrichment."""
= 0003 | 0004 | import re
= 0004 | 0005 | import uuid
= 0005 | 0006 | from datetime import datetime, timezone
= 0006 | 0007 | from typing import List, Optional
- 0007 | ---- | 
= 0008 | 0008 | from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response
- 0009 | ---- | 
- 0010 | ---- | from lib.db import db
- 0011 | ---- | from lib.stats import aware, month_bounds
- 0012 | ---- | from models.finnos import TransactionIn, TransactionOut, TxStatus, TxType
- 0013 | ---- | from routers.auth import require_user
+ ---- | 0009 | from finnos.lib.db import db
+ ---- | 0010 | from finnos.lib.stats import aware, month_bounds
+ ---- | 0011 | from finnos.models.finnos import TransactionIn, TransactionOut, TxStatus, TxType
+ ---- | 0012 | from finnos.routers.auth import require_user
= 0014 | 0013 | 
= 0015 | 0014 | router = APIRouter(prefix="/transactions", tags=["transactions"])
= 0016 | 0015 | 
= 0017 | 0016 | 
= 0018 | 0017 | async def _ref_maps(user_id: str) -> tuple[dict, dict]:
= 0019 | 0018 |     accounts = await db.accounts.find({"user_id": user_id}).to_list(500)
= 0020 | 0019 |     categories = await db.categories.find({"user_id": user_id}).to_list(500)
- 0021 | ---- |     return {a["id"]: a for a in accounts}, {c["id"]: c for c in categories}
+ ---- | 0020 |     return ({a["id"]: a for a in accounts}, {c["id"]: c for c in categories})
= 0022 | 0021 | 
= 0023 | 0022 | 
= 0024 | 0023 | async def _cards_by_id(user_id: str) -> dict:
= 0025 | 0024 |     cards = await db.cards.find({"user_id": user_id}).to_list(200)
= 0026 | 0025 |     return {c["id"]: c for c in cards}
= 0027 | 0026 | 
= 0028 | 0027 | 
= 0029 | 0028 | def enrich_transaction(
- 0030 | ---- |     doc: dict, accounts_by_id: dict, categories_by_id: dict, cards_by_id: dict | None = None
+ ---- | 0029 |     doc: dict,
+ ---- | 0030 |     accounts_by_id: dict,
+ ---- | 0031 |     categories_by_id: dict,
+ ---- | 0032 |     cards_by_id: dict | None = None,
= 0031 | 0033 | ) -> TransactionOut:
= 0032 | 0034 |     account = accounts_by_id.get(doc["account_id"], {})
= 0033 | 0035 |     to_account = accounts_by_id.get(doc.get("to_account_id") or "", {})
= 0034 | 0036 |     category = categories_by_id.get(doc.get("category_id") or "", {})
= 0035 | 0037 |     return TransactionOut(
+ ---- | 0038 |         version=doc.get("version", 1),
+ ---- | 0039 |         invoice_payment=doc.get("invoice_payment", False),
= 0036 | 0040 |         id=doc["id"],
= 0037 | 0041 |         name=doc["name"],
- 0038 | ---- |         value=float(doc["value"]),
+ ---- | 0042 |         value=D(doc["value"]),
= 0039 | 0043 |         type=doc["type"],
= 0040 | 0044 |         status=doc.get("status", "pago"),
= 0041 | 0045 |         date=doc["date"],
= 0042 | 0046 |         account_id=doc["account_id"],
= 0043 | 0047 |         account_name=account.get("name", ""),
= 0044 | 0048 |         card_id=doc.get("card_id"),
- 0045 | ---- |         card_name=(cards_by_id or {}).get(doc.get("card_id") or "", {}).get("name") or None,
+ ---- | 0049 |         card_name=(cards_by_id or {}).get(doc.get("card_id") or "", {}).get("name")
+ ---- | 0050 |         or None,
= 0046 | 0051 |         to_account_id=doc.get("to_account_id"),
= 0047 | 0052 |         to_account_name=to_account.get("name") or None,
= 0048 | 0053 |         category_id=doc.get("category_id"),
= 0049 | 0054 |         category_name=category.get("name") or None,
= 0050 | 0055 |         category_color=category.get("color") or None,
= 0051 | 0056 |         category_icon=category.get("icon") or None,
= 0052 | 0057 |         fixed=doc.get("fixed", False),
= 0053 | 0058 |         recurrence=doc.get("recurrence"),
= 0054 | 0059 |         installment=doc.get("installment", False),
= 0055 | 0060 |         total_installments=doc.get("total_installments"),
= 0056 | 0061 |         current_installment=doc.get("current_installment"),
= 0057 | 0062 |         installment_value=doc.get("installment_value"),
= 0058 | 0063 |         adjusted_value=doc.get("adjusted_value"),
= 0059 | 0064 |         attachment=doc.get("attachment"),
= 0060 | 0065 |         notes=doc.get("notes"),
= 0061 | 0066 |         notify_enabled=doc.get("notify_enabled", True),
= 0062 | 0067 |         created_at=aware(doc.get("created_at")) or datetime.now(timezone.utc),
= 0063 | 0068 |     )
= 0064 | 0069 | 
= 0065 | 0070 | 
= 0066 | 0071 | async def _validate(user_id: str, payload: TransactionIn) -> None:
= 0067 | 0072 |     accounts_by_id, categories_by_id = await _ref_maps(user_id)
+ ---- | 0073 |     from datetime import date
+ ---- | 0074 | 
+ ---- | 0075 |     try:
+ ---- | 0076 |         date.fromisoformat(payload.date)
+ ---- | 0077 |     except ValueError:
+ ---- | 0078 |         raise HTTPException(422, "Data inválida.")
= 0068 | 0079 |     if payload.account_id not in accounts_by_id:
- 0069 | ---- |         raise HTTPException(status_code=400, detail="Conta inválida: selecione uma conta cadastrada.")
+ ---- | 0080 |         raise HTTPException(
+ ---- | 0081 |             status_code=400, detail="Conta inválida: selecione uma conta cadastrada."
+ ---- | 0082 |         )
= 0070 | 0083 |     if payload.type == "transferencia":
+ ---- | 0084 |         if payload.card_id or payload.installment:
+ ---- | 0085 |             raise HTTPException(400, "Transferência não pode ter cartão ou parcelas.")
= 0071 | 0086 |         if not payload.to_account_id or payload.to_account_id == payload.account_id:
- 0072 | ---- |             raise HTTPException(status_code=400, detail="Escolha contas diferentes para a transferência.")
+ ---- | 0087 |             raise HTTPException(
+ ---- | 0088 |                 status_code=400,
+ ---- | 0089 |                 detail="Escolha contas diferentes para a transferência.",
+ ---- | 0090 |             )
= 0073 | 0091 |         if payload.to_account_id not in accounts_by_id:
= 0074 | 0092 |             raise HTTPException(status_code=400, detail="Conta de destino inválida.")
= 0075 | 0093 |     if payload.category_id and payload.category_id not in categories_by_id:
= 0076 | 0094 |         raise HTTPException(status_code=400, detail="Categoria inválida.")
= 0077 | 0095 |     if payload.card_id:
= 0078 | 0096 |         card = await db.cards.find_one({"id": payload.card_id, "user_id": user_id})
= 0079 | 0097 |         if not card:
- 0080 | ---- |             raise HTTPException(status_code=400, detail="Cartão inválido: selecione um cartão cadastrado.")
+ ---- | 0098 |             raise HTTPException(
+ ---- | 0099 |                 status_code=400,
+ ---- | 0100 |                 detail="Cartão inválido: selecione um cartão cadastrado.",
+ ---- | 0101 |             )
= 0081 | 0102 |     if payload.installment:
+ ---- | 0103 |         if payload.current_installment and payload.current_installment > (
+ ---- | 0104 |             payload.total_installments or 0
+ ---- | 0105 |         ):
+ ---- | 0106 |             raise HTTPException(400, "Parcela atual inválida.")
= 0082 | 0107 |         if payload.type != "despesa":
- 0083 | ---- |             raise HTTPException(status_code=400, detail="Somente despesas podem ser parceladas.")
+ ---- | 0108 |             raise HTTPException(
+ ---- | 0109 |                 status_code=400, detail="Somente despesas podem ser parceladas."
+ ---- | 0110 |             )
= 0084 | 0111 |         if not payload.total_installments or payload.total_installments < 2:
- 0085 | ---- |             raise HTTPException(status_code=400, detail="Informe o número total de parcelas (mínimo 2).")
+ ---- | 0112 |             raise HTTPException(
+ ---- | 0113 |                 status_code=400, detail="Informe o número total de parcelas (mínimo 2)."
+ ---- | 0114 |             )
= 0086 | 0115 | 
= 0087 | 0116 | 
= 0088 | 0117 | def _document(user_id: str, payload: TransactionIn) -> dict:
- 0089 | ---- |     total = round(payload.adjusted_value if payload.adjusted_value else payload.value, 2)
+ ---- | 0118 |     total = round(
+ ---- | 0119 |         payload.adjusted_value if payload.adjusted_value else payload.value, 2
+ ---- | 0120 |     )
= 0090 | 0121 |     doc: dict = {
= 0091 | 0122 |         "id": str(uuid.uuid4()),
= 0092 | 0123 |         "user_id": user_id,
= 0093 | 0124 |         "name": payload.name.strip(),
= 0094 | 0125 |         "value": total,
= 0095 | 0126 |         "type": payload.type,
= 0096 | 0127 |         "status": payload.status,
= 0097 | 0128 |         "date": payload.date,
= 0098 | 0129 |         "account_id": payload.account_id,
= 0099 | 0130 |         "card_id": payload.card_id if payload.type == "despesa" else None,
- 0100 | ---- |         "to_account_id": payload.to_account_id if payload.type == "transferencia" else None,
+ ---- | 0131 |         "to_account_id": (
+ ---- | 0132 |             payload.to_account_id if payload.type == "transferencia" else None
+ ---- | 0133 |         ),
= 0101 | 0134 |         "category_id": payload.category_id,
= 0102 | 0135 |         "fixed": payload.fixed,
- 0103 | ---- |         "recurrence": (payload.recurrence or "mensal") if payload.fixed else None,
+ ---- | 0136 |         "recurrence": payload.recurrence or "mensal" if payload.fixed else None,
= 0104 | 0137 |         "installment": payload.installment,
- 0105 | ---- |         "total_installments": payload.total_installments if payload.installment else None,
- 0106 | ---- |         "current_installment": (payload.current_installment or 1) if payload.installment else None,
- 0107 | ---- |         "installment_value": round(total / payload.total_installments, 2) if payload.installment else None,
+ ---- | 0138 |         "total_installments": (
+ ---- | 0139 |             payload.total_installments if payload.installment else None
+ ---- | 0140 |         ),
+ ---- | 0141 |         "current_installment": (
+ ---- | 0142 |             payload.current_installment or 1 if payload.installment else None
+ ---- | 0143 |         ),
+ ---- | 0144 |         "installment_value": (
+ ---- | 0145 |             (total / payload.total_installments).quantize(
+ ---- | 0146 |                 D("0.01"), rounding="ROUND_HALF_UP"
+ ---- | 0147 |             )
+ ---- | 0148 |             if payload.installment
+ ---- | 0149 |             else None
+ ---- | 0150 |         ),
= 0108 | 0151 |         "adjusted_value": payload.adjusted_value,
= 0109 | 0152 |         "attachment": payload.attachment,
= 0110 | 0153 |         "notes": payload.notes,
= 0111 | 0154 |         "notify_enabled": payload.notify_enabled,
= 0112 | 0155 |         "created_at": datetime.now(timezone.utc),
= 0113 | 0156 |         "updated_at": datetime.now(timezone.utc),
= 0114 | 0157 |     }
= 0115 | 0158 |     return doc
= 0116 | 0159 | 
= 0117 | 0160 | 
= 0118 | 0161 | @router.get("", response_model=List[TransactionOut])
= 0119 | 0162 | async def list_transactions(
- 0120 | ---- |     month: Optional[str] = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
- 0121 | ---- |     start_date: Optional[str] = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
- 0122 | ---- |     end_date: Optional[str] = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
+ ---- | 0163 |     month: Optional[str] = Query(default=None, pattern="^\\d{4}-\\d{2}$"),
+ ---- | 0164 |     start_date: Optional[str] = Query(default=None, pattern="^\\d{4}-\\d{2}-\\d{2}$"),
+ ---- | 0165 |     end_date: Optional[str] = Query(default=None, pattern="^\\d{4}-\\d{2}-\\d{2}$"),
= 0123 | 0166 |     type: Optional[TxType] = Query(default=None),
= 0124 | 0167 |     status: Optional[TxStatus] = Query(default=None),
= 0125 | 0168 |     category_id: Optional[str] = Query(default=None),
= 0126 | 0169 |     account_id: Optional[str] = Query(default=None),
= 0127 | 0170 |     search: Optional[str] = Query(default=None, max_length=80),
= 0128 | 0171 |     user: dict = Depends(require_user),
= 0129 | 0172 | ) -> list[TransactionOut]:
= 0130 | 0173 |     query: dict = {"user_id": user["id"]}
= 0131 | 0174 |     if start_date or end_date:
= 0132 | 0175 |         date_filter: dict = {}
= 0133 | 0176 |         if start_date:
= 0134 | 0177 |             date_filter["$gte"] = start_date
= 0135 | 0178 |         if end_date:
= 0136 | 0179 |             date_filter["$lte"] = end_date
= 0137 | 0180 |         query["date"] = date_filter
= 0138 | 0181 |     elif month:
= 0139 | 0182 |         start, end = month_bounds(month)
= 0140 | 0183 |         query["date"] = {"$gte": start, "$lte": end}
= 0141 | 0184 |     if type:
= 0142 | 0185 |         query["type"] = type
= 0143 | 0186 |     if status:
= 0144 | 0187 |         query["status"] = status
= 0145 | 0188 |     if category_id:
= 0146 | 0189 |         query["category_id"] = category_id
= 0147 | 0190 |     if account_id:
= 0148 | 0191 |         query["$or"] = [{"account_id": account_id}, {"to_account_id": account_id}]
= 0149 | 0192 |     if search and search.strip():
= 0150 | 0193 |         query["name"] = {"$regex": re.escape(search.strip()), "$options": "i"}
- 0151 | ---- | 
= 0152 | 0194 |     docs = (
= 0153 | 0195 |         await db.transactions.find(query)
= 0154 | 0196 |         .sort([("date", -1), ("created_at", -1)])
= 0155 | 0197 |         .to_list(2000)
= 0156 | 0198 |     )
= 0157 | 0199 |     accounts_by_id, categories_by_id = await _ref_maps(user["id"])
= 0158 | 0200 |     cards_by_id = await _cards_by_id(user["id"])
- 0159 | ---- |     return [enrich_transaction(d, accounts_by_id, categories_by_id, cards_by_id) for d in docs]
+ ---- | 0201 |     return [
+ ---- | 0202 |         enrich_transaction(d, accounts_by_id, categories_by_id, cards_by_id)
+ ---- | 0203 |         for d in docs
+ ---- | 0204 |     ]
= 0160 | 0205 | 
= 0161 | 0206 | 
= 0162 | 0207 | @router.post("", response_model=TransactionOut, status_code=201)
= 0163 | 0208 | async def create_transaction(
= 0164 | 0209 |     payload: TransactionIn,
= 0165 | 0210 |     user: dict = Depends(require_user),
= 0166 | 0211 |     x_finnos_operation_id: Optional[str] = Header(default=None),
= 0167 | 0212 |     x_finnos_source: Optional[str] = Header(default="manual"),
= 0168 | 0213 | ) -> TransactionOut:
- 0169 | ---- |     if x_finnos_operation_id:
- 0170 | ---- |         existing = await db.transactions.find_one({"user_id": user["id"], "operation_id": x_finnos_operation_id})
- 0171 | ---- |         if existing:
- 0172 | ---- |             accounts_by_id, categories_by_id = await _ref_maps(user["id"])
- 0173 | ---- |             return enrich_transaction(existing, accounts_by_id, categories_by_id, await _cards_by_id(user["id"]))
= 0174 | 0214 |     await _validate(user["id"], payload)
= 0175 | 0215 |     doc = _document(user["id"], payload)
= 0176 | 0216 |     doc["operation_id"] = x_finnos_operation_id
= 0177 | 0217 |     doc["source"] = x_finnos_source or "manual"
= 0178 | 0218 |     await db.transactions.insert_one(doc)
= 0179 | 0219 |     accounts_by_id, categories_by_id = await _ref_maps(user["id"])
- 0180 | ---- |     return enrich_transaction(doc, accounts_by_id, categories_by_id, await _cards_by_id(user["id"]))
+ ---- | 0220 |     return enrich_transaction(
+ ---- | 0221 |         doc, accounts_by_id, categories_by_id, await _cards_by_id(user["id"])
+ ---- | 0222 |     )
= 0181 | 0223 | 
= 0182 | 0224 | 
= 0183 | 0225 | @router.put("/{tx_id}", response_model=TransactionOut)
= 0184 | 0226 | async def update_transaction(
= 0185 | 0227 |     tx_id: str,
= 0186 | 0228 |     payload: TransactionIn,
= 0187 | 0229 |     user: dict = Depends(require_user),
= 0188 | 0230 |     x_finnos_operation_id: Optional[str] = Header(default=None),
+ ---- | 0231 |     x_finnos_base_version: Optional[int] = Header(default=None),
= 0189 | 0232 |     x_finnos_source: Optional[str] = Header(default="manual"),
= 0190 | 0233 | ) -> TransactionOut:
- 0191 | ---- |     if x_finnos_operation_id:
- 0192 | ---- |         replay = await db.transactions.find_one({"id": tx_id, "user_id": user["id"], "operation_id": x_finnos_operation_id})
- 0193 | ---- |         if replay:
- 0194 | ---- |             accounts_by_id, categories_by_id = await _ref_maps(user["id"])
- 0195 | ---- |             return enrich_transaction(replay, accounts_by_id, categories_by_id, await _cards_by_id(user["id"]))
- 0196 | ---- |     await _validate(user["id"], payload)
= 0197 | 0234 |     existing = await db.transactions.find_one({"id": tx_id, "user_id": user["id"]})
= 0198 | 0235 |     if not existing:
= 0199 | 0236 |         raise HTTPException(status_code=404, detail="Transação não encontrada.")
+ ---- | 0237 |     await _validate(user["id"], payload)
= 0200 | 0238 |     doc = _document(user["id"], payload)
- 0201 | ---- |     doc["id"] = tx_id  # the id is stable across edits — regenerating it orphans the record
+ ---- | 0239 |     doc["id"] = tx_id
= 0202 | 0240 |     doc["created_at"] = existing.get("created_at")
= 0203 | 0241 |     doc["operation_id"] = x_finnos_operation_id
+ ---- | 0242 |     doc["_expected_version"] = x_finnos_base_version
= 0204 | 0243 |     doc["source"] = x_finnos_source or "manual"
- 0205 | ---- |     await db.transactions.replace_one({"_id": existing["_id"]}, doc)
+ ---- | 0244 |     await db.transactions.replace_one({"id": tx_id, "user_id": user["id"]}, doc)
+ ---- | 0245 |     doc = await db.transactions.find_one({"id":tx_id,"user_id":user["id"]})
= 0206 | 0246 |     accounts_by_id, categories_by_id = await _ref_maps(user["id"])
- 0207 | ---- |     return enrich_transaction(doc, accounts_by_id, categories_by_id, await _cards_by_id(user["id"]))
+ ---- | 0247 |     return enrich_transaction(
+ ---- | 0248 |         doc, accounts_by_id, categories_by_id, await _cards_by_id(user["id"])
+ ---- | 0249 |     )
= 0208 | 0250 | 
= 0209 | 0251 | 
= 0210 | 0252 | @router.delete("/{tx_id}", status_code=204)
= 0211 | 0253 | async def delete_transaction(tx_id: str, user: dict = Depends(require_user)) -> None:
= 0212 | 0254 |     result = await db.transactions.delete_one({"id": tx_id, "user_id": user["id"]})
= 0213 | 0255 |     if not result.deleted_count:
= 0214 | 0256 |         raise HTTPException(status_code=404, detail="Transação não encontrada.")
= 0215 | 0257 | 
+ ---- | 0258 | 
+ ---- | 0259 | @router.get("/{tx_id}", response_model=TransactionOut)
+ ---- | 0260 | async def get_transaction(tx_id: str, user: dict = Depends(require_user)):
+ ---- | 0261 |     doc = await db.transactions.find_one({"user_id": user["id"], "id": tx_id})
+ ---- | 0262 |     if not doc:
+ ---- | 0263 |         raise HTTPException(404, "Transação não encontrada.")
+ ---- | 0264 |     accounts, categories = await _ref_maps(user["id"])
+ ---- | 0265 |     return enrich_transaction(doc, accounts, categories, await _cards_by_id(user["id"]))
+ ---- | 0266 | 
```


## backend/routers/cards.py ↔ frontend/finnos/routers/cards.py

Linhas legado 267; ativo 187.

```text
L---- | F---- | código
- 0001 | ---- | """Credit cards: CRUD plus the derived invoice/limit/cycle numbers for each card."""
+ ---- | 0001 | from finnos.lib.money import D, installment_portion
= 0002 | 0002 | 
+ ---- | 0003 | """Credit cards: CRUD plus the derived invoice/limit/cycle numbers for each card."""
= 0003 | 0004 | import uuid
= 0004 | 0005 | from datetime import date, datetime, timezone
= 0005 | 0006 | from typing import List
- 0006 | ---- | 
- 0007 | ---- | from fastapi import APIRouter, Depends, HTTPException, Response
- 0008 | ---- | 
- 0009 | ---- | from lib.cards import best_purchase_day, cycle_bounds, due_date
- 0010 | ---- | from lib.db import db
- 0011 | ---- | from lib.dates import today_iso
- 0012 | ---- | from lib.stats import aware, months_between
- 0013 | ---- | from models.cards import CardIn, CardOut
- 0014 | ---- | from models.notify import Invoice, InvoiceItem, PayInvoiceIn
- 0015 | ---- | from routers.auth import require_user
+ ---- | 0007 | from fastapi import APIRouter, Depends, HTTPException, Response, Header, Query
+ ---- | 0008 | from finnos.lib.cards import best_purchase_day, cycle_bounds, due_date
+ ---- | 0009 | from finnos.lib.db import db
+ ---- | 0010 | from finnos.lib.dates import today_iso
+ ---- | 0011 | from finnos.lib.stats import aware, months_between
+ ---- | 0012 | from finnos.models.cards import CardIn, CardOut
+ ---- | 0013 | from finnos.models.notify import Invoice, InvoiceItem, PayInvoiceIn
+ ---- | 0014 | from finnos.routers.auth import require_user
= 0016 | 0015 | 
= 0017 | 0016 | router = APIRouter(prefix="/cards", tags=["cards"])
= 0018 | 0017 | 
= 0019 | 0018 | 
= 0020 | 0019 | def _occurrence_value(tx: dict) -> float:
= 0021 | 0020 |     if tx.get("installment"):
- 0022 | ---- |         return round(float(tx.get("installment_value") or 0.0), 2)
- 0023 | ---- |     return round(float(tx["value"]), 2)
+ ---- | 0021 |         return round(D(tx.get("installment_value") or D("0.0")), 2)
+ ---- | 0022 |     return round(D(tx["value"]), 2)
= 0024 | 0023 | 
= 0025 | 0024 | 
= 0026 | 0025 | async def _build(doc: dict, txs: List[dict], accounts: dict) -> CardOut:
= 0027 | 0026 |     today = date.fromisoformat(today_iso())
= 0028 | 0027 |     start, closing = cycle_bounds(today, doc["closing_day"])
= 0029 | 0028 |     due = due_date(closing, doc["closing_day"], doc["due_day"])
= 0030 | 0029 |     best = best_purchase_day(closing)
- 0031 | ---- | 
- 0032 | ---- |     invoice = 0.0
- 0033 | ---- |     future = 0.0
- 0034 | ---- |     for tx in txs:
- 0035 | ---- |         if tx.get("card_id") != doc["id"] or tx.get("type") != "despesa":
- 0036 | ---- |             continue
- 0037 | ---- |         value = _occurrence_value(tx)
- 0038 | ---- |         tx_date = tx["date"]
- 0039 | ---- |         if tx.get("installment"):
- 0040 | ---- |             total = int(tx.get("total_installments") or 1)
- 0041 | ---- |             # One installment lands in the open cycle; the rest is limit already committed.
- 0042 | ---- |             offset = months_between(tx_date[:7], closing.strftime("%Y-%m"))
- 0043 | ---- |             if 0 <= offset < total:
- 0044 | ---- |                 invoice += value
- 0045 | ---- |             remaining = max(total - max(offset + 1, 0), 0)
- 0046 | ---- |             future += value * remaining
- 0047 | ---- |         elif start.isoformat() <= tx_date <= closing.isoformat():
- 0048 | ---- |             invoice += value
- 0049 | ---- | 
- 0050 | ---- |     limit = float(doc["limit"])
- 0051 | ---- |     used = round(invoice + future, 2)
+ ---- | 0030 |     from finnos.lib.invoices import commitment, invoice_state
+ ---- | 0031 |     current, future_cents, used_cents = commitment(doc, txs, closing.isoformat())
+ ---- | 0032 |     invoice, future, used = D(current)/100, D(future_cents)/100, D(used_cents)/100
+ ---- | 0033 |     limit = D(doc["limit"])
= 0052 | 0034 |     account = accounts.get(doc.get("payment_account_id") or "", {})
- 0053 | ---- | 
= 0054 | 0035 |     return CardOut(
= 0055 | 0036 |         id=doc["id"],
= 0056 | 0037 |         name=doc["name"],
= 0057 | 0038 |         institution=doc.get("institution", ""),
= 0058 | 0039 |         color=doc.get("color", "#5B3FE4"),
= 0059 | 0040 |         limit=round(limit, 2),
= 0060 | 0041 |         closing_day=doc["closing_day"],
= 0061 | 0042 |         due_day=doc["due_day"],
= 0062 | 0043 |         payment_account_id=doc.get("payment_account_id"),
= 0063 | 0044 |         payment_account_name=account.get("name") or None,
= 0064 | 0045 |         active=doc.get("active", True),
- 0065 | ---- |         invoice_paid=bool((doc.get("paid_cycles") or {}).get(closing.isoformat())),
+ ---- | 0046 |         invoice_paid=invoice_state(doc, txs, closing.isoformat())["paid"],
= 0066 | 0047 |         current_invoice=round(invoice, 2),
= 0067 | 0048 |         future_installments=round(future, 2),
= 0068 | 0049 |         used=used,
- 0069 | ---- |         available=round(max(limit - used, 0.0), 2),
- 0070 | ---- |         used_percent=round(used / limit * 100, 1) if limit else 0.0,
+ ---- | 0050 |         available=round(max(limit - used, D("0.0")), 2),
+ ---- | 0051 |         used_percent=round(used / limit * 100, 1) if limit else D("0.0"),
= 0071 | 0052 |         cycle_start=start.isoformat(),
= 0072 | 0053 |         next_closing=closing.isoformat(),
= 0073 | 0054 |         next_due=due.isoformat(),
= 0074 | 0055 |         best_purchase_day=best.isoformat(),
= 0075 | 0056 |         created_at=aware(doc.get("created_at")) or datetime.now(timezone.utc),
= 0076 | 0057 |     )
= 0077 | 0058 | 
= 0078 | 0059 | 
= 0079 | 0060 | async def _context(user_id: str) -> tuple[List[dict], dict]:
- 0080 | ---- |     txs = await db.transactions.find({"user_id": user_id, "card_id": {"$ne": None}}).to_list(20000)
+ ---- | 0061 |     txs = await db.transactions.find(
+ ---- | 0062 |         {"user_id": user_id, "card_id": {"$ne": None}}
+ ---- | 0063 |     ).to_list(20000)
= 0081 | 0064 |     accounts = await db.accounts.find({"user_id": user_id}).to_list(500)
- 0082 | ---- |     return txs, {a["id"]: a for a in accounts}
+ ---- | 0065 |     return (txs, {a["id"]: a for a in accounts})
= 0083 | 0066 | 
= 0084 | 0067 | 
= 0085 | 0068 | @router.get("", response_model=List[CardOut])
= 0086 | 0069 | async def list_cards(user: dict = Depends(require_user)) -> List[CardOut]:
- 0087 | ---- |     docs = await db.cards.find({"user_id": user["id"]}).sort("created_at", 1).to_list(200)
+ ---- | 0070 |     docs = (
+ ---- | 0071 |         await db.cards.find({"user_id": user["id"]}).sort("created_at", 1).to_list(200)
+ ---- | 0072 |     )
= 0088 | 0073 |     txs, accounts = await _context(user["id"])
= 0089 | 0074 |     return [await _build(doc, txs, accounts) for doc in docs]
= 0090 | 0075 | 
= 0091 | 0076 | 
= 0092 | 0077 | @router.post("", response_model=CardOut, status_code=201)
= 0093 | 0078 | async def create_card(payload: CardIn, user: dict = Depends(require_user)) -> CardOut:
- 0094 | ---- |     if payload.payment_account_id:
- 0095 | ---- |         exists = await db.accounts.find_one({"id": payload.payment_account_id, "user_id": user["id"]})
- 0096 | ---- |         if not exists:
- 0097 | ---- |             raise HTTPException(status_code=400, detail="Conta de pagamento inválida.")
+ ---- | 0079 |     """Create a UID-scoped Firestore card, checking payment account ownership atomically."""
= 0098 | 0080 |     doc = {
= 0099 | 0081 |         "id": str(uuid.uuid4()),
= 0100 | 0082 |         "user_id": user["id"],
= 0101 | 0083 |         **payload.model_dump(),
= 0102 | 0084 |         "created_at": datetime.now(timezone.utc),
+ ---- | 0085 |         "updated_at": datetime.now(timezone.utc),
= 0103 | 0086 |     }
= 0104 | 0087 |     await db.cards.insert_one(doc)
= 0105 | 0088 |     txs, accounts = await _context(user["id"])
= 0106 | 0089 |     return await _build(doc, txs, accounts)
= 0107 | 0090 | 
= 0108 | 0091 | 
= 0109 | 0092 | @router.put("/{card_id}", response_model=CardOut)
= 0110 | 0093 | async def update_card(card_id: str, payload: CardIn, user: dict = Depends(require_user)) -> CardOut:
- 0111 | ---- |     existing = await db.cards.find_one({"id": card_id, "user_id": user["id"]})
- 0112 | ---- |     if not existing:
- 0113 | ---- |         raise HTTPException(status_code=404, detail="Cartão não encontrado.")
- 0114 | ---- |     if payload.payment_account_id:
- 0115 | ---- |         account = await db.accounts.find_one({"id": payload.payment_account_id, "user_id": user["id"]})
- 0116 | ---- |         if not account:
- 0117 | ---- |             raise HTTPException(status_code=400, detail="Conta de pagamento inválida.")
- 0118 | ---- |     # Patch in place: replacing the document would drop id/user_id/created_at.
- 0119 | ---- |     await db.cards.update_one({"id": card_id, "user_id": user["id"]}, {"$set": payload.model_dump()})
+ ---- | 0094 |     """Update only the authenticated user's card; preserve metadata and cycle state."""
+ ---- | 0095 |     result = await db.cards.update_one(
+ ---- | 0096 |         {"id": card_id, "user_id": user["id"]},
+ ---- | 0097 |         {"$set": {**payload.model_dump(), "updated_at": datetime.now(timezone.utc)}},
+ ---- | 0098 |     )
+ ---- | 0099 |     if not result.matched_count:
+ ---- | 0100 |         raise HTTPException(404, "Cartão não encontrado.")
= 0120 | 0101 |     doc = await db.cards.find_one({"id": card_id, "user_id": user["id"]})
= 0121 | 0102 |     txs, accounts = await _context(user["id"])
= 0122 | 0103 |     return await _build(doc, txs, accounts)
= 0123 | 0104 | 
= 0124 | 0105 | 
= 0125 | 0106 | @router.delete("/{card_id}", status_code=204, response_class=Response)
= 0126 | 0107 | async def delete_card(card_id: str, user: dict = Depends(require_user)) -> Response:
+ ---- | 0108 |     """Reject deletion when linked transactions exist; never orphan card references."""
= 0127 | 0109 |     result = await db.cards.delete_one({"id": card_id, "user_id": user["id"]})
- 0128 | ---- |     if result.deleted_count == 0:
- 0129 | ---- |         raise HTTPException(status_code=404, detail="Cartão não encontrado.")
- 0130 | ---- |     # Transactions survive the card; they just stop being tagged.
- 0131 | ---- |     await db.transactions.update_many(
- 0132 | ---- |         {"user_id": user["id"], "card_id": card_id}, {"$set": {"card_id": None}}
- 0133 | ---- |     )
+ ---- | 0110 |     if not result.deleted_count:
+ ---- | 0111 |         raise HTTPException(404, "Cartão não encontrado.")
= 0134 | 0112 |     return Response(status_code=204)
= 0135 | 0113 | 
= 0136 | 0114 | 
- 0137 | ---- | # --- Fatura detalhada + pagamento ------------------------------------------
- 0138 | ---- | 
- 0139 | ---- | 
- 0140 | ---- | def _cycle_items(card: dict, txs: List[dict], categories: dict, start: str, closing: str) -> List[InvoiceItem]:
- 0141 | ---- |     items: List[InvoiceItem] = []
- 0142 | ---- |     for tx in txs:
- 0143 | ---- |         if tx.get("card_id") != card["id"] or tx.get("type") != "despesa":
- 0144 | ---- |             continue
- 0145 | ---- |         value = _occurrence_value(tx)
- 0146 | ---- |         category = categories.get(tx.get("category_id") or "", {})
- 0147 | ---- |         if tx.get("installment"):
- 0148 | ---- |             total = int(tx.get("total_installments") or 1)
- 0149 | ---- |             offset = months_between(tx["date"][:7], closing[:7])
- 0150 | ---- |             if not (0 <= offset < total):
- 0151 | ---- |                 continue
- 0152 | ---- |             current = (int(tx.get("current_installment") or 1) - 1 + offset) % max(total, 1) + 1
- 0153 | ---- |             label = f"{min(current, total)}/{total}"
- 0154 | ---- |         elif start <= tx["date"] <= closing:
- 0155 | ---- |             label = None
- 0156 | ---- |         else:
- 0157 | ---- |             continue
- 0158 | ---- |         items.append(
- 0159 | ---- |             InvoiceItem(
- 0160 | ---- |                 id=tx["id"],
- 0161 | ---- |                 name=tx["name"],
- 0162 | ---- |                 date=tx["date"],
- 0163 | ---- |                 value=value,
- 0164 | ---- |                 category_name=category.get("name"),
- 0165 | ---- |                 category_color=category.get("color"),
- 0166 | ---- |                 installment_label=label,
- 0167 | ---- |             )
- 0168 | ---- |         )
- 0169 | ---- |     items.sort(key=lambda i: i.date, reverse=True)
- 0170 | ---- |     return items
- 0171 | ---- | 
- 0172 | ---- | 
= 0173 | 0115 | @router.get("/{card_id}/invoice", response_model=Invoice)
- 0174 | ---- | async def card_invoice(card_id: str, user: dict = Depends(require_user)) -> Invoice:
- 0175 | ---- |     """Everything inside the open cycle of this card, newest first."""
+ ---- | 0116 | async def card_invoice(card_id: str, cycle: str | None = Query(None), user: dict = Depends(require_user)):
+ ---- | 0117 |     from finnos.lib.invoices import invoice_state, output
= 0176 | 0118 |     card = await db.cards.find_one({"id": card_id, "user_id": user["id"]})
= 0177 | 0119 |     if not card:
- 0178 | ---- |         raise HTTPException(status_code=404, detail="Cartão não encontrado.")
- 0179 | ---- |     today = date.fromisoformat(today_iso())
- 0180 | ---- |     start, closing = cycle_bounds(today, card["closing_day"])
- 0181 | ---- |     due = due_date(closing, card["closing_day"], card["due_day"])
- 0182 | ---- | 
- 0183 | ---- |     txs = await db.transactions.find({"user_id": user["id"], "card_id": card_id}).to_list(5000)
+ ---- | 0120 |         raise HTTPException(404, "Cartão não encontrado.")
+ ---- | 0121 |     closing = cycle or cycle_bounds(date.fromisoformat(today_iso()), card["closing_day"])[1].isoformat()
+ ---- | 0122 |     txs = await db.transactions.find({"user_id": user["id"], "card_id": card_id}).to_list(20000)
= 0184 | 0123 |     categories = {c["id"]: c for c in await db.categories.find({"user_id": user["id"]}).to_list(500)}
- 0185 | ---- |     items = _cycle_items(card, txs, categories, start.isoformat(), closing.isoformat())
- 0186 | ---- |     paid = (card.get("paid_cycles") or {}).get(closing.isoformat())
- 0187 | ---- | 
- 0188 | ---- |     return Invoice(
- 0189 | ---- |         card_id=card_id,
- 0190 | ---- |         card_name=card["name"],
- 0191 | ---- |         cycle_start=start.isoformat(),
- 0192 | ---- |         cycle_end=closing.isoformat(),
- 0193 | ---- |         due_date=due.isoformat(),
- 0194 | ---- |         total=round(sum(i.value for i in items), 2),
- 0195 | ---- |         paid=bool(paid),
- 0196 | ---- |         paid_amount=round(float((paid or {}).get("amount", 0.0)), 2),
- 0197 | ---- |         paid_at=(paid or {}).get("paid_at"),
- 0198 | ---- |         items=items,
- 0199 | ---- |     )
+ ---- | 0124 |     try:
+ ---- | 0125 |         return output(invoice_state(card, txs, closing, categories))
+ ---- | 0126 |     except ValueError as exc:
+ ---- | 0127 |         raise HTTPException(422, str(exc))
= 0200 | 0128 | 
= 0201 | 0129 | 
= 0202 | 0130 | @router.post("/{card_id}/pay", response_model=Invoice)
- 0203 | ---- | async def pay_invoice(card_id: str, payload: PayInvoiceIn, user: dict = Depends(require_user)) -> Invoice:
- 0204 | ---- |     """Mark the open invoice as paid and post the debit on the chosen account.
- 0205 | ---- | 
- 0206 | ---- |     The debit is a normal "despesa" with no card tag, so it never re-enters a fatura.
- 0207 | ---- |     """
- 0208 | ---- |     card = await db.cards.find_one({"id": card_id, "user_id": user["id"]})
- 0209 | ---- |     if not card:
- 0210 | ---- |         raise HTTPException(status_code=404, detail="Cartão não encontrado.")
- 0211 | ---- |     account = await db.accounts.find_one({"id": payload.account_id, "user_id": user["id"]})
- 0212 | ---- |     if not account:
- 0213 | ---- |         raise HTTPException(status_code=400, detail="Conta inválida: selecione uma conta cadastrada.")
- 0214 | ---- | 
- 0215 | ---- |     today = date.fromisoformat(today_iso())
- 0216 | ---- |     start, closing = cycle_bounds(today, card["closing_day"])
- 0217 | ---- |     cycle_key = closing.isoformat()
- 0218 | ---- |     if (card.get("paid_cycles") or {}).get(cycle_key):
- 0219 | ---- |         raise HTTPException(status_code=400, detail="Esta fatura já está marcada como paga.")
- 0220 | ---- | 
- 0221 | ---- |     txs = await db.transactions.find({"user_id": user["id"], "card_id": card_id}).to_list(5000)
- 0222 | ---- |     categories = {c["id"]: c for c in await db.categories.find({"user_id": user["id"]}).to_list(500)}
- 0223 | ---- |     items = _cycle_items(card, txs, categories, start.isoformat(), cycle_key)
- 0224 | ---- |     amount = round(payload.value if payload.value else sum(i.value for i in items), 2)
- 0225 | ---- |     if amount <= 0:
- 0226 | ---- |         raise HTTPException(status_code=400, detail="Não há valor em aberto nesta fatura.")
- 0227 | ---- | 
- 0228 | ---- |     now = datetime.now(timezone.utc)
- 0229 | ---- |     debit = {
- 0230 | ---- |         "id": str(uuid.uuid4()),
- 0231 | ---- |         "user_id": user["id"],
- 0232 | ---- |         "name": f"Fatura {card['name']}",
- 0233 | ---- |         "value": amount,
- 0234 | ---- |         "type": "despesa",
- 0235 | ---- |         "status": "pago",
- 0236 | ---- |         "date": payload.date,
- 0237 | ---- |         "account_id": payload.account_id,
- 0238 | ---- |         "card_id": None,
- 0239 | ---- |         "to_account_id": None,
- 0240 | ---- |         "category_id": None,
- 0241 | ---- |         "fixed": False,
- 0242 | ---- |         "recurrence": None,
- 0243 | ---- |         "installment": False,
- 0244 | ---- |         "total_installments": None,
- 0245 | ---- |         "current_installment": None,
- 0246 | ---- |         "installment_value": None,
- 0247 | ---- |         "adjusted_value": None,
- 0248 | ---- |         "attachment": None,
- 0249 | ---- |         "notes": f"Pagamento da fatura fechada em {cycle_key}.",
- 0250 | ---- |         "created_at": now,
- 0251 | ---- |         "updated_at": now,
- 0252 | ---- |     }
- 0253 | ---- |     await db.transactions.insert_one(debit)
- 0254 | ---- |     await db.cards.update_one(
- 0255 | ---- |         {"id": card_id, "user_id": user["id"]},
- 0256 | ---- |         {
- 0257 | ---- |             "$set": {
- 0258 | ---- |                 f"paid_cycles.{cycle_key}": {
- 0259 | ---- |                     "amount": amount,
- 0260 | ---- |                     "transaction_id": debit["id"],
- 0261 | ---- |                     "paid_at": payload.date,
- 0262 | ---- |                 }
- 0263 | ---- |             }
- 0264 | ---- |         },
- 0265 | ---- |     )
- 0266 | ---- |     return await card_invoice(card_id, user)
+ ---- | 0131 | async def pay_invoice(card_id: str, payload: PayInvoiceIn, user: dict = Depends(require_user), x_finnos_operation_id: str = Header(...)):
+ ---- | 0132 |     from finnos.lib import db as store
+ ---- | 0133 |     from finnos.lib.invoices import invoice_state, output
+ ---- | 0134 |     from finnos.lib.invoice_payments import allocate_payment, to_cents
+ ---- | 0135 |     from starlette.concurrency import run_in_threadpool
+ ---- | 0136 |     import hashlib
+ ---- | 0137 |     if not 1 <= len(x_finnos_operation_id) <= 200:
+ ---- | 0138 |         raise HTTPException(422, "Identificador de operação inválido.")
+ ---- | 0139 |     try:
+ ---- | 0140 |         paid_on = date.fromisoformat(payload.date)
+ ---- | 0141 |     except ValueError:
+ ---- | 0142 |         raise HTTPException(422, "Data inválida.")
+ ---- | 0143 |     if paid_on > date.fromisoformat(today_iso()):
+ ---- | 0144 |         raise HTTPException(422, "Pagamento realizado não pode ter data futura.")
+ ---- | 0145 |     uid = store.scoped({"user_id":user["id"]})
+ ---- | 0146 |     request_key = {"card_id":card_id, "account_id":payload.account_id, "date":payload.date, "cycle":payload.cycle, "value_cents":None if payload.value is None else to_cents(payload.value)}
+ ---- | 0147 |     identifier = hashlib.sha256(x_finnos_operation_id.encode()).hexdigest()
+ ---- | 0148 |     def execute():
+ ---- | 0149 |         instance = store.client()
+ ---- | 0150 |         def action(tr):
+ ---- | 0151 |             owner = store.root(instance,uid)
+ ---- | 0152 |             card_ref = owner.collection("cards").document(store.resource_id(card_id))
+ ---- | 0153 |             snapshot = card_ref.get(transaction=tr)
+ ---- | 0154 |             if not snapshot.exists:
+ ---- | 0155 |                 raise HTTPException(404,"Cartão não encontrado.")
+ ---- | 0156 |             card = dict(store.decode(snapshot.to_dict()),id=card_id)
+ ---- | 0157 |             receipt_ref = owner.collection("invoice_payments").document(identifier)
+ ---- | 0158 |             receipt = receipt_ref.get(transaction=tr)
+ ---- | 0159 |             if receipt.exists:
+ ---- | 0160 |                 saved = receipt.to_dict()
+ ---- | 0161 |                 if saved["request"] != request_key:
+ ---- | 0162 |                     raise HTTPException(409,"Operação reutilizada com dados diferentes.")
+ ---- | 0163 |                 return output(saved["state"])
+ ---- | 0164 |             acc = owner.collection("accounts").document(store.resource_id(payload.account_id)).get(transaction=tr)
+ ---- | 0165 |             if not acc.exists:
+ ---- | 0166 |                 raise HTTPException(400,"Conta de pagamento inválida.")
+ ---- | 0167 |             txs = store.rows(instance,uid,"transactions",tr)
+ ---- | 0168 |             cats = {c['id']:c for c in store.rows(instance,uid,"categories",tr)}
+ ---- | 0169 |             cycle = payload.cycle or cycle_bounds(date.fromisoformat(today_iso()),card['closing_day'])[1].isoformat()
+ ---- | 0170 |             try:
+ ---- | 0171 |                 state = invoice_state(card,txs,cycle,cats)
+ ---- | 0172 |                 allocation = allocate_payment(state['total_cents'],[state['paid_cents']] if state['paid_cents'] else [],None if payload.value is None else to_cents(payload.value))
+ ---- | 0173 |             except ValueError as exc:
+ ---- | 0174 |                 raise HTTPException(400,str(exc))
+ ---- | 0175 |             now = datetime.now(timezone.utc)
+ ---- | 0176 |             # Immutable bank debit; excluded from expense analytics to avoid counting the purchase twice.
+ ---- | 0177 |             debit = dict(id=identifier,user_id=uid,name=f"Fatura {card['name']}",value=D(allocation['payment_cents'])/100,type='despesa',status='pago',date=payload.date,account_id=payload.account_id,card_id=None,to_account_id=None,category_id=None,fixed=False,installment=False,invoice_payment=True,invoice_card_id=card_id,invoice_cycle=cycle,created_at=now,updated_at=now)
+ ---- | 0178 |             state.update(paid_cents=allocation['paid_cents'],paid=allocation['settled'],paid_at=payload.date)
+ ---- | 0179 |             card.setdefault('invoice_cycles',{})[cycle] = dict(items=state['items'],paid_cents=state['paid_cents'],paid_at=payload.date)
+ ---- | 0180 |             response = output(state)
+ ---- | 0181 |             tr.create(owner.collection('transactions').document(identifier),store.encode(debit))
+ ---- | 0182 |             tr.set(card_ref,store.encode(card))
+ ---- | 0183 |             tr.create(receipt_ref,dict(request=request_key,state=state,created_at=now))
+ ---- | 0184 |             return response
+ ---- | 0185 |         return store.atomic(instance,uid,action)
+ ---- | 0186 |     return await run_in_threadpool(execute)
= 0267 | 0187 | 
```


## backend/routers/budgets.py ↔ frontend/finnos/routers/budgets.py

Linhas legado 228; ativo 188.

```text
L---- | F---- | código
+ ---- | 0001 | from finnos.lib.money import D, installment_portion, FinanceModel, Money
= 0001 | 0002 | """Budget V2 — versioned cycles. Existing monthly category budgets remain untouched."""
- 0002 | ---- | 
= 0003 | 0003 | import uuid
= 0004 | 0004 | from datetime import date, datetime, timezone
= 0005 | 0005 | from typing import List, Optional
- 0006 | ---- | 
= 0007 | 0006 | from fastapi import APIRouter, Depends, HTTPException, Query
- 0008 | ---- | 
- 0009 | ---- | from lib.db import db
- 0010 | ---- | from models.budget import BudgetAllocationOut, BudgetAllocationProgress, BudgetCycleIn, BudgetCycleOut, BudgetCycleProgress
- 0011 | ---- | from routers.auth import require_user
- 0012 | ---- | 
- 0013 | ---- | router = APIRouter(prefix="/budgets", tags=["budgets"])
- 0014 | ---- | 
+ ---- | 0007 | from finnos.lib.db import db
+ ---- | 0008 | from finnos.lib.dates import today_iso
+ ---- | 0009 | from finnos.models.budget import BudgetAllocationOut, BudgetAllocationProgress, BudgetCycleIn, BudgetCycleOut, BudgetCycleProgress
+ ---- | 0010 | from finnos.routers.auth import require_user
+ ---- | 0011 | router = APIRouter(prefix='/budgets', tags=['budgets'])
= 0015 | 0012 | 
= 0016 | 0013 | def _status(cycle: dict, today: date) -> str:
- 0017 | ---- |     start = date.fromisoformat(str(cycle["start_date"]))
- 0018 | ---- |     end = date.fromisoformat(str(cycle["end_date"]))
- 0019 | ---- |     if cycle.get("closed_at") or end < today:
- 0020 | ---- |         return "fechado"
+ ---- | 0014 |     start = date.fromisoformat(str(cycle['start_date']))
+ ---- | 0015 |     end = date.fromisoformat(str(cycle['end_date']))
+ ---- | 0016 |     if cycle.get('closed_at') or end < today:
+ ---- | 0017 |         return 'fechado'
= 0021 | 0018 |     if start > today:
- 0022 | ---- |         return "programado"
- 0023 | ---- |     return "ativo"
- 0024 | ---- | 
+ ---- | 0019 |         return 'programado'
+ ---- | 0020 |     return 'ativo'
= 0025 | 0021 | 
= 0026 | 0022 | async def _out(cycle: dict) -> BudgetCycleOut:
- 0027 | ---- |     category_ids = [a["category_id"] for a in cycle.get("allocations", [])]
- 0028 | ---- |     categories = await db.categories.find({"id": {"$in": category_ids}}).to_list(500) if category_ids else []
- 0029 | ---- |     by_id = {c["id"]: c for c in categories}
- 0030 | ---- |     allocations = [
- 0031 | ---- |         BudgetAllocationOut(
- 0032 | ---- |             **allocation,
- 0033 | ---- |             name=by_id.get(allocation["category_id"], {}).get("name"),
- 0034 | ---- |             icon=by_id.get(allocation["category_id"], {}).get("icon"),
- 0035 | ---- |             color=by_id.get(allocation["category_id"], {}).get("color"),
- 0036 | ---- |         )
- 0037 | ---- |         for allocation in cycle.get("allocations", [])
- 0038 | ---- |     ]
- 0039 | ---- |     payload = {k: v for k, v in cycle.items() if k not in {"_id", "user_id", "allocations", "status"}}
- 0040 | ---- |     return BudgetCycleOut(**payload, allocations=allocations, status=_status(cycle, date.today()))
- 0041 | ---- | 
+ ---- | 0023 |     category_ids = [a['category_id'] for a in cycle.get('allocations', [])]
+ ---- | 0024 |     categories = await db.categories.find({'user_id': cycle['user_id'], 'id': {'$in': category_ids}}).to_list(500) if category_ids else []
+ ---- | 0025 |     by_id = {c['id']: c for c in categories}
+ ---- | 0026 |     allocations = [BudgetAllocationOut(**allocation, name=by_id.get(allocation['category_id'], {}).get('name'), icon=by_id.get(allocation['category_id'], {}).get('icon'), color=by_id.get(allocation['category_id'], {}).get('color')) for allocation in cycle.get('allocations', [])]
+ ---- | 0027 |     payload = {k: v for (k, v) in cycle.items() if k not in {'_id', 'user_id', 'allocations', 'status'}}
+ ---- | 0028 |     return BudgetCycleOut(**payload, allocations=allocations, status=_status(cycle, date.fromisoformat(today_iso())))
= 0042 | 0029 | 
= 0043 | 0030 | def _tx_amount(tx: dict) -> float:
- 0044 | ---- |     return round(float(tx.get("installment_value") or 0), 2) if tx.get("installment") else round(float(tx.get("value") or 0), 2)
- 0045 | ---- | 
+ ---- | 0031 |     return round(D(tx.get('installment_value') or 0), 2) if tx.get('installment') else round(D(tx.get('value') or 0), 2)
= 0046 | 0032 | 
= 0047 | 0033 | def _occurrences_in_cycle(tx: dict, start: date, end: date):
- 0048 | ---- |     if tx.get("type") == "transferencia":
+ ---- | 0034 |     if tx.get('invoice_payment') or tx.get('type') == 'transferencia':
= 0049 | 0035 |         return []
= 0050 | 0036 |     import calendar
- 0051 | ---- |     tx_date = date.fromisoformat(tx["date"])
- 0052 | ---- |     amount, realised = _tx_amount(tx), tx.get("status") == "pago"
+ ---- | 0037 |     tx_date = date.fromisoformat(tx['date'])
+ ---- | 0038 |     (amount, realised) = (_tx_amount(tx), tx.get('status') == 'pago')
= 0053 | 0039 |     out = []
- 0054 | ---- |     if tx.get("installment"):
- 0055 | ---- |         total = int(tx.get("total_installments") or 1)
+ ---- | 0040 |     if tx.get('installment'):
+ ---- | 0041 |         total = int(tx.get('total_installments') or 1)
= 0056 | 0042 |         for offset in range(total):
= 0057 | 0043 |             idx = tx_date.year * 12 + tx_date.month - 1 + offset
- 0058 | ---- |             yy, mm = idx // 12, idx % 12 + 1
+ ---- | 0044 |             (yy, mm) = (idx // 12, idx % 12 + 1)
= 0059 | 0045 |             occurrence = date(yy, mm, min(tx_date.day, calendar.monthrange(yy, mm)[1]))
= 0060 | 0046 |             if start <= occurrence <= end:
- 0061 | ---- |                 out.append((occurrence, amount, realised and occurrence <= date.today()))
+ ---- | 0047 |                 out.append((occurrence, installment_portion(tx, offset), realised and occurrence <= date.fromisoformat(today_iso())))
= 0062 | 0048 |         return out
= 0063 | 0049 |     if start <= tx_date <= end:
= 0064 | 0050 |         out.append((tx_date, amount, realised))
- 0065 | ---- |     if tx.get("fixed") and (tx.get("recurrence") or "mensal") == "mensal":
+ ---- | 0051 |     if tx.get('fixed') and (tx.get('recurrence') or 'mensal') == 'mensal':
= 0066 | 0052 |         for offset in range(1, 60):
= 0067 | 0053 |             idx = tx_date.year * 12 + tx_date.month - 1 + offset
- 0068 | ---- |             yy, mm = idx // 12, idx % 12 + 1
+ ---- | 0054 |             (yy, mm) = (idx // 12, idx % 12 + 1)
= 0069 | 0055 |             occurrence = date(yy, mm, min(tx_date.day, calendar.monthrange(yy, mm)[1]))
= 0070 | 0056 |             if occurrence > end:
= 0071 | 0057 |                 break
= 0072 | 0058 |             if occurrence >= start:
= 0073 | 0059 |                 out.append((occurrence, amount, False))
= 0074 | 0060 |     return out
= 0075 | 0061 | 
- 0076 | ---- | 
= 0077 | 0062 | async def _progress(cycle: dict, user_id: str) -> BudgetCycleProgress:
- 0078 | ---- |     start, end, today = date.fromisoformat(str(cycle["start_date"])), date.fromisoformat(str(cycle["end_date"])), date.today()
- 0079 | ---- |     txs = await db.transactions.find({"user_id": user_id}).to_list(20000)
- 0080 | ---- |     categories = await db.categories.find({"user_id": user_id}).to_list(500)
- 0081 | ---- |     by_id = {cat["id"]: cat for cat in categories}
- 0082 | ---- |     spent_by_cat, committed_by_cat = {}, {}
- 0083 | ---- |     received_income = committed_income = 0.0
+ ---- | 0063 |     (start, end, today) = (date.fromisoformat(str(cycle['start_date'])), date.fromisoformat(str(cycle['end_date'])), date.fromisoformat(today_iso()))
+ ---- | 0064 |     txs = await db.transactions.find({'user_id': user_id}).to_list(20000)
+ ---- | 0065 |     categories = await db.categories.find({'user_id': user_id}).to_list(500)
+ ---- | 0066 |     by_id = {cat['id']: cat for cat in categories}
+ ---- | 0067 |     (spent_by_cat, committed_by_cat) = ({}, {})
+ ---- | 0068 |     received_income = committed_income = D('0.0')
= 0084 | 0069 |     for tx in txs:
- 0085 | ---- |         for occurrence, amount, realised in _occurrences_in_cycle(tx, start, end):
- 0086 | ---- |             if tx.get("type") == "receita":
- 0087 | ---- |                 if realised: received_income += amount
- 0088 | ---- |                 else: committed_income += amount
- 0089 | ---- |             elif tx.get("type") == "despesa" and tx.get("category_id"):
+ ---- | 0070 |         for (occurrence, amount, realised) in _occurrences_in_cycle(tx, start, end):
+ ---- | 0071 |             if tx.get('type') == 'receita':
+ ---- | 0072 |                 if realised:
+ ---- | 0073 |                     received_income += amount
+ ---- | 0074 |                 else:
+ ---- | 0075 |                     committed_income += amount
+ ---- | 0076 |             elif tx.get('type') == 'despesa' and tx.get('category_id'):
= 0090 | 0077 |                 target = spent_by_cat if realised else committed_by_cat
- 0091 | ---- |                 key = tx["category_id"]
+ ---- | 0078 |                 key = tx['category_id']
= 0092 | 0079 |                 target[key] = target.get(key, 0) + amount
= 0093 | 0080 |     allocations = []
- 0094 | ---- |     for allocation in cycle.get("allocations", []):
- 0095 | ---- |         key, planned = allocation["category_id"], round(float(allocation.get("planned") or 0), 2)
- 0096 | ---- |         spent, committed = round(spent_by_cat.get(key, 0), 2), round(committed_by_cat.get(key, 0), 2)
- 0097 | ---- |         projected, cat = round(spent + committed, 2), by_id.get(key, {})
- 0098 | ---- |         allocations.append(BudgetAllocationProgress(**allocation, name=cat.get("name"), icon=cat.get("icon"), color=cat.get("color"), spent=spent, committed=committed, available=round(planned-projected, 2), projected_close=projected, percent=round(projected/planned*100, 1) if planned else 0))
- 0099 | ---- |     planned, spent, committed = round(sum(a.planned for a in allocations),2), round(sum(a.spent for a in allocations),2), round(sum(a.committed for a in allocations),2)
+ ---- | 0081 |     for allocation in cycle.get('allocations', []):
+ ---- | 0082 |         (key, planned) = (allocation['category_id'], round(D(allocation.get('planned') or 0), 2))
+ ---- | 0083 |         (spent, committed) = (round(spent_by_cat.get(key, 0), 2), round(committed_by_cat.get(key, 0), 2))
+ ---- | 0084 |         (projected, cat) = (round(spent + committed, 2), by_id.get(key, {}))
+ ---- | 0085 |         allocations.append(BudgetAllocationProgress(**allocation, name=cat.get('name'), icon=cat.get('icon'), color=cat.get('color'), spent=spent, committed=committed, available=round(planned - projected, 2), projected_close=projected, percent=round(projected / planned * 100, 1) if planned else 0))
+ ---- | 0086 |     (planned, spent, committed) = (round(sum((a.planned for a in allocations)), 2), round(sum((a.spent for a in allocations)), 2), round(sum((a.committed for a in allocations)), 2))
= 0100 | 0087 |     projected = round(spent + committed, 2)
- 0101 | ---- |     duration = max((end-start).days+1, 1)
- 0102 | ---- |     elapsed = 0 if today < start else duration if today > end else (today-start).days+1
- 0103 | ---- |     elapsed_percent, used_percent = round(elapsed/duration*100,1), round(projected/planned*100,1) if planned else 0
- 0104 | ---- |     pace = "sem_plano" if not planned else "acima" if used_percent > elapsed_percent+10 else "abaixo" if used_percent < max(elapsed_percent-10,0) else "no_ritmo"
- 0105 | ---- |     expected_income = round(float(cycle.get("expected_income") or 0),2)
- 0106 | ---- |     income_base = max(expected_income, round(received_income+committed_income,2))
- 0107 | ---- |     return BudgetCycleProgress(cycle_id=cycle["id"], start_date=start, end_date=end, planned=planned, spent=spent, committed=committed, available=round(planned-projected,2), projected_close=projected, expected_income=expected_income, received_income=round(received_income,2), committed_income=round(committed_income,2), safe_to_spend=round(max(income_base-spent-committed,0),2), elapsed_percent=elapsed_percent, used_percent=used_percent, pace=pace, allocations=allocations)
- 0108 | ---- | 
+ ---- | 0088 |     duration = max((end - start).days + 1, 1)
+ ---- | 0089 |     elapsed = 0 if today < start else duration if today > end else (today - start).days + 1
+ ---- | 0090 |     (elapsed_percent, used_percent) = (round(elapsed / duration * 100, 1), round(projected / planned * 100, 1) if planned else 0)
+ ---- | 0091 |     pace = 'sem_plano' if not planned else 'acima' if used_percent > elapsed_percent + 10 else 'abaixo' if used_percent < max(elapsed_percent - 10, 0) else 'no_ritmo'
+ ---- | 0092 |     expected_income = round(D(cycle.get('expected_income') or 0), 2)
+ ---- | 0093 |     income_base = max(expected_income, round(received_income + committed_income, 2))
+ ---- | 0094 |     return BudgetCycleProgress(cycle_id=cycle['id'], start_date=start, end_date=end, planned=planned, spent=spent, committed=committed, available=round(planned - projected, 2), projected_close=projected, expected_income=expected_income, received_income=round(received_income, 2), committed_income=round(committed_income, 2), safe_to_spend=round(max(income_base - spent - committed, 0), 2), elapsed_percent=elapsed_percent, used_percent=used_percent, pace=pace, allocations=allocations)
= 0109 | 0095 | 
- 0110 | ---- | @router.get("/suggestion")
- 0111 | ---- | async def budget_suggestion(user: dict = Depends(require_user)):
+ ---- | 0096 | @router.get('/suggestion')
+ ---- | 0097 | async def budget_suggestion(user: dict=Depends(require_user)):
= 0112 | 0098 |     """Suggest category limits from recent behaviour; never writes a budget."""
- 0113 | ---- |     today = date.today()
+ ---- | 0099 |     today = date.fromisoformat(today_iso())
= 0114 | 0100 |     current_idx = today.year * 12 + today.month - 1
= 0115 | 0101 |     start_idx = current_idx - 3
- 0116 | ---- |     sy, sm = start_idx // 12, start_idx % 12 + 1
- 0117 | ---- |     ey, em = (current_idx - 1) // 12, (current_idx - 1) % 12 + 1
+ ---- | 0102 |     (sy, sm) = (start_idx // 12, start_idx % 12 + 1)
+ ---- | 0103 |     (ey, em) = ((current_idx - 1) // 12, (current_idx - 1) % 12 + 1)
= 0118 | 0104 |     import calendar
= 0119 | 0105 |     start = date(sy, sm, 1).isoformat()
= 0120 | 0106 |     end = date(ey, em, calendar.monthrange(ey, em)[1]).isoformat()
- 0121 | ---- |     txs = await db.transactions.find({"user_id": user["id"], "type": "despesa", "status": "pago", "date": {"$gte": start, "$lte": end}}).to_list(20000)
- 0122 | ---- |     cats = await db.categories.find({"user_id": user["id"]}).to_list(500)
- 0123 | ---- |     by_id = {c["id"]: c for c in cats}
+ ---- | 0107 |     txs = await db.transactions.find({'user_id': user['id'], 'type': 'despesa', 'status': 'pago', 'date': {'$gte': start, '$lte': end}}).to_list(20000)
+ ---- | 0108 |     cats = await db.categories.find({'user_id': user['id']}).to_list(500)
+ ---- | 0109 |     by_id = {c['id']: c for c in cats}
= 0124 | 0110 |     monthly: dict[tuple[str, str], float] = {}
= 0125 | 0111 |     for tx in txs:
- 0126 | ---- |         cid = tx.get("category_id")
- 0127 | ---- |         if not cid: continue
- 0128 | ---- |         key = (cid, str(tx["date"])[:7])
+ ---- | 0112 |         cid = tx.get('category_id')
+ ---- | 0113 |         if not cid:
+ ---- | 0114 |             continue
+ ---- | 0115 |         key = (cid, str(tx['date'])[:7])
= 0129 | 0116 |         monthly[key] = monthly.get(key, 0) + _tx_amount(tx)
= 0130 | 0117 |     suggestions = []
- 0131 | ---- |     for cid, cat in by_id.items():
- 0132 | ---- |         month_keys = [f"{(start_idx+i)//12:04d}-{(start_idx+i)%12+1:02d}" for i in range(3)]
- 0133 | ---- |         vals = [monthly.get((cid, key), 0.0) for key in month_keys]
- 0134 | ---- |         if not any(vals): continue
+ ---- | 0118 |     month_keys = [f'{(start_idx + i) // 12:04d}-{(start_idx + i) % 12 + 1:02d}' for i in range(3)]
+ ---- | 0119 |     for (cid, cat) in by_id.items():
+ ---- | 0120 |         vals = [monthly.get((cid, key), D('0.0')) for key in month_keys]
+ ---- | 0121 |         if not any(vals):
+ ---- | 0122 |             continue
= 0135 | 0123 |         avg = round(sum(vals) / 3, 2)
- 0136 | ---- |         buffer = 1.05 if cat.get("group") == "necessidades" else 1.0
+ ---- | 0124 |         buffer = D('1.05') if cat.get('group') == 'necessidades' else D('1.0')
= 0137 | 0125 |         planned = round(avg * buffer, 2)
- 0138 | ---- |         suggestions.append({"category_id": cid, "name": cat.get("name"), "group": cat.get("group"), "average": avg, "suggested": planned, "months_observed": sum(1 for value in vals if value > 0)})
- 0139 | ---- |     suggestions.sort(key=lambda x: -x["suggested"])
- 0140 | ---- |     income_txs = await db.transactions.find({"user_id": user["id"], "type": "receita", "status": "pago", "date": {"$gte": start, "$lte": end}}).to_list(5000)
+ ---- | 0126 |         suggestions.append({'category_id': cid, 'name': cat.get('name'), 'group': cat.get('group'), 'average': avg, 'suggested': planned, 'months_observed': sum((1 for value in vals if value > 0))})
+ ---- | 0127 |     suggestions.sort(key=lambda x: -x['suggested'])
+ ---- | 0128 |     income_txs = await db.transactions.find({'user_id': user['id'], 'type': 'receita', 'status': 'pago', 'date': {'$gte': start, '$lte': end}}).to_list(5000)
= 0141 | 0129 |     income_by_month: dict[str, float] = {}
= 0142 | 0130 |     for tx in income_txs:
- 0143 | ---- |         key = str(tx["date"])[:7]; income_by_month[key] = income_by_month.get(key, 0) + _tx_amount(tx)
- 0144 | ---- |     expected_income = round(sum(income_by_month.get(key, 0.0) for key in month_keys) / 3, 2) if income_by_month else 0
- 0145 | ---- |     return {"expected_income": expected_income, "categories": suggestions, "method": "media_recente", "writes_data": False}
- 0146 | ---- | 
+ ---- | 0131 |         key = str(tx['date'])[:7]
+ ---- | 0132 |         income_by_month[key] = income_by_month.get(key, 0) + _tx_amount(tx)
+ ---- | 0133 |     expected_income = round(sum((income_by_month.get(key, D('0.0')) for key in month_keys)) / 3, 2) if income_by_month else 0
+ ---- | 0134 |     return {'expected_income': expected_income, 'categories': suggestions, 'method': 'media_recente', 'writes_data': False}
= 0147 | 0135 | 
- 0148 | ---- | @router.get("", response_model=List[BudgetCycleOut])
- 0149 | ---- | async def list_cycles(
- 0150 | ---- |     status: Optional[str] = Query(default=None, pattern="^(programado|ativo|fechado)$"),
- 0151 | ---- |     user: dict = Depends(require_user),
- 0152 | ---- | ) -> List[BudgetCycleOut]:
- 0153 | ---- |     cycles = await db.budget_cycles.find({"user_id": user["id"]}).sort("start_date", -1).to_list(500)
+ ---- | 0136 | @router.get('', response_model=List[BudgetCycleOut])
+ ---- | 0137 | async def list_cycles(status: Optional[str]=Query(default=None, pattern='^(programado|ativo|fechado)$'), user: dict=Depends(require_user)) -> List[BudgetCycleOut]:
+ ---- | 0138 |     cycles = await db.budget_cycles.find({'user_id': user['id']}).sort('start_date', -1).to_list(500)
= 0154 | 0139 |     output = [await _out(c) for c in cycles]
= 0155 | 0140 |     return [c for c in output if c.status == status] if status else output
= 0156 | 0141 | 
- 0157 | ---- | 
- 0158 | ---- | @router.get("/current", response_model=Optional[BudgetCycleOut])
- 0159 | ---- | async def current_cycle(user: dict = Depends(require_user)):
- 0160 | ---- |     today = date.today().isoformat()
- 0161 | ---- |     cycle = await db.budget_cycles.find_one(
- 0162 | ---- |         {"user_id": user["id"], "start_date": {"$lte": today}, "end_date": {"$gte": today}, "closed_at": None},
- 0163 | ---- |         sort=[("start_date", -1)],
- 0164 | ---- |     )
+ ---- | 0142 | @router.get('/current', response_model=Optional[BudgetCycleOut])
+ ---- | 0143 | async def current_cycle(user: dict=Depends(require_user)):
+ ---- | 0144 |     today = date.fromisoformat(today_iso()).isoformat()
+ ---- | 0145 |     cycle = await db.budget_cycles.find_one({'user_id': user['id'], 'start_date': {'$lte': today}, 'end_date': {'$gte': today}, 'closed_at': None}, sort=[('start_date', -1)])
= 0165 | 0146 |     return await _out(cycle) if cycle else None
= 0166 | 0147 | 
- 0167 | ---- | 
- 0168 | ---- | @router.get("/next", response_model=Optional[BudgetCycleOut])
- 0169 | ---- | async def next_cycle(user: dict = Depends(require_user)):
- 0170 | ---- |     today = date.today().isoformat()
- 0171 | ---- |     cycle = await db.budget_cycles.find_one(
- 0172 | ---- |         {"user_id": user["id"], "start_date": {"$gt": today}, "closed_at": None},
- 0173 | ---- |         sort=[("start_date", 1)],
- 0174 | ---- |     )
+ ---- | 0148 | @router.get('/next', response_model=Optional[BudgetCycleOut])
+ ---- | 0149 | async def next_cycle(user: dict=Depends(require_user)):
+ ---- | 0150 |     today = date.fromisoformat(today_iso()).isoformat()
+ ---- | 0151 |     cycle = await db.budget_cycles.find_one({'user_id': user['id'], 'start_date': {'$gt': today}, 'closed_at': None}, sort=[('start_date', 1)])
= 0175 | 0152 |     return await _out(cycle) if cycle else None
= 0176 | 0153 | 
- 0177 | ---- | 
- 0178 | ---- | @router.get("/{cycle_id}/progress", response_model=BudgetCycleProgress)
- 0179 | ---- | async def cycle_progress(cycle_id: str, user: dict = Depends(require_user)) -> BudgetCycleProgress:
- 0180 | ---- |     cycle = await db.budget_cycles.find_one({"id": cycle_id, "user_id": user["id"]})
+ ---- | 0154 | @router.get('/{cycle_id}/progress', response_model=BudgetCycleProgress)
+ ---- | 0155 | async def cycle_progress(cycle_id: str, user: dict=Depends(require_user)) -> BudgetCycleProgress:
+ ---- | 0156 |     cycle = await db.budget_cycles.find_one({'id': cycle_id, 'user_id': user['id']})
= 0181 | 0157 |     if not cycle:
- 0182 | ---- |         raise HTTPException(status_code=404, detail="Orçamento não encontrado.")
- 0183 | ---- |     return await _progress(cycle, user["id"])
- 0184 | ---- | 
+ ---- | 0158 |         raise HTTPException(status_code=404, detail='Orçamento não encontrado.')
+ ---- | 0159 |     return await _progress(cycle, user['id'])
= 0185 | 0160 | 
- 0186 | ---- | @router.post("", response_model=BudgetCycleOut, status_code=201)
- 0187 | ---- | async def create_cycle(input: BudgetCycleIn, user: dict = Depends(require_user)) -> BudgetCycleOut:
- 0188 | ---- |     start, end = input.start_date.isoformat(), input.end_date.isoformat()
- 0189 | ---- |     overlap = await db.budget_cycles.find_one({
- 0190 | ---- |         "user_id": user["id"],
- 0191 | ---- |         "closed_at": None,
- 0192 | ---- |         "start_date": {"$lte": end},
- 0193 | ---- |         "end_date": {"$gte": start},
- 0194 | ---- |     })
+ ---- | 0161 | @router.post('', response_model=BudgetCycleOut, status_code=201)
+ ---- | 0162 | async def create_cycle(input: BudgetCycleIn, user: dict=Depends(require_user)) -> BudgetCycleOut:
+ ---- | 0163 |     (start, end) = (input.start_date.isoformat(), input.end_date.isoformat())
+ ---- | 0164 |     overlap = await db.budget_cycles.find_one({'user_id': user['id'], 'closed_at': None, 'start_date': {'$lte': end}, 'end_date': {'$gte': start}})
= 0195 | 0165 |     if overlap:
- 0196 | ---- |         raise HTTPException(status_code=409, detail="Já existe um orçamento nesse período.")
- 0197 | ---- | 
+ ---- | 0166 |         raise HTTPException(status_code=409, detail='Já existe um orçamento nesse período.')
= 0198 | 0167 |     now = datetime.now(timezone.utc).isoformat()
- 0199 | ---- |     doc = input.model_dump(mode="json")
- 0200 | ---- |     doc.update({"id": str(uuid.uuid4()), "user_id": user["id"], "created_at": now, "closed_at": None})
+ ---- | 0168 |     doc = {**input.model_dump(), 'start_date':start, 'end_date':end}
+ ---- | 0169 |     doc.update({'id': str(uuid.uuid4()), 'user_id': user['id'], 'created_at': now, 'closed_at': None})
= 0201 | 0170 |     await db.budget_cycles.insert_one(doc)
= 0202 | 0171 |     return await _out(doc)
= 0203 | 0172 | 
- 0204 | ---- | 
- 0205 | ---- | @router.put("/{cycle_id}", response_model=BudgetCycleOut)
- 0206 | ---- | async def update_cycle(cycle_id: str, input: BudgetCycleIn, user: dict = Depends(require_user)) -> BudgetCycleOut:
- 0207 | ---- |     current = await db.budget_cycles.find_one({"id": cycle_id, "user_id": user["id"]})
+ ---- | 0173 | @router.put('/{cycle_id}', response_model=BudgetCycleOut)
+ ---- | 0174 | async def update_cycle(cycle_id: str, input: BudgetCycleIn, user: dict=Depends(require_user)) -> BudgetCycleOut:
+ ---- | 0175 |     current = await db.budget_cycles.find_one({'id': cycle_id, 'user_id': user['id']})
= 0208 | 0176 |     if not current:
- 0209 | ---- |         raise HTTPException(status_code=404, detail="Orçamento não encontrado.")
- 0210 | ---- |     if _status(current, date.today()) == "fechado":
- 0211 | ---- |         raise HTTPException(status_code=409, detail="O histórico de um orçamento fechado não pode ser alterado.")
- 0212 | ---- | 
- 0213 | ---- |     start, end = input.start_date.isoformat(), input.end_date.isoformat()
- 0214 | ---- |     overlap = await db.budget_cycles.find_one({
- 0215 | ---- |         "user_id": user["id"],
- 0216 | ---- |         "id": {"$ne": cycle_id},
- 0217 | ---- |         "closed_at": None,
- 0218 | ---- |         "start_date": {"$lte": end},
- 0219 | ---- |         "end_date": {"$gte": start},
- 0220 | ---- |     })
+ ---- | 0177 |         raise HTTPException(status_code=404, detail='Orçamento não encontrado.')
+ ---- | 0178 |     if _status(current, date.fromisoformat(today_iso())) == 'fechado':
+ ---- | 0179 |         raise HTTPException(status_code=409, detail='O histórico de um orçamento fechado não pode ser alterado.')
+ ---- | 0180 |     (start, end) = (input.start_date.isoformat(), input.end_date.isoformat())
+ ---- | 0181 |     overlap = await db.budget_cycles.find_one({'user_id': user['id'], 'id': {'$ne': cycle_id}, 'closed_at': None, 'start_date': {'$lte': end}, 'end_date': {'$gte': start}})
= 0221 | 0182 |     if overlap:
- 0222 | ---- |         raise HTTPException(status_code=409, detail="Já existe outro orçamento nesse período.")
- 0223 | ---- | 
- 0224 | ---- |     patch = input.model_dump(mode="json")
- 0225 | ---- |     await db.budget_cycles.update_one({"id": cycle_id, "user_id": user["id"]}, {"$set": patch})
+ ---- | 0183 |         raise HTTPException(status_code=409, detail='Já existe outro orçamento nesse período.')
+ ---- | 0184 |     patch = {**input.model_dump(), 'start_date':start, 'end_date':end}
+ ---- | 0185 |     await db.budget_cycles.update_one({'id': cycle_id, 'user_id': user['id']}, {'$set': patch})
= 0226 | 0186 |     updated = {**current, **patch}
= 0227 | 0187 |     return await _out(updated)
= 0228 | 0188 | 
```
