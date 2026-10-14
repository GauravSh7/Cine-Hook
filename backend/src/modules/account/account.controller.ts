import type { RequestHandler } from 'express';
import { AppError } from '../../errors/app-error.js';
import type { AccountService } from './account.service.js';
export class AccountController {
  constructor(private readonly service: AccountService) {}
  updateProfile: RequestHandler = async (req, res) => {
    const user = await this.service.updateProfile(res.locals.identity.userId, req.body);
    res.json({ success: true, data: { user } });
  };
  uploadAvatar: RequestHandler = async (req, res) => {
    if (!req.file) throw new AppError(400, 'INVALID_IMAGE', 'An image is required.');
    const user = await this.service.uploadAvatar(res.locals.identity.userId, req.file.buffer, req.file.mimetype);
    res.json({ success: true, data: { user } });
  };
}
