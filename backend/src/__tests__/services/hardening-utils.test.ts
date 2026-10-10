/**
 * Unit tests for audit-log action mapping, document numbering and safe
 * upload deletion.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';
import { Prisma } from '@prisma/client';

vi.mock('../../lib/prismaClient', () => ({
  prisma: { $queryRawUnsafe: vi.fn(), auditLog: { create: vi.fn() } },
}));
vi.mock('../../logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

const fsMock = vi.hoisted(() => ({
  existsSync: vi.fn().mockReturnValue(true),
  unlinkSync: vi.fn(),
  mkdirSync: vi.fn(),
}));
vi.mock('fs', () => ({ default: fsMock, ...fsMock }));

import { prisma } from '../../lib/prismaClient';
const { resolveAction, resolveEntity } = await import('../../middleware/auditLog');
const { nextDocumentNumber, withUniqueNumberRetry } = await import('../../utils/documentNumber');
const { deleteUploadedFile } = await import('../../utils/upload');

const uniqueViolation = () =>
  new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' });

describe('audit action mapping', () => {
  it('logs successful and failed logins', () => {
    expect(resolveAction('POST', '/api/v1/auth/login', 200)).toBe('LOGIN');
    expect(resolveAction('POST', '/api/v1/auth/login', 401)).toBe('LOGIN_FAILED');
    expect(resolveAction('POST', '/api/v1/auth/login', 429)).toBe('LOGIN_FAILED');
  });

  it('logs writes but not reads or failed writes', () => {
    expect(resolveAction('POST', '/api/v1/inventory', 201)).toBe('CREATE');
    expect(resolveAction('PATCH', '/api/v1/employees/4', 200)).toBe('UPDATE');
    expect(resolveAction('DELETE', '/api/v1/employees/4', 204)).toBe('DELETE');
    expect(resolveAction('GET', '/api/v1/employees', 200)).toBeNull();
    expect(resolveAction('POST', '/api/v1/inventory', 422)).toBeNull();
  });

  it('classifies state transitions and report exports', () => {
    expect(resolveAction('PATCH', '/api/v1/orders/client-orders/3/approve', 200)).toBe(
      'STATUS_CHANGE',
    );
    expect(resolveAction('PATCH', '/api/v1/security/alerts/2/acknowledge', 200)).toBe(
      'STATUS_CHANGE',
    );
    expect(resolveAction('GET', '/api/v1/reports/inventory', 200)).toBe('EXPORT');
  });

  it('skips token refresh noise', () => {
    expect(resolveAction('POST', '/api/v1/auth/refresh', 200)).toBeNull();
  });

  it('resolves the most specific entity', () => {
    expect(resolveEntity('/api/v1/orders/client-orders/3/approve')).toBe('ClientOrder');
    expect(resolveEntity('/api/v1/security/incidents/7')).toBe('SecurityIncident');
    expect(resolveEntity('/api/v1/employees/5')).toBe('Employee');
  });
});

describe('document numbering', () => {
  beforeEach(() => vi.clearAllMocks());

  it('starts at the configured number when the table is empty', async () => {
    (prisma.$queryRawUnsafe as ReturnType<typeof vi.fn>).mockResolvedValue([{ max: null }]);
    await expect(nextDocumentNumber('clientOrder', 'ORD-', { start: 2841 })).resolves.toBe(
      'ORD-2841',
    );
  });

  it('pads and keeps counting past 9999', async () => {
    (prisma.$queryRawUnsafe as ReturnType<typeof vi.fn>).mockResolvedValue([{ max: 9999 }]);
    await expect(nextDocumentNumber('securityIncident', 'INC-', { pad: 4 })).resolves.toBe(
      'INC-10000',
    );
  });

  it('retries on a unique-number collision, then gives up', async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce(uniqueViolation())
      .mockResolvedValueOnce('created');
    await expect(withUniqueNumberRetry(create)).resolves.toBe('created');
    expect(create).toHaveBeenCalledTimes(2);

    const alwaysFails = vi.fn().mockRejectedValue(uniqueViolation());
    await expect(withUniqueNumberRetry(alwaysFails, 3)).rejects.toThrow();
    expect(alwaysFails).toHaveBeenCalledTimes(3);
  });

  it('does not retry unrelated errors', async () => {
    const create = vi.fn().mockRejectedValue(new Error('boom'));
    await expect(withUniqueNumberRetry(create)).rejects.toThrow('boom');
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe('deleteUploadedFile', () => {
  beforeEach(() => vi.clearAllMocks());
  const profilesDir = path.resolve(process.cwd(), 'uploads', 'profiles');

  it('deletes a file inside the profiles folder', () => {
    deleteUploadedFile('/uploads/profiles/123-abc.png');
    expect(fsMock.unlinkSync).toHaveBeenCalledWith(path.join(profilesDir, '123-abc.png'));
  });

  it.each(['/uploads/../.env', '/uploads/profiles/../../dist/server.js', 'C:\\Windows\\win.ini'])(
    'never deletes outside the profiles folder (%s)',
    (stored) => {
      deleteUploadedFile(stored);
      const calls = fsMock.unlinkSync.mock.calls.map((c) => String(c[0]));
      expect(calls.every((p) => p.startsWith(profilesDir))).toBe(true);
      expect(calls.some((p) => /\.env$|server\.js$|win\.ini$/.test(p))).toBe(false);
    },
  );
});
