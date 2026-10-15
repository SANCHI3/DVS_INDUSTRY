"""Zone YAML from scripts/draw_zones.py is valid cameras.yaml content.

    python -m pytest test_draw_zones.py
"""
from __future__ import annotations

import yaml

from scripts.draw_zones import coverage, zones_yaml
from temporal.zones import zone_warnings


def test_zone_yaml_round_trips_into_cameras_config():
    zones = [{"zone_id": "z1", "type": "restricted", "name": "Panel room",
              "polygon": [[10, 10], [200, 10], [200, 150], [10, 150]]}]
    text = "cameras:\n  - id: CAM-01\n    source: \"0\"\n" + zones_yaml(zones)
    parsed = yaml.safe_load(text)["cameras"][0]["zones"]
    assert parsed == zones
    assert zone_warnings(parsed, 640, 480) == []          # small zone: no warning
    assert round(coverage(zones[0]["polygon"], 640, 480), 3) == round(190 * 140 / (640 * 480), 3)


def test_large_zone_is_flagged():
    big = [{"zone_id": "z1", "type": "restricted", "name": "Left third",
            "polygon": [[0, 0], [200, 0], [200, 480], [0, 480]]}]
    assert coverage(big[0]["polygon"], 640, 480) > 0.25
    assert zone_warnings(big, 640, 480)
