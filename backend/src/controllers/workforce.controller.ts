import type { Request, Response } from 'express';
import type { AuthenticatedRequest } from '../types';
import { WorkforceService } from '../services/workforce.service';
import { sendSuccess, sendCreated, sendNoContent } from '../utils/response';
import { BadRequestError } from '../errors';
import {
  checkAttendanceUpload,
  importAttendanceUpload,
  parseUpload,
  prismaAttendanceUploadRepository,
} from '../services/attendance-upload.service';
import {
  prismaSheetEmployeeRepository,
  registerSheetEmployees,
} from '../services/attendance-sheet-employees.service';
import type {
  CreateShiftInput,
  UpdateShiftInput,
  ShiftQueryInput,
  CreateAttendanceInput,
  UpdateAttendanceInput,
  ClockInInput,
  ClockOutInput,
  BulkAttendanceInput,
  AttendanceQueryInput,
  AttendanceSummaryInput,
  AttendanceTrendInput,
  CreateEmployeeOutputInput,
  UpdateEmployeeOutputInput,
  EmployeeOutputQueryInput,
  EmployeeOutputSummaryInput,
  AttendanceImportInput,
  RegisterSheetEmployeesInput,
} from '../validators/workforce.validator';
import type {
  ShiftFilters,
  AttendanceFilters,
  UpdateAttendanceData,
  UpdateShiftData,
  BulkAttendanceEntry,
  EmployeeDailyOutputFilters,
  UpdateEmployeeDailyOutputData,
} from '../interfaces';

const svc = new WorkforceService();

function parseId(raw: string | string[] | undefined): number {
  return parseInt(String(raw ?? '0'), 10);
}

// ══ SHIFTS ════════════════════════════════════════════════════════════════════

export async function createShift(req: Request, res: Response): Promise<void> {
  const body = req.body as CreateShiftInput;
  const shift = await svc.createShift({
    name: body.name,
    startTime: body.startTime,
    endTime: body.endTime,
    isNightShift: body.isNightShift,
    description: body.description ?? null,
  });
  sendCreated(res, shift, 'Shift created successfully');
}

export async function getAllShifts(req: Request, res: Response): Promise<void> {
  const q = req.query as unknown as ShiftQueryInput;
  const filters: ShiftFilters = {
    page: q.page,
    pageSize: q.pageSize,
    sortBy: q.sortBy,
    sortOrder: q.sortOrder,
  };
  if (q.search !== undefined) filters.search = q.search;

  const { data, total } = await svc.getAllShifts(filters);
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 50;
  sendSuccess(res, data, 200, undefined, {
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  });
}

export async function getShiftById(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await svc.getShiftById(parseId(req.params['id'])));
}

export async function updateShift(req: Request, res: Response): Promise<void> {
  const id = parseId(req.params['id']);
  const body = req.body as UpdateShiftInput;
  const data: UpdateShiftData = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.startTime !== undefined) data.startTime = body.startTime;
  if (body.endTime !== undefined) data.endTime = body.endTime;
  if (body.isNightShift !== undefined) data.isNightShift = body.isNightShift;
  if (body.description !== undefined) data.description = body.description;

  sendSuccess(res, await svc.updateShift(id, data), 200, 'Shift updated successfully');
}

export async function deleteShift(req: Request, res: Response): Promise<void> {
  await svc.deleteShift(parseId(req.params['id']));
  sendNoContent(res);
}

// ══ ATTENDANCE ════════════════════════════════════════════════════════════════

export async function createAttendance(req: Request, res: Response): Promise<void> {
  const body = req.body as CreateAttendanceInput;
  const record = await svc.createAttendance({
    employeeId: body.employeeId,
    date: body.date,
    status: body.status,
    clockIn: body.clockIn ?? null,
    clockOut: body.clockOut ?? null,
    remarks: body.remarks ?? null,
  });
  sendCreated(res, record, 'Attendance recorded successfully');
}

