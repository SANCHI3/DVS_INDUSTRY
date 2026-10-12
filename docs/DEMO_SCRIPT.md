# Demo script (about 10 minutes)

One continuous story that shows every layer: camera AI → incident → live alert →
human response → reporting. Rehearse it once on the demo machine.

## Before the demo

1. Start PostgreSQL, then in three terminals:
   ```bash
   cd backend  && npm run dev
   cd frontend && npm run dev
   cd perception-service && python main.py --camera CAM-01
   ```
2. Open http://localhost:5173 and log in as **Administrator**. Open **AI Security** and check
   the green **Live** badge next to *Refresh*.
3. Have ready on a phone or second screen: a fight clip and a fire clip
   (e.g. from `perception-service/data/` or any public video). Showing a video
   to the webcam is how the live models are demonstrated safely.
4. Close or resolve old test incidents so new ones stand out.

## The story

| # | Do | Point out |
|---|----|-----------|
| 1 | Show the **Dashboard**, then **Production** and **Inventory → Smart Analytics**. | One ERP for the whole factory; analytics (forecasting, OEE, SPC) on live data. |
| 2 | Open **AI Security**. Stand in front of the webcam (the live window shows boxes and track IDs). | YOLO detection + ByteTrack tracking at 10 fps. |
| 3 | Show the **fight clip** to the webcam. | Within ~2 s a **FIGHT** incident appears in the table *without refreshing*, and the **priority popup** appears if confidence ≥ 90 %. Keep the clip playing: no duplicate incidents. |
| 4 | Switch to the **Dashboard** page, then show the **fire clip**. | The popup appears on *any* page with an alarm tone; fire/smoke always interrupts. |
| 5 | Sit or lie down out of a standing position in view of the camera and **stay down for 20 s**. | A **FALL** incident at MEDIUM, then the *same* incident turns **CRITICAL** with a popup: "person still down 20 s after the fall". Its history shows the escalation. |
| 6 | Click **View incident**, assign it to an employee, move it to *Investigating* → *Resolved*. | Human in the loop; every change is audited. |
| 7 | Open the evidence folder `perception-service/output/evidence/CAM-01/`. | Before/after clips and keyframes saved automatically at confirmation. |
| 8 | Log out and log in as **Production** (`production.test@dvsindustry.local` / `production`), then **Store**. | Role-based access: each role sees only its modules; Store cannot read security data (HTTP 403). |
| 9 | Show **Reports Center**. | Security and operational reports from the same data. |

## Questions to expect

* *How do you avoid false alarms?* Persistence over several windows (PROBABLE →
  CONFIRMED), a learned fire verifier, a motion gate before the fight model, and
  de-duplication. See `docs/REALTIME_SECURITY_ALERTS.md`.
* *How accurate are the models?* Fight F1 0.96 (344 test videos), fall F1 0.90,
  fire verifier F1 0.95, anomaly F1 0.79, evaluated with video-level splits. See
  `ML_AND_ANALYTICS_UPGRADE.md`.
* *How fast is an alert?* Detection → ERP median 0.43 s; ERP → screen median 11 ms.
* *Why rules for severity?* Auditable and policy-capped; a human makes the final call.

## If something goes wrong

| Symptom | Fix |
|---|---|
| Badge shows *Reconnecting…* | Backend not running, or the login expired: refresh the page. |
| No incidents appear | Check the perception terminal for `CONFIRMED …` lines and for `dashboard … failed`. |
| "Too many requests" | Raise `RATE_LIMIT_MAX` in `backend/.env` and restart the backend. |
| Camera window does not open | Another app is using the webcam; close it and restart `main.py`. |
