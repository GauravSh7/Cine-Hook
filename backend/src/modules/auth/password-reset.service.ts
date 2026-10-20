import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcrypt';
import { AppError } from '../../errors/app-error.js';
import type { PasswordRecoveryStore, PasswordRecoveryUsers, RecoveryMailer, RecoveryUser, SessionGuard } from './password-reset.types.js';
import { credentialTag } from './password-credential.js';
import { RecoveryDeliveryError } from './password-reset.mailer.js';

const invalid = () => new AppError(400, 'PASSWORD_RESET_INVALID', 'This code or reset session is invalid or expired. Request a new code.');
const accepted = { message: 'If this email has a password account, a reset link will be sent. Please check your inbox.' };
export class PasswordResetService {
  constructor(private readonly users: PasswordRecoveryUsers, private readonly store: PasswordRecoveryStore,
    private readonly sessions: SessionGuard, private readonly options: { secret: string; frontendOrigin: string; mailer?: RecoveryMailer }) {}
  private hash(value: string) { return createHash('sha256').update(value).digest('hex'); }
  private tag(hash: string) { return credentialTag(this.options.secret, hash); }
  private recoveryTag(user: RecoveryUser) {
    // Bind password initialization to this existing verified Google identity,
    // not a shared null-password marker. Never create or merge users here.
    return createHmac('sha256', this.options.secret)
      .update(JSON.stringify(['cinehook:verified-recovery:v2', user.id, user.email, user.googleSubject, user.passwordHash, user.authVersion, user.emailVerifiedAt])).digest('hex');
  }
  private eligible(user: RecoveryUser | null): user is RecoveryUser { return Boolean(user && user.emailVerifiedAt && Number.isInteger(user.authVersion) && !user.authDisabledAt && (user.passwordHash || user.googleSubject)); }
  private otpDigest(challenge: string, otp: string) {
    return createHmac('sha256', this.options.secret).update(`recovery-otp:${challenge}:${otp}`).digest('hex');
  }
  async requestOtp(email: string, address: string) {
    if (!this.options.mailer?.sendOtp || !this.store.saveOtp) throw new AppError(503, 'PASSWORD_RESET_UNAVAILABLE', 'Password reset email is not available yet. Please try again later.');
    const challengeId = randomBytes(32).toString('base64url');
    const response = { challengeId, message: 'If this email has an eligible account, a verification code will be sent. Check your inbox.' };
    if (!await this.store.allowRequest(this.hash(email), this.hash(address))) {
      // Throttling depends only on submitted email/network counts, not account
      // existence. Preserve the browser's existing challenge on a rejected resend.
      throw new AppError(429, 'PASSWORD_RESET_RATE_LIMITED', 'Too many reset requests. Please wait before requesting another code.');
    }
    const user = await this.users.findByEmail(email);
    if (!this.eligible(user)) return response;
    const otp = randomInt(0, 1000000).toString().padStart(6, '0');
    await this.store.saveOtp(this.hash(challengeId), { userId: user.id, credentialTag: this.recoveryTag(user), digest: this.otpDigest(challengeId, otp), attempts: 0 }, 600);
    void this.options.mailer.sendOtp(user.email, otp).catch((error: unknown) => {
      console.warn(JSON.stringify({ event: 'password_recovery_delivery_failed',
        ...(error instanceof RecoveryDeliveryError ? { provider: 'brevo', code: error.code } : {}) }));
    });
    return response;
  }
  async verifyOtp(challengeId: string, otp: string) {
    if (!this.store.verifyOtp || !/^[A-Za-z0-9_-]{43}$/.test(challengeId) || !/^\d{6}$/.test(otp)) throw invalid();
    const token = randomBytes(32).toString('base64url');
    if (!await this.store.verifyOtp(this.hash(challengeId), this.otpDigest(challengeId, otp), this.hash(token))) throw invalid();
    return { token, message: 'Code verified. Choose a new password.' };
  }
  async request(email: string, address: string) {
    if (!this.options.mailer) throw new AppError(503, 'PASSWORD_RESET_UNAVAILABLE', 'Password reset email is not available yet. Please try again later.');
    if (!await this.store.allowRequest(this.hash(email), this.hash(address))) return accepted;
    const user = await this.users.findByEmail(email);
    if (!this.eligible(user) || !user.passwordHash) return accepted;
    const token = randomBytes(32).toString('base64url');
    await this.store.save(this.hash(token), { userId: user.id, credentialTag: this.recoveryTag(user) }, 900);
    // URL fragments are not sent to Vercel/Render logs or third-party referrers.
    const url = new URL('/reset-password', this.options.frontendOrigin); url.hash = `token=${token}`;
    // Accepted means queued for delivery, not delivered. Never expose account existence
    // through the provider's latency or an email-specific provider failure response.
    void this.options.mailer.sendResetLink(user.email, url.toString()).catch(async (error: unknown) => {
      try { await this.store.consume(this.hash(token)); } catch { /* Token still expires after 15 minutes. */ }
      console.warn(JSON.stringify({ event: 'password_recovery_delivery_failed',
        ...(error instanceof RecoveryDeliveryError ? { provider: 'brevo', code: error.code } : {}) }));
    });
    return accepted;
  }
  async reset(token: string, password: string) {
    const evidence = this.store.peek ? await this.store.peek(this.hash(token)) : await this.store.consume(this.hash(token));
    if (!evidence) throw invalid();
    const user = await this.users.findById(evidence.userId);
    if (!this.eligible(user)) throw invalid();
    const actual = this.recoveryTag(user);
    if (!/^[a-f0-9]{64}$/.test(evidence.credentialTag) || !timingSafeEqual(Buffer.from(actual), Buffer.from(evidence.credentialTag))) throw invalid();
    if (user.passwordHash && await bcrypt.compare(password, user.passwordHash)) {
      throw new AppError(400, 'PASSWORD_REUSED', 'Your new password must be different from your current password.');
    }
    // Consume atomically only after validation; rejecting a reused password must
    // not extend the grant expiry or force the user to request another OTP.
    if (this.store.peek && !await this.store.consume(this.hash(token))) throw invalid();
    const passwordHash = await bcrypt.hash(password, 12);
    // Revoke before DB mutation so a Redis failure cannot leave old access live after reset.
    await this.sessions.revoke(user.id, this.tag(passwordHash));
    if (!await this.users.replacePassword(user.id, user.passwordHash, passwordHash, user.authVersion!)) throw invalid();
    return { message: user.passwordHash ? 'Your password has been changed. Sign in with your new password.'
      : 'Your password has been created. You can sign in with your password or Google.' };
  }
}
