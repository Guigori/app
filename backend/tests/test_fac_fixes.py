import random
from datetime import date
import pytest
from lib.fac.analysis import category_change_analyses
CATS=[{"id":"c","name":"Mercado"}];AS_OF=date(2026,10,5)
def tx(i,d,v,**extra):
    t={"id":i,"date":d,"value":v,"type":"despesa","status":"pago","category_id":"c"};t.update(extra);return t
def history(value="200.00"):
    rows=[];n=0
    for m in ("07","08","09"):
        for d in (3,9,15,22,28):n+=1;rows.append(tx(f"h{n}",f"2026-{m}-{d:02d}",value))
    return rows
def run(rows):
    out=category_change_analyses(rows,CATS,as_of=AS_OF,limit=None);assert out;return out[0]
def row(d,desc,v,**k):
    x={"account_id":"a","card_id":None,"date":d,"description":desc,"value":v,"tx_type":"despesa"};x.update(k);return x
def test_reimport_same_file_is_noop():
    from lib.fac.import_reconciliation import import_keys,plan_import
    rows=[row("2026-09-10","Mercado Extra","80.00"),row("2026-09-11","Padaria","12.00")];keys=import_keys("u",rows);new,skipped=plan_import(import_keys("u",rows),set(keys));assert new==[] and sorted(skipped)==[0,1]
def test_overlapping_statements_do_not_duplicate():
    from lib.fac.import_reconciliation import import_keys,plan_import
    a=[row("2026-09-10","Mercado Extra","80.00"),row("2026-09-20","Farmacia","45.00")];b=[row("2026-09-05","Padaria","9.00"),row("2026-09-10","Mercado Extra","80.00"),row("2026-09-20","Farmacia","45.00"),row("2026-10-02","Posto","200.00")]
    new,skipped=plan_import(import_keys("u",b),set(import_keys("u",a)));assert sorted(new)==[0,3] and sorted(skipped)==[1,2]
def test_two_identical_legit_purchases_same_day_both_kept():
    from lib.fac.import_reconciliation import import_keys,plan_import
    rows=[row("2026-09-10","Cafe Padaria","12.00")]*2;keys=import_keys("u",rows);assert len(set(keys))==2 and sorted(plan_import(keys,set())[0])==[0,1] and plan_import(import_keys("u",rows),set(keys))[0]==[]
def test_overlap_with_only_one_of_two_identical_does_not_create_third():
    from lib.fac.import_reconciliation import import_keys,plan_import
    both=[row("2026-09-10","Cafe Padaria","12.00")]*2;assert plan_import(import_keys("u",[row("2026-09-10","Cafe Padaria","12.00")]),set(import_keys("u",both)))[0]==[]
def test_keys_are_user_scoped():
    from lib.fac.import_reconciliation import import_keys
    r=[row("2026-09-10","Mercado","80.00")];assert import_keys("u1",r)!=import_keys("u2",r)
def test_critical_severity_is_reachable():
    a=run(history()+[tx(f"c{i}",f"2026-10-0{i}","900.00") for i in range(1,5)]);assert a["delta_percent"]>=75 and a["delta_cents"]>=30000 and a["severity"]=="critical"
def test_conclusion_names_dominant_driver():
    a=run(history()+[tx(f"c{i}",f"2026-10-0{i}","900.00") for i in range(1,5)]);expected={"ticket":"valor por compra","frequency":"compras"}[a["drivers"][0]["kind"]];assert expected in a["conclusion"].lower() and "decomposta de forma aditiva" not in a["conclusion"].lower()
def test_ticket_driver_is_labeled_as_residual():
    a=run(history()+[tx(f"c{i}",f"2026-10-0{i}","900.00") for i in range(1,5)]);assert "resíduo" in next(d for d in a["drivers"] if d["kind"]=="ticket")["label"].lower()
@pytest.mark.parametrize("seed",range(200))
def test_property_drivers_sum_to_delta(seed):
    rng=random.Random(seed);rows=[tx(f"h{i}",f"2026-{m}-{d:02d}",f"{rng.randint(50,600)}.{rng.randint(0,99):02d}") for i,(m,d) in enumerate([(m,d) for m in ("07","08","09") for d in rng.sample(range(1,28),5)])];rows += [tx(f"c{i}",f"2026-10-0{i}",f"{rng.randint(50,1500)}.{rng.randint(0,99):02d}") for i in range(1,rng.randint(2,5))]
    for a in category_change_analyses(rows,CATS,as_of=AS_OF,limit=None):assert sum(d["contribution_cents"] for d in a["drivers"])==a["delta_cents"]
def test_no_tautological_assert_in_production_code():
    import inspect,lib.fac.analysis as mod
    assert "assert " not in inspect.getsource(mod)
def refund(i,d,v,parent=None,**extra):return tx(i,d,v,type="receita",transaction_role="refund",related_transaction_id=parent,**extra)
def test_refund_in_current_month_reduces_current_not_baseline():
    b=history()+[tx(f"c{i}",f"2026-10-0{i}","900.00") for i in range(1,5)];a0=run(b);a1=run(b+[refund("rf","2026-10-03","100.00",parent="h11")]);assert a1["current_value_cents"]==a0["current_value_cents"]-10000 and a1["baseline_value_cents"]==a0["baseline_value_cents"]
def test_refund_of_current_purchase_reduces_current():
    b=history()+[tx(f"c{i}",f"2026-10-0{i}","900.00") for i in range(1,5)];a0=run(b);a1=run(b+[refund("rf","2026-10-04","300.00",parent="c1")]);assert a1["current_value_cents"]==a0["current_value_cents"]-30000
def test_refund_dated_in_history_reduces_that_month_only():
    b=history()+[tx(f"c{i}",f"2026-10-0{i}","900.00") for i in range(1,5)];a0=run(b);a1=run(b+[refund("rf","2026-08-20","100.00",parent="h6")]);assert a1["current_value_cents"]==a0["current_value_cents"] and a1["baseline_value_cents"]<a0["baseline_value_cents"]
def test_refund_is_not_counted_as_an_occurrence():
    b=history()+[tx(f"c{i}",f"2026-10-0{i}","900.00") for i in range(1,5)];ids=next(e for e in run(b+[refund("rf","2026-10-03","100.00",parent="c1")])["evidence"] if e["label"]=="Gasto atual")["source_ids"];assert sum(1 for i in ids if i.startswith("c"))==4
def test_future_refund_ignored():
    b=history()+[tx(f"c{i}",f"2026-10-0{i}","900.00") for i in range(1,5)];assert run(b+[refund("rf","2026-10-25","100.00",parent="c1")])["current_value_cents"]==run(b)["current_value_cents"]
def test_orphan_refund_without_category_does_not_crash_or_count():
    b=history()+[tx(f"c{i}",f"2026-10-0{i}","900.00") for i in range(1,5)];o=refund("rf","2026-10-03","100.00");o.pop("category_id");assert run(b+[o])["current_value_cents"]==run(b)["current_value_cents"]
