import type { Request, Response, NextFunction } from 'express';
import { logger } from '../logger';

/**
 * Logs every inbound HTTP request + the eventual response status and duration.
 * Uses Morgan-style fields so it's easy to grep / parse in log aggregators.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'http';

    logger.log(level, 'HTTP', {
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
      requestId: res.getHeader('X-Request-Id'),
    });
  });

  next();
}
