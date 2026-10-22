# API reference

Generated from the router by `npm run docs:api` (backend). Do not edit by hand.

147 endpoints. All live under `/api/v1`; responses use the envelope
`{ success, data, message?, meta? }` or `{ success: false, error: { code, message } }`.
Signed-in calls send `Authorization: Bearer <access token>`; the refresh token
is an httpOnly cookie used by `POST /api/v1/auth/refresh`. Every response
carries an `X-Request-Id` header that matches the server logs.

Also served: `GET /api/v1/health` (public) and `GET /uploads/profiles/<file>`
(profile photos, public).

## analytics

| Method | Path | Who may call it |
|---|---|---|
| GET | `/api/v1/analytics/inventory` | ADMIN, MANAGER, STORE |
| GET | `/api/v1/analytics/inventory/:materialId/forecast` | ADMIN, MANAGER, STORE |
| GET | `/api/v1/analytics/production` | ADMIN, MANAGER, PRODUCTION |
| GET | `/api/v1/analytics/suppliers` | ADMIN, MANAGER, STORE |
| GET | `/api/v1/analytics/plant-health` | ADMIN, MANAGER |

## assistant

| Method | Path | Who may call it |
|---|---|---|
| GET | `/api/v1/assistant/status` | Any signed-in user |
| POST | `/api/v1/assistant/ask` | Any signed-in user |

## auth

| Method | Path | Who may call it |
|---|---|---|
| POST | `/api/v1/auth/login` | Public |
| POST | `/api/v1/auth/refresh` | Public |
| POST | `/api/v1/auth/forgot-password` | Public |
| POST | `/api/v1/auth/reset-password` | Public |
| POST | `/api/v1/auth/logout` | Any signed-in user |
| GET | `/api/v1/auth/me` | Any signed-in user |
| PATCH | `/api/v1/auth/me` | Any signed-in user |
| PATCH | `/api/v1/auth/change-password` | Any signed-in user |
| POST | `/api/v1/auth/register` | ADMIN |
| GET | `/api/v1/auth/users` | ADMIN |
| GET | `/api/v1/auth/users/employees` | ADMIN |
| PATCH | `/api/v1/auth/users/:id` | ADMIN |
| PATCH | `/api/v1/auth/users/:id/deactivate` | ADMIN |
| GET | `/api/v1/auth/roles` | ADMIN, MANAGER |

## audit

| Method | Path | Who may call it |
|---|---|---|
| GET | `/api/v1/audit` | ADMIN |
| GET | `/api/v1/audit/:id` | ADMIN |

## departments

| Method | Path | Who may call it |
|---|---|---|
| POST | `/api/v1/departments` | ADMIN, HR |
| GET | `/api/v1/departments` | ADMIN, MANAGER, HR, STORE, PRODUCTION, SALES |
| GET | `/api/v1/departments/:id` | ADMIN, MANAGER, HR, STORE, PRODUCTION, SALES |
| PATCH | `/api/v1/departments/:id` | ADMIN, HR |
| DELETE | `/api/v1/departments/:id` | ADMIN |
| PATCH | `/api/v1/departments/:id/restore` | ADMIN |

## employees

| Method | Path | Who may call it |
|---|---|---|
| GET | `/api/v1/employees/statistics` | ADMIN, MANAGER, HR |
| POST | `/api/v1/employees` | ADMIN, HR |
| GET | `/api/v1/employees` | ADMIN, MANAGER, HR, STORE, PRODUCTION, SALES |
| GET | `/api/v1/employees/:id` | ADMIN, MANAGER, HR, STORE, PRODUCTION, SALES |
| PATCH | `/api/v1/employees/:id` | ADMIN, HR |
| DELETE | `/api/v1/employees/:id` | ADMIN |
| PATCH | `/api/v1/employees/:id/restore` | ADMIN |
| PATCH | `/api/v1/employees/:id/activate` | ADMIN, HR |
| PATCH | `/api/v1/employees/:id/deactivate` | ADMIN, HR |
| PATCH | `/api/v1/employees/:id/department` | ADMIN, HR |
| PATCH | `/api/v1/employees/:id/manager` | ADMIN, HR |
| PATCH | `/api/v1/employees/:id/shift` | ADMIN, HR |
| POST | `/api/v1/employees/:id/profile-image` | ADMIN, HR |

