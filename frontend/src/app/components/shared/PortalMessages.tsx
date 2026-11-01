import { useCallback, useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { Btn } from "./UI";
import { describeApiError } from "../../../lib/api";
import {
  getPortalMessages, markPortalMessagesRead, sendPortalMessage,
  type PortalMessageDto, type PortalParty,
} from "../../../lib/services/portal.service";

/** New messages are picked up this often while the conversation is open. */
const POLL_MS = 30_000;

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

/**
 * One conversation between DVS and a supplier or client. Portal accounts
 * leave `party` out (the server uses their own company); DVS staff name it.
 * `asDvs` says which side the viewer is on, so their own messages sit right.
 */
export function PortalMessages({ party = {}, asDvs, accent, placeholder, onMessages }: {
  party?: PortalParty;
  asDvs: boolean;
  accent: string;
  placeholder?: string;
  /** Receives the conversation after every load (e.g. for a dashboard preview). */
  onMessages?: (messages: PortalMessageDto[]) => void;
}) {
  const [messages, setMessages] = useState<PortalMessageDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const partyKey = JSON.stringify(party);
  const onMessagesRef = useRef(onMessages);
  onMessagesRef.current = onMessages;

  const load = useCallback(async () => {
    const current = JSON.parse(partyKey) as PortalParty;
    try {
      const list = await getPortalMessages(current);
      setMessages(list);
      setError(null);
      onMessagesRef.current?.(list);
      const otherSideUnread = list.some((m) => m.fromDvs !== asDvs && m.readAt === null);
      if (otherSideUnread) await markPortalMessagesRead(current);
    } catch (err) {
      setError(describeApiError(err, "load messages"));
    } finally {
      setLoading(false);
    }
  }, [partyKey, asDvs]);

  useEffect(() => {
    setLoading(true);
    setMessages([]);
    void load();
    const timer = setInterval(() => { if (document.visibilityState === "visible") void load(); }, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => { bottomRef.current?.scrollIntoView?.({ block: "end" }); }, [messages.length]);

  const send = async () => {
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    try {
      const sent = await sendPortalMessage(body, JSON.parse(partyKey) as PortalParty);
      const next = [...messages, sent];
      setMessages(next);
      onMessagesRef.current?.(next);
      setDraft("");
      setError(null);
    } catch (err) {
      setError(describeApiError(err, "send the message"));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col" style={{ minHeight: 360 }}>
      <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-3" style={{ maxHeight: 460 }} aria-live="polite">
        {loading && <p style={{ color: "#9A8A88", fontSize: "0.8375rem" }}>Loading messages…</p>}
        {!loading && messages.length === 0 && !error && (
          <p style={{ color: "#9A8A88", fontSize: "0.8375rem" }}>No messages yet. Write the first one below.</p>
        )}
        {messages.map((m) => {
          const mine = m.fromDvs === asDvs;
          return (
            <div key={m.id} className="flex flex-col" style={{ alignItems: mine ? "flex-end" : "flex-start" }}>
              <div style={{
                maxWidth: "80%", padding: "0.6rem 0.85rem", borderRadius: "0.75rem", whiteSpace: "pre-wrap",
                fontSize: "0.8375rem", lineHeight: 1.5, wordBreak: "break-word",
                background: mine ? accent : "#F5F0EF", color: mine ? "#fff" : "#1C1C1C",
              }}>
                {m.body}
              </div>
              <span style={{ fontSize: "0.68rem", color: "#9A8A88", marginTop: "0.2rem" }}>
                {m.senderName} · {formatTime(m.createdAt)}
              </span>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
      {error && <p className="px-5 pb-2" role="alert" style={{ color: "#C0392B", fontSize: "0.8rem" }}>{error}</p>}
      <div className="flex gap-2 p-4" style={{ borderTop: "1px solid #F0ECEB" }}>
        <textarea
          aria-label="Message"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
          placeholder={placeholder ?? "Write a message…"}
          rows={2}
          maxLength={4000}
          className="flex-1"
          style={{ resize: "vertical", padding: "0.5rem 0.75rem", borderRadius: "0.5rem", border: "1px solid #E8E2E0", fontSize: "0.8375rem" }}
        />
        <Btn onClick={() => void send()} disabled={sending || draft.trim() === ""}>
          <Send size={14} /> {sending ? "Sending…" : "Send"}
        </Btn>
      </div>
    </div>
  );
}
