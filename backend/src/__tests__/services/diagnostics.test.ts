import { describe, expect, it } from 'vitest';
import { canSeeDiagnostics, parseEmailList } from '../../utils/diagnostics';

describe('DIAGNOSTICS_EMAILS', () => {
  it('ignores capital letters, extra spaces and empty entries', () => {
    expect([...parseEmailList('  Asha@DVS.com ,ravi@dvs.com,, \tSUPPORT@dvs.com  ')]).toEqual([
      'asha@dvs.com',
      'ravi@dvs.com',
      'support@dvs.com',
    ]);
    expect(parseEmailList(undefined).size).toBe(0);
    expect(parseEmailList(' , ').size).toBe(0);
  });

  it('matches the signed-in email whatever its capitals or spaces', () => {
    const allowed = parseEmailList(' Asha@DVS.com ');
    expect(canSeeDiagnostics({ email: 'asha@dvs.com', role: 'ADMIN' }, allowed)).toBe(true);
    expect(canSeeDiagnostics({ email: 'ASHA@dvs.COM', role: 'ADMIN' }, allowed)).toBe(true);
    expect(canSeeDiagnostics({ email: ' asha@dvs.com ', role: 'ADMIN' }, allowed)).toBe(true);
  });

  it('is for listed admins only, and nobody when the list is empty', () => {
    const allowed = parseEmailList('asha@dvs.com');
    expect(canSeeDiagnostics({ email: 'ravi@dvs.com', role: 'ADMIN' }, allowed)).toBe(false);
    expect(canSeeDiagnostics({ email: 'asha@dvs.com', role: 'MANAGER' }, allowed)).toBe(false);
    expect(canSeeDiagnostics(undefined, allowed)).toBe(false);
    expect(canSeeDiagnostics({ email: 'asha@dvs.com', role: 'ADMIN' }, new Set())).toBe(false);
  });

  it('does not match part of an address', () => {
    const allowed = parseEmailList('asha@dvs.com');
    expect(canSeeDiagnostics({ email: 'sha@dvs.com', role: 'ADMIN' }, allowed)).toBe(false);
    expect(canSeeDiagnostics({ email: 'asha@dvs.com.evil', role: 'ADMIN' }, allowed)).toBe(false);
  });
});
