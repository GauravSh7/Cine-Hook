import type { RecoveryMailer } from './password-reset.types.js';

export class ResendRecoveryMailer implements RecoveryMailer {
  constructor(private readonly options: { apiKey: string; from: string }, private readonly request: typeof fetch = fetch) {}
  async sendResetLink(email: string, resetUrl: string) {
    const response = await this.request('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${this.options.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: this.options.from, to: [email], subject: 'Reset your CineHook password',
        text: `Open this link to choose a new CineHook password:\n\n${resetUrl}\n\nThis link expires in 15 minutes and can be used once. If you did not request it, ignore this email.` }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error('Password recovery email delivery failed.');
    const data: unknown = await response.json();
    if (!data || typeof data !== 'object' || !('id' in data) || typeof data.id !== 'string') throw new Error('Password recovery email delivery failed.');
  }
}
