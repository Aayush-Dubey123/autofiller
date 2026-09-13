"""
Data models for FormPilot sessions, observations, mappings, and events.

Defines domain entities, enums, and structured state shapes.
"""

from enum import Enum
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field, AliasChoices, ConfigDict, field_validator


class FormFieldType(str, Enum):
    """Supported form field control types."""
    TEXT = "text"
    NUMBER = "number"
    EMAIL = "email"
    TEL = "tel"
    SELECT = "select"
    RADIO = "radio"
    CHECKBOX = "checkbox"
    DATE = "date"
    TEXTAREA = "textarea"
    PASSWORD = "password"
    OTHER = "other"


class SessionStatus(str, Enum):
    """Workflow state lifecycle phases."""
    IDLE = "IDLE"
    EXTRACTING_DOC = "EXTRACTING_DOC"
    SCANNING_FORM = "SCANNING_FORM"
    MAPPING_FIELDS = "MAPPING_FIELDS"
    CLARIFICATION_REQUIRED = "CLARIFICATION_REQUIRED"
    FILLING_FORM = "FILLING_FORM"
    VERIFYING = "VERIFYING"
    REVIEW_READY = "REVIEW_READY"
    PAUSED = "PAUSED"
    USER_TAKEOVER = "USER_TAKEOVER"
    COMPLETED = "COMPLETED"
    ERROR = "ERROR"


class ExtractedFact(BaseModel):
    """A discrete structured fact extracted from a user document."""
    key: str = Field(description="Normalized key identifier, e.g. student_name, dob, parent_phone")
    label: str = Field(description="Human readable label")
    value: str = Field(description="Extracted text value")
    confidence: float = Field(default=1.0, ge=0.0, le=1.0, description="Extraction confidence score")
    source_page: Optional[int] = Field(default=None, description="Page number where fact was discovered")


class FormFieldSnapshot(BaseModel):
    """Structured representation of an individual web form input field."""
    ref: str = Field(description="Stable internal identifier e.g. field_001")
    role: Optional[str] = Field(default=None, description="ARIA or semantic role")
    label: str = Field(description="Human readable label or aria-label")
    type: str = Field(default="text", description="Input field control type")
    required: bool = Field(default=False, description="Whether field is mandatory")
    current_value: Optional[str] = Field(default="", description="Existing value in DOM")
    options: Optional[List[str]] = Field(default=None, description="Options for select or radio groups")
    disabled: bool = Field(default=False, description="Whether control is disabled")
    visible: bool = Field(default=True, description="Whether control is visible")


class FormSnapshot(BaseModel):
    """Structured browser observation of the active target web form."""

    url: str = Field(description="Current web page URL")
    title: str = Field(description="Web page document title")
    fields: List[FormFieldSnapshot] = Field(
        default_factory=list,
        max_length=200,
        description="Discovered form fields",
    )


class FieldMapping(BaseModel):
    """Semantic mapping between a form field and an extracted fact."""
    field_ref: str = Field(description="Reference to FormFieldSnapshot")
    field_label: str = Field(description="Web form label")
    fact_key: Optional[str] = Field(default=None, description="Matched ExtractedFact key")
    fact_value: Optional[str] = Field(default=None, description="Value to populate")
    confidence: float = Field(default=1.0, ge=0.0, le=1.0, description="Mapping confidence score")
    status: str = Field(default="PENDING", description="PENDING | FILLED | VERIFIED | SKIPPED")
    clarification_id: Optional[str] = Field(default=None, description="Attached clarification request if ambiguous")


class ClarificationRequest(BaseModel):
    """Human-in-the-loop clarification prompt when ambiguity or low confidence occurs."""
    clarification_id: str = Field(description="Unique clarification ID")
    field_ref: str = Field(description="Target form field reference")
    field_label: str = Field(description="Label of target form field")
    question: str = Field(description="User-friendly question prompt")
    options: List[str] = Field(default_factory=list, description="Candidate suggested values")
    selected_value: Optional[str] = Field(default=None, description="User provided answer")


class VerificationRecord(BaseModel):
    """Audit verification of a populated form field."""
    field_ref: str = Field(description="Field reference")
    field_label: str = Field(description="Field label")
    expected_value: str = Field(description="Expected mapped value")
    actual_value: str = Field(description="Actual value read back from DOM")
    verified: bool = Field(description="Whether expected matched actual")


class AgentEvent(BaseModel):
    """Structured observable execution timeline event."""

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    event_id: str = Field(
        default_factory=lambda: "evt_generated",
        description="Unique event ID",
        validation_alias=AliasChoices("event_id", "eventId"),
    )
    timestamp: str = Field(default="", description="ISO timestamp")
    type: str = Field(default="STATE_CHANGED", description="TOOL_STARTED | TOOL_COMPLETED | TOOL_FAILED | STATE_CHANGED | POLICY_BLOCKED")
    tool: Optional[str] = Field(default=None, description="Tool name if applicable")
    description: str = Field(default="", description="Human readable progress description")
    success: Optional[bool] = Field(default=None, description="Success status")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="Contextual payload")

    @field_validator("metadata", mode="before")
    @classmethod
    def _coerce_metadata(cls, value: Any) -> Dict[str, Any]:
        if isinstance(value, dict):
            return value
        return {}


class SessionModel(BaseModel):
    """Persistent state record for a FormPilot automation session."""
    id: str = Field(description="Unique session ID")
    status: SessionStatus = Field(default=SessionStatus.IDLE, description="Current workflow state")
    document_name: Optional[str] = Field(default=None, description="Source document filename")
    target_url: Optional[str] = Field(default=None, description="Target form URL")
    facts: List[ExtractedFact] = Field(
        default_factory=list,
        max_length=200,
        description="Extracted facts",
    )
    form_snapshot: Optional[FormSnapshot] = Field(default=None, description="Inspected form snapshot")
    mappings: List[FieldMapping] = Field(default_factory=list, description="Semantic field mappings")
    clarifications: List[ClarificationRequest] = Field(default_factory=list, description="Clarification requests")
    verifications: List[VerificationRecord] = Field(default_factory=list, description="Verification records")
    events: List[AgentEvent] = Field(default_factory=list, description="Observable event log")
    created_at: str = Field(description="Creation ISO timestamp")
    updated_at: str = Field(description="Last update ISO timestamp")
