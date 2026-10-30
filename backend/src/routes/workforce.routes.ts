import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { validateRequest } from '../middleware/validateRequest';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import * as WorkforceController from '../controllers/workforce.controller';
import {
  createShiftSchema,
  updateShiftSchema,
  shiftIdParamSchema,
  shiftQuerySchema,
  createAttendanceSchema,
  updateAttendanceSchema,
  attendanceIdParamSchema,
  attendanceQuerySchema,
  clockInSchema,
  clockOutSchema,
  bulkAttendanceSchema,
  attendanceSummarySchema,
  attendanceTrendSchema,
  createEmployeeOutputSchema,
  updateEmployeeOutputSchema,
  employeeOutputIdParamSchema,
  employeeOutputQuerySchema,
  employeeOutputSummarySchema,
  attendanceImportSchema,
  registerSheetEmployeesSchema,
} from '../validators/workforce.validator';
import { ROLES } from '../constants';
import { uploadAttendanceSheet } from '../utils/attendanceSheetUpload';

const router = Router();
router.use(authenticate);

// ── Role groups ───────────────────────────────────────────────────────────────
const ALL_ROLES = [
  ROLES.ADMIN,
  ROLES.MANAGER,
  ROLES.HR,
  ROLES.STORE,
  ROLES.PRODUCTION,
  ROLES.SALES,
] as const;
const WRITE_ROLES = [ROLES.ADMIN, ROLES.HR] as const;
const ADMIN_ONLY = [ROLES.ADMIN] as const;
const HR_MGR = [ROLES.ADMIN, ROLES.MANAGER, ROLES.HR] as const;
// Per-employee output is production data: supervisors record it
const OUTPUT_READ = [ROLES.ADMIN, ROLES.MANAGER, ROLES.HR, ROLES.PRODUCTION] as const;
const OUTPUT_WRITE = [ROLES.ADMIN, ROLES.HR, ROLES.PRODUCTION] as const;

// ════════════════════════════════════════════════════════════════
// SHIFTS
// ════════════════════════════════════════════════════════════════

/**
 * GET /api/v1/workforce/shifts
 * List all shifts.
 * Access: All roles
 */
router.get(
  '/shifts',
  authorize(...ALL_ROLES),
  validateRequest({ query: shiftQuerySchema }),
  asyncHandler(WorkforceController.getAllShifts),
);

/**
 * POST /api/v1/workforce/shifts
 * Create a new shift.
 * Access: ADMIN, HR
 */
router.post(
  '/shifts',
  authorize(...WRITE_ROLES),
  validateRequest({ body: createShiftSchema }),
  asyncHandler(WorkforceController.createShift),
);

/**
 * GET /api/v1/workforce/shifts/:id
 * Get shift by ID.
 * Access: All roles
 */
router.get(
  '/shifts/:id',
  authorize(...ALL_ROLES),
  validateRequest({ params: shiftIdParamSchema }),
  asyncHandler(WorkforceController.getShiftById),
);

/**
 * PATCH /api/v1/workforce/shifts/:id
 * Update shift details.
 * Access: ADMIN, HR
 */
router.patch(
  '/shifts/:id',
  authorize(...WRITE_ROLES),
  validateRequest({ params: shiftIdParamSchema, body: updateShiftSchema }),
  asyncHandler(WorkforceController.updateShift),
);

/**
 * DELETE /api/v1/workforce/shifts/:id
 * Delete a shift (only if no employees assigned).
 * Access: ADMIN only
 */
router.delete(
  '/shifts/:id',
  authorize(...ADMIN_ONLY),
  validateRequest({ params: shiftIdParamSchema }),
  asyncHandler(WorkforceController.deleteShift),
);

// ════════════════════════════════════════════════════════════════
// ATTENDANCE — SUMMARY & TREND (before /:id to avoid conflicts)
// ════════════════════════════════════════════════════════════════

/**
 * GET /api/v1/workforce/attendance/summary
 * Daily attendance summary — KPIs + by department breakdown.
 * Query: ?date ?departmentId
 * Access: ADMIN, MANAGER, HR
 */
