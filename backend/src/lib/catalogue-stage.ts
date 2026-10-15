import { createHash } from 'node:crypto';

export const APPROVED_STAGING_TARGET_FINGERPRINT = 'b644127b064eab5021e1f1075f6ab6e76383acb29bb978e12c7af626094e5c9a';

/** Hash only target identity; credentials never participate or leave the server. */
export function catalogueTargetFingerprint(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  const identity = [url.hostname.toLowerCase().replace('-pooler.', '.'), decodeURIComponent(url.pathname.slice(1)), decodeURIComponent(url.username)];
  return createHash('sha256').update(JSON.stringify(identity)).digest('hex');
}
export function catalogueStageStatus(databaseUrl: string, staging: boolean, testPaymentsAllowed = false) {
  return { mode: staging ? 'staging' : 'standard', newPaymentsAllowed: !staging,
    testPaymentsAllowed: staging && testPaymentsAllowed,
    targetFingerprint: staging ? catalogueTargetFingerprint(databaseUrl) : null };
}
