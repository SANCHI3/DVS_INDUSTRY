"""Forward the DVR's ports to the factory PC's Tailscale address (fallback for
a home network that also uses 192.168.0.x). Runs on the FACTORY PC.

    python scripts/dvr_relay.py                       # listen on this PC's Tailscale IPv4
    python scripts/dvr_relay.py --listen 100.101.102.103 --map 8554:192.168.0.139:554 --map 8080:192.168.0.139:80

Then on the laptop: DVR_HOST=<factory PC Tailscale name or 100.x address>,
DVR_RTSP_PORT=8554 (and http://<factory-pc>:8080 for the DVR web page).

It only ever listens on a Tailscale address (100.64.0.0/10 or fd7a:115c:a1e0::/48),
never on 0.0.0.0 or the factory LAN, so nothing new is exposed on the network:
only devices allowed by the tailnet policy can reach it. It reads nothing and
changes nothing on the DVR; bytes are passed through as they are.
"""
from __future__ import annotations

import argparse
import asyncio
import ipaddress
import shutil
import subprocess
import sys
import time
from typing import Optional

TAILSCALE_NETS = (ipaddress.ip_network("100.64.0.0/10"), ipaddress.ip_network("fd7a:115c:a1e0::/48"))
DEFAULT_MAPS = ("8554:192.168.0.139:554", "8080:192.168.0.139:80")


def validate_listen(address: str, allow_any: bool = False) -> str:
    """The listen address must be a Tailscale address (unless testing)."""
    try:
        ip = ipaddress.ip_address(address)
    except ValueError as exc:
        raise ValueError(f"'{address}' is not an IP address") from exc
    if allow_any:
        return address
    if ip.is_unspecified:
        raise ValueError("refusing to listen on every interface (0.0.0.0 / ::); use the Tailscale address")
    if not any(ip in net for net in TAILSCALE_NETS):
        raise ValueError(f"{address} is not a Tailscale address (100.64.0.0/10); "
                         "listening there would expose the DVR on that network")
    return address


def parse_map(text: str) -> tuple[int, str, int]:
    """'8554:192.168.0.139:554' -> (8554, '192.168.0.139', 554)."""
    try:
        listen, host, port = text.split(":")
        return int(listen), host, int(port)
    except ValueError as exc:
        raise ValueError(f"--map must look like 8554:192.168.0.139:554, got '{text}'") from exc


def tailscale_ipv4(wait_s: float = 0) -> Optional[str]:
    """This PC's Tailscale IPv4, waiting for Tailscale to come up after boot."""
    exe = shutil.which("tailscale") or r"C:\Program Files\Tailscale\tailscale.exe"
    deadline = time.monotonic() + wait_s
    while True:
        try:
            out = subprocess.run([exe, "ip", "-4"], capture_output=True, text=True, timeout=10).stdout.strip()
            if out:
                return out.splitlines()[0].strip()
        except (OSError, subprocess.SubprocessError):
            pass
        if time.monotonic() >= deadline:
            return None
        time.sleep(5)


async def _pipe(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    try:
        while data := await reader.read(65536):
            writer.write(data)
            await writer.drain()
    except (ConnectionError, OSError):
        pass
    finally:
        try:
            writer.close()
        except Exception:  # noqa: BLE001
            pass


def make_handler(target_host: str, target_port: int, timeout_s: float = 10.0):
    async def handle(client_r: asyncio.StreamReader, client_w: asyncio.StreamWriter) -> None:
        peer = client_w.get_extra_info("peername")
        try:
            dvr_r, dvr_w = await asyncio.wait_for(asyncio.open_connection(target_host, target_port), timeout_s)
        except (OSError, asyncio.TimeoutError):
            print(f"[relay] {peer[0] if peer else '?'} -> {target_host}:{target_port}: DVR not reachable")
            client_w.close()
            return
        await asyncio.gather(_pipe(client_r, dvr_w), _pipe(dvr_r, client_w))
    return handle


async def serve(listen: str, maps: list[tuple[int, str, int]]) -> list[asyncio.base_events.Server]:
    servers = []
    for listen_port, host, port in maps:
        server = await asyncio.start_server(make_handler(host, port), listen, listen_port)
        servers.append(server)
        print(f"[relay] {listen}:{listen_port} -> {host}:{port}")
    return servers


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--listen", default="auto", help="Tailscale address of this PC (default: from `tailscale ip -4`)")
    parser.add_argument("--map", action="append", default=None, metavar="PORT:HOST:PORT",
                        help="listen port : DVR address : DVR port (default 8554->554 and 8080->80)")
    args = parser.parse_args(argv)
    listen = tailscale_ipv4(wait_s=600) if args.listen == "auto" else args.listen
    if not listen:
        print("Tailscale is not connected on this PC (no `tailscale ip -4`). Start Tailscale first.")
        return 1
    try:
        listen = validate_listen(listen)
        maps = [parse_map(m) for m in (args.map or DEFAULT_MAPS)]
    except ValueError as exc:
        print(f"Not started: {exc}")
        return 2

    async def run() -> None:
        servers = await serve(listen, maps)
        await asyncio.gather(*(s.serve_forever() for s in servers))

    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
