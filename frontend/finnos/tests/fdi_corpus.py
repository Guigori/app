"""Synthetic FDI reference corpus: statements and card invoices for the first
five banks, each with its ground truth. Every document says SINTÉTICO and uses
invented merchants and people; bank names and CNPJs are public issuer data.

Layouts deliberately differ the way real ones do: D/C markers, trailing minus,
separate debit/credit columns, a running balance column, day-only balances,
'12 NOV' dates, installments written three ways, international purchases.
"""
from __future__ import annotations

import io
import random
from dataclasses import dataclass, field
from typing import Any

PAGE_W, PAGE_H = 595.0, 842.0  # A4 points


@dataclass
class Row:
    date: str  # ISO truth
    description: str
    cents: int
    direction: str  # income / expense
    operation: str
    installment: tuple[int, int] | None = None
    printed: list[str] = field(default_factory=list)  # cells as printed


@dataclass
class Doc:
    name: str
    kind: str  # bank_statement / credit_card_statement
    institution: str
    header: list[str]
    columns: list[tuple[str, float, str]]  # (title, x, align)
    rows: list[Row]
    extra_lines: list[tuple[str, list[str]]] = field(default_factory=list)  # (position, cells) printed rows w/o truth
    fields: dict[str, Any] = field(default_factory=dict)
    footer: list[str] = field(default_factory=list)


def brl(cents: int) -> str:
    whole, frac = divmod(abs(cents), 100)
    return f"{whole:,}".replace(",", ".") + f",{frac:02d}"


def _statement(name, institution, header, columns, opening, items, fmt, *, balance_mode="row", start="2026-10-01",
               end="2026-10-31", footer=()):
    """items: (iso_date, description, cents, direction, operation)."""
    rows: list[Row] = []
    balance = opening
    day_iso = lambda iso: f"{iso[8:10]}/{iso[5:7]}/{iso[0:4]}"  # noqa: E731
    first = [day_iso(start), "SALDO ANTERIOR", "", brl(opening)] if balance_mode != "none" else None
    for index, (iso, desc, cents, direction, op) in enumerate(items):
        balance += cents if direction == "income" else -cents
        cells = fmt(day_iso(iso), desc, cents, direction, balance)
        if balance_mode == "day":
            last_of_day = index == len(items) - 1 or items[index + 1][0] != iso
            if not last_of_day:
                cells = cells[:-1] + [""]
        rows.append(Row(iso, desc, cents, direction, op, printed=cells))
    fields = {"opening_balance": opening, "closing_balance": balance, "period_start": start, "period_end": end}
    doc = Doc(name, "bank_statement", institution, header, columns, rows, fields=fields, footer=list(footer))
    if first:
        doc.extra_lines.append(("first", first))
    doc.extra_lines.append(("last", [day_iso(end), "SALDO FINAL", "", brl(balance)]))
    return doc


