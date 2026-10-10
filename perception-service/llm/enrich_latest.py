from __future__ import annotations

import json

from llm.summarizer import (
    latest_record,
    summarize_incident,
    summary_output,
    upsert_summary,
)


def main() -> None:
    record = latest_record()
    analysis = summarize_incident(record)
    output = summary_output(record, analysis)
    upsert_summary(output)
    print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    from env_loader import load_env

    load_env()
    main()
