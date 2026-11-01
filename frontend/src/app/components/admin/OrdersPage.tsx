import { useEffect, useMemo, useState } from "react";
import { toast as showSonnerToast } from "sonner";
import { BarChart3, Plus, Download, Eye, CheckCircle2, Truck, PackageCheck } from "lucide-react";
import { PageHeader, Card, CardHeader, KPICard, StatusBadge, Btn, DataTable, TabBar } from "../shared/UI";
import { useERP } from "./ERPContext";
import {
  getClientOrders, getPurchaseOrders, getOrderStats, getClients, getSuppliers,
  approveClientOrder, dispatchClientOrder, createClientOrder, createPurchaseOrder,
  confirmPurchaseOrder, deliverPurchaseOrder,
  type OrderStatistics, type ClientDto, type SupplierDto,
} from "../../../lib/services/orders.service";
import { downloadCSV } from "../../../lib/csv";
import { getStoredBackendRole } from "../../../lib/auth";
import { PortalInbox } from "./orders/PortalInbox";
import { canOpen, orderActions } from "../../../lib/permissions";
import { daysOverdue, overdueFirst, overdueLabel } from "../../../lib/overdue";

import {
  parseMoney, parseQuantity, POModal, OrderDetailModal, DispatchModal, NewClientOrderModal, ReceivePOModal, type ClientOrder, type SupplierOrder,
} from "./orders/OrderModals";
import { WorkOrderDialog, type WorkOrderSource } from "./production/WorkOrderDialogs";
import { getDepartments } from "../../../lib/services/departments.service";
import { getMaterials, getPartSpecs } from "../../../lib/services/inventory.service";
import { useApiData } from "../../../lib/useApiData";
import { formatINR } from "../../../lib/format";
import { useTabHash } from "../../../lib/useTabHash";
import { receivedText } from "../../../lib/materialUse";

/** "1 of 2 done" for the work orders linked to a client order. */
export function workOrderProgressText(p: { total: number; completed: number } | undefined): string {
  if (!p || p.total === 0) return "No work order";
  return p.completed === p.total ? `${p.total} done` : `${p.completed} of ${p.total} done`;
}

/** A due date, with "Overdue by N days" under it when it has passed. */
function DueDate({ date, overdueDays }: { date: string; overdueDays: number }) {
  return (
    <span className="flex flex-col">
      <span style={{ fontWeight: 500, color: overdueDays > 0 ? "#C0392B" : "#4A4A4A" }}>{date}</span>
      {overdueDays > 0 && (
        <span className="mt-0.5 self-start rounded-full px-2 py-0.5" style={{ fontSize: "0.66rem", fontWeight: 700, background: "#FFEBEE", color: "#C0392B", whiteSpace: "nowrap" }}>
          {overdueLabel(overdueDays)}
        </span>
      )}
    </span>
  );
}

