import api, { unwrap, type ApiResponse } from '../api';

/** Staff name the conversation; supplier and client accounts pass nothing. */
export type PortalParty = { supplierId: number } | { clientId: number } | Record<string, never>;

export interface PortalMessageDto {
  id:         number;
  fromDvs:    boolean;
  senderName: string;
  body:       string;
  readAt:     string | null;
  createdAt:  string;
}

export interface PortalThreadDto {
  kind:          'supplier' | 'client';
  id:            number;
  name:          string;
  code:          string;
  lastMessage:   string;
  lastMessageAt: string;
  lastFromDvs:   boolean;
  unread:        number;
}

export async function getPortalMessages(party: PortalParty = {}): Promise<PortalMessageDto[]> {
  return unwrap(await api.get<ApiResponse<PortalMessageDto[]>>('/portal/messages', { params: party }));
}

export async function sendPortalMessage(body: string, party: PortalParty = {}): Promise<PortalMessageDto> {
  return unwrap(await api.post<ApiResponse<PortalMessageDto>>('/portal/messages', { body, ...party }));
}

export async function markPortalMessagesRead(party: PortalParty = {}): Promise<void> {
  await api.post('/portal/messages/read', party);
}

export async function getPortalThreads(): Promise<PortalThreadDto[]> {
  return unwrap(await api.get<ApiResponse<PortalThreadDto[]>>('/portal/threads'));
}
