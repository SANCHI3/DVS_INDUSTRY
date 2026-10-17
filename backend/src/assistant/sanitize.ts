/**
 * Removes personal and secret data from tool results before they reach the
 * LLM. Field names are matched case-insensitively; e-mail addresses and phone
 * numbers that slip into free text are masked as well.
 */

const SENSITIVE_KEY_PARTS = [
  'password',
  'passwd',
  'token',
  'secret',
  'hash',
  'apikey',
  'api_key',
  'email',
  'e-mail',
  'phone',
  'mobile',
  'contactname',
  'address',
  'gstin',
  'useragent',
];

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Digit runs with spaces, dashes or brackets; masked only when they hold 10+
// digits, so dates (2026-10-17 = 8 digits) and quantities are left alone.
const PHONE_LIKE = /\+?\d[\d\s()-]{8,}\d/g;

export function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEY_PARTS.some((part) => lower.includes(part));
}

function maskText(text: string): string {
  return text
    .replace(EMAIL, '[hidden]')
    .replace(PHONE_LIKE, (match) => (match.replace(/\D/g, '').length >= 10 ? '[hidden]' : match));
}

/** Deep copy of `value` without sensitive fields; Dates become ISO strings. */
export function stripSensitive(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return maskText(value);
  if (Array.isArray(value)) return value.map(stripSensitive);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveKey(key)) continue;
      out[key] = stripSensitive(item);
    }
    return out;
  }
  return value;
}
