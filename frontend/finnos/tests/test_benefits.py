"""Etapa 5: cartão de benefício com até 8 sub-benefícios. Recarga sem duplicar,
saldo que acumula, saldo por benefício separado do banco e escolha do
benefício no registro. Synthetic data only."""
from datetime import date, timedelta
from decimal import Decimal

import pytest
from fastapi import HTTPException

from finnos.lib import benefits
from finnos.lib import db as store
from finnos.lib import history
from finnos.lib.stats import balance_effects
from finnos.tests.test_reconciliations import Tx, World

TODAY = "2026-11-12"
NAMES = ["Refeição", "Alimentação", "Mobilidade", "Cultura", "Saúde", "Educação", "Home office", "Combustível"]


def eight(start="2026-01-01"):
    raw = [{"id": f"w{i}", "name": n, "monthly_amount": 100 * (i + 1), "day": [1, 5, 10, 15, 20, 25, 28, 31][i],
            "is_default": i == 0} for i, n in enumerate(NAMES)]
    return benefits.normalize_wallets(raw, today=start)


def account(wallets=None, **extra):
    return {"id": "vr", "name": "Caju", "type": "beneficio", "initial_balance": Decimal("0"),
            "wallets": wallets if wallets is not None else eight(), **extra}


# ---------------------------------------------------------------- registration of the benefits

def test_up_to_eight_benefits_with_unique_names_and_one_default():
    wallets = eight()
    assert len(wallets) == 8 and sum(w["is_default"] for w in wallets) == 1
    with pytest.raises(HTTPException) as nine:
        benefits.normalize_wallets([{"name": f"B{i}", "day": 1} for i in range(9)], today=TODAY)
    assert nine.value.status_code == 422
    with pytest.raises(HTTPException):
        benefits.normalize_wallets([{"name": "Refeição", "day": 1}, {"name": "refeicao", "day": 2}], today=TODAY)


def test_default_is_picked_when_none_marked_and_history_blocks_removal():
    wallets = benefits.normalize_wallets([{"name": "A", "day": 1}, {"name": "B", "day": 2}], today=TODAY)
    assert [w["is_default"] for w in wallets] == [True, False]
    keep = [w for w in wallets if w["name"] == "A"]
    assert len(benefits.normalize_wallets(keep, wallets, today=TODAY)) == 1  # unused: may go
    with pytest.raises(HTTPException) as used:
        benefits.normalize_wallets(keep, wallets, today=TODAY, in_use={wallets[1]["id"]})
    assert used.value.status_code == 409


def test_editing_keeps_the_start_date_so_nothing_is_back_filled():
    wallets = eight("2026-03-10")
    edited = benefits.normalize_wallets([dict(w, monthly_amount=1) for w in wallets], wallets, today=TODAY)
    assert {w["start"] for w in edited} == {"2026-03-10"}


# ---------------------------------------------------------------- recharge

def test_recharge_day_31_falls_on_the_last_day_of_short_months():
    wallet = {"day": 31}
    assert benefits.recharge_date(wallet, 2026, 2) == date(2026, 2, 28)
    assert benefits.recharge_date(wallet, 2028, 2) == date(2028, 2, 29)
    assert benefits.recharge_date(wallet, 2026, 4) == date(2026, 4, 30)


def test_simulated_month_eight_benefits_each_recharged_once_on_its_day():
    acc = account()
    seen: dict[str, str] = {}
    day = date(2026, 11, 1)
    while day <= date(2026, 11, 30):
        for wallet, competence, when in benefits.due_recharges(acc, day):
            key = benefits.recharge_id("uid", acc["id"], wallet["id"], competence)
            seen.setdefault(key, f"{wallet['name']}@{when}")
        day += timedelta(days=1)
    november = sorted(v for v in seen.values() if "@2026-11" in v)
    assert len(november) == 8
    assert "Combustível@2026-11-30" in november and "Refeição@2026-11-01" in november


def test_no_recharge_before_the_benefit_existed():
    acc = account(eight("2026-11-12"))
    due = benefits.due_recharges(acc, date(2026, 11, 12))
    assert {w["name"] for w, *_ in due} == set()  # every day of november before the 12th is gone
    due = benefits.due_recharges(acc, date(2026, 11, 15))
    assert {w["name"] for w, *_ in due} == {"Cultura"}  # day 15


@pytest.fixture
def world(monkeypatch):
    w = World()
    w.table("accounts")["vr"] = store.encode(account())
    w.table("accounts")["itau"] = store.encode({"id": "itau", "name": "Itaú", "type": "corrente",
                                                "initial_balance": Decimal("500")})

    def movements(db, uid, account_id, transaction):
        rows = [dict(store.decode(v), id=k) for k, v in w.table("transactions").items()]
        return [r for r in rows if account_id in (r.get("account_id"), r.get("to_account_id"))]

    monkeypatch.setattr(store, "client", lambda: object())
    monkeypatch.setattr(store, "root", lambda db, uid: w)
    monkeypatch.setattr(store, "atomic", lambda db, uid, fn: fn(Tx()))
    monkeypatch.setattr(store, "account_movement_rows", movements)
    monkeypatch.setattr(history, "record_event", lambda *a, **k: None)
    return w


def rows(w):
    return [dict(store.decode(v), id=k) for k, v in w.table("transactions").items()]


