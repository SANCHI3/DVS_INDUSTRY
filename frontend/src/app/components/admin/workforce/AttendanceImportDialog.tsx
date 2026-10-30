import { useRef, useState } from "react";
import { FileSpreadsheet, RefreshCw, Upload } from "lucide-react";
import { describeApiError, isApiError } from "../../../../lib/api";
import {
  importAttendanceSheet, previewAttendanceImport, type AttendanceImportReport, type AttendanceImportResult,
} from "../../../../lib/services/workforce.service";
import { attendanceStatusInfo, formatDay, localIsoDate } from "../../../../lib/workforce";
import { DialogFrame, InlineNotice, LoadingLine, PrimaryButton, SecondaryButton, inputStyle } from "./formControls";
import { RegisterSheetEmployeesPanel } from "./RegisterSheetEmployeesPanel";

export const MAX_SHEET_BYTES = 5 * 1024 * 1024;

/** Quick checks before upload. The server repeats them and checks the contents. */
export function checkSheetFile(file: File): string | null {
  if (!/\.(xlsx|xls)$/i.test(file.name)) return `"${file.name}" is not an Excel workbook. Choose a .xlsx or .xls file.`;
  if (file.size === 0) return `"${file.name}" is empty.`;
  if (file.size > MAX_SHEET_BYTES) return `"${file.name}" is larger than 5 MB. Split it into smaller files.`;
  return null;
}

const RESULT: Record<AttendanceImportResult, { label: string; color: string; bg: string }> = {
  VALID: { label: "Ready", color: "#2E7D32", bg: "#E8F5E9" },
  EXISTING: { label: "Already recorded", color: "#1565C0", bg: "#E3F2FD" },
  DUPLICATE: { label: "Duplicate in file", color: "#6A1B9A", bg: "#F3E5F5" },
  REJECTED: { label: "Rejected", color: "#C0392B", bg: "#FFEBEE" },
};
const IMPORTED = { label: "Imported", color: "#2E7D32", bg: "#E8F5E9" };

type Phase = "choose" | "checking" | "preview" | "register" | "importing" | "done";

interface Props {
  defaultDate: string;
  onClose: () => void;
  /** Records were saved: reload the page from the database */
  onImported: (message: string, date: string) => void;
}

/**
 * Upload Excel → server preview → confirm → server re-checks and imports the
 * valid rows only → final summary. Existing attendance is never overwritten.
 */
