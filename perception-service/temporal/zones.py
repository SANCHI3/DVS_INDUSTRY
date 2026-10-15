"""Zone helpers shared by the intrusion and loitering rules.

A zone in config/cameras.yaml can carry:
  type: restricted | loitering | ppe_required | crowd
  active_hours: "HH:MM-HH:MM"      (overnight ranges such as "22:00-06:00" work)
  loitering: true/false            (override whether loitering is checked here)
  loitering_seconds: <float>       (per-zone dwell threshold, else rules.loitering.dwell_seconds)
  name: <text>                     (shown in incident descriptions)
"""
from __future__ import annotations

from datetime import datetime
from typing import Iterable, List, Optional, Sequence, Tuple

LOITERING_ZONE_TYPES = {"restricted", "loitering"}


def _minutes(text: str) -> int:
    hours, minutes = text.strip().split(":")
    return int(hours) * 60 + int(minutes)


def zone_is_active(zone: dict, when: Optional[float] = None) -> bool:
    """True when `when` (epoch seconds, local time) falls inside the zone's
    active_hours. Zones without active_hours are always active; an
    unparseable value is treated as always active (and reported at start-up)."""
    window = zone.get("active_hours")
    if not window:
        return True
    try:
        start_text, end_text = str(window).split("-")
        start, end = _minutes(start_text), _minutes(end_text)
    except ValueError:
        return True
    moment = datetime.fromtimestamp(when) if when is not None else datetime.now()
    now = moment.hour * 60 + moment.minute
    if start <= end:
        return start <= now <= end
    return now >= start or now <= end  # overnight range


def loitering_zones(zones: Iterable[dict]) -> List[dict]:
    """Zones where staying too long is an incident: restricted/loitering zones,
    plus any zone that opts in with `loitering: true`; `loitering: false` opts out."""
    out = []
    for zone in zones:
        flag = zone.get("loitering")
        if flag is False:
            continue
        if flag is True or zone.get("type") in LOITERING_ZONE_TYPES:
            out.append(zone)
    return out


def zone_label(zone: dict) -> str:
    return str(zone.get("name") or zone.get("zone_id") or "zone")


def polygon_area(polygon: Sequence[Tuple[float, float]]) -> float:
    area = 0.0
    for i, (x1, y1) in enumerate(polygon):
        x2, y2 = polygon[(i + 1) % len(polygon)]
        area += x1 * y2 - x2 * y1
    return abs(area) / 2.0


def zone_warnings(zones: Iterable[dict], frame_w: int, frame_h: int,
                  large_fraction: float = 0.25) -> List[str]:
    """Start-up sanity checks. A restricted zone covering a large share of the
    view is usually a placeholder polygon (the example config marks the whole
    left third of the frame), and anyone who sits there produces alerts."""
    warnings = []
    frame_area = float(max(frame_w * frame_h, 1))
    for zone in zones:
        label = zone_label(zone)
        polygon = zone.get("polygon") or []
        if len(polygon) < 3:
            warnings.append(f"zone {label}: polygon has fewer than 3 points; it can never match")
            continue
        share = polygon_area(polygon) / frame_area
        if zone in loitering_zones([zone]) and share >= large_fraction:
            warnings.append(
                f"zone {label} ({zone.get('type')}) covers {share:.0%} of the camera view -- check that "
                f"the polygon outlines only the real restricted area, otherwise people working "
                f"normally inside it will raise lingering alerts")
        window = zone.get("active_hours")
        if window:
            try:
                start_text, end_text = str(window).split("-")
                _minutes(start_text), _minutes(end_text)
            except ValueError:
                warnings.append(f"zone {label}: active_hours '{window}' is not HH:MM-HH:MM; treated as always active")
    return warnings
