from typing import Literal, Optional
from pydantic import BaseModel, Field

class FACEvidence(BaseModel):
    label: str
    value: str
    source_ids: list[str] = Field(default_factory=list)
    provenance: Literal["declared","imported","observed","inferred","confirmed","prior"]="observed"

class FACDriver(BaseModel):
    kind: str
    label: str
    contribution_cents: int
    contribution_percent: float
    evidence: list[FACEvidence] = Field(default_factory=list)

class FACProjection(BaseModel):
    status: Literal["unavailable","preliminary","established"]
    low_cents: Optional[int]=None
    expected_cents: Optional[int]=None
    high_cents: Optional[int]=None
    confidence: Literal["low","medium","high"]="low"
    reason: Optional[str]=None

class FACAnalysis(BaseModel):
    schema_version: str="1.1"
    rule_version: str
    state_version: int=1
    analysis_id: str
    kind: str
    subject_type: str
    subject_id: Optional[str]=None
    subject_name: str
    period: str
    headline: str
    conclusion: str
    current_value_cents: int
    baseline_value_cents: int
    delta_cents: int
    delta_percent: float
    severity: Literal["normal","medium","high","critical"]
    relevance_score: float
    confidence: Literal["low","medium","high"]
    confidence_score: float
    evidence: list[FACEvidence]=Field(default_factory=list)
    drivers: list[FACDriver]=Field(default_factory=list)
    projection: Optional[FACProjection]=None
    requires_attention: bool=False
    radar_id: Optional[str]=None

class FACHomeOut(BaseModel):
    engine: str="FAC"
    version: str="1.1"
    analyses: list[FACAnalysis]=Field(default_factory=list)
    count: int=0
