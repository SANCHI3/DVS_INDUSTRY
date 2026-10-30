import { useEffect, useMemo, useState } from "react";
import { UserPlus } from "lucide-react";
import { describeApiError, isApiError } from "../../../../lib/api";
import {
  getShifts, registerSheetEmployees, type AttendanceImportReport, type AttendanceSheetNewEmployee,
  type SheetEmployeeRegistration, type ShiftDto,
} from "../../../../lib/services/workforce.service";
import { EMPLOYMENT_TYPES, formatDay } from "../../../../lib/workforce";
import { InlineNotice, LoadingLine, PrimaryButton, SecondaryButton, inputStyle } from "./formControls";

type EmploymentType = SheetEmployeeRegistration["employmentType"];

interface Draft {
  include: boolean;
  firstName: string;
  lastName: string;
  designation: string;
  joiningDate: string;
  employmentType: EmploymentType | "";
  shiftId: number | null;
}

/** First and last name as saved: together they must read exactly as the sheet */
const joinName = (first: string, last: string) => [first.trim(), last.trim()].filter((p) => p !== "").join(" ");

/** A starting split at the first space; the reviewer can move it, but not change the name */
export function splitSheetName(name: string): { firstName: string; lastName: string } {
  const at = name.indexOf(" ");
  return at < 0 ? { firstName: name, lastName: "" } : { firstName: name.slice(0, at), lastName: name.slice(at + 1) };
}

/** What still has to be completed or corrected for one employee; [] when ready */
export function draftProblems(u: AttendanceSheetNewEmployee, d: Draft, attendanceDate: string): string[] {
  const out: string[] = [];
  if (d.firstName.trim() === "") out.push("First name is required.");
  else if (joinName(d.firstName, d.lastName) !== u.name) out.push(`First and last name must together read exactly "${u.name}".`);
  if (d.designation.trim() === "") out.push("Designation is required (not in the sheet).");
  if (d.joiningDate === "") out.push("Joining date is required (not in the sheet).");
  else if (d.joiningDate > attendanceDate) out.push(`Joining date is after the attendance date ${formatDay(attendanceDate)}.`);
  if (d.employmentType === "") out.push("Choose the employment type (not in the sheet).");
  return out;
}

interface Props {
  file: File;
  date: string;
  employees: AttendanceSheetNewEmployee[];
  onCancel: () => void;
  onRegistered: (report: AttendanceImportReport, created: number) => void;
}

/**
 * Review of the Employee IDs the sheet lists but Workforce Management lacks.
 * ID and name come from the sheet and cannot be edited; what the sheet does not
 * say is left blank for the administrator. Nothing is saved until they confirm,
 * and attendance is imported later, as its own step.
 */
