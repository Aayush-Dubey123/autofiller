"""
Request schemas for FormPilot API endpoints.

Defines wire input contracts for document ingestion, form mapping, and user clarification.
"""

from typing import Any, Dict, List, Optional
from pydantic import AliasChoices, BaseModel, ConfigDict, Field, field_validator
from core.models.session_model import AgentEvent, FormSnapshot, ExtractedFact


class DocumentExtractRequest(BaseModel):
    """Payload to extract facts from document text or path."""

    file_path: Optional[str] = Field(
        default=None, description="Local absolute path to document file"
    )
    raw_text: Optional[str] = Field(
        default=None, description="Raw text content if pre-read"
    )
    document_name: Optional[str] = Field(
        default="document.pdf", description="Document label"
    )


class FormMapRequest(BaseModel):
    """Payload to synthesize semantic field mapping."""

    session_id: str = Field(description="Active session ID")
    form_snapshot: FormSnapshot = Field(
        description="Structured snapshot of active web form"
    )
    facts: List[ExtractedFact] = Field(description="Extracted document facts")


class ClarificationAnswerRequest(BaseModel):
    """User response answering a clarification prompt."""

    # Accept both wire spellings so a client-side naming difference degrades into a
    # handled error instead of an opaque 422 that aborts the whole session.
    model_config = ConfigDict(populate_by_name=True)

    session_id: str = Field(
        description="Active session ID",
        validation_alias=AliasChoices("session_id", "sessionId"),
    )
    clarification_id: str = Field(
        description="Clarification request identifier",
        validation_alias=AliasChoices("clarification_id", "clarificationId"),
    )
    selected_value: Any = Field(
        default=None,
        description="User selected or entered value",
        validation_alias=AliasChoices("selected_value", "selectedValue"),
    )

    @field_validator("selected_value")
    @classmethod
    def _coerce_selected_value(cls, value: Any) -> str:
        """
        Coerce any client-provided answer into the non-null string the domain expects.

        Args:
            value (Any): Raw value from the request body.

        Returns:
            str: A string safe to persist on the clarification record.

        Raises:
            ValueError: If no usable value was supplied.
        """
        if isinstance(value, str):
            if not value.strip():
                raise ValueError("Clarification answer must not be empty")
            return value
        if isinstance(value, dict):
            for key in ("selectedValue", "selected_value", "value", "answer"):
                candidate = value.get(key)
                if isinstance(candidate, str) and candidate.strip():
                    return candidate
                if candidate is not None and not isinstance(candidate, (dict, list)):
                    return str(candidate)
            raise ValueError("Clarification answer object contained no usable value")
        if value is None or isinstance(value, list):
            raise ValueError("Clarification answer must be a non-empty string")
        return str(value)


class CreateSessionRequest(BaseModel):
    """Initialization payload for a new FormPilot session."""

    document_name: str = Field(description="Name of source document")
    target_url: str = Field(description="Target web form URL")


class VerificationRecordInput(BaseModel):
    """Verification outcome for a single populated form field."""

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    field_ref: str = Field(default="", description="Field reference")
    field_label: str = Field(default="", description="Field label")
    expected_value: str = Field(default="", description="Expected mapped value")
    actual_value: str = Field(default="", description="Actual value read back from DOM")
    verified: bool = Field(default=False, description="Whether expected matched actual")


class SessionEventAppendRequest(BaseModel):
    """Payload appending one or more audit events to a session timeline."""

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    events: List[AgentEvent] = Field(
        default_factory=list,
        max_length=500,
        description="Structured agent events to persist",
    )
    verifications: List[VerificationRecordInput] = Field(
        default_factory=list,
        max_length=500,
        description="Optional verification records to persist",
    )
