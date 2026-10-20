// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import axios, { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from "axios";
import api, {
  SESSION_EXPIRED_EVENT, clearAccessToken, getAccessToken, isServerStarting, setAccessToken,
} from "../api";

type Reply = { status: number; data?: unknown } | "network-down";

/** Answers requests by URL; every request is recorded with its token. */
function fakeServer(routes: Record<string, Reply[]>) {
  const seen: { url: string; auth: string | undefined }[] = [];
  const adapter: AxiosAdapter = async (config: InternalAxiosRequestConfig) => {
    const url = config.url ?? "";
    seen.push({ url, auth: config.headers?.["Authorization"] as string | undefined });
    const key = Object.keys(routes).find((k) => url.endsWith(k));
    const reply = key ? routes[key].shift() : undefined;
    if (reply === undefined) throw new Error(`unexpected request ${url}`);
    if (reply === "network-down") throw new AxiosError("Network Error", "ERR_NETWORK", config);
    const response = { status: reply.status, statusText: "", data: reply.data ?? {}, headers: {}, config };
    if (reply.status >= 400) {
      throw new AxiosError("fail", "ERR_BAD_RESPONSE", config, undefined, response);
    }
    return response;
  };
  api.defaults.adapter = adapter;
  axios.defaults.adapter = adapter; // the refresh call uses plain axios
  return seen;
}

const refreshed = (token: string) => ({ status: 200, data: { data: { accessToken: token } } });

let expired: ReturnType<typeof vi.fn<() => void>>;
beforeEach(() => {
  clearAccessToken();
  expired = vi.fn<() => void>();
  window.addEventListener(SESSION_EXPIRED_EVENT, expired);
});
afterEach(() => window.removeEventListener(SESSION_EXPIRED_EVENT, expired));

describe("access token", () => {
  it("is kept in memory, never in localStorage", () => {
    setAccessToken("abc");
    expect(getAccessToken()).toBe("abc");
    expect(JSON.stringify({ ...localStorage })).not.toContain("abc");
  });
});

describe("401 handling", () => {
  it("refreshes after a reload (no token yet) and retries with the new token", async () => {
    const seen = fakeServer({
      "/inventory": [{ status: 401 }, { status: 200, data: { ok: true } }],
      "/auth/refresh": [refreshed("fresh")],
    });

    const res = await api.get("/inventory");

    expect(res.data).toEqual({ ok: true });
    expect(seen.at(-1)).toEqual({ url: "/inventory", auth: "Bearer fresh" });
    expect(getAccessToken()).toBe("fresh");
    expect(expired).not.toHaveBeenCalled();
  });

  it("ends the session when the server refuses the refresh", async () => {
    fakeServer({ "/inventory": [{ status: 401 }], "/auth/refresh": [{ status: 401 }] });

    await expect(api.get("/inventory")).rejects.toMatchObject({ status: 401 });
    expect(expired).toHaveBeenCalledTimes(1);
  });

  it.each([["server still starting", { status: 503 }], ["no response", "network-down"]] as const)(
    "keeps the session when the refresh fails because of an outage (%s)",
    async (_label, reply) => {
      fakeServer({ "/inventory": [{ status: 401 }], "/auth/refresh": [reply as Reply] });

      const err = await api.get("/inventory").catch((e: unknown) => e);

      expect(isServerStarting(err)).toBe(true);
      expect(expired).not.toHaveBeenCalled();
    },
  );
});

describe("isServerStarting", () => {
  it("is true only for no response and gateway errors", () => {
    for (const status of [0, 502, 503, 504]) {
      expect(isServerStarting({ status, code: "X", message: "" })).toBe(true);
    }
    for (const status of [400, 401, 404, 500]) {
      expect(isServerStarting({ status, code: "X", message: "" })).toBe(false);
    }
    // A proxy's own 500 (plain text, no API error body)
    expect(isServerStarting({ status: 500, code: "NETWORK_ERROR", message: "" })).toBe(true);
    expect(isServerStarting(new Error("x"))).toBe(false);
  });
});
