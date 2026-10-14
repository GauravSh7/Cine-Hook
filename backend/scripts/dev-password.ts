import { emitKeypressEvents } from 'node:readline';
import { validateAdminPassword } from '../prisma/dev-seed-manifest.js';

/** Uses terminal raw mode so a new admin password is never echoed. */
export async function promptAdminPassword(): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('First development admin creation requires DEV_ADMIN_PASSWORD or an interactive terminal for the hidden password prompt.');
  const input = process.stdin, wasRaw = input.isRaw;
  emitKeypressEvents(input);
  const readHidden = (label: string): Promise<string> => new Promise((resolve, reject) => {
    let value = '';
    process.stdout.write(label);
    input.setRawMode(true); input.resume();
    const finish = (error?: Error) => {
      input.removeListener('keypress', onKey); input.setRawMode(wasRaw); input.pause(); process.stdout.write('\n');
      if (error) reject(error); else resolve(value);
    };
    const onKey = (text: string | undefined, key: { name?: string; ctrl?: boolean; meta?: boolean }) => {
      if (key.ctrl && key.name === 'c') return finish(new Error('Development admin password entry cancelled.'));
      if (key.name === 'return' || key.name === 'enter') return finish();
      if (key.name === 'backspace') { value = Array.from(value).slice(0, -1).join(''); return; }
      if (!key.ctrl && !key.meta && text) value += text;
    };
    input.on('keypress', onKey);
  });
  const password = await readHidden('New development admin password (hidden): ');
  validateAdminPassword(password);
  if (await readHidden('Confirm development admin password (hidden): ') !== password) throw new Error('Development admin password confirmation did not match.');
  return password;
}
