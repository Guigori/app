"""FIINT learning memory must never leak across users or invent categories."""
from lib.fiint.memory import merchant_key, learned_category


def test_normalization():
    assert merchant_key("Padaría São José") == "padaria sao jose"


def test_memory_matches_confirmed_category_only():
    categories = [{"id": "food", "name": "Alimentação"}]
    memories = [{"merchant": "padaria sao jose", "category_id": "food"}]
    assert learned_category("Comprei na Padaria São José", memories, categories) == "food"
    assert learned_category("Comprei na farmácia", memories, categories) is None
    assert learned_category("Padaria São José", memories, []) is None


def test_unrecognized_categories_not_reused():
    assert learned_category(
        "Padaria", [{"merchant": "padaria", "category_id": "other"}],
        [{"id": "food", "name": "Alimentação"}],
    ) is None
