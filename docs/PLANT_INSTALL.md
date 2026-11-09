# Installing the CCTV software on the plant PC

For the plant computer (`dvsaccounts SERVER`, 192.168.0.108), reached through
Chrome Remote Desktop. Everything is a double-click, and the address below needs
no Shift key.

## Before you start

On render.com, open **dvs-industry-api → Environment** and copy the value of
`CAMERA_SERVICE_KEY`. If it is not there, add it: any 32 or more letters and
numbers, then **Save**. Render restarts the site.

## Install

1. In Chrome on the plant PC, go to `www.dvsindustry.online/setup`. The
   download starts by itself.
2. Open the file. If Windows says "protected your PC", click **More info**, then
   **Run anyway**.
3. In the window, type the DVR password and paste the service key, then click
   **Save and test the cameras**. Shift does not work over Remote Desktop, so
   use **Paste** or the **Capitals and symbols keyboard** button.
4. Check each camera says "working", then click **Next**.
5. Write down what each picture shows, then click **Next**.
6. Tick **Enable live view** if you want it, click **Allow**, then **Yes**.
7. Wait for "Done. Cameras online: 8/8."

## Afterwards

- **Camera names:** put the areas in `C:\dvs-cctv\app\config\cameras.yaml`
  (`zone:` for each camera), then restart the PC.
- **Check it:** double-click **Run camera test again** on the desktop.
- **Health report:** `C:\dvs-cctv\python\python.exe C:\dvs-cctv\app\service.py doctor`
- **Logs:** `C:\dvs-cctv\app\logs` (14 days are kept).
- **Remove it:** double-click **Uninstall DVS CCTV** on the desktop.

## How it behaves

- Reads from the DVR only; it never changes the DVR's settings.
- Detection uses the sub stream at about 2 frames a second per camera, at most
  12 in total, at below-normal priority. If the computer stays above 70% CPU for
  a minute, detection halves its speed until the load drops.
- If the DVR stops answering for 2 minutes, the software looks for its network
  card on the local network (at most every 10 minutes), saves the new address
  and reconnects. The Cameras page shows "DVR address changed to X" for a day.
- Live video runs only while someone watches. Viewers need a 2-minute pass from
  the website, and each viewing is written to the audit log.

## Updates

From the first release with the updater, the PC updates itself. Every 6 hours it looks for a newer release, downloads the small `dvs-cctv-app.zip` and checks its SHA-256. That can happen at any hour. The install itself only happens between 1 AM and 5 AM India time, so an update never restarts the monitoring during the working day. If the website has not accepted a heartbeat from the new version within 5 minutes, the old files come back and that version is skipped from then on.

- A release is made only when you ask for one: on GitHub open **Actions → CCTV installer → Run workflow**, or push a tag such as `cctv-v9`. A normal push to master builds and tests the installer but publishes nothing.
- `AUTO_UPDATE_WINDOW=01:00-05:00` in `.env` changes the hours (India time). `AUTO_UPDATE=false` switches updates off completely.
- A release that changes Python libraries, models, FFmpeg or MediaMTX needs the full installer. The PC skips it and says so in `logs/perception.log`.
- `.env`, `config/cameras.yaml`, logs and pictures are never replaced.
- The website's Cameras tab shows the version, the last update check and any update waiting for the night. The result of the last update is in `updates/result.json` in the install folder.

## Running the installer over an installed copy

It needs one Windows "Yes" and opens no setup window. `.env`, `cameras.yaml`, Tailscale and the scheduled task stay as they are. The cameras keep running while it unpacks and checks the new version. They stop for a few minutes during the swap. Everything is written to `C:\dvs-cctv\logs\install.log`, with no passwords or keys.

**What you should see on the website afterwards:** Plant software shows the new version · 8 of 8 cameras online · Live plays. Last update check appears about 10 minutes later.

| Message | What it means | What to do |
| --- | --- | --- |
| DVS CCTV is updated and the monitoring has restarted | It worked | Check the website as above |
| Not enough free space on the disk | Less than 3 GB free. Nothing changed, cameras never stopped | Free some space and run it again |
| The new version cannot run on this computer | A library will not load on this Windows. Nothing changed, cameras never stopped | Keep the current version and send `install.log` to support |
| The previous version could not be copied | Nothing changed, cameras never stopped | Run it again; if it repeats, send `install.log` |
| The files could not be replaced. The previous version was put back and restarted | Something kept a file open | Restart the PC and run it again |
| The new version did not reach the website within 8 minutes. The previous version was put back and restarted | It started but sent no heartbeat, often because the website or internet was down | Check the website opens, then run it again |
| ...and the previous version could not be put back | The cameras may be stopped | Send `install.log` to support straight away |

Saving a change to `.env` takes effect by itself within 30 seconds, with no reboot.
