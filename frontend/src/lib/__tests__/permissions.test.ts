import { describe, expect, it } from 'vitest';
import {
  analyticsTabs, canOpen, defaultSection, inventoryActions, orderActions, productionTabs,
  reportsFor, roleLabel, securityActions, sectionsFor,
} from '../permissions';
import { staffNavigation } from '../../app/components/shared/AppShell';

const sidebar = (role: string) => staffNavigation(role).map((item) => item.id);

describe('sidebar per role (mirrors the backend routes)', () => {
  it.each([
    ['ADMIN', ['dashboard', 'production', 'security', 'inventory', 'orders', 'reports', 'analytics', 'users', 'profile']],
    ['MANAGER', ['dashboard', 'production', 'security', 'inventory', 'orders', 'reports', 'analytics', 'profile']],
    ['HR', ['workforce', 'reports', 'profile']],
    ['STORE', ['inventory', 'orders', 'reports', 'analytics', 'profile']],
    ['SALES', ['orders', 'profile']],
    ['PRODUCTION', ['production', 'security', 'reports', 'profile']],
  ])('%s sees exactly its sections', (role, expected) => {
    expect(sidebar(role)).toEqual(expected);
  });

  it('gives an unknown role nothing but its profile', () => {
    expect(sidebar('PERCEPTION_SERVICE')).toEqual(['profile']);
    expect(sectionsFor(null)).toEqual([]);
  });
});

describe('opening sections', () => {
  it('allows sub-sections of an allowed section and refuses the rest', () => {
    expect(canOpen('PRODUCTION', 'security-incidents')).toBe(true);
    expect(canOpen('STORE', 'security')).toBe(false);
    expect(canOpen('HR', 'analytics')).toBe(false);
    expect(canOpen('HR', 'users')).toBe(false);
    expect(canOpen('SALES', 'profile')).toBe(true);
  });

  it('lands each role on its first section', () => {
    expect(defaultSection('ADMIN')).toBe('dashboard');
    expect(defaultSection('STORE')).toBe('inventory');
    expect(defaultSection('HR')).toBe('workforce');
    expect(defaultSection('SALES')).toBe('orders');
    expect(defaultSection('PRODUCTION')).toBe('production');
  });
});

describe('role labels', () => {
  it('names the real role instead of "Administrator" for everyone', () => {
    expect(roleLabel('MANAGER')).toBe('Plant Manager');
    expect(roleLabel('hr')).toBe('HR');
    expect(roleLabel('ADMIN')).toBe('Administrator');
  });
});

describe('tabs and reports', () => {
  it('splits production and workforce', () => {
    expect(productionTabs('HR', 'workforce')).toEqual(['workforce', 'attendance']);
    expect(productionTabs('PRODUCTION', 'production')).toEqual(['performance', 'workforce']);
    expect(productionTabs('MANAGER', 'production')).toEqual(['performance', 'workforce', 'attendance']);
  });

  it('shows Store only the inventory and supplier analyses', () => {
    expect(analyticsTabs('STORE')).toEqual(['inventory', 'suppliers']);
    expect(analyticsTabs('ADMIN')).toEqual(['health', 'inventory', 'production', 'suppliers']);
  });

  it('offers each role only the reports it can load', () => {
    expect(reportsFor('HR')).toEqual(['workforce', 'attendance']);
    expect(reportsFor('PRODUCTION')).toEqual(['production', 'security']);
    expect(reportsFor('STORE')).toEqual(['inventory', 'scrap']);
  });
});

describe('actions', () => {
  it('lets Sales write client orders but only read purchase orders', () => {
    const sales = orderActions('SALES');
    expect(sales.createClientOrder).toBe(true);
    expect(sales.managePurchaseOrders).toBe(false);
    expect(sales.dispatchClientOrder).toBe(false);
  });

  it('lets only Admin and Production make work orders from a client order', () => {
    expect(orderActions('ADMIN').createWorkOrder).toBe(true);
    expect(orderActions('PRODUCTION').createWorkOrder).toBe(true);
    expect(orderActions('MANAGER').createWorkOrder).toBe(false);
    expect(orderActions('SALES').createWorkOrder).toBe(false);
  });

  it('lets Store run purchase orders and dispatch, not approve', () => {
    const store = orderActions('STORE');
    expect(store.managePurchaseOrders).toBe(true);
    expect(store.dispatchClientOrder).toBe(true);
    expect(store.approveClientOrder).toBe(false);
    expect(store.viewStatistics).toBe(false);
  });

  it('keeps Production read-only on security and Managers read-only on inventory', () => {
    expect(securityActions('PRODUCTION').manageIncidents).toBe(false);
    expect(securityActions('MANAGER').manageIncidents).toBe(true);
    expect(inventoryActions('MANAGER').editMaterials).toBe(false);
    expect(inventoryActions('STORE').editMaterials).toBe(true);
  });
});
