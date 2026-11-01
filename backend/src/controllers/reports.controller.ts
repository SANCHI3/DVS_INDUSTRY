import type { Request, Response } from 'express';
import { ReportsService } from '../services/reports.service';
import { sendSuccess } from '../utils/response';
import type { ReportQueryInput, AttendanceReportQueryInput } from '../validators/reports.validator';
import type { ReportFilters, AttendanceReportFilters } from '../interfaces';

const svc = new ReportsService();

function buildFilters(q: ReportQueryInput): ReportFilters {
  const filters: ReportFilters = {};
  if (q.fromDate !== undefined) filters.fromDate = q.fromDate;
  if (q.toDate !== undefined) filters.toDate = q.toDate;
  if (q.departmentId !== undefined) filters.departmentId = q.departmentId;
  return filters;
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export async function getDashboardKPIs(_req: Request, res: Response): Promise<void> {
  const kpis = await svc.getDashboardKPIs();
  sendSuccess(res, kpis);
}

export async function getDashboardCharts(_req: Request, res: Response): Promise<void> {
  const charts = await svc.getDashboardCharts();
  sendSuccess(res, charts);
}

// Combined single endpoint for dashboard (KPIs + charts in one call)
export async function getDashboard(_req: Request, res: Response): Promise<void> {
  const [kpis, charts] = await Promise.all([svc.getDashboardKPIs(), svc.getDashboardCharts()]);
  sendSuccess(res, { kpis, charts });
}

// ── Reports ───────────────────────────────────────────────────────────────────

export async function getInventoryReport(req: Request, res: Response): Promise<void> {
  const q = req.query as unknown as ReportQueryInput;
  const report = await svc.getInventoryReport(buildFilters(q));
  sendSuccess(res, report, 200, 'Inventory report generated');
}

export async function getWorkforceReport(req: Request, res: Response): Promise<void> {
  const q = req.query as unknown as ReportQueryInput;
  const report = await svc.getWorkforceReport(buildFilters(q));
  sendSuccess(res, report, 200, 'Workforce report generated');
}

export async function getOrdersReport(req: Request, res: Response): Promise<void> {
  const q = req.query as unknown as ReportQueryInput;
  const report = await svc.getOrdersReport(buildFilters(q));
  sendSuccess(res, report, 200, 'Orders report generated');
}

export async function getScrapReport(req: Request, res: Response): Promise<void> {
  const q = req.query as unknown as ReportQueryInput;
  const report = await svc.getScrapReport(buildFilters(q));
  sendSuccess(res, report, 200, 'Scrap report generated');
}

export async function getSupplierReport(req: Request, res: Response): Promise<void> {
  const q = req.query as unknown as ReportQueryInput;
  const report = await svc.getSupplierReport(buildFilters(q));
  sendSuccess(res, report, 200, 'Supplier report generated');
}

export async function getClientReport(req: Request, res: Response): Promise<void> {
  const q = req.query as unknown as ReportQueryInput;
  const report = await svc.getClientReport(buildFilters(q));
  sendSuccess(res, report, 200, 'Client report generated');
}

export async function getAttendanceReport(req: Request, res: Response): Promise<void> {
  const q = req.query as unknown as AttendanceReportQueryInput;
  const filters: AttendanceReportFilters = {
    ...(q.fromDate !== undefined && { fromDate: q.fromDate }),
    ...(q.toDate !== undefined && { toDate: q.toDate }),
    ...(q.departmentId !== undefined && { departmentId: q.departmentId }),
    sortBy: q.sortBy,
    sortOrder: q.sortOrder,
  };
  const report = await svc.getAttendanceReport(filters);
  sendSuccess(res, report, 200, 'Attendance report generated');
}

export async function getProductionReport(req: Request, res: Response): Promise<void> {
  const q = req.query as unknown as ReportQueryInput;
  const report = await svc.getProductionReport(buildFilters(q));
  sendSuccess(res, report, 200, 'Production report generated');
}

export async function getSecurityReport(req: Request, res: Response): Promise<void> {
  const q = req.query as unknown as ReportQueryInput;
  const report = await svc.getSecurityReport(buildFilters(q));
  sendSuccess(res, report, 200, 'Security report generated');
}
