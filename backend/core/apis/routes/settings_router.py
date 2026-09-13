"""
Settings and configuration router for FormPilot API.

Exposes authenticated endpoints for testing Gemini credentials and reading runtime configuration.
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from commons.auth import require_operator
from commons.logger import logger
from core.controllers.settings_controller import (
    DEFAULT_GEMINI_MODEL,
    SettingsController,
)

settings_router = APIRouter()
logging = logger(__name__)


class TestGeminiRequest(BaseModel):
    """Payload to test candidate Gemini credentials."""

    api_key: str = Field(description="Google AI Studio Gemini API Key")
    model: Optional[str] = Field(
        default=DEFAULT_GEMINI_MODEL, description="Gemini model identifier"
    )


class UpdateSettingsRequest(BaseModel):
    """Payload to update application configuration settings."""

    gemini_api_key: Optional[str] = Field(
        default=None, description="Google AI Studio Gemini API Key"
    )
    gemini_model: Optional[str] = Field(
        default=None, description="Default Gemini model"
    )


@settings_router.post(
    "/v1/settings/test-gemini",
    status_code=status.HTTP_200_OK,
)
async def test_gemini_credentials(
    request: TestGeminiRequest,
    user: dict = Depends(require_operator),
):
    """
    Validate and test candidate Gemini API credentials.

    Requires an authenticated operator token so the endpoint cannot be abused as an
    unauthenticated proxy to the Google GenAI API.

    Args:
        request (TestGeminiRequest): API key and model payload.
        user (dict): Authenticated operator identity injected by the auth dependency.

    Returns:
        dict: Validation results including validity flag, latency, and sample response.

    Raises:
        HTTPException 400: If candidate API key is empty.
        HTTPException 401: If the operator token is missing or invalid.
        HTTPException 500: If the test ping encounters an unexpected internal error.
    """
    try:
        logging.info("Calling POST /v1/settings/test-gemini endpoint")
        controller = SettingsController()
        return await controller.test_gemini_credentials(
            api_key=request.api_key,
            model=request.model or DEFAULT_GEMINI_MODEL,
        )
    except HTTPException as httperror:
        logging.error(f"Error in POST /v1/settings/test-gemini endpoint: {httperror}")
        raise httperror
    except Exception as error:
        logging.error(f"Error in POST /v1/settings/test-gemini endpoint: {error}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal Server Error",
        )


@settings_router.post(
    "/v1/settings/update",
    status_code=status.HTTP_200_OK,
)
async def update_settings(
    request: UpdateSettingsRequest,
    user: dict = Depends(require_operator),
):
    """
    Update active runtime settings and persist credentials securely.

    Requires an authenticated operator token. The API key is stored encrypted at rest
    and is never written to a plaintext .env file.

    Args:
        request (UpdateSettingsRequest): Configuration delta.
        user (dict): Authenticated operator identity injected by the auth dependency.

    Returns:
        dict: Success status, updated model, and masked credential preview.

    Raises:
        HTTPException 400: If the supplied API key is empty.
        HTTPException 401: If the operator token is missing or invalid.
        HTTPException 500: If updating or persisting configuration fails.
    """
    try:
        logging.info("Calling POST /v1/settings/update endpoint")
        controller = SettingsController()
        return await controller.update_settings(
            gemini_api_key=request.gemini_api_key,
            gemini_model=request.gemini_model,
        )
    except HTTPException as httperror:
        logging.error(f"Error in POST /v1/settings/update endpoint: {httperror}")
        raise httperror
    except Exception as error:
        logging.error(f"Error in POST /v1/settings/update endpoint: {error}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal Server Error",
        )


@settings_router.get(
    "/v1/settings",
    status_code=status.HTTP_200_OK,
)
async def get_settings(
    user: dict = Depends(require_operator),
):
    """
    Retrieve current runtime configuration.

    Requires an authenticated operator token and returns a redacted credential preview.

    Args:
        user (dict): Authenticated operator identity injected by the auth dependency.

    Returns:
        dict: API key presence, masked key preview, and active model.

    Raises:
        HTTPException 401: If the operator token is missing or invalid.
        HTTPException 500: If reading configuration fails.
    """
    try:
        logging.info("Calling GET /v1/settings endpoint")
        controller = SettingsController()
        return await controller.get_settings()
    except HTTPException as httperror:
        logging.error(f"Error in GET /v1/settings endpoint: {httperror}")
        raise httperror
    except Exception as error:
        logging.error(f"Error in GET /v1/settings endpoint: {error}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal Server Error",
        )
