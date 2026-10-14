import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import type { MovieInput, MovieQuery, MovieStore } from './catalog.types.js';
import { databaseWrite } from './database-write.js';
import { upcomingShowInclude } from './public-movie.js';

export class MovieRepository implements MovieStore {
  constructor(private readonly prisma: PrismaClient) {}
  list(query: MovieQuery) {
    const where: Prisma.MovieWhereInput = { isActive: true };
    if (query.search) where.title = { contains: query.search.replace(/[\\%_]/g, '\\$&'), mode: 'insensitive' };
    if (query.language) where.language = query.language;
    if (query.genre) where.genres = { has: query.genre };
    if(query.cityId)where.shows={some:upcomingShowInclude(query.cityId).shows.where};
    return this.prisma.movie.findMany({ where, include: upcomingShowInclude(query.cityId), orderBy: [{ title: 'asc' }, { id: 'asc' }], skip: (query.page - 1) * query.limit, take: query.limit });
  }
  findById(id: string, cityId?: string) { return this.prisma.movie.findUnique({ where: { id }, include: upcomingShowInclude(cityId) }); }
  async showDates(id: string, cityId?: string) {
    const shows = await this.prisma.show.findMany({ where: { movieId: id, movie: { isActive: true }, status: 'SCHEDULED',
      startsAt: { gt: new Date() }, screen: { theatre: { cityId } } }, select: { startsAt: true }, orderBy: { startsAt: 'asc' } });
    return shows.map(show => show.startsAt);
  }
  create(input: MovieInput) { return databaseWrite(() => this.prisma.movie.create({ data: input }), 'Movie'); }
  update(id: string, input: Partial<MovieInput> & { isActive?: false }) {
    const artworkChanged = 'posterUrl' in input || 'backdropUrl' in input;
    return databaseWrite(() => this.prisma.movie.update({ where: { id }, data: { ...input,
      ...(artworkChanged ? { artworkKind: null, artworkAttribution: null, artworkSourceUrl: null } : {}) } }), 'Movie');
  }
}
