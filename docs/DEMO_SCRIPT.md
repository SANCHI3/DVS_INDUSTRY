# Live demo: 5 minutes

One story: **camera AI → one incident → live alert → evidence → human
response → measured results.** Rehearse it twice on the demo laptop. Use the
laptop with the NVIDIA GPU: on CPU the pipeline runs at about 6 frames/s
instead of 10, and the demo fall clip did not trigger in a CPU test.

## The day before

1. `git lfs pull` (fight model weights), then
   `python perception-service/scripts/prepare_demo_videos.py` (demo clips).
2. Draw the real restricted zone:
   `cd perception-service && python scripts/draw_zones.py --camera CAM-01`.
   Paste the result into `config/cameras.yaml` and give the zone a name.
3. Full rehearsal: `.\start-demo.ps1` (Windows) or `./start-demo.sh`.
4. On the **AI Security → Incident Center** page, resolve or close old test
   incidents so new ones stand out.
5. Optional: put an `LLM_API_KEY` in `perception-service/.env` for AI-written
   summaries. Without one, the built-in description is used; that is fine.

## Start (before the examiners arrive)

```powershell
.\start-demo.ps1            # checks everything, starts backend + frontend, opens the browser
```

- Log in as **Administrator**.
- Open **AI Security** and check the green **Live** badge.
- For the camera version: stop the script (Ctrl+C) and run
  `.\start-demo.ps1 -Camera` (webcam with a live annotated window). Keep the
  demo-clip version as the backup (see below).

## The 5 minutes

| Time | Do | Say |
|---|---|---|
| 0:00–0:30 | **Dashboard**, then click through Production, Inventory, Smart Analytics. | "One ERP for the whole plant: workforce, stock, orders, production, analytics. Security is part of the same system." |
| 0:30–1:15 | **`docs/RESULTS.md`**: model table and charts. | "YOLO only finds and tracks people. Each incident type has its own model: a 3D CNN for fights, pose plus GRU for falls, YOLO plus a verifier for fire, an autoencoder for unusual activity. Each one beats its baseline on held-out videos, for example fight F1 0.85 to 0.96." |
| 1:15–2:30 | **AI Security → Live Monitoring.** The demo clips (or the camera) are playing in the video window. | When the fight clip plays: "Within a few seconds: one incident, live, no refresh, and the priority pop-up on any page." When the fire clip plays: "Fire always interrupts. The same ongoing fire updates one incident; no duplicates." |
| 2:30–3:30 | Click the new **fight** card → **evidence dialog**. | "Snapshots saved at confirmation. Grad-CAM shows where the model looked: on the people, not the background. Confidence in words, and why: two people close for at least a second, moving agitatedly. That check is how we removed the false fights we found on our own camera." |
| 3:30–4:15 | **Incident Center**: assign the incident, Investigate → Resolve. | "A human always decides; every change is audited. Roles matter: a store user cannot see security data at all." |
| 4:15–5:00 | **`docs/RESULTS.md`**, scroll to the table and Speed. | "Every number in this file is generated from the training metrics files, never typed in. On this laptop GPU the full pipeline runs at about 9 of the 10 target frames per second. What we have not measured yet is false alarms per hour on long normal footage; the script for it is ready." |

What to expect from the clips (`perception-service/demo_videos/`, about 48 s
per loop):

| Clip | Result |
|---|---|
| normal activity | nothing |
| fight | 1 FIGHT (HIGH) |
| fire | 1 FIRE_SMOKE (HIGH) |
| fall | 1 FALL (MEDIUM) |

Repeats on the next loop are suppressed for 60 s. A fall can appear again on
every loop, because its 45-s window is shorter than one loop. Unusual
activity stays silent for the first 5 minutes (calibration).

## Backup plan

| Problem | Do this |
|---|---|
| Webcam not found / wrong camera / poor lighting | Ctrl+C, then `.\start-demo.ps1` (demo clips, no camera needed). Say: "the same pipeline, fed from recorded clips". |
| An incident does not appear | Look at the perception window/terminal for `CONFIRMED …` and `dashboard … failed`. If there is a `CONFIRMED` line but no row, refresh the browser (login expired). Have a resolved earlier incident ready to open as the evidence example. |
| No incidents at all after a clip | Clips already raised an incident in the last 60 s (de-duplication, which is by design). Restart the perception service: Ctrl+C, run the script again. |
| Badge shows *Reconnecting…* | The backend window has an error, or the login expired: refresh the page. |
| "Too many requests" | Raise `RATE_LIMIT_MAX` in `backend/.env`, restart the backend. |
| Perception service crashes | The start script restarts it after a native crash. Otherwise run `.\start-demo.ps1` again; backend and frontend are reused. |
| Fight model message "Git LFS pointer" | Fight detection is off; fire and fall still work. Show the fight evidence from an earlier incident. Fix later with `git lfs pull`. |
| Everything fails | Open `docs/RESULTS.md` and the report figures (`docs/figures/`), plus screenshots of the dashboard and evidence dialog taken during rehearsal. |

## Likely questions

See [VIVA_QA.md](VIVA_QA.md). Three quick ones:

- *How do you avoid false alarms?* Persistence (PROBABLE → CONFIRMED),
  interaction check for fights, flicker/growth check plus a learned verifier
  for fire, per-camera calibration for anomalies, and de-duplication.
- *Can the LLM invent things?* No. Its text is rejected if it changes the
  location or adds a number, and it cannot set the type, severity or
  confidence.
- *How fast?* 52 ms per frame on the laptop GPU; an alert shows within
  seconds. An earlier measurement (`docs/REALTIME_SECURITY_ALERTS.md`)
  reported a median of 0.43 s from detection to ERP record.
