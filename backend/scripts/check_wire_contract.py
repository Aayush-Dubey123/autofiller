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
    SessionEventAppendRequest,
)

EVENT = {
    "eventId": "evt_1",
    "timestamp": "2026-01-01T00:00:00.000Z",
    "type": "POLICY_BLOCKED",
    "description": "blocked",
    "success": False,
    "metadata": {},
}


def check(label: str, builder) -> None:
    """Report whether a payload shape validates."""
    try:
        builder()
        print(f"{label:34} -> OK")
    except ValidationError as error:
        reasons = [err["msg"] for err in error.errors()]
        print(f"{label:34} -> REJECTED {reasons}")


def main() -> None:
    """Exercise each event and clarification payload shape."""
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
    check("clarification: empty string", lambda: clarification("snake", ""))
    check("clarification: null", lambda: clarification("snake", None))


if __name__ == "__main__":
    main()
