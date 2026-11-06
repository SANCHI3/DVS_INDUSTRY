import { useEffect, useState } from "react";
import { Camera, CameraOff } from "lucide-react";
import { getCameraSnapshot, type CameraDto } from "../../../../lib/services/cameras.service";
import { shortAgo } from "../../../../lib/cameraStatus";

/** The latest picture of one camera, fetched with the sign-in token. */
export function CameraSnapshot({ camera }: { camera: CameraDto }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!camera.hasSnapshot) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    getCameraSnapshot(camera.id)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
        setFailed(false);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // A new picture arrives every ~2 minutes: refetch when its time changes
  }, [camera.id, camera.hasSnapshot, camera.snapshotAt]);

  const dim = camera.status !== "ONLINE";
  return (
    <div className="relative flex items-center justify-center overflow-hidden rounded-t-lg" style={{ aspectRatio: "16 / 10", background: "#1F1A19" }}>
      {url && !failed ? (
        <img src={url} alt={`Latest picture from ${camera.name}`} className="h-full w-full object-cover" style={{ opacity: dim ? 0.45 : 1 }} />
      ) : (
        <span className="flex flex-col items-center gap-1" style={{ color: "#BFB3B0", fontSize: "0.72rem" }}>
          {camera.status === "ONLINE" ? <Camera size={22} aria-hidden="true" /> : <CameraOff size={22} aria-hidden="true" />}
          {camera.hasSnapshot ? (failed ? "Picture could not be loaded" : "Loading picture…") : "No picture yet"}
        </span>
      )}
      {camera.snapshotAt && url && (
        <span className="absolute bottom-1.5 right-1.5 rounded px-1.5 py-0.5" style={{ background: "rgba(0,0,0,0.55)", color: "#fff", fontSize: "0.62rem" }}>
          Picture {shortAgo(camera.snapshotAt)}
        </span>
      )}
    </div>
  );
}
