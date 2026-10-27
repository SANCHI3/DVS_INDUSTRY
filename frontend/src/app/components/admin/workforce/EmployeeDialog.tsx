import { useEffect, useMemo, useState } from "react";
import { Edit2, Save } from "lucide-react";
import { describeApiError } from "../../../../lib/api";
import {
  assignDepartment, assignShift, createEmployee, updateEmployee, type EmployeeDto, type EmployeeStatus,
} from "../../../../lib/services/employees.service";
import { createDepartment, type DepartmentDto } from "../../../../lib/services/departments.service";
import {
  createAttendance, createEmployeeOutput, createShift, getAttendance, getEmployeeOutputs, updateAttendance,
  updateEmployeeOutput, type AttendanceDto, type AttendanceStatus, type EmployeeOutputDto, type EmployeeOutputFields,
  type ShiftDto,
} from "../../../../lib/services/workforce.service";
import {
  ATTENDANCE_STATUSES, EDITABLE_EMPLOYEE_STATUSES, EMPLOYMENT_TYPES, apiDay, calculateEfficiency, efficiencyColor,
  employeeStatusLabel, findByName, formatEfficiency, localIsoDate, numberToField, parseOptionalNumber,
  suggestDepartmentCode, validateEmployeeForm, type FormErrors, type WorkforcePermissions,
} from "../../../../lib/workforce";
import {
  DialogFrame, Field, InlineNotice, LoadingLine, PrimaryButton, SecondaryButton, SectionHeading, disabledInputStyle,
  inputStyle,
} from "./formControls";

export type EmployeeDialogMode = "add" | "edit" | "view";

interface FormState {
  employeeCode: string;
  firstName: string;
  lastName: string;
  designation: string;
  departmentName: string;
  newDepartmentCode: string;
  shiftName: string;
  newShiftStart: string;
  newShiftEnd: string;
  joiningDate: string;
  employmentType: string;
  status: EmployeeStatus;
  dailyWageRate: string;
  performanceDate: string;
  workingHours: string;
  expectedParts: string;
  producedParts: string;
  operationsCount: string;
  remarks: string;
  attendanceStatus: AttendanceStatus | "";
}

function initialForm(e: EmployeeDto | null, date: string): FormState {
  return {
    employeeCode: e?.employeeCode ?? "",
    firstName: e?.firstName ?? "",
    lastName: e?.lastName ?? "",
    designation: e?.designation ?? "",
    departmentName: e?.department?.name ?? "",
    newDepartmentCode: "",
    shiftName: e?.shift?.name ?? "",
    newShiftStart: "",
    newShiftEnd: "",
    joiningDate: e ? apiDay(e.joiningDate) : localIsoDate(),
    employmentType: e?.employmentType ?? "FULL_TIME",
    status: e?.status ?? "ACTIVE",
    dailyWageRate: e?.dailyWageRate ?? "",
    performanceDate: date,
    workingHours: "",
    expectedParts: "",
    producedParts: "",
    operationsCount: "",
    remarks: "",
    attendanceStatus: "",
  };
}

interface DayRecords {
  output: EmployeeOutputDto | null;
  attendance: AttendanceDto | null;
  loading: boolean;
  error: string | null;
}

const OUTPUT_FIELDS = ["workingHours", "expectedParts", "producedParts", "operationsCount"] as const;

interface Props {
  mode: EmployeeDialogMode;
  employee: EmployeeDto | null;
  initialDate: string;
  departments: DepartmentDto[];
  shifts: ShiftDto[];
  perms: WorkforcePermissions;
  onClose: () => void;
  /** Something was written; reload the table (and lookups) behind the dialog. */
  onChanged: () => void;
  /** Everything was saved; close with this success message. */
  onSaved: (message: string) => void;
  onEdit?: () => void;
}

