"""
Document extraction service for FormPilot backend.

Extracts structured domain facts from PDF documents and text files using PyMuPDF and
NLP heuristics, with strict path containment and size limits.
"""

import os
import re
import tempfile
from pathlib import Path
from typing import List, Optional

from fastapi import HTTPException, status
import pymupdf
from commons.logger import logger
from core.models.session_model import ExtractedFact
from core.services.gemini_service import (
    get_gemini_service,
    is_ai_provider_configured,
    is_openrouter_configured,
)

logging = logger(__name__)

# Whitelist of permitted document and image extensions, matching the native desktop file picker.
SUPPORTED_EXTENSIONS = {".pdf", ".png", ".jpg", ".jpeg", ".webp", ".txt"}

# Supported image file extensions for direct vision-based fact extraction.
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}
MIME_TYPE_MAP = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
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
    # Demographics and geography aliases (Finding 8)
    "sex": "gender",
    "gender": "gender",
    "biological_sex": "gender",
    "town": "city",
    "city": "city",
    "municipality": "city",
    "district": "city",
    "province": "state",
    "state": "state",
    "region": "state",
    "state_province": "state",
    # Schema-aligned aliases (Section 17)
    "mobile": "phone",
    "mobile_number": "phone",
    "mobile_no": "phone",
    "contact_no": "phone",
    "cell_phone": "phone",
    "phone_no": "phone",
    "alternate_mobile": "alternate_phone",
    "alt_mobile": "alternate_phone",
    "alt_phone": "alternate_phone",
    "caste": "category",
    "social_category": "category",
    "reservation_category": "category",
    "category": "category",
    "marital_status": "marital_status",
    "marriage_status": "marital_status",
    "nationality": "nationality",
    "citizenship": "nationality",
    "religion": "religion",
    "faith": "religion",
    "mother_tongue": "mother_tongue",
    "native_language": "mother_tongue",
    "first_language": "mother_tongue",
    "disability": "disability",
    "pwd": "disability",
    "physically_handicapped": "disability",
    "permanent_address": "permanent_address",
    "perm_address": "permanent_address",
    "permanent_city": "permanent_city",
    "permanent_state": "permanent_state",
    "permanent_pincode": "permanent_pincode",
    "permanent_zip_code": "permanent_pincode",
    "perm_pincode": "permanent_pincode",
    "annual_family_income": "annual_family_income",
    "family_income": "annual_family_income",
    "annual_income": "annual_family_income",
    "income": "annual_family_income",
    "father_occupation": "father_occupation",
    "mother_occupation": "mother_occupation",
    "guardian_name": "guardian_name",
    # ID Numbers (sensitive)
    "aadhar": "aadhaar_card_number",
    "aadhaar": "aadhaar_card_number",
    "aadhar_number": "aadhaar_card_number",
    "aadhaar_number": "aadhaar_card_number",
    "aadhar_card": "aadhaar_card_number",
    "aadhaar_card": "aadhaar_card_number",
    "aadhaar_card_number": "aadhaar_card_number",
    "uid": "aadhaar_card_number",
    "unique_id": "aadhaar_card_number",
    "pan": "pan_card_number",
    "pan_card": "pan_card_number",
    "pan_number": "pan_card_number",
    "pan_card_number": "pan_card_number",
    "pan_no": "pan_card_number",
    "passport": "passport_number",
    "passport_number": "passport_number",
    "passport_no": "passport_number",
    "voter_id": "voter_id_number",
    "voter_id_number": "voter_id_number",
    "driving_license": "driving_license_number",
    "driving_license_number": "driving_license_number",
    # Bank Details (sensitive)
    "bank_name": "bank_name",
    "bank_account_holder_name": "bank_account_holder_name",
    "account_holder_name": "bank_account_holder_name",
    "bank_account_number": "bank_account_number",
    "account_number": "bank_account_number",
    "account_no": "bank_account_number",
    "acc_no": "bank_account_number",
    "bank_acc_no": "bank_account_number",
    "ifsc": "ifsc_code",
    "ifsc_code": "ifsc_code",
    "ifsc_no": "ifsc_code",
    "branch_ifsc": "ifsc_code",
    "branch_name": "branch_name",
    # Academic & Education
    "10th_board": "education_10_board",
    "tenth_board": "education_10_board",
    "ssc_board": "education_10_board",
    "10th_percentage": "education_10_percentage",
    "tenth_percentage": "education_10_percentage",
    "ssc_percentage": "education_10_percentage",
    "10th_marks": "education_10_percentage",
    "10th_year": "education_10_year",
    "tenth_year": "education_10_year",
    "10th_school": "education_10_school",
    "tenth_school": "education_10_school",
    "12th_board": "education_12_board",
    "twelfth_board": "education_12_board",
    "hsc_board": "education_12_board",
    "12th_percentage": "education_12_percentage",
    "twelfth_percentage": "education_12_percentage",
    "hsc_percentage": "education_12_percentage",
    "12th_marks": "education_12_percentage",
    "12th_year": "education_12_year",
    "twelfth_year": "education_12_year",
    "12th_stream": "education_12_stream",
    "twelfth_stream": "education_12_stream",
    "diploma_board": "education_diploma_board",
    "diploma_percentage": "education_diploma_percentage",
    "graduation_degree": "education_grad_degree",
    "bachelor_degree": "education_grad_degree",
    "graduation_percentage": "education_grad_percentage",
    "graduation_university": "education_grad_university",
    "current_course": "current_course_name",
    "current_course_name": "current_course_name",
    "current_institute": "current_institute_name",
    "current_institute_name": "current_institute_name",
    "enrollment_number": "admission_enrollment_number",
    "admission_number": "admission_enrollment_number",
    # Professional
    "employment_status": "employment_status",
    "employer_name": "employer_name",
    "company_name": "employer_name",
    "designation": "designation",
    "job_title": "designation",
    "total_experience_years": "total_experience_years",
    "work_experience": "total_experience_years",
}

