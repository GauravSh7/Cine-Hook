import { describe, expect, it } from 'vitest';
import { createAuthClientAddress } from '../src/middleware/auth-client-address.js';
import { parseConfig } from '../src/config/env.js';

const request = (remoteAddress: string, forwarded?: string, extra = {}) => ({
  socket: { remoteAddress }, headers: { 'x-forwarded-for': forwarded, ...extra },
});
describe('authentication client address trust boundary', () => {
  it('defaults to no proxy trust and rejects unsafe environment configuration at startup', () => {
    const base = { DATABASE_URL: 'postgresql://user:pass@localhost/cinehook_dev', REDIS_URL: 'redis://localhost:6379',
      JWT_SECRET: 'test-only-configuration-secret-123456789', FRONTEND_ORIGIN: 'http://localhost:5173' };
    expect(parseConfig(base).authTrustedProxyCidrs).toEqual([]);
    expect(parseConfig({ ...base, AUTH_TRUSTED_PROXY_CIDRS: '10.20.0.0/24, 198.51.100.10/32' }).authTrustedProxyCidrs)
      .toEqual(['10.20.0.0/24', '198.51.100.10/32']);
    expect(() => parseConfig({ ...base, AUTH_TRUSTED_PROXY_CIDRS: '0.0.0.0/0' })).toThrow('AUTH_TRUSTED_PROXY_CIDRS');
  });
  it('ignores all forwarding headers without an explicitly trusted socket peer', () => {
    const address = createAuthClientAddress([]);
    expect(address(request('192.0.2.1', '203.0.113.9', { 'x-real-ip': '203.0.113.8', 'x-vercel-forwarded-for': '203.0.113.7', 'cf-connecting-ip': '203.0.113.6' }))).toBe('192.0.2.1');
  });
  it('distinguishes direct clients behind a trusted Render ingress, ignoring forged prefixes', () => {
    const address = createAuthClientAddress(['10.20.0.0/24']);
    expect(address(request('10.20.0.2', '1.2.3.4, 192.0.2.1'))).toBe('192.0.2.1');
    expect(address(request('10.20.0.2', '192.0.2.2'))).toBe('192.0.2.2');
  });
  it('walks Render and explicitly trusted Vercel hops, never trusting an arbitrary Vercel header', () => {
    const address = createAuthClientAddress(['10.20.0.0/24', '198.51.100.10/32']);
    expect(address(request('10.20.0.2', '1.2.3.4, 192.0.2.1, 198.51.100.10'))).toBe('192.0.2.1');
    expect(address(request('10.20.0.2', '192.0.2.2, 198.51.100.10'))).toBe('192.0.2.2');
    expect(address(request('10.20.0.2', '192.0.2.99, 203.0.113.3', { 'x-vercel-forwarded-for': '192.0.2.88' }))).toBe('203.0.113.3');
  });
  it('canonicalizes IPv4-mapped and equivalent IPv6 addresses to prevent bucket rotation', () => {
    const address = createAuthClientAddress([]);
    expect(address(request('::ffff:c000:201'))).toBe('192.0.2.1');
    expect(address(request('2001:0db8:0:0:0:0:0:1'))).toBe('2001:db8::1');
  });
  it('fails closed for malformed or excessive forwarding chains', () => {
    const address = createAuthClientAddress(['10.20.0.0/24']);
    for (const value of ['unknown', '192.0.2.1:123', '192.0.2.1,,10.20.0.3', Array(34).fill('10.20.0.3').join(',')]) {
      expect(address(request('10.20.0.2', value))).toBe('10.20.0.2');
    }
  });
  it('rejects unrestricted, alias, hostname and invalid proxy configurations', () => {
    for (const cidr of ['0.0.0.0/0', '::/0', 'true', 'loopback', 'example.com', '10.0.0.1/33', '']) {
      expect(() => createAuthClientAddress([cidr])).toThrow();
    }
  });
});
