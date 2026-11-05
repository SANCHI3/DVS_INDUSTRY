"""Check which DVR channels and streams this computer can read. READ-ONLY.

Reads DVR_* from perception-service/.env, then for each channel tries the main
and sub stream (RTSP over TCP, 10 s timeout) in the configured URL format and,
if that address does not exist, the other Hikvision format. Prints a table and
exits non-zero when no channel works. Passwords are never printed.

    cd perception-service
    python scripts/probe_dvr.py
    python scripts/probe_dvr.py --channels 1,2 --timeout 15 --no-decode

Hikvision locks a user out after several wrong passwords, so the probe stops
at the first "wrong username or password" instead of trying every channel.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from env_loader import load_env  # noqa: E402
from ingestion.dvr import FORMAT_FALLBACKS, STREAMS, DvrConfig, mask_text  # noqa: E402
from ingestion.rtsp_probe import (  # noqa: E402
    StreamResult, diagnose_unreachable, measure_stream, rtsp_describe, tcp_reachable,
)

REASONS = {
    "AUTH_FAILED": "auth failed",
    "NOT_FOUND": "not found",
    "TIMEOUT": "timeout",
    "REFUSED": "refused",
}


def parse_channels(text: str) -> list[int]:
    out: list[int] = []
    for part in text.split(","):
        part = part.strip()
        if "-" in part:
            lo, hi = part.split("-", 1)
            out.extend(range(int(lo), int(hi) + 1))
        elif part:
            out.append(int(part))
    return out


def probe_stream(cfg: DvrConfig, channel: int, stream: str, timeout_s: float, decode: bool,
                 describe=rtsp_describe, measure=measure_stream) -> StreamResult:
    result = StreamResult(channel, stream)
    formats = [cfg.url_format, *FORMAT_FALLBACKS[cfg.url_format]]
    for fmt in formats:
        result.tried.append(fmt)
        answer = describe(cfg, cfg.path(channel, stream, fmt), timeout_s)
        if answer.status == "NOT_FOUND":
            result.reason = REASONS["NOT_FOUND"]
            continue  # try the other address format
        result.url_format = fmt
        if answer.status != "OK":
            result.status = "FAIL"
            result.reason = REASONS.get(answer.status, answer.detail or "error")
            return result
        result.status, result.reason, result.codec = "OK", "", answer.codec
        if decode:
            info = measure(cfg.rtsp_url(channel, stream, fmt), timeout_s, cfg.password)
            if "error" in info:
                result.status, result.reason = "FAIL", f"opens but no picture: {info['error']}"
            else:
                result.codec = info.get("codec") or result.codec
                result.width, result.height, result.fps = info["width"], info["height"], info["fps"]
        return result
    return result


def plain_line(channel: int, results: list[StreamResult]) -> str:
    """One camera in plain words: "Camera 03: working, 704×576, 12 fps"."""
    ok = [r for r in results if r.ok]
    if not ok:
        reason = next((r.reason for r in results if r.reason), "")
        if "no picture" in reason:
            return f"Camera {channel:02d}: no picture (is a camera connected to this channel?)"
        return f"Camera {channel:02d}: not working ({reason or 'no answer'})"
    best = max(ok, key=lambda r: r.width * r.height)
    size = f", {best.width}×{best.height}" if best.width else ""
    rate = f", {best.fps:g} fps" if best.fps else ""
    return f"Camera {channel:02d}: working{size}{rate}"


def format_table(results: list[StreamResult]) -> str:
    rows = [("Ch", "Stream", "URL format", "Codec", "Resolution", "FPS", "Result")]
    for r in results:
        rows.append((
            str(r.channel), r.stream, r.url_format or "-", r.codec or "-",
            f"{r.width}x{r.height}" if r.width else "-", f"{r.fps:g}" if r.fps else "-",
            "OK" if r.ok else f"FAIL ({r.reason})",
        ))
    widths = [max(len(row[i]) for row in rows) for i in range(len(rows[0]))]
    lines = ["  ".join(cell.ljust(widths[i]) for i, cell in enumerate(row)) for row in rows]
    lines.insert(1, "  ".join("-" * w for w in widths))
    return "\n".join(lines)


def recommendation(results: list[StreamResult], configured: str) -> str:
    ok_formats = {r.url_format for r in results if r.ok}
    if not ok_formats:
        return ""
    if configured not in ok_formats:
        return f"Set DVR_URL_FORMAT={sorted(ok_formats)[0]} in perception-service/.env"
    return f"DVR_URL_FORMAT={configured} is correct."


def probe_json(cfg: DvrConfig, channels: list[int], timeout_s: float) -> int:
    def emit(**fields) -> None:
        print(json.dumps(fields), flush=True)

    if not tcp_reachable(cfg.host, cfg.rtsp_port, min(timeout_s, 5.0)):
        emit(kind="unreachable", message=f"Nothing answers at {cfg.host}. Press Find DVR, or check the "
                                         "DVR is switched on and its network cable is in.")
        return 1
    working: list[str] = []
    for channel in channels:
        results = []
        for stream in ("sub", "main"):
            r = probe_stream(cfg, channel, stream, timeout_s, True)
            results.append(r)
            if r.reason == REASONS["AUTH_FAILED"]:
                emit(kind="auth_failed", message="The DVR did not accept this username or password. "
                                                 "It locks after several wrong tries, so nothing more was tried.")
                return 1
        ok = [r for r in results if r.ok]
        working += [r.url_format for r in ok]
        emit(kind="camera", channel=channel, ok=bool(ok), line=plain_line(channel, results))
    if working:
        emit(kind="done", url_format=max(set(working), key=working.count))
    return 0 if working else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--channels", default="1-8", help="e.g. 1-8 or 1,3,5 (default 1-8)")
    parser.add_argument("--streams", default="main,sub", help="main,sub (default both)")
    parser.add_argument("--timeout", type=float, default=10.0, help="seconds per attempt (default 10)")
    parser.add_argument("--no-decode", action="store_true", help="only ask the DVR, do not read a frame")
    parser.add_argument("--json", action="store_true", help="one JSON line per camera, for the setup window")
    args = parser.parse_args(argv)

    load_env()
    try:
        cfg = DvrConfig.from_env()
    except ValueError as exc:
        print(f"Setup problem: {exc}")
        return 2
    if not cfg.username or not cfg.password:
        print("Setup problem: DVR_USERNAME and DVR_PASSWORD must be set in perception-service/.env")
        return 2

    if args.json:
        return probe_json(cfg, parse_channels(args.channels), args.timeout)

    print(f"DVR {cfg.host}  RTSP port {cfg.rtsp_port}  user {cfg.username}  format {cfg.url_format}  (TCP)")
    if not tcp_reachable(cfg.host, cfg.rtsp_port, min(args.timeout, 5.0)):
        print(f"FAIL: nothing answers at {cfg.host}:{cfg.rtsp_port}.")
        print(diagnose_unreachable(cfg.host))
        return 1

    streams = [s.strip() for s in args.streams.split(",") if s.strip() in STREAMS]
    results: list[StreamResult] = []
    for channel in parse_channels(args.channels):
        for stream in streams:
            r = probe_stream(cfg, channel, stream, args.timeout, not args.no_decode)
            results.append(r)
            print(f"  ch{channel} {stream}: {'OK' if r.ok else r.reason}", flush=True)
            if r.reason == REASONS["AUTH_FAILED"]:
                print("\nStopped: wrong DVR username or password. The DVR locks a user after several "
                      "wrong tries, so no more attempts were made. Check DVR_USERNAME/DVR_PASSWORD.")
                print("\n" + format_table(results))
                return 1

    print("\n" + format_table(results))
    working = sorted({r.channel for r in results if r.ok})
    print(f"\nWorking channels: {', '.join(map(str, working)) or 'none'}")
    advice = recommendation(results, cfg.url_format)
    if advice:
        print(advice)
    return 0 if working else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)
    except Exception as exc:  # never let a traceback print a URL with the password
        print(f"Probe failed: {mask_text(exc, (__import__('os').environ.get('DVR_PASSWORD') or ''))}")
        sys.exit(1)
