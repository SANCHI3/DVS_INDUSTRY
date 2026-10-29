import { useState, useEffect } from "react";
import { toast as showSonnerToast } from "sonner";
import { Plus, Download, Eye, CheckCircle2, Truck } from "lucide-react";
import { PageHeader, Card, CardHeader, KPICard, StatusBadge, Btn, DataTable, TabBar } from "../shared/UI";
import { useERP } from "./ERPContext";
import {
  getClientOrders, getPurchaseOrders, getOrderStats, getClients, getSuppliers,
  approveClientOrder, dispatchClientOrder, createClientOrder, createPurchaseOrder,
  type OrderStatistics, type ClientDto, type SupplierDto,
} from "../../../lib/services/orders.service";
import { downloadCSV } from "../../../lib/csv";

import {
  parseMoney, parseQuantity, POModal, OrderDetailModal, DispatchModal, NewClientOrderModal, type ClientOrder, type SupplierOrder,
} from "./orders/OrderModals";

export function OrdersPage({ onNavigate }: { onNavigate?: (section: string) => void }) {
  const [tab, setTab]                       = useState("client-orders");
  const [clientOrders, setClientOrders]     = useState<ClientOrder[]>([]);
  const [supplierOrders, setSupplierOrders] = useState<SupplierOrder[]>([]);
  const [clients, setClients]               = useState<ClientDto[]>([]);
  const [suppliers, setSuppliers]           = useState<SupplierDto[]>([]);
  const [apiStats, setApiStats]             = useState<OrderStatistics | null>(null);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [suppliersLoading, setSuppliersLoading] = useState(true);
  const [clientsLoading, setClientsLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);
  const [ordersError, setOrdersError] = useState(false);
  const [suppliersError, setSuppliersError] = useState(false);
  const [clientsError, setClientsError] = useState(false);
  const [statsError, setStatsError] = useState(false);
  const [showNewOrder, setShowNewOrder]     = useState(false);
  const [showNewPO, setShowNewPO]           = useState(false);
  const [selectedOrder, setSelectedOrder]   = useState<ClientOrder | null>(null);
  const [dispatchOrder, setDispatchOrder]   = useState<ClientOrder | null>(null);
  const { pendingPO, setPendingPO } = useERP();

  // ── Load real data ──────────────────────────────────────────────────────────
  const loadAll = async (): Promise<void> => {
    setOrdersLoading(true); setSuppliersLoading(true); setClientsLoading(true); setStatsLoading(true);
    setOrdersError(false); setSuppliersError(false); setClientsError(false); setStatsError(false);
    const [coRes, poRes, statsRes, clientRes, supplierRes] = await Promise.all([
      getClientOrders({ pageSize: 50, sortOrder: "desc" }).catch(() => null),
      getPurchaseOrders({ pageSize: 50, sortOrder: "desc" }).catch(() => null),
      getOrderStats().catch(() => null),
      getClients({ pageSize: 100 }).catch(() => null),
      getSuppliers({ pageSize: 100 }).catch(() => null),
    ]);

        if (coRes) setClientOrders(coRes.data.map(o => ({
          id: o.orderNumber,
          client: o.clientName,
          product: o.product,
          qty: o.quantity,
          orderDate: new Date(o.orderDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }),
          requiredDate: o.requiredDate ? new Date(o.requiredDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—",
          status: o.status.toLowerCase().replace("_", "-"),
          value: o.value ? `₹${parseFloat(o.value).toLocaleString("en-IN")}` : "—",
          dispatch: o.dispatchDate ? new Date(o.dispatchDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : undefined,
          delivery: o.deliveryDate ? new Date(o.deliveryDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : undefined,
          _apiId: o.id,
        }))); else setOrdersError(true);
    if (poRes) setSupplierOrders(poRes.data.map(p => ({
          id: p.poNumber,
          supplier: p.supplierName,
          material: p.material,
          qty: p.unit ? `${p.quantity} ${p.unit}` : p.quantity,
          orderDate: new Date(p.orderDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }),
          expectedDel: p.expectedDelivery ? new Date(p.expectedDelivery).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—",
          actualDel: p.actualDelivery ? new Date(p.actualDelivery).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "–",
          cost: p.totalCost ? `₹${parseFloat(p.totalCost).toLocaleString("en-IN")}` : "–",
          status: p.status.toLowerCase().replace("_", "-"),
          _apiId: p.id,
        }))); else setOrdersError(true);
      if (statsRes) setApiStats(statsRes); else setStatsError(true);
      if (clientRes) setClients(clientRes.data); else setClientsError(true);
      if (supplierRes) setSuppliers(supplierRes.data); else setSuppliersError(true);
      setOrdersLoading(false); setSuppliersLoading(false); setClientsLoading(false); setStatsLoading(false);
  };

  useEffect(() => { loadAll(); }, []);

  // Auto-open PO modal if navigated from Inventory with pending PO
  useEffect(() => {
    if (pendingPO) { setTab("supplier-orders"); setShowNewPO(true); }
  }, [pendingPO]);

  const handleApprove = async (id: string) => {
    try {
      const order = clientOrders.find(o => o.id === id);
      if (!order?._apiId) throw new Error("This order is not stored in the database.");
      await approveClientOrder(order._apiId);
      await loadAll();
      showSonnerToast.success(`Client order ${id} approved successfully.`);
    } catch (err) {
      showSonnerToast.error(err instanceof Error ? err.message : "Order approval failed.");
    }
  };

  const handleDispatchDone = async (id: string) => {
    const order = clientOrders.find(o => o.id === id);
    if (!order?._apiId) throw new Error("This order is not stored in the database.");
    await dispatchClientOrder(order._apiId, {});
    await loadAll();
    showSonnerToast.success("Dispatch status updated successfully.");
  };

  const handleAddOrder = async (o: ClientOrder) => {
    const client = clients.find(c => c.name.toLowerCase() === o.client.toLowerCase());
    if (!client) throw new Error("Select an existing client before creating an order.");
    await createClientOrder({
      clientId: client.id,
      product: o.product,
      quantity: o.qty,
      unit: "pcs",
      value: parseMoney(o.value) ?? null,
      requiredDate: o.requiredDate ? new Date(o.requiredDate).toISOString() : null,
    });
    await loadAll();
    showSonnerToast.success("Client order saved successfully.");
  };

  const handleAddPO = async (po: Omit<SupplierOrder, "id" | "orderDate" | "actualDel">) => {
    const supplier = suppliers.find(s => s.name.toLowerCase() === po.supplier.toLowerCase());
    if (!supplier) throw new Error("Select an existing supplier before creating a purchase order.");
    await createPurchaseOrder({
      supplierId: supplier.id,
      material: po.material,
      quantity: parseQuantity(po.qty).quantity,
      unit: parseQuantity(po.qty).unit,
      totalCost: parseMoney(po.cost) ?? null,
      expectedDelivery: po.expectedDel ? new Date(po.expectedDel).toISOString() : null,
      notes: null,
    });
    await loadAll();
    setPendingPO(null);
    showSonnerToast.success("Purchase order saved successfully.");
  };

  const handleExport = () => {
    const rows = [
      ["Order ID", "Client", "Product", "Qty", "Order Date", "Required By", "Value", "Status"],
      ...clientOrders.map((o) => [o.id, o.client, o.product, String(o.qty), o.orderDate, o.requiredDate, o.value, o.status]),
    ];
    downloadCSV("DVS_Client_Orders.csv", rows);
    showSonnerToast.success("Orders exported to CSV");
  };

  const poPrefill = pendingPO ? { material: pendingPO.materialName, qty: pendingPO.reorderQty, cost: pendingPO.unitCost, supplier: pendingPO.preferredSupplier } : undefined;

  return (
    <>
    {showNewOrder && <NewClientOrderModal clients={clients} clientsLoading={clientsLoading} clientsError={clientsError} onClose={() => setShowNewOrder(false)} onSubmit={handleAddOrder} />}
    {showNewPO && <POModal suppliers={suppliers} suppliersLoading={suppliersLoading} suppliersError={suppliersError} prefill={poPrefill} onClose={() => { setShowNewPO(false); setPendingPO(null); }} onSubmit={handleAddPO} />}
    {selectedOrder && !dispatchOrder && (
      <OrderDetailModal
        order={selectedOrder}
        onClose={() => setSelectedOrder(null)}
        onApprove={() => handleApprove(selectedOrder.id)}
        onDispatch={() => { setDispatchOrder(selectedOrder); setSelectedOrder(null); }}
      />
    )}
    {dispatchOrder && (
      <DispatchModal
        order={dispatchOrder}
        onClose={() => setDispatchOrder(null)}
        onConfirm={() => handleDispatchDone(dispatchOrder.id)}
      />
    )}

    <div className="p-6">
      <PageHeader
        title="Orders & Supply Chain"
        subtitle="End-to-end order management — from supplier procurement to client delivery"
        actions={
          <div className="flex gap-2">
            <Btn variant="secondary" size="sm" onClick={handleExport}><Download size={14} /> Export</Btn>
            <Btn size="sm" onClick={() => setShowNewOrder(true)}><Plus size={14} /> New Order</Btn>
          </div>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        <KPICard label="Active Client Orders" value={statsLoading ? "Loading..." : statsError ? "—" : apiStats ? String(apiStats.clientOrders.total - apiStats.clientOrders.delivered - apiStats.clientOrders.cancelled) : "—"} sub="in progress" accent="#A52A2A" />
        <KPICard label="Pending Supplier POs" value={statsLoading ? "Loading..." : statsError ? "—" : apiStats ? String(apiStats.purchaseOrders.pending) : "—"} sub="awaiting processing" accent="#E65100" trendDir="down" />
        <KPICard label="Dispatched Orders" value={statsLoading ? "Loading..." : statsError ? "—" : apiStats ? String(apiStats.clientOrders.dispatched) : "—"} accent="#1565C0" />
        <KPICard label="Fulfillment Rate" value={statsLoading ? "Loading..." : statsError ? "—" : apiStats?.fulfillmentRate ?? "—"} accent="#2E7D32" />
      </div>

      <TabBar
        tabs={[
          { id: "client-orders", label: "Client Orders" },
          { id: "supplier-orders", label: "Supplier Orders" },
          { id: "supply-chain", label: "Supply Chain Flow" },
        ]}
        active={tab}
        onChange={setTab}
      />

      <div className="mt-5">
        {/* ── CLIENT ORDERS ── */}
        {tab === "client-orders" && (
          <Card>
            <CardHeader
              title="Client Orders"
              subtitle={ordersLoading ? "Loading orders..." : ordersError ? "Unable to load orders" : `${clientOrders.length} total orders`}
              actions={<Btn size="sm" onClick={() => setShowNewOrder(true)}><Plus size={13} /> New Order</Btn>}
            />
            <DataTable
              searchable
              paginate={8}
              exportFilename="DVS_Client_Orders.csv"
              emptyMsg={ordersLoading ? "Loading client orders..." : ordersError ? "Unable to load client orders." : "No client orders available."}
              columns={[
                { key: "id", label: "Order ID" },
                { key: "client", label: "Client" },
                { key: "product", label: "Product" },
                { key: "qty", label: "Qty (pcs)" },
                { key: "orderDate", label: "Order Date" },
                { key: "requiredDate", label: "Required By" },
                { key: "value", label: "Value" },
                { key: "status", label: "Status" },
                { key: "actions", label: "Actions" },
              ]}
              rows={clientOrders.map((o) => ({
                id: <span style={{ fontSize: "0.775rem", fontFamily: "JetBrains Mono, monospace", color: "#A52A2A", fontWeight: 600 }}>{o.id}</span>,
                client: <span style={{ fontWeight: 500 }}>{o.client}</span>,
                product: <span style={{ fontSize: "0.8rem" }}>{o.product}</span>,
                qty: o.qty.toLocaleString(),
                orderDate: o.orderDate,
                requiredDate: <span style={{ fontWeight: 500, color: o.status === "pending" ? "#E65100" : "#4A4A4A" }}>{o.requiredDate}</span>,
                value: <span style={{ fontWeight: 600, color: "#1C1C1C" }}>{o.value}</span>,
                status: <StatusBadge status={o.status} label={o.status.replace("-", " ")} />,
                actions: (
                  <div className="flex gap-1.5">
                    <button onClick={() => setSelectedOrder(o)} title="View details" className="p-1.5 rounded" style={{ background: "#F0F4FF", color: "#1565C0" }}><Eye size={12} /></button>
                    {o.status === "pending" && (
                      <button onClick={() => handleApprove(o.id)} title="Approve order" className="p-1.5 rounded" style={{ background: "#E8F5E9", color: "#2E7D32" }}><CheckCircle2 size={12} /></button>
                    )}
                    {o.status === "approved" && (
                      <button onClick={() => setDispatchOrder(o)} title="Dispatch order" className="p-1.5 rounded" style={{ background: "#FFF3E0", color: "#E65100" }}><Truck size={12} /></button>
                    )}
                  </div>
                ),
              }))}
            />
          </Card>
        )}

        {/* ── SUPPLIER ORDERS ── */}
        {tab === "supplier-orders" && (
          <Card>
            <CardHeader
              title="Purchase Orders"
              subtitle="Supplier procurement tracking"
              actions={<Btn size="sm" onClick={() => setShowNewPO(true)}><Plus size={13} /> Create PO</Btn>}
            />
            <DataTable
              columns={[
                { key: "id", label: "PO Number" },
                { key: "supplier", label: "Supplier" },
                { key: "material", label: "Material" },
                { key: "qty", label: "Quantity" },
                { key: "orderDate", label: "Order Date" },
                { key: "expectedDel", label: "Expected Del." },
                { key: "actualDel", label: "Actual Del." },
                { key: "cost", label: "Total Cost" },
                { key: "status", label: "Status" },
              ]}
              searchable
              paginate={8}
              exportFilename="DVS_Purchase_Orders.csv"
              emptyMsg={ordersLoading ? "Loading purchase orders..." : ordersError ? "Unable to load purchase orders." : "No purchase orders available."}
              rows={supplierOrders.map((o) => ({
                id: <span style={{ fontSize: "0.775rem", fontFamily: "JetBrains Mono, monospace", color: "#4E342E", fontWeight: 600 }}>{o.id}</span>,
                supplier: <span style={{ fontWeight: 500 }}>{o.supplier}</span>,
                material: o.material,
                qty: o.qty,
                orderDate: o.orderDate,
                expectedDel: o.expectedDel,
                actualDel: <span style={{ color: o.actualDel === "–" ? "#9A8A88" : "#2E7D32" }}>{o.actualDel}</span>,
                cost: <span style={{ fontWeight: 600 }}>{o.cost}</span>,
                status: <StatusBadge status={o.status} label={o.status.replace("-", " ")} />,
              }))}
            />
          </Card>
        )}

        {/* ── SUPPLY CHAIN ── */}
        {tab === "supply-chain" && (
          <Card>
            <CardHeader title="Supplier performance" subtitle="On-time delivery, lead time, lead-time drift and supplier grades are calculated from purchase-order history" />
            <div className="p-6 flex flex-col items-start gap-3">
              <p style={{ fontSize: "0.85rem", color: "#4A4A4A" }}>These live metrics are on the Smart Analytics page, Supplier Scorecard tab.</p>
              <Btn size="sm" onClick={() => onNavigate?.("analytics")}>Open Supplier Scorecard</Btn>
            </div>
          </Card>
        )}
      </div>
    </div>
    </>
  );
}
