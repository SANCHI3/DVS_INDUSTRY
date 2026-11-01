/**
 * Required-by and expected-delivery dates may not fall before the order date.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../lib/prismaClient', () => ({ prisma: {} }));
vi.mock('../../logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { ValidationError } from '../../errors';
import { assertNotBeforeOrderDate } from '../../services/orders.service';

const ordered = new Date('2026-09-25T09:30:00Z');

describe('assertNotBeforeOrderDate', () => {
  it('rejects a date before the order date (PO-TEST-001: 15 Sept vs 25 Sept)', () => {
    let error: unknown;
    try {
      assertNotBeforeOrderDate(
        new Date('2026-09-15'),
        ordered,
        'expectedDelivery',
        'Expected delivery',
      );
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).details).toEqual([
      {
        field: 'expectedDelivery',
        message: 'Expected delivery cannot be before the order date (25 Sept 2026)',
      },
    ]);
  });

  it('accepts the same day, a later day, or no date', () => {
    expect(() =>
      assertNotBeforeOrderDate(new Date('2026-09-25'), ordered, 'requiredDate', 'Required-by date'),
    ).not.toThrow();
    expect(() =>
      assertNotBeforeOrderDate(new Date('2026-10-01'), ordered, 'requiredDate', 'Required-by date'),
    ).not.toThrow();
    expect(() =>
      assertNotBeforeOrderDate(null, ordered, 'requiredDate', 'Required-by date'),
    ).not.toThrow();
  });
});
