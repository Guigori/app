"""BYO LLM key models. Mirror: frontend/src/types/finnos.ts (AiProvider, AiKey, AiAnswer)."""

from typing import List, Literal, Optional

from pydantic import BaseModel, Field, SecretStr

AiProvider = Literal["openai", "anthropic", "gemini"]


class AiKeyOut(BaseModel):
    provider: AiProvider
    masked: str
    model: str


class AiKeyIn(BaseModel):
    provider: AiProvider
    key: SecretStr = Field(min_length=10, max_length=500)
    model: Optional[str] = Field(default=None, max_length=80)


class AiAskIn(BaseModel):
    provider: AiProvider
    question: str = Field(min_length=2, max_length=2000)
    month: Optional[str] = Field(default=None, pattern=r"^\d{4}-\d{2}$")


class AiAnswerOut(BaseModel):
    answer: str
    provider: AiProvider
    model: str


class AiProviderInfo(BaseModel):
    provider: AiProvider
    label: str
    default_model: str
    models: List[str]
    console_url: str
