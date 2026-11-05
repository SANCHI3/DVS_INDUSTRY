# Connecting the factory CCTV

> Installing on the plant PC? Use the one-file installer: [PLANT_INSTALL.md](PLANT_INSTALL.md).

This guide connects the DVS monitoring software to the factory's CCTV
recorder. Do the steps on the **factory PC**: the computer that will run the
monitoring software and sits on the same network as the recorder.

| | |
|---|---|
| Recorder | Hikvision DS-7208HGHI-SH (8-channel Turbo HD DVR), firmware V3.0.4 |
| Address | 192.168.0.105 (port 554 for video, 80 for its web page) |
| Cameras | 8 analog cameras on channels A1–A8 ("Camera 01" … "Camera 08") |

How it fits together:
- The factory PC reads the video from the recorder, looks for incidents, and
  sends incidents, pictures and camera status **out** to the DVS website.
- Nothing on the internet connects **in** to the factory.
- Live video stays where it is today: the **EZVIZ / Hik-Connect phone app**
  and the monitor connected to the DVR. The website shows a still picture of
  each camera every couple of minutes, not live video. Browsers cannot play
  the recorder's video format, and the free hosting cannot carry 8 live
  streams.

Do **not**:
- open or forward ports 80, 554 or 8000 on the router, or turn on DDNS. This
  recorder's 2014 firmware has known security holes.
- change any other recorder setting for this software. It only reads video.

---

## 1. Check the PC can see the recorder

On the factory PC, open a Command Prompt:

```
ping 192.168.0.105
```

You should see replies. Then open http://192.168.0.105 in a browser. The
Hikvision login page should appear.

The address shown under **Configuration → Network → General** (192.168.1.10)
is an old setting that isn't used, because the recorder gets its address
automatically (DHCP). The real address is the one under **System Info →
Network**: 192.168.0.105. If ping fails, check that address on the DVR
monitor first. It can change after a router restart until step 5 is done.

## 2. Make a separate login for the software

Use a login that can only watch, not the `admin` account.

1. On the DVR monitor: **Main Menu → Configuration → User → Add**. In the
   browser the same screen is under Configuration → Security / User
   Management; names vary a little between firmware versions.
2. User name: for example `dvs-viewer`. Choose a strong password (12+
   characters) and keep it in a safe place.
3. Level: **Operator** or **Guest**. In the permissions, tick only
   **Remote Live View** (remote preview) for channels 1–8. Untick everything
   else: playback, settings, upgrade, PTZ, shutdown/reboot.
4. Save.

The recorder locks a login for a while after several wrong passwords. If the
software reports "wrong username or password", fix the password before trying
again.

## 3. Check the admin password

Older Hikvision recorders shipped with the password `12345` for `admin`. If
that still works, change it now: **Main Menu → Configuration → User → admin
→ Edit**. Use a strong password and give it only to the people who manage
the recorder.

## 4. Change the EZVIZ verification code

The phone app connection uses a 6-letter verification code. If it is still
`AAAAAA`:

1. Change it under **Configuration → Network → Extranet Access** (called
   "Platform Access" on some firmware). Leave EZVIZ itself turned on.
2. If the phone app later asks for the code, enter the new one.

## 5. Keep the recorder's address fixed

Because the recorder gets its address automatically, a router restart can
give it a new one. To prevent that:

1. Open the router's admin page, usually http://192.168.0.1.
2. Find **DHCP reservation**, called "Address reservation" or "Static
   lease" on some routers.
3. Add one for MAC address `c0:56:e3:1e:10:04` → `192.168.0.105`.
4. Save.

Don't set a fixed address on the recorder itself.

## 6. Install the software on the factory PC

1. Install Python 3.12 from python.org. Tick "Add python.exe to PATH".
2. Copy the `perception-service` folder to the PC (or clone the repository).
3. In that folder:
   ```
   pip install -r requirements.txt
   copy .env.example .env
   ```
4. Optional, for more detail in the check below: install FFmpeg with
   `winget install Gyan.FFmpeg`, then open a new Command Prompt.
5. Edit `.env` with Notepad and fill in:
   ```
   DVR_HOST=192.168.0.105
   DVR_RTSP_PORT=554
   DVR_USERNAME=dvs-viewer
   DVR_PASSWORD=<the password from step 2>
   ```
   `.env` stays on this PC. It is never committed, and the password is never
   printed or sent to the website.

## 7. Check every camera

```
python scripts/probe_dvr.py
```

This prints one line per camera and stream, then a table like this:

```
Ch  Stream  URL format     Codec  Resolution  FPS  Result
1   main    hik_streaming  H264   1920x1080   25   OK
1   sub     hik_streaming  H264   704x576     25   OK
…
```

What the results mean:

| Result | Meaning | What to do |
|---|---|---|
| OK | The stream works | Nothing |
| auth failed | Wrong user name or password | Check step 2 and `.env`. The check stops at once so the login is not locked |
| not found | That stream address does not exist | Usually fine for one stream. If *every* line says this, tell the developer |
| timeout / refused | The recorder did not answer | Repeat step 1 |

If the table shows only the `hik_h264` format working, set
`DVR_URL_FORMAT=hik_h264` in `.env`. The check prints this advice itself.

## 8. Save a picture from each camera

```
python scripts/grab_snapshots.py
```

