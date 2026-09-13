"""
Response schemas for FormPilot API endpoints.

Defines wire output contracts for extraction, mapping, session queries, and verification.
"""

from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field
from core.models.session_model import (
    ExtractedFact,
    FieldMapping,
    ClarificationRequest,
    VerificationRecord,
    AgentEvent,
    SessionStatus,
)


class DocumentExtractResponse(BaseModel):
    """Result payload from document fact extraction."""
    document_name: str = Field(description="Document name")
    facts: List[ExtractedFact] = Field(description="List of extracted facts")
    fact_count: int = Field(description="Total count of discovered facts")


class FormMapResponse(BaseModel):
    """Result payload from semantic field mapping synthesis."""
    session_id: str = Field(description="Active session ID")
    mappings: List[FieldMapping] = Field(description="Generated field mappings")
    clarifications_required: List[ClarificationRequest] = Field(
        default_factory=list, description="Clarifications needed from user"
    )
    unmapped_fields: List[str] = Field(
        default_factory=list, description="Field references that could not be mapped"
    )


class SessionResponse(BaseModel):
    """Full session status and state details."""
    id: str = Field(description="Session ID")
    status: SessionStatus = Field(description="Current status")
    document_name: Optional[str] = Field(default=None, description="Document name")
    target_url: Optional[str] = Field(default=None, description="Target URL")
    facts: List[ExtractedFact] = Field(default_factory=list, description="Facts")
    mappings: List[FieldMapping] = Field(default_factory=list, description="Mappings")
    clarifications: List[ClarificationRequest] = Field(default_factory=list, description="Clarifications")
    verifications: List[VerificationRecord] = Field(default_factory=list, description="Verifications")
    events: List[AgentEvent] = Field(default_factory=list, description="Events")
    created_at: str = Field(description="Creation time")
    updated_at: str = Field(description="Updated time")


class GenericStatusResponse(BaseModel):
    """Generic operation success status wrapper."""
    success: bool = Field(description="Success flag")
    message: str = Field(description="Operation message")
    data: Optional[Dict[str, Any]] = Field(default=None, description="Optional payload")
