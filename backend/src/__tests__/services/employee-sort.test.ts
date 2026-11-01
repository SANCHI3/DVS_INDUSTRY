/**
 * Employee codes sort naturally (1, 2, 10, 11, 102), not as text (1, 10, 102, 11).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/prismaClient', () => ({
  prisma: {
    employee: { findMany: vi.fn(), count: vi.fn() },
    $transaction: vi.fn((fns: unknown[]) => Promise.all(fns as Promise<unknown>[])),
  },
}));

import { prisma } from '../../lib/prismaClient';
import { EmployeeRepository, naturalCompare } from '../../repositories/employee.repository';

const findMany = prisma.employee.findMany as unknown as ReturnType<typeof vi.fn>;
const CODES = ['102', '1', '11', '10', '2'];

describe('naturalCompare', () => {
  it('orders numbers inside codes by value', () => {
    expect([...CODES].sort(naturalCompare)).toEqual(['1', '2', '10', '11', '102']);
    expect(['EMP-10', 'EMP-9', 'EMP-100'].sort(naturalCompare)).toEqual([
      'EMP-9',
      'EMP-10',
      'EMP-100',
    ]);
  });
});

describe('EmployeeRepository.findAll sorted by code', () => {
  beforeEach(() => {
    findMany.mockReset();
    findMany.mockImplementation((args: { where?: { id?: { in: number[] } } }) => {
      const all = CODES.map((code) => ({
        id: Number(code),
        employeeCode: code,
        salary: null,
        dailyWageRate: null,
      }));
      if (args.where?.id)
        return Promise.resolve(all.filter((e) => args.where!.id!.in.includes(e.id)));
      return Promise.resolve(all);
    });
  });

  it('returns pages in natural order with the full total', async () => {
    const repo = new EmployeeRepository();
    const first = await repo.findAll({
      page: 1,
      pageSize: 3,
      sortBy: 'employeeCode',
      sortOrder: 'asc',
      status: 'all',
    } as never);
    expect(first.data.map((e) => e.employeeCode)).toEqual(['1', '2', '10']);
    expect(first.total).toBe(5);

    const second = await repo.findAll({
      page: 2,
      pageSize: 3,
      sortBy: 'employeeCode',
      sortOrder: 'asc',
      status: 'all',
    } as never);
    expect(second.data.map((e) => e.employeeCode)).toEqual(['11', '102']);
  });
});
