import { z } from 'zod';
import { createEmployeeSchema } from './employee.validator';

// ── Time helper — validates "HH:MM" 24-hour format ────────────────────────────
const timeField = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be in HH:MM format (24-hour)');

// ════════════════════════════════════════════════════════════
// SHIFT
// ════════════════════════════════════════════════════════════

export const createShiftSchema = z.object({
  name: z.string().min(1, 'Shift name is required').max(50).trim(),
  startTime: timeField,
  endTime: timeField,
  isNightShift: z.boolean().optional().default(false),
  description: z.string().max(300).trim().optional().nullable(),
});

export const updateShiftSchema = z
  .object({
    name: z.string().min(1).max(50).trim().optional(),
    startTime: timeField.optional(),
    endTime: timeField.optional(),
    isNightShift: z.boolean().optional(),
    description: z.string().max(300).trim().optional().nullable(),
  })
  .refine((d) => Object.values(d).some((v) => v !== undefined), {
    message: 'At least one field must be provided for update',
  });

export const shiftIdParamSchema = z.object({
  id: z.coerce.number().int().positive('Shift id must be a positive integer'),
});

export const shiftQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  pageSize: z.coerce.number().int().positive().max(100).optional().default(50),
  search: z.string().max(100).trim().optional(),
  sortBy: z.enum(['name', 'startTime', 'createdAt']).optional().default('name'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('asc'),
});

// ════════════════════════════════════════════════════════════
// ATTENDANCE
// ════════════════════════════════════════════════════════════

export const attendanceStatusEnum = z.enum([
  'PRESENT',
  'ABSENT',
  'HALF_DAY',
  'LATE',
  'LEAVE',
  'WEEK_OFF',
]);

export const createAttendanceSchema = z.object({
  employeeId: z.coerce.number().int().positive('employeeId is required'),
  date: z.coerce.date(),
  status: attendanceStatusEnum,
  clockIn: z.coerce.date().optional().nullable(),
  clockOut: z.coerce.date().optional().nullable(),
  remarks: z.string().max(500).trim().optional().nullable(),
});

export const updateAttendanceSchema = z
  .object({
    status: attendanceStatusEnum.optional(),
    clockIn: z.coerce.date().optional().nullable(),
    clockOut: z.coerce.date().optional().nullable(),
    remarks: z.string().max(500).trim().optional().nullable(),
  })
  .refine((d) => Object.values(d).some((v) => v !== undefined), {
    message: 'At least one field must be provided for update',
  });

// Clock-in — creates or upserts today's record
export const clockInSchema = z.object({
  employeeId: z.coerce.number().int().positive(),
  clockIn: z.coerce.date().optional(), // defaults to now() if omitted
  remarks: z.string().max(500).trim().optional().nullable(),
});

// Clock-out — updates an existing attendance record
export const clockOutSchema = z.object({
  clockOut: z.coerce.date().optional(), // defaults to now() if omitted
  remarks: z.string().max(500).trim().optional().nullable(),
});

// Bulk mark attendance (e.g., mark all employees for today)
export const bulkAttendanceSchema = z.object({
  date: z.coerce.date(),
  entries: z
    .array(
      z.object({
        employeeId: z.coerce.number().int().positive(),
        status: attendanceStatusEnum,
        clockIn: z.coerce.date().optional().nullable(),
        clockOut: z.coerce.date().optional().nullable(),
        remarks: z.string().max(500).trim().optional().nullable(),
      }),
    )
    .min(1, 'At least one entry is required')
    .max(200, 'Maximum 200 entries per bulk request'),
});

export const attendanceIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const attendanceQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  pageSize: z.coerce.number().int().positive().max(100).optional().default(20),
  search: z.string().max(100).trim().optional(),
  employeeId: z.coerce.number().int().positive().optional(),
  departmentId: z.coerce.number().int().positive().optional(),
  status: z
    .enum(['PRESENT', 'ABSENT', 'HALF_DAY', 'LATE', 'LEAVE', 'WEEK_OFF', 'all'])
    .optional()
    .default('all'),
  date: z.coerce.date().optional(),
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
});

// Summary endpoint — just needs a date
export const attendanceSummarySchema = z.object({
  date: z.coerce.date().optional(), // defaults to today
  departmentId: z.coerce.number().int().positive().optional(),
});

// Trend endpoint — number of days
export const attendanceTrendSchema = z.object({
  days: z.coerce.number().int().min(7).max(30).optional().default(7),
  endDate: z.coerce.date().optional(), // defaults to today
  departmentId: z.coerce.number().int().positive().optional(),
});

// ════════════════════════════════════════════════════════════
// EMPLOYEE DAILY OUTPUT (per-employee performance)
// ════════════════════════════════════════════════════════════

