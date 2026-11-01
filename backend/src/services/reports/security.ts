import { prisma } from '../../lib/prismaClient';
import { logger } from '../../logger';
import type { SecurityReport, SecurityReportRow, ReportFilters } from '../../interfaces';
import { fmtDate, buildDateWhere, buildPeriodLabel } from './helpers';

const HOUR_MS = 60 * 60 * 1000;

export async function getSecurityReport(filters: ReportFilters): Promise<SecurityReport> {
  logger.info('Generating security report', filters);

  const dateWhere = buildDateWhere(filters, 'occurredAt');
  const deptWhere = filters.departmentId ? { departmentId: filters.departmentId } : {};

  const [incidents, alerts] = await prisma.$transaction([
    prisma.securityIncident.findMany({
      where: { deletedAt: null, ...deptWhere, ...(dateWhere ? { occurredAt: dateWhere } : {}) },
      orderBy: { occurredAt: 'desc' },
      select: {
        incidentNumber: true,
        title: true,
        type: true,
        severity: true,
        status: true,
        location: true,
        departmentName: true,
        reportedByName: true,
        assignedToName: true,
        occurredAt: true,
        resolvedAt: true,
      },
    }),
    prisma.securityAlert.findMany({
      where: { ...deptWhere, ...(dateWhere ? { createdAt: dateWhere } : {}) },
      select: { status: true },
    }),
  ]);

  let open = 0,
    investigating = 0,
    resolved = 0,
    closed = 0;
  let critical = 0,
    high = 0;
  let resolutionHoursTotal = 0,
    resolutionCount = 0;

  const typeAgg = new Map<string, number>();
  type DeptAgg = { incidents: number; open: number; critical: number };
  const deptAgg = new Map<string, DeptAgg>();

  const rows: SecurityReportRow[] = incidents.map((inc) => {
    if (inc.status === 'OPEN') open++;
    else if (inc.status === 'INVESTIGATING') investigating++;
    else if (inc.status === 'RESOLVED') resolved++;
    else if (inc.status === 'CLOSED') closed++;

    if (inc.severity === 'CRITICAL') critical++;
    else if (inc.severity === 'HIGH') high++;

    let resolutionHours = '—';
    if (inc.resolvedAt) {
      const hours = (inc.resolvedAt.getTime() - inc.occurredAt.getTime()) / HOUR_MS;
      resolutionHoursTotal += hours;
      resolutionCount++;
      resolutionHours = hours.toFixed(1);
    }

    typeAgg.set(inc.type, (typeAgg.get(inc.type) ?? 0) + 1);

    const deptKey = inc.departmentName ?? '—';
    const da = deptAgg.get(deptKey) ?? { incidents: 0, open: 0, critical: 0 };
    da.incidents++;
    if (inc.status === 'OPEN' || inc.status === 'INVESTIGATING') da.open++;
    if (inc.severity === 'CRITICAL') da.critical++;
    deptAgg.set(deptKey, da);

    return {
      incidentNumber: inc.incidentNumber,
      title: inc.title,
      type: inc.type,
      severity: inc.severity,
      status: inc.status,
      department: deptKey,
      location: inc.location ?? '—',
      reportedBy: inc.reportedByName ?? '—',
      assignedTo: inc.assignedToName ?? '—',
      occurredAt: fmtDate(inc.occurredAt),
      resolvedAt: fmtDate(inc.resolvedAt),
      resolutionHours,
    };
  });

  const activeAlerts = alerts.filter((a) => a.status === 'ACTIVE').length;
  const acknowledgedAlerts = alerts.filter((a) => a.status === 'ACKNOWLEDGED').length;

  return {
    generatedAt: new Date().toISOString(),
    period: buildPeriodLabel(filters),
    summary: {
      totalIncidents: incidents.length,
      open,
      investigating,
      resolved,
      closed,
      critical,
      high,
      avgResolutionHours:
        resolutionCount > 0 ? (resolutionHoursTotal / resolutionCount).toFixed(1) : '—',
      totalAlerts: alerts.length,
      activeAlerts,
      acknowledgedAlerts,
      byType: Array.from(typeAgg.entries())
        .map(([type, count]) => ({ type, incidents: count }))
        .sort((a, b) => b.incidents - a.incidents),
      byDepartment: Array.from(deptAgg.entries())
        .map(([department, da]) => ({ department, ...da }))
        .sort((a, b) => b.incidents - a.incidents),
    },
    rows,
  };
}
