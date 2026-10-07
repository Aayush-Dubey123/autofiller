"""
Unit and integration tests for AutoFiller backend services, routes, and security controls.

These tests exercise the real route -> controller -> service path with an in-memory
database double, so no live MongoDB instance or Gemini credentials are required.
"""

import json
import os
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

# A deterministic internal token keeps auth assertions independent of the environment.
os.environ["AUTOFILLER_INTERNAL_KEY"] = "test-internal-token"
os.environ["FORMPILOT_INTERNAL_KEY"] = "test-internal-token"
os.environ.setdefault("GEMINI_API_KEY", "test-gemini-key")
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

            async def delete_one(self, query):
                """Remove a session by id."""
                sid = query.get("id")
                if sid in store:
                    del store[sid]

            async def delete_many(self, query):
                """Clear all sessions."""
                store.clear()

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

    # Paths under home directory outside allowed upload roots must be rejected
    env_path = str(Path(__file__).resolve().parents[2] / "backend" / ".env")
    with pytest.raises(DocumentAccessError):
        service._resolve_safe_path(env_path)

    documents_path = str(Path.home() / "Documents" / "confidential.pdf")
    with pytest.raises(DocumentAccessError):
        service._resolve_safe_path(documents_path)


@pytest.mark.asyncio
async def test_extract_document_endpoint_rejects_home_dir_and_env_with_403(
    app_with_fake_db,
):
    """Assert /v1/documents/extract returns HTTP 403 for backend/.env and files under home directory."""
    transport = ASGITransport(app=app_with_fake_db)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        env_path = str(Path(__file__).resolve().parents[2] / "backend" / ".env")
        response = await client.post(
            "/v1/documents/extract",
            headers=AUTH_HEADERS,
            json={"file_path": env_path},
        )
        assert response.status_code == 403
        assert "outside the permitted directories" in response.json()["detail"]

        home_file = str(Path.home() / "Desktop" / "student_notes.pdf")
        home_res = await client.post(
            "/v1/documents/extract",
            headers=AUTH_HEADERS,
            json={"file_path": home_file},
        )
        assert home_res.status_code == 403
        assert "outside the permitted directories" in home_res.json()["detail"]


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
async def test_settings_routes_are_removed(app_with_fake_db):
    """Verify the credential/settings endpoints no longer exist."""
    transport = ASGITransport(app=app_with_fake_db)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        for method, path in (
            ("GET", "/v1/settings"),
            ("POST", "/v1/settings/update"),
            ("POST", "/v1/settings/test-gemini"),
        ):
            response = await client.request(method, path, headers=AUTH_HEADERS)
            assert response.status_code in (404, 405), (
                method,
                path,
                response.status_code,
            )


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
async def test_health_reports_gemini_configured_as_boolean_only(app_with_fake_db):
    """Verify /health exposes a boolean for key presence and never the key itself."""
    transport = ASGITransport(app=app_with_fake_db)
    for key, expected in ("secret-test-key-123", True), ("", False):
        with patch.dict(os.environ, {"GEMINI_API_KEY": key}):
            async with AsyncClient(
                transport=transport, base_url="http://test"
            ) as client:
                payload = (await client.get("/health")).json()
        assert payload["gemini_configured"] is expected
        assert "secret-test-key-123" not in json.dumps(payload)


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

    with patch.dict(os.environ, {"GEMINI_API_KEY": ""}):
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
    facts = await service.extract_facts(
        raw_text=multiline_text, document_name="admission.txt"
    )
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
        assert "Mock School Admission Form" in response.text


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
    monkeypatch.setattr(service, "_generate_openrouter_async", fake_fail)

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
async def test_openrouter_fallback_when_gemini_fails(monkeypatch):
    """Assert GeminiService falls back to OpenRouter when Gemini provider fails."""
    from core.services.gemini_service import GeminiService

    service = GeminiService()
    monkeypatch.setattr(service, "client", object())

    # Simulate Gemini failing with a timeout or error
    async def fake_gemini_fail(*args, **kwargs):
        raise RuntimeError("Gemini 503 Service Unavailable")

    monkeypatch.setattr(service, "_generate_async", fake_gemini_fail)

    # Mock OpenRouter returning structured JSON
    async def fake_openrouter(*args, **kwargs):
        return json.dumps(
            {
                "facts": [
                    {
                        "key": "student_name",
                        "label": "Student Name",
                        "value": "Priya Nair",
                        "confidence": 0.95,
                    }
                ]
            }
        )

    monkeypatch.setattr(service, "_generate_openrouter_async", fake_openrouter)
    monkeypatch.setattr("core.services.gemini_service.is_openrouter_configured", lambda: True)

    facts = await service.extract_facts_from_text(
        text="Student: Priya Nair",
        document_name="test_record.txt",
    )

    assert len(facts) == 1
    assert facts[0].key == "student_name"
    assert facts[0].value == "Priya Nair"


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
        persisted = [
            item
            for item in fetched.json()["events"]
            if item["type"] == "POLICY_BLOCKED"
        ]
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


