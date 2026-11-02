"""DVR settings, URL masking and the RTSP probe, without a real DVR."""
from __future__ import annotations

import ipaddress
import re
import socket
import threading

import pytest

from ingestion.dvr import DvrConfig, mask_text, mask_url
from ingestion.rtsp_probe import (
    DescribeResult, codec_from_sdp, diagnose_unreachable, digest_response, rtsp_describe,
)
from scripts.probe_dvr import format_table, parse_channels, probe_stream, recommendation

ENV = {"DVR_HOST": "192.168.0.139", "DVR_USERNAME": "viewer", "DVR_PASSWORD": "p@ss:w/rd"}


# ── settings and URLs ───────────────────────────────────────────────────────

def test_config_from_env_with_defaults():
    cfg = DvrConfig.from_env(ENV)
    assert (cfg.host, cfg.rtsp_port, cfg.http_port, cfg.url_format) == ("192.168.0.139", 554, 80, "hik_streaming")


def test_config_rejects_missing_host_and_bad_values():
    with pytest.raises(ValueError, match="DVR_HOST"):
        DvrConfig.from_env({})
    with pytest.raises(ValueError, match="DVR_RTSP_PORT"):
        DvrConfig.from_env({**ENV, "DVR_RTSP_PORT": "abc"})
    with pytest.raises(ValueError, match="DVR_URL_FORMAT"):
        DvrConfig.from_env({**ENV, "DVR_URL_FORMAT": "dahua"})


def test_hikvision_paths_for_both_formats():
    cfg = DvrConfig.from_env(ENV)
    assert cfg.path(1, "main") == "/Streaming/Channels/101"
    assert cfg.path(8, "sub") == "/Streaming/Channels/802"
    assert cfg.path(3, "main", "hik_h264") == "/h264/ch3/main/av_stream"
    assert cfg.path(3, "sub", "hik_h264") == "/h264/ch3/sub/av_stream"


def test_url_escapes_credentials_and_relay_port():
    cfg = DvrConfig.from_env({**ENV, "DVR_HOST": "factory-pc", "DVR_RTSP_PORT": "8554"})
    url = cfg.rtsp_url(2, "sub")
    assert url == "rtsp://viewer:p%40ss%3Aw%2Frd@factory-pc:8554/Streaming/Channels/202"
    assert cfg.rtsp_url(2, "sub", with_credentials=False) == "rtsp://factory-pc:8554/Streaming/Channels/202"


def test_mask_url_hides_password():
    cfg = DvrConfig.from_env(ENV)
    masked = mask_url(cfg.rtsp_url(1, "main"))
    assert masked == "rtsp://viewer:***@192.168.0.139:554/Streaming/Channels/101"
    assert "p%40ss" not in masked and "p@ss" not in masked
    assert mask_url("rtsp://192.168.0.139:554/x") == "rtsp://192.168.0.139:554/x"


def test_mask_text_hides_urls_and_secrets_inside_error_messages():
    error = "[rtsp @ 0x1] method DESCRIBE failed: rtsp://viewer:p%40ss%3Aw%2Frd@192.168.0.139:554/a 401"
    assert "p%40ss" not in mask_text(error)
    assert "viewer:***@192.168.0.139" in mask_text(error)
    assert mask_text("login p@ss:w/rd rejected", "p@ss:w/rd") == "login *** rejected"


# ── RTSP DESCRIBE against a fake DVR ────────────────────────────────────────

class FakeDvr:
    """Answers RTSP DESCRIBE like a Hikvision DVR: Digest challenge, then SDP."""

    def __init__(self, password: str = "p@ss:w/rd", streams: tuple[str, ...] = ("/Streaming/Channels/101",)):
        self.password, self.streams = password, streams
        self.server = socket.socket()
        self.server.bind(("127.0.0.1", 0))
        self.server.listen()
        self.port = self.server.getsockname()[1]
        threading.Thread(target=self._serve, daemon=True).start()

    def _serve(self):
        while True:
            try:
                conn, _ = self.server.accept()
            except OSError:
                return
            with conn:
                while True:
                    data = conn.recv(4096).decode()
                    if not data:
                        break
                    line = data.split("\r\n")[0]
                    uri = line.split(" ")[1]
                    path = "/" + uri.split("/", 3)[3]
                    cseq = re.search(r"CSeq: (\d+)", data).group(1)
                    auth = re.search(r'response="(\w+)"', data)
                    expected = digest_response("viewer", self.password, "Hik", "abc123", "DESCRIBE", uri)
                    if not auth:
                        conn.sendall(f'RTSP/1.0 401 Unauthorized\r\nCSeq: {cseq}\r\n'
                                     f'WWW-Authenticate: Digest realm="Hik", nonce="abc123", stale="FALSE"\r\n'
                                     f'WWW-Authenticate: Basic realm="Hik"\r\n\r\n'.encode())
                    elif auth.group(1) != expected:
                        conn.sendall(f"RTSP/1.0 401 Unauthorized\r\nCSeq: {cseq}\r\n\r\n".encode())
                    elif path not in self.streams:
                        conn.sendall(f"RTSP/1.0 404 Not Found\r\nCSeq: {cseq}\r\n\r\n".encode())
                    else:
                        sdp = "v=0\r\nm=video 0 RTP/AVP 96\r\na=rtpmap:96 H264/90000\r\n"
                        conn.sendall(f"RTSP/1.0 200 OK\r\nCSeq: {cseq}\r\nContent-Type: application/sdp\r\n"
                                     f"Content-Length: {len(sdp)}\r\n\r\n{sdp}".encode())

    def config(self, password: str = "p@ss:w/rd") -> DvrConfig:
        return DvrConfig(host="127.0.0.1", rtsp_port=self.port, username="viewer", password=password)

    def close(self):
        self.server.close()


