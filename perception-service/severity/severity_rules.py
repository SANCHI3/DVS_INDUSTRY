"""
Deterministic, explainable severity scoring -- deliberately NOT a learned
model, so it stays auditable for a security context (design doc section 7).

`hard_cap` in thresholds.yaml enforces the policy decision that certain
event types (theft_probable, suspicious_activity) can never be escalated
past a capped severity by the AI alone, regardless of confidence or
duration -- a human must make that call.
"""
from __future__ import annotations

SEVERITY_ORDER = ["LOW", "MEDIUM", "HIGH", "CRITICAL"]


def _clamp(level: str, cap: str) -> str:
    return level if SEVERITY_ORDER.index(level) <= SEVERITY_ORDER.index(cap) else cap


def _bump(level: str, steps: int) -> str:
    idx = min(SEVERITY_ORDER.index(level) + steps, len(SEVERITY_ORDER) - 1)
    return SEVERITY_ORDER[idx]


def compute_severity(event_type: str, confirmed_event, severity_cfg: dict) -> str:
    base = severity_cfg["base"].get(event_type, "LOW")
    level = base

    detail = confirmed_event.candidate.detail
    duration = confirmed_event.duration_s

    # a few simple, explainable modifiers -- extend per event type as needed
    if event_type == "fall":
        # person still on the ground long after the fall -> possible injury
        if duration >= detail.get("still_seconds", 8) * 1.5 or detail.get("still_seconds", 0) >= 10:
            level = _bump(level, 1)
        # still down well after the fall (not getting up) -> possible injury
        if detail.get("serious"):
            level = "CRITICAL"
    elif event_type == "crowd":
        overflow = detail.get("count", 0) - detail.get("threshold", 0)
        if overflow >= 5:
            level = _bump(level, 1)
    elif event_type == "loitering":
        if detail.get("dwell_seconds", 0) > 60:
            level = _bump(level, 1)
    elif event_type == "intrusion":
        if detail.get("zone_type") == "restricted" and confirmed_event.tier == "CONFIRMED":
            level = _bump(level, 1)
    elif event_type == "fight":
        # sustained signal (long duration above threshold) or a high score
        # bumps severity; still deterministic/explainable, no learned scoring here
        if duration >= 5.0 or detail.get("score", 0) >= 0.85:
            level = _bump(level, 1)
    elif event_type == "anomaly":
        # unsupervised signal: only a strongly abnormal, confirmed scene is raised
        if detail.get("anomaly_ratio", 0) >= 2.5 and confirmed_event.tier == "CONFIRMED":
            level = _bump(level, 1)
    elif event_type == "fire_smoke":
        detected = set(detail.get("detected_classes", []))
        if {"fire", "smoke"}.issubset(detected) and confirmed_event.tier == "CONFIRMED":
            level = _bump(level, 1)

    cap = severity_cfg.get("hard_cap", {}).get(event_type)
    if cap:
        level = _clamp(level, cap)

    return level
