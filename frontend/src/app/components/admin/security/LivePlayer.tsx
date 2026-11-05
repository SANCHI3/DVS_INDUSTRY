import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { getLivePass, type CameraDto, type LiveQuality } from "../../../../lib/services/cameras.service";
import { playLive } from "../../../../lib/liveStream";

type LiveState = "connecting" | "live" | "camera-offline" | "pc-offline" | "not-enabled" | "failed";

export const LIVE_STATE_TEXT: Record<LiveState, string> = {
  connecting: "Connecting…",
  live: "Live",
  "camera-offline": "Camera offline",
  "pc-offline": "Monitoring PC offline",
  "not-enabled": "Live view is not switched on yet",
  failed: "Could not start the video. Try again.",
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
  }, [camera.id, quality]);

  return (
    <div className="relative overflow-hidden rounded-t-lg" style={{ aspectRatio: "16 / 10", background: "#1F1A19" }}>
      <video ref={video} autoPlay muted playsInline aria-label={`Live video from ${camera.name}`} className="h-full w-full object-contain" />
      {state !== "live" && (
        <span role="status" className="absolute inset-0 flex items-center justify-center px-3 text-center" style={{ color: "#fff", fontSize: "0.78rem" }}>
          {LIVE_STATE_TEXT[state]}
        </span>
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
