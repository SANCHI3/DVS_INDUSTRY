import type {
  DashboardKPIs,
  DashboardCharts,
  InventoryReport,
  WorkforceReport,
  OrdersReport,
  ScrapReport,
  SupplierReport,
  ClientReport,
  AttendanceReport,
  AttendanceReportFilters,
  ProductionReport,
  ReportFilters,
} from '../interfaces';
import * as dashboardReports from './reports/dashboard';
import * as inventoryReports from './reports/inventory';
import * as workforceReports from './reports/workforce';
import * as ordersReports from './reports/orders';
import * as productionReports from './reports/production';

/**
 * Report and dashboard queries. Each report lives in services/reports/; this
 * class keeps the interface the controller and tests use.
 */
export class ReportsService {
  getDashboardKPIs(): Promise<DashboardKPIs> {
    return dashboardReports.getDashboardKPIs();
  }

  getDashboardCharts(): Promise<DashboardCharts> {
    return dashboardReports.getDashboardCharts();
  }

  getInventoryReport(filters: ReportFilters): Promise<InventoryReport> {
    return inventoryReports.getInventoryReport(filters);
  }

  getWorkforceReport(filters: ReportFilters): Promise<WorkforceReport> {
    return workforceReports.getWorkforceReport(filters);
  }

  getOrdersReport(filters: ReportFilters): Promise<OrdersReport> {
    return ordersReports.getOrdersReport(filters);
  }

  getScrapReport(filters: ReportFilters): Promise<ScrapReport> {
    return inventoryReports.getScrapReport(filters);
  }

  getSupplierReport(filters: ReportFilters): Promise<SupplierReport> {
    return ordersReports.getSupplierReport(filters);
  }

  getClientReport(filters: ReportFilters): Promise<ClientReport> {
    return ordersReports.getClientReport(filters);
  }

  getAttendanceReport(filters: AttendanceReportFilters): Promise<AttendanceReport> {
    return workforceReports.getAttendanceReport(filters);
  }

  getProductionReport(filters: ReportFilters): Promise<ProductionReport> {
    return productionReports.getProductionReport(filters);
  }
}
