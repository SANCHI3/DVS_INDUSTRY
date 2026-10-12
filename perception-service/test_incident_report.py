import json
import os
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from reporting.incident_report import IncidentReporter


class FakeResponse:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        return False

    def read(self):
        return b"{}"


def confirmed_event(event_type="fire_smoke"):
    return SimpleNamespace(
        camera_id="CAM-01",
        event_type=event_type,
        tier="CONFIRMED",
        confidence=0.94,
        duration_s=2.5,
        candidate=SimpleNamespace(
            detail={"fire_score": 0.94},
            track_ids=[7],
            zone_id="ZONE-A",
        ),
    )


class IncidentReporterTests(unittest.TestCase):
    def make_reporter(self, output_path, backend_url=None):
        return IncidentReporter(
            output_path=output_path,
            camera_locations={"CAM-01": "Loading Bay"},
            backend_url=backend_url,
        )

    @patch.dict(
        os.environ,
        {
            "DASHBOARD_BACKEND_URL": "https://dashboard.test/",
            "DASHBOARD_API_TOKEN": "secret-token",
        },
        clear=False,
    )
    @patch("reporting.incident_report.generate_description", return_value="deterministic description")
    @patch("reporting.incident_report.urllib.request.urlopen", return_value=FakeResponse())
    def test_dashboard_post_payload_and_authentication(self, urlopen, _description):
        with tempfile.TemporaryDirectory() as directory:
            reporter = self.make_reporter(os.path.join(directory, "incidents.jsonl"))
            with patch.object(reporter, "_trigger_llm_enrichment"):
                report = reporter.build_and_save(confirmed_event(), "HIGH")

        dashboard_request = urlopen.call_args.args[0]
        self.assertEqual(
            dashboard_request.full_url,
            "https://dashboard.test/api/v1/security/incidents",
        )
        self.assertEqual(dashboard_request.method, "POST")
        self.assertEqual(
            dashboard_request.get_header("Authorization"),
            "Bearer secret-token",
        )
        self.assertEqual(
            json.loads(dashboard_request.data.decode("utf-8")),
            {
                "incident_id": report["incident_id"],
                "title": "fire_smoke",
                "description": "deterministic description",
                "type": "FIRE_SMOKE",
                "severity": "HIGH",
                "confidenceScore": report["confidence_score"],
                "location": "Loading Bay",
                "occurredAt": report["detected_at"],
                "reportedByName": "Perception Service",
            },
        )

    @patch.dict(
        os.environ,
        {
            "DASHBOARD_BACKEND_URL": "https://dashboard.test",
            "DASHBOARD_API_TOKEN": "secret-token",
        },
        clear=False,
    )
    @patch("reporting.incident_report.generate_description", return_value="crowd description")
    @patch("reporting.incident_report.urllib.request.urlopen", return_value=FakeResponse())
    def test_unsupported_event_type_maps_to_other(self, urlopen, _description):
        with tempfile.TemporaryDirectory() as directory:
            reporter = self.make_reporter(os.path.join(directory, "incidents.jsonl"))
            with patch.object(reporter, "_trigger_llm_enrichment"):
                reporter.build_and_save(confirmed_event("crowd"), "LOW")

        payload = json.loads(urlopen.call_args.args[0].data.decode("utf-8"))
        self.assertEqual(payload["type"], "CROWD")

    @patch.dict(
        os.environ,
        {
            "DASHBOARD_BACKEND_URL": "https://dashboard.test",
            "DASHBOARD_API_TOKEN": "secret-token",
        },
        clear=False,
    )
    @patch("reporting.incident_report.generate_description", return_value="description")
    def test_no_llm_key_means_no_enrichment(self, _description):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {"LLM_API_KEY": ""}):
            reporter = self.make_reporter(os.path.join(directory, "incidents.jsonl"))
            with patch.object(reporter, "_post_dashboard_incident"), \
                    patch.object(reporter, "_trigger_llm_enrichment") as enrich:
                reporter.build_and_save(confirmed_event("fall"), "MEDIUM")
        enrich.assert_not_called()

    @patch.dict(
        os.environ,
        {
            "DASHBOARD_BACKEND_URL": "https://dashboard.test",
            "DASHBOARD_API_TOKEN": "secret-token",
            "LLM_API_KEY": "test-key",
        },
        clear=False,
    )
    @patch("reporting.incident_report.generate_description", return_value="description")
    @patch("reporting.incident_report.urllib.request.urlopen", return_value=FakeResponse())
    def test_legacy_save_dashboard_create_then_enrichment(self, urlopen, _description):
        order = []

        def record_request(request, timeout):
            order.append(request.full_url)
            return FakeResponse()

        with tempfile.TemporaryDirectory() as directory:
            output_path = os.path.join(directory, "incidents.jsonl")
            reporter = self.make_reporter(output_path, "http://legacy.test:8000")
            with patch("reporting.incident_report.urllib.request.urlopen", side_effect=record_request):
                with patch.object(
                    reporter,
                    "_trigger_llm_enrichment",
                    side_effect=lambda incident_id: order.append("enrichment"),
                ):
                    reporter.build_and_save(confirmed_event("fire"), "MEDIUM")

            with open(output_path, encoding="utf-8") as file:
                saved_lines = file.readlines()

        self.assertEqual(len(saved_lines), 1)
        self.assertEqual(
            order,
            [
                "http://legacy.test:8000/api/incidents",
                "https://dashboard.test/api/v1/security/incidents",
                "enrichment",
            ],
        )
        self.assertEqual(urlopen.call_count, 0)

    @patch.dict(os.environ, {}, clear=True)
    @patch("reporting.incident_report.generate_description", return_value="description")
    def test_missing_configuration_is_sanitized_and_does_not_log_token(self, _description):
        for environment in (
            {},
            {"DASHBOARD_BACKEND_URL": "https://dashboard.test"},
        ):
            with self.subTest(environment=environment):
                with patch.dict(os.environ, environment, clear=True):
                    with tempfile.TemporaryDirectory() as directory:
                        reporter = self.make_reporter(
                            os.path.join(directory, "incidents.jsonl"),
                        )
                        with patch.object(reporter, "_trigger_llm_enrichment"):
                            with patch("builtins.print") as print_mock:
                                reporter.build_and_save(confirmed_event("crowd"), "LOW")

                output = " ".join(str(call) for call in print_mock.call_args_list)
                self.assertIn("DASHBOARD_", output)
                self.assertNotIn("secret-token", output)

    @patch.dict(
        os.environ,
        {
            "DASHBOARD_BACKEND_URL": "https://dashboard.test",
            "DASHBOARD_API_TOKEN": "secret-token",
        },
        clear=False,
    )
    @patch("reporting.incident_report.generate_description", return_value="description")
    @patch(
        "reporting.incident_report.urllib.request.urlopen",
        side_effect=RuntimeError("request failed"),
    )
    def test_http_failure_does_not_log_dashboard_token(self, _urlopen, _description):
        with tempfile.TemporaryDirectory() as directory:
            reporter = self.make_reporter(os.path.join(directory, "incidents.jsonl"))
            with patch.object(reporter, "_trigger_llm_enrichment"):
                with patch("builtins.print") as print_mock:
                    reporter.build_and_save(confirmed_event(), "HIGH")

        output = " ".join(str(call) for call in print_mock.call_args_list)
        self.assertIn("RuntimeError", output)
        self.assertNotIn("secret-token", output)


if __name__ == "__main__":
    unittest.main()