const partsField = z.coerce
  .number({ message: 'Must be a number' })
  .min(0, 'Cannot be negative')
  .max(1_000_000_000, 'Value is too large')
  .refine((n) => Math.abs(Math.round(n * 1000) - n * 1000) < 1e-6, 'At most 3 decimal places')
  .nullable()
  .optional();

const outputFields = {
  workingHours: z.coerce
    .number({ message: 'Must be a number' })
    .min(0, 'Cannot be negative')
    .max(24, 'Cannot exceed 24 hours in a day')
    .nullable()
    .optional(),
  expectedParts: partsField,
  producedParts: partsField,
  operationsCount: z.coerce
    .number({ message: 'Must be a whole number' })
    .int('Must be a whole number')
    .min(0, 'Cannot be negative')
    .max(1_000_000, 'Value is too large')
    .nullable()
    .optional(),
  remarks: z.string().max(500).trim().optional().nullable(),
};

const hasMeasurement = (d: Record<string, unknown>): boolean =>
  ['workingHours', 'expectedParts', 'producedParts', 'operationsCount'].some(
    (k) => d[k] !== undefined && d[k] !== null,
  );

export const createEmployeeOutputSchema = z
  .object({
    employeeId: z.coerce.number().int().positive('employeeId is required'),
    date: z.coerce.date({ message: 'A valid date is required' }),
    ...outputFields,
  })
  .refine(hasMeasurement, {
    message: 'Enter at least one of working hours, expected parts, produced parts or operations',
  });

export const updateEmployeeOutputSchema = z
  .object(outputFields)
  .refine((d) => Object.values(d).some((v) => v !== undefined), {
    message: 'At least one field must be provided for update',
  });

export const employeeOutputIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const employeeOutputQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  pageSize: z.coerce.number().int().positive().max(100).optional().default(20),
  search: z.string().max(100).trim().optional(),
  employeeId: z.coerce.number().int().positive().optional(),
  departmentId: z.coerce.number().int().positive().optional(),
  date: z.coerce.date().optional(),
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
});

export const employeeOutputSummarySchema = z.object({
  date: z.coerce.date().optional(), // defaults to today
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
  departmentId: z.coerce.number().int().positive().optional(),
});

// Excel attendance upload — multipart form field next to the file
export const attendanceImportSchema = z.object({
  date: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Select the attendance date (YYYY-MM-DD)'),
  // The uploader's offset from UTC in minutes, to place punch times (IST = 330)
  utcOffset: z.coerce.number().int().min(-720).max(840).default(330),
});

// Employees an administrator registers from an attendance sheet. Sent as a
// JSON string next to the file (multipart); same field rules as the employee form.
const sheetEmployeeSchema = createEmployeeSchema
  .pick({
    employeeCode: true,
    firstName: true,
    lastName: true,
    designation: true,
    joiningDate: true,
    employmentType: true,
    shiftId: true,
    departmentId: true,
  })
  .strict();

export const registerSheetEmployeesSchema = attendanceImportSchema.extend({
  employees: z.preprocess((v) => {
    if (typeof v !== 'string') return v;
    try {
      return JSON.parse(v) as unknown;
    } catch {
      return v;
    }
  }, z.array(sheetEmployeeSchema).min(1, 'Choose at least one employee to register').max(500)),
});

// ── Inferred types ─────────────────────────────────────────────────────────────

export type CreateShiftInput = z.infer<typeof createShiftSchema>;
export type UpdateShiftInput = z.infer<typeof updateShiftSchema>;
export type ShiftQueryInput = z.infer<typeof shiftQuerySchema>;
export type CreateAttendanceInput = z.infer<typeof createAttendanceSchema>;
export type UpdateAttendanceInput = z.infer<typeof updateAttendanceSchema>;
export type ClockInInput = z.infer<typeof clockInSchema>;
export type ClockOutInput = z.infer<typeof clockOutSchema>;
export type BulkAttendanceInput = z.infer<typeof bulkAttendanceSchema>;
export type AttendanceQueryInput = z.infer<typeof attendanceQuerySchema>;
export type AttendanceSummaryInput = z.infer<typeof attendanceSummarySchema>;
export type AttendanceTrendInput = z.infer<typeof attendanceTrendSchema>;
export type CreateEmployeeOutputInput = z.infer<typeof createEmployeeOutputSchema>;
export type UpdateEmployeeOutputInput = z.infer<typeof updateEmployeeOutputSchema>;
export type EmployeeOutputQueryInput = z.infer<typeof employeeOutputQuerySchema>;
export type EmployeeOutputSummaryInput = z.infer<typeof employeeOutputSummarySchema>;
export type AttendanceImportInput = z.infer<typeof attendanceImportSchema>;
export type RegisterSheetEmployeesInput = z.infer<typeof registerSheetEmployeesSchema>;
