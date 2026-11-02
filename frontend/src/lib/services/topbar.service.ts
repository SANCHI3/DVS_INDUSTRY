import api, { unwrap } from '../api';

export interface StaffNotification {
  id: string;
  kind: 'incident' | 'camera' | 'low-stock' | 'overdue-po' | 'overdue-order' | 'inquiry';
  severity: 'critical' | 'warn' | 'info';
  message: string;
  at: string;
  /** Where the item lives in the app, as a section hash. */
  section: string;
  unread: boolean;
}

export async function getNotifications(): Promise<{ items: StaffNotification[]; unreadCount: number }> {
  const res = await api.get<{ success: true; data: { items: StaffNotification[]; unreadCount: number } }>('/notifications');
  return unwrap(res);
}

/** Everything up to now counts as read. */
export async function markNotificationsSeen(): Promise<void> {
  await api.post('/notifications/seen', {});
}

export interface SearchResult {
  kind: 'employee' | 'work-order' | 'client-order' | 'purchase-order' | 'material';
  id: number;
  title: string;
  subtitle: string;
}

export async function searchRecords(q: string): Promise<SearchResult[]> {
  const res = await api.get<{ success: true; data: SearchResult[] }>('/search', { params: { q } });
  return unwrap(res);
}

/** The section a search result opens, for the signed-in role. */
export function sectionForResult(kind: SearchResult['kind'], canOpen: (section: string) => boolean): string {
  switch (kind) {
    case 'employee': return canOpen('production') ? 'production-workforce' : 'workforce-workforce';
    case 'work-order': return 'production-performance';
    case 'client-order': return 'orders-client';
    case 'purchase-order': return 'orders-supplier';
    case 'material': return 'inventory-materials';
  }
}
