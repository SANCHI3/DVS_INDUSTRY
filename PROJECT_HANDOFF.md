# DVS Industries Project Handoff

This document explains the DVS Industries project for someone who has not worked on it before.

## 1. What This Project Is

DVS Industries is a manufacturing ERP and operations platform. It is designed to manage:

- Employees, departments, shifts, and attendance
- Materials, stock movement, and scrap
- Suppliers, clients, client orders, and purchase orders
- Production work orders and output
- Security incidents and alerts
- Reports, KPIs, and audit history
- User login, roles, permissions, and refresh sessions

It is a full-stack application:

```text
Browser
  -> React + Vite frontend on port 5173
  -> Express + TypeScript backend on port 3000
  -> PostgreSQL database on port 5433
```

Locally the database is your own PostgreSQL; the live deployment uses Neon (managed PostgreSQL), with the API on Render and the frontend on Vercel. There is no Supabase, Firebase, or third-party authentication service.

## 2. Current Local URLs

- Frontend: `http://localhost:5173/`
- Frontend alternative: `http://127.0.0.1:5173/`
- Backend: `http://localhost:3000/`
- API prefix: `http://localhost:3000/api/v1`
- Health check: `http://localhost:3000/api/v1/health`
- Metrics: `http://localhost:3000/api/v1/metrics`
- PostgreSQL: `localhost:5433`, database `dvs_factory`

The Vite development server proxies `/api` and `/uploads` to the backend.

## 3. Main Folders

```text
backend/
  src/server.ts              Starts the HTTP server
  src/app.ts                 Express middleware and route registration
  src/routes/                API endpoint definitions
  src/controllers/           Converts HTTP requests into service calls
  src/services/              Business rules and workflow logic
  src/repositories/          Prisma database reads and writes
  src/validators/            Zod request validation
  src/middleware/            Auth, RBAC, audit, errors, logging, uploads
  src/interfaces/            Domain DTOs and TypeScript contracts
  prisma/schema.prisma       Database model definitions
  prisma/migrations/         Versioned database migrations
  prisma/seed.ts             Initial roles and administrator seed
  uploads/profiles/          Profile images uploaded before they moved into the database
  ecosystem.config.cjs       PM2 production process configuration
  scripts/provision-security.ts  Creates app DB role and rotates admin password

frontend/
  src/main.tsx               React entry point
  src/app/App.tsx            Top-level page and dashboard selection
  src/app/components/        Login, home, admin, supplier, client screens
  src/lib/api.ts             Axios client, token attachment, refresh handling
  src/lib/auth.ts            Login, logout, token and user persistence
  src/lib/services/          Typed API calls by business module
  vite.config.ts             Vite aliases, API proxy, bundle chunks

ops/
  nginx/dvs-industry.conf    HTTPS reverse proxy template
  backup-postgres.ps1        Windows PostgreSQL backup script
  backup-postgres.sh         Linux PostgreSQL backup script
  README.md                  Production operations instructions
```

## 4. How Login Works

1. The user opens the frontend and selects a portal.
2. The login form sends `POST /api/v1/auth/login`.
3. The backend validates the email and password with bcrypt.
4. The backend updates `User.lastLogin`.
5. The backend creates a refresh-token record in `RefreshToken`.
6. The backend returns an access JWT and user profile.
7. The refresh token is placed in a secure HttpOnly cookie.
8. The frontend keeps the access token in memory only (never in browser storage). After a page reload the first API call gets a 401 and the client silently refreshes it using the cookie.
9. The frontend stores the safe user profile under `dvs_user`.
10. The user's backend role is mapped to a frontend dashboard role.
11. Axios attaches the access token to API calls and silently refreshes it after a 401 when possible.

The backend role is an object such as `{ name: "ADMIN" }`. The frontend auth adapter extracts the role name before selecting the dashboard.

### My Profile

Every admin, production and store user can open **My Profile** from the sidebar menu (admin) or by clicking their name at the bottom of the sidebar (all three roles). It shows name, email, role, phone and last login from `GET /api/v1/auth/me`, saves name and phone with `PATCH /api/v1/auth/me`, and changes the password with `PATCH /api/v1/auth/change-password`. A password change revokes every refresh session, so the user is sent back to the login page with "Password changed. Please log in again."

This page replaced the earlier technical Settings page (API, database, uptime, Node.js version). The `/api/v1/health` and `/api/v1/metrics` endpoints are still served for deployment checks and the start scripts; the frontend no longer calls them.

### Roles

- `ADMIN`: full access
- `MANAGER`: management and reports
- `HR`: workforce and employee operations
- `STORE`: inventory, suppliers, and supply chain
- `PRODUCTION`: production operations
- `SALES`: client orders and sales operations

The frontend currently maps `MANAGER` and `HR` to the admin-style dashboard, `PRODUCTION` to production, and `STORE`/`SALES` to the store/order area.

