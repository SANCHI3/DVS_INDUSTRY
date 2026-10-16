"""
Turns raw rule/model event candidates into a confidence tier
(CONFIRMED / PROBABLE / LOW_CONFIDENCE) by requiring persistence across
multiple evaluation windows, per the design doc's event-confirmation
mechanism (design doc section 6). This is what prevents a single noisy
frame from becoming an incident report.

Keyed by (camera_id, event_type, primary_track_id) so that, e.g., two
different people who fall are tracked as separate candidate "streaks"
rather than one blended signal.
"""
from __future__ import annotations

import time
from collections import deque
from dataclasses import dataclass, field
from typing import Deque, Dict, Optional, Tuple

from temporal.rule_engine import EventCandidate

Tier = str  # "CONFIRMED" | "PROBABLE" | "LOW_CONFIDENCE"
TIER_RANK = {"LOW_CONFIDENCE": 0, "PROBABLE": 1, "CONFIRMED": 2}


@dataclass
class ConfirmationState:
    hits: Deque[bool] = field(default_factory=lambda: deque(maxlen=20))
    first_fired_at: Optional[float] = None
    last_fired_at: Optional[float] = None
    last_candidate: Optional[EventCandidate] = None
    reported_tier: Optional["Tier"] = None      # highest tier already reported for this ongoing episode
    consecutive_misses: int = 0                 # used to detect "this episode has actually ended"


@dataclass
class ConfirmedEvent:
    event_type: str
    camera_id: str
    tier: Tier
    confidence: float
    duration_s: float
    candidate: EventCandidate


class EventConfirmation:
    def __init__(self, confirmation_cfg: dict):
        self.cfg = confirmation_cfg
        self._states: Dict[Tuple[str, str, int], ConfirmationState] = {}

    def _cfg_for(self, event_type: str) -> dict:
        return self.cfg.get(event_type, self.cfg["default"])

    # Event types that describe a group/zone-level condition rather than a
    # specific individual -- keying these by track_ids[0] would spawn a "new"
    # episode every time group membership shifts (someone joins/leaves),
    # even though it's really the same ongoing crowd. Keyed by camera+type only.
    # A fight can cause frequent ByteTrack ID switches and several nearby
    # candidate pairs. Treat it as one camera-level episode for alerting; the
    # candidate still carries the currently relevant track IDs as evidence.
    AGGREGATE_EVENT_TYPES = {"crowd", "fight", "fire_smoke"}

    def _key(self, candidate: EventCandidate) -> Tuple[str, str, int]:
        if candidate.event_type in self.AGGREGATE_EVENT_TYPES:
            return (candidate.camera_id, candidate.event_type, -1)
        primary_track = candidate.track_ids[0] if candidate.track_ids else -1
        return (candidate.camera_id, candidate.event_type, primary_track)

    # number of consecutive misses after which an ongoing episode is considered
    # "over" -- a later re-trigger will then be treated as a genuinely new
    # incident (re-reported) rather than being suppressed as a duplicate.
    EPISODE_END_AFTER_MISSES = 5

    def update(self, candidates_this_cycle: list) -> list:
        """Call once per evaluation cycle with the full list of candidates
        the rule engine / action-recognition module produced *this cycle*.

        Returns only *new* tier reports: an event is reported once when it
        first reaches PROBABLE, and again once (if) it escalates to
        CONFIRMED -- NOT every single cycle it continues to hold that tier.
        This is the de-duplication behavior described in the design doc
        (section 13): "if the same event type keeps re-triggering for the
        same track/zone within a short window, update the existing incident
        rather than spamming new ones." A crowd that stays for 30 seconds
        should produce one incident, not one per processing cycle.
        """
        fired_keys = set()
        results = []

        for candidate in candidates_this_cycle:
            key = self._key(candidate)
            fired_keys.add(key)
            state = self._states.setdefault(key, ConfirmationState())
            state.hits.append(True)
            state.consecutive_misses = 0
            state.last_candidate = candidate
            now = time.time()
            if state.first_fired_at is None:
                state.first_fired_at = now
            state.last_fired_at = now

            tier = self._compute_tier(candidate.event_type, state)
            is_new_or_escalated = (
                tier is not None
                and (
                    state.reported_tier is None
                    or TIER_RANK[tier] > TIER_RANK[state.reported_tier]
                )
            )
            if is_new_or_escalated:
                # Never emit a tier downgrade during one active episode.
                results.append(ConfirmedEvent(
                    event_type=candidate.event_type,
                    camera_id=candidate.camera_id,
                    tier=tier,
                    confidence=candidate.raw_confidence,
                    duration_s=round(now - state.first_fired_at, 1),
                    candidate=candidate,
                ))
                state.reported_tier = tier

        # record misses for tracked keys that didn't fire this cycle (keeps
        # the persistence window honest about intermittent signals)
        for key, state in self._states.items():
            if key not in fired_keys:
                state.hits.append(False)
                state.consecutive_misses += 1
                if state.consecutive_misses >= self.EPISODE_END_AFTER_MISSES:
                    # the event has genuinely stopped -- reset so a future
                    # re-trigger is treated as a new episode, not a duplicate
                    state.reported_tier = None
                    state.first_fired_at = None

        # evict keys with no positive hit in their whole window and no recent activity
        stale_cutoff = time.time() - 60
        to_delete = [k for k, s in self._states.items()
                     if (not any(s.hits)) and (s.last_fired_at or 0) < stale_cutoff]
        for k in to_delete:
            del self._states[k]

        return results

    def _compute_tier(self, event_type: str, state: ConfirmationState) -> Optional[Tier]:
        # Expensive model modules may already apply persistence over actual
        # model evaluations. Respect their requested tier so pipeline cycles
        # between inference calls do not count as model misses.
        requested_tier = (
            state.last_candidate.detail.get("requested_tier")
            if state.last_candidate is not None
            else None
        )
        if requested_tier in {"PROBABLE", "CONFIRMED"}:
            return requested_tier

        cfg = self._cfg_for(event_type)

        window = list(state.hits)[-cfg["confirmed_window"]:]
        if sum(window) >= cfg["confirmed_hits"]:
            return "CONFIRMED"

        window = list(state.hits)[-cfg["probable_window"]:]
        if sum(window) >= cfg["probable_hits"]:
            return "PROBABLE"

        if any(state.hits):
            return "LOW_CONFIDENCE"

        return None
