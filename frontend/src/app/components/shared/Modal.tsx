import { useEffect, useId, type ReactNode } from "react";
import { X } from "lucide-react";

const WIDTH = { md: "max-w-md", lg: "max-w-lg", "2xl": "max-w-2xl" } as const;

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  size?: keyof typeof WIDTH;
}

/** Centred dialog: closes on the backdrop, the X button or Escape; tall content scrolls. */
export function Modal({ title, onClose, children, size = "lg" }: ModalProps) {
  const titleId = useId();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.45)" }} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`rounded-xl overflow-hidden mx-4 w-full ${WIDTH[size]}`}
        style={{ background: "#fff", boxShadow: "0 20px 60px rgba(0,0,0,0.2)", maxHeight: "90vh", overflowY: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 sticky top-0" style={{ borderBottom: "1px solid #E8E2E0", background: "#F9F6F5" }}>
          <h2 id={titleId} style={{ fontSize: "1rem", fontWeight: 700, color: "#1C1C1C" }}>{title}</h2>
          <button type="button" aria-label="Close" onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#7A6C6A" }}><X size={18} /></button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}
