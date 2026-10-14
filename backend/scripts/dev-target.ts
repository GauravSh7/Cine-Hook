export type DevelopmentTarget = { url: string; database: 'cinehook_dev'; port: 5432 };
export type Environment = Record<string, string | undefined>;
export type IdentityQuery = { query: (sql: string) => Promise<{ rows: Array<{ database: string; schema: string; port: number }> }> };
export const IDENTITY_SQL = 'SELECT current_database() AS database, current_schema() AS schema, inet_server_port() AS port';

/** No dotenv, client, network or CLI side effects when imported. */
export function resolveDevTarget(env: Environment): DevelopmentTarget {
  if (env.NODE_ENV && env.NODE_ENV !== 'development') throw new Error('This explicit development command requires NODE_ENV=development.');
  const value = env.DEV_DATABASE_URL ?? env.DATABASE_URL;
  if (!value) throw new Error('Configure a local development database URL first.');
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error('A valid local PostgreSQL development database URL is required.'); }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !['localhost','127.0.0.1','[::1]'].includes(parsed.hostname.toLowerCase()) ||
      (parsed.port && parsed.port !== '5432') || parsed.search || parsed.hash) {
    throw new Error('Development database must be loopback PostgreSQL on port 5432 with no query or fragment overrides.');
  }
  if (env.DEV_DATABASE_URL && parsed.pathname !== '/cinehook_dev') throw new Error('Explicit development database must be cinehook_dev.');
  parsed.pathname = '/cinehook_dev';
  return { url: parsed.toString(), database: 'cinehook_dev', port: 5432 };
}

export async function verifyDatabaseIdentity(client: IdentityQuery, target: Pick<DevelopmentTarget, 'database' | 'port'>): Promise<void> {
  const identity = (await client.query(IDENTITY_SQL)).rows[0];
  if (!identity || identity.database !== target.database || identity.schema !== 'public' || identity.port !== target.port) {
    throw new Error('Development database identity mismatch; operation stopped.');
  }
}

export type DevelopmentCommand = 'check' | 'migrate' | 'start' | 'seed';
export type CommandDependencies = {
  connect: (url: string) => Promise<IdentityQuery & { end: () => Promise<void> }>;
  launch: (command: Exclude<DevelopmentCommand, 'check'>, env: Environment) => Promise<number>;
};

export async function runDevCommand(command: DevelopmentCommand, env: Environment, deps: CommandDependencies): Promise<number> {
  const target = resolveDevTarget(env); // Must precede construction of any database client.
  let client: Awaited<ReturnType<CommandDependencies['connect']>>;
  try { client = await deps.connect(target.url); } catch { throw new Error('Cannot connect to cinehook_dev on local port 5432. Create it with your local administrator, owned by the existing app role, and check permissions.'); }
  try { await verifyDatabaseIdentity(client, target); } finally { await client.end(); }
  if (command === 'check') return 0;
  return deps.launch(command, { ...env, NODE_ENV: 'development', DATABASE_URL: target.url });
}