This saves `calibration/snapshots/ch1.jpg` … `ch8.jpg`. They stay on this PC
(they are not committed). Look at each picture and write down:
- which area each channel shows, e.g. "ch3 = Press shop bay 2";
- which checks make sense there, e.g. no crowd check at the gate.

Send that list and the table from step 7 to the developer. Don't send the
password.

---

## Bandwidth

Each sub stream (used for detection) needs about 0.3–0.5 Mbit/s. Each main
stream needs about 2–4 Mbit/s, and is opened only for a moment to take
incident pictures. Inside the factory network this is no problem; over
Tailscale it matters (see `docs/REMOTE_ACCESS.md`).

---

## 9. Name the cameras and set what each one checks

In `perception-service/config/cameras.yaml`, for each channel:

| Setting | What to set |
|---|---|
| `name` | The area, e.g. `Press shop bay 2` |
| `zone` | Press shop / Store / Gate / Dispatch / Office… |
| `rules` | Leave out checks that make no sense there, e.g. no `crowd` at the gate |
| `crowd_min_people` | Optional, if a crowd should mean more than 8 people here |

To limit a camera to one area, or to ignore a spot that fools it (welding
sparks, a sunny window, a furnace), run:

```
python scripts/draw_roi.py 3
python scripts/draw_roi.py 3 --ignore --name "Welding bay" --events fire_smoke
```

Click the corners on the picture and press `s`. Then paste the printed lines
under that camera in `cameras.yaml`.

## 10. Start it automatically and keep it running

1. Check everything first:
   ```
   python service.py doctor
   ```
   Every line should say `OK`. The doctor also shows whether the DVR is
   reached directly or through Tailscale.
2. Install the start-up task. **Windows**, in PowerShell run as Administrator
   inside `perception-service`:
   ```
   powershell -ExecutionPolicy Bypass -File scripts\install_windows_service.ps1
   ```
   **Linux**: follow the steps at the top of `ops/perception/dvs-perception.service`.

What this sets up:
- The monitoring starts when the PC boots, even if no one logs in.
- It restarts by itself after a crash.
- It writes `perception-service/logs/perception.log`. A new file starts every
  day, the last 14 days are kept, and passwords are hidden.

Commands for later:

| To | Run |
|---|---|
| Stop it | `Stop-ScheduledTask -TaskName "DVS CCTV Monitoring"` (Linux: `sudo systemctl stop dvs-perception`) |
| Start it | `Start-ScheduledTask -TaskName "DVS CCTV Monitoring"` |
| Read the log | open `logs\perception.log`. Every minute it prints each camera's fps and processing time (`[perf]`) |
| Remove it | the same install command with `-Remove` |

The website then shows each camera on **AI Security → Cameras**. If the PC
stops reporting, one red line appears there: "CCTV monitoring PC is offline
since …".

## 11. How fast the PC must be

Measured on 2 Nov 2026 on the developer's laptop (12-thread CPU, NVIDIA RTX
3050 laptop GPU, 16 GB RAM), using 704×576 video like the DVR's sub stream.
Repeat it on the factory PC with
`python -m evaluation.benchmark_cameras --config-dir <folder> --seconds 130`.

| One camera, one frame | GPU (RTX 3050 laptop) | CPU only |
|---|---|---|
| Every check (people, fall, fight, fire, unusual activity) | 190 ms → about 5 frames/s in total | 940 ms → about 1 frame/s in total |
| Fire / smoke only | 35 ms → about 29 frames/s | about 200 ms → about 5 frames/s |

With 8 cameras and every check on, the GPU laptop reached **0.7 frames/s per
camera**. It used about one CPU core (9 % of the total) and 2.2 GB of RAM.

The budget is shared by all cameras. Choose per camera:

| What the PC has | Recommended setting |
|---|---|
| Desktop NVIDIA GPU (RTX 3060 or better) | All checks on all 8 cameras; `fps: 1`–`2` each, `MAX_INFER_FPS_TOTAL=12` |
| Laptop GPU like the one above | All checks on 2–3 important cameras (`fps: 2`); `rules: [fire]` on the rest (`fps: 1`); `MAX_INFER_FPS_TOTAL=6` |
| CPU only | `rules: [fire]` on every camera, `fps: 0.5`. Fights and falls need a GPU |

Fight and fall models were trained on about 10 frames per second. Below 8
frames/s they still work but are less accurate, and the log says so at start-up.
Fire and smoke last long enough that 0.5–1 frame/s is enough.

## 12. Power and network

- The PC must be on **24/7**. In Windows power settings set **Sleep: Never**
  and turn hibernate off (`powercfg /hibernate off` as Administrator).
  Turn off "Allow the computer to turn off this device to save power" for the
  network adapter.
- Use **wired Ethernet**, on the same switch as the DVR. Wi-Fi drops cause
  camera reconnects.
- Connect the PC and the DVR to the UPS if there is one. After a power cut
  the task starts by itself.
- Windows Update can restart the PC. The task starts again afterwards. To
  control when this happens, set active hours under *Windows Update → Advanced
  options*.
- Upload is small: a heartbeat every 30 s, a picture per camera every 2 min
  (under 100 KB), and the incident pictures. If the internet is down,
  pictures wait on the PC's disk (up to 500 MB) and go up later.
