"""service.py: restart loop, masked rotating logs, direct vs Tailscale path."""
from __future__ import annotations

import ipaddress
import logging

import service


def test_run_restarts_after_a_crash_with_growing_delays(monkeypatch):
    codes = iter([1, 1, 1])
    delays = []
    monkeypatch.setattr(service, "setup_logging", lambda: None)
    monkeypatch.setattr(service, "load_env", lambda: None)

    def sleep(seconds):
        delays.append(seconds)
        if len(delays) == 3:
            raise KeyboardInterrupt

    monkeypatch.setattr(service.time, "sleep", sleep)
    assert service.run([], restart_delays=(5, 15, 30), launch=lambda: next(codes)) == 0
    assert delays == [5, 15, 30]


def test_log_lines_are_masked_and_rotated_daily(tmp_path, monkeypatch):
    monkeypatch.setenv("DVR_PASSWORD", "S3cret!")
    logger = logging.getLogger("perception")
    for h in list(logger.handlers):
        logger.removeHandler(h)
    import sys
    old = sys.stdout, sys.stderr
    try:
        service.setup_logging(tmp_path)
        print("[dvr-ch1] could not open rtsp://viewer:S3cret!@192.168.0.139:554/Streaming/Channels/102")
        sys.stdout.flush()
    finally:
        sys.stdout, sys.stderr = old
    handler = logger.handlers[0]
    assert handler.when == "MIDNIGHT" and handler.backupCount == 14
    handler.flush()
    text = (tmp_path / "perception.log").read_text(encoding="utf-8")
    assert "viewer:***@192.168.0.139" in text and "S3cret" not in text
    logger.removeHandler(handler)
    handler.close()


def test_connection_path_direct_or_tailscale():
    lan = [ipaddress.IPv4Interface("192.168.0.20/24")]
    assert service.connection_path("192.168.0.139", lan) == "direct"
    remote = [ipaddress.IPv4Interface("192.168.31.2/24"), ipaddress.IPv4Interface("100.114.81.42/32")]
    assert service.connection_path("192.168.0.139", remote) == "tailscale"
    assert service.connection_path("100.101.102.103", remote) == "tailscale"  # relay on the factory PC
    assert service.connection_path("192.168.0.139", [ipaddress.IPv4Interface("10.0.0.5/24")]) == "unknown"
