import { z } from 'zod';

// Profile images are set by the upload endpoint; when supplied directly the
// value must be one of our own upload URLs (no traversal, no external URLs).
const profileImagePath = z
  .string()
  .regex(/^\/uploads\/profiles\/[\w.-]+\.(jpe?g|png|webp)$/i, 'Invalid profile image path')
  .optional()
  .nullable();

// ── Reusable field definitions ────────────────────────────────────────────────

const employeeCodeField = z
  .string()
  .trim()
  .min(1, 'Employee code is required')
  .max(20, 'Employee code must be at most 20 characters')
  .regex(
    /^[A-Z0-9_-]+$/,
    'Employee code must contain only uppercase letters, digits, hyphens, or underscores',
  );

const nameField = (label: string) => z.string().min(1, `${label} is required`).max(100).trim();

// Many workers have a single name; an empty last name is stored as ''.
const lastNameField = z.string().max(100).trim();

const emailField = z
  .string()
  .email('Must be a valid email address')
  .toLowerCase()
  .trim()
  .optional()
  .nullable();

const phoneField = z
  .string()
  .regex(/^\+?[0-9\s\-().]{7,20}$/, 'Must be a valid phone number')
  .optional()
  .nullable();

const salaryField = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, 'Salary must be a valid decimal number (e.g. 25000.00)')
  .optional()
  .nullable();

const dailyWageRateField = z
  .string()
  .regex(/^\d{1,8}(\.\d{1,2})?$/, 'Daily wage rate must be a non-negative amount (e.g. 650.00)')
  .optional()
  .nullable();

// TERMINATED is set only by deleting the employee
const editableStatusField = z.enum(['ACTIVE', 'INACTIVE', 'ON_LEAVE']);

const optionalNullableString = (max = 255) => z.string().max(max).trim().optional().nullable();

const optionalPositiveInt = z.coerce.number().int().positive().optional().nullable();

// ── Create Schema ─────────────────────────────────────────────────────────────

export const createEmployeeSchema = z.object({
  employeeCode: employeeCodeField,
  firstName: nameField('First name'),
  lastName: lastNameField.optional().default(''),
  email: emailField,
  phone: phoneField,

  gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional().nullable(),

  dateOfBirth: z.coerce.date().optional().nullable(),
  joiningDate: z.coerce.date().refine((d) => !isNaN(d.getTime()), {
    message: 'Joining date is required and must be a valid date',
  }),

  designation: z.string().min(1, 'Designation is required').max(100).trim(),

  employmentType: z
    .enum(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN'])
    .optional()
    .default('FULL_TIME'),

  salary: salaryField,
  dailyWageRate: dailyWageRateField,
  status: editableStatusField.optional().default('ACTIVE'),

  departmentId: optionalPositiveInt,
  shiftId: optionalPositiveInt,
  managerId: optionalPositiveInt,
  userId: optionalPositiveInt,

  // Address
  address: optionalNullableString(500),
  city: optionalNullableString(100),
  state: optionalNullableString(100),
  country: optionalNullableString(100),
  pincode: z
    .string()
    .regex(/^[A-Z0-9\s-]{3,10}$/i, 'Invalid pincode format')
    .optional()
    .nullable(),

  // Emergency contact
  emergencyName: optionalNullableString(100),
  emergencyPhone: phoneField,

  profileImage: profileImagePath,
});

// ── Update Schema ─────────────────────────────────────────────────────────────

export const updateEmployeeSchema = z
  .object({
    employeeCode: employeeCodeField.optional(),
    firstName: z.string().min(1).max(100).trim().optional(),
    lastName: lastNameField.optional(),
    email: emailField,
    phone: phoneField,
    gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional().nullable(),
    dateOfBirth: z.coerce.date().optional().nullable(),
    joiningDate: z.coerce.date().optional(),
    designation: z.string().min(1).max(100).trim().optional(),
    employmentType: z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN']).optional(),
    salary: salaryField,
    dailyWageRate: dailyWageRateField,
    status: editableStatusField.optional(),
    address: optionalNullableString(500),
    city: optionalNullableString(100),
    state: optionalNullableString(100),
    country: optionalNullableString(100),
    pincode: z
      .string()
      .regex(/^[A-Z0-9\s-]{3,10}$/i, 'Invalid pincode format')
      .optional()
      .nullable(),
    emergencyName: optionalNullableString(100),
    emergencyPhone: phoneField,
    profileImage: profileImagePath,
  })
  .refine((d) => Object.values(d).some((v) => v !== undefined), {
    message: 'At least one field must be provided for update',
  });

// ── Param schemas ─────────────────────────────────────────────────────────────

export const employeeIdParamSchema = z.object({
  id: z.coerce.number().int().positive('Employee id must be a positive integer'),
});

// ── Assignment body schemas ───────────────────────────────────────────────────

export const assignDepartmentSchema = z.object({
  departmentId: z.coerce
    .number()
    .int()
    .positive('departmentId must be a positive integer')
    .nullable(),
});

export const assignManagerSchema = z.object({
  managerId: z.coerce.number().int().positive('managerId must be a positive integer').nullable(),
});

export const assignShiftSchema = z.object({
  shiftId: z.coerce.number().int().positive('shiftId must be a positive integer').nullable(),
});

// ── Query Schema ──────────────────────────────────────────────────────────────

export const employeeQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  pageSize: z.coerce.number().int().positive().max(100).optional().default(20),
  search: z.string().max(100).trim().optional(),
  departmentId: z.coerce.number().int().positive().optional(),
  designation: z.string().max(100).trim().optional(),
  status: z
    .enum(['ACTIVE', 'INACTIVE', 'ON_LEAVE', 'TERMINATED', 'all'])
    .optional()
    .default('ACTIVE'),
  employmentType: z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN']).optional(),
  shiftId: z.coerce.number().int().positive().optional(),
  managerId: z.coerce.number().int().positive().optional(),
  includeDeleted: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  sortBy: z
    .enum(['firstName', 'lastName', 'employeeCode', 'joiningDate', 'createdAt'])
    .optional()
    .default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
});

// ── Inferred types ────────────────────────────────────────────────────────────

export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;
export type EmployeeQueryInput = z.infer<typeof employeeQuerySchema>;
export type AssignDepartmentInput = z.infer<typeof assignDepartmentSchema>;
export type AssignManagerInput = z.infer<typeof assignManagerSchema>;
export type AssignShiftInput = z.infer<typeof assignShiftSchema>;
