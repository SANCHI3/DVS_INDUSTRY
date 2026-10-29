import { useState, useEffect } from "react";
import { toast } from "sonner";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart,
  Line, PieChart, Pie, Cell,
} from "recharts";
import { Plus, Download, AlertTriangle, Zap } from "lucide-react";
import { PageHeader, KPICard, StatusBadge, Btn, DataTable, TabBar } from "../shared/UI";
import {
  getMaterials, getInventoryStats, adjustStock, createMaterial, getPartSpecs, createPartSpec,
  type InventoryStatistics, type MaterialDto, type PartSpecDto,
} from "../../../lib/services/inventory.service";
import { downloadCSV } from "../../../lib/csv";
import { Modal } from "../shared/Modal";

import { ProductionCalculator, type InventoryMaterial } from "./inventory/ProductionCalculator";

/* ══════════════════════════════════════════════
   MAIN INVENTORY PAGE
══════════════════════════════════════════════ */
/* ── Modal overlay helper ── */
const unavailable = "—";

const emptyPart = { partNumber: "", rmGrade: "", thicknessMm: "", stripSize: "", piecesPerStrip: "", piecesPerSheet: "", sheetSize: "1250x2500" };

/** Strips cut from one sheet, when both yields are known and divide evenly. */
function stripsPerSheet(part: PartSpecDto): string {
  if (!part.piecesPerStrip || !part.piecesPerSheet) return unavailable;
  const strips = part.piecesPerSheet / part.piecesPerStrip;
  return Number.isInteger(strips) ? String(strips) : strips.toFixed(1);
}

function toInventoryMaterial(material: MaterialDto): InventoryMaterial {
  const quantity = parseFloat(material.currentStock);
  const threshold = parseFloat(material.minStockLevel);
  return {
    id: material.code,
    name: material.name,
    category: material.category ?? unavailable,
    thickness: unavailable,
    qty: quantity,
    unit: material.unit,
    cost: material.costPerUnit ? parseFloat(material.costPerUnit) : null,
    threshold,
    location: material.location ?? unavailable,
    status: quantity === 0 ? "out of stock" : quantity <= threshold ? "low stock" : "in stock",
    apiId: material.id,
  };
}

