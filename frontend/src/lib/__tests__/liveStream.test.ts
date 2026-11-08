// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** A stand-in for hls.js that records its settings and lets a test fire its events. */
const hlsState = vi.hoisted(() => ({
  supported: true,
  instances: [] as Array<{
    config: { xhrSetup?: (xhr: { setRequestHeader: (k: string, v: string) => void }, url: string) => void };
    handlers: Record<string, (event: string, data: unknown) => void>;
    source: string;
    destroyed: boolean;
  }>,
  onLoad: (_i: { handlers: Record<string, (event: string, data: unknown) => void> }) => {},
}));

vi.mock("hls.js", () => {
  class FakeHls {
    static Events = { MANIFEST_PARSED: "hlsManifestParsed", ERROR: "hlsError" };
    static isSupported = () => hlsState.supported;
    config: unknown;
    handlers: Record<string, (event: string, data: unknown) => void> = {};
    source = "";
    destroyed = false;
    constructor(config: unknown) {
      this.config = config;
      hlsState.instances.push(this as never);
    }
    on(event: string, handler: (event: string, data: unknown) => void) { this.handlers[event] = handler; }
    loadSource(url: string) { this.source = url; }
    attachMedia() { hlsState.onLoad(this); }
    destroy() { this.destroyed = true; }
  }
  return { default: FakeHls };
});

import {
  PASS_RENEW_MS,
  WEBRTC_GIVE_UP_MS,
  hlsFailure,
  playLive,
  testLive,
  type LivePass,
} from "../liveStream";

const pass: LivePass = {
  token: "pass-1",
  whepUrl: "https://server.tail.ts.net/dvr-ch1-sd/whep",
  hlsUrl: "https://server.tail.ts.net:8443/dvr-ch1-sd/index.m3u8",
};

/** A peer connection that never connects, like a network that blocks WebRTC. */
class StuckPeer {
  iceGatheringState = "complete";
  connectionState = "new";
  localDescription = { sdp: "offer" };
  ontrack: unknown = null;
  closed = false;
  addTransceiver() {}
  createOffer() { return Promise.resolve({ type: "offer", sdp: "offer" }); }
  setLocalDescription() { return Promise.resolve(); }
  setRemoteDescription() { return Promise.resolve(); }
  addEventListener() {}
  close() { this.closed = true; }
}

const headersOf = (index = 0, url = "x") => {
  const set: Record<string, string> = {};
  hlsState.instances[index]!.config.xhrSetup!({ setRequestHeader: (k, v) => { set[k] = v; } }, url);
  return set;
};
const parsed = (i: { handlers: Record<string, (event: string, data: unknown) => void> }) =>
  queueMicrotask(() => i.handlers["hlsManifestParsed"]?.("hlsManifestParsed", {}));

beforeEach(() => {
  hlsState.supported = true;
  hlsState.instances = [];
  hlsState.onLoad = parsed;
  vi.stubGlobal("RTCPeerConnection", StuckPeer);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("WebRTC (WHEP)", () => {
  it("sends the pass as a Bearer token on the request that opens the stream", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    const outcome = await testLive("webrtc", document.createElement("video"), pass);
    expect(fetchMock).toHaveBeenCalledWith(pass.whepUrl, expect.objectContaining({ method: "POST" }));
    expect(fetchMock.mock.calls[0]![1].headers.Authorization).toBe("Bearer pass-1");
    expect(outcome).toEqual({ result: "auth-refused", detail: "HTTP 401" });
  });

  it("reports a server it cannot reach (network or CORS)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    expect(await testLive("webrtc", document.createElement("video"), pass)).toEqual({
      result: "unreachable",
      detail: "network or CORS",
    });
  });

  it("reports another error from the video server", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 404 })));
    expect(await testLive("webrtc", document.createElement("video"), pass)).toEqual({
      result: "server-error",
      detail: "HTTP 404",
    });
  });

  it("gives up within 5 s and plays HLS instead, saying so", async () => {
    vi.useFakeTimers();
    // The WHEP answer comes, but the connection never does
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("answer", { status: 201 })));
    const onSlowMode = vi.fn();
    const playing = playLive(document.createElement("video"), pass, { onSlowMode });
    await vi.advanceTimersByTimeAsync(WEBRTC_GIVE_UP_MS - 100);
    expect(onSlowMode).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(onSlowMode).toHaveBeenCalledTimes(1);
    const stop = await playing;
    expect(hlsState.instances).toHaveLength(1);
    expect(hlsState.instances[0]!.source).toBe(pass.hlsUrl);
    stop();
  });

  it("also gives up within 5 s when the video server never answers", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    })));
    const onSlowMode = vi.fn();
    const playing = playLive(document.createElement("video"), pass, { onSlowMode });
    await vi.advanceTimersByTimeAsync(WEBRTC_GIVE_UP_MS + 100);
    expect(onSlowMode).toHaveBeenCalledTimes(1);
    (await playing)();
  });
});

