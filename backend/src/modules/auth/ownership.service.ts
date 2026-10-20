import { createHmac } from 'node:crypto';
import bcrypt from 'bcrypt';
import { AppError } from '../../errors/app-error.js';
import { toPublicUser } from './auth.types.js';
import type { OwnershipRepository, OwnershipSnapshot } from './ownership.repository.js';
import type { OwnershipProofStore, ProofPurpose } from './ownership-proof.store.js';
import type { TokenService } from './token.service.js';
import type { RecoveryMailer } from './password-reset.types.js';

export interface CompleteOwnership {
  purpose: ProofPurpose; token: string; password: string; name?: string;
  currentPassword?: string; cleanStartConfirmed?: boolean; email?: string;
}
export class OwnershipService {
  constructor(private readonly users: OwnershipRepository, private readonly proofs: OwnershipProofStore,
    private readonly tokens: TokenService, private readonly options: { secret: string; mailer?: Pick<RecoveryMailer, 'sendOtp'|'sendVerificationCode'> }) {}
  private tag(user: OwnershipSnapshot) {
    return createHmac('sha256', this.options.secret).update(JSON.stringify(['ownership-state-v1', user.id, user.email,
      user.authVersion, user.passwordHash, user.googleSubject, user.emailVerifiedAt, user.authDisabledAt])).digest('hex');
  }
  async request(purpose: ProofPurpose, email: string, address: string) {
    if (!this.options.mailer?.sendOtp && !this.options.mailer?.sendVerificationCode) throw new AppError(503, 'OWNERSHIP_EMAIL_UNAVAILABLE', 'Email verification is temporarily unavailable.');
    email = email.trim().toLowerCase();
    const user = await this.users.findByEmail(email);
    return this.proofs.request({ purpose, email, address,
      snapshot: user ? { userId: user.id, authVersion: user.authVersion, credentialTag: this.tag(user) } : null,
      send: otp => this.options.mailer!.sendVerificationCode ? this.options.mailer!.sendVerificationCode(email, otp, purpose) : this.options.mailer!.sendOtp!(email, otp) });
  }
  verify(challengeId: string, otp: string) { return this.proofs.verify(challengeId, otp); }
  async complete(input: CompleteOwnership) {
    const proof = await this.proofs.consume(input.token, input.purpose);
    if (!proof || (input.email !== undefined && input.email !== proof.email)) throw invalid();
    if (Array.from(input.password).length < 8 || Buffer.byteLength(input.password) > 72 || input.password.includes('\0')) throw invalid();
    const user = await this.users.findByEmail(proof.email);
    if (proof.snapshot ? !user || user.id !== proof.snapshot.userId || user.authVersion !== proof.snapshot.authVersion
      || this.tag(user) !== proof.snapshot.credentialTag : Boolean(user)) throw invalid();
    if (user?.authDisabledAt || proof.email.endsWith('.invalid')) throw invalid();
    if (user?.passwordHash && await bcrypt.compare(input.password, user.passwordHash)) {
      throw new AppError(400, 'PASSWORD_REUSED', 'Choose a password different from your current password.');
    }
    if (input.purpose === 'RESET_PASSWORD' && (!user || !user.emailVerifiedAt)) {
      throw new AppError(409, 'OWNERSHIP_CONTINUITY_REQUIRED', 'Verify your existing password and email, or choose a clean account without previous history. Google users should sign in with Google.');
    }
    if (input.purpose === 'VERIFY_LEGACY' && (!user?.passwordHash || !input.currentPassword || !await bcrypt.compare(input.currentPassword, user.passwordHash))) throw invalid();
    if (input.purpose === 'CLEAN_START' && (!user || !input.cleanStartConfirmed)) throw invalid();
    const passwordHash = await bcrypt.hash(input.password, 12);
    let established;
    switch (input.purpose) {
      case 'REGISTER':
        if (user || !input.name?.trim()) throw invalid();
        established = await this.users.createVerified({ email: proof.email, name: input.name.trim(), passwordHash }); break;
      case 'VERIFY_LEGACY':
        if (!user) throw invalid();
        established = await this.users.verifyLegacy(user, passwordHash); break;
      case 'CLEAN_START':
        if (!user || !input.name?.trim()) throw invalid();
        established = await this.users.cleanStart(user, { name: input.name.trim(), passwordHash }); break;
      case 'RESET_PASSWORD':
        if (!user) throw invalid();
        established = await this.users.resetVerified(user, passwordHash); break;
    }
    return { user: toPublicUser(established), accessToken: this.tokens.sign({ userId: established.id,
      role: established.role, authVersion: established.authVersion }), tokenType: 'Bearer' };
  }
}
function invalid() { return new AppError(400, 'OWNERSHIP_PROOF_INVALID', 'Verification could not be completed. Request a new code.'); }