@pytest.mark.asyncio
async def test_delete_session_and_purge_all_endpoints(app_with_fake_db):
    """Verify DELETE /v1/sessions/{id} and DELETE /v1/sessions purge sessions."""
    transport = ASGITransport(app=app_with_fake_db)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        created = await client.post(
            "/v1/sessions",
            headers=AUTH_HEADERS,
            json={"document_name": "doc.pdf", "target_url": "https://example.com/form"},
        )
        session_id = created.json()["id"]

        del_res = await client.delete(
            f"/v1/sessions/{session_id}", headers=AUTH_HEADERS
        )
        assert del_res.status_code == 200
        assert del_res.json() == {"success": True}

        get_res = await client.get(f"/v1/sessions/{session_id}", headers=AUTH_HEADERS)
        assert get_res.status_code == 404

        # Test purge all
        await client.post(
            "/v1/sessions",
            headers=AUTH_HEADERS,
            json={"document_name": "doc.pdf", "target_url": "https://example.com/form"},
        )
        purge_res = await client.delete("/v1/sessions", headers=AUTH_HEADERS)
        assert purge_res.status_code == 200
        assert purge_res.json() == {"success": True}


@pytest.mark.asyncio
async def test_verifications_persist_safe_metadata_only_without_values(app_with_fake_db):
    """
    Verify verification persistence enforces the zero-value contract.

    Persists only safe metadata (field_ref, field_label, verified),
    dropping any raw expected_value or actual_value.
    """
    transport = ASGITransport(app=app_with_fake_db)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        created = await client.post(
            "/v1/sessions",
            headers=AUTH_HEADERS,
            json={"document_name": "student.pdf", "target_url": "https://example.com/form"},
        )
        assert created.status_code == 201
        session_id = created.json()["id"]

        # Append verifications: one standard safe payload and one with legacy/extra values
        verifications_payload = [
            {
                "field_ref": "field_name",
                "field_label": "Student Name",
                "verified": True,
                # Even if raw values are sent, backend must not persist them
                "expected_value": "Aarav Sharma",
                "actual_value": "Aarav Sharma",
            },
            {
                "field_ref": "field_email",
                "field_label": "Email Address",
                "verified": False,
            },
        ]

        appended = await client.post(
            f"/v1/sessions/{session_id}/events",
            headers=AUTH_HEADERS,
            json={"events": [], "verifications": verifications_payload},
        )
        assert appended.status_code == 200, appended.text
        assert appended.json()["success"] is True

        # Fetch session record and verify persisted shape
        fetched = await client.get(f"/v1/sessions/{session_id}", headers=AUTH_HEADERS)
        assert fetched.status_code == 200
        persisted = fetched.json().get("verifications", [])
        assert len(persisted) == 2

        # 1. First record verified
        v1 = persisted[0]
        assert v1["field_ref"] == "field_name"
        assert v1["field_label"] == "Student Name"
        assert v1["verified"] is True
        assert "expected_value" not in v1, f"expected_value must not be persisted: {v1}"
        assert "actual_value" not in v1, f"actual_value must not be persisted: {v1}"

        # 2. Second record unverified
        v2 = persisted[1]
        assert v2["field_ref"] == "field_email"
        assert v2["field_label"] == "Email Address"
        assert v2["verified"] is False
        assert "expected_value" not in v2
        assert "actual_value" not in v2


@pytest.mark.asyncio
async def test_finding_4_cors_preflight_for_delete_session(app_with_fake_db):
    """Finding 4: Verify OPTIONS preflight for DELETE /v1/sessions/{id} returns success."""
    transport = ASGITransport(app=app_with_fake_db)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.options(
            "/v1/sessions/test-session-id",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "DELETE",
                "Access-Control-Request-Headers": "Authorization, Content-Type",
            },
        )
        assert response.status_code == 200
        allowed_methods = response.headers.get("access-control-allow-methods", "")
        assert "DELETE" in allowed_methods


