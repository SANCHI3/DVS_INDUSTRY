# 5. Implementation details

## 5.1 Technology stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, TypeScript, Tailwind CSS, Recharts, Axios (JWT interceptor with silent refresh), Server-Sent Events |
| Backend | Node.js, Express 5, TypeScript, Prisma 6 ORM, Zod validation, JWT (jsonwebtoken), bcrypt, Helmet, rate limiting, Winston logging, Vitest + Supertest |
| Database | PostgreSQL, 22 models, 14 migrations |
| Perception | Python 3.12, PyTorch + torchvision (R3D-18, GRU), Ultralytics YOLOv8, supervision (ByteTrack), OpenCV, scikit-learn (gradient boosting, Random Forest), NumPy (autoencoder), Pydantic, pytest |
| LLM (optional) | Any OpenAI-compatible chat API (e.g. Groq), configured by `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY` |
| Ops | PM2, Nginx template, PostgreSQL backup scripts, GitHub Actions CI (backend, frontend, perception jobs) |

## 5.2 Repository layout

```text
backend/              Express API: routes → controllers → services → repositories → Prisma
frontend/             React dashboard (admin, production, store, supplier, client portals)
perception-service/   CCTV AI: main.py and one folder per stage/model
  detection/ tracking/ temporal/ confirmation/ severity/ evidence/ reporting/ llm/
  rgb_fight_model/ fall_gru/ fall_rf/ fire_verifier/ anomaly/ explain/
  evaluation/         results table, false-alarm and speed measurement
  models/             trained weights + metrics JSON (fight weights via Git LFS)
  config/             cameras.yaml (sources), thresholds.yaml (all tunables)
docs/                 RESULTS.md, figures, report chapters, demo script
start-demo.ps1/.sh    one-command demo
```

## 5.3 Processing loop (`perception-service/main.py`)

1. Read the latest frame. Live streams use a background thread with a
   one-slot buffer, so latency never accumulates. Files are read
   synchronously at the processing rate.
2. Resize to 640×480. The full-resolution frame goes to the evidence buffer.
3. Run YOLOv8n, then ByteTrack, then update the temporal buffer.
4. Run the rule engine and the four detectors (fight, fire/smoke, fall,
   anomaly); each returns candidates.
5. Pass the candidates to event confirmation, which returns tiered events.
6. Apply severity, then de-duplication, then the reporter (save, evidence,
   dashboard, LLM).
7. Pace the loop at `detection_fps` = 10. The detectors use wall-clock time
   for their windows.

Each optional detector is created through `start_optional()`. A missing
checkpoint, a Git LFS pointer instead of the weights, or a load error disables
only that detector, with a message saying how to fix it. Fire/smoke falls
back to the CPU when there is no CUDA GPU.

**Demo mode** (`--demo`) plays every video in `demo_videos/` in a loop
through the same pipeline. Tracking state is reset at each clip boundary, and
the anomaly calibration for demo clips is stored separately so it never
changes the real camera's threshold. `start-demo.ps1` / `start-demo.sh`:

- check tools, `.env` files, PostgreSQL, dependencies, GPU and model files,
  with an actionable message for each failure;
- reuse or start the backend and frontend;
- run the perception service, restarting it after a native crash.

## 5.4 Training procedures (summarised from the code)

| Model | Data | Split / protocol | Threshold choice |
|---|---|---|---|
| R3D-18 v2 (`rgb_fight_model/train.py`) | 2,300 fight / non-fight videos **[verify sources, see chapter 2]** | fixed train/val/test split by video; clips at 10 fps of real time; cosine LR, CCTV-style lighting augmentation, 3-clip validation | on validation, at precision ≥ 0.90 under the live 2-of-3 rule (`calibrate_runtime.py`) |
| Fall BiGRU (`fall_gru/train.py`) | 160 videos (79 fall, 81 not-fall, 48 events) **[verify dataset source]** | 5-fold cross-validation grouped by event (all camera angles of one event in one fold); time-stretch augmentation, pose dropout | out-of-fold, at precision ≥ 0.85 |
| Fire verifier (`fire_verifier/train.py`) | FIRESENSE videos (27 fire, 22 smoke), YOLO detections | leave-one-video-out | probability 0.5, 2 accepted windows |
| Autoencoder v2 (`anomaly/train_autoencoder.py`) | 81 not-fall (normal) videos; 79 fall videos only for testing | split by event: 47 train, 11 threshold, 23 test | 95th percentile of validation-normal error |

## 5.5 Real-time delivery

- **Create:** `POST /api/v1/security/incidents` with the perception
  `incident_id` as `incidentNumber`. A resent incident is recognised and
  ignored, so retries are safe.
- **Live push:** an in-process event bus publishes `incident.created`,
  `incident.updated` and `incident.deleted` on `/api/v1/security/stream`
  (SSE). The browser keeps one connection per tab and reconnects with backoff.
- **Priority pop-up** (`frontend/src/lib/priorityRules.ts`): shown on any page
  for fire/smoke, for CRITICAL incidents, for confidence ≥ 0.9, and when an
  incident escalates to CRITICAL.

## 5.6 Evidence in the dashboard

`GET /api/v1/security/incidents/:id/evidence` joins the database incident with
the perception service's local records on `incidentNumber`. It reads
`incidents.jsonl`, `incident_updates.jsonl` and `evidence_updates.jsonl` under
`PERCEPTION_OUTPUT_DIR`, and needs no schema change. It returns:

- the tier, confidence and confidence basis;
- a plain-language explanation (interaction evidence, fire dynamics and
  verifier, anomaly factors, fall reasons);
- the evidence file list.

`/evidence/file` serves a file only if it is listed for that incident and
lies inside the output directory. Raw model output is returned to ADMIN
only, and the dashboard also hides the confidence basis from other roles.

## 5.7 Security measures

- **Authentication:** short-lived access JWTs, plus refresh tokens stored
  server-side and sent as HttpOnly cookies.
- **Passwords:** bcrypt hashes.
- **Authorisation:** role checks on every route. The perception service has
  its own least-privilege role.
- **Requests:** Zod schemas validate request bodies, queries and route
  parameters (132 validated routes); Helmet headers; rate limiting.
- **Audit:** every successful write is logged.
- **Secrets:** stored only in `.env` files, which are git-ignored.
  `scripts/setup.mjs` generates them.
