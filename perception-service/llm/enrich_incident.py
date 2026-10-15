from __future__ import annotations

import argparse
import json
from pathlib import Path

from llm.summarizer import (
    summarize_incident,
    summary_output,
    upsert_summary,
)
from reporting.dashboard_client import DashboardClient, DashboardClientError
from schemas.incident_schema import IncidentRecord


def load_incident(incident_id: str, incident_path: Path = Path("output/incidents.jsonl")) -> IncidentRecord:
    records = [
        IncidentRecord.model_validate_json(line)
        for line in incident_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    matches = [record for record in records if record.incident_id == incident_id]
    if not matches:
        raise RuntimeError(f"Incident not found: {incident_id}")
    return matches[-1]


def attach_to_backend(record: IncidentRecord, summary: str) -> dict:
    try:
        return DashboardClient().request(
            "/api/v1/security/incidents/ai-summary",
            {
                "incident_id": record.incident_id,
                "summary": summary,
            },
            "PATCH",
        )
    except DashboardClientError as exc:
        if exc.status_code == 404:
            raise RuntimeError(
                f"Dashboard incident {record.incident_id} was not found."
            ) from exc
        raise RuntimeError(str(exc)) from exc


def enrich_incident(incident_id: str, incident_log: Path = Path("output/incidents.jsonl"),
                    summaries: Path | None = None) -> dict:
    record = load_incident(incident_id, incident_log)
    analysis = summarize_incident(record)
    output = summary_output(record, analysis)

    # Idempotent local persistence: rerunning an incident replaces its row.
    upsert_summary(output, summaries)

    backend_result = attach_to_backend(record, analysis.summary)
    return {
        "incident_id": record.incident_id,
        "summary_saved": True,
        "backend_result": backend_result,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--incident-id", required=True)
    parser.add_argument("--incident-log", type=Path, default=Path("output/incidents.jsonl"))
    parser.add_argument("--summaries", type=Path, default=None)
    args = parser.parse_args()
    print(
        json.dumps(
            enrich_incident(args.incident_id, args.incident_log, args.summaries),
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    from env_loader import load_env

    load_env()
    main()
