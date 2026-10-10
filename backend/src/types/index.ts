// Global TypeScript type augmentations and shared types.

import type { Request } from 'express';

/**
 * Extends Express Request to carry the authenticated user payload
 * after the auth middleware runs. Populated by the authenticate() middleware.
 */
export interface AuthenticatedRequest extends Request {
  user?: {
    id: number;
    email: string;
    fullName?: string;
    role: string; // role name e.g. "ADMIN"
  };
}

/** Convenience alias used in controllers that require auth */
export type AuthReq = AuthenticatedRequest;
