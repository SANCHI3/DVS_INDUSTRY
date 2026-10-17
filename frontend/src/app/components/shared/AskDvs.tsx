import { useEffect, useRef, useState } from "react";
import { Loader2, MessageCircleQuestion, Send, X } from "lucide-react";
import { isApiError } from "../../../lib/api";
import { askAssistant, getAssistantStatus } from "../../../lib/services/assistant.service";

/** Example questions per backend role; they match the data each role may see. */
const EXAMPLES: Record<string, string[]> = {
  ADMIN: ["Which suppliers are late?", "Any open safety incidents?", "How many units did we produce this week?", "How is the plant doing overall?"],
  MANAGER: ["Which suppliers are late?", "Any open safety incidents?", "How many units did we produce this week?", "How is the plant doing overall?"],
  STORE: ["Which materials will run out this week?", "Which materials are low on stock?", "Which purchase orders are late?"],
  PRODUCTION: ["How many units did we produce today?", "Which work orders are overdue?", "Any open safety incidents?"],
  HR: ["How many people are absent today?", "How many workers came late today?", "How many units did we produce today?"],
  SALES: ["Which customer orders are late?", "Which purchase orders are late?", "Which materials are low on stock?"],
};

export function exampleQuestions(backendRole: string): string[] {
  return EXAMPLES[backendRole.toUpperCase()] ?? EXAMPLES.STORE;
}

type Message =
  | { from: "user"; text: string }
  | { from: "assistant"; text: string; sources: string[] }
  | { from: "error"; text: string };

type Status = "checking" | "ready" | "not-configured";

function errorText(error: unknown): string {
  if (isApiError(error)) {
    if (error.code === "ASSISTANT_NOT_CONFIGURED") return "Assistant not configured. Ask an administrator to add the assistant key.";
    if (error.status === 0) return "Could not reach the server. Check your connection and try again.";
    if (error.message) return error.message;
  }
  return "Something went wrong. Please try again.";
}

const MAX_LENGTH = 500;