## 5. Where Data Is Stored

All durable business data is stored in PostgreSQL through Prisma. The database is `dvs_factory`.

| Business area | Prisma models | What is stored |
|---|---|---|
| Authentication | `Role`, `User`, `RefreshToken` | Roles, users, password hashes, last login, refresh sessions |
| Departments | `Department` | Department names, codes, managers, active/deleted state |
| Workforce | `Employee`, `Shift`, `Attendance` | Employee profiles, job data, shifts, clock-in/out, attendance status |
| Inventory | `Material`, `StockTransaction`, `ScrapRecord` | Material catalog, current stock, stock movements, scrap records |
| Orders | `Supplier`, `Client`, `ClientOrder`, `PurchaseOrder` | Business partners, sales orders, procurement orders, statuses, dates, values |
| Production | `WorkOrder`, `WorkOrderOutput` | Work orders, quantities, production output, rejected and scrap quantities |
| Security | `SecurityIncident`, `IncidentUpdate`, `SecurityAlert` | Incidents, comments/status changes, alerts, acknowledgements and resolutions |
| Auditing | `AuditLog` | Successful writes, login/logout, status changes, actor, endpoint, status code |

Passwords are stored only as bcrypt hashes. Plain passwords are never returned by the API.

Access JWTs are not stored in PostgreSQL. They are short-lived browser tokens. Refresh tokens are stored in PostgreSQL and also sent to the browser as an HttpOnly cookie.

Uploaded profile images are stored in PostgreSQL (the `StoredFile` table), because hosts such as Render wipe the server's disk on every deploy. They are served at `/uploads/profiles/<file>` as before; images uploaded earlier to `backend/uploads/profiles/` are still served from disk. The upload checks the file's actual bytes, so only real JPEG, PNG and WebP images are accepted (5 MB max).

Password-reset tokens are currently kept in backend memory. They expire after 15 minutes but are lost if the backend restarts. A database table or Redis should be added before using password reset in production.

## 6. How New Records Are Created

The normal data flow is:

```text
Frontend form
  -> frontend/src/lib/services/<module>.service.ts
  -> Axios /api/v1 request
  -> route validation with Zod
  -> authentication and authorization middleware
  -> controller
  -> service business rules
  -> repository
  -> Prisma
  -> PostgreSQL
```

For example, creating a purchase order:

1. The Orders page loads real suppliers from PostgreSQL.
2. The user selects a supplier and enters material, quantity, cost, and delivery date.
3. The frontend sends `POST /api/v1/orders/purchase-orders` with the supplier's real database ID.
4. The backend verifies the supplier exists and is active.
5. The repository inserts a `PurchaseOrder` row.
6. The frontend reloads the purchase-order list from the API.
7. Refreshing the browser still shows the saved row because it is in PostgreSQL.

The same pattern is used for client orders, materials, employees, work orders, incidents, and other persisted modules.

## 7. API Modules

| Prefix | Purpose |
|---|---|
| `/api/v1/auth` | Login, register, refresh, logout, profile, password changes |
| `/api/v1/departments` | Department CRUD and soft deletion |
| `/api/v1/employees` | Employee lifecycle and profile image upload |
| `/api/v1/workforce` | Shifts, attendance, clock-in/out, trends |
| `/api/v1/inventory` | Materials, stock transactions, scrap |
| `/api/v1/orders` | Suppliers, clients, client orders, purchase orders |
| `/api/v1/production` | Work orders, output, KPIs, trends |
| `/api/v1/security` | Incidents, incident updates, alerts |
| `/api/v1/reports` | Dashboard and module reports |
| `/api/v1/audit` | Audit log queries |
| `/api/v1/health` | Database-aware readiness check |
| `/api/v1/metrics` | Basic uptime, memory, and Node.js metrics |

## 8. Order Persistence Status

The order page previously inserted demo rows into React state when an API request failed. That meant the row disappeared after refresh.

That issue has been corrected:

- Client and supplier lists are loaded from the database.
- New orders use a real `clientId`.
- New purchase orders use a real `supplierId`.
- Random frontend-only IDs are no longer used for saved records.
- API errors are shown to the user instead of being silently ignored.
- Create, approve, and dispatch operations reload data from PostgreSQL after success.

The page can still display an empty list when the database contains no records. It no longer treats fake demo rows as saved business data.

## 9. Environment Configuration

The backend reads `backend/.env`, which is ignored by Git. Important settings include:

- `DATABASE_URL`: low-privilege runtime database connection
- `DIRECT_URL`: privileged connection used only for Prisma migrations
- `PORT`: backend port, normally `3000`
- `NODE_ENV`: `development`, `test`, or `production`
- `JWT_SECRET`: access-token signing secret
- `REFRESH_TOKEN_SECRET`: refresh-token signing secret
- `CORS_ORIGINS`: allowed frontend origins
- `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD`: seed credentials

