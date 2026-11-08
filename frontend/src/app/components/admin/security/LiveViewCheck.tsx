import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, PlayCircle } from "lucide-react";
import { getLiveCheck, getLivePass } from "../../../../lib/services/cameras.service";
import { testLive, type LiveProtocol } from "../../../../lib/liveStream";
import {
  LIVE_RESULT_TEXT,
  STREAM_AUTH_REASON_TEXT,
  liveVerdict,
  mainPlant,
  testResultText,
  tokenRefusedText,
  versionText,
  type LiveCheck,
} from "../../../../lib/liveCheck";
import { shortAgo } from "../../../../lib/cameraStatus";

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
const when = (iso: string) => `${new Date(iso).toLocaleString([], { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} (${shortAgo(iso)})`;

type TestLine = { label: string; text: string; ok: boolean | null };

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <dt className="shrink-0 sm:w-48" style={{ color: "#837572" }}>{label}</dt>
      <dd style={{ color: "#302725", overflowWrap: "anywhere" }}>{children}</dd>
    </div>
  );
}

/** Admin only: where live view stops, from the website's memory, plus a live test. */
export function LiveViewCheck() {
  const [check, setCheck] = useState<LiveCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [lines, setLines] = useState<TestLine[]>([]);
  const video = useRef<HTMLVideoElement>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await getLiveCheck();
      setCheck(next);
      setError(null);
      return next;
    } catch {
      setError("The check could not be loaded. Try Refresh.");
      return null;
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const runTest = async () => {
    const camera = check?.cameras.find((c) => c.channel === 1) ?? check?.cameras[0];
    if (!camera || !video.current) {
      setLines([{ label: "Token", text: "No camera has reported yet, so there is nothing to test.", ok: false }]);
      return;
    }
    setTesting(true);
    const done: TestLine[] = [];
    const show = (line: TestLine) => { done.push(line); setLines([...done]); };
    setLines([{ label: "Token", text: `Asking for a pass for ${camera.name} (SD)…`, ok: null }]);
    try {
      done.length = 0;
      let pass;
      try {
        pass = await getLivePass(camera.id, "sd");
      } catch {
        show({ label: "Token", text: "Token refused: the website did not answer. Check your connection and try again.", ok: false });
        return;
      }
      if (!pass.available) {
        show({ label: "Token", text: tokenRefusedText(pass.reason), ok: false });
        return;
      }
      show({ label: "Token", text: `Token given for ${camera.name} (SD).`, ok: true });
      for (const protocol of ["webrtc", "hls"] as LiveProtocol[]) {
        const label = protocol === "webrtc" ? "WebRTC" : "HLS";
        setLines([...done, { label, text: `Testing ${label} (up to 10 s)…`, ok: null }]);
        const started = new Date().toISOString();
        // A pass per protocol: each test starts with a full 2 minutes
        const fresh = protocol === "webrtc" ? pass : await getLivePass(camera.id, "sd").catch(() => pass);
        const outcome = await testLive(protocol, video.current, fresh.available ? fresh : pass);
        const latest = await refresh();
        const calls = (latest?.streamAuth ?? []).filter((c) => c.protocol === protocol && c.at >= started);
        show({ label, text: testResultText(protocol, outcome, calls), ok: outcome.result === "playing" });
      }
    } finally {
      setTesting(false);
    }
  };

  const plant = check ? mainPlant(check) : null;
  return (
    <section aria-labelledby="live-check-title" className="mt-5 rounded-lg border p-4" style={{ borderColor: "#EEE4E0", background: "#FCFAF9" }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="live-check-title" style={{ color: "#302725", fontSize: "0.9rem", fontWeight: 700 }}>Live view check</h3>
        <div className="flex gap-2">
          <button type="button" onClick={() => void refresh()} disabled={testing} className="flex items-center gap-1 rounded border px-2 py-1" style={{ borderColor: "#E7DEDA", background: "#fff", color: "#302725", fontSize: "0.74rem", cursor: "pointer" }}>
            <RefreshCw size={12} aria-hidden="true" /> Refresh
          </button>
          <button type="button" onClick={() => void runTest()} disabled={testing || !check} className="flex items-center gap-1 rounded px-2 py-1" style={{ background: "#A52A2A", color: "#fff", fontSize: "0.74rem", fontWeight: 700, cursor: testing ? "wait" : "pointer", opacity: testing || !check ? 0.6 : 1 }}>
            <PlayCircle size={12} aria-hidden="true" /> {testing ? "Testing…" : "Test live view"}
          </button>
        </div>
      </div>

      {error && <p role="alert" className="mt-2" style={{ color: "#C0392B", fontSize: "0.78rem" }}>{error}</p>}
      {!check && !error && <p className="mt-2" style={{ color: "#837572", fontSize: "0.78rem" }}>Loading…</p>}

      {check && (
        <div className="mt-3 space-y-4" style={{ fontSize: "0.78rem" }}>
          <p data-testid="live-verdict" className="rounded-md px-3 py-2" style={{ background: "#FFF8E1", color: "#5C4600", fontWeight: 600 }}>{liveVerdict(check)}</p>

          <dl className="space-y-1.5">
            <Fact label="Plant software">{plant ? versionText(plant.version) : "No report yet"}</Fact>
            <Fact label="Live address in heartbeat">
              {!plant ? "—" : plant.liveUrl ? `Yes: ${plant.liveUrl}${plant.liveUrlAccepted ? "" : " (not accepted: must be https://…ts.net)"}` : "No: the running software reported none"}
            </Fact>
            <Fact label="Plant software started">
              {!plant ? "—" : plant.startedAt ? when(plant.startedAt) : "Not reported by this version"}
              {plant?.resumedAt ? `. Heartbeats came back after a pause at ${when(plant.resumedAt)}: most likely a restart.` : ""}
            </Fact>
            <Fact label="Last heartbeat">
              {!plant ? "—" : `${when(plant.lastHeartbeatAt)}${plant.fromDatabase ? ", saved before the website restarted; no heartbeat since" : ""}`}
            </Fact>
            <Fact label="Website memory since">{when(check.websiteStartedAt)}</Fact>
            {plant && <Fact label="Heartbeat fields">{plant.infoFields.join(", ") || "none"}</Fact>}
          </dl>

          <div>
            <h4 style={{ color: "#302725", fontWeight: 700 }}>Live pass for each camera</h4>
            {check.cameras.length === 0 ? (
              <p style={{ color: "#837572" }}>No camera has reported since the website started.</p>
            ) : (
              <ul className="mt-1 space-y-0.5">
                {check.cameras.map((c) => (
                  <li key={c.id}>
                    <span style={{ fontWeight: 600 }}>{c.name}</span>{" "}
                    <span style={{ color: c.live === "available" ? "#1E7B3A" : "#8A4B00" }}>— {LIVE_RESULT_TEXT[c.live]}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h4 style={{ color: "#302725", fontWeight: 700 }}>Test live view (camera 1, SD)</h4>
            <video ref={video} muted playsInline autoPlay aria-label="Live view test" className="mt-1 w-48 rounded" style={{ background: "#1F1A19", aspectRatio: "16 / 10", display: testing ? "block" : "none" }} />
            {lines.length === 0 ? (
              <p style={{ color: "#837572" }}>Asks for a pass, then tries WebRTC and HLS separately, about 25 s in all.</p>
            ) : (
              <ul className="mt-1 space-y-1" aria-live="polite">
                {lines.map((line, i) => (
                  <li key={i} style={{ color: line.ok === null ? "#837572" : line.ok ? "#1E7B3A" : "#B42318" }}>
                    <span style={{ fontWeight: 700 }}>{line.label}:</span> {line.text}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h4 style={{ color: "#302725", fontWeight: 700 }}>Last 10 calls from the plant's video server</h4>
            {check.streamAuth.length === 0 ? (
              <p style={{ color: "#837572" }}>
                None since {time(check.websiteStartedAt)}. The plant's video server asks the website each time someone watches; none here after a test means it is not calling.
              </p>
            ) : (
              <ul className="mt-1 space-y-0.5" data-testid="stream-auth-log">
                {check.streamAuth.map((e, i) => (
                  <li key={`${e.at}-${i}`}>
                    {time(e.at)} · {e.path || "(no path)"} · {e.protocol || e.action} ·{" "}
                    <span style={{ color: e.allowed ? "#1E7B3A" : "#B42318" }}>{STREAM_AUTH_REASON_TEXT[e.reason]}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
