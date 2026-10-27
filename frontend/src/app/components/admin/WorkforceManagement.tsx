import { useEffect, useMemo, useState } from "react";
import { Edit2, Filter, Plus, Search, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Card, DataTable, StatusBadge, Btn } from "../shared/UI";
import {
  assignDepartment,
  assignShift,
  createEmployee,
  deleteEmployee,
  getEmployees,
  updateEmployee,
  type EmployeeDto,
} from "../../../lib/services/employees.service";
import { getDepartments, type DepartmentDto } from "../../../lib/services/departments.service";
import { getShifts, type ShiftDto } from "../../../lib/services/workforce.service";

const unavailable = "—";

export interface Employee {
  id: string;
  _backendId?: number;
  name: string;
  dept: string;
  departmentId: number | null;
  designation: string;
  shift: string;
  shiftId: number | null;
  joining: string;
  joiningDateIso: string;
  dailyWorkingHours: number | null;
  expectedParts: number | null;
  producedParts: number | null;
  operationsPerformed: number | null;
  quantityProduced: number | null;
  attendanceStatus: "present" | "absent" | "late" | "on-leave" | "unavailable";
  dailyWageRate: number | null;
  efficiency: number | null;
  status: "active" | "inactive" | "on-leave";
}

function fromDto(e: EmployeeDto): Employee {
  return {
    id: e.employeeCode,
    _backendId: e.id,
    name: `${e.firstName} ${e.lastName}`.trim(),
    dept: e.department?.name ?? unavailable,
    departmentId: e.departmentId,
    designation: e.designation,
    shift: e.shift?.name ?? unavailable,
    shiftId: e.shiftId,
    joining: new Date(e.joiningDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }),
    joiningDateIso: e.joiningDate.slice(0, 10),
    dailyWorkingHours: null,
    expectedParts: null,
    producedParts: null,
    operationsPerformed: null,
    quantityProduced: null,
    attendanceStatus: "unavailable",
    dailyWageRate: e.salary ? parseFloat(e.salary) / 26 : null,
    efficiency: null,
    status: e.status === "ACTIVE" ? "active" : e.status === "ON_LEAVE" ? "on-leave" : "inactive",
  };
}

function emptyEmployee(): Employee {
  return {
    id: "",
    name: "",
    dept: "",
    departmentId: null,
    designation: "",
    shift: "",
    shiftId: null,
    joining: "",
    joiningDateIso: new Date().toISOString().slice(0, 10),
    dailyWorkingHours: null,
    expectedParts: null,
    producedParts: null,
    operationsPerformed: null,
    quantityProduced: null,
    attendanceStatus: "unavailable",
    dailyWageRate: null,
    efficiency: null,
    status: "active",
  };
}

interface EmployeeDialogProps {
  employee: Employee | null;
  departments: DepartmentDto[];
  shifts: ShiftDto[];
  onClose: () => void;
  onSave: (employee: Employee) => void;
  mode: "add" | "edit";
}

