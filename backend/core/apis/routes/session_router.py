"""
Session and document router for FormPilot API.

Provides authenticated HTTP endpoints for document ingestion, form mapping, and human clarification.
"""

from fastapi import APIRouter, Depends, HTTPException, status

from commons.auth import require_operator
from commons.logger import logger
from core.apis.schemas.requests.session_request import (
    ClarificationAnswerRequest,
    CreateSessionRequest,
    DocumentExtractRequest,
    FormMapRequest,
    SessionEventAppendRequest,
)
from core.apis.schemas.responses.session_response import (
    DocumentExtractResponse,
    FormMapResponse,
    SessionResponse,
)
from core.controllers.session_controller import SessionController

session_router = APIRouter()
logging = logger(__name__)


@session_router.post(
    "/v1/sessions",
    status_code=status.HTTP_201_CREATED,
    response_model=SessionResponse,
)
async def create_session(
    request: CreateSessionRequest,
    user: dict = Depends(require_operator),
):
    """
    Initialize a new FormPilot workflow session.

    Creates an active session record in persistent storage for document processing
    and form automation, scoped to the authenticated operator.

    Args:
        request (CreateSessionRequest): Initialization parameters.
        user (dict): Authenticated operator identity injected by the auth dependency.

    Returns:
        SessionResponse: Newly initialized session state.

    Raises:
        HTTPException 401: If the operator token is missing or invalid.
        HTTPException 500: If session creation encounters an unexpected failure.
    """
    try:
        logging.info("Calling POST /v1/sessions endpoint")
        controller = SessionController()
        session = await controller.create_session(
            document_name=request.document_name,
            target_url=request.target_url,
        )
        return SessionResponse(**session)
    except HTTPException as httperror:
        logging.error(f"Error in POST /v1/sessions endpoint: {httperror}")
        raise httperror
    except Exception as error:
        logging.error(f"Error in POST /v1/sessions endpoint: {error}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal Server Error",
        )


@session_router.post(
    "/v1/documents/extract",
    status_code=status.HTTP_200_OK,
    response_model=DocumentExtractResponse,
)
async def extract_document_facts(
    request: DocumentExtractRequest,
    user: dict = Depends(require_operator),
):
    """
    Extract structured facts from a local document.

    Parses text or PDF into discrete key-value entities. File paths are confined to
    operator-approved directories and bounded in size to prevent arbitrary disk reads.

    Args:
        request (DocumentExtractRequest): File path or text payload.
        user (dict): Authenticated operator identity injected by the auth dependency.

    Returns:
        DocumentExtractResponse: Extracted facts and count.

    Raises:
        HTTPException 400: If neither file_path nor raw_text is supplied.
        HTTPException 401: If the operator token is missing or invalid.
        HTTPException 403: If the file path is outside the permitted directories.
        HTTPException 404: If file_path does not exist on disk.
        HTTPException 500: If document extraction encounters an unexpected failure.
    """
    try:
        logging.info("Calling POST /v1/documents/extract endpoint")
        controller = SessionController()
        result = await controller.extract_document(
            file_path=request.file_path,
            raw_text=request.raw_text,
            document_name=request.document_name or "document.pdf",
        )
        return DocumentExtractResponse(**result)
    except HTTPException as httperror:
        logging.error(f"Error in POST /v1/documents/extract endpoint: {httperror}")
        raise httperror
    except Exception as error:
        logging.error(f"Error in POST /v1/documents/extract endpoint: {error}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal Server Error",
        )


@session_router.post(
    "/v1/forms/map",
    status_code=status.HTTP_200_OK,
    response_model=FormMapResponse,
)
async def map_form_fields(
    request: FormMapRequest,
    user: dict = Depends(require_operator),
):
    """
    Map web form fields to extracted document facts.

    Synthesizes semantic correspondence between FormSnapshot fields and facts, and
    detects ambiguities requiring human clarification.

    Args:
        request (FormMapRequest): Session ID, form snapshot, and fact list.
        user (dict): Authenticated operator identity injected by the auth dependency.

    Returns:
        FormMapResponse: Generated mappings and required user clarifications.

    Raises:
        HTTPException 401: If the operator token is missing or invalid.
        HTTPException 404: If session ID is not found.
        HTTPException 422: If the payload exceeds configured field or fact limits.
        HTTPException 500: If mapping synthesis encounters an unexpected failure.
    """
    try:
        logging.info("Calling POST /v1/forms/map endpoint")
        controller = SessionController()
        result = await controller.map_form(
            session_id=request.session_id,
            form_snapshot_data=request.form_snapshot.model_dump(),
            facts_data=[f.model_dump() for f in request.facts],
        )
        return FormMapResponse(**result)
    except HTTPException as httperror:
        logging.error(f"Error in POST /v1/forms/map endpoint: {httperror}")
        raise httperror
    except Exception as error:
        logging.error(f"Error in POST /v1/forms/map endpoint: {error}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal Server Error",
        )


