from finnos.lib.server_discoveries import build


def test_red_discoveries_from_the_month():
    dash = {"total_balance": -150, "income": 3000, "expense": 3500,
            "rule": [{"key": "desejos", "label": "Desejos", "status": "acima"}],
            "categories": [{"category_id": "m", "name": "Mercado", "total": 900}]}
    prev = {"categories": [{"category_id": "m", "name": "Mercado", "total": 400}]}
    cards = [{"id": "c6", "name": "C6", "limit": 1000, "used": 950, "active": True}]
    items = build(dash, prev, cards, None, "2026-11")
    ids = [i["id"] for i in items]
    assert ids[0] == "descoberta-saldo-negativo-2026-11"
    assert "descoberta-gastos-passaram-renda-2026-11" in ids
    assert any(i.startswith("descoberta-regra-2026-11") for i in ids)
    assert any(i.startswith("descoberta-limite-c6") for i in ids)
    assert any(i.startswith("descoberta-subiu-2026-11") for i in ids)
    assert len(items) == 5
    assert items[0]["body"] == "Suas contas somam −R$ 150,00. Veja o que sai até a próxima entrada."


def test_a_calm_month_sends_nothing():
    dash = {"total_balance": 5000, "income": 6000, "expense": 2000, "rule": [], "categories": []}
    assert build(dash, None, [], {"pace": "no_ritmo"}, "2026-11") == []


def test_budget_cycle_ahead_of_time_replaces_the_rule():
    dash = {"total_balance": 10, "income": 0, "expense": 0, "rule": [{"key": "desejos", "label": "Desejos", "status": "acima"}], "categories": []}
    items = build(dash, None, [], {"pace": "acima", "cycle_id": "c1", "used_percent": 80, "elapsed_percent": 40}, "2026-11")
    assert [i["id"] for i in items] == ["descoberta-orcamento-ritmo-c1"]
