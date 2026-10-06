"""Live verification that the patched backend refuses the previously exploitable requests."""

import json
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

BACKEND_DIR = os.path.join(os.path.dirname(__file__), "backend")
PYTHON = sys.executable
TOKEN = "live-verification-token"
PORT = 8123
BASE = f"http://127.0.0.1:{PORT}"


def wait_for_port(deadline_seconds: int = 30) -> bool:
    """Poll the backend health endpoint until it responds or the deadline passes."""
    deadline = time.time() + deadline_seconds
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f"{BASE}/health", timeout=1) as response:
                if response.status == 200:
                    return True
        except Exception:
            time.sleep(0.3)
    return False


def call(path: str, method: str = "GET", body=None, headers=None):
    """Issue an HTTP request and return (status, payload)."""
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(f"{BASE}{path}", data=data, method=method)
    request.add_header("Content-Type", "application/json")
    for key, value in (headers or {}).items():
        request.add_header(key, value)
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return response.status, json.loads(response.read() or b"{}")
    except urllib.error.HTTPError as error:
        raw = error.read()
        try:
            payload = json.loads(raw or b"{}")
        except json.JSONDecodeError:
            payload = {"raw": raw.decode(errors="replace")}
        return error.code, payload


def main() -> int:
    """Start the backend, probe the security boundaries, and report results."""
    env = dict(os.environ)
    env["AUTOFILLER_INTERNAL_KEY"] = TOKEN
    env["FORMPILOT_INTERNAL_KEY"] = TOKEN
    env.setdefault("GEMINI_API_KEY", "live-verification-key")
    env.pop("AUTOFILLER_ALLOW_ANONYMOUS", None)
    env.pop("FORMPILOT_ALLOW_ANONYMOUS", None)

    process = subprocess.Popen(
        [
            PYTHON,
            "-m",
            "uvicorn",
            "core.apis.api:app",
            "--app-dir",
            "backend",
            "--host",
            "127.0.0.1",
            "--port",
            str(PORT),
        ],
        cwd=os.path.dirname(__file__),
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    results = []
    try:
        if not wait_for_port():
            print("FAIL: backend did not start")
            return 1

        auth = {"Authorization": f"Bearer {TOKEN}"}

        status, _ = call("/v1/documents/extract", "POST", {"raw_text": "x"}, None)
        results.append(
            ("POST /v1/documents/extract without token is refused", status == 401, status)
        )

        status, _ = call(
            "/v1/sessions",
            "POST",
            {"document_name": "d.pdf", "target_url": "https://x.test"},
            None,
        )
        results.append(
            ("POST /v1/sessions without token is refused", status == 401, status)
        )

        status, _ = call(
            "/v1/sessions/session_x", "GET", None, {"Authorization": "Bearer wrong"}
        )
        results.append(
            ("GET /v1/sessions/{id} with wrong token is refused", status == 401, status)
        )

        status, _ = call("/v1/sessions/session_x", "GET", None, auth)
        results.append(
            ("valid token passes auth (unknown session is 404)", status == 404, status)
        )

        for removed in ("/v1/settings", "/v1/settings/update", "/v1/settings/test-gemini"):
            status, _ = call(removed, "GET", None, auth)
            results.append(
                (f"removed route {removed} is gone", status in (404, 405), status)
            )

        status, payload = call(
            "/v1/documents/extract",
            "POST",
            {"file_path": "C:/Windows/System32/drivers/etc/hosts"},
            auth,
        )
        results.append(
            ("absolute path outside allowed roots is refused", status == 403, status)
        )

        status, payload = call(
            "/v1/documents/extract", "POST", {"file_path": "../../backend/.env"}, auth
        )
        results.append(("relative traversal to .env is refused", status == 403, status))

        status, payload = call("/health")
        results.append(
            ("GET /health stays public for startup polling", status == 200, status)
        )
        results.append(
            (
                "/health exposes only a boolean for the Gemini key",
                isinstance(payload.get("gemini_configured"), bool)
                and set(payload) <= {"status", "service", "gemini_configured"},
                sorted(payload),
            )
        )

    finally:
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()

    print("\nLive security verification")
    print("=" * 68)
    ok = True
    for label, passed, detail in results:
        marker = "PASS" if passed else "FAIL"
        if not passed:
            ok = False
        print(f"[{marker}] {label}  (status={detail})")
    print("=" * 68)
    print(
        "All security checks passed." if ok else "One or more security checks FAILED."
    )
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
