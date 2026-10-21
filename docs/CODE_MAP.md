# Code map: how to explain this project in the viva

The repository looks big (about 45,000 lines), but most of it repeats a few
simple patterns. **You only need to understand about 25 files**; the rest is
the same pattern applied to another module, tests, or training scripts.

```
frontend (React)  ──REST + JWT──►  backend (Express)  ──Prisma──►  PostgreSQL
      ▲                                  ▲
      └──── live alerts (SSE) ───────────┤
                                         │ confirmed incidents (REST)
CCTV ──► perception-service (Python AI) ─┘
```

## 1. Backend: one pattern, used 12 times

Every module (inventory, orders, production, workforce, security, reports,
users, …) follows the **same five-step path**. Explain it once with any module.

| Step | Folder | What it does | Example (purchase order) |
|---|---|---|---|
| 1. Route | `backend/src/routes/` | URL + who may call it | `orders.routes.ts` → `POST /api/v1/orders/purchase-orders`, `authorize(ADMIN, MANAGER, STORE)` |
| 2. Validator | `backend/src/validators/` | Checks the data shape (Zod) | `orders.validator.ts` |
| 3. Controller | `backend/src/controllers/` | Reads the request, calls the service, sends the reply | `orders.controller.ts` |
| 4. Service | `backend/src/services/` | Business rules | `orders.service.ts` (supplier must exist and be active) |
| 5. Repository | `backend/src/repositories/` | Database reads/writes with Prisma | `orders.repository.ts` |

The tables themselves are defined in `backend/prisma/schema.prisma`.

**Files that run for every request** (`backend/src/middleware/`):

| File | Job |
|---|---|
| `authenticate.ts` | Checks the login token (JWT) |
| `authorize.ts` | Checks the user's role (RBAC) |
| `validateRequest.ts` | Runs the Zod validator |
| `auditLog.ts` | Records every change in the audit log |
| `errorHandler.ts` | Turns errors into clean JSON replies |

**Special parts worth knowing:**

| Feature | Files |
|---|---|
| App start-up | `server.ts` (starts the server), `app.ts` (security headers, CORS, rate limit, routes) |
| Live alerts | `lib/securityEvents.ts` (event bus) + `GET /security/stream` in `routes/security.routes.ts` |
| Smart Analytics maths | `analytics/forecasting.ts` (Holt / Croston), `inventoryMath.ts`, `productionMath.ts`, `supplierMath.ts`, `engine.ts` (puts them together) |
| Ask DVS assistant | `assistant/tools.ts` (read-only tools per role), `llm.ts` (calls the LLM), `grounding.ts` (rejects numbers not in the data), `assistant.service.ts` (the loop) |

## 2. Frontend: page + service file

| What | Where |
|---|---|
| Which dashboard a user sees | `frontend/src/app/App.tsx` → `admin/AdminApp.tsx` (menu sections) |
| One page per menu item | `frontend/src/app/components/admin/*Page.tsx` |
| One API file per module | `frontend/src/lib/services/*.service.ts` |
| Login and token refresh | `lib/auth.ts`, `lib/api.ts` |
| Live alerts | `lib/securityStream.ts` (SSE connection), `lib/priorityRules.ts` (when to pop up), `shared/PriorityIncidentAlert.tsx` |
| Ask DVS chat | `shared/AskDvs.tsx` + `lib/services/assistant.service.ts` |

Pattern: page → service file → backend route. Explain one page and the rest
are the same.

## 3. AI service (`perception-service/`): follow one frame

`main.py` runs this loop about 10 times per second:

