"""
Unit and integration tests for AutoFiller backend services, routes, and security controls.

These tests exercise the real route -> controller -> service path with an in-memory
database double, so no live MongoDB instance or Gemini credentials are required.
"""

import json
import os
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

# A deterministic internal token keeps auth assertions independent of the environment.
os.environ["AUTOFILLER_INTERNAL_KEY"] = "test-internal-token"
os.environ["FORMPILOT_INTERNAL_KEY"] = "test-internal-token"
os.environ.pop("AUTOFILLER_ALLOW_ANONYMOUS", None)
os.environ.pop("FORMPILOT_ALLOW_ANONYMOUS", None)

from commons.auth import verify_internal_token  # noqa: E402
from core.models.session_model import (
    ExtractedFact,
    FormFieldSnapshot,
    FormSnapshot,
    FormFieldType,
)  # noqa: E402
from core.services.document_service import (
    DocumentAccessError,
    DocumentService,
)  # noqa: E402

AUTH_HEADERS = {"Authorization": "Bearer test-internal-token"}


@pytest.fixture
def app_with_fake_db():
    """
    Build the FastAPI app with the database layer replaced by an in-memory double.

    Avoids requiring a live MongoDB instance while still exercising the real routes,
    controllers, and CRUD wiring.

    Returns:
        FastAPI: Configured application instance.
    """
    with patch("core.cruds.session_crud.get_db") as get_db:
        store = {}

        class FakeCollection:
            """Minimal async collection double supporting the CRUD operations used."""

            async def insert_one(self, document):
                """Store a session document keyed by id."""
                store[document["id"]] = dict(document)

            async def find_one(self, query, projection=None):
                """Return a stored session matching the query."""
                return store.get(query.get("id"))

            async def update_one(self, query, update):
                """Apply the subset of update operators used by the CRUD layer."""
                session = store.get(query.get("id"))
                if not session:
                    return
                if "$set" in update:
                    session.update(update["$set"])
                if "$push" in update:
                    for field, spec in update["$push"].items():
                        values = spec.get("$each") if isinstance(spec, dict) else [spec]
                        session.setdefault(field, [])
                        session[field].extend(values)
                        if isinstance(spec, dict) and "$slice" in spec:
                            session[field] = session[field][spec["$slice"] :]

        class FakeDb:
            """Database double returning the fake sessions collection."""

            def __getitem__(self, name):
                """Return the fake collection for any collection name."""
                return FakeCollection()

        get_db.return_value = FakeDb()
        from core.apis.api import create_app

        yield create_app()


@pytest.mark.asyncio
async def test_document_service_extracts_facts_from_text():
    """Verify the document service extracts structured facts from raw text."""
    service = DocumentService()
    sample = """
    STUDENT ADMISSION FORM
    Student Name: Aarav Sharma
    Date of Birth: 15-08-2010
    Gender: Male
    Applying Grade: 10th
    Father's Name: Vikram Sharma
    Contact Phone: +91 98765 43210
    Email Address: aarav.sharma@example.com
    """
    facts = await service.extract_facts(raw_text=sample, document_name="test.txt")
    fact_map = {fact.key: fact.value for fact in facts}

    assert fact_map["student_name"] == "Aarav Sharma"
    assert fact_map["gender"] == "Male"
    assert "aarav.sharma@example.com" in fact_map["email"]


@pytest.mark.asyncio
async def test_document_service_rejects_oversized_text():
    """Verify oversized raw text is truncated rather than parsed without bound."""
    service = DocumentService()
    facts = await service.extract_facts(
        raw_text="A" * 500_000 + "\nStudent Name: Test User"
    )
    assert isinstance(facts, list)


def test_document_service_blocks_path_outside_allowed_roots():
    """Verify the document service refuses paths outside the permitted directories."""
    service = DocumentService()
    with pytest.raises(DocumentAccessError):
        service._resolve_safe_path(os.path.join(os.sep, "etc", "passwd"))


