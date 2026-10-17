import type { RequestHandler } from 'express';
import { AppError } from '../../errors/app-error.js';
import type { PasswordResetService } from './password-reset.service.js';

export class PasswordResetController {
  constructor(private readonly service?: PasswordResetService) {}
  request: RequestHandler = async (req, res) => {
    if (!this.service) throw new AppError(503, 'PASSWORD_RESET_UNAVAILABLE', 'Password reset email is not available yet.');
    res.status(202).json({ success: true, data: await this.service.requestOtp(req.body.email as string, req.ip ?? 'unknown') });
  };
  verify: RequestHandler = async (req, res) => {
    if (!this.service) throw new AppError(503, 'PASSWORD_RESET_UNAVAILABLE', 'Password reset email is not available yet.');
    res.json({ success: true, data: await this.service.verifyOtp(req.body.challengeId as string, req.body.otp as string) });
  };
  reset: RequestHandler = async (req, res) => {
    if (!this.service) throw new AppError(503, 'PASSWORD_RESET_UNAVAILABLE', 'Password reset email is not available yet.');
    res.json({ success: true, data: await this.service.reset(req.body.token as string, req.body.password as string) });
  };
}
