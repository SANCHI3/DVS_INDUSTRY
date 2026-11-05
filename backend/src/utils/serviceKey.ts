import { createHash, timingSafeEqual } from 'crypto';
import { env } from '../config/env';
import { ROLES } from '../constants';

const MIN_KEY_LENGTH = 32;
const digest = (value: string): Buffer => createHash('sha256').update(value).digest();

/** True only for the configured key. A missing or short key lets nobody in. */
export function serviceKeyMatches(
  sent: string | string[] | undefined,
  expected: string | undefined = env.CAMERA_SERVICE_KEY,
): boolean {
  const key = expected?.trim() ?? '';
  if (key.length < MIN_KEY_LENGTH || typeof sent !== 'string') return false;
  return timingSafeEqual(digest(sent.trim()), digest(key));
}

/** Who the key signs in as: the perception role, and nothing more. */
export function serviceActor() {
  return {
    id: 0,
    email: 'cctv-pc@dvsindustry.local',
    fullName: 'CCTV monitoring',
    role: ROLES.PERCEPTION_SERVICE,
  };
}
