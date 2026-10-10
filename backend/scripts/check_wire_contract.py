"""
Wire-contract smoke check for the desktop <-> backend boundary.

Prints the accepted/rejected outcome for the payload shapes the Electron shell
actually sends, so a contract drift is visible without running the full app.
"""

import os
import sys
from pathlib import Path

# Allow direct execution from the repository root or the backend directory.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("AUTOFILLER_INTERNAL_KEY", "contract-check")
os.environ.setdefault("FORMPILOT_INTERNAL_KEY", "contract-check")

from pydantic import ValidationError  # noqa: E402

from core.apis.schemas.requests.session_request import (  # noqa: E402
    ClarificationAnswerRequest,
    FormMapRequest,
    SessionEventAppendRequest,
)
from core.apis.schemas.responses.session_response import FormMapResponse  # noqa: E402
from core.models.session_model import FactDescriptor, FieldMapping, FormSnapshot, FormFieldSnapshot  # noqa: E402

EVENT = {
    "eventId": "evt_1",
    "timestamp": "2026-01-01T00:00:00.000Z",
    "type": "POLICY_BLOCKED",
    "description": "blocked",
    "success": False,
    "metadata": {},
}

FAILED_CHECKS = 0


def check(label: str, builder, expect_pass: bool = True) -> None:
    """Report whether a payload shape validates and track failures."""
    global FAILED_CHECKS
    try:
        builder()
        if expect_pass:
            print(f"{label:38} -> OK")
        else:
            print(f"{label:38} -> UNEXPECTED PASS (expected rejection)")
            FAILED_CHECKS += 1
    except ValidationError as error:
        if expect_pass:
            reasons = [err["msg"] for err in error.errors()]
            print(f"{label:38} -> REJECTED {reasons}")
            FAILED_CHECKS += 1
        else:
            print(f"{label:38} -> REJECTED (expected)")
    except Exception as error:
        print(f"{label:38} -> ERROR {error}")
        FAILED_CHECKS += 1


def main() -> None:
    """Exercise each event, clarification, and zero-value mapping shape."""
    global FAILED_CHECKS
    check(
        "event: camelCase (desktop sends)",
        lambda: SessionEventAppendRequest(events=[EVENT], verifications=[]),
    )
    check(
        "event: snake_case",
        lambda: SessionEventAppendRequest(
            events=[{**EVENT, "event_id": EVENT["eventId"]}], verifications=[]
        ),
    )
    check(
        "verifications: safe metadata",
        lambda: SessionEventAppendRequest(
            events=[],
            verifications=[{"field_ref": "f1", "field_label": "Name", "verified": True}],
        ),
    )

    def clarification(out_key: str, value):
        ids = (
            {"session_id": "s", "clarification_id": "c"}
            if out_key == "snake"
            else {"sessionId": "s", "clarificationId": "c"}
        )
        key = "selected_value" if out_key == "snake" else "selectedValue"
        return ClarificationAnswerRequest(**{**ids, key: value})

    check("clarification: plain string", lambda: clarification("snake", "Yes"))
    check("clarification: camelCase keys", lambda: clarification("camel", "Yes"))
    check(
        "clarification: tool result object",
        lambda: clarification("snake", {"fieldRef": "f1", "selectedValue": "Grade 10"}),
    )
    check("clarification: empty string", lambda: clarification("snake", ""), expect_pass=False)
    check("clarification: null", lambda: clarification("snake", None), expect_pass=False)

    # Zero-value mapping wire contract checks
    def test_form_map_descriptors():
        snapshot = FormSnapshot(
            url="http://test.local",
            title="Test",
            fields=[FormFieldSnapshot(ref="f1", label="Student Name", type="text")],
        )
        fact_desc = FactDescriptor(key="student_name", label="Student Name", type="text", confidence=0.95)
        req = FormMapRequest(session_id="s1", form_snapshot=snapshot, facts=[fact_desc])
        assert "value" not in req.facts[0].model_dump(), "FactDescriptor model_dump leaked 'value'"

    def test_form_map_strips_values():
        # Even if a raw payload attempts to inject 'value', FactDescriptor drops it
        desc = FactDescriptor(**{"key": "student_name", "label": "Student Name", "value": "LEAKED_VAL"})
        assert "value" not in desc.model_dump(), "FactDescriptor retained 'value'"

    def test_form_map_response_zero_value():
        mapping = FieldMapping(
            field_ref="f1",
            field_label="Student Name",
            fact_key="student_name",
            confidence=0.95,
        )
        resp = FormMapResponse(session_id="s1", mappings=[mapping], clarifications_required=[], unmapped_fields=[])
        assert resp.mappings[0].fact_value is None, "FormMapResponse mapping fact_value is not None"

    check("map: zero-value fact descriptors", test_form_map_descriptors)
    check("map: strips injected values", test_form_map_strips_values)
    check("map_response: zero-value mappings", test_form_map_response_zero_value)

    check_health_contract()

    if FAILED_CHECKS > 0:
        print(f"\nWire contract check failed with {FAILED_CHECKS} error(s).")
        sys.exit(1)
    else:
        print("\nAll wire contract checks passed successfully.")


def check_health_contract() -> None:
    """Verify /health returns the shape the desktop shell reads (no secrets)."""
    global FAILED_CHECKS
    from fastapi.testclient import TestClient

    from core.apis.api import create_app

    payload = TestClient(create_app()).get("/health").json()
    ok = payload.get("status") == "HEALTHY" and isinstance(
        payload.get("gemini_configured"), bool
    )
    if ok:
        print(f"{'health: status + gemini_configured':38} -> OK")
    else:
        print(f"{'health: status + gemini_configured':38} -> REJECTED")
        FAILED_CHECKS += 1


if __name__ == "__main__":
    main()