export function EmployeeDialog({ mode, employee, initialDate, departments, shifts, perms, onClose, onChanged, onSaved, onEdit }: Props) {
  const [form, setForm] = useState<FormState>(() => initialForm(employee, initialDate));
  // Set once the employee exists, so a retry after a partial failure never creates it twice
  const [saved, setSaved] = useState<EmployeeDto | null>(employee);
  const [createdDepartments, setCreatedDepartments] = useState<DepartmentDto[]>([]);
  const [createdShifts, setCreatedShifts] = useState<ShiftDto[]>([]);
  const [day, setDay] = useState<DayRecords>({ output: null, attendance: null, loading: false, error: null });
  const [errors, setErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const readOnly = mode === "view";
  const editProfile = !readOnly && perms.editEmployees;
  const editPerformance = !readOnly && perms.editPerformance;
  const editAttendance = !readOnly && perms.editAttendance;

  const allDepartments = useMemo(() => [...departments, ...createdDepartments], [departments, createdDepartments]);
  const allShifts = useMemo(() => [...shifts, ...createdShifts], [shifts, createdShifts]);
  const matchedDepartment = findByName(allDepartments, form.departmentName);
  const isNewDepartment = form.departmentName.trim() !== "" && !matchedDepartment;
  const matchedShift = findByName(allShifts, form.shiftName);
  const isNewShift = form.shiftName.trim() !== "" && !matchedShift;

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  // Suggest a code the first time a new department name is typed
  useEffect(() => {
    if (isNewDepartment && form.newDepartmentCode === "") {
      setForm((f) => ({ ...f, newDepartmentCode: suggestDepartmentCode(f.departmentName, allDepartments.map((d) => d.code)) }));
    }
  }, [isNewDepartment, form.newDepartmentCode, allDepartments]);

  // The selected day's performance and attendance records
  const employeeId = saved?.id ?? null;
  useEffect(() => {
    if (employeeId === null || !form.performanceDate) {
      setDay({ output: null, attendance: null, loading: false, error: null });
      return;
    }
    let cancelled = false;
    setDay((d) => ({ ...d, loading: true, error: null }));
    const date = form.performanceDate;
    Promise.allSettled([
      getEmployeeOutputs({ employeeId, date, pageSize: 1 }),
      perms.viewAttendance ? getAttendance({ employeeId, date, pageSize: 1 }) : Promise.resolve(null),
    ]).then(([outRes, attRes]) => {
      if (cancelled) return;
      const output = outRes.status === "fulfilled" ? outRes.value.data[0] ?? null : null;
      const attendance = attRes.status === "fulfilled" ? attRes.value?.data[0] ?? null : null;
      const failed = [outRes, attRes].find((r): r is PromiseRejectedResult => r.status === "rejected");
      setDay({
        output, attendance, loading: false,
        error: failed ? describeApiError(failed.reason, `load the records for ${date}`) : null,
      });
      setForm((f) => ({
        ...f,
        workingHours: numberToField(output?.workingHours),
        expectedParts: numberToField(output?.expectedParts),
        producedParts: numberToField(output?.producedParts),
        operationsCount: numberToField(output?.operationsCount),
        remarks: output?.remarks ?? "",
        attendanceStatus: attendance?.status ?? "",
      }));
    });
    return () => { cancelled = true; };
  }, [employeeId, form.performanceDate, perms.viewAttendance]);

  const expected = parseOptionalNumber(form.expectedParts);
  const produced = parseOptionalNumber(form.producedParts);
  const efficiency = calculateEfficiency(expected, produced);
  const efficiencyHint =
    efficiency !== null ? "Produced parts ÷ expected parts × 100"
      : expected === null ? "Enter expected parts to calculate efficiency."
        : Number.isNaN(expected) || (produced !== null && Number.isNaN(produced)) ? "Enter valid numbers to calculate efficiency."
          : expected <= 0 ? "Expected parts is 0, so efficiency cannot be calculated."
            : "Enter produced parts to calculate efficiency.";

  function validate(): FormErrors {
    const e = validateEmployeeForm(form, { checkProfile: editProfile, checkPay: editProfile && perms.viewPay, checkPerformance: editPerformance });
    if (editProfile && isNewDepartment) {
      if (!perms.createLookups) e.department = "No department has this name. Choose an existing one or ask HR to create it.";
      else if (!/^[A-Z0-9_]{2,10}$/.test(form.newDepartmentCode)) e.department = "New department code: 2–10 capital letters, digits or _.";
      else if (form.departmentName.trim().length < 2) e.department = "Department name must be at least 2 characters.";
    }
    if (editProfile && isNewShift) {
      if (!perms.createLookups) e.shift = "No shift has this name. Choose an existing one or ask HR to create it.";
      else if (!form.newShiftStart || !form.newShiftEnd) e.shift = "Enter the start and end time for the new shift.";
    }
    if (editAttendance && form.attendanceStatus && !form.performanceDate) e.performanceDate = "Choose the date for this attendance.";
    return e;
  }

  async function handleSave() {
    if (saving) return; // a second click or Enter while saving
    const found = validate();
    setErrors(found);
    if (Object.values(found).some(Boolean)) {
      setSaveError("Please correct the highlighted fields.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    const done: string[] = [];
    let step = "save the employee";
    try {
      let emp = saved;

      if (editProfile) {
        let departmentId = matchedDepartment?.id ?? null;
        if (isNewDepartment) {
          step = `create the department "${form.departmentName.trim()}"`;
          const dept = await createDepartment({ name: form.departmentName.trim(), code: form.newDepartmentCode });
          setCreatedDepartments((list) => [...list, dept]);
          departmentId = dept.id;
          done.push(`department "${dept.name}"`);
        }
        let shiftId = matchedShift?.id ?? null;
        if (isNewShift) {
          step = `create the shift "${form.shiftName.trim()}"`;
          const shift = await createShift({
            name: form.shiftName.trim(), startTime: form.newShiftStart, endTime: form.newShiftEnd,
            isNightShift: form.newShiftEnd < form.newShiftStart,
          });
          setCreatedShifts((list) => [...list, shift]);
          shiftId = shift.id;
          done.push(`shift "${shift.name}"`);
        }

        const wage = form.dailyWageRate.trim() === "" ? null : form.dailyWageRate.trim();
        if (emp === null) {
          step = "create the employee";
          emp = await createEmployee({
            employeeCode: form.employeeCode.trim(),
            firstName: form.firstName.trim(),
            lastName: form.lastName.trim(),
            designation: form.designation.trim(),
            joiningDate: form.joiningDate,
            employmentType: form.employmentType,
            status: form.status === "TERMINATED" ? "ACTIVE" : form.status,
            departmentId,
            shiftId,
            ...(perms.viewPay ? { dailyWageRate: wage } : {}),
          });
          setSaved(emp);
          done.push("employee");
        } else {
          step = "update the employee";
          const patch: Record<string, unknown> = {};
          const text = (key: "employeeCode" | "firstName" | "lastName" | "designation" | "employmentType") => {
            const value = form[key].trim();
            if (value !== emp![key]) patch[key] = value;
          };
          text("employeeCode"); text("firstName"); text("lastName"); text("designation"); text("employmentType");
          if (form.joiningDate !== apiDay(emp.joiningDate)) patch["joiningDate"] = form.joiningDate;
          if (form.status !== emp.status && form.status !== "TERMINATED") patch["status"] = form.status;
          if (perms.viewPay && wage !== emp.dailyWageRate && Number(wage) !== Number(emp.dailyWageRate ?? NaN)) patch["dailyWageRate"] = wage;
          if (Object.keys(patch).length > 0) emp = await updateEmployee(emp.id, patch);
          if (departmentId !== (emp.department?.id ?? null)) {
            step = "change the department";
            emp = await assignDepartment(emp.id, departmentId);
          }
          if (shiftId !== (emp.shift?.id ?? null)) {
            step = "change the shift";
            emp = await assignShift(emp.id, shiftId);
          }
          setSaved(emp);
          done.push("employee details");
        }
      }

      if (emp !== null && editPerformance) {
        step = `save performance for ${form.performanceDate}`;
        const values: EmployeeOutputFields = {
          workingHours: parseOptionalNumber(form.workingHours),
          expectedParts: parseOptionalNumber(form.expectedParts),
          producedParts: parseOptionalNumber(form.producedParts),
          operationsCount: parseOptionalNumber(form.operationsCount),
          remarks: form.remarks.trim() === "" ? null : form.remarks.trim(),
        };
        const existing = day.output;
        if (existing !== null) {
          const changed: EmployeeOutputFields = {};
          for (const key of OUTPUT_FIELDS) if (values[key] !== existing[key]) changed[key] = values[key];
          if (values.remarks !== existing.remarks) changed.remarks = values.remarks;
          if (Object.keys(changed).length > 0) {
            const output = await updateEmployeeOutput(existing.id, changed);
            setDay((d) => ({ ...d, output }));
            done.push("performance");
          }
        } else if (OUTPUT_FIELDS.some((key) => values[key] !== null)) {
          const output = await createEmployeeOutput({ employeeId: emp.id, date: form.performanceDate, ...values });
          setDay((d) => ({ ...d, output }));
          done.push("performance");
        }
      }

      if (emp !== null && editAttendance && form.attendanceStatus) {
        step = `save attendance for ${form.performanceDate}`;
        const existing = day.attendance;
        if (existing === null) {
          const attendance = await createAttendance({ employeeId: emp.id, date: form.performanceDate, status: form.attendanceStatus });
          setDay((d) => ({ ...d, attendance }));
          done.push("attendance");
        } else if (existing.status !== form.attendanceStatus) {
          const attendance = await updateAttendance(existing.id, { status: form.attendanceStatus });
          setDay((d) => ({ ...d, attendance }));
          done.push("attendance");
        }
      }

      const name = `${form.firstName.trim()} ${form.lastName.trim()}`.trim() || emp?.employeeCode || "Employee";
      onSaved(
        mode === "add" ? `${name} added.`
          : done.length > 0 ? `${name}: ${done.join(", ")} saved.`
            : "No changes to save.",
      );
    } catch (err) {
      setSaveError(describeApiError(err, step) + (done.length > 0 ? ` Already saved: ${done.join(", ")}.` : ""));
      if (done.length > 0) onChanged();
    } finally {
      setSaving(false);
    }
  }

  const title = mode === "add" ? "Add New Employee" : mode === "view" ? "Employee Details" : editProfile ? "Edit Employee" : "Record Daily Performance";
  const subtitle = saved ? `${saved.employeeCode} · ${saved.firstName} ${saved.lastName}`.trim() : "Fields marked * are required";
  const style = (editable: boolean) => (editable ? inputStyle : disabledInputStyle);
  const describedBy = (id: string, has: boolean) => (has ? `${id}-msg` : undefined);

  return (
    <DialogFrame
      title={title}
      subtitle={subtitle}
      onClose={onClose}
      footer={
        <>
          {saveError && <div className="flex-1 min-w-[16rem]"><InlineNotice tone="error">{saveError}</InlineNotice></div>}
          <SecondaryButton onClick={onClose}>{readOnly ? "Close" : "Cancel"}</SecondaryButton>
          {readOnly ? (
            onEdit && (perms.editEmployees || perms.editPerformance || perms.editAttendance) && (
              <PrimaryButton onClick={onEdit}><Edit2 size={14} /> Edit</PrimaryButton>
            )
          ) : (
            <PrimaryButton onClick={handleSave} disabled={saving || day.loading}>
              <Save size={14} /> {saving ? "Saving…" : mode === "add" && saved === null ? "Add Employee" : "Save Changes"}
            </PrimaryButton>
          )}
        </>
      }
    >
      <form onSubmit={(e) => { e.preventDefault(); if (!readOnly) void handleSave(); }} noValidate>
        {/* ── Employee information ── */}
        <SectionHeading title="Employee information" />
        {!readOnly && !perms.editEmployees && (
          <div className="mb-3"><InlineNotice tone="info">Only HR and administrators can change employee details. You can record daily performance below.</InlineNotice></div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          <Field id="emp-code" label="Employee ID" required={editProfile} error={errors.employeeCode} hint={editProfile ? "Must be unique. Capital letters, digits, - or _." : undefined}>
            <input id="emp-code" value={form.employeeCode} onChange={(e) => set("employeeCode", e.target.value.toUpperCase())}
              style={style(editProfile)} disabled={!editProfile} maxLength={20} placeholder="e.g. EMP-0042"
              aria-invalid={!!errors.employeeCode} aria-describedby={describedBy("emp-code", true)} />
          </Field>
          <Field id="emp-designation" label="Designation" required={editProfile} error={errors.designation}>
            <input id="emp-designation" value={form.designation} onChange={(e) => set("designation", e.target.value)}
              style={style(editProfile)} disabled={!editProfile} maxLength={100} placeholder="e.g. CNC Operator"
              aria-invalid={!!errors.designation} aria-describedby={describedBy("emp-designation", !!errors.designation)} />
          </Field>
          <Field id="emp-first" label="First name" required={editProfile} error={errors.firstName}>
            <input id="emp-first" value={form.firstName} onChange={(e) => set("firstName", e.target.value)}
              style={style(editProfile)} disabled={!editProfile} maxLength={100} autoComplete="off"
              aria-invalid={!!errors.firstName} aria-describedby={describedBy("emp-first", !!errors.firstName)} />
          </Field>
          <Field id="emp-last" label="Last name" hint={editProfile ? "Optional" : undefined}>
            <input id="emp-last" value={form.lastName} onChange={(e) => set("lastName", e.target.value)}
              style={style(editProfile)} disabled={!editProfile} maxLength={100} autoComplete="off" aria-describedby={describedBy("emp-last", editProfile)} />
          </Field>
          <Field id="emp-dept" label="Department" error={errors.department}
            hint={editProfile ? (isNewDepartment ? (perms.createLookups ? `"${form.departmentName.trim()}" is new and will be created when you save.` : undefined) : "Pick from the list or type a new name.") : undefined}>
            <input id="emp-dept" list="emp-dept-options" value={form.departmentName} onChange={(e) => { set("departmentName", e.target.value); setErrors((x) => ({ ...x, department: undefined })); }}
              style={style(editProfile)} disabled={!editProfile} placeholder="No department" autoComplete="off"
              aria-invalid={!!errors.department} aria-describedby={describedBy("emp-dept", editProfile || !!errors.department)} />
            <datalist id="emp-dept-options">{allDepartments.map((d) => <option key={d.id} value={d.name} />)}</datalist>
            {editProfile && isNewDepartment && perms.createLookups && (
              <div className="mt-2">
                <label htmlFor="emp-dept-code" style={{ fontSize: "0.72rem", color: "#4A4A4A", fontWeight: 600 }}>New department code</label>
                <input id="emp-dept-code" value={form.newDepartmentCode} onChange={(e) => set("newDepartmentCode", e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ""))}
                  style={{ ...inputStyle, marginTop: "0.25rem" }} maxLength={10} />
              </div>
            )}
          </Field>
          <Field id="emp-shift" label="Shift" error={errors.shift}
            hint={editProfile ? (isNewShift ? (perms.createLookups ? `"${form.shiftName.trim()}" is new: set its hours below.` : undefined) : "Pick from the list or type a new shift name.") : undefined}>
            <input id="emp-shift" list="emp-shift-options" value={form.shiftName} onChange={(e) => { set("shiftName", e.target.value); setErrors((x) => ({ ...x, shift: undefined })); }}
              style={style(editProfile)} disabled={!editProfile} placeholder="No shift" autoComplete="off"
              aria-invalid={!!errors.shift} aria-describedby={describedBy("emp-shift", editProfile || !!errors.shift)} />
            <datalist id="emp-shift-options">{allShifts.map((s) => <option key={s.id} value={s.name}>{`${s.startTime}–${s.endTime}`}</option>)}</datalist>
            {editProfile && isNewShift && perms.createLookups && (
              <div className="grid grid-cols-2 gap-2 mt-2">
                <div>
                  <label htmlFor="emp-shift-start" style={{ fontSize: "0.72rem", color: "#4A4A4A", fontWeight: 600 }}>Starts</label>
                  <input id="emp-shift-start" type="time" value={form.newShiftStart} onChange={(e) => set("newShiftStart", e.target.value)} style={{ ...inputStyle, marginTop: "0.25rem" }} />
                </div>
                <div>
                  <label htmlFor="emp-shift-end" style={{ fontSize: "0.72rem", color: "#4A4A4A", fontWeight: 600 }}>Ends</label>
                  <input id="emp-shift-end" type="time" value={form.newShiftEnd} onChange={(e) => set("newShiftEnd", e.target.value)} style={{ ...inputStyle, marginTop: "0.25rem" }} />
                </div>
              </div>
            )}
          </Field>
          <Field id="emp-joining" label="Joining date" required={editProfile} error={errors.joiningDate}>
            <input id="emp-joining" type="date" value={form.joiningDate} onChange={(e) => set("joiningDate", e.target.value)}
              style={style(editProfile)} disabled={!editProfile}
              aria-invalid={!!errors.joiningDate} aria-describedby={describedBy("emp-joining", !!errors.joiningDate)} />
          </Field>
          <Field id="emp-type" label="Employment type">
            <select id="emp-type" value={form.employmentType} onChange={(e) => set("employmentType", e.target.value)} style={style(editProfile)} disabled={!editProfile}>
              {EMPLOYMENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </Field>
        </div>

        {/* ── Employment & pay ── */}
        <SectionHeading title="Employment status & pay" subtitle="Employment status is separate from daily attendance." />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          <Field id="emp-status" label="Employment status" hint={form.status === "TERMINATED" ? "Terminated employees are restored by an administrator." : undefined}>
            {form.status === "TERMINATED" ? (
              <input id="emp-status" value={employeeStatusLabel(form.status)} style={disabledInputStyle} disabled />
            ) : (
              <select id="emp-status" value={form.status} onChange={(e) => set("status", e.target.value as EmployeeStatus)} style={style(editProfile)} disabled={!editProfile}>
                {EDITABLE_EMPLOYEE_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            )}
          </Field>
          {perms.viewPay && (
            <Field id="emp-wage" label="Daily wage rate (₹)" error={errors.dailyWageRate} hint={editProfile ? "Visible only to HR and administrators." : undefined}>
              <input id="emp-wage" type="number" inputMode="decimal" min={0} step="0.01" value={form.dailyWageRate}
                onChange={(e) => set("dailyWageRate", e.target.value)} style={style(editProfile)} disabled={!editProfile} placeholder="Not set"
                aria-invalid={!!errors.dailyWageRate} aria-describedby={describedBy("emp-wage", editProfile || !!errors.dailyWageRate)} />
            </Field>
          )}
        </div>

        {/* ── Daily performance & attendance ── */}
        <SectionHeading title="Daily performance & attendance" subtitle="Recorded per employee per day. Not added to work-order production totals." />
        {saved === null && mode === "add" && (
          <div className="mb-3"><InlineNotice tone="info">Optional. Figures entered here are saved for the chosen day once the employee is created.</InlineNotice></div>
        )}
        {day.loading && <div className="mb-3"><LoadingLine text={`Loading records for ${form.performanceDate}…`} /></div>}
        {day.error && <div className="mb-3"><InlineNotice tone="error">{day.error}</InlineNotice></div>}
        {!day.loading && saved !== null && (day.output || day.attendance) && !readOnly && (
          <div className="mb-3"><InlineNotice tone="info">Records already exist for this day. Saving updates them; nothing else is overwritten.</InlineNotice></div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
          <Field id="perf-date" label="Date" required error={errors.performanceDate}>
            <input id="perf-date" type="date" value={form.performanceDate} max={localIsoDate()} onChange={(e) => set("performanceDate", e.target.value)}
              style={inputStyle} aria-invalid={!!errors.performanceDate} aria-describedby={describedBy("perf-date", !!errors.performanceDate)} />
          </Field>
          <Field id="perf-hours" label="Daily working hours" error={errors.workingHours}
            hint={day.attendance?.workingHours != null ? `Clock-in/out shows ${day.attendance.workingHours} h` : "0–24 hours"}>
            <input id="perf-hours" type="number" inputMode="decimal" min={0} max={24} step="0.25" value={form.workingHours}
              onChange={(e) => set("workingHours", e.target.value)} style={style(editPerformance)} disabled={!editPerformance} placeholder="Not recorded"
              aria-invalid={!!errors.workingHours} aria-describedby="perf-hours-msg" />
          </Field>
          <Field id="perf-ops" label="Number of operations" error={errors.operationsCount}>
            <input id="perf-ops" type="number" inputMode="numeric" min={0} step={1} value={form.operationsCount}
              onChange={(e) => set("operationsCount", e.target.value)} style={style(editPerformance)} disabled={!editPerformance} placeholder="Not recorded"
              aria-invalid={!!errors.operationsCount} aria-describedby={describedBy("perf-ops", !!errors.operationsCount)} />
          </Field>
          <Field id="perf-expected" label="Expected parts (daily)" error={errors.expectedParts}>
            <input id="perf-expected" type="number" inputMode="decimal" min={0} step="any" value={form.expectedParts}
              onChange={(e) => set("expectedParts", e.target.value)} style={style(editPerformance)} disabled={!editPerformance} placeholder="Not recorded"
              aria-invalid={!!errors.expectedParts} aria-describedby={describedBy("perf-expected", !!errors.expectedParts)} />
          </Field>
          <Field id="perf-produced" label="Produced parts (daily)" error={errors.producedParts}>
            <input id="perf-produced" type="number" inputMode="decimal" min={0} step="any" value={form.producedParts}
              onChange={(e) => set("producedParts", e.target.value)} style={style(editPerformance)} disabled={!editPerformance} placeholder="Not recorded"
              aria-invalid={!!errors.producedParts} aria-describedby={describedBy("perf-produced", !!errors.producedParts)} />
          </Field>
          {perms.viewAttendance ? (
            <Field id="perf-attendance" label="Attendance status" hint={!editAttendance ? undefined : day.attendance ? "Changing this updates the existing record." : "Leave as 'Not recorded' to skip."}>
              <select id="perf-attendance" value={form.attendanceStatus} onChange={(e) => set("attendanceStatus", e.target.value as AttendanceStatus | "")}
                style={style(editAttendance)} disabled={!editAttendance} aria-describedby={describedBy("perf-attendance", editAttendance)}>
                <option value="" disabled={day.attendance !== null}>Not recorded</option>
                {ATTENDANCE_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </Field>
          ) : (
            <Field id="perf-attendance" label="Attendance status" hint="Attendance is visible to HR, managers and administrators.">
              <input id="perf-attendance" value="Restricted" style={disabledInputStyle} disabled aria-describedby="perf-attendance-msg" />
            </Field>
          )}
        </div>
        <Field id="perf-remarks" label="Performance remarks">
          <input id="perf-remarks" value={form.remarks} onChange={(e) => set("remarks", e.target.value)} maxLength={500}
            style={style(editPerformance)} disabled={!editPerformance} placeholder="Optional" />
        </Field>

        <div className="mt-4 p-4 rounded-lg flex flex-wrap items-center justify-between gap-2" style={{ background: "#F9F6F5", border: "1px solid #E8E2E0" }}>
          <div>
            <p style={{ fontSize: "0.775rem", color: "#7A6C6A", fontWeight: 600 }}>Calculated efficiency</p>
            <p style={{ fontSize: "0.72rem", color: "#9A8A88", marginTop: "0.15rem" }}>{efficiencyHint}</p>
          </div>
          <p aria-live="polite" style={{ fontSize: "1.5rem", fontWeight: 700, color: efficiencyColor(efficiency) }}>{formatEfficiency(efficiency)}</p>
        </div>
      </form>
    </DialogFrame>
  );
}
