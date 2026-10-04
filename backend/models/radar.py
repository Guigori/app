"""Radar models — FINNOS deterministic intelligence and user feedback."""
from typing import List, Literal, Optional
from pydantic import BaseModel, Field

RadarType = Literal["risk", "deviation", "information", "opportunity"]
RadarSeverity = Literal["normal", "medium", "high", "critical"]
RadarState = Literal["new", "active", "viewed", "resolved", "expired", "dismissed"]
RadarFeedback = Literal["useful", "not_useful", "dont_show_similar"]

class RadarEvidence(BaseModel):
    label: str
    value: str

class RadarSignalOut(BaseModel):
    id: str
    type: RadarType
    severity: RadarSeverity
    state: RadarState = "active"
    title: str
    description: str
    explanation: str
    metric: Optional[str] = None
    radar_position: int
    score: float
    related_entity_type: Optional[str] = None
    related_entity_id: Optional[str] = None
    expires_at: Optional[str] = None
    evidence: List[RadarEvidence] = []
    detected_at: Optional[str] = None

class RadarOut(BaseModel):
    items: List[RadarSignalOut]
    count: int
    active_count: int

class RadarActionIn(BaseModel):
    action: Literal["view", "dismiss", "resolve"]

class RadarFeedbackIn(BaseModel):
    feedback: RadarFeedback
    note: Optional[str] = Field(default=None, max_length=300)
