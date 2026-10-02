"""Auth request/response models. Mirror: frontend/src/types/finnos.ts (User)."""

from datetime import datetime

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator


class UserOut(BaseModel):
    id: str
    name: str
    email: EmailStr
    created_at: datetime


class SignupIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)
    password_confirm: str = Field(min_length=6, max_length=128)

    @model_validator(mode="after")
    def passwords_match(self) -> "SignupIn":
        if self.password != self.password_confirm:
            raise ValueError("As senhas não coincidem.")
        return self


class SignupOut(BaseModel):
    """Signup does not open a session: the e-mail code has to be confirmed first."""

    email: EmailStr
    verification_required: bool = True
    expires_in_minutes: int = 15


class VerifyEmailIn(BaseModel):
    email: EmailStr
    code: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")


class ResendCodeIn(BaseModel):
    email: EmailStr


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class NameUpdateIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        return value.strip()