@pytest.fixture
def dvr():
    fake = FakeDvr()
    yield fake
    fake.close()


def test_describe_logs_in_with_digest_and_reads_the_codec(dvr):
    result = rtsp_describe(dvr.config(), "/Streaming/Channels/101", timeout_s=3)
    assert result == DescribeResult("OK", "", "H264")


def test_describe_reports_wrong_password(dvr):
    assert rtsp_describe(dvr.config("wrong"), "/Streaming/Channels/101", timeout_s=3).status == "AUTH_FAILED"


def test_describe_reports_missing_stream(dvr):
    assert rtsp_describe(dvr.config(), "/Streaming/Channels/901", timeout_s=3).status == "NOT_FOUND"


def test_describe_reports_refused_port():
    probe = socket.socket()
    probe.bind(("127.0.0.1", 0))
    port = probe.getsockname()[1]
    probe.close()  # nothing listens here now
    cfg = DvrConfig(host="127.0.0.1", rtsp_port=port, username="u", password="p")
    assert rtsp_describe(cfg, "/x", timeout_s=2).status in ("REFUSED", "TIMEOUT", "ERROR")


def test_codec_from_sdp():
    assert codec_from_sdp("m=video 0 RTP/AVP 96\r\na=rtpmap:96 H264/90000") == "H264"
    assert codec_from_sdp("") == ""


# ── probe logic ─────────────────────────────────────────────────────────────

def test_probe_falls_back_to_the_old_address_format():
    cfg = DvrConfig.from_env(ENV)

    def describe(_cfg, path, _timeout):
        return DescribeResult("OK", codec="H264") if path.startswith("/h264/") else DescribeResult("NOT_FOUND")

    def measure(url, _timeout, _password):
        assert "/h264/ch2/sub/" in url
        return {"width": 704, "height": 576, "fps": 25.0}

    r = probe_stream(cfg, 2, "sub", 5, True, describe, measure)
    assert (r.status, r.url_format, r.codec, r.width, r.height, r.fps) == ("OK", "hik_h264", "H264", 704, 576, 25.0)
    assert r.tried == ["hik_streaming", "hik_h264"]
    assert recommendation([r], "hik_streaming") == "Set DVR_URL_FORMAT=hik_h264 in perception-service/.env"


def test_probe_reports_auth_failure_without_trying_other_formats():
    calls: list[str] = []

    def describe(_cfg, path, _timeout):
        calls.append(path)
        return DescribeResult("AUTH_FAILED")

    r = probe_stream(DvrConfig.from_env(ENV), 1, "main", 5, True, describe)
    assert r.reason == "auth failed" and len(calls) == 1


def test_table_and_channel_parsing():
    assert parse_channels("1-3,5") == [1, 2, 3, 5]
    cfg = DvrConfig.from_env(ENV)
    ok = probe_stream(cfg, 1, "sub", 5, True, lambda *_: DescribeResult("OK", codec="H264"),
                      lambda *_: {"width": 352, "height": 288, "fps": 12.5})
    table = format_table([ok])
    assert "352x288" in table and "12.5" in table and "OK" in table
    assert "p@ss" not in table


# ── network diagnosis ───────────────────────────────────────────────────────

def test_diagnose_detects_a_home_network_clash_with_tailscale():
    nets = [ipaddress.IPv4Interface("192.168.0.20/24"), ipaddress.IPv4Interface("100.101.1.2/32")]
    assert "4via6" in diagnose_unreachable("192.168.0.139", nets)


def test_diagnose_off_site_without_tailscale():
    nets = [ipaddress.IPv4Interface("192.168.31.2/24")]
    assert "factory PC" in diagnose_unreachable("192.168.0.139", nets)
