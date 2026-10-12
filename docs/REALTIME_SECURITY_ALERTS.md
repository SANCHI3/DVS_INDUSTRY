# Real-time security alerts: from camera frame to operator screen

This document explains how a detection by the CCTV perception service becomes a
single incident in the ERP and reaches every logged-in operator within about a
second, and why each stage exists. Model accuracy is covered separately in
[ML_AND_ANALYTICS_UPGRADE.md](../ML_AND_ANALYTICS_UPGRADE.md).

## 1. Pipeline

```
 camera / RTSP / video file
        │  frames (10 fps processing)
        ▼
 YOLOv8 detection ─► ByteTrack ─► temporal buffer (per-person history)
        │
        ├─ rule engine ............ loitering, crowd            (geometry over time)
        ├─ R3D-18 video model ..... fight                      (gated by a motion check)
        ├─ YOLOv8 + verifier ...... fire / smoke               (learned look-alike filter)
        ├─ pose + BiGRU ........... fall  ──► "still down?" watch (serious fall)
        └─ autoencoder ............ scene anomaly              (unsupervised)
        │  event candidates
        ▼
 1. Event confirmation      PROBABLE / CONFIRMED tiers; one noisy frame never alerts
 2. Incident de-duplication one ongoing event = one incident (escalations update it)
 3. Severity rules          deterministic, auditable (no learned severity)
 4. Evidence                before/after clips + keyframes saved at confirmation
        │  REST (service account, JWT)
        ▼
 ERP backend (Express + PostgreSQL)
   POST  /security/incidents            create (CONFIRMED only)
   PATCH /security/incidents/escalate   raise severity / confidence, never lower
        │  in-process event bus
        ▼
   GET   /security/stream               Server-Sent Events push
        │
        ▼
 Browser: Security page updates live; priority popup on every page
```

## 2. Incident lifecycle

| Step | Where | Rule |
|---|---|---|
| Candidate | detector | A model/rule fires on one evaluation window. |
| PROBABLE | `confirmation/event_confirmation.py` | Persists over N of M windows (per event type). Saved locally with evidence; **not** sent to the ERP. |
| CONFIRMED | same | Stricter persistence, or corroboration (e.g. fire **and** smoke, or one verified class sustained 3 s). Created in the ERP. |
| Repeat | `confirmation/incident_dedup.py` | Same camera + event type (+ zone for loitering) within the window (fight 60 s, loitering 120 s, fall 45 s…) updates the open incident instead of creating a new one. |
| Escalation | dedup + `reporting/incident_report.py` | Higher tier, higher severity, or confidence +0.05 or more → `PATCH /escalate`; recorded in the incident history. |
| Serious fall | `temporal/fall_gru_recognition.py` | After a fall the person is watched; still down (torso not upright) after 20 s → severity CRITICAL on the **same** incident. Standing or sitting up for 2 s cancels. |

### Why a de-duplication stage
Learned detectors score only some frames and the tracker re-assigns person IDs
during fast motion. Without it, one 60-second fight produced a new incident
every few seconds. Tests: `perception-service/test_incident_dedup.py`.

### Why severity is rule-based
Severity drives who gets interrupted. Keeping it deterministic
(`severity/severity_rules.py`, `config/thresholds.yaml`) makes every alert
explainable and lets policy caps hold (e.g. unsupervised anomalies never exceed
MEDIUM).

## 3. Delivery to the browser

* **Server-Sent Events** instead of polling: one long-lived HTTP connection per
  tab, server → browser only, which is exactly the direction alerts flow. It
  works through the existing Vite/nginx proxy and JWT auth with no extra
  infrastructure. WebSockets would add a second protocol for no benefit here.
* The stream is exempt from the per-IP rate limit (it is one connection, not
  request traffic) and sends a heartbeat every 25 s so proxies keep it open.
* The client (`frontend/src/lib/securityStream.ts`) shares one connection per
  tab, reconnects with backoff, refreshes an expired login before
  reconnecting, and waits out a rate-limit window instead of hammering.
* After any gap in the connection, the popup fetches incidents created during
  the gap, so a priority incident is never silently missed.

### Priority popup rules (`frontend/src/lib/priorityRules.ts`)

| Shown when | Reason |
|---|---|
| New incident with AI confidence ≥ 90 % | The operator asked for high-confidence events to interrupt. |
| Severity becomes CRITICAL (e.g. serious fall) | Possible injury: needs attention now. |
| Confidence of an open incident crosses 90 % | Detections usually start uncertain and firm up seconds later. |
| Any confirmed fire / smoke | Life safety; the fire model's scores rarely reach 0.9 even on real flames. |

Resolved or closed incidents never pop up. Tests: `frontend/src/lib/__tests__/`.

## 4. Measured latency

Measured on the development machine (NVIDIA GPU with CUDA, webcam, local
PostgreSQL) on 12 Oct 2026.

| Stage | Result | How measured |
|---|---|---|
| Detection → ERP record | median **0.43 s** over 57 live incidents | `createdAt − occurredAt` of perception incidents |
| … fight / fall | median 0.03 s | created at CONFIRMED immediately |
| … fire / smoke | median 3.4 s | the deliberate 3 s sustained-flame confirmation |
| … scene anomaly | median 0.7 s, long tail (p90 82 s) | anomalies stay PROBABLE until confirmed |
| ERP → browser (SSE) | median **11 ms**, p90 14 ms, max 24 ms (n = 20) | update request → event received through the Vite proxy |

End to end, a confirmed fight or fall reaches every open dashboard in well
under a second after confirmation. The dominant delay is the confirmation
policy itself, which is the deliberate trade-off against false alarms.

## 5. Known limitations

* The event bus is in-process: with several backend instances it must move to
  Postgres `LISTEN/NOTIFY` or Redis pub/sub (`backend/src/lib/securityEvents.ts`).
* Two genuinely separate fights on one camera inside the de-duplication window
  are reported as one incident.
* The serious-fall watch stops if the person is out of view for more than 8 s,
  and needs the camera to see the person on the ground.
* Updates that fail while the backend is unreachable are not retried
  (incident *creation* is: it goes through a durable outbox).
