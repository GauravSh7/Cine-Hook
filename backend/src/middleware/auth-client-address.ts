import { BlockList, isIP } from 'node:net';

type AddressRequest = { socket: { remoteAddress?: string }; headers: Record<string, string | string[] | undefined> };
function canonical(value: string): string | undefined {
  if (isIP(value) === 4) return value;
  if (isIP(value) !== 6 || value.includes('%')) return undefined;
  const normalized = new URL(`http://[${value}]/`).hostname.slice(1, -1);
  const mapped = /^::ffff:([a-f0-9]+):([a-f0-9]+)$/.exec(normalized);
  if (!mapped) return normalized;
  const high = parseInt(mapped[1]!, 16), low = parseInt(mapped[2]!, 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

// Auth-only trust boundary: never changes Express global trust proxy, cookies,
// protocol detection, payment handling or request authorization.
export function createAuthClientAddress(cidrs: readonly string[]) {
  const trusted = new BlockList();
  for (const entry of cidrs) {
    const parts = entry.split('/'), ip = canonical(parts[0] ?? '');
    const family = ip && isIP(ip), bits = family === 4 ? 32 : 128;
    const prefix = parts.length === 1 ? bits : /^\d+$/.test(parts[1] ?? '') ? Number(parts[1]) : NaN;
    if (!ip || !family || parts.length > 2 || !Number.isInteger(prefix) || prefix <= 0 || prefix > bits) {
      throw new Error('Invalid AUTH_TRUSTED_PROXY_CIDRS');
    }
    trusted.addSubnet(ip, prefix, family === 4 ? 'ipv4' : 'ipv6');
  }
  return (req: AddressRequest): string => {
    const socket = canonical(req.socket.remoteAddress ?? '') ?? 'unknown';
    const raw = req.headers['x-forwarded-for'];
    if (typeof raw !== 'string' || raw.length > 2048) return socket;
    const chain = raw.split(',');
    if (chain.length > 32) return socket;
    const addresses = chain.map(value => canonical(value.trim()));
    if (addresses.some(value => !value)) return socket;
    let current = socket;
    // Stop at the first untrusted hop. A forged left-hand prefix can never
    // cross that boundary. Trust only operator-verified sanitizing proxies.
    for (let i = addresses.length - 1; i >= 0; i--) {
      const family = isIP(current);
      if (!family || !trusted.check(current, family === 4 ? 'ipv4' : 'ipv6')) break;
      current = addresses[i]!;
    }
    return current;
  };
}