router.get(
  '/attendance/summary',
  authorize(...HR_MGR),
  validateRequest({ query: attendanceSummarySchema }),
  asyncHandler(WorkforceController.getDailySummary),
);

/**
 * GET /api/v1/workforce/attendance/trend
 * Attendance trend for last N days (7 or 30).
 * Query: ?days ?departmentId
 * Access: ADMIN, MANAGER, HR
 */
router.get(
  '/attendance/trend',
  authorize(...HR_MGR),
  validateRequest({ query: attendanceTrendSchema }),
  asyncHandler(WorkforceController.getAttendanceTrend),
);

/**
 * POST /api/v1/workforce/attendance/bulk
 * Mark attendance for multiple employees at once.
 * Body: { date, entries: [{ employeeId, status, clockIn?, clockOut?, remarks? }] }
 * Access: ADMIN, HR
 */
router.post(
  '/attendance/bulk',
  authorize(...WRITE_ROLES),
  validateRequest({ body: bulkAttendanceSchema }),
  asyncHandler(WorkforceController.bulkMarkAttendance),
);

/**
 * POST /api/v1/workforce/attendance/import/preview
 * Check an Excel attendance sheet for one day. Writes nothing.
 * Multipart: file (.xlsx/.xls, max 5 MB), date (YYYY-MM-DD)
 * Access: ADMIN, HR (the roles that record attendance)
 */
router.post(
  '/attendance/import/preview',
  authorize(...WRITE_ROLES),
  uploadAttendanceSheet,
  validateRequest({ body: attendanceImportSchema }),
  asyncHandler(WorkforceController.previewAttendanceImport),
);

/**
 * POST /api/v1/workforce/attendance/import
 * Re-check the same sheet and insert its valid rows. Existing records are
 * skipped, never overwritten.
 * Access: ADMIN, HR
 */
router.post(
  '/attendance/import',
  authorize(...WRITE_ROLES),
  uploadAttendanceSheet,
  validateRequest({ body: attendanceImportSchema }),
  asyncHandler(WorkforceController.importAttendance),
);

/**
 * POST /api/v1/workforce/attendance/import/register-employees
 * Register employees that the sheet lists but Workforce Management does not
 * have, after an administrator has reviewed them and completed the required
 * fields. The file is read again; nothing is created unless every employee
 * passes. No attendance is saved.
 * Multipart: file, date, employees (JSON array)
 * Access: ADMIN, HR (the roles that create employees)
 */
router.post(
  '/attendance/import/register-employees',
  authorize(...WRITE_ROLES),
  uploadAttendanceSheet,
  validateRequest({ body: registerSheetEmployeesSchema }),
  asyncHandler(WorkforceController.registerAttendanceSheetEmployees),
);

/**
 * POST /api/v1/workforce/attendance/clock-in
 * Record clock-in for an employee (upserts today's record).
 * Body: { employeeId, clockIn?, remarks? }
 * Access: ADMIN, HR, PRODUCTION
 */
router.post(
  '/attendance/clock-in',
  authorize(ROLES.ADMIN, ROLES.HR, ROLES.PRODUCTION),
  validateRequest({ body: clockInSchema }),
  asyncHandler(WorkforceController.clockIn),
);

// ════════════════════════════════════════════════════════════════
// ATTENDANCE — CRUD
// ════════════════════════════════════════════════════════════════

/**
 * GET /api/v1/workforce/attendance
 * List attendance records with filters.
 * Query: ?employeeId ?departmentId ?status ?date ?fromDate ?toDate ?page ?pageSize
 * Access: ADMIN, MANAGER, HR
 */
router.get(
  '/attendance',
  authorize(...HR_MGR),
  validateRequest({ query: attendanceQuerySchema }),
  asyncHandler(WorkforceController.getAllAttendance),
);

/**
 * POST /api/v1/workforce/attendance
 * Create / upsert a single attendance record.
 * Access: ADMIN, HR
 */