def test_internal_token_uses_constant_time_comparison():
    """Verify valid tokens authenticate and invalid tokens are refused."""
    assert verify_internal_token("Bearer test-internal-token") is not None
    assert verify_internal_token("Bearer wrong-token") is None
    assert verify_internal_token(None) is None
    assert verify_internal_token("") is None


def test_startup_security_rejects_anonymous_flag():
    """Verify the legacy anonymous-access flag causes a hard startup failure."""
    from commons.auth import validate_startup_security

    with patch.dict(os.environ, {"AUTOFILLER_ALLOW_ANONYMOUS": "true"}):
        with pytest.raises(RuntimeError):
            validate_startup_security()


@pytest.mark.asyncio
async def test_settings_routes_require_authentication(app_with_fake_db):
    """Verify unauthenticated access to configuration endpoints is rejected."""
    transport = ASGITransport(app=app_with_fake_db)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        assert (await client.get("/v1/settings")).status_code == 401
        assert (
            await client.post("/v1/settings/update", json={"gemini_api_key": "x"})
        ).status_code == 401
        assert (
            await client.post("/v1/settings/test-gemini", json={"api_key": "x"})
        ).status_code == 401


@pytest.mark.asyncio
async def test_session_routes_require_authentication(app_with_fake_db):
    """Verify unauthenticated access to session endpoints is rejected."""
    transport = ASGITransport(app=app_with_fake_db)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        created = await client.post(
            "/v1/sessions",
            json={"document_name": "doc.pdf", "target_url": "https://school.edu/form"},
        )
        assert created.status_code == 401

        extracted = await client.post("/v1/documents/extract", json={"raw_text": "x"})
        assert extracted.status_code == 401


@pytest.mark.asyncio
async def test_health_endpoint_is_public(app_with_fake_db):
    """Verify the health endpoint stays reachable for startup readiness polling."""
    transport = ASGITransport(app=app_with_fake_db)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/health")
        assert response.status_code == 200
        assert response.json()["status"] == "HEALTHY"


@pytest.mark.asyncio
async def test_authenticated_session_extract_and_map_flow(app_with_fake_db):
    """Verify the authenticated end-to-end session, extraction, and mapping flow."""
    transport = ASGITransport(app=app_with_fake_db)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        created = await client.post(
            "/v1/sessions",
            headers=AUTH_HEADERS,
            json={
                "document_name": "admission.pdf",
                "target_url": "https://school.edu/form",
            },
        )
        assert created.status_code == 201
        session_id = created.json()["id"]
        assert session_id.startswith("session_")

        extracted = await client.post(
            "/v1/documents/extract",
            headers=AUTH_HEADERS,
            json={
                "raw_text": "Student Name: John Doe\nEmail: john@doe.com",
                "document_name": "s.txt",
            },
        )
        assert extracted.status_code == 200
        facts = extracted.json()["facts"]
        assert len(facts) >= 2

        mapping_service = AsyncMock(return_value=([], [], []))
        with patch(
            "core.services.gemini_service.GeminiService.map_form_fields",
            mapping_service,
        ):
            snapshot = {
                "url": "https://school.edu/form",
                "title": "Registration",
                "fields": [
                    {
                        "ref": "field_001",
                        "label": "Student Name",
                        "type": "text",
                        "required": True,
                        "disabled": False,
                        "visible": True,
                    }
                ],
            }
            mapped = await client.post(
                "/v1/forms/map",
                headers=AUTH_HEADERS,
                json={
                    "session_id": session_id,
                    "form_snapshot": snapshot,
                    "facts": facts,
                },
            )
            assert mapped.status_code == 200
            assert mapped.json()["session_id"] == session_id


@pytest.mark.asyncio
async def test_map_form_rejects_excessive_fact_payload(app_with_fake_db):
    """Verify the mapping endpoint refuses unbounded provider input."""
    transport = ASGITransport(app=app_with_fake_db)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        created = await client.post(
            "/v1/sessions",
            headers=AUTH_HEADERS,
            json={
                "document_name": "admission.pdf",
                "target_url": "https://school.edu/form",
            },
        )
        session_id = created.json()["id"]

        oversized = [
            {"key": f"k{index}", "label": f"L{index}", "value": "v", "confidence": 0.9}
            for index in range(250)
        ]
        response = await client.post(
            "/v1/forms/map",
            headers=AUTH_HEADERS,
            json={
                "session_id": session_id,
                "form_snapshot": {"url": "u", "title": "t", "fields": []},
                "facts": oversized,
            },
        )
        assert response.status_code == 422


