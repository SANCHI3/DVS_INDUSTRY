"""Incident report persistence, backend forwarding, and LLM enrichment."""

from __future__ import annotations

import json
import os
import queue
import subprocess
import sys
import threading
import urllib.request
import uuid
from datetime import datetime, timezone
from typing import Dict, Optional

from reporting.dashboard_client import DashboardClient, DashboardClientError
from reporting.description_generator import (
    generate_description,
    is_review_fight,
    recommended_action,
)
from schemas.incident_schema import IncidentRecord
from severity.severity_rules import SEVERITY_ORDER

# Bumped when event validation changes, so records produced before and after
# a change can be told apart (scripts/audit_incident_log.py groups by it).
# 2: active-track rules, fight interaction check, fire/smoke
#    static-region check + verifier reset, per-camera anomaly calibration,
#    evidence-based confidence scores.
# 3: fight interaction check is a review signal (PROBABLE), not a veto.
VALIDATION_VERSION = 3

# Dashboard title of a fight sent for operator review.
REVIEW_FIGHT_TITLE = "Possible fight — please check"


def is_dashboard_review(report: dict) -> bool:
    """A PROBABLE fight sent for operator review (interaction check failed, or
    model score below the alarm threshold): shown on the dashboard for an
    operator to check, unlike other PROBABLE events."""
    return (
        str(report.get("event_type")).lower() == "fight"
        and str(report.get("confidence_tier")).upper() == "PROBABLE"
        and is_review_fight(report.get("detail") or {})
    )

# How the confidence score was obtained, for events whose detector does not
# record it itself. Confidence always comes from a detector/model output and
# is never produced or altered by the LLM summary.
DEFAULT_CONFIDENCE_BASIS = {
    "fall": "fall model probability",
    "crowd": "mean person-detector confidence of the group",
}


