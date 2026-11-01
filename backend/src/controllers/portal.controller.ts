import type { Response } from 'express';
import type { AuthenticatedRequest } from '../types';
import { PortalService, type PortalActor } from '../services/portal.service';
import { sendSuccess, sendCreated } from '../utils/response';
import { UnauthorizedError } from '../errors';
import type { PortalPartyQueryInput, SendPortalMessageInput } from '../validators/portal.validator';

const svc = new PortalService();

function actor(req: AuthenticatedRequest): PortalActor {
  if (req.user === undefined) throw new UnauthorizedError('Authentication required');
  return req.user;
}

export async function getMessages(req: AuthenticatedRequest, res: Response): Promise<void> {
  const query = req.query as unknown as PortalPartyQueryInput;
  sendSuccess(res, await svc.getMessages(actor(req), query));
}

export async function sendMessage(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { body, ...party } = req.body as SendPortalMessageInput;
  sendCreated(res, await svc.sendMessage(actor(req), party, body), 'Message sent');
}

export async function markRead(req: AuthenticatedRequest, res: Response): Promise<void> {
  const party = req.body as PortalPartyQueryInput;
  sendSuccess(res, await svc.markRead(actor(req), party));
}

export async function getThreads(_req: AuthenticatedRequest, res: Response): Promise<void> {
  sendSuccess(res, await svc.getThreads());
}
