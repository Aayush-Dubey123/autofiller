"""
Document extraction service for FormPilot backend.

Extracts structured domain facts from PDF documents and text files using PyMuPDF and
NLP heuristics, with strict path containment and size limits.
"""

import os
import re
from pathlib import Path
from typing import List, Optional

import pymupdf
from commons.logger import logger
from core.models.session_model import ExtractedFact
from core.services.gemini_service import get_gemini_service

logging = logger(__name__)

# Supported image file extensions for direct vision-based fact extraction.
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}
MIME_TYPE_MAP = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
}

# Hard ceiling on document size. Prevents unbounded reads of large system files.
MAX_DOCUMENT_BYTES = 25 * 1024 * 1024

# Hard ceiling on extracted text used for fact parsing.
MAX_EXTRACTED_CHARS = 400_000

# Root directories a caller may read documents from. Additional roots can be supplied
# through the environment for packaged deployments, but reads are never unrestricted.
ALLOWED_ROOTS_ENV = "AUTOFILLER_DOCUMENT_ROOTS"

# Canonical mapping for common educational document fields and their aliases
KEY_ALIASES = {
    "student_full_name": "student_name",
    "name_of_student": "student_name",
    "candidate_name": "student_name",
    "applicant_name": "student_name",
    "full_name": "student_name",
    "birth_date": "dob",
    "date_of_birth": "dob",
    "applying_grade___class": "grade",
    "applying_grade": "grade",
    "applying_for_grade": "grade",
    "class": "grade",
    "standard": "grade",
    "father's_name": "parent_name",
    "fathers_name": "parent_name",
    "father_name": "parent_name",
    "guardian's_name": "parent_name",
    "guardian_name": "parent_name",
    "mother's_name": "mother_name",
    "mothers_name": "mother_name",
    "parent_email_address": "email",
    "email_address": "email",
    "primary_phone_number": "phone",
    "primary_phone": "phone",
    "phone_number": "phone",
    "contact_phone": "phone",
    "contact_number": "phone",
    "alternate_contact_phone": "alternate_phone",
    "alternate_phone_number": "alternate_phone",
    "alternate_phone": "alternate_phone",
    "secondary_phone": "alternate_phone",
    "street_address": "address",
    "residential_address": "address",
    "permanent_address": "address",
    "postal___zip_code": "zip_code",
    "postal_code": "zip_code",
    "zip_code": "zip_code",
    "pincode": "zip_code",
    "pin_code": "zip_code",
    "previous_school_attended": "previous_school",
    "last_attended_school": "previous_school",
    "does_student_have_allergies?": "allergies",
    "does_student_have_allergies": "allergies",
    "allergies": "allergies",
    "does_student_require_transport?": "transport",
    "does_student_require_transport": "transport",
    "transport": "transport",
    "emergency_contact_person": "emergency_contact",
}

CANONICAL_LABELS = {
    "student_name": "Student Name",
    "dob": "Date of Birth",
    "gender": "Gender",
    "grade": "Applying Grade",
    "parent_name": "Father / Guardian Name",
    "mother_name": "Mother's Name",
    "email": "Parent Email Address",
    "phone": "Primary Phone Number",
    "alternate_phone": "Alternate Phone Number",
    "address": "Street Address",
    "city": "City",
    "state": "State",
    "zip_code": "Postal / ZIP Code",
    "blood_group": "Blood Group",
    "previous_school": "Previous School",
    "allergies": "Allergies",
    "transport": "Transport Required",
    "emergency_contact": "Emergency Contact",
}


class DocumentAccessError(Exception):
    """Raised when a requested document path violates access policy."""


