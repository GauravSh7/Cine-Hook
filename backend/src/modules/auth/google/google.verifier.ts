import { OAuth2Client } from 'google-auth-library';
import type { GoogleVerifier } from './google.types.js';
export class GoogleIdTokenVerifier implements GoogleVerifier {
  private readonly client = new OAuth2Client();
  constructor(private readonly clientId: string) {}
  async verify(credential: string) {
    const ticket = await this.client.verifyIdToken({ idToken: credential, audience: this.clientId });
    return ticket.getPayload();
  }
}
