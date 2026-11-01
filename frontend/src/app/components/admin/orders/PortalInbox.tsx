import { useCallback, useEffect, useState } from "react";
import { Card, CardHeader } from "../../shared/UI";
import { PortalMessages } from "../../shared/PortalMessages";
import { describeApiError } from "../../../../lib/api";
import { getPortalThreads, type PortalParty, type PortalThreadDto } from "../../../../lib/services/portal.service";
import type { ClientDto, SupplierDto } from "../../../../lib/services/orders.service";

/** Backend roles that answer supplier and client messages (PORTAL_STAFF_ROLES). */
export const PORTAL_STAFF_ROLES = ["ADMIN", "MANAGER", "SALES", "STORE"];

type Selected = { kind: "supplier" | "client"; id: number; name: string };

function partyOf(selected: Selected): PortalParty {
  return selected.kind === "supplier" ? { supplierId: selected.id } : { clientId: selected.id };
}

/** DVS side of the supplier and client portal conversations. */
export function PortalInbox({ suppliers, clients }: { suppliers: SupplierDto[]; clients: ClientDto[] }) {
  const [threads, setThreads] = useState<PortalThreadDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Selected | null>(null);

  const loadThreads = useCallback(async () => {
    try {
      setThreads(await getPortalThreads());
      setError(null);
    } catch (err) {
      setError(describeApiError(err, "load portal messages"));
    }
  }, []);

  useEffect(() => { void loadThreads(); }, [loadThreads]);

  const start = (value: string) => {
    const [kind, id] = value.split(":");
    const list = kind === "supplier" ? suppliers : clients;
    const match = list.find((x) => x.id === Number(id));
    if (match) setSelected({ kind: kind as Selected["kind"], id: match.id, name: match.name });
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <Card>
        <CardHeader title="Conversations" subtitle="Messages from supplier and client portals" />
        <div className="px-4 py-3" style={{ borderBottom: "1px solid #F0ECEB" }}>
          <label style={{ fontSize: "0.75rem", color: "#7A6C6A" }}>
            Start or open a conversation
            <select aria-label="Choose supplier or client" value="" onChange={(e) => start(e.target.value)}
              style={{ width: "100%", marginTop: "0.25rem", padding: "0.45rem", borderRadius: "0.5rem", border: "1px solid #E8E2E0", fontSize: "0.8125rem" }}>
              <option value="">Choose a supplier or client…</option>
              <optgroup label="Suppliers">{suppliers.map((s) => <option key={`s${s.id}`} value={`supplier:${s.id}`}>{s.name} ({s.code})</option>)}</optgroup>
              <optgroup label="Clients">{clients.map((c) => <option key={`c${c.id}`} value={`client:${c.id}`}>{c.name} ({c.code})</option>)}</optgroup>
            </select>
          </label>
        </div>
        {error && <p className="p-4" role="alert" style={{ color: "#C0392B", fontSize: "0.8rem" }}>{error}</p>}
        {!error && threads.length === 0 && <p className="p-4" style={{ color: "#9A8A88", fontSize: "0.8125rem" }}>No portal messages yet.</p>}
        {threads.map((t) => {
          const active = selected?.kind === t.kind && selected.id === t.id;
          return (
            <button key={`${t.kind}-${t.id}`} onClick={() => setSelected({ kind: t.kind, id: t.id, name: t.name })}
              className="w-full text-left px-4 py-3 flex items-start gap-3"
              style={{ borderBottom: "1px solid #F7F3F2", background: active ? "#FDF6F5" : "transparent", border: "none", cursor: "pointer" }}>
              <div className="flex-1 min-w-0">
                <p className="truncate" style={{ fontSize: "0.8375rem", fontWeight: 600 }}>{t.name}</p>
                <p style={{ fontSize: "0.7rem", color: "#9A8A88" }}>{t.kind === "supplier" ? "Supplier" : "Client"} · {t.code}</p>
                <p className="truncate" style={{ fontSize: "0.775rem", color: "#4A4A4A", marginTop: "0.2rem" }}>{t.lastFromDvs ? "You: " : ""}{t.lastMessage}</p>
              </div>
              {t.unread > 0 && <span style={{ background: "#A52A2A", color: "#fff", borderRadius: 999, fontSize: "0.68rem", fontWeight: 700, padding: "0.1rem 0.45rem" }}>{t.unread}</span>}
            </button>
          );
        })}
      </Card>
      <Card style={{ gridColumn: "span 2" }}>
        {selected ? (
          <>
            <CardHeader title={selected.name} subtitle={selected.kind === "supplier" ? "Supplier portal conversation" : "Client portal conversation"} />
            <PortalMessages key={`${selected.kind}-${selected.id}`} party={partyOf(selected)} asDvs accent="#A52A2A"
              placeholder="Reply as DVS Industries…" onMessages={() => void loadThreads()} />
          </>
        ) : (
          <p className="p-6" style={{ color: "#9A8A88", fontSize: "0.8375rem" }}>Select a conversation, or choose a supplier or client to write to.</p>
        )}
      </Card>
    </div>
  );
}
