import { afterEach, describe, expect, it, vi } from "vitest";
import { describeApiError, fetchAllPages, withServerWake, type ApiError } from "../api";

const apiError = (status: number, code = "X", message = "Boom", details?: unknown): ApiError => ({ status, code, message, details });

afterEach(() => { vi.unstubAllGlobals(); });

describe("describeApiError", () => {
  it("explains each failure in words a user can act on", () => {
    expect(describeApiError(apiError(0, "NETWORK_ERROR"), "load work orders")).toMatch(/^Could not load work orders: the server did not respond in time/);
    expect(describeApiError(apiError(401), "load employees")).toContain("session has expired");
    expect(describeApiError(apiError(403, "FORBIDDEN"), "load attendance")).toBe("Could not load attendance: your role does not have access to this.");
    expect(describeApiError(apiError(409, "CONFLICT", 'Employee with code "EMP-1" already exists'), "create the employee"))
      .toBe('Could not create the employee: Employee with code "EMP-1" already exists.');
    expect(describeApiError(apiError(500, "INTERNAL_ERROR", "Database unavailable"), "load KPIs")).toContain("(server error 500)");
  });

  it("lists validation problems by field", () => {
    const err = apiError(422, "VALIDATION_ERROR", "Validation failed", [{ field: "producedParts", message: "Cannot be negative" }]);
    expect(describeApiError(err, "save performance")).toBe("Could not save performance: producedParts: Cannot be negative.");
  });
});

describe("withServerWake", () => {
  it("waits for a sleeping server and retries once", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    const request = vi.fn().mockRejectedValueOnce(apiError(504, "NETWORK_ERROR")).mockResolvedValueOnce("data");
    const onWaiting = vi.fn();

    await expect(withServerWake(request, onWaiting)).resolves.toBe("data");
    expect(request).toHaveBeenCalledTimes(2);
    expect(onWaiting).toHaveBeenCalledTimes(1);
  });

  it("does not retry real answers such as 403", async () => {
    const request = vi.fn().mockRejectedValue(apiError(403, "FORBIDDEN"));
    await expect(withServerWake(request)).rejects.toMatchObject({ status: 403 });
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe("fetchAllPages", () => {
  it("reads every page, not just the first", async () => {
    const pages: Record<number, number[]> = { 1: [1, 2], 2: [3, 4], 3: [5] };
    const fetchPage = vi.fn(async (page: number) => ({ data: pages[page]!, meta: { page, pageSize: 2, total: 5, totalPages: 3 } }));
    await expect(fetchAllPages(fetchPage)).resolves.toEqual([1, 2, 3, 4, 5]);
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it("refuses unbounded exports", async () => {
    const fetchPage = vi.fn(async (page: number) => ({ data: [page], meta: { page, pageSize: 1, total: 10, totalPages: 10 } }));
    await expect(fetchAllPages(fetchPage, 3)).rejects.toThrow(/Narrow the filters/);
  });
});