## inventory

| Method | Path | Who may call it |
|---|---|---|
| GET | `/api/v1/inventory/statistics` | ADMIN, MANAGER, STORE |
| GET | `/api/v1/inventory/transactions` | ADMIN, MANAGER, STORE |
| POST | `/api/v1/inventory/scrap` | ADMIN, STORE, PRODUCTION |
| GET | `/api/v1/inventory/scrap` | ADMIN, MANAGER, STORE |
| POST | `/api/v1/inventory` | ADMIN, STORE |
| GET | `/api/v1/inventory` | ADMIN, MANAGER, HR, STORE, PRODUCTION, SALES |
| GET | `/api/v1/inventory/:id` | ADMIN, MANAGER, HR, STORE, PRODUCTION, SALES |
| PATCH | `/api/v1/inventory/:id` | ADMIN, STORE |
| DELETE | `/api/v1/inventory/:id` | ADMIN |
| PATCH | `/api/v1/inventory/:id/restore` | ADMIN |
| POST | `/api/v1/inventory/:id/stock` | ADMIN, STORE, PRODUCTION |
| GET | `/api/v1/inventory/:id/transactions` | ADMIN, MANAGER, STORE |

## orders

| Method | Path | Who may call it |
|---|---|---|
| GET | `/api/v1/orders/statistics` | ADMIN, MANAGER |
| GET | `/api/v1/orders/suppliers` | ADMIN, MANAGER, HR, STORE, PRODUCTION, SALES, SUPPLIER |
| POST | `/api/v1/orders/suppliers` | ADMIN, STORE, MANAGER |
| GET | `/api/v1/orders/suppliers/:id` | ADMIN, MANAGER, HR, STORE, PRODUCTION, SALES, SUPPLIER |
| PATCH | `/api/v1/orders/suppliers/:id` | ADMIN, STORE, MANAGER |
| DELETE | `/api/v1/orders/suppliers/:id` | ADMIN |
| PATCH | `/api/v1/orders/suppliers/:id/restore` | ADMIN |
| GET | `/api/v1/orders/clients` | ADMIN, MANAGER, HR, STORE, PRODUCTION, SALES, CLIENT |
| POST | `/api/v1/orders/clients` | ADMIN, SALES, MANAGER |
| GET | `/api/v1/orders/clients/:id` | ADMIN, MANAGER, HR, STORE, PRODUCTION, SALES, CLIENT |
| PATCH | `/api/v1/orders/clients/:id` | ADMIN, SALES, MANAGER |
| DELETE | `/api/v1/orders/clients/:id` | ADMIN |
| PATCH | `/api/v1/orders/clients/:id/restore` | ADMIN |
| GET | `/api/v1/orders/client-orders` | ADMIN, MANAGER, HR, STORE, PRODUCTION, SALES, CLIENT |
| POST | `/api/v1/orders/client-orders` | ADMIN, SALES, MANAGER, CLIENT |
| GET | `/api/v1/orders/client-orders/:id` | ADMIN, MANAGER, HR, STORE, PRODUCTION, SALES, CLIENT |
| PATCH | `/api/v1/orders/client-orders/:id` | ADMIN, SALES, MANAGER, CLIENT |
| PATCH | `/api/v1/orders/client-orders/:id/approve` | ADMIN, SALES, MANAGER |
| PATCH | `/api/v1/orders/client-orders/:id/production` | ADMIN, PRODUCTION, MANAGER |
| PATCH | `/api/v1/orders/client-orders/:id/dispatch` | ADMIN, STORE, MANAGER |
| PATCH | `/api/v1/orders/client-orders/:id/deliver` | ADMIN, STORE, MANAGER |
| PATCH | `/api/v1/orders/client-orders/:id/cancel` | ADMIN, SALES, MANAGER, CLIENT |
| GET | `/api/v1/orders/purchase-orders` | ADMIN, MANAGER, HR, STORE, PRODUCTION, SALES, SUPPLIER |
| POST | `/api/v1/orders/purchase-orders` | ADMIN, STORE, MANAGER |
| GET | `/api/v1/orders/purchase-orders/:id` | ADMIN, MANAGER, HR, STORE, PRODUCTION, SALES, SUPPLIER |
| PATCH | `/api/v1/orders/purchase-orders/:id` | ADMIN, STORE, MANAGER |
| PATCH | `/api/v1/orders/purchase-orders/:id/confirm` | ADMIN, STORE, MANAGER |
| PATCH | `/api/v1/orders/purchase-orders/:id/transit` | ADMIN, STORE, MANAGER |
| PATCH | `/api/v1/orders/purchase-orders/:id/deliver` | ADMIN, STORE, MANAGER |
| PATCH | `/api/v1/orders/purchase-orders/:id/cancel` | ADMIN, STORE, MANAGER |

