# Remote access to the factory CCTV (Tailscale)

With this setup, the developer's laptop can open the DVR's video and web page
from anywhere: home, college, or a phone hotspot behind CGNAT. It can run the
probe, snapshot and recording scripts against the real cameras, and remote
into the factory PC.

- No router changes and no open ports.
- Tailscale traffic is end-to-end encrypted (WireGuard).
- The free Personal plan is enough.

Do **not** use port forwarding, DDNS or opening ports 80/554/8000 instead.
The DVR's 2014 firmware has known security holes.

Owners keep watching live video in the EZVIZ / Hik-Connect app as today.

Steps checked against the Tailscale docs on 2 Nov 2026 (subnet routers,
4via6, unattended mode, grants). Menu names change; if one differs, search
the Tailscale docs for the same words.

> TODO(owner): which Google / Microsoft account owns the DVS tailnet (log in
> with it on every device below). Whether the factory PC is Windows or Linux.

---

## 1. Factory PC: join the tailnet and route to the DVR

1. Install Tailscale from <https://tailscale.com/download> and log in with the
   DVS account.
2. Keep it connected after a reboot, with no one logged in:
   - **Windows:** right-click the Tailscale tray icon → *Preferences* → *Run
     unattended* → *Yes*. Or, in an Administrator prompt:
     `tailscale set --unattended=true`
   - **Linux:** the `tailscaled` service already starts at boot
     (`sudo systemctl enable --now tailscaled`).
3. Turn on IP forwarding:
   - **Linux:**
     ```
     echo 'net.ipv4.ip_forward = 1' | sudo tee -a /etc/sysctl.d/99-tailscale.conf
     echo 'net.ipv6.conf.all.forwarding = 1' | sudo tee -a /etc/sysctl.d/99-tailscale.conf
     sudo sysctl -p /etc/sysctl.d/99-tailscale.conf
     ```
   - **Windows:** in an Administrator PowerShell, then restart the PC:
     ```
     Set-ItemProperty -Path HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters -Name IPEnableRouter -Value 1
     ```
4. Advertise **only the DVR**, not the whole factory network (least privilege):
   - Windows, Administrator prompt: `tailscale set --advertise-routes=192.168.0.105/32`
   - Linux: `sudo tailscale set --advertise-routes=192.168.0.105/32`
