"""
CRUD persistence layer for FormPilot sessions, audit records, and field mappings.

Interacts with the configured database collection without leaking connection details
to controllers.
"""

from datetime import datetime
from typing import Any, Dict, List, Optional

import pytz
from commons.logger import logger
from core.database.database import get_db
from core.models.session_model import AgentEvent, FieldMapping  # noqa: F401

logging = logger(__name__)

SESSIONS_COLLECTION = "sessions"

# Cap on retained audit events per session so a runaway loop cannot grow a record
# without bound while still preserving a useful execution history.
MAX_PERSISTED_EVENTS = 2000


_in_memory_sessions: Dict[str, Dict[str, Any]] = {}


class CRUDSession:
    """Database & in-memory access layer for session records and execution logs."""

    def __init__(self) -> None:
        """
        Initialize collection references.
        """
        logging.info("Executing CRUDSession.__init__")
        try:
            self.db = get_db()
        except Exception:
            self.db = None

    async def create(self, *, obj_in: Dict[str, Any]) -> Dict[str, Any]:
        """
        Create a new workflow session record.
        """
        try:
            logging.info("Executing CRUDSession.create")
            data = dict(obj_in)
            now = datetime.now(pytz.utc).isoformat()
            data.setdefault("created_at", now)
            data.setdefault("updated_at", now)
            data.setdefault("events", [])
            data.setdefault("verifications", [])

            if self.db is not None:
                try:
                    collection = self.db[SESSIONS_COLLECTION]
                    await collection.insert_one(dict(data))
                    logging.info(f"Session created successfully in MongoDB with ID: {data.get('id')}")
                    return data
                except Exception as db_err:
                    logging.warning(f"MongoDB write failed, using in-memory store: {db_err}")

            _in_memory_sessions[data["id"]] = data
            logging.info(f"Session created successfully in-memory with ID: {data.get('id')}")
            return data
        except Exception as error:
            logging.error(f"Error in CRUDSession.create function: {error}")
            raise

    async def get_by_id(self, *, session_id: str) -> Optional[Dict[str, Any]]:
        """
        Retrieve a session document by its unique ID.
        """
        try:
            logging.info("Executing CRUDSession.get_by_id")
            if self.db is not None:
                try:
                    collection = self.db[SESSIONS_COLLECTION]
                    doc = await collection.find_one({"id": session_id})
                    if doc:
                        return doc
                except Exception as db_err:
                    logging.warning(f"MongoDB read failed: {db_err}")

            return _in_memory_sessions.get(session_id)
        except Exception as error:
            logging.error(f"Error in CRUDSession.get_by_id function: {error}")
            raise

    async def update(
        self, *, session_id: str, obj_in: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        """
        Update fields in an existing session record.
        """
        try:
            logging.info("Executing CRUDSession.update")
            data = dict(obj_in)
            data["updated_at"] = datetime.now(pytz.utc).isoformat()

            if self.db is not None:
                try:
                    collection = self.db[SESSIONS_COLLECTION]
                    await collection.update_one({"id": session_id}, {"$set": data})
                    return await self.get_by_id(session_id=session_id)
                except Exception as db_err:
                    logging.warning(f"MongoDB update failed: {db_err}")

            session = _in_memory_sessions.get(session_id, {})
            session.update(data)
            _in_memory_sessions[session_id] = session
            return session
        except Exception as error:
            logging.error(f"Error in CRUDSession.update function: {error}")
            raise

    async def append_event(self, *, session_id: str, event: Dict[str, Any]) -> None:
        """
        Append a single audit event to a session event log.
        """
        try:
            logging.info("Executing CRUDSession.append_event")
            if self.db is not None:
                try:
                    collection = self.db[SESSIONS_COLLECTION]
                    await collection.update_one(
                        {"id": session_id},
                        {
                            "$push": {
                                "events": {
                                    "$each": [event],
                                    "$slice": -MAX_PERSISTED_EVENTS,
                                }
                            },
                            "$set": {"updated_at": datetime.now(pytz.utc).isoformat()},
                        },
                    )
                    return
                except Exception as db_err:
                    logging.warning(f"MongoDB append_event failed: {db_err}")

            session = _in_memory_sessions.get(session_id)
            if session:
                events = session.setdefault("events", [])
                events.append(event)
                if len(events) > MAX_PERSISTED_EVENTS:
                    session["events"] = events[-MAX_PERSISTED_EVENTS:]
                session["updated_at"] = datetime.now(pytz.utc).isoformat()
        except Exception as error:
            logging.error(f"Error in CRUDSession.append_event function: {error}")
            raise

    async def append_events(
        self, *, session_id: str, events: List[Dict[str, Any]]
    ) -> int:
        """
        Append multiple audit events to a session event log in one atomic operation.
        """
        try:
            logging.info(
                f"Executing CRUDSession.append_events with {len(events)} events"
            )
            if not events:
                return 0

            if self.db is not None:
                try:
                    collection = self.db[SESSIONS_COLLECTION]
                    await collection.update_one(
                        {"id": session_id},
                        {
                            "$push": {
                                "events": {
                                    "$each": events,
                                    "$slice": -MAX_PERSISTED_EVENTS,
                                }
                            },
                            "$set": {"updated_at": datetime.now(pytz.utc).isoformat()},
                        },
                    )
                    return len(events)
                except Exception as db_err:
                    logging.warning(f"MongoDB append_events failed: {db_err}")

            session = _in_memory_sessions.get(session_id)
            if session:
                existing = session.setdefault("events", [])
                existing.extend(events)
                if len(existing) > MAX_PERSISTED_EVENTS:
                    session["events"] = existing[-MAX_PERSISTED_EVENTS:]
                session["updated_at"] = datetime.now(pytz.utc).isoformat()

            return len(events)
        except Exception as error:
            logging.error(f"Error in CRUDSession.append_events function: {error}")
            raise

    async def append_verifications(
        self,
        *,
        session_id: str,
        verifications: List[Dict[str, Any]],
    ) -> int:
        """
        Persist verification records produced by the verification phase.
        """
        try:
            logging.info(
                f"Executing CRUDSession.append_verifications with {len(verifications)} records"
            )
            if not verifications:
                return 0

            if self.db is not None:
                try:
                    collection = self.db[SESSIONS_COLLECTION]
                    await collection.update_one(
                        {"id": session_id},
                        {
                            "$push": {"verifications": {"$each": verifications}},
                            "$set": {"updated_at": datetime.now(pytz.utc).isoformat()},
                        },
                    )
                    return len(verifications)
                except Exception as db_err:
                    logging.warning(f"MongoDB append_verifications failed: {db_err}")

            session = _in_memory_sessions.get(session_id)
            if session:
                existing = session.setdefault("verifications", [])
                existing.extend(verifications)
                session["updated_at"] = datetime.now(pytz.utc).isoformat()

            return len(verifications)
        except Exception as error:
            logging.error(
                f"Error in CRUDSession.append_verifications function: {error}"
            )
            raise

    async def count_events(self, *, session_id: str) -> int:
        """
        Count persisted audit events for a session.
        """
        try:
            logging.info("Executing CRUDSession.count_events")
            session = await self.get_by_id(session_id=session_id)
            if not session:
                return 0
            return len(session.get("events", []))
        except Exception as error:
            logging.error(f"Error in CRUDSession.count_events function: {error}")
            raise
