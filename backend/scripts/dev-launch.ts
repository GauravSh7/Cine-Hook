import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';
import { runDevCommand, type DevelopmentCommand, type Environment } from './dev-target.js';

const backendPath = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);

/** Spawn Node directly: portable Windows execution, no shell or URL arguments. */
async function launch(command: Exclude<DevelopmentCommand, 'check'>, env: Environment): Promise<number> {
  const args = command === 'migrate'
    ? [require.resolve('prisma/build/index.js'), 'migrate', 'deploy']
    : [require.resolve('tsx/cli'), ...(command === 'start' ? ['watch', 'src/server.ts'] : ['prisma/dev-seed.ts'])];
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: backendPath, env, stdio: 'inherit', shell: false });
    const forward = (signal: NodeJS.Signals) => child.kill(signal);
    const onInterrupt = () => forward('SIGINT'), onTerminate = () => forward('SIGTERM');
    process.on('SIGINT', onInterrupt); process.on('SIGTERM', onTerminate);
    const clean = () => { process.removeListener('SIGINT', onInterrupt); process.removeListener('SIGTERM', onTerminate); };
    child.once('error', () => { clean(); reject(new Error('Development child process could not start.')); });
    child.once('exit', (code, signal) => { clean(); resolve(code ?? (signal ? 1 : 0)); });
  });
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (!['check','migrate','start','seed'].includes(command ?? '')) throw new Error('Invalid development command; use the explicit npm development database scripts.');
  const preview = process.argv[3] === '--billing-preview';
  const testCheckout=process.argv[3]==='--razorpay-test';
  if(testCheckout&&command!=='start')throw new Error('Invalid development command: razorpay-test requires start.');
  if (preview && command !== 'start') throw new Error('Invalid development command: billing-preview requires start.');
  dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });
  // Runtime override only. dotenv in the child keeps these explicitly empty
  // values; configured provider secrets remain untouched in the ignored .env.
  const runtimeEnv = preview ? {...process.env,DEV_RAZORPAY_TEST_CHECKOUT:'false', RAZORPAY_KEY_ID:'',RAZORPAY_KEY_SECRET:'',RAZORPAY_WEBHOOK_SECRET:''} : testCheckout?{...process.env,DEV_RAZORPAY_TEST_CHECKOUT:'true'}:process.env;
  process.exitCode = await runDevCommand(command as DevelopmentCommand, runtimeEnv, {
    connect: async url => {
      const pool = new pg.Pool({ connectionString: url, connectionTimeoutMillis: 2000, options: '-c timezone=UTC', max: 1 });
      try { const connection = await pool.connect(); connection.release(); return pool; }
      catch (error) { await pool.end(); throw error; }
    }, launch,
  });
  if (command === 'check' && !process.exitCode) console.log('Verified local development database: cinehook_dev, public schema, port 5432.');
}
main().catch(error => {
  const message = error instanceof Error ? error.message : '';
  console.error(/^(This explicit development|Invalid development|A valid local|Configure a local|Development database|Explicit development|Cannot connect|Development child)/.test(message)
    ? message : 'Development operation stopped. Verify the dedicated cinehook_dev database exists, is migrated, and the app role has permission.');
  process.exitCode = 1;
});