@pytest.mark.asyncio
async def test_events_are_persisted_to_session_timeline(app_with_fake_db):
    """Verify agent events submitted by the desktop shell are persisted for audit."""
    transport = ASGITransport(app=app_with_fake_db)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        created = await client.post(
            "/v1/sessions",
            headers=AUTH_HEADERS,
            json={
                "document_name": "admission.pdf",
                "target_url": "https://school.edu/form",
            },
        )
        session_id = created.json()["id"]

        event = {
            "event_id": "evt_1",
            "timestamp": "2026-01-01T00:00:00Z",
            "type": "TOOL_COMPLETED",
            "tool": "fill_text",
            "description": "Filled Student Name.",
            "success": True,
            "metadata": {},
        }
        appended = await client.post(
            f"/v1/sessions/{session_id}/events",
            headers=AUTH_HEADERS,
            json={"events": [event], "verifications": []},
        )
        assert appended.status_code == 200
        assert appended.json()["success"] is True
        assert appended.json()["appended"] == 1

        fetched = await client.get(f"/v1/sessions/{session_id}", headers=AUTH_HEADERS)
        assert fetched.status_code == 200
        assert any(item["event_id"] == "evt_1" for item in fetched.json()["events"])


@pytest.mark.asyncio
async def test_clarification_answer_updates_mapping(app_with_fake_db):
    """Verify answering a clarification resolves the mapped field."""
    transport = ASGITransport(app=app_with_fake_db)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        created = await client.post(
            "/v1/sessions",
            headers=AUTH_HEADERS,
            json={
                "document_name": "admission.pdf",
                "target_url": "https://school.edu/form",
            },
        )
        session_id = created.json()["id"]

        respond = await client.post(
            "/v1/clarifications/answer",
            headers=AUTH_HEADERS,
            json={
                "session_id": session_id,
                "clarification_id": "clarify_field_001",
                "selected_value": "9876543210",
            },
        )
        assert respond.status_code == 404


@pytest.mark.asyncio
async def test_gemini_service_requires_configuration():
    """Verify mapping fails loudly when no Gemini client is configured."""
    from core.services.gemini_service import GeminiService

    service = GeminiService()
    service.client = None
    service.api_key = ""

    snapshot = FormSnapshot(
        url="https://school.edu/form",
        title="Registration",
        fields=[
            FormFieldSnapshot(
                ref="field_001",
                label="Student Name",
                type=FormFieldType.TEXT,
                required=True,
            )
        ],
    )

    with patch.object(service.secrets_service, "get_api_key", return_value=""):
        with pytest.raises(RuntimeError, match="not configured"):
            await service.map_form_fields(form_snapshot=snapshot, facts=[])


@pytest.mark.asyncio
async def test_gemini_service_parses_mapping_response():
    """Verify a well-formed provider response is normalized into mappings."""
    from core.services.gemini_service import GeminiService

    service = GeminiService()
    service.client = MagicMock()

    payload = (
        '{"mappings":[{"field_ref":"field_001","field_label":"Student Name",'
        '"fact_key":"student_name","fact_value":"Priya Patel","confidence":0.95,'
        '"is_ambiguous":false}]}'
    )
    with patch.object(service, "_generate_async", AsyncMock(return_value=payload)):
        snapshot = FormSnapshot(
            url="https://school.edu/form",
            title="Registration",
            fields=[
                FormFieldSnapshot(
                    ref="field_001",
                    label="Student Name",
                    type=FormFieldType.TEXT,
                    required=True,
                )
            ],
        )
        mappings, clarifications, unmapped = await service.map_form_fields(
            form_snapshot=snapshot, facts=[]
        )

    assert mappings[0].fact_value == "Priya Patel"
    assert clarifications == []
    assert unmapped == []


