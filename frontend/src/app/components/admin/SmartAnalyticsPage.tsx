import { useState } from "react";
import { ShieldAlert, Sparkles } from "lucide-react";
import { PageHeader, TabBar } from "../shared/UI";

import { INK } from "./analytics/shared";
import { HealthTab } from "./analytics/HealthTab";
import { InventoryTab } from "./analytics/InventoryTab";
import { ProductionTab } from "./analytics/ProductionTab";
import { SupplierTab } from "./analytics/SupplierTab";

// ══ Page ═══════════════════════════════════════════════════════════════════════

export function SmartAnalyticsPage() {
  const [tab, setTab] = useState("health");
  return (
    <div className="p-6">
      <PageHeader
        title="Smart Analytics"
        subtitle="Demand forecasting, dynamic reorder planning, anomaly detection, OEE, statistical quality control and supplier scoring"
        actions={<span className="flex items-center gap-1.5" style={{ fontSize: "0.775rem", color: INK.muted }}><Sparkles size={14} color="#A52A2A" /> Computed live from ERP data</span>}
      />
      <div className="mb-5">
        <TabBar
          tabs={[
            { id: "health", label: "Plant Health" },
            { id: "inventory", label: "Inventory Intelligence" },
            { id: "production", label: "Production Performance" },
            { id: "suppliers", label: "Supplier Scorecard" },
          ]}
          active={tab}
          onChange={setTab}
        />
      </div>
      {tab === "health" && <HealthTab />}
      {tab === "inventory" && <InventoryTab />}
      {tab === "production" && <ProductionTab />}
      {tab === "suppliers" && <SupplierTab />}
      <p className="flex items-center gap-1.5 mt-6" style={{ fontSize: "0.72rem", color: INK.muted }}>
        <ShieldAlert size={12} /> Recommendations support planners; purchase orders are never raised automatically.
      </p>
    </div>
  );
}
