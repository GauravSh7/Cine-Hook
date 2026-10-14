import type { RequestHandler } from 'express';
import type { GoogleAuthService } from './google.service.js';
import type { GoogleChallenge } from './google.challenge.js';
export class GoogleAuthController {
  constructor(private readonly service?: GoogleAuthService, private readonly challenge?: GoogleChallenge) {}
  config: RequestHandler = (_req, res) => { res.json({ success: true, data: { clientId: this.service?.clientId ?? null } }); };
  begin: RequestHandler = (_req, res) => { this.service!.requireConfigured(); res.json({ success: true, data: this.challenge!.issue(res) }); };
  login: RequestHandler = async (req, res) => { res.json({ success: true, data: await this.service!.login(req.body.credential, res.locals.googleNonce as string) }); };
  link: RequestHandler = async(req,res)=>{res.json({success:true,data:await this.service!.link(res.locals.identity.userId,req.body.password,req.body.credential,res.locals.googleNonce as string)});};
}
