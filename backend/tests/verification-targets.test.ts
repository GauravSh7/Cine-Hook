import { describe, expect, it } from 'vitest';
import { verificationTargets } from './verification-targets.mjs';

describe('native verification target identities', () => {
  it('rejects suffixes that PostgreSQL would truncate into a different target identity', () => {
    expect(() => verificationTargets('a'.repeat(34))).toThrow();
    for (const name of Object.values(verificationTargets('a'.repeat(33)))) expect(name.length).toBeLessThanOrEqual(63);
  });
  it('rejects missing or SQL-unsafe suffixes before constructing database names', () => {
    for (const suffix of [undefined, '', 'Uppercase', 'a-b', 'x";DROP DATABASE example;--']) {
      expect(() => verificationTargets(suffix)).toThrow();
    }
  });
});
