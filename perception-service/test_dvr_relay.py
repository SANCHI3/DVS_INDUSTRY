"""The Tailscale relay: never listens outside Tailscale, passes bytes through."""
from __future__ import annotations

import asyncio

import pytest

from scripts.dvr_relay import parse_map, serve, validate_listen


@pytest.mark.parametrize("address", ["0.0.0.0", "::", "192.168.0.50", "10.0.0.2"])
def test_refuses_anything_but_a_tailscale_address(address):
    with pytest.raises(ValueError):
        validate_listen(address)


def test_accepts_tailscale_addresses():
    assert validate_listen("100.101.102.103") == "100.101.102.103"
    assert validate_listen("fd7a:115c:a1e0::1234") == "fd7a:115c:a1e0::1234"


def test_port_maps():
    assert parse_map("8554:192.168.0.139:554") == (8554, "192.168.0.139", 554)
    with pytest.raises(ValueError, match="8554:192.168.0.139:554"):
        parse_map("8554")


def test_bytes_pass_through_unchanged():
    async def scenario():
        async def fake_dvr(reader, writer):
            data = await reader.read(100)
            writer.write(b"RTSP/1.0 200 OK echo " + data)
            await writer.drain()
            writer.close()

        dvr = await asyncio.start_server(fake_dvr, "127.0.0.1", 0)
        dvr_port = dvr.sockets[0].getsockname()[1]
        # the test listens on loopback (validate_listen is what forbids that for real)
        servers = await serve("127.0.0.1", [(0, "127.0.0.1", dvr_port)])
        relay_port = servers[0].sockets[0].getsockname()[1]
        reader, writer = await asyncio.open_connection("127.0.0.1", relay_port)
        writer.write(b"OPTIONS rtsp://x RTSP/1.0\r\n")
        await writer.drain()
        answer = await asyncio.wait_for(reader.read(200), 5)
        writer.close()
        for s in [dvr, *servers]:
            s.close()
        return answer

    assert asyncio.run(scenario()) == b"RTSP/1.0 200 OK echo OPTIONS rtsp://x RTSP/1.0\r\n"
