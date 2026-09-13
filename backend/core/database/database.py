"""
Database connection and lifecycle manager for AutoFiller backend.

Provides async MongoDB client access backed by a running MongoDB instance, including
index creation for session lookups.
"""

import os
from typing import Optional

from commons.logger import logger

logging = logger(__name__)

# Global database client and instance
_mongo_client = None
_db_instance = None

# Timeout for the initial server selection handshake.
MONGO_SELECTION_TIMEOUT_MS = 5000


async def init_database() -> None:
    """
    Initialize the database client connection on application startup.

    Connects to the configured MongoDB URI if available. If MongoDB is absent,
    gracefully logs a warning and enables in-memory session persistence.
    """
    global _mongo_client, _db_instance
    logging.info("Executing database.init_database")
    mongo_uri = os.getenv("MONGO_URI", "mongodb://localhost:27017")
    db_name = os.getenv("MONGO_DB_NAME", "autofiller_db")

    try:
        from motor.motor_asyncio import AsyncIOMotorClient

        client = AsyncIOMotorClient(mongo_uri, serverSelectionTimeoutMS=MONGO_SELECTION_TIMEOUT_MS)
        await client.admin.command("ping")
        _mongo_client = client
        _db_instance = client[db_name]
        await _ensure_indexes(_db_instance)
        logging.info(f"Connected successfully to MongoDB database '{db_name}'")
    except Exception as error:
        logging.warning(f"MongoDB not connected ({error}). Operating in self-contained in-memory mode.")
        _mongo_client = None
        _db_instance = None


async def _ensure_indexes(db_instance) -> None:
    """
    Create the indexes required by session lookups.
    """
    try:
        logging.info("Executing database._ensure_indexes")
        await db_instance["sessions"].create_index("id", unique=True, name="idx_session_id")
        await db_instance["sessions"].create_index("updated_at", name="idx_session_updated_at")
        logging.info("Session indexes verified")
    except Exception as error:
        logging.error(f"Error in database._ensure_indexes: {error}")
        raise


async def close_database() -> None:
    """
    Close the active database client connection on application shutdown.
    """
    global _mongo_client, _db_instance
    logging.info("Executing database.close_database")
    if _mongo_client:
        _mongo_client.close()
        _mongo_client = None
        _db_instance = None
        logging.info("Closed MongoDB client connection")


def get_db():
    """
    Retrieve the active database instance, or None if in in-memory mode.
    """
    return _db_instance
