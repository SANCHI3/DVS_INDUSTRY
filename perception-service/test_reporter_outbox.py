import json
import os
import tempfile
import threading
import unittest
from unittest.mock import patch

from reporting.dashboard_client import DashboardClientError
from reporting.incident_report import IncidentReporter
from test_incident_report import confirmed_event


def make_reporter(directory, background=False):
    return IncidentReporter(
        output_path=os.path.join(directory, "incidents.jsonl"),
        camera_locations={"CAM-01": "Loading Bay"},
        background=background,
    )


def read_outbox(directory):
    path = os.path.join(directory, "dashboard_outbox.jsonl")
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as file:
        return [json.loads(line) for line in file if line.strip()]


@patch("reporting.incident_report.generate_description", return_value="description")
class OutboxTests(unittest.TestCase):
    def test_transient_failure_is_queued_then_delivered(self, _description):
        with tempfile.TemporaryDirectory() as directory:
            reporter = make_reporter(directory)
            down = DashboardClientError("network", retryable=True)

            with patch.object(reporter, "_trigger_llm_enrichment"), patch("builtins.print"):
                with patch.object(reporter, "_post_dashboard_incident", side_effect=down):
                    report = reporter.build_and_save(confirmed_event(), "HIGH")
                self.assertEqual(
                    [p["incident_id"] for p in read_outbox(directory)],
                    [report["incident_id"]],
                )

                delivered = []
                with patch.object(
                    reporter, "_post_dashboard_incident", side_effect=delivered.append
                ):
                    second = reporter.build_and_save(confirmed_event("crowd"), "LOW")

            ids = [p["incident_id"] for p in delivered]
            self.assertEqual(ids, [report["incident_id"], second["incident_id"]])
            self.assertEqual(read_outbox(directory), [])

    def test_queued_incident_carries_local_llm_summary(self, _description):
        with tempfile.TemporaryDirectory() as directory:
            reporter = make_reporter(directory)
            reporter._append_outbox({"incident_id": "INC-X", "title": "fire"})
            with open(os.path.join(directory, "llm_summaries.jsonl"), "w", encoding="utf-8") as f:
                f.write(json.dumps({"incident_id": "INC-X", "llm_analysis": {"summary": "Smoke near bay"}}) + "\n")

            delivered = []
            with patch.object(reporter, "_post_dashboard_incident", side_effect=delivered.append), \
                    patch("builtins.print"):
                reporter._flush_outbox()

            self.assertEqual(delivered[0]["summary"], "Smoke near bay")

    def test_rejected_payload_is_dropped_not_retried_forever(self, _description):
        with tempfile.TemporaryDirectory() as directory:
            reporter = make_reporter(directory)
            reporter._append_outbox({"incident_id": "INC-BAD"})
            rejected = DashboardClientError("HTTP 422", status_code=422, retryable=False)
            with patch.object(reporter, "_post_dashboard_incident", side_effect=rejected), \
                    patch("builtins.print"):
                reporter._flush_outbox()
            self.assertEqual(read_outbox(directory), [])

    def test_configuration_error_is_not_queued(self, _description):
        with tempfile.TemporaryDirectory() as directory:
            reporter = make_reporter(directory)
            misconfigured = DashboardClientError("DASHBOARD_BACKEND_URL is not configured.")
            with patch.object(reporter, "_trigger_llm_enrichment"), patch("builtins.print"), \
                    patch.object(reporter, "_post_dashboard_incident", side_effect=misconfigured):
                reporter.build_and_save(confirmed_event(), "HIGH")
            self.assertEqual(read_outbox(directory), [])


@patch("reporting.incident_report.generate_description", return_value="description")
class IncidentUpdateForwardingTests(unittest.TestCase):
    def test_higher_severity_escalates_the_dashboard_incident(self, _description):
        with tempfile.TemporaryDirectory() as directory:
            reporter = make_reporter(directory)
            with patch.object(reporter, "_post_dashboard_incident"), \
                    patch.object(reporter, "_trigger_llm_enrichment"), patch("builtins.print"), \
                    patch.object(reporter.dashboard_client, "request") as request:
                report = reporter.build_and_save(confirmed_event("fall"), "MEDIUM")
                reporter.update_incident(report["incident_id"], {
                    "severity": "CRITICAL",
                    "escalation_reason": "person still down 20s after the fall",
                })
                reporter.update_incident(report["incident_id"], {"severity": "HIGH"})  # never lowers

            request.assert_called_once_with(
                "/api/v1/security/incidents/escalate",
                {"incident_id": report["incident_id"], "severity": "CRITICAL",
                 "reason": "person still down 20s after the fall", "confidenceScore": 0.94},
                "PATCH",
            )

    def test_rising_confidence_updates_the_dashboard_incident(self, _description):
        with tempfile.TemporaryDirectory() as directory:
            reporter = make_reporter(directory)
            with patch.object(reporter, "_post_dashboard_incident"), \
                    patch.object(reporter, "_trigger_llm_enrichment"), patch("builtins.print"), \
                    patch.object(reporter.dashboard_client, "request") as request:
                report = reporter.build_and_save(confirmed_event("fight"), "HIGH")
                reporter.update_incident(report["incident_id"], {"confidence_score": 0.99})
                reporter.update_incident(report["incident_id"], {"confidence_score": 0.80})  # never lowers

            request.assert_called_once()
            self.assertEqual(request.call_args.args[1]["confidenceScore"], 0.99)
            self.assertEqual(request.call_args.args[1]["severity"], "HIGH")

    def test_probable_incident_reaching_confirmed_is_created_on_dashboard(self, _description):
        with tempfile.TemporaryDirectory() as directory:
            reporter = make_reporter(directory)
            probable = confirmed_event()
            probable.tier = "PROBABLE"
            posted = []
            with patch.object(reporter, "_post_dashboard_incident", side_effect=posted.append), \
                    patch("builtins.print"):
                report = reporter.build_and_save(probable, "HIGH")
                self.assertEqual(posted, [])  # PROBABLE stays local
                reporter.update_incident(report["incident_id"], {"confidence_tier": "CONFIRMED"})

            self.assertEqual([p["incident_id"] for p in posted], [report["incident_id"]])


@patch("reporting.incident_report.generate_description", return_value="description")
class BackgroundModeTests(unittest.TestCase):
    def test_build_and_save_returns_before_network_work_finishes(self, _description):
        with tempfile.TemporaryDirectory() as directory:
            reporter = make_reporter(directory, background=True)
            release = threading.Event()
            posted = []

            def slow_post(payload):
                release.wait(5)
                posted.append(payload["incident_id"])

            with patch.object(reporter, "_post_dashboard_incident", side_effect=slow_post), \
                    patch.object(reporter, "_trigger_llm_enrichment"), patch("builtins.print"):
                report = reporter.build_and_save(confirmed_event(), "HIGH")

                # Returned (and saved locally) while the dashboard call is still blocked
                self.assertEqual(posted, [])
                with open(os.path.join(directory, "incidents.jsonl"), encoding="utf-8") as f:
                    self.assertEqual(len(f.readlines()), 1)

                release.set()
                reporter.close(timeout=5)

            self.assertEqual(posted, [report["incident_id"]])


if __name__ == "__main__":
    unittest.main()
