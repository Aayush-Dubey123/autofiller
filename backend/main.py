"""
Runtime entrypoint for AutoFiller backend server.

Loads environment variables, exports ASGI application, and starts Uvicorn server when executed directly.
"""

import multiprocessing
import os
import sys
import uvicorn
from dotenv import load_dotenv
from commons.logger import logger
from core.apis.api import app
# Load environment configuration
load_dotenv()
logging = logger("autofiller.main")


def start():
    """
    Start the Uvicorn ASGI server.

    Launches the FastAPI application on the configured host and port, adapting for
    standalone PyInstaller frozen execution or local development with reloading.

    Args:
        None

    Returns:
        None

    Raises:
        Exception: If Uvicorn server encounters an unrecoverable startup failure.
    """
    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "8000"))
    is_frozen = getattr(sys, "frozen", False)

    logging.info(
        f"Starting AutoFiller backend service on http://{host}:{port} "
        f"(frozen={is_frozen})"
    )

    if is_frozen:
        # In frozen PyInstaller binary, string module imports fail; pass ASGI app object directly.
        uvicorn.run(app, host=host, port=port, reload=False, log_level="info")
    else:
        reload = os.getenv("ENV", "development").lower() == "development"
        uvicorn.run("main:app", host=host, port=port, reload=reload)


if __name__ == "__main__":
    # Required for Windows multiprocessing when bundled with PyInstaller.
    multiprocessing.freeze_support()
    start()
