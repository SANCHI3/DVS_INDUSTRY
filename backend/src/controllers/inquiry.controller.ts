import type { Request, Response } from 'express';
import { InquiryService } from '../services/inquiry.service';
import { sendCreated, sendSuccess } from '../utils/response';
import type {
  CreateInquiryInput,
  InquiryQueryInput,
  UpdateInquiryStatusInput,
} from '../validators/inquiry.validator';

const inquiryService = new InquiryService();

export async function createInquiry(req: Request, res: Response): Promise<void> {
  await inquiryService.submit(req.body as CreateInquiryInput);
  // Same reply whether stored or discarded as spam
  sendCreated(res, { received: true }, 'Inquiry received');
}

export async function listInquiries(req: Request, res: Response): Promise<void> {
  const q = req.query as unknown as InquiryQueryInput;
  const { data, total } = await inquiryService.list({
    page: q.page,
    pageSize: q.pageSize,
    ...(q.status !== undefined && { status: q.status }),
  });
  sendSuccess(res, data, 200, undefined, {
    page: q.page,
    pageSize: q.pageSize,
    total,
    totalPages: Math.ceil(total / q.pageSize),
  });
}

export async function updateInquiryStatus(req: Request, res: Response): Promise<void> {
  const id = Number(req.params['id']);
  const { status } = req.body as UpdateInquiryStatusInput;
  const inquiry = await inquiryService.setStatus(id, status);
  sendSuccess(res, inquiry, 200, 'Inquiry updated');
}