@pytest.mark.asyncio
async def test_finding_5_empty_and_scanned_pdf_error_handling(app_with_fake_db, tmp_path, monkeypatch):
    """Finding 5: Verify blank and scanned PDFs return HTTP 422 when digital text is empty and Gemini Vision is unavailable or fails."""
    import pymupdf
    from core.services.gemini_service import GeminiService

    transport = ASGITransport(app=app_with_fake_db)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Case 1: Blank PDF (1 page with no digital text) when Gemini vision is unavailable (missing API key)
        blank_doc = pymupdf.open()
        blank_doc.new_page()
        blank_pdf_path = str(tmp_path / "blank_doc.pdf")
        blank_doc.save(blank_pdf_path)
        blank_doc.close()

        unconfigured_service = GeminiService()
        unconfigured_service.api_key = ""
        unconfigured_service.client = None
        monkeypatch.setattr("core.services.document_service.get_gemini_service", lambda: unconfigured_service)

        response = await client.post(
            "/v1/documents/extract",
            headers=AUTH_HEADERS,
            json={"file_path": blank_pdf_path},
        )
        assert response.status_code == 422
        assert "No readable text found in this document" in response.json()["detail"]

        # Case 2: Scanned PDF (no digital text) when Gemini Vision fails
        scanned_doc = pymupdf.open()
        scanned_doc.new_page()
        scanned_pdf_path = str(tmp_path / "scanned_doc.pdf")
        scanned_doc.save(scanned_pdf_path)
        scanned_doc.close()

        async def fake_vision_failure(*args, **kwargs):
            raise RuntimeError("Gemini Vision API quota exceeded or network failed")

        failing_service = GeminiService()
        failing_service.api_key = "test-key"
        failing_service.client = MagicMock()
        failing_service.extract_facts_from_image = fake_vision_failure
        monkeypatch.setattr("core.services.document_service.get_gemini_service", lambda: failing_service)

        scanned_response = await client.post(
            "/v1/documents/extract",
            headers=AUTH_HEADERS,
            json={"file_path": scanned_pdf_path},
        )
        assert scanned_response.status_code == 422
        assert "No readable text found in this document" in scanned_response.json()["detail"]


@pytest.mark.asyncio
async def test_finding_7_whitelist_extensions_rejects_exe_and_bin_with_415(app_with_fake_db, tmp_path):
    """Finding 7: Whitelist extensions (.pdf, .png, .jpg, .jpeg, .webp, .txt); reject .exe and .bin with 415."""
    transport = ASGITransport(app=app_with_fake_db)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        exe_file = tmp_path / "payload.exe"
        exe_file.write_bytes(b"MZ\x90\x00\x03\x00\x00\x00")

        exe_res = await client.post(
            "/v1/documents/extract",
            headers=AUTH_HEADERS,
            json={"file_path": str(exe_file)},
        )
        assert exe_res.status_code == 415
        assert "Unsupported document file extension '.exe'" in exe_res.json()["detail"]

        bin_file = tmp_path / "firmware.bin"
        bin_file.write_bytes(b"\xde\xad\xbe\xef\x00\x01\x02\x03")

        bin_res = await client.post(
            "/v1/documents/extract",
            headers=AUTH_HEADERS,
            json={"file_path": str(bin_file)},
        )
        assert bin_res.status_code == 415
        assert "Unsupported document file extension '.bin'" in bin_res.json()["detail"]


@pytest.mark.asyncio
async def test_finding_8_key_aliases_common_demographics():
    """Finding 8: KEY_ALIASES maps sex->gender, town->city, province->state to canonical keys."""
    service = DocumentService()
    sample_text = (
        "Sex: Female\n"
        "Town: Springfield\n"
        "Province: Ontario\n"
    )
    facts = await service.extract_facts(raw_text=sample_text, document_name="demographics.txt")
    facts_map = {f.key: f for f in facts}

    assert "gender" in facts_map
    assert facts_map["gender"].value == "Female"
    assert facts_map["gender"].label == "Gender"

    assert "city" in facts_map
    assert facts_map["city"].value == "Springfield"
    assert facts_map["city"].label == "City"

    assert "state" in facts_map
    assert facts_map["state"].value == "Ontario"
    assert facts_map["state"].label == "State"


