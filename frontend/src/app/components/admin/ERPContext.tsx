import type { ReactNode } from "react";
import { createContext, useContext, useState } from "react";

export interface PODraft {
  materialName: string;
  materialId: string;
  currentStock: number;
  unit: string;
  reorderQty: number;
  unitCost: number;
  preferredSupplier: string;
}

export interface ERPNotification {
  id: string;
  msg: string;
  type: "info" | "success" | "warn" | "critical";
  time: string;
  read: boolean;
}

interface ERPCtx {
  pendingPO: PODraft | null;
  setPendingPO: (po: PODraft | null) => void;
  notifications: ERPNotification[];
  addNotification: (msg: string, type?: ERPNotification["type"]) => void;
  markAllRead: () => void;
  unreadCount: number;
}

const ERPContext = createContext<ERPCtx>({
  pendingPO: null,
  setPendingPO: () => {},
  notifications: [],
  addNotification: () => {},
  markAllRead: () => {},
  unreadCount: 0,
});

export function ERPProvider({ children }: { children: ReactNode }) {
  const [pendingPO, setPendingPO] = useState<PODraft | null>(null);
  const notifications: ERPNotification[] = [];
  const addNotification = () => {};
  const markAllRead = () => {};
  const unreadCount = 0;

  return (
    <ERPContext.Provider value={{ pendingPO, setPendingPO, notifications, addNotification, markAllRead, unreadCount }}>
      {children}
    </ERPContext.Provider>
  );
}

export function useERP() {
  return useContext(ERPContext);
}
