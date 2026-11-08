/**
 * Plays one camera in a <video> element: WebRTC first, because it is nearly
 * instant, then HLS, which also works on networks that block WebRTC.
 *
 * The pass (a 2-minute token) reaches the plant's video server (MediaMTX) so:
 *   WebRTC (WHEP)  "Authorization: Bearer" on the one POST that opens the stream;
 *                  MediaMTX forwards it to /cameras/stream-auth as `token`.
 *   HLS (hls.js)   "Authorization: Bearer" on EVERY request, playlist and
 *                  segments alike (xhrSetup). MediaMTX asks the website again
 *                  for each one, so the pass is renewed before it runs out.
 *   HLS (Safari's own player, no hls.js) "?token=" in the address, which
 *                  MediaMTX forwards as `query` and copies onto segment addresses.
 */

/** The whole WebRTC attempt, offer to connection; after this HLS is tried. */
export const WEBRTC_GIVE_UP_MS = 5_000;
/** The "Test live view" button: how long each protocol gets to show a picture. */
export const TEST_VIDEO_WAIT_MS = 10_000;
/** A pass lasts 120 s; HLS asks for a new one well before. */
export const PASS_RENEW_MS = 90_000;
const ICE_GATHER_WAIT_MS = 1_500;

export interface LivePass {
  token: string;
  whepUrl: string;
  hlsUrl: string;
}

export type StopStream = () => void;
export type LiveProtocol = "webrtc" | "hls";

/** Where an attempt stopped. */
export type LiveStep = "unreachable" | "auth-refused" | "server-error" | "no-video";

export class LiveStepError extends Error {
  constructor(readonly step: LiveStep, readonly detail: string) {
    super(`${step}: ${detail}`);
  }
}

export interface PlayOptions {
  /** Called when WebRTC gave up and the slower HLS starts */
  onSlowMode?: () => void;
  /** A fresh pass for the same camera, or null if there is none any more */
  renew?: () => Promise<LivePass | null>;
}

function iceGathered(pc: RTCPeerConnection): Promise<void> {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === "complete") { resolve(); return; }
    const timer = setTimeout(resolve, ICE_GATHER_WAIT_MS);
    pc.addEventListener("icegatheringstatechange", () => {
      if (pc.iceGatheringState === "complete") { clearTimeout(timer); resolve(); }
    });
  });
}

function connected(pc: RTCPeerConnection, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (pc.connectionState === "connected") { resolve(); return; }
    const noVideo = () => reject(new LiveStepError("no-video", "WebRTC did not connect (this network may block it)"));
    if (signal.aborted) { noVideo(); return; }
    signal.addEventListener("abort", noVideo);
    pc.addEventListener("connectionstatechange", () => {
      if (pc.connectionState === "connected") resolve();
      if (pc.connectionState === "failed") noVideo();
    });
  });
}

/** Refused (401/403), another error, or fine. */
function checkAnswer(status: number): void {
  if (status === 401 || status === 403) throw new LiveStepError("auth-refused", `HTTP ${status}`);
  if (status < 200 || status >= 300) throw new LiveStepError("server-error", `HTTP ${status}`);
}

/** Opens WebRTC, or throws a LiveStepError, all within `withinMs`. */
async function startWebRtc(video: HTMLVideoElement, pass: LivePass, withinMs: number): Promise<StopStream> {
  const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), withinMs);
  try {
    pc.addTransceiver("video", { direction: "recvonly" });
    pc.ontrack = (event) => { video.srcObject = event.streams[0] ?? new MediaStream([event.track]); };
    await pc.setLocalDescription(await pc.createOffer());
    await iceGathered(pc);
    let res: Response;
    try {
      res = await fetch(pass.whepUrl, {
        method: "POST",
        headers: { "Content-Type": "application/sdp", Authorization: `Bearer ${pass.token}` },
        body: pc.localDescription?.sdp,
        signal: abort.signal,
      });
    } catch {
      throw new LiveStepError("unreachable", abort.signal.aborted ? `no answer within ${withinMs / 1000} s` : "network or CORS");
    }
    checkAnswer(res.status);
    await pc.setRemoteDescription({ type: "answer", sdp: await res.text() });
    await connected(pc, abort.signal);
  } catch (err) {
    pc.close();
    video.srcObject = null;
    throw err instanceof LiveStepError ? err : new LiveStepError("server-error", String(err));
  } finally {
    clearTimeout(timer);
  }
  return () => {
    pc.close();
    video.srcObject = null;
  };
}