@pytest.mark.asyncio
async def test_fast_ai_failover_gemini_to_gemini_fallback(monkeypatch):
    """Verify Gemini primary failure immediately triggers Gemini fallback without long timeout."""
    from core.services.gemini_service import GeminiService

    service = GeminiService()
    monkeypatch.setattr(service, "client", object())

    attempted_models = []

    async def fake_generate_async(model, contents, config=None, timeout=None):
        attempted_models.append(model)
        if len(attempted_models) == 1:
            raise RuntimeError("503 Service Unavailable: Gemini Primary overloaded")
        return json.dumps(
            {
                "facts": [
                    {
                        "key": "student_name",
                        "label": "Student Name",
                        "value": "Ananya Iyer",
                        "confidence": 0.98,
                    }
                ]
            }
        )

    monkeypatch.setattr(service, "_generate_async", fake_generate_async)
    monkeypatch.setattr(
        "core.services.gemini_service.get_gemini_models",
        lambda: ["gemini-3.5-flash", "gemini-3.5-flash-lite"],
    )

    facts = await service.extract_facts_from_text(
        text="Student Full Name: Ananya Iyer",
        document_name="admission.txt",
    )

    assert len(attempted_models) == 2
    assert attempted_models[0] == "gemini-3.5-flash"
    assert attempted_models[1] == "gemini-3.5-flash-lite"
    assert len(facts) == 1
    assert facts[0].value == "Ananya Iyer"


@pytest.mark.asyncio
async def test_fast_ai_failover_gemini_to_openrouter(monkeypatch):
    """Verify all Gemini failures immediately fail over to OpenRouter."""
    from core.services.gemini_service import GeminiService

    service = GeminiService()
    monkeypatch.setattr(service, "client", object())

    async def fake_gemini_fail(model, contents, config=None, timeout=None):
        raise RuntimeError("429 RESOURCE_EXHAUSTED Quota exceeded")

    monkeypatch.setattr(service, "_generate_async", fake_gemini_fail)
    monkeypatch.setattr("core.services.gemini_service.is_openrouter_configured", lambda: True)

    async def fake_openrouter(messages, temperature=0.1, timeout=None):
        return json.dumps(
            {
                "facts": [
                    {
                        "key": "student_name",
                        "label": "Student Name",
                        "value": "Rohan Mehta",
                        "confidence": 0.95,
                    }
                ]
            }
        )

    monkeypatch.setattr(service, "_generate_openrouter_async", fake_openrouter)

    facts = await service.extract_facts_from_text(
        text="Student Full Name: Rohan Mehta",
        document_name="admission.txt",
    )

    assert len(facts) == 1
    assert facts[0].key == "student_name"
    assert facts[0].value == "Rohan Mehta"


def test_ai_provider_configuration_and_timeouts(monkeypatch):
    """Verify models and timeouts are configurable via environment variables."""
    from core.services.gemini_service import (
        get_ai_timeout_seconds,
        get_gemini_models,
        get_openrouter_models,
    )

    monkeypatch.setenv("AI_REQUEST_TIMEOUT_SECONDS", "2.5")
    assert get_ai_timeout_seconds() == 2.5

    monkeypatch.setenv("GEMINI_MODEL", "custom-gemini-pro")
    monkeypatch.setenv("GEMINI_FALLBACK_MODELS", "custom-fallback-1,custom-fallback-2")
    gemini_models = get_gemini_models()
    assert gemini_models == ["custom-gemini-pro", "custom-fallback-1", "custom-fallback-2"]

    monkeypatch.setenv("OPENROUTER_MODEL", "custom-router-model")
    monkeypatch.setenv("OPENROUTER_FALLBACK_MODELS", "router-fb-1,router-fb-2")
    router_models = get_openrouter_models()
    assert router_models == ["custom-router-model", "router-fb-1", "router-fb-2"]


def test_ai_mapping_timeout_configuration(monkeypatch):
    """Verify mapping timeout is configurable via AI_MAPPING_TIMEOUT_SECONDS."""
    from core.services.gemini_service import get_ai_mapping_timeout_seconds

    monkeypatch.setenv("AI_MAPPING_TIMEOUT_SECONDS", "12.5")
    assert get_ai_mapping_timeout_seconds() == 12.5

    monkeypatch.setenv("AI_MAPPING_TIMEOUT_SECONDS", "not-a-number")
    assert get_ai_mapping_timeout_seconds() == 8.0


