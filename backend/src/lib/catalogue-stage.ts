import { createHash } from 'node:crypto';

/** Hash only target identity; credentials never participate or leave the server. */
export function catalogueTargetFingerprint(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  const identity = [url.hostname.toLowerCase().replace('-pooler.', '.'), decodeURIComponent(url.pathname.slice(1)), decodeURIComponent(url.username)];
  return createHash('sha256').update(JSON.stringify(identity)).digest('hex');
}
export function catalogueStageStatus(databaseUrl: string, staging: boolean) {
  return { mode: staging ? 'staging' : 'standard', newPaymentsAllowed: !staging,
    targetFingerprint: staging ? catalogueTargetFingerprint(databaseUrl) : null };
}
