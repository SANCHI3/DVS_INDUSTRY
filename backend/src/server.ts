/**
 * Entry point — starts the HTTP server.
 *
 * Responsible for:
 *  1. Loading & validating environment variables (via env.ts import)
 *  2. Connecting the Prisma client
 *  3. Binding the Express app to a port
 *  4. Graceful shutdown on SIGTERM / SIGINT
 */

// dotenv must be loaded before anything else reads process.env
import 'dotenv/config';

import { env } from './config/env';
import app from './app';
import { prisma } from './lib/prismaClient';
import { logger } from './logger';
import { Client } from 'pg';
import { sharedBusWanted, startSecurityEventBus } from './lib/securityEvents';
import { IncidentEvidenceService } from './services/incidentEvidence.service';

const server = app.listen(env.PORT, () => {
  logger.info(`🚀  Server running`, {
    port: env.PORT,
    env: env.NODE_ENV,
    pid: process.pid,
  });
});

// ── Live incident events across processes ──────────────────────────────────
// Under PM2 cluster mode (or SECURITY_EVENT_BUS=postgres) incident events go
// through Postgres LISTEN/NOTIFY so every worker's dashboards receive them.
// A single process keeps them in memory, which also lets an idle Neon
// database suspend (a held LISTEN connection would keep it awake).
let stopEventBus: (() => Promise<void>) | null = null;
if (sharedBusWanted()) {
  // LISTEN needs a direct connection; a transaction pooler drops it
  const listenUrl = process.env['DIRECT_URL'] ?? env.DATABASE_URL;
  void startSecurityEventBus({
    createClient: () => {
      const client = new Client({ connectionString: listenUrl });
      return {
        connect: () => client.connect(),
        query: (sql) => client.query(sql),
        onNotification: (listener) => client.on('notification', listener),
        onError: (listener) => client.on('error', listener),
        end: () => client.end(),
      };
    },
    notify: (channel, payload) => prisma.$executeRaw`SELECT pg_notify(${channel}, ${payload})`,
    onError: (err) =>
      logger.error('Security event bus error', {
        error: err instanceof Error ? err.message : String(err),
      }),
  }).then((stop) => {
    stopEventBus = stop;
    logger.info('Security events relayed through Postgres LISTEN/NOTIFY');
  });
}

// ── Incident picture retention ─────────────────────────────────────────────
// Once a day (first run a minute after start): pictures older than
// EVIDENCE_RETENTION_DAYS, and false alarms' after 7 days. One PM2 worker only.
if ((process.env['NODE_APP_INSTANCE'] ?? '0') === '0') {
  const evidence = new IncidentEvidenceService();
  const runRetention = () =>
    void evidence.applyRetention().catch((err: unknown) =>
      logger.warn('Evidence retention failed', {
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  setTimeout(runRetention, 60_000).unref();
  setInterval(runRetention, 24 * 60 * 60_000).unref();
}

// ── Graceful shutdown ──────────────────────────────────────────────────────

function shutdown(signal: string): void {
  logger.info(`${signal} received — shutting down gracefully`);

  // Stop accepting new connections
  server.close(() => {
    void (stopEventBus?.() ?? Promise.resolve())
      .then(() => prisma.$disconnect())
      .then(() => {
        logger.info('Prisma disconnected. Bye 👋');
        process.exit(0);
      })
      .catch((err: unknown) => {
        logger.error('Error during shutdown', { err });
        process.exit(1);
      });
  });

  // Force exit after 10 s if graceful shutdown hangs
  setTimeout(() => {
    logger.error('Graceful shutdown timed out — forcing exit');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { reason });
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { err });
  process.exit(1);
});
