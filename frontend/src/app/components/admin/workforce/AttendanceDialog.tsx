import { useMemo, useState } from "react";
import { Save } from "lucide-react";
import { describeApiError, fetchAllPages, isApiError } from "../../../../lib/api";
import { getEmployees, type EmployeeDto } from "../../../../lib/services/employees.service";
import {
  createAttendance, getAttendance, updateAttendance, type AttendanceDto, type AttendanceStatus,
} from "../../../../lib/services/workforce.service";
import { useApiData } from "../../../../lib/useApiData";
import { ATTENDANCE_STATUSES, apiDay, combineDayAndTime, fullName, localIsoDate, localTime } from "../../../../lib/workforce";
import { DialogFrame, Field, InlineNotice, PrimaryButton, SecondaryButton, inputStyle, disabledInputStyle } from "./formControls";

const WITH_TIMES: AttendanceStatus[] = ["PRESENT", "LATE", "HALF_DAY"];

function nextDay(isoDay: string): string {
  const [y, m, d] = isoDay.split("-").map(Number);
  return localIsoDate(new Date(y!, m! - 1, d! + 1));
}

function employeeLabel(e: { employeeCode: string; firstName: string; lastName: string }) {
  return `${e.employeeCode} — ${fullName(e)}`;
}

interface Props {
  record: AttendanceDto | null; // null = new record
  defaultDate: string;
  onClose: () => void;
  onSaved: (message: string) => void;
  onOpenExisting: (record: AttendanceDto) => void;
}

/**
 * Add one attendance record (refused if the employee already has one that
 * day: the existing record is offered for editing instead), or edit one.
 */
