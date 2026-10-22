import winston from 'winston';
import { env } from '../config/env';
import { currentRequestId } from '../lib/requestContext';

const { combine, timestamp, errors, json, colorize, simple } = winston.format;

/** Tags each line with the ID of the request being handled, if any. */
const requestIdFormat = winston.format((info) => {
  const requestId = currentRequestId();
  if (requestId !== undefined) info['requestId'] = requestId;
  return info;
});

/**
 * Singleton Winston logger.
 *
 * - In production  → structured JSON (easy to ingest in CloudWatch / Datadog)
 * - In development → colorized human-readable output
 */
const logger = winston.createLogger({
  level: env.LOG_LEVEL,
  format: combine(
    requestIdFormat(),
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    errors({ stack: true }),
  ),
  transports: [
    new winston.transports.Console({
      format:
        env.NODE_ENV === 'production'
          ? combine(timestamp(), json())
          : combine(colorize(), simple()),
    }),
  ],
});

export { logger };
