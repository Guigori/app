"""AUD-12: one browser push endpoint belongs to one account at a time.

Synthetic registry only; no real push is sent and no Firebase project is used.
"""
import asyncio
from types import SimpleNamespace

from finnos.models.notify import PushSubscriptionIn
from finnos.routers import push

ENDPOINT = "https://fcm.googleapis.com/fcm/send/synthetic-device"


class Doc:
    def __init__(self, registry, key):
        self.registry, self.key = registry, key

    def set(self, value):
        self.registry[self.key] = value

    def delete(self):
        self.registry.pop(self.key, None)


class Collection:
    def __init__(self, registry):
        self.registry = registry

    def document(self, key):
        return Doc(self.registry, key)

    def where(self, field, op, value):
        assert (field, op) == ("subscription.endpoint", "==")
        rows = [SimpleNamespace(to_dict=lambda v=v: v, reference=Doc(self.registry, k))
                for k, v in list(self.registry.items()) if v["subscription"]["endpoint"] == value]
        return SimpleNamespace(stream=lambda: rows)


def test_new_account_on_same_device_removes_previous_owner(monkeypatch):
    registry = {}
    monkeypatch.setattr(push, "ready", lambda: True)
    monkeypatch.setattr(push, "gateway", lambda endpoint: None)
    monkeypatch.setattr(push, "_registration_collection", lambda: Collection(registry))
    payload = PushSubscriptionIn(endpoint=ENDPOINT, keys={"p256dh": "k" * 20, "auth": "a" * 16})

    asyncio.run(push.subscribe_push(payload, user={"id": "test-a"}))
    asyncio.run(push.subscribe_push(payload, user={"id": "test-b"}))

    owners = {value["uid"] for value in registry.values()}
    assert owners == {"test-b"}
    # Re-enrolling the same account stays idempotent.
    asyncio.run(push.subscribe_push(payload, user={"id": "test-b"}))
    assert len(registry) == 1
