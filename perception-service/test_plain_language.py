"""Plain-language incident text and the LLM summary guard (no network needed).

Run:  python test_plain_language.py      (or: pytest test_plain_language.py)
"""
from types import SimpleNamespace

from llm.summarizer import _JARGON, _summary_preserves_required_facts, canonical_summary
from reporting.description_generator import WHAT_HAPPENED, generate_description

SAMPLE_DETAIL = {
    "fall": {"mode": "pose_gru", "score": 0.83},  # no still_seconds: used to break the template
    "fire_smoke": {"detected_classes": ["fire"], "fire_score": 0.72},
    "crowd": {"count": 6, "threshold": 4},
    "fight": {"score": 0.97},
    "loitering": {"dwell_seconds": 41.6},
    "intrusion": {"zone_type": "restricted"},
    "anomaly": {"anomaly_ratio": 1.82, "factors": "sudden acceleration"},
    "theft_probable": {},
}


def test_every_event_is_plain_and_actionable():
    for event_type in WHAT_HAPPENED:
        text = generate_description(event_type, "Loading Bay", SAMPLE_DETAIL[event_type])
        assert "Loading Bay" in text, event_type
        assert "What to do:" in text, event_type
        assert not _JARGON.search(text), (event_type, text)
        for raw in ("0.83", "0.72", "0.97", "1.82", "score", "{"):
            assert raw not in text, (event_type, text)


def test_fall_without_still_seconds_gets_a_real_description():
    text = generate_description("fall", "Test Room", {"mode": "pose_gru"})
    assert text.startswith("Someone appears to have fallen down in Test Room.")


def test_serious_fall_says_the_person_has_not_got_up():
    text = generate_description("fall", "Test Room", {"serious": True, "down_seconds": 20.4})
    assert "has not got up for about 20 seconds" in text


def test_unknown_event_type_falls_back_gracefully():
    text = generate_description("ppe_violation", "Gate 2", {})
    assert "Gate 2" in text and "What to do:" in text


def _record(event_type="loitering", detail=None):
    return SimpleNamespace(location="Test Room", event_type=event_type, severity="LOW",
                           detail=detail if detail is not None else {"dwell_seconds": 41.6})


def test_guard_accepts_a_faithful_plain_rewrite():
    good = ("Someone has been standing in the same spot in Test Room for about 42 seconds. "
            "Please check the camera to see who it is.")
    assert _summary_preserves_required_facts(good, _record())


def test_guard_rejects_invented_numbers_jargon_and_missing_location():
    invented = "Three people have been standing in Test Room for 5 minutes. Check the camera."
    jargon = "Loitering detected in Test Room with high confidence. Check the camera."
    no_place = "Someone has been standing around for about 42 seconds. Check the camera."
    record = _record()
    assert not _summary_preserves_required_facts(invented.replace("Three", "3"), record)
    assert not _summary_preserves_required_facts(jargon, record)
    assert not _summary_preserves_required_facts(no_place, record)


def test_llm_fallback_is_the_plain_description():
    record = _record("fire_smoke", {"detected_classes": ["fire", "smoke"]})
    assert canonical_summary(record).startswith("Flames and smoke have been seen by the camera in Test Room.")


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print(f"PASS {name}")
