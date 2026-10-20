import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-request context that follows a request through every await, so log
 * lines can name the request they belong to without passing it around.
 */
const storage = new AsyncLocalStorage<{ requestId: string }>();

export function runWithRequestId<T>(requestId: string, fn: () => T): T {
  return storage.run({ requestId }, fn);
}

export function currentRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}
