/**
 * "My Profile": the signed-in user's own account (GET/PATCH /auth/me and
 * PATCH /auth/change-password), plus the checks the password form runs
 * before anything is sent.
 */
import api, { isApiError, unwrap } from './api';

export interface MyProfile {
  id:        number;
  fullName:  string;
  email:     string;
  phone:     string | null;
  isActive:  boolean;
  lastLogin: string | null;
  role:      { id: number; name: string; description: string | null };
}

export async function getMyProfile(): Promise<MyProfile> {
  const res = await api.get<{ success: true; data: MyProfile }>('/auth/me');
  return unwrap(res);
}

/** Only fullName and phone are accepted by updateProfileSchema; null clears the phone. */
export async function updateMyProfile(input: { fullName: string; phone: string | null }): Promise<MyProfile> {
  const res = await api.patch<{ success: true; data: MyProfile }>('/auth/me', input);
  return unwrap(res);
}

export async function changeMyPassword(input: PasswordChange): Promise<void> {
  await api.patch('/auth/change-password', input);
}

const ROLE_NAMES: Record<string, string> = {
  ADMIN: 'Administrator',
  MANAGER: 'Plant Manager',
  HR: 'HR Officer',
  PRODUCTION: 'Production Supervisor',
  STORE: 'Store Keeper',
  SALES: 'Sales Executive',
  SUPPLIER: 'Supplier',
  CLIENT: 'Client',
  PERCEPTION_SERVICE: 'Camera AI service',
};

export function roleDisplayName(role: string): string {
  return ROLE_NAMES[role.toUpperCase()]
    ?? role.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Mirrors passwordField in backend/src/validators/auth.validator.ts. */
export const PASSWORD_RULES: Array<{ hint: string; test: (password: string) => boolean }> = [
  { hint: 'At least 8 characters', test: (p) => p.length >= 8 },
  { hint: 'One capital letter (A-Z)', test: (p) => /[A-Z]/.test(p) },
  { hint: 'One small letter (a-z)', test: (p) => /[a-z]/.test(p) },
  { hint: 'One number (0-9)', test: (p) => /[0-9]/.test(p) },
  { hint: 'One symbol, such as ! @ # $ %', test: (p) => /[!@#$%^&*(),.?":{}|<>]/.test(p) },
];

/** Mirrors phoneField: 7-20 digits, spaces, dashes, dots or brackets, optional leading +. */
export function isValidPhone(phone: string): boolean {
  return /^\+?[0-9\s\-().]{7,20}$/.test(phone);
}

export interface PasswordChange {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export const PASSWORD_CHANGED_MESSAGE = 'Password changed. Please log in again.';

/** Why the form cannot be sent yet, or null when it can. */
export function checkPasswordChange(values: PasswordChange): string | null {
  if (!values.currentPassword) return 'Enter your current password.';
  if (!values.newPassword) return 'Enter a new password.';
  const missing = PASSWORD_RULES.filter((rule) => !rule.test(values.newPassword));
  if (missing.length > 0) {
    return `The new password needs: ${missing.map((rule) => rule.hint.charAt(0).toLowerCase() + rule.hint.slice(1)).join('; ')}.`;
  }
  if (values.newPassword !== values.confirmPassword) return 'The two new passwords do not match.';
  if (values.newPassword === values.currentPassword) return 'The new password must be different from your current one.';
  return null;
}

export type PasswordChangeResult = { ok: true; message: string } | { ok: false; message: string };

/**
 * Check the form, then send it. Nothing is sent when a check fails. The
 * backend ends every session after a password change, so success always
 * means signing in again.
 */
export async function submitPasswordChange(
  values: PasswordChange,
  send: (values: PasswordChange) => Promise<void> = changeMyPassword,
): Promise<PasswordChangeResult> {
  const problem = checkPasswordChange(values);
  if (problem) return { ok: false, message: problem };
  try {
    await send(values);
    return { ok: true, message: PASSWORD_CHANGED_MESSAGE };
  } catch (error) {
    const message = isApiError(error) && error.message ? error.message : 'Could not change the password. Please try again.';
    return { ok: false, message };
  }
}