describe("HLS", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
  });

  it("puts the pass on every request, playlist and segments", async () => {
    const stop = await playLive(document.createElement("video"), pass);
    expect(headersOf(0, pass.hlsUrl)).toEqual({ Authorization: "Bearer pass-1" });
    expect(headersOf(0, "https://server.tail.ts.net:8443/dvr-ch1-sd/seg12.mp4")).toEqual({ Authorization: "Bearer pass-1" });
    stop();
  });

  it("renews the pass before it runs out, so segments keep loading after 2 minutes", async () => {
    vi.useFakeTimers();
    const renew = vi.fn().mockResolvedValue({ ...pass, token: "pass-2" });
    const playing = playLive(document.createElement("video"), pass, { renew });
    await vi.advanceTimersByTimeAsync(WEBRTC_GIVE_UP_MS + 100);
    const stop = await playing;
    expect(headersOf().Authorization).toBe("Bearer pass-1");
    await vi.advanceTimersByTimeAsync(PASS_RENEW_MS);
    expect(renew).toHaveBeenCalledTimes(1);
    expect(headersOf().Authorization).toBe("Bearer pass-2");
    stop();
    await vi.advanceTimersByTimeAsync(PASS_RENEW_MS * 2);
    expect(renew).toHaveBeenCalledTimes(1);
  });

  it("keeps the old pass if no new one is given", async () => {
    vi.useFakeTimers();
    const renew = vi.fn().mockResolvedValue(null);
    const playing = playLive(document.createElement("video"), pass, { renew });
    await vi.advanceTimersByTimeAsync(WEBRTC_GIVE_UP_MS + 100);
    const stop = await playing;
    await vi.advanceTimersByTimeAsync(PASS_RENEW_MS);
    expect(headersOf().Authorization).toBe("Bearer pass-1");
    stop();
  });

  it("puts the pass in the address for Safari's own player", async () => {
    hlsState.supported = false;
    const video = document.createElement("video");
    video.load = () => {};
    const stop = await playLive(video, pass);
    expect(video.src).toBe(`${pass.hlsUrl}?token=pass-1`);
    stop();
  });

  it("names the step where HLS stopped", () => {
    expect(hlsFailure({ type: "networkError", details: "manifestLoadError", response: { code: 401 } }).step).toBe("auth-refused");
    expect(hlsFailure({ type: "networkError", details: "manifestLoadError", response: { code: 0 } }).step).toBe("unreachable");
    expect(hlsFailure({ type: "networkError", details: "manifestLoadTimeOut" }).step).toBe("unreachable");
    expect(hlsFailure({ type: "networkError", details: "manifestLoadError", response: { code: 404 } }).step).toBe("server-error");
    expect(hlsFailure({ type: "mediaError", details: "bufferAppendError" }).step).toBe("server-error");
  });

  it("test: a refused playlist is reported as auth refused, and the player is stopped", async () => {
    hlsState.onLoad = (i) => queueMicrotask(() => i.handlers["hlsError"]?.("hlsError", {
      fatal: true, type: "networkError", details: "manifestLoadError", response: { code: 401 },
    }));
    expect(await testLive("hls", document.createElement("video"), pass)).toEqual({ result: "auth-refused", detail: "HTTP 401" });
    expect(hlsState.instances[0]!.destroyed).toBe(true);
  });

  it("test: a playlist with no picture within 10 s is 'no video'", async () => {
    vi.useFakeTimers();
    const testing = testLive("hls", document.createElement("video"), pass);
    await vi.advanceTimersByTimeAsync(11_000);
    expect(await testing).toMatchObject({ result: "no-video" });
    expect(hlsState.instances[0]!.destroyed).toBe(true);
  });

  it("test: a picture means playing", async () => {
    const video = document.createElement("video");
    Object.defineProperty(video, "videoWidth", { value: 640 });
    Object.defineProperty(video, "readyState", { value: 4 });
    expect(await testLive("hls", video, pass)).toEqual({ result: "playing" });
  });
});
