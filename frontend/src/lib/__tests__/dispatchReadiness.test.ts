import { describe, expect, it } from 'vitest';
import { dispatchReadiness, type LinkedWorkOrder } from '../dispatchReadiness';

const wo = (status: string, produced: number, target = 500): LinkedWorkOrder => ({
  id: 1, workOrderNumber: 'WO-1', status, targetQuantity: target, producedQty: produced, unit: 'pcs',
});

describe('dispatchReadiness', () => {
  it('cannot judge an order with no linked work order', () => {
    expect(dispatchReadiness(500, [])).toEqual({ linked: false, ready: false, items: [] });
    expect(dispatchReadiness(500, [wo('CANCELLED', 0)]).linked).toBe(false);
  });

  it('is ready when every linked work order is complete and output covers the order', () => {
    const r = dispatchReadiness(500, [wo('COMPLETED', 300), wo('COMPLETED', 220)]);
    expect(r.ready).toBe(true);
    expect(r.items.map((i) => i.detail)).toEqual(['2 of 2', '520 of 500']);
  });

  it('is not ready while production is still running or came up short', () => {
    const running = dispatchReadiness(500, [wo('IN_PROGRESS', 480)]);
    expect(running.ready).toBe(false);
    expect(running.items[0]).toMatchObject({ done: false, detail: '0 of 1' });

    const short = dispatchReadiness(500, [wo('COMPLETED', 460)]);
    expect(short.ready).toBe(false);
    expect(short.items[1]).toMatchObject({ done: false, detail: '460 of 500' });
  });
});
