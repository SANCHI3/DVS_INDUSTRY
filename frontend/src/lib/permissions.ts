/**
 * What each staff role can open and do, mirroring the backend's authorize()
 * lists in backend/src/routes/*.routes.ts. The backend enforces every rule;
 * this map only keeps people away from pages and buttons that would fail.
 * When a route's roles change there, change them here too.
 */

export type StaffRole = "ADMIN" | "MANAGER" | "HR" | "STORE" | "SALES" | "PRODUCTION";

export type Section =
  | "dashboard" | "production" | "workforce" | "security" | "inventory"
  | "orders" | "reports" | "analytics" | "users";

const STAFF_ROLES: readonly StaffRole[] = ["ADMIN", "MANAGER", "HR", "STORE", "SALES", "PRODUCTION"];

function staffRole(role: string | null | undefined): StaffRole | null {
  const upper = (role ?? "").toUpperCase();
  return (STAFF_ROLES as readonly string[]).includes(upper) ? (upper as StaffRole) : null;
}

const is = (role: string | null | undefined, ...roles: StaffRole[]): boolean => {
  const r = staffRole(role);
  return r !== null && roles.includes(r);
};

// ── Sections (sidebar order; the first is where the role lands) ─────────────

const SECTIONS: Record<StaffRole, Section[]> = {
  ADMIN: ["dashboard", "production", "security", "inventory", "orders", "reports", "analytics", "users"],
  MANAGER: ["dashboard", "production", "security", "inventory", "orders", "reports", "analytics"],
  HR: ["workforce", "reports"],
  STORE: ["inventory", "orders", "reports", "analytics"],
  SALES: ["orders"],
  PRODUCTION: ["production", "security", "reports"],
};

export function sectionsFor(role: string | null | undefined): Section[] {
  const r = staffRole(role);
  return r ? SECTIONS[r] : [];
}

/** "security-incidents" → "security"; sub-sections share their parent's access. */
export function baseSection(section: string): string {
  return section.split("-")[0] ?? section;
}

export function canOpen(role: string | null | undefined, section: string): boolean {
  if (section === "profile") return staffRole(role) !== null;
  return (sectionsFor(role) as string[]).includes(baseSection(section));
}

export function defaultSection(role: string | null | undefined): Section | "profile" {
  return sectionsFor(role)[0] ?? "profile";
}

/** Shown in the header and sidebar instead of "Administrator" for everyone. */
export function roleLabel(role: string | null | undefined): string {
  switch ((role ?? "").toUpperCase()) {
    case "ADMIN": return "Administrator";
    case "MANAGER": return "Plant Manager";
    case "HR": return "HR";
    case "STORE": return "Store";
    case "SALES": return "Sales";
    case "PRODUCTION": return "Production";
    case "SUPPLIER": return "Supplier Portal";
    case "CLIENT": return "Client Portal";
    default: return "Staff";
  }
}

// ── Tabs inside sections ─────────────────────────────────────────────────────

export type ProductionTab = "performance" | "workforce" | "attendance";

/** production.routes PROD_READ; employees and attendance from workforce.routes. */
export function productionTabs(role: string | null | undefined, section: "production" | "workforce"): ProductionTab[] {
  if (section === "workforce") return is(role, "ADMIN", "MANAGER", "HR") ? ["workforce", "attendance"] : [];
  if (is(role, "ADMIN", "MANAGER")) return ["performance", "workforce", "attendance"];
  if (is(role, "PRODUCTION")) return ["performance", "workforce"];
  return [];
}

export type AnalyticsTab = "health" | "inventory" | "production" | "suppliers";

/** analytics.routes: STORE_ROLES, PRODUCTION_ROLES, MANAGEMENT_ROLES. */
export function analyticsTabs(role: string | null | undefined): AnalyticsTab[] {
  const tabs: AnalyticsTab[] = [];
  if (is(role, "ADMIN", "MANAGER")) tabs.push("health");
  if (is(role, "ADMIN", "MANAGER", "STORE")) tabs.push("inventory");
  if (is(role, "ADMIN", "MANAGER", "PRODUCTION")) tabs.push("production");
  if (is(role, "ADMIN", "MANAGER", "STORE")) tabs.push("suppliers");
  return tabs;
}

export type ReportId =
  | "production" | "inventory" | "workforce" | "attendance" | "orders"
  | "scrap" | "supplier" | "client" | "security";

/** reports.routes role groups per report. */
export function reportsFor(role: string | null | undefined): ReportId[] {
  const out: ReportId[] = [];
  if (is(role, "ADMIN", "MANAGER", "PRODUCTION")) out.push("production");
  if (is(role, "ADMIN", "MANAGER", "STORE")) out.push("inventory");
  if (is(role, "ADMIN", "MANAGER", "HR")) out.push("workforce", "attendance");
  if (is(role, "ADMIN", "MANAGER")) out.push("orders");
  if (is(role, "ADMIN", "MANAGER", "STORE")) out.push("scrap");
  if (is(role, "ADMIN", "MANAGER")) out.push("supplier", "client");
  if (is(role, "ADMIN", "MANAGER", "PRODUCTION")) out.push("security");
  return out;
}

// ── Actions ──────────────────────────────────────────────────────────────────

/** orders.routes: SALES_WRITE, STORE_WRITE, ADMIN_MGR, portal staff. */
export function orderActions(role: string | null | undefined) {
  return {
    createClientOrder: is(role, "ADMIN", "MANAGER", "SALES"),
    editClientOrder: is(role, "ADMIN", "MANAGER", "SALES"),
    approveClientOrder: is(role, "ADMIN", "MANAGER", "SALES"),
    cancelClientOrder: is(role, "ADMIN", "MANAGER", "SALES"),
    startProduction: is(role, "ADMIN", "MANAGER", "PRODUCTION"),
    /** production.routes PROD_WRITE */
    createWorkOrder: is(role, "ADMIN", "PRODUCTION"),
    dispatchClientOrder: is(role, "ADMIN", "MANAGER", "STORE"),
    deliverClientOrder: is(role, "ADMIN", "MANAGER", "STORE"),
    managePurchaseOrders: is(role, "ADMIN", "MANAGER", "STORE"),
    manageSuppliers: is(role, "ADMIN", "MANAGER", "STORE"),
    manageClients: is(role, "ADMIN", "MANAGER", "SALES"),
    deletePartners: is(role, "ADMIN"),
    viewStatistics: is(role, "ADMIN", "MANAGER"),
    portalMessages: is(role, "ADMIN", "MANAGER", "SALES", "STORE"),
  };
}
export type OrderActions = ReturnType<typeof orderActions>;

/** security.routes: SEC_WRITE (status, assign, notes), SEC_MANAGE (delete). */
export function securityActions(role: string | null | undefined) {
  return {
    manageIncidents: is(role, "ADMIN", "MANAGER"),
    deleteIncidents: is(role, "ADMIN"),
  };
}
export type SecurityActions = ReturnType<typeof securityActions>;

/** inventory.routes: WRITE_ROLES, STOCK_ROLES, REPORT_ROLES, ADMIN_ONLY. */
export function inventoryActions(role: string | null | undefined) {
  return {
    editMaterials: is(role, "ADMIN", "STORE"),
    deleteMaterials: is(role, "ADMIN"),
    moveStock: is(role, "ADMIN", "STORE", "PRODUCTION"),
    recordScrap: is(role, "ADMIN", "STORE", "PRODUCTION"),
    editParts: is(role, "ADMIN", "STORE"),
    viewStatistics: is(role, "ADMIN", "MANAGER", "STORE"),
  };
}
export type InventoryActions = ReturnType<typeof inventoryActions>;