export function AskDvs({ backendRole }: { backendRole: string }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>("checking");
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [asking, setAsking] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open || status !== "checking") return;
    getAssistantStatus()
      .then((s) => setStatus(s.configured ? "ready" : "not-configured"))
      .catch(() => setStatus("ready")); // let a question surface the real error
  }, [open, status]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open, status]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, asking]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const ask = async (question: string) => {
    const text = question.trim();
    if (!text || asking) return;
    setDraft("");
    setMessages((current) => [...current, { from: "user", text }]);
    setAsking(true);
    try {
      const result = await askAssistant(text);
      setMessages((current) => [...current, { from: "assistant", text: result.answer, sources: result.sources }]);
    } catch (error) {
      if (isApiError(error) && error.code === "ASSISTANT_NOT_CONFIGURED") setStatus("not-configured");
      setMessages((current) => [...current, { from: "error", text: errorText(error) }]);
    } finally {
      setAsking(false);
    }
  };

  const examples = exampleQuestions(backendRole);

  return (
    <>
      <button
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="ask-dvs-panel"
        className="flex items-center gap-2 px-3 py-1.5 rounded-md transition-colors"
        style={{ background: open ? "#A52A2A" : "#F5F0EF", color: open ? "#fff" : "#4E342E", border: "none", cursor: "pointer", fontSize: "0.8rem", fontWeight: 600 }}
      >
        <MessageCircleQuestion size={16} />
        <span className="hidden sm:inline">Ask DVS</span>
      </button>

      {open && (
        <aside
          id="ask-dvs-panel"
          role="dialog"
          aria-label="Ask DVS"
          className="fixed right-0 top-0 z-50 flex h-full flex-col"
          style={{ width: "min(420px, 100vw)", background: "#FFFFFF", borderLeft: "1px solid #E8E2E0", boxShadow: "-8px 0 32px rgba(0,0,0,0.12)" }}
        >
          <header className="flex items-start justify-between gap-3 px-5 py-4" style={{ borderBottom: "1px solid #F0ECEB" }}>
            <div>
              <h2 className="flex items-center gap-2" style={{ fontSize: "0.95rem", fontWeight: 700, color: "#1C1C1C" }}>
                <MessageCircleQuestion size={17} color="#A52A2A" /> Ask DVS
              </h2>
              <p style={{ fontSize: "0.75rem", color: "#7A6C6A", marginTop: "0.15rem" }}>Ask about stock, orders, production and more. Answers use live factory data only.</p>
            </div>
            <button onClick={() => setOpen(false)} aria-label="Close Ask DVS" style={{ background: "none", border: "none", cursor: "pointer", color: "#9A8A88", display: "flex", padding: "0.25rem" }}>
              <X size={18} />
            </button>
          </header>

          <div ref={listRef} className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-3" aria-live="polite">
            {status === "not-configured" ? (
              <div className="rounded-lg p-4" style={{ background: "#FFF8E1", border: "1px solid #FFE082" }}>
                <p style={{ fontSize: "0.85rem", fontWeight: 600, color: "#8A6D00" }}>Assistant not configured</p>
                <p style={{ fontSize: "0.775rem", color: "#7A6C6A", marginTop: "0.25rem", lineHeight: 1.5 }}>An administrator needs to add the assistant key on the server. Everything else in the system works as usual.</p>
              </div>
            ) : status === "checking" ? (
              <p style={{ fontSize: "0.8rem", color: "#7A6C6A" }}>Starting the assistant...</p>
            ) : (
              <>
                {messages.length === 0 && (
                  <div>
                    <p style={{ fontSize: "0.78rem", color: "#7A6C6A", marginBottom: "0.5rem" }}>Try one of these:</p>
                    <div className="flex flex-wrap gap-2">
                      {examples.map((question) => (
                        <button
                          key={question}
                          onClick={() => ask(question)}
                          className="rounded-full px-3 py-1.5 text-left"
                          style={{ background: "#FBF8F7", border: "1px solid #E7DEDA", color: "#4E342E", fontSize: "0.775rem", cursor: "pointer" }}
                        >
                          {question}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {messages.map((message, index) =>
                  message.from === "user" ? (
                    <div key={index} className="self-end rounded-lg px-3 py-2" style={{ maxWidth: "85%", background: "#A52A2A", color: "#fff", fontSize: "0.825rem", lineHeight: 1.5 }}>
                      {message.text}
                    </div>
                  ) : message.from === "assistant" ? (
                    <div key={index} className="self-start rounded-lg px-3 py-2" style={{ maxWidth: "90%", background: "#F5F0EF", color: "#1C1C1C", fontSize: "0.825rem", lineHeight: 1.55 }}>
                      <p style={{ whiteSpace: "pre-wrap" }}>{message.text}</p>
                      {message.sources.length > 0 && (
                        <p style={{ marginTop: "0.35rem", fontSize: "0.7rem", color: "#7A6C6A" }}>Based on: {message.sources.join(", ")}</p>
                      )}
                    </div>
                  ) : (
                    <div key={index} role="alert" className="self-start rounded-lg px-3 py-2" style={{ maxWidth: "90%", background: "#FFEBEE", color: "#C0392B", fontSize: "0.8rem", lineHeight: 1.5 }}>
                      {message.text}
                    </div>
                  ),
                )}
                {asking && (
                  <div className="self-start flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: "#F5F0EF", color: "#7A6C6A", fontSize: "0.8rem" }}>
                    <Loader2 size={14} className="animate-spin" /> Looking that up...
                  </div>
                )}
              </>
            )}
          </div>

          {status !== "not-configured" && (
            <form
              className="flex items-end gap-2 px-4 py-3"
              style={{ borderTop: "1px solid #F0ECEB" }}
              onSubmit={(event) => { event.preventDefault(); void ask(draft); }}
            >
              <textarea
                ref={inputRef}
                value={draft}
                onChange={(event) => setDraft(event.target.value.slice(0, MAX_LENGTH))}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void ask(draft); }
                }}
                rows={2}
                placeholder="Type your question..."
                aria-label="Your question"
                disabled={status === "checking"}
                className="flex-1 resize-none rounded-md px-3 py-2"
                style={{ border: "1px solid #D4BFBB", fontSize: "0.825rem", color: "#1C1C1C", background: "#FAFAFA", outline: "none" }}
              />
              <button
                type="submit"
                disabled={!draft.trim() || asking || status === "checking"}
                aria-label="Send question"
                className="flex items-center justify-center rounded-md"
                style={{ width: 38, height: 38, background: "#A52A2A", color: "#fff", border: "none", cursor: !draft.trim() || asking ? "not-allowed" : "pointer", opacity: !draft.trim() || asking ? 0.5 : 1 }}
              >
                <Send size={15} />
              </button>
            </form>
          )}
        </aside>
      )}
    </>
  );
}