export function AttendanceImportDialog({ defaultDate, onClose, onImported }: Props) {
  const today = localIsoDate();
  const [date, setDate] = useState(defaultDate);
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>("choose");
  const [report, setReport] = useState<AttendanceImportReport | null>(null);
  const [error, setError] = useState<{ message: string; retry: (() => void) | null; useDate?: string } | null>(null);
  const [problemsOnly, setProblemsOnly] = useState(false);
  const [registered, setRegistered] = useState<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const busy = phase === "checking" || phase === "importing";

  async function check(f: File, d: string) {
    setError(null);
    setReport(null);
    setRegistered(null);
    const problem = checkSheetFile(f);
    if (problem) { setPhase("choose"); setError({ message: problem, retry: null }); return; }
    if (d === "" || d > today) { setPhase("choose"); setError({ message: "Select an attendance date that is not in the future.", retry: null }); return; }
    setPhase("checking");
    try {
      const r = await previewAttendanceImport(f, d);
      setReport(r);
      setProblemsOnly(false);
      setPhase("preview");
    } catch (err) {
      setPhase("choose");
      if (isApiError(err) && err.code === "SHEET_DATE_MISMATCH") {
        // The file is for another day: offer that day instead of guessing
        setError({ message: err.message, retry: null, useDate: /\((\d{4}-\d{2}-\d{2})\)/.exec(err.message)?.[1] });
      } else {
        setError({ message: describeApiError(err, "check the attendance sheet"), retry: () => void check(f, d) });
      }
    }
  }

  async function runImport() {
    if (!file || !report || report.summary.valid === 0 || busy) return;
    setError(null);
    setPhase("importing");
    try {
      const r = await importAttendanceSheet(file, date);
      setReport(r);
      setProblemsOnly(false);
      setPhase("done");
      const n = r.imported ?? 0;
      onImported(`Imported ${n} attendance record${n === 1 ? "" : "s"} for ${formatDay(date)}.`, date);
    } catch (err) {
      // Safe to retry: the import only inserts, so nothing is saved twice
      setPhase("preview");
      setError({ message: describeApiError(err, "import the attendance sheet"), retry: () => void runImport() });
    }
  }

  function pickFile(f: File | undefined) {
    if (!f) return;
    setFile(f);
    void check(f, date);
  }

  function changeDate(d: string) {
    setDate(d);
    if (file && phase !== "done") void check(file, d);
  }

  const s = report?.summary;
  const done = phase === "done";
  const rows = (report?.rows ?? []).filter((r) => !problemsOnly || r.result !== "VALID");
  const hasTimes = (report?.rows ?? []).some((r) => r.clockIn || r.clockOut || r.overtime);
  const hasShift = (report?.rows ?? []).some((r) => r.sourceShift);
  const unregistered = report?.unregistered ?? [];

  const footer = (
    <>
      {error?.retry && !busy && (
        <SecondaryButton onClick={error.retry}><RefreshCw size={13} /> Retry</SecondaryButton>
      )}
      {done ? (
        <PrimaryButton onClick={onClose}>Done</PrimaryButton>
      ) : phase === "register" ? null : (
        <>
          <SecondaryButton onClick={onClose} disabled={phase === "importing"}>Cancel</SecondaryButton>
          {(phase === "preview" || phase === "importing") && (
            <SecondaryButton onClick={() => fileInput.current?.click()} disabled={busy}>Choose another file</SecondaryButton>
          )}
          {(phase === "preview" || phase === "importing") && (
            <PrimaryButton onClick={() => void runImport()} disabled={busy || !s || s.valid === 0}>
              <Upload size={14} />
              {phase === "importing" ? "Importing…" : s && s.valid > 0 ? `Confirm import of ${s.valid} record${s.valid === 1 ? "" : "s"}` : "Nothing to import"}
            </PrimaryButton>
          )}
        </>
      )}
    </>
  );

  return (
    <DialogFrame
      title={done ? "Attendance Import Summary" : "Upload Attendance from Excel"}
      subtitle={done ? `${report?.fileName} · ${formatDay(date)}` : phase === "register" ? `${file?.name ?? ""} · ${formatDay(date)} · review new employees` : "Rows are checked first. Nothing is saved until you confirm."}
      onClose={phase === "importing" ? () => undefined : onClose}
      footer={footer}
      width="max-w-5xl"
    >
      {!done && phase !== "register" && (
        <div className="flex flex-wrap items-end gap-4 mb-4">
          <label style={{ fontSize: "0.8125rem", color: "#4A4A4A", fontWeight: 600 }}>
            Attendance date
            <input type="date" value={date} max={today} disabled={busy} onChange={(e) => changeDate(e.target.value)}
              style={{ ...inputStyle, display: "block", marginTop: 4, width: "11rem" }} />
          </label>
          <div className="flex-1 min-w-[14rem]">
            <span style={{ display: "block", fontSize: "0.8125rem", color: "#4A4A4A", fontWeight: 600, marginBottom: 4 }}>Excel file</span>
            <div className="flex items-center gap-3">
              <SecondaryButton onClick={() => fileInput.current?.click()} disabled={busy}>
                <FileSpreadsheet size={14} /> {file ? "Choose another file" : "Choose Excel file"}
              </SecondaryButton>
              <span style={{ fontSize: "0.8rem", color: file ? "#1C1C1C" : "#9A8A88" }} className="truncate">
                {file ? file.name : "No file chosen (.xlsx or .xls, up to 5 MB)"}
              </span>
            </div>
            <input
              ref={fileInput}
              type="file"
              aria-label="Excel attendance file"
              accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              className="hidden"
              onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ""; }}
            />
          </div>
        </div>
      )}

      {phase === "choose" && !error && (
        <div className="p-4 rounded-md" style={{ background: "#F9F6F5", border: "1px solid #E8E2E0", fontSize: "0.8125rem", color: "#4A4A4A" }}>
          <p style={{ marginBottom: 6 }}>
            The attendance machine's <b>Daily Attendance</b> report and <b>Monthly Status</b> report can be uploaded as exported
            (a monthly report imports the selected day). Other sheets need these headings:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li><b>Employee ID</b> (required) — also read as E. Code, Employee Code, Emp ID, Emp Code or Emp No. Rows are matched by this ID only.</li>
            <li><b>Attendance Status</b> (required) — also read as Status, Attendance or Mark. <b>P</b> = Present, <b>A</b> = Absent, <b>WO</b> = Week Off, <b>HD</b> = Half day, Late, Leave.</li>
            <li><b>Employee Name</b> (optional) — when filled in, it must match the employee with that ID.</li>
            <li><b>Date</b> (optional) — blank means the date selected above; any other date is rejected.</li>
            <li><b>In Time</b>, <b>Out Time</b>, <b>OT</b> (optional) — saved as check-in, check-out and hours worked. Overtime is saved in the remarks, because attendance has no overtime field.</li>
          </ul>
          <p className="mt-2" style={{ color: "#7A6C6A" }}>
            Employees are never created automatically: an Employee ID that is not registered is listed for you to review, complete
            and register explicitly. Existing attendance is never overwritten. Missing punches and OT marks without hours are held back with a reason.
          </p>
        </div>
      )}

      {error && (
        <div className="mb-4 space-y-2">
          <InlineNotice tone={error.useDate ? "warning" : "error"}>{error.message}</InlineNotice>
          {error.useDate && (
            <SecondaryButton onClick={() => changeDate(error.useDate!)}>Use {formatDay(error.useDate)}</SecondaryButton>
          )}
        </div>
      )}

      {phase === "checking" && <LoadingLine text={`Checking ${file?.name ?? "the file"}…`} />}

      {phase === "register" && file && report && (
        <RegisterSheetEmployeesPanel
          file={file}
          date={date}
          employees={unregistered}
          onCancel={() => setPhase("preview")}
          onRegistered={(r, n) => { setReport(r); setRegistered(n); setProblemsOnly(false); setPhase("preview"); }}
        />
      )}

      {report && s && phase !== "checking" && phase !== "register" && (
        <>
          {registered !== null && !done && (
            <div className="mb-4">
              <InlineNotice tone="info">
                {registered} employee{registered === 1 ? " was" : "s were"} registered in Workforce Management. No attendance has been
                saved yet: review the rows below, then confirm the import.
              </InlineNotice>
            </div>
          )}
          {unregistered.length > 0 && !done && (
            <div className="mb-4 space-y-2">
              <InlineNotice tone="warning">
                {unregistered.length} Employee ID{unregistered.length === 1 ? " in this sheet is" : "s in this sheet are"} not registered in
                Workforce Management ({unregistered.map((u) => u.employeeCode).join(", ")}). Their rows cannot be imported until the
                employees are registered.
              </InlineNotice>
              <SecondaryButton onClick={() => { setError(null); setPhase("register"); }} disabled={busy}>
                Review {unregistered.length} new employee{unregistered.length === 1 ? "" : "s"}
              </SecondaryButton>
            </div>
          )}
          {done && (
            <div className="mb-4">
              <InlineNotice tone={report.imported ? "info" : "warning"}>
                {report.imported
                  ? `${report.imported} attendance record${report.imported === 1 ? " was" : "s were"} saved for ${formatDay(date)}. The attendance page now shows the saved records.`
                  : "No records were saved."}
              </InlineNotice>
            </div>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4" aria-label="Import summary">
            {[
              { label: done ? "Imported" : "Ready to import", value: s.valid, style: RESULT.VALID },
              { label: "Skipped (already recorded)", value: s.existing, style: RESULT.EXISTING },
              { label: "Duplicate rows", value: s.duplicate, style: RESULT.DUPLICATE },
              { label: "Rejected", value: s.rejected, style: RESULT.REJECTED },
            ].map((c) => (
              <div key={c.label} className="p-3 rounded-md" style={{ background: c.style.bg }}>
                <p style={{ fontSize: "1.25rem", fontWeight: 700, color: c.style.color }}>{c.value}</p>
                <p style={{ fontSize: "0.72rem", color: "#4A4A4A" }}>{c.label}</p>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <p style={{ fontSize: "0.75rem", color: "#7A6C6A" }}>
              Sheet "{report.sheetName}" · {s.totalRows} row{s.totalRows === 1 ? "" : "s"}{s.blankRows > 0 ? ` · ${s.blankRows} blank row${s.blankRows === 1 ? "" : "s"} ignored` : ""}
            </p>
            <label className="flex items-center gap-2" style={{ fontSize: "0.78rem", color: "#4A4A4A" }}>
              <input type="checkbox" checked={problemsOnly} onChange={(e) => setProblemsOnly(e.target.checked)} />
              {done ? "Show only rows that were not imported" : "Show only rows that will not be imported"}
            </label>
          </div>
          <div className="overflow-x-auto rounded-md" style={{ border: "1px solid #E8E2E0" }}>
            <table className="w-full" style={{ fontSize: "0.8rem", borderCollapse: "collapse" }}>
              <thead style={{ background: "#F9F6F5", textAlign: "left" }}>
                <tr>
                  {["Row", "Employee ID", "Employee name", ...(hasShift ? ["Shift"] : []), "Date", "Status", ...(hasTimes ? ["In", "Out", "OT"] : []), "Result"].map((h) => (
                    <th key={h} className="px-3 py-2" style={{ fontWeight: 600, color: "#4A4A4A", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={(hasTimes ? 9 : 6) + (hasShift ? 1 : 0)} className="px-3 py-4 text-center" style={{ color: "#7A6C6A" }}>Every row is ready to import.</td></tr>
                ) : rows.map((r) => {
                  const res = done && r.result === "VALID" ? IMPORTED : RESULT[r.result];
                  const st = r.status ? attendanceStatusInfo(r.status) : null;
                  return (
                    <tr key={r.row} style={{ borderTop: "1px solid #F0ECEB", verticalAlign: "top" }}>
                      <td className="px-3 py-2" style={{ color: "#9A8A88" }}>{r.row}</td>
                      <td className="px-3 py-2" style={{ fontFamily: "JetBrains Mono, monospace", whiteSpace: "nowrap" }}>{r.employeeCode || <span style={{ color: "#B0A3A1" }}>—</span>}</td>
                      <td className="px-3 py-2">
                        {r.employeeName || <span style={{ color: "#B0A3A1" }}>—</span>}
                        {r.sourceName && r.sourceName !== r.employeeName && (
                          <p style={{ fontSize: "0.72rem", color: "#7A6C6A", marginTop: 2 }}>In sheet: {r.sourceName}</p>
                        )}
                      </td>
                      {hasShift && <td className="px-3 py-2" style={{ fontFamily: "JetBrains Mono, monospace" }}>{r.sourceShift || <span style={{ color: "#B0A3A1" }}>—</span>}</td>}
                      <td className="px-3 py-2" style={{ whiteSpace: "nowrap" }}>{r.date ? formatDay(r.date) : <span style={{ color: "#B0A3A1" }}>Invalid</span>}</td>
                      <td className="px-3 py-2" style={{ whiteSpace: "nowrap" }}>
                        {st ? (
                          <span className="inline-flex px-2 py-0.5 rounded-full" style={{ background: st.bg, color: st.color, fontWeight: 600, fontSize: "0.72rem" }}>{st.label}</span>
                        ) : (
                          <span style={{ color: "#7A6C6A" }}>{r.rawStatus || "—"}</span>
                        )}
                      </td>
                      {hasTimes && (["clockIn", "clockOut", "overtime"] as const).map((k) => (
                        <td key={k} className="px-3 py-2" style={{ fontFamily: "JetBrains Mono, monospace", whiteSpace: "nowrap" }}>{r[k] ?? <span style={{ color: "#B0A3A1" }}>—</span>}</td>
                      ))}
                      <td className="px-3 py-2" style={{ minWidth: "14rem" }}>
                        <span className="inline-flex px-2 py-0.5 rounded-full" style={{ background: res.bg, color: res.color, fontWeight: 600, fontSize: "0.72rem" }}>{res.label}</span>
                        {r.reason && <p style={{ fontSize: "0.75rem", color: "#4A4A4A", marginTop: 3 }}>{r.reason}</p>}
                        {r.note && r.result === "VALID" && <p style={{ fontSize: "0.72rem", color: "#7A6C6A", marginTop: 3 }}>{r.note}</p>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {phase === "importing" && <div className="mt-3"><LoadingLine text="Importing — the server is checking the file again before saving…" /></div>}
        </>
      )}
    </DialogFrame>
  );
}
