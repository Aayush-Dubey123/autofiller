"""
Session controller for FormPilot backend.

Orchestrates document extraction, semantic field mapping, human clarification, and
audit event persistence.
"""

import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

import pytz
from fastapi import HTTPException, status

from commons.logger import logger
from core.cruds.session_crud import CRUDSession
from core.models.session_model import (
    ExtractedFact,
    FormSnapshot,
    SessionStatus,
)
from core.services.document_service import DocumentAccessError, DocumentService
from core.services.gemini_service import get_gemini_service

logging = logger(__name__)

# Payload ceilings. The mapping endpoint feeds its input straight into a provider
# prompt, so unbounded arrays are a trivial cost-amplification vector.
MAX_FACTS_PER_REQUEST = 200
MAX_FIELDS_PER_REQUEST = 200


class SessionController:
    """Controller handling business logic and orchestration of FormPilot workflows."""

    def __init__(self) -> None:
        """
        Initialize dependent CRUD and service instances.

        Binds CRUDSession, DocumentService, and the shared GeminiService singleton.
        """
        logging.info("Executing SessionController.__init__")
        self.crud_session = CRUDSession()
        self.document_service = DocumentService()
        self.gemini_service = get_gemini_service()

    async def create_session(
        self, *, document_name: str, target_url: str
    ) -> Dict[str, Any]:
        """
        Create a new FormPilot workflow session.

        Initializes a session record in persistent storage with the IDLE state.

        Args:
            document_name (str): Source document identifier.
            target_url (str): Target web form URL.

        Returns:
            Dict[str, Any]: Persisted session details.

        Raises:
            HTTPException 500: If session record creation fails.
        """
        try:
            logging.info("Executing SessionController.create_session")
            session_id = f"session_{uuid.uuid4().hex[:12]}"
            now = datetime.now(pytz.utc).isoformat()

            session_data = {
                "id": session_id,
                "status": SessionStatus.IDLE.value,
                "document_name": document_name,
                "target_url": target_url,
                "facts": [],
                "form_snapshot": None,
                "mappings": [],
                "clarifications": [],
                "verifications": [],
                "events": [
                    {
                        "event_id": f"evt_{uuid.uuid4().hex[:8]}",
                        "timestamp": now,
                        "type": "STATE_CHANGED",
                        "tool": None,
                        "description": f"Session initialized for {document_name}",
                        "success": True,
                        "metadata": {"target_url": target_url},
                    }
                ],
            }

            return await self.crud_session.create(obj_in=session_data)
        except HTTPException:
            raise
        except Exception as error:
            logging.error(f"Error in SessionController.create_session: {error}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to initialize session record",
            )

    async def extract_document(
        self,
        *,
        file_path: Optional[str] = None,
        raw_text: Optional[str] = None,
        document_name: str = "document.pdf",
    ) -> Dict[str, Any]:
        """
        Extract structured key-value facts from a source document.

        Args:
            file_path (Optional[str]): File path to the document.
            raw_text (Optional[str]): Direct text payload.
            document_name (str): Label for the document.

        Returns:
            Dict[str, Any]: Extracted facts summary.

        Raises:
            HTTPException 400: If input arguments are missing or invalid.
            HTTPException 403: If the file path violates document access policy.
            HTTPException 404: If the target document file does not exist.
            HTTPException 500: If parsing encounters an unexpected error.
        """
        try:
            logging.info("Executing SessionController.extract_document")
            if not file_path and not raw_text:
                logging.warning("Missing both file_path and raw_text")
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Either file_path or raw_text must be provided",
                )

            facts = await self.document_service.extract_facts(
                file_path=file_path,
                raw_text=raw_text,
                document_name=document_name,
            )

            return {
                "document_name": document_name,
                "facts": [fact.model_dump() for fact in facts],
                "fact_count": len(facts),
            }
        except DocumentAccessError as denied:
            logging.warning(f"Document access denied: {denied}")
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=str(denied),
            )
        except FileNotFoundError:
            logging.warning("Document file not found")
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Document file not found",
            )
        except HTTPException:
            raise
        except Exception as error:
            logging.error(f"Error in SessionController.extract_document: {error}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to extract facts from document",
            )

    async def map_form(
        self,
        *,
        session_id: str,
        form_snapshot_data: Dict[str, Any],
        facts_data: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """
        Synthesize semantic field mappings between a form and document facts.

        Args:
            session_id (str): Target session ID.
            form_snapshot_data (Dict[str, Any]): Form snapshot dictionary.
            facts_data (List[Dict[str, Any]]): Extracted facts list.

        Returns:
            Dict[str, Any]: Mappings, required clarifications, and unmapped fields.

        Raises:
            HTTPException 404: If session ID is not found.
            HTTPException 422: If the payload exceeds configured limits.
            HTTPException 500: If mapping generation fails.
        """
        try:
            logging.info(
                f"Executing SessionController.map_form for session {session_id}"
            )
            if len(facts_data) > MAX_FACTS_PER_REQUEST:
                logging.warning(
                    f"Rejected mapping request with {len(facts_data)} facts"
                )
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"Too many facts supplied (limit {MAX_FACTS_PER_REQUEST})",
                )
            if len(form_snapshot_data.get("fields", [])) > MAX_FIELDS_PER_REQUEST:
                logging.warning("Rejected mapping request with excessive form fields")
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"Too many form fields supplied (limit {MAX_FIELDS_PER_REQUEST})",
                )

            session = await self.crud_session.get_by_id(session_id=session_id)
            if not session:
                logging.warning(f"Session not found: {session_id}")
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Session not found",
                )

            form_snapshot = FormSnapshot(**form_snapshot_data)
            fact_models = [ExtractedFact(**fact) for fact in facts_data]

            mappings, clarifications, unmapped = (
                await self.gemini_service.map_form_fields(
                    form_snapshot=form_snapshot,
                    facts=fact_models,
                )
            )

            new_status = (
                SessionStatus.CLARIFICATION_REQUIRED.value
                if clarifications
                else SessionStatus.MAPPING_FIELDS.value
            )

            await self.crud_session.update(
                session_id=session_id,
                obj_in={
                    "form_snapshot": form_snapshot.model_dump(),
                    "facts": [fact.model_dump() for fact in fact_models],
                    "mappings": [mapping.model_dump() for mapping in mappings],
                    "clarifications": [
                        clarification.model_dump() for clarification in clarifications
                    ],
                    "status": new_status,
                },
            )

            return {
                "session_id": session_id,
                "mappings": [mapping.model_dump() for mapping in mappings],
                "clarifications_required": [
                    clarification.model_dump() for clarification in clarifications
                ],
                "unmapped_fields": unmapped,
            }
        except HTTPException:
            raise
        except Exception as error:
            logging.error(f"Error in SessionController.map_form: {error}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to synthesize field mapping",
            )

    async def answer_clarification(
        self,
        *,
        session_id: str,
        clarification_id: str,
        selected_value: str,
    ) -> Dict[str, Any]:
        """
        Submit a human answer to a pending clarification prompt.

        Updates the mapped field value, clears the pending clarification, and advances state.

        Args:
            session_id (str): Target session ID.
            clarification_id (str): Target clarification ID.
            selected_value (str): Value selected or supplied by the user.

        Returns:
            Dict[str, Any]: Updated session state.

        Raises:
            HTTPException 404: If session or clarification is not found.
            HTTPException 500: If the update fails.
        """
        try:
            logging.info(
                f"Executing SessionController.answer_clarification for {clarification_id}"
            )
            session = await self.crud_session.get_by_id(session_id=session_id)
            if not session:
                logging.warning(f"Session not found: {session_id}")
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Session not found",
                )

            clarifications = session.get("clarifications", [])
            target_clarification = next(
                (
                    clarification
                    for clarification in clarifications
                    if clarification.get("clarification_id") == clarification_id
                ),
                None,
            )
            if not target_clarification:
                logging.warning(f"Clarification request not found: {clarification_id}")
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Clarification request not found",
                )

            field_ref = target_clarification.get("field_ref")
            mappings = session.get("mappings", [])
            for mapping in mappings:
                if mapping.get("field_ref") == field_ref:
                    mapping["fact_value"] = selected_value
                    mapping["status"] = "RESOLVED"
                    mapping["confidence"] = 1.0

            remaining_clarifications = [
                clarification
                for clarification in clarifications
                if clarification.get("clarification_id") != clarification_id
            ]

            new_status = (
                SessionStatus.CLARIFICATION_REQUIRED.value
                if remaining_clarifications
                else SessionStatus.FILLING_FORM.value
            )

            return await self.crud_session.update(
                session_id=session_id,
                obj_in={
                    "mappings": mappings,
                    "clarifications": remaining_clarifications,
                    "status": new_status,
                },
            )
        except HTTPException:
            raise
        except Exception as error:
            logging.error(f"Error in SessionController.answer_clarification: {error}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to submit clarification",
            )

    async def append_events(
        self,
        *,
        session_id: str,
        events_data: List[Dict[str, Any]],
        verifications_data: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        """
        Persist agent execution events and verification records to a session.

        Restores the auditability guarantee so the execution timeline survives an
        application reload instead of existing only in renderer memory.

        Args:
            session_id (str): Target session ID.
            events_data (List[Dict[str, Any]]): Structured agent events to persist.
            verifications_data (Optional[List[Dict[str, Any]]]): Verification records to persist.

        Returns:
            Dict[str, Any]: Success flag, appended count, and total event count.

        Raises:
            HTTPException 404: If the session is not found.
            HTTPException 500: If persistence fails.
        """
        try:
            logging.info(f"Executing SessionController.append_events for {session_id}")
            session = await self.crud_session.get_by_id(session_id=session_id)
            if not session:
                logging.warning(f"Session not found: {session_id}")
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Session not found",
                )

            appended = await self.crud_session.append_events(
                session_id=session_id,
                events=events_data,
            )
            verification_count = await self.crud_session.append_verifications(
                session_id=session_id,
                verifications=verifications_data or [],
            )
            total = await self.crud_session.count_events(session_id=session_id)
            logging.info(
                f"Persisted {appended} events and {verification_count} verifications "
                f"for session {session_id}"
            )
            return {
                "success": True,
                "appended": appended,
                "verification_count": verification_count,
                "event_count": total,
            }
        except HTTPException:
            raise
        except Exception as error:
            logging.error(f"Error in SessionController.append_events: {error}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to persist session events",
            )

    async def get_session(self, *, session_id: str) -> Dict[str, Any]:
        """
        Retrieve existing session details by ID.

        Args:
            session_id (str): Session identifier.

        Returns:
            Dict[str, Any]: Session details.

        Raises:
            HTTPException 404: If the session is not found.
            HTTPException 500: If the query fails.
        """
        try:
            logging.info(f"Executing SessionController.get_session for {session_id}")
            session = await self.crud_session.get_by_id(session_id=session_id)
            if not session:
                logging.warning(f"Session not found: {session_id}")
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Session not found",
                )
            return session
        except HTTPException:
            raise
        except Exception as error:
            logging.error(f"Error in SessionController.get_session: {error}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to retrieve session",
            )
