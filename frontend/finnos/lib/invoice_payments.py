"""Pure, cent-accurate invoice payment allocation for the Firestore migration.

No database access. Callers must enforce Firebase UID ownership and execute
payment creation and account balance changes in one Firestore transaction.
"""
from decimal import Decimal, ROUND_HALF_UP


def to_cents(value):
    amount = Decimal(str(value))
    if not amount.is_finite():
        raise ValueError("Valor não finito.")
    cents = amount * 100
    if cents != cents.to_integral_value():
        raise ValueError("Valor deve ter no máximo duas casas decimais.")
    return int(cents)


def invoice_balance(total_cents, payments_cents):
    """Return (paid, outstanding), rejecting overpayment or negative entries."""
    if not isinstance(total_cents, int) or isinstance(total_cents, bool) or total_cents < 0:
        raise ValueError("Total da fatura inválido.")
    if any(not isinstance(p, int) or isinstance(p, bool) or p <= 0 for p in payments_cents):
        raise ValueError("Pagamento inválido.")
    paid = sum(payments_cents)
    if paid > total_cents:
        raise ValueError("Pagamentos excedem o total da fatura.")
    return paid, total_cents - paid


def allocate_payment(total_cents, previous_payments_cents, requested_cents=None):
    """Validate a full or partial payment and return the resulting invoice state.

    A missing requested amount means pay the full outstanding balance.
    This is validation only: idempotency and atomic account debit are mandatory
    responsibilities of the transactional persistence layer.
    """
    paid, outstanding = invoice_balance(total_cents, previous_payments_cents)
    if outstanding == 0:
        raise ValueError("Fatura já quitada.")
    amount = outstanding if requested_cents is None else requested_cents
    if not isinstance(amount, int) or isinstance(amount, bool) or amount <= 0:
        raise ValueError("Pagamento deve ser positivo em centavos.")
    if amount > outstanding:
        raise ValueError("Pagamento excede o saldo da fatura.")
    return {
        "payment_cents": amount,
        "paid_cents": paid + amount,
        "outstanding_cents": outstanding - amount,
        "settled": amount == outstanding,
    }
