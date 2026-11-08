import { createHmac } from 'crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import type { StreamAuthReason } from './streamAuthLog';

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

/** The stream path the pass opens, or why it opens nothing. */
export function checkLiveToken(token: string): { path: string } | { error: 'expired' | 'invalid' } {
  try {
    const payload = jwt.verify(token, signingKey(), {
      algorithms: ['HS256'],
      audience: AUDIENCE,
    });
    return typeof payload === 'object' && typeof payload['path'] === 'string'
      ? { path: payload['path'] }
      : { error: 'invalid' };
  } catch (err) {
    return { error: err instanceof jwt.TokenExpiredError ? 'expired' : 'invalid' };
  }
}

/** The stream path the pass opens, or null if it is forged, expired or malformed. */
export function liveTokenPath(token: string): string | null {
  const result = checkLiveToken(token);
  return 'path' in result ? result.path : null;
}

/** What the video server on the plant PC sends for each viewer (MediaMTX authHTTPAddress). */
export interface StreamAuthRequest {
  action: string;
  path: string;
  protocol: string;
  token?: string | null | undefined;
  password?: string | null | undefined;
  query?: string | null | undefined;
}

/**
 * The pass, however MediaMTX passed it on: WHEP and hls.js send it as
 * "Authorization: Bearer", which MediaMTX forwards as `token`; Safari's own HLS
 * player can only put it in the address, which arrives as `query`.
 */
export function passFrom(body: StreamAuthRequest): string {
  return body.token || body.password || (new URLSearchParams(body.query ?? '').get('token') ?? '');
}

/** Allow one viewer, or say why not. Only reading WebRTC or HLS is ever allowed. */
export function decideStreamAuth(body: StreamAuthRequest): {
  allowed: boolean;
  reason: StreamAuthReason;
} {
  if (body.action !== 'read' || !['webrtc', 'hls'].includes(body.protocol) || body.path === '') {
    return { allowed: false, reason: 'not-viewing' };
  }
  const pass = passFrom(body);
  if (!pass) return { allowed: false, reason: 'no-pass' };
  const result = checkLiveToken(pass);
  if ('error' in result) return { allowed: false, reason: result.error };
  if (result.path !== body.path) return { allowed: false, reason: 'wrong-path' };
  return { allowed: true, reason: 'allowed' };
}
