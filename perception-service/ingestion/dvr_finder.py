"""Find the DVR again when its address changes. READ-ONLY towards the DVR.

The DVR gets its address by DHCP and the router cannot reserve one, so the
address can change; the network card's MAC never does. If the DVR stops
answering, ping every address on this computer's /24 (which fills the ARP
table), look the MAC up with `arp -a`, and save the new DVR_HOST.

Standard Windows tools only (ping, arp), no administrator rights.
"""
from __future__ import annotations

import ipaddress
import json
import re
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable, Iterable, Optional

from ingestion.rtsp_probe import local_ipv4_networks, tcp_reachable

DOWN_AFTER_S = 120.0
SCAN_EVERY_S = 600.0
CHECK_EVERY_S = 30.0
NOTICE_FOR = timedelta(hours=24)
TAILSCALE = ipaddress.ip_network("100.64.0.0/10")
# No flashing console windows when this runs from the setup window
NO_WINDOW = {"creationflags": 0x08000000} if sys.platform == "win32" else {}

_ARP_LINE = re.compile(
    r"(?P<ip>\d{1,3}(?:\.\d{1,3}){3})\D+?(?P<mac>[0-9a-fA-F]{2}(?:[-:][0-9a-fA-F]{2}){5})"
)


def normalise_mac(text: str) -> str:
    """c0-56-E3-1e-10-04 -> c0:56:e3:1e:10:04"""
    return text.strip().lower().replace("-", ":")


def parse_arp_table(text: str) -> dict[str, str]:
    """{ip: mac} from `arp -a` output (Windows, or Linux/macOS for developers)."""
    return {m["ip"]: normalise_mac(m["mac"]) for m in _ARP_LINE.finditer(text)}


def read_arp_table(address: str = "") -> dict[str, str]:
    cmd = ["arp", "-a"] + ([address] if address else [])
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=15, **NO_WINDOW).stdout
    except (OSError, subprocess.SubprocessError):
        return {}
    return parse_arp_table(out or "")


def ping_once(address: str) -> bool:
    flags = ["-n", "1", "-w", "300"] if sys.platform == "win32" else ["-c", "1", "-W", "1"]
    try:
        return subprocess.run(["ping", *flags, address], capture_output=True, timeout=5,
                              **NO_WINDOW).returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def scan_networks(hint: str = "", interfaces=None) -> list[ipaddress.IPv4Network]:
    """The /24s to search: this computer's own LANs, the DVR's last one first."""
    interfaces = local_ipv4_networks() if interfaces is None else interfaces
    found: list[ipaddress.IPv4Network] = []
    for iface in interfaces:
        if iface.ip in TAILSCALE or not iface.ip.is_private or iface.ip.is_link_local:
            continue
        net = ipaddress.ip_network(f"{iface.ip}/24", strict=False)
        if net not in found:
            found.append(net)
    try:
        last = ipaddress.ip_address(hint)
        found.sort(key=lambda n: last not in n)
    except ValueError:
        pass
    return found


def ping_sweep(networks: Iterable[ipaddress.IPv4Network], ping: Callable[[str], bool] = ping_once,
               workers: int = 32) -> None:
    addresses = [str(ip) for net in networks for ip in net.hosts()]
    with ThreadPoolExecutor(max_workers=workers) as pool:
        list(pool.map(ping, addresses))


def find_by_mac(mac: str, hint: str = "", interfaces=None, ping: Callable[[str], bool] = ping_once,
                arp: Callable[[], dict[str, str]] = read_arp_table) -> Optional[str]:
    """The address that has this MAC now, or None."""
    wanted = normalise_mac(mac)
    networks = scan_networks(hint, interfaces)
    if not networks:
        return None
    ping_sweep(networks, ping)
    inside = [ip for ip, m in arp().items() if m == wanted
              and any(ipaddress.ip_address(ip) in net for net in networks)]
    return inside[0] if inside else None


@dataclass
class Device:
    address: str
    mac: str = ""
    is_dvr: bool = False  # has the DVR's MAC
    rtsp_open: bool = False

    def label(self) -> str:
        if self.is_dvr:
            return f"{self.address}  (this is your DVR)"
        return f"{self.address}  (a device with a video port, not your DVR's network card)"


def find_devices(mac: str, port: int = 554, hint: str = "", interfaces=None,
                 ping: Callable[[str], bool] = ping_once,
                 arp: Callable[[], dict[str, str]] = read_arp_table,
                 port_open: Callable[[str, int, float], bool] = tcp_reachable) -> list[Device]:
    """For the Find DVR button: the DVR by MAC, plus anything else with port 554 open."""
    networks = scan_networks(hint, interfaces)
    ping_sweep(networks, ping)
    table = arp()
    wanted = normalise_mac(mac)
    addresses = [str(ip) for net in networks for ip in net.hosts()]
    with ThreadPoolExecutor(max_workers=32) as pool:
        open_ports = list(pool.map(lambda a: port_open(a, port, 0.5), addresses))
    devices = [Device(a, table.get(a, ""), table.get(a) == wanted, is_open)
               for a, is_open in zip(addresses, open_ports) if is_open or table.get(a) == wanted]
    return sorted(devices, key=lambda d: (not d.is_dvr, ipaddress.ip_address(d.address)))


