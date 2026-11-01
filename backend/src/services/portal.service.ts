import { OrdersService } from './orders.service';
import { PortalRepository } from '../repositories';
import { BadRequestError } from '../errors';
import { ROLES } from '../constants';
import type { PortalMessageDto, PortalParty, PortalThreadDto } from '../interfaces';

/** Which conversation a staff member asked for (ignored for portal accounts). */
export interface PartyRequest {
  supplierId?: number | undefined;
  clientId?: number | undefined;
}

export interface PortalActor {
  id: number;
  email: string;
  role: string;
  supplierId?: number | null;
  clientId?: number | null;
}

/** Roles that answer supplier and client messages on behalf of DVS. */
export const PORTAL_STAFF_ROLES = [ROLES.ADMIN, ROLES.MANAGER, ROLES.SALES, ROLES.STORE] as const;
export const PORTAL_ROLES = [ROLES.SUPPLIER, ROLES.CLIENT] as const;

/**
 * Messages between DVS and its suppliers / clients. A portal account only
 * ever reaches its own company's conversation (found by its login email);
 * DVS staff name the supplier or client.
 */
export class PortalService {
  private readonly repo = new PortalRepository();
  private readonly orders = new OrdersService();

  private isDvs(actor: PortalActor): boolean {
    return actor.role !== ROLES.SUPPLIER && actor.role !== ROLES.CLIENT;
  }

  async resolveParty(actor: PortalActor, requested: PartyRequest): Promise<PortalParty> {
    if (actor.role === ROLES.SUPPLIER) {
      return { kind: 'supplier', id: (await this.orders.getSupplierForAccount(actor)).id };
    }
    if (actor.role === ROLES.CLIENT) {
      return { kind: 'client', id: (await this.orders.getClientForAccount(actor)).id };
    }
    // Staff: the named supplier or client must exist (404 otherwise)
    if (requested.supplierId !== undefined) {
      await this.orders.getSupplierById(requested.supplierId);
      return { kind: 'supplier', id: requested.supplierId };
    }
    if (requested.clientId !== undefined) {
      await this.orders.getClientById(requested.clientId);
      return { kind: 'client', id: requested.clientId };
    }
    throw new BadRequestError('supplierId or clientId is required');
  }

  async getMessages(actor: PortalActor, requested: PartyRequest): Promise<PortalMessageDto[]> {
    return this.repo.findMessages(await this.resolveParty(actor, requested));
  }

  async sendMessage(
    actor: PortalActor,
    requested: PartyRequest,
    body: string,
  ): Promise<PortalMessageDto> {
    const party = await this.resolveParty(actor, requested);
    return this.repo.create(party, { fromDvs: this.isDvs(actor), senderId: actor.id, body });
  }

  async markRead(actor: PortalActor, requested: PartyRequest): Promise<{ updated: number }> {
    const party = await this.resolveParty(actor, requested);
    return { updated: await this.repo.markRead(party, this.isDvs(actor)) };
  }

  async getThreads(): Promise<PortalThreadDto[]> {
    return this.repo.findThreads();
  }
}