function EmployeeDialog({ employee, departments, shifts, onClose, onSave, mode }: EmployeeDialogProps) {
  const [formData, setFormData] = useState<Employee>(employee || emptyEmployee());

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
    onClose();
  };

  const handleChange = (field: keyof Employee, value: unknown) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "0.5rem 0.75rem",
    border: "1px solid #D4BFBB",
    borderRadius: "0.375rem",
    fontSize: "0.875rem",
    outline: "none",
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: "0.775rem",
    fontWeight: 600,
    color: "#4A4A4A",
    marginBottom: "0.35rem",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }}>
      <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl" style={{ background: "#fff" }}>
        <div className="sticky top-0 flex items-center justify-between px-6 py-4" style={{ background: "#fff", borderBottom: "1px solid #E8E2E0", zIndex: 10 }}>
          <div>
            <h2 style={{ fontSize: "1.25rem", fontWeight: 700, color: "#1C1C1C" }}>
              {mode === "add" ? "Add New Employee" : "Edit Employee"}
            </h2>
            <p style={{ fontSize: "0.8125rem", color: "#7A6C6A", marginTop: "0.25rem" }}>
              {mode === "add" ? "Enter employee details below" : "Update employee information"}
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-md" style={{ color: "#7A6C6A" }}>
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6">
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label style={labelStyle}>Employee ID *</label>
              <input type="text" value={formData.id} onChange={(e) => handleChange("id", e.target.value.toUpperCase())} style={inputStyle} placeholder="Enter employee code" required disabled={mode === "edit"} />
            </div>

            <div>
              <label style={labelStyle}>Employee Name *</label>
              <input type="text" value={formData.name} onChange={(e) => handleChange("name", e.target.value)} style={inputStyle} placeholder="Enter full name" required />
            </div>

            <div>
              <label style={labelStyle}>Department</label>
              <select value={formData.departmentId ?? ""} onChange={(e) => handleChange("departmentId", e.target.value ? Number(e.target.value) : null)} style={inputStyle}>
                <option value="">Select department</option>
                {departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
              </select>
            </div>

            <div>
              <label style={labelStyle}>Designation *</label>
              <input type="text" value={formData.designation} onChange={(e) => handleChange("designation", e.target.value)} style={inputStyle} placeholder="e.g., Sr. Operator" required />
            </div>

            <div>
              <label style={labelStyle}>Shift</label>
              <select value={formData.shiftId ?? ""} onChange={(e) => handleChange("shiftId", e.target.value ? Number(e.target.value) : null)} style={inputStyle}>
                <option value="">Select shift</option>
                {shifts.map((shift) => <option key={shift.id} value={shift.id}>{shift.name}</option>)}
              </select>
            </div>

            <div>
              <label style={labelStyle}>Joining Date *</label>
              <input type="date" value={formData.joiningDateIso} onChange={(e) => handleChange("joiningDateIso", e.target.value)} style={inputStyle} required />
            </div>

            <div>
              <label style={labelStyle}>Daily Working Hours</label>
              <input value={unavailable} style={inputStyle} disabled />
            </div>

            <div>
              <label style={labelStyle}>Expected Parts (Daily)</label>
              <input value={unavailable} style={inputStyle} disabled />
            </div>

            <div>
              <label style={labelStyle}>Produced Parts (Daily)</label>
              <input value={unavailable} style={inputStyle} disabled />
            </div>

            <div>
              <label style={labelStyle}>Number of Operations</label>
              <input value={unavailable} style={inputStyle} disabled />
            </div>

            <div>
              <label style={labelStyle}>Attendance Status</label>
              <input value={unavailable} style={inputStyle} disabled />
            </div>

            <div>
              <label style={labelStyle}>Daily Wage Rate</label>
              <input value={formData.dailyWageRate === null ? unavailable : formData.dailyWageRate.toFixed(2)} style={inputStyle} disabled />
            </div>

            <div>
              <label style={labelStyle}>Status</label>
              <input value={formData.status === "active" ? "Active" : formData.status} style={inputStyle} disabled />
            </div>
          </div>

          <div className="p-3 rounded-md mb-4" style={{ background: "#F5F5F5", border: "1px solid #E8E2E0" }}>
            <p style={{ fontSize: "0.775rem", color: "#7A6C6A", marginBottom: "0.25rem" }}>
              <strong>Calculated Efficiency:</strong>
            </p>
            <p style={{ fontSize: "1.125rem", fontWeight: 700, color: "#7A6C6A" }}>{unavailable}</p>
            <p style={{ fontSize: "0.7rem", color: "#9A8A88", marginTop: "0.25rem" }}>
              No backend API currently exposes employee-level expected and produced parts.
            </p>
          </div>

          <div className="flex gap-3 justify-end">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-md" style={{ border: "1px solid #E8E2E0", background: "#fff", color: "#4A4A4A", fontSize: "0.875rem" }}>
              Cancel
            </button>
            <button type="submit" className="px-4 py-2 rounded-md" style={{ background: "#A52A2A", color: "#fff", fontSize: "0.875rem", fontWeight: 600, border: "none" }}>
              {mode === "add" ? "Add Employee" : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function WorkforceManagement() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedDept, setSelectedDept] = useState("all");
  const [showFilters, setShowFilters] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState("all");
  const [selectedShift, setSelectedShift] = useState("all");
  const [departments, setDepartments] = useState<DepartmentDto[]>([]);
  const [shifts, setShifts] = useState<ShiftDto[]>([]);
  const [dialogMode, setDialogMode] = useState<"add" | "edit" | null>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getEmployees({ pageSize: 100, status: "all" }),
      getDepartments(),
      getShifts({ pageSize: 100 }).catch(() => ({ data: [] as ShiftDto[] })),
    ]).then(([empRes, deptRes, shiftRes]) => {
      if (cancelled) return;
      setEmployees(empRes.data.map(fromDto));
      setDepartments(deptRes);
      setShifts(shiftRes.data);
      setLoading(false);
    }).catch(() => {
      if (!cancelled) {
        setLoadError("Employee or department data is unavailable.");
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredEmployees = useMemo(
    () =>
      employees.filter((e) =>
        (selectedDept === "all" || String(e.departmentId) === selectedDept) &&
        (selectedStatus === "all" || e.status === selectedStatus) &&
        (selectedShift === "all" || String(e.shiftId) === selectedShift) &&
        (e.name.toLowerCase().includes(search.toLowerCase()) || e.id.toLowerCase().includes(search.toLowerCase())),
      ),
    [employees, search, selectedDept, selectedStatus, selectedShift],
  );

  const activeFilterCount = (selectedStatus !== "all" ? 1 : 0) + (selectedShift !== "all" ? 1 : 0);

  const filterSelectStyle: React.CSSProperties = {
    padding: "0.5rem 0.75rem",
    border: "1px solid #E8E2E0",
    borderRadius: "0.375rem",
    fontSize: "0.8375rem",
    background: "#fff",
    cursor: "pointer",
  };

  const handleAdd = () => {
    setDialogMode("add");
    setSelectedEmployee(null);
  };

  const handleEdit = (emp: Employee) => {
    setDialogMode("edit");
    setSelectedEmployee(emp);
  };

  const handleDelete = async (empId: string) => {
    const emp = employees.find((e) => e.id === empId);
    if (!emp) return;
    if (!confirm("Are you sure you want to delete this employee?")) return;
    try {
      if (emp._backendId) await deleteEmployee(emp._backendId);
      setEmployees((prev) => prev.filter((e) => e.id !== empId));
      toast.success("Employee deleted successfully");
    } catch {
      toast.error("Employee could not be deleted.");
    }
  };

  const handleSave = async (employee: Employee) => {
    const [firstName, ...rest] = employee.name.trim().split(/\s+/);
    try {
      if (dialogMode === "add") {
        const created = await createEmployee({
          employeeCode: employee.id,
          firstName,
          lastName: rest.join(" ") || "-",
          designation: employee.designation,
          joiningDate: employee.joiningDateIso,
          employmentType: "FULL_TIME",
          departmentId: employee.departmentId,
          shiftId: employee.shiftId,
        });
        setEmployees((prev) => [...prev, fromDto(created)]);
        toast.success("Employee added successfully");
      } else {
        if (!employee._backendId) throw new Error("Employee is not linked to the database.");
        const updated = await updateEmployee(employee._backendId, {
          firstName,
          lastName: rest.join(" ") || "-",
          designation: employee.designation,
          joiningDate: employee.joiningDateIso,
        });
        const withDepartment = employee.departmentId !== updated.departmentId
          ? await assignDepartment(updated.id, employee.departmentId)
          : updated;
        const withShift = employee.shiftId !== withDepartment.shiftId
          ? await assignShift(withDepartment.id, employee.shiftId)
          : withDepartment;
        setEmployees((prev) => prev.map((e) => e.id === employee.id ? fromDto(withShift) : e));
        toast.success("Employee updated successfully");
      }
    } catch {
      toast.error("Employee could not be saved.");
    } finally {
      setDialogMode(null);
      setSelectedEmployee(null);
    }
  };

  const handleCloseDialog = () => {
    setDialogMode(null);
    setSelectedEmployee(null);
  };

  return (
    <div>
      {loadError && <p className="mb-4" style={{ color: "#C0392B", fontSize: "0.8375rem" }}>{loadError}</p>}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="flex items-center gap-2 flex-1 min-w-48 px-3 py-2 rounded-md" style={{ background: "#fff", border: "1px solid #E8E2E0" }}>
          <Search size={14} color="#9A8A88" />
          <input
            placeholder="Search by name or ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ border: "none", outline: "none", fontSize: "0.8375rem", flex: 1, background: "transparent" }}
          />
        </div>
        <select
          value={selectedDept}
          onChange={(e) => setSelectedDept(e.target.value)}
          style={filterSelectStyle}
        >
          <option value="all">All Departments</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <Btn size="sm" variant="secondary" onClick={() => setShowFilters((open) => !open)}>
          <Filter size={14} /> Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
        </Btn>
        <Btn size="sm" onClick={handleAdd}><Plus size={14} /> Add Employee</Btn>
      </div>

      {showFilters && (
        <div className="flex flex-wrap items-end gap-3 mb-4 p-3 rounded-md" style={{ background: "#fff", border: "1px solid #E8E2E0" }}>
          <label style={{ fontSize: "0.775rem", fontWeight: 600, color: "#4A4A4A" }}>
            <span style={{ display: "block", marginBottom: "0.3rem" }}>Status</span>
            <select value={selectedStatus} onChange={(e) => setSelectedStatus(e.target.value)} style={filterSelectStyle}>
              <option value="all">All Statuses</option>
              <option value="active">Active</option>
              <option value="on-leave">On Leave</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
          <label style={{ fontSize: "0.775rem", fontWeight: 600, color: "#4A4A4A" }}>
            <span style={{ display: "block", marginBottom: "0.3rem" }}>Shift</span>
            <select value={selectedShift} onChange={(e) => setSelectedShift(e.target.value)} style={filterSelectStyle}>
              <option value="all">All Shifts</option>
              {shifts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <Btn size="sm" variant="ghost" disabled={activeFilterCount === 0} onClick={() => { setSelectedStatus("all"); setSelectedShift("all"); }}>
            Clear filters
          </Btn>
        </div>
      )}

      <Card>
        <DataTable
          searchable
          paginate={10}
          exportFilename="DVS_Employees.csv"
          emptyMsg={loading ? "Loading employee data..." : loadError ? "Employee data unavailable." : "No employee data available."}
          columns={[
            { key: "id", label: "ID" },
            { key: "name", label: "Name" },
            { key: "dept", label: "Dept" },
            { key: "designation", label: "Designation" },
            { key: "shift", label: "Shift" },
            { key: "workingHours", label: "Hours" },
            { key: "attendance", label: "Attendance" },
            { key: "efficiency", label: "Efficiency" },
            { key: "parts", label: "Parts" },
            { key: "status", label: "Status" },
            { key: "actions", label: "Actions" },
          ]}
          rows={filteredEmployees.map((e) => ({
            id: <span style={{ fontSize: "0.775rem", fontFamily: "JetBrains Mono, monospace", color: "#A52A2A" }}>{e.id}</span>,
            name: (
              <div>
                <p style={{ fontWeight: 600, fontSize: "0.8375rem" }}>{e.name}</p>
                <p style={{ fontSize: "0.72rem", color: "#9A8A88" }}>{e.designation}</p>
              </div>
            ),
            dept: e.dept,
            designation: e.designation,
            shift: <span style={{ fontSize: "0.775rem" }}>{e.shift}</span>,
            workingHours: e.dailyWorkingHours === null ? unavailable : `${e.dailyWorkingHours}h`,
            attendance: (
              <span className="px-2 py-0.5 rounded-full" style={{ fontSize: "0.7rem", fontWeight: 600, background: "#F5F5F5", color: "#7A6C6A" }}>
                {unavailable}
              </span>
            ),
            efficiency: <span style={{ color: "#7A6C6A", fontWeight: 600 }}>{unavailable}</span>,
            parts: e.producedParts === null || e.expectedParts === null ? unavailable : `${e.producedParts}/${e.expectedParts}`,
            status: <StatusBadge status={e.status === "active" ? "active" : "neutral"} label={e.status === "active" ? "Active" : e.status} />,
            actions: (
              <div className="flex gap-1.5">
                <button onClick={() => handleEdit(e)} className="p-1.5 rounded" style={{ background: "#F5F0EF", color: "#4E342E" }}>
                  <Edit2 size={12} />
                </button>
                <button onClick={() => handleDelete(e.id)} className="p-1.5 rounded" style={{ background: "#FFEBEE", color: "#C0392B" }}>
                  <Trash2 size={12} />
                </button>
              </div>
            ),
          }))}
        />
      </Card>

      {dialogMode && (
        <EmployeeDialog
          employee={selectedEmployee}
          departments={departments}
          shifts={shifts}
          mode={dialogMode}
          onClose={handleCloseDialog}
          onSave={handleSave}
        />
      )}
    </div>
  );
}