export function RegisterSheetEmployeesPanel({ file, date, employees, onCancel, onRegistered }: Props) {
  const [shifts, setShifts] = useState<ShiftDto[] | null>(null);
  const [shiftError, setShiftError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(employees.map((u) => [u.employeeCode, {
      include: u.problem === null,
      ...splitSheetName(u.name),
      designation: "",
      joiningDate: "",
      employmentType: "",
      shiftId: null,
    }])),
  );
  const [bulk, setBulk] = useState<{ designation: string; joiningDate: string; employmentType: EmploymentType | ""; shiftByCode: Record<string, string> }>(
    { designation: "", joiningDate: "", employmentType: "", shiftByCode: {} },
  );
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<{ message: string; byCode: Record<string, string[]> } | null>(null);

  useEffect(() => {
    getShifts({ pageSize: 100 })
      .then((r) => setShifts(r.data))
      .catch((err: unknown) => { setShifts([]); setShiftError(describeApiError(err, "load shifts")); });
  }, []);

  const sheetShiftCodes = useMemo(() => [...new Set(employees.filter((u) => u.problem === null && u.shift !== "").map((u) => u.shift))], [employees]);
  const selected = employees.filter((u) => u.problem === null && drafts[u.employeeCode]!.include);
  const problems = Object.fromEntries(selected.map((u) => [u.employeeCode, draftProblems(u, drafts[u.employeeCode]!, date)]));
  const notReady = selected.filter((u) => problems[u.employeeCode]!.length > 0).length;
  const blocked = employees.filter((u) => u.problem !== null);

  const update = (code: string, patch: Partial<Draft>) => {
    setDrafts((d) => ({ ...d, [code]: { ...d[code]!, ...patch } }));
    setChecked(false);
  };

  function applyBulk() {
    setDrafts((d) => {
      const next = { ...d };
      for (const u of selected) {
        const cur = next[u.employeeCode]!;
        const mapped = bulk.shiftByCode[u.shift];
        next[u.employeeCode] = {
          ...cur,
          ...(bulk.designation.trim() !== "" ? { designation: bulk.designation.trim() } : {}),
          ...(bulk.joiningDate !== "" ? { joiningDate: bulk.joiningDate } : {}),
          ...(bulk.employmentType !== "" ? { employmentType: bulk.employmentType } : {}),
          ...(mapped !== undefined && mapped !== "" ? { shiftId: Number(mapped) } : {}),
        };
      }
      return next;
    });
    setChecked(false);
  }

  async function register() {
    if (selected.length === 0 || notReady > 0 || !checked || saving) return;
    const payload: SheetEmployeeRegistration[] = selected.map((u) => {
      const d = drafts[u.employeeCode]!;
      return {
        employeeCode: u.employeeCode,
        firstName: d.firstName.trim(),
        lastName: d.lastName.trim(),
        designation: d.designation.trim(),
        joiningDate: d.joiningDate,
        employmentType: d.employmentType as EmploymentType,
        shiftId: d.shiftId,
      };
    });
    setSaving(true);
    setServerError(null);
    try {
      const r = await registerSheetEmployees(file, date, payload);
      onRegistered(r.report, r.created.length);
    } catch (err) {
      // Nothing was saved: the server registers all or none
      const byCode: Record<string, string[]> = {};
      if (isApiError(err) && Array.isArray(err.details)) {
        for (const d of err.details as Array<{ field?: string; message?: string }>) {
          const i = /^employees\.(\d+)/.exec(d.field ?? "")?.[1];
          const code = i === undefined ? undefined : payload[Number(i)]?.employeeCode;
          if (code !== undefined) byCode[code] = [...(byCode[code] ?? []), d.message ?? "Invalid"];
        }
      }
      setServerError({ message: `${describeApiError(err, "register the employees")} Nothing was saved.`, byCode });
      setChecked(false);
    } finally {
      setSaving(false);
    }
  }

  const cell = { padding: "6px 8px", verticalAlign: "top" as const };
  const small = { ...inputStyle, padding: "4px 6px", fontSize: "0.78rem" };

  return (
    <div aria-label="Register employees from the sheet">
      <InlineNotice tone="info">
        {employees.length} Employee ID{employees.length === 1 ? " in this sheet is" : "s in this sheet are"} not registered in Workforce Management.
        Employee ID and name are taken from the sheet exactly as written and cannot be changed here. The sheet does not
        give a designation, joining date or employment type, so you must enter these yourself. Nothing is saved until you
        confirm, and attendance is imported afterwards as a separate step.
      </InlineNotice>

      {blocked.length > 0 && (
        <div className="mt-3">
          <InlineNotice tone="warning">
            {blocked.length} ID{blocked.length === 1 ? "" : "s"} cannot be registered from this sheet:{" "}
            {blocked.map((u) => `${u.employeeCode} (${u.problem})`).join("; ")}
          </InlineNotice>
        </div>
      )}
      {shiftError && <div className="mt-3"><InlineNotice tone="warning">{shiftError} Shifts can be assigned later.</InlineNotice></div>}

      <fieldset className="mt-4 p-3 rounded-md" style={{ border: "1px solid #E8E2E0" }} disabled={saving}>
        <legend style={{ fontSize: "0.8rem", fontWeight: 600, color: "#4A4A4A", padding: "0 4px" }}>
          Fill in for all selected employees (optional; each row can still be changed)
        </legend>
        <div className="flex flex-wrap items-end gap-3" style={{ fontSize: "0.78rem", color: "#4A4A4A" }}>
          <label>Designation
            <input aria-label="Designation for all" value={bulk.designation} onChange={(e) => setBulk({ ...bulk, designation: e.target.value })}
              style={{ ...small, display: "block", width: "10rem" }} maxLength={100} />
          </label>
          <label>Joining date
            <input aria-label="Joining date for all" type="date" max={date} value={bulk.joiningDate} onChange={(e) => setBulk({ ...bulk, joiningDate: e.target.value })}
              style={{ ...small, display: "block" }} />
          </label>
          <label>Employment type
            <select aria-label="Employment type for all" value={bulk.employmentType} onChange={(e) => setBulk({ ...bulk, employmentType: e.target.value as EmploymentType | "" })}
              style={{ ...small, display: "block" }}>
              <option value="">—</option>
              {EMPLOYMENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </label>
          {sheetShiftCodes.map((code) => (
            <label key={code}>Sheet shift "{code}" is
              <select aria-label={`Shift for sheet code ${code}`} value={bulk.shiftByCode[code] ?? ""}
                onChange={(e) => setBulk({ ...bulk, shiftByCode: { ...bulk.shiftByCode, [code]: e.target.value } })}
                style={{ ...small, display: "block" }}>
                <option value="">— not set —</option>
                {(shifts ?? []).map((s) => <option key={s.id} value={s.id}>{s.name} ({s.startTime}–{s.endTime})</option>)}
              </select>
            </label>
          ))}
          <SecondaryButton onClick={applyBulk} disabled={saving || selected.length === 0}>Apply to {selected.length} selected</SecondaryButton>
        </div>
      </fieldset>

      {shifts === null ? <div className="mt-3"><LoadingLine text="Loading shifts…" /></div> : (
        <div className="mt-3 overflow-x-auto rounded-md" style={{ border: "1px solid #E8E2E0" }}>
          <table className="w-full" style={{ fontSize: "0.78rem", borderCollapse: "collapse" }}>
            <thead style={{ background: "#F9F6F5", textAlign: "left" }}>
              <tr>
                {["Register", "Employee ID", "Name in sheet", "Sheet row", "First name *", "Last name", "Sheet shift", "Shift", "Designation *", "Joining date *", "Employment type *"].map((h) => (
                  <th key={h} style={{ ...cell, fontWeight: 600, color: "#4A4A4A", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {employees.map((u) => {
                const d = drafts[u.employeeCode]!;
                const can = u.problem === null;
                const issues = [...(can && d.include ? problems[u.employeeCode]! : []), ...(serverError?.byCode[u.employeeCode] ?? [])];
                const off = !can || !d.include || saving;
                return (
                  <tr key={u.employeeCode} style={{ borderTop: "1px solid #F0ECEB", opacity: can ? 1 : 0.6 }}>
                    <td style={cell}>
                      <input type="checkbox" aria-label={`Register ${u.employeeCode}`} checked={can && d.include} disabled={!can || saving}
                        onChange={(e) => update(u.employeeCode, { include: e.target.checked })} />
                    </td>
                    <td style={{ ...cell, fontFamily: "JetBrains Mono, monospace", whiteSpace: "nowrap" }}>{u.employeeCode}</td>
                    <td style={{ ...cell, minWidth: "9rem" }}>
                      {u.name || <span style={{ color: "#B0A3A1" }}>—</span>}
                      {issues.map((m) => <p key={m} style={{ color: "#C0392B", fontSize: "0.72rem", marginTop: 2 }}>{m}</p>)}
                      {!can && <p style={{ color: "#7A6C6A", fontSize: "0.72rem", marginTop: 2 }}>{u.problem}</p>}
                    </td>
                    <td style={{ ...cell, color: "#9A8A88" }}>{u.rows.join(", ")}</td>
                    <td style={cell}>
                      <input aria-label={`First name for ${u.employeeCode}`} value={d.firstName} disabled={off} maxLength={100}
                        onChange={(e) => update(u.employeeCode, { firstName: e.target.value })} style={{ ...small, width: "8rem" }} />
                    </td>
                    <td style={cell}>
                      <input aria-label={`Last name for ${u.employeeCode}`} value={d.lastName} disabled={off} maxLength={100}
                        onChange={(e) => update(u.employeeCode, { lastName: e.target.value })} style={{ ...small, width: "8rem" }} />
                    </td>
                    <td style={{ ...cell, fontFamily: "JetBrains Mono, monospace" }}>{u.shift || <span style={{ color: "#B0A3A1" }}>—</span>}</td>
                    <td style={cell}>
                      <select aria-label={`Shift for ${u.employeeCode}`} value={d.shiftId ?? ""} disabled={off}
                        onChange={(e) => update(u.employeeCode, { shiftId: e.target.value === "" ? null : Number(e.target.value) })} style={small}>
                        <option value="">— not set —</option>
                        {shifts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </td>
                    <td style={cell}>
                      <input aria-label={`Designation for ${u.employeeCode}`} value={d.designation} disabled={off} maxLength={100}
                        onChange={(e) => update(u.employeeCode, { designation: e.target.value })} style={{ ...small, width: "8rem" }} />
                    </td>
                    <td style={cell}>
                      <input aria-label={`Joining date for ${u.employeeCode}`} type="date" max={date} value={d.joiningDate} disabled={off}
                        onChange={(e) => update(u.employeeCode, { joiningDate: e.target.value })} style={small} />
                    </td>
                    <td style={cell}>
                      <select aria-label={`Employment type for ${u.employeeCode}`} value={d.employmentType} disabled={off}
                        onChange={(e) => update(u.employeeCode, { employmentType: e.target.value as EmploymentType | "" })} style={small}>
                        <option value="">—</option>
                        {EMPLOYMENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {serverError && <div className="mt-3"><InlineNotice tone="error">{serverError.message}</InlineNotice></div>}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2" style={{ fontSize: "0.8rem", color: "#4A4A4A" }}>
          <input type="checkbox" checked={checked} disabled={saving || selected.length === 0 || notReady > 0}
            onChange={(e) => setChecked(e.target.checked)} />
          I have checked these {selected.length} employee record{selected.length === 1 ? "" : "s"} against company records.
        </label>
        <div className="flex gap-2">
          <SecondaryButton onClick={onCancel} disabled={saving}>Back to preview</SecondaryButton>
          <PrimaryButton onClick={() => void register()} disabled={saving || selected.length === 0 || notReady > 0 || !checked}>
            <UserPlus size={14} />
            {saving ? "Registering…" : notReady > 0 ? `${notReady} need${notReady === 1 ? "s" : ""} details` : `Register ${selected.length} employee${selected.length === 1 ? "" : "s"}`}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}
