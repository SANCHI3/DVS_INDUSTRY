import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useERP, type ERPNotification } from "../admin/ERPContext";
import type { PortalNotification } from "../../../lib/portalInsights";
import { AskDvs } from "./AskDvs";
import { getStoredBackendRole } from "../../../lib/auth";
import { baseSection, canOpen, roleLabel, sectionsFor } from "../../../lib/permissions";
import {
  getNotifications, markNotificationsSeen, searchRecords, sectionForResult,
  type SearchResult, type StaffNotification,
} from "../../../lib/services/topbar.service";
import {
  LayoutDashboard, Factory, Shield, Package, ShoppingCart, BarChart3, UserCircle, LogOut,
  Menu, X, Bell, Search, Cpu, Building2, Truck, UserCheck, FileText, MessageSquare, Star,
  ShoppingBag, MapPin, Headphones, Sparkles, Users,
} from "lucide-react";

export type UserRole = "admin" | "supplier" | "client";
export type SystemUserRole = "admin" | "production" | "store";

interface NavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  children?: { id: string; label: string }[];
}

// Every staff section; each role sees the ones lib/permissions.ts allows
const staffNavItems: Record<string, NavItem> = {
  dashboard: { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  production: { id: "production", label: "Production", icon: Factory },
  workforce: { id: "workforce", label: "Workforce", icon: Users },
  security: { id: "security", label: "AI Security", icon: Shield },
  inventory: { id: "inventory", label: "Inventory", icon: Package },
  orders: { id: "orders", label: "Orders & Supply", icon: ShoppingCart },
  reports: { id: "reports", label: "Reports Center", icon: BarChart3 },
  analytics: { id: "analytics", label: "Smart Analytics", icon: Sparkles },
  users: { id: "users", label: "User Management", icon: UserCheck },
};

/** Sidebar for a staff login: its allowed sections, then My Profile. */
export function staffNavigation(backendRole: string | null): NavItem[] {
  return [
    ...sectionsFor(backendRole).map((id) => staffNavItems[id]!),
    { id: "profile", label: "My Profile", icon: UserCircle },
  ];
}

const supplierNav: NavItem[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "catalog", label: "Material Catalog", icon: Package },
  { id: "purchase-orders", label: "Purchase Orders", icon: FileText },
  { id: "delivery", label: "Delivery Management", icon: Truck },
  { id: "communication", label: "Communication", icon: MessageSquare },
  { id: "performance", label: "My Performance", icon: Star },
  { id: "reports", label: "Reports", icon: BarChart3 },
];

const clientNav: NavItem[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "catalog", label: "Product Catalog", icon: ShoppingBag },
  { id: "orders", label: "Order Management", icon: ShoppingCart },
  { id: "tracking", label: "Shipment Tracking", icon: MapPin },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "support", label: "Support Center", icon: Headphones },
  { id: "reports", label: "Reports", icon: BarChart3 },
];

const navByRole: Record<"supplier" | "client", NavItem[]> = {
  supplier: supplierNav,
  client: clientNav,
};

const roleLabels: Record<UserRole | SystemUserRole, string> = {
  admin: "Administrator",
  production: "Production",
  store: "Store",
  supplier: "Supplier Portal",
  client: "Client Portal",
};

const roleColors: Record<UserRole, string> = {
  admin: "#A52A2A",
  supplier: "#2E7D32",
  client: "#1565C0",
};

