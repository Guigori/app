"""Descobertas FINNOS no servidor: o que ficou vermelho e merece um aviso mesmo com o app fechado.

O app calcula as Descobertas na tela; aqui ficam só as críticas, as que pedem ação, para o disparo
diário do push: saldo negativo, mês gastando mais do que entra, regra 50/30/20 ou orçamento do ciclo
acima do limite, cartão perto do limite e categoria que disparou em relação ao mês passado.

Cada aviso tem um id que muda quando a situação muda (mês, cartão, categoria), então a mesma
descoberta é enviada uma vez, e volta só se for uma situação nova.
"""
from decimal import Decimal

from finnos.lib.dates import today_iso
from finnos.lib.stats import add_months


def _brl(value) -> str:
    amount = Decimal(str(value)).quantize(Decimal("0.01"))
    text = f"{abs(amount):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return ("−R$ " if amount < 0 else "R$ ") + text


def build(dash: dict, prev: dict | None, cards: list[dict], cycle: dict | None, month: str) -> list[dict]:
    """Pure: from the month's dashboard (and last month's), the cards and the budget cycle, the red discoveries.

    Each item: id, title, body, url. Kept small: at most five, the most serious first.
    """
    out: list[dict] = []
    total = Decimal(str(dash.get("total_balance") or 0))
    income = Decimal(str(dash.get("income") or 0))
    expense = Decimal(str(dash.get("expense") or 0))
    if total < 0:
        out.append({"id": f"descoberta-saldo-negativo-{month}", "title": "Saldo das contas negativo",
                    "body": f"Suas contas somam {_brl(total)}. Veja o que sai até a próxima entrada.", "url": "/analise/painel/previsao-saldo"})
    if income > 0 and expense > income:
        out.append({"id": f"descoberta-gastos-passaram-renda-{month}", "title": "Os gastos passaram a renda do mês",
                    "body": f"Saíram {_brl(expense)} e entraram {_brl(income)} neste mês.", "url": "/analise/painel/resultado-mes"})
    if cycle and cycle.get("pace") == "acima":
        out.append({"id": f"descoberta-orcamento-ritmo-{cycle.get('cycle_id')}", "title": "Orçamento mais rápido que o ciclo",
                    "body": f"Já foi {round(float(cycle.get('used_percent') or 0))}% do orçamento com {round(float(cycle.get('elapsed_percent') or 0))}% do ciclo.", "url": "/analise/painel/meu-orcamento"})
    else:
        over = [r for r in (dash.get("rule") or []) if r.get("status") == "acima"]
        if over:
            names = " e ".join(r.get("label", "") for r in over[:2])
            out.append({"id": f"descoberta-regra-{month}-{'-'.join(r.get('key', '') for r in over)}", "title": "Regra 50/30/20 acima do limite",
                        "body": f"{names} passou da parte da renda que caberia.", "url": "/analise/painel/regra-50-30-20"})
    for card in cards:
        limit, used = float(card.get("limit") or 0), float(card.get("used") or 0)
        if card.get("active", True) and limit > 0 and used / limit >= 0.9:
            out.append({"id": f"descoberta-limite-{card.get('id')}-{month}", "title": f"Cartão {card.get('name')} perto do limite",
                        "body": f"{round(used / limit * 100)}% do limite usado: sobram {_brl(max(0.0, limit - used))}.", "url": "/analise/painel/limite-cartoes"})
    if prev:
        before = {c.get("category_id") or c.get("name"): float(c.get("total") or 0) for c in prev.get("categories") or []}
        for c in dash.get("categories") or []:
            now, was = float(c.get("total") or 0), before.get(c.get("category_id") or c.get("name"), 0.0)
            if was > 0 and now - was >= 200 and now >= was * 1.5:
                out.append({"id": f"descoberta-subiu-{month}-{c.get('category_id') or c.get('name')}", "title": f"{c.get('name')} disparou neste mês",
                            "body": f"{_brl(now)} contra {_brl(was)} no mês passado.", "url": "/analise/painel/categorias-subiram"})
                break
    return out[:5]


async def critical(uid: str) -> list[dict]:
    """The red discoveries of one person, read with the same rules the app uses on screen."""
    # Imported here: the routers import this module's package.
    from finnos.routers.budgets import current_cycle, cycle_progress
    from finnos.routers.cards import list_cards
    from finnos.routers.dashboard import dashboard

    user = {"id": uid}
    month = today_iso()[:7]
    dash = (await dashboard(month=month, user=user)).model_dump(mode="json")
    try:
        prev = (await dashboard(month=add_months(month, -1), user=user)).model_dump(mode="json")
    except Exception:
        prev = None
    try:
        cards = [c.model_dump(mode="json") for c in await list_cards(user=user)]
    except Exception:
        cards = []
    cycle = None
    try:
        current = await current_cycle(user=user)
        if current:
            cycle = (await cycle_progress(current.id, user=user)).model_dump(mode="json")
    except Exception:
        cycle = None
    return build(dash, prev, cards, cycle, month)