def test_running_twice_or_from_two_phones_creates_each_recharge_once(world):
    first = benefits.run_recharges("uid", date(2026, 11, 12))
    again = benefits.run_recharges("uid", date(2026, 11, 12))
    assert again == []
    # 12/11: Nov days 1, 5, 10 plus all eight of October.
    assert len(first) == 11 and len(rows(world)) == 11
    later = benefits.run_recharges("uid", date(2026, 11, 30))
    assert {d["name"] for d in later} == {f"Recarga {n}" for n in NAMES[3:]}
    assert all(d["benefit_recharge"] and d["type"] == "receita" for d in rows(world))


def test_balance_accumulates_month_after_month_and_stays_apart_from_the_bank(world):
    benefits.run_recharges("uid", date(2026, 10, 31))
    benefits.run_recharges("uid", date(2026, 11, 30))
    acc = account()
    balances = benefits.wallet_balances(acc, rows(world), "2026-11-30")
    by_name = {w["name"]: balances[w["id"]] for w in acc["wallets"]}
    # The job looks back one month, so the first run also caught September. Never expires: all three stay.
    assert by_name["Refeição"] == 3 * 10000
    assert by_name["Combustível"] == 3 * 80000
    assert all(a != "itau" for d in rows(world) for a, _ in balance_effects(d, "2026-11-30"))


# ---------------------------------------------------------------- spending from a benefit

def write(world, doc, original=None):
    store._check_benefit_wallet(object(), "uid", doc, None, original, TODAY)
    world.table("transactions")[doc["id"]] = store.encode(doc)
    return doc


def spend(id, value, wallet_id=None, **extra):
    return {"id": id, "name": "Almoço", "value": Decimal(value), "type": "despesa", "status": "pago",
            "date": TODAY, "account_id": "vr", "card_id": None, "to_account_id": None, "wallet_id": wallet_id, **extra}


def test_purchase_without_benefit_uses_the_default_and_is_checked(world):
    benefits.run_recharges("uid", date(2026, 11, 12))  # Refeição: R$ 100 Oct + R$ 100 Nov
    doc = write(world, spend("t1", "150.00"))
    assert doc["wallet_id"] == account()["wallets"][0]["id"]
    with pytest.raises(HTTPException) as short:
        write(world, spend("t2", "60.00"))
    assert short.value.detail["code"] == "saldo_beneficio_insuficiente"
    assert short.value.detail["available"] == 50


def test_choosing_another_benefit_at_registration(world):
    benefits.run_recharges("uid", date(2026, 11, 12))
    wallets = {w["name"]: w["id"] for w in account()["wallets"]}
    write(world, spend("t1", "300.00", wallets["Alimentação"]))  # R$ 200 + R$ 200
    balances = benefits.wallet_balances(account(), rows(world), TODAY)
    assert balances[wallets["Alimentação"]] == 10000 and balances[wallets["Refeição"]] == 20000


def test_benefit_of_another_card_is_refused(world):
    with pytest.raises(HTTPException) as wrong:
        write(world, spend("t1", "1.00", "nao-existe"))
    assert wrong.value.status_code == 422


def test_benefit_that_may_go_negative(world):
    wallets = account()["wallets"]
    wallets[0]["allow_negative"] = True
    world.table("accounts")["vr"] = store.encode(account(wallets))
    write(world, spend("t1", "999.00"))  # allowed


def test_move_between_two_benefits_keeps_the_card_total(world):
    benefits.run_recharges("uid", date(2026, 11, 12))
    wallets = {w["name"]: w["id"] for w in account()["wallets"]}
    move = {"id": "m1", "name": "Mover", "value": Decimal("150.00"), "type": "transferencia", "status": "pago",
            "date": TODAY, "account_id": "vr", "to_account_id": "vr", "card_id": None,
            "wallet_id": wallets["Mobilidade"], "to_wallet_id": wallets["Refeição"]}
    write(world, move)
    assert balance_effects(move, TODAY) == []
    balances = benefits.wallet_balances(account(), rows(world), TODAY)
    assert balances[wallets["Refeição"]] == 35000 and balances[wallets["Mobilidade"]] == 45000
    with pytest.raises(HTTPException):
        write(world, dict(move, id="m2", value=Decimal("500.00")))


def test_renaming_a_purchase_is_not_checked_again(world):
    benefits.run_recharges("uid", date(2026, 11, 12))
    doc = write(world, spend("t1", "200.00"))
    write(world, dict(doc, name="Almoço com cliente"), original=doc)


def test_pace_daily_allowance_and_run_out_date():
    acc = account()
    wallet = acc["wallets"][0]  # day 1
    txs = [spend(f"p{i}", "10.00", wallet["id"]) | {"date": f"2026-11-{i:02d}"} for i in range(1, 11)]
    out = benefits.pace(wallet, 5000, txs, acc, date(2026, 11, 12))
    assert out["next_recharge"] == "2026-12-01"
    assert round(out["daily_allowance"], 2) == round(50 / 19, 2)
    assert out["runs_out_on"] == "2026-11-27"  # R$ 100 in 30 days → R$ 3,33/day → 15 days


# ---------------------------------------------------------------- etapa 6: final do cartão

def test_card_last_digits_are_four_numbers_or_cleared():
    from pydantic import ValidationError
    from finnos.models.cards import CardIn
    from finnos.routers.cards import _payload

    base = {"name": "Roxinho", "limit": 1000, "closing_day": 1, "due_day": 10}
    assert _payload(CardIn(**base, last_digits="1234"))["last_digits"] == "1234"
    assert _payload(CardIn(**base, last_digits=""))["last_digits"] is None  # cleared
    assert "last_digits" not in _payload(CardIn(**base))  # older clients keep what is stored
    for wrong in ("123", "12345", "12a4", "4111111111111111"):
        with pytest.raises(ValidationError):
            CardIn(**base, last_digits=wrong)
