import { z } from 'zod';

// A conversation is identified by exactly one of supplierId / clientId.
// Portal accounts never send these: their own company is used.
const partyFields = {
  supplierId: z.coerce.number().int().positive().optional(),
  clientId: z.coerce.number().int().positive().optional(),
};

const onlyOneParty = (v: { supplierId?: number | undefined; clientId?: number | undefined }) =>
  !(v.supplierId !== undefined && v.clientId !== undefined);
const onlyOnePartyMessage = { message: 'Give supplierId or clientId, not both' };

export const portalPartyQuerySchema = z
  .object(partyFields)
  .refine(onlyOneParty, onlyOnePartyMessage);

export const sendPortalMessageSchema = z
  .object({
    ...partyFields,
    body: z
      .string()
      .trim()
      .min(1, 'Message cannot be empty')
      .max(4000, 'Message must be at most 4000 characters'),
  })
  .refine(onlyOneParty, onlyOnePartyMessage);

export type PortalPartyQueryInput = z.infer<typeof portalPartyQuerySchema>;
export type SendPortalMessageInput = z.infer<typeof sendPortalMessageSchema>;
