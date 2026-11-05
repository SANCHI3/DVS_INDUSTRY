import { createHmac } from 'crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';

/** A live-view pass lasts 2 minutes and opens one stream of one camera. */
export const LIVE_TOKEN_TTL_S = 120;
const AUDIENCE = 'dvs-live-view';

// Its own key, so a live pass can never be used as a sign-in token or the reverse
const signingKey = (): Buffer =>
  createHmac('sha256', env.JWT_SECRET).update('camera-live-token').digest();

export function signLiveToken(path: string, userId: number): string {
  return jwt.sign({ path }, signingKey(), {
    algorithm: 'HS256',
    audience: AUDIENCE,
    subject: String(userId),
    expiresIn: LIVE_TOKEN_TTL_S,
  });
}

/** The stream path the pass opens, or null if it is forged, expired or malformed. */
export function liveTokenPath(token: string): string | null {
  try {
    const payload = jwt.verify(token, signingKey(), {
      algorithms: ['HS256'],
      audience: AUDIENCE,
    });
    return typeof payload === 'object' && typeof payload['path'] === 'string'
      ? payload['path']
      : null;
  } catch {
    return null;
  }
}
