import { env } from '../config/env';
import { ROLES } from '../constants';

/** "a@x.com, B@x.com" → {"a@x.com", "b@x.com"} */
export function parseEmailList(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e !== ''),
  );
}

/**
 * Support staff: an ADMIN whose email is in DIAGNOSTICS_EMAILS. Only they get
 * the Live view check's technical details, including the plant's internal
 * live address. Nobody is listed by default.
 */
export function canSeeDiagnostics(
  user: { email: string; role: string } | undefined,
  allowed: Set<string> = parseEmailList(env.DIAGNOSTICS_EMAILS),
): boolean {
  return user !== undefined && user.role === ROLES.ADMIN && allowed.has(user.email.toLowerCase());
}