def build_corpus() -> list[Doc]:
    docs: list[Doc] = []

    # ---------------------------------------------------------------- statements
    items_a = [
        ("2026-10-02", "PIX RECEBIDO MARIA SINTETICA", 50000, "income", "pix_in"),
        ("2026-10-03", "COMPRA DEBITO PADARIA AURORA", 1850, "expense", "purchase"),
        ("2026-10-05", "PIX ENVIADO JOAO FICTICIO", 12000, "expense", "pix_out"),
        ("2026-10-05", "PAGAMENTO BOLETO CONDOMINIO", 45000, "expense", "bill_payment"),
        ("2026-10-10", "TARIFA PACOTE SERVICOS", 2990, "expense", "bank_fee"),
        ("2026-10-15", "SALARIO EMPRESA EXEMPLO LTDA", 520000, "income", "salary"),
        ("2026-10-20", "PAGAMENTO FATURA CARTAO", 123456, "expense", "card_bill_payment"),
        ("2026-10-28", "TED RECEBIDA CLIENTE TESTE", 80000, "income", "transfer_in"),
    ]
    # Inter: signed amounts with R$, running balance on every row.
    docs.append(_statement(
        "inter_extrato", "inter",
        ["Banco Inter S.A. - CNPJ 00.416.968/0001-01", "Extrato da conta corrente - DOCUMENTO SINTETICO",
         "Período: 01/10/2026 a 31/10/2026", "Agência 0001 Conta 1234567-8"],
        [("Data", 40, "l"), ("Descrição", 110, "l"), ("Valor", 430, "r"), ("Saldo", 540, "r")],
        150000, items_a,
        lambda d, desc, c, direc, bal: [d, desc, ("-R$ " if direc == "expense" else "R$ ") + brl(c), "R$ " + brl(bal)],
    ))
    # Itaú: trailing minus, balance only on the last line of each day.
    docs.append(_statement(
        "itau_extrato", "itau",
        ["Itaú Unibanco S.A. CNPJ 60.701.190/0001-04", "extrato conta corrente  DOCUMENTO SINTETICO",
         "período: 01/10/2026 a 31/10/2026"],
        [("data", 40, "l"), ("lançamento", 110, "l"), ("valor (R$)", 440, "r"), ("saldo (R$)", 540, "r")],
        80000, items_a[:6],
        lambda d, desc, c, direc, bal: [d, desc, brl(c) + ("-" if direc == "expense" else ""), brl(bal)],
        balance_mode="day",
    ))
    # Bradesco: separate debit/credit columns and a balance column.
    docs.append(_statement(
        "bradesco_extrato", "bradesco",
        ["Banco Bradesco S.A. CNPJ 60.746.948/0001-12", "Extrato Mensal - DOCUMENTO SINTETICO",
         "Período: 01/10/2026 a 31/10/2026"],
        [("Data", 40, "l"), ("Histórico", 110, "l"), ("Crédito", 360, "r"), ("Débito", 450, "r"), ("Saldo", 545, "r")],
        200000, items_a,
        lambda d, desc, c, direc, bal: [d, desc, brl(c) if direc == "income" else "", brl(c) if direc == "expense" else "", brl(bal)],
    ))
    # Banco do Brasil: D/C markers, no balance column on movement rows.
    docs.append(_statement(
        "bb_extrato", "bb",
        ["Banco do Brasil S.A. - CNPJ 00.000.000/0001-91", "Extrato de conta corrente - DOCUMENTO SINTETICO",
         "Período: 01/10/2026 a 31/10/2026"],
        [("Data", 40, "l"), ("Histórico", 110, "l"), ("Valor R$", 520, "r")],
        30000, items_a[:5],
        lambda d, desc, c, direc, bal: [d, desc, brl(c) + (" D" if direc == "expense" else " C")],
        balance_mode="none",
    ))
    bb = docs[-1]
    bb.extra_lines = [("first", ["01/10/2026", "SALDO ANTERIOR", brl(30000) + " C"]),
                      ("last", ["31/10/2026", "SALDO FINAL", brl(bb.fields["closing_balance"]) + " C"])]
    bb.columns = [("Data", 40, "l"), ("Histórico", 110, "l"), ("Valor R$", 520, "r")]
    # Nubank account: balance column, unsigned amounts -> direction from balance.
    docs.append(_statement(
        "nubank_extrato", "nubank",
        ["Nu Pagamentos S.A. - Instituição de Pagamento CNPJ 18.236.120/0001-58",
         "Extrato da conta - DOCUMENTO SINTETICO", "Período: 01/10/2026 a 31/10/2026"],
        [("Data", 40, "l"), ("Descrição", 110, "l"), ("Valor", 430, "r"), ("Saldo", 540, "r")],
        100000, items_a[:4] + items_a[5:6],
        lambda d, desc, c, direc, bal: [d, desc, brl(c), brl(bal)],
    ))

    # ---------------------------------------------------------------- invoices
    def invoice(name, institution, header, columns, due, total_rows, fmt, extra_header=(), previous=None):
        rows = []
        for iso, desc, cents, direction, op, inst in total_rows:
            rows.append(Row(iso, desc, cents, direction, op, inst, printed=fmt(iso, desc, cents, direction, inst)))
        total = sum(r.cents if r.direction == "expense" else -r.cents for r in rows)
        fields = {"due_date": due, "total_cents": total}
        head = [line.format(total=brl(total)) for line in (*header, *extra_header)]
        return Doc(name, "credit_card_statement", institution, head, columns, rows, fields=fields)

    base_invoice = [
        ("2026-11-15", "PAGAMENTO RECEBIDO", 98000, "income", "invoice_payment", None),
        ("2026-11-20", "MERCADO BOM PRECO", 34590, "expense", "purchase", None),
        ("2026-11-22", "LOJA ROUPAS MODELO", 12000, "expense", "installment", (3, 10)),
        ("2026-11-25", "POSTO COMBUSTIVEL TESTE", 25000, "expense", "purchase", None),
        ("2026-11-28", "ESTORNO LOJA ROUPAS MODELO", 5000, "income", "refund", None),
        ("2026-12-01", "IOF COMPRA INTERNACIONAL", 385, "expense", "iof", None),
        ("2026-12-01", "STREAMING GLOBAL", 5490, "expense", "purchase", None),
        ("2026-12-02", "JUROS DE MORA", 1234, "expense", "late_interest", None),
        ("2026-12-02", "MULTA POR ATRASO", 1960, "expense", "late_fee", None),
        ("2026-12-02", "ENCARGOS ROTATIVO", 4321, "expense", "charges", None),
        ("2026-12-03", "ANUIDADE DIFERENCIADA", 3500, "expense", "annual_fee", (2, 12)),
        ("2026-12-03", "AJUSTE CREDITO CASHBACK", 1000, "income", "credit", None),
        ("2026-12-04", "FATURA ANTERIOR", 98000, "expense", "previous_balance", None),
    ]
    mon = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"]

    def dm(iso):
        return f"{iso[8:10]}/{iso[5:7]}"

    # Nubank: '20 NOV' dates, 'Parcela 3/10', credits with minus.
    docs.append(invoice(
        "nubank_fatura", "nubank",
        ["Nu Pagamentos S.A. CNPJ 18.236.120/0001-58", "Fatura do cartão - DOCUMENTO SINTETICO",
         "Cartão final 4321", "Data de vencimento: 12/12/2026"],
        [("Data", 40, "l"), ("Lançamento", 110, "l"), ("Valor", 545, "r")],
        "2026-12-12", base_invoice,
        lambda iso, desc, c, d, inst: [f"{iso[8:10]} {mon[int(iso[5:7]) - 1].upper()}",
                                       desc + (f" - Parcela {inst[0]}/{inst[1]}" if inst else ""),
                                       ("-" if d == "income" else "") + "R$ " + brl(c)],
        extra_header=["Total da fatura R$ {total}"],
    ))
    # Itaú: 'PARC 03/10', international with US$ column.
    itau_rows = base_invoice[:5] + [("2026-11-30", "LOJA ONLINE EXTERIOR", 11025, "expense", "purchase", None)] + base_invoice[5:]
    docs.append(invoice(
        "itau_fatura", "itau",
        ["Banco Itaucard S.A. CNPJ 17.192.451/0001-70", "Resumo da fatura - DOCUMENTO SINTETICO",
         "Cartão final 9876", "Vencimento 12/12/2026"],
        [("data", 40, "l"), ("estabelecimento", 110, "l"), ("US$", 440, "r"), ("valor em R$", 545, "r")],
        "2026-12-12", itau_rows,
        lambda iso, desc, c, d, inst: [dm(iso), desc + (f" PARC {inst[0]:02d}/{inst[1]:02d}" if inst else ""),
                                       "US$ 20,00" if desc == "LOJA ONLINE EXTERIOR" else "",
                                       ("-" if d == "income" else "") + brl(c)],
        extra_header=["Total desta fatura R$ {total}", "Pagamento mínimo R$ 150,00"],
    ))
    # Bradesco: '03 DE 10'.
    docs.append(invoice(
        "bradesco_fatura", "bradesco",
        ["Banco Bradesco S.A. CNPJ 60.746.948/0001-12", "Fatura do cartão Bradescard - DOCUMENTO SINTETICO",
         "Cartão final 1111", "Data de vencimento 12/12/2026", "Total da fatura {total}"],
        [("Data", 40, "l"), ("Descrição", 110, "l"), ("Valor (R$)", 545, "r")],
        "2026-12-12", base_invoice,
        lambda iso, desc, c, d, inst: [dm(iso), desc + (f" {inst[0]:02d} DE {inst[1]:02d}" if inst else ""),
                                       ("-" if d == "income" else "") + brl(c)],
    ))
    # Inter: amounts with R$, credit lines with '+'? no: minus before R$.
    docs.append(invoice(
        "inter_fatura", "inter",
        ["Banco Inter S.A. CNPJ 00.416.968/0001-01", "Fatura do cartão Inter - DOCUMENTO SINTETICO",
         "Vencimento: 12/12/2026", "Valor total da fatura: R$ {total}"],
        [("Data", 40, "l"), ("Movimentação", 110, "l"), ("Valor", 545, "r")],
        "2026-12-12", base_invoice,
        lambda iso, desc, c, d, inst: [dm(iso), desc + (f" (Parcela {inst[0]} de {inst[1]})" if inst else ""),
                                       ("-R$ " if d == "income" else "R$ ") + brl(c)],
    ))
    # BB / Ourocard: year in the date column.
    docs.append(invoice(
        "bb_fatura", "bb",
        ["Banco do Brasil S.A. CNPJ 00.000.000/0001-91", "Fatura do cartão Ourocard - DOCUMENTO SINTETICO",
         "Vencimento 12/12/2026", "Total da fatura R$ {total}"],
        [("Data", 40, "l"), ("Descrição", 110, "l"), ("Valor R$", 545, "r")],
        "2026-12-12", base_invoice,
        lambda iso, desc, c, d, inst: [f"{iso[8:10]}/{iso[5:7]}/{iso[0:4]}",
                                       desc + (f" PARC {inst[0]:02d}/{inst[1]:02d}" if inst else ""),
                                       ("-" if d == "income" else "") + brl(c)],
    ))
    return docs