class IncidentReporter:
    """Builds, validates, persists, and enriches incident reports."""

    DASHBOARD_INCIDENT_TYPES = {
        "FIRE",
        "FIRE_SMOKE",
        "SMOKE",
        "CROWD",
        "FIGHT",
        "FALL",
        "THEFT",
        "INJURY",
        "PROPERTY_DAMAGE",
        "UNAUTHORIZED_ACCESS",
        "EQUIPMENT_FAILURE",
        "CHEMICAL_SPILL",
        "NEAR_MISS",
        "OTHER",
    }
    DASHBOARD_EVENT_TYPE_MAP = {
        "fire": "FIRE",
        "fire_smoke": "FIRE_SMOKE",
        "smoke": "SMOKE",
        "fight": "FIGHT",
        "fall": "FALL",
        "crowd": "CROWD",
        "anomaly": "OTHER",
    }
    MAX_REMEMBERED_REPORTS = 500

    def __init__(
        self,
        output_path: str,
        camera_locations: dict,
        backend_url: Optional[str] = None,
        background: bool = False,
    ):
        """
        background=True moves every network call (legacy POST, dashboard
        create, LLM enrichment) onto a single worker thread, so a slow backend
        or LLM never stalls the video loop. Call close() on shutdown to drain.
        """
        self.output_path = output_path
        self.camera_locations = camera_locations
        self.backend_url = backend_url.rstrip("/") if backend_url else None
        self.dashboard_backend_url = os.getenv("DASHBOARD_BACKEND_URL")
        self.dashboard_backend_url = (
            self.dashboard_backend_url.rstrip("/")
            if self.dashboard_backend_url
            else None
        )
        self.dashboard_api_token = os.getenv("DASHBOARD_API_TOKEN")
        self.dashboard_client = DashboardClient()

        os.makedirs(
            os.path.dirname(output_path) or ".",
            exist_ok=True,
        )

        # Dashboard creates that failed (backend down, network error) are kept
        # here and retried before the next create, so incidents are not lost.
        self.outbox_path = os.path.join(
            os.path.dirname(output_path) or ".",
            "dashboard_outbox.jsonl",
        )
        self.summaries_path = os.path.join(
            os.path.dirname(output_path) or ".",
            "llm_summaries.jsonl",
        )

        # Recent reports by incident_id, so lifecycle updates (escalations) can
        # be forwarded to the dashboard without re-reading incidents.jsonl.
        self._reports: Dict[str, dict] = {}

        self._queue: Optional[queue.Queue] = None
        self._worker: Optional[threading.Thread] = None
        if background:
            self._queue = queue.Queue()
            self._worker = threading.Thread(
                target=self._run_worker,
                name="incident-reporter",
                daemon=True,
            )
            self._worker.start()

    # ── Background dispatch ──────────────────────────────────────────────────

    def _dispatch(self, job) -> None:
        if self._queue is None:
            job()
        else:
            self._queue.put(job)

    def _run_worker(self) -> None:
        assert self._queue is not None
        while True:
            job = self._queue.get()
            try:
                if job is None:
                    return
                job()
            except Exception as exc:  # never let one job kill the worker
                print(f"[reporter] background job failed: {type(exc).__name__}: {exc}")
            finally:
                self._queue.task_done()

    def close(self, timeout: float = 120.0) -> None:
        """Finish queued dashboard/LLM work, then stop the worker."""

        if self._queue is None or self._worker is None:
            return
        self._queue.put(None)
        self._worker.join(timeout=timeout)
        if self._worker.is_alive():
            print("[reporter] shutdown timed out; pending work stays in the outbox")

    def build_and_save(
        self,
        confirmed_event,
        severity: str,
        clip_before: Optional[str] = None,
        keyframes: Optional[list] = None,
    ) -> dict:
        """Build, validate, save, and automatically enrich an incident."""

        location = self.camera_locations.get(
            confirmed_event.camera_id,
            confirmed_event.camera_id,
        )

        detail = dict(confirmed_event.candidate.detail or {})
        detail.setdefault(
            "confidence_basis",
            DEFAULT_CONFIDENCE_BASIS.get(confirmed_event.event_type, "detector score"),
        )
        detail["validation_version"] = VALIDATION_VERSION
        track_ids = confirmed_event.candidate.track_ids or []

        report = {
            "incident_id": (
                f"INC-{datetime.now(timezone.utc):%Y%m%d}-"
                f"{uuid.uuid4().hex[:6].upper()}"
            ),
            "camera_id": confirmed_event.camera_id,
            "location": location,
            "event_type": confirmed_event.event_type,
            "confidence_tier": confirmed_event.tier,
            "confidence_score": round(confirmed_event.confidence, 2),
            "severity": severity,
            "detected_at": datetime.now(timezone.utc).isoformat(),
            "duration_s": confirmed_event.duration_s,
            "description": generate_description(
                confirmed_event.event_type,
                location,
                detail,
            ),
            "detected_objects": [
                {
                    "track_id": track_id,
                    "role": "primary" if index == 0 else "secondary",
                }
                for index, track_id in enumerate(track_ids)
            ],
            "zone_id": confirmed_event.candidate.zone_id,
            "detail": detail,
            "evidence": {
                "clip_before": clip_before,
                "clip_after": None,
                "keyframes": keyframes or [],
            },
            "recommended_action": recommended_action(
                confirmed_event.event_type,
            ),
            "review_status": "pending",
        }

        report = IncidentRecord.model_validate(report).model_dump(
            mode="json",
        )

        # Save locally first. Network/LLM failures must not discard the incident.
        self._append_local(report)
        self._remember(report)
        self._dispatch(lambda: self._publish(report))
        return report

    def _publish(self, report: dict) -> None:
        """Forward a saved incident: legacy API, dashboard, then LLM enrichment."""

        if self.backend_url:
            self._send_json("/api/incidents", report, "POST")

        # CONFIRMED incidents reach the dashboard, and each one gets a
        # plain-language LLM summary (if LLM_API_KEY is set). PROBABLE ones
        # stay local until they are confirmed (see _forward_update), except a
        # fight sent for operator review, which is shown as a lower-priority
        # "Possible fight - please check" without a summary or pop-up.
        if str(report["confidence_tier"]).upper() == "CONFIRMED":
            self._create_dashboard_incident(report)
            self._enrich_if_configured(report["incident_id"])
        elif is_dashboard_review(report):
            self._create_dashboard_incident(report)

    def _enrich_if_configured(self, incident_id: str) -> None:
        if os.getenv("LLM_API_KEY"):
            self._trigger_llm_enrichment(incident_id)

    def _create_dashboard_incident(self, report: dict) -> None:
        """Create the dashboard incident before LLM enrichment starts."""

        event_type = str(report["event_type"]).lower()
        dashboard_type = self.DASHBOARD_EVENT_TYPE_MAP.get(event_type, "OTHER")
        if dashboard_type not in self.DASHBOARD_INCIDENT_TYPES:
            dashboard_type = "OTHER"

        review = is_dashboard_review(report)
        payload = {
            "incident_id": report["incident_id"],
            "title": REVIEW_FIGHT_TITLE if review else report["event_type"],
            "description": report["description"],
            "type": dashboard_type,
            "severity": report["severity"],
            # A review fight is sent without a confidence: the dashboard pops up
            # incidents with high confidence, and this one has not met the
            # confirmation policy. The model score stays in the local evidence
            # and is sent with the escalation if the fight is confirmed.
            "confidenceScore": None if review else report["confidence_score"],
            "location": report["location"],
            "occurredAt": report["detected_at"],
            "reportedByName": "Perception Service",
        }
        self._flush_outbox()
        try:
            self._post_dashboard_incident(payload)
        except DashboardClientError as exc:
            if exc.retryable:
                self._append_outbox(payload)
                print(
                    "[reporter] dashboard incident creation failed: "
                    f"{exc}; queued for retry"
                )
            else:
                print(
                    "[reporter] dashboard incident creation failed: "
                    f"{exc}"
                )

    def _post_dashboard_incident(self, payload: dict) -> None:
        self.dashboard_client.request(
            "/api/v1/security/incidents",
            payload,
            "POST",
        )

    # ── Outbox (durable retry for dashboard creates) ─────────────────────────

    def _append_outbox(self, payload: dict) -> None:
        with open(self.outbox_path, "a", encoding="utf-8") as file:
            file.write(json.dumps(payload, ensure_ascii=False) + "\n")

    def _local_summary(self, incident_id: str) -> Optional[str]:
        """LLM summary saved locally while the dashboard was unreachable."""

        if not os.path.exists(self.summaries_path):
            return None
        summary = None
        with open(self.summaries_path, encoding="utf-8") as file:
            for line in file:
                try:
                    row = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if row.get("incident_id") == incident_id:
                    analysis = row.get("llm_analysis") or {}
                    summary = analysis.get("summary") or summary
        return summary

    def _flush_outbox(self) -> None:
        """Retry queued creates. The backend dedupes on incident_id, so a
        create that actually succeeded before a timeout is harmless to resend."""

        if not os.path.exists(self.outbox_path):
            return
        with open(self.outbox_path, encoding="utf-8") as file:
            pending = [json.loads(line) for line in file if line.strip()]

        remaining = []
        for index, payload in enumerate(pending):
            summary = self._local_summary(payload.get("incident_id", ""))
            if summary:
                payload = {**payload, "summary": summary[:1000]}
            try:
                self._post_dashboard_incident(payload)
                print(f"[reporter] delivered queued incident {payload.get('incident_id')}")
            except DashboardClientError as exc:
                if not exc.retryable and exc.status_code is not None:
                    # The backend rejected this payload (4xx); resending won't help
                    print(f"[reporter] dropping undeliverable incident {payload.get('incident_id')}: {exc}")
                    continue
                # Backend unavailable or client not configured: keep this and
                # everything after it for the next attempt
                remaining = pending[index:]
                break

        temporary = self.outbox_path + ".tmp"
        with open(temporary, "w", encoding="utf-8") as file:
            for payload in remaining:
                file.write(json.dumps(payload, ensure_ascii=False) + "\n")
        os.replace(temporary, self.outbox_path)

    def _trigger_llm_enrichment(self, incident_id: str) -> None:
        """Run the existing exact-ID LLM enrichment module."""

        try:
            project_root = os.path.dirname(
                os.path.dirname(os.path.abspath(__file__)),
            )

            result = subprocess.run(
                [
                    sys.executable,
                    "-X",
                    "utf8",
                    "-m",
                    "llm.enrich_incident",
                    "--incident-id",
                    incident_id,
                    "--incident-log",
                    os.path.abspath(self.output_path),
                    "--summaries",
                    os.path.abspath(self.summaries_path),
                ],
                cwd=project_root,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=90,
                check=False,
            )

            if result.returncode != 0:
                print(
                    "[reporter] LLM enrichment failed for "
                    f"{incident_id}: {result.stderr.strip()}"
                )
                return

            output = result.stdout.strip()
            if output:
                print(
                    "[reporter] LLM enrichment completed for "
                    f"{incident_id}: {output}"
                )
            else:
                print(
                    "[reporter] LLM enrichment completed for "
                    f"{incident_id}"
                )

        except subprocess.TimeoutExpired:
            print(
                "[reporter] LLM enrichment timed out for "
                f"{incident_id}; incident remains saved"
            )

        except Exception as exc:
            print(
                "[reporter] LLM enrichment error for "
                f"{incident_id}: {exc}; incident remains saved"
            )

    def save(self, report: dict) -> None:
        """Append the incident locally and optionally POST it to the backend."""

        self._append_local(report)
        if self.backend_url:
            self._send_json(
                "/api/incidents",
                report,
                "POST",
            )

    def _append_local(self, report: dict) -> None:
        with open(
            self.output_path,
            "a",
            encoding="utf-8",
        ) as file:
            file.write(
                json.dumps(
                    report,
                    ensure_ascii=False,
                )
                + "\n"
            )

    def _send_json(
        self,
        path: str,
        payload: dict,
        method: str,
    ):
        """Send a JSON request to the configured backend."""

        body = json.dumps(
            payload,
            ensure_ascii=False,
        ).encode("utf-8")

        request = urllib.request.Request(
            url=f"{self.backend_url}{path}",
            data=body,
            headers={
                "Content-Type": "application/json",
                # Required by backend/api.py; never logged
                "X-API-Key": os.getenv("INCIDENT_API_KEY", ""),
            },
            method=method,
        )

        try:
            with urllib.request.urlopen(
                request,
                timeout=3,
            ) as response:
                return response.read()

        except Exception as exc:
            print(f"[reporter] backend {method} failed: {exc}")
            return None

    def update_evidence(
        self,
        incident_id: str,
        updates: dict,
    ) -> None:
        """Append an evidence update for an existing incident."""

        update_path = os.path.join(
            os.path.dirname(self.output_path) or ".",
            "evidence_updates.jsonl",
        )

        record = {
            "incident_id": incident_id,
            "updated_at": datetime.now(timezone.utc).isoformat(),
            **updates,
        }

        with open(
            update_path,
            "a",
            encoding="utf-8",
        ) as file:
            file.write(
                json.dumps(
                    record,
                    ensure_ascii=False,
                )
                + "\n"
            )

    def _forward_update(self, incident_id: str, updates: dict) -> None:
        previous = self._reports.get(incident_id)
        if previous is None:
            return
        current = {**previous, **{k: v for k, v in updates.items() if k in previous}}

        # Never lower what was reported (a later re-detection can score lower).
        current["confidence_score"] = max(current["confidence_score"], previous["confidence_score"])
        current["severity"] = max(current["severity"], previous["severity"], key=SEVERITY_ORDER.index)
        self._remember(current)

        was_confirmed = previous["confidence_tier"] == "CONFIRMED"
        if not was_confirmed and current["confidence_tier"] == "CONFIRMED" and is_dashboard_review(previous):
            # Already on the dashboard as "please check": confirm it there. Adding
            # the confidence is what raises the pop-up on the dashboard.
            reason = "fight confirmed: two people seen close together with agitated motion"
            def confirm_review() -> None:
                self._escalate_dashboard_incident(
                    incident_id, current["severity"], reason, current["confidence_score"])
                self._enrich_if_configured(incident_id)
            self._dispatch(confirm_review)
        elif not was_confirmed and current["confidence_tier"] == "CONFIRMED":
            def create_and_enrich() -> None:
                self._create_dashboard_incident(current)
                self._enrich_if_configured(incident_id)
            self._dispatch(create_and_enrich)
        elif was_confirmed and (
            current["severity"] != previous["severity"]
            or current["confidence_score"] > previous["confidence_score"]
        ):
            reason = str(updates.get("escalation_reason") or "re-detected with higher confidence")
            self._dispatch(lambda: self._escalate_dashboard_incident(
                incident_id, current["severity"], reason, current["confidence_score"]
            ))

    def _escalate_dashboard_incident(
        self, incident_id: str, severity: str, reason: str, confidence: Optional[float] = None
    ) -> None:
        payload = {"incident_id": incident_id, "severity": severity, "reason": reason[:1000]}
        if confidence is not None:
            payload["confidenceScore"] = confidence
        try:
            self.dashboard_client.request("/api/v1/security/incidents/escalate", payload, "PATCH")
            print(f"[reporter] dashboard incident {incident_id} escalated "
                  f"(severity={severity}, confidence={confidence})")
        except DashboardClientError as exc:
            print(f"[reporter] dashboard escalation failed for {incident_id}: {exc}")

    def _remember(self, report: dict) -> None:
        self._reports.pop(report["incident_id"], None)
        self._reports[report["incident_id"]] = report
        while len(self._reports) > self.MAX_REMEMBERED_REPORTS:
            self._reports.pop(next(iter(self._reports)))

    def update_incident(
        self,
        incident_id: str,
        updates: dict,
    ) -> None:
        """Append a lifecycle update for an existing incident and forward it.

        Dashboard side: an incident that reaches CONFIRMED for the first time
        is created there; one already there gets its severity raised (never
        lowered) through the escalate endpoint."""

        self._forward_update(incident_id, updates)

        update_path = os.path.join(
            os.path.dirname(self.output_path) or ".",
            "incident_updates.jsonl",
        )

        record = {
            "incident_id": incident_id,
            "updated_at": datetime.now(timezone.utc).isoformat(),
            **updates,
        }

        with open(
            update_path,
            "a",
            encoding="utf-8",
        ) as file:
            file.write(
                json.dumps(
                    record,
                    ensure_ascii=False,
                )
                + "\n"
            )
