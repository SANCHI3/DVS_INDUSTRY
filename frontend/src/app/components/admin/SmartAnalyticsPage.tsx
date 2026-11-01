import { useMemo, useState } from "react";
import { ShieldAlert, Sparkles } from "lucide-react";
import { PageHeader, TabBar } from "../shared/UI";

import { INK } from "./analytics/shared";
import { HealthTab } from "./analytics/HealthTab";
import { InventoryTab } from "./analytics/InventoryTab";
import { ProductionTab } from "./analytics/ProductionTab";
import { SupplierTab } from "./analytics/SupplierTab";
import { getStoredBackendRole } from "../../../lib/auth";
import { analyticsTabs, type AnalyticsTab } from "../../../lib/permissions";

const TAB_LABELS: Record<AnalyticsTab, string> = {
  health: "Plant Health",
  inventory: "Inventory Intelligence",
  production: "Production Performance",
  suppliers: "Supplier Scorecard",
};

// ══ Page ═══════════════════════════════════════════════════════════════════════

export function SmartAnalyticsPage() {
  // Only the analyses this role may load (Store: inventory and suppliers)
  const tabs = useMemo(() => analyticsTabs(getStoredBackendRole()), []);
  const [tab, setTab] = useState<string>(() => tabs[0] ?? "health");
  return (
    <div className="p-6">
      <PageHeader
        title="Smart Analytics"
        subtitle="Demand forecasting, dynamic reorder planning, anomaly detection, OEE, statistical quality control and supplier scoring"
        actions={<span className="flex items-center gap-1.5" style={{ fontSize: "0.775rem", color: INK.muted }}><Sparkles size={14} color="#A52A2A" /> Computed live from ERP data</span>}
      />
      <div className="mb-5">
        <TabBar
          tabs={tabs.map((id) => ({ id, label: TAB_LABELS[id] }))}
          active={tab}
          onChange={setTab}
        />
      </div>
      {tab === "health" && tabs.includes("health") && <HealthTab />}
      {tab === "inventory" && tabs.includes("inventory") && <InventoryTab />}
      {tab === "production" && tabs.includes("production") && <ProductionTab />}
      {tab === "suppliers" && tabs.includes("suppliers") && <SupplierTab />}
      <p className="flex items-center gap-1.5 mt-6" style={{ fontSize: "0.72rem", color: INK.muted }}>
        <ShieldAlert size={12} /> Recommendations support planners; purchase orders are never raised automatically.
      </p>
    </div>
  );
}