export function InventoryPage() {
  const [tab, setTab]                   = useState("overview");
  const [materials, setMaterials]       = useState<InventoryMaterial[]>([]);
  const [materialsLoading, setMaterialsLoading] = useState(true);
  const [materialsError, setMaterialsError] = useState(false);
  const [apiStats, setApiStats]         = useState<InventoryStatistics | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState(false);
  const [showAddMaterial, setShowAddMaterial] = useState(false);
  const [newMat, setNewMat]             = useState({ name: "", category: "Steel", thickness: "", qty: "", cost: "", threshold: "", location: "" });
  const [parts, setParts]               = useState<PartSpecDto[]>([]);
  const [partsLoading, setPartsLoading] = useState(true);
  const [partsError, setPartsError]     = useState(false);
  const [showAddPart, setShowAddPart]   = useState(false);
  const [newPart, setNewPart]           = useState(emptyPart);

  // ── Load from API ──────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    getMaterials({ pageSize: 100, status: "active" }).then((res) => {
      if (!cancelled) setMaterials(res.data.map(toInventoryMaterial));
    }).catch(() => {
      if (!cancelled) setMaterialsError(true);
    }).finally(() => {
      if (!cancelled) setMaterialsLoading(false);
    });
    getPartSpecs().then((res) => {
      if (!cancelled) setParts(res);
    }).catch(() => {
      if (!cancelled) setPartsError(true);
    }).finally(() => {
      if (!cancelled) setPartsLoading(false);
    });
    getInventoryStats().then((res) => {
      if (!cancelled) setApiStats(res);
    }).catch(() => {
      if (!cancelled) setStatsError(true);
    }).finally(() => {
      if (!cancelled) setStatsLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  // ── Derived values ─────────────────────────────────────────────────────────
  const totalValue = apiStats ? parseFloat(apiStats.totalStockValue) : null;
  const lowStock = apiStats?.lowStockCount ?? null;
  const totalMaterials = apiStats?.activeMaterials ?? null;
  const categoryChartData = apiStats?.byCategory.map((entry, index) => ({
    name: entry.category,
    value: entry.stockValue,
    color: ["#A52A2A", "#4E342E", "#D4793A", "#9A8A88"][index % 4],
  })) ?? [];

  const handleExport = () => {
    const rows = [
      ["ID", "Name", "Category", "Thickness", "Qty", "Unit", "Cost/kg", "Threshold", "Location", "Status"],
      ...materials.map((m) => [m.id, m.name, m.category, m.thickness, String(m.qty), m.unit, String(m.cost), String(m.threshold), m.location, m.status]),
    ];
    downloadCSV("DVS_Inventory_Export.csv", rows);
    toast.success("Inventory exported to CSV");
  };

  const handleAddMaterial = async () => {
    if (!newMat.name || !newMat.qty || !newMat.cost) return;
    const qty = parseFloat(newMat.qty);
    const threshold = parseInt(newMat.threshold) || 50;
    try {
      const code = newMat.name.toUpperCase().replace(/[^A-Z0-9]/g, "-").slice(0, 20);
      const created = await createMaterial({
        name: newMat.name, code, unit: "kg",
        category: newMat.category,
        location: newMat.location || null,
        minStockLevel: String(threshold),
        costPerUnit: newMat.cost,
      });
      if (qty > 0) {
        await adjustStock(created.id, { type: "IN", quantity: String(qty), reason: "Initial stock" });
      }
      const refreshed = await getMaterials({ pageSize: 100, status: "active" });
      setMaterials(refreshed.data.map(toInventoryMaterial));
      setNewMat({ name: "", category: "Steel", thickness: "", qty: "", cost: "", threshold: "", location: "" });
      setShowAddMaterial(false);
      toast.success(`Material "${newMat.name}" added to inventory`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Material could not be saved");
    }
  };

  const handleAddPart = async () => {
    if (!newPart.partNumber || !newPart.rmGrade || !newPart.thicknessMm || !newPart.stripSize || !newPart.sheetSize) {
      toast.error("Part number, RM grade, thickness, strip size and sheet size are required");
      return;
    }
    try {
      const created = await createPartSpec({
        partNumber: newPart.partNumber.trim(),
        rmGrade: newPart.rmGrade.trim(),
        thicknessMm: newPart.thicknessMm.trim(),
        stripSize: newPart.stripSize.trim(),
        sheetSize: newPart.sheetSize.trim(),
        piecesPerStrip: newPart.piecesPerStrip ? parseInt(newPart.piecesPerStrip, 10) : null,
        piecesPerSheet: newPart.piecesPerSheet ? parseInt(newPart.piecesPerSheet, 10) : null,
      });
      setParts((prev) => [...prev, created].sort((a, b) => a.partNumber.localeCompare(b.partNumber)));
      setNewPart(emptyPart);
      setShowAddPart(false);
      toast.success(`Part "${created.partNumber}" added`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Part could not be saved");
    }
  };

  return (
    <>
    {showAddPart && (
      <Modal title="Add Part" onClose={() => setShowAddPart(false)}>
        <div className="flex flex-col gap-3">
          {[
            { label: "Part Number *", key: "partNumber", placeholder: "e.g. 600N/610N" },
            { label: "RM Grade *", key: "rmGrade", placeholder: "e.g. CR D" },
            { label: "Thickness (mm) *", key: "thicknessMm", placeholder: "e.g. 1.2", type: "number" },
            { label: "Strip Size *", key: "stripSize", placeholder: "e.g. 1X108X1250" },
            { label: "Per Strip Qty", key: "piecesPerStrip", placeholder: "e.g. 24", type: "number" },
            { label: "Per Sheet Qty", key: "piecesPerSheet", placeholder: "e.g. 552", type: "number" },
            { label: "Sheet Size *", key: "sheetSize", placeholder: "e.g. 1250x2500" },
          ].map((f) => (
            <div key={f.key}>
              <label style={{ display: "block", fontSize: "0.775rem", fontWeight: 600, color: "#4A4A4A", marginBottom: "0.3rem" }}>{f.label}</label>
              <input type={f.type || "text"} placeholder={f.placeholder} value={newPart[f.key as keyof typeof newPart]}
                onChange={(e) => setNewPart((p) => ({ ...p, [f.key]: e.target.value }))}
                style={{ width: "100%", padding: "0.5rem 0.75rem", border: "1px solid #D4BFBB", borderRadius: "0.375rem", fontSize: "0.8375rem", outline: "none" }}
                onFocus={(e) => { e.target.style.borderColor = "#A52A2A"; }}
                onBlur={(e) => { e.target.style.borderColor = "#D4BFBB"; }} />
            </div>
          ))}
          <div className="flex gap-2 mt-2">
            <button onClick={() => setShowAddPart(false)} style={{ flex: 1, padding: "0.625rem", border: "1px solid #E8E2E0", borderRadius: "0.5rem", background: "#fff", cursor: "pointer", fontSize: "0.875rem" }}>Cancel</button>
            <button onClick={handleAddPart} style={{ flex: 1, padding: "0.625rem", border: "none", borderRadius: "0.5rem", background: "#A52A2A", color: "#fff", cursor: "pointer", fontSize: "0.875rem", fontWeight: 600 }}>Add Part</button>
          </div>
        </div>
      </Modal>
    )}
    {showAddMaterial && (
      <Modal title="Add New Material" onClose={() => setShowAddMaterial(false)}>
        <div className="flex flex-col gap-3">
          {[
            { label: "Material Name *", key: "name", placeholder: "e.g. Steel Sheet 3mm" },
            { label: "Thickness", key: "thickness", placeholder: "e.g. 3mm" },
            { label: "Quantity (kg) *", key: "qty", placeholder: "e.g. 500", type: "number" },
            { label: "Cost per kg (₹) *", key: "cost", placeholder: "e.g. 72", type: "number" },
            { label: "Min Threshold (kg)", key: "threshold", placeholder: "e.g. 200", type: "number" },
            { label: "Location", key: "location", placeholder: "e.g. WH-A Row 5" },
          ].map((f) => (
            <div key={f.key}>
              <label style={{ display: "block", fontSize: "0.775rem", fontWeight: 600, color: "#4A4A4A", marginBottom: "0.3rem" }}>{f.label}</label>
              <input type={f.type || "text"} placeholder={f.placeholder} value={newMat[f.key as keyof typeof newMat]}
                onChange={(e) => setNewMat((p) => ({ ...p, [f.key]: e.target.value }))}
                style={{ width: "100%", padding: "0.5rem 0.75rem", border: "1px solid #D4BFBB", borderRadius: "0.375rem", fontSize: "0.8375rem", outline: "none" }}
                onFocus={(e) => { e.target.style.borderColor = "#A52A2A"; }}
                onBlur={(e) => { e.target.style.borderColor = "#D4BFBB"; }} />
            </div>
          ))}
          <div>
            <label style={{ display: "block", fontSize: "0.775rem", fontWeight: 600, color: "#4A4A4A", marginBottom: "0.3rem" }}>Category</label>
            <select value={newMat.category} onChange={(e) => setNewMat((p) => ({ ...p, category: e.target.value }))}
              style={{ width: "100%", padding: "0.5rem 0.75rem", border: "1px solid #D4BFBB", borderRadius: "0.375rem", fontSize: "0.8375rem", outline: "none" }}>
              {["Steel", "Aluminium", "Copper", "Other"].map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div className="flex gap-2 mt-2">
            <button onClick={() => setShowAddMaterial(false)} style={{ flex: 1, padding: "0.625rem", border: "1px solid #E8E2E0", borderRadius: "0.5rem", background: "#fff", cursor: "pointer", fontSize: "0.875rem" }}>Cancel</button>
            <button onClick={handleAddMaterial} style={{ flex: 1, padding: "0.625rem", border: "none", borderRadius: "0.5rem", background: "#A52A2A", color: "#fff", cursor: "pointer", fontSize: "0.875rem", fontWeight: 600 }}>Add Material</button>
          </div>
        </div>
      </Modal>
    )}
    <div className="p-6">
      <PageHeader
        title="Inventory Intelligence"
        subtitle="Real-time material tracking, production simulation, scrap analytics, and procurement"
        actions={
          <div className="flex gap-2">
            <Btn variant="secondary" size="sm" onClick={handleExport}><Download size={14} /> Export</Btn>
            <Btn size="sm" onClick={() => setShowAddMaterial(true)}><Plus size={14} /> Add Material</Btn>
          </div>
        }
      />

      <TabBar
        tabs={[
          { id: "overview", label: "Overview" },
          { id: "materials", label: "Material Management" },
          { id: "parts", label: "Parts Master" },
          { id: "calculator", label: "Production Calculator" },
          { id: "scrap", label: "Scrap Analytics" },
          { id: "procurement", label: "Procurement" },
        ]}
        active={tab}
        onChange={setTab}
      />

      <div className="mt-5">
        {/* ── OVERVIEW ── */}
        {tab === "overview" && (
          <div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
              <KPICard label="Total Inventory Value" value={totalValue === null ? unavailable : totalValue >= 100000 ? `₹${(totalValue / 100000).toFixed(1)}L` : `₹${totalValue.toFixed(0)}`} accent="#A52A2A" />
              <KPICard label="Low / Out of Stock" value={statsLoading || statsError || lowStock === null ? unavailable : lowStock} sub="materials need action" accent="#C0392B" trendDir="down" />
              <KPICard label="Materials Tracked" value={materialsLoading || materialsError || totalMaterials === null ? unavailable : totalMaterials} accent="#2E7D32" />
              <KPICard label="Reorder Suggestions" value={statsLoading || statsError || apiStats === null ? unavailable : apiStats.lowStockCount} sub="need reorder" accent="#E65100" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-5">
              <div style={{ gridColumn: "span 2" }}>
                <div className="rounded-xl overflow-hidden" style={{ background: "#fff", border: "1px solid #E8E2E0", boxShadow: "0 1px 6px rgba(0,0,0,0.05)" }}>
                  <div className="px-5 py-4" style={{ borderBottom: "1px solid #F0ECEB" }}>
                    <p style={{ fontSize: "0.9rem", fontWeight: 600 }}>Stock Levels</p>
                    <p style={{ fontSize: "0.775rem", color: "#7A6C6A" }}>Real-time material quantities</p>
                  </div>
                  <div className="p-5">
                    {materialsLoading ? <p style={{ fontSize: "0.8375rem", color: "#7A6C6A" }}>Loading materials...</p> : materialsError ? <p style={{ fontSize: "0.8375rem", color: "#C0392B" }}>Unable to load inventory materials.</p> : materials.length === 0 ? <p style={{ fontSize: "0.8375rem", color: "#7A6C6A" }}>No data available.</p> : materials.map((m) => (
                      <div key={m.id} className="flex items-center gap-3 mb-3">
                        <span style={{ fontSize: "0.8rem", color: "#4A4A4A", minWidth: "170px", flex: "0 0 170px" }}>{m.name}</span>
                        <div className="flex-1" style={{ height: "8px", background: "#F0ECEB", borderRadius: "999px", overflow: "hidden" }}>
                          <div style={{ width: `${Math.min(100, (m.qty / (m.threshold * 5)) * 100)}%`, height: "100%", background: m.status === "out of stock" ? "#C0392B" : m.status === "low stock" ? "#E65100" : "#A52A2A", borderRadius: "999px", transition: "width 0.5s" }} />
                        </div>
                        <span style={{ fontSize: "0.775rem", fontWeight: 700, minWidth: "70px", textAlign: "right", color: m.status === "out of stock" ? "#C0392B" : m.status === "low stock" ? "#E65100" : "#2E7D32" }}>
                          {m.qty} {m.unit}
                        </span>
                        <StatusBadge status={m.status} />
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="rounded-xl overflow-hidden" style={{ background: "#fff", border: "1px solid #E8E2E0", boxShadow: "0 1px 6px rgba(0,0,0,0.05)" }}>
                <div className="px-5 py-4" style={{ borderBottom: "1px solid #F0ECEB" }}>
                  <p style={{ fontSize: "0.9rem", fontWeight: 600 }}>Composition</p>
                  <p style={{ fontSize: "0.775rem", color: "#7A6C6A" }}>By material type</p>
                </div>
                <div className="p-4 flex flex-col items-center">
                  <ResponsiveContainer width="100%" height={140}>
                    {statsLoading ? <p style={{ fontSize: "0.8375rem", color: "#7A6C6A" }}>Loading statistics...</p> : statsError ? <p style={{ fontSize: "0.8375rem", color: "#C0392B" }}>Unable to load inventory statistics.</p> : categoryChartData.length === 0 ? <p style={{ fontSize: "0.8375rem", color: "#7A6C6A" }}>No data available.</p> : <PieChart>
                      <Pie data={categoryChartData} dataKey="value" cx="50%" cy="50%" innerRadius={38} outerRadius={62} paddingAngle={2}>
                        {categoryChartData.map((e, i) => <Cell key={i} fill={e.color} />)}
                      </Pie>
                      <Tooltip formatter={(v) => [`₹${v}`]} contentStyle={{ fontSize: "0.8rem" }} />
                    </PieChart>}
                  </ResponsiveContainer>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 w-full mt-2">
                    {categoryChartData.map((m) => (
                      <div key={m.name} className="flex items-center gap-1.5">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ background: m.color }} />
                        <span style={{ fontSize: "0.72rem", color: "#7A6C6A" }}>{m.name}: ₹{m.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Reorder alerts */}
            <div className="rounded-xl overflow-hidden" style={{ background: "#fff", border: "1px solid #E8E2E0", boxShadow: "0 1px 6px rgba(0,0,0,0.05)" }}>
              <div className="px-5 py-4 flex items-center gap-2" style={{ borderBottom: "1px solid #F0ECEB", background: "#FDF5F5" }}>
                <AlertTriangle size={16} color="#A52A2A" />
                <p style={{ fontSize: "0.9rem", fontWeight: 600 }}>Reorder Suggestions</p>
              </div>
              <div className="p-5 flex flex-col gap-3">
                {materialsLoading ? <p style={{ fontSize: "0.8375rem", color: "#7A6C6A" }}>Loading materials...</p> : materialsError ? <p style={{ fontSize: "0.8375rem", color: "#C0392B" }}>Unable to load inventory materials.</p> : materials.filter((m) => m.status !== "in stock").length === 0 ? <p style={{ fontSize: "0.8375rem", color: "#7A6C6A" }}>No data available.</p> : materials.filter((m) => m.status !== "in stock").map((m) => (
                  <div key={m.id} className="flex items-center gap-4 p-4 rounded-xl" style={{ background: "#FFF8F8", border: "1px solid #FFCDD2" }}>
                    <AlertTriangle size={18} color="#C0392B" />
                    <div className="flex-1">
                      <p style={{ fontSize: "0.8375rem", fontWeight: 700 }}>{m.name}</p>
                      <p style={{ fontSize: "0.775rem", color: "#7A6C6A" }}>
                        Stock: {m.qty} {m.unit} · Threshold: {m.threshold} {m.unit} · Location: {m.location}
                      </p>
                    </div>
                    <StatusBadge status={m.status} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── MATERIALS ── */}
        {tab === "materials" && (
          <div className="rounded-xl overflow-hidden" style={{ background: "#fff", border: "1px solid #E8E2E0", boxShadow: "0 1px 6px rgba(0,0,0,0.05)" }}>
            <DataTable
              searchable
              paginate={10}
              exportFilename="DVS_Materials.csv"
              emptyMsg={materialsLoading ? "Loading materials..." : materialsError ? "Unable to load inventory materials." : "No data available."}
              columns={[
                { key: "id", label: "ID" },
                { key: "name", label: "Material Name" },
                { key: "category", label: "Category" },
                { key: "thickness", label: "Thickness" },
                { key: "qty", label: "Quantity" },
                { key: "cost", label: "Unit Cost" },
                { key: "threshold", label: "Min Threshold" },
                { key: "location", label: "Location" },
                { key: "status", label: "Status" },
              ]}
              rows={materials.map((m) => ({
                id: <span style={{ fontSize: "0.72rem", fontFamily: "JetBrains Mono, monospace", color: "#A52A2A" }}>{m.id}</span>,
                name: <span style={{ fontWeight: 600 }}>{m.name}</span>,
                category: m.category,
                thickness: m.thickness,
                qty: <span style={{ fontWeight: 700 }}>{m.qty} {m.unit}</span>,
                cost: m.cost === null ? unavailable : `₹${m.cost}/${m.unit}`,
                threshold: `${m.threshold} ${m.unit}`,
                location: <span style={{ fontSize: "0.775rem" }}>{m.location}</span>,
                status: <StatusBadge status={m.status} />,
              }))}
            />
          </div>
        )}

        {/* ── PARTS MASTER ── */}
        {tab === "parts" && (
          <div className="rounded-xl overflow-hidden" style={{ background: "#fff", border: "1px solid #E8E2E0", boxShadow: "0 1px 6px rgba(0,0,0,0.05)" }}>
            <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: "1px solid #F0ECEB" }}>
              <div>
                <p style={{ fontSize: "0.9rem", fontWeight: 600 }}>Parts Master</p>
                <p style={{ fontSize: "0.775rem", color: "#7A6C6A" }}>Raw-material grade, strip size and yield per strip and per sheet</p>
              </div>
              <Btn size="sm" onClick={() => setShowAddPart(true)}><Plus size={14} /> Add Part</Btn>
            </div>
            <DataTable
              searchable
              exportFilename="DVS_Parts_Master.csv"
              emptyMsg={partsLoading ? "Loading parts..." : partsError ? "Unable to load parts." : "No parts recorded."}
              columns={[
                { key: "partNumber", label: "Part Number" },
                { key: "rmGrade", label: "RM Grade" },
                { key: "thickness", label: "Thickness (mm)" },
                { key: "stripSize", label: "Strip Size" },
                { key: "perStrip", label: "Per Strip Qty" },
                { key: "perSheet", label: "Per Sheet Qty" },
                { key: "strips", label: "Strips / Sheet" },
                { key: "sheetSize", label: "Sheet Size" },
                { key: "notes", label: "Notes" },
              ]}
              rows={parts.map((p) => ({
                partNumber: p.partNumber,
                rmGrade: p.rmGrade,
                thickness: String(parseFloat(p.thicknessMm)),
                stripSize: p.stripSize,
                perStrip: p.piecesPerStrip === null ? unavailable : String(p.piecesPerStrip),
                perSheet: p.piecesPerSheet === null ? unavailable : String(p.piecesPerSheet),
                strips: stripsPerSheet(p),
                sheetSize: p.sheetSize,
                notes: p.notes ?? "",
              }))}
            />
          </div>
        )}

        {/* ── CALCULATOR ── */}
        {tab === "calculator" && <ProductionCalculator materials={materials} />}

        {/* ── SCRAP ANALYTICS ── */}
        {tab === "scrap" && (
          <div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
              <KPICard label="Total Scrap This Month" value={apiStats ? `${apiStats.totalScrapThisMonth} kg` : unavailable} accent="#C0392B" />
              <KPICard label="Scrap Recovery Value This Month" value={apiStats ? `₹${apiStats.scrapValueThisMonth}` : unavailable} accent="#E65100" />
              <KPICard label="Worst Department" value={unavailable} accent="#4E342E" />
              <KPICard label="Average Utilization" value={unavailable} accent="#2E7D32" />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
              <div className="rounded-xl overflow-hidden" style={{ background: "#fff", border: "1px solid #E8E2E0", boxShadow: "0 1px 6px rgba(0,0,0,0.05)" }}>
                <div className="px-5 py-4" style={{ borderBottom: "1px solid #F0ECEB" }}>
                  <p style={{ fontSize: "0.9rem", fontWeight: 600 }}>Scrap by Department</p>
                  <p style={{ fontSize: "0.775rem", color: "#7A6C6A" }}>kg today</p>
                </div>
                <div className="p-5">
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={[]}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#F0ECEB" />
                      <XAxis dataKey="dept" tick={{ fontSize: 10, fill: "#9A8A88" }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: "#9A8A88" }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={{ fontSize: "0.8rem" }} />
                      <Bar dataKey="kg" fill="#A52A2A" radius={[3, 3, 0, 0]} name="Scrap (kg)" />
                    </BarChart>
                  </ResponsiveContainer>
                  <p style={{ fontSize: "0.8375rem", color: "#7A6C6A", marginTop: "0.75rem" }}>No department-level scrap data available.</p>
                </div>
              </div>
              <div className="rounded-xl overflow-hidden" style={{ background: "#fff", border: "1px solid #E8E2E0", boxShadow: "0 1px 6px rgba(0,0,0,0.05)" }}>
                <div className="px-5 py-4" style={{ borderBottom: "1px solid #F0ECEB" }}>
                  <p style={{ fontSize: "0.9rem", fontWeight: 600 }}>Weekly Scrap Trend</p>
                  <p style={{ fontSize: "0.775rem", color: "#7A6C6A" }}>Daily scrap (kg)</p>
                </div>
                <div className="p-5">
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={[]}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#F0ECEB" />
                      <XAxis dataKey="day" tick={{ fontSize: 10, fill: "#9A8A88" }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: "#9A8A88" }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={{ fontSize: "0.8rem" }} />
                      <Line type="monotone" dataKey="scrap" stroke="#A52A2A" strokeWidth={2} name="Scrap (kg)" dot={{ r: 4, fill: "#A52A2A" }} />
                    </LineChart>
                  </ResponsiveContainer>
                  <p style={{ fontSize: "0.8375rem", color: "#7A6C6A", marginTop: "0.75rem" }}>No scrap trend data available.</p>
                </div>
              </div>
            </div>
            <div className="rounded-xl overflow-hidden" style={{ background: "#fff", border: "1px solid #E8E2E0", boxShadow: "0 1px 6px rgba(0,0,0,0.05)" }}>
              <div className="px-5 py-4 flex items-center gap-2" style={{ borderBottom: "1px solid #F0ECEB", background: "#FDF5F5" }}>
                <Zap size={15} color="#A52A2A" />
                <p style={{ fontSize: "0.9rem", fontWeight: 600 }}>AI Scrap Recommendations</p>
              </div>
              <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-3">
                {["No scrap recommendations available from the current inventory APIs."].map((r, i) => (
                  <div key={i} className="flex gap-2.5 p-3.5 rounded-xl" style={{ background: r.startsWith("✅") ? "#F0FAF0" : r.startsWith("📋") ? "#F0F4FF" : "#FFF8F8", border: `1px solid ${r.startsWith("✅") ? "#C8E6C9" : r.startsWith("📋") ? "#C5CAE9" : "#FFCDD2"}` }}>
                    <span style={{ fontSize: "1rem" }}>{r.charAt(0)}</span>
                    <p style={{ fontSize: "0.775rem", lineHeight: 1.6, color: "#2C2C2C" }}>{r.slice(2).trim()}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── PROCUREMENT ── */}
        {tab === "procurement" && (
          <div>
            <div className="rounded-xl overflow-hidden" style={{ background: "#fff", border: "1px solid #E8E2E0", boxShadow: "0 1px 6px rgba(0,0,0,0.05)" }}>
              <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: "1px solid #F0ECEB" }}>
                <div>
                  <p style={{ fontSize: "0.9rem", fontWeight: 600 }}>Supplier Comparison</p>
                  <p style={{ fontSize: "0.775rem", color: "#7A6C6A" }}>Benchmark suppliers by price, delivery, and reliability</p>
                </div>
              </div>
              <DataTable
                emptyMsg="No supplier data available."
                columns={[
                  { key: "name", label: "Supplier" },
                  { key: "material", label: "Material" },
                  { key: "price", label: "Price/kg" },
                  { key: "delivery", label: "Lead Time" },
                  { key: "reliability", label: "Reliability" },
                  { key: "rating", label: "Rating" },
                  { key: "action", label: "Action" },
                ]}
                rows={[]}
              />
            </div>
          </div>
        )}
      </div>
    </div>
    </>
  );
}
