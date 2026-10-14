import { describe, expect, it } from 'vitest';
import { curatedHindiSummary, verifiedHindiOverview } from '../prisma/dev-tmdb-hindi-core.js';
import { HINDI_TMDB_SUMMARIES } from '../prisma/refinement-manifest.js';

describe('TMDB Hindi overview validation', () => {
  it('accepts a Hindi overview from the requested movie', () => {
    expect(verifiedHindiOverview(27205, { id: 27205, overview: 'एक दल सपनों की कई परतों में उतरता है।' })).toBe('एक दल सपनों की कई परतों में उतरता है।');
  });
  it('rejects missing translations, English fallback text and mismatched movie results', () => {
    expect(verifiedHindiOverview(27205, { id: 27205, overview: 'A team enters layers of dreams.' })).toBeNull();
    expect(verifiedHindiOverview(27205, { id: 1, overview: 'यह सही भाषा है लेकिन फिल्म अलग है।' })).toBeNull();
    expect(verifiedHindiOverview(27205, { id: 27205, overview: '' })).toBeNull();
  });
  it('uses only the authored Hindi summary whose TMDB source ID matches the movie', () => {
    expect(curatedHindiSummary(1606527, 'https://www.themoviedb.org/movie/1606527')).toMatch(/\p{Script=Devanagari}/u);
    expect(curatedHindiSummary(1606527, 'https://www.themoviedb.org/movie/19995')).toBeNull();
    expect(curatedHindiSummary(1606527, null)).toBeNull();
  });
  it('contains a valid Hindi summary for every curated TMDB record', () => {
    expect(Object.keys(HINDI_TMDB_SUMMARIES)).toHaveLength(47);
    for (const [id, summary] of Object.entries(HINDI_TMDB_SUMMARIES)) {
      expect(id).toMatch(/^[1-9]\d*$/);
      expect(summary.length).toBeGreaterThanOrEqual(8);
      expect(summary).toMatch(/\p{Script=Devanagari}/u);
      expect(curatedHindiSummary(Number(id), `https://www.themoviedb.org/movie/${id}`)).toBe(summary);
    }
  });
});
