import { prisma } from '../lib/prismaClient';
import type { PortalMessageDto, PortalParty, PortalThreadDto } from '../interfaces';

function partyWhere(party: PortalParty) {
  return party.kind === 'supplier' ? { supplierId: party.id } : { clientId: party.id };
}

const messageSelect = {
  id: true,
  fromDvs: true,
  body: true,
  readAt: true,
  createdAt: true,
  sender: { select: { fullName: true } },
} as const;

type MessageRow = {
  id: number;
  fromDvs: boolean;
  body: string;
  readAt: Date | null;
  createdAt: Date;
  sender: { fullName: string };
};

function toDto(row: MessageRow): PortalMessageDto {
  return {
    id: row.id,
    fromDvs: row.fromDvs,
    senderName: row.fromDvs ? 'DVS Industries' : row.sender.fullName,
    body: row.body,
    readAt: row.readAt,
    createdAt: row.createdAt,
  };
}

export class PortalRepository {
  /** The latest `limit` messages of a conversation, oldest first. */
  async findMessages(party: PortalParty, limit = 200): Promise<PortalMessageDto[]> {
    const rows = await prisma.portalMessage.findMany({
      where: partyWhere(party),
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: messageSelect,
    });
    return rows.reverse().map(toDto);
  }

  async create(
    party: PortalParty,
    data: { fromDvs: boolean; senderId: number; body: string },
  ): Promise<PortalMessageDto> {
    const row = await prisma.portalMessage.create({
      data: { ...partyWhere(party), ...data },
      select: messageSelect,
    });
    return toDto(row);
  }

  /** Marks the other side's messages read; returns how many changed. */
  async markRead(party: PortalParty, readerIsDvs: boolean): Promise<number> {
    const { count } = await prisma.portalMessage.updateMany({
      where: { ...partyWhere(party), fromDvs: !readerIsDvs, readAt: null },
      data: { readAt: new Date() },
    });
    return count;
  }

  async findThreads(): Promise<PortalThreadDto[]> {
    const [latest, unread] = await Promise.all([
      prisma.portalMessage.findMany({
        distinct: ['supplierId', 'clientId'],
        orderBy: { createdAt: 'desc' },
        select: {
          body: true,
          createdAt: true,
          fromDvs: true,
          supplier: { select: { id: true, name: true, code: true } },
          client: { select: { id: true, name: true, code: true } },
        },
      }),
      prisma.portalMessage.groupBy({
        by: ['supplierId', 'clientId'],
        where: { fromDvs: false, readAt: null },
        _count: { _all: true },
      }),
    ]);
    const unreadKey = (supplierId: number | null, clientId: number | null) =>
      `${supplierId ?? ''}:${clientId ?? ''}`;
    const unreadBy = new Map(
      unread.map((u) => [unreadKey(u.supplierId, u.clientId), u._count._all]),
    );

    return latest.flatMap((m) => {
      const party = m.supplier
        ? { kind: 'supplier' as const, ...m.supplier }
        : m.client
          ? { kind: 'client' as const, ...m.client }
          : null;
      if (party === null) return [];
      const key = party.kind === 'supplier' ? unreadKey(party.id, null) : unreadKey(null, party.id);
      return [
        {
          ...party,
          lastMessage: m.body,
          lastMessageAt: m.createdAt,
          lastFromDvs: m.fromDvs,
          unread: unreadBy.get(key) ?? 0,
        },
      ];
    });
  }
}
