# Installing the CCTV software on the plant PC

For the plant computer (`dvsaccounts SERVER`, 192.168.0.108), reached through
Chrome Remote Desktop. Everything is a double-click, and the address below needs
no Shift key.

## Before you start

On render.com, open **dvs-industry-api → Environment** and copy the value of
`CAMERA_SERVICE_KEY`. If it is not there, add it: any 32 or more letters and
numbers, then **Save**. Render restarts the site.

## Install

1. In Chrome on the plant PC, go to `dvs-industry.vercel.app/setup`. The
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
