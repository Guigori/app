"""Counts the Firestore documents each API request reads.

Every document a query or a get returns is one billed read. The meter wraps the Firestore client calls that
return documents, adds them up per request and reports the total in the `X-Finnos-Reads` response header and
in one log line per request (`finnos.reads route=... reads=...`). It changes no result and reads nothing itself.
"""
import logging
from contextvars import ContextVar
from functools import wraps

logger = logging.getLogger("finnos.reads")


class Meter:
    __slots__ = ("reads",)

    def __init__(self):
        self.reads = 0


_meter: ContextVar[Meter | None] = ContextVar("finnos_read_meter", default=None)


def start() -> Meter:
    meter = Meter()
    _meter.set(meter)
    return meter


def count(n: int = 1) -> None:
    meter = _meter.get()
    if meter is not None:
        meter.reads += n


def _counted_stream(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        for snapshot in fn(*args, **kwargs):
            count()
            yield snapshot
    return wrapper


def _counted_list(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        result = fn(*args, **kwargs)
        if isinstance(result, list):
            count(len(result))
            return result
        if hasattr(result, "__iter__") and not hasattr(result, "exists"):
            return _counted_iter(result)
        count()
        return result
    return wrapper


def _counted_iter(iterable):
    for item in iterable:
        count()
        yield item


_installed = False


def install() -> None:
    """Wraps the Firestore read calls once per process."""
    global _installed
    if _installed:
        return
    try:
        from google.cloud.firestore_v1.query import Query
        from google.cloud.firestore_v1.document import DocumentReference
        from google.cloud.firestore_v1.client import Client
    except Exception:  # pragma: no cover - Firestore not installed (tests with fakes)
        return
    # Every other read path ends in one of these three: Query.get, collection streams and gets and
    # transactional query reads go through Query.stream; transactional document reads through Client.get_all.
    Query.stream = _counted_stream(Query.stream)
    Client.get_all = _counted_stream(Client.get_all)
    DocumentReference.get = _counted_list(DocumentReference.get)
    _installed = True


def report(route: str, meter: Meter) -> None:
    logger.info("finnos.reads route=%s reads=%d", route, meter.reads)
