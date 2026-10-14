import { expect, it } from 'vitest';
import { seedRefinementContent } from '../prisma/refinement-seed-core.js';
import { DEMO_LISTINGS, HINDI_SUMMARIES } from '../prisma/refinement-manifest.js';
import { FILMS } from '../prisma/dev-seed-manifest.js';

it('provides an original Hindi summary for every verified development movie', () => {
  expect(FILMS).toHaveLength(30);
  for (const film of FILMS) expect(HINDI_SUMMARIES[film.key]).toMatch(/[\u0900-\u097f]/);
});
it('plans six discovery listings per category with contextual art and no payment relationships', () => {
  for (const kind of ['STREAM', 'EVENTS', 'SPORTS', 'ACTIVITIES']) expect(DEMO_LISTINGS.filter(row => row.kind === kind)).toHaveLength(6);
  expect(new Set(DEMO_LISTINGS.map(row => row.slug)).size).toBe(24);
  expect(DEMO_LISTINGS.every(row => row.title.endsWith('— DEMO') && row.imageAttribution.includes('Unsplash license') && row.slug.startsWith('demo-'))).toBe(true);
});
it('rejects personal/production targets before any transaction', async () => {
  let calls = 0;
  const db = { $transaction: async () => { calls++; } };
  await expect(seedRefinementContent(db as never, { expectedDatabase: 'cinehook', expectedPort: 5432 })).rejects.toThrow(/target/i);
  expect(calls).toBe(0);
});
