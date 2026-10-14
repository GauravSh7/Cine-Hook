import { createHash } from 'node:crypto';
import { APPENDED_FILMS } from './dev-film-expansion.js';

/** Development inventory only. These are demo shows, not current cinema listings. */
const LEGACY_FILMS = [
  { key: 'deadpool-wolverine', title: 'Deadpool & Wolverine', releaseDate: '2024-07-26', durationMinutes: 128, language: 'english', genres: ['action','comedy'], description: 'Deadpool joins Wolverine on a journey that threatens their worlds.', posterUrl: 'https://upload.wikimedia.org/wikipedia/en/4/4c/Deadpool_%26_Wolverine_poster.jpg', sourceUrl: 'https://en.wikipedia.org/wiki/Deadpool_%26_Wolverine' },
  { key: 'inside-out-2', title: 'Inside Out 2', releaseDate: '2024-06-14', durationMinutes: 96, language: 'english', genres: ['animation','family'], description: 'New emotions arrive as Riley enters adolescence.', posterUrl: 'https://upload.wikimedia.org/wikipedia/en/f/f7/Inside_Out_2_poster.jpg', sourceUrl: 'https://en.wikipedia.org/wiki/Inside_Out_2' },
  { key: 'stree-2', title: 'Stree 2', releaseDate: '2024-08-15', durationMinutes: 143, language: 'hindi', genres: ['horror','comedy'], description: 'The people of Chanderi face a new supernatural threat.', posterUrl: 'https://upload.wikimedia.org/wikipedia/en/a/a1/Stree_2.jpg', sourceUrl: 'https://en.wikipedia.org/wiki/Stree_2' },
  { key: 'kalki-2898-ad', title: 'Kalki 2898 AD', releaseDate: '2024-06-27', durationMinutes: 181, language: 'telugu', genres: ['sci-fi','action'], description: 'In a dystopian future, a protected child brings the prospect of change.', posterUrl: 'https://upload.wikimedia.org/wikipedia/en/4/4c/Kalki_2898_AD.jpg', sourceUrl: 'https://en.wikipedia.org/wiki/Kalki_2898_AD' },
  { key: 'salaar', title: 'Salaar: Part 1 – Ceasefire', releaseDate: '2023-12-22', durationMinutes: 175, language: 'telugu', genres: ['action','drama'], description: 'A friendship becomes entangled in the struggle for control of Khansaar.', posterUrl: 'https://upload.wikimedia.org/wikipedia/en/a/a6/Salaar_Part_1_%E2%80%93_Ceasefire.jpg', sourceUrl: 'https://en.wikipedia.org/wiki/Salaar:_Part_1_%E2%80%93_Ceasefire' },
  { key: 'devara', title: 'Devara: Part 1', releaseDate: '2024-09-27', durationMinutes: 176, language: 'telugu', genres: ['action','drama'], description: 'A coastal community confronts violence and a legacy shaped by its protector.', posterUrl: 'https://upload.wikimedia.org/wikipedia/en/f/f0/Devara_Part_1.jpg', sourceUrl: 'https://en.wikipedia.org/wiki/Devara:_Part_1' },
] as const;

const POSTER_URLS: Record<string, string> = {
  dangal: 'https://upload.wikimedia.org/wikipedia/en/9/99/Dangal_Poster.jpg',
  pk: 'https://upload.wikimedia.org/wikipedia/en/c/c3/PK_poster.jpg',
  '3-idiots': 'https://upload.wikimedia.org/wikipedia/en/d/df/3_idiots_poster.jpg',
  jawan: 'https://upload.wikimedia.org/wikipedia/en/3/39/Jawan_film_poster.jpg',
  pathaan: 'https://upload.wikimedia.org/wikipedia/en/c/c3/Pathaan_film_poster.jpg',
  '12th-fail': 'https://upload.wikimedia.org/wikipedia/en/f/f2/12th_Fail_poster.jpeg',
  lagaan: 'https://upload.wikimedia.org/wikipedia/en/b/b6/Lagaan.jpg',
  queen: 'https://upload.wikimedia.org/wikipedia/en/4/45/QueenMoviePoster7thMarch.jpg',
  rrr: 'https://upload.wikimedia.org/wikipedia/en/d/d7/RRR_Poster.jpg',
  'baahubali-2': 'https://upload.wikimedia.org/wikipedia/en/9/93/Baahubali_2_The_Conclusion_poster.jpg',
  'kgf-2': 'https://upload.wikimedia.org/wikipedia/en/d/d0/K.G.F_Chapter_2.jpg',
  kantara: 'https://upload.wikimedia.org/wikipedia/en/8/84/Kantara_poster.jpeg',
  vikram: 'https://upload.wikimedia.org/wikipedia/en/9/93/Vikram_2022_poster.jpg',
  master: 'https://upload.wikimedia.org/wikipedia/en/5/53/Master_2021_poster.jpg',
  jailer: 'https://upload.wikimedia.org/wikipedia/en/c/cb/Jailer_2023_Tamil_film_poster.jpg',
  pushpa: 'https://upload.wikimedia.org/wikipedia/en/7/75/Pushpa_-_The_Rise_%282021_film%29.jpg',
  inception: 'https://upload.wikimedia.org/wikipedia/en/2/2e/Inception_%282010%29_theatrical_poster.jpg',
  interstellar: 'https://upload.wikimedia.org/wikipedia/en/b/bc/Interstellar_film_poster.jpg',
  'dark-knight': 'https://upload.wikimedia.org/wikipedia/en/1/1c/The_Dark_Knight_%282008_film%29.jpg',
  'dune-2': 'https://upload.wikimedia.org/wikipedia/en/5/52/Dune_Part_Two_poster.jpeg',
  oppenheimer: 'https://upload.wikimedia.org/wikipedia/en/4/4a/Oppenheimer_%28film%29.jpg',
  'avatar-water': 'https://upload.wikimedia.org/wikipedia/en/5/54/Avatar_The_Way_of_Water_poster.jpg',
  'top-gun-maverick': 'https://upload.wikimedia.org/wikipedia/en/1/13/Top_Gun_Maverick_Poster.jpg',
  'spider-verse': 'https://upload.wikimedia.org/wikipedia/en/b/b4/Spider-Man-_Across_the_Spider-Verse_poster.jpg',
};