def _allowed_roots() -> List[Path]:
    """
    Resolve the set of directories documents may be read from.

    Always includes the per-user home directory and the system temp directory, and
    honors an explicit override list for packaged deployments.

    Returns:
        List[Path]: Canonical allowed root directories.
    """
    roots: List[Path] = [
        Path.home().resolve(),
        Path(os.getenv("TEMP", "/tmp")).resolve(),
    ]
    # Allow bundled test fixtures directory for local runs and demonstration
    workspace_dir = Path(__file__).resolve().parents[3]
    if workspace_dir.exists() and workspace_dir.is_dir():
        roots.append(workspace_dir.resolve())
    fixtures_dir = workspace_dir / "test-fixtures"
    if fixtures_dir.exists() and fixtures_dir.is_dir():
        roots.append(fixtures_dir.resolve())

    configured = os.getenv(ALLOWED_ROOTS_ENV, "").strip() or os.getenv("FORMPILOT_DOCUMENT_ROOTS", "").strip()
    if configured:
        for entry in configured.split(os.pathsep):
            cleaned = entry.strip()
            if cleaned:
                roots.append(Path(cleaned).expanduser().resolve())

    unique: List[Path] = []
    for root in roots:
        if root not in unique:
            unique.append(root)
    return unique


class DocumentService:
    """Service loading and parsing document facts from local files."""

    def __init__(self) -> None:
        """Initialize the document service."""
        logging.info("Executing DocumentService.__init__")

    def _resolve_safe_path(self, file_path: str) -> Path:
        """
        Validate and canonicalize a caller-supplied document path.

        Resolves symlinks first, then requires the real path to live inside an allowed
        root. This blocks traversal escapes and symlink redirection to sensitive files.

        Args:
            file_path (str): Raw path supplied by the caller.

        Returns:
            Path: Canonical, validated absolute path.

        Raises:
            DocumentAccessError: If the path is not a regular file inside an allowed root.
        """
        # Normalize WITHOUT requiring existence first, so containment can be evaluated
        # before any filesystem probe. Otherwise a traversal attempt that misses returns
        # "not found" and hides the fact that it was refused on policy grounds.
        try:
            resolved = Path(file_path).expanduser().resolve(strict=False)
        except (OSError, RuntimeError) as error:
            logging.warning(f"Rejected unresolvable document path: {error}")
            raise DocumentAccessError("Document path could not be resolved") from error
        roots = _allowed_roots()
        if not any(resolved == root or root in resolved.parents for root in roots):
            logging.warning("Rejected document path outside permitted directories")
            raise DocumentAccessError(
                "Document path is outside the permitted directories. "
                "Select the file through the application's file picker."
            )

        if not resolved.exists():
            logging.warning("Document file not found")
            raise FileNotFoundError("File not found")

        # Re-resolve strictly now that containment is established, so a symlink cannot
        # redirect the read outside the allow-list after the check above.
        resolved = resolved.resolve(strict=True)
        if not any(resolved == root or root in resolved.parents for root in roots):
            logging.warning(
                "Rejected document path that escapes the allow-list via symlink"
            )
            raise DocumentAccessError(
                "Document path is outside the permitted directories."
            )

        if not resolved.is_file():
            logging.warning("Rejected document path that is not a regular file")
            raise DocumentAccessError("Document path is not a regular file")

        size = resolved.stat().st_size
        if size > MAX_DOCUMENT_BYTES:
            logging.warning(f"Rejected oversized document ({size} bytes)")
            raise DocumentAccessError(
                f"Document exceeds the maximum supported size of "
                f"{MAX_DOCUMENT_BYTES // (1024 * 1024)} MB"
            )
        return resolved

    async def extract_facts(
        self,
        *,
        file_path: Optional[str] = None,
        raw_text: Optional[str] = None,
        document_name: str = "document.pdf",
    ) -> List[ExtractedFact]:
        """
        Extract structured domain facts from a document.

        Reads textual content from a policy-approved PDF path or from a raw string, then
        parses structured key-value entities.

        Args:
            file_path (Optional[str]): Path to a PDF file inside an allowed root.
            raw_text (Optional[str]): Direct textual content if pre-loaded.
            document_name (str): Document display name.

        Returns:
            List[ExtractedFact]: Extracted structured key-value facts.

        Raises:
            DocumentAccessError: If the file path violates access policy.
            FileNotFoundError: If the provided file path does not exist.
            ValueError: If neither file_path nor raw_text is supplied.
            Exception: If document reading fails.
        """
        logging.info(f"Executing DocumentService.extract_facts for {document_name}")
        try:
            content = ""

            if raw_text:
                if len(raw_text) > MAX_EXTRACTED_CHARS:
                    logging.warning("Truncating oversized raw_text payload")
                    content = raw_text[:MAX_EXTRACTED_CHARS]
                else:
                    content = raw_text
            elif file_path:
                # Containment is evaluated inside _resolve_safe_path BEFORE any existence
                # probe, so a refused path cannot be used as a file-existence oracle.
                safe_path = self._resolve_safe_path(file_path)
                ext = safe_path.suffix.lower()

                # 1. Native image files (PNG, JPG, JPEG, WEBP, BMP)
                if ext in IMAGE_EXTENSIONS:
                    image_bytes = safe_path.read_bytes()
                    mime_type = MIME_TYPE_MAP.get(ext, "image/png")
                    gemini = get_gemini_service()
                    return await gemini.extract_facts_from_image(
                        image_bytes=image_bytes,
                        mime_type=mime_type,
                        document_name=document_name,
                    )

                # 2. PDF Documents
                if ext == ".pdf":
                    document = pymupdf.open(safe_path)
                    try:
                        pages_text = [page.get_text() for page in document]
                        page_count = len(document)
                    finally:
                        document.close()
                    content = "\n".join(pages_text).strip()
                    facts = self._parse_text_into_facts(content) if content else []

                    # If the PDF is scanned (low character count or fewer than 3 facts extracted),
                    # render page 0 at 200 DPI and invoke Gemini Vision extraction.
                    clean_chars = len(content.replace("\n", "").replace(" ", ""))
                    if (len(facts) < 3 or clean_chars < 120) and page_count > 0:
                        logging.info(
                            f"PDF {document_name} appears scanned ({clean_chars} chars, {len(facts)} facts); rendering page as image for Gemini Vision"
                        )
                        doc_for_render = pymupdf.open(safe_path)
                        try:
                            pix = doc_for_render[0].get_pixmap(dpi=200)
                            image_bytes = pix.tobytes("png")
                        finally:
                            doc_for_render.close()
                        try:
                            gemini = get_gemini_service()
                            vision_facts = await gemini.extract_facts_from_image(
                                image_bytes=image_bytes,
                                mime_type="image/png",
                                document_name=document_name,
                            )
                            if vision_facts:
                                logging.info(f"Gemini Vision extracted {len(vision_facts)} facts from scanned PDF {document_name}")
                                return vision_facts
                        except Exception as vision_err:
                            logging.warning(f"Gemini Vision extraction failed for {document_name}: {vision_err}")
                            if facts:
                                return facts
                            raise

                    # Try Gemini Text Extraction if client is configured and text is substantial
                    if content and len(content) > 50:
                        try:
                            gemini = get_gemini_service()
                            if gemini.api_key:
                                ai_facts = await gemini.extract_facts_from_text(
                                    text=content,
                                    document_name=document_name,
                                )
                                if ai_facts:
                                    logging.info(
                                        f"Gemini Text extraction yielded {len(ai_facts)} facts for {document_name}"
                                    )
                                    ai_keys = {f.key for f in ai_facts}
                                    for lf in facts:
                                        if lf.key not in ai_keys:
                                            ai_facts.append(lf)
                                    return ai_facts
                        except Exception as ai_err:
                            logging.warning(
                                f"Gemini Text extraction failed for {document_name}: {ai_err}; using local facts"
                            )

                    if facts:
                        logging.info(f"Extracted {len(facts)} facts from digital text in {document_name}")
                        return facts

                    content = content[:MAX_EXTRACTED_CHARS]
                else:
                    # 3. Text and structured plain documents
                    content = safe_path.read_text(encoding="utf-8", errors="ignore")[:MAX_EXTRACTED_CHARS]
            else:
                logging.warning("No file path or raw text provided to DocumentService")
                raise ValueError("Either file_path or raw_text must be provided")

            facts = self._parse_text_into_facts(content)
            if content and len(content) > 50:
                try:
                    gemini = get_gemini_service()
                    if gemini.api_key:
                        ai_facts = await gemini.extract_facts_from_text(
                            text=content,
                            document_name=document_name,
                        )
                        if ai_facts:
                            ai_keys = {f.key for f in ai_facts}
                            for lf in facts:
                                if lf.key not in ai_keys:
                                    ai_facts.append(lf)
                            return ai_facts
                except Exception as ai_err:
                    logging.warning(f"Gemini Text extraction fallback to local: {ai_err}")

            logging.info(f"Extracted {len(facts)} facts from {document_name}")
            return facts
        except (DocumentAccessError, FileNotFoundError, ValueError):
            raise
        except Exception as error:
            logging.error(f"Error in DocumentService.extract_facts: {error}")
            raise

    def _parse_text_into_facts(self, text: str) -> List[ExtractedFact]:
        """
        Parse raw text into standardized ExtractedFact instances.

        Combines multiline key-value detection, domain alias normalization, and
        hardened regex heuristics across common educational and administrative forms.

        Args:
            text (str): Full text extracted from the document.

        Returns:
            List[ExtractedFact]: Discovered entity facts.
        """
        logging.info("Executing DocumentService._parse_text_into_facts")
        facts: List[ExtractedFact] = []
        seen_keys = set()

        lines = [l.strip() for l in text.splitlines() if l.strip()]

        # Pass 1: Multiline key-value parsing
        # Handles PDFs where labels and values are on alternating lines (e.g. Line 1: Label:, Line 2: Value)
        for i, line in enumerate(lines):
            if line.endswith(":") and i + 1 < len(lines):
                next_line = lines[i + 1].strip()
                if not next_line.endswith(":") and not next_line.startswith("---"):
                    raw_k = line[:-1].strip().lower().replace(" ", "_").replace("/", "_")
                    clean_k = re.sub(r"[^a-z0-9_?']", "", raw_k)
                    canonical_k = KEY_ALIASES.get(clean_k, clean_k)
                    if canonical_k == "address" and "@" in next_line:
                        canonical_k = "email"
                    if len(canonical_k) > 1 and next_line and canonical_k not in seen_keys:
                        label = CANONICAL_LABELS.get(canonical_k, line[:-1].strip().title())
                        facts.append(
                            ExtractedFact(
                                key=canonical_k,
                                label=label,
                                value=next_line,
                                confidence=0.95,
                            )
                        )
                        seen_keys.add(canonical_k)
            elif ":" in line:
                parts = line.split(":", 1)
                val = parts[1].strip()
                if val:
                    raw_k = parts[0].strip().lower().replace(" ", "_").replace("/", "_")
                    clean_k = re.sub(r"[^a-z0-9_?']", "", raw_k)
                    canonical_k = KEY_ALIASES.get(clean_k, clean_k)
                    if canonical_k == "address" and "@" in val:
                        canonical_k = "email"
                    if len(canonical_k) > 1 and canonical_k not in seen_keys and len(canonical_k) < 40:
                        label = CANONICAL_LABELS.get(canonical_k, parts[0].strip().title())
                        facts.append(
                            ExtractedFact(
                                key=canonical_k,
                                label=label,
                                value=val,
                                confidence=0.90,
                            )
                        )
                        seen_keys.add(canonical_k)

        # Pass 2: Hardened regex patterns for unstructured text or missed fields
        patterns = [
            (
                "email",
                "Email Address",
                r"(?:email(?:\s*address)?)[\s:]+([a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+)",
            ),
            (
                "student_name",
                "Student Name",
                r"(?:student\s*name|candidate\s*name|applicant\s*name|full\s*name|name\s*of\s*student)[\s:]+([A-Za-z \.]{2,40})",
            ),
            (
                "dob",
                "Date of Birth",
                r"(?:date\s*of\s*birth|dob|birth\s*date)[\s:]+([0-9]{1,2}[-\/\.][0-9]{1,2}[-\/\.][0-9]{2,4}|[A-Za-z]+[ \t]+[0-9]{1,2},?[ \t]+[0-9]{4})",
            ),
            ("gender", "Gender", r"(?:gender|sex)[\s:]+(Male|Female|Other|M|F)\b"),
            (
                "grade",
                "Applying Grade",
                r"(?:applying\s*grade(?:\s*/\s*class)?|grade|class|standard|applying\s*for\s*grade)[\s:]+([0-9]{1,2}(?:th|st|nd|rd)?(?:\s*grade)?|[A-Za-z0-9 ]+)",
            ),
            (
                "parent_name",
                "Parent / Guardian Name",
                r"(?:father(?:'s)?\s*name|parent(?:'s)?\s*name|guardian(?:'s)?\s*name)[\s:]+([A-Za-z \.]{2,40})",
            ),
            (
                "mother_name",
                "Mother's Name",
                r"(?:mother(?:'s)?\s*name)[\s:]+([A-Za-z \.]{2,40})",
            ),
            (
                "phone",
                "Primary Phone",
                r"(?:primary\s*(?:phone|contact|mobile)(?:\s*number)?|phone(?:\s*number)?|mobile(?:\s*number)?|contact\s*no|telephone)[\s:]+([+\d\s\(\)-]{10,16})",
            ),
            (
                "alternate_phone",
                "Alternate Phone",
                r"(?:alternate\s*(?:contact\s*)?(?:phone|mobile|contact)(?:\s*number)?|alt\s*phone|secondary\s*phone)[\s:]+([+\d\s\(\)-]{10,16})",
            ),
            (
                "address",
                "Residential Address",
                r"(?:^|\n|\b)(?<!email\s)(?<!mail\s)(?:street\s*address|residential\s*address|permanent\s*address|\baddress\b)[\s:]+([0-9A-Za-z \r\n,./#-]{5,100})",
            ),
            ("city", "City", r"(?:city|town)[\s:]+([A-Za-z ]{2,30})"),
            ("state", "State", r"(?:state|province)[\s:]+([A-Za-z ]{2,30})"),
            (
                "zip_code",
                "Postal / ZIP Code",
                r"(?:zip(?:\s*code)?|postal(?:\s*code)?|pincode)[\s:]+([0-9]{5,6})",
            ),
            (
                "blood_group",
                "Blood Group",
                r"(?:blood\s*group)[\s:]+(A\+|A-|B\+|B-|AB\+|AB-|O\+|O-)\b",
            ),
            (
                "previous_school",
                "Previous School",
                r"(?:previous\s*school(?:\s*attended)?|last\s*attended\s*school)[\s:]+([A-Za-z0-9 ,.-]{3,60})",
            ),
        ]

        for key, label, pattern in patterns:
            match = re.search(pattern, text, re.IGNORECASE)
            if match and key not in seen_keys:
                raw_match = match.group(1).strip()
                val_lines = [vl.strip() for vl in raw_match.splitlines() if vl.strip()]
                value = val_lines[0] if val_lines else ""
                if value:
                    facts.append(
                        ExtractedFact(
                            key=key,
                            label=label,
                            value=value,
                            confidence=0.95,
                        )
                    )
                    seen_keys.add(key)

        return facts

