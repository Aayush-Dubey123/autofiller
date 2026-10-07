"""
Gemini reasoning and semantic field mapping service for FormPilot backend.

Synthesizes correspondences between FormSnapshot fields and ExtractedFacts using the
Google GenAI SDK through non-blocking async execution.
"""

import asyncio
import json
import os
import time
import re
from typing import Any, Dict, List, Optional, Tuple, Union

from commons.logger import logger
from core.models.session_model import (
    ClarificationRequest,
    ExtractedFact,
    FieldMapping,
    FormSnapshot,
)

logging = logger(__name__)

# Developer configuration read from backend/.env (never a user setting).
# Defaults are only used when the .env variables are unset; candidates that the
# provider catalog no longer lists are dropped at runtime (see _filter_candidates).
GEMINI_API_KEY_ENV = "GEMINI_API_KEY"
GEMINI_MODEL_ENV = "GEMINI_MODEL"
GEMINI_FALLBACK_MODELS_ENV = "GEMINI_FALLBACK_MODELS"
DEFAULT_GEMINI_MODEL = "gemini-3.5-flash"
DEFAULT_GEMINI_FALLBACK_MODELS = ["gemini-3.5-flash-lite", "gemini-flash-latest"]

# OpenRouter fallback configuration read from backend/.env.
OPENROUTER_API_KEY_ENV = "OPENROUTER_API_KEY"
OPENROUTER_MODEL_ENV = "OPENROUTER_MODEL"
OPENROUTER_FALLBACK_MODELS_ENV = "OPENROUTER_FALLBACK_MODELS"
DEFAULT_OPENROUTER_MODEL = "openrouter/free"
DEFAULT_OPENROUTER_FALLBACK_MODELS = [
    "google/gemma-4-31b-it:free",
    "nvidia/nemotron-3-super-120b-a12b:free",
]
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models"

# Provider timeout: bounded at roughly 2-3s (configurable via AI_REQUEST_TIMEOUT_SECONDS)
AI_TIMEOUT_SECONDS_ENV = "AI_REQUEST_TIMEOUT_SECONDS"
DEFAULT_AI_TIMEOUT_SECONDS = 3.0
# Form mapping sends a large prompt, so healthy models need a bit longer than
# trivial calls. Dead models never consume this budget twice (health registry).
AI_MAPPING_TIMEOUT_SECONDS_ENV = "AI_MAPPING_TIMEOUT_SECONDS"
DEFAULT_AI_MAPPING_TIMEOUT_SECONDS = 8.0

# Model health registry: "provider:model" -> monotonic time until which it is skipped.
PERMANENT_COOLDOWN_SECONDS = 3600.0  # not found / no longer available
TRANSIENT_COOLDOWN_SECONDS = 60.0  # 503 / 429 / timeout
CATALOG_TTL_SECONDS = 600.0
CATALOG_FETCH_TIMEOUT_SECONDS = 3.0
_MODEL_COOLDOWN: Dict[str, float] = {}
_CATALOG_CACHE: Dict[str, Tuple[float, Optional[set]]] = {}


def reset_model_health() -> None:
    """Clear model cooldowns and cached provider catalogs (used by tests)."""
    _MODEL_COOLDOWN.clear()
    _CATALOG_CACHE.clear()


def mark_model_unavailable(provider: str, model: str, error: Any) -> None:
    """Record a failed model so later calls skip it instead of re-paying its timeout."""
    text = str(error).lower()
    permanent = any(
        token in text
        for token in ("404", "not_found", "not found", "no longer available", "no endpoints", "invalid model")
    )
    cooldown = PERMANENT_COOLDOWN_SECONDS if permanent else TRANSIENT_COOLDOWN_SECONDS
    _MODEL_COOLDOWN[f"{provider}:{model}"] = time.monotonic() + cooldown


def _is_model_cooling(provider: str, model: str) -> bool:
    until = _MODEL_COOLDOWN.get(f"{provider}:{model}")
    return until is not None and until > time.monotonic()


def filter_candidates(provider: str, models: List[str], catalog: Optional[set]) -> List[str]:
    """
    Drop models that are cooling down or absent from the provider catalog.

    If filtering would remove every candidate, the unfiltered list is returned so a
    recovered provider can still be probed (bounded by the request timeout).
    """
    kept = [
        m
        for m in models
        if not _is_model_cooling(provider, m) and (catalog is None or m in catalog)
    ]
    skipped = [m for m in models if m not in kept]
    if skipped:
        logging.info(f"Skipping unavailable {provider} model candidates: {skipped}")
    return kept or models


def _cached_catalog(provider: str) -> Tuple[bool, Optional[set]]:
    entry = _CATALOG_CACHE.get(provider)
    if entry and entry[0] > time.monotonic():
        return True, entry[1]
    return False, None


def _store_catalog(provider: str, names: Optional[set], ttl: float = CATALOG_TTL_SECONDS) -> None:
    _CATALOG_CACHE[provider] = (time.monotonic() + ttl, names)


def get_ai_timeout_seconds() -> float:
    """Read bounded AI request timeout from backend/.env, default 3.0s."""
    try:
        val = float(os.getenv(AI_TIMEOUT_SECONDS_ENV, str(DEFAULT_AI_TIMEOUT_SECONDS)).strip())
        return max(1.0, min(val, 30.0))
    except (ValueError, TypeError):
        return DEFAULT_AI_TIMEOUT_SECONDS


