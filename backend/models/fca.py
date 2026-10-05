"""FCA — FINNOS Cérebro Analítico public models."""
from typing import List, Literal, Optional
from pydantic import BaseModel
ConfidenceLevel=Literal["low","medium","high"]
AnalysisSeverity=Literal["normal","medium","high","critical"]
class FCAEvidence(BaseModel): label:str; value:str
class FCADriver(BaseModel):
    kind:str; label:str; contribution:float; contribution_percent:float; evidence:List[FCAEvidence]=[]
class FCAProjection(BaseModel):
    month_end:float; baseline_month_end:float; delta:float; confidence:ConfidenceLevel
class FCAAnalysis(BaseModel):
    id:str; kind:str; subject_type:str; subject_id:Optional[str]=None; subject_name:str; period:str
    headline:str; conclusion:str; current_value:float; baseline_value:float; delta:float; delta_percent:float
    severity:AnalysisSeverity; relevance_score:float; confidence:ConfidenceLevel; confidence_score:float
    evidence:List[FCAEvidence]=[]; drivers:List[FCADriver]=[]; projection:Optional[FCAProjection]=None
    related_radar_id:Optional[str]=None
class FCAHomeOut(BaseModel):
    engine:str="FCA"; version:str="1"; analyses:List[FCAAnalysis]; count:int
