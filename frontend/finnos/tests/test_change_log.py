"""finnos.lib.change_log without Firestore: what an entry stores (no nested arrays) and how gaps are refused."""
from finnos.lib import change_log


class Tr:
    def __init__(self):
        self.writes = []

    def set(self, ref, data):
        self.writes.append(data)


class Parent:
    def collection(self, name):
        return self

    def document(self, doc_id):
        return doc_id


def test_entry_is_flat_strings():
    tr = Tr()
    change_log.write(tr, Parent(), 7, {("transactions", "b"), ("accounts", "a")})
    entry = tr.writes[0]
    assert entry == {"rev": 7, "docs": ["accounts/a", "transactions/b"], "truncated": False}
    assert all(isinstance(item, str) for item in entry["docs"])


def test_too_far_behind_or_backwards_asks_for_the_whole_copy():
    assert change_log.read("u", 10, 10 + change_log.MAX_STEPS + 1) is None
    assert change_log.read("u", 10, 9) is None
    assert change_log.read("u", 10, 10) == []
