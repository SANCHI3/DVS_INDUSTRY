import express from 'express';
import path from 'path';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';

import { env } from './config/env';
import { requestLogger } from './middleware/requestLogger';
import { notFoundHandler } from './middleware/notFound';
import { errorHandler } from './middleware/errorHandler';
import { auditLog } from './middleware/auditLog';
import router from './routes';

const app = express();

// ── Reverse proxy ──────────────────────────────────────────────────────────
// Behind nginx, req.ip would otherwise be the proxy's address for every
// request, collapsing all users into a single rate-limit bucket.
if (env.TRUST_PROXY > 0) {
  app.set('trust proxy', env.TRUST_PROXY);
}

// ── Security headers ───────────────────────────────────────────────────────
app.use(helmet());

// ── CORS ───────────────────────────────────────────────────────────────────
const allowedOrigins = env.CORS_ORIGINS.split(',').map((o) => o.trim());

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow server-to-server requests (origin === undefined) in dev
      if (origin === undefined || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origin '${origin}' not allowed`));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }),
);

// ── Audit trail — records writes and sign-in attempts (including throttled
// ones) once the response finishes, so it is registered before the limiters.
app.use(auditLog);

// ── Rate limiting ──────────────────────────────────────────────────────────
// NOTE: the default store is in-memory and per process. Under pm2 cluster
// mode each worker counts separately; set PM2_INSTANCES=1 or plug in a shared
// store (e.g. rate-limit-redis) if exact limits matter.

// Brute-force protection for credential endpoints — counts only failures.
const credentialLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many failed attempts. Please try again in 15 minutes.',
    },
  },
});
app.use('/api/v1/auth/login', credentialLimiter);
app.use('/api/v1/auth/reset-password', credentialLimiter);

// Password-reset requests always return 200, so count every request.
app.use(
  '/api/v1/auth/forgot-password',
  rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests' },
    },
  }),
);

app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 500, // requests per window per IP
    standardHeaders: true,
    legacyHeaders: false,
    // The live incident stream is one long-lived authenticated connection,
    // not request traffic; counting it would let ordinary page use lock a
    // dashboard out of real-time alerts. The client backs off on its own.
    skip: (req) => req.path === '/api/v1/security/stream',
    message: {
      success: false,
      error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests' },
    },
  }),
);

// ── Body parsing & compression ─────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(compression());
app.use(cookieParser());

// ── Request logging ────────────────────────────────────────────────────────
app.use(requestLogger);

// ── Static file serving — uploaded assets ─────────────────────────────────
app.use(
  '/uploads',
  express.static(path.resolve(process.cwd(), 'uploads'), {
    maxAge: '7d',
    etag: true,
  }),
);

// ── Routes ─────────────────────────────────────────────────────────────────
app.use(router);

// ── 404 handler ───────────────────────────────────────────────────────────
app.use(notFoundHandler);

// ── Global error handler (must be last) ───────────────────────────────────
app.use(errorHandler);

export default app;
