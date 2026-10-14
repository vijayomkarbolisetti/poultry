from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ShedCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    code: str = Field(min_length=1, max_length=64)
    location_notes: str | None = None
    is_owner_managed: bool = True


class ShedUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    location_notes: str | None = None
    is_owner_managed: bool | None = None
    is_active: bool | None = None


class ShedOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    owner_account_id: UUID
    name: str
    code: str
    location_notes: str | None
    is_owner_managed: bool
    is_active: bool
    created_at: datetime
    updated_at: datetime


class ShedAssignRequest(BaseModel):
    owner_membership_id: UUID
    is_manager: bool = False


class ShedAssignmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    shed_id: UUID
    owner_membership_id: UUID
    is_manager: bool
    is_active: bool
    farmer_name: str | None = None
    farmer_email: str | None = None
