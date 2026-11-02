"""
Camera-level incident de-duplication, applied after EventConfirmation.

EventConfirmation ends an episode after a handful of missed cycles (well under
a second at 10 fps). Learned detectors only score some cycles and ByteTrack
re-assigns IDs during fast motion, so one real fight or one ongoing fire
would otherwise surface as a stream of "new" incidents a few seconds apart.

This layer keys an ongoing incident by event type for the camera and
keeps it open while raw candidates for that key keep arriving. Repeats inside
the window update the existing incident (escalation) or are suppressed; a new
incident is only created once the key has been quiet for the whole window.

Cooldown: the same event type on the same camera again within
`cooldown_seconds` (default 10 minutes) of the last activity is a "repeat":
it is counted on the existing incident instead of opening a new one.
"""
from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Dict, Optional, Tuple

from confirmation.event_confirmation import TIER_RANK
from severity.severity_rules import SEVERITY_ORDER

# One ongoing incident per camera + event type.
Key = str


@dataclass
class ActiveIncident:
    incident_id: str
    tier: str
    severity: str
    confidence: float
    last_activity_at: float
    repeats: int = 0


class IncidentDeduper:
    def __init__(self, cfg: Optional[dict] = None):
        cfg = cfg or {}
        self.default_window = float(cfg.get("window_seconds", 60.0))
        # A repeat whose confidence beats the reported one by at least this
        # much updates the open incident (so the ERP and priority alerts see
        # the detection getting more certain); smaller wobbles are suppressed.
        self.confidence_step = float(cfg.get("confidence_step", 0.05))
        self.windows: Dict[str, float] = {
            k: float(v) for k, v in (cfg.get("per_event_seconds") or {}).items()
        }
        self.cooldown = float(cfg.get("cooldown_seconds", 600.0))
        self._active: Dict[Key, ActiveIncident] = {}
        # incidents whose window ended, kept for the cooldown
        self._recent: Dict[Key, ActiveIncident] = {}

    @staticmethod
    def _key(event_type: str) -> Key:
        return event_type

    def _window(self, event_type: str) -> float:
        return self.windows.get(event_type, self.default_window)

    def _live(self, key: Key, now: float) -> Optional[ActiveIncident]:
        active = self._active.get(key)
        if active is None:
            return None
        if now - active.last_activity_at > self._window(key):
            self._recent[key] = self._active.pop(key)
            return None
        return active

    def touch(self, candidates: list) -> None:
        """Keep open incidents alive while their event keeps being detected."""
        now = time.time()
        for c in candidates:
            active = self._live(self._key(c.event_type), now)
            if active is not None:
                active.last_activity_at = now

    def check(self, event, severity: str) -> Tuple[str, Optional[str]]:
        """Return ("new" | "escalate" | "suppress" | "repeat", incident_id or None).

        A repeat escalates the open incident when it raises the confidence
        tier, the severity (e.g. a fall where the person stays down), or the
        confidence score by at least `confidence_step`. After the window, the
        same event within the cooldown is a "repeat" of the last incident."""
        key = self._key(event.event_type)
        now = time.time()
        active = self._live(key, now)
        if active is None:
            recent = self._recent.get(key)
            if recent is None or self.cooldown <= 0 or now - recent.last_activity_at > self.cooldown:
                self._recent.pop(key, None)
                return "new", None
            # back within the cooldown: reopen the same incident
            del self._recent[key]
            self._active[key] = recent
            recent.last_activity_at = now
            if TIER_RANK[event.tier] > TIER_RANK[recent.tier] or (
                    SEVERITY_ORDER.index(severity) > SEVERITY_ORDER.index(recent.severity)):
                recent.tier = max(recent.tier, event.tier, key=TIER_RANK.__getitem__)
                recent.severity = max(recent.severity, severity, key=SEVERITY_ORDER.index)
                recent.confidence = max(recent.confidence, event.confidence)
                return "escalate", recent.incident_id
            recent.repeats += 1
            return "repeat", recent.incident_id
        higher_tier = TIER_RANK[event.tier] > TIER_RANK[active.tier]
        higher_severity = SEVERITY_ORDER.index(severity) > SEVERITY_ORDER.index(active.severity)
        higher_confidence = event.confidence >= active.confidence + self.confidence_step
        if higher_tier or higher_severity or higher_confidence:
            active.tier = max(active.tier, event.tier, key=TIER_RANK.__getitem__)
            active.severity = max(active.severity, severity, key=SEVERITY_ORDER.index)
            active.confidence = max(active.confidence, event.confidence)
            return "escalate", active.incident_id
        return "suppress", active.incident_id

    def register(self, event, severity: str, incident_id: str) -> None:
        key = self._key(event.event_type)
        self._active[key] = ActiveIncident(
            incident_id, event.tier, severity, float(event.confidence), time.time()
        )
