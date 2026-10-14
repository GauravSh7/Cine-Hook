import { randomUUID } from 'node:crypto';
import type { Movie, City, Theatre, Screen } from '../../src/generated/prisma/client.js';
import { AppError } from '../../src/errors/app-error.js';
import { MovieService } from '../../src/modules/catalog/movie.service.js';
import { CityService } from '../../src/modules/catalog/city.service.js';
import { TheatreService } from '../../src/modules/catalog/theatre.service.js';
import { ScreenService } from '../../src/modules/catalog/screen.service.js';
import type { MovieInput, CityInput, CityQuery, TheatreInput, ScreenInput, Page } from '../../src/modules/catalog/catalog.types.js';

// Test-only I/O substitutes. Production uses the Prisma repositories exclusively.
export function testCatalog() {
  const movies = new Map<string, Movie>();
  const cities = new Map<string, City>();
  const theatres = new Map<string, Theatre>();
  const screens = new Map<string, Screen>();
  const base = () => ({ id: randomUUID(), createdAt: new Date(), updatedAt: new Date() });
  const paginate = <T>(values: T[], q: Page) => values.slice((q.page - 1) * q.limit, q.page * q.limit);
  const missing = () => new AppError(404, 'NOT_FOUND', 'Not found.');
  const duplicate = () => new AppError(409, 'DUPLICATE_RESOURCE', 'Already exists.');
  const cityService = new CityService({
    list: async (q: CityQuery) => paginate([...cities.values()].filter(city => city.countryCode === 'IN' && (!q.state || city.state.toLowerCase() === q.state.toLowerCase()) && (!q.search || `${city.name} ${city.state}`.toLowerCase().includes(q.search.toLowerCase()))).sort((a, b) => a.name.localeCompare(b.name)), q),
    findById: async id => cities.get(id) ?? null,
    create: async (input: CityInput) => {
      if ([...cities.values()].some(x => x.name.toLowerCase() === input.name.toLowerCase() && x.state.toLowerCase() === input.state.toLowerCase() && x.countryCode === input.countryCode)) throw duplicate();
      const city = { ...input, ...base() }; cities.set(city.id, city); return city;
    },
  });
  function theatreUnique(input: Partial<TheatreInput>, id?: string) {
    if ([...theatres.values()].some(x => x.id !== id && x.cityId === input.cityId && x.name.toLowerCase() === input.name?.toLowerCase())) throw duplicate();
  }
  const theatreService = new TheatreService({
    list: async q => paginate([...theatres.values()].filter(x => !q.cityId || x.cityId === q.cityId).sort((a, b) => a.name.localeCompare(b.name)), q),
    findById: async id => {
      const theatre = theatres.get(id);
      return theatre ? { ...theatre, city: cities.get(theatre.cityId)!, screens: [...screens.values()].filter(x => x.theatreId === id) } : null;
    },
    create: async (input: TheatreInput) => { theatreUnique(input); const theatre = { ...input, ...base() }; theatres.set(theatre.id, theatre); return theatre; },
    update: async (id, input) => { const current = theatres.get(id); if (!current) throw missing(); const next = { ...current, ...input }; theatreUnique(next, id); theatres.set(id, next); return next; },
  }, cityService);
  const movieService = new MovieService({
    list: async q => paginate([...movies.values()].filter(x => x.isActive && (!q.search || x.title.toLowerCase().includes(q.search.toLowerCase())) && (!q.language || x.language === q.language) && (!q.genre || x.genres.includes(q.genre))).sort((a, b) => a.title.localeCompare(b.title)), q),
    findById: async id => movies.get(id) ?? null,
    showDates: async () => [],
    create: async (input: MovieInput) => { const movie = { backdropUrl: null, collections: [], metadataSourceUrl: null, artworkKind: null,
      artworkAttribution: null, artworkSourceUrl: null, ratingValue: null, ratingVoteCount: null, ratingSource: null, ratingSourceUrl: null, ratingFetchedAt: null,
      ...input, ...base(), isActive: true }; movies.set(movie.id, movie); return movie; },
    update: async (id, input) => { const current = movies.get(id); if (!current) throw missing(); const next = { ...current, ...input }; movies.set(id, next); return next; },
  });
  function screenUnique(input: ScreenInput, id?: string) {
    if ([...screens.values()].some(x => x.id !== id && x.theatreId === input.theatreId && x.name.toLowerCase() === input.name.toLowerCase())) throw duplicate();
  }
  const screenService = new ScreenService({
    create: async input => { screenUnique(input); const screen = { ...input, ...base() }; screens.set(screen.id, screen); return screen; },
    update: async (id, input) => { const current = screens.get(id); if (!current) throw missing(); const next = { ...current, ...input }; screenUnique(next, id); screens.set(id, next); return next; },
  }, theatreService);
  return { movies, cities, theatres, screens, services: { movies: movieService, cities: cityService, theatres: theatreService, screens: screenService } };
}