@session_router.post(
    "/v1/clarifications/answer",
    status_code=status.HTTP_200_OK,
    response_model=SessionResponse,
)
async def answer_clarification(
    request: ClarificationAnswerRequest,
    user: dict = Depends(require_operator),
):
    """
    Submit an answer to a pending clarification request.

    Updates the field mapping with the operator selection and advances session state.

    Args:
        request (ClarificationAnswerRequest): Session ID, clarification ID, and selected value.
        user (dict): Authenticated operator identity injected by the auth dependency.

    Returns:
        SessionResponse: Updated session state.

    Raises:
        HTTPException 401: If the operator token is missing or invalid.
        HTTPException 404: If session or clarification ID is not found.
        HTTPException 500: If the update fails.
    """
    try:
        logging.info("Calling POST /v1/clarifications/answer endpoint")
        controller = SessionController()
        updated = await controller.answer_clarification(
            session_id=request.session_id,
            clarification_id=request.clarification_id,
            selected_value=request.selected_value,
        )
        return SessionResponse(**updated)
    except HTTPException as httperror:
        logging.error(f"Error in POST /v1/clarifications/answer endpoint: {httperror}")
        raise httperror
    except Exception as error:
        logging.error(f"Error in POST /v1/clarifications/answer endpoint: {error}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal Server Error",
        )


@session_router.get(
    "/v1/sessions/{session_id}",
    status_code=status.HTTP_200_OK,
    response_model=SessionResponse,
)
async def get_session(
    session_id: str,
    user: dict = Depends(require_operator),
):
    """
    Retrieve active status and details of a session.

    Fetches the current state, mappings, verifications, and audit events.

    Args:
        session_id (str): Unique session identifier.
        user (dict): Authenticated operator identity injected by the auth dependency.

    Returns:
        SessionResponse: Session details.

    Raises:
        HTTPException 401: If the operator token is missing or invalid.
        HTTPException 404: If session ID is not found.
        HTTPException 500: If the query fails.
    """
    try:
        logging.info(f"Calling GET /v1/sessions/{session_id} endpoint")
        controller = SessionController()
        session = await controller.get_session(session_id=session_id)
        return SessionResponse(**session)
    except HTTPException as httperror:
        logging.error(f"Error in GET /v1/sessions/{session_id} endpoint: {httperror}")
        raise httperror
    except Exception as error:
        logging.error(f"Error in GET /v1/sessions/{session_id} endpoint: {error}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal Server Error",
        )


@session_router.post(
    "/v1/sessions/{session_id}/events",
    status_code=status.HTTP_200_OK,
)
async def append_session_events(
    session_id: str,
    request: SessionEventAppendRequest,
    user: dict = Depends(require_operator),
):
    """
    Append audit events to a session timeline.

    Persists agent execution events so the audit trail survives application reloads.

    Args:
        session_id (str): Target session identifier.
        request (SessionEventAppendRequest): Events to append to the timeline.
        user (dict): Authenticated operator identity injected by the auth dependency.

    Returns:
        dict: Success flag and total persisted event count.

    Raises:
        HTTPException 401: If the operator token is missing or invalid.
        HTTPException 404: If the session is not found.
        HTTPException 500: If persisting events fails.
    """
    try:
        logging.info(f"Calling POST /v1/sessions/{session_id}/events endpoint")
        controller = SessionController()
        return await controller.append_events(
            session_id=session_id,
            events_data=[event.model_dump() for event in request.events],
            verifications_data=[
                verification.model_dump() for verification in request.verifications
            ],
        )
    except HTTPException as httperror:
        logging.error(
            f"Error in POST /v1/sessions/{session_id}/events endpoint: {httperror}"
        )
        raise httperror
    except Exception as error:
        logging.error(
            f"Error in POST /v1/sessions/{session_id}/events endpoint: {error}"
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal Server Error",
        )
