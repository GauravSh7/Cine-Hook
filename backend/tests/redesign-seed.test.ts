import { it, expect } from 'vitest';
import { seedDevelopment } from '../prisma/dev-seed-core.js';
import { DEV_ADMIN, FILMS, seedId } from '../prisma/dev-seed-manifest.js';

// Test-only transactional storage: the core remains real; I/O alone is replaced.
function memorySeed() {
  const state: Record<string, any[]> = { user: [{ ...DEV_ADMIN, role: 'ADMIN', passwordHash: 'keep-hash' }], movie: [], city: [], theatre: [], screen: [], seat: [], show: [] };
  function matches(row: any, where: any): boolean {
    return Object.entries(where ?? {}).every(([key, value]: [string, any]) => {
      if (key === 'OR') return value.some((clause: any) => matches(row, clause));
      if (value && typeof value === 'object' && !(value instanceof Date)) {
        if (value.in) return value.in.includes(row[key]);
        if (value.lt) return row[key] < value.lt;
        if (value.gt) return row[key] > value.gt;
      }
      return value instanceof Date ? row[key]?.getTime() === value.getTime() : row[key] === value;
    });
  }
  const tx: any = { $queryRaw: async (strings: any) => String(strings).includes('current_database') ? [{ database: 'cinehook_dev', schema: 'public', port: 5432 }] : [], $executeRaw: async () => 1 };
  for (const key of Object.keys(state)) tx[key] = {
    findMany: async ({ where }: any) => state[key]!.filter(row => matches(row, where)),
    findUnique: async ({ where }: any) => state[key]!.find(row => matches(row, where)) ?? null,
    count: async ({ where }: any) => state[key]!.filter(row => matches(row, where)).length,
    create: async ({ data }: any) => { const row = { ...data, ...(key === 'show' ? { prices: data.prices.create } : {}) }; state[key]!.push(row); return row; },
    createMany: async ({ data }: any) => { state[key]!.push(...data); return { count: data.length }; },
    updateMany: async ({ where, data }: any) => { const rows = state[key]!.filter(row => matches(row, where)); rows.forEach(row => Object.assign(row, data)); return { count: rows.length }; },
  };
  const client = { $transaction: async (work: any) => { const snapshot = structuredClone(state); try { return await work(tx); } catch (error) { Object.assign(state, snapshot); throw error; } } };
  return { state, client };
}
const options = { expectedDatabase: 'cinehook_dev', expectedPort: 5432, now: new Date('2026-10-08T10:00:00Z') };
it('creates all 30 films in 84 nonoverlapping shows and preserves all rows across reruns and next-day overlap', async () => {
  const { state, client } = memorySeed();
  const first = await seedDevelopment(client as never, options);
  expect(first.created).toEqual({ users: 0, movies: 30, cities: 3, theatres: 3, screens: 6, seats: 288, shows: 84, prices: 252 });
  expect(new Set(state.show!.map(s => s.movieId)).size).toBe(30);
  for (const screen of state.screen!) {
    const shows = state.show!.filter(s => s.screenId === screen.id).sort((a,b) => a.startsAt - b.startsAt);
    expect(shows).toHaveLength(14);
    for (let i = 1; i < shows.length; i++) expect(shows[i].startsAt >= shows[i-1].endsAt).toBe(true);
  }
  const before = structuredClone(state);
  expect((await seedDevelopment(client as never, options)).created.shows).toBe(0);
  expect(state).toEqual(before);
  expect((await seedDevelopment(client as never, { ...options, now: new Date('2026-10-09T10:00:00Z') })).created.shows).toBe(12);
  expect(state.show!.filter(s => before.show!.some(old => old.id === s.id))).toEqual(before.show);
  expect(state.user![0].passwordHash).toBe('keep-hash');
  expect(state.movie!.every(m => m.ratingValue === null && m.metadataSourceUrl.startsWith('https://'))).toBe(true);
});
it('preserves naturally reused and custom seed-ID movie artwork and metadata', async () => {
  const { state, client } = memorySeed();
  const film = FILMS[0]!;
  const custom = { id: seedId(`movie:${film.key}`), title: film.title, releaseDate: new Date(film.releaseDate), language: film.language,
    durationMinutes: 129, isActive: true, description: 'Custom', genres: ['custom'], posterUrl: 'https://example.test/custom.jpg' };
  state.movie!.push(custom);
  await seedDevelopment(client as never, options);
  expect(state.movie![0]).toEqual(custom);
  expect(state.show!.filter(s => s.movieId === custom.id).every(s => s.endsAt - s.startsAt === 129 * 60000)).toBe(true);
});
it('rolls back additions when an existing screen has an incompatible layout', async () => {
  const { state, client } = memorySeed();
  state.screen!.push({ id: seedId('screen:delhi:1'), theatreId: seedId('theatre:delhi'), name: 'Demo Screen 1', capacity: 1 });
  const before = structuredClone(state);
  await expect(seedDevelopment(client as never, options)).rejects.toThrow(/layout/i);
  expect(state).toEqual(before);
});
