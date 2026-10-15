from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.models.enums import MembershipRole


class FarmerCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    full_name: str = Field(min_length=1, max_length=255)
    role: MembershipRole = MembershipRole.farmer
    permission_codes: list[str] = Field(default_factory=list)
    shed_ids: list[UUID] = Field(default_factory=list)


class FarmerUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=1, max_length=255)
    is_active: bool | None = None


class PermissionsUpdate(BaseModel):
    permission_codes: list[str]


class ShedAssignmentsUpdate(BaseModel):
    shed_ids: list[UUID] = Field(default_factory=list)


class FarmerOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    membership_id: UUID
    user_id: UUID
    owner_account_id: UUID
    email: EmailStr
    full_name: str
    role: MembershipRole
    is_active: bool
    permission_codes: list[str] = []
    assigned_shed_ids: list[UUID] = []
    created_at: datetime


class PermissionOut(BaseModel):
    code: str
    description: str
