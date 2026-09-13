"""
Runtime entrypoint for AutoFiller backend server.

Loads environment variables, exports ASGI application, and starts Uvicorn server when executed directly.
"""

import os
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

    Reads host and port from environment variables and starts server process.
    """
    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "8000"))
    reload = os.getenv("ENV", "development").lower() == "development"

    logging.info(f"Starting AutoFiller backend service on http://{host}:{port}")
    uvicorn.run("main:app", host=host, port=port, reload=reload)


if __name__ == "__main__":
    start()
