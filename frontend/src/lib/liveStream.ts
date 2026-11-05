/**
 * Plays one camera in a <video> element: WebRTC first, because it is nearly
 * instant, then HLS, which also works on networks that block WebRTC.
 */

export const WEBRTC_WAIT_MS = 8_000;
const ICE_GATHER_WAIT_MS = 2_000;

export interface LivePass {
  token: string;
  whepUrl: string;
  hlsUrl: string;
}

export type StopStream = () => void;

function iceGathered(pc: RTCPeerConnection): Promise<void> {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === "complete") { resolve(); return; }
    const timer = setTimeout(resolve, ICE_GATHER_WAIT_MS);
    pc.addEventListener("icegatheringstatechange", () => {
      if (pc.iceGatheringState === "complete") { clearTimeout(timer); resolve(); }
    });
  });
}

function connected(pc: RTCPeerConnection): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), WEBRTC_WAIT_MS);
    pc.addEventListener("connectionstatechange", () => {
      if (pc.connectionState === "connected") { clearTimeout(timer); resolve(); }
      if (pc.connectionState === "failed") { clearTimeout(timer); reject(new Error("failed")); }
    });
  });
}

async function playWebRtc(video: HTMLVideoElement, pass: LivePass): Promise<StopStream> {
  const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
  try {
    pc.addTransceiver("video", { direction: "recvonly" });
    pc.ontrack = (event) => { video.srcObject = event.streams[0] ?? new MediaStream([event.track]); };
    await pc.setLocalDescription(await pc.createOffer());
    await iceGathered(pc);
    const res = await fetch(pass.whepUrl, {
      method: "POST",
      headers: { "Content-Type": "application/sdp", Authorization: `Bearer ${pass.token}` },
      body: pc.localDescription?.sdp,
    });
    if (!res.ok) throw new Error(`refused ${res.status}`);
    await pc.setRemoteDescription({ type: "answer", sdp: await res.text() });
    await connected(pc);
  } catch (err) {
    pc.close();
    throw err;
  }
  return () => {
    pc.close();
    video.srcObject = null;
  };
}

async function playHls(video: HTMLVideoElement, pass: LivePass): Promise<StopStream> {
  const { default: Hls } = await import("hls.js");
  if (!Hls.isSupported()) {
    // Safari plays HLS itself but cannot add a header, so the pass goes in the address
    video.src = `${pass.hlsUrl}?token=${encodeURIComponent(pass.token)}`;
    return () => { video.removeAttribute("src"); video.load(); };
  }
  const hls = new Hls({
    liveDurationInfinity: true,
    xhrSetup: (xhr) => { xhr.setRequestHeader("Authorization", `Bearer ${pass.token}`); },
  });
  await new Promise<void>((resolve, reject) => {
    hls.on(Hls.Events.MANIFEST_PARSED, () => resolve());
    hls.on(Hls.Events.ERROR, (_event, data) => { if (data.fatal) reject(new Error(data.details)); });
    hls.loadSource(pass.hlsUrl);
    hls.attachMedia(video);
  }).catch((err: unknown) => { hls.destroy(); throw err; });
  return () => hls.destroy();
}

export async function playLive(video: HTMLVideoElement, pass: LivePass): Promise<StopStream> {
  try {
    return await playWebRtc(video, pass);
  } catch {
    return playHls(video, pass);
  }
}
