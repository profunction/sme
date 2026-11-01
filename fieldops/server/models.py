from datetime import datetime
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator

Role = Literal['administrator','supervisor','engineer','viewer']
Status = Literal['Open','Assigned','In Progress','Waiting for Parts','Pending Customer','Completed','Closed']

class Input(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)

class Login(Input):
    company_code: str = Field(min_length=1,max_length=32)
    email: str = Field(min_length=3,max_length=200)
    password: SecretStr = Field(min_length=1,max_length=256)

class UserInput(Input):
    email: str = Field(min_length=3,max_length=200)
    name: str = Field(min_length=1,max_length=120)
    role: Role = 'engineer'
    password: SecretStr = Field(min_length=12,max_length=256)

class CustomerInput(Input):
    name: str = Field(min_length=1,max_length=160)
    contact: str = Field(default='',max_length=300)

class SiteInput(Input):
    customer_id: str = Field(max_length=36)
    name: str = Field(min_length=1,max_length=160)
    address: str = Field(default='',max_length=500)

class EquipmentInput(Input):
    site_id: str = Field(max_length=36)
    manufacturer: str = Field(min_length=1,max_length=100)
    model: str = Field(min_length=1,max_length=120)
    serial_number: str = Field(default='',max_length=120)
    room: str = Field(default='',max_length=120)
    category: str = Field(default='General',max_length=100)
    firmware: str = Field(default='',max_length=100)
    installation_date: str = Field(default='',max_length=10)

class WorkOrderInput(Input):
    equipment_id: str = Field(max_length=36)
    title: str = Field(min_length=1,max_length=250)
    priority: Literal['Low','Normal','High','Urgent'] = 'Normal'
    engineer_id: str | None = Field(default=None,max_length=36)

class WorkOrderUpdate(Input):
    expected_version: int = Field(strict=True,ge=1)
    status: Status
    engineer_id: str | None = Field(default=None,max_length=36)
    arrived_at: datetime | None = None
    work_started_at: datetime | None = None
    work_ended_at: datetime | None = None

    @field_validator('arrived_at','work_started_at','work_ended_at')
    @classmethod
    def timezone_required(cls, value):
        if value is not None and value.utcoffset() is None:
            raise ValueError('A timestamp must include a UTC offset')
        return value

class NoteInput(Input):
    mutation_id: str = Field(min_length=16,max_length=80,pattern=r'^[A-Za-z0-9_-]+$')
    expected_version: int = Field(strict=True,ge=1)
    initial_condition: str = Field(default='',max_length=8000)
    investigation: str = Field(default='',max_length=8000)
    outcome: str = Field(default='',max_length=8000)
    follow_up: str = Field(default='',max_length=8000)
    recorded_at: datetime

    @field_validator('recorded_at')
    @classmethod
    def timezone_required(cls, value):
        if value.utcoffset() is None:
            raise ValueError('A timestamp must include a UTC offset')
        return value
