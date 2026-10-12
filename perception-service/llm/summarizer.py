from __future__ import annotations

import json
import os
import re
import sys
import urllib.request
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

from reporting.description_generator import generate_description
from schemas.incident_schema import IncidentRecord


class IncidentAnalysis(BaseModel):
    """Dashboard-safe LLM output: identity plus one concise summary only."""

    incident_id: str
    camera_id: str
    camera_location: str
    summary: str = Field(min_length=1, max_length=700)


SYSTEM_PROMPT = """You write safety alerts for factory staff who have no technical background.
They will read your text in a pop-up while doing other work, so it must be instantly clear.
Return JSON with exactly one field: {"summary": "..."}.
Write exactly two short sentences in plain, everyday English:
  Sentence 1: what seems to be happening and where, naming the location exactly once.
  Sentence 2: what to do now.
Never repeat information, and never add filler such as "The situation is in ...".
Use simple words. Never use technical terms such as model, score, threshold, confidence,
detection, tier, track, zone ID, anomaly ratio, percent, or camera ID.
Use the supplied plain_description as the only source of facts. Do not add facts, numbers,
names, causes, injuries or certainty that it does not state. Keep every uncertainty word it
uses ("appears to", "seem to", "may", "possible") so you never sound more certain than it is.
"""

# Words the summary must not contain: they would confuse a non-technical reader.
_JARGON = re.compile(
    r"\b(model|score|threshold|confidence|tier|anomaly ratio|track|zone id|camera id|"
    r"probable|confirmed|classifier|inference)\b",
    re.IGNORECASE,
)


def _present(value: Any) -> bool:
    return value is not None and str(value).strip() != ""


def canonical_summary(record: IncidentRecord) -> str:
    """The plain-language description the dashboard already shows: the LLM's
    only factual source, and the fallback when its text is rejected."""

    event_type = str(record.event_type).strip().lower().replace("-", "_")
    location = str(record.location).strip() if _present(record.location) else "the monitored area"
    return generate_description(event_type, location, dict(record.detail or {}))


def _facts(record: IncidentRecord) -> dict:
    """The only information the LLM sees: plain facts, no raw model scores."""

    return {
        "location": record.location,
        "event": str(record.event_type).replace("_", " "),
        "urgency": str(record.severity).lower(),
        "plain_description": canonical_summary(record),
    }


def build_payload(record: IncidentRecord) -> dict:
    facts = _facts(record)

    return {
        "model": os.getenv("LLM_MODEL", "gpt-4o-mini"),
        "response_format": {"type": "json_object"},
        "max_completion_tokens": 250,
        "reasoning_effort": "low",
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": (
                    "Write the alert JSON from these facts. "
                    "Do not echo anything except the JSON object.\n"
                    + json.dumps(facts, ensure_ascii=False, indent=2)
                ),
            },
        ],
    }


def _extract_json(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
        text = re.sub(r"\s*```$", "", text)
    return text.strip()


def _normalize_summary(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    text = re.sub(r"\s+", " ", value).strip()
    text = re.sub(r"^[\-*•]+\s*", "", text)
    if not text:
        return ""

    sentences = re.split(r"(?<=[.!?])\s+", text)
    text = " ".join(sentence for sentence in sentences[:3] if sentence).strip()
    return text


_NUMBER = re.compile(r"\d+(?:\.\d+)?")


def _summary_preserves_required_facts(summary: str, record: IncidentRecord) -> bool:
    """Reject model text that drops the location, adds jargon, or contains
    any number that is not in the plain description (no invented facts)."""

    if _present(record.location) and str(record.location).lower() not in summary.lower():
        return False
    if _JARGON.search(summary):
        return False
    allowed_numbers = set(_NUMBER.findall(json.dumps(_facts(record))))
    return set(_NUMBER.findall(summary)) <= allowed_numbers


def summarize_incident(record: IncidentRecord) -> IncidentAnalysis:
    fallback = canonical_summary(record)
    api_key = os.getenv("LLM_API_KEY")
    if not api_key:
        raise RuntimeError("LLM_API_KEY is not configured.")

    base_url = os.getenv("LLM_BASE_URL", "https://api.openai.com/v1").rstrip("/")
    payload = json.dumps(build_payload(record), ensure_ascii=False).encode("utf-8")

    request = urllib.request.Request(
        f"{base_url}/chat/completions",
        data=payload,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "industrial-safety-ai/1.0",
            "Authorization": f"Bearer {api_key}",
        },
    )

    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(request, timeout=60) as response:
        result = json.loads(response.read().decode("utf-8"))

    content = result["choices"][0]["message"].get("content") or ""
    try:
        raw = json.loads(_extract_json(content))
    except (json.JSONDecodeError, TypeError):
        raw = {}

    proposed = _normalize_summary(raw.get("summary") if isinstance(raw, dict) else None)
    summary = (
        proposed
        if proposed and _summary_preserves_required_facts(proposed, record)
        else fallback
    )

    return IncidentAnalysis(
        incident_id=record.incident_id,
        camera_id=record.camera_id,
        camera_location=record.location,
        summary=summary,
    )


def summary_output(record: IncidentRecord, analysis: IncidentAnalysis) -> dict:
    return {
        "incident_id": record.incident_id,
        "camera_id": record.camera_id,
        "camera_location": record.location,
        "llm_analysis": analysis.model_dump(mode="json"),
    }


def upsert_summary(output: dict, path: Path | None = None) -> None:
    """Atomically keep one summary row per incident ID."""

    target = path or Path("output/llm_summaries.jsonl")
    target.parent.mkdir(parents=True, exist_ok=True)

    rows: list[dict] = []
    if target.exists():
        for line in target.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if row.get("incident_id") != output.get("incident_id"):
                rows.append(row)

    rows.append(output)
    temporary = target.with_suffix(target.suffix + ".tmp")
    temporary.write_text(
        "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows),
        encoding="utf-8",
    )
    temporary.replace(target)


def latest_record() -> IncidentRecord:
    path = Path("output/incidents.jsonl")
    records = [
        line
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    if not records:
        raise RuntimeError("No incident records found.")
    return IncidentRecord.model_validate_json(records[-1])


if __name__ == "__main__":
    incident = latest_record()
    if "--dry-run" in sys.argv:
        print(json.dumps(build_payload(incident), ensure_ascii=False, indent=2))
    else:
        print(summarize_incident(incident).model_dump_json(indent=2))
