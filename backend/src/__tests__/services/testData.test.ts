import { describe, it, expect } from 'vitest';
import { isTestUser, parseCleanupArgs } from '../../utils/testData';

describe('isTestUser', () => {
  it('matches the seeded development logins only', () => {
    expect(
      isTestUser({
        email: 'store.test@dvsindustry.local',
        fullName: 'Development Store User',
        role: 'STORE',
      }),
    ).toBe(true);
  });

  it('leaves real portal logins that share the .local domain alone', () => {
    expect(
      isTestUser({
        email: 'mahindra.accelo@dvsindustry.local',
        fullName: 'Mahindra Accelo Limited',
        role: 'SUPPLIER',
      }),
    ).toBe(false);
    expect(
      isTestUser({
        email: 'supplier.test@dvsindustry.local',
        fullName: 'Mahindra Accelo Limited',
        role: 'SUPPLIER',
      }),
    ).toBe(false);
  });

  it('never matches admin or the perception service', () => {
    expect(
      isTestUser({
        email: 'admin.test@dvsindustry.local',
        fullName: 'Development Admin User',
        role: 'ADMIN',
      }),
    ).toBe(false);
  });
});

describe('parseCleanupArgs', () => {
  it('is a dry run by default and skips incidents', () => {
    expect(parseCleanupArgs([])).toEqual({
      apply: false,
      incidents: false,
      incidentLocation: 'Test Room',
    });
  });

  it('reads --apply, --incidents and --location', () => {
    expect(parseCleanupArgs(['--apply', '--incidents', '--location', 'Bay 2'])).toEqual({
      apply: true,
      incidents: true,
      incidentLocation: 'Bay 2',
    });
  });

  it('refuses --location without a value', () => {
    expect(() => parseCleanupArgs(['--location', '--apply'])).toThrow(/needs a value/);
  });
});