const SEARCH_KIND_LABEL: Record<SearchResult["kind"], string> = {
  employee: "Employee",
  "work-order": "Work order",
  "client-order": "Client order",
  "purchase-order": "Purchase order",
  material: "Material",
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

interface AppShellProps {
  role: UserRole;
  /** @deprecated Staff access comes from the signed-in user's backend role. */
  userRole?: SystemUserRole;
  /** Name for the sidebar card: the user (admin roles) or the company (portals). */
  userName?: string | undefined;
  /** Supplier/client portals: notifications derived from their own orders and messages. */
  portalNotifications?: PortalNotification[];
  activeSection: string;
  onSectionChange: (section: string) => void;
  /** When set, the sidebar user card opens the user's profile. */
  onOpenProfile?: () => void;
  onLogout: () => void;
  children: ReactNode;
}

const SEEN_KEY = "dvs_portal_notifications_seen";

function readSeen(role: string): string {
  try { return localStorage.getItem(`${SEEN_KEY}:${role}`) ?? ""; } catch { return ""; }
}

function relativeTime(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function AppShell({ role, userName, portalNotifications, activeSection, onSectionChange, onOpenProfile, onLogout, children }: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [showNotifs, setShowNotifs] = useState(false);
  const erp = useERP();
  const isStaff = role === "admin";
  const [staffFeed, setStaffFeed] = useState<StaffNotification[]>([]);
  useEffect(() => {
    if (!isStaff) return;
    let cancelled = false;
    const load = () => { getNotifications().then((feed) => { if (!cancelled) setStaffFeed(feed.items); }).catch(() => {}); };
    load();
    const timer = window.setInterval(load, 120_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [isStaff]);
  // Portal notifications count as read once the bell was opened after them
  const [portalSeen, setPortalSeen] = useState(() => readSeen(role));
  const notifications: Array<ERPNotification & { section?: string }> = useMemo(() => {
    if (portalNotifications !== undefined) {
      return portalNotifications.map((n) => ({ id: n.id, msg: n.msg, type: n.type, time: relativeTime(n.at), read: n.at <= portalSeen }));
    }
    if (isStaff) {
      return staffFeed.map((n) => ({
        id: n.id, msg: n.message, type: n.severity, time: relativeTime(n.at), read: !n.unread, section: n.section,
      }));
    }
    return erp.notifications;
  }, [portalNotifications, erp.notifications, portalSeen, isStaff, staffFeed]);
  const unreadCount = portalNotifications === undefined && !isStaff ? erp.unreadCount : notifications.filter((n) => !n.read).length;
  const markAllRead = () => {
    if (isStaff && portalNotifications === undefined) {
      if (staffFeed.some((n) => n.unread)) {
        setStaffFeed((feed) => feed.map((n) => ({ ...n, unread: false })));
        void markNotificationsSeen().catch(() => {});
      }
      return;
    }
    if (portalNotifications === undefined) { erp.markAllRead(); return; }
    const now = new Date().toISOString();
    setPortalSeen(now);
    try { localStorage.setItem(`${SEEN_KEY}:${role}`, now); } catch { /* storage blocked */ }
  };
  
  const backendRole = getStoredBackendRole();
  const nav = role === "admin" ? staffNavigation(backendRole) : navByRole[role];
  const accentColor = roleColors[role];
  const searchResults = searchQuery.length >= 2 ? nav.filter((n) => n.label.toLowerCase().includes(searchQuery.toLowerCase())) : [];
  const [recordResults, setRecordResults] = useState<SearchResult[]>([]);
  useEffect(() => {
    const q = searchQuery.trim();
    if (!isStaff || q.length < 2) { setRecordResults([]); return; }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      searchRecords(q).then((rows) => { if (!cancelled) setRecordResults(rows); }).catch(() => { if (!cancelled) setRecordResults([]); });
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [searchQuery, isStaff]);
  const displayRoleLabel = role === "admin" ? roleLabel(backendRole) : roleLabels[role];

  const handleNavClick = (item: NavItem) => {
    // For flat navigation (admin), just navigate directly
    onSectionChange(item.id);
    setMobileSidebarOpen(false);
  };

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div
        className="flex items-center gap-3 px-5 py-4"
        style={{ borderBottom: "1px solid #E8E2E0" }}
      >
        <div
          className="w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0"
          style={{ background: accentColor }}
        >
          {role === "admin" ? <Cpu size={15} color="#fff" /> : role === "supplier" ? <Truck size={15} color="#fff" /> : <Building2 size={15} color="#fff" />}
        </div>
        {sidebarOpen && (
          <div>
            <div style={{ fontSize: "0.8rem", fontWeight: 700, color: "#1C1C1C", letterSpacing: "0.04em" }}>DVS INDUSTRIES</div>
            <div style={{ fontSize: "0.65rem", color: accentColor, letterSpacing: "0.06em" }}>{displayRoleLabel.toUpperCase()}</div>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {nav.map((item) => {
          const Icon = item.icon;
          const isActive = baseSection(activeSection) === item.id;

          return (
            <div key={item.id}>
              <button
                onClick={() => handleNavClick(item)}
                className={`${isActive ? "" : "hover-tint "}w-full flex items-center gap-3 px-3 py-2.5 rounded-md mb-0.5 transition-all duration-150`}
                style={{
                  background: isActive ? accentColor : "transparent",
                  color: isActive ? "#fff" : "#4A4A4A",
                }}
              >
                <Icon size={17} className="flex-shrink-0" />
                {sidebarOpen && (
                  <span style={{ fontSize: "0.8625rem", fontWeight: 500, flex: 1, textAlign: "left" }}>{item.label}</span>
                )}
              </button>
            </div>
          );
        })}
      </nav>

      {/* User + Logout */}
      <div className="px-3 py-4" style={{ borderTop: "1px solid #E8E2E0" }}>
        {sidebarOpen && (() => {
          const cardName = userName || (role === "admin" ? "My account" : role === "supplier" ? "Supplier account" : "Client account");
          const badge = role === "admin" ? (initials(userName ?? "") || "AD") : role === "supplier" ? "SP" : "CL";
          const content = (
            <>
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ background: accentColor }}
              >
                <span style={{ fontSize: "0.75rem", color: "#fff", fontWeight: 600 }}>{badge}</span>
              </div>
              <div className="min-w-0 text-left">
                <div className="truncate" style={{ fontSize: "0.8rem", fontWeight: 600, color: "#1C1C1C" }}>{cardName}</div>
                <div style={{ fontSize: "0.7rem", color: "#7A6C6A" }}>{onOpenProfile ? "View my profile" : displayRoleLabel}</div>
              </div>
            </>
          );
          return onOpenProfile ? (
            <button
              onClick={() => { onOpenProfile(); setMobileSidebarOpen(false); }}
              title="Open My Profile" aria-label="Open My Profile"
              className="hover-tint-strong w-full flex items-center gap-3 px-3 py-2 mb-2 rounded-md transition-all duration-150"
              style={{ background: activeSection === "profile" ? "#EFE4E1" : "#F5F0EF", border: "none", cursor: "pointer" }}
            >
              {content}
            </button>
          ) : (
            <div className="flex items-center gap-3 px-3 py-2 mb-2 rounded-md" style={{ background: "#F5F0EF" }}>{content}</div>
          );
        })()}
        <button
          onClick={onLogout}
          className="hover-danger-tint w-full flex items-center gap-3 px-3 py-2.5 rounded-md transition-all duration-150"
          style={{ color: "#C0392B" }}
        >
          <LogOut size={16} />
          {sidebarOpen && <span style={{ fontSize: "0.8625rem" }}>Sign Out</span>}
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "#FAFAFA" }}>
      {/* Desktop Sidebar */}
      <aside
        className="hidden md:flex flex-col flex-shrink-0 transition-all duration-200"
        style={{
          width: sidebarOpen ? "220px" : "60px",
          background: "#FFFFFF",
          borderRight: "1px solid #E8E2E0",
          boxShadow: "2px 0 8px rgba(0,0,0,0.04)",
        }}
      >
        <SidebarContent />
      </aside>

      {/* Mobile Sidebar Overlay */}
      {mobileSidebarOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div className="fixed inset-0 bg-black/40" onClick={() => setMobileSidebarOpen(false)} />
          <aside className="relative w-64 h-full flex flex-col" style={{ background: "#fff" }}>
            <SidebarContent />
          </aside>
        </div>
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header
          className="flex items-center gap-4 px-6 py-3 flex-shrink-0"
          style={{
            background: "#FFFFFF",
            borderBottom: "1px solid #E8E2E0",
            boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
          }}
        >
          <button
            onClick={() => { setSidebarOpen(!sidebarOpen); setMobileSidebarOpen(!mobileSidebarOpen); }}
            className="hover-tint p-2 rounded-md transition-colors"
            style={{ color: "#4A4A4A" }}
          >
            {mobileSidebarOpen ? <X size={18} /> : <Menu size={18} />}
          </button>

          {/* Search */}
          <div className="relative flex items-center gap-2 flex-1 max-w-md px-3 py-2 rounded-md" style={{ background: "#F5F0EF" }}>
            <Search size={15} color="#9A8A88" />
            <input
              placeholder={isStaff ? "Search pages, people, orders, materials…" : "Search pages…"}
              aria-label="Search"
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setShowSearchResults(true); }}
              onBlur={() => setTimeout(() => setShowSearchResults(false), 150)}
              onFocus={() => setShowSearchResults(true)}
              style={{ background: "transparent", border: "none", outline: "none", fontSize: "0.8375rem", color: "#1C1C1C", flex: 1 }}
            />
            {searchQuery && (
              <button onClick={() => { setSearchQuery(""); setShowSearchResults(false); }} style={{ background: "none", border: "none", cursor: "pointer", color: "#9A8A88", display: "flex" }}>
                <X size={13} />
              </button>
            )}
            {showSearchResults && (searchResults.length > 0 || recordResults.length > 0) && (
              <div className="absolute top-full left-0 right-0 mt-1 rounded-md overflow-hidden z-50" style={{ background: "#fff", border: "1px solid #E8E2E0", boxShadow: "0 8px 24px rgba(0,0,0,0.12)" }}>
                {recordResults.map((hit) => (
                  <button key={`${hit.kind}-${hit.id}`} onMouseDown={() => { onSectionChange(sectionForResult(hit.kind, (s) => canOpen(backendRole, s))); setSearchQuery(""); setShowSearchResults(false); }}
                    className="w-full flex flex-col px-4 py-2 transition-colors hover:bg-[#F5F0EF]"
                    style={{ background: "transparent", border: "none", cursor: "pointer", textAlign: "left" }}>
                    <span style={{ fontSize: "0.8375rem", color: "#1C1C1C", fontWeight: 600 }}>{hit.title}</span>
                    <span style={{ fontSize: "0.72rem", color: "#7A6C6A" }}>{SEARCH_KIND_LABEL[hit.kind]} · {hit.subtitle}</span>
                  </button>
                ))}
                {searchResults.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button key={item.id} onMouseDown={() => { onSectionChange(item.id); setSearchQuery(""); setShowSearchResults(false); }}
                      className="hover-tint w-full flex items-center gap-3 px-4 py-2.5 transition-colors"
                      style={{ background: "transparent", border: "none", cursor: "pointer", textAlign: "left" }}>
                      <Icon size={15} color="#A52A2A" />
                      <span style={{ fontSize: "0.8375rem", color: "#1C1C1C" }}>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex items-center gap-3 ml-auto">
            {/* Ask DVS assistant: staff apps only (admin, production, store) */}
            {role === "admin" && <AskDvs backendRole={getStoredBackendRole() ?? "STORE"} />}

            {/* Notifications */}
            <div className="relative">
              <button
                aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
                aria-expanded={showNotifs}
                onClick={() => { setShowNotifs(!showNotifs); if (!showNotifs) markAllRead(); }}
                className="hover-tint relative p-2 rounded-md transition-colors"
                style={{ color: "#4A4A4A" }}
              >
                <Bell size={18} />
                {unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full flex items-center justify-center"
                    style={{ background: "#A52A2A", fontSize: "0.6rem", color: "#fff", fontWeight: 700 }}>
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </button>
              {showNotifs && (
                <div className="absolute right-0 top-full mt-2 w-80 rounded-xl overflow-hidden z-50"
                  style={{ background: "#fff", border: "1px solid #E8E2E0", boxShadow: "0 12px 40px rgba(0,0,0,0.15)" }}>
                  <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid #F0ECEB" }}>
                    <span style={{ fontSize: "0.875rem", fontWeight: 700, color: "#1C1C1C" }}>Notifications</span>
                    <button onClick={() => setShowNotifs(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "#9A8A88", display: "flex" }}>
                      <X size={16} />
                    </button>
                  </div>
                  <div style={{ maxHeight: "320px", overflowY: "auto" }}>
                    {notifications.length === 0 ? (
                      <p style={{ padding: "2rem", textAlign: "center", color: "#9A8A88", fontSize: "0.8rem" }}>Nothing needs your attention right now.</p>
                    ) : (
                      notifications.slice(0, 10).map((n) => (
                        <button key={n.id} type="button" disabled={!n.section}
                          onClick={() => { if (n.section) { onSectionChange(n.section); setShowNotifs(false); } }}
                          className="w-full flex items-start gap-3 px-4 py-3 text-left"
                          style={{ borderBottom: "1px solid #F7F3F2", background: n.read ? "transparent" : "#FDFBFB", opacity: n.read ? 0.75 : 1, border: "none", cursor: n.section ? "pointer" : "default" }}>
                          <div className="w-2 h-2 rounded-full flex-shrink-0 mt-1.5" style={{ background: n.type === "critical" ? "#C0392B" : n.type === "warn" ? "#E65100" : n.type === "success" ? "#2E7D32" : "#1565C0" }} />
                          <div className="flex-1 min-w-0">
                            <p style={{ fontSize: "0.775rem", color: "#1C1C1C", lineHeight: 1.45 }}>{n.msg}</p>
                            <p style={{ fontSize: "0.68rem", color: "#9A8A88", marginTop: "0.2rem" }}>{n.time}</p>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Role badge */}
            <div
              className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full"
              style={{ background: `${accentColor}12`, border: `1px solid ${accentColor}30` }}
            >
              <div className="w-2 h-2 rounded-full" style={{ background: accentColor }} />
              <span style={{ fontSize: "0.75rem", color: accentColor, fontWeight: 600 }}>{displayRoleLabel}</span>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}