interface HlsErrorData {
  type?: string;
  details?: string;
  fatal?: boolean;
  response?: { code?: number };
}

/** What a fatal hls.js error means for the viewer. */
export function hlsFailure(data: HlsErrorData): LiveStepError {
  const code = data.response?.code;
  if (code === 401 || code === 403) return new LiveStepError("auth-refused", `HTTP ${code}`);
  if (code === 0 || (code === undefined && data.type === "networkError")) {
    return new LiveStepError("unreachable", `${data.details ?? "network error"} (network or CORS)`);
  }
  if (code !== undefined) return new LiveStepError("server-error", `HTTP ${code}`);
  return new LiveStepError("server-error", data.details ?? "player error");
}

function withToken(url: string, token: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
}

/** Starts HLS, or throws a LiveStepError. The pass is renewed while it plays. */
async function startHls(video: HTMLVideoElement, pass: LivePass, options: PlayOptions, withinMs: number): Promise<StopStream> {
  const current = { pass };
  let renewing: ReturnType<typeof setInterval> | undefined;
  const keepRenewing = (onRenewed: () => void = () => {}) => {
    if (!options.renew) return;
    const renew = options.renew;
    renewing = setInterval(() => {
      renew().then((next) => { if (next) { current.pass = next; onRenewed(); } }).catch(() => {});
    }, PASS_RENEW_MS);
  };

  const { default: Hls } = await import("hls.js");
  if (!Hls.isSupported()) {
    // Safari plays HLS itself but cannot add a header, so the pass goes in the address
    video.src = withToken(current.pass.hlsUrl, current.pass.token);
    keepRenewing(() => { video.src = withToken(current.pass.hlsUrl, current.pass.token); });
    return () => {
      clearInterval(renewing);
      video.removeAttribute("src");
      video.load();
    };
  }
  const hls = new Hls({
    liveDurationInfinity: true,
    // Every request, playlist and segment, carries the newest pass
    xhrSetup: (xhr) => { xhr.setRequestHeader("Authorization", `Bearer ${current.pass.token}`); },
  });
  keepRenewing();
  const stop = () => {
    clearInterval(renewing);
    hls.destroy();
  };
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new LiveStepError("no-video", `no playlist within ${withinMs / 1000} s`)), withinMs);
    hls.on(Hls.Events.MANIFEST_PARSED, () => { clearTimeout(timer); resolve(); });
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (data.fatal) { clearTimeout(timer); reject(hlsFailure(data)); }
    });
    hls.loadSource(current.pass.hlsUrl);
    hls.attachMedia(video);
  }).catch((err: unknown) => { stop(); throw err; });
  return stop;
}

/** Resolves once the video shows a picture. */
export function waitForVideo(video: HTMLVideoElement, withinMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = setInterval(() => {
      if (video.videoWidth > 0 && video.readyState >= 2) { clearInterval(poll); resolve(); return; }
      if (Date.now() - started >= withinMs) {
        clearInterval(poll);
        reject(new LiveStepError("no-video", `no picture within ${Math.round(withinMs / 1000)} s`));
      }
    }, 200);
  });
}

export async function playLive(video: HTMLVideoElement, pass: LivePass, options: PlayOptions = {}): Promise<StopStream> {
  try {
    return await startWebRtc(video, pass, WEBRTC_GIVE_UP_MS);
  } catch {
    options.onSlowMode?.();
    return startHls(video, pass, options, 30_000);
  }
}

export type LiveTestOutcome = { result: "playing" } | { result: LiveStep; detail: string };

/** One protocol on its own, for the admin "Test live view" button. Always stops the video. */
export async function testLive(protocol: LiveProtocol, video: HTMLVideoElement, pass: LivePass): Promise<LiveTestOutcome> {
  const started = Date.now();
  let stop: StopStream | undefined;
  try {
    stop = protocol === "webrtc"
      ? await startWebRtc(video, pass, TEST_VIDEO_WAIT_MS)
      : await startHls(video, pass, {}, TEST_VIDEO_WAIT_MS);
    await waitForVideo(video, Math.max(TEST_VIDEO_WAIT_MS - (Date.now() - started), 1_000));
    return { result: "playing" };
  } catch (err) {
    if (err instanceof LiveStepError) return { result: err.step, detail: err.detail };
    return { result: "server-error", detail: String(err) };
  } finally {
    stop?.();
  }
}