def get_ai_mapping_timeout_seconds() -> float:
    """Read bounded form-mapping timeout from backend/.env, default 8.0s."""
    try:
        val = float(
            os.getenv(AI_MAPPING_TIMEOUT_SECONDS_ENV, str(DEFAULT_AI_MAPPING_TIMEOUT_SECONDS)).strip()
        )
        return max(1.0, min(val, 30.0))
    except (ValueError, TypeError):
        return DEFAULT_AI_MAPPING_TIMEOUT_SECONDS


def get_gemini_api_key() -> str:
    """
    Read the Gemini API key from the environment (backend/.env).

    Returns:
        str: The trimmed API key, or an empty string when unset.
    """
    return os.getenv(GEMINI_API_KEY_ENV, "").strip()


def is_gemini_configured() -> bool:
    """
    Report whether a Gemini API key is configured, without exposing it.

    Returns:
        bool: True when GEMINI_API_KEY is set to a non-empty value.
    """
    return bool(get_gemini_api_key())


def get_openrouter_api_key() -> str:
    """
    Read the OpenRouter API key from the environment (backend/.env).

    Returns:
        str: The trimmed API key, or an empty string when unset.
    """
    return os.getenv(OPENROUTER_API_KEY_ENV, "").strip()


def is_openrouter_configured() -> bool:
    """
    Report whether an OpenRouter API key is configured, without exposing it.

    Returns:
        bool: True when OPENROUTER_API_KEY is set to a non-empty value.
    """
    return bool(get_openrouter_api_key())


def is_ai_provider_configured() -> bool:
    """Report whether any AI provider (Gemini or OpenRouter) is configured."""
    return is_gemini_configured() or is_openrouter_configured()


def get_gemini_models() -> List[str]:
    """Get ordered list of candidate Gemini models (primary + fallbacks)."""
    primary = os.getenv(GEMINI_MODEL_ENV, "").strip() or DEFAULT_GEMINI_MODEL
    fallbacks_raw = os.getenv(GEMINI_FALLBACK_MODELS_ENV, "").strip()
    fallbacks = (
        [m.strip() for m in fallbacks_raw.split(",") if m.strip()]
        if fallbacks_raw
        else DEFAULT_GEMINI_FALLBACK_MODELS
    )
    models = [primary]
    for m in fallbacks:
        if m not in models:
            models.append(m)
    return models


def get_openrouter_models() -> List[str]:
    """Get ordered list of candidate OpenRouter models (primary + fallbacks)."""
    primary = os.getenv(OPENROUTER_MODEL_ENV, "").strip() or DEFAULT_OPENROUTER_MODEL
    fallbacks_raw = os.getenv(OPENROUTER_FALLBACK_MODELS_ENV, "").strip()
    fallbacks = (
        [m.strip() for m in fallbacks_raw.split(",") if m.strip()]
        if fallbacks_raw
        else DEFAULT_OPENROUTER_FALLBACK_MODELS
    )
    models = [primary]
    for m in fallbacks:
        if m not in models:
            models.append(m)
    return models


def _strip_code_fences(text: str) -> str:
    """
    Remove Markdown code fences from a model response.

    Args:
        text (str): Raw model response text.

    Returns:
        str: Response text without surrounding ```json fences.
    """
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    return cleaned.strip()


def format_to_strict_dd_mm_yyyy(val: str) -> str:
    """
    Format any date string strictly into DD/MM/YYYY format.

    Preserves existing DD-MM-YYYY or DD/MM/YYYY dates, and converts YYYY-MM-DD
    or month-name dates into standard DD/MM/YYYY.
    """
    if not val:
        return val
    val = val.strip()
    parts = re.split(r"[-/.\s]+", val)
    if len(parts) == 3:
        p1, p2, p3 = parts
        month_map = {
            "jan": "01", "feb": "02", "mar": "03", "apr": "04", "may": "05", "jun": "06",
            "jul": "07", "aug": "08", "sep": "09", "oct": "10", "nov": "11", "dec": "12",
            "january": "01", "february": "02", "march": "03", "april": "04", "june": "06",
            "july": "07", "august": "08", "september": "09", "october": "10", "november": "11", "december": "12"
        }
        if p2.lower() in month_map:
            p2 = month_map[p2.lower()]
        elif p1.lower() in month_map:
            p1, p2 = p2, month_map[p1.lower()]

        # Case 1: YYYY-MM-DD -> DD/MM/YYYY
        if len(p1) == 4 and len(p3) <= 2:
            return f"{p3.zfill(2)}/{p2.zfill(2)}/{p1}"
        # Case 2: DD-MM-YYYY or MM-DD-YYYY
        if len(p3) == 4 and len(p1) <= 2:
            try:
                n1, n2 = int(p1), int(p2)
                if n2 > 12 and n1 <= 12:
                    return f"{p2.zfill(2)}/{p1.zfill(2)}/{p3}"
            except ValueError:
                pass
            if "/" in val:
                return f"{p1.zfill(2)}/{p2.zfill(2)}/{p3}"
            if "-" in val:
                return f"{p1.zfill(2)}-{p2.zfill(2)}-{p3}"
            return f"{p1.zfill(2)}/{p2.zfill(2)}/{p3}"
    return val


