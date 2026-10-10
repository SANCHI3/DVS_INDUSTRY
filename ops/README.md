# Production Operations

## API process

```bash
cd backend
npm ci
npm run build
npx prisma migrate deploy
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

Set `NODE_ENV=production`, `DATABASE_URL`, `DIRECT_URL`, both JWT secrets, `CORS_ORIGINS`, and `SEED_ADMIN_PASSWORD` in the deployment secret store. Behind nginx also set `TRUST_PROXY=1` (otherwise every user shares one rate-limit bucket), `APP_URL` to the public frontend URL, and the `SMTP_*` variables so password-reset emails are delivered. `DATABASE_URL` must use the low-privilege runtime role; `DIRECT_URL` is used only by Prisma migrations. Do not copy the local `.env` to a server.

## HTTPS and reverse proxy

1. Build the frontend with `npm run build` from `frontend`.
2. Copy `ops/nginx/dvs-industry.conf` to `/etc/nginx/sites-available/dvs-industry`.
3. Replace `example.com` and the frontend path, then enable the site.
4. Issue certificates with Certbot: `sudo certbot --nginx -d example.com -d www.example.com`.
5. Validate and reload: `sudo nginx -t && sudo systemctl reload nginx`.

The proxy exposes the frontend, forwards `/api` and `/uploads` to the backend, and redirects HTTP to HTTPS.

## Backups

Use `ops/backup-postgres.sh` on Linux or `ops/backup-postgres.ps1` on Windows with `DATABASE_URL` set. Run it daily with a systemd timer, cron, or Task Scheduler. Copy dumps to separate storage and periodically test restores with `pg_restore`; local backup files alone are not disaster recovery.

## Monitoring

Configure an external uptime check for `GET /api/v1/health` and alert on non-200 responses. `GET /api/v1/metrics` (uptime and memory) requires an ADMIN bearer token. Production logs are structured JSON and should be shipped to the host log collector or a service such as CloudWatch, Datadog, or Grafana Loki.
