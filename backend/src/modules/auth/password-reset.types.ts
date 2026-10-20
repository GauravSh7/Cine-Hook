export interface RecoveryUser { id: string; email: string; passwordHash: string | null; googleSubject?: string | null;
  emailVerifiedAt?: Date | null; authDisabledAt?: Date | null; authVersion?: number }
export interface PasswordRecoveryUsers {
  findByEmail(email: string): Promise<RecoveryUser | null>;
  findById(id: string): Promise<RecoveryUser | null>;
  replacePassword(id: string, expectedHash: string | null, passwordHash: string, expectedVersion: number): Promise<boolean>;
}
export interface RecoveryToken { userId: string; credentialTag: string }
export interface RecoveryOtp extends RecoveryToken { digest: string; attempts: number }
export interface PasswordRecoveryStore {
  allowRequest(emailKey: string, ipKey: string): Promise<boolean>;
  save(tokenHash: string, value: RecoveryToken, seconds: number): Promise<void>;
  consume(tokenHash: string): Promise<RecoveryToken | null>;
  peek?(tokenHash: string): Promise<RecoveryToken | null>;
  saveOtp?(challengeHash: string, value: RecoveryOtp, seconds: number): Promise<void>;
  verifyOtp?(challengeHash: string, digest: string, grantHash: string): Promise<boolean>;
}
export interface RecoveryMailer { sendResetLink(email: string, resetUrl: string): Promise<void>; sendOtp?(email: string, otp: string): Promise<void>;
  sendVerificationCode?(email: string, otp: string, purpose: 'REGISTER'|'VERIFY_LEGACY'|'CLEAN_START'|'RESET_PASSWORD'): Promise<void> }
export interface SessionGuard {
  valid(userId: string, authenticatedAtMs: number, passwordTag?: string): Promise<boolean>;
  revoke(userId: string, nextCredentialTag?: string): Promise<void>;
}