CANONICAL_LABELS = {
    "student_name": "Student Name",
    "dob": "Date of Birth",
    "gender": "Gender",
    "grade": "Applying Grade",
    "parent_name": "Father / Guardian Name",
    "father_name": "Father's Name",
    "mother_name": "Mother's Name",
    "email": "Parent Email Address",
    "phone": "Primary Phone Number",
    "alternate_phone": "Alternate Phone Number",
    "address": "Street Address",
    "city": "City",
    "state": "State",
    "zip_code": "Postal / ZIP Code",
    "pincode": "Pincode",
    "blood_group": "Blood Group",
    "previous_school": "Previous School",
    "allergies": "Allergies",
    "transport": "Transport Required",
    "emergency_contact": "Emergency Contact",
    "category": "Category",
    "marital_status": "Marital Status",
    "nationality": "Nationality",
    "religion": "Religion",
    "mother_tongue": "Mother Tongue",
    "disability": "Person with Disability (PwD)",
    "aadhaar_card_number": "Aadhaar Card Number",
    "pan_card_number": "PAN Card Number",
    "passport_number": "Passport Number",
    "bank_name": "Bank Name",
    "bank_account_number": "Bank Account Number",
    "ifsc_code": "IFSC Code",
    "branch_name": "Branch Name",
    "annual_family_income": "Annual Family Income",
    "education_10_board": "10th Board",
    "education_10_percentage": "10th Percentage",
    "education_12_board": "12th Board",
    "education_12_percentage": "12th Percentage",
    "education_grad_degree": "Graduation Degree",
    "current_course_name": "Current Course Name",
}


class DocumentAccessError(Exception):
    """Raised when a requested document path violates access policy."""


class DocumentEmptyError(HTTPException):
    """Raised when digital text extraction yields empty text and vision is unavailable or fails."""

    def __init__(self, detail: str = "No readable text found in this document"):
        super().__init__(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=detail)


class UnsupportedDocumentTypeError(HTTPException):
    """Raised when a document's file extension is not permitted."""

    def __init__(self, detail: str = "Unsupported document type"):
        super().__init__(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail=detail)


