import { useState } from "react";
import { AlertTriangle, Trash2 } from "lucide-react";
import { describeApiError, isApiError } from "../../../../lib/api";
import { deleteEmployee, type EmployeeDto } from "../../../../lib/services/employees.service";
import { fullName, removalPhrase } from "../../../../lib/workforce";
import { DialogFrame, InlineNotice, SecondaryButton } from "./formControls";

interface Props {
  employee: EmployeeDto;
  onCancel: () => void;
  /** The worker was removed (or was already gone); reload the list. */
  onRemoved: (message: string) => void;
  /** The list is out of date (worker already removed or missing); reload it. */
  onStale: () => void;
}

/**
 * Two deliberate steps before a worker is removed: check who it is, then type
 * an exact phrase. The backend still decides (administrators only); removal
 * marks the worker Terminated and keeps attendance and performance history.
 */
export function RemoveWorkerDialog({ employee, onCancel, onRemoved, onStale }: Props) {
  const [step, setStep] = useState<"check" | "type">("check");
  const [typed, setTyped] = useState("");
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = fullName(employee);
  const phrase = removalPhrase(employee);
  const matches = typed === phrase;

  async function remove() {
    if (!matches || removing) return;
    setRemoving(true);
    setError(null);
    try {
      await deleteEmployee(employee.id);
      onRemoved(`${name} (${employee.employeeCode}) was removed. Their attendance and performance history is kept.`);
    } catch (err) {
      const stale = isApiError(err) && (err.status === 404 || (err.status === 400 && /already deleted/i.test(err.message)));
      setError(stale
        ? `${name} (${employee.employeeCode}) is no longer in the active list. It may have been removed by someone else. The list will refresh when you close this dialog.`
        : describeApiError(err, `remove ${name}`));
      if (stale) onStale();
    } finally {
      setRemoving(false);
    }
  }

  const details = (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 p-3 rounded-md my-3" style={{ background: "#F9F6F5", border: "1px solid #E8E2E0", fontSize: "0.875rem" }}>
      <dt style={{ color: "#7A6C6A" }}>Name</dt><dd style={{ fontWeight: 600 }}>{name}</dd>
      <dt style={{ color: "#7A6C6A" }}>Employee ID</dt><dd style={{ fontWeight: 600, fontFamily: "JetBrains Mono, monospace" }}>{employee.employeeCode}</dd>
    </dl>
  );

  if (step === "check") {
    return (
      <DialogFrame
        width="max-w-md"
        title="Remove Worker?"
        onClose={onCancel}
        footer={
          <>
            <SecondaryButton onClick={onCancel}>Cancel</SecondaryButton>
            <button type="button" onClick={() => setStep("type")} className="px-4 py-2 rounded-md"
              style={{ background: "#A52A2A", color: "#fff", fontSize: "0.875rem", fontWeight: 600, border: "none", cursor: "pointer" }}>
              Continue
            </button>
          </>
        }
      >
        <p style={{ fontSize: "0.875rem", color: "#4A4A4A" }}>You are about to remove:</p>
        {details}
        <p style={{ fontSize: "0.8375rem", color: "#4A4A4A" }}>
          This action will remove the worker from active employee management. Please confirm that you selected the correct employee.
        </p>
      </DialogFrame>
    );
  }

  return (
    <DialogFrame
      width="max-w-lg"
      title="Confirm Worker Removal"
      onClose={removing ? () => undefined : onCancel}
      footer={
        <>
          <SecondaryButton onClick={onCancel} disabled={removing}>Cancel</SecondaryButton>
          <button type="button" onClick={() => void remove()} disabled={!matches || removing} className="flex items-center gap-1.5 px-4 py-2 rounded-md"
            style={{ background: "#C0392B", color: "#fff", fontSize: "0.875rem", fontWeight: 600, border: "none", opacity: !matches || removing ? 0.5 : 1, cursor: !matches || removing ? "not-allowed" : "pointer" }}>
            <Trash2 size={14} /> {removing ? "Removing…" : "Remove Worker"}
          </button>
        </>
      }
    >
      <div className="flex items-start gap-2 mb-1" style={{ color: "#B71C1C", fontSize: "0.8375rem" }}>
        <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
        <span>The worker is marked Terminated and removed from active lists. Attendance and performance history is kept, and an administrator can restore the record.</span>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 p-3 rounded-md my-3" style={{ background: "#F9F6F5", border: "1px solid #E8E2E0", fontSize: "0.875rem" }}>
        <dt style={{ color: "#7A6C6A" }}>Worker</dt><dd style={{ fontWeight: 600 }}>{name}</dd>
        <dt style={{ color: "#7A6C6A" }}>Employee ID</dt><dd style={{ fontWeight: 600, fontFamily: "JetBrains Mono, monospace" }}>{employee.employeeCode}</dd>
      </dl>
      <label htmlFor="remove-confirm" style={{ display: "block", fontSize: "0.8125rem", color: "#4A4A4A", marginBottom: "0.35rem" }}>
        Type the following exact text to confirm:
      </label>
      <p className="mb-2 px-3 py-2 rounded-md select-all break-words" style={{ background: "#1C1C1C", color: "#fff", fontFamily: "JetBrains Mono, monospace", fontSize: "0.8375rem" }}>{phrase}</p>
      <input
        id="remove-confirm"
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") void remove(); }}
        disabled={removing}
        autoComplete="off"
        spellCheck={false}
        aria-describedby="remove-confirm-hint"
        aria-invalid={typed !== "" && !matches}
        style={{ width: "100%", height: "2.375rem", padding: "0 0.75rem", border: `1px solid ${typed !== "" && !matches ? "#C0392B" : "#D4BFBB"}`, borderRadius: "0.375rem", fontSize: "0.875rem", fontFamily: "JetBrains Mono, monospace" }}
      />
      <p id="remove-confirm-hint" style={{ fontSize: "0.72rem", color: typed !== "" && !matches ? "#C0392B" : "#9A8A88", marginTop: "0.3rem" }}>
        {typed !== "" && !matches
          ? "The text does not match yet. Capital letters, spaces and the dash must be exactly as shown."
          : "The dash is an em dash (—). On Windows you can type it with Alt + 0151 on the number pad."}
      </p>
      {error && <div className="mt-3"><InlineNotice tone="error">{error}</InlineNotice></div>}
    </DialogFrame>
  );
}