export const FILMS = [...LEGACY_FILMS, ...APPENDED_FILMS].map((film, index) => ({ ...film,
  previousPosterUrl: `/demo-art/${film.key}-poster.svg`,
  posterUrl: 'posterUrl' in film ? film.posterUrl : POSTER_URLS[film.key]!,
  backdropUrl: 'posterUrl' in film ? film.posterUrl : POSTER_URLS[film.key]!,
  collections: ['recommended', ...(film.language === 'hindi' ? ['bollywood'] : ['telugu','tamil','kannada'].includes(film.language) ? ['south'] : []),
    ...(index % 3 === 0 ? ['popular'] : []), ...(index % 4 === 0 ? ['picks'] : []), ...(index < 6 ? ['featured'] : [])],
  artworkKind: null, artworkAttribution: null,
  artworkSourceUrl: null, ratingValue: null, ratingVoteCount: null, ratingSource: null, ratingSourceUrl: null, ratingFetchedAt: null,
}));

/** Absolute IST day ordinal, independent of the rolling seed window. */
export function morningFilmIndex(screenOrdinal: number, startsAt: Date): number {
  const day = Math.floor((startsAt.getTime() + 330 * 60000) / 86400000);
  return 6 + screenOrdinal * 4 + ((day % 4) + 4) % 4;
}

export const VENUES = [
  { key: 'delhi', name: 'New Delhi', state: 'Delhi', countryCode: 'IN', theatreName: 'CineHook Demo Delhi', address: 'Demo venue — Connaught Place area, New Delhi; local development only' },
  { key: 'mumbai', name: 'Mumbai', state: 'Maharashtra', countryCode: 'IN', theatreName: 'CineHook Demo Mumbai', address: 'Demo venue — Andheri area, Mumbai; local development only' },
  { key: 'bengaluru', name: 'Bengaluru', state: 'Karnataka', countryCode: 'IN', theatreName: 'CineHook Demo Bengaluru', address: 'Demo venue — MG Road area, Bengaluru; local development only' },
] as const;

export type DevelopmentSeatType = 'REGULAR' | 'PREMIUM' | 'RECLINER';
export const SEAT_LAYOUT: ReadonlyArray<{ rowName: string; seatNumber: number; seatType: DevelopmentSeatType }> =
  ['A','B','C','D','E','F'].flatMap(rowName => Array.from({ length: 8 }, (_, index) => ({
    rowName, seatNumber: index + 1, seatType: rowName === 'F' ? 'RECLINER' : rowName === 'E' ? 'PREMIUM' : 'REGULAR',
  })));
export const SEAT_PRICES = [
  { seatType: 'REGULAR', pricePaise: 25000 }, { seatType: 'PREMIUM', pricePaise: 40000 }, { seatType: 'RECLINER', pricePaise: 65000 },
] as const;

/** Stable namespaced UUIDs; never inferred from a database's existing sequence. */
export function seedId(key: string): string {
  const hex = createHash('sha256').update(`cinehook:local-development:v1:${key}`).digest('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
}
export const DEV_ADMIN = { id: seedId('admin'), email: 'admin@cinehook.local', name: 'CineHook Development Admin' } as const;

export function futureShowStarts(now: Date): Date[] {
  if (!Number.isFinite(now.getTime())) throw new Error('A valid development seed clock is required.');
  const ist = new Date(now.getTime() + 330 * 60000);
  const day = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
  return Array.from({ length: 7 }, (_, i) => new Date(day + (i + 1) * 86400000 + 13 * 3600000));
}

export function validateAdminPassword(password: string): void {
  if (password.length < 12 || Buffer.byteLength(password, 'utf8') > 72 || password.includes('\0') ||
      !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    throw new Error('Development admin password must have at least 12 characters, upper/lowercase letters, a number and a symbol, at most 72 UTF-8 bytes, and no NUL.');
  }
}
