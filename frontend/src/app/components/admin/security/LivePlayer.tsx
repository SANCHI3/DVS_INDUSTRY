import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { getLivePass, type CameraDto, type LiveQuality } from "../../../../lib/services/cameras.service";
import { playLive } from "../../../../lib/liveStream";
import { CameraSnapshot } from "./CameraSnapshot";

type LiveState = "connecting" | "live" | "camera-offline" | "pc-offline" | "not-enabled" | "failed";

export const LIVE_STATE_TEXT: Record<LiveState, string> = {
  connecting: "Connecting…",
  live: "Live",
  "camera-offline": "Camera offline",
  "pc-offline": "Monitoring PC offline",
  "not-enabled": "Live view starts after the plant computer restarts",
  failed: "Could not start, try again",
};

const REASON_STATE = {
  "monitoring-offline": "pc-offline",
  "camera-offline": "camera-offline",
  "not-enabled": "not-enabled",
} as const;

/** Live video for one tile. The video runs only while this is on screen. */
export function LivePlayer({ camera, onClose }: { camera: CameraDto; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [quality, setQuality] = useState<LiveQuality>("sd");
  const [state, setState] = useState<LiveState>("connecting");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let stop: (() => void) | undefined;
    setState("connecting");
    (async () => {
      const pass = await getLivePass(camera.id, quality);
      if (cancelled) return;
      if (!pass.available) { setState(REASON_STATE[pass.reason]); return; }
      if (!video.current) return;
      const stopStream = await playLive(video.current, pass);
      if (cancelled) { stopStream(); return; }
      stop = stopStream;
      setState("live");
    })().catch(() => { if (!cancelled) setState("failed"); });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [camera.id, quality, attempt]);

  return (
    <div className="relative overflow-hidden rounded-t-lg" style={{ aspectRatio: "16 / 10", background: "#1F1A19" }}>
      <video ref={video} autoPlay muted playsInline aria-label={`Live video from ${camera.name}`} className="h-full w-full object-contain" />
      {state !== "live" && (
        <>
          {/* Until the video runs, or if it cannot, the latest picture stays on screen */}
          <div className="absolute inset-0"><CameraSnapshot camera={camera} /></div>
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-3 text-center">
            <span role="status" className="rounded px-2 py-1" style={{ background: "rgba(0,0,0,0.6)", color: "#fff", fontSize: "0.78rem" }}>
              {LIVE_STATE_TEXT[state]}
            </span>
            {state === "failed" && (
              <button type="button" onClick={() => setAttempt(attempt + 1)} className="rounded px-2 py-0.5" style={{ background: "#fff", color: "#302725", fontSize: "0.7rem", fontWeight: 700, cursor: "pointer" }}>
                Try again
              </button>
            )}
          </div>
        </>
      )}
      <div className="absolute left-1.5 top-1.5 flex items-center gap-1">
        {state === "live" && (
          <span className="rounded px-1.5 py-0.5" style={{ background: "#B42318", color: "#fff", fontSize: "0.62rem", fontWeight: 700 }}>Live</span>
        )}
        <div className="flex overflow-hidden rounded" role="group" aria-label="Video quality">
          {(["sd", "hd"] as const).map((q) => (
            <button
              key={q}
              type="button"
              aria-pressed={quality === q}
              onClick={() => setQuality(q)}
              className="px-1.5 py-0.5"
              style={{ background: quality === q ? "#fff" : "rgba(0,0,0,0.55)", color: quality === q ? "#302725" : "#fff", fontSize: "0.62rem", fontWeight: 700, cursor: "pointer" }}
            >
              {q.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label={`Stop live video from ${camera.name}`}
        className="absolute right-1.5 top-1.5 rounded p-0.5"
        style={{ background: "rgba(0,0,0,0.55)", color: "#fff", cursor: "pointer" }}
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
