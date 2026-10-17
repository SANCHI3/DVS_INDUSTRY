/**
 * Ask DVS routes without an LLM key: the assistant reports "not configured"
 * and nothing else breaks. Also checks login, role and input validation.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

vi.mock('../../config/env', () => ({
  env: {
    NODE_ENV: 'test',
    PORT: 3001,
    JWT_SECRET: 'test-secret-at-least-32-characters-long!!',
    JWT_EXPIRES_IN: '15m',
    REFRESH_TOKEN_SECRET: 'test-refresh-secret-at-least-32-chars!!',
    REFRESH_TOKEN_EXPIRES_IN: '7d',
    BCRYPT_SALT_ROUNDS: 10,
    CORS_ORIGINS: 'http://localhost:5173',
    LOG_LEVEL: 'silent',
    RATE_LIMIT_MAX: 500,
    TRUST_PROXY: 0,
    ASSISTANT_LLM_BASE_URL: 'https://api.groq.com/openai/v1',
    ASSISTANT_LLM_MODEL: 'openai/gpt-oss-20b',
    ASSISTANT_LLM_API_KEY: undefined,
  },
}));

vi.mock('../../lib/prismaClient', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    $queryRawUnsafe: vi.fn().mockResolvedValue([{ max: null }]),
    $transaction: vi.fn((fns: unknown[]) => Promise.all(fns as Promise<unknown>[])),
  },
}));

vi.mock('../../logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), http: vi.fn(), debug: vi.fn(), log: vi.fn() },
}));

const USERS: Record<string, { id: number; role: string }> = {
  store: { id: 3, role: 'STORE' },
  supplier: { id: 7, role: 'SUPPLIER' },
};

vi.mock('../../utils/token', () => ({
  verifyAccessToken: vi.fn((token: string) => {
    const u = { store: 3, supplier: 7 }[token];
    if (u === undefined) throw new Error('invalid');
    return { sub: u, email: '', role: '' };
  }),
}));

import { prisma } from '../../lib/prismaClient';

let app: Express;

beforeAll(async () => {
  app = (await import('../../app')).default;
});

beforeEach(() => {
  vi.mocked(prisma.user.findUnique).mockImplementation((async ({ where }: { where: { id: number } }) => {
    const u = Object.values(USERS).find((x) => x.id === where.id);
    return u && { id: u.id, email: `${u.role.toLowerCase()}@test.com`, fullName: u.role, isActive: true, role: { name: u.role } };
  }) as never);
});

describe('Ask DVS routes', () => {
  it('reports not configured on the status endpoint', async () => {
    const res = await request(app).get('/api/v1/assistant/status').set('Authorization', 'Bearer store');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ configured: false });
  });

  it('returns 503 with a clear message when no API key is set', async () => {
    const res = await request(app)
      .post('/api/v1/assistant/ask')
      .set('Authorization', 'Bearer store')
      .send({ question: 'Which materials will run out this week?' });

    expect(res.status).toBe(503);
    expect(res.body.error).toEqual({
      code: 'ASSISTANT_NOT_CONFIGURED',
      message: expect.stringContaining('Assistant not configured'),
    });
  });

  it('requires login', async () => {
    const res = await request(app).post('/api/v1/assistant/ask').send({ question: 'Hi' });
    expect(res.status).toBe(401);
  });

  it('is only for staff roles', async () => {
    const res = await request(app)
      .post('/api/v1/assistant/ask')
      .set('Authorization', 'Bearer supplier')
      .send({ question: 'Which orders are late?' });
    expect(res.status).toBe(403);
  });

  it('rejects empty and over-long questions', async () => {
    const empty = await request(app)
      .post('/api/v1/assistant/ask')
      .set('Authorization', 'Bearer store')
      .send({ question: '   ' });
    const long = await request(app)
      .post('/api/v1/assistant/ask')
      .set('Authorization', 'Bearer store')
      .send({ question: 'x'.repeat(501) });
    expect(empty.status).toBe(422);
    expect(long.status).toBe(422);
  });
});
