import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcrypt';
import { AppError } from '../../errors/app-error.js';
import type { PasswordRecoveryStore, PasswordRecoveryUsers, RecoveryMailer, SessionGuard } from './password-reset.types.js';
import { credentialTag } from './password-credential.js';

const invalid = () => new AppError(400, 'PASSWORD_RESET_INVALID', 'This reset link is invalid or expired. Request a new link.');
const accepted = { message: 'If this email has a password account, a reset link will be sent. Please check your inbox.' };
export class PasswordResetService {
  constructor(private readonly users: PasswordRecoveryUsers, private readonly store: PasswordRecoveryStore,
    private readonly sessions: SessionGuard, private readonly options: { secret: string; frontendOrigin: string; mailer?: RecoveryMailer }) {}
  private hash(value: string) { return createHash('sha256').update(value).digest('hex'); }
  private tag(hash: string) { return credentialTag(this.options.secret, hash); }
  async request(email: string, address: string) {
    if (!this.options.mailer) throw new AppError(503, 'PASSWORD_RESET_UNAVAILABLE', 'Password reset email is not available yet. Please try again later.');
    if (!await this.store.allowRequest(this.hash(email), this.hash(address))) return accepted;
    const user = await this.users.findByEmail(email);
    if (!user?.passwordHash) return accepted;
    const token = randomBytes(32).toString('base64url');
    await this.store.save(this.hash(token), { userId: user.id, credentialTag: this.tag(user.passwordHash) }, 900);
    // URL fragments are not sent to Vercel/Render logs or third-party referrers.
    const url = new URL('/reset-password', this.options.frontendOrigin); url.hash = `token=${token}`;
    // Accepted means queued for delivery, not delivered. Never expose account existence
    // through the provider's latency or an email-specific provider failure response.
    void this.options.mailer.sendResetLink(user.email, url.toString()).catch(async () => {
      try { await this.store.consume(this.hash(token)); } catch { /* Token still expires after 15 minutes. */ }
      console.warn(JSON.stringify({ event: 'password_recovery_delivery_failed' }));
    });
    return accepted;
  }
  async reset(token: string, password: string) {
    const evidence = await this.store.consume(this.hash(token));
    if (!evidence) throw invalid();
    const user = await this.users.findById(evidence.userId);
    if (!user?.passwordHash) throw invalid();
    const actual = this.tag(user.passwordHash);
    if (!/^[a-f0-9]{64}$/.test(evidence.credentialTag) || !timingSafeEqual(Buffer.from(actual), Buffer.from(evidence.credentialTag))) throw invalid();
    const passwordHash = await bcrypt.hash(password, 12);
    // Revoke before DB mutation so a Redis failure cannot leave old access live after reset.
    await this.sessions.revoke(user.id, this.tag(passwordHash));
    if (!await this.users.replacePassword(user.id, user.passwordHash, passwordHash)) throw invalid();
    return { message: 'Your password has been changed. Sign in with your new password.' };
  }
}
