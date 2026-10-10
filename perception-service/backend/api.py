"""Local incident store for the perception service (optional).

Run with:  uvicorn backend.api:app --host 127.0.0.1 --port 8000

Every endpoint except /health requires the header  X-API-Key: <INCIDENT_API_KEY>.
If INCIDENT_API_KEY is unset the API refuses all protected requests, so it can
never be exposed unauthenticated by accident. Bind it to 127.0.0.1 regardless.
"""

from __future__ import annotations

import hmac
import json
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import Body, Depends, FastAPI, Header, HTTPException

app = FastAPI(title="Industrial Safety Incident API")

DB_PATH = Path(__file__).resolve().parent / "incidents.json"

# Requests are served on a thread pool; serialise read-modify-write cycles.
_lock = threading.Lock()


def require_api_key(x_api_key: str | None = Header(default=None)) -> None:
    expected = os.getenv("INCIDENT_API_KEY", "")
    if not expected:
        raise HTTPException(status_code=503, detail="INCIDENT_API_KEY is not configured")
    if x_api_key is None or not hmac.compare_digest(x_api_key, expected):
        raise HTTPException(status_code=401, detail="Invalid or missing API key")


def load_data() -> dict[str, Any]:
    if not DB_PATH.exists():
        return {}
    return json.loads(DB_PATH.read_text(encoding="utf-8"))


def save_data(data: dict[str, Any]) -> None:
    # Write-then-rename so a crash mid-write never leaves a truncated file
    temporary = DB_PATH.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(data, indent=2), encoding="utf-8")
    temporary.replace(DB_PATH)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/incidents", dependencies=[Depends(require_api_key)])
def list_incidents() -> dict[str, Any]:
    with _lock:
        return {"incidents": list(load_data().values())}


@app.post("/api/incidents", dependencies=[Depends(require_api_key)])
def create_incident(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    incident_id = payload.get("incident_id")
    if not incident_id:
        raise HTTPException(status_code=400, detail="incident_id is required")

    with _lock:
        items = load_data()
        if incident_id in items:
            return {"stored": False, "duplicate": True, "incident_id": incident_id}
        payload.setdefault("received_at", datetime.now(timezone.utc).isoformat())
        items[incident_id] = payload
        save_data(items)
    return {"stored": True, "duplicate": False, "incident_id": incident_id}


@app.patch("/api/incidents/{incident_id}/evidence", dependencies=[Depends(require_api_key)])
def update_evidence(incident_id: str, updates: dict[str, Any] = Body(...)) -> dict[str, Any]:
    with _lock:
        items = load_data()
        if incident_id not in items:
            raise HTTPException(status_code=404, detail="Incident not found")
        items[incident_id].setdefault("evidence", {}).update(updates)
        save_data(items)
    return {"updated": True, "incident_id": incident_id}


@app.patch("/api/incidents/{incident_id}/analysis", dependencies=[Depends(require_api_key)])
def update_analysis(incident_id: str, updates: dict[str, Any] = Body(...)) -> dict[str, Any]:
    with _lock:
        items = load_data()
        if incident_id not in items:
            raise HTTPException(status_code=404, detail="Incident not found")
        analysis = updates.get("llm_analysis", updates)
        items[incident_id]["llm_analysis"] = analysis
        save_data(items)
    return {"updated": True, "incident_id": incident_id, "llm_analysis": analysis}
