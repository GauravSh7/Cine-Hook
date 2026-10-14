import { generateKeyPairSync } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import { GoogleIdTokenVerifier } from '../src/modules/auth/google/google.verifier.js';

afterEach(() => vi.restoreAllMocks());
const clientId = '123-test.apps.googleusercontent.com';
const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
function token(overrides: Record<string, unknown> = {}, wrongKey = false) {
  return jwt.sign({ sub: '123456789', email: 'test@example.com', email_verified: true, nonce: 'n'.repeat(43), ...overrides }, wrongKey ? generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey : pair.privateKey,
    { algorithm: 'RS256', keyid: 'test-key', issuer: 'https://accounts.google.com', audience: clientId, expiresIn: 3600 });
}
function verifier() {
  // Only Google's certificate retrieval boundary is replaced. The official
  // library's actual RSA signature, issuer, expiry and audience checks run.
  vi.spyOn(OAuth2Client.prototype, 'getFederatedSignonCertsAsync').mockResolvedValue({ certs: { 'test-key': pair.publicKey.export({ type: 'spki', format: 'pem' }).toString() }, format: 'PEM' as any });
  return new GoogleIdTokenVerifier(clientId);
}
it('passes a genuine RSA-verified payload to claim validation', async () => {
  expect(await verifier().verify(token())).toMatchObject({ sub: '123456789', aud: clientId });
});
it('rejects wrong RSA signature instead of accepting a decoded JWT', async () => {
  await expect(verifier().verify(token({}, true))).rejects.toThrow();
});
it('rejects a JWT with the wrong audience', async () => {
  const credential = jwt.sign({ sub: '123', nonce: 'n'.repeat(43) }, pair.privateKey, { algorithm: 'RS256', keyid: 'test-key', issuer: 'https://accounts.google.com', audience: 'other-client', expiresIn: 3600 });
  await expect(verifier().verify(credential)).rejects.toThrow();
});
it('rejects expired signed tokens', async () => {
  const credential = jwt.sign({ sub: '123', nonce: 'n'.repeat(43), iat: Math.floor(Date.now() / 1000) - 7200 }, pair.privateKey, { algorithm: 'RS256', keyid: 'test-key', issuer: 'https://accounts.google.com', audience: clientId, expiresIn: 3600 });
  await expect(verifier().verify(credential)).rejects.toThrow();
});
