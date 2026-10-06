from datetime import date, datetime, timezone
import pytest
from lib.fac.money import money_to_cents
from lib.fac.events import affected_modules,set_observer
from lib.fac.identity import deterministic_analysis_id
from lib.fac.state import FACState,calculate_liquidity
from lib.fac.analysis import category_change_analyses
from lib.fac.import_reconciliation import import_row_fingerprint,manual_match
from lib.fac.clock import financial_today

def tx(i,d,v,role="purchase",typ="despesa",parent=None):
    return {"id":f"tx-{i}","date":d.isoformat(),"value":v,"type":typ,"status":"pago","category_id":"food","transaction_role":role,"related_transaction_id":parent,"account_id":"a1"}
def dataset():
    rows=[];i=0
    for m in (7,8,9):
        for day in (5,20):
            i+=1;rows.append(tx(i,date(2026,m,day),"100.00"))
    for day in (2,4,6,8):
        i+=1;rows.append(tx(i,date(2026,10,day),"300.00"))
    return rows
def analysis(rows=None,as_of=date(2026,10,10)):
    return category_change_analyses(rows or dataset(),[{"id":"food","name":"Alimentação"}],as_of=as_of)[0]

def test_package_structure_contract():
    import lib.fac
    assert hasattr(lib.fac,"FACState") and hasattr(lib.fac,"calculate_liquidity")
def test_liquidity_and_credit_not_cash():
    a=calculate_liquidity(balance_cents=100000,known_commitments_cents=20000,protected_cents=10000,safety_margin_cents=5000,credit_limit_cents=999999)
    b=calculate_liquidity(balance_cents=100000,known_commitments_cents=20000,protected_cents=10000,safety_margin_cents=5000,credit_limit_cents=0)
    assert a.free_to_decide_cents==65000 and a==b
@pytest.mark.parametrize("v,e",[("10.005",1001),("0.29",29),("-1.005",-101),("0",0),("9999999.99",999999999)])
def test_money(v,e):assert money_to_cents(v)==e
def test_drivers_exactly_reconcile_delta():
    a=analysis();assert sum(d["contribution_cents"] for d in a["drivers"])==a["delta_cents"]
def test_refund_reduces_purchase():
    rows=dataset();rows.append(tx(500,date(2026,10,9),"30.00","refund",parent="tx-7"));assert analysis(rows)["current_value_cents"]==117000
def test_full_reversal_zeroes_linked_purchase():
    rows=dataset();rows.append(tx(500,date(2026,10,9),"300.00","reversal",parent="tx-7"));assert analysis(rows)["current_value_cents"]==90000
def test_card_payment_and_transfer_do_not_spend():
    base=analysis()["current_value_cents"];rows=dataset()+[tx(600,date(2026,10,9),"9999","card_payment"),tx(601,date(2026,10,9),"9999","own_transfer","transferencia")]
    assert analysis(rows)["current_value_cents"]==base
def test_match_rejects_shared_stopword_only():
    assert manual_match({"value":"100","account_id":"a1","description":"Pagamento boleto luz"},{"value":"100","account_id":"a1","name":"Pagamento aluguel"},1).level=="none"
def test_match_accepts_equivalent():
    assert manual_match({"value":"38.60","account_id":"a1","description":"PIX UBER TRIP"},{"value":"38.60","account_id":"a1","name":"Uber Trip"},2).level=="high"
def test_fingerprint_same_row_stable_but_duplicate_legit_rows_distinct():
    kw=dict(user_id="u",account_id="a",card_id=None,source_id="sha256:file",date="2026-10-05",description="Uber Trip",value="38.60",tx_type="despesa")
    a=import_row_fingerprint(row_sequence=7,**kw);assert a==import_row_fingerprint(row_sequence=7,**kw);assert a!=import_row_fingerprint(row_sequence=8,**kw)
def test_baseline_excludes_current_and_future():
    base=analysis();changed=analysis(dataset()+[tx(900,date(2026,10,30),"9999")])
    assert changed["baseline_value_cents"]==base["baseline_value_cents"] and changed["current_value_cents"]==base["current_value_cents"]
def test_gate_needs_three_periods_and_six_observations():
    rows=[tx(i,date(2026,9,1+i),"100") for i in range(6)]+[tx(20+i,date(2026,10,1+i),"500") for i in range(3)]
    assert category_change_analyses(rows,[{"id":"food","name":"Alimentação"}],as_of=date(2026,10,10))==[]
def test_lineage_present():
    assert all(e["source_ids"] for e in analysis()["evidence"])
def test_unknown_event_raises_and_observes():
    seen=[];set_observer(lambda name,payload:seen.append((name,payload)))
    with pytest.raises(ValueError):affected_modules("bad.event")
    assert seen and seen[0][0]=="fac.unknown_event";set_observer(None)
def test_identity_stable_and_sanitized():
    x=deterministic_analysis_id("Spending Change","Category","Food / Café","2026-10");assert x=="analysis:spending-change:category:food-cafe:2026-10" and "/" not in x and " " not in x
def test_timezone_uses_sao_paulo_financial_day():
    assert financial_today(now=datetime(2026,10,6,1,30,tzinfo=timezone.utc),timezone_name="America/Sao_Paulo")==date(2026,10,5)
def test_no_naive_early_month_projection():
    a=analysis(as_of=date(2026,10,10));assert a["projection"]["status"]=="preliminary" and a["projection"]["expected_cents"] is None
def test_state_mutable_defaults_isolated():
    a,b=FACState(),FACState();a.active_analysis_ids.append("x");assert b.active_analysis_ids==[]