export async function getAllAttendance(req: Request, res: Response): Promise<void> {
  const q = req.query as unknown as AttendanceQueryInput;
  const filters: AttendanceFilters = {
    page: q.page,
    pageSize: q.pageSize,
    sortOrder: q.sortOrder,
    status: q.status,
  };
  if (q.search !== undefined) filters.search = q.search;
  if (q.employeeId !== undefined) filters.employeeId = q.employeeId;
  if (q.departmentId !== undefined) filters.departmentId = q.departmentId;
  if (q.date !== undefined) filters.date = q.date;
  if (q.fromDate !== undefined) filters.fromDate = q.fromDate;
  if (q.toDate !== undefined) filters.toDate = q.toDate;

  const { data, total } = await svc.getAllAttendance(filters);
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 20;
  sendSuccess(res, data, 200, undefined, {
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  });
}

export async function getAttendanceById(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await svc.getAttendanceById(parseId(req.params['id'])));
}

export async function updateAttendance(req: Request, res: Response): Promise<void> {
  const id = parseId(req.params['id']);
  const body = req.body as UpdateAttendanceInput;
  const data: UpdateAttendanceData = {};
  if (body.status !== undefined) data.status = body.status;
  if (body.clockIn !== undefined) data.clockIn = body.clockIn;
  if (body.clockOut !== undefined) data.clockOut = body.clockOut;
  if (body.remarks !== undefined) data.remarks = body.remarks;

  sendSuccess(res, await svc.updateAttendance(id, data), 200, 'Attendance updated successfully');
}

export async function deleteAttendance(req: Request, res: Response): Promise<void> {
  await svc.deleteAttendance(parseId(req.params['id']));
  sendNoContent(res);
}

// ── Clock in ──────────────────────────────────────────────────────────────────

export async function clockIn(req: AuthenticatedRequest, res: Response): Promise<void> {
  const body = req.body as ClockInInput;
  const record = await svc.clockIn(
    body.employeeId,
    body.clockIn ?? new Date(),
    body.remarks ?? null,
  );
  sendCreated(res, record, 'Clock-in recorded successfully');
}

// ── Clock out ─────────────────────────────────────────────────────────────────

export async function clockOut(req: Request, res: Response): Promise<void> {
  const id = parseId(req.params['id']);
  const body = req.body as ClockOutInput;
  const record = await svc.clockOut(id, body.clockOut ?? new Date(), body.remarks ?? null);
  sendSuccess(res, record, 200, 'Clock-out recorded successfully');
}

// ── Bulk attendance ────────────────────────────────────────────────────────────

export async function bulkMarkAttendance(req: Request, res: Response): Promise<void> {
  const body = req.body as BulkAttendanceInput;
  const entries: BulkAttendanceEntry[] = body.entries.map((e) => ({
    employeeId: e.employeeId,
    status: e.status,
    clockIn: e.clockIn ?? null,
    clockOut: e.clockOut ?? null,
    remarks: e.remarks ?? null,
  }));
  const result = await svc.bulkMark(body.date, entries);
  const skipped = result.skippedEmployeeIds.length;
  sendSuccess(
    res,
    result,
    200,
    `Attendance created for ${result.created} employees` +
      (skipped > 0 ? `; ${skipped} already had a record and were left unchanged` : ''),
  );
}

// ── Excel upload ──────────────────────────────────────────────────────────────

function uploadedSheet(req: Request): { buffer: Buffer; fileName: string } {
  const file = (req as Request & { file?: Express.Multer.File }).file;
  if (file === undefined) throw new BadRequestError('Choose an Excel file to upload');
  return { buffer: file.buffer, fileName: file.originalname };
}

/** Checks the sheet and returns every row's result. Writes nothing. */
export async function previewAttendanceImport(req: Request, res: Response): Promise<void> {
  const { date } = req.body as AttendanceImportInput;
  const { buffer, fileName } = uploadedSheet(req);
  const report = await checkAttendanceUpload(
    parseUpload(buffer, date),
    date,
    fileName,
    prismaAttendanceUploadRepository,
  );
  sendSuccess(res, report);
}

/** Checks the same file again and inserts only the valid rows. */
export async function importAttendance(req: Request, res: Response): Promise<void> {
  const { date, utcOffset } = req.body as AttendanceImportInput;
  const { buffer, fileName } = uploadedSheet(req);
  const report = await importAttendanceUpload(
    parseUpload(buffer, date),
    date,
    fileName,
    prismaAttendanceUploadRepository,
    utcOffset,
  );
  sendSuccess(res, report, 200, `Imported ${report.imported} attendance records`);
}

