import { z } from 'zod';

// ── Reusable field schemas ────────────────────────────────────────────────────
// Zod v4: required_error is no longer valid — use .min(1) or check in refine

const emailField = z
  .string()
  .min(1, 'Email is required')
  .email('Must be a valid email address')
  .toLowerCase()
  .trim();

/**
 * Password must be at least 8 characters and contain:
 * - 1 uppercase letter, 1 lowercase letter, 1 number, 1 special character
 */
const passwordField = z
  .string()
  .min(1, 'Password is required')
  .min(8, 'Password must be at least 8 characters')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[0-9]/, 'Password must contain at least one number')
  .regex(/[!@#$%^&*(),.?":{}|<>]/, 'Password must contain at least one special character');

const phoneField = z
  .string()
  .regex(/^\+?[0-9\s\-().]{7,20}$/, 'Must be a valid phone number')
  .optional()
  .nullable();

// ── Request body schemas ──────────────────────────────────────────────────────

export const registerSchema = z.object({
  fullName: z
    .string()
    .min(1, 'Full name is required')
    .min(2, 'Full name must be at least 2 characters')
    .max(100)
    .trim(),
  email: emailField,
  password: passwordField,
  phone: phoneField,
  roleId: z.number().int().positive('roleId must be a positive integer'),
  // Portal logins: which supplier or client company the account belongs to
  supplierId: z.number().int().positive().optional(),
  clientId: z.number().int().positive().optional(),
});

export const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1, 'Password is required'),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: passwordField,
    confirmPassword: z.string().min(1, 'Confirm password is required'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export const updateProfileSchema = z.object({
  fullName: z.string().min(2, 'Full name must be at least 2 characters').max(100).trim().optional(),
  phone: phoneField,
});

export const forgotPasswordSchema = z.object({
  email: emailField,
});

export const resetPasswordSchema = z
  .object({
    token: z.string().min(1, 'Token is required'),
    newPassword: passwordField,
    confirmPassword: z.string().min(1, 'Confirm password is required'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export const userIdParamSchema = z.object({
  id: z.coerce.number().int().positive('User id must be a positive integer'),
});

export const adminUpdateUserSchema = z.object({
  fullName: z.string().min(2).max(100).trim().optional(),
  email: emailField.optional(),
  roleId: z.number().int().positive().optional(),
  // false deactivates (sessions end), true reactivates
  isActive: z.boolean().optional(),
});

// ── Exported types inferred from schemas ──────────────────────────────────────

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
