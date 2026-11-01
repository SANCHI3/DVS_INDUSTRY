/** The supplier or client a portal conversation belongs to. */
export type PortalParty = { kind: 'supplier'; id: number } | { kind: 'client'; id: number };

export interface PortalMessageDto {
  id: number;
  fromDvs: boolean;
  senderName: string;
  body: string;
  readAt: Date | null;
  createdAt: Date;
}

/** One conversation in the DVS staff inbox. */
export interface PortalThreadDto {
  kind: 'supplier' | 'client';
  id: number;
  name: string;
  code: string;
  lastMessage: string;
  lastMessageAt: Date;
  lastFromDvs: boolean;
  /** Messages from the supplier/client that DVS has not read yet */
  unread: number;
}