5. In the admin console (<https://login.tailscale.com/admin/machines>):
   1. Find the factory PC (it shows a **Subnets** badge).
   2. Open *Subnets* and approve `192.168.0.105/32`. Select *Save*.
6. In the same console, open the factory PC's **⋯** menu and choose
   **Disable key expiry**. Otherwise remote access silently stops after
   180 days.
7. Rename the device to `factory-pc` (⋯ → *Edit machine name*). The laptop
   can then use the name `factory-pc` instead of an address.

The DVR's address must not change, so the router's DHCP reservation from
`CCTV_SETUP.md` step 5 is required.

## 2. Who may reach what (tailnet policy)

The admin console's default policy lets every device reach everything. Replace
it with this, under *Access controls* → *Edit file*:

- Change `developer@example.com` to the developer's login.
- Tag the factory PC `tag:factory` (⋯ → *Edit ACL tags*).

```jsonc
{
  "tagOwners": {
    "tag:factory": ["autogroup:admin"],
  },
  "grants": [
    {
      // The developer's devices: the DVR's video (RTSP) and web page only
      "src": ["developer@example.com"],
      "dst": ["192.168.0.105"],
      "ip":  ["tcp:554", "tcp:80"],
    },
    {
      // Remote desktop / SSH to the factory PC, and the relay ports (section 4)
      "src": ["developer@example.com"],
      "dst": ["tag:factory"],
      "ip":  ["tcp:3389", "tcp:22", "tcp:8554", "tcp:8080"],
    },
  ],
  "ssh": [
    {
      // Tailscale SSH to a Linux factory PC
      "action": "check",
      "src":    ["developer@example.com"],
      "dst":    ["tag:factory"],
      "users":  ["autogroup:nonroot"],
    },
  ],
}
```

Nothing else is allowed: the factory PC cannot reach the developer's laptop,
and no other device can reach the DVR. If the console rejects `grants`, use
the older form:

```
"acls": [{ "action": "accept", "src": ["developer@example.com"],
           "dst": ["192.168.0.105:554,80", "tag:factory:3389,22,8554,8080"] }]
```

## 3. Developer laptop

1. Install Tailscale and log in.
2. Accept the route:
   - **Windows and macOS** do this automatically.
   - **Linux:** `sudo tailscale set --accept-routes`
3. Test:
   ```
   ping 192.168.0.105
   ```
   Then open <http://192.168.0.105> in a browser. Then, in `perception-service`:
   ```
   python scripts/probe_dvr.py
   ```
4. For running the monitoring from the laptop, set in `perception-service/.env`:
   ```
   DVR_HOST=192.168.0.105
   REMOTE_MODE=true
   PERCEPTION_INSTANCE_ID=dev-laptop
   ```
   - `REMOTE_MODE=true` uses the sub stream at no more than 1 frame/s per
     camera and 4 frames/s in total, so the factory's upload isn't saturated.
     A sub stream needs about 0.3–0.5 Mbit/s; a main stream 2–4 Mbit/s.
   - The laptop's detections are sent as **test detections**. They are hidden
     on the website unless *Show test detections* is ticked, and never count in
     totals.
   - If the factory PC is watching the same cameras, the Cameras tab shows
     "Also watched by dev-laptop (not counted twice)".
   - `python service.py doctor` says whether the DVR is reached directly or
     through Tailscale.

The developer's home network is 192.168.31.x, checked on 2 Nov 2026. That is
different from the factory's 192.168.0.x, so the steps above are enough.

## 4. If the laptop's network also uses 192.168.0.x

Many home routers use 192.168.0.x too. The laptop then looks for
192.168.0.105 at home instead of going through Tailscale, and `probe_dvr.py`
says so. There are two fixes.

**A. 4via6 (preferred where the factory PC supports it).** This gives the
factory network its own address in the tailnet.

1. On the factory PC:
   ```
   tailscale debug via 7 192.168.0.105/32
   ```
   This prints an address like `fd7a:115c:a1e0:b1a:0:7:c0a8:8b/128`.
2. Advertise that address too:
   ```
   tailscale set --advertise-routes=192.168.0.105/32,<printed address>
   ```
3. Approve it in the console, and use it (not 192.168.0.105) in the policy's
   `dst`.
4. With MagicDNS on, the laptop reaches the DVR as `192-168-0-139-via-7`:
   `DVR_HOST=192-168-0-139-via-7`.

Tailscale's 4via6 page does not say which systems can be the router. If it
doesn't work on a Windows factory PC, use B.

**B. The relay (works everywhere).** The factory PC forwards its own
Tailscale address to the DVR:

```
python scripts/dvr_relay.py            # 8554 -> DVR 554 (video), 8080 -> DVR 80 (web page)
```

- It listens **only** on the PC's Tailscale address. It refuses `0.0.0.0` and
  the factory LAN.
- On the laptop:
  ```
  DVR_HOST=factory-pc
  DVR_RTSP_PORT=8554
  ```
  The web page is <http://factory-pc:8080>.
- To start the relay at boot on Windows (Administrator PowerShell, in
  `perception-service`):
  ```
  $py = (Get-Command python).Source
  Register-ScheduledTask -TaskName "DVS DVR Relay" -Trigger (New-ScheduledTaskTrigger -AtStartup) `
    -Action (New-ScheduledTaskAction -Execute $py -Argument "scripts\dvr_relay.py" -WorkingDirectory (Get-Location)) `
    -Principal (New-ScheduledTaskPrincipal -UserId SYSTEM -LogonType ServiceAccount) `
    -Settings (New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit 0)
  ```
- On Linux, copy `ops/perception/dvs-perception.service`, set
  `ExecStart=… python scripts/dvr_relay.py`, and name it `dvs-dvr-relay`.

## 5. Remote into the factory PC

- **Windows:** Remote Desktop to `factory-pc` (its Tailscale name). The policy
  above allows port 3389 over Tailscale only. Leave the Windows firewall's
  Remote Desktop rules as they are; do not open RDP to the internet.
- **Linux:** run `sudo tailscale set --ssh` on the factory PC once. Then from
  the laptop: `ssh <user>@factory-pc`.

Once connected:

| To | Windows | Linux |
|---|---|---|
| Self-check | `python service.py doctor` | same |
| Read the log | `perception-service\logs\perception.log` | `journalctl -u dvs-perception -f` |
| Restart the monitoring | `Stop-ScheduledTask "DVS CCTV Monitoring"` then `Start-ScheduledTask "DVS CCTV Monitoring"` | `sudo systemctl restart dvs-perception` |
| Pictures for zones | `python scripts/grab_snapshots.py` | same |

## 6. Owner checklist

- **Who has access:** the admin console's *Machines* page lists every device.
  Only devices of the people in the policy can reach the DVR.
- **A laptop is lost:** on *Machines*, open its **⋯** menu → *Remove*. It can
  no longer connect. Also change the DVR's limited user password.
- **Turn remote access off completely:** do any one of these:
  - On *Machines* → factory PC → *Subnets*, untick the route.
  - On the factory PC, run `tailscale set --advertise-routes=`.
  - Log the factory PC out of Tailscale.

  The CCTV monitoring keeps working; it doesn't need Tailscale.
- **Updates:** keep Tailscale up to date on the factory PC. The 4via6 page
  asks for v1.102.3 or later on subnet routers.
- **Cost:** none. The free Personal plan covers this.
