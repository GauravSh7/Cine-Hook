import type { RequestHandler } from 'express';
import type { OwnershipService } from './ownership.service.js';

export class OwnershipController {
  constructor(private readonly service: OwnershipService) {}
  request: RequestHandler = async (req, res) => { res.json({ success: true, data: await this.service.request(req.body.purpose, req.body.email, req.ip ?? 'unknown') }); };
  verify: RequestHandler = async (req, res) => { res.json({ success: true, data: await this.service.verify(req.body.challengeId, req.body.otp) }); };
  complete: RequestHandler = async (req, res) => { res.json({ success: true, data: await this.service.complete(req.body) }); };
  requestReset: RequestHandler = async (req, res) => { res.json({ success: true, data: await this.service.request('RESET_PASSWORD', req.body.email, req.ip ?? 'unknown') }); };
  reset: RequestHandler = async (req, res) => { await this.service.complete({ ...req.body, purpose: 'RESET_PASSWORD' }); res.json({ success: true, data: { message: 'Your password has changed. Sign in again.' } }); };
}