def test_model_health_registry_and_catalog_filtering():
    """Verify dead models cool down and unlisted models are filtered."""
    from core.services.gemini_service import (
        filter_candidates,
        mark_model_unavailable,
        reset_model_health,
    )

    reset_model_health()
    candidates = ["model-a", "model-b", "model-c"]

    # Catalog filtering drops unlisted models
    catalog = {"model-a", "model-b"}
    filtered = filter_candidates("gemini", candidates, catalog)
    assert filtered == ["model-a", "model-b"]

    # Marking model-a dead cools it down
    mark_model_unavailable("gemini", "model-a", "404 model not found")
    filtered2 = filter_candidates("gemini", candidates, catalog)
    assert filtered2 == ["model-b"]

    # If all candidates would be filtered, returns fallback candidates rather than empty
    mark_model_unavailable("gemini", "model-b", "503 overloaded")
    filtered_all = filter_candidates("gemini", candidates, catalog)
    assert filtered_all == ["model-a", "model-b", "model-c"]

    reset_model_health()


@pytest.mark.asyncio
async def test_dead_gemini_model_skipped_fast_on_subsequent_request(monkeypatch):
    """Verify that after a model fails once, the next request skips it immediately."""
    from core.services.gemini_service import GeminiService, reset_model_health

    reset_model_health()
    service = GeminiService()
    monkeypatch.setattr(service, "client", object())

    called_models = []

    async def fake_generate_async(model, contents, config=None, timeout=None):
        called_models.append(model)
        if model == "gemini-3.5-flash":
            raise RuntimeError("503 Service Unavailable")
        return json.dumps({"facts": [{"key": "student_name", "value": "Aarav", "confidence": 0.9}]})

    monkeypatch.setattr(service, "_generate_async", fake_generate_async)
    monkeypatch.setattr(
        "core.services.gemini_service.get_gemini_models",
        lambda: ["gemini-3.5-flash", "gemini-3.5-flash-lite"],
    )
    async def fake_catalog():
        return None

    monkeypatch.setattr(service, "_gemini_catalog", fake_catalog)

    # First request: tries primary, fails, tries fallback -> success
    facts1 = await service.extract_facts_from_text(text="Name: Aarav", document_name="doc.txt")
    assert len(facts1) == 1
    assert called_models == ["gemini-3.5-flash", "gemini-3.5-flash-lite"]

    # Second request: primary is cooling down, should skip directly to fallback!
    called_models.clear()
    facts2 = await service.extract_facts_from_text(text="Name: Aarav", document_name="doc.txt")
    assert len(facts2) == 1
    assert called_models == ["gemini-3.5-flash-lite"]

    reset_model_health()


@pytest.mark.asyncio
async def test_gemini_service_supplements_partial_ai_mapping_with_heuristic(monkeypatch):
    """Verify that when AI mapping returns partial mappings, unmapped fields are completed by heuristic fallback."""
    from core.models.session_model import FormFieldSnapshot, FormSnapshot
    from core.services.gemini_service import GeminiService

    service = GeminiService()
    monkeypatch.setattr(service, "client", object())

    snapshot = FormSnapshot(
        url="https://example.com/form",
        title="School Form",
        fields=[
            FormFieldSnapshot(ref="field_001", name="student_name", label="Student Full Name", type="text", required=True, disabled=False, visible=True),
            FormFieldSnapshot(ref="field_002", name="dob", label="Date of Birth", type="text", required=True, disabled=False, visible=True),
            FormFieldSnapshot(ref="field_003", name="email", label="Email Address", type="text", required=True, disabled=False, visible=True),
        ],
    )
    facts = [
        ExtractedFact(key="student_name", label="Student Full Name", value="Ananya Iyer", confidence=0.98),
        ExtractedFact(key="dob", label="Date of Birth", value="15/08/2010", confidence=0.95),
        ExtractedFact(key="email", label="Email Address", value="ananya@example.com", confidence=0.95),
    ]

    # AI mapping returns ONLY field_001 (partial mapping)
    partial_ai_json = json.dumps(
        {
            "mappings": [
                {
                    "field_ref": "field_001",
                    "field_label": "Student Full Name",
                    "fact_key": "student_name",
                    "fact_value": "Ananya Iyer",
                    "confidence": 0.99,
                    "is_ambiguous": False,
                }
            ]
        }
    )

    async def fake_failover(contents, config=None, log_context="", timeout=None):
        return partial_ai_json, False, None

    monkeypatch.setattr(service, "_generate_with_failover", fake_failover)

    mappings, clars, unmapped = await service.map_form_fields(form_snapshot=snapshot, facts=facts)

    # All 3 fields must be mapped (field_001 by AI, field_002 and field_003 supplemented by heuristic)
    mapped_refs = {m.field_ref for m in mappings}
    assert "field_001" in mapped_refs
    assert "field_002" in mapped_refs
    assert "field_003" in mapped_refs
    assert len(unmapped) == 0



