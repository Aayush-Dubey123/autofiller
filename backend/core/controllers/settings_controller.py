"""
Settings controller for FormPilot backend.

Owns runtime configuration orchestration, credential validation, and secure persistence.
"""

from typing import Any, Dict

from fastapi import HTTPException, status

from commons.logger import logger
from core.services.gemini_service import GeminiService
from core.services.secrets_service import get_secrets_service

logging = logger(__name__)

DEFAULT_GEMINI_MODEL = "gemini-3.6-flash"


class SettingsController:
    """Controller handling runtime provider configuration and credential lifecycle."""

    def __init__(self) -> None:
        """
        Initialize dependent services.

        Binds the shared Gemini service and the encrypted secrets store.
        """
        logging.info("Executing SettingsController.__init__")
        self.gemini_service = GeminiService()
        self.secrets_service = get_secrets_service()

    async def test_gemini_credentials(
        self, *, api_key: str, model: str
    ) -> Dict[str, Any]:
        """
        Validate candidate Gemini credentials without persisting them.

        Args:
            api_key (str): Candidate Google AI Studio API key.
            model (str): Gemini model identifier to probe.

        Returns:
            Dict[str, Any]: Validation result including validity, latency, and message.

        Raises:
            HTTPException 400: If the candidate API key is empty.
        """
        logging.info("Executing SettingsController.test_gemini_credentials")
        clean_key = (api_key or "").strip()
        if not clean_key:
            logging.warning("Empty API key provided in test request")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="API key cannot be empty",
            )
        return await self.gemini_service.test_connection(
            api_key=clean_key,
            model=(model or DEFAULT_GEMINI_MODEL).strip(),
        )

    async def update_settings(
        self,
        *,
        gemini_api_key: str | None,
        gemini_model: str | None,
    ) -> Dict[str, Any]:
        """
        Update runtime Gemini configuration and persist credentials securely.

        Writes the key only to the encrypted store, never to a plaintext .env file.

        Args:
            gemini_api_key (str | None): New API key, or None to leave unchanged.
            gemini_model (str | None): New model identifier, or None to leave unchanged.

        Returns:
            Dict[str, Any]: Updated configuration summary with a masked key preview.

        Raises:
            HTTPException 500: If credential persistence fails.
        """
        logging.info("Executing SettingsController.update_settings")
        model = (gemini_model or DEFAULT_GEMINI_MODEL).strip()

        if gemini_api_key is not None:
            clean_key = gemini_api_key.strip()
            if not clean_key:
                logging.warning("Rejected settings update with empty API key")
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="API key cannot be empty",
                )
            try:
                self.secrets_service.set_api_key(clean_key)
            except OSError as error:
                logging.error(f"Error in SettingsController.update_settings: {error}")
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Failed to persist provider credentials securely",
                )
            self.gemini_service.update_credentials(clean_key, model)
        elif gemini_model:
            self.gemini_service.update_model(model)

        if gemini_model:
            try:
                self.secrets_service.set_model(model)
            except OSError as error:
                logging.warning(f"Could not persist model preference: {error}")

        return {
            "success": True,
            "message": "Settings updated successfully",
            "model": model,
            "api_key_configured": self.secrets_service.is_configured(),
            "masked_key": self.secrets_service.mask_api_key(),
        }

    async def get_settings(self) -> Dict[str, Any]:
        """
        Retrieve the current runtime configuration with redacted secrets.

        Args:
            None

        Returns:
            Dict[str, Any]: API key presence, masked preview, and active model.
        """
        logging.info("Executing SettingsController.get_settings")
        configured = self.secrets_service.is_configured()
        return {
            "api_key_configured": configured,
            "masked_key": self.secrets_service.mask_api_key() if configured else "",
            "model": self.gemini_service.model,
        }
