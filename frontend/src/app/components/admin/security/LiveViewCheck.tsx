import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, PlayCircle } from "lucide-react";
import { getLiveCheck, getLivePass } from "../../../../lib/services/cameras.service";
import { testLive, type LiveProtocol } from "../../../../lib/liveStream";
import {
  LIVE_RESULT_TEXT,
  STREAM_AUTH_REASON_TEXT,
  failingCameras,
  isHealthy,
  liveVerdict,
  mainPlant,
  testResultText,
  tokenRefusedText,
  versionText,
  type LiveCheck,
} from "../../../../lib/liveCheck";
import { shortAgo } from "../../../../lib/cameraStatus";

/** The panel checks again on its own (while the tab is visible), so it appears when a problem starts. */
export const LIVE_CHECK_REFRESH_MS = 60_000;

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

/**
 * Admin only, and only when live view has a problem: what is wrong in plain
 * words. Support staff (the server decides, from DIAGNOSTICS_EMAILS) also get
 * the technical details and the live test, folded away by default.
 */
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
      setError("The live view check could not be loaded. Try Refresh.");
      return null;
    }
  }, []);

  // Checks once a minute while the tab is visible; paused while it is hidden,
  // and checks straight away when it is shown again.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      if (timer === undefined) timer = setInterval(() => { void refresh(); }, LIVE_CHECK_REFRESH_MS);
    };
    const stop = () => {
      clearInterval(timer);
      timer = undefined;
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") { stop(); return; }
      void refresh();
      start();
    };
    void refresh();
    if (document.visibilityState !== "hidden") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

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
        const calls = (latest?.technical?.streamAuth ?? []).filter((c) => c.protocol === protocol && c.at >= started);
        show({ label, text: testResultText(protocol, outcome, calls), ok: outcome.result === "playing" });
      }
    } finally {
      setTesting(false);
    }
  };

  const technical = check?.technical;
  // Nothing to say when everything works; support staff keep the panel for the live test
  if (!error && (!check || (isHealthy(check) && !technical))) return null;

  const plant = check ? mainPlant(check) : null;
  const failing = check ? failingCameras(check) : [];
  return (
    <section aria-labelledby="live-check-title" className="mt-5 rounded-lg border p-4" style={{ borderColor: "#EEE4E0", background: "#FCFAF9" }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="live-check-title" style={{ color: "#302725", fontSize: "0.9rem", fontWeight: 700 }}>Live view check</h3>
        <button type="button" onClick={() => void refresh()} disabled={testing} className="flex items-center gap-1 rounded border px-2 py-1" style={{ borderColor: "#E7DEDA", background: "#fff", color: "#302725", fontSize: "0.74rem", cursor: "pointer" }}>
          <RefreshCw size={12} aria-hidden="true" /> Refresh
        </button>
      </div>

      {error && <p role="alert" className="mt-2" style={{ color: "#C0392B", fontSize: "0.78rem" }}>{error}</p>}

      {check && (
        <div className="mt-3 space-y-4" style={{ fontSize: "0.78rem" }}>
          <p data-testid="live-verdict" className="rounded-md px-3 py-2" style={{ background: "#FFF8E1", color: "#5C4600", fontWeight: 600 }}>{liveVerdict(check)}</p>

          <p data-testid="last-seen" style={{ color: "#302725" }}>
            Plant computer last seen: {plant ? when(plant.lastHeartbeatAt) : "not yet"}
          </p>

          {failing.length > 0 && (
            <div>
              <h4 style={{ color: "#302725", fontWeight: 700 }}>Cameras that cannot be watched live</h4>
              <ul className="mt-1 space-y-0.5" data-testid="failing-cameras">
                {failing.map((c) => (
                  <li key={c.id}>
                    <span style={{ fontWeight: 600 }}>{c.name}</span>{" "}
                    <span style={{ color: "#8A4B00" }}>— {LIVE_RESULT_TEXT[c.live]}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {technical && (
            <details data-testid="technical-details" className="rounded-md border px-3 py-2" style={{ borderColor: "#EEE4E0", background: "#fff" }}>
              <summary style={{ color: "#302725", fontWeight: 700, cursor: "pointer" }}>Technical details</summary>
              <div className="mt-3 space-y-4">
                <dl className="space-y-1.5">
                  <Fact label="Plant software">{plant?.technical ? versionText(plant.technical.version) : "No report yet"}</Fact>
                  <Fact label="Live address in heartbeat">
                    {!plant ? "—" : plant.technical?.liveUrl
                      ? `Yes: ${plant.technical.liveUrl}${plant.liveUrlAccepted ? "" : " (not accepted: must be https://…ts.net)"}`
                      : "No: the running software reported none"}
                  </Fact>
                  <Fact label="Plant software started">
                    {!plant?.technical ? "—" : plant.technical.startedAt ? when(plant.technical.startedAt) : "Not reported by this version"}
                    {plant?.technical?.resumedAt ? `. Heartbeats came back after a pause at ${when(plant.technical.resumedAt)}: most likely a restart.` : ""}
                  </Fact>
                  {plant?.fromDatabase && <Fact label="Last heartbeat">Read from the database after the website restarted; no heartbeat since</Fact>}
                  <Fact label="Website memory since">{when(technical.websiteStartedAt)}</Fact>
                  {plant?.technical && <Fact label="Heartbeat fields">{plant.technical.infoFields.join(", ") || "none"}</Fact>}
                </dl>

                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 style={{ color: "#302725", fontWeight: 700 }}>Test live view (camera 1, SD)</h4>
                    <button type="button" onClick={() => void runTest()} disabled={testing} className="flex items-center gap-1 rounded px-2 py-1" style={{ background: "#A52A2A", color: "#fff", fontSize: "0.74rem", fontWeight: 700, cursor: testing ? "wait" : "pointer", opacity: testing ? 0.6 : 1 }}>
                      <PlayCircle size={12} aria-hidden="true" /> {testing ? "Testing…" : "Test live view"}
                    </button>
                  </div>
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
                  {technical.streamAuth.length === 0 ? (
                    <p style={{ color: "#837572" }}>
                      None since {time(technical.websiteStartedAt)}. The plant's video server asks the website each time someone watches; none here after a test means it is not calling.
                    </p>
                  ) : (
                    <ul className="mt-1 space-y-0.5" data-testid="stream-auth-log">
                      {technical.streamAuth.map((e, i) => (
                        <li key={`${e.at}-${i}`}>
                          {time(e.at)} · {e.path || "(no path)"} · {e.protocol || e.action} ·{" "}
                          <span style={{ color: e.allowed ? "#1E7B3A" : "#B42318" }}>{STREAM_AUTH_REASON_TEXT[e.reason]}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
