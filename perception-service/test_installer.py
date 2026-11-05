"""The setup window's logic (the window itself needs a screen)."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "installer"))

import setup_core as core  # noqa: E402

FORM = {"DVR_HOST": "192.168.0.105", "DVR_USERNAME": "admin", "DVR_PASSWORD": 'p@ss#1"x',
        "DASHBOARD_BACKEND_URL": "https://dvs-industry-api.onrender.com",
        "DASHBOARD_SERVICE_KEY": "k" * 44}


def test_form_problems_are_in_plain_words():
    assert core.validate_form(FORM) is None
    assert "192.168.0.105" in core.validate_form({**FORM, "DVR_HOST": "dvr"})
    assert "password" in core.validate_form({**FORM, "DVR_PASSWORD": ""})
    assert "service key" in core.validate_form({**FORM, "DASHBOARD_SERVICE_KEY": "short"})


def test_env_round_trip_keeps_symbols_and_other_settings(tmp_path, monkeypatch):
    monkeypatch.setattr(core, "lock_to_this_user", lambda path: True)
    env = tmp_path / ".env"
    env.write_text("LIVE_VIEW_ENABLED=true\n", encoding="utf-8")
    core.write_env(FORM, env)
    saved = core.read_env(env)
    assert saved["DVR_PASSWORD"] == FORM["DVR_PASSWORD"]
    assert saved["LIVE_VIEW_ENABLED"] == "true"
    assert saved["DVR_MAC"] == core.DVR_MAC and saved["DVR_URL_FORMAT"] == "hik_streaming"

    from env_loader import load_env

    monkeypatch.delenv("DVR_PASSWORD", raising=False)
    load_env(env)  # the service reads back exactly what was typed
    import os
    assert os.environ["DVR_PASSWORD"] == FORM["DVR_PASSWORD"]
    monkeypatch.delenv("DVR_PASSWORD", raising=False)


def test_boot_task_needs_no_login_and_stores_no_password():
    xml = core.task_xml("S-1-5-21-1", Path(r"C:\dvs-cctv\python\python.exe"), Path(r"C:\dvs-cctv\app"))
    assert "<BootTrigger>" in xml and "<LogonType>S4U</LogonType>" in xml
    assert "<Priority>7</Priority>" in xml and "<RestartOnFailure>" in xml
    assert "Password" not in xml


def test_final_screen_and_counts():
    status = {"cameras": {"a": {"status": "ONLINE"}, "b": {"status": "OFFLINE"}}}
    assert core.cameras_online(status) == (1, 2)
    assert core.cameras_online(None) == (0, 0)
    assert core.final_message(8, 8).startswith("Done. Cameras online: 8/8.")
    assert "dvs-industry.vercel.app → AI Security → Cameras" in core.final_message(8, 8)


def test_public_address_comes_from_tailscale():
    assert core.public_url({"Self": {"DNSName": "DVSaccounts-server.tail12.ts.net."}}) == \
        "https://dvsaccounts-server.tail12.ts.net"
    assert core.public_url({}) is None


def test_sign_in_links_are_recognised():
    line = "To authenticate, visit:\n\n\thttps://login.tailscale.com/a/abc123\n"
    assert core.LOGIN_URL.findall(line) == ["https://login.tailscale.com/a/abc123"]