def update_env_value(path: Path, key: str, value: str) -> None:
    """Change one line of .env, keeping the rest.

    Written in place: a new file would lose the "only this Windows user can
    read it" permissions.
    """
    lines = path.read_text(encoding="utf-8").splitlines() if path.is_file() else []
    new_line = f"{key}={value}"
    for i, line in enumerate(lines):
        if line.strip().startswith(f"{key}="):
            lines[i] = new_line
            break
    else:
        lines.append(new_line)
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write("\n".join(lines) + "\n")


def read_env_value(path: Path, key: str) -> str:
    if path.is_file():
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.strip().startswith(f"{key}="):
                return line.split("=", 1)[1].strip().strip("\"'")
    return ""


def save_notice(path: Path, host: str, now: Optional[datetime] = None) -> None:
    now = now or datetime.now(timezone.utc)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"host": host, "at": now.isoformat()}), encoding="utf-8")


def read_notice(path: Path, now: Optional[datetime] = None) -> Optional[str]:
    """The text for the Cameras page, for a day after the change."""
    now = now or datetime.now(timezone.utc)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if now - datetime.fromisoformat(data["at"]) <= NOTICE_FOR:
            return f"DVR address changed to {data['host']}"
    except (OSError, ValueError, KeyError, TypeError):
        pass
    return None


class DvrWatcher:
    """Scans for the DVR after 2 minutes of silence, at most once per 10 minutes."""

    def __init__(self, host: str, port: int, mac: str, env_path: Path, notice_path: Path,
                 reachable: Callable[[str, int, float], bool] = tcp_reachable,
                 find: Callable[[str, str], Optional[str]] = find_by_mac,
                 arp_lookup: Callable[[str], dict[str, str]] = read_arp_table,
                 clock: Callable[[], float] = time.monotonic,
                 down_after_s: float = DOWN_AFTER_S, scan_every_s: float = SCAN_EVERY_S):
        self.host, self.port, self.mac = host, port, normalise_mac(mac)
        self.env_path, self.notice_path = env_path, notice_path
        self.reachable, self.find, self.arp_lookup, self.clock = reachable, find, arp_lookup, clock
        self.down_after_s, self.scan_every_s = down_after_s, scan_every_s
        self.down_since: Optional[float] = None
        self.last_scan: Optional[float] = None
        self.moved_to: Optional[str] = None
        self._stop = threading.Event()

    def answers(self, host: str) -> bool:
        """Port open, and not some other device that took over the address."""
        if not self.reachable(host, self.port, 5.0):
            return False
        seen = self.arp_lookup(host).get(host)
        return seen is None or seen == self.mac

    def check(self) -> Optional[str]:
        """One look; returns the new address if the DVR was found elsewhere."""
        now = self.clock()
        if self.answers(self.host):
            self.down_since = None
            return None
        if self.down_since is None:
            self.down_since = now
            print(f"[dvr] no answer at {self.host}; looking for it after "
                  f"{self.down_after_s:.0f} s if it does not come back", flush=True)
        if now - self.down_since < self.down_after_s:
            return None
        if self.last_scan is not None and now - self.last_scan < self.scan_every_s:
            return None
        self.last_scan = now
        print(f"[dvr] scanning the network for {self.mac}", flush=True)
        found = self.find(self.mac, self.host)
        if not found or found == self.host or not self.reachable(found, self.port, 5.0):
            print("[dvr] not found on the network; will look again in 10 minutes", flush=True)
            return None
        update_env_value(self.env_path, "DVR_HOST", found)
        save_notice(self.notice_path, found)
        print(f"[dvr] DVR address changed from {self.host} to {found}; reconnecting", flush=True)
        self.host = found
        self.moved_to = found
        self.down_since = None
        return found

    def start(self, every_s: float = CHECK_EVERY_S) -> "DvrWatcher":
        def loop() -> None:
            while not self._stop.wait(every_s) and self.moved_to is None:
                try:
                    self.check()
                except Exception as exc:  # noqa: BLE001 - finding the DVR must not stop detection
                    print(f"[dvr] address check failed: {type(exc).__name__}", flush=True)

        threading.Thread(target=loop, name="dvr-watcher", daemon=True).start()
        return self

    def stop(self) -> None:
        self._stop.set()


