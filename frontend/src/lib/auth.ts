/**
 * Auth store — thin wrapper over the API client.
 *
 * Responsibilities:
 *  - POST /auth/login → store access token + user profile in localStorage
 *  - POST /auth/logout → clear tokens
 *  - POST /auth/refresh → get new access token (used by api.ts interceptor too)
 *  - getUser()  → typed user from localStorage (survives page reload)
 *  - getRoleName() → maps backend role name to frontend Role type
 */

import api, { setAccessToken, clearAccessToken, unwrap } from './api';

// ── Backend types (mirror backend interfaces) ─────────────────────────────────

export interface AuthUser {
  id:       number;
  fullName: string;
  email:    string;
  role:     string | { name: string }; // Backend returns the role object.
  isActive: boolean;
}

export interface LoginResponse {
  accessToken: string;
  user:        AuthUser;
}

// ── Frontend role mapping ─────────────────────────────────────────────────────
// Backend roles → frontend page/section roles

export type FrontendRole = 'admin' | 'production' | 'store' | 'supplier' | 'client' | 'unauthorized';

const BACKEND_TO_FRONTEND: Record<string, FrontendRole> = {
  ADMIN:      'admin',
  MANAGER:    'admin',
  HR:         'admin',
  PRODUCTION: 'production',
  STORE:      'store',
  SALES:      'store',
  SUPPLIER:   'supplier',
  CLIENT:     'client',
};

export function getFrontendRole(backendRole: string): FrontendRole {
  return BACKEND_TO_FRONTEND[backendRole.toUpperCase()] ?? 'unauthorized';
}

function getBackendRoleName(role: AuthUser['role']): string {
  return typeof role === 'string' ? role : role.name;
}

// ── Persistence keys ──────────────────────────────────────────────────────────

const USER_KEY = 'dvs_user';

function persistUser(user: AuthUser): void {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

function loadUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

function clearUser(): void {
  localStorage.removeItem(USER_KEY);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Login with email + password.
 * Returns the user profile and the derived frontend role.
 */
export async function login(
  email:    string,
  password: string,
): Promise<{ user: AuthUser; frontendRole: FrontendRole }> {
  const res = await api.post<{ success: true; data: LoginResponse }>(
    '/auth/login',
    { email, password },
  );
  const { accessToken, user } = unwrap(res);
  setAccessToken(accessToken);
  persistUser(user);
  return { user, frontendRole: getFrontendRole(getBackendRoleName(user.role)) };
}

/**
 * Logout — calls the backend endpoint and clears local state.
 * Swallows network errors (backend may already have invalidated the token).
 */
export async function logout(): Promise<void> {
  try {
    await api.post('/auth/logout');
  } catch {
    // swallow
  } finally {
    clearAccessToken();
    clearUser();
  }
}

/**
 * Get the currently stored user, or null if not logged in.
 * Does NOT make a network request — reads from localStorage.
 */
export function getUser(): AuthUser | null {
  return loadUser();
}

/**
 * Returns true if a valid-looking access token + user exist in storage.
 * Does not validate the JWT signature — the API will return 401 if expired.
 */
export function isLoggedIn(): boolean {
  return getUser() !== null;
}

/**
 * Update local user record (e.g. after profile update).
 */
export function updateStoredUser(partial: Partial<AuthUser>): void {
  const current = loadUser();
  if (current) persistUser({ ...current, ...partial });
}

/**
 * Frontend role of the stored session, or null when nobody is signed in.
 * Used to restore the right app after a page reload.
 */
export function getStoredFrontendRole(): FrontendRole | null {
  const user = loadUser();
  return user ? getFrontendRole(getBackendRoleName(user.role)) : null;
}

/** Complete a password reset using the token from the emailed link. */
export async function resetPassword(token: string, newPassword: string): Promise<void> {
  await api.post('/auth/reset-password', { token, newPassword, confirmPassword: newPassword });
}

/** Backend role name of the signed-in user (e.g. "STORE"), or null. */
export function getStoredBackendRole(): string | null {
  const user = loadUser();
  return user ? getBackendRoleName(user.role).toUpperCase() : null;
}

/** True when the signed-in user has the backend ADMIN role (not MANAGER/HR). */
export function isAdministrator(): boolean {
  const user = getUser();
  return !!user && getBackendRoleName(user.role) === 'ADMIN';
}