# ---------------------------------------------------------------- rendering


def render_pdf(doc: Doc) -> bytes:
    from reportlab.lib.pagesizes import A4  # noqa: PLC0415
    from reportlab.pdfgen import canvas  # noqa: PLC0415

    buffer = io.BytesIO()
    c = canvas.Canvas(buffer, pagesize=A4, invariant=1)
    c.setTitle(doc.name)
    y = PAGE_H - 50

    def cell_row(cells: list[str], bold: bool = False) -> None:
        nonlocal y
        if y < 60:
            c.showPage()
            y = PAGE_H - 50
        c.setFont("Helvetica-Bold" if bold else "Helvetica", 9)
        for (_title, x, align), text in zip(doc.columns, cells, strict=False):
            if not text:
                continue
            if align == "r":
                c.drawRightString(x, y, text)
            else:
                c.drawString(x, y, text)
        y -= 15

    c.setFont("Helvetica-Bold", 11)
    for line in doc.header:
        c.drawString(40, y, line)
        y -= 16
    y -= 8
    cell_row([title for title, _, _ in doc.columns], bold=True)
    for position, cells in doc.extra_lines:
        if position == "first":
            cell_row(_fit(cells, doc))
    for row in doc.rows:
        cell_row(row.printed)
    for position, cells in doc.extra_lines:
        if position == "last":
            cell_row(_fit(cells, doc))
    for line in doc.footer:
        c.setFont("Helvetica", 8)
        c.drawString(40, y, line)
        y -= 12
    c.showPage()
    c.save()
    return buffer.getvalue()


