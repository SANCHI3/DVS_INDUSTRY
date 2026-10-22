import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { runWithRequestId } from '../lib/requestContext';

export const REQUEST_ID_HEADER = 'X-Request-Id';

// An ID set by a proxy in front of us is kept so logs line up; anything
// unusual is replaced rather than echoed into logs and headers.
const SAFE_ID = /^[\w-]{8,64}$/;

/**
 * Gives every request an ID: returned in the X-Request-Id header, added to
 * every log line written while handling it, and included in 500 responses
 * so a user can quote it when reporting a problem.
 */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.get(REQUEST_ID_HEADER);
  const id = incoming !== undefined && SAFE_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader(REQUEST_ID_HEADER, id);
  runWithRequestId(id, next);
}
