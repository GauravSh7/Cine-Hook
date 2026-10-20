import type { RequestHandler } from 'express';
import type { AuthService } from './auth.service.js';
import type { Identity } from './auth.types.js';
import { toPublicUser } from './auth.types.js';

export class AuthController {
  constructor(private readonly service: AuthService) {}

  register: RequestHandler = async (req, res) => {
    res.status(201).json({ success: true, data: await this.service.register(req.body) });
  };

  login: RequestHandler = async (req, res) => {
    res.json({ success: true, data: await this.service.login(req.body) });
  };

  me: RequestHandler = async (_req, res) => {
    const identity = res.locals.identity as Identity;
    res.json({ success: true, data: { user: res.locals.authUser ? toPublicUser(res.locals.authUser) : await this.service.getMe(identity.userId) } });
  };
}