export function AttendanceDialog({ record, defaultDate, onClose, onSaved, onOpenExisting }: Props) {
  const isNew = record === null;
  const day = record ? apiDay(record.date) : defaultDate;
  const [employeeText, setEmployeeText] = useState("");
  const [date, setDate] = useState(day);
  const [status, setStatus] = useState<AttendanceStatus>(record?.status ?? "PRESENT");
  const [clockIn, setClockIn] = useState(localTime(record?.clockIn ?? null));
  const [clockOut, setClockOut] = useState(localTime(record?.clockOut ?? null));
  const [remarks, setRemarks] = useState(record?.remarks ?? "");
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<AttendanceDto | null>(null);
  const [saving, setSaving] = useState(false);

  const employees = useApiData(
    () => fetchAllPages((p) => getEmployees({ page: p, pageSize: 100, status: "all", sortBy: "employeeCode", sortOrder: "asc" })),
    [], "load the employee list", isNew,
  );
  const byLabel = useMemo(() => new Map((employees.data ?? []).map((e) => [employeeLabel(e).toLowerCase(), e])), [employees.data]);
  const byCode = useMemo(() => new Map((employees.data ?? []).map((e) => [e.employeeCode.toLowerCase(), e])), [employees.data]);
  const typed = employeeText.trim().toLowerCase();
  const selected: EmployeeDto | undefined = byLabel.get(typed) ?? byCode.get(typed);

  const timesApply = WITH_TIMES.includes(status);
  const crossesMidnight = timesApply && clockIn !== "" && clockOut !== "" && clockOut <= clockIn;

  async function save() {
    setError(null);
    setExisting(null);
    if (isNew && !selected) { setError("Choose an employee from the list (type their ID or name)."); return; }
    if (!date) { setError("Choose a date."); return; }
    if (date > localIsoDate()) { setError("Attendance cannot be recorded for a future date."); return; }
    if (timesApply && clockOut && !clockIn) { setError("Enter a check-in time before a check-out time."); return; }

    const inIso = timesApply ? combineDayAndTime(date, clockIn) : null;
    const outIso = timesApply ? combineDayAndTime(crossesMidnight ? nextDay(date) : date, clockOut) : null;
    const note = remarks.trim() === "" ? null : remarks.trim();

    setSaving(true);
    try {
      if (isNew) {
        await createAttendance({ employeeId: selected!.id, date, status, clockIn: inIso, clockOut: outIso, remarks: note });
        onSaved(`Attendance recorded for ${fullName(selected!)} on ${date}.`);
      } else {
        const patch: Parameters<typeof updateAttendance>[1] = {};
        if (status !== record.status) patch.status = status;
        if (inIso !== (record.clockIn ? new Date(record.clockIn).toISOString() : null)) patch.clockIn = inIso;
        if (outIso !== (record.clockOut ? new Date(record.clockOut).toISOString() : null)) patch.clockOut = outIso;
        if (note !== record.remarks) patch.remarks = note;
        if (Object.keys(patch).length === 0) { onSaved("No changes to save."); return; }
        await updateAttendance(record.id, patch);
        onSaved(`Attendance updated for ${fullName(record.employee)} on ${day}.`);
      }
    } catch (err) {
      setError(describeApiError(err, isNew ? "record attendance" : "update attendance"));
      if (isNew && isApiError(err) && err.status === 409) {
        // Offer the record that is already there instead of overwriting it
        getAttendance({ employeeId: selected!.id, date, pageSize: 1 })
          .then((res) => setExisting(res.data[0] ?? null))
          .catch(() => undefined);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <DialogFrame
      width="max-w-xl"
      title={isNew ? "Record Attendance" : "Edit Attendance"}
      subtitle={isNew ? "One record per employee per day. Existing records are never overwritten." : `${employeeLabel(record.employee)} · ${day}`}
      onClose={onClose}
      footer={
        <>
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton onClick={() => void save()} disabled={saving || (isNew && employees.loading)}>
            <Save size={14} /> {saving ? "Saving…" : isNew ? "Record Attendance" : "Save Changes"}
          </PrimaryButton>
        </>
      }
    >
      <form onSubmit={(e) => { e.preventDefault(); void save(); }} noValidate className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {error && (
          <div className="sm:col-span-2">
            <InlineNotice tone="error">
              {error}
              {existing && (
                <button type="button" onClick={() => onOpenExisting(existing)} style={{ marginLeft: "0.5rem", background: "none", border: "none", color: "#A52A2A", fontWeight: 700, cursor: "pointer", textDecoration: "underline" }}>
                  Open the existing record ({ATTENDANCE_STATUSES.find((s) => s.value === existing.status)?.label})
                </button>
              )}
            </InlineNotice>
          </div>
        )}
        {isNew ? (
          <div className="sm:col-span-2">
            <Field id="att-employee" label="Employee" required error={employees.error ?? undefined} hint={employees.loading ? "Loading employees…" : selected ? `${selected.designation}${selected.department ? ` · ${selected.department.name}` : ""}` : "Type an employee ID or name, then pick from the list."}>
              <input id="att-employee" list="att-employee-options" value={employeeText} onChange={(e) => setEmployeeText(e.target.value)}
                style={inputStyle} autoComplete="off" placeholder="e.g. EMP-0042" aria-describedby="att-employee-msg" />
              <datalist id="att-employee-options">{(employees.data ?? []).map((e) => <option key={e.id} value={employeeLabel(e)} />)}</datalist>
            </Field>
          </div>
        ) : null}
        <Field id="att-date" label="Date" required>
          <input id="att-date" type="date" value={date} max={localIsoDate()} onChange={(e) => setDate(e.target.value)} style={isNew ? inputStyle : disabledInputStyle} disabled={!isNew} />
        </Field>
        <Field id="att-status" label="Status" required>
          <select id="att-status" value={status} onChange={(e) => setStatus(e.target.value as AttendanceStatus)} style={inputStyle}>
            {ATTENDANCE_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </Field>
        {timesApply && (
          <>
            <Field id="att-in" label="Check-in" hint="Optional">
              <input id="att-in" type="time" value={clockIn} onChange={(e) => setClockIn(e.target.value)} style={inputStyle} aria-describedby="att-in-msg" />
            </Field>
            <Field id="att-out" label="Check-out" hint={crossesMidnight ? "Ends the next day (night shift)." : "Optional"}>
              <input id="att-out" type="time" value={clockOut} onChange={(e) => setClockOut(e.target.value)} style={inputStyle} aria-describedby="att-out-msg" />
            </Field>
          </>
        )}
        <div className="sm:col-span-2">
          <Field id="att-remarks" label="Remarks">
            <input id="att-remarks" value={remarks} maxLength={500} onChange={(e) => setRemarks(e.target.value)} style={inputStyle} placeholder="Optional" />
          </Field>
        </div>
      </form>
    </DialogFrame>
  );
}