## production

| Method | Path | Who may call it |
|---|---|---|
| GET | `/api/v1/production/kpis` | ADMIN, MANAGER, PRODUCTION, HR |
| GET | `/api/v1/production/trend` | ADMIN, MANAGER, PRODUCTION, HR |
| GET | `/api/v1/production/work-orders` | ADMIN, MANAGER, PRODUCTION, HR |
| POST | `/api/v1/production/work-orders` | ADMIN, PRODUCTION |
| GET | `/api/v1/production/work-orders/:id` | ADMIN, MANAGER, PRODUCTION, HR |
| GET | `/api/v1/production/work-orders/:id/detail` | ADMIN, MANAGER, PRODUCTION, HR |
| PATCH | `/api/v1/production/work-orders/:id` | ADMIN, PRODUCTION |
| PATCH | `/api/v1/production/work-orders/:id/status` | ADMIN, MANAGER, PRODUCTION |
| DELETE | `/api/v1/production/work-orders/:id` | ADMIN |
| GET | `/api/v1/production/work-orders/:id/outputs` | ADMIN, MANAGER, PRODUCTION, HR |
| POST | `/api/v1/production/work-orders/:id/outputs` | ADMIN, PRODUCTION |
| PATCH | `/api/v1/production/work-orders/:id/outputs/:outputId` | ADMIN, PRODUCTION |
| DELETE | `/api/v1/production/work-orders/:id/outputs/:outputId` | ADMIN, PRODUCTION |

## reports

| Method | Path | Who may call it |
|---|---|---|
| GET | `/api/v1/reports/dashboard` | ADMIN, MANAGER, HR, STORE, PRODUCTION, SALES |
| GET | `/api/v1/reports/dashboard/kpis` | ADMIN, MANAGER, HR, STORE, PRODUCTION, SALES |
| GET | `/api/v1/reports/dashboard/charts` | ADMIN, MANAGER, HR, STORE, PRODUCTION, SALES |
| GET | `/api/v1/reports/inventory` | ADMIN, MANAGER, STORE |
| GET | `/api/v1/reports/workforce` | ADMIN, MANAGER, HR |
| GET | `/api/v1/reports/orders` | ADMIN, MANAGER |
| GET | `/api/v1/reports/scrap` | ADMIN, MANAGER, STORE |
| GET | `/api/v1/reports/suppliers` | ADMIN, MANAGER |
| GET | `/api/v1/reports/clients` | ADMIN, MANAGER |
| GET | `/api/v1/reports/attendance` | ADMIN, MANAGER, HR |
| GET | `/api/v1/reports/production` | ADMIN, MANAGER, PRODUCTION |

## security

