import { useState, useEffect } from "react";
import { Plus, Edit2, Trash2, Shield, Search } from "lucide-react";
import { PageHeader, Card, CardHeader, StatusBadge, Btn, DataTable } from "../shared/UI";
import { toast } from "sonner";
import { isApiError } from "../../../lib/api";
import { deactivateUser, getRoles, getUsers, registerUser, updateUser, type RoleDto, type UserDto } from "../../../lib/services/users.service";
import { getAuditLogs } from "../../../lib/services/audit.service";
import { Modal } from "../shared/Modal";

type IconProps = { size?: number; color?: string };
const PlusIcon = Plus as unknown as (props: IconProps) => JSX.Element;
const EditIcon = Edit2 as unknown as (props: IconProps) => JSX.Element;
const TrashIcon = Trash2 as unknown as (props: IconProps) => JSX.Element;
const ShieldIcon = Shield as unknown as (props: IconProps) => JSX.Element;
const SearchIcon = Search as unknown as (props: IconProps) => JSX.Element;

interface User {
  id: string; name: string; email: string; role: string; dept: string;
  joined: string; lastLogin: string; status: string;
  _apiId?: number; _roleId?: number;
}

const roleColors: Record<string, string> = {
  admin: "#A52A2A", manager: "#6A1B9A", hr: "#AD1457", production: "#E65100",
  store: "#1565C0", sales: "#00838F", supplier: "#2E7D32", client: "#1565C0",
};

const permissions = [
  { role: "Admin", perms: ["Full system access", "User management", "Security monitoring", "Reports generation", "Order management", "Settings control"] },
  { role: "Supplier", perms: ["Material catalog management", "Purchase order management", "Delivery tracking", "Invoice upload", "Performance view", "Communication"] },
  { role: "Client", perms: ["Product catalog browse", "Order placement", "Order tracking", "Invoice access", "Support ticket", "Delivery confirmation"] },
];

const departments = ["Management", "Operations", "Security", "Production", "Quality", "Inventory", "Finance", "Steel", "Aluminium", "Copper", "Automotive", "Engineering"];

const fieldStyle: React.CSSProperties = { width: "100%", padding: "0.5rem 0.75rem", border: "1px solid #E8E2E0", borderRadius: "0.4rem", fontSize: "0.8375rem", outline: "none", background: "#fff" };
const labelStyle: React.CSSProperties = { fontSize: "0.72rem", fontWeight: 600, color: "#4E342E", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: "0.3rem" };