export function OrdersPage({ onNavigate }: { onNavigate?: (section: string) => void }) {
  // Buttons the signed-in role can use (the backend rejects the rest)
  const actions = useMemo(() => orderActions(getStoredBackendRole()), []);
  const orderTabs = useMemo(() => ["client", "supplier", ...(orderActions(getStoredBackendRole()).portalMessages ? ["portal-messages"] : [])], []);
  const [tab, setTab]                       = useTabHash("orders", orderTabs);
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
  const [receivePO, setReceivePO]           = useState<SupplierOrder | null>(null);
  const [workOrderFor, setWorkOrderFor]     = useState<WorkOrderSource | null>(null);
  // Pickers: Parts Master for client orders, stock materials for POs, departments for work orders
  const parts = useApiData(() => getPartSpecs(), [], "load the Parts Master", actions.createClientOrder);
  const stockMaterials = useApiData(() => getMaterials({ pageSize: 100 }).then((r) => r.data), [], "load materials", actions.managePurchaseOrders);
  const departments = useApiData(() => getDepartments({ pageSize: 100 }), [], "load departments", workOrderFor !== null);
  const { pendingPO, setPendingPO } = useERP();

  // ── Load real data ──────────────────────────────────────────────────────────
  const loadAll = async (): Promise<void> => {
    setOrdersLoading(true); setSuppliersLoading(true); setClientsLoading(true); setStatsLoading(true);
    setOrdersError(false); setSuppliersError(false); setClientsError(false); setStatsError(false);
    const [coRes, poRes, statsRes, clientRes, supplierRes] = await Promise.all([
      getClientOrders({ pageSize: 50, sortOrder: "desc" }).catch(() => null),
      getPurchaseOrders({ pageSize: 50, sortOrder: "desc" }).catch(() => null),
      (orderActions(getStoredBackendRole()).viewStatistics ? getOrderStats() : Promise.resolve(null)).catch(() => null),
      getClients({ pageSize: 100 }).catch(() => null),
      getSuppliers({ pageSize: 100 }).catch(() => null),
    ]);

        if (coRes) setClientOrders(overdueFirst(coRes.data.map(o => ({
          id: o.orderNumber,
          client: o.clientName,
          product: o.product,
          qty: o.quantity,
          orderDate: new Date(o.orderDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }),
          requiredDate: o.requiredDate ? new Date(o.requiredDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—",
          status: o.status.toLowerCase().replace("_", "-"),
          value: o.value ? formatINR(o.value) : "—",
          dispatch: o.dispatchDate ? new Date(o.dispatchDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : undefined,
          delivery: o.deliveryDate ? new Date(o.deliveryDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : undefined,
          overdueDays: daysOverdue(o.requiredDate, o.status),
          partSpecId: o.partSpecId ?? null,
          workOrders: o.workOrderProgress,
          _apiId: o.id,
        })))); else setOrdersError(true);
    if (poRes) setSupplierOrders(overdueFirst(poRes.data.map(p => ({
          id: p.poNumber,
          supplier: p.supplierName,
          material: p.material,
          qty: p.unit ? `${p.quantity} ${p.unit}` : p.quantity,
          orderDate: new Date(p.orderDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }),
          expectedDel: p.expectedDelivery ? new Date(p.expectedDelivery).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—",
          actualDel: p.actualDelivery ? new Date(p.actualDelivery).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "–",
          cost: p.totalCost ? formatINR(p.totalCost) : "—",
          status: p.status.toLowerCase().replace("_", "-"),
          overdueDays: daysOverdue(p.expectedDelivery, p.status),
          materialId: p.materialId ?? null,
          orderedQty: p.quantityValue ?? null,
          receivedQty: p.receivedQty ?? "0",
          unit: p.unit,
          _apiId: p.id,
        })))); else setOrdersError(true);
      if (statsRes) setApiStats(statsRes); else setStatsError(true);
      if (clientRes) setClients(clientRes.data); else setClientsError(true);
      if (supplierRes) setSuppliers(supplierRes.data); else setSuppliersError(true);
      setOrdersLoading(false); setSuppliersLoading(false); setClientsLoading(false); setStatsLoading(false);
  };

  useEffect(() => { loadAll(); }, []);

  // Auto-open PO modal if navigated from Inventory with pending PO
  useEffect(() => {
    if (pendingPO) { setTab("supplier"); setShowNewPO(true); }
  }, [pendingPO, setTab]);

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
    const client = clients.find(c => c.id === o.clientId);
    if (!client) throw new Error("Select an existing client before creating an order.");
    await createClientOrder({
      clientId: client.id,
      product: o.product,
      quantity: o.qty,
      unit: "pcs",
      value: parseMoney(o.value) ?? null,
      ...(o.partSpecId ? { partSpecId: o.partSpecId } : {}),
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
      ...(po.materialId ? { materialId: po.materialId } : {}),
      notes: null,
    });
    await loadAll();
    setPendingPO(null);
    showSonnerToast.success("Purchase order saved successfully.");
  };

  const handleConfirmPO = async (o: SupplierOrder) => {
    try {
      await confirmPurchaseOrder(o._apiId!);
      await loadAll();
      showSonnerToast.success(`${o.id} confirmed.`);
    } catch (err) {
      showSonnerToast.error(err instanceof Error ? err.message : "The purchase order could not be confirmed.");
    }
  };

  const handleReceivePO = async (o: SupplierOrder, quantity: number | undefined) => {
    const po = await deliverPurchaseOrder(o._apiId!, quantity);
    await loadAll();
    showSonnerToast.success(
      o.materialId != null
        ? `${quantity} ${o.unit ?? ""} of ${o.material} added to stock${po.status === "DELIVERED" ? `; ${o.id} is fully received.` : "."}`
        : `${o.id} marked delivered.`,
    );
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
    {showNewOrder && <NewClientOrderModal clients={clients} clientsLoading={clientsLoading} clientsError={clientsError} parts={parts.data ?? []} onClose={() => setShowNewOrder(false)} onSubmit={handleAddOrder} />}
    {showNewPO && <POModal suppliers={suppliers} suppliersLoading={suppliersLoading} suppliersError={suppliersError} materials={stockMaterials.data ?? []} prefill={poPrefill} onClose={() => { setShowNewPO(false); setPendingPO(null); }} onSubmit={handleAddPO} />}
    {receivePO && <ReceivePOModal order={receivePO} onClose={() => setReceivePO(null)} onReceive={(q) => handleReceivePO(receivePO, q)} />}
    {workOrderFor && (
      <WorkOrderDialog
        departments={departments.data ?? []}
        from={workOrderFor}
        onClose={() => setWorkOrderFor(null)}
        onSaved={(wo) => { showSonnerToast.success(`${wo.workOrderNumber} created for ${workOrderFor.orderNumber}.`); setWorkOrderFor(null); void loadAll(); }}
      />
    )}
    {selectedOrder && !dispatchOrder && (
      <OrderDetailModal
        order={selectedOrder}
        onClose={() => setSelectedOrder(null)}
        {...(actions.approveClientOrder && { onApprove: () => handleApprove(selectedOrder.id) })}
        {...(actions.dispatchClientOrder && { onDispatch: () => { setDispatchOrder(selectedOrder); setSelectedOrder(null); } })}
        {...(actions.createWorkOrder && selectedOrder._apiId !== undefined && {
          onCreateWorkOrder: () => setWorkOrderFor({
            clientOrderId: selectedOrder._apiId!, orderNumber: selectedOrder.id, product: selectedOrder.product,
            quantity: selectedOrder.qty, partSpecId: selectedOrder.partSpecId ?? null,
          }),
        })}
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
            {canOpen(getStoredBackendRole(), "analytics") && <Btn variant="secondary" size="sm" onClick={() => onNavigate?.("analytics")}><BarChart3 size={14} /> Supplier Scorecard</Btn>}
            <Btn variant="secondary" size="sm" onClick={handleExport}><Download size={14} /> Export</Btn>
            {actions.createClientOrder && <Btn size="sm" onClick={() => setShowNewOrder(true)}><Plus size={14} /> New Order</Btn>}
          </div>
        }
      />

      {actions.viewStatistics && <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        <KPICard label="Active Client Orders" value={statsLoading ? "Loading..." : statsError ? "—" : apiStats ? String(apiStats.clientOrders.total - apiStats.clientOrders.delivered - apiStats.clientOrders.cancelled) : "—"} sub={apiStats?.clientOrders.overdue ? `${apiStats.clientOrders.overdue} overdue` : "in progress"} accent="#A52A2A" />
        <KPICard label="Pending Supplier POs" value={statsLoading ? "Loading..." : statsError ? "—" : apiStats ? String(apiStats.purchaseOrders.pending) : "—"} sub={apiStats?.purchaseOrders.overdue ? `${apiStats.purchaseOrders.overdue} past expected delivery` : "awaiting processing"} accent="#E65100" trendDir="down" />
        <KPICard label="Dispatched Orders" value={statsLoading ? "Loading..." : statsError ? "—" : apiStats ? String(apiStats.clientOrders.dispatched) : "—"} accent="#1565C0" />
        <KPICard label="Fulfillment Rate" value={statsLoading ? "Loading..." : statsError ? "—" : apiStats?.fulfillmentRate ?? "—"} accent="#2E7D32" />
      </div>}

      <TabBar
        tabs={[
          { id: "client", label: "Client Orders" },
          { id: "supplier", label: "Supplier Orders" },
          ...(actions.portalMessages ? [{ id: "portal-messages", label: "Portal Messages" }] : []),
        ]}
        active={tab}
        onChange={setTab}
      />

      <div className="mt-5">
        {/* ── CLIENT ORDERS ── */}
        {tab === "client" && (
          <Card>
            <CardHeader
              title="Client Orders"
              subtitle={ordersLoading ? "Loading orders..." : ordersError ? "Unable to load orders" : `${clientOrders.length} total orders`}
              actions={actions.createClientOrder ? <Btn size="sm" onClick={() => setShowNewOrder(true)}><Plus size={13} /> New Order</Btn> : undefined}
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
                { key: "production", label: "Work Orders" },
                { key: "status", label: "Status" },
                { key: "actions", label: "Actions" },
              ]}
              rows={clientOrders.map((o) => ({
                id: <span style={{ fontSize: "0.775rem", fontFamily: "JetBrains Mono, monospace", color: "#A52A2A", fontWeight: 600 }}>{o.id}</span>,
                client: <span style={{ fontWeight: 500 }}>{o.client}</span>,
                product: <span style={{ fontSize: "0.8rem" }}>{o.product}</span>,
                qty: o.qty.toLocaleString(),
                orderDate: o.orderDate,
                requiredDate: <DueDate date={o.requiredDate} overdueDays={o.overdueDays ?? 0} />,
                value: <span style={{ fontWeight: 600, color: "#1C1C1C" }}>{o.value}</span>,
                production: <span style={{ fontSize: "0.775rem", color: o.workOrders && o.workOrders.total > 0 && o.workOrders.completed === o.workOrders.total ? "#2E7D32" : "#7A6C6A" }}>{workOrderProgressText(o.workOrders)}</span>,
                status: <StatusBadge status={o.status} label={o.status.replace("-", " ")} />,
                actions: (
                  <div className="flex gap-1.5">
                    <button onClick={() => setSelectedOrder(o)} title="View details" className="p-1.5 rounded" style={{ background: "#F0F4FF", color: "#1565C0" }}><Eye size={12} /></button>
                    {o.status === "pending" && actions.approveClientOrder && (
                      <button onClick={() => handleApprove(o.id)} title="Approve order" className="p-1.5 rounded" style={{ background: "#E8F5E9", color: "#2E7D32" }}><CheckCircle2 size={12} /></button>
                    )}
                    {o.status === "approved" && actions.dispatchClientOrder && (
                      <button onClick={() => setDispatchOrder(o)} title="Dispatch order" className="p-1.5 rounded" style={{ background: "#FFF3E0", color: "#E65100" }}><Truck size={12} /></button>
                    )}
                  </div>
                ),
              }))}
            />
          </Card>
        )}

        {/* ── SUPPLIER ORDERS ── */}
        {tab === "supplier" && (
          <Card>
            <CardHeader
              title="Purchase Orders"
              subtitle="Supplier procurement tracking"
              actions={actions.managePurchaseOrders ? <Btn size="sm" onClick={() => setShowNewPO(true)}><Plus size={13} /> Create PO</Btn> : undefined}
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
                ...(actions.managePurchaseOrders ? [{ key: "actions", label: "Actions" }] : []),
              ]}
              searchable
              paginate={8}
              exportFilename="DVS_Purchase_Orders.csv"
              emptyMsg={ordersLoading ? "Loading purchase orders..." : ordersError ? "Unable to load purchase orders." : "No purchase orders available."}
              rows={supplierOrders.map((o) => ({
                id: <span style={{ fontSize: "0.775rem", fontFamily: "JetBrains Mono, monospace", color: "#4E342E", fontWeight: 600 }}>{o.id}</span>,
                supplier: <span style={{ fontWeight: 500 }}>{o.supplier}</span>,
                material: o.material,
                qty: o.materialId != null && Number(o.receivedQty ?? 0) > 0 && o.status !== "delivered"
                  ? <span className="flex flex-col"><span>{o.qty}</span><span style={{ fontSize: "0.7rem", color: "#7A6C6A" }}>{receivedText(o.orderedQty ?? null, o.receivedQty, o.unit ?? null)}</span></span>
                  : o.qty,
                orderDate: o.orderDate,
                expectedDel: <DueDate date={o.expectedDel} overdueDays={o.overdueDays ?? 0} />,
                actualDel: <span style={{ color: o.actualDel === "–" ? "#9A8A88" : "#2E7D32" }}>{o.actualDel}</span>,
                cost: <span style={{ fontWeight: 600 }}>{o.cost}</span>,
                status: <StatusBadge status={o.status} label={o.status.replace("-", " ")} />,
                actions: (
                  <div className="flex gap-1.5">
                    {o.status === "pending" && (
                      <button onClick={() => void handleConfirmPO(o)} title="Confirm purchase order" aria-label={`Confirm ${o.id}`} className="p-1.5 rounded" style={{ background: "#E8F5E9", color: "#2E7D32" }}><CheckCircle2 size={12} /></button>
                    )}
                    {(o.status === "confirmed" || o.status === "in-transit") && (
                      <button onClick={() => setReceivePO(o)} title="Receive delivery" aria-label={`Receive ${o.id}`} className="p-1.5 rounded" style={{ background: "#E3F2FD", color: "#1565C0" }}><PackageCheck size={12} /></button>
                    )}
                  </div>
                ),
              }))}
            />
          </Card>
        )}

        {/* ── PORTAL MESSAGES ── */}
        {tab === "portal-messages" && <PortalInbox suppliers={suppliers} clients={clients} />}
      </div>
    </div>
    </>
  );
}