def _is_date_field_or_key(key: Optional[str], label: Optional[str] = "") -> bool:
    """Determine if a key or label represents a date field."""
    k = (key or "").lower()
    l = (label or "").lower()
    return any(
        target in k or target in l
        for target in ["dob", "birth", "date", "admission_date", "issue_date"]
    )


class GeminiService:
    """Service using Gemini to map document facts onto web form fields."""

    def __init__(self) -> None:
        """
        Initialize the Gemini client from GEMINI_API_KEY / GEMINI_MODEL in backend/.env.
        """
        logging.info("Executing GeminiService.__init__")
        self.api_key = get_gemini_api_key()
        self.model = os.getenv(GEMINI_MODEL_ENV, "").strip() or DEFAULT_GEMINI_MODEL
        self.client = None
        if self.api_key:
            self._build_client(self.api_key)
        else:
            logging.info("Gemini client not initialized: no API key configured")

    def _build_client(self, api_key: str) -> None:
        """
        Construct the underlying Google GenAI client with bounded socket timeout.

        Args:
            api_key (str): Google AI Studio API key.

        Returns:
            None
        """
        try:
            from google import genai
            from google.genai import types

            timeout_ms = int(max(get_ai_timeout_seconds(), get_ai_mapping_timeout_seconds()) * 1000)
            self.client = genai.Client(
                api_key=api_key,
                http_options=types.HttpOptions(timeout=timeout_ms),
            )
            logging.info("Initialized Google GenAI client successfully with bounded socket timeout")
        except Exception as error:
            self.client = None
            logging.error(f"Could not initialize Google GenAI client: {error}")

    def _ensure_client(self) -> None:
        """Attempt to initialize the client from the environment if not yet ready."""
        if self.client is None:
            api_key = get_gemini_api_key()
            if api_key:
                self.api_key = api_key
                self._build_client(api_key)

    async def _generate_async(
        self,
        *,
        model: str,
        contents: Any,
        config: Optional[Any] = None,
        timeout: Optional[float] = None,
    ) -> str:
        """
        Execute a non-blocking Gemini generation call with a bounded timeout.

        Runs the synchronous SDK call in a worker thread so the FastAPI event loop is
        never blocked by provider latency.

        Args:
            model (str): Gemini model identifier.
            contents (Any): Prompt string or multimodal content parts.
            config (Optional[Any]): Optional generation config.
            timeout (Optional[float]): Custom timeout in seconds.

        Returns:
            str: Model response text.

        Raises:
            RuntimeError: If the provider call fails or exceeds the configured timeout.
        """
        self._ensure_client()
        if self.client is None:
            raise RuntimeError("Gemini client is not initialized.")

        req_timeout = timeout if timeout is not None else get_ai_timeout_seconds()

        def _call() -> str:
            """Perform the blocking provider call inside the worker thread."""
            if config:
                response = self.client.models.generate_content(
                    model=model, contents=contents, config=config
                )
            else:
                response = self.client.models.generate_content(
                    model=model, contents=contents
                )
            return (response.text or "").strip()

        return await asyncio.wait_for(
            asyncio.to_thread(_call),
            timeout=req_timeout,
        )

    async def _generate_openrouter_async(
        self,
        *,
        messages: List[Dict[str, Any]],
        temperature: float = 0.1,
        timeout: Optional[float] = None,
    ) -> str:
        """
        Execute an OpenRouter chat completion call as a fast fallback provider.

        Cycles through candidate OpenRouter models (primary + fallbacks) with bounded timeout.

        Args:
            messages: List of chat messages in standard format.
            temperature: Sampling temperature.
            timeout: Optional per-model timeout in seconds.

        Returns:
            str: Assistant response content.

        Raises:
            RuntimeError: If OpenRouter is unconfigured, times out, or all models return errors.
        """
        api_key = get_openrouter_api_key()
        if not api_key:
            raise RuntimeError("OpenRouter API key is not configured.")

        req_timeout = timeout if timeout is not None else get_ai_timeout_seconds()
        candidate_models = filter_candidates(
            "openrouter",
            get_openrouter_models(),
            await self._openrouter_catalog(),
        )
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://autofiller.ai",
            "X-Title": "AutoFiller AI",
        }

        import httpx

        last_error = None
        async with httpx.AsyncClient(timeout=req_timeout) as client:
            for candidate_model in candidate_models:
                try:
                    logging.info(f"Attempting OpenRouter completion with model {candidate_model}")
                    payload = {
                        "model": candidate_model,
                        "messages": messages,
                        "temperature": temperature,
                    }
                    resp = await client.post(OPENROUTER_URL, json=payload, headers=headers)
                    if resp.status_code != 200:
                        raise RuntimeError(
                            f"OpenRouter returned status {resp.status_code}: {resp.text[:120]}"
                        )
                    data = resp.json()
                    if "error" in data:
                        err_msg = data["error"].get("message", str(data["error"]))
                        raise RuntimeError(f"OpenRouter error: {err_msg}")
                    choices = data.get("choices")
                    if not choices or not isinstance(choices, list):
                        raise RuntimeError("OpenRouter response did not contain choices")
                    content = choices[0].get("message", {}).get("content", "")
                    cleaned = content.strip()
                    if cleaned:
                        return cleaned
                except Exception as err:
                    mark_model_unavailable("openrouter", candidate_model, err)
                    last_error = f"OpenRouter model {candidate_model} failed: {err}"
                    logging.warning(
                        f"OpenRouter candidate model {candidate_model} failed ({err}); failing over immediately to next model"
                    )
                    continue

        raise RuntimeError(
            f"All candidate OpenRouter models failed. Last error: {last_error}"
        )

    def _parse_facts_json(
        self,
        response_text: str,
        document_name: str = "document",
    ) -> List[ExtractedFact]:
        """
        Parse model JSON into normalized ExtractedFact objects.

        Normalizes keys using KEY_ALIASES, assigns canonical labels,
        and enforces DD/MM/YYYY date formatting.
        """
        from core.services.document_service import KEY_ALIASES, CANONICAL_LABELS

        cleaned = _strip_code_fences(response_text)
        parsed = json.loads(cleaned)
        facts: List[ExtractedFact] = []
        seen_keys = set()

        raw_facts = parsed.get("facts", [])
        if not isinstance(raw_facts, list) and isinstance(parsed, list):
            raw_facts = parsed

        for item in raw_facts:
            raw_key = str(item.get("key", "")).strip().lower().replace(" ", "_")
            val = str(item.get("value", "")).strip()
            label = str(item.get("label", raw_key.replace("_", " ").title())).strip()
            confidence = float(item.get("confidence", 0.95))
            if raw_key and val and raw_key not in seen_keys:
                facts.append(
                    ExtractedFact(
                        key=raw_key,
                        label=label,
                        value=val,
                        confidence=confidence,
                    )
                )
                seen_keys.add(raw_key)
        return facts

    async def _gemini_catalog(self) -> Optional[set]:
        """Return the set of Gemini model ids the key can see (cached), or None if unknown."""
        hit, cached = _cached_catalog("gemini")
        if hit:
            return cached
        names: Optional[set] = None
        try:
            def _list() -> set:
                return {str(m.name).split("/")[-1] for m in self.client.models.list()}

            names = await asyncio.wait_for(
                asyncio.to_thread(_list), timeout=CATALOG_FETCH_TIMEOUT_SECONDS
            ) or None
        except Exception as error:
            logging.info(f"Gemini model catalog unavailable ({type(error).__name__}); not filtering")
        _store_catalog("gemini", names, CATALOG_TTL_SECONDS if names else TRANSIENT_COOLDOWN_SECONDS)
        return names

    async def _openrouter_catalog(self) -> Optional[set]:
        """Return the set of OpenRouter model ids (cached, public endpoint), or None if unknown."""
        hit, cached = _cached_catalog("openrouter")
        if hit:
            return cached
        names: Optional[set] = None
        try:
            import httpx

            async with httpx.AsyncClient(timeout=CATALOG_FETCH_TIMEOUT_SECONDS) as http:
                resp = await http.get(OPENROUTER_MODELS_URL)
                resp.raise_for_status()
                names = {str(m["id"]) for m in resp.json().get("data", [])} or None
        except Exception as error:
            logging.info(f"OpenRouter model catalog unavailable ({type(error).__name__}); not filtering")
        _store_catalog(
            "openrouter", names, CATALOG_TTL_SECONDS if names else TRANSIENT_COOLDOWN_SECONDS
        )
        return names

    async def _generate_with_failover(
        self,
        *,
        contents: Any,
        config: Optional[Any] = None,
        log_context: str = "generation",
        timeout: Optional[float] = None,
    ) -> Tuple[str, bool, Optional[str]]:
        """
        Generate content across candidate models with fast failover and bounded timeouts.

        If a model returns an immediate error (503, 429, 404, unavailable) or times out
        after the bounded window (~3s), fails over immediately to the next candidate model
        instead of waiting through sequential long timeouts. Stops on first valid result.

        Args:
            contents (Any): Prompt string or multimodal content parts.
            config (Optional[Any]): Optional generation config.
            log_context (str): Label used in log messages.

        Returns:
            Tuple[str, bool, Optional[str]]: Response text (empty if all failed),
                quota flag, and the last error message.
        """
        models_to_try = filter_candidates(
            "gemini", get_gemini_models(), await self._gemini_catalog()
        )
        timeout = timeout if timeout is not None else get_ai_timeout_seconds()
        last_error: Optional[str] = None

        for candidate_model in models_to_try:
            try:
                logging.info(
                    f"Attempting {log_context} with Gemini model {candidate_model} (timeout {timeout:.1f}s)"
                )
                response_text = await self._generate_async(
                    model=candidate_model,
                    contents=contents,
                    config=config,
                    timeout=timeout,
                )
                if response_text:
                    return response_text, False, None
            except asyncio.TimeoutError:
                mark_model_unavailable("gemini", candidate_model, "timeout")
                last_error = f"Gemini {candidate_model} timed out after {timeout:.1f}s"
                logging.warning(
                    f"Model {candidate_model} timed out after {timeout:.1f}s; failing over immediately to next model"
                )
                continue
            except Exception as error:
                mark_model_unavailable("gemini", candidate_model, error)
                last_error = f"Gemini {candidate_model} failed: {error}"
                logging.warning(
                    f"{log_context.capitalize()} with model {candidate_model} failed ({error}); failing over immediately to next model"
                )
                continue

        return "", False, last_error

    async def extract_facts_from_image(
        self,
        *,
        image_bytes: bytes,
        mime_type: str = "image/png",
        document_name: str = "document.png",
    ) -> List[ExtractedFact]:
        """
        Extract structured domain facts from an image or scanned document page.

        Uses Gemini multimodal vision capabilities as primary provider, with OpenRouter
        multimodal fallback when configured and available.

        Args:
            image_bytes (bytes): Binary content of the image.
            mime_type (str): MIME type of the image (e.g. "image/png", "image/jpeg").
            document_name (str): Label for logging and trace context.

        Returns:
            List[ExtractedFact]: Discovered entity facts.

        Raises:
            RuntimeError: If client is unconfigured or all candidate models fail.
        """
        logging.info(
            f"Executing GeminiService.extract_facts_from_image for {document_name} "
            f"({len(image_bytes)} bytes, mime={mime_type})"
        )
        self._ensure_client()
        if self.client is None and not is_openrouter_configured():
            raise RuntimeError(
                "Gemini API key is required to extract facts from images. "
                "Set GEMINI_API_KEY in backend/.env and restart the backend."
            )

        prompt = """You are AutoFiller AI, an expert document intelligence assistant specialized in educational records, transfer certificates (TC), admission forms, marksheets, and identity documents.
Carefully examine the entire document image, including both printed template text and handwritten entries.

Extract all visible details, especially:
- Student's Full Name (key: student_name)
- Mother's Name (key: mother_name)
- Father's / Guardian's Name (key: parent_name or father_name)
- Date of Birth in figures or words (key: dob, e.g. 16/12/2010)
- Gender / Sex (key: gender)
- Nationality (key: nationality)
- Class / Grade last studied or applied for (key: grade)
- School Name / Institution (key: previous_school)
- Admission Number / Registration Number (key: admission_no)
- Certificate Serial Number / TC Number (key: certificate_no)
- Subjects studied (key: subjects)
- Permanent Education Number (PEN) or Student ID (key: pen_number)
- Date of Admission / Date of Issue (key: date_of_issue)
- Contact info, phone, address, city, state, pincode (if present)

Return a JSON object matching this structure:
{
  "facts": [
    {
      "key": "snake_case_key (e.g. student_name, dob, gender, grade, parent_name, father_name, mother_name, email, phone, address, city, state, zip_code, previous_school, nationality)",
      "label": "Human Readable Label (e.g. Student Name, Date of Birth, Gender, Applying Grade, Father's Name, Mother's Name, Previous School, Nationality)",
      "value": "Exact extracted value as a clean string",
      "confidence": 0.95
    }
  ]
}
Respond ONLY with valid JSON."""

        response_text = ""
        last_error = None

        if self.client is not None:
            from google.genai import types

            part = types.Part.from_bytes(data=image_bytes, mime_type=mime_type)
            contents = [part, prompt]
            config = types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.1,
            )

            response_text, _quota_exhausted, last_error = await self._generate_with_failover(
                contents=contents,
                config=config,
                log_context="image fact extraction",
            )

        if not response_text and is_openrouter_configured():
            logging.info(
                f"Gemini Vision unavailable or failed ({last_error}). Engaging OpenRouter fallback provider for image {document_name}."
            )
            import base64
            b64_img = base64.b64encode(image_bytes).decode("utf-8")
            try:
                or_messages = [
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": prompt},
                            {"type": "image_url", "image_url": {"url": f"data:{mime_type};base64,{b64_img}"}},
                        ],
                    }
                ]
                response_text = await self._generate_openrouter_async(messages=or_messages)
            except Exception as or_err:
                logging.warning(f"OpenRouter vision fallback failed: {or_err}")
                last_error = f"Gemini ({last_error}), OpenRouter ({or_err})"

        if not response_text:
            raise RuntimeError(
                f"Failed to extract facts from image using AI providers. Last error: {last_error}"
            )

        facts = self._parse_facts_json(response_text, document_name)
        logging.info(
            f"Successfully extracted {len(facts)} facts from image {document_name}"
        )
        return facts

    async def extract_facts_from_text(
        self,
        *,
        text: str,
        document_name: str = "document.txt",
    ) -> List[ExtractedFact]:
        """
        Extract structured domain facts from document text using Gemini or OpenRouter fallback.

        Args:
            text (str): Raw or parsed document text content.
            document_name (str): Label for logging and trace context.

        Returns:
            List[ExtractedFact]: Discovered entity facts.

        Raises:
            RuntimeError: If all candidate AI providers fail or are unconfigured.
        """
        logging.info(
            f"Executing GeminiService.extract_facts_from_text for {document_name} "
            f"({len(text)} characters)"
        )
        self._ensure_client()
        if self.client is None and not is_openrouter_configured():
            raise RuntimeError(
                "Gemini API key is required to extract facts from text. "
                "Set GEMINI_API_KEY in backend/.env and restart the backend."
            )

        prompt = f"""You are AutoFiller AI, an expert document intelligence assistant specialized in educational records, transfer certificates (TC), admission forms, marksheets, and identity documents.
Carefully examine the entire document text below:

{text}

Extract all visible details, especially:
- Student's Full Name (key: student_name)
- Mother's Name (key: mother_name)
- Father's / Guardian's Name (key: parent_name or father_name)
- Date of Birth in figures or words (key: dob, e.g. 16/12/2010)
- Gender / Sex (key: gender)
- Nationality (key: nationality)
- Class / Grade last studied or applied for (key: grade)
- School Name / Institution (key: previous_school)
- Admission Number / Registration Number (key: admission_no)
- Certificate Serial Number / TC Number (key: certificate_no)
- Subjects studied (key: subjects)
- Permanent Education Number (PEN) or Student ID (key: pen_number)
- Date of Admission / Date of Issue (key: date_of_issue)
- Contact info, email (key: email), primary phone (key: phone), alternate phone (key: alternate_phone), residential address / street address (key: address), city (key: city), state (key: state), pincode / zip code (key: zip_code)
- Blood group (key: blood_group)
- Allergies (key: allergies)
- Transport required (key: transport)

Return a JSON object matching this structure:
{{
  "facts": [
    {{
      "key": "snake_case_key (e.g. student_name, dob, gender, grade, parent_name, father_name, mother_name, email, phone, alternate_phone, address, city, state, zip_code, previous_school, nationality, blood_group)",
      "label": "Human Readable Label (e.g. Student Name, Date of Birth, Gender, Applying Grade, Father's Name, Mother's Name, Previous School, Nationality, Residential Address)",
      "value": "Exact extracted value as a clean string",
      "confidence": 0.95
    }}
  ]
}}
Respond ONLY with valid JSON."""

        response_text = ""
        last_error = None

        if self.client is not None:
            try:
                from google.genai import types

                config = types.GenerateContentConfig(
                    response_mime_type="application/json",
                    temperature=0.1,
                )

                response_text, _quota_exhausted, last_error = await self._generate_with_failover(
                    contents=prompt,
                    config=config,
                    log_context="text fact extraction",
                )
            except Exception as gemini_err:
                last_error = str(gemini_err)
                logging.warning(f"Primary Gemini text extraction failed: {gemini_err}")

        if not response_text and is_openrouter_configured():
            logging.info(
                f"Gemini text extraction failed or unavailable ({last_error}). Engaging OpenRouter fallback provider for {document_name}."
            )
            try:
                response_text = await self._generate_openrouter_async(
                    messages=[{"role": "user", "content": prompt}]
                )
            except Exception as or_err:
                logging.warning(f"OpenRouter text fallback failed: {or_err}")
                last_error = f"Gemini ({last_error}), OpenRouter ({or_err})"

        if not response_text:
            raise RuntimeError(
                f"Failed to extract facts from text using AI providers. Last error: {last_error}"
            )

        facts = self._parse_facts_json(response_text, document_name)
        logging.info(
            f"Successfully extracted {len(facts)} facts from text in {document_name}"
        )
        return facts

    async def map_form_fields(
        self,
        *,
        form_snapshot: FormSnapshot,
        facts: List[ExtractedFact],
    ) -> Tuple[List[FieldMapping], List[ClarificationRequest], List[str]]:
        """
        Synthesize semantic mappings and identify clarification requirements.

        Args:
            form_snapshot (FormSnapshot): Active web form observation snapshot.
            facts (List[ExtractedFact]): Document facts available for population.

        Returns:
            Tuple[List[FieldMapping], List[ClarificationRequest], List[str]]:
                Mappings, clarification requests, and unmapped field references.

        Raises:
            RuntimeError: If the Gemini client is unconfigured or mapping fails.
        """
        logging.info(
            f"Executing GeminiService.map_form_fields for "
            f"{len(form_snapshot.fields)} fields and {len(facts)} facts"
        )
        self._ensure_client()
        if self.client is None:
            raise RuntimeError(
                "Gemini API client is not configured. A valid Gemini API key is required; "
                "set GEMINI_API_KEY in backend/.env and restart the backend."
            )

        try:
            return await self._map_with_gemini(form_snapshot, facts)
        except Exception as error:
            logging.error(f"Error in GeminiService.map_form_fields: {error}")
            raise

    async def _map_with_gemini(
        self,
        form_snapshot: FormSnapshot,
        facts: List[ExtractedFact],
    ) -> Tuple[List[FieldMapping], List[ClarificationRequest], List[str]]:
        """
        Execute Gemini structured mapping and normalize the response.

        Args:
            form_snapshot (FormSnapshot): Active form snapshot.
            facts (List[ExtractedFact]): Document facts.

        Returns:
            Tuple[List[FieldMapping], List[ClarificationRequest], List[str]]:
                Mappings, clarifications, and unmapped field refs.

        Raises:
            RuntimeError: If every candidate model fails to return usable JSON.
        """
        logging.info("Executing GeminiService._map_with_gemini")
        prompt = f"""You are AutoFiller AI. Map extracted document facts to web form fields.

Extracted Document Facts:
{json.dumps([f.model_dump() for f in facts], indent=2)}

Target Form Fields:
{json.dumps([f.model_dump() for f in form_snapshot.fields], indent=2)}

CRITICAL DATE FORMATTING REQUIREMENT:
For all date fields (such as Date of Birth, DOB, Date of Admission, etc.), format fact_value strictly in DD/MM/YYYY format (e.g. 15/08/2010). Do NOT convert dates to YYYY-MM-DD or MM/DD/YYYY.

Return a JSON object with:
{{
  "mappings": [
    {{
      "field_ref": "string",
      "field_label": "string",
      "fact_key": "string or null",
      "fact_value": "string",
      "confidence": float (0.0 to 1.0),
      "is_ambiguous": boolean,
      "clarification_question": "string if ambiguous, else null",
      "options": ["string"]
    }}
  ]
}}
Respond ONLY with valid JSON."""

        mapping_timeout = get_ai_mapping_timeout_seconds()
        response_text, quota_exhausted, last_error = await self._generate_with_failover(
            contents=prompt,
            log_context="Gemini field mapping",
            timeout=mapping_timeout,
        )
        if not response_text and is_openrouter_configured():
            logging.info(
                f"Gemini field mapping failed or unavailable ({last_error}). Engaging OpenRouter fallback provider."
            )
            try:
                response_text = await self._generate_openrouter_async(
                    messages=[{"role": "user", "content": prompt}],
                    timeout=mapping_timeout,
                )
            except Exception as or_err:
                logging.warning(f"OpenRouter field mapping fallback failed: {or_err}")

        if not response_text:
            logging.warning(
                f"All AI mapping providers failed (last error: {last_error}). "
                "Engaging deterministic heuristic field mapping fallback."
            )
            return self._map_heuristic_fallback(form_snapshot, facts)

        try:
            parsed = json.loads(_strip_code_fences(response_text))
        except Exception as parse_error:
            logging.warning(
                f"Failed to parse Gemini JSON: {parse_error}. Engaging heuristic fallback."
            )
            return self._map_heuristic_fallback(form_snapshot, facts)

        mappings: List[FieldMapping] = []
        clarifications: List[ClarificationRequest] = []
        unmapped: List[str] = []

        for item in parsed.get("mappings", []):
            field_ref = item.get("field_ref")
            if not field_ref:
                continue
            mapping_val = str(item.get("fact_value") or "")
            fact_key = item.get("fact_key")
            field_label = item.get("field_label", "")
            if _is_date_field_or_key(fact_key, field_label) and mapping_val:
                mapping_val = format_to_strict_dd_mm_yyyy(mapping_val)

            if item.get("is_ambiguous", False):
                clarification_id = f"clarify_{field_ref}"
                clarifications.append(
                    ClarificationRequest(
                        clarification_id=clarification_id,
                        field_ref=field_ref,
                        field_label=field_label,
                        question=item.get("clarification_question")
                        or f"Please confirm value for {field_label}",
                        options=item.get("options") or [],
                        selected_value=mapping_val,
                    )
                )
                mappings.append(
                    FieldMapping(
                        field_ref=field_ref,
                        field_label=field_label,
                        fact_key=fact_key,
                        fact_value=mapping_val,
                        confidence=item.get("confidence", 0.7),
                        status="CLARIFICATION_REQUIRED",
                        clarification_id=clarification_id,
                    )
                )
            elif mapping_val:
                mappings.append(
                    FieldMapping(
                        field_ref=field_ref,
                        field_label=field_label,
                        fact_key=fact_key,
                        fact_value=mapping_val,
                        confidence=item.get("confidence", 0.95),
                        status="PENDING",
                    )
                )
            else:
                unmapped.append(field_ref)

        # Supplement any unmapped or missing fields with heuristic fallback
        accounted_refs = {m.field_ref for m in mappings} | {c.field_ref for c in clarifications}
        missing_fields = [f for f in form_snapshot.fields if f.ref not in accounted_refs]
        if missing_fields:
            missing_snapshot = FormSnapshot(
                url=form_snapshot.url,
                title=form_snapshot.title,
                fields=missing_fields,
            )
            h_maps, h_clars, _ = self._map_heuristic_fallback(missing_snapshot, facts)
            for hm in h_maps:
                mappings.append(hm)
                accounted_refs.add(hm.field_ref)
            for hc in h_clars:
                clarifications.append(hc)
                accounted_refs.add(hc.field_ref)

        unmapped = [f.ref for f in form_snapshot.fields if f.ref not in accounted_refs]
        return mappings, clarifications, unmapped

    def _map_heuristic_fallback(
        self,
        form_snapshot: FormSnapshot,
        facts: List[ExtractedFact],
    ) -> Tuple[List[FieldMapping], List[ClarificationRequest], List[str]]:
        """
        Deterministic heuristic fallback mapper when Gemini provider models are unavailable or rate-limited.

        Matches form field labels, names, and control types to extracted facts.

        Args:
            form_snapshot (FormSnapshot): Target form fields.
            facts (List[ExtractedFact]): Document facts.

        Returns:
            Tuple[List[FieldMapping], List[ClarificationRequest], List[str]]:
                Synthesized field mappings, clarification requests, and unmapped field refs.
        """
        logging.warning(
            "Executing GeminiService._map_heuristic_fallback due to provider failure or rate limit"
        )
        fact_dict: Dict[str, ExtractedFact] = {f.key.lower(): f for f in facts}

        mappings: List[FieldMapping] = []
        clarifications: List[ClarificationRequest] = []
        unmapped: List[str] = []

        phone_facts = [
            f
            for f in facts
            if "phone" in f.key.lower()
            or "mobile" in f.key.lower()
            or "contact" in f.key.lower()
        ]

        for field in form_snapshot.fields:
            label_lower = (field.label or "").lower()
            ref_lower = (field.ref or "").lower()
            name_lower = f"{label_lower} {ref_lower}"

            matched_fact: Optional[ExtractedFact] = None
            is_ambiguous = False
            question = None
            options: List[str] = []

            if "father" in name_lower:
                matched_fact = (
                    fact_dict.get("father_name")
                    or fact_dict.get("father")
                    or fact_dict.get("guardian_name")
                )
            elif "mother" in name_lower:
                matched_fact = fact_dict.get("mother_name") or fact_dict.get("mother")
            elif "student" in name_lower or (
                "name" in name_lower
                and not any(
                    k in name_lower for k in ["father", "mother", "guardian", "school"]
                )
            ):
                matched_fact = (
                    fact_dict.get("student_name")
                    or fact_dict.get("applicant_name")
                    or fact_dict.get("full_name")
                    or fact_dict.get("name")
                )
            elif "birth" in name_lower or "dob" in name_lower:
                matched_fact = fact_dict.get("dob") or fact_dict.get("date_of_birth")
            elif "gender" in name_lower or "sex" in name_lower:
                matched_fact = fact_dict.get("gender")
            elif (
                "grade" in name_lower
                or "class" in name_lower
                or "standard" in name_lower
            ):
                matched_fact = fact_dict.get("grade") or fact_dict.get("applying_grade")
            elif "email" in name_lower:
                matched_fact = fact_dict.get("email") or fact_dict.get("parent_email")
            elif (
                "phone" in name_lower
                or "mobile" in name_lower
                or "tel" in name_lower
                or "contact" in name_lower
            ):
                if (
                    len(phone_facts) > 1
                    and "alternate" not in name_lower
                    and "emergency" not in name_lower
                ):
                    matched_fact = phone_facts[0]
                    is_ambiguous = True
                    question = (
                        f"Multiple phone numbers available "
                        f"({', '.join(f.value for f in phone_facts)}). "
                        f"Which phone should be used for {field.label}?"
                    )
                    options = [f.value for f in phone_facts]
                elif "alternate" in name_lower or "emergency" in name_lower:
                    matched_fact = fact_dict.get("alternate_phone") or (
                        phone_facts[1] if len(phone_facts) > 1 else None
                    )
                else:
                    matched_fact = fact_dict.get("phone") or (
                        phone_facts[0] if phone_facts else None
                    )
            elif "address" in name_lower:
                matched_fact = fact_dict.get("address") or fact_dict.get(
                    "residential_address"
                )
            elif "city" in name_lower:
                matched_fact = fact_dict.get("city")
            elif "state" in name_lower:
                matched_fact = fact_dict.get("state")
            elif (
                "zip" in name_lower
                or "postal" in name_lower
                or "pincode" in name_lower
                or "pin" in name_lower
            ):
                matched_fact = (
                    fact_dict.get("postal_code")
                    or fact_dict.get("zip_code")
                    or fact_dict.get("zip")
                    or fact_dict.get("pincode")
                )
            elif "blood" in name_lower:
                matched_fact = fact_dict.get("blood_group") or fact_dict.get("blood")
            elif "school" in name_lower:
                matched_fact = fact_dict.get("previous_school")

            # Fallback containment matching across all facts
            if not matched_fact:
                for k, fact in fact_dict.items():
                    if k in name_lower:
                        matched_fact = fact
                        break

            if matched_fact:
                clarification_id = f"clarify_{field.ref}" if is_ambiguous else None
                fact_val = matched_fact.value
                if _is_date_field_or_key(matched_fact.key, field.label) and fact_val:
                    fact_val = format_to_strict_dd_mm_yyyy(fact_val)

                if is_ambiguous:
                    clarifications.append(
                        ClarificationRequest(
                            clarification_id=clarification_id,
                            field_ref=field.ref,
                            field_label=field.label,
                            question=question or f"Clarify value for {field.label}",
                            options=options,
                            selected_value=fact_val,
                        )
                    )
                mappings.append(
                    FieldMapping(
                        field_ref=field.ref,
                        field_label=field.label,
                        fact_key=matched_fact.key,
                        fact_value=fact_val,
                        confidence=0.85 if is_ambiguous else 0.95,
                        status="CLARIFICATION_REQUIRED" if is_ambiguous else "PENDING",
                        clarification_id=clarification_id,
                    )
                )
            else:
                unmapped.append(field.ref)

        return mappings, clarifications, unmapped


_gemini_service_instance: Optional[GeminiService] = None


def get_gemini_service() -> GeminiService:
    """
    Get or create the shared Gemini service instance.

    A singleton avoids re-reading credentials and rebuilding a provider client on
    every request, and keeps a single source of truth for the active API key.

    Returns:
        GeminiService: Shared Gemini reasoning service.
    """
    global _gemini_service_instance
    if _gemini_service_instance is None:
        _gemini_service_instance = GeminiService()
    return _gemini_service_instance
