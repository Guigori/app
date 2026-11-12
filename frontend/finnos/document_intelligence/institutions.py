"""Deterministic issuer identification for the first five supported banks.

Ids match the FINNOS institution catalog (finnos/lib/institution_catalog.py on
the wallet branch) so a reviewed document can point at the same institution.
A CNPJ or the bank's legal name is strong evidence; a bare brand word is weak,
because statements mention other banks all the time ("PIX ENVIADO NUBANK").
"""
from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass

from finnos.document_intelligence.models import Evidence, ExtractedField, TextSpan, ValidationStatus
from finnos.document_intelligence.normalization import fold


@dataclass(frozen=True)
class InstitutionProfile:
    id: str
    name: str
    compe: str  # código do banco
    cnpjs: tuple[str, ...]
    strong: tuple[str, ...]  # legal names / document headers (folded)
    weak: tuple[str, ...]  # brand words (folded)


PROFILES: tuple[InstitutionProfile, ...] = (
    InstitutionProfile(
        "nubank", "Nubank", "260",
        ("18.236.120/0001-58", "30.680.829/0001-43"),
        ("nu pagamentos", "nubank s.a", "nu financeira"),
        ("nubank",),
    ),
    InstitutionProfile(
        "itau", "Itaú", "341",
        ("60.701.190/0001-04", "60.872.504/0001-23", "17.192.451/0001-70"),
        ("itau unibanco", "banco itaucard", "itaucard"),
        ("itau",),
    ),
    InstitutionProfile(
        "inter", "Inter", "077",
        ("00.416.968/0001-01",),
        ("banco inter s.a", "banco inter sa", "inter&co"),
        ("banco inter", "inter"),
    ),
    InstitutionProfile(
        "bradesco", "Bradesco", "237",
        ("60.746.948/0001-12", "59.438.325/0001-01"),
        ("banco bradesco s.a", "banco bradesco sa", "bradescard", "bradesco cartoes"),
        ("bradesco",),
    ),
    InstitutionProfile(
        "bb", "Banco do Brasil", "001",
        ("00.000.000/0001-91",),
        ("banco do brasil s.a", "banco do brasil sa", "ourocard"),
        ("banco do brasil",),
    ),
)

_CNPJ_RE = re.compile(r"\d{2}\.?\d{3}\.?\d{3}/?\d{4}-?\d{2}")


def _digits(value: str) -> str:
    return re.sub(r"\D", "", value)


def identify_institution(
    spans: Sequence[TextSpan], *, source_engine: str, header_lines: int = 15
) -> tuple[ExtractedField | None, list[str]]:
    """Return the issuer field (value = catalog id) and warnings.

    Scoring: CNPJ 3, legal name 2, brand word 1 (only in the first lines,
    where the issuer's header is). Two banks with strong evidence -> no answer.
    """
    scores: dict[str, float] = {}
    evidence: dict[str, TextSpan] = {}
    raw: dict[str, str] = {}

    total = len(spans)
    for index, span in enumerate(spans):
        # Issuer identity lives in the header and footer; transaction lines
        # name other banks all the time ("TED RECEBIDA BANCO DO BRASIL S.A").
        if not (index < header_lines or index >= total - header_lines):
            continue
        folded = fold(span.text)
        cnpjs = {_digits(m.group(0)) for m in _CNPJ_RE.finditer(span.text)}
        for profile in PROFILES:
            gained = 0.0
            hit = ""
            if cnpjs & {_digits(c) for c in profile.cnpjs}:
                gained, hit = 3.0, "cnpj"
            elif any(term in folded for term in profile.strong):
                gained, hit = 2.0, next(t for t in profile.strong if t in folded)
            elif any(
                re.search(rf"(?<![a-z]){re.escape(t)}(?![a-z])", folded) for t in profile.weak
            ):
                gained, hit = 1.0, profile.name
            if gained and gained > scores.get(profile.id, 0.0):
                scores[profile.id] = gained
                evidence[profile.id] = span
                raw[profile.id] = hit

    if not scores:
        return None, ["institution_not_identified"]

    ranked = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)
    best_id, best = ranked[0]
    warnings: list[str] = []
    if len(ranked) > 1 and (ranked[1][1] == best or ranked[1][1] >= 2.0):
        return None, ["institution_conflict:" + ",".join(i for i, _ in ranked[:2])]

    confidence = {3.0: 0.99, 2.0: 0.96, 1.0: 0.82}[best]
    span = evidence[best_id]
    confidence = min(confidence, span.confidence)
    if best == 1.0:
        warnings.append("institution_from_brand_name_only")
    field = ExtractedField(
        value=best_id,
        raw_value=raw[best_id],
        confidence=round(confidence, 4),
        source_engine=source_engine,
        evidence=Evidence(span.page, span.text, span.bounding_box),
        validation_status=ValidationStatus.VALID.value if best >= 2 else ValidationStatus.NOT_VALIDATED.value,
    )
    return field, warnings


def institution_name(institution_id: str) -> str | None:
    for profile in PROFILES:
        if profile.id == institution_id:
            return profile.name
    return None
