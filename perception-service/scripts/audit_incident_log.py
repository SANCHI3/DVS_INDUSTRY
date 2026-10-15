"""READ-ONLY audit of the local incident log (output/incidents.jsonl).

Shows whether incidents were produced by the old or the new validation logic,
grouped by day, event type and camera. It never modifies or deletes anything.

    python scripts/audit_incident_log.py
    python scripts/audit_incident_log.py --log output/incidents.jsonl --since 2026-10-01

Records written before validation version 2 have no `detail.validation_version`
and are reported as "v1 (pre-fix)". Confidence values matching the old
fabricated formulas are flagged.
"""
from __future__ import annotations

import argparse
import json
import math
from collections import defaultdict
from pathlib import Path


def legacy_signature(event: str, confidence: float, detail: dict) -> str | None:
    if event == "loitering" and "dwell_seconds" in detail and "confidence_basis" not in detail:
        expected = min(0.5 + float(detail["dwell_seconds"]) / 40.0, 0.95)
        if abs(expected - confidence) < 0.02:
            return "old loitering formula 0.5 + dwell/40"
    if event == "anomaly" and "confidence_basis" not in detail and "anomaly_ratio" in detail:
        expected = 1.0 - math.exp(-float(detail["anomaly_ratio"]))
        if abs(expected - confidence) < 0.02:
            return "old anomaly formula 1 - exp(-ratio), uncalibrated threshold"
    if event == "crowd" and "confidence_basis" not in detail:
        return "old crowd formula 0.62 + overflow*0.07"
    return None


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--log", default="output/incidents.jsonl")
    parser.add_argument("--since", default=None, help="YYYY-MM-DD; only records on/after this day")
    args = parser.parse_args()

    path = Path(args.log)
    if not path.exists():
        print(f"{path} not found (no incidents recorded on this machine yet)")
        return

    groups = defaultdict(lambda: {"count": 0, "confidences": [], "legacy": 0, "tiers": defaultdict(int)})
    flagged, bad_lines = [], 0
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except ValueError:
                bad_lines += 1
                continue
            day = str(record.get("detected_at", ""))[:10]
            if args.since and day < args.since:
                continue
            detail = record.get("detail") or {}
            version = detail.get("validation_version")
            version_label = f"v{version}" if version else "v1 (pre-fix)"
            event = record.get("event_type", "?")
            confidence = float(record.get("confidence_score") or 0.0)
            key = (day, version_label, event, record.get("camera_id", "?"))
            group = groups[key]
            group["count"] += 1
            group["confidences"].append(confidence)
            group["tiers"][record.get("confidence_tier", "?")] += 1
            signature = None if version else legacy_signature(event, confidence, detail)
            if signature:
                group["legacy"] += 1
                flagged.append((record.get("incident_id"), record.get("detected_at"), event, confidence, signature))

    print("Read-only audit; nothing is modified.\n")
    print(f"{'day':<11} {'validation':<14} {'event':<12} {'camera':<10} {'n':>4}  {'conf range':<11} tiers")
    for (day, version, event, camera), group in sorted(groups.items()):
        confs = group["confidences"]
        tiers = ", ".join(f"{k}:{v}" for k, v in sorted(group["tiers"].items()))
        print(f"{day:<11} {version:<14} {event:<12} {camera:<10} {group['count']:>4}  "
              f"{min(confs):.2f}-{max(confs):.2f}   {tiers}")
    if flagged:
        print(f"\nRecords whose confidence matches a pre-fix formula ({len(flagged)}):")
        for row in flagged:
            print("  " + "  ".join(str(v) for v in row))
    if bad_lines:
        print(f"\n{bad_lines} unreadable line(s) skipped")


if __name__ == "__main__":
    main()
