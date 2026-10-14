import { catalogueTargetFingerprint } from '../src/lib/catalogue-stage.js';

type Environment = Record<string, string | undefined>;
export type StagingTarget = { url: string; host: string; database: string; role: string; backendOrigin: string; fingerprint: string };
const invalid = () => new Error('Invalid staging target. Configure the dedicated STAGING_* settings; credentials are never logged.');
export function resolveStagingTarget(env: Environment): StagingTarget {
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === '0' || env.STAGING_IMPORT_ENV !== 'staging' || !env.STAGING_DATABASE_URL || !env.STAGING_EXPECTED_HOST || !env.STAGING_EXPECTED_DATABASE || !env.STAGING_EXPECTED_ROLE) throw invalid();
  let url: URL;
  try { url = new URL(env.STAGING_DATABASE_URL); } catch { throw invalid(); }
  if (!['postgresql:', 'postgres:'].includes(url.protocol) || !/^[a-z0-9.-]+\.neon\.tech$/.test(url.hostname)
    || url.hostname !== env.STAGING_EXPECTED_HOST || url.hostname.includes('-pooler.') || (url.port && url.port !== '5432')
    || decodeURIComponent(url.pathname.slice(1)) !== env.STAGING_EXPECTED_DATABASE || decodeURIComponent(url.username) !== env.STAGING_EXPECTED_ROLE
    || !url.password || url.hash || url.searchParams.get('sslmode') !== 'verify-full'
    || [...url.searchParams.keys()].some(key => !['sslmode', 'channel_binding'].includes(key))
    || url.searchParams.getAll('sslmode').length !== 1) throw invalid();
  const backendOrigin = env.STAGING_BACKEND_ORIGIN;
  if (backendOrigin !== 'https://cinehook.onrender.com') throw invalid();
  return { url: url.toString(), host: url.hostname, database: env.STAGING_EXPECTED_DATABASE, role: env.STAGING_EXPECTED_ROLE,
    backendOrigin, fingerprint: catalogueTargetFingerprint(url.toString()) };
}
export function verifyStagingIdentity(target: StagingTarget, actual?: { database: string; role: string; schema: string; port: number }): void {
  if (!actual || actual.database !== target.database || actual.role !== target.role || actual.schema !== 'public' || actual.port !== 5432)
    throw new Error('Staging database identity mismatch; import stopped.');
}
export function parseImportArguments(args: string[]): { mode: 'dry-run' | 'apply' | 'offline-plan'; startDate?: string; approvedPlan?: string } {
  let mode: 'dry-run' | 'apply' | 'offline-plan' = 'dry-run', startDate: string | undefined, approvedPlan: string | undefined, approveWrite = false;
  const modes = args.filter(arg => ['--apply', '--dry-run', '--offline-plan'].includes(arg));
  if (modes.length > 1) throw new Error('Select exactly one import mode.');
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--apply') mode = 'apply';
    else if (arg === '--dry-run') mode = 'dry-run';
    else if (arg === '--offline-plan') mode = 'offline-plan';
    else if (arg === '--approve-write') approveWrite = true;
    else if (arg === '--start-date') {
      if (startDate || !args[i + 1] || args[i + 1]!.startsWith('--')) throw new Error('Invalid staging start-date argument.');
      startDate = args[++i];
    }
    else if (arg === '--approved-plan') approvedPlan = args[++i];
    else throw new Error('Unknown staging importer argument.');
  }
  if (mode === 'apply' && (!approveWrite || !/^[a-f0-9]{64}$/.test(approvedPlan ?? ''))) throw new Error('Apply requires explicit write approval and the verified dry-run plan hash.');
  if (mode !== 'apply' && (approveWrite || approvedPlan)) throw new Error('Write approval is only valid with apply.');
  return { mode, startDate, approvedPlan };
}
export async function verifyStagingBackend(target: StagingTarget, fetcher: typeof fetch = fetch): Promise<void> {
  const response = await fetcher(`${target.backendOrigin}/api/catalogue/status`, { signal: AbortSignal.timeout(20000), redirect: 'error' });
  const body = await response.json() as { data?: { mode?: string; newPaymentsAllowed?: boolean; targetFingerprint?: string } };
  if (!response.ok || body.data?.mode !== 'staging' || body.data.newPaymentsAllowed !== false || body.data.targetFingerprint !== target.fingerprint)
    throw new Error('Backend staging/payment guard or database fingerprint does not match; import stopped.');
}
export function safeStagingFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  const fixed = new Set(['Invalid staging target. Configure the dedicated STAGING_* settings; credentials are never logged.',
    'Staging database identity mismatch; import stopped.', 'Select exactly one import mode.',
    'Unknown staging importer argument.', 'Invalid staging start-date argument.', 'Invalid staging start date.',
    'Apply requires explicit write approval and the verified dry-run plan hash.', 'Write approval is only valid with apply.',
    'Backend staging/payment guard or database fingerprint does not match; import stopped.',
    'Staging start date must be a future India-local calendar day.', 'Staging schema is missing repository migrations; import stopped.',
    'Staging dry-run plan changed; request a new approval before applying.',
    'Staging catalogue insert count mismatch; transaction must roll back.']);
  for(const diagnostic of ['Full parity preserves source dates; do not pass --start-date.','Local catalogue source identity mismatch.',
    'Invalid catalogue-only snapshot.','Invalid catalogue-only snapshot or inventory graph.','Frozen catalogue contains expired sessions; generate a new preview.',
    'Staging media availability or rights review is incomplete.','Existing catalogue metadata differs; no existing rows may be overwritten.',
    'Staging parity verification failed; transaction must roll back.'])fixed.add(diagnostic);
  if (fixed.has(message) || /^Staging catalogue identity\/layout collision \((city|movie|theatre|screen|seat|show|showSeatPrice|event|eventPerformer|eventParticipant|eventVenue|eventSection|eventSeat|eventSession|eventSessionPrice|demoListing)\); no existing data may be changed\.$/.test(message)) return message;
  return 'Staging import stopped safely; inspect target settings and provider availability.';
}
