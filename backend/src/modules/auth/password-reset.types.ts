export interface RecoveryUser { id: string; email: string; passwordHash: string | null }
export interface PasswordRecoveryUsers {
  findByEmail(email: string): Promise<RecoveryUser | null>;
  findById(id: string): Promise<RecoveryUser | null>;
  replacePassword(id: string, expectedHash: string, passwordHash: string): Promise<boolean>;
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
export interface RecoveryMailer { sendResetLink(email: string, resetUrl: string): Promise<void>; sendOtp?(email: string, otp: string): Promise<void> }
export interface SessionGuard {
  valid(userId: string, authenticatedAtMs: number, passwordTag?: string): Promise<boolean>;
  revoke(userId: string, nextCredentialTag?: string): Promise<void>;
}
