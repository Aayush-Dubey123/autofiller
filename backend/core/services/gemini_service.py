"""
Gemini reasoning and semantic field mapping service for FormPilot backend.

Synthesizes correspondences between FormSnapshot fields and ExtractedFacts using the
Google GenAI SDK through non-blocking async execution.
"""

import asyncio
import json
import os
import re
from typing import Any, Dict, List, Optional, Tuple, Union

from commons.logger import logger
from core.models.session_model import (
    ClarificationRequest,
    ExtractedFact,
    FieldMapping,
    FormSnapshot,
)
from core.services.secrets_service import get_secrets_service

logging = logger(__name__)

# Single canonical default. gemini-3.5-flash is stable and supported.
DEFAULT_GEMINI_MODEL = "gemini-3.5-flash"

# Fallback models if default model is rate limited (429) or unavailable.
FALLBACK_GEMINI_MODELS = [
    "gemini-3.5-flash-lite",
    "gemini-3.6-flash",
]

# Provider call budget. Bounded so a hung provider cannot stall the event loop forever.
GEMINI_TIMEOUT_SECONDS = 45.0
GEMINI_MAX_ATTEMPTS = 2


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
        Initialize the Gemini client from securely stored credentials.

        Reads the API key through the encrypted secrets service rather than only from
        plaintext environment configuration.
        """
        logging.info("Executing GeminiService.__init__")
        self.secrets_service = get_secrets_service()
        self.api_key = self.secrets_service.get_api_key()
        self.model = (
            os.getenv("GEMINI_MODEL", "").strip()
            or self.secrets_service.get_model()
            or DEFAULT_GEMINI_MODEL
        )
        self.client = None
        if self.api_key:
            self._build_client(self.api_key)
        else:
            logging.info("Gemini client not initialized: no API key configured")

    def _build_client(self, api_key: str) -> None:
        """
        Construct the underlying Google GenAI client.

        Args:
            api_key (str): Google AI Studio API key.

        Returns:
            None

        Raises:
            None
        """
        try:
            from google import genai

            self.client = genai.Client(api_key=api_key)
            logging.info("Initialized Google GenAI client successfully")
        except Exception as error:
            self.client = None
            logging.error(f"Could not initialize Google GenAI client: {error}")

    def update_credentials(
        self, api_key: str, model: str = DEFAULT_GEMINI_MODEL
    ) -> None:
        """
        Update active Gemini credentials and reinitialize the client.

        Args:
            api_key (str): Google AI Studio API key.
            model (str): Gemini model identifier.

        Returns:
            None

        Raises:
            Exception: If client instantiation fails.
        """
        logging.info("Executing GeminiService.update_credentials")
        self.api_key = api_key.strip()
        self.model = model.strip() or DEFAULT_GEMINI_MODEL
        if not self.api_key:
            self.client = None
            return
        self._build_client(self.api_key)
        if self.client is None:
            raise RuntimeError(
                "Failed to instantiate Gemini client with supplied credentials"
            )

    def update_model(self, model: str) -> None:
        """
        Update the active Gemini model identifier without touching credentials.

        Args:
            model (str): Gemini model identifier.

        Returns:
            None

        Raises:
            None
        """
        logging.info("Executing GeminiService.update_model")
        self.model = model.strip() or DEFAULT_GEMINI_MODEL

    def _ensure_client(self) -> None:
        """Attempt to initialize the client from the secrets store if not yet ready."""
        if self.client is None:
            api_key = self.secrets_service.get_api_key()
            if api_key:
                self._build_client(api_key)

    async def _generate_async(
        self,
        *,
        model: str,
        contents: Any,
        config: Optional[Any] = None,
    ) -> str:
        """
        Execute a non-blocking Gemini generation call with a hard timeout.

        Runs the synchronous SDK call in a worker thread so the FastAPI event loop is
        never blocked by provider latency.

        Args:
            model (str): Gemini model identifier.
            contents (Any): Prompt string or multimodal content parts.
            config (Optional[Any]): Optional generation config.

        Returns:
            str: Model response text.

        Raises:
            RuntimeError: If the provider call fails or exceeds the configured timeout.
        """
        self._ensure_client()
        if self.client is None:
            raise RuntimeError("Gemini client is not initialized.")

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
            timeout=GEMINI_TIMEOUT_SECONDS,
        )

    async def _generate_with_failover(
        self,
        *,
        contents: Any,
        config: Optional[Any] = None,
        log_context: str = "generation",
    ) -> Tuple[str, bool, Optional[str]]:
        """
        Generate content across candidate models with bounded retries and failover.

        Owns the candidate-model list, the per-model attempt loop, and the 429/404
        short-circuit so deterministic provider failures fail over immediately instead
        of burning every attempt. Shared by both the vision and mapping code paths.

        Args:
            contents (Any): Prompt string or multimodal content parts.
            config (Optional[Any]): Optional generation config.
            log_context (str): Label used in log messages.

        Returns:
            Tuple[str, bool, Optional[str]]: Response text (empty if all failed), a
                flag indicating a project-level quota exhaustion (429), and the last
                error message when generation did not succeed.
        """
        models_to_try = [self.model or DEFAULT_GEMINI_MODEL]
        for alternative in FALLBACK_GEMINI_MODELS:
            if alternative not in models_to_try:
                models_to_try.append(alternative)

        last_error: Optional[str] = None
        response_text = ""
        quota_exhausted = False
        for candidate_model in models_to_try:
            for attempt in range(GEMINI_MAX_ATTEMPTS):
                try:
                    logging.info(
                        f"Attempting {log_context} with model {candidate_model} "
                        f"(attempt {attempt + 1})"
                    )
                    response_text = await self._generate_async(
                        model=candidate_model,
                        contents=contents,
                        config=config,
                    )
                    if response_text:
                        break
                except asyncio.TimeoutError:
                    last_error = f"timeout after {GEMINI_TIMEOUT_SECONDS:.0f}s"
                    logging.warning(
                        f"Model {candidate_model} timed out on attempt {attempt + 1}"
                    )
                except Exception as error:
                    last_error = str(error)
                    logging.warning(
                        f"{log_context.capitalize()} with model {candidate_model} "
                        f"attempt {attempt + 1} failed: {error}"
                    )
                    # If a model returns 429 or 404, break attempt loop for this model and try next model
                    if "429" in last_error or "RESOURCE_EXHAUSTED" in last_error or "404" in last_error:
                        logging.info(f"Model {candidate_model} quota or availability issue, trying next alternative candidate model")
                        break
                if attempt < GEMINI_MAX_ATTEMPTS - 1:
                    await asyncio.sleep(1)
            if response_text:
                break
        return response_text, False, None if response_text else last_error

    async def extract_facts_from_image(
        self,
        *,
        image_bytes: bytes,
        mime_type: str = "image/png",
        document_name: str = "document.png",
    ) -> List[ExtractedFact]:
        """
        Extract structured domain facts from an image or scanned document page.

        Uses Gemini multimodal vision capabilities to extract student and administrative
        facts directly from raw image bytes.

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
        if self.client is None:
            raise RuntimeError(
                "Gemini API key is required to extract facts from images. "
                "Please configure your Google Gemini API key in Settings."
            )

        from google.genai import types

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

        if not response_text:
            raise RuntimeError(
                f"Failed to extract facts from image using Gemini. Last error: {last_error}"
            )

        parsed = json.loads(_strip_code_fences(response_text))
        facts: List[ExtractedFact] = []
        seen_keys = set()

        for item in parsed.get("facts", []):
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

        logging.info(
            f"Gemini Vision successfully extracted {len(facts)} facts from {document_name}"
        )
        return facts

    async def extract_facts_from_text(
        self,
        *,
        text: str,
        document_name: str = "document.txt",
    ) -> List[ExtractedFact]:
        """
        Extract structured domain facts from document text using Gemini.

        Args:
            text (str): Raw or parsed document text content.
            document_name (str): Label for logging and trace context.

        Returns:
            List[ExtractedFact]: Discovered entity facts.

        Raises:
            RuntimeError: If client is unconfigured or candidate models fail.
        """
        logging.info(
            f"Executing GeminiService.extract_facts_from_text for {document_name} "
            f"({len(text)} characters)"
        )
        self._ensure_client()
        if self.client is None:
            raise RuntimeError(
                "Gemini API key is required to extract facts from text. "
                "Please configure your Google Gemini API key in Settings."
            )

        from google.genai import types

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

        config = types.GenerateContentConfig(
            response_mime_type="application/json",
            temperature=0.1,
        )

        response_text, _quota_exhausted, last_error = await self._generate_with_failover(
            contents=prompt,
            config=config,
            log_context="text fact extraction",
        )

        if not response_text:
            raise RuntimeError(
                f"Failed to extract facts from text using Gemini. Last error: {last_error}"
            )

        parsed = json.loads(_strip_code_fences(response_text))
        facts: List[ExtractedFact] = []
        seen_keys = set()

        for item in parsed.get("facts", []):
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

        logging.info(
            f"Gemini Text successfully extracted {len(facts)} facts from {document_name}"
        )
        return facts

    async def test_connection(
        self, api_key: str, model: str = DEFAULT_GEMINI_MODEL
    ) -> dict:
        """
        Validate a candidate Gemini API key without persisting it.

        Args:
            api_key (str): API key to validate.
            model (str): Gemini model identifier.

        Returns:
            dict: Verification status with latency and model info.

        Raises:
            None
        """
        import time

        logging.info("Executing GeminiService.test_connection")
        clean_key = (api_key or "").strip()
        clean_model = (model or DEFAULT_GEMINI_MODEL).strip()
        if not clean_key:
            return {"valid": False, "message": "API key cannot be empty"}

        try:
            from google import genai

            test_client = genai.Client(api_key=clean_key)

            def _call() -> str:
                """Perform the blocking validation call inside the worker thread."""
                response = test_client.models.generate_content(
                    model=clean_model,
                    contents="Ping. Respond with 'OK'.",
                )
                return (response.text or "").strip()

            start_time = time.time()
            text = await asyncio.wait_for(
                asyncio.to_thread(_call),
                timeout=GEMINI_TIMEOUT_SECONDS,
            )
            elapsed_ms = int((time.time() - start_time) * 1000)
            return {
                "valid": True,
                "message": f"Successfully connected to {clean_model}",
                "latency_ms": elapsed_ms,
                "model": clean_model,
                "sample_response": text,
            }
        except asyncio.TimeoutError:
            logging.warning(
                f"Gemini test connection timed out after {GEMINI_TIMEOUT_SECONDS}s"
            )
            return {
                "valid": False,
                "message": f"Connection timed out after {GEMINI_TIMEOUT_SECONDS:.0f}s",
                "model": clean_model,
            }
        except Exception as error:
            logging.warning(f"Gemini test connection failed: {error}")
            return {
                "valid": False,
                "message": "Connection failed. Verify the API key and model name.",
                "model": clean_model,
            }

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
        if self.client is None:
            self.api_key = self.secrets_service.get_api_key()
            if self.api_key:
                self._build_client(self.api_key)
        if self.client is None:
            raise RuntimeError(
                "Gemini API client is not configured. A valid Gemini API key is required; "
                "configure it in Settings before running a session."
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

        response_text, quota_exhausted, last_error = await self._generate_with_failover(
            contents=prompt,
            log_context="Gemini field mapping",
        )
        if not response_text:
            logging.warning(
                f"All candidate Gemini models failed (last error: {last_error}). "
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