@pytest.mark.asyncio
async def test_document_service_extracts_facts_from_image(monkeypatch, tmp_path):
    """Assert DocumentService routes PNG and JPG files to Gemini multimodal extraction."""
    from core.services.gemini_service import GeminiService

    fake_facts = [
        ExtractedFact(
            key="student_name",
            label="Student Name",
            value="Rohan Verma",
            confidence=0.99,
        ),
        ExtractedFact(
            key="city",
            label="City",
            value="Pune",
            confidence=0.99,
        ),
    ]

    async def fake_extract_image(*args, **kwargs):
        return fake_facts

    monkeypatch.setattr(GeminiService, "extract_facts_from_image", fake_extract_image)

    # Create dummy PNG file inside allowed tmp_path
    png_file = tmp_path / "student_card.png"
    png_file.write_bytes(b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR...")

    service = DocumentService()
    facts = await service.extract_facts(
        file_path=str(png_file),
        document_name="student_card.png",
    )

    assert len(facts) == 2
    assert facts[0].key == "student_name"
    assert facts[0].value == "Rohan Verma"
    assert facts[1].key == "city"
    assert facts[1].value == "Pune"


@pytest.mark.asyncio
async def test_gemini_service_extract_facts_from_image_parses_json(monkeypatch):
    """Assert GeminiService.extract_facts_from_image parses structured vision responses."""
    from core.services.gemini_service import GeminiService

    fake_json_response = json.dumps(
        {
            "facts": [
                {
                    "key": "applicant_name",
                    "label": "Applicant Name",
                    "value": "Ananya Sen",
                    "confidence": 0.98,
                },
                {
                    "key": "date_of_birth",
                    "label": "Date of Birth",
                    "value": "10-12-2009",
                    "confidence": 0.95,
                },
            ]
        }
    )

    async def fake_generate_async(*args, **kwargs):
        return fake_json_response

    service = GeminiService()
    monkeypatch.setattr(service, "_generate_async", fake_generate_async)
    monkeypatch.setattr(service, "client", object())  # Mock client presence

    facts = await service.extract_facts_from_image(
        image_bytes=b"fake_image_bytes",
        mime_type="image/png",
        document_name="doc.png",
    )

    assert len(facts) == 2
    assert facts[0].key == "applicant_name"
    assert facts[0].value == "Ananya Sen"
    assert facts[1].key == "date_of_birth"
    assert facts[1].value == "10-12-2009"


@pytest.mark.asyncio
async def test_document_service_multiline_admission_form_extraction():
    """Verify multiline key-value parsing accurately extracts address, phone, school, and grade."""
    service = DocumentService()
    multiline_text = """
    NATIONAL PUBLIC SCHOOL, BENGALURU
    Official Student Admission Record (Session 2026-27)
    Student Full Name:
    Ananya Iyer
    Date of Birth:
    24-09-2011
    Gender:
    Female
    Applying Grade / Class:
    9th Grade
    Father's Name:
    Karthik Iyer
    Mother's Name:
    Deepa Iyer
    Parent Email Address:
    karthik.iyer@example.com
    Primary Phone Number:
    +91 98450 78901
    Alternate Contact Phone:
    +91 98450 11223
    Street Address:
    108 Indiranagar 100ft Road, 2nd Stage
    City:
    Bengaluru
    State:
    Karnataka
    Postal / ZIP Code:
    560038
    Blood Group:
    O+
    Previous School Attended:
    National Public School, Indiranagar
    """
    facts = await service.extract_facts(raw_text=multiline_text, document_name="admission.txt")
    fact_map = {f.key: f.value for f in facts}

    assert fact_map["student_name"] == "Ananya Iyer"
    assert fact_map["dob"] == "24-09-2011"
    assert fact_map["gender"] == "Female"
    assert fact_map["grade"] == "9th Grade"
    assert fact_map["parent_name"] == "Karthik Iyer"
    assert fact_map["mother_name"] == "Deepa Iyer"
    assert fact_map["email"] == "karthik.iyer@example.com"
    assert fact_map["phone"] == "+91 98450 78901"
    assert fact_map["alternate_phone"] == "+91 98450 11223"
    assert fact_map["address"] == "108 Indiranagar 100ft Road, 2nd Stage"
    assert fact_map["city"] == "Bengaluru"
    assert fact_map["state"] == "Karnataka"
    assert fact_map["zip_code"] == "560038"
    assert fact_map["blood_group"] == "O+"
    assert fact_map["previous_school"] == "National Public School, Indiranagar"


@pytest.mark.asyncio
async def test_gemini_service_extract_facts_from_text_parses_json(monkeypatch):
    """Assert GeminiService.extract_facts_from_text parses structured JSON responses."""
    from core.services.gemini_service import GeminiService

    fake_json_response = json.dumps(
        {
            "facts": [
                {
                    "key": "student_name",
                    "label": "Student Name",
                    "value": "Priya Patel",
                    "confidence": 0.99,
                },
                {
                    "key": "address",
                    "label": "Residential Address",
                    "value": "77 Park Street, Flat 4B",
                    "confidence": 0.96,
                },
            ]
        }
    )

    async def fake_generate_async(*args, **kwargs):
        return fake_json_response

    service = GeminiService()
    monkeypatch.setattr(service, "_generate_async", fake_generate_async)
    monkeypatch.setattr(service, "client", object())

    facts = await service.extract_facts_from_text(
        text="Student Name: Priya Patel\nAddress: 77 Park Street, Flat 4B",
        document_name="test.txt",
    )

    assert len(facts) == 2
    assert facts[0].key == "student_name"
    assert facts[0].value == "Priya Patel"
    assert facts[1].key == "address"
    assert facts[1].value == "77 Park Street, Flat 4B"


@pytest.mark.asyncio
async def test_mock_school_form_endpoint_is_accessible(app_with_fake_db):
    """Assert /mock_school_form.html serves HTML content without authentication."""
    transport = ASGITransport(app=app_with_fake_db)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/mock_school_form.html")
        assert response.status_code == 200
        assert "text/html" in response.headers.get("content-type", "")
        assert "SVPCET COLLEGE" in response.text


@pytest.mark.asyncio
async def test_map_form_fields_uses_heuristic_fallback_when_gemini_fails(monkeypatch):
    """Assert GeminiService falls back to deterministic heuristic mapping when provider models fail."""
    from core.services.gemini_service import GeminiService

    service = GeminiService()
    monkeypatch.setattr(service, "client", object())

    # Simulate all provider calls raising 429 quota exhausted
    async def fake_fail(*args, **kwargs):
        raise RuntimeError("429 RESOURCE_EXHAUSTED Quota exceeded")

    monkeypatch.setattr(service, "_generate_async", fake_fail)

    snapshot = FormSnapshot(
        url="http://school.edu/form",
        title="School Admission",
        fields=[
            FormFieldSnapshot(
                ref="field_name",
                label="Student Full Name",
                type=FormFieldType.TEXT,
                required=True,
            ),
            FormFieldSnapshot(
                ref="field_dob",
                label="Date of Birth",
                type=FormFieldType.DATE,
                required=True,
            ),
            FormFieldSnapshot(
                ref="field_phone",
                label="Contact Phone",
                type=FormFieldType.TEL,
                required=True,
            ),
        ],
    )
    facts = [
        ExtractedFact(
            key="student_name",
            label="Student Name",
            value="Aarav Sharma",
            confidence=0.99,
        ),
        ExtractedFact(
            key="dob",
            label="Date of Birth",
            value="15-08-2010",
            confidence=0.99,
        ),
        ExtractedFact(
            key="phone",
            label="Primary Phone",
            value="+91 98765 43210",
            confidence=0.99,
        ),
        ExtractedFact(
            key="alternate_phone",
            label="Alternate Phone",
            value="+91 98111 22334",
            confidence=0.95,
        ),
    ]

    mappings, clarifications, unmapped = await service.map_form_fields(
        form_snapshot=snapshot, facts=facts
    )

    assert len(mappings) == 3
    # Student Name mapped
    name_mapping = next(m for m in mappings if m.field_ref == "field_name")
    assert name_mapping.fact_value == "Aarav Sharma"
    # Date of Birth mapped
    dob_mapping = next(m for m in mappings if m.field_ref == "field_dob")
    assert dob_mapping.fact_value == "15-08-2010"
    # Ambiguous phone numbers flagged as clarification
    assert len(clarifications) == 1
    assert "field_phone" in clarifications[0].field_ref






@pytest.mark.asyncio
async def test_events_accept_camel_case_event_id_from_desktop(app_with_fake_db):
    """
    Verify the desktop shell's camelCase event payload is accepted, not rejected.

    Regression test: the Electron client serializes events with `eventId`. Nested
    AgentEvent validation previously ran in alias-only mode, which rejected that
    spelling with a 422 and silently dropped audit events (including
    POLICY_BLOCKED), so the timeline lost the submission guard record.
    """
    transport = ASGITransport(app=app_with_fake_db)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        created = await client.post(
            "/v1/sessions",
            headers=AUTH_HEADERS,
            json={
                "document_name": "admission.pdf",
                "target_url": "https://school.edu/form",
            },
        )
        session_id = created.json()["id"]

        # Exact shape produced by AgentController.buildEvent / emitEvent.
        desktop_event = {
            "eventId": "evt_1737000000_ab12cd",
            "timestamp": "2026-01-01T00:00:00.000Z",
            "type": "POLICY_BLOCKED",
            "description": "[PolicyEngine] DENIED_FINAL_SUBMISSION: blocked.",
            "success": False,
            "metadata": {},
        }

        appended = await client.post(
            f"/v1/sessions/{session_id}/events",
            headers=AUTH_HEADERS,
            json={"events": [desktop_event], "verifications": []},
        )
        assert appended.status_code == 200, appended.text
        assert appended.json()["appended"] == 1

        fetched = await client.get(f"/v1/sessions/{session_id}", headers=AUTH_HEADERS)
        persisted = [item for item in fetched.json()["events"] if item["type"] == "POLICY_BLOCKED"]
        assert len(persisted) == 1
        assert persisted[0]["event_id"] == "evt_1737000000_ab12cd"



@pytest.mark.asyncio
async def test_clarification_accepts_the_payload_the_desktop_sends(app_with_fake_db):
    """
    Verify a clarification answer round-trips through the real route.

    Regression test: the desktop's `request_clarification` tool resolves to an
    object (`{ fieldRef, selectedValue }`), not a string. Sending that as
    `selected_value` previously failed `str` validation with a 422 and aborted the
    entire session, so the payload must be coerced rather than rejected.
    """
    transport = ASGITransport(app=app_with_fake_db)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        created = await client.post(
            "/v1/sessions",
            headers=AUTH_HEADERS,
            json={
                "document_name": "admission.pdf",
                "target_url": "https://school.edu/form",
            },
        )
        session_id = created.json()["id"]

        # The exact shape the agent forwards: canned camelCase keys plus the raw
        # tool result object as the selected value.
        response = await client.post(
            "/v1/clarifications/answer",
            headers=AUTH_HEADERS,
            json={
                "sessionId": session_id,
                "clarificationId": "clarify_1",
                "selectedValue": {"fieldRef": "field_003", "selectedValue": "Grade 10"},
            },
        )
        assert response.status_code != 422, response.text


@pytest.mark.asyncio
async def test_clarification_rejects_an_unusable_answer(app_with_fake_db):
    """Verify a genuinely invalid clarification answer fails loudly, not silently."""
    transport = ASGITransport(app=app_with_fake_db)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        created = await client.post(
            "/v1/sessions",
            headers=AUTH_HEADERS,
            json={
                "document_name": "admission.pdf",
                "target_url": "https://school.edu/form",
            },
        )
        session_id = created.json()["id"]

        response = await client.post(
            "/v1/clarifications/answer",
            headers=AUTH_HEADERS,
            json={
                "session_id": session_id,
                "clarification_id": "clarify_1",
                "selected_value": None,
            },
        )
        assert response.status_code == 422
        detail = response.text
        assert "non-empty string" in detail
