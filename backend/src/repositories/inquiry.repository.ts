import type { Inquiry, InquiryStatus } from '@prisma/client';
import { prisma } from '../lib/prismaClient';

export interface CreateInquiryData {
  name: string;
  company: string | null;
  email: string;
  phone: string | null;
  message: string;
}

export class InquiryRepository {
  create(data: CreateInquiryData): Promise<Inquiry> {
    return prisma.inquiry.create({ data });
  }

  async findAll(filters: {
    status?: InquiryStatus;
    page: number;
    pageSize: number;
  }): Promise<{ data: Inquiry[]; total: number }> {
    const where = filters.status ? { status: filters.status } : {};
    const [data, total] = await prisma.$transaction([
      prisma.inquiry.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
      prisma.inquiry.count({ where }),
    ]);
    return { data, total };
  }

  findById(id: number): Promise<Inquiry | null> {
    return prisma.inquiry.findUnique({ where: { id } });
  }

  updateStatus(id: number, status: InquiryStatus): Promise<Inquiry> {
    return prisma.inquiry.update({ where: { id }, data: { status } });
  }
}
