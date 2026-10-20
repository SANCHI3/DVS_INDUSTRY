/**
 * The global error handler: database outages are reported as 503 so clients
 * can tell "try again shortly" from a bug.
 */
import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';

vi.mock('../../logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../../config/env', () => ({ env: { NODE_ENV: 'production' } }));

const { errorHandler } = await import('../../middleware/errorHandler');

function run(err: unknown) {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
    getHeader: vi.fn().mockReturnValue('req-1234abcd'),
  };
  res.status.mockReturnValue(res);
  errorHandler(err, { path: '/x', method: 'GET' } as Request, res as unknown as Response, vi.fn());
  return { status: res.status.mock.calls[0]?.[0] as number, body: res.json.mock.calls[0]?.[0] };
}

describe('errorHandler', () => {
  it('reports an unreachable database as 503 without its connection details', () => {
    const err = new Prisma.PrismaClientInitializationError(
      "Can't reach database server at `db.internal:5432`",
      'test',
    );

    const { status, body } = run(err);

    expect(status).toBe(503);
    expect(body.error.code).toBe('DATABASE_UNAVAILABLE');
    expect(JSON.stringify(body)).not.toContain('db.internal');
  });

  it('hides the message of an unexpected error in production', () => {
    const { status, body } = run(new Error('secret internal detail'));

    expect(status).toBe(500);
    expect(JSON.stringify(body)).not.toContain('secret');
    expect(body.error.requestId).toBe('req-1234abcd');
  });
});
