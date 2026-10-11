import type { LucideIcon } from "lucide-react";
import { useState, ReactNode } from "react";
import { useERP } from "../admin/ERPContext";
import {
  LayoutDashboard, Factory, Users, Shield, Package, ShoppingCart, BarChart3,
  Settings, LogOut, Menu, X, Bell, Search, ChevronDown, ChevronRight,
  Cpu, Building2, Truck, UserCheck, FileText, MessageSquare, Star,
  ShoppingBag, MapPin, Headphones, Sparkles,
} from "lucide-react";

export type UserRole = "admin" | "supplier" | "client";
export type SystemUserRole = "admin" | "production" | "store";

interface NavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  children?: { id: string; label: string }[];
}

// Flat navigation for Admin (no dropdowns)
const adminNavFlat: NavItem[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "production", label: "Production", icon: Factory },
  { id: "security", label: "AI Security", icon: Shield },
  { id: "inventory", label: "Inventory", icon: Package },
  { id: "orders", label: "Orders & Supply", icon: ShoppingCart },
  { id: "reports", label: "Reports Center", icon: BarChart3 },
  { id: "analytics", label: "Smart Analytics", icon: Sparkles },
  { id: "users", label: "User Management", icon: UserCheck },
  { id: "settings", label: "Settings", icon: Settings },
];

// Production role navigation (only production module)
const productionNav: NavItem[] = [
  { id: "production", label: "Production", icon: Factory },
];

// Store role navigation (only orders module)
const storeNav: NavItem[] = [
  { id: "orders", label: "Orders & Supply", icon: ShoppingCart },
];

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

const navByRole: Record<UserRole, NavItem[]> = {
  admin: adminNavFlat,
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

interface AppShellProps {
  role: UserRole;
  userRole?: SystemUserRole;
  activeSection: string;
  onSectionChange: (section: string) => void;
  onLogout: () => void;
  children: ReactNode;
  notificationCount?: number;
}

export function AppShell({ role, userRole, activeSection, onSectionChange, onLogout, children, notificationCount = 3 }: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [showNotifs, setShowNotifs] = useState(false);
  const erp = useERP();
  
  // Get navigation based on userRole if it's an admin-type role
  const getNavigation = (): NavItem[] => {
    if (role === "admin" && userRole) {
      if (userRole === "production") return productionNav;
      if (userRole === "store") return storeNav;
      return adminNavFlat;
    }
    return navByRole[role];
  };

  const nav = getNavigation();
  const accentColor = roleColors[role];
  const searchResults = searchQuery.length >= 2 ? nav.filter((n) => n.label.toLowerCase().includes(searchQuery.toLowerCase())) : [];
  const displayRoleLabel = userRole ? roleLabels[userRole] : roleLabels[role];

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
            <div style={{ fontSize: "0.65rem", color: accentColor, letterSpacing: "0.06em" }}>{roleLabels[role].toUpperCase()}</div>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {nav.map((item) => {
          const Icon = item.icon;
          const isActive = activeSection === item.id;

          return (
            <div key={item.id}>
              <button
                onClick={() => handleNavClick(item)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md mb-0.5 transition-all duration-150"
                style={{
                  background: isActive ? accentColor : "transparent",
                  color: isActive ? "#fff" : "#4A4A4A",
                }}
                onMouseEnter={(e) => {
                  if (!isActive) e.currentTarget.style.background = "#F5F0EF";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = isActive ? accentColor : "transparent";
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
        {sidebarOpen && (
          <div className="flex items-center gap-3 px-3 py-2 mb-2 rounded-md" style={{ background: "#F5F0EF" }}>
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: accentColor }}
            >
              <span style={{ fontSize: "0.75rem", color: "#fff", fontWeight: 600 }}>
                {role === "admin" ? "AD" : role === "supplier" ? "SP" : "CL"}
              </span>
            </div>
            <div>
              <div style={{ fontSize: "0.8rem", fontWeight: 600, color: "#1C1C1C" }}>
                {role === "admin" ? "Vikram Sharma" : role === "supplier" ? "Steel Corp Ltd" : "Reliance Eng."}
              </div>
              <div style={{ fontSize: "0.7rem", color: "#7A6C6A" }}>{roleLabels[role]}</div>
            </div>
          </div>
        )}
        <button
          onClick={onLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md transition-all duration-150"
          style={{ color: "#C0392B" }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "#FFEBEE"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
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
            className="p-2 rounded-md transition-colors"
            style={{ color: "#4A4A4A" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "#F5F0EF"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
          >
            {mobileSidebarOpen ? <X size={18} /> : <Menu size={18} />}
          </button>

          {/* Search */}
          <div className="relative flex items-center gap-2 flex-1 max-w-md px-3 py-2 rounded-md" style={{ background: "#F5F0EF" }}>
            <Search size={15} color="#9A8A88" />
            <input
              placeholder="Search modules, workers, orders..."
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
            {showSearchResults && searchResults.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 rounded-md overflow-hidden z-50" style={{ background: "#fff", border: "1px solid #E8E2E0", boxShadow: "0 8px 24px rgba(0,0,0,0.12)" }}>
                {searchResults.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button key={item.id} onMouseDown={() => { onSectionChange(item.id); setSearchQuery(""); setShowSearchResults(false); }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 transition-colors"
                      style={{ background: "transparent", border: "none", cursor: "pointer", textAlign: "left" }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "#F5F0EF"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
                      <Icon size={15} color="#A52A2A" />
                      <span style={{ fontSize: "0.8375rem", color: "#1C1C1C" }}>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex items-center gap-3 ml-auto">
            {/* Notifications */}
            <div className="relative">
              <button
                onClick={() => { setShowNotifs(!showNotifs); if (!showNotifs) erp.markAllRead(); }}
                className="relative p-2 rounded-md transition-colors"
                style={{ color: "#4A4A4A" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "#F5F0EF"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                <Bell size={18} />
                {erp.unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full flex items-center justify-center"
                    style={{ background: "#A52A2A", fontSize: "0.6rem", color: "#fff", fontWeight: 700 }}>
                    {erp.unreadCount}
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
                    {erp.notifications.length === 0 ? (
                      <p style={{ padding: "2rem", textAlign: "center", color: "#9A8A88", fontSize: "0.8rem" }}>Notifications unavailable — no notification backend is configured.</p>
                    ) : (
                      erp.notifications.slice(0, 10).map((n) => (
                        <div key={n.id} className="flex items-start gap-3 px-4 py-3" style={{ borderBottom: "1px solid #F7F3F2", background: n.read ? "transparent" : "#FDFBFB", opacity: n.read ? 0.75 : 1 }}>
                          <div className="w-2 h-2 rounded-full flex-shrink-0 mt-1.5" style={{ background: n.type === "critical" ? "#C0392B" : n.type === "warn" ? "#E65100" : n.type === "success" ? "#2E7D32" : "#1565C0" }} />
                          <div className="flex-1 min-w-0">
                            <p style={{ fontSize: "0.775rem", color: "#1C1C1C", lineHeight: 1.45 }}>{n.msg}</p>
                            <p style={{ fontSize: "0.68rem", color: "#9A8A88", marginTop: "0.2rem" }}>{n.time}</p>
                          </div>
                        </div>
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