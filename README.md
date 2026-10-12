# DVS Industries — Enterprise ERP Platform

Full-stack ERP system for DVS Industries manufacturing operations.

For a complete newcomer handoff covering architecture, storage, workflows, setup, current progress, and remaining work, read [PROJECT_HANDOFF.md](PROJECT_HANDOFF.md). Deployment notes are in [ops/README.md](ops/README.md).

---

## Architecture

```
Frontend (React + Vite)  →  Backend (Express + TypeScript)  →  PostgreSQL
     localhost:5173               localhost:3000                 localhost:5432/dvs_factory
                                        ↑  incidents (REST)  +  live stream (SSE) → browser
                             Perception service (Python, CCTV/webcam AI models)
```

**File uploads** — stored locally at `backend/uploads/`, served as static assets by Express.  
**No Supabase. No cloud database. No third-party auth.**

---

## Modules

| Module | API prefix | Description |
|--------|-----------|-------------|
| Auth | `/api/v1/auth` | JWT login/logout/refresh, RBAC roles |
| Departments | `/api/v1/departments` | Department CRUD + soft-delete |
| Employees | `/api/v1/employees` | Full employee lifecycle, profile images |
| Workforce | `/api/v1/workforce` | Shifts + Attendance (clock-in/out, bulk mark, trend) |
| Inventory | `/api/v1/inventory` | Materials, stock transactions, scrap records |
| Orders | `/api/v1/orders` | Client orders + Purchase orders, full lifecycle |
| Production | `/api/v1/production` | Work orders, output recording, KPIs |
| Security | `/api/v1/security` | Incidents + Alerts with state machines |
| Reports | `/api/v1/reports` | KPI dashboard, all module reports |
| Audit | `/api/v1/audit` | Auto-captured audit trail for all write operations |
| Smart Analytics | `/api/v1/analytics` | Demand forecasting, dynamic reorder point, ABC-XYZ, stock anomaly detection, OEE + SPC, Plant Health Index |

---

> **AI & analytics:** see [ML_AND_ANALYTICS_UPGRADE.md](ML_AND_ANALYTICS_UPGRADE.md) for the multi-model CCTV
> perception pipeline (YOLOv8, R3D-18, pose-LSTM, pose + Random Forest fall model, unsupervised
> autoencoder, fire verifier) and the Smart Analytics module.

---

## Roles

| Role | Access |
|------|--------|
| ADMIN | Full system access |
| MANAGER | Cross-department oversight, reports |
| HR | Workforce, employees, attendance |
| PRODUCTION | Production module |
| STORE | Orders & supply chain |
| SALES | Client orders |

---

## Tech Stack

**Backend**
- Node.js + TypeScript + Express 5
- Prisma 6 ORM + PostgreSQL 18
- Zod validation, JWT auth, bcrypt, multer
- Vitest + Supertest (77 tests)

**Frontend**
- React 18 + Vite + TypeScript
- Tailwind CSS + Recharts
- Axios with JWT interceptor + auto-refresh
- Pages use the real API for persisted records; presentation-only empty states may appear when the database has no records

**Database**
- PostgreSQL 18.4 (local)
- 20 models, 9 migrations, 104 indexes, 188 constraints

---

## Getting Started (fresh clone)

### Prerequisites
- Node.js 20+
- PostgreSQL 15+ running, with an empty database named `dvs_factory`
  (`createdb dvs_factory`, or create it in pgAdmin)
- Python 3.10–3.12 (for the CCTV perception service; an NVIDIA GPU is optional)
- **Git LFS** — two fight-detection models are stored with it. Before or after cloning:
  ```bash
  git lfs install
  git lfs pull
  ```

### 1. Create the `.env` files

`.env` files hold secrets and are never committed. One command creates both
(`backend/.env` and `perception-service/.env`) with fresh secrets and matching
camera-service credentials:

```bash
node scripts/setup.mjs --db-url "postgresql://postgres:<your-db-password>@localhost:5432/dvs_factory"
```

Add `--install` to also run `npm install`, the database migrations, the seed
and `pip install` in one go. Existing `.env` files are kept (use `--force` to
regenerate them). The script prints the logins it created.

### 2. Install, migrate and seed (skip if you used `--install`)

```bash
cd backend  && npm install && npx prisma migrate deploy && npm run db:seed
cd frontend && npm install
cd perception-service && pip install -r requirements.txt
```

### 3. Run

```bash
cd backend  && npm run dev          # → http://localhost:3000
cd frontend && npm run dev          # → http://localhost:5173
cd perception-service && python main.py --camera CAM-01    # webcam + live window (press q to quit)
```

### Logins (development seed)

| Portal | Email | Password |
|--------|-------|----------|
| Administrator | `admin@dvsindustry.com` | `SEED_ADMIN_PASSWORD` in `backend/.env` (printed by the setup script) |
| Production | `production.test@dvsindustry.local` | `production` |
| Store | `store.test@dvsindustry.local` | `store` |
| Supplier | `supplier.test@dvsindustry.local` | `supplier` |
| Client | `client.test@dvsindustry.local` | `client` |

> Demo passwords are for local development only; the seed never creates the
> demo accounts when `NODE_ENV=production`.

---

## Environment Variables

`scripts/setup.mjs` fills these in. To do it by hand, copy `backend/.env.example` to `backend/.env` and set:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | 64-byte hex secret for access tokens |
| `REFRESH_TOKEN_SECRET` | 64-byte hex secret for refresh tokens |
| `PORT` | Backend port (default: 3000) |
| `CORS_ORIGINS` | Frontend origin (default: http://localhost:5173) |

Generate secrets:
```bash
node -e "const c=require('crypto'); console.log(c.randomBytes(64).toString('hex'))"
```

---

## Database Schema

20 models across 4 domains:

**Auth:** Role, User, RefreshToken  
**Workforce:** Department, Shift, Employee, Attendance  
**Inventory:** Material, StockTransaction, ScrapRecord  
**Orders:** Supplier, Client, ClientOrder, PurchaseOrder  
**Production:** WorkOrder, WorkOrderOutput  
**Security:** SecurityIncident, IncidentUpdate, SecurityAlert  
**Audit:** AuditLog  

---

## Tests

```bash
cd backend
npm test
# 77 tests — 8 test files — 0 failures
```

---

## Project Status

| Area | Status |
|------|--------|
| Backend — all 10 modules | ✅ Complete |
| Database — 9 migrations applied | ✅ Complete |
| Backend tests — 77/77 passing | ✅ Complete |
| Frontend — API layer (12 services) | ✅ Complete |
| Frontend — all pages wired to real API | ✅ Complete |
| Frontend production build | ✅ Clean |