def _fit(cells: list[str], doc: Doc) -> list[str]:
    """Balance lines: date, label, amount in the last column."""
    if len(cells) == len(doc.columns):
        return cells
    out = [""] * len(doc.columns)
    out[0], out[1], out[-1] = cells[0], cells[1], cells[-1]
    return out


def render_image(pdf: bytes, *, variant: str = "scan", seed: int = 7, dpi: int = 200) -> bytes:
    """Rasterise page 1 and degrade it like a scan or a phone photo (PNG/JPEG bytes)."""
    import pypdfium2 as pdfium  # noqa: PLC0415
    from PIL import Image, ImageFilter  # noqa: PLC0415

    document = pdfium.PdfDocument(pdf)
    page = document[0]
    image = page.render(scale=dpi / 72).to_pil().convert("L")
    page.close()
    document.close()
    rng = random.Random(seed)
    if variant in {"scan", "photo"}:
        image = image.rotate(rng.uniform(-1.2, 1.2), expand=True, fillcolor=255, resample=Image.BICUBIC)
        image = image.filter(ImageFilter.GaussianBlur(0.6 if variant == "scan" else 0.9))
        pixels = image.load()
        for _ in range(image.width * image.height // 400):
            x, yy = rng.randrange(image.width), rng.randrange(image.height)
            pixels[x, yy] = rng.choice((0, 128, 255))
    if variant == "photo":
        image = image.rotate(90, expand=True)
    out = io.BytesIO()
    if variant == "photo":
        image.convert("RGB").save(out, format="JPEG", quality=72)
    else:
        image.save(out, format="PNG")
    return out.getvalue()