/** Registers employees the sheet lists but Workforce Management lacks. No attendance is saved. */
export async function registerAttendanceSheetEmployees(req: Request, res: Response): Promise<void> {
  const { date, employees } = req.body as RegisterSheetEmployeesInput;
  const { buffer, fileName } = uploadedSheet(req);
  const result = await registerSheetEmployees(
    parseUpload(buffer, date),
    date,
    fileName,
    employees,
    prismaAttendanceUploadRepository,
    prismaSheetEmployeeRepository,
  );
  const n = result.created.length;
  sendCreated(res, result, `Registered ${n} employee${n === 1 ? '' : 's'} from ${fileName}`);
}

// ── Summary & trend ───────────────────────────────────────────────────────────

export async function getDailySummary(req: Request, res: Response): Promise<void> {
  const q = req.query as unknown as AttendanceSummaryInput;
  const summary = await svc.getDailySummary(q.date, q.departmentId);
  sendSuccess(res, summary);
}

export async function getAttendanceTrend(req: Request, res: Response): Promise<void> {
  const q = req.query as unknown as AttendanceTrendInput;
  const trend = await svc.getAttendanceTrend(q.days ?? 7, q.departmentId, q.endDate);
  sendSuccess(res, trend);
}

// ══ EMPLOYEE DAILY OUTPUT ═════════════════════════════════════════════════════

export async function createEmployeeOutput(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const body = req.body as CreateEmployeeOutputInput;
  const record = await svc.createEmployeeOutput({
    employeeId: body.employeeId,
    date: body.date,
    workingHours: body.workingHours ?? null,
    expectedParts: body.expectedParts ?? null,
    producedParts: body.producedParts ?? null,
    operationsCount: body.operationsCount ?? null,
    remarks: body.remarks ?? null,
    recordedById: req.user?.id ?? null,
  });
  sendCreated(res, record, 'Performance recorded successfully');
}

export async function getAllEmployeeOutputs(req: Request, res: Response): Promise<void> {
  const q = req.query as unknown as EmployeeOutputQueryInput;
  const filters: EmployeeDailyOutputFilters = {
    page: q.page,
    pageSize: q.pageSize,
    sortOrder: q.sortOrder,
  };
  if (q.search !== undefined) filters.search = q.search;
  if (q.employeeId !== undefined) filters.employeeId = q.employeeId;
  if (q.departmentId !== undefined) filters.departmentId = q.departmentId;
  if (q.date !== undefined) filters.date = q.date;
  if (q.fromDate !== undefined) filters.fromDate = q.fromDate;
  if (q.toDate !== undefined) filters.toDate = q.toDate;

  const { data, total } = await svc.getAllEmployeeOutputs(filters);
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 20;
  sendSuccess(res, data, 200, undefined, {
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  });
}

export async function getEmployeeOutputById(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await svc.getEmployeeOutputById(parseId(req.params['id'])));
}

export async function updateEmployeeOutput(req: Request, res: Response): Promise<void> {
  const id = parseId(req.params['id']);
  const body = req.body as UpdateEmployeeOutputInput;
  const data: UpdateEmployeeDailyOutputData = {};
  if (body.workingHours !== undefined) data.workingHours = body.workingHours;
  if (body.expectedParts !== undefined) data.expectedParts = body.expectedParts;
  if (body.producedParts !== undefined) data.producedParts = body.producedParts;
  if (body.operationsCount !== undefined) data.operationsCount = body.operationsCount;
  if (body.remarks !== undefined) data.remarks = body.remarks;

  sendSuccess(
    res,
    await svc.updateEmployeeOutput(id, data),
    200,
    'Performance updated successfully',
  );
}

export async function deleteEmployeeOutput(req: Request, res: Response): Promise<void> {
  await svc.deleteEmployeeOutput(parseId(req.params['id']));
  sendNoContent(res);
}

export async function getEmployeeOutputSummary(req: Request, res: Response): Promise<void> {
  const q = req.query as unknown as EmployeeOutputSummaryInput;
  sendSuccess(res, await svc.getEmployeeOutputSummary(q, q.departmentId));
}
