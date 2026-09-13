"""
FastAPI application aggregator module for AutoFiller backend.

Configures application lifespan, database lifecycle, CORS, and router registration.
"""

import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv

# Ensure environment variables from .env are loaded before importing modules that read them.
env_file = os.path.join(os.path.dirname(__file__), "../../.env")
if os.path.exists(env_file):
    load_dotenv(env_file)
else:
    load_dotenv()

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from commons.auth import validate_startup_security
from commons.logger import logger
from core.apis.routes.session_router import session_router
from core.apis.routes.settings_router import settings_router
from core.database.database import close_database, init_database

logging = logger(__name__)

# Origins permitted to call the local API. The desktop shell loads the renderer from
# file:// or the packaged app origin, and development uses the Vite dev server.
# A wildcard is intentionally NOT used because it would let any web page the operator
# has open reach the privileged local API.
DEFAULT_ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "app://autofiller",
    "app://formpilot",
]


def _allowed_origins() -> list[str]:
    """
    Resolve the CORS allow-list from configuration.

    Args:
        None

    Returns:
        list[str]: Explicit permitted origins.
    """
    configured = os.getenv("AUTOFILLER_ALLOWED_ORIGINS", "").strip() or os.getenv("FORMPILOT_ALLOWED_ORIGINS", "").strip()
    if not configured:
        return list(DEFAULT_ALLOWED_ORIGINS)
    return [origin.strip() for origin in configured.split(",") if origin.strip()]


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Manage application startup and shutdown lifecycle.

    Validates security configuration, connects the database pool on startup, and
    cleanly shuts down connections on exit.

    Args:
        app (FastAPI): The active application instance.

    Yields:
        None: Yields control while the application is serving requests.
    """
    logging.info("Executing application startup lifespan")
    validate_startup_security()
    await init_database()
    yield
    logging.info("Executing application shutdown lifespan")
    await close_database()


def create_app() -> FastAPI:
    """
    Create and configure the central FastAPI application.

    Registers middleware, lifespan hooks, exception handlers, and API routes.

    Args:
        None

    Returns:
        FastAPI: Fully configured ASGI application.
    """
    logging.info("Executing api.create_app")
    app = FastAPI(
        title="AutoFiller AI Backend",
        description="AI-assisted document-to-web-form automation engine backend",
        version="1.0.0",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=_allowed_origins(),
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["Authorization", "Content-Type"],
    )

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception):
        """
        Convert unexpected exceptions into a consistent 500 without leaking internals.

        Args:
            request (Request): Incoming request that triggered the failure.
            exc (Exception): Unhandled exception instance.

        Returns:
            JSONResponse: Generic internal error payload.
        """
        logging.error(
            f"Unhandled exception on {request.method} {request.url.path}: {exc}"
        )
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"detail": "Internal Server Error"},
        )

    app.include_router(session_router, tags=["Sessions & Form Automation"])
    app.include_router(settings_router, tags=["Settings & Credentials"])

    @app.get("/health", tags=["Health"])
    async def health_check():
        """
        Application health check endpoint.

        Returns the service operational status without requiring authentication so the
        desktop shell can poll readiness during startup.

        Args:
            None

        Returns:
            dict: Service health status payload.
        """
        return {"status": "HEALTHY", "service": "autofiller-backend"}

    @app.get("/mock_school_form.html", include_in_schema=False)
    async def get_mock_school_form():
        """
        Serve the bundled mock school admission form.

        Allows the browser automation engine and desktop operator to access the demo form
        directly over HTTP without requiring an active frontend dev server.

        Args:
            None

        Returns:
            FileResponse: HTML content of the mock school form.
        """
        from pathlib import Path
        from fastapi.responses import FileResponse, Response

        repo_root = Path(__file__).resolve().parents[3]
        candidate_paths = [
            repo_root / "test-fixtures" / "mock_school_form.html",
            repo_root / "desktop" / "public" / "mock_school_form.html",
            repo_root / "desktop" / "dist" / "mock_school_form.html",
        ]
        for form_path in candidate_paths:
            if form_path.is_file():
                return FileResponse(str(form_path), media_type="text/html")
        return Response(content="Mock school form not found", status_code=404)

    return app


app = create_app()
