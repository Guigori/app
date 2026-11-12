"""Turn positioned words/boxes (PDF words or OCR boxes) into ordered lines."""
from __future__ import annotations

from collections.abc import Iterable

from finnos.document_intelligence.models import TextSpan, Word


def _height(word: Word) -> float:
    return max(word.bottom - word.top, 1e-6)


def group_into_lines(words: Iterable[Word], *, page: int, line_tolerance: float = 0.5) -> list[TextSpan]:
    """Group normalised word boxes into reading-order lines.

    A word joins the current line when its vertical centre is within
    ``line_tolerance`` × the line's typical text height. The typical height is
    the median, so punctuation ('-', '.') never shrinks the tolerance.
    """
    ordered = sorted((w for w in words if w.text.strip()), key=lambda w: ((w.top + w.bottom) / 2, w.x0))
    lines: list[list[Word]] = []
    for word in ordered:
        centre = (word.top + word.bottom) / 2
        if lines:
            last = lines[-1]
            last_centre = sum((w.top + w.bottom) / 2 for w in last) / len(last)
            typical = sorted(_height(w) for w in last)[len(last) // 2]
            if abs(centre - last_centre) <= line_tolerance * max(_height(word), typical):
                last.append(word)
                continue
        lines.append([word])
    return [to_span(line, page) for line in lines]


def merge_rows(spans: list[TextSpan], *, page: int, min_overlap: float = 0.5) -> list[TextSpan]:
    """Join line pieces that sit on the same visual row (vertical overlap)."""
    pieces = sorted((s for s in spans if s.words and s.bounding_box),
                    key=lambda s: (s.bounding_box[1], s.bounding_box[0]))
    rows: list[list[Word]] = []
    bands: list[tuple[float, float]] = []
    for span in pieces:
        top, bottom = span.bounding_box[1], span.bounding_box[3]
        for index, (row_top, row_bottom) in enumerate(bands):
            overlap = min(bottom, row_bottom) - max(top, row_top)
            smaller = max(min(bottom - top, row_bottom - row_top), 1e-6)
            if overlap / smaller >= min_overlap:
                rows[index].extend(span.words)
                bands[index] = (min(top, row_top), max(bottom, row_bottom))
                break
        else:
            rows.append(list(span.words))
            bands.append((top, bottom))
    order = sorted(range(len(rows)), key=lambda i: bands[i][0])
    return [to_span(rows[i], page) for i in order]


def to_span(line: list[Word], page: int) -> TextSpan:
    line = sorted(line, key=lambda w: w.x0)
    text = " ".join(w.text.strip() for w in line)
    box = (
        max(0.0, min(w.x0 for w in line)),
        max(0.0, min(w.top for w in line)),
        min(1.0, max(w.x1 for w in line)),
        min(1.0, max(w.bottom for w in line)),
    )
    # The weakest word that carries digits decides: amounts and dates live there.
    digit_conf = [w.confidence for w in line if any(ch.isdigit() for ch in w.text)]
    mean_conf = sum(w.confidence for w in line) / len(line)
    confidence = min([mean_conf, *digit_conf])
    return TextSpan(text=text, page=page, bounding_box=box, confidence=round(confidence, 4), words=tuple(line))


def clamp_box(x0: float, top: float, x1: float, bottom: float, width: float, height: float) -> tuple[float, float, float, float]:
    def c(value: float) -> float:
        return min(1.0, max(0.0, value))

    nx0, nx1 = sorted((c(x0 / width), c(x1 / width)))
    ntop, nbottom = sorted((c(top / height), c(bottom / height)))
    return nx0, ntop, nx1, nbottom