router.post(
  '/attendance',
  authorize(...WRITE_ROLES),
  validateRequest({ body: createAttendanceSchema }),
  asyncHandler(WorkforceController.createAttendance),
);

/**
 * GET /api/v1/workforce/attendance/:id
 * Get a single attendance record by ID.
 * Access: ADMIN, MANAGER, HR
 */
router.get(
  '/attendance/:id',
  authorize(...HR_MGR),
  validateRequest({ params: attendanceIdParamSchema }),
  asyncHandler(WorkforceController.getAttendanceById),
);

/**
 * PATCH /api/v1/workforce/attendance/:id
 * Update an attendance record.
 * Access: ADMIN, HR
 */
router.patch(
  '/attendance/:id',
  authorize(...WRITE_ROLES),
  validateRequest({ params: attendanceIdParamSchema, body: updateAttendanceSchema }),
  asyncHandler(WorkforceController.updateAttendance),
);

/**
 * DELETE /api/v1/workforce/attendance/:id
 * Delete an attendance record.
 * Access: ADMIN only
 */
router.delete(
  '/attendance/:id',
  authorize(...ADMIN_ONLY),
  validateRequest({ params: attendanceIdParamSchema }),
  asyncHandler(WorkforceController.deleteAttendance),
);

/**
 * PATCH /api/v1/workforce/attendance/:id/clock-out
 * Record clock-out for an existing attendance record.
 * Body: { clockOut?, remarks? }
 * Access: ADMIN, HR, PRODUCTION
 */
router.patch(
  '/attendance/:id/clock-out',
  authorize(ROLES.ADMIN, ROLES.HR, ROLES.PRODUCTION),
  validateRequest({ params: attendanceIdParamSchema, body: clockOutSchema }),
  asyncHandler(WorkforceController.clockOut),
);

// ════════════════════════════════════════════════════════════════
// EMPLOYEE DAILY OUTPUT (per-employee performance)
// Kept apart from work-order output; never part of company totals.
// ════════════════════════════════════════════════════════════════

/**
 * GET /api/v1/workforce/performance/summary
 * Totals and efficiency for a date or range (default today).
 */
router.get(
  '/performance/summary',
  authorize(...OUTPUT_READ),
  validateRequest({ query: employeeOutputSummarySchema }),
  asyncHandler(WorkforceController.getEmployeeOutputSummary),
);

/**
 * GET /api/v1/workforce/performance
 * List daily output records (filter by date/range, employee, department, search).
 */
router.get(
  '/performance',
  authorize(...OUTPUT_READ),
  validateRequest({ query: employeeOutputQuerySchema }),
  asyncHandler(WorkforceController.getAllEmployeeOutputs),
);

/**
 * POST /api/v1/workforce/performance
 * Record one employee's output for one day. 409 if that day already exists.
 */
router.post(
  '/performance',
  authorize(...OUTPUT_WRITE),
  validateRequest({ body: createEmployeeOutputSchema }),
  asyncHandler(WorkforceController.createEmployeeOutput),
);

/**
 * GET /api/v1/workforce/performance/:id
 */
router.get(
  '/performance/:id',
  authorize(...OUTPUT_READ),
  validateRequest({ params: employeeOutputIdParamSchema }),
  asyncHandler(WorkforceController.getEmployeeOutputById),
);

/**
 * PATCH /api/v1/workforce/performance/:id
 */
router.patch(
  '/performance/:id',
  authorize(...OUTPUT_WRITE),
  validateRequest({ params: employeeOutputIdParamSchema, body: updateEmployeeOutputSchema }),
  asyncHandler(WorkforceController.updateEmployeeOutput),
);

/**
 * DELETE /api/v1/workforce/performance/:id
 */
router.delete(
  '/performance/:id',
  authorize(...ADMIN_ONLY),
  validateRequest({ params: employeeOutputIdParamSchema }),
  asyncHandler(WorkforceController.deleteEmployeeOutput),
);

export default router;
