import { createHmac } from 'node:crypto';

export function credentialTag(secret: string, passwordHash: string): string {
  return createHmac('sha256', secret).update(`cinehook:password-recovery:v1:${passwordHash}`).digest('hex');
}
