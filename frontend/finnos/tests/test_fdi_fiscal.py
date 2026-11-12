"""NFC-e (DANFE) extraction with deterministic cross-checks. Synthetic data:
the CNPJ and access key below are generated with valid check digits."""
from finnos.document_intelligence.fiscal import AccessKey, access_key_dv, valid_cnpj
from finnos.document_intelligence.models import ConfidenceLevel, Direction, DocumentKind, OperationKind, TextSpan
from finnos.document_intelligence.service import extract_text_document


def cnpj_with_dv(base12: str) -> str:
    def dv(base, weights):
        rest = sum(int(d) * w for d, w in zip(base, weights)) % 11
        return "0" if rest < 2 else str(11 - rest)

    first = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    with_first = base12 + dv(base12, first)
    return with_first + dv(with_first, [6, *first])


CNPJ = cnpj_with_dv("123456780001")
KEY43 = "35" + "2611" + CNPJ + "65" + "002" + "000004321" + "1" + "12345678"
KEY = KEY43 + str(access_key_dv(KEY43))
PRINTED_CNPJ = f"{CNPJ[:2]}.{CNPJ[2:5]}.{CNPJ[5:8]}/{CNPJ[8:12]}-{CNPJ[12:]}"
GROUPS = " ".join(KEY[i:i + 4] for i in range(0, 44, 4))


def receipt(**replace) -> list[TextSpan]:
    text = f"""NFC-e
MERCADINHO SINTETICO LTDA
CNPJ: {PRINTED_CNPJ} IE: 123456789
DANFE NFC-e Documento Auxiliar
da Nota Fiscal ao Consumidor Eletrônica
Cód. Descrição Qtd. Un Vl. Unit Vl. Total
0001 ARROZ TIPO 1 5KG 1,0 UN 28,90 R$ 28,90
0002 BANANA PRATA KG 1,250 KG 6,98 R$ 8,73
0003 AGUA MINERAL 500ML 3,0 UN 2,50 R$ 7,50
Qtd. Total de Itens 3
Desconto R$ 1,13
Valor Total R$ 44,00
Forma de Pagamento Valor pago
- Cartão de Crédito R$ 40,00
- Dinheiro R$ 10,00
Troco R$ 6,00
Número: 4321 - Série: 2 Data de Emissão: 05/11/2026
18:02:11 - Via Consumidor
CHAVE DE ACESSO
NFe {GROUPS[:54]}
{GROUPS[54:]}
Protocolo de autorização: 135260000000001 - 05/11/2026"""
    for old, new in replace.items():
        text = text.replace(old.replace("_", " "), new)
    return [TextSpan(line, confidence=0.97) for line in text.splitlines()]


def test_check_digits():
    assert valid_cnpj(CNPJ) and not valid_cnpj(CNPJ[:-1] + str((int(CNPJ[-1]) + 1) % 10))
    assert not valid_cnpj("11111111111111")
    key = AccessKey(KEY)
    assert key.check_digit_ok and (key.uf, key.model, key.series, key.number, key.year_month) == ("SP", "65", 2, 4321, "2026-11")


def test_nfce_is_read_and_every_cross_check_closes():
    result = extract_text_document(receipt())
    assert result.document_kind == DocumentKind.FISCAL_DOCUMENT
    f = {k: v.value for k, v in result.fields.items()}
    assert f["issuer_name"] == "MERCADINHO SINTETICO LTDA" and f["issuer_cnpj"] == CNPJ
    assert (f["issue_date"], f["issue_time"], f["number"], f["series"]) == ("2026-11-05", "18:02:11", 4321, 2)
    assert (f["total_cents"], f["discount_cents"], f["change_cents"]) == (4400, 113, 600)
    assert f["access_key"] == KEY and f["document_model"] == "nfce" and f["issuer_uf"] == "SP"
    assert "institution" not in result.fields  # a merchant is not a bank
    assert {c.name: c.passed for c in result.checks} == {
        "cnpj_check_digits": True, "access_key_check_digit": True, "access_key_cnpj": True,
        "access_key_number": True, "access_key_series": True, "access_key_month": True,
        "items_total": True, "payments_total": True,
    }
    items = result.details["items"]
    assert [(i["description"], i["quantity"], i["total_cents"], i["consistent"]) for i in items] == [
        ("ARROZ TIPO 1 5KG", 1.0, 2890, True), ("BANANA PRATA KG", 1.25, 873, True), ("AGUA MINERAL 500ML", 3.0, 750, True)]
    assert [(p["kind"], p["amount_cents"]) for p in result.details["payments"]] == [("credito", 4000), ("dinheiro", 1000)]
    row = result.transactions[0]
    assert (row.amount_cents.value, row.direction, row.operation) == (4400, Direction.EXPENSE, OperationKind.PURCHASE)
    assert row.transaction_date.value == "2026-11-05" and row.confidence_level == ConfidenceLevel.HIGH
    assert result.status.value == "pending_review"


def test_a_misread_digit_in_the_key_or_total_is_caught():
    broken_key = extract_text_document(receipt(**{GROUPS[50:54]: str(int(GROUPS[50:54]) + 1).zfill(4)}))
    assert next(c for c in broken_key.checks if c.name == "access_key_check_digit").passed is False
    assert broken_key.transactions[0].confidence_level == ConfidenceLevel.LOW

    wrong_total = extract_text_document(receipt(**{"Valor_Total_R$_44,00": "Valor Total R$ 49,00"}))
    checks = {c.name: c.passed for c in wrong_total.checks}
    assert checks["items_total"] is False and checks["payments_total"] is False
    assert wrong_total.transactions[0].confidence_level == ConfidenceLevel.LOW


def test_item_with_wrong_quantity_times_price_is_flagged():
    result = extract_text_document(receipt(**{"3,0_UN_2,50": "3,0 UN 2,60"}))
    item = next(i for i in result.details["items"] if i["code"] == "0003")
    assert item["consistent"] is False and "item_quantity_times_price_mismatch" in result.warnings


def test_benefit_payment_maps_to_the_wallet_kind():
    result = extract_text_document(receipt(**{"-_Cartão_de_Crédito_R$_40,00": "- Vale Refeição R$ 40,00"}))
    assert result.fields["payment_method"].value == "beneficio_refeicao"
