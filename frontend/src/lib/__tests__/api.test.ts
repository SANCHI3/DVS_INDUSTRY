// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import axios, { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from "axios";
import api, {
  SESSION_EXPIRED_EVENT, clearAccessToken, describeApiError, getAccessToken, isServerStarting, onServerWaking, setAccessToken,
} from "../api";

type Reply = { status: number; data?: unknown } | "network-down" | "timeout";

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
    if (reply === "timeout") throw new AxiosError("timeout of 15000ms exceeded", "ECONNABORTED", config);
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

describe("after a reload with a signed-in user", () => {
  beforeEach(() => localStorage.setItem("dvs_user", JSON.stringify({ id: 1 })));
  afterEach(() => localStorage.clear());

  it("refreshes before the first request, so it never gets a 401", async () => {
    const seen = fakeServer({
      "/auth/refresh": [refreshed("fresh")],
      "/inventory": [{ status: 200, data: { ok: true } }],
    });

    const res = await api.get("/inventory");

    expect(res.data).toEqual({ ok: true });
    expect(seen.map((r) => r.url)).toEqual(["/api/v1/auth/refresh", "/inventory"]);
    expect(seen[1].auth).toBe("Bearer fresh");
  });

  it("ends the session without sending the request when the refresh is refused", async () => {
    const seen = fakeServer({ "/auth/refresh": [{ status: 401 }] });

    await expect(api.get("/inventory")).rejects.toMatchObject({ status: 401 });
    expect(expired).toHaveBeenCalledTimes(1);
    expect(seen.map((r) => r.url)).toEqual(["/api/v1/auth/refresh"]);
  });
});

describe("refresh without a session cookie", () => {
  beforeEach(() => localStorage.setItem("dvs_user", JSON.stringify({ id: 1 })));
  afterEach(() => localStorage.clear());

  it("treats the server's 204 as signed out, without sending the request", async () => {
    const seen = fakeServer({ "/auth/refresh": [{ status: 204, data: "" }] });

    await expect(api.get("/inventory")).rejects.toMatchObject({ status: 401 });
    expect(expired).toHaveBeenCalledTimes(1);
    expect(seen.map((r) => r.url)).toEqual(["/api/v1/auth/refresh"]);
  });
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

describe("reads while the server is starting", () => {
  beforeEach(() => { setAccessToken("t"); vi.useFakeTimers(); });
  afterEach(() => vi.useRealTimers());

  it("retries a GET after a gateway error and says the server is waking", async () => {
    const waking = vi.fn();
    const stop = onServerWaking(waking);
    const seen = fakeServer({ "/security/kpis": [{ status: 502 }, "timeout", { status: 200, data: { ok: 1 } }] });

    const pending = api.get("/security/kpis");
    await vi.advanceTimersByTimeAsync(7_000);

    expect((await pending).data).toEqual({ ok: 1 });
    expect(seen).toHaveLength(3);
    expect(waking).toHaveBeenCalledTimes(2);
    stop();
  });

  it("gives up after two retries with the gateway error", async () => {
    const seen = fakeServer({ "/orders": [{ status: 503 }, { status: 503 }, { status: 503 }] });
    const pending = api.get("/orders").catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(7_000);
    expect(await pending).toMatchObject({ status: 503 });
    expect(seen).toHaveLength(3);
  });

  it("never retries a write, which might already have been applied", async () => {
    const seen = fakeServer({ "/orders": [{ status: 502 }] });
    await expect(api.post("/orders", {})).rejects.toMatchObject({ status: 502 });
    expect(seen).toHaveLength(1);
  });

  it("does not retry a real answer such as 404", async () => {
    const seen = fakeServer({ "/orders/9": [{ status: 404 }] });
    await expect(api.get("/orders/9")).rejects.toMatchObject({ status: 404 });
    expect(seen).toHaveLength(1);
  });

  it("labels a timeout as TIMEOUT", async () => {
    fakeServer({ "/slow": ["timeout", "timeout", "timeout"] });
    const pending = api.get("/slow").catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(7_000);
    expect(await pending).toMatchObject({ status: 0, code: "TIMEOUT" });
  });
});

describe("describeApiError", () => {
  it("speaks plainly about server faults and being offline", () => {
    expect(describeApiError({ status: 500, code: "INTERNAL", message: "Prisma P2002" }, "load orders"))
      .toBe("Could not load orders: something went wrong on our side. Please try again in a moment.");
    expect(describeApiError({ status: 0, code: "OFFLINE", message: "Network Error" }, "load orders"))
      .toMatch(/this device is offline/);
  });
});
