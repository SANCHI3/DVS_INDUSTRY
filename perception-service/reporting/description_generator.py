"""
Slot-filling description generator (design doc section 14). Deliberately
template-based rather than free-generative text -- deterministic, fast,
and safe from hallucinated facts in a report that may inform real
security decisions.
"""
from __future__ import annotations

TEMPLATES = {
    "fall": "A person was detected in {location}. The person subsequently fell "
            "and remained on the ground for approximately {still_seconds} seconds.",
    "intrusion": "A person entered the restricted zone '{zone_id}' in {location}.",
    "loitering": "A person remained in zone '{zone_id}' in {location} for "
                 "approximately {dwell_seconds} seconds, exceeding the normal dwell threshold.",
    "crowd": "A crowd of approximately {count} people gathered in {location}, "
             "exceeding the normal threshold of {threshold}.",
    "fight": "Two individuals were detected in close proximity showing sustained "
             "high-intensity movement in {location}. This is a probabilistic "
             "detection and should be verified by a human reviewer before action is taken.",
    "fire_smoke": "Possible fire or smoke was detected persistently in {location}. "
                  "Detected visual classes: {detected_classes}. This is an automated "
                  "camera-based alert and requires immediate human verification.",
    "anomaly": "Unusual activity was detected in {location}: the scene's motion pattern scored "
               "{anomaly_ratio}x the normal-behaviour alert threshold. Main factors: {factors}. "
               "The anomaly model was trained only on normal footage and cannot name the event; "
               "a human reviewer should identify it.",
    "theft_probable": "A possible object-removal event was detected near {location}. "
                       "This alert requires human verification and is not a confirmed "
                       "determination of theft.",
}

DEFAULT_TEMPLATE = "An event of type '{event_type}' was detected in {location}."

RECOMMENDED_ACTIONS = {
    "fall": "Dispatch personnel to check on the individual immediately.",
    "intrusion": "Notify security to verify authorization and investigate the area.",
    "loitering": "Review footage and dispatch personnel if the area requires monitoring.",
    "crowd": "Monitor for safety; consider dispatching personnel if the gathering grows or is near an exit.",
    "fight": "Dispatch security to verify in person before intervening; do not treat as confirmed without human review.",
    "fire_smoke": "Immediately verify the camera, activate the site emergency procedure if confirmed, and contact trained safety personnel.",
    "theft_probable": "Flag for human review of the footage before taking any action; do not treat as confirmed.",
    "anomaly": "Review the live feed and the saved clip; check for injury, equipment malfunction, spills or panic, then classify the incident.",
}
DEFAULT_ACTION = "Review incident footage and determine appropriate action."


def generate_description(event_type: str, location: str, detail: dict) -> str:
    template = TEMPLATES.get(event_type, DEFAULT_TEMPLATE)
    slots = {"event_type": event_type, "location": location, **detail}
    try:
        return template.format(**slots)
    except KeyError:
        # a required slot was missing from `detail` -- fall back rather than crash
        return DEFAULT_TEMPLATE.format(event_type=event_type, location=location)


def recommended_action(event_type: str) -> str:
    return RECOMMENDED_ACTIONS.get(event_type, DEFAULT_ACTION)