Never copy real `.env` values into documentation, source control, screenshots, or chat.

## 10. First-Time Local Setup

Prerequisites:

- Node.js 20 or newer
- PostgreSQL running on port `5433`
- Database `dvs_factory`

Backend:

```powershell
cd backend
npm install
npm run db:generate
npm run db:migrate:deploy
npm run db:seed
npm run dev
```

Frontend, in another terminal:

```powershell
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173/`.

The local admin credentials are defined in the ignored `backend/.env`. Do not assume the old example password from historical documentation is still valid.

## 11. Useful Validation Commands

```powershell
cd backend
npm run build
npm run lint
npm run format:check
npm test
npm run db:migrate:deploy
npm run docs:api          # regenerate docs/API.md after changing routes

cd ..\frontend
npm run typecheck
npm run lint
npm test
npm run build
# End-to-end (needs the backend database migrated and seeded):
$env:E2E_ADMIN_PASSWORD = "<SEED_ADMIN_PASSWORD>"; npm run test:e2e
```

A healthy local installation should have:

- Backend build passing
- Backend lint passing
- All backend tests passing (207 at the time of writing)
- Frontend production build passing
- No pending Prisma migrations
- `GET /api/v1/health` returning `{ "status": "ok", "database": "ok" }`

## 12. Production Operation

The repository includes:

- PM2 configuration in `backend/ecosystem.config.cjs`
- Nginx HTTPS proxy template in `ops/nginx/dvs-industry.conf`
- Windows and Linux PostgreSQL backup scripts
- Deployment notes in `ops/README.md`

Production still needs environment-specific work:

1. A real domain and DNS A records pointing to the server
2. A public server with ports 80 and 443 available
3. Let’s Encrypt/Certbot certificate issuance
4. PM2 startup registration and saved process list
5. Daily backups copied to separate storage
6. External uptime monitoring for `/api/v1/health`
7. Centralized log collection

The local project is not the same thing as a production deployment. DNS, certificates, firewall rules, cloud storage, and server credentials must be configured for the target environment.

## 13. Current Progress

### Working

- Backend API modules and Prisma repositories
- PostgreSQL schema and 15 migrations
- Database seed roles and administrator
- JWT login, refresh, logout, and RBAC middleware
- Real persistence for requested business models
- Order create/approve/dispatch persistence path
- Frontend API service layer
- Database-aware health endpoint
- Basic metrics endpoint
- Audit logging for successful writes
- Backend build, lint, formatting, and test suite
- Frontend production build and bundle splitting
- PM2, Nginx, and backup templates

### Done since the first handoff

- The technical Settings page was replaced by **My Profile** (see section 4)
- Password-reset tokens are stored in PostgreSQL (`PasswordResetToken`); reset
  emails are sent over SMTP when `SMTP_HOST` is set (logged in development)
- Real-time security alerts: SSE stream, live Security page, priority popup on
  every page, incident escalation API (see `docs/REALTIME_SECURITY_ALERTS.md`)
- One-command fresh-clone setup (`scripts/setup.mjs`) and demo logins for every role
- Frontend unit tests (Vitest) for the alert rules and stream parser
- Frontend dependency audit: 0 vulnerabilities
- End-to-end tests (Playwright, `frontend/e2e/`) for sign-in, session restore,
  role routing and every admin section, run in CI against PostgreSQL
- Profile photos stored in the database; the login waits for a sleeping API
- Request IDs (`X-Request-Id`) on every response and log line
- Generated API reference: `docs/API.md`
- Demo mode and one-command start (`start-demo.ps1` / `start-demo.sh`), evaluation
  scripts and `docs/RESULTS.md`, incident evidence view;
  placeholder "Unavailable" cards replaced with live data or removed

### Important remaining work

- Configure a real SMTP provider (`SMTP_*` in `backend/.env`) for production reset emails
- End-to-end tests for the create/edit forms and the live alert flow (sign-in,
  navigation and role routing are covered)
- Use a real production domain, TLS, backup destination, monitoring service, and centralized logs
- Backend dependency audit: production dependencies have 0 advisories
  (`deepmerge-ts` is pinned to 8.x through `overrides`). 8 *high* advisories
  remain in development-only tooling, where npm's fixes are breaking upgrades;
  Dependabot now proposes updates weekly.
- Add backup restore drills and disaster-recovery documentation

## 14. How to Understand a New Feature

When adding or debugging a feature, follow this order:

1. Find the frontend page or form.
2. Find its module service under `frontend/src/lib/services`.
3. Find the matching route under `backend/src/routes`.
4. Check the Zod validator.
5. Check the controller and service business rules.
6. Check the repository method that calls Prisma.
7. Check the related model and migration in `backend/prisma`.
8. Confirm the frontend reloads the saved API response rather than keeping a local-only copy.
9. Add or update a backend test.
10. Run build, lint, tests, and a live API smoke test.
