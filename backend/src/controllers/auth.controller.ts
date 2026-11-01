import type { Request, Response } from 'express';
import type { AuthenticatedRequest } from '../types';
import type { AdminUpdateUserData } from '../interfaces';
import { AuthService } from '../services';
import { sendSuccess, sendCreated, sendNoContent } from '../utils/response';
import { REFRESH_TOKEN_COOKIE, COOKIE_OPTIONS } from '../constants';
import { env } from '../config/env';
import { parseExpiresInMs } from '../utils/token';
import type {
  RegisterInput,
  LoginInput,
  ChangePasswordInput,
  UpdateProfileInput,
  ForgotPasswordInput,
  ResetPasswordInput,
} from '../validators';

const authService = new AuthService();

/**
 * The refresh cookie lives as long as the refresh token. Without a max age it
 * would be a session cookie, dropped when the browser closes while the app
 * still shows the user as signed in.
 */
function setRefreshCookie(res: Response, refreshToken: string): void {
  res.cookie(REFRESH_TOKEN_COOKIE, refreshToken, {
    ...COOKIE_OPTIONS,
    maxAge: parseExpiresInMs(env.REFRESH_TOKEN_EXPIRES_IN),
  });
}

// ── Register ──────────────────────────────────────────────────────────────────

export async function register(req: Request, res: Response): Promise<void> {
  const body = req.body as RegisterInput;
  const user = await authService.register({
    fullName: body.fullName,
    email: body.email,
    password: body.password,
    phone: body.phone ?? null,
    roleId: body.roleId,
    ...(body.supplierId !== undefined && { supplierId: body.supplierId }),
    ...(body.clientId !== undefined && { clientId: body.clientId }),
  });
  sendCreated(res, user, 'User registered successfully');
}

export async function getUsers(_req: Request, res: Response): Promise<void> {
  const users = await authService.getUsers();
  sendSuccess(res, users);
}

export async function getEligibleEmployees(_req: Request, res: Response): Promise<void> {
  const users = await authService.getEligibleEmployees();
  sendSuccess(res, users);
}

export async function updateUser(req: AuthenticatedRequest, res: Response): Promise<void> {
  const targetUserId = Number(req.params['id']);
  const user = await authService.updateUser(
    req.user!.id,
    targetUserId,
    req.body as AdminUpdateUserData,
  );
  sendSuccess(res, user, 200, 'User updated successfully');
}

// ── Login ─────────────────────────────────────────────────────────────────────

export async function login(req: Request, res: Response): Promise<void> {
  const { email, password } = req.body as LoginInput;
  const { user, tokens } = await authService.login(email, password);

  // Lets the audit middleware attribute this LOGIN to the user
  res.locals['auditActor'] = { id: user.id, email: user.email, role: user.role.name };

  // Refresh token → secure HttpOnly cookie
  setRefreshCookie(res, tokens.refreshToken);

  sendSuccess(res, { user, accessToken: tokens.accessToken }, 200, 'Login successful');
}

// ── Logout ────────────────────────────────────────────────────────────────────

export async function logout(req: Request, res: Response): Promise<void> {
  const token: string | undefined = req.cookies[REFRESH_TOKEN_COOKIE] as string | undefined;

  if (token !== undefined) {
    await authService.logout(token);
  }

  res.clearCookie(REFRESH_TOKEN_COOKIE, { ...COOKIE_OPTIONS });
  sendNoContent(res);
}

// ── Refresh Token ─────────────────────────────────────────────────────────────

export async function refreshTokens(req: Request, res: Response): Promise<void> {
  const token: string | undefined = req.cookies[REFRESH_TOKEN_COOKIE] as string | undefined;

  // No cookie simply means "not signed in" (e.g. a visitor, or after
  // logout): answer without an error status so the browser logs nothing.
  if (token === undefined) {
    sendNoContent(res);
    return;
  }

  const tokens = await authService.refreshTokens(token);

  // Rotate cookie
  setRefreshCookie(res, tokens.refreshToken);

  sendSuccess(res, { accessToken: tokens.accessToken }, 200, 'Tokens refreshed');
}

// ── Change Password ───────────────────────────────────────────────────────────

export async function changePassword(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.id;
  const body = req.body as ChangePasswordInput;

  await authService.changePassword(userId, {
    currentPassword: body.currentPassword,
    newPassword: body.newPassword,
  });

  // Clear refresh token cookie — all sessions revoked
  res.clearCookie(REFRESH_TOKEN_COOKIE, { ...COOKIE_OPTIONS });

  sendSuccess(res, null, 200, 'Password changed successfully. Please log in again.');
}

// ── Forgot Password ───────────────────────────────────────────────────────────

export async function forgotPassword(req: Request, res: Response): Promise<void> {
  const { email } = req.body as ForgotPasswordInput;
  await authService.forgotPassword(email);

  // Never reveal whether the email exists
  sendSuccess(res, null, 200, 'If an account with that email exists, a reset link has been sent.');
}

// ── Reset Password ────────────────────────────────────────────────────────────

export async function resetPassword(req: Request, res: Response): Promise<void> {
  const { token, newPassword } = req.body as ResetPasswordInput;
  await authService.resetPassword(token, newPassword);
  sendSuccess(res, null, 200, 'Password reset successfully. Please log in.');
}

// ── Get Me ────────────────────────────────────────────────────────────────────

export async function getMe(req: AuthenticatedRequest, res: Response): Promise<void> {
  const user = await authService.getMe(req.user!.id);
  sendSuccess(res, user);
}

// ── Update Profile ────────────────────────────────────────────────────────────

export async function updateProfile(req: AuthenticatedRequest, res: Response): Promise<void> {
  const body = req.body as UpdateProfileInput;
  // Only touch fields the client actually sent — omitting `phone` must not
  // clear it. An explicit null still clears it.
  const updateData: { fullName?: string; phone?: string | null } = {};
  if (body.fullName !== undefined) updateData.fullName = body.fullName;
  if (body.phone !== undefined) updateData.phone = body.phone;
  const user = await authService.updateProfile(req.user!.id, updateData);
  sendSuccess(res, user, 200, 'Profile updated successfully');
}

// ── Deactivate User ───────────────────────────────────────────────────────────

export async function deactivateUser(req: AuthenticatedRequest, res: Response): Promise<void> {
  const targetUserId = Number(req.params['id']);
  const user = await authService.deactivateUser(req.user!.id, targetUserId);
  sendSuccess(res, user, 200, 'User deactivated successfully');
}

// ── List Roles ────────────────────────────────────────────────────────────────

export async function getRoles(_req: Request, res: Response): Promise<void> {
  const roles = await authService.getRoles();
  sendSuccess(res, roles);
}