| Order | File | What happens |
|---|---|---|
| 1 | `ingestion/stream_reader.py` | Reads a frame from the camera or a video |
| 2 | `detection/yolo_detector.py` | YOLOv8 finds the people |
| 3 | `tracking/byte_tracker.py` | ByteTrack gives each person an ID |
| 4 | `temporal/temporal_buffer.py` | Remembers each person's last few seconds |
| 5a | `temporal/rgb_action_recognition.py` (+ `motion_gate.py`, `interaction.py`) | **Fight**: R3D-18 video model, only when two people are close and moving |
| 5b | `temporal/fall_gru_recognition.py` | **Fall**: body keypoints + BiGRU; Critical if the person stays down |
| 5c | `temporal/fire_smoke_recognition.py` (+ `fire_dynamics.py`, `fire_verifier/runtime.py`) | **Fire/smoke**: YOLO + flicker check + learned verifier |
| 5d | `temporal/scene_anomaly.py` (+ `anomaly/autoencoder.py`) | **Unusual activity**: autoencoder trained on normal video |
| 5e | `temporal/rule_engine.py` | **Crowd**: a rule on the tracked people |
| 6 | `confirmation/event_confirmation.py` | Event must repeat (N of M checks) → PROBABLE / CONFIRMED |
| 7 | `confirmation/incident_dedup.py` | One ongoing event = one incident |
| 8 | `severity/severity_rules.py` | Low / Medium / High / Critical by fixed rules |
| 9 | `evidence/clip_extractor.py`, `explain/gradcam.py` | Snapshots, clips, Grad-CAM heatmaps |
| 10 | `reporting/incident_report.py` (+ `dashboard_client.py`) | Saves the incident and sends it to the backend |
| 11 | `llm/summarizer.py` | Optional plain-language summary, checked so it cannot add facts |

Settings for all of this are in `perception-service/config/thresholds.yaml`
(numbers) and `config/cameras.yaml` (cameras).

## 4. Five end-to-end stories (good viva answers)

1. **Login:** `LoginPage.tsx` → `lib/auth.ts` → `POST /auth/login` → `auth.service.ts` checks the bcrypt password → returns a JWT; the refresh token goes in a secure cookie.
2. **Purchase order:** Orders page → `orders.service.ts` (frontend) → route → validator → controller → service → repository → PostgreSQL; the page reloads the list from the server.
3. **Fire on camera → pop-up:** frame → YOLO fire/smoke → flicker check + verifier → confirmed after 3 s → `incident_report.py` POSTs to `/security/incidents` → `securityEvents.ts` pushes it over SSE → `PriorityIncidentAlert.tsx` shows the pop-up on every page.
4. **Ask DVS question:** `AskDvs.tsx` → `POST /assistant/ask` → LLM picks a tool (e.g. stock-out forecast) → backend runs it with the user's role → LLM writes the answer → `grounding.ts` checks every number exists in the data.
5. **Stock forecast:** Smart Analytics page → `GET /analytics/inventory` → `engine.ts` builds daily demand → `forecasting.ts` picks Holt or Croston → reorder point and stock-out date.

## 5. What you don't need to explain line by line

| Folder | What it is |
|---|---|
| `*/__tests__/`, `perception-service/test_*.py`, `frontend/e2e/` | Automated tests (say: "300+ tests run on every push") |
| `rgb_fight_model/`, `fall_gru/`, `fall_rf/`, `fire_verifier/train.py`, `anomaly/train_autoencoder.py` | **Training** scripts: used once to create the model files in `models/` |
| `perception-service/evaluation/` | Scripts that produced the numbers in `docs/RESULTS.md` |
| `temporal/pose_fall_recognition.py`, `temporal/fire_verifier.py` | Backup detectors, used only if a model file is missing |
| `backend/scripts/`, `scripts/`, `ops/`, `start-demo.*` | Setup, demo, backup and deployment helpers |
| `backend/src/interfaces/`, `types/`, `constants/` | Type definitions and fixed values |

## 6. Suggested split for a team of four

| Person | Part | Key files |
|---|---|---|
| 1 | ERP backend + database + security (login, roles, audit) | section 1 |
| 2 | Frontend + live alerts + Ask DVS | sections 2 and story 4 |
| 3 | AI pipeline: detection, tracking, confirmation, evidence | section 3, rows 1–4 and 6–11 |
| 4 | AI models + results + Smart Analytics | section 3, rows 5a–5e; `docs/RESULTS.md`; story 5 |
