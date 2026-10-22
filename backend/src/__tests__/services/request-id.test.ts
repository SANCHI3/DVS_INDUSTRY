/**
 * Every request gets an ID that is returned to the client and available to
 * code (and log lines) running anywhere inside that request.
 */
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { requestId } from '../../middleware/requestId';
import { currentRequestId } from '../../lib/requestContext';

const app = express();
app.use(requestId);
app.get('/id', async (_req, res) => {
  // Still known after an await, as in a real service call
  await new Promise((resolve) => setTimeout(resolve, 5));
  res.json({ seen: currentRequestId() });
});

describe('requestId middleware', () => {
  it('creates an ID, returns it and makes it available inside the request', async () => {
    const res = await request(app).get('/id');

    const id = res.headers['x-request-id'];
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body.seen).toBe(id);
  });

  it('keeps an ID set by a proxy in front of the API', async () => {
    const res = await request(app).get('/id').set('X-Request-Id', 'rndr-abc12345');
    expect(res.headers['x-request-id']).toBe('rndr-abc12345');
  });

  it('replaces an unsafe incoming ID instead of echoing it', async () => {
    const res = await request(app).get('/id').set('X-Request-Id', '<script>alert(1)</script>');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('gives concurrent requests their own IDs', async () => {
    const results = await Promise.all([1, 2, 3, 4].map(() => request(app).get('/id')));
    const ids = results.map((r) => r.body.seen as string);
    expect(new Set(ids).size).toBe(4);
    results.forEach((r) => expect(r.body.seen).toBe(r.headers['x-request-id']));
  });

  it('has no ID outside a request', () => {
    expect(currentRequestId()).toBeUndefined();
  });
});
