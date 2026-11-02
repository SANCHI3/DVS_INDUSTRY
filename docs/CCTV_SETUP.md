# Connecting the factory CCTV

This guide connects the DVS monitoring software to the factory's CCTV
recorder. Do the steps on the **factory PC**: the computer that will run the
monitoring software and sits on the same network as the recorder.

| | |
|---|---|
| Recorder | Hikvision DS-7208HGHI-SH (8-channel Turbo HD DVR), firmware V3.0.4 |
| Address | 192.168.0.139 (port 554 for video, 80 for its web page) |
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
ping 192.168.0.139
```

You should see replies. Then open http://192.168.0.139 in a browser. The
Hikvision login page should appear.

The address shown under **Configuration → Network → General** (192.168.1.10)
is an old setting that isn't used, because the recorder gets its address
automatically (DHCP). The real address is the one under **System Info →
Network**: 192.168.0.139. If ping fails, check that address on the DVR
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
3. Add one for MAC address `c0:56:e3:1e:10:04` → `192.168.0.139`.
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
   DVR_HOST=192.168.0.139
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
