"""The read meter adds up the documents a request reads without changing what it returns."""
from finnos.lib import read_meter


def test_counts_streamed_documents_and_single_gets():
    meter = read_meter.start()
    stream = read_meter._counted_stream(lambda: iter(["a", "b", "c"]))
    assert list(stream()) == ["a", "b", "c"]

    class Snap:
        exists = True
    single = read_meter._counted_list(lambda: Snap())
    single()
    assert meter.reads == 4


def test_no_meter_no_count():
    read_meter._meter.set(None)
    assert list(read_meter._counted_stream(lambda: iter([1, 2]))()) == [1, 2]


def test_install_keeps_firestore_working():
    read_meter.install()
    read_meter.install()  # once per process
    from google.cloud.firestore_v1.query import Query
    assert Query.stream.__name__ == "stream"
