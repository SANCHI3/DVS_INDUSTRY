import api, { isApiError, isServerStarting, unwrapPaged, withServerWake, type ApiResponse, type PaginatedMeta } from '../api';
import { COMPANY } from '../company';

export type InquiryStatus = 'NEW' | 'CONTACTED' | 'CLOSED';

export interface InquiryDto {
  id: number;
  name: string;
  company: string | null;
  email: string;
  phone: string | null;
  message: string;
  status: InquiryStatus;
  createdAt: string;
  updatedAt: string;
}

export interface InquiryForm {
  name: string;
  company: string;
  email: string;
  phone: string;
  message: string;
  /** Honeypot: hidden from people, so only bots fill it in. */
  website: string;
}

/** Sends the website contact form. Waits for the server if it was asleep. */
export async function submitInquiry(form: InquiryForm): Promise<void> {
  await withServerWake(() => api.post('/inquiries', form));
}

/** A sentence for the visitor when sending failed; never technical wording. */
export function inquiryErrorMessage(err: unknown): string {
  const fallback = `We couldn't send your inquiry. Please try again, or email us at ${COMPANY.email}.`;
  if (!isApiError(err)) return fallback;
  if (err.status === 429) {
    return `You've sent several inquiries already. Please try again in an hour, or email us at ${COMPANY.email}.`;
  }
  if (err.status === 422 && Array.isArray(err.details) && err.details.length > 0) {
    return (err.details as { message?: string }[]).map((d) => d.message ?? 'Please check the form').join('. ') + '.';
  }
  if (isServerStarting(err)) {
    return `Our server is taking longer than usual to respond. Please try again in a minute, or email us at ${COMPANY.email}.`;
  }
  return fallback;
}

export async function listInquiries(status?: InquiryStatus): Promise<{ data: InquiryDto[]; meta: PaginatedMeta }> {
  const res = await api.get<ApiResponse<InquiryDto[]>>('/inquiries', { params: { pageSize: 100, ...(status && { status }) } });
  return unwrapPaged<InquiryDto[]>(res);
}

export async function updateInquiryStatus(id: number, status: InquiryStatus): Promise<InquiryDto> {
  const res = await api.patch<{ success: true; data: InquiryDto }>(`/inquiries/${id}`, { status });
  return res.data.data;
}
