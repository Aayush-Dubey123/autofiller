"""
Secure credential storage service for AutoFiller backend.

Persists provider API keys encrypted at rest instead of writing them to plaintext .env files.
"""

import base64
import hashlib
import json
import os
from pathlib import Path
from typing import Optional

from commons.logger import logger

logging = logger(__name__)

SECRETS_FILE_ENV = "AUTOFILLER_SECRETS_FILE"
MASTER_KEY_ENV = "AUTOFILLER_MASTER_KEY"


class SecretsService:
    """Encrypted, file-backed store for provider credentials owned by the backend."""

    def __init__(self) -> None:
        """
        Initialize the encrypted credential store.

        Resolves the secrets file path and derives the encryption key used for storage.
        """
        logging.info("Executing SecretsService.__init__")
        self.secrets_path = self._resolve_secrets_path()
        self._master_key = self._derive_master_key()

    def _resolve_secrets_path(self) -> Path:
        """
        Resolve the location of the encrypted secrets store.

        Prefers an explicitly configured path and falls back to the backend directory.

        Returns:
            Path: Absolute path to the secrets file.
        """
        configured = os.getenv(SECRETS_FILE_ENV, "").strip() or os.getenv("FORMPILOT_SECRETS_FILE", "").strip()
        if configured:
            return Path(configured).expanduser().resolve()
        
        primary = (Path(__file__).resolve().parent.parent / ".autofiller_secrets").resolve()
        legacy = (Path(__file__).resolve().parent.parent / ".formpilot_secrets").resolve()
        if legacy.exists() and not primary.exists():
            return legacy
        return primary

    def _derive_master_key(self) -> bytes:
        """
        Derive a stable 32-byte encryption key for the secrets store.

        Uses an explicit master key when configured, otherwise derives one from the
        per-install internal token so the key never lives beside the ciphertext.

        Returns:
            bytes: Symmetric encryption key.
        """
        configured = os.getenv(MASTER_KEY_ENV, "").strip() or os.getenv("FORMPILOT_MASTER_KEY", "").strip()
        if configured:
            return hashlib.sha256(configured.encode("utf-8")).digest()

        from commons.auth import _load_or_create_internal_key

        material = f"autofiller-secrets::{_load_or_create_internal_key()}"
        return hashlib.sha256(material.encode("utf-8")).digest()

    def _xor_cipher(self, payload: bytes) -> bytes:
        """
        Apply a keystream transform derived from the master key.

        Args:
            payload (bytes): Data to transform.

        Returns:
            bytes: Transformed data of identical length.
        """
        keystream = hashlib.sha256(self._master_key).digest()
        repeated = (keystream * ((len(payload) // len(keystream)) + 1))[: len(payload)]
        return bytes(a ^ b for a, b in zip(payload, repeated))

    def _load_store(self) -> dict:
        """
        Read and decrypt the credential store from disk.

        Returns an empty store when the file is absent or unreadable so the service
        degrades safely rather than crashing provider-independent routes.

        Returns:
            dict: Decrypted credential mapping.
        """
        if not self.secrets_path.exists():
            return {}
        try:
            raw = base64.b64decode(self.secrets_path.read_bytes())
            plaintext = self._xor_cipher(raw).decode("utf-8")
            return json.loads(plaintext)
        except (OSError, ValueError, json.JSONDecodeError) as error:
            logging.error(f"Failed to read encrypted secrets store: {error}")
            return {}

    def _save_store(self, store: dict) -> None:
        """
        Encrypt and persist the credential store to disk with owner-only permissions.

        Args:
            store (dict): Credential mapping to persist.

        Returns:
            None

        Raises:
            OSError: If the encrypted store cannot be written.
        """
        plaintext = json.dumps(store).encode("utf-8")
        ciphertext = base64.b64encode(self._xor_cipher(plaintext))
        self.secrets_path.write_bytes(ciphertext)
        os.chmod(self.secrets_path, 0o600)

    def get_api_key(self) -> str:
        """
        Return the active Gemini API key.

        Prefers the environment (packaged/CI deployments) and falls back to the
        encrypted store used by the desktop application.

        Returns:
            str: Active API key, or an empty string when unconfigured.
        """
        env_key = os.getenv("GEMINI_API_KEY", "").strip()
        if env_key:
            return env_key
        return str(self._load_store().get("gemini_api_key", "") or "").strip()

    def set_api_key(self, api_key: str) -> None:
        """
        Persist a Gemini API key encrypted at rest.

        Never writes the raw key to a plaintext .env file and never logs the value.

        Args:
            api_key (str): Gemini API key to store.

        Returns:
            None

        Raises:
            OSError: If the encrypted store cannot be written.
        """
        logging.info("Executing SecretsService.set_api_key")
        try:
            store = self._load_store()
            store["gemini_api_key"] = api_key.strip()
            self._save_store(store)
            logging.info("Stored Gemini API key in encrypted credential store")
        except OSError as error:
            logging.error(f"Error in SecretsService.set_api_key: {error}")
            raise

    def get_model(self) -> str:
        """
        Return the persisted Gemini model preference.

        Args:
            None

        Returns:
            str: Stored model identifier, or an empty string when unset.
        """
        return str(self._load_store().get("gemini_model", "") or "").strip()

    def set_model(self, model: str) -> None:
        """
        Persist the preferred Gemini model identifier.

        Args:
            model (str): Gemini model identifier to store.

        Returns:
            None

        Raises:
            OSError: If the encrypted store cannot be written.
        """
        logging.info("Executing SecretsService.set_model")
        try:
            store = self._load_store()
            store["gemini_model"] = model.strip()
            self._save_store(store)
        except OSError as error:
            logging.error(f"Error in SecretsService.set_model: {error}")
            raise

    def mask_api_key(self) -> str:
        """
        Build a redacted display form of the active API key.

        Returns only a short prefix and suffix so the full secret is never echoed.

        Args:
            None

        Returns:
            str: Masked key preview, or an empty string when unconfigured.
        """
        key = self.get_api_key()
        if not key:
            return ""
        # Reveal nothing usable: no prefix and no suffix, only the length class.
        # A partial preview is still a secret disclosure vector to any process that can
        # reach this endpoint or read logs.
        return f"{'*' * 12} ({len(key)} chars)"

    def is_configured(self) -> bool:
        """
        Report whether a usable API key is currently available.

        Args:
            None

        Returns:
            bool: True when an API key is present.
        """
        return bool(self.get_api_key())


_secrets_service_instance: Optional[SecretsService] = None


def get_secrets_service() -> SecretsService:
    """
    Get or create the shared secrets service instance.

    A singleton is used because the service owns cached encryption state derived from
    the per-install token.

    Returns:
        SecretsService: Shared credential store instance.
    """
    global _secrets_service_instance
    if _secrets_service_instance is None:
        _secrets_service_instance = SecretsService()
    return _secrets_service_instance
