/**
 * Axios API client — single instance used across the entire frontend.
 *
 * Handles:
 *  - Base URL (proxied through Vite → backend)
 *  - Attaches `Authorization: Bearer <token>` on every request
 *  - On 401 → attempts a silent token refresh then retries the original request once
 *  - On failed refresh → clears auth state and emits SESSION_EXPIRED_EVENT
 *  - Normalises errors into a consistent `ApiError` shape
 */

import axios, {
  type AxiosInstance,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
  type AxiosResponse,
  type AxiosError,
} from 'axios';

// ── Constants ─────────────────────────────────────────────────────────────────

export const API_BASE = '/api/v1';
// The refresh token lives only in an httpOnly cookie set by the backend.
const ACCESS_TOKEN_KEY  = 'dvs_access_token';

// ── Token helpers (accessed by auth.ts too) ──────────────────────────────────

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function setAccessToken(token: string): void {
  localStorage.setItem(ACCESS_TOKEN_KEY, token);
}

export function clearAccessToken(): void {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
}

// ── Typed API error ───────────────────────────────────────────────────────────

export interface ApiError {
  status:  number;
  code:    string;
  message: string;
  details?: unknown;
}

export function isApiError(err: unknown): err is ApiError {
  return (
    typeof err === 'object' &&
    err !== null &&
    'status' in err &&
    'code' in err &&
    'message' in err
  );
}

function normaliseError(error: AxiosError): ApiError {
  const data = error.response?.data as {
    error?: { code?: string; message?: string; details?: unknown };
  } | undefined;

  return {
    status:  error.response?.status ?? 0,
    code:    data?.error?.code    ?? 'NETWORK_ERROR',
    message: data?.error?.message ?? error.message ?? 'An unexpected error occurred',
    details: data?.error?.details,
  };
}

// ── Create instance ────────────────────────────────────────────────────────────

const api: AxiosInstance = axios.create({
  baseURL:         API_BASE,
  withCredentials: true,   // send cookies (refresh token) on every request
  timeout:         15_000,
  headers: { 'Content-Type': 'application/json' },
});

// ── Request interceptor — attach access token ──────────────────────────────────

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = getAccessToken();
  if (token) {
    config.headers['Authorization'] = `Bearer ${token}`;
  }
  return config;
});

// ── Response interceptor — handle 401 + error normalisation ───────────────────

/** Fired on window when the session cannot be refreshed; App returns to login. */
export const SESSION_EXPIRED_EVENT = 'dvs:session-expired';

const USER_KEY = 'dvs_user'; // owned by auth.ts; cleared here on session expiry

// One in-flight refresh per tab, shared by every request that hit a 401.
let refreshPromise: Promise<string> | null = null;

async function postRefresh(): Promise<string> {
  const res = await axios.post<{ data: { accessToken: string } }>(
    `${API_BASE}/auth/refresh`,
    {},
    { withCredentials: true },
  );
  const token = res.data.data.accessToken;
  setAccessToken(token);
  return token;
}

/**
 * Refresh tokens rotate on every use and a reused one revokes all sessions,
 * so two tabs refreshing at the same moment would log the user out. The Web
 * Locks API serialises refreshes across tabs; a tab that waited simply picks
 * up the token the other tab already stored.
 */
function refreshAccessToken(staleToken: string | null): Promise<string> {
  refreshPromise ??= (async () => {
    try {
      if (typeof navigator !== 'undefined' && 'locks' in navigator) {
        return await navigator.locks.request('dvs-token-refresh', async () => {
          const current = getAccessToken();
          if (current !== null && current !== staleToken) return current;
          return postRefresh();
        });
      }
      return await postRefresh();
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

function endSession(): void {
  clearAccessToken();
  localStorage.removeItem(USER_KEY);
  window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
}

api.interceptors.response.use(
  (response: AxiosResponse) => response,

  async (error: AxiosError) => {
    const original = error.config as (AxiosRequestConfig & { _retry?: boolean }) | undefined;

    // Only attempt refresh for 401s that are NOT auth endpoints themselves
    if (
      original !== undefined &&
      error.response?.status === 401 &&
      !original._retry &&
      !original.url?.includes('/auth/refresh') &&
      !original.url?.includes('/auth/login')
    ) {
      original._retry = true;
      const sentToken =
        String(original.headers?.['Authorization'] ?? '').replace(/^Bearer /, '') || null;

      let newToken: string;
      try {
        newToken = await refreshAccessToken(sentToken);
      } catch {
        endSession();
        return Promise.reject(normaliseError(error));
      }

      original.headers = { ...original.headers, Authorization: `Bearer ${newToken}` };
      return api(original);
    }

    return Promise.reject(normaliseError(error));
  },
);

export default api;

// ── Typed response helpers ────────────────────────────────────────────────────

export interface PaginatedMeta {
  page:       number;
  pageSize:   number;
  total:      number;
  totalPages: number;
}

export interface ApiResponse<T> {
  success: true;
  data:    T;
  message?: string;
  meta?:    PaginatedMeta;
}

/** Unwrap `response.data.data` from the standard envelope */
export function unwrap<T>(res: AxiosResponse<ApiResponse<T>>): T {
  return res.data.data;
}

/** Unwrap both data and pagination meta */
export function unwrapPaged<T>(res: AxiosResponse<ApiResponse<T>>): { data: T; meta: PaginatedMeta } {
  return { data: res.data.data, meta: res.data.meta! };
}
