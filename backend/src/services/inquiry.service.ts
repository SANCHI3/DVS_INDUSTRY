import type { Inquiry, InquiryStatus } from '@prisma/client';
import { InquiryRepository } from '../repositories/inquiry.repository';
import { NotFoundError } from '../errors';
import { logger } from '../logger';
import { sendInquiryNotification } from '../utils/mailer';
import type { CreateInquiryInput } from '../validators/inquiry.validator';

export class InquiryService {
  private readonly repo = new InquiryRepository();

  /**
   * Stores a website inquiry and emails the sales inbox. Returns null when the
   * honeypot was filled: the bot gets the same success reply, nothing is kept.
   */
  async submit(input: CreateInquiryInput): Promise<Inquiry | null> {
    if (input.website !== undefined && input.website.trim() !== '') {
      logger.warn('Inquiry honeypot filled; discarded');
      return null;
    }
    const inquiry = await this.repo.create({
      name: input.name,
      company: input.company ?? null,
      email: input.email,
      phone: input.phone ?? null,
      message: input.message,
    });
    // Mail is best effort; the inquiry is already saved for the admin list
    void sendInquiryNotification(inquiry);
    return inquiry;
  }

  list(filters: { status?: InquiryStatus; page: number; pageSize: number }) {
    return this.repo.findAll(filters);
  }

  async setStatus(id: number, status: InquiryStatus): Promise<Inquiry> {
    const existing = await this.repo.findById(id);
    if (existing === null) throw new NotFoundError('Inquiry not found');
    return this.repo.updateStatus(id, status);
  }
}
