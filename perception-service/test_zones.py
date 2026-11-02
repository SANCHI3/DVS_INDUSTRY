"""Camera areas, ignore zones, night pictures and per-camera thresholds."""
from __future__ import annotations

import numpy as np
import pytest
import yaml

from ingestion.zones import MASK_GREY, ZoneMask, is_grayscale
from pipeline import camera_thresholds
from scripts.draw_roi import normalise, to_yaml
from temporal.rule_engine import EventCandidate

W, H = 640, 480


def colour_frame():
    rng = np.random.default_rng(1)
    return rng.integers(0, 255, (H, W, 3), dtype=np.uint8)


def test_roi_greys_out_everything_else():
    zones = ZoneMask({"id": "c", "roi": [[0, 0], [0.5, 0], [0.5, 1], [0, 1]]}, W, H)
    out = zones.apply(colour_frame())
    assert (out[:, W - 10] == MASK_GREY).all()  # right side outside the area
    assert not (out[:, 10] == MASK_GREY).all()  # left side kept


def test_fire_only_ignore_zone_hides_welding_from_fire_but_not_people():
    cfg = {"id": "c", "ignore_zones": [{"name": "Welding bay", "events": ["fire"],
                                        "polygon": [[0.5, 0], [1, 0], [1, 1], [0.5, 1]]}]}
    zones = ZoneMask(cfg, W, H)
    frame = colour_frame()
    assert zones.apply(frame) is frame  # people detection sees everything
    fire = zones.apply(frame, "fire_smoke")
    assert (fire[:, W - 10] == MASK_GREY).all()


def test_person_check_dropped_inside_its_ignore_zone():
    cfg = {"id": "c", "ignore_zones": [{"name": "Rest area", "events": ["fall"],
                                        "polygon": [[0, 0.5], [1, 0.5], [1, 1], [0, 1]]}]}
    zones = ZoneMask(cfg, W, H)
    assert zones.ignored_at("fall", 0.5, 0.9) == "Rest area"
    assert zones.ignored_at("fall", 0.5, 0.2) is None
    assert zones.ignored_at("fight", 0.5, 0.9) is None


@pytest.mark.parametrize("cfg, message", [
    ({"roi": [[0, 0], [1, 1]]}, "at least 3"),
    ({"roi": [[0, 0], [2, 0], [1, 1]]}, "between 0 and 1"),
    ({"ignore_zones": [{"polygon": [[0, 0], [1, 0], [1, 1]], "events": ["dance"]}]}, "unknown checks"),
    ({"night_mode": "sometimes"}, "night_mode"),
])
def test_bad_zone_settings_are_explained(cfg, message):
    with pytest.raises(ValueError, match=message):
        ZoneMask({"id": "c", **cfg}, W, H)


def test_infrared_picture_is_recognised():
    gray = np.repeat(np.random.default_rng(2).integers(0, 255, (H, W, 1), dtype=np.uint8), 3, axis=2)
    assert is_grayscale(gray)
    assert not is_grayscale(colour_frame())


def fire(conf):
    return EventCandidate("fire_smoke", [], "c", raw_confidence=conf)


def test_night_modes():
    candidates = [fire(0.6), fire(0.8), EventCandidate("fall", [1], "c")]
    normal = ZoneMask({"id": "c"}, W, H).night_filter(candidates, night=True)
    assert len(normal) == 3 and normal[0].detail["night_picture"] is True
    strict = ZoneMask({"id": "c", "night_mode": "strict"}, W, H).night_filter(
        [fire(0.6), fire(0.8)], night=True)
    assert [c.raw_confidence for c in strict] == [0.8]
    off = ZoneMask({"id": "c", "night_mode": "off"}, W, H).night_filter(
        [fire(0.9), EventCandidate("fall", [1], "c")], night=True)
    assert [c.event_type for c in off] == ["fall"]
    day = ZoneMask({"id": "c", "night_mode": "off"}, W, H).night_filter([fire(0.9)], night=False)
    assert len(day) == 1


def test_per_camera_thresholds_override_thresholds_yaml():
    base = yaml.safe_load(open("config/thresholds.yaml", encoding="utf-8"))
    assert base["rules"]["crowd"]["person_count_threshold"] == 8
    gate = camera_thresholds(base, {"crowd_min_people": 20,
                                    "thresholds": {"fire_smoke_detection": {"incident_dedup_seconds": 120}}})
    assert gate["rules"]["crowd"]["person_count_threshold"] == 20
    assert gate["fire_smoke_detection"]["incident_dedup_seconds"] == 120
    assert gate["fire_smoke_detection"]["checkpoint"] == base["fire_smoke_detection"]["checkpoint"]
    assert base["rules"]["crowd"]["person_count_threshold"] == 8  # thresholds.yaml untouched


def test_draw_roi_prints_cameras_yaml():
    poly = normalise([(0, 0), (639, 0), (639, 479)], 640, 480)
    assert poly == [[0, 0], [1, 0], [1, 1]]
    roi = to_yaml([poly])
    assert roi == "    roi: [[0, 0], [1, 0], [1, 1]]"
    ignore = to_yaml([poly], ignore=True, name="Window", events=["fire_smoke"])
    parsed = yaml.safe_load("cam:\n" + ignore)["cam"]["ignore_zones"][0]
    assert parsed == {"name": "Window", "polygon": [[0, 0], [1, 0], [1, 1]], "events": ["fire_smoke"]}
    assert to_yaml([[[0, 0], [1, 1]]]) == ""
