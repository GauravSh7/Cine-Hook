import { AppError } from '../../errors/app-error.js';
import type { MovieInput, MovieQuery, MovieStore } from './catalog.types.js';
import { publicMovie } from './public-movie.js';

export class MovieService {
  constructor(private readonly movies: MovieStore) {}
  async list(query: MovieQuery) { return { items: (await this.movies.list(query)).map(movie => publicMovie(movie, query.cityId)), page: query.page, limit: query.limit }; }
  async getById(id: string, cityId?: string) {
    const movie = await this.movies.findById(id, cityId);
    if (!movie?.isActive) throw new AppError(404, 'NOT_FOUND', 'Movie not found.');
    return publicMovie(movie, cityId);
  }
  async showDates(id: string, cityId?: string) {
    await this.getById(id, cityId);
    const starts = await this.movies.showDates(id, cityId);
    return { dates: [...new Set(starts.map(date => new Date(date.getTime() + 330 * 60000).toISOString().slice(0,10)))].sort(), timeZone: 'Asia/Kolkata' as const };
  }
  async create(input: MovieInput) { return publicMovie(await this.movies.create(input)); }
  async update(id: string, input: Partial<MovieInput>) {
    const movie = await this.movies.update(id, input);
    return publicMovie(await this.movies.findById(id) ?? movie);
  }
  async disable(id: string) { return publicMovie(await this.movies.update(id, { isActive: false })); }
}
