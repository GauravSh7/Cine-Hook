import type { RecoveryMailer } from './password-reset.types.js';

export type RecoveryDeliveryCode = 'BREVO_AUTH_REJECTED' | 'BREVO_SENDER_REJECTED' | 'BREVO_ACCOUNT_NOT_ACTIVATED'
  | 'BREVO_QUOTA_EXCEEDED' | 'BREVO_RATE_LIMITED' | 'BREVO_DELIVERY_REJECTED' | 'BREVO_TIMEOUT' | 'BREVO_UNAVAILABLE';
export class RecoveryDeliveryError extends Error {
  constructor(readonly code: RecoveryDeliveryCode) { super('Password recovery email delivery failed.'); this.name = 'RecoveryDeliveryError'; }
}
function rejected(status: number, body: unknown): RecoveryDeliveryError {
  const value = body && typeof body === 'object' ? body as { code?: unknown; message?: unknown } : {};
  const message = typeof value.message === 'string' ? value.message.toLowerCase() : '';
  // Classify locally; the provider's free-form message may contain personal data.
  const code: RecoveryDeliveryCode = status === 401 ? 'BREVO_AUTH_REJECTED'
    : status === 429 ? 'BREVO_RATE_LIMITED'
    : value.code === 'not_enough_credits' || /credit|quota/.test(message) ? 'BREVO_QUOTA_EXCEEDED'
    : /not activated|not active|activate.*account|account.*activat/.test(message) ? 'BREVO_ACCOUNT_NOT_ACTIVATED'
    : /sender|from.*email|domain/.test(message) ? 'BREVO_SENDER_REJECTED'
    : status >= 500 ? 'BREVO_UNAVAILABLE' : 'BREVO_DELIVERY_REJECTED';
  return new RecoveryDeliveryError(code);
}

export class BrevoRecoveryMailer implements RecoveryMailer {
  constructor(private readonly options: { apiKey: string; from: string; fromName?: string }, private readonly request: typeof fetch = fetch) {}
  async sendMessage(email: string, subject: string, textContent: string): Promise<string> {
    try {
      const response = await this.request('https://api.brevo.com/v3/smtp/email', {
        method: 'POST', headers: { 'api-key': this.options.apiKey, Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ sender: { email: this.options.from, name: this.options.fromName ?? 'CineHook' },
          to: [{ email }], subject, textContent, tags: ['cinehook-password-recovery'] }),
        signal: AbortSignal.timeout(8000),
      });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) throw rejected(response.status, data);
      if (!data || typeof data !== 'object' || !('messageId' in data) || typeof data.messageId !== 'string' || !data.messageId.trim()) {
        throw new RecoveryDeliveryError('BREVO_DELIVERY_REJECTED');
      }
      return data.messageId;
    } catch (error) {
      if (error instanceof RecoveryDeliveryError) throw error;
      throw new RecoveryDeliveryError(error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name) ? 'BREVO_TIMEOUT' : 'BREVO_UNAVAILABLE');
    }
  }
  async sendResetLink(email: string, resetUrl: string) {
    await this.sendMessage(email, 'Reset your CineHook password',
      `Open this link to choose a new CineHook password:\n\n${resetUrl}\n\nThis link expires in 15 minutes and can be used once. If you did not request it, ignore this email.`);
  }
  async sendOtp(email: string, otp: string) {
    await this.sendMessage(email, 'Your CineHook password reset code',
      `Your CineHook password reset code is:\n\n${otp}\n\nThis code expires in 10 minutes and can be used once. Never share it. If you did not request this code, ignore this email.`);
  }
}