| Method | Path | Who may call it |
|---|---|---|
| GET | `/api/v1/security/kpis` | ADMIN, MANAGER, PRODUCTION |
| PATCH | `/api/v1/security/incidents/ai-summary` | ADMIN, MANAGER, PERCEPTION_SERVICE |
| GET | `/api/v1/security/stream` | ADMIN, MANAGER, PRODUCTION |
| PATCH | `/api/v1/security/incidents/escalate` | ADMIN, MANAGER, PERCEPTION_SERVICE |
| GET | `/api/v1/security/incidents` | ADMIN, MANAGER, PRODUCTION |
| POST | `/api/v1/security/incidents` | ADMIN, MANAGER, HR, STORE, PRODUCTION, SALES, PERCEPTION_SERVICE |
| GET | `/api/v1/security/incidents/:id` | ADMIN, MANAGER, PRODUCTION |
| GET | `/api/v1/security/incidents/:id/detail` | ADMIN, MANAGER, PRODUCTION |
| GET | `/api/v1/security/incidents/:id/evidence` | ADMIN, MANAGER, PRODUCTION |
| GET | `/api/v1/security/incidents/:id/evidence/file` | ADMIN, MANAGER, PRODUCTION |
| PATCH | `/api/v1/security/incidents/:id` | ADMIN, MANAGER |
| PATCH | `/api/v1/security/incidents/:id/status` | ADMIN, MANAGER |
| PATCH | `/api/v1/security/incidents/:id/assign` | ADMIN, MANAGER |
| DELETE | `/api/v1/security/incidents/:id` | ADMIN |
| GET | `/api/v1/security/incidents/:id/updates` | ADMIN, MANAGER, PRODUCTION |
| POST | `/api/v1/security/incidents/:id/updates` | ADMIN, MANAGER |
| DELETE | `/api/v1/security/incidents/:id/updates/:updateId` | ADMIN |
| GET | `/api/v1/security/alerts` | ADMIN, MANAGER, PRODUCTION |
| POST | `/api/v1/security/alerts` | ADMIN, MANAGER |
| GET | `/api/v1/security/alerts/:id` | ADMIN, MANAGER, PRODUCTION |
| PATCH | `/api/v1/security/alerts/:id` | ADMIN, MANAGER |
| PATCH | `/api/v1/security/alerts/:id/acknowledge` | ADMIN, MANAGER, PRODUCTION |
| PATCH | `/api/v1/security/alerts/:id/resolve` | ADMIN, MANAGER |
| DELETE | `/api/v1/security/alerts/:id` | ADMIN |

## workforce

| Method | Path | Who may call it |
|---|---|---|
| GET | `/api/v1/workforce/shifts` | ADMIN, MANAGER, HR, STORE, PRODUCTION, SALES |
| POST | `/api/v1/workforce/shifts` | ADMIN, HR |
| GET | `/api/v1/workforce/shifts/:id` | ADMIN, MANAGER, HR, STORE, PRODUCTION, SALES |
| PATCH | `/api/v1/workforce/shifts/:id` | ADMIN, HR |
| DELETE | `/api/v1/workforce/shifts/:id` | ADMIN |
| GET | `/api/v1/workforce/attendance/summary` | ADMIN, MANAGER, HR |
| GET | `/api/v1/workforce/attendance/trend` | ADMIN, MANAGER, HR |
| POST | `/api/v1/workforce/attendance/bulk` | ADMIN, HR |
| POST | `/api/v1/workforce/attendance/clock-in` | ADMIN, HR, PRODUCTION |
| GET | `/api/v1/workforce/attendance` | ADMIN, MANAGER, HR |
| POST | `/api/v1/workforce/attendance` | ADMIN, HR |
| GET | `/api/v1/workforce/attendance/:id` | ADMIN, MANAGER, HR |
| PATCH | `/api/v1/workforce/attendance/:id` | ADMIN, HR |
| DELETE | `/api/v1/workforce/attendance/:id` | ADMIN |
| PATCH | `/api/v1/workforce/attendance/:id/clock-out` | ADMIN, HR, PRODUCTION |