def _allowed_roots() -> List[Path]:
    """
    Resolve the set of directories documents may be read from.

    Restricted strictly to the designated system/app upload/temp directory and
    explicit test fixture directories. Broad home directory and workspace roots
    are excluded to prevent reading arbitrary user files.

    Returns:
        List[Path]: Canonical allowed root directories.
    """
    roots: List[Path] = [
        Path(tempfile.gettempdir()).resolve(),
        Path(os.getenv("TEMP", os.getenv("TMP", "/tmp"))).resolve(),
    ]
    # Allow bundled test fixtures directory for local runs and demonstration
    workspace_dir = Path(__file__).resolve().parents[3]
    fixtures_dir = workspace_dir / "test-fixtures"
    if fixtures_dir.exists() and fixtures_dir.is_dir():
        roots.append(fixtures_dir.resolve())

    configured = (
        os.getenv(ALLOWED_ROOTS_ENV, "").strip()
        or os.getenv("FORMPILOT_DOCUMENT_ROOTS", "").strip()
    )
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

                # Whitelist permitted document formats (Finding 7)
                if ext not in SUPPORTED_EXTENSIONS:
                    raise UnsupportedDocumentTypeError(
                        f"Unsupported document file extension '{ext}'. Permitted extensions: {', '.join(sorted(SUPPORTED_EXTENSIONS))}"
                    )

                # 1. Native image files (PNG, JPG, JPEG, WEBP)
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
                            if (not gemini.api_key or not gemini.client) and not is_openrouter_configured():
                                raise RuntimeError("AI extraction provider is not configured or failed extraction")
                            vision_facts = await gemini.extract_facts_from_image(
                                image_bytes=image_bytes,
                                mime_type="image/png",
                                document_name=document_name,
                            )
                            if vision_facts:
                                logging.info(
                                    f"AI Vision extracted {len(vision_facts)} facts from scanned PDF {document_name}"
                                )
                                return vision_facts
                        except Exception as vision_err:
                            logging.warning(
                                f"AI Vision extraction failed for {document_name}: {vision_err}"
                            )
                            if facts:
                                return facts
                            if not content:
                                raise DocumentEmptyError("No readable text found in this document") from vision_err
                            raise

                    # If digital text extraction yields empty text and vision was unavailable or yielded no facts (Finding 5)
                    if not content:
                        raise DocumentEmptyError("No readable text found in this document")

                    # Try AI Text Extraction if client is configured and text is substantial
                    if content and len(content) > 50:
                        try:
                            gemini = get_gemini_service()
                            if gemini.api_key or is_openrouter_configured():
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
                        logging.info(
                            f"Extracted {len(facts)} facts from digital text in {document_name}"
                        )
                        return facts

                    content = content[:MAX_EXTRACTED_CHARS]
                else:
                    # 3. Text and structured plain documents (.txt)
                    content = safe_path.read_text(encoding="utf-8", errors="ignore")[
                        :MAX_EXTRACTED_CHARS
                    ]
                    if not content.strip():
                        raise DocumentEmptyError("No readable text found in this document")
            else:
                logging.warning("No file path or raw text provided to DocumentService")
                raise ValueError("Either file_path or raw_text must be provided")

            facts = self._parse_text_into_facts(content)
            if content and len(content) > 50:
                try:
                    gemini = get_gemini_service()
                    if gemini.api_key or is_openrouter_configured():
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
                    logging.warning(
                        f"Gemini Text extraction fallback to local: {ai_err}"
                    )

            logging.info(f"Extracted {len(facts)} facts from {document_name}")
            return facts
        except (DocumentAccessError, FileNotFoundError, ValueError, HTTPException):
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
                    raw_k = (
                        line[:-1].strip().lower().replace(" ", "_").replace("/", "_")
                    )
                    clean_k = re.sub(r"[^a-z0-9_?']", "", raw_k)
                    canonical_k = KEY_ALIASES.get(clean_k, clean_k)
                    if canonical_k == "address" and "@" in next_line:
                        canonical_k = "email"
                    if (
                        len(canonical_k) > 1
                        and next_line
                        and canonical_k not in seen_keys
                    ):
                        label = CANONICAL_LABELS.get(
                            canonical_k, line[:-1].strip().title()
                        )
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
                    if (
                        len(canonical_k) > 1
                        and canonical_k not in seen_keys
                        and len(canonical_k) < 40
                    ):
                        label = CANONICAL_LABELS.get(
                            canonical_k, parts[0].strip().title()
                        )
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
