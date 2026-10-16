import { z } from 'zod';

/**
 * Validates all required environment variables at startup.
 * The app will crash immediately with a descriptive error if any are missing
 * or malformed — far better than silent failures at runtime.
 */
const envSchema = z.object({
  // Server
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  // Database
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid connection URL'),

  // JWT Access Token
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('15m'),

  // JWT Refresh Token
  REFRESH_TOKEN_SECRET: z.string().min(32, 'REFRESH_TOKEN_SECRET must be at least 32 characters'),
  REFRESH_TOKEN_EXPIRES_IN: z.string().default('7d'),

  // Security
  BCRYPT_SALT_ROUNDS: z.coerce.number().int().min(10).max(14).default(12),

  // CORS — comma-separated list of allowed origins
  CORS_ORIGINS: z.string().default('http://localhost:5173'),

  // Reverse proxy — number of trusted hops in front of the app (nginx = 1).
  // Required so req.ip and the rate limiter see the real client address.
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),

  // API requests per 15 minutes per IP (the live incident stream is exempt)
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(500),

  // Public URL of the frontend, used to build password-reset links
  APP_URL: z.string().url().default('http://localhost:5173'),

  // Outgoing mail (password reset). When SMTP_HOST is unset, reset links are
  // logged in development and an error is logged in production.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  MAIL_FROM: z.string().default('DVS Industries <no-reply@dvsindustry.com>'),

  // Perception service files read by the dashboard (relative to backend/):
  // incident evidence and explanations.
  PERCEPTION_OUTPUT_DIR: z.string().default('../perception-service/output'),

  // Logging
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'http', 'debug']).default('info'),

  // Initial administrator credentials are required when seeding production.
  SEED_ADMIN_EMAIL: z.string().email().default('admin@dvsindustry.com'),
  SEED_ADMIN_PASSWORD: z.string().min(16).optional(),
});

/**
 * Parsed and validated environment variables.
 * Import `env` instead of `process.env` throughout the app.
 */
function parseEnv(): z.infer<typeof envSchema> {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const formatted = result.error.issues
      .map((e) => `  • ${e.path.join('.')}: ${e.message}`)
      .join('\n');

    // Crash intentionally — broken config must never reach runtime
    console.error('❌  Environment validation failed:\n' + formatted);
    process.exit(1);
  }

  if (result.data.NODE_ENV === 'production' && result.data.SEED_ADMIN_PASSWORD === undefined) {
    throw new Error('SEED_ADMIN_PASSWORD is required in production.');
  }

  return result.data;
}

export const env = parseEnv();
export type Env = z.infer<typeof envSchema>;
