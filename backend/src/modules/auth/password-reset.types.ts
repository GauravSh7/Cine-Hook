export interface RecoveryUser { id: string; email: string; passwordHash: string | null }
export interface PasswordRecoveryUsers {
  findByEmail(email: string): Promise<RecoveryUser | null>;
  findById(id: string): Promise<RecoveryUser | null>;
  replacePassword(id: string, expectedHash: string, passwordHash: string): Promise<boolean>;
}
export interface RecoveryToken { userId: string; credentialTag: string }
export interface PasswordRecoveryStore {
  allowRequest(emailKey: string, ipKey: string): Promise<boolean>;
  save(tokenHash: string, value: RecoveryToken, seconds: number): Promise<void>;
  consume(tokenHash: string): Promise<RecoveryToken | null>;
}
export interface RecoveryMailer { sendResetLink(email: string, resetUrl: string): Promise<void> }
export interface SessionGuard {
  valid(userId: string, authenticatedAtMs: number, passwordTag?: string): Promise<boolean>;
  revoke(userId: string, nextCredentialTag?: string): Promise<void>;
}
