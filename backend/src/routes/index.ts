import { Router } from 'express';
import { API_PREFIX } from '../constants';
import analyticsRouter from './analytics.routes';
import assistantRouter from '../assistant/assistant.routes';
import authRouter from './auth.routes';
import auditRouter from './audit.routes';
import departmentRouter from './department.routes';
import employeeRouter from './employee.routes';
import inventoryRouter from './inventory.routes';
import ordersRouter from './orders.routes';
import productionRouter from './production.routes';
import reportsRouter from './reports.routes';
import securityRouter from './security.routes';
import workforceRouter from './workforce.routes';
import { prisma } from '../lib/prismaClient';
import { env } from '../config/env';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { ROLES } from '../constants';

const router = Router();

router.get('/', (_req, res) => {
  res.status(200).json({
    service: 'DVS Industries API',
    status: 'ok',
    health: `${API_PREFIX}/health`,
    api: API_PREFIX,
  });
});

// ── Feature routers ───────────────────────────────────────────────────────────
router.use(`${API_PREFIX}/analytics`, analyticsRouter);
router.use(`${API_PREFIX}/assistant`, assistantRouter);
router.use(`${API_PREFIX}/auth`, authRouter);
router.use(`${API_PREFIX}/audit`, auditRouter);
router.use(`${API_PREFIX}/departments`, departmentRouter);
router.use(`${API_PREFIX}/employees`, employeeRouter);
router.use(`${API_PREFIX}/inventory`, inventoryRouter);
router.use(`${API_PREFIX}/orders`, ordersRouter);
router.use(`${API_PREFIX}/production`, productionRouter);
router.use(`${API_PREFIX}/reports`, reportsRouter);
router.use(`${API_PREFIX}/security`, securityRouter);
router.use(`${API_PREFIX}/workforce`, workforceRouter);

// ── Health check ──────────────────────────────────────────────────────────────
router.get(`${API_PREFIX}/health`, async (_req, res) => {
  if (env.NODE_ENV === 'test') {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
    return;
  }

  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ status: 'ok', database: 'ok', timestamp: new Date().toISOString() });
  } catch {
    res.status(503).json({
      status: 'degraded',
      database: 'unavailable',
      timestamp: new Date().toISOString(),
    });
  }
});

// Process internals are operational data — admins only.
router.get(`${API_PREFIX}/metrics`, authenticate, authorize(ROLES.ADMIN), (_req, res) => {
  const memory = process.memoryUsage();
  res.status(200).json({
    uptimeSeconds: Math.round(process.uptime()),
    memory: {
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      heapTotalBytes: memory.heapTotal,
    },
    nodeVersion: process.version,
    timestamp: new Date().toISOString(),
  });
});

export default router;