export function UserManagementPage() {
  const [activeTab, setActiveTab]   = useState<"users" | "permissions" | "logs">("users");
  const [search, setSearch]         = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles]           = useState<RoleDto[]>([]);
  const [auditLogs, setAuditLogs]   = useState<Array<{ time: string; user: string; action: string; type: string }>>([]);
  const [dataError, setDataError]   = useState("");
  const [showAdd, setShowAdd]       = useState(false);
  const [editUser, setEditUser]     = useState<User | null>(null);
  const [deleteUser, setDeleteUser] = useState<User | null>(null);
  const [creatingUser, setCreatingUser] = useState(false);
  const [newUser, setNewUser]       = useState({ name: "", email: "", password: "", role: "admin", roleId: 1, dept: "Management", status: "active" });

  const mapUsers = (items: UserDto[]): User[] => items.map((user) => ({
    id: String(user.id),
    name: user.fullName,
    email: user.email,
    role: user.role.name.toLowerCase(),
    dept: "-",
    joined: new Date(user.createdAt).toLocaleDateString("en-IN"),
    lastLogin: user.lastLogin ? new Date(user.lastLogin).toLocaleString("en-IN") : "Never",
    status: user.isActive ? "active" : "inactive",
    _apiId: user.id,
    _roleId: user.role.id,
  }));

  const refreshUsers = async () => setUsers(mapUsers(await getUsers()));

  // ── Load from API ──────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([
      getRoles(),
      getUsers(),
      getAuditLogs({ pageSize: 20, sortOrder: "desc" }),
    ]).then(([roleResult, userResult, logResult]) => {
      if (cancelled) return;
      if (roleResult.status === "fulfilled") setRoles(roleResult.value);
      else setDataError("Unable to load backend roles. API error: " + (roleResult.reason instanceof Error ? roleResult.reason.message : "Unknown error"));
      if (userResult.status === "fulfilled") {
        setUsers(mapUsers(userResult.value));
      } else setDataError((current) => current ? `${current} User API error: ${userResult.reason instanceof Error ? userResult.reason.message : "Unknown error"}` : "Unable to load users. API error: " + (userResult.reason instanceof Error ? userResult.reason.message : "Unknown error"));
      if (logResult.status === "fulfilled") {
        setAuditLogs(logResult.value.data.map(l => ({
          time: new Date(l.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
          user: l.userEmail ?? "System",
          action: `${l.action} ${l.entity}${l.entityId ? ` #${l.entityId}` : ""} ${l.path ?? ""}`.trim(),
          type: l.action === "LOGIN" ? "info" : l.action === "DELETE" ? "critical" : l.statusCode && l.statusCode >= 400 ? "warn" : "info",
        })));
      } else setDataError((current) => current ? `${current} Audit log API error: ${logResult.reason instanceof Error ? logResult.reason.message : "Unknown error"}` : "Unable to load audit logs. API error: " + (logResult.reason instanceof Error ? logResult.reason.message : "Unknown error"));
    });
    return () => { cancelled = true; };
  }, []);

  const handleAdd = async () => {
    const selectedRole = roles.find((role) => role.name.toLowerCase() === newUser.role);
    if (!newUser.name.trim() || !newUser.email.trim() || !newUser.password || !selectedRole) {
      toast.error("Complete all account fields before adding the user.");
      return;
    }

    const normalizedEmail = newUser.email.trim().toLowerCase();
    if (users.some((user) => user.email.toLowerCase() === normalizedEmail)) {
      toast.error("An account with this email already exists. Use a different email address.");
      return;
    }

    if (creatingUser) return;
    setCreatingUser(true);

    try {
      await registerUser({
        fullName: newUser.name.trim(),
        email: normalizedEmail,
        password: newUser.password,
        roleId: selectedRole.id,
      });
      toast.success("User account created successfully.");
      setShowAdd(false);
      setNewUser({ name: "", email: "", password: "", role: "admin", roleId: 1, dept: "Management", status: "active" });
      await refreshUsers();
    } catch (error) {
      const message = isApiError(error)
        ? error.status === 409
          ? "An account with this email already exists. Use a different email address."
          : error.message
        : error instanceof Error
          ? error.message
          : "Unable to create user account.";
      toast.error(message);
    } finally {
      setCreatingUser(false);
    }
  };

  const handleEdit = async () => {
    if (!editUser) return;
    const selectedRole = roles.find((role) => role.name.toLowerCase() === editUser.role);
    if (!editUser._apiId || !selectedRole || !editUser.name.trim() || !editUser.email.trim()) {
      toast.error("Complete the user details before saving.");
      return;
    }
    try {
      await updateUser(editUser._apiId, { fullName: editUser.name.trim(), email: editUser.email.trim(), roleId: selectedRole.id });
      toast.success("User updated successfully.");
      setEditUser(null);
      await refreshUsers();
    } catch (error) {
      toast.error(isApiError(error) || error instanceof Error ? error.message : "Unable to update user.");
    }
  };

  const handleDelete = async () => {
    if (!deleteUser) return;
    if (!deleteUser._apiId) return;
    try {
      await deactivateUser(deleteUser._apiId);
      toast.success("User deactivated successfully.");
      setDeleteUser(null);
      await refreshUsers();
    } catch (error) {
      toast.error(isApiError(error) || error instanceof Error ? error.message : "Unable to deactivate user.");
    }
  };

  const filtered = users.filter(
    u => (roleFilter === "all" || u.role === roleFilter) && (u.name.toLowerCase().includes(search.toLowerCase()) || u.email.includes(search))
  );

  return (
    <>
    {showAdd && (
      <Modal title="Add New User" onClose={() => setShowAdd(false)} size="md">
        <div className="space-y-4">
          <div><label style={labelStyle}>Full Name</label><input style={fieldStyle} value={newUser.name} onChange={(e) => setNewUser({ ...newUser, name: e.target.value })} placeholder="e.g. Arjun Mehta" /></div>
          <div><label style={labelStyle}>Email Address</label><input style={fieldStyle} type="email" value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} placeholder="arjun@dvsindustries.com" /></div>
          <div><label style={labelStyle}>Password</label><input style={fieldStyle} type="password" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} placeholder="Min 8 characters" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label style={labelStyle}>Role</label>
              <select style={fieldStyle} value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}>
                {roles.map(r => <option key={r.id} value={r.name.toLowerCase()}>{r.name}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Status</label>
              <select style={fieldStyle} value={newUser.status} onChange={(e) => setNewUser({ ...newUser, status: e.target.value })}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>
          <div>
            <label style={labelStyle}>Department</label>
            <select style={fieldStyle} value={newUser.dept} onChange={(e) => setNewUser({ ...newUser, dept: e.target.value })}>
              {departments.map((d) => <option key={d}>{d}</option>)}
            </select>
          </div>
          <div className="flex gap-2 pt-2">
            <button onClick={() => setShowAdd(false)} style={{ flex: 1, padding: "0.6rem", border: "1px solid #E8E2E0", borderRadius: "0.5rem", background: "#fff", cursor: "pointer" }}>Cancel</button>
            <button onClick={handleAdd} disabled={creatingUser} style={{ flex: 2, padding: "0.6rem", border: "none", borderRadius: "0.5rem", background: creatingUser ? "#C9A09A" : "#A52A2A", color: "#fff", fontWeight: 600, cursor: creatingUser ? "wait" : "pointer" }}>
              {creatingUser ? "Creating..." : "Add User"}
            </button>
          </div>
        </div>
      </Modal>
    )}

    {editUser && (
      <Modal title={`Edit User — ${editUser.id}`} onClose={() => setEditUser(null)} size="md">
        <div className="space-y-4">
          <div><label style={labelStyle}>Full Name</label><input style={fieldStyle} value={editUser.name} onChange={(e) => setEditUser({ ...editUser, name: e.target.value })} /></div>
          <div><label style={labelStyle}>Email Address</label><input style={fieldStyle} value={editUser.email} onChange={(e) => setEditUser({ ...editUser, email: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label style={labelStyle}>Role</label>
              <select style={fieldStyle} value={editUser.role} onChange={(e) => setEditUser({ ...editUser, role: e.target.value })}>
                {roles.map((role) => <option key={role.id} value={role.name.toLowerCase()}>{role.name}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Status</label>
              <select style={fieldStyle} value={editUser.status} onChange={(e) => setEditUser({ ...editUser, status: e.target.value })}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>
          <div>
            <label style={labelStyle}>Department</label>
            <select style={fieldStyle} value={editUser.dept} onChange={(e) => setEditUser({ ...editUser, dept: e.target.value })}>
              {departments.map((d) => <option key={d}>{d}</option>)}
            </select>
          </div>
          <div className="flex gap-2 pt-2">
            <button onClick={() => setEditUser(null)} style={{ flex: 1, padding: "0.6rem", border: "1px solid #E8E2E0", borderRadius: "0.5rem", background: "#fff", cursor: "pointer" }}>Cancel</button>
            <button onClick={handleEdit} style={{ flex: 2, padding: "0.6rem", border: "none", borderRadius: "0.5rem", background: "#4E342E", color: "#fff", fontWeight: 600, cursor: "pointer" }}>Save Changes</button>
          </div>
        </div>
      </Modal>
    )}

    {deleteUser && (
      <Modal title="Confirm Deactivation" onClose={() => setDeleteUser(null)} size="md">
        <div>
          <div className="p-4 rounded-lg mb-4" style={{ background: "#FFEBEE", border: "1px solid #FFCDD2" }}>
            <p style={{ fontSize: "0.8rem", color: "#7A6C6A" }}><strong>{deleteUser.name}</strong> will no longer be able to log in. Their records are kept.</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setDeleteUser(null)} style={{ flex: 1, padding: "0.6rem", border: "1px solid #E8E2E0", borderRadius: "0.5rem", background: "#fff", cursor: "pointer" }}>Cancel</button>
            <button onClick={handleDelete} style={{ flex: 1, padding: "0.6rem", border: "none", borderRadius: "0.5rem", background: "#C0392B", color: "#fff", fontWeight: 600, cursor: "pointer" }}>Deactivate User</button>
          </div>
        </div>
      </Modal>
    )}

    <div className="p-6">
      <PageHeader
        title="User Management"
        subtitle="Manage admin, supplier, and client accounts with role-based access control"
        actions={<Btn size="sm" onClick={() => setShowAdd(true)}><PlusIcon size={14} /> Add User</Btn>}
      />

      {dataError && <p className="mb-4" style={{ color: "#C0392B", fontSize: "0.8125rem" }}>{dataError}</p>}

      <div className="flex gap-0 mb-5" style={{ borderBottom: "2px solid #E8E2E0" }}>
        {([["users", "All Users"], ["permissions", "Permissions"], ["logs", "Audit Logs"]] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            style={{
              padding: "0.625rem 1rem", fontSize: "0.8375rem",
              fontWeight: activeTab === id ? 600 : 400,
              color: activeTab === id ? "#A52A2A" : "#7A6C6A",
              borderBottom: `2px solid ${activeTab === id ? "#A52A2A" : "transparent"}`,
              marginBottom: "-2px", background: "transparent", border: "none", cursor: "pointer",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === "users" && (
        <div>
          <div className="flex flex-wrap gap-3 mb-4">
            <div className="flex items-center gap-2 flex-1 min-w-48 px-3 py-2 rounded-md" style={{ background: "#fff", border: "1px solid #E8E2E0" }}>
              <SearchIcon size={14} color="#9A8A88" />
              <input
                placeholder="Search users..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ border: "none", outline: "none", fontSize: "0.8375rem", flex: 1, background: "transparent" }}
              />
            </div>
            <div className="flex gap-1">
              {["all", "admin", "manager", "hr", "production", "store", "sales", "supplier", "client"].map((r) => (
                <button
                  key={r}
                  onClick={() => setRoleFilter(r)}
                  style={{
                    padding: "0.375rem 0.75rem", borderRadius: "0.35rem", fontSize: "0.775rem",
                    background: roleFilter === r ? "#A52A2A" : "#fff", color: roleFilter === r ? "#fff" : "#4A4A4A",
                    border: `1px solid ${roleFilter === r ? "#A52A2A" : "#E8E2E0"}`, cursor: "pointer", textTransform: "capitalize",
                  }}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          <Card>
            <div className="p-5" style={{ color: "#7A6C6A", fontSize: "0.8375rem" }}>
              New accounts are created by administrators and protected by role-based access control.
            </div>
            <DataTable
              searchable
              paginate={10}
              exportFilename="DVS_Users.csv"
              columns={[
                { key: "id", label: "User ID" },
                { key: "name", label: "Name / Email" },
                { key: "role", label: "Role" },
                { key: "dept", label: "Department" },
                { key: "joined", label: "Joined" },
                { key: "lastLogin", label: "Last Login" },
                { key: "status", label: "Status" },
                { key: "actions", label: "Actions" },
              ]}
              rows={filtered.map((u) => ({
                id: <span style={{ fontSize: "0.72rem", fontFamily: "JetBrains Mono, monospace", color: "#7A6C6A" }}>{u.id}</span>,
                name: (
                  <div>
                    <p style={{ fontWeight: 600, fontSize: "0.8375rem" }}>{u.name}</p>
                    <p style={{ fontSize: "0.72rem", color: "#9A8A88" }}>{u.email}</p>
                  </div>
                ),
                role: (
                  <span className="px-2.5 py-1 rounded-full" style={{ fontSize: "0.72rem", fontWeight: 600, background: `${roleColors[u.role]}12`, color: roleColors[u.role], textTransform: "capitalize" }}>
                    {u.role}
                  </span>
                ),
                dept: u.dept,
                joined: u.joined,
                lastLogin: <span style={{ fontSize: "0.775rem" }}>{u.lastLogin}</span>,
                status: <StatusBadge status={u.status} />,
                actions: (
                  <div className="flex gap-1.5">
                    <button onClick={() => setEditUser({ ...u })} className="p-1.5 rounded" style={{ background: "#F5F0EF", color: "#4E342E", cursor: "pointer", border: "none" }}><EditIcon size={12} /></button>
                    <button onClick={() => setDeleteUser(u)} disabled={u.status !== "active"} title={u.status === "active" ? "Deactivate User" : "Already deactivated"} aria-label={`Deactivate ${u.name}`} className="p-1.5 rounded" style={{ background: "#FFEBEE", color: "#C0392B", cursor: u.status === "active" ? "pointer" : "not-allowed", opacity: u.status === "active" ? 1 : 0.4, border: "none" }}><TrashIcon size={12} /></button>
                  </div>
                ),
              }))}
            />
          </Card>
        </div>
      )}

      {activeTab === "permissions" && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {permissions.map((p) => (
            <Card key={p.role}>
              <CardHeader
                title={`${p.role} Permissions`}
                actions={
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${roleColors[p.role.toLowerCase()]}12` }}>
                    <ShieldIcon size={14} color={roleColors[p.role.toLowerCase()] ?? "#7A6C6A"} />
                  </div>
                }
              />
              <div className="p-5">
                {p.perms.map((perm) => (
                  <div key={perm} className="flex items-center gap-2 mb-2.5">
                    <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: roleColors[p.role.toLowerCase()] ?? "#7A6C6A" }} />
                    <span style={{ fontSize: "0.8375rem", color: "#4A4A4A" }}>{perm}</span>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}

      {activeTab === "logs" && (
        <Card>
          <CardHeader title="Audit Logs" subtitle="Recent system activity" />
          <div>
            {(auditLogs.length > 0 ? auditLogs : []).map((log, i) => (
              <div key={i} className="flex items-start gap-4 px-5 py-3.5" style={{ borderBottom: "1px solid #F7F3F2" }}>
                <span style={{ fontSize: "0.72rem", fontFamily: "JetBrains Mono, monospace", color: "#9A8A88", minWidth: "40px" }}>{log.time}</span>
                <div className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0" style={{ background: log.type === "critical" ? "#C0392B" : log.type === "warn" ? "#E65100" : "#2E7D32" }} />
                <div>
                  <p style={{ fontSize: "0.8125rem", fontWeight: 500 }}>{log.user}</p>
                  <p style={{ fontSize: "0.775rem", color: "#7A6C6A" }}>{log.action}</p>
                </div>
              </div>
            ))}
            {auditLogs.length === 0 && <p className="p-5" style={{ color: "#7A6C6A", fontSize: "0.8125rem" }}>No audit logs available.</p>}
          </div>
        </Card>
      )}
    </div>
    </>
  );
}
