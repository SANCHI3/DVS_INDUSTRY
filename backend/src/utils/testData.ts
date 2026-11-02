/**
 * What counts as test data, for scripts/cleanup-test-data.ts. Kept narrow on
 * purpose: real portal logins also use @dvsindustry.local addresses, so a
 * user must match both the seed's test email and its "Development … User" name.
 */
export const TEST_USER_EMAIL = /^[a-z]+\.test@dvsindustry\.local$/i;
export const TEST_USER_NAME = /^Development .+ User$/;

export const TEST_CODE_PREFIX = {
  supplier: 'SUP-TEST-',
  client: 'CLT-TEST-',
  purchaseOrder: 'PO-TEST-',
  clientOrder: 'ORD-TEST-',
} as const;

/** Where the perception service was tried out before the real cameras. */
export const DEFAULT_TEST_INCIDENT_LOCATION = 'Test Room';

/** Roles the cleanup never touches, whatever the name or email. */
const PROTECTED_ROLES = new Set(['ADMIN', 'PERCEPTION_SERVICE']);

export function isTestUser(user: { email: string; fullName: string; role: string }): boolean {
  return (
    !PROTECTED_ROLES.has(user.role) &&
    TEST_USER_EMAIL.test(user.email) &&
    TEST_USER_NAME.test(user.fullName)
  );
}

export interface CleanupOptions {
  apply: boolean;
  incidents: boolean;
  incidentLocation: string;
}

/** Dry run unless --apply; incidents only with --incidents [--location "Test Room"]. */
export function parseCleanupArgs(argv: string[]): CleanupOptions {
  const at = argv.indexOf('--location');
  const location = at >= 0 ? argv[at + 1] : undefined;
  if (at >= 0 && (location === undefined || location.startsWith('--') || location.trim() === '')) {
    throw new Error('--location needs a value, e.g. --location "Test Room"');
  }
  return {
    apply: argv.includes('--apply'),
    incidents: argv.includes('--incidents'),
    incidentLocation: location ?? DEFAULT_TEST_INCIDENT_LOCATION,
  };
}
