"""Tests for camera-level incident de-duplication (no camera, GPU or YOLO needed).

Run:  python test_incident_dedup.py      (or: pytest test_incident_dedup.py)
"""
from unittest import mock

from confirmation.event_confirmation import ConfirmedEvent
from confirmation.incident_dedup import IncidentDeduper
from temporal.rule_engine import EventCandidate


def _event(event_type, tier="CONFIRMED", tracks=(1, 2), zone_id=None):
    candidate = EventCandidate(
        event_type=event_type, camera_id="CAM-01", track_ids=list(tracks),
        raw_confidence=0.9, zone_id=zone_id,
    )
    return ConfirmedEvent(event_type, "CAM-01", tier, 0.9, 0.0, candidate)


class _Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


def _run(fn):
    clock = _Clock()
    with mock.patch("confirmation.incident_dedup.time.time", clock):
        fn(clock)


def test_one_fight_with_id_switches_is_one_incident():
    def body(clock):
        d = IncidentDeduper({"window_seconds": 60})
        first = _event("fight", tracks=(1, 2))
        assert d.check(first, "MEDIUM") == ("new", None)
        d.register(first, "MEDIUM", "INC-1")
        # the fight keeps re-confirming every few seconds with new track IDs
        for i in range(20):
            clock.t += 3
            ev = _event("fight", tracks=(10 + i, 11 + i))
            d.touch([ev.candidate])
            assert d.check(ev, "MEDIUM") == ("suppress", "INC-1")
    _run(body)


def test_escalation_updates_existing_incident():
    def body(clock):
        d = IncidentDeduper({})
        probable = _event("fire_smoke", tier="PROBABLE")
        d.register(probable, "MEDIUM", "INC-1")
        clock.t += 5
        assert d.check(_event("fire_smoke", tier="CONFIRMED"), "MEDIUM") == ("escalate", "INC-1")
        clock.t += 5
        assert d.check(_event("fire_smoke", tier="PROBABLE"), "MEDIUM") == ("suppress", "INC-1")
    _run(body)


def test_new_incident_after_quiet_window():
    def body(clock):
        d = IncidentDeduper({"window_seconds": 60, "cooldown_seconds": 0})
        ev = _event("fight")
        d.register(ev, "MEDIUM", "INC-1")
        clock.t += 61
        assert d.check(_event("fight"), "MEDIUM") == ("new", None)
    _run(body)


def test_ongoing_detection_keeps_incident_open_past_window():
    def body(clock):
        d = IncidentDeduper({"window_seconds": 60})
        ev = _event("fight")
        d.register(ev, "MEDIUM", "INC-1")
        for _ in range(10):       # 100 s of continuous raw candidates
            clock.t += 10
            d.touch([_event("fight").candidate])
        assert d.check(_event("fight"), "MEDIUM") == ("suppress", "INC-1")
    _run(body)


def test_one_incident_per_camera_and_type_and_types_are_independent():
    def body(clock):
        d = IncidentDeduper({})
        d.register(_event("crowd", tracks=(3,), zone_id="canteen"), "LOW", "INC-1")
        assert d.check(_event("crowd", tracks=(9,), zone_id="canteen"), "LOW") == ("suppress", "INC-1")
        assert d.check(_event("crowd", tracks=(9,), zone_id="gate"), "LOW") == ("suppress", "INC-1")
        assert d.check(_event("fight"), "MEDIUM") == ("new", None)
    _run(body)


def test_per_event_window_override():
    def body(clock):
        d = IncidentDeduper({"window_seconds": 60, "per_event_seconds": {"fall": 30}, "cooldown_seconds": 0})
        d.register(_event("fall", tracks=(1,)), "MEDIUM", "INC-1")
        clock.t += 31
        assert d.check(_event("fall", tracks=(1,)), "MEDIUM") == ("new", None)
    _run(body)


def test_serious_fall_escalates_the_same_incident():
    def body(clock):
        d = IncidentDeduper({"per_event_seconds": {"fall": 45}})
        d.register(_event("fall", tracks=(1,)), "MEDIUM", "INC-1")
        clock.t += 20
        # person still down: same CONFIRMED tier, but CRITICAL severity
        assert d.check(_event("fall", tracks=(1,)), "CRITICAL") == ("escalate", "INC-1")
        assert d.check(_event("fall", tracks=(1,)), "MEDIUM") == ("suppress", "INC-1")
    _run(body)


def test_meaningful_confidence_rise_escalates_small_wobble_does_not():
    def body(clock):
        d = IncidentDeduper({"confidence_step": 0.05})
        first = _event("fight")
        first.confidence = 0.86
        d.register(first, "HIGH", "INC-1")
        wobble = _event("fight")
        wobble.confidence = 0.88
        assert d.check(wobble, "HIGH") == ("suppress", "INC-1")
        surer = _event("fight")
        surer.confidence = 0.99
        assert d.check(surer, "HIGH") == ("escalate", "INC-1")
        assert d.check(surer, "HIGH") == ("suppress", "INC-1")  # already reported
    _run(body)


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print(f"PASS {name}")


def test_same_event_within_cooldown_is_counted_not_new():
    def body(clock):
        d = IncidentDeduper({"window_seconds": 60, "cooldown_seconds": 600})
        d.register(_event("fire_smoke"), "HIGH", "INC-1")
        clock.t += 300  # quiet for 5 minutes, then seen again
        assert d.check(_event("fire_smoke"), "HIGH") == ("repeat", "INC-1")
        clock.t += 5   # still going: the reopened incident is active again
        assert d.check(_event("fire_smoke"), "HIGH") == ("suppress", "INC-1")
    _run(body)


def test_after_the_cooldown_a_new_incident_opens():
    def body(clock):
        d = IncidentDeduper({"window_seconds": 60, "cooldown_seconds": 600})
        d.register(_event("fight"), "MEDIUM", "INC-1")
        clock.t += 61 + 600
        assert d.check(_event("fight"), "MEDIUM") == ("new", None)
    _run(body)


def test_a_more_certain_repeat_escalates_instead():
    def body(clock):
        d = IncidentDeduper({"window_seconds": 60, "cooldown_seconds": 600})
        d.register(_event("fight", tier="PROBABLE"), "MEDIUM", "INC-1")
        clock.t += 120
        assert d.check(_event("fight", tier="CONFIRMED"), "MEDIUM") == ("escalate", "INC-1")
    _run(body)


def test_136_open_incidents_problem_one_incident_per_10_minutes():
    """A flickering detection every 2 minutes for an hour used to open 30 incidents."""
    def body(clock):
        d = IncidentDeduper({"window_seconds": 60, "cooldown_seconds": 600})
        opened = 0
        for _ in range(30):
            action, _ = d.check(_event("crowd"), "LOW")
            if action == "new":
                opened += 1
                d.register(_event("crowd"), "LOW", f"INC-{opened}")
            clock.t += 120
        assert opened == 1
    _run(body)
