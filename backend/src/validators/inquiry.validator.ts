import { z } from 'zod';

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

/**
 * Public contact-form body. `website` is a honeypot: it is hidden from people,
 * so a value there means a bot filled the form in.
 */
export const createInquirySchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  company: optionalText(160),
  email: z.string().trim().toLowerCase().email('A valid email is required').max(254),
  phone: optionalText(32),
  message: z.string().trim().min(1, 'Message is required').max(4000),
  website: z.string().max(500).optional(),
});

export const inquiryIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const inquiryQuerySchema = z.object({
  status: z.enum(['NEW', 'CONTACTED', 'CLOSED']).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(50),
});

export const updateInquiryStatusSchema = z.object({
  status: z.enum(['NEW', 'CONTACTED', 'CLOSED']),
});

export type CreateInquiryInput = z.infer<typeof createInquirySchema>;
export type InquiryQueryInput = z.infer<typeof inquiryQuerySchema>;
export type UpdateInquiryStatusInput = z.infer<typeof updateInquiryStatusSchema>;
