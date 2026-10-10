import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

import backend.api as api


class IncidentApiTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.db = patch.object(api, "DB_PATH", Path(self.directory.name) / "incidents.json")
        self.db.start()
        self.client = TestClient(api.app)

    def tearDown(self):
        self.db.stop()
        self.directory.cleanup()

    def test_health_is_public(self):
        self.assertEqual(self.client.get("/health").status_code, 200)

    @patch.dict(os.environ, {"INCIDENT_API_KEY": "k"})
    def test_requires_api_key(self):
        self.assertEqual(self.client.get("/api/incidents").status_code, 401)
        self.assertEqual(
            self.client.get("/api/incidents", headers={"X-API-Key": "wrong"}).status_code, 401
        )

    @patch.dict(os.environ, {}, clear=True)
    def test_refuses_when_key_not_configured(self):
        response = self.client.get("/api/incidents", headers={"X-API-Key": ""})
        self.assertEqual(response.status_code, 503)

    @patch.dict(os.environ, {"INCIDENT_API_KEY": "k"})
    def test_create_is_idempotent_and_updates_work(self):
        headers = {"X-API-Key": "k"}
        first = self.client.post("/api/incidents", json={"incident_id": "A"}, headers=headers)
        again = self.client.post("/api/incidents", json={"incident_id": "A"}, headers=headers)
        self.assertTrue(first.json()["stored"])
        self.assertTrue(again.json()["duplicate"])

        evidence = self.client.patch(
            "/api/incidents/A/evidence", json={"clip_after": "x.mp4"}, headers=headers
        )
        self.assertTrue(evidence.json()["updated"])
        missing = self.client.patch("/api/incidents/B/analysis", json={}, headers=headers)
        self.assertEqual(missing.status_code, 404)

        incidents = self.client.get("/api/incidents", headers=headers).json()["incidents"]
        self.assertEqual(incidents[0]["evidence"]["clip_after"], "x.mp4")


if __name__ == "__main__":
    unittest.main()
