"""
Build script to freeze the AutoFiller FastAPI backend into a standalone Windows binary.

Uses PyInstaller to bundle all runtime dependencies (FastAPI, Uvicorn, PyMuPDF, Google GenAI)
into a self-contained executable placed in desktop/build-resources/backend/autofiller-backend.exe.
"""

import os
import shutil
import subprocess
import sys
from pathlib import Path


def build_standalone_backend() -> Path:
    """
    Execute PyInstaller to compile the backend service into a standalone executable.

    Collects all required dynamic libraries, C-extensions, and data packages into a single
    Windows binary suitable for distribution via Electron Builder extraResources.

    Args:
        None

    Returns:
        Path: Absolute path to the generated autofiller-backend.exe executable.

    Raises:
        RuntimeError: If PyInstaller execution fails or the output binary is missing.
    """
    repo_root = Path(__file__).resolve().parent.parent.parent
    backend_dir = repo_root / "backend"
    entrypoint = backend_dir / "main.py"
    output_dir = repo_root / "desktop" / "build-resources" / "backend"
    work_dir = backend_dir / "build_pyinstaller"
    spec_dir = backend_dir / "build_pyinstaller"

    output_dir.mkdir(parents=True, exist_ok=True)
    work_dir.mkdir(parents=True, exist_ok=True)

    print(f"[Build] Target entrypoint: {entrypoint}")
    hidden_imports = [
        "uvicorn.logging",
        "uvicorn.loops",
        "uvicorn.loops.auto",
        "uvicorn.protocols",
        "uvicorn.protocols.http",
        "uvicorn.protocols.http.auto",
        "uvicorn.protocols.http.h11_impl",
        "uvicorn.protocols.http.httptools_impl",
        "uvicorn.protocols.websockets",
        "uvicorn.protocols.websockets.auto",
        "uvicorn.lifespan.on",
        "uvicorn.lifespan.off",
        "pymupdf",
        "fitz",
        "google.genai",
        "google.auth",
        "motor",
        "motor.motor_asyncio",
        "pymongo",
        "multipart",
        "python_multipart",
    ]

    collect_all_packages = [
        "pymupdf",
    ]

    cmd = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--name=autofiller-backend",
        "--onefile",
        "--clean",
        "--noconfirm",
        f"--distpath={output_dir}",
        f"--workpath={work_dir}",
        f"--specpath={spec_dir}",
        f"--paths={backend_dir}",
    ]

    for hi in hidden_imports:
        cmd.extend(["--hidden-import", hi])

    for pkg in collect_all_packages:
        cmd.extend(["--collect-all", pkg])

    mock_form = repo_root / "desktop" / "public" / "mock_school_form.html"
    if mock_form.exists():
        cmd.extend(["--add-data", f"{mock_form};."])
    cmd.extend([
        "--exclude-module", "pytest",
        "--exclude-module", "pytest_asyncio",
        "--exclude-module", "tkinter",
    ])

    cmd.append(str(entrypoint))

    print(f"[Build] Executing command: {' '.join(cmd)}")
    result = subprocess.run(cmd, cwd=str(backend_dir))

    if result.returncode != 0:
        raise RuntimeError(f"PyInstaller failed with exit code {result.returncode}")

    target_exe = output_dir / "autofiller-backend.exe"
    if not target_exe.exists():
        raise RuntimeError(f"Expected binary {target_exe} was not produced by PyInstaller")

    file_size_mb = target_exe.stat().st_size / (1024 * 1024)
    print(f"[Build] Successfully built standalone backend: {target_exe} ({file_size_mb:.1f} MB)")

    # Clean up temporary build artifacts directory to keep working tree clean
    if work_dir.exists():
        try:
            shutil.rmtree(work_dir)
            print("[Build] Cleaned up temporary PyInstaller build directory")
        except Exception as err:
            print(f"[Build] Warning: could not delete temporary build dir: {err}")

    return target_exe


if __name__ == "__main__":
    build_standalone_backend()
