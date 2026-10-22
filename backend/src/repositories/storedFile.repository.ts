import { prisma } from '../lib/prismaClient';

export interface StoredFileContent {
  mimeType: string;
  size: number;
  data: Uint8Array;
}

export class StoredFileRepository {
  async create(id: string, mimeType: string, data: Buffer): Promise<void> {
    await prisma.storedFile.create({
      data: { id, mimeType, size: data.length, data: new Uint8Array(data) },
    });
  }

  async find(id: string): Promise<StoredFileContent | null> {
    return prisma.storedFile.findUnique({
      where: { id },
      select: { mimeType: true, size: true, data: true },
    });
  }

  /** Silently ignores files that do not exist. */
  async delete(id: string): Promise<void> {
    await prisma.storedFile.deleteMany({ where: { id } });
  }
}
