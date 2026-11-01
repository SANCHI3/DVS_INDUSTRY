import { describe, expect, it } from 'vitest';
import { workOrderStatusLabel } from '../workOrderStatus';

describe('workOrderStatusLabel', () => {
  it('shows a completion below target as completed short', () => {
    expect(workOrderStatusLabel('COMPLETED', '840.000', '1000.000')).toEqual({ label: 'Completed short (84%)', short: true });
    expect(workOrderStatusLabel('COMPLETED', '999.9', '1000')).toEqual({ label: 'Completed short (99%)', short: true });
  });

  it('keeps full completions and open orders as they are', () => {
    expect(workOrderStatusLabel('COMPLETED', '1000', '1000')).toEqual({ label: 'COMPLETED', short: false });
    expect(workOrderStatusLabel('IN_PROGRESS', '200', '1000')).toEqual({ label: 'IN PROGRESS', short: false });
  });
});
