"""
Plain-language incident descriptions (design doc section 14).

Written for factory staff with no technical background: what is happening,
where, and what to do -- no model scores, thresholds or jargon. Deliberately
template-based rather than free-generative: deterministic, instant, and safe
from hallucinated facts. The optional LLM summary (llm/summarizer.py) may only
reword this text, and falls back to it.
"""
from __future__ import annotations

from typing import Callable, Dict

RECOMMENDED_ACTIONS = {
    "fall": "Send someone to check on the person right away.",
    "crowd": "Keep an eye on the group, and send staff if it keeps growing or blocks an exit.",
    "fight": "Send security to check. Confirm it in person before stepping in, because the camera can be wrong.",
    "fire_smoke": "Check the area immediately. If it is real, follow the fire emergency procedure and call the fire brigade.",
    "theft_probable": "Check the recording before taking any action, because this is not certain yet.",
    "anomaly": "Look at the live camera or the saved clip and decide what happened.",
}
DEFAULT_ACTION = "Look at the camera recording and decide what to do."


def _seconds(value) -> str:
    try:
        return f"about {int(round(float(value)))} seconds"
    except (TypeError, ValueError):
        return "a while"


def _fall(location: str, d: dict) -> str:
    if d.get("serious"):
        return (f"Someone fell in {location} and has not got up for "
                f"{_seconds(d.get('down_seconds'))}. They may be hurt.")
    return f"Someone appears to have fallen down in {location}."


def _fire_smoke(location: str, d: dict) -> str:
    seen = set(d.get("detected_classes") or [])
    if {"fire", "smoke"} <= seen:
        what = "Flames and smoke have"
    elif "smoke" in seen:
        what = "Smoke has"
    elif "fire" in seen:
        what = "Flames have"
    else:
        what = "Possible fire or smoke has"
    return f"{what} been seen by the camera in {location}."


def _crowd(location: str, d: dict) -> str:
    count = d.get("count")
    people = f"about {count} people" if count else "a group of people"
    return f"A crowd of {people} has gathered in {location}."


WHAT_HAPPENED: Dict[str, Callable[[str, dict], str]] = {
    "fall": _fall,
    "fire_smoke": _fire_smoke,
    "crowd": _crowd,
    "fight": lambda loc, d: (
        f"Possible fight in {loc}, please check the camera: the fight model fired, but the "
        "camera does not clearly show two people close together and moving roughly."
        if d.get("interaction_passed") is False
        else f"Two or more people in {loc} seem to be fighting or pushing each other."
    ),
    "anomaly": lambda loc, d: (f"The camera in {loc} picked up sudden, unusual movement that does "
                               "not look like normal activity, for example someone running, falling "
                               "or something being thrown. The system cannot tell exactly what it is."),
    "theft_probable": lambda loc, d: f"Something may have been taken from near {loc}.",
}


def what_happened(event_type: str, location: str, detail: dict) -> str:
    """One or two plain sentences describing the event, without advice."""
    builder = WHAT_HAPPENED.get(event_type)
    if builder is None:
        return f"The camera in {location} noticed something that needs checking."
    return builder(location, detail or {})


def generate_description(event_type: str, location: str, detail: dict) -> str:
    return f"{what_happened(event_type, location, detail)} What to do: {recommended_action(event_type)}"


def recommended_action(event_type: str) -> str:
    return RECOMMENDED_ACTIONS.get(event_type, DEFAULT_ACTION)
